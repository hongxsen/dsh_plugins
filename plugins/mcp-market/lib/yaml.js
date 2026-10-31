/**
 * The managed YAML block inside a profile's `cordis.patch.yml`.
 *
 * Only the bytes between the two markers are owned by this plugin. Everything
 * else — comments, unrelated rows, formatting, the final newline — is preserved
 * verbatim. A small line-oriented parser reads the dsh-mcp-client rows outside
 * the block so the catalog can show them read-only without a YAML dependency.
 */
/** Opening marker. Keep this string byte-for-byte stable. */
export const MANAGED_START = '# >>> dsh-mcp-market managed block — do not edit between the markers'

/** Closing marker. Keep this string byte-for-byte stable. */
export const MANAGED_END = '# <<< dsh-mcp-market managed block'

/** The plugin package written into every managed row. */
export const MCP_CLIENT_PACKAGE = '@deepseek-ai/dsh-mcp-client'

/** YAML words that must be quoted to stay strings. */
const RESERVED = new Set(['true', 'false', 'null', '~', 'yes', 'no', 'on', 'off'])

/** Split text into lines without discarding their newline bytes. */
function scanLines(text) {
  const lines = []
  let index = 0
  while (index <= text.length) {
    const newline = text.indexOf('\n', index)
    const end = newline === -1 ? text.length : newline
    const raw = text.slice(index, end)
    lines.push({
      start: index,
      end,
      text: raw.endsWith('\r') ? raw.slice(0, -1) : raw,
    })
    if (newline === -1) break
    index = newline + 1
  }
  return lines
}

/** True when the string can be written as a plain YAML scalar. */
function isBare(value) {
  return /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/u.test(value) && !RESERVED.has(value.toLowerCase())
}

/** Quote one YAML string scalar, preferring single quotes for readability. */
export function quoteScalar(value) {
  const text = String(value)
  if (text === '') return "''"
  // JSON double-quoted strings are valid YAML 1.2 double-quoted scalars and
  // keep newlines (common in private keys) on one line as `\n` escapes.
  if (/[\u0000-\u001f\u007f]/u.test(text) || text.includes("'") || text.includes('\\') || /^\s|\s$/u.test(text)) {
    return JSON.stringify(text)
  }
  return `'${text}'`
}

/** Bare scalar when safe, quoted otherwise. */
export function bareScalar(value) {
  const text = String(value)
  return isBare(text) ? text : quoteScalar(text)
}

/** YAML mapping key. */
function yamlKey(value) {
  const text = String(value)
  return /^[A-Za-z_][A-Za-z0-9_.-]*$/u.test(text) ? text : quoteScalar(text)
}

/** Render one row inside the managed `insert` list. */
function renderRowLines(row) {
  const lines = []
  lines.push(`    - id: ${bareScalar(row.rowId)}`)
  lines.push('      name: \'@deepseek-ai/dsh-mcp-client\'')
  lines.push('      config:')
  lines.push(`        serverName: ${bareScalar(row.serverName)}`)
  if (row.transport === 'streamable-http') {
    lines.push('        transport: streamable-http')
    lines.push(`        url: ${quoteScalar(row.url)}`)
    const headers = Object.entries(row.headers ?? {})
    if (headers.length > 0) {
      lines.push('        headers:')
      for (const [name, value] of headers) lines.push(`          ${yamlKey(name)}: ${quoteScalar(value)}`)
    }
  } else if (row.transport === 'stdio') {
    lines.push('        transport: stdio')
    lines.push(`        command: ${bareScalar(row.command)}`)
    if ((row.args ?? []).length === 0) {
      lines.push('        args: []')
    } else {
      lines.push('        args:')
      for (const arg of row.args ?? []) lines.push(`          - ${quoteScalar(arg)}`)
    }
    const env = Object.entries(row.env ?? {})
    if (env.length > 0) {
      lines.push('        env:')
      for (const [name, value] of env) lines.push(`          ${yamlKey(name)}: ${quoteScalar(value)}`)
    }
  } else {
    throw new Error(`mcp-market: unsupported managed row transport ${JSON.stringify(row.transport)}`)
  }
  return lines
}

/**
 * Render the complete managed block, including both markers.
 *
 * @param rows - enabled managed rows.
 * @returns the block without a leading newline; empty when there is no row.
 */
export function renderManagedBlock(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return ''
  const lines = [MANAGED_START, '- insert:']
  for (const row of rows) lines.push(...renderRowLines(row))
  lines.push(MANAGED_END)
  return lines.join('\n')
}

/**
 * Locate the managed block.
 *
 * @returns `{ start, end, regionStart, eol }` with the block's line range.
 * @throws when a marker is unmatched or two opening markers appear.
 */
export function findManagedBlock(text) {
  const lines = scanLines(text)
  let opening
  let closing
  for (const line of lines) {
    const trimmed = line.text.trimEnd()
    if (trimmed === MANAGED_START) {
      if (opening !== undefined) throw new Error('mcp-market: the patch contains more than one managed block')
      opening = line
    } else if (trimmed === MANAGED_END) {
      if (opening === undefined) throw new Error('mcp-market: the patch contains a closing marker without an opening marker')
      closing = line
      break
    }
  }
  if (opening === undefined) return null
  if (closing === undefined) throw new Error('mcp-market: the managed block is not terminated')
  let regionStart = opening.start
  if (opening.start >= 2 && text.slice(opening.start - 2, opening.start) === '\r\n') regionStart = opening.start - 2
  else if (opening.start >= 1 && text[opening.start - 1] === '\n') regionStart = opening.start - 1
  return {
    start: opening.start,
    end: closing.end,
    regionStart,
    eol: text.includes('\r\n') ? '\r\n' : '\n',
  }
}

