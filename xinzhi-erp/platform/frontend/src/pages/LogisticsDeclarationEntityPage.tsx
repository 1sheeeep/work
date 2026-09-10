import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useRouterState } from '@tanstack/react-router'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import {
  logisticsDeclarationEntityApi,
  type DeclarationEntity,
  type DeclarationEntityInput,
  type DeclarationEntityPage,
  type DeclarationEntityStatus,
  type DeclarationSearchField,
  type DeclarationShopOption,
  type DeclarationShopOptionPage,
} from '../modules/logisticsDeclarationEntityApi'
import './WarehouseArchiveShells.css'

export type DeclarationEntityQuery = {
  searchField: DeclarationSearchField
  status: 'ALL' | DeclarationEntityStatus
  keyword: string
  page: number
}
function boundedText(value: string | null, maximum = 120) {
  return (value ?? '').trim().slice(0, maximum)
}
function searchField(value: string | null): DeclarationSearchField {
  return value === 'CODE' || value === 'PLATFORM' || value === 'SHOP' ? value : 'NAME'
}
function lifecycleStatus(value: string | null): 'ALL' | DeclarationEntityStatus {
  return value === 'ARCHIVED' || value === 'ALL' ? value : 'ACTIVE'
}
function pageNumber(value: string | null) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0
}
export function parseDeclarationEntityQuery(search: string): DeclarationEntityQuery {
  const params = new URLSearchParams(search)
  return {
    searchField: searchField(params.get('searchField')),
    status: lifecycleStatus(params.get('status')),
    keyword: boundedText(params.get('keyword')),
    page: pageNumber(params.get('page')),
  }
}
export function toDeclarationEntityUrl(query: Partial<DeclarationEntityQuery>) {
  const params = new URLSearchParams()
  if (query.searchField && query.searchField !== 'NAME') params.set('searchField', query.searchField)
  if (query.status && query.status !== 'ACTIVE') params.set('status', query.status)
  if (query.keyword) params.set('keyword', boundedText(query.keyword))
  if (query.page && query.page > 0) params.set('page', String(query.page))
  const serialized = params.toString()
  return serialized ? `/logistics/declaration-entities?${serialized}` : '/logistics/declaration-entities'
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: DeclarationEntityPage }
type OptionState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: DeclarationShopOptionPage }
type FormState = { mode: 'create' } | { mode: 'edit'; value: DeclarationEntity }

function errorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 409) return '该企业编码已存在，或记录已被其他操作更新，请刷新后重试。'
  if (error instanceof ApiError && error.status === 403) return '当前账号没有管理企业申报信息的权限。'
  return '操作未完成，请检查输入、店铺状态或网络后重试。'
}
function optionFromBinding(shop: DeclarationEntity['shops'][number]): DeclarationShopOption {
  return {
    id: shop.shopId, name: shop.shopName, status: shop.shopStatus,
    platformCode: shop.platformCode, platformName: shop.platformName,
  }
}

