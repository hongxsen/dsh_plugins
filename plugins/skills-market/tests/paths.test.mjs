import { test } from 'node:test'
import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  agentsSkillsRootOf,
  assertSafeRelativePath,
  displayPath,
  expandHomePath,
  isInside,
  isStagingToken,
  metadataPathOf,
  resolveAgentsHome,
  resolveDshHome,
  safeRelativePath,
  skillsRootOf,
  stagingRootOf,
  trashRootOf,
} from '../lib/paths.js'

test('expandHomePath expands supported prefixes', () => {
  assert.equal(expandHomePath('~'), homedir())
  assert.equal(expandHomePath('~/.dsh'), join(homedir(), '.dsh'))
  assert.equal(expandHomePath('/absolute/path'), '/absolute/path')
  assert.equal(expandHomePath('relative/path'), 'relative/path')
})

test('resolveDshHome prefers the explicit path, then DSH_HOME, then ~/.dsh', () => {
  assert.equal(resolveDshHome('/custom/home', { DSH_HOME: '/env/home' }), resolve('/custom/home'))
  assert.equal(resolveDshHome(undefined, { DSH_HOME: '/env/home' }), resolve('/env/home'))
  assert.equal(resolveDshHome(undefined, { DSH_HOME: '   ' }), resolve(join(homedir(), '.dsh')))
  assert.equal(resolveDshHome(undefined, {}), resolve(join(homedir(), '.dsh')))
  assert.equal(resolveDshHome(undefined, { DSH_HOME: '~/custom' }), resolve(join(homedir(), 'custom')))
})

test('resolveAgentsHome prefers the explicit path, then DSH_AGENTS_HOME, then ~/.agents', () => {
  assert.equal(resolveAgentsHome('/custom/agents', { DSH_AGENTS_HOME: '/env/agents' }), resolve('/custom/agents'))
  assert.equal(resolveAgentsHome(undefined, { DSH_AGENTS_HOME: '/env/agents' }), resolve('/env/agents'))
  assert.equal(resolveAgentsHome(undefined, {}), resolve(join(homedir(), '.agents')))
  assert.equal(agentsSkillsRootOf('/custom/agents'), join('/custom/agents', 'skills'))
})

test('derived roots stay under the DSH home', () => {
  const home = resolve('/tmp/dsh-home')
  assert.equal(skillsRootOf(home), join(home, 'skills'))
  assert.equal(stagingRootOf(home), join(home, 'storages', 'dsh-skills-market', 'staging'))
  assert.equal(trashRootOf(home), join(home, 'skills', '.trash'))
  assert.equal(metadataPathOf(home), join(home, 'storages', 'dsh-skills-market', 'installed.json'))
})

test('isInside accepts children and rejects the root, siblings, and traversal', () => {
  const root = resolve('/tmp/dsh-home/skills')
  assert.equal(isInside(root, join(root, 'demo')), true)
  assert.equal(isInside(root, root), false)
  assert.equal(isInside(root, join(root, '..', 'other')), false)
  assert.equal(isInside(root, '/tmp/dsh-home/skills-evil'), false)
  assert.equal(isInside(root, '/etc/passwd'), false)
})

test('safeRelativePath accepts normal paths and rejects traversal', () => {
  assert.equal(safeRelativePath('SKILL.md'), 'SKILL.md')
  assert.equal(safeRelativePath('reference/guide.md'), 'reference/guide.md')
  assert.equal(safeRelativePath('assets/图 标.png'), 'assets/图 标.png')
  assert.equal(safeRelativePath('../etc/passwd'), null)
  assert.equal(safeRelativePath('a/../b'), null)
  assert.equal(safeRelativePath('/absolute'), null)
  assert.equal(safeRelativePath('C:/windows'), null)
  assert.equal(safeRelativePath('a//b'), null)
  assert.equal(safeRelativePath('a\\b'), null)
  assert.equal(safeRelativePath('a\u0000b'), null)
  assert.equal(safeRelativePath(''), null)
  assert.equal(safeRelativePath(42), null)
})

test('assertSafeRelativePath throws the stable code', () => {
  assert.throws(
    () => assertSafeRelativePath('../escape'),
    (error) => error.code === 'skills/invalid-skill',
  )
  assert.equal(assertSafeRelativePath('ok/file.md'), 'ok/file.md')
})

test('isStagingToken accepts UUIDs only', () => {
  assert.equal(isStagingToken('123e4567-e89b-12d3-a456-426614174000'), true)
  assert.equal(isStagingToken('123E4567-E89B-12D3-A456-426614174000'), true)
  assert.equal(isStagingToken('../etc'), false)
  assert.equal(isStagingToken('123e4567e89b12d3a456426614174000'), false)
  assert.equal(isStagingToken(undefined), false)
})

test('displayPath collapses the home directory', () => {
  assert.equal(displayPath(join(homedir(), '.dsh', 'skills', 'demo')), '~/.dsh/skills/demo')
  assert.equal(displayPath(homedir()), '~')
  assert.equal(displayPath('/opt/elsewhere'), '/opt/elsewhere')
})
