import { useRouter, useRouterState } from '@tanstack/react-router'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import {
  logisticsTrackingApi,
  type LogisticsPackageStatus,
  type LogisticsTrackingItem,
  type LogisticsTrackingPage as TrackingPage,
  type LogisticsTrackingSearchField,
} from '../modules/logisticsTrackingApi'
import {
  businessDayEndInstant,
  businessDayStartInstant,
} from '../modules/businessTime'
import './WarehouseArchiveShells.css'

const DEFAULT_SIZE = 25
const PAGE_SIZES = [25, 50, 100] as const

export type PackageTrackingStatus = 'ALL' | LogisticsPackageStatus
export type LogisticsTrackingQuery = {
  shop: string
  carrier: string
  country: string
  warehouse: string
  category: string
  searchField: LogisticsTrackingSearchField
  keyword: string
  status: PackageTrackingStatus
  shippedFrom: string
  shippedTo: string
  page: number
  size: number
}

const packageStatuses: ReadonlyArray<{
  value: PackageTrackingStatus
  label: string
}> = [
  { value: 'ALL', label: '全部' },
  { value: 'PENDING', label: '待查询' },
  { value: 'NOT_FOUND', label: '查询不到' },
  { value: 'IN_TRANSIT', label: '运输中' },
  { value: 'AVAILABLE_FOR_PICKUP', label: '到达待取' },
  { value: 'DELIVERY_FAILED', label: '投递失败' },
  { value: 'EXCEPTION', label: '可能异常' },
  { value: 'DELIVERED', label: '签收成功' },
  { value: 'TIMED_OUT', label: '轨迹超时' },
  { value: 'RETURNED', label: '包裹退回' },
  { value: 'OUT_FOR_DELIVERY', label: '派送途中' },
]

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; data: TrackingPage }
  | { status: 'error'; message: string }

function boundedText(value: string | null, maximum = 100) {
  return (value ?? '').trim().slice(0, maximum)
}
function dateText(value: string | null) {
  const normalized = boundedText(value, 10)
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized)
  if (!match) return ''
  const parsed = new Date(`${normalized}T00:00:00.000Z`)
  return !Number.isNaN(parsed.valueOf())
    && parsed.toISOString().startsWith(normalized)
    ? normalized
    : ''
}
function countryText(value: string | null) {
  const normalized = (value ?? '').trim().toUpperCase()
  return /^[A-Z]{2}$/.test(normalized) ? normalized : ''
}
function positiveInteger(
  value: string | null,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback
}
function packageStatus(value: string | null): PackageTrackingStatus {
  return packageStatuses.some((status) => status.value === value)
    ? value as PackageTrackingStatus
    : 'ALL'
}
function searchField(value: string | null): LogisticsTrackingSearchField {
  return value === 'TRACKING_NO' ? value : 'ORDER_NO'
}
function startInstant(value: string) {
  return value ? businessDayStartInstant(value) : undefined
}
function endInstant(value: string) {
  return value ? businessDayEndInstant(value) : undefined
}
function formatTime(value?: string) {
  return value
    ? new Date(value).toLocaleString('zh-CN', { hour12: false })
    : '—'
}
function statusLabel(value?: string) {
  const match = packageStatuses.find((status) => status.value === value)
  return match?.label ?? value ?? '未记录'
}
function trackingNumbers(item: LogisticsTrackingItem) {
  return [...new Set(
    [item.trackingReference, item.secondaryTrackingReference]
      .filter((value): value is string => Boolean(value)),
  )]
}

function exportMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 403) return '当前账号没有物流跟踪导出权限。'
  if (error instanceof ApiError && error.status === 409) return '筛选结果超过 10,000 条，请缩小筛选范围后重试。'
  return '暂时无法导出物流跟踪记录，请检查网络后重试。'
}

