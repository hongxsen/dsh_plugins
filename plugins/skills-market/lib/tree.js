/**
 * GitHub tree helpers: locate a skill directory, bound its payload, and
 * refuse unsafe paths before any byte is downloaded.
 *
 * All functions here are pure so the resolution rules can be tested against
 * synthetic trees; the network layer in `remote.js` feeds them real GitHub
 * responses.
 */
import { MarketError } from './errors.js'
import { assertSafeRelativePath, safeRelativePath } from './paths.js'
import { CANDIDATE_FETCH_LIMIT, CANDIDATE_TREE_THRESHOLD, MAX_FILES, MAX_TOTAL_BYTES } from './constants.js'

/** Basename of a `/`-separated repository path. */
function baseName(path) {
  const index = path.lastIndexOf('/')
  return index === -1 ? path : path.slice(index + 1)
}

/** Directory part of a `/`-separated repository path. */
function directoryName(path) {
  const index = path.lastIndexOf('/')
  return index === -1 ? '' : path.slice(0, index)
}

/**
 * Keep only well-formed blob entries from a GitHub tree response.
 *
 * Unsafe paths are kept in the result so {@link collectSkillFiles} can reject
 * them when they fall under the chosen directory instead of silently skipping
 * malicious payload entries; selection helpers filter them on their own.
 * @param tree - `tree` array from the GitHub trees API.
 * @returns blob entries carrying a string path.
 */
export function normalizeTree(tree) {
  if (!Array.isArray(tree)) return []
  const blobs = []
  for (const entry of tree) {
    if (entry === null || typeof entry !== 'object') continue
    if (entry.type !== 'blob' || typeof entry.path !== 'string') continue
    blobs.push(entry)
  }
  return blobs
}

/**
 * Locate a skill in a repository tree.
 *
 * Order: a `SKILL.md` whose directory is named like the skill, then a flat
 * `<skillId>.md`, then the caller resolves by frontmatter name using
 * {@link candidateSkillManifests}.
 *
 * @param tree - `tree` array from the GitHub trees API.
 * @param skillId - catalog skill id.
 * @returns `{ kind: 'directory', path, skillMd, entry }`,
 *   `{ kind: 'file', path, skillMd, entry }`, or `null`.
 */
export function selectSkillFromTree(tree, skillId) {
  const blobs = normalizeTree(tree)
  const wanted = String(skillId).toLowerCase()

  const safeBlobs = blobs.filter((entry) => safeRelativePath(entry.path) !== null)
  const directoryMatches = safeBlobs
    .filter((entry) => {
      const lower = entry.path.toLowerCase()
      return lower.endsWith('/skill.md') && baseName(directoryName(entry.path)).toLowerCase() === wanted
    })
    .sort(comparePaths)
  if (directoryMatches.length > 0) {
    const entry = directoryMatches[0]
    return {
      kind: 'directory',
      path: directoryName(entry.path),
      skillMd: entry.path,
      entry,
    }
  }

  const flatMatches = safeBlobs
    .filter((entry) => {
      const lower = entry.path.toLowerCase()
      if (!lower.endsWith('.md')) return false
      const fileName = baseName(entry.path)
      const stem = fileName.slice(0, -3)
      return stem.toLowerCase() === wanted && stem.toLowerCase() !== 'skill'
    })
    .sort(comparePaths)
  if (flatMatches.length > 0) {
    const entry = flatMatches[0]
    return {
      kind: 'file',
      path: entry.path,
      skillMd: entry.path,
      entry,
    }
  }

  return null
}

/**
 * Order candidates stably: shallower paths first, then lexicographic.
 * @param left - tree entry.
 * @param right - tree entry.
 * @returns the comparator result.
 */
function comparePaths(left, right) {
  const depth = left.path.split('/').length - right.path.split('/').length
  if (depth !== 0) return depth
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0
}

/**
 * Return whether a path sits below one of the conventional skill containers.
 * @param path - repository path.
 * @returns whether the hint applies.
 */
export function hasSkillContainerHint(path) {
  const lower = path.toLowerCase()
  return lower.startsWith('skills/')
    || lower.includes('/skills/')
    || lower.startsWith('plugins/')
    || lower.includes('/plugins/')
    || lower.startsWith('.claude/skills/')
    || lower.includes('/.claude/skills/')
}

