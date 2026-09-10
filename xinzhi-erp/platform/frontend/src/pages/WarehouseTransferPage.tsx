import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useRouterState } from '@tanstack/react-router'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { CurrencyCodeInput } from '../components/CurrencyCodeInput'
import { ConfirmationDialog } from '../components/ConfirmationDialog'
import { DialogCloseButton } from '../components/DialogCloseButton'
import { optionalAmountCurrencyError } from '../modules/currencyInput'
import { inventoryApi, type InventoryBalance, type Page } from '../modules/inventoryApi'
import {
  inventoryTransferApi,
  type WarehouseTransferAction,
  type WarehouseTransferDetail,
  type WarehouseTransferPage as WarehouseTransferPageData,
  type WarehouseTransferStatus,
  type WarehouseTransferTransportMode,
} from '../modules/inventoryTransferApi'
import { warehouseCenterApi, type Warehouse } from '../modules/warehouseCenterApi'
import { parseWarehouseArchiveQuery, toWarehouseArchiveUrl } from './WarehouseArchiveShells'
import './WarehouseArchiveShells.css'

type LoadState<T> = { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; message: string }
const PAGE_SIZES = [20, 50, 100, 200] as const
const REFERENCE_PAGE_SIZE = 200
const MAX_WAREHOUSE_REFERENCE_PAGES = 100
const MAX_TRANSFER_LINES = 200

const tabs = [
  { value: 'RECEIPT', label: '仓库调拨签收' },
  { value: 'SHIPMENT', label: '仓库调拨发货' },
  { value: 'APPROVAL', label: '分仓调拨审核' },
] as const

const statusLabels: Record<WarehouseTransferStatus, string> = {
  DRAFT: '新调拨单', APPROVAL: '审核中', READY_TO_SHIP: '待发货', IN_TRANSIT: '待签收', PARTIALLY_RECEIVED: '部分签收', RECEIVED: '已签收', REJECTED: '未通过', CANCELLED: '已作废',
}
const transportLabels: Record<WarehouseTransferTransportMode, string> = {
  UNSET: '未设置', LAND: '陆地运输', AIR: '空运', SEA: '海运',
}
const tabStatus: Partial<Record<string, WarehouseTransferStatus>> = {
  APPROVAL: 'APPROVAL', SHIPMENT: 'READY_TO_SHIP', RECEIPT: 'IN_TRANSIT',
}

function commandId() { return crypto.randomUUID() }
function today() { return new Date().toISOString().slice(0, 10) }
function actionMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 409) {
    const reason = error.details && typeof error.details === 'object' && 'reason' in error.details
      ? String(error.details.reason)
      : undefined
    if (reason === 'insufficient_available_inventory') return '起始仓可用库存不足，请核对库存后重试。'
    if (reason === 'transfer_balance_changed') return '调拨商品与起始仓库存记录不一致，请重新创建调拨单。'
    if (reason === 'master_data_inactive') return '商品或仓库已停用，当前调拨不能继续处理。'
    if (reason === 'stale_version') return '起始仓库存已更新，请重新打开调拨详情后重试。'
    if (reason === 'invalid_transfer_state') return '调拨单状态已经变化，请重新打开调拨详情后重试。'
    return '库存或调拨单状态已经变化，请刷新后重试。'
  }
  if (error instanceof ApiError && error.status === 403) return '当前账号没有执行该调拨操作的权限。'
  return '暂时无法完成调拨操作，请稍后重试。'
}
function exportMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 409) return '导出结果超过 10,000 条，请缩小筛选范围后重试。'
  if (error instanceof ApiError && error.status === 403) return '当前账号没有导出分仓调拨的权限。'
  return '暂时无法导出分仓调拨，请稍后重试。'
}
async function activeWarehouses() {
  const first = await warehouseCenterApi.listWarehouses({ status: 'ACTIVE', page: 0, size: REFERENCE_PAGE_SIZE })
  if (first.page !== 0 || first.size !== REFERENCE_PAGE_SIZE || first.totalPages > MAX_WAREHOUSE_REFERENCE_PAGES) throw new Error('Invalid warehouse pages')
  const items = [...first.items]
  for (let page = 1; page < first.totalPages; page += 1) {
    const next = await warehouseCenterApi.listWarehouses({ status: 'ACTIVE', page, size: REFERENCE_PAGE_SIZE })
    if (next.page !== page || next.size !== REFERENCE_PAGE_SIZE || next.totalPages !== first.totalPages || next.totalElements !== first.totalElements) throw new Error('Warehouse pages changed while loading')
    items.push(...next.items)
  }
  if (items.length !== first.totalElements || new Set(items.map((item) => item.id)).size !== items.length) throw new Error('Warehouse pages are incomplete')
  return items
}