function DeclarationEntityForm({ state, busy, onCancel, onSaved, onError }: {
  state: FormState
  busy: boolean
  onCancel: () => void
  onSaved: (message: string) => void
  onError: (message: string) => void
}) {
  const value = state.mode === 'edit' ? state.value : undefined
  const [saving, setSaving] = useState(false)
  const [shopKeyword, setShopKeyword] = useState('')
  const [selected, setSelected] = useState(() => new Set(value?.shops.map((shop) => shop.shopId) ?? []))
  const [knownOptions, setKnownOptions] = useState(() => new Map(
    value?.shops.map((shop) => [shop.shopId, optionFromBinding(shop)]) ?? [],
  ))
  const [optionState, setOptionState] = useState<OptionState>({ status: 'loading' })
  const loadOptions = useCallback((keyword: string) => {
    setOptionState({ status: 'loading' })
    void logisticsDeclarationEntityApi.shopOptions({ keyword, page: 0, size: 100 })
      .then((data) => {
        setKnownOptions((current) => {
          const next = new Map(current)
          data.items.forEach((item) => next.set(item.id, item))
          return next
        })
        setOptionState({ status: 'ready', data })
      })
      .catch((error: unknown) => setOptionState({ status: 'error', message: errorMessage(error) }))
  }, [])
  useEffect(() => loadOptions(''), [loadOptions])

  const toggle = (option: DeclarationShopOption, checked: boolean) => {
    setKnownOptions((current) => new Map(current).set(option.id, option))
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(option.id); else next.delete(option.id)
      return next
    })
  }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const input: DeclarationEntityInput = {
      name: String(data.get('name') ?? '').trim(),
      enterpriseCode: String(data.get('enterpriseCode') ?? '').trim().toUpperCase(),
      shopIds: [...selected],
    }
    if (!input.name || !/^[A-Z0-9][A-Z0-9._:/ -]{0,99}$/.test(input.enterpriseCode)) {
      onError('请填写企业名称，并使用有效的企业编码（字母、数字、空格及 . _ : / -）。')
      return
    }
    setSaving(true)
    try {
      if (value) {
        await logisticsDeclarationEntityApi.update(value.id, value.version, input)
        onSaved(`企业“${input.name}”已更新。`)
      } else {
        await logisticsDeclarationEntityApi.create(input)
        onSaved(`企业“${input.name}”已创建。`)
      }
    } catch (error) { onError(errorMessage(error)) }
    finally { setSaving(false) }
  }
  const visibleSelected = [...selected].map((id) => knownOptions.get(id)).filter(Boolean) as DeclarationShopOption[]

  return <form className="warehouse-archive-card" aria-label={value ? '编辑企业申报信息' : '新增企业申报信息'} onSubmit={(event) => void submit(event)}>
    <h2>{value ? '编辑企业申报信息' : '新增企业申报信息'}</h2>
    <p className="cell-secondary">维护生产销售企业标识与店铺关系；订单使用时需手动选择。</p>
    <fieldset><legend>企业基本信息</legend><div className="warehouse-archive-filters">
      <label>生产销售企业名称<input name="name" required maxLength={200} autoFocus defaultValue={value?.name} /></label>
      <label>生产销售企业编码<input name="enterpriseCode" required maxLength={100} pattern="[A-Za-z0-9][A-Za-z0-9._:/ \-]{0,99}" defaultValue={value?.enterpriseCode} /></label>
    </div></fieldset>
    <fieldset><legend>绑定店铺（已选 {selected.size} 个）</legend>
      <p className="cell-secondary">可不绑定店铺；归档店铺不能新增绑定，暂停店铺会明确标记，保存前请确认是否保留。</p>
      <div className="warehouse-archive-filters"><label>搜索店铺<input value={shopKeyword} maxLength={120} placeholder="店铺、平台名称或平台编码" onChange={(event) => setShopKeyword(event.target.value)} /></label><div className="warehouse-archive-filter-actions"><button type="button" disabled={optionState.status === 'loading'} onClick={() => loadOptions(boundedText(shopKeyword))}>搜索店铺</button></div></div>
      {visibleSelected.length > 0 && <div className="cell-secondary" aria-label="已选择店铺">已选择：{visibleSelected.map((item) => <span key={item.id}>{item.platformName} · {item.name} <button type="button" className="text-button" onClick={() => toggle(item, false)}>移除</button></span>)}</div>}
      {optionState.status === 'loading' && <p role="status">正在加载可绑定店铺…</p>}
      {optionState.status === 'error' && <div role="alert"><span>{optionState.message}</span><button type="button" className="text-button" onClick={() => loadOptions(boundedText(shopKeyword))}>重试</button></div>}
      {optionState.status === 'ready' && <div className="warehouse-archive-filters" aria-label="可绑定店铺">
        {optionState.data.items.length === 0 ? <p className="cell-secondary">没有符合条件的可绑定店铺。</p> : optionState.data.items.map((option) => <label key={option.id}><input type="checkbox" checked={selected.has(option.id)} onChange={(event) => toggle(option, event.target.checked)} />{option.platformName} · {option.name}{option.status === 'SUSPENDED' ? '（已暂停）' : ''}</label>)}
      </div>}
    </fieldset>
    <div className="form-actions"><button className="button button-secondary" type="button" disabled={busy || saving} onClick={onCancel}>取消</button><button className="button button-primary" type="submit" disabled={busy || saving || optionState.status === 'loading'}>{saving ? '正在保存…' : '保存企业信息'}</button></div>
  </form>
}

