/**
 * WeCom intelligent-robot WebSocket protocol and platform adapter.
 *
 * The protocol client deals only in JSON frames. The adapter is the sole place
 * that understands callback bodies and req_id/stream delivery; the shared core
 * receives normalized messages and uses the small delivery contract instead.
 *
 * @module @hongxsen/dsh-im-bot/platforms/wecom
 */

import { randomBytes, randomUUID } from 'node:crypto'
import { createWebSocket } from '../transport.js'

export const DEFAULT_WECOM_WS_URL = 'wss://openws.work.weixin.qq.com'

export const WS_CMD = Object.freeze({
  SUBSCRIBE: 'aibot_subscribe',
  HEARTBEAT: 'ping',
  RESPONSE: 'aibot_respond_msg',
  SEND_MSG: 'aibot_send_msg',
  CALLBACK: 'aibot_msg_callback',
  EVENT_CALLBACK: 'aibot_event_callback',
})

/** Unique request id in WeCom's documented prefix_timestamp_random form. */
export function generateReqId(prefix) {
  return `${prefix}_${Date.now()}_${randomBytes(4).toString('hex')}`
}

function protocolConfig(config) {
  return {
    wsUrl: DEFAULT_WECOM_WS_URL,
    requestTimeoutMs: 10_000,
    heartbeatIntervalMs: 30_000,
    reconnectInitialMs: 1_000,
    reconnectMaxMs: 30_000,
    debug: false,
    ...config,
  }
}

/** Raw WeCom frame client with req_id ack matching and ordered reply chains. */
export class WeComClient {
  #config
  #logger
  #factory
  #socket
  #pending = new Map()
  #replyChains = new Map()
  #heartbeatTimer
  #missedPings = 0
  #running = false
  #permanentStop = false
  #authenticated = false
  #state = 'stopped'
  #detail = ''
  #onlineSince = 0
  #reconnects = 0
  #lastMessageAt = 0
  #messageHandlers = new Set()
  #eventHandlers = new Set()
  #statusHandlers = new Set()
  #loopPromise
  #reconnectTimer
  #wakeReconnect

  constructor({ config, logger, webSocketFactory }) {
    this.#config = protocolConfig(config)
    this.#logger = logger ?? console
    this.#factory = webSocketFactory ?? createWebSocket
  }

  get status() {
    return {
      state: this.#state,
      detail: this.#detail,
      authenticated: this.#authenticated,
      onlineSince: this.#onlineSince,
      reconnects: this.#reconnects,
      lastMessageAt: this.#lastMessageAt,
    }
  }

  get connected() {
    return this.#authenticated
  }

  onMessage(handler) {
    this.#messageHandlers.add(handler)
    return () => this.#messageHandlers.delete(handler)
  }

  onEvent(handler) {
    this.#eventHandlers.add(handler)
    return () => this.#eventHandlers.delete(handler)
  }

  onStatus(handler) {
    this.#statusHandlers.add(handler)
    return () => this.#statusHandlers.delete(handler)
  }

