import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '../api/client'
import { inventoryPeriodReportApi } from './inventoryPeriodReportApi'

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client')
  return { ...actual, apiClient: { request: vi.fn() } }
})

const request = vi.mocked(apiClient.request)
const skuId = 'a1000000-0000-4000-8000-000000000001'
const warehouseId = 'a1000000-0000-4000-8000-000000000002'

beforeEach(() => request.mockReset())

describe('inventory period report api', () => {
  it('parses exact quantities and preserves bounded filters', async () => {
    request.mockResolvedValue({
      items: [{
        skuId,
        skuBusinessCode: 'SKU-1',
        skuName: '测试商品',
        warehouseId,
        warehouseBusinessCode: 'WH-1',
        warehouseName: '主仓',
        openingQuantity: 10,
        increasedQuantity: 5,
        decreasedQuantity: 3,
        closingQuantity: 12,
      }],
      totalOpeningQuantity: 10,
      totalIncreasedQuantity: 5,
      totalDecreasedQuantity: 3,
      totalClosingQuantity: 12,
      page: 0,
      size: 50,
      totalElements: 1,
      totalPages: 1,
    })

    await expect(inventoryPeriodReportApi.summarize({
      periodFrom: '2026-07-01',
      periodTo: '2026-07-31',
      keyword: ` ${'S'.repeat(120)} `,
      page: 0,
      size: 50,
    })).resolves.toMatchObject({ totalClosingQuantity: 12 })
    const url = new URL(String(request.mock.calls[0]?.[0]), 'http://erp.local')
    expect(url.searchParams.get('keyword')).toBe('S'.repeat(100))
    expect(url.searchParams.get('periodTo')).toBe('2026-07-31')
  })

  it('rejects invalid periods and inconsistent quantity identities', async () => {
    await expect(inventoryPeriodReportApi.summarize({
      periodFrom: '2026-08-01',
      periodTo: '2026-07-31',
      page: 0,
      size: 50,
    })).rejects.toMatchObject({ code: 'invalid_request' })

    request.mockResolvedValue({
      items: [{
        skuId,
        skuBusinessCode: 'SKU-1',
        skuName: '测试商品',
        warehouseId,
        warehouseBusinessCode: 'WH-1',
        warehouseName: '主仓',
        openingQuantity: 10,
        increasedQuantity: 5,
        decreasedQuantity: 3,
        closingQuantity: 99,
      }],
      totalOpeningQuantity: 10,
      totalIncreasedQuantity: 5,
      totalDecreasedQuantity: 3,
      totalClosingQuantity: 12,
      page: 0,
      size: 50,
      totalElements: 1,
      totalPages: 1,
    })
    await expect(inventoryPeriodReportApi.summarize({
      periodFrom: '2026-07-01',
      periodTo: '2026-07-31',
      page: 0,
      size: 50,
    })).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('parses the bounded export contract and sends current filters', async () => {
    request.mockResolvedValue({
      filename: 'inventory-period-report.csv',
      mediaType: 'text/csv;charset=utf-8',
      rowCount: 1,
      content: '\uFEFF库存SKU,商品名称,仓库编码,仓库名称,期初数量,期间增加,期间减少,期末数量\r\nSKU-1,测试商品,WH-1,主仓,10,5,3,12\r\n',
    })

    const result = await inventoryPeriodReportApi.exportCsv({
      periodFrom: '2026-07-01',
      periodTo: '2026-07-31',
      warehouseId,
      keyword: ' SKU-1 ',
    })

    expect(result.rowCount).toBe(1)
    expect(request).toHaveBeenCalledWith(
      '/api/v1/analytics/inventory-period/exports',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          periodFrom: '2026-07-01',
          periodTo: '2026-07-31',
          warehouseId,
          keyword: 'SKU-1',
        }),
      }),
    )
  })

  it('rejects unsafe export responses', async () => {
    request.mockResolvedValue({
      filename: 'other.csv',
      mediaType: 'text/csv;charset=utf-8',
      rowCount: 0,
      content: '\uFEFF库存SKU,商品名称\r\n',
    })

    await expect(inventoryPeriodReportApi.exportCsv({
      periodFrom: '2026-07-01',
      periodTo: '2026-07-31',
    })).rejects.toMatchObject({ code: 'invalid_response' })
  })
})
