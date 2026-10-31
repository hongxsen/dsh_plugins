/**
 * Staging previews, atomic install, and guarded removal.
 *
 * A preview lives under `<dshHome>/storages/dsh-skills-market/staging/<uuid>/`
 * with a `payload/` directory that mirrors the skill's relative files. Install
 * moves that payload into `~/.dsh/skills/<name>` only after re-validating it,
 * and a previous install is parked in a trash directory so a failed rename can
 * be rolled back byte for byte.
 */
import { cp, lstat, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { MarketError } from './errors.js'
import { readSkillManifest, isKebabCase } from './frontmatter.js'
import { readMetadata, recordInstall, recordRemove, writeMetadata, isManaged } from './metadata.js'
import {
  STAGED_META_FILE,
  STAGED_PAYLOAD_DIR,
  assertInside,
  assertSafeRelativePath,
  ensureDirectory,
  isInside,
  isStagingToken,
  metadataPathOf,
  skillsRootOf,
  stagingRootOf,
  trashRootOf,
} from './paths.js'
import { MAX_FILES, MAX_TOTAL_BYTES, STAGING_KEEP, STAGING_TTL_MS } from './constants.js'

/** Metadata inside one staging directory. */
const PREVIEW_VERSION = 1

/**
 * `lstat` that maps absence to `null`.
 * @param path - target path.
 * @returns the stats, or `null` when absent.
 */
async function lstatOrNull(path) {
  try {
    return await lstat(path)
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null
    throw error
  }
}

/**
 * Create and validate the `.trash` directory inside the real skills root.
 *
 * The trash directory is inside `~/.dsh/skills` by contract, so it is checked
 * with lstat and realpath before anything is parked there. A symlinked
 * `.trash` would otherwise move a skill (or its replacement) outside the root.
 * @param dshHome - DSH home.
 * @param skillsRoot - real path of the skills root.
 * @returns the real trash path.
 */
async function prepareTrashRoot(dshHome, skillsRoot) {
  const requested = trashRootOf(dshHome)
  await ensureDirectory(requested)
  const info = await lstat(requested)
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new MarketError('skills/install-failed', 'The trash directory is not a real directory')
  }
  const real = await realpath(requested)
  if (!isInside(skillsRoot, real)) {
    throw new MarketError('skills/install-failed', 'The trash directory escapes the skills root')
  }
  return real
}

/**
 * Remove expired and surplus staging previews.
 * @param dshHome - DSH home.
 * @param options - `{ now }` for tests.
 */
export async function pruneStaging(dshHome, { now = Date.now() } = {}) {
  const root = stagingRootOf(dshHome)
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }
  const candidates = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !isStagingToken(entry.name)) continue
    const path = join(root, entry.name)
    const info = await lstatOrNull(path)
    if (info === null) continue
    if (info.isSymbolicLink() || !info.isDirectory()) continue
    candidates.push({ path, mtimeMs: info.mtimeMs })
  }
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs)
  await Promise.all(candidates.map(async (candidate, index) => {
    const expired = now - candidate.mtimeMs > STAGING_TTL_MS
    const surplus = index >= STAGING_KEEP
    if (!expired && !surplus) return
    try {
      await rm(candidate.path, { recursive: true, force: true })
    } catch {
      // A preview that cannot be removed must not fail the new preview.
    }
  }))
}

/**
 * Write one staging preview.
 * @param dshHome - DSH home.
 * @param token - `crypto.randomUUID()` token.
 * @param meta - preview metadata; `createdAtMs` is added here.
 * @param files - `[{ path, buffer }]` with paths relative to the skill.
 * @returns the preview directory.
 */
