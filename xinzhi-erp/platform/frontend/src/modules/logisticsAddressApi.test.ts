import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '../api/client'
import { logisticsAddressApi } from './logisticsAddressApi'

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client')
  return { ...actual, apiClient: { request: vi.fn() } }
})
const request = vi.mocked(apiClient.request)
const summary = {
  id: '78000000-0000-4000-8000-000000000001', addressType: 'SHIPPING',
  name: '上海发货仓', contactName: '运营联系人', countryCode: 'CN',
  province: '上海市', city: '上海市', district: '浦东新区',
  addressLine1: '世纪大道 1 号', status: 'ACTIVE', version: 0,
  updatedAt: '2026-08-07T00:00:00Z',
}
const detail = {
  ...summary, contactEmail: 'ops@example.com', postalCode: '200120',
  landline: null, mobile: '+86 13800000000', companyName: '新知科技', fax: null,
  createdAt: '2026-08-07T00:00:00Z',
}

beforeEach(() => request.mockReset())

describe('logistics address api', () => {
  it('parses an exact summary page and bounds search text', async () => {
    request.mockResolvedValue({ items: [summary], page: 0, size: 25, totalElements: 1, totalPages: 1 })
    const result = await logisticsAddressApi.list({
      type: 'SHIPPING', status: 'ACTIVE', keyword: ` ${'A'.repeat(140)} `,
      page: 0, size: 25,
    })
    expect(result.items[0]?.name).toBe('上海发货仓')
    const url = String(request.mock.calls[0]?.[0])
    expect(new URL(url, 'http://erp.local').searchParams.get('keyword')).toBe('A'.repeat(120))
  })

  it('rejects contact channels leaked into a summary response', async () => {
    request.mockResolvedValue({
      items: [{ ...summary, contactEmail: 'ops@example.com' }],
      page: 0, size: 25, totalElements: 1, totalPages: 1,
    })
    await expect(logisticsAddressApi.list({ page: 0, size: 25 }))
      .rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('uses explicit detail and write endpoints', async () => {
    request.mockResolvedValue(detail)
    await logisticsAddressApi.detail(summary.id)
    expect(request).toHaveBeenLastCalledWith(`/api/v1/logistics/addresses/${summary.id}`)
    const input = {
      addressType: 'SHIPPING' as const, name: '上海发货仓',
      contactName: '运营联系人', contactEmail: 'ops@example.com',
      countryCode: 'CN', addressLine1: '世纪大道 1 号',
    }
    await logisticsAddressApi.create(input)
    expect(request).toHaveBeenLastCalledWith('/api/v1/logistics/addresses', {
      method: 'POST', body: input,
    })
    await logisticsAddressApi.update(summary.id, 0, input)
    expect(request).toHaveBeenLastCalledWith(`/api/v1/logistics/addresses/${summary.id}`, {
      method: 'PUT', body: { version: 0, address: input },
    })
    await logisticsAddressApi.archive(summary.id, 0)
    expect(request).toHaveBeenLastCalledWith(`/api/v1/logistics/addresses/${summary.id}/archive`, {
      method: 'POST', body: { version: 0 },
    })
  })
})
