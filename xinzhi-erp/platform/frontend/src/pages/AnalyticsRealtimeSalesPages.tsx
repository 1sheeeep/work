import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { ApiError } from "../api/client";
import {
  inventoryRealtimeSalesApi,
  type InventoryRealtimeSalesPage,
} from "../modules/inventoryRealtimeSalesApi";
import {
  listingRealtimeSalesApi,
  type ListingRealtimeSalesPage,
} from "../modules/listingRealtimeSalesApi";
import {
  orderStatusReportApi,
  type OrderStatus,
  type OrderStatusReportPage,
} from "../modules/orderStatusReportApi";
import "./WarehouseArchiveShells.css";

const LISTING_REALTIME_DEFAULT_SIZE = 25;
const LISTING_REALTIME_PAGE_SIZES = [25, 50, 100] as const;
const INVENTORY_REALTIME_DEFAULT_SIZE = 25;
const INVENTORY_REALTIME_PAGE_SIZES = [25, 50, 100] as const;

export type InventoryRealtimeQuery = {
  startTime: string;
  endTime: string;
  keyword: string;
  page: number;
  size: number;
};

export type ListingRealtimeQuery = {
  startTime: string;
  endTime: string;
  keyword: string;
  page: number;
  size: number;
};

type ListingRealtimeLoadState =
  | { status: "loading" }
  | { status: "ready"; data: ListingRealtimeSalesPage }
  | { status: "error"; message: string };

type InventoryRealtimeLoadState =
  | { status: "loading" }
  | { status: "ready"; data: InventoryRealtimeSalesPage }
  | { status: "error"; message: string };

type OrderAnalysisLoadState =
  | { status: "loading" }
  | { status: "ready"; data: OrderStatusReportPage }
  | { status: "error"; message: string };

export type OrderAnalysisQuery = {
  shop: string;
  startDate: string;
  endDate: string;
};

const orderStatusLabels: Readonly<Record<OrderStatus, string>> = {
  UNPAID: "待付款",
  RECEIVED: "已接收",
  REVIEW_PENDING: "待审核",
  MERGE_PENDING: "待合并",
  HOLD: "已搁置",
  READY_TO_FULFILL: "待履约",
  FULFILLING: "履约中",
  SHIPPED: "已发货",
  DELIVERED: "已送达",
  CANCELLED: "已取消",
};

const processingStatuses = new Set<OrderStatus>([
  "UNPAID", "RECEIVED", "REVIEW_PENDING", "MERGE_PENDING", "HOLD",
  "READY_TO_FULFILL", "FULFILLING",
]);
const completedStatuses = new Set<OrderStatus>(["SHIPPED", "DELIVERED"]);

function boundedText(value: string | null, maximum: number) { return (value ?? "").trim().slice(0, maximum); }
function timeValue(value: string | null) {
  const candidate = boundedText(value, 16);
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(candidate) ? candidate : "";
}

function dateValue(value: string | null) {
  const candidate = boundedText(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return "";
  const [year, month, day] = candidate.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day
    ? candidate
    : "";
}

function utcDateValue(value: Date) {
  return value.toISOString().slice(0, 10);
}

function orderAnalysisDefaultWindow(now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 29);
  return { startDate: utcDateValue(start), endDate: utcDateValue(end) };
}

function orderAnalysisRangeDays(startDate: string, endDate: string) {
  return Math.floor((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000) + 1;
}

function orderAnalysisDayBoundary(value: string, nextDay = false) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + (nextDay ? 1 : 0))).toISOString();
}

export function parseOrderAnalysisQuery(search: string, now = new Date()): OrderAnalysisQuery {
  const params = new URLSearchParams(search);
  const defaults = orderAnalysisDefaultWindow(now);
  const requestedStart = dateValue(params.get("startDate"));
  const requestedEnd = dateValue(params.get("endDate"));
  const startDate = requestedStart || defaults.startDate;
  const endDate = requestedEnd || defaults.endDate;
  const rangeDays = orderAnalysisRangeDays(startDate, endDate);
  return {
    shop: boundedText(params.get("shop"), 100),
    startDate: rangeDays >= 1 && rangeDays <= 90 ? startDate : defaults.startDate,
    endDate: rangeDays >= 1 && rangeDays <= 90 ? endDate : defaults.endDate,
  };
}

