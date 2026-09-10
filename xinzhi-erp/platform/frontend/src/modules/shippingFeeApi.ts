import { ApiError, apiClient } from '../api/client'

const API_BASE = '/api/v1/logistics/shipping-fees'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type ShippingFeeStatus = 'ACTIVE' | 'ARCHIVED'
export type ShippingFeeRegion = {
  id: string; name: string; countryCode: string; city?: string; postalCodePrefix?: string; note?: string
  status: ShippingFeeStatus; createdByDisplayName: string; version: number; createdAt: string; updatedAt: string
}
export type ShippingFeeRule = {
  id: string; regionId: string; regionName: string; countryCode: string; name: string
  minimumWeightGrams: number; maximumWeightGrams?: number; baseFeeMinor: number; perKilogramFeeMinor: number
  otherFeeMinor: number; currencyCode: string; note?: string; status: ShippingFeeStatus
  createdByDisplayName: string; version: number; createdAt: string; updatedAt: string
}
export type ShippingFeeEstimate = {
  regionId: string; regionName: string; ruleId: string; ruleName: string
  actualWeightGrams: number; volumetricWeightGrams: number; chargeableWeightGrams: number
  shippingFeeMinor: number; otherFeeMinor: number; totalFeeMinor: number; currencyCode: string
}
export type ShippingFeePage<T> = { items: T[]; page: number; size: number; totalElements: number; totalPages: number }
export type RegionInput = { name: string; countryCode: string; city?: string; postalCodePrefix?: string; note?: string }
export type RuleInput = { regionId: string; name: string; minimumWeightGrams: number; maximumWeightGrams?: number; baseFeeMinor: number; perKilogramFeeMinor: number; otherFeeMinor: number; currencyCode: string; note?: string }
export type EstimateInput = { countryCode: string; city?: string; postalCode?: string; weightGrams: number; lengthMm?: number; widthMm?: number; heightMm?: number; volumetricDivisor?: number; weighingMode: 'ACTUAL' | 'VOLUMETRIC' | 'MAXIMUM' }

type Wire = Record<string, unknown>
function invalid(field: string): never { throw new ApiError('Invalid shipping fee response', { status: 502, code: 'invalid_response', details: { field } }) }
function record(value: unknown, field: string): Wire { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field); return value as Wire }
function exact(value: Wire, fields: readonly string[], field: string) { if (Object.keys(value).some((key) => !fields.includes(key)) || fields.some((key) => !(key in value))) invalid(`${field}.shape`) }
function text(value: unknown, field: string) { if (typeof value !== 'string' || !value.trim()) invalid(field); return value }
function optional(value: unknown, field: string) { return value === null ? undefined : text(value, field) }
function uuid(value: unknown, field: string) { const result = text(value, field); if (!UUID.test(result)) invalid(field); return result }
function integer(value: unknown, field: string) { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid(field); return value }
function time(value: unknown, field: string) { const result = text(value, field); if (Number.isNaN(Date.parse(result))) invalid(field); return result }
function status(value: unknown, field: string): ShippingFeeStatus { if (value !== 'ACTIVE' && value !== 'ARCHIVED') invalid(field); return value }

const regionFields = ['id', 'name', 'countryCode', 'city', 'postalCodePrefix', 'note', 'status', 'createdByDisplayName', 'version', 'createdAt', 'updatedAt'] as const
function region(value: unknown): ShippingFeeRegion {
  const wire = record(value, 'region'); exact(wire, regionFields, 'region')
  const countryCode = text(wire.countryCode, 'region.countryCode'); if (!/^[A-Z]{2}$/.test(countryCode)) invalid('region.countryCode')
  return { id: uuid(wire.id, 'region.id'), name: text(wire.name, 'region.name'), countryCode, city: optional(wire.city, 'region.city'), postalCodePrefix: optional(wire.postalCodePrefix, 'region.postalCodePrefix'), note: optional(wire.note, 'region.note'), status: status(wire.status, 'region.status'), createdByDisplayName: text(wire.createdByDisplayName, 'region.createdByDisplayName'), version: integer(wire.version, 'region.version'), createdAt: time(wire.createdAt, 'region.createdAt'), updatedAt: time(wire.updatedAt, 'region.updatedAt') }
}

const ruleFields = ['id', 'regionId', 'regionName', 'countryCode', 'name', 'minimumWeightGrams', 'maximumWeightGrams', 'baseFeeMinor', 'perKilogramFeeMinor', 'otherFeeMinor', 'currencyCode', 'note', 'status', 'createdByDisplayName', 'version', 'createdAt', 'updatedAt'] as const
function rule(value: unknown): ShippingFeeRule {
  const wire = record(value, 'rule'); exact(wire, ruleFields, 'rule')
  const maximum = wire.maximumWeightGrams === null ? undefined : integer(wire.maximumWeightGrams, 'rule.maximumWeightGrams')
  const currencyCode = text(wire.currencyCode, 'rule.currencyCode'); if (!/^[A-Z]{3}$/.test(currencyCode)) invalid('rule.currencyCode')
  return { id: uuid(wire.id, 'rule.id'), regionId: uuid(wire.regionId, 'rule.regionId'), regionName: text(wire.regionName, 'rule.regionName'), countryCode: text(wire.countryCode, 'rule.countryCode'), name: text(wire.name, 'rule.name'), minimumWeightGrams: integer(wire.minimumWeightGrams, 'rule.minimumWeightGrams'), maximumWeightGrams: maximum, baseFeeMinor: integer(wire.baseFeeMinor, 'rule.baseFeeMinor'), perKilogramFeeMinor: integer(wire.perKilogramFeeMinor, 'rule.perKilogramFeeMinor'), otherFeeMinor: integer(wire.otherFeeMinor, 'rule.otherFeeMinor'), currencyCode, note: optional(wire.note, 'rule.note'), status: status(wire.status, 'rule.status'), createdByDisplayName: text(wire.createdByDisplayName, 'rule.createdByDisplayName'), version: integer(wire.version, 'rule.version'), createdAt: time(wire.createdAt, 'rule.createdAt'), updatedAt: time(wire.updatedAt, 'rule.updatedAt') }
}

