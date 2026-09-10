import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";

const runtime = vi.hoisted(() => ({
  dashboardSummary: vi.fn(),
  hasPermission: vi.fn(),
  procurementOrders: vi.fn(),
  productBoard: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    search,
    ...props
  }: {
    children: ReactNode;
    to: string;
    search?: Record<string, string>;
  }) => {
    const params = new URLSearchParams(search);
    const href = params.size > 0 ? `${to}?${params}` : to;
    return <a href={href} {...props}>{children}</a>;
  },
}));

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({
    currentTenant: { id: "tenant-1", code: "acme", name: "示例企业" },
    currentUser: { id: "user-1", username: "operator@example.com", displayName: "操作员" },
    hasPermission: runtime.hasPermission,
  }),
}));

vi.mock("../modules/navigationDefinitions", () => ({
  getAccessibleTenantNavigation: (hasPermission: (permission: string) => boolean) => [
    { id: "dashboard", label: "工作台", to: "/", icon: () => null },
    ...(hasPermission("products.read")
      ? [{ id: "products", label: "商品", to: "/products?view=online", icon: () => null }]
      : []),
    ...(hasPermission("customer_service.read")
      ? [{ id: "customer-service", label: "客服", to: "/customer-service", icon: () => null }]
      : []),
  ],
  splitNavigationTarget: (to: string) => {
    const [pathname, query] = to.split("?", 2);
    return {
      pathname,
      search: query ? Object.fromEntries(new URLSearchParams(query)) : undefined,
    };
  },
}));

vi.mock("../modules/orderCenterApi", () => ({
  orderCenterApi: { dashboardSummary: runtime.dashboardSummary },
}));

vi.mock("../modules/procurementOrderApi", () => ({
  procurementOrderApi: { list: runtime.procurementOrders },
}));

vi.mock("../modules/productSalesBoardApi", () => ({
  productSalesBoardApi: { summarize: runtime.productBoard },
}));

import { DashboardPage } from "./DashboardPage";

function summary(overrides: Record<string, unknown> = {}) {
  return {
    totalOrders: 15,
    receivedOrders: 1,
    reviewPendingOrders: 2,
    holdOrders: 3,
    readyToFulfillOrders: 4,
    cancelledOrders: 5,
    editableOrders: 6,
    unmatchedLines: 7,
    oldestUnmatchedPlacedAt: "2026-07-30T01:02:03Z",
    ...overrides,
  };
}

function productBoard() {
  return {
    hotItems: [{
      skuId: "a7700000-0000-4000-8000-000000000201",
      skuCode: "BOARD_HOT",
      skuName: "热销商品",
      variantSummary: "黑色",
      orderCount: 2,
      salesQuantity: 5,
      lastPlacedAt: "2026-08-07T01:00:00Z",
    }],
    lowItems: [{
      skuId: "a7700000-0000-4000-8000-000000000203",
      skuCode: "BOARD_ZERO",
      skuName: "零销量商品",
      orderCount: 0,
      salesQuantity: 0,
    }],
    activeSkuCount: 2,
    soldSkuCount: 1,
    salesQuantity: 5,
    rangeFrom: "2026-08-01T00:00:00Z",
    observedAt: "2026-08-08T00:00:00Z",
  };
}

beforeEach(() => {
  runtime.hasPermission.mockImplementation(
    (permission: string) => ["orders.read", "products.read", "analytics.read"].includes(permission),
  );
  runtime.dashboardSummary.mockResolvedValue(summary());
  runtime.procurementOrders.mockResolvedValue({ items: [], page: 0, size: 1, totalElements: 7, totalPages: 7 });
  runtime.productBoard.mockResolvedValue(productBoard());
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  runtime.dashboardSummary.mockReset();
  runtime.procurementOrders.mockReset();
  runtime.productBoard.mockReset();
  runtime.hasPermission.mockReset();
});

