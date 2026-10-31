/**
 * Filesystem path helpers for the skills market.
 *
 * The market only ever writes two places inside the DSH home:
 * `<dshHome>/skills` and `<dshHome>/storages/dsh-skills-market`. Everything
 * here is pure or read-only except `ensureDirectory`; the install pipeline
 * additionally resolves real paths and refuses symlinks before mutating.
 */
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { MarketError } from './errors.js'

/** Directory name holding user skills under the DSH home. */
export const SKILLS_DIR_NAME = 'skills'

/** Storage directory owned by this plugin under the DSH home. */
export const STORAGE_DIR_NAME = 'dsh-skills-market'

/** Expand `~`, `~/...`, and `~\...` against the operating-system home. */
export function expandHomePath(path) {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

/**
 * Resolve the DSH home the same way `@deepseek-ai/dsh-home-paths` does:
 * explicit path, then `$DSH_HOME`, then `~/.dsh`.
 * @param configured - explicit override, when a caller has one.
 * @param env - environment mapping; defaults to `process.env`.
 * @returns the absolute DSH home.
 */
export function resolveDshHome(configured, env = process.env) {
  const fromEnv = env?.DSH_HOME
  const root = configured ?? (typeof fromEnv === 'string' && fromEnv.trim() !== '' ? fromEnv.trim() : join(homedir(), '.dsh'))
  return resolve(expandHomePath(root))
}

/** Absolute path of the user skills root. */
export function skillsRootOf(dshHome) {
  return join(dshHome, SKILLS_DIR_NAME)
}

/** Absolute path of this plugin's storage root. */
export function storageRootOf(dshHome) {
  return join(dshHome, 'storages', STORAGE_DIR_NAME)
}

/** Absolute path of the staging root. */
export function stagingRootOf(dshHome) {
  return join(storageRootOf(dshHome), 'staging')
}

/** Absolute path of the trash root used while replacing or removing skills. */
export function trashRootOf(dshHome) {
  return join(skillsRootOf(dshHome), '.trash')
}

/** Absolute path of the managed-install metadata document. */
export function metadataPathOf(dshHome) {
  return join(storageRootOf(dshHome), 'installed.json')
}

/** Absolute path of the market-source store. */
export function sourcesPathOf(dshHome) {
  return join(storageRootOf(dshHome), 'sources.json')
}

/**
 * Render a path inside the OS home with `~`.
 * @param path - absolute path.
 * @param home - home directory to collapse; defaults to the OS home.
 * @returns the display path, or the input when it is outside the home.
 */
export function displayPath(path, home = homedir()) {
  if (typeof path !== 'string' || path === '') return ''
  const root = resolve(home)
  const target = resolve(path)
  if (target === root) return '~'
  const rel = relative(root, target)
  if (rel === '' || rel.startsWith('..' + sep) || rel === '..' || isAbsolute(rel)) return target
  return `~${sep}${rel.split(sep).join('/')}`
}

/**
 * Return whether `target` is strictly inside `root` (not the root itself).
 * The comparison is lexical; callers that mutate must additionally resolve
 * real paths and reject symlinks.
 */
export function isInside(root, target) {
  const rel = relative(resolve(root), resolve(target))
  if (rel === '' || isAbsolute(rel)) return false
  return rel !== '..' && !rel.startsWith('..' + sep)
}

/**
 * Assert that a target stays inside a root.
 * @throws MarketError with the supplied code when it does not.
 */
export function assertInside(root, target, code = 'skills/invalid-skill') {
  if (!isInside(root, target)) throw new MarketError(code, 'Path escapes its managed root')
  return target
}

/**
 * Validate one repository-relative path segment list.
 * @param relativePath - candidate relative path using `/` separators.
 * @returns the path unchanged, or `null` when it is absolute, traversing, or
 *   contains characters that cannot be a single path segment.
 */
export function safeRelativePath(relativePath) {
  if (typeof relativePath !== 'string' || relativePath === '') return null
  if (relativePath.includes('\0') || relativePath.includes('\\')) return null
  if (relativePath.startsWith('/') || /^[A-Za-z]:/.test(relativePath)) return null
  const segments = relativePath.split('/')
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') return null
    for (let index = 0; index < segment.length; index += 1) {
      if (segment.charCodeAt(index) < 0x20) return null
    }
  }
  return relativePath
}

/**
 * Throw unless a relative path is safe.
 * @throws MarketError `skills/invalid-skill`.
 */
export function assertSafeRelativePath(relativePath) {
  if (safeRelativePath(relativePath) === null) {
    throw new MarketError('skills/invalid-skill', 'Unsafe file path in the skill payload', { path: String(relativePath).slice(0, 200) })
  }
  return relativePath
}

/** UUID-shaped staging tokens; `crypto.randomUUID()` produces this form. */
const TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Return whether a value can be a staging token.
 * @param token - candidate.
 * @returns whether it is safe to use as a directory name.
 */
export function isStagingToken(token) {
  return typeof token === 'string' && TOKEN_PATTERN.test(token)
}

/** Staged payload directory name inside one staging token. */
export const STAGED_PAYLOAD_DIR = 'payload'

/** Staging metadata file name inside one staging token. */
export const STAGED_META_FILE = 'meta.json'

/**
 * Create a directory tree, mode 0700 by default.
 * @param path - directory path.
 * @param mode - permission bits.
 */
export async function ensureDirectory(path, mode = 0o700) {
  await mkdir(path, { recursive: true, mode })
  return path
}
