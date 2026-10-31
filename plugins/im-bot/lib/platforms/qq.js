import WebSocket from 'ws';

const DEFAULT_API_BASE = 'https://api.bot.qq.com';
const SANDBOX_API_BASE = 'https://sandbox.api.sgroup.qq.com';
const DEFAULT_TOKEN_URL = `${DEFAULT_API_BASE}/app/getAppAccessToken`;
const DEFAULT_C2C_STREAM = true;
const QQ_INTENTS = 33554432;
const TOKEN_REFRESH_SKEW_MS = 60_000;
const DEFAULT_C2C_REPLY_LIMIT = 4;
const DEFAULT_GROUP_REPLY_LIMIT = 5;
const PASSIVE_REPLY_WINDOW_MS = 5 * 60_000;
const DEFAULT_RECONNECT_BASE_MS = 1_000;
const DEFAULT_RECONNECT_MAX_MS = 60_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

function requiredString(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`QQ config.${name} is required`);
  }
  return value.trim();
}

function errorWithStatus(status, code, traceId, prefix = 'QQ API request failed') {
  const details = [`status ${status}`];
  if (code !== undefined && code !== null) details.push(`code ${String(code)}`);
  if (traceId) details.push(`trace ${traceId}`);
  const error = new Error(`${prefix} (${details.join(', ')})`);
  error.status = status;
  if (code !== undefined && code !== null) error.code = code;
  if (traceId) error.traceId = traceId;
  return error;
}

