import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiClient } from '../api/client'
import { enterpriseProfileApi } from './enterpriseProfileApi'

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client')
  return { ...actual, apiClient: { request: vi.fn() } }
})

const configured = {
  tenantCode: 'tenant-a', tenantName: 'Tenant A', configured: true,
  companyName: '新知科技', province: '上海', city: '上海', district: '浦东新区',
  detailedAddress: '世纪大道 1 号', contactName: '张三',
  contactEmail: 'ops@example.com', contactQq: '12345678',
  contactMobile: '+86 13800000000', contactTelephone: '021-12345678',
  version: 2, createdAt: '2026-08-07T00:00:00Z',
  updatedAt: '2026-08-07T01:00:00Z',
}

describe('enterpriseProfileApi', () => {
  beforeEach(() => vi.mocked(apiClient.request).mockReset())

  it('reads configured and unconfigured tenant profiles exactly', async () => {
    vi.mocked(apiClient.request).mockResolvedValueOnce(configured).mockResolvedValueOnce({
      tenantCode: 'tenant-b', tenantName: 'Tenant B', configured: false,
      companyName: null, province: null, city: null, district: null,
      detailedAddress: null, contactName: null, contactEmail: null, contactQq: null,
      contactMobile: null, contactTelephone: null, version: 0,
      createdAt: null, updatedAt: null,
    })
    await expect(enterpriseProfileApi.get()).resolves.toEqual(configured)
    await expect(enterpriseProfileApi.get()).resolves.toEqual({
      tenantCode: 'tenant-b', tenantName: 'Tenant B', configured: false, version: 0,
    })
  })

  it('normalizes and saves the expected version', async () => {
    vi.mocked(apiClient.request).mockResolvedValue(configured)
    await enterpriseProfileApi.save(2, {
      companyName: ' 新知科技 ', province: ' ', contactName: ' 张三 ',
      contactEmail: ' OPS@EXAMPLE.COM ', contactMobile: ' +86 13800000000 ',
    })
    expect(apiClient.request).toHaveBeenCalledWith(
      '/api/v1/settings/enterprise-profile', {
        method: 'PUT', body: { expectedVersion: 2, profile: {
          companyName: '新知科技', province: undefined, city: undefined,
          district: undefined, detailedAddress: undefined, contactName: '张三',
          contactEmail: 'ops@example.com', contactQq: undefined,
          contactMobile: '+86 13800000000', contactTelephone: undefined,
        } },
      },
    )
  })

  it('rejects future fields and inconsistent unconfigured responses', async () => {
    vi.mocked(apiClient.request).mockResolvedValueOnce({ ...configured, secret: 'no' })
      .mockResolvedValueOnce({ ...configured, configured: false })
    await expect(enterpriseProfileApi.get()).rejects.toBeInstanceOf(ApiError)
    await expect(enterpriseProfileApi.get()).rejects.toBeInstanceOf(ApiError)
  })

  it('rejects invalid contact requests before transport', async () => {
    await expect(enterpriseProfileApi.save(0, {
      companyName: '公司', contactName: '张三', contactEmail: 'bad',
      contactMobile: 'mobile',
    })).rejects.toBeInstanceOf(ApiError)
    expect(apiClient.request).not.toHaveBeenCalled()
  })
})