export function toOrderAnalysisUrl(query: Partial<OrderAnalysisQuery>) {
  const params = new URLSearchParams();
  const shop = boundedText(query.shop ?? "", 100);
  const startDate = dateValue(query.startDate ?? "");
  const endDate = dateValue(query.endDate ?? "");
  if (shop) params.set("shop", shop);
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);
  const serialized = params.toString();
  return serialized ? `/analytics/sales/order-analysis?${serialized}` : "/analytics/sales/order-analysis";
}

function orderAnalysisOrderUrl(reportDate: string) {
  const params = new URLSearchParams({
    page: "0",
    placedFrom: orderAnalysisDayBoundary(reportDate),
    placedTo: orderAnalysisDayBoundary(reportDate, true),
  });
  return `/orders?${params}`;
}

function orderAnalysisExportMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 409) return "导出结果超过 10,000 天，请缩小筛选范围后重试。";
  if (error instanceof ApiError && error.status === 403) return "当前账号没有导出订单分析的权限。";
  return "暂时无法导出订单分析，请稍后重试。";
}

function boundedInteger(value: string | null, fallback: number, minimum: number, maximum: number) {
  if (!value || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function localTimeInstant(value: string) {
  if (!timeValue(value)) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function inventoryExportMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 409) return "导出结果超过 10,000 条，请缩小筛选范围后重试。";
  if (error instanceof ApiError && error.status === 403) return "当前账号没有导出库存实时销量的权限。";
  return "暂时无法导出库存实时销量，请稍后重试。";
}

function listingExportMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 409) return "导出结果超过 10,000 条，请缩小筛选范围后重试。";
  if (error instanceof ApiError && error.status === 403) return "当前账号没有导出 Listing 实时销量的权限。";
  return "暂时无法导出 Listing 实时销量，请稍后重试。";
}

export function parseInventoryRealtimeQuery(search: string): InventoryRealtimeQuery {
  const params = new URLSearchParams(search);
  return {
    startTime: timeValue(params.get("startTime")),
    endTime: timeValue(params.get("endTime")),
    keyword: boundedText(params.get("keyword"), 100),
    page: boundedInteger(params.get("page"), 0, 0, 9_999),
    size: boundedInteger(params.get("size"), INVENTORY_REALTIME_DEFAULT_SIZE, 1, 100),
  };
}

export function parseListingRealtimeQuery(search: string): ListingRealtimeQuery {
  const params = new URLSearchParams(search);
  return {
    startTime: timeValue(params.get("startTime")),
    endTime: timeValue(params.get("endTime")),
    keyword: boundedText(params.get("keyword"), 100),
    page: boundedInteger(params.get("page"), 0, 0, 9_999),
    size: boundedInteger(params.get("size"), LISTING_REALTIME_DEFAULT_SIZE, 1, 100),
  };
}

export function toInventoryRealtimeUrl(query: Partial<InventoryRealtimeQuery>) {
  const params = new URLSearchParams();
  const startTime = timeValue(query.startTime ?? "");
  const endTime = timeValue(query.endTime ?? "");
  const keyword = boundedText(query.keyword ?? "", 100);
  if (startTime) params.set("startTime", startTime);
  if (endTime) params.set("endTime", endTime);
  if (keyword) params.set("keyword", keyword);
  if (query.page && query.page > 0) params.set("page", String(query.page));
  if (query.size && query.size !== INVENTORY_REALTIME_DEFAULT_SIZE) params.set("size", String(query.size));
  const serialized = params.toString();
  return serialized ? `/analytics/sales/inventory-realtime?${serialized}` : "/analytics/sales/inventory-realtime";
}

export function toListingRealtimeUrl(query: Partial<ListingRealtimeQuery>) {
  const params = new URLSearchParams();
  const startTime = timeValue(query.startTime ?? "");
  const endTime = timeValue(query.endTime ?? "");
  const keyword = boundedText(query.keyword ?? "", 100);
  if (startTime) params.set("startTime", startTime);
  if (endTime) params.set("endTime", endTime);
  if (keyword) params.set("keyword", keyword);
  if (query.page && query.page > 0) params.set("page", String(query.page));
  if (query.size && query.size !== LISTING_REALTIME_DEFAULT_SIZE) params.set("size", String(query.size));
  const serialized = params.toString();
  return serialized ? `/analytics/sales/listing-realtime?${serialized}` : "/analytics/sales/listing-realtime";
}

