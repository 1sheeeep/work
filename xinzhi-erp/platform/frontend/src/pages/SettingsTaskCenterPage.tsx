import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useRouter, useRouterState } from '@tanstack/react-router'
import { ApiError } from '../api/client'
import { DialogCloseButton } from '../components/DialogCloseButton'
import { SettingsPageHeader } from '../components/SettingsPageLayout'
import { saveSettingsTransferResult } from '../modules/settingsTransferDownload'
import { settingsTransferTaskApi, type SettingsTransferTask, type SettingsTransferTaskFilterType, type SettingsTransferTaskPage, type SettingsTransferTaskStatus } from '../modules/settingsTransferTaskApi'
import './WarehouseArchiveShells.css'

type Query = { jobType: SettingsTransferTaskFilterType; status: SettingsTransferTaskStatus; keyword: string; startDate: string; endDate: string; page: number; size: number }
type State = { status: 'loading' } | { status: 'ready'; data: SettingsTransferTaskPage } | { status: 'error'; message: string }
const DEFAULT_SIZE = 25
const PAGE_SIZES = [10, 25, 50, 100] as const

function date(value: string | null) { const text = (value ?? '').trim(); return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '' }
function keyword(value: string | null) { const text = (value ?? '').trim(); return text.length <= 160 && !/[\u0000-\u001f\u007f]/.test(text) ? text : '' }
function integer(value: string | null, fallback: number, minimum: number, maximum: number) { const number = Number(value); return Number.isSafeInteger(number) && number >= minimum && number <= maximum ? number : fallback }
function jobType(value: string | null): SettingsTransferTaskFilterType { return value === 'EXPORT' || value === 'IMPORT' ? value : 'ALL' }
function status(value: string | null): SettingsTransferTaskStatus { return ['PENDING', 'RUNNING', 'SUCCEEDED', 'PARTIALLY_FAILED', 'FAILED', 'CANCELLED'].includes(value ?? '') ? value as SettingsTransferTaskStatus : 'ALL' }
function formatTime(value?: string) { return value ? new Date(value).toLocaleString() : '—' }
function statusLabel(value: SettingsTransferTask['status']) { return { PENDING: '等待处理', RUNNING: '处理中', SUCCEEDED: '已完成', PARTIALLY_FAILED: '部分失败', FAILED: '失败', CANCELLED: '已取消' }[value] }
function typeLabel(value: SettingsTransferTask['jobType']) { return value === 'EXPORT' ? '导出' : '导入' }
function safeMessage(error: unknown) { if (error instanceof ApiError && error.status === 403) return '当前账号没有查看任务中心的权限。'; if (error instanceof ApiError && error.status === 404) return '该任务结果已不可用，请刷新列表。'; return '暂时无法处理任务，请稍后重试。' }

export function parseSettingsTaskCenterQuery(search: string): Query {
  const params = new URLSearchParams(search)
  return { jobType: jobType(params.get('jobType')), status: status(params.get('status')), keyword: keyword(params.get('keyword')), startDate: date(params.get('startDate')), endDate: date(params.get('endDate')), page: integer(params.get('page'), 0, 0, 9_999), size: integer(params.get('size'), DEFAULT_SIZE, 1, 100) }
}

export function toSettingsTaskCenterUrl(query: Partial<Query>) {
  const params = new URLSearchParams()
  if (query.jobType && query.jobType !== 'ALL') params.set('jobType', query.jobType)
  if (query.status && query.status !== 'ALL') params.set('status', query.status)
  if (query.keyword) params.set('keyword', query.keyword)
  if (query.startDate) params.set('startDate', query.startDate)
  if (query.endDate) params.set('endDate', query.endDate)
  if (query.page && query.page > 0) params.set('page', String(query.page))
  if (query.size && query.size !== DEFAULT_SIZE) params.set('size', String(query.size))
  const serialized = params.toString()
  return serialized ? `/settings/tasks/center?${serialized}` : '/settings/tasks/center'
}

