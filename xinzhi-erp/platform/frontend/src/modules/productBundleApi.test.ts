import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "../api/client";
import { parseProductBundle, productBundleApi } from "./productBundleApi";

afterEach(() => vi.restoreAllMocks());

const bundleId = "10000000-0000-4000-8000-000000000001";
const skuId = "20000000-0000-4000-8000-000000000002";

function bundleResponse() {
  return {
    id: bundleId,
    businessCode: "KIT-TRAVEL-01",
    name: "出行套装",
    description: "常用出行商品组合",
    status: "ACTIVE",
    components: [{
      skuId,
      skuCode: "SKU-BAG-01",
      skuName: "收纳包",
      quantity: 2,
    }],
    componentCount: 1,
    totalUnits: 2,
    version: 0,
    createdByDisplayName: "系统管理员",
    updatedByDisplayName: "系统管理员",
    createdAt: "2026-08-10T10:00:00Z",
    updatedAt: "2026-08-10T10:00:00Z",
  };
}

describe("productBundleApi", () => {
  it("lists bundles with bounded business filters", async () => {
    const request = vi.spyOn(apiClient, "request").mockResolvedValue({
      items: [bundleResponse()],
      page: 0,
      size: 25,
      totalElements: 1,
      totalPages: 1,
    });
    const result = await productBundleApi.list({
      status: "ACTIVE",
      keyword: "KIT",
      from: "2026-08-01",
      to: "2026-08-10",
      page: 0,
      size: 25,
    });
    expect(request).toHaveBeenCalledWith(
      "/api/v1/product-center/bundles?page=0&size=25&status=ACTIVE&keyword=KIT&from=2026-08-01&to=2026-08-10",
    );
    expect(result.items[0]).toEqual(expect.objectContaining({
      businessCode: "KIT-TRAVEL-01",
      totalUnits: 2,
    }));
  });

  it("creates, updates and archives through the supported contracts", async () => {
    const request = vi.spyOn(apiClient, "request").mockResolvedValue(bundleResponse());
    const input = {
      name: "出行套装",
      description: "常用出行商品组合",
      status: "ACTIVE" as const,
      components: [{ skuId, quantity: 2 }],
    };
    await productBundleApi.create({ ...input, businessCode: "KIT-TRAVEL-01" });
    expect(request).toHaveBeenNthCalledWith(1, "/api/v1/product-center/bundles", {
      method: "POST",
      body: {
        businessCode: "KIT-TRAVEL-01",
        name: input.name,
        description: input.description,
        components: input.components,
      },
    });

    await productBundleApi.update(bundleId, 3, input);
    expect(request).toHaveBeenNthCalledWith(
      2,
      `/api/v1/product-center/bundles/${bundleId}`,
      {
        method: "PUT",
        body: { ...input, businessCode: undefined, expectedVersion: 3 },
      },
    );

    await productBundleApi.archive(bundleId, 4);
    expect(request).toHaveBeenNthCalledWith(
      3,
      `/api/v1/product-center/bundles/${bundleId}/archive`,
      { method: "POST", body: { expectedVersion: 4 } },
    );
  });

  it("rejects inconsistent component summaries", () => {
    expect(() => parseProductBundle({
      ...bundleResponse(),
      totalUnits: 3,
    })).toThrow("Invalid product bundle response");
    expect(() => parseProductBundle({
      ...bundleResponse(),
      components: [bundleResponse().components[0], bundleResponse().components[0]],
      componentCount: 2,
      totalUnits: 4,
    })).toThrow("Invalid product bundle response");
  });
});
