import { ApiError, apiClient } from '../api/client'

const API_BASE = '/api/v1/analytics/inventory-period'
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export type InventoryPeriodReportItem = {
  skuId: string
  skuBusinessCode: string
  skuName: string
  warehouseId: string
  warehouseBusinessCode: string
  warehouseName: string
  openingQuantity: number
  increasedQuantity: number
  decreasedQuantity: number
  closingQuantity: number
}

export type InventoryPeriodReportPage = {
  items: InventoryPeriodReportItem[]
  totalOpeningQuantity: number
  totalIncreasedQuantity: number
  totalDecreasedQuantity: number
  totalClosingQuantity: number
  page: number
  size: number
  totalElements: number
  totalPages: number
}

export type InventoryPeriodReportExport = {
  filename: 'inventory-period-report.csv'
  mediaType: 'text/csv;charset=utf-8'
  rowCount: number
  content: string
}

export type InventoryPeriodReportRequest = {
  periodFrom: string
  periodTo: string
  warehouseId?: string
  keyword?: string
  page: number
  size: number
  signal?: AbortSignal
}

type Wire = Record<string, unknown>

function invalid(field: string): never {
  throw new ApiError('Invalid inventory period report response', {
    status: 502,
    code: 'invalid_response',
    details: { field },
  })
}

function invalidRequest(field: string): never {
  throw new ApiError('Invalid inventory period report request', {
    status: 400,
    code: 'invalid_request',
    details: { field },
  })
}

function record(value: unknown, field: string): Wire {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field)
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

function integer(value: unknown, field: string, nonNegative = false) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)
    || (nonNegative && value < 0)) invalid(field)
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

function mapItem(value: unknown): InventoryPeriodReportItem {
  const wire = record(value, 'item')
  exact(wire, [
    'skuId', 'skuBusinessCode', 'skuName',
    'warehouseId', 'warehouseBusinessCode', 'warehouseName',
    'openingQuantity', 'increasedQuantity', 'decreasedQuantity',
    'closingQuantity',
  ], 'item')
  const item = {
    skuId: uuid(wire.skuId, 'item.skuId'),
    skuBusinessCode: text(wire.skuBusinessCode, 'item.skuBusinessCode'),
    skuName: text(wire.skuName, 'item.skuName'),
    warehouseId: uuid(wire.warehouseId, 'item.warehouseId'),
    warehouseBusinessCode: text(
      wire.warehouseBusinessCode,
      'item.warehouseBusinessCode',
    ),
    warehouseName: text(wire.warehouseName, 'item.warehouseName'),
    openingQuantity: integer(wire.openingQuantity, 'item.openingQuantity'),
    increasedQuantity: integer(
      wire.increasedQuantity,
      'item.increasedQuantity',
      true,
    ),
    decreasedQuantity: integer(
      wire.decreasedQuantity,
      'item.decreasedQuantity',
      true,
    ),
    closingQuantity: integer(wire.closingQuantity, 'item.closingQuantity'),
  }
  if (item.openingQuantity + item.increasedQuantity
      - item.decreasedQuantity !== item.closingQuantity) {
    invalid('item.quantityIdentity')
  }
  return item
}

function exportResult(value: unknown): InventoryPeriodReportExport {
  const wire = record(value, 'export')
  exact(wire, ['filename', 'mediaType', 'rowCount', 'content'], 'export')
  const rowCount = integer(wire.rowCount, 'export.rowCount', true)
  const content = typeof wire.content === 'string'
    ? wire.content
    : invalid('export.content')
  if (wire.filename !== 'inventory-period-report.csv'
    || wire.mediaType !== 'text/csv;charset=utf-8'
    || rowCount > 10_000
    || content.length > 30_000_000
    || !content.startsWith('\uFEFF库存SKU,商品名称,仓库编码,仓库名称,期初数量,期间增加,期间减少,期末数量\r\n')) {
    invalid('export.contract')
  }
  return {
    filename: 'inventory-period-report.csv',
    mediaType: 'text/csv;charset=utf-8',
    rowCount,
    content,
  }
}

