import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useRouter, useRouterState } from '@tanstack/react-router'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { DialogCloseButton } from '../components/DialogCloseButton'
import { procurementReturnApi, type ProcurementReturn, type ProcurementReturnPage, type ProcurementReturnSearchField, type ProcurementReturnableOrder } from '../modules/procurementReturnApi'
import './WarehouseArchiveShells.css'

export type ProcurementReturnQuery = { searchField: ProcurementReturnSearchField; keyword: string; startDate: string; endDate: string; page: number; size: number }
type LoadState = { status: 'loading' } | { status: 'ready'; data: ProcurementReturnPage } | { status: 'error'; message: string }
type ReferenceState = { status: 'idle' | 'loading' } | { status: 'ready'; data: ProcurementReturnableOrder[] } | { status: 'error'; message: string }
const DEFAULT_SIZE = 25
const PAGE_SIZES = [10, 25, 50, 100] as const
const searchFields: ReadonlyArray<{ value: ProcurementReturnSearchField; label: string }> = [
  { value: 'RETURN_NO', label: '退货单号' }, { value: 'PURCHASE_NO', label: '采购单号' },
  { value: 'SKU_CODE', label: '库存 SKU' }, { value: 'SKU_NAME', label: '商品名称' },
  { value: 'SUPPLIER_NAME', label: '供应商' }, { value: 'RETURNED_BY', label: '退货操作人' },
]

function boundedText(value: string | null, maximum: number) { return (value ?? '').trim().slice(0, maximum) }
function boundedInteger(value: string | null, fallback: number, minimum: number, maximum: number) { const parsed = Number(value); return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback }
function searchField(value: string | null): ProcurementReturnSearchField { return searchFields.some((item) => item.value === value) ? value as ProcurementReturnSearchField : 'RETURN_NO' }
function isoDate(value: string | null) { const normalized = boundedText(value, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return ''; const date = new Date(`${normalized}T00:00:00.000Z`); return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized ? '' : normalized }
function apiStart(value: string) { return value ? `${value}T00:00:00.000Z` : undefined }
function apiEnd(value: string) { return value ? `${value}T23:59:59.999Z` : undefined }
function displayTime(value: string) { return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value)) }
function safeMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 409) return '采购单或库存状态已变化，请刷新后重试。'
  if (error instanceof ApiError && error.status === 403) return '当前账号没有采购退货权限。'
  return '暂时无法完成采购退货，请稍后重试。'
}

export function parseProcurementReturnQuery(search: string): ProcurementReturnQuery {
  const params = new URLSearchParams(search)
  return { searchField: searchField(params.get('searchField')), keyword: boundedText(params.get('keyword'), 120), startDate: isoDate(params.get('startDate')), endDate: isoDate(params.get('endDate')), page: boundedInteger(params.get('page'), 1, 1, 1_000_000), size: boundedInteger(params.get('size'), DEFAULT_SIZE, 1, 100) }
}
export function toProcurementReturnUrl(query: Partial<ProcurementReturnQuery>) {
  const params = new URLSearchParams()
  if (query.searchField && query.searchField !== 'RETURN_NO') params.set('searchField', searchField(query.searchField))
  if (query.keyword) params.set('keyword', boundedText(query.keyword, 120))
  if (query.startDate && isoDate(query.startDate)) params.set('startDate', isoDate(query.startDate))
  if (query.endDate && isoDate(query.endDate)) params.set('endDate', isoDate(query.endDate))
  if (query.page && query.page > 1) params.set('page', String(query.page))
  if (query.size && query.size !== DEFAULT_SIZE) params.set('size', String(query.size))
  return params.size ? `/procurement/returns?${params}` : '/procurement/returns'
}

