import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { orderStatusReportApi } from "../modules/orderStatusReportApi";
import { productSalesReportApi } from "../modules/productSalesReportApi";
import {
  AnalyticsOrderStatusReportPage,
  AnalyticsProductSalesReportPage,
  parseAnalyticsProductSalesQuery,
  parseOrderStatusReportQuery,
  toAnalyticsProductSalesUrl,
  toOrderStatusReportUrl,
} from "./AnalyticsSalesReportPages";

const routerState = vi.hoisted(() => ({ search: "", push: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ useRouter: () => ({ history: { push: routerState.push } }), useRouterState: ({ select }: { select: (state: unknown) => unknown }) => select({ location: { searchStr: routerState.search } }) }));
vi.mock("../modules/orderStatusReportApi", async () => {
  const actual = await vi.importActual<typeof import("../modules/orderStatusReportApi")>("../modules/orderStatusReportApi");
  return { ...actual, orderStatusReportApi: { summarize: vi.fn(), exportCsv: vi.fn() } };
});
vi.mock("../modules/productSalesReportApi", async () => {
  const actual = await vi.importActual<typeof import("../modules/productSalesReportApi")>("../modules/productSalesReportApi");
  return { ...actual, productSalesReportApi: { summarize: vi.fn(), exportCsv: vi.fn() } };
});
const summarizeOrderStatuses = vi.mocked(orderStatusReportApi.summarize);
const exportOrderStatuses = vi.mocked(orderStatusReportApi.exportCsv);
const summarizeProductSales = vi.mocked(productSalesReportApi.summarize);
const exportProductSales = vi.mocked(productSalesReportApi.exportCsv);
beforeEach(() => {
  routerState.search = "";
  routerState.push.mockReset();
  summarizeOrderStatuses.mockReset();
  summarizeOrderStatuses.mockResolvedValue({
    items: [], totalOrders: 0, page: 0, size: 25,
    totalElements: 0, totalPages: 0,
  });
  exportOrderStatuses.mockReset().mockResolvedValue({
    filename: "order-status-report.csv",
    mediaType: "text/csv;charset=utf-8",
    rowCount: 1,
    content: "\uFEFF日期（UTC）,订单总数,待付款,已接收,待审核,待合并,已搁置,待履约,履约中,已发货,已送达,已取消\r\n",
  });
  summarizeProductSales.mockReset();
  summarizeProductSales.mockResolvedValue({
    items: [], totalSkuCount: 0, totalSalesQuantity: 0,
    page: 0, size: 25, totalPages: 0,
  });
  exportProductSales.mockReset().mockResolvedValue({
    filename: "product-sales-report.csv",
    mediaType: "text/csv;charset=utf-8",
    rowCount: 1,
    content: "\uFEFF库存SKU,SKU名称,规格,关联订单数,销售数量,首次下单,最近下单\r\n",
  });
});
afterEach(cleanup);

