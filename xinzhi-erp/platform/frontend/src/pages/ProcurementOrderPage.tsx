import { useRouter, useRouterState } from '@tanstack/react-router'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { DialogCloseButton } from '../components/DialogCloseButton'
import { procurementOrderApi, type ProcurementOrder, type ProcurementOrderPage as OrderPage, type ProcurementOrderSearchField, type ProcurementOrderStatus, type ProcurementSupplierOption } from '../modules/procurementOrderApi'
import { procurementOrderId, toProcurementOrderDetailUrl } from '../modules/procurementOrderRoutes'
import { procurementPlanApi, type ProcurementLocationOption, type ProcurementPlan, type ProcurementSkuOption, type ProcurementWarehouseOption } from '../modules/procurementPlanApi'
import { procurementReceiptApi, type ProcurementReceipt } from '../modules/procurementReceiptApi'
import { procurementReturnApi, type ProcurementReturn, type ProcurementReturnableOrder } from '../modules/procurementReturnApi'
import { SupplierQuickCreateDialog } from './SupplierQuickCreateDialog'
import './WarehouseArchiveShells.css'

const DEFAULT_SIZE = 25
const PAGE_SIZES = [10, 25, 50, 100] as const
const searchFields: ReadonlyArray<{ value: ProcurementOrderSearchField; label: string }> = [
  { value: 'PURCHASE_NO', label: '采购单号' }, { value: 'PLAN_NO', label: '计划编号' },
  { value: 'SKU_CODE', label: 'SKU 编号' }, { value: 'SKU_NAME', label: 'SKU 名称' },
  { value: 'SUPPLIER_NAME', label: '供应商' }, { value: 'ORDER_NOTE', label: '订单备注' },
]
const statusLabel: Record<ProcurementOrder['status'], string> = { NEW_ORDER: '待审核', APPROVED: '待收货', REJECTED: '已驳回', PARTIALLY_RECEIVED: '部分收货', RECEIVED: '已收货' }
const statusViews: ReadonlyArray<{ value: '' | ProcurementOrderStatus; label: string }> = [
  { value: '', label: '全部' },
  { value: 'NEW_ORDER', label: '待审核' },
  { value: 'APPROVED', label: '待收货' },
  { value: 'PARTIALLY_RECEIVED', label: '部分收货' },
  { value: 'RECEIVED', label: '已收货' },
  { value: 'REJECTED', label: '已驳回' },
]

type LoadState<T> = { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; message: string }
type OrderAction = 'APPROVE' | 'REJECT' | 'RECEIVE' | 'RETURN'
type ListOrderAction = { order: ProcurementOrder; action: OrderAction }
export type ProcurementOrderQuery = { searchField: ProcurementOrderSearchField; keyword: string; createPlanNo: string; detailId: string; status: '' | ProcurementOrderStatus; createdFrom: string; createdTo: string; page: number; size: number }

const actionTitle: Record<OrderAction, string> = {
  APPROVE: '通过采购单', REJECT: '驳回采购单', RECEIVE: '确认收货', RETURN: '发起采购退货',
}
const actionSuccessMessage: Record<OrderAction, string> = {
  APPROVE: '采购单已通过。', REJECT: '采购单已驳回。', RECEIVE: '采购单已确认收货。', RETURN: '采购退货已提交。',
}

function bounded(value: string | null, maximum: number) { return (value ?? '').trim().slice(0, maximum) }
function oneOf<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T { return allowed.includes(value as T) ? value as T : fallback }
function integer(value: string | null, fallback: number, minimum: number, maximum: number) { const parsed = Number(value); return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback }
function date(value: string | null) { const result = bounded(value, 10); return /^\d{4}-\d{2}-\d{2}$/.test(result) && !Number.isNaN(Date.parse(`${result}T00:00:00Z`)) ? result : '' }
function startInstant(value: string) { return value ? `${value}T00:00:00.000Z` : undefined }
function endInstant(value: string) { return value ? `${value}T23:59:59.999Z` : undefined }

export function parseProcurementOrderQuery(search: string): ProcurementOrderQuery {
  const params = new URLSearchParams(search)
  return {
    searchField: oneOf(params.get('searchField'), searchFields.map((item) => item.value), 'PURCHASE_NO'),
    keyword: bounded(params.get('keyword'), 120), createPlanNo: bounded(params.get('createPlanNo'), 120), detailId: procurementOrderId(params.get('detailId')), status: oneOf(params.get('status'), ['', 'NEW_ORDER', 'APPROVED', 'REJECTED', 'PARTIALLY_RECEIVED', 'RECEIVED'] as const, ''), createdFrom: date(params.get('createdFrom')), createdTo: date(params.get('createdTo')),
    page: integer(params.get('page'), 0, 0, 9_999), size: integer(params.get('size'), DEFAULT_SIZE, 1, 200),
  }
}

export function toProcurementOrderUrl(query: Partial<ProcurementOrderQuery>) {
  const params = new URLSearchParams()
  if (query.searchField && query.searchField !== 'PURCHASE_NO') params.set('searchField', query.searchField)
  if (query.keyword?.trim()) params.set('keyword', query.keyword.trim().slice(0, 120))
  if (query.createPlanNo?.trim()) params.set('createPlanNo', query.createPlanNo.trim().slice(0, 120))
  if (query.detailId && procurementOrderId(query.detailId)) params.set('detailId', query.detailId)
  if (query.status) params.set('status', query.status)
  if (query.createdFrom && date(query.createdFrom)) params.set('createdFrom', query.createdFrom)
  if (query.createdTo && date(query.createdTo)) params.set('createdTo', query.createdTo)
  if (query.page && query.page > 0) params.set('page', String(query.page))
  if (query.size && query.size !== DEFAULT_SIZE) params.set('size', String(query.size))
  const serialized = params.toString()
  return serialized ? `/procurement/orders?${serialized}` : '/procurement/orders'
}

