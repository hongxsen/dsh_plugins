/**
 * Strict validation for the multi-connection IM configuration.
 *
 * No legacy top-level credential shape is accepted. Environment variables are
 * expanded only when the complete value is an explicit `${NAME}` reference.
 *
 * @module @hongxsen/dsh-im-bot/config
 */

import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

export const DEFAULT_WS_URL = 'wss://openws.work.weixin.qq.com'
export const CONNECTION_TYPES = Object.freeze(['wecom', 'qq', 'feishu'])

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const ENV_PATTERN = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/
const PLATFORM_LABELS = { wecom: '企业微信', qq: 'QQ', feishu: '飞书' }

function stringList(value, field, id) {
  if (value === undefined || value === null || value === '') return []
  const items = Array.isArray(value) ? value : String(value).split(',')
  const out = []
  for (const item of items) {
    const text = String(item ?? '').trim()
    if (text !== '' && !out.includes(text)) out.push(text)
  }
  if (items.length > 0 && out.length === 0) {
    throw new Error(`[im-bot] 连接 ${id} 的 ${field} 必须是非空字符串或字符串数组`)
  }
  return out
}

function positiveInt(value, field, fallback, id) {
  if (value === undefined || value === null || value === '') return fallback
  const number = Number(value)
  const normalized = Math.floor(number)
  if (!Number.isFinite(number) || normalized < 1) {
    throw new Error(`[im-bot] 连接 ${id} 的 ${field} 归一化后必须是至少为 1 的整数，收到 ${String(value)}`)
  }
  return normalized
}

function credential(value, field, id, env) {
  const text = String(value ?? '').trim()
  const match = ENV_PATTERN.exec(text)
  if (match === null) return text
  const name = match[1]
  const expanded = String(env[name] ?? '').trim()
  if (expanded === '') {
    throw new Error(`[im-bot] 连接 ${id} 的 ${field} 引用的环境变量 ${name} 未设置或为空`)
  }
  return expanded
}

/** Expand `~`, and resolve relative paths against `base` (process cwd by default). */
export function resolvePath(input, fallback, base = process.cwd()) {
  const defaultPath = fallback ?? base
  if (input === undefined || input === null || input === '') return defaultPath
  const text = String(input).trim()
  if (text === '') return defaultPath
  const expanded = text === '~' || text.startsWith('~/') ? join(homedir(), text.slice(1)) : text
  return isAbsolute(expanded) ? expanded : resolve(base, expanded)
}

/** Resolve DSH home without implicitly expanding any credential variables. */
export function resolveDshHome(configured, { env = process.env } = {}) {
  if (configured !== undefined && configured !== null && String(configured).trim() !== '') {
    return resolvePath(configured)
  }
  const fromEnv = env.DSH_HOME
  if (fromEnv !== undefined && String(fromEnv).trim() !== '') return resolvePath(fromEnv)
  return join(homedir(), '.dsh')
}

/**
 * Validate one connection. The assembler calls this independently for every
 * entry so one bad connection can remain dormant without disabling its peers.
 */
