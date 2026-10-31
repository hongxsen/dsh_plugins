import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_VALUE_BYTES,
  buildChoice,
  buildPackageCommand,
  environmentFields,
  headerFields,
  isConcreteVersion,
  isSecretName,
  normalizeValues,
  previewServer,
  redactConfig,
  resolveTemplate,
} from '../lib/config.js'
import { createRegistryClient, normalizeServer, normalizeServerList } from '../lib/registry.js'
import { isRegistryName, isRowId, isServerName, rowIdFor, serverNameFor } from '../lib/slug.js'

/** A realistic normalized entry with one remote and one npm package. */
function sampleEntry(overrides = {}) {
  return normalizeServer({
    server: {
      name: 'io.github.example/weather',
      description: 'Weather tools',
      version: '1.2.3',
      repository: { url: 'https://github.com/example/weather', source: 'github' },
      websiteUrl: 'https://example.com',
      remotes: [
        {
          type: 'sse',
          url: 'https://example.com/sse',
        },
        {
          type: 'streamable-http',
          url: 'https://example.com/mcp',
          headers: [
            { name: 'Authorization', description: 'Bearer token', isRequired: true, isSecret: true, value: 'Bearer {api_key}' },
            { name: 'X-Literal', value: 'fixed' },
          ],
        },
      ],
      packages: [
        {
          registryType: 'npm',
          identifier: '@example/weather-mcp',
          version: '1.2.3',
          transport: { type: 'stdio' },
          runtimeArguments: [{ type: 'positional', value: '-y' }],
          packageArguments: [
            { type: 'named', name: 'region', value: 'eu' },
            { type: 'named', name: '--region', value: 'duplicate' },
          ],
          environmentVariables: [
            { name: 'WEATHER_TOKEN', isRequired: true, isSecret: true },
            { name: 'WEATHER_UNITS', default: 'metric' },
            { name: 'WEATHER_OPTIONAL' },
          ],
        },
        {
          registryType: 'mcpb',
          identifier: 'ignored',
          transport: { type: 'stdio' },
        },
        {
          registryType: 'npm',
          identifier: 'http-only',
          version: '1.0.0',
          transport: { type: 'sse', url: 'http://127.0.0.1:8080/sse' },
        },
      ],
    },
    _meta: {
      'io.modelcontextprotocol.registry/official': {
        isLatest: true,
        updatedAt: '2026-01-02T03:04:05Z',
      },
    },
    ...overrides,
  })
}

test('server names and row ids are stable, bounded, and valid', () => {
  const name = 'io.github.example/weather'
  assert.equal(serverNameFor(name), serverNameFor(name))
  assert.match(serverNameFor(name), /^[A-Za-z0-9_-]{1,32}$/u)
  assert.equal(rowIdFor(name), `mcp-market-${serverNameFor(name)}`)
  assert.equal(isRowId(rowIdFor(name)), true)
  assert.equal(isServerName(serverNameFor(name)), true)
  assert.equal(isRowId('mcp-market-bad id'), false)
  assert.notEqual(serverNameFor('io.github.example/weather'), serverNameFor('io.github.example/weather2'))
  const long = serverNameFor(`io.github.example/${'a'.repeat(80)}`)
  assert.equal(long.length, 32)
  assert.match(long, /^[A-Za-z0-9_-]{1,32}$/u)
  assert.equal(isRegistryName('io.github.example/weather'), true)
  assert.equal(isRegistryName('no-slash'), false)
})

test('registry normalization keeps supported remotes and packages', () => {
  const entry = sampleEntry()
  assert.equal(entry.title, 'weather')
  assert.equal(entry.version, '1.2.3')
  assert.equal(entry.repository, 'https://github.com/example/weather')
  assert.equal(entry.remotes.length, 1)
  assert.equal(entry.remotes[0].type, 'streamable-http')
  assert.equal(entry.remotes[0].headers.length, 2)
  assert.equal(entry.packages.length, 2)
  assert.deepEqual(entry.packages.map(pkg => pkg.registryType), ['npm', 'npm'])
  assert.equal(entry.updatedAt, '2026-01-02T03:04:05Z')
  assert.equal(entry.isLatest, true)
  assert.deepEqual(normalizeServerList({ servers: [{ server: { name: 'bad' } }, { server: entry }] }).length, 1)
  assert.equal(normalizeServer({ server: { name: 'bad name' } }), null)
})

test('normalization falls back to the last name segment and drops unsafe URLs', () => {
  const entry = normalizeServer({
    server: {
      name: 'io.github.example/x',
      description: 'x',
      version: '1',
      remotes: [{ type: 'streamable-http', url: 'ftp://example.com/mcp' }],
      packages: [{ registryType: 'pypi', identifier: 'x', version: '1', transport: { type: 'stdio' } }],
    },
  })
  assert.equal(entry.title, 'x')
  assert.equal(entry.remotes.length, 0)
  assert.equal(entry.packages.length, 1)
  assert.equal(entry.repository, null)
  assert.equal(entry.websiteUrl, null)
})

