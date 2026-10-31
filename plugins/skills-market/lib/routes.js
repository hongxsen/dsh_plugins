/**
 * HTTP surface for the skills market.
 *
 * The handler is framework-free: `webServer.register({ kind: 'prefix' })`
 * hands it raw Node request/response objects. Route wiring is deliberately
 * separate from the market service so tests can drive either half.
 */
import { MAX_BODY_BYTES, ROUTE_PREFIX } from './constants.js'
import { MarketError, REQUEST_ERRORS, statusForCode, toErrorPayload } from './errors.js'

/** One route: exact path, one method, and the service call. */
const ROUTES = Object.freeze([
  {
    path: '/api/search',
    method: 'GET',
    handle: (service, request) => {
      const query = request.url.searchParams.get('q') ?? ''
      const source = request.url.searchParams.get('source')
      return source === null ? service.search(query) : service.search(query, source)
    },
  },
  {
    path: '/api/detail',
    method: 'GET',
    handle: (service, request) => {
      // `repo` is the documented parameter; `source` stays as a legacy alias.
      const repo = request.url.searchParams.get('repo')
        ?? request.url.searchParams.get('source')
        ?? ''
      const skill = request.url.searchParams.get('skill') ?? ''
      const market = request.url.searchParams.get('market')
      return market === null ? service.detail(repo, skill) : service.detail(repo, skill, market)
    },
  },
  {
    path: '/api/sources',
    method: 'GET',
    handle: (service) => service.sources(),
  },
  {
    path: '/api/sources',
    method: 'POST',
    handle: async (service, request) => {
      const body = await readJsonBody(request.req)
      if (body.action === 'add') {
        return service.addSource({ kind: body.kind, title: body.title, url: body.url })
      }
      if (body.action === 'remove') return service.removeSource(body.id)
      if (body.action === 'select') return service.selectSource(body.id)
      throw new MarketError('sources/invalid', 'Unknown source action', {
        action: typeof body.action === 'string' ? body.action.slice(0, 40) : null,
      })
    },
  },
  {
    path: '/api/preview',
    method: 'POST',
    handle: async (service, request) => {
      const body = await readJsonBody(request.req)
      return service.preview(body.source, body.skillId)
    },
  },
  {
    path: '/api/local/preview',
    method: 'POST',
    handle: async (service, request) => {
      const body = await readJsonBody(request.req)
      return service.previewLocal(body.path)
    },
  },
  {
    path: '/api/install',
    method: 'POST',
    handle: async (service, request) => {
      const body = await readJsonBody(request.req)
      return service.install({ token: body.token, replace: body.replace })
    },
  },
  {
    path: '/api/installed',
    method: 'GET',
    handle: (service) => service.installed(),
  },
  {
    path: '/api/remove',
    method: 'POST',
    handle: async (service, request) => {
      const body = await readJsonBody(request.req)
      return service.remove(body.name)
    },
  },
  {
    path: '/api/health',
    method: 'GET',
    handle: (service) => service.health(),
  },
])

/**
 * Normalize a request path to the route table (strip the mount prefix and a
 * trailing slash).
 * @param rawUrl - request URL, possibly including the route prefix.
 * @returns the local path, or `null` when the request is outside the mount.
 */
export function localPathOf(rawUrl) {
  let pathname
  try {
    pathname = new URL(rawUrl ?? '/', 'http://localhost').pathname
  } catch {
    return null
  }
  if (pathname === ROUTE_PREFIX) return '/'
  if (pathname.startsWith(`${ROUTE_PREFIX}/`)) {
    const local = pathname.slice(ROUTE_PREFIX.length).replace(/\/+$/u, '')
    return local === '' ? '/' : local
  }
  // Some server implementations strip the prefix before invoking the handler.
  if (pathname.startsWith('/api/')) return pathname.replace(/\/+$/u, '')
  return null
}

/**
 * Return whether a request Origin matches the Host header.
 * A missing Origin is allowed (same-origin navigations and curl).
 * @param origin - `Origin` header value.
 * @param host - `Host` header value.
 * @returns whether the request may proceed.
 */
export function sameOrigin(origin, host) {
  if (origin === undefined || origin === null || origin === '') return true
  if (typeof origin !== 'string' || typeof host !== 'string' || host === '') return false
  let parsed
  try {
    parsed = new URL(origin)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  return parsed.host.toLowerCase() === host.toLowerCase()
}

/**
 * Return whether a Content-Type header carries JSON.
 * @param value - header value.
 * @returns whether POST bodies may be parsed as JSON.
 */
export function isJsonContentType(value) {
  if (typeof value !== 'string') return false
  const [type] = value.split(';', 1)
  return type !== undefined && type.trim().toLowerCase() === 'application/json'
}

/**
 * Read a request body with a hard cap.
 * @param req - Node IncomingMessage.
 * @param limit - maximum bytes.
 * @returns the body buffer.
 * @throws MarketError `request/body-too-large` or `request/invalid-json`.
 */
export function readBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers?.['content-length'])
    if (Number.isFinite(declared) && declared > limit) {
      reject(new MarketError(REQUEST_ERRORS.bodyTooLarge, 'Request body is too large', { limit }))
      req.resume?.()
      return
    }
    const chunks = []
    let total = 0
    let settled = false
    const cleanup = () => {
      req.off('data', onData)
      req.off('end', onEnd)
      req.off('error', onError)
    }
    const fail = (error) => {
      if (settled) return
      settled = true
      cleanup()
      req.resume?.()
      reject(error)
    }
    const onData = (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      total += buffer.length
      if (total > limit) {
        fail(new MarketError(REQUEST_ERRORS.bodyTooLarge, 'Request body is too large', { limit }))
        return
      }
      chunks.push(buffer)
    }
    const onEnd = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve(Buffer.concat(chunks))
    }
    const onError = () => {
      fail(new MarketError(REQUEST_ERRORS.invalidJson, 'The request body could not be read'))
    }
    req.on('data', onData)
    req.on('end', onEnd)
    req.on('error', onError)
  })
}

