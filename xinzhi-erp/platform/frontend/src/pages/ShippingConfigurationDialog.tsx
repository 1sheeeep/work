import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../api/client'
import { DialogCloseButton } from '../components/DialogCloseButton'
import {
  type PackagingStatus,
  type PackagingTemplate,
  type PackagingType,
  type ShippingScale,
  shippingConfigurationApi,
  type WarehousePackaging,
  type WeightTolerance,
} from '../modules/shippingConfigurationApi'
import type { Warehouse } from '../modules/warehouseCenterApi'

type Configuration = {
  packaging: WarehousePackaging[]
  scales: ShippingScale[]
  tolerance: WeightTolerance
}

type State =
  | { status: 'loading' }
  | { status: 'ready'; data: Configuration }
  | { status: 'error'; message: string }

const packagingTypes: Array<{ value: PackagingType; label: string }> = [
  { value: 'BOX', label: '纸箱' },
  { value: 'MAILER', label: '快递封套' },
  { value: 'BAG', label: '包装袋' },
  { value: 'OTHER', label: '其他' },
]

const packagingStatuses: Array<{
  value: PackagingStatus
  label: string
}> = [
  { value: 'ACTIVE', label: '启用' },
  { value: 'INACTIVE', label: '停用' },
  { value: 'ARCHIVED', label: '归档' },
]

function safeMessage(error: unknown, action: string) {
  if (error instanceof ApiError && error.status === 403) {
    return `当前账号没有${action}所需权限。`
  }
  if (error instanceof ApiError && error.status === 404) {
    return '仓库或配置记录不存在，可能已被其他操作删除。'
  }
  if (error instanceof ApiError && error.status === 409) {
    return '配置已被其他操作更新，或业务编码、设备编号重复。请刷新后重试。'
  }
  return `暂时无法${action}，请稍后重试。`
}

function positiveInteger(value: FormDataEntryValue | null, maximum: number) {
  const text = String(value ?? '').trim()
  if (!/^\d+$/.test(text)) return null
  const parsed = Number(text)
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= maximum
    ? parsed
    : null
}

function dimensions(form: FormData) {
  const values = ['lengthMm', 'widthMm', 'heightMm'].map((field) =>
    String(form.get(field) ?? '').trim(),
  )
  if (values.every((value) => value === '')) {
    return { lengthMm: null, widthMm: null, heightMm: null }
  }
  const parsed = values.map((value) => positiveInteger(value, 999_999))
  return parsed.every((value) => value !== null)
    ? {
        lengthMm: parsed[0] as number,
        widthMm: parsed[1] as number,
        heightMm: parsed[2] as number,
      }
    : null
}

function basisPoints(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim()
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(text)) return null
  const parsed = Math.round(Number(text) * 100)
  return parsed >= 0 && parsed <= 10_000 ? parsed : null
}

function packagingTypeLabel(value: PackagingType) {
  return packagingTypes.find((item) => item.value === value)?.label ?? value
}

function templateDimensions(template: PackagingTemplate) {
  return template.lengthMm === null
    ? '未设置'
    : `${template.lengthMm} × ${template.widthMm} × ${template.heightMm} mm`
}

