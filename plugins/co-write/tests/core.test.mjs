import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_COMMENT, MAX_EXCERPT, MAX_TOTAL, buildCommentMessage, clipText, formatComment,
  normalizeComment, normalizeComments, quoteLines, sourceLabel, storageKey, summarize, totalSize,
} from '../src/core.mjs'

test('quoteLines prefixes every line and keeps empty lines quoted', () => {
  assert.equal(quoteLines('a\n\nb'), '> a\n>\n> b')
  assert.equal(quoteLines('a\r\nb'), '> a\n> b')
})

test('clipText keeps short text and clips long text with a marker', () => {
  const short = clipText('hello')
  assert.deepEqual(short, { text: 'hello', truncated: false })
  const long = clipText('x'.repeat(MAX_EXCERPT + 10))
  assert.equal(long.truncated, true)
  assert.match(long.text, /已截取前 20000 字/)
  assert.ok(long.text.length > MAX_EXCERPT)
})

test('summarize compresses whitespace and truncates', () => {
  assert.equal(summarize('  a\n\n b  '), 'a b')
  assert.equal(summarize('abcd', 3), 'abc…')
})

test('normalizeComment rejects empty comments and bad sources', () => {
  assert.equal(normalizeComment({ source: 'chat', content: 'text', comment: ' ' }), null)
  assert.equal(normalizeComment({ source: 'nope', content: 'text', comment: 'c' }), null)
  const comment = normalizeComment({
    source: 'file', content: 'abc', comment: 'why', label: '工作区 · a.ts',
    meta: { path: 'src/a.ts', startLine: 3, endLine: 5, role: 7, turn: 2 },
  })
  assert.equal(comment.meta.path, 'src/a.ts')
  assert.equal(comment.meta.startLine, 3)
  assert.equal(comment.meta.endLine, 5)
  assert.equal(comment.meta.turn, 2)
  assert.equal('role' in comment.meta, false)
})

test('normalizeComments drops invalid entries', () => {
  const list = normalizeComments([
    { source: 'chat', content: 'hello', comment: 'c', meta: { role: 'user' } },
    { source: 'chat', content: 'hello' },
    'nope',
  ])
  assert.equal(list.length, 1)
  assert.equal(list[0].comment, 'c')
})

test('source labels and location lines localize', () => {
  const comment = {
    source: 'file', label: '工作区 · app.ts', content: 'x', comment: 'c',
    meta: { path: 'src/app.ts', startLine: 2, endLine: 4 },
  }
  assert.equal(sourceLabel(comment, 'zh'), '工作区 · src/app.ts')
  const block = formatComment(comment, 1, 'zh')
  assert.match(block, /### 评论 1 · 工作区 · app\.ts/)
  assert.match(block, /行 2–4/)
})

test('buildCommentMessage refuses an empty list', () => {
  assert.deepEqual(buildCommentMessage([], 'zh'), { text: '', error: 'empty' })
})

test('buildCommentMessage numbers comments and quotes the source', () => {
  const comments = [
    { id: 'a', source: 'chat', label: '对话 · 用户消息', content: 'line one\nline two', comment: '改短一点', meta: { role: 'user' } },
    { id: 'b', source: 'file', label: '工作区 · a.ts', content: 'const x = 1', comment: '改名', meta: { path: 'src/a.ts', startLine: 3 } },
  ]
  const { text, error } = buildCommentMessage(comments, 'zh')
  assert.equal(error, null)
  assert.match(text, /请把原文和评论一并作为本轮对话的输入/)
  assert.match(text, /### 评论 1 · 对话 · 用户消息/)
  assert.match(text, /> line one\n> line two/)
  assert.match(text, /评论：改短一点/)
  assert.match(text, /### 评论 2 · 工作区 · a\.ts/)
  assert.match(text, /行 3/)
})

test('buildCommentMessage rejects a message over the overall cap', () => {
  const comment = {
    id: 'a', source: 'chat', label: '对话', content: 'x'.repeat(MAX_TOTAL + 1), comment: 'c', meta: {},
  }
  assert.equal(buildCommentMessage([comment], 'zh').error, 'too-long')
})

test('comment limits and storage key compose', () => {
  assert.equal(MAX_COMMENT, 8000)
  assert.equal(storageKey('s-1'), 'dsh.co-write.comments.v1.s-1')
  assert.equal(totalSize([
    { content: 'abcd', comment: 'ef' },
    { content: 'g', comment: 'h' },
  ]), 8)
})
