/**
 * SKILL.md frontmatter parsing.
 *
 * The market intentionally does not depend on a YAML library: it only needs
 * the top-level `name`, `description`, and optional boolean flags that the
 * skill contract uses. Quoted and plain scalars are supported, nested blocks
 * are ignored, and malformed fences are reported instead of guessed at.
 */

/** Public skill-name grammar; matches `@deepseek-ai/dsh-skill`. */
const KEBAB_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * Return whether a string is a valid kebab-case skill name.
 * @param name - candidate.
 * @returns whether the grammar accepts it.
 */
export function isKebabCase(name) {
  return typeof name === 'string' && KEBAB_NAME.test(name)
}

/**
 * Strip matching single or double quotes from a scalar.
 * @param value - raw scalar text.
 * @returns the decoded value.
 */
export function unquoteScalar(value) {
  const text = value.trim()
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    const inner = text.slice(1, -1)
    return inner.replace(/\\(["\\ntr])/gu, (match, escape) => {
      if (escape === 'n') return '\n'
      if (escape === 't') return '\t'
      if (escape === 'r') return '\r'
      return escape
    })
  }
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1).replace(/''/gu, "'")
  }
  return text
}

/**
 * Parse one scalar from a frontmatter line.
 * @param raw - text after the colon.
 * @returns a string or boolean.
 */
export function parseScalar(raw) {
  const text = raw.trim()
  if (text === 'true') return true
  if (text === 'false') return false
  if (text.startsWith('"') || text.startsWith("'")) return unquoteScalar(text)
  // A plain scalar may carry a trailing YAML comment introduced by whitespace.
  return text.replace(/\s+#.*$/u, '').trim()
}

/**
 * Split a SKILL.md document into top-level fields and body.
 * @param source - file contents.
 * @returns `{ closed, fields, body }`; `closed` is false when the opening
 *   fence has no matching closing fence.
 */
export function parseFrontmatter(source) {
  const text = String(source ?? '').replace(/^\uFEFF/u, '')
  const lines = text.split(/\r?\n/u)
  if (lines[0] === undefined || lines[0].trim() !== '---') {
    return { closed: false, fields: {}, body: text }
  }
  let end = -1
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '---') {
      end = index
      break
    }
  }
  if (end === -1) return { closed: false, fields: {}, body: '' }
  const fields = {}
  for (let index = 1; index < end; index += 1) {
    const line = lines[index]
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    // Nested YAML is not part of the contract; a skill's metadata stays flat.
    if (/^\s/u.test(line)) continue
    const match = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/u.exec(line)
    if (match === null) continue
    fields[match[1]] = parseScalar(match[2])
  }
  return { closed: true, fields, body: lines.slice(end + 1).join('\n') }
}

/**
 * Parse and validate the frontmatter the installer requires.
 * @param source - SKILL.md contents.
 * @returns `{ ok: true, name, description, attributes, body }` or
 *   `{ ok: false, reason }` where reason is `frontmatter`, `name`, or
 *   `description`.
 */
export function readSkillManifest(source) {
  const parsed = parseFrontmatter(source)
  if (!parsed.closed) return { ok: false, reason: 'frontmatter' }
  const rawName = parsed.fields.name
  const rawDescription = parsed.fields.description
  const name = typeof rawName === 'string' ? rawName.trim() : ''
  const description = typeof rawDescription === 'string' ? rawDescription.trim() : ''
  if (!isKebabCase(name)) return { ok: false, reason: 'name' }
  if (description === '') return { ok: false, reason: 'description' }
  return {
    ok: true,
    name,
    description,
    attributes: parsed.fields,
    body: parsed.body,
  }
}
