import { ApiError, apiClient } from '../api/client'

const API_BASE = '/api/v1/procurement/recommendations'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type ProcurementRecommendation = {
  skuId: string
  skuCode: string
  skuName: string
  skuVariant?: string
  warehouseId: string
  warehouseCode: string
  warehouseName: string
  onHand: number
  reserved: number
  available: number
  last28DaysSalesQuantity: number
  openPurchaseQuantity: number
  supplierId?: string
  supplierCode?: string
  supplierName?: string
  supplierSkuCode?: string
  supplierLeadTimeDays?: number
  planningLeadTimeDays: number
  safetyDays: number
  targetCoverageDays: number
  targetStockQuantity: number
  recommendedQuantity: number
  activeLocationCount: number
}

export type ProcurementRecommendationLocation = {
  id: string
  warehouseId: string
  businessCode: string
  name: string
}

export type ProcurementRecommendationPage = {
  items: ProcurementRecommendation[]
  locations: ProcurementRecommendationLocation[]
  totalElements: number
  actionableCount: number
  totalRecommendedQuantity: number
  salesWindowDays: number
  defaultLeadTimeDays: number
  safetyDays: number
  observedAt: string
  page: number
  size: number
  totalPages: number
}

export type ProcurementRecommendationQuery = {
  supplier?: string
  keyword?: string
  hideWithoutSupplier?: boolean
  hideZeroRecommendation?: boolean
  asOf: string
  page: number
  size: number
  signal?: AbortSignal
}

export type ProcurementRecommendationExport = {
  filename: 'procurement-recommendations.csv'
  mediaType: 'text/csv;charset=utf-8'
  rowCount: number
  content: string
}

export type ProcurementGenerationSelection = {
  skuId: string
  warehouseId: string
  locationId: string
  expectedRecommendedQuantity: number
  quantity: number
}

export type ProcurementGenerationItem = {
  purchaseOrderId: string
  purchaseNo: string
  planId: string
  planNo: string
  skuId: string
  warehouseId: string
  locationId: string
  supplierId: string
  quantity: number
}

export type ProcurementGenerationResult = {
  commandId: string
  observedAt: string
  items: ProcurementGenerationItem[]
}

type Wire = Record<string, unknown>

function invalid(field: string): never {
  throw new ApiError('Invalid procurement recommendation response', {
    status: 502,
    code: 'invalid_response',
    details: { field },
  })
}

function invalidRequest(field: string): never {
  throw new ApiError('Invalid procurement recommendation request', {
    status: 400,
    code: 'invalid_request',
    details: { field },
  })
}

function record(value: unknown, field: string): Wire {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field)
  return value as Wire
}

function exact(value: Wire, fields: readonly string[], field: string) {
  const keys = Object.keys(value)
  if (keys.length !== fields.length
    || keys.some((key) => !fields.includes(key))
    || fields.some((key) => !(key in value))) {
    invalid(`${field}.shape`)
  }
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
  if (!UUID_PATTERN.test(result)) invalid(field)
  return result
}

function integer(value: unknown, field: string) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) invalid(field)
  return value
}

function nonNegative(value: unknown, field: string) {
  const result = integer(value, field)
  if (result < 0) invalid(field)
  return result
}

function positive(value: unknown, field: string) {
  const result = nonNegative(value, field)
  if (result < 1) invalid(field)
  return result
}

function timestamp(value: unknown, field: string) {
  const result = text(value, field)
  if (Number.isNaN(Date.parse(result))) invalid(field)
  return result
}

const ITEM_FIELDS = [
  'skuId', 'skuCode', 'skuName', 'skuVariant', 'warehouseId',
  'warehouseCode', 'warehouseName', 'onHand', 'reserved', 'available',
  'last28DaysSalesQuantity', 'openPurchaseQuantity', 'supplierId',
  'supplierCode', 'supplierName', 'supplierSkuCode', 'supplierLeadTimeDays',
  'planningLeadTimeDays', 'safetyDays', 'targetCoverageDays',
  'targetStockQuantity', 'recommendedQuantity', 'activeLocationCount',
] as const

