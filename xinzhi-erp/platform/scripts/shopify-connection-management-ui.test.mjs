import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, test } from 'node:test';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const { JSDOM } = require('jsdom');
const source = readFileSync(new URL('../customer-service/internal/connectors/shopify/installations/embedded_app.go', import.meta.url), 'utf8');
const html = /const embeddedAppHTML = `([\s\S]+?)`\s*$/.exec(source)[1];
const script = /<script>\s*([\s\S]*?)<\/script>/.exec(html)[1];
const windows = [];
const flush = () => new Promise(resolve => setImmediate(resolve));
const connected = { state: 'CONNECTED', shopDomain: 'fixture.myshopify.com', requiredScopes: ['read_products'], grantedScopes: ['read_products'], erpLinkURL: '/shops', updatedAt: '2026-09-04T00:00:00Z' };
const permissions = { required: ['read_products'], granted: ['read_products'], optional: [] };
function fixture({ query = async () => permissions, response = async () => connected, fastTimeout = false } = {}) {
  const window = new JSDOM(html, { url: 'https://erp.example.test/shopify/app?locale=en', runScripts: 'outside-only' }).window;
  windows.push(window);
  const calls = [];
  let queries = 0;
  window.shopify = { idToken: async () => 'fixture-token', scopes: query && { query: async () => { queries++; return query(); } } };
  window.fetch = async (path, options) => {
    calls.push(path);
    assert.equal(options.method, 'POST');
    assert.equal(options.body, undefined);
    assert.equal(options.headers.Authorization, 'Bearer fixture-token');
    const value = await response(path, options);
    return { ok: !value.code, json: async () => value };
  };
  if (fastTimeout) { const original = window.setTimeout.bind(window); window.setTimeout = (fn, ms) => original(fn, ms === 12000 ? 15 : ms); }
  window.eval(script);
  const element = id => window.document.getElementById(id);
  return { window, calls, element, queries: () => queries, text: () => element('permissions-result').textContent, click: async id => { element(id).click(); await flush(); } };
}
afterEach(() => windows.splice(0).forEach(window => window.close()));

test('checks scopes only on demand and does not request or revoke permissions', async () => {
  const f = fixture(); await flush();
  assert.equal(f.queries(), 0);
  assert.match(f.text(), /not been checked/);
  await f.click('permissions-check');
  assert.match(f.text(), /currently grants/);
  assert.match(f.text(), /does not verify the Connector token/);
  assert.deepEqual(f.calls, ['/shopify/session/exchange']);
  await f.click('language-toggle');
  assert.match(f.text(), /不代表 Connector/);
  assert.equal(f.queries(), 1);
  assert.doesNotMatch(source, /shopify\.scopes\.(request|revoke)\(/);
});

for (const [name, value, expected] of [
  ['missing grant', { ...permissions, granted: [] }, /missing permissions: read_products/],
  ['release drift', { ...permissions, required: ['read_orders'] }, /differ from the Connector/],
  ['absent required list', { granted: [] }, /could not be verified/],
  ['empty required list', { ...permissions, required: [] }, /could not be verified/],
  ['non-string scope', { ...permissions, granted: [null] }, /could not be verified/],
  ['injected scope', { ...permissions, required: ['<img src=x onerror=alert(1)>'] }, /could not be verified/],
  ['missing optional list', { required: ['read_products'], granted: [] }, /could not be verified/],
  ['null response', null, /could not be verified/],
]) test(`scope state fails safely: ${name}`, async () => {
  const f = fixture({ query: async () => value }); await flush(); await f.click('permissions-check');
  assert.match(f.text(), expected);
  assert.equal(f.element('permissions-check').disabled, false);
  assert.equal(f.window.document.querySelector('#permissions-result img'), null);
});

for (const query of [null, async () => { throw new Error('synthetic-secret'); }]) test('unavailable bridge leaves recovery controls accessible and redacts errors', async () => {
  const f = fixture({ query }); await flush(); await f.click('permissions-check');
  assert.match(f.text(), /could not be verified/);
  assert.doesNotMatch(f.window.document.body.textContent, /synthetic-secret/);
  assert.equal(f.element('connection-management').hidden, false);
});

test('pending ERP association is not promoted by successful Shopify scope check', async () => {
  const f = fixture({ response: async () => ({ code: 'INSTALLATION_LINK_REQUIRED' }) }); await flush(); await f.click('permissions-check');
  assert.match(f.text(), /currently grants/);
  assert.equal(f.element('workspace').hidden, true);
  assert.equal(f.element('erp-action').hidden, true);
  assert.equal(f.element('native-link-start').hidden, false);
});

test('late scope result cannot replace unchecked state after reconnect', async () => {
  let finish;
  const f = fixture({ query: () => new Promise(resolve => { finish = resolve; }) }); await flush();
  await f.click('permissions-check'); await f.click('permissions-check');
  assert.equal(f.queries(), 1);
  await f.click('connection-recheck'); finish(permissions); await flush();
  assert.match(f.text(), /not been checked/);
  assert.equal(f.element('permissions-check').disabled, false);
});

test('scope timeout permits retry and ignores the late response', async () => {
  let finish;
  const f = fixture({ query: () => new Promise(resolve => { finish = resolve; }), fastTimeout: true }); await flush(); await f.click('permissions-check');
  await new Promise(resolve => setTimeout(resolve, 35));
  assert.match(f.text(), /could not be verified/);
  finish(permissions); await flush();
  assert.match(f.text(), /could not be verified/);
  assert.equal(f.element('permissions-check').disabled, false);
});

for (const kind of ['products', 'orders']) test(`reconnect clears ${kind} and fences late protected data`, async () => {
  let finish;
  const f = fixture({ response: path => path.endsWith('/exchange') ? connected : new Promise(resolve => { finish = resolve; }) }); await flush();
  await f.click(`${kind}-refresh`); await f.click('connection-recheck');
  finish({ [kind]: [{ title: 'STALE SECRET', name: 'STALE SECRET' }] }); await flush();
  assert.match(f.element(kind).textContent, /Not run yet/);
  assert.doesNotMatch(f.window.document.body.textContent, /STALE SECRET/);
});

test('a hanging connection aborts fetch, permits retry and does not apply late success', async () => {
  let finish, signal;
  const f = fixture({ fastTimeout: true, response: (_, options) => { signal = options.signal; return new Promise(resolve => { finish = resolve; }); } });
  await flush(); await f.click('connection-recheck');
  assert.equal(f.calls.length, 1);
  await new Promise(resolve => setTimeout(resolve, 35));
  assert.equal(signal.aborted, true);
  assert.equal(f.element('connection-recheck').disabled, false);
  finish(connected); await flush();
  assert.equal(f.element('workspace').hidden, true);
});

test('uninstall link stays in Shopify and explains shared impact without local mutations', async () => {
  const f = fixture(); await flush();
  const link = f.element('shopify-app-settings');
  assert.equal(link.getAttribute('href'), 'shopify://admin/settings/apps');
  assert.equal(link.target, '_top');
  assert.match(f.element('connection-management').textContent, /both ERP and customer service/);
  assert.match(f.element('connection-management').textContent, /does not uninstall/);
  assert.deepEqual(f.calls, ['/shopify/session/exchange']);
  assert.equal(f.element('erp-action').textContent, 'Open Xinzhi ERP');
  assert.doesNotMatch(source, /Last verified|Update authorization in Xinzhi ERP/);
});
