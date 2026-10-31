import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CARD_DESCRIPTION_LIMIT,
  clipText,
  createApiClient,
  debounce,
  errorFromPayload,
  formatBytes,
  formatCount,
  formatDate,
  hashString,
  monogramOf,
  normalizeInstalled,
  normalizeSkills,
  safeHttpsUrl,
  skillKey,
  summarizeDescription,
} from '../src/model.mjs'

test('hashString and monogramOf are deterministic', () => {
  assert.equal(hashString('demo'), hashString('demo'))
  assert.notEqual(hashString('demo'), hashString('other'))
  const first = monogramOf('frontend-design')
  const second = monogramOf('frontend-design')
  assert.deepEqual(first, second)
  assert.equal(first.letter, 'F')
  assert.ok(first.hue >= 0 && first.hue < 360)
  assert.equal(monogramOf('').letter, '?')
  assert.equal(monogramOf('技能').letter, '技')
})

test('formatCount compacts install counts', () => {
  assert.equal(formatCount(0), '0')
  assert.equal(formatCount(-5), '0')
  assert.equal(formatCount(999), '999')
  assert.equal(formatCount(1000), '1.0K')
  assert.equal(formatCount(1200), '1.2K')
  assert.equal(formatCount(900000), '900K')
  assert.equal(formatCount(1052099), '1.1M')
  assert.equal(formatCount(4100000), '4.1M')
  assert.equal(formatCount(1_500_000_000), '1.5B')
  assert.equal(formatCount('nope'), '0')
})

test('formatBytes uses binary units', () => {
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(1024), '1.0 KB')
  assert.equal(formatBytes(8 * 1024 * 1024), '8.0 MB')
  assert.equal(formatBytes(20 * 1024), '20 KB')
  assert.equal(formatBytes(-1), '0 B')
})

test('clipText and summarizeDescription bound card text', () => {
  assert.equal(clipText('hello', 10), 'hello')
  assert.equal(clipText('hello world', 6), 'hello…')
  assert.equal(summarizeDescription('  a\n\n  b  ', 100), 'a b')
  assert.equal(summarizeDescription('x'.repeat(CARD_DESCRIPTION_LIMIT + 5)).length, CARD_DESCRIPTION_LIMIT)
  assert.equal(summarizeDescription(undefined), '')
})

test('skillKey prefers source/skillId', () => {
  assert.equal(skillKey({ source: 'a/b', skillId: 'c' }), 'a/b/c')
  assert.equal(skillKey({ name: 'demo' }), 'demo')
  assert.equal(skillKey(null), '')
})

test('normalizeSkills filters hostile or incomplete entries', () => {
  const skills = normalizeSkills([
    { source: 'a/b', skillId: 'demo', name: 'Demo', installs: 12 },
    { source: 'a/b', skillId: 'demo', installs: 99 },
    { source: '', skillId: 'x' },
    { source: 'a/b' },
    null,
    'nope',
    { source: 'a/b', skillId: 'other', installs: -5 },
  ])
  assert.equal(skills.length, 2)
  assert.deepEqual(skills[0], { id: 'a/b/demo', source: 'a/b', skillId: 'demo', name: 'Demo', installs: 12 })
  assert.equal(skills[1].installs, 0)
  assert.equal(normalizeSkills('nope').length, 0)
})

test('normalizeInstalled keeps safe booleans and counts', () => {
  const installed = normalizeInstalled([
    {
      name: 'demo',
      description: 'Demo',
      managed: true,
      writable: true,
      warnings: 2,
      files: 3,
      totalBytes: 100,
      source: 'a/b',
      installedAt: '2026-10-31T00:00:00.000Z',
      path: '~/.dsh/skills/demo',
    },
    { name: '', managed: true },
    null,
    { name: 'odd', managed: 'yes', warnings: 'many' },
  ])
  assert.equal(installed.length, 2)
  assert.equal(installed[0].managed, true)
  assert.equal(installed[0].warnings, 2)
  assert.equal(installed[1].managed, false)
  assert.equal(installed[1].warnings, 0)
  assert.equal(installed[1].valid, true)
  assert.equal(normalizeInstalled([{ name: 'shared', root: 'user-agents' }])[0].root, 'user-agents')
})