  /** Begin connecting and keep reconnecting until stop or a permanent error. */
  start() {
    if (this.#running) return
    this.#running = true
    this.#permanentStop = false
    this.#loopPromise = this.#loop().catch((error) => {
      this.#logger.error?.(`[wecom] 连接循环异常退出：${error?.message ?? error}`)
      this.#setState('stopped', String(error?.message ?? error))
    })
  }

  async stop() {
    this.#running = false
    this.#authenticated = false
    this.#stopHeartbeat()
    this.#rejectPending('客户端已停止')
    this.#cancelReconnect()
    try {
      this.#socket?.close()
    } catch {
      /* already closed */
    }
    this.#socket = undefined
    this.#setState('stopped', '')
    // A stopped client must not leave an authentication or reconnect loop alive.
    await this.#loopPromise?.catch(() => {})
  }

  #cancelReconnect() {
    clearTimeout(this.#reconnectTimer)
    this.#reconnectTimer = undefined
    const wake = this.#wakeReconnect
    this.#wakeReconnect = undefined
    wake?.()
  }

  #waitReconnect(ms) {
    return new Promise((resolve) => {
      this.#wakeReconnect = resolve
      this.#reconnectTimer = setTimeout(() => {
        this.#reconnectTimer = undefined
        this.#wakeReconnect = undefined
        resolve()
      }, ms)
      this.#reconnectTimer.unref?.()
    })
  }

  async replyStream(reqId, streamId, content, finish) {
    return this.#enqueue(reqId, {
      cmd: WS_CMD.RESPONSE,
      headers: { req_id: reqId },
      body: {
        msgtype: 'stream',
        stream: { id: streamId, finish: Boolean(finish), content: String(content ?? '') },
      },
    })
  }

  async sendMarkdown(chatid, content) {
    const reqId = generateReqId(WS_CMD.SEND_MSG)
    return this.#enqueue(reqId, {
      cmd: WS_CMD.SEND_MSG,
      headers: { req_id: reqId },
      body: { chatid, msgtype: 'markdown', markdown: { content: String(content ?? '') } },
    })
  }

  async request(frame, timeoutMs = this.#config.requestTimeoutMs) {
    return this.#sendAndWait(frame.headers.req_id, frame, timeoutMs)
  }

  async #loop() {
    let delay = this.#config.reconnectInitialMs
    while (this.#running && !this.#permanentStop) {
      this.#setState(this.#reconnects === 0 ? 'connecting' : 'reconnecting')
      try {
        await this.#session()
      } catch (error) {
        this.#logger.warn?.(`[wecom] 连接失败：${error?.message ?? error}`)
        this.#setState('reconnecting', String(error?.message ?? error))
      }
      if (!this.#running || this.#permanentStop) break
      this.#reconnects += 1
      this.#logger.info?.(`[wecom] ${Math.round(delay / 1000)}s 后重连（第 ${this.#reconnects} 次）`)
      this.#setState('reconnecting')
      await this.#waitReconnect(delay)
      delay = Math.min(delay * 2, this.#config.reconnectMaxMs)
    }
    this.#setState('stopped', this.#permanentStop ? this.#detail : '')
  }

  #session() {
    return new Promise((resolve) => {
      let settled = false
      const settle = () => {
        if (settled) return
        settled = true
        if (this.#socket === socket) this.#socket = undefined
        this.#authenticated = false
        this.#stopHeartbeat()
        this.#rejectPending('连接已断开')
        resolve()
      }

      let socket
      try {
        socket = this.#factory(this.#config.wsUrl)
      } catch (error) {
        settle()
        this.#logger.error?.(`[wecom] 无法创建 WebSocket：${error?.message ?? error}`)
        return
      }
      this.#socket = socket

      socket.addEventListener('open', () => {
        if (!this.#running || this.#permanentStop || this.#socket !== socket) {
          try {
            socket.close()
          } catch {
            /* already closed */
          }
          return
        }
        this.#authenticate(socket).catch((error) => {
          this.#logger.error?.(`[wecom] 认证流程异常：${error?.message ?? error}`)
        })
      })
      socket.addEventListener('message', (event) => {
        if (this.#running && this.#socket === socket) this.#onData(event?.data)
      })
      socket.addEventListener('error', (event) => {
        const detail = event?.error?.message ?? event?.message ?? 'WebSocket 错误'
        this.#logger.warn?.(`[wecom] ${detail}`)
        this.#detail = String(detail)
      })
      socket.addEventListener('close', (event) => {
        const reason = event?.reason ? String(event.reason) : ''
        const code = event?.code ?? ''
        if (!this.#permanentStop) this.#detail = `连接关闭 ${code} ${reason}`.trim()
        this.#logger.warn?.(`[wecom] ${this.#detail}`)
        settle()
      })
    })
  }

  async #authenticate(socket) {
    if (!this.#running || this.#permanentStop || this.#socket !== socket) return
    this.#setState('authenticating')
    const reqId = generateReqId(WS_CMD.SUBSCRIBE)
    const ack = await this.#sendAndWait(reqId, {
      cmd: WS_CMD.SUBSCRIBE,
      headers: { req_id: reqId },
      body: { bot_id: this.#config.botId, secret: this.#config.secret },
    }, this.#config.requestTimeoutMs)

    if (!this.#running || this.#permanentStop || this.#socket !== socket) return
    // A disconnect rejects pending requests; it is retryable, not bad auth.
    if (ack?.error !== undefined && ack?.timeout !== true) return
    if (ack?.timeout === true) {
      this.#logger.error?.('[wecom] 认证超时：服务器没有在规定时间内回执 bot_id/secret')
      this.#detail = '认证超时'
      try {
        socket.close()
      } catch {
        /* expected */
      }
      return
    }
    if (ack?.errcode !== 0) {
      const message = `errcode=${ack?.errcode ?? '?'} ${ack?.errmsg ?? ''}`.trim()
      this.#logger.error?.(`[wecom] 认证失败：${message}。请核对机器人 ID / Secret，以及该机器人是否已开启长连接能力。`)
      this.#detail = `认证失败（${message}）`
      this.#permanentStop = true
      try {
        socket.close()
      } catch {
        /* expected */
      }
      return
    }

    this.#authenticated = true
    this.#onlineSince = Date.now()
    this.#missedPings = 0
    this.#setState('online')
    this.#logger.info?.('[wecom] 智能机器人长连接已认证，等待消息')
    this.#startHeartbeat()
  }

  #onData(raw) {
    if (typeof raw !== 'string' && !(raw instanceof ArrayBuffer)) {
      this.#logger.warn?.('[wecom] 收到非文本帧，已忽略')
      return
    }
    let frame
    try {
      const text = typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8')
      frame = JSON.parse(text)
    } catch (error) {
      this.#logger.warn?.(`[wecom] 无法解析服务器帧：${error?.message ?? error}`)
      return
    }
    if (frame === null || typeof frame !== 'object') return

    if (frame.cmd === WS_CMD.CALLBACK) {
      this.#lastMessageAt = Date.now()
      this.#dispatch(this.#messageHandlers, frame)
      return
    }
    if (frame.cmd === WS_CMD.EVENT_CALLBACK) {
      const event = frame.body?.event
      if (event?.eventtype === 'disconnected_event') {
        this.#logger.warn?.('[wecom] 服务器告知有新的连接顶替了当前连接，停止自动重连')
        this.#permanentStop = true
        this.#detail = '连接被新实例顶替'
        this.#setState('stopped', this.#detail)
        try {
          this.#socket?.close()
        } catch {
          /* expected */
        }
        return
      }
      this.#dispatch(this.#eventHandlers, frame)
      return
    }

    const reqId = frame.headers?.req_id
    if (typeof reqId === 'string' && reqId !== '') {
      const settle = this.#pending.get(reqId)
      if (settle !== undefined) {
        this.#pending.delete(reqId)
        settle(frame)
        return
      }
    }
    if (this.#config.debug) this.#logger.info?.(`[wecom] 未匹配的帧：${JSON.stringify(frame).slice(0, 200)}`)
  }

  #dispatch(handlers, frame) {
    for (const handler of handlers) {
      try {
        const result = handler(frame)
        if (result !== undefined && typeof result.then === 'function') {
          result.then(undefined, (error) => {
            this.#logger.error?.(`[wecom] 消息处理失败：${error?.stack ?? error}`)
          })
        }
      } catch (error) {
        this.#logger.error?.(`[wecom] 消息处理失败：${error?.stack ?? error}`)
      }
    }
  }

  #sendAndWait(reqId, frame, timeoutMs) {
    if (this.#socket === undefined) {
      return Promise.resolve({ error: 'not-connected', timeout: false })
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#pending.delete(reqId)
        resolve({ timeout: true })
      }, Math.max(1000, timeoutMs))
      timer.unref?.()
      this.#pending.set(reqId, (ack) => {
        clearTimeout(timer)
        resolve(ack)
      })
      try {
        this.#socket.send(JSON.stringify(frame))
      } catch (error) {
        clearTimeout(timer)
        this.#pending.delete(reqId)
        resolve({ error: String(error?.message ?? error) })
      }
    })
  }

  /** Stream frames sharing a callback req_id must never overtake each other. */
  #enqueue(reqId, frame) {
    if (this.#socket === undefined || !this.#authenticated) {
      return Promise.resolve({ error: 'not-connected' })
    }
    const previous = this.#replyChains.get(reqId) ?? Promise.resolve()
    const next = previous
      .catch(() => {})
      .then(() => this.#sendAndWait(reqId, frame, this.#config.requestTimeoutMs))
      .then((ack) => {
        if (ack?.errcode !== undefined && ack.errcode !== 0) {
          this.#logger.warn?.(`[wecom] 发送回执错误 errcode=${ack.errcode} ${ack.errmsg ?? ''}`)
        }
        return ack
      })
    this.#replyChains.set(reqId, next)
    next.finally(() => {
      if (this.#replyChains.get(reqId) === next) this.#replyChains.delete(reqId)
    })
    return next
  }

  #startHeartbeat() {
    this.#stopHeartbeat()
    this.#heartbeatTimer = setInterval(() => {
      if (!this.#authenticated) return
      if (this.#missedPings >= 3) {
        this.#logger.warn?.('[wecom] 连续 3 次心跳无回执，主动断开重连')
        this.#detail = '心跳超时'
        try {
          this.#socket?.close()
        } catch {
          /* expected */
        }
        return
      }
      const reqId = generateReqId(WS_CMD.HEARTBEAT)
      this.#missedPings += 1
      this.#sendAndWait(reqId, { cmd: WS_CMD.HEARTBEAT, headers: { req_id: reqId } }, this.#config.requestTimeoutMs)
        .then((ack) => {
          if (ack?.errcode === 0) this.#missedPings = 0
        })
        .catch(() => {})
    }, this.#config.heartbeatIntervalMs)
    this.#heartbeatTimer.unref?.()
  }

  #stopHeartbeat() {
    if (this.#heartbeatTimer !== undefined) {
      clearInterval(this.#heartbeatTimer)
      this.#heartbeatTimer = undefined
    }
  }

  #rejectPending(reason) {
    for (const [reqId, settle] of this.#pending) {
      this.#pending.delete(reqId)
      settle({ error: reason })
    }
    this.#replyChains.clear()
  }

  #setState(state, detail = '') {
    this.#state = state
    if (state === 'online') this.#detail = ''
    else if (detail !== '') this.#detail = detail
    const snapshot = this.status
    for (const handler of this.#statusHandlers) {
      try {
        handler(snapshot)
      } catch (error) {
        this.#logger.warn?.(`[wecom] 状态回调失败：${error?.message ?? error}`)
      }
    }
  }
}

