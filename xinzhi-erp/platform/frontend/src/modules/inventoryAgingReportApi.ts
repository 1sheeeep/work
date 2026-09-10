import { ApiError, apiClient } from '../api/client'

const API_BASE = '/api/v1/analytics/inventory-aging'
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export type InventoryAgingReportItem = {
  skuId: string
  skuBusinessCode: string
  skuName: string
  warehouseId: string
  warehouseBusinessCode: string
  warehouseName: string
  oldestInventoryDate: string
  maximumAgeDays: number
  totalQuantity: number
  age0To30Quantity: number
  age31To60Quantity: number
  age61To90Quantity: number
  age91To365Quantity: number
  ageOver365Quantity: number
}

export type InventoryAgingReportPage = {
  items: InventoryAgingReportItem[]
  totalQuantity: number
  age0To30Quantity: number
  age31To60Quantity: number
  age61To90Quantity: number
  age91To365Quantity: number
  ageOver365Quantity: number
  page: number
  size: number
  totalElements: number
  totalPages: number
}

export type InventoryAgingReportRequest = {
  cutoffDate: string
  warehouseId?: string
  keyword?: string
  page: number
  size: number
  signal?: AbortSignal
}

export type InventoryAgingReportExport = {
  filename: 'inventory-aging-report.csv'
  mediaType: 'text/csv;charset=utf-8'
  rowCount: number
  content: string
}

type Wire = Record<string, unknown>

function invalid(field: string): never {
  throw new ApiError('Invalid inventory aging report response', {
    status: 502,
    code: 'invalid_response',
    details: { field },
  })
}

function invalidRequest(field: string): never {
  throw new ApiError('Invalid inventory aging report request', {
    status: 400,
    code: 'invalid_request',
    details: { field },
  })
}

function record(value: unknown, field: string): Wire {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid(field)
  }
  return value as Wire
}

function exact(value: Wire, fields: readonly string[], field: string) {
  if (Object.keys(value).some((key) => !fields.includes(key))
    || fields.some((key) => !(key in value))) invalid(`${field}.shape`)
}

function text(value: unknown, field: string) {
  if (typeof value !== 'string' || value.length === 0) invalid(field)
  return value
}

function uuid(value: unknown, field: string) {
  const parsed = text(value, field)
  return UUID_PATTERN.test(parsed) ? parsed : invalid(field)
}

function integer(value: unknown, field: string) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    invalid(field)
  }
  return value
}

