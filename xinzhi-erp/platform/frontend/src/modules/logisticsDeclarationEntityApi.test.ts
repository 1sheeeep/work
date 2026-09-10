import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '../api/client'
import { logisticsDeclarationEntityApi } from './logisticsDeclarationEntityApi'

vi.mock('../api/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../api/client')>()
  return { ...original, apiClient: { request: vi.fn() } }
})

const shop = {
  shopId: '79000000-0000-4000-8000-000000000011', shopName: 'Shop A',
  shopStatus: 'ACTIVE', platformCode: 'SHOPIFY', platformName: 'Shopify',
}
const entity = {
  id: '79000000-0000-4000-8000-000000000001', name: '新知生产销售企业',
  enterpriseCode: 'CN-91310000ABC', shops: [shop], status: 'ACTIVE',
  version: 0, createdAt: '2026-08-07T00:00:00Z',
  updatedAt: '2026-08-07T00:00:00Z',
}

beforeEach(() => vi.mocked(apiClient.request).mockReset())

describe('logistics declaration entity api', () => {
  it('strictly parses a paged entity list and sends bounded filters', async () => {
    vi.mocked(apiClient.request).mockResolvedValue({
      items: [entity], page: 0, size: 25, totalElements: 1, totalPages: 1,
    })
    await expect(logisticsDeclarationEntityApi.list({
      status: 'ACTIVE', searchField: 'SHOP', keyword: ' Shop A ', page: 0, size: 25,
    })).resolves.toEqual({ items: [entity], page: 0, size: 25, totalElements: 1, totalPages: 1 })
    expect(apiClient.request).toHaveBeenCalledWith(
      '/api/v1/logistics/declaration-entities?status=ACTIVE&searchField=SHOP&page=0&size=25&keyword=Shop+A',
      expect.objectContaining({ signal: undefined }),
    )
  })

  it('rejects unknown response fields and duplicate shop bindings', async () => {
    vi.mocked(apiClient.request).mockResolvedValue({
      items: [{ ...entity, shops: [shop, shop] }], page: 0, size: 25,
      totalElements: 1, totalPages: 1,
    })
    await expect(logisticsDeclarationEntityApi.list({
      status: 'ACTIVE', searchField: 'NAME', page: 0, size: 25,
    })).rejects.toThrow('Invalid logistics declaration entity response')
  })

  it('strictly parses searchable shop options', async () => {
    vi.mocked(apiClient.request).mockResolvedValue({
      items: [{ id: shop.shopId, name: shop.shopName, status: shop.shopStatus,
        platformCode: shop.platformCode, platformName: shop.platformName }],
      page: 0, size: 100, totalElements: 1, totalPages: 1,
    })
    const result = await logisticsDeclarationEntityApi.shopOptions({
      keyword: 'Shopify', page: 0, size: 100,
    })
    expect(result.items[0]?.id).toBe(shop.shopId)
    expect(apiClient.request).toHaveBeenCalledWith(
      '/api/v1/logistics/declaration-entities/shop-options?page=0&size=100&keyword=Shopify',
      expect.any(Object),
    )
  })

  it('validates and sends create update archive contracts', async () => {
    vi.mocked(apiClient.request).mockResolvedValue(entity)
    const input = { name: entity.name, enterpriseCode: entity.enterpriseCode,
      shopIds: [shop.shopId] }
    await logisticsDeclarationEntityApi.create(input)
    expect(apiClient.request).toHaveBeenLastCalledWith(
      '/api/v1/logistics/declaration-entities', { method: 'POST', body: input },
    )
    await logisticsDeclarationEntityApi.update(entity.id, 0, input)
    expect(apiClient.request).toHaveBeenLastCalledWith(
      `/api/v1/logistics/declaration-entities/${entity.id}`,
      { method: 'PUT', body: { version: 0, entity: input } },
    )
    await logisticsDeclarationEntityApi.archive(entity.id, 0)
    expect(apiClient.request).toHaveBeenLastCalledWith(
      `/api/v1/logistics/declaration-entities/${entity.id}/archive`,
      { method: 'POST', body: { version: 0 } },
    )
  })
})
