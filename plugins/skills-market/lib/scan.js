/**
 * Content scan for staged and installed skills.
 *
 * Warnings never block an install: they are shown in the preview and the
 * second confirm click is the human decision. This module is deliberately
 * conservative — it flags patterns the way a reviewer would see them in a
 * terminal, and reports `{ file, line, snippet }` without interpreting them.
 */
import { MAX_SCAN_BYTES } from './constants.js'

/** A line is scanned for these regexes; a hit becomes one warning. */
const LINE_RULES = Object.freeze([
  {
    id: 'curl-pipe-shell',
    test: (line) => /\bcurl\b[^\n|]*\|\s*(?:sudo\s+)?(?:ba|da|z|k)?sh\b/iu.test(line),
  },
  {
    id: 'wget-pipe-shell',
    test: (line) => /\bwget\b[^\n|]*\|\s*(?:sudo\s+)?(?:ba|da|z|k)?sh\b/iu.test(line),
  },
  {
    id: 'eval-call',
    test: (line) => /\beval\s*\(/u.test(line),
  },
  {
    id: 'new-function',
    test: (line) => /\bnew\s+Function\s*\(/u.test(line),
  },
  {
    id: 'child-process',
    test: (line) => /\bchild_process\b/u.test(line),
  },
  {
    id: 'rm-rf-root',
    test: (line) => /\brm\s+-[A-Za-z]*r[A-Za-z]*f[A-Za-z]*\s+\/(?=\s|$)/u.test(line)
      || /\brm\s+-[A-Za-z]*f[A-Za-z]*r[A-Za-z]*\s+\/(?=\s|$)/u.test(line),
  },
  {
    id: 'sudo',
    test: (line) => /\bsudo\s/u.test(line),
  },
  {
    id: 'ssh-directory',
    test: (line) => /~\/\.ssh\b/u.test(line),
  },
  {
    id: 'aws-directory',
    test: (line) => /~\/\.aws\b/u.test(line),
  },
])

/** Markers that a file decodes or evaluates encoded program text. */
const DECODE_PATTERN = /\batob\s*\(|\bbase64\s+-d\b|\bb64decode\b|Buffer\.from\s*\([^)]*['"]base64['"]|from\s*\([^)]*['"]base64['"]/u
const EXECUTION_PATTERN = /\beval\s*\(|\bnew\s+Function\s*\(|\bexec(?:Sync)?\s*\(|\bspawn(?:Sync)?\s*\(|\|\s*(?:ba|da|z|k)?sh\b/u
const NETWORK_PATTERN = /\bfetch\s*\(|\bhttps?:\/\//u
const ENV_PATTERN = /\bprocess\.env\b/u

/** Cap one reported snippet. */
const SNIPPET_LIMIT = 160

/**
 * Return whether a buffer looks like UTF-8 text worth scanning.
 * @param buffer - file bytes.
 * @returns whether the first 8 KiB contain no NUL byte.
 */
export function isProbablyText(buffer) {
  if (!Buffer.isBuffer(buffer)) return false
  const probe = buffer.subarray(0, 8192)
  return !probe.includes(0)
}

/**
 * Scan one text document.
 * @param text - decoded file contents.
 * @param file - relative path reported with each warning.
 * @returns warnings `{ file, line, snippet }`, ordered by line.
 */
export function scanText(text, file) {
  if (typeof text !== 'string' || text === '') return []
  const lines = text.split(/\r?\n/u)
  const decodedExecution = DECODE_PATTERN.test(text) && EXECUTION_PATTERN.test(text)
  const networkUse = NETWORK_PATTERN.test(text)
  const warnings = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    let flagged = false
    for (const rule of LINE_RULES) {
      if (rule.test(line)) {
        flagged = true
        break
      }
    }
    if (!flagged && ENV_PATTERN.test(line) && networkUse) flagged = true
    if (!flagged && decodedExecution && DECODE_PATTERN.test(line)) flagged = true
    if (!flagged) continue
    warnings.push({
      file,
      line: index + 1,
      snippet: line.trim().slice(0, SNIPPET_LIMIT),
    })
  }
  return warnings
}

/**
 * Scan a buffer when it is text and within the scan cap.
 * @param buffer - file bytes.
 * @param file - relative path.
 * @returns warnings, empty for binary or oversized files.
 */
export function scanBuffer(buffer, file) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return []
  if (buffer.length > MAX_SCAN_BYTES) return []
  if (!isProbablyText(buffer)) return []
  return scanText(buffer.toString('utf8'), file)
}

/**
 * Scan many downloaded files.
 * @param files - `[{ path, buffer }]`.
 * @returns flattened warnings.
 */
export function scanFiles(files) {
  const warnings = []
  for (const file of files) {
    warnings.push(...scanBuffer(file.buffer, file.path))
  }
  return warnings
}
