import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, RefreshCw, ShieldAlert, X } from "lucide-react";
import {
  PlatformAPI,
  Shop,
  ShopifyAuthorizationStatus,
  ShopifyOrderSummary,
  ShopifyOrderSyncState,
  ShopifyRefundLineSelection,
  ShopifyReturn,
  ShopifyReturnRefundPreview
} from "../../api";
import { Badge, Empty } from "../../components/ui";
import { ToastMessage } from "../shared/types";
import { errorText, firstTracking, orderFinancialStatusTone, orderFulfillmentStatusTone } from "../shared/helpers";
import { subscribePlatformEvents } from "../shared/platformEvents";

type Props = {
  api: PlatformAPI;
  shops: Shop[];
  canRefund: boolean;
  busy: boolean;
  setBusy: (value: boolean) => void;
  setToast: (value: ToastMessage) => void;
};

function money(value?: { amount?: string; currencyCode?: string }) {
  if (!value?.amount) return "-";
  return `${value.currencyCode || ""} ${value.amount}`.trim();
}

function dateTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function shortDate(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return date.toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function refundStatus(order: ShopifyOrderSummary) {
  switch ((order.financialStatus || "").toUpperCase()) {
    case "REFUNDED": return { label: "已退款", tone: "green" as const };
    case "PARTIALLY_REFUNDED": return { label: "部分退款", tone: "warning" as const };
    default: return { label: "未退款", tone: "muted" as const };
  }
}

function productSummary(order: ShopifyOrderSummary) {
  if (!order.lineItems?.length) return { primary: "暂无商品明细", secondary: "同步后补齐" };
  const first = order.lineItems[0];
  const quantity = order.lineItems.reduce((total, item) => total + Number(item.quantity || 0), 0);
  return {
    primary: `${first.name}${first.quantity > 1 ? ` × ${first.quantity}` : ""}`,
    secondary: order.lineItems.length > 1 ? `共 ${order.lineItems.length} 种 / ${quantity} 件` : [first.sku, first.variantTitle].filter(Boolean).join(" · ") || `${quantity} 件`
  };
}

export function OrderOperationsPanel(props: Props) {
  const [activeTab, setActiveTab] = useState<"operations" | "statistics">("operations");
  const [shopID, setShopID] = useState("");
  const [query, setQuery] = useState("");
  const [financialStatus, setFinancialStatus] = useState("");
  const [fulfillmentStatus, setFulfillmentStatus] = useState("");
  const [refundFilter, setRefundFilter] = useState("");
  const [days, setDays] = useState(30);
  const [orders, setOrders] = useState<ShopifyOrderSummary[]>([]);
  const [orderTotal, setOrderTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [syncStates, setSyncStates] = useState<ShopifyOrderSyncState[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<ShopifyOrderSummary | null>(null);
  const [returns, setReturns] = useState<ShopifyReturn[]>([]);
  const [selectedReturnID, setSelectedReturnID] = useState("");
  const [refundQuantities, setRefundQuantities] = useState<Record<string, number>>({});
  const [refundShipping, setRefundShipping] = useState(false);
  const [refundPreview, setRefundPreview] = useState<ShopifyReturnRefundPreview | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [authorizationStatuses, setAuthorizationStatuses] = useState<ShopifyAuthorizationStatus[]>([]);

  const selectedReturn = useMemo(
    () => returns.find((item) => item.id === selectedReturnID) || returns[0] || null,
    [returns, selectedReturnID]
  );

  const loadOrders = useCallback(async (quiet = false) => {
    if (!quiet) setListLoading(true);
    try {
      const result = await props.api.listSyncedShopifyOrders({
        shopId: shopID || undefined,
        query: query.trim() || undefined,
        financialStatus: financialStatus || undefined,
        fulfillmentStatus: fulfillmentStatus || undefined,
        refundStatus: refundFilter || undefined,
        days,
        page,
        pageSize
      });
      const nextOrders = result.orders || [];
      setOrders(nextOrders);
      setOrderTotal(result.total || 0);
      setSyncStates(result.sync || []);
      setSelectedOrder((current) => current ? nextOrders.find((item) => item.id === current.id && item.shopId === current.shopId) || current : null);
    } catch (error) {
      props.setToast({ tone: "error", text: `加载订单失败：${errorText(error)}` });
    } finally {
      if (!quiet) setListLoading(false);
    }
  }, [days, financialStatus, fulfillmentStatus, page, pageSize, props.api, props.setToast, query, refundFilter, shopID]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadOrders(), 250);
    return () => window.clearTimeout(timer);
  }, [loadOrders]);

  useEffect(() => {
    let refreshTimer: number | null = null;
    const unsubscribe = subscribePlatformEvents((event) => {
      if (event.type !== "shopify_order_sync.updated") return;
      const state = event.payload as ShopifyOrderSyncState | undefined;
      if (!state?.shopId || (shopID && state.shopId !== shopID)) return;
      setSyncStates((current) => {
        const without = current.filter((item) => item.shopId !== state.shopId);
        return [...without, state];
      });
      if (refreshTimer !== null) return;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void loadOrders(true);
      }, 500);
    });
    return () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      unsubscribe();
    };
  }, [loadOrders, shopID]);

  useEffect(() => {
    if (!props.canRefund) {
      setAuthorizationStatuses([]);
      return;
    }
    let active = true;
    void props.api.getShopifyAuthorizationStatus("refund").then((result) => {
      if (active) setAuthorizationStatuses(result.shops || []);
    }).catch(() => {
      if (active) setAuthorizationStatuses([]);
    });
    return () => { active = false; };
  }, [props.api, props.canRefund, props.shops]);

  useEffect(() => {
    if (!selectedOrder) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedOrder(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedOrder]);

  async function syncNow() {
    setSyncing(true);
    try {
      const started = await props.api.syncShopifyOrders(shopID || undefined);
      setSyncStates(started.sync || []);
      props.setToast({ tone: "success", text: `${shopID ? "当前店铺" : "全部店铺"}已进入后台同步队列，可继续处理其他业务` });
    } catch (error) {
      props.setToast({ tone: "error", text: `同步订单失败：${errorText(error)}` });
    } finally {
      setSyncing(false);
    }
  }

  async function loadAfterSales(order: ShopifyOrderSummary) {
    if (!order.shopId || !props.canRefund) return;
    setDetailLoading(true);
    setRefundPreview(null);
    try {
      const returnResult = await props.api.listShopifyReturns(order.shopId, order.id);
      const nextReturns = returnResult.returns || [];
      setReturns(nextReturns);
      setSelectedReturnID(nextReturns[0]?.id || "");
      const quantities: Record<string, number> = {};
      for (const item of nextReturns) {
        for (const line of item.lineItems) quantities[line.id] = Math.min(line.processableQuantity, line.refundableQuantity);
      }
      setRefundQuantities(quantities);
    } catch (error) {
      setReturns([]);
      props.setToast({ tone: "error", text: `加载售后数据失败：${errorText(error)}` });
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    if (selectedOrder) void loadAfterSales(selectedOrder);
    else {
      setReturns([]);
      setRefundPreview(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrder?.id, selectedOrder?.shopId]);

  async function copyShopifyAdminAddress(address: string) {
    try {
      await navigator.clipboard.writeText(address);
      props.setToast({ tone: "success", text: "Shopify 订单后台地址已复制，请在对应店铺已登录的浏览器中手动打开" });
    } catch (error) {
      props.setToast({ tone: "error", text: `复制 Shopify 订单后台地址失败：${errorText(error)}` });
    }
  }

  async function decideReturn(decision: "APPROVE" | "DECLINE") {
    if (!selectedReturn || !selectedOrder?.shopId) return;
    const action = decision === "APPROVE" ? "批准" : "拒绝";
    if (!window.confirm(`确认${action}退货 ${selectedReturn.name || selectedReturn.id}？此操作会写入 Shopify。`)) return;
    props.setBusy(true);
    try {
      await props.api.decideShopifyReturn(selectedOrder.shopId, {
        returnId: selectedReturn.id,
        decision,
        notifyCustomer: true,
        declineReason: decision === "DECLINE" ? "OTHER" : undefined,
        declineNote: decision === "DECLINE" ? "客服审核后拒绝退货申请" : undefined
      });
      props.setToast({ tone: "success", text: `退货申请已${action}` });
      await loadAfterSales(selectedOrder);
    } catch (error) {
      props.setToast({ tone: "error", text: `${action}退货失败：${errorText(error)}` });
    } finally {
      props.setBusy(false);
    }
  }

  function refundLines(): ShopifyRefundLineSelection[] {
    if (!selectedReturn) return [];
    return selectedReturn.lineItems
      .map((line) => ({ returnLineId: line.id, quantity: Math.max(0, Number(refundQuantities[line.id] || 0)) }))
      .filter((line) => line.quantity > 0);
  }

  async function previewRefund() {
    if (!selectedReturn || !selectedOrder?.shopId) return;
    const lineItems = refundLines();
    if (!lineItems.length) {
      props.setToast({ tone: "error", text: "请至少选择一件可退款商品" });
      return;
    }
    props.setBusy(true);
    try {
      const preview = await props.api.previewShopifyReturnRefund(selectedOrder.shopId, { returnId: selectedReturn.id, lineItems, refundShipping });
      setRefundPreview(preview);
      props.setToast({ tone: preview.state === "REFUNDABLE" ? "success" : "error", text: preview.state === "REFUNDABLE" ? "退款金额已按 Shopify 当前状态重新计算" : "当前选择不可退款" });
    } catch (error) {
      setRefundPreview(null);
      props.setToast({ tone: "error", text: `退款预览失败：${errorText(error)}` });
    } finally {
      props.setBusy(false);
    }
  }

  async function processRefund() {
    if (!selectedReturn || !selectedOrder?.shopId || !refundPreview?.previewToken || refundPreview.state !== "REFUNDABLE") return;
    const amount = money(refundPreview.refundAmount.presentmentMoney);
    if (!window.confirm(`确认向客户退款 ${amount}？系统会再次核对 Shopify 金额后执行。`)) return;
    props.setBusy(true);
    try {
      const result = await props.api.processShopifyReturnRefund(selectedOrder.shopId, {
        returnId: selectedReturn.id,
        lineItems: refundLines(),
        refundShipping,
        notifyCustomer: true,
        previewToken: refundPreview.previewToken
      });
      const suffix = result.reviewTicketId ? `，已创建复核工单 ${result.reviewTicketId}` : "";
      props.setToast({ tone: result.outcome === "APPLIED" ? "success" : "error", text: `退款结果：${result.outcome}${suffix}` });
      setRefundPreview(null);
      await loadAfterSales(selectedOrder);
      await loadOrders(true);
    } catch (error) {
      props.setToast({ tone: "error", text: `执行退款失败：${errorText(error)}` });
    } finally {
      props.setBusy(false);
    }
  }

  const syncingCount = syncStates.filter((item) => item.state === "queued" || item.state === "syncing").length;
  const failedStates = syncStates.filter((item) => item.state === "error" || item.state === "blocked");
  const successfulSyncs = syncStates.map((item) => item.lastSuccessAt || "").filter(Boolean).sort();
  const lastSuccess = successfulSyncs[successfulSyncs.length - 1];
  const pageCount = Math.max(1, Math.ceil(orderTotal / pageSize));
  const refundReauthorizationShops = authorizationStatuses.filter((item) => item.installed && item.needsReauthorization && (!shopID || item.shopId === shopID));
  const pendingInitialAuthorizationShops = authorizationStatuses.filter((item) => !item.installed && (!shopID || item.shopId === shopID));
  const configuredShopIDs = new Set(syncStates.map((item) => item.shopId));
  const orderShops = props.shops.filter((shop) => configuredShopIDs.has(shop.id));

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  return <section className="order-operations-page">
    <header className="order-page-header">
      <div><h3>订单与退款</h3><span>先在订单表格中筛选判断，再进入单笔订单处理；退款前仍以 Shopify 实时状态和金额为准。</span></div>
      <div className="order-sync-action">
        <span>{syncingCount ? `正在同步 ${syncingCount} 个店铺` : lastSuccess ? `上次同步 ${shortDate(lastSuccess)}` : "尚未同步"}</span>
        <button type="button" className="primary" disabled={syncing || syncingCount > 0} onClick={() => void syncNow()}><RefreshCw size={14} /> {syncing || syncingCount ? "同步中" : "立即同步"}</button>
      </div>
    </header>
    <nav className="order-module-tabs" aria-label="订单与退款功能">
      <button type="button" aria-pressed={activeTab === "operations"} className={activeTab === "operations" ? "active" : ""} onClick={() => setActiveTab("operations")}>订单/退款处理</button>
      <button type="button" aria-pressed={activeTab === "statistics"} className={activeTab === "statistics" ? "active" : ""} onClick={() => setActiveTab("statistics")}>订单统计 <span>规划中</span></button>
    </nav>
    {activeTab === "statistics" ? <section className="order-statistics-planned">
      <div><strong>订单统计口径正在接入</strong><p>后续按店铺和日期汇总订单量、订单金额、退款金额与退款率，并支持趋势查看。</p></div>
      <small>当前同步订单用于客服查询和退款处理，暂不直接作为财务统计口径。</small>
    </section> : <>
      {props.canRefund && refundReauthorizationShops.length ? <div className="shopify-reauthorization-notice" role="status">
        <ShieldAlert size={18} aria-hidden="true" />
        <div><strong>退款功能需要重新授权</strong><span>{shopID ? "当前店铺尚未完整授权退款权限。订单查询和现有功能不受影响，重新授权后即可使用完整退款处理。" : `${refundReauthorizationShops.length} 个店铺尚未完整授权退款权限。订单查询和现有功能不受影响，店铺重新授权后即可使用完整退款处理。`}</span></div>
      </div> : null}
      {props.canRefund && pendingInitialAuthorizationShops.length && !shopID ? <div className="shopify-reauthorization-notice" role="status">
        <ShieldAlert size={18} aria-hidden="true" />
        <div><strong>部分店铺尚未完成首次授权</strong><span>{pendingInitialAuthorizationShops.length} 个店铺已有 Shopify 配置，但尚未完成店铺管理员 OAuth 授权，因此不会进入订单同步；这不是重新授权。</span></div>
      </div> : null}
      <section className="order-operations-search" aria-label="订单筛选">
        <select aria-label="订单所属店铺" value={shopID} onChange={(event) => { setShopID(event.target.value); setPage(1); setSelectedOrder(null); }}>
          <option value="">全部店铺</option>
          {orderShops.map((shop) => <option key={shop.id} value={shop.id}>{shop.displayName}</option>)}
        </select>
        <input aria-label="搜索订单" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="订单号、客户、邮箱、商品名或 SKU" />
        <select aria-label="付款状态" value={financialStatus} onChange={(event) => { setFinancialStatus(event.target.value); setPage(1); }}>
          <option value="">全部付款状态</option><option value="PAID">已付款</option><option value="PENDING">待付款</option><option value="PARTIALLY_REFUNDED">部分退款</option><option value="REFUNDED">已退款</option>
        </select>
        <select aria-label="履约状态" value={fulfillmentStatus} onChange={(event) => { setFulfillmentStatus(event.target.value); setPage(1); }}>
          <option value="">全部履约状态</option><option value="UNFULFILLED">未发货</option><option value="PARTIALLY_FULFILLED">部分发货</option><option value="FULFILLED">已发货</option>
        </select>
        <select aria-label="退款状态" value={refundFilter} onChange={(event) => { setRefundFilter(event.target.value); setPage(1); }}>
          <option value="">全部退款状态</option><option value="none">未退款</option><option value="partial">部分退款</option><option value="refunded">已退款</option>
        </select>
        <select aria-label="订单时间" value={days} onChange={(event) => { setDays(Number(event.target.value)); setPage(1); }}>
          <option value={7}>近 7 天</option><option value={30}>近 30 天</option><option value={90}>近 90 天</option><option value={0}>全部时间</option>
        </select>
      </section>
      {failedStates.length ? <div className="order-sync-errors" role="status">{failedStates.map((item) => <span key={item.shopId}>{item.shopName} 同步失败：{item.error || "未知错误"}</span>)}</div> : null}
      <section className="order-table-card" aria-busy={listLoading}>
        <header><div><strong>订单列表</strong><span>共 {orderTotal} 条，默认按下单时间从新到旧</span></div><span>{listLoading ? "正在加载…" : `第 ${page} / ${pageCount} 页`}</span></header>
        <div className="order-table-scroll">
          <table className="order-table">
            <thead><tr><th scope="col">下单时间</th><th scope="col">订单号</th><th scope="col">店铺</th><th scope="col">客户</th><th scope="col">商品明细</th><th scope="col">订单金额</th><th scope="col">付款状态</th><th scope="col">履约状态</th><th scope="col">退款状态</th><th scope="col">操作</th></tr></thead>
            <tbody>
              {orders.map((order) => {
                const products = productSummary(order);
                const refund = refundStatus(order);
                return <tr key={`${order.shopId}-${order.id}`} className={selectedOrder?.id === order.id && selectedOrder.shopId === order.shopId ? "active" : ""}>
                  <td className="order-table-time">{shortDate(order.createdAt)}</td>
                  <td><button type="button" className="order-number-link" onClick={() => setSelectedOrder(order)}>{order.name}</button></td>
                  <td><strong>{order.shopName || "未知店铺"}</strong></td>
                  <td><div className="order-table-stacked"><strong>{order.customer?.displayName || "未知客户"}</strong><span>{order.customer?.email || order.email || "无邮箱"}</span></div></td>
                  <td><div className="order-table-stacked order-table-product"><strong title={products.primary}>{products.primary}</strong><span>{products.secondary}</span></div></td>
                  <td className="order-table-money">{money(order.total)}</td>
                  <td><Badge tone={orderFinancialStatusTone(order.financialStatus)}>{order.financialStatus || "未知"}</Badge></td>
                  <td><Badge tone={orderFulfillmentStatusTone(order.fulfillmentStatus)}>{order.fulfillmentStatus || "未发货"}</Badge></td>
                  <td><Badge tone={refund.tone}>{refund.label}</Badge></td>
                  <td><button type="button" className="order-process-button" onClick={() => setSelectedOrder(order)}>查看处理</button></td>
                </tr>;
              })}
              {!orders.length ? <tr><td colSpan={10}><Empty text={listLoading ? "正在加载订单" : syncStates.some((item) => item.orderCount > 0) ? "没有符合筛选条件的订单" : syncStates.some((item) => item.state === "ok") ? "同步成功，近 60 天没有可读取的订单" : "暂无已同步订单，请点击立即同步"} /></td></tr> : null}
            </tbody>
          </table>
        </div>
        <footer className="order-table-pagination">
          <label>每页<select aria-label="每页订单数量" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value={20}>20 条</option><option value={50}>50 条</option><option value={100}>100 条</option></select></label>
          <span>共 {orderTotal} 条</span>
          <div><button type="button" disabled={page <= 1 || listLoading} onClick={() => setPage(1)}>首页</button><button type="button" disabled={page <= 1 || listLoading} onClick={() => setPage((current) => Math.max(1, current - 1))}>上一页</button><strong>第 {page} / {pageCount} 页</strong><button type="button" disabled={page >= pageCount || listLoading} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>下一页</button><button type="button" disabled={page >= pageCount || listLoading} onClick={() => setPage(pageCount)}>末页</button></div>
        </footer>
      </section>
    </>}

    {selectedOrder ? <div className="order-detail-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedOrder(null); }}>
      <aside className="order-detail-drawer" role="dialog" aria-modal="true" aria-labelledby="order-detail-title">
        <header><div><span>{selectedOrder.shopName || "未知店铺"}</span><h3 id="order-detail-title">{selectedOrder.name}</h3><small>{dateTime(selectedOrder.createdAt)}</small></div><button type="button" className="icon-button" aria-label="关闭订单详情" title="关闭" autoFocus onClick={() => setSelectedOrder(null)}><X size={18} /></button></header>
        <div className="order-detail-body">
          <section className="order-detail-summary">
            <div><span>客户</span><strong>{selectedOrder.customer?.displayName || "未知客户"}</strong><small>{selectedOrder.customer?.email || selectedOrder.email || "无客户邮箱"}</small></div>
            <div><span>订单金额</span><strong>{money(selectedOrder.total)}</strong><small>{selectedOrder.sourceName || "Shopify"}</small></div>
          </section>
          <div className="order-operation-status"><div><span>付款</span><strong>{selectedOrder.financialStatus || "未知"}</strong></div><div><span>履约</span><strong>{selectedOrder.fulfillmentStatus || "未发货"}</strong></div><div><span>物流</span><strong>{firstTracking(selectedOrder) || "暂无运单"}</strong></div></div>
          {selectedOrder.adminUrl ? <button className="order-copy-address" type="button" onClick={() => void copyShopifyAdminAddress(selectedOrder.adminUrl!)}><Copy size={14} /> 复制 Shopify 订单地址</button> : null}

          <section className="order-detail-products"><header><strong>商品明细</strong><span>{selectedOrder.lineItems?.reduce((total, item) => total + Number(item.quantity || 0), 0) || 0} 件</span></header>{selectedOrder.lineItems?.length ? selectedOrder.lineItems.map((item, index) => <div key={`${item.sku || item.name}-${index}`}><span><strong>{item.name}</strong><small>{[item.sku, item.variantTitle].filter(Boolean).join(" · ") || "无 SKU"}</small></span><b>× {item.quantity}</b><em>{money(item.discountedTotal)}</em></div>) : <Empty text="此订单暂无已同步商品明细" />}</section>

          {props.canRefund ? <section className="after-sales-card">
            <header><div><strong>退货与退款</strong><span>进入订单时实时读取 Shopify 售后状态。</span></div><button type="button" className="icon-button" title="刷新售后状态" aria-label="刷新售后状态" disabled={detailLoading} onClick={() => void loadAfterSales(selectedOrder)}><RefreshCw size={15} /></button></header>
            {detailLoading ? <div className="order-detail-loading">正在读取 Shopify 售后状态…</div> : !returns.length ? <Empty text="此订单暂无退货申请" /> : <>
              <select aria-label="退货申请" value={selectedReturn?.id || ""} onChange={(event) => { setSelectedReturnID(event.target.value); setRefundPreview(null); }}>
                {returns.map((item) => <option key={item.id} value={item.id}>{item.name || item.id} · {item.status}</option>)}
              </select>
              {selectedReturn ? <>
                <div className="return-summary"><Badge tone={selectedReturn.status === "REQUESTED" ? "warning" : selectedReturn.status === "OPEN" ? "green" : "muted"}>{selectedReturn.status}</Badge><span>{selectedReturn.totalQuantity} 件 · {selectedReturn.createdAt?.slice(0, 10)}</span></div>
                {selectedReturn.status === "REQUESTED" ? <div className="after-sales-actions"><button type="button" className="primary" disabled={props.busy} onClick={() => void decideReturn("APPROVE")}>批准退货</button><button type="button" disabled={props.busy} onClick={() => void decideReturn("DECLINE")}>拒绝退货</button></div> : null}
                {selectedReturn.status === "OPEN" ? <>
                  <div className="refund-lines">{selectedReturn.lineItems.map((line) => <label key={line.id}><span><strong>{line.name}</strong><small>{[line.sku, line.reason].filter(Boolean).join(" · ") || "退货商品"} · 可退款 {Math.min(line.processableQuantity, line.refundableQuantity)}</small></span><input aria-label={`${line.name}退款数量`} type="number" min={0} max={Math.min(line.processableQuantity, line.refundableQuantity)} value={refundQuantities[line.id] || 0} onChange={(event) => { setRefundQuantities((current) => ({ ...current, [line.id]: Number(event.target.value) })); setRefundPreview(null); }} /></label>)}</div>
                  <label className="refund-shipping"><input type="checkbox" checked={refundShipping} onChange={(event) => { setRefundShipping(event.target.checked); setRefundPreview(null); }} /> 同时全额退还运费</label>
                  <div className="after-sales-actions"><button type="button" disabled={props.busy} onClick={() => void previewRefund()}>重新计算退款</button>{refundPreview?.state === "REFUNDABLE" ? <button className="danger" type="button" disabled={props.busy} onClick={() => void processRefund()}>确认退款 {money(refundPreview.refundAmount.presentmentMoney)}</button> : null}</div>
                  {refundPreview ? <div className="refund-preview"><span>最大可退 {money(refundPreview.maximumRefundable.presentmentMoney)}</span>{refundPreview.shippingAmount ? <span>含运费 {money(refundPreview.shippingAmount.presentmentMoney)}</span> : null}<small>预览有效至 {refundPreview.expiresAt ? new Date(refundPreview.expiresAt).toLocaleTimeString() : "-"}</small></div> : null}
                </> : null}
              </> : null}
            </>}
          </section> : null}
        </div>
      </aside>
    </div> : null}
  </section>;
}
