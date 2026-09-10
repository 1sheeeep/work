import { ApiError, apiClient } from '../api/client'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

export const supplierSkuMappingStatuses = ['ACTIVE', 'INACTIVE'] as const
export type SupplierSkuMappingStatus = (typeof supplierSkuMappingStatuses)[number]

export type SupplierSkuMapping = {
  id: string
  supplierId: string
  skuId: string
  supplierSkuCode: string | null
  status: SupplierSkuMappingStatus
  preferred: boolean
  leadTimeDays: number | null
  unitPrice: number | null
  currencyCode: string | null
  minimumOrderQuantity: number | null
  skuBusinessCode: string
  skuName: string
  createdAt: string
  updatedAt: string
  version: number
}

export type SupplierSkuMappingPage = { items: SupplierSkuMapping[]; page: number; size: number; totalElements: number; totalPages: number }
export type PreferredSupplierSkuSummary = { skuId: string; supplierSkuCode: string | null; supplierId: string; supplierBusinessCode: string; supplierName: string }
export type SupplierSkuMappingInput = { skuId: string; supplierSkuCode: string | null; status: SupplierSkuMappingStatus; preferred: boolean; leadTimeDays: number | null; unitPrice: number | null; currencyCode: string | null; minimumOrderQuantity: number | null }
export type SupplierSkuMappingUpdateInput = SupplierSkuMappingInput & { version: number }
export type SupplierSkuMappingListRequest = { status?: SupplierSkuMappingStatus; query?: string; page: number; size: number; signal?: AbortSignal }

const mappingKeys = ['id', 'supplierId', 'skuId', 'supplierSkuCode', 'status', 'preferred', 'leadTimeDays', 'unitPrice', 'currencyCode', 'minimumOrderQuantity', 'skuBusinessCode', 'skuName', 'createdAt', 'updatedAt', 'version'] as const

function invalidResponse(): never {
  throw new ApiError('服务返回了不符合供应商 SKU 关系合同的数据。', { status: 502, code: 'invalid_response' })
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype }
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) { const actual = Object.keys(value).sort(); const expected = [...keys].sort(); return actual.length === expected.length && actual.every((key, index) => key === expected[index]) }
function isUuid(value: unknown): value is string { return typeof value === 'string' && UUID_PATTERN.test(value) }
function nonNegativeInteger(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0 }
function positiveInteger(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 1 }
function validInstant(value: unknown): value is string { return typeof value === 'string' && INSTANT_PATTERN.test(value) && !Number.isNaN(Date.parse(value)) }
function nullableTrimmedString(value: unknown, maximum: number): value is string | null { return value === null || (typeof value === 'string' && value.length >= 1 && value.length <= maximum && value === value.trim()) }

export function parseSupplierSkuMapping(value: unknown): SupplierSkuMapping {
  if (!isRecord(value) || !hasExactKeys(value, mappingKeys) || !isUuid(value.id) || !isUuid(value.supplierId) || !isUuid(value.skuId) ||
    !nullableTrimmedString(value.supplierSkuCode, 120) || !supplierSkuMappingStatuses.includes(value.status as SupplierSkuMappingStatus) ||
    typeof value.preferred !== 'boolean' || !(value.leadTimeDays === null || (nonNegativeInteger(value.leadTimeDays) && value.leadTimeDays <= 3650)) ||
    !(value.unitPrice === null || (typeof value.unitPrice === 'number' && Number.isFinite(value.unitPrice) && value.unitPrice > 0)) ||
    !(value.currencyCode === null || (typeof value.currencyCode === 'string' && /^[A-Z]{3}$/.test(value.currencyCode))) ||
    ((value.unitPrice === null) !== (value.currencyCode === null)) ||
    !(value.minimumOrderQuantity === null || (positiveInteger(value.minimumOrderQuantity) && value.minimumOrderQuantity <= 1_000_000_000)) ||
    typeof value.skuBusinessCode !== 'string' || !/^[A-Z][A-Z0-9_-]{1,63}$/.test(value.skuBusinessCode) ||
    typeof value.skuName !== 'string' || value.skuName.trim().length < 1 || value.skuName.length > 200 ||
    !validInstant(value.createdAt) || !validInstant(value.updatedAt) || Date.parse(value.updatedAt) < Date.parse(value.createdAt) || !nonNegativeInteger(value.version)) return invalidResponse()
  return value as SupplierSkuMapping
}

