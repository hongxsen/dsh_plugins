import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { MarketError } from '../lib/errors.js'
import { createRouteHandler, handleRequest, isJsonContentType, sameOrigin } from '../lib/routes.js'

function createRequest({ method = 'GET', url, headers = {}, body } = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(body)]
  const req = Readable.from(chunks)
  req.method = method
  req.url = url ?? '/dsh-skills-market/api/health'
  req.headers = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]))
  return req
}

function createResponse() {
  const headers = {}
  return {
    statusCode: 0,
    headersSent: false,
    writableEnded: false,
    body: '',
    headers,
    setHeader(name, value) { headers[name.toLowerCase()] = value },
    end(body) {
      this.body = body
      this.writableEnded = true
    },
    json() { return JSON.parse(this.body) },
  }
}

function createService(overrides = {}) {
  const calls = []
  const service = {
    calls,
    async search(query) {
      calls.push(['search', query])
      return { seed: true, query, skills: [], cached: false }
    },
    async detail(source, skillId) {
      calls.push(['detail', source, skillId])
      return { description: '', pageUrl: `https://www.skills.sh/${source}/${skillId}` }
    },
    async preview(source, skillId) {
      calls.push(['preview', source, skillId])
      return { token: 'token', name: 'demo' }
    },
    async install(input) {
      calls.push(['install', input])
      return { installed: true, name: 'demo' }
    },
    async installed() {
      calls.push(['installed'])
      return { skills: [] }
    },
    async remove(name) {
      calls.push(['remove', name])
      return { removed: true }
    },
    health() {
      calls.push(['health'])
      return { ok: true, root: '~/.dsh/skills', version: '0.1.0' }
    },
    ...overrides,
  }
  return service
}

async function call(service, options) {
  const req = createRequest(options)
  const res = createResponse()
  await handleRequest(req, res, service)
  return res
}

test('sameOrigin compares hosts and tolerates a missing Origin', () => {
  assert.equal(sameOrigin(undefined, '127.0.0.1:56668'), true)
  assert.equal(sameOrigin('http://127.0.0.1:56668', '127.0.0.1:56668'), true)
  assert.equal(sameOrigin('https://localhost:56668', 'localhost:56668'), true)
  assert.equal(sameOrigin('http://localhost:1234', 'localhost:56668'), false)
  assert.equal(sameOrigin('null', 'localhost:56668'), false)
  assert.equal(sameOrigin('http://evil.test', ''), false)
})

test('isJsonContentType accepts application/json with parameters only', () => {
  assert.equal(isJsonContentType('application/json'), true)
  assert.equal(isJsonContentType('application/json; charset=utf-8'), true)
  assert.equal(isJsonContentType('APPLICATION/JSON'), true)
  assert.equal(isJsonContentType('text/plain'), false)
  assert.equal(isJsonContentType(undefined), false)
})

test('GET /api/health returns the version with no-store headers', async () => {
  const res = await call(createService(), {})
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.json(), { ok: true, root: '~/.dsh/skills', version: '0.1.0' })
  assert.equal(res.headers['cache-control'], 'no-store')
  assert.match(res.headers['content-type'], /application\/json/u)
})

test('GET /api/search passes the query through', async () => {
  const service = createService()
  const res = await call(service, { url: '/dsh-skills-market/api/search?q=design' })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(service.calls, [['search', 'design']])
  assert.equal(res.json().seed, true)
})

test('the handler also accepts a prefix-stripped path', async () => {
  const res = await call(createService(), { url: '/api/health' })
  assert.equal(res.statusCode, 200)
})

test('cross-origin requests are refused with 403', async () => {
  const res = await call(createService(), {
    url: '/dsh-skills-market/api/health',
    headers: { host: '127.0.0.1:56668', origin: 'http://evil.test' },
  })
  assert.equal(res.statusCode, 403)
  assert.equal(res.json().error.code, 'request/forbidden-origin')
})

test('unknown routes and methods return stable request codes', async () => {
  const missing = await call(createService(), { url: '/dsh-skills-market/api/nope' })
  assert.equal(missing.statusCode, 404)
  assert.equal(missing.json().error.code, 'request/not-found')

  const outside = await call(createService(), { url: '/other/api/health' })
  assert.equal(outside.statusCode, 404)

  const wrongMethod = await call(createService(), { method: 'POST', url: '/dsh-skills-market/api/search' })
  assert.equal(wrongMethod.statusCode, 405)
  assert.equal(wrongMethod.json().error.code, 'request/method-not-allowed')
  assert.equal(wrongMethod.headers.allow, 'GET')

  const getOnPost = await call(createService(), { method: 'GET', url: '/dsh-skills-market/api/install' })
  assert.equal(getOnPost.statusCode, 405)
  assert.equal(getOnPost.headers.allow, 'POST')
})

test('POST bodies require JSON and a valid object', async () => {
  const notJson = await call(createService(), {
    method: 'POST',
    url: '/dsh-skills-market/api/preview',
    headers: { 'content-type': 'text/plain' },
    body: '{"source":"a/b"}',
  })
  assert.equal(notJson.statusCode, 415)
  assert.equal(notJson.json().error.code, 'request/unsupported-media-type')

  const badJson = await call(createService(), {
    method: 'POST',
    url: '/dsh-skills-market/api/preview',
    headers: { 'content-type': 'application/json' },
    body: '{not json',
  })
  assert.equal(badJson.statusCode, 400)
  assert.equal(badJson.json().error.code, 'request/invalid-json')

  const arrayBody = await call(createService(), {
    method: 'POST',
    url: '/dsh-skills-market/api/preview',
    headers: { 'content-type': 'application/json' },
    body: '[]',
  })
  assert.equal(arrayBody.statusCode, 400)
  assert.equal(arrayBody.json().error.code, 'request/invalid-json')

  const emptyBody = await call(createService(), {
    method: 'POST',
    url: '/dsh-skills-market/api/install',
    headers: { 'content-type': 'application/json' },
  })
  assert.equal(emptyBody.statusCode, 400)
})

