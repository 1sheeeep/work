import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useRouter, useRouterState } from '@tanstack/react-router'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { DialogCloseButton } from '../components/DialogCloseButton'
import { SettingsPageHeader } from '../components/SettingsPageLayout'
import {
  approvalDocumentTypes,
  approvalRuleApi,
  type ApprovalDocumentType,
  type ApprovalRule,
  type ApprovalRuleInput,
  type ApprovalRulePage,
  type ApprovalRuleQuery,
  type ApproverCandidate,
} from '../modules/approvalRuleApi'
import './WarehouseArchiveShells.css'

const PATH = '/settings/parameters/approval-rules'
const PAGE_SIZES = [25, 50, 100] as const
const TYPE_LABELS: Record<ApprovalDocumentType, string> = {
  PROCUREMENT_ORDER: '采购单审核',
  INVENTORY_COUNT: '库存盘点',
  WAREHOUSE_TRANSFER: '分仓调拨',
  MANUAL_INBOUND: '手工入库审核',
  MANUAL_OUTBOUND: '手工出库审核',
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; page: ApprovalRulePage; candidates: ApproverCandidate[] }

function bounded(value: string | null, max = 120) {
  return (value ?? '').trim().slice(0, max)
}

export function parseApprovalRuleQuery(search: string): ApprovalRuleQuery {
  const parameters = new URLSearchParams(search)
  const rawType = parameters.get('documentType')
  const rawStatus = parameters.get('enabled')
  const rawSize = Number.parseInt(parameters.get('size') ?? '25', 10)
  return {
    enabled: rawStatus === 'true' ? true : rawStatus === 'false' ? false : undefined,
    documentType: approvalDocumentTypes.includes(rawType as ApprovalDocumentType)
      ? rawType as ApprovalDocumentType
      : undefined,
    keyword: bounded(parameters.get('keyword')) || undefined,
    page: Math.max(0, Number.parseInt(parameters.get('page') ?? '0', 10) || 0),
    size: PAGE_SIZES.includes(rawSize as typeof PAGE_SIZES[number])
      ? rawSize as typeof PAGE_SIZES[number]
      : 25,
  }
}

function toUrl(query: ApprovalRuleQuery) {
  const parameters = new URLSearchParams()
  if (query.enabled !== undefined) parameters.set('enabled', String(query.enabled))
  if (query.documentType) parameters.set('documentType', query.documentType)
  if (query.keyword) parameters.set('keyword', query.keyword)
  if ((query.page ?? 0) > 0) parameters.set('page', String(query.page))
  if ((query.size ?? 25) !== 25) parameters.set('size', String(query.size))
  return parameters.size ? `${PATH}?${parameters}` : PATH
}

function actionError(error: unknown) {
  if (error instanceof ApiError && error.status === 409) {
    return '规则名称已存在，或记录刚被其他人更新。请刷新后重试。'
  }
  if (error instanceof ApiError && error.status === 403) {
    return '当前账号没有维护业务参数的权限。'
  }
  return '操作失败，请检查规则内容和审批人后重试。'
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value))
}

