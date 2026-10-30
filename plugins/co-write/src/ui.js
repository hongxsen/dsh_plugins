/** Browser half of the Co-write plugin: selection comments and the pending-review bar above the composer. */
/* eslint-disable no-undef */

const COMMENT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 5.5h15v10h-8l-4.5 3v-3H4.5v-10Z"/><path d="M8 9h8M8 12h5"/></svg>'

const STRINGS = {
  zh: {
    comment: '评论',
    editorTitle: '添加评论',
    quoteLabel: '原文',
    placeholder: '写下你对这段内容的评论…',
    confirm: '确认',
    cancel: '取消',
    shortcut: '⌘/Ctrl + Enter 确认',
    emptyComment: '请先写评论。',
    tooLong: '评论或原文太长，请删减后再确认。',
    sourceUser: '对话 · 用户消息',
    sourceAssistant: '对话 · 助手回复',
    sourceChat: '对话',
    sourceFile: '工作区 · {path}',
    sourceWorkspaceFile: '工作区文件',
    barTitle: '{count} 条引用',
    barHint: '将在下一条消息中一并发送 · 点击引用可修改评论',
    more: '+{count}',
    less: '收起',
    detailTitle: '引用详情',
    detailDelete: '删除',
    detailCancel: '取消',
    detailSave: '保存',
    detailPlaceholder: '修改这条评论…',
    detailEmpty: '评论不能为空。',
    detailTooLong: '内容太长，请删减后再保存。',
    refsChip: '{count} 条引用',
    refsHint: '点击查看引用内容',
    refsQuote: '原文',
    refsComment: '评论',
    refsClose: '收起',
    remove: '删除这条引用',
    clear: '清空',
    clearTitle: '清空全部引用',
  },
  en: {
    comment: 'Comment',
    editorTitle: 'Add a comment',
    quoteLabel: 'Quoted text',
    placeholder: 'Write your comment on this selection…',
    confirm: 'Add',
    cancel: 'Cancel',
    shortcut: '⌘/Ctrl + Enter to add',
    emptyComment: 'Write a comment first.',
    tooLong: 'The comment or excerpt is too long. Trim it and confirm again.',
    sourceUser: 'Conversation · User',
    sourceAssistant: 'Conversation · Assistant',
    sourceChat: 'Conversation',
    sourceFile: 'Workspace · {path}',
    sourceWorkspaceFile: 'Workspace file',
    barTitle: '{count} quotes',
    barHint: 'Sent with your next message · click a quote to edit its comment',
    more: '+{count}',
    less: 'Less',
    detailTitle: 'Quote details',
    detailDelete: 'Delete',
    detailCancel: 'Cancel',
    detailSave: 'Save',
    detailPlaceholder: 'Edit this comment…',
    detailEmpty: 'A comment cannot be empty.',
    detailTooLong: 'The content is too long. Trim it and save again.',
    refsChip: '{count} quotes',
    refsHint: 'Click to view the quoted content',
    refsQuote: 'Quoted text',
    refsComment: 'Comment',
    refsClose: 'Hide',
    remove: 'Delete this quote',
    clear: 'Clear',
    clearTitle: 'Clear all quotes',
  },
}

const SELECTION_CSS = `
:host { position: fixed; inset: 0; z-index: 9999; display: block; pointer-events: none; }
* { box-sizing: border-box; }
.cw-comment {
  position: fixed; display: inline-flex; align-items: center; gap: 5px;
  height: 28px; padding: 0 11px 0 9px; border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l3, rgba(15, 23, 42, 0.18));
  background: var(--dsw-alias-button-floating-fill, var(--dsw-alias-bg-layer-1, #ffffff));
  color: var(--dsw-alias-label-primary, #1f2328);
  box-shadow: var(--dsw-elevation-panel, 0 6px 20px rgba(2, 8, 20, 0.18));
  font-family: var(--dsw-font-family, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
  font-size: 12px; line-height: 1; cursor: pointer; pointer-events: auto;
  white-space: nowrap;
}
.cw-comment:hover { background: var(--dsw-alias-button-floating-hover, var(--dsw-alias-interactive-bg-hover, #f1f3f5)); }
.cw-comment:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, #4d6bfe); outline-offset: 2px; }
.cw-comment svg { width: 14px; height: 14px; flex: none; }
.cw-editor {
  position: fixed; display: flex; flex-direction: column; gap: 8px;
  width: min(390px, calc(100vw - 16px)); max-height: min(64vh, 460px);
  padding: 12px; border-radius: 14px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(15, 23, 42, 0.14));
  background: var(--dsw-alias-bg-layer-1, #ffffff);
  box-shadow: var(--dsw-elevation-prominent, 0 24px 64px rgba(2, 8, 20, 0.32));
  color: var(--dsw-alias-label-primary, #1f2328);
  font-family: var(--dsw-font-family, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
  font-size: 12.5px; pointer-events: auto;
}
.cw-comment[hidden], .cw-editor[hidden] { display: none; }
.cw-editor-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
.cw-editor-title { flex: none; font-size: 12.5px; font-weight: 600; }
.cw-editor-source {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--dsw-alias-label-tertiary, #8a8f98); font-size: 11px;
}
.cw-quote-label { color: var(--dsw-alias-label-tertiary, #8a8f98); font-size: 10.5px; flex: none; }
.cw-quote {
  max-height: 104px; overflow: auto; padding: 6px 8px; border-radius: 8px;
  background: var(--dsw-alias-markdown-code-block, #f6f8fa);
  color: var(--dsw-alias-label-secondary, #4b5563);
  font-family: var(--dsw-font-markdown-code-font-family, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 11px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere;
}
.cw-input {
  width: 100%; min-height: 78px; max-height: 170px; resize: vertical; padding: 8px 9px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(15, 23, 42, 0.16)); border-radius: 9px;
  background: var(--dsw-alias-bg-base, #ffffff); color: var(--dsw-alias-label-primary, #1f2328);
  font: inherit; line-height: 1.5; outline: none;
}
.cw-input:focus {
  border-color: var(--dsw-alias-brand-primary, #4d6bfe);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 14%, transparent);
}
.cw-error { color: var(--dsw-alias-label-error, #c62828); font-size: 11px; }
.cw-error[hidden] { display: none; }
.cw-actions { display: flex; align-items: center; gap: 8px; }
.cw-shortcut { flex: 1; min-width: 0; color: var(--dsw-alias-label-tertiary, #8a8f98); font-size: 10.5px; }
.cw-btn {
  display: inline-flex; align-items: center; justify-content: center; min-height: 28px; padding: 0 11px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(15, 23, 42, 0.14)); border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1, #ffffff); color: var(--dsw-alias-label-primary, #1f2328);
  font: inherit; font-size: 12px; cursor: pointer;
}
.cw-btn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(15, 23, 42, 0.05)); }
.cw-btn.primary { background: var(--dsw-alias-brand-primary, #4d6bfe); border-color: transparent; color: var(--dsw-alias-label-primary-inverted, #ffffff); }
.cw-btn.primary:hover { background: var(--dsw-alias-button-primary-hover, #3d59e5); }
`