function validDate(value: string) {
  if (!DATE_PATTERN.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day
}

function mapItem(value: unknown): InventoryAgingReportItem {
  const wire = record(value, 'item')
  exact(wire, [
    'skuId', 'skuBusinessCode', 'skuName',
    'warehouseId', 'warehouseBusinessCode', 'warehouseName',
    'oldestInventoryDate', 'maximumAgeDays', 'totalQuantity',
    'age0To30Quantity', 'age31To60Quantity', 'age61To90Quantity',
    'age91To365Quantity', 'ageOver365Quantity',
  ], 'item')
  const oldestInventoryDate = text(
    wire.oldestInventoryDate,
    'item.oldestInventoryDate',
  )
  if (!validDate(oldestInventoryDate)) invalid('item.oldestInventoryDate')
  const item = {
    skuId: uuid(wire.skuId, 'item.skuId'),
    skuBusinessCode: text(
      wire.skuBusinessCode,
      'item.skuBusinessCode',
    ),
    skuName: text(wire.skuName, 'item.skuName'),
    warehouseId: uuid(wire.warehouseId, 'item.warehouseId'),
    warehouseBusinessCode: text(
      wire.warehouseBusinessCode,
      'item.warehouseBusinessCode',
    ),
    warehouseName: text(wire.warehouseName, 'item.warehouseName'),
    oldestInventoryDate,
    maximumAgeDays: integer(wire.maximumAgeDays, 'item.maximumAgeDays'),
    totalQuantity: integer(wire.totalQuantity, 'item.totalQuantity'),
    age0To30Quantity: integer(
      wire.age0To30Quantity,
      'item.age0To30Quantity',
    ),
    age31To60Quantity: integer(
      wire.age31To60Quantity,
      'item.age31To60Quantity',
    ),
    age61To90Quantity: integer(
      wire.age61To90Quantity,
      'item.age61To90Quantity',
    ),
    age91To365Quantity: integer(
      wire.age91To365Quantity,
      'item.age91To365Quantity',
    ),
    ageOver365Quantity: integer(
      wire.ageOver365Quantity,
      'item.ageOver365Quantity',
    ),
  }
  if (item.age0To30Quantity + item.age31To60Quantity
      + item.age61To90Quantity + item.age91To365Quantity
      + item.ageOver365Quantity !== item.totalQuantity) {
    invalid('item.quantityIdentity')
  }
  return item
}

function mapPage(value: unknown, request: InventoryAgingReportRequest) {
  const wire = record(value, 'page')
  exact(wire, [
    'items', 'totalQuantity', 'age0To30Quantity', 'age31To60Quantity',
    'age61To90Quantity', 'age91To365Quantity', 'ageOver365Quantity',
    'page', 'size', 'totalElements', 'totalPages',
  ], 'page')
  if (!Array.isArray(wire.items)) invalid('page.items')
  const result: InventoryAgingReportPage = {
    items: wire.items.map(mapItem),
    totalQuantity: integer(wire.totalQuantity, 'page.totalQuantity'),
    age0To30Quantity: integer(
      wire.age0To30Quantity,
      'page.age0To30Quantity',
    ),
    age31To60Quantity: integer(
      wire.age31To60Quantity,
      'page.age31To60Quantity',
    ),
    age61To90Quantity: integer(
      wire.age61To90Quantity,
      'page.age61To90Quantity',
    ),
    age91To365Quantity: integer(
      wire.age91To365Quantity,
      'page.age91To365Quantity',
    ),
    ageOver365Quantity: integer(
      wire.ageOver365Quantity,
      'page.ageOver365Quantity',
    ),
    page: integer(wire.page, 'page.page'),
    size: integer(wire.size, 'page.size'),
    totalElements: integer(wire.totalElements, 'page.totalElements'),
    totalPages: integer(wire.totalPages, 'page.totalPages'),
  }
  const expectedPages = result.totalElements === 0
    ? 0
    : Math.ceil(result.totalElements / result.size)
  if (result.page !== request.page || result.size !== request.size
    || result.totalPages !== expectedPages
    || result.items.length > result.size
    || result.items.length > result.totalElements
    || result.age0To30Quantity + result.age31To60Quantity
      + result.age61To90Quantity + result.age91To365Quantity
      + result.ageOver365Quantity !== result.totalQuantity
    || new Set(result.items.map(
      (item) => `${item.skuId}:${item.warehouseId}`,
    )).size !== result.items.length) {
    invalid('page.identity')
  }
  return result
}

function mapExport(value: unknown): InventoryAgingReportExport {
  const wire = record(value, 'export')
  exact(wire, ['filename', 'mediaType', 'rowCount', 'content'], 'export')
  const rowCount = integer(wire.rowCount, 'export.rowCount')
  const content = typeof wire.content === 'string'
    ? wire.content
    : invalid('export.content')
  if (wire.filename !== 'inventory-aging-report.csv'
    || wire.mediaType !== 'text/csv;charset=utf-8'
    || rowCount > 10_000 || content.length > 30_000_000
    || !content.startsWith(
      '\uFEFF库存SKU,商品名称,仓库编码,仓库名称,最早在库日期,最长库龄(天),库存总数,0-30天,31-60天,61-90天,91-365天,365天以上\r\n',
    )) {
    invalid('export.contract')
  }
  return {
    filename: 'inventory-aging-report.csv',
    mediaType: 'text/csv;charset=utf-8',
    rowCount,
    content,
  }
}

function validateRequest(request: InventoryAgingReportRequest) {
  if (!validDate(request.cutoffDate)) invalidRequest('cutoffDate')
  if (request.warehouseId && !UUID_PATTERN.test(request.warehouseId)) {
    invalidRequest('warehouseId')
  }
  if (!Number.isSafeInteger(request.page) || request.page < 0
    || !Number.isSafeInteger(request.size) || request.size < 1
    || request.size > 100) invalidRequest('page')
}

export const inventoryAgingReportApi = {
  async summarize(
    request: InventoryAgingReportRequest,
  ): Promise<InventoryAgingReportPage> {
    validateRequest(request)
    const query = new URLSearchParams({
      cutoffDate: request.cutoffDate,
      page: String(request.page),
      size: String(request.size),
    })
    if (request.warehouseId) query.set('warehouseId', request.warehouseId)
    if (request.keyword?.trim()) {
      query.set('keyword', request.keyword.trim().slice(0, 100))
    }
    return mapPage(await apiClient.request<unknown>(
      `${API_BASE}?${query}`,
      { signal: request.signal },
    ), request)
  },
  async exportCsv(
    request: Omit<InventoryAgingReportRequest, 'page' | 'size' | 'signal'>,
  ): Promise<InventoryAgingReportExport> {
    validateRequest({ ...request, page: 0, size: 1 })
    return mapExport(await apiClient.request<unknown>(`${API_BASE}/exports`, {
      method: 'POST',
      body: {
        cutoffDate: request.cutoffDate,
        warehouseId: request.warehouseId,
        keyword: request.keyword?.trim().slice(0, 100) || undefined,
      },
    }))
  },
}
