import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useRouter, useRouterState } from '@tanstack/react-router'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { DialogCloseButton } from '../components/DialogCloseButton'
import { SettingsPageHeader } from '../components/SettingsPageLayout'
import {
  addressMappingApi,
  type AddressMapping,
  type AddressMappingInput,
  type AddressMappingPage,
  type AddressMappingQuery,
  type AddressMappingSetting,
  type AddressMappingType,
} from '../modules/addressMappingApi'
import './WarehouseArchiveShells.css'

const PATH = '/settings/parameters/address-mappings'
const PAGE_SIZES = [25, 50, 100] as const
const TYPE_LABELS: Record<AddressMappingType, string> = {
  PROVINCE: '省 / 州',
  CITY: '城市',
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; setting: AddressMappingSetting; page: AddressMappingPage }

function bounded(value: string | null, max = 120) {
  return (value ?? '').trim().slice(0, max)
}

export function parseAddressMappingQuery(search: string): AddressMappingQuery {
  const params = new URLSearchParams(search)
  const platform = params.get('platform') === 'SHOPIFY' ? 'SHOPIFY' : undefined
  const addressType = ['PROVINCE', 'CITY'].includes(params.get('addressType') ?? '')
    ? params.get('addressType') as AddressMappingType : undefined
  const countryCode = bounded(params.get('countryCode'), 2).toUpperCase()
  const keyword = bounded(params.get('keyword'))
  const page = Math.max(0, Number.parseInt(params.get('page') ?? '0', 10) || 0)
  const candidateSize = Number.parseInt(params.get('size') ?? '25', 10)
  const size = PAGE_SIZES.includes(candidateSize as typeof PAGE_SIZES[number])
    ? candidateSize as typeof PAGE_SIZES[number] : 25
  return {
    platform, addressType,
    countryCode: /^[A-Z]{2}$/.test(countryCode) ? countryCode : undefined,
    keyword: keyword || undefined, page, size,
  }
}

export function toAddressMappingUrl(query: AddressMappingQuery) {
  const params = new URLSearchParams()
  if (query.platform) params.set('platform', query.platform)
  if (query.countryCode) params.set('countryCode', query.countryCode)
  if (query.addressType) params.set('addressType', query.addressType)
  if (query.keyword) params.set('keyword', query.keyword)
  if ((query.page ?? 0) > 0) params.set('page', String(query.page))
  if ((query.size ?? 25) !== 25) params.set('size', String(query.size))
  const serialized = params.toString()
  return serialized ? `${PATH}?${serialized}` : PATH
}

function actionError(error: unknown) {
  if (error instanceof ApiError && error.status === 409) {
    return '该映射已存在或刚被其他操作更新，请刷新后重试。'
  }
  if (error instanceof ApiError && error.status === 403) {
    return '当前账号没有维护业务参数的权限。'
  }
  return '操作失败，请检查填写内容后重试。'
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value))
}

