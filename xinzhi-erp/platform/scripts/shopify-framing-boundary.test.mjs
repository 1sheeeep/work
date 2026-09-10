import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ownedPaths = ['/shopify/app', '/shopify/session/exchange', '/shopify/session/products', '/shopify/session/orders', '/shopify/session/chat-setup', '/shopify/session/link-grant', '/shopify/oauth/authorize', '/shopify/oauth/callback', '/shopify/privacy', '/shopify/terms', '/shopify/data-processing-terms', '/shopify/support', '/shopify/data-deletion', '/shopify/guide'];

// Static regression guard, not Caddy parser or deployed proxy evidence.
for (const file of ['../infra/review/Caddyfile', '../customer-service/deploy/caddy/Caddyfile.template']) {
  test(`${file}: preserve Connector-owned framing and fail-closed defaults`, () => {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    const start = source.indexOf('erp.xzkj.ai {');
    assert.notEqual(start, -1);
    const end = source.indexOf('\n}\n', start);
    assert.notEqual(end, -1);
    const erp = source.slice(start, end + 2);
    assert.doesNotMatch(erp, /https:\/\/\*\.myshopify\.com|header_down\s+-Content-Security-Policy/);
    assert.doesNotMatch(erp, /header_down\s+-X-Frame-Options/);
    const included = erp.match(/@shopifyOwnedPages path ([^\r\n]+)/)?.[1].trim().split(/\s+/);
    const excluded = erp.match(/@notShopifyOwnedPages not path ([^\r\n]+)/)?.[1].trim().split(/\s+/);
    assert.deepEqual(included, ownedPaths);
    assert.deepEqual(excluded, ownedPaths);
    assert.ok(!included.includes('/shopify/link'), 'native confirmation must remain non-embedded');
    assert.match(erp, /@shopifyEmbedded path [^\r\n]*\/shopify\/session\/link-grant/);
    assert.match(erp, /header @shopifyOwnedPages \{\s+\?Content-Security-Policy "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"\s+\?Referrer-Policy "no-referrer"\s+\}/);
    assert.match(erp, /handle @shopifyEmbedded \{\s+reverse_proxy shopify-oauth:8790\s+\}/);
    assert.match(erp, /header @notShopifyOwnedPages \{[^}]*X-Frame-Options "SAMEORIGIN"/);
    assert.match(erp, /header @notShopifyOwnedPages \{[^}]*Referrer-Policy "strict-origin-when-cross-origin"/);
  });
}