export const inventoryPeriodReportApi = {
  async summarize(
    request: InventoryPeriodReportRequest,
  ): Promise<InventoryPeriodReportPage> {
    if (!validDate(request.periodFrom) || !validDate(request.periodTo)
      || request.periodFrom > request.periodTo) invalidRequest('period')
    if (!Number.isSafeInteger(request.page) || request.page < 0
      || !Number.isSafeInteger(request.size) || request.size < 1
      || request.size > 100) invalidRequest('page')
    if (request.warehouseId && !UUID_PATTERN.test(request.warehouseId)) {
      invalidRequest('warehouseId')
    }
    const query = new URLSearchParams({
      periodFrom: request.periodFrom,
      periodTo: request.periodTo,
      page: String(request.page),
      size: String(request.size),
    })
    if (request.warehouseId) query.set('warehouseId', request.warehouseId)
    if (request.keyword?.trim()) {
      query.set('keyword', request.keyword.trim().slice(0, 100))
    }
    const wire = record(await apiClient.request<unknown>(
      `${API_BASE}?${query}`,
      { signal: request.signal },
    ), 'page')
    exact(wire, [
      'items', 'totalOpeningQuantity', 'totalIncreasedQuantity',
      'totalDecreasedQuantity', 'totalClosingQuantity', 'page', 'size',
      'totalElements', 'totalPages',
    ], 'page')
    if (!Array.isArray(wire.items)) invalid('page.items')
    const result: InventoryPeriodReportPage = {
      items: wire.items.map((item) => mapItem(item)),
      totalOpeningQuantity: integer(
        wire.totalOpeningQuantity,
        'page.totalOpeningQuantity',
      ),
      totalIncreasedQuantity: integer(
        wire.totalIncreasedQuantity,
        'page.totalIncreasedQuantity',
        true,
      ),
      totalDecreasedQuantity: integer(
        wire.totalDecreasedQuantity,
        'page.totalDecreasedQuantity',
        true,
      ),
      totalClosingQuantity: integer(
        wire.totalClosingQuantity,
        'page.totalClosingQuantity',
      ),
      page: integer(wire.page, 'page.page', true),
      size: integer(wire.size, 'page.size', true),
      totalElements: integer(wire.totalElements, 'page.totalElements', true),
      totalPages: integer(wire.totalPages, 'page.totalPages', true),
    }
    const expectedPages = result.totalElements === 0
      ? 0
      : Math.ceil(result.totalElements / result.size)
    if (result.page !== request.page || result.size !== request.size
      || result.totalPages !== expectedPages
      || result.items.length > result.size
      || result.items.length > result.totalElements
      || new Set(result.items.map(
        (item) => `${item.skuId}:${item.warehouseId}`,
      )).size !== result.items.length
      || result.totalOpeningQuantity + result.totalIncreasedQuantity
        - result.totalDecreasedQuantity !== result.totalClosingQuantity) {
      invalid('page.identity')
    }
    return result
  },
  async exportCsv(
    request: Omit<InventoryPeriodReportRequest, 'page' | 'size' | 'signal'>,
  ): Promise<InventoryPeriodReportExport> {
    if (!validDate(request.periodFrom) || !validDate(request.periodTo)
      || request.periodFrom > request.periodTo) invalidRequest('period')
    if (request.warehouseId && !UUID_PATTERN.test(request.warehouseId)) {
      invalidRequest('warehouseId')
    }
    return exportResult(await apiClient.request<unknown>(`${API_BASE}/exports`, {
      method: 'POST',
      body: {
        periodFrom: request.periodFrom,
        periodTo: request.periodTo,
        warehouseId: request.warehouseId,
        keyword: request.keyword?.trim().slice(0, 100) || undefined,
      },
    }))
  },
}
