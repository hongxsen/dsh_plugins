import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  emptyMetadata,
  isManaged,
  normalizeMetadata,
  parseMetadata,
  readMetadata,
  recordInstall,
  recordRemove,
  writeMetadata,
} from '../lib/metadata.js'

const record = {
  name: 'frontend-design',
  source: 'anthropics/skills',
  skillId: 'frontend-design',
  repo: 'https://github.com/anthropics/skills',
  branch: 'main',
  path: 'skills/frontend-design',
  installedAt: '2026-10-31T00:00:00.000Z',
  files: 3,
  totalBytes: 1234,
}

test('normalizeMetadata tolerates corrupt shapes', () => {
  assert.deepEqual(normalizeMetadata(null), emptyMetadata())
  assert.deepEqual(normalizeMetadata([]), emptyMetadata())
  assert.deepEqual(normalizeMetadata({ version: 99, skills: 'nope' }), emptyMetadata())
  const normalized = normalizeMetadata({ version: 1, skills: { demo: { source: 'a/b' }, bad: null } })
  assert.equal(normalized.version, 1)
  assert.equal(normalized.skills.demo.name, 'demo')
  assert.equal('bad' in normalized.skills, false)
})

test('parseMetadata recovers from invalid JSON', () => {
  assert.deepEqual(parseMetadata('{not json'), emptyMetadata())
  assert.equal(parseMetadata('{"version":1,"skills":{}}').version, 1)
})

test('recordInstall and recordRemove round-trip without mutating input', () => {
  const first = emptyMetadata()
  const installed = recordInstall(first, record)
  assert.equal(isManaged(installed, 'frontend-design'), true)
  assert.equal(isManaged(first, 'frontend-design'), false)
  assert.deepEqual(installed.skills['frontend-design'], record)

  const replaced = recordInstall(installed, { ...record, totalBytes: 99 })
  assert.equal(replaced.skills['frontend-design'].totalBytes, 99)

  const removed = recordRemove(replaced, 'frontend-design')
  assert.deepEqual(removed, emptyMetadata())
  assert.equal(isManaged(removed, 'frontend-design'), false)
  assert.equal(isManaged(undefined, 'x'), false)
})

test('writeMetadata writes atomically and readMetadata returns the document', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dshsm-metadata-'))
  try {
    const path = join(directory, 'installed.json')
    assert.deepEqual(await readMetadata(path), emptyMetadata())
    await writeMetadata(path, recordInstall(emptyMetadata(), record))
    const text = await readFile(path, 'utf8')
    assert.match(text, /"frontend-design"/u)
    const document = await readMetadata(path)
    assert.equal(document.skills['frontend-design'].branch, 'main')
    const leftovers = (await readdir(directory)).filter((name) => name.includes('.tmp-'))
    assert.deepEqual(leftovers, [])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
