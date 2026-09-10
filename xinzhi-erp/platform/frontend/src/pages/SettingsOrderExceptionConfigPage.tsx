import { type ChangeEvent, useEffect, useState } from 'react'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { SettingsPageHeader } from '../components/SettingsPageLayout'
import {
  orderExceptionCategoryApi,
  type OrderExceptionCategoryInput,
  type OrderExceptionCategorySet,
} from '../modules/orderExceptionCategoryApi'
import './WarehouseArchiveShells.css'

type Draft = OrderExceptionCategoryInput & { key: string }
type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; value: OrderExceptionCategorySet }

function drafts(value: OrderExceptionCategorySet): Draft[] {
  return value.items.map((item) => ({
    key: item.id,
    id: item.id,
    name: item.name,
    handlingGuidance: item.handlingGuidance,
    enabled: item.enabled,
  }))
}

function actionError(error: unknown) {
  if (error instanceof ApiError && error.status === 409) {
    return '配置刚被其他操作更新，请刷新后重试。'
  }
  if (error instanceof ApiError && error.status === 403) {
    return '当前账号没有维护业务参数的权限。'
  }
  return '保存失败，请检查分类名称是否为空或重复。'
}

function formatTime(value?: string) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value))
}

export function SettingsOrderExceptionConfigPage() {
  const { hasPermission } = useAuth()
  const canWrite = hasPermission('settings.parameter.write')
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [items, setItems] = useState<Draft[]>([])
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string }>()

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })
    void orderExceptionCategoryApi.get(controller.signal).then((value) => {
      setState({ status: 'ready', value })
      setItems(drafts(value))
      setDirty(false)
    }, () => { if (!controller.signal.aborted) setState({ status: 'error' }) })
    return () => controller.abort()
  }, [reload])

  const add = () => {
    setItems((current) => [...current, {
      key: `new-${crypto.randomUUID()}`,
      name: '', handlingGuidance: '', enabled: true,
    }])
    setDirty(true)
    setFeedback(undefined)
  }

  const update = (index: number, patch: Partial<Draft>) => {
    setItems((current) => current.map((item, itemIndex) =>
      itemIndex === index ? { ...item, ...patch } : item))
    setDirty(true)
    setFeedback(undefined)
  }

  const move = (index: number, offset: -1 | 1) => {
    setItems((current) => {
      const target = index + offset
      if (target < 0 || target >= current.length) return current
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
    setDirty(true)
  }

  const remove = (index: number) => {
    setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))
    setDirty(true)
    setFeedback(undefined)
  }

  const save = async () => {
    if (state.status !== 'ready') return
    const normalizedNames = items.map((item) => item.name.trim().toLocaleLowerCase())
    if (normalizedNames.some((name) => !name)
      || new Set(normalizedNames).size !== normalizedNames.length) {
      setFeedback({ kind: 'error', message: '请填写分类名称，并确保名称不重复。' })
      return
    }
    setBusy(true); setFeedback(undefined)
    try {
      const value = await orderExceptionCategoryApi.save(state.value.revision,
        items.map(({ id, name, handlingGuidance, enabled }) => ({
          id, name, handlingGuidance, enabled,
        })))
      setState({ status: 'ready', value })
      setItems(drafts(value))
      setDirty(false)
      setFeedback({ kind: 'success', message: `已保存 ${value.items.length} 个异常分类。` })
    } catch (error) {
      setFeedback({ kind: 'error', message: actionError(error) })
    } finally { setBusy(false) }
  }

  return <main className="warehouse-archive-page settings-page" aria-labelledby="settings-order-exception-title">
    <SettingsPageHeader id="settings-order-exception-title" section="参数设置" title="订单异常分类处理配置" description="维护订单异常的内部分类和处理指引。" />
    <section className="warehouse-archive-card" aria-label="订单异常分类配置">
      {state.status === 'loading' && <p role="status">正在读取异常分类…</p>}
      {state.status === 'error' && <div className="warehouse-archive-empty" role="alert"><strong>无法读取异常分类</strong><span>请稍后重试。</span><button className="text-button" type="button" onClick={() => setReload((value) => value + 1)}>重试</button></div>}
      {state.status === 'ready' && <>
        <div className="warehouse-processing-formula" role="note"><strong>配置规则</strong><span>分类名称在当前企业内不可重复；启用状态和排列顺序会随本次保存一起更新。</span></div>
        <div className="warehouse-archive-actions settings-exception-actions">
          <div className="settings-exception-meta"><span>上次保存</span><strong>{formatTime(state.value.updatedAt)}</strong><span>操作人</span><strong>{state.value.updatedByDisplayName ?? '—'}</strong></div>
          {canWrite && <><button type="button" disabled={busy || items.length >= 50} onClick={add}>新增自定义异常分类</button><button className="is-primary" type="button" disabled={busy || !dirty} onClick={() => void save()}>{busy ? '正在保存…' : '保存'}</button></>}
          <button type="button" disabled={busy} onClick={() => setReload((value) => value + 1)}>刷新</button>
        </div>
        {feedback && <p className={`warehouse-export-feedback is-${feedback.kind}`} role={feedback.kind === 'error' ? 'alert' : 'status'}>{feedback.message}</p>}
        <div className="warehouse-archive-table-wrap settings-exception-table"><table><caption className="sr-only">订单异常分类</caption><thead><tr><th>顺序</th><th>分类名称</th><th>处理指引</th><th>状态</th><th>操作</th></tr></thead><tbody>
          {items.length === 0 ? <tr><td colSpan={5}><div className="warehouse-archive-empty" role="status"><strong>暂无自定义异常分类</strong><span>可新增分类后统一保存。</span></div></td></tr> : items.map((item, index) => <tr key={item.key}><td>{index + 1}</td><td><label className="sr-only" htmlFor={`exception-name-${item.key}`}>第 {index + 1} 项分类名称</label><input id={`exception-name-${item.key}`} value={item.name} disabled={!canWrite || busy} required maxLength={80} placeholder="例如：地址信息待确认" onChange={(event: ChangeEvent<HTMLInputElement>) => update(index, { name: event.target.value })} /></td><td><label className="sr-only" htmlFor={`exception-guidance-${item.key}`}>第 {index + 1} 项处理指引</label><input id={`exception-guidance-${item.key}`} value={item.handlingGuidance ?? ''} disabled={!canWrite || busy} maxLength={240} placeholder="简要说明核查或处理方式" onChange={(event: ChangeEvent<HTMLInputElement>) => update(index, { handlingGuidance: event.target.value })} /></td><td><label className="warehouse-archive-checkbox"><input type="checkbox" checked={item.enabled} disabled={!canWrite || busy} onChange={(event) => update(index, { enabled: event.target.checked })} />{item.enabled ? '启用' : '停用'}</label></td><td>{canWrite ? <span className="table-row-actions"><button className="text-button" type="button" disabled={busy || index === 0} onClick={() => move(index, -1)}>上移</button><button className="text-button" type="button" disabled={busy || index === items.length - 1} onClick={() => move(index, 1)}>下移</button><button className="text-button is-danger" type="button" disabled={busy} onClick={() => remove(index)}>移除</button></span> : '—'}</td></tr>)}
        </tbody></table></div>
      </>}
    </section>
  </main>
}
