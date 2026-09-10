import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useRouter, useRouterState } from '@tanstack/react-router'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { DialogCloseButton } from '../components/DialogCloseButton'
import { SettingsPageHeader } from '../components/SettingsPageLayout'
import {
  shopAliasApi,
  type ShopAlias,
  type ShopAliasInput,
  type ShopAliasPage,
  type ShopAliasQuery,
} from '../modules/shopAliasApi'
import './WarehouseArchiveShells.css'

const PATH = '/settings/parameters/aliases'
const PAGE_SIZES = [25, 50, 100] as const
const ALIAS_FIELDS = [
  ['aliasEn', '英文'], ['aliasZhCn', '中文'], ['aliasEs', '西班牙语'],
  ['aliasId', '印尼语'], ['aliasTh', '泰语'], ['aliasRu', '俄语'],
  ['aliasPt', '葡萄牙语'], ['aliasVi', '越南语'], ['aliasMs', '马来语'],
] as const

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; page: ShopAliasPage }

function bounded(value: string | null, max = 160) {
  return (value ?? '').trim().slice(0, max)
}

export function parseShopAliasQuery(search: string): ShopAliasQuery {
  const params = new URLSearchParams(search)
  const keyword = bounded(params.get('keyword'))
  const page = Math.max(0, Number.parseInt(params.get('page') ?? '0', 10) || 0)
  const candidateSize = Number.parseInt(params.get('size') ?? '25', 10)
  const size = PAGE_SIZES.includes(candidateSize as typeof PAGE_SIZES[number])
    ? candidateSize as typeof PAGE_SIZES[number] : 25
  return { keyword: keyword || undefined, page, size }
}

export function toShopAliasUrl(query: ShopAliasQuery) {
  const params = new URLSearchParams()
  if (query.keyword) params.set('keyword', query.keyword)
  if ((query.page ?? 0) > 0) params.set('page', String(query.page))
  if ((query.size ?? 25) !== 25) params.set('size', String(query.size))
  const serialized = params.toString()
  return serialized ? `${PATH}?${serialized}` : PATH
}

function errorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 409) {
    return '别名刚被其他操作更新，请刷新后重试。'
  }
  if (error instanceof ApiError && error.status === 403) {
    return '当前账号没有维护业务参数的权限。'
  }
  return '保存失败，请检查填写内容后重试。'
}

export function SettingsAliasManagementPage() {
  const router = useRouter()
  const search = useRouterState({ select: (state) => state.location.searchStr })
  const query = useMemo(() => parseShopAliasQuery(search), [search])
  const { hasPermission } = useAuth()
  const canWrite = hasPermission('settings.parameter.write')
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [reload, setReload] = useState(0)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<ShopAlias>()
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string }>()

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })
    void shopAliasApi.list(query, controller.signal)
      .then((page) => setState({ status: 'ready', page }))
      .catch(() => { if (!controller.signal.aborted) setState({ status: 'error' }) })
    return () => controller.abort()
  }, [query, reload])

  const navigate = (patch: Partial<ShopAliasQuery>) => {
    router.history.push(toShopAliasUrl({ ...query, ...patch }))
  }

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const value = bounded(String(new FormData(event.currentTarget).get('keyword') ?? ''))
    navigate({ keyword: value || undefined, page: 0 })
  }

  const save = async (item: ShopAlias, input: ShopAliasInput) => {
    setBusy(true); setFeedback(undefined)
    try {
      await shopAliasApi.save(item.shopId, item.version, input)
      setEditing(undefined)
      setFeedback({ kind: 'success', message: '店铺别名已保存，相关店铺选择器会按当前界面语言显示。' })
      setReload((value) => value + 1)
    } catch (error) {
      setFeedback({ kind: 'error', message: errorMessage(error) })
    } finally { setBusy(false) }
  }

  return <main className="warehouse-archive-page settings-page" aria-labelledby="shop-alias-title">
    <SettingsPageHeader id="shop-alias-title" section="参数设置" title="别名管理" description="为店铺维护不同语言的内部显示名称，不改变平台店铺名称。" />
    <section className="warehouse-archive-card" aria-label="店铺别名筛选与结果">
      <div className="warehouse-processing-formula" role="note"><strong>显示规则</strong><span>中文界面优先显示中文别名，英文界面优先显示英文别名；未填写时显示原店铺名称。</span></div>
      <form className="warehouse-archive-filters procurement-plan-filters" key={toShopAliasUrl(query)} onSubmit={submitSearch}>
        <label className="procurement-plan-keyword">店铺或别名<input name="keyword" defaultValue={query.keyword ?? ''} maxLength={160} placeholder="店铺名称、平台或任一语言别名" /></label>
        <div className="warehouse-archive-filter-actions"><button className="is-primary" type="submit">搜索</button><button type="button" onClick={() => router.history.push(PATH)}>重置</button><button type="button" onClick={() => setReload((value) => value + 1)}>刷新</button></div>
      </form>
      {feedback && <p className={`warehouse-export-feedback is-${feedback.kind}`} role={feedback.kind === 'error' ? 'alert' : 'status'}>{feedback.message}</p>}
      {state.status === 'loading' && <p role="status">正在读取店铺别名…</p>}
      {state.status === 'error' && <div className="warehouse-archive-empty" role="alert"><strong>无法读取店铺别名</strong><span>请稍后重试。</span><button className="text-button" type="button" onClick={() => setReload((value) => value + 1)}>重试</button></div>}
      {state.status === 'ready' && <>
        <AliasTable page={state.page} canWrite={canWrite} busy={busy} edit={setEditing} />
        {state.page.totalPages > 0 && <nav className="pagination" aria-label="店铺别名分页"><span>共 {state.page.totalElements} 条</span><label>每页<select value={query.size ?? 25} onChange={(event) => navigate({ size: Number(event.target.value) as 25 | 50 | 100, page: 0 })}>{PAGE_SIZES.map((size) => <option key={size} value={size}>{size} 条</option>)}</select></label><button type="button" disabled={(query.page ?? 0) === 0} onClick={() => navigate({ page: (query.page ?? 0) - 1 })}>上一页</button><span>{(query.page ?? 0) + 1} / {state.page.totalPages}</span><button type="button" disabled={(query.page ?? 0) + 1 >= state.page.totalPages} onClick={() => navigate({ page: (query.page ?? 0) + 1 })}>下一页</button></nav>}
      </>}
    </section>
    {editing && <AliasEditor item={editing} busy={busy} close={() => setEditing(undefined)} save={save} error={feedback?.kind === 'error' ? feedback.message : undefined} />}
  </main>
}

