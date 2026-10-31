/**
 * Pure browser helpers plus the same-origin Host client.
 *
 * Nothing here touches React or the DOM, so the module is unit-tested in Node
 * and inlined into the generated bundle by `build.mjs`.
 */

/** Default route prefix owned by the Host half. */
export const API_BASE = '/dsh-skills-market'

/** Fetch timeouts from the spec. */
export const TIMEOUTS = Object.freeze({
  search: 20000,
  detail: 20000,
  preview: 120000,
  mutation: 30000,
})

/** Cards cap catalog descriptions at this many characters. */
export const CARD_DESCRIPTION_LIMIT = 280

/**
 * FNV-1a hash of a string.
 * @param value - input.
 * @returns a non-negative 32-bit integer.
 */
export function hashString(value) {
  let hash = 0x811c9dc5
  const text = String(value ?? '')
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/**
 * Derive the deterministic monogram used where remote images are not required.
 * @param name - skill or repository name.
 * @returns `{ letter, hue }`; hue is stable for the same input.
 */
export function monogramOf(name) {
  const text = String(name ?? '').trim()
  const first = Array.from(text)[0] ?? '?'
  return {
    letter: first.toUpperCase(),
    hue: hashString(text) % 360,
  }
}

/**
 * Format an install count compactly (1.1M, 900K).
 * @param value - numeric install count.
 * @returns the compact label.
 */
export function formatCount(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return '0'
  const scale = (amount) => {
    if (amount >= 100) return amount.toFixed(0)
    if (amount >= 10) return amount.toFixed(1).replace(/\.0$/u, '')
    return amount.toFixed(1)
  }
  if (number >= 1_000_000_000) return `${scale(number / 1_000_000_000)}B`
  if (number >= 1_000_000) return `${scale(number / 1_000_000)}M`
  if (number >= 1_000) return `${scale(number / 1_000)}K`
  return String(Math.round(number))
}

/**
 * Format a byte count with binary units.
 * @param value - byte count.
 * @returns the label, e.g. `8.4 KB`.
 */
export function formatBytes(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return '0 B'
  if (number < 1024) return `${Math.round(number)} B`
  const units = ['KB', 'MB', 'GB']
  let amount = number / 1024
  let unit = units[0]
  for (let index = 1; index < units.length && amount >= 1024; index += 1) {
    amount /= 1024
    unit = units[index]
  }
  return `${amount >= 10 ? amount.toFixed(0) : amount.toFixed(1)} ${unit}`
}

/**
 * Clip text with an ellipsis when it exceeds the limit.
 * @param text - source text.
 * @param limit - maximum characters.
 * @returns the clipped text.
 */
export function clipText(text, limit) {
  const value = String(text ?? '')
  if (value.length <= limit) return value
  return `${value.slice(0, Math.max(0, limit - 1)).trimEnd()}…`
}

/**
 * Collapse whitespace and clip, for catalog descriptions.
 * @param text - source text.
 * @param limit - maximum characters.
 * @returns the normalized description.
 */
export function summarizeDescription(text, limit = CARD_DESCRIPTION_LIMIT) {
  return clipText(String(text ?? '').replace(/\s+/gu, ' ').trim(), limit)
}

/**
 * Stable key for one catalog entry.
 * @param entry - catalog entry or installed skill.
 * @returns `source/skillId` when available, else the name.
 */
export function skillKey(entry) {
  if (entry === null || typeof entry !== 'object') return ''
  if (typeof entry.source === 'string' && typeof entry.skillId === 'string') return `${entry.source}/${entry.skillId}`
  return typeof entry.name === 'string' ? entry.name : ''
}

/**
 * Normalize the Host search payload against untrusted data.
 * @param value - array from the Host.
 * @returns safe catalog entries.
 */
export function normalizeSkills(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const out = []
  for (const raw of value) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
    const source = typeof raw.source === 'string' ? raw.source : ''
    const skillId = typeof raw.skillId === 'string' ? raw.skillId : ''
    if (source === '' || skillId === '') continue
    const key = `${source}/${skillId}`
    if (seen.has(key)) continue
    seen.add(key)
    const entry = {
      id: typeof raw.id === 'string' && raw.id !== '' ? raw.id : key,
      source,
      skillId,
      name: typeof raw.name === 'string' && raw.name !== '' ? raw.name : skillId,
      installs: typeof raw.installs === 'number' && Number.isFinite(raw.installs)
        ? Math.max(0, Math.floor(raw.installs))
        : 0,
    }
    // These fields only appear for static index sources; leaving them out for
    // skills.sh keeps the lazy description path intact.
    if (typeof raw.description === 'string' && raw.description !== '') entry.description = raw.description
    if (typeof raw.pageUrl === 'string' && raw.pageUrl !== '') entry.pageUrl = raw.pageUrl
    if (typeof raw.market === 'string' && raw.market !== '') entry.market = raw.market
    out.push(entry)
  }
  return out
}

