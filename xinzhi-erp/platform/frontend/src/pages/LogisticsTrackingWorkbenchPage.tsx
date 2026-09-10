import { useRouter, useRouterState } from '@tanstack/react-router'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { ApiError } from '../api/client'
import {
  logisticsStatisticsApi,
  type LogisticsStatisticsGroup,
  type LogisticsStatisticsPage,
} from '../modules/logisticsStatisticsApi'
import './WarehouseArchiveShells.css'

const DEFAULT_SIZE = 25
const PAGE_SIZES = [25, 50, 100] as const

export type LogisticsTrackingWorkbenchQuery = {
  channel: string
  page: number
  size: number
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; data: LogisticsStatisticsPage }
  | { status: 'error'; message: string }

const statusLabels: Readonly<Record<string, string>> = {
  PENDING: '待查询',
  NOT_FOUND: '查询不到',
  IN_TRANSIT: '运输中',
  AVAILABLE_FOR_PICKUP: '到达待取',
  DELIVERY_FAILED: '投递失败',
  EXCEPTION: '可能异常',
  DELIVERED: '签收成功',
  TIMED_OUT: '轨迹超时',
  RETURNED: '包裹退回',
  OUT_FOR_DELIVERY: '派送途中',
}

function boundedText(value: string | null, maximum = 100) {
  return (value ?? '').trim().slice(0, maximum)
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

function statusLabel(value?: string) {
  return value ? (statusLabels[value] ?? value) : '未记录状态'
}

function exportErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 409) {
    return '导出结果超过 10,000 条，请缩小物流渠道范围后重试。'
  }
  if (error instanceof ApiError && error.status === 403) {
    return '当前账号没有导出物流统计的权限。'
  }
  return '暂时无法导出物流跟踪汇总，请稍后重试。'
}

export function parseTrackingWorkbenchQuery(
  search: string,
): LogisticsTrackingWorkbenchQuery {
  const params = new URLSearchParams(search)
  return {
    channel: boundedText(params.get('channel')),
    page: positiveInteger(params.get('page'), 0, 0, 9_999),
    size: positiveInteger(params.get('size'), DEFAULT_SIZE, 1, 100),
  }
}

export function toTrackingWorkbenchUrl(
  query: Partial<LogisticsTrackingWorkbenchQuery>,
) {
  const params = new URLSearchParams()
  if (query.channel) params.set('channel', boundedText(query.channel))
  if (query.page && query.page > 0) params.set('page', String(query.page))
  if (query.size && query.size !== DEFAULT_SIZE) {
    params.set('size', String(query.size))
  }
  const serialized = params.toString()
  return serialized
    ? `/logistics/tracking/workbench?${serialized}`
    : '/logistics/tracking/workbench'
}

function trackingUrl(group: LogisticsStatisticsGroup) {
  const params = new URLSearchParams()
  if (group.groupValue) params.set('carrier', group.groupValue)
  const serialized = params.toString()
  return serialized ? `/logistics/tracking?${serialized}` : '/logistics/tracking'
}

