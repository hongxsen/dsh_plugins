import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createSourceStore,
  defaultSourceStore,
  sanitizeSourceStore,
  validateSourceTitle,
  validateSourceUrl,
  newSourceId,
} from '../lib/sources.js'
import { parseIndexDocument, searchIndexSkills, findIndexEntry, searchResultOf } from '../lib/index-source.js'
import { createSkillsMarket } from '../lib/skills.js'

const INDEX = JSON.stringify({
  format: 1,
  title: 'Team Skills',
  skills: [
    { name: 'frontend-design', source: 'anthropics/skills', skillId: 'frontend-design', description: 'Design guidance', installs: 9, tags: ['design'] },
    { name: 'tdd', source: 'mattpocock/skills', skillId: 'tdd', description: 'Testing workflow', installs: 2 },
    { name: 'broken', source: 'not a repo', skillId: 'x' },
  ],
})

async function tempHome() {
  const home = await mkdtemp(join(tmpdir(), 'skills-sources-'))
  return { home, cleanup: () => rm(home, { recursive: true, force: true }) }
}

const indexFetch = async (url) => {
  if (url.endsWith('/index.json')) {
    return new Response(INDEX, { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return new Response('not found', { status: 404 })
}

test('source store starts with the builtin and persists a custom selection', async () => {
  const { home, cleanup } = await tempHome()
  try {
    const store = createSourceStore({ dshHome: home, fetchImpl: indexFetch })
    assert.deepEqual((await store.list()).sources.map(source => source.id), ['skills-sh'])
    const added = await store.add({ kind: 'index', title: 'Team Skills', url: 'https://example.test/index.json' })
    assert.match(added.source.id, /^custom-[0-9a-f]{8}$/u)
    let snapshot = await store.list()
    assert.equal(snapshot.selected, 'skills-sh')
    assert.equal(snapshot.sources.length, 2)
    await store.select(added.source.id)
    snapshot = await store.list()
    assert.equal(snapshot.selected, added.source.id)
    const second = createSourceStore({ dshHome: home, fetchImpl: indexFetch })
    assert.equal((await second.list()).selected, added.source.id)
    await store.remove(added.source.id)
    assert.equal((await store.list()).selected, 'skills-sh')
  } finally { await cleanup() }
})

test('source validation refuses bad kinds, titles, URLs, and builtin removal', async () => {
  const { home, cleanup } = await tempHome()
  try {
    const store = createSourceStore({ dshHome: home, fetchImpl: indexFetch })
    await assert.rejects(store.add({ kind: 'unknown', title: 'x', url: 'https://x.test' }), error => error.code === 'sources/invalid')
    await assert.rejects(store.add({ kind: 'index', title: '', url: 'https://x.test' }), error => error.code === 'sources/invalid')
    await assert.rejects(store.add({ kind: 'index', title: 'x', url: 'ftp://x.test' }), error => error.code === 'sources/invalid')
    await assert.rejects(store.add({ kind: 'index', title: 'x', url: 'https://user:pass@x.test' }), error => error.code === 'sources/invalid')
    await assert.rejects(store.remove('skills-sh'), error => error.code === 'sources/builtin')
    assert.equal(validateSourceTitle('  Team  '), 'Team')
    assert.match(newSourceId(), /^custom-[0-9a-f]{8}$/u)
    assert.deepEqual(validateSourceUrl('https://example.test/base/'), 'https://example.test/base/')
    assert.equal(defaultSourceStore().sources[0].builtin, true)
  } finally { await cleanup() }
})

test('an invalid index document is rejected before it is stored', async () => {
  const { home, cleanup } = await tempHome()
  try {
    const store = createSourceStore({
      dshHome: home,
      fetchImpl: async () => new Response(JSON.stringify({ format: 1 }), { status: 200 }),
    })
    await assert.rejects(store.add({ kind: 'index', title: 'bad', url: 'https://x.test/index.json' }), error => error.code === 'sources/invalid-index')
    assert.equal((await store.list()).sources.length, 1)
  } finally { await cleanup() }
})

test('index parsing filters invalid entries and searches fields', () => {
  const document = parseIndexDocument(INDEX)
  assert.equal(document.skills.length, 2)
  assert.equal(searchIndexSkills(document.skills, 'design').map(entry => entry.name).join(','), 'frontend-design')
  assert.equal(searchIndexSkills(document.skills, 'testing').map(entry => entry.name).join(','), 'tdd')
  const entry = findIndexEntry(document.skills, 'anthropics/skills', 'frontend-design')
  assert.equal(entry.pageUrl, 'https://github.com/anthropics/skills')
  const result = searchResultOf(entry, 'custom-1234abcd')
  assert.equal(result.market, 'custom-1234abcd')
  assert.equal(result.pageUrl, 'https://github.com/anthropics/skills')
})

test('the service searches and resolves detail from a custom index source', async () => {
  const { home, cleanup } = await tempHome()
  try {
    const service = createSkillsMarket({ dshHome: home, fetchImpl: indexFetch })
    const added = await service.addSource({ kind: 'index', title: 'Team Skills', url: 'https://example.test/index.json' })
    const id = added.source.id
    const result = await service.search('design', id)
    assert.equal(result.source.title, 'Team Skills')
    assert.equal(result.skills[0].name, 'frontend-design')
    assert.equal(result.skills[0].pageUrl, 'https://github.com/anthropics/skills')
    const detail = await service.detail('anthropics/skills', 'frontend-design', id)
    assert.match(detail.description, /Design guidance/u)
    const health = await service.health()
    assert.equal(health.sources.count, 2)
  } finally { await cleanup() }
})

test('a custom skills-sh base is used for search and detail page URLs', async () => {
  const { home, cleanup } = await tempHome()
  try {
    const calls = []
    const fetchImpl = async url => {
      calls.push(String(url))
      return new Response(JSON.stringify({ skills: [{ id: 'acme/skills/demo', source: 'acme/skills', skillId: 'demo', name: 'demo', installs: 3 }] }), { status: 200 })
    }
    const service = createSkillsMarket({ dshHome: home, fetchImpl })
    const added = await service.addSource({ kind: 'skills-sh', title: 'Mirror', url: 'https://mirror.test/' })
    const result = await service.search('demo', added.source.id)
    assert.equal(result.skills[0].pageUrl, 'https://mirror.test/acme/skills/demo')
    assert.ok(calls.some(url => url.startsWith('https://mirror.test/api/search')))
  } finally { await cleanup() }
})

test('sanitizeSourceStore keeps the builtin and drops malformed customs', () => {
  const sanitized = sanitizeSourceStore({
    version: 1,
    selected: 'missing',
    sources: [
      { id: 'skills-sh', kind: 'skills-sh', title: 'fake', url: 'https://fake.test', builtin: true },
      { id: 'custom-00000000', kind: 'index', title: 'Bad URL', url: 'not-a-url' },
      { id: 'custom-11111111', kind: 'index', title: 'Good', url: 'https://good.test/index.json' },
    ],
  })
  assert.equal(sanitized.selected, 'skills-sh')
  assert.deepEqual(sanitized.sources.map(source => source.id), ['skills-sh', 'custom-11111111'])
})
