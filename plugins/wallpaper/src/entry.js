/**
 * Wallpaper browser entry: paints the selected artwork, persists the choice,
 * and registers the Settings → Wallpaper section.
 *
 * The artwork data is injected by `build.mjs` as `WALLPAPER_ART`, because a
 * browser plugin stylesheet cannot resolve package-relative asset URLs. The
 * custom image and the selection live in localStorage: they are browser-local
 * by design, and a multi-megabyte photo must not enter the Host settings
 * document.
 */

/** Locale namespace owned by this plugin. */
const SETTINGS_NS = 'settings.wallpaper'

/** Marker attribute that switches the wallpaper stylesheet on. */
const BODY_ATTRIBUTE = 'data-dsh-wallpaper'

/** Custom-property names painted on `body` and restored on dispose. */
const BODY_PROPERTIES = Object.freeze([
  '--dsh-wallpaper-image-light',
  '--dsh-wallpaper-image-dark',
  '--dsh-wallpaper-surface-light',
  '--dsh-wallpaper-surface-dark',
  '--dsh-wallpaper-fallback-light',
  '--dsh-wallpaper-fallback-dark',
  '--dsh-wallpaper-veil-user',
])

/** Surface and fallback colors for a user image. */
const CUSTOM_SURFACES = Object.freeze({
  surfaceLight: '#ffffff',
  surfaceDark: '#0f1319',
  fallbackLight: '#f7f9fc',
  fallbackDark: '#0b0e14',
})

/**
 * The wallpaper stylesheet. `--dsw-alias-bg-base` is redefined as a
 * translucent tint of the surface color, so every container that repaints the
 * document background turns into frosted glass instead of an opaque sheet.
 * Menus, tooltips and toasts keep their own opaque tokens.
 */
const WALLPAPER_CSS = `
body[data-dsh-wallpaper] {
  --dsh-wallpaper-image: var(--dsh-wallpaper-image-light);
  --dsh-wallpaper-surface: var(--dsh-wallpaper-surface-light);
  --dsh-wallpaper-fallback: var(--dsh-wallpaper-fallback-light);
  --dsh-wallpaper-veil: var(--dsh-wallpaper-veil-user, 52%);
  background-color: var(--dsh-wallpaper-fallback) !important;
  background-image: var(--dsh-wallpaper-image) !important;
  background-position: center center !important;
  background-size: cover !important;
  background-repeat: no-repeat !important;
  background-attachment: fixed !important;
  --dsw-alias-bg-base: color-mix(in srgb, var(--dsh-wallpaper-surface) var(--dsh-wallpaper-veil), transparent) !important;
}
body[data-ds-dark-theme][data-dsh-wallpaper] {
  --dsh-wallpaper-image: var(--dsh-wallpaper-image-dark);
  --dsh-wallpaper-surface: var(--dsh-wallpaper-surface-dark);
  --dsh-wallpaper-fallback: var(--dsh-wallpaper-fallback-dark);
}
/* Keep the wallpaper, but make every surface nearly opaque for users who ask
   the system for less transparency. */
@media (prefers-reduced-transparency: reduce) {
  body[data-dsh-wallpaper] { --dsh-wallpaper-veil: 92%; }
}
`

/**
 * Read the stored document without letting a disabled storage area break boot.
 * @returns the normalized preference.
 */
