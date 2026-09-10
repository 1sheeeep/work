import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '../api/client'
import { orderStatusReportApi } from './orderStatusReportApi'

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client')
  return { ...actual, apiClient: { request: vi.fn() } }
})

const request = vi.mocked(apiClient.request)

beforeEach(() => request.mockReset())

describe('order status report api', () => {
  it('parses exact daily status counts and preserves bounded filters', async () => {
    request.mockResolvedValue({
      items: [{
        reportDate: '2026-08-01',
        orderCount: 3,
        statuses: [
          { status: 'READY_TO_FULFILL', orderCount: 2 },
          { status: 'SHIPPED', orderCount: 1 },
        ],
      }],
      totalOrders: 3,
      page: 0,
      size: 25,
      totalElements: 1,
      totalPages: 1,
    })

    const result = await orderStatusReportApi.summarize({
      shop: ` ${'S'.repeat(120)} `,
      placedFrom: '2026-08-01T00:00:00.000Z',
      placedToExclusive: '2026-08-02T00:00:00.000Z',
      page: 0,
      size: 25,
    })

    expect(result.items[0]?.statuses[0]?.status).toBe('READY_TO_FULFILL')
    const url = String(request.mock.calls[0]?.[0])
    expect(new URL(url, 'http://erp.local').searchParams.get('shop'))
      .toBe('S'.repeat(100))
    expect(url).toContain('placedToExclusive=2026-08-02T00%3A00%3A00.000Z')
  })

  it('rejects non-increasing windows and inconsistent daily totals', async () => {
    await expect(orderStatusReportApi.summarize({
      placedFrom: '2026-08-02T00:00:00.000Z',
      placedToExclusive: '2026-08-02T00:00:00.000Z',
      page: 0,
      size: 25,
    })).rejects.toMatchObject({ code: 'invalid_request' })

    request.mockResolvedValue({
      items: [{
        reportDate: '2026-08-01',
        orderCount: 2,
        statuses: [{ status: 'SHIPPED', orderCount: 1 }],
      }],
      totalOrders: 2,
      page: 0,
      size: 25,
      totalElements: 1,
      totalPages: 1,
    })
    await expect(orderStatusReportApi.summarize({ page: 0, size: 25 }))
      .rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('parses the bounded export contract and sends current filters', async () => {
    request.mockResolvedValue({
      filename: 'order-status-report.csv',
      mediaType: 'text/csv;charset=utf-8',
      rowCount: 1,
      content: '\uFEFF日期（UTC）,订单总数,待付款,已接收,待审核,待合并,已搁置,待履约,履约中,已发货,已送达,已取消\r\n2026-08-01,3,0,0,0,0,0,0,0,0,2,1\r\n',
    })

    const result = await orderStatusReportApi.exportCsv({
      shop: ' Demo ',
      placedFrom: '2026-08-01T00:00:00.000Z',
      placedToExclusive: '2026-08-03T00:00:00.000Z',
    })

    expect(result.rowCount).toBe(1)
    expect(request).toHaveBeenCalledWith(
      '/api/v1/analytics/order-status/exports',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({ shop: 'Demo' }),
      }),
    )
  })

  it('rejects unsafe export responses', async () => {
    request.mockResolvedValue({
      filename: 'other.csv',
      mediaType: 'text/csv;charset=utf-8',
      rowCount: 0,
      content: '\uFEFF日期（UTC）,订单总数\r\n',
    })

    await expect(orderStatusReportApi.exportCsv({}))
      .rejects.toMatchObject({ code: 'invalid_response' })
  })
})
