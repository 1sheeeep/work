import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '../api/client'
import { shippingDeadlineSettingApi } from './shippingDeadlineSettingApi'

beforeEach(() => vi.restoreAllMocks())

describe('shippingDeadlineSettingApi', () => {
  it('loads an unconfigured default and saves a configured value', async () => {
    const request = vi.spyOn(apiClient, 'request')
      .mockResolvedValueOnce({
        configured: false, deadlineDays: 3, version: 0,
        updatedByDisplayName: null, createdAt: null, updatedAt: null,
      })
      .mockResolvedValueOnce({
        configured: true, deadlineDays: 5, version: 0,
        updatedByDisplayName: 'UAT ERP Tester',
        createdAt: '2026-08-10T04:00:00Z', updatedAt: '2026-08-10T04:00:00Z',
      })

    await expect(shippingDeadlineSettingApi.get()).resolves.toMatchObject({ deadlineDays: 3 })
    await expect(shippingDeadlineSettingApi.save(0, 5)).resolves.toMatchObject({ deadlineDays: 5 })
    expect(request).toHaveBeenLastCalledWith(
      '/api/v1/settings/order-shipping-deadline',
      { method: 'PUT', body: { expectedVersion: 0, deadlineDays: 5 } },
    )
  })

  it('rejects invalid request and response values', async () => {
    await expect(shippingDeadlineSettingApi.save(0, 0)).rejects.toThrow()
    vi.spyOn(apiClient, 'request').mockResolvedValue({
      configured: false, deadlineDays: 999, version: 0,
      updatedByDisplayName: null, createdAt: null, updatedAt: null,
    })
    await expect(shippingDeadlineSettingApi.get()).rejects.toThrow()
  })
})
