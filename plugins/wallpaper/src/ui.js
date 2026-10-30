/**
 * Browser half of the wallpaper plugin: the Settings → Wallpaper section.
 *
 * The component renders the built-in catalog, the custom-image card, and the
 * surface-frost control. Every mutation goes through the controller in
 * `entry.js`; this file only renders state and forwards actions.
 */

/** Locale dictionaries registered under `settings.wallpaper`. */
const SETTINGS_LOCALES = {
  zh: {
    nav: '壁纸',
    title: '壁纸',
    intro: '选择一张壁纸铺在界面背后。界面会变成磨砂玻璃，让壁纸透出来；深浅色会自动切换对应的画。',
    builtinTitle: '内置壁纸',
    'builtin.aurora': '极光',
    'builtin.dune': '沙丘',
    'builtin.tide': '潮汐',
    'builtin.bloom': '花间',
    'builtin.paper': '素纸',
    inUse: '使用中',
    customTitle: '自定义壁纸',
    customEmpty: '使用你自己的图片作为壁纸',
    customHint: '支持 JPG、PNG、WebP、AVIF、GIF，最大 20 MB。图片会在本机压缩后保存，不上传服务器，也不会同步到其他设备。',
    customChoose: '选择图片',
    customReplace: '更换图片',
    customUse: '使用这张壁纸',
    customRemove: '移除',
    customRemoveConfirm: '确定移除',
    customCancel: '取消',
    customProcessing: '正在处理图片…',
    customUnnamed: '自定义图片',
    veilTitle: '界面磨砂强度',
    veilHint: '数值越大，界面越不透明，壁纸越淡；越小，壁纸越清晰。',
    veilClear: '更透出壁纸',
    veilSolid: '界面更实',
    privacy: '壁纸选择保存在当前浏览器中。',
    errorType: '请选择 JPG、PNG、WebP、AVIF 或 GIF 图片。',
    errorSize: '图片不能超过 20 MB。',
    errorDecode: '这张图片无法读取，请换一张试试。',
    errorLarge: '图片压缩后仍然太大，请换一张尺寸更小的图片。',
    errorStorage: '浏览器存储空间不足，图片没有保存。请换一张更小的图片，或先清理站点数据。',
    errorUnknown: '保存壁纸时出错了，请重试。',
  },
  en: {
    nav: 'Wallpaper',
    title: 'Wallpaper',
    intro: 'Choose an image to sit behind the interface. Surfaces turn into frosted glass so the wallpaper shows through, and the light and dark variants follow the current appearance.',
    builtinTitle: 'Built-in wallpapers',
    'builtin.aurora': 'Aurora',
    'builtin.dune': 'Dune',
    'builtin.tide': 'Tide',
    'builtin.bloom': 'Bloom',
    'builtin.paper': 'Paper',
    inUse: 'In use',
    customTitle: 'Custom wallpaper',
    customEmpty: 'Use one of your own images as the wallpaper',
    customHint: 'JPG, PNG, WebP, AVIF, or GIF up to 20 MB. The image is compressed and stored in this browser only; it is never uploaded or synced to other devices.',
    customChoose: 'Choose image',
    customReplace: 'Replace image',
    customUse: 'Use this wallpaper',
    customRemove: 'Remove',
    customRemoveConfirm: 'Remove image',
    customCancel: 'Cancel',
    customProcessing: 'Processing image…',
    customUnnamed: 'Custom image',
    veilTitle: 'Surface frost',
    veilHint: 'Higher values make surfaces more opaque and the wallpaper fainter; lower values show more of the image.',
    veilClear: 'More wallpaper',
    veilSolid: 'More solid',
    privacy: 'Wallpaper choices are stored in this browser.',
    errorType: 'Choose a JPG, PNG, WebP, AVIF, or GIF image.',
    errorSize: 'The image must be 20 MB or smaller.',
    errorDecode: 'This image could not be read. Try another one.',
    errorLarge: 'The image is still too large after compression. Try a smaller one.',
    errorStorage: 'Browser storage is full, so the image was not saved. Try a smaller image or clear this site’s data.',
    errorUnknown: 'Saving the wallpaper failed. Try again.',
  },
}

/** Upload failures mapped to locale keys. */
const ERROR_KEYS = {
  type: 'errorType',
  size: 'errorSize',
  decode: 'errorDecode',
  large: 'errorLarge',
  storage: 'errorStorage',
}

