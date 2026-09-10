import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, test } from 'node:test';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const { JSDOM, VirtualConsole } = require('jsdom');
const source = readFileSync(new URL('../customer-service/internal/connectors/shopify/installations/embedded_app.go', import.meta.url), 'utf8');
const html = /const embeddedAppHTML = `([\s\S]+?)`\s*$/.exec(source)[1].replace('__SHOPIFY_API_KEY__', 'fixture-public-id');
const script = /<script>\s*([\s\S]*?)<\/script>/.exec(html)[1];
const windows = [];
const flush = () => new Promise(resolve => setImmediate(resolve));
const connected = { state: 'CONNECTED', shopDomain: 'fixture.myshopify.com', shopName: 'Synthetic shop', requiredScopes: ['read_products'], grantedScopes: ['read_products'], erpLinkURL: '/shops', updatedAt: new Date().toISOString() };
const configured = { contractVersion: 'shopify.connector.chat_setup.v1', shopDomain: connected.shopDomain, state: 'CONFIGURED', serviceOrigin: 'https://support-uat.example.test', checkedAt: new Date().toISOString() };
const extension = status => [{ handle: 'extension-fixture', type: 'theme_app_extension', activations: [{ handle: 'xinzhi-chat', target: 'body', status, activations: [] }] }];
const ids = ['chat-theme-link', 'chat-workspace-link', 'chat-storefront-link'];

function fixture({ responses = [configured], extensions = async () => extension('active'), session = connected, locale = 'en', fastTimeout = false } = {}) {
  const errors = [], calls = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(html, { url: `https://erp.example.test/shopify/app?locale=${locale}`, runScripts: 'outside-only', virtualConsole });
  const window = dom.window;
  windows.push(window);
  let tokenCalls = 0, extensionCalls = 0;
  window.shopify = { idToken: async () => { tokenCalls++; return 'synthetic-token'; }, app: { extensions: extensions && (async () => { extensionCalls++; return extensions(); }) } };
  if (fastTimeout) { const original = window.setTimeout.bind(window); window.setTimeout = (fn, ms) => original(fn, ms === 12000 ? 1 : ms); }
  window.fetch = async (path, options) => {
    calls.push(path);
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer synthetic-token');
    assert.equal(options.body, undefined);
    if (path === '/shopify/session/exchange') return { ok: !session.code, json: async () => session };
    assert.equal(path, '/shopify/session/chat-setup');
    const response = responses.shift();
    assert.ok(response, 'unexpected request');
    const value = typeof response === 'function' ? await response() : response;
    return { ok: !value.code, json: async () => value };
  };
  window.eval(script);
  return { window, document: window.document, calls, errors, count: () => ({ tokenCalls, extensionCalls }) };
}
afterEach(() => windows.splice(0).forEach(window => window.close()));
const check = async f => { f.document.getElementById('chat-check').click(); await flush(); };
const locked = document => ids.forEach(id => { assert.equal(document.getElementById(id).hidden, true); assert.equal(document.getElementById(id).hasAttribute('href'), false); });

test('setup starts unchecked, reads only on demand, and uses isolated service routing with no ERP session', async () => {
  const f = fixture(); await flush();
  assert.equal(f.document.getElementById('chat-setup').hidden, false);
  assert.equal(f.document.getElementById('chat-config-state').textContent, 'Not checked');
  assert.deepEqual(f.calls, ['/shopify/session/exchange']); locked(f.document);
  await check(f);
  assert.equal(f.document.getElementById('chat-config-state').textContent, 'App configuration matches');
  assert.equal(f.document.getElementById('chat-theme-state').textContent, 'Embed detected · verify toggle and Save');
  const theme = new URL(f.document.getElementById('chat-theme-link').href);
  assert.equal(theme.origin, 'https://fixture.myshopify.com');
  assert.equal(theme.pathname, '/admin/themes/current/editor');
  assert.equal(theme.searchParams.get('context'), 'apps');
  assert.equal(theme.searchParams.get('activateAppId'), 'fixture-public-id/xinzhi-chat');
  assert.equal(f.document.getElementById('chat-workspace-link').href, 'https://support-uat.example.test/');
  for (const id of ids) { const link = f.document.getElementById(id); assert.equal(link.target, '_blank'); assert.equal(link.rel, 'noopener noreferrer'); assert.equal(link.hidden, false); }
  assert.equal(f.window.location.pathname, '/shopify/app');
  assert.deepEqual(f.count(), { tokenCalls: 2, extensionCalls: 1 }); assert.deepEqual(f.errors, []);
  f.document.getElementById('language-toggle').click();
  assert.equal(f.document.getElementById('chat-theme-state').textContent, '已检测到插件 · 请核对开关并保存');
  assert.equal(f.document.getElementById('chat-config-state').textContent, '应用配置匹配');
  assert.equal(f.calls.length, 2, 'locale change must not fetch');
});