function pushText(parts, value) {
  const text = String(value ?? '').trim()
  if (text !== '') parts.push(text)
}

/** Extract readable text while preserving the original voice/mixed/quote behavior. */
function extractText(body) {
  const parts = []
  switch (body.msgtype) {
    case 'text':
      pushText(parts, body.text?.content)
      break
    case 'markdown':
      pushText(parts, body.markdown?.content)
      break
    case 'voice':
      pushText(parts, body.voice?.content)
      break
    case 'mixed':
      for (const item of body.mixed?.msg_item ?? []) {
        if (item?.msgtype === 'text') pushText(parts, item.text?.content)
        else if (item?.msgtype === 'markdown') pushText(parts, item.markdown?.content)
      }
      break
    default:
  }
  const quote = body.quote
  if (quote !== undefined && quote !== null) {
    const quoted = quote.text?.content ?? quote.markdown?.content ?? quote.voice?.content ?? ''
    if (String(quoted).trim() !== '') parts.unshift(`[引用] ${String(quoted).trim()}`)
  }
  return parts.join('\n').trim()
}

/** Convert one raw aibot_msg_callback to the platform-independent core shape. */
export function normalizeWeComMessage(frame, connectionId = 'wecom') {
  const body = frame?.body
  const reqId = frame?.headers?.req_id
  if (body === null || typeof body !== 'object' || typeof reqId !== 'string' || reqId === '') return undefined
  const group = body.chattype === 'group'
  const userId = String(body.from?.userid ?? '')
  const chatId = group
    ? String(body.chatid ?? '')
    : String(body.from?.userid ?? body.chatid ?? '')
  if (chatId === '') return undefined
  return {
    connectionId: String(connectionId),
    platform: 'wecom',
    eventId: String(body.msgid ?? reqId),
    chatId,
    userId,
    chatType: group ? 'group' : 'direct',
    text: extractText(body),
    receivedAt: Date.now(),
    replyContext: { reqId, chatId },
  }
}