export function parseProcurementRecommendation(value: unknown): ProcurementRecommendation {
  const wire = record(value, 'item')
  exact(wire, ITEM_FIELDS, 'item')
  const supplierId = wire.supplierId == null ? undefined : uuid(wire.supplierId, 'item.supplierId')
  const supplierCode = optionalText(wire.supplierCode, 'item.supplierCode')
  const supplierName = optionalText(wire.supplierName, 'item.supplierName')
  const supplierSkuCode = optionalText(wire.supplierSkuCode, 'item.supplierSkuCode')
  const supplierLeadTimeDays = wire.supplierLeadTimeDays == null
    ? undefined
    : nonNegative(wire.supplierLeadTimeDays, 'item.supplierLeadTimeDays')
  if (Boolean(supplierId) !== Boolean(supplierCode && supplierName)) invalid('item.supplier')
  if (supplierLeadTimeDays !== undefined && (!supplierId || supplierLeadTimeDays > 3650)) invalid('item.supplierLeadTimeDays')
  const planningLeadTimeDays = nonNegative(wire.planningLeadTimeDays, 'item.planningLeadTimeDays')
  const safetyDays = nonNegative(wire.safetyDays, 'item.safetyDays')
  const targetCoverageDays = positive(wire.targetCoverageDays, 'item.targetCoverageDays')
  if (targetCoverageDays !== planningLeadTimeDays + safetyDays) invalid('item.targetCoverageDays')
  return {
    skuId: uuid(wire.skuId, 'item.skuId'),
    skuCode: text(wire.skuCode, 'item.skuCode'),
    skuName: text(wire.skuName, 'item.skuName'),
    skuVariant: optionalText(wire.skuVariant, 'item.skuVariant'),
    warehouseId: uuid(wire.warehouseId, 'item.warehouseId'),
    warehouseCode: text(wire.warehouseCode, 'item.warehouseCode'),
    warehouseName: text(wire.warehouseName, 'item.warehouseName'),
    onHand: nonNegative(wire.onHand, 'item.onHand'),
    reserved: nonNegative(wire.reserved, 'item.reserved'),
    available: integer(wire.available, 'item.available'),
    last28DaysSalesQuantity: nonNegative(wire.last28DaysSalesQuantity, 'item.last28DaysSalesQuantity'),
    openPurchaseQuantity: nonNegative(wire.openPurchaseQuantity, 'item.openPurchaseQuantity'),
    supplierId,
    supplierCode,
    supplierName,
    supplierSkuCode,
    supplierLeadTimeDays,
    planningLeadTimeDays,
    safetyDays,
    targetCoverageDays,
    targetStockQuantity: nonNegative(wire.targetStockQuantity, 'item.targetStockQuantity'),
    recommendedQuantity: nonNegative(wire.recommendedQuantity, 'item.recommendedQuantity'),
    activeLocationCount: nonNegative(wire.activeLocationCount, 'item.activeLocationCount'),
  }
}

function parseLocation(value: unknown): ProcurementRecommendationLocation {
  const wire = record(value, 'location')
  exact(wire, ['id', 'warehouseId', 'businessCode', 'name'], 'location')
  return {
    id: uuid(wire.id, 'location.id'),
    warehouseId: uuid(wire.warehouseId, 'location.warehouseId'),
    businessCode: text(wire.businessCode, 'location.businessCode'),
    name: text(wire.name, 'location.name'),
  }
}

