import { useRouter, useRouterState } from "@tanstack/react-router";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { ApiError } from "../api/client";
import {
  procurementOrderApi,
  type ProcurementOrderPage,
  type ProcurementOrderSearchField,
} from "../modules/procurementOrderApi";
import "./WarehouseArchiveShells.css";

const DEFAULT_SIZE = 25;
const PAGE_SIZES = [10, 25, 50, 100] as const;
const SEARCH_FIELDS: ReadonlyArray<{
  value: ProcurementOrderSearchField;
  label: string;
}> = [
  { value: "PURCHASE_NO", label: "采购单号" },
  { value: "PLAN_NO", label: "计划编号" },
  { value: "SKU_CODE", label: "SKU 编号" },
  { value: "SKU_NAME", label: "SKU 名称" },
  { value: "SUPPLIER_NAME", label: "供应商" },
  { value: "ORDER_NOTE", label: "订单备注" },
];

type LoadState =
  | { status: "loading" }
  | { status: "ready"; data: ProcurementOrderPage }
  | { status: "error"; message: string };

export type ProcurementFollowUpQuery = {
  searchField: ProcurementOrderSearchField;
  keyword: string;
  createdFrom: string;
  createdTo: string;
  page: number;
  size: number;
};

function bounded(value: string | null, maximum: number) {
  return (value ?? "").trim().slice(0, maximum);
}

function oneOf<T extends string>(
  value: string | null,
  allowed: readonly T[],
  fallback: T,
) {
  return allowed.includes(value as T) ? value as T : fallback;
}

function integer(
  value: string | null,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

function date(value: string | null) {
  const result = bounded(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(result)
    && !Number.isNaN(Date.parse(`${result}T00:00:00Z`))
    ? result
    : "";
}

function startInstant(value: string) {
  return value ? `${value}T00:00:00.000Z` : undefined;
}

function endInstant(value: string) {
  return value ? `${value}T23:59:59.999Z` : undefined;
}

function exportErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 409) {
    return "导出结果超过 10,000 条，请缩小筛选范围后重试。";
  }
  if (error instanceof ApiError && error.status === 403) {
    return "当前账号没有导出采购跟单的权限。";
  }
  return "暂时无法导出采购跟单，请稍后重试。";
}

export function parseProcurementFollowUpQuery(
  search: string,
): ProcurementFollowUpQuery {
  const params = new URLSearchParams(search);
  return {
    searchField: oneOf(
      params.get("searchField"),
      SEARCH_FIELDS.map((item) => item.value),
      "PURCHASE_NO",
    ),
    keyword: bounded(params.get("keyword"), 120),
    createdFrom: date(params.get("createdFrom")),
    createdTo: date(params.get("createdTo")),
    page: integer(params.get("page"), 0, 0, 9_999),
    size: integer(params.get("size"), DEFAULT_SIZE, 1, 200),
  };
}

export function toProcurementFollowUpUrl(
  query: Partial<ProcurementFollowUpQuery>,
) {
  const params = new URLSearchParams();
  if (query.searchField && query.searchField !== "PURCHASE_NO") {
    params.set("searchField", query.searchField);
  }
  if (query.keyword?.trim()) {
    params.set("keyword", query.keyword.trim().slice(0, 120));
  }
  if (query.createdFrom && date(query.createdFrom)) {
    params.set("createdFrom", query.createdFrom);
  }
  if (query.createdTo && date(query.createdTo)) {
    params.set("createdTo", query.createdTo);
  }
  if (query.page && query.page > 0) params.set("page", String(query.page));
  if (query.size && query.size !== DEFAULT_SIZE) {
    params.set("size", String(query.size));
  }
  const serialized = params.toString();
  return serialized
    ? `/procurement/follow-up?${serialized}`
    : "/procurement/follow-up";
}

