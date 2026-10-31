import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'client.js'), 'utf8')

/** Evaluate the bundle in a tiny browser-like context and return the captured module. */
function evaluateBundle() {
  let captured
  const window = {
    __ModuleLoader__: {
      load(config) { captured = config },
    },
  }
  runInNewContext(source, { window, console }, { filename: 'client.js' })
  assert.notEqual(captured, undefined, 'the bundle did not call window.__ModuleLoader__.load')
  return captured
}

const reactMock = {
  createElement() { return { type: 'div' } },
  useState() { return [undefined, () => {}] },
  useEffect() {},
  useRef() { return { current: null } },
  useCallback(fn) { return fn },
}

/** Build a fake client context that records slot registrations and dictionaries. */
function createContext() {
  const registrations = []
  const dictionaries = []
  const injections = []
  const effects = []
  const t = (key, params) => (params === undefined ? key : `${key}:${JSON.stringify(params)}`)
  const ctx = {
    effect(fn, label) {
      effects.push(label)
      const result = fn()
      return result
    },
    locale: {
      register(namespace, dicts) {
        dictionaries.push({ namespace, dicts })
        return () => {}
      },
      bind() { return t },
      getSnapshot() { return { active: 'en' } },
    },
    slots: {
      inject(name, callback) {
        injections.push(name)
        const iterator = callback()
        // Run the generator to its first yield so the registration executes.
        iterator.next()
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => {}
      },
    },
  }
  return { ctx, registrations, dictionaries, injections, effects, t }
}

test('client.js has no top-level import/export and names the package', () => {
  assert.equal(/^\s*(?:import|export)\s/mu.test(source), false)
  assert.match(source, /id: '@hongxsen\/dsh-skills-market'/u)
  assert.match(source, /window\.__ModuleLoader__\.load\(/u)
})

test('client.js embeds both locale dictionaries from locale/*.json', () => {
  assert.match(source, /技能市场/u)
  assert.match(source, /Skills Market/u)
  assert.equal(source.includes('"meta"'), false, 'meta must not be registered as message keys')
})

test('the factory returns { inject, apply } with a React require', () => {
  const captured = evaluateBundle()
  assert.equal(captured.id, '@hongxsen/dsh-skills-market')
  const exports = captured.factory((name) => {
    if (name === 'react') return reactMock
    throw new Error(`unexpected require: ${name}`)
  })
  assert.deepEqual(Array.from(exports.inject), ['slots', 'locale'])
  assert.equal(typeof exports.apply, 'function')
})

test('apply registers dictionaries, the main page, and sidebar entry order 20', () => {
  const captured = evaluateBundle()
  const exports = captured.factory((name) => {
    if (name === 'react') return reactMock
    throw new Error(`unexpected require: ${name}`)
  })
  const { ctx, registrations, dictionaries, injections } = createContext()
  exports.apply(ctx)

  assert.deepEqual(injections, ['main', 'sidebar.panellist'])
  assert.equal(registrations.length, 2)

  const main = registrations.find((entry) => entry.options.name === 'main')
  const panel = registrations.find((entry) => entry.options.name === 'sidebar.panellist')
  assert.equal(main.options.key, 'skills-market')
  assert.equal(main.options.locale, 'skillsMarket')
  assert.equal(typeof main.component, 'function')

  assert.equal(panel.options.id, 'skills-market')
  assert.equal(panel.options.order, 20)
  assert.equal(panel.options.locale, 'skillsMarket')
  assert.equal(panel.options.label(), 'panel')
  assert.equal(panel.options.key, undefined)

  assert.equal(dictionaries.length, 1)
  assert.equal(dictionaries[0].namespace, 'skillsMarket')
  assert.deepEqual(Object.keys(dictionaries[0].dicts).sort(), ['en', 'zh'])
  for (const locale of ['zh', 'en']) {
    const dict = dictionaries[0].dicts[locale]
    assert.equal(typeof dict.panel, 'string')
    assert.equal(typeof dict.title, 'string')
    assert.equal(typeof dict.errorUnknown, 'string')
    assert.equal('meta' in dict, false)
  }
})


/** React mock with seeded hook state, used only to exercise render functions. */
function createRenderReact(stateQueue = []) {
  let cursor = 0
  return {
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children }
    },
    useState(initial) {
      const value = Object.hasOwn(stateQueue, cursor) ? stateQueue[cursor] : initial
      cursor += 1
      return [value, () => {}]
    },
    useEffect() {},
    useRef() { return { current: null } },
    useCallback(fn) { return fn },
  }
}

