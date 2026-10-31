import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMarketService } from '../lib/service.js'
import { normalizeServer } from '../lib/registry.js'
import { MANAGED_START } from '../lib/yaml.js'
import { rowIdFor, serverNameFor } from '../lib/slug.js'

const registryName = 'io.github.example/weather'

/** A normalized registry entry used by the service tests. */
function entry() {
  return normalizeServer({
    server: {
      name: registryName,
      description: 'Weather tools',
      version: '1.2.3',
      remotes: [{
        type: 'streamable-http',
        url: 'https://example.com/mcp',
        headers: [{
          name: 'Authorization',
          description: 'Bearer token',
          isRequired: true,
          isSecret: true,
          value: 'Bearer {api_key}',
        }],
      }],
      packages: [{
        registryType: 'npm',
        identifier: '@example/weather-mcp',
        version: '1.2.3',
        transport: { type: 'stdio' },
        environmentVariables: [{ name: 'WEATHER_TOKEN', isRequired: true, isSecret: true }],
      }],
    },
    _meta: { 'io.modelcontextprotocol.registry/official': { isLatest: true } },
  })
}

/** Create a service plus its temporary profile layout. */
async function fixture({ commandCheck = () => true, tools = [] } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dshmcp-service-'))
  const home = join(root, 'home')
  const profileDir = join(home, 'profiles', 'desktop')
  await mkdir(profileDir, { recursive: true })
  const patchPath = join(profileDir, 'cordis.patch.yml')
  await writeFile(patchPath, '# profile\n- insert:\n    - id: mcp-external\n      name: \'@deepseek-ai/dsh-mcp-client\'\n      config:\n        serverName: external\n        transport: stdio\n        command: npx\n')
  const context = {
    get(name) {
      if (name === 'tools') return { schemas: () => tools }
      if (name === 'hmr') return {}
      return undefined
    },
  }
  const service = createMarketService({
    ctx: context,
    registry: {
      search: async (query, options) => ({ query, servers: [entry()], cached: false, nextCursor: null, options }),
      getServer: async name => {
        if (name !== registryName) {
          const error = new Error('not found')
          error.code = 'mcp/not-found'
          throw error
        }
        return entry()
      },
    },
    patchPath,
    dshHome: home,
    profileContext: { name: 'desktop', dir: profileDir, home },
    commandCheck,
    now: () => Date.parse('2026-02-03T04:05:06.000Z'),
    env: {},
  })
  return { root, home, profileDir, patchPath, service }
}

test('preview and install write a managed block without leaking secrets', async () => {
  const serverName = serverNameFor(registryName)
  const { root, patchPath, service } = await fixture({
    tools: [{ name: `mcp__${serverName}__forecast` }, { name: 'other' }],
  })
  try {
    const preview = await service.preview(registryName)
    assert.equal(preview.existing, false)
    assert.equal(preview.kind, 'remote')
    assert.equal(preview.serverName, rowIdFor(registryName).slice('mcp-market-'.length))
    assert.equal(preview.patchPath.startsWith('~/.dsh/'), true)
    assert.equal(preview.config.headers.Authorization, '••••••')

    const result = await service.install({
      registryName,
      choice: { kind: 'remote', index: 0 },
      values: { headers: { Authorization: 'super-secret-token' } },
    })
    assert.deepEqual(result, { installed: true, applied: true, restartRequired: false })

    const patch = await readFile(patchPath, 'utf8')
    assert.ok(patch.includes(MANAGED_START))
    assert.ok(patch.includes('Bearer super-secret-token'))
    assert.ok(patch.includes('id: mcp-external'))

    const installed = await service.installed()
    assert.equal(installed.servers.length, 1)
    assert.equal(installed.servers[0].toolCount, 1)
    assert.deepEqual(installed.servers[0].headers, [{ name: 'Authorization' }])
    assert.equal(JSON.stringify(installed).includes('super-secret-token'), false)
    assert.equal(installed.external.length, 1)
    assert.equal(installed.external[0].rowId, 'mcp-external')
    assert.equal(installed.hmr, true)
    assert.equal(installed.profileName, 'desktop')
    assert.equal(installed.patchPath.startsWith('~/.dsh/'), true)
    assert.deepEqual(installed.runtimes, { npx: true, uvx: true, docker: true })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('duplicate installs are refused unless replace is requested', async () => {
  const { root, patchPath, service } = await fixture()
  try {
    const body = {
      registryName,
      choice: { kind: 'remote', index: 0 },
      values: { headers: { Authorization: 'token-one' } },
    }
    await service.install(body)
    await assert.rejects(() => service.install(body), error => error.code === 'mcp/already-installed')
    await service.install({ ...body, replace: true, values: { headers: { Authorization: 'token-two' } } })
    const patch = await readFile(patchPath, 'utf8')
    assert.equal((await service.installed()).servers.length, 1)
    assert.ok(patch.includes('Bearer token-two'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('toggle and remove rewrite only the managed block', async () => {
  const { root, patchPath, service } = await fixture()
  try {
    await service.install({
      registryName,
      choice: { kind: 'remote', index: 0 },
      values: { headers: { Authorization: 'token' } },
    })
    const rowId = rowIdFor(registryName)
    const off = await service.toggle({ rowId, enabled: false })
    assert.deepEqual(off, { applied: true, restartRequired: false })
    const afterOff = await readFile(patchPath, 'utf8')
    assert.equal(afterOff.includes(MANAGED_START), false)
    assert.ok(afterOff.includes('id: mcp-external'))
    assert.equal((await service.installed()).servers[0].enabled, false)

    await service.toggle({ rowId, enabled: true })
    assert.ok((await readFile(patchPath, 'utf8')).includes(MANAGED_START))

    const removed = await service.remove({ rowId })
    assert.deepEqual(removed, { removed: true, applied: true, restartRequired: false })
    const afterRemove = await readFile(patchPath, 'utf8')
    assert.equal(afterRemove.includes(MANAGED_START), false)
    assert.ok(afterRemove.includes('id: mcp-external'))
    assert.deepEqual((await service.installed()).servers, [])
    await assert.rejects(() => service.remove({ rowId }), error => error.code === 'mcp/not-managed')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a missing package runtime blocks the install but still previews', async () => {
  const { root, service } = await fixture({ commandCheck: () => false })
  try {
    const preview = await service.preview(registryName)
    const packageChoice = preview.choices.find(choice => choice.kind === 'package')
    assert.equal(packageChoice.available, false)
    assert.ok(packageChoice.warnings.includes('runtime-missing'))
    await assert.rejects(
      () => service.install({
        registryName,
        choice: { kind: 'package', index: 0 },
        values: { env: { WEATHER_TOKEN: 'token' } },
      }),
      error => error.code === 'mcp/runtime-missing',
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('health reports the profile, patch display, and HMR state', async () => {
  const { root, service } = await fixture()
  try {
    const health = await service.health()
    assert.equal(health.ok, true)
    assert.equal(health.profile, 'desktop')
    assert.equal(health.hmr, true)
    assert.equal(health.patchPath.startsWith('~/.dsh/'), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
