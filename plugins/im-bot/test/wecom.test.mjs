import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import http from 'node:http'
import test from 'node:test'
import {
  WeComClient,
  createWeComAdapter,
  generateReqId,
  normalizeWeComMessage,
} from '../lib/platforms/wecom.js'
import { NodeWebSocket } from '../lib/transport.js'

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(predicate, { timeout = 3000, interval = 5 } = {}) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (predicate()) return
    await sleep(interval)
  }
  throw new Error('waitFor timeout')
}

function makeConfig(overrides = {}) {
  return {
    connectionId: 'work-wecom',
    botId: 'bot-123',
    secret: 'secret-456',
    wsUrl: 'wss://openws.work.weixin.qq.com',
    reconnectInitialMs: 10,
    reconnectMaxMs: 20,
    heartbeatIntervalMs: 40,
    requestTimeoutMs: 300,
    maxReplyChars: 3000,
    ...overrides,
  }
}

class FakeSocket {
  constructor(url) {
    this.url = url
    this.sent = []
    this.handlers = new Map()
    this.closed = false
  }

  addEventListener(type, handler) {
    if (!this.handlers.has(type)) this.handlers.set(type, [])
    this.handlers.get(type).push(handler)
  }

  emit(type, event) {
    for (const handler of this.handlers.get(type) ?? []) handler(event)
  }

  send(data) {
    this.sent.push(JSON.parse(data))
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.emit('close', { code: 1000, reason: 'test-close' })
  }

  open() {
    this.emit('open', {})
  }

  message(frame) {
    this.emit('message', { data: JSON.stringify(frame) })
  }

  frames(cmd) {
    return this.sent.filter((frame) => frame.cmd === cmd)
  }

  acknowledge(frame, errcode = 0) {
    this.message({ headers: { req_id: frame.headers.req_id }, errcode, errmsg: errcode === 0 ? 'ok' : 'failed' })
  }
}

function makeClientHarness(overrides = {}) {
  const config = makeConfig(overrides)
  const sockets = []
  const client = new WeComClient({
    config,
    logger: silentLogger,
    webSocketFactory: (url) => {
      const socket = new FakeSocket(url)
      sockets.push(socket)
      return socket
    },
  })
  return { client, config, sockets }
}

async function onlineClient(overrides) {
  const harness = makeClientHarness(overrides)
  harness.client.start()
  await waitFor(() => harness.sockets.length === 1)
  const socket = harness.sockets[0]
  socket.open()
  await waitFor(() => socket.frames('aibot_subscribe').length === 1)
  socket.acknowledge(socket.frames('aibot_subscribe')[0])
  await waitFor(() => harness.client.connected)
  return { ...harness, socket }
}

async function onlineAdapter(overrides = {}) {
  const sockets = []
  const messages = []
  const errors = []
  const ready = []
  const adapter = createWeComAdapter(makeConfig(overrides), {
    logger: silentLogger,
    webSocketFactory: (url) => {
      const socket = new FakeSocket(url)
      sockets.push(socket)
      return socket
    },
  })
  await adapter.start({
    onMessage: (message) => messages.push(message),
    onError: (error) => errors.push(error),
    onReady: (status) => ready.push(status),
  })
  await waitFor(() => sockets.length === 1)
  const socket = sockets[0]
  socket.open()
  await waitFor(() => socket.frames('aibot_subscribe').length === 1)
  socket.acknowledge(socket.frames('aibot_subscribe')[0])
  await waitFor(() => ready.length === 1)
  return { adapter, socket, sockets, messages, errors, ready }
}

let frameSequence = 0
function makeFrame({ text = 'hello', userid = 'u1', chattype = 'single', chatid, msgid, msgtype = 'text' } = {}) {
  frameSequence += 1
  return {
    cmd: 'aibot_msg_callback',
    headers: { req_id: `cb-${frameSequence}` },
    body: {
      msgid: msgid ?? `msg-${frameSequence}`,
      chattype,
      from: { userid },
      ...(chatid === undefined ? {} : { chatid }),
      msgtype,
      ...(msgtype === 'text' ? { text: { content: text } } : {}),
      ...(msgtype === 'markdown' ? { markdown: { content: text } } : {}),
    },
  }
}

