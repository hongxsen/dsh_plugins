import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSkillsMarket } from '../lib/skills.js'

const SKILL_MD = `---\nname: local-review\ndescription: Review a local change\n---\n\n# Local review\n\nCheck the diff.\n`

async function tempHome() {
  const home = await mkdtemp(join(tmpdir(), 'skills-local-'))
  return { home, cleanup: () => rm(home, { recursive: true, force: true }) }
}

async function makeSkill(root, name = 'local-review') {
  const directory = join(root, name)
  await mkdir(join(directory, 'scripts'), { recursive: true })
  await writeFile(join(directory, 'SKILL.md'), SKILL_MD)
  await writeFile(join(directory, 'scripts', 'check.sh'), '#!/bin/sh\necho ok\n')
  return directory
}

test('a local skill directory previews, stages, and installs', async () => {
  const { home, cleanup } = await tempHome()
  const sourceRoot = await mkdtemp(join(tmpdir(), 'skills-source-'))
  try {
    const directory = await makeSkill(sourceRoot)
    const service = createSkillsMarket({ dshHome: home, agentsHome: join(home, 'agents'), fetchImpl: async () => { throw new Error('network must not be used') } })
    const preview = await service.previewLocal(directory)
    assert.equal(preview.kind, 'local')
    assert.equal(preview.name, 'local-review')
    assert.equal(preview.source, 'local')
    assert.equal(preview.existing, false)
    assert.deepEqual(preview.files.map((file) => file.path).sort(), ['SKILL.md', 'scripts/check.sh'])
    assert.match(preview.localPath, /local-review$/u)

    const result = await service.install({ token: preview.token })
    assert.deepEqual(result, { installed: true, name: 'local-review' })
    assert.match(await readFile(join(home, 'skills', 'local-review', 'SKILL.md'), 'utf8'), /Local review/u)
    assert.match(await readFile(join(home, 'skills', 'local-review', 'scripts', 'check.sh'), 'utf8'), /echo ok/u)
    const installed = await service.installed()
    const record = installed.skills.find((skill) => skill.name === 'local-review')
    assert.ok(record)
    assert.equal(record.source, 'local')
  } finally {
    await rm(sourceRoot, { recursive: true, force: true })
    await cleanup()
  }
})

test('a single local SKILL.md file can be installed', async () => {
  const { home, cleanup } = await tempHome()
  const sourceRoot = await mkdtemp(join(tmpdir(), 'skills-file-'))
  try {
    const file = join(sourceRoot, 'SKILL.md')
    await writeFile(file, SKILL_MD.replace('local-review', 'flat-skill'))
    const service = createSkillsMarket({ dshHome: home, agentsHome: join(home, 'agents'), fetchImpl: async () => { throw new Error('network must not be used') } })
    const preview = await service.previewLocal(file)
    assert.equal(preview.name, 'flat-skill')
    assert.deepEqual(preview.files.map((entry) => entry.path), ['SKILL.md'])
    await service.install({ token: preview.token })
    assert.match(await readFile(join(home, 'skills', 'flat-skill', 'SKILL.md'), 'utf8'), /Local review/u)
  } finally {
    await rm(sourceRoot, { recursive: true, force: true })
    await cleanup()
  }
})

test('a local collection lists direct child skills before previewing one', async () => {
  const { home, cleanup } = await tempHome()
  const collection = await mkdtemp(join(tmpdir(), 'skills-collection-'))
  try {
    await mkdir(join(collection, 'alpha'), { recursive: true })
    await mkdir(join(collection, 'beta'), { recursive: true })
    await writeFile(join(collection, 'alpha', 'SKILL.md'), SKILL_MD.replace('local-review', 'alpha-skill'))
    await writeFile(join(collection, 'beta', 'SKILL.md'), SKILL_MD.replace('local-review', 'beta-skill'))
    await writeFile(join(collection, 'flat.md'), SKILL_MD.replace('local-review', 'flat-skill'))
    await writeFile(join(collection, 'notes.txt'), 'not a skill')
    const service = createSkillsMarket({ dshHome: home, agentsHome: join(home, 'agents'), fetchImpl: async () => { throw new Error('network must not be used') } })
    const listing = await service.previewLocal(collection)
    assert.equal(listing.kind, 'local-collection')
    assert.deepEqual(listing.skills.map((skill) => skill.name), ['alpha-skill', 'beta-skill', 'flat-skill'])
    assert.equal(listing.token, undefined)
    const selected = await service.previewLocal(join(collection, 'alpha'))
    assert.equal(selected.kind, 'local')
    assert.equal(selected.name, 'alpha-skill')
    assert.equal(selected.files.length, 1)
  } finally {
    await rm(collection, { recursive: true, force: true })
    await cleanup()
  }
})

test('local skill validation rejects missing paths, relative paths, and symlinks', async () => {
  const { home, cleanup } = await tempHome()
  const sourceRoot = await mkdtemp(join(tmpdir(), 'skills-links-'))
  try {
    const service = createSkillsMarket({ dshHome: home, agentsHome: join(home, 'agents'), fetchImpl: async () => { throw new Error('network must not be used') } })
    await assert.rejects(service.previewLocal(join(sourceRoot, 'missing')), (error) => error.code === 'skills/not-found')
    await assert.rejects(service.previewLocal('relative/SKILL.md'), (error) => error.code === 'skills/invalid-path')
    const directory = await makeSkill(sourceRoot)
    await symlink('/etc/hosts', join(directory, 'linked.txt'))
    await assert.rejects(service.previewLocal(directory), (error) => error.code === 'skills/invalid-skill')
    const rootLink = join(sourceRoot, 'linked-skill')
    await symlink(directory, rootLink)
    await assert.rejects(service.previewLocal(rootLink), (error) => error.code === 'skills/invalid-skill')
  } finally {
    await rm(sourceRoot, { recursive: true, force: true })
    await cleanup()
  }
})
