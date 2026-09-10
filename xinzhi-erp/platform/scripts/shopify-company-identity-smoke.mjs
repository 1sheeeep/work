#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

export const companyIdentityPaths = Object.freeze([
  ['/', ['Aspen Ridge International Trade LLC', 'xzkj.ai', 'support@xzkj.ai']],
  ['/about/', ['Aspen Ridge International Trade LLC', 'Website purpose', 'Company, product, and technology information', 'support@xzkj.ai']],
  ['/contact/', ['Aspen Ridge International Trade LLC', 'support@xzkj.ai', 'developer@xzkj.ai', 'privacy@xzkj.ai']],
  ['/privacy/', ['Aspen Ridge International Trade LLC', 'privacy@xzkj.ai']],
  ['/terms/', ['Aspen Ridge International Trade LLC', 'support@xzkj.ai']],
]);

const bodyLimit = 512 * 1024;
const forbiddenText = ['TODO', 'example.com', 'fastmo.cn', 'Weyr Uetgy'];
const unresolvedPlaceholder = /{{\s*[A-Z][A-Z0-9_]*\s*}}/;

export function normalizeCompanyBaseURL(value) {
  let url;
  try {
    url = new URL(String(value ?? ''));
  } catch {
    throw new Error('company website must be an absolute URL');
  }
  if (url.protocol !== 'https:' || url.hostname !== 'www.xzkj.ai') {
    throw new Error('company website must use the canonical https://www.xzkj.ai origin');
  }
  if (url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/') {
    throw new Error('company website base URL must contain only the fixed HTTPS origin');
  }
  return url;
}

export async function runCompanyIdentitySmoke({
  baseURL = 'https://www.xzkj.ai/',
  fetchImpl = globalThis.fetch,
  timeoutMs = 10_000,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch implementation is unavailable');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30_000) {
    throw new Error('timeout must be between 1000 and 30000 milliseconds');
  }
  const origin = normalizeCompanyBaseURL(baseURL);
  const checks = [];
  for (const [pathname, markers] of companyIdentityPaths) {
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
      throw new Error(`${pathname} is missing its expected company marker: ${missingMarker}`);
    }
    if (unresolvedPlaceholder.test(body) || forbiddenText.some((text) => body.includes(text))) {
      throw new Error(`${pathname} contains placeholder or obsolete company information`);
    }
    checks.push(pathname);
  }
  return checks;
}

function parseCLI(argv) {
  let baseURL = 'https://www.xzkj.ai/';
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--base-url') {
      baseURL = argv[index + 1] ?? '';
      index += 1;
    } else {
      throw new Error(`unsupported argument: ${argument}`);
    }
  }
  return { baseURL };
}

async function main() {
  const checks = await runCompanyIdentitySmoke(parseCLI(process.argv.slice(2)));
  process.stdout.write(`PASS Shopify company identity smoke (${checks.length}/${companyIdentityPaths.length})\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`FAIL Shopify company identity smoke: ${error instanceof Error ? error.message : 'unknown error'}\n`);
    process.exitCode = 1;
  });
}
