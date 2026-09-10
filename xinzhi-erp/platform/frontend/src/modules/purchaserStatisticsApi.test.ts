import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '../api/client'
import { purchaserStatisticsApi } from './purchaserStatisticsApi'

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client')
  return { ...actual, apiClient: { request: vi.fn() } }
})

const request = vi.mocked(apiClient.request)

beforeEach(() => request.mockReset())

describe('purchaser statistics api', () => {
  it('parses exact operational counts and preserves bounded filters', async () => {
    request.mockResolvedValue({
      items: [{
        periodStart: '2026-08-01', purchaserDisplayName: 'Buyer A',
        orderCount: 4, orderedQuantity: 12, receivedQuantity: 7,
        outstandingQuantity: 5, newOrderCount: 1,
        approvedOrderCount: 1, partiallyReceivedOrderCount: 1,
        receivedOrderCount: 1,
      }],
      granularity: 'DAY', totalOrders: 4, totalOrderedQuantity: 12,
      totalReceivedQuantity: 7, totalOutstandingQuantity: 5,
      page: 0, size: 25, totalElements: 1, totalPages: 1,
    })

    const result = await purchaserStatisticsApi.summarize({
      granularity: 'DAY', purchaser: ` ${'B'.repeat(120)} `,
      orderedFrom: '2026-08-01T00:00:00.000Z',
      orderedToExclusive: '2026-08-02T00:00:00.000Z',
      page: 0, size: 25,
    })

    expect(result.items[0]?.outstandingQuantity).toBe(5)
    const url = String(request.mock.calls[0]?.[0])
    expect(new URL(url, 'http://erp.local').searchParams.get('purchaser'))
      .toBe('B'.repeat(100))
    expect(url).toContain('orderedToExclusive=2026-08-02T00%3A00%3A00.000Z')
  })

  it('rejects non-increasing windows and inconsistent totals', async () => {
    await expect(purchaserStatisticsApi.summarize({
      granularity: 'MONTH',
      orderedFrom: '2026-08-02T00:00:00.000Z',
      orderedToExclusive: '2026-08-02T00:00:00.000Z',
      page: 0, size: 25,
    })).rejects.toMatchObject({ code: 'invalid_request' })

    request.mockResolvedValue({
      items: [{
        periodStart: '2026-08-01', purchaserDisplayName: 'Buyer A',
        orderCount: 2, orderedQuantity: 10, receivedQuantity: 3,
        outstandingQuantity: 6, newOrderCount: 1,
        approvedOrderCount: 0, partiallyReceivedOrderCount: 1,
        receivedOrderCount: 0,
      }],
      granularity: 'DAY', totalOrders: 2, totalOrderedQuantity: 10,
      totalReceivedQuantity: 3, totalOutstandingQuantity: 7,
      page: 0, size: 25, totalElements: 1, totalPages: 1,
    })
    await expect(purchaserStatisticsApi.summarize({
      granularity: 'DAY', page: 0, size: 25,
    })).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('exports the bounded filters through the strict CSV contract', async () => {
    const content = '\uFEFF统计期间（UTC）,统计粒度,采购员名称快照,采购单数,采购数量,已收数量,待收数量,待审核,待收货,部分收货,已收货\r\n'
    request.mockResolvedValue({
      filename: 'purchaser-statistics.csv',
      mediaType: 'text/csv;charset=utf-8',
      rowCount: 0,
      content,
    })

    await expect(purchaserStatisticsApi.exportCsv({
      granularity: 'MONTH',
      purchaser: ' Buyer A ',
      orderedFrom: '2026-08-01T00:00:00.000Z',
      orderedToExclusive: '2026-09-01T00:00:00.000Z',
    })).resolves.toEqual({
      filename: 'purchaser-statistics.csv',
      mediaType: 'text/csv;charset=utf-8',
      rowCount: 0,
      content,
    })
    expect(request).toHaveBeenCalledWith(
      '/api/v1/procurement/statistics/purchasers/exports',
      {
        method: 'POST',
        body: {
          granularity: 'MONTH',
          purchaser: 'Buyer A',
          orderedFrom: '2026-08-01T00:00:00.000Z',
          orderedToExclusive: '2026-09-01T00:00:00.000Z',
        },
      },
    )
  })

  it('rejects unsafe export responses', async () => {
    request.mockResolvedValue({
      filename: '../purchaser-statistics.csv',
      mediaType: 'text/csv;charset=utf-8',
      rowCount: 0,
      content: '\uFEFF统计期间（UTC）,采购员名称快照\r\n',
    })

    await expect(purchaserStatisticsApi.exportCsv({ granularity: 'DAY' }))
      .rejects.toMatchObject({ code: 'invalid_response' })
  })
})
