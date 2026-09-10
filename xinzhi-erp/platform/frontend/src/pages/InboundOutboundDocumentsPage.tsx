import {
  type FormEvent,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useRouter, useRouterState } from '@tanstack/react-router'
import { ExternalLink, RefreshCw } from 'lucide-react'
import { ApiError } from '../api/client'
import { DialogCloseButton } from '../components/DialogCloseButton'
import {
  manualMovementApi,
  type ManualMovementDetail,
  type ManualMovementSource,
  type ManualMovementSummary,
  type ManualMovementWarehouseOption,
} from '../modules/manualMovementApi'
import {
  warehouseDocumentApi,
  type WarehouseDocument,
  type WarehouseDocumentApprovalStatus,
  type WarehouseDocumentDirection,
  type WarehouseDocumentSearchField,
  type WarehouseDocumentSource,
  type WarehouseDocumentStatus,
} from '../modules/warehouseDocumentApi'
import { toProcurementOrderDetailUrl } from '../modules/procurementOrderRoutes'
import './InboundOutboundDocumentsPage.css'

const PAGE_SIZES = [25, 50, 100] as const
const REFERENCE_PAGE_SIZE = 200
const MAX_REFERENCE_PAGES = 50
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const statuses: WarehouseDocumentStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'POSTED',
  'PARTIALLY_REVERSED',
  'REVERSED',
  'CANCELLED',
]
const approvalStatuses: WarehouseDocumentApprovalStatus[] = [
  'NOT_REQUIRED',
  'PENDING',
  'APPROVED',
  'REJECTED',
]
const sources: WarehouseDocumentSource[] = [
  'MANUAL_MOVEMENT',
  'PROCUREMENT_RECEIPT',
  'WAREHOUSE_TRANSFER',
  'ORDER_FULFILLMENT',
  'INVENTORY_COUNT',
]
const searchFields: WarehouseDocumentSearchField[] = [
  'DOCUMENT_NO',
  'SKU',
  'LOCATION',
  'NOTE',
  'OPERATOR',
]

export type InboundOutboundDocumentsQuery = {
  direction: WarehouseDocumentDirection
  warehouseId?: string
  status?: WarehouseDocumentStatus
  approvalStatus?: WarehouseDocumentApprovalStatus
  source?: WarehouseDocumentSource
  searchField: WarehouseDocumentSearchField
  keyword: string
  start?: string
  end?: string
  page: number
  size: number
}

function boundedText(value: string | null, maximum = 100) {
  return (value ?? '').trim().slice(0, maximum)
}

function boundedDate(value: string | null) {
  const text = boundedText(value, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : undefined
}

function enumValue<T extends string>(
  value: string | null,
  allowed: readonly T[],
  fallback?: T,
) {
  const normalized = boundedText(value, 40).toUpperCase() as T
  return allowed.includes(normalized) ? normalized : fallback
}

function nonNegativeInteger(value: string | null) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0
}

export function parseInboundOutboundDocumentsQuery(
  search: string,
): InboundOutboundDocumentsQuery {
  const params = new URLSearchParams(search)
  const start = boundedDate(params.get('start'))
  const candidateEnd = boundedDate(params.get('end'))
  const requestedSize = Number(params.get('size'))
  return {
    direction: enumValue(
      params.get('direction'),
      ['INBOUND', 'OUTBOUND'] as const,
      'INBOUND',
    )!,
    warehouseId: UUID_PATTERN.test(params.get('warehouseId') ?? '')
      ? params.get('warehouseId')!
      : undefined,
    status: enumValue(params.get('status'), statuses),
    approvalStatus: enumValue(
      params.get('approvalStatus'),
      approvalStatuses,
    ),
    source: enumValue(params.get('source'), sources),
    searchField: enumValue(
      params.get('searchField'),
      searchFields,
      'DOCUMENT_NO',
    )!,
    keyword: boundedText(params.get('keyword')),
    start,
    end:
      candidateEnd && (!start || candidateEnd >= start)
        ? candidateEnd
        : undefined,
    page: nonNegativeInteger(params.get('page')),
    size: PAGE_SIZES.includes(requestedSize as (typeof PAGE_SIZES)[number])
      ? requestedSize
      : 25,
  }
}

