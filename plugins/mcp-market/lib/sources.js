/**
 * Persistent list of market sources for the MCP Market panel.
 *
 * The store lives at `<dshHome>/storages/dsh-mcp-market/sources.json`, mode
 * 0600, and is written atomically through one serialized queue. The builtin
 * `mcp-registry` source always exists, cannot be removed or edited, and is
 * selected whenever the selected custom source has disappeared.
 *
 * All browser input is validated here before it can be persisted: kind, title,
 * URL shape, the 20-source ceiling, and (for `index` sources) the remote JSON
 * document itself.
 */
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { randomBytes, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join, isAbsolute } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isPlainObject, sourcesError } from './errors.js'
import { fetchIndexDocument, INDEX_TIMEOUT_MS, MAX_INDEX_BYTES } from './index-source.js'
import { createSerialQueue } from './patch.js'

/** Storage format version. */
export const SOURCES_VERSION = 1

/** File name inside the storage directory. */
export const SOURCES_FILENAME = 'sources.json'

/** Owner-only mode for the store file. */
export const SOURCES_MODE = 0o600

/** Owner-only mode for the storage directory. */
export const SOURCES_DIR_MODE = 0o700

/** Ceiling including the builtin source. */
export const MAX_SOURCES = 20

/** Source kinds supported by this plugin. */
export const SOURCE_KINDS = Object.freeze(['mcp-registry', 'index'])

/** The permanently available source. */
export const BUILTIN_SOURCE_ID = 'mcp-registry'

/** Official registry origin. */
export const BUILTIN_SOURCE_URL = 'https://registry.modelcontextprotocol.io'

/** Canonical builtin source. */
export const BUILTIN_SOURCE = Object.freeze({
  id: BUILTIN_SOURCE_ID,
  kind: 'mcp-registry',
  title: 'MCP Registry',
  url: BUILTIN_SOURCE_URL,
  builtin: true,
})

/** Custom source id shape; the user never supplies an id. */
const CUSTOM_ID_PATTERN = /^custom-[0-9a-f]{8}$/u

/** Maximum title length after trimming. */
const MAX_TITLE_LENGTH = 80

/** Maximum URL length. */
const MAX_URL_LENGTH = 2048

/** The empty (builtin-only) document. */
export function builtinSourceDoc() {
  return {
    version: SOURCES_VERSION,
    selected: BUILTIN_SOURCE_ID,
    sources: [{ ...BUILTIN_SOURCE }],
  }
}

/** True for one of the two supported kinds. */
export function isSourceKind(value) {
  return SOURCE_KINDS.includes(value)
}

/**
 * Validate an absolute HTTP(S) source URL.
 *
 * Credentials and fragments are refused because the Host fetches this URL and
 * a custom source must not smuggle secrets in or select a document fragment.
 *
 * @returns the trimmed URL.
 * @throws ApiError `sources/invalid`.
 */
export function normalizeSourceUrl(value, kind = undefined) {
  if (typeof value !== 'string') {
    throw sourcesError('invalid', 'The source URL must be a string.', 400)
  }
  const url = value.trim()
  if (url.length === 0 || url.length > MAX_URL_LENGTH) {
    throw sourcesError('invalid', `The source URL must be 1-${MAX_URL_LENGTH} characters.`, 400, {
      maxLength: MAX_URL_LENGTH,
    })
  }
  const local = localIndexUrl(url)
  if (local !== null) {
    if (kind !== 'index') {
      throw sourcesError('invalid', 'Local paths are only supported for JSON index sources.', 400)
    }
    return local
  }
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw sourcesError('invalid', 'The source URL is not a valid absolute URL.', 400)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw sourcesError('invalid', 'The source URL must use HTTP, HTTPS, or a local path.', 400)
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw sourcesError('invalid', 'The source URL must not embed credentials.', 400)
  }
  if (url.includes('#')) {
    throw sourcesError('invalid', 'The source URL must not contain a fragment.', 400)
  }
  return url
}

