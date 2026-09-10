import { apiClient } from '../api/client'

const API_BASE = '/api/v1/inventory-center/transfers'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export type WarehouseTransferStatus = 'DRAFT' | 'APPROVAL' | 'READY_TO_SHIP' | 'IN_TRANSIT' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'REJECTED' | 'CANCELLED'
export type WarehouseTransferTransportMode = 'UNSET' | 'LAND' | 'AIR' | 'SEA'
export type WarehouseTransferAllocationMethod = 'WEIGHT' | 'VOLUMETRIC_WEIGHT' | 'VOLUME'
export type WarehouseTransferSearchField = 'BATCH' | 'SKU' | 'REMARK' | 'OPERATOR'
export type WarehouseTransferAction = 'submit' | 'approve' | 'reject' | 'ship' | 'receive' | 'cancel'

export type WarehouseTransferSummary = {
  id: string
  transferNo: string
  status: WarehouseTransferStatus
  transferDate: string
  sourceWarehouseId: string
  sourceWarehouseCode: string
  sourceWarehouseName: string
  targetWarehouseId: string
  targetWarehouseCode: string
  targetWarehouseName: string
  transportMode: WarehouseTransferTransportMode
  freightAmountMinor?: number
  currencyCode?: string
  logisticsChannel?: string
  trackingNo?: string
  allocationMethod: WarehouseTransferAllocationMethod
  expectedShipAt?: string
  expectedArrivalAt?: string
  note?: string
  lineCount: number
  totalQuantity: number
  version: number
  operatorDisplayName: string
  approverDisplayName?: string
  shipperDisplayName?: string
  receiverDisplayName?: string
  createdAt: string
  updatedAt: string
}

export type WarehouseTransferLine = {
  id: string
  sourceBalanceId: string
  skuId: string
  skuCode: string
  skuName: string
  snapshotBalanceVersion: number
  snapshotOnHand: number
  snapshotReserved: number
  snapshotAvailable: number
  quantity: number
  receivedQuantity: number
  remainingQuantity: number
  shipmentEventId?: string
  receiptEventId?: string
}

export type WarehouseTransferDetail = {
  summary: WarehouseTransferSummary
  lines: WarehouseTransferLine[]
}

