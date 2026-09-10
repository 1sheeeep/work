import { apiClient } from '../api/client'

const API_BASE = '/api/v1/inventory-center/manual-movements'
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type ManualMovementDirection = 'INBOUND' | 'OUTBOUND'
export type ManualMovementStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'POSTED'
  | 'REVERSED'
  | 'CANCELLED'
export type ManualMovementApprovalStatus =
  | 'NOT_REQUIRED'
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
export type ManualMovementSource =
  | 'MANUAL'
  | 'TEMPLATE_IMPORT'
  | 'OPEN_API'
  | 'TMS'
  | 'WMS'
  | 'INVENTORY_SKU'
export type ManualMovementWmsStatus =
  | 'NOT_CONFIGURED'
  | 'NOT_REQUIRED'
  | 'QUEUED'
  | 'SENT'
  | 'CANCELLED'
  | 'FAILED'
export type ManualMovementEntryMode = 'PRODUCT' | 'BOX'
export type ManualMovementSearchField =
  | 'BATCH_NO'
  | 'SKU'
  | 'LOCATION'
  | 'NOTE'
  | 'OPERATOR'
export type ManualMovementTimeBucket =
  | 'RECENT_THREE_MONTHS'
  | 'OLDER_THAN_THREE_MONTHS'
export type ManualMovementReason =
  | 'FOUND_STOCK'
  | 'DAMAGED_STOCK'
  | 'LOST_STOCK'
  | 'RECORDING_CORRECTION'
  | 'OTHER'

export type ManualMovementSummary = {
  id: string
  movementNo: string
  direction: ManualMovementDirection
  status: ManualMovementStatus
  warehouseId: string
  warehouseBusinessCode: string
  warehouseName: string
  movementTypeId?: string
  movementTypeName?: string
  reasonCode: ManualMovementReason
  source: ManualMovementSource
  wmsStatus: ManualMovementWmsStatus
  approvalStatus: ManualMovementApprovalStatus
  entryMode: ManualMovementEntryMode
  note?: string
  sourceReference?: string
  extensionAttributes: Record<string, string>
  lineCount: number
  totalQuantity: number
  totalActualQuantity: number
  totalAmount: number
  currency?: string
  version: number
  createdBy: string
  reviewedBy?: string
  reviewNote?: string
  submittedAt?: string
  postedAt?: string
  reversedAt?: string
  cancelledAt?: string
  reviewedAt?: string
  createdAt: string
  updatedAt: string
}

export type ManualMovementLine = {
  id: string
  lineNumber: number
  skuId: string
  skuBusinessCode: string
  skuName: string
  locationId: string
  locationBusinessCode: string
  locationName: string
  quantity: number
  actualQuantity?: number
  unitPrice?: number
  currency?: string
  amount?: number
  extensionAttributes: Record<string, string>
  note?: string
  currentOnHand?: number
  currentAvailable?: number
}

export type ManualMovementDetail = {
  summary: ManualMovementSummary
  lines: ManualMovementLine[]
  boxes: ManualMovementBox[]
  contactInformation: {
    name?: string
    phone?: string
    address?: string
  }
}

export type ManualMovementBoxItem = {
  skuId: string
  skuBusinessCode: string
  skuName: string
  quantityPerBox: number
}

export type ManualMovementBox = {
  id: string
  sourceBoxStockId?: string
  customBoxNo: string
  boxCount: number
  boxNumberRule: 'SHARED_NUMBER' | 'UNIQUE_NUMBER'
  lengthCm: number
  widthCm: number
  heightCm: number
  grossWeightKg: number
  items: ManualMovementBoxItem[]
}

export type ManualMovementTimelineEvent = {
  id: string
  eventType:
    | 'CREATED'
    | 'UPDATED'
    | 'SUBMITTED'
    | 'APPROVED'
    | 'REJECTED'
    | 'POSTED'
    | 'CANCELLED'
    | 'WMS_CANCELLED'
    | 'REVERSED'
  fromStatus?: ManualMovementStatus
  toStatus: ManualMovementStatus
  movementVersion: number
  requestId: string
  recordedAt: string
}

export type ManualMovementLedgerEvent = {
  id: string
  ledgerSequence: number
  eventType: 'REVERSAL' | 'DOCUMENT_POST'
  skuId: string
  warehouseId: string
  signedDelta: number
  balanceAfter: number
  balanceVersionAfter: number
  reason: string
  reversalOfEventId?: string
  requestId: string
  recordedAt: string
}

