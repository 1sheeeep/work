import { ApiError, apiClient } from '../api/client'

const API_BASE = '/api/v1/procurement/orders'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export type ProcurementReceiptSort = 'RECEIVED_AT' | 'SKU_CODE' | 'PURCHASE_NO'
export type ProcurementReceipt = {
  receiptId: string; purchaseOrderId: string; purchaseNo: string; planNo?: string
  supplierId: string; supplierCode: string; supplierName: string
  skuId: string; skuCode: string; skuName: string; skuVariant?: string
  warehouseId: string; warehouseCode: string; warehouseName: string
  locationId: string; locationCode: string; locationName: string
  quantity: number; inventoryEventId: string; inventoryLedgerSequence: number
  inventoryBalanceAfter: number; receivedByDisplayName: string; receivedAt: string
}
export type ProcurementReceiptPage = { items: ProcurementReceipt[]; page: number; size: number; totalElements: number; totalPages: number }
export type ProcurementReceiptLedgerExport = {
  filename: 'procurement-receipt-ledger.csv'
  mediaType: 'text/csv;charset=utf-8'
  rowCount: number
  content: string
}
export type ProcurementReceiptLedgerExportRequest = {
  sort: ProcurementReceiptSort
  supplierKeyword?: string
  purchaseKeyword?: string
  receivedFrom?: string
  receivedTo?: string
}

type Wire = Record<string, unknown>
function invalid(field: string): never { throw new ApiError('Invalid procurement receipt response', { status: 502, code: 'invalid_response', details: { field } }) }
function invalidRequest(field: string): never { throw new ApiError('Invalid procurement receipt request', { status: 400, code: 'invalid_request', details: { field } }) }
function record(value: unknown, field: string): Wire { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field); return value as Wire }
function exact(value: Wire, fields: readonly string[], field: string) { if (Object.keys(value).some((key) => !fields.includes(key)) || fields.some((key) => !(key in value))) invalid(`${field}.shape`) }
function text(value: unknown, field: string) { if (typeof value !== 'string' || !value.trim()) invalid(field); return value }
function optionalText(value: unknown, field: string) { return value === null ? undefined : text(value, field) }
function uuid(value: unknown, field: string) { const result = text(value, field); if (!UUID_PATTERN.test(result)) invalid(field); return result }
function integer(value: unknown, field: string) { if (typeof value !== 'number' || !Number.isSafeInteger(value)) invalid(field); return value }
function nonNegative(value: unknown, field: string) { const result = integer(value, field); if (result < 0) invalid(field); return result }
function positive(value: unknown, field: string) { const result = integer(value, field); if (result < 1) invalid(field); return result }
function timestamp(value: unknown, field: string) { const result = text(value, field); if (Number.isNaN(Date.parse(result))) invalid(field); return result }

export function parseProcurementReceipt(value: unknown): ProcurementReceipt {
  const wire = record(value, 'receipt')
  exact(wire, ['receiptId', 'purchaseOrderId', 'purchaseNo', 'planNo', 'supplierId', 'supplierCode', 'supplierName', 'skuId', 'skuCode', 'skuName', 'skuVariant', 'warehouseId', 'warehouseCode', 'warehouseName', 'locationId', 'locationCode', 'locationName', 'quantity', 'inventoryEventId', 'inventoryLedgerSequence', 'inventoryBalanceAfter', 'receivedByDisplayName', 'receivedAt'], 'receipt')
  return {
    receiptId: uuid(wire.receiptId, 'receipt.receiptId'), purchaseOrderId: uuid(wire.purchaseOrderId, 'receipt.purchaseOrderId'), purchaseNo: text(wire.purchaseNo, 'receipt.purchaseNo'), planNo: optionalText(wire.planNo, 'receipt.planNo'),
    supplierId: uuid(wire.supplierId, 'receipt.supplierId'), supplierCode: text(wire.supplierCode, 'receipt.supplierCode'), supplierName: text(wire.supplierName, 'receipt.supplierName'),
    skuId: uuid(wire.skuId, 'receipt.skuId'), skuCode: text(wire.skuCode, 'receipt.skuCode'), skuName: text(wire.skuName, 'receipt.skuName'), skuVariant: optionalText(wire.skuVariant, 'receipt.skuVariant'),
    warehouseId: uuid(wire.warehouseId, 'receipt.warehouseId'), warehouseCode: text(wire.warehouseCode, 'receipt.warehouseCode'), warehouseName: text(wire.warehouseName, 'receipt.warehouseName'),
    locationId: uuid(wire.locationId, 'receipt.locationId'), locationCode: text(wire.locationCode, 'receipt.locationCode'), locationName: text(wire.locationName, 'receipt.locationName'),
    quantity: positive(wire.quantity, 'receipt.quantity'), inventoryEventId: uuid(wire.inventoryEventId, 'receipt.inventoryEventId'), inventoryLedgerSequence: positive(wire.inventoryLedgerSequence, 'receipt.inventoryLedgerSequence'), inventoryBalanceAfter: integer(wire.inventoryBalanceAfter, 'receipt.inventoryBalanceAfter'), receivedByDisplayName: text(wire.receivedByDisplayName, 'receipt.receivedByDisplayName'), receivedAt: timestamp(wire.receivedAt, 'receipt.receivedAt'),
  }
}