test('POST bodies over the cap are rejected with 413', async () => {
  const res = await call(createService(), {
    method: 'POST',
    url: '/dsh-skills-market/api/preview',
    headers: { 'content-type': 'application/json', 'content-length': String(1024 * 1024 + 1) },
  })
  assert.equal(res.statusCode, 413)
  assert.equal(res.json().error.code, 'request/body-too-large')
})

test('POST /api/install forwards token and replace', async () => {
  const service = createService()
  const res = await call(service, {
    method: 'POST',
    url: '/dsh-skills-market/api/install',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: 'abc', replace: true }),
  })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(service.calls, [['install', { token: 'abc', replace: true }]])
})

test('POST /api/remove forwards the name', async () => {
  const service = createService()
  const res = await call(service, {
    method: 'POST',
    url: '/dsh-skills-market/api/remove',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'demo' }),
  })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(service.calls, [['remove', 'demo']])
})

test('market errors map to their status and public code without stack traces', async () => {
  const service = createService({
    async preview() {
      throw new MarketError('skills/not-found', 'No such skill', { source: 'a/b' })
    },
  })
  const res = await call(service, {
    method: 'POST',
    url: '/dsh-skills-market/api/preview',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source: 'a/b', skillId: 'demo' }),
  })
  assert.equal(res.statusCode, 404)
  const payload = res.json()
  assert.deepEqual(payload, { error: { code: 'skills/not-found', message: 'No such skill', details: { source: 'a/b' } } })
  assert.equal(JSON.stringify(payload).includes('stack'), false)
})

test('unexpected errors become a generic 500 payload', async (t) => {
  const original = console.error
  console.error = () => {}
  t.after(() => { console.error = original })
  const res = await call(createService({
    async installed() { throw new Error('secret detail that must not leak') },
  }), { url: '/dsh-skills-market/api/installed' })
  assert.equal(res.statusCode, 500)
  assert.deepEqual(res.json(), { error: { code: 'internal/error', message: 'Unexpected error' } })
  assert.equal(res.body.includes('secret detail'), false)
})

test('createRouteHandler never rejects', async (t) => {
  const original = console.error
  console.error = () => {}
  t.after(() => { console.error = original })
  const req = createRequest({ url: '/dsh-skills-market/api/installed' })
  const res = createResponse()
  const handler = createRouteHandler({
    service: createService({ async installed() { throw new Error('boom') } }),
  })
  handler(req, res)
  await new Promise((resolve) => { setTimeout(resolve, 10) })
  assert.equal(res.statusCode, 500)
  assert.equal(res.json().error.code, 'internal/error')
})

test('source routes list, add, remove, and select through the service', async () => {
  const calls = []
  const service = createService({
    async sources() {
      calls.push(['sources'])
      return { version: 1, selected: 'skills-sh', sources: [{ id: 'skills-sh', kind: 'skills-sh', title: 'skills.sh', url: 'https://www.skills.sh', builtin: true }] }
    },
    async addSource(input) {
      calls.push(['add', input])
      return { selected: 'skills-sh', sources: [], source: { id: 'custom-00000000' } }
    },
    async removeSource(id) {
      calls.push(['remove', id])
      return { selected: 'skills-sh', sources: [] }
    },
    async selectSource(id) {
      calls.push(['select', id])
      return { selected: id, sources: [] }
    },
  })
  const headers = { 'content-type': 'application/json' }
  let response = await call(service, { url: '/dsh-skills-market/api/sources' })
  assert.equal(response.statusCode, 200)
  assert.equal(response.json().sources.length, 1)

  response = await call(service, {
    method: 'POST',
    url: '/dsh-skills-market/api/sources',
    headers,
    body: JSON.stringify({ action: 'add', kind: 'index', title: 'Team', url: 'https://example.test/index.json' }),
  })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(calls.at(-1), ['add', { kind: 'index', title: 'Team', url: 'https://example.test/index.json' }])

  response = await call(service, { method: 'POST', url: '/dsh-skills-market/api/sources', headers, body: JSON.stringify({ action: 'select', id: 'custom-00000000' }) })
  assert.equal(response.statusCode, 200)
  response = await call(service, { method: 'POST', url: '/dsh-skills-market/api/sources', headers, body: JSON.stringify({ action: 'remove', id: 'custom-00000000' }) })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(calls.slice(-2), [['select', 'custom-00000000'], ['remove', 'custom-00000000']])
})

test('search and detail pass the market source id', async () => {
  const calls = []
  const service = createService({
    async search(query, sourceId) {
      calls.push(['search', query, sourceId])
      return { seed: false, query, skills: [], cached: false }
    },
    async detail(repo, skillId, market) {
      calls.push(['detail', repo, skillId, market])
      return { description: '', pageUrl: 'https://example.test' }
    },
  })
  await call(service, { url: '/dsh-skills-market/api/search?q=pdf&source=custom-00000000' })
  await call(service, { url: '/dsh-skills-market/api/detail?market=custom-00000000&repo=acme/skills&skill=demo' })
  assert.deepEqual(calls, [
    ['search', 'pdf', 'custom-00000000'],
    ['detail', 'acme/skills', 'demo', 'custom-00000000'],
  ])
})