export type ManualMovementPage = {
  items: ManualMovementSummary[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}

export type ManualMovementListRequest = {
  warehouseId?: string
  direction?: ManualMovementDirection
  status?: ManualMovementStatus
  reasonCode?: ManualMovementReason
  movementTypeId?: string
  source?: ManualMovementSource
  wmsStatus?: ManualMovementWmsStatus
  approvalStatus?: ManualMovementApprovalStatus
  searchField?: ManualMovementSearchField
  timeBucket?: ManualMovementTimeBucket
  keyword?: string
  createdFrom?: string
  createdTo?: string
  page: number
  size: number
  signal?: AbortSignal
}

export type ManualMovementExportRequest = Omit<
  ManualMovementListRequest,
  'page' | 'size' | 'signal'
>

export type ManualMovementExport = {
  filename:
    | 'manual-movements-all.csv'
    | 'manual-movements-inbound.csv'
    | 'manual-movements-outbound.csv'
  mediaType: 'text/csv;charset=utf-8'
  rowCount: number
  content: string
}

export type ManualMovementLineInput = {
  skuId: string
  locationId: string
  quantity: number
  unitPrice?: number
  currency?: string
  extensionAttributes?: Record<string, string>
  note?: string
}

export type ManualMovementBoxInput = {
  sourceBoxStockId?: string
  customBoxNo: string
  boxCount: number
  boxNumberRule: 'SHARED_NUMBER' | 'UNIQUE_NUMBER'
  lengthCm: number
  widthCm: number
  heightCm: number
  grossWeightKg: number
  items: Array<{ skuId: string; quantityPerBox: number }>
}

export type ManualMovementSaveInput = {
  warehouseId: string
  direction: ManualMovementDirection
  movementTypeId?: string
  reasonCode: ManualMovementReason
  source: ManualMovementSource
  entryMode: ManualMovementEntryMode
  note?: string
  sourceReference?: string
  contactName?: string
  contactPhone?: string
  contactAddress?: string
  extensionAttributes?: Record<string, string>
  lines: ManualMovementLineInput[]
  boxes: ManualMovementBoxInput[]
  expectedVersion: number
  commandId: string
}

export type ManualMovementMutation = {
  movementId: string
  status: ManualMovementStatus
  version: number
  replayed: boolean
}

export type ManualMovementWarehouseOption = {
  id: string
  businessCode: string
  name: string
}

export type ManualMovementLocationOption = {
  id: string
  warehouseId: string
  businessCode: string
  name: string
}

export type ManualMovementSkuOption = {
  id: string
  businessCode: string
  name: string
  variantSummary?: string
}

export type ManualMovementPriceSnapshot = {
  unitPrice: number
  currency: string
  version: number
}

export type OptionPage<T> = {
  items: T[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}

export type ManualMovementSettings = {
  direction: ManualMovementDirection
  approvalRequired: boolean
  unitPriceRequired: boolean
  showCostPrice: boolean
  costUpdatePolicy: 'UPDATE_SNAPSHOT' | 'NO_UPDATE'
  contactInformationRequired: boolean
  version: number
}

export type ManualMovementType = {
  id: string
  direction: ManualMovementDirection
  code: string
  name: string
  status: 'ACTIVE' | 'INACTIVE'
  version: number
}

export type ManualMovementBoxStock = Omit<
  ManualMovementBox,
  'boxCount'
> & {
  warehouseId: string
  availableCount: number
  version: number
}

export type ManualMovementBatchItem = {
  movementId: string
  expectedVersion: number
}

const directions = new Set<ManualMovementDirection>(['INBOUND', 'OUTBOUND'])
const statuses = new Set<ManualMovementStatus>([
  'DRAFT',
  'SUBMITTED',
  'POSTED',
  'REVERSED',
  'CANCELLED',
])
const approvalStatuses = new Set<ManualMovementApprovalStatus>([
  'NOT_REQUIRED',
  'PENDING',
  'APPROVED',
  'REJECTED',
])
const sources = new Set<ManualMovementSource>([
  'MANUAL',
  'TEMPLATE_IMPORT',
  'OPEN_API',
  'TMS',
  'WMS',
  'INVENTORY_SKU',
])
const wmsStatuses = new Set<ManualMovementWmsStatus>([
  'NOT_CONFIGURED',
  'NOT_REQUIRED',
  'QUEUED',
  'SENT',
  'CANCELLED',
  'FAILED',
])
const entryModes = new Set<ManualMovementEntryMode>([
  'PRODUCT',
  'BOX',
])
const searchFields = new Set<ManualMovementSearchField>([
  'BATCH_NO',
  'SKU',
  'LOCATION',
  'NOTE',
  'OPERATOR',
])
const timeBuckets = new Set<ManualMovementTimeBucket>([
  'RECENT_THREE_MONTHS',
  'OLDER_THAN_THREE_MONTHS',
])
const reasons = new Set<ManualMovementReason>([
  'FOUND_STOCK',
  'DAMAGED_STOCK',
  'LOST_STOCK',
  'RECORDING_CORRECTION',
  'OTHER',
])
const timelineTypes = new Set([
  'CREATED',
  'UPDATED',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'POSTED',
  'CANCELLED',
  'WMS_CANCELLED',
  'REVERSED',
])
const ledgerTypes = new Set([
  'REVERSAL',
  'DOCUMENT_POST',
])

function reasonSupportsDirection(
  direction: ManualMovementDirection,
  reason: ManualMovementReason,
) {
  if (reason === 'RECORDING_CORRECTION' || reason === 'OTHER') return true
  return direction === 'INBOUND'
    ? reason === 'FOUND_STOCK'
    : reason === 'DAMAGED_STOCK' || reason === 'LOST_STOCK'
}

function invalid(field: string): never {
  throw new Error(`Invalid manual movement response: ${field}`)
}

function invalidRequest(field: string): never {
  throw new Error(`Invalid manual movement request: ${field}`)
}

function record(value: unknown, field: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalid(field)
  }
  return value as Record<string, unknown>
}

function uuid(value: unknown, field: string) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    return invalid(field)
  }
  return value
}

function requestUuid(value: string, field: string) {
  if (!UUID_PATTERN.test(value)) return invalidRequest(field)
  return value
}

function string(value: unknown, field: string) {
  if (typeof value !== 'string' || value.trim() === '') {
    return invalid(field)
  }
  return value
}

function optionalString(value: unknown, field: string) {
  if (value === null || value === undefined) return undefined
  if (typeof value !== 'string' || value.trim() === '') return invalid(field)
  return value
}

function optionalCurrency(value: unknown, field: string) {
  const result = optionalString(value, field)
  if (result !== undefined && !/^[A-Z]{3}$/.test(result)) {
    return invalid(field)
  }
  return result
}

function safeInteger(value: unknown, field: string, minimum = 0) {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum
  ) {
    return invalid(field)
  }
  return value
}

function finiteNumber(value: unknown, field: string, minimum = 0) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < minimum
  ) {
    return invalid(field)
  }
  return value
}

function optionalFiniteNumber(
  value: unknown,
  field: string,
  minimum = 0,
) {
  return value === null || value === undefined
    ? undefined
    : finiteNumber(value, field, minimum)
}

function stringMap(
  value: unknown,
  field: string,
): Record<string, string> {
  const wire = record(value, field)
  const result: Record<string, string> = {}
  for (const [key, entry] of Object.entries(wire)) {
    if (
      key.length < 1 ||
      key.length > 100 ||
      typeof entry !== 'string' ||
      entry.length < 1 ||
      entry.length > 300
    ) {
      return invalid(field)
    }
    result[key] = entry
  }
  return result
}

function timestamp(value: unknown, field: string) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    return invalid(field)
  }
  return value
}

function optionalTimestamp(value: unknown, field: string) {
  if (value === null || value === undefined) return undefined
  return timestamp(value, field)
}

function enumeration<T extends string>(
  value: unknown,
  values: Set<T>,
  field: string,
) {
  if (typeof value !== 'string' || !values.has(value as T)) {
    return invalid(field)
  }
  return value as T
}

