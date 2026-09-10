import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useRouter, useRouterState } from '@tanstack/react-router'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { DialogCloseButton } from '../components/DialogCloseButton'
import { ConfirmationDialog } from '../components/ConfirmationDialog'
import { inventoryApi, type InventoryBalance, type Page } from '../modules/inventoryApi'
import {
  inventoryCountApi,
  type InventoryCountDetail,
  type InventoryCountPage as InventoryCountPageData,
  type InventoryCountStatus,
} from '../modules/inventoryCountApi'
import { warehouseCenterApi, type Warehouse } from '../modules/warehouseCenterApi'
import { parseWarehouseArchiveQuery, toWarehouseArchiveUrl } from './WarehouseArchiveShells'
import './WarehouseArchiveShells.css'

type LoadState<T> = { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; message: string }
const PAGE_SIZES = [20, 50, 100, 200] as const
const COUNT_BALANCE_PAGE_SIZE = 200
const MAX_WAREHOUSE_REFERENCE_PAGES = 100
const MAX_COUNT_LINES = 200
const statusLabels: Record<InventoryCountStatus, string> = {
  PENDING: '待提交', APPROVAL: '审批中', COMPLETED: '已完成', REJECTED: '未通过', CANCELLED: '已作废',
}

function commandId() { return crypto.randomUUID() }
function today() { return new Date().toISOString().slice(0, 10) }
function message(error: unknown) {
  if (error instanceof ApiError && error.status === 409) return '库存或盘点状态已变化，请刷新后重试。'
  if (error instanceof ApiError && error.status === 403) return '当前账号没有执行该盘点操作的权限。'
  return '暂时无法完成盘点操作，请稍后重试。'
}

function exportMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 409) return '导出结果超过 10,000 条，请缩小筛选范围后重试。'
  if (error instanceof ApiError && error.status === 403) return '当前账号没有导出库存盘点的权限。'
  return '暂时无法导出库存盘点，请稍后重试。'
}

function numberFilter(value?: string) {
  return value && /^-?\d+$/.test(value) ? Number(value) : undefined
}

async function activeWarehouses() {
  const first = await warehouseCenterApi.listWarehouses({ status: 'ACTIVE', page: 0, size: COUNT_BALANCE_PAGE_SIZE })
  if (first.page !== 0 || first.size !== COUNT_BALANCE_PAGE_SIZE || first.totalPages > MAX_WAREHOUSE_REFERENCE_PAGES) throw new Error('Invalid warehouse pages')
  const items = [...first.items]
  for (let page = 1; page < first.totalPages; page += 1) {
    const next = await warehouseCenterApi.listWarehouses({ status: 'ACTIVE', page, size: COUNT_BALANCE_PAGE_SIZE })
    if (next.page !== page || next.size !== COUNT_BALANCE_PAGE_SIZE || next.totalPages !== first.totalPages || next.totalElements !== first.totalElements) throw new Error('Warehouse pages changed while loading')
    items.push(...next.items)
  }
  if (items.length !== first.totalElements || new Set(items.map((item) => item.id)).size !== items.length) throw new Error('Warehouse pages are incomplete')
  return items
}

export function buildInventoryCountLines(balances: InventoryBalance[], quantities: Record<string, string>) {
  const lines: Array<{ balanceId: string; countedOnHand: number }> = []
  for (const balance of balances) {
    const raw = quantities[balance.id]?.trim()
    if (!raw) continue
    const value = Number(raw)
    if (!Number.isSafeInteger(value) || value < -1_000_000_000 || value > 1_000_000_000) throw new Error(`${balance.skuBusinessCode} 的盘点库存必须是安全整数。`)
    lines.push({ balanceId: balance.id, countedOnHand: value })
  }
  if (!lines.length) throw new Error('请至少填写一个库存 SKU 的盘点数量。')
  if (lines.length > MAX_COUNT_LINES) throw new Error(`单个盘点批次最多包含 ${MAX_COUNT_LINES} 个库存 SKU。`)
  return lines
}

function InventoryCountDate({ value }: { value: string }) {
  return <time dateTime={value}>{value}</time>
}

