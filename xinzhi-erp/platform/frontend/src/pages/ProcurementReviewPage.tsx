import { useRouter, useRouterState } from '@tanstack/react-router'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { Check, RefreshCw, RotateCcw, Search, Undo2 } from 'lucide-react'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { SettingsPageHeader } from '../components/SettingsPageLayout'
import { DialogCloseButton } from '../components/DialogCloseButton'
import { ErpIconButton } from '../components/ErpVisualPrimitives'
import {
  procurementOrderApi,
  type ProcurementOrder,
  type ProcurementOrderPage,
  type ProcurementOrderSearchField,
  type ProcurementOrderStatus,
} from '../modules/procurementOrderApi'
import './WarehouseArchiveShells.css'

export type ProcurementReviewSearchField =
  | 'PURCHASE_NO'
  | 'INVENTORY_SKU'
  | 'PRODUCT_NAME'
  | 'ORDERED_BY'

export type ProcurementReviewQuery = {
  searchField: ProcurementReviewSearchField
  keyword: string
  status: 'NEW_ORDER' | 'APPROVED' | 'REJECTED'
  page: number
  size: number
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; data: ProcurementOrderPage }
  | { status: 'error'; message: string }

const DEFAULT_SIZE = 25
const PAGE_SIZES = [10, 25, 50, 100] as const
const searchFields: ReadonlyArray<{ value: ProcurementReviewSearchField; label: string }> = [
  { value: 'PURCHASE_NO', label: '采购 / 自定义单号' },
  { value: 'INVENTORY_SKU', label: '库存 SKU' },
  { value: 'PRODUCT_NAME', label: '商品名称' },
  { value: 'ORDERED_BY', label: '下单员' },
]
const statusLabels: Record<ProcurementReviewQuery['status'], string> = {
  NEW_ORDER: '待审核',
  APPROVED: '已批准',
  REJECTED: '已驳回',
}

function boundedText(value: string | null, maximum: number) {
  return (value ?? '').trim().slice(0, maximum)
}
function boundedInteger(value: string | null, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback
}
function searchField(value: string | null): ProcurementReviewSearchField {
  const allowed = searchFields.map((item) => item.value)
  return allowed.includes(value as ProcurementReviewSearchField)
    ? value as ProcurementReviewSearchField
    : 'PURCHASE_NO'
}
function reviewStatus(value: string | null): ProcurementReviewQuery['status'] {
  return value === 'APPROVED' || value === 'REJECTED' ? value : 'NEW_ORDER'
}
function apiSearchField(value: ProcurementReviewSearchField): ProcurementOrderSearchField {
  if (value === 'INVENTORY_SKU') return 'SKU_CODE'
  if (value === 'PRODUCT_NAME') return 'SKU_NAME'
  return value
}
function safeReviewMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 409) {
    return '采购单状态已变化，请刷新后重试。'
  }
  if (error instanceof ApiError && error.status === 403) {
    return '当前账号没有采购审核权限。'
  }
  return '暂时无法完成采购审核，请稍后重试。'
}

export function parseProcurementReviewQuery(search: string): ProcurementReviewQuery {
  const params = new URLSearchParams(search)
  return {
    searchField: searchField(params.get('searchField')),
    keyword: boundedText(params.get('keyword'), 120),
    status: reviewStatus(params.get('status')),
    page: boundedInteger(params.get('page'), 0, 0, 9_999),
    size: boundedInteger(params.get('size'), DEFAULT_SIZE, 1, 100),
  }
}

export function toProcurementReviewUrl(query: Partial<ProcurementReviewQuery>, path = '/procurement/reviews') {
  const params = new URLSearchParams()
  if (query.searchField && query.searchField !== 'PURCHASE_NO') params.set('searchField', query.searchField)
  if (query.keyword) params.set('keyword', boundedText(query.keyword, 120))
  if (query.status && query.status !== 'NEW_ORDER') params.set('status', query.status)
  if (query.page && query.page > 0) params.set('page', String(query.page))
  if (query.size && query.size !== DEFAULT_SIZE) params.set('size', String(query.size))
  const serialized = params.toString()
  return serialized ? `${path}?${serialized}` : path
}