function mapSummary(value: unknown): ManualMovementSummary {
  const wire = record(value, 'summary')
  const direction = enumeration(
    wire.direction,
    directions,
    'summary.direction',
  )
  const status = enumeration(wire.status, statuses, 'summary.status')
  const reasonCode = enumeration(
    wire.reasonCode,
    reasons,
    'summary.reasonCode',
  )
  const source = enumeration(wire.source, sources, 'summary.source')
  const wmsStatus = enumeration(
    wire.wmsStatus,
    wmsStatuses,
    'summary.wmsStatus',
  )
  const approvalStatus = enumeration(
    wire.approvalStatus,
    approvalStatuses,
    'summary.approvalStatus',
  )
  const entryMode = enumeration(
    wire.entryMode,
    entryModes,
    'summary.entryMode',
  )
  const submittedAt = optionalTimestamp(
    wire.submittedAt,
    'summary.submittedAt',
  )
  const postedAt = optionalTimestamp(wire.postedAt, 'summary.postedAt')
  const reversedAt = optionalTimestamp(
    wire.reversedAt,
    'summary.reversedAt',
  )
  const cancelledAt = optionalTimestamp(
    wire.cancelledAt,
    'summary.cancelledAt',
  )
  const reviewedAt = optionalTimestamp(
    wire.reviewedAt,
    'summary.reviewedAt',
  )
  const reviewNote = optionalString(
    wire.reviewNote,
    'summary.reviewNote',
  )
  if (
    !reasonSupportsDirection(direction, reasonCode) ||
    (status === 'DRAFT' &&
      (submittedAt || postedAt || reversedAt || cancelledAt)) ||
    (status === 'SUBMITTED' &&
      (!submittedAt || postedAt || reversedAt || cancelledAt)) ||
    (status === 'POSTED' &&
      (!submittedAt || !postedAt || reversedAt || cancelledAt)) ||
    (status === 'REVERSED' &&
      (!submittedAt || !postedAt || !reversedAt || cancelledAt)) ||
    (status === 'CANCELLED' &&
      (postedAt || reversedAt || !cancelledAt)) ||
    ((approvalStatus === 'APPROVED' ||
      approvalStatus === 'REJECTED') &&
      !reviewedAt) ||
    ((approvalStatus === 'NOT_REQUIRED' ||
      approvalStatus === 'PENDING') &&
      (reviewedAt || reviewNote)) ||
    (approvalStatus === 'REJECTED' && !reviewNote)
  ) {
    return invalid('summary.state')
  }
  const lineCount = safeInteger(wire.lineCount, 'summary.lineCount', 1)
  if (lineCount > 500) return invalid('summary.lineCount')
  const totalQuantity = safeInteger(
    wire.totalQuantity,
    'summary.totalQuantity',
    1,
  )
  const totalActualQuantity = safeInteger(
    wire.totalActualQuantity,
    'summary.totalActualQuantity',
  )
  const totalAmount = finiteNumber(
    wire.totalAmount,
    'summary.totalAmount',
  )
  const currency = optionalCurrency(wire.currency, 'summary.currency')
  const movementTypeId =
    wire.movementTypeId === null || wire.movementTypeId === undefined
      ? undefined
      : uuid(wire.movementTypeId, 'summary.movementTypeId')
  const movementTypeName = optionalString(
    wire.movementTypeName,
    'summary.movementTypeName',
  )
  if (
    (movementTypeId === undefined) !==
      (movementTypeName === undefined) ||
    (status === 'POSTED' || status === 'REVERSED'
      ? totalActualQuantity !== totalQuantity
      : totalActualQuantity !== 0) ||
    (totalAmount !== 0 && currency === undefined) ||
    (status === 'SUBMITTED' && approvalStatus === 'REJECTED') ||
    ((status === 'POSTED' || status === 'REVERSED') &&
      (approvalStatus === 'PENDING' || approvalStatus === 'REJECTED'))
  ) {
    return invalid('summary.consistency')
  }
  return {
    id: uuid(wire.id, 'summary.id'),
    movementNo: string(wire.movementNo, 'summary.movementNo'),
    direction,
    status,
    warehouseId: uuid(wire.warehouseId, 'summary.warehouseId'),
    warehouseBusinessCode: string(
      wire.warehouseBusinessCode,
      'summary.warehouseBusinessCode',
    ),
    warehouseName: string(wire.warehouseName, 'summary.warehouseName'),
    movementTypeId,
    movementTypeName,
    reasonCode,
    source,
    wmsStatus,
    approvalStatus,
    entryMode,
    note: optionalString(wire.note, 'summary.note'),
    sourceReference: optionalString(
      wire.sourceReference,
      'summary.sourceReference',
    ),
    extensionAttributes: stringMap(
      wire.extensionAttributes,
      'summary.extensionAttributes',
    ),
    lineCount,
    totalQuantity,
    totalActualQuantity,
    totalAmount,
    currency,
    version: safeInteger(wire.version, 'summary.version'),
    createdBy: string(wire.createdBy, 'summary.createdBy'),
    reviewedBy: optionalString(wire.reviewedBy, 'summary.reviewedBy'),
    reviewNote,
    submittedAt,
    postedAt,
    reversedAt,
    cancelledAt,
    reviewedAt,
    createdAt: timestamp(wire.createdAt, 'summary.createdAt'),
    updatedAt: timestamp(wire.updatedAt, 'summary.updatedAt'),
  }
}

function mapLine(value: unknown): ManualMovementLine {
  const wire = record(value, 'line')
  const currentOnHand =
    wire.currentOnHand === null || wire.currentOnHand === undefined
      ? undefined
      : safeIntegerAllowNegative(wire.currentOnHand, 'line.currentOnHand')
  const currentAvailable =
    wire.currentAvailable === null || wire.currentAvailable === undefined
      ? undefined
      : safeIntegerAllowNegative(
          wire.currentAvailable,
          'line.currentAvailable',
        )
  if (currentOnHand !== currentAvailable) {
    return invalid('line.currentAvailable')
  }
  const lineNumber = safeInteger(wire.lineNumber, 'line.lineNumber', 1)
  if (lineNumber > 500) return invalid('line.lineNumber')
  const unitPrice = optionalFiniteNumber(
    wire.unitPrice,
    'line.unitPrice',
  )
  const currency = optionalCurrency(wire.currency, 'line.currency')
  const amount = optionalFiniteNumber(wire.amount, 'line.amount')
  if (
    (unitPrice === undefined) !== (currency === undefined) ||
    (unitPrice === undefined) !== (amount === undefined)
  ) {
    return invalid('line.price')
  }
  return {
    id: uuid(wire.id, 'line.id'),
    lineNumber,
    skuId: uuid(wire.skuId, 'line.skuId'),
    skuBusinessCode: string(
      wire.skuBusinessCode,
      'line.skuBusinessCode',
    ),
    skuName: string(wire.skuName, 'line.skuName'),
    locationId: uuid(wire.locationId, 'line.locationId'),
    locationBusinessCode: string(
      wire.locationBusinessCode,
      'line.locationBusinessCode',
    ),
    locationName: string(wire.locationName, 'line.locationName'),
    quantity: safeInteger(wire.quantity, 'line.quantity', 1),
    actualQuantity:
      wire.actualQuantity === null ||
      wire.actualQuantity === undefined
        ? undefined
        : safeInteger(
            wire.actualQuantity,
            'line.actualQuantity',
          ),
    unitPrice,
    currency,
    amount,
    extensionAttributes: stringMap(
      wire.extensionAttributes,
      'line.extensionAttributes',
    ),
    note: optionalString(wire.note, 'line.note'),
    currentOnHand,
    currentAvailable,
  }
}

function safeIntegerAllowNegative(value: unknown, field: string) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    return invalid(field)
  }
  return value
}

function mapBoxItem(value: unknown): ManualMovementBoxItem {
  const wire = record(value, 'boxItem')
  return {
    skuId: uuid(wire.skuId, 'boxItem.skuId'),
    skuBusinessCode: string(
      wire.skuBusinessCode,
      'boxItem.skuBusinessCode',
    ),
    skuName: string(wire.skuName, 'boxItem.skuName'),
    quantityPerBox: safeInteger(
      wire.quantityPerBox,
      'boxItem.quantityPerBox',
      1,
    ),
  }
}