/**
 * Read and parse a JSON object body.
 * @param req - Node IncomingMessage.
 * @returns the parsed object.
 * @throws MarketError `request/unsupported-media-type`, `request/body-too-large`,
 *   or `request/invalid-json`.
 */
export async function readJsonBody(req) {
  if (!isJsonContentType(req.headers?.['content-type'])) {
    throw new MarketError(REQUEST_ERRORS.unsupportedMediaType, 'POST bodies must be application/json')
  }
  const buffer = await readBody(req)
  if (buffer.length === 0) {
    throw new MarketError(REQUEST_ERRORS.invalidJson, 'A JSON object body is required')
  }
  let value
  try {
    value = JSON.parse(buffer.toString('utf8'))
  } catch {
    throw new MarketError(REQUEST_ERRORS.invalidJson, 'The request body is not valid JSON')
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new MarketError(REQUEST_ERRORS.invalidJson, 'The request body must be a JSON object')
  }
  return value
}

/**
 * Send a JSON response with the API's cache and sniffing headers.
 * @param res - Node ServerResponse.
 * @param status - HTTP status.
 * @param payload - JSON-serializable body.
 */
export function sendJson(res, status, payload) {
  if (res.writableEnded === true || res.headersSent === true) return
  const body = JSON.stringify(payload)
  res.statusCode = status
  if (typeof res.setHeader === 'function') {
    res.setHeader('cache-control', 'no-store')
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('x-content-type-options', 'nosniff')
  }
  res.end(body)
}

/**
 * Send the stable error envelope.
 * @param res - Node ServerResponse.
 * @param error - thrown value.
 */
export function sendError(res, error) {
  const payload = toErrorPayload(error)
  const status = statusForCode(payload.error.code)
  if (status === 405 && typeof payload.error.details?.allow === 'string' && typeof res.setHeader === 'function') {
    res.setHeader('allow', payload.error.details.allow)
  }
  if (status >= 500) {
    // Never log a stack trace, headers, tokens, or a staged payload path.
    console.error(`[skills-market] ${payload.error.code}: ${payload.error.message}`)
  }
  sendJson(res, status, payload)
}

/**
 * Handle one HTTP request against the market service.
 * @param req - Node IncomingMessage.
 * @param res - Node ServerResponse.
 * @param service - market service.
 * @returns resolves after the response is sent.
 */
export async function handleRequest(req, res, service) {
  try {
    const headers = req.headers ?? {}
    if (typeof res.setHeader === 'function') {
      res.setHeader('cache-control', 'no-store')
      res.setHeader('x-content-type-options', 'nosniff')
    }
    if (!sameOrigin(headers.origin, headers.host)) {
      throw new MarketError(REQUEST_ERRORS.forbiddenOrigin, 'Cross-origin requests are refused')
    }
    const local = localPathOf(req.url)
    if (local === null) {
      throw new MarketError(REQUEST_ERRORS.notFound, 'Unknown route')
    }
    const method = String(req.method ?? 'GET').toUpperCase()
    const allowed = ROUTES.filter((route) => route.path === local)
    if (allowed.length === 0) {
      throw new MarketError(REQUEST_ERRORS.notFound, 'Unknown route')
    }
    const route = allowed.find((candidate) => candidate.method === method)
    if (route === undefined) {
      const allow = allowed.map((candidate) => candidate.method).join(', ')
      throw new MarketError(REQUEST_ERRORS.methodNotAllowed, 'Method not allowed', { allow })
    }
    const request = {
      req,
      res,
      url: new URL(req.url ?? '/', 'http://localhost'),
    }
    const payload = await route.handle(service, request)
    sendJson(res, 200, payload)
  } catch (error) {
    sendError(res, error)
  }
}

/**
 * Create the callback registered on the Host web server.
 * @param options.service - market service.
 * @returns an `(req, res)` callback that never rejects.
 */
export function createRouteHandler({ service } = {}) {
  if (service === undefined) throw new Error('skills-market: a service is required')
  return (req, res) => {
    void handleRequest(req, res, service).catch((error) => {
      try {
        sendError(res, error)
      } catch {
        // The socket is already gone; nothing else can be reported.
      }
    })
  }
}