function readState() {
  try {
    return parseStored(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    return defaultState()
  }
}

/**
 * Write the document, reporting a full or unavailable storage area.
 * @param state - document to store.
 * @returns true when localStorage accepted the write.
 */
function writeState(state) {
  try {
    window.localStorage.setItem(STORAGE_KEY, serializeState(state))
    return true
  } catch {
    return false
  }
}

/**
 * Resolve the artwork currently in use.
 * @param state - current preference.
 * @returns artwork colors and the two scheme-specific image values.
 */
function artworkFor(state) {
  if (usesCustom(state)) {
    return {
      imageLight: `url("${state.custom.dataUrl}")`,
      // Both schemes use the same photo; referencing the light value keeps the
      // multi-megabyte data URL out of a second custom property.
      imageDark: 'var(--dsh-wallpaper-image-light)',
      ...CUSTOM_SURFACES,
    }
  }
  const selected = WALLPAPER_ART.find(entry => entry.id === state.selection.id) ?? WALLPAPER_ART[0]
  return {
    imageLight: `url("${selected.light}")`,
    imageDark: `url("${selected.dark}")`,
    surfaceLight: selected.surfaceLight,
    surfaceDark: selected.surfaceDark,
    fallbackLight: selected.fallbackLight,
    fallbackDark: selected.fallbackDark,
  }
}

/**
 * Create the preference controller shared by the renderer and the Settings UI.
 * @returns the state accessors, mutations, and the paint routine.
 */
function createWallpaperController() {
  let state = readState()
  const listeners = new Set()

  const notify = () => {
    for (const listener of listeners) listener()
  }

  const paint = () => {
    const body = document.body
    if (body === null) return
    const artwork = artworkFor(state)
    body.setAttribute(BODY_ATTRIBUTE, '')
    body.style.setProperty('--dsh-wallpaper-image-light', artwork.imageLight)
    body.style.setProperty('--dsh-wallpaper-image-dark', artwork.imageDark)
    body.style.setProperty('--dsh-wallpaper-surface-light', artwork.surfaceLight)
    body.style.setProperty('--dsh-wallpaper-surface-dark', artwork.surfaceDark)
    body.style.setProperty('--dsh-wallpaper-fallback-light', artwork.fallbackLight)
    body.style.setProperty('--dsh-wallpaper-fallback-dark', artwork.fallbackDark)
    body.style.setProperty('--dsh-wallpaper-veil-user', `${state.veil}%`)
  }

  /**
   * Store, paint, and publish one document.
   * @param next - candidate document.
   * @param strict - reject the change when localStorage refuses it.
   * @returns false when the write failed.
   */
  const commit = (next, strict = false) => {
    if (next === state) return true
    const saved = writeState(next)
    if (!saved && strict) return false
    state = next
    paint()
    notify()
    return saved
  }

  return {
    artworks: WALLPAPER_ART,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    paint,
    reload() {
      state = readState()
      paint()
      notify()
    },
    setBuiltin(id) {
      commit(setBuiltin(state, id))
    },
    setVeil(value) {
      commit(setVeil(state, value))
    },
    useCustom() {
      commit(selectCustom(state))
    },
    removeCustom() {
      commit(removeCustom(state))
    },
    async setCustomFile(file) {
      const prepared = await prepareCustomWallpaper(file)
      if (!commit(setCustom(state, prepared), true)) throw coded('storage')
    },
  }
}

/** Required client services: the settings slot ledger and the dictionary registry. */
export const inject = ['slots', 'locale']

/**
 * Mount the wallpaper and its settings page.
 * @param ctx - client root context.
 */
export function apply(ctx) {
  const controller = createWallpaperController()
  const t = ctx.locale.bind(SETTINGS_NS)

  ctx.effect(() => ctx.locale.register(SETTINGS_NS, SETTINGS_LOCALES), 'wallpaper: settings dictionaries')

  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = '@hongxsen/dsh-wallpaper'
    style.textContent = WALLPAPER_CSS + SETTINGS_CSS
    document.head.appendChild(style)

    const body = document.body
    const previousAttribute = body.getAttribute(BODY_ATTRIBUTE)
    const previousProperties = new Map(
      BODY_PROPERTIES.map(name => [name, body.style.getPropertyValue(name)]),
    )
    controller.paint()

    const onStorage = (event) => {
      if (event.key !== STORAGE_KEY && event.key !== null) return
      controller.reload()
    }
    window.addEventListener('storage', onStorage)

    return () => {
      window.removeEventListener('storage', onStorage)
      for (const [name, value] of previousProperties) {
        if (value === '') body.style.removeProperty(name)
        else body.style.setProperty(name, value)
      }
      if (previousAttribute === null) body.removeAttribute(BODY_ATTRIBUTE)
      else body.setAttribute(BODY_ATTRIBUTE, previousAttribute)
      style.remove()
    }
  }, 'wallpaper: styles and painting')

  const WallpaperSection = createWallpaperSection(controller)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'wallpaper',
    order: 16,
    label: () => t('nav'),
    locale: SETTINGS_NS,
  }, WallpaperSection))
}