function mapBox(value: unknown): ManualMovementBox {
  const wire = record(value, 'box')
  if (!Array.isArray(wire.items) || wire.items.length < 1) {
    return invalid('box.items')
  }
  const numberRule = enumeration(
    wire.boxNumberRule,
    new Set(['SHARED_NUMBER', 'UNIQUE_NUMBER']),
    'box.boxNumberRule',
  ) as ManualMovementBox['boxNumberRule']
  const items = wire.items.map(mapBoxItem)
  if (
    new Set(items.map((item) => item.skuId.toLowerCase())).size !==
    items.length
  ) {
    return invalid('box.items')
  }
  return {
    id: uuid(wire.id, 'box.id'),
    sourceBoxStockId:
      wire.sourceBoxStockId === null ||
      wire.sourceBoxStockId === undefined
        ? undefined
        : uuid(wire.sourceBoxStockId, 'box.sourceBoxStockId'),
    customBoxNo: string(wire.customBoxNo, 'box.customBoxNo'),
    boxCount: safeInteger(wire.boxCount, 'box.boxCount', 1),
    boxNumberRule: numberRule,
    lengthCm: finiteNumber(wire.lengthCm, 'box.lengthCm', 0.001),
    widthCm: finiteNumber(wire.widthCm, 'box.widthCm', 0.001),
    heightCm: finiteNumber(wire.heightCm, 'box.heightCm', 0.001),
    grossWeightKg: finiteNumber(
      wire.grossWeightKg,
      'box.grossWeightKg',
      0.001,
    ),
    items,
  }
}

function mapDetail(value: unknown): ManualMovementDetail {
  const wire = record(value, 'detail')
  if (!Array.isArray(wire.lines) || !Array.isArray(wire.boxes)) {
    return invalid('detail.collections')
  }
  const summary = mapSummary(wire.summary)
  const lines = wire.lines.map(mapLine)
  const boxes = wire.boxes.map(mapBox)
  const contactWire = record(
    wire.contactInformation,
    'detail.contactInformation',
  )
  const contactInformation = {
    name: optionalString(
      contactWire.name,
      'detail.contactInformation.name',
    ),
    phone: optionalString(
      contactWire.phone,
      'detail.contactInformation.phone',
    ),
    address: optionalString(
      contactWire.address,
      'detail.contactInformation.address',
    ),
  }
  if (
    (contactInformation.name?.length ?? 0) > 80 ||
    (contactInformation.phone?.length ?? 0) > 40 ||
    (contactInformation.address?.length ?? 0) > 300
  ) {
    return invalid('detail.contactInformation')
  }
  const skuIds = new Set(lines.map((line) => line.skuId.toLowerCase()))
  let totalQuantity = 0
  let totalActualQuantity = 0
  let totalAmount = 0
  for (const line of lines) {
    totalQuantity += line.quantity
    totalActualQuantity += line.actualQuantity ?? 0
    totalAmount += line.amount ?? 0
    if (
      !Number.isSafeInteger(totalQuantity) ||
      !Number.isSafeInteger(totalActualQuantity) ||
      (line.amount !== undefined &&
        Math.abs(
          line.amount - (line.unitPrice ?? 0) * line.quantity,
        ) > 0.000001)
    ) {
      return invalid('detail.totalQuantity')
    }
  }
  if (
    lines.length !== summary.lineCount ||
    skuIds.size !== lines.length ||
    totalQuantity !== summary.totalQuantity ||
    totalActualQuantity !== summary.totalActualQuantity ||
    Math.abs(totalAmount - summary.totalAmount) > 0.000001 ||
    lines.some((line) =>
      summary.status === 'POSTED' || summary.status === 'REVERSED'
        ? line.actualQuantity !== line.quantity
        : line.actualQuantity !== undefined,
    )
  ) {
    return invalid('detail.summary')
  }
  if (
    (summary.entryMode === 'BOX' && boxes.length < 1) ||
    (summary.entryMode === 'PRODUCT' && boxes.length > 0)
  ) {
    return invalid('detail.boxes')
  }
  return { summary, lines, boxes, contactInformation }
}

function mapPage(value: unknown): ManualMovementPage {
  const wire = record(value, 'page')
  if (!Array.isArray(wire.items)) return invalid('page.items')
  const page = safeInteger(wire.page, 'page.page')
  const size = safeInteger(wire.size, 'page.size', 1)
  const totalElements = safeInteger(
    wire.totalElements,
    'page.totalElements',
  )
  const totalPages = safeInteger(wire.totalPages, 'page.totalPages')
  if (
    totalPages !==
      (totalElements === 0 ? 0 : Math.ceil(totalElements / size)) ||
    wire.items.length > size
  ) {
    return invalid('page.pagination')
  }
  return {
    items: wire.items.map(mapSummary),
    page,
    size,
    totalElements,
    totalPages,
  }
}

function mapOptionPage<T>(
  value: unknown,
  mapItem: (item: unknown) => T,
): OptionPage<T> {
  const wire = record(value, 'optionPage')
  if (!Array.isArray(wire.items)) return invalid('optionPage.items')
  const page = safeInteger(wire.page, 'optionPage.page')
  const size = safeInteger(wire.size, 'optionPage.size', 1)
  const totalElements = safeInteger(
    wire.totalElements,
    'optionPage.totalElements',
  )
  const totalPages = safeInteger(
    wire.totalPages,
    'optionPage.totalPages',
  )
  if (
    totalPages !==
      (totalElements === 0 ? 0 : Math.ceil(totalElements / size)) ||
    wire.items.length > size
  ) {
    return invalid('optionPage.pagination')
  }
  return {
    items: wire.items.map((item) => mapItem(item)),
    page,
    size,
    totalElements,
    totalPages,
  }
}

function mapWarehouseOption(
  value: unknown,
): ManualMovementWarehouseOption {
  const wire = record(value, 'warehouseOption')
  return {
    id: uuid(wire.id, 'warehouseOption.id'),
    businessCode: string(
      wire.businessCode,
      'warehouseOption.businessCode',
    ),
    name: string(wire.name, 'warehouseOption.name'),
  }
}

function mapLocationOption(
  value: unknown,
  warehouseId: string,
): ManualMovementLocationOption {
  const wire = record(value, 'locationOption')
  const parent = uuid(
    wire.warehouseId,
    'locationOption.warehouseId',
  )
  if (parent.toLowerCase() !== warehouseId.toLowerCase()) {
    return invalid('locationOption.warehouseId')
  }
  return {
    id: uuid(wire.id, 'locationOption.id'),
    warehouseId: parent,
    businessCode: string(
      wire.businessCode,
      'locationOption.businessCode',
    ),
    name: string(wire.name, 'locationOption.name'),
  }
}