const BAR_CSS = `
.cowrite-pending-row {
  box-sizing: border-box; width: calc(100% - 36px); margin: 0 auto 8px;
  display: flex; flex-wrap: wrap; align-items: center; align-content: flex-start; justify-content: flex-start;
  gap: 5px 6px; padding: 0; background: none; overflow: visible;
}
.cowrite-pending-item {
  display: inline-flex; align-items: center; flex: none; max-width: 230px; height: 26px;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(15, 23, 42, 0.14));
  background: var(--dsw-alias-bg-layer-1, #ffffff);
  box-shadow: var(--dsw-elevation-soft, 0 3px 10px rgba(2, 8, 20, 0.06));
  color: var(--dsw-alias-label-secondary, #5f6368);
  font: inherit; font-size: 11.5px; white-space: nowrap;
}
.cowrite-pending-item:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(15, 23, 42, 0.05)); color: var(--dsw-alias-label-primary, #1f2328); }
.cowrite-pending-open {
  display: inline-flex; flex: 1; align-items: center; gap: 5px; min-width: 0; height: 100%; overflow: hidden;
  padding: 0 2px 0 5px; border: 0; border-radius: 999px 0 0 999px; background: transparent;
  color: inherit; font: inherit; cursor: pointer;
}
.cowrite-pending-num {
  display: grid; place-items: center; flex: none; width: 16px; height: 16px;
  border-radius: 50%; background: var(--dsw-alias-brand-primary, #4d6bfe);
  color: var(--dsw-alias-label-primary-inverted, #ffffff); font-size: 10px; font-weight: 600;
}
.cowrite-pending-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--dsw-alias-label-tertiary, #8a8f98); }
.cowrite-pending-delete {
  display: grid; place-items: center; flex: none; width: 18px; height: 18px; margin: 0 3px 0 0; padding: 0;
  border: 0; border-radius: 50%; background: transparent; color: var(--dsw-alias-label-tertiary, #8a8f98);
  font: inherit; font-size: 13px; line-height: 1; cursor: pointer;
}
.cowrite-pending-delete:hover { color: var(--dsw-alias-label-error, #c62828); background: var(--dsw-alias-interactive-bg-hover-danger, rgba(198, 40, 40, 0.1)); }
.cowrite-pending-more {
  display: inline-flex; align-items: center; flex: none; height: 26px; padding: 0 10px;
  border: 1px dashed var(--dsw-alias-border-l2, rgba(15, 23, 42, 0.18)); border-radius: 999px;
  background: transparent; color: var(--dsw-alias-label-tertiary, #8a8f98);
  font: inherit; font-size: 11px; cursor: pointer;
}
.cowrite-pending-more:hover { color: var(--dsw-alias-label-primary, #1f2328); background: var(--dsw-alias-interactive-bg-hover, rgba(15, 23, 42, 0.05)); }
.cowrite-pending-clear {
  flex: none; align-self: center; border: 0; border-radius: 5px; padding: 2px 5px; background: transparent;
  color: var(--dsw-alias-label-tertiary, #8a8f98); font: inherit; font-size: 11px; cursor: pointer;
}
.cowrite-pending-clear:hover { color: var(--dsw-alias-label-error, #c62828); background: var(--dsw-alias-interactive-bg-hover, rgba(15, 23, 42, 0.05)); }
.cowrite-popover {
  box-sizing: border-box; position: fixed; z-index: 10000; display: flex; flex-direction: column; gap: 8px;
  padding: 12px; border: 1px solid var(--dsw-alias-border-l2, rgba(15, 23, 42, 0.14));
  border-radius: 12px; background: var(--dsw-alias-bg-layer-1, #ffffff);
  box-shadow: var(--dsw-elevation-prominent, 0 18px 48px rgba(2, 8, 20, 0.28));
  color: var(--dsw-alias-label-primary, #1f2328); overflow: auto;
  font-family: var(--dsw-font-family, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
  font-size: 12.5px;
}
.cowrite-popover-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
.cowrite-popover-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; font-weight: 600; }
.cowrite-popover-meta { flex: none; color: var(--dsw-alias-label-tertiary, #8a8f98); font-size: 10.5px; }
.cowrite-popover-close {
  margin-left: auto; flex: none; display: grid; place-items: center; width: 24px; height: 24px;
  padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-tertiary, #8a8f98);
  font: inherit; font-size: 17px; line-height: 1; cursor: pointer;
}
.cowrite-popover-close:hover { color: var(--dsw-alias-label-primary, #1f2328); background: var(--dsw-alias-interactive-bg-hover, rgba(15, 23, 42, 0.05)); }
.cowrite-popover-quote {
  max-height: 180px; overflow: auto; padding: 7px 9px; border-radius: 8px;
  background: var(--dsw-alias-markdown-code-block, #f6f8fa); color: var(--dsw-alias-label-secondary, #4b5563);
  font-family: var(--dsw-font-markdown-code-font-family, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 10.5px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere;
}
.cowrite-popover-input {
  width: 100%; min-height: 84px; max-height: 200px; resize: vertical; padding: 7px 8px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(15, 23, 42, 0.16)); border-radius: 8px;
  background: var(--dsw-alias-bg-base, #ffffff); color: var(--dsw-alias-label-primary, #1f2328);
  font: inherit; line-height: 1.5; outline: none;
}
.cowrite-popover-input:focus { border-color: var(--dsw-alias-brand-primary, #4d6bfe); box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 14%, transparent); }
.cowrite-popover-error { color: var(--dsw-alias-label-error, #c62828); font-size: 10.5px; }
.cowrite-popover-actions { display: flex; justify-content: flex-end; gap: 6px; }
.cowrite-popover-btn {
  min-height: 27px; padding: 0 10px; border: 1px solid var(--dsw-alias-border-l2, rgba(15, 23, 42, 0.14));
  border-radius: 7px; background: var(--dsw-alias-bg-layer-1, #ffffff); color: var(--dsw-alias-label-primary, #1f2328);
  font: inherit; font-size: 11.5px; cursor: pointer;
}
.cowrite-popover-btn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(15, 23, 42, 0.05)); }
.cowrite-popover-btn.primary { background: var(--dsw-alias-brand-primary, #4d6bfe); border-color: transparent; color: var(--dsw-alias-label-primary-inverted, #ffffff); }
.cowrite-popover-btn:disabled { opacity: 0.45; cursor: default; }
.cowrite-refs { display: inline-flex; flex-direction: column; align-items: flex-start; max-width: 100%; margin-top: 4px; vertical-align: top; }
.cowrite-refs-toggle {
  display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 10px 0 8px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(15, 23, 42, 0.14)); border-radius: 999px;
  background: var(--dsw-alias-bg-layer-1, #ffffff); color: var(--dsw-alias-label-secondary, #5f6368);
  font: inherit; font-size: 12px; cursor: pointer;
}
.cowrite-refs-toggle:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(15, 23, 42, 0.05)); color: var(--dsw-alias-label-primary, #1f2328); }
.cowrite-refs-icon { width: 14px; height: 14px; flex: none; }
.cowrite-refs-chevron { color: var(--dsw-alias-label-tertiary, #8a8f98); font-size: 10px; }
.cowrite-refs-panel {
  margin-top: 6px; padding: 8px; border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(15, 23, 42, 0.12));
  background: var(--dsw-alias-bg-base, #ffffff); max-height: 260px; overflow: auto;
}
.cowrite-refs-section { padding: 6px 0; border-top: 1px solid var(--dsw-alias-border-l1, rgba(15, 23, 42, 0.08)); }
.cowrite-refs-section:first-child { padding-top: 0; border-top: 0; }
.cowrite-refs-head { display: flex; align-items: baseline; gap: 6px; min-width: 0; color: var(--dsw-alias-label-primary, #1f2328); font-size: 11.5px; font-weight: 600; }
.cowrite-refs-meta { color: var(--dsw-alias-label-tertiary, #8a8f98); font-size: 10.5px; font-weight: 400; }
.cowrite-refs-quote {
  margin-top: 3px; padding: 5px 7px; border-radius: 6px; max-height: 130px; overflow: auto;
  background: var(--dsw-alias-markdown-code-block, #f6f8fa); color: var(--dsw-alias-label-secondary, #4b5563);
  font-family: var(--dsw-font-markdown-code-font-family, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 10.5px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere;
}
.cowrite-refs-comment { margin-top: 3px; color: var(--dsw-alias-label-primary, #1f2328); font-size: 11.5px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
.cowrite-refs-raw { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 11px; color: var(--dsw-alias-label-secondary, #5f6368); }
`


