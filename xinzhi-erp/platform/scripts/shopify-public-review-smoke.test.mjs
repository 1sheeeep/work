import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeBaseURL,
  publicReviewPaths,
  runPublicReviewSmoke,
} from './shopify-public-review-smoke.mjs';

const privacyMarkers = publicReviewPaths
  .find(([path]) => path === '/shopify/privacy')[1]
  .join(' ');

test('admission pages must disclose staff approval and no automatic system access', () => {
  for (const path of ['/shopify/app', '/shopify/terms', '/shopify/support', '/shopify/guide']) {
    const markers = publicReviewPaths.find(([candidate]) => candidate === path)[1];
    assert.ok(markers.includes('Access requires an account provisioned and authorized by Xinzhi staff'));
    assert.ok(markers.includes('Installing or authorizing the Shopify app does not grant system access'));
  }
});

test('public review markers enforce the current dispute-evidence boundary', () => {
  const markerText = JSON.stringify(publicReviewPaths);
  assert.match(markerText, /We do not access dispute evidence in the current release/);
  assert.match(markerText, /merchants handle evidence in Shopify Admin/);
  assert.doesNotMatch(markerText, /text dispute-evidence records|text-only dispute-evidence save/);
});

test('public legal pages enforce the official company identity and website', () => {
  for (const [path, markers] of publicReviewPaths.filter(([path]) => path !== '/shopify/app')) {
    assert.ok(markers.includes('Aspen Ridge International Trade LLC'), `${path} must identify the legal entity`);
    assert.ok(markers.includes('https://www.xzkj.ai/'), `${path} must link the canonical company website`);
  }
});

function successfulFetch(overrides = new Map()) {
  return async (url, options) => {
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'manual');
    const path = url.pathname;
    const markers = publicReviewPaths.find(([candidate]) => candidate === path)?.[1] ?? [];
    const override = overrides.get(path) ?? {};
    return new Response(override.body ?? `<html><body>${markers.join(' ')}</body></html>`, {
      status: override.status ?? 200,
      headers: {
        'content-type': override.contentType ?? 'text/html; charset=utf-8',
        'content-security-policy': "frame-ancestors 'none';",
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-store',
        ...override.headers,
      },
    });
  };
}

test('all seven fixed public review pages pass without credentials', async () => {
  const checks = await runPublicReviewSmoke({
    baseURL: 'https://review.xzkj.test',
    fetchImpl: successfulFetch(),
  });
  assert.deepEqual(checks, publicReviewPaths.map(([path]) => path));
});

test('public smoke rejects missing or permissive framing and launch-proof leakage', async (t) => {
  const cases = [
    ['missing CSP', '/shopify/app', { 'content-security-policy': '' }, /framing protection/],
    ['old wildcard', '/shopify/app', { 'content-security-policy': 'frame-ancestors https://admin.shopify.com https://*.myshopify.com;' }, /framing protection/],
    ['unsigned store allowlist', '/shopify/app', { 'content-security-policy': 'frame-ancestors https://demo.myshopify.com https://admin.shopify.com;' }, /framing protection/],
    ['duplicate directives', '/shopify/app', { 'content-security-policy': "frame-ancestors *; frame-ancestors 'none';" }, /framing protection/],
    ['framed public guide', '/shopify/guide', { 'content-security-policy': "frame-ancestors 'self';" }, /framing protection/],
    ['framed public privacy', '/shopify/privacy', { 'content-security-policy': 'frame-ancestors *;' }, /framing protection/],
    ['referrer leakage', '/shopify/app', { 'referrer-policy': 'strict-origin-when-cross-origin' }, /privacy\/security headers/],
    ['missing nosniff', '/shopify/app', { 'x-content-type-options': '' }, /privacy\/security headers/],
    ['cached launch', '/shopify/app', { 'cache-control': 'public, max-age=300' }, /must not cache/],
  ];
  for (const [name, path, headers, expected] of cases) {
    await t.test(name, async () => {
      await assert.rejects(runPublicReviewSmoke({
        baseURL: 'https://review.xzkj.test',
        fetchImpl: successfulFetch(new Map([[path, { headers }]])),
      }), expected);
    });
  }
});

test('public guide must demonstrate peer identity and the complete support lifecycle', async (t) => {
  const markers = publicReviewPaths.find(([path]) => path === '/shopify/guide')[1];
  for (const missing of ['Select Customer service in ERP to enter without another password', 'Transfer the conversation', 'Create or update the related ticket']) {
    await t.test(missing, async () => {
      const body = `<html>${markers.filter((marker) => marker !== missing).join(' ')}</html>`;
      await assert.rejects(runPublicReviewSmoke({
        baseURL: 'https://review.xzkj.test',
        fetchImpl: successfulFetch(new Map([['/shopify/guide', { body }]])),
      }), /expected page marker/);
    });
  }
});

