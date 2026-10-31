import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { normalizeConfig, normalizeConnection, resolveDshHome, resolvePath } from '../lib/config.js'

const wecom = { id: 'work', type: 'wecom', botId: 'bot', secret: 'secret' }
const qq = { id: 'personal', type: 'qq', appId: 'app', appSecret: 'secret' }
const feishu = { id: 'team', type: 'feishu', appId: 'app', appSecret: 'secret' }

test('accepts only the new connections structure and supported platform types', () => {
  assert.throws(() => normalizeConfig({ botId: 'old', secret: 'old' }), /connections/)
  assert.throws(() => normalizeConfig({}), /connections/)
  assert.throws(() => normalizeConfig({ connections: {} }), /connections/)
  assert.throws(() => normalizeConfig({ connections: [{ ...wecom, type: 'unknown' }] }), /type/)
  assert.deepEqual(normalizeConfig({ connections: [] }), { connections: [] })
  assert.equal(normalizeConfig({ connections: [wecom, qq, feishu] }).connections.length, 3)
})

test('requires unique, path-safe connection ids and independent state files', () => {
  for (const id of ['', '../escape', 'a/b', 'a b', '.hidden', 'a'.repeat(65)]) {
    assert.throws(() => normalizeConfig({ connections: [{ ...wecom, id }] }), /id/)
  }
  assert.throws(() => normalizeConfig({ connections: [wecom, { ...qq, id: 'work' }] }), /唯一|unique/)
  assert.throws(
    () => normalizeConfig({ connections: [{ ...wecom, stateFile: '/tmp/shared.json' }, { ...qq, stateFile: '/tmp/shared.json' }] }),
    /stateFile/,
  )
})

test('validates credentials for each enabled connection but allows a disabled dormant connection', () => {
  assert.throws(() => normalizeConnection({ id: 'a', type: 'wecom', botId: 'bot' }), /secret/)
  assert.throws(() => normalizeConnection({ id: 'a', type: 'qq', appId: 'app' }), /appSecret/)
  assert.throws(() => normalizeConnection({ id: 'a', type: 'feishu', appSecret: 'secret' }), /appId/)
  const dormant = normalizeConnection({ id: 'a', type: 'feishu', enabled: false })
  assert.equal(dormant.enabled, false)
  assert.equal(dormant.appId, '')
  assert.equal(dormant.appSecret, '')
})

test('expands only explicit whole-string environment references', () => {
  const env = { BOT_ID: 'env-bot', BOT_SECRET: 'env-secret', EMPTY: '' }
  const config = normalizeConnection(
    { ...wecom, botId: '${BOT_ID}', secret: '${BOT_SECRET}' },
    { env },
  )
  assert.equal(config.botId, 'env-bot')
  assert.equal(config.secret, 'env-secret')
  assert.throws(() => normalizeConnection({ ...wecom, secret: '${MISSING}' }, { env }), /MISSING/)
  assert.throws(() => normalizeConnection({ ...wecom, secret: '${EMPTY}' }, { env }), /EMPTY/)
  assert.equal(normalizeConnection({ ...wecom, secret: 'prefix-${MISSING}' }, { env }).secret, 'prefix-${MISSING}')
  assert.equal(normalizeConnection(wecom, { env: { WECOM_BOT_ID: 'implicit', WECOM_SECRET: 'implicit' } }).botId, 'bot')
})

test('fills shared defaults and gives every connection its own state path', () => {
  const root = join(homedir(), 'dsh-home-test')
  const config = normalizeConfig({ dshHome: root, connections: [wecom, qq] }, { env: {} })
  const [first, second] = config.connections
  assert.equal(first.stateFile, join(root, 'storages', 'dsh-im-bot', 'work.json'))
  assert.equal(second.stateFile, join(root, 'storages', 'dsh-im-bot', 'personal.json'))
  assert.equal(first.streamUpdates, true)
  assert.equal(first.streamIntervalMs, 1500)
  assert.equal(first.maxStreamUpdates, 80)
  assert.equal(first.pollIntervalMs, 250)
  assert.equal(first.turnTimeoutMs, 600_000)
  assert.equal(first.maxQueue, 20)
  assert.equal(first.maxDedupeEntries, 256)
  assert.equal(first.maxReplyChars, 3000)
  assert.deepEqual(first.allowFrom, [])
  assert.deepEqual(first.allowChats, [])
  assert.equal(first.enabled, true)
  assert.equal(first.cwd, process.cwd())
  assert.ok(Object.isFrozen(config.connections))
  assert.ok(Object.isFrozen(first))
})

test('normalizes allowlists, paths, platform options and numeric values', () => {
  const config = normalizeConnection({
    ...wecom,
    allowFrom: 'alice, bob,alice',
    allowChats: ['chat-a', 'chat-a'],
    cwd: '~/work',
    stateFile: '~/state.json',
    streamUpdates: false,
    streamIntervalMs: '1250',
    sandbox: true,
  })
  assert.deepEqual(config.allowFrom, ['alice', 'bob'])
  assert.deepEqual(config.allowChats, ['chat-a'])
  assert.equal(config.cwd, join(homedir(), 'work'))
  assert.equal(config.stateFile, join(homedir(), 'state.json'))
  assert.equal(config.streamUpdates, false)
  assert.equal(config.streamIntervalMs, 1250)
  assert.equal(config.sandbox, true)
  assert.throws(() => normalizeConnection({ ...wecom, turnTimeoutMs: 0 }), /turnTimeoutMs/)
  assert.throws(() => normalizeConnection({ ...wecom, pollIntervalMs: 0.5 }), /pollIntervalMs/)
  assert.throws(() => normalizeConnection({ ...wecom, maxQueue: 'many' }), /maxQueue/)
})

test('resolves DSH home explicitly, from the supplied environment, then from the user home', () => {
  assert.equal(resolveDshHome('/tmp/explicit', { env: {} }), '/tmp/explicit')
  assert.equal(resolveDshHome(undefined, { env: { DSH_HOME: '/tmp/from-env' } }), '/tmp/from-env')
  assert.equal(resolveDshHome(undefined, { env: {} }), join(homedir(), '.dsh'))
  assert.equal(resolvePath('relative', undefined, '/tmp/base'), '/tmp/base/relative')
})
