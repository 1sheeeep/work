import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const tree = require('postcss').parse(readFileSync(new URL('../frontend/src/erp-design-system.css', import.meta.url), 'utf8'));
function declarations(selector) {
  const result = {};
  tree.walkRules(rule => {
    if (rule.selector === selector && rule.parent.type === 'root') {
      rule.walkDecls(decl => { result[decl.prop] = decl.value; });
    }
  });
  return result;
}

test('hidden-label order controls have one shrinkable grid column', () => {
  const control = declarations('.app-shell .order-search-control');
  assert.equal(control['grid-template-columns'], 'minmax(0, 1fr)');
  assert.equal(control['min-width'], 'min(100%, 144px)');
  const input = declarations('.app-shell .order-search-control :where(select, input)');
  assert.equal(input.width, '100%');
  assert.equal(input['min-width'], '0');
});

test('desktop inline-label layout cannot leak into nested toolbar or advanced fields', () => {
  let found = false;
  tree.walkRules(rule => {
    if (rule.nodes.some(node => node.prop === 'grid-template-columns' && node.value === 'max-content minmax(118px, 1fr)')) {
      found = true;
      assert.ok(rule.selector.includes('.order-filter-bar > label'));
      assert.ok(!rule.selector.includes('.order-filter-bar label'));
    }
  });
  assert.ok(found);
});

test('toolbar wraps by available container width, not only viewport breakpoint', () => {
  assert.equal(declarations('.app-shell .order-search-toolbar')['flex-wrap'], 'wrap');
  assert.equal(declarations('.app-shell .order-search-toolbar').gap, '6px');
  assert.equal(declarations('.app-shell .order-keyword-control')['min-width'], 'min(100%, 260px)');
});

test('mobile order controls retain their full-width layout', () => {
  let found = false;
  tree.walkAtRules('media', media => {
    if (media.params !== '(max-width: 720px)') return;
    media.walkRules(rule => {
      if (!rule.selector.includes('.app-shell .order-search-control')) return;
      const values = Object.fromEntries(rule.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value]));
      if (values.width === '100%' && values['min-width'] === '0') found = true;
    });
  });
  assert.ok(found);
});
