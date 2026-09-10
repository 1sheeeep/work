import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { shopCenterApi, type ShopifyLocationMappingCatalog } from '../modules/shopCenterApi'
import { ShopifyLocationMappingPanel } from './ShopifyLocationMappingPanel'

const shopId = '10000000-0000-4000-8000-000000000001'
const warehouseId = '20000000-0000-4000-8000-000000000002'

const catalog: ShopifyLocationMappingCatalog = {
  locations: [{
    externalLocationRef: 'gid://shopify/Location/100',
    name: 'Toronto Warehouse',
    active: true,
    fulfillsOnlineOrders: true,
    hasActiveInventory: true,
    fulfillmentService: false,
    city: 'Toronto',
    countryCode: 'CA',
    providerPresent: true,
  }],
  warehouses: [{
    id: warehouseId,
    businessCode: 'CA-01',
    name: 'Canada Warehouse',
  }],
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ShopifyLocationMappingPanel', () => {
  it('does not request mappings without both read authorities', () => {
    const getMappings = vi.spyOn(
      shopCenterApi, 'getShopifyLocationMappings',
    )

    render(
      <ShopifyLocationMappingPanel
        shopId={shopId}
        canRead={false}
        canWrite={false}
        shopActive
      />,
    )

    expect(screen.getByText(/同时具备店铺读取和仓库读取权限/)).toBeTruthy()
    expect(getMappings).not.toHaveBeenCalled()
  })

  it('explains when Shopify location scope is missing', async () => {
    vi.spyOn(shopCenterApi, 'getShopifyLocationMappings').mockRejectedValue(
      new ApiError('Shopify authorization must include the required scope', {
        status: 409,
        code: 'shopify_authorization_conflict',
        details: { reason: 'shopify_scope_missing', scope: 'read_locations' },
      }),
    )

    render(
      <ShopifyLocationMappingPanel
        shopId={shopId}
        canRead
        canWrite
        shopActive
      />,
    )

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('Shopify 店铺授权未连接或地点读取权限不可用'),
    )
  })

  it('keeps both scope and state recovery paths for generic conflicts', async () => {
    vi.spyOn(shopCenterApi, 'getShopifyLocationMappings').mockRejectedValue(
      new ApiError('resource conflict', {
        status: 409,
        code: 'resource_conflict',
      }),
    )

    render(
      <ShopifyLocationMappingPanel
        shopId={shopId}
        canRead
        canWrite
        shopActive
      />,
    )

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('请刷新店铺授权状态'),
    )
    expect(screen.getByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('检查 Shopify 地点或 ERP 仓库是否可用'),
    )
  })

  it('saves only an explicit Shopify location and ERP warehouse selection', async () => {
    vi.spyOn(shopCenterApi, 'getShopifyLocationMappings')
      .mockResolvedValue(catalog)
    const upsert = vi.spyOn(
      shopCenterApi, 'upsertShopifyLocationMapping',
    ).mockResolvedValue({
      ...catalog.locations[0]!,
      mapping: {
        mappingId: '30000000-0000-4000-8000-000000000003',
        warehouseId,
        businessCode: 'CA-01',
        name: 'Canada Warehouse',
        status: 'ACTIVE',
        version: 0,
      },
    })

    render(
      <ShopifyLocationMappingPanel
        shopId={shopId}
        canRead
        canWrite
        shopActive
      />,
    )

    const select = await screen.findByLabelText(
      '为 Toronto Warehouse 选择 ERP 仓库',
    )
    fireEvent.change(select, { target: { value: warehouseId } })

    await waitFor(() => expect(upsert).toHaveBeenCalledWith(
      shopId,
      'gid://shopify/Location/100',
      warehouseId,
    ))
    expect(JSON.stringify(upsert.mock.calls)).not.toMatch(/tenantId|token|credential/i)
  })
})