export function SettingsApprovalRulesPage() {
  const router = useRouter()
  const search = useRouterState({ select: (state) => state.location.searchStr })
  const query = useMemo(() => parseApprovalRuleQuery(search), [search])
  const { hasPermission } = useAuth()
  const canWrite = hasPermission('settings.parameter.write')
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [reload, setReload] = useState(0)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string }>()
  const [editor, setEditor] = useState<ApprovalRule | 'new'>()
  const [removing, setRemoving] = useState<ApprovalRule>()

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })
    void Promise.all([
      approvalRuleApi.list(query, controller.signal),
      approvalRuleApi.candidates(controller.signal),
    ]).then(
      ([page, candidates]) => setState({ status: 'ready', page, candidates }),
      () => {
        if (!controller.signal.aborted) setState({ status: 'error' })
      },
    )
    return () => controller.abort()
  }, [query, reload])

  const navigate = (patch: Partial<ApprovalRuleQuery>) => {
    router.history.push(toUrl({ ...query, ...patch }))
  }

  const filter = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const type = String(data.get('documentType'))
    const status = String(data.get('enabled'))
    navigate({
      enabled: status === 'true' ? true : status === 'false' ? false : undefined,
      documentType: approvalDocumentTypes.includes(type as ApprovalDocumentType)
        ? type as ApprovalDocumentType
        : undefined,
      keyword: bounded(String(data.get('keyword') ?? '')) || undefined,
      page: 0,
    })
  }

  const save = async (item: ApprovalRule | 'new', input: ApprovalRuleInput) => {
    setBusy(true)
    setFeedback(undefined)
    try {
      if (item === 'new') await approvalRuleApi.create(input)
      else await approvalRuleApi.update(item.id, item.version, input)
      setEditor(undefined)
      setFeedback({
        kind: 'success',
        message: item === 'new' ? '审批规则已新增。' : '审批规则已更新。',
      })
      setReload((value) => value + 1)
    } catch (error) {
      setFeedback({ kind: 'error', message: actionError(error) })
    } finally {
      setBusy(false)
    }
  }

  const changeStatus = async (item: ApprovalRule) => {
    setBusy(true)
    setFeedback(undefined)
    try {
      await approvalRuleApi.setEnabled(item.id, item.version, !item.enabled)
      setFeedback({
        kind: 'success',
        message: item.enabled ? '审批规则已停用。' : '审批规则已启用。',
      })
      setReload((value) => value + 1)
    } catch (error) {
      setFeedback({ kind: 'error', message: actionError(error) })
    } finally {
      setBusy(false)
    }
  }

  const remove = async (item: ApprovalRule) => {
    setBusy(true)
    setFeedback(undefined)
    try {
      await approvalRuleApi.remove(item.id, item.version)
      setRemoving(undefined)
      setFeedback({ kind: 'success', message: '审批规则已删除。' })
      setReload((value) => value + 1)
    } catch (error) {
      setFeedback({ kind: 'error', message: actionError(error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="warehouse-archive-page settings-page" aria-labelledby="settings-approval-rules-title">
      <SettingsPageHeader id="settings-approval-rules-title" section="参数设置" title="审批规则设置" description="按单据类型维护审批顺序和审批人员。" />

      <section className="warehouse-archive-card" aria-label="审批规则筛选与结果">
        <div className="warehouse-processing-formula" role="note">
          <strong>优先级规则</strong>
          <span>1 级优先级最高；优先级相同时，创建时间较早的规则排在前面。每条规则支持 1–5 位审批人。</span>
        </div>

        <form
          className="warehouse-archive-filters procurement-plan-filters"
          key={toUrl(query)}
          onSubmit={filter}
        >
          <label>
            状态
            <select name="enabled" defaultValue={query.enabled === undefined ? '' : String(query.enabled)}>
              <option value="">全部状态</option>
              <option value="true">启用</option>
              <option value="false">停用</option>
            </select>
          </label>
          <label>
            单据类型
            <select name="documentType" defaultValue={query.documentType ?? ''}>
              <option value="">全部单据类型</option>
              {approvalDocumentTypes.map((type) => (
                <option key={type} value={type}>{TYPE_LABELS[type]}</option>
              ))}
            </select>
          </label>
          <label>
            规则名称
            <input
              name="keyword"
              defaultValue={query.keyword ?? ''}
              maxLength={120}
              placeholder="规则名称或说明"
            />
          </label>
          <div className="warehouse-archive-filter-actions">
            <button className="is-primary" type="submit">搜索</button>
            <button type="button" onClick={() => router.history.push(PATH)}>重置</button>
            <button type="button" onClick={() => setReload((value) => value + 1)}>刷新</button>
          </div>
        </form>

        <div className="warehouse-archive-actions">
          {canWrite && (
            <button
              className="is-primary"
              type="button"
              disabled={busy || state.status !== 'ready' || state.candidates.length === 0}
              onClick={() => setEditor('new')}
            >
              新增规则
            </button>
          )}
        </div>

        {feedback && (
          <p
            className={`warehouse-export-feedback is-${feedback.kind}`}
            role={feedback.kind === 'error' ? 'alert' : 'status'}
          >
            {feedback.message}
          </p>
        )}

        {state.status === 'loading' && <p role="status">正在读取审批规则…</p>}
        {state.status === 'error' && (
          <div className="warehouse-archive-empty" role="alert">
            <strong>无法读取审批规则</strong>
            <span>请稍后重试。</span>
            <button className="text-button" type="button" onClick={() => setReload((value) => value + 1)}>
              重试
            </button>
          </div>
        )}
        {state.status === 'ready' && (
          <>
            <RuleTable
              page={state.page}
              canWrite={canWrite}
              busy={busy}
              edit={setEditor}
              changeStatus={changeStatus}
              remove={setRemoving}
            />
            {state.page.totalPages > 0 && (
              <nav className="pagination" aria-label="审批规则分页">
                <span>共 {state.page.totalElements} 条</span>
                <label>
                  每页
                  <select
                    value={query.size ?? 25}
                    onChange={(event) => navigate({
                      size: Number(event.target.value) as 25 | 50 | 100,
                      page: 0,
                    })}
                  >
                    {PAGE_SIZES.map((size) => <option key={size} value={size}>{size} 条</option>)}
                  </select>
                </label>
                <button
                  type="button"
                  disabled={(query.page ?? 0) === 0}
                  onClick={() => navigate({ page: (query.page ?? 0) - 1 })}
                >
                  上一页
                </button>
                <span>{(query.page ?? 0) + 1} / {state.page.totalPages}</span>
                <button
                  type="button"
                  disabled={(query.page ?? 0) + 1 >= state.page.totalPages}
                  onClick={() => navigate({ page: (query.page ?? 0) + 1 })}
                >
                  下一页
                </button>
              </nav>
            )}
          </>
        )}
      </section>

      {editor && state.status === 'ready' && (
        <RuleEditor
          item={editor}
          candidates={state.candidates}
          busy={busy}
          close={() => setEditor(undefined)}
          save={save}
          error={feedback?.kind === 'error' ? feedback.message : undefined}
        />
      )}
      {removing && (
        <RemoveRuleDialog
          item={removing}
          busy={busy}
          close={() => setRemoving(undefined)}
          confirm={() => void remove(removing)}
          error={feedback?.kind === 'error' ? feedback.message : undefined}
        />
      )}
    </main>
  )
}

function RuleTable({
  page,
  canWrite,
  busy,
  edit,
  changeStatus,
  remove,
}: {
  page: ApprovalRulePage
  canWrite: boolean
  busy: boolean
  edit: (item: ApprovalRule) => void
  changeStatus: (item: ApprovalRule) => Promise<void>
  remove: (item: ApprovalRule) => void
}) {
  return (
    <div className="warehouse-archive-table-wrap">
      <table aria-label="审批规则">
        <thead>
          <tr>
            <th>优先级</th>
            <th>规则名称</th>
            <th>类型</th>
            <th>备注</th>
            <th>状态</th>
            <th>创建人员</th>
            <th>时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {page.items.length === 0 ? (
            <tr>
              <td colSpan={8}>
                <div className="warehouse-archive-empty" role="status">
                  <strong>暂无审批规则</strong>
                  <span>可新增第一条审批规则。</span>
                </div>
              </td>
            </tr>
          ) : page.items.map((item) => (
            <tr key={item.id}>
              <td>{item.priority}</td>
              <td>
                <strong>{item.name}</strong>
                <small className="table-secondary-text">
                  {item.approvers.map((value) => value.displayName).join(' → ')}
                </small>
              </td>
              <td>{TYPE_LABELS[item.documentType]}</td>
              <td>{item.description ?? '—'}</td>
              <td>
                <span className={item.enabled ? 'status-badge is-success' : 'status-badge'}>
                  {item.enabled ? '启用' : '停用'}
                </span>
              </td>
              <td>{item.createdByDisplayName}</td>
              <td><time dateTime={item.createdAt}>{formatTime(item.createdAt)}</time></td>
              <td>
                {canWrite ? (
                  <span className="table-row-actions">
                    <button className="text-button" type="button" disabled={busy} onClick={() => edit(item)}>
                      编辑
                    </button>
                    <button className="text-button" type="button" disabled={busy} onClick={() => void changeStatus(item)}>
                      {item.enabled ? '停用' : '启用'}
                    </button>
                    <button className="text-button is-danger" type="button" disabled={busy} onClick={() => remove(item)}>
                      删除
                    </button>
                  </span>
                ) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RuleEditor({
  item,
  candidates,
  busy,
  close,
  save,
  error,
}: {
  item: ApprovalRule | 'new'
  candidates: ApproverCandidate[]
  busy: boolean
  close: () => void
  save: (item: ApprovalRule | 'new', input: ApprovalRuleInput) => Promise<void>
  error?: string
}) {
  const current = item === 'new' ? undefined : item
  const [approvers, setApprovers] = useState<string[]>(
    current?.approvers.map((value) => value.userId) ?? [],
  )
  const [candidate, setCandidate] = useState('')
  const nameFor = (id: string) => (
    candidates.find((value) => value.userId === id)?.displayName ?? '已停用成员'
  )
  const move = (index: number, offset: -1 | 1) => {
    setApprovers((values) => {
      const target = index + offset
      if (target < 0 || target >= values.length) return values
      const next = [...values]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!approvers.length) return
    const data = new FormData(event.currentTarget)
    void save(item, {
      priority: Number(data.get('priority')),
      name: String(data.get('name') ?? ''),
      documentType: String(data.get('documentType')) as ApprovalDocumentType,
      description: String(data.get('description') ?? ''),
      enabled: data.get('enabled') === 'on',
      approverUserIds: approvers,
    })
  }
  const title = current ? '编辑审批规则' : '新增审批规则'

  return (
    <section className="warehouse-dialog-backdrop" role="presentation">
      <section className="warehouse-dialog settings-approval-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <header className="table-heading">
          <div>
            <h2>{title}</h2>
            <p>审批人按列表顺序依次处理，最多 5 位。</p>
          </div>
          <DialogCloseButton disabled={busy} onClick={close} />
        </header>
        <form onSubmit={submit}>
          <div className="warehouse-dialog-grid">
            <label>
              规则名称
              <input name="name" required maxLength={120} defaultValue={current?.name ?? ''} placeholder="例如：采购单复核" />
            </label>
            <label>
              单据类型
              <select name="documentType" defaultValue={current?.documentType ?? 'PROCUREMENT_ORDER'}>
                {approvalDocumentTypes.map((type) => (
                  <option key={type} value={type}>{TYPE_LABELS[type]}</option>
                ))}
              </select>
            </label>
            <label>
              优先级
              <select name="priority" defaultValue={current?.priority ?? 1}>
                {Array.from({ length: 10 }, (_, index) => (
                  <option key={index + 1} value={index + 1}>{index + 1} 级</option>
                ))}
              </select>
            </label>
            <label className="warehouse-archive-checkbox">
              <input name="enabled" type="checkbox" defaultChecked={current?.enabled ?? true} />
              启用此规则
            </label>
          </div>
          <label>
            备注
            <textarea
              name="description"
              maxLength={500}
              defaultValue={current?.description ?? ''}
              placeholder="说明该规则的适用场景"
            />
          </label>
          <fieldset className="settings-approver-fieldset">
            <legend>审批人顺序</legend>
            <div className="settings-approver-add">
              <select aria-label="待添加审批人" value={candidate} onChange={(event) => setCandidate(event.target.value)}>
                <option value="">选择审批人</option>
                {candidates.filter((value) => !approvers.includes(value.userId)).map((value) => (
                  <option key={value.userId} value={value.userId}>{value.displayName}</option>
                ))}
              </select>
              <button
                type="button"
                disabled={!candidate || approvers.length >= 5}
                onClick={() => {
                  setApprovers((values) => [...values, candidate])
                  setCandidate('')
                }}
              >
                添加
              </button>
            </div>
            {approvers.length === 0 ? (
              <p className="form-help" role="status">请至少添加 1 位审批人。</p>
            ) : (
              <ol className="settings-approver-list">
                {approvers.map((id, index) => (
                  <li key={id}>
                    <span><strong>{index + 1}</strong>{nameFor(id)}</span>
                    <span className="table-row-actions">
                      <button className="text-button" type="button" disabled={index === 0} onClick={() => move(index, -1)}>上移</button>
                      <button className="text-button" type="button" disabled={index === approvers.length - 1} onClick={() => move(index, 1)}>下移</button>
                      <button className="text-button is-danger" type="button" onClick={() => setApprovers((values) => values.filter((value) => value !== id))}>移除</button>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </fieldset>
          {error && <div className="inline-alert" role="alert">{error}</div>}
          <div className="form-actions">
            <button type="button" disabled={busy} onClick={close}>取消</button>
            <button className="is-primary" type="submit" disabled={busy || approvers.length === 0}>
              {busy ? '正在保存…' : '保存规则'}
            </button>
          </div>
        </form>
      </section>
    </section>
  )
}

function RemoveRuleDialog({
  item,
  busy,
  close,
  confirm,
  error,
}: {
  item: ApprovalRule
  busy: boolean
  close: () => void
  confirm: () => void
  error?: string
}) {
  return (
    <section className="warehouse-dialog-backdrop" role="presentation">
      <section className="warehouse-dialog warehouse-confirm-dialog" role="alertdialog" aria-modal="true" aria-label="删除审批规则">
        <header className="table-heading">
          <div><h2>删除审批规则</h2><p>{item.name}</p></div>
          <DialogCloseButton disabled={busy} onClick={close} />
        </header>
        <div className="warehouse-confirm-body">
          <p>删除后无法恢复。已有单据记录不会被删除。</p>
          {error && <div className="inline-alert" role="alert">{error}</div>}
        </div>
        <footer className="warehouse-confirm-actions">
          <button type="button" disabled={busy} onClick={close}>返回</button>
          <button className="is-danger" type="button" disabled={busy} onClick={confirm}>
            {busy ? '正在删除…' : '确认删除'}
          </button>
        </footer>
      </section>
    </section>
  )
}
