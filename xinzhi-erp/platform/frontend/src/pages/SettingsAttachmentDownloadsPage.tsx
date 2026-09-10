import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useRouter, useRouterState } from '@tanstack/react-router'
import { ApiError } from '../api/client'
import { SettingsPageHeader } from '../components/SettingsPageLayout'
import { settingsTransferTaskApi, type SettingsTransferTask, type SettingsTransferTaskPage } from '../modules/settingsTransferTaskApi'
import { saveSettingsTransferResult } from '../modules/settingsTransferDownload'
import './WarehouseArchiveShells.css'

type Query = { keyword: string; startDate: string; endDate: string; page: number; size: number }
type State = { status: 'loading' } | { status: 'ready'; data: SettingsTransferTaskPage } | { status: 'error'; message: string }
const DEFAULT_SIZE = 25
const PAGE_SIZES = [10, 25, 50, 100] as const

function date(value: string | null) { const text = (value ?? '').trim(); return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '' }
function keyword(value: string | null) { const text = (value ?? '').trim(); return text.length <= 160 && !/[\u0000-\u001f\u007f]/.test(text) ? text : '' }
function integer(value: string | null, fallback: number, minimum: number, maximum: number) { const number = Number(value); return Number.isSafeInteger(number) && number >= minimum && number <= maximum ? number : fallback }
function formatTime(value?: string) { return value ? new Date(value).toLocaleString() : '—' }
function formatBytes(value: number) { if (value < 1024) return `${value} B`; if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`; return `${(value / 1024 / 1024).toFixed(1)} MB` }
function safeMessage(error: unknown) { if (error instanceof ApiError && error.status === 403) return '当前账号没有下载系统附件的权限。'; if (error instanceof ApiError && error.status === 404) return '该文件已不可用，请刷新列表。'; return '暂时无法下载文件，请稍后重试。' }

export function parseSettingsAttachmentQuery(search: string): Query {
  const params = new URLSearchParams(search)
  return { keyword: keyword(params.get('keyword')), startDate: date(params.get('startDate')), endDate: date(params.get('endDate')), page: integer(params.get('page'), 0, 0, 9_999), size: integer(params.get('size'), DEFAULT_SIZE, 1, 100) }
}

export function toSettingsAttachmentUrl(query: Partial<Query>) {
  const params = new URLSearchParams()
  if (query.keyword) params.set('keyword', query.keyword)
  if (query.startDate) params.set('startDate', query.startDate)
  if (query.endDate) params.set('endDate', query.endDate)
  if (query.page && query.page > 0) params.set('page', String(query.page))
  if (query.size && query.size !== DEFAULT_SIZE) params.set('size', String(query.size))
  const serialized = params.toString()
  return serialized ? `/settings/tasks/attachments?${serialized}` : '/settings/tasks/attachments'
}

export function SettingsAttachmentDownloadsPage() {
  const router = useRouter()
  const search = useRouterState({ select: (state) => state.location.searchStr })
  const query = useMemo(() => parseSettingsAttachmentQuery(search), [search])
  const [state, setState] = useState<State>({ status: 'loading' })
  const [refreshKey, setRefreshKey] = useState(0)
  const [downloadingId, setDownloadingId] = useState<string>()
  const [feedback, setFeedback] = useState<string>()

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })
    setFeedback(undefined)
    void settingsTransferTaskApi.list({
      jobType: 'EXPORT', status: 'SUCCEEDED', resultAvailable: true,
      keyword: query.keyword || undefined, startDate: query.startDate || undefined,
      endDate: query.endDate || undefined, page: query.page, size: query.size,
      signal: controller.signal,
    }).then((data) => {
      const lastPage = Math.max(data.totalPages - 1, 0)
      if (query.page > lastPage) { router.history.push(toSettingsAttachmentUrl({ ...query, page: lastPage })); return }
      setState({ status: 'ready', data })
    }, () => { if (!controller.signal.aborted) setState({ status: 'error', message: '暂时无法读取可下载文件，请稍后重试。' }) })
    return () => controller.abort()
  }, [query.endDate, query.keyword, query.page, query.size, query.startDate, refreshKey, router.history])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const next = { keyword: keyword(String(data.get('keyword') ?? '')), startDate: date(String(data.get('startDate') ?? '')), endDate: date(String(data.get('endDate') ?? '')), page: 0, size: query.size }
    if (next.startDate && next.endDate && next.startDate > next.endDate) { setFeedback('开始日期不能晚于结束日期。'); return }
    router.history.push(toSettingsAttachmentUrl(next))
  }

  const download = async (task: SettingsTransferTask) => {
    setDownloadingId(task.id)
    setFeedback(undefined)
    try {
      const result = await settingsTransferTaskApi.result(task.id)
      saveSettingsTransferResult(result.filename, result.mediaType, result.contentBase64)
      setFeedback(`已下载 ${result.filename}。`)
    } catch (error) {
      setFeedback(safeMessage(error))
    } finally {
      setDownloadingId(undefined)
    }
  }

  return <main className="warehouse-archive-page settings-page" aria-labelledby="settings-attachments-title">
    <SettingsPageHeader id="settings-attachments-title" section="任务公告" title="附件下载" description="集中查看并下载系统生成且仍可用的文件。" />
    <section className="warehouse-archive-card" aria-label="附件筛选与下载结果">
      <form className="warehouse-archive-filters procurement-plan-filters" key={toSettingsAttachmentUrl(query)} onSubmit={submit}>
        <label>文件名<input name="keyword" defaultValue={query.keyword} placeholder="输入文件名" maxLength={160} /></label>
        <label>开始日期<input name="startDate" type="date" defaultValue={query.startDate} /></label>
        <label>结束日期<input name="endDate" type="date" defaultValue={query.endDate} /></label>
        <div className="warehouse-archive-filter-actions"><button className="is-primary" type="submit">搜索</button><button type="button" onClick={() => router.history.push('/settings/tasks/attachments')}>重置</button><button type="button" onClick={() => setRefreshKey((value) => value + 1)}>刷新</button></div>
      </form>
      {feedback && <div className="inline-alert" role="status">{feedback}</div>}
      {state.status === 'loading' && <div className="warehouse-archive-empty" role="status"><strong>正在读取文件…</strong></div>}
      {state.status === 'error' && <div className="inline-alert" role="alert">{state.message}<button type="button" onClick={() => setRefreshKey((value) => value + 1)}>重试</button></div>}
      {state.status === 'ready' && <>
        <div className="warehouse-archive-table-wrap"><table aria-label="附件下载列表"><thead><tr><th>文件名称</th><th>业务类型</th><th>数据行数</th><th>文件大小</th><th>生成时间</th><th>操作人</th><th>操作</th></tr></thead><tbody>
          {state.data.items.length === 0 ? <tr><td colSpan={7}><div className="warehouse-archive-empty" role="status"><strong>暂无可下载文件</strong><span>在订单中心导出数据后，可在这里再次下载结果。</span></div></td></tr> : state.data.items.map((task) => <tr key={task.id}><td><strong>{task.filename}</strong></td><td>订单导出</td><td>{task.succeededCount}</td><td>{formatBytes(task.resultSizeBytes)}</td><td>{formatTime(task.completedAt ?? task.createdAt)}</td><td>{task.createdByDisplayName}</td><td><button className="text-button" type="button" disabled={downloadingId === task.id} onClick={() => void download(task)}>{downloadingId === task.id ? '正在下载…' : '下载'}</button></td></tr>)}
        </tbody></table></div>
        <div className="procurement-plan-table-footer"><span>共 {state.data.totalElements} 条</span><label>每页<select aria-label="附件下载分页每页条数" value={query.size} onChange={(event) => router.history.push(toSettingsAttachmentUrl({ ...query, page: 0, size: Number(event.target.value) }))}>{PAGE_SIZES.map((size) => <option key={size} value={size}>{size} 条</option>)}</select></label><div className="pagination"><button type="button" disabled={query.page === 0} onClick={() => router.history.push(toSettingsAttachmentUrl({ ...query, page: query.page - 1 }))}>上一页</button><span>第 {query.page + 1} / {Math.max(state.data.totalPages, 1)} 页</span><button type="button" disabled={query.page + 1 >= state.data.totalPages} onClick={() => router.history.push(toSettingsAttachmentUrl({ ...query, page: query.page + 1 }))}>下一页</button></div></div>
      </>}
    </section>
  </main>
}
