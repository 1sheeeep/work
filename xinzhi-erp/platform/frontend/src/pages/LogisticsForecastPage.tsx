import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useRouter, useRouterState } from '@tanstack/react-router'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { DialogCloseButton } from '../components/DialogCloseButton'
import {
  logisticsForecastApi,
  type ForecastBatchStatus,
  type LogisticsForecastBatch,
  type LogisticsForecastBatchPage,
} from '../modules/logisticsForecastApi'
import './WarehouseArchiveShells.css'

export type LogisticsForecastStatus = 'HISTORY' | ForecastBatchStatus
export type LogisticsForecastPrintStatus = 'ALL' | 'PRINTED' | 'UNPRINTED'
export type LogisticsForecastQuery = {
  status: LogisticsForecastStatus
  batchType: string
  creator: string
  printStatus: LogisticsForecastPrintStatus
  keyword: string
  forwarder: string
}
const statuses: ReadonlyArray<{ value: LogisticsForecastStatus; label: string }> = [
  { value: 'HISTORY', label: '全部批次' },
  { value: 'FAILED', label: '预报失败' },
  { value: 'SUCCEEDED', label: '预报成功' },
  { value: 'PENDING', label: '待预报' },
]
type State = { status: 'loading' } | { status: 'ready'; data: LogisticsForecastBatchPage }
  | { status: 'error'; message: string }
function boundedText(value: string | null, maximum = 100) {
  return (value ?? '').trim().slice(0, maximum)
}
function forecastStatus(value: string | null): LogisticsForecastStatus {
  return statuses.some((status) => status.value === value)
    ? value as LogisticsForecastStatus : 'HISTORY'
}
function printStatus(value: string | null): LogisticsForecastPrintStatus {
  return value === 'PRINTED' || value === 'UNPRINTED' ? value : 'ALL'
}
function safeMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 409) return '批次状态已变化，请刷新后重试。'
  if (error instanceof ApiError && error.status === 403) return '当前账号没有预报批次管理权限。'
  return '操作未完成，请稍后重试。'
}
export function parseLogisticsForecastQuery(search: string): LogisticsForecastQuery {
  const params = new URLSearchParams(search)
  return {
    status: forecastStatus(params.get('status')),
    batchType: boundedText(params.get('batchType')),
    creator: boundedText(params.get('creator')),
    printStatus: printStatus(params.get('printStatus')),
    keyword: boundedText(params.get('keyword'), 120),
    forwarder: boundedText(params.get('forwarder')),
  }
}
export function toLogisticsForecastUrl(query: Partial<LogisticsForecastQuery>) {
  const params = new URLSearchParams()
  if (query.status && query.status !== 'HISTORY') params.set('status', query.status)
  if (query.batchType) params.set('batchType', boundedText(query.batchType))
  if (query.creator) params.set('creator', boundedText(query.creator))
  if (query.printStatus && query.printStatus !== 'ALL') params.set('printStatus', query.printStatus)
  if (query.keyword) params.set('keyword', boundedText(query.keyword, 120))
  if (query.forwarder) params.set('forwarder', boundedText(query.forwarder))
  const serialized = params.toString()
  return serialized ? `/logistics/forecasts?${serialized}` : '/logistics/forecasts'
}

