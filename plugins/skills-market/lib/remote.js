/**
 * Remote catalog and GitHub access.
 *
 * Only `fetch` is used: no SDK, no npm dependency. Every response is bounded,
 * every request has a timeout, and failures become `skills/fetch-failed` (or
 * `skills/too-large`) so the routes can answer without leaking a stack.
 */
import { MarketError } from './errors.js'
import {
  FETCH_TIMEOUT_MS,
  INDEX_FETCH_TIMEOUT_MS,
  INDEX_MAX_BYTES,
  MAX_DETAIL_DESCRIPTION,
  MAX_FILE_BYTES,
  SEARCH_RESULT_LIMIT,
  SKILLS_SITE,
} from './constants.js'
import { validateSkillId, validateSource } from './validate.js'

/** User-Agent GitHub and skills.sh both accept. */
export const USER_AGENT = 'dsh-skills-market/0.2.0'

/** Default cap for JSON/HTML responses. */
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024

/** Cap for a SKILL.md fetched only to read its frontmatter name. */
const CANDIDATE_MAX_BYTES = 512 * 1024

/** HTML entities decoded from a page description; the spec's five only. */
const ENTITIES = Object.freeze({
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&amp;': '&',
})

/**
 * Snapshot response headers as lowercase keys.
 * @param headers - Headers instance or plain object.
 * @returns plain header map.
 */
export function headersToObject(headers) {
  const out = {}
  if (headers === undefined || headers === null) return out
  if (typeof headers.forEach === 'function') {
    headers.forEach((value, key) => {
      out[String(key).toLowerCase()] = String(value)
    })
    return out
  }
  for (const [key, value] of Object.entries(headers)) {
    out[key.toLowerCase()] = String(value)
  }
  return out
}

/**
 * Read a response body with a hard byte limit.
 * @param response - fetch response.
 * @param maxBytes - maximum accepted bytes.
 * @returns the body buffer.
 * @throws MarketError `skills/too-large` when the body exceeds the cap.
 */
export async function readBounded(response, maxBytes = DEFAULT_MAX_BYTES) {
  const declared = Number(headersToObject(response.headers)['content-length'])
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new MarketError('skills/too-large', 'The remote response is larger than the allowed limit', { maxBytes })
  }
  const body = response.body
  if (body === undefined || body === null) {
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > maxBytes) {
      throw new MarketError('skills/too-large', 'The remote response is larger than the allowed limit', { maxBytes })
    }
    return buffer
  }
  const reader = typeof body.getReader === 'function' ? body.getReader() : null
  if (reader === null) {
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > maxBytes) {
      throw new MarketError('skills/too-large', 'The remote response is larger than the allowed limit', { maxBytes })
    }
    return buffer
  }
  const chunks = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        try {
          await reader.cancel()
        } catch {
          // The overflow error below is the useful one.
        }
        throw new MarketError('skills/too-large', 'The remote response is larger than the allowed limit', { maxBytes })
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // Reader already released by cancel.
    }
  }
  return Buffer.concat(chunks)
}

/**
 * Perform a bounded, timed-out GET.
 * @param fetchImpl - fetch implementation.
 * @param url - absolute URL.
 * @param options - `{ headers, timeoutMs, maxBytes }`.
 * @returns `{ status, ok, headers, buffer }`.
 * @throws MarketError `skills/fetch-failed` or `skills/too-large`.
 */
