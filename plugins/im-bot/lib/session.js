/** DSH session event consumption with bounded streaming and cancellation. */

import { randomUUID } from 'node:crypto'
import { assistantText, tail } from './text.js'

const CANCEL_GRACE_MS = 250

function frozenUserMessage(text) {
  return Object.freeze({
    id: randomUUID(),
    role: 'user',
    content: Object.freeze([Object.freeze({ type: 'text', text })]),
    source: Object.freeze({ kind: 'user' }),
  })
}

function reasonOf(event) {
  return event?.data?.reason ?? event?.reason
}

function errorText(reason) {
  const error = reason?.error
  const code = error?.code ? `（${error.code}）` : ''
  const detail = error?.message || reason?.message || '未知错误'
  return `❌ 执行失败${code}：${detail}`
}

/**
 * Run one user turn. The bridge owns delivery and persistence; this function
 * only consumes DSH's public Session/Agent surface and reports a neutral result.
 */
export async function runAgentTurn({ agent, text, config, logger = console, onProgress, signal }) {
  const session = agent.session
  if (!session || typeof agent.followup !== 'function') throw new Error('DSH Agent 缺少 session/followup 接口')
  let cursor = Number.isFinite(session.seq) ? session.seq : 0
  let streamed = ''
  let answer = ''
  let toolStatus = ''
  let updates = 0
  let lastProgress = 0
  let endReason
  let cancelledAt = 0
  let timedOut = false
  const startedAt = Date.now()
  const graceMs = config.cancelGraceMs ?? CANCEL_GRACE_MS

  agent.followup(frozenUserMessage(text))

  while (true) {
    while (true) {
      const event = typeof session.eventAt === 'function' ? session.eventAt(cursor) : session.events?.[cursor]
      if (event === undefined || event === null) break
      cursor += 1
      if (event.type === 'assistant/chunk') {
        const chunk = event.data?.chunk
        if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') streamed += chunk.text
      } else if (event.type === 'assistant/message') {
        const content = assistantText(event.data?.message)
        if (content !== '') answer = content
      } else if (event.type === 'tool/start' || event.type === 'tool/end') {
        const name = event.data?.name || event.data?.toolName || event.data?.tool?.name || '工具'
        toolStatus = event.type === 'tool/start' ? `正在调用 ${name}` : `${name} 调用完成`
      } else if (event.type === 'turn/end') {
        endReason = reasonOf(event) || { kind: 'completed' }
      }
    }

    const now = Date.now()
    if (signal?.aborted && cancelledAt === 0) cancelledAt = now
    if (!signal?.aborted && !timedOut && now - startedAt >= config.turnTimeoutMs) {
      timedOut = true
      cancelledAt = now
      try { agent.cancel({ kind: 'user' }) } catch (error) { logger.warn?.(`[im-bot] 超时取消失败：${error?.message ?? error}`) }
    }

    if (endReason !== undefined) {
      if (cancelledAt !== 0 && endReason?.kind !== 'error') endReason = { kind: timedOut ? 'timeout' : 'cancelled' }
      break
    }
    if (cancelledAt !== 0 && now - cancelledAt >= graceMs) {
      endReason = { kind: timedOut ? 'timeout' : 'cancelled' }
      break
    }

    if (!cancelledAt && config.streamUpdates && updates < config.maxStreamUpdates && now - lastProgress >= config.streamIntervalMs) {
      const preview = tail(answer || streamed, 1200)
      const lines = ['⏳ 处理中…']
      if (toolStatus) lines.push(toolStatus)
      if (preview) lines.push('', preview)
      if (onProgress) await onProgress(lines.join('\n'))
      updates += 1
      lastProgress = now
    }
    await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs))
  }

  const partial = answer || streamed
  const kind = endReason?.kind || 'completed'
  if (kind === 'completed') return { kind, text: partial || '(任务已完成，但没有文本回复。)' }
  if (kind === 'timeout') {
    return { kind, text: `⏰ 执行超时（${Math.round(config.turnTimeoutMs / 1000)} 秒），已中断本次任务。${partial ? `\n\n${partial}` : ''}` }
  }
  if (kind === 'cancelled' || kind === 'canceled' || kind === 'aborted') {
    return { kind: 'cancelled', text: `⏹ 已停止。${partial ? `\n\n${partial}` : ''}` }
  }
  if (kind === 'error') return { kind, text: `${errorText(endReason)}${partial ? `\n\n${partial}` : ''}` }
  return { kind, text: partial || `⚠️ 任务结束：${kind}` }
}
