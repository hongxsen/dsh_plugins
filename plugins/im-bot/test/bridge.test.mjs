import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ConversationBridge } from '../lib/bridge.js'
import { normalizeConnection } from '../lib/config.js'
import { ChatStore } from '../lib/store.js'
import { conversationKey } from '../lib/text.js'

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

class FakeDelivery {
  calls = []
  writing = Promise.resolve()
  disposed = false

  constructor(message) {
    this.message = message
  }

  #send(method, text) {
    const call = { method, text }
    this.calls.push(call)
    this.writing = this.writing.then(async () => {
      await sleep(1)
      call.settled = true
    })
    return this.writing
  }

  ack(text) { return this.#send('ack', text) }
  progress(text) { return this.#send('progress', text) }
  final(text) { return this.#send('final', text) }
  notice(text) { return this.#send('notice', text) }

  async dispose() {
    await this.writing
    this.disposed = true
    this.calls.push({ method: 'dispose' })
  }

  finals() { return this.calls.filter((call) => call.method === 'final') }
  notices() { return this.calls.filter((call) => call.method === 'notice') }
}

class FakeSession {
  constructor(id, api) {
    this.id = id
    this.log = []
    if (api === 'eventAt') this.eventAt = (index) => this.log[index]
    else Object.defineProperty(this, 'events', { get: () => Object.freeze([...this.log]) })
  }

  get seq() { return this.log.length }
  push(type, data) { this.log.push({ seq: this.log.length, type, data }) }
}

class FakeAgent {
  constructor(id, options = {}) {
    this.id = id
    this.session = new FakeSession(id, options.sessionApi)
    this.inbox = []
    this.cancelCalls = []
    this.options = options
    this.turn = 0
  }

  push(type, data) { this.session.push(type, data) }

  followup(message) {
    this.inbox.push(message)
    if (this.options.manual) return
    const turn = ++this.turn
    void this.#run(turn)
  }

  complete(reply = this.options.reply ?? '完成', reason = { kind: 'completed' }, stream = true) {
    const turn = ++this.turn
    this.push('turn/start', { turn })
    if (stream) this.push('assistant/chunk', { turn, chunk: { type: 'text-delta', text: reply.slice(0, 4) } })
    this.push('assistant/message', { turn, message: { role: 'assistant', content: [{ type: 'text', text: reply }] } })
    this.push('turn/end', { turn, reason })
  }

  async #run(turn) {
    const { delay = 5, reply = '完成', reason = { kind: 'completed' }, stream = true } = this.options
    if (delay > 0) await sleep(delay)
    if (this.turn < turn) return
    this.turn = turn
    this.push('turn/start', { turn })
    if (stream) this.push('assistant/chunk', { turn, chunk: { type: 'text-delta', text: reply.slice(0, 4) } })
    this.push('assistant/message', { turn, message: { role: 'assistant', content: [{ type: 'text', text: reply }] } })
    this.push('turn/end', { turn, reason })
  }

  cancel(cause) { this.cancelCalls.push(cause) }
}

function makeRegistry({ persisted = new Set(), agentOptions = {}, beforeCreate } = {}) {
  const live = new Map()
  const calls = { create: [], resume: [], setupListeners: [] }
  const install = (options) => options.setup?.({
    on(event, handler) { calls.setupListeners.push({ event, handler }) },
  })
  const makeHandle = (id) => {
    const agent = new FakeAgent(id, agentOptions)
    const handle = {
      agent,
      disposed: false,
      async dispose() { handle.disposed = true; live.delete(id) },
    }
    live.set(id, agent)
    return handle
  }
  return {
    api: {
      get: (id) => live.get(id),
      async create(options) {
        calls.create.push(options)
        await beforeCreate?.(calls.create.length)
        install(options)
        return makeHandle(options.sessionId)
      },
      async resume(options) {
        calls.resume.push(options)
        if (!persisted.has(options.resumeSessionId)) throw new Error('persisted session not found')
        install(options)
        return makeHandle(options.resumeSessionId)
      },
    },
    live,
    calls,
  }
}

let messageSeq = 0
function makeMessage({ text = '', connectionId = 'conn-a', eventId, chatId = 'chat-1', userId = 'u1', chatType = 'direct' } = {}) {
  messageSeq += 1
  const replyContext = { opaque: `reply-${messageSeq}` }
  Object.defineProperty(replyContext, 'rawPayload', {
    get() { throw new Error('core read platform payload') },
  })
  return {
    connectionId,
    platform: 'test',
    eventId: eventId ?? `event-${messageSeq}`,
    chatId,
    userId,
    chatType,
    text,
    receivedAt: Date.now(),
    replyContext,
  }
}

async function makeBridge(overrides = {}, registryOptions = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-im-bridge-'))
  const id = overrides.id ?? 'conn-a'
  const config = normalizeConnection({
    id,
    type: 'wecom',
    botId: 'bot',
    secret: 'secret',
    provider: 'provider-a',
    model: 'model-a',
    cwd: process.cwd(),
    pollIntervalMs: 10,
    streamIntervalMs: 10,
    turnTimeoutMs: 2000,
    stateFile: join(directory, 'state.json'),
    ...overrides,
  }, { env: {} })
  const store = new ChatStore({ file: config.stateFile, logger: silentLogger, debounceMs: 5 })
  const registry = makeRegistry(registryOptions)
  const deliveries = []
  const flushed = []
  const bridge = new ConversationBridge({
    config,
    logger: silentLogger,
    store,
    agents: registry.api,
    sessions: { flush: async (session) => flushed.push(session.id) },
    defaultSelection: () => ({ provider: 'provider-a', model: 'model-a', reasoningEffort: 'high' }),
    createDelivery(message) {
      assert.equal(message.connectionId, id)
      const delivery = new FakeDelivery(message)
      deliveries.push(delivery)
      return delivery
    },
    getStatus: () => ({ state: 'online', authenticated: true, detail: '' }),
  })
  await bridge.start()
  return {
    bridge,
    deliveries,
    store,
    config,
    directory,
    registry,
    flushed,
    send(options) { bridge.handleMessage(makeMessage({ connectionId: id, ...options })) },
    agent() { return registry.live.values().next().value },
    async cleanup() { await bridge.stop(); await rm(directory, { recursive: true, force: true }) },
  }
}

function storedRecord(sessionId, overrides = {}) {
  return {
    connectionId: 'conn-a',
    platform: 'test',
    chatType: 'direct',
    chatId: 'chat-1',
    userId: 'u1',
    sessionId,
    createdAt: 1,
    updatedAt: 2,
    turns: 3,
    ...overrides,
  }
}

test('a normalized task acknowledges, streams progress and final, and persists its DSH route', async (t) => {
  const harness = await makeBridge({}, { agentOptions: { delay: 50, reply: '测试通过 ✅', sessionApi: 'eventAt' } })
  t.after(() => harness.cleanup())
  harness.send({ text: '跑一下测试' })
  await waitFor(() => harness.deliveries[0]?.calls.some((call) => call.method === 'dispose'))

  const calls = harness.deliveries[0].calls
  assert.equal(calls[0].method, 'ack')
  assert.equal(calls[0].text, '收到，开始处理…')
  assert.ok(calls.some((call) => call.method === 'progress' && call.text.includes('处理中')))
  assert.match(harness.deliveries[0].finals()[0].text, /测试通过 ✅/)
  assert.ok(calls.findIndex((call) => call.method === 'progress') < calls.findIndex((call) => call.method === 'final'))
  assert.equal(calls.at(-1).method, 'dispose')

  assert.equal(harness.registry.calls.create.length, 1)
  const created = harness.registry.calls.create[0]
  assert.equal(created.meta.cwd, process.cwd())
  assert.deepEqual(created.agentOptions, { provider: 'provider-a', model: 'model-a' })
  assert.match(created.sessionId, /^im-[0-9a-f]{8}-/)
  const agent = harness.agent()
  assert.equal(agent.inbox[0].content[0].text, '跑一下测试')
  assert.deepEqual(agent.inbox[0].source, { kind: 'user' })
  assert.match(agent.inbox[0].id, /^[0-9a-f-]{36}$/)
  assert.ok(Object.isFrozen(agent.inbox[0]))
  assert.equal(typeof agent.session.eventAt, 'function')
  assert.equal(agent.session.events, undefined)
  const key = conversationKey(makeMessage())
  assert.equal(harness.store.get(key)?.sessionId, created.sessionId)
  assert.equal(harness.store.get(key)?.connectionId, 'conn-a')
  assert.deepEqual(harness.flushed, [created.sessionId])

  const assemble = harness.registry.calls.setupListeners.find((item) => item.event === 'system-prompt/assemble').handler
  const assembled = await assemble({}, {}, async () => ({ variables: { retained: 'yes' } }))
  assert.deepEqual(assembled.variables, { retained: 'yes', provider: 'provider-a', model: 'model-a' })
  const request = harness.registry.calls.setupListeners.find((item) => item.event === 'agent/request').handler
  const routed = await request({}, async () => ({ provider: 'other', reasoningEffort: 'low', other: 1 }))
  assert.deepEqual(routed, { provider: 'provider-a', model: 'model-a', reasoningEffort: 'high', other: 1 })
})

test('persisted sessions resume and failed resumes fall back to a new session', async (t) => {
  const resumed = await makeBridge({}, { persisted: new Set(['im-old-session']) })
  t.after(() => resumed.cleanup())
  resumed.store.set('conn-a:direct:chat-1', storedRecord('im-old-session'))
  await resumed.store.flush()
  resumed.send({ text: '继续' })
  await waitFor(() => resumed.deliveries[0]?.finals().length === 1)
  assert.equal(resumed.registry.calls.resume[0].resumeSessionId, 'im-old-session')
  assert.equal(resumed.registry.calls.create.length, 0)
  assert.equal(resumed.store.get('conn-a:direct:chat-1').turns, 4)

  const fallback = await makeBridge()
  t.after(() => fallback.cleanup())
  fallback.store.set('conn-a:direct:chat-1', storedRecord('im-missing'))
  await fallback.store.flush()
  fallback.send({ text: '重开' })
  await waitFor(() => fallback.deliveries[0]?.finals().length === 1)
  assert.equal(fallback.registry.calls.resume.length, 1)
  assert.equal(fallback.registry.calls.create.length, 1)
})

test('one chat is serial while different chats run in parallel', async (t) => {
  const serial = await makeBridge({}, { agentOptions: { manual: true } })
  t.after(() => serial.cleanup())
  serial.send({ text: '任务一' })
  serial.send({ text: '任务二' })
  await waitFor(() => serial.agent()?.inbox.length === 1)
  await sleep(30)
  assert.equal(serial.agent().inbox.length, 1)
  assert.ok(serial.deliveries[1].calls.some((call) => call.method === 'ack' && call.text.includes('已排队')))
  serial.agent().complete('一')
  await waitFor(() => serial.agent().inbox.length === 2)
  serial.agent().complete('二')
  await waitFor(() => serial.deliveries[1]?.finals().length === 1)

  const parallel = await makeBridge({}, { agentOptions: { manual: true } })
  t.after(() => parallel.cleanup())
  parallel.send({ text: '甲', chatId: 'chat-a' })
  parallel.send({ text: '乙', chatId: 'chat-b' })
  await waitFor(() => parallel.registry.live.size === 2
    && [...parallel.registry.live.values()].every((agent) => agent.inbox.length === 1))
  assert.deepEqual([...parallel.registry.live.values()].map((agent) => agent.inbox.length), [1, 1])
})

test('connection id is part of the conversation identity even for the same native chat id', async (t) => {
  const first = await makeBridge({ id: 'conn-a' })
  const second = await makeBridge({ id: 'conn-b' })
  t.after(() => first.cleanup())
  t.after(() => second.cleanup())
  first.send({ text: 'first', chatId: 'same-chat' })
  second.send({ text: 'second', chatId: 'same-chat' })
  await waitFor(() => first.deliveries[0]?.finals().length === 1 && second.deliveries[0]?.finals().length === 1)
  assert.ok(first.store.get('conn-a:direct:same-chat'))
  assert.ok(second.store.get('conn-b:direct:same-chat'))
  assert.notEqual(first.registry.calls.create[0].sessionId, second.registry.calls.create[0].sessionId)
})

test('duplicate events and unauthorized senders never reach DSH', async (t) => {
  const duplicate = await makeBridge()
  t.after(() => duplicate.cleanup())
  duplicate.send({ text: '只做一次', eventId: 'duplicate' })
  duplicate.send({ text: '只做一次', eventId: 'duplicate' })
  await waitFor(() => duplicate.deliveries[0]?.finals().length === 1)
  await sleep(30)
  assert.equal(duplicate.deliveries.length, 1)
  assert.equal(duplicate.agent().inbox.length, 1)

  const denied = await makeBridge({ allowFrom: ['boss'], allowChats: ['allowed-chat'] })
  t.after(() => denied.cleanup())
  denied.send({ text: '拒绝', userId: 'intruder', chatId: 'allowed-chat' })
  await waitFor(() => denied.deliveries[0]?.notices().length === 1)
  assert.match(denied.deliveries[0].notices()[0].text, /允许名单/)
  denied.send({ text: '拒绝群', userId: 'boss', chatId: 'other-chat' })
  await waitFor(() => denied.deliveries[1]?.notices().length === 1)
  denied.send({ text: '允许', userId: 'boss', chatId: 'allowed-chat' })
  await waitFor(() => denied.deliveries[2]?.finals().length === 1)
  assert.equal(denied.registry.calls.create.length, 1)
})

test('queue overflow is an explicit notice and empty input does not create an agent', async (t) => {
  const harness = await makeBridge({ maxQueue: 1 }, { agentOptions: { manual: true } })
  t.after(() => harness.cleanup())
  harness.send({ text: 'running' })
  harness.send({ text: 'queued' })
  harness.send({ text: 'overflow' })
  await waitFor(() => harness.deliveries[2]?.notices().length === 1)
  assert.match(harness.deliveries[2].notices()[0].text, /队列已满/)
  assert.equal(harness.deliveries.length, 3)

  const empty = await makeBridge()
  t.after(() => empty.cleanup())
  empty.send({ text: '' })
  await waitFor(() => empty.deliveries[0]?.notices().length === 1)
  assert.match(empty.deliveries[0].notices()[0].text, /没有读到文字/)
  assert.equal(empty.registry.calls.create.length, 0)
})

test('slash commands answer without DSH and stop cancels the active turn', async (t) => {
  const commands = await makeBridge()
  t.after(() => commands.cleanup())
  commands.send({ text: '/help' })
  await waitFor(() => commands.deliveries[0]?.notices().length === 1)
  assert.match(commands.deliveries[0].notices()[0].text, /\/new/)
  assert.equal(commands.registry.calls.create.length, 0)

  const stopped = await makeBridge({}, { agentOptions: { manual: true } })
  t.after(() => stopped.cleanup())
  stopped.send({ text: '慢任务' })
  await waitFor(() => stopped.agent()?.inbox.length === 1)
  stopped.send({ text: '/stop' })
  await waitFor(() => stopped.agent().cancelCalls.length === 1)
  assert.deepEqual(stopped.agent().cancelCalls[0], { kind: 'user' })
  await waitFor(() => stopped.deliveries[0]?.finals().length === 1)
  assert.match(stopped.deliveries[0].finals()[0].text, /已停止/)
})

test('stop cancels queued work and welcomeText is sent once per live conversation', async (t) => {
  const harness = await makeBridge({ welcomeText: '欢迎使用' }, { agentOptions: { manual: true } })
  t.after(() => harness.cleanup())
  harness.send({ text: '当前任务' })
  await waitFor(() => harness.agent()?.inbox.length === 1)
  assert.equal(harness.deliveries[0].notices()[0].text, '欢迎使用')

  harness.send({ text: '排队任务' })
  await waitFor(() => harness.deliveries.length === 2)
  harness.send({ text: '/stop' })
  await waitFor(() => harness.deliveries[1]?.notices().length === 1)
  assert.match(harness.deliveries[1].notices()[0].text, /排队任务已取消/)
  await waitFor(() => harness.deliveries[0].finals().length === 1)
  assert.equal(harness.agent().inbox.length, 1, 'queued input must not follow up after stop')

  harness.send({ text: '停止后的新任务' })
  await waitFor(() => harness.deliveries.length === 4)
  assert.equal(harness.deliveries[3].notices().length, 0, 'welcome is not repeated in the same live conversation')
})

test('new cancels the old epoch, clears persistence, and never delivers its stale final', async (t) => {
  const harness = await makeBridge({}, { agentOptions: { manual: true } })
  t.after(() => harness.cleanup())
  harness.send({ text: '旧任务' })
  await waitFor(() => harness.agent()?.inbox.length === 1)
  const oldAgent = harness.agent()
  const oldDelivery = harness.deliveries[0]
  harness.send({ text: '/new' })
  await waitFor(() => harness.deliveries[1]?.notices().length === 1)
  assert.deepEqual(oldAgent.cancelCalls[0], { kind: 'user' })
  assert.equal(harness.store.get('conn-a:direct:chat-1'), undefined)
  oldAgent.complete('不应投递的旧结果')
  await sleep(50)
  assert.equal(oldDelivery.finals().length, 0)

  harness.send({ text: '新任务' })
  await waitFor(() => harness.registry.calls.create.length === 2 && harness.agent()?.inbox.length === 1)
  harness.agent().complete('完成')
  await waitFor(() => harness.deliveries[2]?.finals().length === 1)
  assert.equal(harness.registry.calls.create.length, 2)
  assert.match(harness.deliveries[2].finals()[0].text, /完成/)
})

test('stop during asynchronous agent acquisition aborts before followup', async (t) => {
  let releaseCreate
  const blocked = new Promise((resolve) => { releaseCreate = resolve })
  const harness = await makeBridge({}, {
    agentOptions: { manual: true },
    beforeCreate: (count) => count === 1 ? blocked : undefined,
  })
  t.after(() => harness.cleanup())
  harness.send({ text: '等待 Agent' })
  await waitFor(() => harness.registry.calls.create.length === 1)
  harness.send({ text: '/stop' })
  await waitFor(() => harness.deliveries[1]?.notices().length === 1)
  releaseCreate()
  await waitFor(() => harness.deliveries[0]?.finals().length === 1)
  assert.match(harness.deliveries[0].finals()[0].text, /已停止/)
  assert.equal(harness.agent().inbox.length, 0)
})

test('new during asynchronous agent acquisition disposes the stale handle and route', async (t) => {
  let releaseCreate
  const blocked = new Promise((resolve) => { releaseCreate = resolve })
  const harness = await makeBridge({}, {
    agentOptions: { manual: true },
    beforeCreate: (count) => count === 1 ? blocked : undefined,
  })
  t.after(() => harness.cleanup())
  harness.send({ text: '旧任务' })
  await waitFor(() => harness.registry.calls.create.length === 1)
  harness.send({ text: '/new' })
  await waitFor(() => harness.deliveries[1]?.notices().length === 1)
  releaseCreate()
  await waitFor(() => harness.deliveries[0]?.disposed)
  assert.equal(harness.registry.live.size, 0)
  assert.equal(harness.store.get('conn-a:direct:chat-1'), undefined)
})

test('a hanging turn times out, cancels, and still returns a final response', async (t) => {
  const harness = await makeBridge({ turnTimeoutMs: 100 }, { agentOptions: { manual: true } })
  t.after(() => harness.cleanup())
  harness.send({ text: '卡住' })
  await waitFor(() => harness.deliveries[0]?.finals().length === 1)
  assert.match(harness.deliveries[0].finals()[0].text, /超时/)
  assert.deepEqual(harness.agent().cancelCalls[0], { kind: 'user' })
})

test('turn errors retain their code and partial answer', async (t) => {
  const harness = await makeBridge({}, { agentOptions: {
    reply: '部分输出',
    reason: { kind: 'error', error: { code: 'AUTH', message: 'invalid api key' } },
  } })
  t.after(() => harness.cleanup())
  harness.send({ text: '跑一下' })
  await waitFor(() => harness.deliveries[0]?.finals().length === 1)
  assert.match(harness.deliveries[0].finals()[0].text, /执行失败（AUTH）/)
  assert.match(harness.deliveries[0].finals()[0].text, /部分输出/)
})

test('long answers use final for the first chunk and ordered notices for overflow', async (t) => {
  const harness = await makeBridge({ maxReplyChars: 100 }, { agentOptions: { reply: 'x'.repeat(250) } })
  t.after(() => harness.cleanup())
  harness.send({ text: '写长文' })
  await waitFor(() => harness.deliveries[0]?.calls.some((call) => call.method === 'dispose'))
  const calls = harness.deliveries[0].calls
  const finalIndex = calls.findIndex((call) => call.method === 'final')
  assert.equal(calls[finalIndex].text.length, 100)
  assert.deepEqual(calls.slice(finalIndex + 1).map((call) => call.method), ['notice', 'notice', 'dispose'])
  assert.equal(calls[finalIndex].text.length + calls[finalIndex + 1].text.length + calls[finalIndex + 2].text.length, 250)
})

test('invalid normalized messages are ignored without reading replyContext or creating delivery', async (t) => {
  const harness = await makeBridge()
  t.after(() => harness.cleanup())
  harness.bridge.handleMessage({ ...makeMessage({ text: 'bad' }), eventId: '' })
  harness.bridge.handleMessage({ ...makeMessage({ text: 'bad' }), chatId: '' })
  harness.bridge.handleMessage({ ...makeMessage({ text: 'bad' }), chatType: 'channel' })
  await sleep(30)
  assert.equal(harness.deliveries.length, 0)
  assert.equal(harness.registry.calls.create.length, 0)
})
