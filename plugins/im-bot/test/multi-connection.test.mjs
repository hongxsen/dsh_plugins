import assert from 'node:assert/strict'
import test from 'node:test'
import { IMBotRuntime } from '../index.js'

const silent = { info() {}, warn() {}, error() {} }

class FakeAdapter {
  constructor(config, fail = false) {
    this.config = config
    this.fail = fail
    this.status = { state: 'offline' }
    this.stopped = false
  }
  async start(handlers) {
    this.handlers = handlers
    if (this.fail) throw new Error('adapter unavailable')
    this.status = { state: 'online' }
    handlers.onReady?.(this.status)
  }
  async stop() { this.stopped = true }
  createDelivery(message) { return { message } }
  emit(text, eventId = `${this.config.id}-event`) {
    return this.handlers.onMessage({
      eventId,
      chatId: 'same-chat-id',
      userId: 'u1',
      chatType: 'direct',
      text,
      receivedAt: Date.now(),
      replyContext: {},
    })
  }
}

function fixture(t, connections, options = {}) {
  const adapters = []
  const bridges = []
  const stores = []
  const runtime = new IMBotRuntime({ agents: {}, sessions: {}, logger: silent }, options.rawConfig ?? { connections }, {
    logger: silent,
    env: {},
    adapterFactories: Object.fromEntries(['wecom', 'qq', 'feishu'].map((type) => [type, (config) => {
      const adapter = new FakeAdapter(config, options.failType === type)
      adapters.push(adapter)
      return adapter
    }])),
    storeFactory: (config) => {
      const store = { config, flushed: false, disposed: false, async flush() { this.flushed = true }, dispose() { this.disposed = true } }
      stores.push(store)
      return store
    },
    bridgeFactory: options.bridgeFactory ?? ((options) => {
      const bridge = {
        config: options.config,
        messages: [],
        started: false,
        stopped: false,
        async start() { this.started = true },
        handleMessage(message) { this.messages.push(message) },
        async stop() { this.stopped = true },
      }
      bridges.push(bridge)
      return bridge
    }),
  })
  t.after(() => runtime.stop())
  return { runtime, adapters, bridges, stores }
}

const credentials = {
  wecom: { botId: 'bot', secret: 'secret' },
  qq: { appId: 'app', appSecret: 'secret' },
  feishu: { appId: 'app', appSecret: 'secret' },
}

function connection(id, type) {
  return { id, type, ...credentials[type], stateFile: `/tmp/${id}-state.json` }
}

test('three platforms start together and route identical chat IDs in isolation', async (t) => {
  const { runtime, adapters, bridges } = fixture(t, [
    connection('work', 'wecom'),
    connection('personal', 'qq'),
    connection('team', 'feishu'),
  ])
  await runtime.start()
  assert.deepEqual(runtime.snapshot().connections, ['work', 'personal', 'team'])
  assert.equal(runtime.errors.length, 0)
  await adapters[1].emit('hello qq')
  assert.equal(bridges[0].messages.length, 0)
  assert.equal(bridges[1].messages.length, 1)
  assert.equal(bridges[2].messages.length, 0)
  assert.equal(bridges[1].messages[0].connectionId, 'personal')
  assert.equal(bridges[1].messages[0].platform, 'qq')
  assert.equal(bridges[1].messages[0].chatId, 'same-chat-id')
})

test('one adapter failure and one invalid connection do not block healthy peers', async (t) => {
  const { runtime, bridges } = fixture(t, [
    connection('work', 'wecom'),
    { id: 'bad connection', type: 'qq', ...credentials.qq },
    connection('broken-feishu', 'feishu'),
    connection('personal', 'qq'),
  ], { failType: 'feishu' })
  await runtime.start()
  assert.deepEqual(runtime.snapshot().connections, ['work', 'personal'])
  assert.equal(runtime.errors.length, 2)
  assert.equal(bridges.length, 3, 'invalid config is rejected before constructing a bridge')
  await runtime.stop()
  assert.equal(runtime.connections.size, 0)
})

test('one slow connection does not delay healthy peers', async (t) => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const { runtime, adapters } = fixture(t, [connection('work', 'wecom'), connection('personal', 'qq')], {
    bridgeFactory: ({ config }) => ({
      async start() { if (config.id === 'work') await gate },
      handleMessage() {},
      async stop() {},
    }),
  })
  const starting = runtime.start()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(adapters[0].handlers, undefined)
  assert.equal(adapters[1].status.state, 'online')
  release()
  await starting
  assert.deepEqual(runtime.snapshot().connections, ['work', 'personal'])
})

test('duplicate IDs keep the first connection and reject the later one', async (t) => {
  const { runtime } = fixture(t, [
    connection('same', 'wecom'),
    { ...connection('same', 'qq'), stateFile: '/tmp/another-same-state.json' },
  ])
  await runtime.start()
  assert.deepEqual(runtime.snapshot().connections, ['same'])
  assert.match(runtime.errors[0].error, /重复/)
})

test('connections cannot share one state file', async (t) => {
  const first = connection('first', 'wecom')
  const second = { ...connection('second', 'qq'), stateFile: first.stateFile }
  const { runtime, adapters } = fixture(t, [first, second])
  await runtime.start()
  assert.deepEqual(runtime.snapshot().connections, ['first'])
  assert.equal(adapters.length, 1)
  assert.match(runtime.errors[0].error, /状态文件/)
})

test('legacy flat config is rejected without starting network adapters', async (t) => {
  const { runtime, adapters } = fixture(t, [], { rawConfig: { botId: 'old', secret: 'old' } })
  await runtime.start()
  assert.equal(adapters.length, 0)
  assert.equal(runtime.connections.size, 0)
  assert.match(runtime.errors[0].error, /connections/)
})