export function LogisticsTrackingWorkbenchPage() {
  const router = useRouter()
  const search = useRouterState({ select: (state) => state.location.searchStr })
  const query = useMemo(() => parseTrackingWorkbenchQuery(search), [search])
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [retry, setRetry] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [exportFeedback, setExportFeedback] = useState<{
    kind: 'success' | 'error'
    message: string
    queryKey: string
  }>()

  const navigate = (next: Partial<LogisticsTrackingWorkbenchQuery>) => {
    router.history.push(toTrackingWorkbenchUrl(next))
  }

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })
    void logisticsStatisticsApi.summarize({
      dimension: 'CHANNEL',
      value: query.channel || undefined,
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
          message: '暂时无法读取物流跟踪工作台，请稍后重试。',
        })
      },
    )
    return () => controller.abort()
  }, [query, retry])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    navigate({
      channel: boundedText(String(data.get('channel') ?? '')),
      page: 0,
      size: query.size,
    })
  }

  const exportQueryKey = toTrackingWorkbenchUrl(query)
  const exportCurrentResult = async () => {
    if (exporting || state.status !== 'ready' || state.data.totalElements === 0) return
    const queryKey = exportQueryKey
    setExporting(true)
    setExportFeedback(undefined)
    try {
      const result = await logisticsStatisticsApi.exportCsv({
        dimension: 'CHANNEL',
        value: query.channel || undefined,
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
        message: `已导出 ${result.rowCount} 条物流渠道状态统计。`,
        queryKey,
      })
    } catch (error) {
      setExportFeedback({
        kind: 'error',
        message: exportErrorMessage(error),
        queryKey,
      })
    } finally {
      setExporting(false)
    }
  }

  return (
    <main className="warehouse-archive-page" aria-labelledby="tracking-workbench-title">
      <header className="warehouse-archive-heading">
        <div>
          <p className="eyebrow">物流 / 增值服务</p>
          <h1 id="tracking-workbench-title">物流跟踪工作台</h1>
          <p>按物流渠道汇总 ERP 已保存的运单记录和原始跟踪状态。</p>
        </div>
      </header>
      <div className="warehouse-archive-tabs" role="tablist" aria-label="物流跟踪视图">
        <button type="button" role="tab" aria-selected={false} onClick={() => router.history.push('/logistics/tracking')}>物流跟踪</button>
        <button className="is-active" type="button" role="tab" aria-selected={true}>工作台</button>
      </div>
      <section className="warehouse-archive-card" aria-label="物流跟踪工作台内容">
        <form className="warehouse-archive-filters" key={toTrackingWorkbenchUrl(query)} onSubmit={submit}>
          <label>物流渠道<input name="channel" defaultValue={query.channel} maxLength={100} placeholder="全部物流渠道" /></label>
          <div className="warehouse-archive-filter-actions">
            <button className="is-primary" type="submit">筛选</button>
            <button type="button" onClick={() => navigate({ size: query.size })}>重置</button>
            <button type="button" onClick={() => setRetry((value) => value + 1)}>刷新</button>
          </div>
        </form>
        <div className="warehouse-processing-formula" role="note">
          <strong>统计口径</strong>
          <span>一条记录对应一笔已保存主运单号或备用运单号的 ERP 订单；状态按数据库原值计数。页面不推导妥投率、异常率或轨迹时效。</span>
        </div>
        <div className="warehouse-archive-actions">
          <button
            type="button"
            disabled={exporting || state.status !== 'ready' || state.data.totalElements === 0}
            onClick={() => void exportCurrentResult()}
          >
            {exporting ? '正在导出…' : '导出筛选结果'}
          </button>
        </div>
        {exportFeedback?.queryKey === exportQueryKey && <p
          className={`warehouse-export-feedback is-${exportFeedback.kind}`}
          role={exportFeedback.kind === 'error' ? 'alert' : 'status'}
        >{exportFeedback.message}</p>}

        {state.status === 'loading' && <div className="warehouse-archive-empty" role="status"><strong>正在读取物流跟踪汇总…</strong></div>}
        {state.status === 'error' && <div className="inline-alert" role="alert">{state.message}<button type="button" onClick={() => setRetry((value) => value + 1)}>重试</button></div>}
        {state.status === 'ready' && <>
          <dl className="inventory-count-summary-grid" aria-label="物流状态汇总">
            <div><dt>运单记录</dt><dd>{state.data.totalRecords}</dd></div>
            {state.data.totalStatuses.map((status) => <div key={status.status ?? '__missing__'}><dt>{statusLabel(status.status)}</dt><dd>{status.recordCount}</dd></div>)}
          </dl>
          <div className="warehouse-archive-table-wrap">
            <table aria-label="物流渠道运单统计">
              <thead><tr><th>物流渠道</th><th>运单记录数</th><th>已保存跟踪状态</th><th>操作</th></tr></thead>
              <tbody>{state.data.items.length === 0
                ? <tr><td colSpan={4}><div className="warehouse-archive-empty" role="status"><strong>没有符合条件的物流跟踪记录</strong><span>只有已保存主运单号或备用运单号的订单会纳入汇总。</span></div></td></tr>
                : state.data.items.map((group) => <tr key={group.groupValue ?? '__missing__'}>
                  <td><strong>{group.groupValue ?? '未记录'}</strong></td>
                  <td>{group.recordCount}</td>
                  <td>{group.statuses.map((status) => <span className="cell-secondary" key={status.status ?? '__missing__'}>{statusLabel(status.status)} {status.recordCount}</span>)}</td>
                  <td>{group.groupValue
                    ? <button className="text-button" type="button" onClick={() => router.history.push(trackingUrl(group))}>查看相关明细</button>
                    : <span className="muted-cell">无可用筛选条件</span>}</td>
                </tr>)}</tbody>
            </table>
          </div>
          <div className="procurement-plan-table-footer">
            <span>共 {state.data.totalElements} 个渠道</span>
            <label>每页<select aria-label="工作台每页渠道数" value={query.size} onChange={(event) => navigate({ ...query, page: 0, size: Number(event.target.value) })}>{PAGE_SIZES.map((size) => <option key={size} value={size}>{size} 个</option>)}</select></label>
            <div className="pagination"><button type="button" disabled={query.page === 0} onClick={() => navigate({ ...query, page: query.page - 1 })}>上一页</button><span>第 {query.page + 1} / {Math.max(state.data.totalPages, 1)} 页</span><button type="button" disabled={query.page + 1 >= state.data.totalPages} onClick={() => navigate({ ...query, page: query.page + 1 })}>下一页</button></div>
          </div>
        </>}
      </section>
    </main>
  )
}
