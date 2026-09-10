import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { shopCenterApi, type TenantShop } from "../modules/shopCenterApi";
import {
  afterSalesCommandKey,
  shopifyAfterSalesApi,
  type RefundPreview,
  type ShopifyDispute,
  type ShopifyDisputePage,
  type ShopifyReturn,
  type ShopifyReturnPage,
} from "../modules/shopifyAfterSalesApi";
import { shopifyScopePreflight } from "../modules/shopifyScopePreflight";

const returnStatus: Record<ShopifyReturn["status"], string> = {
  CANCELED: "已取消",
  CLOSED: "已关闭",
  DECLINED: "已拒绝",
  OPEN: "处理中",
  REQUESTED: "待审核",
};

const disputeStatus: Record<ShopifyDispute["status"], string> = {
  ACCEPTED: "已接受",
  LOST: "申诉失败",
  NEEDS_RESPONSE: "待补充证据",
  PREVENTED: "已拦截",
  UNDER_REVIEW: "审核中",
  WON: "申诉成功",
  CHARGE_REFUNDED: "已退款",
};

async function activeShops() {
  const first = await shopCenterApi.listShops({ page: 0, size: 200, status: "ACTIVE" });
  if (first.page !== 0 || first.size !== 200 || first.totalPages > 100) throw new Error("Unexpected shop pagination");
  const items = [...first.items];
  for (let page = 1; page < first.totalPages; page += 1) {
    const next = await shopCenterApi.listShops({ page, size: 200, status: "ACTIVE" });
    if (next.page !== page || next.totalElements !== first.totalElements || next.totalPages !== first.totalPages) throw new Error("Inconsistent shop pagination");
    items.push(...next.items);
  }
  if (items.length !== first.totalElements || new Set(items.map((item) => item.id)).size !== items.length) throw new Error("Incomplete shop pagination");
  return items;
}

function useActiveShops() {
  const [shops, setShops] = useState<TenantShop[]>([]);
  const [shopId, setShopId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    void activeShops().then((items) => {
      if (!active) return;
      setShops(items);
      setShopId((current) => items.some((item) => item.id === current) ? current : items[0]?.id ?? "");
    }).catch(() => active && setError("店铺列表暂时无法读取，请稍后重试。"))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [reload]);
  return { shops, shopId, setShopId, loading, error, retry: () => setReload((value) => value + 1) };
}

function dateTime(value?: string) {
  if (!value) return "未提供";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(new Date(value));
}

function money(value: { presentmentMoney: { amount: string; currencyCode: string } }) {
  return `${value.presentmentMoney.amount} ${value.presentmentMoney.currencyCode}`;
}

function safeError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 403) return "当前账号没有执行此操作的权限。";
    if (error.code === "SHOPIFY_AUTHORIZATION_CONFLICT") return "Shopify 授权不完整，请到店铺详情重新授权后重试。";
    if (error.status === 409) return "平台结果暂未确认，请保留当前内容并使用同一操作重试。";
  }
  return "操作未能安全完成，请稍后重试。";
}

