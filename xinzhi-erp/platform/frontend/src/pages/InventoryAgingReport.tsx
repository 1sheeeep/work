import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { ApiError } from '../api/client'
import {
  inventoryAgingReportApi,
  type InventoryAgingReportItem,
  type InventoryAgingReportPage,
} from '../modules/inventoryAgingReportApi'
import {
  type Warehouse,
  warehouseCenterApi,
} from '../modules/warehouseCenterApi'
import './InventoryAgingReport.css'

const PAGE_SIZE = 50
const WAREHOUSE_OPTION_LIMIT = 200

function localDateValue(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function number(value: number) {
  return value.toLocaleString('zh-CN')
}

function errorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 403) {
    return '当前账号没有读取库存库龄的权限。'
  }
  if (error instanceof ApiError && error.status === 400) {
    return '查询条件无效，请检查截止日期后重试。'
  }
  return '库存库龄加载失败，请稍后重试。'
}

function exportErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 409) {
    return '导出结果超过 10,000 条，请缩小仓库或搜索范围后重试。'
  }
  if (error instanceof ApiError && error.status === 403) {
    return '当前账号没有导出库存库龄的权限。'
  }
  return '库存库龄导出失败，请稍后重试。'
}

function agingStatus(item: InventoryAgingReportItem) {
  if (item.maximumAgeDays > 365) return { label: '长期积压', tone: 'danger' }
  if (item.maximumAgeDays > 90) return { label: '需要关注', tone: 'warning' }
  return { label: '周转正常', tone: 'success' }
}

