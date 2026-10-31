/**
 * Persistent market-source store.
 *
 * One small JSON document lives at `<dshHome>/storages/dsh-skills-market/
 * sources.json` (mode 0600). It lists the builtin skills.sh source plus up to
 * 19 user-defined sources and remembers which one is selected.
 *
 * Reads never rewrite an unreadable file: a missing or invalid store falls
 * back to the builtin source, and mutations fail loudly with `sources/invalid`
 * so a hand-edited mistake is not silently erased. Writes are atomic
 * (temp + rename) and serialized through one queue so two mutations cannot
 * interleave.
 */
import { randomBytes } from 'node:crypto'
import { chmod, mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  BUILTIN_SOURCE,
  MAX_SOURCE_TITLE_LENGTH,
  MAX_SOURCE_URL_LENGTH,
  MAX_SOURCES,
  SOURCE_KINDS,
  SOURCE_STORE_VERSION,
} from './constants.js'
import { MarketError } from './errors.js'
import { parseIndexDocument } from './index-source.js'
import { resolveDshHome, sourcesPathOf } from './paths.js'
import { fetchSourceIndex } from './remote.js'

/** Generated custom ids: `custom-` plus eight lowercase hex characters. */
const CUSTOM_ID_PATTERN = /^custom-[0-9a-f]{8}$/u

/** Shorthand for a `sources/invalid` failure. */
function invalid(message, details) {
  return new MarketError('sources/invalid', message, details)
}

/**
 * Return a defensive copy of one source record.
 * @param source - normalized source.
 * @returns a plain object with only the documented fields.
 */
export function cloneSource(source) {
  return {
    id: source.id,
    kind: source.kind,
    title: source.title,
    url: source.url,
    builtin: source.builtin === true,
  }
}

/** The builtin store used for missing or unreadable documents. */
export function defaultSourceStore() {
  return {
    version: SOURCE_STORE_VERSION,
    selected: BUILTIN_SOURCE.id,
    sources: [cloneSource(BUILTIN_SOURCE)],
  }
}

/**
 * Generate one custom source id.
 * @returns `custom-` plus eight lowercase hex characters.
 */
export function newSourceId() {
  return `custom-${randomBytes(4).toString('hex')}`
}

/**
 * Validate a source kind.
 * @param kind - candidate.
 * @returns the kind.
 * @throws MarketError `sources/invalid`.
 */
export function validateSourceKind(kind) {
  if (typeof kind !== 'string' || !SOURCE_KINDS.includes(kind)) {
    throw invalid('The source kind must be one of skills-sh or index', { kind: 'invalid' })
  }
  return kind
}

/**
 * Validate and trim a source title.
 * @param title - candidate.
 * @returns the trimmed title.
 * @throws MarketError `sources/invalid`.
 */
export function validateSourceTitle(title) {
  const text = typeof title === 'string' ? title.trim() : ''
  if (text === '' || text.length > MAX_SOURCE_TITLE_LENGTH) {
    throw invalid('The source title must be 1-80 characters', {
      field: 'title',
      maxLength: MAX_SOURCE_TITLE_LENGTH,
    })
  }
  return text
}

/**
 * Validate a source URL: absolute http(s), no credentials, no fragment, and at
 * most 2048 characters.
 * @param url - candidate.
 * @returns the normalized URL.
 * @throws MarketError `sources/invalid`.
 */
export function validateSourceUrl(url) {
  const text = typeof url === 'string' ? url.trim() : ''
  if (text === '' || text.length > MAX_SOURCE_URL_LENGTH) {
    throw invalid('The source URL must be 1-2048 characters', {
      field: 'url',
      maxLength: MAX_SOURCE_URL_LENGTH,
    })
  }
  let parsed
  try {
    parsed = new URL(text)
  } catch {
    throw invalid('The source URL must be absolute', { field: 'url' })
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw invalid('The source URL must use http or https', { field: 'url' })
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw invalid('The source URL must not contain credentials', { field: 'url' })
  }
  if (parsed.hash !== '') {
    throw invalid('The source URL must not contain a fragment', { field: 'url' })
  }
  if (parsed.hostname === '') {
    throw invalid('The source URL must include a host', { field: 'url' })
  }
  return parsed.href
}

/**
 * Normalize a parsed store document.
 *
 * Unknown fields are dropped, the builtin source is canonical and first,
 * duplicate or malformed custom entries are skipped, and an unknown selection
 * falls back to the builtin. The envelope itself must be valid.
 * @param document - parsed JSON value.
 * @returns a normalized store.
 * @throws MarketError `sources/invalid` when the envelope is wrong.
 */
