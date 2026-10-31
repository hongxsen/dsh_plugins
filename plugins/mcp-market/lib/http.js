/**
 * HTTP wiring for `/dsh-mcp-market/api/*`.
 *
 * The handler is a plain `(req, res)` callback with no DSH dependency beyond
 * the injected service, so its validation (origin, content type, body cap,
 * error envelope) can be exercised with small fake request/response objects in
 * tests.
 */
import { ApiError, errorBody, isPlainObject, mcpError } from './errors.js'

/** Route prefix registered with the DSH web server. */
export const ROUTE_PREFIX = '/dsh-mcp-market'

/** API path below the prefix. */
export const API_PREFIX = `${ROUTE_PREFIX}/api`

/** Request body ceiling. */
export const MAX_BODY_BYTES = 1024 * 1024

/** Header map used for every JSON response. */
const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
}

/** Dispatch table: `METHOD /path` to service method. */
const ROUTES = new Map([
  ['GET /api/health', 'health'],
  ['GET /api/sources', 'sources'],
  ['POST /api/sources', 'sourceAction'],
  ['GET /api/search', 'search'],
  ['GET /api/detail', 'detail'],
  ['POST /api/preview', 'preview'],
  ['POST /api/install', 'install'],
  ['GET /api/installed', 'installed'],
  ['POST /api/toggle', 'toggle'],
  ['POST /api/remove', 'remove'],
])

/** Write one JSON response. */
function sendJson(res, status, payload, extraHeaders = undefined) {
  if (res.writableEnded === true || res.headersSent === true) return
  const body = JSON.stringify(payload)
  const headers = {
    ...JSON_HEADERS,
    ...extraHeaders,
    'Content-Length': Buffer.byteLength(body),
  }
  res.writeHead(status, headers)
  res.end(body)
}

/** Write one JSON error envelope. */
function sendError(res, error) {
  const allow = error.details?.allow
  sendJson(
    res,
    error.status,
    errorBody(error.code, error.message, error.details),
    Array.isArray(allow) && allow.length > 0 ? { Allow: allow.join(', ') } : undefined,
  )
}

/** True when the request's Origin, if present, matches its Host. */
export function originAllowed(req) {
  const origin = req?.headers?.origin
  if (origin === undefined) return true
  const host = req?.headers?.host
  if (typeof origin !== 'string' || typeof host !== 'string' || host.length === 0) return false
  let originHost
  try {
    originHost = new URL(origin).host
  } catch {
    return false
  }
  return originHost.toLowerCase() === host.toLowerCase()
}

/**
 * Read a JSON body with a 1 MiB cap.
 *
 * @returns the parsed object; an empty body parses as `{}`.
 * @throws ApiError with `request/*` codes for transport-level failures.
 */
export async function readJsonBody(req) {
  const contentType = String(req?.headers?.['content-type'] ?? '')
  if (contentType.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new ApiError('request/unsupported-media-type', 'The request body must be application/json.', 415)
  }
  const declared = Number(req?.headers?.['content-length'])
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new ApiError('request/too-large', 'The request body is too large.', 413, { maxBytes: MAX_BODY_BYTES })
  }
  const chunks = []
  let size = 0
  try {
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.length
      if (size > MAX_BODY_BYTES) {
        throw new ApiError('request/too-large', 'The request body is too large.', 413, { maxBytes: MAX_BODY_BYTES })
      }
      chunks.push(buffer)
    }
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError('request/invalid-body', 'The request body could not be read.', 400)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim().length === 0) return {}
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new ApiError('request/invalid-json', 'The request body is not valid JSON.', 400)
  }
  if (!isPlainObject(parsed)) {
    throw new ApiError('request/invalid-body', 'The request body must be a JSON object.', 400)
  }
  return parsed
}

/** Normalize the request pathname for route lookup. */
function routePathOf(pathname) {
  if (pathname === ROUTE_PREFIX) return '/'
  if (!pathname.startsWith(`${ROUTE_PREFIX}/`)) return null
  const rest = pathname.slice(ROUTE_PREFIX.length).replace(/\/+$/u, '')
  return rest.length === 0 ? '/' : rest
}

/** Query parameter helper. */
function queryValue(url, name) {
  const value = url.searchParams.get(name)
  return value === null ? undefined : value
}

/**
 * Create the request handler.
 *
 * @param options.service - MCP Market service.
 * @param options.logger - optional logger; only messages, never bodies.
 * @returns an async `(req, res)` callback. Errors are always JSON.
 */
export function createRequestHandler({ service, logger } = {}) {
  if (service === undefined) throw new Error('mcp-market: a service is required')

  return async function handle(req, res) {
    try {
      if (!originAllowed(req)) {
        throw new ApiError('request/forbidden-origin', 'Cross-origin requests are not allowed.', 403)
      }
      let url
      try {
        url = new URL(req.url ?? '/', `http://${req.headers?.host ?? 'localhost'}`)
      } catch {
        throw new ApiError('request/invalid-url', 'The request URL is malformed.', 400)
      }
      const routePath = routePathOf(url.pathname)
      if (routePath === null) throw new ApiError('request/not-found', 'API endpoint not found.', 404)
      const method = typeof req.method === 'string' ? req.method.toUpperCase() : 'GET'
      const route = ROUTES.get(`${method} ${routePath}`)
      if (route === undefined) {
        const methods = [...ROUTES.keys()]
          .filter(key => key.endsWith(` ${routePath}`))
          .map(key => key.slice(0, key.indexOf(' ')))
        if (methods.length > 0) {
          throw new ApiError('request/method-not-allowed', 'The HTTP method is not allowed for this endpoint.', 405, {
            allow: methods,
          })
        }
        throw new ApiError('request/not-found', 'API endpoint not found.', 404)
      }

      if (method === 'POST' && (route === 'preview' || route === 'install' || route === 'toggle' || route === 'remove' || route === 'sourceAction')) {
        const body = await readJsonBody(req)
        switch (route) {
          case 'preview':
            return sendJson(res, 200, await service.preview(body.registryName, body.source))
          case 'install':
            return sendJson(res, 200, await service.install(body))
          case 'toggle':
            return sendJson(res, 200, await service.toggle(body))
          case 'remove':
            return sendJson(res, 200, await service.remove(body))
          case 'sourceAction':
            return sendJson(res, 200, await service.sourceAction(body))
          default:
            break
        }
      }

      switch (route) {
        case 'health':
          return sendJson(res, 200, await service.health())
        case 'sources':
          return sendJson(res, 200, await service.sources())
        case 'search':
          return sendJson(res, 200, await service.search(
            queryValue(url, 'q') ?? '',
            queryValue(url, 'cursor'),
            queryValue(url, 'source'),
          ))
        case 'detail': {
          const name = queryValue(url, 'name')
          if (typeof name !== 'string' || name.length === 0) {
            throw mcpError('invalid-entry', 'The registry name is required.', 400)
          }
          return sendJson(res, 200, await service.detail(name, queryValue(url, 'source')))
        }
        case 'installed':
          return sendJson(res, 200, await service.installed())
        default:
          throw new ApiError('request/not-found', 'API endpoint not found.', 404)
      }
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status >= 500) logger?.warn?.(`dsh-mcp-market: ${error.code}: ${error.message}`)
        if (res.writableEnded === true) return
        sendError(res, error)
        return
      }
      logger?.warn?.(`dsh-mcp-market: unexpected error: ${error?.message ?? 'unknown'}`)
      if (res.writableEnded === true) return
      sendJson(res, 500, errorBody('internal', 'Unexpected server error.'))
    }
  }
}
