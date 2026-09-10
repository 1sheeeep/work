import {
  ArrowRight,
  ClipboardCheck,
  ClipboardList,
  PackageCheck,
  PackageSearch,
  RefreshCw,
  ShieldCheck,
  Store,
  type LucideIcon,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import {
  orderCenterApi,
  type DashboardSummary,
  type OrderStatus,
} from "../modules/orderCenterApi";
import { procurementOrderApi } from "../modules/procurementOrderApi";
import {
  productSalesBoardApi,
  type ProductSalesBoard,
  type ProductSalesBoardItem,
} from "../modules/productSalesBoardApi";
import {
  getAccessibleTenantNavigation,
  splitNavigationTarget,
} from "../modules/navigationDefinitions";

type SummaryState = "idle" | "loading" | "ready" | "error";

const orderStatusSummaries: Array<{
  label: string;
  property: keyof Pick<
    DashboardSummary,
    | "receivedOrders"
    | "reviewPendingOrders"
    | "holdOrders"
    | "readyToFulfillOrders"
    | "cancelledOrders"
  >;
  status: OrderStatus;
}> = [
  { label: "已接收", property: "receivedOrders", status: "RECEIVED" },
  {
    label: "待审核",
    property: "reviewPendingOrders",
    status: "REVIEW_PENDING",
  },
  { label: "已挂起", property: "holdOrders", status: "HOLD" },
  {
    label: "待履约",
    property: "readyToFulfillOrders",
    status: "READY_TO_FULFILL",
  },
  { label: "已取消", property: "cancelledOrders", status: "CANCELLED" },
];

const localDateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "short",
  timeStyle: "short",
});

function localizeDateTime(value: string | undefined): { display: string; raw?: string } {
  if (!value) {
    return { display: "暂无" };
  }

  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return { display: "暂无" };
  }

  return { display: localDateTimeFormatter.format(date), raw: value };
}

function safeSummaryError(error: unknown): string {
  if (error instanceof ApiError && error.status === 403) {
    return "当前账号暂时无法读取订单摘要，请刷新会话或联系企业管理员确认订单查看权限。";
  }

  return "订单摘要暂时无法加载，请稍后重试。";
}

function safeProcurementSummaryError(error: unknown): string {
  if (error instanceof ApiError && error.status === 403) {
    return "当前账号暂时无法读取采购单待办，请刷新会话或联系企业管理员确认采购查看权限。";
  }

  return "采购单待办暂时无法加载，请稍后重试。";
}

function safeProductBoardError(error: unknown): string {
  if (error instanceof ApiError && error.status === 403) {
    return "当前账号暂时无法读取商品销量看板，请确认商品和报表查看权限。";
  }

  return "商品销量看板暂时无法加载，请稍后重试。";
}