export function parseLogisticsTrackingQuery(search: string): LogisticsTrackingQuery {
  const params = new URLSearchParams(search)
  return {
    shop: boundedText(params.get('shop')),
    carrier: boundedText(params.get('carrier')),
    country: countryText(params.get('country')),
    warehouse: boundedText(params.get('warehouse')),
    category: boundedText(params.get('category')),
    searchField: searchField(params.get('searchField')),
    keyword: boundedText(params.get('keyword'), 120),
    status: packageStatus(params.get('status')),
    shippedFrom: dateText(params.get('shippedFrom')),
    shippedTo: dateText(params.get('shippedTo')),
    page: positiveInteger(params.get('page'), 0, 0, 9_999),
    size: positiveInteger(params.get('size'), DEFAULT_SIZE, 1, 200),
  }
}

export function toLogisticsTrackingUrl(query: Partial<LogisticsTrackingQuery>) {
  const params = new URLSearchParams()
  for (const key of ['shop', 'carrier', 'warehouse', 'category'] as const) {
    if (query[key]) params.set(key, boundedText(query[key]))
  }
  const country = countryText(query.country ?? null)
  if (country) params.set('country', country)
  if (query.searchField === 'TRACKING_NO') params.set('searchField', query.searchField)
  if (query.keyword) params.set('keyword', boundedText(query.keyword, 120))
  if (query.status && query.status !== 'ALL') params.set('status', query.status)
  const shippedFrom = dateText(query.shippedFrom ?? null)
  const shippedTo = dateText(query.shippedTo ?? null)
  if (shippedFrom) params.set('shippedFrom', shippedFrom)
  if (shippedTo) params.set('shippedTo', shippedTo)
  if (query.page && query.page > 0) params.set('page', String(query.page))
  if (query.size && query.size !== DEFAULT_SIZE) params.set('size', String(query.size))
  const serialized = params.toString()
  return serialized ? `/logistics/tracking?${serialized}` : '/logistics/tracking'
}

