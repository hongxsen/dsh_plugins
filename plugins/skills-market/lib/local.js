/**
 * Local skill installation.
 *
 * A user can point the market at a directory that contains a `SKILL.md`, at a
 * single `SKILL.md` file, or at a collection of direct child skills. Collections
 * return a lightweight picker first. A selected local tree is read without
 * following any symlink, capped by the same limits as a remote install,
 * content-scanned, and staged exactly like a remote preview so install/remove
 * keep one audited path.
 */
import { randomUUID } from 'node:crypto'
import { lstat, readFile, readdir, realpath, stat } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join } from 'node:path'
import {
  MAX_FILES,
  MAX_FILE_BYTES,
  MAX_PREVIEW_SKILL_MD_BYTES,
  MAX_PREVIEW_WARNINGS,
  MAX_TOTAL_BYTES,
} from './constants.js'
import { MarketError } from './errors.js'
import { readSkillManifest } from './frontmatter.js'
import { displayPath, expandHomePath, skillsRootOf } from './paths.js'
import { scanFiles } from './scan.js'
import { pruneStaging, writePreview } from './staging.js'
import { skillExists } from './installed.js'

/**
 * Read a local skill and stage a preview.
 * @param options.dshHome - DSH home.
 * @param options.inputPath - absolute path, `~/...` path, directory, or SKILL.md.
 * @param options.now - clock.
 * @returns a local preview with `kind: 'local'`/`localPath`, or a collection
 *   picker with `kind: 'local-collection'` and direct child `skills`.
 */
export async function previewLocalSkill({ dshHome, inputPath, now = Date.now() }) {
  if (typeof inputPath !== 'string' || inputPath.trim() === '') {
    throw new MarketError('skills/invalid-path', 'A local skill path is required')
  }
  const expanded = expandHomePath(inputPath.trim())
  if (!isAbsolute(expanded)) {
    throw new MarketError('skills/invalid-path', 'The local skill path must be absolute or start with ~', {
      field: 'path',
    })
  }
  let sourcePath
  try {
    const direct = await lstat(expanded)
    if (direct.isSymbolicLink()) {
      throw new MarketError('skills/invalid-skill', 'Symbolic links are not installable', { field: 'path' })
    }
    sourcePath = await realpath(expanded)
  } catch (error) {
    if (error instanceof MarketError) throw error
    throw new MarketError('skills/not-found', 'The local skill path does not exist', {
      reason: typeof error?.code === 'string' ? error.code : 'missing',
    })
  }
  const rootInfo = await stat(sourcePath)
  let files
  let displaySource
  if (rootInfo.isFile()) {
    if (extname(sourcePath).toLowerCase() !== '.md') {
      throw new MarketError('skills/invalid-skill', 'A local skill file must be a SKILL.md file')
    }
    const buffer = await readBoundedFile(sourcePath, rootInfo.size)
    files = [{ path: 'SKILL.md', buffer }]
    displaySource = displayPath(sourcePath)
  } else if (rootInfo.isDirectory()) {
    displaySource = displayPath(sourcePath)
    const rootManifest = await lstatOrNull(join(sourcePath, 'SKILL.md'))
    if (rootManifest === null) {
      // A directory such as ~/.claude/skills is a collection, not one giant
      // skill. Enumerate only its direct children; never walk the whole tree
      // just to discover that there is no root SKILL.md.
      return readLocalCollection(sourcePath, displaySource)
    }
    files = await readLocalTree(sourcePath)
  } else {
    throw new MarketError('skills/invalid-skill', 'The local skill path must be a directory or a SKILL.md file')
  }

  const skillBuffer = files.find((file) => file.path === 'SKILL.md')?.buffer
  if (skillBuffer === undefined) {
    throw new MarketError('skills/invalid-skill', 'SKILL.md is missing from the local skill directory')
  }
  const manifest = readSkillManifest(skillBuffer.toString('utf8'))
  if (!manifest.ok) {
    throw new MarketError('skills/invalid-skill', 'SKILL.md frontmatter is not valid', { reason: manifest.reason })
  }
  const totalBytes = files.reduce((sum, file) => sum + file.buffer.length, 0)
  const allWarnings = scanFiles(files)
  const warnings = allWarnings.slice(0, MAX_PREVIEW_WARNINGS)
  const warningTotal = allWarnings.length
  const existing = await skillExists(dshHome, manifest.name)
  const token = randomUUID()
  const previewFiles = files.map((file) => ({ path: file.path, size: file.buffer.length }))
  const skillMd = skillBuffer.subarray(0, MAX_PREVIEW_SKILL_MD_BYTES).toString('utf8')
  const meta = {
    name: manifest.name,
    description: manifest.description,
    source: 'local',
    skillId: manifest.name,
    repo: '',
    branch: '',
    path: displaySource,
    kind: 'local',
    localPath: displaySource,
    files: previewFiles,
    totalBytes,
    skillMd,
    warnings,
    warningTotal,
  }
  await writePreview(dshHome, token, meta, files, { now })
  await pruneStaging(dshHome, { now })
  return {
    token,
    name: manifest.name,
    description: manifest.description,
    source: 'local',
    skillId: manifest.name,
    repo: '',
    branch: '',
    path: displaySource,
    kind: 'local',
    localPath: displaySource,
    files: previewFiles,
    totalBytes,
    skillMd,
    warnings,
    warningTotal,
    existing,
    target: displayPath(join(skillsRootOf(dshHome), manifest.name)),
  }
}

