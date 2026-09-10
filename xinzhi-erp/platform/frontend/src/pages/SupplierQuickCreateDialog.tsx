import { type FormEvent, useState } from 'react'
import { ApiError } from '../api/client'
import { DialogCloseButton } from '../components/DialogCloseButton'
import { supplierApi } from '../modules/supplierApi'
import type { ProcurementSkuOption } from '../modules/procurementPlanApi'
import './SupplierManagementPage.css'

function nullable(value: FormDataEntryValue | null) { const text = String(value ?? '').trim(); return text || null }
function errorMessage(cause: unknown) { return cause instanceof ApiError ? cause.message : '新增供应商失败，请稍后重试。' }

export function SupplierQuickCreateDialog({ sku, onClose, onCreated }: { sku: ProcurementSkuOption; onClose: () => void; onCreated: (supplierId: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy) return
    const form = new FormData(event.currentTarget)
    const businessCode = String(form.get('businessCode') ?? '').trim().toUpperCase()
    const name = String(form.get('name') ?? '').trim()
    const unitPriceText = nullable(form.get('unitPrice')); const currency = optionalCurrency(form.get('currencyCode'))
    const moqText = nullable(form.get('minimumOrderQuantity')); const leadText = nullable(form.get('leadTimeDays'))
    if (!/^[A-Z][A-Z0-9_-]{1,63}$/.test(businessCode)) return setError('供应商编码需为 2–64 位大写字母、数字、下划线或连字符。')
    if (!name) return setError('请填写供应商名称。')
    if ((unitPriceText === null) !== (currency === null)) return setError('采购单价与币种必须同时填写。')
    setBusy(true); setError(undefined)
    try {
      const result = await supplierApi.createWithMapping({
        supplier: { businessCode, name, contactName: nullable(form.get('contactName')), contactPhone: nullable(form.get('contactPhone')), contactEmail: nullable(form.get('contactEmail'))?.toLowerCase() ?? null, address: null, taxRegistrationNumber: null, settlementCurrency: currency ?? 'CNY', paymentTermsDays: null, notes: null },
        mapping: { skuId: sku.id, supplierSkuCode: nullable(form.get('supplierSkuCode')), status: 'ACTIVE', preferred: form.get('preferred') === 'on', leadTimeDays: leadText === null ? null : Number(leadText), unitPrice: unitPriceText === null ? null : Number(unitPriceText), currencyCode: currency, minimumOrderQuantity: moqText === null ? null : Number(moqText) },
      })
      onCreated(result.supplier.id)
    } catch (cause) { setError(errorMessage(cause)) } finally { setBusy(false) }
  }
  return <div className="dialog-backdrop dialog-backdrop-nested" role="presentation"><section className="write-dialog supplier-mapping-editor" role="dialog" aria-modal="true" aria-labelledby="quick-supplier-title"><header className="table-heading"><div><h2 id="quick-supplier-title">新增并绑定供应商</h2><span>{sku.businessCode} · {sku.name}</span></div><DialogCloseButton disabled={busy} onClick={onClose} /></header><form onSubmit={(event) => void submit(event)}><div className="supplier-form-grid"><label><span>* 供应商编码</span><input name="businessCode" maxLength={64} autoFocus disabled={busy} /></label><label><span>* 供应商名称</span><input name="name" maxLength={200} disabled={busy} /></label><label><span>联系人</span><input name="contactName" maxLength={120} disabled={busy} /></label><label><span>联系电话</span><input name="contactPhone" maxLength={40} disabled={busy} /></label><label className="span-two"><span>联系人邮箱</span><input name="contactEmail" type="email" maxLength={254} disabled={busy} /></label><label><span>供应商 SKU</span><input name="supplierSkuCode" maxLength={120} disabled={busy} /></label><label><span>交期（天）</span><input name="leadTimeDays" type="number" min={0} max={3650} disabled={busy} /></label><label><span>采购单价</span><input name="unitPrice" type="number" min="0.0001" step="0.0001" disabled={busy} /></label><label><span>币种</span><input name="currencyCode" maxLength={3} defaultValue="CNY" disabled={busy} /></label><label><span>最小起订量</span><input name="minimumOrderQuantity" type="number" min={1} max={1_000_000_000} disabled={busy} /></label><label className="supplier-checkbox"><input name="preferred" type="checkbox" defaultChecked disabled={busy} /><span>设为首选供应商</span></label></div>{error && <div className="inline-alert" role="alert">{error}</div>}<footer className="form-actions"><button className="text-button" type="button" disabled={busy} onClick={onClose}>取消</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? '正在新增…' : '新增并绑定'}</button></footer></form></section></div>
}

function optionalCurrency(value: FormDataEntryValue | null) { const text = nullable(value)?.toUpperCase() ?? null; return text }