function parsePage(value: unknown): ProcurementReceiptPage {
  const wire = record(value, 'page')
  exact(wire, ['items', 'page', 'size', 'totalElements', 'totalPages'], 'page')
  if (!Array.isArray(wire.items)) invalid('page.items')
  const result = { items: wire.items.map(parseProcurementReceipt), page: nonNegative(wire.page, 'page.page'), size: positive(wire.size, 'page.size'), totalElements: nonNegative(wire.totalElements, 'page.totalElements'), totalPages: nonNegative(wire.totalPages, 'page.totalPages') }
  if (result.items.length > result.size || (result.page >= result.totalPages && result.items.length > 0)) invalid('page.identity')
  const expectedTotalPages = result.totalElements === 0 ? 0 : Math.ceil(result.totalElements / result.size)
  if (result.totalPages !== expectedTotalPages || result.items.length > result.totalElements) invalid('page.cardinality')
  if (new Set(result.items.map((item) => item.receiptId)).size !== result.items.length) invalid('page.items.identity')
  return result
}

function parseLedgerExport(value: unknown): ProcurementReceiptLedgerExport {
  const wire = record(value, 'export')
  exact(wire, ['filename', 'mediaType', 'rowCount', 'content'], 'export')
  const filename = text(wire.filename, 'export.filename')
  const mediaType = text(wire.mediaType, 'export.mediaType')
  const rowCount = nonNegative(wire.rowCount, 'export.rowCount')
  const content = typeof wire.content === 'string'
    ? wire.content
    : invalid('export.content')
  if (filename !== 'procurement-receipt-ledger.csv'
    || mediaType !== 'text/csv;charset=utf-8'
    || rowCount > 10_000
    || content.length > 30_000_000
    || !content.startsWith('\uFEFF入库时间,采购单号,计划编号,供应商编码,供应商名称,SKU编号,SKU名称,规格,仓库编码,仓库名称,库位编码,库位名称,本次入库,入库后库存,库存事件序号,库存事件ID,操作人\r\n')) {
    invalid('export.contract')
  }
  return {
    filename: 'procurement-receipt-ledger.csv',
    mediaType: 'text/csv;charset=utf-8',
    rowCount,
    content,
  }
}

function validUuid(value: string, field: string) { if (!UUID_PATTERN.test(value)) invalidRequest(field) }
function validPage(page: number, size: number) { if (!Number.isSafeInteger(page) || page < 0 || !Number.isSafeInteger(size) || size < 1 || size > 200) invalidRequest('page') }
function validReceiptWindow(receivedFrom?: string, receivedTo?: string) {
  const from = receivedFrom ? Date.parse(receivedFrom) : undefined
  const to = receivedTo ? Date.parse(receivedTo) : undefined
  if ((from !== undefined && Number.isNaN(from))
    || (to !== undefined && Number.isNaN(to))
    || (from !== undefined && to !== undefined && from > to)) {
    invalidRequest('receivedWindow')
  }
}

export const procurementReceiptApi = {
  async list(request: { sort: ProcurementReceiptSort; supplierKeyword?: string; purchaseKeyword?: string; receivedFrom?: string; receivedTo?: string; page: number; size: number; signal?: AbortSignal }) {
    validPage(request.page, request.size)
    const query = new URLSearchParams({ sort: request.sort, page: String(request.page), size: String(request.size) })
    if (request.supplierKeyword?.trim()) query.set('supplierKeyword', request.supplierKeyword.trim().slice(0, 120))
    if (request.purchaseKeyword?.trim()) query.set('purchaseKeyword', request.purchaseKeyword.trim().slice(0, 120))
    if (request.receivedFrom) query.set('receivedFrom', request.receivedFrom)
    if (request.receivedTo) query.set('receivedTo', request.receivedTo)
    const result = parsePage(await apiClient.request<unknown>(`${API_BASE}/receipts?${query}`, { signal: request.signal }))
    if (result.page !== request.page || result.size !== request.size) invalid('page.requestIdentity')
    return result
  },
  async exportLedgerCsv(
    request: ProcurementReceiptLedgerExportRequest,
  ): Promise<ProcurementReceiptLedgerExport> {
    validReceiptWindow(request.receivedFrom, request.receivedTo)
    return parseLedgerExport(await apiClient.request<unknown>(
      `${API_BASE}/receipts/exports`,
      {
        method: 'POST',
        body: {
          supplierKeyword: request.supplierKeyword?.trim().slice(0, 120)
            || undefined,
          purchaseKeyword: request.purchaseKeyword?.trim().slice(0, 120)
            || undefined,
          receivedFrom: request.receivedFrom,
          receivedTo: request.receivedTo,
          sort: request.sort,
        },
      },
    ))
  },
  async forOrder(purchaseOrderId: string, page = 0, size = 50, signal?: AbortSignal) {
    validUuid(purchaseOrderId, 'purchaseOrderId'); validPage(page, size)
    const query = new URLSearchParams({ page: String(page), size: String(size) })
    const result = parsePage(await apiClient.request<unknown>(`${API_BASE}/${purchaseOrderId}/receipts?${query}`, { signal }))
    if (result.page !== page || result.size !== size) invalid('page.requestIdentity')
    if (result.items.some((item) => item.purchaseOrderId !== purchaseOrderId)) invalid('receipt.purchaseOrderId')
    return result
  },
}