export function InventoryAgingReport({
  keyword,
  cutoff,
  warehouseId,
  onFilter,
  onReset,
}: {
  keyword: string
  cutoff?: string
  warehouseId?: string
  onFilter: (keyword: string, cutoff: string, warehouseId?: string) => void
  onReset: () => void
}) {
  const defaultCutoff = useMemo(() => localDateValue(new Date()), [])
  const effectiveKeyword = keyword.trim().slice(0, 100)
  const effectiveCutoff = cutoff || defaultCutoff
  const [page, setPage] = useState(0)
  const [result, setResult] = useState<InventoryAgingReportPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [warehouseError, setWarehouseError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportFeedback, setExportFeedback] = useState<{
    kind: 'success' | 'error'
    message: string
    queryKey: string
  } | null>(null)

  useEffect(() => {
    let active = true
    warehouseCenterApi.listWarehouses({
      status: 'ACTIVE',
      page: 0,
      size: WAREHOUSE_OPTION_LIMIT,
    }).then(
      (response) => {
        if (!active) return
        setWarehouses(response.items)
        setWarehouseError(response.totalPages > 1
          ? '仓库数量超过 200 个，请先使用全部仓库查看报表。'
          : null)
      },
      () => {
        if (!active) return
        setWarehouses([])
        setWarehouseError('仓库选项暂时无法加载，仍可查看全部仓库。')
      },
    )
    return () => { active = false }
  }, [])

  useEffect(() => {
    setPage(0)
    setResult(null)
  }, [effectiveKeyword, effectiveCutoff, warehouseId])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    inventoryAgingReportApi.summarize({
      cutoffDate: effectiveCutoff,
      warehouseId,
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
  }, [effectiveKeyword, effectiveCutoff, warehouseId, page, reload])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    onFilter(
      String(data.get('inventoryAgingKeyword') ?? '').trim().slice(0, 100),
      String(data.get('inventoryAgingCutoff') ?? ''),
      String(data.get('inventoryAgingWarehouseId') ?? '') || undefined,
    )
  }
  const queryKey = `${effectiveCutoff}:${warehouseId ?? ''}:${effectiveKeyword}`
  const exportCurrentResult = async () => {
    if (exporting || loading || !result || result.totalElements === 0) return
    setExporting(true)
    setExportFeedback(null)
    try {
      const exported = await inventoryAgingReportApi.exportCsv({
        cutoffDate: effectiveCutoff,
        warehouseId,
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
        message: `已导出 ${exported.rowCount} 条库存库龄数据。`,
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
    <div className="inventory-aging-report">
      <form
        className="inventory-aging-filters"
        key={`${effectiveCutoff}:${warehouseId ?? ''}:${effectiveKeyword}`}
        onSubmit={submit}
      >
        <label>
          截止日期
          <input
            aria-label="库龄截止日期"
            name="inventoryAgingCutoff"
            type="date"
            defaultValue={effectiveCutoff}
            required
          />
        </label>
        <label>
          仓库
          <select
            aria-label="库龄仓库"
            name="inventoryAgingWarehouseId"
            defaultValue={warehouseId ?? ''}
          >
            <option value="">全部仓库</option>
            {warehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.businessCode} · {warehouse.name}
              </option>
            ))}
          </select>
        </label>
        <label className="inventory-aging-keyword">
          SKU / 商品 / 仓库
          <input
            aria-label="库龄搜索内容"
            name="inventoryAgingKeyword"
            defaultValue={effectiveKeyword}
            maxLength={100}
            placeholder="输入编号或名称"
          />
        </label>
        <div className="inventory-aging-filter-actions">
          <button className="button button-primary" type="submit">查询</button>
          <button className="button" type="button" onClick={onReset}>重置</button>
        </div>
      </form>

      {warehouseError ? <p className="inventory-aging-option-note" role="note">{warehouseError}</p> : null}
      <div className="inventory-aging-explanation" role="note">
        <strong>统计口径</strong>
        <span>按先进先出计算截止日期仍在库的数量；出库优先消耗最早入库批次，报表不包含库存成本。</span>
      </div>

      <div className="inventory-aging-toolbar">
        <span>{result ? `共 ${number(result.totalElements)} 条` : '正在准备数据'}</span>
        <button
          className="button"
          type="button"
          disabled={exporting || loading || !result || result.totalElements === 0}
          onClick={() => void exportCurrentResult()}
        >
          {exporting ? '正在导出…' : '导出筛选结果'}
        </button>
      </div>
      {exportFeedback?.queryKey === queryKey ? (
        <p
          className={`inventory-aging-feedback is-${exportFeedback.kind}`}
          role={exportFeedback.kind === 'error' ? 'alert' : 'status'}
        >
          {exportFeedback.message}
        </p>
      ) : null}

      {result ? (
        <dl className="inventory-aging-summary" aria-label="库存库龄汇总">
          <div><dt>库存总数</dt><dd>{number(result.totalQuantity)}</dd></div>
          <div><dt>0–30 天</dt><dd>{number(result.age0To30Quantity)}</dd></div>
          <div><dt>31–60 天</dt><dd>{number(result.age31To60Quantity)}</dd></div>
          <div><dt>61–90 天</dt><dd>{number(result.age61To90Quantity)}</dd></div>
          <div><dt>91–365 天</dt><dd>{number(result.age91To365Quantity)}</dd></div>
          <div className="is-risk"><dt>365 天以上</dt><dd>{number(result.ageOver365Quantity)}</dd></div>
        </dl>
      ) : null}

      {error ? (
        <div className="compact-empty-state" role="alert">
          <strong>库龄报表加载失败</strong>
          <span>{error}</span>
          <button className="button" type="button" onClick={() => setReload((value) => value + 1)}>
            重新加载
          </button>
        </div>
      ) : (
        <div className="inventory-aging-table-wrap" aria-busy={loading}>
          <table aria-label="库存库龄明细">
            <thead>
              <tr>
                <th scope="col">库存 SKU</th>
                <th scope="col">商品名称</th>
                <th scope="col">仓库</th>
                <th scope="col">最早在库日期</th>
                <th scope="col">最长库龄</th>
                <th scope="col">库龄状态</th>
                <th scope="col" className="inventory-aging-number">库存总数</th>
                <th scope="col" className="inventory-aging-number">0–30 天</th>
                <th scope="col" className="inventory-aging-number">31–60 天</th>
                <th scope="col" className="inventory-aging-number">61–90 天</th>
                <th scope="col" className="inventory-aging-number">91–365 天</th>
                <th scope="col" className="inventory-aging-number">365 天以上</th>
              </tr>
            </thead>
            <tbody>
              {loading && !result ? (
                <tr><td colSpan={12}><div className="compact-empty-state" role="status">正在计算库存库龄…</div></td></tr>
              ) : null}
              {!loading && result?.items.length === 0 ? (
                <tr><td colSpan={12}><div className="compact-empty-state" role="status"><strong>暂无符合条件的在库库存</strong><span>可调整截止日期、仓库或搜索内容后重新查询。</span></div></td></tr>
              ) : null}
              {result?.items.map((item) => {
                const status = agingStatus(item)
                return (
                  <tr key={`${item.skuId}:${item.warehouseId}`}>
                    <td><strong>{item.skuBusinessCode}</strong></td>
                    <td>{item.skuName}</td>
                    <td><strong>{item.warehouseBusinessCode}</strong><small>{item.warehouseName}</small></td>
                    <td>{item.oldestInventoryDate}</td>
                    <td>{number(item.maximumAgeDays)} 天</td>
                    <td><span className={`inventory-aging-status is-${status.tone}`}>{status.label}</span></td>
                    <td className="inventory-aging-number"><strong>{number(item.totalQuantity)}</strong></td>
                    <td className="inventory-aging-number">{number(item.age0To30Quantity)}</td>
                    <td className="inventory-aging-number">{number(item.age31To60Quantity)}</td>
                    <td className="inventory-aging-number">{number(item.age61To90Quantity)}</td>
                    <td className="inventory-aging-number">{number(item.age91To365Quantity)}</td>
                    <td className="inventory-aging-number is-risk">{number(item.ageOver365Quantity)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {result && result.totalElements > 0 ? (
        <nav className="inventory-aging-pagination" aria-label="库存库龄分页">
          <span>第 {result.page + 1} / {result.totalPages} 页</span>
          <div>
            <button className="button" type="button" disabled={loading || page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>上一页</button>
            <button className="button" type="button" disabled={loading || page + 1 >= result.totalPages} onClick={() => setPage((value) => value + 1)}>下一页</button>
          </div>
        </nav>
      ) : null}
    </div>
  )
}