function mapSkuOption(value: unknown): ManualMovementSkuOption {
  const wire = record(value, 'skuOption')
  return {
    id: uuid(wire.id, 'skuOption.id'),
    businessCode: string(wire.businessCode, 'skuOption.businessCode'),
    name: string(wire.name, 'skuOption.name'),
    variantSummary: optionalString(
      wire.variantSummary,
      'skuOption.variantSummary',
    ),
  }
}

function mapPriceSnapshot(
  value: unknown,
): ManualMovementPriceSnapshot {
  const wire = record(value, 'priceSnapshot')
  return {
    unitPrice: finiteNumber(
      wire.unitPrice,
      'priceSnapshot.unitPrice',
    ),
    currency:
      optionalCurrency(
        wire.currency,
        'priceSnapshot.currency',
      ) ?? invalid('priceSnapshot.currency'),
    version: safeInteger(
      wire.version,
      'priceSnapshot.version',
    ),
  }
}

function mapSettings(value: unknown): ManualMovementSettings {
  const wire = record(value, 'settings')
  const booleanFields = [
    'approvalRequired',
    'unitPriceRequired',
    'showCostPrice',
    'contactInformationRequired',
  ] as const
  for (const field of booleanFields) {
    if (typeof wire[field] !== 'boolean') {
      return invalid(`settings.${field}`)
    }
  }
  const policy = enumeration(
    wire.costUpdatePolicy,
    new Set(['UPDATE_SNAPSHOT', 'NO_UPDATE']),
    'settings.costUpdatePolicy',
  ) as ManualMovementSettings['costUpdatePolicy']
  return {
    direction: enumeration(
      wire.direction,
      directions,
      'settings.direction',
    ),
    approvalRequired: wire.approvalRequired as boolean,
    unitPriceRequired: wire.unitPriceRequired as boolean,
    showCostPrice: wire.showCostPrice as boolean,
    costUpdatePolicy: policy,
    contactInformationRequired:
      wire.contactInformationRequired as boolean,
    version: safeInteger(wire.version, 'settings.version'),
  }
}

function mapMovementType(value: unknown): ManualMovementType {
  const wire = record(value, 'movementType')
  const status = enumeration(
    wire.status,
    new Set(['ACTIVE', 'INACTIVE']),
    'movementType.status',
  ) as ManualMovementType['status']
  return {
    id: uuid(wire.id, 'movementType.id'),
    direction: enumeration(
      wire.direction,
      directions,
      'movementType.direction',
    ),
    code: string(wire.code, 'movementType.code'),
    name: string(wire.name, 'movementType.name'),
    status,
    version: safeInteger(wire.version, 'movementType.version'),
  }
}

function mapBoxStock(
  value: unknown,
  expectedWarehouseId: string,
): ManualMovementBoxStock {
  const box = mapBox({ ...record(value, 'boxStock'), boxCount: 1 })
  const wire = record(value, 'boxStock')
  const warehouseId = uuid(wire.warehouseId, 'boxStock.warehouseId')
  if (warehouseId.toLowerCase() !== expectedWarehouseId.toLowerCase()) {
    return invalid('boxStock.warehouseId')
  }
  return {
    id: box.id,
    sourceBoxStockId: box.sourceBoxStockId,
    customBoxNo: box.customBoxNo,
    boxNumberRule: box.boxNumberRule,
    lengthCm: box.lengthCm,
    widthCm: box.widthCm,
    heightCm: box.heightCm,
    grossWeightKg: box.grossWeightKg,
    items: box.items,
    warehouseId,
    availableCount: safeInteger(
      wire.availableCount,
      'boxStock.availableCount',
      1,
    ),
    version: safeInteger(wire.version, 'boxStock.version'),
  }
}

function mapBatch(value: unknown) {
  const wire = record(value, 'batch')
  if (!Array.isArray(wire.items)) return invalid('batch.items')
  return wire.items.map(mapMutation)
}

function mapMutation(value: unknown): ManualMovementMutation {
  const wire = record(value, 'mutation')
  if (typeof wire.replayed !== 'boolean') return invalid('mutation.replayed')
  return {
    movementId: uuid(wire.movementId, 'mutation.movementId'),
    status: enumeration(wire.status, statuses, 'mutation.status'),
    version: safeInteger(wire.version, 'mutation.version'),
    replayed: wire.replayed,
  }
}

function mapTimeline(value: unknown): ManualMovementTimelineEvent {
  const wire = record(value, 'timeline')
  const eventType = enumeration(
    wire.eventType,
    timelineTypes,
    'timeline.eventType',
  ) as ManualMovementTimelineEvent['eventType']
  return {
    id: uuid(wire.id, 'timeline.id'),
    eventType,
    fromStatus:
      wire.fromStatus === null || wire.fromStatus === undefined
        ? undefined
        : enumeration(wire.fromStatus, statuses, 'timeline.fromStatus'),
    toStatus: enumeration(wire.toStatus, statuses, 'timeline.toStatus'),
    movementVersion: safeInteger(
      wire.movementVersion,
      'timeline.movementVersion',
    ),
    requestId: string(wire.requestId, 'timeline.requestId'),
    recordedAt: timestamp(wire.recordedAt, 'timeline.recordedAt'),
  }
}

function mapLedger(value: unknown): ManualMovementLedgerEvent {
  const outer = record(value, 'ledger')
  const wire = 'event' in outer ? record(outer.event, 'ledger.event') : outer
  const eventType = enumeration(
    wire.eventType,
    ledgerTypes,
    'ledger.eventType',
  ) as ManualMovementLedgerEvent['eventType']
  const reversalOfEventId =
    wire.reversalOfEventId === null ||
    wire.reversalOfEventId === undefined
      ? undefined
      : uuid(wire.reversalOfEventId, 'ledger.reversalOfEventId')
  if (
    (eventType === 'REVERSAL' && !reversalOfEventId) ||
    (eventType === 'DOCUMENT_POST' && reversalOfEventId)
  ) {
    return invalid('ledger.reversalOfEventId')
  }
  return {
    id: uuid(wire.id, 'ledger.id'),
    ledgerSequence: safeInteger(
      wire.ledgerSequence,
      'ledger.ledgerSequence',
      1,
    ),
    eventType,
    skuId: uuid(wire.skuId, 'ledger.skuId'),
    warehouseId: uuid(wire.warehouseId, 'ledger.warehouseId'),
    signedDelta: safeIntegerAllowNegative(
      wire.signedDelta,
      'ledger.signedDelta',
    ),
    balanceAfter: safeIntegerAllowNegative(
      wire.balanceAfter,
      'ledger.balanceAfter',
    ),
    balanceVersionAfter: safeInteger(
      wire.balanceVersionAfter,
      'ledger.balanceVersionAfter',
    ),
    reason: string(wire.reason, 'ledger.reason'),
    reversalOfEventId,
    requestId: string(wire.requestId, 'ledger.requestId'),
    recordedAt: timestamp(wire.recordedAt, 'ledger.recordedAt'),
  }
}

