#!/usr/bin/env node
// Loopback-only Caddy header-scope rehearsal. Never loads production configuration.
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

if (process.argv.length !== 2) throw new Error('Arguments are not accepted');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const caddy = path.join(root, '.codex-doc-build/caddy-2.11.4/bin/caddy.exe');
const nginx = path.join(root, '.codex-doc-build/nginx-1.28.0/bin/nginx-1.28.0/nginx.exe');
assert.match(execFileSync(caddy, ['version'], { encoding: 'utf8' }), /^v2\.11\.4 /);
const dir = mkdtempSync(path.join(root, '.codex-doc-build/proxy-isolation-'));
let processNginx, processCaddy;
process.once('exit', () => { processNginx?.kill(); processCaddy?.kill(); });
const pages = ['/shopify/app', '/shopify/privacy', '/shopify/terms', '/shopify/data-processing-terms', '/shopify/data-deletion', '/shopify/support', '/shopify/guide'];
const upstream = http.createServer((req, res) => {
 const url = new URL(req.url, 'http://fixture.invalid');
 if (url.searchParams.has('unavailable')) { res.writeHead(503); res.end('synthetic unavailable'); return; }
 if (req.headers.host?.split(':')[0] === 'erp.fixture.test' && pages.includes(url.pathname)) {
  res.setHeader('Content-Security-Policy', `default-src 'self'; frame-ancestors ${url.pathname === '/shopify/app' && url.searchParams.has('verified') ? 'https://fixture.myshopify.com https://admin.shopify.com' : "'none'"};`);
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
 }
 res.end(`synthetic:${req.method}:${url.pathname}`);
});
upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
const reservation = http.createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const nginxReservation = http.createServer(); nginxReservation.listen(0, '127.0.0.1'); await once(nginxReservation, 'listening');
const nginxPort = nginxReservation.address().port; await new Promise(resolve => nginxReservation.close(resolve));
const nginxSource = readFileSync(path.join(root, 'platform/frontend/nginx.conf'), 'utf8');
const block = nginxSource.match(/    location ~ \^\/\(\?:shopify\/[\s\S]*?\n    \}/)?.[0];
assert.ok(block, 'frozen Shopify Nginx location missing');
const localBlock = block.replace('http://shopify-connector:8790', `http://127.0.0.1:${upstream.address().port}`).replace('proxy_http_version 1.1;', 'proxy_http_version 1.1;\n        add_header X-Rehearsal-Route connector always;');
mkdirSync(path.join(dir, 'logs'));
mkdirSync(path.join(dir, 'temp'));
writeFileSync(path.join(dir, 'nginx.conf'), `daemon off; master_process off; pid nginx.pid; error_log logs/nginx-error.log; events {} http { access_log off; server { listen 127.0.0.1:${nginxPort};
${localBlock}
location / { add_header X-Rehearsal-Route other always; proxy_set_header Host $host; proxy_pass http://127.0.0.1:${upstream.address().port}; }
} }`);
execFileSync(nginx, ['-t', '-p', './', '-c', 'nginx.conf'], { cwd: dir, stdio: 'pipe' });
processNginx = spawn(nginx, ['-p', './', '-c', 'nginx.conf'], { cwd: dir, windowsHide: true, stdio: 'ignore' });
const config = path.join(dir, 'Caddyfile');
writeFileSync(config, `{
 admin off
 auto_https off
 persist_config off
}
http://erp.fixture.test:${port} {
 bind 127.0.0.1
 @review path ${pages.join(' ')}
 @other not path ${pages.join(' ')}
 header @other {
  X-Frame-Options SAMEORIGIN
  Referrer-Policy strict-origin-when-cross-origin
 }
 header @review {
  -X-Frame-Options
  ?Referrer-Policy no-referrer
  ?Content-Security-Policy "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
 }
 reverse_proxy 127.0.0.1:${nginxPort}
}
http://kf.fixture.test:${port} {
 bind 127.0.0.1
 header X-Frame-Options SAMEORIGIN
 header Referrer-Policy strict-origin-when-cross-origin
 reverse_proxy 127.0.0.1:${upstream.address().port}
}
`);
const env = { ...process.env, APPDATA: dir, XDG_DATA_HOME: dir, XDG_CONFIG_HOME: dir };
mkdirSync(path.join(dir, 'runtime'));
execFileSync(caddy, ['validate', '--config', config, '--adapter', 'caddyfile'], { env, stdio: 'pipe' });
processCaddy = spawn(caddy, ['run', '--config', config, '--adapter', 'caddyfile'], { env, windowsHide: true, stdio: 'ignore' });
const checks = [];
function get(route, host = 'erp.fixture.test', method = 'GET') {
 return new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path: route, method, headers: { Host: `${host}:${port}` }, timeout: 2000 }, res => {
   let body = ''; res.on('data', b => body += b); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
  });
  req.on('error', reject); req.on('timeout', () => req.destroy()); req.end();
 });
}
try {
 let ready = false;
 for (let i = 0; i < 60; i++) {
  try { await get('/login'); ready = true; break; } catch { await new Promise(r => setTimeout(r, 100)); }
 }
 assert.ok(ready, 'isolated Caddy did not become ready');
 for (const route of pages) {
  const r = await get(route);
  assert.equal(r.status, 200); assert.equal(r.headers['referrer-policy'], 'no-referrer');
  assert.equal(r.headers['x-frame-options'], undefined); assert.match(r.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(r.body, `synthetic:GET:${route}`); checks.push(route);
  assert.equal(r.headers['x-rehearsal-route'], 'connector');
 }
 const verified = await get('/shopify/app?verified=1');
 assert.match(verified.headers['content-security-policy'], /frame-ancestors https:\/\/fixture.myshopify.com https:\/\/admin.shopify.com/);
 checks.push('upstream verified framing preserved (synthetic)');
 for (const route of ['/shopify/session/link-grant', '/shopify/session/chat-setup']) {
  const r = await get(route, 'erp.fixture.test', 'POST');
  assert.equal(r.headers['x-rehearsal-route'], 'connector'); assert.equal(r.body, `synthetic:POST:${route}`); checks.push(`new route:${route}`);
 }
 for (const route of ['/login', '/api/v1/shops', '/platform-admin', '/shopify/app/extra', '/shopify/application', '/shopify/session/exchange', '/webhooks/shopify/app/uninstalled']) {
  const r = await get(route, 'erp.fixture.test', 'POST');
  assert.equal(r.headers['x-frame-options'], 'SAMEORIGIN'); assert.equal(r.headers['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.equal(r.body, `synthetic:POST:${route}`); checks.push(`unchanged:${route}`);
 }
 const other = await get('/shopify/app', 'kf.fixture.test');
 assert.equal(other.headers['x-frame-options'], 'SAMEORIGIN'); assert.equal(other.headers['referrer-policy'], 'strict-origin-when-cross-origin');
 checks.push('other host unchanged');
 const failure = await get('/shopify/app?unavailable=1');
 assert.equal(failure.status, 503); assert.equal(failure.headers['referrer-policy'], 'no-referrer');
 assert.match(failure.headers['content-security-policy'], /frame-ancestors 'none'/); checks.push('missing upstream headers fail closed');
 const receipt = { status: 'ISOLATED_PROXY_PASSED', caddyVersion: '2.11.4', nginxVersion: '1.28.0 Windows', checks, realNginxTested: true, linuxContainerTested: false, productionConfigLoaded: false, deploymentAllowed: false };
 writeFileSync(path.join(dir, 'receipt.json'), JSON.stringify(receipt, null, 2));
 console.log(JSON.stringify({ ...receipt, receipt: path.join(dir, 'receipt.json') }, null, 2));
} finally {
 processCaddy.kill();
 processNginx.kill();
 await new Promise(resolve => upstream.close(resolve));
}