describe("DashboardPage", () => {
  it("does not expose a paused finance shortcut for a finance-only permission", () => {
    runtime.hasPermission.mockImplementation(
      (permission: string) => permission === "finance.read",
    );

    render(<DashboardPage />);

    expect(screen.queryByRole("link", { name: /财务待审核/ })).toBeNull();
    expect(runtime.dashboardSummary).not.toHaveBeenCalled();
    expect(runtime.procurementOrders).not.toHaveBeenCalled();
    expect(runtime.productBoard).not.toHaveBeenCalled();
  });

  it("routes the customer-service shortcut through the ERP module", () => {
    runtime.hasPermission.mockImplementation(
      (permission: string) => permission === "customer_service.read",
    );

    render(<DashboardPage />);

    const shortcut = screen.getByRole("link", { name: /^客服进入功能$/ });
    expect(shortcut.getAttribute("href")).toBe("/customer-service");
    expect(shortcut.getAttribute("target")).toBeNull();
  });

  it("loads the real order summary and links statuses to existing order URLs", async () => {
    render(<DashboardPage />);

    await screen.findByRole("heading", { name: "订单摘要" });
    expect(runtime.dashboardSummary).toHaveBeenCalledWith();
    expect(screen.getByText("15")).not.toBeNull();
    expect(screen.getByText("可编辑订单")).not.toBeNull();
    const formattedDateTime = new Intl.DateTimeFormat("zh-CN", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date("2026-07-30T01:02:03Z"));
    const time = screen.getByText(formattedDateTime).closest("time");
    expect(time?.getAttribute("dateTime")).toBe("2026-07-30T01:02:03Z");
    expect(
      screen.getByRole("link", { name: "查看待审核 2 条订单" }).getAttribute("href"),
    ).toBe("/orders?status=REVIEW_PENDING");
    expect(
      screen.getByRole("link", { name: "查看未匹配明细 7 条明细" }).getAttribute("href"),
    ).toBe("/orders?view=queue&page=0");
    expect(screen.getByRole("link", { name: "查看最早未匹配下单时间" })).not.toBeNull();
    expect(
      screen.getByRole("link", { name: /^商品进入功能$/ }).getAttribute("href"),
    ).toBe("/products?view=online");
  });

  it.each(["invalid-date", undefined])(
    "shows 暂无 for an invalid or missing oldest unmatched time",
    async (oldestUnmatchedPlacedAt) => {
      runtime.dashboardSummary.mockResolvedValueOnce(summary({ oldestUnmatchedPlacedAt }));

      render(<DashboardPage />);

      await screen.findByRole("heading", { name: "订单摘要" });
      expect(screen.getByText("暂无")).not.toBeNull();
      expect(screen.queryByText("invalid-date")).toBeNull();
    },
  );

  it("keeps the order block hidden without orders.read while retaining permitted shortcuts", () => {
    runtime.hasPermission.mockImplementation(
      (permission: string) => permission === "products.read",
    );

    render(<DashboardPage />);

    expect(screen.queryByRole("heading", { name: "订单摘要" })).toBeNull();
    expect(runtime.dashboardSummary).not.toHaveBeenCalled();
    expect(runtime.procurementOrders).not.toHaveBeenCalled();
    expect(runtime.productBoard).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /^商品进入功能$/ })).not.toBeNull();
  });

  it("shows compact loading and empty states", async () => {
    let resolve!: (value: ReturnType<typeof summary>) => void;
    runtime.dashboardSummary.mockReturnValueOnce(
      new Promise<ReturnType<typeof summary>>((complete) => {
        resolve = complete;
      }),
    );

    render(<DashboardPage />);

    expect(screen.getByText("正在加载订单摘要…")).not.toBeNull();
    resolve(summary({
      totalOrders: 0,
      receivedOrders: 0,
      reviewPendingOrders: 0,
      holdOrders: 0,
      readyToFulfillOrders: 0,
      cancelledOrders: 0,
      editableOrders: 0,
      unmatchedLines: 0,
      oldestUnmatchedPlacedAt: undefined,
    }));

    expect(await screen.findByText("暂无订单数据")).not.toBeNull();
    expect(
      screen.getByRole("link", { name: "前往订单列表" }).getAttribute("href"),
    ).toBe("/orders");
  });

  it("maps a forbidden summary response safely and permits retry", async () => {
    runtime.dashboardSummary
      .mockRejectedValueOnce(new ApiError("internal details", { status: 403 }))
      .mockResolvedValueOnce(summary());

    render(<DashboardPage />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("暂时无法读取订单摘要");
    expect(alert.textContent).not.toContain("internal details");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(runtime.dashboardSummary).toHaveBeenCalledTimes(2));
  });

  it("restores the archived workbench sections without inventing unsupported metrics", async () => {
    runtime.hasPermission.mockReturnValue(true);
    render(<DashboardPage />);

    await screen.findByRole("heading", { name: "待办事项" });
    expect(screen.getByRole("link", { name: /待审核订单/ }).getAttribute("href"))
      .toBe("/orders?status=REVIEW_PENDING");
    const procurementTodo = await screen.findByRole("link", { name: /待审核采购单/ });
    expect(procurementTodo.getAttribute("href"))
      .toBe("/procurement/orders?status=NEW_ORDER");
    expect(procurementTodo.textContent).toContain("7");
    expect(runtime.procurementOrders).toHaveBeenCalledWith({
      searchField: "PURCHASE_NO",
      status: "NEW_ORDER",
      page: 0,
      size: 1,
    });
    expect(screen.getByRole("heading", { name: "商品看板" })).not.toBeNull();
    await screen.findByText("BOARD_HOT");
    expect(screen.getAllByRole("columnheader")).toHaveLength(5);
    expect(runtime.productBoard).toHaveBeenCalledWith(expect.objectContaining({ limit: 5 }));
    fireEvent.click(screen.getByRole("tab", { name: "低销量" }));
    expect(screen.getByText("BOARD_ZERO")).not.toBeNull();
    expect(screen.getByText("零销量商品")).not.toBeNull();
    expect(screen.getByRole("link", { name: /商品销量报表/ }).getAttribute("href"))
      .toBe("/analytics/sales/product-sales");
    expect(screen.getByRole("heading", { name: "店铺状态" })).not.toBeNull();
    expect(screen.getByText("Shopify")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "公告" })).not.toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "内部公告" }));
    expect(screen.getByRole("link", { name: /更多内部公告/ }).getAttribute("href"))
      .toBe("/settings/tasks/notices");
  });

  it("maps product board failures safely and permits retry", async () => {
    runtime.hasPermission.mockImplementation(
      (permission: string) => permission === "products.read" || permission === "analytics.read",
    );
    runtime.productBoard
      .mockRejectedValueOnce(new ApiError("internal details", { status: 403 }))
      .mockResolvedValueOnce(productBoard());

    render(<DashboardPage />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("无法读取商品销量看板");
    expect(alert.textContent).not.toContain("internal details");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(runtime.productBoard).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("BOARD_HOT")).not.toBeNull();
  });

  it("maps procurement summary failures safely and permits retry", async () => {
    runtime.hasPermission.mockImplementation(
      (permission: string) => permission === "procurement.read",
    );
    runtime.procurementOrders
      .mockRejectedValueOnce(new ApiError("internal details", { status: 403 }))
      .mockResolvedValueOnce({ items: [], page: 0, size: 1, totalElements: 3, totalPages: 3 });

    render(<DashboardPage />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("暂时无法读取采购单待办");
    expect(alert.textContent).not.toContain("internal details");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(runtime.procurementOrders).toHaveBeenCalledTimes(2));
    expect((await screen.findByRole("link", { name: /待审核采购单/ })).textContent)
      .toContain("3");
  });
});
