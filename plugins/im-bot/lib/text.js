/** Platform-neutral text, command, identity, and chunking helpers. */

import { createHash } from 'node:crypto'

const COMMAND_ALIASES = new Map([
  ['help', 'help'], ['h', 'help'], ['?', 'help'], ['帮助', 'help'], ['指令', 'help'], ['命令', 'help'],
  ['new', 'new'], ['reset', 'new'], ['新会话', 'new'], ['重置', 'new'], ['重开', 'new'], ['新建', 'new'],
  ['stop', 'stop'], ['cancel', 'stop'], ['停止', 'stop'], ['中断', 'stop'],
  ['status', 'status'], ['状态', 'status'], ['info', 'status'],
  ['whoami', 'whoami'], ['我是谁', 'whoami'], ['身份', 'whoami'],
  ['ping', 'ping'], ['在吗', 'ping'],
])

/** Recognize an exact slash command; unknown slash-prefixed text remains a task. */
export function parseCommand(text) {
  const value = String(text ?? '').trim()
  if (value === '?') return { name: 'help', args: '' }
  if (!value.startsWith('/')) return undefined
  const match = /^\/([^\s/]+)\s*([\s\S]*)$/.exec(value)
  if (match === null) return undefined
  const name = COMMAND_ALIASES.get(match[1].toLowerCase())
  return name === undefined ? undefined : { name, args: match[2].trim() }
}

/** Join only the text blocks of one assistant message. */
export function assistantText(message) {
  if (message === undefined || message === null || !Array.isArray(message.content)) return ''
  return message.content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')
}

/** A native chat id is never guessed from a platform payload or user id. */
export function conversationKey(message) {
  return `${String(message?.connectionId ?? '')}:${String(message?.chatType ?? '')}:${String(message?.chatId ?? '')}`
}

export const chatKey = conversationKey

/** Short fingerprint used in DSH session ids. */
export function chatSlug(key) {
  return createHash('sha256').update(String(key)).digest('hex').slice(0, 8)
}

/** Split at line/word boundaries where possible, otherwise hard-cut. */
export function splitText(text, max = 3000) {
  const value = String(text ?? '')
  if (value === '') return ['']
  const limit = Math.max(64, Math.floor(max))
  if (value.length <= limit) return [value]
  const parts = []
  let rest = value
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit)
    if (cut < limit * 0.5) cut = rest.lastIndexOf(' ', limit)
    if (cut < limit * 0.5) cut = limit
    const part = rest.slice(0, cut).replace(/\s+$/, '')
    if (part !== '') parts.push(part)
    rest = rest.slice(cut).replace(/^\s+/, '')
  }
  if (rest !== '') parts.push(rest)
  return parts.length > 0 ? parts : ['']
}

export function tail(text, max) {
  const value = String(text ?? '')
  if (value.length <= max) return value
  return `…${value.slice(value.length - Math.max(0, max - 1))}`
}

export function oneLine(text, max = 60) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim()
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`
}

export function formatDuration(ms) {
  const seconds = Math.max(0, Math.round(Number(ms) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60) return rest === 0 ? `${minutes}m` : `${minutes}m${rest}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h${minutes % 60}m`
}
