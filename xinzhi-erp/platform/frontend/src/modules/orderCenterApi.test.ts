import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "../api/client";
import { orderCenterApi } from "./orderCenterApi";

const orderId = "11111111-1111-4111-8111-111111111111";
const shopId = "22222222-2222-4222-8222-222222222222";
const lineId = "33333333-3333-4333-8333-333333333333";
const skuId = "44444444-4444-4444-8444-444444444444";

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: orderId,
    shopId,
    shopName: "示例店铺",
    externalOrderRef: "ORDER-001",
    currency: "USD",
    status: "RECEIVED",
    lineCount: 1,
    placedAt: "2026-01-01T00:00:00Z",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    version: 2,
    reshipment: false,
    platformHandoverRequired: false,
    printed: false,
    ...overrides,
  };
}

function detail(overrides: Record<string, unknown> = {}) {
  return {
    ...order(),
    profile: { version: 0 },
    activities: [],
    lines: [
      {
        id: lineId,
        skuId,
        skuCode: "SKU-HOSTED-1",
        lineKind: "PRODUCT",
        discountTotalMinor: 0,
        discountDescription: null,
        externalListingRef: "LISTING-001",
        externalVariantRef: null,
        skuMatchSource: "LISTING_MAPPING",
        externalLineRef: "LINE-001",
        titleSnapshot: "Widget",
        quantity: 1,
        unitPriceMinor: 1099,
        currency: "USD",
        createdAt: "2026-01-01T00:00:00Z",
      },
    ],
    ...overrides,
  };
}

function page(items = [order()]) {
  return {
    items,
    page: 0,
    size: 25,
    totalElements: items.length,
    totalPages: 1,
  };
}