export { toProcurementOrderDetailUrl }

export function toProcurementOrderReceivingUrl(purchaseNo: string, purchaseOrderId?: string) {
  const code = bounded(purchaseNo, 120)
  const orderId = procurementOrderId(purchaseOrderId)
  const params = new URLSearchParams()
  if (code) params.set('code', code)
  if (orderId) params.set('orderId', orderId)
  const serialized = params.toString()
  return serialized ? `/procurement/receiving?${serialized}` : '/procurement/receiving'
}

export function toProcurementOrderLedgerUrl(purchaseNo: string) {
  const purchaseKeyword = bounded(purchaseNo, 120)
  if (!purchaseKeyword) return '/procurement/statistics/ledger'
  return `/procurement/statistics/ledger?${new URLSearchParams({
    dimension: 'PURCHASE_ORDER',
    purchaseKeyword,
  }).toString()}`
}

function operationConflictReason(error: unknown) {
  if (!(error instanceof ApiError) || error.status !== 409 || typeof error.details !== 'object' || error.details === null || !('reason' in error.details)) return ''
  return String((error.details as { reason?: unknown }).reason ?? '')
}

function operationMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 403) return '当前账号没有采购单写入权限。'
  if (error instanceof ApiError && error.status === 409) {
    const reason = operationConflictReason(error)
    if (reason === 'supplier_mapping_unavailable') return '所选供应商与该 SKU 的有效供货关系已失效，请重新选择。'
    if (reason === 'purchase_reference_unavailable') return '商品、供应商、仓库或库位资料已变化，请重新选择后再试。'
    if (reason === 'invalid_plan_state') return '采购计划已被处理，请重新选择未采购计划。'
    if (reason === 'idempotency_conflict') return '本次操作已提交，请刷新结果后重试。'
    return '采购单资料已更新，请刷新后再试。'
  }
  return '暂时无法完成采购单操作，请检查网络后重试。'
}

function exportMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 403) return '当前账号没有采购单导出权限。'
  if (error instanceof ApiError && error.status === 409) return '筛选结果超过 10,000 条，请缩小筛选范围后重试。'
  return '暂时无法导出采购单，请检查网络后重试。'
}

async function loadAllReferencePages<T>(loader: (page: number, size: number) => Promise<{ items: T[]; totalPages: number; totalElements: number }>) {
  const first = await loader(0, 200)
  const items = [...first.items]
  for (let page = 1; page < first.totalPages; page += 1) {
    const next = await loader(page, 200)
    if (next.totalPages !== first.totalPages || next.totalElements !== first.totalElements) throw new Error('Reference pages changed while loading')
    items.push(...next.items)
  }
  if (items.length !== first.totalElements) throw new Error('Reference pages are incomplete')
  return items
}