export function toInboundOutboundDocumentsUrl(
  query: Partial<InboundOutboundDocumentsQuery>,
) {
  const params = new URLSearchParams()
  if (query.direction === 'OUTBOUND') params.set('direction', 'OUTBOUND')
  if (query.warehouseId) params.set('warehouseId', query.warehouseId)
  if (query.status) params.set('status', query.status)
  if (query.approvalStatus) {
    params.set('approvalStatus', query.approvalStatus)
  }
  if (query.source) params.set('source', query.source)
  if (query.searchField && query.searchField !== 'DOCUMENT_NO') {
    params.set('searchField', query.searchField)
  }
  if (query.keyword) params.set('keyword', query.keyword)
  if (query.start) params.set('start', query.start)
  if (query.end) params.set('end', query.end)
  if (query.page && query.page > 0) params.set('page', String(query.page))
  if (query.size && query.size !== 25) params.set('size', String(query.size))
  const serialized = params.toString()
  return serialized
    ? `/warehouses/documents?${serialized}`
    : '/warehouses/documents'
}

function directionLabel(value: WarehouseDocumentDirection) {
  return value === 'INBOUND' ? '入库单' : '出库单'
}

function statusLabel(value: WarehouseDocumentStatus) {
  const labels: Record<WarehouseDocumentStatus, string> = {
    DRAFT: '草稿',
    SUBMITTED: '已提交',
    POSTED: '已过账',
    PARTIALLY_REVERSED: '部分冲销',
    REVERSED: '已冲销',
    CANCELLED: '已取消',
  }
  return labels[value]
}

function approvalStatusLabel(value: WarehouseDocumentApprovalStatus) {
  const labels: Record<WarehouseDocumentApprovalStatus, string> = {
    NOT_REQUIRED: '无需审核',
    PENDING: '待审核',
    APPROVED: '已通过',
    REJECTED: '已驳回',
  }
  return labels[value]
}

function sourceLabel(value: WarehouseDocumentSource) {
  const labels: Record<WarehouseDocumentSource, string> = {
    MANUAL_MOVEMENT: '手工出入库',
    PROCUREMENT_RECEIPT: '采购签收',
    WAREHOUSE_TRANSFER: '分仓调拨',
    ORDER_FULFILLMENT: '订单履约出库',
    INVENTORY_COUNT: '库存盘点',
  }
  return labels[value]
}

function manualSourceLabel(value: ManualMovementSource) {
  const labels: Record<ManualMovementSource, string> = {
    MANUAL: '手工创建',
    TEMPLATE_IMPORT: '模板导入',
    OPEN_API: '外部系统',
    TMS: 'TMS',
    WMS: 'WMS',
    INVENTORY_SKU: '库存 SKU',
  }
  return labels[value]
}

function searchFieldLabel(value: WarehouseDocumentSearchField) {
  const labels: Record<WarehouseDocumentSearchField, string> = {
    DOCUMENT_NO: '单号 / 来源单号',
    SKU: 'SKU 编号 / 名称',
    LOCATION: '库位编号 / 名称',
    NOTE: '备注',
    OPERATOR: '创建 / 操作 / 审核人员',
  }
  return labels[value]
}

function reasonLabel(value: ManualMovementSummary['reasonCode']) {
  const labels: Record<ManualMovementSummary['reasonCode'], string> = {
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

function formatNumber(value: number) {
  return new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: 4,
  }).format(value)
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
    return `${formatNumber(amount)} ${currency}`
  }
}

function readError(error: unknown, action: string) {
  if (error instanceof ApiError) {
    if (error.status === 403) return `当前账号没有${action}权限。`
    if (error.status === 404) return '单据不存在，或当前账号无权访问。'
    if (error.status === 400) return '筛选条件未通过校验，请重置后重试。'
  }
  return `暂时无法${action}，请稍后重试。`
}

function readExportError(error: unknown) {
  if (error instanceof ApiError && error.status === 409) {
    return '导出结果超过 10,000 条，请缩小筛选范围后重试。'
  }
  return readError(error, '导出入出库单')
}

function isoStart(value?: string) {
  return value ? `${value}T00:00:00.000Z` : undefined
}

function isoEnd(value?: string) {
  return value ? `${value}T23:59:59.999Z` : undefined
}

async function loadWarehouseOptions() {
  const first = await manualMovementApi.warehouseOptions(
    '',
    0,
    REFERENCE_PAGE_SIZE,
  )
  if (first.totalPages > MAX_REFERENCE_PAGES) {
    throw new Error('warehouse_reference_limit')
  }
  const items = [...first.items]
  for (let page = 1; page < first.totalPages; page += 1) {
    const next = await manualMovementApi.warehouseOptions(
      '',
      page,
      REFERENCE_PAGE_SIZE,
    )
    items.push(...next.items)
  }
  if (
    items.length !== first.totalElements ||
    new Set(items.map((item) => item.id)).size !== items.length
  ) {
    throw new Error('warehouse_reference_inconsistent')
  }
  return items
}

