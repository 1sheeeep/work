import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const ts = require('typescript');
const source = readFileSync(new URL('../frontend/src/api.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { PlatformAPI, PlatformAPIError } = await import(`data:text/javascript;base64,${Buffer.from(outputText + '\n//# sourceURL=erp-login-api-under-test.js').toString('base64')}`);
const input = { tenantCode: 'demo', loginIdentifier: 'agent@example.test', password: 'synthetic-password' };
const session = { token: 'synthetic-cs-session', tenantId: 'demo', user: { id: 'synthetic-seat' }, integrationMode: 'ERP_PASSWORDLESS' };
const location = { href: 'https://chat.example.test/', origin: 'https://chat.example.test' };

test('direct login sends only credentials to the same origin and does not navigate or forward stored auth', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(String(url), 'https://chat.example.test/api/v1/auth/erp/login');
    assert.deepEqual(options.headers, { 'Content-Type': 'application/json' });
    assert.deepEqual(JSON.parse(options.body), input);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json(session);
  });
  globalThis.window = { location };
  t.after(() => { delete globalThis.window; });
  assert.deepEqual(await new PlatformAPI(location.origin, 'old-session', 'old-tenant').loginWithERP(input), session);
});

test('direct login rejects a cross-origin or URL-credential API address before sending the password', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not contact external host'); });
  globalThis.window = { location };
  t.after(() => { delete globalThis.window; });
  for (const base of ['https://attacker.invalid', '//attacker.invalid', 'https://user:secret@chat.example.test']) {
    await assert.rejects(new PlatformAPI(base).loginWithERP(input), error => error instanceof PlatformAPIError && error.status === 503);
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test('direct login keeps status for local error messages without leaking provider bodies', async t => {
  globalThis.window = { location };
  t.after(() => { delete globalThis.window; });
  for (const status of [400, 401, 403, 429, 503]) {
    const mock = t.mock.method(globalThis, 'fetch', async () => Response.json({ secret: 'synthetic-provider-detail' }, { status }));
    await assert.rejects(new PlatformAPI(location.origin).loginWithERP(input), error => {
      assert.equal(error.status, status);
      assert.equal(error.payload, null);
      assert.ok(!JSON.stringify(error).includes('synthetic-provider-detail'));
      return true;
    });
    mock.mock.restore();
  }
});

test('direct login rejects malformed success sessions', async t => {
  globalThis.window = { location };
  t.after(() => { delete globalThis.window; });
  for (const result of [null, {}, { ...session, token: '' }, { ...session, tenantId: '' }, { ...session, user: null }, { ...session, integrationMode: 'local' }]) {
    const mock = t.mock.method(globalThis, 'fetch', async () => Response.json(result));
    await assert.rejects(new PlatformAPI(location.origin).loginWithERP(input), error => error instanceof PlatformAPIError && error.status === 503);
    mock.mock.restore();
  }
});
