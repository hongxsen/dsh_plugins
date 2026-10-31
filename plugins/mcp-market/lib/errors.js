/**
 * Stable error envelope shared by the MCP Market Host routes.
 *
 * Domain failures carry one of the `mcp/*` codes from the plugin contract and a
 * short human-readable message. The message is never a stack trace and never
 * contains a secret value; the browser localizes the code and only falls back
 * to the message for diagnostics.
 */

/** A failure that is safe to expose to the browser. */
export class ApiError extends Error {
  /**
   * @param code stable machine-readable code, for example `mcp/not-found`.
   * @param message short English diagnostic; no stack, no secrets.
   * @param status HTTP status code.
   * @param details optional structured detail for the UI.
   */
  constructor(code, message, status = 400, details = undefined) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    if (details !== undefined) this.details = details
  }
}

/** Build a JSON error body. */
export function errorBody(code, message, details = undefined) {
  const error = { code, message }
  if (details !== undefined) error.details = details
  return { error }
}

/** Shorthand for one of the documented MCP error codes. */
export function mcpError(code, message, status = 400, details = undefined) {
  return new ApiError(`mcp/${code}`, message, status, details)
}

/** True when a value is a plain JSON object (not an array, not null). */
export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
