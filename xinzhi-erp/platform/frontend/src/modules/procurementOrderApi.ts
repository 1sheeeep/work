import { ApiError, apiClient } from '../api/client'

const API_BASE = '/api/v1/procurement/orders'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type ProcurementOrderSearchField = 'PURCHASE_NO' | 'PLAN_NO' | 'SKU_CODE' | 'SKU_NAME' | 'SUPPLIER_NAME' | 'ORDER_NOTE' | 'ORDERED_BY'
export type ProcurementOrderStatus = 'NEW_ORDER' | 'APPROVED' | 'REJECTED' | 'PARTIALLY_RECEIVED' | 'RECEIVED'
export type ProcurementOrder = {
  purchaseOrderId: string; purchaseNo: string; status: ProcurementOrderStatus; planId?: string; planNo?: string
  supplierId: string; supplierCode: string; supplierName: string; supplierSkuCode?: string
  skuId: string; skuCode: string; skuName: string; skuVariant?: string
  warehouseId: string; warehouseCode: string; warehouseName: string
  locationId: string; locationCode: string; locationName: string
  quantity: number; receivedQuantity: number; orderNote?: string; orderedByDisplayName: string
  reviewDecision?: 'APPROVED' | 'REJECTED'; reviewNote?: string; reviewedByDisplayName?: string; reviewedAt?: string
  version: number; lastReceivedAt?: string; createdAt: string; updatedAt: string
}
export type ProcurementSupplierOption = {
  supplierId: string; supplierCode: string; supplierName: string; supplierSkuCode?: string
  preferred: boolean; leadTimeDays?: number
}
export type ProcurementOrderPage<T = ProcurementOrder> = { items: T[]; page: number; size: number; totalElements: number; totalPages: number }
export type ProcurementFollowUpExport = {
  filename: 'procurement-follow-up.csv'
  mediaType: 'text/csv;charset=utf-8'
  rowCount: number
  content: string
}
export type ProcurementFollowUpExportRequest = {
  searchField: ProcurementOrderSearchField
  keyword?: string
  createdFrom?: string
  createdTo?: string
}
export type ProcurementOrderExport = {
  filename: 'procurement-orders.csv'
  mediaType: 'text/csv;charset=utf-8'
  rowCount: number
  content: string
}
export type ProcurementOrderExportRequest = {
  status?: ProcurementOrderStatus
  receivableOnly?: boolean
  searchField: ProcurementOrderSearchField
  keyword?: string
  createdFrom?: string
  createdTo?: string
}

type Wire = Record<string, unknown>
function invalid(field: string): never { throw new ApiError('Invalid procurement order response', { status: 502, code: 'invalid_response', details: { field } }) }
function invalidRequest(field: string): never { throw new ApiError('Invalid procurement order request', { status: 400, code: 'invalid_request', details: { field } }) }
function record(value: unknown, field: string): Wire { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field); return value as Wire }
function exact(value: Wire, fields: readonly string[], field: string) { if (Object.keys(value).some((key) => !fields.includes(key)) || fields.some((key) => !(key in value))) invalid(`${field}.shape`) }
function text(value: unknown, field: string) { if (typeof value !== 'string' || !value.trim()) invalid(field); return value }
function optionalText(value: unknown, field: string) { if (value === null) return undefined; return text(value, field) }
function uuid(value: unknown, field: string) { const result = text(value, field); if (!UUID_PATTERN.test(result)) invalid(field); return result }
function nonNegative(value: unknown, field: string) { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid(field); return value }
function positive(value: unknown, field: string) { const result = nonNegative(value, field); if (result < 1) invalid(field); return result }
function timestamp(value: unknown, field: string) { const result = text(value, field); if (Number.isNaN(Date.parse(result))) invalid(field); return result }

