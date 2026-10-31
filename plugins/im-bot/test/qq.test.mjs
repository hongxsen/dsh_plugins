import test from 'node:test';
import assert from 'node:assert/strict';

import { createQQAdapter } from '../lib/platforms/qq.js';

const NOW = Date.parse('2026-10-31T07:00:00.000Z');

function response(body, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => name.toLowerCase() === 'x-tps-trace-id' ? 'trace-test' : null },
    text: async () => body === undefined ? '' : JSON.stringify(body),
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

class FakeTimers {
  constructor() {
    this.time = NOW;
    this.nextId = 1;
    this.tasks = new Map();
  }

  now = () => this.time;

  setTimeout = (fn, delay = 0) => {
    const id = this.nextId++;
    this.tasks.set(id, { fn, at: this.time + Math.max(0, Number(delay) || 0) });
    return id;
  };

  clearTimeout = (id) => { this.tasks.delete(id); };

  async advance(ms) {
    const target = this.time + ms;
    while (true) {
      const due = [...this.tasks.entries()]
        .filter(([, task]) => task.at <= target)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      const [id, task] = due;
      this.tasks.delete(id);
      this.time = task.at;
      task.fn();
      await flush();
    }
    this.time = target;
    await flush();
  }
}

class FakeWebSocket {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this.closeCalls = [];
    FakeWebSocket.instances.push(this);
  }

  open() {
    this.readyState = 1;
    this.onopen?.({});
  }

  send(data) {
    this.sent.push(JSON.parse(data));
  }

  receive(frame) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  close(code = 1000, reason = '') {
    this.closeCalls.push({ code, reason });
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
}