function TransferDetailDialog({ detail, canWrite, onClose, onChanged }: {
  detail: WarehouseTransferDetail
  canWrite: boolean
  onClose: () => void
  onChanged: (detail: WarehouseTransferDetail) => void
}) {
  const [busy, setBusy] = useState<WarehouseTransferAction | 'receive-partial'>()
  const [error, setError] = useState<string>()
  const [pendingAction, setPendingAction] = useState<WarehouseTransferAction>()
  const [partialOpen, setPartialOpen] = useState(false)
  const [receiptQuantities, setReceiptQuantities] = useState<Record<string, string>>({})
  const [receiptCommandId, setReceiptCommandId] = useState(commandId)
  const run = async (action: WarehouseTransferAction) => {
    setPendingAction(undefined)
    setBusy(action); setError(undefined)
    try { onChanged(await inventoryTransferApi.transition(detail.summary.id, action, detail.summary.version, commandId())) }
    catch (cause) { setError(actionMessage(cause)) } finally { setBusy(undefined) }
  }
  const { summary, lines } = detail
  const confirmation = pendingAction ? {
    submit: { title: '提交调拨审批', description: '提交后，该调拨单将进入审核队列。', confirmLabel: '确认提交' },
    approve: { title: '审核通过', description: '审核通过后，该调拨单将进入待发货状态。', confirmLabel: '确认通过' },
    reject: { title: '驳回调拨单', description: '驳回后，该调拨单不能继续发货。', confirmLabel: '确认驳回' },
    ship: { title: '确认发货', description: '发货后，将扣减起始仓的可用库存并生成库存流水。', confirmLabel: '确认发货' },
    receive: { title: '确认全部签收', description: '签收后，将把全部待签收数量增加到目标仓库存。', confirmLabel: '确认签收' },
    cancel: { title: '作废调拨单', description: '作废后，该调拨单不能继续处理。', confirmLabel: '确认作废' },
  }[pendingAction] : undefined
  const receivePartial = async () => {
    const receiptLines: Array<{ lineId: string; quantity: number }> = []
    for (const line of lines) {
      const raw = receiptQuantities[line.id]?.trim()
      if (!raw) continue
      const quantity = Number(raw)
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > line.remainingQuantity) {
        setError(`${line.skuCode} 的本次签收数量必须为不超过待签收数量的正整数。`)
        return
      }
      receiptLines.push({ lineId: line.id, quantity })
    }
    if (!receiptLines.length) { setError('请至少填写一个 SKU 的本次签收数量。'); return }
    const requested = receiptLines.reduce((total, line) => total + line.quantity, 0)
    const remaining = lines.reduce((total, line) => total + line.remainingQuantity, 0)
    if (requested >= remaining) { setError('全部签收请使用“确认全部签收”。'); return }
    setBusy('receive-partial'); setError(undefined)
    try {
      const changed = await inventoryTransferApi.receivePartial(
        summary.id, summary.version, receiptCommandId, receiptLines,
      )
      setReceiptQuantities({}); setReceiptCommandId(commandId()); setPartialOpen(false); onChanged(changed)
    } catch (cause) { setError(actionMessage(cause)) } finally { setBusy(undefined) }
  }
  return <><div className="dialog-backdrop" role="presentation"><section className="write-dialog inventory-count-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="transfer-detail-title">
    <header className="table-heading"><div><h2 id="transfer-detail-title">调拨批次 {summary.transferNo}</h2><span>{summary.sourceWarehouseName} → {summary.targetWarehouseName} · {statusLabels[summary.status]}</span></div><DialogCloseButton disabled={Boolean(busy)} onClick={onClose} /></header>
    <dl className="inventory-count-summary-grid"><div><dt>调拨日期</dt><dd>{summary.transferDate}</dd></div><div><dt>运输方式</dt><dd>{transportLabels[summary.transportMode]}</dd></div><div><dt>调拨数量</dt><dd>{summary.totalQuantity}</dd></div><div><dt>物流单号</dt><dd>{summary.trackingNo ?? '—'}</dd></div><div><dt>操作人</dt><dd>{summary.operatorDisplayName}</dd></div><div><dt>审核人</dt><dd>{summary.approverDisplayName ?? '—'}</dd></div><div><dt>发货人</dt><dd>{summary.shipperDisplayName ?? '—'}</dd></div><div><dt>签收人</dt><dd>{summary.receiverDisplayName ?? '—'}</dd></div></dl>
    <div className="warehouse-archive-table-wrap"><table aria-label="调拨商品明细"><thead><tr><th>库存 SKU</th><th>中文名称</th><th>库存快照</th><th>可用库存快照</th><th>调拨数量</th><th>已签收</th><th>待签收</th><th>发货流水</th><th>签收流水</th></tr></thead><tbody>{lines.map((line) => <tr key={line.id}><td>{line.skuCode}</td><td>{line.skuName}</td><td>{line.snapshotOnHand}</td><td>{line.snapshotAvailable}</td><td>{line.quantity}</td><td>{line.receivedQuantity}</td><td>{line.remainingQuantity}</td><td>{line.shipmentEventId ? '已记账' : '—'}</td><td>{line.receiptEventId ? '已记账' : '—'}</td></tr>)}</tbody></table></div>
    {(summary.note || summary.logisticsChannel || summary.expectedShipAt || summary.expectedArrivalAt) && <div className="transfer-detail-notes"><span>物流渠道：{summary.logisticsChannel ?? '—'}</span><span>期望发货：{summary.expectedShipAt ? new Date(summary.expectedShipAt).toLocaleString() : '—'}</span><span>期望到货：{summary.expectedArrivalAt ? new Date(summary.expectedArrivalAt).toLocaleString() : '—'}</span><span>备注：{summary.note ?? '—'}</span></div>}
    {partialOpen && <section className="transfer-partial-receipt" aria-labelledby="partial-receipt-title"><div className="table-heading"><div><h3 id="partial-receipt-title">本次部分签收</h3><span>只会将本次填写的数量入库，其余数量保持待签收</span></div></div><div className="warehouse-archive-table-wrap"><table aria-label="部分签收数量"><thead><tr><th>库存 SKU</th><th>待签收</th><th>本次签收</th></tr></thead><tbody>{lines.filter((line) => line.remainingQuantity > 0).map((line) => <tr key={line.id}><td>{line.skuCode}</td><td>{line.remainingQuantity}</td><td><label className="sr-only" htmlFor={`receipt-${line.id}`}>{line.skuCode} 本次签收数量</label><input id={`receipt-${line.id}`} type="number" min={1} max={line.remainingQuantity} inputMode="numeric" disabled={Boolean(busy)} value={receiptQuantities[line.id] ?? ''} placeholder="留空跳过" onChange={(event) => { setError(undefined); setReceiptQuantities((current) => ({ ...current, [line.id]: event.target.value })) }} /></td></tr>)}</tbody></table></div><div className="form-actions"><button className="text-button" type="button" disabled={Boolean(busy)} onClick={() => setPartialOpen(false)}>取消</button><button className="button button-primary" type="button" disabled={Boolean(busy)} onClick={() => void receivePartial()}>{busy === 'receive-partial' ? '正在签收入库…' : '确认本次签收'}</button></div></section>}
    {error && <div className="inline-alert" role="alert">{error}</div>}
    <footer className="form-actions"><button className="text-button" type="button" disabled={Boolean(busy)} onClick={onClose}>返回</button>
      {canWrite && summary.status === 'DRAFT' && <><button className="button button-danger" type="button" disabled={Boolean(busy)} onClick={() => setPendingAction('cancel')}>作废</button><button className="button button-primary" type="button" disabled={Boolean(busy)} onClick={() => setPendingAction('submit')}>提交审核</button></>}
      {canWrite && summary.status === 'APPROVAL' && <><button className="button button-danger" type="button" disabled={Boolean(busy)} onClick={() => setPendingAction('reject')}>驳回</button><button className="button button-secondary" type="button" disabled={Boolean(busy)} onClick={() => setPendingAction('cancel')}>作废</button><button className="button button-primary" type="button" disabled={Boolean(busy)} onClick={() => setPendingAction('approve')}>审核通过</button></>}
      {canWrite && summary.status === 'READY_TO_SHIP' && <><button className="button button-danger" type="button" disabled={Boolean(busy)} onClick={() => setPendingAction('cancel')}>作废</button><button className="button button-primary" type="button" disabled={Boolean(busy)} onClick={() => setPendingAction('ship')}>确认发货</button></>}
      {canWrite && (summary.status === 'IN_TRANSIT' || summary.status === 'PARTIALLY_RECEIVED') && <><button className="button button-secondary" type="button" disabled={Boolean(busy)} onClick={() => { setError(undefined); setPartialOpen(true) }}>部分签收</button><button className="button button-primary" type="button" disabled={Boolean(busy)} onClick={() => setPendingAction('receive')}>确认全部签收</button></>}
    </footer>
  </section></div>
  {pendingAction && confirmation && <ConfirmationDialog
    title={confirmation.title}
    description={confirmation.description}
    confirmLabel={confirmation.confirmLabel}
    busy={busy === pendingAction}
    destructive={pendingAction === 'reject' || pendingAction === 'cancel'}
    onClose={() => setPendingAction(undefined)}
    onConfirm={() => void run(pendingAction)}
  />}
  </>
}

function CreateTransferDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (detail: WarehouseTransferDetail) => void }) {
  const [warehouses, setWarehouses] = useState<LoadState<Warehouse[]>>({ status: 'loading' })
  const [warehouseReload, setWarehouseReload] = useState(0)
  const [sourceWarehouseId, setSourceWarehouseId] = useState('')
  const [targetWarehouseId, setTargetWarehouseId] = useState('')
  const [transferDate, setTransferDate] = useState(today())
  const [transportMode, setTransportMode] = useState<WarehouseTransferTransportMode>('UNSET')
  const [allocationMethod, setAllocationMethod] = useState<'WEIGHT' | 'VOLUMETRIC_WEIGHT' | 'VOLUME'>('WEIGHT')
  const [freight, setFreight] = useState('')
  const [currency, setCurrency] = useState('CNY')
  const [logisticsChannel, setLogisticsChannel] = useState('')
  const [trackingNo, setTrackingNo] = useState('')
  const [expectedShipAt, setExpectedShipAt] = useState('')
  const [expectedArrivalAt, setExpectedArrivalAt] = useState('')
  const [note, setNote] = useState('')
  const [balancePage, setBalancePage] = useState(0)
  const [balanceReload, setBalanceReload] = useState(0)
  const [balances, setBalances] = useState<LoadState<Page<InventoryBalance>>>({ status: 'ready', data: { items: [], page: 0, size: REFERENCE_PAGE_SIZE, totalElements: 0, totalPages: 0 } })
  const [loadedBalances, setLoadedBalances] = useState<Record<string, InventoryBalance>>({})
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [freightError, setFreightError] = useState<string>()
  const [pendingCommandId, setPendingCommandId] = useState(commandId)
  const changed = () => { if (error) setPendingCommandId(commandId()); setError(undefined); setFreightError(undefined) }

  useEffect(() => { let active = true; setWarehouses({ status: 'loading' }); void activeWarehouses().then((data) => { if (active) setWarehouses({ status: 'ready', data }) }, () => { if (active) setWarehouses({ status: 'error', message: '无法读取可用仓库。' }) }); return () => { active = false } }, [warehouseReload])
  useEffect(() => {
    let active = true
    if (!sourceWarehouseId) { setBalances({ status: 'ready', data: { items: [], page: 0, size: REFERENCE_PAGE_SIZE, totalElements: 0, totalPages: 0 } }); return () => { active = false } }
    setBalances({ status: 'loading' })
    void inventoryApi.listBalances({ warehouseId: sourceWarehouseId, page: balancePage, size: REFERENCE_PAGE_SIZE }).then((page) => {
      if (!active) return
      if (page.page !== balancePage || page.size !== REFERENCE_PAGE_SIZE || page.items.some((balance) => balance.warehouseId !== sourceWarehouseId)) {
        setBalances({ status: 'error', message: '起始仓库存分页结果不一致，请重试当前页。' })
        return
      }
      setLoadedBalances((current) => Object.fromEntries([...Object.values(current), ...page.items].map((balance) => [balance.id, balance])))
      setBalances({ status: 'ready', data: page })
    }, () => { if (active) setBalances({ status: 'error', message: '无法读取起始仓库存。' }) })
    return () => { active = false }
  }, [balancePage, balanceReload, sourceWarehouseId])

  const save = async (submit: boolean) => {
    if (busy || balances.status !== 'ready') return
    if (!sourceWarehouseId || !targetWarehouseId || sourceWarehouseId === targetWarehouseId) { setError('请选择不同的起始仓库和目标仓库。'); return }
    const lines: Array<{ balanceId: string; quantity: number }> = []
    for (const balance of Object.values(loadedBalances)) {
      const raw = quantities[balance.id]?.trim(); if (!raw) continue
      const quantity = Number(raw)
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > Math.min(balance.available, 1_000_000_000)) { setError(`${balance.skuBusinessCode} 的调拨数量必须为不超过可用库存的正整数。`); return }
      lines.push({ balanceId: balance.id, quantity })
    }
    if (!lines.length) { setError('请至少填写一个库存 SKU 的调拨数量。'); return }
    if (lines.length > MAX_TRANSFER_LINES) { setError(`单个调拨批次最多包含 ${MAX_TRANSFER_LINES} 个库存 SKU。`); return }
    let freightAmountMinor: number | undefined
    if (freight.trim()) {
      freightAmountMinor = Number(freight)
      if (!Number.isSafeInteger(freightAmountMinor) || freightAmountMinor < 0) { setFreightError('运费必须是非负整数（最小货币单位）。'); return }
      const currencyError = optionalAmountCurrencyError(freight, currency, '运费')
      if (currencyError) { setFreightError(currencyError); return }
    }
    if (expectedShipAt && expectedArrivalAt && expectedArrivalAt < expectedShipAt) { setError('期望到货时间不能早于期望发货时间。'); return }
    setBusy(true); setError(undefined)
    try {
      onCreated(await inventoryTransferApi.create({
        commandId: pendingCommandId, sourceWarehouseId, targetWarehouseId, transferDate, transportMode,
        freightAmountMinor, currencyCode: freightAmountMinor === undefined ? undefined : currency.toUpperCase(),
        logisticsChannel: logisticsChannel.trim() || undefined, trackingNo: trackingNo.trim() || undefined,
        allocationMethod, expectedShipAt: expectedShipAt ? new Date(expectedShipAt).toISOString() : undefined,
        expectedArrivalAt: expectedArrivalAt ? new Date(expectedArrivalAt).toISOString() : undefined,
        note: note.trim() || undefined, submit, lines,
      }))
    } catch (cause) { setError(actionMessage(cause)) } finally { setBusy(false) }
  }

  return <div className="dialog-backdrop" role="presentation"><section className="write-dialog inventory-count-create-dialog transfer-create-dialog" role="dialog" aria-modal="true" aria-labelledby="create-transfer-title">
    <header className="table-heading"><div><h2 id="create-transfer-title">手工添加调拨批次</h2><span>批次号由系统生成；发货时扣减起始仓库存，签收时增加目标仓库存</span></div><DialogCloseButton disabled={busy} onClick={onClose} /></header>
    <div className="inventory-count-form-grid transfer-form-grid">
      <label>调拨日期<input type="date" value={transferDate} disabled={busy} onChange={(event) => { changed(); setTransferDate(event.target.value) }} /></label>
      <label>* 起始仓库<select value={sourceWarehouseId} disabled={busy || warehouses.status !== 'ready'} onChange={(event) => { changed(); setSourceWarehouseId(event.target.value); setBalancePage(0); setLoadedBalances({}); setQuantities({}); if (event.target.value === targetWarehouseId) setTargetWarehouseId('') }}><option value="">-选择起始仓库-</option>{warehouses.status === 'ready' && warehouses.data.map((warehouse) => <option value={warehouse.id} key={warehouse.id}>{warehouse.name} · {warehouse.businessCode}</option>)}</select></label>
      <label>* 目标仓库<select value={targetWarehouseId} disabled={busy || warehouses.status !== 'ready'} onChange={(event) => { changed(); setTargetWarehouseId(event.target.value) }}><option value="">-选择目标仓库-</option>{warehouses.status === 'ready' && warehouses.data.filter((warehouse) => warehouse.id !== sourceWarehouseId).map((warehouse) => <option value={warehouse.id} key={warehouse.id}>{warehouse.name} · {warehouse.businessCode}</option>)}</select></label>
      <label>运输方式<select value={transportMode} disabled={busy} onChange={(event) => { changed(); setTransportMode(event.target.value as WarehouseTransferTransportMode) }}><option value="UNSET">请选择</option><option value="LAND">陆地运输</option><option value="AIR">空运</option><option value="SEA">海运</option></select></label>
      <div className="transfer-charge-fields">
        <label>运费（最小货币单位）<input type="number" min={0} inputMode="numeric" value={freight} disabled={busy} onChange={(event) => { changed(); setFreight(event.target.value) }} /></label>
        <label>币种<CurrencyCodeInput listId="warehouse-transfer-currency-options" value={currency} disabled={busy || !freight.trim()} onChange={(event) => { changed(); setCurrency(event.target.value.toUpperCase()) }} /></label>
        <small>例如 CNY 100 = ¥1.00；未填写运费时无需选择币种。</small>
        {freightError && <small className="field-error" role="alert">{freightError}</small>}
      </div>
      <label>物流渠道<input maxLength={160} value={logisticsChannel} disabled={busy} onChange={(event) => { changed(); setLogisticsChannel(event.target.value) }} /></label>
      <label>物流单号<input maxLength={160} value={trackingNo} disabled={busy} onChange={(event) => { changed(); setTrackingNo(event.target.value) }} /></label>
      <label>分摊方式<select value={allocationMethod} disabled={busy} onChange={(event) => { changed(); setAllocationMethod(event.target.value as typeof allocationMethod) }}><option value="WEIGHT">重量</option><option value="VOLUMETRIC_WEIGHT">体积重</option><option value="VOLUME">体积</option></select></label>
      <label>期望发货时间<input type="datetime-local" value={expectedShipAt} disabled={busy} onChange={(event) => { changed(); setExpectedShipAt(event.target.value) }} /></label>
      <label>期望到货时间<input type="datetime-local" value={expectedArrivalAt} disabled={busy} onChange={(event) => { changed(); setExpectedArrivalAt(event.target.value) }} /></label>
      <label className="inventory-count-note">备注<input maxLength={500} value={note} disabled={busy} onChange={(event) => { changed(); setNote(event.target.value) }} /></label>
    </div>
    {warehouses.status === 'error' && <div className="inline-alert" role="alert"><span>{warehouses.message}</span><button className="text-button" type="button" disabled={busy} onClick={() => setWarehouseReload((value) => value + 1)}>重试仓库列表</button></div>}
    <section aria-labelledby="transfer-lines-title"><div className="table-heading"><div><h3 id="transfer-lines-title">调拨商品清单</h3><span>跨页填写会保留；单个批次最多选择 {MAX_TRANSFER_LINES} 个 SKU，留空不进入调拨单</span></div></div>
      {balances.status === 'loading' && <p className="product-state" role="status" aria-busy="true">正在读取起始仓库存…</p>}
      {balances.status === 'error' && <div className="inline-alert" role="alert"><span>{balances.message}</span><button className="text-button" type="button" disabled={busy} onClick={() => setBalanceReload((value) => value + 1)}>重试当前页</button></div>}
      {balances.status === 'ready' && sourceWarehouseId && balances.data.items.length === 0 && <div className="compact-empty-state"><strong>{balances.data.totalElements === 0 ? '起始仓暂无库存 SKU' : '当前页暂无库存 SKU'}</strong><span>{balances.data.totalElements === 0 ? '请先建立库存余额，再创建调拨。' : '请返回上一页继续选择。'}</span></div>}
      {balances.status === 'ready' && balances.data.items.length > 0 && <div className="warehouse-archive-table-wrap"><table aria-label="新增调拨商品清单"><thead><tr><th>库存 SKU</th><th>中文名称</th><th>当前库存</th><th>预留库存</th><th>可用库存</th><th>调拨数量</th></tr></thead><tbody>{balances.data.items.map((balance) => <tr key={balance.id}><td>{balance.skuBusinessCode}</td><td>{balance.skuName}</td><td>{balance.onHand}</td><td>{balance.reserved}</td><td>{balance.available}</td><td><label className="sr-only" htmlFor={`transfer-${balance.id}`}>{balance.skuBusinessCode} 调拨数量</label><input id={`transfer-${balance.id}`} type="number" min={1} max={Math.min(balance.available, 1_000_000_000)} inputMode="numeric" disabled={busy || balance.available < 1} value={quantities[balance.id] ?? ''} placeholder={balance.available < 1 ? '无可用库存' : '留空跳过'} onChange={(event) => { changed(); setQuantities((current) => ({ ...current, [balance.id]: event.target.value })) }} /></td></tr>)}</tbody></table>{balances.data.totalPages > 1 && <nav className="pagination" aria-label="调拨商品分页"><span>共 {balances.data.totalElements} 个 SKU · 第 {balances.data.page + 1} / {balances.data.totalPages} 页</span><div><button type="button" disabled={busy || balances.data.page === 0} onClick={() => { changed(); setBalancePage((value) => value - 1) }}>上一页</button><button type="button" disabled={busy || balances.data.page + 1 >= balances.data.totalPages} onClick={() => { changed(); setBalancePage((value) => value + 1) }}>下一页</button></div></nav>}</div>}
    </section>
    {error && <div className="inline-alert" role="alert">{error}</div>}
    <footer className="form-actions"><button className="text-button" type="button" disabled={busy} onClick={onClose}>返回</button><button className="button button-secondary" type="button" disabled={busy || !sourceWarehouseId || !targetWarehouseId || balances.status !== 'ready'} onClick={() => void save(false)}>{busy ? '正在保存…' : '保存'}</button><button className="button button-primary" type="button" disabled={busy || !sourceWarehouseId || !targetWarehouseId || balances.status !== 'ready'} onClick={() => void save(true)}>{busy ? '正在提交…' : '保存并提交调拨'}</button></footer>
  </section></div>
}

