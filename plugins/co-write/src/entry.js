/**
 * Co-write browser entry. The build script wraps this file together with
 * `core.mjs` and `ui.js` into the `window.__ModuleLoader__` factory in
 * `client.js`.
 */

/** Services the selection layer and the pending-review bar need. */
const inject = [
  'slots',
  'sessions',
  'conversation',
  'uiConversation',
  'locale',
]

/**
 * Mount selection comments and the inline review bar.
 * @param ctx - Client root context.
 */
function apply(ctx) {
  install(ctx, React)
}
