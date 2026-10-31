/**
 * Official MCP registry client.
 *
 * Pure normalization and a small cached HTTP client live together here so the
 * route layer never touches registry JSON directly. The client is injectable
 * (`fetchImpl`, `now`) and therefore testable without a live network or DSH
 * context.
 */
import { mcpError, isPlainObject } from './errors.js'
import { isRegistryName, lastSegment } from './slug.js'

/** Public registry origin. */
export const REGISTRY_BASE_URL = 'https://registry.modelcontextprotocol.io'

/** Search results live for five minutes, matching the product contract. */
export const CACHE_TTL_MS = 5 * 60 * 1000

/** Page size used for every registry search. */
export const SEARCH_LIMIT = 24

/** Refuse absurd registry responses before parsing them. */
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024

/** Cache entry-count ceiling; oldest inserted entries are evicted first. */
const MAX_CACHE_ENTRIES = 128

/** HTTP header-name token, matching the builder's conservative validation. */
const HEADER_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u

/** Conservative environment-variable name. */
const ENV_TOKEN = /^[A-Za-z_][A-Za-z0-9_]*$/u

/** Template variable name used in URLs, headers, and argument values. */
const VARIABLE_TOKEN = /^[A-Za-z0-9_.-]+$/u

/** Keys that must never become own properties of a config map. */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

/** True for a name usable as a YAML map key without prototype risk. */
function safeMapKey(name, pattern) {
  return typeof name === 'string' && pattern.test(name) && !UNSAFE_KEYS.has(name)
}

/** Registries whose packages this plugin can run. */
const SUPPORTED_PACKAGE_REGISTRIES = new Set(['npm', 'pypi', 'oci'])

/** Remote transports shown in the catalog. SSE is intentionally excluded. */
const SUPPORTED_REMOTE_TYPES = new Set(['streamable-http'])

/** True for an http(s) URL, including templates with `{variables}`. */
export function isHttpUrl(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096 && /^https?:\/\/[^\s]+$/iu.test(value)
}

