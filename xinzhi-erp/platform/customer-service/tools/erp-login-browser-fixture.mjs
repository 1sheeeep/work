// Loopback-only UI fixture. No environment files, real accounts, database or proxy.
// Run after frontend build: node tools/erp-login-browser-fixture.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const dist = new URL('../frontend/dist/', import.meta.url);
const now = new Date().toISOString();
const user = { id: 'synthetic-agent', email: 'agent@example.test', displayName: '本机合成坐席', role: 'agent', status: 'active',
  receptionLimit: 3, receptionOnline: false, permissions: ['workbench.access'], permissionsCustomized: true,
  workbenchShopScope: 'assigned', conversationScope: 'assigned', systemAdmin: false, createdAt: now, updatedAt: now };
let attempts = 0, authenticated = false;
const json = (res, status, value) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
};
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:5198');
  res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-src 'self'; object-src 'none'");
  res.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/__fixture/status') return json(res, 200, { synthetic: true, attempts, authenticated });
  if (url.pathname === '/api/v1/bootstrap/status') return json(res, 200, { needsBootstrap: false, authMode: 'erp_sso', tenantRequired: true });
  if (url.pathname === '/api/v1/auth/erp/login' && req.method === 'POST') {
    attempts++;
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 4096) return json(res, 400, {}); }
    let input;
    try { input = JSON.parse(body); } catch { return json(res, 400, {}); }
    body = '';
    await new Promise(resolve => setTimeout(resolve, 450));
    if (input.loginIdentifier === 'limited@example.test') return json(res, 429, {});
    if (input.loginIdentifier === 'denied@example.test') return json(res, 403, {});
    if (input.tenantCode !== 'local-fixture' || input.loginIdentifier !== user.email || input.password !== 'Synthetic-only-123!') return json(res, 401, {});
    authenticated = true;
    return json(res, 200, { token: 'local-fixture-cs-session', tenantId: 'local-fixture', user, integrationMode: 'ERP_PASSWORDLESS', expiresAt: new Date(Date.now() + 3600000).toISOString() });
  }
  if (url.pathname === '/api/v1/auth/logout') { authenticated = false; return json(res, 200, {}); }
  if (url.pathname === '/api/v1/auth/me') return json(res, authenticated ? 200 : 401, authenticated ? user : {});
  if (url.pathname === '/api/v1/auth/me/presence') return json(res, 200, user);
  if (url.pathname.startsWith('/api/')) return json(res, 200, []);
  if (url.pathname.startsWith('/ws')) { res.writeHead(503); return res.end(); }
  // Only built asset names and fixed public files are served; never expose source/env files.
  const file = /^\/assets\/[A-Za-z0-9_.-]+\.(js|css)$/.test(url.pathname) ? url.pathname.slice(1)
    : ['/xinzhi-logo.png', '/favicon.ico'].includes(url.pathname) ? url.pathname.slice(1) : 'index.html';
  try {
    const data = await readFile(new URL(file, dist));
    const contentType = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : 'text/html; charset=utf-8';
    res.writeHead(200, { 'Content-Type': contentType }); res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
server.on('upgrade', (_req, socket) => socket.destroy());
server.listen(5198, '127.0.0.1', () => console.log('Synthetic UI fixture only: http://127.0.0.1:5198'));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => process.exit(0)));
