import assert from 'node:assert/strict'
import test from 'node:test'
import { executeCommand, helpText } from '../lib/commands.js'
import { conversationKey, formatDuration, parseCommand, splitText } from '../lib/text.js'

test('command parsing preserves English and Chinese aliases without treating paths as commands', () => {
  assert.deepEqual(parseCommand('/help'), { name: 'help', args: '' })
  assert.deepEqual(parseCommand('/新会话'), { name: 'new', args: '' })
  assert.deepEqual(parseCommand('/重置'), { name: 'new', args: '' })
  assert.deepEqual(parseCommand('  /stop now please '), { name: 'stop', args: 'now please' })
  assert.deepEqual(parseCommand('?'), { name: 'help', args: '' })
  assert.deepEqual(parseCommand('/H'), { name: 'help', args: '' })
  assert.equal(parseCommand('/var/log'), undefined)
  assert.equal(parseCommand('/unknown thing'), undefined)
  assert.equal(parseCommand('hello'), undefined)
})

test('help is platform-neutral and documents every supported command', () => {
  const text = helpText({ cwd: '/workspace', platformLabel: 'Test IM' })
  assert.match(text, /Test IM/)
  for (const command of ['/new', '/stop', '/status', '/whoami', '/help', '/ping']) assert.match(text, new RegExp(command))
  assert.match(text, /\/workspace/)
})

test('help, ping, whoami and status use normalized message fields only', async () => {
  const notices = []
  const config = { cwd: '/workspace', helpText: '', platformLabel: 'Test IM' }
  const message = { connectionId: 'conn-a', platform: 'test', userId: 'alice', chatType: 'group', chatId: 'room' }
  const state = { sessionId: 'session-a', running: true, queue: [{}, {}], turns: 7 }
  const context = {
    config,
    message,
    state,
    delivery: { async notice(text) { notices.push(text) } },
    snapshot: () => ({ connection: { state: 'online', authenticated: true, detail: 'ready' }, uptimeMs: 61_000 }),
    selection: () => ({ provider: 'provider-a', model: 'model-a', reasoningEffort: 'high' }),
    stop: async () => { throw new Error('not expected') },
    reset: async () => { throw new Error('not expected') },
  }
  await executeCommand({ name: 'help', args: '' }, context)
  await executeCommand({ name: 'ping', args: '' }, context)
  await executeCommand({ name: 'whoami', args: '' }, context)
  await executeCommand({ name: 'status', args: '' }, context)
  assert.match(notices[0], /\/new/)
  assert.equal(notices[1], 'pong')
  assert.match(notices[2], /connection: conn-a/)
  assert.match(notices[2], /userid: alice/)
  assert.match(notices[2], /chattype: group/)
  assert.match(notices[2], /chatid: room/)
  assert.match(notices[2], /session: session-a/)
  assert.match(notices[3], /连接：online（已认证）/)
  assert.match(notices[3], /provider-a\/model-a · high/)
  assert.match(notices[3], /执行中 · 排队 2/)
  assert.match(notices[3], /累计任务：7 · 运行 1m1s/)
  assert.match(notices[3], /备注：ready/)
})

test('stop and new delegate their lifecycle operations before acknowledging', async () => {
  const calls = []
  const base = {
    config: { cwd: '/workspace', helpText: '' },
    message: { connectionId: 'conn-a', platform: 'test', userId: 'alice', chatType: 'direct', chatId: 'chat' },
    state: { running: false, current: undefined, queue: [], turns: 0 },
    delivery: { async notice(text) { calls.push(text) } },
    snapshot: () => ({ connection: {}, uptimeMs: 0 }),
    selection: () => ({}),
    stop: async () => { calls.push('stop-action'); return false },
    reset: async () => { calls.push('reset-action') },
  }
  await executeCommand({ name: 'stop', args: '' }, base)
  assert.deepEqual(calls, ['stop-action', '当前没有在跑的任务。'])
  calls.length = 0
  base.stop = async () => { calls.push('stop-action'); return true }
  await executeCommand({ name: 'stop', args: '' }, base)
  assert.deepEqual(calls, ['stop-action', '⏹ 已请求停止当前任务。'])
  calls.length = 0
  await executeCommand({ name: 'new', args: '' }, base)
  assert.deepEqual(calls, ['reset-action', '🆕 已开启新会话，之前的上下文不会带过来。'])
  calls.length = 0
  await executeCommand({ name: 'unknown', args: '' }, base)
  assert.match(calls[0], /\/help/)
})

test('conversation keys always include connection, kind and native chat id', () => {
  assert.equal(conversationKey({ connectionId: 'conn-a', chatType: 'direct', chatId: 'same' }), 'conn-a:direct:same')
  assert.notEqual(
    conversationKey({ connectionId: 'conn-a', chatType: 'direct', chatId: 'same' }),
    conversationKey({ connectionId: 'conn-b', chatType: 'direct', chatId: 'same' }),
  )
})

test('shared text chunking respects boundaries and duration formatting remains compatible', () => {
  assert.deepEqual(splitText('', 100), [''])
  const parts = splitText('x'.repeat(250), 100)
  assert.deepEqual(parts, ['x'.repeat(100), 'x'.repeat(100), 'x'.repeat(50)])
  assert.equal(formatDuration(61_000), '1m1s')
})
