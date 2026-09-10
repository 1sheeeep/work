import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  CustomerServiceApi,
  CustomerServiceShop,
  ReturnCatalogPage,
  ReturnItem,
  ReturnRefundDutySelection,
  ReturnRefundPreview,
  ReturnRefundSelection,
} from './contracts'
import { commandKey, dateTime, errorMessage, money } from './utils'

const statusLabel: Record<ReturnItem['status'], string> = {
  CANCELED: '已取消', CLOSED: '已关闭', DECLINED: '已拒绝', OPEN: '处理中', REQUESTED: '待审核',
}

export type ReturnsWorkspaceProps = {
  api: CustomerServiceApi
  shops: CustomerServiceShop[]
  canManage: boolean
  initialShopId?: string
  confirmAction?: (message: string) => boolean | Promise<boolean>
}

export function ReturnsWorkspace({ api, shops, canManage, initialShopId, confirmAction }: ReturnsWorkspaceProps) {
  const [shopId, setShopId] = useState(() => initialShopId && shops.some((shop) => shop.id === initialShopId) ? initialShopId : shops[0]?.id ?? '')
  const [keyword, setKeyword] = useState('')
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState<string>()
  const [history, setHistory] = useState<(string | undefined)[]>([])
  const [page, setPage] = useState<ReturnCatalogPage>()
  const [selectedId, setSelectedId] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const errorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!shops.some((shop) => shop.id === shopId)) setShopId(shops[0]?.id ?? '')
  }, [shopId, shops])

  useEffect(() => {
    if (!shopId) {
      setPage(undefined)
      return
    }
    let active = true
    setLoading(true)
    setError(undefined)
    void api.listReturns({ shopId, limit: 50, cursor, query: query || undefined })
      .then((result) => {
        if (!active) return
        setPage(result)
        setSelectedId((current) => result.returns.some((item) => item.id === current) ? current : result.returns[0]?.id)
      })
      .catch((reason) => {
        if (!active) return
        setError(errorMessage(reason))
        requestAnimationFrame(() => errorRef.current?.focus())
      })
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [api, cursor, query, reload, shopId])

  const selected = useMemo(() => page?.returns.find((item) => item.id === selectedId), [page, selectedId])
  const resetPaging = () => {
    setCursor(undefined)
    setHistory([])
  }

  return (
    <section className="xzcs-view" aria-labelledby="xzcs-returns-title">
      <header className="xzcs-heading">
        <div>
          <p className="xzcs-eyebrow">售后处理</p>
          <h1 id="xzcs-returns-title">退货与退款</h1>
          <p>审核退货请求，按商品数量预览退款，并选择全额运费或关税退款。</p>
        </div>
        <label className="xzcs-field xzcs-shop-field">
          <span>店铺</span>
          <select value={shopId} disabled={loading || shops.length === 0} onChange={(event) => {
            setShopId(event.target.value)
            resetPaging()
          }}>
            {shops.map((shop) => <option key={shop.id} value={shop.id}>{shop.displayName}</option>)}
          </select>
        </label>
      </header>

      <form className="xzcs-filter" aria-label="退货筛选" onSubmit={(event) => {
        event.preventDefault()
        resetPaging()
        setQuery(keyword.trim() ? `name:${keyword.trim().replace(/^#/, '').replace(/[()]/g, '')}` : '')
      }}>
        <label className="xzcs-field xzcs-grow">
          <span>订单号</span>
          <input value={keyword} maxLength={120} placeholder="例如 1001" onChange={(event) => setKeyword(event.target.value)} />
        </label>
        <button className="xzcs-button xzcs-primary" type="submit" disabled={loading || !shopId}>{loading ? '查询中…' : '查询'}</button>
        <button className="xzcs-button xzcs-secondary" type="button" disabled={loading} onClick={() => {
          setKeyword('')
          setQuery('')
          resetPaging()
        }}>重置</button>
      </form>

      {error && <div className="xzcs-alert xzcs-alert-error" role="alert" ref={errorRef} tabIndex={-1}><span>{error}</span><button type="button" onClick={() => setReload((value) => value + 1)}>重试</button></div>}
      {notice && <div className="xzcs-alert" role="status" aria-live="polite">{notice}</div>}
      {loading && <div className="xzcs-state" role="status">正在读取退货数据…</div>}
      {!loading && shops.length === 0 && <div className="xzcs-state">暂无可用店铺，请先由宿主系统完成店铺授权。</div>}
      {!loading && page?.state === 'NOT_CONFIGURED' && <div className="xzcs-state">当前店铺尚未连接 Shopify。</div>}

      {!loading && page?.state === 'CONNECTED' && (
        <div className="xzcs-master-detail">
          <section className="xzcs-card xzcs-list-card" aria-labelledby="xzcs-return-list-title">
            <header className="xzcs-card-heading">
              <div><h2 id="xzcs-return-list-title">退货单</h2><p>更新于 {dateTime(page.fetchedAt)}</p></div>
              <span>{page.returns.length} 条</span>
            </header>
            <div className="xzcs-table-wrap">
              <table className="xzcs-table">
                <thead><tr><th>退货单 / 订单</th><th>状态</th><th>商品</th><th>创建时间</th><th><span className="xzcs-sr-only">操作</span></th></tr></thead>
                <tbody>
                  {page.returns.map((item) => <tr key={item.id} className={item.id === selectedId ? 'is-selected' : undefined}>
                    <td><strong>{item.name}</strong><small>{item.orderName}</small></td>
                    <td><span className={`xzcs-badge status-${item.status.toLowerCase()}`}>{statusLabel[item.status]}</span></td>
                    <td>{item.totalQuantity} 件<small>{item.lineItems[0]?.sku || '无 SKU'}{item.lineItems.length > 1 ? ` 等 ${item.lineItems.length} 项` : ''}</small></td>
                    <td>{dateTime(item.createdAt)}</td>
                    <td><button className="xzcs-link" type="button" aria-pressed={item.id === selectedId} onClick={() => setSelectedId(item.id)}>处理</button></td>
                  </tr>)}
                  {page.returns.length === 0 && <tr><td colSpan={5}>当前条件下没有退货记录。</td></tr>}
                </tbody>
              </table>
            </div>
            <footer className="xzcs-pagination" aria-label="退货分页">
              <button className="xzcs-button xzcs-secondary" type="button" disabled={history.length === 0} onClick={() => {
                setCursor(history.at(-1))
                setHistory((items) => items.slice(0, -1))
              }}>上一页</button>
              <button className="xzcs-button xzcs-secondary" type="button" disabled={!page.pageInfo.hasNextPage || !page.pageInfo.endCursor} onClick={() => {
                setHistory((items) => [...items, cursor])
                setCursor(page.pageInfo.endCursor)
              }}>下一页</button>
            </footer>
          </section>

          {selected && <ReturnWorkbench api={api} shopId={shopId} item={selected} canManage={canManage} busy={busy} setBusy={setBusy}
            confirmAction={confirmAction} onChanged={(message) => { setNotice(message); setReload((value) => value + 1) }} />}
        </div>
      )}
    </section>
  )
}

