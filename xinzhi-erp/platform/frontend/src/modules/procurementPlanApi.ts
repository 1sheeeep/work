import { apiClient } from '../api/client'

const API_BASE = '/api/v1/procurement/plans'
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type ProcurementPlanStatus = 'UNPURCHASED' | 'ORDERED' | 'VOIDED'
export type ProcurementPlanSearchField = 'PLAN_NO' | 'SKU_CODE' | 'SKU_NAME' | 'NOTE'

export type ProcurementPlan = {
  id: string
  planNo: string
  status: ProcurementPlanStatus
  source: 'MANUAL' | 'SMART'
  skuId: string
  skuCode: string
  skuName: string
  skuVariant?: string
  warehouseId: string
  warehouseCode: string
  warehouseName: string
  locationId: string
  locationCode: string
  locationName: string
  quantity: number
  note?: string
  applicantDisplayName: string
  createdAt: string
  voidReason?: string
  voidedByDisplayName?: string
  voidedAt?: string
  version: number
  updatedAt: string
}

export type ProcurementPlanPage = {
  items: ProcurementPlan[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}

export type ProcurementPlanSummary = {
  unpurchasedPlans: number
}

export type ProcurementSkuOption = {
  id: string
  businessCode: string
  name: string
  variantSummary?: string
}

export type ProcurementWarehouseOption = {
  id: string
  businessCode: string
  name: string
}

export type ProcurementLocationOption = {
  id: string
  warehouseId: string
  businessCode: string
  name: string
}

export type ProcurementReferencePage<T> = {
  items: T[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}

export type ProcurementPlanListRequest = {
  warehouseId?: string
  locationId?: string
  status?: ProcurementPlanStatus
  searchField: ProcurementPlanSearchField
  keyword?: string
  createdFrom?: string
  createdTo?: string
  page: number
  size: number
  signal?: AbortSignal
}
export type ProcurementPlanExport = {
  filename: 'procurement-plans.csv'
  mediaType: 'text/csv;charset=utf-8'
  rowCount: number
  content: string
}
export type ProcurementPlanExportRequest = Omit<ProcurementPlanListRequest, 'page' | 'size' | 'signal'>

type UnknownRecord = Record<string, unknown>

function invalid(field: string): never {
  throw new Error(`Invalid procurement plan response: ${field}`)
}

function invalidRequest(field: string): never {
  throw new Error(`Invalid procurement plan request: ${field}`)
}

function record(value: unknown, field: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid(field)
  return value as UnknownRecord
}

function exact(wire: UnknownRecord, keys: readonly string[], field: string) {
  const actual = Object.keys(wire).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    invalid(`${field}.shape`)
  }
}

function string(value: unknown, field: string) {
  return typeof value === 'string' && value.length > 0 ? value : invalid(field)
}

function optionalString(value: unknown, field: string) {
  return value == null ? undefined : string(value, field)
}

function uuid(value: unknown, field: string) {
  const result = string(value, field)
  return UUID_PATTERN.test(result) ? result : invalid(field)
}

function nonNegative(value: unknown, field: string) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : invalid(field)
}

function positive(value: unknown, field: string) {
  const result = nonNegative(value, field)
  return result > 0 ? result : invalid(field)
}

function timestamp(value: unknown, field: string) {
  const result = string(value, field)
  return Number.isNaN(Date.parse(result)) ? invalid(field) : result
}

function optionalTimestamp(value: unknown, field: string) {
  return value == null ? undefined : timestamp(value, field)
}

function status(value: unknown, field: string): ProcurementPlanStatus {
  return value === 'UNPURCHASED' || value === 'ORDERED' || value === 'VOIDED' ? value : invalid(field)
}

const PLAN_KEYS = [
  'planId', 'planNo', 'status', 'source', 'skuId', 'skuCode', 'skuName', 'skuVariant',
  'warehouseId', 'warehouseCode', 'warehouseName', 'locationId', 'locationCode',
  'locationName', 'quantity', 'note', 'applicantDisplayName', 'createdAt',
  'voidReason', 'voidedByDisplayName', 'voidedAt', 'version', 'updatedAt',
] as const

