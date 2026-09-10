import { ApiError, apiClient } from '../api/client'

const API_BASE = '/api/v1/procurement/statistics/purchasers'

export type PurchaserStatisticsGranularity = 'DAY' | 'MONTH'

export type PurchaserStatisticsItem = {
  periodStart: string
  purchaserDisplayName: string
  orderCount: number
  orderedQuantity: number
  receivedQuantity: number
  outstandingQuantity: number
  newOrderCount: number
  approvedOrderCount: number
  partiallyReceivedOrderCount: number
  receivedOrderCount: number
}

export type PurchaserStatisticsPage = {
  items: PurchaserStatisticsItem[]
  granularity: PurchaserStatisticsGranularity
  totalOrders: number
  totalOrderedQuantity: number
  totalReceivedQuantity: number
  totalOutstandingQuantity: number
  page: number
  size: number
  totalElements: number
  totalPages: number
}

export type PurchaserStatisticsExport = {
  filename: 'purchaser-statistics.csv'
  mediaType: 'text/csv;charset=utf-8'
  rowCount: number
  content: string
}

export type PurchaserStatisticsRequest = {
  granularity: PurchaserStatisticsGranularity
  purchaser?: string
  orderedFrom?: string
  orderedToExclusive?: string
  page: number
  size: number
  signal?: AbortSignal
}

type Wire = Record<string, unknown>

function invalid(field: string): never {
  throw new ApiError('Invalid purchaser statistics response', {
    status: 502,
    code: 'invalid_response',
    details: { field },
  })
}

function invalidRequest(field: string): never {
  throw new ApiError('Invalid purchaser statistics request', {
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

function integer(value: unknown, field: string, positive = false) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)
    || value < (positive ? 1 : 0)) invalid(field)
  return value
}

function text(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim()) invalid(field)
  return value
}

function reportDate(value: unknown, field: string) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    invalid(field)
  }
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day) invalid(field)
  return value
}

function granularity(
  value: unknown,
  field: string,
): PurchaserStatisticsGranularity {
  if (value !== 'DAY' && value !== 'MONTH') invalid(field)
  return value
}

function parseItem(value: unknown): PurchaserStatisticsItem {
  const wire = record(value, 'item')
  exact(wire, [
    'periodStart', 'purchaserDisplayName', 'orderCount', 'orderedQuantity',
    'receivedQuantity', 'outstandingQuantity', 'newOrderCount',
    'approvedOrderCount', 'partiallyReceivedOrderCount', 'receivedOrderCount',
  ], 'item')
  const item: PurchaserStatisticsItem = {
    periodStart: reportDate(wire.periodStart, 'item.periodStart'),
    purchaserDisplayName: text(
      wire.purchaserDisplayName,
      'item.purchaserDisplayName',
    ),
    orderCount: integer(wire.orderCount, 'item.orderCount', true),
    orderedQuantity: integer(
      wire.orderedQuantity,
      'item.orderedQuantity',
      true,
    ),
    receivedQuantity: integer(wire.receivedQuantity, 'item.receivedQuantity'),
    outstandingQuantity: integer(
      wire.outstandingQuantity,
      'item.outstandingQuantity',
    ),
    newOrderCount: integer(wire.newOrderCount, 'item.newOrderCount'),
    approvedOrderCount: integer(
      wire.approvedOrderCount,
      'item.approvedOrderCount',
    ),
    partiallyReceivedOrderCount: integer(
      wire.partiallyReceivedOrderCount,
      'item.partiallyReceivedOrderCount',
    ),
    receivedOrderCount: integer(
      wire.receivedOrderCount,
      'item.receivedOrderCount',
    ),
  }
  if (item.receivedQuantity + item.outstandingQuantity !== item.orderedQuantity
    || item.newOrderCount + item.approvedOrderCount
      + item.partiallyReceivedOrderCount
      + item.receivedOrderCount !== item.orderCount) invalid('item.identity')
  return item
}

function validateOrderedWindow(
  request: Pick<PurchaserStatisticsRequest, 'orderedFrom' | 'orderedToExclusive'>,
) {
  const from = request.orderedFrom ? Date.parse(request.orderedFrom) : undefined
  const to = request.orderedToExclusive
    ? Date.parse(request.orderedToExclusive)
    : undefined
  if ((from !== undefined && Number.isNaN(from))
    || (to !== undefined && Number.isNaN(to))
    || (from !== undefined && to !== undefined && from >= to)) {
    invalidRequest('orderedWindow')
  }
}

