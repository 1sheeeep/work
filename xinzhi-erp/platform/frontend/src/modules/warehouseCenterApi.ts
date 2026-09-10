import { apiClient } from '../api/client'

const API_BASE = '/api/v1/warehouse-center/warehouses'
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type WarehouseStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED'

export type Page<T> = {
  items: T[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}

export type Warehouse = {
  id: string
  businessCode: string
  name: string
  status: WarehouseStatus
  version: number
  createdAt: string
  updatedAt: string
}

export type WarehouseLocation = {
  id: string
  warehouseId: string
  businessCode: string
  name: string
  status: WarehouseStatus
  version: number
  createdAt: string
  updatedAt: string
}

export type ListRequest = {
  status?: WarehouseStatus
  keyword?: string
  page: number
  size: number
}

export type WarehouseExportRequest = Pick<ListRequest, 'status' | 'keyword'>

export type WarehouseExport = {
  filename: 'warehouses.csv'
  mediaType: 'text/csv;charset=utf-8'
  rowCount: number
  content: string
}

export type WarehouseLocationExportRequest = Pick<
  ListRequest,
  'status' | 'keyword'
>

export type WarehouseLocationExport = {
  filename: 'warehouse-locations.csv'
  mediaType: 'text/csv;charset=utf-8'
  rowCount: number
  content: string
}

export type CreateMasterDataInput = {
  businessCode: string
  name: string
}

export type UpdateMasterDataInput = {
  name: string
  status: Exclude<WarehouseStatus, 'ARCHIVED'>
  version: number
}

type UnknownRecord = Record<string, unknown>

function invalid(field: string): never {
  throw new Error(`Invalid warehouse response: ${field}`)
}

function invalidRequest(field: string): never {
  throw new Error(`Invalid warehouse request: ${field}`)
}

function asRecord(value: unknown, field: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid(field)
  }
  return value as UnknownRecord
}

function requiredString(value: unknown, field: string) {
  if (typeof value !== 'string' || value.length === 0) return invalid(field)
  return value
}

function uuid(value: unknown, field: string) {
  const parsed = requiredString(value, field)
  return UUID_PATTERN.test(parsed) ? parsed : invalid(field)
}

function nonNegativeInteger(value: unknown, field: string) {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    return invalid(field)
  }
  return value
}

function positiveInteger(value: unknown, field: string) {
  const parsed = nonNegativeInteger(value, field)
  return parsed > 0 ? parsed : invalid(field)
}

function timestamp(value: unknown, field: string) {
  const parsed = requiredString(value, field)
  return Number.isNaN(Date.parse(parsed)) ? invalid(field) : parsed
}

function warehouseStatus(value: unknown, field: string): WarehouseStatus {
  if (value === 'ACTIVE' || value === 'INACTIVE' || value === 'ARCHIVED') {
    return value
  }
  return invalid(field)
}

function mapWarehouse(value: unknown, expectedId?: string): Warehouse {
  const wire = asRecord(value, 'warehouse')
  const id = uuid(wire.id, 'warehouse.id')
  if (expectedId && id.toLowerCase() !== expectedId.toLowerCase()) {
    return invalid('warehouse.id')
  }
  return {
    id,
    businessCode: requiredString(
      wire.businessCode,
      'warehouse.businessCode',
    ),
    name: requiredString(wire.name, 'warehouse.name'),
    status: warehouseStatus(wire.status, 'warehouse.status'),
    version: nonNegativeInteger(wire.version, 'warehouse.version'),
    createdAt: timestamp(wire.createdAt, 'warehouse.createdAt'),
    updatedAt: timestamp(wire.updatedAt, 'warehouse.updatedAt'),
  }
}