export function parseProcurementPlan(value: unknown): ProcurementPlan {
  const wire = record(value, 'plan')
  exact(wire, PLAN_KEYS, 'plan')
  if (wire.source !== 'MANUAL' && wire.source !== 'SMART') invalid('plan.source')
  const result: ProcurementPlan = {
    id: uuid(wire.planId, 'plan.planId'),
    planNo: string(wire.planNo, 'plan.planNo'),
    status: status(wire.status, 'plan.status'),
    source: wire.source,
    skuId: uuid(wire.skuId, 'plan.skuId'),
    skuCode: string(wire.skuCode, 'plan.skuCode'),
    skuName: string(wire.skuName, 'plan.skuName'),
    skuVariant: optionalString(wire.skuVariant, 'plan.skuVariant'),
    warehouseId: uuid(wire.warehouseId, 'plan.warehouseId'),
    warehouseCode: string(wire.warehouseCode, 'plan.warehouseCode'),
    warehouseName: string(wire.warehouseName, 'plan.warehouseName'),
    locationId: uuid(wire.locationId, 'plan.locationId'),
    locationCode: string(wire.locationCode, 'plan.locationCode'),
    locationName: string(wire.locationName, 'plan.locationName'),
    quantity: positive(wire.quantity, 'plan.quantity'),
    note: optionalString(wire.note, 'plan.note'),
    applicantDisplayName: string(wire.applicantDisplayName, 'plan.applicantDisplayName'),
    createdAt: timestamp(wire.createdAt, 'plan.createdAt'),
    voidReason: optionalString(wire.voidReason, 'plan.voidReason'),
    voidedByDisplayName: optionalString(wire.voidedByDisplayName, 'plan.voidedByDisplayName'),
    voidedAt: optionalTimestamp(wire.voidedAt, 'plan.voidedAt'),
    version: nonNegative(wire.version, 'plan.version'),
    updatedAt: timestamp(wire.updatedAt, 'plan.updatedAt'),
  }
  const voidFields = [result.voidReason, result.voidedByDisplayName, result.voidedAt]
  if (result.status === 'VOIDED' ? voidFields.some((item) => !item) : voidFields.some(Boolean)) {
    invalid('plan.voidState')
  }
  return result
}

export function parseProcurementPlanSummary(value: unknown): ProcurementPlanSummary {
  const wire = record(value, 'summary')
  exact(wire, ['unpurchasedPlans'], 'summary')
  return { unpurchasedPlans: nonNegative(wire.unpurchasedPlans, 'summary.unpurchasedPlans') }
}

function parseExport(value: unknown): ProcurementPlanExport {
  const wire = record(value, 'export')
  exact(wire, ['filename', 'mediaType', 'rowCount', 'content'], 'export')
  const filename = string(wire.filename, 'export.filename')
  const mediaType = string(wire.mediaType, 'export.mediaType')
  const rowCount = nonNegative(wire.rowCount, 'export.rowCount')
  const content = typeof wire.content === 'string' ? wire.content : invalid('export.content')
  if (filename !== 'procurement-plans.csv'
    || mediaType !== 'text/csv;charset=utf-8'
    || rowCount > 10_000
    || content.length > 30_000_000
    || !content.startsWith('\uFEFF计划编号,状态,来源,SKU编号,SKU名称,规格,仓库编码,仓库名称,库位编码,库位名称,计划数量,备注,申请人,申请时间,作废原因,作废人,作废时间,更新时间\r\n')) {
    invalid('export.contract')
  }
  return { filename: 'procurement-plans.csv', mediaType: 'text/csv;charset=utf-8', rowCount, content }
}

