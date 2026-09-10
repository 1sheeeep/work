import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useRouter, useRouterState } from '@tanstack/react-router'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { DialogCloseButton } from '../components/DialogCloseButton'
import { procurementOrderApi, type ProcurementOrder, type ProcurementOrderPage } from '../modules/procurementOrderApi'
import { procurementOrderId, toProcurementOrderDetailUrl } from '../modules/procurementOrderRoutes'
import { procurementReceiptApi, type ProcurementReceiptPage } from '../modules/procurementReceiptApi'
import './WarehouseArchiveShells.css'

export type ProcurementReceivingQuery = { code: string; orderId: string; page: number; size: number }
type LoadState = { status: 'loading' } | { status: 'ready'; data: ProcurementOrderPage } | { status: 'error'; message: string }
type ReceiptLoadState = { status: 'loading' } | { status: 'ready'; data: ProcurementReceiptPage } | { status: 'error' }
const statusLabel: Record<ProcurementOrder['status'], string> = { NEW_ORDER: '待审核', APPROVED: '待收货', REJECTED: '已驳回', PARTIALLY_RECEIVED: '部分收货', RECEIVED: '已收货' }
const DEFAULT_SIZE = 50
const PAGE_SIZES = [25, 50, 100] as const

function boundedCode(value: string | null) { return (value ?? '').trim().slice(0, 120) }
function boundedInteger(value: string | null, fallback: number, minimum: number, maximum: number) { const parsed = Number(value); return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback }

export function parseProcurementReceivingQuery(search: string): ProcurementReceivingQuery {
  const params = new URLSearchParams(search)
  return {
    code: boundedCode(params.get('code')),
    orderId: procurementOrderId(params.get('orderId')),
    page: boundedInteger(params.get('page'), 0, 0, 9_999),
    size: boundedInteger(params.get('size'), DEFAULT_SIZE, 1, 200),
  }
}

export function toProcurementReceivingUrl(query: Partial<ProcurementReceivingQuery>) {
  const code = boundedCode(query.code ?? '')
  const params = new URLSearchParams()
  if (code) params.set('code', code)
  const orderId = procurementOrderId(query.orderId)
  if (orderId) params.set('orderId', orderId)
  if (query.page && query.page > 0) params.set('page', String(query.page))
  if (query.size && query.size !== DEFAULT_SIZE) params.set('size', String(query.size))
  const serialized = params.toString()
  return serialized ? `/procurement/receiving?${serialized}` : '/procurement/receiving'
}

export function toProcurementReceiptLedgerUrl(purchaseNo: string) {
  const purchaseKeyword = boundedCode(purchaseNo)
  if (!purchaseKeyword) return '/procurement/statistics/ledger'
  return `/procurement/statistics/ledger?${new URLSearchParams({
    dimension: 'PURCHASE_ORDER',
    purchaseKeyword,
  }).toString()}`
}

function receiptMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 403) return '当前账号没有采购收货权限。'
  if (error instanceof ApiError && error.status === 409) {
    const reason = typeof error.details === 'object' && error.details !== null && 'reason' in error.details ? String((error.details as { reason?: unknown }).reason ?? '') : ''
    if (reason === 'receipt_quantity_exceeds_remaining') return '本次收货数量超过待收数量，请重新填写。'
    if (reason === 'invalid_order_state') return '该采购单已经全部收货，不能再次入库。'
    if (reason === 'idempotency_conflict') return '本次操作已提交，请刷新结果后重试。'
    return '采购单或库存资料已更新，请刷新后重试。'
  }
  return '签收入库暂时失败，请检查网络后重试。'
}

function isReceiptConflict(error: unknown) {
  return error instanceof ApiError && error.status === 409
}

function exportMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 403) return '当前账号没有采购收货导出权限。'
  if (error instanceof ApiError && error.status === 409) return '筛选结果超过 10,000 条，请使用更精确的采购单号后重试。'
  return '暂时无法导出采购收货队列，请检查网络后重试。'
}