/** Conservative reply chunks, preferring line and word boundaries. */
function splitText(text, max = 3000) {
  const value = String(text ?? '')
  if (value === '') return ['']
  const limit = Math.max(64, Math.floor(Number(max) || 3000))
  if (value.length <= limit) return [value]
  const parts = []
  let rest = value
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit)
    if (cut < limit * 0.5) cut = rest.lastIndexOf(' ', limit)
    if (cut < limit * 0.5) cut = limit
    const part = rest.slice(0, cut).replace(/\s+$/, '')
    if (part !== '') parts.push(part)
    rest = rest.slice(cut).replace(/^\s+/, '')
  }
  if (rest !== '') parts.push(rest)
  return parts.length > 0 ? parts : ['']
}

function ensureAcknowledged(ack) {
  if (ack?.errcode === 0) return ack
  const detail = ack?.errcode !== undefined
    ? `errcode=${ack.errcode} ${ack.errmsg ?? ''}`.trim()
    : ack?.timeout === true
      ? '回执超时'
      : String(ack?.error ?? '未知回执')
  throw new Error(`[wecom] 投递失败：${detail}`)
}

/** Per-message ordered delivery; no platform state leaks into the shared core. */
export class WeComDelivery {
  #client
  #logger
  #reqId
  #chatId
  #streamId
  #maxReplyChars
  #chain = Promise.resolve()
  #disposed = false

