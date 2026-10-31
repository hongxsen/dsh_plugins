import assert from 'node:assert/strict';
import test from 'node:test';

import { createFeishuAdapter } from '../lib/platforms/feishu.js';

function createHarness() {
  const calls = {
    clientConfigs: [],
    wsConfigs: [],
    start: [],
    reply: [],
    update: [],
    create: [],
    close: 0,
  };
  const controls = {
    startError: null,
    replyError: null,
    updateError: null,
    createError: null,
    connectionStatus: undefined,
  };
  const handlers = {};
  let nextId = 1;

  class Client {
    constructor(config) {
      calls.clientConfigs.push(config);
      this.im = {
        message: {
          reply: async (request) => {
            calls.reply.push(request);
            if (controls.replyError) throw controls.replyError;
            return { code: 0, data: { message_id: `sent-${nextId++}` } };
          },
          update: async (request) => {
            calls.update.push(request);
            if (controls.updateError) throw controls.updateError;
            return { code: 0, data: {} };
          },
          create: async (request) => {
            calls.create.push(request);
            if (controls.createError) throw controls.createError;
            return { code: 0, data: { message_id: `sent-${nextId++}` } };
          },
        },
      };
    }
  }

  class WSClient {
    constructor(config) {
      calls.wsConfigs.push(config);
    }

    async start(request) {
      calls.start.push(request);
      if (controls.startError) throw controls.startError;
    }

    async close() {
      calls.close += 1;
    }

    getConnectionStatus() {
      return controls.connectionStatus;
    }
  }

  class EventDispatcher {
    register(registrations) {
      Object.assign(handlers, registrations);
      return this;
    }
  }

  return {
    calls,
    controls,
    handlers,
    sdk: { Client, WSClient, EventDispatcher },
  };
}

function incoming(overrides = {}) {
  const message = {
    message_id: 'incoming-1',
    chat_id: 'chat-1',
    chat_type: 'p2p',
    message_type: 'text',
    content: JSON.stringify({ text: 'hello' }),
    ...overrides.message,
  };
  return {
    sender: {
      sender_type: 'user',
      sender_id: { open_id: 'open-1' },
      ...overrides.sender,
    },
    message,
  };
}

async function startHarness(t, overrides = {}) {
  const harness = createHarness();
  const messages = [];
  const errors = [];
  const readyStatuses = [];
  let ready = 0;
  let now = 1_000;
  const adapter = createFeishuAdapter(
    {
      id: 'work-feishu',
      appId: 'app-id',
      appSecret: 'app-secret',
      progressInterval: 0,
      maxProgress: 80,
      maxReplyChars: 3000,
      ...overrides.config,
    },
    {
      sdk: harness.sdk,
      now: () => now,
      ...overrides.options,
    },
  );
  const onMessage = overrides.onMessage ?? ((message) => {
    messages.push(message);
  });
  await adapter.start({
    onMessage,
    onError: (error) => errors.push(error),
    onReady: (status) => {
      ready += 1;
      readyStatuses.push(status);
    },
  });
  t.after(() => adapter.stop());
  return {
    ...harness,
    adapter,
    messages,
    errors,
    readyStatuses,
    setNow: (value) => {
      now = value;
    },
    ready: () => ready,
  };
}

function sentText(request) {
  return JSON.parse(request.data.content).text;
}

test('start waits for SDK onReady and routes constructor onError to runtime', async (t) => {
  const context = await startHarness(t);

  assert.deepEqual(context.calls.clientConfigs, [{ appId: 'app-id', appSecret: 'app-secret' }]);
  assert.equal(context.calls.wsConfigs.length, 1);
  const wsConfig = context.calls.wsConfigs[0];
  assert.equal(wsConfig.appId, 'app-id');
  assert.equal(wsConfig.appSecret, 'app-secret');
  assert.equal(typeof wsConfig.onReady, 'function');
  assert.equal(typeof wsConfig.onError, 'function');
  assert.equal(context.calls.start.length, 1);
  assert.equal(typeof context.handlers['im.message.receive_v1'], 'function');
  assert.equal(context.ready(), 0);
  assert.deepEqual(context.errors, []);

  await wsConfig.onReady();
  assert.equal(context.ready(), 1);
  assert.deepEqual(context.readyStatuses, [{ state: 'online' }]);

  const failure = new Error('fatal websocket failure');
  wsConfig.onError(failure);
  assert.deepEqual(context.errors, [failure]);
});