export async function requestBuffer(fetchImpl, url, options = {}) {
  const {
    headers = {},
    timeoutMs = FETCH_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    method = 'GET',
  } = options
  const fetchFn = typeof fetchImpl === 'function' ? fetchImpl : globalThis.fetch
  if (typeof fetchFn !== 'function') {
    throw new MarketError('skills/fetch-failed', 'No fetch implementation is available')
  }
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, timeoutMs)
  try {
    const response = await fetchFn(url, {
      method,
      headers: { 'user-agent': USER_AGENT, ...headers },
      signal: controller.signal,
      redirect: 'follow',
    })
    const buffer = await readBounded(response, maxBytes)
    return {
      status: response.status,
      ok: response.ok === true,
      headers: headersToObject(response.headers),
      buffer,
    }
  } catch (error) {
    if (error instanceof MarketError) throw error
    const timedOut = controller.signal.aborted
    throw new MarketError('skills/fetch-failed', timedOut ? 'The remote request timed out' : 'The remote request failed', {
      reason: timedOut ? 'timeout' : 'network',
    })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Build the GitHub request headers, honoring `GITHUB_TOKEN`.
 * @param env - environment mapping.
 * @returns headers for api.github.com.
 */
export function githubHeaders(env = process.env) {
  const headers = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  }
  const token = env?.GITHUB_TOKEN
  if (typeof token === 'string' && token.trim() !== '') headers.authorization = `Bearer ${token.trim()}`
  return headers
}

/**
 * Build the fetch failure for an HTTP status, separating rate limits.
 * @param label - which service failed.
 * @param result - request result.
 * @returns the market error.
 */
function statusFailure(label, result) {
  const status = result.status
  if (status === 403 || status === 429) {
    const remaining = result.headers['x-ratelimit-remaining']
    if (remaining === '0' || status === 429) {
      return new MarketError('skills/fetch-failed', `${label} rate limit reached`, {
        status,
        retryAfter: result.headers['retry-after'] ?? null,
      })
    }
  }
  return new MarketError('skills/fetch-failed', `${label} returned HTTP ${status}`, { status })
}

/**
 * Normalize the skills.sh search payload.
 * @param payload - parsed JSON.
 * @returns skills capped at {@link SEARCH_RESULT_LIMIT}.
 */
export function normalizeSearchPayload(payload) {
  const list = Array.isArray(payload?.skills) ? payload.skills : []
  const seen = new Set()
  const skills = []
  for (const item of list) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
    let source
    let skillId
    try {
      source = validateSource(item.source)
      skillId = validateSkillId(item.skillId)
    } catch {
      continue
    }
    const id = typeof item.id === 'string' && item.id !== '' ? item.id : `${source}/${skillId}`
    if (seen.has(id)) continue
    seen.add(id)
    const name = typeof item.name === 'string' && item.name.trim() !== '' ? item.name.trim() : skillId
    const installs = typeof item.installs === 'number' && Number.isFinite(item.installs)
      ? Math.max(0, Math.floor(item.installs))
      : 0
    skills.push({ id, source, skillId, name, installs })
    if (skills.length >= SEARCH_RESULT_LIMIT) break
  }
  return skills
}

/**
 * Normalize a skills.sh-compatible base URL: absolute http(s) without a
 * trailing slash. Stored source URLs are already validated, but accepting the
 * value here keeps the helper usable on its own.
 * @param base - base URL such as `https://skills.example.com`.
 * @returns the base without trailing slashes.
 */
export function normalizeSourceBase(base) {
  const text = typeof base === 'string' && base.trim() !== '' ? base.trim() : SKILLS_SITE
  return text.replace(/\/+$/u, '')
}

/**
 * Build one skill page URL under a skills.sh-compatible base.
 * @param base - base URL.
 * @param source - `owner/repo`.
 * @param skillId - skill id.
 * @returns the page URL.
 */
export function skillPageUrlOf(base, source, skillId) {
  const [owner = '', repo = ''] = String(source ?? '').split('/')
  return `${normalizeSourceBase(base)}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(String(skillId ?? ''))}`
}

/**
 * Query the public skills.sh-compatible search endpoint.
 * @param fetchImpl - fetch implementation.
 * @param query - trimmed query of at least two characters.
 * @param base - catalog base; defaults to the public skills.sh site.
 * @returns normalized skills.
 * @throws MarketError `skills/invalid-query` on an upstream 400, otherwise
 *   `skills/fetch-failed`.
 */
