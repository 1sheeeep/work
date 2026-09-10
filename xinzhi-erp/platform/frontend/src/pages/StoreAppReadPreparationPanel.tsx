import { useEffect, useId, useRef, useState } from 'react'
import { ApiError } from '../api/client'
import { useI18n } from '../i18n/I18nContext'
import { storeAppReadPreparationApi, type PreparationStatus, type PreparationOrders } from '../modules/storeAppReadPreparationApi'
import './StoreAppReadPreparationPanel.css'

export function StoreAppReadPreparationPanel({ shopId, canReadOrders }: { shopId: string; canReadOrders: boolean }) {
  const { t, formatDateTime } = useI18n()
  const titleId = useId()
  const [status, setStatus] = useState<PreparationStatus | null>(null)
  const [orders, setOrders] = useState<PreparationOrders | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sequence = useRef(0)
  useEffect(() => {
    sequence.current++
    setStatus(null); setOrders(null); setError(null); setBusy(false)
    return () => { sequence.current++ }
  }, [shopId])

  const check = async (readOrders: boolean) => {
    const request = ++sequence.current
    setBusy(true); setError(null); setOrders(null)
    // Refresh the binding before each preview; previous success is not live proof.
    setStatus(null)
    try {
      const current = await storeAppReadPreparationApi.status(shopId)
      if (sequence.current !== request) return
      if (readOrders) {
        if (!canReadOrders) throw new Error('Read permission required')
        const result = await storeAppReadPreparationApi.orders(shopId)
        if (sequence.current !== request) return
        if (result.bindingVersion !== current.bindingVersion) throw new Error('Binding changed')
        setOrders(result)
      }
      setStatus(current)
    } catch (failure) {
      if (sequence.current !== request) return
      setStatus(null); setOrders(null)
      setError(failure instanceof ApiError && failure.status === 404
        ? t('准备通道尚未启用。当前店铺仍按原方式使用。')
        : t('本次只读核验未完成。请核对店铺关联、权限及准备服务后重试；当前授权未改变。'))
    } finally { if (sequence.current === request) setBusy(false) }
  }

  return <section className="detail-card store-app-read-preparation" aria-labelledby={titleId} aria-busy={busy}>
    <div className="compact-card-heading">
      <h2 id={titleId}>{t('店铺应用接入准备')}</h2>
      <span className="status-chip">{t('只读核验 · 未切换')}</span>
    </div>
    <p className="toolbar-note">{t('核验原客服的店铺应用，仅预览一页订单；不导入、不修改授权、不启用正式接入。')}</p>
    <div className="platform-detail-actions">
      <button type="button" className="button button-secondary" disabled={busy} onClick={() => void check(false)}>
        {busy ? t('正在核验…') : t('核验候选授权')}
      </button>
      {canReadOrders && <button type="button" className="button button-secondary" disabled={busy} onClick={() => void check(true)}>{t('只读预览订单')}</button>}
    </div>
    {error && <p role="alert" className="toolbar-note">{error}</p>}
    {status && <div role="status" className="shopify-connection-summary">
      <div>
        <strong>{t('候选授权已核验，尚未切换')}</strong>
        <p>{status.snapshot.shopify.shopName} · {status.snapshot.shopify.shopDomain}</p>
        <p>{t('绑定版本：{version}；核验时间：{time}', { version: status.bindingVersion, time: formatDateTime(status.snapshot.shopify.updatedAt) })}</p>
        <p>{t('已核验权限（ERP 相关）：{scopes}', { scopes: status.snapshot.shopifyScopes.filter(scope => scope.status === 'GRANTED').map(scope => scope.scope).join(', ') || t('无') })}</p>
      </div>
    </div>}
    {orders && <>
      <p className="toolbar-note">{t('本页返回 {count} 条订单；这不是全量同步或正式接入验收。', { count: orders.page.orders.length })}</p>
      {orders.page.orders.length === 0 ? <p>{t('本页没有订单。')}</p> : <div className="shop-table-scroll">
        <table className="shop-table"><caption className="sr-only">{t('候选店铺应用订单预览')}</caption>
          <thead><tr><th scope="col">{t('订单号')}</th><th scope="col">{t('创建时间')}</th></tr></thead>
          <tbody>{orders.page.orders.map(order => <tr key={order.externalOrderRef}><td>{order.name}</td><td>{formatDateTime(order.createdAt)}</td></tr>)}</tbody>
        </table>
      </div>}
    </>}
  </section>
}