function ReceiptHistory({ purchaseOrderId }: { purchaseOrderId: string }) {
  const [history, setHistory] = useState<ReceiptLoadState>({ status: 'loading' })
  const [page, setPage] = useState(0)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setHistory({ status: 'loading' })
    void procurementReceiptApi.forOrder(purchaseOrderId, page, 50, controller.signal).then(
      (data) => setHistory({ status: 'ready', data }),
      (cause) => {
        if (!(cause instanceof DOMException && cause.name === 'AbortError')) setHistory({ status: 'error' })
      },
    )
    return () => controller.abort()
  }, [page, purchaseOrderId, refreshKey])

  return <div className="warehouse-archive-table-wrap">
    <h3>本单收货记录</h3>
    {history.status === 'loading' && <div className="warehouse-archive-empty" role="status"><span>正在读取收货记录…</span></div>}
    {history.status === 'error' && <div className="inline-alert" role="alert">暂时无法读取本单收货记录。<button type="button" onClick={() => setRefreshKey((value) => value + 1)}>重试收货记录</button></div>}
    {history.status === 'ready' && <><table aria-label="本单收货记录">
      <thead><tr><th>入库时间</th><th>本次入库</th><th>入库后库存</th><th>库存事件</th><th>操作人</th></tr></thead>
      <tbody>{history.data.items.length === 0
        ? <tr><td colSpan={5}>暂无收货记录</td></tr>
        : history.data.items.map((receipt) => <tr key={receipt.receiptId}>
          <td><time dateTime={receipt.receivedAt}>{new Date(receipt.receivedAt).toLocaleString()}</time></td>
          <td>{receipt.quantity}</td><td>{receipt.inventoryBalanceAfter}</td>
          <td>#{receipt.inventoryLedgerSequence}</td><td>{receipt.receivedByDisplayName}</td>
        </tr>)}</tbody>
    </table><div className="pagination"><button type="button" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>上一页收货记录</button><span>第 {page + 1} / {Math.max(history.data.totalPages, 1)} 页</span><button type="button" disabled={page + 1 >= history.data.totalPages} onClick={() => setPage((value) => value + 1)}>下一页收货记录</button></div></>}
  </div>
}

