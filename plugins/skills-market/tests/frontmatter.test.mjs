import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isKebabCase,
  parseFrontmatter,
  parseScalar,
  readSkillManifest,
  unquoteScalar,
} from '../lib/frontmatter.js'

test('kebab validation follows the skill name grammar', () => {
  assert.equal(isKebabCase('tdd'), true)
  assert.equal(isKebabCase('frontend-design'), true)
  assert.equal(isKebabCase('a1-b2'), true)
  assert.equal(isKebabCase('Frontend-Design'), false)
  assert.equal(isKebabCase('frontend_design'), false)
  assert.equal(isKebabCase('-leading'), false)
  assert.equal(isKebabCase('trailing-'), false)
  assert.equal(isKebabCase('double--dash'), false)
  assert.equal(isKebabCase(''), false)
  assert.equal(isKebabCase(undefined), false)
})

test('unquoteScalar handles single and double quotes', () => {
  assert.equal(unquoteScalar('"hello"'), 'hello')
  assert.equal(unquoteScalar("'hello'"), 'hello')
  assert.equal(unquoteScalar("'it''s'"), "it's")
  assert.equal(unquoteScalar('"a\\"b"'), 'a"b')
  assert.equal(unquoteScalar('"a\\nb"'), 'a\nb')
  assert.equal(unquoteScalar('plain'), 'plain')
})

test('parseScalar reads booleans, quotes, and trailing comments', () => {
  assert.equal(parseScalar('true'), true)
  assert.equal(parseScalar('false'), false)
  assert.equal(parseScalar('"quoted value"'), 'quoted value')
  assert.equal(parseScalar('plain value # comment'), 'plain value')
  assert.equal(parseScalar("'# not a comment'"), '# not a comment')
})

test('parseFrontmatter splits top-level fields from the body', () => {
  const source = '---\nname: tdd\ndescription: Test-driven development\nlicense: MIT\n---\n# TDD\nBody.\n'
  const parsed = parseFrontmatter(source)
  assert.equal(parsed.closed, true)
  assert.deepEqual(parsed.fields, { name: 'tdd', description: 'Test-driven development', license: 'MIT' })
  assert.equal(parsed.body, '# TDD\nBody.\n')
})

test('parseFrontmatter ignores nested YAML blocks', () => {
  const parsed = parseFrontmatter('---\nname: demo\ndescription: Demo\nmetadata:\n  version: 2\n---\nbody')
  assert.equal(parsed.closed, true)
  assert.deepEqual(parsed.fields, { name: 'demo', description: 'Demo', metadata: '' })
})

test('parseFrontmatter reports a missing or unclosed fence', () => {
  assert.equal(parseFrontmatter('# no fence').closed, false)
  assert.equal(parseFrontmatter('---\nname: x').closed, false)
})

test('readSkillManifest accepts quoted and plain descriptions', () => {
  const plain = readSkillManifest('---\nname: find-skills\ndescription: Find installable skills\n---\nbody')
  assert.equal(plain.ok, true)
  assert.equal(plain.name, 'find-skills')
  assert.equal(plain.description, 'Find installable skills')

  const quoted = readSkillManifest('---\nname: "pdf"\ndescription: "Work with PDF files"\n---\nbody')
  assert.equal(quoted.ok, true)
  assert.equal(quoted.name, 'pdf')
  assert.equal(quoted.description, 'Work with PDF files')
})

test('readSkillManifest rejects malformed names and empty descriptions', () => {
  assert.deepEqual(readSkillManifest('---\nname: Not Kebab\ndescription: x\n---\n'), { ok: false, reason: 'name' })
  assert.deepEqual(readSkillManifest('---\nname: ok\ndescription: ""\n---\n'), { ok: false, reason: 'description' })
  assert.deepEqual(readSkillManifest('no frontmatter'), { ok: false, reason: 'frontmatter' })
  assert.deepEqual(readSkillManifest('---\nname: ok\n---\nbody'), { ok: false, reason: 'description' })
  assert.deepEqual(readSkillManifest('---\nname: true\ndescription: x\n---\n'), { ok: false, reason: 'name' })
})

test('frontmatter attributes preserve optional booleans', () => {
  const manifest = readSkillManifest('---\nname: demo\ndescription: Demo\nallowed-tools: true\n---\n')
  assert.equal(manifest.ok, true)
  assert.equal(manifest.attributes['allowed-tools'], true)
})
