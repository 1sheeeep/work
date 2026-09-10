import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inventoryApi } from "../modules/inventoryApi";
import { shopCenterApi } from "../modules/shopCenterApi";
import { InventorySyncExceptionsSection } from "./ProductArchiveShells";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("inventory synchronization exception operations", () => {
  it("loads failures and exposes the balance recovery path", async () => {
    const shopId = "94000000-0000-4000-8000-000000000010";
    const warehouseId = "96000000-0000-4000-8000-000000000010";
    vi.spyOn(shopCenterApi, "listShops").mockResolvedValue({
      items: [],
      page: 0,
      size: 200,
      totalElements: 0,
      totalPages: 0,
    });
    vi.spyOn(inventoryApi, "listShopifyInventoryPublicationExceptions")
      .mockResolvedValue([{
        id: "93000000-0000-4000-8000-000000000010",
        shopId,
        shopName: "旗舰店",
        externalShopRef: "flagship.myshopify.com",
        balanceId: "98000000-0000-4000-8000-000000000010",
        skuId: "97000000-0000-4000-8000-000000000010",
        skuCode: "SKU_100",
        skuName: "测试商品",
        warehouseId,
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
      }]);

    render(
      <InventorySyncExceptionsSection
        platform="SHOPIFY"
        shop=""
        keyword=""
        onFilter={vi.fn()}
      />,
    );

    expect(await screen.findByRole("table", {
      name: "Shopify 库存同步异常列表",
    })).toBeTruthy();
    expect(screen.getByText("SKU_100")).toBeTruthy();
    expect(screen.getByRole("link", { name: "重新预检" }).getAttribute("href"))
      .toContain(`warehouseId=${warehouseId}`);
    await waitFor(() => {
      expect(inventoryApi.listShopifyInventoryPublicationExceptions)
        .toHaveBeenCalledWith({
          shopId: undefined,
          start: undefined,
          end: undefined,
          keyword: "",
          limit: 100,
        });
    });
  });
});