export function parseProcurementOrder(value: unknown): ProcurementOrder {
  const wire = record(value, 'order')
  exact(wire, ['purchaseOrderId', 'purchaseNo', 'status', 'planId', 'planNo', 'supplierId', 'supplierCode', 'supplierName', 'supplierSkuCode', 'skuId', 'skuCode', 'skuName', 'skuVariant', 'warehouseId', 'warehouseCode', 'warehouseName', 'locationId', 'locationCode', 'locationName', 'quantity', 'receivedQuantity', 'orderNote', 'orderedByDisplayName', 'reviewDecision', 'reviewNote', 'reviewedByDisplayName', 'reviewedAt', 'version', 'lastReceivedAt', 'createdAt', 'updatedAt'], 'order')
  if (wire.status !== 'NEW_ORDER' && wire.status !== 'APPROVED' && wire.status !== 'REJECTED' && wire.status !== 'PARTIALLY_RECEIVED' && wire.status !== 'RECEIVED') invalid('order.status')
  const quantity = positive(wire.quantity, 'order.quantity')
  const receivedQuantity = nonNegative(wire.receivedQuantity, 'order.receivedQuantity')
  if (receivedQuantity > quantity) invalid('order.receivedQuantity')
  const reviewDecision = wire.reviewDecision === null ? undefined : wire.reviewDecision
  if (reviewDecision !== undefined && reviewDecision !== 'APPROVED' && reviewDecision !== 'REJECTED') invalid('order.reviewDecision')
  const reviewNote = optionalText(wire.reviewNote, 'order.reviewNote')
  const reviewedByDisplayName = optionalText(wire.reviewedByDisplayName, 'order.reviewedByDisplayName')
  const reviewedAt = wire.reviewedAt === null ? undefined : timestamp(wire.reviewedAt, 'order.reviewedAt')
  if ((wire.status === 'NEW_ORDER' && (receivedQuantity !== 0 || reviewDecision !== undefined || reviewNote !== undefined || reviewedByDisplayName !== undefined || reviewedAt !== undefined))
    || (wire.status === 'REJECTED' && (receivedQuantity !== 0 || reviewDecision !== 'REJECTED' || reviewNote === undefined || reviewedByDisplayName === undefined || reviewedAt === undefined))
    || (wire.status === 'APPROVED' && (receivedQuantity !== 0 || reviewDecision !== 'APPROVED' || reviewedByDisplayName === undefined || reviewedAt === undefined))
    || ((wire.status === 'PARTIALLY_RECEIVED' || wire.status === 'RECEIVED') && (reviewDecision !== 'APPROVED' || reviewedByDisplayName === undefined || reviewedAt === undefined))
    || (wire.status === 'PARTIALLY_RECEIVED' && (receivedQuantity === 0 || receivedQuantity === quantity))
    || (wire.status === 'RECEIVED' && receivedQuantity !== quantity)) invalid('order.state')
  return {
    purchaseOrderId: uuid(wire.purchaseOrderId, 'order.purchaseOrderId'), purchaseNo: text(wire.purchaseNo, 'order.purchaseNo'), status: wire.status,
    planId: wire.planId === null ? undefined : uuid(wire.planId, 'order.planId'), planNo: optionalText(wire.planNo, 'order.planNo'), supplierId: uuid(wire.supplierId, 'order.supplierId'),
    supplierCode: text(wire.supplierCode, 'order.supplierCode'), supplierName: text(wire.supplierName, 'order.supplierName'), supplierSkuCode: optionalText(wire.supplierSkuCode, 'order.supplierSkuCode'),
    skuId: uuid(wire.skuId, 'order.skuId'), skuCode: text(wire.skuCode, 'order.skuCode'), skuName: text(wire.skuName, 'order.skuName'), skuVariant: optionalText(wire.skuVariant, 'order.skuVariant'),
    warehouseId: uuid(wire.warehouseId, 'order.warehouseId'), warehouseCode: text(wire.warehouseCode, 'order.warehouseCode'), warehouseName: text(wire.warehouseName, 'order.warehouseName'),
    locationId: uuid(wire.locationId, 'order.locationId'), locationCode: text(wire.locationCode, 'order.locationCode'), locationName: text(wire.locationName, 'order.locationName'),
    quantity, receivedQuantity, orderNote: optionalText(wire.orderNote, 'order.orderNote'), orderedByDisplayName: text(wire.orderedByDisplayName, 'order.orderedByDisplayName'),
    reviewDecision, reviewNote, reviewedByDisplayName, reviewedAt,
    version: nonNegative(wire.version, 'order.version'), lastReceivedAt: wire.lastReceivedAt === null ? undefined : timestamp(wire.lastReceivedAt, 'order.lastReceivedAt'), createdAt: timestamp(wire.createdAt, 'order.createdAt'), updatedAt: timestamp(wire.updatedAt, 'order.updatedAt'),
  }
}

