import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useRouter, useRouterState } from '@tanstack/react-router'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { CurrencyCodeInput } from '../components/CurrencyCodeInput'
import { DialogCloseButton } from '../components/DialogCloseButton'
import {
  logisticsFeeApi,
  type LogisticsFeeInput,
  type LogisticsFeePageData,
  type LogisticsFeeRecord,
  type LogisticsFeeSearchField,
  type LogisticsFeeStatus,
} from '../modules/logisticsFeeApi'
import './WarehouseArchiveShells.css'

type TriState = 'ALL' | 'YES' | 'NO'
export type LogisticsFeeQuery = {
  status: LogisticsFeeStatus
  platform: string
  shop: string
  channel: string
  searchField: LogisticsFeeSearchField
  keyword: string
  hasActualFee: TriState
  shippedFrom: string
  shippedTo: string
}
type State = { status: 'loading' }
  | { status: 'ready'; data: LogisticsFeePageData }
  | { status: 'error'; message: string }
const statuses: ReadonlyArray<{ value: LogisticsFeeStatus; label: string }> = [
  { value: 'UNCONFIRMED', label: '待确认' },
  { value: 'CONFIRMED', label: '已确认' },
  { value: 'ARCHIVED', label: '已归档' },
]

function boundedText(value: string | null, maximum = 120) {
  return (value ?? '').trim().slice(0, maximum)
}
function triState(value: string | null): TriState {
  return value === 'YES' || value === 'NO' ? value : 'ALL'
}
function feeStatus(value: string | null): LogisticsFeeStatus {
  return statuses.some((item) => item.value === value)
    ? value as LogisticsFeeStatus : 'UNCONFIRMED'
}
function feeSearchField(value: string | null): LogisticsFeeSearchField {
  return value === 'TRACKING_NO' || value === 'TRANSACTION_NO' ? value : 'ORDER_NO'
}
function dateText(value: string | null) {
  const normalized = boundedText(value, 10)
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized)
  if (!match) return ''
  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return parsed.getUTCFullYear() === Number(match[1])
    && parsed.getUTCMonth() === Number(match[2]) - 1
    && parsed.getUTCDate() === Number(match[3]) ? normalized : ''
}
function businessToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}
function optionalNumber(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim()
  return text === '' ? undefined : Number(text)
}
function safeMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 409) return '记录状态或物流单号已变化，请刷新后重试。'
  if (error instanceof ApiError && error.status === 403) return '当前账号没有物流费用管理权限。'
  if (error instanceof ApiError && error.status === 400) return '请检查必填项、金额、币种和重量后重试。'
  return '操作未完成，请稍后重试。'
}

export function parseLogisticsFeeQuery(search: string): LogisticsFeeQuery {
  const params = new URLSearchParams(search)
  return {
    status: feeStatus(params.get('status')),
    platform: boundedText(params.get('platform'), 100),
    shop: boundedText(params.get('shop'), 100),
    channel: boundedText(params.get('channel'), 120),
    searchField: feeSearchField(params.get('searchField')),
    keyword: boundedText(params.get('keyword')),
    hasActualFee: triState(params.get('hasActualFee')),
    shippedFrom: dateText(params.get('shippedFrom')),
    shippedTo: dateText(params.get('shippedTo')),
  }
}

export function toLogisticsFeeUrl(query: Partial<LogisticsFeeQuery>) {
  const params = new URLSearchParams()
  if (query.status && query.status !== 'UNCONFIRMED') params.set('status', query.status)
  for (const key of ['platform', 'shop', 'channel'] as const) {
    if (query[key]) params.set(key, boundedText(query[key], key === 'channel' ? 120 : 100))
  }
  if (query.searchField && query.searchField !== 'ORDER_NO') params.set('searchField', query.searchField)
  if (query.keyword) params.set('keyword', boundedText(query.keyword))
  if (query.hasActualFee && query.hasActualFee !== 'ALL') params.set('hasActualFee', query.hasActualFee)
  const shippedFrom = dateText(query.shippedFrom ?? null)
  const shippedTo = dateText(query.shippedTo ?? null)
  if (shippedFrom) params.set('shippedFrom', shippedFrom)
  if (shippedTo) params.set('shippedTo', shippedTo)
  const serialized = params.toString()
  return serialized ? `/logistics/fees?${serialized}` : '/logistics/fees'
}

