/**
 * Read-only scan of the user skill roots used by DSH.
 *
 * The scan mirrors the DSH skill provider: directories with a `SKILL.md` and
 * flat `<name>.md` files directly under each root. It joins managed metadata,
 * runs a fresh content scan for warnings, and follows entry-point symlinks
 * read-only (nested payload symlinks are still ignored).
 */
import { lstat, readFile, readdir, realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { readSkillManifest } from './frontmatter.js'
import { isManaged, readMetadata } from './metadata.js'
import { scanBuffer } from './scan.js'
import {
  agentsSkillsRootOf,
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

/** `lstat` that maps absence and unreadable entries to `null`. */
async function lstatOrNull(path) {
  try {
    return await lstat(path)
  } catch {
    return null
  }
}

/** `stat` that maps absence and unreadable entries to `null`. */
async function statOrNull(path) {
  try {
    return await stat(path)
  } catch {
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
    // The entry itself may be a symlink. DSH follows it for discovery; do the
    // same here, while the entry's writability is determined separately.
    const info = await statOrNull(entryPath)
    if (info === null || !info.isFile()) return { files, totalBytes, warnings }
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
      // Do not recurse through payload symlinks. Only the skill entry point
      // itself is followed, matching the provider without escaping a tree.
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
  // Follow the entry-point symlink, but keep the size limit before reading.
  const info = await statOrNull(manifestPath)
  if (info === null || !info.isFile() || info.size > MAX_MANIFEST_BYTES) {
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
 * Scan one root. `managedRoot` controls whether market metadata is joined;
 * shared agent skills are intentionally never treated as market-managed.
 */
async function scanRoot(rootRaw, metadata, { managedRoot = false, rootKind = undefined } = {}) {
  let skillsRoot
  try {
    skillsRoot = await realpath(rootRaw)
  } catch {
    return []
  }
  const rootInfo = await statOrNull(skillsRoot)
  if (rootInfo === null || !rootInfo.isDirectory()) return []
  let dirents
  try {
    dirents = await readdir(skillsRoot, { withFileTypes: true })
  } catch {
    return []
  }

  // Dirent.isDirectory()/isFile() are false for symlinks. Stat each direct
  // entry once so symlinked skills are discovered just like regular entries.
  const kinds = new Map()
  for (const dirent of dirents) {
    if (dirent.name.startsWith('.')) continue
    const info = await statOrNull(join(skillsRoot, dirent.name))
    if (info !== null) kinds.set(dirent.name, info)
  }
  const directoryNames = new Set(
    [...kinds.entries()].filter(([, info]) => info.isDirectory()).map(([name]) => name),
  )

  const entries = []
  for (const dirent of dirents) {
    if (dirent.name.startsWith('.')) continue
    const info = kinds.get(dirent.name)
    if (info === undefined) continue
    const isDirectory = info.isDirectory()
    const isFlat = info.isFile() && dirent.name.endsWith('.md')
    if (!isDirectory && !isFlat) continue
    if (!isDirectory && directoryNames.has(dirent.name.slice(0, -3))) continue

    const entryPath = join(skillsRoot, dirent.name)
    if (isDirectory) {
      const manifestInfo = await statOrNull(join(entryPath, 'SKILL.md'))
      if (manifestInfo === null || !manifestInfo.isFile()) continue
    }
    const fallbackName = isDirectory ? dirent.name : dirent.name.slice(0, -3)
    let realEntry
    try {
      realEntry = await realpath(entryPath)
    } catch {
      continue
    }
    const contained = isInside(skillsRoot, realEntry)
    const entrySymlink = dirent.isSymbolicLink()
    const manifest = await readManifest(entryPath, isDirectory, fallbackName)
    const payload = await inspectPayload(entryPath, isDirectory)
    const record = managedRoot && contained && !entrySymlink && isManaged(metadata, manifest.name)
      ? metadata.skills[manifest.name]
      : undefined
    const entry = {
      name: manifest.name,
      description: manifest.description,
      valid: manifest.valid,
      managed: record !== undefined,
      writable: contained && !entrySymlink,
      path: displayPath(entryPath),
      files: payload.files,
      totalBytes: payload.totalBytes,
      warnings: payload.warnings,
    }
    // Keep the original DSH-root response shape stable; identify additional
    // roots explicitly so the client can explain why they are not removable.
    if (rootKind !== undefined) entry.root = rootKind
    if (record !== undefined) {
      for (const field of METADATA_FIELDS) {
        if (record[field] !== undefined) entry[field] = record[field]
      }
    }
    entries.push(entry)
  }
  return entries
}

/**
 * Scan installed skills.
 * @param dshHome - absolute DSH home.
 * @param options - optional `{ agentsHome }`; omitted keeps this low-level
 *   helper limited to the DSH root for deterministic callers and tests.
 * @returns installed entries sorted by name, then path.
 */
export async function scanInstalledSkills(dshHome, { agentsHome = undefined } = {}) {
  const metadata = await readMetadata(metadataPathOf(dshHome))
  const roots = [await scanRoot(skillsRootOf(dshHome), metadata, { managedRoot: true })]
  if (agentsHome !== undefined && agentsHome !== null && agentsHome !== '') {
    roots.push(await scanRoot(agentsSkillsRootOf(agentsHome), metadata, { rootKind: 'user-agents' }))
  }
  return roots.flat().sort((left, right) => left.name.localeCompare(right.name) || left.path.localeCompare(right.path))
}

/**
 * Return whether a skill name already occupies the DSH skills root.
 * @param dshHome - absolute DSH home.
 * @param name - kebab-case skill name.
 * @returns whether `<root>/<name>` or `<root>/<name>.md` exists.
 */
export async function skillExists(dshHome, name) {
  const root = skillsRootOf(dshHome)
  return (await lstatOrNull(join(root, name))) !== null
    || (await lstatOrNull(join(root, `${name}.md`))) !== null
}
