import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "../api/client";
import { inventoryApi } from "./inventoryApi";

const exception = {
  id: "93000000-0000-4000-8000-000000000010",
  shopId: "94000000-0000-4000-8000-000000000010",
  shopName: "旗舰店",
  externalShopRef: "flagship.myshopify.com",
  balanceId: "98000000-0000-4000-8000-000000000010",
  skuId: "97000000-0000-4000-8000-000000000010",
  skuCode: "SKU_100",
  skuName: "测试商品",
  warehouseId: "96000000-0000-4000-8000-000000000010",
  warehouseCode: "WH_NORTH",
  warehouseName: "北区仓",
  expectedShopifyAvailable: 7,
  targetAvailable: 9,
  status: "STALE",
  attemptCount: 1,
  safeErrorCode: "SHOPIFY_INVENTORY_STALE",
  createdAt: "2026-08-06T01:00:00Z",
  updatedAt: "2026-08-06T01:01:00Z",
  completedAt: "2026-08-06T01:01:00Z",
} as const;

afterEach(() => vi.restoreAllMocks());

describe("inventory exception API", () => {
  it("loads bounded filters and validates the returned identity", async () => {
    const request = vi.spyOn(apiClient, "request")
      .mockResolvedValue({ items: [exception] });

    await expect(inventoryApi.listShopifyInventoryPublicationExceptions({
      shopId: exception.shopId,
      start: "2026-08-01",
      end: "2026-08-06",
      keyword: " SKU_100 ",
      limit: 100,
    })).resolves.toEqual([exception]);
    expect(request).toHaveBeenCalledWith(
      "/api/v1/inventory-center/shopify/publications/exceptions?" +
        `shopId=${exception.shopId}&start=2026-08-01&end=2026-08-06&` +
        "keyword=SKU_100&limit=100",
    );
  });

  it("rejects invalid date ranges and unexpected successful statuses", async () => {
    await expect(inventoryApi.listShopifyInventoryPublicationExceptions({
      start: "2026-08-07",
      end: "2026-08-06",
    })).rejects.toThrow("Invalid inventory request");

    vi.spyOn(apiClient, "request").mockResolvedValue({
      items: [{ ...exception, status: "APPLIED" }],
    });
    await expect(inventoryApi.listShopifyInventoryPublicationExceptions({}))
      .rejects.toThrow("Invalid inventory response");
  });
});
