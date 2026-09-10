import { ApiError, apiClient } from '../api/client'

const BASE = '/api/v1/settings/address-mappings'
export type AddressMappingPlatform = 'SHOPIFY'
export type AddressMappingType = 'PROVINCE' | 'CITY'

export type AddressMappingSetting = {
  configured: boolean
  enabled: boolean
  version: number
  updatedByDisplayName?: string
  createdAt?: string
  updatedAt?: string
}

export type AddressMapping = {
  id: string
  platform: AddressMappingPlatform
  countryCode: string
  addressType: AddressMappingType
  sourceValue: string
  mappedValue: string
  enabled: boolean
  version: number
  updatedByDisplayName: string
  createdAt: string
  updatedAt: string
}

export type AddressMappingInput = Omit<AddressMapping,
  'id' | 'version' | 'updatedByDisplayName' | 'createdAt' | 'updatedAt'>

export type AddressMappingQuery = {
  platform?: AddressMappingPlatform
  countryCode?: string
  addressType?: AddressMappingType
  keyword?: string
  page?: number
  size?: 25 | 50 | 100
}

export type AddressMappingPage = {
  items: AddressMapping[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}

const SETTING_FIELDS = ['configured', 'enabled', 'version',
  'updatedByDisplayName', 'createdAt', 'updatedAt'] as const
const MAPPING_FIELDS = ['id', 'platform', 'countryCode', 'addressType',
  'sourceValue', 'mappedValue', 'enabled', 'version', 'updatedByDisplayName',
  'createdAt', 'updatedAt'] as const
const PAGE_FIELDS = ['items', 'page', 'size', 'totalElements', 'totalPages'] as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function invalid(field: string): never {
  throw new ApiError('Invalid address mapping response', {
    status: 502, code: 'invalid_response', details: { field },
  })
}

function object(value: unknown, fields: readonly string[], field: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field)
  const wire = value as Record<string, unknown>
  if (Object.keys(wire).some((key) => !fields.includes(key))
    || fields.some((key) => !(key in wire))) invalid(`${field}.shape`)
  return wire
}

function integer(value: unknown, field: string, min = 0) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) invalid(field)
  return value
}

function text(value: unknown, field: string, max: number) {
  if (typeof value !== 'string' || !value.trim()
    || value !== value.trim() || value.length > max) invalid(field)
  return value
}

function timestamp(value: unknown, field: string) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) invalid(field)
  return value
}

function parseSetting(value: unknown): AddressMappingSetting {
  const wire = object(value, SETTING_FIELDS, 'setting')
  if (typeof wire.configured !== 'boolean' || typeof wire.enabled !== 'boolean') invalid('setting.flags')
  const version = integer(wire.version, 'setting.version')
  if (!wire.configured) {
    if (wire.enabled || version !== 0 || wire.updatedByDisplayName != null
      || wire.createdAt != null || wire.updatedAt != null) invalid('setting.unconfigured')
    return { configured: false, enabled: false, version: 0 }
  }
  return {
    configured: true, enabled: wire.enabled, version,
    updatedByDisplayName: text(wire.updatedByDisplayName, 'setting.updatedByDisplayName', 160),
    createdAt: timestamp(wire.createdAt, 'setting.createdAt'),
    updatedAt: timestamp(wire.updatedAt, 'setting.updatedAt'),
  }
}

function parseMapping(value: unknown): AddressMapping {
  const wire = object(value, MAPPING_FIELDS, 'mapping')
  if (typeof wire.id !== 'string' || !UUID.test(wire.id)
    || wire.platform !== 'SHOPIFY'
    || !['PROVINCE', 'CITY'].includes(String(wire.addressType))
    || typeof wire.countryCode !== 'string' || !/^[A-Z]{2}$/.test(wire.countryCode)
    || typeof wire.enabled !== 'boolean') invalid('mapping.fields')
  return {
    id: wire.id, platform: wire.platform,
    countryCode: wire.countryCode,
    addressType: wire.addressType as AddressMappingType,
    sourceValue: text(wire.sourceValue, 'mapping.sourceValue', 120),
    mappedValue: text(wire.mappedValue, 'mapping.mappedValue', 120),
    enabled: wire.enabled,
    version: integer(wire.version, 'mapping.version'),
    updatedByDisplayName: text(wire.updatedByDisplayName, 'mapping.updatedByDisplayName', 160),
    createdAt: timestamp(wire.createdAt, 'mapping.createdAt'),
    updatedAt: timestamp(wire.updatedAt, 'mapping.updatedAt'),
  }
}

