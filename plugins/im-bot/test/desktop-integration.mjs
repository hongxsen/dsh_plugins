#!/usr/bin/env node
/**
 * Verify the shared bridge against the actual Desktop 0.2.x runtime.
 * Run with ELECTRON_RUN_AS_NODE=1 and the app binary; no IM credentials needed.
 */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const ASAR = process.env.DSH_DESKTOP_ASAR
  ?? '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh'

if (process.versions.electron === undefined) {
  console.log('[skip] run under the Desktop binary with ELECTRON_RUN_AS_NODE=1')
  process.exit(0)
}
// Plain Node cannot stat files inside an ASAR; Electron's patched fs can.
if (!existsSync(join(ASAR, 'node_modules/@deepseek-ai/dsh-agent/lib/index.js'))) {
  console.log(`[skip] no Desktop ASAR at ${ASAR}`)
  process.exit(0)
}

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} }
const load = (pkg) => import(pathToFileURL(join(ASAR, 'node_modules/@deepseek-ai', pkg, 'lib/index.js')).href)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function waitFor(predicate, timeout = 15_000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (predicate()) return
    await sleep(25)
  }
  throw new Error('desktop integration waitFor timeout')
}

const { Context } = await load('cordis')
const llm = await load('dsh-llm')
const { default: LlmRuntime, LlmAdapter } = llm
const { default: SessionStore } = await load('dsh-session')
const { default: SystemPrompt } = await load('dsh-system-prompt')
const { default: ToolRuntime } = await load('dsh-tools')
const { default: AgentRegistry } = await load('dsh-agent')
const { default: SessionProjection } = await load('dsh-session-projection')
const { default: AgentLoop } = await load('dsh-agent-loop')
const persistenceModule = await load('dsh-session-persistence-jsonl')
const JsonlSessionPersistence = persistenceModule.default ?? persistenceModule

const { ConversationBridge } = await import(pathToFileURL(join(PLUGIN_ROOT, 'lib/bridge.js')).href)
const { ChatStore } = await import(pathToFileURL(join(PLUGIN_ROOT, 'lib/store.js')).href)
const { normalizeConnection } = await import(pathToFileURL(join(PLUGIN_ROOT, 'lib/config.js')).href)

class ScriptedAdapter extends LlmAdapter {
  constructor(replies) {
    super()
    this.replies = [...replies]
    this.requests = []
  }
  async *stream(options) {
    this.requests.push(options)
    const text = this.replies.shift() ?? '（脚本用尽）'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    for (const char of text) yield { type: 'text-delta', index: 0, text: char }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

class FakeDelivery {
  constructor() { this.replies = [] }
  async ack(text) { this.replies.push({ phase: 'ack', text }) }
  async progress(text) { this.replies.push({ phase: 'progress', text }) }
  async final(text) { this.replies.push({ phase: 'final', text }) }
  async notice(text) { this.replies.push({ phase: 'notice', text }) }
  async dispose() {}
  finals() { return this.replies.filter((reply) => reply.phase === 'final') }
}

const root = await mkdtemp(join(tmpdir(), 'dsh-im-bot-desktop-'))
const stateFile = join(root, 'state.json')
const model = new ScriptedAdapter(['桌面运行时第一轮', '桌面运行时第二轮'])
const config = normalizeConnection({
  id: 'desktop-test', type: 'wecom', botId: 'bot', secret: 'secret',
  provider: 'mock', model: 'mock', cwd: root,
  pollIntervalMs: 30, streamIntervalMs: 30, stateFile,
})

async function mount() {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionProjection)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'sessions') })
  ctx.llm.registerAdapter(['mock'], model)
  return ctx
}

function message(text, seq) {
  return {
    connectionId: 'desktop-test', platform: 'wecom', eventId: `m-${seq}`,
    chatId: 'u1', userId: 'u1', chatType: 'direct', text,
    receivedAt: Date.now(), replyContext: {},
  }
}

async function startBridge(ctx) {
  const delivery = new FakeDelivery()
  const bridge = new ConversationBridge({
    config, logger: silentLogger,
    store: new ChatStore({ file: stateFile, logger: silentLogger, debounceMs: 1 }),
    agents: ctx.agents, sessions: ctx.sessions,
    defaultSelection: () => ({}),
    createDelivery: () => delivery,
    getStatus: () => ({ state: 'online', authenticated: true }),
  })
  await bridge.start()
  return { bridge, delivery }
}

try {
  const ctx1 = await mount()
  const first = await startBridge(ctx1)
  await first.bridge.handleMessage(message('你好，桌面运行时', 1))
  await waitFor(() => first.delivery.finals().length === 1)
  assert.equal(first.delivery.finals()[0].text, '桌面运行时第一轮')

  const stored = JSON.parse(await readFile(stateFile, 'utf8'))
  const sessionId = Object.values(stored.chats)[0].sessionId
  const live = ctx1.sessions.get(sessionId)
  assert.ok(live, 'the live session exists')
  assert.equal(typeof live.eventAt, 'function')
  assert.equal(live.events, undefined)
  assert.equal(live.eventAt(live.seq - 1)?.type, 'turn/end')

  await first.bridge.stop()
  await ctx1.fiber.dispose()

  const ctx2 = await mount()
  const second = await startBridge(ctx2)
  await second.bridge.handleMessage(message('第二轮', 2))
  await waitFor(() => second.delivery.finals().length === 1)
  assert.equal(second.delivery.finals()[0].text, '桌面运行时第二轮')
  const history = (model.requests.at(-1).messages ?? [])
    .filter((item) => item.role === 'user')
    .flatMap((item) => item.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
  assert.deepEqual(history, ['你好，桌面运行时', '第二轮'])

  await second.bridge.stop()
  await ctx2.fiber.dispose()
  console.log('desktop runtime integration OK (multi-platform core, 0.2.x session API, persistence, resume)')
} finally {
  await rm(root, { recursive: true, force: true })
}
