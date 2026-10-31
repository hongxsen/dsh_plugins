/**
 * Minimal RFC 6455 client used by the WeCom long connection.
 *
 * Node's built-in undici WebSocket can fail against the WeCom gateway with a
 * 1006 close before `open`; this dependency-free node:http(s) upgrade keeps the
 * verified handshake and framing behavior of the original dsh-wecom client.
 * Only text, ping/pong, fragmentation, binary-as-UTF8 and clean close are
 * needed by the JSON protocol.
 *
 * @module @hongxsen/dsh-im-bot/transport
 */

import { createHash, randomBytes } from 'node:crypto'
import http from 'node:http'
import https from 'node:https'

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const MAX_MESSAGE_BYTES = 8 * 1024 * 1024

const OPCODE = Object.freeze({
  CONTINUATION: 0x0,
  TEXT: 0x1,
  BINARY: 0x2,
  CLOSE: 0x8,
  PING: 0x9,
  PONG: 0xa,
})

/** A WebSocket-shaped object: addEventListener, send, close and readyState. */
export class NodeWebSocket {
  #handlers = new Map()
  #request
  #socket
  #buffer = Buffer.alloc(0)
  #fragments = []
  #fragmentOpcode = 0
  #fragmentBytes = 0
  #readyState = 0
  #closeEmitted = false
  #closeCode = 1006
  #closeReason = ''

  constructor(url) {
    this.url = String(url)
    this.#connect()
  }

  /** 0 connecting · 1 open · 2 closing · 3 closed */
  get readyState() {
    return this.#readyState
  }

  addEventListener(type, handler) {
    if (typeof handler !== 'function') return
    if (!this.#handlers.has(type)) this.#handlers.set(type, new Set())
    this.#handlers.get(type).add(handler)
  }

  removeEventListener(type, handler) {
    this.#handlers.get(type)?.delete(handler)
  }

  send(data) {
    if (this.#readyState !== 1) throw new Error('WebSocket is not open')
    const payload = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data)
    this.#writeFrame(OPCODE.TEXT, payload)
  }

  close(code = 1000, reason = '') {
    if (this.#readyState === 3) return
    this.#readyState = 2
    const text = Buffer.from(String(reason), 'utf8')
    const payload = Buffer.alloc(2 + text.length)
    payload.writeUInt16BE(code, 0)
    text.copy(payload, 2)
    try {
      this.#writeFrame(OPCODE.CLOSE, payload)
    } catch {
      /* socket may already be gone */
    }
    this.#socket?.end()
  }

  #connect() {
    let url
    try {
      url = new URL(this.url)
    } catch (error) {
      this.#fail(error)
      return
    }
    if (url.protocol !== 'wss:' && url.protocol !== 'ws:') {
      this.#fail(new Error(`unsupported WebSocket protocol ${url.protocol}`))
      return
    }

    const secure = url.protocol === 'wss:'
    const key = randomBytes(16).toString('base64')
    const request = (secure ? https : http).request({
      host: url.hostname,
      port: url.port === '' ? (secure ? 443 : 80) : Number(url.port),
      path: `${url.pathname}${url.search}`,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': key,
      },
    })
    this.#request = request

    request.setTimeout(15_000, () => {
      request.destroy(new Error('WebSocket handshake timeout'))
    })

    request.on('upgrade', (response, socket, head) => {
      const expected = createHash('sha1').update(key + GUID).digest('base64')
      if (response.statusCode !== 101 || response.headers['sec-websocket-accept'] !== expected) {
        socket.destroy()
        this.#fail(new Error(`WebSocket handshake rejected (HTTP ${response.statusCode})`))
        return
      }
      this.#socket = socket
      this.#readyState = 1
      socket.setNoDelay?.(true)
      socket.on('data', (chunk) => this.#onData(chunk))
      socket.on('error', (error) => this.#fail(error))
      socket.on('end', () => this.#emitClose())
      socket.on('close', () => this.#emitClose())
      this.#emit('open', {})
      if (head !== undefined && head.length > 0) this.#onData(head)
    })

    request.on('response', (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        if (body.length < 500) body += chunk
      })
      response.on('end', () => {
        this.#fail(new Error(`WebSocket upgrade rejected (HTTP ${response.statusCode}) ${body.slice(0, 200)}`.trim()))
      })
    })

    request.on('error', (error) => this.#fail(error))
    request.end()
  }

  #writeFrame(opcode, payload) {
    const socket = this.#socket
    if (socket === undefined) throw new Error('WebSocket is not connected')
    const mask = randomBytes(4)
    const masked = Buffer.allocUnsafe(payload.length)
    for (let index = 0; index < payload.length; index += 1) {
      masked[index] = payload[index] ^ mask[index & 3]
    }
    const length = payload.length
    let header
    if (length < 126) {
      header = Buffer.from([0x80 | opcode, 0x80 | length])
    } else if (length < 65536) {
      header = Buffer.alloc(4)
      header[0] = 0x80 | opcode
      header[1] = 0x80 | 126
      header.writeUInt16BE(length, 2)
    } else {
      header = Buffer.alloc(10)
      header[0] = 0x80 | opcode
      header[1] = 0x80 | 127
      header.writeBigUInt64BE(BigInt(length), 2)
    }
    socket.write(Buffer.concat([header, mask, masked]))
  }

  #onData(chunk) {
    this.#buffer = this.#buffer.length === 0 ? chunk : Buffer.concat([this.#buffer, chunk])
    for (;;) {
      const frame = this.#decodeFrame()
      if (frame === undefined) return
      this.#handleFrame(frame)
      if (this.#readyState === 3) return
    }
  }

  #decodeFrame() {
    const buffer = this.#buffer
    if (buffer.length < 2) return undefined
    const first = buffer[0]
    const second = buffer[1]
    const fin = (first & 0x80) !== 0
    const opcode = first & 0x0f
    const masked = (second & 0x80) !== 0
    let length = second & 0x7f
    let offset = 2
    if (length === 126) {
      if (buffer.length < 4) return undefined
      length = buffer.readUInt16BE(2)
      offset = 4
    } else if (length === 127) {
      if (buffer.length < 10) return undefined
      const big = buffer.readBigUInt64BE(2)
      if (big > BigInt(MAX_MESSAGE_BYTES)) {
        this.#fail(new Error('WebSocket frame exceeds the message cap'))
        return undefined
      }
      length = Number(big)
      offset = 10
    }
    if (length > MAX_MESSAGE_BYTES) {
      this.#fail(new Error('WebSocket frame exceeds the message cap'))
      return undefined
    }
    const maskLength = masked ? 4 : 0
    if (buffer.length < offset + maskLength + length) return undefined

    const mask = masked ? buffer.subarray(offset, offset + 4) : undefined
    offset += maskLength
    const payload = Buffer.from(buffer.subarray(offset, offset + length))
    if (mask !== undefined) {
      for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index & 3]
    }
    this.#buffer = buffer.subarray(offset + length)
    return { fin, opcode, payload }
  }

