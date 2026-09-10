import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '../api/client'
import { systemGeneralSettingApi } from './systemGeneralSettingApi'

beforeEach(() => vi.restoreAllMocks())

describe('systemGeneralSettingApi', () => {
  it('loads defaults and saves a configured quiet period', async () => {
    const request = vi.spyOn(apiClient, 'request')
      .mockResolvedValueOnce({
        configured: false, defaultCurrency: 'USD',
        orderPullBlackoutStart: null, orderPullBlackoutEnd: null,
        version: 0, updatedByDisplayName: null, createdAt: null, updatedAt: null,
      })
      .mockResolvedValueOnce({
        configured: true, defaultCurrency: 'CNY',
        orderPullBlackoutStart: '23:00', orderPullBlackoutEnd: '06:00',
        version: 0, updatedByDisplayName: 'UAT ERP Tester',
        createdAt: '2026-08-10T05:00:00Z', updatedAt: '2026-08-10T05:00:00Z',
      })

    await expect(systemGeneralSettingApi.get()).resolves.toMatchObject({ defaultCurrency: 'USD' })
    await expect(systemGeneralSettingApi.save(0, {
      defaultCurrency: 'CNY', orderPullBlackoutStart: '23:00',
      orderPullBlackoutEnd: '06:00',
    })).resolves.toMatchObject({ defaultCurrency: 'CNY' })
    expect(request).toHaveBeenLastCalledWith('/api/v1/settings/system-general', {
      method: 'PUT', body: {
        expectedVersion: 0, defaultCurrency: 'CNY',
        orderPullBlackoutStart: '23:00', orderPullBlackoutEnd: '06:00',
      },
    })
  })

  it('rejects invalid or incomplete quiet periods', async () => {
    await expect(systemGeneralSettingApi.save(0, {
      defaultCurrency: 'usd',
    })).rejects.toThrow()
    await expect(systemGeneralSettingApi.save(0, {
      defaultCurrency: 'USD', orderPullBlackoutStart: '12:00',
    })).rejects.toThrow()
  })
})
