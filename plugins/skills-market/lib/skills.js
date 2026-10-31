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
import {
  detailOf,
  findIndexEntry,
  parseIndexDocument,
  searchIndexSkills,
  searchResultOf,
} from './index-source.js'
import { scanInstalledSkills, skillExists } from './installed.js'
import { runPool } from './pool.js'
import { displayPath, resolveDshHome, skillsRootOf } from './paths.js'
import {
  downloadRawFile,
  fetchCandidateManifest,
  fetchRepoDefaultBranch,
  fetchRepoTree,
  fetchSkillDescription,
  fetchSourceIndex,
  searchSkills,
  skillPageUrlOf,
} from './remote.js'
import { createSourceStore } from './sources.js'
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
  const indexCache = new Map()
  const sourceStore = createSourceStore({ resolveHome, fetchImpl })

  /** Drop the oldest cache entries once the budget is exceeded. */
  const trimCache = (cache) => {
    while (cache.size > CACHE_ENTRIES) {
      const oldest = cache.keys().next().value
      cache.delete(oldest)
    }
  }

  /** Drop every cached payload after a source mutation or selection change. */
  const clearCaches = () => {
    searchCache.clear()
    detailCache.clear()
    indexCache.clear()
  }

  /**
   * Public metadata attached to search and detail responses.
   * @param source - normalized source.
   * @returns `{ id, kind, title, url }`.
   */
  const sourceMetadata = (source) => ({
    id: source.id,
    kind: source.kind,
    title: source.title,
    url: source.url,
  })

  /**
   * Resolve the requested source, defaulting to the selected one.
   * An invalid store falls back to the builtin source for reads.
   * @param sourceId - optional source id.
   * @returns the source record.
   * @throws MarketError `sources/not-found` for an unknown id.
   */
  async function resolveMarket(sourceId) {
    const requested = sourceId === undefined || sourceId === null ? '' : String(sourceId)
    const { store } = await sourceStore.snapshot()
    if (requested === '') {
      return store.sources.find((source) => source.id === store.selected) ?? store.sources[0]
    }
    const source = store.sources.find((candidate) => candidate.id === requested)
    if (source === undefined) {
      throw new MarketError('sources/not-found', 'The market source does not exist', {
        source: requested.slice(0, 80),
      })
    }
    return source
  }

  /**
   * Return the curated seed list shaped for one source.
   * @param source - normalized source.
   * @returns seed entries with `pageUrl` and `market`.
   */
  function seedSkillsFor(source) {
    return SEED_SKILLS.map((item) => ({
      ...item,
      pageUrl: skillPageUrlOf(source.url, item.source, item.skillId),
      market: source.id,
    }))
  }

  /**
   * Load (and cache for five minutes) one source's static index.
   * @param source - index source.
   * @returns `{ document, cached }`.
   */
  async function loadIndex(source) {
    const key = `${source.id}\0${source.url}`
    const cached = indexCache.get(key)
    if (cached !== undefined && now() - cached.at < CACHE_TTL_MS) {
      return { document: cached.document, cached: true }
    }
    const text = await fetchSourceIndex(fetchImpl, source.url)
    const document = parseIndexDocument(text)
    indexCache.set(key, { at: now(), document })
    trimCache(indexCache)
    return { document, cached: false }
  }

  /**
   * Search one market source.
   *
   * `skills-sh` sources behave like the original catalog (curated seed for
   * short queries and an offline fallback). Static `index` sources search the
   * cached document; an empty query lists every entry. Only the builtin source
   * silently degrades to the curated seed — a user-chosen source surfaces its
   * error so the panel can offer retry and source management.
   * @param rawQuery - query string from the route.
   * @param sourceId - optional source id; defaults to the selected source.
   * @returns `{ seed, query, skills, cached, warning?, source }`.
   */
  async function search(rawQuery, sourceId) {
    const { query, tooShort } = normalizeQuery(rawQuery)
    const source = await resolveMarket(sourceId)
    const market = sourceMetadata(source)
    if (source.kind === 'index') {
      const { document, cached } = await loadIndex(source)
      const skills = searchIndexSkills(document.skills, query)
        .map((entry) => searchResultOf(entry, source.id))
      return { seed: false, query, skills, cached, warning: null, source: market }
    }
    if (tooShort) {
      return { seed: true, query, skills: seedSkillsFor(source), cached: false, warning: null, source: market }
    }
    const key = `${source.id}\0${query.toLowerCase()}`
    const cached = searchCache.get(key)
    if (cached !== undefined && now() - cached.at < CACHE_TTL_MS) {
      return {
        seed: false,
        query,
        skills: cached.skills.map(cloneSkill),
        cached: true,
        warning: null,
        source: market,
      }
    }
    try {
      const skills = await searchSkills(fetchImpl, query, source.url)
      const enriched = skills.map((skill) => ({
        ...skill,
        pageUrl: skillPageUrlOf(source.url, skill.source, skill.skillId),
        market: source.id,
      }))
      searchCache.set(key, { at: now(), skills: enriched })
      trimCache(searchCache)
      return {
        seed: false,
        query,
        skills: enriched.map(cloneSkill),
        cached: false,
        warning: null,
        source: market,
      }
    } catch (error) {
      if (source.builtin !== true) throw error
      const warning = error instanceof MarketError && error.code === 'skills/invalid-query' ? 'query' : 'offline'
      return { seed: true, query, skills: seedSkillsFor(source), cached: false, warning, source: market }
    }
  }

  /**
   * Read the description and page URL for one skill in one market source.
   * @param source - `owner/repo`.
   * @param skillId - skill id.
   * @param marketId - optional source id; defaults to the selected source.
   * @returns `{ description, pageUrl, title }`.
   */
  async function detail(source, skillId, marketId) {
    validateSource(source)
    validateSkillId(skillId)
    const market = await resolveMarket(marketId)
    if (market.kind === 'index') {
      const { document } = await loadIndex(market)
      const entry = findIndexEntry(document.skills, source, skillId)
      if (entry === undefined) {
        throw new MarketError('skills/not-found', 'No index entry matches this skill', { source, skillId })
      }
      return detailOf(entry)
    }
    const key = `${market.id}\0${source}\0${skillId}`
    const cached = detailCache.get(key)
    if (cached !== undefined && now() - cached.at < CACHE_TTL_MS) {
      return { description: cached.description, pageUrl: cached.pageUrl, title: cached.title }
    }
    const result = await fetchSkillDescription(fetchImpl, source, skillId, market.url)
    const value = { description: result.description, pageUrl: result.pageUrl, title: skillId }
    detailCache.set(key, { at: now(), ...value })
    trimCache(detailCache)
    return value
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

  /**
   * Return the health payload with the skills root and source summary.
   * @returns `{ ok, root, version, sources: { count, selected } }`.
   */
  async function health() {
    const { store } = await sourceStore.snapshot()
    return {
      ok: true,
      root: displayPath(skillsRootOf(resolveHome())),
      version: VERSION,
      sources: { count: store.sources.length, selected: store.selected },
    }
  }

  /**
   * List the configured market sources.
   * @returns `{ version, selected, sources }`.
   */
  async function sources() {
    return sourceStore.list()
  }

  /**
   * Add a source. Index sources are fetched and validated before persisting.
   * @param input - `{ kind, title, url }`.
   * @returns `{ selected, sources, source }`.
   */
  async function addSource(input) {
    const result = await sourceStore.add(input)
    clearCaches()
    if (result.indexDocument !== undefined) {
      indexCache.set(`${result.source.id}\0${result.source.url}`, {
        at: now(),
        document: result.indexDocument,
      })
    }
    return { selected: result.selected, sources: result.sources, source: result.source }
  }

  /**
   * Remove a custom source. Removing the selected one selects the builtin.
   * @param id - source id.
   * @returns `{ selected, sources }`.
   */
  async function removeSource(id) {
    const result = await sourceStore.remove(id)
    clearCaches()
    return result
  }

  /**
   * Select a source.
   * @param id - source id.
   * @returns `{ selected, sources }`.
   */
  async function selectSource(id) {
    const result = await sourceStore.select(id)
    clearCaches()
    return result
  }

  return {
    search,
    detail,
    preview,
    install,
    installed,
    remove,
    health,
    sources,
    addSource,
    removeSource,
    selectSource,
  }
}