export function ProcurementFollowUpPage() {
  const router = useRouter();
  const search = useRouterState({
    select: (state) => state.location.searchStr,
  });
  const query = useMemo(
    () => parseProcurementFollowUpQuery(search),
    [search],
  );
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [filterError, setFilterError] = useState<string>();
  const [refreshKey, setRefreshKey] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportFeedback, setExportFeedback] = useState<{
    kind: "success" | "error";
    message: string;
    queryKey: string;
  }>();

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    void procurementOrderApi.list({
      searchField: query.searchField,
      keyword: query.keyword || undefined,
      receivableOnly: true,
      createdFrom: startInstant(query.createdFrom),
      createdTo: endInstant(query.createdTo),
      page: query.page,
      size: query.size,
      signal: controller.signal,
    }).then(
      (data) => {
        const lastPage = Math.max(data.totalPages - 1, 0);
        if (query.page > lastPage) {
          router.history.push(toProcurementFollowUpUrl({
            ...query,
            page: lastPage,
          }));
          return;
        }
        setState({ status: "ready", data });
      },
      (error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({
          status: "error",
          message: "暂时无法读取采购在途跟单，请稍后重试。",
        });
      },
    );
    return () => controller.abort();
  }, [query, refreshKey]);

  const navigate = (next: Partial<ProcurementFollowUpQuery>) => {
    router.history.push(toProcurementFollowUpUrl(next));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const createdFrom = date(String(data.get("createdFrom") ?? ""));
    const createdTo = date(String(data.get("createdTo") ?? ""));
    if (createdFrom && createdTo && createdFrom > createdTo) {
      setFilterError("下单起始日期不能晚于截止日期。");
      return;
    }
    setFilterError(undefined);
    navigate({
      searchField: oneOf(
        String(data.get("searchField") ?? ""),
        SEARCH_FIELDS.map((item) => item.value),
        "PURCHASE_NO",
      ),
      keyword: bounded(String(data.get("keyword") ?? ""), 120),
      createdFrom,
      createdTo,
      page: 0,
      size: query.size,
    });
  };

  const exportQueryKey = toProcurementFollowUpUrl(query);
  const exportCurrentResult = async () => {
    if (exporting || state.status !== "ready"
      || state.data.totalElements === 0) return;
    const queryKey = exportQueryKey;
    setExporting(true);
    setExportFeedback(undefined);
    try {
      const result = await procurementOrderApi.exportFollowUpCsv({
        searchField: query.searchField,
        keyword: query.keyword || undefined,
        createdFrom: startInstant(query.createdFrom),
        createdTo: endInstant(query.createdTo),
      });
      const url = URL.createObjectURL(
        new Blob([result.content], { type: result.mediaType }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.filename;
      document.body.append(anchor);
      try {
        anchor.click();
      } finally {
        anchor.remove();
        URL.revokeObjectURL(url);
      }
      setExportFeedback({
        kind: "success",
        message: `已导出 ${result.rowCount} 条采购跟单。`,
        queryKey,
      });
    } catch (error) {
      setExportFeedback({
        kind: "error",
        message: exportErrorMessage(error),
        queryKey,
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <main className="warehouse-archive-page" aria-labelledby="procurement-follow-up-title">
      <header className="warehouse-archive-heading">
        <div>
          <p className="eyebrow">供应链 / 采购流程</p>
          <h1 id="procurement-follow-up-title">采购跟单</h1>
          <p>查看已下单但尚未全部收货的采购单，并跟踪真实累计到货进度。</p>
        </div>
      </header>

      <section className="warehouse-archive-card" aria-label="采购跟单筛选与列表">
        <form
          className="warehouse-archive-filters procurement-order-filters"
          key={toProcurementFollowUpUrl(query)}
          onSubmit={submit}
        >
          <label>
            搜索字段
            <select name="searchField" defaultValue={query.searchField}>
              {SEARCH_FIELDS.map((field) => (
                <option key={field.value} value={field.value}>{field.label}</option>
              ))}
            </select>
          </label>
          <label className="procurement-plan-keyword">
            关键词
            <input name="keyword" maxLength={120} defaultValue={query.keyword} />
          </label>
          <label>
            下单起始日期
            <input name="createdFrom" type="date" defaultValue={query.createdFrom} />
          </label>
          <label>
            下单截止日期
            <input name="createdTo" type="date" defaultValue={query.createdTo} />
          </label>
          <div className="warehouse-archive-filter-actions">
            <button className="is-primary" type="submit">搜索</button>
            <button type="button" onClick={() => navigate({})}>重置</button>
            <button type="button" onClick={() => setRefreshKey((value) => value + 1)}>刷新</button>
          </div>
        </form>

        {filterError && <div className="inline-alert" role="alert">{filterError}</div>}
        <div className="warehouse-processing-formula" role="note">
          <strong>跟单口径</strong>
          <span>仅显示“待收货”或“部分收货”的采购单；待到货量为采购数量减去已收货数量。</span>
        </div>
        <div className="warehouse-archive-actions">
          <button type="button" disabled={exporting || state.status !== "ready" || state.data.totalElements === 0} onClick={() => void exportCurrentResult()}>{exporting ? "正在导出…" : "导出筛选结果"}</button>
        </div>
        {exportFeedback?.queryKey === exportQueryKey && <p className={`warehouse-export-feedback is-${exportFeedback.kind}`} role={exportFeedback.kind === "error" ? "alert" : "status"}>{exportFeedback.message}</p>}

        {state.status === "loading" && (
          <div className="warehouse-archive-empty" role="status">
            <strong>正在读取采购在途跟单…</strong>
          </div>
        )}
        {state.status === "error" && (
          <div className="inline-alert" role="alert">
            {state.message}
            <button type="button" onClick={() => setRefreshKey((value) => value + 1)}>重试</button>
          </div>
        )}
        {state.status === "ready" && (
          <>
            <div className="warehouse-archive-table-wrap">
              <table aria-label="采购跟单列表">
                <thead>
                  <tr>
                    <th scope="col">采购单 / 计划</th>
                    <th scope="col">商品</th>
                    <th scope="col">收货仓库 / 库位</th>
                    <th scope="col">供应商</th>
                    <th scope="col">采购数量</th>
                    <th scope="col">已到货</th>
                    <th scope="col">待到货</th>
                    <th scope="col">状态</th>
                    <th scope="col">下单员 / 时间</th>
                    <th scope="col">最近到货</th>
                  </tr>
                </thead>
                <tbody>
                  {state.data.items.length === 0 ? (
                    <tr>
                      <td colSpan={10}>
                        <div className="warehouse-archive-empty" role="status">
                          <strong>没有待跟进的采购单</strong>
                          <span>当前筛选条件下没有待收货或部分收货的采购单。</span>
                        </div>
                      </td>
                    </tr>
                  ) : state.data.items.map((order) => (
                    <tr key={order.purchaseOrderId}>
                      <td>{order.purchaseNo}<br /><small>{order.planNo}</small></td>
                      <td>{order.skuCode} · {order.skuName}<br /><small>{order.skuVariant ?? "—"}</small></td>
                      <td>{order.warehouseName}<br /><small>{order.locationCode} · {order.locationName}</small></td>
                      <td>{order.supplierCode} · {order.supplierName}<br /><small>{order.supplierSkuCode ?? "无供应商 SKU"}</small></td>
                      <td>{order.quantity}</td>
                      <td>{order.receivedQuantity}</td>
                      <td>{order.quantity - order.receivedQuantity}</td>
                      <td><span className="status-badge is-new-order">{order.status === "APPROVED" ? "待收货" : "部分收货"}</span></td>
                      <td>{order.orderedByDisplayName}<br /><time dateTime={order.createdAt}>{new Date(order.createdAt).toLocaleString()}</time></td>
                      <td>{order.lastReceivedAt ? <time dateTime={order.lastReceivedAt}>{new Date(order.lastReceivedAt).toLocaleString()}</time> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="procurement-plan-table-footer">
              <span>共 {state.data.totalElements} 条待跟单采购单</span>
              <label>
                每页
                <select
                  aria-label="采购跟单每页行数"
                  value={query.size}
                  onChange={(event) => navigate({
                    ...query,
                    page: 0,
                    size: Number(event.target.value),
                  })}
                >
                  {PAGE_SIZES.map((size) => (
                    <option key={size} value={size}>{size} 条</option>
                  ))}
                </select>
              </label>
              <div className="pagination">
                <button
                  type="button"
                  disabled={query.page === 0}
                  onClick={() => navigate({ ...query, page: query.page - 1 })}
                >上一页</button>
                <span>第 {query.page + 1} / {Math.max(state.data.totalPages, 1)} 页</span>
                <button
                  type="button"
                  disabled={query.page + 1 >= state.data.totalPages}
                  onClick={() => navigate({ ...query, page: query.page + 1 })}
                >下一页</button>
              </div>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
