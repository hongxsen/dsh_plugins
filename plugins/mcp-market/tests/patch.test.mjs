import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MANAGED_END,
  MANAGED_START,
  findManagedBlock,
  parseExternalMcpRows,
  removeManagedBlock,
  renderManagedBlock,
  replaceManagedBlock,
} from '../lib/yaml.js'
import { BACKUP_SUFFIX, PATCH_MODE, createPatchManager } from '../lib/patch.js'
import { createServerStore, emptyStore } from '../lib/store.js'

const rowA = {
  rowId: 'mcp-market-weather_ab12',
  serverName: 'weather_ab12',
  transport: 'streamable-http',
  url: 'https://example.com/mcp',
  headers: { Authorization: 'Bearer secret' },
}

const rowB = {
  rowId: 'mcp-market-files_cd34',
  serverName: 'files_cd34',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@example/files@1.2.3', '--root', '/tmp'],
  env: { FILES_TOKEN: 'token-value' },
}

test('the managed block renders exact markers and both transports', () => {
  const block = renderManagedBlock([rowA, rowB])
  assert.ok(block.startsWith(MANAGED_START))
  assert.ok(block.endsWith(MANAGED_END))
  assert.match(block, /name: '@deepseek-ai\/dsh-mcp-client'/u)
  assert.match(block, /serverName: weather_ab12/u)
  assert.match(block, /transport: streamable-http/u)
  assert.match(block, /url: 'https:\/\/example\.com\/mcp'/u)
  assert.match(block, /command: npx/u)
  assert.match(block, /args:\n          - '-y'/u)
  assert.match(block, /FILES_TOKEN: 'token-value'/u)
  assert.equal(renderManagedBlock([]), '')
})

test('replacing and removing the block preserves every other byte', () => {
  const before = '# my profile\n- insert:\n    - id: keep\n      name: other\n# trailing comment\n'
  const once = replaceManagedBlock(before, [rowA])
  assert.ok(once.startsWith(before))
  const external = parseExternalMcpRows(once)
  assert.deepEqual(external, [])
  const twice = replaceManagedBlock(once, [rowA])
  assert.equal(twice, once)
  const removed = removeManagedBlock(once)
  assert.equal(removed.includes(MANAGED_START), false)
  assert.equal(removed.includes(MANAGED_END), false)
  assert.ok(removed.includes('# my profile'))
  assert.ok(removed.includes('id: keep'))
  assert.ok(removed.includes('# trailing comment'))
})

test('an empty patch receives one leading newline and stays idempotent', () => {
  const once = replaceManagedBlock('', [rowA])
  assert.ok(once.startsWith(`\n${MANAGED_START}`))
  assert.equal(replaceManagedBlock(once, [rowA]), once)
})

test('a CRLF patch keeps its unrelated lines', () => {
  const before = '# heading\r\n- id: keep\r\n  name: other\r\n'
  const once = replaceManagedBlock(before, [rowA])
  assert.ok(once.startsWith('# heading\r\n- id: keep\r\n  name: other\r\n'))
  const removed = removeManagedBlock(once)
  assert.ok(removed.startsWith('# heading\r\n- id: keep\r\n  name: other\r\n'))
  assert.equal(removed.includes(MANAGED_START), false)
})

test('external dsh-mcp-client rows are read-only and managed rows are excluded', () => {
  const text = `# profile
- insert:
    - id: mcp-github
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: github
        transport: stdio
        command: npx
- id: mcp-web
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: web
    transport: streamable-http
    url: https://example.com/mcp
- id: wallpaper
  name: '@hongxsen/dsh-wallpaper'
${renderManagedBlock([rowA])}
`
  const rows = parseExternalMcpRows(text)
  assert.deepEqual(rows, [
    { rowId: 'mcp-github', serverName: 'github', transport: 'stdio', enabled: true, external: true },
    { rowId: 'mcp-web', serverName: 'web', transport: 'streamable-http', enabled: true, external: true },
  ])
  const disabled = parseExternalMcpRows(`- insert:\n    - id: mcp-off\n      name: '@deepseek-ai/dsh-mcp-client'\n      disabled: true\n      config:\n        serverName: off\n        transport: stdio\n        command: npx\n`)
  assert.equal(disabled[0].enabled, false)
})

