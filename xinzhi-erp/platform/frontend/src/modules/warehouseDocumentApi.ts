import { apiClient } from '../api/client'

const API_BASE = '/api/v1/inventory-center/documents'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type WarehouseDocumentSource =
  | 'MANUAL_MOVEMENT'
  | 'PROCUREMENT_RECEIPT'
  | 'WAREHOUSE_TRANSFER'
  | 'ORDER_FULFILLMENT'
  | 'INVENTORY_COUNT'
export type WarehouseDocumentDirection = 'INBOUND' | 'OUTBOUND'
export type WarehouseDocumentStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'POSTED'
  | 'PARTIALLY_REVERSED'
  | 'REVERSED'
  | 'CANCELLED'
export type WarehouseDocumentApprovalStatus =
  | 'NOT_REQUIRED'
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
export type WarehouseDocumentSearchField =
  | 'DOCUMENT_NO'
  | 'SKU'
  | 'LOCATION'
  | 'NOTE'
  | 'OPERATOR'

export type WarehouseDocument = {
  id: string
  relatedDocumentId: string
  source: WarehouseDocumentSource
  direction: WarehouseDocumentDirection
  documentNo: string
  sourceReference?: string
  documentType: string
  warehouseId: string
  warehouseCode: string
  warehouseName: string
  status: WarehouseDocumentStatus
  approvalStatus: WarehouseDocumentApprovalStatus
  lineCount: number
  totalQuantity: number
  totalAmount?: number
  currency?: string
  operatorDisplayName: string
  occurredAt: string
  postedAt?: string
}

export type WarehouseDocumentPage = {
  items: WarehouseDocument[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}

export type WarehouseDocumentListRequest = {
  warehouseId?: string
  direction: WarehouseDocumentDirection
  source?: WarehouseDocumentSource
  status?: WarehouseDocumentStatus
  approvalStatus?: WarehouseDocumentApprovalStatus
  searchField: WarehouseDocumentSearchField
  keyword?: string
  occurredFrom?: string
  occurredTo?: string
  page: number
  size: number
  signal?: AbortSignal
}

export type WarehouseDocumentExportRequest = Omit<
  WarehouseDocumentListRequest,
  'page' | 'size' | 'signal'
>

export type WarehouseDocumentExport = {
  filename: string
  mediaType: 'text/csv;charset=utf-8'
  rowCount: number
  content: string
}

type UnknownRecord = Record<string, unknown>

function invalid(field: string): never {
  throw new Error(`Invalid warehouse document response: ${field}`)
}
function invalidRequest(field: string): never {
  throw new Error(`Invalid warehouse document request: ${field}`)
}
function record(value: unknown, field: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid(field)
  return value as UnknownRecord
}
function text(value: unknown, field: string) {
  return typeof value === 'string' && value.trim() ? value : invalid(field)
}
function optionalText(value: unknown, field: string) {
  return value == null ? undefined : text(value, field)
}
function uuid(value: unknown, field: string) {
  const result = text(value, field)
  return UUID_PATTERN.test(result) ? result : invalid(field)
}
function nonNegative(value: unknown, field: string) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : invalid(field)
}
function finiteNonNegative(value: unknown, field: string) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : invalid(field)
}
function timestamp(value: unknown, field: string) {
  const result = text(value, field)
  return Number.isNaN(Date.parse(result)) ? invalid(field) : result
}
function optionalTimestamp(value: unknown, field: string) {
  return value == null ? undefined : timestamp(value, field)
}
function enumValue<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  return typeof value === 'string' && allowed.includes(value as T)
    ? value as T
    : invalid(field)
}

const sources: WarehouseDocumentSource[] = [
  'MANUAL_MOVEMENT',
  'PROCUREMENT_RECEIPT',
  'WAREHOUSE_TRANSFER',
  'ORDER_FULFILLMENT',
  'INVENTORY_COUNT',
]
const directions: WarehouseDocumentDirection[] = ['INBOUND', 'OUTBOUND']
const statuses: WarehouseDocumentStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'POSTED',
  'PARTIALLY_REVERSED',
  'REVERSED',
  'CANCELLED',
]
const approvalStatuses: WarehouseDocumentApprovalStatus[] = ['NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED']

