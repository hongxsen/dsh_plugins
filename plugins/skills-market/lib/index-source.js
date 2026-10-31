/**
 * Static JSON index sources for the skills market.
 *
 * An index is a plain JSON document listing GitHub-hosted skills:
 *
 *   { "format": 1, "title": "...", "skills": [ { name, source, skillId, ... } ] }
 *
 * Everything here is pure so the parser and the search/detail rules can be
 * tested without a network or a DSH context. Parsing is strict about the
 * envelope (`format`, `skills`) and forgiving about individual entries: one
 * malformed entry is skipped instead of rejecting the whole document.
 */
import { MAX_DETAIL_DESCRIPTION, MAX_INDEX_SKILLS, MAX_SOURCE_TITLE_LENGTH } from './constants.js'
import { MarketError } from './errors.js'
import { validateSkillId, validateSource } from './validate.js'

/** Longest skill name accepted from an index entry. */
const MAX_INDEX_NAME_LENGTH = 200

/** Tags are short labels; cap each one and the list. */
const MAX_TAG_LENGTH = 32
const MAX_TAGS = 20

/** Homepage URLs share the source URL cap. */
const MAX_HOMEPAGE_LENGTH = 2048

/**
 * Build the public `sources/invalid-index` error.
 * @param message - short description.
 * @param details - safe structured context.
 * @returns the market error.
 */
function invalidIndex(message, details) {
  return new MarketError('sources/invalid-index', message, details)
}

/**
 * Collapse whitespace and cap a free-form string.
 * @param value - candidate.
 * @param limit - maximum characters.
 * @returns the normalized string, or an empty string.
 */
function normalizeText(value, limit) {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/gu, ' ').trim().slice(0, limit)
}

/**
 * Normalize an install count. Numeric strings are accepted because hand-written
 * indexes often quote numbers.
 * @param value - candidate.
 * @returns a non-negative integer.
 */
function normalizeInstalls(value) {
  let number = NaN
  if (typeof value === 'number') number = value
  else if (typeof value === 'string' && value.trim() !== '') number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return 0
  return Math.floor(number)
}

/**
 * Normalize the optional tag list.
 * @param value - candidate array.
 * @returns unique short tags.
 */
function normalizeTags(value) {
  if (!Array.isArray(value)) return []
  const tags = []
  const seen = new Set()
  for (const raw of value) {
    if (typeof raw !== 'string') continue
    const tag = raw.replace(/\s+/gu, ' ').trim().slice(0, MAX_TAG_LENGTH)
    if (tag === '') continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    tags.push(tag)
    if (tags.length >= MAX_TAGS) break
  }
  return tags
}

/**
 * Normalize an optional homepage. Only absolute `http:`/`https:` URLs without
 * credentials are kept so the result is safe to render as a link.
 * @param value - candidate.
 * @returns the normalized URL, or `null`.
 */
export function normalizeHomepage(value) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (text === '' || text.length > MAX_HOMEPAGE_LENGTH) return null
  let url
  try {
    url = new URL(text)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.username !== '' || url.password !== '' || url.hostname === '') return null
  return url.href
}

/**
 * Normalize one index entry.
 * @param raw - candidate object.
 * @returns the normalized entry, or `null` when it cannot be installed.
 */
export function normalizeIndexEntry(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const name = typeof raw.name === 'string' ? raw.name.replace(/\s+/gu, ' ').trim().slice(0, MAX_INDEX_NAME_LENGTH) : ''
  if (name === '') return null
  let source
  let skillId
  try {
    source = validateSource(raw.source)
    skillId = validateSkillId(raw.skillId)
  } catch {
    return null
  }
  const description = normalizeText(raw.description, MAX_DETAIL_DESCRIPTION)
  const homepage = normalizeHomepage(raw.homepage)
  return {
    id: `${source}/${skillId}`,
    name,
    source,
    skillId,
    description,
    installs: normalizeInstalls(raw.installs),
    tags: normalizeTags(raw.tags),
    homepage,
    pageUrl: homepage ?? `https://github.com/${source}`,
  }
}

