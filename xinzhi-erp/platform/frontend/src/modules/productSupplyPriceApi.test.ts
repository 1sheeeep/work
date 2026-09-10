import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "../api/client";
import { parseProductSupplyPrice, productSupplyPriceApi } from "./productSupplyPriceApi";

afterEach(() => vi.restoreAllMocks());

const priceId = "10000000-0000-4000-8000-000000000001";
const skuId = "20000000-0000-4000-8000-000000000002";

function priceResponse() {
  return {
    id: priceId,
    skuType: "INVENTORY",
    referenceId: skuId,
    skuCode: "SKU-BAG-01",
    skuName: "收纳包",
    salesCountry: "DE",
    currency: "EUR",
    unitPrice: 12.5,
    minimumQuantity: 2,
    validFrom: "2026-08-10",
    validTo: null,
    status: "ACTIVE",
    note: "德国目录",
    version: 0,
    createdByDisplayName: "系统管理员",
    updatedByDisplayName: "系统管理员",
    createdAt: "2026-08-10T10:00:00Z",
    updatedAt: "2026-08-10T10:00:00Z",
  };
}

describe("productSupplyPriceApi", () => {
  it("lists supply prices with typed filters", async () => {
    const request = vi.spyOn(apiClient, "request").mockResolvedValue({
      items: [priceResponse()], page: 0, size: 25,
      totalElements: 1, totalPages: 1,
    });
    const result = await productSupplyPriceApi.list({
      skuType: "INVENTORY", country: "DE", keyword: "SKU", page: 0, size: 25,
    });
    expect(request).toHaveBeenCalledWith(
      "/api/v1/product-center/supply-prices?page=0&size=25&skuType=INVENTORY&country=DE&keyword=SKU",
    );
    expect(result.items[0]).toEqual(expect.objectContaining({
      skuCode: "SKU-BAG-01", unitPrice: 12.5,
    }));
  });

  it("uses create, update, archive and batch contracts without edit-only fields", async () => {
    const request = vi.spyOn(apiClient, "request").mockResolvedValue(priceResponse());
    const input = {
      currency: "EUR", unitPrice: 12.5, minimumQuantity: 2,
      validFrom: "2026-08-10", status: "ACTIVE" as const,
      note: "德国目录",
    };
    await productSupplyPriceApi.create({
      ...input, skuType: "INVENTORY", referenceId: skuId, salesCountry: "DE",
    });
    expect(request).toHaveBeenNthCalledWith(1,
      "/api/v1/product-center/supply-prices", {
        method: "POST",
        body: {
          skuType: "INVENTORY", referenceId: skuId, salesCountry: "DE",
          currency: "EUR", unitPrice: 12.5, minimumQuantity: 2,
          validFrom: "2026-08-10", note: "德国目录",
        },
      });

    await productSupplyPriceApi.update(priceId, 3, input);
    expect(request).toHaveBeenNthCalledWith(2,
      `/api/v1/product-center/supply-prices/${priceId}`, {
        method: "PUT", body: { ...input, expectedVersion: 3 },
      });

    await productSupplyPriceApi.archive(priceId, 4);
    expect(request).toHaveBeenNthCalledWith(3,
      `/api/v1/product-center/supply-prices/${priceId}/archive`, {
        method: "POST", body: { expectedVersion: 4 },
      });

    request.mockResolvedValueOnce({ items: [priceResponse()] });
    await productSupplyPriceApi.batchStatus("INACTIVE", [{ id: priceId, expectedVersion: 5 }]);
    expect(request).toHaveBeenNthCalledWith(4,
      "/api/v1/product-center/supply-prices/batch-status", {
        method: "POST",
        body: { status: "INACTIVE", items: [{ id: priceId, expectedVersion: 5 }] },
      });
  });

  it("rejects malformed countries, dates and prices", () => {
    expect(() => parseProductSupplyPrice({ ...priceResponse(), salesCountry: "Germany" }))
      .toThrow("Invalid product supply price response");
    expect(() => parseProductSupplyPrice({ ...priceResponse(), unitPrice: 0 }))
      .toThrow("Invalid product supply price response");
    expect(() => parseProductSupplyPrice({
      ...priceResponse(), validFrom: "2026-08-10", validTo: "2026-08-09",
    })).toThrow("Invalid product supply price response");
  });
});