function mapDocument(value: unknown): WarehouseDocument {
  const wire = record(value, 'document')
  const totalAmount = wire.totalAmount == null
    ? undefined
    : finiteNonNegative(wire.totalAmount, 'document.totalAmount')
  const currency = optionalText(wire.currency, 'document.currency')
  if ((totalAmount === undefined) !== (currency === undefined)) {
    return invalid('document.money')
  }
  if (currency && !/^[A-Z]{3}$/.test(currency)) return invalid('document.currency')
  return {
    id: uuid(wire.id, 'document.id'),
    relatedDocumentId: uuid(wire.relatedDocumentId, 'document.relatedDocumentId'),
    source: enumValue(wire.source, sources, 'document.source'),
    direction: enumValue(wire.direction, directions, 'document.direction'),
    documentNo: text(wire.documentNo, 'document.documentNo'),
    sourceReference: optionalText(wire.sourceReference, 'document.sourceReference'),
    documentType: text(wire.documentType, 'document.documentType'),
    warehouseId: uuid(wire.warehouseId, 'document.warehouseId'),
    warehouseCode: text(wire.warehouseCode, 'document.warehouseCode'),
    warehouseName: text(wire.warehouseName, 'document.warehouseName'),
    status: enumValue(wire.status, statuses, 'document.status'),
    approvalStatus: enumValue(wire.approvalStatus, approvalStatuses, 'document.approvalStatus'),
    lineCount: nonNegative(wire.lineCount, 'document.lineCount'),
    totalQuantity: nonNegative(wire.totalQuantity, 'document.totalQuantity'),
    totalAmount,
    currency,
    operatorDisplayName: text(wire.operatorDisplayName, 'document.operatorDisplayName'),
    occurredAt: timestamp(wire.occurredAt, 'document.occurredAt'),
    postedAt: optionalTimestamp(wire.postedAt, 'document.postedAt'),
  }
}

function validateFilters(request: WarehouseDocumentExportRequest) {
  if (request.warehouseId && !UUID_PATTERN.test(request.warehouseId)) {
    return invalidRequest('warehouseId')
  }
}

function mapExport(value: unknown): WarehouseDocumentExport {
  const wire = record(value, 'export')
  const filename = text(wire.filename, 'export.filename')
  const mediaType = text(wire.mediaType, 'export.mediaType')
  const rowCount = nonNegative(wire.rowCount, 'export.rowCount')
  const content = typeof wire.content === 'string'
    ? wire.content
    : invalid('export.content')
  if (!/^warehouse-documents-(?:inbound|outbound)\.csv$/.test(filename)
    || mediaType !== 'text/csv;charset=utf-8'
    || rowCount > 10_000
    || content.length > 50_000_000
    || !content.startsWith('\uFEFF单号,单据方向,')) {
    return invalid('export.contract')
  }
  return { filename, mediaType, rowCount, content }
}

export const warehouseDocumentApi = {
  async list(request: WarehouseDocumentListRequest): Promise<WarehouseDocumentPage> {
    if (!Number.isSafeInteger(request.page) || request.page < 0
      || !Number.isSafeInteger(request.size) || request.size < 1 || request.size > 200) {
      return invalidRequest('page')
    }
    if (request.warehouseId && !UUID_PATTERN.test(request.warehouseId)) {
      return invalidRequest('warehouseId')
    }
    const query = new URLSearchParams({
      direction: request.direction,
      searchField: request.searchField,
      page: String(request.page),
      size: String(request.size),
    })
    if (request.warehouseId) query.set('warehouseId', request.warehouseId)
    if (request.source) query.set('source', request.source)
    if (request.status) query.set('status', request.status)
    if (request.approvalStatus) query.set('approvalStatus', request.approvalStatus)
    if (request.keyword?.trim()) query.set('keyword', request.keyword.trim().slice(0, 100))
    if (request.occurredFrom) query.set('occurredFrom', request.occurredFrom)
    if (request.occurredTo) query.set('occurredTo', request.occurredTo)
    const wire = record(await apiClient.request<unknown>(
      `${API_BASE}?${query}`,
      { signal: request.signal },
    ), 'page')
    if (!Array.isArray(wire.items)) return invalid('page.items')
    const items = wire.items.map(mapDocument)
    const page = nonNegative(wire.page, 'page.page')
    const size = nonNegative(wire.size, 'page.size')
    const totalElements = nonNegative(wire.totalElements, 'page.totalElements')
    const totalPages = nonNegative(wire.totalPages, 'page.totalPages')
    if (page !== request.page || size !== request.size
      || items.length > size || (totalElements === 0) !== (totalPages === 0)) {
      return invalid('page.identity')
    }
    return { items, page, size, totalElements, totalPages }
  },

  async exportCsv(
    request: WarehouseDocumentExportRequest,
  ): Promise<WarehouseDocumentExport> {
    validateFilters(request)
    return mapExport(await apiClient.request<unknown>(`${API_BASE}/exports`, {
      method: 'POST',
      body: {
        warehouseId: request.warehouseId,
        direction: request.direction,
        source: request.source,
        status: request.status,
        approvalStatus: request.approvalStatus,
        searchField: request.searchField,
        keyword: request.keyword?.trim().slice(0, 100) || undefined,
        occurredFrom: request.occurredFrom,
        occurredTo: request.occurredTo,
      },
    }))
  },
}