function CreateOrderDialog({ initialPlanNo = '', onClose, onCreated }: { initialPlanNo?: string; onClose: () => void; onCreated: (order: ProcurementOrder) => void }) {
  const { hasPermission } = useAuth()
  const canManageSuppliers = hasPermission('suppliers.write')
  const [skuKeyword, setSkuKeyword] = useState('')
  const [referenceRefreshKey, setReferenceRefreshKey] = useState(0)
  const [skus, setSkus] = useState<LoadState<ProcurementSkuOption[]>>({ status: 'loading' })
  const [warehouses, setWarehouses] = useState<LoadState<ProcurementWarehouseOption[]>>({ status: 'loading' })
  const [locations, setLocations] = useState<LoadState<ProcurementLocationOption[]>>({ status: 'ready', data: [] })
  const [skuId, setSkuId] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [legacyPlan, setLegacyPlan] = useState<ProcurementPlan>()
  const [supplierRefreshKey, setSupplierRefreshKey] = useState(0)
  const [suppliers, setSuppliers] = useState<LoadState<ProcurementSupplierOption[]>>({ status: 'ready', data: [] })
  const [supplierId, setSupplierId] = useState('')
  const [quickCreatingSupplier, setQuickCreatingSupplier] = useState(false)
  const [newSupplierId, setNewSupplierId] = useState('')
  const [orderNote, setOrderNote] = useState('')
  const [pendingCommandId, setPendingCommandId] = useState(() => crypto.randomUUID())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    let active = true
    setSkus({ status: 'loading' })
    void loadAllReferencePages((page, size) => procurementPlanApi.skus(skuKeyword || undefined, page, size)).then(
      (data) => { if (active) setSkus({ status: 'ready', data }) },
      () => { if (active) setSkus({ status: 'error', message: '无法读取可采购商品。' }) },
    )
    return () => { active = false }
  }, [skuKeyword, referenceRefreshKey])

  useEffect(() => {
    let active = true
    setWarehouses({ status: 'loading' })
    void loadAllReferencePages((page, size) => procurementPlanApi.warehouses(undefined, page, size)).then(
      (data) => { if (active) setWarehouses({ status: 'ready', data }) },
      () => { if (active) setWarehouses({ status: 'error', message: '无法读取可用仓库。' }) },
    )
    return () => { active = false }
  }, [referenceRefreshKey])

  useEffect(() => {
    let active = true
    setLocationId('')
    if (!warehouseId) { setLocations({ status: 'ready', data: [] }); return () => { active = false } }
    setLocations({ status: 'loading' })
    void loadAllReferencePages((page, size) => procurementPlanApi.locations(warehouseId, undefined, page, size)).then(
      (data) => { if (active) setLocations({ status: 'ready', data }) },
      () => { if (active) setLocations({ status: 'error', message: '无法读取仓库库位。' }) },
    )
    return () => { active = false }
  }, [warehouseId, referenceRefreshKey])

  useEffect(() => {
    if (!initialPlanNo) return
    let active = true
    void procurementPlanApi.list({ status: 'UNPURCHASED', searchField: 'PLAN_NO', keyword: initialPlanNo, page: 0, size: 25 }).then(
      (result) => {
        const plan = result.items.find((item) => item.planNo === initialPlanNo)
        if (!active || !plan) return
        setLegacyPlan(plan); setSkuId(plan.skuId); setWarehouseId(plan.warehouseId); setQuantity(String(plan.quantity))
        queueMicrotask(() => { if (active) setLocationId(plan.locationId) })
      },
      () => { if (active) setError('历史采购计划无法读取，可改为直接填写采购单。') },
    )
    return () => { active = false }
  }, [initialPlanNo])

  useEffect(() => {
    let active = true
    setSupplierId('')
    if (!skuId) { setSuppliers({ status: 'ready', data: [] }); return () => { active = false } }
    setSuppliers({ status: 'loading' })
    void (async () => {
      try {
        const items = await loadAllReferencePages((page, size) => procurementOrderApi.suppliersForSku(skuId, undefined, page, size))
        if (active) {
          setSuppliers({ status: 'ready', data: items })
          setSupplierId((items.find((item) => item.supplierId === newSupplierId) ?? items.find((item) => item.preferred) ?? items[0])?.supplierId ?? '')
          setNewSupplierId('')
        }
      } catch { if (active) setSuppliers({ status: 'error', message: '无法读取该商品的有效供应商关系。' }) }
    })()
    return () => { active = false }
  }, [skuId, supplierRefreshKey])

  const changed = () => { setPendingCommandId(crypto.randomUUID()); setError(undefined) }
  const breakLegacy = () => { changed(); setLegacyPlan(undefined) }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const parsedQuantity = Number(quantity)
    if (busy || !skuId || !supplierId || !warehouseId || !locationId || !Number.isSafeInteger(parsedQuantity) || parsedQuantity < 1) return
    setBusy(true); setError(undefined)
    try {
      const order = legacyPlan && legacyPlan.skuId === skuId && legacyPlan.warehouseId === warehouseId && legacyPlan.locationId === locationId && legacyPlan.quantity === parsedQuantity
        ? await procurementOrderApi.create({ commandId: pendingCommandId, planId: legacyPlan.id, expectedPlanVersion: legacyPlan.version, supplierId, orderNote: orderNote.trim() || undefined })
        : await procurementOrderApi.createDirect({ commandId: pendingCommandId, supplierId, skuId, warehouseId, locationId, quantity: parsedQuantity, orderNote: orderNote.trim() || undefined })
      onCreated(order)
    }
    catch (cause) {
      const reason = operationConflictReason(cause)
      if (reason === 'supplier_mapping_unavailable') {
        setSupplierId('')
        setSupplierRefreshKey((value) => value + 1)
      } else if (reason === 'invalid_plan_state' || reason === 'optimistic_lock_conflict') {
        setLegacyPlan(undefined)
      }
      setError(operationMessage(cause))
    }
    finally { setBusy(false) }
  }

  return <div className="dialog-backdrop" role="presentation"><section className="write-dialog inventory-count-create-dialog" role="dialog" aria-modal="true" aria-labelledby="create-order-title">
    <header className="table-heading"><div><h2 id="create-order-title">新增采购单</h2><span>直接选择商品、供应商和收货仓库</span></div><DialogCloseButton disabled={busy} onClick={onClose} /></header>
    <form onSubmit={(event) => void submit(event)}>
      <div className="inventory-count-form-grid">
        {legacyPlan && <div className="warehouse-processing-formula inventory-count-note"><strong>历史计划</strong><span>{legacyPlan.planNo} 已带入；保持商品、仓库、库位和数量不变即可完成转换。</span></div>}
        <label className="inventory-count-note">搜索商品<input value={skuKeyword} maxLength={120} disabled={busy} placeholder="输入 SKU 编号或商品名称" onChange={(event) => { breakLegacy(); setSkuId(''); setSkuKeyword(event.target.value) }} /></label>
        <label className="inventory-count-note"><span>* 商品</span><select aria-label="商品" value={skuId} disabled={busy || skus.status !== 'ready'} onChange={(event) => { breakLegacy(); setSkuId(event.target.value) }}><option value="">-选择商品-</option>{skus.status === 'ready' && skus.data.map((sku) => <option key={sku.id} value={sku.id}>{sku.businessCode} · {sku.name}{sku.variantSummary ? ` · ${sku.variantSummary}` : ''}</option>)}</select></label>
        <label className="inventory-count-note"><span>* 供应商</span><select aria-label="供应商" value={supplierId} disabled={busy || !skuId || suppliers.status !== 'ready'} onChange={(event) => { changed(); setSupplierId(event.target.value) }}><option value="">-选择有效供应商-</option>{suppliers.status === 'ready' && suppliers.data.map((supplier) => <option key={supplier.supplierId} value={supplier.supplierId}>{supplier.preferred ? '首选 · ' : ''}{supplier.supplierCode} · {supplier.supplierName}{supplier.supplierSkuCode ? ` · ${supplier.supplierSkuCode}` : ''}</option>)}</select>{canManageSuppliers && skuId && <button className="text-button procurement-quick-supplier" type="button" disabled={busy} onClick={() => setQuickCreatingSupplier(true)}>新增并绑定供应商</button>}</label>
        <label className="inventory-count-note"><span>* 目标仓库</span><select aria-label="目标仓库" value={warehouseId} disabled={busy || warehouses.status !== 'ready'} onChange={(event) => { breakLegacy(); setWarehouseId(event.target.value) }}><option value="">-选择仓库-</option>{warehouses.status === 'ready' && warehouses.data.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.businessCode} · {warehouse.name}</option>)}</select></label>
        <label className="inventory-count-note"><span>* 目标库位</span><select aria-label="目标库位" value={locationId} disabled={busy || !warehouseId || locations.status !== 'ready'} onChange={(event) => { breakLegacy(); setLocationId(event.target.value) }}><option value="">-选择库位-</option>{locations.status === 'ready' && locations.data.map((location) => <option key={location.id} value={location.id}>{location.businessCode} · {location.name}</option>)}</select></label>
        <label className="inventory-count-note"><span>* 采购数量</span><input aria-label="采购数量" type="number" min={1} max={1_000_000_000} value={quantity} disabled={busy} onChange={(event) => { breakLegacy(); setQuantity(event.target.value) }} /></label>
        <label className="inventory-count-note">订单备注<textarea value={orderNote} rows={3} maxLength={500} disabled={busy} onChange={(event) => { changed(); setOrderNote(event.target.value) }} /></label>
      </div>
      {(skus.status === 'error' || warehouses.status === 'error' || locations.status === 'error') && <div className="inline-alert" role="alert">{skus.status === 'error' ? skus.message : warehouses.status === 'error' ? warehouses.message : locations.status === 'error' ? locations.message : ''}<button type="button" disabled={busy} onClick={() => setReferenceRefreshKey((value) => value + 1)}>重试基础资料</button></div>}
      {suppliers.status === 'ready' && skuId && suppliers.data.length === 0 && <div className="inline-alert" role="alert">该商品没有有效供应商供货关系。{canManageSuppliers ? '可使用“新增并绑定供应商”立即补齐。' : '请联系有供应商写权限的同事维护。'}</div>}
      {suppliers.status === 'error' && <div className="inline-alert" role="alert">{suppliers.message}<button type="button" disabled={busy} onClick={() => setSupplierRefreshKey((value) => value + 1)}>重试供应商</button></div>}
      {error && <div className="inline-alert" role="alert">{error}</div>}
      <footer className="form-actions"><button className="text-button" type="button" disabled={busy} onClick={onClose}>取消</button><button className="button button-primary" type="submit" disabled={busy || !skuId || !supplierId || !warehouseId || !locationId || !Number.isSafeInteger(Number(quantity)) || Number(quantity) < 1}>{busy ? '正在创建…' : '创建采购单'}</button></footer>
    </form>{quickCreatingSupplier && skus.status === 'ready' && skus.data.find((sku) => sku.id === skuId) && <SupplierQuickCreateDialog sku={skus.data.find((sku) => sku.id === skuId)!} onClose={() => setQuickCreatingSupplier(false)} onCreated={(createdSupplierId) => { setQuickCreatingSupplier(false); setNewSupplierId(createdSupplierId); setSupplierRefreshKey((value) => value + 1); changed() }} />}
  </section></div>
}

