import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnalyticsInventoryAgingReportPage, AnalyticsInventoryReportPage, AnalyticsStoreHealthPage, parseInventoryAgingQuery, parseInventoryReportQuery, parseStoreHealthQuery, toInventoryAgingUrl, toInventoryReportUrl, toStoreHealthUrl } from "./AnalyticsProductStoreReports";
import { inventoryPeriodReportApi } from "../modules/inventoryPeriodReportApi";
import { inventoryAgingReportApi } from "../modules/inventoryAgingReportApi";
import { warehouseCenterApi } from "../modules/warehouseCenterApi";
import { storeHealthApi } from "../modules/storeHealthApi";

const routerState = vi.hoisted(() => ({ search: "", push: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ useRouter: () => ({ history: { push: routerState.push } }), useRouterState: ({ select }: { select: (state: unknown) => unknown }) => select({ location: { searchStr: routerState.search } }) }));
vi.mock("../modules/inventoryPeriodReportApi", async () => { const actual = await vi.importActual<typeof import("../modules/inventoryPeriodReportApi")>("../modules/inventoryPeriodReportApi"); return { ...actual, inventoryPeriodReportApi: { summarize: vi.fn() } }; });
vi.mock("../modules/inventoryAgingReportApi", async () => { const actual = await vi.importActual<typeof import("../modules/inventoryAgingReportApi")>("../modules/inventoryAgingReportApi"); return { ...actual, inventoryAgingReportApi: { summarize: vi.fn(), exportCsv: vi.fn() } }; });
vi.mock("../modules/warehouseCenterApi", async () => { const actual = await vi.importActual<typeof import("../modules/warehouseCenterApi")>("../modules/warehouseCenterApi"); return { ...actual, warehouseCenterApi: { listWarehouses: vi.fn() } }; });
vi.mock("../modules/storeHealthApi", async () => { const actual = await vi.importActual<typeof import("../modules/storeHealthApi")>("../modules/storeHealthApi"); return { ...actual, storeHealthApi: { list: vi.fn() } }; });
beforeEach(() => { routerState.search = ""; routerState.push.mockReset(); vi.mocked(inventoryPeriodReportApi.summarize).mockReset().mockResolvedValue({ items: [], totalOpeningQuantity: 0, totalIncreasedQuantity: 0, totalDecreasedQuantity: 0, totalClosingQuantity: 0, page: 0, size: 50, totalElements: 0, totalPages: 0 }); vi.mocked(inventoryAgingReportApi.summarize).mockReset().mockResolvedValue({ items: [], totalQuantity: 0, age0To30Quantity: 0, age31To60Quantity: 0, age61To90Quantity: 0, age91To365Quantity: 0, ageOver365Quantity: 0, page: 0, size: 50, totalElements: 0, totalPages: 0 }); vi.mocked(warehouseCenterApi.listWarehouses).mockReset().mockResolvedValue({ items: [], page: 0, size: 200, totalElements: 0, totalPages: 0 }); vi.mocked(storeHealthApi.list).mockReset().mockResolvedValue({ items: [], platforms: [{ code: "SHOPIFY", displayName: "Shopify" }], page: 0, size: 25, totalElements: 0, totalPages: 0 }); }); afterEach(cleanup);

