// Local visual QA of the real ERP frontend. Synthetic records only; no proxy,
// environment files, persistent accounts, databases or remote services.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href);
const { default: react } = await import(pathToFileURL(require.resolve('@vitejs/plugin-react')).href);
const signedOut = process.argv.includes('--signed-out');
const longLabels = process.argv.includes('--long-labels');
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const timestamp = '2026-09-07T04:00:00Z';
const navigation = readFileSync(new URL('../frontend/src/modules/navigationDefinitions.ts', import.meta.url), 'utf8');
const permissions = [...new Set([...navigation.matchAll(/["']([a-z_]+[.:][a-z_.:]+)["']/g)].map(match => match[1]))];
permissions.push('warehouses.write', 'products.write', 'products.listing.read', 'products.listing.write', 'products.master_data.read', 'products.master_data.write', 'procurement.write', 'orders.write', 'platform:read');
const session = {
  tenant: { id: id(1), code: 'ui-fixture', name: '演示企业 · 本地合成数据' },
  user: { id: id(2), username: 'ui@example.test', email: 'ui@example.test', displayName: '演示操作员' },
  permissions, applications: [{ code: 'ERP', modules: ['CORE', 'PRODUCT', 'ORDER', 'WAREHOUSE', 'PROCUREMENT', 'LOGISTICS', 'ANALYTICS', 'SETTINGS'] }],
  expiresAt: '2099-01-01T00:00:00Z',
};
const warehouses = ['华东中心仓', '华南备货仓', '北区退货仓'].map((name, index) => ({
  id: id(20 + index), businessCode: `WH-0${index + 1}`, name, status: index === 2 ? 'INACTIVE' : 'ACTIVE',
  version: 1, createdAt: timestamp, updatedAt: timestamp,
}));
if (longLabels) warehouses[0].name = '华东中心仓 · 跨境订单分拣与售后退货综合处理仓库';
const shops = longLabels ? [{
  id: id(90), displayName: '跨境品牌旗舰店 · 北美与欧洲综合运营中心',
  externalShopRef: 'synthetic-long-shop-name.example.test', platformCode: 'SHOPIFY', status: 'ACTIVE',
  authorization: { status: 'NOT_CONFIGURED', credentialConfigured: false, scopes: [] },
  createdAt: timestamp, updatedAt: timestamp,
}] : [];
const productNames = ['轻量通勤背包', '便携收纳袋', '户外保温杯', '桌面收纳盒'];
productNames.push('旅行洗漱包', '折叠购物袋', '不锈钢随行杯', '棉麻置物篮', '轻便运动水壶', '桌面文件收纳架');
const products = productNames.map((name, index) => ({
  id: id(30 + index), businessCode: `SPU-100${index}`, name, nameZh: name, nameEn: 'Synthetic product',
  status: index === 3 ? 'INACTIVE' : 'ACTIVE', sensitiveAttributeCodes: [], volumetricDivisor: 6000,
  skuSummary: { totalSkuCount: 3, activeSkuCount: 3 }, version: 1, createdAt: timestamp, updatedAt: timestamp,
  metrics: { totalInventory: 120 + index * 37, sales7: 28, sales28: 96, sales42: 148, forecastDailySales: 4 },
}));
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
// Explicit read contracts only. Unknown endpoints must fail, never masquerade
// as successful business data. All writes remain blocked below.
const pagePaths = new Set([
  'product-center/spus', 'product-center/skus', 'product-center/listings',
  'product-center/bundles', 'product-center/supply-prices', 'product-center/inventory-sync-jobs',
  'product-center/master-data/categories', 'product-center/master-data/assignable-members',
  'product-center/master-data/package-materials',
  'warehouse-center/warehouses', 'warehouse-center/locations', 'order-center/orders',
  'order-center/shopify/customers', 'order-center/shopify/returns', 'order-center/shopify/disputes',
  'inventory-center/balances', 'inventory-center/counts', 'inventory-center/transfers',
  'inventory-center/manual-movements', 'inventory-center/documents',
  'inventory-center/manual-movements/types', 'inventory-center/manual-movements/references/warehouses',
  'suppliers', 'procurement/plans', 'procurement/orders', 'procurement/orders/receipts',
  'procurement/orders/returns', 'procurement/plans/references/skus', 'procurement/plans/references/warehouses',
  'platform-center/shops', 'platform-center/platforms', 'logistics/authorizations',
  'logistics/channels', 'logistics/matching-rules', 'logistics/fees', 'logistics/addresses',
  'logistics/declaration-entities', 'logistics/label-templates', 'logistics/tracking-numbers',
  'logistics/tracking', 'logistics/shipping-fees/regions', 'logistics/shipping-fees/rules',
  'logistics/forecast-batches', 'logistics/inquiries',
  'settings/tasks', 'settings/messages', 'settings/transfer-tasks', 'settings/internal-notices',
  'settings/shop-aliases', 'settings/order-exception-categories', 'settings/approval-rules',
  'settings/address-mappings', 'iam/users', 'iam/roles', 'iam/member-applications',
  'iam/members', 'iam/permissions', 'iam/audit-logs',
]);
const defaults = { configured: false, version: 0, updatedByDisplayName: null, createdAt: null, updatedAt: null };
function fixtureData(url) {
  const path = url.pathname.replace('/api/v1/', '');
  const params = url.searchParams;
  const page = Number(params.get('page') || 0);
  const size = Number(params.get('size') || params.get('pageSize') || 25);
  const empty = { items: [], page, size, totalElements: 0, totalPages: 0 };
  const zeros = keys => Object.fromEntries(keys.split(' ').map(key => [key, 0]));
  if (path === 'settings/enterprise-branding') return {
    configured: false, watermarkEnabled: false, watermarkUserName: true,
    watermarkCompanyName: true, watermarkTime: true, watermarkPhoneSuffix: false,
    version: 0, updatedByDisplayName: null, updatedAt: null,
  };
  if (path === 'settings/enterprise-profile') return {
    tenantCode: session.tenant.code, tenantName: session.tenant.name, configured: false,
    companyName: null, province: null, city: null, district: null, detailedAddress: null,
    contactName: null, contactEmail: null, contactQq: null, contactMobile: null, contactTelephone: null,
    version: 0, createdAt: null, updatedAt: null,
  };
  if (path === 'settings/system-general') return { ...defaults, defaultCurrency: 'USD', orderPullBlackoutStart: null, orderPullBlackoutEnd: null };
  if (path === 'settings/order-shipping-deadline') return { ...defaults, deadlineDays: 3 };
  if (path === 'settings/address-mappings/config') return { ...defaults, enabled: false };
  if (path === 'settings/approval-rules/approver-candidates') return [];
  if (path === 'logistics/authorizations/providers') return [];
  if (products.some(product => path === `product-center/spus/${product.id}/images`)) return [];
  const productDetail = products.find(product => path === `product-center/spus/${product.id}`);
  if (productDetail) return productDetail;
  if (path === 'inventory-center/shopify/publications/exceptions') return { items: [] };
  if (path === 'settings/order-exception-categories') return { configured: false, revision: 0, items: [], updatedByDisplayName: null, createdAt: null, updatedAt: null };
  if (['INBOUND', 'OUTBOUND'].some(direction => path === `inventory-center/manual-movements/settings/${direction}`)) return {
    direction: path.split('/').at(-1), approvalRequired: true, unitPriceRequired: false,
    showCostPrice: false, costUpdatePolicy: 'NO_UPDATE', contactInformationRequired: false, version: 0,
  };
  if (path === 'order-center/dashboard-summary') return {
    ...zeros('totalOrders unpaidOrders receivedOrders reviewPendingOrders mergePendingOrders holdOrders readyToFulfillOrders fulfillingOrders shippedOrders deliveredOrders cancelledOrders editableOrders unmatchedLines'),
    oldestUnmatchedPlacedAt: null,
  };
  if (path === 'analytics/dashboard-product-sales') {
    const observedAt = params.get('observedAt');
    return { hotItems: [], lowItems: [], activeSkuCount: 0, soldSkuCount: 0, salesQuantity: 0,
      observedAt, rangeFrom: new Date(Date.parse(observedAt) - 7 * 86400000).toISOString() };
  }
  if (path === 'analytics/inventory-aging') return { ...empty, ...zeros('totalQuantity age0To30Quantity age31To60Quantity age61To90Quantity age91To365Quantity ageOver365Quantity') };
  if (path === 'analytics/inventory-period') return { ...empty, ...zeros('totalOpeningQuantity totalIncreasedQuantity totalDecreasedQuantity totalClosingQuantity') };
  if (path === 'analytics/order-status') return { ...empty, totalOrders: 0 };
  if (path === 'analytics/store-health') return { ...empty, platforms: [] };
  if (path === 'analytics/product-sales') return { items: [], page, size, totalPages: 0, totalSkuCount: 0, totalSalesQuantity: 0 };
  if (path === 'analytics/inventory-sales') return { items: [], page, size, totalPages: 0, observedAt: params.get('asOf'), ...zeros('totalBalanceCount totalOnHand totalReserved totalAvailable totalRangeSalesQuantity') };
  if (path === 'analytics/listing-sales') return { items: [], page, size, totalPages: 0, observedAt: params.get('asOf'), totalListingCount: 0, totalRangeSalesQuantity: 0 };
  if (path === 'logistics/statistics') return { ...empty, totalStatuses: [], dimension: params.get('dimension'), totalRecords: 0 };
  if (path === 'procurement/statistics/purchasers') return { ...empty, granularity: params.get('granularity'), ...zeros('totalOrders totalOrderedQuantity totalReceivedQuantity totalOutstandingQuantity') };
  if (path === 'procurement/plans/summary') return { unpurchasedPlans: 0 };
  if (pagePaths.has(path)) {
    const records = path === 'warehouse-center/warehouses' ? warehouses : path === 'product-center/spus' ? products : path === 'platform-center/shops' ? shops : [];
    const keyword = (params.get('keyword') || params.get('query') || '').toLowerCase();
    const filtered = records.filter(item => (!keyword || `${item.name} ${item.businessCode}`.toLowerCase().includes(keyword)) && (!params.get('status') || item.status === params.get('status')));
    return { ...empty, items: filtered.slice(page * size, (page + 1) * size), totalElements: filtered.length, totalPages: Math.ceil(filtered.length / size) };
  }
  return undefined;
}
const server = await createServer({
  root: fileURLToPath(new URL('../frontend/', import.meta.url)), configFile: false, envDir: false,
  cacheDir: 'node_modules/.vite-ui-fixture',
  server: { host: '127.0.0.1', port: 0, proxy: {} },
  plugins: [react(), { name: 'erp-ui-synthetic-fixture', configureServer(vite) {
    vite.middlewares.use((req, res, next) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      const path = url.pathname;
      if (!path.startsWith('/api/')) return next();
      if (req.method !== 'GET') return json(res, 405, { code: 'visual_fixture_read_only', message: '本地界面预览不保存业务数据。' });
      if (path === '/api/v1/auth/me') return signedOut ? json(res, 401, { code: 'fixture_signed_out' }) : json(res, 200, session);
      if (path.startsWith('/api/v1/platform-admin/')) return json(res, 401, { code: 'fixture_no_platform_session' });
      const data = fixtureData(url);
      if (data !== undefined) return json(res, 200, data);
      console.log(JSON.stringify({ missingFixture: path }));
      return json(res, 503, { code: 'visual_fixture_unavailable', message: '合成预览未连接此业务服务。' });
    });
  } }],
});
await server.listen();
console.log(JSON.stringify({ fixture: 'ERP UI', theme: 'current', origin: server.resolvedUrls.local[0], entry: '/products?view=master', realServices: false }));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.close(); process.exit(0); });
