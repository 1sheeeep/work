import { useRouter, useRouterState } from '@tanstack/react-router'
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { DialogCloseButton } from '../components/DialogCloseButton'
import {
  procurementPlanApi,
  type ProcurementLocationOption,
  type ProcurementPlan,
  type ProcurementPlanPage as PlanPage,
  type ProcurementReferencePage,
  type ProcurementPlanSearchField,
  type ProcurementPlanStatus,
  type ProcurementSkuOption,
  type ProcurementWarehouseOption,
} from '../modules/procurementPlanApi'
import './WarehouseArchiveShells.css'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DEFAULT_SIZE = 25
const PAGE_SIZES = [10, 25, 50, 100] as const
const searchFields: ReadonlyArray<{ value: ProcurementPlanSearchField; label: string }> = [
  { value: 'PLAN_NO', label: '计划编号' },
  { value: 'SKU_CODE', label: 'SKU 编号' },
  { value: 'SKU_NAME', label: 'SKU 名称' },
  { value: 'NOTE', label: '备注' },
]
const statusLabels: Record<ProcurementPlanStatus, string> = {
  UNPURCHASED: '未采购', ORDERED: '已生成采购单', VOIDED: '已作废',
}

type LoadState<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; message: string }

async function loadAllReferencePages<T extends { id: string }>(loader: (page: number, size: number) => Promise<ProcurementReferencePage<T>>) {
  const first = await loader(0, 200)
  const items = [...first.items]
  for (let page = 1; page < first.totalPages; page += 1) {
    const next = await loader(page, 200)
    if (next.totalPages !== first.totalPages || next.totalElements !== first.totalElements) throw new Error('Reference pages changed while loading')
    items.push(...next.items)
  }
  if (items.length !== first.totalElements || new Set(items.map((item) => item.id)).size !== items.length) throw new Error('Reference pages are incomplete')
  return items
}

export type ProcurementPlanQuery = {
  searchField: ProcurementPlanSearchField
  keyword: string
  warehouseId: string
  locationId: string
  status: '' | ProcurementPlanStatus
  createdFrom: string
  createdTo: string
  page: number
  size: number
  detailId: string
}

function bounded(value: string | null, maximum: number) {
  return (value ?? '').trim().slice(0, maximum)
}

function oneOf<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? value as T : fallback
}

function positivePage(value: string | null, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback
}

function date(value: string | null) {
  const result = bounded(value, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(result) && !Number.isNaN(Date.parse(`${result}T00:00:00Z`)) ? result : ''
}

export function parseProcurementPlanQuery(search: string): ProcurementPlanQuery {
  const params = new URLSearchParams(search)
  const warehouseId = bounded(params.get('warehouseId'), 36)
  const locationId = bounded(params.get('locationId'), 36)
  const detailId = bounded(params.get('detailId'), 36)
  return {
    searchField: oneOf(params.get('searchField'), searchFields.map((item) => item.value), 'PLAN_NO'),
    keyword: bounded(params.get('keyword'), 120),
    warehouseId: UUID_PATTERN.test(warehouseId) ? warehouseId : '',
    locationId: UUID_PATTERN.test(locationId) ? locationId : '',
    status: oneOf(params.get('status'), ['', 'UNPURCHASED', 'ORDERED', 'VOIDED'] as const, ''),
    createdFrom: date(params.get('createdFrom')),
    createdTo: date(params.get('createdTo')),
    page: positivePage(params.get('page'), 0, 0, 9_999),
    size: positivePage(params.get('size'), DEFAULT_SIZE, 1, 200),
    detailId: UUID_PATTERN.test(detailId) ? detailId : '',
  }
}

export function toProcurementPlanUrl(query: Partial<ProcurementPlanQuery>) {
  const params = new URLSearchParams()
  if (query.searchField && query.searchField !== 'PLAN_NO') params.set('searchField', query.searchField)
  if (query.keyword?.trim()) params.set('keyword', query.keyword.trim().slice(0, 120))
  if (query.warehouseId && UUID_PATTERN.test(query.warehouseId)) params.set('warehouseId', query.warehouseId)
  if (query.locationId && UUID_PATTERN.test(query.locationId)) params.set('locationId', query.locationId)
  if (query.status) params.set('status', query.status)
  if (query.createdFrom) params.set('createdFrom', query.createdFrom)
  if (query.createdTo) params.set('createdTo', query.createdTo)
  if (query.page && query.page > 0) params.set('page', String(query.page))
  if (query.size && query.size !== DEFAULT_SIZE) params.set('size', String(query.size))
  if (query.detailId && UUID_PATTERN.test(query.detailId)) params.set('detailId', query.detailId)
  const serialized = params.toString()
  return serialized ? `/procurement/plans?${serialized}` : '/procurement/plans'
}

export function toProcurementOrderForPlanUrl(planNo: string, create: boolean) {
  const normalizedPlanNo = bounded(planNo, 120)
  if (!normalizedPlanNo) return '/procurement/orders'
  const params = new URLSearchParams({
    searchField: 'PLAN_NO',
    keyword: normalizedPlanNo,
  })
  if (create) params.set('createPlanNo', normalizedPlanNo)
  return `/procurement/orders?${params.toString()}`
}

function commandId() {
  return crypto.randomUUID()
}

function startInstant(value: string) {
  return value ? `${value}T00:00:00.000Z` : undefined
}

function endInstant(value: string) {
  return value ? `${value}T23:59:59.999Z` : undefined
}

function operationMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 403) return '当前账号没有采购计划写入权限。'
  if (error instanceof ApiError && error.status === 409) {
    const reason = typeof error.details === 'object' && error.details !== null && 'reason' in error.details
      ? String((error.details as { reason?: unknown }).reason ?? '') : ''
    if (reason === 'idempotency_conflict') return '本次操作已提交，请刷新结果后重试。'
    if (reason === 'invalid_plan_state') return '采购计划状态已变化，已为你刷新详情。'
    return '采购计划已更新，已刷新详情。'
  }
  return '暂时无法完成采购计划操作，请检查网络后重试。'
}

function exportMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 403) return '当前账号没有采购计划导出权限。'
  if (error instanceof ApiError && error.status === 409) return '筛选结果超过 10,000 条，请缩小筛选范围后重试。'
  return '暂时无法导出采购计划，请检查网络后重试。'
}

function CreatePlanDialog({
  warehouses,
  onClose,
  onCreated,
}: {
  warehouses: ProcurementWarehouseOption[]
  onClose: () => void
  onCreated: (plan: ProcurementPlan) => void
}) {
  const [skuSearch, setSkuSearch] = useState('')
  const [skuPage, setSkuPage] = useState(0)
  const [skuRefreshKey, setSkuRefreshKey] = useState(0)
  const [skus, setSkus] = useState<LoadState<{ items: ProcurementSkuOption[]; totalPages: number }>>({ status: 'loading' })
  const [warehouseId, setWarehouseId] = useState('')
  const [locationRefreshKey, setLocationRefreshKey] = useState(0)
  const [locations, setLocations] = useState<LoadState<ProcurementLocationOption[]>>({ status: 'ready', data: [] })
  const [locationId, setLocationId] = useState('')
  const [skuId, setSkuId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [note, setNote] = useState('')
  const [pendingCommandId, setPendingCommandId] = useState(commandId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const changed = () => { setPendingCommandId(commandId()); setError(undefined) }

  useEffect(() => {
    let active = true
    setSkus({ status: 'loading' })
    void procurementPlanApi.skus(skuSearch, skuPage, 25).then(
      (page) => { if (active) setSkus({ status: 'ready', data: { items: page.items, totalPages: page.totalPages } }) },
      () => { if (active) setSkus({ status: 'error', message: '无法读取可用 SKU。' }) },
    )
    return () => { active = false }
  }, [skuPage, skuRefreshKey, skuSearch])

  useEffect(() => {
    let active = true
    setLocationId('')
    if (!warehouseId) { setLocations({ status: 'ready', data: [] }); return () => { active = false } }
    setLocations({ status: 'loading' })
    void (async () => {
      try {
        const items = await loadAllReferencePages((page, size) => procurementPlanApi.locations(warehouseId, undefined, page, size))
        if (active) setLocations({ status: 'ready', data: items })
      } catch {
        if (active) setLocations({ status: 'error', message: '无法读取该仓库的可用库位。' })
      }
    })()
    return () => { active = false }
  }, [locationRefreshKey, warehouseId])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    const parsedQuantity = Number(quantity)
    if (!skuId || !warehouseId || !locationId) { setError('请选择 SKU、仓库和库位。'); return }
    if (!Number.isSafeInteger(parsedQuantity) || parsedQuantity < 1 || parsedQuantity > 1_000_000_000) {
      setError('计划数量必须是 1 到 1,000,000,000 的整数。'); return
    }
    setBusy(true); setError(undefined)
    try {
      onCreated(await procurementPlanApi.create({ commandId: pendingCommandId, skuId, warehouseId, locationId, quantity: parsedQuantity, note: note.trim() || undefined }))
    } catch (cause) {
      setError(operationMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return <div className="dialog-backdrop" role="presentation"><section className="write-dialog inventory-count-create-dialog" role="dialog" aria-modal="true" aria-labelledby="create-plan-title">
    <header className="table-heading"><div><h2 id="create-plan-title">新增采购计划</h2><span>每条计划对应一个 SKU、一个仓库和一个库位</span></div><DialogCloseButton disabled={busy} onClick={onClose} /></header>
    <form onSubmit={(event) => void submit(event)}>
      <div className="inventory-count-form-grid">
        <label className="inventory-count-note">搜索 SKU<input value={skuSearch} maxLength={120} disabled={busy} placeholder="SKU 编号、名称或规格" onChange={(event) => { changed(); setSkuId(''); setSkuPage(0); setSkuSearch(event.target.value) }} /></label>
        <label><span>* SKU</span><select aria-label="SKU" value={skuId} disabled={busy || skus.status !== 'ready'} onChange={(event) => { changed(); setSkuId(event.target.value) }}><option value="">-选择 SKU-</option>{skus.status === 'ready' && skus.data.items.map((sku) => <option key={sku.id} value={sku.id}>{sku.businessCode} · {sku.name}{sku.variantSummary ? ` · ${sku.variantSummary}` : ''}</option>)}</select></label>
        <label><span>* 仓库</span><select value={warehouseId} disabled={busy} onChange={(event) => { changed(); setLocationId(''); setLocations({ status: 'ready', data: [] }); setWarehouseId(event.target.value) }}><option value="">-选择仓库-</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.businessCode} · {warehouse.name}</option>)}</select></label>
        <label><span>* 库位</span><select value={locationId} disabled={busy || !warehouseId || locations.status !== 'ready'} onChange={(event) => { changed(); setLocationId(event.target.value) }}><option value="">-选择库位-</option>{locations.status === 'ready' && locations.data.map((location) => <option key={location.id} value={location.id}>{location.businessCode} · {location.name}</option>)}</select></label>
        <label><span>* 计划数量</span><input value={quantity} type="number" inputMode="numeric" min={1} max={1_000_000_000} disabled={busy} onChange={(event) => { changed(); setQuantity(event.target.value) }} /></label>
        <label className="inventory-count-note">备注<input value={note} maxLength={500} disabled={busy} onChange={(event) => { changed(); setNote(event.target.value) }} /></label>
      </div>
      {skus.status === 'ready' && <div className="pagination"><button type="button" disabled={busy || skuPage === 0} onClick={() => { changed(); setSkuId(''); setSkuPage((value) => value - 1) }}>上一页 SKU</button><span>第 {skuPage + 1} / {Math.max(skus.data.totalPages, 1)} 页</span><button type="button" disabled={busy || skuPage + 1 >= skus.data.totalPages} onClick={() => { changed(); setSkuId(''); setSkuPage((value) => value + 1) }}>下一页 SKU</button></div>}
      {skus.status === 'error' && <div className="inline-alert" role="alert">{skus.message}<button type="button" disabled={busy} onClick={() => setSkuRefreshKey((value) => value + 1)}>重试 SKU</button></div>}
      {locations.status === 'error' && <div className="inline-alert" role="alert">{locations.message}<button type="button" disabled={busy} onClick={() => setLocationRefreshKey((value) => value + 1)}>重试库位</button></div>}
      {error && <div className="inline-alert" role="alert">{error}</div>}
      <footer className="form-actions"><button className="text-button" type="button" disabled={busy} onClick={onClose}>返回</button><button className="button button-primary" type="submit" disabled={busy || !skuId || !warehouseId || !locationId}>{busy ? '正在创建…' : '创建采购计划'}</button></footer>
    </form>
  </section></div>
}

function PlanDetailDialog({ plan, canWrite, onClose, onChanged, onOpenOrder }: { plan: ProcurementPlan; canWrite: boolean; onClose: () => void; onChanged: (plan: ProcurementPlan, message?: string) => void; onOpenOrder: (create: boolean) => void }) {
  const [reason, setReason] = useState('')
  const [pendingCommandId, setPendingCommandId] = useState(commandId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const voidPlan = async () => {
    if (busy) return
    const normalized = reason.trim()
    if (!normalized || normalized.length > 500 || /[\u0000-\u001f\u007f]/.test(normalized)) { setError('作废原因必须为 1 至 500 个非控制字符。'); return }
    setBusy(true); setError(undefined)
    try {
      onChanged(await procurementPlanApi.void(plan.id, { commandId: pendingCommandId, expectedVersion: plan.version, reason: normalized }))
    } catch (cause) {
      const message = operationMessage(cause)
      if (cause instanceof ApiError && cause.status === 409) onChanged(plan, message)
      else setError(message)
    } finally { setBusy(false) }
  }
  return <div className="dialog-backdrop" role="presentation"><section className="write-dialog inventory-count-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="plan-detail-title">
    <header className="table-heading"><div><h2 id="plan-detail-title">采购计划 {plan.planNo}</h2><span>{statusLabels[plan.status]} · {plan.source === 'SMART' ? '补货建议生成' : '手工创建'}</span></div><DialogCloseButton disabled={busy} onClick={onClose} /></header>
    <dl className="inventory-count-summary-grid">
      <div><dt>SKU</dt><dd>{plan.skuCode} · {plan.skuName}</dd></div><div><dt>规格</dt><dd>{plan.skuVariant ?? '—'}</dd></div>
      <div><dt>仓库</dt><dd>{plan.warehouseCode} · {plan.warehouseName}</dd></div><div><dt>库位</dt><dd>{plan.locationCode} · {plan.locationName}</dd></div>
      <div><dt>计划数量</dt><dd>{plan.quantity}</dd></div><div><dt>申请人</dt><dd>{plan.applicantDisplayName}</dd></div>
      <div><dt>申请时间</dt><dd><time dateTime={plan.createdAt}>{new Date(plan.createdAt).toLocaleString()}</time></dd></div>
    </dl>
    <div className="warehouse-processing-formula"><strong>备注</strong><span>{plan.note ?? '—'}</span></div>
    {plan.status === 'VOIDED' && <div className="warehouse-processing-formula"><strong>作废记录</strong><span>{plan.voidReason} · {plan.voidedByDisplayName} · {plan.voidedAt ? new Date(plan.voidedAt).toLocaleString() : '—'}</span></div>}
    {canWrite && plan.status === 'UNPURCHASED' && <div className="inventory-count-form-grid"><label className="inventory-count-note">作废原因<textarea value={reason} maxLength={500} disabled={busy} rows={3} onChange={(event) => { setPendingCommandId(commandId()); setError(undefined); setReason(event.target.value) }} /></label></div>}
    {error && <div className="inline-alert" role="alert">{error}</div>}
    <footer className="form-actions">{canWrite && plan.status === 'UNPURCHASED' && <button className="button button-primary" type="button" disabled={busy} onClick={() => onOpenOrder(true)}>生成采购单</button>}{plan.status === 'ORDERED' && <button className="button button-primary" type="button" onClick={() => onOpenOrder(false)}>查看采购单</button>}<button className="text-button" type="button" disabled={busy} onClick={onClose}>返回</button>{canWrite && plan.status === 'UNPURCHASED' && <button className="button button-danger" type="button" disabled={busy || !reason.trim()} onClick={() => void voidPlan()}>{busy ? '正在作废…' : '作废计划'}</button>}</footer>
  </section></div>
}

export function ProcurementPlanPage() {
  const { hasPermission } = useAuth()
  const canWrite = hasPermission('procurement.write')
  const router = useRouter()
  const search = useRouterState({ select: (state) => state.location.searchStr })
  const query = useMemo(() => parseProcurementPlanQuery(search), [search])
  const [list, setList] = useState<LoadState<PlanPage>>({ status: 'loading' })
  const [warehouses, setWarehouses] = useState<LoadState<ProcurementWarehouseOption[]>>({ status: 'loading' })
  const [warehouseReload, setWarehouseReload] = useState(0)
  const [locations, setLocations] = useState<LoadState<ProcurementLocationOption[]>>({ status: 'ready', data: [] })
  const [filterLocationReload, setFilterLocationReload] = useState(0)
  const [detail, setDetail] = useState<LoadState<ProcurementPlan> | undefined>()
  const [createOpen, setCreateOpen] = useState(false)
  const [notice, setNotice] = useState<string>()
  const [filterError, setFilterError] = useState<string>()
  const [reload, setReload] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [exportFeedback, setExportFeedback] = useState<{ kind: 'success' | 'error'; message: string; queryKey: string }>()

  const loadList = useCallback(() => {
    const controller = new AbortController()
    setList({ status: 'loading' })
    void procurementPlanApi.list({
      warehouseId: query.warehouseId || undefined, locationId: query.locationId || undefined,
      status: query.status || undefined, searchField: query.searchField, keyword: query.keyword || undefined,
      createdFrom: startInstant(query.createdFrom), createdTo: endInstant(query.createdTo), page: query.page, size: query.size,
      signal: controller.signal,
    }).then((data) => {
      const lastPage = Math.max(data.totalPages - 1, 0)
      if (query.page > lastPage) { router.history.push(toProcurementPlanUrl({ ...query, page: lastPage })); return }
      setList({ status: 'ready', data })
    }, () => {
      if (!controller.signal.aborted) setList({ status: 'error', message: '无法读取采购计划列表，请稍后重试。' })
    })
    return () => controller.abort()
  }, [query, reload])

  useEffect(loadList, [loadList])
  useEffect(() => {
    let active = true
    setWarehouses({ status: 'loading' })
    void (async () => {
      try {
        const items = await loadAllReferencePages((page, size) => procurementPlanApi.warehouses(undefined, page, size))
        if (active) setWarehouses({ status: 'ready', data: items })
      } catch {
        if (active) setWarehouses({ status: 'error', message: '无法读取可用仓库。' })
      }
    })()
    return () => { active = false }
  }, [warehouseReload])
  useEffect(() => {
    let active = true
    if (!query.warehouseId) {
      setLocations({ status: 'ready', data: [] })
      return () => { active = false }
    }
    setLocations({ status: 'loading' })
    void (async () => {
      try {
        const items = await loadAllReferencePages((page, size) => procurementPlanApi.locations(query.warehouseId, undefined, page, size))
        if (active) setLocations({ status: 'ready', data: items })
      } catch {
        if (active) setLocations({ status: 'error', message: '无法读取筛选库位。' })
      }
    })()
    return () => { active = false }
  }, [filterLocationReload, query.warehouseId])
  useEffect(() => { let active = true; if (!query.detailId) { setDetail(undefined); return () => { active = false } } setDetail({ status: 'loading' }); void procurementPlanApi.get(query.detailId).then((data) => { if (active) setDetail({ status: 'ready', data }) }, () => { if (active) setDetail({ status: 'error', message: '无法读取采购计划详情。' }) }); return () => { active = false } }, [query.detailId, reload])

  const submitFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget)
    const value = (name: string) => String(data.get(name) ?? '').trim()
    if (value('createdFrom') && value('createdTo') && value('createdFrom') > value('createdTo')) {
      setFilterError('申请起始日期不能晚于截止日期。')
      return
    }
    setFilterError(undefined)
    router.history.push(toProcurementPlanUrl({ searchField: oneOf(value('searchField'), searchFields.map((item) => item.value), 'PLAN_NO'), keyword: value('keyword'), warehouseId: value('warehouseId'), locationId: value('locationId'), status: oneOf(value('status'), ['', 'UNPURCHASED', 'ORDERED', 'VOIDED'] as const, ''), createdFrom: value('createdFrom'), createdTo: value('createdTo'), page: 0, size: query.size }))
  }
  const closeDetail = () => router.history.push(toProcurementPlanUrl({ ...query, detailId: '' }))
  const refreshAfterConflict = (message: string) => { setNotice(message); setReload((value) => value + 1) }
  const exportQueryKey = toProcurementPlanUrl({ ...query, detailId: '' })
  const exportPlans = async () => {
    const queryKey = exportQueryKey
    setExporting(true); setExportFeedback(undefined)
    try {
      const result = await procurementPlanApi.exportCsv({
        warehouseId: query.warehouseId || undefined,
        locationId: query.locationId || undefined,
        status: query.status || undefined, searchField: query.searchField,
        keyword: query.keyword || undefined,
        createdFrom: startInstant(query.createdFrom),
        createdTo: endInstant(query.createdTo),
      })
      const url = URL.createObjectURL(new Blob([result.content], { type: result.mediaType }))
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = result.filename
      document.body.append(anchor)
      try { anchor.click() } finally { anchor.remove(); URL.revokeObjectURL(url) }
      setExportFeedback({ kind: 'success', message: `已导出 ${result.rowCount} 条采购计划。`, queryKey })
    } catch (error) {
      setExportFeedback({ kind: 'error', message: exportMessage(error), queryKey })
    } finally { setExporting(false) }
  }

  return <main className="warehouse-archive-page procurement-plan-page" aria-labelledby="procurement-plan-title">
    <header className="warehouse-archive-heading"><div><p className="eyebrow">供应链 / 历史资料</p><h1 id="procurement-plan-title">历史采购计划</h1><p>仅用于查询和转换合并前留下的采购计划；新采购业务请直接创建采购单。</p></div></header>
    <section className="warehouse-archive-card" aria-label="历史采购计划筛选与列表">
      <form className="warehouse-archive-filters procurement-plan-filters" key={toProcurementPlanUrl({ ...query, detailId: '' })} onSubmit={submitFilters}>
        <label>搜索维度<select name="searchField" defaultValue={query.searchField}>{searchFields.map((field) => <option key={field.value} value={field.value}>{field.label}</option>)}</select></label>
        <label className="procurement-plan-keyword">关键词<input name="keyword" defaultValue={query.keyword} maxLength={120} /></label>
        <label>仓库<select name="warehouseId" defaultValue={query.warehouseId}><option value="">全部仓库</option>{warehouses.status === 'ready' && warehouses.data.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.businessCode} · {warehouse.name}</option>)}</select></label>
        <label>库位<select name="locationId" defaultValue={query.locationId} disabled={!query.warehouseId || locations.status !== 'ready'}><option value="">全部库位</option>{locations.status === 'ready' && locations.data.map((location) => <option key={location.id} value={location.id}>{location.businessCode} · {location.name}</option>)}</select></label>
        <label>状态<select name="status" defaultValue={query.status}><option value="">全部状态</option><option value="UNPURCHASED">未采购</option><option value="ORDERED">已生成采购单</option><option value="VOIDED">已作废</option></select></label>
        <label>申请日期从<input name="createdFrom" type="date" defaultValue={query.createdFrom} /></label><label>申请日期至<input name="createdTo" type="date" defaultValue={query.createdTo} /></label>
        <div className="warehouse-archive-filter-actions"><button className="is-primary" type="submit">搜索</button><button type="button" onClick={() => router.history.push('/procurement/plans')}>重置</button></div>
      </form>
      {filterError && <div className="inline-alert" role="alert">{filterError}</div>}
      <div className="warehouse-archive-actions"><button type="button" disabled={exporting || list.status !== 'ready' || list.data.totalElements === 0} onClick={() => void exportPlans()}>{exporting ? '正在导出…' : '导出筛选结果'}</button></div>
      {exportFeedback?.queryKey === exportQueryKey && <p className={`warehouse-export-feedback is-${exportFeedback.kind}`} role={exportFeedback.kind === 'error' ? 'alert' : 'status'}>{exportFeedback.message}</p>}
      {warehouses.status === 'error' && <div className="inline-alert" role="alert">{warehouses.message}<button type="button" onClick={() => setWarehouseReload((value) => value + 1)}>重试仓库</button></div>}
      {locations.status === 'error' && <div className="inline-alert" role="alert">{locations.message}<button type="button" onClick={() => setFilterLocationReload((value) => value + 1)}>重试筛选库位</button></div>}
      {notice && <div className="inline-alert" role="status">{notice}</div>}
      {list.status === 'loading' && <p className="product-state" role="status">正在加载采购计划…</p>}
      {list.status === 'error' && <div className="compact-empty-state" role="alert"><strong>无法读取采购计划</strong><span>{list.message}</span><button className="text-button" type="button" onClick={() => setReload((value) => value + 1)}>重试</button></div>}
      {list.status === 'ready' && <div className="warehouse-archive-table-wrap"><table aria-label="采购计划列表"><thead><tr><th>计划编号</th><th>SKU / 规格</th><th>仓库 / 库位</th><th>数量</th><th>备注</th><th>状态 / 来源</th><th>申请时间 / 申请人</th><th>操作</th></tr></thead><tbody>{list.data.items.length === 0 ? <tr><td colSpan={8}><div className="warehouse-archive-empty" role="status"><strong>无历史采购计划</strong><span>合并前没有留下可查询的采购计划。</span></div></td></tr> : list.data.items.map((plan) => <tr key={plan.id}><td>{plan.planNo}</td><td>{plan.skuCode} · {plan.skuName}<br /><small>{plan.skuVariant ?? '—'}</small></td><td>{plan.warehouseName}<br /><small>{plan.locationCode} · {plan.locationName}</small></td><td>{plan.quantity}</td><td>{plan.note ?? '—'}</td><td><span className={`status-badge is-${plan.status.toLowerCase()}`}>{statusLabels[plan.status]}</span><br /><small>{plan.source === 'SMART' ? '补货建议生成' : '手工创建'}</small></td><td><time dateTime={plan.createdAt}>{new Date(plan.createdAt).toLocaleString()}</time><br /><small>{plan.applicantDisplayName}</small></td><td><button className="text-button" type="button" onClick={() => router.history.push(toProcurementPlanUrl({ ...query, detailId: plan.id }))}>详情</button>{canWrite && plan.status === 'UNPURCHASED' && <button className="text-button" type="button" onClick={() => router.history.push(toProcurementPlanUrl({ ...query, detailId: plan.id }))}>作废</button>}</td></tr>)}</tbody></table>
        <div className="pagination"><span>共 {list.data.totalElements} 条</span><button type="button" disabled={query.page === 0} onClick={() => router.history.push(toProcurementPlanUrl({ ...query, page: query.page - 1, detailId: '' }))}>上一页</button><span>第 {query.page + 1} / {Math.max(list.data.totalPages, 1)} 页</span><button type="button" disabled={query.page + 1 >= list.data.totalPages} onClick={() => router.history.push(toProcurementPlanUrl({ ...query, page: query.page + 1, detailId: '' }))}>下一页</button><label>每页<select value={query.size} onChange={(event) => router.history.push(toProcurementPlanUrl({ ...query, page: 0, size: Number(event.target.value), detailId: '' }))}>{PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}</select></label></div>
      </div>}
    </section>
    {createOpen && warehouses.status === 'ready' && <CreatePlanDialog warehouses={warehouses.data} onClose={() => setCreateOpen(false)} onCreated={(plan) => { setCreateOpen(false); setReload((value) => value + 1); router.history.push(toProcurementPlanUrl({ ...query, detailId: plan.id })) }} />}
    {detail?.status === 'loading' && <div className="dialog-backdrop" role="presentation"><section className="write-dialog" role="dialog" aria-modal="true" aria-labelledby="loading-plan-detail-title"><header className="table-heading"><h2 id="loading-plan-detail-title">采购计划详情</h2><DialogCloseButton onClick={closeDetail} /></header><p className="product-state" role="status">正在加载采购计划详情…</p></section></div>}
    {detail?.status === 'error' && <div className="dialog-backdrop" role="presentation"><section className="write-dialog" role="dialog" aria-modal="true" aria-labelledby="error-plan-detail-title"><header className="table-heading"><h2 id="error-plan-detail-title">采购计划详情</h2><DialogCloseButton onClick={closeDetail} /></header><div className="inline-alert" role="alert">{detail.message}</div><footer className="form-actions"><button className="button button-primary" type="button" onClick={() => setReload((value) => value + 1)}>重试</button></footer></section></div>}
    {detail?.status === 'ready' && <PlanDetailDialog plan={detail.data} canWrite={canWrite} onClose={closeDetail} onOpenOrder={(create) => router.history.push(toProcurementOrderForPlanUrl(detail.data.planNo, create))} onChanged={(plan, conflict) => { if (conflict) refreshAfterConflict(conflict); else { setNotice('采购计划已作废。'); setReload((value) => value + 1); setDetail({ status: 'ready', data: plan }) } }} />}
  </main>
}