function ReviewDialog({
  orders,
  approved,
  onClose,
  onCompleted,
}: {
  orders: ProcurementOrder[]
  approved: boolean
  onClose: () => void
  onCompleted: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const note = boundedText(String(data.get('reviewNote') ?? ''), 500)
    if (!approved && !note) {
      setError('驳回时必须填写原因。')
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      for (const order of orders) {
        await procurementOrderApi.review({
          commandId: crypto.randomUUID(),
          purchaseOrderId: order.purchaseOrderId,
          expectedVersion: order.version,
          approved,
          reviewNote: note || undefined,
        })
      }
      onCompleted()
    } catch (reason) {
      setError(safeReviewMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  return <div className="dialog-backdrop" role="presentation">
    <section className="write-dialog inventory-count-create-dialog" role="dialog" aria-modal="true" aria-labelledby="review-dialog-title">
      <header className="table-heading"><div><h2 id="review-dialog-title">{approved ? '批准采购单' : '驳回采购单'}</h2><span>共 {orders.length} 张采购单</span></div><DialogCloseButton disabled={busy} onClick={onClose} /></header>
      <form className="warehouse-archive-filters" onSubmit={(event) => void submit(event)}>
        <div className="warehouse-processing-formula"><strong>本次处理</strong><span>{orders.map((order) => order.purchaseNo).join('、')}</span></div>
        <label>{approved ? '审核备注（可选）' : '驳回原因'}<textarea name="reviewNote" maxLength={500} required={!approved} disabled={busy} /></label>
        {error && <div className="inline-alert" role="alert">{error}</div>}
        <footer className="form-actions"><button type="button" onClick={onClose} disabled={busy}>取消</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? '正在提交…' : approved ? '确认批准' : '确认驳回'}</button></footer>
      </form>
    </section>
  </div>
}

type ProcurementReviewPageProps = {
  path?: string
  eyebrow?: string
  title?: string
  description?: string
  settingsSection?: string
}

export function ProcurementReviewPage({
  path = '/procurement/reviews',
  eyebrow = '供应链 / 采购流程',
  title = '采购审核',
  description = '审核新建采购单，批准后才能签收入库。',
  settingsSection,
}: ProcurementReviewPageProps = {}) {
  const router = useRouter()
  const search = useRouterState({ select: (state) => state.location.searchStr })
  const query = useMemo(() => parseProcurementReviewQuery(search), [search])
  const { hasPermission } = useAuth()
  const canWrite = hasPermission('procurement.write')
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [refreshKey, setRefreshKey] = useState(0)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [dialog, setDialog] = useState<{ orders: ProcurementOrder[]; approved: boolean }>()

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })
    setSelectedIds(new Set())
    void procurementOrderApi.list({
      searchField: apiSearchField(query.searchField),
      keyword: query.keyword || undefined,
      status: query.status as ProcurementOrderStatus,
      page: query.page,
      size: query.size,
      signal: controller.signal,
    }).then(
      (data) => {
        const lastPage = Math.max(data.totalPages - 1, 0)
        if (query.page > lastPage) {
          router.history.push(toProcurementReviewUrl({ ...query, page: lastPage }, path))
          return
        }
        setState({ status: 'ready', data })
      },
      () => { if (!controller.signal.aborted) setState({ status: 'error', message: '暂时无法读取采购审核数据，请稍后重试。' }) },
    )
    return () => controller.abort()
  }, [path, query.keyword, query.page, query.searchField, query.size, query.status, refreshKey, router.history])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    router.history.push(toProcurementReviewUrl({
      searchField: searchField(String(data.get('searchField') ?? '')),
      keyword: boundedText(String(data.get('keyword') ?? ''), 120),
      status: reviewStatus(String(data.get('status') ?? '')),
      page: 0,
      size: query.size,
    }, path))
  }
  const pendingOrders = state.status === 'ready'
    ? state.data.items.filter((order) => selectedIds.has(order.purchaseOrderId) && order.status === 'NEW_ORDER')
    : []
  const allPendingSelected = state.status === 'ready'
    && state.data.items.filter((order) => order.status === 'NEW_ORDER').length > 0
    && state.data.items.filter((order) => order.status === 'NEW_ORDER').every((order) => selectedIds.has(order.purchaseOrderId))

  return <main className={`warehouse-archive-page${settingsSection ? ' settings-page' : ''}`} aria-labelledby="procurement-review-title">
    {settingsSection
      ? <SettingsPageHeader id="procurement-review-title" section={settingsSection} title={title} description={description} />
      : <header className="warehouse-archive-heading"><div><p className="eyebrow">{eyebrow}</p><h1 id="procurement-review-title">{title}</h1><p>{description}</p></div></header>}
    <section className="warehouse-archive-card" aria-label="采购审核筛选与结果">
      <form className="warehouse-archive-filters procurement-plan-filters" key={toProcurementReviewUrl(query, path)} onSubmit={submit}>
        <fieldset className="procurement-plan-search-fields"><legend>搜索内容</legend><div>{searchFields.map((field) => <label key={field.value}><input type="radio" name="searchField" value={field.value} defaultChecked={query.searchField === field.value} />{field.label}</label>)}</div></fieldset>
        <label className="procurement-plan-keyword">关键词<input name="keyword" defaultValue={query.keyword} maxLength={120} placeholder="输入查询内容" /></label>
        <label>审核状态<select name="status" defaultValue={query.status}><option value="NEW_ORDER">待审核</option><option value="APPROVED">已批准</option><option value="REJECTED">已驳回</option></select></label>
        <div className="warehouse-archive-filter-actions"><button className="is-primary" type="submit"><Search size={15} aria-hidden="true" />搜索</button><button type="button" onClick={() => router.history.push(path)}><RotateCcw size={15} aria-hidden="true" />重置</button><button type="button" onClick={() => setRefreshKey((value) => value + 1)}><RefreshCw size={15} aria-hidden="true" />刷新</button></div>
      </form>
      {canWrite && query.status === 'NEW_ORDER' && <div className="warehouse-archive-actions"><button type="button" disabled={pendingOrders.length === 0} onClick={() => setDialog({ orders: pendingOrders, approved: false })}><Undo2 size={15} aria-hidden="true" />批量驳回</button><button className="is-primary" type="button" disabled={pendingOrders.length === 0} onClick={() => setDialog({ orders: pendingOrders, approved: true })}><Check size={15} aria-hidden="true" />批量批准</button></div>}
      {state.status === 'loading' && <div className="warehouse-archive-empty" role="status"><strong>正在读取采购审核数据…</strong></div>}
      {state.status === 'error' && <div className="inline-alert" role="alert">{state.message}<button type="button" onClick={() => setRefreshKey((value) => value + 1)}>重试</button></div>}
      {state.status === 'ready' && <><div className="warehouse-archive-table-wrap"><table aria-label="采购审核列表"><thead><tr><th><input aria-label="全选当前页待审核采购单" type="checkbox" checked={allPendingSelected} disabled={query.status !== 'NEW_ORDER' || state.data.items.length === 0} onChange={(event) => setSelectedIds(event.target.checked ? new Set(state.data.items.filter((order) => order.status === 'NEW_ORDER').map((order) => order.purchaseOrderId)) : new Set())} /></th><th>采购单 / 计划</th><th>供应商</th><th>商品</th><th>采购数量</th><th>下单人 / 时间</th><th>审核结果</th><th>操作</th></tr></thead><tbody>{state.data.items.length === 0 ? <tr><td colSpan={8}><div className="warehouse-archive-empty" role="status"><strong>暂无{statusLabels[query.status]}采购单</strong><span>可切换审核状态查看历史记录。</span></div></td></tr> : state.data.items.map((order) => <tr key={order.purchaseOrderId}><td><input aria-label={`选择采购单 ${order.purchaseNo}`} type="checkbox" disabled={order.status !== 'NEW_ORDER'} checked={selectedIds.has(order.purchaseOrderId)} onChange={(event) => setSelectedIds((current) => { const next = new Set(current); if (event.target.checked) next.add(order.purchaseOrderId); else next.delete(order.purchaseOrderId); return next })} /></td><td>{order.purchaseNo}<br /><small>{order.planNo}</small></td><td>{order.supplierCode} · {order.supplierName}</td><td>{order.skuCode} · {order.skuName}<br /><small>{order.warehouseName} · {order.locationCode}</small></td><td>{order.quantity}</td><td>{order.orderedByDisplayName}<br /><time dateTime={order.createdAt}>{new Date(order.createdAt).toLocaleString()}</time></td><td>{statusLabels[order.status as ProcurementReviewQuery['status']]}{order.reviewedByDisplayName ? <><br /><small>{order.reviewedByDisplayName} · {order.reviewedAt ? new Date(order.reviewedAt).toLocaleString() : '—'}</small>{order.reviewNote ? <><br /><small>{order.reviewNote}</small></> : null}</> : null}</td><td>{canWrite && order.status === 'NEW_ORDER' ? <span className="row-actions"><ErpIconButton icon={Check} label="批准" type="button" onClick={() => setDialog({ orders: [order], approved: true })} /><ErpIconButton icon={Undo2} label="驳回" tone="danger" type="button" onClick={() => setDialog({ orders: [order], approved: false })} /></span> : '—'}</td></tr>)}</tbody></table></div><div className="procurement-plan-table-footer"><span>共 {state.data.totalElements} 条</span><label>每页<select value={query.size} onChange={(event) => router.history.push(toProcurementReviewUrl({ ...query, page: 0, size: Number(event.target.value) }, path))}>{PAGE_SIZES.map((size) => <option key={size} value={size}>{size} 条</option>)}</select></label><div className="pagination"><button type="button" disabled={query.page === 0} onClick={() => router.history.push(toProcurementReviewUrl({ ...query, page: query.page - 1 }, path))}>上一页</button><span>第 {query.page + 1} / {Math.max(state.data.totalPages, 1)} 页</span><button type="button" disabled={query.page + 1 >= state.data.totalPages} onClick={() => router.history.push(toProcurementReviewUrl({ ...query, page: query.page + 1 }, path))}>下一页</button></div></div></>}
    </section>
    {dialog && <ReviewDialog orders={dialog.orders} approved={dialog.approved} onClose={() => setDialog(undefined)} onCompleted={() => { setDialog(undefined); setSelectedIds(new Set()); setRefreshKey((value) => value + 1) }} />}
  </main>
}