export function LogisticsFeePage() {
  const router = useRouter()
  const search = useRouterState({ select: (state) => state.location.searchStr })
  const query = useMemo(() => parseLogisticsFeeQuery(search), [search])
  const { hasPermission } = useAuth()
  const canWrite = hasPermission('logistics.fee.write')
  const [state, setState] = useState<State>({ status: 'loading' })
  const [editing, setEditing] = useState<LogisticsFeeRecord | 'new' | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<LogisticsFeeRecord | null>(null)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [refresh, setRefresh] = useState(0)
  const navigate = (next: Partial<LogisticsFeeQuery>) => router.history.push(toLogisticsFeeUrl(next))

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })
    logisticsFeeApi.list({
      status: query.status,
      searchField: query.searchField,
      platform: query.platform || undefined,
      shop: query.shop || undefined,
      channel: query.channel || undefined,
      keyword: query.keyword || undefined,
      hasActualFee: query.hasActualFee === 'ALL' ? undefined : query.hasActualFee === 'YES',
      shippedFrom: query.shippedFrom || undefined,
      shippedTo: query.shippedTo || undefined,
      page: 0, pageSize: 100, signal: controller.signal,
    }).then((data) => setState({ status: 'ready', data }))
      .catch((error) => {
        if (!controller.signal.aborted) setState({ status: 'error', message: safeMessage(error) })
      })
    return () => controller.abort()
  }, [query, refresh])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    navigate({
      status: query.status,
      platform: boundedText(String(data.get('platform') ?? ''), 100),
      shop: boundedText(String(data.get('shop') ?? ''), 100),
      channel: boundedText(String(data.get('channel') ?? ''), 120),
      searchField: feeSearchField(String(data.get('searchField') ?? 'ORDER_NO')),
      keyword: boundedText(String(data.get('keyword') ?? '')),
      hasActualFee: triState(String(data.get('hasActualFee') ?? 'ALL')),
      shippedFrom: dateText(String(data.get('shippedFrom') ?? '')),
      shippedTo: dateText(String(data.get('shippedTo') ?? '')),
    })
  }

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const estimatedFee = optionalNumber(data.get('estimatedFee'))
    const actualFee = optionalNumber(data.get('actualFee'))
    if (estimatedFee === undefined && actualFee === undefined) {
      setFeedback('预估费用和实际费用至少填写一项。')
      return
    }
    const input: LogisticsFeeInput = {
      platformName: boundedText(String(data.get('platformName') ?? ''), 100),
      shopName: boundedText(String(data.get('shopName') ?? ''), 100),
      channelName: boundedText(String(data.get('channelName') ?? ''), 120),
      orderReference: boundedText(String(data.get('orderReference') ?? '')),
      trackingReference: boundedText(String(data.get('trackingReference') ?? '')),
      transactionReference: boundedText(String(data.get('transactionReference') ?? '')) || undefined,
      estimatedFee, actualFee,
      currency: boundedText(String(data.get('currency') ?? ''), 3).toUpperCase(),
      carrierWeightKg: optionalNumber(data.get('carrierWeightKg')),
      warehouseWeightKg: optionalNumber(data.get('warehouseWeightKg')),
      shippedOn: dateText(String(data.get('shippedOn') ?? '')),
      note: boundedText(String(data.get('note') ?? ''), 500) || undefined,
    }
    setBusy(true); setFeedback('')
    try {
      const saved = editing === 'new'
        ? await logisticsFeeApi.create(input)
        : await logisticsFeeApi.update(editing!.id, editing!.version, input)
      setEditing(null)
      setFeedback(`物流费用记录“${saved.trackingReference}”已保存。`)
      setRefresh((value) => value + 1)
    } catch (error) { setFeedback(safeMessage(error)) } finally { setBusy(false) }
  }

  const confirm = async (record: LogisticsFeeRecord) => {
    setBusy(true); setFeedback('')
    try {
      await logisticsFeeApi.confirm(record.id, record.version)
      setFeedback(`物流费用记录“${record.trackingReference}”已确认。`)
      setRefresh((value) => value + 1)
    } catch (error) { setFeedback(safeMessage(error)) } finally { setBusy(false) }
  }
  const archive = async () => {
    if (!archiveTarget) return
    const record = archiveTarget
    setBusy(true); setFeedback('')
    try {
      await logisticsFeeApi.archive(record.id, record.version)
      setArchiveTarget(null)
      setFeedback(`物流费用记录“${record.trackingReference}”已归档。`)
      setRefresh((value) => value + 1)
    } catch (error) { setFeedback(safeMessage(error)) } finally { setBusy(false) }
  }

  return <main className="warehouse-archive-page" aria-labelledby="logistics-fee-title">
    <header className="warehouse-archive-heading"><div>
      <p className="eyebrow">物流 / 增值服务</p>
      <h1 id="logistics-fee-title">物流费用</h1>
      <p>登记并核对预估费用、承运商实际费用和称重差异；金额保留原币种。</p>
    </div></header>
    <div className="warehouse-archive-tabs" role="tablist" aria-label="费用记录状态">
      {statuses.map((item) => <button className={query.status === item.value ? 'is-active' : ''}
        key={item.value} type="button" role="tab" aria-selected={query.status === item.value}
        onClick={() => navigate({ ...query, status: item.value })}>{item.label}</button>)}
    </div>
    <section className="warehouse-archive-card" aria-label="物流费用筛选与列表">
      <div className="warehouse-processing-formula" role="note"><strong>核对规则</strong>
        <span>登记后可修改；填写实际费用后才能确认。已确认记录不可修改，付款仍由财务流程处理。</span></div>
      <form className="warehouse-archive-filters" key={toLogisticsFeeUrl(query)} onSubmit={submit}>
        <label>销售平台<input name="platform" defaultValue={query.platform} maxLength={100} placeholder="全部平台" /></label>
        <label>店铺<input name="shop" defaultValue={query.shop} maxLength={100} placeholder="全部店铺" /></label>
        <label>物流渠道<input name="channel" defaultValue={query.channel} maxLength={120} placeholder="全部物流渠道" /></label>
        <label>搜索字段<select name="searchField" defaultValue={query.searchField}><option value="ORDER_NO">订单编号</option><option value="TRACKING_NO">物流单号</option><option value="TRANSACTION_NO">交易号</option></select></label>
        <label>搜索内容<input name="keyword" defaultValue={query.keyword} maxLength={120} placeholder="输入完整或部分编号" /></label>
        <label>实际费用<select name="hasActualFee" defaultValue={query.hasActualFee}><option value="ALL">全部</option><option value="YES">已填写</option><option value="NO">未填写</option></select></label>
        <label>发货日期起<input name="shippedFrom" type="date" defaultValue={query.shippedFrom} /></label>
        <label>发货日期止<input name="shippedTo" type="date" defaultValue={query.shippedTo} /></label>
        <div className="warehouse-archive-filter-actions"><button className="is-primary" type="submit">搜索</button><button type="button" onClick={() => navigate({ status: query.status })}>重置</button></div>
      </form>
      <div className="warehouse-archive-actions">{canWrite && query.status === 'UNCONFIRMED'
        ? <button className="is-primary" type="button" disabled={busy} onClick={() => { setFeedback(''); setEditing('new') }}>新增费用记录</button> : null}</div>
      {feedback && !editing ? <div className="inline-alert" role="status">{feedback}</div> : null}
      <FeeTable state={state} canWrite={canWrite} busy={busy}
        edit={(record) => { setFeedback(''); setEditing(record) }}
        confirm={confirm} archive={(record) => { setFeedback(''); setArchiveTarget(record) }} />
    </section>
    {editing ? <FeeDialog record={editing === 'new' ? null : editing} busy={busy}
      feedback={feedback} close={() => setEditing(null)} save={save} /> : null}
    {archiveTarget ? <ArchiveFeeDialog record={archiveTarget} busy={busy}
      close={() => setArchiveTarget(null)} archive={archive} /> : null}
  </main>
}

