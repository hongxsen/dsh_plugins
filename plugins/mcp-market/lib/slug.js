/**
 * Stable identifiers for managed MCP rows.
 *
 * A row id is derived only from the registry name: the lowercased last path
 * segment, non-alphanumerics replaced by `_`, plus a four-hex digest of the
 * full registry name. Publishing a new version of the same server therefore
 * keeps the same row id and replaces that row instead of piling up new ones.
 */
import { createHash } from 'node:crypto'

/** Maximum length of `serverName`, as enforced by dsh-mcp-client. */
export const MAX_SERVER_NAME = 32

/** The row-id prefix owned by this plugin. */
export const ROW_PREFIX = 'mcp-market-'

/** Registry names are `namespace/name`; both parts use a conservative charset. */
const REGISTRY_NAME_PATTERN = /^[A-Za-z0-9.-]+\/[A-Za-z0-9._-]+$/

/** A safe server name for dsh-mcp-client. */
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/** A row id written by this plugin. */
const ROW_ID_PATTERN = /^mcp-market-[A-Za-z0-9_-]{1,32}$/

/** True when a string is a syntactically valid registry name. */
export function isRegistryName(value) {
  return typeof value === 'string' && value.length >= 3 && value.length <= 200 && REGISTRY_NAME_PATTERN.test(value)
}

/** True when a string is a valid dsh-mcp-client serverName. */
export function isServerName(value) {
  return typeof value === 'string' && SERVER_NAME_PATTERN.test(value)
}

/** True when a string is a row id owned by this plugin. */
export function isRowId(value) {
  return typeof value === 'string' && ROW_ID_PATTERN.test(value)
}

/**
 * Derive the stable server name for a registry name.
 *
 * @param registryName - full reverse-DNS registry name, e.g. `io.github.user/weather`.
 * @returns a 1-32 character `[A-Za-z0-9_-]` name; deterministic for the same input.
 */
export function serverNameFor(registryName) {
  const name = typeof registryName === 'string' ? registryName : ''
  const last = name.split('/').filter(Boolean).at(-1) ?? 'server'
  const normalized = last
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .replace(/_+/gu, '_')
  const stem = normalized.length > 0 ? normalized : 'server'
  const digest = createHash('sha256').update(name, 'utf8').digest('hex').slice(0, 4)
  const budget = MAX_SERVER_NAME - digest.length - 1
  const trimmed = stem.length > budget ? stem.slice(0, budget).replace(/_+$/gu, '') : stem
  const base = trimmed.length > 0 ? trimmed : 'server'
  return `${base}_${digest}`
}

/**
 * Derive the managed row id for a registry name.
 *
 * @param registryName - full registry name.
 * @returns `mcp-market-<serverName>`, stable across installs.
 */
export function rowIdFor(registryName) {
  return `${ROW_PREFIX}${serverNameFor(registryName)}`
}

/**
 * Extract the final path segment of a registry name, used as a title fallback.
 *
 * @param registryName - full registry name.
 * @returns the last slash-delimited segment.
 */
export function lastSegment(registryName) {
  const name = typeof registryName === 'string' ? registryName : ''
  return name.split('/').filter(Boolean).at(-1) ?? ''
}

export { REGISTRY_NAME_PATTERN, SERVER_NAME_PATTERN, ROW_ID_PATTERN }