export function WarehouseTransferPage() {
  const { hasPermission } = useAuth()
  const router = useRouter()
  const search = useRouterState({ select: (state) => state.location.searchStr })
  const query = useMemo(() => parseWarehouseArchiveQuery(search, 'transfers'), [search])
  const [state, setState] = useState<LoadState<WarehouseTransferPageData>>({ status: 'loading' })
  const [filterWarehouses, setFilterWarehouses] = useState<Warehouse[]>([])
  const [detailLines, setDetailLines] = useState<Record<string, WarehouseTransferDetail['lines']>>({})
  const [reload, setReload] = useState(0)
  const [createOpen, setCreateOpen] = useState(false)
  const [detail, setDetail] = useState<WarehouseTransferDetail>()
  const [detailError, setDetailError] = useState<string>()
  const [exporting, setExporting] = useState(false)
  const [exportFeedback, setExportFeedback] = useState<{ kind: 'success' | 'error'; message: string; queryKey: string }>()
  const canWrite = hasPermission('inventory.adjust')

  useEffect(() => { let active = true; void activeWarehouses().then((items) => { if (active) setFilterWarehouses(items) }, () => undefined); return () => { active = false } }, [])
  const load = useCallback(() => {
    setDetailLines({})
    setState({ status: 'loading' })
    const effectiveStatus = (query.status || tabStatus[query.tab]) as WarehouseTransferStatus | undefined
    const effectiveStatuses = query.tab === 'RECEIPT' && !query.status
      ? ['IN_TRANSIT', 'PARTIALLY_RECEIVED'] as WarehouseTransferStatus[]
      : undefined
    const request = {
      sourceWarehouseId: query.originWarehouse || undefined, targetWarehouseId: query.targetWarehouse || undefined,
      status: effectiveStatus, transportMode: query.transport as WarehouseTransferTransportMode | undefined,
      searchField: (query.searchField || 'BATCH') as 'BATCH' | 'SKU' | 'REMARK' | 'OPERATOR', keyword: query.keyword,
      from: query.start, to: query.end, page: query.page, size: query.size,
    }
    void inventoryTransferApi.list({
      ...request,
      status: effectiveStatuses ? undefined : effectiveStatus,
      statuses: effectiveStatuses,
    }).then(async (page) => {
      setState({ status: 'ready', data: page })
      if (!query.showDetails) return
      const details = await Promise.allSettled(page.items.map((item) => inventoryTransferApi.get(item.id)))
      const mapped: Record<string, WarehouseTransferDetail['lines']> = {}
      details.forEach((result, index) => { if (result.status === 'fulfilled') mapped[page.items[index].id] = result.value.lines })
      setDetailLines(mapped)
    }, () => setState({ status: 'error', message: '无法读取分仓调拨列表，请稍后重试。' }))
  }, [query.end, query.keyword, query.originWarehouse, query.page, query.searchField, query.showDetails, query.size, query.start, query.status, query.tab, query.targetWarehouse, query.transport])
  useEffect(load, [load, reload])

  const submitFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget); const text = (name: string) => String(data.get(name) ?? '').trim()
    router.history.push(toWarehouseArchiveUrl('transfers', { tab: query.tab, searchField: text('searchField'), keyword: text('keyword'), status: text('status'), originWarehouse: text('originWarehouse'), targetWarehouse: text('targetWarehouse'), transport: text('transport'), start: text('start'), end: text('end'), showDetails: data.get('showDetails') === 'on', page: 0, size: query.size }))
  }
  const openDetail = async (id: string) => { setDetailError(undefined); try { setDetail(await inventoryTransferApi.get(id)) } catch { setDetailError('无法读取调拨明细，请稍后重试。') } }
  const selectTab = (tab: string) => router.history.push(toWarehouseArchiveUrl('transfers', { ...query, tab, status: '', page: 0 }))
  const exportQueryKey = toWarehouseArchiveUrl('transfers', query)
  const exportTransfers = async () => {
    if (exporting || state.status !== 'ready' || state.data.totalElements === 0) return
    const queryKey = exportQueryKey
    const statuses: WarehouseTransferStatus[] = query.status
      ? [query.status as WarehouseTransferStatus]
      : query.tab === 'RECEIPT'
        ? ['IN_TRANSIT', 'PARTIALLY_RECEIVED']
        : tabStatus[query.tab]
          ? [tabStatus[query.tab] as WarehouseTransferStatus]
          : []
    setExporting(true); setExportFeedback(undefined)
    try {
      const result = await inventoryTransferApi.exportCsv({
        sourceWarehouseId: query.originWarehouse || undefined,
        targetWarehouseId: query.targetWarehouse || undefined,
        statuses,
        transportMode: query.transport as WarehouseTransferTransportMode | undefined,
        searchField: (query.searchField || 'BATCH') as 'BATCH' | 'SKU' | 'REMARK' | 'OPERATOR',
        keyword: query.keyword || undefined,
        from: query.start || undefined,
        to: query.end || undefined,
      })
      const url = URL.createObjectURL(new Blob([result.content], { type: result.mediaType }))
      const anchor = document.createElement('a')
      anchor.href = url; anchor.download = result.filename; document.body.append(anchor)
      try { anchor.click() } finally { anchor.remove(); URL.revokeObjectURL(url) }
      setExportFeedback({ kind: 'success', message: `已导出 ${result.rowCount} 条分仓调拨。`, queryKey })
    } catch (cause) {
      setExportFeedback({ kind: 'error', message: exportMessage(cause), queryKey })
    } finally { setExporting(false) }
  }

  return <main className="warehouse-archive-page" aria-labelledby="warehouse-transfer-title">
    <header className="warehouse-archive-heading"><div><p className="eyebrow">仓库 / 仓库信息</p><h1 id="warehouse-transfer-title">分仓调拨</h1><p>跨仓调拨依次完成审批、发货和签收，并记录库存变化。</p></div></header>
    <div className="warehouse-archive-tabs" role="tablist" aria-label="分仓调拨业务视图">{tabs.map((tab) => <button className={tab.value === query.tab ? 'is-active' : ''} type="button" role="tab" aria-selected={tab.value === query.tab} key={tab.value} onClick={() => selectTab(tab.value)}>{tab.label}</button>)}</div>
    <section className="warehouse-archive-card" aria-label="分仓调拨筛选与列表">
      <form className="warehouse-archive-filters" onSubmit={submitFilters}>
        <label>搜索维度<select name="searchField" defaultValue={query.searchField || 'BATCH'}><option value="BATCH">调拨批次</option><option value="SKU">库存 SKU</option><option value="REMARK">备注</option><option value="OPERATOR">操作人</option></select></label>
        <label>搜索内容<input name="keyword" defaultValue={query.keyword} maxLength={100} placeholder="双击可批量查询" /></label>
        <label>状态<select name="status" defaultValue={query.status}><option value="">当前页签默认</option><option value="DRAFT">新调拨单</option><option value="APPROVAL">审核中</option><option value="READY_TO_SHIP">待发货</option><option value="IN_TRANSIT">待签收</option><option value="PARTIALLY_RECEIVED">部分签收</option><option value="RECEIVED">已签收</option><option value="REJECTED">未通过</option><option value="CANCELLED">已作废</option></select></label>
        <label>起始仓库<select name="originWarehouse" defaultValue={query.originWarehouse}><option value="">全部仓库</option>{filterWarehouses.map((warehouse) => <option value={warehouse.id} key={warehouse.id}>{warehouse.name}</option>)}</select></label>
        <label>目标仓库<select name="targetWarehouse" defaultValue={query.targetWarehouse}><option value="">全部仓库</option>{filterWarehouses.map((warehouse) => <option value={warehouse.id} key={warehouse.id}>{warehouse.name}</option>)}</select></label>
        <label>运输方式<select name="transport" defaultValue={query.transport}><option value="">全部</option><option value="UNSET">未设置</option><option value="LAND">陆地运输</option><option value="AIR">空运</option><option value="SEA">海运</option></select></label>
        <label>起始日期<input name="start" type="date" defaultValue={query.start} /></label><label>截止日期<input name="end" type="date" defaultValue={query.end} /></label>
        <label className="warehouse-archive-checkbox"><input name="showDetails" type="checkbox" defaultChecked={query.showDetails} />显示调拨商品详情</label>
        <div className="warehouse-archive-filter-actions"><button type="submit" className="is-primary">搜索</button><button type="button" onClick={() => router.history.push(toWarehouseArchiveUrl('transfers', { tab: query.tab }))}>重置</button></div>
      </form>
      <div className="warehouse-archive-actions"><button type="button" disabled={exporting || state.status !== 'ready' || state.data.totalElements === 0} onClick={() => void exportTransfers()}>{exporting ? '正在导出…' : '导出筛选结果'}</button>{canWrite && <button className="is-primary" type="button" onClick={() => setCreateOpen(true)} disabled={exporting}>新增调拨</button>}</div>
      {exportFeedback?.queryKey === exportQueryKey && <p className={`warehouse-export-feedback is-${exportFeedback.kind}`} role={exportFeedback.kind === 'error' ? 'alert' : 'status'}>{exportFeedback.message}</p>}
      {detailError && <div className="inline-alert" role="alert">{detailError}</div>}
      {state.status === 'loading' && <p className="product-state" role="status">正在加载分仓调拨…</p>}
      {state.status === 'error' && <div className="compact-empty-state" role="alert"><strong>无法读取分仓调拨</strong><span>{state.message}</span><button className="text-button" type="button" onClick={load}>重试</button></div>}
      {state.status === 'ready' && <div className="warehouse-archive-table-wrap"><table aria-label="分仓调拨列表"><thead><tr><th>调拨批次</th><th>起始仓库</th><th>目标仓库</th><th>运输方式</th><th>SKU 信息</th><th>调拨数量</th><th>调拨日期</th><th>状态</th><th>操作人</th><th>操作</th></tr></thead><tbody>{state.data.items.length === 0 ? <tr><td colSpan={10}><div className="warehouse-archive-empty" role="status"><strong>无相关数据</strong><span>{canWrite ? '可通过“新增调拨”创建首个调拨批次。' : '当前筛选条件下没有可查看的调拨批次。'}</span></div></td></tr> : state.data.items.map((item) => <tr key={item.id}><td>{item.transferNo}</td><td>{item.sourceWarehouseName}</td><td>{item.targetWarehouseName}</td><td>{transportLabels[item.transportMode]}</td><td>{detailLines[item.id] ? detailLines[item.id].map((line) => `${line.skuCode} × ${line.quantity}`).join('；') : `${item.lineCount} 个 SKU`}</td><td>{item.totalQuantity}</td><td>{item.transferDate}</td><td><span className={`status-badge is-${item.status.toLowerCase()}`}>{statusLabels[item.status]}</span></td><td>{item.operatorDisplayName}</td><td><button className="text-button" type="button" onClick={() => void openDetail(item.id)}>详情</button></td></tr>)}</tbody></table><nav className="pagination" aria-label="分仓调拨分页"><span>共 {state.data.totalElements} 条 · 第 {state.data.page + 1} / {Math.max(state.data.totalPages, 1)} 页</span><label className="pagination-settings">每页<select aria-label="每页条数" value={query.size} onChange={(event) => router.history.push(toWarehouseArchiveUrl('transfers', { ...query, page: 0, size: Number(event.currentTarget.value) }))}>{PAGE_SIZES.map((size) => <option key={size} value={size}>{size} 条</option>)}</select></label><div><button type="button" disabled={state.data.page === 0} onClick={() => router.history.push(toWarehouseArchiveUrl('transfers', { ...query, page: query.page - 1 }))}>上一页</button><button type="button" disabled={state.data.page + 1 >= state.data.totalPages} onClick={() => router.history.push(toWarehouseArchiveUrl('transfers', { ...query, page: query.page + 1 }))}>下一页</button></div></nav></div>}
    </section>
    {createOpen && <CreateTransferDialog onClose={() => setCreateOpen(false)} onCreated={(created) => { setCreateOpen(false); setDetail(created); setReload((value) => value + 1) }} />}
    {detail && <TransferDetailDialog detail={detail} canWrite={canWrite} onClose={() => setDetail(undefined)} onChanged={(changed) => { setDetail(changed); setReload((value) => value + 1) }} />}
  </main>
}
