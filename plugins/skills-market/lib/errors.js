/**
 * Stable error codes for the skills market.
 *
 * Every failure leaves the Host as `{ error: { code, message, details? } }`.
 * The browser maps `code` to a localized sentence; it never renders the
 * server message directly, so raw GitHub/catalog text cannot reach the DOM.
 */

/** Error raised by the market pipeline with a stable public code. */
export class MarketError extends Error {
  /**
   * @param code - stable code returned to the client.
   * @param message - short English description for logs and API details.
   * @param details - optional structured context, safe to expose.
   */
  constructor(code, message, details) {
    super(message)
    this.name = 'MarketError'
    this.code = code
    if (details !== undefined) this.details = details
  }
}

/** HTTP status per public code. */
export const ERROR_STATUS = Object.freeze({
  'skills/invalid-query': 400,
  'skills/fetch-failed': 502,
  'skills/not-found': 404,
  'skills/invalid-skill': 400,
  'skills/invalid-path': 400,
  'skills/too-large': 413,
  'skills/exists': 409,
  'skills/not-managed': 403,
  'skills/staging-expired': 410,
  'skills/install-failed': 500,
  'sources/invalid': 400,
  'sources/limit': 409,
  'sources/not-found': 404,
  'sources/builtin': 403,
  'sources/fetch-failed': 502,
  'sources/invalid-index': 400,
  'request/forbidden-origin': 403,
  'request/unsupported-media-type': 415,
  'request/body-too-large': 413,
  'request/invalid-json': 400,
  'request/not-found': 404,
  'request/method-not-allowed': 405,
  'internal/error': 500,
})

/**
 * Return whether a value is a market error.
 * @param value - candidate.
 * @returns whether the value carries a public market code.
 */
export function isMarketError(value) {
  return value instanceof MarketError
}

/**
 * Resolve the HTTP status for a code.
 * @param code - public code.
 * @returns the status, defaulting to 500.
 */
export function statusForCode(code) {
  return ERROR_STATUS[code] ?? 500
}

/**
 * Convert any thrown value into the stable error body.
 * @param error - thrown value.
 * @returns the API payload, never containing a stack trace.
 */
export function toErrorPayload(error) {
  if (isMarketError(error)) {
    const payload = { code: error.code, message: error.message }
    if (error.details !== undefined) payload.details = error.details
    return { error: payload }
  }
  return { error: { code: 'internal/error', message: 'Unexpected error' } }
}

/** Request-level error codes, kept out of the skills/ namespace. */
export const REQUEST_ERRORS = Object.freeze({
  forbiddenOrigin: 'request/forbidden-origin',
  unsupportedMediaType: 'request/unsupported-media-type',
  bodyTooLarge: 'request/body-too-large',
  invalidJson: 'request/invalid-json',
  notFound: 'request/not-found',
  methodNotAllowed: 'request/method-not-allowed',
})
