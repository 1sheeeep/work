import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '../api/client'
import { trackingNumberApi } from './trackingNumberApi'

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client')
  return { ...actual, apiClient: { request: vi.fn() } }
})
const request = vi.mocked(apiClient.request)
const item = {
  id: '77000000-0000-4000-8000-000000000001',
  importBatchId: '77000000-0000-4000-8000-000000000002',
  trackingType: 'DOMESTIC_EXPRESS', logisticsChannel: 'SF',
  trackingReference: 'TN-1', status: 'UNUSED', orderReference: null,
  packageNumber: null, usedAt: null, version: 0,
  createdAt: '2026-08-07T00:00:00Z',
}

beforeEach(() => request.mockReset())

describe('tracking number api', () => {
  it('parses an exact page and bounds query text', async () => {
    request.mockResolvedValue({ items: [item], page: 0, size: 25, totalElements: 1, totalPages: 1 })
    const result = await trackingNumberApi.list({
      type: 'DOMESTIC_EXPRESS', status: 'UNUSED', channel: ` ${'S'.repeat(120)} `,
      searchField: 'TRACKING_NO', keyword: ' TN-1 ', page: 0, size: 25,
    })
    expect(result.items[0]?.trackingReference).toBe('TN-1')
    const url = String(request.mock.calls[0]?.[0])
    expect(new URL(url, 'http://erp.local').searchParams.get('channel')).toBe('S'.repeat(100))
  })

  it('rejects contradictory used data', async () => {
    request.mockResolvedValue({
      items: [{ ...item, status: 'USED' }], page: 0, size: 25,
      totalElements: 1, totalPages: 1,
    })
    await expect(trackingNumberApi.list({ page: 0, size: 25 }))
      .rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('uses explicit write endpoints', async () => {
    request.mockResolvedValueOnce({
      batchId: '77000000-0000-4000-8000-000000000002', importedCount: 2,
    })
    await trackingNumberApi.importNumbers({
      type: 'DOMESTIC_EXPRESS', channel: 'SF', trackingReferences: ['TN-1', 'TN-2'],
    })
    expect(request).toHaveBeenLastCalledWith('/api/v1/logistics/tracking-numbers/imports', {
      method: 'POST', body: { type: 'DOMESTIC_EXPRESS', channel: 'SF', trackingReferences: ['TN-1', 'TN-2'] },
    })
    request.mockResolvedValueOnce({ ...item, status: 'ARCHIVED', version: 1 })
    await trackingNumberApi.archive(item.id, 0)
    expect(request).toHaveBeenLastCalledWith(`/api/v1/logistics/tracking-numbers/${item.id}/archive`, {
      method: 'POST', body: { version: 0 },
    })
  })
})