function isChineseLocale(value) {
  return typeof value === 'string' && /^zh\b/iu.test(value.trim())
}

function localeLanguageOf(ctx) {
  try {
    const service = ctx.get('locale')
    const active = service && typeof service.getLocale === 'function'
      ? service.getLocale().active
      : undefined
    if (typeof active === 'string' && active !== '') return isChineseLocale(active) ? 'zh' : 'en'
  } catch { /* fall through */ }
  const navigatorLanguage = typeof navigator === 'undefined' ? '' : navigator.language
  return isChineseLocale(navigatorLanguage) ? 'zh' : 'en'
}

function interpolate(template, values) {
  return template.replace(/\{(\w+)\}/gu, (match, key) => (key in values ? String(values[key]) : match))
}

function elementOf(node) {
  if (node === null || node === undefined) return null
  return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement
}

function safeGet(ctx, name) {
  try { return ctx.get(name) } catch { return undefined }
}

function currentSessionId(ctx) {
  try {
    const rows = Object.values(ctx.sessions.list.getSnapshot().byId)
    return rows.find(row => (row.retainedBy.mainView ?? 0) > 0)?.id
  } catch {
    return undefined
  }
}

function lineOf(node) {
  if (node === null || node === undefined) return undefined
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement
  const line = element?.closest('[data-textpreview-line]')
  return line === null || line === undefined ? undefined : line.getAttribute('data-textpreview-line')
}

