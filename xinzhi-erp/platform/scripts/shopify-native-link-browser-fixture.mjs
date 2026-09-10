// Local UI fixture only. All API requests terminate here; no environment files,
// real credentials, database, Connector, Shopify SDK or proxy is loaded.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href);
const { default: react } = await import(pathToFileURL(require.resolve('@vitejs/plugin-react')).href);
const proof = 'A'.repeat(43);
const shop = { shopId: '33333333-3333-4333-8333-333333333333', shopDomain: 'fixture.myshopify.com', shopName: '本地合成店铺 · Native linking fixture' };
const session = {
  tenant: { id: '11111111-1111-4111-8111-111111111111', code: 'native-fixture', name: '本地合成企业 · 非真实账号' },
  user: { id: '22222222-2222-4222-8222-222222222222', username: 'fixture-admin', displayName: '合成管理员' },
  permissions: ['shop:read', 'shop:write', 'shop:authorization:write'],
  applications: [], expiresAt: new Date(Date.now() + 3600000).toISOString(),
};
const appSource = readFileSync(new URL('../customer-service/internal/connectors/shopify/installations/embedded_app.go', import.meta.url), 'utf8');
const appHtml = /const embeddedAppHTML = `([\s\S]+?)`\s*$/.exec(appSource)?.[1]
  .replace('__SHOPIFY_API_KEY__', 'fixture-public-id')
  .replace('<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>', '<script>window.shopify={idToken:async()=>"fixture-id-token",scopes:{query:async()=>({required:["read_products"],granted:["read_products"],optional:[]})},app:{extensions:async()=>[{type:"theme_app_extension",handle:"fixture",activations:[{handle:"xinzhi-chat",target:"body",status:"active",activations:[]}]}]}}</script>')
  .replace('<body>', '<body><p style="padding:12px;text-align:center;background:#fff7df">LOCAL SYNTHETIC FIXTURE — NOT SHOPIFY OR PRODUCTION</p>');
if (!appHtml) throw new Error('App Home template was not found');
let confirmations = 0, previews = 0, prepares = 0, chatChecks = 0, connected = process.argv.includes('--chat-setup');
const pending = () => ({ shopDomain: shop.shopDomain, shopName: shop.shopName,
  grantedScopes: ['read_products'], expiresAt: new Date(Date.now() + 600000).toISOString() });
const json = (res, code, value) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(value));
};
const server = await createServer({
  root: fileURLToPath(new URL('../frontend/', import.meta.url)),
  configFile: false, envDir: false, cacheDir: 'node_modules/.vite-native-link-fixture',
  server: { host: '127.0.0.1', port: 5197, strictPort: true, proxy: {} },
  plugins: [react(), { name: 'native-link-fixture', configureServer(vite) {
    vite.middlewares.use((req, res, next) => {
      const path = new URL(req.url, 'http://fixture.local').pathname;
      if (path === '/shopify/app') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'");
        return res.end(appHtml);
      }
      if (path === '/__native-link-fixture/status') return json(res, 200, { previews, prepares, confirmations, chatChecks, connected });
      if (path === '/shopify/session/chat-setup') {
        chatChecks++;
        const state = ['CONFIGURED', 'MISMATCH', 'UNAVAILABLE'][(chatChecks - 1) % 3];
        return json(res, 200, { contractVersion: 'shopify.connector.chat_setup.v1', shopDomain: shop.shopDomain, state,
          serviceOrigin: state === 'CONFIGURED' ? 'https://support-uat.example.test' : undefined, checkedAt: new Date().toISOString() });
      }
      if (path === '/shopify/session/exchange') return connected
        ? json(res, 200, { state: 'CONNECTED', ...pending(), requiredScopes: ['read_products'], erpLinkURL: '/shops', updatedAt: new Date().toISOString() })
        : json(res, 409, { code: 'INSTALLATION_LINK_REQUIRED', state: 'AUTHORIZED_UNLINKED', pending: pending() });
      if (path === '/shopify/session/link-grant') return json(res, 200, { contractVersion: 'shopify.connector.native_link.v1', proof, pending: pending() });
      if (path === '/api/v1/auth/me') return json(res, 200, session);
      if (path === '/api/v1/platform-center/shopify/native-link/preview') {
        previews++;
        return connected ? json(res, 409, { code: 'native_link_unavailable' })
          : json(res, 200, { pending: pending(), existingShop: null, canCreateShop: true });
      }
      if (path === '/api/v1/platform-center/shopify/native-link/prepare') {
        prepares++; return json(res, 200, shop);
      }
      if (path === `/api/v1/platform-center/shops/${shop.shopId}/channels/shopify/native-link/confirm`) {
        confirmations++; connected = true;
        // Model a committed remote result followed by an unknown response.
        return confirmations === 1 ? json(res, 503, { code: 'connector_unavailable' }) : json(res, 200, shop);
      }
      if (path.startsWith('/api/') || path.startsWith('/shopify/session/')) return json(res, 404, { code: 'fixture_route_not_supported' });
      next();
    });
  } }],
});
await server.listen();
console.log(JSON.stringify({ fixture: 'native-link', origin: server.resolvedUrls.local[0], entry: '/shopify/app?locale=zh-CN', realServices: false }));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.close(); process.exit(0); });