const estimateFields = ['regionId', 'regionName', 'ruleId', 'ruleName', 'actualWeightGrams', 'volumetricWeightGrams', 'chargeableWeightGrams', 'shippingFeeMinor', 'otherFeeMinor', 'totalFeeMinor', 'currencyCode'] as const
function estimate(value: unknown): ShippingFeeEstimate {
  const wire = record(value, 'estimate'); exact(wire, estimateFields, 'estimate')
  return { regionId: uuid(wire.regionId, 'estimate.regionId'), regionName: text(wire.regionName, 'estimate.regionName'), ruleId: uuid(wire.ruleId, 'estimate.ruleId'), ruleName: text(wire.ruleName, 'estimate.ruleName'), actualWeightGrams: integer(wire.actualWeightGrams, 'estimate.actualWeightGrams'), volumetricWeightGrams: integer(wire.volumetricWeightGrams, 'estimate.volumetricWeightGrams'), chargeableWeightGrams: integer(wire.chargeableWeightGrams, 'estimate.chargeableWeightGrams'), shippingFeeMinor: integer(wire.shippingFeeMinor, 'estimate.shippingFeeMinor'), otherFeeMinor: integer(wire.otherFeeMinor, 'estimate.otherFeeMinor'), totalFeeMinor: integer(wire.totalFeeMinor, 'estimate.totalFeeMinor'), currencyCode: text(wire.currencyCode, 'estimate.currencyCode') }
}

function page<T>(value: unknown, parser: (value: unknown) => T): ShippingFeePage<T> {
  const wire = record(value, 'page'); exact(wire, ['items', 'page', 'size', 'totalElements', 'totalPages'], 'page')
  if (!Array.isArray(wire.items)) invalid('page.items')
  const result = { items: wire.items.map(parser), page: integer(wire.page, 'page.page'), size: integer(wire.size, 'page.size'), totalElements: integer(wire.totalElements, 'page.totalElements'), totalPages: integer(wire.totalPages, 'page.totalPages') }
  if (result.size < 1 || result.items.length > result.size) invalid('page.size')
  return result
}

function query(statusValue: 'ALL' | 'ENABLED' | 'DISABLED', pageValue: number, size: number) {
  return new URLSearchParams({ status: statusValue, page: String(pageValue), size: String(size) })
}
function requestId() { return `shipping-fee.${crypto.randomUUID()}` }

export const shippingFeeApi = {
  async regions(input: { status: 'ALL' | 'ENABLED' | 'DISABLED'; keyword?: string; page: number; size: number; signal?: AbortSignal }) {
    const params = query(input.status, input.page, input.size); if (input.keyword?.trim()) params.set('keyword', input.keyword.trim().slice(0, 100))
    return page(await apiClient.request<unknown>(`${API_BASE}/regions?${params}`, { signal: input.signal }), region)
  },
  async rules(input: { status: 'ALL' | 'ENABLED' | 'DISABLED'; regionKeyword?: string; ruleKeyword?: string; page: number; size: number; signal?: AbortSignal }) {
    const params = query(input.status, input.page, input.size); if (input.regionKeyword?.trim()) params.set('regionKeyword', input.regionKeyword.trim().slice(0, 100)); if (input.ruleKeyword?.trim()) params.set('ruleKeyword', input.ruleKeyword.trim().slice(0, 100))
    return page(await apiClient.request<unknown>(`${API_BASE}/rules?${params}`, { signal: input.signal }), rule)
  },
  async createRegion(input: RegionInput) { return region(await apiClient.request<unknown>(`${API_BASE}/regions`, { method: 'POST', headers: { 'X-Request-Id': requestId() }, body: input })) },
  async createRule(input: RuleInput) { return rule(await apiClient.request<unknown>(`${API_BASE}/rules`, { method: 'POST', headers: { 'X-Request-Id': requestId() }, body: input })) },
  async archiveRegion(id: string, version: number) { return region(await apiClient.request<unknown>(`${API_BASE}/regions/${id}/archive`, { method: 'POST', headers: { 'X-Request-Id': requestId() }, body: { version } })) },
  async archiveRule(id: string, version: number) { return rule(await apiClient.request<unknown>(`${API_BASE}/rules/${id}/archive`, { method: 'POST', headers: { 'X-Request-Id': requestId() }, body: { version } })) },
  async estimate(input: EstimateInput) {
    const value = await apiClient.request<unknown>(`${API_BASE}/estimates`, { method: 'POST', body: input })
    if (!Array.isArray(value)) invalid('estimates')
    return value.map(estimate)
  },
}
