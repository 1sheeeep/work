import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useRouterState } from '@tanstack/react-router'
import { useAuth } from '../auth/AuthContext'
import { ApiError } from '../api/client'
import {
  trackingNumberApi,
  type TrackingNumberPage,
  type TrackingNumberType,
} from '../modules/trackingNumberApi'
import './WarehouseArchiveShells.css'

export type TrackingNumberSearchField = 'ORDER_NO' | 'TRACKING_NO'
export type TrackingNumberStatus = 'ALL' | 'USED' | 'UNUSED' | 'ARCHIVED'
export type TrackingNumberQuery = {
  type: TrackingNumberType
  searchField: TrackingNumberSearchField
  keyword: string
  status: TrackingNumberStatus
  channel: string
  page: number
}

function boundedText(value: string | null, maximum = 120) {
  return (value ?? '').trim().slice(0, maximum)
}
function trackingType(value: string | null): TrackingNumberType {
  return value === 'CUSTOM_LOGISTICS' ? value : 'DOMESTIC_EXPRESS'
}
function searchField(value: string | null): TrackingNumberSearchField {
  return value === 'ORDER_NO' ? value : 'TRACKING_NO'
}
function trackingStatus(value: string | null): TrackingNumberStatus {
  return value === 'USED' || value === 'UNUSED' || value === 'ARCHIVED' ? value : 'ALL'
}
function pageNumber(value: string | null) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0
}

export function parseTrackingNumberQuery(search: string): TrackingNumberQuery {
  const params = new URLSearchParams(search)
  return {
    type: trackingType(params.get('type')),
    searchField: searchField(params.get('searchField')),
    keyword: boundedText(params.get('keyword')),
    status: trackingStatus(params.get('status')),
    channel: boundedText(params.get('channel'), 100),
    page: pageNumber(params.get('page')),
  }
}

export function toTrackingNumberUrl(query: Partial<TrackingNumberQuery>) {
  const params = new URLSearchParams()
  if (query.type === 'CUSTOM_LOGISTICS') params.set('type', query.type)
  if (query.searchField === 'ORDER_NO') params.set('searchField', query.searchField)
  if (query.keyword) params.set('keyword', boundedText(query.keyword))
  if (query.status && query.status !== 'ALL') params.set('status', query.status)
  if (query.channel) params.set('channel', boundedText(query.channel, 100))
  if (query.page && query.page > 0) params.set('page', String(query.page))
  const serialized = params.toString()
  return serialized ? `/logistics/tracking-numbers?${serialized}` : '/logistics/tracking-numbers'
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: TrackingNumberPage }

function errorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 409) return '运单号已存在、已使用或资料已更新，请刷新后重试。'
  if (error instanceof ApiError && error.status === 403) return '当前账号没有管理预置运单号的权限。'
  return '操作未完成，请检查输入或网络后重试。'
}

