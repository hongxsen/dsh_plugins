/**
 * Input validation shared by the routes and the install pipeline.
 *
 * These checks are intentionally duplicated at the network edge and again
 * before mutation: the Host never trusts that the browser sent the same
 * values it previewed.
 */
import { MarketError } from './errors.js'
import { MAX_QUERY_LENGTH } from './constants.js'

/** `owner/repo` accepted from the catalog. */
const SOURCE_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u

/** Skill id grammar from the spec. */
const SKILL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u

/**
 * Validate a catalog `source`.
 * @param source - candidate.
 * @returns the value unchanged.
 * @throws MarketError `skills/invalid-skill`.
 */
export function validateSource(source) {
  if (typeof source !== 'string' || !SOURCE_PATTERN.test(source)) {
    throw new MarketError('skills/invalid-skill', 'Invalid repository source')
  }
  const segments = source.split('/')
  if (segments.length !== 2 || segments.some((segment) => segment === '.' || segment === '..')) {
    throw new MarketError('skills/invalid-skill', 'Invalid repository source')
  }
  // The install pipeline speaks GitHub. Catalog entries whose "source" is a
  // site such as `smithery.ai/...` are not GitHub repositories and cannot be
  // resolved; reject them before a request is made.
  if (segments[0].includes('.')) {
    throw new MarketError('skills/invalid-skill', 'The catalog source is not a GitHub repository')
  }
  return source
}

/**
 * Validate a catalog `skillId`.
 * @param skillId - candidate.
 * @returns the value unchanged.
 * @throws MarketError `skills/invalid-skill`.
 */
export function validateSkillId(skillId) {
  if (typeof skillId !== 'string' || !SKILL_ID_PATTERN.test(skillId)) {
    throw new MarketError('skills/invalid-skill', 'Invalid skill id')
  }
  return skillId
}

/**
 * Validate and normalize a search query.
 * @param query - query string or missing value.
 * @returns `{ query, tooShort }`.
 * @throws MarketError `skills/invalid-query` for oversized or non-string input.
 */
export function normalizeQuery(query) {
  const text = query === undefined || query === null ? '' : String(query)
  if (text.length > MAX_QUERY_LENGTH) {
    throw new MarketError('skills/invalid-query', 'Search query is too long')
  }
  const trimmed = text.trim()
  return { query: trimmed, tooShort: trimmed.length < 2 }
}