export function ProcurementReturnPage() {
  const router = useRouter()
  const search = useRouterState({ select: (state) => state.location.searchStr })
  const query = useMemo(() => parseProcurementReturnQuery(search), [search])
  const { hasPermission } = useAuth()
  const canWrite = hasPermission('procurement.write')
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [refreshKey, setRefreshKey] = useState(0)
  const [open, setOpen] = useState(false)
  const [referenceSearch, setReferenceSearch] = useState('')
  const [references, setReferences] = useState<ReferenceState>({ status: 'idle' })
  const [selectedId, setSelectedId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })
    procurementReturnApi.list({ searchField: query.searchField, keyword: query.keyword || undefined, returnedFrom: apiStart(query.startDate), returnedTo: apiEnd(query.endDate), page: query.page - 1, size: query.size, signal: controller.signal })
      .then((data) => setState({ status: 'ready', data }))
      .catch((caught) => { if (!controller.signal.aborted) setState({ status: 'error', message: safeMessage(caught) }) })
    return () => controller.abort()
  }, [query.searchField, query.keyword, query.startDate, query.endDate, query.page, query.size, refreshKey])

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setReferences({ status: 'loading' })
    procurementReturnApi.returnableOrders(referenceSearch || undefined, 0, 100, controller.signal)
      .then((page) => { setReferences({ status: 'ready', data: page.items }); setSelectedId((current) => page.items.some((item) => item.purchaseOrderId === current) ? current : page.items[0]?.purchaseOrderId ?? '') })
      .catch((caught) => { if (!controller.signal.aborted) setReferences({ status: 'error', message: safeMessage(caught) }) })
    return () => controller.abort()
  }, [open, referenceSearch, refreshKey])

  const selected = references.status === 'ready' ? references.data.find((item) => item.purchaseOrderId === selectedId) : undefined
  const submitSearch = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const data = new FormData(event.currentTarget); router.history.push(toProcurementReturnUrl({ searchField: searchField(String(data.get('searchField'))), keyword: boundedText(String(data.get('keyword')), 120), startDate: isoDate(String(data.get('startDate'))), endDate: isoDate(String(data.get('endDate'))), page: 1, size: query.size })) }
  const createReturn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!selected) return
    const data = new FormData(event.currentTarget); const quantity = Number(data.get('quantity')); const reason = boundedText(String(data.get('reason')), 500)
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > selected.returnableQuantity) { setError(`退货数量应为 1 至 ${selected.returnableQuantity}。`); return }
    if (!reason) { setError('请填写退货原因。'); return }
    setBusy(true); setError('')
    try { await procurementReturnApi.create({ commandId: crypto.randomUUID(), purchaseOrderId: selected.purchaseOrderId, expectedOrderVersion: selected.version, quantity, reason }); setOpen(false); setReferenceSearch(''); setSelectedId(''); setRefreshKey((value) => value + 1) }
    catch (caught) { setError(safeMessage(caught)) } finally { setBusy(false) }
  }

  return <main className="warehouse-archive-page" aria-labelledby="procurement-return-title">
    <header className="warehouse-archive-heading"><div><p className="eyebrow">供应链 / 采购流程</p><h1 id="procurement-return-title">退货管理</h1><p>从已收货采购单发起退货，退货成功后同步扣减仓库库存。</p></div><div className="warehouse-archive-actions"><button type="button" onClick={() => setRefreshKey((value) => value + 1)}>刷新</button>{canWrite && <button className="is-primary" type="button" onClick={() => { setError(''); setOpen(true) }}>新增采购退货单</button>}</div></header>
    <section className="warehouse-archive-card" aria-label="采购退货筛选与结果">
      <form className="warehouse-archive-filters procurement-plan-filters" key={toProcurementReturnUrl(query)} onSubmit={submitSearch}>
        <label>搜索字段<select name="searchField" defaultValue={query.searchField}>{searchFields.map((field) => <option key={field.value} value={field.value}>{field.label}</option>)}</select></label>
        <label className="procurement-plan-keyword">关键词<input name="keyword" defaultValue={query.keyword} maxLength={120} placeholder="输入退货单、采购单或商品信息" /></label>
        <label>退货起始日期<input name="startDate" type="date" defaultValue={query.startDate} /></label><label>退货截止日期<input name="endDate" type="date" defaultValue={query.endDate} /></label>
        <div className="warehouse-archive-filter-actions"><button className="is-primary" type="submit">搜索</button><button type="button" onClick={() => router.history.push('/procurement/returns')}>重置</button></div>
      </form>
      {state.status === 'loading' && <div className="warehouse-archive-empty" role="status"><strong>正在加载退货记录</strong></div>}
      {state.status === 'error' && <div className="inline-alert" role="alert">{state.message}</div>}
      {state.status === 'ready' && <><div className="table-scroll"><table className="warehouse-table"><thead><tr><th>退货单 / 采购单</th><th>供应商</th><th>商品</th><th>退货仓库 / 库位</th><th>退货数量</th><th>退货原因</th><th>操作人 / 时间</th><th>库存结果</th></tr></thead><tbody>{state.data.items.length === 0 ? <tr><td colSpan={8}><div className="warehouse-archive-empty" role="status"><strong>暂无采购退货记录</strong><span>可从已收货采购单创建第一张退货单。</span></div></td></tr> : state.data.items.map((item) => <ReturnRow key={item.purchaseReturnId} item={item} />)}</tbody></table></div><nav className="warehouse-pagination" aria-label="采购退货分页"><span>共 {state.data.totalElements} 条</span><label>每页<select aria-label="每页" value={query.size} onChange={(event) => router.history.push(toProcurementReturnUrl({ ...query, page: 1, size: Number(event.target.value) }))}>{PAGE_SIZES.map((size) => <option key={size} value={size}>{size} 条</option>)}</select></label><button type="button" disabled={query.page <= 1} onClick={() => router.history.push(toProcurementReturnUrl({ ...query, page: query.page - 1 }))}>上一页</button><span>第 {query.page} / {Math.max(state.data.totalPages, 1)} 页</span><button type="button" disabled={query.page >= state.data.totalPages} onClick={() => router.history.push(toProcurementReturnUrl({ ...query, page: query.page + 1 }))}>下一页</button></nav></>}
    </section>
    {open && <section className="warehouse-dialog-backdrop" role="presentation"><div className="warehouse-dialog" role="dialog" aria-modal="true" aria-labelledby="create-return-title"><div className="table-heading"><div><h2 id="create-return-title">新增采购退货单</h2><span>仅显示仍有可退数量的已收货采购单</span></div><DialogCloseButton disabled={busy} onClick={() => setOpen(false)} /></div><label className="inventory-count-note"><span>查找采购单</span><input aria-label="查找采购单" value={referenceSearch} maxLength={120} placeholder="采购单号、SKU 或商品名称" onChange={(event) => setReferenceSearch(event.target.value)} /></label>{references.status === 'loading' && <div className="warehouse-archive-empty" role="status"><strong>正在读取可退采购单</strong></div>}{references.status === 'error' && <div className="inline-alert" role="alert">{references.message}</div>}{references.status === 'ready' && references.data.length === 0 && <div className="warehouse-archive-empty" role="status"><strong>暂无可退采购单</strong><span>采购单完成收货后才可发起退货。</span></div>}{references.status === 'ready' && references.data.length > 0 && <form className="warehouse-archive-filters" onSubmit={(event) => void createReturn(event)}><label><span>* 采购单</span><select aria-label="采购单" value={selectedId} disabled={busy} onChange={(event) => setSelectedId(event.target.value)}>{references.data.map((order) => <option key={order.purchaseOrderId} value={order.purchaseOrderId}>{order.purchaseNo} · {order.skuCode} · 可退 {order.returnableQuantity}</option>)}</select></label>{selected && <div className="warehouse-processing-formula" role="note"><strong>{selected.skuCode} · {selected.skuName}</strong><span>{selected.supplierCode} · {selected.supplierName}</span><span>{selected.warehouseName} / {selected.locationCode}</span><span>已收 {selected.receivedQuantity} · 已退 {selected.returnedQuantity} · 可退 {selected.returnableQuantity}</span></div>}<label><span>* 本次退货数量</span><input aria-label="本次退货数量" name="quantity" type="number" min={1} max={selected?.returnableQuantity ?? 1} defaultValue={selected?.returnableQuantity ?? 1} disabled={busy} /></label><label className="inventory-count-note"><span>* 退货原因</span><textarea aria-label="退货原因" name="reason" maxLength={500} placeholder="例如：到货破损、规格不符或供应商召回" disabled={busy} /></label>{error && <div className="inline-alert" role="alert">{error}</div>}<div className="form-actions"><button type="button" disabled={busy} onClick={() => setOpen(false)}>取消</button><button className="is-primary" type="submit" disabled={busy}>{busy ? '正在提交…' : '确认退货并扣减库存'}</button></div></form>}</div></section>}
  </main>
}

function ReturnRow({ item }: { item: ProcurementReturn }) { return <tr><td><strong>{item.returnNo}</strong><div>{item.purchaseNo}</div></td><td>{item.supplierCode} · {item.supplierName}</td><td><strong>{item.skuCode} · {item.skuName}</strong>{item.skuVariant && <div>{item.skuVariant}</div>}</td><td>{item.warehouseName}<div>{item.locationCode} · {item.locationName}</div></td><td>{item.quantity}</td><td>{item.reason}</td><td>{item.returnedByDisplayName}<div><time dateTime={item.returnedAt}>{displayTime(item.returnedAt)}</time></div></td><td>退货后库存 {item.inventoryBalanceAfter}<div>库存事件 #{item.inventoryLedgerSequence}</div></td></tr> }