// ---------------------------------------------------------------- protocol

test('generateReqId keeps the documented prefix shape', () => {
  const id = generateReqId('aibot_send_msg')
  assert.match(id, /^aibot_send_msg_\d+_[0-9a-f]{8}$/)
  assert.notEqual(id, generateReqId('aibot_send_msg'))
})

test('aibot_subscribe authenticates with bot_id and secret', async () => {
  const { client, socket } = await onlineClient()
  const subscribe = socket.frames('aibot_subscribe')[0]
  assert.equal(subscribe.body.bot_id, 'bot-123')
  assert.equal(subscribe.body.secret, 'secret-456')
  assert.equal(socket.url, 'wss://openws.work.weixin.qq.com')
  assert.equal(client.status.state, 'online')
  assert.equal(client.status.authenticated, true)
  await client.stop()
})

test('req_id acknowledgements dispatch callbacks and resolve only their own request', async () => {
  const { client, socket } = await onlineClient()
  const seen = []
  const unsubscribe = client.onMessage((frame) => seen.push(frame.body.text.content))
  const first = client.replyStream('cb-1', 'stream-1', 'hello', false)
  const second = client.replyStream('cb-1', 'stream-1', 'done', true)

  await waitFor(() => socket.frames('aibot_respond_msg').length === 1)
  const frames = socket.frames('aibot_respond_msg')
  assert.deepEqual(frames[0].headers, { req_id: 'cb-1' })
  assert.deepEqual(frames[0].body, {
    msgtype: 'stream',
    stream: { id: 'stream-1', finish: false, content: 'hello' },
  })
  assert.equal(socket.frames('aibot_respond_msg').length, 1, 'the second frame waits for the first ack')

  socket.message({ cmd: 'aibot_msg_callback', headers: { req_id: 'incoming' }, body: { text: { content: 'hi' } } })
  socket.acknowledge(frames[0])
  await first
  await waitFor(() => socket.frames('aibot_respond_msg').length === 2)
  assert.equal(socket.frames('aibot_respond_msg')[1].body.stream.finish, true)
  socket.acknowledge(socket.frames('aibot_respond_msg')[1])
  assert.equal((await second).errcode, 0)
  assert.deepEqual(seen, ['hi'])

  unsubscribe()
  socket.message({ cmd: 'aibot_msg_callback', headers: { req_id: 'cb-2' }, body: { text: { content: 'again' } } })
  await sleep(20)
  assert.deepEqual(seen, ['hi'])
  await client.stop()
})

test('proactive markdown carries chatid and offline replies fail fast', async () => {
  const { client, socket } = await onlineClient()
  const pending = client.sendMarkdown('user-9', '**done**')
  await waitFor(() => socket.frames('aibot_send_msg').length === 1)
  const frame = socket.frames('aibot_send_msg')[0]
  assert.equal(frame.body.chatid, 'user-9')
  assert.equal(frame.body.msgtype, 'markdown')
  assert.equal(frame.body.markdown.content, '**done**')
  socket.acknowledge(frame)
  await pending
  await client.stop()

  const offline = makeClientHarness()
  assert.equal((await offline.client.replyStream('cb', 'stream', 'x', true)).error, 'not-connected')
})

test('acknowledged heartbeats keep the connection alive', async () => {
  const { client, socket } = await onlineClient()
  await waitFor(() => socket.frames('ping').length >= 1)
  for (const ping of socket.frames('ping')) socket.acknowledge(ping)
  await sleep(60)
  assert.equal(client.connected, true)
  await client.stop()
})

test('three unacknowledged heartbeats close the socket and reconnect', async () => {
  const { client, socket, sockets } = await onlineClient({ heartbeatIntervalMs: 20 })
  await waitFor(() => socket.closed)
  assert.match(client.status.detail, /心跳超时|连接关闭/)
  await waitFor(() => sockets.length === 2)
  assert.equal(client.status.reconnects, 1)
  await client.stop()
})

