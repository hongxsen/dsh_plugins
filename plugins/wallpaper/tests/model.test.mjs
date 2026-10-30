import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  BUILTIN_IDS, DEFAULT_BUILTIN, DEFAULT_VEIL, MAX_CUSTOM_DATA_URL, MAX_CUSTOM_INPUT_BYTES,
  VEIL_MAX, VEIL_MIN,
  defaultState, normalizeCustom, normalizeState, parseStored, removeCustom, selectCustom,
  serializeState, setBuiltin, setCustom, setVeil, usesCustom, validateCustomFile,
} from '../src/model.mjs'
import { fitWithin } from '../src/image.mjs'

const here = dirname(fileURLToPath(import.meta.url))

/** A tiny valid stored image record. */
function customImage(overrides = {}) {
  return {
    name: 'photo.jpg',
    dataUrl: 'data:image/webp;base64,UklGRhoge',
    width: 2560,
    height: 1600,
    updatedAt: 1790000000000,
    ...overrides,
  }
}

test('the built-in catalog is in display order', () => {
  assert.deepEqual([...BUILTIN_IDS], ['aurora', 'dune', 'tide', 'bloom', 'paper'])
})

test('defaults select the built-in aurora wallpaper with the standard frost', () => {
  assert.deepEqual(defaultState(), {
    version: 1,
    selection: { kind: 'builtin', id: DEFAULT_BUILTIN },
    veil: DEFAULT_VEIL,
    custom: null,
  })
})

test('normalizeState drops unknown keys, repairs the selection, and clamps the frost', () => {
  assert.deepEqual(normalizeState({ extra: true }), defaultState())
  assert.deepEqual(normalizeState({ selection: { kind: 'builtin', id: 'missing' } }).selection,
    { kind: 'builtin', id: DEFAULT_BUILTIN })
  assert.deepEqual(normalizeState({ selection: { kind: 'custom' } }).selection,
    { kind: 'builtin', id: DEFAULT_BUILTIN })
  assert.equal(normalizeState({ veil: -100 }).veil, VEIL_MIN)
  assert.equal(normalizeState({ veil: 1000 }).veil, VEIL_MAX)
  assert.equal(normalizeState({ veil: 61.6 }).veil, 62)
  assert.equal(normalizeState({ veil: '61' }).veil, DEFAULT_VEIL)
})

test('custom images must be raster data URLs within the storage budget', () => {
  assert.equal(normalizeCustom(customImage()).name, 'photo.jpg')
  assert.equal(normalizeCustom(customImage({ name: '  a \n b  ' })).name, 'a b')
  assert.equal(normalizeCustom(customImage({ dataUrl: 'javascript:alert(1)' })), null)
  assert.equal(normalizeCustom(customImage({ dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' })), null)
  assert.equal(normalizeCustom(customImage({ dataUrl: `data:image/png;base64,${'A'.repeat(MAX_CUSTOM_DATA_URL)}` })), null)
  assert.equal(normalizeCustom(customImage({ dataUrl: 'data:image/png;base64,AAAA' })).width, 2560)
  assert.deepEqual(normalizeCustom({ ...customImage(), width: -1, height: 1.5 }), {
    name: 'photo.jpg',
    dataUrl: 'data:image/webp;base64,UklGRhoge',
    width: 0,
    height: 0,
    updatedAt: 1790000000000,
  })
})

test('a custom selection requires a stored image', () => {
  const base = defaultState()
  assert.equal(selectCustom(base), base)
  const withImage = setCustom(base, customImage())
  assert.equal(withImage.selection.kind, 'custom')
  assert.equal(usesCustom(withImage), true)
  assert.equal(selectCustom({ ...withImage, selection: { kind: 'builtin', id: 'tide' } }).selection.kind, 'custom')
})

test('removing the custom image returns a custom selection to the default wallpaper', () => {
  const state = setCustom(defaultState(), customImage())
  const removed = removeCustom(state)
  assert.equal(removed.custom, null)
  assert.deepEqual(removed.selection, { kind: 'builtin', id: DEFAULT_BUILTIN })
  const builtin = setBuiltin(state, 'tide')
  assert.deepEqual(removeCustom(builtin).selection, { kind: 'builtin', id: 'tide' })
})

test('setBuiltin ignores unknown ids and setVeil clamps to the slider range', () => {
  const state = defaultState()
  assert.equal(setBuiltin(state, 'nope'), state)
  assert.equal(setBuiltin(state, 'bloom').selection.id, 'bloom')
  assert.equal(setVeil(state, 10).veil, VEIL_MIN)
  assert.equal(setVeil(state, 99).veil, VEIL_MAX)
  assert.equal(setVeil(state, 55.4).veil, 55)
})

test('stored documents round-trip and corrupt values fall back to defaults', () => {
  const state = setCustom(setBuiltin(defaultState(), 'dune'), customImage())
  assert.deepEqual(parseStored(serializeState(state)), state)
  assert.deepEqual(parseStored(null), defaultState())
  assert.deepEqual(parseStored('{oops'), defaultState())
  assert.deepEqual(parseStored('42'), defaultState())
})

test('the picker rejects unsupported types and oversized files before decoding', () => {
  assert.equal(validateCustomFile({ type: 'image/jpeg', size: 1024 }), null)
  assert.equal(validateCustomFile({ type: 'image/gif', size: 1024 }), null)
  assert.equal(validateCustomFile({ type: 'image/svg+xml', size: 1024 }), 'type')
  assert.equal(validateCustomFile({ type: 'text/plain', size: 1024 }), 'type')
  assert.equal(validateCustomFile({ type: 'image/png', size: MAX_CUSTOM_INPUT_BYTES + 1 }), 'size')
  assert.equal(validateCustomFile(null), 'type')
})

test('fitWithin scales down, never enlarges, and keeps aspect ratio', () => {
  assert.deepEqual(fitWithin(3200, 2000, 2560), { width: 2560, height: 1600 })
  assert.deepEqual(fitWithin(800, 600, 2560), { width: 800, height: 600 })
  assert.deepEqual(fitWithin(1000, 5000, 2000), { width: 400, height: 2000 })
  assert.deepEqual(fitWithin(0, 0, 100), { width: 1, height: 1 })
})

test('the committed bundle contains every built-in and its two artworks', async () => {
  const client = await readFile(join(here, '..', 'client.js'), 'utf8')
  for (const id of BUILTIN_IDS) {
    assert.match(client, new RegExp(`"id":"${id}"`, 'u'))
    const light = await readFile(join(here, '..', 'art', `${id}-light.svg`), 'utf8')
    const dark = await readFile(join(here, '..', 'art', `${id}-dark.svg`), 'utf8')
    assert.match(light, /^<svg /u)
    assert.match(dark, /^<svg /u)
  }
})
