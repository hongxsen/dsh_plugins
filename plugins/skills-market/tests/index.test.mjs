import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as host from '../index.js'
import { runPool } from '../lib/pool.js'

test('the Host entry exports its name and the webServer dependency', () => {
  assert.equal(host.name, 'skills-market')
  assert.deepEqual(Array.from(host.inject), ['webServer'])
  assert.equal(typeof host.apply, 'function')
})

test('apply registers the prefix route through ctx.effect', () => {
  const registered = []
  const effects = []
  const ctx = {
    effect(fn, label) {
      effects.push(label)
      return fn()
    },
    webServer: {
      register(route) {
        registered.push(route)
        return () => {}
      },
    },
  }
  host.apply(ctx)
  assert.deepEqual(effects, ['skills-market: http routes'])
  assert.equal(registered.length, 1)
  assert.equal(registered[0].kind, 'prefix')
  assert.equal(registered[0].path, '/dsh-skills-market')
  assert.equal(typeof registered[0].handler, 'function')
})

test('runPool preserves order and bounds concurrency', async () => {
  const items = [1, 2, 3, 4, 5, 6, 7]
  let active = 0
  let peak = 0
  const results = await runPool(items, 3, async (item) => {
    active += 1
    peak = Math.max(peak, active)
    await new Promise((resolve) => { setTimeout(resolve, 5) })
    active -= 1
    return item * 2
  })
  assert.deepEqual(results, [2, 4, 6, 8, 10, 12, 14])
  assert.ok(peak <= 3)
  assert.ok(peak >= 2)
})

test('runPool handles empty input and clamps the limit', async () => {
  assert.deepEqual(await runPool([], 5, async () => 1), [])
  assert.deepEqual(await runPool([1], 0, async (value) => value), [1])
})