export function ShopifyReturnRefundPage() {
  const { hasPermission } = useAuth();
  const canWrite = hasPermission("orders.write");
  const directory = useActiveShops();
  const [keyword, setKeyword] = useState("");
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState<string>();
  const [history, setHistory] = useState<(string | undefined)[]>([]);
  const [page, setPage] = useState<ShopifyReturnPage>();
  const [selectedId, setSelectedId] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!directory.shopId) {
      setPage(undefined);
      return;
    }
    let active = true;
    setLoading(true);
    setError(undefined);
    void shopifyScopePreflight(directory.shopId, "write_returns", "读取退货数据")
      .then((permissionError) => {
        if (!active) return undefined;
        if (permissionError) {
          setError(permissionError);
          return undefined;
        }
        return shopifyAfterSalesApi.listReturns(directory.shopId, 50, cursor, query || undefined);
      })
      .then((result) => {
        if (!active || !result) return;
        setPage(result);
        setSelectedId((current) => result.returns.some((item) => item.externalReturnRef === current) ? current : result.returns[0]?.externalReturnRef);
      })
      .catch((reason) => {
        if (!active) return;
        setError(safeError(reason));
        requestAnimationFrame(() => errorRef.current?.focus());
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [cursor, directory.shopId, query, reload]);

  const selected = useMemo(() => page?.returns.find((item) => item.externalReturnRef === selectedId), [page, selectedId]);
  const resetPaging = () => { setCursor(undefined); setHistory([]); };

  return <main className="page-stack order-center-page shopify-after-sales-page" aria-labelledby="return-refund-title">
    <header className="page-heading after-sales-heading">
      <div><h1 id="return-refund-title">退货与退款</h1><p>处理 Shopify 退货请求，先按平台实时金额预览，再执行退款。</p></div>
      <label className="compact-field"><span>店铺</span><select value={directory.shopId} disabled={directory.loading || directory.shops.length === 0} onChange={(event) => { directory.setShopId(event.target.value); resetPaging(); }}>
        {directory.shops.map((shop) => <option key={shop.id} value={shop.id}>{shop.displayName}</option>)}
      </select></label>
    </header>

    <form className="order-filter-bar erp-filter-panel" aria-label="退货筛选" onSubmit={(event) => {
      event.preventDefault();
      resetPaging();
      setQuery(keyword.trim() ? `name:${keyword.trim().replace(/^#/, "").replace(/[()]/g, "")}` : "");
    }}>
      <label className="order-keyword-filter"><span>订单号</span><input value={keyword} maxLength={120} placeholder="例如 1001" onChange={(event) => setKeyword(event.target.value)} /></label>
      <button className="primary-button" type="submit" disabled={loading || !directory.shopId}>{loading ? "查询中" : "查询"}</button>
      <button className="secondary-button" type="button" disabled={loading} onClick={() => { setKeyword(""); setQuery(""); resetPaging(); }}>重置</button>
    </form>

    {directory.error && <div className="form-error" role="alert"><span>{directory.error}</span><button className="text-button" type="button" onClick={directory.retry}>重试</button></div>}
    {error && <div className="form-error" role="alert" ref={errorRef} tabIndex={-1}><span>{error}</span><button className="text-button" type="button" onClick={() => setReload((value) => value + 1)}>重试</button></div>}
    {notice && <div className="inline-notice" role="status">{notice}</div>}
    {(loading || directory.loading) && <div className="loading-state" role="status">正在读取退货数据</div>}
    {!loading && !directory.loading && directory.shops.length === 0 && <div className="empty-state">暂无已连接的 Shopify 店铺。</div>}

    {!loading && page && <section className="data-card">
      <header className="table-heading"><div><h2>退货单</h2><p>更新于 {dateTime(page.fetchedAt)}</p></div><span>{page.returns.length} 条</span></header>
      <div className="shop-table-scroll"><table className="shop-table" aria-label="Shopify 退货单">
        <thead><tr><th>退货单 / 订单</th><th>状态</th><th>商品</th><th>数量</th><th>创建时间</th><th>操作</th></tr></thead>
        <tbody>{page.returns.map((item) => <tr key={item.externalReturnRef} className={item.externalReturnRef === selectedId ? "is-selected" : undefined}>
          <td><strong>{item.name}</strong><small>{item.orderName}</small></td>
          <td><span className={`status-badge return-status-${item.status.toLowerCase()}`}>{returnStatus[item.status]}</span></td>
          <td><strong>{item.lineItems[0]?.sku || "无 SKU"}</strong><small>{item.lineItems[0]?.name}{item.lineItems.length > 1 ? ` 等 ${item.lineItems.length} 项` : ""}</small></td>
          <td>{item.totalQuantity}</td><td>{dateTime(item.createdAt)}</td>
          <td><button className="text-button" type="button" aria-pressed={item.externalReturnRef === selectedId} onClick={() => setSelectedId(item.externalReturnRef)}>处理</button></td>
        </tr>)}{page.returns.length === 0 && <tr><td colSpan={6}>当前条件下没有退货记录。</td></tr>}</tbody>
      </table></div>
      <footer className="table-pagination"><button className="secondary-button" type="button" disabled={history.length === 0} onClick={() => { setCursor(history.at(-1)); setHistory((items) => items.slice(0, -1)); }}>上一页</button><button className="secondary-button" type="button" disabled={!page.hasNextPage || !page.cursor} onClick={() => { setHistory((items) => [...items, cursor]); setCursor(page.cursor); }}>下一页</button></footer>
    </section>}

    {selected && <ReturnWorkbench key={selected.externalReturnRef} item={selected} shopId={directory.shopId} canWrite={canWrite} onChanged={(message) => { setNotice(message); setReload((value) => value + 1); }} />}
  </main>;
}