function parseExport(value: unknown): PurchaserStatisticsExport {
  const wire = record(value, 'export')
  exact(wire, ['filename', 'mediaType', 'rowCount', 'content'], 'export')
  const filename = text(wire.filename, 'export.filename')
  const mediaType = text(wire.mediaType, 'export.mediaType')
  const rowCount = integer(wire.rowCount, 'export.rowCount')
  const content = typeof wire.content === 'string'
    ? wire.content
    : invalid('export.content')
  if (filename !== 'purchaser-statistics.csv'
    || mediaType !== 'text/csv;charset=utf-8'
    || rowCount > 10_000
    || content.length > 30_000_000
    || !content.startsWith('\uFEFF统计期间（UTC）,统计粒度,采购员名称快照,采购单数,采购数量,已收数量,待收数量,待审核,待收货,部分收货,已收货\r\n')) {
    invalid('export.contract')
  }
  return {
    filename: 'purchaser-statistics.csv',
    mediaType: 'text/csv;charset=utf-8',
    rowCount,
    content,
  }
}

export const purchaserStatisticsApi = {
  async summarize(
    request: PurchaserStatisticsRequest,
  ): Promise<PurchaserStatisticsPage> {
    if (!Number.isSafeInteger(request.page) || request.page < 0
      || !Number.isSafeInteger(request.size) || request.size < 1
      || request.size > 100) invalidRequest('page')
    validateOrderedWindow(request)
    const query = new URLSearchParams({
      granularity: request.granularity,
      page: String(request.page),
      size: String(request.size),
    })
    if (request.purchaser?.trim()) {
      query.set('purchaser', request.purchaser.trim().slice(0, 100))
    }
    if (request.orderedFrom) query.set('orderedFrom', request.orderedFrom)
    if (request.orderedToExclusive) {
      query.set('orderedToExclusive', request.orderedToExclusive)
    }
    const wire = record(await apiClient.request<unknown>(
      `${API_BASE}?${query}`,
      { signal: request.signal },
    ), 'page')
    exact(wire, [
      'items', 'granularity', 'totalOrders', 'totalOrderedQuantity',
      'totalReceivedQuantity', 'totalOutstandingQuantity', 'page', 'size',
      'totalElements', 'totalPages',
    ], 'page')
    if (!Array.isArray(wire.items)) invalid('page.items')
    const result: PurchaserStatisticsPage = {
      items: wire.items.map(parseItem),
      granularity: granularity(wire.granularity, 'page.granularity'),
      totalOrders: integer(wire.totalOrders, 'page.totalOrders'),
      totalOrderedQuantity: integer(
        wire.totalOrderedQuantity,
        'page.totalOrderedQuantity',
      ),
      totalReceivedQuantity: integer(
        wire.totalReceivedQuantity,
        'page.totalReceivedQuantity',
      ),
      totalOutstandingQuantity: integer(
        wire.totalOutstandingQuantity,
        'page.totalOutstandingQuantity',
      ),
      page: integer(wire.page, 'page.page'),
      size: integer(wire.size, 'page.size', true),
      totalElements: integer(wire.totalElements, 'page.totalElements'),
      totalPages: integer(wire.totalPages, 'page.totalPages'),
    }
    const expectedPages = result.totalElements === 0
      ? 0
      : Math.ceil(result.totalElements / result.size)
    const currentOrders = result.items.reduce(
      (total, item) => total + item.orderCount,
      0,
    )
    const keys = result.items.map(
      (item) => `${item.periodStart}\u0000${item.purchaserDisplayName}`,
    )
    if (result.granularity !== request.granularity
      || result.page !== request.page
      || result.size !== request.size
      || result.totalPages !== expectedPages
      || result.totalReceivedQuantity + result.totalOutstandingQuantity
        !== result.totalOrderedQuantity
      || result.items.length > result.size
      || result.items.length > result.totalElements
      || currentOrders > result.totalOrders
      || new Set(keys).size !== keys.length) invalid('page.identity')
    return result
  },
  async exportCsv(
    request: Omit<PurchaserStatisticsRequest, 'page' | 'size' | 'signal'>,
  ): Promise<PurchaserStatisticsExport> {
    validateOrderedWindow(request)
    return parseExport(await apiClient.request<unknown>(`${API_BASE}/exports`, {
      method: 'POST',
      body: {
        granularity: request.granularity,
        purchaser: request.purchaser?.trim().slice(0, 100) || undefined,
        orderedFrom: request.orderedFrom,
        orderedToExclusive: request.orderedToExclusive,
      },
    }))
  },
}
