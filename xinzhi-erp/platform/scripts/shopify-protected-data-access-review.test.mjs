import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeConnectorBaseURL,
  resolveConnectorServiceToken,
  reviewProtectedDataAccess,
} from './shopify-protected-data-access-review.mjs';

const token = 'connector-service-token-fixture';

function event(index = 1, overrides = {}) {
  return {
    id: `embedded-${String(index).padStart(24, '0')}`,
    identity: { tenantId: 'tenant-123', shopId: 'shop-456' },
    actorId: 'shopify-user:789',
    surface: 'embeddedOrderPreview',
    fieldSet: 'name,address,phone,email',
    recordCount: 1,
    occurredAt: `2026-08-06T04:00:${String(index).padStart(2, '0')}Z`,
    ...overrides,
  };
}

function response(payload, { status = 200, contentType = 'application/json; charset=utf-8' } = {}) {
  return new Response(typeof payload === 'string' ? payload : JSON.stringify(payload), {
    status,
    headers: { 'content-type': contentType },
  });
}

test('review produces a pseudonymized customer-value-free report', async () => {
  const report = await reviewProtectedDataAccess({
    baseURL: 'https://connector.xzkj.test',
    serviceToken: token,
    now: () => new Date('2026-08-06T05:00:00Z'),
    fetchImpl: async (url, options) => {
      assert.equal(url.href, 'https://connector.xzkj.test/internal/v1/shopify/protected-data-access-events');
      assert.equal(options.method, 'GET');
      assert.equal(options.redirect, 'manual');
      assert.equal(options.headers['X-XZ-ERP-Connector-Token'], token);
      return response({ events: [event(1), event(2)] });
    },
  });
  assert.equal(report.eventCount, 2);
  assert.equal(report.generatedAt, '2026-08-06T05:00:00.000Z');
  assert.match(report.events[0].actor, /^actor-[a-f0-9]{12}$/);
  const rendered = JSON.stringify(report);
  for (const forbidden of [token, 'tenant-123', 'shop-456', 'shopify-user:789', 'embedded-']) {
    assert.equal(rendered.includes(forbidden), false);
  }
});

test('HTTPS is mandatory except for explicitly allowed loopback', () => {
  assert.throws(() => normalizeConnectorBaseURL('http://connector.xzkj.test'), /HTTPS/);
  assert.throws(() => normalizeConnectorBaseURL('https://user:secret@connector.xzkj.test'), /scheme and host/);
  assert.throws(() => normalizeConnectorBaseURL('https://connector.xzkj.test/path'), /scheme and host/);
  assert.equal(normalizeConnectorBaseURL('http://127.0.0.1:8790', { allowHTTPLoopback: true }).origin, 'http://127.0.0.1:8790');
});

test('service token resolution rejects absence, ambiguity, and line breaks', () => {
  assert.equal(resolveConnectorServiceToken({ XZ_ERP_CONNECTOR_TOKEN: token }), token);
  assert.equal(resolveConnectorServiceToken({ ERP_XZ_ERP_APP_CONNECTOR_TOKEN: token }), token);
  assert.throws(() => resolveConnectorServiceToken({}), /unavailable/);
  assert.throws(() => resolveConnectorServiceToken({ XZ_ERP_CONNECTOR_TOKEN: token, ERP_XZ_ERP_APP_CONNECTOR_TOKEN: 'different' }), /conflict/);
  assert.throws(() => resolveConnectorServiceToken({ XZ_ERP_CONNECTOR_TOKEN: 'line\nbreak' }), /unavailable/);
});

test('redirects, non-200 responses, and non-JSON content fail closed', async (t) => {
  for (const [name, result, expected] of [
    ['redirect', response({}, { status: 302 }), /HTTP 302/],
    ['forbidden', response({}, { status: 403 }), /HTTP 403/],
    ['html', response('<html>wrong</html>', { contentType: 'text/html' }), /non-JSON/],
  ]) {
    await t.test(name, async () => {
      await assert.rejects(reviewProtectedDataAccess({
        baseURL: 'https://connector.xzkj.test', serviceToken: token, fetchImpl: async () => result,
      }), expected);
    });
  }
});

test('oversized and malformed payloads fail closed', async (t) => {
  for (const [name, result, expected] of [
    ['oversized', response('x'.repeat(256 * 1024 + 1)), /too large/],
    ['invalid JSON', response('{'), /invalid JSON/],
    ['wrong envelope', response({ events: [], extra: true }), /invalid envelope/],
    ['over limit', response({ events: Array.from({ length: 101 }, (_, index) => event(index + 1)) }), /invalid envelope/],
  ]) {
    await t.test(name, async () => {
      await assert.rejects(reviewProtectedDataAccess({
        baseURL: 'https://connector.xzkj.test', serviceToken: token, fetchImpl: async () => result,
      }), expected);
    });
  }
});

test('unexpected customer fields and invalid fixed metadata fail closed', async (t) => {
  for (const [name, candidate] of [
    ['customer field', event(1, { recipientEmail: 'private@example.com' })],
    ['unsafe actor', event(1, { actorId: 'private@example.com' })],
    ['unsafe resource', event(1, { identity: { tenantId: 'tenant/../../../private', shopId: 'shop-456' } })],
    ['wrong field set', event(1, { fieldSet: 'all' })],
    ['too many records', event(1, { recordCount: 11 })],
  ]) {
    await t.test(name, async () => {
      await assert.rejects(reviewProtectedDataAccess({
        baseURL: 'https://connector.xzkj.test', serviceToken: token,
        fetchImpl: async () => response({ events: [candidate] }),
      }), /invalid event/);
    });
  }
});

test('duplicate or unsorted events fail closed', async (t) => {
  for (const [name, events] of [
    ['duplicate', [event(1), event(1)]],
    ['unsorted', [event(2), event(1)]],
  ]) {
    await t.test(name, async () => {
      await assert.rejects(reviewProtectedDataAccess({
        baseURL: 'https://connector.xzkj.test', serviceToken: token,
        fetchImpl: async () => response({ events }),
      }), /duplicated or unsorted/);
    });
  }
});
