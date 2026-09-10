import { ApiError, apiClient } from '../api/client'

const API_BASE = '/api/v1/logistics/addresses'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type LogisticsAddressType = 'RECEIVING_TRANSIT' | 'PLATFORM_SHIPPING' | 'SHIPPING'
export type LogisticsAddressStatus = 'ACTIVE' | 'ARCHIVED'
export type LogisticsAddressSummary = {
  id: string
  addressType: LogisticsAddressType
  name: string
  contactName: string
  countryCode: string
  province?: string
  city?: string
  district?: string
  addressLine1: string
  status: LogisticsAddressStatus
  version: number
  updatedAt: string
}
export type LogisticsAddressDetail = LogisticsAddressSummary & {
  contactEmail?: string
  postalCode?: string
  landline?: string
  mobile?: string
  companyName?: string
  fax?: string
  createdAt: string
}
export type LogisticsAddressInput = {
  addressType: LogisticsAddressType
  name: string
  contactName: string
  contactEmail?: string
  countryCode: string
  province?: string
  city?: string
  district?: string
  addressLine1: string
  postalCode?: string
  landline?: string
  mobile?: string
  companyName?: string
  fax?: string
}
export type LogisticsAddressPage = {
  items: LogisticsAddressSummary[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}

type Wire = Record<string, unknown>
function invalid(field: string): never {
  throw new ApiError('Invalid logistics address response', {
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
function addressType(value: unknown, field: string): LogisticsAddressType {
  const result = text(value, field)
  if (!['RECEIVING_TRANSIT', 'PLATFORM_SHIPPING', 'SHIPPING'].includes(result)) invalid(field)
  return result as LogisticsAddressType
}
function status(value: unknown, field: string): LogisticsAddressStatus {
  const result = text(value, field)
  if (!['ACTIVE', 'ARCHIVED'].includes(result)) invalid(field)
  return result as LogisticsAddressStatus
}

const summaryFields = [
  'id', 'addressType', 'name', 'contactName', 'countryCode', 'province',
  'city', 'district', 'addressLine1', 'status', 'version', 'updatedAt',
] as const
function summary(value: unknown): LogisticsAddressSummary {
  const wire = record(value, 'address')
  exact(wire, summaryFields, 'address')
  const countryCode = text(wire.countryCode, 'address.countryCode')
  if (!/^[A-Z]{2}$/.test(countryCode)) invalid('address.countryCode')
  return {
    id: uuid(wire.id, 'address.id'),
    addressType: addressType(wire.addressType, 'address.addressType'),
    name: text(wire.name, 'address.name'),
    contactName: text(wire.contactName, 'address.contactName'),
    countryCode,
    province: optionalText(wire.province, 'address.province'),
    city: optionalText(wire.city, 'address.city'),
    district: optionalText(wire.district, 'address.district'),
    addressLine1: text(wire.addressLine1, 'address.addressLine1'),
    status: status(wire.status, 'address.status'),
    version: integer(wire.version, 'address.version'),
    updatedAt: timestamp(wire.updatedAt, 'address.updatedAt'),
  }
}

const detailFields = [
  'id', 'addressType', 'name', 'contactName', 'contactEmail', 'countryCode',
  'province', 'city', 'district', 'addressLine1', 'postalCode', 'landline',
  'mobile', 'companyName', 'fax', 'status', 'version', 'createdAt', 'updatedAt',
] as const
function detail(value: unknown): LogisticsAddressDetail {
  const wire = record(value, 'addressDetail')
  exact(wire, detailFields, 'addressDetail')
  const countryCode = text(wire.countryCode, 'addressDetail.countryCode')
  if (!/^[A-Z]{2}$/.test(countryCode)) invalid('addressDetail.countryCode')
  return {
    id: uuid(wire.id, 'addressDetail.id'),
    addressType: addressType(wire.addressType, 'addressDetail.addressType'),
    name: text(wire.name, 'addressDetail.name'),
    contactName: text(wire.contactName, 'addressDetail.contactName'),
    contactEmail: optionalText(wire.contactEmail, 'addressDetail.contactEmail'),
    countryCode,
    province: optionalText(wire.province, 'addressDetail.province'),
    city: optionalText(wire.city, 'addressDetail.city'),
    district: optionalText(wire.district, 'addressDetail.district'),
    addressLine1: text(wire.addressLine1, 'addressDetail.addressLine1'),
    postalCode: optionalText(wire.postalCode, 'addressDetail.postalCode'),
    landline: optionalText(wire.landline, 'addressDetail.landline'),
    mobile: optionalText(wire.mobile, 'addressDetail.mobile'),
    companyName: optionalText(wire.companyName, 'addressDetail.companyName'),
    fax: optionalText(wire.fax, 'addressDetail.fax'),
    status: status(wire.status, 'addressDetail.status'),
    version: integer(wire.version, 'addressDetail.version'),
    createdAt: timestamp(wire.createdAt, 'addressDetail.createdAt'),
    updatedAt: timestamp(wire.updatedAt, 'addressDetail.updatedAt'),
  }
}

function validateIdVersion(id: string, version?: number) {
  if (!UUID.test(id) || (version != null
    && (!Number.isSafeInteger(version) || version < 0))) {
    throw new ApiError('Invalid logistics address request', {
      status: 400, code: 'invalid_request',
    })
  }
}

export const logisticsAddressApi = {
  async list(request: {
    type?: LogisticsAddressType
    status?: 'ALL' | LogisticsAddressStatus
    keyword?: string
    page: number
    size: number
    signal?: AbortSignal
  }): Promise<LogisticsAddressPage> {
    if (!Number.isSafeInteger(request.page) || request.page < 0
      || !Number.isSafeInteger(request.size) || request.size < 1 || request.size > 200) {
      throw new ApiError('Invalid logistics address request', { status: 400, code: 'invalid_request' })
    }
    const query = new URLSearchParams({ page: String(request.page), size: String(request.size) })
    if (request.type) query.set('type', request.type)
    if (request.status) query.set('status', request.status)
    if (request.keyword?.trim()) query.set('keyword', request.keyword.trim().slice(0, 120))
    const wire = record(await apiClient.request<unknown>(`${API_BASE}?${query}`, {
      signal: request.signal,
    }), 'page')
    exact(wire, ['items', 'page', 'size', 'totalElements', 'totalPages'], 'page')
    if (!Array.isArray(wire.items)) invalid('page.items')
    const result = {
      items: wire.items.map(summary), page: integer(wire.page, 'page.page'),
      size: integer(wire.size, 'page.size'),
      totalElements: integer(wire.totalElements, 'page.totalElements'),
      totalPages: integer(wire.totalPages, 'page.totalPages'),
    }
    const expectedPages = result.totalElements === 0 ? 0 : Math.ceil(result.totalElements / result.size)
    if (result.page !== request.page || result.size !== request.size
      || result.totalPages !== expectedPages || result.items.length > result.size
      || new Set(result.items.map((item) => item.id)).size !== result.items.length) invalid('page.contract')
    return result
  },

  async detail(id: string): Promise<LogisticsAddressDetail> {
    validateIdVersion(id)
    return detail(await apiClient.request<unknown>(`${API_BASE}/${id}`))
  },

  async create(input: LogisticsAddressInput): Promise<LogisticsAddressDetail> {
    return detail(await apiClient.request<unknown>(API_BASE, {
      method: 'POST', body: input,
    }))
  },

  async update(id: string, version: number, input: LogisticsAddressInput): Promise<LogisticsAddressDetail> {
    validateIdVersion(id, version)
    return detail(await apiClient.request<unknown>(`${API_BASE}/${id}`, {
      method: 'PUT', body: { version, address: input },
    }))
  },

  async archive(id: string, version: number): Promise<LogisticsAddressDetail> {
    validateIdVersion(id, version)
    return detail(await apiClient.request<unknown>(`${API_BASE}/${id}/archive`, {
      method: 'POST', body: { version },
    }))
  },
}