function parsePayload(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/**
 * QQ official bot adapter. All network, WebSocket and clock/timer dependencies
 * can be injected through options; no QQ SDK is required.
 */
export function createQQAdapter(config = {}, options = {}) {
  const appId = requiredString(config.appId, 'appId');
  const appSecret = requiredString(config.appSecret ?? config.clientSecret, 'appSecret');
  const connectionId = config.id || 'qq';
  const defaultApiBase = config.sandbox === true ? SANDBOX_API_BASE : DEFAULT_API_BASE;
  const apiBase = String(config.apiBaseUrl || defaultApiBase).replace(/\/+$/, '');
  const tokenUrl = config.tokenUrl || DEFAULT_TOKEN_URL;
  const reconnectBaseMs = Number(config.reconnectInitialMs) > 0
    ? Number(config.reconnectInitialMs)
    : DEFAULT_RECONNECT_BASE_MS;
  const reconnectMaxMs = Number(config.reconnectMaxMs) > 0
    ? Number(config.reconnectMaxMs)
    : DEFAULT_RECONNECT_MAX_MS;
  const requestTimeoutMs = Number(config.requestTimeoutMs) > 0
    ? Number(config.requestTimeoutMs)
    : DEFAULT_REQUEST_TIMEOUT_MS;
  const fetchImpl = options.fetch || globalThis.fetch;
  const WebSocketImpl = options.WebSocket || WebSocket;
  const now = options.now || Date.now;
  const setTimer = options.setTimeout || globalThis.setTimeout;
  const clearTimer = options.clearTimeout || globalThis.clearTimeout;
  const random = options.random || Math.random;
  const logger = options.logger || console;

  let accessToken = null;
  let tokenExpiresAt = 0;
  let tokenPromise = null;
  let started = false;
  let stopped = false;
  let startPromise = null;
  let gatewayUrl = typeof config.gatewayUrl === 'string' && config.gatewayUrl.trim()
    ? config.gatewayUrl.trim()
    : null;
  let socket = null;
  let connectionGeneration = 0;
  let heartbeatTimer = null;
  let heartbeatAwaitingAck = false;
  let negotiationTimer = null;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  const activeRequests = new Set();
  let status = { state: 'idle' };
  let heartbeatInterval = 45_000;
  let sessionId = null;
  let lastSeq = null;
  let handlers = {};
  const deliveries = new Set();

  function sanitize(value) {
    let text = String(value ?? 'Unknown QQ adapter error');
    const secrets = [appSecret, accessToken].filter(Boolean);
    for (const secret of secrets) text = text.split(secret).join('[redacted]');
    return text.replace(/QQBot\s+\S+/gi, 'QQBot [redacted]');
  }

  function safeError(error, fallback = 'QQ adapter error') {
    const result = new Error(sanitize(error?.message || fallback));
    if (error?.status !== undefined) result.status = error.status;
    if (error?.code !== undefined) result.code = error.code;
    if (error?.traceId !== undefined) result.traceId = error.traceId;
    return result;
  }

  function reportError(error) {
    const safe = safeError(error);
    try {
      handlers.onError?.(safe);
    } catch (callbackError) {
      logger.error?.(`QQ onError callback failed: ${sanitize(callbackError?.message)}`);
    }
  }

  function cachedToken() {
    if (!accessToken) return null;
    if (now() >= tokenExpiresAt - TOKEN_REFRESH_SKEW_MS) return null;
    return accessToken;
  }

  /**
   * Run one HTTP request with a timeout covering both fetch and body reading.
   * The explicit abort race is intentional: injected/fetch-compatible clients
   * are not required to honor AbortSignal, and stop() must still unblock them.
   */
  function request(url, init = {}) {
    if (stopped) return Promise.reject(new Error('QQ adapter is stopped'));
    if (typeof fetchImpl !== 'function') return Promise.reject(new Error('QQ adapter requires fetch'));

    const controller = new AbortController();
    const record = { controller, done: null };
    activeRequests.add(record);
    let timeoutId = null;
    let rejectAbort;
    const onAbort = () => {
      const reason = controller.signal.reason;
      rejectAbort(reason instanceof Error ? reason : new Error('QQ request aborted'));
    };
    const abortPromise = new Promise((_, reject) => {
      rejectAbort = reject;
      controller.signal.addEventListener('abort', onAbort, { once: true });
    });
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimer(() => {
        const error = new Error(`QQ request timed out after ${requestTimeoutMs}ms`);
        error.code = 'ETIMEDOUT';
        controller.abort(error);
        reject(error);
      }, requestTimeoutMs);
      timeoutId?.unref?.();
    });

    record.done = (async () => {
      try {
        const operation = (async () => {
          const response = await fetchImpl(url, { ...init, signal: controller.signal });
          const text = await response.text();
          return { response, text };
        })();
        return await Promise.race([operation, abortPromise, timeoutPromise]);
      } finally {
        if (timeoutId !== null) clearTimer(timeoutId);
        controller.signal.removeEventListener('abort', onAbort);
        activeRequests.delete(record);
      }
    })();
    return record.done;
  }

  async function fetchToken() {
    try {
      const { response, text } = await request(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId, clientSecret: appSecret }),
      });
      const payload = parsePayload(text);
      if (!response.ok) {
        throw errorWithStatus(
          response.status,
          payload.err_code ?? payload.code,
          response.headers?.get?.('x-tps-trace-id'),
          'QQ AppAccessToken request failed',
        );
      }
      if (typeof payload.access_token !== 'string' || !payload.access_token) {
        throw new Error('QQ AppAccessToken response did not contain access_token');
      }
      const lifetime = Number(payload.expires_in);
      const lifetimeSeconds = Number.isFinite(lifetime) && lifetime > 0 ? lifetime : 7200;
      accessToken = payload.access_token;
      tokenExpiresAt = now() + lifetimeSeconds * 1000;
      return accessToken;
    } catch (error) {
      throw safeError(error, 'QQ AppAccessToken request failed');
    }
  }

  // Deliberately non-async: a cached token is returned synchronously so a
  // WebSocket Hello can be answered without an unnecessary microtask delay.
  function getToken() {
    const cached = cachedToken();
    if (cached) return cached;
    if (!tokenPromise) {
      tokenPromise = fetchToken().finally(() => {
        tokenPromise = null;
      });
    }
    return tokenPromise;
  }

  async function resolveToken() {
    return await getToken();
  }

  async function apiRequest(path, { method = 'POST', body, retry401 = true } = {}) {
    let token = await resolveToken();

    for (let attempt = 0; attempt < 2; attempt++) {
      const url = /^https?:\/\//.test(path) ? path : `${apiBase}${path}`;
      try {
        const { response, text } = await request(url, {
          method,
          headers: {
            Authorization: `QQBot ${token}`,
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const payload = parsePayload(text);
        if (response.status === 401 && retry401 && attempt === 0) {
          // Another concurrent request may already have refreshed this token.
          if (accessToken === token) {
            accessToken = null;
            tokenExpiresAt = 0;
          }
          token = await resolveToken();
          continue;
        }
        if (!response.ok) {
          throw errorWithStatus(
            response.status,
            payload.err_code ?? payload.code,
            response.headers?.get?.('x-tps-trace-id'),
          );
        }
        return payload;
      } catch (error) {
        throw safeError(error, 'QQ API network request failed');
      }
    }
    throw new Error('QQ API request failed after authentication retry');
  }

  function clearHeartbeat() {
    if (heartbeatTimer !== null) clearTimer(heartbeatTimer);
    heartbeatTimer = null;
    heartbeatAwaitingAck = false;
  }

  function clearReconnect() {
    if (reconnectTimer !== null) clearTimer(reconnectTimer);
    reconnectTimer = null;
  }

  function clearNegotiation() {
    if (negotiationTimer !== null) clearTimer(negotiationTimer);
    negotiationTimer = null;
  }

  function scheduleNegotiation(target, generation) {
    clearNegotiation();
    negotiationTimer = setTimer(() => {
      negotiationTimer = null;
      if (stopped || generation !== connectionGeneration || socket !== target) return;
      // Hello and READY/RESUMED are both required before this connection can
      // receive messages. A socket that never completes either stage must not
      // remain silently OPEN forever.
      reconnectFrom(target);
    }, requestTimeoutMs);
    negotiationTimer?.unref?.();
  }

  function sendFrame(target, frame) {
    if (stopped || socket !== target || target.readyState !== 1) return false;
    target.send(JSON.stringify(frame));
    return true;
  }

  function sendHeartbeat(target) {
    if (sendFrame(target, { op: 1, d: lastSeq })) heartbeatAwaitingAck = true;
  }

  function scheduleHeartbeat(target, generation) {
    clearHeartbeat();
    const beat = () => {
      if (stopped || generation !== connectionGeneration || socket !== target) return;
      if (heartbeatAwaitingAck) {
        // An OPEN socket can still be half-open at the gateway. Do not keep
        // sending into it forever when the previous heartbeat was not ACKed.
        reconnectFrom(target);
        return;
      }
      sendHeartbeat(target);
      heartbeatTimer = setTimer(beat, heartbeatInterval);
    };
    heartbeatTimer = setTimer(beat, heartbeatInterval);
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer !== null) return;
    const delay = Math.min(reconnectMaxMs, reconnectBaseMs * 2 ** reconnectAttempts);
    reconnectAttempts++;
    status = { state: 'reconnecting' };
    reconnectTimer = setTimer(() => {
      reconnectTimer = null;
      void openSocket().catch((error) => {
        reportError(error);
        scheduleReconnect();
      });
    }, delay);
  }

  function invalidateSocket(target) {
    if (socket !== target) return;
    socket = null;
    connectionGeneration++;
    clearHeartbeat();
    clearNegotiation();
  }

  function reconnectFrom(target, { resumable = true } = {}) {
    if (stopped || socket !== target) return;
    if (!resumable) sessionId = null;
    invalidateSocket(target);
    try {
      target.close(1000, 'Reconnecting');
    } catch {
      // The reconnect timer is sufficient if a implementation is already closed.
    }
    scheduleReconnect();
  }

  function sendSessionHandshake(target, generation) {
    const send = (token) => {
      if (stopped || generation !== connectionGeneration || socket !== target || target.readyState !== 1) return;
      if (sessionId && lastSeq !== null) {
        sendFrame(target, {
          op: 6,
          d: { token: `QQBot ${token}`, session_id: sessionId, seq: lastSeq },
        });
      } else {
        sendFrame(target, {
          op: 2,
          d: {
            token: `QQBot ${token}`,
            intents: QQ_INTENTS,
            shard: [0, 1],
            properties: {},
          },
        });
      }
    };
    const token = getToken();
    if (typeof token === 'string') send(token);
    else void token.then(send).catch((error) => {
      if (generation !== connectionGeneration || stopped) return;
      reportError(error);
      reconnectFrom(target);
    });
  }

  function normalizeDispatch(frame) {
    const data = frame.d || {};
    if (!data.id || data.bot || data.author?.bot || data.author?.is_bot) return null;
    const parsedReceivedAt = typeof data.timestamp === 'number'
      ? data.timestamp
      : Date.parse(data.timestamp);
    const receivedAt = Number.isFinite(parsedReceivedAt) ? parsedReceivedAt : now();
    const text = typeof data.content === 'string' ? data.content.trim() : '';
    if (frame.t === 'C2C_MESSAGE_CREATE') {
      const userOpenId = data.author?.user_openid;
      if (!userOpenId) return null;
      return {
        connectionId,
        platform: 'qq',
        eventId: data.id,
        chatId: userOpenId,
        userId: userOpenId,
        chatType: 'direct',
        text,
        receivedAt,
        replyContext: { msgId: data.id, userOpenId, eventId: frame.id },
      };
    }
    if (frame.t === 'GROUP_AT_MESSAGE_CREATE') {
      const groupOpenId = data.group_openid;
      const userId = data.author?.member_openid;
      if (!groupOpenId || !userId) return null;
      return {
        connectionId,
        platform: 'qq',
        eventId: data.id,
        chatId: groupOpenId,
        userId,
        chatType: 'group',
        text,
        receivedAt,
        replyContext: { msgId: data.id, groupOpenId, eventId: frame.id },
      };
    }
    return null;
  }

  function handleFrame(target, generation, event) {
    if (stopped || socket !== target || generation !== connectionGeneration) return;
    let frame;
    try {
      frame = JSON.parse(String(event.data));
    } catch {
      reportError(new Error('QQ WebSocket received invalid JSON'));
      return;
    }
    if (Number.isInteger(frame.s)) lastSeq = frame.s;

    switch (frame.op) {
      case 0: {
        if (frame.t === 'READY') {
          clearNegotiation();
          sessionId = frame.d?.session_id || null;
          reconnectAttempts = 0;
          status = { state: 'online', sessionId, resumed: false };
          handlers.onReady?.({ ...status });
          return;
        }
        if (frame.t === 'RESUMED') {
          clearNegotiation();
          reconnectAttempts = 0;
          status = { state: 'online', sessionId, resumed: true };
          handlers.onReady?.({ ...status });
          return;
        }
        const message = normalizeDispatch(frame);
        if (message) {
          void Promise.resolve()
            .then(() => handlers.onMessage?.(message))
            .catch(reportError);
        }
        return;
      }
      case 1:
        sendHeartbeat(target);
        return;
      case 7:
        reconnectFrom(target);
        return;
      case 9:
        reconnectFrom(target, { resumable: frame.d === true });
        return;
      case 10:
        heartbeatInterval = Number(frame.d?.heartbeat_interval) || 45_000;
        scheduleHeartbeat(target, generation);
        sendSessionHandshake(target, generation);
        return;
      case 11:
        heartbeatAwaitingAck = false;
        return;
      default:
        return;
    }
  }

  async function openSocket() {
    if (stopped) return;
    status = { state: 'connecting' };
    if (typeof WebSocketImpl !== 'function') throw new Error('QQ adapter requires WebSocket');
    if (!gatewayUrl) {
      const gateway = await apiRequest('/gateway', { method: 'GET' });
      if (typeof gateway.url !== 'string' || !gateway.url) throw new Error('QQ gateway response did not contain url');
      gatewayUrl = gateway.url;
    }
    if (stopped) return;
    clearReconnect();
    const target = new WebSocketImpl(gatewayUrl);
    const generation = ++connectionGeneration;
    socket = target;
    scheduleNegotiation(target, generation);

    target.onmessage = (event) => handleFrame(target, generation, event);
    target.onclose = (event) => {
      if (socket !== target || generation !== connectionGeneration) return;
      invalidateSocket(target);
      if (stopped) return;
      const code = event?.code;
      if (code === 4013 || code === 4014) {
        status = { state: 'error', code };
        const error = new Error(`QQ WebSocket closed with fatal code ${code}`);
        error.code = code;
        reportError(error);
        return;
      }
      if (code === 4006 || code === 4007) sessionId = null;
      scheduleReconnect();
    };
    target.onerror = () => {
      if (!stopped && socket === target && generation === connectionGeneration) {
        reportError(new Error('QQ WebSocket connection error'));
      }
    };
    // Identification is intentionally driven by Hello (op 10), not onopen.
    target.onopen = () => {};
  }

  async function start(callbacks = {}) {
    if (started && startPromise) return startPromise;
    handlers = callbacks;
    started = true;
    stopped = false;
    startPromise = openSocket().catch((error) => {
      if (stopped) return;
      reportError(error);
      // Initial discovery/handshake failures use the same recovery path as a
      // later socket failure; the runtime must not need to re-call start().
      scheduleReconnect();
    });
    return startPromise;
  }

  async function stop() {
    const pendingStart = startPromise;
    stopped = true;
    started = false;
    startPromise = null;
    status = { state: 'stopped' };
    clearHeartbeat();
    clearNegotiation();
    clearReconnect();
    const target = socket;
    if (target) {
      invalidateSocket(target);
      try {
        target.close(1000, 'Adapter stopped');
      } catch {
        // Already closed.
      }
    }

    const pendingRequests = [...activeRequests].map((record) => record.done);
    const stopError = new Error('QQ adapter stopped');
    for (const { controller } of activeRequests) controller.abort(stopError);
    const pendingDeliveries = [...deliveries].map((delivery) => delivery.dispose());
    // A stopped adapter is a cleanup boundary, not a reason to surface a
    // second network error. Every in-flight operation has been aborted above.
    await Promise.allSettled([
      ...pendingRequests,
      ...pendingDeliveries,
      ...(pendingStart ? [pendingStart] : []),
    ]);
  }

  function createDelivery(message) {
    const chatType = message.chatType;
    if (chatType !== 'direct' && chatType !== 'group') {
      throw new TypeError('QQ delivery requires direct or group chatType');
    }
    const replyContext = message.replyContext || {};
    const msgId = replyContext.msgId || message.eventId;
    if (!msgId) throw new TypeError('QQ delivery requires replyContext.msgId');
    const userOpenId = replyContext.userOpenId || (chatType === 'direct' ? message.chatId : undefined);
    const groupOpenId = replyContext.groupOpenId || (chatType === 'group' ? message.chatId : undefined);
    const targetOpenId = chatType === 'direct' ? userOpenId : groupOpenId;
    if (!targetOpenId) throw new TypeError('QQ delivery requires an openid');

    const replyLimit = chatType === 'group'
      ? (config.groupReplyLimit ?? DEFAULT_GROUP_REPLY_LIMIT)
      : (config.c2cReplyLimit ?? DEFAULT_C2C_REPLY_LIMIT);
    const parsedReceivedAt = typeof message.receivedAt === 'number'
      ? message.receivedAt
      : Date.parse(message.receivedAt);
    const receivedAt = Number.isFinite(parsedReceivedAt) ? parsedReceivedAt : now();
    const streamPreference = config.c2cStream ?? config.streamUpdates ?? DEFAULT_C2C_STREAM;
    const streamEnabled = chatType === 'direct' && streamPreference !== false;

    let queue = Promise.resolve();
    let disposed = false;
    let usedReplies = 0;
    let msgSeq = 0;
    let groupProgressSent = false;
    let streamDisabled = !streamEnabled;
    let streamFinished = false;
    let streamMsgId = null;
    let streamMsgSeq = null;
    let streamIndex = 0;

    function assertWritable() {
      if (disposed || stopped) return false;
      if (now() > receivedAt + PASSIVE_REPLY_WINDOW_MS) {
        throw new Error(`QQ passive reply window expired for incoming message ${msgId}`);
      }
      return true;
    }

    function allocateReply() {
      if (usedReplies >= replyLimit) {
        throw new Error(`QQ passive reply quota exhausted (${replyLimit})`);
      }
      usedReplies++;
      msgSeq++;
      return msgSeq;
    }

    async function sendOrdinary(text) {
      const seq = allocateReply();
      const path = chatType === 'direct'
        ? `/v2/users/${encodeURIComponent(userOpenId)}/messages`
        : `/v2/groups/${encodeURIComponent(groupOpenId)}/messages`;
      const body = { msg_type: 0, content: String(text ?? ''), msg_id: msgId, msg_seq: seq };
      if (!msgId && replyContext.eventId) body.event_id = replyContext.eventId;
      await apiRequest(path, { body });
    }

    async function sendStream(text, final) {
      if (streamMsgSeq === null) streamMsgSeq = allocateReply();
      const path = `/v2/users/${encodeURIComponent(userOpenId)}/stream_messages`;
      const body = {
        input_mode: 'replace',
        input_state: final ? 10 : 1,
        index: streamIndex++,
        content_type: config.streamContentType || 'markdown',
        content_raw: String(text ?? ''),
        msg_id: msgId,
        msg_seq: streamMsgSeq,
      };
      if (streamMsgId) body.stream_msg_id = streamMsgId;
      const result = await apiRequest(path, { body });
      if (!streamMsgId) streamMsgId = result.id || result.stream_msg_id || null;
      if (final) streamFinished = true;
    }

    async function write(text, { final = false, progress = false } = {}) {
      if (!assertWritable()) return;
      if (chatType === 'group' && progress) {
        if (groupProgressSent) return;
        groupProgressSent = true;
      }

      if (chatType === 'direct' && !streamDisabled && !streamFinished) {
        try {
          await sendStream(text, final);
          return;
        } catch (error) {
          // A stream is never resumed after an error. Each fallback is a new
          // passive reply with its own monotonically increasing msg_seq.
          streamDisabled = true;
          streamMsgId = null;
          logger.warn?.(`QQ stream reply failed; using ordinary passive replies: ${sanitize(error?.message)}`);
        }
      }
      await sendOrdinary(text);
    }

    function enqueue(text, flags) {
      const result = queue.then(() => write(text, flags));
      // A rejected write is returned to its caller, but must not poison the
      // ordering chain for final() and subsequent notice() chunks.
      queue = result.catch(() => {});
      return result;
    }

    const delivery = {
      ack(text = 'Working…') {
        return enqueue(text, {});
      },
      progress(text) {
        return enqueue(text, { progress: true });
      },
      final(text) {
        return enqueue(text, { final: true });
      },
      notice(text) {
        return enqueue(text, {});
      },
      async dispose() {
        disposed = true;
        deliveries.delete(delivery);
        await queue;
      },
    };
    deliveries.add(delivery);
    return delivery;
  }

  function getStatus() {
    return { ...status };
  }

  return { type: 'qq', start, stop, getStatus, createDelivery };
}

export default createQQAdapter;
