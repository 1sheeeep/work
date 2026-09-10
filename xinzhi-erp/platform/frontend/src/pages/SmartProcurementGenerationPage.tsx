import { useRouter, useRouterState } from '@tanstack/react-router'
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import {
  procurementRecommendationApi,
  type ProcurementRecommendation,
  type ProcurementRecommendationPage,
} from '../modules/procurementRecommendationApi'
import './WarehouseArchiveShells.css'

const DEFAULT_SIZE = 25
const PAGE_SIZES = [10, 25, 50, 100] as const

export type SmartProcurementQuery = {
  supplier: string
  keyword: string
  hideWithoutSupplier: boolean
  hideZeroRecommendation: boolean
  page: number
  size: number
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; data: ProcurementRecommendationPage }
  | { status: 'error'; message: string }

function boundedText(value: string | null, maximum: number) {
  return (value ?? '').trim().slice(0, maximum)
}

function boundedInteger(value: string | null, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback
}

function rowId(item: Pick<ProcurementRecommendation, 'skuId' | 'warehouseId'>) {
  return `${item.skuId}:${item.warehouseId}`
}

function commandId() {
  return crypto.randomUUID()
}

function safeMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 409) {
    return '库存、待到货或首选供应商已变化，请重新计算后再试。'
  }
  if (error instanceof ApiError && error.status === 403) {
    return '当前账号没有采购操作权限。'
  }
  return '暂时无法完成操作，请稍后重试。'
}

export function parseSmartProcurementQuery(search: string): SmartProcurementQuery {
  const params = new URLSearchParams(search)
  return {
    supplier: boundedText(params.get('supplier'), 100),
    keyword: boundedText(params.get('keyword'), 120),
    hideWithoutSupplier: params.get('hideWithoutSupplier') === 'true',
    hideZeroRecommendation: params.get('hideZeroRecommendation') === 'true',
    page: boundedInteger(params.get('page'), 0, 0, 9_999),
    size: boundedInteger(params.get('size'), DEFAULT_SIZE, 1, 100),
  }
}

export function toSmartProcurementUrl(query: Partial<SmartProcurementQuery>) {
  const params = new URLSearchParams()
  const supplier = boundedText(query.supplier ?? '', 100)
  const keyword = boundedText(query.keyword ?? '', 120)
  if (supplier) params.set('supplier', supplier)
  if (keyword) params.set('keyword', keyword)
  if (query.hideWithoutSupplier) params.set('hideWithoutSupplier', 'true')
  if (query.hideZeroRecommendation) params.set('hideZeroRecommendation', 'true')
  if (query.page && query.page > 0) params.set('page', String(query.page))
  if (query.size && query.size !== DEFAULT_SIZE) params.set('size', String(query.size))
  const serialized = params.toString()
  return serialized ? `/procurement/smart-generation?${serialized}` : '/procurement/smart-generation'
}