export function SettingsTaskCenterPage() {
  const router = useRouter()
  const search = useRouterState({ select: (state) => state.location.searchStr })
  const query = useMemo(() => parseSettingsTaskCenterQuery(search), [search])
  const [state, setState] = useState<State>({ status: 'loading' })
  const [refreshKey, setRefreshKey] = useState(0)
  const [selectedTask, setSelectedTask] = useState<SettingsTransferTask>()
  const [downloadingId, setDownloadingId] = useState<string>()
  const [feedback, setFeedback] = useState<string>()

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })
    setFeedback(undefined)
    setSelectedTask(undefined)
    void settingsTransferTaskApi.list({ ...query, keyword: query.keyword || undefined, startDate: query.startDate || undefined, endDate: query.endDate || undefined, signal: controller.signal }).then((data) => {
      const lastPage = Math.max(data.totalPages - 1, 0)
      if (query.page > lastPage) { router.history.push(toSettingsTaskCenterUrl({ ...query, page: lastPage })); return }
      setState({ status: 'ready', data })
    }, () => { if (!controller.signal.aborted) setState({ status: 'error', message: '暂时无法读取后台任务，请稍后重试。' }) })
    return () => controller.abort()
  }, [query.endDate, query.jobType, query.keyword, query.page, query.size, query.startDate, query.status, refreshKey, router.history])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const next = { ...query, status: status(String(data.get('status') ?? '')), keyword: keyword(String(data.get('keyword') ?? '')), startDate: date(String(data.get('startDate') ?? '')), endDate: date(String(data.get('endDate') ?? '')), page: 0 }
    if (next.startDate && next.endDate && next.startDate > next.endDate) { setFeedback('开始日期不能晚于结束日期。'); return }
    router.history.push(toSettingsTaskCenterUrl(next))
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

  return <main className="warehouse-archive-page settings-page" aria-labelledby="settings-task-center-title">
    <SettingsPageHeader id="settings-task-center-title" section="任务公告" title="任务中心" description="统一查看订单导入和导出任务的进度与处理结果。" />
    <section className="warehouse-archive-card" aria-label="任务中心筛选与结果">
      <div className="warehouse-archive-tabs" role="tablist" aria-label="任务类型">
        {([['ALL', '全部任务'], ['EXPORT', '导出任务'], ['IMPORT', '导入任务']] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={query.jobType === value} className={query.jobType === value ? 'is-active' : undefined} onClick={() => router.history.push(toSettingsTaskCenterUrl({ ...query, jobType: value, page: 0 }))}>{label}</button>)}
      </div>
      <form className="warehouse-archive-filters procurement-plan-filters" key={toSettingsTaskCenterUrl(query)} onSubmit={submit}>
        <label>任务状态<select name="status" defaultValue={query.status}><option value="ALL">全部状态</option><option value="PENDING">等待处理</option><option value="RUNNING">处理中</option><option value="SUCCEEDED">已完成</option><option value="PARTIALLY_FAILED">部分失败</option><option value="FAILED">失败</option><option value="CANCELLED">已取消</option></select></label>
        <label>文件名<input name="keyword" defaultValue={query.keyword} placeholder="输入文件名" maxLength={160} /></label>
        <label>开始日期<input name="startDate" type="date" defaultValue={query.startDate} /></label><label>结束日期<input name="endDate" type="date" defaultValue={query.endDate} /></label>
        <div className="warehouse-archive-filter-actions"><button className="is-primary" type="submit">搜索</button><button type="button" onClick={() => router.history.push(toSettingsTaskCenterUrl({ jobType: query.jobType }))}>重置</button><button type="button" onClick={() => setRefreshKey((value) => value + 1)}>刷新</button></div>
      </form>
      {feedback && <div className="inline-alert" role="status">{feedback}</div>}
      {state.status === 'loading' && <div className="warehouse-archive-empty" role="status"><strong>正在读取任务…</strong></div>}
      {state.status === 'error' && <div className="inline-alert" role="alert">{state.message}<button type="button" onClick={() => setRefreshKey((value) => value + 1)}>重试</button></div>}
      {state.status === 'ready' && <>
        <div className="warehouse-archive-table-wrap"><table aria-label="任务中心列表"><thead><tr><th>任务名称</th><th>添加时间</th><th>完成时间</th><th>类型</th><th>状态</th><th>进度</th><th>操作人</th><th>操作</th></tr></thead><tbody>
          {state.data.items.length === 0 ? <tr><td colSpan={8}><div className="warehouse-archive-empty" role="status"><strong>暂无符合条件的任务</strong><span>可在订单中心执行导入或导出后查看任务记录。</span></div></td></tr> : state.data.items.map((task) => { const completed = task.succeededCount + task.failedCount; const progress = task.requestedCount === 0 ? (task.status === 'SUCCEEDED' ? 100 : 0) : Math.min(100, Math.round(completed * 100 / task.requestedCount)); return <tr key={task.id}><td><strong>{task.filename}</strong></td><td>{formatTime(task.createdAt)}</td><td>{formatTime(task.completedAt)}</td><td>{typeLabel(task.jobType)}</td><td>{statusLabel(task.status)}</td><td>{progress}%</td><td>{task.createdByDisplayName}</td><td><button className="text-button" type="button" onClick={() => setSelectedTask(task)}>查看详情</button></td></tr> })}
        </tbody></table></div>
        <div className="procurement-plan-table-footer"><span>共 {state.data.totalElements} 条</span><label>每页<select aria-label="任务中心分页每页条数" value={query.size} onChange={(event) => router.history.push(toSettingsTaskCenterUrl({ ...query, page: 0, size: Number(event.target.value) }))}>{PAGE_SIZES.map((size) => <option key={size} value={size}>{size} 条</option>)}</select></label><div className="pagination"><button type="button" disabled={query.page === 0} onClick={() => router.history.push(toSettingsTaskCenterUrl({ ...query, page: query.page - 1 }))}>上一页</button><span>第 {query.page + 1} / {Math.max(state.data.totalPages, 1)} 页</span><button type="button" disabled={query.page + 1 >= state.data.totalPages} onClick={() => router.history.push(toSettingsTaskCenterUrl({ ...query, page: query.page + 1 }))}>下一页</button></div></div>
      </>}
    </section>
    {selectedTask && <div className="warehouse-dialog-backdrop" role="presentation"><section className="warehouse-dialog" role="dialog" aria-modal="true" aria-labelledby="task-center-detail-title"><header className="table-heading"><div><h2 id="task-center-detail-title">{selectedTask.filename}</h2><span>{typeLabel(selectedTask.jobType)} · {statusLabel(selectedTask.status)}</span></div><DialogCloseButton label="关闭任务详情" onClick={() => setSelectedTask(undefined)} /></header><dl className="inventory-count-summary-grid"><div><dt>总数</dt><dd>{selectedTask.requestedCount}</dd></div><div><dt>成功</dt><dd>{selectedTask.succeededCount}</dd></div><div><dt>失败</dt><dd>{selectedTask.failedCount}</dd></div><div><dt>操作人</dt><dd>{selectedTask.createdByDisplayName}</dd></div><div><dt>添加时间</dt><dd>{formatTime(selectedTask.createdAt)}</dd></div><div><dt>完成时间</dt><dd>{formatTime(selectedTask.completedAt)}</dd></div></dl>{selectedTask.safeErrorSummary && <div className="inline-alert" role="alert">{selectedTask.safeErrorSummary}</div>}{selectedTask.resultAvailable && <footer className="form-actions"><button className="button button-primary" type="button" disabled={downloadingId === selectedTask.id} onClick={() => void download(selectedTask)}>{downloadingId === selectedTask.id ? '正在下载…' : '下载结果'}</button></footer>}</section></div>}
  </main>
}
