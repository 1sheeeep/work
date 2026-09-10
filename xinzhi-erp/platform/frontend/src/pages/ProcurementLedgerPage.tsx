import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useRouter, useRouterState } from '@tanstack/react-router'
import { ApiError } from '../api/client'
import {
  procurementReceiptApi,
  type ProcurementReceiptPage,
  type ProcurementReceiptSort,
} from '../modules/procurementReceiptApi'
import { toProcurementOrderDetailUrl } from '../modules/procurementOrderRoutes'
import './WarehouseArchiveShells.css'

export type ProcurementLedgerDimension = 'INBOUND_TIME' | 'INVENTORY_SKU' | 'PURCHASE_ORDER'
export type ProcurementLedgerQuery = {
  dimension: ProcurementLedgerDimension
  startDate: string
  endDate: string
  purchaseKeyword: string
  supplierKeyword: string
  showProductDetails: boolean
  page: number
  size: number
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; data: ProcurementReceiptPage }
  | { status: 'error'; message: string }

const PAGE_SIZES = [25, 50, 100] as const

function boundedText(value: string | null, maximum: number) {
  return (value ?? '').trim().slice(0, maximum)
}

function dateValue(value: string | null) {
  const candidate = boundedText(value, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate)
    && !Number.isNaN(Date.parse(`${candidate}T00:00:00Z`)) ? candidate : ''
}

function integer(value: string | null, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback
}

function dimension(value: string | null): ProcurementLedgerDimension {
  return value === 'INVENTORY_SKU' || value === 'PURCHASE_ORDER' ? value : 'INBOUND_TIME'
}

function sort(value: ProcurementLedgerDimension): ProcurementReceiptSort {
  if (value === 'INVENTORY_SKU') return 'SKU_CODE'
  if (value === 'PURCHASE_ORDER') return 'PURCHASE_NO'
  return 'RECEIVED_AT'
}

function startInstant(value: string) {
  return value ? `${value}T00:00:00.000Z` : undefined
}

function endInstant(value: string) {
  return value ? `${value}T23:59:59.999Z` : undefined
}

function exportErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 409) {
    return '导出结果超过 10,000 条，请缩小筛选范围后重试。'
  }
  if (error instanceof ApiError && error.status === 403) {
    return '当前账号没有导出采购流水的权限。'
  }
  return '暂时无法导出采购流水，请稍后重试。'
}

export function parseProcurementLedgerQuery(search: string): ProcurementLedgerQuery {
  const params = new URLSearchParams(search)
  return {
    dimension: dimension(params.get('dimension')),
    startDate: dateValue(params.get('startDate')),
    endDate: dateValue(params.get('endDate')),
    purchaseKeyword: boundedText(params.get('purchaseKeyword'), 120),
    supplierKeyword: boundedText(params.get('supplierKeyword'), 120),
    showProductDetails: params.get('showProductDetails') === 'true',
    page: integer(params.get('page'), 0, 0, 9_999),
    size: integer(params.get('size'), 50, 1, 200),
  }
}

export function toProcurementLedgerUrl(query: Partial<ProcurementLedgerQuery>) {
  const params = new URLSearchParams()
  const selectedDimension = dimension(query.dimension ?? '')
  if (selectedDimension !== 'INBOUND_TIME') params.set('dimension', selectedDimension)
  const startDate = dateValue(query.startDate ?? '')
  const endDate = dateValue(query.endDate ?? '')
  const purchaseKeyword = boundedText(query.purchaseKeyword ?? '', 120)
  const supplierKeyword = boundedText(query.supplierKeyword ?? '', 120)
  if (startDate) params.set('startDate', startDate)
  if (endDate) params.set('endDate', endDate)
  if (purchaseKeyword) params.set('purchaseKeyword', purchaseKeyword)
  if (supplierKeyword) params.set('supplierKeyword', supplierKeyword)
  if (query.showProductDetails) params.set('showProductDetails', 'true')
  if (query.page && query.page > 0) params.set('page', String(query.page))
  if (query.size && query.size !== 50) params.set('size', String(query.size))
  const serialized = params.toString()
  return serialized ? `/procurement/statistics/ledger?${serialized}` : '/procurement/statistics/ledger'
}

