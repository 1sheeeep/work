import { useRouter, useRouterState } from '@tanstack/react-router'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { ApiError } from '../api/client'
import {
  logisticsStatisticsApi,
  type LogisticsStatisticsDimension,
  type LogisticsStatisticsGroup,
  type LogisticsStatisticsPage as StatisticsPage,
} from '../modules/logisticsStatisticsApi'
import {
  businessDateText,
  businessDayStartInstant,
} from '../modules/businessTime'
import './WarehouseArchiveShells.css'

const DEFAULT_SIZE = 25
const PAGE_SIZES = [25, 50, 100] as const

export type LogisticsStatisticsTimeMode = 'RANGE' | 'TODAY'
export type LogisticsStatisticsQuery = {
  dimension: LogisticsStatisticsDimension
  value: string
  timeMode: LogisticsStatisticsTimeMode
  from: string
  to: string
  page: number
  size: number
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; data: StatisticsPage }
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

function dateText(value: string | null) {
  const normalized = boundedText(value, 10)
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized)
  if (!match) return ''
  const parsed = new Date(Date.UTC(
    Number(match[1]), Number(match[2]) - 1, Number(match[3]),
  ))
  return parsed.getUTCFullYear() === Number(match[1])
    && parsed.getUTCMonth() === Number(match[2]) - 1
    && parsed.getUTCDate() === Number(match[3])
    ? normalized
    : ''
}

function dimension(value: string | null): LogisticsStatisticsDimension {
  return value === 'CHANNEL' ? value : 'COUNTRY'
}

function timeMode(value: string | null): LogisticsStatisticsTimeMode {
  return value === 'TODAY' ? value : 'RANGE'
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

function dayBoundaryInstant(value: string, nextDay = false) {
  return value ? businessDayStartInstant(value, nextDay) : undefined
}

function shipmentWindow(query: LogisticsStatisticsQuery) {
  const today = businessDateText()
  const from = query.timeMode === 'TODAY' ? today : query.from
  const to = query.timeMode === 'TODAY' ? today : query.to
  return {
    shippedFrom: dayBoundaryInstant(from),
    shippedToExclusive: dayBoundaryInstant(to, true),
  }
}

function statusLabel(value?: string) {
  return value ? (statusLabels[value] ?? value) : '未记录状态'
}

function exportErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 409) {
    return '导出结果超过 10,000 条，请缩小日期或分组范围后重试。'
  }
  if (error instanceof ApiError && error.status === 403) {
    return '当前账号没有导出物流统计的权限。'
  }
  return '暂时无法导出物流统计，请稍后重试。'
}

export function parseLogisticsStatisticsQuery(
  search: string,
): LogisticsStatisticsQuery {
  const params = new URLSearchParams(search)
  return {
    dimension: dimension(params.get('dimension')),
    value: boundedText(params.get('value')),
    timeMode: timeMode(params.get('timeMode')),
    from: dateText(params.get('from')),
    to: dateText(params.get('to')),
    page: positiveInteger(params.get('page'), 0, 0, 9_999),
    size: positiveInteger(params.get('size'), DEFAULT_SIZE, 1, 100),
  }
}

export function toLogisticsStatisticsUrl(
  query: Partial<LogisticsStatisticsQuery>,
) {
  const params = new URLSearchParams()
  if (query.dimension === 'CHANNEL') params.set('dimension', query.dimension)
  if (query.value) params.set('value', boundedText(query.value))
  if (query.timeMode === 'TODAY') params.set('timeMode', query.timeMode)
  const from = dateText(query.from ?? null)
  const to = dateText(query.to ?? null)
  if (query.timeMode !== 'TODAY' && from) params.set('from', from)
  if (query.timeMode !== 'TODAY' && to) params.set('to', to)
  if (query.page && query.page > 0) params.set('page', String(query.page))
  if (query.size && query.size !== DEFAULT_SIZE) {
    params.set('size', String(query.size))
  }
  const serialized = params.toString()
  return serialized
    ? `/logistics/statistics?${serialized}`
    : '/logistics/statistics'
}

function trackingUrl(
  query: LogisticsStatisticsQuery,
  group: LogisticsStatisticsGroup,
) {
  const params = new URLSearchParams()
  if (group.groupValue) {
    params.set(query.dimension === 'COUNTRY' ? 'country' : 'carrier', group.groupValue)
  }
  const today = businessDateText()
  const from = query.timeMode === 'TODAY' ? today : query.from
  const to = query.timeMode === 'TODAY' ? today : query.to
  if (from) params.set('shippedFrom', from)
  if (to) params.set('shippedTo', to)
  const serialized = params.toString()
  return serialized ? `/logistics/tracking?${serialized}` : '/logistics/tracking'
}