function OrderActionForm({ order, action, returnable, onCancel, onCompleted, onBusyChange }: { order: ProcurementOrder; action: OrderAction; returnable?: ProcurementReturnableOrder; onCancel: () => void; onCompleted: (order: ProcurementOrder) => void; onBusyChange?: (busy: boolean) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const runAction = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy) return
    const data = new FormData(event.currentTarget); const note = String(data.get('note') ?? '').trim(); const quantity = Number(data.get('quantity'))
    if (action === 'REJECT' && !note) { setError('请填写驳回原因。'); return }
    if (action === 'RECEIVE' && (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > order.quantity - order.receivedQuantity)) { setError(`本次收货数量应为 1 至 ${order.quantity - order.receivedQuantity}。`); return }
    if (action === 'RETURN' && (!returnable || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > returnable.returnableQuantity || !note)) { setError(`请填写退货原因，数量应为 1 至 ${returnable?.returnableQuantity ?? 0}。`); return }
    setBusy(true); onBusyChange?.(true); setError(undefined)
    try {
      let changed: ProcurementOrder
      if (action === 'APPROVE' || action === 'REJECT') {
        changed = await procurementOrderApi.review({ commandId: crypto.randomUUID(), purchaseOrderId: order.purchaseOrderId, expectedVersion: order.version, approved: action === 'APPROVE', reviewNote: note || undefined })
      } else if (action === 'RECEIVE') {
        changed = await procurementOrderApi.receive({ commandId: crypto.randomUUID(), purchaseOrderId: order.purchaseOrderId, expectedVersion: order.version, quantity })
      } else {
        await procurementReturnApi.create({ commandId: crypto.randomUUID(), purchaseOrderId: order.purchaseOrderId, expectedOrderVersion: returnable!.version, quantity, reason: note })
        changed = await procurementOrderApi.get(order.purchaseOrderId)
      }
      onCompleted(changed)
    } catch (cause) { setError(operationMessage(cause)) } finally { setBusy(false); onBusyChange?.(false) }
  }

  return <form className="procurement-order-action-panel" onSubmit={(event) => void runAction(event)}><strong>{actionTitle[action]}</strong>{(action === 'RECEIVE' || action === 'RETURN') && <label>数量<input name="quantity" type="number" min={1} max={action === 'RECEIVE' ? order.quantity - order.receivedQuantity : returnable?.returnableQuantity ?? 0} defaultValue={action === 'RECEIVE' ? order.quantity - order.receivedQuantity : returnable?.returnableQuantity ?? 0} disabled={busy} /></label>}{action !== 'RECEIVE' && <label>{action === 'REJECT' ? '驳回原因' : action === 'RETURN' ? '退货原因' : '备注（可选）'}<textarea name="note" rows={2} maxLength={500} disabled={busy} /></label>}{error && <div className="inline-alert" role="alert">{error}</div>}<div className="form-actions"><button type="button" disabled={busy} onClick={onCancel}>取消</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? '正在提交…' : '确认'}</button></div></form>
}

