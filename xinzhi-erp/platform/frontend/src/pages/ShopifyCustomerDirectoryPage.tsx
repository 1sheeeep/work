import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../api/client";
import {
  shopCenterApi,
  type PlatformCatalogEntry,
  type TenantShop,
} from "../modules/shopCenterApi";
import { shopifyCustomerApi, type ShopifyCustomerPage, type ShopifyCustomerProfile } from "../modules/shopifyCustomerApi";
import { shopifyScopePreflight } from "../modules/shopifyScopePreflight";

type DirectoryPage<T> = {
  page: number;
  size: number;
  totalPages: number;
  totalElements: number;
  items: T[];
};

async function stableDirectory<T extends { id: string }>(
  load: (page: number) => Promise<DirectoryPage<T>>,
) {
  const first = await load(0);
  if (first.page !== 0 || first.size !== 200 || first.totalPages > 100) {
    throw new Error("Unexpected directory pagination");
  }
  const items = [...first.items];
  for (let page = 1; page < first.totalPages; page += 1) {
    const next = await load(page);
    if (
      next.page !== page ||
      next.totalElements !== first.totalElements ||
      next.totalPages !== first.totalPages
    ) {
      throw new Error("Inconsistent directory pagination");
    }
    items.push(...next.items);
  }
  if (
    items.length !== first.totalElements ||
    new Set(items.map((item) => item.id)).size !== items.length
  ) {
    throw new Error("Incomplete directory pagination");
  }
  return items;
}

async function activeShopifyShops() {
  const [shops, platforms] = await Promise.all([
    stableDirectory<TenantShop>((page) =>
      shopCenterApi.listShops({ page, size: 200, status: "ACTIVE" })),
    stableDirectory<PlatformCatalogEntry>((page) =>
      shopCenterApi.listPlatforms({ page, size: 200, includeArchived: false })),
  ]);
  const shopifyPlatformIds = new Set(
    platforms
      .filter((platform) => platform.code.trim().toUpperCase() === "SHOPIFY")
      .map((platform) => platform.id),
  );
  return shops.filter((shop) => shopifyPlatformIds.has(shop.platformId));
}

function dateTime(value?: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(new Date(value));
}

function money(value: { amount: string; currencyCode: string }) {
  return `${value.amount} ${value.currencyCode}`;
}

function financialStatus(value?: string) {
  const labels: Record<string, string> = {
    AUTHORIZED: "已授权",
    PAID: "已支付",
    PARTIALLY_PAID: "部分支付",
    PARTIALLY_REFUNDED: "部分退款",
    PENDING: "待支付",
    REFUNDED: "已退款",
    VOIDED: "已作废",
  };
  return labels[value?.trim().toUpperCase() ?? ""] ?? "状态未知";
}

function fulfillmentStatus(value?: string) {
  const labels: Record<string, string> = {
    FULFILLED: "已履约",
    IN_PROGRESS: "处理中",
    ON_HOLD: "已暂停",
    OPEN: "未完成",
    PARTIAL: "部分履约",
    RESTOCKED: "已退回库存",
    SCHEDULED: "已计划",
    UNFULFILLED: "未履约",
  };
  return labels[value?.trim().toUpperCase() ?? ""] ?? "状态未知";
}

function customerLocation(customer: ShopifyCustomerProfile) {
  const value = customer.defaultLocation;
  return [value?.city, value?.province, value?.country].filter(Boolean).join(" · ") || "—";
}

function safeError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 403) return "当前账号无权查看客户档案。";
    if (error.code === "SHOPIFY_AUTHORIZATION_CONFLICT") {
      return "Shopify 客户资料权限尚未授权或受保护客户数据尚未获批，请完成授权后重试。";
    }
  }
  return "客户档案暂时无法读取，请稍后重试。";
}

