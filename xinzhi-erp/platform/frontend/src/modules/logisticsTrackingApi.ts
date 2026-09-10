import { ApiError, apiClient } from '../api/client'

const API_BASE = '/api/v1/logistics/tracking'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type LogisticsTrackingSearchField = 'ORDER_NO' | 'TRACKING_NO'
export type LogisticsPackageStatus =
  | 'PENDING'
  | 'NOT_FOUND'
  | 'IN_TRANSIT'
  | 'AVAILABLE_FOR_PICKUP'
  | 'DELIVERY_FAILED'
  | 'EXCEPTION'
  | 'DELIVERED'
  | 'TIMED_OUT'
  | 'RETURNED'
  | 'OUT_FOR_DELIVERY'

export type LogisticsTrackingItem = {
  orderId: string
  platformCode: string
  platformName: string
  shopName: string
  orderNo: string
  countryCode?: string
  warehouseSummary?: string
  logisticsChannel?: string
  trackingReference?: string
  secondaryTrackingReference?: string
  trackingStatus?: string
  fixedCategory?: string
  customCategory?: string
  shippedAt?: string
  updatedAt: string
}

export type LogisticsTrackingPage = {
  items: LogisticsTrackingItem[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}

export type LogisticsTrackingListRequest = {
  shop?: string
  carrier?: string
  country?: string
  warehouse?: string
  category?: string
  searchField: LogisticsTrackingSearchField
  keyword?: string
  status?: LogisticsPackageStatus
  shippedFrom?: string
  shippedTo?: string
  page: number
  size: number
  signal?: AbortSignal
}
export type LogisticsTrackingExport = {
  filename: 'logistics-tracking.csv'
  mediaType: 'text/csv;charset=utf-8'
  rowCount: number
  content: string
}
export type LogisticsTrackingExportRequest = Omit<LogisticsTrackingListRequest, 'page' | 'size' | 'signal'>

type Wire = Record<string, unknown>

function invalid(field: string): never {
  throw new ApiError('Invalid logistics tracking response', {
    status: 502,
    code: 'invalid_response',
    details: { field },
  })
}
function invalidRequest(field: string): never {
  throw new ApiError('Invalid logistics tracking request', {
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
  if (typeof value !== 'string' || !value.trim()) invalid(field)
  return value
}
function optionalText(value: unknown, field: string) {
  return value == null ? undefined : text(value, field)
}
function uuid(value: unknown, field: string) {
  const result = text(value, field)
  if (!UUID_PATTERN.test(result)) invalid(field)
  return result
}
function integer(value: unknown, field: string, positive = false) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)
    || value < (positive ? 1 : 0)) invalid(field)
  return value
}
function timestamp(value: unknown, field: string) {
  const result = text(value, field)
  if (Number.isNaN(Date.parse(result))) invalid(field)
  return result
}
function optionalTimestamp(value: unknown, field: string) {
  return value == null ? undefined : timestamp(value, field)
}

function parseExport(value: unknown): LogisticsTrackingExport {
  const wire = record(value, 'export')
  exact(wire, ['filename', 'mediaType', 'rowCount', 'content'], 'export')
  const filename = text(wire.filename, 'export.filename')
  const mediaType = text(wire.mediaType, 'export.mediaType')
  const rowCount = integer(wire.rowCount, 'export.rowCount')
  const content = typeof wire.content === 'string' ? wire.content : invalid('export.content')
  if (filename !== 'logistics-tracking.csv'
    || mediaType !== 'text/csv;charset=utf-8'
    || rowCount > 10_000
    || content.length > 30_000_000
    || !content.startsWith('\uFEFF平台编码,平台名称,店铺名称,订单号,目的国家,仓库,物流渠道,主运单号,备用运单号,跟踪状态,固定分类,自定义分类,发货时间,更新时间\r\n')) {
    invalid('export.contract')
  }
  return { filename: 'logistics-tracking.csv', mediaType: 'text/csv;charset=utf-8', rowCount, content }
}

function validateFilters(request: LogisticsTrackingExportRequest) {
  if (request.country && !/^[A-Z]{2}$/i.test(request.country.trim())) {
    invalidRequest('country')
  }
  const shippedFrom = request.shippedFrom ? Date.parse(request.shippedFrom) : undefined
  const shippedTo = request.shippedTo ? Date.parse(request.shippedTo) : undefined
  if ((shippedFrom !== undefined && Number.isNaN(shippedFrom))
    || (shippedTo !== undefined && Number.isNaN(shippedTo))
    || (shippedFrom !== undefined && shippedTo !== undefined && shippedFrom > shippedTo)) {
    invalidRequest('shipmentDates')
  }
}

