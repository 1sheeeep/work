import { apiClient } from '../api/client'

const MODE = 'CUSTOMER_SERVICE_STORE_APP_READ_ONLY'
type Envelope = { readOnly: true; productionReady: false; bindingVersion: number }
export type PreparationStatus = Envelope & {
  snapshot: {
    mode: typeof MODE
    shopify: { status: 'CONNECTED'; shopName: string; shopDomain: string; updatedAt: string }
    shopifyScopes: { scope: string; status: 'GRANTED' | 'MISSING' | 'REQUESTED' }[]
  }
}
export type PreparationOrders = Envelope & {
  page: {
    mode: typeof MODE; connectionStatus: 'CONNECTED'; fetchedAt: string
    hasNextPage: boolean; orders: { externalOrderRef: string; name: string; createdAt: string }[]
  }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid preparation response')
  return value as Record<string, unknown>
}
function text(value: unknown, max = 255): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= max
    && !/[\u0000-\u001f\u007f]/.test(value)
}
function date(value: unknown) { return text(value, 40) && Number.isFinite(Date.parse(value)) }
function envelope(raw: unknown) {
  const value = object(raw)
  if (value.readOnly !== true || value.productionReady !== false || !Number.isSafeInteger(value.bindingVersion)
    || Number(value.bindingVersion) < 1) throw new Error('Invalid preparation boundary')
  return value
}
function base(shopId: string) {
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(shopId)) throw new Error('Invalid preparation shop')
  return `/api/v1/platform-center/shops/${encodeURIComponent(shopId)}/store-app-read-preparation`
}
export const storeAppReadPreparationApi = {
  async status(shopId: string): Promise<PreparationStatus> {
    const raw = envelope(await apiClient.request<unknown>(base(shopId), { cache: 'no-store' }))
    const snapshot = object(raw.snapshot); const shop = object(snapshot.shopify)
    if (snapshot.mode !== MODE || shop.status !== 'CONNECTED' || !text(shop.shopName) || !date(shop.updatedAt)
      || !text(shop.shopDomain) || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/.test(shop.shopDomain)
      || !Array.isArray(snapshot.shopifyScopes) || snapshot.shopifyScopes.length > 200) throw new Error('Invalid preparation status')
    for (const rawScope of snapshot.shopifyScopes) {
      const scope = object(rawScope)
      if (!text(scope.scope, 128) || !/^[a-z][a-z0-9_]*$/.test(scope.scope)
        || !['GRANTED', 'MISSING', 'REQUESTED'].includes(String(scope.status))) throw new Error('Invalid preparation scopes')
    }
    return raw as unknown as PreparationStatus
  },
  async orders(shopId: string): Promise<PreparationOrders> {
    const raw = envelope(await apiClient.request<unknown>(`${base(shopId)}/orders?limit=10`, { cache: 'no-store' }))
    const page = object(raw.page)
    if (page.mode !== MODE || page.connectionStatus !== 'CONNECTED' || !date(page.fetchedAt)
      || typeof page.hasNextPage !== 'boolean' || !Array.isArray(page.orders) || page.orders.length > 10) throw new Error('Invalid preparation orders')
    const refs = new Set<string>()
    for (const rawOrder of page.orders) {
      const order = object(rawOrder)
      if (!text(order.externalOrderRef, 160) || !/^gid:\/\/shopify\/Order\/[1-9][0-9]*$/.test(order.externalOrderRef)
        || refs.has(order.externalOrderRef) || !text(order.name) || !date(order.createdAt)) throw new Error('Invalid preparation order')
      refs.add(order.externalOrderRef)
    }
    return raw as unknown as PreparationOrders
  },
}
