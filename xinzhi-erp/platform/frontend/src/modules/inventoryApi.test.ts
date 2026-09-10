import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "../api/client";
import { inventoryApi } from "./inventoryApi";

const warehouseId = "96000000-0000-4000-8000-000000000010";
const categoryId = "95000000-0000-4000-8000-000000000010";
const skuId = "97000000-0000-4000-8000-000000000010";
const balanceWire = {
  id: "98000000-0000-4000-8000-000000000010",
  skuId,
  skuBusinessCode: "SKU_100",
  skuName: "测试商品",
  warehouseId,
  warehouseBusinessCode: "WH_NORTH",
  warehouseName: "北区仓",
  onHand: 12,
  reserved: 3,
  available: 9,
  version: 2,
  updatedAt: "2026-07-31T00:00:00Z",
};
const shopId = "94000000-0000-4000-8000-000000000010";
const publicationId = "93000000-0000-4000-8000-000000000010";
const inventoryPreviewWire = {
  shopId,
  balanceId: balanceWire.id,
  balanceVersion: balanceWire.version,
  skuId,
  skuCode: balanceWire.skuBusinessCode,
  skuName: balanceWire.skuName,
  warehouseId,
  warehouseCode: balanceWire.warehouseBusinessCode,
  warehouseName: balanceWire.warehouseName,
  externalVariantRef: "gid://shopify/ProductVariant/101",
  externalInventoryItemRef: "gid://shopify/InventoryItem/201",
  externalLocationRef: "gid://shopify/Location/301",
  erpOnHand: 12,
  erpReserved: 3,
  erpAvailable: 9,
  shopifyAvailable: 7,
  shopifyOnHand: 8,
  availableDifference: 2,
  fetchedAt: "2026-07-31T01:00:00Z",
};
const publicationWire = {
  id: publicationId,
  shopId,
  balanceId: balanceWire.id,
  expectedBalanceVersion: balanceWire.version,
  expectedShopifyAvailable: 7,
  targetAvailable: 9,
  status: "QUEUED",
  attemptCount: 0,
  safeErrorCode: null,
  replayed: false,
};
afterEach(() => vi.restoreAllMocks());

