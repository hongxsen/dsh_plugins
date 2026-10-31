/**
 * Static JSON index sources.
 *
 * A custom `index` source is a plain JSON document served over HTTP(S). This
 * module owns the format contract (format 1, at most 2000 servers), the bounded
 * fetch (10 s, 2 MiB), normalization through the official-registry normalizer,
 * and the five-minute cache keyed by source id + URL.
 *
 * The cache only stores successful documents: a source that is offline or
 * malformed is retried on the next request instead of being remembered as a
 * permanent failure.
 */
import { readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { isPlainObject, sourcesError } from './errors.js'
import { normalizeServer } from './registry.js'

/** The only supported index format. */
export const INDEX_FORMAT = 1

/** Entries per index document. */
export const MAX_INDEX_SERVERS = 2000

/** Bytes accepted for one index response. */
export const MAX_INDEX_BYTES = 2 * 1024 * 1024

/** Milliseconds allowed for one index response. */
export const INDEX_TIMEOUT_MS = 10_000

/** How long a successful index document is reused. */
export const INDEX_CACHE_TTL_MS = 5 * 60 * 1000

/** Empty index results are capped like the official first page. */
export const INDEX_SEARCH_LIMIT = 30

/** User agent shared by the bounded fetchers. */
const USER_AGENT = 'dsh-mcp-market/0.3.0 (+https://github.com/hongxsen/dsh_plugins)'

/** Case-insensitive title-then-name ordering used by the index browser. */
function compareServers(a, b) {
  const titleA = a.title.toLowerCase()
  const titleB = b.title.toLowerCase()
  if (titleA !== titleB) return titleA < titleB ? -1 : 1
  const nameA = a.name.toLowerCase()
  const nameB = b.name.toLowerCase()
  if (nameA !== nameB) return nameA < nameB ? -1 : 1
  return 0
}

/**
 * Validate and normalize one raw index document.
 *
 * `servers` entries may be raw server objects or official-registry
 * `{ server: {...} }` records. Entries that fail normalization (or use an
 * unsupported remote/package) are dropped exactly like the official path.
 *
 * @param payload - parsed JSON document.
 * @returns `{ format, title, servers }` with normalized registry entries.
 * @throws ApiError `sources/invalid-index` when the envelope is invalid.
 */
export function parseIndexDocument(payload) {
  if (!isPlainObject(payload)) {
    throw sourcesError('invalid-index', 'The JSON index must be a JSON object.', 400)
  }
  if (payload.format !== INDEX_FORMAT) {
    throw sourcesError('invalid-index', 'The JSON index must declare "format": 1.', 400)
  }
  if (!Array.isArray(payload.servers)) {
    throw sourcesError('invalid-index', 'The JSON index must contain a "servers" array.', 400)
  }
  if (payload.servers.length > MAX_INDEX_SERVERS) {
    throw sourcesError('invalid-index', `The JSON index may contain at most ${MAX_INDEX_SERVERS} servers.`, 400, {
      maxServers: MAX_INDEX_SERVERS,
    })
  }
  const servers = []
  const seen = new Set()
  for (const entry of payload.servers) {
    const raw = isPlainObject(entry) && isPlainObject(entry.server) ? entry.server : entry
    const normalized = normalizeServer(raw)
    if (normalized === null || seen.has(normalized.name)) continue
    seen.add(normalized.name)
    servers.push(normalized)
  }
  const title = typeof payload.title === 'string' && payload.title.trim().length > 0
    ? payload.title.trim().slice(0, 120)
    : ''
  return { format: INDEX_FORMAT, title, servers }
}

/**
 * Fetch and validate one index document with the source limits.
 *
 * @param url - validated http(s) index URL.
 * @param options.fetchImpl / timeoutMs / maxBytes - overrides for tests.
 * @returns the normalized document.
 * @throws ApiError `sources/fetch-failed` for transport failures and
 *         `sources/invalid-index` for malformed JSON or schema.
 */
export async function fetchIndexDocument(url, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? INDEX_TIMEOUT_MS
  const maxBytes = options.maxBytes ?? MAX_INDEX_BYTES
  if (typeof url === 'string' && url.startsWith('file:')) {
    const path = fileURLToPath(url)
    let text
    try {
      const info = await stat(path)
      if (!info.isFile()) throw sourcesError('fetch-failed', 'The local index path is not a file.', 400, { path })
      if (info.size > maxBytes) throw sourcesError('fetch-failed', 'The JSON index file is too large.', 413, { maxBytes })
      text = await readFile(path, 'utf8')
    } catch (error) {
      if (typeof error?.code === 'string' && error.code.startsWith('sources/')) throw error
      throw sourcesError('fetch-failed', 'The local JSON index file could not be read.', 502, {
        reason: typeof error?.code === 'string' ? error.code : 'read',
      })
    }
    let payload
    try {
      payload = JSON.parse(text)
    } catch {
      throw sourcesError('invalid-index', 'The JSON index is not valid JSON.', 400)
    }
    return parseIndexDocument(payload)
  }
  if (typeof fetchImpl !== 'function') {
    throw sourcesError('fetch-failed', 'A fetch implementation is required.', 500)
  }
  let response
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: { accept: 'application/json', 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      throw sourcesError('fetch-failed', 'The JSON index request timed out.', 504, { reason: 'timeout' })
    }
    throw sourcesError('fetch-failed', 'The JSON index is unreachable.', 502, { reason: 'offline' })
  }
  if (!response?.ok) {
    throw sourcesError('fetch-failed', `The JSON index returned HTTP ${response?.status ?? 0}.`, 502, {
      reason: 'status',
      status: response?.status ?? 0,
    })
  }
  const declared = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw sourcesError('fetch-failed', 'The JSON index response is too large.', 413, { maxBytes })
  }
  let text
  try {
    text = await response.text()
  } catch {
    throw sourcesError('fetch-failed', 'The JSON index response could not be read.', 502)
  }
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw sourcesError('fetch-failed', 'The JSON index response is too large.', 413, { maxBytes })
  }
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    throw sourcesError('invalid-index', 'The JSON index is not valid JSON.', 400)
  }
  return parseIndexDocument(payload)
}

