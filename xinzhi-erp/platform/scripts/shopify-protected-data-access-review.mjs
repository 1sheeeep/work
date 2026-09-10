#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const endpointPath = '/internal/v1/shopify/protected-data-access-events';
const responseLimit = 256 * 1024;
const eventKeys = Object.freeze([
  'actorId',
  'fieldSet',
  'id',
  'identity',
  'occurredAt',
  'recordCount',
  'surface',
]);

export function normalizeConnectorBaseURL(value, { allowHTTPLoopback = false } = {}) {
  let url;
  try {
    url = new URL(String(value ?? ''));
  } catch {
    throw new Error('connector base URL must be an absolute URL');
  }
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1';
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('connector base URL must contain only scheme and host');
  }
  if (url.protocol !== 'https:' && !(allowHTTPLoopback && loopback && url.protocol === 'http:')) {
    throw new Error('connector base URL must use HTTPS');
  }
  return url;
}

export function resolveConnectorServiceToken(environment = process.env) {
  const primary = String(environment.XZ_ERP_CONNECTOR_TOKEN ?? '').trim();
  const fallback = String(environment.ERP_XZ_ERP_APP_CONNECTOR_TOKEN ?? '').trim();
  if (primary && fallback && primary !== fallback) {
    throw new Error('connector service-token variables conflict');
  }
  const token = primary || fallback;
  if (!token || token.length > 4096 || /[\r\n]/.test(token)) {
    throw new Error('connector service token is unavailable');
  }
  return token;
}

function exactKeys(value, expected) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function safeInternalID(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
}

function validateEvent(event) {
  if (!exactKeys(event, eventKeys)
      || !/^embedded-[A-Za-z0-9_-]{24}$/.test(event.id)
      || !exactKeys(event.identity, ['shopId', 'tenantId'])
      || !safeInternalID(event.identity.tenantId)
      || !safeInternalID(event.identity.shopId)
      || !/^shopify-user:[0-9]{1,20}$/.test(event.actorId)
      || event.surface !== 'embeddedOrderPreview'
      || event.fieldSet !== 'name,address,phone,email'
      || !Number.isInteger(event.recordCount)
      || event.recordCount < 0
      || event.recordCount > 10
      || typeof event.occurredAt !== 'string'
      || event.occurredAt.length > 40
      || !Number.isFinite(Date.parse(event.occurredAt))) {
    throw new Error('protected-data access response contains an invalid event');
  }
}

function pseudonym(label, value) {
  return `${label}-${createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 12)}`;
}

export async function reviewProtectedDataAccess({
  baseURL,
  serviceToken,
  allowHTTPLoopback = false,
  fetchImpl = globalThis.fetch,
  timeoutMs = 10_000,
  now = () => new Date(),
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch implementation is unavailable');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30_000) {
    throw new Error('timeout must be between 1000 and 30000 milliseconds');
  }
  const token = resolveConnectorServiceToken({ XZ_ERP_CONNECTOR_TOKEN: serviceToken });
  const origin = normalizeConnectorBaseURL(baseURL, { allowHTTPLoopback });
  let response;
  try {
    response = await fetchImpl(new URL(endpointPath, origin), {
      method: 'GET',
      redirect: 'manual',
      headers: {
        accept: 'application/json',
        'X-XZ-ERP-Connector-Token': token,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new Error('protected-data access review request failed');
  }
  if (response.status !== 200) {
    throw new Error(`protected-data access endpoint returned HTTP ${response.status}`);
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!/^application\/json(?:;|$)/i.test(contentType)) {
    throw new Error('protected-data access endpoint returned a non-JSON content type');
  }
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > responseLimit) {
    throw new Error('protected-data access response is too large');
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > responseLimit) {
    throw new Error('protected-data access response is too large');
  }
  let payload;
  try {
    payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new Error('protected-data access response is invalid JSON');
  }
  if (!exactKeys(payload, ['events']) || !Array.isArray(payload.events) || payload.events.length > 100) {
    throw new Error('protected-data access response has an invalid envelope');
  }
  const seen = new Set();
  let previousSortKey = '';
  for (const event of payload.events) {
    validateEvent(event);
    const sortKey = `${new Date(event.occurredAt).toISOString()}\u0000${event.id}`;
    if (seen.has(event.id) || (previousSortKey && sortKey <= previousSortKey)) {
      throw new Error('protected-data access events are duplicated or unsorted');
    }
    seen.add(event.id);
    previousSortKey = sortKey;
  }
  const reportEvents = payload.events.map((event) => ({
    event: pseudonym('event', event.id),
    tenant: pseudonym('tenant', event.identity.tenantId),
    shop: pseudonym('shop', event.identity.shopId),
    actor: pseudonym('actor', event.actorId),
    surface: event.surface,
    fieldSet: event.fieldSet,
    recordCount: event.recordCount,
    occurredAt: new Date(event.occurredAt).toISOString(),
  }));
  return {
    generatedAt: now().toISOString(),
    sourceOrigin: origin.origin,
    eventCount: reportEvents.length,
    windowStart: reportEvents[0]?.occurredAt ?? null,
    windowEnd: reportEvents.at(-1)?.occurredAt ?? null,
    events: reportEvents,
  };
}

function parseCLI(argv) {
  let baseURL = '';
  let allowHTTPLoopback = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--base-url') {
      baseURL = argv[index + 1] ?? '';
      index += 1;
    } else if (argument === '--allow-http-loopback') {
      allowHTTPLoopback = true;
    } else {
      throw new Error('unsupported argument');
    }
  }
  if (!baseURL) {
    throw new Error('--base-url is required');
  }
  return { baseURL, allowHTTPLoopback };
}

async function main() {
  const options = parseCLI(process.argv.slice(2));
  const serviceToken = resolveConnectorServiceToken();
  const report = await reviewProtectedDataAccess({ ...options, serviceToken });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`FAIL protected-data access review: ${error instanceof Error ? error.message : 'unknown error'}\n`);
    process.exitCode = 1;
  });
}
