/**
 * The skills market service.
 *
 * Pure helpers live beside this file and own the rules; this module owns
 * orchestration: cache search results, resolve a skill through GitHub, stage
 * the preview, and hand install/remove to the guarded filesystem layer. Routes
 * depend on this object, so the Host can be exercised without a Cordis context
 * by passing a fetch stub and a temporary DSH home.
 */
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import {
  CACHE_TTL_MS,
  DOWNLOAD_CONCURRENCY,
  MAX_FILE_BYTES,
  MAX_PREVIEW_SKILL_MD_BYTES,
  MAX_PREVIEW_WARNINGS,
  MAX_TOTAL_BYTES,
  SEED_SKILLS,
  VERSION,
} from './constants.js'
import { MarketError } from './errors.js'
import { readSkillManifest } from './frontmatter.js'
import { scanInstalledSkills, skillExists } from './installed.js'
import { runPool } from './pool.js'
import { displayPath, resolveDshHome, skillsRootOf } from './paths.js'
import {
  downloadRawFile,
  fetchCandidateManifest,
  fetchRepoDefaultBranch,
  fetchRepoTree,
  fetchSkillDescription,
  searchSkills,
} from './remote.js'
import { scanFiles } from './scan.js'
import { installPreview, pruneStaging, removeInstalled, writePreview } from './staging.js'
import { candidateSkillManifests, collectSkillFiles, selectSkillFromTree } from './tree.js'
import { normalizeQuery, validateSkillId, validateSource } from './validate.js'

/** Search/description cache entry budget. */
const CACHE_ENTRIES = 50

/** Return a shallow copy of a skill so callers cannot mutate the cache. */
function cloneSkill(skill) {
  return { ...skill }
}

/** Find a tree entry by path. */
function treeEntryAt(tree, path) {
  for (const entry of tree) {
    if (entry !== null && typeof entry === 'object' && entry.path === path) return entry
  }
  return undefined
}

/** Parent directory of a `/`-separated path, or `''` at the repository root. */
function parentDirectory(path) {
  const index = path.lastIndexOf('/')
  return index === -1 ? '' : path.slice(0, index)
}

/**
 * Create the skills market service.
 * @param options.fetchImpl - fetch implementation (tests pass a stub).
 * @param options.env - environment mapping used for `DSH_HOME`/`GITHUB_TOKEN`.
 * @param options.dshHome - explicit DSH home (tests).
 * @param options.resolveHome - function returning the DSH home (overrides).
 * @param options.now - clock returning epoch milliseconds (tests).
 * @returns the service.
 */