/**
 * Filter and order normalized index entries.
 *
 * @param doc - parsed index document.
 * @param query - untrusted search text; tokens may appear in any field.
 * @param source - resolved source used to stamp `market` on every entry.
 * @returns browser-safe entries with `market`.
 */
export function searchIndexServers(doc, query, source) {
  const text = typeof query === 'string' ? query.trim().toLowerCase() : ''
  const all = Array.isArray(doc?.servers) ? doc.servers : []
  let matches
  if (text.length === 0) {
    matches = [...all].sort(compareServers).slice(0, INDEX_SEARCH_LIMIT)
  } else {
    const tokens = text.split(/\s+/u).filter(Boolean)
    matches = all
      .filter(server => {
        const haystack = `${server.name}\n${server.title}\n${server.description}`.toLowerCase()
        return tokens.every(token => haystack.includes(token))
      })
      .sort(compareServers)
  }
  return matches.map(server => ({ ...server, market: source.id }))
}

/**
 * Find one entry by exact registry name.
 * @returns the entry, or null.
 */
export function findIndexServer(doc, name) {
  if (typeof name !== 'string' || name.length === 0) return null
  const servers = Array.isArray(doc?.servers) ? doc.servers : []
  return servers.find(server => server.name === name) ?? null
}

/**
 * Create the five-minute index cache.
 *
 * @param options.fetchImpl / now / ttlMs / timeoutMs / maxBytes / logger.
 * @returns `{ get(source), clear(), size }`; `get` resolves
 *          `{ doc, cached }` and never caches a failure.
 */
export function createIndexClient(options = {}) {
  const ttlMs = options.ttlMs ?? INDEX_CACHE_TTL_MS
  const now = options.now ?? Date.now
  const logger = options.logger
  const cache = new Map()

  const cacheGet = key => {
    const entry = cache.get(key)
    if (entry === undefined) return undefined
    if (entry.expiresAt <= now()) {
      cache.delete(key)
      return undefined
    }
    return entry.doc
  }

  const get = async source => {
    const key = `${source.id}\u0000${source.url}`
    const hit = cacheGet(key)
    if (hit !== undefined) return { doc: hit, cached: true }
    let doc
    try {
      doc = await fetchIndexDocument(source.url, options)
    } catch (error) {
      // Failures are not cached; the next request retries the source.
      logger?.warn?.(`dsh-mcp-market: index source ${source.id} failed: ${error?.message ?? 'fetch error'}`)
      throw error
    }
    cache.set(key, { doc, expiresAt: now() + ttlMs })
    return { doc, cached: false }
  }

  return {
    get,
    clear() { cache.clear() },
    get size() { return cache.size },
  }
}
