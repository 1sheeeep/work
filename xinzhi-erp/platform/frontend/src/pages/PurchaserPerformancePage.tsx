import { useRouter, useRouterState } from '@tanstack/react-router'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { ApiError } from '../api/client'
import {
  purchaserStatisticsApi,
  type PurchaserStatisticsGranularity,
  type PurchaserStatisticsPage,
} from '../modules/purchaserStatisticsApi'
import './WarehouseArchiveShells.css'

const DEFAULT_SIZE = 25
const PAGE_SIZES = [25, 50, 100] as const

export type PurchaserPerformanceQuery = {
  granularity: PurchaserStatisticsGranularity
  purchaser: string
  startDate: string
  endDate: string
  page: number
  size: number
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; data: PurchaserStatisticsPage }
  | { status: 'error'; message: string }

function boundedText(value: string | null, maximum = 100) {
  return (value ?? '').trim().slice(0, maximum)
}

function dateValue(value: string | null) {
  const candidate = boundedText(value, 10)
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(candidate)
  if (!match) return ''
  const parsed = new Date(Date.UTC(
    Number(match[1]), Number(match[2]) - 1, Number(match[3]),
  ))
  return parsed.getUTCFullYear() === Number(match[1])
    && parsed.getUTCMonth() === Number(match[2]) - 1
    && parsed.getUTCDate() === Number(match[3])
    ? candidate
    : ''
}

function granularity(
  value: string | null,
): PurchaserStatisticsGranularity {
  return value === 'MONTH' ? 'MONTH' : 'DAY'
}

function boundedInteger(
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

function dayBoundary(value: string, nextDay = false) {
  if (!value) return undefined
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(
    year, month - 1, day + (nextDay ? 1 : 0),
  )).toISOString()
}

export function parsePurchaserPerformanceQuery(
  search: string,
): PurchaserPerformanceQuery {
  const params = new URLSearchParams(search)
  return {
    granularity: granularity(params.get('granularity')),
    purchaser: boundedText(params.get('purchaser')),
    startDate: dateValue(params.get('startDate')),
    endDate: dateValue(params.get('endDate')),
    page: boundedInteger(params.get('page'), 0, 0, 9_999),
    size: boundedInteger(params.get('size'), DEFAULT_SIZE, 1, 100),
  }
}

export function toPurchaserPerformanceUrl(
  query: Partial<PurchaserPerformanceQuery>,
) {
  const params = new URLSearchParams()
  if (query.granularity === 'MONTH') params.set('granularity', 'MONTH')
  const purchaser = boundedText(query.purchaser ?? '')
  const startDate = dateValue(query.startDate ?? '')
  const endDate = dateValue(query.endDate ?? '')
  if (purchaser) params.set('purchaser', purchaser)
  if (startDate) params.set('startDate', startDate)
  if (endDate) params.set('endDate', endDate)
  if (query.page && query.page > 0) params.set('page', String(query.page))
  if (query.size && query.size !== DEFAULT_SIZE) {
    params.set('size', String(query.size))
  }
  const serialized = params.toString()
  return serialized
    ? `/procurement/statistics/purchaser-performance?${serialized}`
    : '/procurement/statistics/purchaser-performance'
}

function periodLabel(value: string, valueGranularity: PurchaserStatisticsGranularity) {
  return valueGranularity === 'MONTH' ? value.slice(0, 7) : value
}

function exportErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 409) {
    return '导出结果超过 10,000 个统计分组，请缩小筛选范围后重试。'
  }
  if (error instanceof ApiError && error.status === 403) {
    return '当前账号没有导出采购员业务统计的权限。'
  }
  return '暂时无法导出采购员业务统计，请稍后重试。'
}

