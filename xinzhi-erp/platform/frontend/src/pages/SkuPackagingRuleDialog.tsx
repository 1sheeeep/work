import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../api/client'
import { DialogCloseButton } from '../components/DialogCloseButton'
import {
  type PackagingRule,
  type PackagingRuleStatus,
  type PackagingTemplate,
  shippingConfigurationApi,
} from '../modules/shippingConfigurationApi'
import type { ProductSku } from '../modules/productCenterApi'

type Data = { rules: PackagingRule[]; templates: PackagingTemplate[] }
type State =
  | { status: 'loading' }
  | { status: 'ready'; data: Data }
  | { status: 'error'; message: string }

function safeMessage(error: unknown, action: string) {
  if (error instanceof ApiError && error.status === 403) {
    return `当前账号没有${action}所需权限。`
  }
  if (error instanceof ApiError && error.status === 404) {
    return 'SKU、发货包装模板或规则不存在，可能已被其他操作更新。'
  }
  if (error instanceof ApiError && error.status === 409) {
    return '数量区间与现有启用规则重叠，或规则已更新。请刷新后重试。'
  }
  return `暂时无法${action}，请稍后重试。`
}

function quantity(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim()
  if (!/^\d+$/.test(text)) return null
  const parsed = Number(text)
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 999_999
    ? parsed
    : null
}

function overlaps(
  rules: PackagingRule[],
  minimum: number,
  maximum: number,
  excludedId?: string,
) {
  return rules.some(
    (rule) =>
      rule.id !== excludedId &&
      rule.status === 'ACTIVE' &&
      rule.minQuantity <= maximum &&
      rule.maxQuantity >= minimum,
  )
}