export function parseProcurementRecommendationPage(value: unknown): ProcurementRecommendationPage {
  const wire = record(value, 'page')
  exact(wire, [
    'items', 'locations', 'totalElements', 'actionableCount',
    'totalRecommendedQuantity', 'salesWindowDays', 'defaultLeadTimeDays',
    'safetyDays', 'observedAt', 'page', 'size', 'totalPages',
  ], 'page')
  if (!Array.isArray(wire.items) || !Array.isArray(wire.locations)) invalid('page.items')
  const items = wire.items.map(parseProcurementRecommendation)
  const locations = wire.locations.map(parseLocation)
  const page = nonNegative(wire.page, 'page.page')
  const size = positive(wire.size, 'page.size')
  const totalElements = nonNegative(wire.totalElements, 'page.totalElements')
  const totalPages = nonNegative(wire.totalPages, 'page.totalPages')
  const expectedPages = totalElements === 0 ? 0 : Math.ceil(totalElements / size)
  if (totalPages !== expectedPages || items.length > size || items.length > totalElements
    || (page >= totalPages && items.length > 0)) invalid('page.cardinality')
  if (new Set(items.map((item) => `${item.skuId}:${item.warehouseId}`)).size !== items.length) invalid('page.items.identity')
  if (new Set(locations.map((location) => location.id)).size !== locations.length
    || locations.some((location) => !items.some((item) => item.warehouseId === location.warehouseId))) {
    invalid('page.locations.identity')
  }
  const actionableCount = nonNegative(wire.actionableCount, 'page.actionableCount')
  if (actionableCount > totalElements) invalid('page.actionableCount')
  return {
    items,
    locations,
    totalElements,
    actionableCount,
    totalRecommendedQuantity: nonNegative(wire.totalRecommendedQuantity, 'page.totalRecommendedQuantity'),
    salesWindowDays: positive(wire.salesWindowDays, 'page.salesWindowDays'),
    defaultLeadTimeDays: nonNegative(wire.defaultLeadTimeDays, 'page.defaultLeadTimeDays'),
    safetyDays: nonNegative(wire.safetyDays, 'page.safetyDays'),
    observedAt: timestamp(wire.observedAt, 'page.observedAt'),
    page,
    size,
    totalPages,
  }
}

function validUuid(value: string, field: string) {
  if (!UUID_PATTERN.test(value)) invalidRequest(field)
}

function validTimestamp(value: string, field: string) {
  if (Number.isNaN(Date.parse(value))) invalidRequest(field)
}

function validPage(page: number, size: number) {
  if (!Number.isSafeInteger(page) || page < 0
    || !Number.isSafeInteger(size) || size < 1 || size > 100) {
    invalidRequest('page')
  }
}

function query(request: ProcurementRecommendationQuery) {
  validPage(request.page, request.size)
  validTimestamp(request.asOf, 'asOf')
  const params = new URLSearchParams({
    asOf: request.asOf,
    page: String(request.page),
    size: String(request.size),
  })
  if (request.supplier?.trim()) params.set('supplier', request.supplier.trim().slice(0, 100))
  if (request.keyword?.trim()) params.set('keyword', request.keyword.trim().slice(0, 120))
  if (request.hideWithoutSupplier) params.set('hideWithoutSupplier', 'true')
  if (request.hideZeroRecommendation) params.set('hideZeroRecommendation', 'true')
  return params
}

function parseExport(value: unknown): ProcurementRecommendationExport {
  const wire = record(value, 'export')
  exact(wire, ['filename', 'mediaType', 'rowCount', 'content'], 'export')
  const filename = text(wire.filename, 'export.filename')
  const mediaType = text(wire.mediaType, 'export.mediaType')
  const rowCount = nonNegative(wire.rowCount, 'export.rowCount')
  const content = typeof wire.content === 'string' ? wire.content : invalid('export.content')
  if (filename !== 'procurement-recommendations.csv'
    || mediaType !== 'text/csv;charset=utf-8'
    || rowCount > 10_000
    || content.length > 30_000_000
    || !content.startsWith('\uFEFFSKU编号,SKU名称,规格,仓库编码,仓库名称,')) {
    invalid('export.contract')
  }
  return { filename: 'procurement-recommendations.csv', mediaType: 'text/csv;charset=utf-8', rowCount, content }
}

