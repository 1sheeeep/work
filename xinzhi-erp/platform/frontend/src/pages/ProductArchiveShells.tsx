import { type FormEvent, useCallback, useEffect, useState } from "react";
import { ApiError } from "../api/client";
import {
  type ShopifyInventoryPublicationException,
  inventoryApi,
} from "../modules/inventoryApi";
import { shopCenterApi, type TenantShop } from "../modules/shopCenterApi";
import { InventoryPeriodReport } from "./InventoryPeriodReport";
import { InventoryAgingReport } from "./InventoryAgingReport";
export { InventorySyncRulesSection } from "./InventorySyncRulesSection";

function formText(data: FormData, name: string) {
  return String(data.get(name) ?? "").trim().slice(0, 100);
}

function unavailableState(title: string, detail: string) {
  return (
    <div className="compact-empty-state" role="status">
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

export function InventoryAgingSection({
  keyword,
  cutoff,
  warehouseId,
  onFilter,
  onReset,
}: {
  keyword: string;
  cutoff?: string;
  warehouseId?: string;
  onFilter: (
    keyword: string,
    cutoff: string,
    warehouseId?: string,
  ) => void;
  onReset: () => void;
}) {
  return (
    <section
      className="detail-card product-section erp-data-workbench"
      aria-labelledby="inventory-aging-title"
    >
      <div className="table-heading">
        <div>
          <h2 id="inventory-aging-title">库龄分析</h2>
          <p>按仓库和库存 SKU 查看在库数量的年龄分布。</p>
        </div>
      </div>
      <InventoryAgingReport
        keyword={keyword}
        cutoff={cutoff}
        warehouseId={warehouseId}
        onFilter={onFilter}
        onReset={onReset}
      />
    </section>
  );
}

export function InventoryReportSection({
  keyword,
  start,
  end,
  onFilter,
  onReset,
}: {
  keyword: string;
  start?: string;
  end?: string;
  onFilter: (
    keyword: string,
    start: string,
    end: string,
  ) => void;
  onReset: () => void;
}) {
  return (
    <section
      className="detail-card product-section erp-data-workbench"
      aria-labelledby="inventory-report-title"
    >
      <div className="table-heading">
        <div>
          <h2 id="inventory-report-title">进销存报表</h2>
          <p>按库存账本查看期初、期间增加、期间减少与期末数量。</p>
        </div>
      </div>
      <InventoryPeriodReport
        keyword={keyword}
        start={start}
        end={end}
        onFilter={onFilter}
        onReset={onReset}
      />
    </section>
  );
}

export function InventorySyncExceptionsArchiveSection({
  platform,
  shop,
  start,
  end,
  keyword,
  onFilter,
}: {
  platform: string;
  shop: string;
  start?: string;
  end?: string;
  keyword: string;
  onFilter: (
    platform: string,
    shop: string,
    start?: string,
    end?: string,
    keyword?: string,
  ) => void;
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onFilter(
      formText(data, "syncPlatform"),
      formText(data, "syncShop"),
      formText(data, "syncStart") || undefined,
      formText(data, "syncEnd") || undefined,
      formText(data, "syncKeyword") || undefined,
    );
  };
  return (
    <section
      className="detail-card product-section erp-data-workbench"
      aria-labelledby="inventory-sync-exceptions-title"
    >
      <div className="table-heading">
        <div>
          <h2 id="inventory-sync-exceptions-title">库存同步异常</h2>
          <p>查看库存同步问题及处理状态。</p>
        </div>
      </div>
      <form
        className="toolbar-row"
        key={`${platform}:${shop}:${start ?? ""}:${end ?? ""}:${keyword}`}
        onSubmit={submit}
      >
        <label>
          平台
          <input
            aria-label="同步异常平台"
            name="syncPlatform"
            defaultValue={platform}
            maxLength={100}
            placeholder="选择平台"
          />
        </label>
        <label>
          店铺
          <input
            aria-label="同步异常店铺"
            name="syncShop"
            defaultValue={shop}
            maxLength={100}
            placeholder="选择店铺"
          />
        </label>
        <label>
          开始日期
          <input
            aria-label="同步异常开始日期"
            name="syncStart"
            type="date"
            defaultValue={start}
          />
        </label>
        <label>
          结束日期
          <input
            aria-label="同步异常结束日期"
            name="syncEnd"
            type="date"
            defaultValue={end}
          />
        </label>
        <label>
          搜索内容
          <input
            aria-label="同步异常搜索内容"
            name="syncKeyword"
            defaultValue={keyword}
            maxLength={100}
            placeholder="请输入内容"
          />
        </label>
        <button className="button button-primary" type="submit">
          查询
        </button>
      </form>
      {unavailableState(
        "暂无库存同步异常",
        "请调整查询条件后重试。",
      )}
    </section>
  );
}

type ExceptionLoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: ShopifyInventoryPublicationException[] };

const EXCEPTION_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function exceptionStatusLabel(
  status: ShopifyInventoryPublicationException["status"],
) {
  if (status === "UNCERTAIN") return "系统核对中";
  if (status === "STALE") return "库存已变化";
  return "发布被拒绝";
}

function exceptionReason(item: ShopifyInventoryPublicationException) {
  if (item.status === "UNCERTAIN") {
    return "Shopify 返回结果尚未确认，系统会按同一幂等任务继续核对。";
  }
  if (item.safeErrorCode === "ERP_INVENTORY_STATE_CHANGED") {
    return "ERP 库存已变化，本次发布已安全停止。";
  }
  if (item.safeErrorCode === "SHOPIFY_INVENTORY_STALE") {
    return "Shopify 库存已变化，本次发布没有覆盖线上库存。";
  }
  if (item.safeErrorCode === "SHOPIFY_IDEMPOTENCY_CONFLICT") {
    return "请求与既有幂等任务冲突，需要重新预检。";
  }
  return "Shopify 未接受本次库存更新，请检查授权和库存映射后重新预检。";
}

function exceptionTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function safeExceptionLoadMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 403) {
    return "当前账号没有读取库存同步异常所需权限。";
  }
  return "暂时无法读取库存同步异常，请稍后重试。";
}