test('values are validated before they reach a profile', () => {
  assert.deepEqual(normalizeValues(), { headers: {}, env: {} })
  assert.throws(() => normalizeValues({ headers: { Authorization: 42 } }), error => error.code === 'mcp/invalid-value')
  assert.throws(() => normalizeValues({ headers: { Authorization: 'a\nb' } }), error => error.code === 'mcp/invalid-value')
  assert.throws(() => normalizeValues({ headers: { Authorization: 'a'.repeat(MAX_VALUE_BYTES + 1) } }), error => error.code === 'mcp/invalid-value')
  assert.throws(() => normalizeValues({ headers: JSON.parse('{"__proto__":"x"}') }), error => error.code === 'mcp/invalid-value')
  assert.deepEqual(normalizeValues({ env: { PRIVATE_KEY: 'line1\nline2' } }).env.PRIVATE_KEY, 'line1\nline2')
})

test('remote headers resolve placeholders, literals, and required inputs', () => {
  const entry = sampleEntry()
  const remote = entry.remotes[0]
  assert.deepEqual(headerFields(remote), [
    { name: 'Authorization', description: 'Bearer token', required: true, secret: true },
  ])
  const built = buildChoice(entry, { kind: 'remote', index: 0 }, normalizeValues({
    headers: { Authorization: 'secret-token' },
  }))
  assert.deepEqual(built.config, {
    serverName: serverNameFor(entry.name),
    transport: 'streamable-http',
    url: 'https://example.com/mcp',
    headers: { Authorization: 'Bearer secret-token', 'X-Literal': 'fixed' },
  })
  assert.deepEqual(built.secretKeys, ['Authorization'])
  assert.deepEqual(built.warnings, ['secret-in-profile'])
  assert.throws(
    () => buildChoice(entry, { kind: 'remote', index: 0 }, normalizeValues({})),
    error => error.code === 'mcp/needs-input' && error.details.missing[0].name === 'Authorization',
  )
})

test('remote URL templates use declared defaults and report missing variables', () => {
  const resolved = resolveTemplate('https://example.com/{tenant}/mcp', {
    tenant: { default: 'acme' },
  })
  assert.deepEqual(resolved, { value: 'https://example.com/acme/mcp', unresolved: [] })
  const missing = resolveTemplate('https://example.com/{tenant}/mcp', {})
  assert.deepEqual(missing, { value: 'https://example.com/{tenant}/mcp', unresolved: ['tenant'] })
  const entry = sampleEntry()
  entry.remotes[0].url = 'https://example.com/{tenant}/mcp'
  assert.throws(
    () => buildChoice(entry, { kind: 'remote', index: 0 }, normalizeValues({ headers: { Authorization: 'x' } })),
    error => error.code === 'mcp/needs-input' && error.details.missing[0].kind === 'url',
  )
})

test('package args pin versions, add runtime defaults, and avoid duplicate flags', () => {
  const entry = sampleEntry()
  const pkg = entry.packages[0]
  const built = buildPackageCommand(pkg)
  assert.equal(built.command, 'npx')
  assert.deepEqual(built.args, ['-y', '@example/weather-mcp@1.2.3', '--region', 'eu'])
  const configured = buildChoice(entry, { kind: 'package', index: 0 }, normalizeValues({
    env: { WEATHER_TOKEN: 'token-value' },
  }))
  assert.deepEqual(configured.config, {
    serverName: serverNameFor(entry.name),
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@example/weather-mcp@1.2.3', '--region', 'eu'],
    env: { WEATHER_TOKEN: 'token-value', WEATHER_UNITS: 'metric' },
  })
  assert.deepEqual(environmentFields(pkg).map(field => field.name), ['WEATHER_TOKEN', 'WEATHER_UNITS', 'WEATHER_OPTIONAL'])
  assert.throws(
    () => buildChoice(entry, { kind: 'package', index: 0 }, normalizeValues({})),
    error => error.code === 'mcp/needs-input' && error.details.missing[0].name === 'WEATHER_TOKEN',
  )
})

test('pypi and oci targets and concrete version checks compose', () => {
  const base = { runtimeArguments: [], packageArguments: [] }
  const pypi = buildPackageCommand({ ...base, registryType: 'pypi', identifier: 'weather-mcp', version: '2.0.0', transport: { type: 'stdio' } })
  assert.deepEqual(pypi.args, ['weather-mcp==2.0.0'])
  const oci = buildPackageCommand({ ...base, registryType: 'oci', identifier: 'ghcr.io/example/weather:3.1.0', version: '3.1.0', transport: { type: 'stdio' } })
  assert.deepEqual(oci.args, ['run', '-i', '--rm', 'ghcr.io/example/weather:3.1.0'])
  assert.equal(isConcreteVersion('1.2.3'), true)
  assert.equal(isConcreteVersion('1.2.3-alpha.1'), true)
  assert.equal(isConcreteVersion('latest'), false)
  assert.equal(isConcreteVersion('^1.2.3'), false)
  assert.equal(isConcreteVersion('1.x'), false)
})