test('getStatus prefers SDK status and falls back to running or idle', async (t) => {
  const context = await startHarness(t);
  assert.deepEqual(context.adapter.getStatus(), { state: 'running' });

  const status = { state: 'connected', reconnectAttempts: 0 };
  context.controls.connectionStatus = status;
  assert.deepEqual(context.adapter.getStatus(), status);

  await context.adapter.stop();
  assert.deepEqual(context.adapter.getStatus(), { state: 'idle' });
});

test('factory injection supplies SDK objects without constructing an SDK', async (t) => {
  const harness = createHarness();
  const client = new harness.sdk.Client({});
  const wsClient = new harness.sdk.WSClient({});
  const eventDispatcher = new harness.sdk.EventDispatcher();
  const adapter = createFeishuAdapter(
    { id: 'factory', appId: 'id', appSecret: 'secret' },
    {
      factory: {
        createClient: (config) => {
          assert.equal(config.id, 'factory');
          return client;
        },
        createWSClient: () => wsClient,
        createEventDispatcher: () => eventDispatcher,
      },
    },
  );

  await adapter.start({ onMessage() {} });
  assert.equal(harness.calls.start.length, 1);
  await adapter.stop();
  assert.equal(harness.calls.close, 1);
});

test('custom Lark domain is forwarded to both official SDK clients', async (t) => {
  const context = await startHarness(t, { config: { domain: 'https://open.larksuite.com' } });
  assert.equal(context.calls.clientConfigs[0].domain, 'https://open.larksuite.com');
  assert.equal(context.calls.wsConfigs[0].domain, 'https://open.larksuite.com');
});

test('text events normalize IDs and timestamps, deduplicate message_id, and ignore bots', async (t) => {
  const context = await startHarness(t);
  const receive = context.handlers['im.message.receive_v1'];

  receive(incoming());
  receive(incoming());
  receive(incoming({
    message: { message_id: 'incoming-bot' },
    sender: { sender_type: 'bot', sender_id: { open_id: 'bot-open' } },
  }));
  receive(incoming({ message: { message_id: 'incoming-2', chat_type: 'group' } }));

  assert.equal(context.messages.length, 2);
  assert.deepEqual(context.messages[0], {
    connectionId: 'work-feishu',
    platform: 'feishu',
    eventId: 'incoming-1',
    chatId: 'chat-1',
    userId: 'open-1',
    chatType: 'direct',
    text: 'hello',
    receivedAt: 1_000,
    replyContext: {
      messageId: 'incoming-1',
      chatId: 'chat-1',
      openId: 'open-1',
    },
  });
  assert.equal(context.messages[1].chatType, 'group');
});

test('post parsing prefers content_v2, preserves paragraphs, and explains unsupported media', async (t) => {
  const context = await startHarness(t);
  const receive = context.handlers['im.message.receive_v1'];

  receive(incoming({
    message: {
      message_id: 'post-1',
      message_type: 'post',
      content: JSON.stringify({
        title: 'Title',
        content: [[{ tag: 'text', text: 'old version' }]],
        content_v2: [
          [{ tag: 'text', text: 'first ' }, { tag: 'a', text: 'link', href: 'https://example.com' }],
          [{ tag: 'at', text: '@Ada' }, { tag: 'img', image_key: 'secret-image-key' }],
        ],
      }),
    },
  }));
  receive(incoming({ message: { message_id: 'image-1', message_type: 'image', content: '{}' } }));

  assert.equal(context.messages[0].text, 'Title\nfirst link\n@Ada[图片]');
  assert.match(context.messages[1].text, /暂不支持飞书 image 消息/);
});

test('event handler enqueues quickly and routes asynchronous handler failures to onError', async (t) => {
  let resolveMessage;
  const pending = new Promise((resolve) => {
    resolveMessage = resolve;
  });
  let received;
  const context = await startHarness(t, {
    onMessage: (message) => {
      received = message;
      return pending;
    },
  });

  const result = context.handlers['im.message.receive_v1'](incoming());
  assert.equal(result, undefined);
  assert.equal(received.eventId, 'incoming-1');
  assert.equal(context.errors.length, 0);
  resolveMessage();
  await pending;

  const failure = new Error('enqueue failed');
  const failing = await startHarness(t, { onMessage: () => Promise.reject(failure) });
  failing.handlers['im.message.receive_v1'](incoming());
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(failing.errors, [failure]);
});

