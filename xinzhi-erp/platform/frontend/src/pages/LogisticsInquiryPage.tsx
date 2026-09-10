import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useRouter, useRouterState } from '@tanstack/react-router'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { CurrencyCodeInput } from '../components/CurrencyCodeInput'
import { DialogCloseButton } from '../components/DialogCloseButton'
import {
  logisticsInquiryApi,
  type LogisticsInquiry,
  type LogisticsInquiryContact,
  type LogisticsInquiryDetail,
  type LogisticsInquiryInput,
  type LogisticsInquiryPageData,
  type LogisticsInquiryStatus,
} from '../modules/logisticsInquiryApi'
import './WarehouseArchiveShells.css'

export type LogisticsInquiryView = 'MARKET' | 'MY_INQUIRIES'
export type LogisticsInquiryQuery = {
  view: LogisticsInquiryView
  status: 'ALL' | LogisticsInquiryStatus
  country: string
  publishedFrom: string
  publishedTo: string
  page: number
  size: number
}
type LoadState = { status: 'loading' } | { status: 'ready'; data: LogisticsInquiryPageData } | { status: 'error'; message: string }
type DialogState = { kind: 'contact'; contact: LogisticsInquiryContact }
  | { kind: 'inquiry'; inquiry?: LogisticsInquiry; contact: LogisticsInquiryContact }
  | { kind: 'detail'; detail: LogisticsInquiryDetail }
  | { kind: 'transition'; inquiry: LogisticsInquiry; target: LogisticsInquiryStatus }

const statuses: ReadonlyArray<{ value: 'ALL' | LogisticsInquiryStatus; label: string }> = [
  { value: 'ALL', label: '全部状态' }, { value: 'BIDDING', label: '报价中' },
  { value: 'PAUSED', label: '已暂停' }, { value: 'COMPLETED', label: '已结束' },
  { value: 'CANCELLED', label: '已取消' },
]
const statusLabels: Record<LogisticsInquiryStatus, string> = { BIDDING: '报价中', PAUSED: '已暂停', COMPLETED: '已结束', CANCELLED: '已取消' }
const PAGE_SIZES = [25, 50, 100] as const

function boundedText(value: string | null, maximum = 100) { return (value ?? '').trim().slice(0, maximum) }
function dateText(value: string | null) {
  const valueText = boundedText(value, 10)
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valueText)
  if (!match) return ''
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return date.toISOString().startsWith(valueText) ? valueText : ''
}
function integer(value: string | null, fallback: number, min: number, max: number) { const parsed = Number(value); return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback }
function view(value: string | null): LogisticsInquiryView { return value === 'MARKET' ? value : 'MY_INQUIRIES' }
function status(value: string | null): LogisticsInquiryQuery['status'] { return statuses.some((item) => item.value === value) ? value as LogisticsInquiryQuery['status'] : 'ALL' }
function displayTime(value: string) { return new Date(value).toLocaleString('zh-CN', { hour12: false }) }
function safeMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 409) return '记录已变化，请刷新后重试。'
  if (error instanceof ApiError && error.status === 403) return '当前账号没有物流询价管理权限。'
  if (error instanceof ApiError && error.status === 400) return '请检查必填项、数量、重量、联系电话和报价后重试。'
  return '操作未完成，请稍后重试。'
}

export function parseLogisticsInquiryQuery(search: string): LogisticsInquiryQuery {
  const params = new URLSearchParams(search)
  return { view: view(params.get('view')), status: status(params.get('status')), country: boundedText(params.get('country')), publishedFrom: dateText(params.get('publishedFrom')), publishedTo: dateText(params.get('publishedTo')), page: integer(params.get('page'), 0, 0, 9999), size: integer(params.get('size'), 25, 1, 100) }
}
export function toLogisticsInquiryUrl(query: Partial<LogisticsInquiryQuery>) {
  const params = new URLSearchParams()
  if (query.view === 'MARKET') params.set('view', query.view)
  if (query.status && query.status !== 'ALL' && query.view !== 'MARKET') params.set('status', query.status)
  if (query.country) params.set('country', boundedText(query.country))
  const from = dateText(query.publishedFrom ?? null); const to = dateText(query.publishedTo ?? null)
  if (from) params.set('publishedFrom', from); if (to) params.set('publishedTo', to)
  if (query.page && query.page > 0) params.set('page', String(query.page))
  if (query.size && query.size !== 25) params.set('size', String(query.size))
  const serialized = params.toString(); return serialized ? `/logistics/inquiries?${serialized}` : '/logistics/inquiries'
}

