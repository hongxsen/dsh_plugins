import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  installPreview,
  pruneStaging,
  readPreview,
  removeInstalled,
  validateStagedPayload,
  writePreview,
} from '../lib/staging.js'
import { metadataPathOf, skillsRootOf, stagingRootOf, trashRootOf } from '../lib/paths.js'
import { readMetadata } from '../lib/metadata.js'
import { STAGING_TTL_MS } from '../lib/constants.js'

const skillMd = (name) => `---\nname: ${name}\ndescription: Demo skill\n---\n# ${name}\nBody.\n`

async function tempHome(t) {
  const home = await mkdtemp(join(tmpdir(), 'dshsm-stage-'))
  t.after(async () => { await rm(home, { recursive: true, force: true }) })
  return home
}

async function stage(home, token, files, options = {}) {
  const name = options.name ?? 'demo'
  const entries = Object.entries(files)
  const totalBytes = entries.reduce((sum, [, body]) => sum + Buffer.byteLength(body), 0)
  await writePreview(home, token, {
    name,
    description: 'Demo skill',
    source: 'acme/skills',
    skillId: name,
    repo: 'https://github.com/acme/skills',
    branch: 'main',
    path: `skills/${name}`,
    files: entries.map(([path, body]) => ({ path, size: Buffer.byteLength(body) })),
    totalBytes,
    skillMd: String(files['SKILL.md'] ?? ''),
    warnings: [],
  }, entries.map(([path, body]) => ({ path, buffer: Buffer.from(body) })), options)
  return token
}

test('writePreview writes the payload and readPreview returns metadata', async (t) => {
  const home = await tempHome(t)
  const token = await stage(home, randomUUID(), {
    'SKILL.md': skillMd('demo'),
    'reference/notes.md': 'notes',
  })
  const preview = await readPreview(home, token)
  assert.equal(preview.meta.name, 'demo')
  assert.equal(preview.meta.files.length, 2)
  const text = await readFile(join(preview.payload, 'reference', 'notes.md'), 'utf8')
  assert.equal(text, 'notes')
})

test('readPreview rejects unknown and expired tokens', async (t) => {
  const home = await tempHome(t)
  await assert.rejects(readPreview(home, '../etc'), (error) => error.code === 'skills/staging-expired')
  await assert.rejects(readPreview(home, randomUUID()), (error) => error.code === 'skills/staging-expired')

  const base = 1_000_000
  const token = await stage(home, randomUUID(), { 'SKILL.md': skillMd('demo') }, { now: base })
  await assert.rejects(readPreview(home, token, { now: base + STAGING_TTL_MS + 1 }), (error) => error.code === 'skills/staging-expired')
  const fresh = await readPreview(home, token, { now: base + 1000 })
  assert.equal(fresh.meta.name, 'demo')
})

test('pruneStaging removes expired previews and keeps the newest five', async (t) => {
  const home = await tempHome(t)
  const now = Date.now()
  const tokens = []
  for (let index = 0; index < 7; index += 1) {
    const token = await stage(home, randomUUID(), { 'SKILL.md': skillMd('demo') }, { now })
    tokens.push(token)
    await utimes(join(stagingRootOf(home), token), new Date(now - index * 1000), new Date(now - index * 1000))
  }
  const expired = await stage(home, randomUUID(), { 'SKILL.md': skillMd('demo') }, { now: now - STAGING_TTL_MS - 60_000 })
  await utimes(join(stagingRootOf(home), expired), new Date(now - STAGING_TTL_MS - 60_000), new Date(now - STAGING_TTL_MS - 60_000))
  await pruneStaging(home, { now })
  const left = await readdir(stagingRootOf(home))
  assert.equal(left.length, 5)
  assert.equal(left.includes(expired), false)
  assert.equal(left.includes(tokens[0]), true)
  assert.equal(left.includes(tokens[4]), true)
  assert.equal(left.includes(tokens[6]), false)
})

test('validateStagedPayload requires SKILL.md and refuses symlinks and path escapes', async (t) => {
  const home = await tempHome(t)
  const token = await stage(home, randomUUID(), { 'readme.md': 'no manifest' })
  await assert.rejects(
    validateStagedPayload(join(stagingRootOf(home), token, 'payload')),
    (error) => error.code === 'skills/invalid-skill',
  )

  const symlinkToken = await stage(home, randomUUID(), { 'SKILL.md': skillMd('demo') })
  const symlinkPayload = join(stagingRootOf(home), symlinkToken, 'payload')
  await symlink('/etc/passwd', join(symlinkPayload, 'link'))
  await assert.rejects(validateStagedPayload(symlinkPayload), (error) => error.code === 'skills/invalid-skill')

  const escapeToken = await stage(home, randomUUID(), { 'SKILL.md': skillMd('demo') })
  const escapePayload = join(stagingRootOf(home), escapeToken, 'payload')
  await writeFile(join(escapePayload, 'a\\b.md'), 'backslash')
  await assert.rejects(validateStagedPayload(escapePayload), (error) => error.code === 'skills/invalid-skill')
})

test('installPreview moves the staged skill into ~/.dsh/skills and records metadata', async (t) => {
  const home = await tempHome(t)
  const token = await stage(home, randomUUID(), {
    'SKILL.md': skillMd('frontend-design'),
    'reference/color.md': '# Color',
  }, { name: 'frontend-design' })
  const result = await installPreview({ dshHome: home, token })
  assert.deepEqual(result, { installed: true, name: 'frontend-design' })

  const target = join(skillsRootOf(home), 'frontend-design')
  assert.equal(await readFile(join(target, 'reference', 'color.md'), 'utf8'), '# Color')
  assert.equal((await lstat(join(target, 'SKILL.md'))).isFile(), true)

  const metadata = await readMetadata(metadataPathOf(home))
  assert.equal(metadata.skills['frontend-design'].source, 'acme/skills')
  assert.equal(metadata.skills['frontend-design'].files, 2)
  assert.equal(metadata.skills['frontend-design'].branch, 'main')
  await assert.rejects(lstat(join(stagingRootOf(home), token)), (error) => error.code === 'ENOENT')
})