export function LogisticsTrackingPage() {
  const router = useRouter()
  const search = useRouterState({ select: (state) => state.location.searchStr })
  const query = useMemo(() => parseLogisticsTrackingQuery(search), [search])
  const { hasPermission } = useAuth()
  const canReadOrders = hasPermission('orders.read')
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [retry, setRetry] = useState(0)
  const [filterError, setFilterError] = useState<string>()
  const [exporting, setExporting] = useState(false)
  const [exportFeedback, setExportFeedback] = useState<{ kind: 'success' | 'error'; message: string; queryKey: string }>()

  const navigate = (next: Partial<LogisticsTrackingQuery>) => {
    router.history.push(toLogisticsTrackingUrl(next))
  }

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })
    void logisticsTrackingApi.list({
      shop: query.shop || undefined,
      carrier: query.carrier || undefined,
      country: query.country || undefined,
      warehouse: query.warehouse || undefined,
      category: query.category || undefined,
      searchField: query.searchField,
      keyword: query.keyword || undefined,
      status: query.status === 'ALL' ? undefined : query.status,
      shippedFrom: startInstant(query.shippedFrom),
      shippedTo: endInstant(query.shippedTo),
      page: query.page,
      size: query.size,
      signal: controller.signal,
    }).then(
      (data) => {
        const lastPage = Math.max(data.totalPages - 1, 0)
        if (query.page > lastPage) {
          navigate({ ...query, page: lastPage })
          return
        }
        setState({ status: 'ready', data })
      },
      (error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setState({
          status: 'error',
          message: '暂时无法读取物流跟踪记录，请稍后重试。',
        })
      },
    )
    return () => controller.abort()
  }, [query, retry])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const shippedFrom = dateText(String(data.get('shippedFrom') ?? ''))
    const shippedTo = dateText(String(data.get('shippedTo') ?? ''))
    if (shippedFrom && shippedTo && shippedFrom > shippedTo) {
      setFilterError('发货起始日期不能晚于截止日期。')
      return
    }
    setFilterError(undefined)
    navigate({
      shop: boundedText(String(data.get('shop') ?? '')),
      carrier: boundedText(String(data.get('carrier') ?? '')),
      country: countryText(String(data.get('country') ?? '')),
      warehouse: boundedText(String(data.get('warehouse') ?? '')),
      category: boundedText(String(data.get('category') ?? '')),
      searchField: searchField(String(data.get('searchField') ?? 'ORDER_NO')),
      keyword: boundedText(String(data.get('keyword') ?? ''), 120),
      status: query.status,
      shippedFrom,
      shippedTo,
      page: 0,
      size: query.size,
    })
  }

  const exportQueryKey = toLogisticsTrackingUrl(query)
  const exportTracking = async () => {
    const queryKey = exportQueryKey
    setExporting(true); setExportFeedback(undefined)
    try {
      const result = await logisticsTrackingApi.exportCsv({
        shop: query.shop || undefined, carrier: query.carrier || undefined,
        country: query.country || undefined, warehouse: query.warehouse || undefined,
        category: query.category || undefined, searchField: query.searchField,
        keyword: query.keyword || undefined,
        status: query.status === 'ALL' ? undefined : query.status,
        shippedFrom: startInstant(query.shippedFrom),
        shippedTo: endInstant(query.shippedTo),
      })
      const url = URL.createObjectURL(new Blob([result.content], { type: result.mediaType }))
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = result.filename
      document.body.append(anchor)
      try { anchor.click() } finally { anchor.remove(); URL.revokeObjectURL(url) }
      setExportFeedback({ kind: 'success', message: `已导出 ${result.rowCount} 条物流跟踪记录。`, queryKey })
    } catch (error) {
      setExportFeedback({ kind: 'error', message: exportMessage(error), queryKey })
    } finally { setExporting(false) }
  }

  return (
    <main className="warehouse-archive-page" aria-labelledby="logistics-tracking-title">
      <header className="warehouse-archive-heading">
        <div>
          <p className="eyebrow">物流 / 增值服务</p>
          <h1 id="logistics-tracking-title">物流跟踪</h1>
          <p>查询订单运单号、物流渠道和跟踪状态。</p>
        </div>
      </header>

      <div className="warehouse-archive-tabs" role="tablist" aria-label="物流跟踪视图">
        <button className="is-active" type="button" role="tab" aria-selected="true">物流跟踪</button>
        <button type="button" role="tab" aria-selected="false" onClick={() => router.history.push('/logistics/tracking/workbench')}>工作台</button>
      </div>

      <section className="warehouse-archive-card" aria-label="物流跟踪筛选与列表">
        <form className="warehouse-archive-filters" key={toLogisticsTrackingUrl(query)} onSubmit={submit}>
          <label>店铺<input name="shop" defaultValue={query.shop} maxLength={100} placeholder="平台或店铺名称" /></label>
          <label>物流渠道<input name="carrier" defaultValue={query.carrier} maxLength={100} placeholder="渠道或运输服务" /></label>
          <label>目的国家<input name="country" defaultValue={query.country} maxLength={2} placeholder="两位国家码" /></label>
          <label>仓库<input name="warehouse" defaultValue={query.warehouse} maxLength={100} placeholder="仓库编号或名称" /></label>
          <label>自定义分类<input name="category" defaultValue={query.category} maxLength={100} placeholder="固定或自定义分类" /></label>
          <label>搜索字段<select name="searchField" defaultValue={query.searchField}><option value="ORDER_NO">订单编号</option><option value="TRACKING_NO">运单号</option></select></label>
          <label>搜索内容<input name="keyword" defaultValue={query.keyword} maxLength={120} placeholder="订单编号或运单号" /></label>
          <label>发货时间起<input name="shippedFrom" type="date" defaultValue={query.shippedFrom} /></label>
          <label>发货时间止<input name="shippedTo" type="date" defaultValue={query.shippedTo} /></label>
          <div className="warehouse-archive-filter-actions"><button className="is-primary" type="submit">搜索</button><button type="button" onClick={() => navigate({ status: query.status, size: query.size })}>重置</button><button type="button" onClick={() => setRetry((value) => value + 1)}>刷新列表</button></div>
        </form>
        {filterError && <div className="inline-alert" role="alert">{filterError}</div>}

        <div className="warehouse-archive-tabs" role="tablist" aria-label="包裹状态">
          {packageStatuses.map((status) => <button className={query.status === status.value ? 'is-active' : ''} key={status.value} type="button" role="tab" aria-selected={query.status === status.value} onClick={() => navigate({ ...query, status: status.value, page: 0 })}>{status.label}</button>)}
        </div>

        <div className="warehouse-processing-formula" role="note"><strong>提示</strong><span>当前仅显示已保存的物流信息。</span></div>
        <div className="warehouse-archive-actions"><button type="button" disabled={exporting || state.status !== 'ready' || state.data.totalElements === 0} onClick={() => void exportTracking()}>{exporting ? '正在导出…' : '导出筛选结果'}</button></div>
        {exportFeedback?.queryKey === exportQueryKey && <p className={`warehouse-export-feedback is-${exportFeedback.kind}`} role={exportFeedback.kind === 'error' ? 'alert' : 'status'}>{exportFeedback.message}</p>}

        {state.status === 'loading' && <div className="warehouse-archive-empty" role="status"><strong>正在读取物流跟踪记录…</strong></div>}
        {state.status === 'error' && <div className="inline-alert" role="alert">{state.message}<button type="button" onClick={() => setRetry((value) => value + 1)}>重试</button></div>}
        {state.status === 'ready' && <>
          <div className="warehouse-archive-table-wrap">
            <table aria-label="物流跟踪列表">
              <thead><tr><th>平台 / 店铺</th><th>订单号</th><th>目的国家 / 仓库</th><th>发货时间</th><th>运单号 / 物流渠道</th><th>跟踪状态</th><th>订单分类</th><th>记录更新时间</th>{canReadOrders && <th>操作</th>}</tr></thead>
              <tbody>{state.data.items.length === 0
                ? <tr><td colSpan={canReadOrders ? 9 : 8}><div className="warehouse-archive-empty" role="status"><strong>没有符合条件的物流跟踪记录</strong><span>只有已保存主运单号或备用运单号的订单会出现在这里。</span></div></td></tr>
                : state.data.items.map((item) => <tr key={item.orderId}>
                  <td>{item.platformName}<small>{item.shopName}</small></td>
                  <td><strong>{item.orderNo}</strong></td>
                  <td>{item.countryCode ?? '—'}<small>{item.warehouseSummary ?? '未记录仓库'}</small></td>
                  <td><time dateTime={item.shippedAt}>{formatTime(item.shippedAt)}</time></td>
                  <td>{trackingNumbers(item).map((number) => <span key={number} className="cell-secondary">{number}</span>)}<small>{item.logisticsChannel ?? '未记录物流渠道'}</small></td>
                  <td><span className="status-badge">{statusLabel(item.trackingStatus)}</span></td>
                  <td>{item.customCategory ?? item.fixedCategory ?? '—'}</td>
                  <td><time dateTime={item.updatedAt}>{formatTime(item.updatedAt)}</time></td>
                  {canReadOrders && <td><button className="text-button" type="button" onClick={() => router.history.push(`/orders/${encodeURIComponent(item.orderId)}?page=0&size=25`)}>查看订单</button></td>}
                </tr>)}</tbody>
            </table>
          </div>
          <div className="procurement-plan-table-footer"><span>共 {state.data.totalElements} 条</span><label>每页<select value={query.size} onChange={(event) => navigate({ ...query, page: 0, size: Number(event.target.value) })}>{PAGE_SIZES.map((size) => <option key={size} value={size}>{size} 条</option>)}</select></label><div className="pagination"><button type="button" disabled={query.page === 0} onClick={() => navigate({ ...query, page: query.page - 1 })}>上一页</button><span>第 {query.page + 1} / {Math.max(state.data.totalPages, 1)} 页</span><button type="button" disabled={query.page + 1 >= state.data.totalPages} onClick={() => navigate({ ...query, page: query.page + 1 })}>下一页</button></div></div>
        </>}
      </section>
    </main>
  )
}
