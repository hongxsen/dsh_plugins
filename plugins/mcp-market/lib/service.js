/**
 * Host-side MCP Market service.
 *
 * The service owns the only side effects: registry reads, runtime probing,
 * profile-patch writes, and the owner-only record store. It is constructed from
 * a DSH context in production and from explicit paths in tests, so every pure
 * helper stays independent of a live harness.
 */
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import {
  buildChoice,
  normalizeValues,
  previewServer,
  recordFromChoice,
  rowFromRecord,
} from './config.js'
import { mcpError } from './errors.js'
import { createPatchManager, createSerialQueue, assertPatchPath } from './patch.js'
import { createRegistryClient } from './registry.js'
import { isRegistryName, isRowId, rowIdFor, serverNameFor } from './slug.js'
import { createServerStore } from './store.js'

/** Runtime commands probed for the installed page and package installs. */
const RUNTIMES = ['npx', 'uvx', 'docker']

/** How long a runtime probe result is reused. */
const RUNTIME_TTL_MS = 30_000

/** Expand a leading `~` in a configured DSH home. */
function expandHome(value) {
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(homedir(), value.slice(2))
  return value
}

/**
 * Render a patch path symbolically.
 * @returns `~/.dsh/...` when the path is under the resolved home.
 */
export function displayPatchPath(patchPath, home) {
  if (typeof patchPath !== 'string' || patchPath.length === 0) return null
  if (typeof home !== 'string' || home.length === 0) return patchPath
  const root = resolve(home)
  const candidate = resolve(patchPath)
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) return patchPath
  const rel = candidate === root ? '' : relative(root, candidate)
  const posix = rel.split(sep).filter(Boolean).join('/')
  return posix.length === 0 ? '~/.dsh' : `~/.dsh/${posix}`
}

/** Probe one executable without a shell. */
export function commandAvailable(command) {
  const tool = process.platform === 'win32' ? 'where' : 'which'
  try {
    const result = spawnSync(tool, [command], { stdio: 'ignore', timeout: 2000 })
    return result.status === 0
  } catch {
    return false
  }
}

/**
 * Create the MCP Market service.
 *
 * @param options.ctx - DSH host context; omitted in unit tests.
 * @param options.registry - registry client override.
 * @param options.patchPath / dshHome / profileContext / profileName - explicit test wiring.
 * @param options.commandCheck - runtime probe override.
 * @returns the methods consumed by the HTTP router.
 */
