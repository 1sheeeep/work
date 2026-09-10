import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { procurementOrderApi } from "../modules/procurementOrderApi";
import {
  ProcurementFollowUpPage,
  parseProcurementFollowUpQuery,
  toProcurementFollowUpUrl,
} from "./ProcurementFollowUpPage";

const routerState = vi.hoisted(() => ({ search: "", push: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ history: { push: routerState.push } }),
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) => select({
    location: { searchStr: routerState.search },
  }),
}));
vi.mock("../modules/procurementOrderApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../modules/procurementOrderApi")>();
  return {
    ...actual,
    procurementOrderApi: {
      ...actual.procurementOrderApi,
      list: vi.fn(),
      exportFollowUpCsv: vi.fn(),
    },
  };
});

const list = vi.mocked(procurementOrderApi.list);
const exportFollowUpCsv = vi.mocked(procurementOrderApi.exportFollowUpCsv);
const order = {
  purchaseOrderId: "11111111-1111-4111-8111-111111111111",
  purchaseNo: "PO-20260802-001",
  status: "PARTIALLY_RECEIVED" as const,
  planId: "22222222-2222-4222-8222-222222222222",
  planNo: "PP-20260801-001",
  supplierId: "33333333-3333-4333-8333-333333333333",
  supplierCode: "SUP-01",
  supplierName: "测试供应商",
  supplierSkuCode: "SUP-SKU-01",
  skuId: "44444444-4444-4444-8444-444444444444",
  skuCode: "SKU-01",
  skuName: "测试商品",
  skuVariant: "蓝色 / M",
  warehouseId: "55555555-5555-4555-8555-555555555555",
  warehouseCode: "WH-01",
  warehouseName: "华东仓",
  locationId: "66666666-6666-4666-8666-666666666666",
  locationCode: "A-01",
  locationName: "A 区一号",
  quantity: 20,
  receivedQuantity: 8,
  orderNote: "补货",
  orderedByDisplayName: "采购员甲",
  reviewDecision: "APPROVED" as const,
  reviewedByDisplayName: "Reviewer",
  reviewedAt: "2026-08-01T04:00:00Z",
  version: 2,
  lastReceivedAt: "2026-08-02T08:00:00Z",
  createdAt: "2026-08-01T03:00:00Z",
  updatedAt: "2026-08-02T08:00:00Z",
};

beforeEach(() => {
  routerState.search = "";
  routerState.push.mockReset();
  list.mockReset();
  list.mockResolvedValue({
    items: [order],
    page: 0,
    size: 25,
    totalElements: 1,
    totalPages: 1,
  });
  exportFollowUpCsv.mockReset().mockResolvedValue({
    filename: "procurement-follow-up.csv",
    mediaType: "text/csv;charset=utf-8",
    rowCount: 1,
    content: "\uFEFF采购单号,计划编号,SKU编号,SKU名称,规格,仓库编码,仓库名称,库位编码,库位名称,供应商编码,供应商名称,供应商SKU,采购数量,已到货,待到货,状态,下单员,下单时间,最近到货\r\n",
  });
});
afterEach(cleanup);

describe("ProcurementFollowUpPage", () => {
  it("bounds shareable filters and rejects malformed paging", () => {
    expect(parseProcurementFollowUpQuery(
      `?searchField=INVALID&keyword=${"A".repeat(140)}&createdFrom=no&page=-1&size=999`,
    )).toEqual({
      searchField: "PURCHASE_NO",
      keyword: "A".repeat(120),
      createdFrom: "",
      createdTo: "",
      page: 0,
      size: 25,
    });
    expect(toProcurementFollowUpUrl({
      searchField: "SUPPLIER_NAME",
      keyword: " 测试供应商 ",
      createdFrom: "2026-08-01",
      size: 50,
    })).toBe(
      "/procurement/follow-up?searchField=SUPPLIER_NAME&keyword=%E6%B5%8B%E8%AF%95%E4%BE%9B%E5%BA%94%E5%95%86&createdFrom=2026-08-01&size=50",
    );
  });

  it("loads only receivable orders and renders actual receipt progress", async () => {
    render(<ProcurementFollowUpPage />);

    expect(await screen.findByText("PO-20260802-001")).toBeTruthy();
    expect(list).toHaveBeenCalledWith(expect.objectContaining({
      searchField: "PURCHASE_NO",
      receivableOnly: true,
      page: 0,
      size: 25,
    }));
    const table = screen.getByRole("table", { name: "采购跟单列表" });
    expect(within(table).getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "采购单 / 计划", "商品", "收货仓库 / 库位", "供应商", "采购数量",
      "已到货", "待到货", "状态", "下单员 / 时间", "最近到货",
    ]);
    expect(within(table).getByText("12")).toBeTruthy();
    expect(screen.queryByText("预计到货时间")).toBeNull();
    expect(screen.queryByText("质检状态")).toBeNull();
  });

  it("validates date ranges and serializes supported filters", async () => {
    render(<ProcurementFollowUpPage />);
    await screen.findByText("PO-20260802-001");

    fireEvent.change(screen.getByLabelText("搜索字段"), {
      target: { value: "SKU_CODE" },
    });
    fireEvent.change(screen.getByLabelText("关键词"), {
      target: { value: " SKU-01 " },
    });
    fireEvent.change(screen.getByLabelText("下单起始日期"), {
      target: { value: "2026-08-02" },
    });
    fireEvent.change(screen.getByLabelText("下单截止日期"), {
      target: { value: "2026-08-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    expect(screen.getByRole("alert").textContent).toContain("不能晚于");
    expect(routerState.push).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("下单截止日期"), {
      target: { value: "2026-08-03" },
    });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    expect(routerState.push).toHaveBeenCalledWith(
      "/procurement/follow-up?searchField=SKU_CODE&keyword=SKU-01&createdFrom=2026-08-02&createdTo=2026-08-03",
    );
  });

  it("shows a recoverable request error", async () => {
    list.mockRejectedValueOnce(new Error("offline"));
    render(<ProcurementFollowUpPage />);

    expect((await screen.findByRole("alert")).textContent).toContain("暂时无法读取采购在途跟单");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });

  it("downloads the current follow-up filters and announces success", async () => {
    routerState.search = "?searchField=SUPPLIER_NAME&keyword=Supplier&createdFrom=2026-08-01&createdTo=2026-08-02";
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:procurement-follow-up"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    render(<ProcurementFollowUpPage />);
    fireEvent.click(await screen.findByRole("button", {
      name: "导出筛选结果",
    }));

    await waitFor(() => expect(exportFollowUpCsv).toHaveBeenCalledWith({
      searchField: "SUPPLIER_NAME",
      keyword: "Supplier",
      createdFrom: "2026-08-01T00:00:00.000Z",
      createdTo: "2026-08-02T23:59:59.999Z",
    }));
    expect(await screen.findByText("已导出 1 条采购跟单。")).toBeTruthy();
  });

  it("announces an oversized export and permits retry", async () => {
    exportFollowUpCsv.mockRejectedValueOnce(
      new ApiError("hidden", { status: 409 }),
    );
    render(<ProcurementFollowUpPage />);

    fireEvent.click(await screen.findByRole("button", {
      name: "导出筛选结果",
    }));

    expect((await screen.findByRole("alert")).textContent)
      .toContain("超过 10,000 条");
    expect(screen.getByRole("button", { name: "导出筛选结果" }))
      .toHaveProperty("disabled", false);
  });
});
