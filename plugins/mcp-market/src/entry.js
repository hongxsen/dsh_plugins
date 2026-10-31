/**
 * Browser entry: registers dictionaries, the stylesheet, the sidebar panel,
 * and the matching main-slot page.
 *
 * `build.mjs` concatenates this file after `model.mjs` and `ui.js`, so the
 * shared constants, the CSS, and the page factory are already in scope.
 */

/** Services required by the panel and its dictionaries. */
export const inject = ['slots', 'locale']

/**
 * Mount the MCP Market panel.
 * @param ctx - DSH client root context.
 */
export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, LOCALES), 'mcp-market: dictionaries')
  const t = ctx.locale.bind(NS)

  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = '@hongxsen/dsh-mcp-market'
    style.textContent = MCP_CSS
    document.head.appendChild(style)
    return () => { style.remove() }
  }, 'mcp-market: styles')

  const page = createMcpMarketPage(t)

  ctx.slots.inject('main', function* () {
    yield ctx.slots.register({
      name: 'main',
      key: PANEL_ID,
      locale: NS,
    }, page)
  })

  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 21,
    label: () => t('panel'),
    locale: NS,
  }, McpMarketPanelIcon))
}