export function LogisticsForecastPage() {
  const router = useRouter()
  const search = useRouterState({ select: (state) => state.location.searchStr })
  const query = useMemo(() => parseLogisticsForecastQuery(search), [search])
  const { hasPermission } = useAuth()
  const canWrite = hasPermission('logistics.forecast.write')
  const [state, setState] = useState<State>({ status: 'loading' })
  const [open, setOpen] = useState(false)
  const [failureBatch, setFailureBatch] = useState<LogisticsForecastBatch | null>(null)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [refresh, setRefresh] = useState(0)
  const navigate = (next: Partial<LogisticsForecastQuery>) => {
    router.history.push(toLogisticsForecastUrl(next))
  }
  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })
    logisticsForecastApi.list({
      status: query.status,
      batchType: query.batchType || undefined,
      creator: query.creator || undefined,
      printed: query.printStatus === 'ALL' ? undefined : query.printStatus === 'PRINTED',
      keyword: query.keyword || undefined,
      forwarder: query.forwarder || undefined,
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
      batchType: boundedText(String(data.get('batchType') ?? '')),
      creator: boundedText(String(data.get('creator') ?? '')),
      printStatus: printStatus(String(data.get('printStatus') ?? 'ALL')),
      keyword: boundedText(String(data.get('keyword') ?? ''), 120),
      forwarder: boundedText(String(data.get('forwarder') ?? '')),
    })
  }
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const orderReferences = String(data.get('orderReferences') ?? '')
      .split(/[\s,，]+/).map((value) => value.trim()).filter(Boolean)
    setBusy(true); setFeedback('')
    try {
      const created = await logisticsForecastApi.create({
        batchType: boundedText(String(data.get('batchType') ?? ''), 80),
        forwarder: boundedText(String(data.get('forwarder') ?? ''), 120),
        orderReferences,
        totalWeightKg: Number(data.get('totalWeightKg')),
      })
      setOpen(false)
      setFeedback(`预报批次“${created.batchNo}”已创建。`)
      setRefresh((value) => value + 1)
    } catch (error) { setFeedback(safeMessage(error)) } finally { setBusy(false) }
  }
  const updateStatus = async (batch: LogisticsForecastBatch,
    status: ForecastBatchStatus, resultMessage?: string) => {
    setBusy(true); setFeedback('')
    try {
      await logisticsForecastApi.updateStatus(batch.id, batch.version, status, resultMessage)
      setFailureBatch(null)
      setFeedback(`批次“${batch.batchNo}”状态已更新。`)
      setRefresh((value) => value + 1)
    } catch (error) { setFeedback(safeMessage(error)) } finally { setBusy(false) }
  }
  const fail = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!failureBatch) return
    const data = new FormData(event.currentTarget)
    await updateStatus(failureBatch, 'FAILED', boundedText(String(data.get('resultMessage')), 500))
  }
  const markPrinted = async (batch: LogisticsForecastBatch) => {
    setBusy(true); setFeedback('')
    try {
      await logisticsForecastApi.markPrinted(batch.id, batch.version)
      setFeedback(`批次“${batch.batchNo}”已标记为已打印。`)
      setRefresh((value) => value + 1)
    } catch (error) { setFeedback(safeMessage(error)) } finally { setBusy(false) }
  }

  return <main className="warehouse-archive-page" aria-labelledby="logistics-forecast-title">
    <header className="warehouse-archive-heading"><div>
      <p className="eyebrow">物流 / 增值服务</p>
      <h1 id="logistics-forecast-title">物流预报批次</h1>
      <p>建立订单预报批次，并记录货代预报结果和打印状态。</p>
    </div></header>
    <div className="warehouse-archive-tabs" role="tablist" aria-label="预报状态">
      {statuses.map((item) => <button className={query.status === item.value ? 'is-active' : ''}
        key={item.value} type="button" role="tab" aria-selected={query.status === item.value}
        onClick={() => navigate({ ...query, status: item.value })}>{item.label}</button>)}
    </div>
    <section className="warehouse-archive-card" aria-label="预报批次筛选与列表">
      <div className="warehouse-processing-formula" role="note"><strong>处理流程</strong>
        <span>新批次先进入“待预报”；仓库收到货代结果后记录成功或失败，成功批次可标记打印完成。</span></div>
      <form className="warehouse-archive-filters" key={toLogisticsForecastUrl(query)} onSubmit={submit}>
        <label>批次类型<input name="batchType" defaultValue={query.batchType} maxLength={80} placeholder="全部批次类型" /></label>
        <label>创建人<input name="creator" defaultValue={query.creator} maxLength={100} placeholder="全部创建人" /></label>
        <label>打印状态<select name="printStatus" defaultValue={query.printStatus}><option value="ALL">全部打印状态</option><option value="PRINTED">已打印</option><option value="UNPRINTED">未打印</option></select></label>
        <label>订单编号<input name="keyword" defaultValue={query.keyword} maxLength={120} placeholder="输入订单编号" /></label>
        <label>货代<input name="forwarder" defaultValue={query.forwarder} maxLength={120} placeholder="全部货代" /></label>
        <div className="warehouse-archive-filter-actions"><button className="is-primary" type="submit">搜索</button><button type="button" onClick={() => navigate({ status: query.status })}>重置</button></div>
      </form>
      <div className="warehouse-archive-actions">{canWrite ? <button className="is-primary" type="button" disabled={busy} onClick={() => { setFeedback(''); setOpen(true) }}>新增预报批次</button> : null}</div>
      {feedback ? <div className="inline-alert" role="status">{feedback}</div> : null}
      <ForecastTable state={state} canWrite={canWrite} busy={busy}
        updateStatus={updateStatus} markPrinted={markPrinted} setFailureBatch={setFailureBatch} />
    </section>
    {open ? <section className="warehouse-dialog-backdrop" role="presentation"><div className="warehouse-dialog" role="dialog" aria-modal="true" aria-label="新增预报批次">
      <div className="table-heading"><h2>新增预报批次</h2><DialogCloseButton disabled={busy} onClick={() => setOpen(false)} /></div>
      <form onSubmit={(event) => void create(event)}>
        <label>批次类型<input name="batchType" required maxLength={80} placeholder="例如 日常小包" /></label>
        <label>货代<input name="forwarder" required maxLength={120} /></label>
        <label>订单编号<textarea name="orderReferences" required maxLength={2000} placeholder="每行一个，最多 200 个" /></label>
        <label>批次总重量（kg）<input name="totalWeightKg" required type="number" min="0.001" max="999999999.999" step="0.001" /></label>
        <p className="form-hint">系统会自动去除重复订单编号，并生成唯一批次号。</p>
        {feedback ? <div className="inline-alert" role="alert">{feedback}</div> : null}
        <div className="form-actions"><button type="button" onClick={() => setOpen(false)}>取消</button><button className="is-primary" type="submit" disabled={busy}>{busy ? '正在保存…' : '保存'}</button></div>
      </form>
    </div></section> : null}
    {failureBatch ? <section className="warehouse-dialog-backdrop" role="presentation"><div className="warehouse-dialog" role="dialog" aria-modal="true" aria-label="记录预报失败">
      <div className="table-heading"><h2>记录预报失败</h2><DialogCloseButton disabled={busy} onClick={() => setFailureBatch(null)} /></div>
      <form onSubmit={(event) => void fail(event)}><label>失败原因<textarea name="resultMessage" required maxLength={500} /></label>
        <div className="form-actions"><button type="button" onClick={() => setFailureBatch(null)}>取消</button><button className="is-primary" type="submit" disabled={busy}>确认失败</button></div></form>
    </div></section> : null}
  </main>
}