export function ProcurementLedgerPage() {
  const router = useRouter()
  const search = useRouterState({ select: (state) => state.location.searchStr })
  const query = useMemo(() => parseProcurementLedgerQuery(search), [search])
  const [list, setList] = useState<LoadState>({ status: 'loading' })
  const [refreshKey, setRefreshKey] = useState(0)
  const [filterError, setFilterError] = useState<string>()
  const [exporting, setExporting] = useState(false)
  const [exportFeedback, setExportFeedback] = useState<{
    kind: 'success' | 'error'
    message: string
    queryKey: string
  }>()

  useEffect(() => {
    const controller = new AbortController()
    setList({ status: 'loading' })
    void procurementReceiptApi.list({
      sort: sort(query.dimension),
      purchaseKeyword: query.purchaseKeyword,
      supplierKeyword: query.supplierKeyword,
      receivedFrom: startInstant(query.startDate),
      receivedTo: endInstant(query.endDate),
      page: query.page,
      size: query.size,
      signal: controller.signal,
    }).then(
      (data) => {
        const lastPage = Math.max(data.totalPages - 1, 0)
        if (query.page > lastPage) { router.history.push(toProcurementLedgerUrl({ ...query, page: lastPage })); return }
        setList({ status: 'ready', data })
      },
      (cause) => {
        if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
          setList({ status: 'error', message: '暂时无法读取采购收货台账，请稍后重试。' })
        }
      },
    )
    return () => controller.abort()
  }, [query, refreshKey])

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
    router.history.push(toProcurementLedgerUrl({
      dimension: dimension(String(data.get('dimension') ?? '')),
      startDate,
      endDate,
      purchaseKeyword: String(data.get('purchaseKeyword') ?? ''),
      supplierKeyword: String(data.get('supplierKeyword') ?? ''),
      showProductDetails: data.get('showProductDetails') === 'on',
      page: 0,
      size: query.size,
    }))
  }

  const exportQueryKey = toProcurementLedgerUrl(query)
  const exportCurrentResult = async () => {
    if (exporting || list.status !== 'ready'
      || list.data.totalElements === 0) return
    const queryKey = exportQueryKey
    setExporting(true)
    setExportFeedback(undefined)
    try {
      const result = await procurementReceiptApi.exportLedgerCsv({
        sort: sort(query.dimension),
        purchaseKeyword: query.purchaseKeyword || undefined,
        supplierKeyword: query.supplierKeyword || undefined,
        receivedFrom: startInstant(query.startDate),
        receivedTo: endInstant(query.endDate),
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
        message: `已导出 ${result.rowCount} 条采购流水。`,
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

  return <main className="warehouse-archive-page" aria-labelledby="procurement-ledger-title">
    <header className="warehouse-archive-heading">
      <div>
        <p className="eyebrow">供应链 / 数据统计</p>
        <h1 id="procurement-ledger-title">采购流水</h1>
        <p>查询已经真实签收入库的采购记录与对应库存事件。</p>
      </div>
    </header>
    <section className="warehouse-archive-card" aria-label="采购流水筛选与结果">
      <form className="warehouse-archive-filters procurement-plan-filters" key={toProcurementLedgerUrl(query)} onSubmit={submit}>
        <fieldset className="procurement-plan-search-fields">
          <legend>排序维度</legend>
          <div>
            <label><input type="radio" name="dimension" value="INBOUND_TIME" defaultChecked={query.dimension === 'INBOUND_TIME'} />按入库时间</label>
            <label><input type="radio" name="dimension" value="INVENTORY_SKU" defaultChecked={query.dimension === 'INVENTORY_SKU'} />按库存 SKU</label>
            <label><input type="radio" name="dimension" value="PURCHASE_ORDER" defaultChecked={query.dimension === 'PURCHASE_ORDER'} />按采购单号</label>
          </div>
        </fieldset>
        <label>起始日期<input type="date" name="startDate" defaultValue={query.startDate} /></label>
        <label>截止日期<input type="date" name="endDate" defaultValue={query.endDate} /></label>
        <label>采购单 / 计划号<input name="purchaseKeyword" defaultValue={query.purchaseKeyword} maxLength={120} placeholder="采购单号或计划号" /></label>
        <label>供应商关键字<input name="supplierKeyword" defaultValue={query.supplierKeyword} maxLength={120} placeholder="供应商编码或名称" /></label>
        <label className="warehouse-archive-checkbox"><input type="checkbox" name="showProductDetails" defaultChecked={query.showProductDetails} />显示商品详情</label>
        <div className="warehouse-archive-filter-actions">
          <button className="is-primary" type="submit">搜索</button>
          <button type="button" onClick={() => router.history.push('/procurement/statistics/ledger')}>重置</button>
          <button type="button" onClick={() => setRefreshKey((value) => value + 1)}>刷新</button>
        </div>
      </form>
      {filterError && <div className="inline-alert" role="alert">{filterError}</div>}
      <div className="warehouse-processing-formula" role="note">
        <strong>事实口径</strong>
        <span>每行对应一次成功签收入库及其库存事件；库存余额为该事件过账后的仓库级余额，不计算金额、质检结果或异常结论。</span>
      </div>
      <div className="warehouse-archive-actions">
        <button type="button" disabled={exporting || list.status !== 'ready' || list.data.totalElements === 0} onClick={() => void exportCurrentResult()}>{exporting ? '正在导出…' : '导出筛选结果'}</button>
      </div>
      {exportFeedback?.queryKey === exportQueryKey && <p className={`warehouse-export-feedback is-${exportFeedback.kind}`} role={exportFeedback.kind === 'error' ? 'alert' : 'status'}>{exportFeedback.message}</p>}
      {list.status === 'loading' && <div className="warehouse-archive-empty" role="status"><strong>正在读取采购流水…</strong></div>}
      {list.status === 'error' && <div className="inline-alert" role="alert">{list.message}<button type="button" onClick={() => setRefreshKey((value) => value + 1)}>重试</button></div>}
      {list.status === 'ready' && <>
        <div className="warehouse-archive-table-wrap">
          <table aria-label="采购收货流水">
            <thead><tr><th>入库时间</th><th>采购单 / 计划</th><th>供应商</th><th>库存 SKU</th>{query.showProductDetails && <th>商品详情</th>}<th>仓库 / 库位</th><th>本次入库</th><th>入库后库存</th><th>库存事件</th><th>操作人</th><th>操作</th></tr></thead>
            <tbody>{list.data.items.length === 0
              ? <tr><td colSpan={query.showProductDetails ? 11 : 10}><div className="warehouse-archive-empty" role="status"><strong>暂无采购收货流水</strong><span>完成采购签收入库后，记录会自动出现在这里。</span></div></td></tr>
              : list.data.items.map((receipt) => <tr key={receipt.receiptId}>
                <td><time dateTime={receipt.receivedAt}>{new Date(receipt.receivedAt).toLocaleString()}</time></td>
                <td>{receipt.purchaseNo}<br /><small>{receipt.planNo}</small></td>
                <td>{receipt.supplierCode} · {receipt.supplierName}</td>
                <td>{receipt.skuCode}</td>
                {query.showProductDetails && <td>{receipt.skuName}{receipt.skuVariant ? ` · ${receipt.skuVariant}` : ''}</td>}
                <td>{receipt.warehouseCode} · {receipt.warehouseName}<br /><small>{receipt.locationCode} · {receipt.locationName}</small></td>
                <td>{receipt.quantity}</td><td>{receipt.inventoryBalanceAfter}</td>
                <td>#{receipt.inventoryLedgerSequence}<br /><small>{receipt.inventoryEventId}</small></td>
                <td>{receipt.receivedByDisplayName}</td><td><button className="text-button" type="button" onClick={() => router.history.push(toProcurementOrderDetailUrl(receipt.purchaseOrderId))}>采购单详情</button></td>
              </tr>)}</tbody>
          </table>
        </div>
        <div className="procurement-plan-table-footer">
          <span>共 {list.data.totalElements} 条</span>
          <label>每页<select value={query.size} onChange={(event) => router.history.push(toProcurementLedgerUrl({ ...query, page: 0, size: Number(event.target.value) }))}>{PAGE_SIZES.map((size) => <option key={size} value={size}>{size} 条</option>)}</select></label>
          <div className="pagination"><button type="button" disabled={query.page === 0} onClick={() => router.history.push(toProcurementLedgerUrl({ ...query, page: query.page - 1 }))}>上一页</button><span>第 {query.page + 1} / {Math.max(list.data.totalPages, 1)} 页</span><button type="button" disabled={query.page + 1 >= list.data.totalPages} onClick={() => router.history.push(toProcurementLedgerUrl({ ...query, page: query.page + 1 }))}>下一页</button></div>
        </div>
      </>}
    </section>
  </main>
}
