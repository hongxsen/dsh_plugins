/**
 * Host half of the skills market bundle.
 *
 * The Loader row exists so the plugin can be toggled like any other; all work
 * happens on the prefix route. The route handler is a plain
 * `(IncomingMessage, ServerResponse)` callback, and every service dependency
 * is injected so the pipeline can be tested without a live DSH context.
 */
import { ROUTE_PREFIX } from './lib/constants.js'
import { resolveDshHome } from './lib/paths.js'
import { createRouteHandler } from './lib/routes.js'
import { createSkillsMarket } from './lib/skills.js'

/** Stable Cordis plugin name. */
export const name = 'skills-market'

/** The prefix route needs the Host web server. */
export const inject = ['webServer']

/**
 * Mount `/dsh-skills-market`.
 * @param ctx - Host plugin context.
 */
export function apply(ctx) {
  const service = createSkillsMarket({
    resolveHome: () => resolveDshHome(undefined, process.env),
  })
  const handler = createRouteHandler({ service })
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler }),
    'skills-market: http routes',
  )
}