function mapLocation(
  value: unknown,
  expectedWarehouseId: string,
  expectedLocationId?: string,
): WarehouseLocation {
  const wire = asRecord(value, 'location')
  const warehouseId = uuid(wire.warehouseId, 'location.warehouseId')
  if (warehouseId.toLowerCase() !== expectedWarehouseId.toLowerCase()) {
    return invalid('location.warehouseId')
  }
  const id = uuid(wire.id, 'location.id')
  if (
    expectedLocationId &&
    id.toLowerCase() !== expectedLocationId.toLowerCase()
  ) {
    return invalid('location.id')
  }
  return {
    id,
    warehouseId,
    businessCode: requiredString(
      wire.businessCode,
      'location.businessCode',
    ),
    name: requiredString(wire.name, 'location.name'),
    status: warehouseStatus(wire.status, 'location.status'),
    version: nonNegativeInteger(wire.version, 'location.version'),
    createdAt: timestamp(wire.createdAt, 'location.createdAt'),
    updatedAt: timestamp(wire.updatedAt, 'location.updatedAt'),
  }
}

function mapPage<T>(value: unknown, mapItem: (item: unknown) => T): Page<T> {
  const wire = asRecord(value, 'page')
  if (!Array.isArray(wire.items)) return invalid('page.items')
  return {
    // Do not pass the mapper directly to Array.map: response mappers may have
    // an optional identity-check argument, while Array.map supplies the item
    // index as its second callback argument.
    items: wire.items.map((item) => mapItem(item)),
    page: nonNegativeInteger(wire.page, 'page.page'),
    size: positiveInteger(wire.size, 'page.size'),
    totalElements: nonNegativeInteger(
      wire.totalElements,
      'page.totalElements',
    ),
    totalPages: nonNegativeInteger(wire.totalPages, 'page.totalPages'),
  }
}

function mapWarehouseExport(value: unknown): WarehouseExport {
  const wire = asRecord(value, 'export')
  const filename = requiredString(wire.filename, 'export.filename')
  const mediaType = requiredString(wire.mediaType, 'export.mediaType')
  const rowCount = nonNegativeInteger(wire.rowCount, 'export.rowCount')
  const content = typeof wire.content === 'string'
    ? wire.content
    : invalid('export.content')
  if (
    filename !== 'warehouses.csv' ||
    mediaType !== 'text/csv;charset=utf-8' ||
    rowCount > 10_000 ||
    content.length > 20_000_000 ||
    !content.startsWith('\uFEFF仓库名称,业务编码,状态,创建时间,更新时间\r\n')
  ) {
    return invalid('export.contract')
  }
  return { filename, mediaType, rowCount, content }
}

function mapWarehouseLocationExport(
  value: unknown,
): WarehouseLocationExport {
  const wire = asRecord(value, 'locationExport')
  const filename = requiredString(
    wire.filename,
    'locationExport.filename',
  )
  const mediaType = requiredString(
    wire.mediaType,
    'locationExport.mediaType',
  )
  const rowCount = nonNegativeInteger(
    wire.rowCount,
    'locationExport.rowCount',
  )
  const content =
    typeof wire.content === 'string'
      ? wire.content
      : invalid('locationExport.content')
  if (
    filename !== 'warehouse-locations.csv' ||
    mediaType !== 'text/csv;charset=utf-8' ||
    rowCount > 10_000 ||
    content.length > 20_000_000 ||
    !content.startsWith(
      '\uFEFF仓库名称,仓库编码,库位名称,库位编码,状态,创建时间,更新时间\r\n',
    )
  ) {
    return invalid('locationExport.contract')
  }
  return { filename, mediaType, rowCount, content }
}

function listPath(path: string, request: ListRequest) {
  const query = new URLSearchParams()
  if (request.status) query.set('status', request.status)
  if (request.keyword) query.set('keyword', request.keyword)
  query.set('page', String(request.page))
  query.set('size', String(request.size))
  return `${path}?${query.toString()}`
}

function warehousePath(id: string) {
  if (!UUID_PATTERN.test(id)) return invalidRequest('warehouse.id')
  return `${API_BASE}/${encodeURIComponent(id)}`
}