test('close reconnects with backoff and authenticates the replacement socket', async () => {
  const { client, sockets } = await onlineClient()
  sockets[0].close()
  await waitFor(() => sockets.length === 2)
  sockets[1].open()
  await waitFor(() => sockets[1].frames('aibot_subscribe').length === 1)
  sockets[1].acknowledge(sockets[1].frames('aibot_subscribe')[0])
  await waitFor(() => client.connected)
  assert.equal(client.status.reconnects, 1)
  await client.stop()
})

test('authentication rejection and disconnected_event permanently stop reconnecting', async () => {
  const rejected = makeClientHarness()
  rejected.client.start()
  await waitFor(() => rejected.sockets.length === 1)
  const socket = rejected.sockets[0]
  socket.open()
  await waitFor(() => socket.frames('aibot_subscribe').length === 1)
  socket.acknowledge(socket.frames('aibot_subscribe')[0], 40001)
  await waitFor(() => rejected.client.status.state === 'stopped')
  await sleep(80)
  assert.equal(rejected.sockets.length, 1)
  assert.equal(rejected.client.connected, false)
  assert.match(rejected.client.status.detail, /认证失败/)

  const displaced = await onlineClient()
  displaced.socket.message({
    cmd: 'aibot_event_callback',
    headers: { req_id: 'ev-1' },
    body: { event: { eventtype: 'disconnected_event' } },
  })
  await waitFor(() => displaced.client.status.state === 'stopped')
  await sleep(60)
  assert.equal(displaced.sockets.length, 1)
  assert.equal(displaced.client.connected, false)
})

test('stop closes the socket and prevents further reconnects', async () => {
  const { client, socket, sockets } = await onlineClient()
  await client.stop()
  assert.equal(socket.closed, true)
  await sleep(80)
  assert.equal(sockets.length, 1)
  assert.equal(client.status.state, 'stopped')
})

// ------------------------------------------------------- normalized adapter

test('normalizeWeComMessage maps direct text to the shared message contract', () => {
  const before = Date.now()
  const message = normalizeWeComMessage(makeFrame({ text: '  跑一下测试  ' }), 'work-wecom')
  assert.deepEqual({ ...message, receivedAt: 0 }, {
    connectionId: 'work-wecom',
    platform: 'wecom',
    eventId: 'msg-1',
    chatId: 'u1',
    userId: 'u1',
    chatType: 'direct',
    text: '跑一下测试',
    receivedAt: 0,
    replyContext: { reqId: 'cb-1', chatId: 'u1' },
  })
  assert.ok(message.receivedAt >= before && message.receivedAt <= Date.now())
})

test('group markdown uses the native chatid and keeps the sender id', () => {
  const message = normalizeWeComMessage(makeFrame({
    text: ' **markdown** ',
    userid: 'alice',
    chattype: 'group',
    chatid: 'chat-9',
    msgtype: 'markdown',
  }), 'work-wecom')
  assert.equal(message.chatId, 'chat-9')
  assert.equal(message.userId, 'alice')
  assert.equal(message.chatType, 'group')
  assert.equal(message.text, '**markdown**')
  assert.deepEqual(message.replyContext, { reqId: 'cb-2', chatId: 'chat-9' })
})

test('voice, mixed text and quotes retain their readable text', () => {
  const voice = normalizeWeComMessage({
    headers: { req_id: 'voice-req' },
    body: { msgid: 'voice-1', chattype: 'single', from: { userid: 'u1' }, msgtype: 'voice', voice: { content: '转写文字' } },
  }, 'work-wecom')
  assert.equal(voice.text, '转写文字')

  const mixed = normalizeWeComMessage({
    headers: { req_id: 'mixed-req' },
    body: {
      msgid: 'mixed-1',
      chattype: 'single',
      from: { userid: 'u1' },
      msgtype: 'mixed',
      mixed: { msg_item: [{ msgtype: 'text', text: { content: '第一段' } }, { msgtype: 'text', text: { content: '第二段' } }] },
      quote: { text: { content: '前文' } },
    },
  }, 'work-wecom')
  assert.equal(mixed.text, '[引用] 前文\n第一段\n第二段')
})

