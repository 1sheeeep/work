import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useRouterState } from '@tanstack/react-router'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import {
  logisticsAddressApi,
  type LogisticsAddressDetail,
  type LogisticsAddressInput,
  type LogisticsAddressPage,
  type LogisticsAddressStatus,
  type LogisticsAddressType,
} from '../modules/logisticsAddressApi'
import './WarehouseArchiveShells.css'

const addressTypes: ReadonlyArray<{ value: LogisticsAddressType; label: string }> = [
  { value: 'RECEIVING_TRANSIT', label: '收货中转仓地址' },
  { value: 'PLATFORM_SHIPPING', label: '平台发货地址' },
  { value: 'SHIPPING', label: '发货地址' },
]

export type LogisticsAddressQuery = {
  type: LogisticsAddressType
  status: 'ALL' | LogisticsAddressStatus
  keyword: string
  page: number
}
function addressType(value: string | null): LogisticsAddressType {
  return value === 'RECEIVING_TRANSIT' || value === 'PLATFORM_SHIPPING' ? value : 'SHIPPING'
}
function addressStatus(value: string | null): 'ALL' | LogisticsAddressStatus {
  return value === 'ARCHIVED' || value === 'ALL' ? value : 'ACTIVE'
}
function boundedText(value: string | null, maximum = 120) {
  return (value ?? '').trim().slice(0, maximum)
}
function pageNumber(value: string | null) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0
}
export function parseLogisticsAddressQuery(search: string): LogisticsAddressQuery {
  const params = new URLSearchParams(search)
  return {
    type: addressType(params.get('type')),
    status: addressStatus(params.get('status')),
    keyword: boundedText(params.get('keyword')),
    page: pageNumber(params.get('page')),
  }
}
export function toLogisticsAddressUrl(query: Partial<LogisticsAddressQuery>) {
  const params = new URLSearchParams()
  if (query.type && query.type !== 'SHIPPING') params.set('type', query.type)
  if (query.status && query.status !== 'ACTIVE') params.set('status', query.status)
  if (query.keyword) params.set('keyword', boundedText(query.keyword))
  if (query.page && query.page > 0) params.set('page', String(query.page))
  const serialized = params.toString()
  return serialized ? `/logistics/addresses?${serialized}` : '/logistics/addresses'
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: LogisticsAddressPage }
type FormState =
  | { mode: 'create' }
  | { mode: 'edit'; value: LogisticsAddressDetail }

function errorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 409) return '同类型下已存在同名地址，或地址已被其他操作更新，请刷新后重试。'
  if (error instanceof ApiError && error.status === 403) return '当前账号没有管理物流地址的权限。'
  return '操作未完成，请检查输入或网络后重试。'
}
function optional(data: FormData, key: string) {
  const value = String(data.get(key) ?? '').trim()
  return value || undefined
}
function formInput(data: FormData): LogisticsAddressInput {
  return {
    addressType: addressType(String(data.get('addressType') ?? 'SHIPPING')),
    name: String(data.get('name') ?? '').trim(),
    contactName: String(data.get('contactName') ?? '').trim(),
    contactEmail: optional(data, 'contactEmail'),
    countryCode: String(data.get('countryCode') ?? '').trim().toUpperCase(),
    province: optional(data, 'province'), city: optional(data, 'city'),
    district: optional(data, 'district'),
    addressLine1: String(data.get('addressLine1') ?? '').trim(),
    postalCode: optional(data, 'postalCode'), landline: optional(data, 'landline'),
    mobile: optional(data, 'mobile'), companyName: optional(data, 'companyName'),
    fax: optional(data, 'fax'),
  }
}

