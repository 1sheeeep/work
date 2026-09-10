import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  Check,
  ClipboardPaste,
  FileDown,
  FileUp,
  ListChecks,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Settings,
  Search,
  Send,
  Trash2,
} from 'lucide-react'
import { useRouter, useRouterState } from '@tanstack/react-router'
import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { DialogCloseButton } from '../components/DialogCloseButton'
import {
  manualMovementApi,
  type ManualMovementApprovalStatus,
  type ManualMovementBatchItem,
  type ManualMovementBoxInput,
  type ManualMovementBoxStock,
  type ManualMovementDetail,
  type ManualMovementDirection,
  type ManualMovementExportRequest,
  type ManualMovementEntryMode,
  type ManualMovementLedgerEvent,
  type ManualMovementLineInput,
  type ManualMovementLocationOption,
  type ManualMovementPage,
  type ManualMovementReason,
  type ManualMovementSearchField,
  type ManualMovementSettings,
  type ManualMovementSkuOption,
  type ManualMovementSource,
  type ManualMovementStatus,
  type ManualMovementSummary,
  type ManualMovementTimeBucket,
  type ManualMovementTimelineEvent,
  type ManualMovementType,
  type ManualMovementWarehouseOption,
  type ManualMovementWmsStatus,
} from '../modules/manualMovementApi'
import {
  manualMovementExcelTemplate,
  parseManualMovementImportFile,
  type ManualMovementImportError,
} from '../modules/manualMovementImport'
import './ManualMovementPage.css'

const PAGE_PATH = '/warehouses/manual-movements'
const DEFAULT_SIZE = 25
const PAGE_SIZES = [10, 25, 50, 100] as const
const MAX_PAGE = 9_999
const REFERENCE_PAGE_SIZE = 200
const MAX_WAREHOUSE_REFERENCE_ITEMS = 10_000
const MAX_WAREHOUSE_REFERENCE_PAGES =
  MAX_WAREHOUSE_REFERENCE_ITEMS / REFERENCE_PAGE_SIZE
const MAX_MOVEMENT_TYPE_ITEMS = 10_000
const MAX_MOVEMENT_TYPE_PAGES =
  MAX_MOVEMENT_TYPE_ITEMS / REFERENCE_PAGE_SIZE
const MAX_LOCATION_REFERENCE_ITEMS = 10_000
const MAX_LOCATION_REFERENCE_PAGES =
  MAX_LOCATION_REFERENCE_ITEMS / REFERENCE_PAGE_SIZE
const MAX_BOX_STOCK_ITEMS = 10_000
const MAX_BOX_STOCK_PAGES =
  MAX_BOX_STOCK_ITEMS / REFERENCE_PAGE_SIZE
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const directions: ManualMovementDirection[] = ['INBOUND', 'OUTBOUND']
const statuses: ManualMovementStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'POSTED',
  'REVERSED',
  'CANCELLED',
]
const approvalStatuses: ManualMovementApprovalStatus[] = [
  'PENDING',
  'REJECTED',
  'APPROVED',
  'NOT_REQUIRED',
]
const sources: ManualMovementSource[] = [
  'MANUAL',
  'TEMPLATE_IMPORT',
  'OPEN_API',
  'TMS',
  'WMS',
  'INVENTORY_SKU',
]
const wmsStatuses: ManualMovementWmsStatus[] = [
  'NOT_CONFIGURED',
  'NOT_REQUIRED',
  'QUEUED',
  'SENT',
  'CANCELLED',
  'FAILED',
]
const searchFields: ManualMovementSearchField[] = [
  'BATCH_NO',
  'SKU',
  'LOCATION',
  'NOTE',
  'OPERATOR',
]
const timeBuckets: ManualMovementTimeBucket[] = [
  'RECENT_THREE_MONTHS',
  'OLDER_THAN_THREE_MONTHS',
]
const inboundReasons: ManualMovementReason[] = [
  'FOUND_STOCK',
  'RECORDING_CORRECTION',
  'OTHER',
]
const outboundReasons: ManualMovementReason[] = [
  'DAMAGED_STOCK',
  'LOST_STOCK',
  'RECORDING_CORRECTION',
  'OTHER',
]
const reasons: ManualMovementReason[] = [
  'FOUND_STOCK',
  'DAMAGED_STOCK',
  'LOST_STOCK',
  'RECORDING_CORRECTION',
  'OTHER',
]

type LoadState<T> =
  | { status: 'idle' }
  | { status: 'loading'; data?: T }
  | { status: 'ready'; data: T }
  | { status: 'error'; message: string; data?: T }

type EditorMode = 'create' | 'edit'
type ManualMovementView = 'INBOUND' | 'OUTBOUND' | 'APPROVAL'

export type ManualMovementQuery = {
  warehouseId?: string
  view: ManualMovementView
  approvalDirection?: ManualMovementDirection
  status?: ManualMovementStatus
  reasonCode?: ManualMovementReason
  movementTypeId?: string
  source?: ManualMovementSource
  wmsStatus?: ManualMovementWmsStatus
  approvalStatus?: ManualMovementApprovalStatus
  searchField: ManualMovementSearchField
  timeBucket?: ManualMovementTimeBucket
  keyword: string
  createdFrom: string
  createdTo: string
  page: number
  size: number
  detailMovementId?: string
  editor?: EditorMode
}

type FilterDraft = Pick<
  ManualMovementQuery,
  | 'warehouseId'
  | 'approvalDirection'
  | 'status'
  | 'reasonCode'
  | 'movementTypeId'
  | 'source'
  | 'wmsStatus'
  | 'approvalStatus'
  | 'searchField'
  | 'timeBucket'
  | 'keyword'
  | 'createdFrom'
  | 'createdTo'
>

function bounded(
  value: string | null,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  if (!value || !/^\d+$/.test(value)) return fallback
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) &&
    parsed >= minimum &&
    parsed <= maximum
    ? parsed
    : fallback
}

function validDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return ''
  return Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? '' : value
}

export function parseManualMovementQuery(
  search: string,
): ManualMovementQuery {
  const params = new URLSearchParams(search)
  const warehouseId = params.get('warehouseId') ?? undefined
  const movementTypeId = params.get('movementTypeId') ?? undefined
  const detailMovementId =
    params.get('detailMovementId') ?? undefined
  const view = params.get('view')
  const legacyDirection = params.get('direction')
  const approvalDirection = params.get('approvalDirection')
  const status = params.get('status')
  const reasonCode = params.get('reasonCode')
  const source = params.get('source')
  const wmsStatus = params.get('wmsStatus')
  const approvalStatus = params.get('approvalStatus')
  const searchField = params.get('searchField')
  const timeBucket = params.get('timeBucket')
  const editor = params.get('editor')
  const parsedView: ManualMovementView =
    view === 'APPROVAL' ||
    view === 'INBOUND' ||
    view === 'OUTBOUND'
      ? view
      : legacyDirection === 'OUTBOUND'
        ? 'OUTBOUND'
        : 'INBOUND'
  return {
    warehouseId:
      warehouseId && UUID_PATTERN.test(warehouseId)
        ? warehouseId
        : undefined,
    view: parsedView,
    approvalDirection: directions.includes(
      approvalDirection as ManualMovementDirection,
    )
      ? (approvalDirection as ManualMovementDirection)
      : undefined,
    status: statuses.includes(status as ManualMovementStatus)
      ? (status as ManualMovementStatus)
      : undefined,
    reasonCode: reasons.includes(reasonCode as ManualMovementReason)
      ? (reasonCode as ManualMovementReason)
      : undefined,
    movementTypeId:
      movementTypeId && UUID_PATTERN.test(movementTypeId)
        ? movementTypeId
        : undefined,
    source: sources.includes(source as ManualMovementSource)
      ? (source as ManualMovementSource)
      : undefined,
    wmsStatus: wmsStatuses.includes(wmsStatus as ManualMovementWmsStatus)
      ? (wmsStatus as ManualMovementWmsStatus)
      : undefined,
    approvalStatus: approvalStatuses.includes(
      approvalStatus as ManualMovementApprovalStatus,
    )
      ? (approvalStatus as ManualMovementApprovalStatus)
      : parsedView === 'APPROVAL'
        ? 'PENDING'
        : undefined,
    searchField: searchFields.includes(
      searchField as ManualMovementSearchField,
    )
      ? (searchField as ManualMovementSearchField)
      : 'BATCH_NO',
    timeBucket: timeBuckets.includes(
      timeBucket as ManualMovementTimeBucket,
    )
      ? (timeBucket as ManualMovementTimeBucket)
      : undefined,
    keyword: (params.get('keyword') ?? '').trim().slice(0, 100),
    createdFrom: validDate(params.get('createdFrom')),
    createdTo: validDate(params.get('createdTo')),
    page: bounded(params.get('page'), 0, 0, MAX_PAGE),
    size: bounded(params.get('size'), DEFAULT_SIZE, 1, 100),
    detailMovementId:
      detailMovementId && UUID_PATTERN.test(detailMovementId)
        ? detailMovementId
        : undefined,
    editor:
      editor === 'create' || editor === 'edit'
        ? editor
        : undefined,
  }
}

export function toManualMovementUrl(query: ManualMovementQuery) {
  const params = new URLSearchParams({
    view: query.view,
    searchField: query.searchField,
    keyword: query.keyword,
    createdFrom: query.createdFrom,
    createdTo: query.createdTo,
    page: String(query.page),
    size: String(query.size),
  })
  if (query.warehouseId) {
    params.set('warehouseId', query.warehouseId)
  }
  if (query.approvalDirection) {
    params.set('approvalDirection', query.approvalDirection)
  }
  if (query.status) params.set('status', query.status)
  if (query.reasonCode) params.set('reasonCode', query.reasonCode)
  if (query.movementTypeId) {
    params.set('movementTypeId', query.movementTypeId)
  }
  if (query.source) params.set('source', query.source)
  if (query.wmsStatus) params.set('wmsStatus', query.wmsStatus)
  if (query.approvalStatus) {
    params.set('approvalStatus', query.approvalStatus)
  }
  if (query.timeBucket) params.set('timeBucket', query.timeBucket)
  if (query.detailMovementId) {
    params.set('detailMovementId', query.detailMovementId)
  }
  if (
    query.editor === 'create' ||
    (query.editor === 'edit' && query.detailMovementId)
  ) {
    params.set('editor', query.editor)
  }
  return `${PAGE_PATH}?${params.toString()}`
}

function directionLabel(value: ManualMovementDirection) {
  return value === 'INBOUND' ? '手工入库' : '手工出库'
}

function statusLabel(value: ManualMovementStatus) {
  if (value === 'DRAFT') return '草稿'
  if (value === 'SUBMITTED') return '已提交'
  if (value === 'POSTED') return '已过账'
  if (value === 'REVERSED') return '已冲销'
  return '已作废'
}

function approvalLabel(value: ManualMovementApprovalStatus) {
  const labels: Record<ManualMovementApprovalStatus, string> = {
    NOT_REQUIRED: '无需审核',
    PENDING: '待审核',
    APPROVED: '已完成（通过）',
    REJECTED: '未通过',
  }
  return labels[value]
}

function reviewerLabel(summary: ManualMovementSummary) {
  if (summary.approvalStatus === 'PENDING') {
    return '具备审核权限且可见本仓库的成员'
  }
  return summary.reviewedBy ?? '—'
}

function sourceLabel(value: ManualMovementSource) {
  const labels: Record<ManualMovementSource, string> = {
    MANUAL: '手工新增',
    TEMPLATE_IMPORT: '模板导入',
    OPEN_API: '外部系统',
    TMS: 'TMS',
    WMS: 'WMS',
    INVENTORY_SKU: '库存 SKU',
  }
  return labels[value]
}

function wmsStatusLabel(value: ManualMovementWmsStatus) {
  const labels: Record<ManualMovementWmsStatus, string> = {
    NOT_CONFIGURED: '未配置',
    NOT_REQUIRED: '无需推送',
    QUEUED: '待推送',
    SENT: '已推送',
    CANCELLED: '已取消',
    FAILED: '推送失败',
  }
  return labels[value]
}

function searchFieldLabel(value: ManualMovementSearchField) {
  const labels: Record<ManualMovementSearchField, string> = {
    BATCH_NO: '批次号 / 来源单号',
    SKU: 'SKU 编号 / 名称',
    LOCATION: '库位编号 / 名称',
    NOTE: '备注',
    OPERATOR: '创建 / 操作 / 审核人员',
  }
  return labels[value]
}

function timeBucketLabel(value: ManualMovementTimeBucket) {
  return value === 'RECENT_THREE_MONTHS'
    ? '三个月内'
    : '三个月前'
}

function formatMoney(amount: number, currency?: string) {
  if (!currency) return '—'
  try {
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency,
      maximumFractionDigits: 4,
    }).format(amount)
  } catch {
    return `${amount.toFixed(4)} ${currency}`
  }
}

function reasonLabel(value: ManualMovementReason) {
  const labels: Record<ManualMovementReason, string> = {
    FOUND_STOCK: '盘盈或发现库存',
    DAMAGED_STOCK: '库存损坏',
    LOST_STOCK: '库存丢失',
    RECORDING_CORRECTION: '账面记录纠正',
    OTHER: '其他',
  }
  return labels[value]
}

function formatTime(value?: string) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)
}

function safeMessage(error: unknown, action: string) {
  if (error instanceof ApiError) {
    if (error.status === 403) {
      return `当前账号没有${action}权限，登录状态保持不变。`
    }
    if (error.status === 404) {
      return '单据或关联数据不存在，或当前账号无权访问。'
    }
    if (error.status === 409) {
      const details =
        error.details &&
        typeof error.details === 'object' &&
        !Array.isArray(error.details)
          ? (error.details as Record<string, unknown>)
          : {}
      if (details.reason === 'stale_version') {
        return '单据已被其他操作更新。当前输入已保留，请刷新详情后重试。'
      }
      if (details.reason === 'idempotency_conflict') {
        return '本次命令编号已用于不同请求，请重新提交。'
      }
      if (details.reason === 'illegal_transition') {
        return '当前单据状态不允许执行此操作，请刷新详情。'
      }
      if (details.reason === 'inactive_master_data') {
        return '仓库、库位或 SKU 已停用或归档，不能继续调整库存。'
      }
      if (details.reason === 'approval_required') {
        return '单据尚未审核通过，不能过账。'
      }
      if (details.reason === 'box_stock_insufficient') {
        return '所选库存箱已被其他操作占用或箱内明细不一致，请刷新。'
      }
      if (details.reason === 'reversal_not_allowed') {
        return '箱库存已被后续单据使用，当前单据不能直接冲销。'
      }
      return '数据状态已变化，或关联主数据阻止本次操作。'
    }
    if (error.status === 400) {
      return '提交内容未通过校验，请检查必填项、数量和日期。'
    }
  }
  return `暂时无法${action}，请稍后重试。`
}

function exportMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 409) {
    return '导出结果超过 10,000 条，请缩小筛选范围后重试。'
  }
  return safeMessage(error, '导出手工出入库单')
}

function commandId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const value = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
  return [
    value.slice(0, 8),
    value.slice(8, 12),
    value.slice(12, 16),
    value.slice(16, 20),
    value.slice(20),
  ].join('-')
}

function isoStart(value: string) {
  return value ? `${value}T00:00:00.000Z` : undefined
}

function isoEnd(value: string) {
  return value ? `${value}T23:59:59.999Z` : undefined
}

function exportFilters(
  query: ManualMovementQuery,
): ManualMovementExportRequest {
  return {
    warehouseId: query.warehouseId,
    direction:
      query.view === 'APPROVAL' ? query.approvalDirection : query.view,
    status: query.status,
    reasonCode: query.reasonCode,
    movementTypeId: query.movementTypeId,
    source: query.source,
    wmsStatus: query.wmsStatus,
    approvalStatus:
      query.view === 'APPROVAL' ? query.approvalStatus : undefined,
    searchField: query.searchField,
    timeBucket: query.timeBucket,
    keyword: query.keyword || undefined,
    createdFrom: isoStart(query.createdFrom),
    createdTo: isoEnd(query.createdTo),
  }
}

function useDialogFocus(
  open: boolean,
  dialogRef: RefObject<HTMLDivElement | null>,
  initialRef: RefObject<HTMLButtonElement | null>,
  restoreRef: RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  useEffect(() => {
    if (!open) return
    const previous = restoreRef.current
    initialRef.current?.focus()
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), ' +
            'select:not([disabled]), textarea:not([disabled]), ' +
            'a[href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      )
      if (focusable.length === 0) {
        event.preventDefault()
        dialogRef.current?.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (
        !event.shiftKey &&
        document.activeElement === last
      ) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('keydown', handleKey)
      window.requestAnimationFrame(() => previous?.focus())
    }
  }, [dialogRef, initialRef, onClose, open, restoreRef])
}

