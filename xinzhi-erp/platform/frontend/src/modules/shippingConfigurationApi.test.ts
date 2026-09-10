import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '../api/client'
import { shippingConfigurationApi } from './shippingConfigurationApi'

const warehouseId = '11111111-1111-4111-8111-111111111111'
const templateId = '22222222-2222-4222-8222-222222222222'
const scaleId = '33333333-3333-4333-8333-333333333333'
const skuId = '44444444-4444-4444-8444-444444444444'
const ruleId = '55555555-5555-4555-8555-555555555555'

function template(overrides: Record<string, unknown> = {}) {
  return {
    id: templateId,
    businessCode: 'BOX_S',
    name: '小号纸箱',
    packagingType: 'BOX',
    standardWeightGrams: 50,
    lengthMm: 200,
    widthMm: 150,
    heightMm: 100,
    status: 'ACTIVE',
    version: 2,
    updatedAt: '2026-08-07T08:00:00Z',
    ...overrides,
  }
}

function scale(overrides: Record<string, unknown> = {}) {
  return {
    id: scaleId,
    warehouseId,
    deviceNumber: 'SCALE-01',
    displayName: '打包台 1 号秤',
    status: 'ACTIVE',
    version: 1,
    updatedAt: '2026-08-07T08:00:00Z',
    ...overrides,
  }
}

function rule(overrides: Record<string, unknown> = {}) {
  return {
    id: ruleId,
    skuId,
    minQuantity: 1,
    maxQuantity: 5,
    packagingTemplateId: templateId,
    packagingCode: 'BOX_S',
    packagingName: '小号纸箱',
    status: 'ACTIVE',
    version: 1,
    updatedAt: '2026-08-07T08:00:00Z',
    ...overrides,
  }
}

afterEach(() => vi.restoreAllMocks())

describe('shippingConfigurationApi', () => {
  it('maps warehouse packaging and keeps the warehouse-scoped path', async () => {
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({
      items: [{ template: template(), enabled: true }],
    })

    await expect(
      shippingConfigurationApi.listWarehousePackaging(warehouseId),
    ).resolves.toEqual([
      expect.objectContaining({
        enabled: true,
        template: expect.objectContaining({
          id: templateId,
          packagingType: 'BOX',
          standardWeightGrams: 50,
        }),
      }),
    ])
    expect(request).toHaveBeenCalledWith(
      `/api/v1/shipping-configuration/warehouses/${warehouseId}/packaging-templates`,
    )
  })

  it('fails closed on partial dimensions and cross-warehouse scale data', async () => {
    vi.spyOn(apiClient, 'request').mockResolvedValueOnce({
      items: [
        {
          template: template({ widthMm: null }),
          enabled: true,
        },
      ],
    })
    await expect(
      shippingConfigurationApi.listWarehousePackaging(warehouseId),
    ).rejects.toThrow('template.dimensions')

    vi.mocked(apiClient.request).mockResolvedValueOnce({
      items: [scale({ warehouseId: templateId })],
    })
    await expect(shippingConfigurationApi.listScales(warehouseId)).rejects.toThrow(
      'scale.warehouseId',
    )
  })

  it('sends versioned template and scale updates without internal fields', async () => {
    const request = vi.spyOn(apiClient, 'request')
    request.mockResolvedValueOnce(template({ version: 3 }))
    await shippingConfigurationApi.updateTemplate(templateId, {
      version: 2,
      name: '小号纸箱 2',
      packagingType: 'BOX',
      standardWeightGrams: 55,
      lengthMm: null,
      widthMm: null,
      heightMm: null,
      status: 'ACTIVE',
    })
    expect(request).toHaveBeenLastCalledWith(
      `/api/v1/shipping-configuration/packaging-templates/${templateId}`,
      expect.objectContaining({
        method: 'PUT',
        body: expect.objectContaining({ version: 2, standardWeightGrams: 55 }),
      }),
    )

    request.mockResolvedValueOnce(scale({ version: 2, status: 'INACTIVE' }))
    await shippingConfigurationApi.updateScale(scaleId, {
      version: 1,
      warehouseId,
      displayName: '打包台 1 号秤',
      status: 'INACTIVE',
    })
    expect(request).toHaveBeenLastCalledWith(
      `/api/v1/shipping-configuration/scales/${scaleId}`,
      expect.objectContaining({
        method: 'PUT',
        body: {
          version: 1,
          warehouseId,
          displayName: '打包台 1 号秤',
          status: 'INACTIVE',
        },
      }),
    )
  })

  it('maps and saves an exact integer tolerance contract', async () => {
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({
      toleranceGrams: 35,
      toleranceBasisPoints: 250,
      warehouseOverride: true,
    })
    await expect(
      shippingConfigurationApi.setTolerance(warehouseId, {
        toleranceGrams: 35,
        toleranceBasisPoints: 250,
      }),
    ).resolves.toEqual({
      toleranceGrams: 35,
      toleranceBasisPoints: 250,
      warehouseOverride: true,
    })
    expect(request).toHaveBeenCalledWith(
      `/api/v1/shipping-configuration/warehouses/${warehouseId}/weight-tolerance`,
      {
        method: 'PUT',
        body: { toleranceGrams: 35, toleranceBasisPoints: 250 },
      },
    )
  })

  it('lists templates and sends versioned SKU packaging rules', async () => {
    const request = vi.spyOn(apiClient, 'request')
    request.mockResolvedValueOnce({ items: [template()] })
    await expect(shippingConfigurationApi.listTemplates()).resolves.toEqual([
      expect.objectContaining({ id: templateId, businessCode: 'BOX_S' }),
    ])

    request.mockResolvedValueOnce({ items: [rule()] })
    await expect(shippingConfigurationApi.listRules(skuId)).resolves.toEqual([
      expect.objectContaining({ id: ruleId, minQuantity: 1, maxQuantity: 5 }),
    ])

    request.mockResolvedValueOnce(rule({ version: 2, status: 'INACTIVE' }))
    await shippingConfigurationApi.updateRule(skuId, ruleId, {
      version: 1,
      minQuantity: 1,
      maxQuantity: 5,
      packagingTemplateId: templateId,
      status: 'INACTIVE',
    })
    expect(request).toHaveBeenLastCalledWith(
      `/api/v1/shipping-configuration/skus/${skuId}/packaging-rules/${ruleId}`,
      {
        method: 'PUT',
        body: {
          version: 1,
          minQuantity: 1,
          maxQuantity: 5,
          packagingTemplateId: templateId,
          status: 'INACTIVE',
        },
      },
    )
  })

  it('rejects malformed and cross-SKU packaging rule responses', async () => {
    vi.spyOn(apiClient, 'request').mockResolvedValueOnce({
      items: [rule({ skuId: warehouseId })],
    })
    await expect(shippingConfigurationApi.listRules(skuId)).rejects.toThrow(
      'packagingRule.skuId',
    )

    vi.mocked(apiClient.request).mockResolvedValueOnce({
      items: [rule({ minQuantity: 8, maxQuantity: 2 })],
    })
    await expect(shippingConfigurationApi.listRules(skuId)).rejects.toThrow(
      'packagingRule.quantityRange',
    )
  })
})
