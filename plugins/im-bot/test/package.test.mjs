import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('package exposes the Host entry and marketplace metadata', () => {
  assert.equal(pkg.name, '@hongxsen/dsh-im-bot');
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.main, './index.js');
  assert.equal(pkg.exports['.'], './index.js');
  assert.equal(pkg.exports['./locale/zh.json'], './locale/zh.json');
  assert.equal(pkg.exports['./locale/en.json'], './locale/en.json');
  assert.equal(pkg.exports['./icon.svg'], './icon.svg');
  assert.equal(pkg.dsh.bundle.patch, 'cordis.patch.yml');
  assert.equal(pkg.engines.node, '>=22');
  assert.ok(pkg.dependencies['@larksuiteoapi/node-sdk']);
  assert.ok(pkg.dependencies.ws);
  assert.ok(!pkg.exports['./client']);
});

test('published package contains runtime files but not tests or local state', () => {
  for (const file of ['index.js', 'lib', 'locale', 'icon.svg', 'cordis.patch.yml', 'README.md']) {
    assert.ok(pkg.files.includes(file), `missing files entry: ${file}`);
  }
  for (const file of ['test', 'examples', 'state.json', '.env']) {
    assert.ok(!pkg.files.includes(file), `must not publish: ${file}`);
  }
  assert.equal(root.endsWith('/plugins/im-bot/'), true);
});