/** Section styles, injected once by the entry and removed on dispose. */
const SETTINGS_CSS = `
.dshwp-section {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 720px;
  color: var(--dsw-alias-label-primary);
}
.dshwp-title {
  margin: 0;
  font-size: 16px;
  line-height: 24px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}
.dshwp-intro {
  margin: -4px 0 0;
  font-size: 14px;
  line-height: 22px;
  color: var(--dsw-alias-label-tertiary);
}
.dshwp-groupTitle {
  margin-top: 2px;
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
  color: var(--dsw-alias-label-secondary);
}
.dshwp-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 10px;
}
.dshwp-card {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 6px 6px 8px;
  border: 1px solid transparent;
  border-radius: var(--dsw-radius-lg);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
@media (hover: hover) {
  .dshwp-card:hover { background: var(--dsw-alias-interactive-bg-hover); }
}
.dshwp-card[aria-pressed='true'] {
  border-color: var(--dsw-alias-brand-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}
.dshwp-card:focus-visible,
.dshwp-btn:focus-visible,
.dshwp-range:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}
.dshwp-thumb {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 16 / 10;
  overflow: hidden;
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: inset 0 0 0 0.5px var(--dsw-alias-border-l2);
}
.dshwp-thumb img {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.dshwp-thumb img.dshwp-thumbDark { display: none; }
body[data-ds-dark-theme] .dshwp-thumb img.dshwp-thumbLight { display: none; }
body[data-ds-dark-theme] .dshwp-thumb img.dshwp-thumbDark { display: block; }
.dshwp-badge {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 1;
  padding: 0 7px;
  border-radius: 999px;
  background: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-label-primary-inverted);
  font-size: 10.5px;
  line-height: 18px;
  font-weight: 500;
}
.dshwp-name {
  overflow: hidden;
  padding: 0 2px;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 19px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dshwp-card[aria-pressed='true'] .dshwp-name {
  color: var(--dsw-alias-label-primary);
  font-weight: 500;
}
.dshwp-custom {
  box-sizing: border-box;
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr);
  gap: 14px;
  padding: 12px;
  border: 0.5px solid var(--dsw-alias-settings-card-stroke);
  border-radius: var(--dsw-radius-xl);
  background: var(--dsw-alias-settings-card-fill);
}
.dshwp-custom[data-selected='true'] { border-color: var(--dsw-alias-brand-primary); }
.dshwp-custom[data-dragging='true'] {
  border-color: var(--dsw-alias-brand-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}
.dshwp-customThumb {
  position: relative;
  display: grid;
  place-items: center;
  width: 100%;
  aspect-ratio: 16 / 10;
  overflow: hidden;
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: inset 0 0 0 0.5px var(--dsw-alias-border-l2);
}
.dshwp-customThumb img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.dshwp-customPlaceholder {
  color: var(--dsw-alias-label-tertiary);
  font-size: 24px;
  line-height: 1;
}
.dshwp-customBody {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.dshwp-customHead {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}
.dshwp-customTitle {
  font-size: 14px;
  line-height: 22px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}
.dshwp-customMeta {
  overflow: hidden;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dshwp-active {
  flex: none;
  padding: 0 7px;
  border-radius: 999px;
  background: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-label-primary-inverted);
  font-size: 10.5px;
  line-height: 18px;
  font-weight: 500;
}
.dshwp-hint {
  margin: 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
}
.dshwp-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.dshwp-btn {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 30px;
  padding: 0 11px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-md);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  cursor: pointer;
}
@media (hover: hover) {
  .dshwp-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
}
.dshwp-btn:disabled { opacity: 0.5; cursor: default; }
.dshwp-btnPrimary {
  border-color: transparent;
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
}
@media (hover: hover) {
  .dshwp-btnPrimary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
}
.dshwp-btnDanger {
  border-color: transparent;
  background: transparent;
  color: var(--dsw-alias-state-error-primary);
}
@media (hover: hover) {
  .dshwp-btnDanger:hover:not(:disabled) {
    background: var(--dsw-alias-interactive-bg-hover-danger, rgba(198, 40, 40, 0.1));
  }
}
.dshwp-status {
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
}
.dshwp-error {
  color: var(--dsw-alias-state-error-primary);
  font-size: 12px;
  line-height: 18px;
}
.dshwp-frost {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border: 0.5px solid var(--dsw-alias-settings-card-stroke);
  border-radius: var(--dsw-radius-xl);
  background: var(--dsw-alias-settings-card-fill);
}
.dshwp-frostHead {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.dshwp-frostValue {
  flex: none;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 20px;
  font-variant-numeric: tabular-nums;
}
.dshwp-range {
  box-sizing: border-box;
  width: 100%;
  height: 20px;
  margin: 0;
  accent-color: var(--dsw-alias-brand-primary);
  cursor: pointer;
}
.dshwp-scale {
  display: flex;
  justify-content: space-between;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
}
.dshwp-note {
  margin: 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11.5px;
  line-height: 17px;
}
.dshwp-fileInput {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
@media (max-width: 560px) {
  .dshwp-custom { grid-template-columns: minmax(0, 1fr); }
}
`

