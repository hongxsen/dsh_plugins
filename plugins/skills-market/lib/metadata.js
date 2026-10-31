/**
 * Managed-install metadata.
 *
 * `<dshHome>/storages/dsh-skills-market/installed.json` records every skill
 * this plugin installed. Only names present in this document may be replaced
 * or removed; an unknown directory under `~/.dsh/skills` is never deleted.
 */
import { readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { ensureDirectory } from './paths.js'

/** Metadata document version. */
export const METADATA_VERSION = 1

/** Return an empty, valid metadata document. */
export function emptyMetadata() {
  return { version: METADATA_VERSION, skills: {} }
}

/**
 * Validate and normalize a metadata document.
 * @param value - parsed JSON value.
 * @returns a safe document; malformed input degrades to an empty document.
 */
export function normalizeMetadata(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return emptyMetadata()
  const skills = value.skills
  if (skills === null || typeof skills !== 'object' || Array.isArray(skills)) return emptyMetadata()
  const normalized = {}
  for (const [name, record] of Object.entries(skills)) {
    if (record === null || typeof record !== 'object' || Array.isArray(record)) continue
    normalized[name] = { ...record, name: typeof record.name === 'string' ? record.name : name }
  }
  return { version: METADATA_VERSION, skills: normalized }
}

/**
 * Parse metadata JSON text.
 * @param text - file contents.
 * @returns the normalized document; corrupt JSON yields an empty document.
 */
export function parseMetadata(text) {
  try {
    return normalizeMetadata(JSON.parse(text))
  } catch {
    return emptyMetadata()
  }
}

/**
 * Read the metadata document, tolerating absence and corruption.
 * @param path - `installed.json` path.
 * @returns the normalized document.
 */
export async function readMetadata(path) {
  try {
    return parseMetadata(await readFile(path, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return emptyMetadata()
    return emptyMetadata()
  }
}

/**
 * Write the metadata document atomically.
 * @param path - `installed.json` path.
 * @param metadata - document to persist.
 */
export async function writeMetadata(path, metadata) {
  const normalized = normalizeMetadata(metadata)
  await ensureDirectory(dirname(path), 0o700)
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  try {
    await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, path)
  } catch (error) {
    try {
      await unlink(temporary)
    } catch {
      // The temporary file may already be gone; the original error matters.
    }
    throw error
  }
  return normalized
}

/**
 * Return whether a name is recorded as managed.
 * @param metadata - metadata document.
 * @param name - skill name.
 * @returns whether the plugin owns the install.
 */
export function isManaged(metadata, name) {
  return metadata !== undefined && metadata.skills !== undefined && Object.hasOwn(metadata.skills, name)
}

/**
 * Add or replace one record, returning a new document.
 * @param metadata - current document.
 * @param record - record to store.
 * @returns the updated document.
 */
export function recordInstall(metadata, record) {
  const base = normalizeMetadata(metadata)
  return {
    version: METADATA_VERSION,
    skills: { ...base.skills, [record.name]: { ...record } },
  }
}

/**
 * Remove one record, returning a new document.
 * @param metadata - current document.
 * @param name - skill name.
 * @returns the updated document.
 */
export function recordRemove(metadata, name) {
  const base = normalizeMetadata(metadata)
  const skills = { ...base.skills }
  delete skills[name]
  return { version: METADATA_VERSION, skills }
}