export function LogisticsTrackingNumberPage() {
  const router = useRouter()
  const search = useRouterState({ select: (state) => state.location.searchStr })
  const { hasPermission } = useAuth()
  const query = useMemo(() => parseTrackingNumberQuery(search), [search])
  const canWrite = hasPermission('logistics.tracking_number.write')
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [reload, setReload] = useState(0)
  const [importOpen, setImportOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string }>()

  const navigate = (next: Partial<TrackingNumberQuery>) => {
    router.history.push(toTrackingNumberUrl(next))
  }
  const load = useCallback(() => setReload((value) => value + 1), [])
  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })
    void trackingNumberApi.list({ ...query, size: 25, signal: controller.signal })
      .then((data) => setState({ status: 'ready', data }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ status: 'error', message: errorMessage(error) })
      })
    return () => controller.abort()
  }, [query, reload])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    navigate({
      type: query.type,
      searchField: searchField(String(data.get('searchField') ?? 'TRACKING_NO')),
      keyword: boundedText(String(data.get('keyword') ?? '')),
      status: trackingStatus(String(data.get('status') ?? 'ALL')),
      channel: boundedText(String(data.get('channel') ?? ''), 100),
      page: 0,
    })
  }

  const importNumbers = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const channel = String(data.get('channel') ?? '').trim()
    const trackingReferences = String(data.get('trackingReferences') ?? '')
      .split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
    const duplicateCount = trackingReferences.length - new Set(trackingReferences).size
    if (!channel || trackingReferences.length === 0 || trackingReferences.length > 500 || duplicateCount > 0) {
      setFeedback({ kind: 'error', message: duplicateCount > 0
        ? '本批次包含重复运单号，请去重后再导入。'
        : '请填写物流渠道，并输入 1–500 个运单号（每行一个）。' })
      return
    }
    setBusy(true)
    setFeedback(undefined)
    try {
      const result = await trackingNumberApi.importNumbers({
        type: query.type, channel, trackingReferences,
      })
      setImportOpen(false)
      setFeedback({ kind: 'success', message: `已导入 ${result.importedCount} 个运单号。` })
      load()
    } catch (error) {
      setFeedback({ kind: 'error', message: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  const archive = async (id: string, version: number, reference: string) => {
    if (!window.confirm(`确认停用未使用的运单号 ${reference}？停用后不能用于新的仓库交接。`)) return
    setBusy(true)
    setFeedback(undefined)
    try {
      await trackingNumberApi.archive(id, version)
      setFeedback({ kind: 'success', message: `运单号 ${reference} 已停用。` })
      load()
    } catch (error) {
      setFeedback({ kind: 'error', message: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="warehouse-archive-page" aria-labelledby="tracking-number-title">
      <header className="warehouse-archive-heading"><div>
        <p className="eyebrow">物流 / 物流管理</p>
        <h1 id="tracking-number-title">运单号管理</h1>
        <p>导入预置运单号；订单包裹完成仓库交接时自动核销池内号码。</p>
      </div></header>

      <div className="warehouse-archive-tabs" role="tablist" aria-label="运单号类型">
        <button className={query.type === 'DOMESTIC_EXPRESS' ? 'is-active' : ''} type="button" role="tab" aria-selected={query.type === 'DOMESTIC_EXPRESS'} onClick={() => navigate({ type: 'DOMESTIC_EXPRESS' })}>国内快递单号</button>
        <button className={query.type === 'CUSTOM_LOGISTICS' ? 'is-active' : ''} type="button" role="tab" aria-selected={query.type === 'CUSTOM_LOGISTICS'} onClick={() => navigate({ type: 'CUSTOM_LOGISTICS' })}>自定义物流单号</button>
      </div>

      <section className="warehouse-archive-card" aria-label="运单号筛选与列表">
        <div className="warehouse-processing-formula" role="note"><strong>使用规则</strong><span>同一企业的运单号不可重复；已核销号码将保留订单和包裹记录，不能再次使用。未使用号码可停用。</span></div>
        <form className="warehouse-archive-filters" key={toTrackingNumberUrl(query)} onSubmit={submit}>
          <label>搜索字段<select name="searchField" defaultValue={query.searchField}><option value="TRACKING_NO">运单号</option><option value="ORDER_NO">订单编号</option></select></label>
          <label>搜索内容<input name="keyword" defaultValue={query.keyword} maxLength={120} placeholder="输入运单号或订单编号" /></label>
          <label>使用状态<select name="status" defaultValue={query.status}><option value="ALL">全部</option><option value="UNUSED">未使用</option><option value="USED">已使用</option><option value="ARCHIVED">已停用</option></select></label>
          <label>物流渠道<input name="channel" defaultValue={query.channel} maxLength={100} placeholder="全部物流渠道" /></label>
          <div className="warehouse-archive-filter-actions"><button className="is-primary" type="submit">搜索</button><button type="button" onClick={() => navigate({ type: query.type })}>重置</button></div>
        </form>

        <div className="warehouse-archive-actions">{canWrite && <button className="is-primary" type="button" disabled={busy} onClick={() => { setFeedback(undefined); setImportOpen(true) }}>批量导入运单号</button>}</div>
        {feedback && <p className={`warehouse-export-feedback is-${feedback.kind}`} role={feedback.kind === 'error' ? 'alert' : 'status'}>{feedback.message}</p>}
        {importOpen && <form className="warehouse-archive-card" aria-label="批量导入运单号" onSubmit={(event) => void importNumbers(event)}>
          <h2>批量导入{query.type === 'DOMESTIC_EXPRESS' ? '国内快递' : '自定义物流'}单号</h2>
          <label>物流渠道<input name="channel" maxLength={100} required autoFocus placeholder="例如 SF、DHL、4PX" /></label>
          <label>运单号（每行一个，最多 500 个）<textarea name="trackingReferences" rows={10} maxLength={80500} required /></label>
          <div className="form-actions"><button type="button" className="button button-secondary" disabled={busy} onClick={() => setImportOpen(false)}>取消</button><button type="submit" className="button button-primary" disabled={busy}>{busy ? '正在导入…' : '确认导入'}</button></div>
        </form>}

        {state.status === 'loading' && <p className="product-state" role="status">正在加载运单号…</p>}
        {state.status === 'error' && <div className="compact-empty-state" role="alert"><strong>无法读取运单号</strong><span>{state.message}</span><button className="text-button" type="button" onClick={load}>重试</button></div>}
        {state.status === 'ready' && <div className="warehouse-archive-table-wrap">
          <table aria-label="运单号列表"><thead><tr><th>运单号</th><th>物流渠道</th><th>状态</th><th>订单 / 包裹</th><th>导入时间</th><th>使用时间</th><th>操作</th></tr></thead>
            <tbody>{state.data.items.length === 0 ? <tr><td colSpan={7}><div className="warehouse-archive-empty" role="status"><strong>没有符合条件的运单号</strong><span>{canWrite ? '可通过“批量导入运单号”建立可用号码池。' : '请调整筛选条件后重试。'}</span></div></td></tr> : state.data.items.map((item) => <tr key={item.id}>
              <td>{item.trackingReference}</td><td>{item.logisticsChannel}</td><td><span className={`status-badge is-${item.status.toLowerCase()}`}>{item.status === 'UNUSED' ? '未使用' : item.status === 'USED' ? '已使用' : '已停用'}</span></td>
              <td>{item.orderReference ? <><span>{item.orderReference}</span><small className="cell-secondary">包裹 {item.packageNumber}</small></> : '—'}</td>
              <td>{new Date(item.createdAt).toLocaleString('zh-CN')}</td><td>{item.usedAt ? new Date(item.usedAt).toLocaleString('zh-CN') : '—'}</td>
              <td><button className="text-button" type="button" onClick={() => void navigator.clipboard?.writeText(item.trackingReference)}>复制</button>{canWrite && item.status === 'UNUSED' && <button className="text-button" type="button" disabled={busy} onClick={() => void archive(item.id, item.version, item.trackingReference)}>停用</button>}</td>
            </tr>)}</tbody>
          </table>
          <nav className="pagination" aria-label="运单号分页"><span>共 {state.data.totalElements} 条 · 第 {state.data.page + 1} / {Math.max(state.data.totalPages, 1)} 页</span><div><button type="button" disabled={state.data.page === 0} onClick={() => navigate({ ...query, page: query.page - 1 })}>上一页</button><button type="button" disabled={state.data.page + 1 >= state.data.totalPages} onClick={() => navigate({ ...query, page: query.page + 1 })}>下一页</button></div></nav>
        </div>}
      </section>
    </main>
  )
}
