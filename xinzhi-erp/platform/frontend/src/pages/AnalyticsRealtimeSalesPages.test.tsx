import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inventoryRealtimeSalesApi } from "../modules/inventoryRealtimeSalesApi";
import { listingRealtimeSalesApi } from "../modules/listingRealtimeSalesApi";
import { orderStatusReportApi } from "../modules/orderStatusReportApi";
import { AnalyticsInventoryRealtimeSalesPage, AnalyticsListingRealtimeSalesPage, AnalyticsOrderAnalysisPage, parseInventoryRealtimeQuery, parseListingRealtimeQuery, parseOrderAnalysisQuery, toInventoryRealtimeUrl, toListingRealtimeUrl, toOrderAnalysisUrl } from "./AnalyticsRealtimeSalesPages";

const routerState = vi.hoisted(() => ({ search: "", push: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ useRouter: () => ({ history: { push: routerState.push } }), useRouterState: ({ select }: { select: (state: unknown) => unknown }) => select({ location: { searchStr: routerState.search } }) }));
vi.mock("../modules/inventoryRealtimeSalesApi", async () => {
  const actual = await vi.importActual<typeof import("../modules/inventoryRealtimeSalesApi")>("../modules/inventoryRealtimeSalesApi");
  return { ...actual, inventoryRealtimeSalesApi: { summarize: vi.fn(), exportCsv: vi.fn() } };
});
vi.mock("../modules/listingRealtimeSalesApi", async () => {
  const actual = await vi.importActual<typeof import("../modules/listingRealtimeSalesApi")>("../modules/listingRealtimeSalesApi");
  return { ...actual, listingRealtimeSalesApi: { summarize: vi.fn(), exportCsv: vi.fn() } };
});
vi.mock("../modules/orderStatusReportApi", async () => {
  const actual = await vi.importActual<typeof import("../modules/orderStatusReportApi")>("../modules/orderStatusReportApi");
  return { ...actual, orderStatusReportApi: { summarize: vi.fn(), exportCsv: vi.fn() } };
});
const summarizeInventorySales = vi.mocked(inventoryRealtimeSalesApi.summarize);
const exportInventorySales = vi.mocked(inventoryRealtimeSalesApi.exportCsv);
const summarizeListingSales = vi.mocked(listingRealtimeSalesApi.summarize);
const exportListingSales = vi.mocked(listingRealtimeSalesApi.exportCsv);
const summarizeOrderAnalysis = vi.mocked(orderStatusReportApi.summarize);
const exportOrderAnalysis = vi.mocked(orderStatusReportApi.exportCsv);
beforeEach(() => {
  routerState.search = "";
  routerState.push.mockReset();
  summarizeInventorySales.mockReset().mockResolvedValue({
    items: [], totalBalanceCount: 0, totalOnHand: 0, totalReserved: 0,
    totalAvailable: 0, totalRangeSalesQuantity: 0,
    observedAt: "2026-08-10T12:00:00Z",
    page: 0, size: 25, totalPages: 0,
  });
  exportInventorySales.mockReset().mockResolvedValue({
    filename: "inventory-realtime-sales.csv",
    mediaType: "text/csv;charset=utf-8",
    rowCount: 1,
    content: "\uFEFF库存SKU,SKU名称,规格,仓库编码,仓库名称,现货,预留,可用,所选区间销量,所选区间订单数,今日销量,昨日销量,近7天销量,近28天销量,近42天销量,库存更新时间,统计截至\r\n",
  });
  summarizeListingSales.mockReset().mockResolvedValue({
    items: [], totalListingCount: 0, totalRangeSalesQuantity: 0,
    observedAt: "2026-08-10T12:00:00Z",
    page: 0, size: 25, totalPages: 0,
  });
  exportListingSales.mockReset().mockResolvedValue({
    filename: "listing-realtime-sales.csv",
    mediaType: "text/csv;charset=utf-8",
    rowCount: 1,
    content: "\uFEFF平台编码,平台名称,店铺,Listing,Listing变体,库存SKU,SKU名称,规格,所选区间销量,所选区间订单数,今日销量,昨日销量,近7天销量,近28天销量,近42天销量,最近下单,统计截至\r\n",
  });
  summarizeOrderAnalysis.mockReset().mockResolvedValue({
    items: [], totalOrders: 0, page: 0, size: 100,
    totalElements: 0, totalPages: 0,
  });
  exportOrderAnalysis.mockReset().mockResolvedValue({
    filename: "order-status-report.csv",
    mediaType: "text/csv;charset=utf-8",
    rowCount: 1,
    content: "\uFEFF日期（UTC）,订单总数,待付款,已接收,待审核,待合并,已搁置,待履约,履约中,已发货,已送达,已取消\r\n",
  });
});
afterEach(cleanup);