function ForecastTable({ state, canWrite, busy, updateStatus, markPrinted, setFailureBatch }: {
  state: State
  canWrite: boolean
  busy: boolean
  updateStatus: (batch: LogisticsForecastBatch, status: ForecastBatchStatus, resultMessage?: string) => Promise<void>
  markPrinted: (batch: LogisticsForecastBatch) => Promise<void>
  setFailureBatch: (batch: LogisticsForecastBatch) => void
}) {
  if (state.status === 'loading') return <div className="warehouse-archive-empty" role="status"><strong>正在读取预报批次…</strong></div>
  if (state.status === 'error') return <div className="inline-alert" role="alert">{state.message}</div>
  return <div className="warehouse-archive-table-wrap"><table aria-label="预报批次列表"><thead><tr>
    <th>批次号</th><th>批次类型</th><th>订单</th><th>总重量</th><th>货代</th><th>状态</th><th>创建信息</th><th>操作</th>
  </tr></thead><tbody>{state.data.items.length === 0 ? <tr><td colSpan={8}><div className="warehouse-archive-empty" role="status"><strong>暂无预报批次</strong><span>可新增第一个预报批次。</span></div></td></tr> : state.data.items.map((batch) => <tr key={batch.id}>
    <td><strong>{batch.batchNo}</strong></td><td>{batch.batchType}</td><td>{batch.orderCount} 单<span>{batch.orderReferences.slice(0, 3).join('、')}</span></td><td>{batch.totalWeightKg.toFixed(3)} kg</td><td>{batch.forwarder}</td>
    <td>{batch.status === 'PENDING' ? '待预报' : batch.status === 'SUCCEEDED' ? (batch.printed ? '成功 · 已打印' : '成功 · 未打印') : `失败 · ${batch.resultMessage ?? ''}`}</td>
    <td>{batch.createdByDisplayName}<span>{new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(batch.createdAt))}</span></td>
    <td>{canWrite ? <div className="warehouse-archive-row-actions">
      {batch.status === 'PENDING' ? <><button className="text-button" type="button" disabled={busy} onClick={() => void updateStatus(batch, 'SUCCEEDED')}>记录成功</button><button className="text-button" type="button" disabled={busy} onClick={() => setFailureBatch(batch)}>记录失败</button></> : null}
      {batch.status === 'FAILED' ? <button className="text-button" type="button" disabled={busy} onClick={() => void updateStatus(batch, 'PENDING')}>重新预报</button> : null}
      {batch.status === 'SUCCEEDED' && !batch.printed ? <button className="text-button" type="button" disabled={busy} onClick={() => void markPrinted(batch)}>标记已打印</button> : null}
      {batch.status === 'SUCCEEDED' && batch.printed ? '—' : null}
    </div> : '—'}</td>
  </tr>)}</tbody></table></div>
}
