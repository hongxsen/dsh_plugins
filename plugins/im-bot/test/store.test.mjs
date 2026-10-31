import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { ChatStore } from '../lib/store.js'

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} }

async function makeStore(t) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-im-store-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const file = join(directory, 'nested', 'state.json')
  const store = new ChatStore({ file, logger: silentLogger, debounceMs: 1 })
  return { directory, file, store }
}

function record(overrides = {}) {
  return {
    connectionId: 'conn-a',
    platform: 'test',
    chatType: 'direct',
    chatId: 'chat-1',
    userId: 'user-1',
    sessionId: 'im-session-a',
    createdAt: 1,
    updatedAt: 2,
    turns: 3,
    ...overrides,
  }
}

test('persists canonical connection/chat/session metadata and reloads it', async (t) => {
  const { file, store } = await makeStore(t)
  store.set('conn-a:direct:chat-1', record())
  store.set('conn-b:direct:chat-1', record({ connectionId: 'conn-b', sessionId: 'im-session-b', turns: 4 }))
  store.set('conn-a:group:room', record({ chatType: 'group', chatId: 'room', sessionId: 'im-group' }))
  await store.flush()

  const rawText = await readFile(file, 'utf8')
  const raw = JSON.parse(rawText)
  assert.equal(raw.version, 1)
  assert.equal(raw.chats['conn-a:direct:chat-1'].sessionId, 'im-session-a')
  assert.equal(raw.chats['conn-b:direct:chat-1'].sessionId, 'im-session-b')
  assert.equal(raw.chats['conn-a:group:room'].chatType, 'group')
  assert.equal((await stat(file)).mode & 0o777, 0o600)

  const reloaded = new ChatStore({ file, logger: silentLogger, debounceMs: 1 })
  await reloaded.load()
  assert.equal(reloaded.get('conn-a:direct:chat-1')?.turns, 3)
  assert.equal(reloaded.get('conn-b:direct:chat-1')?.sessionId, 'im-session-b')
  assert.equal(reloaded.get('conn-a:group:room')?.chatId, 'room')
  await reloaded.dispose()
})

test('never persists message bodies, reply contexts, secrets, or unknown record fields', async (t) => {
  const { file, store } = await makeStore(t)
  store.set('conn-a:direct:chat-1', record({
    text: 'private message',
    secret: 'do-not-persist',
    replyContext: { token: 'do-not-persist' },
  }))
  await store.flush()
  const raw = await readFile(file, 'utf8')
  assert.equal(raw.includes('private message'), false)
  assert.equal(raw.includes('do-not-persist'), false)
  assert.equal(raw.includes('replyContext'), false)
})

test('delete removes a record from disk and invalid records are ignored', async (t) => {
  const { file, store } = await makeStore(t)
  store.set('conn-a:direct:chat-1', record())
  await store.flush()
  store.delete('conn-a:direct:chat-1')
  store.set('invalid', record({ sessionId: '' }))
  await store.flush()
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).chats, {})
  assert.equal(store.get('invalid'), undefined)
})

test('a corrupt state file is quarantined and treated as empty', async (t) => {
  const { file } = await makeStore(t)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, '{not json', { mode: 0o600 })
  const reloaded = new ChatStore({ file, logger: silentLogger, debounceMs: 1 })
  await reloaded.load()
  assert.equal(reloaded.entries().length, 0)
  const backups = (await readdir(dirname(file))).filter((name) => name.includes('.corrupt-'))
  assert.equal(backups.length, 1)
  await reloaded.dispose()
})

test('an existing permissive state file is replaced by a 0600 atomic write without temporary litter', async (t) => {
  const { directory, file, store } = await makeStore(t)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, '{}', { mode: 0o644 })
  store.set('conn-a:direct:chat-1', record())
  await store.flush()
  assert.equal((await stat(file)).mode & 0o777, 0o600)
  assert.deepEqual(await readdir(dirname(file)), ['state.json'])
  assert.equal(((await stat(dirname(file))).mode & 0o111) !== 0, true)
})

test('failed writes remain dirty so a later flush can recover', async (t) => {
  const { file, store } = await makeStore(t)
  await mkdir(file, { recursive: true })
  store.set('conn-a:direct:chat-1', record())
  await assert.rejects(() => store.flush())
  await rm(file, { recursive: true })
  await store.flush()
  assert.equal(JSON.parse(await readFile(file, 'utf8')).chats['conn-a:direct:chat-1'].sessionId, 'im-session-a')
  await store.dispose()
})
