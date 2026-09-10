import { ApiError, apiClient } from '../api/client'

const API_BASE = '/api/v1/analytics/order-status'

export const ORDER_STATUSES = [
  'UNPAID',
  'RECEIVED',
  'REVIEW_PENDING',
  'MERGE_PENDING',
  'HOLD',
  'READY_TO_FULFILL',
  'FULFILLING',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
] as const

export type OrderStatus = typeof ORDER_STATUSES[number]

export type OrderStatusCount = {
  status: OrderStatus
  orderCount: number
}

export type OrderStatusReportDay = {
  reportDate: string
  orderCount: number
  statuses: OrderStatusCount[]
}

export type OrderStatusReportPage = {
  items: OrderStatusReportDay[]
  totalOrders: number
  page: number
  size: number
  totalElements: number
  totalPages: number
}

export type OrderStatusReportExport = {
  filename: 'order-status-report.csv'
  mediaType: 'text/csv;charset=utf-8'
  rowCount: number
  content: string
}

export type OrderStatusReportRequest = {
  shop?: string
  placedFrom?: string
  placedToExclusive?: string
  page: number
  size: number
  signal?: AbortSignal
}

type Wire = Record<string, unknown>

function invalid(field: string): never {
  throw new ApiError('Invalid order status report response', {
    status: 502,
    code: 'invalid_response',
    details: { field },
  })
}

function invalidRequest(field: string): never {
  throw new ApiError('Invalid order status report request', {
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

function status(value: unknown, field: string): OrderStatus {
  if (!ORDER_STATUSES.includes(value as OrderStatus)) invalid(field)
  return value as OrderStatus
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

function parseStatus(value: unknown): OrderStatusCount {
  const wire = record(value, 'status')
  exact(wire, ['status', 'orderCount'], 'status')
  return {
    status: status(wire.status, 'status.status'),
    orderCount: integer(wire.orderCount, 'status.orderCount', true),
  }
}

function parseDay(value: unknown): OrderStatusReportDay {
  const wire = record(value, 'day')
  exact(wire, ['reportDate', 'orderCount', 'statuses'], 'day')
  if (!Array.isArray(wire.statuses) || wire.statuses.length === 0) {
    invalid('day.statuses')
  }
  const statuses = wire.statuses.map(parseStatus)
  const orderCount = integer(wire.orderCount, 'day.orderCount', true)
  if (new Set(statuses.map((item) => item.status)).size !== statuses.length
    || statuses.reduce((total, item) => total + item.orderCount, 0) !== orderCount) {
    invalid('day.statuses.identity')
  }
  return {
    reportDate: reportDate(wire.reportDate, 'day.reportDate'),
    orderCount,
    statuses,
  }
}

function exportResult(value: unknown): OrderStatusReportExport {
  const wire = record(value, 'export')
  exact(wire, ['filename', 'mediaType', 'rowCount', 'content'], 'export')
  const rowCount = integer(wire.rowCount, 'export.rowCount')
  const content = typeof wire.content === 'string'
    ? wire.content
    : invalid('export.content')
  if (wire.filename !== 'order-status-report.csv'
    || wire.mediaType !== 'text/csv;charset=utf-8'
    || rowCount > 10_000
    || content.length > 30_000_000
    || !content.startsWith('\uFEFF日期（UTC）,订单总数,待付款,已接收,待审核,待合并,已搁置,待履约,履约中,已发货,已送达,已取消\r\n')) {
    invalid('export.contract')
  }
  return {
    filename: 'order-status-report.csv',
    mediaType: 'text/csv;charset=utf-8',
    rowCount,
    content,
  }
}

export const orderStatusReportApi = {
  async summarize(
    request: OrderStatusReportRequest,
  ): Promise<OrderStatusReportPage> {
    if (!Number.isSafeInteger(request.page) || request.page < 0
      || !Number.isSafeInteger(request.size) || request.size < 1
      || request.size > 100) invalidRequest('page')
    const from = request.placedFrom ? Date.parse(request.placedFrom) : undefined
    const to = request.placedToExclusive
      ? Date.parse(request.placedToExclusive)
      : undefined
    if ((from !== undefined && Number.isNaN(from))
      || (to !== undefined && Number.isNaN(to))
      || (from !== undefined && to !== undefined && from >= to)) {
      invalidRequest('placedWindow')
    }
    const query = new URLSearchParams({
      page: String(request.page),
      size: String(request.size),
    })
    if (request.shop?.trim()) query.set('shop', request.shop.trim().slice(0, 100))
    if (request.placedFrom) query.set('placedFrom', request.placedFrom)
    if (request.placedToExclusive) {
      query.set('placedToExclusive', request.placedToExclusive)
    }
    const wire = record(await apiClient.request<unknown>(
      `${API_BASE}?${query}`,
      { signal: request.signal },
    ), 'page')
    exact(wire, [
      'items', 'totalOrders', 'page', 'size', 'totalElements', 'totalPages',
    ], 'page')
    if (!Array.isArray(wire.items)) invalid('page.items')
    const result: OrderStatusReportPage = {
      items: wire.items.map(parseDay),
      totalOrders: integer(wire.totalOrders, 'page.totalOrders'),
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
    if (result.page !== request.page
      || result.size !== request.size
      || result.totalPages !== expectedPages
      || result.items.length > result.size
      || result.items.length > result.totalElements
      || new Set(result.items.map((item) => item.reportDate)).size !== result.items.length
      || currentOrders > result.totalOrders) invalid('page.identity')
    return result
  },
  async exportCsv(
    request: Omit<OrderStatusReportRequest, 'page' | 'size' | 'signal'>,
  ): Promise<OrderStatusReportExport> {
    const from = request.placedFrom ? Date.parse(request.placedFrom) : undefined
    const to = request.placedToExclusive
      ? Date.parse(request.placedToExclusive)
      : undefined
    if ((from !== undefined && Number.isNaN(from))
      || (to !== undefined && Number.isNaN(to))
      || (from !== undefined && to !== undefined && from >= to)) {
      invalidRequest('placedWindow')
    }
    return exportResult(await apiClient.request<unknown>(`${API_BASE}/exports`, {
      method: 'POST',
      body: {
        shop: request.shop?.trim().slice(0, 100) || undefined,
        placedFrom: request.placedFrom,
        placedToExclusive: request.placedToExclusive,
      },
    }))
  },
}
