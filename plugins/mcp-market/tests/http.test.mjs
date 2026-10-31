import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiError } from '../lib/errors.js'
import { createRequestHandler, originAllowed } from '../lib/http.js'

/** Minimal response recorder. */
function fakeResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    writableEnded: false,
    writeHead(status, headers) {
      this.statusCode = status
      this.headers = headers
    },
    end(body) {
      this.body = body ?? ''
      this.writableEnded = true
    },
  }
}

/** Minimal request with an optional JSON body. */
function fakeRequest({ method = 'GET', url = '/dsh-mcp-market/api/health', headers = {}, body = null } = {}) {
  const request = {
    method,
    url,
    headers: { host: '127.0.0.1:56668', ...headers },
  }
  request[Symbol.asyncIterator] = async function* requestBody() {
    if (body !== null) yield Buffer.from(body)
  }
  return request
}

/** A service stub that records calls. */
function stubService(overrides = {}) {
  const calls = []
  const service = {
    health: () => ({ ok: true, profile: 'desktop', patchPath: '~/.dsh/profiles/desktop/cordis.patch.yml', hmr: true }),
    search: async (query, cursor) => {
      calls.push(['search', query, cursor])
      return { query, servers: [], cached: false }
    },
    detail: async name => ({ name }),
    preview: async name => {
      calls.push(['preview', name])
      return { registryName: name }
    },
    install: async body => ({ installed: true, applied: true, restartRequired: false, echo: body }),
    toggle: async body => ({ applied: true, restartRequired: false, echo: body }),
    remove: async body => ({ removed: true, applied: false, restartRequired: true, echo: body }),
    installed: async () => ({ servers: [], external: [], hmr: true, patchPath: null, profileName: null, runtimes: {} }),
    ...overrides,
  }
  return { service, calls }
}

test('origin validation compares Origin host with Host', () => {
  assert.equal(originAllowed({ headers: { host: '127.0.0.1:1' } }), true)
  assert.equal(originAllowed({ headers: { host: '127.0.0.1:1', origin: 'http://127.0.0.1:1' } }), true)
  assert.equal(originAllowed({ headers: { host: '127.0.0.1:1', origin: 'http://evil.example' } }), false)
  assert.equal(originAllowed({ headers: { host: '127.0.0.1:1', origin: 'null' } }), false)
  assert.equal(originAllowed({ headers: { origin: 'http://127.0.0.1:1' } }), false)
})

test('health is JSON, no-store, and same-origin', async () => {
  const { service } = stubService()
  const handler = createRequestHandler({ service })
  const response = fakeResponse()
  await handler(fakeRequest(), response)
  assert.equal(response.statusCode, 200)
  assert.equal(response.headers['Cache-Control'], 'no-store')
  assert.match(response.headers['Content-Type'], /application\/json/u)
  assert.equal(JSON.parse(response.body).ok, true)
})

test('a cross-origin request is refused before dispatch', async () => {
  const { service, calls } = stubService()
  const handler = createRequestHandler({ service })
  const response = fakeResponse()
  await handler(fakeRequest({ headers: { origin: 'http://evil.example' } }), response)
  assert.equal(response.statusCode, 403)
  assert.equal(JSON.parse(response.body).error.code, 'request/forbidden-origin')
  assert.deepEqual(calls, [])
})

test('POST requires application/json', async () => {
  const { service } = stubService()
  const handler = createRequestHandler({ service })
  const response = fakeResponse()
  await handler(fakeRequest({
    method: 'POST',
    url: '/dsh-mcp-market/api/preview',
    headers: { 'content-type': 'text/plain' },
    body: '{}',
  }), response)
  assert.equal(response.statusCode, 415)
  assert.equal(JSON.parse(response.body).error.code, 'request/unsupported-media-type')
})

test('a known path with the wrong method returns 405 and Allow', async () => {
  const { service } = stubService()
  const handler = createRequestHandler({ service })
  const response = fakeResponse()
  await handler(fakeRequest({ method: 'GET', url: '/dsh-mcp-market/api/preview' }), response)
  assert.equal(response.statusCode, 405)
  assert.equal(response.headers.Allow, 'POST')
  assert.equal(JSON.parse(response.body).error.code, 'request/method-not-allowed')
})

test('preview passes the parsed body to the service', async () => {
  const { service, calls } = stubService()
  const handler = createRequestHandler({ service })
  const response = fakeResponse()
  await handler(fakeRequest({
    method: 'POST',
    url: '/dsh-mcp-market/api/preview',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ registryName: 'io.github.example/weather' }),
  }), response)
  assert.equal(response.statusCode, 200)
  assert.deepEqual(calls, [['preview', 'io.github.example/weather']])
  assert.equal(JSON.parse(response.body).registryName, 'io.github.example/weather')
})

test('domain failures keep their status and stable code', async () => {
  const { service } = stubService({
    preview: async () => {
      throw new ApiError('mcp/not-found', 'The requested MCP server was not found.', 404, { reason: 'missing' })
    },
  })
  const handler = createRequestHandler({ service })
  const response = fakeResponse()
  await handler(fakeRequest({
    method: 'POST',
    url: '/dsh-mcp-market/api/preview',
    headers: { 'content-type': 'application/json' },
    body: '{"registryName":"io.github.example/nope"}',
  }), response)
  assert.equal(response.statusCode, 404)
  assert.deepEqual(JSON.parse(response.body), {
    error: { code: 'mcp/not-found', message: 'The requested MCP server was not found.', details: { reason: 'missing' } },
  })
})

test('unknown paths, malformed JSON, and oversized bodies fail with request codes', async () => {
  const { service } = stubService()
  const handler = createRequestHandler({ service })
  const missing = fakeResponse()
  await handler(fakeRequest({ url: '/dsh-mcp-market/api/nope' }), missing)
  assert.equal(missing.statusCode, 404)
  assert.equal(JSON.parse(missing.body).error.code, 'request/not-found')

  const invalid = fakeResponse()
  await handler(fakeRequest({
    method: 'POST',
    url: '/dsh-mcp-market/api/preview',
    headers: { 'content-type': 'application/json' },
    body: '{oops',
  }), invalid)
  assert.equal(invalid.statusCode, 400)
  assert.equal(JSON.parse(invalid.body).error.code, 'request/invalid-json')

  const large = fakeResponse()
  await handler(fakeRequest({
    method: 'POST',
    url: '/dsh-mcp-market/api/preview',
    headers: { 'content-type': 'application/json', 'content-length': String(1024 * 1024 + 1) },
    body: '{}',
  }), large)
  assert.equal(large.statusCode, 413)
  assert.equal(JSON.parse(large.body).error.code, 'request/too-large')
})

test('search and detail unpack query parameters', async () => {
  const { service, calls } = stubService()
  const handler = createRequestHandler({ service })
  const searchResponse = fakeResponse()
  await handler(fakeRequest({ url: '/dsh-mcp-market/api/search?q=weather&cursor=abc' }), searchResponse)
  assert.deepEqual(calls, [['search', 'weather', 'abc']])

  const detailResponse = fakeResponse()
  await handler(fakeRequest({ url: '/dsh-mcp-market/api/detail' }), detailResponse)
  assert.equal(detailResponse.statusCode, 400)
  assert.equal(JSON.parse(detailResponse.body).error.code, 'mcp/invalid-entry')
})
