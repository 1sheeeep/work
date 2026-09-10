import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useRouter, useRouterState } from '@tanstack/react-router'
import { ApiError } from '../api/client'
import { SettingsPageHeader } from '../components/SettingsPageLayout'
import { settingsMessageApi, type SettingsMessage, type SettingsMessagePage, type SettingsMessageReadState, type SettingsMessageType } from '../modules/settingsMessageApi'
import './WarehouseArchiveShells.css'

type Query = {
  startDate: string
  endDate: string
  type: '' | SettingsMessageType
  readState: SettingsMessageReadState
  page: number
  size: number
}
type State = { status: 'loading' } | { status: 'ready'; data: SettingsMessagePage } | { status: 'error'; message: string }
const DEFAULT_SIZE = 25
const PAGE_SIZES = [10, 25, 50, 100] as const

function date(value: string | null) { const text = (value ?? '').trim(); return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '' }
function integer(value: string | null, fallback: number, minimum: number, maximum: number) { const number = Number(value); return Number.isSafeInteger(number) && number >= minimum && number <= maximum ? number : fallback }
function readState(value: string | null): SettingsMessageReadState { return value === 'UNREAD' || value === 'READ' ? value : 'ALL' }
function type(value: string | null): Query['type'] { return value === 'INTERNAL_NOTICE' ? value : '' }
function safeMessage(error: unknown) { if (error instanceof ApiError && error.status === 403) return '当前账号没有查看消息的权限。'; return '暂时无法处理消息，请稍后重试。' }
function formatTime(value?: string) { return value ? new Date(value).toLocaleString() : '—' }

export function parseSettingsMessageQuery(search: string): Query {
  const params = new URLSearchParams(search)
  return { startDate: date(params.get('startDate')), endDate: date(params.get('endDate')), type: type(params.get('type')), readState: readState(params.get('readState')), page: integer(params.get('page'), 0, 0, 9_999), size: integer(params.get('size'), DEFAULT_SIZE, 1, 100) }
}

export function toSettingsMessageUrl(query: Partial<Query>) {
  const params = new URLSearchParams()
  if (query.startDate) params.set('startDate', query.startDate)
  if (query.endDate) params.set('endDate', query.endDate)
  if (query.type) params.set('type', query.type)
  if (query.readState && query.readState !== 'ALL') params.set('readState', query.readState)
  if (query.page && query.page > 0) params.set('page', String(query.page))
  if (query.size && query.size !== DEFAULT_SIZE) params.set('size', String(query.size))
  const serialized = params.toString()
  return serialized ? `/settings/tasks/messages?${serialized}` : '/settings/tasks/messages'
}