export function ShopifyCustomerDirectoryPage() {
  const [shops, setShops] = useState<TenantShop[]>([]);
  const [shopId, setShopId] = useState("");
  const [shopsLoading, setShopsLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState<string>();
  const [history, setHistory] = useState<(string | undefined)[]>([]);
  const [page, setPage] = useState<ShopifyCustomerPage>();
  const [selectedId, setSelectedId] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState<string>();
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    setShopsLoading(true);
    void activeShopifyShops().then((items) => {
      if (!active) return;
      setShops(items);
      setShopId((current) => items.some((item) => item.id === current) ? current : items[0]?.id ?? "");
    }).catch(() => active && setError("店铺列表暂时无法读取，请稍后重试。"))
      .finally(() => active && setShopsLoading(false));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!shopId) {
      setPage(undefined);
      return;
    }
    let active = true;
    setLoading(true);
    setError(undefined);
    void (async () => {
      const permissionError = await shopifyScopePreflight(
        shopId,
        "read_customers",
        "读取客户档案",
      );
      if (!active) return;
      if (permissionError) {
        setError(permissionError);
        return;
      }
      const result = await shopifyCustomerApi.list(shopId, 25, cursor, query || undefined);
        if (!active) return;
        setPage(result);
        setSelectedId((current) => result.customers.some((item) => item.externalCustomerRef === current)
          ? current : result.customers[0]?.externalCustomerRef);
      })()
      .catch((reason) => {
        if (!active) return;
        setError(safeError(reason));
        requestAnimationFrame(() => errorRef.current?.focus());
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [cursor, query, reload, shopId]);

  const selected = useMemo(
    () => page?.customers.find((item) => item.externalCustomerRef === selectedId),
    [page, selectedId],
  );
  const resetPaging = () => { setCursor(undefined); setHistory([]); };

  return <main className="page-stack order-center-page customer-directory-page" aria-labelledby="customer-directory-title">
    <h1 className="sr-only" id="customer-directory-title">Shopify 客户目录</h1>

    <section className="customer-directory-boundary" aria-label="客户资料使用边界">
      <div>
        <strong>只读客户资料</strong>
        <span>仅显示履约和售后需要的最小联系信息、所在地区与订单关系。</span>
      </div>
      <span>不提供客户编辑、营销、导出、会话或工单操作</span>
    </section>

    <form className="order-filter-bar erp-filter-panel customer-directory-filter" aria-label="客户筛选" onSubmit={(event) => {
      event.preventDefault();
      resetPaging();
      setQuery(keyword.trim());
    }}>
      <label className="compact-field customer-directory-shop-filter"><span>店铺</span>
        <select value={shopId} disabled={shopsLoading || shops.length === 0} onChange={(event) => { setShopId(event.target.value); resetPaging(); }}>
          {shops.map((shop) => <option key={shop.id} value={shop.id}>{shop.displayName}</option>)}
        </select>
      </label>
      <label className="order-keyword-filter"><span>客户关键词</span>
        <input value={keyword} maxLength={200} placeholder="姓名、邮箱或手机号" onChange={(event) => setKeyword(event.target.value)} />
      </label>
      <button className="primary-button" type="submit" disabled={loading || !shopId}>{loading ? "查询中" : "查询"}</button>
      <button className="secondary-button" type="button" disabled={loading} onClick={() => { setKeyword(""); setQuery(""); resetPaging(); }}>重置</button>
      <button className="secondary-button" type="button" disabled={loading || !shopId} onClick={() => setReload((value) => value + 1)}>刷新</button>
    </form>

    {error && <div className="inline-alert" role="alert" tabIndex={-1} ref={errorRef}>{error}</div>}
    {!shopsLoading && shops.length === 0 && <section className="detail-card empty-state"><h2>暂无可用的 Shopify 店铺</h2><p>请先在店铺中心确认 Shopify 店铺已启用并完成应用授权。</p></section>}

    {shopId && <section className="customer-directory-layout" aria-busy={loading}>
      <div className="data-card customer-directory-list">
        <div className="data-card-header"><div><h2>客户列表</h2><p>{page
          ? `本页 ${page.customers.length} 位 · 更新于 ${dateTime(page.fetchedAt)}`
          : loading
            ? "正在读取客户资料"
            : error
              ? "当前店铺客户资料不可用"
            : "尚未读取客户资料"}</p></div></div>
        {page && (
          <dl className="customer-directory-summary" aria-label="客户目录摘要">
            <div><dt>本页客户</dt><dd>{page.customers.length}</dd></div>
            <div><dt>已有订单</dt><dd>{page.customers.filter((customer) => Number(customer.numberOfOrders) > 0).length}</dd></div>
            <div><dt>最近读取</dt><dd>{dateTime(page.fetchedAt)}</dd></div>
          </dl>
        )}
        <div className="table-scroll">
          <table className="erp-table customer-directory-table">
            <thead><tr><th>客户</th><th>联系方式</th><th>地区</th><th>订单 / 累计消费</th><th>最近订单</th><th>更新时间</th></tr></thead>
            <tbody>
              {page?.customers.map((customer) => <tr key={customer.externalCustomerRef} className={customer.externalCustomerRef === selectedId ? "is-selected" : undefined}>
                <td><button className="table-row-selector" type="button" onClick={() => setSelectedId(customer.externalCustomerRef)} aria-pressed={customer.externalCustomerRef === selectedId}><strong>{customer.displayName}</strong><span>{customer.legacyResourceId ? `ID ${customer.legacyResourceId}` : "Shopify 客户"}</span></button></td>
                <td><span>{customer.email || "—"}</span><small>{customer.phone || "—"}</small></td>
                <td>{customerLocation(customer)}</td>
                <td><strong>{customer.numberOfOrders} 单</strong><small>{money(customer.totalSpent)}</small></td>
                <td>{customer.lastOrder ? <><strong>{customer.lastOrder.name}</strong><small>{money(customer.lastOrder.total)}</small></> : "—"}</td>
                <td>{dateTime(customer.updatedAt)}</td>
              </tr>)}
              {!loading && page?.customers.length === 0 && <tr><td colSpan={6}><div className="empty-table-state">没有找到符合条件的客户。</div></td></tr>}
            </tbody>
          </table>
        </div>
        <div className="table-pagination customer-directory-pagination">
          <span>{query ? `筛选：${query}` : "全部客户"}</span><div>
            <button className="secondary-button" type="button" disabled={loading || history.length === 0} onClick={() => { const copy = [...history]; setCursor(copy.pop()); setHistory(copy); }}>上一页</button>
            <button className="secondary-button" type="button" disabled={loading || !page?.hasNextPage || !page.cursor} onClick={() => { setHistory((items) => [...items, cursor]); setCursor(page?.cursor); }}>下一页</button>
          </div>
        </div>
      </div>

      <aside className="detail-card customer-profile-card" aria-label="客户档案详情">
        {selected ? <>
          <div className="detail-card-header"><div><span className="eyebrow">客户资料</span><h2>{selected.displayName}</h2></div><span className={`status-pill ${selected.verifiedEmail ? "status-success" : "status-neutral"}`}>{selected.verifiedEmail ? "邮箱已验证" : "邮箱未验证"}</span></div>
          <dl className="customer-profile-facts">
            <div className="customer-profile-email"><dt>邮箱</dt><dd>{selected.email || "—"}</dd></div>
            <div><dt>手机号</dt><dd>{selected.phone || "—"}</dd></div>
            <div><dt>默认地区</dt><dd>{customerLocation(selected)}</dd></div>
            <div><dt>加入时间</dt><dd>{dateTime(selected.createdAt)}</dd></div>
            <div><dt>订单数</dt><dd>{selected.numberOfOrders}</dd></div>
            <div><dt>累计消费</dt><dd>{money(selected.totalSpent)}</dd></div>
          </dl>
          <section className="customer-profile-section"><h3>最近订单</h3>{selected.lastOrder ? <div className="customer-last-order"><div><strong>{selected.lastOrder.name}</strong><span>{dateTime(selected.lastOrder.createdAt)}</span></div><dl><div><dt>金额</dt><dd>{money(selected.lastOrder.total)}</dd></div><div><dt>支付状态</dt><dd>{financialStatus(selected.lastOrder.financialStatus)}</dd></div><div><dt>履约状态</dt><dd>{fulfillmentStatus(selected.lastOrder.fulfillmentStatus)}</dd></div></dl><a className="primary-button" href={`/orders?view=queue&page=0&keyword=${encodeURIComponent(selected.lastOrder.name)}`}>查看相关订单</a></div> : <p className="muted-text">该客户暂无订单。</p>}</section>
          <p className="customer-privacy-note">客户资料按需实时读取；此页面不会编辑 Shopify 客户，也不会执行营销、导出、会话或工单操作。</p>
        </> : <div className="empty-state"><h2>选择客户</h2><p>从左侧列表选择一位客户查看档案。</p></div>}
      </aside>
    </section>}
  </main>;
}
