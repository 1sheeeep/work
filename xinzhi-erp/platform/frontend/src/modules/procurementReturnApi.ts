import { ApiError, apiClient } from '../api/client'

const API_BASE = '/api/v1/procurement/orders/returns'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type ProcurementReturnSearchField = 'RETURN_NO' | 'PURCHASE_NO' | 'SKU_CODE' | 'SKU_NAME' | 'SUPPLIER_NAME' | 'RETURNED_BY'
export type ProcurementReturn = {
  purchaseReturnId: string; returnNo: string; purchaseOrderId: string; purchaseNo: string; planNo?: string
  supplierId: string; supplierCode: string; supplierName: string; skuId: string; skuCode: string; skuName: string; skuVariant?: string
  warehouseId: string; warehouseCode: string; warehouseName: string; locationId: string; locationCode: string; locationName: string
  quantity: number; reason: string; inventoryEventId: string; inventoryLedgerSequence: number; inventoryBalanceAfter: number
  returnedByDisplayName: string; returnedAt: string
}
export type ProcurementReturnableOrder = {
  purchaseOrderId: string; purchaseNo: string; supplierCode: string; supplierName: string; skuId: string; skuCode: string; skuName: string; skuVariant?: string
  warehouseId: string; warehouseCode: string; warehouseName: string; locationId: string; locationCode: string; locationName: string
  receivedQuantity: number; returnedQuantity: number; returnableQuantity: number; version: number
}
export type ProcurementReturnPage<T = ProcurementReturn> = { items: T[]; page: number; size: number; totalElements: number; totalPages: number }

type Wire = Record<string, unknown>
function invalid(field: string): never { throw new ApiError('Invalid procurement return response', { status: 502, code: 'invalid_response', details: { field } }) }
function invalidRequest(field: string): never { throw new ApiError('Invalid procurement return request', { status: 400, code: 'invalid_request', details: { field } }) }
function record(value: unknown, field: string): Wire { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field); return value as Wire }
function exact(value: Wire, fields: readonly string[], field: string) { if (Object.keys(value).some((key) => !fields.includes(key)) || fields.some((key) => !(key in value))) invalid(`${field}.shape`) }
function text(value: unknown, field: string) { if (typeof value !== 'string' || !value.trim()) invalid(field); return value }
function optionalText(value: unknown, field: string) { if (value === null) return undefined; return text(value, field) }
function uuid(value: unknown, field: string) { const result = text(value, field); if (!UUID_PATTERN.test(result)) invalid(field); return result }
function nonNegative(value: unknown, field: string) { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid(field); return value }
function positive(value: unknown, field: string) { const result = nonNegative(value, field); if (result < 1) invalid(field); return result }
function timestamp(value: unknown, field: string) { const result = text(value, field); if (Number.isNaN(Date.parse(result))) invalid(field); return result }

export function parseProcurementReturn(value: unknown): ProcurementReturn {
  const wire = record(value, 'return')
  exact(wire, ['purchaseReturnId', 'returnNo', 'purchaseOrderId', 'purchaseNo', 'planNo', 'supplierId', 'supplierCode', 'supplierName', 'skuId', 'skuCode', 'skuName', 'skuVariant', 'warehouseId', 'warehouseCode', 'warehouseName', 'locationId', 'locationCode', 'locationName', 'quantity', 'reason', 'inventoryEventId', 'inventoryLedgerSequence', 'inventoryBalanceAfter', 'returnedByDisplayName', 'returnedAt'], 'return')
  return {
    purchaseReturnId: uuid(wire.purchaseReturnId, 'return.purchaseReturnId'), returnNo: text(wire.returnNo, 'return.returnNo'), purchaseOrderId: uuid(wire.purchaseOrderId, 'return.purchaseOrderId'), purchaseNo: text(wire.purchaseNo, 'return.purchaseNo'), planNo: optionalText(wire.planNo, 'return.planNo'),
    supplierId: uuid(wire.supplierId, 'return.supplierId'), supplierCode: text(wire.supplierCode, 'return.supplierCode'), supplierName: text(wire.supplierName, 'return.supplierName'), skuId: uuid(wire.skuId, 'return.skuId'), skuCode: text(wire.skuCode, 'return.skuCode'), skuName: text(wire.skuName, 'return.skuName'), skuVariant: optionalText(wire.skuVariant, 'return.skuVariant'),
    warehouseId: uuid(wire.warehouseId, 'return.warehouseId'), warehouseCode: text(wire.warehouseCode, 'return.warehouseCode'), warehouseName: text(wire.warehouseName, 'return.warehouseName'), locationId: uuid(wire.locationId, 'return.locationId'), locationCode: text(wire.locationCode, 'return.locationCode'), locationName: text(wire.locationName, 'return.locationName'),
    quantity: positive(wire.quantity, 'return.quantity'), reason: text(wire.reason, 'return.reason'), inventoryEventId: uuid(wire.inventoryEventId, 'return.inventoryEventId'), inventoryLedgerSequence: positive(wire.inventoryLedgerSequence, 'return.inventoryLedgerSequence'), inventoryBalanceAfter: typeof wire.inventoryBalanceAfter === 'number' && Number.isSafeInteger(wire.inventoryBalanceAfter) ? wire.inventoryBalanceAfter : invalid('return.inventoryBalanceAfter'), returnedByDisplayName: text(wire.returnedByDisplayName, 'return.returnedByDisplayName'), returnedAt: timestamp(wire.returnedAt, 'return.returnedAt'),
  }
}

