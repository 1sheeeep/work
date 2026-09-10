import { ApiError, apiClient } from '../api/client'

const BASE = '/api/v1/logistics/forecast-batches'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type ForecastBatchStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED'
export type LogisticsForecastBatch = {
  id: string
  batchNo: string
  batchType: string
  forwarder: string
  orderReferences: string[]
  orderCount: number
  totalWeightKg: number
  status: ForecastBatchStatus
  printed: boolean
  resultMessage?: string
  createdByDisplayName: string
  version: number
  createdAt: string
  updatedAt: string
}
export type LogisticsForecastBatchPage = {
  items: LogisticsForecastBatch[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}
export type LogisticsForecastBatchInput = {
  batchType: string
  forwarder: string
  orderReferences: string[]
  totalWeightKg: number
}

type Wire = Record<string, unknown>
function invalid(field: string): never {
  throw new ApiError('Invalid logistics forecast response', {
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
  return value === null ? undefined : text(value, field)
}
function integer(value: unknown, field: string) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid(field)
  return value
}
function batch(value: unknown): LogisticsForecastBatch {
  const wire = record(value, 'forecastBatch')
  const fields = ['id', 'batchNo', 'batchType', 'forwarder', 'orderReferences',
    'orderCount', 'totalWeightKg', 'status', 'printed', 'resultMessage',
    'createdByDisplayName', 'version', 'createdAt', 'updatedAt']
  exact(wire, fields, 'forecastBatch')
  const id = text(wire.id, 'forecastBatch.id')
  if (!UUID.test(id)) invalid('forecastBatch.id')
  if (!Array.isArray(wire.orderReferences) || wire.orderReferences.length < 1
    || wire.orderReferences.some((item) => typeof item !== 'string' || !item)) {
    invalid('forecastBatch.orderReferences')
  }
  if (wire.status !== 'PENDING' && wire.status !== 'SUCCEEDED' && wire.status !== 'FAILED') {
    invalid('forecastBatch.status')
  }
  if (typeof wire.printed !== 'boolean') invalid('forecastBatch.printed')
  if (typeof wire.totalWeightKg !== 'number' || !Number.isFinite(wire.totalWeightKg)
    || wire.totalWeightKg <= 0) invalid('forecastBatch.totalWeightKg')
  const createdAt = text(wire.createdAt, 'forecastBatch.createdAt')
  const updatedAt = text(wire.updatedAt, 'forecastBatch.updatedAt')
  if (Number.isNaN(Date.parse(createdAt)) || Number.isNaN(Date.parse(updatedAt))) {
    invalid('forecastBatch.time')
  }
  return {
    id,
    batchNo: text(wire.batchNo, 'forecastBatch.batchNo'),
    batchType: text(wire.batchType, 'forecastBatch.batchType'),
    forwarder: text(wire.forwarder, 'forecastBatch.forwarder'),
    orderReferences: wire.orderReferences as string[],
    orderCount: integer(wire.orderCount, 'forecastBatch.orderCount'),
    totalWeightKg: wire.totalWeightKg,
    status: wire.status,
    printed: wire.printed,
    resultMessage: optionalText(wire.resultMessage, 'forecastBatch.resultMessage'),
    createdByDisplayName: text(wire.createdByDisplayName, 'forecastBatch.createdByDisplayName'),
    version: integer(wire.version, 'forecastBatch.version'),
    createdAt,
    updatedAt,
  }
}
function page(value: unknown): LogisticsForecastBatchPage {
  const wire = record(value, 'page')
  exact(wire, ['items', 'page', 'size', 'totalElements', 'totalPages'], 'page')
  if (!Array.isArray(wire.items)) invalid('page.items')
  const result = {
    items: wire.items.map(batch),
    page: integer(wire.page, 'page.page'),
    size: integer(wire.size, 'page.size'),
    totalElements: integer(wire.totalElements, 'page.totalElements'),
    totalPages: integer(wire.totalPages, 'page.totalPages'),
  }
  if (result.size < 1 || result.items.length > result.size) invalid('page.size')
  return result
}
function requestId() { return `logistics-forecast.${crypto.randomUUID()}` }

export const logisticsForecastApi = {
  async list(input: {
    status: 'HISTORY' | ForecastBatchStatus
    batchType?: string
    creator?: string
    printed?: boolean
    keyword?: string
    forwarder?: string
    page: number
    pageSize: number
    signal?: AbortSignal
  }) {
    const params = new URLSearchParams({
      status: input.status, page: String(input.page), pageSize: String(input.pageSize),
    })
    if (input.batchType) params.set('batchType', input.batchType)
    if (input.creator) params.set('creator', input.creator)
    if (input.printed !== undefined) params.set('printed', String(input.printed))
    if (input.keyword) params.set('keyword', input.keyword)
    if (input.forwarder) params.set('forwarder', input.forwarder)
    return page(await apiClient.request<unknown>(`${BASE}?${params}`, { signal: input.signal }))
  },
  async create(input: LogisticsForecastBatchInput) {
    return batch(await apiClient.request<unknown>(BASE, {
      method: 'POST', headers: { 'X-Request-Id': requestId() }, body: input,
    }))
  },
  async updateStatus(id: string, version: number, status: ForecastBatchStatus,
    resultMessage?: string) {
    return batch(await apiClient.request<unknown>(`${BASE}/${id}/status`, {
      method: 'POST', headers: { 'X-Request-Id': requestId() },
      body: { version, status, resultMessage },
    }))
  },
  async markPrinted(id: string, version: number) {
    return batch(await apiClient.request<unknown>(`${BASE}/${id}/printed`, {
      method: 'POST', headers: { 'X-Request-Id': requestId() }, body: { version },
    }))
  },
}
