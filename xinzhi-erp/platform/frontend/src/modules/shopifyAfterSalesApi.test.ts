import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "../api/client";
import { afterSalesCommandKey, shopifyAfterSalesApi } from "./shopifyAfterSalesApi";

const shopId = "fa000000-0000-4000-8000-000000000003";
const returnRef = "gid://shopify/Return/10";
const lineRef = "gid://shopify/ReturnLineItem/20";
const moneyBag = {
  shopMoney: { amount: "12.00", currencyCode: "USD" },
  presentmentMoney: { amount: "12.00", currencyCode: "USD" },
};

afterEach(() => vi.restoreAllMocks());

describe("shopifyAfterSalesApi", () => {
  it("creates deterministic idempotency keys for irreversible commands", () => {
    const payload = { lineItems: [{ externalReturnLineRef: lineRef, quantity: 1 }] };
    const first = afterSalesCommandKey("return-refund", returnRef, payload);
    expect(first).toBe(afterSalesCommandKey("return-refund", returnRef, payload));
    expect(first).not.toBe(afterSalesCommandKey("return-refund", returnRef, {
      lineItems: [{ externalReturnLineRef: lineRef, quantity: 2 }],
    }));
    expect(first).toMatch(/^web\.return-refund\.10\.[0-9a-f]{16}$/);
  });

  it("parses a bounded return page and rejects a cross-shop response", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue({
      shopId,
      hasNextPage: false,
      fetchedAt: "2026-08-15T08:00:00Z",
      returns: [{
        externalReturnRef: returnRef,
        name: "Return #10",
        externalOrderRef: "gid://shopify/Order/1",
        orderName: "#1001",
        status: "REQUESTED",
        createdAt: "2026-08-15T07:00:00Z",
        totalQuantity: 1,
        lineItems: [{
          externalReturnLineRef: lineRef,
          externalFulfillmentLineRef: "gid://shopify/FulfillmentLineItem/3",
          externalOrderLineRef: "gid://shopify/LineItem/4",
          name: "Test item",
          quantity: 1,
          processableQuantity: 1,
          processedQuantity: 0,
          refundableQuantity: 1,
          refundedQuantity: 0,
        }],
      }],
    });

    await expect(shopifyAfterSalesApi.listReturns(shopId)).resolves.toEqual(
      expect.objectContaining({ shopId, returns: [expect.objectContaining({ status: "REQUESTED" })] }),
    );

    vi.spyOn(apiClient, "request").mockResolvedValue({
      shopId: "fa000000-0000-4000-8000-000000000004",
      hasNextPage: false,
      fetchedAt: "2026-08-15T08:00:00Z",
      returns: [],
    });
    await expect(shopifyAfterSalesApi.listReturns(shopId)).rejects.toThrow("Invalid return shop");
  });

  it("accepts only explicit refund outcomes", async () => {
    const request = vi.spyOn(apiClient, "request").mockResolvedValue({
      externalReturnRef: returnRef,
      returnStatus: "CLOSED",
      outcome: "REVIEW_REQUIRED",
      refundAmount: moneyBag,
      recoveredFromShopify: false,
      updatedAt: "2026-08-15T08:00:00Z",
    });

    await expect(shopifyAfterSalesApi.processRefund({
      shopId,
      externalReturnRef: returnRef,
      lineItems: [{ externalReturnLineRef: lineRef, quantity: 1 }],
      refundShipping: false,
      refundDuties: [],
      previewToken: "opaque-preview",
      notifyCustomer: true,
      idempotencyKey: "web.return-refund.10.1234567890abcdef",
    })).resolves.toEqual(expect.objectContaining({ outcome: "REVIEW_REQUIRED" }));
    expect(request).toHaveBeenCalledWith(
      "/api/v1/order-center/shopify/returns/refund-process",
      expect.objectContaining({ method: "POST" }),
    );

    vi.spyOn(apiClient, "request").mockResolvedValue({
      externalReturnRef: returnRef,
      returnStatus: "CLOSED",
      outcome: "SUCCESS",
      refundAmount: moneyBag,
      recoveredFromShopify: false,
      updatedAt: "2026-08-15T08:00:00Z",
    });
    await expect(shopifyAfterSalesApi.processRefund({
      shopId,
      externalReturnRef: returnRef,
      lineItems: [{ externalReturnLineRef: lineRef, quantity: 1 }],
      refundShipping: false,
      refundDuties: [],
      previewToken: "opaque-preview",
      notifyCustomer: false,
      idempotencyKey: "web.return-refund.10.1234567890abcdef",
    })).rejects.toThrow("Invalid refund result");
  });

  it("binds return decisions and refund previews to the requested return", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValueOnce({
      externalReturnRef: returnRef,
      status: "OPEN",
      recoveredFromShopify: false,
      updatedAt: "2026-08-15T08:00:00Z",
    });
    await expect(shopifyAfterSalesApi.decideReturn({
      shopId,
      externalReturnRef: returnRef,
      decision: "APPROVE",
      notifyCustomer: true,
      idempotencyKey: "web.return-decision.10.1234567890abcdef",
    })).resolves.toEqual(expect.objectContaining({ status: "OPEN" }));

    vi.spyOn(apiClient, "request").mockResolvedValueOnce({
      externalReturnRef: returnRef,
      state: "REFUNDABLE",
      lineItems: [{ externalReturnLineRef: lineRef, quantity: 1 }],
      refundShipping: false,
      refundDuties: [],
      refundAmount: moneyBag,
      maximumRefundable: moneyBag,
      previewToken: "opaque-preview",
      expiresAt: "2026-08-15T08:10:00Z",
      fetchedAt: "2026-08-15T08:00:00Z",
    });
    await expect(shopifyAfterSalesApi.previewRefund({
      shopId,
      externalReturnRef: returnRef,
      lineItems: [{ externalReturnLineRef: lineRef, quantity: 1 }],
      refundShipping: false,
      refundDuties: [],
    })).resolves.toEqual(expect.objectContaining({ previewToken: "opaque-preview" }));

    vi.spyOn(apiClient, "request").mockResolvedValueOnce({
      externalReturnRef: "gid://shopify/Return/11",
      status: "OPEN",
      recoveredFromShopify: false,
      updatedAt: "2026-08-15T08:00:00Z",
    });
    await expect(shopifyAfterSalesApi.decideReturn({
      shopId,
      externalReturnRef: returnRef,
      decision: "APPROVE",
      notifyCustomer: true,
      idempotencyKey: "web.return-decision.10.1234567890abcdef",
    })).rejects.toThrow("Invalid return decision");
  });

});