/**
 * Parse and normalize a static index document.
 * @param text - UTF-8 document text.
 * @returns `{ format, title, description, skills }`.
 * @throws MarketError `sources/invalid-index` for an unreadable document.
 */
export function parseIndexDocument(text) {
  if (typeof text !== 'string') throw invalidIndex('The index document is not text')
  let document
  try {
    document = JSON.parse(text)
  } catch {
    throw invalidIndex('The index document is not valid JSON', { reason: 'json' })
  }
  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    throw invalidIndex('The index document must be a JSON object', { reason: 'shape' })
  }
  if (document.format !== 1) {
    throw invalidIndex('The index document must use format 1', { reason: 'format' })
  }
  if (!Array.isArray(document.skills)) {
    throw invalidIndex('The index document must contain a skills array', { reason: 'skills' })
  }
  if (document.skills.length > MAX_INDEX_SKILLS) {
    throw invalidIndex('The index document lists too many skills', {
      reason: 'too-many',
      limit: MAX_INDEX_SKILLS,
      count: document.skills.length,
    })
  }
  const skills = []
  const seen = new Set()
  for (const raw of document.skills) {
    const entry = normalizeIndexEntry(raw)
    if (entry === null || seen.has(entry.id)) continue
    seen.add(entry.id)
    skills.push(entry)
  }
  return {
    format: 1,
    title: normalizeText(document.title, MAX_SOURCE_TITLE_LENGTH),
    description: normalizeText(document.description, MAX_DETAIL_DESCRIPTION),
    skills,
  }
}

/**
 * Whether one entry contains every query token in any searchable field.
 * Tokens are matched case-insensitively and may appear in different fields.
 * @param entry - normalized index entry.
 * @param tokens - lowercased tokens.
 * @returns whether the entry matches.
 */
function matchesTokens(entry, tokens) {
  if (tokens.length === 0) return true
  const fields = [
    entry.name,
    entry.source,
    entry.skillId,
    entry.description,
    ...entry.tags,
  ].map((value) => String(value).toLowerCase())
  return tokens.every((token) => fields.some((field) => field.includes(token)))
}

/**
 * Search index entries.
 * @param entries - normalized entries.
 * @param query - untrusted query text.
 * @returns matching entries sorted by installs desc, then name.
 */
export function searchIndexSkills(entries, query) {
  const list = Array.isArray(entries) ? entries : []
  const tokens = String(query ?? '').trim().toLowerCase().split(/\s+/u).filter((token) => token !== '')
  const matches = list.filter((entry) => matchesTokens(entry, tokens))
  return matches.slice().sort((left, right) => {
    if (right.installs !== left.installs) return right.installs - left.installs
    const a = left.name.toLowerCase()
    const b = right.name.toLowerCase()
    if (a === b) return 0
    return a < b ? -1 : 1
  })
}

/**
 * Find one entry by exact `source` + `skillId`.
 * @param entries - normalized entries.
 * @param source - `owner/repo`.
 * @param skillId - skill id.
 * @returns the entry, or `undefined`.
 */
export function findIndexEntry(entries, source, skillId) {
  if (!Array.isArray(entries)) return undefined
  return entries.find((entry) => entry.source === source && entry.skillId === skillId)
}

/**
 * Shape one index entry as a search result.
 * @param entry - normalized entry.
 * @param market - source id attached to every result.
 * @returns the API skill object.
 */
export function searchResultOf(entry, market) {
  return {
    id: entry.id,
    name: entry.name,
    source: entry.source,
    skillId: entry.skillId,
    installs: entry.installs,
    description: entry.description,
    pageUrl: entry.pageUrl,
    market,
  }
}

/**
 * Shape one index entry as a detail response.
 * @param entry - normalized entry.
 * @returns `{ description, pageUrl, title }`.
 */
export function detailOf(entry) {
  return {
    description: entry.description,
    pageUrl: entry.pageUrl,
    title: entry.name,
  }
}
