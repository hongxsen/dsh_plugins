const DEFAULT_PROGRESS_INTERVAL = 1500;
const DEFAULT_MAX_PROGRESS = 20;
const MAX_MESSAGE_UPDATES = 20;
const DEFAULT_MAX_REPLY_CHARS = 3000;
const DEFAULT_DEDUP_SIZE = 256;

function textContent(text) {
  return JSON.stringify({ text });
}

function splitText(value, limit) {
  const text = String(value ?? '');
  if (!text) return [''];
  const characters = Array.from(text);
  const chunks = [];
  for (let index = 0; index < characters.length; index += limit) {
    chunks.push(characters.slice(index, index + limit).join(''));
  }
  return chunks;
}

function parseContent(content) {
  if (content == null) return {};
  return typeof content === 'string' ? JSON.parse(content) : content;
}

function renderPostElement(element) {
  if (!element || typeof element !== 'object') return '';
  switch (element.tag) {
    case 'text':
    case 'a':
      return String(element.text ?? element.href ?? '');
    case 'at':
      return String(element.text ?? (element.name ? `@${element.name}` : ''));
    case 'img':
    case 'image':
      return '[图片]';
    case 'media':
    case 'audio':
    case 'video':
      return '[媒体]';
    case 'file':
      return '[文件]';
    case 'emotion':
      return String(element.text ?? `[${element.emoji_type ?? '表情'}]`);
    default:
      return String(element.text ?? '');
  }
}

function renderPost(source, fallbackTitle = '') {
  let title = fallbackTitle;
  let paragraphs = source;
  if (!Array.isArray(paragraphs) && paragraphs && typeof paragraphs === 'object') {
    title = paragraphs.title ?? title;
    paragraphs = paragraphs.content ?? paragraphs.body ?? [];
  }
  if (!Array.isArray(paragraphs)) return String(title ?? '');

  const body = paragraphs.map((paragraph) => {
    const elements = Array.isArray(paragraph) ? paragraph : [paragraph];
    return elements.map(renderPostElement).join('');
  }).join('\n');
  return title ? `${title}${body ? `\n${body}` : ''}` : body;
}

function extractText(message) {
  if (message.message_type === 'text') {
    return String(parseContent(message.content).text ?? '');
  }
  if (message.message_type === 'post') {
    const content = parseContent(message.content);
    const externalV2 = message.content_v2 == null ? null : parseContent(message.content_v2);
    const richContent = externalV2 ?? content.content_v2 ?? content.content;
    return renderPost(richContent, content.title ?? '');
  }
  return `[暂不支持飞书 ${message.message_type ?? 'unknown'} 消息，请发送文本或富文本。]`;
}

function messageId(response, operation) {
  if (response?.code != null && response.code !== 0) {
    throw new Error(`Feishu ${operation} failed (${response.code}): ${response.msg ?? 'unknown error'}`);
  }
  const id = response?.data?.message_id ?? response?.message_id;
  if (!id) throw new Error(`Feishu ${operation} response did not include message_id`);
  return id;
}

function assertSuccess(response, operation) {
  if (response?.code != null && response.code !== 0) {
    throw new Error(`Feishu ${operation} failed (${response.code}): ${response.msg ?? 'unknown error'}`);
  }
}

async function loadSdk(options, config, sdkCallbacks = {}) {
  const factory = options.factory;
  if (typeof factory === 'function') return factory(config);

  let sdk = options.sdk;
  const hasFullFactory = factory?.createClient && factory?.createWSClient && factory?.createEventDispatcher;
  if (!sdk && !hasFullFactory) sdk = await import('@larksuiteoapi/node-sdk');
  const sdkConfig = {
    appId: config.appId,
    appSecret: config.appSecret,
    ...(config.domain ? { domain: config.domain } : {}),
  };
  const wsConfig = { ...sdkConfig, ...sdkCallbacks };

  return {
    client: factory?.createClient
      ? await factory.createClient(config)
      : new sdk.Client(sdkConfig),
    wsClient: factory?.createWSClient
      ? await factory.createWSClient(config, sdkCallbacks)
      : new sdk.WSClient(wsConfig),
    eventDispatcher: factory?.createEventDispatcher
      ? await factory.createEventDispatcher(config)
      : new sdk.EventDispatcher({}),
  };
}