function parsePage(value: unknown): AddressMappingPage {
  const wire = object(value, PAGE_FIELDS, 'page')
  if (!Array.isArray(wire.items)) invalid('page.items')
  const page = integer(wire.page, 'page.page')
  const size = integer(wire.size, 'page.size', 1)
  const totalElements = integer(wire.totalElements, 'page.totalElements')
  const totalPages = integer(wire.totalPages, 'page.totalPages')
  if (totalPages !== (totalElements === 0 ? 0 : Math.ceil(totalElements / size))
    || (totalPages > 0 && page >= totalPages)) invalid('page.pagination')
  return { items: wire.items.map(parseMapping), page, size, totalElements, totalPages }
}

function normalizeInput(source: AddressMappingInput): AddressMappingInput {
  const countryCode = source.countryCode.trim().toUpperCase()
  const sourceValue = source.sourceValue.trim()
  const mappedValue = source.mappedValue.trim()
  if (source.platform !== 'SHOPIFY'
    || !['PROVINCE', 'CITY'].includes(source.addressType)
    || !/^[A-Z]{2}$/.test(countryCode)
    || !sourceValue || sourceValue.length > 120
    || !mappedValue || mappedValue.length > 120) {
    throw new ApiError('Invalid address mapping request', {
      status: 400, code: 'invalid_request',
    })
  }
  return { ...source, countryCode, sourceValue, mappedValue }
}

function requestId() {
  return `settings-address.${crypto.randomUUID()}`
}

function validateExpectedVersion(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ApiError('Invalid address mapping version', {
      status: 400, code: 'invalid_request',
    })
  }
  return value
}

export const addressMappingApi = {
  async getSetting(signal?: AbortSignal) {
    return parseSetting(await apiClient.request<unknown>(`${BASE}/config`, { signal }))
  },
  async saveSetting(expectedVersion: number, enabled: boolean) {
    expectedVersion = validateExpectedVersion(expectedVersion)
    return parseSetting(await apiClient.request<unknown>(`${BASE}/config`, {
      method: 'PUT', body: { expectedVersion, enabled },
      headers: { 'X-Request-Id': requestId() },
    }))
  },
  async list(query: AddressMappingQuery, signal?: AbortSignal) {
    const params = new URLSearchParams()
    if (query.platform) params.set('platform', query.platform)
    if (query.countryCode) params.set('countryCode', query.countryCode.trim().toUpperCase())
    if (query.addressType) params.set('addressType', query.addressType)
    if (query.keyword) params.set('keyword', query.keyword.trim().slice(0, 120))
    params.set('page', String(query.page ?? 0))
    params.set('size', String(query.size ?? 25))
    return parsePage(await apiClient.request<unknown>(`${BASE}?${params}`, { signal }))
  },
  async create(input: AddressMappingInput) {
    return parseMapping(await apiClient.request<unknown>(BASE, {
      method: 'POST', body: normalizeInput(input),
      headers: { 'X-Request-Id': requestId() },
    }))
  },
  async update(id: string, expectedVersion: number, input: AddressMappingInput) {
    if (!UUID.test(id)) throw new ApiError('Invalid address mapping id', { status: 400, code: 'invalid_request' })
    expectedVersion = validateExpectedVersion(expectedVersion)
    return parseMapping(await apiClient.request<unknown>(`${BASE}/${id}`, {
      method: 'PUT', body: { expectedVersion, ...normalizeInput(input) },
      headers: { 'X-Request-Id': requestId() },
    }))
  },
  async remove(id: string, expectedVersion: number) {
    if (!UUID.test(id)) throw new ApiError('Invalid address mapping id', { status: 400, code: 'invalid_request' })
    expectedVersion = validateExpectedVersion(expectedVersion)
    await apiClient.request<unknown>(`${BASE}/${id}?expectedVersion=${expectedVersion}`, {
      method: 'DELETE', headers: { 'X-Request-Id': requestId() },
    })
  },
}