/**
 * Normalize one `source` metadata object attached to search/detail responses.
 * @param value - untrusted object.
 * @returns `{ id, kind, title, url }`, or `null`.
 */
export function normalizeSourceMeta(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const id = typeof value.id === 'string' ? value.id.trim() : ''
  if (id === '') return null
  return {
    id,
    kind: value.kind === 'index' ? 'index' : 'skills-sh',
    title: typeof value.title === 'string' && value.title !== '' ? value.title : id,
    url: typeof value.url === 'string' ? value.url : '',
  }
}

/** Source kinds the browser knows how to render. */
export const SOURCE_KINDS = Object.freeze(['skills-sh', 'index'])

/**
 * Normalize a source-store payload against untrusted data.
 * The builtin source is synthesized when the Host payload is unusable so the
 * switcher always has a valid option.
 * @param value - response from `GET /api/sources` or a mutation.
 * @returns `{ version, selected, sources }`.
 */
export function normalizeSources(value) {
  const document = value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const rawSources = Array.isArray(document.sources) ? document.sources : []
  const sources = []
  const seen = new Set()
  for (const raw of rawSources) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
    const id = typeof raw.id === 'string' ? raw.id.trim() : ''
    const title = typeof raw.title === 'string' ? raw.title.trim() : ''
    const url = typeof raw.url === 'string' ? raw.url.trim() : ''
    if (id === '' || title === '' || url === '' || seen.has(id)) continue
    if (!SOURCE_KINDS.includes(raw.kind)) continue
    seen.add(id)
    sources.push({ id, kind: raw.kind, title, url, builtin: raw.builtin === true })
  }
  if (sources.length === 0) {
    sources.push({
      id: 'skills-sh',
      kind: 'skills-sh',
      title: 'skills.sh',
      url: 'https://www.skills.sh',
      builtin: true,
    })
    seen.add('skills-sh')
  }
  const selected = typeof document.selected === 'string' && seen.has(document.selected)
    ? document.selected
    : sources[0].id
  return { version: 1, selected, sources }
}

/**
 * Normalize the Host installed payload against untrusted data.
 * @param value - array from the Host.
 * @returns safe installed entries.
 */
export function normalizeInstalled(value) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const raw of value) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
    if (typeof raw.name !== 'string' || raw.name === '') continue
    const entry = {
      name: raw.name,
      description: typeof raw.description === 'string' ? raw.description : '',
      managed: raw.managed === true,
      writable: raw.writable === true,
      warnings: typeof raw.warnings === 'number' && Number.isFinite(raw.warnings) ? Math.max(0, Math.floor(raw.warnings)) : 0,
      files: typeof raw.files === 'number' && Number.isFinite(raw.files) ? Math.max(0, Math.floor(raw.files)) : 0,
      totalBytes: typeof raw.totalBytes === 'number' && Number.isFinite(raw.totalBytes) ? Math.max(0, raw.totalBytes) : 0,
      valid: raw.valid !== false,
    }
    if (typeof raw.source === 'string') entry.source = raw.source
    if (typeof raw.installedAt === 'string') entry.installedAt = raw.installedAt
    if (typeof raw.path === 'string') entry.path = raw.path
    out.push(entry)
  }
  return out
}

/**
 * Format an ISO timestamp for the active locale.
 * @param value - ISO timestamp.
 * @param locale - active locale id.
 * @returns a short date, or an empty string when unparsable.
 */
export function formatDate(value, locale) {
  if (typeof value !== 'string' || value === '') return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const tag = String(locale ?? '').toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US'
  try {
    return new Intl.DateTimeFormat(tag, { year: 'numeric', month: 'short', day: 'numeric' }).format(date)
  } catch {
    return value.slice(0, 10)
  }
}

/**
 * Return an `https:` URL only when it is safe to render as a link.
 * @param value - candidate URL.
 * @returns the href, or `null`.
 */