function ReturnWorkbench({ item, shopId, canWrite, onChanged }: { item: ShopifyReturn; shopId: string; canWrite: boolean; onChanged: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [declineReason, setDeclineReason] = useState<"FINAL_SALE" | "OTHER" | "RETURN_PERIOD_ENDED">("OTHER");
  const [declineNote, setDeclineNote] = useState("");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [refundShipping, setRefundShipping] = useState(false);
  const [preview, setPreview] = useState<RefundPreview>();
  const refundEnabled = item.status === "OPEN";
  const refundUnavailableMessage = item.status === "REQUESTED"
    ? "请先批准退货请求，再预览退款。"
    : !refundEnabled
      ? "当前退货状态不允许继续退款。"
      : undefined;

  const selection = useMemo(() => ({
    externalReturnRef: item.externalReturnRef,
    lineItems: item.lineItems.flatMap((line) => (quantities[line.externalReturnLineRef] ?? 0) > 0 ? [{ externalReturnLineRef: line.externalReturnLineRef, quantity: quantities[line.externalReturnLineRef] }] : []),
    refundShipping,
    refundDuties: [],
  }), [item, quantities, refundShipping]);

  const decide = async (decision: "APPROVE" | "DECLINE") => {
    if (decision === "DECLINE" && !window.confirm("确认拒绝这条退货请求？")) return;
    const body = { decision, declineReason: decision === "DECLINE" ? declineReason : undefined, declineNote: decision === "DECLINE" ? declineNote.trim() : undefined, notifyCustomer: true };
    setBusy(true); setError(undefined);
    try {
      const permissionError = await shopifyScopePreflight(shopId, "write_returns", "处理退货请求");
      if (permissionError) { setError(permissionError); return; }
      await shopifyAfterSalesApi.decideReturn({ shopId, externalReturnRef: item.externalReturnRef, ...body, idempotencyKey: afterSalesCommandKey("return-decision", item.externalReturnRef, body) });
      onChanged(decision === "APPROVE" ? "退货请求已批准。" : "退货请求已拒绝。");
    } catch (reason) { setError(safeError(reason)); } finally { setBusy(false); }
  };

  const calculate = async () => {
    if (selection.lineItems.length === 0) { setError("请至少填写一项退款数量。"); return; }
    setBusy(true); setError(undefined);
    try {
      const permissionError = await shopifyScopePreflight(shopId, "write_returns", "预览退款");
      if (permissionError) { setError(permissionError); return; }
      const orderPermissionError = await shopifyScopePreflight(shopId, "write_orders", "预览退款");
      if (orderPermissionError) { setError(orderPermissionError); return; }
      setPreview(await shopifyAfterSalesApi.previewRefund({ shopId, ...selection }));
    }
    catch (reason) { setError(safeError(reason)); } finally { setBusy(false); }
  };

  const process = async () => {
    if (!preview?.previewToken) return;
    if (!preview.expiresAt || Date.parse(preview.expiresAt) <= Date.now()) {
      setPreview(undefined);
      setError("退款预览已过期，请重新预览后再提交。");
      return;
    }
    if (!window.confirm(`确认按 Shopify 预览金额 ${money(preview.refundAmount)} 执行退款？`)) return;
    const body = { ...selection, previewToken: preview.previewToken, notifyCustomer: true };
    setBusy(true); setError(undefined);
    try {
      const permissionError = await shopifyScopePreflight(shopId, "write_returns", "执行退款");
      if (permissionError) { setError(permissionError); return; }
      const orderPermissionError = await shopifyScopePreflight(shopId, "write_orders", "执行退款");
      if (orderPermissionError) { setError(orderPermissionError); return; }
      const result = await shopifyAfterSalesApi.processRefund({ shopId, ...body, idempotencyKey: afterSalesCommandKey("return-refund", item.externalReturnRef, body) });
      onChanged(result.outcome === "APPLIED" ? "退款已完成。" : result.outcome === "PENDING" ? "退款已提交，支付渠道处理中。" : "退款结果需要人工复核，请勿重复提交。" );
    } catch (reason) { setError(safeError(reason)); } finally { setBusy(false); }
  };

  return <section className="data-card after-sales-workbench" aria-labelledby="return-workbench-title">
    <header className="table-heading"><div><h2 id="return-workbench-title">{item.name}</h2><p>{item.orderName} · {returnStatus[item.status]}</p></div></header>
    {!canWrite && <div className="inline-notice">当前账号只有查看权限。</div>}
    {error && <div className="form-error" role="alert">{error}</div>}
    {item.status === "REQUESTED" && <fieldset className="after-sales-panel" disabled={!canWrite || busy}>
      <legend>退货审核</legend><div className="after-sales-form-grid">
        <label><span>拒绝原因</span><select value={declineReason} onChange={(event) => setDeclineReason(event.target.value as typeof declineReason)}><option value="OTHER">其他原因</option><option value="FINAL_SALE">最终销售商品</option><option value="RETURN_PERIOD_ENDED">已过退货期限</option></select></label>
        <label><span>拒绝说明</span><input value={declineNote} maxLength={500} onChange={(event) => setDeclineNote(event.target.value)} /></label>
      </div><div className="page-actions"><button className="secondary-button" type="button" onClick={() => void decide("DECLINE")}>拒绝请求</button><button className="primary-button" type="button" onClick={() => void decide("APPROVE")}>批准请求</button></div>
    </fieldset>}
    <fieldset className="after-sales-panel" disabled={!canWrite || busy || !refundEnabled}>
      <legend>退款项目</legend><p className="field-hint">金额、币种和原支付交易由 Shopify 实时计算，ERP 不允许手工改金额。</p>
      {refundUnavailableMessage && <p className="field-hint after-sales-disabled-reason">{refundUnavailableMessage}</p>}
      <div className="after-sales-lines">{item.lineItems.map((line) => <div className="after-sales-line" key={line.externalReturnLineRef}><div><strong>{line.sku || "无 SKU"}</strong><span>{line.name}</span><small>{line.reasonName || line.reasonHandle || "未填写退货原因"} · 可退 {line.refundableQuantity}</small></div><label><span>退款数量</span><input type="number" inputMode="numeric" min={0} max={line.refundableQuantity} value={quantities[line.externalReturnLineRef] ?? 0} onChange={(event) => { setPreview(undefined); const value = Math.max(0, Math.min(line.refundableQuantity, Number.parseInt(event.target.value || "0", 10) || 0)); setQuantities((current) => ({ ...current, [line.externalReturnLineRef]: value })); }} /></label></div>)}</div>
      <label className="checkbox-label"><input type="checkbox" checked={refundShipping} onChange={(event) => { setPreview(undefined); setRefundShipping(event.target.checked); }} /><span>退还平台判定可退的全部运费</span></label>
      <div className="page-actions"><button className="secondary-button" type="button" onClick={() => void calculate()}>{busy ? "计算中" : "预览退款"}</button></div>
    </fieldset>
    {preview && <section className="refund-preview" aria-labelledby="refund-preview-title"><div><h3 id="refund-preview-title">Shopify 退款预览</h3><p>有效期至 {dateTime(preview.expiresAt)}</p></div><dl><div><dt>退款总额</dt><dd>{money(preview.refundAmount)}</dd></div><div><dt>可退上限</dt><dd>{money(preview.maximumRefundable)}</dd></div>{preview.shippingAmount && <div><dt>运费</dt><dd>{money(preview.shippingAmount)}</dd></div>}</dl><button className="primary-button" type="button" disabled={busy || preview.state !== "REFUNDABLE" || !preview.previewToken} onClick={() => void process()}>{busy ? "提交中" : "确认退款"}</button></section>}
  </section>;
}

export function ShopifyDisputePage() {
  const directory = useActiveShops();
  const [page, setPage] = useState<ShopifyDisputePage>();
  const [cursor, setCursor] = useState<string>();
  const [history, setHistory] = useState<(string | undefined)[]>([]);
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!directory.shopId) { setPage(undefined); return; }
    let active = true; setLoading(true); setError(undefined);
    void shopifyScopePreflight(
      directory.shopId,
      "read_shopify_payments_disputes",
      "读取拒付数据",
    )
      .then((permissionError) => {
        if (!active) return undefined;
        if (permissionError) {
          setError(permissionError);
          return undefined;
        }
        return shopifyAfterSalesApi.listDisputes(directory.shopId, 50, cursor);
      }).then((result) => {
      if (!active || !result) return; setPage(result);
    }).catch((reason) => {
      if (!active) return;
      setError(safeError(reason));
      requestAnimationFrame(() => errorRef.current?.focus());
    }).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [cursor, directory.shopId, reload]);

  return <main className="page-stack order-center-page shopify-after-sales-page" aria-labelledby="dispute-title">
    <header className="page-heading after-sales-heading"><div><h1 id="dispute-title">拒付管理</h1><p>同步查看 Shopify Payments 拒付状态、金额、原因和处理截止时间。</p></div><label className="compact-field"><span>店铺</span><select value={directory.shopId} disabled={directory.loading || directory.shops.length === 0} onChange={(event) => { directory.setShopId(event.target.value); setCursor(undefined); setHistory([]); }}>{directory.shops.map((shop) => <option key={shop.id} value={shop.id}>{shop.displayName}</option>)}</select></label></header>
    {directory.error && <div className="form-error" role="alert"><span>{directory.error}</span><button className="text-button" type="button" onClick={directory.retry}>重试</button></div>}
    {error && <div className="form-error" role="alert" ref={errorRef} tabIndex={-1}><span>{error}</span><button className="text-button" type="button" onClick={() => setReload((value) => value + 1)}>重试</button></div>}
    {(loading || directory.loading) && <div className="loading-state" role="status">正在读取拒付数据</div>}
    {!loading && !directory.loading && directory.shops.length === 0 && <div className="empty-state">暂无已连接的 Shopify 店铺。</div>}
    {!loading && page && <div className="inline-notice">证据材料的查看、编辑和提交请在 Shopify Admin 中完成；当前版本仅同步拒付元数据。</div>}
    {!loading && page && <section className="data-card"><header className="table-heading"><div><h2>拒付列表</h2><p>更新于 {dateTime(page.fetchedAt)}</p></div><span>{page.disputes.length} 条</span></header><div className="shop-table-scroll"><table className="shop-table" aria-label="Shopify 拒付列表"><thead><tr><th>订单</th><th>状态</th><th>类型 / 原因</th><th>金额</th><th>发起时间</th><th>处理截止</th></tr></thead><tbody>{page.disputes.map((item) => <tr key={item.externalDisputeRef}><td>{item.orderName || item.externalOrderRef || "未关联订单"}</td><td><span className="status-badge">{disputeStatus[item.status]}</span></td><td>{item.type === "CHARGEBACK" ? "拒付" : "查询"}<small>{item.reason}{item.networkReasonCode ? ` · ${item.networkReasonCode}` : ""}</small></td><td>{item.amount.amount} {item.amount.currencyCode}</td><td>{dateTime(item.initiatedAt)}</td><td>{dateTime(item.evidenceDueBy)}</td></tr>)}{page.disputes.length === 0 && <tr><td colSpan={6}>当前店铺没有拒付记录。</td></tr>}</tbody></table></div><footer className="table-pagination"><button className="secondary-button" type="button" disabled={history.length === 0} onClick={() => { setCursor(history.at(-1)); setHistory((items) => items.slice(0, -1)); }}>上一页</button><button className="secondary-button" type="button" disabled={!page.hasNextPage || !page.cursor} onClick={() => { setHistory((items) => [...items, cursor]); setCursor(page.cursor); }}>下一页</button></footer></section>}
  </main>;
}
