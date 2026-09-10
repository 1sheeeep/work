import { apiClient } from '../api/client'

const API_BASE = '/api/v1/analytics/listing-sales'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type ListingRealtimeSalesItem = {
  listingId: string
  platformCode: string
  platformName: string
  shopId: string
  shopName: string
  externalListingRef: string
  externalVariantRef?: string
  skuId: string
  skuCode: string
  skuName: string
  variantSummary?: string
  rangeSalesQuantity: number
  rangeOrderCount: number
  todaySalesQuantity: number
  yesterdaySalesQuantity: number
  last7DaysSalesQuantity: number
  last28DaysSalesQuantity: number
  last42DaysSalesQuantity: number
  lastPlacedAt: string
}

export type ListingRealtimeSalesPage = {
  items: ListingRealtimeSalesItem[]
  totalListingCount: number
  totalRangeSalesQuantity: number
  observedAt: string
  page: number
  size: number
  totalPages: number
}

export type ListingRealtimeSalesExport = {
  filename: 'listing-realtime-sales.csv'
  mediaType: 'text/csv;charset=utf-8'
  rowCount: number
  content: string
}

type Request = {
  keyword?: string
  rangeFrom?: string
  asOf: string
  page: number
  size: number
  signal?: AbortSignal
}

type Wire = Record<string, unknown>

function invalid(field: string): never {
  throw new Error(`Invalid listing realtime sales response: ${field}`)
}

function record(value: unknown, field: string): Wire {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field)
  return value as Wire
}

function exact(value: Wire, keys: readonly string[], field: string) {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length
      || actual.some((key, index) => key !== expected[index])) {
    invalid(`${field}.shape`)
  }
}

function text(value: unknown, field: string) {
  return typeof value === 'string' && value.trim() ? value : invalid(field)
}

function optionalText(value: unknown, field: string) {
  return value == null ? undefined : text(value, field)
}

function uuid(value: unknown, field: string) {
  const result = text(value, field)
  return UUID_PATTERN.test(result) ? result : invalid(field)
}

function integer(value: unknown, field: string, positive = false) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)
      || value < (positive ? 1 : 0)) invalid(field)
  return value
}

function timestamp(value: unknown, field: string) {
  const result = text(value, field)
  return Number.isNaN(Date.parse(result)) ? invalid(field) : result
}

function item(value: unknown): ListingRealtimeSalesItem {
  const wire = record(value, 'item')
  exact(wire, [
    'listingId', 'platformCode', 'platformName', 'shopId', 'shopName',
    'externalListingRef', 'externalVariantRef', 'skuId', 'skuCode', 'skuName',
    'variantSummary', 'rangeSalesQuantity', 'rangeOrderCount',
    'todaySalesQuantity', 'yesterdaySalesQuantity', 'last7DaysSalesQuantity',
    'last28DaysSalesQuantity', 'last42DaysSalesQuantity', 'lastPlacedAt',
  ], 'item')
  return {
    listingId: uuid(wire.listingId, 'item.listingId'),
    platformCode: text(wire.platformCode, 'item.platformCode'),
    platformName: text(wire.platformName, 'item.platformName'),
    shopId: uuid(wire.shopId, 'item.shopId'),
    shopName: text(wire.shopName, 'item.shopName'),
    externalListingRef: text(
      wire.externalListingRef, 'item.externalListingRef',
    ),
    externalVariantRef: optionalText(
      wire.externalVariantRef, 'item.externalVariantRef',
    ),
    skuId: uuid(wire.skuId, 'item.skuId'),
    skuCode: text(wire.skuCode, 'item.skuCode'),
    skuName: text(wire.skuName, 'item.skuName'),
    variantSummary: optionalText(wire.variantSummary, 'item.variantSummary'),
    rangeSalesQuantity: integer(
      wire.rangeSalesQuantity, 'item.rangeSalesQuantity',
    ),
    rangeOrderCount: integer(wire.rangeOrderCount, 'item.rangeOrderCount'),
    todaySalesQuantity: integer(
      wire.todaySalesQuantity, 'item.todaySalesQuantity',
    ),
    yesterdaySalesQuantity: integer(
      wire.yesterdaySalesQuantity, 'item.yesterdaySalesQuantity',
    ),
    last7DaysSalesQuantity: integer(
      wire.last7DaysSalesQuantity, 'item.last7DaysSalesQuantity',
    ),
    last28DaysSalesQuantity: integer(
      wire.last28DaysSalesQuantity, 'item.last28DaysSalesQuantity',
    ),
    last42DaysSalesQuantity: integer(
      wire.last42DaysSalesQuantity, 'item.last42DaysSalesQuantity',
    ),
    lastPlacedAt: timestamp(wire.lastPlacedAt, 'item.lastPlacedAt'),
  }
}

