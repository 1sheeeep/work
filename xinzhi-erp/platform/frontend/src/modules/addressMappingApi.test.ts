import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '../api/client'
import { addressMappingApi } from './addressMappingApi'

const mapping = {
  id: 'a9600000-0000-4000-8000-000000000001',
  platform: 'SHOPIFY', countryCode: 'JP', addressType: 'PROVINCE',
  sourceValue: 'Tōkyō', mappedValue: '東京都', enabled: true, version: 0,
  updatedByDisplayName: 'UAT Operator',
  createdAt: '2026-08-10T06:00:00Z', updatedAt: '2026-08-10T06:00:00Z',
} as const

beforeEach(() => vi.restoreAllMocks())

describe('addressMappingApi', () => {
  it('loads strict settings and filtered mappings', async () => {
    const request = vi.spyOn(apiClient, 'request')
      .mockResolvedValueOnce({
        configured: false, enabled: false, version: 0,
        updatedByDisplayName: null, createdAt: null, updatedAt: null,
      })
      .mockResolvedValueOnce({
        items: [mapping], page: 0, size: 25, totalElements: 1, totalPages: 1,
      })

    await expect(addressMappingApi.getSetting()).resolves.toEqual({
      configured: false, enabled: false, version: 0,
    })
    await expect(addressMappingApi.list({
      platform: 'SHOPIFY', countryCode: 'jp', addressType: 'PROVINCE',
      keyword: ' Tōkyō ', page: 0, size: 25,
    })).resolves.toMatchObject({ items: [mapping], totalElements: 1 })
    expect(request).toHaveBeenLastCalledWith(
      '/api/v1/settings/address-mappings?platform=SHOPIFY&countryCode=JP&addressType=PROVINCE&keyword=T%C5%8Dky%C5%8D&page=0&size=25',
      { signal: undefined },
    )
  })

  it('normalizes writes and sends optimistic versions', async () => {
    const configured = {
      configured: true, enabled: true, version: 0,
      updatedByDisplayName: 'UAT Operator',
      createdAt: '2026-08-10T06:00:00Z', updatedAt: '2026-08-10T06:00:00Z',
    }
    const request = vi.spyOn(apiClient, 'request')
      .mockResolvedValueOnce(configured)
      .mockResolvedValueOnce(mapping)
      .mockResolvedValueOnce({ ...mapping, mappedValue: '東京都港区', version: 1 })
      .mockResolvedValueOnce(undefined)

    await addressMappingApi.saveSetting(0, true)
    await addressMappingApi.create({
      platform: 'SHOPIFY', countryCode: ' jp ', addressType: 'PROVINCE',
      sourceValue: ' Tōkyō ', mappedValue: ' 東京都 ', enabled: true,
    })
    await addressMappingApi.update(mapping.id, 0, {
      platform: 'SHOPIFY', countryCode: 'JP', addressType: 'PROVINCE',
      sourceValue: 'Tōkyō', mappedValue: '東京都港区', enabled: true,
    })
    await addressMappingApi.remove(mapping.id, 1)

    expect(request).toHaveBeenNthCalledWith(2, '/api/v1/settings/address-mappings',
      expect.objectContaining({ method: 'POST', body: expect.objectContaining({
        countryCode: 'JP', sourceValue: 'Tōkyō', mappedValue: '東京都',
      }) }))
    expect(request).toHaveBeenNthCalledWith(3,
      `/api/v1/settings/address-mappings/${mapping.id}`,
      expect.objectContaining({ method: 'PUT', body: expect.objectContaining({ expectedVersion: 0 }) }))
    expect(request).toHaveBeenNthCalledWith(4,
      `/api/v1/settings/address-mappings/${mapping.id}?expectedVersion=1`,
      expect.objectContaining({ method: 'DELETE' }))
  })

  it('rejects invalid requests and malformed responses', async () => {
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({
      items: [mapping], page: 0, size: 25, totalElements: 2, totalPages: 2,
    })
    await expect(addressMappingApi.create({
      platform: 'SHOPIFY', countryCode: 'JPN', addressType: 'CITY',
      sourceValue: 'Tokyo', mappedValue: '東京', enabled: true,
    })).rejects.toMatchObject({ status: 400 })
    await expect(addressMappingApi.saveSetting(-1, true))
      .rejects.toMatchObject({ status: 400 })
    await expect(addressMappingApi.list({ page: 0, size: 25 }))
      .rejects.toMatchObject({ status: 502 })
    expect(request).toHaveBeenCalledTimes(1)
  })
})
