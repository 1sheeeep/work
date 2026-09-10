import { ApiError, apiClient } from '../api/client'

const BASE = '/api/v1/logistics/fees'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type LogisticsFeeStatus = 'UNCONFIRMED' | 'CONFIRMED' | 'ARCHIVED'
export type LogisticsFeeSearchField = 'ORDER_NO' | 'TRACKING_NO' | 'TRANSACTION_NO'
export type LogisticsFeeRecord = {
  id: string
  platformName: string
  shopName: string
  channelName: string
  orderReference: string
  trackingReference: string
  transactionReference?: string
  estimatedFee?: number
  actualFee?: number
  feeVariance?: number
  currency: string
  carrierWeightKg?: number
  warehouseWeightKg?: number
  weightVarianceKg?: number
  shippedOn: string
  confirmationStatus: 'UNCONFIRMED' | 'CONFIRMED'
  lifecycleStatus: 'ACTIVE' | 'ARCHIVED'
  note?: string
  confirmedByDisplayName?: string
  confirmedAt?: string
  createdByDisplayName: string
  version: number
  createdAt: string
  updatedAt: string
}
export type LogisticsFeePageData = {
  items: LogisticsFeeRecord[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}
export type LogisticsFeeInput = {
  platformName: string
  shopName: string
  channelName: string
  orderReference: string
  trackingReference: string
  transactionReference?: string
  estimatedFee?: number
  actualFee?: number
  currency: string
  carrierWeightKg?: number
  warehouseWeightKg?: number
  shippedOn: string
  note?: string
}

type Wire = Record<string, unknown>
function invalid(field: string): never {
  throw new ApiError('Invalid logistics fee response', {
    status: 502, code: 'invalid_response', details: { field },
  })
}
function object(value: unknown, field: string): Wire {
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
function number(value: unknown, field: string): number
function number(value: unknown, field: string, optional: true): number | undefined
function number(value: unknown, field: string, optional = false): number | undefined {
  if (value === null && optional) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid(field)
  return value
}
function integer(value: unknown, field: string) {
  const result = number(value, field)
  if (!Number.isSafeInteger(result) || result < 0) invalid(field)
  return result
}
function date(value: unknown, field: string) {
  const result = text(value, field)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) invalid(field)
  return result
}
function instant(value: unknown, field: string): string
function instant(value: unknown, field: string, optional: true): string | undefined
function instant(value: unknown, field: string, optional = false): string | undefined {
  if (value === null && optional) return undefined
  const result = text(value, field)
  if (Number.isNaN(Date.parse(result))) invalid(field)
  return result
}
function fee(value: unknown): LogisticsFeeRecord {
  const wire = object(value, 'feeRecord')
  const fields = ['id', 'platformName', 'shopName', 'channelName',
    'orderReference', 'trackingReference', 'transactionReference',
    'estimatedFee', 'actualFee', 'feeVariance', 'currency',
    'carrierWeightKg', 'warehouseWeightKg', 'weightVarianceKg', 'shippedOn',
    'confirmationStatus', 'lifecycleStatus', 'note',
    'confirmedByDisplayName', 'confirmedAt', 'createdByDisplayName',
    'version', 'createdAt', 'updatedAt']
  exact(wire, fields, 'feeRecord')
  const id = text(wire.id, 'feeRecord.id')
  if (!UUID.test(id)) invalid('feeRecord.id')
  if (wire.confirmationStatus !== 'UNCONFIRMED' && wire.confirmationStatus !== 'CONFIRMED') {
    invalid('feeRecord.confirmationStatus')
  }
  if (wire.lifecycleStatus !== 'ACTIVE' && wire.lifecycleStatus !== 'ARCHIVED') {
    invalid('feeRecord.lifecycleStatus')
  }
  return {
    id,
    platformName: text(wire.platformName, 'feeRecord.platformName'),
    shopName: text(wire.shopName, 'feeRecord.shopName'),
    channelName: text(wire.channelName, 'feeRecord.channelName'),
    orderReference: text(wire.orderReference, 'feeRecord.orderReference'),
    trackingReference: text(wire.trackingReference, 'feeRecord.trackingReference'),
    transactionReference: optionalText(wire.transactionReference, 'feeRecord.transactionReference'),
    estimatedFee: number(wire.estimatedFee, 'feeRecord.estimatedFee', true),
    actualFee: number(wire.actualFee, 'feeRecord.actualFee', true),
    feeVariance: number(wire.feeVariance, 'feeRecord.feeVariance', true),
    currency: text(wire.currency, 'feeRecord.currency'),
    carrierWeightKg: number(wire.carrierWeightKg, 'feeRecord.carrierWeightKg', true),
    warehouseWeightKg: number(wire.warehouseWeightKg, 'feeRecord.warehouseWeightKg', true),
    weightVarianceKg: number(wire.weightVarianceKg, 'feeRecord.weightVarianceKg', true),
    shippedOn: date(wire.shippedOn, 'feeRecord.shippedOn'),
    confirmationStatus: wire.confirmationStatus,
    lifecycleStatus: wire.lifecycleStatus,
    note: optionalText(wire.note, 'feeRecord.note'),
    confirmedByDisplayName: optionalText(wire.confirmedByDisplayName, 'feeRecord.confirmedByDisplayName'),
    confirmedAt: instant(wire.confirmedAt, 'feeRecord.confirmedAt', true),
    createdByDisplayName: text(wire.createdByDisplayName, 'feeRecord.createdByDisplayName'),
    version: integer(wire.version, 'feeRecord.version'),
    createdAt: instant(wire.createdAt, 'feeRecord.createdAt'),
    updatedAt: instant(wire.updatedAt, 'feeRecord.updatedAt'),
  }
}
function page(value: unknown): LogisticsFeePageData {
  const wire = object(value, 'page')
  exact(wire, ['items', 'page', 'size', 'totalElements', 'totalPages'], 'page')
  if (!Array.isArray(wire.items)) invalid('page.items')
  const result = {
    items: wire.items.map(fee),
    page: integer(wire.page, 'page.page'),
    size: integer(wire.size, 'page.size'),
    totalElements: integer(wire.totalElements, 'page.totalElements'),
    totalPages: integer(wire.totalPages, 'page.totalPages'),
  }
  if (result.size < 1 || result.items.length > result.size) invalid('page.size')
  return result
}
function requestId() { return `logistics-fee.${crypto.randomUUID()}` }

export const logisticsFeeApi = {
  async list(input: {
    status: LogisticsFeeStatus
    searchField: LogisticsFeeSearchField
    platform?: string
    shop?: string
    channel?: string
    keyword?: string
    hasActualFee?: boolean
    shippedFrom?: string
    shippedTo?: string
    page: number
    pageSize: number
    signal?: AbortSignal
  }) {
    const params = new URLSearchParams({
      status: input.status, searchField: input.searchField,
      page: String(input.page), pageSize: String(input.pageSize),
    })
    for (const key of ['platform', 'shop', 'channel', 'keyword', 'shippedFrom', 'shippedTo'] as const) {
      if (input[key]) params.set(key, input[key])
    }
    if (input.hasActualFee !== undefined) params.set('hasActualFee', String(input.hasActualFee))
    return page(await apiClient.request<unknown>(`${BASE}?${params}`, { signal: input.signal }))
  },
  async create(input: LogisticsFeeInput) {
    return fee(await apiClient.request<unknown>(BASE, {
      method: 'POST', headers: { 'X-Request-Id': requestId() }, body: input,
    }))
  },
  async update(id: string, version: number, input: LogisticsFeeInput) {
    return fee(await apiClient.request<unknown>(`${BASE}/${id}`, {
      method: 'PUT', headers: { 'X-Request-Id': requestId() }, body: { ...input, version },
    }))
  },
  async confirm(id: string, version: number) {
    return fee(await apiClient.request<unknown>(`${BASE}/${id}/confirm`, {
      method: 'POST', headers: { 'X-Request-Id': requestId() }, body: { version },
    }))
  },
  async archive(id: string, version: number) {
    return fee(await apiClient.request<unknown>(`${BASE}/${id}/archive`, {
      method: 'POST', headers: { 'X-Request-Id': requestId() }, body: { version },
    }))
  },
}
