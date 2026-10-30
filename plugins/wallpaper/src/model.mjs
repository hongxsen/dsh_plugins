/**
 * Pure state model of the wallpaper plugin.
 *
 * The browser bundle inlines this file (with `export` prefixes stripped), and
 * the unit tests import it directly. Nothing here touches the DOM, Cordis, or
 * `window`, so the stored selection can be validated without a browser.
 */

/** localStorage key owning the whole wallpaper preference. */
export const STORAGE_KEY = 'dsh.wallpaper.v1'

/** Current stored document version. */
export const STATE_VERSION = 1

/** Built-in wallpaper used before the user chooses another one. */
export const DEFAULT_BUILTIN = 'aurora'

/** Surface frost percentage used before the user moves the slider. */
export const DEFAULT_VEIL = 52

/** Smallest accepted frost percentage. */
export const VEIL_MIN = 30

/** Largest accepted frost percentage. */
export const VEIL_MAX = 92

/** Largest source image accepted from the file picker (20 MB). */
export const MAX_CUSTOM_INPUT_BYTES = 20 * 1024 * 1024

/** Largest stored data URL; keeps the whole preference inside a typical 5 MB quota. */
export const MAX_CUSTOM_DATA_URL = 3_000_000

/** Longest file name kept for display. */
export const MAX_CUSTOM_NAME = 96

/**
 * Built-in wallpaper ids in display order. `build.mjs` generates the matching
 * artwork and fails the build when the two lists drift apart.
 */
export const BUILTIN_IDS = Object.freeze(['aurora', 'dune', 'tide', 'bloom', 'paper'])

/** Raster formats the picker and the encoder accept. */
export const SUPPORTED_MIME_TYPES = Object.freeze([
  'image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif',
])

const SUPPORTED_MIME = new Set(SUPPORTED_MIME_TYPES)

/** Strict data URL shape accepted from storage, so a tampered value cannot inject CSS. */
const CUSTOM_DATA_URL = /^data:image\/(?:png|jpeg|webp|gif|avif);base64,[A-Za-z0-9+/]+={0,2}$/u

/**
 * Whether a value names one of the built-in wallpapers.
 * @param value - candidate id.
 * @returns true for a known built-in id.
 */
export function isBuiltinId(value) {
  return typeof value === 'string' && BUILTIN_IDS.includes(value)
}

/**
 * Fresh preference document.
 * @returns mutable copy of the defaults.
 */
export function defaultState() {
  return {
    version: STATE_VERSION,
    selection: { kind: 'builtin', id: DEFAULT_BUILTIN },
    veil: DEFAULT_VEIL,
    custom: null,
  }
}

/**
 * Validate and detach one custom image record.
 * @param value - stored custom image.
 * @returns normalized record, or null when unusable.
 */
export function normalizeCustom(value) {
  if (value === null || typeof value !== 'object') return null
  const dataUrl = typeof value.dataUrl === 'string' ? value.dataUrl : ''
  if (dataUrl.length > MAX_CUSTOM_DATA_URL || !CUSTOM_DATA_URL.test(dataUrl)) return null
  const name = typeof value.name === 'string'
    ? value.name.replace(/\s+/gu, ' ').trim().slice(0, MAX_CUSTOM_NAME)
    : ''
  const width = Number.isInteger(value.width) && value.width > 0 ? value.width : 0
  const height = Number.isInteger(value.height) && value.height > 0 ? value.height : 0
  const updatedAt = typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt)
    ? value.updatedAt
    : 0
  return { name, dataUrl, width, height, updatedAt }
}

/**
 * Normalize anything read from storage (or a caller) into a usable document.
 * Unknown keys are dropped; a broken selection falls back to the default.
 * @param value - parsed storage document.
 * @returns a complete preference document.
 */
export function normalizeState(value) {
  const base = defaultState()
  if (value === null || typeof value !== 'object') return base
  const custom = normalizeCustom(value.custom)
  const rawSelection = value.selection
  let selection = base.selection
  if (rawSelection !== null && typeof rawSelection === 'object') {
    if (rawSelection.kind === 'builtin' && isBuiltinId(rawSelection.id)) {
      selection = { kind: 'builtin', id: rawSelection.id }
    } else if (rawSelection.kind === 'custom' && custom !== null) {
      selection = { kind: 'custom' }
    }
  }
  const veil = typeof value.veil === 'number' && Number.isFinite(value.veil)
    ? Math.min(VEIL_MAX, Math.max(VEIL_MIN, Math.round(value.veil)))
    : DEFAULT_VEIL
  return { version: STATE_VERSION, selection, veil, custom }
}

/**
 * Parse the raw localStorage string.
 * @param raw - stored string, or null when absent.
 * @returns the normalized document; defaults on any failure.
 */
export function parseStored(raw) {
  if (typeof raw !== 'string' || raw === '') return defaultState()
  try {
    return normalizeState(JSON.parse(raw))
  } catch {
    return defaultState()
  }
}

/**
 * Serialize one document for localStorage.
 * @param state - current document.
 * @returns compact JSON.
 */
export function serializeState(state) {
  return JSON.stringify(normalizeState(state))
}

/**
 * Select a built-in wallpaper.
 * @param state - current document.
 * @param id - built-in id.
 * @returns updated document (unchanged for an unknown id).
 */
export function setBuiltin(state, id) {
  if (!isBuiltinId(id)) return state
  return { ...state, selection: { kind: 'builtin', id } }
}

/**
 * Select the stored custom image.
 * @param state - current document.
 * @returns updated document (unchanged when no custom image exists).
 */
export function selectCustom(state) {
  if (state.custom === null) return state
  return { ...state, selection: { kind: 'custom' } }
}

/**
 * Change the surface frost percentage.
 * @param state - current document.
 * @param value - requested percentage; clamped and rounded.
 * @returns updated document.
 */
export function setVeil(state, value) {
  const veil = Math.min(VEIL_MAX, Math.max(VEIL_MIN, Math.round(Number(value) || DEFAULT_VEIL)))
  return { ...state, veil }
}

/**
 * Store a freshly processed image and select it.
 * @param state - current document.
 * @param custom - processed image record.
 * @returns updated document, or the original one when the record is invalid.
 */
export function setCustom(state, custom) {
  const normalized = normalizeCustom(custom)
  if (normalized === null) return state
  return { ...state, custom: normalized, selection: { kind: 'custom' } }
}

/**
 * Forget the custom image, returning to the default built-in when it was selected.
 * @param state - current document.
 * @returns updated document.
 */
export function removeCustom(state) {
  const wasCustom = state.selection.kind === 'custom'
  return {
    ...state,
    custom: null,
    selection: wasCustom ? { kind: 'builtin', id: DEFAULT_BUILTIN } : state.selection,
  }
}

/**
 * Whether the current selection is the custom image.
 * @param state - current document.
 * @returns true when the custom image is in use.
 */
export function usesCustom(state) {
  return state.selection.kind === 'custom' && state.custom !== null
}

/**
 * Whether the picker should accept this file before decoding it.
 * @param file - File-like object with `type` and `size`.
 * @returns `'type'`, `'size'`, or null when accepted.
 */
export function validateCustomFile(file) {
  if (file === null || typeof file !== 'object') return 'type'
  if (!SUPPORTED_MIME.has(file.type)) return 'type'
  if (typeof file.size === 'number' && file.size > MAX_CUSTOM_INPUT_BYTES) return 'size'
  return null
}