function lineRangeOf(range) {
  const start = lineOf(range.startContainer)
  const end = lineOf(range.endContainer)
  let startLine = start === undefined ? undefined : Number(start)
  let endLine = end === undefined ? undefined : Number(end)
  if (Number.isFinite(startLine) && Number.isFinite(endLine) && startLine > endLine) {
    [startLine, endLine] = [endLine, startLine]
  }
  return {
    ...Number.isInteger(startLine) ? { startLine } : {},
    ...Number.isInteger(endLine) ? { endLine } : {},
  }
}

function firstRangeRect(range) {
  const rects = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0)
  return rects.length > 0 ? rects[0] : range.getBoundingClientRect()
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max))
}

function contextOfSelection(ctx, t) {
  const selection = window.getSelection()
  if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return null
  const range = selection.getRangeAt(0)
  if (!range.startContainer.isConnected || !range.endContainer.isConnected) return null
  const start = elementOf(range.startContainer)
  const end = elementOf(range.endContainer)
  if (start === null || end === null) return null
  if (start.closest('#dsh-co-write-layer') !== null) return null
  if (start.closest('[data-composer-seat], [data-text-interaction-exclude], button, input, textarea, select, [contenteditable="true"]') !== null) return null
  const content = selection.toString().replace(/\u00a0/gu, ' ').trim()
  if (content === '') return null

  const chat = start.closest('[data-conversation-region="chat"]')
  if (chat !== null && chat.contains(end)) {
    const sessionId = chat.getAttribute('data-conversation-session') || currentSessionId(ctx)
    if (!sessionId) return null
    const seat = start.closest('[data-chat-flow-kind]')
    const kind = seat?.getAttribute('data-chat-flow-kind') ?? ''
    const role = kind === 'user' || kind === 'steering' ? 'user'
      : kind === 'assistant-step' ? 'assistant'
        : undefined
    const turn = Number(seat?.getAttribute('data-chat-turn') ?? NaN)
    return {
      sessionId,
      source: 'chat',
      label: role === 'user' ? t.sourceUser : role === 'assistant' ? t.sourceAssistant : t.sourceChat,
      content,
      meta: {
        ...role === undefined ? {} : { role },
        ...Number.isInteger(turn) ? { turn } : {},
      },
    }
  }

  const preview = start.closest('[data-textpreview-state]')
  if (preview !== null && preview.contains(end)
    && start.closest('[data-files-navigator], [data-files-body], [data-textpreview-path]') === null) {
    const sessionId = currentSessionId(ctx)
    if (!sessionId) return null
    const pathElement = preview.querySelector('[data-textpreview-path]')
    const path = (pathElement?.textContent ?? '').trim()
    return {
      sessionId,
      source: 'file',
      label: path === '' ? t.sourceWorkspaceFile : interpolate(t.sourceFile, { path }),
      content,
      meta: {
        ...path === '' ? {} : { path },
        ...lineRangeOf(range),
      },
    }
  }
  return null
}

function createCommentStore(lang) {
  const sessions = new Map()
  const listeners = new Map()
  const load = sessionId => {
    try {
      const raw = window.localStorage.getItem(storageKey(sessionId))
      return raw === null ? [] : normalizeComments(JSON.parse(raw))
    } catch {
      return []
    }
  }
  const ensure = sessionId => {
    let comments = sessions.get(sessionId)
    if (comments === undefined) {
      comments = load(sessionId)
      sessions.set(sessionId, comments)
    }
    return comments
  }
  const save = sessionId => {
    try {
      window.localStorage.setItem(storageKey(sessionId), JSON.stringify(ensure(sessionId)))
    } catch { /* storage may be unavailable */ }
  }
  const notify = sessionId => {
    for (const listener of [...(listeners.get(sessionId) ?? [])]) listener()
  }
  return {
    get(sessionId) {
      return ensure(sessionId)
    },
    subscribe(sessionId, listener) {
      let set = listeners.get(sessionId)
      if (set === undefined) {
        set = new Set()
        listeners.set(sessionId, set)
      }
      set.add(listener)
      return () => {
        set.delete(listener)
        if (set.size === 0) listeners.delete(sessionId)
      }
    },
    add(sessionId, comment) {
      const next = [...ensure(sessionId), comment]
      const built = buildCommentMessage(next, lang)
      if (built.error !== null) return { ok: false, error: built.error }
      sessions.set(sessionId, next)
      save(sessionId)
      notify(sessionId)
      return { ok: true }
    },
    update(sessionId, id, comment) {
      const text = cleanText(comment).trim()
      if (text === '') return { ok: false, error: 'empty' }
      const current = ensure(sessionId)
      if (!current.some(item => item.id === id)) return { ok: false, error: 'missing' }
      const next = current.map(item => item.id === id ? { ...item, comment: text } : item)
      const built = buildCommentMessage(next, lang)
      if (built.error !== null) return { ok: false, error: built.error }
      sessions.set(sessionId, next)
      save(sessionId)
      notify(sessionId)
      return { ok: true }
    },
    remove(sessionId, id) {
      const next = ensure(sessionId).filter(comment => comment.id !== id)
      sessions.set(sessionId, next)
      save(sessionId)
      notify(sessionId)
    },
    clear(sessionId) {
      sessions.set(sessionId, [])
      save(sessionId)
      notify(sessionId)
    },
  }
}