function locationPath(warehouseId: string, locationId?: string) {
  const base = `${warehousePath(warehouseId)}/locations`
  if (locationId !== undefined && !UUID_PATTERN.test(locationId)) {
    return invalidRequest('location.id')
  }
  return locationId === undefined
    ? base
    : `${base}/${encodeURIComponent(locationId)}`
}

export const warehouseCenterApi = {
  async listWarehouses(request: ListRequest): Promise<Page<Warehouse>> {
    return mapPage(
      await apiClient.request<unknown>(listPath(API_BASE, request)),
      mapWarehouse,
    )
  },

  async exportWarehouses(
    request: WarehouseExportRequest,
  ): Promise<WarehouseExport> {
    return mapWarehouseExport(
      await apiClient.request<unknown>(`${API_BASE}/exports`, {
        method: 'POST',
        body: {
          status: request.status,
          keyword: request.keyword?.trim().slice(0, 100) || undefined,
        },
      }),
    )
  },

  async getWarehouse(id: string): Promise<Warehouse> {
    return mapWarehouse(
      await apiClient.request<unknown>(warehousePath(id)),
      id,
    )
  },

  async createWarehouse(input: CreateMasterDataInput): Promise<Warehouse> {
    return mapWarehouse(
      await apiClient.request<unknown>(API_BASE, {
        method: 'POST',
        body: input,
      }),
    )
  },

  async updateWarehouse(
    id: string,
    input: UpdateMasterDataInput,
  ): Promise<Warehouse> {
    return mapWarehouse(
      await apiClient.request<unknown>(warehousePath(id), {
        method: 'PUT',
        body: input,
      }),
      id,
    )
  },

  async archiveWarehouse(id: string, version: number): Promise<Warehouse> {
    return mapWarehouse(
      await apiClient.request<unknown>(`${warehousePath(id)}/archive`, {
        method: 'POST',
        body: { version },
      }),
      id,
    )
  },

  async listLocations(
    warehouseId: string,
    request: ListRequest,
  ): Promise<Page<WarehouseLocation>> {
    return mapPage(
      await apiClient.request<unknown>(
        listPath(locationPath(warehouseId), request),
      ),
      (value) => mapLocation(value, warehouseId),
    )
  },

  async exportLocations(
    warehouseId: string,
    request: WarehouseLocationExportRequest,
  ): Promise<WarehouseLocationExport> {
    return mapWarehouseLocationExport(
      await apiClient.request<unknown>(
        `${locationPath(warehouseId)}/exports`,
        {
          method: 'POST',
          body: {
            status: request.status,
            keyword: request.keyword?.trim().slice(0, 100) || undefined,
          },
        },
      ),
    )
  },

  async getLocation(
    warehouseId: string,
    locationId: string,
  ): Promise<WarehouseLocation> {
    return mapLocation(
      await apiClient.request<unknown>(
        locationPath(warehouseId, locationId),
      ),
      warehouseId,
      locationId,
    )
  },

  async createLocation(
    warehouseId: string,
    input: CreateMasterDataInput,
  ): Promise<WarehouseLocation> {
    return mapLocation(
      await apiClient.request<unknown>(locationPath(warehouseId), {
        method: 'POST',
        body: input,
      }),
      warehouseId,
    )
  },

  async updateLocation(
    warehouseId: string,
    locationId: string,
    input: UpdateMasterDataInput,
  ): Promise<WarehouseLocation> {
    return mapLocation(
      await apiClient.request<unknown>(
        locationPath(warehouseId, locationId),
        { method: 'PUT', body: input },
      ),
      warehouseId,
      locationId,
    )
  },

  async archiveLocation(
    warehouseId: string,
    locationId: string,
    version: number,
  ): Promise<WarehouseLocation> {
    return mapLocation(
      await apiClient.request<unknown>(
        `${locationPath(warehouseId, locationId)}/archive`,
        { method: 'POST', body: { version } },
      ),
      warehouseId,
      locationId,
    )
  },
}
