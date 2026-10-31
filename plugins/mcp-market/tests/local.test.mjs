import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMarketService } from '../lib/service.js'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dshmcp-local-'))
  const home = join(root, 'home')
  const profileDir = join(home, 'profiles', 'desktop')
  await mkdir(profileDir, { recursive: true })
  const patchPath = join(profileDir, 'cordis.patch.yml')
  await writeFile(patchPath, '# profile\n')
  const service = createMarketService({
    patchPath,
    dshHome: home,
    profileContext: { name: 'desktop', dir: profileDir, home },
    commandCheck: () => false,
    now: () => Date.parse('2026-02-03T04:05:06.000Z'),
    env: {},
  })
  return { root, home, patchPath, service }
}

test('a local stdio MCP server previews and installs into the managed block', async () => {
  const { root, patchPath, service } = await fixture()
  try {
    const preview = await service.previewLocal({
      serverName: 'local_echo',
      command: '/bin/echo',
      args: ['hello world', '--flag'],
      env: { LOCAL_TOKEN: 's3cret', PLAIN: 'value' },
      cwd: '/tmp',
    })
    assert.equal(preview.kind, 'local')
    assert.equal(preview.serverName, 'local_echo')
    assert.equal(preview.transport, 'stdio')
    assert.equal(preview.available, true)
    assert.deepEqual(preview.args, ['hello world', '--flag'])
    assert.equal(preview.config.env.LOCAL_TOKEN, '••••••')
    assert.equal(preview.config.env.PLAIN, 'value')
    assert.equal(preview.cwd, '/tmp')

    const result = await service.installLocal({
      serverName: 'local_echo',
      command: '/bin/echo',
      args: ['hello world'],
      env: { LOCAL_TOKEN: 's3cret' },
      cwd: '/tmp',
    })
    assert.equal(result.installed, true)
    const text = await readFile(patchPath, 'utf8')
    assert.match(text, /serverName: local_echo/u)
    assert.match(text, /command: '\/bin\/echo'/u)
    assert.match(text, /cwd: '\/tmp'/u)
    assert.match(text, /LOCAL_TOKEN: 's3cret'/u)

    const installed = await service.installed()
    const record = installed.servers.find(server => server.serverName === 'local_echo')
    assert.ok(record)
    assert.equal(record.registryName, 'local/local_echo')
    assert.equal(record.cwd, '/tmp')

    await assert.rejects(service.installLocal({ serverName: 'local_echo', command: '/bin/echo' }), error => error.code === 'mcp/already-installed')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('local stdio validation rejects missing commands, relative paths, and bad names', async () => {
  const { root, service } = await fixture()
  try {
    const missingAbsolute = await service.previewLocal({ command: '/definitely/not/here' })
    assert.equal(missingAbsolute.available, false)
    assert.equal(missingAbsolute.runtimeMissing, true)
    await assert.rejects(service.installLocal({ command: '/definitely/not/here' }), error => error.code === 'mcp/runtime-missing')
    const missingBare = await service.previewLocal({ command: 'definitely-not-a-command' })
    assert.equal(missingBare.available, false)
    await assert.rejects(service.installLocal({ command: 'definitely-not-a-command' }), error => error.code === 'mcp/runtime-missing')
    await assert.rejects(service.previewLocal({ command: './server' }), error => error.code === 'mcp/invalid-value')
    await assert.rejects(service.previewLocal({ command: '/bin/echo', serverName: 'bad name' }), error => error.code === 'mcp/invalid-value')
    await assert.rejects(service.previewLocal({ command: '/bin/echo', cwd: 'relative' }), error => error.code === 'mcp/invalid-value')
    await assert.rejects(service.previewLocal({ command: '/bin/echo', cwd: '/definitely/not/here' }), error => error.code === 'mcp/invalid-value')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