const SEND_HOOK = Symbol.for('@hongxsen/dsh-co-write.sendHook')

function installSendHook(ctx, store, lang) {
  const conversation = safeGet(ctx, 'conversation')
  if (conversation === undefined || typeof conversation.sendSession !== 'function') return () => {}
  if (conversation[SEND_HOOK] !== undefined) return () => {}
  const original = conversation.sendSession
  const wrapper = async function (session, text, attachmentIds, mode, signal, accept) {
    const pending = store.get(session.sessionId)
    let nextText = typeof text === 'string' ? text : ''
    let attached = false
    if (pending.length > 0) {
      const built = buildCommentMessage(pending, lang)
      if (built.error === null) {
        // A second wrapper from a hot reload must not append the same section again.
        if (hasRefsMarker(nextText)) {
          attached = true
        } else {
          nextText = nextText.trim() === '' ? built.text : `${nextText}\n\n${built.text}`
          attached = true
        }
      }
    }
    const outcome = await original.call(this, session, nextText, attachmentIds, mode, signal, accept)
    if (attached && outcome !== undefined && outcome !== null && outcome.kind === 'success') {
      store.clear(session.sessionId)
    }
    return outcome
  }
  try {
    Object.defineProperty(conversation, 'sendSession', {
      configurable: true,
      writable: true,
      value: wrapper,
    })
    conversation[SEND_HOOK] = wrapper
  } catch {
    return () => {}
  }
  return () => {
    try {
      if (conversation.sendSession === wrapper) {
        delete conversation.sendSession
        if (conversation.sendSession !== original) conversation.sendSession = original
      }
      delete conversation[SEND_HOOK]
    } catch { /* ignore */ }
  }
}

class SelectionLayer {
  constructor(ctx, store, t, lang) {
    this.ctx = ctx
    this.store = store
    this.t = t
    this.lang = lang
    this.host = null
    this.root = null
    this.button = null
    this.editor = null
    this.textarea = null
    this.source = null
    this.quote = null
    this.error = null
    this.current = null
    this.editorOpen = false
    this.checkTimer = 0
    this.frame = 0
    this.listeners = []
  }

  mount() {
    this.host = document.createElement('div')
    this.host.id = 'dsh-co-write-layer'
    this.root = this.host.attachShadow({ mode: 'open' })
    this.root.innerHTML = `<style>${SELECTION_CSS}</style>
      <button type="button" class="cw-comment" data-act="comment" aria-haspopup="dialog" hidden>${COMMENT_ICON}<span>${this.t.comment}</span></button>
      <div class="cw-editor" role="dialog" aria-label="${this.t.editorTitle}" hidden>
        <div class="cw-editor-head">
          <span class="cw-editor-title">${this.t.editorTitle}</span>
          <span class="cw-editor-source" data-source></span>
        </div>
        <div class="cw-editor-head"><span class="cw-quote-label">${this.t.quoteLabel}</span></div>
        <div class="cw-quote" data-quote></div>
        <textarea class="cw-input" data-input rows="3" placeholder="${this.t.placeholder}" aria-label="${this.t.placeholder}"></textarea>
        <div class="cw-error" data-error hidden></div>
        <div class="cw-actions">
          <span class="cw-shortcut">${this.t.shortcut}</span>
          <button type="button" class="cw-btn" data-act="cancel">${this.t.cancel}</button>
          <button type="button" class="cw-btn primary" data-act="confirm">${this.t.confirm}</button>
        </div>
      </div>`
    document.body.appendChild(this.host)
    this.button = this.root.querySelector('[data-act="comment"]')
    this.editor = this.root.querySelector('.cw-editor')
    this.textarea = this.root.querySelector('[data-input]')
    this.source = this.root.querySelector('[data-source]')
    this.quote = this.root.querySelector('[data-quote]')
    this.error = this.root.querySelector('[data-error]')

    this.listen(this.button, 'pointerdown', event => { event.preventDefault() })
    this.listen(this.button, 'click', () => this.openEditor())
    this.listen(this.editor.querySelector('[data-act="cancel"]'), 'click', () => this.cancel())
    this.listen(this.editor.querySelector('[data-act="confirm"]'), 'click', () => this.confirm())
    this.listen(this.textarea, 'input', () => this.showError(null))
    this.listen(this.textarea, 'keydown', event => this.onEditorKeyDown(event))

    this.listen(document, 'pointerdown', event => this.onPointerDown(event), true)
    this.listen(document, 'pointerup', event => this.onPointerUp(event), true)
    this.listen(document, 'keyup', event => this.onKeyUp(event), true)
    this.listen(document, 'selectionchange', () => this.onSelectionChange(), true)
    this.listen(document, 'scroll', () => this.onScroll(), true)
    this.listen(window, 'resize', () => this.reposition())
  }