function OrderActionDialog({ selection, onClose, onChanged }: { selection: ListOrderAction; onClose: () => void; onChanged: (order: ProcurementOrder, action: OrderAction) => void }) {
  const { order, action } = selection
  const [returnable, setReturnable] = useState<LoadState<ProcurementReturnableOrder | undefined>>(() => action === 'RETURN' ? { status: 'loading' } : { status: 'ready', data: undefined })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (action !== 'RETURN') return
    const controller = new AbortController()
    setReturnable({ status: 'loading' })
    void procurementReturnApi.returnableOrders(order.purchaseNo, 0, 100, controller.signal).then(
      (page) => setReturnable({ status: 'ready', data: page.items.find((item) => item.purchaseOrderId === order.purchaseOrderId) }),
      () => { if (!controller.signal.aborted) setReturnable({ status: 'error', message: '暂时无法确认可退数量，请稍后重试。' }) },
    )
    return () => controller.abort()
  }, [action, order.purchaseNo, order.purchaseOrderId])

  const titleId = `procurement-order-action-${order.purchaseOrderId}`
  return <div className="dialog-backdrop" role="presentation"><section className="write-dialog procurement-order-list-action-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
    <header className="table-heading"><div><h2 id={titleId}>{actionTitle[action]}</h2><span>{order.purchaseNo} · {statusLabel[order.status]}</span></div><DialogCloseButton disabled={busy} onClick={onClose} /></header>
    <dl className="procurement-order-action-summary"><div><dt>供应商</dt><dd>{order.supplierName}</dd></div><div><dt>商品</dt><dd>{order.skuCode} · {order.skuName}</dd></div><div><dt>采购 / 已收 / 待收</dt><dd>{order.quantity} / {order.receivedQuantity} / {order.quantity - order.receivedQuantity}</dd></div></dl>
    {returnable.status === 'loading' && <p role="status">正在确认可退数量…</p>}
    {returnable.status === 'error' && <div className="inline-alert" role="alert">{returnable.message}</div>}
    {action === 'RETURN' && returnable.status === 'ready' && !returnable.data && <div className="inline-alert" role="status">该采购单当前没有可退数量。</div>}
    {returnable.status === 'ready' && (action !== 'RETURN' || returnable.data) && <OrderActionForm order={order} action={action} returnable={returnable.data} onCancel={onClose} onBusyChange={setBusy} onCompleted={(changed) => onChanged(changed, action)} />}
  </section></div>
}