export function SkuPackagingRuleDialog({
  sku,
  canWrite,
  onClose,
}: {
  sku: ProductSku
  canWrite: boolean
  onClose: () => void
}) {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [editing, setEditing] = useState<PackagingRule | null>(null)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{
    kind: 'success' | 'error'
    message: string
  } | null>(null)
  const request = useRef(0)
  const dialog = useRef<HTMLElement>(null)
  const busyRef = useRef(false)

  useEffect(() => {
    busyRef.current = busy
  }, [busy])

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    const node = dialog.current
    const focusable = () =>
      Array.from(
        node?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      )
    focusable()[0]?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const candidates = focusable()
      if (candidates.length === 0) {
        event.preventDefault()
        return
      }
      const first = candidates[0]
      const last = candidates[candidates.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previousFocus?.focus()
    }
  }, [onClose])

  const load = useCallback(async () => {
    const current = ++request.current
    setState({ status: 'loading' })
    setFeedback(null)
    try {
      const [rules, templates] = await Promise.all([
        shippingConfigurationApi.listRules(sku.id),
        shippingConfigurationApi.listTemplates(),
      ])
      if (current === request.current) {
        setState({ status: 'ready', data: { rules, templates } })
      }
    } catch (error) {
      if (current === request.current) {
        setState({
          status: 'error',
          message: safeMessage(error, '读取 SKU 发货包装规则'),
        })
      }
    }
  }, [sku.id])

  useEffect(() => {
    void load()
    return () => {
      request.current += 1
    }
  }, [load])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (state.status !== 'ready') return
    const form = new FormData(event.currentTarget)
    const minQuantity = quantity(form.get('minQuantity'))
    const maxQuantity = quantity(form.get('maxQuantity'))
    const packagingTemplateId = String(form.get('packagingTemplateId') ?? '')
    const status = (editing
      ? String(form.get('status'))
      : 'ACTIVE') as PackagingRuleStatus
    if (
      minQuantity === null ||
      maxQuantity === null ||
      maxQuantity < minQuantity ||
      !state.data.templates.some((item) => item.id === packagingTemplateId)
    ) {
      setFeedback({
        kind: 'error',
        message: '请填写 1–999999 的有效数量区间并选择发货包装模板。',
      })
      return
    }
    if (
      status === 'ACTIVE' &&
      overlaps(
        state.data.rules,
        minQuantity,
        maxQuantity,
        editing?.id,
      )
    ) {
      setFeedback({
        kind: 'error',
        message: '该数量区间与现有启用规则重叠，请先调整或停用原规则。',
      })
      return
    }
    setBusy(true)
    setFeedback(null)
    try {
      if (editing) {
        await shippingConfigurationApi.updateRule(sku.id, editing.id, {
          version: editing.version,
          minQuantity,
          maxQuantity,
          packagingTemplateId,
          status,
        })
      } else {
        await shippingConfigurationApi.createRule(sku.id, {
          minQuantity,
          maxQuantity,
          packagingTemplateId,
        })
      }
      const message = editing ? '发货包装规则已更新。' : '发货包装规则已创建。'
      setEditing(null)
      await load()
      setFeedback({ kind: 'success', message })
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: safeMessage(error, editing ? '更新发货包装规则' : '创建发货包装规则'),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        ref={dialog}
        className="write-dialog sku-packaging-rule-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sku-packaging-rule-title"
      >
        <header className="table-heading">
          <div>
            <p className="eyebrow">商品 / SKU 发货包装规则</p>
            <h2 id="sku-packaging-rule-title">{sku.businessCode}</h2>
            <p>{sku.name} · 按订购数量自动选择发货包装。</p>
          </div>
          <DialogCloseButton disabled={busy} onClick={onClose} />
        </header>

        {feedback && (
          <div className={feedback.kind === 'error' ? 'inline-alert' : 'warehouse-success'} role={feedback.kind === 'error' ? 'alert' : 'status'}>
            {feedback.message}
          </div>
        )}
        {state.status === 'loading' && <p aria-busy="true">正在读取发货包装规则…</p>}
        {state.status === 'error' && (
          <div className="compact-empty-state" role="alert">
            <strong>无法读取规则</strong><span>{state.message}</span>
            <button className="text-button" type="button" onClick={() => void load()}>重试</button>
          </div>
        )}
        {state.status === 'ready' && (
          <>
            <div className="shipping-configuration-table-scroll">
              <table className="shop-table">
                <caption className="sr-only">{sku.businessCode} 发货包装规则</caption>
                <thead><tr><th>数量区间</th><th>发货包装</th><th>状态</th><th>更新时间</th><th>操作</th></tr></thead>
                <tbody>{state.data.rules.map((rule) => <tr key={rule.id}><td>{rule.minQuantity}–{rule.maxQuantity}</td><td><code>{rule.packagingCode}</code><br />{rule.packagingName}</td><td>{rule.status === 'ACTIVE' ? '启用' : '停用'}</td><td>{new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(rule.updatedAt))}</td><td>{canWrite ? <button className="text-button" type="button" disabled={busy} onClick={() => setEditing(rule)}>编辑</button> : <span>—</span>}</td></tr>)}</tbody>
              </table>
            </div>
            {state.data.rules.length === 0 && <div className="compact-empty-state"><strong>暂无发货包装规则</strong><span>没有匹配规则时，请手动选择发货包装。</span></div>}
            {canWrite && (
              <form className="sku-packaging-rule-form" key={editing?.id ?? 'new'} onSubmit={submit}>
                <h3>{editing ? '编辑数量区间规则' : '新增数量区间规则'}</h3>
                <label>最小数量<input name="minQuantity" required inputMode="numeric" defaultValue={editing?.minQuantity ?? 1} disabled={busy} /></label>
                <label>最大数量<input name="maxQuantity" required inputMode="numeric" defaultValue={editing?.maxQuantity ?? 1} disabled={busy} /></label>
                <label>发货包装模板<select name="packagingTemplateId" required defaultValue={editing?.packagingTemplateId ?? ''} disabled={busy}><option value="">请选择发货包装</option>{state.data.templates.filter((template) => template.status !== 'ARCHIVED' || template.id === editing?.packagingTemplateId).map((template) => <option key={template.id} value={template.id} disabled={template.status !== 'ACTIVE' && template.id !== editing?.packagingTemplateId}>{template.businessCode} · {template.name}{template.status === 'ACTIVE' ? '' : '（已停用）'}</option>)}</select></label>
                {editing && <label>状态<select name="status" defaultValue={editing.status} disabled={busy}><option value="ACTIVE">启用</option><option value="INACTIVE">停用</option></select></label>}
                <div className="form-actions">
                  {editing && <button className="text-button" type="button" disabled={busy} onClick={() => setEditing(null)}>取消编辑</button>}
                  <button className="button button-primary" type="submit" disabled={busy || state.data.templates.every((template) => template.status !== 'ACTIVE')}>{busy ? '正在保存…' : editing ? '保存规则' : '新增规则'}</button>
                </div>
                {state.data.templates.every((template) => template.status !== 'ACTIVE') && <small className="field-error">没有可用发货包装模板，请先在仓库的“发货配置”中创建并启用模板。</small>}
              </form>
            )}
          </>
        )}
      </section>
    </div>
  )
}
