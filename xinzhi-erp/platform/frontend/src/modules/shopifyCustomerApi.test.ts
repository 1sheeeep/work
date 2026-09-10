import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "../api/client";
import { shopifyCustomerApi } from "./shopifyCustomerApi";

const shopId = "fa000000-0000-4000-8000-000000000003";

afterEach(() => vi.restoreAllMocks());

describe("shopifyCustomerApi", () => {
  it("parses the bounded customer directory contract", async () => {
    const request = vi.spyOn(apiClient, "request").mockResolvedValue({
      shopId,
      hasNextPage: false,
      fetchedAt: "2026-08-15T08:00:00Z",
      customers: [{
        externalCustomerRef: "gid://shopify/Customer/1",
        legacyResourceId: "1",
        displayName: "Mia Customer",
        email: "mia@example.com",
        phone: "+15551234567",
        createdAt: "2026-01-02T03:04:05Z",
        updatedAt: "2026-08-14T05:06:07Z",
        verifiedEmail: true,
        tags: ["VIP"],
        numberOfOrders: "3",
        totalSpent: { amount: "120.50", currencyCode: "USD" },
        defaultLocation: { city: "Austin", province: "Texas", country: "United States", countryCode: "US" },
        lastOrder: {
          externalOrderRef: "gid://shopify/Order/9",
          name: "#1009",
          createdAt: "2026-08-10T01:02:03Z",
          financialStatus: "PAID",
          fulfillmentStatus: "FULFILLED",
          total: { amount: "40.00", currencyCode: "USD" },
        },
      }],
    });

    await expect(shopifyCustomerApi.list(shopId, 25, undefined, "mia@example.com"))
      .resolves.toEqual(expect.objectContaining({
        shopId,
        customers: [expect.objectContaining({ numberOfOrders: "3", verifiedEmail: true })],
      }));
    expect(request).toHaveBeenCalledWith(expect.stringContaining("query=mia%40example.com"));
  });

  it("rejects cross-shop and incomplete pagination responses", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue({
      shopId: "fa000000-0000-4000-8000-000000000004",
      hasNextPage: false,
      fetchedAt: "2026-08-15T08:00:00Z",
      customers: [],
    });
    await expect(shopifyCustomerApi.list(shopId)).rejects.toThrow("Invalid customer shop");

    vi.spyOn(apiClient, "request").mockResolvedValue({
      shopId,
      hasNextPage: true,
      fetchedAt: "2026-08-15T08:00:00Z",
      customers: [],
    });
    await expect(shopifyCustomerApi.list(shopId)).rejects.toThrow("Invalid customer page");
  });
});