export async function writePreview(dshHome, token, meta, files, { now = Date.now() } = {}) {
  if (!isStagingToken(token)) throw new MarketError('skills/install-failed', 'Invalid staging token')
  const directory = join(stagingRootOf(dshHome), token)
  const payload = join(directory, STAGED_PAYLOAD_DIR)
  await rm(directory, { recursive: true, force: true })
  await ensureDirectory(payload)
  for (const file of files) {
    assertSafeRelativePath(file.path)
    const destination = join(payload, file.path)
    assertInside(payload, destination)
    await ensureDirectory(dirname(destination))
    await writeFile(destination, file.buffer, { mode: 0o600 })
  }
  const document = {
    version: PREVIEW_VERSION,
    ...meta,
    createdAtMs: now,
  }
  await writeFile(join(directory, STAGED_META_FILE), `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 })
  return directory
}

/**
 * Read and freshness-check a staging preview.
 * @param dshHome - DSH home.
 * @param token - staging token.
 * @param options - `{ now }`.
 * @returns `{ directory, payload, meta }`.
 * @throws MarketError `skills/staging-expired`.
 */
export async function readPreview(dshHome, token, { now = Date.now() } = {}) {
  if (!isStagingToken(token)) {
    throw new MarketError('skills/staging-expired', 'The preview token is not valid')
  }
  const directory = join(stagingRootOf(dshHome), token)
  let meta
  try {
    meta = JSON.parse(await readFile(join(directory, STAGED_META_FILE), 'utf8'))
  } catch {
    throw new MarketError('skills/staging-expired', 'The preview no longer exists')
  }
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) {
    throw new MarketError('skills/staging-expired', 'The preview metadata is not valid')
  }
  if (!Number.isFinite(meta.createdAtMs) || now - meta.createdAtMs > STAGING_TTL_MS || meta.createdAtMs > now + 60_000) {
    throw new MarketError('skills/staging-expired', 'The preview has expired')
  }
  return {
    directory,
    payload: join(directory, STAGED_PAYLOAD_DIR),
    meta,
  }
}

/**
 * Walk a staged payload and validate every entry before installation.
 * @param payload - absolute payload directory.
 * @returns `{ files, totalBytes, manifest, skillMd }`.
 * @throws MarketError `skills/invalid-skill` or `skills/too-large`.
 */
export async function validateStagedPayload(payload) {
  const info = await lstatOrNull(payload)
  if (info === null || !info.isDirectory() || info.isSymbolicLink()) {
    throw new MarketError('skills/invalid-skill', 'The staged payload is missing')
  }
  const files = []
  let totalBytes = 0
  const walk = async (directory, prefix) => {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      assertSafeRelativePath(relative)
      const full = join(directory, entry.name)
      const entryInfo = await lstat(full)
      if (entryInfo.isSymbolicLink()) {
        throw new MarketError('skills/invalid-skill', 'Symbolic links are not installable', { path: relative })
      }
      if (entryInfo.isDirectory()) {
        await walk(full, relative)
        continue
      }
      if (!entryInfo.isFile()) {
        throw new MarketError('skills/invalid-skill', 'Unsupported file type in the staging payload', { path: relative })
      }
      files.push({ path: relative, size: entryInfo.size })
      totalBytes += entryInfo.size
      if (files.length > MAX_FILES || totalBytes > MAX_TOTAL_BYTES) {
        throw new MarketError('skills/too-large', 'Skill payload exceeds the install limits', {
          files: files.length,
          totalBytes,
          maxFiles: MAX_FILES,
          maxTotalBytes: MAX_TOTAL_BYTES,
        })
      }
    }
  }
  await walk(payload, '')
  const skillMdFile = files.find((file) => file.path === 'SKILL.md')
  if (skillMdFile === undefined) {
    throw new MarketError('skills/invalid-skill', 'SKILL.md is missing from the staged skill')
  }
  const content = await readFile(join(payload, 'SKILL.md'))
  const manifest = readSkillManifest(content.toString('utf8'))
  if (!manifest.ok) {
    throw new MarketError('skills/invalid-skill', 'SKILL.md frontmatter is not valid', { reason: manifest.reason })
  }
  return { files, totalBytes, manifest, skillMd: content.toString('utf8') }
}

/**
 * Install a staged preview into `<dshHome>/skills/<name>`.
 * @param options.dshHome - DSH home.
 * @param options.token - preview token.
 * @param options.replace - allow replacing a managed install.
 * @param options.now - clock for tests.
 * @returns `{ installed: true, name }`.
 */
export async function installPreview({ dshHome, token, replace = false, now = Date.now() }) {
  const { directory, payload, meta } = await readPreview(dshHome, token, { now })
  const staged = await validateStagedPayload(payload)
  if (!isKebabCase(meta.name) || staged.manifest.name !== meta.name) {
    throw new MarketError('skills/invalid-skill', 'The staged skill name does not match its preview')
  }

  const skillsRootRaw = skillsRootOf(dshHome)
  await ensureDirectory(skillsRootRaw)
  const rootRawInfo = await lstat(skillsRootRaw)
  if (rootRawInfo.isSymbolicLink() || !rootRawInfo.isDirectory()) {
    throw new MarketError('skills/install-failed', 'The skills root must be a real directory')
  }
  const skillsRoot = await realpath(skillsRootRaw)
  const rootInfo = await lstat(skillsRoot)
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new MarketError('skills/install-failed', 'The skills root is not a directory')
  }
  const name = staged.manifest.name
  const target = join(skillsRoot, name)
  assertInside(skillsRoot, target)

  const metadataPath = metadataPathOf(dshHome)
  const metadata = await readMetadata(metadataPath)
  const existing = await lstatOrNull(target)
  if (existing !== null) {
    if (!replace) {
      throw new MarketError('skills/exists', 'A skill with this name is already installed', { name })
    }
    if (existing.isSymbolicLink() || !existing.isDirectory()) {
      throw new MarketError('skills/not-managed', 'The existing skill was not installed by this plugin', { name })
    }
    if (!isManaged(metadata, name)) {
      throw new MarketError('skills/not-managed', 'The existing skill was not installed by this plugin', { name })
    }
  }

  let trashRoot
  try {
    trashRoot = await prepareTrashRoot(dshHome, skillsRoot)
  } catch (error) {
    if (error instanceof MarketError) throw error
    throw new MarketError('skills/install-failed', 'Could not prepare the trash directory')
  }
  const trash = join(trashRoot, `${name}-${now}`)
  let parked = false
  let installed = false
  try {
    if (existing !== null) {
      await rename(target, trash)
      parked = true
    }
    try {
      await rename(payload, target)
    } catch (error) {
      if (error?.code !== 'EXDEV') throw error
      await cp(payload, target, { recursive: true, force: false, errorOnExist: true })
      await rm(payload, { recursive: true, force: true })
    }
    installed = true
    const placed = await lstat(target)
    const placedReal = await realpath(target)
    if (!placed.isDirectory() || placed.isSymbolicLink() || !isInside(skillsRoot, placedReal)) {
      throw new MarketError('skills/install-failed', 'The installed skill did not land inside the skills root')
    }
    const record = {
      name,
      source: String(meta.source ?? ''),
      skillId: String(meta.skillId ?? ''),
      repo: String(meta.repo ?? ''),
      branch: String(meta.branch ?? ''),
      path: String(meta.path ?? ''),
      installedAt: new Date(now).toISOString(),
      files: staged.files.length,
      totalBytes: staged.totalBytes,
    }
    await writeMetadata(metadataPath, recordInstall(metadata, record))
  } catch (error) {
    if (installed) {
      try {
        await rm(target, { recursive: true, force: true })
      } catch {
        // Best effort: the original failure still wins.
      }
    }
    if (parked) {
      try {
        await rename(trash, target)
      } catch {
        // Leaving the previous install in the trash directory is recoverable.
      }
    }
    if (error instanceof MarketError) throw error
    throw new MarketError('skills/install-failed', 'Could not move the staged skill into place', {
      reason: typeof error?.code === 'string' ? error.code : 'rename-failed',
    })
  }

  try {
    await rm(trash, { recursive: true, force: true })
  } catch {
    // A stale trash entry is harmless and pruned on a later install.
  }
  try {
    await rm(directory, { recursive: true, force: true })
  } catch {
    // The staging directory is inside the managed storage root either way.
  }
  return { installed: true, name }
}

/**
 * Remove one managed skill.
 * @param options.dshHome - DSH home.
 * @param options.name - skill name recorded in metadata.
 * @param options.now - clock for tests.
 * @returns `{ removed: true }`.
 */
export async function removeInstalled({ dshHome, name, now = Date.now() }) {
  if (!isKebabCase(name)) {
    throw new MarketError('skills/invalid-skill', 'Invalid skill name')
  }
  const metadataPath = metadataPathOf(dshHome)
  const metadata = await readMetadata(metadataPath)
  if (!isManaged(metadata, name)) {
    throw new MarketError('skills/not-managed', 'Only skills installed by this plugin can be removed', { name })
  }
  let skillsRoot
  try {
    const rootRawInfo = await lstat(skillsRootOf(dshHome))
    if (rootRawInfo.isSymbolicLink() || !rootRawInfo.isDirectory()) {
      throw new Error('skills root is not a real directory')
    }
    skillsRoot = await realpath(skillsRootOf(dshHome))
  } catch {
    throw new MarketError('skills/not-managed', 'Only skills installed by this plugin can be removed', { name })
  }
  assertInside(skillsRoot, join(skillsRoot, name))

  let target = join(skillsRoot, name)
  let info = await lstatOrNull(target)
  if (info === null) {
    target = join(skillsRoot, `${name}.md`)
    info = await lstatOrNull(target)
  }
  if (info === null || info.isSymbolicLink()) {
    throw new MarketError('skills/not-managed', 'Only skills installed by this plugin can be removed', { name })
  }
  if (!info.isDirectory() && !info.isFile()) {
    throw new MarketError('skills/not-managed', 'Only skills installed by this plugin can be removed', { name })
  }
  const realTarget = await realpath(target)
  if (!isInside(skillsRoot, realTarget)) {
    throw new MarketError('skills/not-managed', 'Only skills installed by this plugin can be removed', { name })
  }

  let trash
  try {
    trash = join(await prepareTrashRoot(dshHome, skillsRoot), `${name}-${now}`)
  } catch (error) {
    if (error instanceof MarketError) throw error
    throw new MarketError('skills/install-failed', 'Could not prepare the trash directory')
  }
  try {
    await rename(target, trash)
  } catch (error) {
    throw new MarketError('skills/install-failed', 'Could not move the skill out of the skills root', {
      reason: typeof error?.code === 'string' ? error.code : 'rename-failed',
    })
  }
  try {
    await writeMetadata(metadataPath, recordRemove(metadata, name))
  } catch {
    // The skill is gone; a stale record is corrected by the next install.
  }
  try {
    await rm(trash, { recursive: true, force: true })
  } catch {
    // Harmless; the trash root is inside managed storage.
  }
  return { removed: true }
}