function parseSupplier(value: unknown): ProcurementSupplierOption {
  const wire = record(value, 'supplier')
  exact(wire, ['supplierId', 'supplierCode', 'supplierName', 'supplierSkuCode', 'preferred', 'leadTimeDays'], 'supplier')
  if (typeof wire.preferred !== 'boolean') invalid('supplier.preferred')
  const leadTimeDays = wire.leadTimeDays === null ? undefined : nonNegative(wire.leadTimeDays, 'supplier.leadTimeDays')
  if (leadTimeDays !== undefined && leadTimeDays > 3650) invalid('supplier.leadTimeDays')
  return { supplierId: uuid(wire.supplierId, 'supplier.supplierId'), supplierCode: text(wire.supplierCode, 'supplier.supplierCode'), supplierName: text(wire.supplierName, 'supplier.supplierName'), supplierSkuCode: optionalText(wire.supplierSkuCode, 'supplier.supplierSkuCode'), preferred: wire.preferred, leadTimeDays }
}

function parseFollowUpExport(value: unknown): ProcurementFollowUpExport {
  const wire = record(value, 'export')
  exact(wire, ['filename', 'mediaType', 'rowCount', 'content'], 'export')
  const filename = text(wire.filename, 'export.filename')
  const mediaType = text(wire.mediaType, 'export.mediaType')
  const rowCount = nonNegative(wire.rowCount, 'export.rowCount')
  const content = typeof wire.content === 'string'
    ? wire.content
    : invalid('export.content')
  if (filename !== 'procurement-follow-up.csv'
    || mediaType !== 'text/csv;charset=utf-8'
    || rowCount > 10_000
    || content.length > 30_000_000
    || !content.startsWith('\uFEFF采购单号,计划编号,SKU编号,SKU名称,规格,仓库编码,仓库名称,库位编码,库位名称,供应商编码,供应商名称,供应商SKU,采购数量,已到货,待到货,状态,下单员,下单时间,最近到货\r\n')) {
    invalid('export.contract')
  }
  return {
    filename: 'procurement-follow-up.csv',
    mediaType: 'text/csv;charset=utf-8',
    rowCount,
    content,
  }
}

function parseOrderExport(value: unknown): ProcurementOrderExport {
  const wire = record(value, 'export')
  exact(wire, ['filename', 'mediaType', 'rowCount', 'content'], 'export')
  const filename = text(wire.filename, 'export.filename')
  const mediaType = text(wire.mediaType, 'export.mediaType')
  const rowCount = nonNegative(wire.rowCount, 'export.rowCount')
  const content = typeof wire.content === 'string' ? wire.content : invalid('export.content')
  if (filename !== 'procurement-orders.csv'
    || mediaType !== 'text/csv;charset=utf-8'
    || rowCount > 10_000
    || content.length > 30_000_000
    || !content.startsWith('\uFEFF采购单号,状态,计划编号,供应商编码,供应商名称,供应商SKU,SKU编号,SKU名称,规格,仓库编码,仓库名称,库位编码,库位名称,采购数量,已收数量,待收数量,订单备注,下单员,最近到货,创建时间,更新时间\r\n')) {
    invalid('export.contract')
  }
  return { filename: 'procurement-orders.csv', mediaType: 'text/csv;charset=utf-8', rowCount, content }
}

function parsePage<T>(value: unknown, item: (value: unknown) => T, identity: (item: T) => string): ProcurementOrderPage<T> {
  const wire = record(value, 'page')
  exact(wire, ['items', 'page', 'size', 'totalElements', 'totalPages'], 'page')
  if (!Array.isArray(wire.items)) invalid('page.items')
  const result = { items: wire.items.map(item), page: nonNegative(wire.page, 'page.page'), size: positive(wire.size, 'page.size'), totalElements: nonNegative(wire.totalElements, 'page.totalElements'), totalPages: nonNegative(wire.totalPages, 'page.totalPages') }
  if (result.items.length > result.size || (result.page >= result.totalPages && result.items.length > 0)) invalid('page.identity')
  const expectedTotalPages = result.totalElements === 0 ? 0 : Math.ceil(result.totalElements / result.size)
  if (result.totalPages !== expectedTotalPages || result.items.length > result.totalElements) invalid('page.cardinality')
  if (new Set(result.items.map(identity)).size !== result.items.length) invalid('page.items.identity')
  return result
}

