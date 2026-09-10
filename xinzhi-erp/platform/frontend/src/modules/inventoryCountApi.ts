import { apiClient } from '../api/client'

const API_BASE = '/api/v1/inventory-center/counts'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type InventoryCountStatus = 'PENDING' | 'APPROVAL' | 'COMPLETED' | 'REJECTED' | 'CANCELLED'
export type InventoryCountSearchField = 'BATCH' | 'SKU' | 'REMARK' | 'OPERATOR'

export type InventoryCountSummary = {
  id: string
  countNo: string
  warehouseId: string
  warehouseCode: string
  warehouseName: string
  status: InventoryCountStatus
  countDate: string
  note?: string
  lineCount: number
  totalDifference: number
  version: number
  operatorDisplayName: string
  approverDisplayName?: string
  createdAt: string
  updatedAt: string
}

export type InventoryCountLine = {
  id: string
  balanceId: string
  skuId: string
  skuCode: string
  skuName: string
  expectedBalanceVersion: number
  snapshotOnHand: number
  snapshotReserved: number
  snapshotAvailable: number
  countedOnHand: number
  difference: number
  resultEventId?: string
}

export type InventoryCountDetail = {
  summary: InventoryCountSummary
  lines: InventoryCountLine[]
}

export type InventoryCountPage = {
  items: InventoryCountSummary[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}

export type InventoryCountListRequest = {
  warehouseId?: string
  status?: InventoryCountStatus
  searchField: InventoryCountSearchField
  keyword?: string
  from?: string
  to?: string
  differenceMin?: number
  differenceMax?: number
  page: number
  size: number
}

export type InventoryCountExportRequest = Omit<
  InventoryCountListRequest,
  'page' | 'size'
>

export type InventoryCountExport = {
  filename: 'inventory-counts.csv'
  mediaType: 'text/csv;charset=utf-8'
  rowCount: number
  content: string
}

type UnknownRecord = Record<string, unknown>

function invalid(field: string): never { throw new Error(`Invalid inventory count response: ${field}`) }
function invalidRequest(field: string): never { throw new Error(`Invalid inventory count request: ${field}`) }
function record(value: unknown, field: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid(field)
  return value as UnknownRecord
}
function string(value: unknown, field: string) { return typeof value === 'string' && value.length > 0 ? value : invalid(field) }
function optionalString(value: unknown, field: string) { return value == null ? undefined : string(value, field) }
function uuid(value: unknown, field: string) { const result = string(value, field); return UUID_PATTERN.test(result) ? result : invalid(field) }
function integer(value: unknown, field: string) { return typeof value === 'number' && Number.isSafeInteger(value) ? value : invalid(field) }
function nonNegative(value: unknown, field: string) { const result = integer(value, field); return result >= 0 ? result : invalid(field) }
function timestamp(value: unknown, field: string) { const result = string(value, field); return Number.isNaN(Date.parse(result)) ? invalid(field) : result }
function date(value: unknown, field: string) {
  const result = string(value, field)
  return /^\d{4}-\d{2}-\d{2}$/.test(result) && !Number.isNaN(Date.parse(`${result}T00:00:00Z`)) ? result : invalid(field)
}
function status(value: unknown, field: string): InventoryCountStatus {
  return value === 'PENDING' || value === 'APPROVAL' || value === 'COMPLETED' || value === 'REJECTED' || value === 'CANCELLED' ? value : invalid(field)
}

function mapSummary(value: unknown): InventoryCountSummary {
  const wire = record(value, 'summary')
  return {
    id: uuid(wire.id, 'summary.id'),
    countNo: string(wire.countNo, 'summary.countNo'),
    warehouseId: uuid(wire.warehouseId, 'summary.warehouseId'),
    warehouseCode: string(wire.warehouseCode, 'summary.warehouseCode'),
    warehouseName: string(wire.warehouseName, 'summary.warehouseName'),
    status: status(wire.status, 'summary.status'),
    countDate: date(wire.countDate, 'summary.countDate'),
    note: optionalString(wire.note, 'summary.note'),
    lineCount: nonNegative(wire.lineCount, 'summary.lineCount'),
    totalDifference: integer(wire.totalDifference, 'summary.totalDifference'),
    version: nonNegative(wire.version, 'summary.version'),
    operatorDisplayName: string(wire.operatorDisplayName, 'summary.operatorDisplayName'),
    approverDisplayName: optionalString(wire.approverDisplayName, 'summary.approverDisplayName'),
    createdAt: timestamp(wire.createdAt, 'summary.createdAt'),
    updatedAt: timestamp(wire.updatedAt, 'summary.updatedAt'),
  }
}

function mapLine(value: unknown): InventoryCountLine {
  const wire = record(value, 'line')
  const snapshotOnHand = integer(wire.snapshotOnHand, 'line.snapshotOnHand')
  const snapshotReserved = integer(wire.snapshotReserved, 'line.snapshotReserved')
  const snapshotAvailable = integer(wire.snapshotAvailable, 'line.snapshotAvailable')
  const countedOnHand = integer(wire.countedOnHand, 'line.countedOnHand')
  const difference = integer(wire.difference, 'line.difference')
  if (snapshotAvailable !== snapshotOnHand - snapshotReserved || difference !== countedOnHand - snapshotOnHand) return invalid('line.quantities')
  return {
    id: uuid(wire.id, 'line.id'), balanceId: uuid(wire.balanceId, 'line.balanceId'),
    skuId: uuid(wire.skuId, 'line.skuId'), skuCode: string(wire.skuCode, 'line.skuCode'),
    skuName: string(wire.skuName, 'line.skuName'), expectedBalanceVersion: nonNegative(wire.expectedBalanceVersion, 'line.expectedBalanceVersion'),
    snapshotOnHand, snapshotReserved, snapshotAvailable, countedOnHand, difference,
    resultEventId: wire.resultEventId == null ? undefined : uuid(wire.resultEventId, 'line.resultEventId'),
  }
}

function mapDetail(value: unknown): InventoryCountDetail {
  const wire = record(value, 'detail')
  if (!Array.isArray(wire.lines)) return invalid('detail.lines')
  const summary = mapSummary(wire.summary)
  const lines = wire.lines.map(mapLine)
  if (summary.lineCount !== lines.length || lines.some((line) => line.difference + line.snapshotOnHand !== line.countedOnHand)) return invalid('detail.identity')
  return { summary, lines }
}

function mapExport(value: unknown): InventoryCountExport {
  const wire = record(value, 'export')
  const filename = string(wire.filename, 'export.filename')
  const mediaType = string(wire.mediaType, 'export.mediaType')
  const rowCount = nonNegative(wire.rowCount, 'export.rowCount')
  const content = typeof wire.content === 'string' ? wire.content : invalid('export.content')
  if (filename !== 'inventory-counts.csv'
    || mediaType !== 'text/csv;charset=utf-8'
    || rowCount > 10_000
    || content.length > 30_000_000
    || !content.startsWith('\uFEFF盘点批次,仓库编码,仓库名称,状态,盘点日期,备注,SKU个数,总差值,操作人,审批人,创建时间,更新时间\r\n')) {
    return invalid('export.contract')
  }
  return { filename, mediaType, rowCount, content }
}

function commandHeaders(commandId: string) {
  if (!UUID_PATTERN.test(commandId)) return invalidRequest('commandId')
  return { 'X-Request-Id': `count.${commandId}` }
}

export const inventoryCountApi = {
  async list(request: InventoryCountListRequest): Promise<InventoryCountPage> {
    if (!Number.isSafeInteger(request.page) || request.page < 0 || !Number.isSafeInteger(request.size) || request.size < 1 || request.size > 200) return invalidRequest('page')
    const query = new URLSearchParams({ searchField: request.searchField, page: String(request.page), size: String(request.size) })
    if (request.warehouseId) { if (!UUID_PATTERN.test(request.warehouseId)) return invalidRequest('warehouseId'); query.set('warehouseId', request.warehouseId) }
    if (request.status) query.set('status', request.status)
    if (request.keyword?.trim()) query.set('keyword', request.keyword.trim())
    if (request.from) query.set('from', request.from)
    if (request.to) query.set('to', request.to)
    if (request.differenceMin !== undefined) query.set('differenceMin', String(request.differenceMin))
    if (request.differenceMax !== undefined) query.set('differenceMax', String(request.differenceMax))
    const wire = record(await apiClient.request<unknown>(`${API_BASE}?${query}`), 'page')
    if (!Array.isArray(wire.items)) return invalid('page.items')
    return { items: wire.items.map(mapSummary), page: nonNegative(wire.page, 'page.page'), size: nonNegative(wire.size, 'page.size'), totalElements: nonNegative(wire.totalElements, 'page.totalElements'), totalPages: nonNegative(wire.totalPages, 'page.totalPages') }
  },

  async exportCsv(request: InventoryCountExportRequest): Promise<InventoryCountExport> {
    if (request.warehouseId && !UUID_PATTERN.test(request.warehouseId)) return invalidRequest('warehouseId')
    return mapExport(await apiClient.request<unknown>(`${API_BASE}/exports`, {
      method: 'POST',
      body: {
        warehouseId: request.warehouseId,
        status: request.status,
        searchField: request.searchField,
        keyword: request.keyword?.trim().slice(0, 100) || undefined,
        from: request.from,
        to: request.to,
        differenceMin: request.differenceMin,
        differenceMax: request.differenceMax,
      },
    }))
  },

  async get(countId: string) {
    if (!UUID_PATTERN.test(countId)) return invalidRequest('countId')
    const detail = mapDetail(await apiClient.request<unknown>(`${API_BASE}/${countId}`))
    if (detail.summary.id !== countId) return invalid('detail.summary.id')
    return detail
  },

  async create(input: { commandId: string; warehouseId: string; countDate: string; note?: string; submit: boolean; lines: Array<{ balanceId: string; countedOnHand: number }> }) {
    if (!UUID_PATTERN.test(input.warehouseId) || !input.lines.length || input.lines.length > 200) return invalidRequest('create')
    input.lines.forEach((line) => { if (!UUID_PATTERN.test(line.balanceId) || !Number.isSafeInteger(line.countedOnHand)) invalidRequest('line') })
    return mapDetail(await apiClient.request<unknown>(API_BASE, { method: 'POST', headers: commandHeaders(input.commandId), body: input }))
  },

  async transition(countId: string, action: 'submit' | 'approve' | 'reject' | 'cancel', expectedVersion: number, commandId: string) {
    if (!UUID_PATTERN.test(countId) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) return invalidRequest('transition')
    const detail = mapDetail(await apiClient.request<unknown>(`${API_BASE}/${countId}/${action}`, { method: 'POST', headers: commandHeaders(commandId), body: { commandId, expectedVersion } }))
    if (detail.summary.id !== countId) return invalid('detail.summary.id')
    return detail
  },
}