function CountDetailDialog({
  detail,
  canWrite,
  onClose,
  onChanged,
}: {
  detail: InventoryCountDetail
  canWrite: boolean
  onClose: () => void
  onChanged: (detail: InventoryCountDetail) => void
}) {
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  const [pendingAction, setPendingAction] = useState<'submit' | 'approve' | 'reject' | 'cancel'>()
  const run = async (action: 'submit' | 'approve' | 'reject' | 'cancel') => {
    setPendingAction(undefined)
    setBusy(action); setError(undefined)
    try {
      onChanged(await inventoryCountApi.transition(detail.summary.id, action, detail.summary.version, commandId()))
    } catch (cause) { setError(message(cause)) } finally { setBusy(undefined) }
  }
  const status = detail.summary.status
  const confirmation = pendingAction ? {
    submit: { title: '提交盘点审批', description: '提交后，该盘点批次将进入审批队列。', confirmLabel: '确认提交' },
    approve: { title: '审批通过并记账', description: '系统将按盘点差值更新库存；如库存已变化，本次审批不会生效。', confirmLabel: '确认审批' },
    reject: { title: '驳回盘点批次', description: '驳回后，该盘点批次不会更新库存。', confirmLabel: '确认驳回' },
    cancel: { title: '作废盘点批次', description: '作废后，该盘点批次不能继续处理。', confirmLabel: '确认作废' },
  }[pendingAction] : undefined
  return <><div className="dialog-backdrop" role="presentation">
    <section className="write-dialog inventory-count-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="count-detail-title">
      <header className="table-heading"><div><h2 id="count-detail-title">盘点批次 {detail.summary.countNo}</h2><span>{detail.summary.warehouseName} · {statusLabels[status]}</span></div><DialogCloseButton disabled={Boolean(busy)} onClick={onClose} /></header>
      <dl className="inventory-count-summary-grid">
        <div><dt>盘点日期</dt><dd><InventoryCountDate value={detail.summary.countDate} /></dd></div>
        <div><dt>操作人</dt><dd>{detail.summary.operatorDisplayName}</dd></div>
        <div><dt>审批人</dt><dd>{detail.summary.approverDisplayName ?? '—'}</dd></div>
        <div><dt>总差值</dt><dd>{detail.summary.totalDifference > 0 ? '+' : ''}{detail.summary.totalDifference}</dd></div>
      </dl>
      <div className="warehouse-archive-table-wrap"><table aria-label="盘点商品明细"><thead><tr><th>库存 SKU</th><th>中文名称</th><th>当前库存快照</th><th>可用库存快照</th><th>盘点库存</th><th>差值</th><th>库存流水</th></tr></thead><tbody>{detail.lines.map((line) => <tr key={line.id}><td>{line.skuCode}</td><td>{line.skuName}</td><td>{line.snapshotOnHand}</td><td>{line.snapshotAvailable}</td><td>{line.countedOnHand}</td><td>{line.difference > 0 ? '+' : ''}{line.difference}</td><td>{line.resultEventId ? '已记账' : status === 'COMPLETED' ? '无需调整' : '待审批'}</td></tr>)}</tbody></table></div>
      {error && <div className="inline-alert" role="alert">{error}</div>}
      <footer className="form-actions"><button className="text-button" type="button" disabled={Boolean(busy)} onClick={onClose}>返回</button>{canWrite && status === 'PENDING' && <><button className="button button-danger" type="button" disabled={Boolean(busy)} onClick={() => setPendingAction('cancel')}>作废</button><button className="button button-primary" type="button" disabled={Boolean(busy)} onClick={() => setPendingAction('submit')}>提交审批</button></>}{canWrite && status === 'APPROVAL' && <><button className="button button-danger" type="button" disabled={Boolean(busy)} onClick={() => setPendingAction('reject')}>驳回</button><button className="button button-secondary" type="button" disabled={Boolean(busy)} onClick={() => setPendingAction('cancel')}>作废</button><button className="button button-primary" type="button" disabled={Boolean(busy)} onClick={() => setPendingAction('approve')}>审批通过</button></>}</footer>
    </section>
  </div>{pendingAction && confirmation && <ConfirmationDialog title={confirmation.title} description={confirmation.description} confirmLabel={confirmation.confirmLabel} busy={busy === pendingAction} destructive={pendingAction === 'reject' || pendingAction === 'cancel'} onClose={() => setPendingAction(undefined)} onConfirm={() => void run(pendingAction)} />}</>
}

function CreateCountDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (detail: InventoryCountDetail) => void }) {
  const [warehouses, setWarehouses] = useState<LoadState<Warehouse[]>>({ status: 'loading' })
  const [warehouseReload, setWarehouseReload] = useState(0)
  const [warehouseId, setWarehouseId] = useState('')
  const [countDate, setCountDate] = useState(today())
  const [note, setNote] = useState('')
  const [balancePage, setBalancePage] = useState(0)
  const [balanceReload, setBalanceReload] = useState(0)
  const [balances, setBalances] = useState<LoadState<Page<InventoryBalance>>>({ status: 'ready', data: { items: [], page: 0, size: COUNT_BALANCE_PAGE_SIZE, totalElements: 0, totalPages: 0 } })
  const [loadedBalances, setLoadedBalances] = useState<Record<string, InventoryBalance>>({})
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [pendingCommandId, setPendingCommandId] = useState(commandId)
  const changed = () => { if (error) setPendingCommandId(commandId()); setError(undefined) }

  useEffect(() => { let active = true; setWarehouses({ status: 'loading' }); void activeWarehouses().then((data) => { if (active) setWarehouses({ status: 'ready', data }) }, () => { if (active) setWarehouses({ status: 'error', message: '无法读取可用仓库。' }) }); return () => { active = false } }, [warehouseReload])
  useEffect(() => {
    let active = true
    if (!warehouseId) { setBalances({ status: 'ready', data: { items: [], page: 0, size: COUNT_BALANCE_PAGE_SIZE, totalElements: 0, totalPages: 0 } }); return () => { active = false } }
    setBalances({ status: 'loading' })
    void inventoryApi.listBalances({ warehouseId, page: balancePage, size: COUNT_BALANCE_PAGE_SIZE }).then((page) => {
      if (!active) return
      if (page.page !== balancePage || page.size !== COUNT_BALANCE_PAGE_SIZE || page.items.some((balance) => balance.warehouseId !== warehouseId)) {
        setBalances({ status: 'error', message: '仓库库存分页结果不一致，请重试当前页。' })
        return
      }
      setLoadedBalances((current) => Object.fromEntries([...Object.values(current), ...page.items].map((balance) => [balance.id, balance])))
      setBalances({ status: 'ready', data: page })
    }, () => { if (active) setBalances({ status: 'error', message: '无法读取仓库库存。' }) })
    return () => { active = false }
  }, [balancePage, balanceReload, warehouseId])

  const save = async (submit: boolean) => {
    if (!warehouseId || balances.status !== 'ready' || busy) return
    let lines: Array<{ balanceId: string; countedOnHand: number }>
    try { lines = buildInventoryCountLines(Object.values(loadedBalances), quantities) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '无法校验盘点商品。'); return }
    setBusy(true); setError(undefined)
    try { onCreated(await inventoryCountApi.create({ commandId: pendingCommandId, warehouseId, countDate, note: note.trim() || undefined, submit, lines })) }
    catch (cause) { setError(message(cause)) } finally { setBusy(false) }
  }
  return <div className="dialog-backdrop" role="presentation"><section className="write-dialog inventory-count-create-dialog" role="dialog" aria-modal="true" aria-labelledby="create-count-title"><header className="table-heading"><div><h2 id="create-count-title">新增盘点</h2><span>不同盘点日期或不同仓库请分批提交盘点</span></div><DialogCloseButton disabled={busy} onClick={onClose} /></header>
    <div className="inventory-count-form-grid"><label>盘点日期<input type="date" value={countDate} disabled={busy} onChange={(event) => { changed(); setCountDate(event.target.value) }} /></label><label><span>* 仓库</span><select value={warehouseId} disabled={busy || warehouses.status !== 'ready'} onChange={(event) => { changed(); setWarehouseId(event.target.value); setBalancePage(0); setLoadedBalances({}); setQuantities({}) }}><option value="">-选择仓库-</option>{warehouses.status === 'ready' && warehouses.data.map((warehouse) => <option value={warehouse.id} key={warehouse.id}>{warehouse.name} · {warehouse.businessCode}</option>)}</select></label><label className="inventory-count-note">备注<input maxLength={500} value={note} disabled={busy} onChange={(event) => { changed(); setNote(event.target.value) }} /></label></div>
    {warehouses.status === 'error' && <div className="inline-alert" role="alert"><span>{warehouses.message}</span><button className="text-button" type="button" disabled={busy} onClick={() => setWarehouseReload((value) => value + 1)}>重试仓库列表</button></div>}
    <section aria-labelledby="count-lines-title"><div className="table-heading"><div><h3 id="count-lines-title">盘点商品清单</h3><span>跨页填写会保留；单个批次最多选择 {MAX_COUNT_LINES} 个 SKU，留空不进入盘点单</span></div></div>{balances.status === 'loading' && <p className="product-state" role="status" aria-busy="true">正在读取仓库库存…</p>}{balances.status === 'error' && <div className="inline-alert" role="alert"><span>{balances.message}</span><button className="text-button" type="button" disabled={busy} onClick={() => setBalanceReload((value) => value + 1)}>重试当前页</button></div>}{balances.status === 'ready' && warehouseId && balances.data.items.length === 0 && <div className="compact-empty-state"><strong>{balances.data.totalElements === 0 ? '当前仓库暂无库存 SKU' : '当前页暂无库存 SKU'}</strong><span>{balances.data.totalElements === 0 ? '请先建立库存余额，再创建盘点。' : '请返回上一页继续盘点。'}</span></div>}{balances.status === 'ready' && balances.data.items.length > 0 && <div className="warehouse-archive-table-wrap"><table aria-label="新增盘点商品清单"><thead><tr><th>库存 SKU</th><th>中文名称</th><th>当前库存</th><th>可用库存</th><th>盘点库存</th><th>差值</th></tr></thead><tbody>{balances.data.items.map((balance) => { const raw = quantities[balance.id] ?? ''; const value = /^-?\d+$/.test(raw) ? Number(raw) : undefined; return <tr key={balance.id}><td>{balance.skuBusinessCode}</td><td>{balance.skuName}</td><td>{balance.onHand}</td><td>{balance.available}</td><td><label className="sr-only" htmlFor={`count-${balance.id}`}>{balance.skuBusinessCode} 盘点库存</label><input id={`count-${balance.id}`} type="number" inputMode="numeric" min={-1_000_000_000} max={1_000_000_000} disabled={busy} value={raw} placeholder="留空跳过" onChange={(event) => { changed(); setQuantities((current) => ({ ...current, [balance.id]: event.target.value })) }} /></td><td>{value === undefined || !Number.isSafeInteger(value) ? '—' : value - balance.onHand > 0 ? `+${value - balance.onHand}` : value - balance.onHand}</td></tr> })}</tbody></table>{balances.data.totalPages > 1 && <nav className="pagination" aria-label="盘点商品分页"><span>共 {balances.data.totalElements} 个 SKU · 第 {balances.data.page + 1} / {balances.data.totalPages} 页</span><div><button type="button" disabled={busy || balances.data.page === 0} onClick={() => { changed(); setBalancePage((value) => value - 1) }}>上一页</button><button type="button" disabled={busy || balances.data.page + 1 >= balances.data.totalPages} onClick={() => { changed(); setBalancePage((value) => value + 1) }}>下一页</button></div></nav>}</div>}</section>
    {error && <div className="inline-alert" role="alert">{error}</div>}<footer className="form-actions"><button className="text-button" type="button" disabled={busy} onClick={onClose}>返回</button><button className="button button-secondary" type="button" disabled={busy || !warehouseId || balances.status !== 'ready'} onClick={() => void save(false)}>{busy ? '正在保存…' : '保存'}</button><button className="button button-primary" type="button" disabled={busy || !warehouseId || balances.status !== 'ready'} onClick={() => void save(true)}>{busy ? '正在提交…' : '保存并提交盘点'}</button></footer>
  </section></div>
}