export type WarehouseTransferPage = {
  items: WarehouseTransferSummary[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}

export type WarehouseTransferListRequest = {
  sourceWarehouseId?: string
  targetWarehouseId?: string
  status?: WarehouseTransferStatus
  statuses?: WarehouseTransferStatus[]
  transportMode?: WarehouseTransferTransportMode
  searchField: WarehouseTransferSearchField
  keyword?: string
  from?: string
  to?: string
  page: number
  size: number
}

export type WarehouseTransferExportRequest = Omit<
  WarehouseTransferListRequest,
  'status' | 'page' | 'size'
> & {
  statuses?: WarehouseTransferStatus[]
}

export type WarehouseTransferExport = {
  filename: 'warehouse-transfers.csv'
  mediaType: 'text/csv;charset=utf-8'
  rowCount: number
  content: string
}

export type CreateWarehouseTransferInput = {
  commandId: string
  sourceWarehouseId: string
  targetWarehouseId: string
  transferDate: string
  transportMode?: WarehouseTransferTransportMode
  freightAmountMinor?: number
  currencyCode?: string
  logisticsChannel?: string
  trackingNo?: string
  allocationMethod?: WarehouseTransferAllocationMethod
  expectedShipAt?: string
  expectedArrivalAt?: string
  note?: string
  submit: boolean
  lines: Array<{ balanceId: string; quantity: number }>
}

type UnknownRecord = Record<string, unknown>

function invalid(field: string): never { throw new Error(`Invalid warehouse transfer response: ${field}`) }
function invalidRequest(field: string): never { throw new Error(`Invalid warehouse transfer request: ${field}`) }
function record(value: unknown, field: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid(field)
  return value as UnknownRecord
}
function text(value: unknown, field: string) { return typeof value === 'string' && value.length > 0 ? value : invalid(field) }
function optionalText(value: unknown, field: string) { return value == null ? undefined : text(value, field) }
function uuid(value: unknown, field: string) { const result = text(value, field); return UUID_PATTERN.test(result) ? result : invalid(field) }
function integer(value: unknown, field: string) { return typeof value === 'number' && Number.isSafeInteger(value) ? value : invalid(field) }
function nonNegative(value: unknown, field: string) { const result = integer(value, field); return result >= 0 ? result : invalid(field) }
function positive(value: unknown, field: string) { const result = integer(value, field); return result > 0 ? result : invalid(field) }
function timestamp(value: unknown, field: string) { const result = text(value, field); return Number.isNaN(Date.parse(result)) ? invalid(field) : result }
function optionalTimestamp(value: unknown, field: string) { return value == null ? undefined : timestamp(value, field) }
function date(value: unknown, field: string) { const result = text(value, field); return DATE_PATTERN.test(result) && !Number.isNaN(Date.parse(`${result}T00:00:00Z`)) ? result : invalid(field) }
function status(value: unknown, field: string): WarehouseTransferStatus {
  return value === 'DRAFT' || value === 'APPROVAL' || value === 'READY_TO_SHIP' || value === 'IN_TRANSIT' || value === 'PARTIALLY_RECEIVED' || value === 'RECEIVED' || value === 'REJECTED' || value === 'CANCELLED' ? value : invalid(field)
}
function transport(value: unknown, field: string): WarehouseTransferTransportMode {
  return value === 'UNSET' || value === 'LAND' || value === 'AIR' || value === 'SEA' ? value : invalid(field)
}
function allocation(value: unknown, field: string): WarehouseTransferAllocationMethod {
  return value === 'WEIGHT' || value === 'VOLUMETRIC_WEIGHT' || value === 'VOLUME' ? value : invalid(field)
}

function mapSummary(value: unknown): WarehouseTransferSummary {
  const wire = record(value, 'summary')
  const sourceWarehouseId = uuid(wire.sourceWarehouseId, 'summary.sourceWarehouseId')
  const targetWarehouseId = uuid(wire.targetWarehouseId, 'summary.targetWarehouseId')
  if (sourceWarehouseId === targetWarehouseId) return invalid('summary.warehouses')
  const freightAmountMinor = wire.freightAmountMinor == null ? undefined : nonNegative(wire.freightAmountMinor, 'summary.freightAmountMinor')
  const currencyCode = optionalText(wire.currencyCode, 'summary.currencyCode')
  if ((freightAmountMinor === undefined) !== (currencyCode === undefined) || (currencyCode && !/^[A-Z]{3}$/.test(currencyCode))) return invalid('summary.freight')
  const expectedShipAt = optionalTimestamp(wire.expectedShipAt, 'summary.expectedShipAt')
  const expectedArrivalAt = optionalTimestamp(wire.expectedArrivalAt, 'summary.expectedArrivalAt')
  if (expectedShipAt && expectedArrivalAt && Date.parse(expectedArrivalAt) < Date.parse(expectedShipAt)) return invalid('summary.expectedDates')
  return {
    id: uuid(wire.id, 'summary.id'), transferNo: text(wire.transferNo, 'summary.transferNo'),
    status: status(wire.status, 'summary.status'), transferDate: date(wire.transferDate, 'summary.transferDate'),
    sourceWarehouseId, sourceWarehouseCode: text(wire.sourceWarehouseCode, 'summary.sourceWarehouseCode'), sourceWarehouseName: text(wire.sourceWarehouseName, 'summary.sourceWarehouseName'),
    targetWarehouseId, targetWarehouseCode: text(wire.targetWarehouseCode, 'summary.targetWarehouseCode'), targetWarehouseName: text(wire.targetWarehouseName, 'summary.targetWarehouseName'),
    transportMode: transport(wire.transportMode, 'summary.transportMode'), freightAmountMinor, currencyCode,
    logisticsChannel: optionalText(wire.logisticsChannel, 'summary.logisticsChannel'), trackingNo: optionalText(wire.trackingNo, 'summary.trackingNo'),
    allocationMethod: allocation(wire.allocationMethod, 'summary.allocationMethod'), expectedShipAt, expectedArrivalAt,
    note: optionalText(wire.note, 'summary.note'), lineCount: nonNegative(wire.lineCount, 'summary.lineCount'), totalQuantity: nonNegative(wire.totalQuantity, 'summary.totalQuantity'),
    version: nonNegative(wire.version, 'summary.version'), operatorDisplayName: text(wire.operatorDisplayName, 'summary.operatorDisplayName'),
    approverDisplayName: optionalText(wire.approverDisplayName, 'summary.approverDisplayName'), shipperDisplayName: optionalText(wire.shipperDisplayName, 'summary.shipperDisplayName'), receiverDisplayName: optionalText(wire.receiverDisplayName, 'summary.receiverDisplayName'),
    createdAt: timestamp(wire.createdAt, 'summary.createdAt'), updatedAt: timestamp(wire.updatedAt, 'summary.updatedAt'),
  }
}

function mapLine(value: unknown): WarehouseTransferLine {
  const wire = record(value, 'line')
  const snapshotOnHand = integer(wire.snapshotOnHand, 'line.snapshotOnHand')
  const snapshotReserved = integer(wire.snapshotReserved, 'line.snapshotReserved')
  const snapshotAvailable = integer(wire.snapshotAvailable, 'line.snapshotAvailable')
  const quantity = positive(wire.quantity, 'line.quantity')
  const receivedQuantity = nonNegative(wire.receivedQuantity, 'line.receivedQuantity')
  const remainingQuantity = nonNegative(wire.remainingQuantity, 'line.remainingQuantity')
  const shipmentEventId = wire.shipmentEventId == null ? undefined : uuid(wire.shipmentEventId, 'line.shipmentEventId')
  const receiptEventId = wire.receiptEventId == null ? undefined : uuid(wire.receiptEventId, 'line.receiptEventId')
  if (snapshotAvailable !== snapshotOnHand - snapshotReserved || receivedQuantity + remainingQuantity !== quantity || (receivedQuantity > 0) !== Boolean(receiptEventId) || (receiptEventId && !shipmentEventId)) return invalid('line.state')
  return {
    id: uuid(wire.id, 'line.id'), sourceBalanceId: uuid(wire.sourceBalanceId, 'line.sourceBalanceId'), skuId: uuid(wire.skuId, 'line.skuId'),
    skuCode: text(wire.skuCode, 'line.skuCode'), skuName: text(wire.skuName, 'line.skuName'), snapshotBalanceVersion: nonNegative(wire.snapshotBalanceVersion, 'line.snapshotBalanceVersion'),
    snapshotOnHand, snapshotReserved, snapshotAvailable, quantity, receivedQuantity, remainingQuantity, shipmentEventId, receiptEventId,
  }
}

function mapDetail(value: unknown): WarehouseTransferDetail {
  const wire = record(value, 'detail')
  if (!Array.isArray(wire.lines)) return invalid('detail.lines')
  const summary = mapSummary(wire.summary)
  const lines = wire.lines.map(mapLine)
  const totalQuantity = lines.reduce((total, line) => total + line.quantity, 0)
  if (!Number.isSafeInteger(totalQuantity) || summary.lineCount !== lines.length || summary.totalQuantity !== totalQuantity) return invalid('detail.identity')
  return { summary, lines }
}

function mapExport(value: unknown): WarehouseTransferExport {
  const wire = record(value, 'export')
  const filename = text(wire.filename, 'export.filename')
  const mediaType = text(wire.mediaType, 'export.mediaType')
  const rowCount = nonNegative(wire.rowCount, 'export.rowCount')
  const content = typeof wire.content === 'string' ? wire.content : invalid('export.content')
  if (filename !== 'warehouse-transfers.csv'
    || mediaType !== 'text/csv;charset=utf-8'
    || rowCount > 10_000
    || content.length > 40_000_000
    || !content.startsWith('\uFEFF调拨批次,状态,调拨日期,起始仓库编码,起始仓库名称,目标仓库编码,目标仓库名称,运输方式,SKU个数,调拨数量,物流渠道,跟踪号,运费金额(最小货币单位),货币,计费方式,预计发货时间,预计到货时间,备注,操作人,审批人,发货人,签收人,创建时间,更新时间\r\n')) {
    return invalid('export.contract')
  }
  return { filename, mediaType, rowCount, content }
}

function commandHeaders(commandId: string) {
  if (!UUID_PATTERN.test(commandId)) return invalidRequest('commandId')
  return { 'X-Request-Id': `transfer.${commandId}` }
}

export const inventoryTransferApi = {
  async list(request: WarehouseTransferListRequest): Promise<WarehouseTransferPage> {
    if (!Number.isSafeInteger(request.page) || request.page < 0 || !Number.isSafeInteger(request.size) || request.size < 1 || request.size > 200) return invalidRequest('page')
    if (request.status && request.statuses?.length) return invalidRequest('statuses')
    const statuses = request.statuses?.length ? [...new Set(request.statuses)] : request.status ? [request.status] : []
    if (statuses.length > 2) return invalidRequest('statuses')
    const query = new URLSearchParams({ searchField: request.searchField, page: String(request.page), size: String(request.size) })
    for (const [key, value] of [['sourceWarehouseId', request.sourceWarehouseId], ['targetWarehouseId', request.targetWarehouseId]] as const) {
      if (value) { if (!UUID_PATTERN.test(value)) return invalidRequest(key); query.set(key, value) }
    }
    statuses.forEach((status) => query.append('status', status))
    if (request.transportMode) query.set('transportMode', request.transportMode)
    if (request.keyword?.trim()) query.set('keyword', request.keyword.trim())
    if (request.from) query.set('from', request.from)
    if (request.to) query.set('to', request.to)
    const wire = record(await apiClient.request<unknown>(`${API_BASE}?${query}`), 'page')
    if (!Array.isArray(wire.items)) return invalid('page.items')
    return { items: wire.items.map(mapSummary), page: nonNegative(wire.page, 'page.page'), size: nonNegative(wire.size, 'page.size'), totalElements: nonNegative(wire.totalElements, 'page.totalElements'), totalPages: nonNegative(wire.totalPages, 'page.totalPages') }
  },

  async exportCsv(request: WarehouseTransferExportRequest): Promise<WarehouseTransferExport> {
    for (const [key, value] of [['sourceWarehouseId', request.sourceWarehouseId], ['targetWarehouseId', request.targetWarehouseId]] as const) {
      if (value && !UUID_PATTERN.test(value)) return invalidRequest(key)
    }
    const statuses = request.statuses?.length
      ? [...new Set(request.statuses)]
      : undefined
    if (statuses && statuses.length > 2) return invalidRequest('statuses')
    return mapExport(await apiClient.request<unknown>(`${API_BASE}/exports`, {
      method: 'POST',
      body: {
        sourceWarehouseId: request.sourceWarehouseId,
        targetWarehouseId: request.targetWarehouseId,
        statuses,
        transportMode: request.transportMode,
        searchField: request.searchField,
        keyword: request.keyword?.trim().slice(0, 100) || undefined,
        from: request.from,
        to: request.to,
      },
    }))
  },

  async get(transferId: string) {
    if (!UUID_PATTERN.test(transferId)) return invalidRequest('transferId')
    const detail = mapDetail(await apiClient.request<unknown>(`${API_BASE}/${transferId}`))
    if (detail.summary.id !== transferId) return invalid('detail.summary.id')
    return detail
  },

  async create(input: CreateWarehouseTransferInput) {
    if (!UUID_PATTERN.test(input.sourceWarehouseId) || !UUID_PATTERN.test(input.targetWarehouseId) || input.sourceWarehouseId === input.targetWarehouseId || !DATE_PATTERN.test(input.transferDate)) return invalidRequest('create')
    if (!input.lines.length || input.lines.length > 200) return invalidRequest('lines')
    const seen = new Set<string>()
    input.lines.forEach((line) => { if (!UUID_PATTERN.test(line.balanceId) || seen.has(line.balanceId) || !Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 1_000_000_000) invalidRequest('line'); seen.add(line.balanceId) })
    if ((input.freightAmountMinor === undefined) !== (input.currencyCode === undefined) || (input.freightAmountMinor !== undefined && (!Number.isSafeInteger(input.freightAmountMinor) || input.freightAmountMinor < 0)) || (input.currencyCode && !/^[A-Z]{3}$/.test(input.currencyCode))) return invalidRequest('freight')
    return mapDetail(await apiClient.request<unknown>(API_BASE, { method: 'POST', headers: commandHeaders(input.commandId), body: input }))
  },

  async transition(transferId: string, action: WarehouseTransferAction, expectedVersion: number, commandId: string) {
    if (!UUID_PATTERN.test(transferId) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) return invalidRequest('transition')
    const detail = mapDetail(await apiClient.request<unknown>(`${API_BASE}/${transferId}/${action}`, { method: 'POST', headers: commandHeaders(commandId), body: { commandId, expectedVersion } }))
    if (detail.summary.id !== transferId) return invalid('detail.summary.id')
    return detail
  },

  async receivePartial(transferId: string, expectedVersion: number, commandId: string, lines: Array<{ lineId: string; quantity: number }>) {
    if (!UUID_PATTERN.test(transferId) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0 || !lines.length || lines.length > 200) return invalidRequest('partialReceipt')
    const seen = new Set<string>()
    lines.forEach((line) => {
      if (!UUID_PATTERN.test(line.lineId) || seen.has(line.lineId) || !Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 1_000_000_000) invalidRequest('partialReceipt.line')
      seen.add(line.lineId)
    })
    const body = { commandId, expectedVersion, lines }
    const detail = mapDetail(await apiClient.request<unknown>(`${API_BASE}/${transferId}/receive-partial`, { method: 'POST', headers: commandHeaders(commandId), body }))
    if (detail.summary.id !== transferId) return invalid('detail.summary.id')
    return detail
  },
}