export function LogisticsDeclarationEntityPage() {
  const router = useRouter()
  const search = useRouterState({ select: (state) => state.location.searchStr })
  const { hasPermission } = useAuth()
  const query = useMemo(() => parseDeclarationEntityQuery(search), [search])
  const canWrite = hasPermission('logistics.declaration_entity.write')
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [reload, setReload] = useState(0)
  const [form, setForm] = useState<FormState>()
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string }>()
  const navigate = (next: Partial<DeclarationEntityQuery>) => router.history.push(toDeclarationEntityUrl(next))
  const refresh = useCallback(() => setReload((value) => value + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })
    void logisticsDeclarationEntityApi.list({ ...query, size: 25, signal: controller.signal })
      .then((data) => setState({ status: 'ready', data }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ status: 'error', message: errorMessage(error) })
      })
    return () => controller.abort()
  }, [query, reload])

  const submitFilter = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget)
    navigate({ searchField: searchField(String(data.get('searchField') ?? 'NAME')), status: lifecycleStatus(String(data.get('status') ?? 'ACTIVE')), keyword: boundedText(String(data.get('keyword') ?? '')), page: 0 })
  }
  const edit = async (id: string) => {
    setBusy(true); setFeedback(undefined)
    try { setForm({ mode: 'edit', value: await logisticsDeclarationEntityApi.detail(id) }) }
    catch (error) { setFeedback({ kind: 'error', message: errorMessage(error) }) }
    finally { setBusy(false) }
  }
  const archive = async (item: DeclarationEntity) => {
    if (!window.confirm(`确认停用企业“${item.name}”？历史店铺绑定会保留，但记录不能继续编辑。`)) return
    setBusy(true); setFeedback(undefined)
    try {
      await logisticsDeclarationEntityApi.archive(item.id, item.version)
      setFeedback({ kind: 'success', message: `企业“${item.name}”已停用。` }); refresh()
    } catch (error) { setFeedback({ kind: 'error', message: errorMessage(error) }) }
    finally { setBusy(false) }
  }

  return <main className="warehouse-archive-page" aria-labelledby="declaration-entity-title">
    <header className="warehouse-archive-heading"><div><p className="eyebrow">物流 / 物流管理</p><h1 id="declaration-entity-title">企业申报信息管理</h1><p>维护生产销售企业与店铺的绑定关系。</p></div></header>
    <section className="warehouse-archive-card" aria-label="企业申报信息筛选与列表">
      <div className="warehouse-processing-formula" role="note"><strong>使用说明</strong><span>在此维护企业名称、企业编码和店铺绑定；订单和交运时需手动选择。</span></div>
      <form className="warehouse-archive-filters" key={toDeclarationEntityUrl(query)} onSubmit={submitFilter}><label>搜索字段<select name="searchField" defaultValue={query.searchField}><option value="NAME">生产销售企业名称</option><option value="CODE">生产销售企业编码</option><option value="PLATFORM">平台</option><option value="SHOP">绑定店铺</option></select></label><label>状态<select name="status" defaultValue={query.status}><option value="ACTIVE">使用中</option><option value="ARCHIVED">已停用</option><option value="ALL">全部</option></select></label><label>搜索内容<input name="keyword" defaultValue={query.keyword} maxLength={120} placeholder="请输入搜索内容" /></label><div className="warehouse-archive-filter-actions"><button className="is-primary" type="submit">搜索</button><button type="button" onClick={() => navigate({})}>重置</button></div></form>
      <div className="warehouse-archive-actions">{canWrite && <button className="is-primary" type="button" disabled={busy} onClick={() => { setFeedback(undefined); setForm({ mode: 'create' }) }}>新增企业信息</button>}</div>
      {feedback && <p className={`warehouse-export-feedback is-${feedback.kind}`} role={feedback.kind === 'error' ? 'alert' : 'status'}>{feedback.message}</p>}
      {form && <DeclarationEntityForm state={form} busy={busy} onCancel={() => setForm(undefined)} onSaved={(message) => { setForm(undefined); setFeedback({ kind: 'success', message }); refresh() }} onError={(message) => setFeedback({ kind: 'error', message })} />}
      {state.status === 'loading' && <p className="product-state" role="status">正在加载企业申报信息…</p>}
      {state.status === 'error' && <div className="compact-empty-state" role="alert"><strong>无法读取企业申报信息</strong><span>{state.message}</span><button className="text-button" type="button" onClick={refresh}>重试</button></div>}
      {state.status === 'ready' && <div className="warehouse-archive-table-wrap"><table aria-label="企业申报信息列表"><thead><tr><th>生产销售企业名称</th><th>生产销售企业编码</th><th>平台 / 绑定店铺</th><th>状态</th><th>更新时间</th><th>操作</th></tr></thead><tbody>{state.data.items.length === 0 ? <tr><td colSpan={6}><div className="warehouse-archive-empty" role="status"><strong>没有符合条件的企业信息</strong><span>{canWrite ? '可新增生产销售企业，并按需绑定现有店铺。' : '请调整筛选条件后重试。'}</span></div></td></tr> : state.data.items.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.enterpriseCode}</td><td>{item.shops.length === 0 ? '未绑定' : item.shops.map((shop) => `${shop.platformName} · ${shop.shopName}`).join('；')}</td><td><span className={`status-badge is-${item.status.toLowerCase()}`}>{item.status === 'ACTIVE' ? '使用中' : '已停用'}</span></td><td>{new Date(item.updatedAt).toLocaleString('zh-CN')}</td><td>{canWrite && item.status === 'ACTIVE' ? <><button className="text-button" type="button" disabled={busy} onClick={() => void edit(item.id)}>编辑</button><button className="text-button" type="button" disabled={busy} onClick={() => void archive(item)}>停用</button></> : '—'}</td></tr>)}</tbody></table><nav className="pagination" aria-label="企业申报信息分页"><span>共 {state.data.totalElements} 条 · 第 {state.data.page + 1} / {Math.max(state.data.totalPages, 1)} 页</span><div><button type="button" disabled={state.data.page === 0} onClick={() => navigate({ ...query, page: query.page - 1 })}>上一页</button><button type="button" disabled={state.data.page + 1 >= state.data.totalPages} onClick={() => navigate({ ...query, page: query.page + 1 })}>下一页</button></div></nav></div>}
    </section>
  </main>
}