function exportResult(value: unknown): ListingRealtimeSalesExport {
  const wire = record(value, 'export')
  exact(wire, ['filename', 'mediaType', 'rowCount', 'content'], 'export')
  const filename = text(wire.filename, 'export.filename')
  const mediaType = text(wire.mediaType, 'export.mediaType')
  const rowCount = integer(wire.rowCount, 'export.rowCount')
  const content = typeof wire.content === 'string'
    ? wire.content
    : invalid('export.content')
  if (filename !== 'listing-realtime-sales.csv'
      || mediaType !== 'text/csv;charset=utf-8'
      || rowCount > 10_000
      || content.length > 30_000_000
      || !content.startsWith('\uFEFF平台编码,平台名称,店铺,Listing,Listing变体,库存SKU,SKU名称,规格,所选区间销量,所选区间订单数,今日销量,昨日销量,近7天销量,近28天销量,近42天销量,最近下单,统计截至\r\n')) {
    invalid('export.contract')
  }
  return {
    filename: 'listing-realtime-sales.csv',
    mediaType: 'text/csv;charset=utf-8',
    rowCount,
    content,
  }
}

export function parseListingRealtimeSalesPage(
  value: unknown,
): ListingRealtimeSalesPage {
  const wire = record(value, 'report')
  exact(wire, [
    'items', 'totalListingCount', 'totalRangeSalesQuantity', 'observedAt',
    'page', 'size', 'totalPages',
  ], 'report')
  if (!Array.isArray(wire.items)) invalid('report.items')
  const result: ListingRealtimeSalesPage = {
    items: wire.items.map(item),
    totalListingCount: integer(
      wire.totalListingCount, 'report.totalListingCount',
    ),
    totalRangeSalesQuantity: integer(
      wire.totalRangeSalesQuantity, 'report.totalRangeSalesQuantity',
    ),
    observedAt: timestamp(wire.observedAt, 'report.observedAt'),
    page: integer(wire.page, 'report.page'),
    size: integer(wire.size, 'report.size', true),
    totalPages: integer(wire.totalPages, 'report.totalPages'),
  }
  const expectedPages = result.totalListingCount === 0
    ? 0
    : Math.ceil(result.totalListingCount / result.size)
  const listingIds = result.items.map((entry) => entry.listingId)
  if (result.totalPages !== expectedPages
      || result.items.length > result.size
      || result.items.length > result.totalListingCount
      || (result.items.length > 0 && result.page >= result.totalPages)
      || new Set(listingIds).size !== listingIds.length) {
    invalid('report.cardinality')
  }
  return result
}

export const listingRealtimeSalesApi = {
  async summarize(request: Request): Promise<ListingRealtimeSalesPage> {
    if (!Number.isSafeInteger(request.page) || request.page < 0
        || !Number.isSafeInteger(request.size) || request.size < 1
        || request.size > 100) {
      throw new Error('Invalid listing realtime sales request: page')
    }
    const from = request.rangeFrom ? Date.parse(request.rangeFrom) : undefined
    const asOf = Date.parse(request.asOf)
    if (Number.isNaN(asOf) || (from !== undefined
        && (Number.isNaN(from) || from >= asOf))) {
      throw new Error('Invalid listing realtime sales request: time')
    }
    const query = new URLSearchParams({
      asOf: request.asOf,
      page: String(request.page),
      size: String(request.size),
    })
    if (request.keyword?.trim()) {
      query.set('keyword', request.keyword.trim().slice(0, 100))
    }
    if (request.rangeFrom) query.set('rangeFrom', request.rangeFrom)
    const result = parseListingRealtimeSalesPage(
      await apiClient.request<unknown>(`${API_BASE}?${query}`, {
        signal: request.signal,
      }),
    )
    if (result.page !== request.page || result.size !== request.size
        || Date.parse(result.observedAt) !== asOf) {
      invalid('report.requestIdentity')
    }
    return result
  },
  async exportCsv(
    request: Omit<Request, 'page' | 'size' | 'signal'>,
  ): Promise<ListingRealtimeSalesExport> {
    const from = request.rangeFrom ? Date.parse(request.rangeFrom) : undefined
    const asOf = Date.parse(request.asOf)
    if (Number.isNaN(asOf) || (from !== undefined
        && (Number.isNaN(from) || from >= asOf))) {
      throw new Error('Invalid listing realtime sales request: time')
    }
    return exportResult(await apiClient.request<unknown>(`${API_BASE}/exports`, {
      method: 'POST',
      body: {
        keyword: request.keyword?.trim().slice(0, 100) || undefined,
        rangeFrom: request.rangeFrom,
        asOf: request.asOf,
      },
    }))
  },
}
