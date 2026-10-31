/**
 * Host half of the MCP Market bundle.
 *
 * Registers one prefix route. All catalog and install behavior lives in
 * `lib/`, split into pure builders (`config`, `yaml`, `registry`) and the
 * context-bound service, so the plugin remains testable without a live DSH.
 */
import { createRequestHandler, ROUTE_PREFIX } from './lib/http.js'
import { createMarketService } from './lib/service.js'

/** Short plugin name reported by Loader diagnostics. */
export const name = 'mcp-market'

/** The Host service this plugin needs. */
export const inject = ['webServer']

/**
 * Register `/dsh-mcp-market/api/*` for the lifetime of the plugin.
 * @param ctx - DSH host context.
 */
export function apply(ctx) {
  const service = createMarketService({ ctx, logger: ctx.logger })
  const handler = createRequestHandler({ service, logger: ctx.logger })
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler }),
    'mcp-market: routes',
  )
}