function ReturnWorkbench({ api, shopId, item, canManage, busy, setBusy, confirmAction, onChanged }: {
  api: CustomerServiceApi
  shopId: string
  item: ReturnItem
  canManage: boolean
  busy: boolean
  setBusy: (value: boolean) => void
  confirmAction?: ReturnsWorkspaceProps['confirmAction']
  onChanged: (message: string) => void
}) {
  const [declineReason, setDeclineReason] = useState<'FINAL_SALE' | 'OTHER' | 'RETURN_PERIOD_ENDED'>('OTHER')
  const [declineNote, setDeclineNote] = useState('')
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [refundShipping, setRefundShipping] = useState(false)
  const [duties, setDuties] = useState<Record<string, '' | 'FULL' | 'PROPORTIONAL'>>({})
  const [preview, setPreview] = useState<ReturnRefundPreview>()
  const [result, setResult] = useState<string>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    setDeclineReason('OTHER')
    setDeclineNote('')
    setQuantities({})
    setRefundShipping(false)
    setDuties({})
    setPreview(undefined)
    setResult(undefined)
    setError(undefined)
  }, [item.id])

  const selection = useMemo<ReturnRefundSelection>(() => ({
    returnId: item.id,
    lineItems: item.lineItems.flatMap((line) => quantities[line.id] > 0 ? [{ returnLineId: line.id, quantity: quantities[line.id] }] : []),
    refundShipping,
    refundDuties: item.lineItems.flatMap((line) => line.duties).flatMap<ReturnRefundDutySelection>((duty) => duties[duty.id] ? [{ dutyId: duty.id, refundType: duties[duty.id] as 'FULL' | 'PROPORTIONAL' }] : []),
  }), [duties, item, quantities, refundShipping])

  const invalidatePreview = () => {
    setPreview(undefined)
    setResult(undefined)
  }
  const decide = async (decision: 'APPROVE' | 'DECLINE') => {
    setBusy(true)
    setError(undefined)
    try {
      await api.decideReturn({ shopId, returnId: item.id, decision,
        declineReason: decision === 'DECLINE' ? declineReason : undefined,
        declineNote: decision === 'DECLINE' ? declineNote.trim() : undefined,
        notifyCustomer: true, idempotencyKey: commandKey('return-decision', item.id) })
      onChanged(decision === 'APPROVE' ? '退货请求已批准。' : '退货请求已拒绝。')
    } catch (reason) { setError(errorMessage(reason)) } finally { setBusy(false) }
  }
  const previewRefund = async () => {
    if (selection.lineItems.length === 0) {
      setError('请至少选择一项可退款商品并填写数量。')
      return
    }
    setBusy(true)
    setError(undefined)
    try { setPreview(await api.previewReturnRefund({ shopId, ...selection })) }
    catch (reason) { setError(errorMessage(reason)) }
    finally { setBusy(false) }
  }
  const processRefund = async () => {
    if (!preview?.previewToken) return
    const confirmed = await (confirmAction?.(`确认按 Shopify 预览金额 ${money(preview.refundAmount)} 执行退款？`) ?? true)
    if (!confirmed) return
    setBusy(true)
    setError(undefined)
    try {
      const response = await api.processReturnRefund({ shopId, ...selection, previewToken: preview.previewToken, notifyCustomer: true, idempotencyKey: commandKey('return-refund', item.id) })
      const message = response.outcome === 'APPLIED' ? '退款已完成。' : response.outcome === 'PENDING' ? '退款已提交，支付渠道处理中。' : '退款结果需要人工复核。'
      setResult(message)
      onChanged(message)
    } catch (reason) { setError(errorMessage(reason)) } finally { setBusy(false) }
  }

  return <section className="xzcs-card xzcs-workbench" aria-labelledby="xzcs-return-workbench-title">
    <header className="xzcs-card-heading"><div><h2 id="xzcs-return-workbench-title">{item.name}</h2><p>{item.orderName} · {statusLabel[item.status]}</p></div></header>
    {!canManage && <div className="xzcs-alert">当前账号只有查看权限，无法审核或退款。</div>}
    {error && <div className="xzcs-alert xzcs-alert-error" role="alert">{error}</div>}
    {result && <div className="xzcs-alert" role="status">{result}</div>}

    {item.status === 'REQUESTED' && <fieldset className="xzcs-panel" disabled={!canManage || busy}>
      <legend>退货审核</legend>
      <div className="xzcs-form-grid">
        <label className="xzcs-field"><span>拒绝原因</span><select value={declineReason} onChange={(event) => setDeclineReason(event.target.value as typeof declineReason)}>
          <option value="OTHER">其他原因</option><option value="FINAL_SALE">最终销售商品</option><option value="RETURN_PERIOD_ENDED">已过退货期限</option>
        </select></label>
        <label className="xzcs-field xzcs-grow"><span>拒绝说明</span><input value={declineNote} maxLength={500} onChange={(event) => setDeclineNote(event.target.value)} /></label>
      </div>
      <div className="xzcs-actions"><button className="xzcs-button xzcs-secondary" type="button" onClick={() => void decide('DECLINE')}>拒绝请求</button><button className="xzcs-button xzcs-primary" type="button" onClick={() => void decide('APPROVE')}>批准请求</button></div>
    </fieldset>}

    <fieldset className="xzcs-panel" disabled={!canManage || busy || !['OPEN', 'CLOSED'].includes(item.status)}>
      <legend>退款项目</legend>
      <p className="xzcs-help">只选择项目和数量；退款金额、币种及原支付交易全部由 Shopify 计算。</p>
      <div className="xzcs-line-list">
        {item.lineItems.map((line) => <article className="xzcs-line" key={line.id}>
          <div><strong>{line.sku || '无 SKU'}</strong><span>{line.name}</span><small>{line.reasonName || line.reasonHandle || '未填写退货原因'} · 可退 {line.refundableQuantity}</small></div>
          <label className="xzcs-field xzcs-quantity"><span>退款数量</span><input type="number" inputMode="numeric" min={0} max={line.refundableQuantity} value={quantities[line.id] ?? 0} onChange={(event) => {
            invalidatePreview()
            const value = Math.max(0, Math.min(line.refundableQuantity, Number.parseInt(event.target.value || '0', 10) || 0))
            setQuantities((current) => ({ ...current, [line.id]: value }))
          }} /></label>
          {line.duties.map((duty) => <label className="xzcs-field" key={duty.id}><span>关税 {money(duty.price)}</span><select value={duties[duty.id] ?? ''} onChange={(event) => {
            invalidatePreview()
            setDuties((current) => ({ ...current, [duty.id]: event.target.value as '' | 'FULL' | 'PROPORTIONAL' }))
          }}><option value="">不退关税</option><option value="PROPORTIONAL">按商品数量比例退款</option><option value="FULL">全额退还关税</option></select></label>)}
        </article>)}
      </div>
      <label className="xzcs-check"><input type="checkbox" checked={refundShipping} onChange={(event) => { invalidatePreview(); setRefundShipping(event.target.checked) }} /><span>全额退还可退运费</span></label>
      <div className="xzcs-actions"><button className="xzcs-button xzcs-secondary" type="button" onClick={() => void previewRefund()}>{busy ? '计算中…' : '预览退款'}</button></div>
    </fieldset>

    {preview && <section className="xzcs-preview" aria-labelledby="xzcs-refund-preview-title">
      <div><h3 id="xzcs-refund-preview-title">Shopify 退款预览</h3><p>有效期至 {dateTime(preview.expiresAt)}</p></div>
      <dl><div><dt>退款总额</dt><dd>{money(preview.refundAmount)}</dd></div><div><dt>可退上限</dt><dd>{money(preview.maximumRefundable)}</dd></div>{preview.shippingAmount && <div><dt>运费</dt><dd>{money(preview.shippingAmount)}</dd></div>}{preview.dutyAmount && <div><dt>关税</dt><dd>{money(preview.dutyAmount)}</dd></div>}</dl>
      <button className="xzcs-button xzcs-primary" type="button" disabled={busy || preview.state !== 'REFUNDABLE' || !preview.previewToken} onClick={() => void processRefund()}>{busy ? '提交中…' : '确认退款'}</button>
    </section>}
  </section>
}