test('secret detection and redaction never expose credential values', () => {
  assert.equal(isSecretName('Authorization'), true)
  assert.equal(isSecretName('GITHUB_TOKEN'), true)
  assert.equal(isSecretName('PRIVATE_KEY'), true)
  assert.equal(isSecretName('WEATHER_UNITS'), false)
  assert.equal(isSecretName('MONKEY'), false)
  const redacted = redactConfig({
    serverName: 'x',
    transport: 'streamable-http',
    headers: { Authorization: 'Bearer abc', 'X-Literal': 'fixed' },
    env: { WEATHER_TOKEN: 'secret', WEATHER_UNITS: 'metric' },
  }, ['Authorization'])
  assert.equal(redacted.headers.Authorization, '••••••')
  assert.equal(redacted.headers['X-Literal'], 'fixed')
  assert.equal(redacted.env.WEATHER_TOKEN, '••••••')
  assert.equal(redacted.env.WEATHER_UNITS, 'metric')
})

test('preview picks a remote, exposes redacted config, and lists choices', () => {
  const entry = sampleEntry()
  const preview = previewServer(entry, { npx: true }, false)
  assert.equal(preview.kind, 'remote')
  assert.equal(preview.index, 0)
  assert.equal(preview.transport, 'streamable-http')
  assert.equal(preview.headers.length, 1)
  assert.equal(preview.config.headers.Authorization, '••••••')
  assert.equal(preview.choices.length, 2)
  assert.equal(preview.choices[1].kind, 'package')
  assert.deepEqual(preview.choices[1].blocked, [])
  assert.equal(preview.existing, false)
  const unsupported = previewServer(normalizeServer({
    server: { name: 'io.github.example/sse-only', description: 'x', version: '1', remotes: [{ type: 'sse', url: 'https://x.example/sse' }] },
  }), {}, false)
  assert.equal(unsupported.kind, null)
  assert.deepEqual(unsupported.warnings, ['unsupported'])
})

/** Build a fake fetch response. */
function response(status, payload, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: name => headers[name] ?? null },
    async text() {
      return typeof payload === 'string' ? payload : JSON.stringify(payload)
    },
  }
}

test('registry search omits an empty search, caches, and exposes nextCursor', async () => {
  const calls = []
  let clock = 1_000
  const server = {
    server: { name: 'io.github.example/weather', description: 'x', version: '1' },
    _meta: { 'io.modelcontextprotocol.registry/official': { isLatest: true } },
  }
  const client = createRegistryClient({
    fetchImpl: async url => {
      calls.push(String(url))
      return response(200, { servers: [server], metadata: { nextCursor: 'cursor-1' } })
    },
    now: () => clock,
    ttlMs: 1_000,
  })
  const first = await client.search('')
  assert.equal(first.cached, false)
  assert.equal(first.servers.length, 1)
  assert.equal(first.nextCursor, 'cursor-1')
  assert.match(calls[0], /\/v0\/servers\?limit=24&version=latest$/u)
  const second = await client.search('')
  assert.equal(second.cached, true)
  assert.equal(calls.length, 1)
  clock += 1_001
  await client.search('')
  assert.equal(calls.length, 2)
  const page = await client.search('weather', { cursor: 'abc' })
  assert.equal(page.cached, false)
  assert.match(calls[2], /search=weather/u)
  assert.match(calls[2], /cursor=abc/u)
})

test('registry detail falls back to an exact-name search', async () => {
  const entry = {
    server: { name: 'io.github.example/weather', description: 'x', version: '1' },
    _meta: { 'io.modelcontextprotocol.registry/official': { isLatest: true } },
  }
  const calls = []
  const client = createRegistryClient({
    fetchImpl: async url => {
      calls.push(String(url))
      if (String(url).includes('/v0/servers/')) return response(404, { detail: 'not found' })
      return response(200, { servers: [entry], metadata: {} })
    },
  })
  const detail = await client.getServer('io.github.example/weather')
  assert.equal(detail.name, 'io.github.example/weather')
  assert.equal(calls.length, 2)
  assert.match(calls[0], /io\.github\.example%2Fweather/u)
  assert.match(calls[1], /search=io\.github\.example%2Fweather/u)
  assert.equal((await client.getServer('io.github.example/weather')).name, detail.name)
  assert.equal(calls.length, 2)
})

test('registry failures are bounded to fetch-failed, timeout, and rate limit codes', async () => {
  const offline = createRegistryClient({ fetchImpl: async () => { throw new TypeError('offline') } })
  await assert.rejects(() => offline.search(''), error => error.code === 'mcp/fetch-failed' && error.status === 502)
  const timeout = createRegistryClient({ fetchImpl: async () => { const error = new Error('aborted'); error.name = 'AbortError'; throw error } })
  await assert.rejects(() => timeout.search(''), error => error.code === 'mcp/fetch-failed' && error.status === 504)
  const limited = createRegistryClient({ fetchImpl: async () => response(429, {}, { 'retry-after': '60' }) })
  await assert.rejects(() => limited.search(''), error => error.code === 'mcp/fetch-failed' && error.status === 429 && error.details.reason === 'rate-limit')
  const broken = createRegistryClient({ fetchImpl: async () => response(200, 'not json') })
  await assert.rejects(() => broken.search(''), error => error.code === 'mcp/fetch-failed')
})