  constructor({ client, message, config, logger }) {
    this.#client = client
    this.#logger = logger ?? console
    this.#reqId = message?.replyContext?.reqId
    this.#chatId = message?.replyContext?.chatId ?? message?.chatId
    this.#streamId = message?.replyContext?.streamId ?? `stream_${Date.now()}_${randomUUID().slice(0, 8)}`
    this.#maxReplyChars = config.maxReplyChars ?? 3000
    if (typeof this.#reqId !== 'string' || this.#reqId === '') {
      throw new TypeError('[wecom] createDelivery requires replyContext.reqId')
    }
  }

  ack(text) {
    return this.#reply(text, false)
  }

  progress(text) {
    return this.#reply(text, false)
  }

  final(text) {
    return this.#enqueue(async () => {
      const parts = splitText(text, this.#maxReplyChars)
      let ack = ensureAcknowledged(await this.#client.replyStream(this.#reqId, this.#streamId, parts[0], true))
      for (const part of parts.slice(1)) {
        ack = ensureAcknowledged(await this.#client.sendMarkdown(this.#chatId, part))
      }
      return ack
    })
  }

  notice(text) {
    return this.#enqueue(() => this.#client.sendMarkdown(this.#chatId, text))
  }

  async dispose() {
    this.#disposed = true
    await this.#chain.catch(() => {})
  }

  #reply(text, finish) {
    return this.#enqueue(() => this.#client.replyStream(this.#reqId, this.#streamId, text, finish))
  }

  #enqueue(operation) {
    if (this.#disposed) return Promise.reject(new Error('[wecom] delivery 已释放'))
    const next = this.#chain.catch(() => {}).then(async () => {
      if (this.#disposed) throw new Error('[wecom] delivery 已释放')
      try {
        return ensureAcknowledged(await operation())
      } catch (error) {
        this.#logger.warn?.(`[wecom] ${error?.message ?? error}`)
        throw error
      }
    })
    this.#chain = next
    return next
  }
}

/**
 * Unified adapter contract consumed by the plugin's multi-connection registry.
 * options are intentionally injectable so protocol tests need no credentials.
 */
export function createWeComAdapter(config, options = {}) {
  const logger = options.logger ?? console
  const connectionId = config.connectionId ?? config.id ?? 'wecom'
  const client = options.client ?? new WeComClient({
    config,
    logger,
    webSocketFactory: options.webSocketFactory,
  })
  let running = false
  let unsubscribes = []
  let handlers = {}

  const reportError = (error) => {
    try {
      const result = handlers.onError?.(error)
      Promise.resolve(result).catch((nested) => logger.warn?.(`[wecom] onError 回调失败：${nested?.message ?? nested}`))
    } catch (nested) {
      logger.warn?.(`[wecom] onError 回调失败：${nested?.message ?? nested}`)
    }
  }

  return {
    type: 'wecom',
    client,
    get status() {
      return client.status
    },

    async start(nextHandlers = {}) {
      if (running) return
      running = true
      handlers = nextHandlers
      unsubscribes = [
        client.onMessage((frame) => {
          const message = normalizeWeComMessage(frame, connectionId)
          if (message === undefined) return
          try {
            Promise.resolve(handlers.onMessage?.(message)).catch(reportError)
          } catch (error) {
            reportError(error)
          }
        }),
        client.onStatus((status) => {
          if (status.state === 'online') {
            try {
              Promise.resolve(handlers.onReady?.(status)).catch(reportError)
            } catch (error) {
              reportError(error)
            }
          } else if (running && status.state === 'stopped' && status.detail !== '') {
            reportError(new Error(`[wecom] ${status.detail}`))
          }
        }),
      ]
      try {
        client.start()
      } catch (error) {
        running = false
        for (const unsubscribe of unsubscribes) unsubscribe()
        unsubscribes = []
        reportError(error)
        throw error
      }
    },

    async stop() {
      running = false
      for (const unsubscribe of unsubscribes.splice(0)) unsubscribe()
      await client.stop()
    },

    createDelivery(message) {
      return new WeComDelivery({ client, message, config, logger })
    },
  }
}
