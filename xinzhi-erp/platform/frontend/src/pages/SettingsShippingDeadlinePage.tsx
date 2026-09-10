import { type FormEvent, useEffect, useState } from 'react'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { SettingsPageHeader } from '../components/SettingsPageLayout'
import {
  shippingDeadlineSettingApi,
  type ShippingDeadlineSetting,
} from '../modules/shippingDeadlineSettingApi'
import './WarehouseArchiveShells.css'

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: ShippingDeadlineSetting }

function errorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 409) {
    return '发货期限已被其他操作更新，请刷新后再保存。'
  }
  if (error instanceof ApiError && error.status === 403) {
    return '当前账号没有维护业务参数的权限。'
  }
  return '保存失败，请检查填写内容或稍后重试。'
}

function formatTime(value?: string) {
  if (!value) return '尚未保存'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value))
}

export function SettingsShippingDeadlinePage() {
  const { hasPermission } = useAuth()
  const canWrite = hasPermission('settings.parameter.write')
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [reload, setReload] = useState(0)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{
    kind: 'success' | 'error'; message: string
  }>()

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })
    setFeedback(undefined)
    void shippingDeadlineSettingApi.get(controller.signal).then(
      (data) => setState({ status: 'ready', data }),
      () => {
        if (!controller.signal.aborted) {
          setState({ status: 'error', message: '暂时无法读取发货期限设置。' })
        }
      },
    )
    return () => controller.abort()
  }, [reload])

  const save = async (event: FormEvent<HTMLFormElement>, current: ShippingDeadlineSetting) => {
    event.preventDefault()
    if (!canWrite || saving) return
    const form = new FormData(event.currentTarget)
    const deadlineDays = Number(form.get('deadlineDays'))
    setSaving(true)
    setFeedback(undefined)
    try {
      const saved = await shippingDeadlineSettingApi.save(current.version, deadlineDays)
      setState({ status: 'ready', data: saved })
      setFeedback({ kind: 'success', message: `发货期限已保存为 ${saved.deadlineDays} 天。` })
    } catch (error) {
      setFeedback({ kind: 'error', message: errorMessage(error) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="warehouse-archive-page settings-page" aria-labelledby="settings-shipping-deadline-title">
      <SettingsPageHeader id="settings-shipping-deadline-title" section="参数设置" title="订单发货期限设置" description="为没有平台最晚发货时间的新订单设置统一处理期限。" />
      <section className="warehouse-archive-card" aria-label="订单发货期限设置表单">
        {state.status === 'loading' && <p role="status">正在读取发货期限设置…</p>}
        {state.status === 'error' && (
          <div className="warehouse-archive-empty" role="alert">
            <strong>无法读取设置</strong>
            <span>{state.message}</span>
            <button type="button" className="text-button" onClick={() => setReload((value) => value + 1)}>重试</button>
          </div>
        )}
        {state.status === 'ready' && (
          <form key={`${state.data.version}-${state.data.deadlineDays}`} onSubmit={(event) => void save(event, state.data)}>
            <div className="warehouse-archive-filters settings-deadline-form">
              <label>
                发货期限（天）
                <input
                  name="deadlineDays"
                  type="number"
                  required
                  min={1}
                  max={365}
                  step={1}
                  defaultValue={state.data.deadlineDays}
                  disabled={!canWrite || saving}
                  aria-describedby="shipping-deadline-help"
                />
                <small id="shipping-deadline-help">允许 1–365 天；系统默认值为 3 天。</small>
              </label>
              <div className="settings-deadline-summary" aria-label="当前设置状态">
                <span>当前来源</span>
                <strong>{state.data.configured ? '企业已设置' : '系统默认'}</strong>
                <span>最后更新</span>
                <strong>{formatTime(state.data.updatedAt)}</strong>
                <span>操作人</span>
                <strong>{state.data.updatedByDisplayName ?? '—'}</strong>
              </div>
            </div>
            <div className="warehouse-processing-formula" role="note">
              <strong>生效规则</strong>
              <span>平台已提供最晚发货时间时继续使用平台值；未提供时，从支付时间起计算，无支付时间则从下单时间起计算。仅对保存后新建或新导入的订单生效，历史订单不会被改写。</span>
            </div>
            {feedback && (
              <p className={`warehouse-export-feedback is-${feedback.kind}`} role={feedback.kind === 'error' ? 'alert' : 'status'}>
                {feedback.message}
              </p>
            )}
            <div className="warehouse-archive-actions">
              <button type="button" disabled={saving} onClick={() => setReload((value) => value + 1)}>刷新</button>
              {canWrite && <button className="is-primary" type="submit" disabled={saving}>{saving ? '正在保存…' : '保存'}</button>}
            </div>
          </form>
        )}
      </section>
    </main>
  )
}