describe("analytics realtime sales shells", () => {
  it("loads uniquely attributed listing sales without price or amount fields", async () => {
    summarizeListingSales.mockResolvedValue({
      items: [{
        listingId: "11111111-1111-4111-8111-111111111111",
        platformCode: "SHOPIFY", platformName: "Shopify",
        shopId: "22222222-2222-4222-8222-222222222222",
        shopName: "Demo Shop", externalListingRef: "item-1",
        externalVariantRef: "variant-1",
        skuId: "33333333-3333-4333-8333-333333333333",
        skuCode: "SKU-1", skuName: "商品一", variantSummary: "黑色",
        rangeSalesQuantity: 5, rangeOrderCount: 2,
        todaySalesQuantity: 2, yesterdaySalesQuantity: 1,
        last7DaysSalesQuantity: 5, last28DaysSalesQuantity: 5,
        last42DaysSalesQuantity: 5, lastPlacedAt: "2026-08-10T10:00:00Z",
      }],
      totalListingCount: 1, totalRangeSalesQuantity: 5,
      observedAt: "2026-08-10T12:00:00Z",
      page: 0, size: 25, totalPages: 1,
    });
    expect(parseListingRealtimeQuery("?keyword=%20SKU-1%20&page=-1&size=101")).toEqual({ startTime: "", endTime: "", keyword: "SKU-1", page: 0, size: 25 });
    expect(toListingRealtimeUrl({ keyword: " SKU-2 ", page: 2, size: 50 })).toBe("/analytics/sales/listing-realtime?keyword=SKU-2&page=2&size=50");
    render(<AnalyticsListingRealtimeSalesPage />);
    const table = await screen.findByRole("table", { name: "Listing 实时销量结果" });
    expect(within(table).getAllByRole("columnheader")).toHaveLength(12);
    expect(screen.getByText("item-1")).toBeTruthy();
    expect(screen.queryByText("最新售价")).toBeNull();
    expect(screen.queryByText("销售额")).toBeNull();
    expect(summarizeListingSales).toHaveBeenCalledWith(expect.objectContaining({ page: 0, size: 25, asOf: expect.any(String) }));
  });
  it("loads exact inventory sales facts", async () => {
    summarizeInventorySales.mockResolvedValue({
      items: [{
        balanceId: "11111111-1111-4111-8111-111111111111",
        skuId: "22222222-2222-4222-8222-222222222222",
        skuCode: "SKU-1", skuName: "商品一", variantSummary: "黑色",
        warehouseId: "33333333-3333-4333-8333-333333333333",
        warehouseCode: "WH-A", warehouseName: "仓库 A",
        onHand: 20, reserved: 3, available: 17,
        rangeSalesQuantity: 9, rangeOrderCount: 3,
        todaySalesQuantity: 3, yesterdaySalesQuantity: 2,
        last7DaysSalesQuantity: 9, last28DaysSalesQuantity: 14,
        last42DaysSalesQuantity: 20, updatedAt: "2026-08-10T11:00:00Z",
      }],
      totalBalanceCount: 1, totalOnHand: 20, totalReserved: 3,
      totalAvailable: 17, totalRangeSalesQuantity: 9,
      observedAt: "2026-08-10T12:00:00Z",
      page: 0, size: 25, totalPages: 1,
    });
    expect(parseInventoryRealtimeQuery("?keyword=%20SKU-1%20&page=-1&size=101")).toEqual({ startTime: "", endTime: "", keyword: "SKU-1", page: 0, size: 25 });
    expect(toInventoryRealtimeUrl({ keyword: " SKU-2 ", page: 2, size: 50 })).toBe("/analytics/sales/inventory-realtime?keyword=SKU-2&page=2&size=50");
    render(<AnalyticsInventoryRealtimeSalesPage />);
    const table = await screen.findByRole("table", { name: "库存实时销量结果" });
    expect(within(table).getAllByRole("columnheader")).toHaveLength(14);
    expect(screen.getByText("商品一 · 黑色")).toBeTruthy();
    expect(summarizeInventorySales).toHaveBeenCalledWith(expect.objectContaining({ page: 0, size: 25, asOf: expect.any(String) }));
  });
  it("announces inventory realtime failures and permits retry", async () => {
    summarizeInventorySales.mockRejectedValueOnce(new Error("offline"));
    render(<AnalyticsInventoryRealtimeSalesPage />);
    expect((await screen.findByRole("alert")).textContent).toContain("暂时无法读取库存实时销量");
    summarizeInventorySales.mockResolvedValueOnce({
      items: [], totalBalanceCount: 0, totalOnHand: 0, totalReserved: 0,
      totalAvailable: 0, totalRangeSalesQuantity: 0,
      observedAt: "2026-08-10T12:00:00Z",
      page: 0, size: 25, totalPages: 0,
    });
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(summarizeInventorySales).toHaveBeenCalledTimes(2));
  });
  it("downloads the current inventory realtime filter and announces success", async () => {
    routerState.search = "?startTime=2026-08-01T00%3A00&endTime=2026-08-10T12%3A00&keyword=SKU-1";
    summarizeInventorySales.mockResolvedValue({
      items: [{
        balanceId: "11111111-1111-4111-8111-111111111111",
        skuId: "22222222-2222-4222-8222-222222222222",
        skuCode: "SKU-1", skuName: "商品一", variantSummary: "黑色",
        warehouseId: "33333333-3333-4333-8333-333333333333",
        warehouseCode: "WH-A", warehouseName: "仓库 A",
        onHand: 20, reserved: 3, available: 17,
        rangeSalesQuantity: 9, rangeOrderCount: 3,
        todaySalesQuantity: 3, yesterdaySalesQuantity: 2,
        last7DaysSalesQuantity: 9, last28DaysSalesQuantity: 14,
        last42DaysSalesQuantity: 20, updatedAt: "2026-08-10T11:00:00Z",
      }],
      totalBalanceCount: 1, totalOnHand: 20, totalReserved: 3,
      totalAvailable: 17, totalRangeSalesQuantity: 9,
      observedAt: "2026-08-10T12:00:00Z",
      page: 0, size: 25, totalPages: 1,
    });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true, value: vi.fn(() => "blob:inventory-sales"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true, value: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    render(<AnalyticsInventoryRealtimeSalesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "导出筛选结果" }));

    await waitFor(() => expect(exportInventorySales).toHaveBeenCalledWith({
      keyword: "SKU-1",
      rangeFrom: new Date("2026-08-01T00:00").toISOString(),
      asOf: "2026-08-10T12:00:00Z",
    }));
    expect(await screen.findByText("已导出 1 条库存实时销量。")).toBeTruthy();
  });
  it("announces listing realtime failures and permits retry", async () => {
    summarizeListingSales.mockRejectedValueOnce(new Error("offline"));
    render(<AnalyticsListingRealtimeSalesPage />);
    expect((await screen.findByRole("alert")).textContent).toContain("暂时无法读取 Listing 实时销量");
    summarizeListingSales.mockResolvedValueOnce({
      items: [], totalListingCount: 0, totalRangeSalesQuantity: 0,
      observedAt: "2026-08-10T12:00:00Z",
      page: 0, size: 25, totalPages: 0,
    });
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(summarizeListingSales).toHaveBeenCalledTimes(2));
  });
  it("downloads the current Listing realtime filter and announces success", async () => {
    routerState.search = "?startTime=2026-08-01T00%3A00&endTime=2026-08-10T12%3A00&keyword=SKU-1";
    summarizeListingSales.mockResolvedValue({
      items: [{
        listingId: "11111111-1111-4111-8111-111111111111",
        platformCode: "SHOPIFY", platformName: "Shopify",
        shopId: "22222222-2222-4222-8222-222222222222",
        shopName: "Demo Shop", externalListingRef: "item-1",
        externalVariantRef: "variant-1",
        skuId: "33333333-3333-4333-8333-333333333333",
        skuCode: "SKU-1", skuName: "商品一", variantSummary: "黑色",
        rangeSalesQuantity: 5, rangeOrderCount: 2,
        todaySalesQuantity: 2, yesterdaySalesQuantity: 1,
        last7DaysSalesQuantity: 5, last28DaysSalesQuantity: 5,
        last42DaysSalesQuantity: 5, lastPlacedAt: "2026-08-10T10:00:00Z",
      }],
      totalListingCount: 1, totalRangeSalesQuantity: 5,
      observedAt: "2026-08-10T12:00:00Z",
      page: 0, size: 25, totalPages: 1,
    });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true, value: vi.fn(() => "blob:listing-sales"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true, value: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    render(<AnalyticsListingRealtimeSalesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "导出筛选结果" }));

    await waitFor(() => expect(exportListingSales).toHaveBeenCalledWith({
      keyword: "SKU-1",
      rangeFrom: new Date("2026-08-01T00:00").toISOString(),
      asOf: "2026-08-10T12:00:00Z",
    }));
    expect(await screen.findByText("已导出 1 条 Listing 实时销量。")).toBeTruthy();
  });
  it("loads a bounded real order analysis and links to the exact order day", async () => {
    routerState.search = "?shop=%20Demo%20&startDate=2026-08-01&endDate=2026-08-10";
    summarizeOrderAnalysis.mockResolvedValue({
      items: [{
        reportDate: "2026-08-10", orderCount: 8,
        statuses: [
          { status: "RECEIVED", orderCount: 3 },
          { status: "FULFILLING", orderCount: 2 },
          { status: "SHIPPED", orderCount: 2 },
          { status: "CANCELLED", orderCount: 1 },
        ],
      }],
      totalOrders: 8, page: 0, size: 100, totalElements: 1, totalPages: 1,
    });

    render(<AnalyticsOrderAnalysisPage />);
    const table = await screen.findByRole("table", { name: "订单分析趋势" });
    expect(within(screen.getByLabelText("订单分析摘要")).getByText("8")).toBeTruthy();
    expect(within(table).getByText("5")).toBeTruthy();
    expect(within(table).getByText("已发货 2")).toBeTruthy();
    expect(summarizeOrderAnalysis).toHaveBeenCalledWith(expect.objectContaining({
      shop: "Demo", placedFrom: "2026-08-01T00:00:00.000Z",
      placedToExclusive: "2026-08-11T00:00:00.000Z", page: 0, size: 100,
    }));
    fireEvent.click(within(table).getByRole("button", { name: "查看当日订单" }));
    expect(routerState.push).toHaveBeenCalledWith("/orders?page=0&placedFrom=2026-08-10T00%3A00%3A00.000Z&placedTo=2026-08-11T00%3A00%3A00.000Z");
  });

  it("defaults order analysis to 30 UTC days and rejects ranges over 90 days", async () => {
    expect(parseOrderAnalysisQuery("", new Date("2026-08-11T15:30:00+08:00"))).toEqual({
      shop: "", startDate: "2026-07-13", endDate: "2026-08-11",
    });
    expect(parseOrderAnalysisQuery("?startDate=2026-01-01&endDate=2026-08-11", new Date("2026-08-11T00:00:00Z"))).toEqual({
      shop: "", startDate: "2026-07-13", endDate: "2026-08-11",
    });
    expect(toOrderAnalysisUrl({ shop: " Demo ", startDate: "2026-08-01", endDate: "2026-08-10" })).toBe("/analytics/sales/order-analysis?shop=Demo&startDate=2026-08-01&endDate=2026-08-10");

    render(<AnalyticsOrderAnalysisPage />);
    await screen.findByRole("table", { name: "订单分析趋势" });
    fireEvent.change(screen.getByLabelText("起始日期"), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText("截止日期"), { target: { value: "2026-08-11" } });
    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    expect(screen.getByRole("alert").textContent).toContain("最多分析连续 90 天");
    expect(routerState.push).not.toHaveBeenCalled();
  });

  it("exports the active order analysis filter", async () => {
    routerState.search = "?shop=Shopify&startDate=2026-08-01&endDate=2026-08-10";
    summarizeOrderAnalysis.mockResolvedValue({
      items: [{ reportDate: "2026-08-10", orderCount: 1, statuses: [{ status: "DELIVERED", orderCount: 1 }] }],
      totalOrders: 1, page: 0, size: 100, totalElements: 1, totalPages: 1,
    });
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:order-analysis") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    render(<AnalyticsOrderAnalysisPage />);
    fireEvent.click(await screen.findByRole("button", { name: "导出筛选结果" }));
    await waitFor(() => expect(exportOrderAnalysis).toHaveBeenCalledWith({
      shop: "Shopify",
      placedFrom: "2026-08-01T00:00:00.000Z",
      placedToExclusive: "2026-08-11T00:00:00.000Z",
    }));
    expect(await screen.findByText("已导出 1 天订单分析。")).toBeTruthy();
  });
});
