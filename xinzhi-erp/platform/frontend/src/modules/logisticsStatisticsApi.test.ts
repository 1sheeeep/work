import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '../api/client'
import { logisticsStatisticsApi } from './logisticsStatisticsApi'

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client')
  return { ...actual, apiClient: { request: vi.fn() } }
})

const request = vi.mocked(apiClient.request)

beforeEach(() => request.mockReset())

describe('logistics statistics api', () => {
  it('parses exact grouped status counts and preserves request bounds', async () => {
    request.mockResolvedValue({
      items: [{
        groupValue: 'US',
        recordCount: 3,
        statuses: [
          { status: 'DELIVERED', recordCount: 2 },
          { status: null, recordCount: 1 },
        ],
      }],
      totalStatuses: [
        { status: 'DELIVERED', recordCount: 2 },
        { status: null, recordCount: 1 },
      ],
      dimension: 'COUNTRY',
      totalRecords: 3,
      page: 0,
      size: 25,
      totalElements: 1,
      totalPages: 1,
    })

    const result = await logisticsStatisticsApi.summarize({
      dimension: 'COUNTRY',
      value: ` ${'U'.repeat(120)} `,
      shippedFrom: '2026-08-01T00:00:00.000Z',
      shippedToExclusive: '2026-08-03T00:00:00.000Z',
      page: 0,
      size: 25,
    })

    expect(result.items[0]?.statuses[1]?.status).toBeUndefined()
    const url = String(request.mock.calls[0]?.[0])
    expect(new URL(url, 'http://erp.local').searchParams.get('value'))
      .toBe('U'.repeat(100))
    expect(url).toContain('shippedToExclusive=2026-08-03T00%3A00%3A00.000Z')
  })

  it('rejects non-increasing windows and inconsistent status totals', async () => {
    await expect(logisticsStatisticsApi.summarize({
      dimension: 'CHANNEL',
      shippedFrom: '2026-08-02T00:00:00.000Z',
      shippedToExclusive: '2026-08-02T00:00:00.000Z',
      page: 0,
      size: 25,
    })).rejects.toMatchObject({ code: 'invalid_request' })

    request.mockResolvedValue({
      items: [{
        groupValue: 'UPS', recordCount: 2,
        statuses: [{ status: 'DELIVERED', recordCount: 1 }],
      }],
      totalStatuses: [{ status: 'DELIVERED', recordCount: 2 }],
      dimension: 'CHANNEL', totalRecords: 2,
      page: 0, size: 25, totalElements: 1, totalPages: 1,
    })
    await expect(logisticsStatisticsApi.summarize({
      dimension: 'CHANNEL', page: 0, size: 25,
    })).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('rejects global status counts that do not cover all filtered records', async () => {
    request.mockResolvedValue({
      items: [{
        groupValue: 'UPS', recordCount: 2,
        statuses: [{ status: 'DELIVERED', recordCount: 2 }],
      }],
      totalStatuses: [{ status: 'DELIVERED', recordCount: 1 }],
      dimension: 'CHANNEL', totalRecords: 2,
      page: 0, size: 25, totalElements: 1, totalPages: 1,
    })

    await expect(logisticsStatisticsApi.summarize({
      dimension: 'CHANNEL', page: 0, size: 25,
    })).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('parses the bounded export contract and sends current filters', async () => {
    request.mockResolvedValue({
      filename: 'logistics-statistics.csv',
      mediaType: 'text/csv;charset=utf-8',
      rowCount: 1,
      content: '\uFEFF统计维度,分组值,跟踪状态,状态记录数,分组记录数\r\n物流渠道,UPS,DELIVERED,2,2\r\n',
    })

    const result = await logisticsStatisticsApi.exportCsv({
      dimension: 'CHANNEL',
      value: ' UPS ',
      shippedFrom: '2026-08-01T00:00:00.000Z',
      shippedToExclusive: '2026-08-03T00:00:00.000Z',
    })

    expect(result.rowCount).toBe(1)
    expect(request).toHaveBeenCalledWith(
      '/api/v1/logistics/statistics/exports',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          dimension: 'CHANNEL', value: 'UPS',
        }),
      }),
    )
  })

  it('rejects unsafe export responses', async () => {
    request.mockResolvedValue({
      filename: 'other.csv',
      mediaType: 'text/csv;charset=utf-8',
      rowCount: 0,
      content: '\uFEFF统计维度,分组值\r\n',
    })

    await expect(logisticsStatisticsApi.exportCsv({ dimension: 'COUNTRY' }))
      .rejects.toMatchObject({ code: 'invalid_response' })
  })
})