describe("analytics sales report shells", () => {
  it("loads exact order status counts and links each day to order center", async () => {
    routerState.search = "?shop=Demo&startDate=2026-08-01&endDate=2026-08-02";
    summarizeOrderStatuses.mockResolvedValue({
      items: [{
        reportDate: "2026-08-01",
        orderCount: 3,
        statuses: [
          { status: "READY_TO_FULFILL", orderCount: 2 },
          { status: "SHIPPED", orderCount: 1 },
        ],
      }],
      totalOrders: 3,
      page: 0,
      size: 25,
      totalElements: 1,
      totalPages: 1,
    });
    render(<AnalyticsOrderStatusReportPage />);
    await screen.findByRole("table", { name: "订单状态报表结果" });
    expect(summarizeOrderStatuses).toHaveBeenCalledWith(expect.objectContaining({
      shop: "Demo",
      placedFrom: "2026-08-01T00:00:00.000Z",
      placedToExclusive: "2026-08-03T00:00:00.000Z",
      page: 0,
      size: 25,
    }));
    expect(screen.getByText("待履约 2")).toBeTruthy();
    expect(screen.getByText("已发货 1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "查看当日订单" }));
    expect(routerState.push).toHaveBeenCalledWith("/orders?page=0&placedFrom=2026-08-01T00%3A00%3A00.000Z&placedTo=2026-08-02T00%3A00%3A00.000Z");
  });

  it("bounds order status report URL state and retries failed loads", async () => {
    expect(parseOrderStatusReportQuery("?shop=%20Demo%20&startDate=2026-02-30&page=-1&size=101")).toEqual({
      shop: "Demo", startDate: "", endDate: "", page: 0, size: 25,
    });
    expect(toOrderStatusReportUrl({ shop: " Demo ", startDate: "2026-08-01", size: 50 })).toBe("/analytics/sales/order-status?shop=Demo&startDate=2026-08-01&size=50");
    summarizeOrderStatuses.mockRejectedValueOnce(new Error("offline"));
    render(<AnalyticsOrderStatusReportPage />);
    expect((await screen.findByRole("alert")).textContent).toContain("暂时无法读取订单状态报表");
    summarizeOrderStatuses.mockResolvedValueOnce({
      items: [], totalOrders: 0, page: 0, size: 25,
      totalElements: 0, totalPages: 0,
    });
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(summarizeOrderStatuses).toHaveBeenCalledTimes(2));
  });

  it("downloads the current order status filter and announces success", async () => {
    routerState.search = "?shop=Demo&startDate=2026-08-01&endDate=2026-08-02";
    summarizeOrderStatuses.mockResolvedValue({
      items: [{
        reportDate: "2026-08-01", orderCount: 3,
        statuses: [{ status: "DELIVERED", orderCount: 3 }],
      }],
      totalOrders: 3, page: 0, size: 25,
      totalElements: 1, totalPages: 1,
    });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true, value: vi.fn(() => "blob:order-status"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true, value: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    render(<AnalyticsOrderStatusReportPage />);
    fireEvent.click(await screen.findByRole("button", { name: "导出筛选结果" }));

    await waitFor(() => expect(exportOrderStatuses).toHaveBeenCalledWith({
      shop: "Demo",
      placedFrom: "2026-08-01T00:00:00.000Z",
      placedToExclusive: "2026-08-03T00:00:00.000Z",
    }));
    expect(await screen.findByText("已导出 1 天订单状态。")).toBeTruthy();
  });

  it("loads exact product sales facts and preserves bounded filters", async () => {
    routerState.search = "?startDate=2026-08-01&endDate=2026-08-02&keyword=SKU-1";
    summarizeProductSales.mockResolvedValue({
      items: [{
        skuId: "11111111-1111-4111-8111-111111111111",
        skuCode: "SKU-1", skuName: "商品一", variantSummary: "黑色",
        orderCount: 2, salesQuantity: 5,
        firstPlacedAt: "2026-08-01T01:00:00Z",
        lastPlacedAt: "2026-08-02T01:00:00Z",
      }],
      totalSkuCount: 1, totalSalesQuantity: 5,
      page: 0, size: 25, totalPages: 1,
    });
    expect(parseAnalyticsProductSalesQuery("?startDate=bad&endDate=2026-08-01&keyword=%20SKU-1%20&page=-1&size=101")).toEqual({ startDate: "", endDate: "2026-08-01", keyword: "SKU-1", page: 0, size: 25 });
    expect(toAnalyticsProductSalesUrl({ startDate: "2026-07-01", keyword: " SKU-2 " })).toBe("/analytics/sales/product-sales?startDate=2026-07-01&keyword=SKU-2");
    render(<AnalyticsProductSalesReportPage />);
    await screen.findByRole("table", { name: "商品销量报表结果" });
    expect(summarizeProductSales).toHaveBeenCalledWith(expect.objectContaining({
      keyword: "SKU-1",
      placedFrom: "2026-08-01T00:00:00.000Z",
      placedToExclusive: "2026-08-03T00:00:00.000Z",
      page: 0,
      size: 25,
    }));
    expect(screen.getByText("商品一")).toBeTruthy();
    expect(screen.getAllByText("5")).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("SKU 编码 / 名称"), { target: { value: " SKU-3 " } });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    expect(routerState.push).toHaveBeenCalledWith("/analytics/sales/product-sales?startDate=2026-08-01&endDate=2026-08-02&keyword=SKU-3");
    expect(screen.queryByText("毛利")).toBeNull();
  });

  it("announces product sales failures and permits retry", async () => {
    summarizeProductSales.mockRejectedValueOnce(new Error("offline"));
    render(<AnalyticsProductSalesReportPage />);
    expect((await screen.findByRole("alert")).textContent).toContain("暂时无法读取商品销量报表");
    summarizeProductSales.mockResolvedValueOnce({
      items: [], totalSkuCount: 0, totalSalesQuantity: 0,
      page: 0, size: 25, totalPages: 0,
    });
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(summarizeProductSales).toHaveBeenCalledTimes(2));
  });
  it("downloads the current product sales filter and announces success", async () => {
    routerState.search = "?startDate=2026-08-01&endDate=2026-08-02&keyword=SKU-1";
    summarizeProductSales.mockResolvedValue({
      items: [{
        skuId: "11111111-1111-4111-8111-111111111111",
        skuCode: "SKU-1", skuName: "商品一", variantSummary: "黑色",
        orderCount: 2, salesQuantity: 5,
        firstPlacedAt: "2026-08-01T01:00:00Z",
        lastPlacedAt: "2026-08-02T01:00:00Z",
      }],
      totalSkuCount: 1, totalSalesQuantity: 5,
      page: 0, size: 25, totalPages: 1,
    });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true, value: vi.fn(() => "blob:product-sales"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true, value: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    render(<AnalyticsProductSalesReportPage />);
    fireEvent.click(await screen.findByRole("button", { name: "导出筛选结果" }));

    await waitFor(() => expect(exportProductSales).toHaveBeenCalledWith({
      keyword: "SKU-1",
      placedFrom: "2026-08-01T00:00:00.000Z",
      placedToExclusive: "2026-08-03T00:00:00.000Z",
    }));
    expect(await screen.findByText("已导出 1 条商品销量。")).toBeTruthy();
  });
});