export function AnalyticsListingRealtimeSalesPage() {
  const path = "/analytics/sales/listing-realtime";
  const router = useRouter();
  const search = useRouterState({ select: (state) => state.location.searchStr });
  const query = useMemo(() => parseListingRealtimeQuery(search), [search]);
  const [liveAsOf, setLiveAsOf] = useState(() => new Date().toISOString());
  const [state, setState] = useState<ListingRealtimeLoadState>({ status: "loading" });
  const [retry, setRetry] = useState(0);
  const [filterError, setFilterError] = useState<string>();
  const [exporting, setExporting] = useState(false);
  const [exportFeedback, setExportFeedback] = useState<{ kind: "success" | "error"; message: string; queryKey: string }>();
  const navigate = (next: Partial<ListingRealtimeQuery>) => {
    router.history.push(toListingRealtimeUrl({ ...query, ...next }));
  };
  const refresh = () => {
    if (!query.endTime) setLiveAsOf(new Date().toISOString());
    setRetry((value) => value + 1);
  };

  useEffect(() => {
    const controller = new AbortController();
    const asOf = localTimeInstant(query.endTime) ?? liveAsOf;
    setState({ status: "loading" });
    void listingRealtimeSalesApi.summarize({
      keyword: query.keyword || undefined,
      rangeFrom: localTimeInstant(query.startTime),
      asOf,
      page: query.page,
      size: query.size,
      signal: controller.signal,
    }).then(
      (data) => {
        const lastPage = Math.max(data.totalPages - 1, 0);
        if (query.page > lastPage) {
          navigate({ page: lastPage });
          return;
        }
        setState({ status: "ready", data });
      },
      (error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ status: "error", message: "暂时无法读取 Listing 实时销量，请稍后重试。" });
      },
    );
    return () => controller.abort();
  }, [liveAsOf, query, retry]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const startTime = timeValue(String(data.get("startTime") ?? ""));
    const endTime = timeValue(String(data.get("endTime") ?? ""));
    const startInstant = localTimeInstant(startTime);
    const endInstant = localTimeInstant(endTime) ?? liveAsOf;
    if (startInstant && Date.parse(startInstant) >= Date.parse(endInstant)) {
      setFilterError("开始时间必须早于结束时间。");
      return;
    }
    setFilterError(undefined);
    navigate({
      startTime,
      endTime,
      keyword: String(data.get("keyword") ?? ""),
      page: 0,
    });
  };
  const exportQueryKey = toListingRealtimeUrl(query);
  const exportListingSales = async () => {
    if (exporting || state.status !== "ready" || state.data.totalListingCount === 0) return;
    const queryKey = exportQueryKey;
    setExporting(true);
    setExportFeedback(undefined);
    try {
      const result = await listingRealtimeSalesApi.exportCsv({
        keyword: query.keyword || undefined,
        rangeFrom: localTimeInstant(query.startTime),
        asOf: state.data.observedAt,
      });
      const url = URL.createObjectURL(new Blob([result.content], { type: result.mediaType }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.filename;
      document.body.append(anchor);
      try { anchor.click(); } finally { anchor.remove(); URL.revokeObjectURL(url); }
      setExportFeedback({ kind: "success", message: `已导出 ${result.rowCount} 条 Listing 实时销量。`, queryKey });
    } catch (error) {
      setExportFeedback({ kind: "error", message: listingExportMessage(error), queryKey });
    } finally {
      setExporting(false);
    }
  };
  return (
    <main className="warehouse-archive-page" aria-labelledby="analytics-listing-realtime-title">
      <header className="warehouse-archive-heading"><div><p className="eyebrow">报表 / 销售报告</p><h1 id="analytics-listing-realtime-title">Listing实时销量</h1><p>按已保存 Listing、店铺、SKU 和订单明细查看销售数量。</p></div></header>
      <section className="warehouse-archive-card" aria-label="Listing 实时销量筛选与结果">
        <form className="warehouse-archive-filters procurement-plan-filters" key={toListingRealtimeUrl(query)} onSubmit={submit}>
          <label>开始时间<input type="datetime-local" name="startTime" defaultValue={query.startTime} /></label>
          <label>结束时间（不含）<input type="datetime-local" name="endTime" defaultValue={query.endTime} /></label>
          <label className="procurement-plan-keyword">平台 / 店铺 / ItemId / SKU<input name="keyword" maxLength={100} defaultValue={query.keyword} placeholder="输入完整或部分关键字" /></label>
          <div className="warehouse-archive-filter-actions"><button className="is-primary" type="submit">搜索</button><button type="button" onClick={() => router.history.push(path)}>重置</button><button type="button" onClick={refresh}>刷新</button></div>
        </form>
        {filterError && <div className="inline-alert" role="alert">{filterError}</div>}
        <div className="warehouse-processing-formula" role="note"><strong>统计口径</strong><span>只统计同一店铺、同一库存 SKU 恰好对应一个已保存 Listing 的非取消订单明细；多 Listing 映射无法唯一归属，保持排除。未选择开始时间时，所选区间默认最近 42×24 小时；今日与昨日按 UTC 自然日，近 7/28/42 天按滚动小时计算。金额、利润、当前售价、图片和平台库存不进入本报表。</span></div>
        <div className="warehouse-archive-actions"><button type="button" disabled={exporting || state.status !== "ready" || state.data.totalListingCount === 0} onClick={() => void exportListingSales()}>{exporting ? "正在导出…" : "导出筛选结果"}</button></div>
        {exportFeedback?.queryKey === exportQueryKey && <p className={`warehouse-export-feedback is-${exportFeedback.kind}`} role={exportFeedback.kind === "error" ? "alert" : "status"}>{exportFeedback.message}</p>}
        {state.status === "loading" && <div className="warehouse-archive-empty" role="status"><strong>正在读取 Listing 实时销量…</strong></div>}
        {state.status === "error" && <div className="inline-alert" role="alert">{state.message}<button type="button" onClick={refresh}>重试</button></div>}
        {state.status === "ready" && <>
          <dl className="inventory-count-summary-grid" aria-label="Listing 实时销量摘要">
            <div><dt>可唯一归属 Listing</dt><dd>{state.data.totalListingCount}</dd></div>
            <div><dt>所选区间销量</dt><dd>{state.data.totalRangeSalesQuantity}</dd></div>
            <div><dt>当前页 Listing</dt><dd>{state.data.items.length}</dd></div>
            <div><dt>统计截至</dt><dd><time dateTime={state.data.observedAt}>{new Date(state.data.observedAt).toLocaleString()}</time></dd></div>
          </dl>
          <div className="warehouse-archive-table-wrap">
            <table aria-label="Listing 实时销量结果">
              <thead><tr><th scope="col">平台</th><th scope="col">Listing / 变体</th><th scope="col">库存 SKU / 商品</th><th scope="col">店铺</th><th scope="col">所选区间</th><th scope="col">订单数</th><th scope="col">今日</th><th scope="col">昨日</th><th scope="col">近 7 天</th><th scope="col">近 28 天</th><th scope="col">近 42 天</th><th scope="col">最近下单</th></tr></thead>
              <tbody>{state.data.items.length === 0
                ? <tr><td colSpan={12}><div className="warehouse-archive-empty" role="status"><strong>没有符合条件的 Listing 销量</strong><span>请调整时间或关键字；多 Listing 映射的订单明细不会被猜测归属。</span></div></td></tr>
                : state.data.items.map((item) => <tr key={item.listingId}>
                  <td>{item.platformName}<br /><small>{item.platformCode}</small></td>
                  <td><strong>{item.externalListingRef}</strong>{item.externalVariantRef ? <><br /><small>{item.externalVariantRef}</small></> : null}</td>
                  <td>{item.skuCode}<br /><small>{item.skuName}{item.variantSummary ? ` · ${item.variantSummary}` : ""}</small></td>
                  <td>{item.shopName}</td><td>{item.rangeSalesQuantity}</td><td>{item.rangeOrderCount}</td><td>{item.todaySalesQuantity}</td><td>{item.yesterdaySalesQuantity}</td><td>{item.last7DaysSalesQuantity}</td><td>{item.last28DaysSalesQuantity}</td><td>{item.last42DaysSalesQuantity}</td>
                  <td><time dateTime={item.lastPlacedAt}>{new Date(item.lastPlacedAt).toLocaleString()}</time></td>
                </tr>)}</tbody>
            </table>
          </div>
          <div className="procurement-plan-table-footer">
            <span>共 {state.data.totalListingCount} 个 Listing</span>
            <label>每页<select aria-label="Listing 实时销量每页行数" value={query.size} onChange={(event) => navigate({ page: 0, size: Number(event.target.value) })}>{LISTING_REALTIME_PAGE_SIZES.map((size) => <option key={size} value={size}>{size} 行</option>)}</select></label>
            <div className="pagination"><button type="button" disabled={query.page === 0} onClick={() => navigate({ page: query.page - 1 })}>上一页</button><span>第 {query.page + 1} / {Math.max(state.data.totalPages, 1)} 页</span><button type="button" disabled={query.page + 1 >= state.data.totalPages} onClick={() => navigate({ page: query.page + 1 })}>下一页</button></div>
          </div>
        </>}
      </section>
    </main>
  );
}

export function AnalyticsInventoryRealtimeSalesPage() {
  const path = "/analytics/sales/inventory-realtime";
  const router = useRouter();
  const search = useRouterState({ select: (state) => state.location.searchStr });
  const query = useMemo(() => parseInventoryRealtimeQuery(search), [search]);
  const [liveAsOf, setLiveAsOf] = useState(() => new Date().toISOString());
  const [state, setState] = useState<InventoryRealtimeLoadState>({ status: "loading" });
  const [retry, setRetry] = useState(0);
  const [filterError, setFilterError] = useState<string>();
  const [exporting, setExporting] = useState(false);
  const [exportFeedback, setExportFeedback] = useState<{ kind: "success" | "error"; message: string; queryKey: string }>();
  const navigate = (next: Partial<InventoryRealtimeQuery>) => {
    router.history.push(toInventoryRealtimeUrl({ ...query, ...next }));
  };
  const refresh = () => {
    if (!query.endTime) setLiveAsOf(new Date().toISOString());
    setRetry((value) => value + 1);
  };

  useEffect(() => {
    const controller = new AbortController();
    const asOf = localTimeInstant(query.endTime) ?? liveAsOf;
    setState({ status: "loading" });
    void inventoryRealtimeSalesApi.summarize({
      keyword: query.keyword || undefined,
      rangeFrom: localTimeInstant(query.startTime),
      asOf,
      page: query.page,
      size: query.size,
      signal: controller.signal,
    }).then(
      (data) => {
        const lastPage = Math.max(data.totalPages - 1, 0);
        if (query.page > lastPage) {
          navigate({ page: lastPage });
          return;
        }
        setState({ status: "ready", data });
      },
      (error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ status: "error", message: "暂时无法读取库存实时销量，请稍后重试。" });
      },
    );
    return () => controller.abort();
  }, [liveAsOf, query, retry]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const startTime = timeValue(String(data.get("startTime") ?? ""));
    const endTime = timeValue(String(data.get("endTime") ?? ""));
    const startInstant = localTimeInstant(startTime);
    const endInstant = localTimeInstant(endTime) ?? liveAsOf;
    if (startInstant && Date.parse(startInstant) >= Date.parse(endInstant)) {
      setFilterError("开始时间必须早于结束时间。");
      return;
    }
    setFilterError(undefined);
    navigate({
      startTime,
      endTime,
      keyword: String(data.get("keyword") ?? ""),
      page: 0,
    });
  };
  const exportQueryKey = toInventoryRealtimeUrl(query);
  const exportInventorySales = async () => {
    if (exporting || state.status !== "ready" || state.data.totalBalanceCount === 0) return;
    const queryKey = exportQueryKey;
    setExporting(true);
    setExportFeedback(undefined);
    try {
      const result = await inventoryRealtimeSalesApi.exportCsv({
        keyword: query.keyword || undefined,
        rangeFrom: localTimeInstant(query.startTime),
        asOf: state.data.observedAt,
      });
      const url = URL.createObjectURL(new Blob([result.content], { type: result.mediaType }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.filename;
      document.body.append(anchor);
      try { anchor.click(); } finally { anchor.remove(); URL.revokeObjectURL(url); }
      setExportFeedback({ kind: "success", message: `已导出 ${result.rowCount} 条库存实时销量。`, queryKey });
    } catch (error) {
      setExportFeedback({ kind: "error", message: inventoryExportMessage(error), queryKey });
    } finally {
      setExporting(false);
    }
  };

  return (
    <main className="warehouse-archive-page" aria-labelledby="analytics-inventory-realtime-title">
      <header className="warehouse-archive-heading"><div><p className="eyebrow">报表 / 销售报告</p><h1 id="analytics-inventory-realtime-title">库存实时销量</h1><p>按当前库存余额和已保存订单明细查看仓库 SKU 销量。</p></div></header>
      <section className="warehouse-archive-card" aria-label="库存实时销量筛选与结果">
        <form className="warehouse-archive-filters procurement-plan-filters" key={toInventoryRealtimeUrl(query)} onSubmit={submit}>
          <label>开始时间<input type="datetime-local" name="startTime" defaultValue={query.startTime} /></label>
          <label>结束时间（不含）<input type="datetime-local" name="endTime" defaultValue={query.endTime} /></label>
          <label className="procurement-plan-keyword">库存 SKU / 名称 / 仓库<input name="keyword" maxLength={100} defaultValue={query.keyword} placeholder="输入完整或部分关键字" /></label>
          <div className="warehouse-archive-filter-actions"><button className="is-primary" type="submit">搜索</button><button type="button" onClick={() => router.history.push(path)}>重置</button><button type="button" onClick={refresh}>刷新</button></div>
        </form>
        {filterError && <div className="inline-alert" role="alert">{filterError}</div>}
        <div className="warehouse-processing-formula" role="note"><strong>统计口径</strong><span>只统计已匹配库存 SKU、已明确仓库且非取消的订单明细；可用库存 = 现货库存 − 已预留。未选择开始时间时，所选区间默认最近 42×24 小时；今日与昨日按 UTC 自然日，近 7/28/42 天按滚动小时计算。价格、销售额、在途和未分仓订单不进入本报表。</span></div>
        <div className="warehouse-archive-actions"><button type="button" disabled={exporting || state.status !== "ready" || state.data.totalBalanceCount === 0} onClick={() => void exportInventorySales()}>{exporting ? "正在导出…" : "导出筛选结果"}</button></div>
        {exportFeedback?.queryKey === exportQueryKey && <p className={`warehouse-export-feedback is-${exportFeedback.kind}`} role={exportFeedback.kind === "error" ? "alert" : "status"}>{exportFeedback.message}</p>}
        {state.status === "loading" && <div className="warehouse-archive-empty" role="status"><strong>正在读取库存实时销量…</strong></div>}
        {state.status === "error" && <div className="inline-alert" role="alert">{state.message}<button type="button" onClick={refresh}>重试</button></div>}
        {state.status === "ready" && <>
          <dl className="inventory-count-summary-grid" aria-label="库存实时销量摘要">
            <div><dt>库存余额行</dt><dd>{state.data.totalBalanceCount}</dd></div>
            <div><dt>现货库存</dt><dd>{state.data.totalOnHand}</dd></div>
            <div><dt>已预留</dt><dd>{state.data.totalReserved}</dd></div>
            <div><dt>可用库存</dt><dd>{state.data.totalAvailable}</dd></div>
            <div><dt>所选区间销量</dt><dd>{state.data.totalRangeSalesQuantity}</dd></div>
          </dl>
          <div className="warehouse-archive-table-wrap">
            <table aria-label="库存实时销量结果">
              <thead><tr><th scope="col">库存 SKU</th><th scope="col">SKU 名称</th><th scope="col">仓库</th><th scope="col">现货</th><th scope="col">预留</th><th scope="col">可用</th><th scope="col">所选区间</th><th scope="col">订单数</th><th scope="col">今日</th><th scope="col">昨日</th><th scope="col">近 7 天</th><th scope="col">近 28 天</th><th scope="col">近 42 天</th><th scope="col">库存更新时间</th></tr></thead>
              <tbody>{state.data.items.length === 0
                ? <tr><td colSpan={14}><div className="warehouse-archive-empty" role="status"><strong>没有符合条件的库存销量</strong><span>请调整时间或 SKU 条件后重试。</span></div></td></tr>
                : state.data.items.map((item) => <tr key={item.balanceId}>
                  <td>{item.skuCode}</td><td>{item.skuName}{item.variantSummary ? ` · ${item.variantSummary}` : ""}</td><td>{item.warehouseCode} · {item.warehouseName}</td>
                  <td>{item.onHand}</td><td>{item.reserved}</td><td><strong>{item.available}</strong></td><td>{item.rangeSalesQuantity}</td><td>{item.rangeOrderCount}</td>
                  <td>{item.todaySalesQuantity}</td><td>{item.yesterdaySalesQuantity}</td><td>{item.last7DaysSalesQuantity}</td><td>{item.last28DaysSalesQuantity}</td><td>{item.last42DaysSalesQuantity}</td>
                  <td><time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleString()}</time></td>
                </tr>)}</tbody>
            </table>
          </div>
          <div className="procurement-plan-table-footer">
            <span>统计截至 <time dateTime={state.data.observedAt}>{new Date(state.data.observedAt).toLocaleString()}</time></span>
            <label>每页<select aria-label="库存实时销量每页行数" value={query.size} onChange={(event) => navigate({ page: 0, size: Number(event.target.value) })}>{INVENTORY_REALTIME_PAGE_SIZES.map((size) => <option key={size} value={size}>{size} 行</option>)}</select></label>
            <div className="pagination"><button type="button" disabled={query.page === 0} onClick={() => navigate({ page: query.page - 1 })}>上一页</button><span>第 {query.page + 1} / {Math.max(state.data.totalPages, 1)} 页</span><button type="button" disabled={query.page + 1 >= state.data.totalPages} onClick={() => navigate({ page: query.page + 1 })}>下一页</button></div>
          </div>
        </>}
      </section>
    </main>
  );
}