/**
 * Subscribe to the wallpaper controller.
 * @param wallpaper - controller exposed by the entry.
 * @returns the current preference document.
 */
function useWallpaperSnapshot(wallpaper) {
  const [state, setState] = React.useState(() => wallpaper.getState())
  React.useEffect(() => {
    setState(wallpaper.getState())
    return wallpaper.subscribe(() => { setState(wallpaper.getState()) })
  }, [wallpaper])
  return state
}

/**
 * Render one locale error key for a failed upload.
 * @param t - translate seat.
 * @param error - thrown upload error.
 * @returns the translated message.
 */
function uploadErrorMessage(t, error) {
  const code = error !== null && typeof error === 'object' ? error.code : undefined
  return t(ERROR_KEYS[code] ?? 'errorUnknown')
}

/**
 * Build the Settings section component for one controller.
 * @param wallpaper - controller exposed by the entry.
 * @returns the component registered into `settings.section`.
 */
function createWallpaperSection(wallpaper) {
  /**
   * Settings → Wallpaper page.
   * @param props - locale seat supplied by the slot renderer.
   * @returns the section element tree.
   */
  function WallpaperSection({ t }) {
    const state = useWallpaperSnapshot(wallpaper)
    const [busy, setBusy] = React.useState(false)
    const [error, setError] = React.useState(null)
    const [dragging, setDragging] = React.useState(false)
    const [confirmRemove, setConfirmRemove] = React.useState(false)
    const inputRef = React.useRef(null)
    const custom = state.custom
    const customSelected = state.selection.kind === 'custom'
    const artworks = wallpaper.artworks

    const openPicker = () => {
      if (busy) return
      setConfirmRemove(false)
      setError(null)
      inputRef.current?.click()
    }

    const acceptFile = async (file) => {
      if (file === undefined || file === null || busy) return
      setBusy(true)
      setError(null)
      setConfirmRemove(false)
      try {
        await wallpaper.setCustomFile(file)
      } catch (failure) {
        setError(uploadErrorMessage(t, failure))
      } finally {
        setBusy(false)
      }
    }

    const onInputChange = (event) => {
      const file = event.currentTarget.files?.[0]
      event.currentTarget.value = ''
      void acceptFile(file)
    }

    const onDrop = (event) => {
      event.preventDefault()
      setDragging(false)
      void acceptFile(event.dataTransfer?.files?.[0])
    }

    return React.createElement('div', { className: 'dshwp-section', 'data-dsh-wallpaper-settings': '' },
      React.createElement('h2', { className: 'dshwp-title' }, t('title')),
      React.createElement('p', { className: 'dshwp-intro' }, t('intro')),
      React.createElement('div', { className: 'dshwp-groupTitle' }, t('builtinTitle')),
      React.createElement('div', { className: 'dshwp-grid', role: 'group', 'aria-label': t('builtinTitle') },
        artworks.map(art => React.createElement('button', {
          key: art.id,
          type: 'button',
          className: 'dshwp-card',
          'aria-pressed': state.selection.kind === 'builtin' && state.selection.id === art.id,
          'aria-label': t(`builtin.${art.id}`),
          onClick: () => { wallpaper.setBuiltin(art.id) },
        },
        React.createElement('span', { className: 'dshwp-thumb' },
          React.createElement('img', { className: 'dshwp-thumbLight', src: art.light, alt: '', draggable: false }),
          React.createElement('img', { className: 'dshwp-thumbDark', src: art.dark, alt: '', draggable: false }),
          state.selection.kind === 'builtin' && state.selection.id === art.id
            ? React.createElement('span', { className: 'dshwp-badge' }, t('inUse'))
            : null,
        ),
        React.createElement('span', { className: 'dshwp-name' }, t(`builtin.${art.id}`))),
        ),
      ),
      React.createElement('div', {
        className: 'dshwp-custom',
        'data-selected': customSelected ? 'true' : undefined,
        'data-dragging': dragging ? 'true' : undefined,
        onDragOver: (event) => {
          if (!event.dataTransfer?.types?.includes('Files')) return
          event.preventDefault()
          setDragging(true)
        },
        onDragLeave: (event) => {
          if (event.currentTarget.contains(event.relatedTarget)) return
          setDragging(false)
        },
        onDrop,
      },
      React.createElement('div', { className: 'dshwp-customThumb' },
        custom !== null
          ? React.createElement('img', { src: custom.dataUrl, alt: '', draggable: false })
          : React.createElement('span', { className: 'dshwp-customPlaceholder', 'aria-hidden': 'true' }, '+'),
      ),
      React.createElement('div', { className: 'dshwp-customBody' },
        React.createElement('div', { className: 'dshwp-customHead' },
          React.createElement('div', { style: { minWidth: 0 } },
            React.createElement('div', { className: 'dshwp-customTitle' }, t('customTitle')),
            React.createElement('div', { className: 'dshwp-customMeta' },
              custom === null
                ? t('customEmpty')
                : `${custom.name === '' ? t('customUnnamed') : custom.name} · ${custom.width}×${custom.height}`,
            ),
          ),
          customSelected ? React.createElement('span', { className: 'dshwp-active' }, t('inUse')) : null,
        ),
        React.createElement('p', { className: 'dshwp-hint' }, t('customHint')),
        React.createElement('div', { className: 'dshwp-actions' },
          custom !== null && !customSelected
            ? React.createElement('button', {
              type: 'button',
              className: 'dshwp-btn dshwp-btnPrimary',
              onClick: () => { wallpaper.useCustom() },
            }, t('customUse'))
            : null,
          React.createElement('button', {
            type: 'button',
            className: 'dshwp-btn',
            disabled: busy,
            onClick: openPicker,
          }, custom === null ? t('customChoose') : t('customReplace')),
          custom !== null
            ? (confirmRemove
              ? React.createElement(React.Fragment, null,
                React.createElement('button', {
                  type: 'button',
                  className: 'dshwp-btn dshwp-btnDanger',
                  disabled: busy,
                  onClick: () => {
                    wallpaper.removeCustom()
                    setConfirmRemove(false)
                    setError(null)
                  },
                }, t('customRemoveConfirm')),
                React.createElement('button', {
                  type: 'button',
                  className: 'dshwp-btn',
                  onClick: () => { setConfirmRemove(false) },
                }, t('customCancel')),
              )
              : React.createElement('button', {
                type: 'button',
                className: 'dshwp-btn dshwp-btnDanger',
                disabled: busy,
                onClick: () => { setConfirmRemove(true) },
              }, t('customRemove')))
            : null,
        ),
        busy ? React.createElement('div', { className: 'dshwp-status', 'aria-live': 'polite' }, t('customProcessing')) : null,
        error === null ? null : React.createElement('div', { className: 'dshwp-error', role: 'alert' }, error),
      ),
      React.createElement('input', {
        ref: inputRef,
        type: 'file',
        className: 'dshwp-fileInput',
        accept: 'image/jpeg,image/png,image/webp,image/avif,image/gif',
        tabIndex: -1,
        'aria-hidden': 'true',
        onChange: onInputChange,
      }),
      ),
      React.createElement('div', { className: 'dshwp-frost' },
        React.createElement('div', { className: 'dshwp-frostHead' },
          React.createElement('div', null,
            React.createElement('div', { className: 'dshwp-customTitle' }, t('veilTitle')),
            React.createElement('p', { className: 'dshwp-hint' }, t('veilHint')),
          ),
          React.createElement('span', { className: 'dshwp-frostValue' }, `${state.veil}%`),
        ),
        React.createElement('input', {
          type: 'range',
          className: 'dshwp-range',
          min: VEIL_MIN,
          max: VEIL_MAX,
          step: 2,
          value: state.veil,
          'aria-label': t('veilTitle'),
          onChange: (event) => { wallpaper.setVeil(Number(event.currentTarget.value)) },
        }),
        React.createElement('div', { className: 'dshwp-scale' },
          React.createElement('span', null, t('veilClear')),
          React.createElement('span', null, t('veilSolid')),
        ),
      ),
      React.createElement('p', { className: 'dshwp-note' }, t('privacy')),
    )
  }
  WallpaperSection.displayName = 'WallpaperSection'
  return WallpaperSection
}