function exportBody(request: LogisticsTrackingExportRequest) {
  const body: Record<string, string | undefined> = { searchField: request.searchField }
  for (const field of ['shop', 'carrier', 'country', 'warehouse', 'category'] as const) {
    const value = request[field]?.trim()
    if (value) body[field] = value.slice(0, 100)
  }
  body.keyword = request.keyword?.trim().slice(0, 120) || undefined
  body.status = request.status
  body.shippedFrom = request.shippedFrom
  body.shippedTo = request.shippedTo
  return body
}

const itemFields = [
  'orderId', 'platformCode', 'platformName', 'shopName', 'orderNo',
  'countryCode', 'warehouseSummary', 'logisticsChannel', 'trackingReference',
  'secondaryTrackingReference', 'trackingStatus', 'fixedCategory',
  'customCategory', 'shippedAt', 'updatedAt',
] as const

function parseItem(value: unknown): LogisticsTrackingItem {
  const wire = record(value, 'item')
  exact(wire, itemFields, 'item')
  const trackingReference = optionalText(
    wire.trackingReference, 'item.trackingReference',
  )
  const secondaryTrackingReference = optionalText(
    wire.secondaryTrackingReference, 'item.secondaryTrackingReference',
  )
  if (!trackingReference && !secondaryTrackingReference) {
    invalid('item.trackingReferences')
  }
  const countryCode = optionalText(wire.countryCode, 'item.countryCode')
  if (countryCode && !/^[A-Z]{2}$/.test(countryCode)) invalid('item.countryCode')
  return {
    orderId: uuid(wire.orderId, 'item.orderId'),
    platformCode: text(wire.platformCode, 'item.platformCode'),
    platformName: text(wire.platformName, 'item.platformName'),
    shopName: text(wire.shopName, 'item.shopName'),
    orderNo: text(wire.orderNo, 'item.orderNo'),
    countryCode,
    warehouseSummary: optionalText(wire.warehouseSummary, 'item.warehouseSummary'),
    logisticsChannel: optionalText(wire.logisticsChannel, 'item.logisticsChannel'),
    trackingReference,
    secondaryTrackingReference,
    trackingStatus: optionalText(wire.trackingStatus, 'item.trackingStatus'),
    fixedCategory: optionalText(wire.fixedCategory, 'item.fixedCategory'),
    customCategory: optionalText(wire.customCategory, 'item.customCategory'),
    shippedAt: optionalTimestamp(wire.shippedAt, 'item.shippedAt'),
    updatedAt: timestamp(wire.updatedAt, 'item.updatedAt'),
  }
}

export const logisticsTrackingApi = {
  async list(request: LogisticsTrackingListRequest): Promise<LogisticsTrackingPage> {
    if (!Number.isSafeInteger(request.page) || request.page < 0
      || !Number.isSafeInteger(request.size) || request.size < 1
      || request.size > 200) invalidRequest('page')
    validateFilters(request)
    const query = new URLSearchParams({
      searchField: request.searchField,
      page: String(request.page),
      size: String(request.size),
    })
    for (const field of ['shop', 'carrier', 'country', 'warehouse', 'category'] as const) {
      const value = request[field]?.trim()
      if (value) query.set(field, value.slice(0, 100))
    }
    if (request.keyword?.trim()) query.set('keyword', request.keyword.trim().slice(0, 120))
    if (request.status) query.set('status', request.status)
    if (request.shippedFrom) query.set('shippedFrom', request.shippedFrom)
    if (request.shippedTo) query.set('shippedTo', request.shippedTo)
    const wire = record(await apiClient.request<unknown>(
      `${API_BASE}?${query}`,
      { signal: request.signal },
    ), 'page')
    exact(wire, ['items', 'page', 'size', 'totalElements', 'totalPages'], 'page')
    if (!Array.isArray(wire.items)) invalid('page.items')
    const result = {
      items: wire.items.map(parseItem),
      page: integer(wire.page, 'page.page'),
      size: integer(wire.size, 'page.size', true),
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
      || new Set(result.items.map((item) => item.orderId)).size !== result.items.length) {
      invalid('page.identity')
    }
    return result
  },
  async exportCsv(request: LogisticsTrackingExportRequest): Promise<LogisticsTrackingExport> {
    validateFilters(request)
    return parseExport(await apiClient.request<unknown>(`${API_BASE}/exports`, {
      method: 'POST', body: exportBody(request),
    }))
  },
}
