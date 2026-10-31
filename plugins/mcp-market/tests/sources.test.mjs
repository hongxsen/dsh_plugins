import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSourceStore, normalizeSourcesDocument, builtinSourceDoc, normalizeSourceUrl } from '../lib/sources.js'
import { parseIndexDocument, searchIndexServers, findIndexServer, fetchIndexDocument } from '../lib/index-source.js'
import { createMarketService } from '../lib/service.js'

const INDEX = JSON.stringify({
  format: 1,
  title: 'Team MCP',
  servers: [
    {
      name: 'com.example/weather',
      title: 'Example Weather',
      description: 'Private weather tools',
      version: '1.0.0',
      remotes: [{ type: 'streamable-http', url: 'https://mcp.example.test/mcp' }],
      packages: [],
    },
    { server: {
      name: 'com.example/echo',
      title: 'Echo',
      description: 'Echo tools',
      version: '1.0.0',
      remotes: [{ type: 'streamable-http', url: 'https://echo.example.test/mcp' }],
    } },
    { name: 'com.example/sse', remotes: [{ type: 'sse', url: 'https://sse.example.test/sse' }] },
  ],
})

async function tempEnv() {
  const root = await mkdtemp(join(tmpdir(), 'mcp-sources-'))
  const home = join(root, '.dsh')
  const profile = join(root, 'profile')
  await mkdir(home, { recursive: true })
  await mkdir(profile, { recursive: true })
  const patchPath = join(profile, 'cordis.patch.yml')
  await writeFile(patchPath, '# profile\n[]\n')
  return { root, home, profile, patchPath, cleanup: () => rm(root, { recursive: true, force: true }) }
}