function OrderDetailDialog({ order, canWrite, onClose, onChanged }: { order: ProcurementOrder; canWrite: boolean; onClose: () => void; onChanged: (order: ProcurementOrder) => void }) {
  const [action, setAction] = useState<OrderAction>()
  const [busy, setBusy] = useState(false)
  const [activityRefreshKey, setActivityRefreshKey] = useState(0)
  const [receipts, setReceipts] = useState<LoadState<ProcurementReceipt[]>>({ status: 'loading' })
  const [returns, setReturns] = useState<LoadState<ProcurementReturn[]>>({ status: 'loading' })
  const [returnable, setReturnable] = useState<ProcurementReturnableOrder>()

  useEffect(() => {
    const controller = new AbortController()
    setReceipts({ status: 'loading' }); setReturns({ status: 'loading' }); setReturnable(undefined)
    void procurementReceiptApi.forOrder(order.purchaseOrderId, 0, 100, controller.signal).then(
      (page) => setReceipts({ status: 'ready', data: page.items }),
      () => { if (!controller.signal.aborted) setReceipts({ status: 'error', message: '无法读取收货记录。' }) },
    )
    void procurementReturnApi.list({ searchField: 'PURCHASE_NO', keyword: order.purchaseNo, page: 0, size: 100, signal: controller.signal }).then(
      (page) => setReturns({ status: 'ready', data: page.items }),
      () => { if (!controller.signal.aborted) setReturns({ status: 'error', message: '无法读取退货记录。' }) },
    )
    if (order.receivedQuantity > 0) {
      void procurementReturnApi.returnableOrders(order.purchaseNo, 0, 100, controller.signal).then(
        (page) => setReturnable(page.items.find((item) => item.purchaseOrderId === order.purchaseOrderId)),
        () => undefined,
      )
    }
    return () => controller.abort()
  }, [order.purchaseOrderId, order.purchaseNo, order.receivedQuantity, activityRefreshKey])

  return <div className="dialog-backdrop" role="presentation"><section className="write-dialog inventory-count-create-dialog" role="dialog" aria-modal="true" aria-labelledby="order-detail-title">
    <header className="table-heading"><div><h2 id="order-detail-title">采购单 {order.purchaseNo}</h2><span>{statusLabel[order.status]}{order.planNo ? ` · 历史计划 ${order.planNo}` : ' · 直接创建'}</span></div><DialogCloseButton disabled={busy} onClick={onClose} /></header>
    <dl className="shop-detail-grid"><div><dt>供应商</dt><dd>{order.supplierCode} · {order.supplierName}</dd></div><div><dt>供应商 SKU</dt><dd>{order.supplierSkuCode ?? '—'}</dd></div><div><dt>商品</dt><dd>{order.skuCode} · {order.skuName}{order.skuVariant ? ` · ${order.skuVariant}` : ''}</dd></div><div><dt>采购 / 已收 / 待收</dt><dd>{order.quantity} / {order.receivedQuantity} / {order.quantity - order.receivedQuantity}</dd></div><div><dt>目标仓库</dt><dd>{order.warehouseCode} · {order.warehouseName}</dd></div><div><dt>目标库位</dt><dd>{order.locationCode} · {order.locationName}</dd></div><div><dt>下单人 / 时间</dt><dd>{order.orderedByDisplayName} · {new Date(order.createdAt).toLocaleString()}</dd></div><div><dt>审核</dt><dd>{order.reviewedByDisplayName ? `${order.reviewedByDisplayName} · ${order.reviewedAt ? new Date(order.reviewedAt).toLocaleString() : '—'}` : '待审核'}{order.reviewNote ? <><br /><small>{order.reviewNote}</small></> : null}</dd></div><div><dt>最近收货</dt><dd>{order.lastReceivedAt ? new Date(order.lastReceivedAt).toLocaleString() : '—'}</dd></div><div><dt>订单备注</dt><dd>{order.orderNote ?? '—'}</dd></div></dl>
    {action && <OrderActionForm order={order} action={action} returnable={returnable} onCancel={() => setAction(undefined)} onBusyChange={setBusy} onCompleted={(changed) => { setAction(undefined); setActivityRefreshKey((value) => value + 1); onChanged(changed) }} />}
    <section className="procurement-order-activity" aria-label="采购单业务记录"><h3>收货与退货记录</h3>{receipts.status === 'loading' || returns.status === 'loading' ? <p role="status">正在读取业务记录…</p> : null}{receipts.status === 'error' && <div className="inline-alert" role="alert">{receipts.message}</div>}{returns.status === 'error' && <div className="inline-alert" role="alert">{returns.message}</div>}{receipts.status === 'ready' && returns.status === 'ready' && receipts.data.length === 0 && returns.data.length === 0 ? <p>尚无收货或退货记录。</p> : <div className="warehouse-archive-table-wrap"><table><thead><tr><th>类型</th><th>数量</th><th>操作人</th><th>时间</th><th>结果</th></tr></thead><tbody>{receipts.status === 'ready' && receipts.data.map((receipt) => <tr key={receipt.receiptId}><td>收货入库</td><td>+{receipt.quantity}</td><td>{receipt.receivedByDisplayName}</td><td>{new Date(receipt.receivedAt).toLocaleString()}</td><td>库存 {receipt.inventoryBalanceAfter}</td></tr>)}{returns.status === 'ready' && returns.data.map((item) => <tr key={item.purchaseReturnId}><td>采购退货</td><td>-{item.quantity}</td><td>{item.returnedByDisplayName}</td><td>{new Date(item.returnedAt).toLocaleString()}</td><td>{item.reason}</td></tr>)}</tbody></table></div>}</section>
    <footer className="form-actions">{canWrite && order.status === 'NEW_ORDER' && <><button className="button button-primary" type="button" disabled={busy} onClick={() => setAction('APPROVE')}>批准</button><button className="button button-danger" type="button" disabled={busy} onClick={() => setAction('REJECT')}>驳回</button></>}{canWrite && (order.status === 'APPROVED' || order.status === 'PARTIALLY_RECEIVED') && <button className="button button-primary" type="button" disabled={busy} onClick={() => setAction('RECEIVE')}>确认收货</button>}{canWrite && returnable && returnable.returnableQuantity > 0 && <button type="button" disabled={busy} onClick={() => setAction('RETURN')}>发起退货</button>}<button className="text-button" type="button" disabled={busy} onClick={onClose}>关闭</button></footer>
  </section></div>
}

function OrderRowActions({ order, canWrite, onAction, onDetail }: { order: ProcurementOrder; canWrite: boolean; onAction: (action: OrderAction) => void; onDetail: () => void }) {
  return <div className="procurement-order-row-actions">
    {canWrite && order.status === 'NEW_ORDER' && <><button className="text-button is-primary" type="button" onClick={() => onAction('APPROVE')}>通过</button><button className="text-button is-danger" type="button" onClick={() => onAction('REJECT')}>驳回</button></>}
    {canWrite && order.status === 'APPROVED' && <button className="text-button is-primary" type="button" onClick={() => onAction('RECEIVE')}>确认收货</button>}
    {canWrite && order.status === 'PARTIALLY_RECEIVED' && <><button className="text-button is-primary" type="button" onClick={() => onAction('RECEIVE')}>继续收货</button><details className="erp-action-menu order-row-action-menu procurement-order-row-menu"><summary className="text-button" aria-label={`${order.purchaseNo} 更多操作`}>更多</summary><div className="erp-action-menu-popover"><button type="button" onClick={() => onAction('RETURN')}>发起退货</button></div></details></>}
    {canWrite && order.status === 'RECEIVED' && order.receivedQuantity > 0 && <button className="text-button" type="button" onClick={() => onAction('RETURN')}>退货</button>}
    <button className="text-button" type="button" onClick={onDetail}>详情</button>
  </div>
}

