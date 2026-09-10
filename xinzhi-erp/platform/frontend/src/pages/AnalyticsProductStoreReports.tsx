import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { ApiError } from "../api/client";
import { storeHealthApi, STORE_AUTHORIZATION_STATUSES, type StoreAuthorizationStatus, type StoreHealthPage } from "../modules/storeHealthApi";
import { InventoryAgingReport } from "./InventoryAgingReport";
import { InventoryPeriodReport } from "./InventoryPeriodReport";
import "./WarehouseArchiveShells.css";

const STORE_HEALTH_DEFAULT_SIZE = 25;
type StoreHealthQuery = { query: string; platform: string; authorizationStatus: StoreAuthorizationStatus | ""; page: number; size: number };
type StoreHealthState = { status: "loading" } | { status: "ready"; data: StoreHealthPage } | { status: "error"; message: string };
const authorizationLabels: Record<StoreAuthorizationStatus, string> = { NOT_REQUIRED: "无需授权", NOT_AUTHORIZED: "未授权", PENDING: "授权处理中", AUTHORIZED: "已授权", EXPIRED: "授权已过期", REVOKED: "授权已撤销", ERROR: "授权异常" };
const syncTypeLabels = { FULL: "全量同步", ORDERS: "订单同步", PRODUCTS: "商品同步", INVENTORY: "库存同步" } as const;
const syncStatusLabels = { QUEUED: "等待中", RUNNING: "进行中", SUCCEEDED: "已完成", FAILED: "失败", CANCELLED: "已取消" } as const;

function boundedText(value: string | null, maximum: number) { return (value ?? "").trim().slice(0, maximum); }
function dateValue(value: string | null) { const candidate = boundedText(value, 10); return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : ""; }
function uuidValue(value: string | null) { const candidate = boundedText(value, 36); return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate) ? candidate : ""; }

function Page({ group, title, children }: { group: string; title: string; children: ReactNode }) {
  const id = `analytics-${title.replace(/[^a-zA-Z0-9]/g, "-")}-title`;
  return <main className="warehouse-archive-page" aria-labelledby={id}><header className="warehouse-archive-heading"><div><p className="eyebrow">报表 / {group}</p><h1 id={id}>{title}</h1><p>查看报表数据。</p></div></header><section className="warehouse-archive-card" aria-label={`${title}筛选与结果`}>{children}</section></main>;
}
function boundedInteger(value: string | null, fallback: number, minimum: number, maximum: number) { const parsed = Number(value); return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback; }

export function parseInventoryReportQuery(search: string) {
  const p = new URLSearchParams(search);
  return { startDate: dateValue(p.get("startDate")), endDate: dateValue(p.get("endDate")), keyword: boundedText(p.get("keyword"), 100) };
}
export function toInventoryReportUrl(query: ReturnType<typeof parseInventoryReportQuery>) {
  const p = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => { if (value) p.set(key, value); });
  const serialized = p.toString(); return serialized ? `/analytics/products/inventory-report?${serialized}` : "/analytics/products/inventory-report";
}

export function parseInventoryAgingQuery(search: string) {
  const p = new URLSearchParams(search);
  return {
    keyword: boundedText(p.get("keyword"), 100),
    cutoff: dateValue(p.get("cutoff")),
    warehouseId: uuidValue(p.get("warehouseId")),
  };
}

export function toInventoryAgingUrl(
  query: ReturnType<typeof parseInventoryAgingQuery>,
) {
  const p = new URLSearchParams();
  if (query.keyword) p.set("keyword", query.keyword);
  if (query.cutoff) p.set("cutoff", query.cutoff);
  if (query.warehouseId) p.set("warehouseId", query.warehouseId);
  const serialized = p.toString();
  return serialized
    ? `/analytics/products/inventory-aging?${serialized}`
    : "/analytics/products/inventory-aging";
}

