import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '../api/client'
import { warehouseCenterApi } from './warehouseCenterApi'

const warehouseId = '96000000-0000-4000-8000-000000000010'
const locationId = '96000000-0000-4000-8000-000000000020'
const warehouseWire = {
  id: warehouseId,
  businessCode: 'WH_NORTH',
  name: '北区仓',
  status: 'ACTIVE',
  version: 2,
  createdAt: '2026-07-29T00:00:00Z',
  updatedAt: '2026-07-29T01:00:00Z',
}
const locationWire = {
  id: locationId,
  warehouseId,
  businessCode: 'A_01',
  name: '拣货 A-01',
  status: 'ACTIVE',
  version: 1,
  createdAt: '2026-07-29T00:00:00Z',
  updatedAt: '2026-07-29T01:00:00Z',
}

afterEach(() => vi.restoreAllMocks())

describe('warehouseCenterApi', () => {
  it('projects an allowlisted warehouse page without tenant fields', async () => {
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({
      items: [
        {
          ...warehouseWire,
          tenantId: 'hidden-tenant',
          internalNote: 'hidden',
        },
      ],
      page: 1,
      size: 25,
      totalElements: 26,
      totalPages: 2,
      rawPayload: { hidden: true },
    })

    await expect(
      warehouseCenterApi.listWarehouses({
        status: 'ACTIVE',
        keyword: 'north',
        page: 1,
        size: 25,
      }),
    ).resolves.toEqual({
      items: [warehouseWire],
      page: 1,
      size: 25,
      totalElements: 26,
      totalPages: 2,
    })
    expect(request).toHaveBeenCalledWith(
      '/api/v1/warehouse-center/warehouses?status=ACTIVE&keyword=north&page=1&size=25',
    )
    expect(JSON.stringify(request.mock.calls[0])).not.toContain('tenantId')
    expect(JSON.stringify(request.mock.calls[0])).not.toContain('X-Tenant-Id')
  })

  it('maps every warehouse in a multi-row page without treating its index as an id', async () => {
    const secondWarehouse = {
      ...warehouseWire,
      id: '96000000-0000-4000-8000-000000000011',
      businessCode: 'WH_SOUTH',
      name: '南区仓',
    }
    vi.spyOn(apiClient, 'request').mockResolvedValue({
      items: [warehouseWire, secondWarehouse],
      page: 0,
      size: 25,
      totalElements: 2,
      totalPages: 1,
    })

    await expect(
      warehouseCenterApi.listWarehouses({ page: 0, size: 25 }),
    ).resolves.toEqual({
      items: [warehouseWire, secondWarehouse],
      page: 0,
      size: 25,
      totalElements: 2,
      totalPages: 1,
    })
  })

  it('loads a warehouse detail and rejects a mismatched response id', async () => {
    const request = vi
      .spyOn(apiClient, 'request')
      .mockResolvedValueOnce({ ...warehouseWire, secret: 'discarded' })
      .mockResolvedValueOnce({
        ...warehouseWire,
        id: '96000000-0000-4000-8000-000000000011',
      })

    await expect(warehouseCenterApi.getWarehouse(warehouseId)).resolves.toEqual(
      warehouseWire,
    )
    expect(request).toHaveBeenCalledWith(
      `/api/v1/warehouse-center/warehouses/${warehouseId}`,
    )
    await expect(warehouseCenterApi.getWarehouse(warehouseId)).rejects.toThrow(
      'Invalid warehouse response',
    )
  })

  it('exports normalized warehouse filters through a bounded CSV contract', async () => {
    const exportWire = {
      filename: 'warehouses.csv',
      mediaType: 'text/csv;charset=utf-8',
      rowCount: 1,
      content:
        '\uFEFF仓库名称,业务编码,状态,创建时间,更新时间\r\n北区仓,WH_NORTH,启用,2026-07-29T00:00:00Z,2026-07-29T01:00:00Z\r\n',
    }
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue(exportWire)

    await expect(
      warehouseCenterApi.exportWarehouses({
        status: 'ACTIVE',
        keyword: ' north ',
      }),
    ).resolves.toEqual(exportWire)
    expect(request).toHaveBeenCalledWith(
      '/api/v1/warehouse-center/warehouses/exports',
      {
        method: 'POST',
        body: { status: 'ACTIVE', keyword: 'north' },
      },
    )
  })

  it.each([
    ['filename', { filename: '../warehouses.csv' }],
    ['media type', { mediaType: 'text/html' }],
    ['row limit', { rowCount: 10_001 }],
    ['header', { content: '\uFEFFunexpected' }],
  ])('rejects an invalid warehouse export %s', async (_label, patch) => {
    vi.spyOn(apiClient, 'request').mockResolvedValue({
      filename: 'warehouses.csv',
      mediaType: 'text/csv;charset=utf-8',
      rowCount: 0,
      content: '\uFEFF仓库名称,业务编码,状态,创建时间,更新时间\r\n',
      ...patch,
    })

    await expect(
      warehouseCenterApi.exportWarehouses({}),
    ).rejects.toThrow('Invalid warehouse response')
  })

  it('projects locations and enforces their warehouse parent', async () => {
    vi.spyOn(apiClient, 'request')
      .mockResolvedValueOnce({
        items: [{ ...locationWire, tenantId: 'hidden' }],
        page: 0,
        size: 50,
        totalElements: 1,
        totalPages: 1,
      })
      .mockResolvedValueOnce({
        items: [
          {
            ...locationWire,
            warehouseId: '96000000-0000-4000-8000-000000000011',
          },
        ],
        page: 0,
        size: 50,
        totalElements: 1,
        totalPages: 1,
      })

    await expect(
      warehouseCenterApi.listLocations(warehouseId, {
        page: 0,
        size: 50,
      }),
    ).resolves.toEqual({
      items: [locationWire],
      page: 0,
      size: 50,
      totalElements: 1,
      totalPages: 1,
    })
    await expect(
      warehouseCenterApi.listLocations(warehouseId, {
        page: 0,
        size: 50,
      }),
    ).rejects.toThrow('Invalid warehouse response')
  })

  it('exports normalized location filters through a bounded CSV contract', async () => {
    const exportWire = {
      filename: 'warehouse-locations.csv' as const,
      mediaType: 'text/csv;charset=utf-8' as const,
      rowCount: 1,
      content:
        '\uFEFF仓库名称,仓库编码,库位名称,库位编码,状态,创建时间,更新时间\r\n北区仓,WH_NORTH,拣货 A-01,A_01,启用,2026-07-29T00:00:00Z,2026-07-29T01:00:00Z\r\n',
    }
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue(exportWire)

    await expect(
      warehouseCenterApi.exportLocations(warehouseId, {
        status: 'INACTIVE',
        keyword: ' pick ',
      }),
    ).resolves.toEqual(exportWire)
    expect(request).toHaveBeenCalledWith(
      `/api/v1/warehouse-center/warehouses/${warehouseId}/locations/exports`,
      {
        method: 'POST',
        body: { status: 'INACTIVE', keyword: 'pick' },
      },
    )
  })

  it.each([
    ['filename', { filename: '../warehouse-locations.csv' }],
    ['media type', { mediaType: 'text/html' }],
    ['row limit', { rowCount: 10_001 }],
    ['header', { content: '\uFEFFunexpected' }],
  ])('rejects an invalid location export %s', async (_label, patch) => {
    vi.spyOn(apiClient, 'request').mockResolvedValue({
      filename: 'warehouse-locations.csv',
      mediaType: 'text/csv;charset=utf-8',
      rowCount: 0,
      content:
        '\uFEFF仓库名称,仓库编码,库位名称,库位编码,状态,创建时间,更新时间\r\n',
      ...patch,
    })

    await expect(
      warehouseCenterApi.exportLocations(warehouseId, {}),
    ).rejects.toThrow('Invalid warehouse response')
  })

  it('loads an allowlisted location detail and enforces both path ids', async () => {
    const otherWarehouseId = '96000000-0000-4000-8000-000000000011'
    const otherLocationId = '96000000-0000-4000-8000-000000000021'
    const request = vi
      .spyOn(apiClient, 'request')
      .mockResolvedValueOnce({
        ...locationWire,
        tenantId: 'hidden-tenant',
        rawPayload: { hidden: true },
      })
      .mockResolvedValueOnce({
        ...locationWire,
        warehouseId: otherWarehouseId,
      })
      .mockResolvedValueOnce({
        ...locationWire,
        id: otherLocationId,
      })

    await expect(
      warehouseCenterApi.getLocation(warehouseId, locationId),
    ).resolves.toEqual(locationWire)
    expect(request).toHaveBeenCalledWith(
      `/api/v1/warehouse-center/warehouses/${warehouseId}/locations/${locationId}`,
    )
    await expect(
      warehouseCenterApi.getLocation(warehouseId, locationId),
    ).rejects.toThrow('Invalid warehouse response')
    await expect(
      warehouseCenterApi.getLocation(warehouseId, locationId),
    ).rejects.toThrow('Invalid warehouse response')
  })

  it.each([
    ['warehouse id', { ...warehouseWire, id: 'not-a-uuid' }],
    ['warehouse status', { ...warehouseWire, status: 'DELETED' }],
    ['warehouse version', { ...warehouseWire, version: -1 }],
    ['warehouse timestamp', { ...warehouseWire, updatedAt: 'invalid' }],
  ])('rejects an invalid %s', async (_label, item) => {
    vi.spyOn(apiClient, 'request').mockResolvedValue({
      items: [item],
      page: 0,
      size: 25,
      totalElements: 1,
      totalPages: 1,
    })

    await expect(
      warehouseCenterApi.listWarehouses({ page: 0, size: 25 }),
    ).rejects.toThrow('Invalid warehouse response')
  })

  it.each([
    ['items', { items: {}, page: 0, size: 25, totalElements: 0, totalPages: 0 }],
    ['page', { items: [], page: -1, size: 25, totalElements: 0, totalPages: 0 }],
    ['size', { items: [], page: 0, size: 0, totalElements: 0, totalPages: 0 }],
    [
      'totalElements',
      { items: [], page: 0, size: 25, totalElements: -1, totalPages: 0 },
    ],
  ])('rejects an invalid page %s', async (_label, response) => {
    vi.spyOn(apiClient, 'request').mockResolvedValue(response)
    await expect(
      warehouseCenterApi.listWarehouses({ page: 0, size: 25 }),
    ).rejects.toThrow('Invalid warehouse response')
  })

  it('rejects invalid path ids before sending a request', async () => {
    const request = vi.spyOn(apiClient, 'request')
    await expect(
      warehouseCenterApi.getWarehouse('../other-tenant'),
    ).rejects.toThrow('Invalid warehouse request')
    await expect(
      warehouseCenterApi.archiveLocation(warehouseId, '../location', 1),
    ).rejects.toThrow('Invalid warehouse request')
    await expect(
      warehouseCenterApi.getLocation('../warehouse', locationId),
    ).rejects.toThrow('Invalid warehouse request')
    await expect(
      warehouseCenterApi.getLocation(warehouseId, '../location'),
    ).rejects.toThrow('Invalid warehouse request')
    expect(request).not.toHaveBeenCalled()
  })

  it('serializes optimistic versions on nested updates and archive actions', async () => {
    const request = vi
      .spyOn(apiClient, 'request')
      .mockResolvedValueOnce({ ...locationWire, status: 'INACTIVE', version: 4 })
      .mockResolvedValueOnce({ ...warehouseWire, status: 'ARCHIVED', version: 5 })

    await warehouseCenterApi.updateLocation(warehouseId, locationId, {
      name: 'A-01',
      status: 'INACTIVE',
      version: 4,
    })
    expect(request).toHaveBeenCalledWith(
      `/api/v1/warehouse-center/warehouses/${warehouseId}/locations/${locationId}`,
      {
        method: 'PUT',
        body: { name: 'A-01', status: 'INACTIVE', version: 4 },
      },
    )

    await warehouseCenterApi.archiveWarehouse(warehouseId, 5)
    expect(request).toHaveBeenLastCalledWith(
      `/api/v1/warehouse-center/warehouses/${warehouseId}/archive`,
      { method: 'POST', body: { version: 5 } },
    )
  })
})