export async function searchSkills(fetchImpl, query, base = SKILLS_SITE) {
  const url = `${normalizeSourceBase(base)}/api/search?q=${encodeURIComponent(query)}`
  const result = await requestBuffer(fetchImpl, url, {
    headers: { accept: 'application/json' },
    maxBytes: 4 * 1024 * 1024,
  })
  if (result.status === 400) {
    throw new MarketError('skills/invalid-query', 'The catalog rejected the search query', { status: 400 })
  }
  if (!result.ok) throw statusFailure('skills.sh search', result)
  let payload
  try {
    payload = JSON.parse(result.buffer.toString('utf8'))
  } catch {
    throw new MarketError('skills/fetch-failed', 'The catalog returned invalid JSON')
  }
  return normalizeSearchPayload(payload)
}

/**
 * Fetch a static JSON index document with the source-store caps.
 *
 * Content problems map to `sources/invalid-index`; transport and status
 * problems map to `sources/fetch-failed`. The body is returned as text so the
 * pure parser owns schema validation.
 * @param fetchImpl - fetch implementation.
 * @param url - validated absolute index URL.
 * @returns the document text.
 * @throws MarketError `sources/fetch-failed` or `sources/invalid-index`.
 */
export async function fetchSourceIndex(fetchImpl, url) {
  let result
  try {
    result = await requestBuffer(fetchImpl, url, {
      headers: { accept: 'application/json' },
      timeoutMs: INDEX_FETCH_TIMEOUT_MS,
      maxBytes: INDEX_MAX_BYTES,
    })
  } catch (error) {
    if (error instanceof MarketError && error.code === 'skills/too-large') {
      throw new MarketError('sources/invalid-index', 'The index document is too large', {
        maxBytes: INDEX_MAX_BYTES,
      })
    }
    const reason = error instanceof MarketError && typeof error.details?.reason === 'string'
      ? error.details.reason
      : 'network'
    throw new MarketError('sources/fetch-failed', 'The index document could not be fetched', { reason })
  }
  if (!result.ok) {
    throw new MarketError('sources/fetch-failed', `The index document returned HTTP ${result.status}`, {
      status: result.status,
    })
  }
  return result.buffer.toString('utf8')
}

/**
 * Decode the five HTML entities the catalog pages use in meta descriptions.
 * @param text - raw attribute value.
 * @returns decoded text.
 */
export function decodeHtmlEntities(text) {
  let output = String(text)
  for (const [entity, replacement] of Object.entries(ENTITIES)) {
    if (entity === '&amp;') continue
    output = output.split(entity).join(replacement)
  }
  return output.split('&amp;').join('&')
}

/**
 * Extract `<meta name="description">` from a server-rendered page.
 * @param html - page source.
 * @param limit - maximum characters returned.
 * @returns the collapsed description, or an empty string.
 */