export function normalizeConnection(raw, { env = process.env, dshHome } = {}) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('[im-bot] connections 的每一项都必须是对象')
  }
  const id = String(raw.id ?? '').trim()
  if (!ID_PATTERN.test(id)) {
    throw new Error(`[im-bot] 连接 id “${id}” 非法：须以字母或数字开头，只含字母、数字、_、-，最长 64 字符`)
  }
  const type = String(raw.type ?? '').trim()
  if (!CONNECTION_TYPES.includes(type)) {
    throw new Error(`[im-bot] 连接 ${id} 的 type 必须是 wecom、qq 或 feishu`)
  }
  const enabled = raw.enabled !== false
  const botId = type === 'wecom' ? credential(raw.botId, 'botId', id, env) : ''
  const secret = type === 'wecom' ? credential(raw.secret, 'secret', id, env) : ''
  const appId = type === 'wecom' ? '' : credential(raw.appId, 'appId', id, env)
  const appSecret = type === 'wecom' ? '' : credential(raw.appSecret, 'appSecret', id, env)

  if (type === 'wecom') {
    if ((botId === '') !== (secret === '')) throw new Error(`[im-bot] 连接 ${id} 必须同时配置 botId 与 secret`)
    if (enabled && botId === '') throw new Error(`[im-bot] 启用的企微连接 ${id} 缺少 botId 与 secret`)
  } else {
    if ((appId === '') !== (appSecret === '')) throw new Error(`[im-bot] 连接 ${id} 必须同时配置 appId 与 appSecret`)
    if (enabled && appId === '') throw new Error(`[im-bot] 启用的 ${type} 连接 ${id} 缺少 appId 与 appSecret`)
  }

  const home = resolveDshHome(raw.dshHome ?? dshHome, { env })
  const stateFile = raw.stateFile
    ? resolvePath(raw.stateFile)
    : join(home, 'storages', 'dsh-im-bot', `${id}.json`)
  const textOrEmpty = (value) => value === undefined || value === null ? '' : String(value).trim()
  const optionalUrl = (value) => value === undefined || value === null ? '' : String(value).trim()

  return Object.freeze({
    id,
    type,
    platformLabel: PLATFORM_LABELS[type],
    enabled,
    botId,
    secret,
    appId,
    appSecret,
    wsUrl: String(raw.wsUrl ?? DEFAULT_WS_URL).trim() || DEFAULT_WS_URL,
    sandbox: raw.sandbox === true,
    apiBaseUrl: optionalUrl(raw.apiBaseUrl),
    gatewayUrl: optionalUrl(raw.gatewayUrl),
    domain: optionalUrl(raw.domain),
    allowFrom: Object.freeze(stringList(raw.allowFrom, 'allowFrom', id)),
    allowChats: Object.freeze(stringList(raw.allowChats, 'allowChats', id)),
    cwd: resolvePath(raw.cwd),
    provider: textOrEmpty(raw.provider),
    model: textOrEmpty(raw.model),
    reasoningEffort: textOrEmpty(raw.reasoningEffort),
    ackText: String(raw.ackText ?? '收到，开始处理…'),
    queuedText: String(raw.queuedText ?? '前面还有任务，已排队，轮到你了会自动开始。'),
    welcomeText: String(raw.welcomeText ?? ''),
    helpText: raw.helpText ? String(raw.helpText) : '',
    streamUpdates: raw.streamUpdates !== false,
    streamIntervalMs: positiveInt(raw.streamIntervalMs, 'streamIntervalMs', 1500, id),
    maxStreamUpdates: positiveInt(raw.maxStreamUpdates, 'maxStreamUpdates', 80, id),
    pollIntervalMs: positiveInt(raw.pollIntervalMs, 'pollIntervalMs', 250, id),
    turnTimeoutMs: positiveInt(raw.turnTimeoutMs, 'turnTimeoutMs', 10 * 60 * 1000, id),
    maxReplyChars: positiveInt(raw.maxReplyChars, 'maxReplyChars', 3000, id),
    maxQueue: positiveInt(raw.maxQueue, 'maxQueue', 20, id),
    maxDedupeEntries: positiveInt(raw.maxDedupeEntries, 'maxDedupeEntries', 256, id),
    heartbeatIntervalMs: positiveInt(raw.heartbeatIntervalMs, 'heartbeatIntervalMs', 30_000, id),
    requestTimeoutMs: positiveInt(raw.requestTimeoutMs, 'requestTimeoutMs', 10_000, id),
    reconnectInitialMs: positiveInt(raw.reconnectInitialMs, 'reconnectInitialMs', 1000, id),
    reconnectMaxMs: positiveInt(raw.reconnectMaxMs, 'reconnectMaxMs', 30_000, id),
    stateFile,
    debug: raw.debug === true,
  })
}

/** Strict convenience API for callers that want all-or-nothing validation. */
export function normalizeConfig(raw, options = {}) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.connections)) {
    throw new Error('[im-bot] 配置必须只使用 connections 数组；不支持旧版顶层凭据')
  }
  const ids = new Set()
  const files = new Set()
  const connections = raw.connections.map((entry) => {
    const connection = normalizeConnection(entry, { ...options, dshHome: entry?.dshHome ?? raw.dshHome })
    if (ids.has(connection.id)) throw new Error(`[im-bot] 连接 id ${connection.id} 必须唯一`)
    if (files.has(connection.stateFile)) throw new Error(`[im-bot] stateFile 必须按连接独立：${connection.stateFile}`)
    ids.add(connection.id)
    files.add(connection.stateFile)
    return connection
  })
  return Object.freeze({ connections: Object.freeze(connections) })
}