function query(request: ManualMovementListRequest) {
  if (
    !Number.isSafeInteger(request.page) ||
    request.page < 0 ||
    !Number.isSafeInteger(request.size) ||
    request.size < 1 ||
    request.size > 200
  ) {
    return invalidRequest('pagination')
  }
  const params = new URLSearchParams({
    page: String(request.page),
    size: String(request.size),
  })
  if (request.warehouseId) {
    params.set(
      'warehouseId',
      requestUuid(request.warehouseId, 'warehouseId'),
    )
  }
  if (request.direction) {
    if (!directions.has(request.direction)) return invalidRequest('direction')
    params.set('direction', request.direction)
  }
  if (request.status) {
    if (!statuses.has(request.status)) return invalidRequest('status')
    params.set('status', request.status)
  }
  if (request.reasonCode) {
    if (!reasons.has(request.reasonCode)) {
      return invalidRequest('reasonCode')
    }
    params.set('reasonCode', request.reasonCode)
  }
  if (request.movementTypeId) {
    params.set(
      'movementTypeId',
      requestUuid(request.movementTypeId, 'movementTypeId'),
    )
  }
  if (request.source) {
    if (!sources.has(request.source)) return invalidRequest('source')
    params.set('source', request.source)
  }
  if (request.wmsStatus) {
    if (!wmsStatuses.has(request.wmsStatus)) {
      return invalidRequest('wmsStatus')
    }
    params.set('wmsStatus', request.wmsStatus)
  }
  if (request.approvalStatus) {
    if (!approvalStatuses.has(request.approvalStatus)) {
      return invalidRequest('approvalStatus')
    }
    params.set('approvalStatus', request.approvalStatus)
  }
  if (request.searchField) {
    if (!searchFields.has(request.searchField)) {
      return invalidRequest('searchField')
    }
    params.set('searchField', request.searchField)
  }
  if (request.timeBucket) {
    if (!timeBuckets.has(request.timeBucket)) {
      return invalidRequest('timeBucket')
    }
    params.set('timeBucket', request.timeBucket)
  }
  const keyword = request.keyword?.trim()
  if (keyword) {
    if (keyword.length > 100) return invalidRequest('keyword')
    params.set('keyword', keyword)
  }
  if (request.createdFrom) {
    timestamp(request.createdFrom, 'createdFrom')
    params.set('createdFrom', request.createdFrom)
  }
  if (request.createdTo) {
    timestamp(request.createdTo, 'createdTo')
    params.set('createdTo', request.createdTo)
  }
  return params.toString()
}

function mapExport(value: unknown): ManualMovementExport {
  const wire = record(value, 'export')
  const filename = string(wire.filename, 'export.filename')
  const mediaType = string(wire.mediaType, 'export.mediaType')
  const rowCount = safeInteger(wire.rowCount, 'export.rowCount')
  const content = typeof wire.content === 'string'
    ? wire.content
    : invalid('export.content')
  if (
    ![
      'manual-movements-all.csv',
      'manual-movements-inbound.csv',
      'manual-movements-outbound.csv',
    ].includes(filename) ||
    mediaType !== 'text/csv;charset=utf-8' ||
    rowCount > 10_000 ||
    content.length > 30_000_000 ||
    !content.startsWith(
      '\uFEFF批次编号,方向,仓库编码,仓库名称,类型,来源,WMS状态,审批状态,计划数量,实际数量,金额,币种,创建人,审核人,单据状态,创建时间\r\n',
    )
  ) {
    return invalid('export.contract')
  }
  return {
    filename: filename as ManualMovementExport['filename'],
    mediaType,
    rowCount,
    content,
  }
}

function path(id: string, suffix = '') {
  return `${API_BASE}/${encodeURIComponent(requestUuid(id, 'movementId'))}${suffix}`
}

function requestId(commandId: string) {
  return `manual-${requestUuid(commandId, 'commandId')}`
}

function saveBody(input: ManualMovementSaveInput) {
  requestUuid(input.warehouseId, 'warehouseId')
  requestUuid(input.commandId, 'commandId')
  if (
    !directions.has(input.direction) ||
    !sources.has(input.source) ||
    !entryModes.has(input.entryMode) ||
    !reasons.has(input.reasonCode) ||
    !reasonSupportsDirection(input.direction, input.reasonCode) ||
    !Number.isSafeInteger(input.expectedVersion) ||
    input.expectedVersion < 0 ||
    !Array.isArray(input.lines) ||
    input.lines.length < 1 ||
    input.lines.length > 500 ||
    !Array.isArray(input.boxes) ||
    input.boxes.length > 200 ||
    (input.entryMode === 'PRODUCT' && input.boxes.length > 0) ||
    (input.entryMode === 'BOX' && input.boxes.length < 1)
  ) {
    return invalidRequest('body')
  }
  if (
    (input.note !== undefined &&
      (typeof input.note !== 'string' ||
        input.note.trim() === '' ||
        input.note.length > 500)) ||
    (input.sourceReference !== undefined &&
      (typeof input.sourceReference !== 'string' ||
        input.sourceReference.trim() === '' ||
        input.sourceReference.length > 100)) ||
    (input.contactName !== undefined &&
      (typeof input.contactName !== 'string' ||
        input.contactName.trim() === '' ||
        input.contactName.length > 80)) ||
    (input.contactPhone !== undefined &&
      (typeof input.contactPhone !== 'string' ||
        input.contactPhone.trim() === '' ||
        input.contactPhone.length > 40)) ||
    (input.contactAddress !== undefined &&
      (typeof input.contactAddress !== 'string' ||
        input.contactAddress.trim() === '' ||
        input.contactAddress.length > 300))
  ) {
    return invalidRequest('body.text')
  }
  const skuIds = new Set<string>()
  if (input.movementTypeId) {
    requestUuid(input.movementTypeId, 'movementTypeId')
  }
  return {
    warehouseId: input.warehouseId,
    direction: input.direction,
    movementTypeId: input.movementTypeId,
    reasonCode: input.reasonCode,
    source: input.source,
    entryMode: input.entryMode,
    note: input.note,
    sourceReference: input.sourceReference,
    contactName: input.contactName,
    contactPhone: input.contactPhone,
    contactAddress: input.contactAddress,
    extensionAttributes: inputAttributes(
      input.extensionAttributes,
      'extensionAttributes',
    ),
    lines: input.lines.map((line) => {
      requestUuid(line.skuId, 'line.skuId')
      requestUuid(line.locationId, 'line.locationId')
      const normalizedSkuId = line.skuId.toLowerCase()
      if (
        skuIds.has(normalizedSkuId) ||
        !Number.isSafeInteger(line.quantity) ||
        line.quantity < 1 ||
        (line.unitPrice !== undefined &&
          (!Number.isFinite(line.unitPrice) ||
            line.unitPrice < 0)) ||
        ((line.unitPrice === undefined) !==
          (line.currency === undefined)) ||
        (line.currency !== undefined &&
          !/^[A-Z]{3}$/.test(line.currency)) ||
        (line.note !== undefined &&
          (typeof line.note !== 'string' ||
            line.note.trim() === '' ||
            line.note.length > 300))
      ) {
        return invalidRequest('line.quantity')
      }
      skuIds.add(normalizedSkuId)
      return {
        skuId: line.skuId,
        locationId: line.locationId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        currency: line.currency,
        extensionAttributes: inputAttributes(
          line.extensionAttributes,
          'line.extensionAttributes',
        ),
        note: line.note,
      }
    }),
    boxes: input.boxes.map((box) => {
      if (
        (box.sourceBoxStockId !== undefined &&
          !UUID_PATTERN.test(box.sourceBoxStockId)) ||
        box.customBoxNo.trim() === '' ||
        box.customBoxNo.length > 80 ||
        !Number.isSafeInteger(box.boxCount) ||
        box.boxCount < 1 ||
        !['SHARED_NUMBER', 'UNIQUE_NUMBER'].includes(
          box.boxNumberRule,
        ) ||
        ![box.lengthCm, box.widthCm, box.heightCm, box.grossWeightKg]
          .every((value) => Number.isFinite(value) && value > 0) ||
        !Array.isArray(box.items) ||
        box.items.length < 1 ||
        box.items.length > 100
      ) {
        return invalidRequest('box')
      }
      return {
        ...box,
        items: box.items.map((item) => {
          requestUuid(item.skuId, 'box.item.skuId')
          if (
            !Number.isSafeInteger(item.quantityPerBox) ||
            item.quantityPerBox < 1
          ) {
            return invalidRequest('box.item.quantityPerBox')
          }
          return item
        }),
      }
    }),
    expectedVersion: input.expectedVersion,
    commandId: input.commandId,
  }
}