export function ProcurementReceivingPage() {
  const router = useRouter()
  const search = useRouterState({ select: (state) => state.location.searchStr })
  const query = useMemo(() => parseProcurementReceivingQuery(search), [search])
  const { hasPermission } = useAuth()
  const canWrite = hasPermission('procurement.write')
  const [list, setList] = useState<LoadState>({ status: 'loading' })
  const [refreshKey, setRefreshKey] = useState(0)
  const [selected, setSelected] = useState<ProcurementOrder>()
  const [selectionError, setSelectionError] = useState<string>()
  const [selectionRefreshKey, setSelectionRefreshKey] = useState(0)
  const [commandId, setCommandId] = useState(() => crypto.randomUUID())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [receiptRefreshKey, setReceiptRefreshKey] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [exportFeedback, setExportFeedback] = useState<{ kind: 'success' | 'error'; message: string; queryKey: string }>()

  useEffect(() => {
    const controller = new AbortController()
    setList({ status: 'loading' })
    void procurementOrderApi.list({ searchField: 'PURCHASE_NO', keyword: query.code || undefined, receivableOnly: query.code ? undefined : true, page: query.page, size: query.size, signal: controller.signal }).then(
      (data) => {
        const lastPage = Math.max(data.totalPages - 1, 0)
        if (query.page > lastPage) { router.history.push(toProcurementReceivingUrl({ ...query, page: lastPage })); return }
        setList({ status: 'ready', data })
      },
      (cause) => { if (!(cause instanceof DOMException && cause.name === 'AbortError')) setList({ status: 'error', message: '暂时无法读取采购单，请稍后重试。' }) },
    )
    return () => controller.abort()
  }, [query, refreshKey])

  useEffect(() => {
    if (!query.orderId) { setSelected(undefined); setSelectionError(undefined); return }
    let active = true
    setSelected((current) => current?.purchaseOrderId === query.orderId ? current : undefined)
    setSelectionError(undefined)
    void procurementOrderApi.get(query.orderId).then(
      (order) => { if (active) { setSelected(order); setCommandId(crypto.randomUUID()); setError(undefined) } },
      () => { if (active) { setSelected(undefined); setSelectionError('暂时无法读取这张采购单，请稍后重试。') } },
    )
    return () => { active = false }
  }, [query.orderId, selectionRefreshKey])

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    router.history.push(toProcurementReceivingUrl({ code: String(data.get('code') ?? ''), orderId: '', page: 0, size: query.size }))
  }

  const choose = (order: ProcurementOrder) => {
    setSelected(order); setCommandId(crypto.randomUUID()); setError(undefined)
    router.history.push(toProcurementReceivingUrl({ ...query, orderId: order.purchaseOrderId }))
  }

  const replaceOrder = (changed: ProcurementOrder) => {
    setSelected(changed)
    const hideFromQueue = !query.code && changed.status !== 'APPROVED' && changed.status !== 'PARTIALLY_RECEIVED'
    setList((current) => {
      if (current.status !== 'ready') return current
      const existed = current.data.items.some((item) => item.purchaseOrderId === changed.purchaseOrderId)
      const items = hideFromQueue
        ? current.data.items.filter((item) => item.purchaseOrderId !== changed.purchaseOrderId)
        : current.data.items.map((item) => item.purchaseOrderId === changed.purchaseOrderId ? changed : item)
      const totalElements = hideFromQueue && existed ? Math.max(current.data.totalElements - 1, 0) : current.data.totalElements
      return { ...current, data: { ...current.data, items, totalElements, totalPages: Math.ceil(totalElements / current.data.size) } }
    })
    if (hideFromQueue) setRefreshKey((value) => value + 1)
  }

  const receive = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selected || busy) return
    const quantity = Number(new FormData(event.currentTarget).get('quantity'))
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > selected.quantity - selected.receivedQuantity) {
      setError('请输入不超过待收数量的整数。'); return
    }
    setBusy(true); setError(undefined)
    try {
      const changed = await procurementOrderApi.receive({ commandId, purchaseOrderId: selected.purchaseOrderId, expectedVersion: selected.version, quantity })
      replaceOrder(changed); setCommandId(crypto.randomUUID())
      setReceiptRefreshKey((value) => value + 1)
    } catch (cause) {
      setError(receiptMessage(cause))
      if (isReceiptConflict(cause)) {
        setCommandId(crypto.randomUUID())
        try {
          replaceOrder(await procurementOrderApi.get(selected.purchaseOrderId))
          setReceiptRefreshKey((value) => value + 1)
        } catch {
          setSelected(undefined)
          if (query.orderId) router.history.push(toProcurementReceivingUrl({ ...query, orderId: '' }))
          setRefreshKey((value) => value + 1)
        }
      }
    }
    finally { setBusy(false) }
  }

  const exportQueryKey = toProcurementReceivingUrl(query)
  const exportReceivingQueue = async () => {
    const queryKey = exportQueryKey
    setExporting(true); setExportFeedback(undefined)
    try {
      const result = await procurementOrderApi.exportCsv({
        searchField: 'PURCHASE_NO', keyword: query.code || undefined,
        receivableOnly: query.code ? undefined : true,
      })
      const url = URL.createObjectURL(new Blob([result.content], { type: result.mediaType }))
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = result.filename
      document.body.append(anchor)
      try { anchor.click() } finally { anchor.remove(); URL.revokeObjectURL(url) }
      setExportFeedback({ kind: 'success', message: `已导出 ${result.rowCount} 条采购收货记录。`, queryKey })
    } catch (cause) {
      setExportFeedback({ kind: 'error', message: exportMessage(cause), queryKey })
    } finally { setExporting(false) }
  }

  return <main className="warehouse-archive-page" aria-labelledby="procurement-receiving-title">
    <header className="warehouse-archive-heading"><div><p className="eyebrow">供应链 / 采购流程</p><h1 id="procurement-receiving-title">签收入库</h1><p>按采购单确认本次到货数量，成功后同步增加目标仓库库存。</p></div><div className="warehouse-archive-actions"><button type="button" disabled={exporting || list.status !== 'ready' || list.data.totalElements === 0} onClick={() => void exportReceivingQueue()}>{exporting ? '正在导出…' : '导出筛选结果'}</button></div></header>
    <section className="warehouse-archive-card" aria-label="签收入库查询与列表">
      <form aria-label="签收入库查询条件" className="warehouse-archive-filters" key={toProcurementReceivingUrl(query)} onSubmit={submitSearch} role="search">
        <label>采购单号<input aria-label="采购单号" autoComplete="off" defaultValue={query.code} maxLength={120} name="code" placeholder="输入采购单号" type="search" /></label>
        <div className="warehouse-archive-filter-actions"><button className="is-primary" type="submit">搜索</button><button type="button" onClick={() => router.history.push('/procurement/receiving')}>重置</button><button type="button" onClick={() => setRefreshKey((value) => value + 1)}>刷新</button></div>
      </form>
      <div className="warehouse-processing-formula" role="note"><strong>收货说明</strong><span>支持分批收货，累计数量不能超过采购数量；确认收货后将更新库存。</span></div>
      {exportFeedback?.queryKey === exportQueryKey && <p className={`warehouse-export-feedback is-${exportFeedback.kind}`} role={exportFeedback.kind === 'error' ? 'alert' : 'status'}>{exportFeedback.message}</p>}
      {list.status === 'loading' && <div className="warehouse-archive-empty" role="status"><strong>正在读取采购单…</strong></div>}
      {list.status === 'error' && <div className="inline-alert" role="alert">{list.message}<button type="button" onClick={() => setRefreshKey((value) => value + 1)}>重试</button></div>}
      {list.status === 'ready' && <><div className="warehouse-archive-table-wrap"><table aria-label="采购收货列表"><thead><tr><th>采购单 / 计划</th><th>供应商</th><th>商品</th><th>目标仓库 / 库位</th><th>采购 / 已收 / 待收</th><th>状态</th><th>操作</th></tr></thead><tbody>{list.data.items.length === 0 ? <tr><td colSpan={7}><div className="warehouse-archive-empty" role="status"><strong>没有匹配的采购单</strong><span>可清空采购单号查看最近采购记录。</span></div></td></tr> : list.data.items.map((order) => { const receivable = order.status === 'APPROVED' || order.status === 'PARTIALLY_RECEIVED'; return <tr key={order.purchaseOrderId}><td>{order.purchaseNo}<br /><small>{order.planNo}</small></td><td>{order.supplierCode} · {order.supplierName}</td><td>{order.skuCode} · {order.skuName}</td><td>{order.warehouseName}<br /><small>{order.locationCode} · {order.locationName}</small></td><td>{order.quantity} / {order.receivedQuantity} / {order.quantity - order.receivedQuantity}</td><td><span className="status-badge is-new-order">{statusLabel[order.status]}</span></td><td>{receivable ? <button className="text-button" type="button" onClick={() => choose(order)}>{canWrite ? '签收入库' : '查看记录'}</button> : <span>不可收货</span>}<button className="text-button" type="button" onClick={() => router.history.push(toProcurementOrderDetailUrl(order.purchaseOrderId))}>采购单详情</button></td></tr> })}</tbody></table></div><div className="procurement-plan-table-footer"><span>共 {list.data.totalElements} 条</span><label>每页<select value={query.size} onChange={(event) => router.history.push(toProcurementReceivingUrl({ ...query, page: 0, size: Number(event.target.value) }))}>{PAGE_SIZES.map((size) => <option key={size} value={size}>{size} 条</option>)}</select></label><div className="pagination"><button type="button" disabled={query.page === 0} onClick={() => router.history.push(toProcurementReceivingUrl({ ...query, page: query.page - 1 }))}>上一页</button><span>第 {query.page + 1} / {Math.max(list.data.totalPages, 1)} 页</span><button type="button" disabled={query.page + 1 >= list.data.totalPages} onClick={() => router.history.push(toProcurementReceivingUrl({ ...query, page: query.page + 1 }))}>下一页</button></div></div></>}
    </section>
    {selectionError && <div className="inline-alert" role="alert">{selectionError}<button type="button" onClick={() => setSelectionRefreshKey((value) => value + 1)}>重试采购单</button><button type="button" onClick={() => router.history.push(toProcurementReceivingUrl({ ...query, orderId: '' }))}>返回收货列表</button></div>}
    {selected && <section className="warehouse-archive-card" aria-labelledby="receipt-confirm-title"><div className="table-heading"><div><h2 id="receipt-confirm-title">采购单收货</h2><span>{selected.purchaseNo} · 待收 {selected.quantity - selected.receivedQuantity} 件</span></div><DialogCloseButton disabled={busy} onClick={() => { setSelected(undefined); if (query.orderId) router.history.push(toProcurementReceivingUrl({ ...query, orderId: '' })) }} /></div>{canWrite && (selected.status === 'APPROVED' || selected.status === 'PARTIALLY_RECEIVED' ? <form className="warehouse-archive-filters" key={`receipt-form:${selected.purchaseOrderId}:${selected.version}`} onSubmit={(event) => void receive(event)}><label>本次收货数量<input aria-label="本次收货数量" name="quantity" type="number" min={1} max={selected.quantity - selected.receivedQuantity} defaultValue={selected.quantity - selected.receivedQuantity} disabled={busy} /></label><div className="warehouse-archive-filter-actions"><button className="is-primary" type="submit" disabled={busy}>{busy ? '正在入库…' : '确认签收入库'}</button></div></form> : <div className="warehouse-archive-empty" role="status"><strong>{selected.status === 'RECEIVED' ? '该采购单已全部收货' : '该采购单尚未批准'}</strong><span>{selected.status === 'RECEIVED' ? '库存已经完成入账。' : '请先在采购审核中批准后再收货。'}</span></div>)}{error && <div className="inline-alert" role="alert">{error}</div>}<div className="form-actions"><button className="text-button" type="button" onClick={() => router.history.push(toProcurementOrderDetailUrl(selected.purchaseOrderId))}>查看采购单详情</button><button className="text-button" type="button" onClick={() => router.history.push(toProcurementReceiptLedgerUrl(selected.purchaseNo))}>查看该单采购流水</button></div><ReceiptHistory key={`receipt-history:${selected.purchaseOrderId}:${receiptRefreshKey}`} purchaseOrderId={selected.purchaseOrderId} /></section>}
  </main>
}
