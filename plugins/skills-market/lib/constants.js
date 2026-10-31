/**
 * Constants shared by the Host half of the skills market.
 *
 * Keeping the limits and the curated seed in one plain module makes the
 * pipeline auditable: every cap the spec names lives here, and the tests can
 * import the same numbers the routes enforce.
 */

/** Package id used by the generated client bundle and the health payload. */
export const PACKAGE_NAME = '@hongxsen/dsh-skills-market'

/** Plugin version reported by `/api/health`. */
export const VERSION = '0.2.0'

/** Prefix route owned by this plugin. */
export const ROUTE_PREFIX = '/dsh-skills-market'

/** Locale namespace owned by the browser half. */
export const LOCALE_NS = 'skillsMarket'

/** Catalog host used for search and detail descriptions. */
export const SKILLS_SITE = 'https://www.skills.sh'

/** Search responses stay warm for five minutes, keyed by query. */
export const CACHE_TTL_MS = 5 * 60 * 1000

/** The builtin market source; it is always present and always first. */
export const BUILTIN_SOURCE = Object.freeze({
  id: 'skills-sh',
  kind: 'skills-sh',
  title: 'skills.sh',
  url: 'https://www.skills.sh',
  builtin: true,
})

/** Source kinds supported by the skills market. */
export const SOURCE_KINDS = Object.freeze(['skills-sh', 'index'])

/** Store schema version for `sources.json`. */
export const SOURCE_STORE_VERSION = 1

/** At most this many sources (builtin included). */
export const MAX_SOURCES = 20

/** Source titles are trimmed to this many characters. */
export const MAX_SOURCE_TITLE_LENGTH = 80

/** Source URLs are capped at this many characters. */
export const MAX_SOURCE_URL_LENGTH = 2048

/** Adding an index source fetches it once with this timeout. */
export const INDEX_FETCH_TIMEOUT_MS = 10 * 1000

/** A static index document is larger than this rejected. */
export const INDEX_MAX_BYTES = 2 * 1024 * 1024

/** A static index document lists at most this many skills. */
export const MAX_INDEX_SKILLS = 2000

/** A query needs at least this many characters before the remote catalog is used. */
export const MIN_QUERY_LENGTH = 2

/** Refuse pathological queries before they reach the catalog. */
export const MAX_QUERY_LENGTH = 200

/** Results returned per search. */
export const SEARCH_RESULT_LIMIT = 30

/** A staging preview expires after fifteen minutes. */
export const STAGING_TTL_MS = 15 * 60 * 1000

/** At most this many previews are kept on disk. */
export const STAGING_KEEP = 5

/** Installation caps: file count and total payload size. */
export const MAX_FILES = 200
export const MAX_TOTAL_BYTES = 8 * 1024 * 1024

/** Per-file download cap, so one huge blob cannot exhaust the total budget first. */
export const MAX_FILE_BYTES = 4 * 1024 * 1024

/** `skillMd` returned by the preview endpoint is capped at 128 KiB. */
export const MAX_PREVIEW_SKILL_MD_BYTES = 128 * 1024

/** Only files at or below this size are content-scanned. */
export const MAX_SCAN_BYTES = 256 * 1024

/** Maximum accepted JSON request body. */
export const MAX_BODY_BYTES = 1024 * 1024

/** Detail descriptions are capped at 1200 characters. */
export const MAX_DETAIL_DESCRIPTION = 1200

/** Preview warnings returned to the browser; the total is reported separately. */
export const MAX_PREVIEW_WARNINGS = 200

/** Parallel raw.githubusercontent downloads. */
export const DOWNLOAD_CONCURRENCY = 6

/** Candidate `SKILL.md` files fetched while resolving a skill by frontmatter name. */
export const CANDIDATE_FETCH_LIMIT = 20

/** Below this many `SKILL.md` files anywhere in the repository, all of them are candidates. */
export const CANDIDATE_TREE_THRESHOLD = 40

/** GitHub API branch/tree/detail timeout. */
export const FETCH_TIMEOUT_MS = 20 * 1000

/** Raw file download timeout. */
export const DOWNLOAD_TIMEOUT_MS = 30 * 1000

/** The curated list used before any query and as the offline fallback. */
export const SEED_SKILLS = Object.freeze([
  { name: 'frontend-design', source: 'anthropics/skills', skillId: 'frontend-design', installs: 1052099 },
  { name: 'find-skills', source: 'vercel-labs/skills', skillId: 'find-skills', installs: 4100000 },
  { name: 'agent-browser', source: 'vercel-labs/agent-browser', skillId: 'agent-browser', installs: 1300000 },
  { name: 'tdd', source: 'mattpocock/skills', skillId: 'tdd', installs: 1200000 },
  { name: 'handoff', source: 'mattpocock/skills', skillId: 'handoff', installs: 1100000 },
  { name: 'skill-creator', source: 'anthropics/skills', skillId: 'skill-creator', installs: 900000 },
  { name: 'docx', source: 'anthropics/skills', skillId: 'docx', installs: 800000 },
  { name: 'pdf', source: 'anthropics/skills', skillId: 'pdf', installs: 750000 },
  { name: 'xlsx', source: 'anthropics/skills', skillId: 'xlsx', installs: 700000 },
  { name: 'pptx', source: 'anthropics/skills', skillId: 'pptx', installs: 650000 },
].map(item => ({ ...item, id: `${item.source}/${item.skillId}` })))
