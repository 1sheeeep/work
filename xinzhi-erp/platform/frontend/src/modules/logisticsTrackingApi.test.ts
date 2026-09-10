import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '../api/client'
import { logisticsTrackingApi } from './logisticsTrackingApi'

vi.mock('../api/client', () => ({
  ApiError: class ApiError extends Error {
    status?: number
    code?: string
    details?: unknown
    constructor(message: string, options?: { status?: number; code?: string; details?: unknown }) {
      super(message)
      Object.assign(this, options)
    }
  },
  apiClient: { request: vi.fn() },
}))

const item = {
  orderId: 'a1000000-0000-4000-8000-000000000001',
  platformCode: 'SHOPIFY',
  platformName: 'Shopify',
  shopName: '示例店铺',
  orderNo: 'ORDER-100',
  countryCode: 'US',
  warehouseSummary: 'WH-1 · 主仓',
  logisticsChannel: 'UPS',
  trackingReference: 'TN-100',
  secondaryTrackingReference: null,
  trackingStatus: 'IN_TRANSIT',
  fixedCategory: null,
  customCategory: '重点订单',
  shippedAt: '2026-08-01T08:00:00Z',
  updatedAt: '2026-08-02T08:00:00Z',
}

describe('logisticsTrackingApi', () => {
  beforeEach(() => vi.mocked(apiClient.request).mockReset())

  it('maps a strict page and sends bounded filters', async () => {
    vi.mocked(apiClient.request).mockResolvedValue({
      items: [item], page: 0, size: 25, totalElements: 1, totalPages: 1,
    })

    const result = await logisticsTrackingApi.list({
      shop: ' 示例店铺 ', carrier: ' UPS ', country: 'US',
      searchField: 'TRACKING_NO', keyword: ' TN-100 ',
      status: 'IN_TRANSIT', page: 0, size: 25,
    })

    expect(result.items[0]).toEqual(expect.objectContaining({
      orderNo: 'ORDER-100', secondaryTrackingReference: undefined,
    }))
    const url = vi.mocked(apiClient.request).mock.calls[0][0]
    expect(url).toContain('shop=%E7%A4%BA%E4%BE%8B%E5%BA%97%E9%93%BA')
    expect(url).toContain('searchField=TRACKING_NO')
    expect(url).toContain('status=IN_TRANSIT')
  })

  it('rejects missing tracking numbers and inconsistent pagination', async () => {
    vi.mocked(apiClient.request).mockResolvedValue({
      items: [{ ...item, trackingReference: null }],
      page: 0, size: 25, totalElements: 1, totalPages: 1,
    })
    await expect(logisticsTrackingApi.list({
      searchField: 'ORDER_NO', page: 0, size: 25,
    })).rejects.toThrow('Invalid logistics tracking response')

    vi.mocked(apiClient.request).mockResolvedValue({
      items: [], page: 1, size: 25, totalElements: 0, totalPages: 0,
    })
    await expect(logisticsTrackingApi.list({
      searchField: 'ORDER_NO', page: 0, size: 25,
    })).rejects.toThrow('Invalid logistics tracking response')

    await expect(logisticsTrackingApi.list({
      country: 'USA', searchField: 'ORDER_NO', page: 0, size: 25,
    })).rejects.toThrow('Invalid logistics tracking request')
  })

  it('exports all tracking filters through the strict CSV contract', async () => {
    const content = '\uFEFF平台编码,平台名称,店铺名称,订单号,目的国家,仓库,物流渠道,主运单号,备用运单号,跟踪状态,固定分类,自定义分类,发货时间,更新时间\r\n'
    vi.mocked(apiClient.request).mockResolvedValue({
      filename: 'logistics-tracking.csv', mediaType: 'text/csv;charset=utf-8',
      rowCount: 0, content,
    })

    await expect(logisticsTrackingApi.exportCsv({
      shop: ' Demo shop ', carrier: ' UPS ', country: 'US', warehouse: ' Main ',
      category: ' Priority ', searchField: 'TRACKING_NO', keyword: ' TN-1 ',
      status: 'IN_TRANSIT', shippedFrom: '2026-08-01T00:00:00.000Z',
      shippedTo: '2026-08-02T23:59:59.999Z',
    })).resolves.toEqual({
      filename: 'logistics-tracking.csv', mediaType: 'text/csv;charset=utf-8',
      rowCount: 0, content,
    })
    expect(apiClient.request).toHaveBeenCalledWith('/api/v1/logistics/tracking/exports', {
      method: 'POST', body: {
        searchField: 'TRACKING_NO', shop: 'Demo shop', carrier: 'UPS', country: 'US',
        warehouse: 'Main', category: 'Priority', keyword: 'TN-1', status: 'IN_TRANSIT',
        shippedFrom: '2026-08-01T00:00:00.000Z',
        shippedTo: '2026-08-02T23:59:59.999Z',
      },
    })
  })

  it('rejects an unsafe tracking export response', async () => {
    vi.mocked(apiClient.request).mockResolvedValue({
      filename: '../logistics-tracking.csv', mediaType: 'text/csv;charset=utf-8',
      rowCount: 0, content: '\uFEFF平台编码,平台名称\r\n',
    })
    await expect(logisticsTrackingApi.exportCsv({
      searchField: 'ORDER_NO',
    })).rejects.toThrow('Invalid logistics tracking response')
  })
})