/** Trimmed string or undefined. */
function optionalString(value) {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** Trimmed string or empty string. */
function stringOrEmpty(value) {
  return typeof value === 'string' ? value : ''
}

/** Normalize one `variables` declaration map. */
function normalizeVariables(input) {
  if (!isPlainObject(input)) return undefined
  const entries = []
  for (const [key, value] of Object.entries(input)) {
    if (!isPlainObject(value) || !safeMapKey(key, VARIABLE_TOKEN)) continue
    entries.push([key, {
      description: stringOrEmpty(value.description),
      isRequired: value.isRequired === true,
      isSecret: value.isSecret === true,
      ...(typeof value.default === 'string' ? { default: value.default } : {}),
    }])
  }
  return entries.length === 0 ? undefined : Object.fromEntries(entries)
}

/** Normalize one remote header declaration. */
function normalizeHeader(input) {
  if (!isPlainObject(input)) return null
  const name = optionalString(input.name)
  if (name === undefined || !safeMapKey(name, HEADER_TOKEN)) return null
  const variables = normalizeVariables(input.variables)
  return {
    name,
    description: stringOrEmpty(input.description),
    isRequired: input.isRequired === true,
    isSecret: input.isSecret === true,
    ...(typeof input.value === 'string' ? { value: input.value } : {}),
    ...(variables === undefined ? {} : { variables }),
  }
}

/** Normalize an argument declaration (positional or named). */
function normalizeArgument(input) {
  if (!isPlainObject(input)) return null
  const type = input.type === 'positional' ? 'positional' : input.type === 'named' ? 'named' : null
  if (type === null) return null
  const variables = normalizeVariables(input.variables)
  const arg = {
    type,
    description: stringOrEmpty(input.description),
    isRequired: input.isRequired === true,
    isRepeated: input.isRepeated === true,
    format: typeof input.format === 'string' ? input.format : undefined,
  }
  if (typeof input.name === 'string') arg.name = input.name
  if (typeof input.value === 'string') arg.value = input.value
  if (typeof input.valueHint === 'string') arg.valueHint = input.valueHint
  if (typeof input.default === 'string') arg.default = input.default
  if (variables !== undefined) arg.variables = variables
  return arg
}

/** Normalize an environment variable declaration. */
function normalizeEnvironmentVariable(input) {
  if (!isPlainObject(input)) return null
  const name = optionalString(input.name)
  if (name === undefined || !safeMapKey(name, ENV_TOKEN)) return null
  const variables = normalizeVariables(input.variables)
  return {
    name,
    description: stringOrEmpty(input.description),
    isRequired: input.isRequired === true,
    isSecret: input.isSecret === true,
    ...(typeof input.default === 'string' ? { default: input.default } : {}),
    ...(typeof input.format === 'string' ? { format: input.format } : {}),
    ...(variables === undefined ? {} : { variables }),
  }
}

/** Normalize one remote transport; only streamable HTTP is kept. */
function normalizeRemote(input) {
  if (!isPlainObject(input)) return null
  if (!SUPPORTED_REMOTE_TYPES.has(input.type)) return null
  if (!isHttpUrl(input.url)) return null
  const headers = Array.isArray(input.headers)
    ? input.headers.map(normalizeHeader).filter(Boolean)
    : []
  const variables = normalizeVariables(input.variables)
  return { type: input.type, url: input.url, headers, ...(variables === undefined ? {} : { variables }) }
}

/** Normalize one package declaration. */
function normalizePackage(input) {
  if (!isPlainObject(input)) return null
  if (!SUPPORTED_PACKAGE_REGISTRIES.has(input.registryType)) return null
  if (typeof input.identifier !== 'string' || input.identifier.length === 0) return null
  if (!isPlainObject(input.transport) || typeof input.transport.type !== 'string') return null
  const transport = { type: input.transport.type }
  if (typeof input.transport.url === 'string') transport.url = input.transport.url
  return {
    registryType: input.registryType,
    identifier: input.identifier,
    version: stringOrEmpty(input.version),
    runtimeHint: typeof input.runtimeHint === 'string' ? input.runtimeHint : undefined,
    transport,
    runtimeArguments: Array.isArray(input.runtimeArguments)
      ? input.runtimeArguments.map(normalizeArgument).filter(Boolean)
      : [],
    packageArguments: Array.isArray(input.packageArguments)
      ? input.packageArguments.map(normalizeArgument).filter(Boolean)
      : [],
    environmentVariables: Array.isArray(input.environmentVariables)
      ? input.environmentVariables.map(normalizeEnvironmentVariable).filter(Boolean)
      : [],
  }
}

/** Read the official lifecycle metadata from one registry record. */
function officialMeta(record, server) {
  const keys = ['io.modelcontextprotocol.registry/official']
  for (const source of [record, server]) {
    if (!isPlainObject(source) || !isPlainObject(source._meta)) continue
    for (const key of keys) {
      if (isPlainObject(source._meta[key])) return source._meta[key]
    }
  }
  return {}
}

/**
 * Normalize one `{ server, _meta }` registry record.
 *
 * @param record - raw registry list/detail entry.
 * @returns the normalized entry, or null when required fields are malformed.
 */
export function normalizeServer(record) {
  if (!isPlainObject(record)) return null
  const raw = isPlainObject(record.server) ? record.server : record
  const name = raw.name
  if (!isRegistryName(name)) return null
  const repositoryUrl = isPlainObject(raw.repository) ? raw.repository.url : undefined
  const websiteUrl = raw.websiteUrl
  const meta = officialMeta(record, raw)
  const remotes = Array.isArray(raw.remotes) ? raw.remotes.map(normalizeRemote).filter(Boolean) : []
  const packages = Array.isArray(raw.packages) ? raw.packages.map(normalizePackage).filter(Boolean) : []
  return {
    name,
    title: optionalString(raw.title) ?? lastSegment(name),
    description: stringOrEmpty(raw.description),
    version: stringOrEmpty(raw.version),
    repository: isHttpUrl(repositoryUrl) ? repositoryUrl : null,
    websiteUrl: isHttpUrl(websiteUrl) ? websiteUrl : null,
    remotes,
    packages,
    updatedAt: optionalString(meta.updatedAt) ?? optionalString(meta.statusChangedAt) ?? optionalString(meta.publishedAt) ?? null,
    isLatest: meta.isLatest === true,
  }
}

/** Normalize the `servers` array of one registry page. */
export function normalizeServerList(payload) {
  if (!isPlainObject(payload) || !Array.isArray(payload.servers)) return []
  return payload.servers.map(normalizeServer).filter(Boolean)
}

/** Build the registry search URL. */
function searchUrl(baseUrl, query, { cursor, limit, version }) {
  const url = new URL('/v0/servers', baseUrl)
  if (query.length > 0) url.searchParams.set('search', query)
  url.searchParams.set('limit', String(limit))
  if (version) url.searchParams.set('version', version)
  if (cursor) url.searchParams.set('cursor', cursor)
  return url
}

/**
 * Create the registry client.
 *
 * @param options - optional fetch/clock/cache overrides used by tests.
 * @returns search/detail methods sharing one five-minute cache.
 */
export function createRegistryClient(options = {}) {
  const baseUrl = options.baseUrl ?? REGISTRY_BASE_URL
  const ttlMs = options.ttlMs ?? CACHE_TTL_MS
  const timeoutMs = options.timeoutMs ?? 15000
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const now = options.now ?? Date.now
  const logger = options.logger
  const cache = new Map()

  if (typeof fetchImpl !== 'function') throw new Error('mcp-market: a fetch implementation is required')

  const cacheGet = key => {
    const entry = cache.get(key)
    if (entry === undefined) return undefined
    if (entry.expiresAt <= now()) {
      cache.delete(key)
      return undefined
    }
    return entry.value
  }

  const cacheSet = (key, value) => {
    if (cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next()
      if (!oldest.done) cache.delete(oldest.value)
    }
    cache.set(key, { value, expiresAt: now() + ttlMs })
  }

  /**
   * Fetch one JSON document with bounded status handling.
   * @returns parsed JSON, or null for an allowed 404.
   */
  const requestJson = async (url, { allow404 = false } = {}) => {
    let response
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          'user-agent': 'dsh-mcp-market/0.1.0 (+https://github.com/hongxsen/dsh_plugins)',
        },
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
        throw mcpError('fetch-failed', 'The MCP registry request timed out.', 504, { reason: 'timeout' })
      }
      logger?.warn?.(`dsh-mcp-market: registry request failed: ${error?.message ?? 'network error'}`)
      throw mcpError('fetch-failed', 'The MCP registry is unreachable. Check the network connection.', 502, { reason: 'offline' })
    }
    if (response.status === 404) {
      if (allow404) return null
      throw mcpError('not-found', 'The requested MCP server was not found.', 404)
    }
    if (response.status === 429) {
      const retryAfter = response.headers?.get?.('retry-after') ?? undefined
      throw mcpError('fetch-failed', 'The MCP registry rate limit was reached. Try again shortly.', 429, {
        reason: 'rate-limit',
        ...(retryAfter === undefined ? {} : { retryAfter }),
      })
    }
    if (!response.ok) {
      throw mcpError('fetch-failed', `The MCP registry returned HTTP ${response.status}.`, 502, {
        reason: 'status',
        status: response.status,
      })
    }
    let text
    try {
      text = await response.text()
    } catch {
      throw mcpError('fetch-failed', 'The MCP registry response could not be read.', 502)
    }
    if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
      throw mcpError('fetch-failed', 'The MCP registry response was too large.', 502)
    }
    try {
      return JSON.parse(text)
    } catch {
      throw mcpError('fetch-failed', 'The MCP registry returned invalid JSON.', 502)
    }
  }

  /**
   * Search the registry. An empty query returns the featured first page.
   *
   * @param query - untrusted search text.
   * @param options - optional `cursor` for an explicit load-more request.
   * @returns `{ query, servers, cached, nextCursor }`.
   */
  const search = async (query, { cursor = undefined } = {}) => {
    const q = typeof query === 'string' ? query.trim() : ''
    if (q.length > 200) throw mcpError('invalid-query', 'The search query is too long.', 400, { maxLength: 200 })
    if (cursor !== undefined && (typeof cursor !== 'string' || cursor.length > 512)) {
      throw mcpError('invalid-query', 'The pagination cursor is invalid.', 400)
    }
    const key = `search:${q}:${cursor ?? ''}`
    const hit = cacheGet(key)
    if (hit !== undefined) return { ...hit, cached: true }
    const payload = await requestJson(searchUrl(baseUrl, q, { cursor, limit: SEARCH_LIMIT, version: 'latest' }))
    const nextCursor = isPlainObject(payload?.metadata) && typeof payload.metadata.nextCursor === 'string'
      ? payload.metadata.nextCursor
      : null
    const value = { query: q, servers: normalizeServerList(payload), nextCursor }
    cacheSet(key, value)
    return { ...value, cached: false }
  }

  /** Run one exact-name search page and return the exact match. */
  const exactMatchSearch = async (name, version) => {
    const payload = await requestJson(searchUrl(baseUrl, name, {
      limit: 10,
      version,
    }))
    const servers = normalizeServerList(payload)
    const matches = servers.filter(server => server.name === name)
    return matches.find(server => server.isLatest === true) ?? matches[0] ?? null
  }

  /**
   * Re-read one server by exact registry name.
   *
   * The v1 registry exposes `GET /v0/servers/<name>`; when that endpoint is
   * absent this falls back to an exact-name search and then a latest-version
   * search. All three paths are cached for five minutes.
   *
   * @param name - exact registry name from the catalog.
   * @returns normalized server detail.
   */
  const getServer = async (name) => {
    if (!isRegistryName(name)) {
      throw mcpError('invalid-entry', 'The registry name is malformed.', 400)
    }
    const key = `detail:${name}`
    const hit = cacheGet(key)
    if (hit !== undefined) return hit

    const direct = await requestJson(`${baseUrl}/v0/servers/${encodeURIComponent(name)}`, { allow404: true })
    const directServer = normalizeServer(direct)
    if (directServer !== null && directServer.name === name) {
      cacheSet(key, directServer)
      return directServer
    }

    const unversioned = await exactMatchSearch(name, undefined)
    if (unversioned !== null) {
      cacheSet(key, unversioned)
      return unversioned
    }

    const latest = await exactMatchSearch(name, 'latest')
    if (latest !== null) {
      cacheSet(key, latest)
      return latest
    }

    throw mcpError('not-found', 'The requested MCP server was not found.', 404)
  }

  return {
    search,
    getServer,
    clear() { cache.clear() },
    get size() { return cache.size },
  }
}