export function LogisticsStatisticsPage() {
  const router = useRouter()
  const search = useRouterState({ select: (state) => state.location.searchStr })
  const query = useMemo(() => parseLogisticsStatisticsQuery(search), [search])
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [retry, setRetry] = useState(0)
  const [filterError, setFilterError] = useState<string>()
  const [exporting, setExporting] = useState(false)
  const [exportFeedback, setExportFeedback] = useState<{
    kind: 'success' | 'error'
    message: string
    queryKey: string
  }>()

  const navigate = (next: Partial<LogisticsStatisticsQuery>) => {
    router.history.push(toLogisticsStatisticsUrl(next))
  }

  useEffect(() => {
    const controller = new AbortController()
    const window = shipmentWindow(query)
    setState({ status: 'loading' })
    void logisticsStatisticsApi.summarize({
      dimension: query.dimension,
      value: query.value || undefined,
      ...window,
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
          message: '暂时无法读取物流统计，请稍后重试。',
        })
      },
    )
    return () => controller.abort()
  }, [query, retry])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const from = dateText(String(data.get('from') ?? ''))
    const to = dateText(String(data.get('to') ?? ''))
    if (query.timeMode === 'RANGE' && from && to && from > to) {
      setFilterError('起始日期不能晚于截止日期。')
      return
    }
    setFilterError(undefined)
    navigate({
      dimension: query.dimension,
      value: boundedText(String(data.get('value') ?? '')),
      timeMode: query.timeMode,
      from,
      to,
      page: 0,
      size: query.size,
    })
  }

  const exportQueryKey = toLogisticsStatisticsUrl(query)
  const exportCurrentResult = async () => {
    if (exporting || state.status !== 'ready' || state.data.totalElements === 0) return
    const queryKey = exportQueryKey
    setExporting(true)
    setExportFeedback(undefined)
    try {
      const result = await logisticsStatisticsApi.exportCsv({
        dimension: query.dimension,
        value: query.value || undefined,
        ...shipmentWindow(query),
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
        message: `已导出 ${result.rowCount} 条物流状态统计。`,
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

  const dimensionLabel = query.dimension === 'COUNTRY'
    ? '国家 / 地区'
    : '物流渠道'

  return (
    <main className="warehouse-archive-page" aria-labelledby="logistics-statistics-title">
      <header className="warehouse-archive-heading">
        <div>
          <p className="eyebrow">物流 / 数据统计</p>
          <h1 id="logistics-statistics-title">物流统计</h1>
          <p>按国家或物流渠道汇总 ERP 已保存的运单记录和原始跟踪状态。</p>
        </div>
      </header>

      <div className="warehouse-archive-tabs" role="tablist" aria-label="统计维度">
        <button className={query.dimension === 'COUNTRY' ? 'is-active' : ''} type="button" role="tab" aria-selected={query.dimension === 'COUNTRY'} onClick={() => navigate({ ...query, dimension: 'COUNTRY', value: '', page: 0 })}>按国家统计</button>
        <button className={query.dimension === 'CHANNEL' ? 'is-active' : ''} type="button" role="tab" aria-selected={query.dimension === 'CHANNEL'} onClick={() => navigate({ ...query, dimension: 'CHANNEL', value: '', page: 0 })}>按渠道统计</button>
      </div>

      <section className="warehouse-archive-card" aria-label="物流统计筛选与结果">
        <div className="warehouse-processing-formula" role="note">
          <strong>统计口径</strong>
          <span>一条记录对应一笔已保存主运单号或备用运单号的 ERP 订单；状态按数据库原值计数。页面不查询承运商，也不推导妥投率、异常率、重量或费用。</span>
        </div>

        <div className="warehouse-archive-tabs" role="tablist" aria-label="统计时间方式">
          <button className={query.timeMode === 'RANGE' ? 'is-active' : ''} type="button" role="tab" aria-selected={query.timeMode === 'RANGE'} onClick={() => navigate({ ...query, timeMode: 'RANGE', page: 0 })}>指定日期</button>
          <button className={query.timeMode === 'TODAY' ? 'is-active' : ''} type="button" role="tab" aria-selected={query.timeMode === 'TODAY'} onClick={() => navigate({ ...query, timeMode: 'TODAY', page: 0 })}>今日</button>
        </div>

        <form className="warehouse-archive-filters" key={toLogisticsStatisticsUrl(query)} onSubmit={submit}>
          <label>{dimensionLabel}<input name="value" defaultValue={query.value} maxLength={100} placeholder={`全部${dimensionLabel}`} /></label>
          <label>起始日期<input name="from" type="date" defaultValue={query.from} disabled={query.timeMode === 'TODAY'} /></label>
          <label>截止日期<input name="to" type="date" defaultValue={query.to} disabled={query.timeMode === 'TODAY'} /></label>
          <div className="warehouse-archive-filter-actions">
            <button className="is-primary" type="submit">统计</button>
            <button type="button" onClick={() => navigate({ dimension: query.dimension, timeMode: query.timeMode, size: query.size })}>重置</button>
            <button type="button" onClick={() => setRetry((value) => value + 1)}>刷新统计</button>
          </div>
        </form>
        {filterError && <div className="inline-alert" role="alert">{filterError}</div>}
        <div className="warehouse-archive-actions"><button type="button" disabled={exporting || state.status !== 'ready' || state.data.totalElements === 0} onClick={() => void exportCurrentResult()}>{exporting ? '正在导出…' : '导出筛选结果'}</button></div>
        {exportFeedback?.queryKey === exportQueryKey && <p className={`warehouse-export-feedback is-${exportFeedback.kind}`} role={exportFeedback.kind === 'error' ? 'alert' : 'status'}>{exportFeedback.message}</p>}

        {state.status === 'loading' && <div className="warehouse-archive-empty" role="status"><strong>正在读取物流统计…</strong></div>}
        {state.status === 'error' && <div className="inline-alert" role="alert">{state.message}<button type="button" onClick={() => setRetry((value) => value + 1)}>重试</button></div>}
        {state.status === 'ready' && <>
          <dl className="inventory-count-summary-grid" aria-label="物流统计摘要">
            <div><dt>运单记录</dt><dd>{state.data.totalRecords}</dd></div>
            <div><dt>统计分组</dt><dd>{state.data.totalElements}</dd></div>
            <div><dt>当前页分组</dt><dd>{state.data.items.length}</dd></div>
            <div><dt>统计维度</dt><dd>{dimensionLabel}</dd></div>
          </dl>
          <div className="warehouse-archive-table-wrap">
            <table aria-label="物流统计结果">
              <thead><tr><th>{dimensionLabel}</th><th>运单记录数</th><th>已保存跟踪状态</th><th>操作</th></tr></thead>
              <tbody>{state.data.items.length === 0
                ? <tr><td colSpan={4}><div className="warehouse-archive-empty" role="status"><strong>没有符合条件的物流统计</strong><span>只有已保存主运单号或备用运单号的订单会纳入统计。</span></div></td></tr>
                : state.data.items.map((group) => <tr key={group.groupValue ?? '__missing__'}>
                  <td><strong>{group.groupValue ?? '未记录'}</strong></td>
                  <td>{group.recordCount}</td>
                  <td>{group.statuses.map((status) => <span className="cell-secondary" key={status.status ?? '__missing__'}>{statusLabel(status.status)} {status.recordCount}</span>)}</td>
                  <td>{group.groupValue
                    ? <button className="text-button" type="button" onClick={() => router.history.push(trackingUrl(query, group))}>查看相关明细</button>
                    : <span className="muted-cell">无可用筛选条件</span>}</td>
                </tr>)}</tbody>
            </table>
          </div>
          <div className="procurement-plan-table-footer">
            <span>共 {state.data.totalElements} 个分组</span>
            <label>每页<select aria-label="物流统计每页分组数" value={query.size} onChange={(event) => navigate({ ...query, page: 0, size: Number(event.target.value) })}>{PAGE_SIZES.map((size) => <option key={size} value={size}>{size} 个</option>)}</select></label>
            <div className="pagination"><button type="button" disabled={query.page === 0} onClick={() => navigate({ ...query, page: query.page - 1 })}>上一页</button><span>第 {query.page + 1} / {Math.max(state.data.totalPages, 1)} 页</span><button type="button" disabled={query.page + 1 >= state.data.totalPages} onClick={() => navigate({ ...query, page: query.page + 1 })}>下一页</button></div>
          </div>
        </>}
      </section>
    </main>
  )
}