export function createSkillsMarket(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const env = options.env ?? process.env
  const now = options.now ?? Date.now
  const resolveHome = typeof options.resolveHome === 'function'
    ? options.resolveHome
    : () => resolveDshHome(options.dshHome, env)

  const searchCache = new Map()
  const detailCache = new Map()

  /** Drop the oldest cache entries once the budget is exceeded. */
  const trimCache = (cache) => {
    while (cache.size > CACHE_ENTRIES) {
      const oldest = cache.keys().next().value
      cache.delete(oldest)
    }
  }

  /**
   * Search the catalog, falling back to the curated seed when the network or
   * the upstream API is unavailable.
   * @param rawQuery - query string from the route.
   * @returns `{ seed, query, skills, cached, warning? }`.
   */
  async function search(rawQuery) {
    const { query, tooShort } = normalizeQuery(rawQuery)
    if (tooShort) {
      return { seed: true, query, skills: SEED_SKILLS.map(cloneSkill), cached: false, warning: null }
    }
    const key = query.toLowerCase()
    const cached = searchCache.get(key)
    if (cached !== undefined && now() - cached.at < CACHE_TTL_MS) {
      return { seed: false, query, skills: cached.skills.map(cloneSkill), cached: true, warning: null }
    }
    try {
      const skills = await searchSkills(fetchImpl, query)
      searchCache.set(key, { at: now(), skills })
      trimCache(searchCache)
      return { seed: false, query, skills: skills.map(cloneSkill), cached: false, warning: null }
    } catch (error) {
      const warning = error instanceof MarketError && error.code === 'skills/invalid-query' ? 'query' : 'offline'
      return { seed: true, query, skills: SEED_SKILLS.map(cloneSkill), cached: false, warning }
    }
  }

  /**
   * Read the catalog description for one skill.
   * @param source - `owner/repo`.
   * @param skillId - skill id.
   * @returns `{ description, pageUrl }`.
   */
  async function detail(source, skillId) {
    validateSource(source)
    validateSkillId(skillId)
    const key = `${source}/${skillId}`
    const cached = detailCache.get(key)
    if (cached !== undefined && now() - cached.at < CACHE_TTL_MS) {
      return { description: cached.description, pageUrl: cached.pageUrl }
    }
    const result = await fetchSkillDescription(fetchImpl, source, skillId)
    detailCache.set(key, { at: now(), description: result.description, pageUrl: result.pageUrl })
    trimCache(detailCache)
    return { description: result.description, pageUrl: result.pageUrl }
  }

  /**
   * Resolve a catalog entry to a staged preview.
   * @param source - `owner/repo`.
   * @param skillId - catalog skill id.
   * @returns the preview object listed in the spec.
   */
  async function preview(source, skillId) {
    validateSource(source)
    validateSkillId(skillId)
    const dshHome = resolveHome()

    const defaultBranch = await fetchRepoDefaultBranch(fetchImpl, source, env)
    if (defaultBranch === null) {
      throw new MarketError('skills/not-found', 'The repository does not exist', { source })
    }
    let branch = defaultBranch
    let treeResult = await fetchRepoTree(fetchImpl, source, branch, env)
    if (treeResult === null && branch !== 'main') {
      branch = 'main'
      treeResult = await fetchRepoTree(fetchImpl, source, branch, env)
    }
    if (treeResult === null) {
      throw new MarketError('skills/not-found', 'The repository tree is not available', { source })
    }

    let selection = selectSkillFromTree(treeResult.tree, skillId)
    if (selection === null) {
      for (const candidate of candidateSkillManifests(treeResult.tree)) {
        const text = await fetchCandidateManifest(fetchImpl, source, branch, candidate)
        if (text === null) continue
        const manifest = readSkillManifest(text)
        if (!manifest.ok || manifest.name !== skillId) continue
        const entry = treeEntryAt(treeResult.tree, candidate)
        if (entry === undefined) continue
        const parent = parentDirectory(candidate)
        selection = parent === ''
          ? { kind: 'file', path: candidate, skillMd: candidate, entry }
          : { kind: 'directory', path: parent, skillMd: candidate, entry }
        break
      }
    }
    if (selection === null) {
      throw new MarketError('skills/not-found', 'No skill with this id exists in the repository', { source, skillId })
    }

    const { files } = collectSkillFiles(treeResult.tree, selection)
    const contents = new Map()
    let downloadedBytes = 0
    await runPool(files, DOWNLOAD_CONCURRENCY, async (file) => {
      const buffer = await downloadRawFile(fetchImpl, source, branch, file.sourcePath, { maxBytes: MAX_FILE_BYTES })
      downloadedBytes += buffer.length
      if (downloadedBytes > MAX_TOTAL_BYTES) {
        throw new MarketError('skills/too-large', 'Skill payload exceeds the install limits', {
          totalBytes: downloadedBytes,
          maxTotalBytes: MAX_TOTAL_BYTES,
        })
      }
      contents.set(file.path, buffer)
    })

    const downloaded = files.map((file) => ({ path: file.path, buffer: contents.get(file.path) }))
    const totalBytes = downloaded.reduce((sum, file) => sum + file.buffer.length, 0)
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new MarketError('skills/too-large', 'Skill payload exceeds the install limits', {
        totalBytes,
        maxTotalBytes: MAX_TOTAL_BYTES,
      })
    }
    const skillBuffer = contents.get('SKILL.md')
    if (skillBuffer === undefined) {
      throw new MarketError('skills/invalid-skill', 'SKILL.md is missing from the skill directory')
    }
    const manifest = readSkillManifest(skillBuffer.toString('utf8'))
    if (!manifest.ok) {
      throw new MarketError('skills/invalid-skill', 'SKILL.md frontmatter is not valid', { reason: manifest.reason })
    }

    const allWarnings = scanFiles(downloaded)
    const warnings = allWarnings.slice(0, MAX_PREVIEW_WARNINGS)
    const warningTotal = allWarnings.length
    const existing = await skillExists(dshHome, manifest.name)
    const token = randomUUID()
    const repo = `https://github.com/${source}`
    const previewFiles = downloaded.map((file) => ({ path: file.path, size: file.buffer.length }))
    const skillMd = skillBuffer.subarray(0, MAX_PREVIEW_SKILL_MD_BYTES).toString('utf8')
    const meta = {
      name: manifest.name,
      description: manifest.description,
      source,
      skillId,
      repo,
      branch,
      path: selection.path,
      files: previewFiles,
      totalBytes,
      skillMd,
      warnings,
      warningTotal,
    }
    await writePreview(dshHome, token, meta, downloaded, { now: now() })
    await pruneStaging(dshHome, { now: now() })
    return {
      token,
      name: manifest.name,
      description: manifest.description,
      source,
      skillId,
      repo,
      branch,
      path: selection.path,
      files: previewFiles,
      totalBytes,
      skillMd,
      warnings,
      warningTotal,
      existing,
      target: displayPath(join(skillsRootOf(dshHome), manifest.name)),
    }
  }

  /**
   * Install a previously staged preview.
   * @param input - `{ token, replace }`.
   * @returns `{ installed: true, name }`.
   */
  async function install(input) {
    const token = input?.token
    if (typeof token !== 'string' || token === '') {
      throw new MarketError('skills/staging-expired', 'The preview token is missing')
    }
    if (input.replace !== undefined && typeof input.replace !== 'boolean') {
      throw new MarketError('skills/invalid-skill', 'The replace flag must be a boolean')
    }
    return installPreview({
      dshHome: resolveHome(),
      token,
      replace: input.replace === true,
      now: now(),
    })
  }

  /**
   * Scan installed skills.
   * @returns `{ skills }`.
   */
  async function installed() {
    return { skills: await scanInstalledSkills(resolveHome()) }
  }

  /**
   * Remove one managed skill.
   * @param name - skill name.
   * @returns `{ removed: true }`.
   */
  async function remove(name) {
    if (typeof name !== 'string' || name === '') {
      throw new MarketError('skills/invalid-skill', 'A skill name is required')
    }
    return removeInstalled({ dshHome: resolveHome(), name, now: now() })
  }

  /** Return the health payload with the skills root rendered sympathetically. */
  function health() {
    return {
      ok: true,
      root: displayPath(skillsRootOf(resolveHome())),
      version: VERSION,
    }
  }

  return { search, detail, preview, install, installed, remove, health }
}