function harness({ config = {}, fetchHandler, timers = new FakeTimers() } = {}) {
  FakeWebSocket.instances = [];
  const calls = [];
  const errors = [];
  const messages = [];
  const readies = [];
  const logs = [];
  let tokenCount = 0;
  let messageCount = 0;

  const fetch = async (url, init = {}) => {
    const call = { url, init, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    if (fetchHandler) {
      const custom = await fetchHandler(call, { tokenCount, messageCount });
      if (custom) return custom;
    }
    if (new URL(url).pathname === '/app/getAppAccessToken') {
      tokenCount++;
      return response({ access_token: `token-${tokenCount}`, expires_in: '7200' });
    }
    if (new URL(url).pathname === '/gateway') {
      return response({ url: 'wss://qq.test/websocket' });
    }
    if (new URL(url).pathname.endsWith('/messages') || new URL(url).pathname.endsWith('/stream_messages')) {
      messageCount++;
      return response({ id: `sent-${messageCount}` });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const adapter = createQQAdapter({
    id: 'qq-main',
    appId: 'app-id',
    appSecret: 'super-secret',
    ...config,
  }, {
    fetch,
    WebSocket: FakeWebSocket,
    now: timers.now,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    random: () => 0,
    logger: {
      info: (...args) => logs.push(['info', ...args]),
      warn: (...args) => logs.push(['warn', ...args]),
      error: (...args) => logs.push(['error', ...args]),
    },
  });

  return {
    adapter,
    calls,
    errors,
    messages,
    readies,
    logs,
    timers,
    sockets: FakeWebSocket.instances,
    callbacks: {
      onMessage: async (message) => { messages.push(message); },
      onError: (error) => { errors.push(error); },
      onReady: (info) => { readies.push(info); },
    },
  };
}

async function start(h) {
  await h.adapter.start(h.callbacks);
  const socket = h.sockets.at(-1);
  socket.open();
  return socket;
}

function hello(socket, interval = 1000) {
  socket.receive({ op: 10, d: { heartbeat_interval: interval } });
}

function ready(socket, sessionId = 'session-1', seq = 1) {
  socket.receive({ op: 0, s: seq, t: 'READY', d: { session_id: sessionId, user: { id: 'bot-user' } } });
}

function directMessage(id = 'incoming-1') {
  return {
    connectionId: 'qq-main',
    platform: 'qq',
    eventId: id,
    chatId: 'user-openid',
    userId: 'user-openid',
    chatType: 'direct',
    text: 'hello',
    receivedAt: NOW,
    replyContext: { msgId: id, userOpenId: 'user-openid' },
  };
}

function groupMessage(id = 'incoming-group') {
  return {
    connectionId: 'qq-main',
    platform: 'qq',
    eventId: id,
    chatId: 'group-openid',
    userId: 'member-openid',
    chatType: 'group',
    text: 'hello',
    receivedAt: NOW,
    replyContext: { msgId: id, groupOpenId: 'group-openid' },
  };
}

function bodies(h, suffix) {
  return h.calls.filter((call) => new URL(call.url).pathname.endsWith(suffix));
}

test('validates credentials and exposes the shared adapter contract', () => {
  assert.throws(() => createQQAdapter({ appSecret: 'x' }), /appId/);
  assert.throws(() => createQQAdapter({ appId: 'x' }), /appSecret/);
  const h = harness();
  assert.equal(h.adapter.type, 'qq');
  assert.equal(typeof h.adapter.start, 'function');
  assert.equal(typeof h.adapter.stop, 'function');
  assert.equal(typeof h.adapter.createDelivery, 'function');
  assert.equal(typeof h.adapter.getStatus, 'function');
  assert.deepEqual(h.adapter.getStatus(), { state: 'idle' });
});

test('gets AppAccessToken, authorizes gateway, identifies with current intent and handles READY', async () => {
  const h = harness();
  const socket = await start(h);
  hello(socket);
  assert.deepEqual(socket.sent[0], {
    op: 2,
    d: {
      token: 'QQBot token-1',
      intents: 33554432,
      shard: [0, 1],
      properties: {},
    },
  });
  const token = h.calls[0];
  assert.equal(token.url, 'https://api.bot.qq.com/app/getAppAccessToken');
  assert.deepEqual(token.body, { appId: 'app-id', clientSecret: 'super-secret' });
  const gateway = h.calls[1];
  assert.equal(gateway.init.method, 'GET');
  assert.equal(gateway.init.headers.Authorization, 'QQBot token-1');
  ready(socket, 'session-ready', 7);
  assert.deepEqual(h.readies, [{ state: 'online', sessionId: 'session-ready', resumed: false }]);
  assert.deepEqual(h.adapter.getStatus(), h.readies[0]);
  socket.receive({ op: 11 });
  await h.adapter.stop();
});

test('sandbox uses the QQ sandbox REST origin and gatewayUrl skips gateway discovery', async () => {
  const sandbox = harness({ config: { sandbox: true } });
  await start(sandbox);
  assert.equal(sandbox.calls[0].url, 'https://api.bot.qq.com/app/getAppAccessToken');
  assert.equal(sandbox.calls[1].url, 'https://sandbox.api.sgroup.qq.com/gateway');
  await sandbox.adapter.stop();

  const overridden = harness({ config: { gatewayUrl: 'wss://gateway.test/custom' } });
  const socket = await start(overridden);
  assert.equal(socket.url, 'wss://gateway.test/custom');
  assert.equal(overridden.calls.length, 0);
  hello(socket);
  await flush();
  assert.equal(overridden.calls.length, 1);
  assert.equal(overridden.calls[0].url, 'https://api.bot.qq.com/app/getAppAccessToken');
  assert.equal(socket.sent[0].op, 2);
  await overridden.adapter.stop();
});

test('token fetch is single-flight and refreshes before expiry', async () => {
  const timers = new FakeTimers();
  const h = harness({ timers });
  const first = h.adapter.createDelivery(directMessage('m1'));
  const second = h.adapter.createDelivery(directMessage('m2'));
  await Promise.all([first.notice('one'), second.notice('two')]);
  assert.equal(bodies(h, '/app/getAppAccessToken').length, 1);
  await first.notice('still cached');
  assert.equal(bodies(h, '/app/getAppAccessToken').length, 1);

  // Use a short token lifetime to exercise the 60 second refresh window.
  let shortTokenCount = 0;
  const short = harness({
    timers,
    fetchHandler: (call) => new URL(call.url).pathname === '/app/getAppAccessToken'
      ? response({ access_token: `short-${++shortTokenCount}`, expires_in: '120' })
      : undefined,
  });
  const delivery = short.adapter.createDelivery(directMessage());
  await delivery.notice('first');
  timers.time = NOW + 59_000;
  await delivery.notice('cached');
  assert.equal(bodies(short, '/app/getAppAccessToken').length, 1);
  timers.time = NOW + 60_000;
  await delivery.notice('refreshed');
  assert.equal(bodies(short, '/app/getAppAccessToken').length, 2);
  assert.equal(short.calls.at(-1).init.headers.Authorization, 'QQBot short-2');
  await h.adapter.stop();
  await short.adapter.stop();
});

test('a 401 refreshes once and retries with the new QQBot token', async () => {
  let messageAttempts = 0;
  const h = harness({
    config: { c2cStream: false },
    fetchHandler: (call) => {
      const path = new URL(call.url).pathname;
      if (path === '/app/getAppAccessToken') {
        const n = bodies(h, '/app/getAppAccessToken').length;
        return response({ access_token: `token-${n}`, expires_in: 7200 });
      }
      if (path.endsWith('/messages')) {
        messageAttempts++;
        return messageAttempts === 1 ? response({ err_code: 11243 }, 401) : response({ id: 'ok' });
      }
    },
  });
  const delivery = h.adapter.createDelivery(directMessage());
  await delivery.notice('hello');
  const sends = bodies(h, '/v2/users/user-openid/messages');
  assert.equal(sends.length, 2);
  assert.equal(sends[0].init.headers.Authorization, 'QQBot token-1');
  assert.equal(sends[1].init.headers.Authorization, 'QQBot token-2');
  assert.equal(bodies(h, '/app/getAppAccessToken').length, 2);
  await delivery.notice('again');
  assert.equal(bodies(h, '/app/getAppAccessToken').length, 2);
  await h.adapter.stop();
});

test('persistent 401 does not retry more than once', async () => {
  const h = harness({
    config: { c2cStream: false },
    fetchHandler: (call) => new URL(call.url).pathname.endsWith('/messages')
      ? response({ err_code: 11243, message: 'do not leak super-secret' }, 401)
      : undefined,
  });
  const delivery = h.adapter.createDelivery(directMessage());
  await assert.rejects(delivery.notice('hello'), (error) => {
    assert.equal(error.status, 401);
    assert.doesNotMatch(error.message, /super-secret|token-/);
    return true;
  });
  assert.equal(bodies(h, '/v2/users/user-openid/messages').length, 2);
  await h.adapter.stop();
});

test('heartbeat uses latest seq and reconnect resumes with session and seq', async () => {
  const h = harness();
  const first = await start(h);
  hello(first);
  ready(first, 'session-resume', 3);
  first.receive({
    op: 0, s: 9, t: 'C2C_MESSAGE_CREATE',
    d: { id: 'msg-9', content: 'hello', timestamp: new Date(NOW).toISOString(), author: { user_openid: 'u1' } },
  });
  await flush();
  await h.timers.advance(1000);
  assert.deepEqual(first.sent.find((frame) => frame.op === 1), { op: 1, d: 9 });
  first.receive({ op: 11 });
  first.close(4009);
  await h.timers.advance(1000);
  assert.equal(h.sockets.length, 2);
  const second = h.sockets[1];
  second.open();
  hello(second);
  assert.deepEqual(second.sent[0], {
    op: 6,
    d: { token: 'QQBot token-1', session_id: 'session-resume', seq: 9 },
  });
  second.receive({ op: 0, t: 'RESUMED', d: '' });
  assert.deepEqual(h.readies.at(-1), { state: 'online', sessionId: 'session-resume', resumed: true });
  assert.deepEqual(h.adapter.getStatus(), h.readies.at(-1));
  await h.adapter.stop();
});

test('server heartbeat request is acknowledged immediately', async () => {
  const h = harness();
  const socket = await start(h);
  hello(socket);
  ready(socket, 's', 4);
  socket.receive({ op: 1 });
  assert.deepEqual(socket.sent.at(-1), { op: 1, d: 4 });
  await h.adapter.stop();
});

test('op 7 reconnects with resume and non-resumable op 9 re-identifies', async () => {
  const h = harness();
  const first = await start(h);
  hello(first);
  ready(first, 'session-old', 11);
  first.receive({ op: 7 });
  await h.timers.advance(1000);
  const second = h.sockets[1];
  second.open();
  hello(second);
  assert.equal(second.sent[0].op, 6);
  second.receive({ op: 9, d: false });
  await h.timers.advance(2000);
  const third = h.sockets[2];
  third.open();
  hello(third);
  assert.equal(third.sent[0].op, 2);
  await h.adapter.stop();
});

test('reconnect delays honor configured initial and maximum values', async () => {
  const h = harness({ config: { reconnectInitialMs: 10, reconnectMaxMs: 20 } });
  const first = await start(h);
  first.close(4009);
  assert.deepEqual(h.adapter.getStatus(), { state: 'reconnecting' });
  await h.timers.advance(9);
  assert.equal(h.sockets.length, 1);
  await h.timers.advance(1);
  assert.equal(h.sockets.length, 2);
  const second = h.sockets[1];
  second.open();
  second.close(4009);
  await h.timers.advance(19);
  assert.equal(h.sockets.length, 2);
  await h.timers.advance(1);
  assert.equal(h.sockets.length, 3);
  await h.adapter.stop();
  assert.deepEqual(h.adapter.getStatus(), { state: 'stopped' });
});

test('4006 drops an invalid resumable session before reconnect', async () => {
  const h = harness();
  const first = await start(h);
  hello(first);
  ready(first, 'bad-session', 2);
  first.close(4006);
  await h.timers.advance(1000);
  const second = h.sockets[1];
  second.open();
  hello(second);
  assert.equal(second.sent[0].op, 2);
  await h.adapter.stop();
});

for (const code of [4013, 4014]) {
  test(`fatal gateway close ${code} reports a sanitized error and never reconnects`, async () => {
    const h = harness();
    const socket = await start(h);
    hello(socket);
    socket.close(code, 'invalid intent');
    await h.timers.advance(60_000);
    assert.equal(h.sockets.length, 1);
    assert.equal(h.errors.at(-1).code, code);
    assert.doesNotMatch(h.errors.at(-1).message, /super-secret|token-/);
    await h.adapter.stop();
  });
}

test('normalizes C2C/group events using incoming d.id and ignores unrelated or bot messages', async () => {
  const h = harness();
  const socket = await start(h);
  hello(socket);
  ready(socket);
  socket.receive({ op: 0, s: 2, t: 'READY', d: {} });
  socket.receive({ op: 0, s: 3, t: 'AT_MESSAGE_CREATE', d: { id: 'ignored' } });
  socket.receive({
    op: 0, s: 4, t: 'C2C_MESSAGE_CREATE', id: 'outer-event',
    d: { id: 'direct-id', content: ' direct text ', timestamp: '2026-10-31T07:00:01.000Z', author: { user_openid: 'direct-user' } },
  });
  socket.receive({
    op: 0, s: 5, t: 'GROUP_AT_MESSAGE_CREATE',
    d: { id: 'group-id', content: 'group text', timestamp: '2026-10-31T07:00:02.000Z', group_openid: 'group-1', author: { member_openid: 'member-1' } },
  });
  socket.receive({
    op: 0, s: 6, t: 'C2C_MESSAGE_CREATE',
    d: { id: 'bot-message', content: 'ignore', author: { user_openid: 'bot', bot: true } },
  });
  await flush();
  assert.deepEqual(h.messages.map((message) => message.eventId), ['direct-id', 'group-id']);
  assert.deepEqual(h.messages[0], {
    connectionId: 'qq-main', platform: 'qq', eventId: 'direct-id',
    chatId: 'direct-user', userId: 'direct-user', chatType: 'direct',
    text: 'direct text', receivedAt: Date.parse('2026-10-31T07:00:01.000Z'),
    replyContext: { msgId: 'direct-id', userOpenId: 'direct-user', eventId: 'outer-event' },
  });
  assert.deepEqual(h.messages[1], {
    connectionId: 'qq-main', platform: 'qq', eventId: 'group-id',
    chatId: 'group-1', userId: 'member-1', chatType: 'group',
    text: 'group text', receivedAt: Date.parse('2026-10-31T07:00:02.000Z'),
    replyContext: { msgId: 'group-id', groupOpenId: 'group-1', eventId: undefined },
  });
  await h.adapter.stop();
});

test('invalid or missing event timestamps fall back to the injected epoch clock', async () => {
  const h = harness();
  const socket = await start(h);
  hello(socket);
  socket.receive({
    op: 0, s: 2, t: 'C2C_MESSAGE_CREATE',
    d: { id: 'missing-time', content: 'hello', author: { user_openid: 'direct-user' } },
  });
  await flush();
  assert.equal(h.messages[0].receivedAt, NOW);
  assert.equal(typeof h.messages[0].receivedAt, 'number');
  await h.adapter.stop();
});

test('C2C delivery prefers stream replace/done and reuses stream_msg_id and stream msg_seq', async () => {
  const h = harness({
    fetchHandler: (call) => new URL(call.url).pathname.endsWith('/stream_messages')
      ? response({ id: 'stream-1' }) : undefined,
  });
  const delivery = h.adapter.createDelivery(directMessage());
  await delivery.ack('working');
  await delivery.progress('half');
  await delivery.final('done');
  const sends = bodies(h, '/v2/users/user-openid/stream_messages');
  assert.equal(sends.length, 3);
  assert.deepEqual(sends.map((call) => call.body.input_state), [1, 1, 10]);
  assert.deepEqual(sends.map((call) => call.body.index), [0, 1, 2]);
  assert.deepEqual(sends.map((call) => call.body.msg_seq), [1, 1, 1]);
  assert.equal(sends[0].body.input_mode, 'replace');
  assert.equal(sends[0].body.stream_msg_id, undefined);
  assert.equal(sends[1].body.stream_msg_id, 'stream-1');
  assert.equal(sends[2].body.stream_msg_id, 'stream-1');
  assert.equal(sends[2].body.content_raw, 'done');
  assert.equal(bodies(h, '/v2/users/user-openid/messages').length, 0);
  await delivery.dispose();
  await h.adapter.stop();
});

test('stream can be disabled and ordinary C2C replies increment msg_seq', async () => {
  const h = harness({ config: { c2cStream: false } });
  const delivery = h.adapter.createDelivery(directMessage());
  await delivery.ack('working');
  await delivery.progress('half');
  await delivery.final('done');
  const sends = bodies(h, '/v2/users/user-openid/messages');
  assert.deepEqual(sends.map((call) => call.body.msg_seq), [1, 2, 3]);
  assert.deepEqual(sends.map((call) => call.body.msg_type), [0, 0, 0]);
  assert.deepEqual(sends.map((call) => call.body.msg_id), ['incoming-1', 'incoming-1', 'incoming-1']);
  await h.adapter.stop();
});

test('stream failure falls back to ordinary passive replies and never resumes a broken stream', async () => {
  const h = harness({
    fetchHandler: (call) => new URL(call.url).pathname.endsWith('/stream_messages')
      ? response({ err_code: 50001, message: 'super-secret token-1' }, 500)
      : undefined,
  });
  const delivery = h.adapter.createDelivery(directMessage());
  await delivery.ack('working');
  await delivery.final('done');
  assert.equal(bodies(h, '/v2/users/user-openid/stream_messages').length, 1);
  const normal = bodies(h, '/v2/users/user-openid/messages');
  assert.equal(normal.length, 2);
  assert.deepEqual(normal.map((call) => call.body.msg_seq), [2, 3]);
  assert.equal(normal[1].body.content, 'done');
  assert.doesNotMatch(JSON.stringify(h.logs), /super-secret|token-1/);
  await h.adapter.stop();
});

test('group delivery never calls stream, limits progress and enforces five passive replies', async () => {
  const h = harness();
  const delivery = h.adapter.createDelivery(groupMessage());
  await delivery.ack('ack');
  await delivery.progress('progress 1');
  await delivery.progress('progress 2');
  await delivery.final('final');
  await delivery.notice('notice 1');
  await delivery.notice('notice 2');
  await assert.rejects(delivery.notice('over quota'), /quota/);
  const normal = bodies(h, '/v2/groups/group-openid/messages');
  assert.equal(normal.length, 5);
  assert.deepEqual(normal.map((call) => call.body.msg_seq), [1, 2, 3, 4, 5]);
  assert.deepEqual(normal.map((call) => call.body.content), ['ack', 'progress 1', 'final', 'notice 1', 'notice 2']);
  assert.equal(bodies(h, '/stream_messages').length, 0);
  await h.adapter.stop();
});

test('group final and notice chunks stay ordered on one msg_seq/quota chain', async () => {
  const gate = deferred();
  let groupSends = 0;
  const h = harness({
    fetchHandler: async (call) => {
      if (!new URL(call.url).pathname.endsWith('/groups/group-openid/messages')) return undefined;
      groupSends++;
      if (groupSends === 1) await gate.promise;
      return response({ id: `group-sent-${groupSends}` });
    },
  });
  const delivery = h.adapter.createDelivery(groupMessage());
  const final = delivery.final('part 0');
  const notice1 = delivery.notice('part 1');
  const notice2 = delivery.notice('part 2');
  await flush();
  assert.equal(groupSends, 1);
  gate.resolve();
  await Promise.all([final, notice1, notice2]);
  const sends = bodies(h, '/v2/groups/group-openid/messages');
  assert.deepEqual(sends.map((call) => call.body.content), ['part 0', 'part 1', 'part 2']);
  assert.deepEqual(sends.map((call) => call.body.msg_seq), [1, 2, 3]);
  await h.adapter.stop();
});

test('C2C notices after a completed stream use new passive msg_seq values', async () => {
  const h = harness();
  const delivery = h.adapter.createDelivery(directMessage());
  await delivery.final('part 0');
  await delivery.notice('part 1');
  await delivery.notice('part 2');
  assert.equal(bodies(h, '/stream_messages').length, 1);
  const ordinary = bodies(h, '/v2/users/user-openid/messages');
  assert.deepEqual(ordinary.map((call) => call.body.content), ['part 1', 'part 2']);
  assert.deepEqual(ordinary.map((call) => call.body.msg_seq), [2, 3]);
  await h.adapter.stop();
});

test('group and C2C use the conservative five-minute window and preserve numeric receivedAt', async () => {
  const h = harness();
  const group = h.adapter.createDelivery(groupMessage());
  h.timers.time = NOW + 4 * 60_000;
  const direct = h.adapter.createDelivery({ ...directMessage(), receivedAt: NOW });
  h.timers.time = NOW + 5 * 60_000 + 1;
  await assert.rejects(group.final('late'), /expired/);
  await assert.rejects(direct.final('late'), /expired/);
  assert.equal(bodies(h, '/messages').length, 0);
  await h.adapter.stop();
});

test('delivery serializes stream writes so final cannot overtake progress', async () => {
  const gate = deferred();
  let streamCalls = 0;
  const h = harness({
    fetchHandler: async (call) => {
      if (!new URL(call.url).pathname.endsWith('/stream_messages')) return undefined;
      streamCalls++;
      if (streamCalls === 1) await gate.promise;
      return response({ id: 'stream-serial' });
    },
  });
  const delivery = h.adapter.createDelivery(directMessage());
  const progress = delivery.progress('working');
  const final = delivery.final('finished');
  await flush();
  assert.equal(streamCalls, 1);
  gate.resolve();
  await Promise.all([progress, final]);
  assert.equal(streamCalls, 2);
  assert.deepEqual(bodies(h, '/stream_messages').map((call) => call.body.input_state), [1, 10]);
  await h.adapter.stop();
});

test('429/5xx ordinary send errors propagate without credentials or response bodies', async () => {
  for (const status of [429, 500]) {
    const h = harness({
      config: { c2cStream: false },
      fetchHandler: (call) => new URL(call.url).pathname.endsWith('/messages')
        ? response({ err_code: 50001, message: 'super-secret and token-1' }, status)
        : undefined,
    });
    const delivery = h.adapter.createDelivery(directMessage());
    await assert.rejects(delivery.notice('hello'), (error) => {
      assert.equal(error.status, status);
      assert.equal(error.code, 50001);
      assert.doesNotMatch(error.message, /super-secret|token-1|hello/);
      return true;
    });
    await h.adapter.stop();
  }
});

test('stop clears timers, closes the socket, disposes deliveries and prevents reconnect', async () => {
  const h = harness();
  const socket = await start(h);
  hello(socket);
  ready(socket);
  const delivery = h.adapter.createDelivery(directMessage());
  await h.adapter.stop();
  assert.equal(socket.readyState, 3);
  assert.equal(h.timers.tasks.size, 0);
  await delivery.final('not sent');
  await h.timers.advance(60_000);
  assert.equal(h.sockets.length, 1);
  assert.equal(bodies(h, '/messages').length, 0);
});