  listen(target, type, handler, capture = false) {
    const bound = typeof handler === 'function' ? handler : () => {}
    target.addEventListener(type, bound, capture)
    this.listeners.push(() => target.removeEventListener(type, bound, capture))
  }

  dispose() {
    for (const remove of this.listeners.splice(0)) remove()
    clearTimeout(this.checkTimer)
    cancelAnimationFrame(this.frame)
    if (this.host !== null && this.host.parentNode !== null) this.host.parentNode.removeChild(this.host)
    this.host = null
    this.root = null
    this.current = null
  }

  inside(event) {
    return this.host !== null && typeof event.composedPath === 'function' && event.composedPath().includes(this.host)
  }

  onPointerDown(event) {
    if (this.inside(event)) return
    if (this.editorOpen) this.cancel()
    else this.hideButton()
  }

  onPointerUp(event) {
    if (this.inside(event)) return
    this.scheduleCheck()
  }

  onKeyUp(event) {
    if (this.inside(event)) return
    if (event.key === 'Escape') {
      this.cancel()
      return
    }
    this.scheduleCheck()
  }

  onSelectionChange() {
    if (this.editorOpen) return
    const active = this.host?.shadowRoot?.activeElement
    if (active !== null && active !== undefined) return
    this.scheduleCheck()
  }

  scheduleCheck() {
    clearTimeout(this.checkTimer)
    this.checkTimer = window.setTimeout(() => this.checkSelection(), 120)
  }

  checkSelection() {
    if (this.editorOpen) return
    const context = contextOfSelection(this.ctx, this.t)
    if (context === null) {
      this.current = null
      this.hideButton()
      return
    }
    const selection = window.getSelection()
    if (selection === null || selection.rangeCount === 0) {
      this.current = null
      this.hideButton()
      return
    }
    this.current = { ...context, range: selection.getRangeAt(0).cloneRange() }
    this.showButton()
  }

  showButton() {
    if (this.current === null || this.editorOpen) return
    this.editor.hidden = true
    this.button.hidden = false
    this.button.style.visibility = 'hidden'
    this.button.style.left = '0px'
    this.button.style.top = '0px'
    this.positionButton()
  }

  hideButton() {
    if (this.button !== null) this.button.hidden = true
  }

  hideAll() {
    this.button.hidden = true
    this.editor.hidden = true
    this.editorOpen = false
    this.current = null
  }

  openEditor() {
    if (this.current === null) return
    this.editorOpen = true
    this.button.hidden = true
    this.editor.hidden = false
    this.source.textContent = this.current.label
    this.quote.textContent = summarize(this.current.content, 700)
    this.textarea.value = ''
    this.showError(null)
    this.positionEditor()
    requestAnimationFrame(() => {
      this.textarea.focus({ preventScroll: true })
    })
  }

  cancel() {
    this.editorOpen = false
    if (this.editor !== null) this.editor.hidden = true
    if (this.textarea !== null) this.textarea.value = ''
    this.showError(null)
    this.current = null
  }

  confirm() {
    if (this.current === null) return
    const comment = this.textarea.value.trim()
    if (comment === '') {
      this.showError(this.t.emptyComment)
      this.textarea.focus({ preventScroll: true })
      return
    }
    const clipped = clipText(this.current.content)
    const clippedComment = comment.length > MAX_COMMENT
      ? `${comment.slice(0, MAX_COMMENT)}…`
      : comment
    const item = makeComment({
      source: this.current.source,
      label: this.current.label,
      content: clipped.text,
      comment: clippedComment,
      meta: {
        ...this.current.meta,
        ...clipped.truncated ? { truncated: true } : {},
      },
    })
    if (item === null) {
      this.showError(this.t.tooLong)
      return
    }
    const outcome = this.store.add(this.current.sessionId, item)
    if (!outcome.ok) {
      this.showError(this.t.tooLong)
      return
    }
    window.getSelection()?.removeAllRanges()
    this.hideAll()
  }

  showError(message) {
    if (this.error === null) return
    if (message === null) {
      this.error.hidden = true
      this.error.textContent = ''
      return
    }
    this.error.hidden = false
    this.error.textContent = message
  }

  onEditorKeyDown(event) {
    if (event.isComposing) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      this.cancel()
      return
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      event.stopPropagation()
      this.confirm()
    }
  }

  onScroll() {
    if (this.current === null && !this.editorOpen) return
    if (this.editorOpen) this.positionEditor()
    else this.positionButton()
  }

  reposition() {
    if (this.editorOpen) this.positionEditor()
    else if (this.current !== null && this.button !== null && !this.button.hidden) this.positionButton()
  }

  rangeRect() {
    if (this.current === null) return null
    const range = this.current.range
    if (!range.startContainer.isConnected || !range.endContainer.isConnected) return null
    return firstRangeRect(range)
  }

  positionButton() {
    if (this.current === null || this.button === null) return
    const rect = this.rangeRect()
    if (rect === null) {
      this.hideButton()
      return
    }
    const width = this.button.offsetWidth
    const height = this.button.offsetHeight
    if (width === 0 || height === 0) {
      this.hideButton()
      return
    }
    if (rect.bottom < 0 || rect.top > window.innerHeight) {
      this.hideButton()
      return
    }
    const left = clamp(rect.right - width, 8, window.innerWidth - width - 8)
    let top = rect.top - height - 6
    if (top < 8) top = Math.min(window.innerHeight - height - 8, rect.bottom + 6)
    this.button.style.left = `${Math.round(left)}px`
    this.button.style.top = `${Math.round(top)}px`
    this.button.style.visibility = 'visible'
  }

  positionEditor() {
    if (this.current === null || this.editor === null) return
    const rect = this.rangeRect()
    if (rect === null) {
      this.cancel()
      return
    }
    const width = this.editor.offsetWidth
    const height = this.editor.offsetHeight
    if (width === 0 || height === 0) {
      this.cancel()
      return
    }
    const left = clamp(rect.right - width, 8, window.innerWidth - width - 8)
    let top = rect.bottom + 8
    if (top + height > window.innerHeight - 8) top = rect.top - height - 8
    top = clamp(top, 8, window.innerHeight - height - 8)
    this.editor.style.left = `${Math.round(left)}px`
    this.editor.style.top = `${Math.round(top)}px`
  }
}