test('malformed callbacks are ignored instead of reaching the shared core', async () => {
  const { adapter, socket, messages } = await onlineAdapter()
  socket.message({ cmd: 'aibot_msg_callback', headers: {}, body: makeFrame().body })
  socket.message({ cmd: 'aibot_msg_callback', headers: { req_id: 'bad-json' }, body: null })
  socket.emit('message', { data: '{not json' })
  await sleep(20)
  assert.deepEqual(messages, [])
  await adapter.stop()
})

test('adapter emits normalized messages and onReady only after subscribe ack', async () => {
  const { adapter, socket, messages, ready } = await onlineAdapter()
  assert.equal(adapter.type, 'wecom')
  assert.equal(ready[0].authenticated, true)
  socket.message(makeFrame({ text: '标准化输入' }))
  await waitFor(() => messages.length === 1)
  assert.equal(messages[0].connectionId, 'work-wecom')
  assert.equal(messages[0].platform, 'wecom')
  assert.equal(messages[0].text, '标准化输入')
  await adapter.stop()
})

// --------------------------------------------------------------- delivery

test('delivery serializes ack, progress and final on one req_id and stream id', async () => {
  const { adapter, socket, messages } = await onlineAdapter()
  socket.message(makeFrame({ text: '流式任务' }))
  await waitFor(() => messages.length === 1)
  const delivery = adapter.createDelivery(messages[0])
  const ack = delivery.ack('收到')
  const progress = delivery.progress('处理中')
  const final = delivery.final('完成')
  const notice = delivery.notice('终稿后的补充')

  await waitFor(() => socket.frames('aibot_respond_msg').length === 1)
  const first = socket.frames('aibot_respond_msg')[0]
  assert.equal(first.body.stream.content, '收到')
  assert.equal(first.body.stream.finish, false)
  socket.acknowledge(first)
  await ack

  await waitFor(() => socket.frames('aibot_respond_msg').length === 2)
  const second = socket.frames('aibot_respond_msg')[1]
  assert.equal(second.body.stream.id, first.body.stream.id)
  assert.equal(second.body.stream.content, '处理中')
  socket.acknowledge(second)
  await progress

  await waitFor(() => socket.frames('aibot_respond_msg').length === 3)
  const third = socket.frames('aibot_respond_msg')[2]
  assert.equal(third.headers.req_id, first.headers.req_id)
  assert.equal(third.body.stream.id, first.body.stream.id)
  assert.equal(third.body.stream.content, '完成')
  assert.equal(third.body.stream.finish, true)
  assert.equal(socket.frames('aibot_send_msg').length, 0, 'notice waits for the final acknowledgement')
  socket.acknowledge(third)
  await final

  await waitFor(() => socket.frames('aibot_send_msg').length === 1)
  const fourth = socket.frames('aibot_send_msg')[0]
  assert.equal(fourth.body.chatid, 'u1')
  assert.equal(fourth.body.markdown.content, '终稿后的补充')
  socket.acknowledge(fourth)
  await notice
  await delivery.dispose()
  await adapter.stop()
})

test('final finishes the first part before sending ordered proactive overflow parts', async () => {
  const { adapter, socket, messages } = await onlineAdapter({ maxReplyChars: 64 })
  socket.message(makeFrame({ text: '长回复', chattype: 'group', chatid: 'chat-overflow' }))
  await waitFor(() => messages.length === 1)
  const delivery = adapter.createDelivery(messages[0])
  const pending = delivery.final('x'.repeat(150))

  await waitFor(() => socket.frames('aibot_respond_msg').length === 1)
  const final = socket.frames('aibot_respond_msg')[0]
  assert.equal(final.body.stream.finish, true)
  assert.equal(final.body.stream.content.length, 64)
  assert.equal(socket.frames('aibot_send_msg').length, 0)
  socket.acknowledge(final)

  await waitFor(() => socket.frames('aibot_send_msg').length === 1)
  const overflow1 = socket.frames('aibot_send_msg')[0]
  assert.equal(overflow1.body.chatid, 'chat-overflow')
  assert.equal(overflow1.body.markdown.content.length, 64)
  socket.acknowledge(overflow1)

  await waitFor(() => socket.frames('aibot_send_msg').length === 2)
  const overflow2 = socket.frames('aibot_send_msg')[1]
  assert.equal(overflow2.body.markdown.content.length, 22)
  socket.acknowledge(overflow2)
  await pending
  assert.equal(final.body.stream.content + overflow1.body.markdown.content + overflow2.body.markdown.content, 'x'.repeat(150))
  await adapter.stop()
})