export function SettingsAddressMappingPage() {
  const router = useRouter()
  const search = useRouterState({ select: (state) => state.location.searchStr })
  const query = useMemo(() => parseAddressMappingQuery(search), [search])
  const { hasPermission } = useAuth()
  const canWrite = hasPermission('settings.parameter.write')
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [reload, setReload] = useState(0)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string }>()
  const [editor, setEditor] = useState<AddressMapping | 'new'>()
  const [removing, setRemoving] = useState<AddressMapping>()

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })
    void Promise.all([
      addressMappingApi.getSetting(controller.signal),
      addressMappingApi.list(query, controller.signal),
    ]).then(([setting, page]) => setState({ status: 'ready', setting, page }),
      () => { if (!controller.signal.aborted) setState({ status: 'error', message: '暂时无法读取地址映射。' }) })
    return () => controller.abort()
  }, [query, reload])

  const navigate = (patch: Partial<AddressMappingQuery>) => {
    router.history.push(toAddressMappingUrl({ ...query, ...patch }))
  }

  const submitFilter = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    navigate({
      platform: form.get('platform') === 'SHOPIFY' ? 'SHOPIFY' : undefined,
      countryCode: bounded(String(form.get('countryCode') ?? ''), 2).toUpperCase() || undefined,
      addressType: ['PROVINCE', 'CITY'].includes(String(form.get('addressType')))
        ? String(form.get('addressType')) as AddressMappingType : undefined,
      keyword: bounded(String(form.get('keyword') ?? '')) || undefined,
      page: 0,
    })
  }

  const saveSetting = async (expectedVersion: number, enabled: boolean) => {
    setBusy(true); setFeedback(undefined)
    try {
      await addressMappingApi.saveSetting(expectedVersion, enabled)
      setFeedback({ kind: 'success', message: enabled ? '地址自动转换已启用。' : '地址自动转换已关闭。' })
      setReload((value) => value + 1)
    } catch (error) {
      setFeedback({ kind: 'error', message: actionError(error) })
    } finally { setBusy(false) }
  }

  const saveMapping = async (item: AddressMapping | 'new', input: AddressMappingInput) => {
    setBusy(true); setFeedback(undefined)
    try {
      if (item === 'new') await addressMappingApi.create(input)
      else await addressMappingApi.update(item.id, item.version, input)
      setEditor(undefined)
      setFeedback({ kind: 'success', message: item === 'new' ? '地址映射已新增。' : '地址映射已更新。' })
      setReload((value) => value + 1)
    } catch (error) {
      setFeedback({ kind: 'error', message: actionError(error) })
    } finally { setBusy(false) }
  }

  const remove = async (item: AddressMapping) => {
    setBusy(true); setFeedback(undefined)
    try {
      await addressMappingApi.remove(item.id, item.version)
      setRemoving(undefined)
      setFeedback({ kind: 'success', message: '地址映射已删除。' })
      setReload((value) => value + 1)
    } catch (error) {
      setFeedback({ kind: 'error', message: actionError(error) })
    } finally { setBusy(false) }
  }

  return <main className="warehouse-archive-page settings-page" aria-labelledby="settings-address-mapping-title">
    <SettingsPageHeader id="settings-address-mapping-title" section="参数设置" title="地址映射配置" description="规范 Shopify 订单中的省州和城市名称。" />
    <section className="warehouse-archive-card" aria-label="地址映射设置与列表">
      {state.status === 'loading' && <p role="status">正在读取地址映射…</p>}
      {state.status === 'error' && <div className="warehouse-archive-empty" role="alert"><strong>无法读取地址映射</strong><span>{state.message}</span><button className="text-button" type="button" onClick={() => setReload((value) => value + 1)}>重试</button></div>}
      {state.status === 'ready' && <>
        <SettingPanel key={`${state.setting.version}-${state.setting.enabled}`} setting={state.setting} canWrite={canWrite} busy={busy} save={saveSetting} />
        <div className="warehouse-processing-formula" role="note"><strong>生效规则</strong><span>仅处理保存后新拉取的 Shopify 订单；按国家和地址类型精确匹配原始值。历史订单不回写，未命中时保留平台原值。</span></div>
        <form className="warehouse-archive-filters procurement-plan-filters" key={toAddressMappingUrl(query)} onSubmit={submitFilter}>
          <label>平台<select name="platform" defaultValue={query.platform ?? ''}><option value="">全部平台</option><option value="SHOPIFY">Shopify</option></select></label>
          <label>国家代码<input name="countryCode" defaultValue={query.countryCode ?? ''} maxLength={2} pattern="[A-Za-z]{2}" placeholder="例如 JP" /></label>
          <label>地址类型<select name="addressType" defaultValue={query.addressType ?? ''}><option value="">全部类型</option><option value="PROVINCE">省 / 州</option><option value="CITY">城市</option></select></label>
          <label className="procurement-plan-keyword">检索文本<input name="keyword" defaultValue={query.keyword ?? ''} maxLength={120} placeholder="原始值或转换值" /></label>
          <div className="warehouse-archive-filter-actions"><button className="is-primary" type="submit">搜索</button><button type="button" onClick={() => router.history.push(PATH)}>重置</button><button type="button" onClick={() => setReload((value) => value + 1)}>刷新</button></div>
        </form>
        <div className="warehouse-archive-actions">{canWrite && <button className="is-primary" type="button" disabled={busy} onClick={() => setEditor('new')}>新增映射</button>}</div>
        {feedback && <p className={`warehouse-export-feedback is-${feedback.kind}`} role={feedback.kind === 'error' ? 'alert' : 'status'}>{feedback.message}</p>}
        <MappingTable page={state.page} canWrite={canWrite} busy={busy} edit={setEditor} remove={setRemoving} />
        {state.page.totalPages > 0 && <nav className="pagination" aria-label="地址映射分页"><span>共 {state.page.totalElements} 条</span><label>每页<select value={query.size ?? 25} onChange={(event) => navigate({ size: Number(event.target.value) as 25 | 50 | 100, page: 0 })}>{PAGE_SIZES.map((size) => <option key={size} value={size}>{size} 条</option>)}</select></label><button type="button" disabled={(query.page ?? 0) === 0} onClick={() => navigate({ page: (query.page ?? 0) - 1 })}>上一页</button><span>{(query.page ?? 0) + 1} / {state.page.totalPages}</span><button type="button" disabled={(query.page ?? 0) + 1 >= state.page.totalPages} onClick={() => navigate({ page: (query.page ?? 0) + 1 })}>下一页</button></nav>}
      </>}
    </section>
    {editor && <MappingEditor item={editor} busy={busy} close={() => setEditor(undefined)} save={saveMapping} error={feedback?.kind === 'error' ? feedback.message : undefined} />}
    {removing && <RemoveDialog item={removing} busy={busy} close={() => setRemoving(undefined)} confirm={() => void remove(removing)} error={feedback?.kind === 'error' ? feedback.message : undefined} />}
  </main>
}

