import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  candidateSkillManifests,
  collectSkillFiles,
  hasSkillContainerHint,
  normalizeTree,
  selectSkillFromTree,
} from '../lib/tree.js'

const blob = (path, size = 10, mode = '100644') => ({ path, type: 'blob', mode, size })

const sampleTree = [
  blob('README.md', 100),
  blob('skills/frontend-design/SKILL.md', 900),
  blob('skills/frontend-design/reference/color.md', 300),
  blob('skills/frontend-design/assets/logo.png', 500),
  blob('skills/tdd.md', 400),
  blob('skills/other/SKILL.md', 200),
  blob('plugins/legacy/SKILL.md', 100),
]

test('normalizeTree keeps only blob entries with string paths', () => {
  const tree = normalizeTree([...sampleTree, { path: 'tree-dir', type: 'tree' }, { type: 'blob' }, null])
  assert.equal(tree.length, sampleTree.length)
})

test('selectSkillFromTree prefers a directory named like the skill', () => {
  const selection = selectSkillFromTree(sampleTree, 'frontend-design')
  assert.equal(selection.kind, 'directory')
  assert.equal(selection.path, 'skills/frontend-design')
  assert.equal(selection.skillMd, 'skills/frontend-design/SKILL.md')
})

test('selectSkillFromTree matches directory names case-insensitively', () => {
  const selection = selectSkillFromTree(sampleTree, 'Frontend-Design')
  assert.equal(selection.path, 'skills/frontend-design')
})

test('selectSkillFromTree falls back to a flat markdown skill', () => {
  const selection = selectSkillFromTree(sampleTree, 'tdd')
  assert.equal(selection.kind, 'file')
  assert.equal(selection.path, 'skills/tdd.md')
})

test('selectSkillFromTree returns null for unknown skills', () => {
  assert.equal(selectSkillFromTree(sampleTree, 'nope'), null)
  assert.equal(selectSkillFromTree([], 'nope'), null)
  assert.equal(selectSkillFromTree(null, 'nope'), null)
})

test('selectSkillFromTree refuses unsafe tree paths', () => {
  const hostile = [blob('../../etc/SKILL.md'), blob('/abs/SKILL.md'), blob('skills/ok/SKILL.md')]
  const selection = selectSkillFromTree(hostile, 'etc')
  assert.equal(selection, null)
  const ok = selectSkillFromTree(hostile, 'ok')
  assert.equal(ok.path, 'skills/ok')
})

test('collectSkillFiles preserves relative paths and sizes', () => {
  const selection = selectSkillFromTree(sampleTree, 'frontend-design')
  const collected = collectSkillFiles(sampleTree, selection)
  assert.deepEqual(collected.files.map((file) => file.path), ['SKILL.md', 'reference/color.md', 'assets/logo.png'])
  assert.equal(collected.totalBytes, 1700)
})

test('collectSkillFiles normalizes a flat skill to SKILL.md', () => {
  const selection = selectSkillFromTree(sampleTree, 'tdd')
  const collected = collectSkillFiles(sampleTree, selection)
  assert.deepEqual(collected.files, [{
    path: 'SKILL.md',
    sourcePath: 'skills/tdd.md',
    size: 400,
    mode: '100644',
  }])
  assert.equal(collected.totalBytes, 400)
})

test('collectSkillFiles rejects path traversal under the chosen directory', () => {
  const tree = [
    blob('skills/demo/SKILL.md'),
    blob('skills/demo/../../../etc/passwd'),
  ]
  const selection = selectSkillFromTree(tree, 'demo')
  assert.throws(() => collectSkillFiles(tree, selection), /Unsafe file path/u)
})

test('collectSkillFiles rejects symlink blobs', () => {
  const tree = [
    blob('skills/demo/SKILL.md'),
    blob('skills/demo/link', 10, '120000'),
  ]
  const selection = selectSkillFromTree(tree, 'demo')
  assert.throws(() => collectSkillFiles(tree, selection), /Symbolic links/u)
})

test('collectSkillFiles enforces file and size caps', () => {
  const tree = [blob('skills/demo/SKILL.md', 10)]
  for (let index = 0; index < 6; index += 1) tree.push(blob(`skills/demo/file-${index}.md`, 10))
  const selection = selectSkillFromTree(tree, 'demo')
  assert.throws(() => collectSkillFiles(tree, selection, { maxFiles: 5 }), /install limits/u)
  assert.throws(() => collectSkillFiles(tree, selection, { maxTotalBytes: 30 }), /install limits/u)
})

test('candidateSkillManifests narrows large repositories to skill containers', () => {
  assert.equal(hasSkillContainerHint('skills/x/SKILL.md'), true)
  assert.equal(hasSkillContainerHint('packages/a/skills/x/SKILL.md'), true)
  assert.equal(hasSkillContainerHint('.claude/skills/x/SKILL.md'), true)
  assert.equal(hasSkillContainerHint('docs/x/SKILL.md'), false)

  const small = [blob('docs/a/SKILL.md'), blob('skills/b/SKILL.md')]
  assert.deepEqual(candidateSkillManifests(small), ['docs/a/SKILL.md', 'skills/b/SKILL.md'])

  const large = []
  for (let index = 0; index < 45; index += 1) large.push(blob(`docs/${index}/SKILL.md`))
  large.push(blob('skills/keep/SKILL.md'))
  assert.deepEqual(candidateSkillManifests(large), ['skills/keep/SKILL.md'])
})

test('candidateSkillManifests caps the fetch list', () => {
  const tree = []
  for (let index = 0; index < 30; index += 1) tree.push(blob(`skills/s${index}/SKILL.md`))
  assert.equal(candidateSkillManifests(tree).length, 20)
})