test('formatDate renders a stable short date and tolerates junk', () => {
  assert.match(formatDate('2026-10-31T00:00:00.000Z', 'en'), /2026/u)
  assert.match(formatDate('2026-10-31T00:00:00.000Z', 'zh'), /2026/u)
  assert.equal(formatDate('not a date', 'en'), '')
  assert.equal(formatDate('', 'en'), '')
})

test('safeHttpsUrl accepts only https URLs', () => {
  assert.equal(safeHttpsUrl('https://example.com/x'), 'https://example.com/x')
  assert.equal(safeHttpsUrl('http://example.com/x'), null)
  assert.equal(safeHttpsUrl('javascript:alert(1)'), null)
  assert.equal(safeHttpsUrl(''), null)
  assert.equal(safeHttpsUrl(undefined), null)
})

test('debounce waits, coalesces, and can be cancelled', async () => {
  const calls = []
  const fn = debounce((value) => { calls.push(value) }, 20)
  fn('a')
  fn('b')
  await new Promise((resolve) => { setTimeout(resolve, 45) })
  assert.deepEqual(calls, ['b'])
  fn('c')
  fn.cancel()
  await new Promise((resolve) => { setTimeout(resolve, 45) })
  assert.deepEqual(calls, ['b'])
})

test('errorFromPayload keeps the stable code and status', () => {
  const error = errorFromPayload({ error: { code: 'skills/exists', message: 'x' } }, 409)
  assert.equal(error.code, 'skills/exists')
  assert.equal(error.status, 409)
  assert.equal(errorFromPayload(null, 502).code, 'http/502')
})

test('errorFromPayload preserves sanitized details and message', () => {
  const error = errorFromPayload({
    error: {
      code: 'skills/invalid-skill',
      message: 'Symbolic links are not installable',
      details: {
        path: 'venv/bin/python',
        kind: 'symlink',
        files: 3200,
        nested: { deep: true },
        drop: undefined,
      },
    },
  }, 400)
  assert.equal(error.code, 'skills/invalid-skill')
  assert.equal(error.status, 400)
  assert.equal(error.message, 'Symbolic links are not installable')
  assert.deepEqual(error.details, { path: 'venv/bin/python', kind: 'symlink', files: 3200 })
  assert.equal(errorFromPayload({ error: { code: 'x', details: 'nope' } }, 400).details, undefined)
  assert.equal(errorFromPayload({ error: { code: 'x', details: {} } }, 400).details, undefined)
  assert.equal(errorFromPayload({ error: { code: 'x', details: { junk: null } } }, 400).details, undefined)
  assert.equal(errorFromPayload({ error: { code: 'x', message: '   ' } }, 400).message, 'skills-market request failed')
  const clipped = errorFromPayload({
    error: { code: 'x', details: { path: 'p'.repeat(400) } },
  }, 400)
  assert.equal(clipped.details.path.length, 200)
})

test('createApiClient builds same-origin requests with the spec timeouts', async () => {
  const calls = []
  const api = createApiClient('/dsh-skills-market', {
    fetchImpl: async (url, init) => {
      calls.push({ url, init })
      return new Response(JSON.stringify({ seed: true, skills: [] }), { status: 200 })
    },
  })
  const result = await api.search('a b')
  assert.equal(result.seed, true)
  assert.equal(calls[0].url, '/dsh-skills-market/api/search?q=a+b')
  assert.equal(calls[0].init.method, 'GET')
  assert.equal(calls[0].init.credentials, 'same-origin')

  await api.preview({ source: 'a/b', skillId: 'demo' })
  assert.equal(calls[1].url, '/dsh-skills-market/api/preview')
  assert.equal(calls[1].init.method, 'POST')
  assert.equal(calls[1].init.headers['content-type'], 'application/json')
  assert.deepEqual(JSON.parse(calls[1].init.body), { source: 'a/b', skillId: 'demo' })
})

test('createApiClient maps API and network failures', async () => {
  const conflict = createApiClient('/base', {
    fetchImpl: async () => new Response(JSON.stringify({ error: { code: 'skills/exists' } }), { status: 409 }),
  })
  await assert.rejects(conflict.install({ token: 'x' }), (error) => error.code === 'skills/exists')

  const offline = createApiClient('/base', {
    fetchImpl: async () => { throw new Error('offline') },
  })
  await assert.rejects(offline.installed(), (error) => error.code === 'network')

  const broken = createApiClient('/base', {
    fetchImpl: async () => new Response('<html>oops</html>', { status: 500 }),
  })
  await assert.rejects(broken.installed(), (error) => error.code === 'http/500')
})