export function ProcurementOrderPage() {
  const router = useRouter(); const search = useRouterState({ select: (state) => state.location.searchStr })
  const query = useMemo(() => parseProcurementOrderQuery(search), [search])
  const { hasPermission } = useAuth(); const canWrite = hasPermission('procurement.write')
  const [list, setList] = useState<LoadState<OrderPage>>({ status: 'loading' })
  const [refreshKey, setRefreshKey] = useState(0); const [creating, setCreating] = useState(() => canWrite && Boolean(query.createPlanNo)); const [detail, setDetail] = useState<ProcurementOrder>()
  const [detailError, setDetailError] = useState<string>(); const [detailRefreshKey, setDetailRefreshKey] = useState(0)
  const [filterError, setFilterError] = useState<string>()
  const [exporting, setExporting] = useState(false)
  const [exportFeedback, setExportFeedback] = useState<{ kind: 'success' | 'error'; message: string; queryKey: string }>()
  const [listAction, setListAction] = useState<ListOrderAction>()
  const [operationFeedback, setOperationFeedback] = useState<string>()

  useEffect(() => {
    if (!operationFeedback) return
    const timer = window.setTimeout(() => setOperationFeedback(undefined), 4_000)
    return () => window.clearTimeout(timer)
  }, [operationFeedback])

  useEffect(() => {
    const controller = new AbortController(); setList({ status: 'loading' })
    void procurementOrderApi.list({ searchField: query.searchField, keyword: query.keyword, status: query.status || undefined, createdFrom: startInstant(query.createdFrom), createdTo: endInstant(query.createdTo), page: query.page, size: query.size, signal: controller.signal }).then(
      (data) => {
        const lastPage = Math.max(data.totalPages - 1, 0)
        if (query.page > lastPage) { router.history.push(toProcurementOrderUrl({ ...query, page: lastPage })); return }
        setList({ status: 'ready', data })
      },
      (error) => { if (!(error instanceof DOMException && error.name === 'AbortError')) setList({ status: 'error', message: '暂时无法读取采购单，请稍后重试。' }) },
    )
    return () => controller.abort()
  }, [query, refreshKey])

  useEffect(() => {
    if (!query.detailId) { setDetail(undefined); setDetailError(undefined); return }
    let active = true
    setDetail((current) => current?.purchaseOrderId === query.detailId ? current : undefined)
    setDetailError(undefined)
    void procurementOrderApi.get(query.detailId).then(
      (order) => { if (active) setDetail(order) },
      () => { if (active) { setDetail(undefined); setDetailError('暂时无法读取这张采购单，请稍后重试。') } },
    )
    return () => { active = false }
  }, [query.detailId, detailRefreshKey])

  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const data = new FormData(event.currentTarget); const createdFrom = date(String(data.get('createdFrom') ?? '')); const createdTo = date(String(data.get('createdTo') ?? '')); if (createdFrom && createdTo && createdFrom > createdTo) { setFilterError('下单起始日期不能晚于截止日期。'); return } setFilterError(undefined); router.history.push(toProcurementOrderUrl({ searchField: oneOf(String(data.get('searchField') ?? ''), searchFields.map((item) => item.value), 'PURCHASE_NO'), keyword: bounded(String(data.get('keyword') ?? ''), 120), status: oneOf(String(data.get('status') ?? ''), ['', 'NEW_ORDER', 'APPROVED', 'REJECTED', 'PARTIALLY_RECEIVED', 'RECEIVED'] as const, ''), createdFrom, createdTo, page: 0, size: query.size })) }

  const exportQueryKey = toProcurementOrderUrl(query)
  const exportOrders = async () => {
    const queryKey = exportQueryKey
    setExporting(true); setExportFeedback(undefined)
    try {
      const result = await procurementOrderApi.exportCsv({
        status: query.status || undefined, searchField: query.searchField,
        keyword: query.keyword, createdFrom: startInstant(query.createdFrom),
        createdTo: endInstant(query.createdTo),
      })
      const url = URL.createObjectURL(new Blob([result.content], { type: result.mediaType }))
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = result.filename
      document.body.append(anchor)
      try { anchor.click() } finally { anchor.remove(); URL.revokeObjectURL(url) }
      setExportFeedback({ kind: 'success', message: `已导出 ${result.rowCount} 条采购单。`, queryKey })
    } catch (error) {
      setExportFeedback({ kind: 'error', message: exportMessage(error), queryKey })
    } finally { setExporting(false) }
  }

  return <main className="warehouse-archive-page procurement-order-page" aria-labelledby="procurement-order-title">
    <header className="warehouse-archive-heading"><div><p className="eyebrow">供应链 / 采购</p><h1 id="procurement-order-title">采购单</h1><p>在一张采购单内完成下单、审核、收货、退货和记录追溯。</p></div><div className="warehouse-archive-actions"><button type="button" disabled={exporting || list.status !== 'ready' || list.data.totalElements === 0} onClick={() => void exportOrders()}>{exporting ? '正在导出…' : '导出筛选结果'}</button>{canWrite && <button className="button button-primary" type="button" onClick={() => setCreating(true)}>新增采购单</button>}</div></header>
    <section className="warehouse-archive-card" aria-label="采购单筛选与列表">
      <nav className="procurement-order-status-tabs" aria-label="采购单状态视图">{statusViews.map((view) => <button key={view.value || 'ALL'} type="button" aria-current={query.status === view.value ? 'page' : undefined} onClick={() => router.history.push(toProcurementOrderUrl({ ...query, status: view.value, page: 0, detailId: '' }))}>{view.label}</button>)}</nav>
      <form className="warehouse-archive-filters procurement-order-filters" key={toProcurementOrderUrl(query)} onSubmit={submit}>
        <input type="hidden" name="status" value={query.status} />
        <label>搜索字段<select name="searchField" defaultValue={query.searchField}>{searchFields.map((field) => <option key={field.value} value={field.value}>{field.label}</option>)}</select></label>
        <label className="procurement-plan-keyword">关键词<input name="keyword" defaultValue={query.keyword} maxLength={120} /></label>
        <label>下单起始日期<input name="createdFrom" type="date" defaultValue={query.createdFrom} /></label><label>下单截止日期<input name="createdTo" type="date" defaultValue={query.createdTo} /></label>
        <div className="warehouse-archive-filter-actions"><button className="is-primary" type="submit">搜索</button><button type="button" onClick={() => router.history.push('/procurement/orders')}>重置</button><button type="button" onClick={() => setRefreshKey((value) => value + 1)}>刷新</button></div>
      </form>
      {filterError && <div className="inline-alert" role="alert">{filterError}</div>}
      {exportFeedback?.queryKey === exportQueryKey && <p className={`warehouse-export-feedback is-${exportFeedback.kind}`} role={exportFeedback.kind === 'error' ? 'alert' : 'status'}>{exportFeedback.message}</p>}
      {operationFeedback && <p className="warehouse-export-feedback is-success" role="status" aria-live="polite">{operationFeedback}</p>}
      {list.status === 'loading' && <div className="warehouse-archive-empty" role="status"><strong>正在读取采购单…</strong></div>}
      {list.status === 'error' && <div className="inline-alert" role="alert">{list.message}<button type="button" onClick={() => setRefreshKey((value) => value + 1)}>重试</button></div>}
      {list.status === 'ready' && <><div className="warehouse-archive-table-wrap"><table aria-label="采购单列表"><thead><tr><th>采购单号</th><th>供应商</th><th>商品</th><th>目标仓库 / 库位</th><th>采购 / 已收 / 待收</th><th>下单人 / 时间</th><th>订单备注</th><th>状态</th><th>操作</th></tr></thead><tbody>{list.data.items.length === 0 ? <tr><td colSpan={9}><div className="warehouse-archive-empty" role="status"><strong>无相关采购单</strong><span>{canWrite ? '可通过“新增采购单”直接创建第一张采购单。' : '当前筛选条件下没有可查看的采购单。'}</span></div></td></tr> : list.data.items.map((order) => <tr key={order.purchaseOrderId}><td>{order.purchaseNo}{order.planNo ? <><br /><small>历史计划 {order.planNo}</small></> : null}</td><td>{order.supplierCode} · {order.supplierName}<br /><small>{order.supplierSkuCode ?? '无供应商 SKU'}</small></td><td>{order.skuCode} · {order.skuName}<br /><small>{order.skuVariant ?? '—'}</small></td><td>{order.warehouseName}<br /><small>{order.locationCode} · {order.locationName}</small></td><td>{order.quantity} / {order.receivedQuantity} / {order.quantity - order.receivedQuantity}</td><td>{order.orderedByDisplayName}<br /><time dateTime={order.createdAt}>{new Date(order.createdAt).toLocaleString()}</time></td><td>{order.orderNote ?? '—'}</td><td><span className={`status-badge is-${order.status.toLowerCase()}`}>{statusLabel[order.status]}</span></td><td><OrderRowActions order={order} canWrite={canWrite} onAction={(action) => setListAction({ order, action })} onDetail={() => { setDetail(order); router.history.push(toProcurementOrderUrl({ ...query, detailId: order.purchaseOrderId })) }} /></td></tr>)}</tbody></table></div>
        <div className="procurement-plan-table-footer"><span>共 {list.data.totalElements} 条</span><label>每页<select value={query.size} onChange={(event) => router.history.push(toProcurementOrderUrl({ ...query, page: 0, size: Number(event.target.value) }))}>{PAGE_SIZES.map((size) => <option key={size} value={size}>{size} 条</option>)}</select></label><div className="pagination"><button type="button" disabled={query.page === 0} onClick={() => router.history.push(toProcurementOrderUrl({ ...query, page: query.page - 1 }))}>上一页</button><span>第 {query.page + 1} / {Math.max(list.data.totalPages, 1)} 页</span><button type="button" disabled={query.page + 1 >= list.data.totalPages} onClick={() => router.history.push(toProcurementOrderUrl({ ...query, page: query.page + 1 }))}>下一页</button></div></div></>}
    </section>
    {detailError && <div className="inline-alert" role="alert">{detailError}<button type="button" onClick={() => setDetailRefreshKey((value) => value + 1)}>重试详情</button><button type="button" onClick={() => router.history.push(toProcurementOrderUrl({ ...query, detailId: '' }))}>返回列表</button></div>}
    {creating && <CreateOrderDialog initialPlanNo={query.createPlanNo} onClose={() => { setCreating(false); if (query.createPlanNo) router.history.push(toProcurementOrderUrl({ ...query, createPlanNo: '' })) }} onCreated={(order) => { setCreating(false); setDetail(order); setRefreshKey((value) => value + 1); router.history.push(toProcurementOrderUrl({ ...query, createPlanNo: '', detailId: order.purchaseOrderId })) }} />}
    {listAction && <OrderActionDialog selection={listAction} onClose={() => setListAction(undefined)} onChanged={(changed, action) => { setListAction(undefined); setOperationFeedback(actionSuccessMessage[action]); setList((current) => current.status === 'ready' ? { status: 'ready', data: { ...current.data, items: current.data.items.map((item) => item.purchaseOrderId === changed.purchaseOrderId ? changed : item) } } : current); setRefreshKey((value) => value + 1) }} />}
    {detail && <OrderDetailDialog order={detail} canWrite={canWrite} onClose={() => { setDetail(undefined); if (query.detailId) router.history.push(toProcurementOrderUrl({ ...query, detailId: '' })) }} onChanged={(order) => { setDetail(order); setRefreshKey((value) => value + 1) }} />}
  </main>
}