function AliasTable({ page, canWrite, busy, edit }: { page: ShopAliasPage; canWrite: boolean; busy: boolean; edit: (item: ShopAlias) => void }) {
  return <div className="warehouse-archive-table-wrap"><table><caption className="sr-only">店铺别名</caption><thead><tr><th>序号</th><th>店铺名称</th><th>平台</th>{ALIAS_FIELDS.map(([, label]) => <th key={label}>{label}</th>)}<th>操作</th></tr></thead><tbody>{page.items.length === 0 ? <tr><td colSpan={13}><div className="warehouse-archive-empty" role="status"><strong>没有匹配的店铺</strong><span>请调整搜索条件后重试。</span></div></td></tr> : page.items.map((item, index) => <tr key={item.shopId}><td>{page.page * page.size + index + 1}</td><td><strong>{item.shopDisplayName}</strong></td><td>{item.platformCode === 'SHOPIFY' ? 'Shopify' : item.platformCode}</td>{ALIAS_FIELDS.map(([key]) => <td key={key}>{item[key] ?? '—'}</td>)}<td>{canWrite ? <button className="text-button" type="button" disabled={busy} onClick={() => edit(item)}>编辑</button> : '—'}</td></tr>)}</tbody></table></div>
}

function AliasEditor({ item, busy, close, save, error }: { item: ShopAlias; busy: boolean; close: () => void; save: (item: ShopAlias, input: ShopAliasInput) => Promise<void>; error?: string }) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const input = Object.fromEntries(ALIAS_FIELDS.map(([key]) => {
      const value = bounded(String(form.get(key) ?? ''))
      return [key, value || undefined]
    })) as ShopAliasInput
    void save(item, input)
  }
  return <section className="warehouse-dialog-backdrop" role="presentation"><section className="warehouse-dialog warehouse-alias-dialog" role="dialog" aria-modal="true" aria-label="编辑店铺别名"><header className="table-heading"><div><h2>编辑店铺别名</h2><p>{item.shopDisplayName} · {item.platformCode === 'SHOPIFY' ? 'Shopify' : item.platformCode}</p></div><DialogCloseButton disabled={busy} onClick={close} /></header><form onSubmit={submit}><div className="warehouse-dialog-grid">{ALIAS_FIELDS.map(([key, label]) => <label key={key}>{label}<input name={key} maxLength={160} defaultValue={item[key] ?? ''} placeholder={`可选；未填写时显示${item.shopDisplayName}`} /></label>)}</div><p className="form-help">清空某一语言并保存，即恢复为原店铺名称。</p>{error && <div className="inline-alert" role="alert">{error}</div>}<div className="form-actions"><button type="button" disabled={busy} onClick={close}>取消</button><button className="is-primary" type="submit" disabled={busy}>{busy ? '正在保存…' : '保存别名'}</button></div></form></section></section>
}
