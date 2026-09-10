import { beforeEach, describe, expect, it, vi } from "vitest";
import { inventoryRealtimeSalesApi, parseInventoryRealtimeSalesPage } from "./inventoryRealtimeSalesApi";

const request = vi.hoisted(() => vi.fn());
vi.mock("../api/client", () => ({ apiClient: { request } }));

const item = {
  balanceId: "11111111-1111-4111-8111-111111111111",
  skuId: "22222222-2222-4222-8222-222222222222",
  skuCode: "SKU-A",
  skuName: "商品 A",
  variantSummary: "黑色",
  warehouseId: "33333333-3333-4333-8333-333333333333",
  warehouseCode: "WH-A",
  warehouseName: "仓库 A",
  onHand: 20,
  reserved: 3,
  available: 17,
  rangeSalesQuantity: 9,
  rangeOrderCount: 3,
  todaySalesQuantity: 3,
  yesterdaySalesQuantity: 2,
  last7DaysSalesQuantity: 9,
  last28DaysSalesQuantity: 14,
  last42DaysSalesQuantity: 20,
  updatedAt: "2026-08-10T11:00:00Z",
};

beforeEach(() => request.mockReset());

describe("inventory realtime sales API", () => {
  it("maps explicit observation filters and strictly parses inventory sales facts", async () => {
    request.mockResolvedValue({
      items: [item], totalBalanceCount: 1,
      totalOnHand: 20, totalReserved: 3, totalAvailable: 17,
      totalRangeSalesQuantity: 9, observedAt: "2026-08-10T12:00:00Z",
      page: 0, size: 25, totalPages: 1,
    });

    await expect(inventoryRealtimeSalesApi.summarize({
      keyword: " SKU-A ",
      rangeFrom: "2026-08-01T00:00:00Z",
      asOf: "2026-08-10T12:00:00Z",
      page: 0,
      size: 25,
    })).resolves.toMatchObject({ totalAvailable: 17, totalRangeSalesQuantity: 9 });
    expect(request.mock.calls[0][0]).toContain("keyword=SKU-A");
    expect(request.mock.calls[0][0]).toContain("rangeFrom=2026-08-01T00%3A00%3A00Z");
  });

  it("rejects derived-balance drift, future fields and inconsistent paging", () => {
    const base = {
      items: [item], totalBalanceCount: 1,
      totalOnHand: 20, totalReserved: 3, totalAvailable: 17,
      totalRangeSalesQuantity: 9, observedAt: "2026-08-10T12:00:00Z",
      page: 0, size: 25, totalPages: 1,
    };
    expect(() => parseInventoryRealtimeSalesPage({
      ...base, items: [{ ...item, available: 18 }],
    })).toThrow(/item\.available/);
    expect(() => parseInventoryRealtimeSalesPage({
      ...base, items: [{ ...item, revenue: 100 }],
    })).toThrow(/item\.shape/);
    expect(() => parseInventoryRealtimeSalesPage({
      ...base, items: [{ ...item, last7DaysSalesQuantity: 21 }],
    })).toThrow(/salesConsistency/);
    expect(() => parseInventoryRealtimeSalesPage({
      ...base, totalBalanceCount: 26, totalPages: 1,
    })).toThrow(/cardinality/);
  });

  it("exports the bounded filter through the strict CSV contract", async () => {
    const content = "\uFEFF库存SKU,SKU名称,规格,仓库编码,仓库名称,现货,预留,可用,所选区间销量,所选区间订单数,今日销量,昨日销量,近7天销量,近28天销量,近42天销量,库存更新时间,统计截至\r\n";
    request.mockResolvedValue({
      filename: "inventory-realtime-sales.csv",
      mediaType: "text/csv;charset=utf-8",
      rowCount: 0,
      content,
    });

    await expect(inventoryRealtimeSalesApi.exportCsv({
      keyword: " SKU-A ",
      rangeFrom: "2026-08-01T00:00:00Z",
      asOf: "2026-08-10T12:00:00Z",
    })).resolves.toEqual({
      filename: "inventory-realtime-sales.csv",
      mediaType: "text/csv;charset=utf-8",
      rowCount: 0,
      content,
    });
    expect(request).toHaveBeenCalledWith(
      "/api/v1/analytics/inventory-sales/exports",
      {
        method: "POST",
        body: {
          keyword: "SKU-A",
          rangeFrom: "2026-08-01T00:00:00Z",
          asOf: "2026-08-10T12:00:00Z",
        },
      },
    );
  });

  it("rejects an unsafe export response", async () => {
    request.mockResolvedValue({
      filename: "../inventory-sales.csv",
      mediaType: "text/csv;charset=utf-8",
      rowCount: 0,
      content: "\uFEFF库存SKU,SKU名称\r\n",
    });

    await expect(inventoryRealtimeSalesApi.exportCsv({
      asOf: "2026-08-10T12:00:00Z",
    })).rejects.toThrow(/export\.contract/);
  });
});
