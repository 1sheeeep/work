import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "../api/client";
import { parseProductSalesBoard, productSalesBoardApi } from "./productSalesBoardApi";

vi.mock("../api/client", () => ({
  apiClient: { request: vi.fn() },
}));

const HOT_ID = "a7700000-0000-4000-8000-000000000201";
const ZERO_ID = "a7700000-0000-4000-8000-000000000203";

function wire(overrides: Record<string, unknown> = {}) {
  return {
    hotItems: [{
      skuId: HOT_ID,
      skuCode: "BOARD_HOT",
      skuName: "Hot product",
      variantSummary: "Black",
      orderCount: 2,
      salesQuantity: 5,
      lastPlacedAt: "2026-08-07T01:00:00Z",
    }],
    lowItems: [
      {
        skuId: ZERO_ID,
        skuCode: "BOARD_ZERO",
        skuName: "Zero product",
        variantSummary: null,
        orderCount: 0,
        salesQuantity: 0,
        lastPlacedAt: null,
      },
      {
        skuId: HOT_ID,
        skuCode: "BOARD_HOT",
        skuName: "Hot product",
        variantSummary: "Black",
        orderCount: 2,
        salesQuantity: 5,
        lastPlacedAt: "2026-08-07T01:00:00Z",
      },
    ],
    activeSkuCount: 2,
    soldSkuCount: 1,
    salesQuantity: 5,
    rangeFrom: "2026-08-01T00:00:00Z",
    observedAt: "2026-08-08T00:00:00Z",
    ...overrides,
  };
}

afterEach(() => {
  vi.mocked(apiClient.request).mockReset();
});

describe("productSalesBoardApi", () => {
  it("accepts sold and zero-sales active SKU rows", () => {
    const result = parseProductSalesBoard(wire(), 5);

    expect(result.hotItems[0].salesQuantity).toBe(5);
    expect(result.lowItems[0].salesQuantity).toBe(0);
    expect(result.lowItems[0].lastPlacedAt).toBeUndefined();
  });

  it.each([
    { extra: true },
    { hotItems: [{ ...wire().hotItems[0], salesQuantity: 0 }] },
    { lowItems: [wire().lowItems[0], wire().lowItems[0]] },
    { activeSkuCount: 0 },
    { rangeFrom: "2026-08-02T00:00:00Z" },
  ])("rejects malformed or inconsistent responses %#", (change) => {
    expect(() => parseProductSalesBoard(wire(change), 5)).toThrow(
      "Invalid product sales board response",
    );
  });

  it("binds the fixed observation time and limit to the request", async () => {
    vi.mocked(apiClient.request).mockResolvedValue(wire());

    await productSalesBoardApi.summarize({
      observedAt: "2026-08-08T00:00:00Z",
      limit: 5,
    });

    expect(apiClient.request).toHaveBeenCalledWith(
      "/api/v1/analytics/dashboard-product-sales?observedAt=2026-08-08T00%3A00%3A00Z&limit=5",
      { signal: undefined },
    );
  });

  it("rejects a response for a different observation time", async () => {
    vi.mocked(apiClient.request).mockResolvedValue(wire({
      rangeFrom: "2026-08-01T01:00:00Z",
      observedAt: "2026-08-08T01:00:00Z",
    }));

    await expect(productSalesBoardApi.summarize({
      observedAt: "2026-08-08T00:00:00Z",
    })).rejects.toThrow("board.requestIdentity");
  });
});
