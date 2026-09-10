import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '../api/client'
import { storeHealthApi } from './storeHealthApi'

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client')
  return { ...actual, apiClient: { request: vi.fn() } }
})

const request = vi.mocked(apiClient.request)
beforeEach(() => request.mockReset())

describe('store health api', () => {
  it('parses exact tenant store health and sends bounded filters', async () => {
    request.mockResolvedValue({
      items: [{
        shopId: '086ac851-65d2-4c05-ae31-2ba5da37cc23', platformCode: 'SHOPIFY', platformName: 'Shopify', shopName: '独立站一店', externalShopRef: 'xinzhi-app-lab.myshopify.com', shopStatus: 'ACTIVE', authorizationStatus: 'AUTHORIZED', scopes: ['read_orders'], lastVerifiedAt: '2026-08-10T16:00:00Z', updatedAt: '2026-08-10T16:00:00Z',
        latestSync: { jobType: 'ORDERS', status: 'SUCCEEDED', progressProcessed: 1, progressTotal: 1, attemptCount: 1, safeErrorSummary: null, requestedAt: '2026-08-10T15:00:00Z', completedAt: '2026-08-10T15:01:00Z' },
      }],
      platforms: [{ code: 'SHOPIFY', displayName: 'Shopify' }], page: 0, size: 25, totalElements: 1, totalPages: 1,
    })
    const result = await storeHealthApi.list({ query: ` ${'a'.repeat(120)} `, platform: 'SHOPIFY', authorizationStatus: 'AUTHORIZED', page: 0, size: 25 })
    expect(result.items[0]?.latestSync?.status).toBe('SUCCEEDED')
    const url = new URL(String(request.mock.calls[0]?.[0]), 'http://erp.local')
    expect(url.searchParams.get('query')).toBe('a'.repeat(100))
    expect(url.searchParams.get('platform')).toBe('SHOPIFY')
  })

  it('rejects inconsistent progress and pagination', async () => {
    request.mockResolvedValue({ items: [{ shopId: '086ac851-65d2-4c05-ae31-2ba5da37cc23', platformCode: 'SHOPIFY', platformName: 'Shopify', shopName: '店铺', externalShopRef: 'shop.example', shopStatus: 'ACTIVE', authorizationStatus: 'AUTHORIZED', scopes: [], lastVerifiedAt: null, updatedAt: '2026-08-10T16:00:00Z', latestSync: { jobType: 'ORDERS', status: 'RUNNING', progressProcessed: 2, progressTotal: 1, attemptCount: 1, safeErrorSummary: null, requestedAt: '2026-08-10T15:00:00Z', completedAt: null } }], platforms: [], page: 0, size: 25, totalElements: 1, totalPages: 1 })
    await expect(storeHealthApi.list({ page: 0, size: 25 })).rejects.toMatchObject({ code: 'invalid_response' })
    await expect(storeHealthApi.list({ page: -1, size: 25 })).rejects.toMatchObject({ code: 'invalid_response' })
  })
})