function Dialog({
  title,
  titleId,
  restoreRef,
  onClose,
  children,
  wide = false,
}: {
  title: string
  titleId: string
  restoreRef: RefObject<HTMLElement | null>
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  useDialogFocus(true, dialogRef, closeRef, restoreRef, onClose)
  return (
    <div className="manual-modal-backdrop">
      <div
        className={`manual-modal ${wide ? 'manual-modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={dialogRef}
        tabIndex={-1}
      >
        <header className="manual-modal-header">
          <h2 id={titleId}>{title}</h2>
          <DialogCloseButton
            label={`关闭${title}`}
            ref={closeRef}
            onClick={onClose}
          />
        </header>
        {children}
      </div>
    </div>
  )
}

async function loadManualMovementWarehouses() {
  const first = await manualMovementApi.warehouseOptions(
    '',
    0,
    REFERENCE_PAGE_SIZE,
  )
  if (
    first.totalElements > MAX_WAREHOUSE_REFERENCE_ITEMS ||
    first.totalPages > MAX_WAREHOUSE_REFERENCE_PAGES
  ) {
    throw new Error('仓库选项目录超过 10,000 项，无法安全加载。')
  }
  const items = [...first.items]
  for (let page = 1; page < first.totalPages; page += 1) {
    items.push(...(await manualMovementApi.warehouseOptions(
      '',
      page,
      REFERENCE_PAGE_SIZE,
    )).items)
    if (items.length > MAX_WAREHOUSE_REFERENCE_ITEMS) {
      throw new Error('仓库选项目录超过 10,000 项，无法安全加载。')
    }
  }
  if (
    items.length !== first.totalElements ||
    new Set(items.map((warehouse) => warehouse.id)).size !== items.length
  ) {
    throw new Error('仓库选项目录分页结果不一致。')
  }
  return items
}

async function loadManualMovementTypes() {
  const first = await manualMovementApi.types(
    undefined,
    true,
    0,
    REFERENCE_PAGE_SIZE,
  )
  if (
    first.totalElements > MAX_MOVEMENT_TYPE_ITEMS ||
    first.totalPages > MAX_MOVEMENT_TYPE_PAGES
  ) {
    throw new Error('出入库类型超过 10,000 项，无法安全加载。')
  }
  const items = [...first.items]
  for (let page = 1; page < first.totalPages; page += 1) {
    items.push(...(await manualMovementApi.types(
      undefined,
      true,
      page,
      REFERENCE_PAGE_SIZE,
    )).items)
    if (items.length > MAX_MOVEMENT_TYPE_ITEMS) {
      throw new Error('出入库类型超过 10,000 项，无法安全加载。')
    }
  }
  if (
    items.length !== first.totalElements ||
    new Set(items.map((type) => type.id)).size !== items.length
  ) {
    throw new Error('出入库类型分页结果不一致。')
  }
  return items
}

async function loadManualMovementLocations(warehouseId: string) {
  const first = await manualMovementApi.locationOptions(
    warehouseId,
    '',
    0,
    REFERENCE_PAGE_SIZE,
  )
  if (
    first.totalElements > MAX_LOCATION_REFERENCE_ITEMS ||
    first.totalPages > MAX_LOCATION_REFERENCE_PAGES
  ) {
    throw new Error('库位选项目录超过 10,000 项，无法安全加载。')
  }
  const items = [...first.items]
  for (let page = 1; page < first.totalPages; page += 1) {
    items.push(...(await manualMovementApi.locationOptions(
      warehouseId,
      '',
      page,
      REFERENCE_PAGE_SIZE,
    )).items)
    if (items.length > MAX_LOCATION_REFERENCE_ITEMS) {
      throw new Error('库位选项目录超过 10,000 项，无法安全加载。')
    }
  }
  if (
    items.length !== first.totalElements ||
    new Set(items.map((location) => location.id)).size !== items.length
  ) {
    throw new Error('库位选项目录分页结果不一致。')
  }
  return items
}

async function loadManualMovementBoxStock(warehouseId: string) {
  const first = await manualMovementApi.boxStock(
    warehouseId,
    '',
    0,
    REFERENCE_PAGE_SIZE,
  )
  if (
    first.totalElements > MAX_BOX_STOCK_ITEMS ||
    first.totalPages > MAX_BOX_STOCK_PAGES
  ) {
    throw new Error('可用箱库存超过 10,000 项，无法安全加载。')
  }
  const items = [...first.items]
  for (let page = 1; page < first.totalPages; page += 1) {
    items.push(...(await manualMovementApi.boxStock(
      warehouseId,
      '',
      page,
      REFERENCE_PAGE_SIZE,
    )).items)
    if (items.length > MAX_BOX_STOCK_ITEMS) {
      throw new Error('可用箱库存超过 10,000 项，无法安全加载。')
    }
  }
  if (
    items.length !== first.totalElements ||
    new Set(items.map((stock) => stock.id)).size !== items.length
  ) {
    throw new Error('可用箱库存分页结果不一致。')
  }
  return items
}

export function manualMovementCsvCell(value: string | number) {
  if (typeof value === 'number') {
    return `"${String(value)}"`
  }
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value
  return `"${safe.replaceAll('"', '""')}"`
}

export function ManualMovementPage() {
  const { hasPermission } = useAuth()
  const router = useRouter()
  const search = useRouterState({
    select: (state) => state.location.searchStr,
  })
  const query = useMemo(
    () => parseManualMovementQuery(search),
    [search],
  )
  const [listState, setListState] =
    useState<LoadState<ManualMovementPage>>({ status: 'loading' })
  const [warehouseState, setWarehouseState] = useState<
    LoadState<ManualMovementWarehouseOption[]>
  >({ status: 'loading' })
  const [movementTypes, setMovementTypes] = useState<ManualMovementType[]>([])
  const [settingsByDirection, setSettingsByDirection] = useState<
    Partial<Record<ManualMovementDirection, ManualMovementSettings>>
  >({})
  const [detailState, setDetailState] =
    useState<LoadState<ManualMovementDetail>>({ status: 'idle' })
  const [timelineState, setTimelineState] = useState<
    LoadState<ManualMovementTimelineEvent[]>
  >({ status: 'idle' })
  const [ledgerState, setLedgerState] = useState<
    LoadState<ManualMovementLedgerEvent[]>
  >({ status: 'idle' })
  const [filterDraft, setFilterDraft] = useState<FilterDraft>(query)
  const [refresh, setRefresh] = useState(0)
  const [actionError, setActionError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportFeedback, setExportFeedback] = useState<{
    kind: 'success' | 'error'
    message: string
    queryKey: string
  } | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const listRequest = useRef(0)
  const detailTrigger = useRef<HTMLElement | null>(null)
  const editorTrigger = useRef<HTMLElement | null>(null)
  const filteredExportRequest = useMemo(() => exportFilters(query), [query])
  const exportQueryKey = JSON.stringify(filteredExportRequest)

  const navigate = useCallback(
    (next: ManualMovementQuery, replace = false) => {
      const url = toManualMovementUrl(next)
      if (replace) router.history.replace(url)
      else router.history.push(url)
    },
    [router.history],
  )

  useEffect(() => {
    setFilterDraft({
      warehouseId: query.warehouseId,
      approvalDirection: query.approvalDirection,
      status: query.status,
      reasonCode: query.reasonCode,
      movementTypeId: query.movementTypeId,
      source: query.source,
      wmsStatus: query.wmsStatus,
      approvalStatus: query.approvalStatus,
      searchField: query.searchField,
      timeBucket: query.timeBucket,
      keyword: query.keyword,
      createdFrom: query.createdFrom,
      createdTo: query.createdTo,
    })
  }, [
    query.createdFrom,
    query.createdTo,
    query.approvalDirection,
    query.approvalStatus,
    query.keyword,
    query.movementTypeId,
    query.reasonCode,
    query.searchField,
    query.source,
    query.status,
    query.timeBucket,
    query.warehouseId,
    query.wmsStatus,
  ])

  useEffect(() => {
    let active = true
    setWarehouseState({ status: 'loading' })
    loadManualMovementWarehouses()
      .then((items) => {
        if (active) {
          setWarehouseState({ status: 'ready', data: items })
        }
      })
      .catch((error) => {
        if (active) {
          setWarehouseState({
            status: 'error',
            message: safeMessage(error, '读取仓库选项'),
          })
        }
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    Promise.all([
      loadManualMovementTypes(),
      manualMovementApi.settings('INBOUND'),
      manualMovementApi.settings('OUTBOUND'),
    ])
      .then(([types, inbound, outbound]) => {
        if (!active) return
        setMovementTypes(types)
        setSettingsByDirection({ INBOUND: inbound, OUTBOUND: outbound })
      })
      .catch(() => {
        if (active) {
          setMovementTypes([])
          setSettingsByDirection({})
        }
      })
    return () => {
      active = false
    }
  }, [refresh])

  const loadList = useCallback(async (signal: AbortSignal) => {
    const request = ++listRequest.current
    setListState((previous) => ({
      status: 'loading',
      data: 'data' in previous ? previous.data : undefined,
    }))
    try {
      const data = await manualMovementApi.list({
        ...exportFilters(query),
        page: query.page,
        size: query.size,
        signal,
      })
      if (request !== listRequest.current) return
      if (
        data.items.length === 0 &&
        query.page > 0 &&
        data.totalPages <= query.page
      ) {
        navigate(
          {
            ...query,
            page: Math.max(0, data.totalPages - 1),
          },
          true,
        )
        return
      }
      setListState({ status: 'ready', data })
      setSelectedIds((current) => {
        const visible = new Set(data.items.map((item) => item.id))
        return new Set([...current].filter((id) => visible.has(id)))
      })
    } catch (error) {
      if (request === listRequest.current && !signal.aborted) {
        setListState({
          status: 'error',
          message: safeMessage(error, '读取手工出入库单'),
        })
      }
    }
  }, [navigate, query])

  useEffect(() => {
    const controller = new AbortController()
    void loadList(controller.signal)
    return () => controller.abort()
  }, [loadList, refresh])

  useEffect(() => {
    const id = query.detailMovementId
    if (!id) {
      setDetailState({ status: 'idle' })
      setTimelineState({ status: 'idle' })
      setLedgerState({ status: 'idle' })
      return
    }
    const controller = new AbortController()
    setDetailState({ status: 'loading' })
    setTimelineState({ status: 'loading' })
    setLedgerState({ status: 'loading' })
    manualMovementApi
      .get(id, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setDetailState({ status: 'ready', data })
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setDetailState({
            status: 'error',
            message: safeMessage(error, '读取单据详情'),
          })
        }
      })
    manualMovementApi
      .timeline(id, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setTimelineState({ status: 'ready', data })
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setTimelineState({
            status: 'error',
            message: safeMessage(error, '读取单据状态记录'),
          })
        }
      })
    manualMovementApi
      .ledger(id, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setLedgerState({ status: 'ready', data })
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setLedgerState({
            status: 'error',
            message: safeMessage(error, '读取库存流水'),
          })
        }
      })
    return () => controller.abort()
  }, [query.detailMovementId, refresh])

  const submitFilters = (event: FormEvent) => {
    event.preventDefault()
    navigate({
      ...query,
      ...filterDraft,
      page: 0,
      detailMovementId: undefined,
      editor: undefined,
    })
  }

  const openDetail = (
    id: string,
    trigger: HTMLElement,
  ) => {
    detailTrigger.current = trigger
    setActionError(null)
    navigate({
      ...query,
      detailMovementId: id,
      editor: undefined,
    })
  }

  const closeDetail = useCallback(() => {
    setActionError(null)
    navigate({
      ...query,
      detailMovementId: undefined,
      editor: undefined,
    })
  }, [navigate, query])

  const closeEditor = useCallback(() => {
    navigate({ ...query, editor: undefined })
  }, [navigate, query])

  const runTransition = async (
    action: 'submit' | 'approve' | 'reject' | 'post' | 'cancel' | 'reverse',
    detail: ManualMovementDetail,
  ) => {
    const labels = {
      submit: '提交审核',
      approve: '审核通过',
      reject: '审核不通过',
      post: '过账',
      cancel: '作废',
      reverse: '冲销',
    } as const
    const verb = labels[action]
    const approvalNote =
      action === 'reject'
        ? window.prompt('请输入未通过原因（1–300 字）')?.trim()
        : undefined
    if (action === 'reject' && !approvalNote) return
    const confirmed = window.confirm(
      action === 'post'
        ? `确认过账 ${detail.summary.movementNo}？库存将立即按明细更新。`
        : action === 'reverse'
          ? `确认冲销 ${detail.summary.movementNo}？系统会追加反向流水，不会删除原记录。`
          : action === 'cancel'
            ? `确认作废 ${detail.summary.movementNo}？该操作不会改变库存。`
            : `确认${verb} ${detail.summary.movementNo}？`,
    )
    if (!confirmed) return
    setSubmitting(true)
    setActionError(null)
    try {
      if (action === 'submit') {
        await manualMovementApi.submit(
          detail.summary.id,
          detail.summary.version,
          commandId(),
        )
      } else if (action === 'approve' || action === 'reject') {
        await manualMovementApi.review(
          detail.summary.id,
          detail.summary.version,
          commandId(),
          action === 'approve',
          approvalNote,
        )
      } else if (action === 'post') {
        await manualMovementApi.post(
          detail.summary.id,
          detail.summary.version,
          commandId(),
        )
      } else if (action === 'cancel') {
        await manualMovementApi.cancel(
          detail.summary.id,
          detail.summary.version,
          commandId(),
        )
      } else {
        await manualMovementApi.reverse(
          detail.summary.id,
          detail.summary.version,
          commandId(),
        )
      }
      setRefresh((value) => value + 1)
    } catch (error) {
      setActionError(safeMessage(error, verb))
    } finally {
      setSubmitting(false)
    }
  }

  const warehouses =
    warehouseState.status === 'ready' ? warehouseState.data : []
  const listData = 'data' in listState ? listState.data : undefined
  const detail =
    detailState.status === 'ready' ? detailState.data : undefined

  const selectedItems = useMemo(() => {
    if (!listData) return []
    return listData.items
      .filter((item) => selectedIds.has(item.id))
      .map<ManualMovementBatchItem>((item) => ({
        movementId: item.id,
        expectedVersion: item.version,
      }))
  }, [listData, selectedIds])

  const runBatch = async (
    action: 'approve' | 'reject' | 'post' | 'cancel',
  ) => {
    if (selectedItems.length === 0) return
    const reviewNote =
      action === 'reject'
        ? window.prompt('请输入批量审核不通过原因（1–300 字）')?.trim()
        : undefined
    if (action === 'reject' && !reviewNote) {
      setActionError('批量审核不通过必须填写原因。')
      return
    }
    if (
      !window.confirm(
        `确认对已选择的 ${selectedItems.length} 张单据执行该批量操作？`,
      )
    ) {
      return
    }
    setSubmitting(true)
    setActionError(null)
    try {
      if (action === 'approve' || action === 'reject') {
        await manualMovementApi.batchReview(
          selectedItems,
          commandId(),
          action === 'approve',
          reviewNote,
        )
      } else if (action === 'post') {
        await manualMovementApi.batchPost(selectedItems, commandId())
      } else {
        await manualMovementApi.batchCancel(selectedItems, commandId())
      }
      setSelectedIds(new Set())
      setRefresh((value) => value + 1)
    } catch (error) {
      setActionError(
        safeMessage(error, '批量处理手工出入库单'),
      )
    } finally {
      setSubmitting(false)
    }
  }

  const exportRows = (
    rows: NonNullable<typeof listData>['items'],
    filename: string,
  ) => {
    const headers = [
      '批次编号',
      '方向',
      '仓库',
      '类型',
      '来源',
      'WMS状态',
      '审批状态',
      '计划数量',
      '实际数量',
      '金额',
      '创建人',
      '审核人',
      '状态',
      '创建时间',
    ]
    const cells = rows.map((item) => [
      item.movementNo,
      directionLabel(item.direction),
      `${item.warehouseBusinessCode} ${item.warehouseName}`,
      item.movementTypeName ?? reasonLabel(item.reasonCode),
      sourceLabel(item.source),
      wmsStatusLabel(item.wmsStatus),
      approvalLabel(item.approvalStatus),
      item.totalQuantity,
      item.totalActualQuantity,
      formatMoney(item.totalAmount, item.currency),
      item.createdBy,
      item.reviewedBy ?? '',
      statusLabel(item.status),
      item.createdAt,
    ])
    const csv = [headers, ...cells]
      .map((row) => row.map(manualMovementCsvCell).join(','))
      .join('\r\n')
    const blob = new Blob([`\uFEFF${csv}`], {
      type: 'text/csv;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const exportFilteredRows = async () => {
    if (
      exporting ||
      listState.status !== 'ready' ||
      listState.data.totalElements === 0
    ) {
      return
    }
    const queryKey = exportQueryKey
    setExporting(true)
    setExportFeedback(null)
    try {
      const result = await manualMovementApi.exportCsv(filteredExportRequest)
      const url = URL.createObjectURL(
        new Blob([result.content], { type: result.mediaType }),
      )
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = result.filename
      document.body.append(anchor)
      try {
        anchor.click()
      } finally {
        anchor.remove()
        URL.revokeObjectURL(url)
      }
      setExportFeedback({
        kind: 'success',
        message: `已导出 ${result.rowCount} 条手工出入库单。`,
        queryKey,
      })
    } catch (error) {
      setExportFeedback({
        kind: 'error',
        message: exportMessage(error),
        queryKey,
      })
    } finally {
      setExporting(false)
    }
  }

  const printSkuLabels = async () => {
    if (!listData) return
    const selected = listData.items.filter((item) =>
      selectedIds.has(item.id),
    )
    if (selected.length === 0) return
    const popup = window.open('', '_blank')
    if (!popup) {
      setActionError('浏览器阻止了标签打印窗口，请允许弹窗后重试。')
      return
    }
    popup.opener = null
    setSubmitting(true)
    setActionError(null)
    try {
      const details = await Promise.all(
        selected.map((item) => manualMovementApi.get(item.id)),
      )
      const labels = details.flatMap((movement) =>
        movement.lines.map((line) => ({
          movementNo: movement.summary.movementNo,
          warehouseCode: movement.summary.warehouseBusinessCode,
          skuCode: line.skuBusinessCode,
          skuName: line.skuName,
          quantity: line.actualQuantity ?? line.quantity,
        })),
      )
      const heading = popup.document.createElement('h1')
      heading.textContent = '库存 SKU 标签'
      const list = popup.document.createElement('div')
      for (const label of labels) {
        const article = popup.document.createElement('article')
        article.setAttribute('data-sku-label', label.skuCode)
        const title = popup.document.createElement('strong')
        title.textContent = `${label.skuCode} · ${label.skuName}`
        const metadata = popup.document.createElement('p')
        metadata.textContent =
          `${label.movementNo} | ${label.warehouseCode} | ` +
          `数量 ${label.quantity}`
        article.append(title, metadata)
        list.append(article)
      }
      popup.document.body.replaceChildren(heading, list)
      popup.document.title = '库存 SKU 标签'
      popup.print()
      popup.close()
    } catch (error) {
      popup.close()
      setActionError(safeMessage(error, '读取待打印的库存 SKU 标签'))
    } finally {
      setSubmitting(false)
    }
  }

  const canWrite = hasPermission('inventory.manual.write')
  const canPost = hasPermission('inventory.manual.post')
  const canReverse = hasPermission('inventory.reverse')
  const canApprove = hasPermission('inventory.manual.approve')
  const canConfigure = hasPermission('inventory.manual.configure')

  return (
    <main className="manual-movement-page">
      <header className="manual-page-header">
        <div>
          <p className="eyebrow">仓库 / 库存作业</p>
          <h1>手工出入库</h1>
          <p>
            草稿保存不改变库存；过账后按仓库级 SKU 立即更新余额。
            允许负库存与超卖，负数仅表示库存事实。
          </p>
        </div>
        <div className="manual-header-actions">
          {canConfigure && (
            <button
              className="secondary-button"
              type="button"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings size={17} aria-hidden="true" />
              出入库设置
            </button>
          )}
          {canWrite && (
            <button
              className="primary-button"
              type="button"
              onClick={(event) => {
                editorTrigger.current = event.currentTarget
                navigate({
                  ...query,
                  editor: 'create',
                  detailMovementId: undefined,
                })
              }}
            >
              <Plus size={17} aria-hidden="true" />
              新增手工单
            </button>
          )}
        </div>
      </header>

      <div className="manual-direction-tabs" role="tablist" aria-label="业务视图">
        <button
          role="tab"
          type="button"
          aria-selected={query.view === 'INBOUND'}
          onClick={() =>
            navigate({
              ...query,
              view: 'INBOUND',
              approvalStatus: undefined,
              page: 0,
            })
          }
        >
          <ArrowDownToLine size={16} aria-hidden="true" />
          手工入库
        </button>
        <button
          role="tab"
          type="button"
          aria-selected={query.view === 'OUTBOUND'}
          onClick={() =>
            navigate({
              ...query,
              view: 'OUTBOUND',
              approvalStatus: undefined,
              page: 0,
            })
          }
        >
          <ArrowUpFromLine size={16} aria-hidden="true" />
          手工出库
        </button>
        <button
          role="tab"
          type="button"
          aria-selected={query.view === 'APPROVAL'}
          onClick={() =>
            navigate({
              ...query,
              view: 'APPROVAL',
              approvalStatus: 'PENDING',
              page: 0,
            })
          }
        >
          <ListChecks size={16} aria-hidden="true" />
          审核
        </button>
      </div>

      {query.view === 'APPROVAL' && (
        <div className="manual-approval-tabs" role="group" aria-label="审核方向">
          <button
            className="text-button"
            type="button"
            aria-pressed={!query.approvalDirection}
            onClick={() =>
              navigate({ ...query, approvalDirection: undefined, page: 0 })
            }
          >
            全部
          </button>
          {directions.map((direction) => (
            <button
              className="text-button"
              type="button"
              key={direction}
              aria-pressed={query.approvalDirection === direction}
              onClick={() =>
                navigate({
                  ...query,
                  approvalDirection: direction,
                  page: 0,
                })
              }
            >
              {direction === 'INBOUND' ? '入库审批' : '出库审批'}
            </button>
          ))}
        </div>
      )}

      <form
        className="manual-filter-panel"
        aria-label="手工出入库筛选"
        onSubmit={submitFilters}
      >
        <label>
          搜索维度
          <select
            value={filterDraft.searchField}
            onChange={(event) =>
              setFilterDraft((current) => ({
                ...current,
                searchField: event.target.value as ManualMovementSearchField,
              }))
            }
          >
            {searchFields.map((field) => (
              <option value={field} key={field}>
                {searchFieldLabel(field)}
              </option>
            ))}
          </select>
        </label>
        <label>
          关键词
          <input
            value={filterDraft.keyword}
            maxLength={100}
            placeholder={`搜索${searchFieldLabel(filterDraft.searchField)}`}
            onChange={(event) =>
              setFilterDraft((current) => ({
                ...current,
                keyword: event.target.value,
              }))
            }
          />
        </label>
        <label>
          业务类型
          <select
            value={filterDraft.movementTypeId ?? ''}
            onChange={(event) =>
              setFilterDraft((current) => ({
                ...current,
                movementTypeId: event.target.value || undefined,
              }))
            }
          >
            <option value="">全部类型</option>
            {movementTypes
              .filter(
                (type) =>
                  type.direction ===
                  (query.view === 'APPROVAL'
                    ? filterDraft.approvalDirection ?? type.direction
                    : query.view),
              )
              .map((type) => (
                <option value={type.id} key={type.id}>
                  {type.name}
                  {type.status === 'INACTIVE' ? '（已停用）' : ''}
                </option>
              ))}
          </select>
        </label>
        <label>
          仓库
          <select
            value={filterDraft.warehouseId ?? ''}
            onChange={(event) =>
              setFilterDraft((current) => ({
                ...current,
                warehouseId: event.target.value || undefined,
              }))
            }
          >
            <option value="">全部可见仓库</option>
            {warehouses.map((warehouse) => (
              <option value={warehouse.id} key={warehouse.id}>
                {warehouse.businessCode} · {warehouse.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          来源
          <select
            value={filterDraft.source ?? ''}
            onChange={(event) =>
              setFilterDraft((current) => ({
                ...current,
                source:
                  (event.target.value as ManualMovementSource) || undefined,
              }))
            }
          >
            <option value="">全部来源</option>
            {sources.map((source) => (
              <option value={source} key={source}>
                {sourceLabel(source)}
              </option>
            ))}
          </select>
        </label>
        <label>
          WMS 状态
          <select
            value={filterDraft.wmsStatus ?? ''}
            onChange={(event) =>
              setFilterDraft((current) => ({
                ...current,
                wmsStatus:
                  (event.target.value as ManualMovementWmsStatus) ||
                  undefined,
              }))
            }
          >
            <option value="">全部 WMS 状态</option>
            {wmsStatuses.map((status) => (
              <option value={status} key={status}>
                {wmsStatusLabel(status)}
              </option>
            ))}
          </select>
        </label>
        {query.view === 'APPROVAL' && (
          <label>
            审核状态
            <select
              value={filterDraft.approvalStatus ?? ''}
              onChange={(event) =>
                setFilterDraft((current) => ({
                  ...current,
                  approvalStatus:
                    (event.target.value as ManualMovementApprovalStatus) ||
                    undefined,
                }))
              }
            >
              {approvalStatuses.map((status) => (
                <option value={status} key={status}>
                  {approvalLabel(status)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          时间范围
          <select
            value={filterDraft.timeBucket ?? ''}
            onChange={(event) =>
              setFilterDraft((current) => ({
                ...current,
                timeBucket:
                  (event.target.value as ManualMovementTimeBucket) ||
                  undefined,
              }))
            }
          >
            <option value="">不限</option>
            {timeBuckets.map((bucket) => (
              <option value={bucket} key={bucket}>
                {timeBucketLabel(bucket)}
              </option>
            ))}
          </select>
        </label>
        <label>
          状态
          <select
            value={filterDraft.status ?? ''}
            onChange={(event) =>
              setFilterDraft((current) => ({
                ...current,
                status:
                  (event.target.value as ManualMovementStatus) ||
                  undefined,
              }))
            }
          >
            <option value="">全部状态</option>
            {statuses.map((status) => (
              <option value={status} key={status}>
                {statusLabel(status)}
              </option>
            ))}
          </select>
        </label>
        <label>
          出入库类型
          <select
            value={filterDraft.reasonCode ?? ''}
            onChange={(event) =>
              setFilterDraft((current) => ({
                ...current,
                reasonCode:
                  (event.target.value as ManualMovementReason) ||
                  undefined,
              }))
            }
          >
            <option value="">全部类型</option>
            {reasons.map((reason) => (
              <option value={reason} key={reason}>
                {reasonLabel(reason)}
              </option>
            ))}
          </select>
        </label>
        <label>
          创建日期起
          <input
            type="date"
            value={filterDraft.createdFrom}
            onChange={(event) =>
              setFilterDraft((current) => ({
                ...current,
                createdFrom: event.target.value,
              }))
            }
          />
        </label>
        <label>
          创建日期止
          <input
            type="date"
            value={filterDraft.createdTo}
            onChange={(event) =>
              setFilterDraft((current) => ({
                ...current,
                createdTo: event.target.value,
              }))
            }
          />
        </label>
        <div className="manual-filter-actions">
          <button className="secondary-button" type="submit">
            <Search size={16} aria-hidden="true" />
            搜索
          </button>
          <button
            className="text-button"
            type="button"
            onClick={() =>
              navigate({
                view: query.view,
                approvalDirection: query.approvalDirection,
                approvalStatus:
                  query.view === 'APPROVAL' ? 'PENDING' : undefined,
                searchField: 'BATCH_NO',
                keyword: '',
                createdFrom: '',
                createdTo: '',
                page: 0,
                size: DEFAULT_SIZE,
              })
            }
          >
            重置
          </button>
        </div>
      </form>

      <section className="manual-table-section" aria-live="polite">
        <div className="manual-table-toolbar">
          <strong>
            {query.view === 'APPROVAL' ? '审核单据' : '单据列表'}
          </strong>
          <div className="manual-batch-actions">
            <span>已选 {selectedIds.size} 张</span>
            <details className="erp-action-menu manual-batch-menu">
              <summary className="secondary-button">批量操作</summary>
              <div className="erp-action-menu-popover">
                {query.view === 'APPROVAL' && canApprove && (
                  <>
                    <button
                      type="button"
                      disabled={submitting || selectedIds.size === 0}
                      onClick={() => void runBatch('approve')}
                    >
                      批量通过
                    </button>
                    <button
                      type="button"
                      disabled={submitting || selectedIds.size === 0}
                      onClick={() => void runBatch('reject')}
                    >
                      批量不通过
                    </button>
                  </>
                )}
                {query.view !== 'APPROVAL' && canPost && (
                  <button
                    type="button"
                    disabled={submitting || selectedIds.size === 0}
                    onClick={() => void runBatch('post')}
                  >
                    批量标记{query.view === 'INBOUND' ? '入库' : '出库'}
                  </button>
                )}
                {canWrite && (
                  <button
                    className="danger"
                    type="button"
                    disabled={submitting || selectedIds.size === 0}
                    onClick={() => void runBatch('cancel')}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                    批量作废
                  </button>
                )}
                <button
                  type="button"
                  disabled={submitting || selectedIds.size === 0}
                  onClick={() => void printSkuLabels()}
                >
                  <Printer size={15} aria-hidden="true" />
                  打印 SKU 标签
                </button>
              </div>
            </details>
            <details className="erp-action-menu manual-transfer-menu">
              <summary className="secondary-button">导入 / 导出</summary>
              <div className="erp-action-menu-popover">
                <button
                  type="button"
                  disabled={
                    exporting ||
                    listState.status !== 'ready' ||
                    listState.data.totalElements === 0
                  }
                  onClick={() => void exportFilteredRows()}
                >
                  <FileDown size={15} aria-hidden="true" />
                  {exporting ? '正在导出…' : '导出筛选结果'}
                </button>
                <button
                  type="button"
                  disabled={
                    exporting || !listData || listData.items.length === 0
                  }
                  onClick={() =>
                    listData &&
                    exportRows(
                      listData.items,
                      `manual-movements-page-${query.page + 1}.csv`,
                    )
                  }
                >
                  <FileDown size={15} aria-hidden="true" />
                  导出当前页
                </button>
                <button
                  type="button"
                  disabled={exporting || selectedIds.size === 0 || !listData}
                  onClick={() =>
                    listData &&
                    exportRows(
                      listData.items.filter((item) =>
                        selectedIds.has(item.id),
                      ),
                      'manual-movements-selected.csv',
                    )
                  }
                >
                  导出勾选
                </button>
              </div>
            </details>
          </div>
          <button
            className="text-button"
            type="button"
            disabled={listState.status === 'loading'}
            onClick={() => setRefresh((value) => value + 1)}
          >
            <RefreshCw size={15} aria-hidden="true" />
            刷新
          </button>
        </div>
        {exportFeedback?.queryKey === exportQueryKey && (
          <div
            className={`manual-export-feedback is-${exportFeedback.kind}`}
            role={exportFeedback.kind === 'error' ? 'alert' : 'status'}
          >
            {exportFeedback.message}
          </div>
        )}
        {actionError && !query.detailMovementId && (
          <div className="manual-alert" role="alert">
            {actionError}
          </div>
        )}
        {listState.status === 'loading' && !listData && (
          <div className="manual-state">正在加载手工出入库单…</div>
        )}
        {listState.status === 'error' && !listData && (
          <div className="manual-state manual-state-error" role="alert">
            <p>{listState.message}</p>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setRefresh((value) => value + 1)}
            >
              重试
            </button>
          </div>
        )}
        {listData && (
          <>
            <div className="manual-table-scroll">
              <table>
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      aria-label="选择当前页全部单据"
                      checked={
                        listData.items.length > 0 &&
                        listData.items.every((item) =>
                          selectedIds.has(item.id),
                        )
                      }
                      onChange={(event) => {
                        setSelectedIds((current) => {
                          const next = new Set(current)
                          for (const item of listData.items) {
                            if (event.target.checked) next.add(item.id)
                            else next.delete(item.id)
                          }
                          return next
                        })
                      }}
                    />
                  </th>
                  <th>批次编号</th>
                  <th>方向</th>
                  <th>仓库</th>
                  <th>类型</th>
                  <th>来源</th>
                  <th>WMS</th>
                  <th>审核</th>
                  <th>来源单号</th>
                  <th>SKU 行数</th>
                  <th>计划 / 实际</th>
                  <th>金额</th>
                  <th>状态</th>
                  <th>创建 / 待审核或审核人员</th>
                  <th>创建时间</th>
                  <th>实际过账时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {listData.items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`选择 ${item.movementNo}`}
                        checked={selectedIds.has(item.id)}
                        onChange={(event) => {
                          setSelectedIds((current) => {
                            const next = new Set(current)
                            if (event.target.checked) next.add(item.id)
                            else next.delete(item.id)
                            return next
                          })
                        }}
                      />
                    </td>
                    <td>
                      <button
                        className="manual-link-button"
                        type="button"
                        onClick={(event) =>
                          openDetail(item.id, event.currentTarget)
                        }
                      >
                        {item.movementNo}
                      </button>
                    </td>
                    <td>{directionLabel(item.direction)}</td>
                    <td>
                      {item.warehouseBusinessCode} · {item.warehouseName}
                    </td>
                    <td>
                      {item.movementTypeName ?? reasonLabel(item.reasonCode)}
                    </td>
                    <td>{sourceLabel(item.source)}</td>
                    <td>{wmsStatusLabel(item.wmsStatus)}</td>
                    <td>{approvalLabel(item.approvalStatus)}</td>
                    <td>{item.sourceReference ?? '—'}</td>
                    <td>{item.lineCount}</td>
                    <td>
                      {item.totalQuantity} / {item.totalActualQuantity}
                    </td>
                    <td>{formatMoney(item.totalAmount, item.currency)}</td>
                    <td>
                      <span
                        className={`manual-status manual-status-${item.status.toLowerCase()}`}
                      >
                        {statusLabel(item.status)}
                      </span>
                    </td>
                    <td>
                      <div>{item.createdBy}</div>
                      <div>{reviewerLabel(item)}</div>
                    </td>
                    <td>{formatTime(item.createdAt)}</td>
                    <td>{formatTime(item.postedAt)}</td>
                    <td>
                      <button
                        className="text-button"
                        type="button"
                        onClick={(event) =>
                          openDetail(item.id, event.currentTarget)
                        }
                      >
                        详情
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              </table>
            </div>
            {listData.items.length === 0 && (
              <div className="manual-state">
                当前筛选下没有手工出入库单。
              </div>
            )}
          </>
        )}
        {listData && (
          <div className="manual-pagination">
            <span>
              共 {listData.totalElements} 条 · 第 {listData.page + 1} /
              {Math.max(1, listData.totalPages)} 页
            </span>
            <div>
              <label>
                每页
                <select
                  aria-label="每页单据数"
                  value={query.size}
                  onChange={(event) =>
                    navigate({
                      ...query,
                      page: 0,
                      size: Number(event.currentTarget.value),
                    })
                  }
                >
                  {[...new Set([...PAGE_SIZES, query.size])]
                    .sort((left, right) => left - right)
                    .map((size) => (
                      <option key={size} value={size}>
                        {size} 条
                      </option>
                    ))}
                </select>
              </label>
              <button
                className="secondary-button"
                type="button"
                disabled={query.page === 0}
                onClick={() =>
                  navigate({ ...query, page: Math.max(0, query.page - 1) })
                }
              >
                上一页
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={
                  listData.totalPages === 0 ||
                  query.page + 1 >= listData.totalPages
                }
                onClick={() =>
                  navigate({ ...query, page: query.page + 1 })
                }
              >
                下一页
              </button>
            </div>
          </div>
        )}
      </section>

      {query.detailMovementId && !query.editor && (
        <Dialog
          title="手工出入库详情"
          titleId="manual-detail-title"
          restoreRef={detailTrigger}
          onClose={closeDetail}
          wide
        >
          <div className="manual-modal-body">
            {detailState.status === 'loading' && (
              <div className="manual-state">正在加载单据详情…</div>
            )}
            {detailState.status === 'error' && (
              <div
                className="manual-state manual-state-error"
                role="alert"
              >
                <p>{detailState.message}</p>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setRefresh((value) => value + 1)}
                >
                  重试
                </button>
              </div>
            )}
            {detail && (
              <ManualMovementDetailView
                detail={detail}
                timelineState={timelineState}
                ledgerState={ledgerState}
              />
            )}
            {actionError && (
              <div className="manual-alert" role="alert">
                {actionError}
              </div>
            )}
          </div>
          {detail && (
            <footer className="manual-modal-footer">
              {detail.summary.status === 'DRAFT' && canWrite && (
                <>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={(event) => {
                      editorTrigger.current = event.currentTarget
                      navigate({ ...query, editor: 'edit' })
                    }}
                  >
                    <Pencil size={16} aria-hidden="true" />
                    编辑草稿
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    disabled={submitting}
                    onClick={() => void runTransition('submit', detail)}
                  >
                    <Send size={16} aria-hidden="true" />
                    {submitting ? '正在提交…' : '提交'}
                  </button>
                  <button
                    className="danger-button"
                    type="button"
                    disabled={submitting}
                    onClick={() => void runTransition('cancel', detail)}
                  >
                    作废
                  </button>
                </>
              )}
              {detail.summary.status === 'SUBMITTED' &&
                detail.summary.approvalStatus === 'PENDING' &&
                canApprove && (
                  <>
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={submitting}
                      onClick={() => void runTransition('reject', detail)}
                    >
                      审核不通过
                    </button>
                    <button
                      className="primary-button"
                      type="button"
                      disabled={submitting}
                      onClick={() => void runTransition('approve', detail)}
                    >
                      <Check size={16} aria-hidden="true" />
                      审核通过
                    </button>
                  </>
                )}
              {detail.summary.status === 'SUBMITTED' &&
                canWrite && (
                  <button
                    className="danger-button"
                    type="button"
                    disabled={submitting}
                    onClick={() => void runTransition('cancel', detail)}
                  >
                    作废
                  </button>
                )}
              {detail.summary.status === 'SUBMITTED' &&
                detail.summary.approvalStatus !== 'PENDING' &&
                detail.summary.approvalStatus !== 'REJECTED' &&
                canPost && (
                <button
                  className="primary-button"
                  type="button"
                  disabled={submitting}
                  onClick={() => void runTransition('post', detail)}
                >
                  {submitting ? '正在过账…' : '确认过账'}
                </button>
              )}
              {detail.summary.status === 'POSTED' && canReverse && (
                <button
                  className="danger-button"
                  type="button"
                  disabled={submitting}
                  onClick={() => void runTransition('reverse', detail)}
                >
                  <RotateCcw size={16} aria-hidden="true" />
                  {submitting ? '正在冲销…' : '冲销单据'}
                </button>
              )}
              <button
                className="secondary-button"
                type="button"
                onClick={closeDetail}
              >
                返回
              </button>
            </footer>
          )}
        </Dialog>
      )}

      {query.editor && canWrite && (
        <ManualMovementEditor
          mode={query.editor}
          initial={query.editor === 'edit' ? detail : undefined}
          defaultDirection={
            query.view === 'APPROVAL'
              ? query.approvalDirection ?? 'INBOUND'
              : query.view
          }
          loadingInitial={
            query.editor === 'edit' &&
            detailState.status === 'loading'
          }
          warehouses={warehouses}
          movementTypes={movementTypes}
          settings={settingsByDirection}
          canPost={canPost}
          restoreRef={editorTrigger}
          onClose={closeEditor}
          onSaved={(id, warning) => {
            setRefresh((value) => value + 1)
            setActionError(warning ?? null)
            navigate({
              ...query,
              detailMovementId: id,
              editor: undefined,
            })
          }}
        />
      )}
      {settingsOpen && canConfigure && (
        <ManualMovementSettingsDialog
          settings={settingsByDirection}
          types={movementTypes}
          onClose={() => setSettingsOpen(false)}
          onSaved={() => {
            setSettingsOpen(false)
            setRefresh((value) => value + 1)
          }}
        />
      )}
      {query.editor && !canWrite && (
        <Dialog
          title="没有编辑权限"
          titleId="manual-editor-forbidden-title"
          restoreRef={editorTrigger}
          onClose={closeEditor}
        >
          <div className="manual-state manual-state-error" role="alert">
            当前账号没有编辑手工出入库草稿的权限。
          </div>
          <footer className="manual-modal-footer">
            <button
              className="secondary-button"
              type="button"
              onClick={closeEditor}
            >
              返回
            </button>
          </footer>
        </Dialog>
      )}
    </main>
  )
}

function ManualMovementDetailView({
  detail,
  timelineState,
  ledgerState,
}: {
  detail: ManualMovementDetail
  timelineState: LoadState<ManualMovementTimelineEvent[]>
  ledgerState: LoadState<ManualMovementLedgerEvent[]>
}) {
  const summary = detail.summary
  return (
    <>
      <dl className="manual-detail-grid">
        <div>
          <dt>批次编号</dt>
          <dd>{summary.movementNo}</dd>
        </div>
        <div>
          <dt>方向</dt>
          <dd>{directionLabel(summary.direction)}</dd>
        </div>
        <div>
          <dt>状态</dt>
          <dd>{statusLabel(summary.status)}</dd>
        </div>
        <div>
          <dt>仓库</dt>
          <dd>
            {summary.warehouseBusinessCode} · {summary.warehouseName}
          </dd>
        </div>
        <div>
          <dt>业务类型 / 原因</dt>
          <dd>
            {summary.movementTypeName ?? '未分类'} ·{' '}
            {reasonLabel(summary.reasonCode)}
          </dd>
        </div>
        <div>
          <dt>来源 / WMS</dt>
          <dd>
            {sourceLabel(summary.source)} ·{' '}
            {wmsStatusLabel(summary.wmsStatus)}
          </dd>
        </div>
        <div>
          <dt>审核</dt>
          <dd>
            {approvalLabel(summary.approvalStatus)}
            {' · '}
            {reviewerLabel(summary)}
            {summary.reviewNote ? ` · ${summary.reviewNote}` : ''}
          </dd>
        </div>
        <div>
          <dt>录入方式</dt>
          <dd>{summary.entryMode === 'BOX' ? '按箱' : '按商品散件'}</dd>
        </div>
        <div>
          <dt>来源单号</dt>
          <dd>{summary.sourceReference ?? '—'}</dd>
        </div>
        <div>
          <dt>{summary.direction === 'INBOUND' ? '发件信息' : '收件信息'}</dt>
          <dd>
            {detail.contactInformation.name ??
              detail.contactInformation.phone ??
              detail.contactInformation.address
              ? [
                  detail.contactInformation.name,
                  detail.contactInformation.phone,
                  detail.contactInformation.address,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : '—'}
          </dd>
        </div>
        <div>
          <dt>备注</dt>
          <dd>{summary.note ?? '—'}</dd>
        </div>
        <div>
          <dt>创建 / 审核人员</dt>
          <dd>
            {summary.createdBy} / {reviewerLabel(summary)}
          </dd>
        </div>
        <div>
          <dt>计划 / 实际数量</dt>
          <dd>
            {summary.totalQuantity} / {summary.totalActualQuantity}
          </dd>
        </div>
        <div>
          <dt>汇总金额</dt>
          <dd>{formatMoney(summary.totalAmount, summary.currency)}</dd>
        </div>
        <div>
          <dt>扩展属性</dt>
          <dd>
            {Object.keys(summary.extensionAttributes).length === 0
              ? '—'
              : Object.entries(summary.extensionAttributes)
                  .map(([key, value]) => `${key}: ${value}`)
                  .join('；')}
          </dd>
        </div>
      </dl>
      <h3>商品明细</h3>
      <div className="manual-table-scroll">
        <table>
          <thead>
            <tr>
              <th>行号</th>
              <th>商品 SKU</th>
              <th>名称</th>
              <th>库位与业务编码</th>
              <th>数量</th>
              <th>实际数量</th>
              <th>单价 / 金额</th>
              <th>扩展属性</th>
              <th>当前仓库量</th>
              <th>行备注</th>
            </tr>
          </thead>
          <tbody>
            {detail.lines.map((line) => (
              <tr key={line.id}>
                <td>{line.lineNumber}</td>
                <td>{line.skuBusinessCode}</td>
                <td>{line.skuName}</td>
                <td>
                  {line.locationBusinessCode} · {line.locationName}
                </td>
                <td>{line.quantity}</td>
                <td>{line.actualQuantity ?? '—'}</td>
                <td>
                  {line.unitPrice === undefined
                    ? '—'
                    : `${formatMoney(line.unitPrice, line.currency)} / ` +
                      formatMoney(line.amount ?? 0, line.currency)}
                </td>
                <td>
                  {Object.keys(line.extensionAttributes).length === 0
                    ? '—'
                    : Object.entries(line.extensionAttributes)
                        .map(([key, value]) => `${key}: ${value}`)
                        .join('；')}
                </td>
                <td>
                  {line.currentOnHand === undefined
                    ? '暂无余额记录'
                    : line.currentOnHand}
                  {line.currentOnHand !== undefined &&
                    line.currentOnHand < 0 && (
                    <span className="manual-negative-label">
                      负库存事实
                    </span>
                    )}
                </td>
                <td>{line.note ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {detail.boxes.length > 0 && (
        <>
          <h3>箱清单</h3>
          <div className="manual-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>箱号</th>
                  <th>箱数 / 规则</th>
                  <th>尺寸（cm）</th>
                  <th>单箱毛重（kg）</th>
                  <th>箱内 SKU</th>
                </tr>
              </thead>
              <tbody>
                {detail.boxes.map((box) => (
                  <tr key={box.id}>
                    <td>{box.customBoxNo}</td>
                    <td>
                      {box.boxCount} /{' '}
                      {box.boxNumberRule === 'UNIQUE_NUMBER'
                        ? '逐箱编号'
                        : '共享箱号'}
                    </td>
                    <td>
                      {box.lengthCm} × {box.widthCm} × {box.heightCm}
                    </td>
                    <td>{box.grossWeightKg}</td>
                    <td>
                      {box.items
                        .map(
                          (item) =>
                            `${item.skuBusinessCode} × ` +
                            `${item.quantityPerBox}/箱`,
                        )
                        .join('；')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className="manual-detail-columns">
        <section>
          <h3>状态记录</h3>
          {timelineState.status === 'loading' && <p>正在加载…</p>}
          {timelineState.status === 'error' && (
            <p role="alert">{timelineState.message}</p>
          )}
          {timelineState.status === 'ready' && (
            <ol className="manual-timeline">
              {timelineState.data.map((event) => (
                <li key={event.id}>
                  <strong>{event.eventType}</strong>
                  <span>
                    {event.fromStatus
                      ? `${statusLabel(event.fromStatus)} → `
                      : ''}
                    {statusLabel(event.toStatus)}
                  </span>
                  <small>
                    v{event.movementVersion} ·{' '}
                    {formatTime(event.recordedAt)}
                  </small>
                </li>
              ))}
            </ol>
          )}
        </section>
        <section>
          <h3>库存流水</h3>
          {ledgerState.status === 'loading' && <p>正在加载…</p>}
          {ledgerState.status === 'error' && (
            <p role="alert">{ledgerState.message}</p>
          )}
          {ledgerState.status === 'ready' &&
            ledgerState.data.length === 0 && (
              <p>草稿尚未产生库存流水。</p>
            )}
          {ledgerState.status === 'ready' &&
            ledgerState.data.length > 0 && (
              <ol className="manual-timeline">
                {ledgerState.data.map((event) => (
                  <li key={event.id}>
                    <strong>
                      #{event.ledgerSequence} · {event.eventType}
                    </strong>
                    <span>
                      变动 {event.signedDelta > 0 ? '+' : ''}
                      {event.signedDelta}，余额 {event.balanceAfter}
                    </span>
                    <small>{formatTime(event.recordedAt)}</small>
                  </li>
                ))}
              </ol>
            )}
        </section>
      </div>
    </>
  )
}

function ManualMovementSettingsDialog({
  settings,
  types,
  onClose,
  onSaved,
}: {
  settings: Partial<
    Record<ManualMovementDirection, ManualMovementSettings>
  >
  types: ManualMovementType[]
  onClose: () => void
  onSaved: () => void
}) {
  const restoreRef = useRef<HTMLElement | null>(document.activeElement as HTMLElement)
  const [direction, setDirection] =
    useState<ManualMovementDirection>('INBOUND')
  const [drafts, setDrafts] = useState<
    Partial<Record<ManualMovementDirection, ManualMovementSettings>>
  >(settings)
  const [typeCode, setTypeCode] = useState('')
  const [typeName, setTypeName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const current = drafts[direction] ?? {
    direction,
    approvalRequired: false,
    unitPriceRequired: false,
    showCostPrice: false,
    costUpdatePolicy: 'NO_UPDATE' as const,
    contactInformationRequired: false,
    version: 0,
  }

  const setSetting = <K extends keyof ManualMovementSettings>(
    key: K,
    value: ManualMovementSettings[K],
  ) => {
    setDrafts((all) => ({
      ...all,
      [direction]: { ...current, [key]: value },
    }))
  }

  const saveSettings = async () => {
    setSubmitting(true)
    setError(null)
    try {
      await manualMovementApi.saveSettings(
        {
          approvalRequired: current.approvalRequired,
          unitPriceRequired: current.unitPriceRequired,
          showCostPrice: current.showCostPrice,
          costUpdatePolicy: current.costUpdatePolicy,
          contactInformationRequired: current.contactInformationRequired,
          version: current.version,
        },
        direction,
        commandId(),
      )
      onSaved()
    } catch (caught) {
      setError(safeMessage(caught, '保存出入库设置'))
    } finally {
      setSubmitting(false)
    }
  }

  const createType = async () => {
    if (!typeCode.trim() || !typeName.trim()) {
      setError('类型编码和名称不能为空。')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await manualMovementApi.saveType({
        direction,
        code: typeCode.trim(),
        name: typeName.trim(),
        status: 'ACTIVE',
        expectedVersion: 0,
        commandId: commandId(),
      })
      onSaved()
    } catch (caught) {
      setError(safeMessage(caught, '新增出入库类型'))
    } finally {
      setSubmitting(false)
    }
  }

  const toggleType = async (type: ManualMovementType) => {
    setSubmitting(true)
    setError(null)
    try {
      await manualMovementApi.saveType({
        ...type,
        status: type.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
        expectedVersion: type.version,
        commandId: commandId(),
      })
      onSaved()
    } catch (caught) {
      setError(safeMessage(caught, '更新出入库类型'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      title="出入库设置"
      titleId="manual-settings-title"
      restoreRef={restoreRef}
      onClose={onClose}
      wide
    >
      <div className="manual-modal-body">
        <div className="manual-approval-tabs" role="group" aria-label="设置方向">
          {directions.map((item) => (
            <button
              className="text-button"
              type="button"
              key={item}
              aria-pressed={direction === item}
              onClick={() => setDirection(item)}
            >
              {directionLabel(item)}
            </button>
          ))}
        </div>
        <fieldset className="manual-settings-grid" disabled={submitting}>
          <legend>{directionLabel(direction)}规则</legend>
          <label>
            <input
              type="checkbox"
              checked={current.approvalRequired}
              onChange={(event) =>
                setSetting('approvalRequired', event.target.checked)
              }
            />
            过账前必须审核
          </label>
          <label>
            <input
              type="checkbox"
              checked={current.unitPriceRequired}
              onChange={(event) =>
                setSetting('unitPriceRequired', event.target.checked)
              }
            />
            明细单价必填
          </label>
          <label>
            <input
              type="checkbox"
              checked={current.showCostPrice}
              onChange={(event) =>
                setSetting('showCostPrice', event.target.checked)
              }
            />
            显示本单价格快照
          </label>
          <label>
            <input
              type="checkbox"
              checked={current.contactInformationRequired}
              onChange={(event) =>
                setSetting(
                  'contactInformationRequired',
                  event.target.checked,
                )
              }
            />
            收件 / 发件联系信息必填
          </label>
          <label>
            价格快照策略
            <select
              value={current.costUpdatePolicy}
              onChange={(event) =>
                setSetting(
                  'costUpdatePolicy',
                  event.target.value as ManualMovementSettings['costUpdatePolicy'],
                )
              }
            >
              <option value="NO_UPDATE">仅记录本单，不更新商品成本</option>
              <option value="UPDATE_SNAPSHOT">
                记录最近一次已过账手工价格快照
              </option>
            </select>
          </label>
          <p>
            价格快照只保存人工/导入值，不自动计算成本；冲销保留原始快照历史。
          </p>
        </fieldset>
        <section>
          <h3>出入库类型分类</h3>
          <div className="manual-type-builder">
            <label>
              类型编码
              <input
                value={typeCode}
                maxLength={40}
                onChange={(event) => setTypeCode(event.target.value)}
              />
            </label>
            <label>
              类型名称
              <input
                value={typeName}
                maxLength={80}
                onChange={(event) => setTypeName(event.target.value)}
              />
            </label>
            <button
              className="secondary-button"
              type="button"
              disabled={submitting}
              onClick={() => void createType()}
            >
              新增分类
            </button>
          </div>
          <div className="manual-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>编码</th>
                  <th>名称</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {types.filter((type) => type.direction === direction)
                  .length === 0 && (
                  <tr>
                    <td colSpan={4}>当前方向尚未配置业务类型。</td>
                  </tr>
                )}
                {types
                  .filter((type) => type.direction === direction)
                  .map((type) => (
                    <tr key={type.id}>
                      <td>{type.code}</td>
                      <td>{type.name}</td>
                      <td>{type.status === 'ACTIVE' ? '启用' : '停用'}</td>
                      <td>
                        <button
                          className="text-button"
                          type="button"
                          disabled={submitting}
                          onClick={() => void toggleType(type)}
                        >
                          {type.status === 'ACTIVE' ? '停用' : '启用'}
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
        {error && (
          <div className="manual-alert" role="alert">
            {error}
          </div>
        )}
      </div>
      <footer className="manual-modal-footer">
        <button
          className="secondary-button"
          type="button"
          disabled={submitting}
          onClick={onClose}
        >
          取消
        </button>
        <button
          className="primary-button"
          type="button"
          disabled={submitting}
          onClick={() => void saveSettings()}
        >
          {submitting ? '正在保存…' : '保存设置'}
        </button>
      </footer>
    </Dialog>
  )
}

type EditorLine = ManualMovementLineInput & {
  skuLabel?: string
  locationLabel?: string
}

function ManualMovementEditor({
  mode,
  initial,
  defaultDirection,
  loadingInitial,
  warehouses,
  movementTypes,
  settings,
  canPost,
  restoreRef,
  onClose,
  onSaved,
}: {
  mode: EditorMode
  initial?: ManualMovementDetail
  defaultDirection: ManualMovementDirection
  loadingInitial: boolean
  warehouses: ManualMovementWarehouseOption[]
  movementTypes: ManualMovementType[]
  settings: Partial<
    Record<ManualMovementDirection, ManualMovementSettings>
  >
  canPost: boolean
  restoreRef: RefObject<HTMLElement | null>
  onClose: () => void
  onSaved: (id: string, warning?: string) => void
}) {
  const [warehouseId, setWarehouseId] = useState(
    initial?.summary.warehouseId ?? '',
  )
  const [direction, setDirection] =
    useState<ManualMovementDirection>(
      initial?.summary.direction ?? defaultDirection,
    )
  const [reasonCode, setReasonCode] =
    useState<ManualMovementReason>(
      initial?.summary.reasonCode ??
        (defaultDirection === 'INBOUND'
          ? 'FOUND_STOCK'
          : 'DAMAGED_STOCK'),
    )
  const [note, setNote] = useState(initial?.summary.note ?? '')
  const [sourceReference, setSourceReference] = useState(
    initial?.summary.sourceReference ?? '',
  )
  const [contactName, setContactName] = useState(
    initial?.contactInformation.name ?? '',
  )
  const [contactPhone, setContactPhone] = useState(
    initial?.contactInformation.phone ?? '',
  )
  const [contactAddress, setContactAddress] = useState(
    initial?.contactInformation.address ?? '',
  )
  const [movementTypeId, setMovementTypeId] = useState(
    initial?.summary.movementTypeId ?? '',
  )
  const [source, setSource] = useState<ManualMovementSource>(
    initial?.summary.source ?? 'MANUAL',
  )
  const [entryMode, setEntryMode] = useState<ManualMovementEntryMode>(
    initial?.summary.entryMode ?? 'PRODUCT',
  )
  const [documentAttributeName, setDocumentAttributeName] = useState(
    Object.keys(initial?.summary.extensionAttributes ?? {})[0] ?? '',
  )
  const [documentAttributeValue, setDocumentAttributeValue] = useState(
    Object.values(initial?.summary.extensionAttributes ?? {})[0] ?? '',
  )
  const [lines, setLines] = useState<EditorLine[]>(
    initial?.lines.map((line) => ({
      skuId: line.skuId,
      locationId: line.locationId,
      quantity: line.quantity,
      note: line.note,
      unitPrice: line.unitPrice,
      currency: line.currency,
      extensionAttributes: line.extensionAttributes,
      skuLabel: `${line.skuBusinessCode} · ${line.skuName}`,
      locationLabel:
        `${line.locationBusinessCode} · ${line.locationName}`,
    })) ?? [],
  )
  const [boxes, setBoxes] = useState<ManualMovementBoxInput[]>(
    initial?.boxes.map((box) => ({
      sourceBoxStockId: box.sourceBoxStockId,
      customBoxNo: box.customBoxNo,
      boxCount: box.boxCount,
      boxNumberRule: box.boxNumberRule,
      lengthCm: box.lengthCm,
      widthCm: box.widthCm,
      heightCm: box.heightCm,
      grossWeightKg: box.grossWeightKg,
      items: box.items.map((item) => ({
        skuId: item.skuId,
        quantityPerBox: item.quantityPerBox,
      })),
    })) ?? [],
  )
  const [boxStock, setBoxStock] = useState<ManualMovementBoxStock[]>([])
  const [boxStockLoading, setBoxStockLoading] = useState(false)
  const [locations, setLocations] = useState<
    ManualMovementLocationOption[]
  >([])
  const [locationsLoading, setLocationsLoading] = useState(false)
  const [skuOptions, setSkuOptions] = useState<
    ManualMovementSkuOption[]
  >([])
  const [skuLoading, setSkuLoading] = useState(false)
  const [skuKeyword, setSkuKeyword] = useState('')
  const [selectedSkuId, setSelectedSkuId] = useState('')
  const [selectedLocationId, setSelectedLocationId] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [lineNote, setLineNote] = useState('')
  const [lineUnitPrice, setLineUnitPrice] = useState('')
  const [quickInput, setQuickInput] = useState('')
  const [boxNo, setBoxNo] = useState('')
  const [boxCount, setBoxCount] = useState('1')
  const [boxNumberRule, setBoxNumberRule] =
    useState<ManualMovementBoxInput['boxNumberRule']>('SHARED_NUMBER')
  const [boxLength, setBoxLength] = useState('1')
  const [boxWidth, setBoxWidth] = useState('1')
  const [boxHeight, setBoxHeight] = useState('1')
  const [boxWeight, setBoxWeight] = useState('0.001')
  const [boxQuantityPerBox, setBoxQuantityPerBox] = useState('1')
  const [outboundBoxCounts, setOutboundBoxCounts] = useState<
    Record<string, string>
  >({})
  const [referenceError, setReferenceError] =
    useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [confirmingPost, setConfirmingPost] = useState(false)
  const [importErrors, setImportErrors] = useState<
    ManualMovementImportError[]
  >([])
  const [submitting, setSubmitting] = useState(false)
  const skuRequest = useRef(0)
  const confirmPostRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (confirmingPost) confirmPostRef.current?.focus()
  }, [confirmingPost])

  useEffect(() => {
    if (!initial) return
    setWarehouseId(initial.summary.warehouseId)
    setDirection(initial.summary.direction)
    setReasonCode(initial.summary.reasonCode)
    setNote(initial.summary.note ?? '')
    setSourceReference(initial.summary.sourceReference ?? '')
    setContactName(initial.contactInformation.name ?? '')
    setContactPhone(initial.contactInformation.phone ?? '')
    setContactAddress(initial.contactInformation.address ?? '')
    setMovementTypeId(initial.summary.movementTypeId ?? '')
    setSource(initial.summary.source)
    setEntryMode(initial.summary.entryMode)
    const firstAttribute = Object.entries(
      initial.summary.extensionAttributes,
    )[0]
    setDocumentAttributeName(firstAttribute?.[0] ?? '')
    setDocumentAttributeValue(firstAttribute?.[1] ?? '')
    setLines(
      initial.lines.map((line) => ({
        skuId: line.skuId,
        locationId: line.locationId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        currency: line.currency,
        extensionAttributes: line.extensionAttributes,
        note: line.note,
        skuLabel: `${line.skuBusinessCode} · ${line.skuName}`,
        locationLabel:
          `${line.locationBusinessCode} · ${line.locationName}`,
      })),
    )
    setBoxes(
      initial.boxes.map((box) => ({
        sourceBoxStockId: box.sourceBoxStockId,
        customBoxNo: box.customBoxNo,
        boxCount: box.boxCount,
        boxNumberRule: box.boxNumberRule,
        lengthCm: box.lengthCm,
        widthCm: box.widthCm,
        heightCm: box.heightCm,
        grossWeightKg: box.grossWeightKg,
        items: box.items.map((item) => ({
          skuId: item.skuId,
          quantityPerBox: item.quantityPerBox,
        })),
      })),
    )
  }, [initial])

  useEffect(() => {
    if (!warehouseId) {
      setLocations([])
      setSelectedLocationId('')
      setLocationsLoading(false)
      setBoxStockLoading(false)
      return
    }
    let active = true
    setLocationsLoading(true)
    loadManualMovementLocations(warehouseId)
      .then((items) => {
        if (active) setLocations(items)
      })
      .catch((error) => {
        if (active) {
          setReferenceError(safeMessage(error, '读取库位选项'))
        }
      })
      .finally(() => {
        if (active) setLocationsLoading(false)
      })
    if (direction === 'OUTBOUND') {
      setBoxStockLoading(true)
      loadManualMovementBoxStock(warehouseId)
        .then((items) => {
          if (active) setBoxStock(items)
        })
        .catch((error) => {
          if (active) {
            setReferenceError(safeMessage(error, '读取可用箱清单'))
          }
        })
        .finally(() => {
          if (active) setBoxStockLoading(false)
        })
    } else {
      setBoxStock([])
      setBoxStockLoading(false)
    }
    return () => {
      active = false
    }
  }, [direction, warehouseId])

  useEffect(() => {
    const request = ++skuRequest.current
    setSelectedSkuId('')
    setSkuLoading(true)
    manualMovementApi
      .skuOptions(skuKeyword, 0, 100)
      .then((page) => {
        if (request === skuRequest.current) {
          setSkuOptions(page.items)
        }
      })
      .catch((error) => {
        if (request === skuRequest.current) {
          setReferenceError(safeMessage(error, '读取 SKU 选项'))
        }
      })
      .finally(() => {
        if (request === skuRequest.current) setSkuLoading(false)
      })
  }, [skuKeyword])

  useEffect(() => {
    if (
      !selectedSkuId ||
      !settings[direction]?.showCostPrice
    ) {
      return
    }
    const controller = new AbortController()
    manualMovementApi
      .priceSnapshot(selectedSkuId, direction, controller.signal)
      .then((snapshot) => {
        if (controller.signal.aborted) return
        if (snapshot.currency === 'CNY') {
          setLineUnitPrice(String(snapshot.unitPrice))
        } else {
          setReferenceError(
            `最近价格快照币种为 ${snapshot.currency}，未自动填入 CNY 单价。`,
          )
        }
      })
      .catch((error) => {
        if (
          !controller.signal.aborted &&
          (!(error instanceof ApiError) || error.status !== 404)
        ) {
          setReferenceError(safeMessage(error, '读取最近手工价格快照'))
        }
      })
    return () => controller.abort()
  }, [direction, selectedSkuId, settings])

  const availableReasons =
    direction === 'INBOUND' ? inboundReasons : outboundReasons

  useEffect(() => {
    if (!availableReasons.includes(reasonCode)) {
      setReasonCode(availableReasons[0])
    }
  }, [availableReasons, reasonCode])

  const addLine = () => {
    const parsedQuantity = Number(quantity)
    const parsedUnitPrice =
      lineUnitPrice.trim() === '' ? undefined : Number(lineUnitPrice)
    if (
      !selectedSkuId ||
      !selectedLocationId ||
      !Number.isSafeInteger(parsedQuantity) ||
      parsedQuantity < 1
    ) {
      setReferenceError('请选择 SKU、库位并填写正整数数量。')
      return
    }
    if (
      parsedUnitPrice !== undefined &&
      (!Number.isFinite(parsedUnitPrice) || parsedUnitPrice < 0)
    ) {
      setReferenceError('单价必须为非负数。')
      return
    }
    if (
      settings[direction]?.unitPriceRequired &&
      parsedUnitPrice === undefined
    ) {
      setReferenceError('当前出入库设置要求填写单价。')
      return
    }
    const sku = skuOptions.find((option) => option.id === selectedSkuId)
    const location = locations.find(
      (option) => option.id === selectedLocationId,
    )
    const existing = lines.find((line) => line.skuId === selectedSkuId)
    if (existing) {
      if (entryMode !== 'BOX') {
        setReferenceError('同一 SKU 只能在单据中出现一次。')
        return
      }
      if (
        existing.locationId !== selectedLocationId ||
        existing.unitPrice !== parsedUnitPrice
      ) {
        setReferenceError(
          '同一箱内 SKU 的库位和单价必须一致；请调整当前选择后重试。',
        )
        return
      }
      setLines((current) =>
        current.map((line) =>
          line.skuId === selectedSkuId
            ? { ...line, quantity: line.quantity + parsedQuantity }
            : line,
        ),
      )
    } else {
      setLines((current) => [
        ...current,
        {
          skuId: selectedSkuId,
          locationId: selectedLocationId,
          quantity: parsedQuantity,
          unitPrice: parsedUnitPrice,
          currency: parsedUnitPrice === undefined ? undefined : 'CNY',
          extensionAttributes: {},
          note: lineNote.trim() || undefined,
          skuLabel: sku
            ? `${sku.businessCode} · ${sku.name}`
            : selectedSkuId,
          locationLabel: location
            ? `${location.businessCode} · ${location.name}`
            : selectedLocationId,
        },
      ])
    }
    setSelectedSkuId('')
    setQuantity('1')
    setLineUnitPrice('')
    setLineNote('')
    setReferenceError(null)
  }

  const handleWarehouseChange = (
    event: ChangeEvent<HTMLSelectElement>,
  ) => {
    const next = event.target.value
    if (
      lines.length > 0 &&
      next !== warehouseId &&
      !window.confirm('更换仓库会清空当前明细，是否继续？')
    ) {
      return
    }
    setWarehouseId(next)
    if (next !== warehouseId) {
      setLines([])
      setBoxes([])
      setOutboundBoxCounts({})
    }
    setSelectedLocationId('')
  }

  const handleDirectionChange = (
    event: ChangeEvent<HTMLSelectElement>,
  ) => {
    const next = event.target.value as ManualMovementDirection
    if (
      next !== direction &&
      (lines.length > 0 || boxes.length > 0) &&
      !window.confirm('更换入出库方向会清空当前明细和箱清单，是否继续？')
    ) {
      return
    }
    setDirection(next)
    setMovementTypeId('')
    if (next !== direction) {
      setLines([])
      setBoxes([])
      setOutboundBoxCounts({})
    }
  }

  const appendImportedLines = (imported: ManualMovementLineInput[]) => {
    setLines(
      imported.map((line) => {
        const sku = skuOptions.find(
          (option) =>
            option.id === line.skuId ||
            option.businessCode.toLowerCase() === line.skuId.toLowerCase(),
        )
        const location = locations.find(
          (option) =>
            option.id === line.locationId ||
            option.businessCode.toLowerCase() ===
              line.locationId.toLowerCase(),
        )
        return {
          ...line,
          skuId: sku?.id ?? line.skuId,
          locationId: location?.id ?? line.locationId,
          skuLabel: sku
            ? `${sku.businessCode} · ${sku.name}`
            : line.skuId,
          locationLabel: location
            ? `${location.businessCode} · ${location.name}`
            : line.locationId,
        }
      }),
    )
    setSource('TEMPLATE_IMPORT')
  }

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      setImportErrors([
        {
          row: 0,
          field: '文件',
          message: '导入文件不能超过 5 MB。',
        },
      ])
      return
    }
    const result = parseManualMovementImportFile(file.name, await file.text())
    setImportErrors(result.errors)
    if (result.errors.length === 0) {
      appendImportedLines(result.lines)
    }
  }

  const downloadTemplate = () => {
    const blob = new Blob([manualMovementExcelTemplate], {
      type: 'application/vnd.ms-excel;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'manual-movement-lines-template.xls'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const applyQuickInput = () => {
    const rows = quickInput
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
    const errors: ManualMovementImportError[] = []
    const imported: ManualMovementLineInput[] = []
    const seen = new Set<string>()
    rows.forEach((row, index) => {
      const [skuCode, quantityText, locationCode, priceText] =
        row.split(/\t|\s{2,}/).map((value) => value.trim())
      const sku = skuOptions.find(
        (option) =>
          option.id === skuCode ||
          option.businessCode.toLowerCase() === skuCode?.toLowerCase(),
      )
      const location = locations.find(
        (option) =>
          option.id === locationCode ||
          option.businessCode.toLowerCase() ===
            locationCode?.toLowerCase(),
      )
      const parsedQuantity = Number(quantityText)
      const parsedPrice =
        priceText === undefined || priceText === ''
          ? undefined
          : Number(priceText)
      if (!sku || seen.has(sku.id)) {
        errors.push({
          row: index + 1,
          field: 'SKU',
          message: !sku
            ? '请先搜索并加载该 SKU 编号。'
            : '同一 SKU 只能出现一次。',
        })
      }
      if (!location) {
        errors.push({
          row: index + 1,
          field: '库位',
          message: '库位编号不属于当前仓库。',
        })
      }
      if (!Number.isSafeInteger(parsedQuantity) || parsedQuantity < 1) {
        errors.push({
          row: index + 1,
          field: '数量',
          message: '数量必须是正整数。',
        })
      }
      if (
        parsedPrice !== undefined &&
        (!Number.isFinite(parsedPrice) || parsedPrice < 0)
      ) {
        errors.push({
          row: index + 1,
          field: '单价',
          message: '单价必须是非负数。',
        })
      }
      if (sku && location && errors.every((error) => error.row !== index + 1)) {
        seen.add(sku.id)
        imported.push({
          skuId: sku.id,
          locationId: location.id,
          quantity: parsedQuantity,
          unitPrice: parsedPrice,
          currency: parsedPrice === undefined ? undefined : 'CNY',
        })
      }
    })
    setImportErrors(errors)
    if (errors.length === 0 && imported.length > 0) {
      appendImportedLines(imported)
      setQuickInput('')
    }
  }

  const addInboundBox = () => {
    const count = Number(boxCount)
    const quantityPerBox = Number(boxQuantityPerBox)
    const dimensions = [
      Number(boxLength),
      Number(boxWidth),
      Number(boxHeight),
      Number(boxWeight),
    ]
    if (
      !selectedSkuId ||
      !selectedLocationId ||
      !boxNo.trim() ||
      !Number.isSafeInteger(count) ||
      count < 1 ||
      !Number.isSafeInteger(quantityPerBox) ||
      quantityPerBox < 1 ||
      dimensions.some((value) => !Number.isFinite(value) || value <= 0)
    ) {
      setReferenceError(
        '请填写箱号、箱数、尺寸、毛重并选择箱内 SKU、库位和每箱数量。',
      )
      return
    }
    if (boxes.some((box) => box.customBoxNo === boxNo.trim())) {
      setReferenceError('箱号在当前单据中不能重复。')
      return
    }
    const addedQuantity = count * quantityPerBox
    const sku = skuOptions.find((option) => option.id === selectedSkuId)
    const location = locations.find(
      (option) => option.id === selectedLocationId,
    )
    setBoxes((current) => [
      ...current,
      {
        customBoxNo: boxNo.trim(),
        boxCount: count,
        boxNumberRule,
        lengthCm: dimensions[0],
        widthCm: dimensions[1],
        heightCm: dimensions[2],
        grossWeightKg: dimensions[3],
        items: [{ skuId: selectedSkuId, quantityPerBox }],
      },
    ])
    setLines((current) => {
      const existing = current.find((line) => line.skuId === selectedSkuId)
      if (existing) {
        return current.map((line) =>
          line.skuId === selectedSkuId
            ? { ...line, quantity: line.quantity + addedQuantity }
            : line,
        )
      }
      return [
        ...current,
        {
          skuId: selectedSkuId,
          locationId: selectedLocationId,
          quantity: addedQuantity,
          extensionAttributes: {},
          skuLabel: sku
            ? `${sku.businessCode} · ${sku.name}`
            : selectedSkuId,
          locationLabel: location
            ? `${location.businessCode} · ${location.name}`
            : selectedLocationId,
        },
      ]
    })
    setBoxNo('')
    setReferenceError(null)
  }

  const selectOutboundBox = (
    stock: ManualMovementBoxStock,
    requestedCount: string,
  ) => {
    if (!selectedLocationId) {
      setReferenceError('选择库存箱前请先选择本次出库库位。')
      return
    }
    const selectedCount = Number(requestedCount)
    if (
      !Number.isSafeInteger(selectedCount) ||
      selectedCount < 1 ||
      selectedCount > stock.availableCount
    ) {
      setReferenceError('本次出库箱数必须在可用箱数范围内。')
      return
    }
    if (boxes.some((box) => box.sourceBoxStockId === stock.id)) {
      setReferenceError('该库存箱已加入当前单据。')
      return
    }
    setBoxes((current) => [
      ...current,
      {
        sourceBoxStockId: stock.id,
        customBoxNo: stock.customBoxNo,
        boxCount: selectedCount,
        boxNumberRule: stock.boxNumberRule,
        lengthCm: stock.lengthCm,
        widthCm: stock.widthCm,
        heightCm: stock.heightCm,
        grossWeightKg: stock.grossWeightKg,
        items: stock.items.map((item) => ({
          skuId: item.skuId,
          quantityPerBox: item.quantityPerBox,
        })),
      },
    ])
    setLines((current) => {
      let next = current.map((line) => ({ ...line }))
      for (const item of stock.items) {
        const existing = next.find((line) => line.skuId === item.skuId)
        if (existing) {
          next = next.map((line) =>
            line.skuId === item.skuId
              ? {
                  ...line,
                  quantity:
                    line.quantity +
                    item.quantityPerBox * selectedCount,
                }
              : line,
          )
        } else {
          next.push({
            skuId: item.skuId,
            locationId: selectedLocationId,
            quantity: item.quantityPerBox * selectedCount,
            extensionAttributes: {},
            skuLabel: `${item.skuBusinessCode} · ${item.skuName}`,
            locationLabel:
              locations.find((item) => item.id === selectedLocationId)
                ?.name ?? selectedLocationId,
          })
        }
      }
      return next
    })
    setOutboundBoxCounts((current) => ({
      ...current,
      [stock.id]: '1',
    }))
    setReferenceError(null)
  }

  const removeBox = (box: ManualMovementBoxInput) => {
    setBoxes((current) => current.filter((item) => item !== box))
    setLines((current) => {
      let next = current
      for (const item of box.items) {
        const boxedQuantity = item.quantityPerBox * box.boxCount
        next = next.flatMap((line) => {
          if (line.skuId !== item.skuId) return [line]
          const remaining = line.quantity - boxedQuantity
          return remaining > 0 ? [{ ...line, quantity: remaining }] : []
        })
      }
      return next
    })
  }

  const removeLine = (line: EditorLine) => {
    const boxedQuantity = boxes.reduce(
      (total, box) =>
        total +
        box.items
          .filter((item) => item.skuId === line.skuId)
          .reduce(
            (subtotal, item) =>
              subtotal + item.quantityPerBox * box.boxCount,
            0,
          ),
      0,
    )
    if (boxedQuantity > 0) {
      setReferenceError('箱内 SKU 请先移除对应箱，再移除商品明细。')
      return
    }
    setLines((current) =>
      current.filter((item) => item.skuId !== line.skuId),
    )
  }

  const save = async (postAfterSave: boolean, confirmed = false) => {
    if (!warehouseId || lines.length === 0) {
      setSubmitError('请选择仓库并至少添加一条 SKU 明细。')
      return
    }
    if (
      settings[direction]?.contactInformationRequired &&
      (!contactName.trim() ||
        !contactPhone.trim() ||
        !contactAddress.trim())
    ) {
      setSubmitError(
        '当前出入库设置要求填写联系人、联系电话和联系地址。',
      )
      return
    }
    if (postAfterSave && !confirmed) {
      setSubmitError(null)
      setConfirmingPost(true)
      return
    }
    setConfirmingPost(false)
    setSubmitting(true)
    setSubmitError(null)
    try {
      const payload = {
        warehouseId,
        direction,
        movementTypeId: movementTypeId || undefined,
        reasonCode,
        source,
        entryMode,
        note: note.trim() || undefined,
        sourceReference: sourceReference.trim() || undefined,
        contactName: contactName.trim() || undefined,
        contactPhone: contactPhone.trim() || undefined,
        contactAddress: contactAddress.trim() || undefined,
        extensionAttributes:
          documentAttributeName.trim() && documentAttributeValue.trim()
            ? {
                [documentAttributeName.trim()]:
                  documentAttributeValue.trim(),
              }
            : undefined,
        lines: lines.map((line) => ({
          skuId: line.skuId,
          locationId: line.locationId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          currency: line.currency,
          extensionAttributes: line.extensionAttributes,
          note: line.note,
        })),
        boxes,
        expectedVersion:
          mode === 'edit' ? initial?.summary.version ?? 0 : 0,
        commandId: commandId(),
      }
      const saved =
        mode === 'edit' && initial
          ? await manualMovementApi.update(initial.summary.id, payload)
          : await manualMovementApi.create(payload)
      if (!postAfterSave) {
        onSaved(saved.movementId)
        return
      }
      try {
        const submitted = await manualMovementApi.submit(
          saved.movementId,
          saved.version,
          commandId(),
        )
        if (
          settings[direction]?.approvalRequired
        ) {
          onSaved(
            saved.movementId,
            '单据已提交审核；审核通过后方可过账。',
          )
          return
        }
        await manualMovementApi.post(
          saved.movementId,
          submitted.version,
          commandId(),
        )
        onSaved(saved.movementId)
      } catch (error) {
        onSaved(
          saved.movementId,
          `草稿已保存，但${safeMessage(error, '过账单据')}`,
        )
      }
    } catch (error) {
      setSubmitError(safeMessage(error, '保存手工出入库单'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      title={mode === 'create' ? '新增手工出入库单' : '编辑手工出入库草稿'}
      titleId="manual-editor-title"
      restoreRef={restoreRef}
      onClose={onClose}
      wide
    >
      <div className="manual-modal-body">
        {loadingInitial && (
          <div className="manual-state">正在加载草稿…</div>
        )}
        {mode === 'edit' && !loadingInitial && !initial && (
          <div className="manual-state manual-state-error" role="alert">
            无法读取可编辑草稿。
          </div>
        )}
        {(mode === 'create' || initial) && (
          <>
            <div className="manual-editor-grid">
              <label>
                方向
                <select
                  value={direction}
                  disabled={submitting}
                  onChange={handleDirectionChange}
                >
                  <option value="INBOUND">手工入库</option>
                  <option value="OUTBOUND">手工出库</option>
                </select>
              </label>
              <label>
                仓库
                <select
                  required
                  value={warehouseId}
                  disabled={submitting}
                  onChange={handleWarehouseChange}
                >
                  <option value="">请选择启用仓库</option>
                  {warehouses.map((warehouse) => (
                    <option value={warehouse.id} key={warehouse.id}>
                      {warehouse.businessCode} · {warehouse.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                出入库原因
                <select
                  value={reasonCode}
                  disabled={submitting}
                  onChange={(event) =>
                    setReasonCode(
                      event.target.value as ManualMovementReason,
                    )
                  }
                >
                  {availableReasons.map((reason) => (
                    <option value={reason} key={reason}>
                      {reasonLabel(reason)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                业务类型
                <select
                  value={movementTypeId}
                  disabled={submitting}
                  onChange={(event) => setMovementTypeId(event.target.value)}
                >
                  <option value="">未分类</option>
                  {movementTypes
                    .filter(
                      (type) =>
                        type.direction === direction &&
                        type.status === 'ACTIVE',
                    )
                    .map((type) => (
                      <option value={type.id} key={type.id}>
                        {type.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                来源
                <select
                  value={source}
                  disabled={submitting}
                  onChange={(event) =>
                    setSource(event.target.value as ManualMovementSource)
                  }
                >
                  <option value="MANUAL">手工新增</option>
                  <option value="TEMPLATE_IMPORT">模板导入</option>
                  <option value="INVENTORY_SKU">库存 SKU</option>
                </select>
              </label>
              <label>
                录入方式
                <select
                  value={entryMode}
                  disabled={submitting}
                  onChange={(event) =>
                    setEntryMode(
                      event.target.value as ManualMovementEntryMode,
                    )
                  }
                >
                  <option value="PRODUCT">按商品散件</option>
                  <option value="BOX">按箱</option>
                </select>
              </label>
              <label>
                来源单号
                <input
                  value={sourceReference}
                  maxLength={100}
                  disabled={submitting}
                  onChange={(event) =>
                    setSourceReference(event.target.value)
                  }
                />
              </label>
              <label>
                {direction === 'INBOUND' ? '发件人' : '收件人'}
                {settings[direction]?.contactInformationRequired
                  ? '（必填）'
                  : ''}
                <input
                  value={contactName}
                  maxLength={80}
                  required={
                    settings[direction]?.contactInformationRequired
                  }
                  disabled={submitting}
                  onChange={(event) => setContactName(event.target.value)}
                />
              </label>
              <label>
                联系电话
                {settings[direction]?.contactInformationRequired
                  ? '（必填）'
                  : ''}
                <input
                  value={contactPhone}
                  maxLength={40}
                  required={
                    settings[direction]?.contactInformationRequired
                  }
                  disabled={submitting}
                  onChange={(event) => setContactPhone(event.target.value)}
                />
              </label>
              <label className="manual-editor-note">
                联系地址
                {settings[direction]?.contactInformationRequired
                  ? '（必填）'
                  : ''}
                <textarea
                  value={contactAddress}
                  maxLength={300}
                  rows={2}
                  required={
                    settings[direction]?.contactInformationRequired
                  }
                  disabled={submitting}
                  onChange={(event) =>
                    setContactAddress(event.target.value)
                  }
                />
              </label>
              <label className="manual-editor-note">
                备注
                <textarea
                  value={note}
                  maxLength={500}
                  rows={2}
                  disabled={submitting}
                  onChange={(event) => setNote(event.target.value)}
                />
              </label>
              <label>
                扩展属性名称
                <input
                  value={documentAttributeName}
                  maxLength={50}
                  disabled={submitting}
                  onChange={(event) =>
                    setDocumentAttributeName(event.target.value)
                  }
                />
              </label>
              <label>
                扩展属性值
                <input
                  value={documentAttributeValue}
                  maxLength={200}
                  disabled={submitting}
                  onChange={(event) =>
                    setDocumentAttributeValue(event.target.value)
                  }
                />
              </label>
            </div>

            <div className="manual-import-panel">
              <div>
                <strong>Excel 模板导入明细</strong>
                <p>
                  支持 SKU、库位、计划数量、单价、币种、扩展属性和备注。
                  系统先校验并显示错误；保存草稿与过账分离。
                </p>
              </div>
              <button
                className="text-button"
                type="button"
                onClick={downloadTemplate}
              >
                <FileDown size={16} aria-hidden="true" />
                下载模板
              </button>
              <label className="secondary-button manual-file-label">
                <FileUp size={16} aria-hidden="true" />
                上传 Excel / CSV
                <input
                  type="file"
                  accept=".xls,.xml,.csv,text/csv,application/vnd.ms-excel"
                  disabled={submitting}
                  onChange={(event) => void handleImport(event)}
                />
              </label>
            </div>
            <div className="manual-quick-input">
              <label>
                快速输入（复制粘贴）
                <textarea
                  value={quickInput}
                  rows={4}
                  placeholder={
                    '每行：SKU编号  数量  库位编号  单价（可选）'
                  }
                  onChange={(event) => setQuickInput(event.target.value)}
                />
              </label>
              <button
                className="secondary-button"
                type="button"
                disabled={submitting || !quickInput.trim()}
                onClick={applyQuickInput}
              >
                <ClipboardPaste size={16} aria-hidden="true" />
                校验并写入明细
              </button>
            </div>
            {importErrors.length > 0 && (
              <div className="manual-import-errors" role="alert">
                <strong>导入校验未通过</strong>
                <ul>
                  {importErrors.slice(0, 20).map((error, index) => (
                    <li key={`${error.row}-${error.field}-${index}`}>
                      {error.row > 0 ? `第 ${error.row} 行` : '文件'} ·{' '}
                      {error.field}：{error.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <fieldset
              className="manual-line-builder"
              disabled={submitting || !warehouseId}
            >
              <legend>添加商品明细</legend>
              <label>
                搜索 SKU
                <input
                  value={skuKeyword}
                  maxLength={100}
                  onChange={(event) => setSkuKeyword(event.target.value)}
                />
              </label>
              <label>
                商品 SKU
                <select
                  value={selectedSkuId}
                  disabled={skuLoading}
                  onChange={(event) =>
                    setSelectedSkuId(event.target.value)
                  }
                >
                  <option value="">
                    {skuLoading ? '正在加载 SKU…' : '请选择启用 SKU'}
                  </option>
                  {skuOptions.map((sku) => (
                    <option value={sku.id} key={sku.id}>
                      {sku.businessCode} · {sku.name}
                      {sku.variantSummary
                        ? ` · ${sku.variantSummary}`
                        : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                库位
                <select
                  value={selectedLocationId}
                  disabled={locationsLoading}
                  onChange={(event) =>
                    setSelectedLocationId(event.target.value)
                  }
                >
                  <option value="">
                    {locationsLoading
                      ? '正在加载库位…'
                      : '请选择启用库位'}
                  </option>
                  {locations.map((location) => (
                    <option value={location.id} key={location.id}>
                      {location.businessCode} · {location.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                数量
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                />
              </label>
              <label>
                单价（CNY）
                <input
                  type="number"
                  min={0}
                  step="0.0001"
                  value={lineUnitPrice}
                  required={settings[direction]?.unitPriceRequired}
                  onChange={(event) => setLineUnitPrice(event.target.value)}
                />
              </label>
              <label>
                行备注
                <input
                  value={lineNote}
                  maxLength={300}
                  onChange={(event) => setLineNote(event.target.value)}
                />
              </label>
              <button
                className="secondary-button"
                type="button"
                onClick={addLine}
              >
                添加明细
              </button>
            </fieldset>
            {entryMode === 'BOX' && direction === 'INBOUND' && (
              <fieldset className="manual-box-builder" disabled={submitting}>
                <legend>按箱入库</legend>
                <p>
                  箱内 SKU 使用上方当前选择；箱数量自动计入商品计划量。
                </p>
                <label>
                  自定义箱号
                  <input
                    value={boxNo}
                    maxLength={80}
                    onChange={(event) => setBoxNo(event.target.value)}
                  />
                </label>
                <label>
                  箱数
                  <input
                    type="number"
                    min={1}
                    max={10000}
                    value={boxCount}
                    onChange={(event) => setBoxCount(event.target.value)}
                  />
                </label>
                <label>
                  箱号规则
                  <select
                    value={boxNumberRule}
                    onChange={(event) =>
                      setBoxNumberRule(
                        event.target
                          .value as ManualMovementBoxInput['boxNumberRule'],
                      )
                    }
                  >
                    <option value="SHARED_NUMBER">多箱同号</option>
                    <option value="UNIQUE_NUMBER">一箱一号</option>
                  </select>
                </label>
                <label>
                  每箱 SKU 数量
                  <input
                    type="number"
                    min={1}
                    value={boxQuantityPerBox}
                    onChange={(event) =>
                      setBoxQuantityPerBox(event.target.value)
                    }
                  />
                </label>
                <label>
                  长（cm）
                  <input
                    type="number"
                    min="0.001"
                    step="0.001"
                    value={boxLength}
                    onChange={(event) => setBoxLength(event.target.value)}
                  />
                </label>
                <label>
                  宽（cm）
                  <input
                    type="number"
                    min="0.001"
                    step="0.001"
                    value={boxWidth}
                    onChange={(event) => setBoxWidth(event.target.value)}
                  />
                </label>
                <label>
                  高（cm）
                  <input
                    type="number"
                    min="0.001"
                    step="0.001"
                    value={boxHeight}
                    onChange={(event) => setBoxHeight(event.target.value)}
                  />
                </label>
                <label>
                  单箱毛重（kg）
                  <input
                    type="number"
                    min="0.001"
                    step="0.001"
                    value={boxWeight}
                    onChange={(event) => setBoxWeight(event.target.value)}
                  />
                </label>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={addInboundBox}
                >
                  <Boxes size={16} aria-hidden="true" />
                  加入箱清单
                </button>
              </fieldset>
            )}
            {entryMode === 'BOX' && direction === 'OUTBOUND' && (
              <section className="manual-box-stock">
                <h3>选择库存箱</h3>
                <p>
                  选择已过账入库且仍可用的箱；也可继续添加散件组合。
                </p>
                {boxStockLoading ? (
                  <div className="manual-state">正在加载可用库存箱…</div>
                ) : boxStock.length === 0 ? (
                  <div className="manual-state">
                    当前仓库没有可用库存箱。
                  </div>
                ) : (
                  <div className="manual-table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>系统箱号 / 自定义箱号</th>
                          <th>可用箱数</th>
                          <th>尺寸 / 毛重</th>
                          <th>箱内 SKU</th>
                          <th>本次出库箱数</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {boxStock.map((stock) => (
                          <tr key={stock.id}>
                            <td>
                              BX-{stock.id.slice(0, 8)}
                              <br />
                              {stock.customBoxNo}
                            </td>
                            <td>{stock.availableCount}</td>
                            <td>
                              {stock.lengthCm} × {stock.widthCm} ×{' '}
                              {stock.heightCm} / {stock.grossWeightKg} kg
                            </td>
                            <td>
                              {stock.items
                                .map(
                                  (item) =>
                                    `${item.skuBusinessCode} × ` +
                                    `${item.quantityPerBox}`,
                                )
                                .join('；')}
                            </td>
                            <td>
                              <label className="visually-hidden" htmlFor={`box-count-${stock.id}`}>
                                {stock.customBoxNo} 本次出库箱数
                              </label>
                              <input
                                id={`box-count-${stock.id}`}
                                type="number"
                                min={1}
                                max={stock.availableCount}
                                value={outboundBoxCounts[stock.id] ?? '1'}
                                onChange={(event) =>
                                  setOutboundBoxCounts((current) => ({
                                    ...current,
                                    [stock.id]: event.target.value,
                                  }))
                                }
                              />
                            </td>
                            <td>
                              <button
                                className="text-button"
                                type="button"
                                onClick={() =>
                                  selectOutboundBox(
                                    stock,
                                    outboundBoxCounts[stock.id] ?? '1',
                                  )
                                }
                              >
                                选择箱子
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}
            {boxes.length > 0 && (
              <section className="manual-selected-boxes">
                <h3>本单箱清单</h3>
                <div className="manual-table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>箱号</th>
                        <th>箱数</th>
                        <th>箱号规则</th>
                        <th>尺寸 / 毛重</th>
                        <th>箱内 SKU</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {boxes.map((box) => (
                        <tr
                          key={box.sourceBoxStockId ?? box.customBoxNo}
                        >
                          <td>{box.customBoxNo}</td>
                          <td>{box.boxCount}</td>
                          <td>
                            {box.boxNumberRule === 'UNIQUE_NUMBER'
                              ? '逐箱编号'
                              : '共享箱号'}
                          </td>
                          <td>
                            {box.lengthCm} × {box.widthCm} × {box.heightCm}
                            {' / '}
                            {box.grossWeightKg} kg
                          </td>
                          <td>
                            {box.items
                              .map(
                                (item) =>
                                  `${item.skuId} × ${item.quantityPerBox}`,
                              )
                              .join('；')}
                          </td>
                          <td>
                            <button
                              className="text-button"
                              type="button"
                              onClick={() => removeBox(box)}
                            >
                              移除
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
            {referenceError && (
              <div className="manual-alert" role="alert">
                {referenceError}
              </div>
            )}

            <div className="manual-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>商品 SKU</th>
                    <th>库位与业务编码</th>
                    <th>数量</th>
                    <th>单价 / 金额</th>
                    <th>扩展属性</th>
                    <th>行备注</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.length === 0 && (
                    <tr>
                      <td colSpan={7}>尚未添加商品明细。</td>
                    </tr>
                  )}
                  {lines.map((line) => (
                    <tr key={line.skuId}>
                      <td>{line.skuLabel ?? line.skuId}</td>
                      <td>
                        {line.locationLabel ?? line.locationId}
                      </td>
                      <td>{line.quantity}</td>
                      <td>
                        {line.unitPrice === undefined
                          ? '—'
                          : `${formatMoney(
                              line.unitPrice,
                              line.currency,
                            )} / ${formatMoney(
                              line.unitPrice * line.quantity,
                              line.currency,
                            )}`}
                      </td>
                      <td>
                        {Object.entries(
                          line.extensionAttributes ?? {},
                        )
                          .map(([key, value]) => `${key}: ${value}`)
                          .join('；') || '—'}
                      </td>
                      <td>{line.note ?? '—'}</td>
                      <td>
                        <button
                          className="text-button"
                          type="button"
                          disabled={submitting}
                          onClick={() => removeLine(line)}
                        >
                          移除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="manual-editor-summary">
              明细行 {lines.length} 条 · 总数量{' '}
              {lines.reduce((total, line) => total + line.quantity, 0)}
              {' · '}箱数{' '}
              {boxes.reduce((total, box) => total + box.boxCount, 0)}
              {' · '}总装箱重量{' '}
              {boxes
                .reduce(
                  (total, box) =>
                    total + box.grossWeightKg * box.boxCount,
                  0,
                )
                .toFixed(3)}{' '}
              kg
              {' · '}总装箱体积{' '}
              {boxes
                .reduce(
                  (total, box) =>
                    total +
                    box.lengthCm *
                      box.widthCm *
                      box.heightCm *
                      box.boxCount,
                  0,
                )
                .toFixed(3)}{' '}
              cm³
              {' · '}金额{' '}
              {formatMoney(
                lines.reduce(
                  (total, line) =>
                    total + (line.unitPrice ?? 0) * line.quantity,
                  0,
                ),
                lines.some((line) => line.unitPrice !== undefined)
                  ? 'CNY'
                  : undefined,
              )}
            </div>
            {submitError && (
              <div className="manual-alert" role="alert">
                {submitError}
              </div>
            )}
          </>
        )}
      </div>
      <footer className="manual-modal-footer">
        {confirmingPost ? (
          <div
            className="manual-post-confirmation"
            role="alertdialog"
            aria-labelledby="manual-post-confirmation-title"
            aria-describedby="manual-post-confirmation-description"
          >
            <div>
              <strong id="manual-post-confirmation-title">
                {settings[direction]?.approvalRequired
                  ? '确认提交审核'
                  : '确认保存并过账'}
              </strong>
              <span id="manual-post-confirmation-description">
                {settings[direction]?.approvalRequired
                  ? '审核通过后才会更新仓库库存。'
                  : '过账会立即按当前明细更新仓库级库存余额。'}
              </span>
            </div>
            <div className="manual-post-confirmation-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={submitting}
                onClick={() => setConfirmingPost(false)}
              >
                返回编辑
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={submitting}
                ref={confirmPostRef}
                onClick={() => void save(true, true)}
              >
                {submitting
                  ? '正在提交…'
                  : settings[direction]?.approvalRequired
                    ? '确认保存并提交审核'
                    : '确认保存并过账'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <button
              className="secondary-button"
              type="button"
              disabled={submitting}
              onClick={onClose}
            >
              取消
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={submitting || loadingInitial}
              onClick={() => void save(false)}
            >
              {submitting ? '正在保存…' : '保存草稿'}
            </button>
            {canPost && (
              <button
                className="primary-button"
                type="button"
                disabled={submitting || loadingInitial}
                onClick={() => void save(true)}
              >
                {submitting
                  ? '正在提交…'
                  : settings[direction]?.approvalRequired
                    ? '保存并提交审核'
                    : '保存并过账'}
              </button>
            )}
          </>
        )}
      </footer>
    </Dialog>
  )
}