function ArchiveFeeDialog({ record, busy, close, archive }: {
  record: LogisticsFeeRecord
  busy: boolean
  close: () => void
  archive: () => Promise<void>
}) {
  return <section className="warehouse-dialog-backdrop" role="presentation">
    <div className="warehouse-dialog warehouse-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="archive-fee-title" aria-describedby="archive-fee-description">
      <div className="table-heading"><div>
        <h2 id="archive-fee-title">归档费用记录</h2>
        <p id="archive-fee-description">归档后，该记录将从待确认列表移至已归档列表。</p>
      </div><DialogCloseButton disabled={busy} onClick={close} /></div>
      <div className="warehouse-confirm-body">
        <dl>
          <div><dt>物流单号</dt><dd>{record.trackingReference}</dd></div>
          <div><dt>订单编号</dt><dd>{record.orderReference}</dd></div>
        </dl>
        <p>已归档记录仅供查询，不能再编辑或确认。</p>
      </div>
      <div className="warehouse-confirm-actions">
        <button type="button" disabled={busy} onClick={close}>取消</button>
        <button className="is-danger" type="button" disabled={busy} onClick={() => void archive()}>{busy ? '正在归档…' : '确认归档'}</button>
      </div>
    </div>
  </section>
}

function FeeDialog({ record, busy, feedback, close, save }: {
  record: LogisticsFeeRecord | null
  busy: boolean
  feedback: string
  close: () => void
  save: (event: FormEvent<HTMLFormElement>) => Promise<void>
}) {
  const title = record ? '编辑费用记录' : '新增费用记录'
  return <section className="warehouse-dialog-backdrop" role="presentation"><div className="warehouse-dialog logistics-fee-dialog" role="dialog" aria-modal="true" aria-label={title}>
    <div className="table-heading"><div><h2>{title}</h2><p>带 * 的项目为必填；两种费用至少填写一项。</p></div><DialogCloseButton disabled={busy} onClick={close} /></div>
    <form className="logistics-fee-form" onSubmit={(event) => void save(event)}>
      <label>* 销售平台<input name="platformName" required maxLength={100} defaultValue={record?.platformName ?? ''} placeholder="例如 Shopify" /></label>
      <label>* 店铺<input name="shopName" required maxLength={100} defaultValue={record?.shopName ?? ''} /></label>
      <label>* 物流渠道<input name="channelName" required maxLength={120} defaultValue={record?.channelName ?? ''} /></label>
      <label>* 发货日期<input name="shippedOn" required type="date" defaultValue={record?.shippedOn ?? businessToday()} /></label>
      <label>* 订单编号<input name="orderReference" required maxLength={120} defaultValue={record?.orderReference ?? ''} /></label>
      <label>* 物流单号<input name="trackingReference" required maxLength={120} defaultValue={record?.trackingReference ?? ''} /></label>
      <label>交易号（可选）<input name="transactionReference" maxLength={120} defaultValue={record?.transactionReference ?? ''} /></label>
      <label>* 币种<CurrencyCodeInput name="currency" required listId="logistics-fee-currencies" defaultValue={record?.currency ?? 'USD'} /></label>
      <label>预估费用<input name="estimatedFee" type="number" min="0" max="99999999999999.9999" step="0.0001" defaultValue={record?.estimatedFee ?? ''} /></label>
      <label>实际费用<input name="actualFee" type="number" min="0" max="99999999999999.9999" step="0.0001" defaultValue={record?.actualFee ?? ''} /></label>
      <label>承运商重量（kg）<input name="carrierWeightKg" type="number" min="0.001" max="999999999.999" step="0.001" defaultValue={record?.carrierWeightKg ?? ''} /></label>
      <label>仓库重量（kg）<input name="warehouseWeightKg" type="number" min="0.001" max="999999999.999" step="0.001" defaultValue={record?.warehouseWeightKg ?? ''} /></label>
      <label className="is-span-2">备注（可选）<textarea name="note" maxLength={500} defaultValue={record?.note ?? ''} /></label>
      {feedback ? <div className="inline-alert is-span-2" role="alert">{feedback}</div> : null}
      <div className="form-actions is-span-2"><button type="button" disabled={busy} onClick={close}>取消</button><button className="is-primary" type="submit" disabled={busy}>{busy ? '正在保存…' : '保存'}</button></div>
    </form>
  </div></section>
}