describe("inventoryApi", () => {
  it("projects the allowlisted balance page and keeps signed quantities", async () => {
    const request = vi.spyOn(apiClient, "request").mockResolvedValue({
      items: [{ ...balanceWire, onHand: -2, available: -5, tenantId: "hidden" }],
      page: 0,
      size: 50,
      totalElements: 1,
      totalPages: 1,
      internalSummary: "hidden",
    });

    await expect(
      inventoryApi.listBalances({
        warehouseId,
        categoryId,
        searchField: "MASTER_SKU",
        keyword: " SKU_100 ",
        onHandMin: -2,
        onHandMax: 10,
        updatedFrom: "2026-07-01",
        updatedTo: "2026-07-31",
        page: 0,
        size: 50,
      }),
    ).resolves.toEqual({
      items: [{ ...balanceWire, onHand: -2, available: -5 }],
      page: 0,
      size: 50,
      totalElements: 1,
      totalPages: 1,
    });
    expect(request).toHaveBeenCalledWith(
      `/api/v1/inventory-center/balances?page=0&size=50&warehouseId=${warehouseId}&categoryId=${categoryId}&searchField=MASTER_SKU&keyword=SKU_100&onHandMin=-2&onHandMax=10&updatedFrom=2026-07-01&updatedTo=2026-07-31`,
    );
  });

  it("rejects malformed requests and inconsistent quantity fields", async () => {
    await expect(
      inventoryApi.listBalances({
        warehouseId: "not-a-warehouse",
        page: 0,
        size: 50,
      }),
    ).rejects.toThrow("Invalid inventory request");
    await expect(
      inventoryApi.listBalances({
        categoryId: "not-a-category",
        page: 0,
        size: 50,
      }),
    ).rejects.toThrow("Invalid inventory request");
    await expect(
      inventoryApi.listBalances({
        updatedFrom: "2026-07-31",
        updatedTo: "2026-07-01",
        page: 0,
        size: 50,
      }),
    ).rejects.toThrow("Invalid inventory request");
    await expect(
      inventoryApi.listBalances({
        updatedFrom: "2026-02-30",
        page: 0,
        size: 50,
      }),
    ).rejects.toThrow("Invalid inventory request");
    await expect(
      inventoryApi.listBalances({
        searchField: "SUPPLIER" as never,
        page: 0,
        size: 50,
      }),
    ).rejects.toThrow("Invalid inventory request");
    await expect(
      inventoryApi.listBalances({
        onHandMin: 5,
        onHandMax: -1,
        page: 0,
        size: 50,
      }),
    ).rejects.toThrow("Invalid inventory request");

    vi.spyOn(apiClient, "request").mockResolvedValue({
      items: [{ ...balanceWire, available: 10 }],
      page: 0,
      size: 50,
      totalElements: 1,
      totalPages: 1,
    });
    await expect(
      inventoryApi.listBalances({ page: 0, size: 50 }),
    ).rejects.toThrow("Invalid inventory response");
  });

  it("loads bounded SKU summaries and rejects cross-request identities", async () => {
    const secondSkuId = "97000000-0000-4000-8000-000000000011";
    const request = vi.spyOn(apiClient, "request").mockResolvedValue({
      items: [
        {
          skuId,
          onHand: 12,
          reserved: 3,
          available: 9,
          internalWarehouseCount: 2,
        },
        {
          skuId: secondSkuId,
          onHand: -2,
          reserved: 1,
          available: -3,
        },
      ],
      internalScope: "hidden",
    });

    await expect(
      inventoryApi.listSkuSummaries([skuId, secondSkuId]),
    ).resolves.toEqual([
      { skuId, onHand: 12, reserved: 3, available: 9 },
      { skuId: secondSkuId, onHand: -2, reserved: 1, available: -3 },
    ]);
    expect(request).toHaveBeenCalledWith(
      `/api/v1/inventory-center/balance-summaries?skuId=${skuId}&skuId=${secondSkuId}`,
    );

    request.mockResolvedValueOnce({
      items: [
        {
          skuId: "97000000-0000-4000-8000-000000000012",
          onHand: 1,
          reserved: 0,
          available: 1,
        },
      ],
    });
    await expect(
      inventoryApi.listSkuSummaries([skuId]),
    ).rejects.toThrow("Invalid inventory response: skuSummaries.identity");
  });

  it("previews mapped Shopify inventory through an identity-bound contract", async () => {
    const request = vi.spyOn(apiClient, "request").mockResolvedValue({
      ...inventoryPreviewWire,
      internalConnectorDetail: "discarded",
    });

    await expect(
      inventoryApi.previewShopifyInventory(shopId, balanceWire.id),
    ).resolves.toEqual(inventoryPreviewWire);
    expect(request).toHaveBeenCalledWith(
      `/api/v1/inventory-center/shopify/preview?shopId=${shopId}&balanceId=${balanceWire.id}`,
    );

    request.mockResolvedValueOnce({
      ...inventoryPreviewWire,
      availableDifference: 3,
    });
    await expect(
      inventoryApi.previewShopifyInventory(shopId, balanceWire.id),
    ).rejects.toThrow("Invalid inventory response");
  });

  it("enqueues and polls Shopify inventory publication with safe headers", async () => {
    const request = vi.spyOn(apiClient, "request")
      .mockResolvedValueOnce(publicationWire)
      .mockResolvedValueOnce({
        ...publicationWire,
        status: "APPLIED",
        attemptCount: 1,
      });

    await expect(inventoryApi.enqueueShopifyInventoryPublication({
      shopId,
      balanceId: balanceWire.id,
      expectedBalanceVersion: balanceWire.version,
      expectedShopifyAvailable: 7,
    }, "inventory:request-1", "inventory-ui.request-1"))
      .resolves.toEqual({ ...publicationWire, safeErrorCode: undefined });
    expect(request).toHaveBeenNthCalledWith(
      1,
      "/api/v1/inventory-center/shopify/publications",
      {
        method: "POST",
        headers: {
          "Idempotency-Key": "inventory:request-1",
          "X-Request-Id": "inventory-ui.request-1",
        },
        body: {
          shopId,
          balanceId: balanceWire.id,
          expectedBalanceVersion: balanceWire.version,
          expectedShopifyAvailable: 7,
        },
      },
    );

    await expect(inventoryApi.getShopifyInventoryPublication(publicationId))
      .resolves.toMatchObject({ status: "APPLIED", attemptCount: 1 });
    expect(request).toHaveBeenNthCalledWith(
      2,
      `/api/v1/inventory-center/shopify/publications/${publicationId}`,
    );
  });

  it("loads the latest Shopify publication for an identity-bound balance", async () => {
    const request = vi.spyOn(apiClient, "request")
      .mockResolvedValue(publicationWire);

    await expect(inventoryApi.getLatestShopifyInventoryPublication(
      shopId,
      balanceWire.id,
    )).resolves.toEqual({
      ...publicationWire,
      safeErrorCode: undefined,
    });
    expect(request).toHaveBeenCalledWith(
      `/api/v1/inventory-center/shopify/publications/latest?shopId=${shopId}&balanceId=${balanceWire.id}`,
    );

    request.mockResolvedValueOnce({
      ...publicationWire,
      balanceId: "98000000-0000-4000-8000-000000000011",
    });
    await expect(inventoryApi.getLatestShopifyInventoryPublication(
      shopId,
      balanceWire.id,
    )).rejects.toThrow("Invalid inventory response");
  });

  it("rejects malformed Shopify publication requests and cross-request responses", async () => {
    await expect(inventoryApi.enqueueShopifyInventoryPublication({
      shopId,
      balanceId: balanceWire.id,
      expectedBalanceVersion: balanceWire.version,
      expectedShopifyAvailable: 7,
    }, "bad key", "request-1"))
      .rejects.toThrow("Invalid inventory request: idempotencyKey");

    vi.spyOn(apiClient, "request").mockResolvedValue({
      ...publicationWire,
      shopId: "94000000-0000-4000-8000-000000000011",
    });
    await expect(inventoryApi.enqueueShopifyInventoryPublication({
      shopId,
      balanceId: balanceWire.id,
      expectedBalanceVersion: balanceWire.version,
      expectedShopifyAvailable: 7,
    }, "inventory:request-1", "request-1"))
      .rejects.toThrow("Invalid inventory response");
  });
});