  #handleFrame({ fin, opcode, payload }) {
    switch (opcode) {
      case OPCODE.TEXT:
      case OPCODE.BINARY:
        if (fin) {
          this.#emitMessage(payload)
        } else {
          this.#fragments = [payload]
          this.#fragmentOpcode = opcode
          this.#fragmentBytes = payload.length
        }
        return
      case OPCODE.CONTINUATION: {
        if (this.#fragments.length === 0) return
        this.#fragments.push(payload)
        this.#fragmentBytes += payload.length
        if (this.#fragmentBytes > MAX_MESSAGE_BYTES) {
          this.#fail(new Error('WebSocket message exceeds the message cap'))
          return
        }
        if (fin) {
          const joined = Buffer.concat(this.#fragments, this.#fragmentBytes)
          this.#fragments = []
          this.#fragmentBytes = 0
          this.#emitMessage(joined)
        }
        return
      }
      case OPCODE.PING:
        try {
          this.#writeFrame(OPCODE.PONG, payload)
        } catch {
          /* closing */
        }
        return
      case OPCODE.PONG:
        return
      case OPCODE.CLOSE:
        this.#closeCode = payload.length >= 2 ? payload.readUInt16BE(0) : 1005
        this.#closeReason = payload.length > 2 ? payload.subarray(2).toString('utf8') : ''
        try {
          this.#writeFrame(OPCODE.CLOSE, payload.subarray(0, 2))
        } catch {
          /* closing */
        }
        this.#readyState = 2
        this.#socket?.end()
        return
      default:
    }
  }

  #emitMessage(payload) {
    if (payload.length > MAX_MESSAGE_BYTES) {
      this.#fail(new Error('WebSocket message exceeds the message cap'))
      return
    }
    this.#emit('message', { data: payload.toString('utf8') })
  }

  #fail(error) {
    this.#emit('error', { message: error?.message ?? String(error), error })
    try {
      this.#request?.destroy()
      this.#socket?.destroy()
    } catch {
      /* already gone */
    }
    this.#emitClose()
  }

  #emitClose() {
    if (this.#closeEmitted) return
    this.#closeEmitted = true
    this.#readyState = 3
    this.#emit('close', { code: this.#closeCode, reason: this.#closeReason, wasClean: this.#closeCode === 1000 })
  }

  #emit(type, event) {
    for (const handler of this.#handlers.get(type) ?? []) {
      try {
        handler(event)
      } catch {
        /* a listener must never take down the transport */
      }
    }
  }
}

export function createWebSocket(url) {
  return new NodeWebSocket(url)
}