for (const [state, label] of [['MISMATCH', 'Configuration needs attention'], ['UNAVAILABLE', 'Unable to verify configuration']]) {
  test(`a later ${state} removes previously verified links without rewriting configuration`, async () => {
    const f = fixture({ responses: [configured, { ...configured, state, serviceOrigin: 'https://attacker.invalid' }] }); await flush(); await check(f); await check(f);
    locked(f.document); assert.equal(f.document.getElementById('chat-config-state').textContent, label);
    assert.ok(!f.document.getElementById('chat-origin').textContent.includes('attacker'));
    assert.deepEqual(f.calls, ['/shopify/session/exchange', '/shopify/session/chat-setup', '/shopify/session/chat-setup']);
  });
}

for (const [name, extensions, label] of [
  ['available', async () => extension('available'), 'Embed available · activation pending'],
  ['unavailable', async () => extension('unavailable'), 'Embed reported unavailable'],
  ['missing', async () => [], 'Embed not reported · verify app release'],
  ['API absent', null, 'Theme status unknown · verify manually'],
  ['API error', async () => { throw new Error('synthetic-provider-secret'); }, 'Theme status unknown · verify manually'],
  ['invalid response', async () => ({ enabled: true }), 'Theme status unknown · verify manually'],
  ['unknown enum', async () => extension('enabled'), 'Theme status unknown · verify manually'],
  ['ambiguous', async () => [...extension('active'), ...extension('available')], 'Theme status unknown · verify manually'],
]) {
  test(`theme ${name} remains distinguishable from messaging acceptance`, async () => {
    const f = fixture({ extensions }); await flush(); await check(f);
    assert.equal(f.document.getElementById('chat-theme-state').textContent, label);
    assert.equal(f.document.getElementById('chat-workspace-link').hidden, false);
    assert.ok(f.document.body.textContent.includes('this page does not mark that test as passed'));
    assert.ok(!f.document.body.textContent.includes('synthetic-provider-secret'));
  });
}

for (const invalid of [
  { shopDomain: 'other.myshopify.com' }, { contractVersion: 'other' }, { state: 'READY' }, { checkedAt: null },
  ...['javascript:alert(1)', 'http://support.example.test', 'https://user:secret@support.example.test', 'https://support.example.test/path', 'https://support.example.test/?proof=secret', 'https://support.example.test/#secret', 'https://support.example.test\\@attacker.invalid'].map(serviceOrigin => ({ serviceOrigin })),
]) {
  test(`invalid setup response fails closed: ${JSON.stringify(invalid)}`, async () => {
    const f = fixture({ responses: [{ ...configured, ...invalid }] }); await flush(); await check(f);
    locked(f.document); assert.equal(f.document.getElementById('chat-config-state').textContent, 'Unable to verify configuration');
  });
}

test('pending authorization keeps the plugin locked and does not query configuration', async () => {
  const f = fixture({ session: { code: 'INSTALLATION_LINK_REQUIRED', pending: { shopDomain: 'fixture.myshopify.com' } } }); await flush(); await check(f);
  assert.equal(f.document.getElementById('chat-setup').hidden, true); locked(f.document);
  assert.deepEqual(f.calls, ['/shopify/session/exchange']);
});

test('a late result cannot reopen plugin links after the connection is rechecked', async () => {
  let finish;
  const f = fixture({ responses: [() => new Promise(resolve => { finish = resolve; })] }); await flush(); await check(f);
  assert.equal(f.document.getElementById('chat-check').disabled, true); locked(f.document);
  f.document.getElementById('retry-session').click(); await flush();
  finish(configured); await flush(); locked(f.document);
  assert.equal(f.document.getElementById('chat-config-state').textContent, 'Not checked');
});

test('hung extension check times out and allows another attempt', async () => {
  const f = fixture({ extensions: () => new Promise(() => {}), fastTimeout: true }); await flush(); await check(f);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(f.document.getElementById('chat-theme-state').textContent, 'Theme status unknown · verify manually');
  assert.equal(f.document.getElementById('chat-check').disabled, false);
});
