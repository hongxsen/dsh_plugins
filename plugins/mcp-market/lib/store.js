/**
 * Persistent catalog of managed MCP servers.
 *
 * Records live in `<dshHome>/storages/dsh-mcp-market/servers.json` with mode
 * 0600 because they can contain header and environment secrets. The API layer
 * never returns those values to the browser.
 */
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { mcpError, isPlainObject } from './errors.js'
import { createSerialQueue } from './patch.js'
import { isRowId, isServerName } from './slug.js'

/** Current storage format version. */
export const STORE_VERSION = 1

/** File name inside the storage directory. */
export const STORE_FILENAME = 'servers.json'

/** Owner-only mode for the store file. */
export const STORE_MODE = 0o600

/** Owner-only mode for the storage directory. */
export const STORE_DIR_MODE = 0o700

/** The empty store document. */
export function emptyStore() {
  return { version: STORE_VERSION, servers: {} }
}

/** Copy a string map, dropping unsafe keys and non-string values. */
function normalizeStringMap(value) {
  if (!isPlainObject(value)) return undefined
  const entries = []
  for (const key of Object.keys(value)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
    if (typeof value[key] !== 'string') continue
    entries.push([key, value[key]])
  }
  return entries.length === 0 ? undefined : Object.fromEntries(entries)
}

/** Normalize one stored server record; unknown fields are dropped. */
export function normalizeRecord(raw) {
  if (!isPlainObject(raw)) return null
  const rowId = raw.rowId
  if (!isRowId(rowId)) return null
  if (typeof raw.serverName !== 'string' || !isServerName(raw.serverName)) return null
  const transport = raw.transport === 'streamable-http' ? 'streamable-http' : raw.transport === 'stdio' ? 'stdio' : null
  if (transport === null) return null
  const record = {
    rowId,
    serverName: raw.serverName,
    registryName: typeof raw.registryName === 'string' ? raw.registryName : '',
    title: typeof raw.title === 'string' ? raw.title : raw.serverName,
    description: typeof raw.description === 'string' ? raw.description : '',
    version: typeof raw.version === 'string' ? raw.version : '',
    transport,
    enabled: raw.enabled !== false,
    installedAt: typeof raw.installedAt === 'string' ? raw.installedAt : new Date(0).toISOString(),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date(0).toISOString(),
  }
  if (transport === 'streamable-http') {
    if (typeof raw.url !== 'string') return null
    record.url = raw.url
    const headers = normalizeStringMap(raw.headers)
    if (headers !== undefined) record.headers = headers
  } else {
    if (typeof raw.command !== 'string') return null
    record.command = raw.command
    record.args = Array.isArray(raw.args) ? raw.args.filter(arg => typeof arg === 'string') : []
    const env = normalizeStringMap(raw.env)
    if (env !== undefined) record.env = env
  }
  return record
}

/** Normalize a whole store document. */
export function normalizeStore(raw) {
  if (!isPlainObject(raw) || raw.version !== STORE_VERSION || !isPlainObject(raw.servers)) {
    throw mcpError('install-failed', 'The MCP market storage file has an unsupported shape.', 500)
  }
  const servers = {}
  for (const key of Object.keys(raw.servers)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
    const record = normalizeRecord(raw.servers[key])
    if (record !== null && record.rowId === key) servers[key] = record
  }
  return { version: STORE_VERSION, servers }
}

/**
 * Create one store bound to a storage directory.
 *
 * @param options.dir - `<dshHome>/storages/dsh-mcp-market`.
 * @returns serialized read/update helpers.
 */
export function createServerStore({ dir, logger } = {}) {
  if (typeof dir !== 'string' || dir.length === 0) throw new Error('mcp-market: a storage directory is required')
  const path = join(dir, STORE_FILENAME)
  const queue = createSerialQueue()

  const read = async () => {
    let text
    try {
      text = await readFile(path, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') return emptyStore()
      throw mcpError('install-failed', 'The MCP market storage file could not be read.', 500, { reason: 'read' })
    }
    if (text.trim().length === 0) return emptyStore()
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      logger?.warn?.('dsh-mcp-market: servers.json is not valid JSON')
      throw mcpError('install-failed', 'The MCP market storage file is not valid JSON.', 500, { reason: 'parse' })
    }
    return normalizeStore(parsed)
  }

  const write = async doc => {
    try {
      await mkdir(dir, { recursive: true, mode: STORE_DIR_MODE })
    } catch {
      throw mcpError('install-failed', 'The MCP market storage directory could not be created.', 500, { reason: 'mkdir' })
    }
    const temporary = join(dir, `.${STORE_FILENAME}.${process.pid}.${randomUUID()}.tmp`)
    try {
      await writeFile(temporary, `${JSON.stringify(doc, null, 2)}\n`, { mode: STORE_MODE, flag: 'wx' })
      await rename(temporary, path)
      await chmod(path, STORE_MODE)
    } catch {
      try {
        await unlink(temporary)
      } catch {
        // Nothing to clean up.
      }
      throw mcpError('install-failed', 'The MCP market storage file could not be written.', 500, { reason: 'write' })
    }
    return doc
  }

  const update = mutator => queue.run(async () => {
    const current = await read()
    const next = await mutator(structuredClone(current))
    const normalized = normalizeStore(next)
    await write(normalized)
    return normalized
  })

  return {
    dir,
    path,
    read,
    write: doc => queue.run(() => write(normalizeStore(doc))),
    update,
    queue,
  }
}
