import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseProductSalesReportPage, productSalesReportApi } from "./productSalesReportApi";

const request = vi.hoisted(() => vi.fn());
vi.mock("../api/client", () => ({ apiClient: { request } }));

const item = {
  skuId: "11111111-1111-4111-8111-111111111111",
  skuCode: "SKU-A",
  skuName: "商品 A",
  variantSummary: "黑色",
  orderCount: 2,
  salesQuantity: 5,
  firstPlacedAt: "2026-08-01T01:00:00Z",
  lastPlacedAt: "2026-08-02T01:00:00Z",
};

beforeEach(() => request.mockReset());

describe("product sales report API", () => {
  it("maps bounded filters and strictly parses persisted facts", async () => {
    request.mockResolvedValue({
      items: [item], totalSkuCount: 1, totalSalesQuantity: 5,
      page: 0, size: 25, totalPages: 1,
    });

    await expect(productSalesReportApi.summarize({
      keyword: " SKU-A ",
      placedFrom: "2026-08-01T00:00:00.000Z",
      placedToExclusive: "2026-08-03T00:00:00.000Z",
      page: 0,
      size: 25,
    })).resolves.toMatchObject({ totalSkuCount: 1, totalSalesQuantity: 5 });
    expect(request.mock.calls[0][0]).toContain("keyword=SKU-A");
    expect(request.mock.calls[0][1]).toEqual({ signal: undefined });
  });

  it("rejects future fields, duplicate identities and inconsistent paging", () => {
    expect(() => parseProductSalesReportPage({
      items: [{ ...item, revenue: 10 }], totalSkuCount: 1,
      totalSalesQuantity: 5, page: 0, size: 25, totalPages: 1,
    })).toThrow(/item\.shape/);
    expect(() => parseProductSalesReportPage({
      items: [item, item], totalSkuCount: 2,
      totalSalesQuantity: 10, page: 0, size: 25, totalPages: 1,
    })).toThrow(/cardinality/);
    expect(() => parseProductSalesReportPage({
      items: [], totalSkuCount: 26,
      totalSalesQuantity: 10, page: 0, size: 25, totalPages: 1,
    })).toThrow(/cardinality/);
    expect(() => parseProductSalesReportPage({
      items: [item], totalSkuCount: 26,
      totalSalesQuantity: 5, page: 2, size: 25, totalPages: 2,
    })).toThrow(/cardinality/);
  });

  it("exports the bounded filter through the strict CSV contract", async () => {
    const content = "\uFEFF库存SKU,SKU名称,规格,关联订单数,销售数量,首次下单,最近下单\r\n";
    request.mockResolvedValue({
      filename: "product-sales-report.csv",
      mediaType: "text/csv;charset=utf-8",
      rowCount: 0,
      content,
    });

    await expect(productSalesReportApi.exportCsv({
      keyword: " SKU-A ",
      placedFrom: "2026-08-01T00:00:00.000Z",
      placedToExclusive: "2026-08-03T00:00:00.000Z",
    })).resolves.toEqual({
      filename: "product-sales-report.csv",
      mediaType: "text/csv;charset=utf-8",
      rowCount: 0,
      content,
    });
    expect(request).toHaveBeenCalledWith(
      "/api/v1/analytics/product-sales/exports",
      {
        method: "POST",
        body: {
          keyword: "SKU-A",
          placedFrom: "2026-08-01T00:00:00.000Z",
          placedToExclusive: "2026-08-03T00:00:00.000Z",
        },
      },
    );
  });

  it("rejects an unsafe export response", async () => {
    request.mockResolvedValue({
      filename: "../product-sales.csv",
      mediaType: "text/csv;charset=utf-8",
      rowCount: 0,
      content: "\uFEFF库存SKU,SKU名称\r\n",
    });

    await expect(productSalesReportApi.exportCsv({})).rejects.toThrow(/export\.contract/);
  });
});
