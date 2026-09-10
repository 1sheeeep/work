import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const postcss = require('postcss');
const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const css = read('../frontend/src/erp-theme.css');
const tree = postcss.parse(css);
const ids = [...read('../frontend/src/theme.ts').matchAll(/id: "([a-z]+)"/g)].map(match => match[1]);

function tokensFor(id) {
  const tokens = {};
  tree.walkRules(rule => {
    if (rule.selector === ':root' || (rule.selector.startsWith(':root') && rule.selector.includes('[data-erp-theme="' + id + '"]'))) {
      for (const decl of rule.nodes.filter(node => node.type === 'decl')) tokens[decl.prop] = decl.value;
    }
  });
  const resolve = (value, seen = new Set()) => value.replace(/var\((--[\w-]+)\)/g, (_, key) => {
    assert.ok(tokens[key] && !seen.has(key), 'Unresolved/cyclic ' + key);
    return resolve(tokens[key], new Set([...seen, key]));
  });
  return Object.fromEntries(Object.entries(tokens).map(([key, value]) => [key, resolve(value)]));
}
function luminance(hex) {
  const rgb = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(a, b) {
  const [bright, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (bright + 0.05) / (dark + 0.05);
}
test('nine registered themes have CSS coverage with no unregistered overrides', () => {
  assert.equal(ids.length, 9);
  assert.equal(new Set(ids).size, 9);
  const overrides = [...new Set([...css.matchAll(/data-erp-theme="([a-z]+)"/g)].map(match => match[1]))];
  assert.deepEqual(overrides.sort(), ids.filter(id => id !== 'oatmeal').sort());
});
for (const id of ids) {
  test(id + ': readable text, controls and pale surfaces; semantic states preserved', () => {
    const tokens = tokensFor(id);
    for (const foreground of ['text', 'text-secondary', 'text-muted', 'primary', 'danger']) {
      for (const background of ['surface', 'surface-muted', 'page', 'primary-soft', 'navigation', 'row-selected', 'dialog']) {
        const ratio = contrast(tokens['--erp-color-' + foreground], tokens['--erp-color-' + background]);
        assert.ok(ratio >= 4.5, foreground + '/' + background + ': ' + ratio.toFixed(2));
      }
    }
    for (const action of ['primary', 'primary-hover']) assert.ok(contrast('#ffffff', tokens['--erp-color-' + action]) >= 4.5);
    for (const boundary of ['border-strong', 'focus']) {
      for (const background of ['surface', 'dialog', 'navigation']) {
        assert.ok(contrast(tokens['--erp-color-' + boundary], tokens['--erp-color-' + background]) >= 3);
      }
    }
    for (const surface of ['surface', 'surface-muted', 'page', 'navigation', 'dialog']) {
      assert.ok(luminance(tokens['--erp-color-' + surface]) >= 0.90, surface + ' too dark');
    }
    assert.equal(tokens['--color-success'], '#49633f');
    assert.equal(tokens['--color-warning'], '#865b27');
    assert.equal(tokens['--color-error'], '#a34136');
  });
}
test('theme restores before rendering, final CSS import and fixture stay isolated', () => {
  const main = read('../frontend/src/main.tsx');
  assert.ok(main.indexOf('erp-theme.css') > main.indexOf('erp-design-system.css'));
  assert.ok(main.indexOf('applyTheme(readSavedTheme());') < main.indexOf('createRoot(document'));
  for (const file of ['styles.css', 'erp-design-system.css']) {
    postcss.parse(read('../frontend/src/' + file)).walkDecls('--erp-color-primary', () => assert.fail('Duplicate primary in ' + file));
  }
  const fixture = read('./erp-ui-browser-fixture.mjs');
  assert.ok(!fixture.includes('--sage'));
  assert.ok(fixture.includes("req.method !== 'GET'"));
  assert.ok(fixture.includes('envDir: false'));
  assert.ok(fixture.includes('proxy: {}'));
});