/** Canonicalize an absolute path, `~/...` path, or `file:` URL. */
function localIndexUrl(value) {
  const expanded = value === '~' || value.startsWith('~/') ? join(homedir(), value.slice(2)) : value
  if (isAbsolute(expanded)) return pathToFileURL(expanded).href
  if (!expanded.startsWith('file:')) return null
  let parsed
  try {
    parsed = new URL(expanded)
  } catch {
    throw sourcesError('invalid', 'The local source path is not a valid file URL.', 400)
  }
  if (parsed.protocol !== 'file:') return null
  if (parsed.hostname !== '' && parsed.hostname !== 'localhost') {
    throw sourcesError('invalid', 'The local source file URL must not name a remote host.', 400)
  }
  if (parsed.hash !== '') {
    throw sourcesError('invalid', 'The source URL must not contain a fragment.', 400)
  }
  try {
    return pathToFileURL(fileURLToPath(parsed)).href
  } catch {
    throw sourcesError('invalid', 'The local source path is not valid.', 400)
  }
}

/** Validate a title and return the trimmed value. */
export function normalizeSourceTitle(value) {
  if (typeof value !== 'string') {
    throw sourcesError('invalid', 'The source title must be a string.', 400)
  }
  const title = value.trim()
  if (title.length === 0 || title.length > MAX_TITLE_LENGTH) {
    throw sourcesError('invalid', `The source title must be 1-${MAX_TITLE_LENGTH} characters.`, 400, {
      maxLength: MAX_TITLE_LENGTH,
    })
  }
  return title
}

/** Generate one custom source id. */
function createCustomId() {
  return `custom-${randomBytes(4).toString('hex')}`
}

/** Normalize one stored entry; unknown fields are dropped. */
function normalizeStoredSource(raw) {
  if (!isPlainObject(raw)) return null
  if (raw.id === BUILTIN_SOURCE_ID) return null
  if (typeof raw.id !== 'string' || !CUSTOM_ID_PATTERN.test(raw.id)) return null
  if (!isSourceKind(raw.kind)) return null
  let title
  let url
  try {
    title = normalizeSourceTitle(raw.title)
    url = normalizeSourceUrl(raw.url, raw.kind)
  } catch {
    return null
  }
  return { id: raw.id, kind: raw.kind, title, url, builtin: false }
}

/**
 * Normalize a whole source document.
 *
 * Missing builtins are added, malformed custom entries are dropped, duplicate
 * ids keep the first occurrence, and a dangling selection falls back to the
 * builtin. A structurally invalid document fails loudly instead of being reset.
 *
 * @throws ApiError `sources/invalid` for an unsupported shape.
 */
export function normalizeSourcesDocument(raw) {
  if (!isPlainObject(raw) || raw.version !== SOURCES_VERSION || !Array.isArray(raw.sources)) {
    throw sourcesError('invalid', 'The market source store has an unsupported shape.', 500)
  }
  const sources = [{ ...BUILTIN_SOURCE }]
  const seen = new Set([BUILTIN_SOURCE_ID])
  for (const entry of raw.sources) {
    const source = normalizeStoredSource(entry)
    if (source === null || seen.has(source.id)) continue
    seen.add(source.id)
    sources.push(source)
    if (sources.length >= MAX_SOURCES) break
  }
  const selected = typeof raw.selected === 'string' && seen.has(raw.selected)
    ? raw.selected
    : BUILTIN_SOURCE_ID
  return { version: SOURCES_VERSION, selected, sources }
}

/** Browser-safe source identity (no builtin flag). */
export function publicSource(source) {
  return { id: source.id, kind: source.kind, title: source.title, url: source.url }
}

/**
 * Create one source store bound to a storage directory.
 *
 * @param options.dir - `<dshHome>/storages/dsh-mcp-market`.
 * @param options.fetchImpl / indexTimeoutMs / indexMaxBytes - index validation.
 * @returns serialized read/write/ensure/add/remove/select helpers.
 */