export function LogisticsInquiryPage() {
  const router = useRouter(); const search = useRouterState({ select: (state) => state.location.searchStr })
  const query = useMemo(() => parseLogisticsInquiryQuery(search), [search])
  const { hasPermission } = useAuth(); const canWrite = hasPermission('logistics.inquiry.write')
  const [state, setState] = useState<LoadState>({ status: 'loading' }); const [reload, setReload] = useState(0)
  const [dialog, setDialog] = useState<DialogState>(); const [busy, setBusy] = useState(false); const [feedback, setFeedback] = useState('')
  const navigate = (next: Partial<LogisticsInquiryQuery>) => router.history.push(toLogisticsInquiryUrl(next))

  useEffect(() => {
    const controller = new AbortController(); setState({ status: 'loading' })
    void logisticsInquiryApi.list({ view: query.view, status: query.view === 'MARKET' || query.status === 'ALL' ? undefined : query.status, country: query.country || undefined, publishedFrom: query.publishedFrom || undefined, publishedTo: query.publishedTo || undefined, page: query.page, pageSize: query.size, signal: controller.signal }).then(
      (data) => { const last = Math.max(data.totalPages - 1, 0); if (query.page > last) navigate({ ...query, page: last }); else setState({ status: 'ready', data }) },
      (error) => { if (!(error instanceof DOMException && error.name === 'AbortError')) setState({ status: 'error', message: '暂时无法读取物流询价，请稍后重试。' }) },
    ); return () => controller.abort()
  }, [query, reload])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget)
    const from = dateText(String(data.get('publishedFrom') ?? '')); const to = dateText(String(data.get('publishedTo') ?? ''))
    if (from && to && from > to) { setFeedback('发布时间起不能晚于发布时间止。'); return }
    setFeedback(''); navigate({ view: query.view, status: query.view === 'MARKET' ? 'ALL' : status(String(data.get('status') ?? 'ALL')), country: boundedText(String(data.get('country') ?? '')), publishedFrom: from, publishedTo: to, page: 0, size: query.size })
  }
  const loadContact = async () => logisticsInquiryApi.contact().catch(() => ({} as LogisticsInquiryContact))
  const openContact = async () => { setFeedback(''); setDialog({ kind: 'contact', contact: await loadContact() }) }
  const openInquiry = async (inquiry?: LogisticsInquiry) => { setFeedback(''); setDialog({ kind: 'inquiry', inquiry, contact: await loadContact() }) }
  const openDetail = async (inquiry: LogisticsInquiry) => { setBusy(true); setFeedback(''); try { setDialog({ kind: 'detail', detail: await logisticsInquiryApi.detail(inquiry.id) }) } catch (error) { setFeedback(safeMessage(error)) } finally { setBusy(false) } }
  const transition = async () => {
    if (dialog?.kind !== 'transition') return; setBusy(true); setFeedback('')
    try { const updated = await logisticsInquiryApi.transition(dialog.inquiry.id, dialog.inquiry.version, dialog.target); setFeedback(`询价单 ${updated.inquiryNo} 已更新为“${statusLabels[updated.status]}”。`); setDialog(undefined); setReload((value) => value + 1) } catch (error) { setFeedback(safeMessage(error)) } finally { setBusy(false) }
  }

  return <main className="warehouse-archive-page" aria-labelledby="logistics-inquiry-title">
    <header className="warehouse-archive-heading"><div><p className="eyebrow">物流 / 增值服务</p><h1 id="logistics-inquiry-title">物流询价</h1><p>发布运输需求、登记承运商报价并管理询价状态。</p></div></header>
    <div className="warehouse-archive-tabs" role="tablist" aria-label="询价视图">
      <button className={query.view === 'MARKET' ? 'is-active' : ''} type="button" role="tab" aria-selected={query.view === 'MARKET'} onClick={() => navigate({ ...query, view: 'MARKET', status: 'ALL', page: 0 })}>报价登记</button>
      <button className={query.view === 'MY_INQUIRIES' ? 'is-active' : ''} type="button" role="tab" aria-selected={query.view === 'MY_INQUIRIES'} onClick={() => navigate({ ...query, view: 'MY_INQUIRIES', page: 0 })}>询价管理</button>
    </div>
    <section className="warehouse-archive-card" aria-label="物流询价筛选与列表">
      <div className="warehouse-processing-formula" role="note"><strong>业务规则</strong><span>仅“报价中”的询价可登记报价；暂停后可恢复，已结束或已取消的询价仅供查询。</span></div>
      <form className="warehouse-archive-filters" key={toLogisticsInquiryUrl(query)} onSubmit={submit}>
        {query.view === 'MY_INQUIRIES' && <label>状态<select name="status" defaultValue={query.status}>{statuses.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>}
        <label>运送范围<input name="country" defaultValue={query.country} maxLength={100} placeholder="国家、地区或线路" /></label>
        <label>发布时间起<input name="publishedFrom" type="date" defaultValue={query.publishedFrom} /></label><label>发布时间止<input name="publishedTo" type="date" defaultValue={query.publishedTo} /></label>
        <div className="warehouse-archive-filter-actions"><button className="is-primary" type="submit">搜索</button><button type="button" onClick={() => navigate({ view: query.view, size: query.size })}>重置</button><button type="button" onClick={() => setReload((value) => value + 1)}>刷新</button></div>
      </form>
      <div className="warehouse-archive-actions">{canWrite && <><button type="button" onClick={() => void openContact()}>联系人设置</button><button className="is-primary" type="button" onClick={() => void openInquiry()}>发布物流需求</button></>}</div>
      {feedback && <div className="inline-alert" role="status">{feedback}</div>}
      {state.status === 'loading' && <div className="warehouse-archive-empty" role="status"><strong>正在读取物流询价…</strong></div>}
      {state.status === 'error' && <div className="inline-alert" role="alert">{state.message}<button type="button" onClick={() => setReload((value) => value + 1)}>重试</button></div>}
      {state.status === 'ready' && <><div className="warehouse-archive-table-wrap"><table aria-label="物流询价列表"><thead><tr><th>询价单号</th><th>起运地</th><th>运送范围</th><th>订单数 / 重量（每周）</th><th>品类</th><th>状态</th><th>发布时间</th><th>有效报价</th><th>操作</th></tr></thead><tbody>
        {state.data.items.length === 0 ? <tr><td colSpan={9}><div className="warehouse-archive-empty" role="status"><strong>没有符合条件的物流询价</strong><span>{canWrite ? '可发布第一条物流需求。' : '请调整筛选条件后重试。'}</span></div></td></tr> : state.data.items.map((item) => <tr key={item.id}><td><strong>{item.inquiryNo}</strong></td><td>{item.origin}</td><td>{item.destination}</td><td>{item.weeklyOrderCount} 单 / {item.weeklyWeightKg.toFixed(3)} kg</td><td>{item.category}</td><td><span className="status-badge">{statusLabels[item.status]}</span></td><td>{displayTime(item.publishedAt)}</td><td>{item.activeQuoteCount}</td><td><button className="text-button" type="button" disabled={busy} onClick={() => void openDetail(item)}>{query.view === 'MARKET' ? '登记报价' : '查看报价'}</button>{canWrite && query.view === 'MY_INQUIRIES' && (item.status === 'BIDDING' || item.status === 'PAUSED') && <><button className="text-button" type="button" onClick={() => void openInquiry(item)}>编辑</button>{item.status === 'BIDDING' ? <button className="text-button" type="button" onClick={() => setDialog({ kind: 'transition', inquiry: item, target: 'PAUSED' })}>暂停</button> : <button className="text-button" type="button" onClick={() => setDialog({ kind: 'transition', inquiry: item, target: 'BIDDING' })}>恢复</button>}<button className="text-button" type="button" onClick={() => setDialog({ kind: 'transition', inquiry: item, target: 'COMPLETED' })}>结束</button><button className="text-button is-danger" type="button" onClick={() => setDialog({ kind: 'transition', inquiry: item, target: 'CANCELLED' })}>取消询价</button></>}</td></tr>)}
      </tbody></table></div><div className="procurement-plan-table-footer"><span>共 {state.data.totalElements} 条</span><label>每页<select aria-label="询价每页条数" value={query.size} onChange={(event) => navigate({ ...query, page: 0, size: Number(event.target.value) })}>{PAGE_SIZES.map((size) => <option key={size} value={size}>{size} 条</option>)}</select></label><div className="pagination"><button type="button" disabled={query.page === 0} onClick={() => navigate({ ...query, page: query.page - 1 })}>上一页</button><span>第 {query.page + 1} / {Math.max(state.data.totalPages, 1)} 页</span><button type="button" disabled={query.page + 1 >= state.data.totalPages} onClick={() => navigate({ ...query, page: query.page + 1 })}>下一页</button></div></div></>}
    </section>
    {dialog?.kind === 'contact' && <ContactDialog initial={dialog.contact} busy={busy} close={() => setDialog(undefined)} save={async (input) => { setBusy(true); setFeedback(''); try { const saved = await logisticsInquiryApi.saveContact(input); setFeedback(`默认联系人“${saved.contactName}”已保存。`); setDialog(undefined) } catch (error) { setFeedback(safeMessage(error)) } finally { setBusy(false) } }} />}
    {dialog?.kind === 'inquiry' && <InquiryDialog initial={dialog.inquiry} contact={dialog.contact} busy={busy} close={() => setDialog(undefined)} save={async (input) => { setBusy(true); setFeedback(''); try { const saved = dialog.inquiry ? await logisticsInquiryApi.update(dialog.inquiry.id, dialog.inquiry.version, input) : await logisticsInquiryApi.create(input); setFeedback(`询价单 ${saved.inquiryNo} 已${dialog.inquiry ? '保存' : '发布'}。`); setDialog(undefined); setReload((value) => value + 1) } catch (error) { setFeedback(safeMessage(error)) } finally { setBusy(false) } }} />}
    {dialog?.kind === 'detail' && <InquiryDetailDialog initial={dialog.detail} canWrite={canWrite} busy={busy} close={() => setDialog(undefined)} changed={(next, message) => { setDialog({ kind: 'detail', detail: next }); setFeedback(message); setReload((value) => value + 1) }} setBusy={setBusy} setFeedback={setFeedback} />}
    {dialog?.kind === 'transition' && <TransitionDialog inquiry={dialog.inquiry} target={dialog.target} busy={busy} close={() => setDialog(undefined)} confirm={() => void transition()} />}
  </main>
}