/** `lstat` that maps an absent candidate to `null`. */
async function lstatOrNull(path) {
  try {
    return await lstat(path)
  } catch {
    return null
  }
}

/**
 * List direct child skills in a collection directory without staging anything.
 * Invalid or unsupported children are ignored; selecting a valid child runs
 * the normal single-skill preview and all of its safety checks.
 */
async function readLocalCollection(root, displaySource) {
  const entries = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => !entry.name.startsWith('.'))
    .sort((left, right) => left.name.localeCompare(right.name))
  const skills = []
  for (const entry of entries) {
    const full = join(root, entry.name)
    const info = await lstatOrNull(full)
    // Do not follow links in a collection picker. The user can install the
    // real directory explicitly after reviewing its location.
    if (info === null || info.isSymbolicLink()) continue
    let manifestPath
    let fallbackName
    if (info.isDirectory()) {
      manifestPath = join(full, 'SKILL.md')
      fallbackName = entry.name
    } else if (info.isFile() && extname(entry.name).toLowerCase() === '.md') {
      manifestPath = full
      fallbackName = entry.name.slice(0, -3)
    } else {
      continue
    }
    const manifestInfo = await lstatOrNull(manifestPath)
    if (manifestInfo === null || !manifestInfo.isFile() || manifestInfo.isSymbolicLink()) continue
    if (manifestInfo.size > MAX_PREVIEW_SKILL_MD_BYTES) continue
    let manifest
    try {
      manifest = readSkillManifest((await readFile(manifestPath)).toString('utf8'))
    } catch {
      continue
    }
    if (!manifest.ok) continue
    const localPath = displayPath(full)
    skills.push({
      name: manifest.name,
      skillId: manifest.name,
      description: manifest.description,
      kind: info.isDirectory() ? 'directory' : 'file',
      path: localPath,
      localPath,
    })
  }
  if (skills.length === 0) {
    throw new MarketError('skills/invalid-skill', 'The directory has no root SKILL.md or direct child skills', {
      path: displaySource,
    })
  }
  return {
    kind: 'local-collection',
    source: 'local',
    name: basename(root),
    description: '',
    path: displaySource,
    localPath: displaySource,
    skills,
  }
}

/** Read every regular file under a local skill directory, rejecting links. */
async function readLocalTree(root) {
  const files = []
  let totalBytes = 0
  const walk = async (directory, prefix) => {
    const entries = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.name !== '.git')
      .sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (relative.includes('\0') || relative.startsWith('/') || relative.split('/').includes('..')) {
        throw new MarketError('skills/invalid-skill', 'Unsafe file path in the local skill', { path: relative.slice(0, 200) })
      }
      const full = join(directory, entry.name)
      const info = await lstat(full)
      if (info.isSymbolicLink()) {
        throw new MarketError('skills/invalid-skill', 'Symbolic links are not installable', { path: relative })
      }
      if (info.isDirectory()) {
        await walk(full, relative)
        continue
      }
      if (!info.isFile()) {
        throw new MarketError('skills/invalid-skill', 'Unsupported file type in the local skill', { path: relative })
      }
      if (info.size > MAX_FILE_BYTES) {
        throw new MarketError('skills/too-large', 'A local skill file exceeds the per-file limit', {
          path: relative,
          maxBytes: MAX_FILE_BYTES,
        })
      }
      if (files.length + 1 > MAX_FILES || totalBytes + info.size > MAX_TOTAL_BYTES) {
        throw new MarketError('skills/too-large', 'The local skill exceeds the install limits', {
          files: files.length + 1,
          totalBytes: totalBytes + info.size,
          maxFiles: MAX_FILES,
          maxTotalBytes: MAX_TOTAL_BYTES,
        })
      }
      files.push({ path: relative, buffer: await readFile(full) })
      totalBytes += info.size
    }
  }
  await walk(root, '')
  if (!files.some((file) => file.path === 'SKILL.md')) {
    throw new MarketError('skills/invalid-skill', 'The local skill directory has no SKILL.md at its root')
  }
  return files
}

async function readBoundedFile(path, size) {
  if (size > MAX_FILE_BYTES) {
    throw new MarketError('skills/too-large', 'The local SKILL.md is too large', { maxBytes: MAX_FILE_BYTES })
  }
  return readFile(path)
}

/** Exported for focused tests. */
export { basename, dirname }
