/**
 * Browser entry for the skills market.
 *
 * The build script wraps this file together with `model.mjs` and `ui.js` into
 * the `window.__ModuleLoader__.load` factory. The entry only wires services:
 * dictionaries, the stylesheet, the sidebar glyph, and the full-page main slot.
 */

/** Services the page and sidebar registration need. */
export const inject = ['slots', 'locale']

/**
 * Mount the sidebar entry and the page it opens.
 * @param ctx - client root context.
 */
export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(MARKET_NS, LOCALES), 'skills-market: dictionaries')
  const t = ctx.locale.bind(MARKET_NS)

  ctx.effect(() => {
    if (typeof document === 'undefined') return undefined
    const style = document.createElement('style')
    style.dataset.plugin = '@hongxsen/dsh-skills-market'
    style.textContent = MARKET_CSS
    document.head.appendChild(style)
    return () => { style.remove() }
  }, 'skills-market: styles')

  const api = createApiClient()
  const page = createMarketPage({
    api,
    fallbackT: t,
    getLocale: () => ctx.locale.getSnapshot().active,
  })

  ctx.slots.inject('main', function* () {
    yield ctx.slots.register({
      name: 'main',
      key: PANEL_ID,
      locale: MARKET_NS,
    }, page)
  })

  ctx.slots.inject('sidebar.panellist', function* () {
    yield ctx.slots.register({
      name: 'sidebar.panellist',
      id: PANEL_ID,
      order: 20,
      label: () => t('panel'),
      locale: MARKET_NS,
    }, PanelIcon)
  })
}