export function parseProcurementReturnableOrder(value: unknown): ProcurementReturnableOrder {
  const wire = record(value, 'order')
  exact(wire, ['purchaseOrderId', 'purchaseNo', 'supplierCode', 'supplierName', 'skuId', 'skuCode', 'skuName', 'skuVariant', 'warehouseId', 'warehouseCode', 'warehouseName', 'locationId', 'locationCode', 'locationName', 'receivedQuantity', 'returnedQuantity', 'returnableQuantity', 'version'], 'order')
  const receivedQuantity = positive(wire.receivedQuantity, 'order.receivedQuantity')
  const returnedQuantity = nonNegative(wire.returnedQuantity, 'order.returnedQuantity')
  const returnableQuantity = positive(wire.returnableQuantity, 'order.returnableQuantity')
  if (returnedQuantity + returnableQuantity !== receivedQuantity) invalid('order.quantities')
  return {
    purchaseOrderId: uuid(wire.purchaseOrderId, 'order.purchaseOrderId'), purchaseNo: text(wire.purchaseNo, 'order.purchaseNo'), supplierCode: text(wire.supplierCode, 'order.supplierCode'), supplierName: text(wire.supplierName, 'order.supplierName'), skuId: uuid(wire.skuId, 'order.skuId'), skuCode: text(wire.skuCode, 'order.skuCode'), skuName: text(wire.skuName, 'order.skuName'), skuVariant: optionalText(wire.skuVariant, 'order.skuVariant'),
    warehouseId: uuid(wire.warehouseId, 'order.warehouseId'), warehouseCode: text(wire.warehouseCode, 'order.warehouseCode'), warehouseName: text(wire.warehouseName, 'order.warehouseName'), locationId: uuid(wire.locationId, 'order.locationId'), locationCode: text(wire.locationCode, 'order.locationCode'), locationName: text(wire.locationName, 'order.locationName'), receivedQuantity, returnedQuantity, returnableQuantity, version: nonNegative(wire.version, 'order.version'),
  }
}

function parsePage<T>(value: unknown, item: (value: unknown) => T, identity: (item: T) => string): ProcurementReturnPage<T> {
  const wire = record(value, 'page')
  exact(wire, ['items', 'page', 'size', 'totalElements', 'totalPages'], 'page')
  if (!Array.isArray(wire.items)) invalid('page.items')
  const result = { items: wire.items.map(item), page: nonNegative(wire.page, 'page.page'), size: positive(wire.size, 'page.size'), totalElements: nonNegative(wire.totalElements, 'page.totalElements'), totalPages: nonNegative(wire.totalPages, 'page.totalPages') }
  if (result.items.length > result.size || new Set(result.items.map(identity)).size !== result.items.length) invalid('page.items')
  if (result.totalPages !== (result.totalElements === 0 ? 0 : Math.ceil(result.totalElements / result.size))) invalid('page.cardinality')
  return result
}
function validPage(page: number, size: number) { if (!Number.isSafeInteger(page) || page < 0 || !Number.isSafeInteger(size) || size < 1 || size > 200) invalidRequest('page') }
function validUuid(value: string, field: string) { if (!UUID_PATTERN.test(value)) invalidRequest(field) }

export const procurementReturnApi = {
  async list(request: { searchField: ProcurementReturnSearchField; keyword?: string; returnedFrom?: string; returnedTo?: string; page: number; size: number; signal?: AbortSignal }) {
    validPage(request.page, request.size)
    const query = new URLSearchParams({ searchField: request.searchField, page: String(request.page), size: String(request.size) })
    if (request.keyword?.trim()) query.set('keyword', request.keyword.trim().slice(0, 120))
    if (request.returnedFrom) query.set('returnedFrom', request.returnedFrom)
    if (request.returnedTo) query.set('returnedTo', request.returnedTo)
    const result = parsePage(await apiClient.request<unknown>(`${API_BASE}?${query}`, { signal: request.signal }), parseProcurementReturn, (item) => item.purchaseReturnId)
    if (result.page !== request.page || result.size !== request.size) invalid('page.requestIdentity')
    return result
  },
  async returnableOrders(keyword: string | undefined, page: number, size: number, signal?: AbortSignal) {
    validPage(page, size)
    const query = new URLSearchParams({ page: String(page), size: String(size) })
    if (keyword?.trim()) query.set('keyword', keyword.trim().slice(0, 120))
    const result = parsePage(await apiClient.request<unknown>(`${API_BASE}/references/orders?${query}`, { signal }), parseProcurementReturnableOrder, (item) => item.purchaseOrderId)
    if (result.page !== page || result.size !== size) invalid('page.requestIdentity')
    return result
  },
  async create(input: { commandId: string; purchaseOrderId: string; expectedOrderVersion: number; quantity: number; reason: string }) {
    validUuid(input.commandId, 'commandId'); validUuid(input.purchaseOrderId, 'purchaseOrderId')
    if (!Number.isSafeInteger(input.expectedOrderVersion) || input.expectedOrderVersion < 0) invalidRequest('expectedOrderVersion')
    if (!Number.isSafeInteger(input.quantity) || input.quantity < 1) invalidRequest('quantity')
    const reason = input.reason.trim().slice(0, 500)
    if (!reason) invalidRequest('reason')
    const result = parseProcurementReturn(await apiClient.request<unknown>(API_BASE, { method: 'POST', headers: { 'X-Request-Id': `procurement-return.${input.commandId}` }, body: { ...input, reason } }))
    if (result.purchaseOrderId !== input.purchaseOrderId || result.quantity !== input.quantity) invalid('return.identity')
    return result
  },
}