function AddressForm({ state, selectedType, busy, onCancel, onSaved, onError }: {
  state: FormState
  selectedType: LogisticsAddressType
  busy: boolean
  onCancel: () => void
  onSaved: (message: string) => void
  onError: (message: string) => void
}) {
  const value = state.mode === 'edit' ? state.value : undefined
  const [saving, setSaving] = useState(false)
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const input = formInput(new FormData(event.currentTarget))
    if (!input.name || !input.contactName || !/^[A-Z]{2}$/.test(input.countryCode)
      || !input.addressLine1) {
      onError('请填写名称、联系人、两位国家代码和详细地址。')
      return
    }
    setSaving(true)
    try {
      if (value) {
        await logisticsAddressApi.update(value.id, value.version, input)
        onSaved(`地址“${input.name}”已更新。`)
      } else {
        await logisticsAddressApi.create(input)
        onSaved(`地址“${input.name}”已创建。`)
      }
    } catch (error) {
      onError(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }
  return <form className="warehouse-archive-card" aria-label={value ? '编辑物流地址' : '新增物流地址'} onSubmit={(event) => void submit(event)}>
    <h2>{value ? '编辑物流地址' : '新增物流地址'}</h2>
    <p className="cell-secondary">联系方式仅在编辑时显示，列表中不会展示邮箱、电话或传真。</p>
    <fieldset><legend>基本信息</legend><div className="warehouse-archive-filters">
      <label>地址类型<select name="addressType" defaultValue={value?.addressType ?? selectedType}><option value="RECEIVING_TRANSIT">收货中转仓地址</option><option value="PLATFORM_SHIPPING">平台发货地址</option><option value="SHIPPING">发货地址</option></select></label>
      <label>名称<input name="name" required maxLength={160} autoFocus defaultValue={value?.name} /></label>
      <label>公司名称<input name="companyName" maxLength={200} defaultValue={value?.companyName} /></label>
      <label>联系人<input name="contactName" required maxLength={160} autoComplete="name" defaultValue={value?.contactName} /></label>
    </div></fieldset>
    <fieldset><legend>联系信息</legend><div className="warehouse-archive-filters">
      <label>邮箱<input name="contactEmail" type="email" maxLength={254} autoComplete="email" defaultValue={value?.contactEmail} /></label>
      <label>移动电话<input name="mobile" type="tel" maxLength={40} autoComplete="tel" defaultValue={value?.mobile} /></label>
      <label>固定电话<input name="landline" type="tel" maxLength={40} defaultValue={value?.landline} /></label>
      <label>传真<input name="fax" type="tel" maxLength={40} defaultValue={value?.fax} /></label>
    </div></fieldset>
    <fieldset><legend>地址信息</legend><div className="warehouse-archive-filters">
      <label>国家代码<input name="countryCode" required pattern="[A-Za-z]{2}" maxLength={2} placeholder="例如 CN" defaultValue={value?.countryCode} /></label>
      <label>省份<input name="province" maxLength={120} autoComplete="address-level1" defaultValue={value?.province} /></label>
      <label>城市<input name="city" maxLength={120} autoComplete="address-level2" defaultValue={value?.city} /></label>
      <label>区域<input name="district" maxLength={120} autoComplete="address-level3" defaultValue={value?.district} /></label>
      <label>详细地址<input name="addressLine1" required maxLength={300} autoComplete="street-address" defaultValue={value?.addressLine1} /></label>
      <label>邮编<input name="postalCode" maxLength={32} autoComplete="postal-code" defaultValue={value?.postalCode} /></label>
    </div></fieldset>
    <div className="form-actions"><button className="button button-secondary" type="button" disabled={busy || saving} onClick={onCancel}>取消</button><button className="button button-primary" type="submit" disabled={busy || saving}>{saving ? '正在保存…' : '保存地址'}</button></div>
  </form>
}

export function LogisticsAddressManagementPage() {
  const router = useRouter()
  const search = useRouterState({ select: (state) => state.location.searchStr })
  const { hasPermission } = useAuth()
  const query = useMemo(() => parseLogisticsAddressQuery(search), [search])
  const canWrite = hasPermission('logistics.address.write')
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [reload, setReload] = useState(0)
  const [form, setForm] = useState<FormState>()
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string }>()
  const navigate = (next: Partial<LogisticsAddressQuery>) => router.history.push(toLogisticsAddressUrl(next))
  const refresh = useCallback(() => setReload((value) => value + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })
    void logisticsAddressApi.list({ ...query, size: 25, signal: controller.signal })
      .then((data) => setState({ status: 'ready', data }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ status: 'error', message: errorMessage(error) })
      })
    return () => controller.abort()
  }, [query, reload])

  const submitFilter = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    navigate({ type: query.type, status: addressStatus(String(data.get('status') ?? 'ACTIVE')), keyword: boundedText(String(data.get('keyword') ?? '')), page: 0 })
  }
  const edit = async (id: string) => {
    setBusy(true); setFeedback(undefined)
    try { setForm({ mode: 'edit', value: await logisticsAddressApi.detail(id) }) }
    catch (error) { setFeedback({ kind: 'error', message: errorMessage(error) }) }
    finally { setBusy(false) }
  }
  const archive = async (id: string, version: number, name: string) => {
    if (!window.confirm(`确认停用地址“${name}”？历史记录会保留，但不能继续编辑。`)) return
    setBusy(true); setFeedback(undefined)
    try {
      await logisticsAddressApi.archive(id, version)
      setFeedback({ kind: 'success', message: `地址“${name}”已停用。` }); refresh()
    } catch (error) { setFeedback({ kind: 'error', message: errorMessage(error) }) }
    finally { setBusy(false) }
  }

  return <main className="warehouse-archive-page" aria-labelledby="logistics-address-title">
    <header className="warehouse-archive-heading"><div><p className="eyebrow">物流 / 物流管理</p><h1 id="logistics-address-title">地址管理</h1><p>维护本企业的发货与中转地址；订单收件地址需单独维护。</p></div></header>
    <div className="warehouse-archive-tabs" role="tablist" aria-label="地址类型">{addressTypes.map((type) => <button className={query.type === type.value ? 'is-active' : ''} key={type.value} type="button" role="tab" aria-selected={query.type === type.value} onClick={() => { setForm(undefined); navigate({ type: type.value }) }}>{type.label}</button>)}</div>
    <section className="warehouse-archive-card" aria-label="地址筛选与列表">
      <div className="warehouse-processing-formula" role="note"><strong>地址说明</strong><span>地址需在业务中手动选择；停用后保留历史记录。联系方式仅在编辑时显示。</span></div>
      <form className="warehouse-archive-filters" key={toLogisticsAddressUrl(query)} onSubmit={submitFilter}><label>状态<select name="status" defaultValue={query.status}><option value="ACTIVE">使用中</option><option value="ARCHIVED">已停用</option><option value="ALL">全部</option></select></label><label>搜索内容<input name="keyword" defaultValue={query.keyword} maxLength={120} placeholder="名称、联系人、地区或地址" /></label><div className="warehouse-archive-filter-actions"><button className="is-primary" type="submit">搜索</button><button type="button" onClick={() => navigate({ type: query.type })}>重置</button></div></form>
      <div className="warehouse-archive-actions">{canWrite && <button className="is-primary" type="button" disabled={busy} onClick={() => { setFeedback(undefined); setForm({ mode: 'create' }) }}>新增{addressTypes.find((item) => item.value === query.type)?.label}</button>}</div>
      {feedback && <p className={`warehouse-export-feedback is-${feedback.kind}`} role={feedback.kind === 'error' ? 'alert' : 'status'}>{feedback.message}</p>}
      {form && <AddressForm state={form} selectedType={query.type} busy={busy} onCancel={() => setForm(undefined)} onSaved={(message) => { setForm(undefined); setFeedback({ kind: 'success', message }); refresh() }} onError={(message) => setFeedback({ kind: 'error', message })} />}
      {state.status === 'loading' && <p className="product-state" role="status">正在加载地址…</p>}
      {state.status === 'error' && <div className="compact-empty-state" role="alert"><strong>无法读取地址</strong><span>{state.message}</span><button className="text-button" type="button" onClick={refresh}>重试</button></div>}
      {state.status === 'ready' && <div className="warehouse-archive-table-wrap"><table aria-label="物流地址列表"><thead><tr><th>名称</th><th>联系人</th><th>国家 / 地区</th><th>详细地址</th><th>状态</th><th>更新时间</th><th>操作</th></tr></thead><tbody>{state.data.items.length === 0 ? <tr><td colSpan={7}><div className="warehouse-archive-empty" role="status"><strong>没有符合条件的地址</strong><span>{canWrite ? '可新增当前类型的物流地址。' : '请调整筛选条件后重试。'}</span></div></td></tr> : state.data.items.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.contactName}</td><td>{[item.countryCode, item.province, item.city, item.district].filter(Boolean).join(' / ')}</td><td>{item.addressLine1}</td><td><span className={`status-badge is-${item.status.toLowerCase()}`}>{item.status === 'ACTIVE' ? '使用中' : '已停用'}</span></td><td>{new Date(item.updatedAt).toLocaleString('zh-CN')}</td><td>{canWrite && item.status === 'ACTIVE' ? <><button className="text-button" type="button" disabled={busy} onClick={() => void edit(item.id)}>编辑</button><button className="text-button" type="button" disabled={busy} onClick={() => void archive(item.id, item.version, item.name)}>停用</button></> : '—'}</td></tr>)}</tbody></table><nav className="pagination" aria-label="地址分页"><span>共 {state.data.totalElements} 条 · 第 {state.data.page + 1} / {Math.max(state.data.totalPages, 1)} 页</span><div><button type="button" disabled={state.data.page === 0} onClick={() => navigate({ ...query, page: query.page - 1 })}>上一页</button><button type="button" disabled={state.data.page + 1 >= state.data.totalPages} onClick={() => navigate({ ...query, page: query.page + 1 })}>下一页</button></div></nav></div>}
    </section>
  </main>
}
