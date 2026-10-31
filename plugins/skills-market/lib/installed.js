/**
 * Read-only scan of `<dshHome>/skills`.
 *
 * The scan mirrors what the DSH skill provider discovers: directories with a
 * `SKILL.md` and flat `<name>.md` files directly under the skills root. It
 * joins managed metadata, runs a fresh content scan for warnings, and marks an
 * entry writable only when its real path stays inside the root.
 */
import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { readSkillManifest } from './frontmatter.js'
import { isManaged, readMetadata } from './metadata.js'
import { scanBuffer } from './scan.js'
import {
  displayPath,
  isInside,
  metadataPathOf,
  skillsRootOf,
} from './paths.js'
import { MAX_FILES, MAX_SCAN_BYTES, MAX_TOTAL_BYTES } from './constants.js'

/** Largest SKILL.md read while scanning; a manifest never needs more. */
const MAX_MANIFEST_BYTES = 512 * 1024

/** Metadata fields copied into an installed entry. */
const METADATA_FIELDS = Object.freeze(['source', 'skillId', 'repo', 'branch', 'path', 'installedAt'])

/** `lstat` that maps absence to `null`. */
async function lstatOrNull(path) {
  try {
    return await lstat(path)
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null
    return null
  }
}

/**
 * Walk one skill and count files, bytes, and security warnings.
 * @param entryPath - skill directory or flat Markdown file.
 * @param isDirectory - whether the entry is a directory.
 * @returns `{ files, totalBytes, warnings }`.
 */
async function inspectPayload(entryPath, isDirectory) {
  let files = 0
  let totalBytes = 0
  let warnings = 0
  if (!isDirectory) {
    const info = await lstatOrNull(entryPath)
    if (info === null || !info.isFile() || info.isSymbolicLink()) return { files, totalBytes, warnings }
    files = 1
    totalBytes = info.size
    if (info.size <= MAX_SCAN_BYTES) {
      try {
        warnings = scanBuffer(await readFile(entryPath), entryPath).length
      } catch {
        warnings = 0
      }
    }
    return { files, totalBytes, warnings }
  }
  const walk = async (directory) => {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (files >= MAX_FILES || totalBytes >= MAX_TOTAL_BYTES) return
      const full = join(directory, entry.name)
      const info = await lstatOrNull(full)
      if (info === null || info.isSymbolicLink()) continue
      if (info.isDirectory()) {
        await walk(full)
        continue
      }
      if (!info.isFile()) continue
      files += 1
      totalBytes += info.size
      if (info.size <= MAX_SCAN_BYTES) {
        try {
          warnings += scanBuffer(await readFile(full), full).length
        } catch {
          // An unreadable file simply contributes no warnings.
        }
      }
    }
  }
  await walk(entryPath)
  return { files, totalBytes, warnings }
}

/**
 * Parse one candidate skill entry.
 * @param entryPath - directory or flat file.
 * @param isDirectory - whether it is a directory.
 * @param fallbackName - directory name or flat file stem.
 * @returns manifest fields.
 */
async function readManifest(entryPath, isDirectory, fallbackName) {
  const manifestPath = isDirectory ? join(entryPath, 'SKILL.md') : entryPath
  const info = await lstatOrNull(manifestPath)
  if (info === null || !info.isFile() || info.isSymbolicLink()) {
    return { name: fallbackName, description: '', valid: false }
  }
  if (info.size > MAX_MANIFEST_BYTES) {
    return { name: fallbackName, description: '', valid: false }
  }
  let text
  try {
    text = (await readFile(manifestPath)).toString('utf8')
  } catch {
    return { name: fallbackName, description: '', valid: false }
  }
  const manifest = readSkillManifest(text)
  if (!manifest.ok) return { name: fallbackName, description: '', valid: false }
  return { name: manifest.name, description: manifest.description, valid: true }
}

/**
 * Scan installed skills.
 * @param dshHome - absolute DSH home.
 * @returns installed entries sorted by name.
 */
export async function scanInstalledSkills(dshHome) {
  const skillsRootRaw = skillsRootOf(dshHome)
  let skillsRoot
  try {
    skillsRoot = await realpath(skillsRootRaw)
  } catch {
    return []
  }
  const rootInfo = await lstatOrNull(skillsRoot)
  if (rootInfo === null || !rootInfo.isDirectory()) return []
  const metadata = await readMetadata(metadataPathOf(dshHome))
  let dirents
  try {
    dirents = await readdir(skillsRoot, { withFileTypes: true })
  } catch {
    return []
  }

  const directoryNames = new Set()
  for (const dirent of dirents) {
    if (dirent.isDirectory()) directoryNames.add(dirent.name)
  }

  const entries = []
  for (const dirent of dirents) {
    const isDirectory = dirent.isDirectory()
    const isFlat = dirent.isFile() && dirent.name.endsWith('.md') && !dirent.name.startsWith('.')
    if (!isDirectory && !isFlat) continue
    if (!isDirectory) {
      const stem = dirent.name.slice(0, -3)
      if (directoryNames.has(stem)) continue
    }
    const entryPath = join(skillsRoot, dirent.name)
    const info = await lstatOrNull(entryPath)
    if (info === null) continue
    if (info.isSymbolicLink()) continue
    if (isDirectory) {
      const manifestInfo = await lstatOrNull(join(entryPath, 'SKILL.md'))
      if (manifestInfo === null || !manifestInfo.isFile() || manifestInfo.isSymbolicLink()) continue
    }
    const fallbackName = isDirectory ? dirent.name : dirent.name.slice(0, -3)
    let realEntry
    try {
      realEntry = await realpath(entryPath)
    } catch {
      continue
    }
    const contained = isInside(skillsRoot, realEntry)
    if (!contained) continue
    const manifest = await readManifest(entryPath, isDirectory, fallbackName)
    const payload = await inspectPayload(entryPath, isDirectory)
    const record = isManaged(metadata, manifest.name) ? metadata.skills[manifest.name] : undefined
    const entry = {
      name: manifest.name,
      description: manifest.description,
      valid: manifest.valid,
      managed: record !== undefined,
      writable: contained,
      path: displayPath(entryPath),
      files: payload.files,
      totalBytes: payload.totalBytes,
      warnings: payload.warnings,
    }
    if (record !== undefined) {
      for (const field of METADATA_FIELDS) {
        if (record[field] !== undefined) entry[field] = record[field]
      }
    }
    entries.push(entry)
  }
  entries.sort((left, right) => left.name.localeCompare(right.name))
  return entries
}

/**
 * Return whether a skill name already occupies the skills root.
 * @param dshHome - absolute DSH home.
 * @param name - kebab-case skill name.
 * @returns whether `<root>/<name>` or `<root>/<name>.md` exists.
 */
export async function skillExists(dshHome, name) {
  const root = skillsRootOf(dshHome)
  return (await lstatOrNull(join(root, name))) !== null
    || (await lstatOrNull(join(root, `${name}.md`))) !== null
}