export function DashboardPage() {
  const { currentTenant, currentUser, hasPermission } = useAuth();
  const accessibleModules = getAccessibleTenantNavigation(hasPermission).filter(
    (item) => item.id !== "dashboard",
  );
  const canReadOrders = hasPermission("orders.read");
  const canReadProducts = hasPermission("products.read");
  const canReadAnalytics = hasPermission("analytics.read");
  const canReadProcurement = hasPermission("procurement.read");
  const canReadShops = hasPermission("shop:read");
  const canReadSettings = hasPermission("settings.read");
  const requestVersion = useRef(0);
  const [summaryState, setSummaryState] = useState<SummaryState>("idle");
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [summaryMessage, setSummaryMessage] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const procurementRequestVersion = useRef(0);
  const [procurementSummaryState, setProcurementSummaryState] = useState<SummaryState>("idle");
  const [pendingProcurementOrders, setPendingProcurementOrders] = useState<number | null>(null);
  const [procurementSummaryMessage, setProcurementSummaryMessage] = useState("");
  const [procurementRefreshKey, setProcurementRefreshKey] = useState(0);

  useEffect(() => {
    if (!canReadOrders) {
      requestVersion.current += 1;
      setSummary(null);
      setSummaryMessage("");
      setSummaryState("idle");
      return;
    }

    const request = ++requestVersion.current;
    setSummary(null);
    setSummaryMessage("");
    setSummaryState("loading");

    void orderCenterApi
      .dashboardSummary()
      .then((result) => {
        if (request !== requestVersion.current) return;
        setSummary(result);
        setSummaryState("ready");
      })
      .catch((error: unknown) => {
        if (request !== requestVersion.current) return;
        setSummaryMessage(safeSummaryError(error));
        setSummaryState("error");
      });

    return () => {
      if (request === requestVersion.current) requestVersion.current += 1;
    };
  }, [canReadOrders, refreshKey]);

  useEffect(() => {
    if (!canReadProcurement) {
      procurementRequestVersion.current += 1;
      setPendingProcurementOrders(null);
      setProcurementSummaryMessage("");
      setProcurementSummaryState("idle");
      return;
    }

    const request = ++procurementRequestVersion.current;
    setPendingProcurementOrders(null);
    setProcurementSummaryMessage("");
    setProcurementSummaryState("loading");

    void procurementOrderApi
      .list({ searchField: "PURCHASE_NO", status: "NEW_ORDER", page: 0, size: 1 })
      .then((result) => {
        if (request !== procurementRequestVersion.current) return;
        setPendingProcurementOrders(result.totalElements);
        setProcurementSummaryState("ready");
      })
      .catch((error: unknown) => {
        if (request !== procurementRequestVersion.current) return;
        setProcurementSummaryMessage(safeProcurementSummaryError(error));
        setProcurementSummaryState("error");
      });

    return () => {
      if (request === procurementRequestVersion.current) {
        procurementRequestVersion.current += 1;
      }
    };
  }, [canReadProcurement, procurementRefreshKey]);

  return (
    <div className="dashboard-page">
      <section className="page-heading workbench-page-heading">
        <div>
          <h1>工作台</h1>
          <p>欢迎回来，{currentUser?.displayName}。优先处理当前企业的业务事项。</p>
        </div>
      </section>

      <section className="workbench-context" aria-label="当前工作上下文">
        <div>
          <span>当前企业</span>
          <strong>{currentTenant?.name ?? "—"}</strong>
        </div>
        <div>
          <span>登录账号</span>
          <strong>{currentUser?.username ?? "—"}</strong>
        </div>
        <div>
          <span>可访问模块</span>
          <strong>{accessibleModules.length}</strong>
        </div>
      </section>

      {canReadOrders && (
        <OrderSummary
          message={summaryMessage}
          onRefresh={() => setRefreshKey((current) => current + 1)}
          state={summaryState}
          summary={summary}
        />
      )}

      <WorkbenchTodoBoard
        canReadOrders={canReadOrders}
        canReadProcurement={canReadProcurement}
        canReadShops={canReadShops}
        onProcurementRetry={() => setProcurementRefreshKey((current) => current + 1)}
        procurementMessage={procurementSummaryMessage}
        procurementState={procurementSummaryState}
        pendingProcurementOrders={pendingProcurementOrders}
        summary={summaryState === "ready" ? summary : null}
      />

      {canReadProducts && canReadAnalytics && <ProductBoard />}

      {canReadShops && <ShopStatusBoard />}

      {canReadSettings && <AnnouncementBoard />}

      <section
        className="section-block workbench-module-section"
        aria-labelledby="workbench-modules-title"
      >
        <div className="section-heading compact-section-heading">
          <div>
            <h2 id="workbench-modules-title">常用功能</h2>
            <p>功能入口会按当前账号权限显示。</p>
          </div>
        </div>

        {accessibleModules.length > 0 ? (
          <nav className="workbench-shortcut-grid" aria-label="可访问功能">
            {accessibleModules.map((module) => {
              const Icon = module.icon;
              const target = splitNavigationTarget(module.to);
              return (
                <Link
                  className="workbench-shortcut-card"
                  key={module.id}
                  to={target.pathname as never}
                  search={target.search as never}
                >
                  <span className="workbench-shortcut-icon">
                    <Icon size={21} aria-hidden="true" />
                  </span>
                  <span>
                    <strong>{module.label}</strong>
                    <small>进入功能</small>
                  </span>
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
              );
            })}
          </nav>
        ) : (
          <div className="compact-empty-state" role="status">
            <ShieldCheck size={20} aria-hidden="true" />
            <div>
              <strong>暂时没有可访问的业务模块</strong>
              <span>请联系企业管理员为当前角色分配所需权限。</span>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

type TodoItem = {
  label: string;
  to: string;
  value?: number;
  description: string;
  icon: LucideIcon;
};

function WorkbenchTodoBoard({
  canReadOrders,
  canReadProcurement,
  canReadShops,
  onProcurementRetry,
  procurementMessage,
  procurementState,
  pendingProcurementOrders,
  summary,
}: {
  canReadOrders: boolean;
  canReadProcurement: boolean;
  canReadShops: boolean;
  onProcurementRetry: () => void;
  procurementMessage: string;
  procurementState: SummaryState;
  pendingProcurementOrders: number | null;
  summary: DashboardSummary | null;
}) {
  const items: TodoItem[] = [];
  if (canReadOrders) {
    items.push(
      { label: "待审核订单", to: "/orders?status=REVIEW_PENDING", value: summary?.reviewPendingOrders, description: "订单", icon: ClipboardCheck },
      { label: "待履约订单", to: "/orders?status=READY_TO_FULFILL", value: summary?.readyToFulfillOrders, description: "订单", icon: PackageCheck },
    );
  }
  if (canReadProcurement)
    items.push({
      label: "待审核采购单",
      to: "/procurement/orders?status=NEW_ORDER",
      value: procurementState === "ready" ? pendingProcurementOrders ?? undefined : undefined,
      description: "采购",
      icon: ClipboardList,
    });
  if (canReadShops)
    items.push({ label: "店铺授权状态", to: "/shops", description: "店铺", icon: Store });

  if (items.length === 0) return null;

  return (
    <section className="section-block workbench-archive-section" aria-labelledby="workbench-todos-title">
      <div className="section-heading compact-section-heading">
        <div>
          <h2 id="workbench-todos-title">待办事项</h2>
          <p>集中查看需要处理的业务事项。</p>
        </div>
      </div>
      <div className="workbench-todo-grid">
        {items.map((item) => {
          const Icon = item.icon;
          const target = splitNavigationTarget(item.to);
          return (
            <Link className="workbench-todo-card" key={item.label} to={target.pathname as never} search={target.search as never}>
              <span className="workbench-todo-icon"><Icon size={17} aria-hidden="true" /></span>
              <span className="workbench-todo-category">{item.description}</span>
              <strong>{item.value ?? "—"}</strong>
              <small>{item.label}<ArrowRight size={14} aria-hidden="true" /></small>
            </Link>
          );
        })}
      </div>
      {canReadProcurement && procurementState === "error" ? (
        <p className="workbench-contract-note" role="alert">
          {procurementMessage}
          {" "}
          <button className="text-button" type="button" onClick={onProcurementRetry}>重试</button>
        </p>
      ) : canReadProcurement && procurementState === "loading" ? (
        <p className="workbench-contract-note" role="status">正在加载待审核采购单数量…</p>
      ) : (
        <p className="workbench-contract-note">
          {canReadProcurement && "待审核采购单按当前账号可见仓库范围统计。"}
          {canReadShops && "暂无店铺待办数据。"}
        </p>
      )}
    </section>
  );
}

const PRODUCT_BOARD_COLUMNS = [
  "排名",
  "SKU / 商品",
  "近 7 日销量",
  "订单数",
  "最近成交",
] as const;

function ProductBoard() {
  const [view, setView] = useState<"hot" | "low">("hot");
  const [observedAt, setObservedAt] = useState(() => new Date().toISOString());
  const [state, setState] = useState<SummaryState>("loading");
  const [board, setBoard] = useState<ProductSalesBoard | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setState("loading");
    setBoard(null);
    setMessage("");
    void productSalesBoardApi.summarize({ observedAt, limit: 5, signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        setBoard(result);
        setState("ready");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setMessage(safeProductBoardError(error));
        setState("error");
      });
    return () => controller.abort();
  }, [observedAt]);

  const items = board ? (view === "hot" ? board.hotItems : board.lowItems) : [];
  return (
    <section className="section-block workbench-archive-section" aria-labelledby="workbench-products-title">
      <div className="section-heading compact-section-heading">
        <div>
          <h2 id="workbench-products-title">商品看板</h2>
          <p>近 7 日销量排行；低销量包含当前可见范围内零销量的活跃 SKU。</p>
        </div>
        <div className="page-actions">
          <button
            className="text-button"
            disabled={state === "loading"}
            type="button"
            onClick={() => setObservedAt(new Date().toISOString())}
          >
            <RefreshCw size={14} aria-hidden="true" />刷新
          </button>
          <Link className="text-button" to={"/analytics/sales/product-sales" as never}>
            商品销量报表<ArrowRight size={14} aria-hidden="true" />
          </Link>
        </div>
      </div>
      <div className="workbench-archive-tabs" role="tablist" aria-label="商品排行类型">
        <button type="button" role="tab" aria-controls="product-board-panel" aria-selected={view === "hot"} className={view === "hot" ? "is-active" : undefined} onClick={() => setView("hot")}>热销</button>
        <button type="button" role="tab" aria-controls="product-board-panel" aria-selected={view === "low"} className={view === "low" ? "is-active" : undefined} onClick={() => setView("low")}>低销量</button>
      </div>
      <div className="workbench-archive-table-wrap" id="product-board-panel" role="tabpanel">
        <table>
          <thead><tr>{PRODUCT_BOARD_COLUMNS.map((column) => <th scope="col" key={column}>{column}</th>)}</tr></thead>
          <tbody>
            {state === "loading" && (
              <tr><td colSpan={PRODUCT_BOARD_COLUMNS.length}><div className="compact-empty-state" role="status" aria-busy="true">正在加载商品销量排行…</div></td></tr>
            )}
            {state === "error" && (
              <tr><td colSpan={PRODUCT_BOARD_COLUMNS.length}>
                <div className="inline-alert" role="alert">
                  <div><strong>商品看板加载失败</strong><span>{message}</span></div>
                  <button className="text-button" type="button" onClick={() => setObservedAt(new Date().toISOString())}>重试</button>
                </div>
              </td></tr>
            )}
            {state === "ready" && items.length === 0 && (
              <tr><td colSpan={PRODUCT_BOARD_COLUMNS.length}><DashboardEmptyState icon="product" text={`当前范围内暂无${view === "hot" ? "热销" : "低销量"}商品`} /></td></tr>
            )}
            {state === "ready" && items.map((item, index) => (
              <ProductBoardRow index={index} item={item} key={item.skuId} />
            ))}
          </tbody>
        </table>
      </div>
      {state === "ready" && board && (
        <p className="workbench-contract-note">
          活跃 SKU {board.activeSkuCount} 个，其中近 7 日有销量 {board.soldSkuCount} 个，合计销量 {board.salesQuantity} 件；数据截至 {localizeDateTime(board.observedAt).display}。
        </p>
      )}
    </section>
  );
}

function ProductBoardRow({ index, item }: { index: number; item: ProductSalesBoardItem }) {
  const lastPlacedAt = localizeDateTime(item.lastPlacedAt);
  return (
    <tr className="workbench-product-row">
      <td>{index + 1}</td>
      <td><strong>{item.skuCode}</strong><br /><span>{item.skuName}{item.variantSummary ? ` · ${item.variantSummary}` : ""}</span></td>
      <td>{item.salesQuantity}</td>
      <td>{item.orderCount}</td>
      <td>{lastPlacedAt.raw ? <time dateTime={lastPlacedAt.raw}>{lastPlacedAt.display}</time> : lastPlacedAt.display}</td>
    </tr>
  );
}

function ShopStatusBoard() {
  return (
    <section className="section-block workbench-archive-section" aria-labelledby="workbench-shops-title">
      <div className="section-heading compact-section-heading">
        <div>
          <h2 id="workbench-shops-title">店铺状态</h2>
          <p>查看店铺授权状态。</p>
        </div>
        <Link className="text-button" to={"/shops" as never}>查看店铺列表<ArrowRight size={14} aria-hidden="true" /></Link>
      </div>
      <dl className="workbench-status-grid">
        {[
          ["已授权平台", "Shopify"],
          ["已授权店铺", "—"],
          ["店铺授权异常", "—"],
        ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
      <p className="workbench-contract-note">暂无店铺数量与授权异常数据。</p>
    </section>
  );
}

function AnnouncementBoard() {
  const [view, setView] = useState<"system" | "internal">("system");
  return (
    <section className="section-block workbench-archive-section" aria-labelledby="workbench-notices-title">
      <div className="section-heading compact-section-heading">
        <div>
          <h2 id="workbench-notices-title">公告</h2>
          <p>查看系统与内部公告。</p>
        </div>
        {view === "internal" && <Link className="text-button" to={"/settings/tasks/notices" as never}>更多内部公告<ArrowRight size={14} aria-hidden="true" /></Link>}
      </div>
      <div className="workbench-archive-tabs" role="tablist" aria-label="公告类型">
        <button type="button" role="tab" aria-selected={view === "system"} className={view === "system" ? "is-active" : undefined} onClick={() => setView("system")}>系统公告</button>
        <button type="button" role="tab" aria-selected={view === "internal"} className={view === "internal" ? "is-active" : undefined} onClick={() => setView("internal")}>内部公告</button>
      </div>
      <DashboardEmptyState icon="notice" text={`暂无${view === "system" ? "系统" : "内部"}公告`} />
    </section>
  );
}

function DashboardEmptyState({ icon, text }: { icon: "product" | "notice"; text: string }) {
  const Icon = icon === "product" ? PackageSearch : ClipboardList;
  return <div className="compact-empty-state workbench-archive-empty" role="status"><Icon size={20} aria-hidden="true" /><div><strong>暂无数据</strong><span>{text}</span></div></div>;
}

function OrderSummary({
  state,
  summary,
  message,
  onRefresh,
}: {
  state: SummaryState;
  summary: DashboardSummary | null;
  message: string;
  onRefresh: () => void;
}) {
  const oldestUnmatchedPlacedAt = localizeDateTime(summary?.oldestUnmatchedPlacedAt);

  return (
    <section className="order-overview-panel dashboard-order-summary" aria-labelledby="dashboard-orders-title">
      <div className="order-overview-heading">
        <div>
          <h2 id="dashboard-orders-title">订单摘要</h2>
          <p>仅统计当前账号可访问店铺的真实订单数据。</p>
        </div>
        <button
          className="button button-secondary"
          disabled={state === "loading"}
          type="button"
          onClick={onRefresh}
        >
          <RefreshCw size={15} aria-hidden="true" />
          刷新
        </button>
      </div>

      {state === "loading" && (
        <div className="compact-empty-state" role="status" aria-busy="true">
          正在加载订单摘要…
        </div>
      )}

      {state === "error" && (
        <div className="inline-alert" role="alert">
          <div>
            <strong>订单摘要加载失败</strong>
            <span>{message}</span>
          </div>
          <button className="text-button" type="button" onClick={onRefresh}>
            重试
          </button>
        </div>
      )}

      {state === "ready" && summary?.totalOrders === 0 && (
        <div className="compact-empty-state" role="status">
          <div>
            <strong>暂无订单数据</strong>
            <span>当前账号可访问的店铺尚未产生订单，可前往订单列表调整筛选条件。</span>
          </div>
          <Link className="text-button" to={"/orders" as never} aria-label="前往订单列表">
            查看订单列表
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </div>
      )}

      {state === "ready" && summary && summary.totalOrders > 0 && (
        <dl className="order-overview-metrics">
          <SummaryLink label="订单总数" value={summary.totalOrders} to="/orders" />
          {orderStatusSummaries.map(({ label, property, status }) => (
            <SummaryLink
              key={status}
              label={label}
              value={summary[property]}
              to="/orders"
              search={{ status }}
            />
          ))}
          <SummaryValue label="可编辑订单" value={summary.editableOrders} />
          <SummaryLink
            label="未匹配明细"
            value={summary.unmatchedLines}
            to="/orders"
            search={{ view: "queue", page: "0" }}
            unit="条明细"
          />
          <SummaryLink
            label="最早未匹配下单时间"
            value={oldestUnmatchedPlacedAt.display}
            to="/orders"
            search={{ view: "queue", page: "0" }}
            time={oldestUnmatchedPlacedAt.raw}
          />
        </dl>
      )}
    </section>
  );
}

function SummaryLink({
  label,
  value,
  to,
  search,
  time,
  unit = "条订单",
}: {
  label: string;
  value: string | number;
  to: "/orders";
  search?: Record<string, string>;
  time?: string;
  unit?: string;
}) {
  const linkLabel =
    typeof value === "number" ? `查看${label} ${value} ${unit}` : `查看${label}`;

  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <Link
          className="text-button"
          to={to as never}
          search={search as never}
          aria-label={linkLabel}
        >
          {time ? <time dateTime={time}>{value}</time> : value}
          <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </dd>
    </div>
  );
}

function SummaryValue({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
