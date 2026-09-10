import { ApiError, apiClient } from '../api/client'

const API_BASE = '/api/v1/analytics/store-health'

export const STORE_AUTHORIZATION_STATUSES = [
  'NOT_REQUIRED', 'NOT_AUTHORIZED', 'PENDING', 'AUTHORIZED', 'EXPIRED', 'REVOKED', 'ERROR',
] as const

export type StoreAuthorizationStatus = typeof STORE_AUTHORIZATION_STATUSES[number]
export type StoreHealthPlatform = { code: string; displayName: string }
export type StoreHealthSync = {
  jobType: 'FULL' | 'ORDERS' | 'PRODUCTS' | 'INVENTORY'
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED'
  progressProcessed: number
  progressTotal?: number
  attemptCount: number
  safeErrorSummary?: string
  requestedAt: string
  completedAt?: string
}
export type StoreHealthItem = {
  shopId: string
  platformCode: string
  platformName: string
  shopName: string
  externalShopRef: string
  shopStatus: 'ACTIVE' | 'SUSPENDED'
  authorizationStatus: StoreAuthorizationStatus
  scopes: string[]
  lastVerifiedAt?: string
  updatedAt: string
  latestSync?: StoreHealthSync
}
export type StoreHealthPage = {
  items: StoreHealthItem[]
  platforms: StoreHealthPlatform[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}
export type StoreHealthRequest = {
  query?: string
  platform?: string
  authorizationStatus?: StoreAuthorizationStatus
  page: number
  size: number
  signal?: AbortSignal
}

type Wire = Record<string, unknown>
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const instantPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/
const shopStatuses = ['ACTIVE', 'SUSPENDED'] as const
const syncTypes = ['FULL', 'ORDERS', 'PRODUCTS', 'INVENTORY'] as const
const syncStatuses = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'] as const

function invalid(field: string): never {
  throw new ApiError('Invalid store health response', { status: 502, code: 'invalid_response', details: { field } })
}
function record(value: unknown, field: string): Wire { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field); return value as Wire }
function exact(value: Wire, fields: readonly string[], field: string) { if (Object.keys(value).some((key) => !fields.includes(key)) || fields.some((key) => !(key in value))) invalid(`${field}.shape`) }
function text(value: unknown, field: string, max: number) { if (typeof value !== 'string' || !value.trim() || value.length > max) invalid(field); return value }
function integer(value: unknown, field: string) { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid(field); return value }
function optionalInstant(value: unknown, field: string) { if (value == null) return undefined; if (typeof value !== 'string' || !instantPattern.test(value) || Number.isNaN(Date.parse(value))) invalid(field); return value }
function oneOf<T extends string>(value: unknown, values: readonly T[], field: string): T { if (!values.includes(value as T)) invalid(field); return value as T }

function parsePlatform(value: unknown): StoreHealthPlatform {
  const wire = record(value, 'platform'); exact(wire, ['code', 'displayName'], 'platform')
  return { code: text(wire.code, 'platform.code', 32), displayName: text(wire.displayName, 'platform.displayName', 160) }
}
function parseSync(value: unknown): StoreHealthSync | undefined {
  if (value == null) return undefined
  const wire = record(value, 'sync'); exact(wire, ['jobType', 'status', 'progressProcessed', 'progressTotal', 'attemptCount', 'safeErrorSummary', 'requestedAt', 'completedAt'], 'sync')
  const progressTotal = wire.progressTotal == null ? undefined : integer(wire.progressTotal, 'sync.progressTotal')
  const progressProcessed = integer(wire.progressProcessed, 'sync.progressProcessed')
  if (progressTotal !== undefined && progressProcessed > progressTotal) invalid('sync.progress')
  return {
    jobType: oneOf(wire.jobType, syncTypes, 'sync.jobType'), status: oneOf(wire.status, syncStatuses, 'sync.status'),
    progressProcessed, progressTotal, attemptCount: integer(wire.attemptCount, 'sync.attemptCount'),
    safeErrorSummary: wire.safeErrorSummary == null ? undefined : text(wire.safeErrorSummary, 'sync.safeErrorSummary', 1000),
    requestedAt: optionalInstant(wire.requestedAt, 'sync.requestedAt') ?? invalid('sync.requestedAt'),
    completedAt: optionalInstant(wire.completedAt, 'sync.completedAt'),
  }
}
function parseItem(value: unknown): StoreHealthItem {
  const wire = record(value, 'item'); exact(wire, ['shopId', 'platformCode', 'platformName', 'shopName', 'externalShopRef', 'shopStatus', 'authorizationStatus', 'scopes', 'lastVerifiedAt', 'updatedAt', 'latestSync'], 'item')
  if (typeof wire.shopId !== 'string' || !uuidPattern.test(wire.shopId)) invalid('item.shopId')
  if (!Array.isArray(wire.scopes) || wire.scopes.some((scope) => typeof scope !== 'string' || !scope || scope.length > 100)) invalid('item.scopes')
  return {
    shopId: wire.shopId, platformCode: text(wire.platformCode, 'item.platformCode', 32), platformName: text(wire.platformName, 'item.platformName', 160),
    shopName: text(wire.shopName, 'item.shopName', 160), externalShopRef: text(wire.externalShopRef, 'item.externalShopRef', 160),
    shopStatus: oneOf(wire.shopStatus, shopStatuses, 'item.shopStatus'), authorizationStatus: oneOf(wire.authorizationStatus, STORE_AUTHORIZATION_STATUSES, 'item.authorizationStatus'),
    scopes: [...wire.scopes], lastVerifiedAt: optionalInstant(wire.lastVerifiedAt, 'item.lastVerifiedAt'), updatedAt: optionalInstant(wire.updatedAt, 'item.updatedAt') ?? invalid('item.updatedAt'), latestSync: parseSync(wire.latestSync),
  }
}
function parsePage(value: unknown, request: StoreHealthRequest): StoreHealthPage {
  const wire = record(value, 'page'); exact(wire, ['items', 'platforms', 'page', 'size', 'totalElements', 'totalPages'], 'page')
  if (!Array.isArray(wire.items) || !Array.isArray(wire.platforms)) invalid('page.items')
  const result = { items: wire.items.map(parseItem), platforms: wire.platforms.map(parsePlatform), page: integer(wire.page, 'page.page'), size: integer(wire.size, 'page.size'), totalElements: integer(wire.totalElements, 'page.totalElements'), totalPages: integer(wire.totalPages, 'page.totalPages') }
  const expectedPages = result.totalElements === 0 ? 0 : Math.ceil(result.totalElements / result.size)
  if (result.page !== request.page || result.size !== request.size || result.totalPages !== expectedPages || result.items.length > result.size || new Set(result.items.map((item) => item.shopId)).size !== result.items.length || new Set(result.platforms.map((item) => item.code)).size !== result.platforms.length) invalid('page.identity')
  return result
}

export const storeHealthApi = {
  async list(request: StoreHealthRequest): Promise<StoreHealthPage> {
    if (!Number.isSafeInteger(request.page) || request.page < 0 || !Number.isSafeInteger(request.size) || request.size < 1 || request.size > 100) invalid('request.page')
    const params = new URLSearchParams({ page: String(request.page), size: String(request.size) })
    if (request.query?.trim()) params.set('query', request.query.trim().slice(0, 100))
    if (request.platform?.trim()) params.set('platform', request.platform.trim().slice(0, 32))
    if (request.authorizationStatus) params.set('authorizationStatus', request.authorizationStatus)
    return parsePage(await apiClient.request<unknown>(`${API_BASE}?${params}`, { signal: request.signal }), request)
  },
}