function dashboard(overrides: Record<string, unknown> = {}) {
  return {
    totalOrders: 15,
    unpaidOrders: 0,
    receivedOrders: 1,
    reviewPendingOrders: 2,
    mergePendingOrders: 0,
    holdOrders: 3,
    readyToFulfillOrders: 4,
    fulfillingOrders: 0,
    shippedOrders: 0,
    deliveredOrders: 0,
    cancelledOrders: 5,
    editableOrders: 6,
    unmatchedLines: 7,
    oldestUnmatchedPlacedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function fulfillmentPlan(overrides: Record<string, unknown> = {}) {
  return {
    id: "77777777-7777-4777-8777-777777777777",
    orderId,
    shopId,
    sourceOrderVersion: 2,
    externalOrderRef: "gid://shopify/Order/100",
    status: "SHIPPED",
    pauseState: "ACTIVE",
    shortageState: "NONE",
    plannedQuantity: 1,
    pickedQuantity: 1,
    packedQuantity: 1,
    shippedQuantity: 1,
    cancelledQuantity: 0,
    version: 4,
    createdAt: "2026-07-31T01:00:00Z",
    updatedAt: "2026-07-31T02:00:00Z",
    completedAt: "2026-07-31T02:00:00Z",
    lines: [{
      id: "88888888-8888-4888-8888-888888888888",
      orderLineId: lineId,
      splitSequence: 0,
      skuId,
      warehouseId: "55555555-5555-4555-8555-555555555555",
      plannedQuantity: 1,
      pickedQuantity: 1,
      packedQuantity: 1,
      shippedQuantity: 1,
      cancelledQuantity: 0,
      externalLineRef: "gid://shopify/LineItem/40",
      skuBusinessCode: "SKU-1",
      skuName: "Widget",
      inventoryOperationRef: "inventory-ref",
    }],
    packages: [{
      id: "99999999-9999-4999-8999-999999999999",
      warehouseId: "55555555-5555-4555-8555-555555555555",
      packageNumber: "PKG-1",
      status: "HANDED_OVER",
      weightGrams: 500,
      packagingTemplateId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      packagingCode: "BOX-S",
      packagingName: "Small box",
      packagingWeightGrams: 50,
      expectedWeightGrams: 500,
      allowedToleranceGrams: 30,
      weightDifferenceGrams: 0,
      weighingStatus: "PASSED",
      weighingSource: "SCALE",
      shippingScaleId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      weighedAt: "2026-07-31T01:55:00Z",
      version: 4,
      sealedAt: "2026-07-31T01:30:00Z",
      handedOverAt: "2026-07-31T02:00:00Z",
      carrierCode: "UPS",
      serviceCode: "GROUND",
      trackingReference: "1Z123",
      shopifyPublicationStatus: "PUBLISHED",
      shopifyNotifyCustomer: true,
      shopifyTrackingUrl: "https://track.example/1Z123",
      externalShopifyFulfillmentRef: "gid://shopify/Fulfillment/50",
      shopifyPublishedAt: "2026-07-31T02:05:00Z",
      items: [{
        fulfillmentLineId: "88888888-8888-4888-8888-888888888888",
        quantity: 1,
      }],
    }],
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("orderCenterApi", () => {
  it("projects a bounded transfer history and drops internal fields", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue({
      items: [{
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        jobType: "EXPORT",
        status: "SUCCEEDED",
        requestedCount: 2,
        succeededCount: 2,
        failedCount: 0,
        safeErrorSummary: null,
        objectReference: "inline:orders.csv",
        version: 0,
        createdAt: "2026-07-30T00:00:00Z",
        completedAt: "2026-07-30T00:00:01Z",
        requestFingerprint: "secret",
        filterSpec: { buyer: "secret" },
      }],
      page: 0,
      size: 20,
      totalElements: 1,
      totalPages: 1,
    });

    const result = await orderCenterApi.listTransfers();

    expect(apiClient.request).toHaveBeenCalledWith(
      "/api/v1/order-center/transfers?page=0&size=20",
    );
    expect(result.items[0]).toMatchObject({
      jobType: "EXPORT",
      status: "SUCCEEDED",
      succeededCount: 2,
    });
    expect(result.items[0]).not.toHaveProperty("requestFingerprint");
    expect(result.items[0]).not.toHaveProperty("filterSpec");
    expect(result.items[0]).not.toHaveProperty("objectReference");
  });

  it("rejects inconsistent transfer history counts", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue({
      items: [{
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        jobType: "IMPORT",
        status: "FAILED",
        requestedCount: 1,
        succeededCount: 1,
        failedCount: 1,
        safeErrorSummary: "invalid row",
        objectReference: null,
        version: 0,
        createdAt: "2026-07-30T00:00:00Z",
        completedAt: "2026-07-30T00:00:01Z",
      }],
      page: 0,
      size: 20,
      totalElements: 1,
      totalPages: 1,
    });

    await expect(orderCenterApi.listTransfers())
      .rejects.toThrow("Invalid order response");
  });

  it("projects the dashboard summary and serializes only its optional shop", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue({
      ...dashboard(),
      buyerReference: "not allowed",
      rawPayload: { secret: true },
    });

    const result = await orderCenterApi.dashboardSummary(shopId);

    expect(apiClient.request).toHaveBeenCalledWith(
      `/api/v1/order-center/dashboard-summary?shopId=${shopId}`,
    );
    expect(result).toMatchObject({ totalOrders: 15, unmatchedLines: 7 });
    expect(result).not.toHaveProperty("buyerReference");
    expect(result).not.toHaveProperty("rawPayload");
  });

  it.each([
    { totalOrders: 14 },
    { editableOrders: 5 },
    { unmatchedLines: 0, oldestUnmatchedPlacedAt: "2026-01-01T00:00:00Z" },
    { unmatchedLines: 1, oldestUnmatchedPlacedAt: null },
    { oldestUnmatchedPlacedAt: "not-a-timestamp" },
  ])("rejects an invalid dashboard contract", async (override) => {
    vi.spyOn(apiClient, "request").mockResolvedValue(dashboard(override));

    await expect(orderCenterApi.dashboardSummary()).rejects.toThrow(
      "Invalid order response",
    );
  });

  it("maps an empty unmatched dashboard without inventing an oldest timestamp", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue(
      dashboard({ unmatchedLines: 0, oldestUnmatchedPlacedAt: null }),
    );

    const result = await orderCenterApi.dashboardSummary();

    expect(apiClient.request).toHaveBeenCalledWith(
      "/api/v1/order-center/dashboard-summary",
    );
    expect(result.oldestUnmatchedPlacedAt).toBeUndefined();
  });

  it("maps bounded SKU sales summaries and serializes repeated identities", async () => {
    const secondSkuId = "55555555-5555-4555-8555-555555555555";
    vi.spyOn(apiClient, "request").mockResolvedValue({
      items: [
        {
          skuId,
          sales7: 2,
          sales28: 5,
          sales42: 8,
          internalRevenue: 999,
        },
        {
          skuId: secondSkuId,
          sales7: 0,
          sales28: 1,
          sales42: 1,
        },
      ],
    });

    const result = await orderCenterApi.listSkuSalesSummaries([
      skuId,
      secondSkuId,
    ]);

    expect(apiClient.request).toHaveBeenCalledWith(
      `/api/v1/order-center/sku-sales-summaries?skuId=${skuId}&skuId=${secondSkuId}`,
    );
    expect(result).toEqual([
      { skuId, sales7: 2, sales28: 5, sales42: 8 },
      { skuId: secondSkuId, sales7: 0, sales28: 1, sales42: 1 },
    ]);
    expect(result[0]).not.toHaveProperty("internalRevenue");
  });

  it.each([
    { items: [{ skuId, sales7: 6, sales28: 5, sales42: 8 }] },
    { items: [{ skuId, sales7: 2, sales28: 9, sales42: 8 }] },
    { items: [{ skuId, sales7: -1, sales28: 5, sales42: 8 }] },
    { items: [{ skuId: orderId, sales7: 2, sales28: 5, sales42: 8 }] },
    {
      items: [
        { skuId, sales7: 2, sales28: 5, sales42: 8 },
        { skuId, sales7: 2, sales28: 5, sales42: 8 },
      ],
    },
  ])("rejects an unsafe SKU sales summary contract", async (response) => {
    vi.spyOn(apiClient, "request").mockResolvedValue(response);

    await expect(orderCenterApi.listSkuSalesSummaries([skuId]))
      .rejects.toThrow("Invalid order response");
  });

  it("rejects duplicate, malformed, empty, and unbounded SKU sales requests", async () => {
    const request = vi.spyOn(apiClient, "request");

    await expect(orderCenterApi.listSkuSalesSummaries([]))
      .rejects.toThrow("Invalid order request");
    await expect(orderCenterApi.listSkuSalesSummaries([skuId, skuId]))
      .rejects.toThrow("Invalid order request");
    await expect(orderCenterApi.listSkuSalesSummaries(["not-a-uuid"]))
      .rejects.toThrow("Invalid order request");
    await expect(orderCenterApi.listSkuSalesSummaries(
      Array.from({ length: 51 }, (_, index) =>
        `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`),
    )).rejects.toThrow("Invalid order request");
    expect(request).not.toHaveBeenCalled();
  });

  it("serializes only approved list query fields", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue({
      items: [order({
        salesRecordNumber: "TXN-001",
        shoppingCartReference: "CART-001",
        customOrderReference: "INTERNAL-001",
        trackingReference: "TRACK-001",
        secondaryTrackingReference: "TRACK-002",
        actualPaidMinor: 900,
        profitMinor: -50,
        actualShippingMinor: 150,
        itemAmountMinor: 800,
        platformFeeMinor: 40,
        insuranceFeeMinor: 10,
        paymentFeeMinor: 20,
        otherIncomeMinor: 30,
        otherExpenseMinor: 25,
        taxMinor: -5,
        estimatedShippingMinor: 140,
        salespersonDisplayName: "销售一号",
        managerDisplayName: "负责人一号",
        orderRemark: "已复核",
        customerCategory: "重点客户",
        productKindCount: 2,
        supplierReference: "SUP-001",
        parentProductCategory: "家居",
        childProductCategory: "照明",
        productStatus: "在售",
        extendedAttribute: "易碎",
        warehouseDisplayName: "华南仓",
        locationBusinessCode: "PICK-A01",
        pickerDisplayName: "配货一号",
        shipperDisplayName: "发货一号",
        purchaserDisplayName: "采购一号",
        developerDisplayName: "开发一号",
        printedAt: "2026-01-02T00:00:00Z",
        platformReturnedAt: "2026-01-03T00:00:00Z",
        exceptionReviewedAt: "2026-01-04T00:00:00Z",
        platformSpecifiedHandoverAt: "2026-01-05T00:00:00Z",
        platformLabelRequestedAt: "2026-01-06T00:00:00Z",
        deliveryDeadlineAt: "2026-01-07T00:00:00Z",
        cancelledAt: "2026-01-08T00:00:00Z",
        handedOverAt: "2026-01-09T00:00:00Z",
        deliveredAt: "2026-01-10T00:00:00Z",
      })],
      page: 1,
      size: 25,
      totalElements: 26,
      totalPages: 2,
      ignored: "not projected",
    });

    const result = await orderCenterApi.list({
      shopId,
      status: "RECEIVED",
      keyword: "widget",
      page: 1,
      size: 25,
    });

    expect(apiClient.request).toHaveBeenCalledWith(
      `/api/v1/order-center/orders?page=1&size=25&shopId=${shopId}&status=RECEIVED&keyword=widget`,
    );
    expect(result.items[0]).not.toHaveProperty("ignored");
    expect(result.items[0]).toMatchObject({
      salesRecordNumber: "TXN-001",
      shoppingCartReference: "CART-001",
      customOrderReference: "INTERNAL-001",
      trackingReference: "TRACK-001",
      secondaryTrackingReference: "TRACK-002",
      actualPaidMinor: 900,
      profitMinor: -50,
      actualShippingMinor: 150,
      itemAmountMinor: 800,
      platformFeeMinor: 40,
      insuranceFeeMinor: 10,
      paymentFeeMinor: 20,
      otherIncomeMinor: 30,
      otherExpenseMinor: 25,
      taxMinor: -5,
      estimatedShippingMinor: 140,
      salespersonDisplayName: "销售一号",
      managerDisplayName: "负责人一号",
      orderRemark: "已复核",
      customerCategory: "重点客户",
      productKindCount: 2,
      supplierReference: "SUP-001",
      parentProductCategory: "家居",
      childProductCategory: "照明",
      productStatus: "在售",
      extendedAttribute: "易碎",
      warehouseDisplayName: "华南仓",
      locationBusinessCode: "PICK-A01",
      pickerDisplayName: "配货一号",
      shipperDisplayName: "发货一号",
      purchaserDisplayName: "采购一号",
      developerDisplayName: "开发一号",
      printedAt: "2026-01-02T00:00:00Z",
      platformReturnedAt: "2026-01-03T00:00:00Z",
      exceptionReviewedAt: "2026-01-04T00:00:00Z",
      platformSpecifiedHandoverAt: "2026-01-05T00:00:00Z",
      platformLabelRequestedAt: "2026-01-06T00:00:00Z",
      deliveryDeadlineAt: "2026-01-07T00:00:00Z",
      cancelledAt: "2026-01-08T00:00:00Z",
      handedOverAt: "2026-01-09T00:00:00Z",
      deliveredAt: "2026-01-10T00:00:00Z",
    });
    expect(result.totalPages).toBe(2);
  });

  it("serializes the approved advanced order filters without caller fields", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue(page());

    await orderCenterApi.list({
      page: 2,
      size: 25,
      warehouseId: "55555555-5555-4555-8555-555555555555",
      skuKeyword: "SKU_%\\",
      paymentStatus: "PAID",
      countryCode: "CN",
      printed: false,
      reshipment: true,
      minAmountMinor: 100,
      maxWeightGrams: 500,
      placedFrom: "2026-01-01T00:00:00Z",
    });

    expect(apiClient.request).toHaveBeenCalledWith(
      "/api/v1/order-center/orders?page=2&size=25" +
        "&skuKeyword=SKU_%25%5C" +
        "&warehouseId=55555555-5555-4555-8555-555555555555" +
        "&paymentStatus=PAID&countryCode=CN&printed=false&reshipment=true" +
        "&minAmountMinor=100&maxWeightGrams=500" +
        "&placedFrom=2026-01-01T00%3A00%3A00Z",
    );
  });

  it("uses allowlisted payloads for bulk status and CSV transfers", async () => {
    const jobId = "66666666-6666-4666-8666-666666666666";
    const request = vi.spyOn(apiClient, "request")
      .mockResolvedValueOnce({
        jobId,
        status: "SUCCEEDED",
        requestedCount: 1,
        succeededCount: 1,
        failedCount: 0,
      })
      .mockResolvedValueOnce({
        jobId,
        status: "SUCCEEDED",
        requestedCount: 1,
        succeededCount: 1,
        failedCount: 0,
        filename: "orders.csv",
        mediaType: "text/csv",
        contentBase64: "YQ==",
      })
      .mockResolvedValueOnce({
        jobId,
        status: "SUCCEEDED",
        requestedCount: 1,
        succeededCount: 1,
        failedCount: 0,
      });

    await orderCenterApi.bulkStatus({
      commandId: jobId,
      targetStatus: "HOLD",
      reason: "ADDRESS_REVIEW",
      orders: [{ orderId, version: 2 }],
    });
    await orderCenterApi.exportCsv({ status: "HOLD", keyword: "needle" });
    const file = new File(["header"], "orders.csv", { type: "text/csv" });
    await orderCenterApi.importCsv(file, "import.1");

    expect(request.mock.calls[0]).toEqual([
      "/api/v1/order-center/orders/bulk-status",
      {
        method: "POST",
        body: {
          commandId: jobId,
          targetStatus: "HOLD",
          reason: "ADDRESS_REVIEW",
          orders: [{ orderId, version: 2 }],
        },
      },
    ]);
    expect(request.mock.calls[1]).toEqual([
      "/api/v1/order-center/transfers/exports",
      { method: "POST", body: { status: "HOLD", keyword: "needle" } },
    ]);
    expect(request.mock.calls[2]?.[0]).toBe(
      "/api/v1/order-center/transfers/imports",
    );
    const form = (request.mock.calls[2]?.[1] as { body: FormData }).body;
    expect(form.get("idempotencyKey")).toBe("import.1");
    expect(form.get("file")).toBe(file);
  });

  it("encodes IDs and sends only approved status fields", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue(detail());

    await orderCenterApi.changeStatus("a/b", {
      version: 1,
      targetStatus: "HOLD",
      reason: "review",
    });

    expect(apiClient.request).toHaveBeenCalledWith(
      "/api/v1/order-center/orders/a%2Fb/status",
      {
        method: "PUT",
        body: {
          version: 1,
          targetStatus: "HOLD",
          reason: "review",
        },
      },
    );
  });

  it("rejects an invalid page envelope instead of inventing defaults", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue({
      items: [],
      page: 0,
      size: 25,
      totalElements: "0",
      totalPages: 0,
    });

    await expect(orderCenterApi.list({ page: 0, size: 25 })).rejects.toThrow(
      "Invalid order response",
    );
  });

  it("rejects invalid UUIDs, monetary values, and line quantities", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue(
      detail({
        currency: "US",
        lines: [{ ...detail().lines[0], quantity: 0 }],
      }),
    );

    await expect(orderCenterApi.get(orderId)).rejects.toThrow(
      "Invalid order response",
    );
  });

  it("rejects a negative minor-unit price", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue(
      detail({
        lines: [{ ...detail().lines[0], unitPriceMinor: -1 }],
      }),
    );

    await expect(orderCenterApi.get(orderId)).rejects.toThrow(
      "Invalid order response",
    );
  });

  it.each([0, 201])("rejects V32 lineCount %s", async (lineCount) => {
    vi.spyOn(apiClient, "request").mockResolvedValue(
      page([order({ lineCount })]),
    );

    await expect(orderCenterApi.list({ page: 0, size: 25 })).rejects.toThrow(
      "Invalid order response",
    );
  });

  it("rejects a page envelope with size zero", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue({
      ...page([order()]),
      size: 0,
    });

    await expect(orderCenterApi.list({ page: 0, size: 25 })).rejects.toThrow(
      "Invalid order response",
    );
  });

  it("rejects invalid optional field types", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue(
      detail({
        buyerReference: { secret: "ignored" },
        holdReason: 3,
        lines: [{ ...detail().lines[0], skuId: { unexpected: true } }],
      }),
    );

    await expect(orderCenterApi.get(orderId)).rejects.toThrow(
      "Invalid order response",
    );
  });

  it("maps legal null optional fields to undefined", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue(
      detail({
        buyerReference: null,
        holdReason: null,
        lines: [
          {
            ...detail().lines[0],
            skuId: null,
            skuCode: null,
            externalListingRef: null,
            externalVariantRef: null,
            skuMatchSource: "UNMATCHED",
          },
        ],
      }),
    );

    const result = await orderCenterApi.get(orderId);

    expect(result.buyerReference).toBeUndefined();
    expect(result.holdReason).toBeUndefined();
    expect(result.lines[0].skuId).toBeUndefined();
    expect(result.lines[0].skuCode).toBeUndefined();
  });

  it("accepts the backend detail contract without a joined shop name", async () => {
    const { shopName: _joinedShopName, ...response } = detail();
    vi.spyOn(apiClient, "request").mockResolvedValue(response);

    const result = await orderCenterApi.get(orderId);

    expect(result.shopName).toBe("—");
  });

  it("maps the business SKU code without replacing the SKU identity", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue(detail());

    const result = await orderCenterApi.get(orderId);

    expect(result.lines[0].skuId).toBe(skuId);
    expect(result.lines[0].skuCode).toBe("SKU-HOSTED-1");
  });

  it("maps all V33 SKU match sources with contract-consistent references", async () => {
    for (const [
      skuMatchSource,
      skuId,
      externalListingRef,
      externalVariantRef,
    ] of [
      ["PROVIDED", "44444444-4444-4444-8444-444444444444", null, null],
      [
        "LISTING_MAPPING",
        "44444444-4444-4444-8444-444444444444",
        "LISTING-001",
        "VARIANT-001",
      ],
      ["MANUAL", "44444444-4444-4444-8444-444444444444", "LISTING-001", null],
      ["UNMATCHED", null, null, null],
    ] as const) {
      vi.spyOn(apiClient, "request").mockResolvedValueOnce(
        detail({
          lines: [
            {
              ...detail().lines[0],
              skuId,
              skuCode: skuId ? "SKU-HOSTED-1" : null,
              externalListingRef,
              externalVariantRef,
              skuMatchSource,
            },
          ],
        }),
      );

      const result = await orderCenterApi.get(orderId);
      expect(result.lines[0].skuMatchSource).toBe(skuMatchSource);
      expect(result.lines[0].skuId).toBe(skuId ?? undefined);
    }
  });

  it.each([
    { externalListingRef: null, externalVariantRef: "VARIANT-001" },
    {
      skuId: "44444444-4444-4444-8444-444444444444",
      skuMatchSource: "UNMATCHED",
    },
    { skuId: null, skuMatchSource: "PROVIDED" },
    { skuId: null, skuMatchSource: "LISTING_MAPPING" },
    { skuId: null, skuMatchSource: "MANUAL" },
  ])(
    "rejects inconsistent V33 SKU match combinations",
    async (lineOverrides) => {
      vi.spyOn(apiClient, "request").mockResolvedValue(
        detail({ lines: [{ ...detail().lines[0], ...lineOverrides }] }),
      );

      await expect(orderCenterApi.get(orderId)).rejects.toThrow(
        "Invalid order response",
      );
    },
  );

  it("rejects unknown sources and invalid optional external references", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue(
      detail({
        lines: [
          {
            ...detail().lines[0],
            externalListingRef: { sensitive: true },
            skuMatchSource: "UNKNOWN",
          },
        ],
      }),
    );

    await expect(orderCenterApi.get(orderId)).rejects.toThrow(
      "Invalid order response",
    );
  });

  it("sends the current version and nullable SKU match target", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue(detail());

    await orderCenterApi.changeLineSkuMatch(orderId, lineId, {
      version: 7,
      skuId: null,
    });

    expect(apiClient.request).toHaveBeenCalledWith(
      `/api/v1/order-center/orders/${orderId}/lines/${lineId}/sku-match`,
      { method: "PUT", body: { version: 7, skuId: null } },
    );
  });

  it("projects a safe unmatched queue item and drops sensitive fields", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue({
      items: [
        {
          orderId,
          orderVersion: 3,
          orderStatus: "RECEIVED",
          shopId,
          externalOrderRef: "ORDER-1",
          placedAt: "2026-01-01",
          lineId,
          externalLineRef: "LINE-1",
          titleSnapshot: "Widget",
          externalListingRef: "LISTING-1",
          externalVariantRef: "VARIANT-1",
          skuId: null,
          skuMatchSource: "UNMATCHED",
          buyer: "secret",
          amount: 99,
          idempotencyKey: "secret",
          rawPayload: {},
        },
      ],
      page: 0,
      size: 25,
      totalElements: 1,
      totalPages: 1,
    });
    const result = await orderCenterApi.listSkuMatchQueue({
      page: 0,
      size: 25,
    });
    expect(result.items[0]).toMatchObject({
      orderId,
      orderVersion: 3,
      skuMatchSource: "UNMATCHED",
    });
    expect(result.items[0]).not.toHaveProperty("buyer");
    expect(result.items[0]).not.toHaveProperty("rawPayload");
  });

  it.each([
    { orderId: "bad" },
    { orderVersion: -1 },
    { orderStatus: "CANCELLED" },
    { skuId: orderId },
    { externalListingRef: null, externalVariantRef: "variant" },
  ])("rejects invalid queue contracts", async (override) => {
    vi.spyOn(apiClient, "request").mockResolvedValue({
      items: [
        {
          orderId,
          orderVersion: 1,
          orderStatus: "RECEIVED",
          shopId,
          externalOrderRef: "O",
          placedAt: "t",
          lineId,
          externalLineRef: "L",
          titleSnapshot: "T",
          externalListingRef: null,
          externalVariantRef: null,
          skuId: null,
          skuMatchSource: "UNMATCHED",
          ...override,
        },
      ],
      page: 0,
      size: 25,
      totalElements: 1,
      totalPages: 1,
    });
    await expect(
      orderCenterApi.listSkuMatchQueue({ page: 0, size: 25 }),
    ).rejects.toThrow("Invalid order response");
  });

  it("maps Shopify order catalog preview and drops unsafe raw fields", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue({
      mode: "XZ_ERP_APP",
      connectionStatus: "CONNECTED",
      cursor: "next==",
      hasNextPage: true,
      fetchedAt: "2026-07-31T01:02:03Z",
      rawPayload: { token: "secret" },
      orders: [{
        externalOrderRef: "gid://shopify/Order/100",
        legacyResourceId: "100",
        name: "#1001",
        email: "buyer@example.test",
        sourceName: "web",
        createdAt: "2026-07-30T01:02:03Z",
        updatedAt: "2026-07-31T01:02:03Z",
        financialStatus: "PAID",
        fulfillmentStatus: "UNFULFILLED",
        paymentGatewayNames: ["shopify_payments"],
        total: { amount: "45.50", amountMinor: 4550, currencyCode: "USD" },
        shippingAddress: {
          name: "Demo Buyer",
          countryCode: "US",
          formatted: ["1 Main St", "New York NY 10001"],
        },
        customer: {
          externalCustomerRef: "gid://shopify/Customer/500",
          displayName: "Demo Buyer",
          email: "buyer@example.test",
          createdAt: "2026-07-01T01:02:03Z",
          totalSpent: { amount: "145.00", amountMinor: 14500, currencyCode: "USD" },
        },
        lineItems: [{
          externalLineRef: "gid://shopify/LineItem/900",
          externalListingRef: "gid://shopify/Product/800",
          externalVariantRef: "gid://shopify/ProductVariant/801",
          inventoryItemRef: "gid://shopify/InventoryItem/802",
          name: "Catalog Hoodie - Blue / M",
          title: "Catalog Hoodie",
          quantity: 2,
          platformSku: "HD-B-M",
          variantTitle: "Blue / M",
          requiresShipping: true,
          discountedTotal: {
            amount: "39.50",
            amountMinor: 3950,
            currencyCode: "USD",
          },
          originalUnitPrice: {
            amount: "19.75",
            amountMinor: 1975,
            currencyCode: "USD",
          },
          matchStatus: "EXACT_SKU_MATCH",
          localSku: {
            id: skuId,
            businessCode: "HD-B-M",
            name: "Hoodie",
            status: "ACTIVE",
          },
        }],
        fulfillments: [{
          externalFulfillmentRef: "gid://shopify/Fulfillment/700",
          status: "SUCCESS",
          createdAt: "2026-07-31T03:02:03Z",
          trackingInfo: [{
            company: "UPS",
            number: "1Z",
            url: "https://track.example/1Z",
          }],
        }],
      }],
    });

    const result = await orderCenterApi.previewShopifyCatalog({
      shopId,
      limit: 25,
      cursor: "opaque==",
      query: "created_at:>=2026-07-01",
      historical: true,
    });

    expect(apiClient.request).toHaveBeenCalledWith(
      `/api/v1/order-center/shopify/catalog-preview?shopId=${shopId}` +
        "&limit=25&cursor=opaque%3D%3D" +
        "&query=created_at%3A%3E%3D2026-07-01&historical=true",
    );
    expect(result).toMatchObject({
      mode: "XZ_ERP_APP",
      connectionStatus: "CONNECTED",
      cursor: "next==",
      hasNextPage: true,
    });
    expect(result).not.toHaveProperty("rawPayload");
    expect(result.orders[0].total?.amountMinor).toBe(4550);
    expect(result.orders[0].lineItems[0].localSku?.id).toBe(skuId);
    expect(result.orders[0].fulfillments[0].trackingInfo[0].number)
      .toBe("1Z");
  });

  it.each([
    {
      orders: [{
        externalOrderRef: "gid://shopify/Order/100",
        name: "#1001",
        createdAt: "2026-07-30T01:02:03Z",
        lineItems: [{
          externalLineRef: "line-1",
          name: "Item",
          quantity: 1,
          requiresShipping: true,
          matchStatus: "EXACT_SKU_MATCH",
          localSku: null,
        }],
        fulfillments: [],
      }],
    },
    {
      orders: [{
        externalOrderRef: "gid://shopify/Order/100",
        name: "#1001",
        createdAt: "2026-07-30T01:02:03Z",
        lineItems: [{
          externalLineRef: "line-1",
          name: "Item",
          quantity: 1,
          requiresShipping: true,
          matchStatus: "MISSING_LOCAL_SKU",
          localSku: {
            id: skuId,
            businessCode: "HD-B-M",
            name: "Hoodie",
            status: "ACTIVE",
          },
        }],
        fulfillments: [],
      }],
    },
    {
      connectionStatus: "CONNECTED",
      hasNextPage: true,
      orders: "not-array",
    },
  ])("rejects unsafe Shopify order preview contracts", async (override) => {
    vi.spyOn(apiClient, "request").mockResolvedValue({
      mode: "XZ_ERP_APP",
      connectionStatus: "CONNECTED",
      hasNextPage: false,
      ...override,
    });

    await expect(orderCenterApi.previewShopifyCatalog({ shopId }))
      .rejects.toThrow("Invalid order response");
  });

  it("rejects invalid Shopify order preview request boundaries", async () => {
    const request = vi.spyOn(apiClient, "request");

    await expect(orderCenterApi.previewShopifyCatalog({
      shopId: "not-a-uuid",
    })).rejects.toThrow("Invalid order request");
    await expect(orderCenterApi.previewShopifyCatalog({
      shopId,
      limit: 101,
    })).rejects.toThrow("Invalid order request");

    expect(request).not.toHaveBeenCalled();
  });

  it("imports selected Shopify order catalog entries by server-side refs", async () => {
    const orderId = "55555555-5555-4555-8555-555555555555";
    vi.spyOn(apiClient, "request").mockResolvedValue({
      requestedCount: 1,
      importedCount: 1,
      skippedCount: 0,
      items: [{
        externalOrderRef: "gid://shopify/Order/100",
        name: "#1001",
        orderId,
        status: "IMPORTED",
      }],
    });

    const result = await orderCenterApi.importShopifyCatalog({
      shopId,
      limit: 25,
      cursor: "opaque==",
      query: "created_at:>=2026-07-01",
      historical: true,
      externalOrderRefs: ["gid://shopify/Order/100"],
    });

    expect(apiClient.request).toHaveBeenCalledWith(
      "/api/v1/order-center/shopify/catalog-import",
      {
        method: "POST",
        body: {
          shopId,
          limit: 25,
          cursor: "opaque==",
          query: "created_at:>=2026-07-01",
          historical: true,
          externalOrderRefs: ["gid://shopify/Order/100"],
        },
      },
    );
    expect(result.importedCount).toBe(1);
    expect(result.items[0].orderId).toBe(orderId);
    expect(result.items[0].status).toBe("IMPORTED");
  });

  it("rejects invalid Shopify order import request boundaries", async () => {
    const request = vi.spyOn(apiClient, "request");

    await expect(orderCenterApi.importShopifyCatalog({
      shopId: "not-a-uuid",
      externalOrderRefs: ["gid://shopify/Order/100"],
    })).rejects.toThrow("Invalid order request");
    await expect(orderCenterApi.importShopifyCatalog({
      shopId,
      externalOrderRefs: [],
    })).rejects.toThrow("Invalid order request");
    await expect(orderCenterApi.importShopifyCatalog({
      shopId,
      externalOrderRefs: ["x".repeat(161)],
    })).rejects.toThrow("Invalid order request");

    expect(request).not.toHaveBeenCalled();
  });

  it("updates a Shopify shipping address with versioned idempotent input", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue({
      order: detail({
        version: 8,
        countryCode: "US",
        province: "NY",
        postalCode: "10001",
      }),
      synchronizedAt: "2026-07-31T04:05:06Z",
      replayed: false,
    });
    const input = {
      version: 7,
      profileVersion: 3,
      idempotencyKey: "web.aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      address: {
        firstName: "Ada",
        lastName: "Lovelace",
        company: "XZ",
        address1: "1 Main St",
        address2: "Suite 2",
        city: "New York",
        provinceCode: "NY",
        countryCode: "US",
        zip: "10001",
        phone: "+1 555 0100",
      },
    };

    const result = await orderCenterApi.updateShopifyShippingAddress(
      orderId,
      input,
    );

    expect(apiClient.request).toHaveBeenCalledWith(
      `/api/v1/order-center/orders/${orderId}/shopify/shipping-address`,
      { method: "PUT", body: input },
    );
    expect(result.replayed).toBe(false);
    expect(result.synchronizedAt).toBe("2026-07-31T04:05:06Z");
    expect(result.order.countryCode).toBe("US");
  });

  it("rejects invalid Shopify shipping address input before transport", async () => {
    const request = vi.spyOn(apiClient, "request");
    const valid = {
      version: 7,
      profileVersion: 3,
      idempotencyKey: "web.address-1",
      address: {
        address1: "1 Main St",
        city: "New York",
        countryCode: "US",
      },
    };

    await expect(orderCenterApi.updateShopifyShippingAddress("bad", valid))
      .rejects.toThrow("Invalid order request");
    await expect(orderCenterApi.updateShopifyShippingAddress(orderId, {
      ...valid,
      address: { ...valid.address, countryCode: "us" },
    })).rejects.toThrow("Invalid order request");
    await expect(orderCenterApi.updateShopifyShippingAddress(orderId, {
      ...valid,
      idempotencyKey: "contains spaces",
    })).rejects.toThrow("Invalid order request");

    expect(request).not.toHaveBeenCalled();
  });

  it("fails closed on an unsafe Shopify shipping address response", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue({
      order: detail(),
      synchronizedAt: "not-an-instant",
      replayed: "false",
      providerToken: "must-not-project",
    });

    await expect(orderCenterApi.updateShopifyShippingAddress(orderId, {
      version: 7,
      profileVersion: 3,
      idempotencyKey: "web.address-1",
      address: {
        address1: "1 Main St",
        city: "New York",
        countryCode: "US",
      },
    })).rejects.toThrow("Invalid order response");
  });

  it("updates a Shopify order line quantity and maps the synchronized total", async () => {
    const changed = detail({
      externalOrderRef: "gid://shopify/Order/10",
      totalAmountMinor: 4995,
      lines: [{
        ...detail().lines[0],
        externalLineRef: "gid://shopify/LineItem/30",
        externalVariantRef: "gid://shopify/ProductVariant/40",
        quantity: 1,
      }],
    });
    vi.spyOn(apiClient, "request").mockResolvedValue({
      order: changed,
      recoveredFromShopify: false,
      replayed: false,
      totalAmountMinor: 4995,
      currency: "USD",
      synchronizedAt: "2026-07-31T05:06:07Z",
    });
    const input = {
      lineId,
      expectedQuantity: 2,
      quantity: 1,
      restock: true,
      notifyCustomer: true,
      idempotencyKey: `web.order-line.${lineId}`,
    };

    const result = await orderCenterApi.updateShopifyLineQuantity(
      orderId,
      input,
    );

    expect(apiClient.request).toHaveBeenCalledWith(
      `/api/v1/order-center/orders/${orderId}/shopify/line-quantity`,
      { method: "PUT", body: input },
    );
    expect(result.order.lines[0].quantity).toBe(1);
    expect(result.totalAmountMinor).toBe(4995);
  });

  it("rejects unsafe Shopify order line quantity input and responses", async () => {
    const request = vi.spyOn(apiClient, "request");
    const valid = {
      lineId,
      expectedQuantity: 2,
      quantity: 1,
      restock: true,
      notifyCustomer: true,
      idempotencyKey: "web.order-line-1",
    };
    await expect(orderCenterApi.updateShopifyLineQuantity("bad", valid))
      .rejects.toThrow("Invalid order request");
    await expect(orderCenterApi.updateShopifyLineQuantity(orderId, {
      ...valid,
      quantity: 3,
      restock: true,
    })).rejects.toThrow("Invalid order request");
    expect(request).not.toHaveBeenCalled();

    request.mockResolvedValue({
      order: detail(),
      recoveredFromShopify: false,
      replayed: false,
      totalAmountMinor: -1,
      currency: "USD",
    });
    await expect(orderCenterApi.updateShopifyLineQuantity(orderId, valid))
      .rejects.toThrow("Invalid order response");
  });

  it("adds a Shopify variant and maps the created order line", async () => {
    const listingId = "88888888-8888-4888-8888-888888888888";
    vi.spyOn(apiClient, "request").mockResolvedValue({
      order: detail({ externalOrderRef: "gid://shopify/Order/10" }),
      lineId: "77777777-7777-4777-8777-777777777777",
      externalLineRef: "gid://shopify/LineItem/40",
      recoveredFromShopify: false,
      replayed: false,
      unitPriceMinor: 1250,
      totalAmountMinor: 8495,
      currency: "USD",
      synchronizedAt: "2026-07-31T05:06:07Z",
    });
    const input = {
      listingId,
      quantity: 2,
      notifyCustomer: true,
      idempotencyKey: "web.order-add-1",
    };

    const result = await orderCenterApi.addShopifyOrderVariant(
      orderId,
      input,
    );

    expect(apiClient.request).toHaveBeenCalledWith(
      `/api/v1/order-center/orders/${orderId}/shopify/variants`,
      { method: "POST", body: input },
    );
    expect(result.externalLineRef).toBe("gid://shopify/LineItem/40");
    expect(result.unitPriceMinor).toBe(1250);
  });

  it("rejects unsafe Shopify variant addition input and responses", async () => {
    const request = vi.spyOn(apiClient, "request");
    const valid = {
      listingId: "88888888-8888-4888-8888-888888888888",
      quantity: 2,
      notifyCustomer: true,
      idempotencyKey: "web.order-add-1",
    };
    await expect(orderCenterApi.addShopifyOrderVariant("bad", valid))
      .rejects.toThrow("Invalid order request");
    await expect(orderCenterApi.addShopifyOrderVariant(orderId, {
      ...valid,
      quantity: 0,
    })).rejects.toThrow("Invalid order request");
    expect(request).not.toHaveBeenCalled();

    request.mockResolvedValue({
      order: detail(),
      lineId: lineId,
      externalLineRef: "not-a-shopify-line",
      recoveredFromShopify: false,
      replayed: false,
      unitPriceMinor: 1250,
      totalAmountMinor: 8495,
      currency: "USD",
    });
    await expect(orderCenterApi.addShopifyOrderVariant(orderId, valid))
      .rejects.toThrow("Invalid order response");
  });

  it("adds a Shopify custom order item and maps the created line", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue({
      order: detail({ externalOrderRef: "gid://shopify/Order/10" }),
      lineId: "77777777-7777-4777-8777-777777777777",
      externalLineRef: "gid://shopify/LineItem/41",
      recoveredFromShopify: false,
      replayed: false,
      unitPriceMinor: 1250,
      totalAmountMinor: 8495,
      currency: "USD",
      synchronizedAt: "2026-08-01T01:00:00Z",
    });
    const input = {
      title: "Gift wrapping",
      unitPriceMinor: 1250,
      quantity: 2,
      requiresShipping: false,
      taxable: true,
      notifyCustomer: true,
      idempotencyKey: "web.order-custom-1",
    };

    const result = await orderCenterApi.addShopifyOrderCustomItem(
      orderId,
      input,
    );

    expect(apiClient.request).toHaveBeenCalledWith(
      `/api/v1/order-center/orders/${orderId}/shopify/custom-items`,
      { method: "POST", body: input },
    );
    expect(result.externalLineRef).toBe("gid://shopify/LineItem/41");
    expect(result.unitPriceMinor).toBe(1250);
  });

  it("rejects unsafe Shopify custom item input and responses", async () => {
    const request = vi.spyOn(apiClient, "request");
    const valid = {
      title: "Gift wrapping",
      unitPriceMinor: 1250,
      quantity: 2,
      requiresShipping: false,
      taxable: true,
      notifyCustomer: true,
      idempotencyKey: "web.order-custom-1",
    };
    await expect(orderCenterApi.addShopifyOrderCustomItem("bad", valid))
      .rejects.toThrow("Invalid order request");
    await expect(orderCenterApi.addShopifyOrderCustomItem(orderId, {
      ...valid,
      title: " ",
    })).rejects.toThrow("Invalid order request");
    await expect(orderCenterApi.addShopifyOrderCustomItem(orderId, {
      ...valid,
      unitPriceMinor: -1,
    })).rejects.toThrow("Invalid order request");
    expect(request).not.toHaveBeenCalled();

    request.mockResolvedValue({
      order: detail(),
      lineId,
      externalLineRef: "not-a-shopify-line",
      recoveredFromShopify: false,
      replayed: false,
      unitPriceMinor: 1250,
      totalAmountMinor: 8495,
      currency: "USD",
    });
    await expect(orderCenterApi.addShopifyOrderCustomItem(orderId, valid))
      .rejects.toThrow("Invalid order response");
  });

  it("adds a Shopify line discount and maps synchronized totals", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue({
      order: detail({ externalOrderRef: "gid://shopify/Order/10" }),
      lineId,
      recoveredFromShopify: false,
      replayed: false,
      discountTotalMinor: 500,
      totalAmountMinor: 7995,
      currency: "USD",
      synchronizedAt: "2026-08-01T02:00:00Z",
    });
    const input = {
      lineId,
      description: "VIP adjustment",
      discountType: "FIXED" as const,
      fixedValueMinor: 500,
      notifyCustomer: true,
      idempotencyKey: "web.order-discount-1",
    };

    const result = await orderCenterApi.addShopifyOrderLineDiscount(
      orderId,
      input,
    );

    expect(apiClient.request).toHaveBeenCalledWith(
      `/api/v1/order-center/orders/${orderId}/shopify/line-discounts`,
      { method: "POST", body: input },
    );
    expect(result.discountTotalMinor).toBe(500);
    expect(result.totalAmountMinor).toBe(7995);
  });

  it("rejects incomplete Shopify line discount values and responses", async () => {
    const request = vi.spyOn(apiClient, "request");
    const valid = {
      lineId,
      description: "VIP adjustment",
      discountType: "PERCENTAGE" as const,
      percentBasisPoints: 1250,
      notifyCustomer: true,
      idempotencyKey: "web.order-discount-1",
    };
    await expect(orderCenterApi.addShopifyOrderLineDiscount("bad", valid))
      .rejects.toThrow("Invalid order request");
    await expect(orderCenterApi.addShopifyOrderLineDiscount(orderId, {
      ...valid,
      percentBasisPoints: 10_001,
    })).rejects.toThrow("Invalid order request");
    await expect(orderCenterApi.addShopifyOrderLineDiscount(orderId, {
      ...valid,
      fixedValueMinor: 500,
    })).rejects.toThrow("Invalid order request");
    expect(request).not.toHaveBeenCalled();

    request.mockResolvedValue({
      order: detail(),
      lineId: "unsafe",
      recoveredFromShopify: false,
      replayed: false,
      discountTotalMinor: 500,
      totalAmountMinor: 7995,
      currency: "USD",
    });
    await expect(orderCenterApi.addShopifyOrderLineDiscount(orderId, valid))
      .rejects.toThrow("Invalid order response");
  });

  it("cancels a Shopify order with explicit financial and inventory options", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue({
      order: detail({ status: "CANCELLED" }),
      recoveredFromShopify: false,
      replayed: false,
      cancelledAt: "2026-08-01T03:00:00Z",
      jobId: "gid://shopify/Job/abc",
      synchronizedAt: "2026-08-01T03:00:01Z",
    });
    const input = {
      reason: "CUSTOMER" as const,
      staffNote: "Buyer requested",
      refundOriginalPaymentMethods: true,
      restock: true,
      notifyCustomer: true,
      idempotencyKey: "web.order-cancel-1",
    };

    const result = await orderCenterApi.cancelShopifyOrder(orderId, input);

    expect(apiClient.request).toHaveBeenCalledWith(
      `/api/v1/order-center/orders/${orderId}/shopify/cancellation`,
      { method: "POST", body: input },
    );
    expect(result.cancelledAt).toBe("2026-08-01T03:00:00Z");
  });

  it("rejects unsafe Shopify cancellation requests and responses", async () => {
    const request = vi.spyOn(apiClient, "request");
    const valid = {
      reason: "INVENTORY" as const,
      refundOriginalPaymentMethods: false,
      restock: true,
      notifyCustomer: false,
      idempotencyKey: "web.order-cancel-1",
    };
    await expect(orderCenterApi.cancelShopifyOrder("bad", valid))
      .rejects.toThrow("Invalid order request");
    await expect(orderCenterApi.cancelShopifyOrder(orderId, {
      ...valid, staffNote: "x".repeat(181),
    })).rejects.toThrow("Invalid order request");
    expect(request).not.toHaveBeenCalled();
    request.mockResolvedValue({
      order: detail(), recoveredFromShopify: false, replayed: false,
      cancelledAt: "not-an-instant",
    });
    await expect(orderCenterApi.cancelShopifyOrder(orderId, valid))
      .rejects.toThrow("Invalid order response");
  });

  it("publishes an ERP package to Shopify with a stable command key", async () => {
    const planId = "77777777-7777-4777-8777-777777777777";
    const packageId = "99999999-9999-4999-8999-999999999999";
    vi.spyOn(apiClient, "request").mockResolvedValue({
      plan: fulfillmentPlan(),
      externalFulfillmentRef: "gid://shopify/Fulfillment/50",
      recoveredFromShopify: false,
      publishedAt: "2026-07-31T02:05:00Z",
      replayed: false,
    });
    const input = {
      idempotencyKey: `web.shopify-fulfillment.${packageId}`,
      notifyCustomer: true,
      trackingUrl: "https://track.example/1Z123",
    };

    const result = await orderCenterApi.publishShopifyFulfillment(
      planId,
      packageId,
      input,
    );

    expect(apiClient.request).toHaveBeenCalledWith(
      `/api/v1/fulfillment-center/plans/${planId}/packages/${packageId}/shopify-publication`,
      { method: "POST", body: input },
    );
    expect(result.plan.packages[0].shopifyPublicationStatus)
      .toBe("PUBLISHED");
    expect(result.externalFulfillmentRef)
      .toBe("gid://shopify/Fulfillment/50");
  });

  it("rejects unsafe Shopify fulfillment requests and responses", async () => {
    const planId = "77777777-7777-4777-8777-777777777777";
    const packageId = "99999999-9999-4999-8999-999999999999";
    const request = vi.spyOn(apiClient, "request");
    await expect(orderCenterApi.publishShopifyFulfillment(
      planId,
      packageId,
      {
        idempotencyKey: "web.fulfillment-1",
        notifyCustomer: true,
        trackingUrl: "https://user:secret@track.example/1Z123",
      },
    )).rejects.toThrow("Invalid order request");
    expect(request).not.toHaveBeenCalled();

    request.mockResolvedValue({
      plan: fulfillmentPlan(),
      externalFulfillmentRef: "not-a-shopify-gid",
      recoveredFromShopify: false,
      publishedAt: "2026-07-31T02:05:00Z",
      replayed: false,
    });
    await expect(orderCenterApi.publishShopifyFulfillment(
      planId,
      packageId,
      {
        idempotencyKey: "web.fulfillment-1",
        notifyCustomer: true,
      },
    )).rejects.toThrow("Invalid order response");
  });

  it("books, synchronizes, and hands over a provider waybill", async () => {
    const planId = "77777777-7777-4777-8777-777777777777";
    const packageId = "99999999-9999-4999-8999-999999999999";
    const authorizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const channelId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const response = fulfillmentPlan({
      packages: [{
        ...fulfillmentPlan().packages[0],
        logisticsAuthorizationId: authorizationId,
        logisticsChannelId: channelId,
        logisticsProviderCode: "HUALEI",
        logisticsProviderName: "嘉运晟途",
        logisticsAccountLabel: "默认货代",
        logisticsChannelName: "美国专线",
        logisticsClientReference: "ERP-PACKAGE",
        logisticsProviderOrderReference: "HL-100",
        logisticsLabelUrl: "https://label.example/HL-100.pdf",
        logisticsBookingStatus: "BOOKED",
        logisticsTrackingStatus: "IN_TRANSIT",
        logisticsTrackingSummary: "运输中",
        logisticsLastSyncedAt: "2026-08-14T02:00:00Z",
        logisticsProviderHandoverPending: false,
      }],
    });
    const request = vi.spyOn(apiClient, "request").mockResolvedValue(response);
    const booking = {
      packageVersion: 4,
      authorizationId,
      channelId,
      idempotencyKey: `web.logistics-booking.${packageId}`,
    };

    const booked = await orderCenterApi.bookLogisticsShipment(
      planId, packageId, booking,
    );
    expect(request).toHaveBeenLastCalledWith(
      `/api/v1/fulfillment-center/plans/${planId}/packages/${packageId}/logistics-booking`,
      { method: "POST", body: booking },
    );
    expect(booked.packages[0].logisticsTrackingStatus).toBe("IN_TRANSIT");
    expect(booked.packages[0].logisticsLabelUrl)
      .toBe("https://label.example/HL-100.pdf");

    await orderCenterApi.syncLogisticsShipment(planId, packageId);
    expect(request).toHaveBeenLastCalledWith(
      `/api/v1/fulfillment-center/plans/${planId}/packages/${packageId}/logistics-sync`,
      { method: "POST", body: {} },
    );

    const handover = {
      version: 4,
      packageVersion: 4,
      commandId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      occurredAt: "2026-08-14T02:01:00Z",
    };
    await orderCenterApi.handoverBookedLogisticsShipment(
      planId, packageId, handover,
    );
    expect(request).toHaveBeenLastCalledWith(
      `/api/v1/fulfillment-center/plans/${planId}/packages/${packageId}/logistics-handover`,
      { method: "POST", body: handover },
    );
  });

  it("fails closed on an unsafe provider label URL", async () => {
    const planId = "77777777-7777-4777-8777-777777777777";
    const packageId = "99999999-9999-4999-8999-999999999999";
    vi.spyOn(apiClient, "request").mockResolvedValue(fulfillmentPlan({
      packages: [{
        ...fulfillmentPlan().packages[0],
        logisticsBookingStatus: "BOOKED",
        logisticsLabelUrl: "https://user:secret@label.example/waybill.pdf",
        logisticsProviderHandoverPending: false,
      }],
    }));

    await expect(orderCenterApi.syncLogisticsShipment(planId, packageId))
      .rejects.toThrow("Invalid order response");
  });
});
