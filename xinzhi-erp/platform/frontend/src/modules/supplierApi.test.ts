import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiClient } from '../api/client'
import {
  parseSupplier,
  parseSupplierPage,
  supplierApi,
} from './supplierApi'

const supplier = {
  id: '97000000-0000-4000-8000-000000000031',
  businessCode: 'SUP_ONE',
  name: 'Supplier One',
  status: 'ACTIVE' as const,
  contactName: null,
  contactPhone: null,
  contactEmail: null,
  address: null,
  taxRegistrationNumber: null,
  settlementCurrency: 'CNY',
  paymentTermsDays: 30,
  notes: null,
  createdAt: '2026-07-29T00:00:00Z',
  updatedAt: '2026-07-29T00:00:00Z',
  version: 0,
}

afterEach(() => vi.restoreAllMocks())

describe('supplierApi', () => {
  it('uses the fixed query contract without tenant input', async () => {
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({
      items: [supplier],
      page: 1,
      size: 25,
      totalElements: 26,
      totalPages: 2,
    })
    const controller = new AbortController()
    await supplierApi.list({
      status: 'ACTIVE',
      query: 'north',
      page: 1,
      size: 25,
      signal: controller.signal,
    })
    expect(request).toHaveBeenCalledWith(
      '/api/v1/suppliers?status=ACTIVE&query=north&page=1&size=25',
      { signal: controller.signal },
    )
    expect(JSON.stringify(request.mock.calls[0])).not.toContain('tenantId')
    expect(JSON.stringify(request.mock.calls[0])).not.toContain('X-Tenant-Id')
  })

  it('exposes the supplier master data workflow', () => {
    expect(Object.keys(supplierApi).sort()).toEqual([
      'create', 'createWithMapping', 'get', 'importSuppliers', 'list', 'update',
    ])
  })

  it('loads detail through a validated path', async () => {
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue(supplier)
    const controller = new AbortController()

    const result = await supplierApi.get(supplier.id, controller.signal)

    expect(request).toHaveBeenCalledWith(
      `/api/v1/suppliers/${supplier.id}`,
      { signal: controller.signal },
    )
    expect(result).toEqual(supplier)
  })

  it('rejects invalid or mismatched detail ids before unsafe use', async () => {
    const request = vi.spyOn(apiClient, 'request')

    await expect(supplierApi.get('../tenant-secret')).rejects.toThrowError(
      ApiError,
    )
    expect(request).not.toHaveBeenCalled()

    request.mockResolvedValue({
      ...supplier,
      id: '97000000-0000-4000-8000-000000000032',
    })
    await expect(supplierApi.get(supplier.id)).rejects.toThrowError(ApiError)
  })

  it('rejects missing and malformed response fields', () => {
    for (const value of [
      { ...supplier, status: 'DELETED' },
      { ...supplier, version: -1 },
      { ...supplier, createdAt: 'yesterday' },
      { ...supplier, id: 'not-a-uuid' },
      { ...supplier, contactName: undefined },
      { ...supplier, contactName: 'x'.repeat(121) },
      { ...supplier, contactEmail: 'UPPER@example.com' },
      { ...supplier, settlementCurrency: 'cny' },
      { ...supplier, paymentTermsDays: 3651 },
      { ...supplier, tenantId: 'forbidden' },
      { ...supplier, updatedAt: '2026-07-28T23:59:59Z' },
      {
        id: supplier.id,
        businessCode: supplier.businessCode,
        name: supplier.name,
      },
    ]) {
      expect(() => parseSupplier(value)).toThrowError(ApiError)
    }
    expect(() =>
      parseSupplierPage({
        items: [supplier],
        page: 0,
        size: 0,
        totalElements: 1,
        totalPages: 1,
      }),
    ).toThrowError(ApiError)
  })
})