function parseGenerationItem(value: unknown): ProcurementGenerationItem {
  const wire = record(value, 'generation.item')
  exact(wire, [
    'purchaseOrderId', 'purchaseNo', 'planId', 'planNo', 'skuId',
    'warehouseId', 'locationId', 'supplierId', 'quantity',
  ], 'generation.item')
  return {
    purchaseOrderId: uuid(wire.purchaseOrderId, 'generation.item.purchaseOrderId'),
    purchaseNo: text(wire.purchaseNo, 'generation.item.purchaseNo'),
    planId: uuid(wire.planId, 'generation.item.planId'),
    planNo: text(wire.planNo, 'generation.item.planNo'),
    skuId: uuid(wire.skuId, 'generation.item.skuId'),
    warehouseId: uuid(wire.warehouseId, 'generation.item.warehouseId'),
    locationId: uuid(wire.locationId, 'generation.item.locationId'),
    supplierId: uuid(wire.supplierId, 'generation.item.supplierId'),
    quantity: positive(wire.quantity, 'generation.item.quantity'),
  }
}

function parseGeneration(value: unknown): ProcurementGenerationResult {
  const wire = record(value, 'generation')
  exact(wire, ['commandId', 'observedAt', 'items'], 'generation')
  if (!Array.isArray(wire.items) || wire.items.length === 0 || wire.items.length > 50) invalid('generation.items')
  const items = wire.items.map(parseGenerationItem)
  if (new Set(items.map((item) => item.purchaseOrderId)).size !== items.length) invalid('generation.items.identity')
  return {
    commandId: uuid(wire.commandId, 'generation.commandId'),
    observedAt: timestamp(wire.observedAt, 'generation.observedAt'),
    items,
  }
}

export const procurementRecommendationApi = {
  async list(request: ProcurementRecommendationQuery): Promise<ProcurementRecommendationPage> {
    const result = parseProcurementRecommendationPage(
      await apiClient.request<unknown>(`${API_BASE}?${query(request)}`, { signal: request.signal }),
    )
    if (result.page !== request.page || result.size !== request.size
      || Date.parse(result.observedAt) !== Date.parse(request.asOf)) invalid('page.requestIdentity')
    return result
  },

  async exportCsv(request: Omit<ProcurementRecommendationQuery, 'page' | 'size' | 'signal'>): Promise<ProcurementRecommendationExport> {
    validTimestamp(request.asOf, 'asOf')
    return parseExport(await apiClient.request<unknown>(`${API_BASE}/exports`, {
      method: 'POST',
      body: {
        supplier: request.supplier?.trim().slice(0, 100) || undefined,
        keyword: request.keyword?.trim().slice(0, 120) || undefined,
        hideWithoutSupplier: Boolean(request.hideWithoutSupplier),
        hideZeroRecommendation: Boolean(request.hideZeroRecommendation),
        asOf: request.asOf,
      },
    }))
  },

  async generate(input: {
    commandId: string
    observedAt: string
    items: ProcurementGenerationSelection[]
  }): Promise<ProcurementGenerationResult> {
    validUuid(input.commandId, 'commandId')
    validTimestamp(input.observedAt, 'observedAt')
    if (input.items.length < 1 || input.items.length > 50) invalidRequest('items')
    const identities = new Set<string>()
    input.items.forEach((item) => {
      validUuid(item.skuId, 'item.skuId')
      validUuid(item.warehouseId, 'item.warehouseId')
      validUuid(item.locationId, 'item.locationId')
      if (!Number.isSafeInteger(item.expectedRecommendedQuantity) || item.expectedRecommendedQuantity < 1
        || item.expectedRecommendedQuantity > 1_000_000_000
        || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 1_000_000_000) {
        invalidRequest('item.quantity')
      }
      const identity = `${item.skuId}:${item.warehouseId}`
      if (identities.has(identity)) invalidRequest('items.identity')
      identities.add(identity)
    })
    const result = parseGeneration(await apiClient.request<unknown>(`${API_BASE}/generate`, {
      method: 'POST',
      headers: { 'X-Request-Id': `procurement-recommendation.${input.commandId}` },
      body: input,
    }))
    if (result.commandId !== input.commandId
      || Date.parse(result.observedAt) !== Date.parse(input.observedAt)
      || result.items.length !== input.items.length
      || result.items.some((item) => !input.items.some((source) => source.skuId === item.skuId
        && source.warehouseId === item.warehouseId && source.locationId === item.locationId
        && source.quantity === item.quantity))) invalid('generation.requestIdentity')
    return result
  },
}
