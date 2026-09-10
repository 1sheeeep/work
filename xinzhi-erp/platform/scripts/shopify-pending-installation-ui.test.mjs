import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, test } from 'node:test';

// Reuse ERP's existing DOM test dependency. No browser, external script,
// Shopify SDK, account or real network is loaded by this fixture.
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const { JSDOM, VirtualConsole } = require('jsdom');
const source = fs.readFileSync(new URL('../customer-service/internal/connectors/shopify/installations/embedded_app.go', import.meta.url), 'utf8');
const html = /const embeddedAppHTML = `([\s\S]+?)`\s*$/.exec(source)?.[1];
assert.ok(html, 'Go App Home template must exist');
const inlineScript = /<script>\s*([\s\S]*?)<\/script>/.exec(html)?.[1];
assert.ok(inlineScript, 'App Home controller must exist');
const windows = [];
const flush = () => new Promise((resolve) => setImmediate(resolve));
const pending = {
  code: 'INSTALLATION_LINK_REQUIRED', state: 'AUTHORIZED_UNLINKED',
  pending: { shopDomain: 'fixture.myshopify.com', grantedScopes: ['read_products'] },
};

function fixture(responses, locale = 'en') {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => errors.push(error));
  const dom = new JSDOM(html, {
    url: `https://fixture.invalid/shopify/app?locale=${locale}`,
    runScripts: 'outside-only', virtualConsole,
  });
  windows.push(dom.window);
  const calls = [];
  dom.window.shopify = { idToken: async () => 'synthetic-id-token' };
  dom.window.fetch = async (path, options) => {
    assert.match(path, /^\/shopify\/session\/(exchange|products|orders|link-grant)$/);
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer synthetic-id-token');
    calls.push(path);
    const response = responses.shift();
    assert.ok(response, 'unexpected request');
    return { ok: response.ok ?? false, json: async () => response.body };
  };
  dom.window.eval(inlineScript);
  return { document: dom.window.document, calls, errors };
}

afterEach(() => {
  for (const window of windows.splice(0)) window.close();
});

for (const [locale, title, message] of [
  ['en', 'Shopify authorized · ERP linking pending', 'no ERP store has been created or claimed'],
  ['zh-CN', 'Shopify 已授权 · 待关联 ERP', '未创建或认领 ERP 店铺'],
]) {
  test(`pending ${locale} shows authorization separately from ERP ownership`, async () => {
    const { document, calls, errors } = fixture([{ body: { ...pending, link: 'https://attacker.invalid/' } }], locale);
    await flush();
    assert.equal(document.getElementById('connection-title').textContent, title);
    assert.ok(document.getElementById('notice-message').textContent.includes(message));
    assert.equal(document.getElementById('workspace').hidden, true);
    assert.equal(document.getElementById('content').hidden, true);
    assert.equal(document.getElementById('link'), null, 'retired manual domain-binding link must not return');
    assert.equal(document.getElementById('retry-session').hidden, false);
    assert.equal(document.getElementById('native-link-start').hidden, false);
    assert.equal(document.getElementById('native-link-open').hidden, true);
    assert.match(document.getElementById('access-policy').textContent, /Self-service registration is not available|不开放自助注册/);
    assert.equal(document.getElementById('access-contact').getAttribute('href'), '/shopify/support');
    assert.equal(document.getElementById('access-contact').hidden, false);
    assert.deepEqual(calls, ['/shopify/session/exchange']);
    assert.deepEqual(errors, []);
  });
}

test('pending state survives language switching without business requests', async () => {
  const { document, calls, errors } = fixture([{ body: pending }]);
  await flush();
  document.querySelector('.language').click();
  assert.equal(document.getElementById('connection-title').textContent, 'Shopify 已授权 · 待关联 ERP');
  assert.match(document.getElementById('access-policy').textContent, /不会获得系统使用权/);
  assert.equal(document.getElementById('access-contact').textContent, '联系工作人员开通');
  assert.equal(document.getElementById('workspace').hidden, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(errors, []);
});

test('retry uses a new session request and only a connected result unlocks previews', async () => {
  const { document, calls, errors } = fixture([
    { body: pending },
    { ok: true, body: {
      state: 'CONNECTED', shopDomain: 'fixture.myshopify.com', shopName: 'Fixture',
      requiredScopes: ['read_products'], grantedScopes: ['read_products'],
      erpLinkURL: '/shops', updatedAt: '2026-09-04T12:00:00Z',
    } },
  ]);
  await flush();
  document.getElementById('retry-session').click();
  await flush();
  assert.equal(document.getElementById('connection-title').textContent, 'Connection ready');
  assert.equal(document.getElementById('workspace').hidden, false);
  assert.equal(document.getElementById('content').hidden, false);
  assert.deepEqual(calls, ['/shopify/session/exchange', '/shopify/session/exchange']);
  assert.deepEqual(errors, []);
});

test('invalid Shopify session does not claim successful authorization or use server HTML', async () => {
  const { document, errors } = fixture([{ body: { code: 'INVALID_SHOPIFY_SESSION', error: '<img src=x onerror=alert(1)>' } }]);
  await flush();
  assert.equal(document.getElementById('connection-title').textContent, 'Connection incomplete');
  assert.equal(document.getElementById('workspace').hidden, true);
  assert.equal(document.getElementById('native-link-start').hidden, true);
  assert.equal(document.querySelector('img[src=x]'), null);
  assert.deepEqual(errors, []);
});

test('a user-requested fresh grant creates only a fixed fragment link and never navigates automatically', async () => {
  const proof = 'A'.repeat(43);
  const { document, calls, errors } = fixture([{ body: pending }, { ok: true, body: {
    contractVersion: 'shopify.connector.native_link.v1', proof,
    pending: { shopDomain: 'fixture.myshopify.com', expiresAt: new Date(Date.now() + 600000).toISOString() },
    link: 'https://attacker.invalid/',
  } }]);
  await flush();
  document.getElementById('native-link-start').click();
  await flush();
  const anchor = document.getElementById('native-link-open');
  assert.equal(anchor.hidden, false);
  assert.equal(anchor.getAttribute('href'), '/shopify/link#proof=' + proof);
  assert.equal(anchor.target, '_blank');
  assert.equal(anchor.rel, 'noopener noreferrer');
  assert.equal(document.location.pathname, '/shopify/app');
  assert.equal(document.getElementById('workspace').hidden, true);
  assert.deepEqual(calls, ['/shopify/session/exchange', '/shopify/session/link-grant']);
  assert.deepEqual(errors, []);
});

for (const invalid of [
  { proof: 'bad' },
  { pending: { shopDomain: 'other.myshopify.com', expiresAt: new Date(Date.now() + 600000).toISOString() } },
  { pending: { shopDomain: 'fixture.myshopify.com', expiresAt: '2000-01-01T00:00:00Z' } },
]) {
  test(`invalid grant cannot expose a link: ${JSON.stringify(invalid)}`, async () => {
    const { document } = fixture([{ body: pending }, { ok: true, body: {
      contractVersion: 'shopify.connector.native_link.v1', proof: 'A'.repeat(43),
      pending: { shopDomain: 'fixture.myshopify.com', expiresAt: new Date(Date.now() + 600000).toISOString() }, ...invalid,
    } }]);
    await flush(); document.getElementById('native-link-start').click(); await flush();
    assert.equal(document.getElementById('native-link-open').hidden, true);
    assert.equal(document.getElementById('native-link-open').hasAttribute('href'), false);
    assert.match(document.getElementById('notice-message').textContent, /Unable to prepare/);
  });
}
