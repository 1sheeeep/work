import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '../api/client'
import { storeAppReadPreparationApi } from './storeAppReadPreparationApi'

const SHOP = '22222222-2222-4222-8222-222222222222'
const mode = 'CUSTOMER_SERVICE_STORE_APP_READ_ONLY'
export const preparationStatusFixture = () => ({
  readOnly: true, productionReady: false, bindingVersion: 7,
  snapshot: { mode, shopify: { status: 'CONNECTED', shopName: 'Synthetic shop', shopDomain: 'synthetic-preparation.myshopify.com', updatedAt: '2026-09-06T01:02:03Z' },
    shopifyScopes: [{ scope: 'read_orders', status: 'GRANTED' }] },
})
export const preparationOrdersFixture = () => ({
  readOnly: true, productionReady: false, bindingVersion: 7,
  page: { mode, connectionStatus: 'CONNECTED', hasNextPage: false, fetchedAt: '2026-09-06T01:02:03Z',
    orders: [{ externalOrderRef: 'gid://shopify/Order/123', name: '#SYNTHETIC-123', createdAt: '2026-09-05T01:02:03Z' }] },
})
afterEach(() => vi.restoreAllMocks())
describe('Store app read preparation API', () => {
  it('only calls the bound read endpoints and disables caching', async () => {
    const request = vi.spyOn(apiClient, 'request').mockResolvedValueOnce(preparationStatusFixture()).mockResolvedValueOnce(preparationOrdersFixture())
    await storeAppReadPreparationApi.status(SHOP); await storeAppReadPreparationApi.orders(SHOP)
    expect(request.mock.calls.map(call => call[0])).toEqual([
      `/api/v1/platform-center/shops/${SHOP}/store-app-read-preparation`,
      `/api/v1/platform-center/shops/${SHOP}/store-app-read-preparation/orders?limit=10`,
    ])
    expect(request.mock.calls.every(call => call[1]?.cache === 'no-store' && !call[1]?.body && !call[1]?.method)).toBe(true)
  })
  it.each([
    ['write enabled', (x: ReturnType<typeof preparationStatusFixture>) => { x.readOnly = false }],
    ['false readiness', (x: ReturnType<typeof preparationStatusFixture>) => { x.productionReady = true }],
    ['unsafe version', (x: ReturnType<typeof preparationStatusFixture>) => { x.bindingVersion = Number.MAX_SAFE_INTEGER + 1 }],
    ['wrong source', (x: ReturnType<typeof preparationStatusFixture>) => { x.snapshot.mode = 'XZ_ERP_APP' }],
    ['revoked', (x: ReturnType<typeof preparationStatusFixture>) => { x.snapshot.shopify.status = 'REVOKED' }],
    ['wrong domain', (x: ReturnType<typeof preparationStatusFixture>) => { x.snapshot.shopify.shopDomain = 'evil.example' }],
    ['bad time', (x: ReturnType<typeof preparationStatusFixture>) => { x.snapshot.shopify.updatedAt = 'not-a-date' }],
    ['unknown scopes', (x: ReturnType<typeof preparationStatusFixture>) => { x.snapshot.shopifyScopes = null as never }],
  ])('rejects %s', async (_, mutate) => {
    const fixture = preparationStatusFixture(); mutate(fixture)
    vi.spyOn(apiClient, 'request').mockResolvedValue(fixture)
    await expect(storeAppReadPreparationApi.status(SHOP)).rejects.toThrow()
  })
  it('rejects duplicate order refs and a malformed shop before a request', async () => {
    const fixture = preparationOrdersFixture(); fixture.page.orders.push(fixture.page.orders[0])
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue(fixture)
    await expect(storeAppReadPreparationApi.orders(SHOP)).rejects.toThrow()
    await expect(storeAppReadPreparationApi.status('../elsewhere')).rejects.toThrow()
    expect(request).toHaveBeenCalledTimes(1)
  })
})