test('delivery replies first, then updates only its own sent message IDs', async (t) => {
  const context = await startHarness(t);
  context.handlers['im.message.receive_v1'](incoming());
  const delivery = context.adapter.createDelivery(context.messages[0]);

  await delivery.ack('working');
  await delivery.progress('half');
  await delivery.final('done');

  assert.deepEqual(context.calls.reply, [{
    path: { message_id: 'incoming-1' },
    data: { msg_type: 'text', content: JSON.stringify({ text: 'working' }) },
  }]);
  assert.deepEqual(context.calls.update.map((request) => request.path.message_id), ['sent-1', 'sent-1']);
  assert.deepEqual(context.calls.update.map(sentText), ['half', 'done']);
  assert.ok(context.calls.update.every((request) => request.data.msg_type === 'text'));
  assert.equal(context.calls.create.length, 0);
  assert.ok(context.calls.update.every((request) => request.path.message_id !== 'incoming-1'));
});

test('progress is throttled while final always delivers the latest text', async (t) => {
  const context = await startHarness(t, { config: { progressInterval: 1500 } });
  context.handlers['im.message.receive_v1'](incoming());
  const delivery = context.adapter.createDelivery(context.messages[0]);

  await delivery.ack('working');
  await delivery.progress('too early');
  context.setNow(2_500);
  await delivery.progress('current');
  await delivery.final('final now');

  assert.deepEqual(context.calls.update.map(sentText), ['current', 'final now']);
});

test('canonical stream config controls throttling and update overflow', async (t) => {
  const context = await startHarness(t, {
    config: { streamIntervalMs: 1500, maxStreamUpdates: 1 },
  });
  context.handlers['im.message.receive_v1'](incoming());
  const delivery = context.adapter.createDelivery(context.messages[0]);

  await delivery.ack('working');
  await delivery.progress('too early');
  context.setNow(2_500);
  await delivery.progress('one update');
  context.setNow(4_000);
  await delivery.progress('replacement');
  await delivery.final('finished');

  assert.deepEqual(context.calls.update.map(sentText), ['one update', 'finished']);
  assert.deepEqual(context.calls.update.map((request) => request.path.message_id), [
    'sent-1', 'sent-2',
  ]);
  assert.deepEqual(context.calls.create.map(sentText), ['replacement']);
});

test('long final text overflows to chat create and retains every sent ID for updates', async (t) => {
  const context = await startHarness(t, { config: { maxReplyChars: 4 } });
  context.handlers['im.message.receive_v1'](incoming());
  const delivery = context.adapter.createDelivery(context.messages[0]);

  await delivery.ack('old');
  await delivery.final('abcdefghij');
  await delivery.final('ABCDEFGHIJ');

  assert.deepEqual({
    id: context.calls.update[0].path.message_id,
    text: sentText(context.calls.update[0]),
  }, { id: 'sent-1', text: 'abcd' });
  assert.deepEqual(context.calls.create.slice(0, 2).map((request) => ({
    receiveId: request.data.receive_id,
    receiveIdType: request.params.receive_id_type,
    text: sentText(request),
  })), [
    { receiveId: 'chat-1', receiveIdType: 'chat_id', text: 'efgh' },
    { receiveId: 'chat-1', receiveIdType: 'chat_id', text: 'ij' },
  ]);
  assert.deepEqual(context.calls.update.slice(1).map((request) => request.path.message_id), [
    'sent-1', 'sent-2', 'sent-3',
  ]);
  assert.equal(
    [sentText(context.calls.update[0]), ...context.calls.create.slice(0, 2).map(sentText)].join(''),
    'abcdefghij',
  );
});

test('reaching the update limit creates a replacement and final updates that replacement', async (t) => {
  const context = await startHarness(t, { config: { maxProgress: 1 } });
  context.handlers['im.message.receive_v1'](incoming());
  const delivery = context.adapter.createDelivery(context.messages[0]);

  await delivery.ack('working');
  await delivery.progress('one update');
  await delivery.progress('replacement');
  await delivery.final('finished');

  assert.deepEqual(context.calls.update.map((request) => request.path.message_id), [
    'sent-1', 'sent-2',
  ]);
  assert.equal(context.calls.create.length, 1);
  assert.equal(sentText(context.calls.create[0]), 'replacement');
  assert.equal(sentText(context.calls.update.at(-1)), 'finished');
});

