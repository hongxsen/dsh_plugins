/**
 * Platform-neutral normalized IM ↔ DSH bridge.
 *
 * Adapters own platform payloads and delivery write ordering. This class owns
 * allowlists, dedupe, per-chat serial queues, commands, DSH routes and recovery.
 */

import { randomUUID } from 'node:crypto'
import { executeCommand } from './commands.js'
import { runAgentTurn } from './session.js'
import { chatSlug, conversationKey, parseCommand, splitText } from './text.js'

const DENY_THROTTLE_MS = 5 * 60 * 1000

function validMessage(message, connectionId) {
  return message !== null && typeof message === 'object'
    && message.connectionId === connectionId
    && typeof message.platform === 'string' && message.platform !== ''
    && typeof message.eventId === 'string' && message.eventId !== ''
    && typeof message.chatId === 'string' && message.chatId !== ''
    && typeof message.userId === 'string' && message.userId !== ''
    && (message.chatType === 'direct' || message.chatType === 'group')
    && typeof message.text === 'string'
    && Number.isFinite(message.receivedAt)
}

export class ConversationBridge {
  #config
  #logger
  #store
  #agents
  #sessions
  #defaultSelection
  #createDelivery
  #getStatus
  #states = new Map()
  #dedupe = new Map()
  #drains = new Set()
  #startedAt = 0
  #closed = false

  constructor({ config, logger = console, store, agents, sessions, defaultSelection, createDelivery, getStatus }) {
    if (!config || !store || !agents || typeof createDelivery !== 'function') {
      throw new Error('[im-bot] ConversationBridge 缺少 config/store/agents/createDelivery')
    }
    this.#config = config
    this.#logger = logger
    this.#store = store
    this.#agents = agents
    this.#sessions = sessions
    this.#defaultSelection = defaultSelection
    this.#createDelivery = createDelivery
    this.#getStatus = getStatus
  }

  async start() {
    this.#closed = false
    this.#startedAt = Date.now()
    await this.#store.load()
  }

