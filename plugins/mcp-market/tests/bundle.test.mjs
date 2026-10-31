import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import {
  hueFor,
  monogram,
  formatTemplate,
  formatDate,
  validateFields,
  requestJson,
  debounce,
} from '../src/model.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

test('the committed bundle has no top-level module syntax and names the package', async () => {
  const client = await readFile(join(root, 'client.js'), 'utf8')
  assert.equal(/^\s*(?:import|export)\s/mu.test(client), false)
  assert.match(client, /id: '@hongxsen\/dsh-mcp-market'/u)
  assert.match(client, /return \{ inject, apply \}/u)
  assert.match(client, /发现/u)
  assert.match(client, /Discover/u)
})

test('the bundle evaluates under a mock ModuleLoader and returns inject/apply', async () => {
  const client = await readFile(join(root, 'client.js'), 'utf8')
  let registration
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(spec) { registration = spec },
      },
    },
    console,
  }
  vm.runInNewContext(client, sandbox, { filename: 'client.js' })
  assert.ok(registration)
  assert.equal(registration.id, '@hongxsen/dsh-mcp-market')
  assert.equal(typeof registration.factory, 'function')
  const exported = registration.factory(() => ({}))
  assert.equal(Array.from(exported.inject).join(','), 'slots,locale')
  assert.equal(typeof exported.apply, 'function')
})

test('zh and en dictionaries declare the same keys', async () => {
  const zh = JSON.parse(await readFile(join(root, 'locale/zh.json'), 'utf8'))
  const en = JSON.parse(await readFile(join(root, 'locale/en.json'), 'utf8'))
  const flatten = (value, prefix = '') => (
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? Object.keys(value).flatMap(key => flatten(value[key], prefix === '' ? key : `${prefix}.${key}`))
      : [prefix]
  )
  assert.deepEqual(flatten(zh).sort(), flatten(en).sort())
  assert.equal(zh.panel, 'MCP')
  assert.equal(en.panel, 'MCP')
})

test('model helpers are pure and deterministic', () => {
  assert.equal(monogram('Weather', 'io.github/weather'), 'W')
  assert.equal(monogram('', 'io.github/weather'), 'I')
  assert.equal(monogram(''), '?')
  assert.equal(hueFor('weather'), hueFor('weather'))
  assert.ok(hueFor('weather') >= 0 && hueFor('weather') < 360)
  assert.equal(formatTemplate('Hello {name}', { name: 'MCP' }), 'Hello MCP')
  assert.equal(formatTemplate('Hello {name}', {}), 'Hello {name}')
  assert.equal(formatDate('2026-01-02T03:04:05Z'), '2026-01-02')
  assert.equal(formatDate('not a date'), '')
})

test('client-side validation mirrors the Host limits', () => {
  const fields = [
    { name: 'Authorization', required: true, kind: 'header' },
    { name: 'NOTE', required: false, kind: 'env' },
    { name: 'BIG', required: false, kind: 'env' },
  ]
  assert.deepEqual(validateFields(fields, {}), { Authorization: 'required' })
  assert.deepEqual(validateFields(fields, { Authorization: 'a\nb' }), { Authorization: 'headerBreak' })
  assert.deepEqual(validateFields(fields, { Authorization: 'x', BIG: 'a'.repeat(8193) }), { BIG: 'tooLong' })
  assert.deepEqual(validateFields(fields, { Authorization: 'x', NOTE: 'multi\nline' }), {})
  assert.deepEqual(validateFields([{ name: 'TOKEN', required: true, hasDefault: true, kind: 'env' }], {}), {})
})

test('requestJson unwraps errors and maps timeouts', async () => {
  const ok = await requestJson('/health', {
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => '{"ok":true}' }),
  })
  assert.deepEqual(ok, { ok: true })
  await assert.rejects(
    () => requestJson('/preview', {
      method: 'POST',
      body: { registryName: 'x' },
      fetchImpl: async () => ({
        ok: false,
        status: 400,
        text: async () => '{"error":{"code":"mcp/needs-input","message":"missing","details":{"missing":[]}}}',
      }),
    }),
    error => error.code === 'mcp/needs-input' && error.details.missing.length === 0,
  )
  await assert.rejects(
    () => requestJson('/health', {
      timeoutMs: 1,
      fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const error = new Error('aborted')
          error.name = 'AbortError'
          reject(error)
        })
      }),
    }),
    error => error.code === 'request/timeout',
  )
})

test('debounce fires once with the last arguments', async () => {
  const seen = []
  const wrapped = debounce(value => { seen.push(value) }, 10)
  wrapped('a')
  wrapped('b')
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.deepEqual(seen, ['b'])
  wrapped.cancel()
})