export function safeHttpsUrl(value) {
  if (typeof value !== 'string' || value === '') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

/**
 * Return an `http:`/`https:` URL for a documentation link.
 * @param value - candidate URL.
 * @returns the href, or `null`.
 */
export function safePageUrl(value) {
  if (typeof value !== 'string' || value === '') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}

/**
 * Preferred page URL for a catalog entry.
 *
 * Index entries carry their own `pageUrl`; skills.sh entries fall back to the
 * active source's base so custom `skills-sh`-compatible markets keep their own
 * links.
 * @param entry - catalog entry.
 * @param source - active source metadata (optional).
 * @returns the page URL, or `null`.
 */
export function pageUrlOf(entry, source) {
  if (entry !== null && typeof entry === 'object') {
    const direct = safePageUrl(entry.pageUrl)
    if (direct !== null) return direct
  }
  if (entry === null || typeof entry !== 'object') return null
  const base = source !== null && typeof source === 'object'
    && source.kind === 'skills-sh'
    && typeof source.url === 'string' && source.url !== ''
    ? source.url.replace(/\/+$/u, '')
    : 'https://www.skills.sh'
  const [owner = '', repo = ''] = String(entry.source ?? '').split('/')
  return `${base}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(String(entry.skillId ?? ''))}`
}

/**
 * Debounce a function.
 * @param fn - callback.
 * @param wait - delay in milliseconds.
 * @returns a debounced function with a `cancel` method.
 */
export function debounce(fn, wait) {
  let timer = null
  const call = (...args) => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      fn(...args)
    }, wait)
  }
  call.cancel = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
  return call
}

/**
 * Turn an API error payload into a thrown error carrying the stable code.
 * @param payload - parsed JSON body.
 * @param status - HTTP status.
 * @returns the error.
 */
export function errorFromPayload(payload, status) {
  const code = payload !== null && typeof payload === 'object'
    && payload.error !== null && typeof payload.error === 'object'
    && typeof payload.error.code === 'string'
    ? payload.error.code
    : `http/${status}`
  const error = new Error('skills-market request failed')
  error.code = code
  error.status = status
  return error
}

/** Generate a code-carrying timeout error. */
function timeoutError() {
  const error = new Error('skills-market request timed out')
  error.code = 'timeout'
  return error
}

/**
 * Build the same-origin API client used by the page.
 * @param base - route prefix.
 * @param options.fetchImpl - fetch implementation (tests).
 * @returns the API methods with the spec's timeouts.
 */
export function createApiClient(base = API_BASE, options = {}) {
  const fetchImpl = options.fetchImpl ?? ((...args) => globalThis.fetch(...args))
  const request = async (path, { method = 'GET', query, body, timeoutMs = TIMEOUTS.mutation } = {}) => {
    const search = query === undefined ? '' : `?${new URLSearchParams(query).toString()}`
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    const timer = controller === null ? null : setTimeout(() => { controller.abort() }, timeoutMs)
    try {
      const headers = { accept: 'application/json' }
      const init = { method, credentials: 'same-origin', headers, signal: controller?.signal }
      if (body !== undefined) {
        headers['content-type'] = 'application/json'
        init.body = JSON.stringify(body)
      }
      let response
      try {
        response = await fetchImpl(`${base}${path}${search}`, init)
      } catch {
        if (controller?.signal.aborted === true) throw timeoutError()
        const error = new Error('skills-market network failure')
        error.code = 'network'
        throw error
      }
      let payload = null
      try {
        payload = await response.json()
      } catch {
        payload = null
      }
      if (response.ok !== true) throw errorFromPayload(payload, response.status)
      if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
        const error = new Error('skills-market returned an invalid response')
        error.code = 'invalid-response'
        throw error
      }
      return payload
    } finally {
      if (timer !== null) clearTimeout(timer)
    }
  }
  return {
    search: (query, sourceId) => request('/api/search', {
      query: sourceId === undefined ? { q: query } : { q: query, source: sourceId },
      timeoutMs: TIMEOUTS.search,
    }),
    detail: (source, skillId, market) => request('/api/detail', {
      // Legacy callers that omit `market` still use the `source` alias for repo.
      query: market === undefined
        ? { source, skill: skillId }
        : { repo: source, skill: skillId, market },
      timeoutMs: TIMEOUTS.detail,
    }),
    preview: (input) => request('/api/preview', { method: 'POST', body: input, timeoutMs: TIMEOUTS.preview }),
    previewLocal: (path) => request('/api/local/preview', { method: 'POST', body: { path }, timeoutMs: TIMEOUTS.preview }),
    install: (input) => request('/api/install', { method: 'POST', body: input, timeoutMs: TIMEOUTS.mutation }),
    installed: () => request('/api/installed', { timeoutMs: TIMEOUTS.mutation }),
    remove: (name) => request('/api/remove', { method: 'POST', body: { name }, timeoutMs: TIMEOUTS.mutation }),
    sources: () => request('/api/sources', { timeoutMs: TIMEOUTS.mutation }),
    addSource: (input) => request('/api/sources', {
      method: 'POST',
      body: { action: 'add', kind: input.kind, title: input.title, url: input.url },
      timeoutMs: TIMEOUTS.mutation,
    }),
    removeSource: (id) => request('/api/sources', {
      method: 'POST',
      body: { action: 'remove', id },
      timeoutMs: TIMEOUTS.mutation,
    }),
    selectSource: (id) => request('/api/sources', {
      method: 'POST',
      body: { action: 'select', id },
      timeoutMs: TIMEOUTS.mutation,
    }),
  }
}
