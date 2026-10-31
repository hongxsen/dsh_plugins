/** Atomic, durable connection/chat → DSH session metadata. */

import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'

const FORMAT_VERSION = 1

function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback
}

function text(value) {
  return typeof value === 'string' ? value : ''
}

/** Persist only recovery metadata, never arbitrary adapter/user fields. */
function normalizeRecord(value) {
  if (value === null || typeof value !== 'object') return undefined
  const sessionId = text(value.sessionId)
  if (sessionId === '') return undefined
  return {
    connectionId: text(value.connectionId),
    platform: text(value.platform),
    chatType: value.chatType === 'group' ? 'group' : 'direct',
    chatId: text(value.chatId),
    userId: text(value.userId),
    sessionId,
    createdAt: finite(value.createdAt, Date.now()),
    updatedAt: finite(value.updatedAt, Date.now()),
    turns: finite(value.turns, 0),
  }
}

export class ChatStore {
  #file
  #logger
  #chats = new Map()
  #dirty = false
  #timer
  #writing = Promise.resolve()
  #closed = false
  #debounceMs

  constructor({ file, logger = console, debounceMs = 400 }) {
    this.#file = file
    this.#logger = logger
    this.#debounceMs = debounceMs
  }

  get file() { return this.#file }

  async load() {
    let source
    try {
      source = await readFile(this.#file, 'utf8')
    } catch (error) {
      if (error?.code !== 'ENOENT') this.#logger.warn?.(`[im-bot] 读取状态文件失败：${error?.message ?? error}`)
      return
    }
    try {
      const parsed = JSON.parse(source)
      const chats = parsed?.chats
      if (chats === null || typeof chats !== 'object' || Array.isArray(chats)) return
      for (const [key, value] of Object.entries(chats)) {
        const record = normalizeRecord(value)
        if (record !== undefined) this.#chats.set(key, record)
      }
    } catch (error) {
      this.#logger.warn?.(`[im-bot] 状态文件已损坏，将从空状态开始：${error?.message ?? error}`)
      await this.#quarantine()
    }
  }

  get(key) { return this.#chats.get(key) }

  set(key, record) {
    const normalized = normalizeRecord(record)
    if (normalized === undefined) return
    this.#chats.set(key, normalized)
    this.#touch()
  }

  delete(key) {
    if (this.#chats.delete(key)) this.#touch()
  }

  entries() { return [...this.#chats.entries()] }

  #touch() {
    this.#dirty = true
    if (this.#closed) return
    clearTimeout(this.#timer)
    this.#timer = setTimeout(() => {
      this.flush().catch((error) => this.#logger.error?.(`[im-bot] 写入状态文件失败：${error?.message ?? error}`))
    }, this.#debounceMs)
    this.#timer.unref?.()
  }

  /** Serialize snapshots and fsync a unique 0600 temporary file before rename. */
  flush() {
    clearTimeout(this.#timer)
    this.#timer = undefined
    if (!this.#dirty) return this.#writing
    this.#dirty = false
    const snapshot = JSON.stringify({ version: FORMAT_VERSION, chats: Object.fromEntries(this.#chats) }, null, 2)
    this.#writing = this.#writing.catch(() => {}).then(async () => {
      const directory = dirname(this.#file)
      await mkdir(directory, { recursive: true, mode: 0o700 })
      const temporary = `${this.#file}.${process.pid}.${randomUUID()}.tmp`
      let handle
      try {
        handle = await open(temporary, 'wx', 0o600)
        await handle.writeFile(snapshot, 'utf8')
        await handle.sync()
        await handle.close()
        handle = undefined
        await rename(temporary, this.#file)
      } catch (error) {
        try { await handle?.close() } catch { /* best effort */ }
        await rm(temporary, { force: true }).catch(() => {})
        throw error
      }
    }).catch((error) => {
      this.#dirty = true
      throw error
    })
    return this.#writing
  }

  async dispose() {
    this.#closed = true
    try { await this.flush() } catch { /* the bridge logs persistence errors */ }
  }

  async #quarantine() {
    const backup = `${this.#file}.corrupt-${Date.now()}`
    try {
      await rename(this.#file, backup)
      this.#logger.warn?.(`[im-bot] 已把损坏的状态文件备份到 ${backup}`)
    } catch { /* best effort */ }
  }
}