function requestedPage<T>(result: ProcurementOrderPage<T>, page: number, size: number) {
  if (result.page !== page || result.size !== size) invalid('page.requestIdentity')
  return result
}

function validUuid(value: string, field: string) { if (!UUID_PATTERN.test(value)) invalidRequest(field) }
function validPage(page: number, size: number) { if (!Number.isSafeInteger(page) || page < 0 || !Number.isSafeInteger(size) || size < 1 || size > 200) invalidRequest('page') }
function commandHeaders(commandId: string) { validUuid(commandId, 'commandId'); return { 'X-Request-Id': `procurement-order.${commandId}` } }
function validDateWindow(createdFrom?: string, createdTo?: string) {
  const from = createdFrom ? Date.parse(createdFrom) : undefined
  const to = createdTo ? Date.parse(createdTo) : undefined
  if ((from !== undefined && Number.isNaN(from))
    || (to !== undefined && Number.isNaN(to))
    || (from !== undefined && to !== undefined && from > to)) {
    invalidRequest('createdWindow')
  }
}

export const procurementOrderApi = {
  async list(request: { searchField: ProcurementOrderSearchField; keyword?: string; status?: ProcurementOrderStatus; receivableOnly?: boolean; createdFrom?: string; createdTo?: string; page: number; size: number; signal?: AbortSignal }) {
    validPage(request.page, request.size)
    const query = new URLSearchParams({ searchField: request.searchField, page: String(request.page), size: String(request.size) })
    if (request.keyword?.trim()) query.set('keyword', request.keyword.trim().slice(0, 120))
    if (request.status) query.set('status', request.status)
    if (request.receivableOnly) query.set('receivableOnly', 'true')
    if (request.createdFrom) query.set('createdFrom', request.createdFrom)
    if (request.createdTo) query.set('createdTo', request.createdTo)
    const result = requestedPage(parsePage(await apiClient.request<unknown>(`${API_BASE}?${query}`, { signal: request.signal }), parseProcurementOrder, (item) => item.purchaseOrderId), request.page, request.size)
    if (request.receivableOnly
      && result.items.some((item) => item.status !== 'APPROVED' && item.status !== 'PARTIALLY_RECEIVED')) {
      invalid('page.receivableOnly')
    }
    return result
  },
  async exportFollowUpCsv(
    request: ProcurementFollowUpExportRequest,
  ): Promise<ProcurementFollowUpExport> {
    validDateWindow(request.createdFrom, request.createdTo)
    return parseFollowUpExport(await apiClient.request<unknown>(
      `${API_BASE}/follow-up/exports`,
      {
        method: 'POST',
        body: {
          searchField: request.searchField,
          keyword: request.keyword?.trim().slice(0, 120) || undefined,
          createdFrom: request.createdFrom,
          createdTo: request.createdTo,
        },
      },
    ))
  },
  async exportCsv(request: ProcurementOrderExportRequest): Promise<ProcurementOrderExport> {
    validDateWindow(request.createdFrom, request.createdTo)
    return parseOrderExport(await apiClient.request<unknown>(
      `${API_BASE}/exports`,
      {
        method: 'POST',
        body: {
          status: request.status,
          receivableOnly: request.receivableOnly,
          searchField: request.searchField,
          keyword: request.keyword?.trim().slice(0, 120) || undefined,
          createdFrom: request.createdFrom,
          createdTo: request.createdTo,
        },
      },
    ))
  },
  async get(purchaseOrderId: string) {
    validUuid(purchaseOrderId, 'purchaseOrderId')
    const result = parseProcurementOrder(await apiClient.request<unknown>(`${API_BASE}/${purchaseOrderId}`))
    if (result.purchaseOrderId !== purchaseOrderId) invalid('order.identity')
    return result
  },
  async create(input: { commandId: string; planId: string; expectedPlanVersion: number; supplierId: string; orderNote?: string }) {
    validUuid(input.planId, 'planId'); validUuid(input.supplierId, 'supplierId')
    if (!Number.isSafeInteger(input.expectedPlanVersion) || input.expectedPlanVersion < 0) invalidRequest('expectedPlanVersion')
    const result = parseProcurementOrder(await apiClient.request<unknown>(API_BASE, { method: 'POST', headers: commandHeaders(input.commandId), body: input }))
    if (result.planId !== input.planId || result.supplierId !== input.supplierId) invalid('order.identity')
    return result
  },
  async createDirect(input: { commandId: string; supplierId: string; skuId: string; warehouseId: string; locationId: string; quantity: number; orderNote?: string }) {
    validUuid(input.supplierId, 'supplierId'); validUuid(input.skuId, 'skuId'); validUuid(input.warehouseId, 'warehouseId'); validUuid(input.locationId, 'locationId')
    if (!Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > 1_000_000_000) invalidRequest('quantity')
    const result = parseProcurementOrder(await apiClient.request<unknown>(`${API_BASE}/direct`, {
      method: 'POST',
      headers: commandHeaders(input.commandId),
      body: { ...input, orderNote: input.orderNote?.trim().slice(0, 500) || undefined },
    }))
    if (result.planId !== undefined || result.supplierId !== input.supplierId || result.skuId !== input.skuId || result.warehouseId !== input.warehouseId || result.locationId !== input.locationId || result.quantity !== input.quantity) invalid('order.identity')
    return result
  },
  async receive(input: { commandId: string; purchaseOrderId: string; expectedVersion: number; quantity: number }) {
    validUuid(input.purchaseOrderId, 'purchaseOrderId')
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) invalidRequest('expectedVersion')
    if (!Number.isSafeInteger(input.quantity) || input.quantity < 1) invalidRequest('quantity')
    const body = { commandId: input.commandId, expectedVersion: input.expectedVersion, quantity: input.quantity }
    const result = parseProcurementOrder(await apiClient.request<unknown>(`${API_BASE}/${input.purchaseOrderId}/receipts`, { method: 'POST', headers: commandHeaders(input.commandId), body }))
    if (result.purchaseOrderId !== input.purchaseOrderId) invalid('order.identity')
    return result
  },
  async review(input: { commandId: string; purchaseOrderId: string; expectedVersion: number; approved: boolean; reviewNote?: string }) {
    validUuid(input.purchaseOrderId, 'purchaseOrderId')
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) invalidRequest('expectedVersion')
    const result = parseProcurementOrder(await apiClient.request<unknown>(`${API_BASE}/${input.purchaseOrderId}/review`, {
      method: 'POST',
      headers: commandHeaders(input.commandId),
      body: {
        expectedVersion: input.expectedVersion,
        approved: input.approved,
        reviewNote: input.reviewNote?.trim().slice(0, 500) || undefined,
      },
    }))
    if (result.purchaseOrderId !== input.purchaseOrderId) invalid('order.identity')
    return result
  },
  async suppliers(planId: string, keyword: string | undefined, page: number, size: number) {
    validUuid(planId, 'planId'); validPage(page, size)
    const query = new URLSearchParams({ page: String(page), size: String(size) })
    if (keyword?.trim()) query.set('keyword', keyword.trim().slice(0, 120))
    return requestedPage(parsePage(await apiClient.request<unknown>(`${API_BASE}/references/plans/${planId}/suppliers?${query}`), parseSupplier, (item) => item.supplierId), page, size)
  },
  async suppliersForSku(skuId: string, keyword: string | undefined, page: number, size: number) {
    validUuid(skuId, 'skuId'); validPage(page, size)
    const query = new URLSearchParams({ page: String(page), size: String(size) })
    if (keyword?.trim()) query.set('keyword', keyword.trim().slice(0, 120))
    return requestedPage(parsePage(await apiClient.request<unknown>(`${API_BASE}/references/skus/${skuId}/suppliers?${query}`), parseSupplier, (item) => item.supplierId), page, size)
  },
}