describe("analytics product and store report shells", () => {
  it("shares the real inventory period report and bounds its URL filters", () => {
    expect(parseInventoryReportQuery("?startDate=bad&keyword=%20SKU-1%20&min=bad")).toEqual({ startDate: "", endDate: "", keyword: "SKU-1" });
    expect(toInventoryReportUrl({ startDate: "2026-07-01", endDate: "", keyword: "SKU-1" })).toBe("/analytics/products/inventory-report?startDate=2026-07-01&keyword=SKU-1");
    render(<AnalyticsInventoryReportPage />); expect(within(screen.getByRole("table")).getAllByRole("columnheader")).toHaveLength(7);
    fireEvent.change(screen.getByLabelText("SKU / 商品 / 仓库"), { target: { value: " SKU-2 " } });
    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    expect(routerState.push).toHaveBeenCalledWith(expect.stringContaining("keyword=SKU-2"));
  });
  it("shares the real FIFO aging report and bounds its URL filters", async () => {
    const warehouseId = "a3000000-0000-4000-8000-000000000002";
    expect(parseInventoryAgingQuery(`?keyword=%20SKU-2%20&cutoff=bad&warehouseId=${warehouseId}`)).toEqual({ keyword: "SKU-2", cutoff: "", warehouseId });
    expect(toInventoryAgingUrl({ keyword: "SKU-2", cutoff: "2026-08-10", warehouseId: "" })).toBe("/analytics/products/inventory-aging?keyword=SKU-2&cutoff=2026-08-10");
    routerState.search = "?cutoff=2026-08-10";
    render(<AnalyticsInventoryAgingReportPage />); expect(within(screen.getByRole("table", { name: "库存库龄明细" })).getAllByRole("columnheader")).toHaveLength(12);
    await screen.findByText("暂无符合条件的在库库存");
    fireEvent.change(screen.getByLabelText("库龄搜索内容"), { target: { value: " SKU-2 " } }); fireEvent.click(screen.getByRole("button", { name: "查询" }));
    expect(routerState.push).toHaveBeenCalledWith("/analytics/products/inventory-aging?keyword=SKU-2&cutoff=2026-08-10");
  });
  it("loads real store connection health and preserves bounded filters", async () => {
    const shopId = "086ac851-65d2-4c05-ae31-2ba5da37cc23";
    vi.mocked(storeHealthApi.list).mockResolvedValue({ items: [{ shopId, platformCode: "SHOPIFY", platformName: "Shopify", shopName: "独立站一店", externalShopRef: "xinzhi-app-lab.myshopify.com", shopStatus: "ACTIVE", authorizationStatus: "AUTHORIZED", scopes: ["read_orders", "read_products"], lastVerifiedAt: "2026-08-10T16:00:00Z", updatedAt: "2026-08-10T16:00:00Z", latestSync: { jobType: "ORDERS", status: "SUCCEEDED", progressProcessed: 2, progressTotal: 2, attemptCount: 1, requestedAt: "2026-08-10T15:00:00Z", completedAt: "2026-08-10T15:01:00Z" } }], platforms: [{ code: "SHOPIFY", displayName: "Shopify" }], page: 0, size: 25, totalElements: 1, totalPages: 1 });
    expect(parseStoreHealthQuery("?query=%20lab%20&platform=SHOPIFY&authorizationStatus=AUTHORIZED&page=2&size=50")).toEqual({ query: "lab", platform: "SHOPIFY", authorizationStatus: "AUTHORIZED", page: 2, size: 50 });
    expect(toStoreHealthUrl({ query: "lab", platform: "SHOPIFY", authorizationStatus: "AUTHORIZED", page: 0, size: 25 })).toBe("/analytics/stores/health?query=lab&platform=SHOPIFY&authorizationStatus=AUTHORIZED");
    render(<AnalyticsStoreHealthPage />);
    expect(await screen.findByText(/Shopify · 独立站一店/)).toBeTruthy();
    expect(within(screen.getByRole("table", { name: "店铺健康列表" })).getAllByRole("columnheader")).toHaveLength(8);
    expect(screen.getByText("接入正常")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("店铺名称 / 域名"), { target: { value: " lab " } });
    fireEvent.change(screen.getByLabelText("平台"), { target: { value: "SHOPIFY" } });
    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    expect(routerState.push).toHaveBeenCalledWith("/analytics/stores/health?query=lab&platform=SHOPIFY");
    fireEvent.click(screen.getByRole("button", { name: "查看店铺" }));
    expect(routerState.push).toHaveBeenCalledWith(`/shops/${shopId}`);
  });
  it("keeps an async platform filter selected after the catalog loads", async () => {
    routerState.search = "?platform=SHOPIFY&authorizationStatus=AUTHORIZED";
    let resolveHealth!: (value: Awaited<ReturnType<typeof storeHealthApi.list>>) => void;
    vi.mocked(storeHealthApi.list).mockReturnValue(new Promise((resolve) => { resolveHealth = resolve; }));
    render(<AnalyticsStoreHealthPage />);
    expect((screen.getByLabelText("平台") as HTMLSelectElement).value).toBe("SHOPIFY");
    resolveHealth({ items: [], platforms: [{ code: "SHOPIFY", displayName: "Shopify" }], page: 0, size: 25, totalElements: 0, totalPages: 0 });
    await screen.findByText("没有符合条件的店铺");
    expect((screen.getByLabelText("平台") as HTMLSelectElement).value).toBe("SHOPIFY");
    expect(within(screen.getByLabelText("平台")).getByRole("option", { name: "Shopify" })).toBeTruthy();
  });
});
