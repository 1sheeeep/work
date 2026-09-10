import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { ApiError } from '../api/client'
import {
  inventoryPeriodReportApi,
  type InventoryPeriodReportPage,
} from '../modules/inventoryPeriodReportApi'
import './InventoryPeriodReport.css'

const PAGE_SIZE = 50

function localDateValue(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function defaultInventoryPeriod(today = new Date()) {
  return {
    start: localDateValue(new Date(today.getFullYear(), today.getMonth(), 1)),
    end: localDateValue(today),
  }
}

function number(value: number) {
  return value.toLocaleString('zh-CN')
}

function errorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 403) {
    return '当前账号没有读取库存报表的权限。'
  }
  if (error instanceof ApiError && error.status === 400) {
    return '查询条件无效，请检查日期范围后重试。'
  }
  return '库存期间报表加载失败，请稍后重试。'
}

function exportErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 409) {
    return '导出结果超过 10,000 条，请缩小日期或搜索范围后重试。'
  }
  if (error instanceof ApiError && error.status === 403) {
    return '当前账号没有导出库存报表的权限。'
  }
  if (error instanceof ApiError && error.status === 400) {
    return '导出条件无效，请检查日期范围后重试。'
  }
  return '库存期间报表导出失败，请稍后重试。'
}

export function InventoryPeriodReport({
  start,
  end,
  keyword,
  onFilter,
  onReset,
}: {
  start?: string
  end?: string
  keyword: string
  onFilter: (keyword: string, start: string, end: string) => void
  onReset: () => void
}) {
  const defaults = useMemo(() => defaultInventoryPeriod(), [])
  const effectiveStart = start || defaults.start
  const effectiveEnd = end || defaults.end
  const effectiveKeyword = keyword.trim().slice(0, 100)
  const [page, setPage] = useState(0)
  const [result, setResult] = useState<InventoryPeriodReportPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [exportFeedback, setExportFeedback] = useState<{
    kind: 'success' | 'error'
    message: string
    queryKey: string
  } | null>(null)

  useEffect(() => {
    setPage(0)
    setResult(null)
  }, [effectiveStart, effectiveEnd, effectiveKeyword])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    inventoryPeriodReportApi.summarize({
      periodFrom: effectiveStart,
      periodTo: effectiveEnd,
      keyword: effectiveKeyword || undefined,
      page,
      size: PAGE_SIZE,
      signal: controller.signal,
    }).then(
      (next) => {
        setResult(next)
        setLoading(false)
      },
      (reason) => {
        if (controller.signal.aborted) return
        setResult(null)
        setError(errorMessage(reason))
        setLoading(false)
      },
    )
    return () => controller.abort()
  }, [effectiveStart, effectiveEnd, effectiveKeyword, page, reload])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    onFilter(
      String(data.get('inventoryReportKeyword') ?? '').trim().slice(0, 100),
      String(data.get('inventoryReportStart') ?? ''),
      String(data.get('inventoryReportEnd') ?? ''),
    )
  }
  const exportQueryKey = `${effectiveStart}:${effectiveEnd}:${effectiveKeyword}`
  const exportCurrentResult = async () => {
    if (exporting || loading || !result || result.totalElements === 0) return
    const queryKey = exportQueryKey
    setExporting(true)
    setExportFeedback(null)
    try {
      const exported = await inventoryPeriodReportApi.exportCsv({
        periodFrom: effectiveStart,
        periodTo: effectiveEnd,
        keyword: effectiveKeyword || undefined,
      })
      const url = URL.createObjectURL(new Blob(
        [exported.content],
        { type: exported.mediaType },
      ))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = exported.filename
      document.body.append(anchor)
      try {
        anchor.click()
      } finally {
        anchor.remove()
        URL.revokeObjectURL(url)
      }
      setExportFeedback({
        kind: 'success',
        message: `已导出 ${exported.rowCount} 条库存期间数据。`,
        queryKey,
      })
    } catch (reason) {
      setExportFeedback({
        kind: 'error',
        message: exportErrorMessage(reason),
        queryKey,
      })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="inventory-period-report">
      <form
        className="inventory-period-filters"
        key={`${effectiveStart}:${effectiveEnd}:${effectiveKeyword}`}
        onSubmit={submit}
      >
        <label>
          起始日期
          <input
            name="inventoryReportStart"
            type="date"
            defaultValue={effectiveStart}
            max={effectiveEnd}
            required
          />
        </label>
        <label>
          截止日期
          <input
            name="inventoryReportEnd"
            type="date"
            defaultValue={effectiveEnd}
            min={effectiveStart}
            required
          />
        </label>
        <label className="inventory-period-keyword">
          SKU / 商品 / 仓库
          <input
            name="inventoryReportKeyword"
            defaultValue={effectiveKeyword}
            maxLength={100}
            placeholder="输入编号或名称"
          />
        </label>
        <div className="inventory-period-filter-actions">
          <button className="button button-primary" type="submit">
            查询
          </button>
          <button className="button" type="button" onClick={onReset}>
            重置
          </button>
        </div>
      </form>

      <p className="inventory-period-note" role="note">
        统计口径：期初为起始日零点前净变动；期间增加与减少按库存账本变动方向分别汇总；期末为截止日结束时净结存。所有日期按北京时间计算。
      </p>

      <div className="inventory-period-toolbar">
        <button
          className="button"
          type="button"
          disabled={exporting || loading || !result || result.totalElements === 0}
          onClick={() => void exportCurrentResult()}
        >
          {exporting ? '正在导出…' : '导出筛选结果'}
        </button>
      </div>
      {exportFeedback?.queryKey === exportQueryKey ? (
        <p
          className={`inventory-period-feedback is-${exportFeedback.kind}`}
          role={exportFeedback.kind === 'error' ? 'alert' : 'status'}
        >
          {exportFeedback.message}
        </p>
      ) : null}

      {result ? (
        <dl className="inventory-period-summary" aria-label="库存期间汇总">
          <div><dt>期初数量</dt><dd>{number(result.totalOpeningQuantity)}</dd></div>
          <div><dt>期间增加</dt><dd>{number(result.totalIncreasedQuantity)}</dd></div>
          <div><dt>期间减少</dt><dd>{number(result.totalDecreasedQuantity)}</dd></div>
          <div><dt>期末数量</dt><dd>{number(result.totalClosingQuantity)}</dd></div>
        </dl>
      ) : null}

      {error ? (
        <div className="compact-empty-state" role="alert">
          <strong>报表加载失败</strong>
          <span>{error}</span>
          <button className="button" type="button" onClick={() => setReload((value) => value + 1)}>
            重新加载
          </button>
        </div>
      ) : (
        <div className="inventory-period-table-wrap" aria-busy={loading}>
          <table>
            <caption className="sr-only">库存期间报表明细</caption>
            <thead>
              <tr>
                <th scope="col">库存 SKU</th>
                <th scope="col">商品名称</th>
                <th scope="col">仓库</th>
                <th scope="col" className="inventory-period-number">期初</th>
                <th scope="col" className="inventory-period-number">期间增加</th>
                <th scope="col" className="inventory-period-number">期间减少</th>
                <th scope="col" className="inventory-period-number">期末</th>
              </tr>
            </thead>
            <tbody>
              {loading && !result ? (
                <tr><td colSpan={7}><div className="compact-empty-state" role="status">正在加载库存期间报表…</div></td></tr>
              ) : null}
              {!loading && result?.items.length === 0 ? (
                <tr><td colSpan={7}><div className="compact-empty-state" role="status"><strong>暂无符合条件的数据</strong><span>可调整日期或搜索内容后重新查询。</span></div></td></tr>
              ) : null}
              {result?.items.map((item) => (
                <tr key={`${item.skuId}:${item.warehouseId}`}>
                  <td><strong>{item.skuBusinessCode}</strong></td>
                  <td>{item.skuName}</td>
                  <td><strong>{item.warehouseBusinessCode}</strong><span className="inventory-period-subtext">{item.warehouseName}</span></td>
                  <td className="inventory-period-number">{number(item.openingQuantity)}</td>
                  <td className="inventory-period-number">{number(item.increasedQuantity)}</td>
                  <td className="inventory-period-number">{number(item.decreasedQuantity)}</td>
                  <td className="inventory-period-number"><strong>{number(item.closingQuantity)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {result && result.totalElements > 0 ? (
        <nav className="inventory-period-pagination" aria-label="库存期间报表分页">
          <span>共 {number(result.totalElements)} 条，第 {result.page + 1} / {result.totalPages} 页</span>
          <div>
            <button className="button" type="button" disabled={loading || page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>上一页</button>
            <button className="button" type="button" disabled={loading || page + 1 >= result.totalPages} onClick={() => setPage((value) => value + 1)}>下一页</button>
          </div>
        </nav>
      ) : null}
    </div>
  )
}