test('notice uses proactive markdown and platform acknowledgements surface failures', async () => {
  const { adapter, socket, messages } = await onlineAdapter()
  socket.message(makeFrame({ text: '通知' }))
  await waitFor(() => messages.length === 1)
  const delivery = adapter.createDelivery(messages[0])
  const notice = delivery.notice('补充说明')
  await waitFor(() => socket.frames('aibot_send_msg').length === 1)
  socket.acknowledge(socket.frames('aibot_send_msg')[0])
  await notice

  const failed = delivery.progress('不会成功')
  await waitFor(() => socket.frames('aibot_respond_msg').length === 1)
  socket.acknowledge(socket.frames('aibot_respond_msg')[0], 40001)
  await assert.rejects(failed, /40001/)
  await adapter.stop()
})

// -------------------------------------------------------------- transport

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

function encode(opcode, payload, fin = true) {
  const body = Buffer.from(payload)
  const first = (fin ? 0x80 : 0) | opcode
  let header
  if (body.length < 126) {
    header = Buffer.from([first, body.length])
  } else if (body.length < 65536) {
    header = Buffer.alloc(4)
    header[0] = first
    header[1] = 126
    header.writeUInt16BE(body.length, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = first
    header[1] = 127
    header.writeBigUInt64BE(BigInt(body.length), 2)
  }
  return Buffer.concat([header, body])
}

function decode(buffer) {
  if (buffer.length < 2) return undefined
  const opcode = buffer[0] & 0x0f
  const masked = (buffer[1] & 0x80) !== 0
  let length = buffer[1] & 0x7f
  let offset = 2
  if (length === 126) {
    if (buffer.length < 4) return undefined
    length = buffer.readUInt16BE(2)
    offset = 4
  } else if (length === 127) {
    if (buffer.length < 10) return undefined
    length = Number(buffer.readBigUInt64BE(2))
    offset = 10
  }
  const maskLength = masked ? 4 : 0
  if (buffer.length < offset + maskLength + length) return undefined
  const mask = masked ? buffer.subarray(offset, offset + 4) : undefined
  offset += maskLength
  const payload = Buffer.from(buffer.subarray(offset, offset + length))
  if (mask !== undefined) {
    for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index & 3]
  }
  return { opcode, payload, consumed: offset + length }
}