export function PurchaserPerformancePage() {
  const router = useRouter()
  const search = useRouterState({ select: (state) => state.location.searchStr })
  const query = useMemo(
    () => parsePurchaserPerformanceQuery(search),
    [search],
  )
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [retry, setRetry] = useState(0)
  const [filterError, setFilterError] = useState<string>()
  const [exporting, setExporting] = useState(false)
  const [exportFeedback, setExportFeedback] = useState<{
    kind: 'success' | 'error'
    message: string
    queryKey: string
  }>()

  const navigate = (next: Partial<PurchaserPerformanceQuery>) => {
    router.history.push(toPurchaserPerformanceUrl(next))
  }

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })
    void purchaserStatisticsApi.summarize({
      granularity: query.granularity,
      purchaser: query.purchaser || undefined,
      orderedFrom: dayBoundary(query.startDate),
      orderedToExclusive: dayBoundary(query.endDate, true),
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
          message: '暂时无法读取采购员业务统计，请稍后重试。',
        })
      },
    )
    return () => controller.abort()
  }, [query, retry])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const startDate = dateValue(String(data.get('startDate') ?? ''))
    const endDate = dateValue(String(data.get('endDate') ?? ''))
    if (startDate && endDate && startDate > endDate) {
      setFilterError('起始日期不能晚于截止日期。')
      return
    }
    setFilterError(undefined)
    navigate({
      granularity: granularity(String(data.get('granularity') ?? 'DAY')),
      purchaser: boundedText(String(data.get('purchaser') ?? '')),
      startDate,
      endDate,
      page: 0,
      size: query.size,
    })
  }

  const exportQueryKey = toPurchaserPerformanceUrl(query)
  const exportCurrentResult = async () => {
    if (exporting || state.status !== 'ready'
      || state.data.totalElements === 0) return
    const queryKey = exportQueryKey
    setExporting(true)
    setExportFeedback(undefined)
    try {
      const result = await purchaserStatisticsApi.exportCsv({
        granularity: query.granularity,
        purchaser: query.purchaser || undefined,
        orderedFrom: dayBoundary(query.startDate),
        orderedToExclusive: dayBoundary(query.endDate, true),
      })
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
        message: `已导出 ${result.rowCount} 条采购员业务统计。`,
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
    <main className="warehouse-archive-page" aria-labelledby="purchaser-performance-title">
      <header className="warehouse-archive-heading">
        <div>
          <p className="eyebrow">供应链 / 数据统计</p>
          <h1 id="purchaser-performance-title">采购员绩效</h1>
          <p>按天或月查看采购员有效采购单的业务数量与收货进度。</p>
        </div>
      </header>

      <section className="warehouse-archive-card" aria-label="采购员业务统计筛选与结果">
        <div className="warehouse-processing-formula" role="note">
          <strong>统计口径</strong>
          <span>按采购单创建时间（UTC）和下单时保存的采购员名称汇总，已驳回采购单不参与统计；只统计采购单数量、采购数量和实际收货数量。页面不计算采购金额、退货、准时率、缺货关联或绩效评分。</span>
        </div>

        <form className="warehouse-archive-filters" key={toPurchaserPerformanceUrl(query)} onSubmit={submit}>
          <fieldset className="warehouse-archive-radio-group">
            <legend>统计粒度</legend>
            <label><input type="radio" name="granularity" value="DAY" defaultChecked={query.granularity === 'DAY'} />天</label>
            <label><input type="radio" name="granularity" value="MONTH" defaultChecked={query.granularity === 'MONTH'} />月</label>
          </fieldset>
          <label>采购员<input name="purchaser" defaultValue={query.purchaser} maxLength={100} placeholder="全部采购员" /></label>
          <label>起始日期<input type="date" name="startDate" defaultValue={query.startDate} /></label>
          <label>截止日期<input type="date" name="endDate" defaultValue={query.endDate} /></label>
          <div className="warehouse-archive-filter-actions">
            <button className="is-primary" type="submit">查询</button>
            <button type="button" onClick={() => navigate({ size: query.size })}>重置</button>
            <button type="button" onClick={() => setRetry((value) => value + 1)}>刷新</button>
          </div>
        </form>
        {filterError && <div className="inline-alert" role="alert">{filterError}</div>}
        <div className="warehouse-archive-actions">
          <button type="button" disabled={exporting || state.status !== 'ready' || state.data.totalElements === 0} onClick={() => void exportCurrentResult()}>{exporting ? '正在导出…' : '导出筛选结果'}</button>
        </div>
        {exportFeedback?.queryKey === exportQueryKey && <p className={`warehouse-export-feedback is-${exportFeedback.kind}`} role={exportFeedback.kind === 'error' ? 'alert' : 'status'}>{exportFeedback.message}</p>}

        {state.status === 'loading' && <div className="warehouse-archive-empty" role="status"><strong>正在读取采购员业务统计…</strong></div>}
        {state.status === 'error' && <div className="inline-alert" role="alert">{state.message}<button type="button" onClick={() => setRetry((value) => value + 1)}>重试</button></div>}
        {state.status === 'ready' && <>
          <dl className="inventory-count-summary-grid" aria-label="采购员业务统计摘要">
            <div><dt>采购单</dt><dd>{state.data.totalOrders}</dd></div>
            <div><dt>采购数量</dt><dd>{state.data.totalOrderedQuantity}</dd></div>
            <div><dt>已收数量</dt><dd>{state.data.totalReceivedQuantity}</dd></div>
            <div><dt>待收数量</dt><dd>{state.data.totalOutstandingQuantity}</dd></div>
          </dl>
          <div className="warehouse-archive-table-wrap">
            <table aria-label="采购员业务统计结果">
              <thead><tr><th>统计期间（UTC）</th><th>采购员名称快照</th><th>采购单数</th><th>采购 / 已收 / 待收数量</th><th>待审核 / 待收货 / 部分收货 / 已收货</th></tr></thead>
              <tbody>{state.data.items.length === 0
                ? <tr><td colSpan={5}><div className="warehouse-archive-empty" role="status"><strong>没有符合条件的采购员统计</strong><span>采购单创建后会按保存的下单人名称进入统计。</span></div></td></tr>
                : state.data.items.map((item) => <tr key={`${item.periodStart}:${item.purchaserDisplayName}`}>
                  <td><time dateTime={item.periodStart}>{periodLabel(item.periodStart, query.granularity)}</time></td>
                  <td>{item.purchaserDisplayName}</td>
                  <td>{item.orderCount}</td>
                  <td>{item.orderedQuantity} / {item.receivedQuantity} / {item.outstandingQuantity}</td>
                  <td>{item.newOrderCount} / {item.approvedOrderCount} / {item.partiallyReceivedOrderCount} / {item.receivedOrderCount}</td>
                </tr>)}</tbody>
            </table>
          </div>
          <div className="procurement-plan-table-footer">
            <span>共 {state.data.totalElements} 个统计分组</span>
            <label>每页<select aria-label="采购员业务统计每页分组数" value={query.size} onChange={(event) => navigate({ ...query, page: 0, size: Number(event.target.value) })}>{PAGE_SIZES.map((size) => <option key={size} value={size}>{size} 个</option>)}</select></label>
            <div className="pagination"><button type="button" disabled={query.page === 0} onClick={() => navigate({ ...query, page: query.page - 1 })}>上一页</button><span>第 {query.page + 1} / {Math.max(state.data.totalPages, 1)} 页</span><button type="button" disabled={query.page + 1 >= state.data.totalPages} onClick={() => navigate({ ...query, page: query.page + 1 })}>下一页</button></div>
          </div>
        </>}
      </section>
    </main>
  )
}