export function InventoryCountPage() {
  const { hasPermission } = useAuth()
  const router = useRouter()
  const search = useRouterState({ select: (state) => state.location.searchStr })
  const query = useMemo(() => parseWarehouseArchiveQuery(search, 'counts'), [search])
  const [state, setState] = useState<LoadState<InventoryCountPageData>>({ status: 'loading' })
  const [reload, setReload] = useState(0)
  const [createOpen, setCreateOpen] = useState(false)
  const [detail, setDetail] = useState<InventoryCountDetail>()
  const [detailError, setDetailError] = useState<string>()
  const [exporting, setExporting] = useState(false)
  const [exportFeedback, setExportFeedback] = useState<{ kind: 'success' | 'error'; message: string; queryKey: string }>()
  const autoOpenedSourceRef = useRef<string | undefined>(undefined)
  const canWrite = hasPermission('inventory.adjust')

  const load = useCallback(() => {
    setState({ status: 'loading' })
    void inventoryCountApi.list({
      searchField: (query.searchField || 'BATCH') as 'BATCH' | 'SKU' | 'REMARK' | 'OPERATOR', keyword: query.keyword,
      status: query.status as InventoryCountStatus | undefined, from: query.start, to: query.end,
      differenceMin: numberFilter(query.minimum), differenceMax: numberFilter(query.maximum), page: query.page, size: query.size,
    }).then((page) => setState({ status: 'ready', data: page }), () => setState({ status: 'error', message: '无法读取库存盘点列表，请稍后重试。' }))
  }, [query.end, query.keyword, query.maximum, query.minimum, query.page, query.searchField, query.size, query.start, query.status])
  useEffect(load, [load, reload])
  const submitFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget)
    const text = (name: string) => String(data.get(name) ?? '').trim()
    router.history.push(toWarehouseArchiveUrl('counts', { searchField: text('searchField'), keyword: text('keyword'), status: text('status'), start: text('start'), end: text('end'), minimum: text('minimum'), maximum: text('maximum'), showDetails: data.get('showDetails') === 'on', page: 0, size: query.size }))
  }
  const openDetail = async (id: string) => { setDetailError(undefined); try { setDetail(await inventoryCountApi.get(id)) } catch { setDetailError('无法读取盘点明细，请稍后重试。') } }
  useEffect(() => {
    if (!query.showDetails || state.status !== 'ready'
      || state.data.items.length !== 1) return
    const sourceId = state.data.items[0].id
    if (autoOpenedSourceRef.current === sourceId) return
    autoOpenedSourceRef.current = sourceId
    void openDetail(sourceId)
  }, [query.showDetails, state])
  const exportQueryKey = toWarehouseArchiveUrl('counts', query)
  const exportCounts = async () => {
    if (exporting || state.status !== 'ready' || state.data.totalElements === 0) return
    const queryKey = exportQueryKey
    setExporting(true); setExportFeedback(undefined)
    try {
      const result = await inventoryCountApi.exportCsv({
        searchField: (query.searchField || 'BATCH') as 'BATCH' | 'SKU' | 'REMARK' | 'OPERATOR',
        keyword: query.keyword || undefined,
        status: query.status as InventoryCountStatus | undefined,
        from: query.start || undefined,
        to: query.end || undefined,
        differenceMin: numberFilter(query.minimum),
        differenceMax: numberFilter(query.maximum),
      })
      const url = URL.createObjectURL(new Blob([result.content], { type: result.mediaType }))
      const anchor = document.createElement('a')
      anchor.href = url; anchor.download = result.filename; document.body.append(anchor)
      try { anchor.click() } finally { anchor.remove(); URL.revokeObjectURL(url) }
      setExportFeedback({ kind: 'success', message: `已导出 ${result.rowCount} 条库存盘点。`, queryKey })
    } catch (cause) {
      setExportFeedback({ kind: 'error', message: exportMessage(cause), queryKey })
    } finally { setExporting(false) }
  }
  return <main className="warehouse-archive-page" aria-labelledby="inventory-count-title"><header className="warehouse-archive-heading"><div><p className="eyebrow">仓库 / 仓库信息</p><h1 id="inventory-count-title">库存盘点</h1><p>按仓库记录盘点结果，审批后更新库存。</p></div></header><section className="warehouse-archive-card" aria-label="库存盘点筛选与列表"><form className="warehouse-archive-filters" onSubmit={submitFilters}><label>搜索维度<select name="searchField" defaultValue={query.searchField || 'BATCH'}><option value="BATCH">批次号</option><option value="SKU">库存 SKU 编号</option><option value="REMARK">备注</option><option value="OPERATOR">操作人</option></select></label><label>搜索内容<input name="keyword" defaultValue={query.keyword} maxLength={100} placeholder="双击可批量查询" /></label><label>状态<select name="status" defaultValue={query.status}><option value="">全部</option><option value="REJECTED">未通过</option><option value="APPROVAL">审批中</option><option value="COMPLETED">已完成</option><option value="PENDING">待提交</option><option value="CANCELLED">已作废</option></select></label><label>起始日期<input name="start" type="date" defaultValue={query.start} /></label><label>截止日期<input name="end" type="date" defaultValue={query.end} /></label><label>最小差值<input name="minimum" inputMode="numeric" defaultValue={query.minimum} placeholder="支持负值" /></label><label>最大差值<input name="maximum" inputMode="numeric" defaultValue={query.maximum} placeholder="支持负值" /></label><label className="warehouse-archive-checkbox"><input name="showDetails" type="checkbox" defaultChecked={query.showDetails} />显示盘点商品详情</label><div className="warehouse-archive-filter-actions"><button type="submit" className="is-primary">搜索</button><button type="button" onClick={() => router.history.push('/warehouses/counts')}>重置</button></div></form><div className="warehouse-archive-actions"><button type="button" disabled={exporting || state.status !== 'ready' || state.data.totalElements === 0} onClick={() => void exportCounts()}>{exporting ? '正在导出…' : '导出筛选结果'}</button>{canWrite && <button className="is-primary" type="button" onClick={() => setCreateOpen(true)} disabled={exporting}>新增盘点</button>}</div>{exportFeedback?.queryKey === exportQueryKey && <p className={`warehouse-export-feedback is-${exportFeedback.kind}`} role={exportFeedback.kind === 'error' ? 'alert' : 'status'}>{exportFeedback.message}</p>}{detailError && <div className="inline-alert" role="alert">{detailError}</div>}{state.status === 'loading' && <p className="product-state" role="status">正在加载库存盘点…</p>}{state.status === 'error' && <div className="compact-empty-state" role="alert"><strong>无法读取库存盘点</strong><span>{state.message}</span><button className="text-button" type="button" onClick={load}>重试</button></div>}{state.status === 'ready' && <div className="warehouse-archive-table-wrap"><table aria-label="库存盘点列表"><thead><tr><th>批次编号</th><th>仓库</th><th>备注</th><th>SKU 个数</th><th>总差值</th><th>状态</th><th>盘点日期</th><th>操作人</th><th>审批人</th><th>操作</th></tr></thead><tbody>{state.data.items.length === 0 ? <tr><td colSpan={10}><div className="warehouse-archive-empty" role="status"><strong>无相关数据</strong><span>{canWrite ? '可通过“新增盘点”创建首个盘点批次。' : '当前筛选条件下没有可查看的盘点批次。'}</span></div></td></tr> : state.data.items.map((item) => <tr key={item.id}><td>{item.countNo}</td><td>{item.warehouseName}</td><td>{item.note ?? '—'}</td><td>{item.lineCount}</td><td>{item.totalDifference > 0 ? '+' : ''}{item.totalDifference}</td><td><span className={`status-badge is-${item.status.toLowerCase()}`}>{statusLabels[item.status]}</span></td><td><InventoryCountDate value={item.countDate} /></td><td>{item.operatorDisplayName}</td><td>{item.approverDisplayName ?? '—'}</td><td><button className="text-button" type="button" onClick={() => void openDetail(item.id)}>详情</button></td></tr>)}</tbody></table><nav className="pagination" aria-label="库存盘点分页"><span>共 {state.data.totalElements} 条 · 第 {state.data.page + 1} / {Math.max(state.data.totalPages, 1)} 页</span><label className="pagination-settings">每页<select aria-label="每页条数" value={query.size} onChange={(event) => router.history.push(toWarehouseArchiveUrl('counts', { ...query, page: 0, size: Number(event.currentTarget.value) }))}>{PAGE_SIZES.map((size) => <option key={size} value={size}>{size} 条</option>)}</select></label><div><button type="button" disabled={state.data.page === 0} onClick={() => router.history.push(toWarehouseArchiveUrl('counts', { ...query, page: query.page - 1 }))}>上一页</button><button type="button" disabled={state.data.page + 1 >= state.data.totalPages} onClick={() => router.history.push(toWarehouseArchiveUrl('counts', { ...query, page: query.page + 1 }))}>下一页</button></div></nav></div>}</section>{createOpen && <CreateCountDialog onClose={() => setCreateOpen(false)} onCreated={(created) => { setCreateOpen(false); setDetail(created); setReload((value) => value + 1) }} />}{detail && <CountDetailDialog detail={detail} canWrite={canWrite} onClose={() => setDetail(undefined)} onChanged={(changed) => { setDetail(changed); setReload((value) => value + 1) }} />}</main>
}