test('installPreview refuses an existing name unless replace is set', async (t) => {
  const home = await tempHome(t)
  const first = await stage(home, randomUUID(), { 'SKILL.md': skillMd('demo') })
  await installPreview({ dshHome: home, token: first })

  const second = await stage(home, randomUUID(), { 'SKILL.md': skillMd('demo'), 'NEW.md': 'v2' })
  await assert.rejects(installPreview({ dshHome: home, token: second }), (error) => error.code === 'skills/exists')

  const replaced = await installPreview({ dshHome: home, token: second, replace: true })
  assert.deepEqual(replaced, { installed: true, name: 'demo' })
  assert.equal(await readFile(join(skillsRootOf(home), 'demo', 'NEW.md'), 'utf8'), 'v2')
})

test('installPreview never replaces a directory it does not manage', async (t) => {
  const home = await tempHome(t)
  await mkdir(join(skillsRootOf(home), 'demo'), { recursive: true })
  await writeFile(join(skillsRootOf(home), 'demo', 'SKILL.md'), skillMd('demo'))
  const token = await stage(home, randomUUID(), { 'SKILL.md': skillMd('demo') })
  await assert.rejects(
    installPreview({ dshHome: home, token, replace: true }),
    (error) => error.code === 'skills/not-managed',
  )
  assert.equal(await readFile(join(skillsRootOf(home), 'demo', 'SKILL.md'), 'utf8'), skillMd('demo'))
})

test('installPreview rejects a symlinked target', async (t) => {
  const home = await tempHome(t)
  const external = join(home, 'external')
  await mkdir(external, { recursive: true })
  await writeFile(join(external, 'SKILL.md'), skillMd('demo'))
  await mkdir(skillsRootOf(home), { recursive: true })
  await symlink(external, join(skillsRootOf(home), 'demo'))
  const token = await stage(home, randomUUID(), { 'SKILL.md': skillMd('demo') })
  await assert.rejects(
    installPreview({ dshHome: home, token, replace: true }),
    (error) => error.code === 'skills/not-managed',
  )
})

test('removeInstalled removes only managed skills and cleans the trash', async (t) => {
  const home = await tempHome(t)
  const token = await stage(home, randomUUID(), { 'SKILL.md': skillMd('demo') })
  await installPreview({ dshHome: home, token })
  await assert.rejects(removeInstalled({ dshHome: home, name: 'unknown' }), (error) => error.code === 'skills/not-managed')
  await assert.rejects(removeInstalled({ dshHome: home, name: 'Not Kebab' }), (error) => error.code === 'skills/invalid-skill')

  const result = await removeInstalled({ dshHome: home, name: 'demo' })
  assert.deepEqual(result, { removed: true })
  await assert.rejects(lstat(join(skillsRootOf(home), 'demo')), (error) => error.code === 'ENOENT')
  const metadata = await readMetadata(metadataPathOf(home))
  assert.deepEqual(metadata.skills, {})
  const trash = await readdir(trashRootOf(home))
  assert.deepEqual(trash, [])
})

test('removeInstalled refuses a symlink and never touches unmanaged directories', async (t) => {
  const home = await tempHome(t)
  await mkdir(join(skillsRootOf(home), 'manual'), { recursive: true })
  await assert.rejects(removeInstalled({ dshHome: home, name: 'manual' }), (error) => error.code === 'skills/not-managed')

  const external = join(home, 'external')
  await mkdir(external, { recursive: true })
  await symlink(external, join(skillsRootOf(home), 'linked'))
  const metadata = { version: 1, skills: { linked: { name: 'linked' } } }
  await mkdir(join(home, 'storages', 'dsh-skills-market'), { recursive: true })
  await writeFile(metadataPathOf(home), JSON.stringify(metadata))
  await assert.rejects(removeInstalled({ dshHome: home, name: 'linked' }), (error) => error.code === 'skills/not-managed')
})

test('installPreview refuses a symlinked skills root', async (t) => {
  const home = await tempHome(t)
  const external = join(home, 'external-skills')
  await mkdir(external, { recursive: true })
  await symlink(external, skillsRootOf(home))
  const token = await stage(home, randomUUID(), { 'SKILL.md': skillMd('demo') })
  await assert.rejects(
    installPreview({ dshHome: home, token }),
    (error) => error.code === 'skills/install-failed',
  )
})

test('installPreview and removeInstalled refuse a symlinked .trash', async (t) => {
  const home = await tempHome(t)
  const first = await stage(home, randomUUID(), { 'SKILL.md': skillMd('demo') })
  await installPreview({ dshHome: home, token: first })
  const external = join(home, 'external-trash')
  await mkdir(external, { recursive: true })
  await rm(trashRootOf(home), { recursive: true, force: true })
  await symlink(external, trashRootOf(home))

  await assert.rejects(removeInstalled({ dshHome: home, name: 'demo' }), (error) => error.code === 'skills/install-failed')

  const second = await stage(home, randomUUID(), { 'SKILL.md': skillMd('demo'), 'NEW.md': 'v2' })
  await assert.rejects(
    installPreview({ dshHome: home, token: second, replace: true }),
    (error) => error.code === 'skills/install-failed',
  )
  assert.equal(await readFile(join(skillsRootOf(home), 'demo', 'SKILL.md'), 'utf8'), skillMd('demo'))
})