function SettingPanel({ setting, canWrite, busy, save }: { setting: AddressMappingSetting; canWrite: boolean; busy: boolean; save: (version: number, enabled: boolean) => Promise<void> }) {
  const [enabled, setEnabled] = useState(setting.enabled)
  return <div className="settings-address-config"><div><strong>订单地址自动转换</strong><p>启用后，拉取 Shopify 订单时按下方映射规范化地址。</p></div><label className="warehouse-archive-checkbox"><input type="checkbox" checked={enabled} disabled={!canWrite || busy} onChange={(event) => setEnabled(event.target.checked)} />启用地址映射</label><div className="settings-address-meta"><span>当前状态</span><strong>{setting.enabled ? '已启用' : '未启用'}</strong><span>操作人</span><strong>{setting.updatedByDisplayName ?? '—'}</strong></div>{canWrite && <button className="is-primary" type="button" disabled={busy || enabled === setting.enabled} onClick={() => void save(setting.version, enabled)}>{busy ? '正在保存…' : '保存开关'}</button>}</div>
}

function MappingTable({ page, canWrite, busy, edit, remove }: { page: AddressMappingPage; canWrite: boolean; busy: boolean; edit: (item: AddressMapping) => void; remove: (item: AddressMapping) => void }) {
  return <div className="warehouse-archive-table-wrap"><table><caption className="sr-only">地址映射</caption><thead><tr><th>平台</th><th>国家</th><th>地址类型</th><th>平台原始信息</th><th>转换后地址信息</th><th>状态</th><th>更新时间</th><th>操作</th></tr></thead><tbody>{page.items.length === 0 ? <tr><td colSpan={8}><div className="warehouse-archive-empty" role="status"><strong>暂无地址映射</strong><span>可新增第一条映射，未启用前不会影响订单。</span></div></td></tr> : page.items.map((item) => <tr key={item.id}><td>Shopify</td><td>{item.countryCode}</td><td>{TYPE_LABELS[item.addressType]}</td><td>{item.sourceValue}</td><td>{item.mappedValue}</td><td><span className={item.enabled ? 'status-badge is-success' : 'status-badge'}>{item.enabled ? '启用' : '停用'}</span></td><td>{formatTime(item.updatedAt)}</td><td><span className="table-row-actions">{canWrite ? <><button className="text-button" type="button" disabled={busy} onClick={() => edit(item)}>编辑</button><button className="text-button is-danger" type="button" disabled={busy} onClick={() => remove(item)}>删除</button></> : '—'}</span></td></tr>)}</tbody></table></div>
}

