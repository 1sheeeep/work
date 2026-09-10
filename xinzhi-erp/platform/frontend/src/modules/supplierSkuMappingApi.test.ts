import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiClient } from '../api/client'
import {
  parseSupplierSkuMapping,
  parseSupplierSkuMappingPage,
  supplierSkuMappingApi,
} from './supplierSkuMappingApi'

const supplierId = '97000000-0000-4000-8000-000000000031'
const mapping = {
  id: '97000000-0000-4000-8000-000000000041',
  supplierId,
  skuId: '97000000-0000-4000-8000-000000000051',
  supplierSkuCode: 'SUP-SKU-1',
  status: 'ACTIVE' as const,
  preferred: true,
  leadTimeDays: 7,
  unitPrice: 12.5,
  currencyCode: 'CNY',
  minimumOrderQuantity: 10,
  skuBusinessCode: 'SKU_ONE',
  skuName: 'SKU One',
  createdAt: '2026-07-29T00:00:00Z',
  updatedAt: '2026-07-29T00:00:00Z',
  version: 0,
}

afterEach(() => vi.restoreAllMocks())

describe('supplierSkuMappingApi', () => {
  it('loads bounded preferred supplier summaries without tenant selectors', async () => {
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({
      items: [{
        skuId: mapping.skuId,
        supplierSkuCode: 'FACTORY_BLUE_M',
        supplierId,
        supplierBusinessCode: 'SUP_ONE',
        supplierName: 'Supplier one',
      }],
    })
    const result = await supplierSkuMappingApi.listPreferredSummaries([
      mapping.skuId,
    ])
    expect(result[0]?.supplierName).toBe('Supplier one')
    expect(result[0]?.supplierSkuCode).toBe('FACTORY_BLUE_M')
    expect(request).toHaveBeenCalledWith(
      `/api/v1/suppliers/preferred-sku-summaries?skuId=${mapping.skuId}`,
    )
    expect(JSON.stringify(request.mock.calls[0])).not.toContain('tenantId')
  })

  it('uses the tenant-free nested list contract', async () => {
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({
      items: [mapping],
      page: 1,
      size: 25,
      totalElements: 26,
      totalPages: 2,
    })
    const controller = new AbortController()
    await supplierSkuMappingApi.list(supplierId, {
      status: 'ACTIVE',
      query: 'sku one',
      page: 1,
      size: 25,
      signal: controller.signal,
    })
    expect(request).toHaveBeenCalledWith(
      `/api/v1/suppliers/${supplierId}/sku-mappings?status=ACTIVE&query=sku+one&page=1&size=25`,
      { signal: controller.signal },
    )
    expect(JSON.stringify(request.mock.calls[0])).not.toContain(
      'tenantId',
    )
    expect(JSON.stringify(request.mock.calls[0])).not.toContain(
      'X-Tenant-Id',
    )
  })

  it('exposes supplier mapping reads and writes', () => {
    expect(Object.keys(supplierSkuMappingApi).sort()).toEqual([
      'create',
      'list',
      'listPreferredSummaries',
      'update',
    ])
  })

  it('rejects missing extra malformed and unsafe response fields', () => {
    for (const value of [
      { ...mapping, tenantId: 'forbidden' },
      { ...mapping, status: 'ARCHIVED' },
      { ...mapping, preferred: 'yes' },
      { ...mapping, leadTimeDays: 3651 },
      { ...mapping, unitPrice: null, currencyCode: 'CNY' },
      { ...mapping, minimumOrderQuantity: 0 },
      { ...mapping, supplierSkuCode: ' padded ' },
      { ...mapping, skuBusinessCode: 'bad code' },
      { ...mapping, skuName: '' },
      { ...mapping, id: 'not-a-uuid' },
      { ...mapping, createdAt: 'yesterday' },
      { ...mapping, updatedAt: '2026-07-28T23:59:59Z' },
      { ...mapping, version: -1 },
    ]) {
      expect(() => parseSupplierSkuMapping(value)).toThrowError(ApiError)
    }
    expect(() =>
      parseSupplierSkuMappingPage({
        items: [mapping],
        page: 0,
        size: 0,
        totalElements: 1,
        totalPages: 1,
      }),
    ).toThrowError(ApiError)
  })
})