export function ShippingConfigurationDialog({
  warehouse,
  canWrite,
  onClose,
}: {
  warehouse: Warehouse
  canWrite: boolean
  onClose: () => void
}) {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [action, setAction] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{
    kind: 'success' | 'error'
    message: string
  } | null>(null)
  const [editingTemplate, setEditingTemplate] =
    useState<PackagingTemplate | null>(null)
  const request = useRef(0)
  const dialog = useRef<HTMLElement>(null)
  const actionRef = useRef<string | null>(null)

  useEffect(() => {
    actionRef.current = action
  }, [action])

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    const node = dialog.current
    const focusable = () =>
      Array.from(
        node?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      )
    focusable()[0]?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && actionRef.current === null) {
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
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previousFocus?.focus()
    }
  }, [onClose])

  const load = useCallback(async () => {
    const current = ++request.current
    setState({ status: 'loading' })
    setFeedback(null)
    try {
      const [packaging, scales, tolerance] = await Promise.all([
        shippingConfigurationApi.listWarehousePackaging(warehouse.id),
        shippingConfigurationApi.listScales(warehouse.id),
        shippingConfigurationApi.getTolerance(warehouse.id),
      ])
      if (current === request.current) {
        setState({ status: 'ready', data: { packaging, scales, tolerance } })
      }
    } catch (error) {
      if (current === request.current) {
        setState({
          status: 'error',
          message: safeMessage(error, '读取发货称重配置'),
        })
      }
    }
  }, [warehouse.id])

  useEffect(() => {
    void load()
    return () => {
      request.current += 1
    }
  }, [load])

  const run = async (key: string, work: () => Promise<void>) => {
    setAction(key)
    setFeedback(null)
    try {
      await work()
    } finally {
      setAction(null)
    }
  }

  const submitTemplate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const name = String(form.get('name') ?? '').trim()
    const standardWeightGrams = positiveInteger(
      form.get('standardWeightGrams'),
      999_999_999,
    )
    const parsedDimensions = dimensions(form)
    if (!name || standardWeightGrams === null || parsedDimensions === null) {
      setFeedback({
        kind: 'error',
        message: '请填写名称和有效重量；尺寸必须全部留空或完整填写。',
      })
      return
    }
    const packagingType = String(form.get('packagingType')) as PackagingType
    await run('template', async () => {
      try {
        if (editingTemplate) {
          await shippingConfigurationApi.updateTemplate(editingTemplate.id, {
            version: editingTemplate.version,
            name,
            packagingType,
            standardWeightGrams,
            ...parsedDimensions,
            status: String(form.get('status')) as PackagingStatus,
          })
        } else {
          const businessCode = String(form.get('businessCode') ?? '')
            .trim()
            .toUpperCase()
          if (!/^[A-Z][A-Z0-9_-]{1,63}$/.test(businessCode)) {
            setFeedback({
              kind: 'error',
              message: '发货包装编码须以字母开头，并使用字母、数字、下划线或连字符。',
            })
            return
          }
          await shippingConfigurationApi.createTemplate({
            businessCode,
            name,
            packagingType,
            standardWeightGrams,
            ...parsedDimensions,
          })
        }
        setEditingTemplate(null)
        await load()
        setFeedback({
          kind: 'success',
          message: editingTemplate ? '发货包装模板已更新。' : '发货包装模板已创建，请按需为本仓启用。',
        })
      } catch (error) {
        setFeedback({
          kind: 'error',
          message: safeMessage(error, editingTemplate ? '更新发货包装模板' : '创建发货包装模板'),
        })
      }
    })
  }

  const setPackagingEnabled = async (
    templateId: string,
    enabled: boolean,
  ) => {
    await run(`packaging:${templateId}`, async () => {
      try {
        const packaging =
          await shippingConfigurationApi.setWarehousePackaging(
            warehouse.id,
            templateId,
            enabled,
          )
        setState((current) =>
          current.status === 'ready'
            ? { status: 'ready', data: { ...current.data, packaging } }
            : current,
        )
        setFeedback({
          kind: 'success',
          message: enabled ? '发货包装已在本仓启用。' : '发货包装已在本仓停用。',
        })
      } catch (error) {
        setFeedback({
          kind: 'error',
          message: safeMessage(error, '更新本仓发货包装'),
        })
      }
    })
  }

  const submitScale = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const deviceNumber = String(form.get('deviceNumber') ?? '').trim()
    const displayName = String(form.get('displayName') ?? '').trim()
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(deviceNumber) ||
      !displayName ||
      displayName.length > 160
    ) {
      setFeedback({ kind: 'error', message: '请填写有效的设备编号和显示名称。' })
      return
    }
    await run('scale:create', async () => {
      try {
        const created = await shippingConfigurationApi.createScale(
          warehouse.id,
          { deviceNumber, displayName },
        )
        setState((current) =>
          current.status === 'ready'
            ? {
                status: 'ready',
                data: {
                  ...current.data,
                  scales: [...current.data.scales, created],
                },
              }
            : current,
        )
        formElement.reset()
        setFeedback({ kind: 'success', message: '电子秤已绑定到本仓。' })
      } catch (error) {
        setFeedback({ kind: 'error', message: safeMessage(error, '绑定电子秤') })
      }
    })
  }

  const toggleScale = async (scale: ShippingScale) => {
    await run(`scale:${scale.id}`, async () => {
      try {
        const updated = await shippingConfigurationApi.updateScale(scale.id, {
          version: scale.version,
          warehouseId: warehouse.id,
          displayName: scale.displayName,
          status: scale.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
        })
        setState((current) =>
          current.status === 'ready'
            ? {
                status: 'ready',
                data: {
                  ...current.data,
                  scales: current.data.scales.map((item) =>
                    item.id === updated.id ? updated : item,
                  ),
                },
              }
            : current,
        )
        setFeedback({ kind: 'success', message: '电子秤状态已更新。' })
      } catch (error) {
        setFeedback({ kind: 'error', message: safeMessage(error, '更新电子秤') })
      }
    })
  }

  const submitTolerance = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const gramsText = String(form.get('toleranceGrams') ?? '').trim()
    const toleranceGrams = /^\d+$/.test(gramsText) ? Number(gramsText) : -1
    const toleranceBasisPoints = basisPoints(form.get('tolerancePercent'))
    if (
      !Number.isSafeInteger(toleranceGrams) ||
      toleranceGrams < 0 ||
      toleranceGrams > 999_999_999 ||
      toleranceBasisPoints === null
    ) {
      setFeedback({
        kind: 'error',
        message: '克数须为非负整数，百分比须在 0%–100% 之间且最多两位小数。',
      })
      return
    }
    await run('tolerance', async () => {
      try {
        const tolerance = await shippingConfigurationApi.setTolerance(
          warehouse.id,
          { toleranceGrams, toleranceBasisPoints },
        )
        setState((current) =>
          current.status === 'ready'
            ? {
                status: 'ready',
                data: { ...current.data, tolerance },
              }
            : current,
        )
        setFeedback({ kind: 'success', message: '本仓称重容差已保存。' })
      } catch (error) {
        setFeedback({ kind: 'error', message: safeMessage(error, '保存称重容差') })
      }
    })
  }

  const template = editingTemplate

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        ref={dialog}
        className="write-dialog shipping-configuration-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shipping-configuration-title"
      >
        <header className="table-heading">
          <div>
            <h2 id="shipping-configuration-title">发货配置</h2>
            <p>维护打包、称重和校验所需的仓库配置。</p>
          </div>
          <DialogCloseButton disabled={action !== null} onClick={onClose} />
        </header>

        <div className="dialog-scroll-region">
          {feedback && (
            <div
              className={feedback.kind === 'error' ? 'inline-alert' : 'warehouse-success'}
              role={feedback.kind === 'error' ? 'alert' : 'status'}
            >
              {feedback.message}
            </div>
          )}

          {state.status === 'loading' && <p aria-busy="true">正在读取发货配置…</p>}
          {state.status === 'error' && (
            <div className="compact-empty-state" role="alert">
              <strong>无法读取配置</strong>
              <span>{state.message}</span>
              <button className="text-button" type="button" onClick={() => void load()}>
                重试
              </button>
            </div>
          )}

          {state.status === 'ready' && (
            <div className="shipping-configuration-content">
            <section className="shipping-configuration-section" aria-labelledby="weight-tolerance-title">
              <div className="table-heading">
                <div>
                  <h3 id="weight-tolerance-title">称重容差</h3>
                  <p>实际放行阈值取固定克数与百分比换算值中的较大值。</p>
                </div>
                <span className="status-badge is-neutral">
                  {state.data.tolerance.warehouseOverride ? '仓库覆盖值' : '公司默认值'}
                </span>
              </div>
              <form className="shipping-configuration-form" onSubmit={submitTolerance} key={`${state.data.tolerance.toleranceGrams}:${state.data.tolerance.toleranceBasisPoints}`}>
                <label>
                  固定容差（克）
                  <input name="toleranceGrams" inputMode="numeric" defaultValue={state.data.tolerance.toleranceGrams} disabled={!canWrite || action !== null} />
                </label>
                <label>
                  比例容差（%）
                  <input name="tolerancePercent" inputMode="decimal" defaultValue={(state.data.tolerance.toleranceBasisPoints / 100).toFixed(2)} disabled={!canWrite || action !== null} />
                </label>
                {canWrite && <button className="button button-primary" type="submit" disabled={action !== null}>{action === 'tolerance' ? '正在保存…' : '保存容差'}</button>}
              </form>
            </section>

            <section className="shipping-configuration-section" aria-labelledby="packaging-title">
              <div className="table-heading">
                <div>
                  <h3 id="packaging-title">发货包装模板</h3>
                  <p>启用后可用于本仓包装和称重；编辑模板会影响使用该模板的其他仓库。</p>
                </div>
              </div>
              <div className="shipping-configuration-table-scroll">
                <table className="shop-table">
                  <thead><tr><th>本仓</th><th>编码 / 名称</th><th>类型</th><th>包装重量</th><th>外尺寸</th><th>状态</th><th>操作</th></tr></thead>
                  <tbody>
                    {state.data.packaging.map(({ template: item, enabled }) => (
                      <tr key={item.id}>
                        <td><input aria-label={`${item.name}在本仓启用`} type="checkbox" checked={enabled} disabled={!canWrite || action !== null || (!enabled && item.status !== 'ACTIVE')} onChange={(event) => void setPackagingEnabled(item.id, event.currentTarget.checked)} /></td>
                        <td><code>{item.businessCode}</code><br />{item.name}</td>
                        <td>{packagingTypeLabel(item.packagingType)}</td>
                        <td>{item.standardWeightGrams} g</td>
                        <td>{templateDimensions(item)}</td>
                        <td>{packagingStatuses.find((status) => status.value === item.status)?.label}</td>
                        <td>{canWrite && item.status !== 'ARCHIVED' ? <button className="text-button" type="button" disabled={action !== null} onClick={() => setEditingTemplate(item)}>编辑</button> : <span>—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {state.data.packaging.length === 0 && <p className="compact-empty-state">暂无发货包装模板。</p>}
              {canWrite && (
                <form className="shipping-template-form" onSubmit={submitTemplate} key={template?.id ?? 'new'}>
                  <div className="shipping-template-heading">
                    <h4>{template ? `编辑 ${template.name}` : '新增发货包装模板'}</h4>
                    <p>用于打包和称重，请填写发货包装自身规格。</p>
                  </div>
                  <div className="shipping-template-base-fields">
                    {!template && <label>业务编码<input name="businessCode" required maxLength={64} placeholder="例如 BOX_S" disabled={action !== null} /></label>}
                    <label>名称<input name="name" required maxLength={160} defaultValue={template?.name} disabled={action !== null} /></label>
                    <label>类型<select name="packagingType" defaultValue={template?.packagingType ?? 'BOX'} disabled={action !== null}>{packagingTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
                    {template && <label>状态<select name="status" defaultValue={template.status} disabled={action !== null}>{packagingStatuses.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>}
                  </div>
                  <section className="shipping-template-physical-fields">
                    <div>
                      <h5>发货包装规格</h5>
                      <p>重量必填；外尺寸可留空，但填写时必须同时填写长、宽、高。</p>
                    </div>
                    <label>包装重量（克）<input name="standardWeightGrams" required inputMode="numeric" defaultValue={template?.standardWeightGrams} disabled={action !== null} placeholder="例如 120" /></label>
                    <fieldset>
                      <legend>外尺寸（毫米，可选）</legend>
                      <div>
                        <label>长<input name="lengthMm" inputMode="numeric" defaultValue={template?.lengthMm ?? ''} disabled={action !== null} placeholder="例如 300" /></label>
                        <label>宽<input name="widthMm" inputMode="numeric" defaultValue={template?.widthMm ?? ''} disabled={action !== null} placeholder="例如 200" /></label>
                        <label>高<input name="heightMm" inputMode="numeric" defaultValue={template?.heightMm ?? ''} disabled={action !== null} placeholder="例如 100" /></label>
                      </div>
                    </fieldset>
                  </section>
                  <div className="form-actions">
                    {template && <button className="text-button" type="button" onClick={() => setEditingTemplate(null)} disabled={action !== null}>取消编辑</button>}
                    <button className="button button-primary" type="submit" disabled={action !== null}>{action === 'template' ? '正在保存…' : template ? '保存模板' : '新增模板'}</button>
                  </div>
                </form>
              )}
            </section>

            <section className="shipping-configuration-section" aria-labelledby="shipping-scale-title">
              <div className="table-heading">
                <div><h3 id="shipping-scale-title">电子秤</h3><p>每台设备使用唯一编号；停用后不可用于新的称重任务。</p></div>
              </div>
              <div className="shipping-configuration-table-scroll">
                <table className="shop-table">
                  <thead><tr><th>设备编号</th><th>显示名称</th><th>状态</th><th>更新时间</th><th>操作</th></tr></thead>
                  <tbody>{state.data.scales.map((scale) => <tr key={scale.id}><td><code>{scale.deviceNumber}</code></td><td>{scale.displayName}</td><td>{scale.status === 'ACTIVE' ? '启用' : '停用'}</td><td>{new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(scale.updatedAt))}</td><td>{canWrite && <button className="text-button" type="button" disabled={action !== null} onClick={() => void toggleScale(scale)}>{scale.status === 'ACTIVE' ? '停用' : '启用'}</button>}</td></tr>)}</tbody>
                </table>
              </div>
              {state.data.scales.length === 0 && <p className="compact-empty-state">本仓尚未绑定电子秤。</p>}
              {canWrite && <form className="shipping-configuration-form" onSubmit={submitScale}><label>设备编号<input name="deviceNumber" required maxLength={100} placeholder="秤体唯一编号" /></label><label>显示名称<input name="displayName" required maxLength={160} placeholder="例如 打包台 1 号秤" /></label><button className="button button-primary" type="submit" disabled={action !== null}>{action === 'scale:create' ? '正在绑定…' : '绑定电子秤'}</button></form>}
            </section>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
