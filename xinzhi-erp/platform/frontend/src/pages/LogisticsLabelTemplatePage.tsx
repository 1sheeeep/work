import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useRouter, useRouterState } from '@tanstack/react-router'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { DialogCloseButton } from '../components/DialogCloseButton'
import {
  labelTemplateApi,
  type LabelTemplate,
  type LabelTemplatePage,
  type LabelTemplateScope,
} from '../modules/labelTemplateApi'
import './WarehouseArchiveShells.css'

export type { LabelTemplateScope }
export type LabelTemplateQuery = {
  scope: LabelTemplateScope
  documentCategory: string
  size: string
  keyword: string
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; data: LabelTemplatePage }
  | { status: 'error'; message: string }

function boundedText(value: string | null, maximum = 100) {
  return (value ?? '').trim().slice(0, maximum)
}

function templateScope(value: string | null): LabelTemplateScope {
  return value === 'CUSTOM' ? value : 'STANDARD'
}

function safeMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 409) {
    return '模板名称已存在或记录已经变化，请刷新后重试。'
  }
  if (error instanceof ApiError && error.status === 403) {
    return '当前账号没有自定义标签模板管理权限。'
  }
  if (error instanceof Error && !(error instanceof ApiError)) return error.message
  return '操作未完成，请稍后重试。'
}

export function parseLabelTemplateQuery(search: string): LabelTemplateQuery {
  const params = new URLSearchParams(search)
  return {
    scope: templateScope(params.get('scope')),
    documentCategory: boundedText(params.get('documentCategory'), 80),
    size: boundedText(params.get('size'), 40),
    keyword: boundedText(params.get('keyword'), 120),
  }
}

export function toLabelTemplateUrl(query: Partial<LabelTemplateQuery>) {
  const params = new URLSearchParams()
  if (query.scope === 'CUSTOM') params.set('scope', query.scope)
  if (query.documentCategory) params.set('documentCategory', boundedText(query.documentCategory, 80))
  if (query.size) params.set('size', boundedText(query.size, 40))
  if (query.keyword) params.set('keyword', boundedText(query.keyword, 120))
  const serialized = params.toString()
  return serialized ? `/logistics/label-templates?${serialized}` : '/logistics/label-templates'
}