function inputAttributes(
  value: Record<string, string> | undefined,
  field: string,
) {
  if (!value) return {}
  if (
    Array.isArray(value) ||
    Object.keys(value).length > 20
  ) {
    return invalidRequest(field)
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (typeof entry !== 'string') return invalidRequest(field)
      const normalizedKey = key.trim()
      const normalizedValue = entry.trim()
      if (
        normalizedKey.length < 1 ||
        normalizedKey.length > 100 ||
        normalizedValue.length < 1 ||
        normalizedValue.length > 300
      ) {
        return invalidRequest(field)
      }
      return [normalizedKey, normalizedValue]
    }),
  )
}

function optionQuery(keyword: string, page: number, size: number) {
  if (
    !Number.isSafeInteger(page) ||
    page < 0 ||
    !Number.isSafeInteger(size) ||
    size < 1 ||
    size > 200
  ) {
    return invalidRequest('option.pagination')
  }
  const normalizedKeyword = keyword.trim()
  if (normalizedKeyword.length > 100) {
    return invalidRequest('option.keyword')
  }
  const params = new URLSearchParams({
    page: String(page),
    size: String(size),
  })
  if (normalizedKeyword) params.set('keyword', normalizedKeyword)
  return params
}

function transitionBody(expectedVersion: number, commandId: string) {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
    return invalidRequest('expectedVersion')
  }
  requestUuid(commandId, 'commandId')
  return { expectedVersion, commandId }
}

function batchBody(
  items: ManualMovementBatchItem[],
  commandId: string,
  note?: string,
) {
  requestUuid(commandId, 'commandId')
  if (
    !Array.isArray(items) ||
    items.length < 1 ||
    items.length > 100
  ) {
    return invalidRequest('batch.items')
  }
  const ids = new Set<string>()
  const normalizedNote = note?.trim()
  if (
    normalizedNote !== undefined &&
    (normalizedNote.length < 1 || normalizedNote.length > 300)
  ) {
    return invalidRequest('batch.note')
  }
  return {
    items: items.map((item) => {
      requestUuid(item.movementId, 'batch.movementId')
      if (
        ids.has(item.movementId.toLowerCase()) ||
        !Number.isSafeInteger(item.expectedVersion) ||
        item.expectedVersion < 0
      ) {
        return invalidRequest('batch.item')
      }
      ids.add(item.movementId.toLowerCase())
      return item
    }),
    commandId,
    note: normalizedNote,
  }
}

function mutationHeaders(commandId: string) {
  return { 'X-Request-Id': requestId(commandId) }
}

