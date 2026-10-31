/**
 * Atomic, serialized writes to the active profile patch.
 *
 * The profile patch is the user's own file, so this module keeps three
 * promises: only the managed block changes, the first modification leaves a
 * one-time backup, and two mutations can never interleave. Temporary files
 * stay next to the patch and are always cleaned up.
 */
import { chmod, copyFile, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { ApiError, mcpError } from './errors.js'
import { parseExternalMcpRows, replaceManagedBlock } from './yaml.js'

/** Suffix of the one-time backup created before the first write. */
export const BACKUP_SUFFIX = '.dsh-mcp-market.bak'

/** File mode for the patch, its backup, and temporary files. */
export const PATCH_MODE = 0o600

/** Return the backup path for one profile patch. */
export function backupPathFor(patchPath) {
  return `${patchPath}${BACKUP_SUFFIX}`
}

/**
 * A promise chain that runs one mutation at a time.
 * @returns `run(fn)` plus the current tail for diagnostics.
 */
export function createSerialQueue() {
  let tail = Promise.resolve()
  const run = fn => {
    const next = tail.then(fn, fn)
    tail = next.then(() => undefined, () => undefined)
    return next
  }
  return { run }
}

/**
 * Create the patch manager for one profile.
 *
 * @param options.patchPath - absolute `cordis.patch.yml` of the active profile.
 * @param options.logger - optional logger; messages never contain secrets.
 * @returns read/write helpers. Every write is serialized.
 */
export function createPatchManager({ patchPath, logger } = {}) {
  if (typeof patchPath !== 'string' || patchPath.length === 0) {
    throw new Error('mcp-market: a profile patch path is required')
  }
  const absolute = isAbsolute(patchPath) ? patchPath : resolve(patchPath)
  const backupPath = backupPathFor(absolute)
  const queue = createSerialQueue()

  const readText = async () => {
    try {
      return await readFile(absolute, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') return ''
      throw mcpError('patch-failed', 'The profile patch could not be read.', 500, { reason: 'read' })
    }
  }

  /** Make sure the one-time backup exists; a missing patch has nothing to back up. */
  const ensureBackup = async () => {
    try {
      await stat(backupPath)
      return false
    } catch (error) {
      if (error?.code !== 'ENOENT') throw mcpError('patch-failed', 'The profile patch backup could not be checked.', 500, { reason: 'backup' })
    }
    try {
      await stat(absolute)
    } catch (error) {
      if (error?.code === 'ENOENT') return false
      throw mcpError('patch-failed', 'The profile patch could not be checked.', 500, { reason: 'backup' })
    }
    try {
      await copyFile(absolute, backupPath)
      await chmod(backupPath, PATCH_MODE)
      return true
    } catch {
      throw mcpError('patch-failed', 'The profile patch backup could not be created.', 500, { reason: 'backup' })
    }
  }

  /** Write the patch atomically with mode 0600. */
  const atomicWrite = async content => {
    const directory = dirname(absolute)
    const temporary = join(directory, `.${basename(absolute)}.dsh-mcp-market.${process.pid}.${randomUUID()}.tmp`)
    try {
      await writeFile(temporary, content, { mode: PATCH_MODE, flag: 'wx' })
      await rename(temporary, absolute)
      await chmod(absolute, PATCH_MODE)
    } catch {
      try {
        await unlink(temporary)
      } catch {
        // The temporary file was never created or was already renamed.
      }
      throw mcpError('patch-failed', 'The profile patch could not be written.', 500, { reason: 'write' })
    }
  }

  /**
   * Replace the managed block with the enabled rows.
   *
   * @param rows - rows to write; an empty list removes the block.
   * @returns `{ changed, content }`.
   */
  const writeRows = rows => queue.run(async () => {
    const before = await readText()
    let next
    try {
      next = replaceManagedBlock(before, rows)
    } catch (error) {
      logger?.warn?.(`dsh-mcp-market: patch rewrite rejected: ${error?.message ?? 'invalid managed block'}`)
      throw mcpError('patch-failed', 'The profile patch contains an invalid managed block.', 500, { reason: 'markers' })
    }
    if (next === before) return { changed: false, content: before }
    await ensureBackup()
    await atomicWrite(next)
    return { changed: true, content: next }
  })

  return {
    patchPath: absolute,
    backupPath,
    read: () => readText(),
    readExternalRows: async () => parseExternalMcpRows(await readText()),
    writeRows,
    ensureBackup: () => queue.run(ensureBackup),
    queue,
  }
}

/**
 * Verify that a patch path is inside the allowed profile directory.
 * Defense in depth: the path always comes from `profileContext`, never a client.
 */
export function assertPatchPath(patchPath, profileDir) {
  if (typeof patchPath !== 'string' || !isAbsolute(patchPath)) {
    throw new ApiError('mcp/patch-failed', 'The active profile has no writable patch path.', 500)
  }
  if (typeof profileDir !== 'string' || profileDir.length === 0) return
  const root = resolve(profileDir)
  const candidate = resolve(patchPath)
  const inside = relative(root, candidate)
  if (inside.length === 0 || inside.startsWith('..') || isAbsolute(inside)) {
    throw new ApiError('mcp/patch-failed', 'The profile patch is outside the active profile directory.', 500)
  }
}