function createRefsRule() {
  return {
    id: 'co-write-refs',
    order: -20,
    match(text, from) {
      const marker = findRefsMarker(text, from)
      if (marker === undefined) return undefined
      return {
        id: 'co-write-refs',
        start: marker.start,
        end: text.length,
        data: {
          count: marker.count,
          details: text.slice(marker.end).replace(/^\s*\n?/u, '').trim(),
        },
      }
    },
  }
}

function createRefsText(React, t) {
  function CoWriteRefsText({ node }) {
    const [open, setOpen] = React.useState(false)
    const data = node.data ?? {}
    const details = typeof data.details === 'string' ? data.details : ''
    const sections = React.useMemo(() => parseCommentDetails(details), [details])
    const count = sections.length > 0 ? sections.length : Number.isFinite(data.count) ? data.count : 0
    const panel = open ? React.createElement('div', {
      className: 'cowrite-refs-panel',
      'data-text-interaction-exclude': '',
    },
    sections.length > 0
      ? sections.map((section, index) => React.createElement('div', { className: 'cowrite-refs-section', key: index },
        React.createElement('div', { className: 'cowrite-refs-head' },
          `#${section.number} · ${section.title}`,
          section.subtitle === '' ? null : React.createElement('span', { className: 'cowrite-refs-meta' }, section.subtitle),
        ),
        React.createElement('div', { className: 'cowrite-refs-quote' }, section.quote),
        section.comment === '' ? null : React.createElement('div', { className: 'cowrite-refs-comment' }, `${t.refsComment}：${section.comment}`),
      ))
      : React.createElement('pre', { className: 'cowrite-refs-raw' }, details),
    ) : null
    return React.createElement('span', { className: 'cowrite-refs' },
      React.createElement('button', {
        type: 'button',
        className: 'cowrite-refs-toggle',
        title: t.refsHint,
        'aria-expanded': open,
        onClick: () => setOpen(value => !value),
      },
      React.createElement('span', { className: 'cowrite-refs-icon', 'aria-hidden': 'true', dangerouslySetInnerHTML: { __html: COMMENT_ICON } }),
      React.createElement('span', null, interpolate(t.refsChip, { count })),
      React.createElement('span', { className: 'cowrite-refs-chevron', 'aria-hidden': 'true' }, open ? '▾' : '▸'),
      ),
      panel,
    )
  }
  CoWriteRefsText.displayName = 'CoWriteRefsText'
  return CoWriteRefsText
}