const fetchIndex = async url => {
  if (String(url).endsWith('/mcp-index.json')) {
    return new Response(INDEX, { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return new Response('not found', { status: 404 })
}

test('the source store starts builtin, persists a custom source, and falls back on removal', async () => {
  const { home, cleanup } = await tempEnv()
  try {
    const dir = join(home, 'storages', 'dsh-mcp-market')
    const store = createSourceStore({ dir, fetchImpl: fetchIndex })
    assert.deepEqual((await store.ensure()).sources.map(source => source.id), ['mcp-registry'])
    const added = await store.add({ kind: 'index', title: 'Team MCP', url: 'https://example.test/mcp-index.json' })
    assert.match(added.source.id, /^custom-[0-9a-f]{8}$/u)
    await store.select(added.source.id)
    assert.equal((await store.read()).selected, added.source.id)
    const second = createSourceStore({ dir, fetchImpl: fetchIndex })
    assert.equal((await second.read()).selected, added.source.id)
    await store.remove(added.source.id)
    assert.equal((await store.read()).selected, 'mcp-registry')
  } finally { await cleanup() }
})

test('source validation rejects malformed values and the builtin', async () => {
  const { home, cleanup } = await tempEnv()
  try {
    const store = createSourceStore({ dir: join(home, 'storages', 'dsh-mcp-market'), fetchImpl: fetchIndex })
    await assert.rejects(store.add({ kind: 'nope', title: 'x', url: 'https://x.test' }), error => error.code === 'sources/invalid')
    await assert.rejects(store.add({ kind: 'index', title: '', url: 'https://x.test' }), error => error.code === 'sources/invalid')
    await assert.rejects(store.add({ kind: 'index', title: 'x', url: 'https://u:p@x.test' }), error => error.code === 'sources/invalid')
    await assert.rejects(store.remove('mcp-registry'), error => error.code === 'sources/builtin')
    assert.equal(builtinSourceDoc().sources[0].builtin, true)
    assert.equal(normalizeSourcesDocument({ version: 1, selected: 'missing', sources: [] }).selected, 'mcp-registry')
  } finally { await cleanup() }
})

test('an invalid MCP index is rejected before persistence', async () => {
  const { home, cleanup } = await tempEnv()
  try {
    const store = createSourceStore({
      dir: join(home, 'storages', 'dsh-mcp-market'),
      fetchImpl: async () => new Response(JSON.stringify({ format: 1 }), { status: 200 }),
    })
    await assert.rejects(store.add({ kind: 'index', title: 'bad', url: 'https://x.test/mcp-index.json' }), error => error.code === 'sources/invalid-index')
    assert.equal((await store.read()).sources.length, 1)
  } finally { await cleanup() }
})

test('index parsing unwraps registry entries, drops SSE-only entries, and searches', () => {
  const document = parseIndexDocument(JSON.parse(INDEX))
  assert.deepEqual(document.servers.map(server => server.name), ['com.example/weather', 'com.example/echo', 'com.example/sse'])
  assert.equal(document.servers[2].remotes.length, 0)
  assert.equal(searchIndexServers(document, 'weather', { id: 'custom-1234abcd' })[0].market, 'custom-1234abcd')
  assert.equal(findIndexServer(document, 'com.example/echo').title, 'Echo')
  assert.equal(findIndexServer(document, 'missing'), null)
})

test('the service installs a server resolved from a custom index source', async () => {
  const { home, profile, patchPath, cleanup } = await tempEnv()
  try {
    const service = createMarketService({
      dshHome: home,
      patchPath,
      profileContext: { dir: profile, patchPath, home, name: 'desktop' },
      profileName: 'desktop',
      fetchImpl: fetchIndex,
      commandCheck: () => true,
    })
    const added = await service.sourceAction({ action: 'add', kind: 'index', title: 'Team MCP', url: 'https://example.test/mcp-index.json' })
    const id = added.source.id
    await service.sourceAction({ action: 'select', id })
    const result = await service.search('weather', undefined, id)
    assert.equal(result.source.title, 'Team MCP')
    assert.equal(result.servers[0].name, 'com.example/weather')
    const preview = await service.preview('com.example/weather', id)
    assert.equal(preview.kind, 'remote')
    await service.install({
      registryName: 'com.example/weather',
      source: id,
      choice: { kind: 'remote', index: 0 },
      values: {},
    })
    const installed = await service.installed()
    assert.equal(installed.servers[0].sourceId, id)
    assert.equal(installed.servers[0].sourceTitle, 'Team MCP')
    const patch = await readFile(patchPath, 'utf8')
    assert.match(patch, /mcp-market-weather/u)
    assert.match(patch, /https:\/\/mcp\.example\.test\/mcp/u)
    await service.remove({ rowId: installed.servers[0].rowId })
    assert.doesNotMatch(await readFile(patchPath, 'utf8'), /mcp-market-weather/u)
  } finally { await cleanup() }
})

test('a custom mcp-registry base is used for search', async () => {
  const { home, profile, patchPath, cleanup } = await tempEnv()
  try {
    const calls = []
    const fetchImpl = async url => {
      calls.push(String(url))
      return new Response(JSON.stringify({
        servers: [{ server: {
          name: 'acme/echo',
          title: 'Echo',
          description: 'Echo',
          version: '1.0.0',
          remotes: [{ type: 'streamable-http', url: 'https://echo.example.test/mcp' }],
        } }],
      }), { status: 200 })
    }
    const service = createMarketService({
      dshHome: home,
      patchPath,
      profileContext: { dir: profile, patchPath, home, name: 'desktop' },
      profileName: 'desktop',
      fetchImpl,
      commandCheck: () => true,
    })
    const added = await service.sourceAction({ action: 'add', kind: 'mcp-registry', title: 'Mirror', url: 'https://mirror.test/' })
    const result = await service.search('echo', undefined, added.source.id)
    assert.equal(result.servers[0].name, 'acme/echo')
    assert.ok(calls.some(url => url.startsWith('https://mirror.test/v0/servers')))
  } finally { await cleanup() }
})

test('a JSON index can be a local file path', async () => {
  const { home, cleanup } = await tempEnv()
  try {
    const indexPath = join(home, 'mcp-index.json')
    await writeFile(indexPath, INDEX)
    assert.match(normalizeSourceUrl(indexPath, 'index'), /^file:/u)
    assert.throws(() => normalizeSourceUrl(indexPath, 'mcp-registry'), error => error.code === 'sources/invalid')
    const doc = await fetchIndexDocument(normalizeSourceUrl(indexPath, 'index'))
    assert.equal(doc.servers[0].name, 'com.example/weather')
    const store = createSourceStore({
      dir: join(home, 'storages', 'dsh-mcp-market'),
      fetchImpl: async () => { throw new Error('network must not be used') },
    })
    const added = await store.add({ kind: 'index', title: 'Local MCP', url: indexPath })
    assert.match(added.source.url, /^file:/u)
    const fetched = await fetchIndexDocument(added.source.url)
    assert.equal(fetched.servers[0].name, 'com.example/weather')
  } finally { await cleanup() }
})