function ContactDialog({ initial, busy, close, save }: { initial: LogisticsInquiryContact; busy: boolean; close: () => void; save: (input: { contactName: string; contactPhone: string; version?: number }) => Promise<void> }) {
  return <Dialog title="联系人设置" close={close} busy={busy}><p className="form-hint">新发布的物流需求会优先带入此联系人，仍可在发布时单独修改。</p><form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void save({ contactName: String(data.get('contactName') ?? '').trim(), contactPhone: String(data.get('contactPhone') ?? '').trim(), version: initial.version }) }}><label>联系人姓名<input name="contactName" required maxLength={100} defaultValue={initial.contactName ?? ''} /></label><label>联系电话<input name="contactPhone" required maxLength={40} pattern="[0-9+() -]{5,40}" defaultValue={initial.contactPhone ?? ''} placeholder="例如：+86 138 0000 0000" /></label><div className="form-actions"><button type="button" onClick={close} disabled={busy}>取消</button><button className="is-primary" type="submit" disabled={busy}>{busy ? '正在保存…' : '保存联系人'}</button></div></form></Dialog>
}
function InquiryDialog({ initial, contact, busy, close, save }: { initial?: LogisticsInquiry; contact: LogisticsInquiryContact; busy: boolean; close: () => void; save: (input: LogisticsInquiryInput) => Promise<void> }) {
  return <Dialog title={initial ? `编辑询价单 ${initial.inquiryNo}` : '发布物流需求'} close={close} busy={busy}><form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void save({ origin: String(data.get('origin') ?? '').trim(), destination: String(data.get('destination') ?? '').trim(), weeklyOrderCount: Number(data.get('weeklyOrderCount')), weeklyWeightKg: Number(data.get('weeklyWeightKg')), category: String(data.get('category') ?? '').trim(), contactName: String(data.get('contactName') ?? '').trim(), contactPhone: String(data.get('contactPhone') ?? '').trim(), note: String(data.get('note') ?? '').trim() || undefined }) }}><div className="warehouse-dialog-grid"><label>起运地<input name="origin" required maxLength={160} defaultValue={initial?.origin ?? ''} placeholder="例如：中国深圳" /></label><label>运送范围<input name="destination" required maxLength={240} defaultValue={initial?.destination ?? ''} placeholder="例如：美国本土" /></label><label>每周订单数<input name="weeklyOrderCount" type="number" min={1} max={1000000} required defaultValue={initial?.weeklyOrderCount ?? ''} /></label><label>每周重量（kg）<input name="weeklyWeightKg" type="number" min="0.001" max="999999999.999" step="0.001" required defaultValue={initial?.weeklyWeightKg ?? ''} /></label><label>品类<input name="category" required maxLength={120} defaultValue={initial?.category ?? ''} placeholder="例如：服装" /></label><label>联系人姓名<input name="contactName" required maxLength={100} defaultValue={initial?.contactName ?? contact.contactName ?? ''} /></label><label>联系电话<input name="contactPhone" required maxLength={40} pattern="[0-9+() -]{5,40}" defaultValue={initial?.contactPhone ?? contact.contactPhone ?? ''} /></label><label className="inventory-count-note">备注（可选）<textarea name="note" maxLength={500} defaultValue={initial?.note ?? ''} /></label></div><div className="form-actions"><button type="button" onClick={close} disabled={busy}>取消</button><button className="is-primary" type="submit" disabled={busy}>{busy ? '正在保存…' : initial ? '保存修改' : '发布需求'}</button></div></form></Dialog>
}
function InquiryDetailDialog({ initial, canWrite, busy, close, changed, setBusy, setFeedback }: { initial: LogisticsInquiryDetail; canWrite: boolean; busy: boolean; close: () => void; changed: (next: LogisticsInquiryDetail, message: string) => void; setBusy: (value: boolean) => void; setFeedback: (value: string) => void }) {
  const inquiry = initial.inquiry; const canQuote = canWrite && inquiry.status === 'BIDDING'
  const add = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true); setFeedback(''); try { const next = await logisticsInquiryApi.addQuote(inquiry.id, { providerName: String(data.get('providerName') ?? '').trim(), serviceName: String(data.get('serviceName') ?? '').trim(), pricePerKg: Number(data.get('pricePerKg')), currency: String(data.get('currency') ?? '').trim().toUpperCase(), transitDays: Number(data.get('transitDays')), note: String(data.get('note') ?? '').trim() || undefined }); changed(next, `询价单 ${inquiry.inquiryNo} 已登记一条报价。`) } catch (error) { setFeedback(safeMessage(error)) } finally { setBusy(false) } }
  const withdraw = async (quoteId: string, version: number) => { setBusy(true); setFeedback(''); try { changed(await logisticsInquiryApi.withdrawQuote(inquiry.id, quoteId, version), `询价单 ${inquiry.inquiryNo} 的报价已撤回。`) } catch (error) { setFeedback(safeMessage(error)) } finally { setBusy(false) } }
  return <Dialog title={`询价与报价 · ${inquiry.inquiryNo}`} close={close} busy={busy} wide><dl className="inventory-count-summary-grid"><div><dt>线路</dt><dd>{inquiry.origin} → {inquiry.destination}</dd></div><div><dt>需求</dt><dd>{inquiry.weeklyOrderCount} 单 / {inquiry.weeklyWeightKg.toFixed(3)} kg 每周</dd></div><div><dt>品类</dt><dd>{inquiry.category}</dd></div><div><dt>联系人</dt><dd>{inquiry.contactName} · {inquiry.contactPhone}</dd></div></dl><div className="warehouse-archive-table-wrap"><table aria-label="询价报价列表"><thead><tr><th>承运商</th><th>服务方案</th><th>每公斤报价</th><th>预计时效</th><th>状态</th><th>登记人</th><th>操作</th></tr></thead><tbody>{initial.quotes.length === 0 ? <tr><td colSpan={7}><div className="warehouse-archive-empty" role="status"><strong>暂无报价</strong><span>{canQuote ? '可在下方登记收到的承运商报价。' : '当前询价状态不再接受报价。'}</span></div></td></tr> : initial.quotes.map((quote) => <tr key={quote.id}><td>{quote.providerName}</td><td>{quote.serviceName}</td><td>{quote.pricePerKg.toFixed(4)} {quote.currency}</td><td>{quote.transitDays} 天</td><td>{quote.status === 'ACTIVE' ? '有效' : '已撤回'}</td><td>{quote.createdByDisplayName}</td><td>{canWrite && quote.status === 'ACTIVE' && (inquiry.status === 'BIDDING' || inquiry.status === 'PAUSED') ? <button className="text-button is-danger" type="button" disabled={busy} onClick={() => void withdraw(quote.id, quote.version)}>撤回</button> : '—'}</td></tr>)}</tbody></table></div>{canQuote && <form aria-label="登记物流报价" onSubmit={(event) => void add(event)}><h3>登记报价</h3><div className="warehouse-dialog-grid"><label>承运商<input name="providerName" required maxLength={120} /></label><label>服务方案<input name="serviceName" required maxLength={120} /></label><label>每公斤报价<input name="pricePerKg" required type="number" min="0" step="0.0001" /></label><label>币种<CurrencyCodeInput listId="logistics-inquiry-currency" name="currency" required defaultValue="USD" /></label><label>预计时效（天）<input name="transitDays" required type="number" min={1} max={365} /></label><label className="inventory-count-note">报价说明（可选）<textarea name="note" maxLength={500} /></label></div><div className="form-actions"><button className="is-primary" type="submit" disabled={busy}>{busy ? '正在登记…' : '登记报价'}</button></div></form>}</Dialog>
}
function TransitionDialog({ inquiry, target, busy, close, confirm }: { inquiry: LogisticsInquiry; target: LogisticsInquiryStatus; busy: boolean; close: () => void; confirm: () => void }) {
  return <section className="warehouse-dialog-backdrop" role="presentation"><section className="warehouse-dialog warehouse-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="inquiry-transition-title"><header className="table-heading"><div><h2 id="inquiry-transition-title">{statusLabels[target]}询价</h2><p>询价单 {inquiry.inquiryNo}</p></div><DialogCloseButton disabled={busy} onClick={close} /></header><div className="warehouse-confirm-body"><p>{target === 'CANCELLED' ? '取消后不能恢复或继续报价。' : target === 'COMPLETED' ? '结束后不能继续登记报价。' : target === 'PAUSED' ? '暂停期间不能登记新报价，可稍后恢复。' : '恢复后可继续登记报价。'}</p></div><footer className="warehouse-confirm-actions"><button type="button" onClick={close} disabled={busy}>返回</button><button className={target === 'CANCELLED' ? 'is-danger' : 'is-primary'} type="button" disabled={busy} onClick={confirm}>{busy ? '正在处理…' : '确认'}</button></footer></section></section>
}
function Dialog({ title, close, busy, wide, children }: { title: string; close: () => void; busy: boolean; wide?: boolean; children: React.ReactNode }) {
  return <section className="warehouse-dialog-backdrop" role="presentation"><section className={`warehouse-dialog logistics-inquiry-dialog${wide ? ' is-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><header className="table-heading"><h2>{title}</h2><DialogCloseButton disabled={busy} onClick={close} /></header><div className="logistics-inquiry-dialog-body">{children}</div></section></section>
}