export function createMarketService(options = {}) {
  const ctx = options.ctx
  const env = options.env ?? process.env
  const now = options.now ?? Date.now
  const logger = options.logger ?? ctx?.logger
  const providedPatchPath = options.patchPath
  const providedHome = options.dshHome
  const providedProfile = options.profileContext
  const providedProfileName = options.profileName
  const commandCheck = options.commandCheck ?? commandAvailable
  const registry = options.registry ?? createRegistryClient({ logger })
  const mutationQueue = createSerialQueue()

  let runtimeCache
  let cachedPatch
  let cachedPatchPath
  let cachedStore
  let cachedHome

  const get = name => {
    if (ctx?.get === undefined) return undefined
    try {
      return ctx.get(name)
    } catch {
      return undefined
    }
  }

  const profileContext = () => providedProfile ?? get('profileContext')

  const dshHome = () => {
    if (typeof providedHome === 'string' && providedHome.length > 0) return resolve(expandHome(providedHome))
    const profile = profileContext()
    if (profile !== undefined && profile !== null && typeof profile.home === 'string' && profile.home.length > 0) return resolve(profile.home)
    const homePath = get('dshHomePath')
    if (typeof homePath === 'function') {
      try {
        const value = homePath()
        if (typeof value === 'string' && value.length > 0) return resolve(value)
      } catch {
        // Fall through to the environment/default resolution.
      }
    }
    const configured = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
    if (configured.length > 0) return resolve(expandHome(configured))
    return join(homedir(), '.dsh')
  }

  const patchPath = () => {
    if (typeof providedPatchPath === 'string' && providedPatchPath.length > 0) return providedPatchPath
    const profile = profileContext()
    return typeof profile?.patchPath === 'string' && profile.patchPath.length > 0 ? profile.patchPath : null
  }

  const profileName = () => {
    if (typeof providedProfileName === 'string') return providedProfileName
    const profile = profileContext()
    return typeof profile?.name === 'string' ? profile.name : null
  }

  const requirePatchPath = () => {
    const path = patchPath()
    if (path === null) throw mcpError('patch-failed', 'No active DSH profile is available.', 500, { reason: 'no-profile' })
    const profile = profileContext()
    if (typeof profile?.dir === 'string') assertPatchPath(path, profile.dir)
    return path
  }

  const patchManager = () => {
    const path = requirePatchPath()
    if (cachedPatch === undefined || cachedPatchPath !== path) {
      cachedPatch = createPatchManager({ patchPath: path, logger })
      cachedPatchPath = path
    }
    return cachedPatch
  }

  const storeManager = () => {
    const home = dshHome()
    if (cachedStore === undefined || cachedHome !== home) {
      cachedStore = createServerStore({ dir: join(home, 'storages', 'dsh-mcp-market'), logger })
      cachedHome = home
    }
    return cachedStore
  }

  const hmrAvailable = () => get('hmr') !== undefined

  const runtimes = () => {
    if (runtimeCache !== undefined && runtimeCache.expiresAt > now()) return runtimeCache.value
    const value = Object.fromEntries(RUNTIMES.map(command => [command, commandCheck(command)]))
    runtimeCache = { value, expiresAt: now() + RUNTIME_TTL_MS }
    return value
  }

  /** Count tools whose public name belongs to one server namespace. */
  const toolCount = serverName => {
    try {
      const tools = get('tools')
      if (tools === undefined || typeof tools.schemas !== 'function') return 0
      const schemas = tools.schemas()
      if (!Array.isArray(schemas)) return 0
      const prefix = `mcp__${serverName}__`
      return schemas.filter(schema => typeof schema?.name === 'string' && schema.name.startsWith(prefix)).length
    } catch {
      return 0
    }
  }

  /** Build the browser-safe installed row, never including secret values. */
  const installedRecord = record => ({
    rowId: record.rowId,
    serverName: record.serverName,
    registryName: record.registryName,
    title: record.title,
    description: record.description,
    version: record.version,
    transport: record.transport,
    ...(record.transport === 'streamable-http' ? { url: record.url } : { command: record.command, args: record.args }),
    enabled: record.enabled,
    installedAt: record.installedAt,
    updatedAt: record.updatedAt,
    toolCount: toolCount(record.serverName),
    headers: Object.keys(record.headers ?? {}).map(name => ({ name })),
    env: Object.keys(record.env ?? {}).map(name => ({ name })),
  })

  const writeRowsFor = async (patch, doc) => {
    const rows = Object.values(doc.servers).filter(record => record.enabled).map(rowFromRecord)
    return patch.writeRows(rows)
  }

  const health = () => ({
    ok: true,
    profile: profileName(),
    patchPath: displayPatchPath(patchPath(), dshHome()),
    hmr: hmrAvailable(),
  })

  const search = async (query, cursor) => {
    const result = await registry.search(query, cursor === undefined ? {} : { cursor })
    return { query: result.query, servers: result.servers, cached: result.cached }
  }

  const detail = name => {
    if (typeof name !== 'string' || !isRegistryName(name)) {
      throw mcpError('invalid-entry', 'The registry name is malformed.', 400)
    }
    return registry.getServer(name)
  }

  const preview = async registryName => {
    if (typeof registryName !== 'string' || !isRegistryName(registryName)) {
      throw mcpError('invalid-entry', 'The registry name is malformed.', 400)
    }
    requirePatchPath()
    const entry = await registry.getServer(registryName)
    const doc = await storeManager().read()
    const serverName = serverNameFor(registryName)
    const existingRecord = Object.values(doc.servers).find(record => record.serverName === serverName)
    const result = previewServer(entry, runtimes(), existingRecord !== undefined)
    if (existingRecord !== undefined) result.existingRowId = existingRecord.rowId
    result.patchPath = displayPatchPath(patchPath(), dshHome())
    result.profileName = profileName()
    return result
  }

  const install = body => mutationQueue.run(async () => {
    const registryName = body?.registryName
    if (typeof registryName !== 'string' || !isRegistryName(registryName)) {
      throw mcpError('invalid-entry', 'The registry name is malformed.', 400)
    }
    const values = normalizeValues(body?.values)
    requirePatchPath()
    const entry = await registry.getServer(registryName)
    const built = buildChoice(entry, body?.choice, values)
    if (built.transport === 'stdio' && runtimes()[built.config.command] !== true) {
      throw mcpError('runtime-missing', `The runtime command "${built.config.command}" is not available.`, 400, {
        command: built.config.command,
      })
    }
    const patch = patchManager()
    const store = storeManager()
    const before = await store.read()
    const serverName = built.config.serverName
    const existing = Object.values(before.servers).find(record => record.serverName === serverName)
    if (existing !== undefined && body?.replace !== true) {
      throw mcpError('already-installed', 'A server with this name is already installed.', 409, {
        rowId: existing.rowId,
      })
    }
    const timestamp = new Date(now()).toISOString()
    const rowId = existing?.rowId ?? rowIdFor(registryName)
    const record = recordFromChoice(entry, built, {
      installedAt: existing?.installedAt ?? timestamp,
      updatedAt: timestamp,
    })
    record.rowId = rowId
    record.enabled = true
    const next = { version: 1, servers: { ...before.servers } }
    for (const [id, candidate] of Object.entries(next.servers)) {
      if (candidate.serverName === serverName) delete next.servers[id]
    }
    next.servers[rowId] = record

    await writeRowsFor(patch, next)
    try {
      await store.write(next)
    } catch (error) {
      try {
        await writeRowsFor(patch, before)
      } catch (rollbackError) {
        logger?.warn?.(`dsh-mcp-market: install rollback failed: ${rollbackError?.message ?? 'unknown'}`)
      }
      throw error
    }
    return { installed: true, applied: hmrAvailable(), restartRequired: !hmrAvailable() }
  })

  const toggle = body => mutationQueue.run(async () => {
    const rowId = body?.rowId
    if (typeof rowId !== 'string' || !isRowId(rowId)) {
      throw mcpError('not-managed', 'That MCP row is not managed by this plugin.', 404)
    }
    if (typeof body?.enabled !== 'boolean') {
      throw mcpError('invalid-value', 'The enabled flag must be a boolean.', 400)
    }
    const patch = patchManager()
    const store = storeManager()
    const before = await store.read()
    const record = before.servers[rowId]
    if (record === undefined) throw mcpError('not-managed', 'That MCP row is not managed by this plugin.', 404)
    const next = structuredClone(before)
    next.servers[rowId].enabled = body.enabled
    next.servers[rowId].updatedAt = new Date(now()).toISOString()
    await writeRowsFor(patch, next)
    try {
      await store.write(next)
    } catch (error) {
      try {
        await writeRowsFor(patch, before)
      } catch (rollbackError) {
        logger?.warn?.(`dsh-mcp-market: toggle rollback failed: ${rollbackError?.message ?? 'unknown'}`)
      }
      throw error
    }
    return { applied: hmrAvailable(), restartRequired: !hmrAvailable() }
  })

  const remove = body => mutationQueue.run(async () => {
    const rowId = body?.rowId
    if (typeof rowId !== 'string' || !isRowId(rowId)) {
      throw mcpError('not-managed', 'That MCP row is not managed by this plugin.', 404)
    }
    const patch = patchManager()
    const store = storeManager()
    const before = await store.read()
    if (before.servers[rowId] === undefined) {
      throw mcpError('not-managed', 'That MCP row is not managed by this plugin.', 404)
    }
    const next = structuredClone(before)
    delete next.servers[rowId]
    await writeRowsFor(patch, next)
    try {
      await store.write(next)
    } catch (error) {
      try {
        await writeRowsFor(patch, before)
      } catch (rollbackError) {
        logger?.warn?.(`dsh-mcp-market: remove rollback failed: ${rollbackError?.message ?? 'unknown'}`)
      }
      throw error
    }
    return { removed: true, applied: hmrAvailable(), restartRequired: !hmrAvailable() }
  })

  const installed = async () => {
    const path = patchPath()
    const store = storeManager()
    const doc = await store.read()
    let external = []
    if (path !== null) external = await patchManager().readExternalRows()
    return {
      servers: Object.values(doc.servers).map(installedRecord),
      external,
      hmr: hmrAvailable(),
      patchPath: displayPatchPath(path, dshHome()),
      profileName: profileName(),
      runtimes: runtimes(),
    }
  }

  return {
    health,
    search,
    detail,
    preview,
    install,
    toggle,
    remove,
    installed,
    runtimes,
    registry,
  }
}