/**
 * Rewrite the managed block, appending one when absent.
 *
 * @param text - current patch bytes.
 * @param rows - enabled managed rows.
 * @returns the next patch bytes. No block and no rows returns the input unchanged.
 */
export function replaceManagedBlock(text, rows) {
  const source = typeof text === 'string' ? text : ''
  const rendered = renderManagedBlock(rows)
  const found = findManagedBlock(source)
  if (found !== null) {
    const leading = found.regionStart < found.start ? found.eol : ''
    const replacement = rendered === '' ? '' : leading + rendered
    return source.slice(0, found.regionStart) + replacement + source.slice(found.end)
  }
  if (rendered === '') return source
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  if (source.length === 0) return eol + rendered + eol
  const separator = source.endsWith('\n') ? eol : eol + eol
  return source + separator + rendered + eol
}

/** Remove the managed block, leaving every other byte untouched. */
export function removeManagedBlock(text) {
  return replaceManagedBlock(text, [])
}

/** Remove only the marker region for read-only external scanning. */
export function stripManagedBlock(text) {
  const source = typeof text === 'string' ? text : ''
  const found = findManagedBlock(source)
  if (found === null) return source
  return source.slice(0, found.start) + source.slice(found.end)
}

/** Parse a small YAML scalar (plain, single-quoted, or double-quoted). */
export function parseScalar(raw) {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (value === '') return ''
  if (value.startsWith("'")) {
    const match = /^'((?:[^']|'')*)'/u.exec(value)
    if (match !== null) return match[1].replaceAll("''", "'")
    return value.slice(1)
  }
  if (value.startsWith('"')) {
    const match = /^("(?:\\.|[^"\\])*")/u.exec(value)
    if (match !== null) {
      try {
        return JSON.parse(match[1])
      } catch {
        return match[1].slice(1, -1)
      }
    }
    return value.slice(1)
  }
  const comment = value.indexOf(' #')
  return (comment === -1 ? value : value.slice(0, comment)).trim()
}

/** Leading-space count of one line. */
function indentOf(line) {
  return line.length - line.trimStart().length
}

/** Interpret a YAML boolean. */
function parseBoolean(raw) {
  return /^(?:true|yes|on)$/iu.test(parseScalar(raw))
}

/** Read `key: value` from the text after a list dash or from a mapping line. */
function parseKeyLine(text) {
  const match = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/u.exec(text)
  if (match === null) return null
  return { key: match[1], value: match[2] }
}

/**
 * Parse `@deepseek-ai/dsh-mcp-client` rows outside the managed block.
 *
 * Supports both a row nested under `- insert:` and a top-level row. Only the
 * handful of fields the catalog displays are read; the text is never rewritten.
 *
 * @param text - current patch bytes.
 * @returns read-only rows: `{ rowId, serverName, transport, enabled, external: true }`.
 */
export function parseExternalMcpRows(text) {
  const source = stripManagedBlock(typeof text === 'string' ? text : '')
  const lines = source.split(/\r?\n/u)
  const found = []
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(\s*)-\s*(.*)$/u.exec(lines[index])
    if (match === null) continue
    const dashIndent = match[1].length
    const rest = match[2]
    if (rest === '' || /^insert\s*:/u.test(rest)) continue
    const keyIndent = dashIndent + 2
    const row = { id: '', name: '', disabled: false, config: {} }

    const inline = parseKeyLine(rest)
    const apply = (key, value, level) => {
      if (key === 'id' && level === keyIndent) row.id = parseScalar(value)
      else if (key === 'name' && level === keyIndent) row.name = parseScalar(value)
      else if (key === 'disabled' && level === keyIndent) row.disabled = parseBoolean(value)
      else if (key === 'enabled' && level === keyIndent) row.disabled = !parseBoolean(value)
      else if (level === keyIndent + 2 && key === 'serverName') row.config.serverName = parseScalar(value)
      else if (level === keyIndent + 2 && key === 'transport') row.config.transport = parseScalar(value)
      else if (level === keyIndent + 2 && key === 'url') row.config.url = parseScalar(value)
      else if (level === keyIndent + 2 && key === 'command') row.config.command = parseScalar(value)
    }
    if (inline !== null) apply(inline.key, inline.value, keyIndent)

    let cursor = index + 1
    for (; cursor < lines.length; cursor += 1) {
      const line = lines[cursor]
      if (line.trim() === '') continue
      const indent = indentOf(line)
      if (indent <= dashIndent) break
      const mapping = /^(\s*)([A-Za-z0-9_.-]+)\s*:\s*(.*)$/u.exec(line)
      if (mapping === null) continue
      apply(mapping[2], mapping[3], mapping[1].length)
    }
    index = cursor - 1

    if (row.id.length === 0 || row.name !== MCP_CLIENT_PACKAGE) continue
    found.push(row)
  }

  const grouped = new Map()
  for (const row of found) {
    const existing = grouped.get(row.id)
    if (existing === undefined) {
      grouped.set(row.id, {
        rowId: row.id,
        serverName: row.config.serverName ?? row.id,
        transport: row.config.transport ?? (row.config.url !== undefined
          ? 'streamable-http'
          : row.config.command !== undefined ? 'stdio' : 'unknown'),
        enabled: !row.disabled,
      })
      continue
    }
    existing.serverName = existing.serverName === existing.rowId && row.config.serverName !== undefined
      ? row.config.serverName
      : existing.serverName
    if (existing.transport === 'unknown' && row.config.transport !== undefined) existing.transport = row.config.transport
    if (row.disabled) existing.enabled = false
  }

  return [...grouped.values()].map(row => ({
    rowId: row.rowId,
    serverName: row.serverName,
    transport: row.transport,
    enabled: row.enabled,
    external: true,
  }))
}