export function createSourceStore({ dir, logger, fetchImpl, indexTimeoutMs, indexMaxBytes } = {}) {
  if (typeof dir !== 'string' || dir.length === 0) throw new Error('mcp-market: a source storage directory is required')
  const path = join(dir, SOURCES_FILENAME)
  const queue = createSerialQueue()

  const readRaw = async () => {
    let text
    try {
      text = await readFile(path, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') return null
      throw sourcesError('invalid', 'The market source store could not be read.', 500, { reason: 'read' })
    }
    if (text.trim().length === 0) return null
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      logger?.warn?.('dsh-mcp-market: sources.json is not valid JSON')
      throw sourcesError('invalid', 'The market source store is not valid JSON.', 500, { reason: 'parse' })
    }
    return parsed
  }

  const write = async doc => {
    try {
      await mkdir(dir, { recursive: true, mode: SOURCES_DIR_MODE })
    } catch {
      throw sourcesError('invalid', 'The market source storage directory could not be created.', 500, { reason: 'mkdir' })
    }
    const temporary = join(dir, `.${SOURCES_FILENAME}.${process.pid}.${randomUUID()}.tmp`)
    try {
      await writeFile(temporary, `${JSON.stringify(doc, null, 2)}\n`, { mode: SOURCES_MODE, flag: 'wx' })
      await rename(temporary, path)
      await chmod(path, SOURCES_MODE)
    } catch {
      try {
        await unlink(temporary)
      } catch {
        // The temporary file was never created or was already renamed.
      }
      throw sourcesError('invalid', 'The market source store could not be written.', 500, { reason: 'write' })
    }
    return doc
  }

  const loadForWrite = async () => {
    const raw = await readRaw()
    return raw === null ? builtinSourceDoc() : normalizeSourcesDocument(raw)
  }

  const read = async () => {
    const raw = await readRaw()
    return raw === null ? builtinSourceDoc() : normalizeSourcesDocument(raw)
  }

  const ensure = () => queue.run(async () => {
    const raw = await readRaw()
    if (raw !== null) return normalizeSourcesDocument(raw)
    const doc = builtinSourceDoc()
    await write(doc)
    return doc
  })

  const mutate = fn => queue.run(async () => {
    const current = await loadForWrite()
    const next = await fn(structuredClone(current))
    const normalized = normalizeSourcesDocument(next)
    await write(normalized)
    return normalized
  })

  const add = async ({ kind, title, url } = {}) => {
    if (!isSourceKind(kind)) {
      throw sourcesError('invalid', 'The market source kind is not supported.', 400, { kinds: [...SOURCE_KINDS] })
    }
    const cleanTitle = normalizeSourceTitle(title)
    const cleanUrl = normalizeSourceUrl(url, kind)
    if (kind === 'index') {
      // Validate before the queue so a slow source does not block unrelated
      // mutations. Nothing is persisted until the document is accepted.
      await fetchIndexDocument(cleanUrl, {
        fetchImpl,
        timeoutMs: indexTimeoutMs ?? INDEX_TIMEOUT_MS,
        maxBytes: indexMaxBytes ?? MAX_INDEX_BYTES,
      })
    }
    let created
    const doc = await mutate(current => {
      if (current.sources.length >= MAX_SOURCES) {
        throw sourcesError('limit', `At most ${MAX_SOURCES} market sources are allowed.`, 400, { max: MAX_SOURCES })
      }
      let id = createCustomId()
      const used = new Set(current.sources.map(source => source.id))
      while (used.has(id)) id = createCustomId()
      created = { id, kind, title: cleanTitle, url: cleanUrl, builtin: false }
      current.sources.push(created)
      return current
    })
    return { doc, source: created }
  }

  const remove = id => mutate(current => {
    if (id === BUILTIN_SOURCE_ID) {
      throw sourcesError('builtin', 'The built-in market source cannot be removed.', 400)
    }
    const index = current.sources.findIndex(source => source.id === id)
    if (index < 0) throw sourcesError('not-found', 'That market source was not found.', 404)
    current.sources.splice(index, 1)
    if (current.selected === id) current.selected = BUILTIN_SOURCE_ID
    return current
  })

  const select = id => mutate(current => {
    if (typeof id !== 'string' || !current.sources.some(source => source.id === id)) {
      throw sourcesError('not-found', 'That market source was not found.', 404)
    }
    current.selected = id
    return current
  })

  return {
    dir,
    path,
    read,
    ensure,
    add,
    remove,
    select,
    queue,
  }
}
