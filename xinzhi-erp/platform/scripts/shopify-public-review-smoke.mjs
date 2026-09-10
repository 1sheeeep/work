#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

export const publicReviewPaths = Object.freeze([
  ['/shopify/app', ['Xinzhi ERP', 'Connection overview', 'Read-only reviewer preview', 'Access requires an account provisioned and authorized by Xinzhi staff', 'Self-service registration is not available', 'Installing or authorizing the Shopify app does not grant system access']],
  ['/shopify/privacy', ['Privacy Policy', 'Xinzhi Chat app embed', 'We do not access dispute evidence in the current release', 'privacy@xzkj.ai', 'Aspen Ridge International Trade LLC', 'https://www.xzkj.ai/']],
  ['/shopify/terms', ['Terms of Service', 'grant only necessary Shopify permissions', 'support@xzkj.ai', 'Aspen Ridge International Trade LLC', 'https://www.xzkj.ai/', 'Access requires an account provisioned and authorized by Xinzhi staff', 'Self-service registration is not available', 'Installing or authorizing the Shopify app does not grant system access']],
  ['/shopify/data-processing-terms', ['Merchant Data Processing Terms', 'controller, business or equivalent role', 'completed within 30 days after receipt', 'privacy@xzkj.ai', 'Aspen Ridge International Trade LLC', 'https://www.xzkj.ai/']],
  ['/shopify/data-deletion', ['Data Access and Deletion', 'customers/data_request', 'shop/redact', 'privacy@xzkj.ai', 'Aspen Ridge International Trade LLC', 'https://www.xzkj.ai/']],
  ['/shopify/support', ['Xinzhi ERP Support', 'Never send passwords, access tokens', 'support@xzkj.ai', 'Aspen Ridge International Trade LLC', 'https://www.xzkj.ai/', 'Access requires an account provisioned and authorized by Xinzhi staff', 'Self-service registration is not available', 'Installing or authorizing the Shopify app does not grant system access']],
  ['/shopify/guide', ['Xinzhi ERP Installation Guide', 'submitted scope checklist is complete', 'merchants handle evidence in Shopify Admin', 'Copy plugin enable link', 'ERP native login', 'ERP and customer service share the existing ERP account', 'Select Customer service in ERP to enter without another password', 'claim the conversation', 'Create or update the related ticket', 'Transfer the conversation', 'close and reopen the conversation', 'An ERP-only account does not receive customer-service access automatically', 'Write result uncertain', 'Uninstall revokes access; it is not proof', 'support@xzkj.ai', 'Aspen Ridge International Trade LLC', 'https://www.xzkj.ai/', 'Access requires an account provisioned and authorized by Xinzhi staff', 'Self-service registration is not available', 'Installing or authorizing the Shopify app does not grant system access']],
]);

const bodyLimit = 512 * 1024;
const forbiddenText = [
  'TODO',
  'example.com',
  'Synthetic ',
  'Public information is not configured',
  'privacy@fastmo.cn',
  'text dispute-evidence records',
  'text-only dispute-evidence save',
];

const unresolvedTemplatePlaceholder = /{{\s*(?:[A-Z][A-Z0-9_]*|\.[A-Za-z][A-Za-z0-9_]*)\s*}}/;

export function normalizeBaseURL(value, { allowHTTPLoopback = false } = {}) {
  let url;
  try {
    url = new URL(String(value ?? ''));
  } catch {
    throw new Error('base URL must be an absolute URL');
  }
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1';
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('base URL must contain only scheme and host');
  }
  if (/shopify|example/i.test(url.hostname)) {
    throw new Error('application domain must not contain Shopify or Example');
  }
  if (url.protocol !== 'https:' && !(allowHTTPLoopback && loopback && url.protocol === 'http:')) {
    throw new Error('base URL must use HTTPS');
  }
  return url;
}

export async function runPublicReviewSmoke({
  baseURL,
  allowHTTPLoopback = false,
  fetchImpl = globalThis.fetch,
  timeoutMs = 10_000,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch implementation is unavailable');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30_000) {
    throw new Error('timeout must be between 1000 and 30000 milliseconds');
  }
  const origin = normalizeBaseURL(baseURL, { allowHTTPLoopback });
  const checks = [];
  for (const [pathname, markers] of publicReviewPaths) {
    const endpoint = new URL(pathname, origin);
    const response = await fetchImpl(endpoint, {
      method: 'GET',
      redirect: 'manual',
      headers: { accept: 'text/html' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status !== 200) {
      throw new Error(`${pathname} returned HTTP ${response.status}`);
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (!/^text\/html(?:;|$)/i.test(contentType)) {
      throw new Error(`${pathname} returned a non-HTML content type`);
    }
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > bodyLimit) {
      throw new Error(`${pathname} response is too large`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > bodyLimit) {
      throw new Error(`${pathname} response is too large`);
    }
    const body = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const missingMarker = markers.find((marker) => !body.includes(marker));
    if (missingMarker) {
      throw new Error(`${pathname} is missing its expected page marker: ${missingMarker}`);
    }
    if (unresolvedTemplatePlaceholder.test(body) || forbiddenText.some((text) => body.includes(text))) {
      throw new Error(`${pathname} contains placeholder or validation-only content`);
    }
    if (pathname === '/shopify/guide' && /Sign in with Xinzhi account|shared-identity sign-in|same Xinzhi identity|One enterprise ID|actual business operations are performed in the independent Xinzhi ERP web admin|through ERP one-time entry/i.test(body)) {
      throw new Error(`${pathname} contains obsolete identity or status-only review instructions`);
    }
    // These requests carry no authenticated shop proof. Neither the public app
    // shell nor standalone legal/guide pages may advertise a framing allowlist.
    const frameRules = (response.headers.get('content-security-policy') ?? '')
      .split(';').map((rule) => rule.trim()).filter((rule) => /^frame-ancestors(?:\s|$)/i.test(rule));
    if (frameRules.length !== 1 || !/^frame-ancestors\s+'none'$/i.test(frameRules[0])) {
      throw new Error(`${pathname} has unsafe public-page framing protection`);
    }
    if (response.headers.get('referrer-policy') !== 'no-referrer' || response.headers.get('x-content-type-options') !== 'nosniff') {
      throw new Error(`${pathname} is missing public-page privacy/security headers`);
    }
    if (pathname === '/shopify/app' && response.headers.get('cache-control') !== 'no-store') {
      throw new Error(`${pathname} must not cache launch context`);
    }
    checks.push(pathname);
  }
  return checks;
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
      throw new Error(`unsupported argument: ${argument}`);
    }
  }
  if (!baseURL) {
    throw new Error('--base-url is required');
  }
  return { baseURL, allowHTTPLoopback };
}

async function main() {
  const options = parseCLI(process.argv.slice(2));
  const checks = await runPublicReviewSmoke(options);
  process.stdout.write(`PASS Shopify public review smoke (${checks.length}/${publicReviewPaths.length})\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`FAIL Shopify public review smoke: ${error instanceof Error ? error.message : 'unknown error'}\n`);
    process.exitCode = 1;
  });
}
