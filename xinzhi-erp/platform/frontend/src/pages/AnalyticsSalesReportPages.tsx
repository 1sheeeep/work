import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { ApiError } from "../api/client";
import {
  orderStatusReportApi,
  type OrderStatus,
  type OrderStatusReportPage as OrderStatusPage,
} from "../modules/orderStatusReportApi";
import {
  productSalesReportApi,
  type ProductSalesReportPage,
} from "../modules/productSalesReportApi";
import "./WarehouseArchiveShells.css";

function boundedText(value: string | null, maximum: number) {
  return (value ?? "").trim().slice(0, maximum);
}

function dateValue(value: string | null) {
  const candidate = boundedText(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : "";
}

const PRODUCT_SALES_DEFAULT_SIZE = 25;
const PRODUCT_SALES_PAGE_SIZES = [25, 50, 100] as const;

export type ProductSalesReportQuery = {
  startDate: string;
  endDate: string;
  keyword: string;
  page: number;
  size: number;
};

type ProductSalesLoadState =
  | { status: "loading" }
  | { status: "ready"; data: ProductSalesReportPage }
  | { status: "error"; message: string };

export function parseAnalyticsProductSalesQuery(search: string): ProductSalesReportQuery {
  const params = new URLSearchParams(search);
  return {
    startDate: validDateValue(params.get("startDate")),
    endDate: validDateValue(params.get("endDate")),
    keyword: boundedText(params.get("keyword"), 100),
    page: boundedInteger(params.get("page"), 0, 0, 9_999),
    size: boundedInteger(params.get("size"), PRODUCT_SALES_DEFAULT_SIZE, 1, 100),
  };
}

export function toAnalyticsProductSalesUrl(query: Partial<ProductSalesReportQuery>) {
  const params = new URLSearchParams();
  const startDate = validDateValue(query.startDate ?? "");
  const endDate = validDateValue(query.endDate ?? "");
  const keyword = boundedText(query.keyword ?? "", 100);
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);
  if (keyword) params.set("keyword", keyword);
  if (query.page && query.page > 0) params.set("page", String(query.page));
  if (query.size && query.size !== PRODUCT_SALES_DEFAULT_SIZE) params.set("size", String(query.size));
  const serialized = params.toString();
  return serialized ? `/analytics/sales/product-sales?${serialized}` : "/analytics/sales/product-sales";
}

const ORDER_STATUS_DEFAULT_SIZE = 25;
const ORDER_STATUS_PAGE_SIZES = [25, 50, 100] as const;

export type OrderStatusReportQuery = {
  shop: string;
  startDate: string;
  endDate: string;
  page: number;
  size: number;
};

type OrderStatusLoadState =
  | { status: "loading" }
  | { status: "ready"; data: OrderStatusPage }
  | { status: "error"; message: string };

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

function validDateValue(value: string | null) {
  const candidate = dateValue(value);
  if (!candidate) return "";
  const [year, month, day] = candidate.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day
    ? candidate
    : "";
}

function boundedInteger(value: string | null, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

function orderStatusDayBoundary(value: string, nextDay = false) {
  if (!value) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + (nextDay ? 1 : 0))).toISOString();
}

function productSalesExportMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 409) return "导出结果超过 10,000 条，请缩小筛选范围后重试。";
  if (error instanceof ApiError && error.status === 403) return "当前账号没有导出商品销量报表的权限。";
  return "暂时无法导出商品销量报表，请稍后重试。";
}

function orderStatusExportMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 409) return "导出结果超过 10,000 天，请缩小筛选范围后重试。";
  if (error instanceof ApiError && error.status === 403) return "当前账号没有导出订单状态报表的权限。";
  return "暂时无法导出订单状态报表，请稍后重试。";
}

export function parseOrderStatusReportQuery(search: string): OrderStatusReportQuery {
  const params = new URLSearchParams(search);
  return {
    shop: boundedText(params.get("shop"), 100),
    startDate: validDateValue(params.get("startDate")),
    endDate: validDateValue(params.get("endDate")),
    page: boundedInteger(params.get("page"), 0, 0, 9_999),
    size: boundedInteger(params.get("size"), ORDER_STATUS_DEFAULT_SIZE, 1, 100),
  };
}