function parsePage<T>(value: unknown, mapItem: (item: unknown) => T, identity: (item: T) => string): ProcurementReferencePage<T> {
  const wire = record(value, 'page')
  exact(wire, ['items', 'page', 'size', 'totalElements', 'totalPages'], 'page')
  if (!Array.isArray(wire.items)) invalid('page.items')
  const result = {
    items: wire.items.map((item) => mapItem(item)),
    page: nonNegative(wire.page, 'page.page'),
    size: positive(wire.size, 'page.size'),
    totalElements: nonNegative(wire.totalElements, 'page.totalElements'),
    totalPages: nonNegative(wire.totalPages, 'page.totalPages'),
  }
  if (result.items.length > result.size || (result.page >= result.totalPages && result.items.length > 0)) {
    invalid('page.identity')
  }
  const expectedTotalPages = result.totalElements === 0 ? 0 : Math.ceil(result.totalElements / result.size)
  if (result.totalPages !== expectedTotalPages || result.items.length > result.totalElements) invalid('page.cardinality')
  if (new Set(result.items.map(identity)).size !== result.items.length) invalid('page.items.identity')
  return result
}

function requestedPage<T>(result: ProcurementReferencePage<T>, page: number, size: number) {
  if (result.page !== page || result.size !== size) invalid('page.requestIdentity')
  return result
}

function parseSku(value: unknown): ProcurementSkuOption {
  const wire = record(value, 'sku')
  exact(wire, ['id', 'businessCode', 'name', 'variantSummary'], 'sku')
  return {
    id: uuid(wire.id, 'sku.id'), businessCode: string(wire.businessCode, 'sku.businessCode'),
    name: string(wire.name, 'sku.name'), variantSummary: optionalString(wire.variantSummary, 'sku.variantSummary'),
  }
}

function parseWarehouse(value: unknown): ProcurementWarehouseOption {
  const wire = record(value, 'warehouse')
  exact(wire, ['id', 'businessCode', 'name'], 'warehouse')
  return { id: uuid(wire.id, 'warehouse.id'), businessCode: string(wire.businessCode, 'warehouse.businessCode'), name: string(wire.name, 'warehouse.name') }
}

function parseLocation(value: unknown): ProcurementLocationOption {
  const wire = record(value, 'location')
  exact(wire, ['id', 'warehouseId', 'businessCode', 'name'], 'location')
  return { id: uuid(wire.id, 'location.id'), warehouseId: uuid(wire.warehouseId, 'location.warehouseId'), businessCode: string(wire.businessCode, 'location.businessCode'), name: string(wire.name, 'location.name') }
}

function validPage(page: number, size: number) {
  if (!Number.isSafeInteger(page) || page < 0 || !Number.isSafeInteger(size) || size < 1 || size > 200) {
    invalidRequest('page')
  }
}

function validUuid(value: string, field: string) {
  if (!UUID_PATTERN.test(value)) invalidRequest(field)
}

function validDateWindow(createdFrom?: string, createdTo?: string) {
  const from = createdFrom ? Date.parse(createdFrom) : undefined
  const to = createdTo ? Date.parse(createdTo) : undefined
  if ((from !== undefined && Number.isNaN(from))
    || (to !== undefined && Number.isNaN(to))
    || (from !== undefined && to !== undefined && from > to)) {
    invalidRequest('createdWindow')
  }
}

function commandHeaders(commandId: string) {
  validUuid(commandId, 'commandId')
  return { 'X-Request-Id': `procurement.${commandId}` }
}

function referenceQuery(keyword: string | undefined, page: number, size: number) {
  validPage(page, size)
  const query = new URLSearchParams({ page: String(page), size: String(size) })
  if (keyword?.trim()) query.set('keyword', keyword.trim().slice(0, 120))
  return query
}

