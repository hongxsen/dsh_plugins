/** Shared slash commands. Every side effect arrives through an explicit context. */

import { formatDuration } from './text.js'

export function helpText(config) {
  return config.helpText || [
    `🤖 DSH ${config.platformLabel || 'IM'} 助手`,
    '',
    '/new · /reset · /新会话 — 取消当前任务并开启新会话',
    '/stop · /cancel · /停止 — 中断当前任务',
    '/status · /状态 — 查看连接与会话状态',
    '/whoami · /我是谁 — 查看当前身份与会话',
    '/ping · /在吗 — 连通性检查',
    '/help · /? · /帮助 — 显示帮助',
    '',
    `工作目录：${config.cwd || '默认'}`,
    '其他消息会交给 Agent 处理；群成员共享当前群会话。',
  ].join('\n')
}

export async function executeCommand(command, context) {
  const { config, message, state, delivery, snapshot, selection, stop, reset } = context
  switch (command.name) {
    case 'help':
      await delivery.notice(helpText(config))
      return true
    case 'ping':
      await delivery.notice('pong')
      return true
    case 'whoami':
      await delivery.notice([
        '👤 当前身份',
        `connection: ${message.connectionId}`,
        `platform: ${message.platform}`,
        `userid: ${message.userId}`,
        `chattype: ${message.chatType}`,
        `chatid: ${message.chatId}`,
        `session: ${state.sessionId || '尚未创建'}`,
      ].join('\n'))
      return true
    case 'status': {
      const current = snapshot()
      const connection = current.connection || {}
      const selected = selection() || {}
      const model = [selected.provider, selected.model].filter(Boolean).join('/') || '默认'
      const effort = selected.reasoningEffort ? ` · ${selected.reasoningEffort}` : ''
      await delivery.notice([
        '📊 当前状态',
        `连接：${connection.state || 'unknown'}${connection.authenticated ? '（已认证）' : ''}`,
        `模型：${model}${effort}`,
        `任务：${state.running ? '执行中' : '空闲'} · 排队 ${state.queue?.length || 0}`,
        `累计任务：${state.turns || 0} · 运行 ${formatDuration(current.uptimeMs || 0)}`,
        `工作目录：${config.cwd}`,
        connection.detail ? `备注：${connection.detail}` : '',
      ].filter(Boolean).join('\n'))
      return true
    }
    case 'stop': {
      const stopped = await stop()
      await delivery.notice(stopped ? '⏹ 已请求停止当前任务。' : '当前没有在跑的任务。')
      return true
    }
    case 'new':
      await reset()
      await delivery.notice('🆕 已开启新会话，之前的上下文不会带过来。')
      return true
    default:
      await delivery.notice(`未识别的命令。\n\n${helpText(config)}`)
      return true
  }
}