function exceptionRecoveryUrl(item: ShopifyInventoryPublicationException) {
  const query = new URLSearchParams({
    warehouseId: item.warehouseId,
    searchField: "INVENTORY_SKU",
    keyword: item.skuCode.slice(0, 100),
    page: "0",
    size: "50",
  });
  return `/products/inventory-query?${query.toString()}`;
}

export function InventorySyncExceptionsSection({
  platform,
  shop,
  start,
  end,
  keyword,
  onFilter,
}: {
  platform: string;
  shop: string;
  start?: string;
  end?: string;
  keyword: string;
  onFilter: (
    platform: string,
    shop: string,
    start?: string,
    end?: string,
    keyword?: string,
  ) => void;
}) {
  const selectedShopId = EXCEPTION_UUID_PATTERN.test(shop) ? shop : "";
  const [state, setState] = useState<ExceptionLoadState>({ status: "loading" });
  const [shops, setShops] = useState<TenantShop[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [checkingId, setCheckingId] = useState<string>();

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const items = await inventoryApi.listShopifyInventoryPublicationExceptions({
        shopId: selectedShopId || undefined,
        start,
        end,
        keyword,
        limit: 100,
      });
      setState({ status: "ready", items });
    } catch (error) {
      setState({ status: "error", message: safeExceptionLoadMessage(error) });
    }
  }, [end, keyword, selectedShopId, start]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    let active = true;
    void shopCenterApi.listShops({
      page: 0,
      size: 200,
      includeArchived: false,
      authorizationStatus: "AUTHORIZED",
    }).then(
      (page) => {
        if (active) setShops(page.items);
      },
      () => {
        if (active) setShops([]);
      },
    );
    return () => {
      active = false;
    };
  }, []);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onFilter(
      "SHOPIFY",
      formText(data, "syncShop"),
      formText(data, "syncStart") || undefined,
      formText(data, "syncEnd") || undefined,
      formText(data, "syncKeyword") || undefined,
    );
  };

  const checkLatest = async (item: ShopifyInventoryPublicationException) => {
    setCheckingId(item.id);
    try {
      await inventoryApi.getShopifyInventoryPublication(item.id);
      setRefreshKey((value) => value + 1);
    } catch (error) {
      setState({ status: "error", message: safeExceptionLoadMessage(error) });
    } finally {
      setCheckingId(undefined);
    }
  };

  return (
    <section
      className="detail-card product-section erp-data-workbench"
      aria-labelledby="inventory-sync-exceptions-title"
    >
      <div className="table-heading">
        <div>
          <h2 id="inventory-sync-exceptions-title">库存同步异常</h2>
          <p>集中查看库存发布失败和待核对任务。</p>
        </div>
        <button
          className="button button-secondary"
          type="button"
          disabled={state.status === "loading"}
          onClick={() => setRefreshKey((value) => value + 1)}
        >
          刷新状态
        </button>
      </div>
      <form
        className="toolbar-row"
        key={`${platform}:${shop}:${start ?? ""}:${end ?? ""}:${keyword}`}
        onSubmit={submit}
      >
        <label>
          平台
          <input aria-label="同步异常平台" value="Shopify" readOnly />
        </label>
        <label>
          店铺
          <select aria-label="同步异常店铺" name="syncShop" defaultValue={selectedShopId}>
            <option value="">全部已授权店铺</option>
            {shops.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.displayName} · {candidate.externalShopRef}
              </option>
            ))}
          </select>
        </label>
        <label>
          开始日期
          <input aria-label="同步异常开始日期" name="syncStart" type="date" defaultValue={start} />
        </label>
        <label>
          结束日期
          <input aria-label="同步异常结束日期" name="syncEnd" type="date" defaultValue={end} />
        </label>
        <label>
          SKU / 仓库 / 原因
          <input
            aria-label="同步异常搜索内容"
            name="syncKeyword"
            defaultValue={keyword}
            maxLength={100}
            placeholder="输入 SKU、仓库或错误分类"
          />
        </label>
        <button className="button button-primary" type="submit">查询</button>
      </form>

      {state.status === "loading" && (
        <p className="product-state" aria-busy="true">正在加载库存同步异常…</p>
      )}
      {state.status === "error" && (
        <div className="compact-empty-state" role="alert">
          <strong>无法读取库存同步异常</strong>
          <span>{state.message}</span>
          <button className="text-button" type="button" onClick={() => void load()}>重试</button>
        </div>
      )}
      {state.status === "ready" && state.items.length === 0 && (
        <div className="compact-empty-state" role="status">
          <strong>当前没有库存同步异常</strong>
          <span>发布成功的任务不会进入此列表；可调整筛选条件后再次查询。</span>
        </div>
      )}
      {state.status === "ready" && state.items.length > 0 && (
        <div className="shop-table-scroll">
          <table className="shop-table">
            <caption className="sr-only">Shopify 库存同步异常列表</caption>
            <thead>
              <tr>
                <th>状态</th>
                <th>店铺</th>
                <th>库存 SKU</th>
                <th>仓库</th>
                <th>数量快照</th>
                <th>异常原因</th>
                <th>更新时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {state.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <span className={`status-chip ${item.status === "UNCERTAIN" ? "authorization-pending" : "shop-status-suspended"}`}>
                      {exceptionStatusLabel(item.status)}
                    </span>
                    <small>尝试 {item.attemptCount} 次</small>
                  </td>
                  <td>{item.shopName}<small>{item.externalShopRef}</small></td>
                  <td><code>{item.skuCode}</code><small>{item.skuName}</small></td>
                  <td>{item.warehouseName}<small>{item.warehouseCode}</small></td>
                  <td>ERP {item.targetAvailable}<small>预检时 Shopify {item.expectedShopifyAvailable}</small></td>
                  <td>{exceptionReason(item)}<small>{item.safeErrorCode ?? "等待系统核对"}</small></td>
                  <td>{exceptionTime(item.updatedAt)}</td>
                  <td>
                    {item.status === "UNCERTAIN" ? (
                      <button
                        className="text-button"
                        type="button"
                        disabled={checkingId === item.id}
                        onClick={() => void checkLatest(item)}
                      >
                        {checkingId === item.id ? "正在核对…" : "查询最新状态"}
                      </button>
                    ) : (
                      <a
                        className="text-button"
                        href={exceptionRecoveryUrl(item)}
                      >
                        重新预检
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