export const procurementPlanApi = {
  async summary(): Promise<ProcurementPlanSummary> {
    return parseProcurementPlanSummary(
      await apiClient.request<unknown>(`${API_BASE}/summary`),
    )
  },

  async list(request: ProcurementPlanListRequest): Promise<ProcurementPlanPage> {
    validPage(request.page, request.size)
    const query = new URLSearchParams({ searchField: request.searchField, page: String(request.page), size: String(request.size) })
    if (request.warehouseId) { validUuid(request.warehouseId, 'warehouseId'); query.set('warehouseId', request.warehouseId) }
    if (request.locationId) { validUuid(request.locationId, 'locationId'); query.set('locationId', request.locationId) }
    if (request.status) query.set('status', request.status)
    if (request.keyword?.trim()) query.set('keyword', request.keyword.trim().slice(0, 120))
    if (request.createdFrom) query.set('createdFrom', request.createdFrom)
    if (request.createdTo) query.set('createdTo', request.createdTo)
    return requestedPage(parsePage(await apiClient.request<unknown>(`${API_BASE}?${query}`, { signal: request.signal }), parseProcurementPlan, (item) => item.id), request.page, request.size)
  },

  async exportCsv(request: ProcurementPlanExportRequest): Promise<ProcurementPlanExport> {
    if (request.warehouseId) validUuid(request.warehouseId, 'warehouseId')
    if (request.locationId) validUuid(request.locationId, 'locationId')
    validDateWindow(request.createdFrom, request.createdTo)
    return parseExport(await apiClient.request<unknown>(`${API_BASE}/exports`, {
      method: 'POST',
      body: {
        warehouseId: request.warehouseId,
        locationId: request.locationId,
        status: request.status,
        searchField: request.searchField,
        keyword: request.keyword?.trim().slice(0, 120) || undefined,
        createdFrom: request.createdFrom,
        createdTo: request.createdTo,
      },
    }))
  },

  async get(planId: string) {
    validUuid(planId, 'planId')
    const plan = parseProcurementPlan(await apiClient.request<unknown>(`${API_BASE}/${planId}`))
    if (plan.id !== planId) invalid('plan.id')
    return plan
  },

  async create(input: { commandId: string; skuId: string; warehouseId: string; locationId: string; quantity: number; note?: string }) {
    validUuid(input.skuId, 'skuId'); validUuid(input.warehouseId, 'warehouseId'); validUuid(input.locationId, 'locationId')
    if (!Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > 1_000_000_000) invalidRequest('quantity')
    const plan = parseProcurementPlan(await apiClient.request<unknown>(API_BASE, { method: 'POST', headers: commandHeaders(input.commandId), body: input }))
    if (plan.skuId !== input.skuId || plan.warehouseId !== input.warehouseId || plan.locationId !== input.locationId || plan.quantity !== input.quantity) invalid('plan.identity')
    return plan
  },

  async void(planId: string, input: { commandId: string; expectedVersion: number; reason: string }) {
    validUuid(planId, 'planId')
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) invalidRequest('expectedVersion')
    const reason = input.reason.trim()
    if (!reason || reason.length > 500 || /[\u0000-\u001f\u007f]/.test(reason)) invalidRequest('reason')
    const plan = parseProcurementPlan(await apiClient.request<unknown>(`${API_BASE}/${planId}/void`, { method: 'POST', headers: commandHeaders(input.commandId), body: { ...input, reason } }))
    if (plan.id !== planId || plan.status !== 'VOIDED') invalid('plan.identity')
    return plan
  },

  async skus(keyword: string | undefined, page: number, size: number) {
    return requestedPage(parsePage(await apiClient.request<unknown>(`${API_BASE}/references/skus?${referenceQuery(keyword, page, size)}`), parseSku, (item) => item.id), page, size)
  },

  async warehouses(keyword: string | undefined, page: number, size: number) {
    return requestedPage(parsePage(await apiClient.request<unknown>(`${API_BASE}/references/warehouses?${referenceQuery(keyword, page, size)}`), parseWarehouse, (item) => item.id), page, size)
  },

  async locations(warehouseId: string, keyword: string | undefined, page: number, size: number) {
    validUuid(warehouseId, 'warehouseId')
    const result = await apiClient.request<unknown>(`${API_BASE}/references/warehouses/${warehouseId}/locations?${referenceQuery(keyword, page, size)}`)
    const pageResult = requestedPage(parsePage(result, parseLocation, (item) => item.id), page, size)
    if (pageResult.items.some((item) => item.warehouseId !== warehouseId)) invalid('location.warehouseId')
    return pageResult
  },
}