export const manualMovementApi = {
  async list(request: ManualMovementListRequest) {
    return mapPage(
      await apiClient.request<unknown>(`${API_BASE}?${query(request)}`, {
        signal: request.signal,
      }),
    )
  },

  async exportCsv(
    request: ManualMovementExportRequest,
  ): Promise<ManualMovementExport> {
    query({ ...request, page: 0, size: 1 })
    return mapExport(
      await apiClient.request<unknown>(`${API_BASE}/exports`, {
        method: 'POST',
        body: {
          warehouseId: request.warehouseId,
          direction: request.direction,
          status: request.status,
          reasonCode: request.reasonCode,
          movementTypeId: request.movementTypeId,
          source: request.source,
          wmsStatus: request.wmsStatus,
          approvalStatus: request.approvalStatus,
          searchField: request.searchField,
          timeBucket: request.timeBucket,
          keyword: request.keyword?.trim() || undefined,
          createdFrom: request.createdFrom,
          createdTo: request.createdTo,
        },
      }),
    )
  },

  async get(id: string, signal?: AbortSignal) {
    return mapDetail(
      await apiClient.request<unknown>(path(id), { signal }),
    )
  },

  async timeline(id: string, signal?: AbortSignal) {
    const wire = await apiClient.request<unknown>(path(id, '/timeline'), {
      signal,
    })
    const response = record(wire, 'timeline')
    if (!Array.isArray(response.items)) {
      return invalid('timeline.items')
    }
    return response.items.map(mapTimeline)
  },

  async ledger(id: string, signal?: AbortSignal) {
    const wire = await apiClient.request<unknown>(
      path(id, '/ledger-events'),
      { signal },
    )
    const response = record(wire, 'ledger')
    if (!Array.isArray(response.items)) {
      return invalid('ledger.items')
    }
    return response.items.map(mapLedger)
  },

  async create(input: ManualMovementSaveInput) {
    return mapMutation(
      await apiClient.request<unknown>(API_BASE, {
        method: 'POST',
        headers: { 'X-Request-Id': requestId(input.commandId) },
        body: saveBody(input),
      }),
    )
  },

  async update(id: string, input: ManualMovementSaveInput) {
    return mapMutation(
      await apiClient.request<unknown>(path(id), {
        method: 'PUT',
        headers: { 'X-Request-Id': requestId(input.commandId) },
        body: saveBody(input),
      }),
    )
  },

  async submit(id: string, expectedVersion: number, commandId: string) {
    return mapMutation(
      await apiClient.request<unknown>(path(id, '/submit'), {
        method: 'POST',
        headers: mutationHeaders(commandId),
        body: transitionBody(expectedVersion, commandId),
      }),
    )
  },

  async review(
    id: string,
    expectedVersion: number,
    commandId: string,
    approved: boolean,
    note?: string,
  ) {
    if (
      note !== undefined &&
      (note.trim() === '' || note.length > 300)
    ) {
      return invalidRequest('review.note')
    }
    return mapMutation(
      await apiClient.request<unknown>(path(id, '/review'), {
        method: 'POST',
        headers: mutationHeaders(commandId),
        body: {
          ...transitionBody(expectedVersion, commandId),
          approved,
          note,
        },
      }),
    )
  },

  async cancel(id: string, expectedVersion: number, commandId: string) {
    return mapMutation(
      await apiClient.request<unknown>(path(id, '/cancel'), {
        method: 'POST',
        headers: mutationHeaders(commandId),
        body: transitionBody(expectedVersion, commandId),
      }),
    )
  },

  async post(id: string, expectedVersion: number, commandId: string) {
    return mapMutation(
      await apiClient.request<unknown>(path(id, '/post'), {
        method: 'POST',
        headers: { 'X-Request-Id': requestId(commandId) },
        body: transitionBody(expectedVersion, commandId),
      }),
    )
  },

  async reverse(id: string, expectedVersion: number, commandId: string) {
    return mapMutation(
      await apiClient.request<unknown>(path(id, '/reverse'), {
        method: 'POST',
        headers: { 'X-Request-Id': requestId(commandId) },
        body: transitionBody(expectedVersion, commandId),
      }),
    )
  },

  async batchReview(
    items: ManualMovementBatchItem[],
    commandId: string,
    approved: boolean,
    note?: string,
  ) {
    return mapBatch(
      await apiClient.request<unknown>(
        `${API_BASE}/batch/review?approved=${approved}`,
        {
          method: 'POST',
          headers: mutationHeaders(commandId),
          body: batchBody(items, commandId, note),
        },
      ),
    )
  },

  async batchPost(
    items: ManualMovementBatchItem[],
    commandId: string,
  ) {
    return mapBatch(
      await apiClient.request<unknown>(`${API_BASE}/batch/post`, {
        method: 'POST',
        headers: mutationHeaders(commandId),
        body: batchBody(items, commandId),
      }),
    )
  },

  async batchCancel(
    items: ManualMovementBatchItem[],
    commandId: string,
  ) {
    return mapBatch(
      await apiClient.request<unknown>(`${API_BASE}/batch/cancel`, {
        method: 'POST',
        headers: mutationHeaders(commandId),
        body: batchBody(items, commandId),
      }),
    )
  },

  async warehouseOptions(keyword = '', page = 0, size = 50) {
    const params = optionQuery(keyword, page, size)
    return mapOptionPage(
      await apiClient.request<unknown>(
        `${API_BASE}/references/warehouses?${params}`,
      ),
      mapWarehouseOption,
    )
  },

  async locationOptions(
    warehouseId: string,
    keyword = '',
    page = 0,
    size = 100,
  ) {
    const parent = requestUuid(warehouseId, 'warehouseId')
    const params = optionQuery(keyword, page, size)
    return mapOptionPage(
      await apiClient.request<unknown>(
        `${API_BASE}/references/warehouses/` +
          `${encodeURIComponent(parent)}/locations?${params}`,
      ),
      (value) => mapLocationOption(value, parent),
    )
  },

  async skuOptions(keyword = '', page = 0, size = 50) {
    const params = optionQuery(keyword, page, size)
    return mapOptionPage(
      await apiClient.request<unknown>(
        `${API_BASE}/references/skus?${params}`,
      ),
      mapSkuOption,
    )
  },

  async priceSnapshot(
    skuId: string,
    direction: ManualMovementDirection,
    signal?: AbortSignal,
  ) {
    const requiredSkuId = requestUuid(skuId, 'skuId')
    if (!directions.has(direction)) return invalidRequest('direction')
    return mapPriceSnapshot(
      await apiClient.request<unknown>(
        `${API_BASE}/references/skus/` +
          `${encodeURIComponent(requiredSkuId)}/price-snapshot` +
          `?direction=${direction}`,
        { signal },
      ),
    )
  },

  async settings(direction: ManualMovementDirection) {
    if (!directions.has(direction)) return invalidRequest('direction')
    return mapSettings(
      await apiClient.request<unknown>(
        `${API_BASE}/settings/${direction}`,
      ),
    )
  },

  async saveSettings(
    settings: Omit<ManualMovementSettings, 'direction'>,
    direction: ManualMovementDirection,
    commandId: string,
  ) {
    if (!directions.has(direction)) return invalidRequest('direction')
    return mapSettings(
      await apiClient.request<unknown>(
        `${API_BASE}/settings/${direction}`,
        {
          method: 'PUT',
          headers: mutationHeaders(commandId),
          body: {
            approvalRequired: settings.approvalRequired,
            unitPriceRequired: settings.unitPriceRequired,
            showCostPrice: settings.showCostPrice,
            costUpdatePolicy: settings.costUpdatePolicy,
            contactInformationRequired:
              settings.contactInformationRequired,
            expectedVersion: settings.version,
            commandId,
          },
        },
      ),
    )
  },

  async types(
    direction?: ManualMovementDirection,
    includeInactive = false,
    page = 0,
    size = 100,
  ) {
    const params = optionQuery('', page, size)
    if (direction) {
      if (!directions.has(direction)) {
        return invalidRequest('direction')
      }
      params.set('direction', direction)
    }
    params.set('includeInactive', String(includeInactive))
    return mapOptionPage(
      await apiClient.request<unknown>(
        `${API_BASE}/types?${params}`,
      ),
      mapMovementType,
    )
  },

  async saveType(
    type: Omit<ManualMovementType, 'id' | 'version'> & {
      id?: string
      expectedVersion: number
      commandId: string
    },
  ) {
    if (!directions.has(type.direction)) {
      return invalidRequest('type.direction')
    }
    requestUuid(type.commandId, 'type.commandId')
    const target = type.id
      ? `${API_BASE}/types/${encodeURIComponent(
          requestUuid(type.id, 'type.id'),
        )}`
      : `${API_BASE}/types`
    return mapMovementType(
      await apiClient.request<unknown>(target, {
        method: type.id ? 'PUT' : 'POST',
        headers: mutationHeaders(type.commandId),
        body: {
          direction: type.direction,
          code: type.code,
          name: type.name,
          status: type.status,
          expectedVersion: type.expectedVersion,
          commandId: type.commandId,
        },
      }),
    )
  },

  async boxStock(
    warehouseId: string,
    keyword = '',
    page = 0,
    size = 50,
  ) {
    const parent = requestUuid(warehouseId, 'warehouseId')
    const params = optionQuery(keyword, page, size)
    params.set('warehouseId', parent)
    return mapOptionPage(
      await apiClient.request<unknown>(
        `${API_BASE}/box-stock?${params}`,
      ),
      (value) => mapBoxStock(value, parent),
    )
  },
}