export function parseSupplierSkuMappingPage(value: unknown): SupplierSkuMappingPage {
  if (!isRecord(value) || !hasExactKeys(value, ['items', 'page', 'size', 'totalElements', 'totalPages']) || !Array.isArray(value.items) ||
    !nonNegativeInteger(value.page) || !positiveInteger(value.size) || !nonNegativeInteger(value.totalElements) || !nonNegativeInteger(value.totalPages)) return invalidResponse()
  const items = value.items.map(parseSupplierSkuMapping)
  if (items.length > value.size) return invalidResponse()
  return { items, page: value.page, size: value.size, totalElements: value.totalElements, totalPages: value.totalPages }
}

function validatedSupplierId(value: string) { if (!isUuid(value)) throw new ApiError('供应商标识格式无效。', { status: 400, code: 'invalid_supplier_id' }); return encodeURIComponent(value) }
function basePath(supplierId: string) { return `/api/v1/suppliers/${validatedSupplierId(supplierId)}/sku-mappings` }
function listPath(supplierId: string, request: SupplierSkuMappingListRequest) { const query = new URLSearchParams(); if (request.status) query.set('status', request.status); if (request.query?.trim()) query.set('query', request.query.trim()); query.set('page', String(request.page)); query.set('size', String(request.size)); return `${basePath(supplierId)}?${query.toString()}` }
function preferredSummaryPath(skuIds: string[]) { const unique = [...new Set(skuIds)]; if (unique.length < 1 || unique.length > 50 || unique.length !== skuIds.length || unique.some((id) => !isUuid(id))) throw new ApiError('首选供应商查询参数无效。', { status: 400, code: 'invalid_request' }); const query = new URLSearchParams(); unique.forEach((id) => query.append('skuId', id)); return `/api/v1/suppliers/preferred-sku-summaries?${query.toString()}` }
function parsePreferred(value: unknown): PreferredSupplierSkuSummary { if (!isRecord(value) || !hasExactKeys(value, ['skuId', 'supplierSkuCode', 'supplierId', 'supplierBusinessCode', 'supplierName']) || !isUuid(value.skuId) || !nullableTrimmedString(value.supplierSkuCode, 120) || !isUuid(value.supplierId) || typeof value.supplierBusinessCode !== 'string' || !/^[A-Z][A-Z0-9_-]{1,63}$/.test(value.supplierBusinessCode) || typeof value.supplierName !== 'string' || value.supplierName.trim().length < 1 || value.supplierName.length > 200) return invalidResponse(); return value as PreferredSupplierSkuSummary }

export const supplierSkuMappingApi = {
  async listPreferredSummaries(skuIds: string[]) { const response = await apiClient.request<unknown>(preferredSummaryPath(skuIds)); if (!isRecord(response) || !hasExactKeys(response, ['items']) || !Array.isArray(response.items) || response.items.length > skuIds.length) return invalidResponse(); const items = response.items.map(parsePreferred); const requested = new Set(skuIds); const returned = new Set<string>(); for (const item of items) { if (!requested.has(item.skuId) || returned.has(item.skuId)) return invalidResponse(); returned.add(item.skuId) } return items },
  async list(supplierId: string, request: SupplierSkuMappingListRequest) { return parseSupplierSkuMappingPage(await apiClient.request<unknown>(listPath(supplierId, request), { signal: request.signal })) },
  async create(supplierId: string, input: SupplierSkuMappingInput) { return parseSupplierSkuMapping(await apiClient.request<unknown>(basePath(supplierId), { method: 'POST', body: input })) },
  async update(supplierId: string, mappingId: string, input: SupplierSkuMappingUpdateInput) { if (!isUuid(mappingId)) throw new ApiError('供应关系标识格式无效。', { status: 400, code: 'invalid_mapping_id' }); return parseSupplierSkuMapping(await apiClient.request<unknown>(`${basePath(supplierId)}/${encodeURIComponent(mappingId)}`, { method: 'PUT', body: input })) },
}
