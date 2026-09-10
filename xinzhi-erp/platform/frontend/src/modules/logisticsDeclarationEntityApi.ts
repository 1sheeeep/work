import { ApiError, apiClient } from '../api/client'

const API_BASE = '/api/v1/logistics/declaration-entities'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type DeclarationEntityStatus = 'ACTIVE' | 'ARCHIVED'
export type DeclarationSearchField = 'NAME' | 'CODE' | 'PLATFORM' | 'SHOP'
export type DeclarationShop = {
  shopId: string
  shopName: string
  shopStatus: string
  platformCode: string
  platformName: string
}
export type DeclarationEntity = {
  id: string
  name: string
  enterpriseCode: string
  shops: DeclarationShop[]
  status: DeclarationEntityStatus
  version: number
  createdAt: string
  updatedAt: string
}
export type DeclarationEntityInput = {
  name: string
  enterpriseCode: string
  shopIds: string[]
}
export type DeclarationShopOption = {
  id: string
  name: string
  status: string
  platformCode: string
  platformName: string
}
export type DeclarationEntityPage = {
  items: DeclarationEntity[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}
export type DeclarationShopOptionPage = {
  items: DeclarationShopOption[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}

type Wire = Record<string, unknown>
function invalid(field: string): never {
  throw new ApiError('Invalid logistics declaration entity response', {
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
function entityStatus(value: unknown, field: string): DeclarationEntityStatus {
  const result = text(value, field)
  if (result !== 'ACTIVE' && result !== 'ARCHIVED') invalid(field)
  return result as DeclarationEntityStatus
}
function shop(value: unknown, field: string): DeclarationShop {
  const wire = record(value, field)
  exact(wire, ['shopId', 'shopName', 'shopStatus', 'platformCode', 'platformName'], field)
  return {
    shopId: uuid(wire.shopId, `${field}.shopId`),
    shopName: text(wire.shopName, `${field}.shopName`),
    shopStatus: text(wire.shopStatus, `${field}.shopStatus`),
    platformCode: text(wire.platformCode, `${field}.platformCode`),
    platformName: text(wire.platformName, `${field}.platformName`),
  }
}
function shopOption(value: unknown, field: string): DeclarationShopOption {
  const wire = record(value, field)
  exact(wire, ['id', 'name', 'status', 'platformCode', 'platformName'], field)
  const status = text(wire.status, `${field}.status`)
  if (status !== 'ACTIVE' && status !== 'SUSPENDED') invalid(`${field}.status`)
  return {
    id: uuid(wire.id, `${field}.id`), name: text(wire.name, `${field}.name`),
    status,
    platformCode: text(wire.platformCode, `${field}.platformCode`),
    platformName: text(wire.platformName, `${field}.platformName`),
  }
}
function entity(value: unknown): DeclarationEntity {
  const wire = record(value, 'entity')
  exact(wire, [
    'id', 'name', 'enterpriseCode', 'shops', 'status', 'version',
    'createdAt', 'updatedAt',
  ], 'entity')
  if (!Array.isArray(wire.shops)) invalid('entity.shops')
  const shops = wire.shops.map((item, index) => shop(item, `entity.shops.${index}`))
  if (new Set(shops.map((item) => item.shopId)).size !== shops.length) {
    invalid('entity.shops.duplicates')
  }
  const enterpriseCode = text(wire.enterpriseCode, 'entity.enterpriseCode')
  if (!/^[A-Z0-9][A-Z0-9._:/ -]{0,99}$/.test(enterpriseCode)) {
    invalid('entity.enterpriseCode')
  }
  return {
    id: uuid(wire.id, 'entity.id'), name: text(wire.name, 'entity.name'),
    enterpriseCode, shops, status: entityStatus(wire.status, 'entity.status'),
    version: integer(wire.version, 'entity.version'),
    createdAt: timestamp(wire.createdAt, 'entity.createdAt'),
    updatedAt: timestamp(wire.updatedAt, 'entity.updatedAt'),
  }
}
function page<T>(
  value: unknown, requestPage: number, requestSize: number,
  itemParser: (item: unknown, field: string) => T,
): { items: T[]; page: number; size: number; totalElements: number; totalPages: number } {
  const wire = record(value, 'page')
  exact(wire, ['items', 'page', 'size', 'totalElements', 'totalPages'], 'page')
  if (!Array.isArray(wire.items)) invalid('page.items')
  const result = {
    items: wire.items.map((item, index) => itemParser(item, `page.items.${index}`)),
    page: integer(wire.page, 'page.page'), size: integer(wire.size, 'page.size'),
    totalElements: integer(wire.totalElements, 'page.totalElements'),
    totalPages: integer(wire.totalPages, 'page.totalPages'),
  }
  const expectedPages = result.totalElements === 0 ? 0
    : Math.ceil(result.totalElements / result.size)
  if (result.page !== requestPage || result.size !== requestSize
    || result.totalPages !== expectedPages || result.items.length > result.size) {
    invalid('page.contract')
  }
  return result
}
function validatePage(pageValue: number, size: number) {
  if (!Number.isSafeInteger(pageValue) || pageValue < 0
    || !Number.isSafeInteger(size) || size < 1 || size > 200) {
    throw new ApiError('Invalid logistics declaration entity request', {
      status: 400, code: 'invalid_request',
    })
  }
}
function validateIdVersion(id: string, version?: number) {
  if (!UUID.test(id) || (version != null
    && (!Number.isSafeInteger(version) || version < 0))) {
    throw new ApiError('Invalid logistics declaration entity request', {
      status: 400, code: 'invalid_request',
    })
  }
}
function validateInput(input: DeclarationEntityInput) {
  if (!input.name.trim() || input.name.trim().length > 200
    || !/^[A-Z0-9][A-Z0-9._:/ -]{0,99}$/.test(input.enterpriseCode)
    || input.shopIds.length > 100
    || new Set(input.shopIds).size !== input.shopIds.length
    || input.shopIds.some((id) => !UUID.test(id))) {
    throw new ApiError('Invalid logistics declaration entity request', {
      status: 400, code: 'invalid_request',
    })
  }
}

export const logisticsDeclarationEntityApi = {
  async list(request: {
    status: 'ALL' | DeclarationEntityStatus
    searchField: DeclarationSearchField
    keyword?: string
    page: number
    size: number
    signal?: AbortSignal
  }): Promise<DeclarationEntityPage> {
    validatePage(request.page, request.size)
    const query = new URLSearchParams({
      status: request.status, searchField: request.searchField,
      page: String(request.page), size: String(request.size),
    })
    if (request.keyword?.trim()) query.set('keyword', request.keyword.trim().slice(0, 120))
    const result = page(await apiClient.request<unknown>(`${API_BASE}?${query}`, {
      signal: request.signal,
    }), request.page, request.size, (item) => entity(item))
    if (new Set(result.items.map((item) => item.id)).size !== result.items.length) {
      invalid('page.items.duplicates')
    }
    return result
  },

  async shopOptions(request: {
    keyword?: string
    page: number
    size: number
    signal?: AbortSignal
  }): Promise<DeclarationShopOptionPage> {
    validatePage(request.page, request.size)
    const query = new URLSearchParams({ page: String(request.page), size: String(request.size) })
    if (request.keyword?.trim()) query.set('keyword', request.keyword.trim().slice(0, 120))
    const result = page(await apiClient.request<unknown>(`${API_BASE}/shop-options?${query}`, {
      signal: request.signal,
    }), request.page, request.size, shopOption)
    if (new Set(result.items.map((item) => item.id)).size !== result.items.length) {
      invalid('page.items.duplicates')
    }
    return result
  },

  async detail(id: string): Promise<DeclarationEntity> {
    validateIdVersion(id)
    return entity(await apiClient.request<unknown>(`${API_BASE}/${id}`))
  },

  async create(input: DeclarationEntityInput): Promise<DeclarationEntity> {
    validateInput(input)
    return entity(await apiClient.request<unknown>(API_BASE, {
      method: 'POST', body: input,
    }))
  },

  async update(id: string, version: number, input: DeclarationEntityInput): Promise<DeclarationEntity> {
    validateIdVersion(id, version); validateInput(input)
    return entity(await apiClient.request<unknown>(`${API_BASE}/${id}`, {
      method: 'PUT', body: { version, entity: input },
    }))
  },

  async archive(id: string, version: number): Promise<DeclarationEntity> {
    validateIdVersion(id, version)
    return entity(await apiClient.request<unknown>(`${API_BASE}/${id}/archive`, {
      method: 'POST', body: { version },
    }))
  },
}
