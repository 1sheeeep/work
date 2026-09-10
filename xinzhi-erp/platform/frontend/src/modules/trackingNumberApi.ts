import { ApiError, apiClient } from '../api/client'

const API_BASE = '/api/v1/logistics/tracking-numbers'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type TrackingNumberType = 'DOMESTIC_EXPRESS' | 'CUSTOM_LOGISTICS'
export type TrackingNumberStatus = 'UNUSED' | 'USED' | 'ARCHIVED'
export type TrackingNumberItem = {
  id: string
  importBatchId: string
  trackingType: TrackingNumberType
  logisticsChannel: string
  trackingReference: string
  status: TrackingNumberStatus
  orderReference?: string
  packageNumber?: string
  usedAt?: string
  version: number
  createdAt: string
}
export type TrackingNumberPage = {
  items: TrackingNumberItem[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}
export type TrackingNumberListRequest = {
  type?: TrackingNumberType
  status?: 'ALL' | TrackingNumberStatus
  channel?: string
  searchField?: 'ORDER_NO' | 'TRACKING_NO'
  keyword?: string
  page: number
  size: number
  signal?: AbortSignal
}

type Wire = Record<string, unknown>
function invalid(field: string): never {
  throw new ApiError('Invalid tracking number response', {
    status: 502, code: 'invalid_response', details: { field },
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
  if (!UUID.test(result)) invalid(field)
  return result
}
function integer(value: unknown, field: string) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid(field)
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

const itemFields = [
  'id', 'importBatchId', 'trackingType', 'logisticsChannel',
  'trackingReference', 'status', 'orderReference', 'packageNumber',
  'usedAt', 'version', 'createdAt',
] as const
function item(value: unknown): TrackingNumberItem {
  const wire = record(value, 'item')
  exact(wire, itemFields, 'item')
  const trackingType = text(wire.trackingType, 'item.trackingType')
  const status = text(wire.status, 'item.status')
  if (!['DOMESTIC_EXPRESS', 'CUSTOM_LOGISTICS'].includes(trackingType)
    || !['UNUSED', 'USED', 'ARCHIVED'].includes(status)) invalid('item.enums')
  const orderReference = optionalText(wire.orderReference, 'item.orderReference')
  const packageNumber = optionalText(wire.packageNumber, 'item.packageNumber')
  const usedAt = optionalTimestamp(wire.usedAt, 'item.usedAt')
  if ((status === 'USED') !== Boolean(orderReference && packageNumber && usedAt)) {
    invalid('item.usage')
  }
  return {
    id: uuid(wire.id, 'item.id'),
    importBatchId: uuid(wire.importBatchId, 'item.importBatchId'),
    trackingType: trackingType as TrackingNumberType,
    logisticsChannel: text(wire.logisticsChannel, 'item.logisticsChannel'),
    trackingReference: text(wire.trackingReference, 'item.trackingReference'),
    status: status as TrackingNumberStatus,
    orderReference, packageNumber, usedAt,
    version: integer(wire.version, 'item.version'),
    createdAt: timestamp(wire.createdAt, 'item.createdAt'),
  }
}

export const trackingNumberApi = {
  async list(request: TrackingNumberListRequest): Promise<TrackingNumberPage> {
    if (!Number.isSafeInteger(request.page) || request.page < 0
      || !Number.isSafeInteger(request.size) || request.size < 1 || request.size > 200) {
      throw new ApiError('Invalid tracking number request', { status: 400, code: 'invalid_request' })
    }
    const query = new URLSearchParams({ page: String(request.page), size: String(request.size) })
    if (request.type) query.set('type', request.type)
    if (request.status && request.status !== 'ALL') query.set('status', request.status)
    if (request.channel?.trim()) query.set('channel', request.channel.trim().slice(0, 100))
    if (request.searchField) query.set('searchField', request.searchField)
    if (request.keyword?.trim()) query.set('keyword', request.keyword.trim().slice(0, 120))
    const wire = record(await apiClient.request<unknown>(`${API_BASE}?${query}`, {
      signal: request.signal,
    }), 'page')
    exact(wire, ['items', 'page', 'size', 'totalElements', 'totalPages'], 'page')
    if (!Array.isArray(wire.items)) invalid('page.items')
    const result = {
      items: wire.items.map(item), page: integer(wire.page, 'page.page'),
      size: integer(wire.size, 'page.size'),
      totalElements: integer(wire.totalElements, 'page.totalElements'),
      totalPages: integer(wire.totalPages, 'page.totalPages'),
    }
    const expectedPages = result.totalElements === 0 ? 0 : Math.ceil(result.totalElements / result.size)
    if (result.page !== request.page || result.size !== request.size
      || result.totalPages !== expectedPages || result.items.length > result.size
      || new Set(result.items.map((entry) => entry.id)).size !== result.items.length) invalid('page.contract')
    return result
  },

  async importNumbers(input: {
    type: TrackingNumberType; channel: string; trackingReferences: string[]
  }): Promise<{ batchId: string; importedCount: number }> {
    const wire = record(await apiClient.request<unknown>(`${API_BASE}/imports`, {
      method: 'POST', body: input,
    }), 'import')
    exact(wire, ['batchId', 'importedCount'], 'import')
    return { batchId: uuid(wire.batchId, 'import.batchId'), importedCount: integer(wire.importedCount, 'import.importedCount') }
  },

  async archive(id: string, version: number): Promise<TrackingNumberItem> {
    if (!UUID.test(id) || !Number.isSafeInteger(version) || version < 0) {
      throw new ApiError('Invalid tracking number request', { status: 400, code: 'invalid_request' })
    }
    return item(await apiClient.request<unknown>(`${API_BASE}/${id}/archive`, {
      method: 'POST', body: { version },
    }))
  },
}