export function parseStoreHealthQuery(search: string): StoreHealthQuery {
  const p = new URLSearchParams(search); const status = boundedText(p.get("authorizationStatus"), 32);
  return { query: boundedText(p.get("query"), 100), platform: boundedText(p.get("platform"), 32), authorizationStatus: STORE_AUTHORIZATION_STATUSES.includes(status as StoreAuthorizationStatus) ? status as StoreAuthorizationStatus : "", page: boundedInteger(p.get("page"), 0, 0, 9_999), size: boundedInteger(p.get("size"), STORE_HEALTH_DEFAULT_SIZE, 1, 100) };
}
export function toStoreHealthUrl(query: Partial<StoreHealthQuery>) {
  const p = new URLSearchParams(); if (query.query?.trim()) p.set("query", boundedText(query.query, 100)); if (query.platform?.trim()) p.set("platform", boundedText(query.platform, 32)); if (query.authorizationStatus && STORE_AUTHORIZATION_STATUSES.includes(query.authorizationStatus)) p.set("authorizationStatus", query.authorizationStatus); if (query.page && query.page > 0) p.set("page", String(query.page)); if (query.size && query.size !== STORE_HEALTH_DEFAULT_SIZE) p.set("size", String(query.size)); const serialized = p.toString(); return serialized ? `/analytics/stores/health?${serialized}` : "/analytics/stores/health";
}
function storeHealthMessage(error: unknown) { if (error instanceof ApiError && error.status === 403) return "当前账号没有查看店铺健康的权限。"; return "暂时无法读取店铺健康，请稍后重试。"; }
function healthLabel(shopStatus: string, authorizationStatus: StoreAuthorizationStatus, syncStatus?: string) { if (shopStatus !== "ACTIVE") return "店铺已停用"; if (authorizationStatus === "NOT_REQUIRED") return "内部店铺"; if (authorizationStatus !== "AUTHORIZED") return "需要处理"; if (syncStatus === "FAILED") return "同步异常"; if (syncStatus === "QUEUED" || syncStatus === "RUNNING") return "同步中"; return "接入正常"; }

export function AnalyticsInventoryReportPage() {
  const router = useRouter(); const search = useRouterState({ select: (s) => s.location.searchStr }); const query = useMemo(() => parseInventoryReportQuery(search), [search]);
  const navigate = (keyword: string, startDate: string, endDate: string) => {
    router.history.push(toInventoryReportUrl({ keyword, startDate, endDate }));
  };
  return <Page group="商品报告" title="进销存报表"><InventoryPeriodReport keyword={query.keyword} start={query.startDate} end={query.endDate} onFilter={navigate} onReset={() => router.history.push("/analytics/products/inventory-report")} /></Page>;
}

export function AnalyticsInventoryAgingReportPage() {
  const path = "/analytics/products/inventory-aging"; const router = useRouter(); const search = useRouterState({ select: (s) => s.location.searchStr }); const query = useMemo(() => parseInventoryAgingQuery(search), [search]);
  const navigate = (keyword: string, cutoff: string, warehouseId?: string) => { router.history.push(toInventoryAgingUrl({ keyword, cutoff, warehouseId: warehouseId ?? "" })); };
  return <Page group="商品报告" title="库龄分析"><InventoryAgingReport keyword={query.keyword} cutoff={query.cutoff || undefined} warehouseId={query.warehouseId || undefined} onFilter={navigate} onReset={() => router.history.push(path)} /></Page>;
}

