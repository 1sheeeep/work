// Browser-only synthetic fixture. No fetch, account session or real service.
import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { I18nProvider, useI18n } from '../../src/i18n/I18nContext'
import { StoreAppReadPreparationPanel } from '../../src/pages/StoreAppReadPreparationPanel'
import { storeAppReadPreparationApi } from '../../src/modules/storeAppReadPreparationApi'
import '../../src/styles.css'
import '../../src/erp-design-system.css'

let fail = false
storeAppReadPreparationApi.status = async () => {
  if (fail) throw new Error('Synthetic failure')
  return { readOnly: true, productionReady: false, bindingVersion: 7,
    snapshot: { mode: 'CUSTOMER_SERVICE_STORE_APP_READ_ONLY', shopify: { status: 'CONNECTED', shopName: 'Synthetic preparation shop', shopDomain: 'synthetic-preparation.myshopify.com', updatedAt: new Date().toISOString() },
      shopifyScopes: [{ scope: 'read_orders', status: 'GRANTED' }, { scope: 'read_products', status: 'MISSING' }] } }
}
storeAppReadPreparationApi.orders = async () => ({ readOnly: true, productionReady: false, bindingVersion: 7,
  page: { mode: 'CUSTOMER_SERVICE_STORE_APP_READ_ONLY', connectionStatus: 'CONNECTED', hasNextPage: false, fetchedAt: new Date().toISOString(),
    orders: [{ externalOrderRef: 'gid://shopify/Order/123', name: '#SYNTHETIC-123', createdAt: '2026-09-05T01:02:03Z' }] } })

function Fixture() {
  const { locale, setLocale } = useI18n()
  const [narrow, setNarrow] = useState(false)
  const [failure, setFailure] = useState(false)
  return <main style={{ padding: 16, maxWidth: narrow ? 375 : 1000, margin: 'auto' }}>
    <h1>合成数据界面演练</h1>
    <p>仅展示准备组件，不连接 Shopify、客服或 ERP 数据库；不代表正式接入。</p>
    <div className="platform-detail-actions" style={{ marginBottom: 20 }}>
      <button type="button" className="button button-secondary" onClick={() => setNarrow(!narrow)}>切换窄屏展示</button>
      <button type="button" className="button button-secondary" onClick={() => setLocale(locale === 'en' ? 'zh-CN' : 'en')}>中 / EN</button>
      <label><input type="checkbox" checked={failure} onChange={event => { fail = event.target.checked; setFailure(fail) }} />模拟读取失败</label>
    </div>
    <StoreAppReadPreparationPanel shopId="22222222-2222-4222-8222-222222222222" canReadOrders />
  </main>
}
createRoot(document.getElementById('root')!).render(<I18nProvider><Fixture /></I18nProvider>)