export function createFeishuAdapter(config, options = {}) {
  const now = options.now ?? Date.now;
  const progressInterval = config.streamIntervalMs ?? config.progressInterval ?? DEFAULT_PROGRESS_INTERVAL;
  const maxProgress = Math.min(
    config.maxStreamUpdates ?? config.maxProgress ?? DEFAULT_MAX_PROGRESS,
    MAX_MESSAGE_UPDATES,
  );
  const maxReplyChars = config.maxReplyChars ?? DEFAULT_MAX_REPLY_CHARS;
  const dedupSize = config.maxDedupeEntries ?? config.dedupSize ?? DEFAULT_DEDUP_SIZE;
  const deliveries = new Set();
  const seen = new Set();

  let callbacks = {};
  let client = null;
  let wsClient = null;
  let startPromise = null;
  let closePromise = null;
  let running = false;

  function reportError(error) {
    try {
      const result = callbacks.onError?.(error);
      if (result && typeof result.then === 'function') result.catch(() => {});
    } catch {
      // Error reporting must not cause an unhandled rejection in the SDK callback.
    }
  }

  function notifyReady() {
    try {
      const result = callbacks.onReady?.({ state: 'online' });
      if (result && typeof result.then === 'function') result.catch(reportError);
    } catch (error) {
      reportError(error);
    }
  }

  function normalize(data) {
    const event = data?.message ? data : data?.event;
    const sender = event?.sender;
    const message = event?.message;
    if (!message || sender?.sender_type === 'bot' || sender?.sender_type === 'app') return null;

    const eventId = message.message_id;
    const chatId = message.chat_id;
    const openId = sender?.sender_id?.open_id;
    if (!eventId || !chatId || !openId || seen.has(eventId)) return null;

    seen.add(eventId);
    if (seen.size > dedupSize) seen.delete(seen.values().next().value);
    return {
      connectionId: config.id,
      platform: 'feishu',
      eventId,
      chatId,
      userId: openId,
      chatType: message.chat_type === 'group' ? 'group' : 'direct',
      text: extractText(message),
      receivedAt: now(),
      replyContext: { messageId: eventId, chatId, openId },
    };
  }

  function receive(data) {
    if (!running) return;
    try {
      const message = normalize(data);
      if (!message) return;
      // ConversationBridge.enqueue is the boundary: never make the SDK await an agent turn.
      const result = callbacks.onMessage?.(message);
      if (result && typeof result.then === 'function') result.catch(reportError);
    } catch (error) {
      reportError(error);
    }
  }

  async function start(nextCallbacks = {}) {
    if (startPromise) return startPromise;
    callbacks = nextCallbacks;
    running = true;
    startPromise = (async () => {
      const objects = await loadSdk(options, config, {
        onReady: notifyReady,
        onError: reportError,
      });
      // The Host may dispose the plugin while the SDK module is still loading.
      if (!running) return;
      client = objects.client;
      wsClient = objects.wsClient;
      objects.eventDispatcher.register({ 'im.message.receive_v1': receive });
      await wsClient.start({ eventDispatcher: objects.eventDispatcher });
      // stop() can race an asynchronous SDK start; never leave a late socket alive.
      if (!running) {
        const lateClient = objects.wsClient;
        if (wsClient === lateClient) {
          wsClient = null;
          client = null;
        }
        await lateClient.close();
      }
    })();

    try {
      await startPromise;
    } catch (error) {
      running = false;
      reportError(error);
      const failedClient = wsClient;
      wsClient = null;
      client = null;
      startPromise = null;
      if (failedClient) {
        try {
          await failedClient.close();
        } catch (closeError) {
          reportError(closeError);
        }
      }
      throw error;
    }
  }

  function getStatus() {
    const status = wsClient?.getConnectionStatus?.();
    return status ?? { state: running ? 'running' : 'idle' };
  }

  function createDelivery(message) {
    if (!running || !client) throw new Error('Feishu adapter must be started before creating a delivery');
    const incomingMessageId = message.replyContext?.messageId;
    const chatId = message.replyContext?.chatId ?? message.chatId;
    if (!incomingMessageId || !chatId) throw new Error('Feishu delivery requires incoming messageId and chatId');

    const segments = [];
    let chain = Promise.resolve();
    let disposed = false;
    let lastWrite = -Infinity;
    let delivery;

    function enqueue(operation) {
      if (disposed) return Promise.resolve();
      const result = chain.catch(() => {}).then(() => {
        if (!disposed) return operation();
      });
      chain = result;
      return result;
    }

    async function replySegment(text) {
      const response = await client.im.message.reply({
        path: { message_id: incomingMessageId },
        data: { msg_type: 'text', content: textContent(text) },
      });
      segments.push({ id: messageId(response, 'reply'), text, updates: 0 });
      lastWrite = now();
    }

    async function createSegment(text, track = true) {
      const response = await client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          msg_type: 'text',
          content: textContent(text),
        },
      });
      const segment = { id: messageId(response, 'create'), text, updates: 0 };
      if (track) segments.push(segment);
      lastWrite = now();
      return segment;
    }

    async function replaceSegment(index, text) {
      const replacement = await createSegment(text, false);
      segments[index] = replacement;
    }

    async function updateSegment(index, text) {
      const segment = segments[index];
      const response = await client.im.message.update({
        path: { message_id: segment.id },
        data: { msg_type: 'text', content: textContent(text) },
      });
      assertSuccess(response, 'update');
      segment.text = text;
      segment.updates += 1;
      lastWrite = now();
    }

    async function writeSnapshot(value, throttled) {
      if (throttled && segments.length && now() - lastWrite < progressInterval) return;
      const chunks = splitText(value, maxReplyChars);
      if (!segments.length) {
        await replySegment(chunks[0]);
        for (let index = 1; index < chunks.length; index += 1) {
          await createSegment(chunks[index]);
        }
        return;
      }

      for (let index = 0; index < chunks.length; index += 1) {
        const text = chunks[index];
        if (index >= segments.length) {
          await createSegment(text);
        } else if (segments[index].text !== text) {
          if (segments[index].updates >= maxProgress) await replaceSegment(index, text);
          else await updateSegment(index, text);
        }
      }
    }

    async function writeNotice(value) {
      for (const chunk of splitText(value, maxReplyChars)) await createSegment(chunk, false);
    }

    delivery = {
      ack: (text) => enqueue(() => writeSnapshot(text, false)),
      progress: (text) => enqueue(() => writeSnapshot(text, true)),
      final: (text) => enqueue(() => writeSnapshot(text, false)),
      notice: (text) => enqueue(() => writeNotice(text)),
      dispose: () => {
        disposed = true;
        deliveries.delete(delivery);
        return chain.catch(() => {});
      },
    };
    deliveries.add(delivery);
    return delivery;
  }

  async function stop() {
    running = false;
    seen.clear();
    const currentDeliveries = Array.from(deliveries);
    await Promise.all(currentDeliveries.map((delivery) => delivery.dispose()));
    const socket = wsClient;
    if (socket && !closePromise) closePromise = Promise.resolve().then(() => socket.close());
    if (closePromise) await closePromise;
    wsClient = null;
    client = null;
    startPromise = null;
    closePromise = null;
  }

  return {
    type: 'feishu',
    start,
    stop,
    getStatus,
    createDelivery,
  };
}