export function toOrderStatusReportUrl(query: Partial<OrderStatusReportQuery>) {
  const params = new URLSearchParams();
  const shop = boundedText(query.shop ?? "", 100);
  const startDate = validDateValue(query.startDate ?? "");
  const endDate = validDateValue(query.endDate ?? "");
  if (shop) params.set("shop", shop);
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);
  if (query.page && query.page > 0) params.set("page", String(query.page));
  if (query.size && query.size !== ORDER_STATUS_DEFAULT_SIZE) params.set("size", String(query.size));
  const serialized = params.toString();
  return serialized
    ? `/analytics/sales/order-status?${serialized}`
    : "/analytics/sales/order-status";
}

function orderCenterDayUrl(reportDate: string) {
  const params = new URLSearchParams({
    page: "0",
    placedFrom: orderStatusDayBoundary(reportDate) ?? "",
    placedTo: orderStatusDayBoundary(reportDate, true) ?? "",
  });
  return `/orders?${params}`;
}

function ReportPage({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  const titleId = `analytics-${title.replace(/[^a-zA-Z0-9]/g, "-")}-title`;
  return (
    <main className="warehouse-archive-page" aria-labelledby={titleId}>
      <header className="warehouse-archive-heading"><div><p className="eyebrow">报表 / 销售报告</p><h1 id={titleId}>{title}</h1><p>{description}</p></div></header>
      <section className="warehouse-archive-card" aria-label={`${title}筛选与结果`}>{children}</section>
    </main>
  );
}

export function AnalyticsOrderStatusReportPage() {
  const router = useRouter();
  const search = useRouterState({ select: (state) => state.location.searchStr });
  const query = useMemo(() => parseOrderStatusReportQuery(search), [search]);
  const [state, setState] = useState<OrderStatusLoadState>({ status: "loading" });
  const [retry, setRetry] = useState(0);
  const [filterError, setFilterError] = useState<string>();
  const [exporting, setExporting] = useState(false);
  const [exportFeedback, setExportFeedback] = useState<{ kind: "success" | "error"; message: string; queryKey: string }>();

  const navigate = (next: Partial<OrderStatusReportQuery>) => {
    router.history.push(toOrderStatusReportUrl(next));
  };

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    void orderStatusReportApi.summarize({
      shop: query.shop || undefined,
      placedFrom: orderStatusDayBoundary(query.startDate),
      placedToExclusive: orderStatusDayBoundary(query.endDate, true),
      page: query.page,
      size: query.size,
      signal: controller.signal,
    }).then(
      (data) => {
        const lastPage = Math.max(data.totalPages - 1, 0);
        if (query.page > lastPage) {
          navigate({ ...query, page: lastPage });
          return;
        }
        setState({ status: "ready", data });
      },
      (error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ status: "error", message: "暂时无法读取订单状态报表，请稍后重试。" });
      },
    );
    return () => controller.abort();
  }, [query, retry]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const startDate = validDateValue(String(data.get("startDate") ?? ""));
    const endDate = validDateValue(String(data.get("endDate") ?? ""));
    if (startDate && endDate && startDate > endDate) {
      setFilterError("起始日期不能晚于截止日期。");
      return;
    }
    setFilterError(undefined);
    navigate({
      shop: boundedText(String(data.get("shop") ?? ""), 100),
      startDate,
      endDate,
      page: 0,
      size: query.size,
    });
  };
  const exportQueryKey = toOrderStatusReportUrl(query);
  const exportOrderStatuses = async () => {
    if (exporting || state.status !== "ready" || state.data.totalElements === 0) return;
    const queryKey = exportQueryKey;
    setExporting(true);
    setExportFeedback(undefined);
    try {
      const result = await orderStatusReportApi.exportCsv({
        shop: query.shop || undefined,
        placedFrom: orderStatusDayBoundary(query.startDate),
        placedToExclusive: orderStatusDayBoundary(query.endDate, true),
      });
      const url = URL.createObjectURL(new Blob([result.content], { type: result.mediaType }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.filename;
      document.body.append(anchor);
      try { anchor.click(); } finally { anchor.remove(); URL.revokeObjectURL(url); }
      setExportFeedback({ kind: "success", message: `已导出 ${result.rowCount} 天订单状态。`, queryKey });
    } catch (error) {
      setExportFeedback({ kind: "error", message: orderStatusExportMessage(error), queryKey });
    } finally {
      setExporting(false);
    }
  };

  return (
    <main className="warehouse-archive-page" aria-labelledby="analytics-order-status-title">
      <header className="warehouse-archive-heading">
        <div>
          <p className="eyebrow">报表 / 销售报告</p>
          <h1 id="analytics-order-status-title">订单状态报表</h1>
          <p>按 ERP 订单下单日期汇总数据库中保存的订单状态。</p>
        </div>
      </header>

      <section className="warehouse-archive-card" aria-label="订单状态报表筛选与结果">
        <div className="warehouse-processing-formula" role="note">
          <strong>统计口径</strong>
          <span>一笔订单只计入其下单日期一次，日期按 UTC 统计，状态保持数据库原值。页面不计算金额、退款率、利润等财务指标，也不接入云端 BI。</span>
        </div>

        <form className="warehouse-archive-filters" key={toOrderStatusReportUrl(query)} onSubmit={submit}>
          <label>店铺 / 平台<input name="shop" defaultValue={query.shop} maxLength={100} placeholder="全部店铺与平台" /></label>
          <label>起始日期<input name="startDate" type="date" defaultValue={query.startDate} /></label>
          <label>截止日期<input name="endDate" type="date" defaultValue={query.endDate} /></label>
          <div className="warehouse-archive-filter-actions">
            <button className="is-primary" type="submit">查询</button>
            <button type="button" onClick={() => navigate({ size: query.size })}>重置</button>
            <button type="button" onClick={() => setRetry((value) => value + 1)}>刷新</button>
          </div>
        </form>
        {filterError && <div className="inline-alert" role="alert">{filterError}</div>}
        <div className="warehouse-archive-actions"><button type="button" disabled={exporting || state.status !== "ready" || state.data.totalElements === 0} onClick={() => void exportOrderStatuses()}>{exporting ? "正在导出…" : "导出筛选结果"}</button></div>
        {exportFeedback?.queryKey === exportQueryKey && <p className={`warehouse-export-feedback is-${exportFeedback.kind}`} role={exportFeedback.kind === "error" ? "alert" : "status"}>{exportFeedback.message}</p>}

        {state.status === "loading" && <div className="warehouse-archive-empty" role="status"><strong>正在读取订单状态报表…</strong></div>}
        {state.status === "error" && <div className="inline-alert" role="alert">{state.message}<button type="button" onClick={() => setRetry((value) => value + 1)}>重试</button></div>}
        {state.status === "ready" && <>
          <dl className="inventory-count-summary-grid" aria-label="订单状态报表摘要">
            <div><dt>订单总数</dt><dd>{state.data.totalOrders}</dd></div>
            <div><dt>统计天数</dt><dd>{state.data.totalElements}</dd></div>
            <div><dt>当前页天数</dt><dd>{state.data.items.length}</dd></div>
          </dl>
          <div className="warehouse-archive-table-wrap">
            <table aria-label="订单状态报表结果">
              <thead><tr><th>日期（UTC）</th><th>订单总数</th><th>数据库订单状态</th><th>操作</th></tr></thead>
              <tbody>{state.data.items.length === 0
                ? <tr><td colSpan={4}><div className="warehouse-archive-empty" role="status"><strong>没有符合条件的订单</strong><span>请调整店铺、平台或创建日期条件后重试。</span></div></td></tr>
                : state.data.items.map((day) => <tr key={day.reportDate}>
                  <td><time dateTime={day.reportDate}>{day.reportDate}</time></td>
                  <td>{day.orderCount}</td>
                  <td>{day.statuses.map((item) => <span className="cell-secondary" key={item.status}>{orderStatusLabels[item.status]} {item.orderCount}</span>)}</td>
                  <td><button className="text-button" type="button" onClick={() => router.history.push(orderCenterDayUrl(day.reportDate))}>查看当日订单</button></td>
                </tr>)}</tbody>
            </table>
          </div>
          <div className="procurement-plan-table-footer">
            <span>共 {state.data.totalElements} 天</span>
            <label>每页<select aria-label="订单状态报表每页天数" value={query.size} onChange={(event) => navigate({ ...query, page: 0, size: Number(event.target.value) })}>{ORDER_STATUS_PAGE_SIZES.map((size) => <option key={size} value={size}>{size} 天</option>)}</select></label>
            <div className="pagination"><button type="button" disabled={query.page === 0} onClick={() => navigate({ ...query, page: query.page - 1 })}>上一页</button><span>第 {query.page + 1} / {Math.max(state.data.totalPages, 1)} 页</span><button type="button" disabled={query.page + 1 >= state.data.totalPages} onClick={() => navigate({ ...query, page: query.page + 1 })}>下一页</button></div>
          </div>
        </>}
      </section>
    </main>
  );
}

export function AnalyticsProductSalesReportPage() {
  const router = useRouter();
  const search = useRouterState({ select: (state) => state.location.searchStr });
  const query = useMemo(() => parseAnalyticsProductSalesQuery(search), [search]);
  const [state, setState] = useState<ProductSalesLoadState>({ status: "loading" });
  const [retry, setRetry] = useState(0);
  const [filterError, setFilterError] = useState<string>();
  const [exporting, setExporting] = useState(false);
  const [exportFeedback, setExportFeedback] = useState<{ kind: "success" | "error"; message: string; queryKey: string }>();

  const navigate = (next: Partial<ProductSalesReportQuery>) => {
    router.history.push(toAnalyticsProductSalesUrl(next));
  };

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    void productSalesReportApi.summarize({
      keyword: query.keyword || undefined,
      placedFrom: orderStatusDayBoundary(query.startDate),
      placedToExclusive: orderStatusDayBoundary(query.endDate, true),
      page: query.page,
      size: query.size,
      signal: controller.signal,
    }).then(
      (data) => {
        const lastPage = Math.max(data.totalPages - 1, 0);
        if (query.page > lastPage) {
          navigate({ ...query, page: lastPage });
          return;
        }
        setState({ status: "ready", data });
      },
      (error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ status: "error", message: "暂时无法读取商品销量报表，请稍后重试。" });
      },
    );
    return () => controller.abort();
  }, [query, retry]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const startDate = validDateValue(String(data.get("startDate") ?? ""));
    const endDate = validDateValue(String(data.get("endDate") ?? ""));
    if (startDate && endDate && startDate > endDate) {
      setFilterError("起始日期不能晚于截止日期。");
      return;
    }
    setFilterError(undefined);
    navigate({
      startDate,
      endDate,
      keyword: String(data.get("keyword") ?? ""),
      page: 0,
      size: query.size,
    });
  };
  const exportQueryKey = toAnalyticsProductSalesUrl(query);
  const exportProductSales = async () => {
    if (exporting || state.status !== "ready" || state.data.totalSkuCount === 0) return;
    const queryKey = exportQueryKey;
    setExporting(true);
    setExportFeedback(undefined);
    try {
      const result = await productSalesReportApi.exportCsv({
        keyword: query.keyword || undefined,
        placedFrom: orderStatusDayBoundary(query.startDate),
        placedToExclusive: orderStatusDayBoundary(query.endDate, true),
      });
      const url = URL.createObjectURL(new Blob([result.content], { type: result.mediaType }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.filename;
      document.body.append(anchor);
      try { anchor.click(); } finally { anchor.remove(); URL.revokeObjectURL(url); }
      setExportFeedback({ kind: "success", message: `已导出 ${result.rowCount} 条商品销量。`, queryKey });
    } catch (error) {
      setExportFeedback({ kind: "error", message: productSalesExportMessage(error), queryKey });
    } finally {
      setExporting(false);
    }
  };
  return (
    <ReportPage title="商品销量报表" description="按订单下单日期和库存 SKU 查看已保存的销售数量。">
      <div className="warehouse-processing-formula" role="note"><strong>统计口径</strong><span>仅汇总已匹配库存 SKU 的非取消订单明细，并按当前账号可见仓库范围过滤；未匹配商品、退款、成本、金额、毛利和其他财务指标不进入本报表。</span></div>
      <form className="warehouse-archive-filters procurement-plan-filters" key={toAnalyticsProductSalesUrl(query)} onSubmit={submit}>
        <label>起始日期<input type="date" name="startDate" defaultValue={query.startDate} /></label>
        <label>截止日期<input type="date" name="endDate" defaultValue={query.endDate} /></label>
        <label className="procurement-plan-keyword">SKU 编码 / 名称<input name="keyword" maxLength={100} defaultValue={query.keyword} placeholder="输入完整或部分 SKU" /></label>
        <div className="warehouse-archive-filter-actions"><button className="is-primary" type="submit">搜索</button><button type="button" onClick={() => navigate({ size: query.size })}>重置</button><button type="button" onClick={() => setRetry((value) => value + 1)}>刷新</button></div>
      </form>
      {filterError && <div className="inline-alert" role="alert">{filterError}</div>}
      <div className="warehouse-archive-actions"><button type="button" disabled={exporting || state.status !== "ready" || state.data.totalSkuCount === 0} onClick={() => void exportProductSales()}>{exporting ? "正在导出…" : "导出筛选结果"}</button></div>
      {exportFeedback?.queryKey === exportQueryKey && <p className={`warehouse-export-feedback is-${exportFeedback.kind}`} role={exportFeedback.kind === "error" ? "alert" : "status"}>{exportFeedback.message}</p>}
      {state.status === "loading" && <div className="warehouse-archive-empty" role="status"><strong>正在读取商品销量报表…</strong></div>}
      {state.status === "error" && <div className="inline-alert" role="alert">{state.message}<button type="button" onClick={() => setRetry((value) => value + 1)}>重试</button></div>}
      {state.status === "ready" && <>
        <dl className="inventory-count-summary-grid" aria-label="商品销量报表摘要">
          <div><dt>销售 SKU 数</dt><dd>{state.data.totalSkuCount}</dd></div>
          <div><dt>销售总数量</dt><dd>{state.data.totalSalesQuantity}</dd></div>
          <div><dt>当前页 SKU</dt><dd>{state.data.items.length}</dd></div>
        </dl>
        <div className="warehouse-archive-table-wrap">
          <table aria-label="商品销量报表结果">
            <thead><tr><th>商品信息</th><th>主 SKU</th><th>规格</th><th>关联订单数</th><th>销售数量</th><th>首次下单</th><th>最近下单</th></tr></thead>
            <tbody>{state.data.items.length === 0
              ? <tr><td colSpan={7}><div className="warehouse-archive-empty" role="status"><strong>没有符合条件的商品销量</strong><span>请调整日期或 SKU 条件后重试。</span></div></td></tr>
              : state.data.items.map((item) => <tr key={item.skuId}>
                <td>{item.skuName}</td><td>{item.skuCode}</td><td>{item.variantSummary ?? "—"}</td><td>{item.orderCount}</td><td>{item.salesQuantity}</td>
                <td><time dateTime={item.firstPlacedAt}>{new Date(item.firstPlacedAt).toLocaleString()}</time></td>
                <td><time dateTime={item.lastPlacedAt}>{new Date(item.lastPlacedAt).toLocaleString()}</time></td>
              </tr>)}</tbody>
          </table>
        </div>
        <div className="procurement-plan-table-footer">
          <span>共 {state.data.totalSkuCount} 个 SKU</span>
          <label>每页<select aria-label="商品销量报表每页 SKU 数" value={query.size} onChange={(event) => navigate({ ...query, page: 0, size: Number(event.target.value) })}>{PRODUCT_SALES_PAGE_SIZES.map((size) => <option key={size} value={size}>{size} 个</option>)}</select></label>
          <div className="pagination"><button type="button" disabled={query.page === 0} onClick={() => navigate({ ...query, page: query.page - 1 })}>上一页</button><span>第 {query.page + 1} / {Math.max(state.data.totalPages, 1)} 页</span><button type="button" disabled={query.page + 1 >= state.data.totalPages} onClick={() => navigate({ ...query, page: query.page + 1 })}>下一页</button></div>
        </div>
      </>}
    </ReportPage>
  );
}