export function extractMetaDescription(html, limit = MAX_DETAIL_DESCRIPTION) {
  if (typeof html !== 'string' || html === '') return ''
  const tags = html.match(/<meta\b[^>]*>/giu) ?? []
  for (const tag of tags) {
    const attributes = {}
    const pattern = /([A-Za-z][A-Za-z0-9:_-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gu
    for (const match of tag.matchAll(pattern)) {
      attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? ''
    }
    if (attributes.name?.toLowerCase() !== 'description') continue
    if (typeof attributes.content !== 'string') continue
    const decoded = decodeHtmlEntities(attributes.content).replace(/\s+/gu, ' ').trim()
    return decoded.slice(0, limit)
  }
  return ''
}

/**
 * Fetch the catalog page and read its meta description.
 * Failures are soft: an empty description still opens the detail page.
 * @param fetchImpl - fetch implementation.
 * @param source - `owner/repo`.
 * @param skillId - skill id.
 * @param base - catalog base; defaults to the public skills.sh site.
 * @returns `{ description, pageUrl }`.
 */
export async function fetchSkillDescription(fetchImpl, source, skillId, base = SKILLS_SITE) {
  const [owner, repo] = source.split('/')
  const pageUrl = `${normalizeSourceBase(base)}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(skillId)}`
  try {
    const result = await requestBuffer(fetchImpl, pageUrl, {
      headers: { accept: 'text/html' },
      maxBytes: 4 * 1024 * 1024,
    })
    if (!result.ok) return { description: '', pageUrl }
    return { description: extractMetaDescription(result.buffer.toString('utf8')), pageUrl }
  } catch {
    return { description: '', pageUrl }
  }
}

/**
 * Read a repository's default branch.
 * @param fetchImpl - fetch implementation.
 * @param source - `owner/repo`.
 * @param env - environment for `GITHUB_TOKEN`.
 * @returns the branch, `main` as the fallback, or `null` for a missing repo.
 */
export async function fetchRepoDefaultBranch(fetchImpl, source, env = process.env) {
  const url = `https://api.github.com/repos/${source}`
  const result = await requestBuffer(fetchImpl, url, { headers: githubHeaders(env), maxBytes: 2 * 1024 * 1024 })
  if (result.status === 404) return null
  if (!result.ok) throw statusFailure('GitHub repository', result)
  try {
    const payload = JSON.parse(result.buffer.toString('utf8'))
    return typeof payload?.default_branch === 'string' && payload.default_branch !== '' ? payload.default_branch : 'main'
  } catch {
    return 'main'
  }
}

/**
 * Read a recursive repository tree.
 * @param fetchImpl - fetch implementation.
 * @param source - `owner/repo`.
 * @param branch - branch name.
 * @param env - environment for `GITHUB_TOKEN`.
 * @returns `{ tree, truncated }`, or `null` when the branch/tree is missing.
 */
export async function fetchRepoTree(fetchImpl, source, branch, env = process.env) {
  const url = `https://api.github.com/repos/${source}/git/trees/${encodeURIComponent(branch)}?recursive=1`
  const result = await requestBuffer(fetchImpl, url, {
    headers: githubHeaders(env),
    maxBytes: 32 * 1024 * 1024,
  })
  if (result.status === 404) return null
  if (!result.ok) throw statusFailure('GitHub tree', result)
  try {
    const payload = JSON.parse(result.buffer.toString('utf8'))
    return {
      tree: Array.isArray(payload?.tree) ? payload.tree : [],
      truncated: payload?.truncated === true,
    }
  } catch {
    throw new MarketError('skills/fetch-failed', 'GitHub returned an invalid tree document')
  }
}

/**
 * Download one repository file from raw.githubusercontent.com.
 * @param fetchImpl - fetch implementation.
 * @param source - `owner/repo`.
 * @param branch - branch name.
 * @param path - repository-relative path.
 * @param options - `{ maxBytes }`.
 * @returns the file bytes.
 */
export async function downloadRawFile(fetchImpl, source, branch, path, options = {}) {
  const maxBytes = options.maxBytes ?? MAX_FILE_BYTES
  const encodedPath = path.split('/').map((segment) => encodeURIComponent(segment)).join('/')
  const url = `https://raw.githubusercontent.com/${source}/${encodeURIComponent(branch)}/${encodedPath}`
  const result = await requestBuffer(fetchImpl, url, {
    headers: { accept: '*/*' },
    maxBytes,
    timeoutMs: options.timeoutMs,
  })
  if (result.status === 404) {
    throw new MarketError('skills/fetch-failed', 'A file listed in the repository tree is no longer available', { path })
  }
  if (!result.ok) throw statusFailure('GitHub download', result)
  return result.buffer
}

/**
 * Fetch one candidate `SKILL.md`, tolerating oversize or missing files.
 * @param fetchImpl - fetch implementation.
 * @param source - `owner/repo`.
 * @param branch - branch name.
 * @param path - repository path.
 * @returns file text, or `null` when it cannot be read.
 */
export async function fetchCandidateManifest(fetchImpl, source, branch, path) {
  try {
    const buffer = await downloadRawFile(fetchImpl, source, branch, path, { maxBytes: CANDIDATE_MAX_BYTES })
    return buffer.toString('utf8')
  } catch {
    return null
  }
}
