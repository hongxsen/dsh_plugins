import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  decodeHtmlEntities,
  downloadRawFile,
  extractMetaDescription,
  fetchRepoDefaultBranch,
  fetchRepoTree,
  fetchSkillDescription,
  githubHeaders,
  headersToObject,
  normalizeSearchPayload,
  readBounded,
  requestBuffer,
  searchSkills,
} from '../lib/remote.js'

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json' },
})

const html = (value, status = 200) => new Response(value, {
  status,
  headers: { 'content-type': 'text/html' },
})

function fetchStub(handler) {
  const calls = []
  const impl = async (url, init) => {
    calls.push(String(url))
    return handler(String(url), init)
  }
  impl.calls = calls
  return impl
}

test('headersToObject lowercases both Headers and plain objects', () => {
  assert.deepEqual(headersToObject(new Headers({ 'X-Test': '1' })), { 'x-test': '1' })
  assert.deepEqual(headersToObject({ 'X-Test': '2' }), { 'x-test': '2' })
  assert.deepEqual(headersToObject(undefined), {})
})

test('readBounded rejects oversized bodies', async () => {
  const response = new Response('x'.repeat(100))
  await assert.rejects(readBounded(response, 10), (error) => error.code === 'skills/too-large')
})

test('requestBuffer reports HTTP status and timeouts', async () => {
  const notFound = await requestBuffer(fetchStub(() => new Response('nope', { status: 404 })), 'https://x.test/a')
  assert.equal(notFound.status, 404)
  assert.equal(notFound.ok, false)
  assert.equal(notFound.buffer.toString(), 'nope')

  const slow = fetchStub((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')))
  }))
  await assert.rejects(
    requestBuffer(slow, 'https://x.test/slow', { timeoutMs: 20 }),
    (error) => error.code === 'skills/fetch-failed' && error.details.reason === 'timeout',
  )

  const offline = fetchStub(() => { throw new Error('offline') })
  await assert.rejects(
    requestBuffer(offline, 'https://x.test/offline'),
    (error) => error.code === 'skills/fetch-failed' && error.details.reason === 'network',
  )
})

test('normalizeSearchPayload filters invalid entries, deduplicates, and caps', () => {
  const skills = Array.from({ length: 35 }, (_value, index) => ({
    id: `owner/repo/skill-${index}`,
    source: 'owner/repo',
    skillId: `skill-${index}`,
    name: `Skill ${index}`,
    installs: index * 1000,
  }))
  skills.push(
    { source: 'bad source', skillId: 'x' },
    { source: 'owner/repo', skillId: 'bad/id' },
    { source: 'owner/repo', skillId: 'skill-0', name: 'duplicate' },
  )
  const normalized = normalizeSearchPayload({ skills })
  assert.equal(normalized.length, 30)
  assert.equal(normalized[0].installs, 0)
  assert.equal(normalized[1].name, 'Skill 1')
  assert.equal(normalized[0].id, 'owner/repo/skill-0')
})

test('searchSkills maps upstream 400 to invalid-query', async () => {
  const stub = fetchStub(() => json({ error: 'Query must be at least 2 characters' }, 400))
  await assert.rejects(searchSkills(stub, 'a'), (error) => error.code === 'skills/invalid-query')
})

test('decodeHtmlEntities decodes only the five catalog entities', () => {
  assert.equal(decodeHtmlEntities('a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;'), `a & b <c> "d" 'e'`)
  assert.equal(decodeHtmlEntities('&amp;lt;'), '&lt;')
})

test('extractMetaDescription accepts attribute order and caps length', () => {
  const page = '<head><meta content="One &amp; two" name="description"><meta name="og" content="x"></head>'
  assert.equal(extractMetaDescription(page, 100), 'One & two')
  const long = `<meta name="description" content="${'x'.repeat(2000)}">`
  assert.equal(extractMetaDescription(long, 1200).length, 1200)
  assert.equal(extractMetaDescription('<meta name="twitter:title" content="x">'), '')
  assert.equal(extractMetaDescription(''), '')
})

test('fetchSkillDescription fails soft on errors and returns a page URL', async () => {
  const stub = fetchStub(() => html('<meta name="description" content="Demo &amp; more">'))
  const detail = await fetchSkillDescription(stub, 'acme/skills', 'demo')
  assert.equal(detail.description, 'Demo & more')
  assert.equal(detail.pageUrl, 'https://www.skills.sh/acme/skills/demo')
  assert.deepEqual(stub.calls, ['https://www.skills.sh/acme/skills/demo'])

  const offline = fetchStub(() => { throw new Error('offline') })
  const empty = await fetchSkillDescription(offline, 'acme/skills', 'demo')
  assert.equal(empty.description, '')
})

test('githubHeaders includes a token only when present', () => {
  assert.equal(githubHeaders({}).authorization, undefined)
  assert.equal(githubHeaders({ GITHUB_TOKEN: 'secret' }).authorization, 'Bearer secret')
  assert.equal(githubHeaders({ GITHUB_TOKEN: '   ' }).authorization, undefined)
})

test('fetchRepoDefaultBranch falls back to main and maps 404 to null', async () => {
  const normal = await fetchRepoDefaultBranch(fetchStub(() => json({ default_branch: 'trunk' })), 'a/b', {})
  assert.equal(normal, 'trunk')
  const noBranch = await fetchRepoDefaultBranch(fetchStub(() => json({})), 'a/b', {})
  assert.equal(noBranch, 'main')
  const missing = await fetchRepoDefaultBranch(fetchStub(() => new Response('', { status: 404 })), 'a/b', {})
  assert.equal(missing, null)
})

test('fetchRepoTree returns truncation and maps branch 404 to null', async () => {
  const tree = await fetchRepoTree(fetchStub(() => json({ tree: [{ path: 'a', type: 'blob' }], truncated: true })), 'a/b', 'main', {})
  assert.deepEqual(tree, { tree: [{ path: 'a', type: 'blob' }], truncated: true })
  const missing = await fetchRepoTree(fetchStub(() => new Response('', { status: 404 })), 'a/b', 'main', {})
  assert.equal(missing, null)
})

test('rate-limited GitHub responses become fetch-failed with retry metadata', async () => {
  const stub = fetchStub(() => new Response(JSON.stringify({ message: 'rate limited' }), {
    status: 403,
    headers: { 'x-ratelimit-remaining': '0', 'retry-after': '60' },
  }))
  await assert.rejects(fetchRepoTree(stub, 'a/b', 'main', {}), (error) => {
    assert.equal(error.code, 'skills/fetch-failed')
    assert.equal(error.details.status, 403)
    assert.equal(error.details.retryAfter, '60')
    return true
  })
})

test('downloadRawFile encodes each path segment and maps 404', async () => {
  const stub = fetchStub(() => new Response('content'))
  const buffer = await downloadRawFile(stub, 'a/b', 'main', 'skills/my demo/SKILL.md')
  assert.equal(buffer.toString(), 'content')
  assert.equal(stub.calls[0], 'https://raw.githubusercontent.com/a/b/main/skills/my%20demo/SKILL.md')

  const missing = fetchStub(() => new Response('', { status: 404 }))
  await assert.rejects(
    downloadRawFile(missing, 'a/b', 'main', 'x.md'),
    (error) => error.code === 'skills/fetch-failed',
  )
})