test('Feishu never exceeds the official 20 edits per message', async (t) => {
  const context = await startHarness(t, { config: { maxStreamUpdates: 80 } });
  context.handlers['im.message.receive_v1'](incoming());
  const delivery = context.adapter.createDelivery(context.messages[0]);

  await delivery.ack('working');
  for (let index = 1; index <= 21; index += 1) await delivery.progress(`update ${index}`);

  assert.equal(context.calls.update.length, 20);
  assert.ok(context.calls.update.every((request) => request.path.message_id === 'sent-1'));
  assert.equal(context.calls.create.length, 1);
  assert.equal(sentText(context.calls.create[0]), 'update 21');
});

test('core-style final parts and notices share one ordered write chain', async (t) => {
  const context = await startHarness(t, { config: { maxReplyChars: 20 } });
  context.handlers['im.message.receive_v1'](incoming());
  const delivery = context.adapter.createDelivery(context.messages[0]);

  const first = delivery.final('final part');
  const second = delivery.notice('overflow one');
  const third = delivery.notice('overflow two');
  await Promise.all([first, second, third]);

  assert.equal(sentText(context.calls.reply[0]), 'final part');
  assert.deepEqual(context.calls.create.map(sentText), ['overflow one', 'overflow two']);
  assert.equal(context.calls.update.length, 0);
});

test('notice creates a separate chat message and send errors reach the caller', async (t) => {
  const context = await startHarness(t);
  context.handlers['im.message.receive_v1'](incoming());
  const delivery = context.adapter.createDelivery(context.messages[0]);

  await delivery.notice('queue full');
  assert.equal(context.calls.reply.length, 0);
  assert.equal(context.calls.create.length, 1);
  assert.equal(context.calls.create[0].data.receive_id, 'chat-1');

  const failure = new Error('upload failed');
  context.controls.replyError = failure;
  await assert.rejects(delivery.ack('cannot send'), /upload failed/);
});

test('stop closes the websocket, disposes deliveries, and ignores later work', async (t) => {
  const context = await startHarness(t);
  context.handlers['im.message.receive_v1'](incoming());
  const delivery = context.adapter.createDelivery(context.messages[0]);
  await delivery.ack('working');

  await context.adapter.stop();
  await context.adapter.stop();
  await delivery.progress('must not send');
  await delivery.dispose();
  context.handlers['im.message.receive_v1'](incoming({ message: { message_id: 'after-stop' } }));

  assert.equal(context.calls.close, 1);
  assert.equal(context.calls.update.length, 0);
  assert.equal(context.messages.length, 1);
});

test('stop during asynchronous SDK loading never starts a late websocket', async () => {
  let finishLoading;
  let starts = 0;
  const loading = new Promise((resolve) => { finishLoading = resolve; });
  const adapter = createFeishuAdapter(
    { id: 'slow', appId: 'id', appSecret: 'secret' },
    { factory: () => loading },
  );

  const starting = adapter.start({});
  await adapter.stop();
  finishLoading({
    client: {},
    wsClient: { async start() { starts += 1; }, async close() {} },
    eventDispatcher: { register() {} },
  });
  await starting;
  assert.equal(starts, 0);
  assert.deepEqual(adapter.getStatus(), { state: 'idle' });
});

test('stop during asynchronous SDK start closes the late socket', async () => {
  let finishStart;
  let closes = 0;
  const objects = {
    client: {},
    wsClient: {
      start: () => new Promise((resolve) => { finishStart = resolve; }),
      async close() { closes += 1; },
    },
    eventDispatcher: { register() {} },
  };
  const adapter = createFeishuAdapter(
    { id: 'slow-start', appId: 'id', appSecret: 'secret' },
    { factory: async () => objects },
  );

  const starting = adapter.start({});
  while (!finishStart) await new Promise((resolve) => setImmediate(resolve));
  const stopping = adapter.stop();
  finishStart();
  await Promise.all([starting, stopping]);
  assert.equal(closes, 2, 'stop and late-start cleanup both close the socket');
  assert.deepEqual(adapter.getStatus(), { state: 'idle' });
});

test('startup failures are reported and rethrown for connection isolation', async () => {
  const harness = createHarness();
  const failure = new Error('websocket unavailable');
  harness.controls.startError = failure;
  const errors = [];
  const adapter = createFeishuAdapter(
    { id: 'broken', appId: 'id', appSecret: 'secret' },
    { sdk: harness.sdk },
  );

  await assert.rejects(
    adapter.start({ onMessage() {}, onError: (error) => errors.push(error) }),
    /websocket unavailable/,
  );
  assert.deepEqual(errors, [failure]);
  await adapter.stop();
});
