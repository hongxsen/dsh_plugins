/**
 * Pure browser helpers for the MCP Market panel.
 *
 * No React and no DOM access lives here: hashes, formatting, debounce, value
 * validation, and the fetch wrapper only need globals available in a browser
 * (and a tiny mock during tests).
 */

/** Locale namespace owned by this plugin. */
export const NS = 'mcpMarket'

/** Sidebar panel id; also the main slot key. */
export const PANEL_ID = 'mcp-market'

/** Same-origin API base. */
export const API_BASE = '/dsh-mcp-market/api'

/** The builtin source id, mirrored from the Host. */
export const BUILTIN_SOURCE_ID = 'mcp-registry'

/** Source kinds accepted by the Host. */
export const SOURCE_KINDS = Object.freeze(['mcp-registry', 'index'])

/** Maximum source title length, mirrored from the Host. */
export const MAX_SOURCE_TITLE = 80

/** Maximum source URL length, mirrored from the Host. */
export const MAX_SOURCE_URL = 2048

/** Search debounce, per the product contract. */
export const SEARCH_DEBOUNCE_MS = 300

/** Timeouts for the four browser requests. */
export const TIMEOUTS = Object.freeze({
  search: 20000,
  detail: 20000,
  preview: 120000,
  mutation: 30000,
})

/** Header/env value cap mirrored from the Host. */
export const MAX_VALUE_BYTES = 8192

/** Map a server error code to a dictionary key. */
export const ERROR_KEYS = Object.freeze({
  'mcp/invalid-query': 'error.invalidQuery',
  'mcp/fetch-failed': 'error.fetchFailed',
  'mcp/not-found': 'error.notFound',
  'mcp/invalid-entry': 'error.invalidEntry',
  'mcp/runtime-missing': 'error.runtimeMissing',
  'mcp/needs-input': 'error.needsInput',
  'mcp/already-installed': 'error.alreadyInstalled',
  'mcp/invalid-value': 'error.invalidValue',
  'mcp/not-managed': 'error.notManaged',
  'mcp/patch-failed': 'error.patchFailed',
  'mcp/install-failed': 'error.installFailed',
  'sources/invalid': 'error.sourcesInvalid',
  'sources/limit': 'error.sourcesLimit',
  'sources/not-found': 'error.sourcesNotFound',
  'sources/builtin': 'error.sourcesBuiltin',
  'sources/fetch-failed': 'error.sourcesFetchFailed',
  'sources/invalid-index': 'error.sourcesInvalidIndex',
  'request/timeout': 'error.timeout',
  'request/network': 'error.fetchFailed',
})

/** Map a warning code to a dictionary key. */
export const WARNING_KEYS = Object.freeze({
  'insecure-url': 'warning.insecureUrl',
  'secret-in-profile': 'warning.secretInProfile',
  'unpinned-version': 'warning.unpinnedVersion',
  'runtime-missing': 'warning.runtimeMissing',
  unsupported: 'warning.unsupported',
})

/** Replace `{name}` placeholders in one dictionary string. */
export function formatTemplate(template, params = {}) {
  if (typeof template !== 'string') return ''
  return template.replace(/\{([A-Za-z0-9_]+)\}/gu, (match, key) => (
    Object.hasOwn(params, key) ? String(params[key]) : match
  ))
}

/** Debounce a function, exposing `cancel()`. */
export function debounce(fn, delay = SEARCH_DEBOUNCE_MS) {
  let timer
  const wrapped = (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      fn(...args)
    }, delay)
  }
  wrapped.cancel = () => {
    clearTimeout(timer)
    timer = undefined
  }
  return wrapped
}

/** Deterministic hue for a name. */
export function hueFor(value) {
  const text = typeof value === 'string' ? value : ''
  let hash = 0
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0
  }
  return hash % 360
}

/** First visible character, used by the monogram avatar fallback. */
export function monogram(title, name = '') {
  const source = (typeof title === 'string' && title.trim().length > 0 ? title : String(name)).trim()
  const match = /[\p{L}\p{N}]/u.exec(source)
  return match === null ? '?' : match[0].toUpperCase()
}