export function SettingsMessageCenterPage() {
  const router = useRouter()
  const search = useRouterState({ select: (state) => state.location.searchStr })
  const query = useMemo(() => parseSettingsMessageQuery(search), [search])
  const [state, setState] = useState<State>({ status: 'loading' })
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [refreshKey, setRefreshKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<string>()

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' }); setSelectedIds(new Set()); setFeedback(undefined)
    void settingsMessageApi.list({ startDate: query.startDate || undefined, endDate: query.endDate || undefined, type: query.type || undefined, readState: query.readState, page: query.page, size: query.size, signal: controller.signal }).then(
      (data) => {
        const lastPage = Math.max(data.totalPages - 1, 0)
        if (query.page > lastPage) { router.history.push(toSettingsMessageUrl({ ...query, page: lastPage })); return }
        setState({ status: 'ready', data })
      },
      () => { if (!controller.signal.aborted) setState({ status: 'error', message: '暂时无法读取消息，请稍后重试。' }) },
    )
    return () => controller.abort()
  }, [query.endDate, query.page, query.readState, query.size, query.startDate, query.type, refreshKey, router.history])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget)
    const next = { ...query, startDate: date(String(data.get('startDate') ?? '')), endDate: date(String(data.get('endDate') ?? '')), type: type(String(data.get('type') ?? '')), readState: readState(String(data.get('readState') ?? '')), page: 0 }
    if (next.startDate && next.endDate && next.startDate > next.endDate) { setFeedback('开始日期不能晚于结束日期。'); return }
    router.history.push(toSettingsMessageUrl(next))
  }
  const unread = state.status === 'ready' ? state.data.items.filter((message) => !message.read) : []
  const selectedUnread = unread.filter((message) => selectedIds.has(message.id))
  const allUnreadSelected = unread.length > 0 && unread.every((message) => selectedIds.has(message.id))
  const markRead = async (messages: SettingsMessage[]) => {
    setBusy(true); setFeedback(undefined)
    try {
      const count = await settingsMessageApi.markRead(messages.map((message) => message.id))
      setFeedback(count > 0 ? `已将 ${count} 条消息标记为已读。` : '所选消息已经是已读状态。')
      setSelectedIds(new Set()); setRefreshKey((value) => value + 1)
    } catch (error) { setFeedback(safeMessage(error)) } finally { setBusy(false) }
  }

  return <main className="warehouse-archive-page settings-page" aria-labelledby="settings-message-title">
    <SettingsPageHeader id="settings-message-title" section="任务公告" title="消息中心" description="接收企业内部公告，并按当前账号保留独立的已读状态。" />
    <section className="warehouse-archive-card" aria-label="消息中心筛选与结果">
      <form className="warehouse-archive-filters procurement-plan-filters" key={toSettingsMessageUrl(query)} onSubmit={submit}>
        <label>开始日期<input name="startDate" type="date" defaultValue={query.startDate} /></label>
        <label>结束日期<input name="endDate" type="date" defaultValue={query.endDate} /></label>
        <label>消息类型<select name="type" defaultValue={query.type}><option value="">全部类型</option><option value="INTERNAL_NOTICE">内部公告</option></select></label>
        <label>阅读状态<select name="readState" defaultValue={query.readState}><option value="ALL">全部状态</option><option value="UNREAD">未读</option><option value="READ">已读</option></select></label>
        <div className="warehouse-archive-filter-actions"><button className="is-primary" type="submit">搜索</button><button type="button" onClick={() => router.history.push('/settings/tasks/messages')}>重置</button><button type="button" onClick={() => setRefreshKey((value) => value + 1)}>刷新</button></div>
      </form>
      <div className="warehouse-archive-actions"><button className="is-primary" type="button" disabled={busy || selectedUnread.length === 0} onClick={() => void markRead(selectedUnread)}>{busy ? '正在处理…' : '批量标记已读'}</button></div>
      {feedback && <div className="inline-alert" role="status">{feedback}</div>}
      {state.status === 'loading' && <div className="warehouse-archive-empty" role="status"><strong>正在读取消息…</strong></div>}
      {state.status === 'error' && <div className="inline-alert" role="alert">{state.message}<button type="button" onClick={() => setRefreshKey((value) => value + 1)}>重试</button></div>}
      {state.status === 'ready' && <><div className="warehouse-archive-table-wrap"><table aria-label="消息列表"><thead><tr><th><input aria-label="全选当前页未读消息" type="checkbox" checked={allUnreadSelected} disabled={unread.length === 0} onChange={(event) => setSelectedIds(event.target.checked ? new Set(unread.map((message) => message.id)) : new Set())} /></th><th>标题</th><th>内容</th><th>类型</th><th>发布人</th><th>发布时间</th><th>阅读状态</th><th>操作</th></tr></thead><tbody>{state.data.items.length === 0 ? <tr><td colSpan={8}><div className="warehouse-archive-empty" role="status"><strong>暂无符合条件的消息</strong><span>可调整日期、消息类型或阅读状态后重试。</span></div></td></tr> : state.data.items.map((message) => <tr key={message.id}><td><input aria-label={`选择 ${message.title}`} type="checkbox" disabled={message.read} checked={selectedIds.has(message.id)} onChange={(event) => setSelectedIds((current) => { const next = new Set(current); if (event.target.checked) next.add(message.id); else next.delete(message.id); return next })} /></td><td><strong>{message.pinned ? '置顶 · ' : ''}{message.title}</strong></td><td><span className="settings-notice-content" title={message.content}>{message.content}</span></td><td>内部公告</td><td>{message.createdByDisplayName}</td><td>{formatTime(message.publishedAt)}</td><td>{message.read ? <>已读<br /><small>{formatTime(message.readAt)}</small></> : <strong>未读</strong>}</td><td>{message.read ? '—' : <button className="text-button" type="button" disabled={busy} onClick={() => void markRead([message])}>标记已读</button>}</td></tr>)}</tbody></table></div><div className="procurement-plan-table-footer"><span>共 {state.data.totalElements} 条</span><label>每页<select value={query.size} onChange={(event) => router.history.push(toSettingsMessageUrl({ ...query, page: 0, size: Number(event.target.value) }))}>{PAGE_SIZES.map((size) => <option key={size} value={size}>{size} 条</option>)}</select></label><div className="pagination"><button type="button" disabled={query.page === 0} onClick={() => router.history.push(toSettingsMessageUrl({ ...query, page: query.page - 1 }))}>上一页</button><span>第 {query.page + 1} / {Math.max(state.data.totalPages, 1)} 页</span><button type="button" disabled={query.page + 1 >= state.data.totalPages} onClick={() => router.history.push(toSettingsMessageUrl({ ...query, page: query.page + 1 }))}>下一页</button></div></div></>}
    </section>
  </main>
}
