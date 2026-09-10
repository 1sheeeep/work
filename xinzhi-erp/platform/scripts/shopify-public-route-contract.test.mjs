import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const nginx = readFileSync(new URL('../frontend/nginx.conf', import.meta.url), 'utf8');
const pattern = nginx.match(/location ~ (\^\/\(\?:shopify\/[^\n]+) \{/);
assert.ok(pattern, 'exact Shopify proxy matcher required');
const matcher = new RegExp(pattern[1]);
test('every App Home request reaches the existing Connector proxy', () => {
 const app = readFileSync(new URL('../customer-service/internal/connectors/shopify/installations/embedded_app.go', import.meta.url), 'utf8');
 const routes = [...new Set([...app.matchAll(/request\("(\/shopify\/session\/[^"?]+)"\)/g)].map(m => m[1]))];
 assert.equal(routes.length, 5);
 for (const route of routes) assert.ok(matcher.test(route), `${route} must not fall through to SPA`);
});
test('existing public lifecycle paths are retained', () => {
 for (const route of ['/shopify/oauth/authorize', '/shopify/oauth/callback', '/shopify/app', '/shopify/privacy', '/shopify/terms', '/shopify/data-processing-terms', '/shopify/support', '/shopify/data-deletion', '/shopify/guide', '/shopify/proxy/chat/session', '/webhooks/shopify/app/uninstalled', '/webhooks/shopify/compliance']) assert.ok(matcher.test(route), route);
});
test('exact matching never publishes internal or near-match routes', () => {
 for (const route of ['/api/v1/erp-connector/shopify/native-link', '/api/v1/shopify-connector/installations/oauth/start', '/shopify/session/admin', '/shopify/session/link-grant/extra', '/shopify/session/chat-setup/extra', '/shopify/application', '/shopify/app/extra', '/webhooks/shopify/unknown']) assert.equal(matcher.test(route), false, route);
 assert.match(nginx, /proxy_pass \$shopify_connector;/);
});
