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
    barTitle: '{count} 条评论',
    barHint: '将在下一条消息中一并发送',
    remove: '删除这条评论',
    clear: '清空',
    clearTitle: '清空全部评论',
    summary: '{chars} 字',
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
    barTitle: '{count} comments',
    barHint: 'Sent with your next message',
    remove: 'Delete this comment',
    clear: 'Clear',
    clearTitle: 'Clear all comments',
    summary: '{chars} chars',
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
.cowrite-bar {
  margin: 0 0 8px; padding: 9px 11px 7px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(15, 23, 42, 0.12));
  border-radius: 14px;
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, #ffffff) 92%, transparent);
  box-shadow: var(--dsw-elevation-soft, 0 4px 16px rgba(2, 8, 20, 0.06));
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
}
.cowrite-bar-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
.cowrite-bar-title { color: var(--dsw-alias-label-primary, #1f2328); font-size: 12px; font-weight: 600; }
.cowrite-bar-clear {
  border: 0; border-radius: 6px; padding: 2px 6px; background: transparent;
  color: var(--dsw-alias-label-tertiary, #8a8f98); font: inherit; font-size: 11px; cursor: pointer;
}
.cowrite-bar-clear:hover { color: var(--dsw-alias-label-error, #c62828); background: var(--dsw-alias-interactive-bg-hover, rgba(15, 23, 42, 0.05)); }
.cowrite-bar-list { display: flex; flex-direction: column; gap: 5px; max-height: 190px; overflow: auto; scrollbar-width: thin; }
.cowrite-quote {
  display: flex; align-items: flex-start; gap: 8px; padding: 6px 7px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(15, 23, 42, 0.08)); border-radius: 9px;
  background: var(--dsw-alias-bg-base, #ffffff);
}
.cowrite-num {
  display: grid; place-items: center; flex: none; width: 20px; height: 20px; margin-top: 1px;
  border-radius: 50%; background: var(--dsw-alias-brand-primary, #4d6bfe);
  color: var(--dsw-alias-label-primary-inverted, #ffffff); font-size: 11px; font-weight: 600;
}
.cowrite-quote-main { flex: 1; min-width: 0; }
.cowrite-quote-meta {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--dsw-alias-label-tertiary, #8a8f98); font-size: 10.5px;
}
.cowrite-quote-text {
  margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--dsw-alias-label-secondary, #5f6368); font-size: 11.5px;
}
.cowrite-quote-comment {
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  margin-top: 2px; color: var(--dsw-alias-label-primary, #1f2328); font-size: 12px; line-height: 1.45;
}
.cowrite-remove {
  display: grid; place-items: center; flex: none; width: 22px; height: 22px; padding: 0;
  border: 0; border-radius: 5px; background: transparent; color: var(--dsw-alias-label-tertiary, #8a8f98);
  font: inherit; font-size: 16px; line-height: 1; cursor: pointer;
}
.cowrite-remove:hover { color: var(--dsw-alias-label-error, #c62828); background: var(--dsw-alias-interactive-bg-hover-danger, rgba(198, 40, 40, 0.08)); }
.cowrite-bar-hint { margin-top: 5px; color: var(--dsw-alias-label-tertiary, #8a8f98); font-size: 10.5px; }
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
  if (start.closest('[data-composer-seat], button, input, textarea, select, [contenteditable="true"]') !== null) return null
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
        nextText = nextText.trim() === '' ? built.text : `${nextText}\n\n${built.text}`
        attached = true
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

function createReviewBar(React, store, t, lang) {
  function ReviewBar({ sessionId }) {
    const [comments, setComments] = React.useState(() => sessionId === undefined ? [] : store.get(sessionId))
    React.useEffect(() => {
      if (sessionId === undefined) {
        setComments([])
        return undefined
      }
      setComments(store.get(sessionId))
      return store.subscribe(sessionId, () => setComments(store.get(sessionId)))
    }, [sessionId])
    if (sessionId === undefined || !Array.isArray(comments) || comments.length === 0) return null
    const rows = comments.map((comment, index) => {
      const location = locationLine(comment, lang)
      const meta = location === '' ? comment.label : `${comment.label} · ${location}`
      return React.createElement('article', { className: 'cowrite-quote', key: comment.id },
        React.createElement('span', { className: 'cowrite-num' }, String(index + 1)),
        React.createElement('div', { className: 'cowrite-quote-main' },
          React.createElement('div', { className: 'cowrite-quote-meta', title: meta }, meta),
          React.createElement('div', { className: 'cowrite-quote-text', title: comment.content }, summarize(comment.content, 180)),
          React.createElement('div', { className: 'cowrite-quote-comment', title: comment.comment }, comment.comment),
        ),
        React.createElement('button', {
          type: 'button',
          className: 'cowrite-remove',
          title: t.remove,
          'aria-label': t.remove,
          onClick: () => store.remove(sessionId, comment.id),
        }, '×'),
      )
    })
    const size = totalSize(comments)
    return React.createElement('section', {
      className: 'cowrite-bar',
      'data-co-write-bar': '',
      'aria-label': interpolate(t.barTitle, { count: comments.length }),
      'aria-live': 'polite',
    },
    React.createElement('div', { className: 'cowrite-bar-head' },
      React.createElement('span', { className: 'cowrite-bar-title' }, interpolate(t.barTitle, { count: comments.length })),
      React.createElement('span', { className: 'cowrite-bar-title', style: { fontWeight: 400, color: 'var(--dsw-alias-label-tertiary)' } }, interpolate(t.summary, { chars: size })),
      React.createElement('button', {
        type: 'button',
        className: 'cowrite-bar-clear',
        title: t.clearTitle,
        onClick: () => store.clear(sessionId),
      }, t.clear),
    ),
    React.createElement('div', { className: 'cowrite-bar-list' }, rows),
    React.createElement('div', { className: 'cowrite-bar-hint' }, t.barHint),
    )
  }
  ReviewBar.displayName = 'CoWriteReviewBar'
  return ReviewBar
}

function install(ctx, React) {
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

  const ReviewBar = createReviewBar(React, store, t, lang)
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'co-write.comments',
    order: 60,
  }, ReviewBar))
}