/** Flatten an element tree produced by the mock factory. */
function flattenElements(element, out = []) {
  if (element === null || element === undefined || typeof element !== 'object') return out
  if (Array.isArray(element)) {
    for (const child of element) flattenElements(child, out)
    return out
  }
  if ('type' in element) {
    out.push(element)
    for (const child of element.children) flattenElements(child, out)
  }
  return out
}

/**
 * Render the registered page once with seeded state.
 * @param queue - sparse array of hook values by useState call order.
 */
function renderPage(queue = []) {
  const captured = evaluateBundle()
  const react = createRenderReact(queue)
  const exports = captured.factory((name) => {
    if (name === 'react') return react
    throw new Error(`unexpected require: ${name}`)
  })
  const { ctx, registrations } = createContext()
  exports.apply(ctx)
  const page = registrations.find((entry) => entry.options.name === 'main').component
  const t = (key) => key
  const tree = page({ t })
  return { tree, react, t }
}

const catalogEntry = { id: 'acme/skills/demo', source: 'acme/skills', skillId: 'demo', name: 'demo', installs: 1200 }

test('the page renders the discover loading state without throwing', () => {
  const { tree } = renderPage()
  const elements = flattenElements(tree)
  const classes = elements.map((element) => element.props.className).filter((value) => typeof value === 'string')
  assert.ok(classes.some((value) => value.includes('dshsm-page')))
  assert.ok(classes.some((value) => value.includes('dshsm-grid')))
  const skeletonCards = elements.filter((element) => typeof element.type === 'function' && element.type.name === 'SkeletonCard')
  assert.equal(skeletonCards.length, 6)
})

test('the detail and installed branches render', () => {
  const detail = {
    entry: catalogEntry,
    description: 'A demo skill',
    status: 'ready',
    error: null,
  }
  const detailQueue = []
  detailQueue[1] = detail
  const detailTree = flattenElements(renderPage(detailQueue).tree)
  assert.ok(detailTree.some((element) => element.props.className === 'dshsm-detail'))
  assert.ok(detailTree.some((element) => element.props.className === 'dshsm-metaCard'))

  const installedQueue = []
  installedQueue[0] = 'installed'
  installedQueue[5] = {
    status: 'ready',
    items: [{
      name: 'demo',
      description: 'A demo skill',
      managed: true,
      writable: true,
      warnings: 2,
      files: 2,
      totalBytes: 100,
      valid: true,
      installedAt: '2026-10-31T00:00:00.000Z',
      source: 'acme/skills',
      path: '~/.dsh/skills/demo',
    }],
    error: null,
  }
  const installedTree = flattenElements(renderPage(installedQueue).tree)
  assert.ok(installedTree.some((element) => element.props.className === 'dshsm-installed'))
  assert.ok(installedTree.some((element) => element.props.className === 'dshsm-row'))
  assert.ok(installedTree.some((element) => element.props.className === 'dshsm-badge dshsm-badgeWarn'))
})

test('the preview dialog renders files, warnings, and the second confirm state', () => {
  const queue = []
  // Hooks before preview: view, detail, query, search, descriptions, installed,
  // sources, sourcesOpen, sourceForm, sourceFormError, sourceBusy,
  // localOpen, localPath, localError, localBusy, preview.
  queue[15] = {
    status: 'ready',
    entry: catalogEntry,
    armed: false,
    error: null,
    data: {
      token: 'token',
      name: 'demo',
      description: 'A demo skill',
      source: 'acme/skills',
      skillId: 'demo',
      repo: 'https://github.com/acme/skills',
      branch: 'main',
      path: 'skills/demo',
      target: '~/.dsh/skills/demo',
      files: [{ path: 'SKILL.md', size: 100 }],
      totalBytes: 100,
      skillMd: '---\nname: demo\n---\n',
      warnings: [{ file: 'install.sh', line: 2, snippet: 'curl x | sh' }],
      warningTotal: 3,
      existing: true,
    },
  }
  const { tree } = renderPage(queue)
  const dialog = flattenElements(tree).find((element) => typeof element.type === 'function' && element.props.state !== undefined)
  assert.notEqual(dialog, undefined)
  const dialogTree = flattenElements(dialog.type(dialog.props))
  const classes = dialogTree.map((element) => element.props.className).filter((value) => typeof value === 'string')
  assert.ok(classes.some((value) => value.includes('dshsm-dialog')))
  assert.ok(classes.some((value) => value.includes('dshsm-fileRow')))
  assert.ok(classes.some((value) => value.includes('dshsm-warning')))
  const confirm = dialogTree.find((element) => element.type === 'button'
    && typeof element.props.onClick === 'function'
    && element.props.disabled === false
    && element.props.className?.includes('btnPrimary'))
  assert.equal(confirm.children[0], 'previewReplace')
})