export function SmartProcurementGenerationPage() {
  const router = useRouter()
  const search = useRouterState({ select: (state) => state.location.searchStr })
  const { hasPermission } = useAuth()
  const canWrite = hasPermission('procurement.write')
  const query = useMemo(() => parseSmartProcurementQuery(search), [search])
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [reload, setReload] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [locations, setLocations] = useState<Record<string, string>>({})
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [generating, setGenerating] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [notice, setNotice] = useState<{ message: string; reviewLink: boolean }>()
  const [actionError, setActionError] = useState<string>()
  const preserveNoticeOnReload = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    const asOf = new Date().toISOString()
    setState({ status: 'loading' })
    if (preserveNoticeOnReload.current) preserveNoticeOnReload.current = false
    else setNotice(undefined)
    setActionError(undefined)
    void procurementRecommendationApi.list({
      supplier: query.supplier || undefined,
      keyword: query.keyword || undefined,
      hideWithoutSupplier: query.hideWithoutSupplier,
      hideZeroRecommendation: query.hideZeroRecommendation,
      asOf,
      page: query.page,
      size: query.size,
      signal: controller.signal,
    }).then((data) => {
      if (controller.signal.aborted) return
      const nextLocations: Record<string, string> = {}
      const nextQuantities: Record<string, string> = {}
      data.items.forEach((item) => {
        const id = rowId(item)
        const options = data.locations.filter((location) => location.warehouseId === item.warehouseId)
        nextLocations[id] = options.length === 1 ? options[0].id : ''
        nextQuantities[id] = String(item.recommendedQuantity)
      })
      setSelected(new Set())
      setLocations(nextLocations)
      setQuantities(nextQuantities)
      setState({ status: 'ready', data })
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setState({ status: 'error', message: safeMessage(error) })
    })
    return () => controller.abort()
  }, [query.supplier, query.keyword, query.hideWithoutSupplier, query.hideZeroRecommendation, query.page, query.size, reload])

  const locationOptions = useMemo(() => {
    if (state.status !== 'ready') return new Map<string, ProcurementRecommendationPage['locations']>()
    const result = new Map<string, ProcurementRecommendationPage['locations']>()
    state.data.locations.forEach((location) => {
      result.set(location.warehouseId, [...(result.get(location.warehouseId) ?? []), location])
    })
    return result
  }, [state])

  const actionableRows = state.status === 'ready'
    ? state.data.items.filter((item) => item.recommendedQuantity > 0
      && item.supplierId && item.activeLocationCount > 0)
    : []

  const selectedRows = actionableRows.filter((item) => selected.has(rowId(item)))
  const selectionReady = selectedRows.length > 0 && selectedRows.every((item) => {
    const id = rowId(item)
    const quantity = Number(quantities[id])
    return Boolean(locations[id]) && Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= 1_000_000_000
  })

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    router.history.push(toSmartProcurementUrl({
      supplier: String(data.get('supplier') ?? ''),
      keyword: String(data.get('keyword') ?? ''),
      hideWithoutSupplier: data.get('hideWithoutSupplier') === 'on',
      hideZeroRecommendation: data.get('hideZeroRecommendation') === 'on',
      size: query.size,
    }))
  }

  const exportRows = async () => {
    if (state.status !== 'ready') return
    setExporting(true)
    setActionError(undefined)
    try {
      const result = await procurementRecommendationApi.exportCsv({
        supplier: query.supplier || undefined,
        keyword: query.keyword || undefined,
        hideWithoutSupplier: query.hideWithoutSupplier,
        hideZeroRecommendation: query.hideZeroRecommendation,
        asOf: state.data.observedAt,
      })
      const url = URL.createObjectURL(new Blob([result.content], { type: result.mediaType }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = result.filename
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      setNotice({ message: `已导出 ${result.rowCount} 条补货建议。`, reviewLink: false })
    } catch (error) {
      setActionError(safeMessage(error))
    } finally {
      setExporting(false)
    }
  }

  const generate = async () => {
    if (state.status !== 'ready' || !selectionReady) return
    setGenerating(true)
    setActionError(undefined)
    setNotice(undefined)
    try {
      const result = await procurementRecommendationApi.generate({
        commandId: commandId(),
        observedAt: state.data.observedAt,
        items: selectedRows.map((item) => ({
          skuId: item.skuId,
          warehouseId: item.warehouseId,
          locationId: locations[rowId(item)],
          expectedRecommendedQuantity: item.recommendedQuantity,
          quantity: Number(quantities[rowId(item)]),
        })),
      })
      setNotice({ message: `已生成 ${result.items.length} 张采购单，当前状态为待审核。`, reviewLink: true })
      setSelected(new Set())
      preserveNoticeOnReload.current = true
      setReload((value) => value + 1)
    } catch (error) {
      setActionError(safeMessage(error))
    } finally {
      setGenerating(false)
    }
  }

  const allActionableSelected = actionableRows.length > 0
    && actionableRows.every((item) => selected.has(rowId(item)))

  return (
    <main className="warehouse-archive-page" aria-labelledby="smart-procurement-title">
      <header className="warehouse-archive-heading">
        <div>
          <p className="eyebrow">供应链 / 采购流程</p>
          <h1 id="smart-procurement-title">补货建议</h1>
          <p>根据真实销量、可用库存、待到货和首选供应商交期计算采购数量。</p>
        </div>
        <div className="warehouse-archive-actions">
          <button type="button" disabled={state.status === 'loading'} onClick={() => setReload((value) => value + 1)}>重新计算</button>
          <button type="button" disabled={exporting || state.status !== 'ready' || state.data.totalElements === 0} onClick={() => void exportRows()}>{exporting ? '正在导出…' : '导出筛选结果'}</button>
          {canWrite && <button className="is-primary" type="button" disabled={generating || !selectionReady} onClick={() => void generate()}>{generating ? '正在生成…' : `生成采购单${selectedRows.length ? `（${selectedRows.length}）` : ''}`}</button>}
        </div>
      </header>

      <section className="warehouse-archive-card" aria-label="补货建议筛选与结果">
        <form className="warehouse-archive-filters procurement-plan-filters" key={toSmartProcurementUrl(query)} onSubmit={submit}>
          <label>首选供应商<input name="supplier" defaultValue={query.supplier} maxLength={100} placeholder="供应商编码或名称" /></label>
          <label className="procurement-plan-keyword">SKU / 仓库<input name="keyword" defaultValue={query.keyword} maxLength={120} placeholder="SKU 编号、名称或仓库" /></label>
          <label className="warehouse-archive-checkbox"><input name="hideWithoutSupplier" type="checkbox" defaultChecked={query.hideWithoutSupplier} />隐藏未设置首选供应商</label>
          <label className="warehouse-archive-checkbox"><input name="hideZeroRecommendation" type="checkbox" defaultChecked={query.hideZeroRecommendation} />隐藏建议量为 0 的商品</label>
          <div className="warehouse-archive-filter-actions">
            <button className="is-primary" type="submit">搜索</button>
            <button type="button" onClick={() => router.history.push('/procurement/smart-generation')}>重置</button>
          </div>
        </form>

        <div className="warehouse-processing-formula" role="note">
          <strong>计算规则</strong>
          <span>目标库存 = 近 28 天日均销量 ×（首选供应商交期 + 7 个安全天）；建议采购量 = 目标库存 − 可用库存 − 待到货。未维护交期时按 28 天计算。</span>
        </div>

        {notice && <div className="form-success" role="status">{notice.message}{notice.reviewLink && <button className="text-button" type="button" onClick={() => router.history.push('/procurement/reviews')}>查看待审核采购单</button>}</div>}
        {actionError && <div className="form-error" role="alert">{actionError}</div>}
        {state.status === 'loading' && <div className="warehouse-archive-empty" role="status"><strong>正在计算补货建议</strong><span>正在汇总销量、库存和待到货数据。</span></div>}
        {state.status === 'error' && <div className="warehouse-archive-empty" role="alert"><strong>无法加载补货建议</strong><span>{state.message}</span><button type="button" onClick={() => setReload((value) => value + 1)}>重试</button></div>}

        {state.status === 'ready' && <>
          <div className="warehouse-summary-grid smart-procurement-summary" aria-label="补货建议汇总">
            <article><span>筛选结果</span><strong>{state.data.totalElements}</strong><small>SKU × 仓库</small></article>
            <article><span>可生成</span><strong>{state.data.actionableCount}</strong><small>已具备供应商和库位</small></article>
            <article><span>建议采购</span><strong>{state.data.totalRecommendedQuantity}</strong><small>合计件数</small></article>
            <article><span>统计截至</span><strong>{new Date(state.data.observedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong><small>{new Date(state.data.observedAt).toLocaleDateString()}</small></article>
          </div>

          <div className="warehouse-archive-actions smart-procurement-selection-actions">
            <button type="button" disabled={actionableRows.length === 0 || allActionableSelected} onClick={() => setSelected(new Set(actionableRows.map(rowId)))}>全选当前页可生成项</button>
            <button type="button" disabled={selected.size === 0} onClick={() => setSelected(new Set())}>清空选择</button>
            <span>已选 {selectedRows.length} 项</span>
          </div>

          <div className="warehouse-archive-table-wrap">
            <table aria-label="补货建议列表" className="smart-procurement-table">
              <thead><tr><th><span className="sr-only">选择</span></th><th>SKU / 仓库</th><th>销量 / 覆盖</th><th>库存</th><th>待到货</th><th>首选供应商</th><th>目标库存</th><th>建议采购</th><th>收货库位</th><th>采购数量</th></tr></thead>
              <tbody>{state.data.items.length === 0
                ? <tr><td colSpan={10}><div className="warehouse-archive-empty" role="status"><strong>没有符合条件的补货建议</strong><span>可调整筛选条件，或确认商品已有库存、销量和仓库数据。</span></div></td></tr>
                : state.data.items.map((item) => {
                  const id = rowId(item)
                  const options = locationOptions.get(item.warehouseId) ?? []
                  const actionable = item.recommendedQuantity > 0 && Boolean(item.supplierId) && options.length > 0
                  return <tr key={id}>
                    <td><input type="checkbox" aria-label={`选择 ${item.skuCode} ${item.warehouseCode}`} disabled={!canWrite || !actionable || generating} checked={selected.has(id)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(id); else next.delete(id); return next })} /></td>
                    <td><strong>{item.skuCode}</strong> · {item.skuName}<br /><small>{item.skuVariant ?? '无规格'} · {item.warehouseCode} / {item.warehouseName}</small></td>
                    <td>近 28 天 {item.last28DaysSalesQuantity}<br /><small>目标覆盖 {item.targetCoverageDays} 天</small></td>
                    <td>现货 {item.onHand} / 预留 {item.reserved}<br /><small>可用 {item.available}</small></td>
                    <td>{item.openPurchaseQuantity}</td>
                    <td>{item.supplierId ? <>{item.supplierCode} · {item.supplierName}<br /><small>交期 {item.supplierLeadTimeDays ?? `${item.planningLeadTimeDays}（默认）`} 天</small></> : <span className="status-badge is-warning">未设置首选供应商</span>}</td>
                    <td>{item.targetStockQuantity}</td>
                    <td><strong className={item.recommendedQuantity > 0 ? 'smart-procurement-quantity' : undefined}>{item.recommendedQuantity}</strong></td>
                    <td>{options.length > 0 ? <select aria-label={`${item.skuCode} 收货库位`} value={locations[id] ?? ''} disabled={!canWrite || !actionable || generating} onChange={(event) => setLocations((current) => ({ ...current, [id]: event.target.value }))}><option value="">请选择</option>{options.map((location) => <option key={location.id} value={location.id}>{location.businessCode} · {location.name}</option>)}</select> : <span className="status-badge is-warning">无有效库位</span>}</td>
                    <td><input className="smart-procurement-quantity-input" aria-label={`${item.skuCode} 采购数量`} type="number" min={1} max={1_000_000_000} step={1} disabled={!canWrite || !actionable || generating} value={quantities[id] ?? ''} onChange={(event) => setQuantities((current) => ({ ...current, [id]: event.target.value }))} /></td>
                  </tr>
                })}</tbody>
            </table>
          </div>

          <div className="procurement-plan-table-footer">
            <span>共 {state.data.totalElements} 条</span>
            <label>每页<select value={query.size} onChange={(event) => router.history.push(toSmartProcurementUrl({ ...query, page: 0, size: Number(event.target.value) }))}>{PAGE_SIZES.map((size) => <option key={size} value={size}>{size} 条</option>)}</select></label>
            <div className="pagination"><button type="button" disabled={query.page === 0} onClick={() => router.history.push(toSmartProcurementUrl({ ...query, page: query.page - 1 }))}>上一页</button><span>第 {query.page + 1} / {Math.max(state.data.totalPages, 1)} 页</span><button type="button" disabled={query.page + 1 >= state.data.totalPages} onClick={() => router.history.push(toSmartProcurementUrl({ ...query, page: query.page + 1 }))}>下一页</button></div>
          </div>
        </>}
      </section>
    </main>
  )
}