export function sanitizeSourceStore(document) {
  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    throw invalid('The source store must be a JSON object', { reason: 'shape' })
  }
  if (document.version !== SOURCE_STORE_VERSION) {
    throw invalid('The source store must use version 1', { reason: 'version' })
  }
  if (!Array.isArray(document.sources)) {
    throw invalid('The source store must contain a sources array', { reason: 'sources' })
  }
  const sources = [cloneSource(BUILTIN_SOURCE)]
  const seen = new Set([BUILTIN_SOURCE.id])
  for (const raw of document.sources) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
    if (raw.id === BUILTIN_SOURCE.id || raw.builtin === true) continue
    if (typeof raw.id !== 'string' || !CUSTOM_ID_PATTERN.test(raw.id) || seen.has(raw.id)) continue
    let kind
    let title
    let url
    try {
      kind = validateSourceKind(raw.kind)
      title = validateSourceTitle(raw.title)
      url = validateSourceUrl(raw.url)
    } catch {
      continue
    }
    seen.add(raw.id)
    sources.push({ id: raw.id, kind, title, url, builtin: false })
    if (sources.length >= MAX_SOURCES) break
  }
  const selected = typeof document.selected === 'string' && seen.has(document.selected)
    ? document.selected
    : BUILTIN_SOURCE.id
  return { version: SOURCE_STORE_VERSION, selected, sources }
}

/**
 * Defensive public copy of a store.
 * @param store - normalized store.
 * @returns `{ version, selected, sources }`.
 */
export function publicSourceStore(store) {
  return {
    version: SOURCE_STORE_VERSION,
    selected: store.selected,
    sources: store.sources.map(cloneSource),
  }
}

/**
 * Create the source store for one DSH home.
 * @param options.dshHome - explicit DSH home (tests).
 * @param options.resolveHome - function returning the DSH home (overrides).
 * @param options.env - environment used to resolve the DSH home.
 * @param options.fetchImpl - fetch implementation used to validate index sources.
 * @returns the store API.
 */