test('new guide markers cannot conceal obsolete login instructions', async () => {
  const markers = publicReviewPaths.find(([path]) => path === '/shopify/guide')[1];
  await assert.rejects(runPublicReviewSmoke({
    baseURL: 'https://review.xzkj.test',
    fetchImpl: successfulFetch(new Map([['/shopify/guide', { body: `<html>${markers.join(' ')} Sign in with Xinzhi account through shared-identity sign-in</html>` }]])),
  }), /obsolete identity or status-only/);
});

test('shared ERP account copy is allowed without One', async () => {
  const markers = publicReviewPaths.find(([path]) => path === '/shopify/guide')[1];
  await runPublicReviewSmoke({
    baseURL: 'https://review.xzkj.test',
    fetchImpl: successfulFetch(new Map([['/shopify/guide', { body: `<html>${markers.join(' ')} Company ID: xinzhi. Use the prepared ERP account.</html>` }]])),
  });
});

test('normal CSS and JavaScript braces are not mistaken for template placeholders', async () => {
  const overrides = new Map([['/shopify/app', {
    body: `<html><title>Xinzhi ERP</title><body>${publicReviewPaths.find(([path]) => path === '/shopify/app')[1].join(' ')}</body><style>body{color:red}</style><script>function ready(){return {ok:true};}}</script></html>`,
  }]]);
  const checks = await runPublicReviewSmoke({
    baseURL: 'https://review.xzkj.test',
    fetchImpl: successfulFetch(overrides),
  });
  assert.deepEqual(checks, publicReviewPaths.map(([path]) => path));
});

test('HTTPS is mandatory except for explicitly allowed loopback', () => {
  assert.throws(() => normalizeBaseURL('http://review.xzkj.test'), /HTTPS/);
  assert.throws(() => normalizeBaseURL('https://user:secret@review.example.test'), /scheme and host/);
  assert.throws(() => normalizeBaseURL('https://review.example.test/path'), /scheme and host/);
  assert.throws(() => normalizeBaseURL('https://shopify-review.test'), /must not contain/);
  assert.throws(() => normalizeBaseURL('https://example-review.test'), /must not contain/);
  assert.equal(normalizeBaseURL('http://127.0.0.1:8790', { allowHTTPLoopback: true }).origin, 'http://127.0.0.1:8790');
});

test('redirects and non-200 responses fail closed', async () => {
  const overrides = new Map([['/shopify/privacy', { status: 302 }]]);
  await assert.rejects(
    runPublicReviewSmoke({ baseURL: 'https://review.xzkj.test', fetchImpl: successfulFetch(overrides) }),
    /HTTP 302/,
  );
});

test('non-HTML, missing markers, and placeholders fail closed', async (t) => {
  const cases = [
    ['non-html', { contentType: 'application/json' }, /non-HTML/],
    ['missing marker', { body: '<html>wrong page</html>' }, /expected page marker/],
    ['placeholder', { body: `<html>${privacyMarkers} {{LEGAL_NAME}}</html>` }, /placeholder/],
    ['unrendered template field', { body: `<html>${privacyMarkers} {{.LegalName}}</html>` }, /placeholder/],
    ['validation value', { body: `<html>${privacyMarkers} privacy@example.com</html>` }, /placeholder/],
    ['obsolete privacy email', { body: `<html>${privacyMarkers} privacy@fastmo.cn</html>` }, /placeholder/],
    ['obsolete dispute-evidence claim', { body: `<html>${privacyMarkers} text-only dispute-evidence save</html>` }, /placeholder/],
  ];
  for (const [name, override, expected] of cases) {
    await t.test(name, async () => {
      const overrides = new Map([['/shopify/privacy', override]]);
      await assert.rejects(
        runPublicReviewSmoke({ baseURL: 'https://review.xzkj.test', fetchImpl: successfulFetch(overrides) }),
        expected,
      );
    });
  }
});

test('oversized public pages fail closed', async () => {
  const overrides = new Map([['/shopify/privacy', { body: `Privacy Policy${'x'.repeat(512 * 1024)}` }]]);
  await assert.rejects(
    runPublicReviewSmoke({ baseURL: 'https://review.xzkj.test', fetchImpl: successfulFetch(overrides) }),
    /too large/,
  );
});