/** ISO timestamp to a short, locale-neutral date; empty when invalid. */
export function formatDate(value) {
  if (typeof value !== 'string' || value.length === 0) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

/** Clip a string with an ellipsis. */
export function truncate(value, max) {
  const text = typeof value === 'string' ? value : ''
  if (!Number.isFinite(max) || max <= 0 || text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

/** Human-readable source title, localizing the builtin. */
export function displaySourceTitle(t, source) {
  if (source?.builtin === true || source?.id === BUILTIN_SOURCE_ID) return t('sources.builtinTitle')
  return typeof source?.title === 'string' ? source.title : ''
}

/** Localized label for one source kind. */
export function sourceKindLabel(t, kind) {
  return kind === 'index' ? t('sources.kind.index') : t('sources.kind.mcpRegistry')
}

/** Source label for one installed record; old records are official-registry rows. */
export function installedSourceLabel(t, row) {
  if (typeof row?.sourceTitle === 'string' && row.sourceTitle.length > 0) {
    return row.sourceId === BUILTIN_SOURCE_ID ? t('sources.builtinTitle') : row.sourceTitle
  }
  if (typeof row?.sourceId === 'string' && row.sourceId.length > 0) {
    return row.sourceId === BUILTIN_SOURCE_ID ? t('sources.builtinTitle') : row.sourceId
  }
  if (typeof row?.registryName === 'string' && row.registryName.length > 0) return t('sources.builtinTitle')
  return ''
}

/**
 * Validate the add-source form before the Host sees it.
 * @returns a map of field name to dictionary key, empty when valid.
 */
export function validateSourceDraft(draft) {
  const errors = {}
  const title = typeof draft?.title === 'string' ? draft.title.trim() : ''
  if (title.length === 0) errors.title = 'sources.field.titleRequired'
  else if (title.length > MAX_SOURCE_TITLE) errors.title = 'sources.field.titleTooLong'
  const rawUrl = typeof draft?.url === 'string' ? draft.url.trim() : ''
  const isIndex = draft?.kind === 'index'
  const localIndex = isIndex && (rawUrl.startsWith('~/') || rawUrl.startsWith('/') || rawUrl.startsWith('file:'))
  if (rawUrl.length === 0) {
    errors.url = 'sources.field.urlRequired'
  } else if (rawUrl.length > MAX_SOURCE_URL) {
    errors.url = 'sources.field.urlInvalid'
  } else if (!localIndex) {
    let parsed
    try {
      parsed = new URL(rawUrl)
    } catch {
      parsed = null
    }
    if (parsed === null
      || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      || parsed.username !== ''
      || parsed.password !== ''
      || rawUrl.includes('#')) {
      errors.url = 'sources.field.urlInvalid'
    }
  }
  if (!SOURCE_KINDS.includes(draft?.kind)) errors.kind = 'sources.field.kindInvalid'
  return errors
}

/** UTF-8 byte length without allocating a Blob. */
export function utf8Length(value) {
  if (typeof TextEncoder === 'function') return new TextEncoder().encode(String(value)).length
  return unescape(encodeURIComponent(String(value))).length
}

/**
 * Validate install-form fields before asking the Host.
 * @returns a map of field name to a dictionary error suffix (`required`, `tooLong`, `headerBreak`, `invalid`).
 */
export function validateFields(fields, values) {
  const errors = {}
  for (const field of fields ?? []) {
    const raw = values?.[field.name]
    const value = typeof raw === 'string' ? raw : ''
    if (field.required === true && field.hasDefault !== true && value.trim().length === 0) {
      errors[field.name] = 'required'
      continue
    }
    if (value.length === 0) continue
    if (utf8Length(value) > MAX_VALUE_BYTES) {
      errors[field.name] = 'tooLong'
      continue
    }
    if (field.kind === 'header' && /[\r\n]/u.test(value)) {
      errors[field.name] = 'headerBreak'
      continue
    }
    if (value.includes('\u0000')) errors[field.name] = 'invalid'
  }
  return errors
}

/** Create an Error with a stable code for the UI. */
export function codedError(code, message, details = undefined) {
  const error = new Error(message)
  error.code = code
  if (details !== undefined) error.details = details
  return error
}

/**
 * Fetch JSON from the plugin API and turn an `{ error }` envelope into a coded
 * Error. A timeout or offline failure is reported as `request/timeout` or
 * `request/network`, never as a parser crash.
 */
export async function requestJson(path, options = {}) {
  const controller = new AbortController()
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : TIMEOUTS.mutation
  const timer = setTimeout(() => { controller.abort() }, timeoutMs)
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  try {
    const init = {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    }
    if (options.body !== undefined) {
      init.headers['content-type'] = 'application/json'
      init.body = JSON.stringify(options.body)
    }
    let response
    try {
      response = await fetchImpl(`${API_BASE}${path}`, init)
    } catch (error) {
      if (error?.name === 'AbortError') throw codedError('request/timeout', 'Request timed out')
      throw codedError('request/network', 'Network request failed')
    }
    let text
    try {
      text = await response.text()
    } catch {
      throw codedError('request/invalid-response', 'Response could not be read')
    }
    let payload = null
    if (text.length > 0) {
      try {
        payload = JSON.parse(text)
      } catch {
        throw codedError('request/invalid-response', 'Response was not JSON')
      }
    }
    if (!response.ok) {
      const code = payload?.error?.code ?? 'request/failed'
      const message = payload?.error?.message ?? `HTTP ${response.status}`
      throw codedError(code, message, payload?.error?.details)
    }
    return payload
  } finally {
    clearTimeout(timer)
  }
}

/** Transport kinds present on one normalized entry. */
export function transportKinds(server) {
  const kinds = []
  if (Array.isArray(server?.remotes) && server.remotes.length > 0) kinds.push('remote')
  if (Array.isArray(server?.packages) && server.packages.some(pkg => pkg?.transport?.type === 'stdio')) kinds.push('package')
  return kinds
}

/** True when a catalog entry offers a supported install path. */
export function isInstallable(server) {
  return transportKinds(server).length > 0
}

/** Pick the initial choice key from a preview. */
export function defaultChoiceKey(preview) {
  if (preview === null || preview === undefined) return ''
  if (preview.kind === null) return ''
  return `${preview.kind}:${preview.index}`
}

/** Read a nested choice field safely. */
export function choiceAt(preview, key) {
  if (!Array.isArray(preview?.choices)) return null
  return preview.choices.find(choice => `${choice.kind}:${choice.index}` === key) ?? null
}