export function createSourceStore(options = {}) {
  const env = options.env ?? process.env
  const resolveHome = typeof options.resolveHome === 'function'
    ? options.resolveHome
    : () => resolveDshHome(options.dshHome, env)
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  let queue = Promise.resolve()

  /** Absolute store path for the current home. */
  const storePath = () => sourcesPathOf(resolveHome())

  /**
   * Read and parse the store file.
   * @returns `{ store, missing }`; `store` is `null` when the file is missing.
   * @throws MarketError `sources/invalid` for unreadable or invalid content.
   */
  async function readFileStore() {
    let text
    try {
      text = await readFile(storePath(), 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') return { store: null, missing: true }
      throw invalid('The source store could not be read', { reason: 'read' })
    }
    let document
    try {
      document = JSON.parse(text)
    } catch {
      throw invalid('The source store is not valid JSON', { reason: 'json' })
    }
    try {
      return { store: sanitizeSourceStore(document), missing: false }
    } catch (error) {
      if (error instanceof MarketError) throw error
      throw invalid('The source store is invalid', { reason: 'schema' })
    }
  }

  /**
   * Read the store, falling back to the builtin source without rewriting.
   * @returns `{ store, missing, invalid }`.
   */
  async function snapshot() {
    try {
      const { store, missing } = await readFileStore()
      if (store === null) return { store: defaultSourceStore(), missing: true, invalid: false }
      return { store, missing, invalid: false }
    } catch (error) {
      return { store: defaultSourceStore(), missing: false, invalid: true, error }
    }
  }

  /**
   * Read the store for a mutation.
   * @returns the normalized store.
   * @throws MarketError `sources/invalid` when the file is unreadable.
   */
  async function load() {
    const { store } = await readFileStore()
    return store ?? defaultSourceStore()
  }

  /**
   * Write the store atomically with mode 0600.
   * @param store - normalized store.
   */
  async function writeStore(store) {
    const path = storePath()
    const directory = dirname(path)
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 })
    } catch {
      throw invalid('The source store directory could not be created', { reason: 'write' })
    }
    const temp = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
    try {
      const handle = await open(temp, 'wx', 0o600)
      try {
        await handle.writeFile(`${JSON.stringify(publicSourceStore(store), null, 2)}\n`, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      await chmod(temp, 0o600)
      await rename(temp, path)
      await chmod(path, 0o600)
    } catch {
      try {
        await unlink(temp)
      } catch {
        // The temp file may never have been created.
      }
      throw invalid('The source store could not be written', { reason: 'write' })
    }
  }

  /**
   * Serialize one store mutation behind the previous one.
   * @param operation - async work that reads and writes the store.
   * @returns the operation result.
   */
  function enqueue(operation) {
    const result = queue.then(operation, operation)
    queue = result.then(() => undefined, () => undefined)
    return result
  }

  /**
   * Return the current store, creating the builtin document when the file is
   * missing. A read-only DSH home still receives the in-memory result.
   * @returns `{ version, selected, sources }`.
   */
  async function list() {
    const { store, missing } = await snapshot()
    if (missing) {
      try {
        await writeStore(store)
      } catch {
        // Serving the builtin source is better than failing on a read-only home.
      }
    }
    return publicSourceStore(store)
  }

  /**
   * Return the current store without writing anything.
   * @returns `{ version, selected, sources }`.
   */
  async function get() {
    return publicSourceStore((await snapshot()).store)
  }

  /**
   * Find one source by id in the current store.
   * @param id - source id.
   * @returns the source, or `undefined`.
   */
  async function find(id) {
    const { store } = await snapshot()
    return store.sources.find((source) => source.id === id)
  }

  /**
   * Return the selected source; a missing selection falls back to the builtin.
   * @returns the selected source.
   */
  async function selectedSource() {
    const { store } = await snapshot()
    return store.sources.find((source) => source.id === store.selected) ?? store.sources[0]
  }

  /**
   * Add one source.
   *
   * Index documents are fetched and parsed before anything is persisted, so an
   * invalid index never enters the store. The new source is not selected.
   * @param input - `{ kind, title, url }`.
   * @returns `{ source, selected, sources, indexDocument? }`.
   */
  async function add(input) {
    const kind = validateSourceKind(input?.kind)
    const title = validateSourceTitle(input?.title)
    const url = validateSourceUrl(input?.url)
    let indexDocument
    if (kind === 'index') {
      const text = await fetchSourceIndex(fetchImpl, url)
      indexDocument = parseIndexDocument(text)
    }
    return enqueue(async () => {
      const store = await load()
      if (store.sources.length >= MAX_SOURCES) {
        throw new MarketError('sources/limit', 'The source limit has been reached', { limit: MAX_SOURCES })
      }
      let id = newSourceId()
      while (store.sources.some((source) => source.id === id)) id = newSourceId()
      const source = { id, kind, title, url, builtin: false }
      store.sources.push(source)
      await writeStore(store)
      const result = {
        source: cloneSource(source),
        selected: store.selected,
        sources: store.sources.map(cloneSource),
      }
      if (indexDocument !== undefined) result.indexDocument = indexDocument
      return result
    })
  }

  /**
   * Remove one custom source. Removing the selected source selects the builtin.
   * @param id - source id.
   * @returns `{ selected, sources }`.
   */
  async function remove(id) {
    if (typeof id !== 'string' || id === '') {
      throw new MarketError('sources/not-found', 'The source does not exist')
    }
    if (id === BUILTIN_SOURCE.id) {
      throw new MarketError('sources/builtin', 'The builtin source cannot be removed', { id })
    }
    return enqueue(async () => {
      const store = await load()
      const index = store.sources.findIndex((source) => source.id === id)
      if (index === -1) throw new MarketError('sources/not-found', 'The source does not exist', { id })
      if (store.sources[index].builtin === true) {
        throw new MarketError('sources/builtin', 'The builtin source cannot be removed', { id })
      }
      store.sources.splice(index, 1)
      if (store.selected === id) store.selected = BUILTIN_SOURCE.id
      await writeStore(store)
      return { selected: store.selected, sources: store.sources.map(cloneSource) }
    })
  }

  /**
   * Select one source.
   * @param id - source id.
   * @returns `{ selected, sources }`.
   */
  async function select(id) {
    if (typeof id !== 'string' || id === '') {
      throw new MarketError('sources/not-found', 'The source does not exist')
    }
    return enqueue(async () => {
      const store = await load()
      if (!store.sources.some((source) => source.id === id)) {
        throw new MarketError('sources/not-found', 'The source does not exist', { id })
      }
      store.selected = id
      await writeStore(store)
      return { selected: store.selected, sources: store.sources.map(cloneSource) }
    })
  }

  return { list, get, find, selectedSource, add, remove, select, snapshot }
}