function FeeTable({ state, canWrite, busy, edit, confirm, archive }: {
  state: State
  canWrite: boolean
  busy: boolean
  edit: (record: LogisticsFeeRecord) => void
  confirm: (record: LogisticsFeeRecord) => Promise<void>
  archive: (record: LogisticsFeeRecord) => void
}) {
  if (state.status === 'loading') return <div className="warehouse-archive-empty" role="status"><strong>正在读取物流费用…</strong></div>
  if (state.status === 'error') return <div className="inline-alert" role="alert">{state.message}</div>
  return <div className="warehouse-archive-table-wrap logistics-fee-table"><table aria-label="物流费用列表"><thead><tr>
    <th>发货日期</th><th>平台 / 店铺</th><th>订单 / 交易</th><th>渠道 / 物流单号</th><th>费用</th><th>称重</th><th>状态</th><th>操作</th>
  </tr></thead><tbody>{state.data.items.length === 0 ? <tr><td colSpan={8}><div className="warehouse-archive-empty" role="status"><strong>暂无物流费用记录</strong><span>待确认页可新增第一条费用记录。</span></div></td></tr> : state.data.items.map((record) => <tr key={record.id}>
    <td>{record.shippedOn}</td>
    <td><strong>{record.shopName}</strong><span>{record.platformName}</span></td>
    <td><strong>{record.orderReference}</strong><span>{record.transactionReference ?? '无交易号'}</span></td>
    <td><strong>{record.channelName}</strong><span>{record.trackingReference}</span></td>
    <td><strong>{feeText(record.actualFee, record.currency)}</strong><span>预估 {feeText(record.estimatedFee, record.currency)} · 差异 {varianceText(record.feeVariance, record.currency)}</span></td>
    <td><strong>承运商 {weightText(record.carrierWeightKg)}</strong><span>仓库 {weightText(record.warehouseWeightKg)} · 差异 {weightVarianceText(record.weightVarianceKg)}</span></td>
    <td>{record.lifecycleStatus === 'ARCHIVED' ? '已归档' : record.confirmationStatus === 'CONFIRMED' ? '已确认' : '待确认'}<span>{record.confirmedByDisplayName ?? record.createdByDisplayName}</span></td>
    <td>{canWrite && record.lifecycleStatus === 'ACTIVE' && record.confirmationStatus === 'UNCONFIRMED' ? <div className="warehouse-archive-row-actions"><button className="text-button" type="button" disabled={busy} onClick={() => edit(record)}>编辑</button>{record.actualFee !== undefined ? <button className="text-button" type="button" disabled={busy} onClick={() => void confirm(record)}>确认</button> : null}<button className="text-button is-danger" type="button" disabled={busy} onClick={() => archive(record)}>归档</button></div> : '—'}</td>
  </tr>)}</tbody></table></div>
}

function feeText(value: number | undefined, currency: string) {
  return value === undefined ? '—' : `${new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value)} ${currency}`
}
function varianceText(value: number | undefined, currency: string) {
  if (value === undefined) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value)} ${currency}`
}
function weightText(value: number | undefined) {
  return value === undefined ? '—' : `${value.toFixed(3)} kg`
}
function weightVarianceText(value: number | undefined) {
  if (value === undefined) return '—'
  return `${value > 0 ? '+' : ''}${value.toFixed(3)} kg`
}
