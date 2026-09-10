import assert from 'node:assert/strict';
import test from 'node:test';

import {
  companyIdentityPaths,
  normalizeCompanyBaseURL,
  runCompanyIdentitySmoke,
} from './shopify-company-identity-smoke.mjs';

function successfulFetch(overrides = new Map()) {
  return async (url, options) => {
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'manual');
    const markers = companyIdentityPaths.find(([path]) => path === url.pathname)?.[1] ?? [];
    const override = overrides.get(url.pathname) ?? {};
    return new Response(override.body ?? `<html><body>${markers.join(' ')}</body></html>`, {
      status: override.status ?? 200,
      headers: { 'content-type': override.contentType ?? 'text/html; charset=utf-8' },
    });
  };
}

test('official company website and five fixed pages pass', async () => {
  const checks = await runCompanyIdentitySmoke({ fetchImpl: successfulFetch() });
  assert.deepEqual(checks, companyIdentityPaths.map(([path]) => path));
});

test('only the canonical www.xzkj.ai HTTPS origin is accepted', () => {
  assert.equal(normalizeCompanyBaseURL('https://www.xzkj.ai/').href, 'https://www.xzkj.ai/');
  for (const invalid of [
    'http://xzkj.ai/',
    'https://xzkj.ai/',
    'https://xzkj.ai/path',
    'https://user:secret@xzkj.ai/',
    'https://xzkj.ai:8443/',
  ]) {
    assert.throws(() => normalizeCompanyBaseURL(invalid));
  }
});

test('redirect, missing identity and obsolete company information fail closed', async (t) => {
  const cases = [
    ['redirect', { status: 301 }, /HTTP 301/],
    ['missing identity', { body: '<html>Contact</html>' }, /missing its expected company marker/],
    ['obsolete domain', { body: `<html>${companyIdentityPaths[0][1].join(' ')} fastmo.cn</html>` }, /obsolete company information/],
    ['placeholder', { body: `<html>${companyIdentityPaths[0][1].join(' ')} {{LEGAL_NAME}}</html>` }, /placeholder/],
  ];
  for (const [name, override, expected] of cases) {
    await t.test(name, async () => {
      await assert.rejects(
        runCompanyIdentitySmoke({ fetchImpl: successfulFetch(new Map([['/', override]])) }),
        expected,
      );
    });
  }
});

test('non-HTML and oversized pages fail closed', async (t) => {
  await t.test('non-HTML', async () => {
    await assert.rejects(
      runCompanyIdentitySmoke({ fetchImpl: successfulFetch(new Map([['/', { contentType: 'application/json' }]])) }),
      /non-HTML/,
    );
  });
  await t.test('oversized', async () => {
    await assert.rejects(
      runCompanyIdentitySmoke({ fetchImpl: successfulFetch(new Map([['/', { body: 'x'.repeat(512 * 1024 + 1) }]])) }),
      /too large/,
    );
  });
});