/**
 * List `SKILL.md` paths worth fetching when the tree has no name match.
 *
 * Repositories with fewer than {@link CANDIDATE_TREE_THRESHOLD} manifests are
 * searched everywhere; larger repositories are narrowed to the conventional
 * skill containers first so a monorepo does not turn into 20 random fetches.
 *
 * @param tree - `tree` array from the GitHub trees API.
 * @param limit - maximum candidates returned.
 * @returns repository paths, sorted shallow-first.
 */
export function candidateSkillManifests(tree, limit = CANDIDATE_FETCH_LIMIT) {
  const blobs = normalizeTree(tree)
  const manifests = blobs
    .filter((entry) => {
      if (safeRelativePath(entry.path) === null) return false
      const lower = entry.path.toLowerCase()
      return lower.endsWith('/skill.md') || lower === 'skill.md'
    })
  if (manifests.length === 0) return []
  const candidates = manifests.length < CANDIDATE_TREE_THRESHOLD
    ? manifests
    : manifests.filter((entry) => hasSkillContainerHint(entry.path))
  return candidates
    .sort(comparePaths)
    .slice(0, limit)
    .map((entry) => entry.path)
}

/**
 * Collect the files that belong to a selected skill.
 *
 * Every path is proven relative and contained, symlink blobs are refused, and
 * the payload is bounded before downloading. For a flat `<skillId>.md` skill
 * the single file is normalized to `SKILL.md` so the installed result is a
 * normal skill directory.
 *
 * @param tree - `tree` array from the GitHub trees API.
 * @param selection - result of {@link selectSkillFromTree}.
 * @param limits - optional `{ maxFiles, maxTotalBytes }` overrides for tests.
 * @returns `{ files, totalBytes }` where each file is
 *   `{ path, sourcePath, size, mode }` (`path` is relative to the skill).
 */
export function collectSkillFiles(tree, selection, limits = {}) {
  const maxFiles = limits.maxFiles ?? MAX_FILES
  const maxTotalBytes = limits.maxTotalBytes ?? MAX_TOTAL_BYTES

  if (selection.kind === 'file') {
    const entry = selection.entry
    rejectSymlink(entry)
    assertSafeRelativePath(selection.path)
    const size = numericSize(entry)
    if (size > maxTotalBytes) throw tooLarge(1, size, maxFiles, maxTotalBytes)
    return {
      files: [{
        path: 'SKILL.md',
        sourcePath: selection.path,
        size,
        mode: typeof entry.mode === 'string' ? entry.mode : '100644',
      }],
      totalBytes: size,
    }
  }

  const prefix = `${selection.path}/`
  const files = []
  let totalBytes = 0
  for (const entry of normalizeTree(tree)) {
    if (!entry.path.startsWith(prefix)) continue
    if (safeRelativePath(entry.path) === null) {
      throw new MarketError('skills/invalid-skill', 'Unsafe file path under the skill directory', { path: entry.path.slice(0, 200) })
    }
    const relative = entry.path.slice(prefix.length)
    if (safeRelativePath(relative) === null) {
      throw new MarketError('skills/invalid-skill', 'Unsafe file path under the skill directory', { path: entry.path.slice(0, 200) })
    }
    rejectSymlink(entry)
    const size = numericSize(entry)
    files.push({
      path: relative,
      sourcePath: entry.path,
      size,
      mode: typeof entry.mode === 'string' ? entry.mode : '100644',
    })
    totalBytes += size
    if (files.length > maxFiles || totalBytes > maxTotalBytes) {
      throw tooLarge(files.length, totalBytes, maxFiles, maxTotalBytes)
    }
  }
  return { files, totalBytes }
}

/** Refuse a git symlink blob. */
function rejectSymlink(entry) {
  if (entry.mode === '120000') {
    throw new MarketError('skills/invalid-skill', 'Symbolic links are not installable', { path: String(entry.path).slice(0, 200) })
  }
}

/** Normalize a missing tree size to zero so only the download enforces the cap. */
function numericSize(entry) {
  return typeof entry.size === 'number' && Number.isFinite(entry.size) && entry.size > 0 ? entry.size : 0
}

/** Build the bounded-payload error. */
function tooLarge(fileCount, totalBytes, maxFiles, maxTotalBytes) {
  return new MarketError('skills/too-large', 'Skill payload exceeds the install limits', {
    files: fileCount,
    totalBytes,
    maxFiles,
    maxTotalBytes,
  })
}
