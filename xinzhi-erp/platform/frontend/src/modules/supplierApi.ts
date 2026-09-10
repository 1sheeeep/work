import { ApiError, apiClient } from '../api/client'
import {
  parseSupplierSkuMapping,
  type SupplierSkuMappingInput,
} from './supplierSkuMappingApi'

const API_BASE = '/api/v1/suppliers'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

export const supplierStatuses = ['ACTIVE', 'INACTIVE', 'ARCHIVED'] as const
export type SupplierStatus = (typeof supplierStatuses)[number]

export type Supplier = {
  id: string
  businessCode: string
  name: string
  status: SupplierStatus
  contactName: string | null
  contactPhone: string | null
  contactEmail: string | null
  address: string | null
  taxRegistrationNumber: string | null
  settlementCurrency: string | null
  paymentTermsDays: number | null
  notes: string | null
  createdAt: string
  updatedAt: string
  version: number
}

export type SupplierPage = {
  items: Supplier[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}

export type SupplierListRequest = {
  status?: SupplierStatus
  query?: string
  page: number
  size: number
  signal?: AbortSignal
}

export type SupplierCreateInput = {
  businessCode: string
  name: string
  contactName: string | null
  contactPhone: string | null
  contactEmail: string | null
  address: string | null
  taxRegistrationNumber: string | null
  settlementCurrency: string | null
  paymentTermsDays: number | null
  notes: string | null
}

export type SupplierUpdateInput = SupplierCreateInput & {
  status: SupplierStatus
  version: number
}

const supplierKeys = [
  'id', 'businessCode', 'name', 'status', 'contactName', 'contactPhone',
  'contactEmail', 'address', 'taxRegistrationNumber', 'settlementCurrency',
  'paymentTermsDays', 'notes', 'createdAt', 'updatedAt', 'version',
] as const

function invalidResponse(): never {
  throw new ApiError('服务返回了不符合供应商合同的数据。', {
    status: 502,
    code: 'invalid_response',
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function nullableBoundedString(value: unknown, maximum: number): value is string | null {
  return value === null || (typeof value === 'string' && value.length >= 1 &&
    value.length <= maximum && value === value.trim())
}

function nullableEmail(value: unknown): value is string | null {
  return value === null || (nullableBoundedString(value, 254) &&
    value === value.toLowerCase() && /^[^\s@]+@[^\s@]+$/.test(value))
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1
}

function validInstant(value: unknown): value is string {
  return typeof value === 'string' && INSTANT_PATTERN.test(value) && !Number.isNaN(Date.parse(value))
}

export function parseSupplier(value: unknown): Supplier {
  if (!isRecord(value) || !hasExactKeys(value, supplierKeys) ||
    typeof value.id !== 'string' || !UUID_PATTERN.test(value.id) ||
    typeof value.businessCode !== 'string' || !/^[A-Z][A-Z0-9_-]{1,63}$/.test(value.businessCode) ||
    typeof value.name !== 'string' || value.name.trim().length < 1 || value.name.length > 200 ||
    !supplierStatuses.includes(value.status as SupplierStatus) ||
    !nullableBoundedString(value.contactName, 120) ||
    !nullableBoundedString(value.contactPhone, 40) ||
    !nullableEmail(value.contactEmail) ||
    !nullableBoundedString(value.address, 500) ||
    !nullableBoundedString(value.taxRegistrationNumber, 120) ||
    !(value.settlementCurrency === null || (typeof value.settlementCurrency === 'string' && /^[A-Z]{3}$/.test(value.settlementCurrency))) ||
    !(value.paymentTermsDays === null || (nonNegativeInteger(value.paymentTermsDays) && value.paymentTermsDays <= 3650)) ||
    !nullableBoundedString(value.notes, 2000) ||
    !validInstant(value.createdAt) || !validInstant(value.updatedAt) ||
    Date.parse(value.updatedAt as string) < Date.parse(value.createdAt as string) ||
    !nonNegativeInteger(value.version)) return invalidResponse()

  return value as Supplier
}

export function parseSupplierPage(value: unknown): SupplierPage {
  if (!isRecord(value) || !hasExactKeys(value, ['items', 'page', 'size', 'totalElements', 'totalPages']) ||
    !Array.isArray(value.items) || !nonNegativeInteger(value.page) || !positiveInteger(value.size) ||
    !nonNegativeInteger(value.totalElements) || !nonNegativeInteger(value.totalPages)) return invalidResponse()
  const items = value.items.map(parseSupplier)
  if (items.length > value.size) return invalidResponse()
  return { items, page: value.page, size: value.size, totalElements: value.totalElements, totalPages: value.totalPages }
}

function listPath(request: SupplierListRequest) {
  const query = new URLSearchParams()
  if (request.status) query.set('status', request.status)
  if (request.query?.trim()) query.set('query', request.query.trim())
  query.set('page', String(request.page))
  query.set('size', String(request.size))
  return `${API_BASE}?${query.toString()}`
}

export function isSupplierId(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

function supplierPath(id: string) {
  if (!isSupplierId(id)) throw new ApiError('供应商标识格式无效。', { status: 400, code: 'invalid_supplier_id' })
  return `${API_BASE}/${encodeURIComponent(id)}`
}

export const supplierApi = {
  async list(request: SupplierListRequest) {
    return parseSupplierPage(await apiClient.request<unknown>(listPath(request), { signal: request.signal }))
  },
  async create(input: SupplierCreateInput) {
    return parseSupplier(await apiClient.request<unknown>(API_BASE, { method: 'POST', body: input }))
  },
  async importSuppliers(items: SupplierCreateInput[]) {
    const response = await apiClient.request<unknown>(`${API_BASE}/import`, { method: 'POST', body: { items } })
    if (!isRecord(response) || !hasExactKeys(response, ['createdCount', 'items']) ||
      !nonNegativeInteger(response.createdCount) || !Array.isArray(response.items)) return invalidResponse()
    const suppliers = response.items.map(parseSupplier)
    if (suppliers.length !== response.createdCount) return invalidResponse()
    return { createdCount: response.createdCount, items: suppliers }
  },
  async createWithMapping(input: { supplier: SupplierCreateInput; mapping: SupplierSkuMappingInput }) {
    const response = await apiClient.request<unknown>(`${API_BASE}/with-sku-mapping`, { method: 'POST', body: input })
    if (!isRecord(response) || !hasExactKeys(response, ['supplier', 'mapping'])) return invalidResponse()
    return { supplier: parseSupplier(response.supplier), mapping: parseSupplierSkuMapping(response.mapping) }
  },
  async get(id: string, signal?: AbortSignal) {
    const supplier = parseSupplier(await apiClient.request<unknown>(supplierPath(id), { signal }))
    if (supplier.id.toLowerCase() !== id.toLowerCase()) return invalidResponse()
    return supplier
  },
  async update(id: string, input: SupplierUpdateInput) {
    return parseSupplier(await apiClient.request<unknown>(supplierPath(id), { method: 'PUT', body: input }))
  },
}