export function LogisticsLabelTemplatePage() {
  const router = useRouter()
  const search = useRouterState({ select: (state) => state.location.searchStr })
  const query = useMemo(() => parseLabelTemplateQuery(search), [search])
  const { hasPermission } = useAuth()
  const canWrite = hasPermission('logistics.label_template.write')
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [formOpen, setFormOpen] = useState(false)
  const [preview, setPreview] = useState<LabelTemplate>()
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const navigate = (next: Partial<LabelTemplateQuery>) => router.history.push(toLabelTemplateUrl(next))

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })
    labelTemplateApi.list({
      scope: query.scope,
      documentCategory: query.documentCategory || undefined,
      size: query.size || undefined,
      keyword: query.keyword || undefined,
      page: 0,
      pageSize: 100,
      signal: controller.signal,
    }).then((data) => setState({ status: 'ready', data }))
      .catch((error) => {
        if (!controller.signal.aborted) setState({ status: 'error', message: safeMessage(error) })
      })
    return () => controller.abort()
  }, [query.scope, query.documentCategory, query.size, query.keyword, refreshKey])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    navigate({
      scope: query.scope,
      documentCategory: boundedText(String(data.get('documentCategory') ?? ''), 80),
      size: boundedText(String(data.get('size') ?? ''), 40),
      keyword: boundedText(String(data.get('keyword') ?? ''), 120),
    })
  }

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const widthMm = Number(data.get('widthMm'))
    const heightMm = Number(data.get('heightMm'))
    if (!Number.isSafeInteger(widthMm) || widthMm < 20 || widthMm > 300
      || !Number.isSafeInteger(heightMm) || heightMm < 20 || heightMm > 300) {
      setFeedback('标签宽度和高度应为 20–300 毫米的整数。')
      return
    }
    setBusy(true)
    setFeedback('')
    try {
      const created = await labelTemplateApi.create({
        name: boundedText(String(data.get('name')), 120),
        documentCategory: boundedText(String(data.get('documentCategory')), 80),
        widthMm,
        heightMm,
        content: boundedText(String(data.get('content')), 4000),
        note: boundedText(String(data.get('note')), 500) || undefined,
      })
      setFormOpen(false)
      setFeedback(`模板“${created.name}”已创建。`)
      setRefreshKey((value) => value + 1)
    } catch (error) {
      setFeedback(safeMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const archive = async (item: LabelTemplate) => {
    if (!window.confirm(`停用自定义模板“${item.name}”？`)) return
    setBusy(true)
    setFeedback('')
    try {
      await labelTemplateApi.archive(item.id, item.version)
      setFeedback(`模板“${item.name}”已停用。`)
      setRefreshKey((value) => value + 1)
    } catch (error) {
      setFeedback(safeMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="warehouse-archive-page" aria-labelledby="label-template-title">
      <header className="warehouse-archive-heading">
        <div>
          <p className="eyebrow">物流 / 物流管理</p>
          <h1 id="label-template-title">标签模板</h1>
          <p>查看内置模板，维护自定义标签内容并在打印前预览。</p>
        </div>
      </header>
      <div className="warehouse-archive-tabs" role="tablist" aria-label="模板范围">
        <button className={query.scope === 'STANDARD' ? 'is-active' : ''} type="button" role="tab" aria-selected={query.scope === 'STANDARD'} onClick={() => navigate({ scope: 'STANDARD' })}>标准模板</button>
        <button className={query.scope === 'CUSTOM' ? 'is-active' : ''} type="button" role="tab" aria-selected={query.scope === 'CUSTOM'} onClick={() => navigate({ scope: 'CUSTOM' })}>自定义模板</button>
      </div>
      <section className="warehouse-archive-card" aria-label="标签模板筛选与列表">
        <div className="warehouse-processing-formula" role="note">
          <strong>可用变量</strong>
          <span>{'{{recipient}}、{{address}}、{{order_number}}、{{name}}、{{sku}}；打印时由业务数据替换。'}</span>
        </div>
        <form className="warehouse-archive-filters" key={toLabelTemplateUrl(query)} onSubmit={submit}>
          <label>单据类别<input name="documentCategory" defaultValue={query.documentCategory} maxLength={80} placeholder="全部单据类别" /></label>
          <label>规格<input name="size" defaultValue={query.size} maxLength={40} placeholder="例如 100×100 mm" /></label>
          <label>模板名称<input name="keyword" defaultValue={query.keyword} maxLength={120} placeholder="请输入关键词" /></label>
          <div className="warehouse-archive-filter-actions"><button className="is-primary" type="submit">搜索</button><button type="button" onClick={() => navigate({ scope: query.scope })}>重置</button></div>
        </form>
        <div className="warehouse-archive-actions">
          {canWrite && query.scope === 'CUSTOM' ? <button className="is-primary" type="button" disabled={busy} onClick={() => { setFeedback(''); setFormOpen(true) }}>新增自定义模板</button> : null}
        </div>
        {feedback ? <div className="inline-alert" role="status">{feedback}</div> : null}
        <TemplateTable state={state} canWrite={canWrite} busy={busy} preview={setPreview} archive={archive} />
      </section>
      {formOpen ? (
        <TemplateDialog title="新增自定义模板" busy={busy} close={() => setFormOpen(false)}>
          <form onSubmit={(event) => void create(event)}>
            <label>模板名称<input name="name" required maxLength={120} autoFocus /></label>
            <label>单据类别<input name="documentCategory" required maxLength={80} placeholder="例如：地址标签" /></label>
            <label>宽度（mm）<input name="widthMm" type="number" required min={20} max={300} defaultValue={100} /></label>
            <label>高度（mm）<input name="heightMm" type="number" required min={20} max={300} defaultValue={100} /></label>
            <label>标签内容<textarea name="content" required maxLength={4000} rows={8} placeholder={'收件人：{{recipient}}\n地址：{{address}}'} /></label>
            <label>备注（可选）<textarea name="note" maxLength={500} rows={3} /></label>
            {feedback ? <div className="inline-alert" role="alert">{feedback}</div> : null}
            <div className="form-actions"><button type="button" disabled={busy} onClick={() => setFormOpen(false)}>取消</button><button className="is-primary" type="submit" disabled={busy}>{busy ? '正在保存…' : '保存模板'}</button></div>
          </form>
        </TemplateDialog>
      ) : null}
      {preview ? (
        <TemplateDialog title="标签预览" busy={false} close={() => setPreview(undefined)}>
          <div className="label-template-preview-meta"><strong>{preview.name}</strong><span>{preview.documentCategory} · {preview.widthMm}×{preview.heightMm} mm</span></div>
          <div className="label-template-preview-sheet" style={{ aspectRatio: `${preview.widthMm} / ${preview.heightMm}` }}>{preview.content}</div>
          <div className="form-actions"><button type="button" onClick={() => setPreview(undefined)}>关闭</button><button className="is-primary" type="button" onClick={() => window.print()}>打印</button></div>
        </TemplateDialog>
      ) : null}
    </main>
  )
}

function TemplateTable({ state, canWrite, busy, preview, archive }: { state: LoadState; canWrite: boolean; busy: boolean; preview: (item: LabelTemplate) => void; archive: (item: LabelTemplate) => Promise<void> }) {
  if (state.status === 'loading') return <div className="warehouse-archive-empty" role="status"><strong>正在读取标签模板…</strong></div>
  if (state.status === 'error') return <div className="inline-alert" role="alert">{state.message}</div>
  return <div className="warehouse-archive-table-wrap"><table aria-label="标签模板列表"><thead><tr><th>模板名称</th><th>单据类别</th><th>规格</th><th>来源</th><th>创建人</th><th>操作</th></tr></thead><tbody>{state.data.items.length === 0 ? <tr><td colSpan={6}><div className="warehouse-archive-empty" role="status"><strong>暂无标签模板</strong><span>可调整条件，或新增自定义模板。</span></div></td></tr> : state.data.items.map((item) => <tr key={item.id}><td><strong>{item.name}</strong>{item.note ? <div>{item.note}</div> : null}</td><td>{item.documentCategory}</td><td>{item.widthMm}×{item.heightMm} mm</td><td>{item.scope === 'STANDARD' ? '系统内置' : '自定义'}</td><td>{item.createdByDisplayName}</td><td><button className="text-button" type="button" onClick={() => preview(item)}>预览</button>{canWrite && item.scope === 'CUSTOM' ? <button className="text-button" type="button" disabled={busy} onClick={() => void archive(item)}>停用</button> : null}</td></tr>)}</tbody></table></div>
}

function TemplateDialog({ title, busy, close, children }: { title: string; busy: boolean; close: () => void; children: React.ReactNode }) {
  return <section className="warehouse-dialog-backdrop" role="presentation"><div className="warehouse-dialog" role="dialog" aria-modal="true" aria-label={title}><div className="table-heading"><h2>{title}</h2><DialogCloseButton disabled={busy} onClick={close} /></div>{children}</div></section>
}