async function startServer(onSocket) {
  const connections = []
  const server = http.createServer((request, response) => {
    response.writeHead(403, { 'content-type': 'text/plain' })
    response.end('upgrade required')
  })
  server.on('upgrade', (request, socket) => {
    const accept = createHash('sha1').update(request.headers['sec-websocket-key'] + GUID).digest('base64')
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
    const state = { buffer: Buffer.alloc(0), texts: [], pongs: [], closeCode: undefined }
    const api = {
      sendText: (text, fin = true) => socket.write(encode(0x1, text, fin)),
      sendContinuation: (text, fin = true) => socket.write(encode(0x0, text, fin)),
      sendPing: (payload = 'p') => socket.write(encode(0x9, payload)),
    }
    socket.on('data', (chunk) => {
      state.buffer = Buffer.concat([state.buffer, chunk])
      for (;;) {
        const frame = decode(state.buffer)
        if (frame === undefined) return
        state.buffer = state.buffer.subarray(frame.consumed)
        if (frame.opcode === 0x1) state.texts.push(frame.payload.toString('utf8'))
        else if (frame.opcode === 0x9) state.pongs.push(`ping:${frame.payload.toString('utf8')}`)
        else if (frame.opcode === 0xa) state.pongs.push(`pong:${frame.payload.toString('utf8')}`)
        else if (frame.opcode === 0x8) {
          state.closeCode = frame.payload.length >= 2 ? frame.payload.readUInt16BE(0) : 1005
          socket.end()
        }
      }
    })
    connections.push({ socket, state })
    onSocket?.(socket, api, state)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { server, port: server.address().port, connections }
}

test('NodeWebSocket upgrades, sends masked text and receives text', async (t) => {
  const { server, port, connections } = await startServer()
  t.after(() => server.close())
  const ws = new NodeWebSocket(`ws://127.0.0.1:${port}`)
  const messages = []
  let opened = false
  ws.addEventListener('open', () => { opened = true })
  ws.addEventListener('message', (event) => messages.push(event.data))
  await waitFor(() => opened && connections.length === 1)
  assert.equal(ws.readyState, 1)
  ws.send('hello')
  await waitFor(() => connections[0].state.texts.length === 1)
  assert.deepEqual(connections[0].state.texts, ['hello'])
  connections[0].socket.write(encode(0x1, 'echo:hello'))
  await waitFor(() => messages.length === 1)
  assert.deepEqual(messages, ['echo:hello'])
  ws.close()
})

test('NodeWebSocket reassembles fragmented messages and answers pings', async (t) => {
  const { server, port, connections } = await startServer((socket, api) => {
    setTimeout(() => {
      api.sendText('hel', false)
      api.sendContinuation('lo', true)
      api.sendPing('abc')
    }, 20)
  })
  t.after(() => server.close())
  const ws = new NodeWebSocket(`ws://127.0.0.1:${port}`)
  const messages = []
  ws.addEventListener('message', (event) => messages.push(event.data))
  await waitFor(() => messages.length === 1)
  assert.deepEqual(messages, ['hello'])
  await waitFor(() => connections[0].state.pongs.includes('pong:abc'))
  ws.close()
})

test('NodeWebSocket surfaces rejected upgrades and sends no data afterwards', async (t) => {
  const server = http.createServer((request, response) => {
    response.writeHead(403, { 'content-type': 'text/plain' })
    response.end('nope')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const ws = new NodeWebSocket(`ws://127.0.0.1:${server.address().port}`)
  const events = []
  ws.addEventListener('error', (event) => events.push(`error:${event.message}`))
  ws.addEventListener('close', (event) => events.push(`close:${event.code}`))
  await waitFor(() => events.length === 2)
  assert.match(events[0], /error:WebSocket upgrade rejected \(HTTP 403\)/)
  assert.equal(events[1], 'close:1006')
  assert.throws(() => ws.send('x'), /not open/)
})

test('NodeWebSocket emits a server close once and preserves its code', async (t) => {
  const { server, port, connections } = await startServer((socket) => {
    setTimeout(() => socket.write(encode(0x8, Buffer.from([0x03, 0xe8]))), 20)
  })
  t.after(() => server.close())
  const ws = new NodeWebSocket(`ws://127.0.0.1:${port}`)
  const closes = []
  ws.addEventListener('close', (event) => closes.push(event.code))
  await waitFor(() => closes.length === 1)
  assert.deepEqual(closes, [1000])
  await sleep(30)
  assert.equal(connections[0].state.closeCode, 1000)
})

test('NodeWebSocket close sends a close frame and emits only once', async (t) => {
  const { server, port, connections } = await startServer()
  t.after(() => server.close())
  const ws = new NodeWebSocket(`ws://127.0.0.1:${port}`)
  const closes = []
  ws.addEventListener('close', (event) => closes.push(event.code))
  await waitFor(() => ws.readyState === 1)
  ws.close(1000, 'bye')
  await waitFor(() => closes.length === 1)
  await waitFor(() => connections[0].state.closeCode === 1000)
  await sleep(50)
  assert.equal(closes.length, 1)
})