function MappingEditor({ item, busy, close, save, error }: { item: AddressMapping | 'new'; busy: boolean; close: () => void; save: (item: AddressMapping | 'new', input: AddressMappingInput) => Promise<void>; error?: string }) {
  const current = item === 'new' ? undefined : item
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    void save(item, {
      platform: 'SHOPIFY',
      countryCode: String(form.get('countryCode') ?? ''),
      addressType: String(form.get('addressType')) as AddressMappingType,
      sourceValue: String(form.get('sourceValue') ?? ''),
      mappedValue: String(form.get('mappedValue') ?? ''),
      enabled: form.get('enabled') === 'on',
    })
  }
  const title = current ? '编辑地址映射' : '新增地址映射'
  return <section className="warehouse-dialog-backdrop" role="presentation"><section className="warehouse-dialog" role="dialog" aria-modal="true" aria-label={title}><header className="table-heading"><div><h2>{title}</h2><p>同一国家、类型和原始值只能保留一条有效记录。</p></div><DialogCloseButton disabled={busy} onClick={close} /></header><form onSubmit={submit}><div className="warehouse-dialog-grid"><label>平台<input value="Shopify" readOnly /></label><label>国家代码<input name="countryCode" required maxLength={2} pattern="[A-Za-z]{2}" defaultValue={current?.countryCode ?? ''} placeholder="例如 JP" /></label><label>地址类型<select name="addressType" defaultValue={current?.addressType ?? 'PROVINCE'}><option value="PROVINCE">省 / 州</option><option value="CITY">城市</option></select></label><label className="warehouse-archive-checkbox"><input name="enabled" type="checkbox" defaultChecked={current?.enabled ?? true} />启用此映射</label></div><label>平台原始信息<input name="sourceValue" required maxLength={120} defaultValue={current?.sourceValue ?? ''} placeholder="例如 Tōkyō" /></label><label>转换后地址信息<input name="mappedValue" required maxLength={120} defaultValue={current?.mappedValue ?? ''} placeholder="例如 東京都" /></label>{error && <div className="inline-alert" role="alert">{error}</div>}<div className="form-actions"><button type="button" disabled={busy} onClick={close}>取消</button><button className="is-primary" type="submit" disabled={busy}>{busy ? '正在保存…' : '保存映射'}</button></div></form></section></section>
}

function RemoveDialog({ item, busy, close, confirm, error }: { item: AddressMapping; busy: boolean; close: () => void; confirm: () => void; error?: string }) {
  return <section className="warehouse-dialog-backdrop" role="presentation"><section className="warehouse-dialog warehouse-confirm-dialog" role="alertdialog" aria-modal="true" aria-label="删除地址映射"><header className="table-heading"><div><h2>删除地址映射</h2><p>{item.countryCode} · {TYPE_LABELS[item.addressType]}</p></div><DialogCloseButton disabled={busy} onClick={close} /></header><div className="warehouse-confirm-body"><p>删除后，后续订单不再把“{item.sourceValue}”转换为“{item.mappedValue}”。历史订单不受影响。</p>{error && <div className="inline-alert" role="alert">{error}</div>}</div><footer className="warehouse-confirm-actions"><button type="button" disabled={busy} onClick={close}>返回</button><button className="is-danger" type="button" disabled={busy} onClick={confirm}>{busy ? '正在删除…' : '确认删除'}</button></footer></section></section>
}