function createReviewBar(React, ReactDOM, store, t, lang) {
  const MAX_CHIPS = 3
  function ReviewBar({ sessionId }) {
    const [comments, setComments] = React.useState(() => sessionId === undefined ? [] : store.get(sessionId))
    const [editingId, setEditingId] = React.useState(null)
    const [anchor, setAnchor] = React.useState(null)
    const [showAll, setShowAll] = React.useState(false)
    const [draft, setDraft] = React.useState('')
    const [error, setError] = React.useState(null)
    const popoverRef = React.useRef(null)

    React.useEffect(() => {
      if (sessionId === undefined) {
        setComments([])
        return undefined
      }
      setComments(store.get(sessionId))
      return store.subscribe(sessionId, () => setComments(store.get(sessionId)))
    }, [sessionId])

    React.useEffect(() => {
      if (editingId !== null && !comments.some(comment => comment.id === editingId)) close()
    }, [comments, editingId])

    React.useEffect(() => {
      if (editingId === null) return undefined
      const onKeyDown = event => {
        if (event.key !== 'Escape' || event.isComposing) return
        event.preventDefault()
        event.stopPropagation()
        close()
      }
      const onPointerDown = event => {
        const popover = popoverRef.current
        if (popover !== null && event.target instanceof Node && popover.contains(event.target)) return
        close()
      }
      document.addEventListener('keydown', onKeyDown, true)
      document.addEventListener('pointerdown', onPointerDown, true)
      return () => {
        document.removeEventListener('keydown', onKeyDown, true)
        document.removeEventListener('pointerdown', onPointerDown, true)
      }
    }, [editingId])

    if (sessionId === undefined || !Array.isArray(comments) || comments.length === 0) return null
    const editing = comments.find(comment => comment.id === editingId)
    const visible = showAll || comments.length <= MAX_CHIPS ? comments : comments.slice(0, MAX_CHIPS)
    const hidden = comments.length - visible.length

    function close() {
      setEditingId(null)
      setAnchor(null)
      setDraft('')
      setError(null)
    }
    function open(comment, event) {
      const rect = event.currentTarget.getBoundingClientRect()
      setAnchor({ left: rect.left, top: rect.top })
      setEditingId(comment.id)
      setDraft(comment.comment)
      setError(null)
    }
    function save() {
      if (editing === undefined) return
      const outcome = store.update(sessionId, editing.id, draft)
      if (!outcome.ok) {
        setError(outcome.error === 'empty' ? t.detailEmpty : t.detailTooLong)
        return
      }
      close()
    }
    function remove(commentId) {
      store.remove(sessionId, commentId)
      if (editingId === commentId) close()
    }

    const chips = visible.map(comment => {
      const number = comments.indexOf(comment) + 1
      return React.createElement('span', { className: 'cowrite-pending-item', key: comment.id },
        React.createElement('button', {
          type: 'button',
          className: 'cowrite-pending-open',
          title: `${number}. ${comment.label} — ${comment.comment}`,
          onClick: event => open(comment, event),
        },
        React.createElement('span', { className: 'cowrite-pending-num' }, String(number)),
        React.createElement('span', { className: 'cowrite-pending-text' }, summarize(comment.content, 16)),
        ),
        React.createElement('button', {
          type: 'button',
          className: 'cowrite-pending-delete',
          title: t.remove,
          'aria-label': t.remove,
          onClick: event => { event.stopPropagation(); remove(comment.id) },
        }, '×'),
      )
    })
    if (hidden > 0) {
      chips.push(React.createElement('button', {
        type: 'button',
        key: 'more',
        className: 'cowrite-pending-more',
        onClick: () => setShowAll(true),
      }, interpolate(t.more, { count: hidden })))
    }
    if (showAll && comments.length > MAX_CHIPS) {
      chips.push(React.createElement('button', {
        type: 'button',
        key: 'less',
        className: 'cowrite-pending-more',
        onClick: () => setShowAll(false),
      }, t.less))
    }

    const popoverWidth = Math.min(420, window.innerWidth - 16)
    const popover = editing === undefined || anchor === null ? null : ReactDOM.createPortal(
      React.createElement('div', {
        className: 'cowrite-popover',
        ref: popoverRef,
        role: 'dialog',
        'aria-label': t.detailTitle,
        style: {
          left: `${Math.round(clamp(anchor.left, 8, Math.max(8, window.innerWidth - popoverWidth - 8)))}px`,
          bottom: `${Math.round(Math.max(8, window.innerHeight - anchor.top + 8))}px`,
          width: `${popoverWidth}px`,
          maxHeight: `${Math.round(Math.max(160, anchor.top - 16))}px`,
        },
      },
      React.createElement('div', { className: 'cowrite-popover-head' },
        React.createElement('span', { className: 'cowrite-popover-title' }, `#${comments.indexOf(editing) + 1} · ${editing.label}`),
        locationLine(editing, lang) === '' ? null : React.createElement('span', { className: 'cowrite-popover-meta' }, locationLine(editing, lang)),
        React.createElement('button', {
          type: 'button',
          className: 'cowrite-popover-close',
          title: t.detailCancel,
          onClick: close,
        }, '×'),
      ),
      React.createElement('div', { className: 'cowrite-popover-quote' }, editing.content),
      React.createElement('textarea', {
        className: 'cowrite-popover-input',
        value: draft,
        autoFocus: true,
        placeholder: t.detailPlaceholder,
        'aria-label': t.detailPlaceholder,
        onChange: event => {
          setDraft(event.target.value)
          if (error !== null) setError(null)
        },
        onKeyDown: event => {
          if (event.isComposing) return
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            event.stopPropagation()
            save()
          }
        },
      }),
      error === null ? null : React.createElement('div', { className: 'cowrite-popover-error' }, error),
      React.createElement('div', { className: 'cowrite-popover-actions' },
        React.createElement('button', {
          type: 'button',
          className: 'cowrite-popover-btn',
          onClick: close,
        }, t.detailCancel),
        React.createElement('button', {
          type: 'button',
          className: 'cowrite-popover-btn primary',
          disabled: draft.trim() === '',
          onClick: save,
        }, t.detailSave),
      ),
      ),
      document.body,
    )

    return React.createElement(React.Fragment, null,
      React.createElement('div', {
        className: 'cowrite-pending-row',
        'data-co-write-bar': '',
        'aria-live': 'polite',
        'aria-label': interpolate(t.barTitle, { count: comments.length }),
      },
      chips,
      ),
      popover,
    )
  }
  ReviewBar.displayName = 'CoWriteReviewBar'
  return ReviewBar
}

function install(ctx, React, ReactDOM) {
  const lang = localeLanguageOf(ctx)
  const t = STRINGS[lang]
  const store = createCommentStore(lang)
  let layer = null

  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = '@hongxsen/dsh-co-write'
    style.textContent = BAR_CSS
    document.head.appendChild(style)
    return () => style.remove()
  }, 'co-write: bar styles')

  const disposeSendHook = installSendHook(ctx, store, lang)
  ctx.effect(() => () => disposeSendHook(), 'co-write: send hook')

  layer = new SelectionLayer(ctx, store, t, lang)
  layer.mount()
  ctx.effect(() => () => {
    layer?.dispose()
    layer = null
  }, 'co-write: selection layer')

  ctx.effect(() => ctx.uiConversation.userText.register(createRefsRule()), 'co-write: refs rule')
  const RefsText = createRefsText(React, t)
  ctx.slots.inject('conversation.user.text.node', () => ctx.slots.register({
    name: 'conversation.user.text.node',
    key: 'co-write-refs',
    priority: 100,
  }, RefsText))

  const ReviewBar = createReviewBar(React, ReactDOM, store, t, lang)
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'co-write.comments',
    order: 60,
  }, ReviewBar))
}
