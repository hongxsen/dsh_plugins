/**
 * Pure model of the Co-write plugin.
 *
 * The browser bundle inlines this file (with `export` prefixes stripped), and
 * the unit tests import it directly. Nothing here touches the DOM, Cordis, or
 * `window`, so the text a user finally sends can be asserted without a browser.
 */

/** Largest single excerpt kept verbatim. */
export const MAX_EXCERPT = 20000
/** Largest single comment kept verbatim. */
export const MAX_COMMENT = 8000
/** Largest complete message accepted by the send hook. */
export const MAX_TOTAL = 160000
/** Prefix of the per-session localStorage list. */
export const STORAGE_PREFIX = 'dsh.co-write.comments.v1.'

/** Normalize line endings and reject non-string input. */
export function cleanText(value) {
  return typeof value === 'string' ? value.replace(/\r\n?/gu, '\n') : ''
}

/**
 * Clip one excerpt to the per-item cap.
 * @param {string} value - raw excerpt.
 * @param {number} limit - maximum characters to keep.
 * @returns {{text: string, truncated: boolean}} kept text and whether it was cut.
 */
export function clipText(value, limit = MAX_EXCERPT) {
  const text = cleanText(value)
  if (text.length <= limit) return { text, truncated: false }
  return {
    text: `${text.slice(0, limit)}\n\n[… 内容过长，已截取前 ${limit} 字 / content clipped to the first ${limit} characters …]`,
    truncated: true,
  }
}

/**
 * Quote every line so Markdown renders it as one blockquote.
 * @param {string} value - excerpt text.
 * @returns {string} blockquote lines.
 */
export function quoteLines(value) {
  return cleanText(value).split('\n').map(line => (line === '' ? '>' : `> ${line}`)).join('\n')
}

/** Format an epoch timestamp as a short local date and time. */
export function formatDateTime(ms, lang = 'zh') {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return ''
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return ''
  try {
    return new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en-US', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(date)
  } catch {
    return date.toISOString()
  }
}

/** Compress whitespace and cut a display-only summary. */
export function summarize(value, limit = 180) {
  const text = cleanText(value).replace(/\s+/gu, ' ').trim()
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}…`
}

/** Human label for one comment's source. */
export function sourceLabel(comment, lang = 'zh') {
  const meta = comment.meta ?? {}
  if (comment.source === 'chat') {
    if (lang === 'zh') return meta.role === 'assistant' ? '对话 · 助手回复' : '对话 · 用户消息'
    return meta.role === 'assistant' ? 'Conversation · Assistant' : 'Conversation · User'
  }
  const path = typeof meta.path === 'string' && meta.path !== '' ? meta.path : ''
  if (lang === 'zh') return path === '' ? '工作区 · 文件' : `工作区 · ${path}`
  return path === '' ? 'Workspace · File' : `Workspace · ${path}`
}

/** One-line location details shown in the review bar and the sent message. */
export function locationLine(comment, lang = 'zh') {
  const meta = comment.meta ?? {}
  const parts = []
  if (comment.source === 'file' && Number.isInteger(meta.startLine)) {
    const start = meta.startLine
    const end = Number.isInteger(meta.endLine) && meta.endLine >= start ? meta.endLine : start
    parts.push(`${lang === 'zh' ? '行' : 'Lines'} ${start}${end === start ? '' : `–${end}`}`)
  }
  if (meta.truncated === true) parts.push(lang === 'zh' ? '摘录已截断' : 'Excerpt truncated')
  return parts.join(' · ')
}

/** Format one comment as the Markdown section sent with the next message. */
export function formatComment(comment, index, lang = 'zh') {
  const title = comment.label && comment.label.trim() !== ''
    ? comment.label.trim()
    : sourceLabel(comment, lang)
  const lines = [`### ${lang === 'zh' ? '评论' : 'Comment'} ${index} · ${title}`]
  const location = locationLine(comment, lang)
  if (location !== '') lines.push(location)
  lines.push(lang === 'zh' ? '原文：' : 'Quoted text:')
  lines.push(quoteLines(comment.content))
  lines.push('')
  lines.push(`${lang === 'zh' ? '评论' : 'Comment'}：${comment.comment.trim()}`)
  return lines.join('\n')
}

/**
 * Build the text appended to (or used as) the next user message.
 * @param {readonly object[]} comments - ordered comments.
 * @param {'zh'|'en'} lang - prompt language.
 * @returns {{text: string, error: string|null}} text, or an error code.
 */
export function buildCommentMessage(comments, lang = 'zh') {
  if (!Array.isArray(comments) || comments.length === 0) return { text: '', error: 'empty' }
  const header = lang === 'zh'
    ? '以下是我对选中原文的评论，请把原文和评论一并作为本轮对话的输入：'
    : 'Here are my comments on the selected material. Treat the quoted text and comments as input for this turn:'
  const body = comments.map((comment, index) => formatComment(comment, index + 1, lang))
  const text = [header, ...body].join('\n\n')
  if (text.length > MAX_TOTAL) return { text, error: 'too-long' }
  return { text, error: null }
}

/** Create a stable id without assuming `crypto.randomUUID` exists. */
export function newId() {
  const cryptoObject = globalThis.crypto
  if (cryptoObject && typeof cryptoObject.randomUUID === 'function') return cryptoObject.randomUUID()
  return `cw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Normalize one persisted or newly built comment.
 * @returns {object|null} the normalized comment, or null when unusable.
 */
export function normalizeComment(value) {
  if (value === null || typeof value !== 'object') return null
  if (value.source !== 'chat' && value.source !== 'file') return null
  const content = cleanText(value.content)
  const comment = cleanText(value.comment).trim()
  if (content.trim() === '' || comment === '') return null
  const meta = value.meta !== null && typeof value.meta === 'object' ? value.meta : {}
  return {
    id: typeof value.id === 'string' && value.id !== '' ? value.id : newId(),
    source: value.source,
    label: typeof value.label === 'string' ? value.label : '',
    content,
    comment,
    meta: {
      ...(typeof meta.role === 'string' ? { role: meta.role } : {}),
      ...(Number.isFinite(meta.turn) ? { turn: meta.turn } : {}),
      ...(typeof meta.path === 'string' && meta.path !== '' ? { path: meta.path } : {}),
      ...(Number.isInteger(meta.startLine) ? { startLine: meta.startLine } : {}),
      ...(Number.isInteger(meta.endLine) ? { endLine: meta.endLine } : {}),
      ...(meta.truncated === true ? { truncated: true } : {}),
    },
  }
}

/** Normalize a persisted comment list. */
export function normalizeComments(value) {
  const list = Array.isArray(value) ? value : Array.isArray(value?.comments) ? value.comments : []
  return list.map(normalizeComment).filter(comment => comment !== null)
}

/** Build a new comment from a selection and its editor text. */
export function makeComment({ source, label = '', content, comment, meta = {} }) {
  return normalizeComment({ id: newId(), source, label, content, comment, meta })
}

/** Per-session localStorage key. */
export function storageKey(sessionId) {
  return `${STORAGE_PREFIX}${sessionId}`
}

/** Approximate display size of the pending comments. */
export function totalSize(comments) {
  return comments.reduce((sum, comment) => sum + comment.content.length + comment.comment.length, 0)
}
