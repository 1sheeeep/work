import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '../api/client'
import {
  listingRealtimeSalesApi,
  parseListingRealtimeSalesPage,
} from './listingRealtimeSalesApi'

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client')
  return { ...actual, apiClient: { request: vi.fn() } }
})

const request = vi.mocked(apiClient.request)
const item = {
  listingId: '11111111-1111-4111-8111-111111111111',
  platformCode: 'SHOPIFY',
  platformName: 'Shopify',
  shopId: '22222222-2222-4222-8222-222222222222',
  shopName: 'Demo Shop',
  externalListingRef: 'item-1',
  externalVariantRef: 'variant-1',
  skuId: '33333333-3333-4333-8333-333333333333',
  skuCode: 'SKU-A',
  skuName: '商品 A',
  variantSummary: '黑色',
  rangeSalesQuantity: 5,
  rangeOrderCount: 2,
  todaySalesQuantity: 2,
  yesterdaySalesQuantity: 1,
  last7DaysSalesQuantity: 5,
  last28DaysSalesQuantity: 5,
  last42DaysSalesQuantity: 5,
  lastPlacedAt: '2026-08-10T10:00:00Z',
}

beforeEach(() => request.mockReset())

describe('listing realtime sales API', () => {
  it('maps bounded filters and strictly parses attributed facts', async () => {
    request.mockResolvedValue({
      items: [item], totalListingCount: 1, totalRangeSalesQuantity: 5,
      observedAt: '2026-08-10T12:00:00Z',
      page: 0, size: 25, totalPages: 1,
    })

    await expect(listingRealtimeSalesApi.summarize({
      keyword: ` ${'A'.repeat(120)} `,
      rangeFrom: '2026-08-01T00:00:00Z',
      asOf: '2026-08-10T12:00:00Z',
      page: 0,
      size: 25,
    })).resolves.toMatchObject({ totalListingCount: 1 })
    const url = String(request.mock.calls[0]?.[0])
    expect(new URL(url, 'http://erp.local').searchParams.get('keyword'))
      .toBe('A'.repeat(100))
  })

  it('rejects future fields, duplicate identities and inconsistent paging', () => {
    expect(() => parseListingRealtimeSalesPage({
      items: [{ ...item, latestPrice: 100 }], totalListingCount: 1,
      totalRangeSalesQuantity: 5, observedAt: '2026-08-10T12:00:00Z',
      page: 0, size: 25, totalPages: 1,
    })).toThrow(/item\.shape/)
    expect(() => parseListingRealtimeSalesPage({
      items: [item, item], totalListingCount: 2,
      totalRangeSalesQuantity: 10, observedAt: '2026-08-10T12:00:00Z',
      page: 0, size: 25, totalPages: 1,
    })).toThrow(/cardinality/)
    expect(() => parseListingRealtimeSalesPage({
      items: [], totalListingCount: 26, totalRangeSalesQuantity: 10,
      observedAt: '2026-08-10T12:00:00Z',
      page: 0, size: 25, totalPages: 1,
    })).toThrow(/cardinality/)
  })

  it('rejects invalid time windows before requesting', async () => {
    await expect(listingRealtimeSalesApi.summarize({
      rangeFrom: '2026-08-10T12:00:00Z',
      asOf: '2026-08-10T12:00:00Z', page: 0, size: 25,
    })).rejects.toThrow(/request: time/)
    expect(request).not.toHaveBeenCalled()
  })

  it('exports the bounded filter through the strict CSV contract', async () => {
    const content = '\uFEFF平台编码,平台名称,店铺,Listing,Listing变体,库存SKU,SKU名称,规格,所选区间销量,所选区间订单数,今日销量,昨日销量,近7天销量,近28天销量,近42天销量,最近下单,统计截至\r\n'
    request.mockResolvedValue({
      filename: 'listing-realtime-sales.csv',
      mediaType: 'text/csv;charset=utf-8',
      rowCount: 0,
      content,
    })

    await expect(listingRealtimeSalesApi.exportCsv({
      keyword: ' SKU-A ',
      rangeFrom: '2026-08-01T00:00:00Z',
      asOf: '2026-08-10T12:00:00Z',
    })).resolves.toEqual({
      filename: 'listing-realtime-sales.csv',
      mediaType: 'text/csv;charset=utf-8',
      rowCount: 0,
      content,
    })
    expect(request).toHaveBeenCalledWith(
      '/api/v1/analytics/listing-sales/exports',
      {
        method: 'POST',
        body: {
          keyword: 'SKU-A',
          rangeFrom: '2026-08-01T00:00:00Z',
          asOf: '2026-08-10T12:00:00Z',
        },
      },
    )
  })

  it('rejects an unsafe export response', async () => {
    request.mockResolvedValue({
      filename: '../listing-sales.csv',
      mediaType: 'text/csv;charset=utf-8',
      rowCount: 0,
      content: '\uFEFF平台编码,平台名称\r\n',
    })

    await expect(listingRealtimeSalesApi.exportCsv({
      asOf: '2026-08-10T12:00:00Z',
    })).rejects.toThrow(/export\.contract/)
  })
})
