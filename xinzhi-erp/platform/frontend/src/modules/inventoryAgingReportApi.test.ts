import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '../api/client'
import { inventoryAgingReportApi } from './inventoryAgingReportApi'

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client')
  return { ...actual, apiClient: { request: vi.fn() } }
})

const request = vi.mocked(apiClient.request)
const skuId = 'a3000000-0000-4000-8000-000000000001'
const warehouseId = 'a3000000-0000-4000-8000-000000000002'

function page() {
  return {
    items: [{
      skuId,
      skuBusinessCode: 'SKU-AGING-1',
      skuName: '测试商品',
      warehouseId,
      warehouseBusinessCode: 'WH-1',
      warehouseName: '测试仓库',
      oldestInventoryDate: '2026-03-01',
      maximumAgeDays: 162,
      totalQuantity: 40,
      age0To30Quantity: 0,
      age31To60Quantity: 0,
      age61To90Quantity: 20,
      age91To365Quantity: 20,
      ageOver365Quantity: 0,
    }],
    totalQuantity: 40,
    age0To30Quantity: 0,
    age31To60Quantity: 0,
    age61To90Quantity: 20,
    age91To365Quantity: 20,
    ageOver365Quantity: 0,
    page: 0,
    size: 50,
    totalElements: 1,
    totalPages: 1,
  }
}

beforeEach(() => request.mockReset())

describe('inventory aging report api', () => {
  it('parses FIFO buckets and preserves bounded filters', async () => {
    request.mockResolvedValue(page())

    await expect(inventoryAgingReportApi.summarize({
      cutoffDate: '2026-08-10',
      warehouseId,
      keyword: ` ${'S'.repeat(120)} `,
      page: 0,
      size: 50,
    })).resolves.toMatchObject({ totalQuantity: 40 })

    const url = new URL(String(request.mock.calls[0]?.[0]), 'http://erp.local')
    expect(url.searchParams.get('keyword')).toBe('S'.repeat(100))
    expect(url.searchParams.get('warehouseId')).toBe(warehouseId)
    expect(url.searchParams.get('cutoffDate')).toBe('2026-08-10')
  })

  it('rejects invalid requests and inconsistent bucket identities', async () => {
    await expect(inventoryAgingReportApi.summarize({
      cutoffDate: '2026-02-30',
      page: 0,
      size: 50,
    })).rejects.toMatchObject({ code: 'invalid_request' })

    request.mockResolvedValue({
      ...page(),
      items: [{ ...page().items[0], ageOver365Quantity: 1 }],
    })
    await expect(inventoryAgingReportApi.summarize({
      cutoffDate: '2026-08-10',
      page: 0,
      size: 50,
    })).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('parses the bounded CSV export contract', async () => {
    request.mockResolvedValue({
      filename: 'inventory-aging-report.csv',
      mediaType: 'text/csv;charset=utf-8',
      rowCount: 1,
      content: '\uFEFF库存SKU,商品名称,仓库编码,仓库名称,最早在库日期,最长库龄(天),库存总数,0-30天,31-60天,61-90天,91-365天,365天以上\r\nSKU-AGING-1,测试商品,WH-1,测试仓库,2026-03-01,162,40,0,0,20,20,0\r\n',
    })

    await expect(inventoryAgingReportApi.exportCsv({
      cutoffDate: '2026-08-10',
      warehouseId,
      keyword: ' SKU-AGING-1 ',
    })).resolves.toMatchObject({ rowCount: 1 })
    expect(request).toHaveBeenCalledWith(
      '/api/v1/analytics/inventory-aging/exports',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          cutoffDate: '2026-08-10',
          warehouseId,
          keyword: 'SKU-AGING-1',
        }),
      }),
    )
  })
})
