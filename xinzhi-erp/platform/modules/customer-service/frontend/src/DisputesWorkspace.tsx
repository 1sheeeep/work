import { useEffect, useRef, useState } from 'react'
import type { CustomerServiceApi, CustomerServiceShop, Dispute, DisputeCatalogPage } from './contracts'
import { dateTime, errorMessage, money } from './utils'

const statusLabel: Record<Dispute['status'], string> = {
  ACCEPTED: '已接受', LOST: '申诉失败', NEEDS_RESPONSE: '待处理', PREVENTED: '已拦截',
  UNDER_REVIEW: '审核中', WON: '申诉成功', CHARGE_REFUNDED: '已退款',
}
const typeLabel: Record<Dispute['type'], string> = { CHARGEBACK: '拒付', INQUIRY: '查询' }

export type DisputesWorkspaceProps = {
  api: CustomerServiceApi
  shops: CustomerServiceShop[]
  canRead: boolean
  initialShopId?: string
}

export function DisputesWorkspace({ api, shops, canRead, initialShopId }: DisputesWorkspaceProps) {
  const [shopId, setShopId] = useState(() => initialShopId && shops.some((shop) => shop.id === initialShopId) ? initialShopId : shops[0]?.id ?? '')
  const [page, setPage] = useState<DisputeCatalogPage>()
  const [cursor, setCursor] = useState<string>()
  const [history, setHistory] = useState<(string | undefined)[]>([])
  const [loading, setLoading] = useState(false)
  const [reload, setReload] = useState(0)
  const [error, setError] = useState<string>()
  const errorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!shops.some((shop) => shop.id === shopId)) setShopId(shops[0]?.id ?? '')
  }, [shopId, shops])

  useEffect(() => {
    if (!shopId || !canRead) {
      setPage(undefined)
      return
    }
    let active = true
    setLoading(true)
    setError(undefined)
    void api.listDisputes({ shopId, limit: 50, cursor })
      .then((result) => {
        if (active) setPage(result)
      })
      .catch((reason) => {
        if (!active) return
        setError(errorMessage(reason))
        requestAnimationFrame(() => errorRef.current?.focus())
      })
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [api, canRead, cursor, reload, shopId])

  return <section className="xzcs-view" aria-labelledby="xzcs-disputes-title">
    <header className="xzcs-heading">
      <div><p className="xzcs-eyebrow">支付争议</p><h1 id="xzcs-disputes-title">拒付概览</h1><p>同步查看 Shopify Payments 拒付状态、金额、原因和处理截止时间。</p></div>
      <label className="xzcs-field xzcs-shop-field"><span>店铺</span><select value={shopId} disabled={loading || shops.length === 0} onChange={(event) => {
        setShopId(event.target.value); setCursor(undefined); setHistory([])
      }}>{shops.map((shop) => <option key={shop.id} value={shop.id}>{shop.displayName}</option>)}</select></label>
    </header>
    <div className="xzcs-alert">证据材料的查看、编辑和提交请在 Shopify Admin 中完成；当前版本不访问拒付证据。</div>
    {!canRead && <div className="xzcs-alert xzcs-alert-error" role="alert">当前账号没有拒付查看权限。</div>}
    {error && <div className="xzcs-alert xzcs-alert-error" role="alert" ref={errorRef} tabIndex={-1}><span>{error}</span><button type="button" onClick={() => setReload((value) => value + 1)}>重试</button></div>}
    {loading && <div className="xzcs-state" role="status">正在读取拒付数据…</div>}
    {!loading && canRead && shops.length === 0 && <div className="xzcs-state">暂无可用店铺，请先由宿主系统完成店铺授权。</div>}
    {!loading && page?.state === 'NOT_CONFIGURED' && <div className="xzcs-state">当前店铺尚未连接 Shopify。</div>}
    {!loading && page?.state === 'CONNECTED' && <section className="xzcs-card xzcs-list-card" aria-labelledby="xzcs-dispute-list-title">
      <header className="xzcs-card-heading"><div><h2 id="xzcs-dispute-list-title">拒付列表</h2><p>更新于 {dateTime(page.fetchedAt)}</p></div><span>{page.disputes.length} 条</span></header>
      <div className="xzcs-table-wrap"><table className="xzcs-table"><thead><tr><th>订单</th><th>状态</th><th>类型 / 原因</th><th>金额</th><th>发起时间</th><th>处理截止</th></tr></thead><tbody>
        {page.disputes.map((item) => <tr key={item.id}>
          <td>{item.orderName || item.orderId || '未关联订单'}</td><td><span className={`xzcs-badge status-${item.status.toLowerCase()}`}>{statusLabel[item.status]}</span></td>
          <td>{typeLabel[item.type]}<small>{item.reason}{item.networkReasonCode ? ` · ${item.networkReasonCode}` : ''}</small></td><td>{money(item.amount)}</td><td>{dateTime(item.initiatedAt)}</td><td>{dateTime(item.evidenceDueBy)}</td>
        </tr>)}
        {page.disputes.length === 0 && <tr><td colSpan={6}>当前页没有拒付记录。</td></tr>}
      </tbody></table></div>
      <footer className="xzcs-pagination"><button className="xzcs-button xzcs-secondary" type="button" disabled={history.length === 0} onClick={() => { setCursor(history.at(-1)); setHistory((items) => items.slice(0, -1)) }}>上一页</button><button className="xzcs-button xzcs-secondary" type="button" disabled={!page.pageInfo.hasNextPage || !page.pageInfo.endCursor} onClick={() => { setHistory((items) => [...items, cursor]); setCursor(page.pageInfo.endCursor) }}>下一页</button></footer>
    </section>}
  </section>
}