export function AnalyticsOrderAnalysisPage() {
  const path = "/analytics/sales/order-analysis";
  const router = useRouter();
  const search = useRouterState({ select: (state) => state.location.searchStr });
  const query = useMemo(() => parseOrderAnalysisQuery(search), [search]);
  const [state, setState] = useState<OrderAnalysisLoadState>({ status: "loading" });
  const [retry, setRetry] = useState(0);
  const [filterError, setFilterError] = useState<string>();
  const [exporting, setExporting] = useState(false);
  const [exportFeedback, setExportFeedback] = useState<{ kind: "success" | "error"; message: string; queryKey: string }>();
  const navigate = (next: OrderAnalysisQuery) => router.history.push(toOrderAnalysisUrl(next));

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    void orderStatusReportApi.summarize({
      shop: query.shop || undefined,
      placedFrom: orderAnalysisDayBoundary(query.startDate),
      placedToExclusive: orderAnalysisDayBoundary(query.endDate, true),
      page: 0,
      size: 100,
      signal: controller.signal,
    }).then(
      (data) => setState({ status: "ready", data }),
      (error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ status: "error", message: "暂时无法读取订单分析，请稍后重试。" });
      },
    );
    return () => controller.abort();
  }, [query, retry]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const startDate = dateValue(String(data.get("startDate") ?? ""));
    const endDate = dateValue(String(data.get("endDate") ?? ""));
    if (!startDate || !endDate) {
      setFilterError("请选择完整的起始日期和截止日期。");
      return;
    }
    const rangeDays = orderAnalysisRangeDays(startDate, endDate);
    if (rangeDays < 1) {
      setFilterError("起始日期不能晚于截止日期。");
      return;
    }
    if (rangeDays > 90) {
      setFilterError("单次最多分析连续 90 天，请缩小日期范围。");
      return;
    }
    setFilterError(undefined);
    navigate({ shop: boundedText(String(data.get("shop") ?? ""), 100), startDate, endDate });
  };

  const exportQueryKey = toOrderAnalysisUrl(query);
  const exportOrderAnalysis = async () => {
    if (exporting || state.status !== "ready" || state.data.totalOrders === 0) return;
    const queryKey = exportQueryKey;
    setExporting(true);
    setExportFeedback(undefined);
    try {
      const result = await orderStatusReportApi.exportCsv({
        shop: query.shop || undefined,
        placedFrom: orderAnalysisDayBoundary(query.startDate),
        placedToExclusive: orderAnalysisDayBoundary(query.endDate, true),
      });
      const url = URL.createObjectURL(new Blob([result.content], { type: result.mediaType }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.filename;
      document.body.append(anchor);
      try { anchor.click(); } finally { anchor.remove(); URL.revokeObjectURL(url); }
      setExportFeedback({ kind: "success", message: `已导出 ${result.rowCount} 天订单分析。`, queryKey });
    } catch (error) {
      setExportFeedback({ kind: "error", message: orderAnalysisExportMessage(error), queryKey });
    } finally {
      setExporting(false);
    }
  };

  const totals = state.status === "ready"
    ? state.data.items.flatMap((day) => day.statuses).reduce((result, item) => {
      result[item.status] = (result[item.status] ?? 0) + item.orderCount;
      return result;
    }, {} as Partial<Record<OrderStatus, number>>)
    : {};
  const processing = [...processingStatuses].reduce((total, status) => total + (totals[status] ?? 0), 0);
  const completed = [...completedStatuses].reduce((total, status) => total + (totals[status] ?? 0), 0);
  const cancelled = totals.CANCELLED ?? 0;

  return <main className="warehouse-archive-page" aria-labelledby="analytics-order-analysis-title">
    <header className="warehouse-archive-heading"><div><p className="eyebrow">报表 / 销售报告</p><h1 id="analytics-order-analysis-title">订单分析</h1><p>按店铺和日期分析真实订单量、处理进度与状态分布。</p></div></header>
    <section className="warehouse-archive-card" aria-label="订单分析筛选与结果">
      <div className="warehouse-processing-formula" role="note"><strong>统计口径</strong><span>按 ERP 订单下单日期（UTC）统计，每笔订单只计入当前数据库状态一次；最多连续 90 天，不推测金额、利润、退款率或转化率。</span></div>
      <form className="warehouse-archive-filters" key={exportQueryKey} onSubmit={submit}>
        <label>店铺 / 平台<input name="shop" maxLength={100} defaultValue={query.shop} placeholder="全部店铺与平台" /></label>
        <label>起始日期<input name="startDate" type="date" required defaultValue={query.startDate} /></label>
        <label>截止日期<input name="endDate" type="date" required defaultValue={query.endDate} /></label>
        <div className="warehouse-archive-filter-actions"><button className="is-primary" type="submit">查询</button><button type="button" onClick={() => router.history.push(path)}>重置</button><button type="button" onClick={() => setRetry((value) => value + 1)}>刷新</button></div>
      </form>
      {filterError && <div className="inline-alert" role="alert">{filterError}</div>}
      <div className="warehouse-archive-actions"><button type="button" disabled={exporting || state.status !== "ready" || state.data.totalOrders === 0} onClick={() => void exportOrderAnalysis()}>{exporting ? "正在导出…" : "导出筛选结果"}</button></div>
      {exportFeedback?.queryKey === exportQueryKey && <p className={`warehouse-export-feedback is-${exportFeedback.kind}`} role={exportFeedback.kind === "error" ? "alert" : "status"}>{exportFeedback.message}</p>}
      {state.status === "loading" && <div className="warehouse-archive-empty" role="status"><strong>正在读取订单分析…</strong></div>}
      {state.status === "error" && <div className="inline-alert" role="alert">{state.message}<button type="button" onClick={() => setRetry((value) => value + 1)}>重试</button></div>}
      {state.status === "ready" && <>
        <dl className="inventory-count-summary-grid" aria-label="订单分析摘要">
          <div><dt>订单总数</dt><dd>{state.data.totalOrders}</dd></div>
          <div><dt>待处理 / 处理中</dt><dd>{processing}</dd></div>
          <div><dt>已发货 / 已送达</dt><dd>{completed}</dd></div>
          <div><dt>已取消</dt><dd>{cancelled}</dd></div>
        </dl>
        <div className="warehouse-archive-table-wrap"><table aria-label="订单分析趋势">
          <thead><tr><th>日期（UTC）</th><th>订单总数</th><th>待处理 / 处理中</th><th>已发货 / 已送达</th><th>已取消</th><th>状态明细</th><th>操作</th></tr></thead>
          <tbody>{state.data.items.length === 0
            ? <tr><td colSpan={7}><div className="warehouse-archive-empty" role="status"><strong>所选范围暂无订单</strong><span>可调整店铺、平台或日期后重试。</span></div></td></tr>
            : state.data.items.map((day) => {
              const dayProcessing = day.statuses.filter((item) => processingStatuses.has(item.status)).reduce((total, item) => total + item.orderCount, 0);
              const dayCompleted = day.statuses.filter((item) => completedStatuses.has(item.status)).reduce((total, item) => total + item.orderCount, 0);
              const dayCancelled = day.statuses.find((item) => item.status === "CANCELLED")?.orderCount ?? 0;
              return <tr key={day.reportDate}><td><time dateTime={day.reportDate}>{day.reportDate}</time></td><td><strong>{day.orderCount}</strong></td><td>{dayProcessing}</td><td>{dayCompleted}</td><td>{dayCancelled}</td><td>{day.statuses.map((item) => <span className="cell-secondary" key={item.status}>{orderStatusLabels[item.status]} {item.orderCount}</span>)}</td><td><button className="text-button" type="button" onClick={() => router.history.push(orderAnalysisOrderUrl(day.reportDate))}>查看当日订单</button></td></tr>;
            })}</tbody>
        </table></div>
        <div className="procurement-plan-table-footer"><span>统计 {query.startDate} 至 {query.endDate} · 有订单 {state.data.totalElements} 天</span><button className="text-button" type="button" onClick={() => router.history.push(`/analytics/sales/order-status?shop=${encodeURIComponent(query.shop)}&startDate=${query.startDate}&endDate=${query.endDate}`)}>查看订单状态报表</button></div>
      </>}
    </section>
  </main>;
}