export function AnalyticsStoreHealthPage() {
  const router = useRouter(); const search = useRouterState({ select: (s) => s.location.searchStr }); const query = useMemo(() => parseStoreHealthQuery(search), [search]); const [state, setState] = useState<StoreHealthState>({ status: "loading" }); const [retry, setRetry] = useState(0);
  const navigate = (next: Partial<StoreHealthQuery>) => router.history.push(toStoreHealthUrl(next));
  useEffect(() => { const controller = new AbortController(); setState({ status: "loading" }); void storeHealthApi.list({ ...query, authorizationStatus: query.authorizationStatus || undefined, signal: controller.signal }).then((data) => { const lastPage = Math.max(data.totalPages - 1, 0); if (query.page > lastPage) { navigate({ ...query, page: lastPage }); return; } setState({ status: "ready", data }); }, (error) => { if (!(error instanceof DOMException && error.name === "AbortError")) setState({ status: "error", message: storeHealthMessage(error) }); }); return () => controller.abort(); }, [query, retry]);
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const data = new FormData(event.currentTarget); navigate({ query: String(data.get("query") ?? ""), platform: String(data.get("platform") ?? ""), authorizationStatus: String(data.get("authorizationStatus") ?? "") as StoreAuthorizationStatus | "", page: 0, size: query.size }); };
  const current = state.status === "ready" ? state.data.items : []; const authorized = current.filter((item) => item.authorizationStatus === "AUTHORIZED").length; const attention = current.filter((item) => !["接入正常", "内部店铺"].includes(healthLabel(item.shopStatus, item.authorizationStatus, item.latestSync?.status))).length;
  return <Page group="店铺报告" title="店铺健康">
    <div className="warehouse-processing-formula" role="note"><strong>检查范围</strong><span>基于 ERP 已保存的店铺状态、授权校验和最近同步任务判断接入健康；不推测 GMV、广告、流量、转化或退款金额。</span></div>
    <form className="warehouse-archive-filters procurement-plan-filters" key={toStoreHealthUrl(query)} onSubmit={submit}><label className="procurement-plan-keyword">店铺名称 / 域名<input name="query" maxLength={100} defaultValue={query.query} placeholder="全部店铺" /></label><label>平台<select key={`${query.platform}-${state.status}`} name="platform" defaultValue={query.platform}><option value="">全部平台</option>{state.status === "ready" ? state.data.platforms.map((item) => <option value={item.code} key={item.code}>{item.displayName}</option>) : query.platform ? <option value={query.platform}>正在加载平台…</option> : null}</select></label><label>授权状态<select name="authorizationStatus" defaultValue={query.authorizationStatus}><option value="">全部状态</option>{STORE_AUTHORIZATION_STATUSES.map((status) => <option value={status} key={status}>{authorizationLabels[status]}</option>)}</select></label><div className="warehouse-archive-filter-actions"><button className="is-primary" type="submit">查询</button><button type="button" onClick={() => navigate({ size: query.size })}>重置</button><button type="button" onClick={() => setRetry((value) => value + 1)}>刷新</button></div></form>
    {state.status === "loading" && <div className="warehouse-archive-empty" role="status"><strong>正在检查店铺健康…</strong></div>}
    {state.status === "error" && <div className="inline-alert" role="alert">{state.message}<button type="button" onClick={() => setRetry((value) => value + 1)}>重试</button></div>}
    {state.status === "ready" && <><dl className="inventory-count-summary-grid" aria-label="店铺健康摘要"><div><dt>符合条件店铺</dt><dd>{state.data.totalElements}</dd></div><div><dt>当前页已授权</dt><dd>{authorized}</dd></div><div><dt>当前页待处理</dt><dd>{attention}</dd></div></dl><div className="warehouse-archive-table-wrap"><table aria-label="店铺健康列表"><thead><tr><th>健康状态</th><th>平台 / 店铺</th><th>店铺状态</th><th>授权状态</th><th>授权范围</th><th>最近同步</th><th>最近校验</th><th>操作</th></tr></thead><tbody>{state.data.items.length === 0 ? <tr><td colSpan={8}><div className="warehouse-archive-empty" role="status"><strong>没有符合条件的店铺</strong><span>请调整平台、店铺或授权状态后重试。</span></div></td></tr> : state.data.items.map((item) => <tr key={item.shopId}><td><span className={`status-badge is-${["接入正常", "内部店铺"].includes(healthLabel(item.shopStatus, item.authorizationStatus, item.latestSync?.status)) ? "active" : "warning"}`}>{healthLabel(item.shopStatus, item.authorizationStatus, item.latestSync?.status)}</span></td><td><strong>{item.platformName} · {item.shopName}</strong><br /><small>{item.authorizationStatus === "NOT_REQUIRED" ? "内部店铺" : item.externalShopRef}</small></td><td>{item.shopStatus === "ACTIVE" ? "启用" : "停用"}</td><td>{authorizationLabels[item.authorizationStatus]}</td><td>{item.scopes.length ? `${item.scopes.length} 项` : "—"}</td><td>{item.latestSync ? <>{syncTypeLabels[item.latestSync.jobType]} · {syncStatusLabels[item.latestSync.status]}<br /><small>{new Date(item.latestSync.requestedAt).toLocaleString()}{item.latestSync.safeErrorSummary ? ` · ${item.latestSync.safeErrorSummary}` : ""}</small></> : "暂无同步任务"}</td><td>{item.lastVerifiedAt ? <time dateTime={item.lastVerifiedAt}>{new Date(item.lastVerifiedAt).toLocaleString()}</time> : "尚未校验"}</td><td><button className="text-button" type="button" onClick={() => router.history.push(`/shops/${item.shopId}`)}>查看店铺</button></td></tr>)}</tbody></table></div><div className="procurement-plan-table-footer"><span>共 {state.data.totalElements} 个店铺</span><label>每页<select aria-label="店铺健康每页行数" value={query.size} onChange={(event) => navigate({ ...query, page: 0, size: Number(event.target.value) })}>{[25, 50, 100].map((size) => <option key={size} value={size}>{size} 行</option>)}</select></label><div className="pagination"><button type="button" disabled={query.page === 0} onClick={() => navigate({ ...query, page: query.page - 1 })}>上一页</button><span>第 {query.page + 1} / {Math.max(state.data.totalPages, 1)} 页</span><button type="button" disabled={query.page + 1 >= state.data.totalPages} onClick={() => navigate({ ...query, page: query.page + 1 })}>下一页</button></div></div></>}
  </Page>;
}