test('malformed markers are refused instead of guessed', () => {
  assert.throws(() => findManagedBlock(`${MANAGED_START}\n- insert:\n`), /not terminated/u)
  assert.throws(() => findManagedBlock(`${MANAGED_END}\n`), /without an opening marker/u)
  assert.throws(() => findManagedBlock(`${MANAGED_START}\n${MANAGED_START}\n${MANAGED_END}\n`), /more than one/u)
})

test('patch writes are atomic, backed up once, and idempotent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dshmcp-patch-'))
  try {
    const patch = join(dir, 'cordis.patch.yml')
    const original = '# profile\n- insert:\n    - id: keep\n      name: other\n'
    await writeFile(patch, original)
    const manager = createPatchManager({ patchPath: patch })
    const first = await manager.writeRows([rowA])
    assert.equal(first.changed, true)
    assert.ok((await readFile(patch, 'utf8')).includes(MANAGED_START))
    assert.equal((await stat(patch)).mode & 0o777, PATCH_MODE)
    assert.equal(await readFile(`${patch}${BACKUP_SUFFIX}`, 'utf8'), original)
    assert.equal((await stat(`${patch}${BACKUP_SUFFIX}`)).mode & 0o777, PATCH_MODE)

    const second = await manager.writeRows([rowA])
    assert.equal(second.changed, false)
    assert.equal(await readFile(`${patch}${BACKUP_SUFFIX}`, 'utf8'), original)

    await manager.writeRows([rowA, rowB])
    assert.equal(await readFile(`${patch}${BACKUP_SUFFIX}`, 'utf8'), original)
    const text = await readFile(patch, 'utf8')
    assert.ok(text.startsWith(original))
    assert.ok(text.includes('mcp-market-files_cd34'))

    await manager.writeRows([])
    assert.equal((await readFile(patch, 'utf8')).includes(MANAGED_START), false)
    assert.ok((await readFile(patch, 'utf8')).startsWith(original))
    const leftovers = (await readdir(dir)).filter(name => name.includes('.tmp'))
    assert.deepEqual(leftovers, [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('serialized patch writes never interleave markers', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dshmcp-queue-'))
  try {
    const patch = join(dir, 'cordis.patch.yml')
    await writeFile(patch, '# profile\n')
    const manager = createPatchManager({ patchPath: patch })
    await Promise.all([manager.writeRows([rowA]), manager.writeRows([rowB])])
    const text = await readFile(patch, 'utf8')
    assert.equal(text.split(MANAGED_START).length - 1, 1)
    assert.equal(text.split(MANAGED_END).length - 1, 1)
    assert.ok(text.includes('weather_ab12') || text.includes('files_cd34'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('an unreadable managed block reports patch-failed without touching the file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dshmcp-bad-'))
  try {
    const patch = join(dir, 'cordis.patch.yml')
    const original = `${MANAGED_START}\n- insert:\n`
    await writeFile(patch, original)
    const manager = createPatchManager({ patchPath: patch })
    await assert.rejects(() => manager.writeRows([rowA]), error => error.code === 'mcp/patch-failed')
    assert.equal(await readFile(patch, 'utf8'), original)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the server store is owner-only, atomic, and round-trips records', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dshmcp-store-'))
  try {
    const storage = join(dir, 'storages', 'dsh-mcp-market')
    const store = createServerStore({ dir: storage })
    assert.deepEqual(await store.read(), emptyStore())
    await store.write({
      version: 1,
      servers: {
        [rowA.rowId]: {
          rowId: rowA.rowId,
          serverName: rowA.serverName,
          registryName: 'io.github.example/weather',
          title: 'weather',
          description: 'Weather',
          version: '1.0.0',
          transport: 'streamable-http',
          url: rowA.url,
          headers: rowA.headers,
          enabled: true,
          installedAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    })
    const doc = await store.read()
    assert.equal(doc.servers[rowA.rowId].serverName, 'weather_ab12')
    assert.equal(doc.servers[rowA.rowId].headers.Authorization, 'Bearer secret')
    assert.equal((await stat(store.path)).mode & 0o777, PATCH_MODE)
    await store.update(next => {
      next.servers[rowA.rowId].enabled = false
      return next
    })
    assert.equal((await store.read()).servers[rowA.rowId].enabled, false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a corrupt server store fails loudly instead of erasing records', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dshmcp-corrupt-'))
  try {
    const storage = join(dir, 'storages', 'dsh-mcp-market')
    await mkdir(storage, { recursive: true })
    await writeFile(join(storage, 'servers.json'), '{oops')
    const store = createServerStore({ dir: storage })
    await assert.rejects(() => store.read(), error => error.code === 'mcp/install-failed')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