  snapshot() {
    return {
      connection: { ...(this.#getStatus?.() || {}) },
      uptimeMs: this.#startedAt ? Date.now() - this.#startedAt : 0,
      conversations: this.#states.size,
    }
  }

  /** Synchronous admission; task and command work continues in the background. */
  handleMessage(message) {
    if (this.#closed || !validMessage(message, this.#config.id)) return
    if (this.#dedupe.has(message.eventId)) return
    this.#dedupe.set(message.eventId, true)
    while (this.#dedupe.size > this.#config.maxDedupeEntries) {
      this.#dedupe.delete(this.#dedupe.keys().next().value)
    }

    let delivery
    try { delivery = this.#createDelivery(message) } catch (error) {
      this.#logger.error?.(`[im-bot] 创建消息投递失败：${error?.message ?? error}`)
      return
    }
    const state = this.#state(message)
    const text = message.text.trim()
    if (text === '') {
      void this.#noticeOnly(delivery, '没有读到文字内容，请发送文字消息。')
      return
    }
    if (!this.#allowed(message)) {
      const now = Date.now()
      const throttled = now - state.lastDeniedAt < DENY_THROTTLE_MS
      state.lastDeniedAt = now
      if (throttled) void this.#dispose(delivery)
      else void this.#noticeOnly(delivery, '当前用户或聊天不在允许名单中，消息未处理。')
      return
    }

    const command = parseCommand(text)
    if (command !== undefined) {
      void this.#runCommand(command, message, state, delivery)
      return
    }
    if (state.running && state.queue.length >= this.#config.maxQueue) {
      void this.#noticeOnly(delivery, `队列已满（最多等待 ${this.#config.maxQueue} 条），请稍后再试。`)
      return
    }

    const item = { message, delivery, epoch: state.epoch, cancelRequested: false }
    state.queue.push(item)
    if (state.running) {
      this.#call(delivery, 'ack', this.#config.queuedText)
    } else {
      state.running = true
      this.#call(delivery, 'ack', this.#config.ackText)
    }
    if (!state.welcomed && this.#config.welcomeText.trim() !== '') {
      state.welcomed = true
      this.#call(delivery, 'notice', this.#config.welcomeText)
    }
    if (state.drain) return
    const drain = this.#drain(state).finally(() => {
      this.#drains.delete(drain)
      if (state.drain === drain) state.drain = undefined
    })
    this.#drains.add(drain)
    state.drain = drain
    drain.catch((error) => this.#logger.error?.(`[im-bot] 会话队列异常：${error?.message ?? error}`))
  }

  async stop() {
    if (this.#closed) return
    this.#closed = true
    for (const state of this.#states.values()) {
      this.#cancelCurrent(state)
      const queued = state.queue.splice(0)
      await Promise.all(queued.map((item) => this.#noticeOnly(item.delivery, '连接正在停止，排队任务已取消。')))
    }
    await Promise.allSettled([...this.#drains])
    const handles = [...this.#states.values()].map((state) => state.handle).filter(Boolean)
    await Promise.allSettled(handles.map((handle) => handle.dispose()))
    await this.#store.dispose()
  }

  #state(message) {
    const key = conversationKey(message)
    let state = this.#states.get(key)
    if (state === undefined) {
      const record = this.#store.get(key)
      state = {
        key,
        queue: [],
        running: false,
        current: undefined,
        drain: undefined,
        epoch: 0,
        turns: record?.turns || 0,
        sessionId: record?.sessionId || '',
        record,
        agent: undefined,
        handle: undefined,
        lastDeniedAt: 0,
        welcomed: false,
      }
      this.#states.set(key, state)
    }
    return state
  }

  #allowed(message) {
    const { allowFrom, allowChats } = this.#config
    return (allowFrom.length === 0 || allowFrom.includes(message.userId))
      && (allowChats.length === 0 || allowChats.includes(message.chatId))
  }

  #selection() {
    const base = this.#defaultSelection?.() || {}
    return {
      ...base,
      provider: this.#config.provider || base.provider || '',
      model: this.#config.model || base.model || '',
      reasoningEffort: this.#config.reasoningEffort || base.reasoningEffort || '',
    }
  }

  #setup() {
    return (context) => {
      context.on('system-prompt/assemble', async (...args) => {
        const next = args.at(-1)
        const assembled = await next()
        const selected = this.#selection()
        const variables = { ...(assembled?.variables || {}) }
        if (selected.provider) variables.provider = selected.provider
        if (selected.model) variables.model = selected.model
        return { ...assembled, variables }
      })
      context.on('agent/request', async (...args) => {
        const next = args.at(-1)
        const routed = await next()
        const selected = this.#selection()
        return {
          ...routed,
          ...(selected.provider ? { provider: selected.provider } : {}),
          ...(selected.model ? { model: selected.model } : {}),
          ...(selected.reasoningEffort ? { reasoningEffort: selected.reasoningEffort } : {}),
        }
      })
    }
  }

  async #ensureAgent(state, message, expectedEpoch) {
    if (state.agent !== undefined) return state.agent
    const selected = this.#selection()
    const agentOptions = {
      ...(selected.provider ? { provider: selected.provider } : {}),
      ...(selected.model ? { model: selected.model } : {}),
    }
    const common = { meta: { cwd: this.#config.cwd }, agentOptions, setup: this.#setup() }
    const record = state.record || this.#store.get(state.key)

    if (record?.sessionId) {
      const live = this.#agents.get?.(record.sessionId)
      if (live !== undefined && live !== null) {
        state.agent = live
        state.sessionId = record.sessionId
        state.record = record
        return live
      }
      try {
        const handle = await this.#agents.resume({ ...common, resumeSessionId: record.sessionId })
        if (state.epoch !== expectedEpoch) {
          await handle.dispose()
          return undefined
        }
        state.handle = handle
        state.agent = handle.agent
        state.sessionId = record.sessionId
        state.record = record
        return handle.agent
      } catch (error) {
        this.#logger.warn?.(`[im-bot] 恢复会话 ${record.sessionId} 失败，将创建新会话：${error?.message ?? error}`)
      }
    }

    const sessionId = `im-${chatSlug(state.key)}-${randomUUID()}`
    const handle = await this.#agents.create({ ...common, sessionId })
    if (state.epoch !== expectedEpoch) {
      await handle.dispose()
      return undefined
    }
    const now = Date.now()
    state.handle = handle
    state.agent = handle.agent
    state.sessionId = sessionId
    state.record = {
      connectionId: message.connectionId,
      platform: message.platform,
      chatType: message.chatType,
      chatId: message.chatId,
      userId: message.userId,
      sessionId,
      createdAt: now,
      updatedAt: now,
      turns: state.turns,
    }
    this.#store.set(state.key, state.record)
    return handle.agent
  }

  async #drain(state) {
    try {
      while (state.queue.length > 0) {
      const item = state.queue.shift()
      state.current = item
      try {
        if (item.epoch !== state.epoch) continue
        item.controller = new AbortController()
        const agent = await this.#ensureAgent(state, item.message, item.epoch)
        if (agent === undefined || item.epoch !== state.epoch) continue
        item.agent = agent
        if (item.controller.signal.aborted) {
          await item.delivery.final('⏹ 已停止。')
          continue
        }
        const result = await runAgentTurn({
          agent,
          text: item.message.text,
          config: this.#config,
          logger: this.#logger,
          signal: item.controller.signal,
          onProgress: async (text) => {
            if (item.epoch === state.epoch) await item.delivery.progress(text)
          },
        })
        if (item.epoch !== state.epoch) continue

        state.turns += 1
        state.record = {
          ...state.record,
          connectionId: item.message.connectionId,
          platform: item.message.platform,
          chatType: item.message.chatType,
          chatId: item.message.chatId,
          userId: item.message.userId,
          sessionId: state.sessionId,
          createdAt: state.record?.createdAt || Date.now(),
          updatedAt: Date.now(),
          turns: state.turns,
        }
        this.#store.set(state.key, state.record)
        try {
          await this.#store.flush()
          await this.#sessions?.flush?.(agent.session)
        } catch (error) {
          this.#logger.error?.(`[im-bot] 持久化会话状态失败：${error?.message ?? error}`)
        }
        if (item.epoch !== state.epoch) continue
        const parts = splitText(result.text, this.#config.maxReplyChars)
        await item.delivery.final(parts[0])
        for (const part of parts.slice(1)) await item.delivery.notice(part)
      } catch (error) {
        this.#logger.error?.(`[im-bot] 任务执行失败：${error?.message ?? error}`)
        if (item.epoch === state.epoch) {
          try {
            const parts = splitText(`❌ 执行失败：${error?.message ?? error}`, this.#config.maxReplyChars)
            await item.delivery.final(parts[0])
            for (const part of parts.slice(1)) await item.delivery.notice(part)
          } catch (deliveryError) {
            // A broken platform delivery must not strand the remaining queue.
            this.#logger.warn?.(`[im-bot] 失败通知投递失败：${deliveryError?.message ?? deliveryError}`)
          }
        }
      } finally {
        await this.#dispose(item.delivery)
        if (state.current === item) state.current = undefined
      }
      }
    } finally {
      state.running = false
      state.current = undefined
    }
  }

  async #runCommand(command, message, state, delivery) {
    try {
      await executeCommand(command, {
        config: this.#config,
        message,
        state,
        delivery,
        snapshot: () => this.snapshot(),
        selection: () => this.#selection(),
        stop: async () => this.#stop(state),
        reset: async () => this.#reset(state),
      })
    } catch (error) {
      this.#logger.error?.(`[im-bot] 命令执行失败：${error?.message ?? error}`)
      try { await delivery.notice(`❌ 命令执行失败：${error?.message ?? error}`) } catch { /* adapter owns the error */ }
    } finally {
      await this.#dispose(delivery)
    }
  }

  #cancelCurrent(state) {
    const current = state.current
    if (current === undefined || current.cancelRequested) return false
    current.cancelRequested = true
    current.controller?.abort()
    try { current.agent?.cancel({ kind: 'user' }) } catch (error) {
      this.#logger.warn?.(`[im-bot] 取消任务失败：${error?.message ?? error}`)
    }
    return true
  }

  async #stop(state) {
    const stopped = this.#cancelCurrent(state)
    const queued = state.queue.splice(0)
    await Promise.all(queued.map((item) => this.#noticeOnly(item.delivery, '已停止，排队任务已取消。')))
    return stopped || queued.length > 0
  }

  async #reset(state) {
    state.epoch += 1
    this.#cancelCurrent(state)
    const queued = state.queue.splice(0)
    await Promise.all(queued.map((item) => this.#noticeOnly(item.delivery, '会话已重置，排队任务已取消。')))
    this.#store.delete(state.key)
    state.record = undefined
    state.sessionId = ''
    state.turns = 0
    state.agent = undefined
    const handle = state.handle
    state.handle = undefined
    if (handle) await handle.dispose()
    await this.#store.flush()
  }

  #call(delivery, method, text) {
    try {
      Promise.resolve(delivery[method](text)).catch((error) => {
        this.#logger.warn?.(`[im-bot] ${method} 投递失败：${error?.message ?? error}`)
      })
    } catch (error) {
      this.#logger.warn?.(`[im-bot] ${method} 投递失败：${error?.message ?? error}`)
    }
  }

  async #noticeOnly(delivery, text) {
    try { await delivery.notice(text) } catch (error) {
      this.#logger.warn?.(`[im-bot] notice 投递失败：${error?.message ?? error}`)
    } finally { await this.#dispose(delivery) }
  }

  async #dispose(delivery) {
    try { await delivery.dispose() } catch (error) {
      this.#logger.debug?.(`[im-bot] dispose 失败：${error?.message ?? error}`)
    }
  }
}