function DetailDialog({
  movementId,
  restoreRef,
  onClose,
}: {
  movementId: string
  restoreRef: RefObject<HTMLElement | null>
  onClose: () => void
}) {
  const [detail, setDetail] = useState<ManualMovementDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const dialogRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    setDetail(null)
    setError(null)
    manualMovementApi.get(movementId, controller.signal).then(
      setDetail,
      (caught) => {
        if (!controller.signal.aborted) {
          setError(readError(caught, '读取单据详情'))
        }
      },
    )
    return () => controller.abort()
  }, [movementId, retry])

  useEffect(() => {
    closeRef.current?.focus()
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), ' +
            'select:not([disabled]), [tabindex]:not([tabindex="-1"])',
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
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('keydown', handleKey)
      window.requestAnimationFrame(() => restoreRef.current?.focus())
    }
  }, [onClose, restoreRef])

  return (
    <div className="inbound-documents-dialog-backdrop">
      <section
        className="inbound-documents-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="inbound-documents-detail-title"
        ref={dialogRef}
        tabIndex={-1}
      >
        <header className="inbound-documents-dialog-header">
          <div>
            <p>单据详情</p>
            <h2 id="inbound-documents-detail-title">
              {detail?.summary.movementNo ?? '正在读取'}
            </h2>
          </div>
          <DialogCloseButton
            label="关闭单据详情"
            ref={closeRef}
            onClick={onClose}
          />
        </header>
        <div className="inbound-documents-dialog-body">
          {error ? (
            <div className="inbound-documents-state is-error" role="alert">
              <strong>{error}</strong>
              <button type="button" onClick={() => setRetry((value) => value + 1)}>
                <RefreshCw size={15} aria-hidden="true" />
                重试
              </button>
            </div>
          ) : !detail ? (
            <div className="inbound-documents-state" role="status">
              正在读取单据详情…
            </div>
          ) : (
            <>
              <dl className="inbound-documents-summary-grid">
                <div><dt>业务方向</dt><dd>{directionLabel(detail.summary.direction)}</dd></div>
                <div><dt>单据状态</dt><dd>{statusLabel(detail.summary.status)}</dd></div>
                <div><dt>仓库</dt><dd>{detail.summary.warehouseName}（{detail.summary.warehouseBusinessCode}）</dd></div>
                <div><dt>单据类型</dt><dd>{detail.summary.movementTypeName ?? reasonLabel(detail.summary.reasonCode)}</dd></div>
                <div><dt>审批状态</dt><dd>{approvalStatusLabel(detail.summary.approvalStatus)}</dd></div>
                <div><dt>来源</dt><dd>{manualSourceLabel(detail.summary.source)}</dd></div>
                <div><dt>创建人</dt><dd>{detail.summary.createdBy}</dd></div>
                <div><dt>创建时间</dt><dd>{formatTime(detail.summary.createdAt)}</dd></div>
                <div><dt>来源单号</dt><dd>{detail.summary.sourceReference ?? '—'}</dd></div>
                <div><dt>备注</dt><dd>{detail.summary.note ?? '—'}</dd></div>
              </dl>
              <div className="inbound-documents-detail-table-wrap">
                <table aria-label="单据商品明细">
                  <thead>
                    <tr>
                      <th>行号</th>
                      <th>SKU</th>
                      <th>商品名称</th>
                      <th>库位</th>
                      <th>单据数量</th>
                      <th>实际数量</th>
                      <th>金额</th>
                      <th>备注</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.lines.map((line) => (
                      <tr key={line.id}>
                        <td>{line.lineNumber}</td>
                        <td>{line.skuBusinessCode}</td>
                        <td>{line.skuName}</td>
                        <td>{line.locationName}（{line.locationBusinessCode}）</td>
                        <td className="is-numeric">{formatNumber(line.quantity)}</td>
                        <td className="is-numeric">{line.actualQuantity === undefined ? '—' : formatNumber(line.actualQuantity)}</td>
                        <td className="is-numeric">{line.amount === undefined ? '—' : formatMoney(line.amount, line.currency)}</td>
                        <td>{line.note ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  )
}

export function InboundOutboundDocumentsPage() {
  const router = useRouter()
  const search = useRouterState({
    select: (state) => state.location.searchStr,
  })
  const query = useMemo(
    () => parseInboundOutboundDocumentsQuery(search),
    [search],
  )
  const [items, setItems] = useState<WarehouseDocument[]>([])
  const [totalElements, setTotalElements] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [warehouses, setWarehouses] = useState<ManualMovementWarehouseOption[]>([])
  const [warehouseError, setWarehouseError] = useState(false)
  const [warehouseRetry, setWarehouseRetry] = useState(0)
  const [dateError, setDateError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportFeedback, setExportFeedback] = useState<{
    kind: 'success' | 'error'
    message: string
    queryKey: string
  } | null>(null)
  const detailTriggerRef = useRef<HTMLElement | null>(null)

  const navigate = useCallback(
    (next: Partial<InboundOutboundDocumentsQuery>) => {
      router.history.push(toInboundOutboundDocumentsUrl(next))
    },
    [router],
  )

  useEffect(() => {
    let active = true
    setWarehouseError(false)
    loadWarehouseOptions().then(
      (next) => {
        if (active) setWarehouses(next)
      },
      () => {
        if (active) setWarehouseError(true)
      },
    )
    return () => {
      active = false
    }
  }, [warehouseRetry])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    warehouseDocumentApi.list({
      warehouseId: query.warehouseId,
      direction: query.direction,
      status: query.status,
      approvalStatus: query.approvalStatus,
      source: query.source,
      searchField: query.searchField,
      keyword: query.keyword || undefined,
      occurredFrom: isoStart(query.start),
      occurredTo: isoEnd(query.end),
      page: query.page,
      size: query.size,
      signal: controller.signal,
    }).then(
      (page) => {
        if (controller.signal.aborted) return
        setItems(page.items)
        setTotalElements(page.totalElements)
        setTotalPages(page.totalPages)
        setLoading(false)
      },
      (caught) => {
        if (controller.signal.aborted) return
        setItems([])
        setTotalElements(0)
        setTotalPages(0)
        setError(readError(caught, '读取入出库单'))
        setLoading(false)
      },
    )
    return () => controller.abort()
  }, [query, retry])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const start = boundedDate(String(data.get('start') ?? ''))
    const end = boundedDate(String(data.get('end') ?? ''))
    if (start && end && end < start) {
      setDateError('结束日期不能早于开始日期。')
      return
    }
    setDateError(null)
    navigate({
      direction: query.direction,
      warehouseId:
        boundedText(String(data.get('warehouseId') ?? ''), 36) || undefined,
      status: enumValue(
        String(data.get('status') ?? ''),
        statuses,
      ),
      approvalStatus: enumValue(
        String(data.get('approvalStatus') ?? ''),
        approvalStatuses,
      ),
      source: enumValue(String(data.get('source') ?? ''), sources),
      searchField: enumValue(
        String(data.get('searchField') ?? ''),
        searchFields,
        'DOCUMENT_NO',
      ),
      keyword: boundedText(String(data.get('keyword') ?? '')),
      start,
      end,
      page: 0,
      size: query.size,
    })
  }

  const openDetail = (id: string, trigger: HTMLElement) => {
    detailTriggerRef.current = trigger
    setSelectedId(id)
  }

  const openSource = (item: WarehouseDocument, trigger: HTMLElement) => {
    if (item.source === 'MANUAL_MOVEMENT') {
      openDetail(item.relatedDocumentId, trigger)
      return
    }
    if (item.source === 'PROCUREMENT_RECEIPT') {
      router.history.push(toProcurementOrderDetailUrl(item.relatedDocumentId))
      return
    }
    if (item.source === 'ORDER_FULFILLMENT') {
      router.history.push(
        `/orders/${encodeURIComponent(item.relatedDocumentId)}?page=0&size=25`,
      )
      return
    }
    if (item.source === 'INVENTORY_COUNT') {
      router.history.push(`/warehouses/counts?${new URLSearchParams({
        searchField: 'BATCH',
        keyword: item.documentNo,
        showDetails: 'true',
      }).toString()}`)
      return
    }
    router.history.push(`/warehouses/transfers?${new URLSearchParams({
      searchField: 'BATCH',
      keyword: item.documentNo,
      showDetails: 'true',
    }).toString()}`)
  }

  const exportDocuments = async () => {
    if (exporting || loading || error || totalElements === 0) return
    const queryKey = toInboundOutboundDocumentsUrl(query)
    setExporting(true)
    setExportFeedback(null)
    try {
      const result = await warehouseDocumentApi.exportCsv({
        warehouseId: query.warehouseId,
        direction: query.direction,
        status: query.status,
        approvalStatus: query.approvalStatus,
        source: query.source,
        searchField: query.searchField,
        keyword: query.keyword || undefined,
        occurredFrom: isoStart(query.start),
        occurredTo: isoEnd(query.end),
      })
      const url = URL.createObjectURL(new Blob(
        [result.content],
        { type: result.mediaType },
      ))
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
        message: `已导出 ${result.rowCount} 条${directionLabel(query.direction)}。`,
        queryKey,
      })
    } catch (caught) {
      setExportFeedback({
        kind: 'error',
        message: readExportError(caught),
        queryKey,
      })
    } finally {
      setExporting(false)
    }
  }

  return (
    <main className="inbound-documents-page" aria-labelledby="inbound-documents-title">
      <header className="inbound-documents-heading">
        <div>
          <p className="eyebrow">仓库 / 仓库信息</p>
          <h1 id="inbound-documents-title">入 / 出库单</h1>
          <p>统一查询手工出入库、采购签收入库、分仓调拨收发、订单履约和库存盘点形成的真实库存单据。</p>
        </div>
        <button
          type="button"
          className="inbound-documents-workbench-button"
          onClick={() => router.history.push('/warehouses/manual-movements')}
        >
          打开手工出入库工作台
          <ExternalLink size={16} aria-hidden="true" />
        </button>
      </header>

      <div className="inbound-documents-tabs" role="tablist" aria-label="单据方向">
        {(['INBOUND', 'OUTBOUND'] as const).map((direction) => (
          <button
            type="button"
            role="tab"
            aria-selected={query.direction === direction}
            key={direction}
            onClick={() => navigate({ ...query, direction, page: 0 })}
          >
            {directionLabel(direction)}
          </button>
        ))}
      </div>

      <section className="inbound-documents-card" aria-label={`${directionLabel(query.direction)}筛选与列表`}>
        <form
          className="inbound-documents-filters"
          key={toInboundOutboundDocumentsUrl(query)}
          onSubmit={submit}
        >
          <label>
            仓库
            <select name="warehouseId" defaultValue={query.warehouseId ?? ''}>
              <option value="">全部仓库</option>
              {query.warehouseId && !warehouses.some(
                (warehouse) => warehouse.id === query.warehouseId,
              ) ? (
                <option value={query.warehouseId}>当前筛选仓库</option>
              ) : null}
              {warehouses.map((warehouse) => (
                <option value={warehouse.id} key={warehouse.id}>
                  {warehouse.name}（{warehouse.businessCode}）
                </option>
              ))}
            </select>
            {warehouseError ? <span className="field-hint">仓库选项加载失败。<button type="button" className="inbound-documents-link-button" onClick={() => setWarehouseRetry((value) => value + 1)}>重试仓库选项</button></span> : null}
          </label>
          <label>
            搜索维度
            <select name="searchField" defaultValue={query.searchField}>
              {searchFields.map((field) => (
                <option value={field} key={field}>{searchFieldLabel(field)}</option>
              ))}
            </select>
          </label>
          <label className="is-wide">
            搜索内容
            <input name="keyword" defaultValue={query.keyword} maxLength={100} placeholder="输入单号、SKU、库位、备注或人员" />
          </label>
          <label>
            单据状态
            <select name="status" defaultValue={query.status ?? ''}>
              <option value="">全部状态</option>
              {statuses.map((status) => <option value={status} key={status}>{statusLabel(status)}</option>)}
            </select>
          </label>
          <label>
            审批状态
            <select name="approvalStatus" defaultValue={query.approvalStatus ?? ''}>
              <option value="">全部审批状态</option>
              {approvalStatuses.map((status) => <option value={status} key={status}>{approvalStatusLabel(status)}</option>)}
            </select>
          </label>
          <label>
            来源
            <select name="source" defaultValue={query.source ?? ''}>
              <option value="">全部来源</option>
              {sources.map((source) => <option value={source} key={source}>{sourceLabel(source)}</option>)}
            </select>
          </label>
          <label>
            开始日期
            <input name="start" type="date" defaultValue={query.start} />
          </label>
          <label>
            结束日期
            <input name="end" type="date" defaultValue={query.end} aria-describedby={dateError ? 'inbound-documents-date-error' : undefined} />
            {dateError ? <span id="inbound-documents-date-error" className="field-error" role="alert">{dateError}</span> : null}
          </label>
          <div className="inbound-documents-filter-actions">
            <button type="submit" className="is-primary">查询</button>
            <button type="button" onClick={() => navigate({ direction: query.direction, size: query.size })}>重置</button>
          </div>
        </form>

        <div className="inbound-documents-toolbar">
          <span aria-live="polite">共 {totalElements} 条{query.direction === 'INBOUND' ? '入库' : '出库'}单据</span>
          <div>
            <button
              type="button"
              onClick={() => void exportDocuments()}
              disabled={exporting || loading || Boolean(error) || totalElements === 0}
            >
              {exporting ? '正在导出…' : '导出筛选结果'}
            </button>
            <button type="button" onClick={() => setRetry((value) => value + 1)} disabled={loading || exporting}>
              <RefreshCw size={15} aria-hidden="true" />
              刷新
            </button>
          </div>
        </div>
        {exportFeedback?.queryKey === toInboundOutboundDocumentsUrl(query) ? (
          <p
            className={`inbound-documents-export-feedback is-${exportFeedback.kind}`}
            role={exportFeedback.kind === 'error' ? 'alert' : 'status'}
          >
            {exportFeedback.message}
          </p>
        ) : null}

        <div className="inbound-documents-table-wrap">
          <table aria-label={`${directionLabel(query.direction)}列表`} aria-busy={loading}>
            <thead>
              <tr>
                <th>单号</th>
                <th>单据类型</th>
                <th>仓库</th>
                <th>单据状态</th>
                <th>审批状态</th>
                <th>来源</th>
                <th>商品行 / 数量</th>
                <th>金额</th>
                <th>创建人</th>
                <th>创建 / 过账时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={11}><div className="inbound-documents-state" role="status">正在读取单据…</div></td></tr>
              ) : error ? (
                <tr><td colSpan={11}><div className="inbound-documents-state is-error" role="alert"><strong>{error}</strong><button type="button" onClick={() => setRetry((value) => value + 1)}><RefreshCw size={15} aria-hidden="true" />重试</button></div></td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={11}><div className="inbound-documents-state" role="status"><strong>没有符合条件的{directionLabel(query.direction)}</strong><span>调整筛选条件，或到对应业务工作台处理新的库存单据。</span></div></td></tr>
              ) : items.map((item) => (
                <tr key={`${item.source}:${item.direction}:${item.id}`}>
                  <td><strong className="document-number">{item.documentNo}</strong>{item.sourceReference ? <span className="cell-secondary">来源：{item.sourceReference}</span> : null}</td>
                  <td>{item.documentType}</td>
                  <td>{item.warehouseName}<span className="cell-secondary">{item.warehouseCode}</span></td>
                  <td><span className={`document-status status-${item.status.toLowerCase()}`}>{statusLabel(item.status)}</span></td>
                  <td>{approvalStatusLabel(item.approvalStatus)}</td>
                  <td>{sourceLabel(item.source)}</td>
                  <td className="is-numeric">{item.lineCount} 行 / {formatNumber(item.totalQuantity)}</td>
                  <td className="is-numeric">{item.totalAmount === undefined ? '—' : formatMoney(item.totalAmount, item.currency)}</td>
                  <td>{item.operatorDisplayName}</td>
                  <td>{formatTime(item.occurredAt)}<span className="cell-secondary">过账：{formatTime(item.postedAt)}</span></td>
                  <td><button type="button" className="inbound-documents-link-button" onClick={(event) => openSource(item, event.currentTarget)}>{item.source === 'MANUAL_MOVEMENT' ? '查看详情' : '查看来源'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <footer className="inbound-documents-pagination">
          <span>第 {totalPages === 0 ? 0 : query.page + 1} / {totalPages} 页</span>
          <div>
            <label>
              每页
              <select value={query.size} onChange={(event) => navigate({ ...query, size: Number(event.target.value), page: 0 })}>
                {PAGE_SIZES.map((size) => <option value={size} key={size}>{size}</option>)}
              </select>
            </label>
            <button type="button" disabled={loading || query.page === 0} onClick={() => navigate({ ...query, page: query.page - 1 })}>上一页</button>
            <button type="button" disabled={loading || totalPages === 0 || query.page + 1 >= totalPages} onClick={() => navigate({ ...query, page: query.page + 1 })}>下一页</button>
          </div>
        </footer>
      </section>

      {selectedId ? (
        <DetailDialog
          movementId={selectedId}
          restoreRef={detailTriggerRef}
          onClose={() => setSelectedId(null)}
        />
      ) : null}
    </main>
  )
}
