import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";

const runtime = vi.hoisted(() => ({
  bulkStatus: vi.fn(),
  changeStatus: vi.fn(),
  changeLineSkuMatch: vi.fn(),
  dashboardSummary: vi.fn(),
  get: vi.fn(),
  getFulfillmentPlanByOrder: vi.fn(),
  listShippingPackagingTemplates: vi.fn(),
  listShippingScales: vi.fn(),
  hasPermission: vi.fn(),
  list: vi.fn(),
  listTransfers: vi.fn(),
  listSkuMatchQueue: vi.fn(),
  previewShopifyCatalog: vi.fn(),
  importShopifyCatalog: vi.fn(),
  updateShopifyShippingAddress: vi.fn(),
  updateShopifyLineQuantity: vi.fn(),
  addShopifyOrderVariant: vi.fn(),
  addShopifyOrderCustomItem: vi.fn(),
  addShopifyOrderLineDiscount: vi.fn(),
  cancelShopifyOrder: vi.fn(),
  publishShopifyFulfillment: vi.fn(),
  bookLogisticsShipment: vi.fn(),
  syncLogisticsShipment: vi.fn(),
  handoverBookedLogisticsShipment: vi.fn(),
  listEnabledLogisticsChannels: vi.fn(),
  listSkus: vi.fn(),
  listListings: vi.fn(),
  listPlatforms: vi.fn(),
  listShops: vi.fn(),
  getChannels: vi.fn(),
  listWarehouses: vi.fn(),
  listLocations: vi.fn(),
  listMembers: vi.fn(),
  getSystemGeneralSetting: vi.fn(),
  pushes: [] as string[],
  search: "",
}));

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({
    history: {
      push: (path: string) => runtime.pushes.push(path),
    },
  }),
  useRouterState: ({ select }: { select: (state: unknown) => string }) =>
    select({ location: { searchStr: runtime.search } }),
}));

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ hasPermission: runtime.hasPermission }),
}));

vi.mock("../modules/orderCenterApi", () => ({
  orderStatuses: [
    "UNPAID",
    "RECEIVED",
    "REVIEW_PENDING",
    "MERGE_PENDING",
    "READY_TO_FULFILL",
    "FULFILLING",
    "SHIPPED",
    "DELIVERED",
    "HOLD",
    "CANCELLED",
  ],
  orderListStages: [
    "ALL",
    "UNPAID",
    "REVIEW_PENDING",
    "MERGE_PENDING",
    "PROCESSING",
    "FULFILLING",
    "SHIPPED",
    "DELIVERED",
    "CANCELLED",
  ],
  conditionFields: [
    "ORDER_NUMBER",
    "SALES_RECORD_NUMBER",
    "SHOPPING_CART_REFERENCE",
    "CUSTOMER_ID",
    "CUSTOMER_CODE",
    "RECIPIENT_NAME",
    "RECIPIENT_EMAIL",
    "RECIPIENT_PHONE",
    "POSTAL_CODE",
    "PROVINCE",
    "CITY",
    "TRACKING_REFERENCE",
    "PLATFORM_STATUS",
    "SUPPLIER_REFERENCE",
    "ORDER_REMARK",
    "EXTENDED_ATTRIBUTE",
    "PLATFORM_SKU",
    "INVENTORY_SKU",
    "PRODUCT_NAME",
  ],
  conditionOperators: [
    "EQUALS",
    "NOT_EQUALS",
    "CONTAINS",
    "NOT_CONTAINS",
    "IS_EMPTY",
    "IS_NOT_EMPTY",
  ],
  orderTimeFields: [
    "PLACED",
    "PAID",
    "SHIPPED",
    "PRINTED",
    "CREATED",
    "PLATFORM_RETURNED",
    "EXCEPTION_REVIEWED",
    "CANCELLED",
    "HANDED_OVER",
    "PLATFORM_SPECIFIED_HANDOVER",
    "PLATFORM_LABEL_REQUESTED",
    "DELIVERY_DEADLINE",
    "DELIVERED",
  ],
  orderSortFields: [
    "PLACED_AT",
    "PAID_AT",
    "CREATED_AT",
    "UPDATED_AT",
    "SHIP_BY_AT",
    "TOTAL_AMOUNT",
    "EXTERNAL_ORDER_REF",
  ],
  orderCenterApi: {
    dashboardSummary: runtime.dashboardSummary,
    list: runtime.list,
    listTransfers: runtime.listTransfers,
    listSkuMatchQueue: runtime.listSkuMatchQueue,
    previewShopifyCatalog: runtime.previewShopifyCatalog,
    importShopifyCatalog: runtime.importShopifyCatalog,
    updateShopifyShippingAddress: runtime.updateShopifyShippingAddress,
    updateShopifyLineQuantity: runtime.updateShopifyLineQuantity,
    addShopifyOrderVariant: runtime.addShopifyOrderVariant,
    addShopifyOrderCustomItem: runtime.addShopifyOrderCustomItem,
    addShopifyOrderLineDiscount: runtime.addShopifyOrderLineDiscount,
    cancelShopifyOrder: runtime.cancelShopifyOrder,
    publishShopifyFulfillment: runtime.publishShopifyFulfillment,
    bookLogisticsShipment: runtime.bookLogisticsShipment,
    syncLogisticsShipment: runtime.syncLogisticsShipment,
    handoverBookedLogisticsShipment:
      runtime.handoverBookedLogisticsShipment,
    get: runtime.get,
    getFulfillmentPlanByOrder: runtime.getFulfillmentPlanByOrder,
    listShippingPackagingTemplates: runtime.listShippingPackagingTemplates,
    listShippingScales: runtime.listShippingScales,
    changeStatus: runtime.changeStatus,
    changeLineSkuMatch: runtime.changeLineSkuMatch,
    bulkStatus: runtime.bulkStatus,
  },
}));

vi.mock("../modules/logisticsAuthorizationApi", () => ({
  logisticsAuthorizationApi: {
    listEnabledChannels: runtime.listEnabledLogisticsChannels,
  },
}));

vi.mock("../modules/productCenterApi", () => ({
  productCenterApi: {
    listSkus: runtime.listSkus,
    listListings: runtime.listListings,
  },
}));

vi.mock("../modules/shopCenterApi", () => ({
  shopDisplayName: (shop: { displayName: string; localizedDisplayName?: string }) =>
    shop.localizedDisplayName || shop.displayName,
  shopCenterApi: {
    listPlatforms: runtime.listPlatforms,
    listShops: runtime.listShops,
    getChannels: runtime.getChannels,
  },
}));

vi.mock("../modules/warehouseCenterApi", () => ({
  warehouseCenterApi: {
    listWarehouses: runtime.listWarehouses,
    listLocations: runtime.listLocations,
  },
}));

vi.mock("../modules/iamAdminApi", () => ({
  iamAdminApi: { listMembers: runtime.listMembers },
}));

vi.mock("../modules/systemGeneralSettingApi", () => ({
  systemGeneralSettingApi: { get: runtime.getSystemGeneralSetting },
}));

import {
  OrderCenterPage,
  allowedTargets,
  formatMinor,
  formatOrderDateTime,
  orderDetailTriggerId,
  queueOrderDetailTriggerId,
  parseOrderQuery,
  safeOrderError,
} from "./OrderCenterPage";
import { OrderDetailPage } from "./OrderDetailPage";

const orderId = "11111111-1111-4111-8111-111111111111";
const shopId = "22222222-2222-4222-8222-222222222222";
const shopifyPlatformId = "99999999-9999-4999-8999-999999999999";
const lineId = "33333333-3333-4333-8333-333333333333";

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
    version: 1,
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
    buyerReference: "buyer-1",
    lines: [
      {
        id: lineId,
        skuId: "44444444-4444-4444-8444-444444444444",
        skuCode: "SKU-001",
        lineKind: "PRODUCT",
        discountTotalMinor: 0,
        externalListingRef: "LISTING-001",
        externalVariantRef: "VARIANT-001",
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

function fulfillmentPlan(overrides: Record<string, unknown> = {}) {
  return {
    id: "77777777-7777-4777-8777-777777777777",
    orderId,
    shopId,
    sourceOrderVersion: 1,
    externalOrderRef: "ORDER-001",
    status: "PACKING",
    pauseState: "ACTIVE",
    shortageState: "NONE",
    plannedQuantity: 1,
    pickedQuantity: 1,
    packedQuantity: 1,
    shippedQuantity: 0,
    cancelledQuantity: 0,
    version: 2,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    lines: [{
      id: "88888888-8888-4888-8888-888888888888",
      orderLineId: lineId,
      splitSequence: 0,
      skuId: "44444444-4444-4444-8444-444444444444",
      warehouseId: "55555555-5555-4555-8555-555555555555",
      plannedQuantity: 1,
      pickedQuantity: 1,
      packedQuantity: 1,
      shippedQuantity: 0,
      cancelledQuantity: 0,
      externalLineRef: "LINE-001",
      skuBusinessCode: "SKU-001",
      skuName: "Widget",
      inventoryOperationRef: "RESERVATION-001",
    }],
    packages: [{
      id: "99999999-9999-4999-8999-999999999999",
      warehouseId: "55555555-5555-4555-8555-555555555555",
      packageNumber: "PKG-001",
      status: "SEALED",
      packagingTemplateId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      packagingCode: "BOX-S",
      packagingName: "Small box",
      packagingWeightGrams: 50,
      expectedWeightGrams: 500,
      weighingStatus: "PENDING",
      version: 1,
      shopifyPublicationStatus: "NOT_PUBLISHED",
      items: [{
        fulfillmentLineId: "88888888-8888-4888-8888-888888888888",
        quantity: 1,
      }],
    }],
    ...overrides,
  };
}

function page(items = [order()], overrides: Record<string, unknown> = {}) {
  return {
    items,
    page: 0,
    size: 25,
    totalElements: items.length,
    totalPages: 1,
    ...overrides,
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

async function openDetails() {
  await screen.findByRole("button", { name: "查看详情" });
  fireEvent.click(screen.getByRole("button", { name: "查看详情" }));
  render(<OrderDetailPage orderId={orderId} />);
  return screen.findByRole("dialog");
}

beforeEach(() => {
  vi.stubGlobal("crypto", { randomUUID: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
  runtime.search = "";
  runtime.pushes = [];
  runtime.hasPermission.mockImplementation(
    (permission) => permission === "orders.read",
  );
  runtime.list.mockResolvedValue(page());
  runtime.listSkuMatchQueue.mockResolvedValue({
    items: [],
    page: 0,
    size: 25,
    totalElements: 0,
    totalPages: 0,
  });
  runtime.listTransfers.mockResolvedValue({
    items: [],
    page: 0,
    size: 20,
    totalElements: 0,
    totalPages: 0,
  });
  runtime.getSystemGeneralSetting.mockResolvedValue({
    configured: true, defaultCurrency: "USD", version: 0,
    updatedByDisplayName: "UAT Tester",
    createdAt: "2026-08-10T00:00:00Z", updatedAt: "2026-08-10T00:00:00Z",
  });
  runtime.listShippingPackagingTemplates.mockResolvedValue([]);
  runtime.listShippingScales.mockResolvedValue([]);
  window.localStorage.clear();
  runtime.get.mockResolvedValue(detail());
  runtime.getFulfillmentPlanByOrder.mockResolvedValue(fulfillmentPlan());
  runtime.changeStatus.mockResolvedValue(
    detail({ status: "HOLD", version: 2 }),
  );
  runtime.bulkStatus.mockResolvedValue({
    jobId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    status: "COMPLETED",
    requestedCount: 1,
    succeededCount: 1,
    failedCount: 0,
  });
  runtime.changeLineSkuMatch.mockResolvedValue(detail({ version: 2 }));
  runtime.previewShopifyCatalog.mockResolvedValue({
    mode: "XZ_ERP_APP",
    connectionStatus: "CONNECTED",
    hasNextPage: false,
    orders: [],
  });
  runtime.importShopifyCatalog.mockResolvedValue({
    requestedCount: 0,
    importedCount: 0,
    skippedCount: 0,
    items: [],
  });
  runtime.updateShopifyShippingAddress.mockResolvedValue({
    order: detail({ version: 2 }),
    synchronizedAt: "2026-07-31T04:05:06Z",
    replayed: false,
  });
  runtime.addShopifyOrderVariant.mockResolvedValue({
    order: detail({ version: 2 }),
    lineId: "77777777-7777-4777-8777-777777777777",
    externalLineRef: "gid://shopify/LineItem/400",
    recoveredFromShopify: false,
    replayed: false,
    unitPriceMinor: 1250,
    totalAmountMinor: 8495,
    currency: "USD",
    synchronizedAt: "2026-07-31T04:05:06Z",
  });
  runtime.addShopifyOrderCustomItem.mockResolvedValue({
    order: detail({ version: 2 }),
    lineId: "77777777-7777-4777-8777-777777777777",
    externalLineRef: "gid://shopify/LineItem/401",
    recoveredFromShopify: false,
    replayed: false,
    unitPriceMinor: 1250,
    totalAmountMinor: 8495,
    currency: "USD",
    synchronizedAt: "2026-08-01T01:00:00Z",
  });
  runtime.addShopifyOrderLineDiscount.mockResolvedValue({
    order: detail({ version: 2 }),
    lineId: "33333333-3333-4333-8333-333333333333",
    recoveredFromShopify: false,
    replayed: false,
    discountTotalMinor: 500,
    totalAmountMinor: 7995,
    currency: "USD",
    synchronizedAt: "2026-08-01T02:00:00Z",
  });
  runtime.cancelShopifyOrder.mockResolvedValue({
    order: detail({ status: "CANCELLED", version: 2 }),
    recoveredFromShopify: false,
    replayed: false,
    cancelledAt: "2026-08-01T03:00:00Z",
    jobId: "gid://shopify/Job/fake",
    synchronizedAt: "2026-08-01T03:00:00Z",
  });
  runtime.publishShopifyFulfillment.mockResolvedValue({
    plan: fulfillmentPlan(),
    externalFulfillmentRef: "gid://shopify/Fulfillment/50",
    recoveredFromShopify: false,
    publishedAt: "2026-07-31T04:05:06Z",
    replayed: false,
  });
  runtime.listEnabledLogisticsChannels.mockReset().mockResolvedValue([]);
  runtime.bookLogisticsShipment.mockReset().mockResolvedValue(
    fulfillmentPlan(),
  );
  runtime.syncLogisticsShipment.mockReset().mockResolvedValue(
    fulfillmentPlan(),
  );
  runtime.handoverBookedLogisticsShipment.mockReset().mockResolvedValue(
    fulfillmentPlan(),
  );
  runtime.getChannels.mockResolvedValue({
    mode: "XZ_ERP_APP",
    shopify: { status: "CONNECTED" },
    shopifyScopes: [
      { scope: "write_orders", purpose: "订单读取与维护", status: "GRANTED" },
      { scope: "read_all_orders", purpose: "历史订单读取", status: "GRANTED" },
    ],
    activity: [],
  });
  runtime.dashboardSummary.mockResolvedValue(dashboard());
  runtime.listPlatforms.mockReset().mockResolvedValue({
    items: [{
      id: shopifyPlatformId,
      code: "SHOPIFY",
      displayName: "Shopify",
      status: "ACTIVE",
    }],
    page: 0,
    size: 200,
    totalElements: 1,
    totalPages: 1,
  });
  runtime.listShops.mockReset().mockResolvedValue({
    items: [{
      id: shopId,
      platformId: shopifyPlatformId,
      displayName: "测试店铺",
      externalShopRef: "shop-ref",
      status: "ACTIVE",
    }],
    page: 0,
    size: 200,
    totalElements: 1,
    totalPages: 1,
  });
  runtime.listWarehouses.mockReset().mockResolvedValue({
    items: [{
      id: "55555555-5555-4555-8555-555555555555",
      businessCode: "WH-001",
      name: "测试仓库",
    }],
    page: 0,
    size: 200,
    totalElements: 1,
    totalPages: 1,
  });
  runtime.listLocations.mockReset().mockResolvedValue({
    items: [],
    page: 0,
    size: 200,
    totalElements: 0,
    totalPages: 0,
  });
  runtime.listMembers.mockReset().mockResolvedValue({
    items: [],
    page: 0,
    size: 100,
    totalElements: 0,
    totalPages: 0,
  });
  runtime.listSkus.mockResolvedValue({
    items: [
      {
        id: "55555555-5555-4555-8555-555555555555",
        spuId: "66666666-6666-4666-8666-666666666666",
        businessCode: "SKU-001",
        name: "Active SKU",
        variantSummary: "Blue",
        status: "ACTIVE",
        updatedAt: "2026-01-01T00:00:00Z",
        version: 1,
      },
    ],
    page: 0,
    size: 25,
    totalElements: 1,
    totalPages: 1,
  });
  runtime.listListings.mockResolvedValue({
    items: [{
      id: "88888888-8888-4888-8888-888888888888",
      shopId,
      platformId: "99999999-9999-4999-8999-999999999999",
      skuId: "55555555-5555-4555-8555-555555555555",
      sku: {
        id: "55555555-5555-4555-8555-555555555555",
        businessCode: "SKU-RED",
        name: "Travel Bag - Red",
      },
      externalListingRef: "gid://shopify/Product/200",
      externalVariantRef: "gid://shopify/ProductVariant/300",
      externalStatus: "ACTIVE",
      status: "ACTIVE",
      updatedAt: "2026-01-01T00:00:00Z",
      version: 1,
    }],
    page: 0,
    size: 20,
    totalElements: 1,
    totalPages: 1,
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  runtime.bulkStatus.mockReset();
  runtime.changeStatus.mockReset();
  runtime.changeLineSkuMatch.mockReset();
  runtime.dashboardSummary.mockReset();
  runtime.get.mockReset();
  runtime.getFulfillmentPlanByOrder.mockReset();
  runtime.hasPermission.mockReset();
  runtime.list.mockReset();
  runtime.listTransfers.mockReset();
  runtime.listSkuMatchQueue.mockReset();
  runtime.previewShopifyCatalog.mockReset();
  runtime.importShopifyCatalog.mockReset();
  runtime.getSystemGeneralSetting.mockReset();
  runtime.updateShopifyShippingAddress.mockReset();
  runtime.updateShopifyLineQuantity.mockReset();
  runtime.addShopifyOrderVariant.mockReset();
  runtime.addShopifyOrderCustomItem.mockReset();
  runtime.addShopifyOrderLineDiscount.mockReset();
  runtime.cancelShopifyOrder.mockReset();
  runtime.publishShopifyFulfillment.mockReset();
  runtime.getChannels.mockReset();
  runtime.listSkus.mockReset();
  runtime.listListings.mockReset();
});

describe("OrderCenterPage", () => {
  it("leaves status navigation to the shell while applying the selected shareable stage", async () => {
    runtime.search = `?page=7&shopId=${shopId}&stage=PROCESSING&keyword=needle`;

    render(<OrderCenterPage />);

    await screen.findByRole("button", {
      name: "刷新当前店铺的订单状态概览",
    });
    expect(screen.queryByRole("button", { name: /展开订单状态筛选/ })).toBeNull();
    expect(screen.queryByRole("group", { name: "订单状态筛选" })).toBeNull();
    expect(runtime.list).toHaveBeenCalledWith(expect.objectContaining({
      shopId,
      stage: "PROCESSING",
      keyword: "needle",
      page: 7,
    }));
  });

  it("keeps common filters visible and advanced conditions progressively disclosed", async () => {
    render(<OrderCenterPage />);

    await screen.findByRole("button", { name: "查看详情" });
    const filter = screen.getByRole("form", { name: "订单列表筛选" });
    expect(within(filter).getByLabelText("店铺")).not.toBeNull();
    expect(within(filter).getByLabelText("仓库")).not.toBeNull();
    expect(within(filter).getByLabelText("订单状态")).not.toBeNull();
    expect(within(filter).queryByRole("combobox", { name: "平台" })).toBeNull();
    expect(within(filter).queryByRole("textbox", { name: "固定分类" })).toBeNull();
    expect(within(filter).queryByRole("textbox", { name: "自定义分类" })).toBeNull();
    expect(within(filter).queryByRole("textbox", { name: "筛选物流" })).toBeNull();
    expect(within(filter).getByLabelText("关键字").getAttribute("placeholder"))
      .toBe("搜索订单号、物流单号、交易号或内部单号");
    expect(screen.queryByText("批处理功能")).toBeNull();
    expect(screen.queryByText("导入/出相关")).toBeNull();
    expect(screen.queryByLabelText("ORDER-001 更多行操作")).toBeNull();

    const advancedSummary = within(filter).getByRole("button", {
      name: /高级搜索/,
    });
    expect(advancedSummary.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(advancedSummary);
    expect(advancedSummary.getAttribute("aria-expanded")).toBe("true");
    expect(within(filter).getByRole("dialog", { name: "高级搜索" }))
      .not.toBeNull();
    expect(within(filter).getByLabelText("平台")).not.toBeNull();
    expect(within(filter).getByLabelText("固定分类")).not.toBeNull();
    expect(within(filter).getByLabelText("自定义分类")).not.toBeNull();
    expect(within(filter).getByLabelText("筛选物流")).not.toBeNull();
    expect(within(filter).getByLabelText("仓位")).not.toBeNull();
    expect(within(filter).getByRole("heading", { name: "订单属性" }))
      .not.toBeNull();
    expect(within(filter).getByLabelText("下单时间起"))
      .toHaveProperty("type", "datetime-local");
    expect(within(filter).getByText("组合条件").closest("details"))
      .toHaveProperty("open", false);
    expect(within(filter).getByRole("button", { name: "应用筛选" }))
      .not.toBeNull();
  });

  it("loads every management-directory page used by order filters", async () => {
    const warehouseId = "55555555-5555-4555-8555-555555555555";
    runtime.search = `?warehouseId=${warehouseId}`;
    runtime.listPlatforms.mockImplementation(async ({ page }) => ({
      items: [{ id: `platform-${page}`, displayName: `平台 ${page + 1}` }],
      page,
      size: 200,
      totalElements: 2,
      totalPages: 2,
    }));
    runtime.listShops.mockImplementation(async ({ page }) => ({
      items: [{
        id: page === 0 ? shopId : "22222222-2222-4222-8222-222222222223",
        displayName: `店铺 ${page + 1}`,
        externalShopRef: `shop-${page + 1}`,
      }],
      page,
      size: 200,
      totalElements: 2,
      totalPages: 2,
    }));
    runtime.listWarehouses.mockImplementation(async ({ page }) => ({
      items: [{
        id: page === 0 ? warehouseId : "55555555-5555-4555-8555-555555555556",
        businessCode: `WH-00${page + 1}`,
        name: `仓库 ${page + 1}`,
      }],
      page,
      size: 200,
      totalElements: 2,
      totalPages: 2,
    }));
    runtime.listMembers.mockImplementation(async ({ page }) => ({
      items: [{
        id: `member-${page}`,
        displayName: `成员 ${page + 1}`,
        username: `member-${page + 1}`,
      }],
      page,
      size: 100,
      totalElements: 2,
      totalPages: 2,
    }));
    runtime.listLocations.mockImplementation(async (_warehouseId, { page }) => ({
      items: [{
        id: `location-${page}`,
        warehouseId,
        businessCode: `LOC-00${page + 1}`,
        name: `仓位 ${page + 1}`,
      }],
      page,
      size: 200,
      totalElements: 2,
      totalPages: 2,
    }));

    render(<OrderCenterPage />);

    const filter = screen.getByRole("form", { name: "订单列表筛选" });
    expect(await within(filter).findByRole("option", { name: "店铺 2 · shop-2" }))
      .not.toBeNull();
    fireEvent.click(within(filter).getByRole("button", {
      name: /高级搜索/,
    }));
    expect(within(filter).getByRole("option", { name: "平台 2" })).not.toBeNull();
    expect(within(filter).getByRole("option", { name: "WH-002 · 仓库 2" })).not.toBeNull();
    expect(within(filter).getAllByRole("option", { name: "成员 2 · member-2" }).length)
      .toBeGreaterThan(0);
    expect(within(filter).getByRole("option", { name: "LOC-002 · 仓位 2" })).not.toBeNull();
    expect(runtime.listLocations).toHaveBeenCalledWith(warehouseId, {
      page: 1,
      size: 200,
    });
    expect(runtime.listMembers).toHaveBeenCalledWith({
      status: "ACTIVE",
      page: 1,
      size: 100,
    });
  });

  it("retries a partially unavailable management directory", async () => {
    let unavailable = true;
    runtime.listPlatforms.mockImplementation(async ({ page }) => {
      if (unavailable) throw new Error("offline");
      return {
        items: [], page, size: 200, totalElements: 0, totalPages: 0,
      };
    });

    render(<OrderCenterPage />);

    const filter = screen.getByRole("form", { name: "订单列表筛选" });
    const retry = await within(filter).findByRole("button", { name: "重试目录加载" });
    const callsBeforeRetry = runtime.listPlatforms.mock.calls.length;
    unavailable = false;
    fireEvent.click(retry);

    await waitFor(() => expect(runtime.listPlatforms.mock.calls.length)
      .toBeGreaterThan(callsBeforeRetry));
    await waitFor(() => expect(within(filter)
      .queryByRole("button", { name: "重试目录加载" })).toBeNull());
  });

  it("previews Shopify platform orders without importing them", async () => {
    runtime.hasPermission.mockImplementation((permission) =>
      permission === "orders.read" || permission === "orders.write"
    );
    runtime.previewShopifyCatalog.mockResolvedValue({
      mode: "XZ_ERP_APP",
      connectionStatus: "CONNECTED",
      cursor: "next==",
      hasNextPage: true,
      fetchedAt: "2026-07-31T01:02:03Z",
      orders: [{
        externalOrderRef: "gid://shopify/Order/100",
        legacyResourceId: "100",
        name: "#1001",
        email: "buyer@example.test",
        sourceName: "web",
        createdAt: "2026-07-30T01:02:03Z",
        financialStatus: "PAID",
        fulfillmentStatus: "UNFULFILLED",
        paymentGatewayNames: ["shopify_payments"],
        total: { amount: "45.50", amountMinor: 4550, currencyCode: "USD" },
        shippingAddress: {
          countryCode: "US",
          formatted: ["1 Main St", "New York NY 10001"],
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
            id: "44444444-4444-4444-8444-444444444444",
            businessCode: "HD-B-M",
            name: "Hoodie",
            status: "ACTIVE",
          },
        }],
        fulfillments: [{
          externalFulfillmentRef: "gid://shopify/Fulfillment/700",
          status: "SUCCESS",
          createdAt: "2026-07-30T02:02:03Z",
          updatedAt: "2026-07-30T03:02:03Z",
          trackingInfo: [{
            company: "UPS",
            number: "1Z999",
            url: "https://track.example/1Z999",
          }],
        }],
      }],
    });
    runtime.importShopifyCatalog.mockResolvedValue({
      requestedCount: 1,
      importedCount: 1,
      skippedCount: 0,
      items: [{
        externalOrderRef: "gid://shopify/Order/100",
        name: "#1001",
        orderId: "55555555-5555-4555-8555-555555555555",
        status: "IMPORTED",
      }],
    });

    render(<OrderCenterPage />);

    await screen.findByRole("button", { name: "查看详情" });
    fireEvent.click(screen.getByRole("button", { name: "Shopify 订单预览" }));
    await waitFor(() => expect(
      screen.getByLabelText<HTMLSelectElement>("选择 Shopify 订单来源店铺")
        .value,
    ).toBe(shopId));
    fireEvent.click(screen.getByRole("button", { name: "刷新预览" }));

    await screen.findByText("#1001");
    expect(screen.getByRole("dialog", { name: "Shopify 订单预览与导入" })).not.toBeNull();
    expect(screen.getByText("预览只读取 Shopify，不修改店铺订单")).not.toBeNull();
    expect(screen.getByText("已支付")).not.toBeNull();
    expect(screen.getByText("未履约")).not.toBeNull();
    expect(screen.queryByLabelText("Shopify 订单分页游标")).toBeNull();
    expect(screen.queryByText("next==")).toBeNull();
    expect(screen.getByLabelText("订单预览摘要")).not.toBeNull();
    expect(runtime.previewShopifyCatalog).toHaveBeenCalledWith({
      shopId,
      limit: 50,
      cursor: undefined,
      query: undefined,
      historical: false,
    });
    expect(screen.getByText("SKU 精确匹配")).not.toBeNull();
    expect(screen.getByText("HD-B-M")).not.toBeNull();
    expect(screen.getByText("UPS / 1Z999")).not.toBeNull();
    fireEvent.click(screen.getByLabelText("选择 Shopify 订单 #1001"));
    fireEvent.click(screen.getByRole("button", {
      name: "导入到 ERP (1)",
    }));
    await screen.findByText("订单导入完成：已导入 1，跳过 0");
    expect(screen.getByText("55555555-5555-4555-8555-555555555555"))
      .not.toBeNull();
    expect(runtime.importShopifyCatalog).toHaveBeenCalledWith({
      shopId,
      limit: 50,
      cursor: undefined,
      query: undefined,
      historical: false,
      externalOrderRefs: ["gid://shopify/Order/100"],
    });
    await waitFor(() => expect(runtime.list).toHaveBeenCalledTimes(2));
  });

  it("uses an explicit read_all_orders mode for historical preview", async () => {
    render(<OrderCenterPage />);
    await screen.findByRole("button", { name: "查看详情" });
    fireEvent.click(screen.getByRole("button", { name: "Shopify 订单预览" }));
    await waitFor(() => expect(
      screen.getByLabelText<HTMLSelectElement>("选择 Shopify 订单来源店铺")
        .value,
    ).toBe(shopId));

    fireEvent.click(screen.getByLabelText(
      "读取 60 天以前的 Shopify 历史订单",
    ));
    fireEvent.click(screen.getByRole("button", { name: "刷新预览" }));

    await waitFor(() => expect(runtime.previewShopifyCatalog)
      .toHaveBeenCalledWith({
        shopId,
        limit: 50,
        cursor: undefined,
        query: undefined,
        historical: true,
      }));
    expect(screen.getByText(/自动核验历史订单访问权限/)).not.toBeNull();
    expect(screen.queryByText(/read_all_orders/)).toBeNull();
  });

  it("allows read-only Shopify order preview but disables catalog import without orders.write", async () => {
    runtime.previewShopifyCatalog.mockResolvedValue({
      mode: "XZ_ERP_APP",
      connectionStatus: "CONNECTED",
      hasNextPage: false,
      fetchedAt: "2026-07-31T01:02:03Z",
      orders: [{
        externalOrderRef: "gid://shopify/Order/110",
        name: "#1010",
        createdAt: "2026-07-30T01:02:03Z",
        financialStatus: "PAID",
        fulfillmentStatus: "UNFULFILLED",
        paymentGatewayNames: ["shopify_payments"],
        lineItems: [{
          externalLineRef: "gid://shopify/LineItem/910",
          name: "Readonly Hoodie",
          quantity: 1,
          requiresShipping: true,
          matchStatus: "EXACT_SKU_MATCH",
          platformSku: "HD-B-M",
        }],
        fulfillments: [],
      }],
    });

    render(<OrderCenterPage />);

    await screen.findByRole("button", { name: "查看详情" });
    fireEvent.click(screen.getByRole("button", { name: "Shopify 订单预览" }));
    await waitFor(() => expect(
      screen.getByLabelText<HTMLSelectElement>("选择 Shopify 订单来源店铺")
        .value,
    ).toBe(shopId));
    fireEvent.click(screen.getByRole("button", { name: "刷新预览" }));
    await screen.findByText("#1010");
    expect(screen.getByText("当前为只读预览")).not.toBeNull();
    expect(screen.queryByLabelText("选择 Shopify 订单 #1010")).toBeNull();
    expect(screen.queryByRole("button", { name: /导入到 ERP/ })).toBeNull();
    expect(runtime.importShopifyCatalog).not.toHaveBeenCalled();
  });

  it("loads every active shop page for Shopify order preview", async () => {
    render(<OrderCenterPage />);
    await screen.findByRole("button", { name: "查看详情" });
    runtime.listShops.mockImplementation(async ({ page }) => ({
      items: [{
        id: page === 0 ? shopId : "22222222-2222-4222-8222-222222222223",
        platformId: shopifyPlatformId,
        displayName: `预览店铺 ${page + 1}`,
        externalShopRef: `preview-${page + 1}`,
        status: "ACTIVE",
      }],
      page,
      size: 200,
      totalElements: 2,
      totalPages: 2,
    }));

    fireEvent.click(screen.getByRole("button", { name: "Shopify 订单预览" }));

    const select = screen.getByLabelText<HTMLSelectElement>("选择 Shopify 订单来源店铺");
    expect(await within(select).findByRole("option", { name: "预览店铺 2" }))
      .not.toBeNull();
    expect(runtime.listShops).toHaveBeenCalledWith({
      includeArchived: false,
      page: 1,
      size: 200,
    });
  });

  it("keeps non-Shopify and inactive shops out of the order preview", async () => {
    runtime.listPlatforms.mockResolvedValue({
      items: [
        { id: shopifyPlatformId, code: "SHOPIFY", displayName: "Shopify", status: "ACTIVE" },
        { id: "other-platform", code: "OTHER", displayName: "其他平台", status: "ACTIVE" },
      ],
      page: 0,
      size: 200,
      totalElements: 2,
      totalPages: 1,
    });
    runtime.listShops.mockResolvedValue({
      items: [
        {
          id: shopId,
          platformId: shopifyPlatformId,
          displayName: "可用 Shopify 店铺",
          externalShopRef: "shopify-active",
          status: "ACTIVE",
        },
        {
          id: "22222222-2222-4222-8222-222222222224",
          platformId: "other-platform",
          displayName: "其他平台店铺",
          externalShopRef: "other-active",
          status: "ACTIVE",
        },
        {
          id: "22222222-2222-4222-8222-222222222225",
          platformId: shopifyPlatformId,
          displayName: "停用 Shopify 店铺",
          externalShopRef: "shopify-suspended",
          status: "SUSPENDED",
        },
      ],
      page: 0,
      size: 200,
      totalElements: 3,
      totalPages: 1,
    });

    render(<OrderCenterPage />);

    await screen.findByRole("button", { name: "查看详情" });
    fireEvent.click(screen.getByRole("button", { name: "Shopify 订单预览" }));
    const select = screen.getByLabelText<HTMLSelectElement>("选择 Shopify 订单来源店铺");
    expect(await within(select).findByRole("option", { name: "可用 Shopify 店铺" }))
      .not.toBeNull();
    expect(within(select).queryByRole("option", { name: "其他平台店铺" })).toBeNull();
    expect(within(select).queryByRole("option", { name: "停用 Shopify 店铺" })).toBeNull();
  });

  it("pages Shopify order previews without exposing provider cursors", async () => {
    runtime.previewShopifyCatalog
      .mockResolvedValueOnce({
        mode: "XZ_ERP_APP",
        connectionStatus: "CONNECTED",
        cursor: "provider-cursor==",
        hasNextPage: true,
        fetchedAt: "2026-07-31T01:02:03Z",
        orders: [],
      })
      .mockResolvedValueOnce({
        mode: "XZ_ERP_APP",
        connectionStatus: "CONNECTED",
        hasNextPage: false,
        fetchedAt: "2026-07-31T01:03:03Z",
        orders: [],
      });

    render(<OrderCenterPage />);

    await screen.findByRole("button", { name: "查看详情" });
    fireEvent.click(screen.getByRole("button", { name: "Shopify 订单预览" }));
    const dialog = await screen.findByRole("dialog", { name: "Shopify 订单预览与导入" });
    await waitFor(() => expect(
      within(dialog).getByLabelText<HTMLSelectElement>("选择 Shopify 订单来源店铺").value,
    ).toBe(shopId));
    fireEvent.click(within(dialog).getByRole("button", { name: "刷新预览" }));
    await waitFor(() => expect(runtime.previewShopifyCatalog).toHaveBeenCalledTimes(1));

    fireEvent.click(within(dialog).getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(runtime.previewShopifyCatalog).toHaveBeenLastCalledWith({
      shopId,
      limit: 50,
      cursor: "provider-cursor==",
      query: undefined,
      historical: false,
    }));
    expect(within(dialog).queryByText("provider-cursor==")).toBeNull();
    expect(within(dialog).queryByLabelText("Shopify 订单分页游标")).toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: "上一页" }));
    await waitFor(() => expect(runtime.previewShopifyCatalog).toHaveBeenLastCalledWith({
      shopId,
      limit: 50,
      cursor: undefined,
      query: undefined,
      historical: false,
    }));
  });

  it("retries the Shopify order-preview shop directory", async () => {
    render(<OrderCenterPage />);
    await screen.findByRole("button", { name: "查看详情" });
    let unavailable = true;
    runtime.listShops.mockImplementation(async ({ page }) => {
      if (unavailable) throw new Error("offline");
      return {
        items: [{
          id: shopId,
          platformId: shopifyPlatformId,
          displayName: "恢复店铺",
          externalShopRef: "recovered",
          status: "ACTIVE",
        }],
        page,
        size: 200,
        totalElements: 1,
        totalPages: 1,
      };
    });
    fireEvent.click(screen.getByRole("button", { name: "Shopify 订单预览" }));
    const retry = await screen.findByRole("button", { name: "重试店铺目录" });

    unavailable = false;
    fireEvent.click(retry);

    await waitFor(() => expect(
      screen.getByLabelText<HTMLSelectElement>("选择 Shopify 订单来源店铺").value,
    ).toBe(shopId));
    expect(screen.queryByRole("button", { name: "重试店铺目录" })).toBeNull();
  });

  it("shows skipped Shopify order import reasons without refreshing the list", async () => {
    runtime.hasPermission.mockImplementation((permission) =>
      permission === "orders.read" || permission === "orders.write"
    );
    runtime.previewShopifyCatalog.mockResolvedValue({
      mode: "XZ_ERP_APP",
      connectionStatus: "CONNECTED",
      hasNextPage: false,
      fetchedAt: "2026-07-31T01:02:03Z",
      orders: [{
        externalOrderRef: "gid://shopify/Order/200",
        legacyResourceId: "200",
        name: "#1002",
        email: "repeat@example.test",
        createdAt: "2026-07-30T01:02:03Z",
        financialStatus: "PAID",
        fulfillmentStatus: "UNFULFILLED",
        paymentGatewayNames: ["shopify_payments"],
        lineItems: [{
          externalLineRef: "gid://shopify/LineItem/901",
          name: "Duplicate Hoodie",
          quantity: 1,
          requiresShipping: true,
          matchStatus: "MISSING_LOCAL_SKU",
        }],
        fulfillments: [],
      }],
    });
    runtime.importShopifyCatalog.mockResolvedValue({
      requestedCount: 1,
      importedCount: 0,
      skippedCount: 1,
      items: [{
        externalOrderRef: "gid://shopify/Order/200",
        name: "#1002",
        status: "SKIPPED_DUPLICATE",
        safeSummary: "Order already exists in ERP",
      }],
    });

    render(<OrderCenterPage />);

    await screen.findByRole("button", { name: "查看详情" });
    fireEvent.click(screen.getByRole("button", { name: "Shopify 订单预览" }));
    const panel = await screen.findByRole("dialog", { name: "Shopify 订单预览与导入" });
    await waitFor(() => expect(
      panel.querySelector<HTMLSelectElement>("select[aria-label*='Shopify']")
        ?.value,
    ).toBe(shopId));
    fireEvent.click(within(panel).getByRole("button", { name: "刷新预览" }));

    await screen.findByText("#1002");
    fireEvent.click(screen.getByLabelText("选择 Shopify 订单 #1002"));
    fireEvent.click(within(panel).getByRole("button", { name: "导入到 ERP (1)" }));

    await screen.findByText("Order already exists in ERP");
    expect(runtime.importShopifyCatalog).toHaveBeenCalledWith({
      shopId,
      limit: 50,
      cursor: undefined,
      query: undefined,
      historical: false,
      externalOrderRefs: ["gid://shopify/Order/200"],
    });
    expect(runtime.list).toHaveBeenCalledTimes(1);
  });

  it("blocks Shopify order preview when the submitted write_orders grant is missing", async () => {
    runtime.getChannels.mockResolvedValue({
      mode: "XZ_ERP_APP",
      shopify: { status: "CONNECTED" },
      shopifyScopes: [
        { scope: "write_orders", purpose: "订单读取与维护", status: "MISSING" },
      ],
      activity: [],
    });

    render(<OrderCenterPage />);

    await screen.findByRole("button", { name: "查看详情" });
    fireEvent.click(screen.getByRole("button", { name: "Shopify 订单预览" }));
    const panel = await screen.findByRole("dialog", { name: "Shopify 订单预览与导入" });
    await waitFor(() => expect(
      panel.querySelector<HTMLSelectElement>("select[aria-label*='Shopify']")
        ?.value,
    ).toBe(shopId));
    fireEvent.click(within(panel).getByRole("button", { name: "刷新预览" }));

    expect(await within(panel).findByText(/Shopify 应用权限不足/)).toBeTruthy();
    expect(panel.textContent).not.toContain("write_orders");
    expect(runtime.previewShopifyCatalog).not.toHaveBeenCalled();
  });

  it("blocks Shopify order import when write_orders is revoked after preview", async () => {
    runtime.hasPermission.mockImplementation((permission) =>
      permission === "orders.read" || permission === "orders.write"
    );
    runtime.getChannels
      .mockResolvedValueOnce({
        mode: "XZ_ERP_APP",
        shopify: { status: "CONNECTED" },
        shopifyScopes: [
          { scope: "write_orders", purpose: "订单读取与维护", status: "GRANTED" },
        ],
        activity: [],
      })
      .mockResolvedValueOnce({
        mode: "XZ_ERP_APP",
        shopify: { status: "CONNECTED" },
        shopifyScopes: [
          { scope: "write_orders", purpose: "订单读取与维护", status: "MISSING" },
        ],
        activity: [],
      });
    runtime.previewShopifyCatalog.mockResolvedValue({
      mode: "XZ_ERP_APP",
      connectionStatus: "CONNECTED",
      hasNextPage: false,
      fetchedAt: "2026-07-31T01:02:03Z",
      orders: [{
        externalOrderRef: "gid://shopify/Order/300",
        name: "#1003",
        createdAt: "2026-07-30T01:02:03Z",
        financialStatus: "PAID",
        fulfillmentStatus: "UNFULFILLED",
        paymentGatewayNames: ["shopify_payments"],
        lineItems: [{
          externalLineRef: "gid://shopify/LineItem/903",
          name: "Revoked Hoodie",
          quantity: 1,
          requiresShipping: true,
          matchStatus: "EXACT_SKU_MATCH",
          platformSku: "HD-B-M",
        }],
        fulfillments: [],
      }],
    });

    render(<OrderCenterPage />);

    await screen.findByRole("button", { name: "查看详情" });
    fireEvent.click(screen.getByRole("button", { name: "Shopify 订单预览" }));
    const panel = await screen.findByRole("dialog", { name: "Shopify 订单预览与导入" });
    await waitFor(() => expect(
      panel.querySelector<HTMLSelectElement>("select[aria-label*='Shopify']")
        ?.value,
    ).toBe(shopId));
    fireEvent.click(within(panel).getByRole("button", { name: "刷新预览" }));
    await screen.findByText("#1003");
    fireEvent.click(screen.getByLabelText("选择 Shopify 订单 #1003"));
    fireEvent.click(within(panel).getByRole("button", { name: "导入到 ERP (1)" }));

    expect(await within(panel).findByText(/Shopify 应用权限不足/)).toBeTruthy();
    expect(panel.textContent).not.toContain("write_orders");
    expect(runtime.importShopifyCatalog).not.toHaveBeenCalled();
  });

  it("renders the complete safe order summary with zh-CN semantic time", async () => {
    const placedAt = "2026-01-01T00:00:00Z";
    runtime.list.mockResolvedValue(
      page([
        order({
          externalOrderRef: "ORDER-HOLD",
          buyerReference: "b***@example.com",
          status: "HOLD",
          holdReason: "地址待确认",
          currency: "CNY",
          lineCount: 2,
          placedAt,
        }),
        order({
          id: "77777777-7777-4777-8777-777777777777",
          externalOrderRef: "ORDER-NO-BUYER",
          buyerReference: undefined,
          placedAt: "not-a-date",
        }),
      ]),
    );

    render(<OrderCenterPage />);

    const holdRow = (await screen.findByText("ORDER-HOLD")).closest("tr");
    expect(holdRow).not.toBeNull();
    const holdCells = within(holdRow!).getAllByRole("cell");
    expect(holdCells[1].textContent).toBe("ORDER-HOLD");
    expect(holdCells[2].querySelector("time")?.getAttribute("datetime")).toBe(
      placedAt,
    );
    expect(holdCells[2].textContent).toBe(formatOrderDateTime(placedAt));
    expect(holdCells[3].textContent).toBe(`示例店铺${shopId}`);
    expect(holdCells[4].textContent).toBe("b***@example.com");
    expect(holdCells[5].textContent).toContain("已挂起");
    expect(holdCells[5].textContent).toContain("原因：地址待确认");
    expect(holdCells[6].textContent).toContain("CNY");
    expect(holdCells[9].textContent).toContain("2");
    expect(
      within(holdCells[11]).getByRole("button", { name: "查看详情" }),
    ).not.toBeNull();

    const noBuyerRow = screen.getByText("ORDER-NO-BUYER").closest("tr");
    expect(noBuyerRow).not.toBeNull();
    const noBuyerCells = within(noBuyerRow!).getAllByRole("cell");
    expect(noBuyerCells[2].textContent).toBe("—");
    expect(noBuyerCells[2].querySelector("time")).toBeNull();
    expect(noBuyerCells[4].textContent).toBe("—");
  });

  it("shows the Shopify order name and business SKU instead of internal identities", async () => {
    runtime.list.mockResolvedValue(page([order({
      externalOrderRef: "gid://shopify/Order/100",
      customOrderReference: "#1001",
    })]));
    runtime.get.mockResolvedValue(detail({
      externalOrderRef: "gid://shopify/Order/100",
      profile: { version: 0, customOrderReference: "#1001" },
      lines: [{
        ...detail().lines[0],
        skuCode: "SKU-HOSTED-1",
      }],
    }));

    render(<OrderCenterPage />);

    expect(await screen.findByText("#1001")).not.toBeNull();
    expect(screen.getByLabelText("选择订单 #1001")).not.toBeNull();
    expect(screen.queryByText("gid://shopify/Order/100")).toBeNull();

    const dialog = await openDetails();
    expect(within(dialog).getByRole("heading", { name: "#1001" }))
      .not.toBeNull();
    expect(within(dialog).getByText("SKU-HOSTED-1")).not.toBeNull();
    expect(within(dialog).queryByText(
      "44444444-4444-4444-8444-444444444444",
    )).toBeNull();
  });

  it("shows server-backed overview metrics for the shop shared by the orders view", async () => {
    runtime.search = `?shopId=${shopId}&status=RECEIVED`;
    runtime.hasPermission.mockImplementation(
      (permission) => permission === "orders.read",
    );

    render(<OrderCenterPage />);

    await screen.findByRole("heading", { name: "订单概览" });
    await screen.findByRole("button", {
      name: "刷新当前店铺的订单状态概览",
    });
    expect(runtime.dashboardSummary).toHaveBeenCalledWith(shopId);
    const oldestUnmatched = screen.getByText("最早未匹配下单时间");
    const oldestUnmatchedTime =
      oldestUnmatched.nextElementSibling?.querySelector("time");
    expect(oldestUnmatchedTime?.getAttribute("datetime")).toBe(
      "2026-01-01T00:00:00Z",
    );
    expect(oldestUnmatchedTime?.textContent).toBe(
      formatOrderDateTime("2026-01-01T00:00:00Z"),
    );
    expect(runtime.list).toHaveBeenCalledWith(expect.objectContaining({
      shopId,
      status: "RECEIVED",
      keyword: undefined,
      page: 0,
      size: 25,
    }));
  });

  it("does not request or display an overview without orders.read", async () => {
    runtime.hasPermission.mockReturnValue(false);

    render(<OrderCenterPage />);

    expect(screen.queryByRole("heading", { name: "订单概览" })).toBeNull();
    expect(runtime.dashboardSummary).not.toHaveBeenCalled();
    expect(runtime.list).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain(
      "需要订单查看权限后才能查看订单列表。",
    );
  });

  it("renders an invalid overview timestamp safely while retaining its source value", async () => {
    runtime.dashboardSummary.mockResolvedValue(
      dashboard({ oldestUnmatchedPlacedAt: "not-a-date" }),
    );

    render(<OrderCenterPage />);

    await screen.findByRole("heading", { name: "订单概览" });
    const oldestUnmatched = screen.getByText("最早未匹配下单时间");
    expect(oldestUnmatched.nextElementSibling?.textContent).toBe("—");
    expect(oldestUnmatched.nextElementSibling?.querySelector("time")).toBeNull();
  });

  it("renders zero and null overview values without deriving them from the page", async () => {
    runtime.hasPermission.mockImplementation(
      (permission) => permission === "orders.read",
    );
    runtime.dashboardSummary.mockResolvedValue(
      dashboard({ unmatchedLines: 0, oldestUnmatchedPlacedAt: undefined }),
    );

    render(<OrderCenterPage />);

    await screen.findByRole("heading", { name: "订单概览" });
    expect(screen.getByText("暂无").closest("time")).toBeNull();
    expect(screen.getByText("未匹配明细").nextElementSibling?.textContent).toBe(
      "0",
    );
  });

  it("refreshes only the overview and leaves the current orders result intact", async () => {
    runtime.hasPermission.mockImplementation(
      (permission) => permission === "orders.read",
    );
    runtime.dashboardSummary
      .mockResolvedValueOnce(dashboard())
      .mockResolvedValueOnce(
        dashboard({
          totalOrders: 16,
          receivedOrders: 2,
          editableOrders: 7,
        }),
      );

    render(<OrderCenterPage />);

    await screen.findByRole("button", {
      name: "刷新全部可访问店铺的订单状态概览",
    });
    expect(screen.getByText("ORDER-001")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", {
      name: "刷新全部可访问店铺的订单状态概览",
    }));
    await waitFor(() => expect(
      screen.getByText("可编辑订单").nextElementSibling?.textContent,
    ).toBe("7"));
    expect(runtime.dashboardSummary).toHaveBeenCalledTimes(2);
    expect(runtime.list).toHaveBeenCalledTimes(1);
    expect(screen.getByText("ORDER-001")).not.toBeNull();
  });

  it("shows the shop name and tracking number in the default order table", async () => {
    runtime.list.mockResolvedValue(page([order({
      logisticsChannel: "UPS",
      trackingReference: "1Z9999999999999999",
    })]));

    render(<OrderCenterPage />);

    const orderRow = (await screen.findByText("ORDER-001")).closest("tr");
    expect(orderRow).not.toBeNull();
    expect(screen.getByRole("columnheader", { name: "店铺" })).toBeTruthy();
    expect(within(orderRow!).getByText("示例店铺")).toBeTruthy();
    expect(within(orderRow!).getByText("物流单号：1Z9999999999999999"))
      .toBeTruthy();
  });

  it.each([
    [403, "无操作权限，当前会话保持有效。"],
    [404, "订单不存在或当前不可访问。"],
    [500, "请求未能安全完成，请稍后重试。"],
  ])("redacts dashboard %i failures without affecting the orders view", async (status, expected) => {
    runtime.hasPermission.mockImplementation(
      (permission) => permission === "orders.read",
    );
    runtime.dashboardSummary.mockRejectedValue(new ApiError("server secret", { status }));

    render(<OrderCenterPage />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(expected);
    expect(alert.textContent).not.toContain("server secret");
    await screen.findByRole("button", { name: "查看详情" });
  });

  it("keeps the latest shop overview when an earlier request completes late", async () => {
    const oldShopId = "22222222-2222-4222-8222-222222222222";
    const newShopId = "77777777-7777-4777-8777-777777777777";
    const oldRequest = deferred<ReturnType<typeof dashboard>>();
    const newRequest = deferred<ReturnType<typeof dashboard>>();
    runtime.hasPermission.mockImplementation(
      (permission) => permission === "orders.read",
    );
    runtime.dashboardSummary
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(newRequest.promise);
    runtime.search = `?shopId=${oldShopId}`;

    const { rerender } = render(<OrderCenterPage />);
    runtime.search = `?shopId=${newShopId}`;
    rerender(<OrderCenterPage />);
    newRequest.resolve(dashboard());
    await waitFor(() => expect(
      screen.getByText("可编辑订单").nextElementSibling?.textContent,
    ).toBe("6"));
    oldRequest.resolve(
      dashboard({
        totalOrders: 1,
        receivedOrders: 1,
        reviewPendingOrders: 0,
        holdOrders: 0,
        readyToFulfillOrders: 0,
        cancelledOrders: 0,
        editableOrders: 1,
      }),
    );

    await waitFor(() => expect(
      screen.getByText("可编辑订单").nextElementSibling?.textContent,
    ).toBe("6"));
    expect(runtime.dashboardSummary).toHaveBeenNthCalledWith(1, oldShopId);
    expect(runtime.dashboardSummary).toHaveBeenNthCalledWith(2, newShopId);
  });

  it("shares the shop scope with the SKU queue without replacing queue data", async () => {
    runtime.search = `?view=queue&page=0&shopId=${shopId}`;
    runtime.hasPermission.mockImplementation(
      (permission) => permission === "orders.read",
    );

    render(<OrderCenterPage />);

    await screen.findByText("没有待匹配的 SKU 明细");
    await screen.findByRole("heading", { name: "订单概览" });
    expect(runtime.dashboardSummary).toHaveBeenCalledWith(shopId);
    expect(runtime.listSkuMatchQueue).toHaveBeenCalledWith({
      shopId,
      keyword: undefined,
      page: 0,
      size: 25,
    });
  });

  it("keeps the selected shop scope when switching between orders and the queue", async () => {
    runtime.search = `?view=queue&page=0&shopId=${shopId}&keyword=needle`;

    render(<OrderCenterPage />);

    fireEvent.click(screen.getByRole("button", { name: "订单列表" }));
    expect(runtime.pushes).toContain(
      `/orders?page=0&shopId=${shopId}&keyword=needle`,
    );
    fireEvent.click(screen.getByRole("button", { name: "SKU 匹配队列" }));
    expect(runtime.pushes).toContain(
      `/orders?view=queue&page=0&shopId=${shopId}&keyword=needle`,
    );
  });

  it("switches to the shareable queue view and renders its empty state", async () => {
    runtime.search = "?view=queue&page=0";
    render(<OrderCenterPage />);
    expect(screen.getByText("正在加载匹配队列…")).not.toBeNull();
    await screen.findByText("没有待匹配的 SKU 明细");
    expect(runtime.listSkuMatchQueue).toHaveBeenCalledWith({
      page: 0,
      size: 25,
      shopId: undefined,
      keyword: undefined,
    });
    fireEvent.click(screen.getByRole("button", { name: "订单列表" }));
    expect(runtime.pushes).toContain("/orders");
  });

  it("loads every shop-directory page for the SKU queue", async () => {
    runtime.search = "?view=queue&page=0";
    runtime.listShops.mockImplementation(async ({ page }) => ({
      items: [{
        id: page === 0 ? shopId : "22222222-2222-4222-8222-222222222223",
        displayName: `队列店铺 ${page + 1}`,
        externalShopRef: `queue-${page + 1}`,
      }],
      page,
      size: 200,
      totalElements: 2,
      totalPages: 2,
    }));

    render(<OrderCenterPage />);

    const filter = screen.getByRole("form", { name: "SKU 匹配队列筛选" });
    expect(await within(filter).findByRole("option", {
      name: "队列店铺 2 · queue-2",
    })).not.toBeNull();
    expect(runtime.listShops).toHaveBeenCalledWith({
      includeArchived: true,
      page: 1,
      size: 200,
    });
  });

  it("retries the SKU-queue shop directory", async () => {
    runtime.search = "?view=queue&page=0";
    let unavailable = true;
    runtime.listShops.mockImplementation(async ({ page }) => {
      if (unavailable) throw new Error("offline");
      return {
        items: [{ id: shopId, displayName: "恢复店铺", externalShopRef: "recovered" }],
        page,
        size: 200,
        totalElements: 1,
        totalPages: 1,
      };
    });

    render(<OrderCenterPage />);
    const retry = await screen.findByRole("button", { name: "重试店铺目录" });

    unavailable = false;
    fireEvent.click(retry);

    expect(await screen.findByRole("option", { name: "恢复店铺 · recovered" }))
      .not.toBeNull();
    expect(screen.queryByRole("button", { name: "重试店铺目录" })).toBeNull();
  });

  it("loads queue detail only after its Details trigger", async () => {
    runtime.search = "?view=queue&page=0";
    runtime.listSkuMatchQueue.mockResolvedValue({
      items: [
        {
          orderId,
          orderVersion: 1,
          orderStatus: "RECEIVED",
          shopId,
          externalOrderRef: "QUEUE-1",
          placedAt: "2026-01-01",
          lineId,
          externalLineRef: "LINE-1",
          titleSnapshot: "Widget",
          skuMatchSource: "UNMATCHED",
        },
      ],
      page: 0,
      size: 25,
      totalElements: 1,
      totalPages: 1,
    });
    render(<OrderCenterPage />);
    const trigger = await screen.findByRole("button", { name: "查看详情" });
    expect(runtime.get).not.toHaveBeenCalled();
    fireEvent.click(trigger);
    render(<OrderDetailPage orderId={orderId} />);
    await screen.findByRole("dialog");
    expect(runtime.get).toHaveBeenCalledWith(orderId);
  });
  it("allows queue detail read-only access without exposing SKU writes", async () => {
    runtime.search = "?view=queue&page=0";
    runtime.hasPermission.mockImplementation(
      (permission) => permission === "orders.read",
    );
    runtime.listSkuMatchQueue.mockResolvedValue({
      items: [
        {
          orderId,
          orderVersion: 1,
          orderStatus: "RECEIVED",
          shopId,
          externalOrderRef: "QUEUE-READ",
          placedAt: "t",
          lineId,
          externalLineRef: "L",
          titleSnapshot: "T",
          skuMatchSource: "UNMATCHED",
        },
      ],
      page: 0,
      size: 25,
      totalElements: 1,
      totalPages: 1,
    });
    render(<OrderCenterPage />);
    await openDetails();
    expect(screen.queryByLabelText("搜索启用中的 SKU")).toBeNull();
    expect(screen.queryByRole("button", { name: "清除 SKU 匹配" })).toBeNull();
    expect(runtime.changeLineSkuMatch).not.toHaveBeenCalled();
  });
  it("keeps queue filters in the shareable detail URL", async () => {
    runtime.search = "?view=queue&page=0";
    const queuePage = {
      items: [
        {
          orderId,
          orderVersion: 1,
          orderStatus: "RECEIVED",
          shopId,
          externalOrderRef: "QUEUE-WRITE",
          placedAt: "t",
          lineId,
          externalLineRef: "L",
          titleSnapshot: "T",
          skuMatchSource: "UNMATCHED",
        },
      ],
      page: 0,
      size: 25,
      totalElements: 1,
      totalPages: 1,
    };
    runtime.listSkuMatchQueue.mockResolvedValueOnce(queuePage);
    render(<OrderCenterPage />);
    fireEvent.click(await screen.findByRole("button", { name: "查看详情" }));
    expect(runtime.pushes).toContain(
      `/orders/${orderId}?page=0&view=queue&returnFocus=${encodeURIComponent(
        queueOrderDetailTriggerId(orderId, lineId),
      )}`,
    );
  });
  it("returns from an empty final queue page to the preceding page", async () => {
    runtime.search = "?view=queue&page=1";
    runtime.listSkuMatchQueue.mockResolvedValue({
      items: [],
      page: 1,
      size: 25,
      totalElements: 25,
      totalPages: 1,
    });
    render(<OrderCenterPage />);
    await waitFor(() =>
      expect(runtime.pushes).toContain("/orders?view=queue&page=0"),
    );
  });
  it("serializes queue filters and page controls", async () => {
    runtime.search = "?view=queue&page=0";
    runtime.listSkuMatchQueue.mockResolvedValue({
      items: [
        {
          orderId,
          orderVersion: 1,
          orderStatus: "RECEIVED",
          shopId,
          externalOrderRef: "Q",
          placedAt: "t",
          lineId,
          externalLineRef: "L",
          titleSnapshot: "T",
          skuMatchSource: "UNMATCHED",
        },
      ],
      page: 0,
      size: 25,
      totalElements: 26,
      totalPages: 2,
    });
    render(<OrderCenterPage />);
    await screen.findByText("Q");
    expect(
      screen.getByRole("option", { name: "测试店铺 · shop-ref" }),
    ).not.toBeNull();
    expect(screen.getByText("共 26 条待处理明细")).not.toBeNull();
    expect(screen.getAllByText("测试店铺").length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("店铺"), {
      target: { value: shopId },
    });
    fireEvent.change(screen.getByLabelText("关键字"), {
      target: { value: "needle" },
    });
    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    expect(runtime.pushes).toContain(
      `/orders?view=queue&page=0&shopId=${shopId}&keyword=needle`,
    );
    fireEvent.click(screen.getByRole("button", { name: "清空筛选" }));
    expect(runtime.pushes).toContain("/orders?view=queue&page=0");
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "上一页" })
        .disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(runtime.pushes).toContain("/orders?view=queue&page=1");
  });

  it("keeps the newest queue response and redacts queue failures", async () => {
    runtime.search = "?view=queue&page=0&keyword=old";
    const oldRequest = deferred<any>();
    runtime.listSkuMatchQueue
      .mockReturnValueOnce(oldRequest.promise)
      .mockRejectedValueOnce(new ApiError("secret", { status: 403 }));
    const { rerender } = render(<OrderCenterPage />);
    expect(screen.getByText("正在加载匹配队列…")).not.toBeNull();
    runtime.search = "?view=queue&page=0&keyword=new";
    rerender(<OrderCenterPage />);
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toContain(
      "无操作权限",
    );
    expect(screen.getByRole("alert").textContent).not.toContain("secret");
    runtime.listSkuMatchQueue.mockResolvedValueOnce({
      items: [
        {
          orderId,
          orderVersion: 1,
          orderStatus: "RECEIVED",
          shopId,
          externalOrderRef: "RETRIED",
          placedAt: "2026-01-01T00:00:00Z",
          lineId,
          externalLineRef: "L-RETRIED",
          titleSnapshot: "Retried",
          skuMatchSource: "UNMATCHED",
        },
      ],
      page: 0,
      size: 25,
      totalElements: 1,
      totalPages: 1,
    });
    fireEvent.click(
      screen.getByRole("button", { name: "重试加载匹配队列" }),
    );
    await screen.findByText("RETRIED");
    oldRequest.resolve({
      items: [
        {
          orderId,
          orderVersion: 1,
          orderStatus: "RECEIVED",
          shopId,
          externalOrderRef: "STALE",
          placedAt: "t",
          lineId,
          externalLineRef: "L",
          titleSnapshot: "T",
          skuMatchSource: "UNMATCHED",
        },
      ],
      page: 0,
      size: 25,
      totalElements: 1,
      totalPages: 1,
    });
    await waitFor(() => expect(screen.queryByText("STALE")).toBeNull());
  });
  it("formats queue times semantically and omits time for invalid or missing values", async () => {
    runtime.search = "?view=queue&page=0";
    runtime.listSkuMatchQueue.mockResolvedValue({
      items: [
        {
          orderId,
          orderVersion: 1,
          orderStatus: "RECEIVED",
          shopId,
          externalOrderRef: "QUEUE-VALID",
          placedAt: "2026-01-01T00:00:00Z",
          lineId,
          externalLineRef: "LINE-VALID",
          titleSnapshot: "Valid",
          skuMatchSource: "UNMATCHED",
        },
        {
          orderId,
          orderVersion: 1,
          orderStatus: "RECEIVED",
          shopId,
          externalOrderRef: "QUEUE-INVALID",
          placedAt: "not-a-date",
          lineId: "44444444-4444-4444-8444-444444444444",
          externalLineRef: "LINE-INVALID",
          titleSnapshot: "Invalid",
          skuMatchSource: "UNMATCHED",
        },
        {
          orderId,
          orderVersion: 1,
          orderStatus: "RECEIVED",
          shopId,
          externalOrderRef: "QUEUE-MISSING",
          placedAt: undefined,
          lineId: "55555555-5555-4555-8555-555555555555",
          externalLineRef: "LINE-MISSING",
          titleSnapshot: "Missing",
          skuMatchSource: "UNMATCHED",
        },
      ],
      page: 0,
      size: 25,
      totalElements: 3,
      totalPages: 1,
    });

    render(<OrderCenterPage />);

    const validRow = (await screen.findByText("QUEUE-VALID")).closest("tr");
    const invalidRow = screen.getByText("QUEUE-INVALID").closest("tr");
    const missingRow = screen.getByText("QUEUE-MISSING").closest("tr");
    expect(
      validRow?.querySelector('time[datetime="2026-01-01T00:00:00Z"]'),
    ).not.toBeNull();
    expect(validRow?.textContent).not.toContain("2026-01-01T00:00:00Z");
    expect(invalidRow?.querySelector("time")).toBeNull();
    expect(missingRow?.querySelector("time")).toBeNull();
    expect(invalidRow?.textContent).toContain("—");
    expect(missingRow?.textContent).toContain("—");
  });
  it("renders loading, empty, and safe list failure states", async () => {
    const pending = deferred<ReturnType<typeof page>>();
    runtime.list.mockReturnValueOnce(pending.promise);

    const { rerender } = render(<OrderCenterPage />);
    expect(screen.getByText("正在加载订单…")).not.toBeNull();

    pending.resolve(page([]));
    await screen.findByText("没有符合条件的订单");

    runtime.list.mockRejectedValueOnce(new Error("internal server secret"));
    runtime.search = "?keyword=next";
    rerender(<OrderCenterPage />);

    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toContain(
      "请求未能安全完成，请稍后重试。",
    );
    runtime.list.mockResolvedValueOnce(
      page([order({ externalOrderRef: "ORDER-RETRIED" })]),
    );
    fireEvent.click(screen.getByRole("button", { name: "重试加载订单" }));
    await screen.findByText("ORDER-RETRIED");
  });

  it("applies bounded filters and updates the shareable URL", async () => {
    render(<OrderCenterPage />);
    await screen.findByRole("button", { name: "查看详情" });

    fireEvent.change(screen.getByLabelText("店铺"), {
      target: { value: shopId },
    });
    fireEvent.change(screen.getByLabelText("订单状态"), {
      target: { value: "HOLD" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "仓库" }), {
      target: { value: "55555555-5555-4555-8555-555555555555" },
    });
    fireEvent.click(screen.getByRole("button", { name: /高级搜索/ }));
    fireEvent.change(screen.getByLabelText("SKU / 商品"), {
      target: { value: "SKU_%\\" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "付款状态" }), {
      target: { value: "PAID" },
    });
    fireEvent.change(screen.getByLabelText("国家代码"), {
      target: { value: "cn" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "打印状态" }), {
      target: { value: "false" },
    });
    fireEvent.change(screen.getByLabelText("关键字"), {
      target: { value: "widget" },
    });
    fireEvent.click(screen.getByRole("button", { name: "查询" }));

    expect(runtime.pushes).toEqual([
      `/orders?page=0&shopId=${shopId}` +
        "&status=HOLD&keyword=widget&skuKeyword=SKU_%25%5C" +
        "&warehouseId=55555555-5555-4555-8555-555555555555" +
        "&paymentStatus=PAID" +
        "&countryCode=CN&printed=false",
    ]);
    expect(parseOrderQuery("?page=-1&shopId=bad&status=BAD")).toMatchObject({
      view: "orders",
      shopId: "",
      status: undefined,
      keyword: "",
      page: 0,
    });
  });

  it("shows only functional batch and transfer actions and submits selected versions once", async () => {
    runtime.hasPermission.mockImplementation((permission) =>
      [
        "orders.read",
        "orders.write",
        "orders.transfer.read",
        "orders.transfer.write",
      ].includes(permission),
    );
    render(<OrderCenterPage />);
    await screen.findByRole("button", { name: "查看详情" });

    expect(screen.getByText("新建订单")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "转入配货中" })).toBeNull();
    expect(screen.queryByRole("button", { name: "物流交运" })).toBeNull();
    expect(screen.queryByRole("button", { name: "转 WMS 发货" })).toBeNull();
    expect(screen.queryByRole("button", { name: "打印中心" })).toBeNull();
    expect(screen.queryByLabelText("ORDER-001 更多行操作")).toBeNull();
    expect(screen.queryByRole("button", { name: "申报" })).toBeNull();
    expect(screen.queryByRole("button", { name: "物流未选择" })).toBeNull();
    expect(screen.queryByRole("button", { name: "RMA" })).toBeNull();

    expect(screen.queryByRole("region", { name: "已选订单批量操作" }))
      .toBeNull();
    expect(screen.queryByLabelText("批量目标状态")).toBeNull();
    expect(screen.queryByText("批处理功能")).toBeNull();
    expect(screen.queryByText("更多功能")).toBeNull();
    expect(screen.getByText("列表设置")).not.toBeNull();

    fireEvent.click(screen.getByText("导入 / 导出"));
    expect(screen.getByRole("button", {
      name: "导出订单明细（当前筛选）",
    })).not.toBeNull();
    expect(screen.getByRole("button", {
      name: "订单导入（CSV）",
    })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "映射导入模板" })).toBeNull();
    expect(screen.queryByRole("button", { name: "查看订单导入任务" })).toBeNull();
    expect(screen.queryByRole("button", { name: "查看订单导出任务" })).toBeNull();

    const orderActions = screen.getByRole("region", { name: "订单处理操作" });
    fireEvent.click(within(orderActions).getByText("排序"));
    fireEvent.click(screen.getByRole("button", { name: "订单金额" }));
    expect(runtime.pushes).toContain(
      "/orders?page=0&sortField=TOTAL_AMOUNT",
    );

    fireEvent.click(screen.getByLabelText("选择订单 ORDER-001"));
    expect(screen.getByRole("region", { name: "已选订单批量操作" }))
      .not.toBeNull();
    expect(screen.getByText("已选择 1 张订单")).not.toBeNull();
    expect(screen.getByRole("button", { name: "打开订单" })).not.toBeNull();
    fireEvent.change(screen.getByLabelText("批量目标状态"), {
      target: { value: "REVIEW_PENDING" },
    });
    fireEvent.click(screen.getByRole("button", { name: "批量变更" }));

    await waitFor(() => expect(runtime.bulkStatus).toHaveBeenCalledTimes(1));
    expect(runtime.bulkStatus).toHaveBeenCalledWith({
      commandId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      targetStatus: "REVIEW_PENDING",
      orders: [{ orderId, version: 1 }],
    });
    expect((await screen.findByRole("status")).textContent).toContain(
      "已更新 1 张订单。",
    );
  }, 15_000);

  it("synchronizes controlled filter values when the URL changes externally", async () => {
    runtime.search = `?page=4&shopId=${shopId}&status=RECEIVED&keyword=initial`;
    const { rerender } = render(<OrderCenterPage />);
    await screen.findByRole("button", { name: "查看详情" });

    expect(screen.getByLabelText<HTMLSelectElement>("店铺").value).toBe(
      shopId,
    );
    expect(screen.getByLabelText<HTMLSelectElement>("订单状态").value).toBe(
      "RECEIVED",
    );
    expect(screen.getByLabelText<HTMLInputElement>("关键字").value).toBe(
      "initial",
    );

    fireEvent.change(screen.getByLabelText("关键字"), {
      target: { value: "unsaved" },
    });
    runtime.search = "?page=0&status=HOLD&keyword=restored";
    rerender(<OrderCenterPage />);

    await waitFor(() => {
      expect(screen.getByLabelText<HTMLSelectElement>("店铺").value).toBe("");
      expect(screen.getByLabelText<HTMLSelectElement>("订单状态").value).toBe(
        "HOLD",
      );
      expect(screen.getByLabelText<HTMLInputElement>("关键字").value).toBe(
        "restored",
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    expect(runtime.pushes).toContain(
      "/orders?page=0&status=HOLD&keyword=restored",
    );
  });

  it("uses the tenant default currency for a new manual order", async () => {
    runtime.hasPermission.mockImplementation((permission) =>
      permission === "orders.read" || permission === "orders.write",
    );
    runtime.getSystemGeneralSetting.mockResolvedValue({
      configured: true, defaultCurrency: "CNY", version: 1,
      updatedByDisplayName: "UAT Tester",
      createdAt: "2026-08-10T00:00:00Z", updatedAt: "2026-08-10T00:00:00Z",
    });
    render(<OrderCenterPage />);
    await screen.findByRole("button", { name: "查看详情" });
    fireEvent.click(screen.getByRole("button", { name: "新建订单" }));
    const dialog = screen.getByRole("dialog", { name: "新建订单" });
    const currency = dialog.querySelector<HTMLInputElement>(
      'input[list="order-create-currency-options"]',
    );
    await waitFor(() => expect(currency?.value).toBe("CNY"));
  });

  it("uses page controls and their disabled boundaries", async () => {
    runtime.list.mockResolvedValue(
      page([order()], { totalElements: 50, totalPages: 2 }),
    );
    render(<OrderCenterPage />);

    await screen.findByText("共 50 条 · 第 1/2 页");
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "上一页" })
        .disabled,
    ).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "下一页" }).disabled,
    ).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(runtime.pushes).toEqual(["/orders?page=1"]);
  });

  it("persists page size in the URL and supports bounded page jumps", async () => {
    runtime.list.mockResolvedValue(page([order()], {
      totalElements: 100,
      totalPages: 4,
    }));
    render(<OrderCenterPage />);

    await screen.findByText("ORDER-001");
    fireEvent.change(screen.getByLabelText("每页订单数"), {
      target: { value: "50" },
    });
    expect(runtime.pushes).toContain("/orders?page=0&size=50");

    fireEvent.change(screen.getByLabelText("跳转页码"), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByRole("button", { name: "跳转" }));
    expect(runtime.pushes).toContain("/orders?page=2");
  });

  it("persists an allowlisted custom column selection without storing order data", async () => {
    render(<OrderCenterPage />);
    await screen.findByText("ORDER-001");

    fireEvent.click(screen.getByText("列表设置"));
    fireEvent.click(screen.getByRole("checkbox", { name: "买家引用" }));

    expect(screen.queryByRole("columnheader", { name: "买家引用" })).toBeNull();
    expect(window.localStorage.getItem("xz.erp.orders.visibleColumns.v1"))
      .toBe(JSON.stringify([
        "placedAt", "shop", "status", "payment", "logistics",
        "destination", "items", "flags",
      ]));
    expect(window.localStorage.getItem("xz.erp.orders.visibleColumns.v1"))
      .not.toContain("ORDER-001");
  });

  it("enables an allowlisted reference column from the field selector", async () => {
    runtime.list.mockResolvedValue(page([order({
      salesRecordNumber: "TXN-001",
    })]));
    render(<OrderCenterPage />);
    await screen.findByText("ORDER-001");

    fireEvent.click(screen.getByText("列表设置"));
    fireEvent.click(screen.getByRole("checkbox", { name: "交易号" }));

    expect(screen.getByRole("columnheader", { name: "交易号" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "TXN-001" })).toBeTruthy();
    expect(window.localStorage.getItem("xz.erp.orders.visibleColumns.v1"))
      .toBe(JSON.stringify([
        "placedAt", "shop", "buyer", "status", "payment",
        "logistics", "destination", "items", "flags",
        "salesRecordNumber",
      ]));
    expect(window.localStorage.getItem("xz.erp.orders.visibleColumns.v1"))
      .not.toContain("TXN-001");
  });

  it("restores reviewed extended columns and drops unknown persisted fields", async () => {
    runtime.list.mockResolvedValue(page([order({
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
    })]));
    window.localStorage.setItem(
      "xz.erp.orders.visibleColumns.v1",
      JSON.stringify([
        "placedAt",
        "warehouse",
        "location",
        "picker",
        "shipper",
        "purchaser",
        "developer",
        "totalAmount",
        "skuSummary",
        "salesRecordNumber",
        "shoppingCartReference",
        "customOrderReference",
        "trackingReference",
        "secondaryTrackingReference",
        "actualPaid",
        "profit",
        "actualShipping",
        "itemAmount",
        "platformFee",
        "insuranceFee",
        "paymentFee",
        "otherIncome",
        "otherExpense",
        "tax",
        "estimatedShipping",
        "salesperson",
        "manager",
        "orderRemark",
        "customerCategory",
        "productKindCount",
        "supplierReference",
        "parentProductCategory",
        "childProductCategory",
        "productStatus",
        "extendedAttribute",
        "printedAt",
        "platformReturnedAt",
        "exceptionReviewedAt",
        "platformSpecifiedHandoverAt",
        "platformLabelRequestedAt",
        "deliveryDeadlineAt",
        "cancelledAt",
        "handedOverAt",
        "deliveredAt",
        "secret",
      ]),
    );

    render(<OrderCenterPage />);
    await screen.findByText("ORDER-001");

    expect(screen.getByRole("columnheader", { name: "订单金额" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "SKU 摘要" })).toBeTruthy();
    for (const [heading, value] of [
      ["仓库", "华南仓"],
      ["仓位", "PICK-A01"],
      ["配货员", "配货一号"],
      ["发货员", "发货一号"],
      ["采购员", "采购一号"],
      ["商品负责人", "开发一号"],
      ["交易号", "TXN-001"],
      ["购物车单号", "CART-001"],
      ["内部 / 自定义单号", "INTERNAL-001"],
      ["物流单号", "TRACK-001"],
      ["第二物流单号", "TRACK-002"],
      ["实付金额", formatMinor(900, "USD")],
      ["利润", formatMinor(-50, "USD")],
      ["物流支出", formatMinor(150, "USD")],
      ["商品金额", formatMinor(800, "USD")],
      ["平台费用", formatMinor(40, "USD")],
      ["保险费用", formatMinor(10, "USD")],
      ["支付手续费", formatMinor(20, "USD")],
      ["其他收入", formatMinor(30, "USD")],
      ["其他支出", formatMinor(25, "USD")],
      ["税费", formatMinor(-5, "USD")],
      ["预估物流支出", formatMinor(140, "USD")],
      ["业务员", "销售一号"],
      ["订单负责人", "负责人一号"],
      ["订单备注", "已复核"],
      ["客户分类", "重点客户"],
      ["商品种类数", "2 种"],
      ["供应商引用", "SUP-001"],
      ["商品父目录", "家居"],
      ["商品子目录", "照明"],
      ["商品状态", "在售"],
      ["扩展属性", "易碎"],
      ["打印时间", formatOrderDateTime("2026-01-02T00:00:00Z")],
      ["回传平台发货时间", formatOrderDateTime("2026-01-03T00:00:00Z")],
      ["异常审核时间", formatOrderDateTime("2026-01-04T00:00:00Z")],
      ["平台指定交运时间", formatOrderDateTime("2026-01-05T00:00:00Z")],
      ["平台指定拉取面单时间", formatOrderDateTime("2026-01-06T00:00:00Z")],
      ["订单发货期限", formatOrderDateTime("2026-01-07T00:00:00Z")],
      ["作废时间", formatOrderDateTime("2026-01-08T00:00:00Z")],
      ["交运时间", formatOrderDateTime("2026-01-09T00:00:00Z")],
      ["签收时间", formatOrderDateTime("2026-01-10T00:00:00Z")],
    ]) {
      expect(screen.getByRole("columnheader", { name: heading })).toBeTruthy();
      expect(screen.getByRole("cell", { name: value })).toBeTruthy();
    }
    expect(window.localStorage.getItem("xz.erp.orders.visibleColumns.v1"))
      .toBe(JSON.stringify([
        "placedAt",
        "warehouse",
        "location",
        "picker",
        "shipper",
        "purchaser",
        "developer",
        "totalAmount",
        "skuSummary",
        "salesRecordNumber",
        "shoppingCartReference",
        "customOrderReference",
        "trackingReference",
        "secondaryTrackingReference",
        "actualPaid",
        "profit",
        "actualShipping",
        "itemAmount",
        "platformFee",
        "insuranceFee",
        "paymentFee",
        "otherIncome",
        "otherExpense",
        "tax",
        "estimatedShipping",
        "salesperson",
        "manager",
        "orderRemark",
        "customerCategory",
        "productKindCount",
        "supplierReference",
        "parentProductCategory",
        "childProductCategory",
        "productStatus",
        "extendedAttribute",
        "printedAt",
        "platformReturnedAt",
        "exceptionReviewedAt",
        "platformSpecifiedHandoverAt",
        "platformLabelRequestedAt",
        "deliveryDeadlineAt",
        "cancelledAt",
        "handedOverAt",
        "deliveredAt",
      ]));
  });

  it("shows tenant-scoped transfer history only with transfer read permission", async () => {
    runtime.hasPermission.mockImplementation(
      (permission) =>
        permission === "orders.read" || permission === "orders.transfer.read",
    );
    runtime.listTransfers.mockResolvedValue({
      items: [{
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        jobType: "EXPORT",
        status: "SUCCEEDED",
        requestedCount: 2,
        succeededCount: 2,
        failedCount: 0,
        version: 0,
        createdAt: "2026-07-30T00:00:00Z",
        completedAt: "2026-07-30T00:00:01Z",
      }],
      page: 0,
      size: 20,
      totalElements: 21,
      totalPages: 2,
    });
    render(<OrderCenterPage />);

    const transferSummary = await screen.findByText(
      "导入导出与批处理记录",
    );
    fireEvent.click(transferSummary);
    const transferPanel = transferSummary.closest("details")!;
    expect(await screen.findByText("订单导出")).toBeTruthy();
    expect(screen.getByText("成功")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "导出订单明细（当前筛选）" }),
    ).toBeNull();
    expect(runtime.listTransfers).toHaveBeenCalledWith(0, 20);
    fireEvent.click(
      within(transferPanel).getByRole("button", { name: "下一页" }),
    );
    await waitFor(() =>
      expect(runtime.listTransfers).toHaveBeenLastCalledWith(1, 20),
    );
    fireEvent.change(
      within(transferPanel).getByLabelText("批处理记录分页每页条数"),
      { target: { value: "50" } },
    );
    await waitFor(() =>
      expect(runtime.listTransfers).toHaveBeenLastCalledWith(0, 50),
    );
  });

  it("does not let a late filtered-list response replace the newer result", async () => {
    const first = deferred<ReturnType<typeof page>>();
    const second = deferred<ReturnType<typeof page>>();
    runtime.list
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const { rerender } = render(<OrderCenterPage />);
    runtime.search = "?keyword=latest";
    rerender(<OrderCenterPage />);

    second.resolve(page([order({ externalOrderRef: "ORDER-LATEST" })]));
    await screen.findByText("ORDER-LATEST");
    first.resolve(page([order({ externalOrderRef: "ORDER-STALE" })]));

    await waitFor(() => expect(screen.queryByText("ORDER-STALE")).toBeNull());
    expect(screen.getByText("ORDER-LATEST")).not.toBeNull();
  });

  it("loads detail only after Details and exposes safe detail failure", async () => {
    render(<OrderCenterPage />);
    await screen.findByRole("button", { name: "查看详情" });
    expect(runtime.get).not.toHaveBeenCalled();

    const pending = deferred<ReturnType<typeof detail>>();
    runtime.get.mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole("button", { name: "查看详情" }));
    render(<OrderDetailPage orderId={orderId} />);

    expect(screen.getByText("正在加载订单详情…")).not.toBeNull();
    pending.reject(new ApiError("secret", { status: 403 }));

    await screen.findByRole("alert");
    expect(runtime.get).toHaveBeenCalledWith(orderId);
    expect(screen.getByRole("alert").textContent).toContain(
      "无操作权限，当前会话保持有效。",
    );
    expect(screen.getByRole("alert").textContent).not.toContain("secret");
    fireEvent.click(screen.getByRole("button", { name: "重试加载详情" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("ORDER-001");
    expect(runtime.get).toHaveBeenCalledTimes(2);
  });

  it("does not show or invoke writes without orders.write", async () => {
    runtime.get.mockResolvedValue(detail({
      externalOrderRef: "gid://shopify/Order/100",
    }));
    render(<OrderCenterPage />);
    await openDetails();

    expect(screen.queryByLabelText("目标状态")).toBeNull();
    expect(screen.queryByRole("button", { name: "确认变更" })).toBeNull();
    expect(screen.queryByText("写回 Shopify 收货地址")).toBeNull();
    expect(runtime.changeStatus).not.toHaveBeenCalled();
    expect(runtime.updateShopifyShippingAddress).not.toHaveBeenCalled();
  });

  it("writes a Shopify address using current order and profile versions", async () => {
    runtime.hasPermission.mockImplementation(
      (permission) =>
        permission === "orders.read" || permission === "orders.write",
    );
    runtime.get.mockResolvedValue(detail({
      externalOrderRef: "gid://shopify/Order/100",
      countryCode: "US",
      province: "NY",
      postalCode: "10001",
      version: 7,
      profile: {
        version: 3,
        recipientName: "Ada Lovelace",
        recipientCompany: "XZ",
        recipientPhone: "+1 555 0100",
        addressLine1: "1 Main St",
        addressLine2: "Suite 2",
        city: "New York",
      },
    }));
    runtime.updateShopifyShippingAddress.mockResolvedValue({
      order: detail({
        externalOrderRef: "gid://shopify/Order/100",
        version: 8,
        countryCode: "US",
        province: "NY",
        postalCode: "10002",
        profile: { version: 4, addressLine1: "2 Main St" },
      }),
      synchronizedAt: "2026-07-31T04:05:06Z",
      replayed: false,
    });
    render(<OrderCenterPage />);
    await openDetails();

    fireEvent.click(screen.getByText("写回 Shopify 收货地址"));
    expect(screen.getByLabelText("Shopify 名")).toHaveProperty("value", "Ada");
    expect(screen.getByLabelText("Shopify 姓")).toHaveProperty("value", "Lovelace");
    fireEvent.change(screen.getByLabelText("Shopify 地址 1"), {
      target: { value: "2 Main St" },
    });
    fireEvent.change(screen.getByLabelText("Shopify 邮编"), {
      target: { value: "10002" },
    });
    fireEvent.click(screen.getByRole("button", { name: "写回 Shopify" }));

    await waitFor(() =>
      expect(runtime.updateShopifyShippingAddress).toHaveBeenCalledWith(
        orderId,
        {
          version: 7,
          profileVersion: 3,
          idempotencyKey: "web.aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          address: {
            firstName: "Ada",
            lastName: "Lovelace",
            company: "XZ",
            address1: "2 Main St",
            address2: "Suite 2",
            city: "New York",
            provinceCode: "NY",
            countryCode: "US",
            zip: "10002",
            phone: "+1 555 0100",
          },
        },
      ),
    );
    expect(window.confirm).toHaveBeenCalledWith(
      "确认将当前收货地址直接写回 Shopify 订单？",
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "收货地址已写回 Shopify",
    );
  });

  it("edits a mapped Shopify line quantity with the dedicated permission", async () => {
    runtime.hasPermission.mockImplementation(
      (permission) =>
        permission === "orders.read" ||
        permission === "orders.shopify_edit.write",
    );
    const shopifyDetail = detail({
      externalOrderRef: "gid://shopify/Order/100",
      totalAmountMinor: 2198,
      lines: [{
        ...detail().lines[0],
        externalLineRef: "gid://shopify/LineItem/200",
        externalVariantRef: "gid://shopify/ProductVariant/300",
        quantity: 2,
      }],
    });
    runtime.get.mockResolvedValue(shopifyDetail);
    runtime.updateShopifyLineQuantity.mockResolvedValue({
      order: {
        ...shopifyDetail,
        totalAmountMinor: 1099,
        lines: [{ ...shopifyDetail.lines[0], quantity: 1 }],
      },
      recoveredFromShopify: false,
      replayed: false,
      totalAmountMinor: 1099,
      currency: "USD",
      synchronizedAt: "2026-07-31T05:06:07Z",
    });
    render(<OrderCenterPage />);
    await openDetails();

    fireEvent.click(screen.getByRole("button", { name: "编辑数量" }));
    fireEvent.change(screen.getByLabelText("新数量"), {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByLabelText("减少的数量退回库存"));
    fireEvent.click(screen.getByRole("button", { name: "确认修改" }));

    await waitFor(() => expect(runtime.updateShopifyLineQuantity)
      .toHaveBeenCalledTimes(1));
    expect(runtime.updateShopifyLineQuantity).toHaveBeenCalledWith(
      orderId,
      expect.objectContaining({
        lineId,
        expectedQuantity: 2,
        quantity: 1,
        restock: true,
        notifyCustomer: true,
      }),
    );
    expect(window.confirm).toHaveBeenCalledWith(
      "确认将 Shopify 商品数量从 2 改为 1？订单总额和付款差额可能随之变化。",
    );
  });

  it("adds an active mapped Shopify variant with explicit confirmation", async () => {
    runtime.hasPermission.mockImplementation(
      (permission) =>
        permission === "orders.read" ||
        permission === "orders.shopify_edit.write" ||
        permission === "products.listing.read",
    );
    runtime.get.mockResolvedValue(detail({
      externalOrderRef: "gid://shopify/Order/100",
      lines: [{
        ...detail().lines[0],
        externalLineRef: "gid://shopify/LineItem/201",
        externalVariantRef: "gid://shopify/ProductVariant/301",
      }],
    }));
    render(<OrderCenterPage />);
    await openDetails();

    fireEvent.click(screen.getByRole("button", {
      name: "新增 Shopify 商品",
    }));
    await waitFor(() => expect(runtime.listListings).toHaveBeenCalledTimes(1), {
      timeout: 3_000,
    });
    const candidate = await screen.findByRole("radio", {
      name: "选择 SKU-RED",
    }, { timeout: 3_000 });
    fireEvent.click(candidate);
    fireEvent.change(screen.getByLabelText("数量"), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认新增" }));

    await waitFor(() => expect(runtime.addShopifyOrderVariant)
      .toHaveBeenCalledTimes(1));
    expect(runtime.listListings).toHaveBeenCalledWith({
      shopId,
      status: "ACTIVE",
      keyword: undefined,
      searchField: "ALL",
      page: 0,
      size: 20,
    });
    expect(runtime.addShopifyOrderVariant).toHaveBeenCalledWith(
      orderId,
      expect.objectContaining({
        listingId: "88888888-8888-4888-8888-888888888888",
        quantity: 2,
        notifyCustomer: true,
      }),
    );
    expect(window.confirm).toHaveBeenCalledWith(
      "确认向 Shopify 订单新增 SKU-RED × 2？订单总额和待收款可能随之增加。",
    );
  });

  it("adds a Shopify custom amount item with explicit financial confirmation", async () => {
    runtime.hasPermission.mockImplementation(
      (permission) =>
        permission === "orders.read" ||
        permission === "orders.shopify_edit.write",
    );
    runtime.get.mockResolvedValue(detail({
      externalOrderRef: "gid://shopify/Order/100",
      currency: "USD",
    }));
    render(<OrderCenterPage />);
    await openDetails();

    fireEvent.click(screen.getByRole("button", {
      name: "新增自定义金额",
    }));
    fireEvent.change(screen.getByLabelText("名称"), {
      target: { value: "Gift wrapping" },
    });
    fireEvent.change(screen.getByLabelText("单价（USD）"), {
      target: { value: "12.50" },
    });
    fireEvent.change(screen.getByLabelText("数量"), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认新增" }));

    await waitFor(() => expect(runtime.addShopifyOrderCustomItem)
      .toHaveBeenCalledTimes(1));
    expect(runtime.addShopifyOrderCustomItem).toHaveBeenCalledWith(
      orderId,
      expect.objectContaining({
        title: "Gift wrapping",
        unitPriceMinor: 1250,
        quantity: 2,
        requiresShipping: false,
        taxable: true,
        notifyCustomer: true,
      }),
    );
    expect(window.confirm).toHaveBeenCalledWith(
      "确认向 Shopify 订单新增“Gift wrapping” × 2？订单总额和待收款可能随之变化。",
    );
  });

  it("adds a fixed Shopify line discount with explicit confirmation", async () => {
    runtime.hasPermission.mockImplementation(
      (permission) =>
        permission === "orders.read" ||
        permission === "orders.shopify_edit.write",
    );
    runtime.get.mockResolvedValue(detail({
      externalOrderRef: "gid://shopify/Order/100",
      currency: "USD",
      lines: [{
        ...detail().lines[0],
        externalLineRef: "gid://shopify/LineItem/200",
        externalListingRef: "gid://shopify/Product/300",
        externalVariantRef: "gid://shopify/ProductVariant/400",
      }],
    }));
    render(<OrderCenterPage />);
    await openDetails();

    fireEvent.click(screen.getByRole("button", { name: "添加折扣" }));
    fireEvent.change(screen.getByLabelText("折扣说明"), {
      target: { value: "VIP adjustment" },
    });
    fireEvent.change(screen.getByLabelText("折扣金额（USD）"), {
      target: { value: "5.00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认添加折扣" }));

    await waitFor(() => expect(runtime.addShopifyOrderLineDiscount)
      .toHaveBeenCalledTimes(1));
    expect(runtime.addShopifyOrderLineDiscount).toHaveBeenCalledWith(
      orderId,
      expect.objectContaining({
        lineId,
        description: "VIP adjustment",
        discountType: "FIXED",
        fixedValueMinor: 500,
        notifyCustomer: true,
      }),
    );
    expect(window.confirm).toHaveBeenCalledWith(
      "确认向“Widget”添加 $5.00 折扣？订单总额和待收款可能随之变化。",
    );
  });

  it("cancels a Shopify order only after irreversible acknowledgement", async () => {
    runtime.hasPermission.mockImplementation(
      (permission) => permission === "orders.read" ||
        permission === "orders.shopify_edit.write",
    );
    runtime.get.mockResolvedValue(detail({
      externalOrderRef: "gid://shopify/Order/100",
      status: "RECEIVED",
    }));
    render(<OrderCenterPage />);
    await openDetails();

    fireEvent.click(screen.getByRole("button", {
      name: "取消 Shopify 平台订单",
    }));
    const submit = screen.getByRole("button", { name: "确认永久取消" });
    expect(submit.hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("内部备注"), {
      target: { value: "Buyer requested" },
    });
    fireEvent.click(screen.getByLabelText(
      "我已确认该操作不可撤销，并已核对退款和库存选项",
    ));
    fireEvent.click(submit);

    await waitFor(() => expect(runtime.cancelShopifyOrder)
      .toHaveBeenCalledTimes(1));
    expect(runtime.cancelShopifyOrder).toHaveBeenCalledWith(
      orderId,
      expect.objectContaining({
        reason: "CUSTOMER",
        staffNote: "Buyer requested",
        refundOriginalPaymentMethods: true,
        restock: true,
        notifyCustomer: true,
      }),
    );
    expect(window.confirm).toHaveBeenCalledWith(
      "确认取消 Shopify 平台订单？此操作不可撤销，并可能退款、回补库存及通知买家。",
    );
  });

  it("locks Shopify address writes after fulfillment starts", async () => {
    runtime.hasPermission.mockImplementation(
      (permission) =>
        permission === "orders.read" || permission === "orders.write",
    );
    runtime.get.mockResolvedValue(detail({
      externalOrderRef: "gid://shopify/Order/100",
      status: "FULFILLING",
      countryCode: "US",
      profile: {
        version: 3,
        addressLine1: "1 Main St",
        city: "New York",
      },
    }));
    render(<OrderCenterPage />);
    await openDetails();

    fireEvent.click(screen.getByText("写回 Shopify 收货地址"));
    expect(screen.getByRole("status").textContent).toContain(
      "不能再修改平台收货地址",
    );
    expect(screen.getByRole("button", { name: "写回 Shopify" })
      .hasAttribute("disabled")).toBe(true);
    expect(runtime.updateShopifyShippingAddress).not.toHaveBeenCalled();
  });

  it("shows only legal targets and validates HOLD reasons", async () => {
    runtime.hasPermission.mockImplementation(
      (permission) =>
        permission === "orders.read" || permission === "orders.write",
    );
    render(<OrderCenterPage />);
    await openDetails();

    const target = screen.getByLabelText("目标状态");
    const targetValues = Array.from((target as HTMLSelectElement).options).map(
      (option) => option.value,
    );
    expect(targetValues).toContain("HOLD");
    expect(targetValues).not.toContain("RECEIVED");

    fireEvent.change(target, { target: { value: "HOLD" } });
    fireEvent.click(screen.getByRole("button", { name: "确认变更" }));
    expect(screen.getByRole("alert").textContent).toContain(
      "挂起订单时必须填写原因。",
    );
    expect(runtime.changeStatus).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("挂起原因"), {
      target: { value: "review" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认变更" }));
    await waitFor(() => expect(runtime.changeStatus).toHaveBeenCalledOnce());
    expect(runtime.changeStatus).toHaveBeenLastCalledWith(orderId, {
      version: 1,
      targetStatus: "HOLD",
      reason: "review",
    });
  });

  it("cancels without carrying a stale HOLD reason", async () => {
    runtime.hasPermission.mockImplementation(
      (permission) =>
        permission === "orders.read" || permission === "orders.write",
    );
    runtime.changeStatus.mockResolvedValue(
      detail({ status: "CANCELLED", version: 2 }),
    );
    render(<OrderCenterPage />);
    await openDetails();

    const target = screen.getByLabelText("目标状态");
    fireEvent.change(target, { target: { value: "HOLD" } });
    fireEvent.change(screen.getByLabelText("挂起原因"), {
      target: { value: "must not leak into cancellation" },
    });

    fireEvent.change(target, { target: { value: "CANCELLED" } });
    expect(screen.queryByLabelText("挂起原因")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "确认变更" }));

    await waitFor(() => expect(runtime.changeStatus).toHaveBeenCalledOnce());
    expect(runtime.changeStatus).toHaveBeenCalledWith(orderId, {
      version: 1,
      targetStatus: "CANCELLED",
      reason: undefined,
    });
  });

  it("confirms READY, disables duplicate submission, and retains a 409 context", async () => {
    runtime.hasPermission.mockImplementation(
      (permission) =>
        permission === "orders.read" || permission === "orders.write",
    );
    runtime.get.mockResolvedValue(detail({ status: "REVIEW_PENDING" }));
    const pending = deferred<ReturnType<typeof detail>>();
    runtime.changeStatus.mockReturnValueOnce(pending.promise);
    render(<OrderCenterPage />);
    await openDetails();

    fireEvent.change(screen.getByLabelText("目标状态"), {
      target: { value: "READY_TO_FULFILL" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认变更" }));
    fireEvent.click(screen.getByRole("button", { name: "正在提交…" }));
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(runtime.changeStatus).toHaveBeenCalledOnce();

    pending.reject(new ApiError("version secret", { status: 409 }));
    await screen.findByRole("alert");
    expect(screen.getByRole("dialog")).not.toBeNull();
    expect(
      (screen.getByLabelText("目标状态") as HTMLSelectElement).value,
    ).toBe("READY_TO_FULFILL");
    expect(screen.getByRole("alert").textContent).toContain(
      "订单资料已更新，请刷新后重试。",
    );
  });

  it("updates the shared detail after a successful state change", async () => {
    runtime.hasPermission.mockImplementation(
      (permission) =>
        permission === "orders.read" || permission === "orders.write",
    );
    runtime.changeStatus.mockResolvedValue(
      detail({ status: "HOLD", version: 2 }),
    );
    render(<OrderCenterPage />);
    await openDetails();

    fireEvent.change(screen.getByLabelText("目标状态"), {
      target: { value: "HOLD" },
    });
    fireEvent.change(screen.getByLabelText("挂起原因"), {
      target: { value: "review" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认变更" }));

    await waitFor(() =>
      expect(screen.getByRole("dialog").textContent).toContain("已挂起"),
    );
  });

  it("traps focus and returns to the list on Escape", async () => {
    runtime.hasPermission.mockImplementation(
      (permission) =>
        permission === "orders.read" || permission === "orders.write",
    );
    render(<OrderCenterPage />);
    await screen.findByRole("button", { name: "查看详情" });
    const dialog = await openDetails();
    const close = screen.getByRole("button", { name: "关闭" });

    await waitFor(() => expect(document.activeElement).toBe(close));
    const target = screen.getByLabelText("目标状态");
    target.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(target);
    fireEvent.keyDown(dialog, { key: "Escape" });

    await waitFor(() =>
      expect(runtime.pushes).toContain(`/orders?page=0`),
    );
  });

  it("groups archived order detail fields into a compact workbench", async () => {
    render(<OrderCenterPage />);
    await openDetails();

    expect(
      screen.getByRole("heading", { name: "订单信息" }),
    ).not.toBeNull();
    expect(
      screen.getByRole("heading", { name: "商品信息" }),
    ).not.toBeNull();
    expect(screen.getByText("共 1 条明细")).not.toBeNull();
    expect(
      screen.getByText("收件人、地址与物流资料"),
    ).not.toBeNull();
    expect(screen.getByText("操作日志（0）")).not.toBeNull();
  });

  it("presents packaging inspection and weighing as fulfillment stages", async () => {
    runtime.hasPermission.mockImplementation(
      (permission) => [
        "orders.read",
        "fulfillments.read",
        "fulfillments.ship.write",
      ].includes(permission),
    );
    runtime.get.mockResolvedValue(detail({ status: "FULFILLING" }));
    render(<OrderCenterPage />);
    await openDetails();

    expect(
      await screen.findByText("配货、包装验货与称重出库"),
    ).not.toBeNull();
    expect(await screen.findByText("包装验货中")).not.toBeNull();
    expect(screen.getByText("无缺货")).not.toBeNull();
    expect(
      screen.getByRole("heading", { name: "履约明细" }),
    ).not.toBeNull();
    expect(
      screen.getByRole("heading", { name: "包裹与称重出库" }),
    ).not.toBeNull();
    expect(screen.getByText(/待称重出库 · 仓库/)).not.toBeNull();
    expect(screen.getByRole("heading", { name: "称重校验" })).not.toBeNull();
    expect(screen.getByText(/预期重量：500 克/)).not.toBeNull();
  });

  it("books, synchronizes, and hands over a provider shipment from the package", async () => {
    runtime.hasPermission.mockImplementation(
      (permission) => [
        "orders.read",
        "fulfillments.read",
        "fulfillments.ship.write",
      ].includes(permission),
    );
    const packageId = fulfillmentPlan().packages[0].id;
    const authorizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const channelId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const readyPackage = {
      ...fulfillmentPlan().packages[0],
      weightGrams: 500,
      weighingStatus: "PASSED",
      logisticsBookingStatus: "NOT_REQUESTED",
      logisticsProviderHandoverPending: false,
    };
    const bookedPackage = {
      ...readyPackage,
      version: 2,
      carrierCode: "HUALEI",
      serviceCode: "US-LINE",
      trackingReference: "HL10001",
      logisticsAuthorizationId: authorizationId,
      logisticsChannelId: channelId,
      logisticsProviderCode: "HUALEI",
      logisticsProviderName: "嘉运晟途",
      logisticsAccountLabel: "默认货代",
      logisticsChannelName: "美国专线",
      logisticsClientReference: "ERP-PACKAGE",
      logisticsProviderOrderReference: "HL-ORDER-1",
      logisticsLabelUrl: "https://label.example/HL-ORDER-1.pdf",
      logisticsBookingStatus: "BOOKED",
      logisticsTrackingStatus: "IN_TRANSIT",
      logisticsTrackingSummary: "运输中",
      logisticsLastSyncedAt: "2026-08-14T02:00:00Z",
      logisticsProviderHandoverPending: false,
    };
    const readyPlan = fulfillmentPlan({ packages: [readyPackage] });
    const bookedPlan = fulfillmentPlan({ packages: [bookedPackage] });
    runtime.get.mockResolvedValue(detail({ status: "FULFILLING" }));
    runtime.getFulfillmentPlanByOrder.mockResolvedValue(readyPlan);
    runtime.listEnabledLogisticsChannels.mockResolvedValue([{
      id: channelId,
      authorizationId,
      providerCode: "HUALEI",
      providerName: "嘉运晟途",
      accountLabel: "默认货代",
      accountStatus: "ACTIVE",
      channelCode: "US-LINE",
      channelName: "美国专线",
      enabled: true,
      providerAvailable: true,
      effectiveEnabled: true,
      version: 1,
      lastSyncedAt: "2026-08-14T01:00:00Z",
      updatedAt: "2026-08-14T01:00:00Z",
    }]);
    runtime.bookLogisticsShipment.mockResolvedValue(bookedPlan);
    runtime.syncLogisticsShipment.mockResolvedValue(bookedPlan);
    runtime.handoverBookedLogisticsShipment.mockResolvedValue(
      fulfillmentPlan({
        status: "SHIPPED",
        packages: [{
          ...bookedPackage,
          status: "HANDED_OVER",
          handedOverAt: "2026-08-14T02:05:00Z",
        }],
      }),
    );
    render(<OrderCenterPage />);
    await openDetails();

    expect(await screen.findByRole("combobox", { name: "物流渠道" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "获取运单" }));
    await waitFor(() => expect(runtime.bookLogisticsShipment).toHaveBeenCalledWith(
      readyPlan.id,
      packageId,
      {
        packageVersion: readyPackage.version,
        authorizationId,
        channelId,
        idempotencyKey: `web.logistics-booking.${packageId}`,
      },
    ));
    expect(await screen.findByText("HL10001")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "同步物流信息" }));
    await waitFor(() => expect(runtime.syncLogisticsShipment)
      .toHaveBeenCalledWith(readyPlan.id, packageId));

    fireEvent.click(screen.getByRole("button", { name: "确认交运并发货" }));
    await waitFor(() => expect(runtime.handoverBookedLogisticsShipment)
      .toHaveBeenCalledWith(
        readyPlan.id,
        packageId,
        expect.objectContaining({
          version: readyPlan.version,
          packageVersion: bookedPackage.version,
          commandId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        }),
      ));
  });

  it("publishes a handed-over Shopify package with stable recovery inputs", async () => {
    runtime.hasPermission.mockImplementation(
      (permission) => [
        "orders.read",
        "fulfillments.read",
        "fulfillments.ship.write",
      ].includes(permission),
    );
    const handedOverPackage = {
      ...fulfillmentPlan().packages[0],
      status: "HANDED_OVER",
      carrierCode: "UPS",
      serviceCode: "GROUND",
      trackingReference: "1Z123",
      handedOverAt: "2026-07-31T02:00:00Z",
      shopifyPublicationStatus: "NOT_PUBLISHED",
    };
    const publishedPackage = {
      ...handedOverPackage,
      shopifyPublicationStatus: "PUBLISHED",
      shopifyNotifyCustomer: true,
      shopifyTrackingUrl: "https://track.example/1Z123",
      externalShopifyFulfillmentRef: "gid://shopify/Fulfillment/50",
      shopifyPublishedAt: "2026-07-31T02:05:00Z",
    };
    runtime.get.mockResolvedValue(detail({
      status: "FULFILLING",
      externalOrderRef: "gid://shopify/Order/100",
    }));
    runtime.getFulfillmentPlanByOrder.mockResolvedValue(fulfillmentPlan({
      packages: [handedOverPackage],
    }));
    runtime.publishShopifyFulfillment.mockResolvedValue({
      plan: fulfillmentPlan({ packages: [publishedPackage] }),
      externalFulfillmentRef: "gid://shopify/Fulfillment/50",
      recoveredFromShopify: false,
      publishedAt: "2026-07-31T02:05:00Z",
      replayed: false,
    });
    render(<OrderCenterPage />);
    await openDetails();

    fireEvent.change(
      await screen.findByLabelText("Shopify 物流查询链接（可选）"),
      { target: { value: "https://track.example/1Z123" } },
    );
    fireEvent.click(screen.getByRole("button", {
      name: "回传 Shopify 发货",
    }));

    await waitFor(() => expect(
      runtime.publishShopifyFulfillment,
    ).toHaveBeenCalledWith(
      fulfillmentPlan().id,
      handedOverPackage.id,
      {
        idempotencyKey:
          `web.shopify-fulfillment.${handedOverPackage.id}`,
        notifyCustomer: true,
        trackingUrl: "https://track.example/1Z123",
      },
    ));
    expect(await screen.findByText(
      /gid:\/\/shopify\/Fulfillment\/50/,
    )).not.toBeNull();
    expect(screen.queryByRole("button", {
      name: "回传 Shopify 发货",
    })).toBeNull();
  });

  it("keeps published Shopify packages immutable in the UI", async () => {
    runtime.hasPermission.mockImplementation(
      (permission) => [
        "orders.read",
        "fulfillments.read",
        "fulfillments.ship.write",
        "fulfillments.ship.correct.write",
      ].includes(permission),
    );
    runtime.get.mockResolvedValue(detail({
      status: "FULFILLING",
      externalOrderRef: "gid://shopify/Order/100",
    }));
    runtime.getFulfillmentPlanByOrder.mockResolvedValue(fulfillmentPlan({
      packages: [{
        ...fulfillmentPlan().packages[0],
        status: "HANDED_OVER",
        carrierCode: "UPS",
        trackingReference: "1Z123",
        shopifyPublicationStatus: "PUBLISHED",
        shopifyNotifyCustomer: true,
        shopifyTrackingUrl: "https://track.example/1Z123",
        externalShopifyFulfillmentRef: "gid://shopify/Fulfillment/50",
        shopifyPublishedAt: "2026-07-31T02:05:00Z",
      }],
    }));
    render(<OrderCenterPage />);
    await openDetails();

    expect(await screen.findByText(
      /gid:\/\/shopify\/Fulfillment\/50/,
    )).not.toBeNull();
    expect(screen.queryByRole("button", {
      name: "冲销错误发货事实",
    })).toBeNull();
  });

  it("reuses persisted Shopify publication options after an uncertain result", async () => {
    runtime.hasPermission.mockImplementation(
      (permission) => [
        "orders.read",
        "fulfillments.read",
        "fulfillments.ship.write",
      ].includes(permission),
    );
    const uncertainPackage = {
      ...fulfillmentPlan().packages[0],
      status: "HANDED_OVER",
      carrierCode: "UPS",
      trackingReference: "1Z123",
      shopifyPublicationStatus: "UNCERTAIN",
      shopifyNotifyCustomer: false,
      shopifyTrackingUrl: "https://track.example/1Z123",
    };
    runtime.get.mockResolvedValue(detail({
      status: "FULFILLING",
      externalOrderRef: "gid://shopify/Order/100",
    }));
    runtime.getFulfillmentPlanByOrder.mockResolvedValue(fulfillmentPlan({
      packages: [uncertainPackage],
    }));
    render(<OrderCenterPage />);
    await openDetails();

    const trackingUrl = await screen.findByLabelText<HTMLInputElement>(
      "Shopify 物流查询链接（可选）",
    );
    const notifyCustomer = screen.getByLabelText<HTMLInputElement>(
      "通知 Shopify 客户",
    );
    expect(trackingUrl.value).toBe("https://track.example/1Z123");
    expect(trackingUrl.disabled).toBe(true);
    expect(notifyCustomer.checked).toBe(false);
    expect(notifyCustomer.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", {
      name: "核对并重试回传",
    }));

    await waitFor(() => expect(
      runtime.publishShopifyFulfillment,
    ).toHaveBeenCalledWith(
      fulfillmentPlan().id,
      uncertainPackage.id,
      {
        idempotencyKey:
          `web.shopify-fulfillment.${uncertainPackage.id}`,
        notifyCustomer: false,
        trackingUrl: "https://track.example/1Z123",
      },
    ));
  });

  it("shows match source and does not expose correction to read-only users", async () => {
    runtime.get.mockResolvedValue(
      detail({
        lines: [
          {
            ...detail().lines[0],
            skuId: undefined,
            skuMatchSource: "UNMATCHED",
          },
        ],
      }),
    );
    render(<OrderCenterPage />);
    await openDetails();

    expect(
      screen.getByText("匹配来源：未匹配（尚未匹配 SKU）"),
    ).not.toBeNull();
    expect(screen.queryByLabelText("搜索启用中的 SKU")).toBeNull();
    expect(runtime.listSkus).not.toHaveBeenCalled();
    expect(runtime.changeLineSkuMatch).not.toHaveBeenCalled();
  });

  it("explains the product-read requirement without querying SKU data", async () => {
    runtime.hasPermission.mockImplementation(
      (permission) =>
        permission === "orders.read" || permission === "orders.write",
    );
    render(<OrderCenterPage />);
    await openDetails();

    expect(
      screen.getByText("需要商品查看权限后才能匹配 SKU。"),
    ).not.toBeNull();
    expect(screen.queryByLabelText("搜索启用中的 SKU")).toBeNull();
    expect(runtime.listSkus).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "清除 SKU 匹配" }));
    await waitFor(() =>
      expect(runtime.changeLineSkuMatch).toHaveBeenCalledWith(orderId, lineId, {
        version: 1,
        skuId: null,
      }),
    );
  });

  it("searches active SKUs and writes the current detail version", async () => {
    runtime.hasPermission.mockImplementation(
      (permission) =>
        permission === "orders.read" ||
        permission === "orders.write" ||
        permission === "products.read",
    );
    render(<OrderCenterPage />);
    await openDetails();

    fireEvent.change(screen.getByLabelText("搜索启用中的 SKU"), {
      target: { value: "active" },
    });
    await screen.findByLabelText("选择 SKU");
    expect(runtime.listSkus).toHaveBeenCalledWith({
      keyword: "active",
      status: "ACTIVE",
      page: 0,
      size: 25,
    });

    fireEvent.change(screen.getByLabelText("选择 SKU"), {
      target: { value: "55555555-5555-4555-8555-555555555555" },
    });
    fireEvent.click(screen.getByRole("button", { name: "设置 SKU" }));
    await waitFor(() =>
      expect(runtime.changeLineSkuMatch).toHaveBeenCalledWith(orderId, lineId, {
        version: 1,
        skuId: "55555555-5555-4555-8555-555555555555",
      }),
    );
  });

  it("shows SKU search loading, empty, error, and ignores stale results", async () => {
    runtime.hasPermission.mockImplementation(
      (permission) =>
        permission === "orders.read" ||
        permission === "orders.write" ||
        permission === "products.read",
    );
    const first = deferred<{
      items: ReturnType<typeof detail>["lines"];
      page: number;
      size: number;
      totalElements: number;
      totalPages: number;
    }>();
    const second = deferred<{
      items: never[];
      page: number;
      size: number;
      totalElements: number;
      totalPages: number;
    }>();
    runtime.listSkus
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    render(<OrderCenterPage />);
    await openDetails();

    const search = screen.getByLabelText("搜索启用中的 SKU");
    fireEvent.change(search, { target: { value: "first" } });
    expect(screen.getByText("正在搜索 SKU…")).not.toBeNull();
    fireEvent.change(search, { target: { value: "second" } });
    second.resolve({
      items: [],
      page: 0,
      size: 25,
      totalElements: 0,
      totalPages: 0,
    });
    await screen.findByText("未找到启用中的 SKU。");
    first.resolve({
      items: [detail().lines[0]],
      page: 0,
      size: 25,
      totalElements: 1,
      totalPages: 1,
    });
    await waitFor(() =>
      expect(screen.queryByLabelText("选择 SKU")).toBeNull(),
    );

    runtime.listSkus.mockRejectedValueOnce(
      new ApiError("secret", { status: 403 }),
    );
    fireEvent.change(search, { target: { value: "error" } });
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toContain(
      "无操作权限",
    );
  });

  it("clears an old SKU choice immediately when the search changes", async () => {
    runtime.hasPermission.mockImplementation(
      (permission) =>
        permission === "orders.read" ||
        permission === "orders.write" ||
        permission === "products.read",
    );
    const first = deferred<{
      items: Array<{
        id: string;
        businessCode: string;
        name: string;
        status: string;
      }>;
      page: number;
      size: number;
      totalElements: number;
      totalPages: number;
    }>();
    const second = deferred<{
      items: never[];
      page: number;
      size: number;
      totalElements: number;
      totalPages: number;
    }>();
    runtime.listSkus
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    render(<OrderCenterPage />);
    await openDetails();

    const search = screen.getByLabelText("搜索启用中的 SKU");
    fireEvent.change(search, { target: { value: "first" } });
    first.resolve({
      items: [
        {
          id: "55555555-5555-4555-8555-555555555555",
          businessCode: "SKU-001",
          name: "First result",
          status: "ACTIVE",
        },
      ],
      page: 0,
      size: 25,
      totalElements: 1,
      totalPages: 1,
    });
    const choice = (await screen.findByLabelText(
      "选择 SKU",
    )) as HTMLSelectElement;
    fireEvent.change(choice, {
      target: { value: "55555555-5555-4555-8555-555555555555" },
    });
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "设置 SKU" })
        .disabled,
    ).toBe(false);

    fireEvent.change(search, { target: { value: "second" } });
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "设置 SKU" })
        .disabled,
    ).toBe(true);
    second.resolve({
      items: [],
      page: 0,
      size: 25,
      totalElements: 0,
      totalPages: 0,
    });
    await screen.findByText("未找到启用中的 SKU。");
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "设置 SKU" })
        .disabled,
    ).toBe(true);
  });

  it("confirms clears and preserves match context on 409 safely", async () => {
    runtime.hasPermission.mockImplementation(
      (permission) =>
        permission === "orders.read" ||
        permission === "orders.write" ||
        permission === "products.read",
    );
    runtime.changeLineSkuMatch.mockRejectedValueOnce(
      new ApiError("version secret", { status: 409 }),
    );
    render(<OrderCenterPage />);
    await openDetails();

    fireEvent.click(screen.getByRole("button", { name: "清除 SKU 匹配" }));
    expect(window.confirm).toHaveBeenCalledWith(
      "确认清除这条订单明细的 SKU 匹配吗？",
    );
    await screen.findByRole("alert");
    expect(runtime.changeLineSkuMatch).toHaveBeenCalledWith(orderId, lineId, {
      version: 1,
      skuId: null,
    });
    expect(screen.getByRole("dialog")).not.toBeNull();
    expect(screen.getByRole("alert").textContent).toContain(
      "订单资料已更新，请刷新后重试。",
    );
  });

  it("does not expose matcher controls for terminal orders", async () => {
    runtime.hasPermission.mockImplementation(
      (permission) =>
        permission === "orders.read" ||
        permission === "orders.write" ||
        permission === "products.read",
    );
    runtime.get.mockResolvedValue(detail({ status: "CANCELLED" }));
    render(<OrderCenterPage />);
    await openDetails();

    expect(screen.queryByLabelText("搜索启用中的 SKU")).toBeNull();
    expect(screen.queryByRole("button", { name: "清除 SKU 匹配" })).toBeNull();
  });

  it("keeps only legal targets and safely formats unusual minor-unit values", () => {
    expect(allowedTargets("CANCELLED")).toEqual([]);
    expect(formatMinor(99, "???")).toBe("99 ???");
    expect(
      safeOrderError(new ApiError("secret", { status: 403 })),
    ).not.toContain("secret");
    for (const conflict of [
      new ApiError("raw backend detail from code", {
        status: 409,
        code: "shopify_authorization_conflict",
      }),
      new ApiError("raw backend detail from details", {
        status: 409,
        details: { reason: "shopify_scope_missing", scope: "read_orders" },
      }),
    ]) {
      const shopifyScopeMessage = safeOrderError(conflict);
      expect(shopifyScopeMessage).toContain("订单权限不可用");
      expect(shopifyScopeMessage).not.toContain("write_orders");
      expect(shopifyScopeMessage).not.toContain(conflict.message);
    }
    const protectedDataMessage = safeOrderError(new ApiError(
      "provider raw secret",
      {
        status: 409,
        details: { reason: "shopify_protected_customer_data_required" },
      },
    ));
    expect(protectedDataMessage).toContain("受保护客户数据");
    expect(protectedDataMessage).toContain("姓名、地址、电话和邮箱");
    expect(protectedDataMessage).not.toContain("provider raw secret");
    expect(safeOrderError(new ApiError("raw fulfillment detail", {
      status: 409,
      details: { reason: "shopify_fulfillment_scope_missing" },
    }))).toContain("商家自管履约权限不可用");
    expect(safeOrderError(new ApiError("raw order edit detail", {
      status: 409,
      details: { scope: "write_order_edits" },
    }))).toContain("订单编辑权限不可用");
    expect(safeOrderError(new ApiError("raw quiet period", {
      status: 409,
      details: { reason: "order_pull_blackout", resumesAt: "06:00" },
    }))).toBe("当前处于订单拉取禁用时段，请于北京时间 06:00 后重试。");
    const ordinaryConflictMessage = safeOrderError(
      new ApiError("secret raw detail", { status: 409 }),
    );
    expect(ordinaryConflictMessage).toBe("订单资料已更新，请刷新后重试。");
    expect(ordinaryConflictMessage).not.toContain("secret raw detail");

    const uncertainFulfillmentMessage = safeOrderError(new ApiError(
      "provider raw secret",
      {
        status: 409,
        details: { reason: "shopify_fulfillment_uncertain" },
      },
    ));
    expect(uncertainFulfillmentMessage).toContain("核对并重试回传");
    expect(uncertainFulfillmentMessage).not.toContain("provider raw secret");
  });
});

describe("OrderDetailPage", () => {
  it("loads the same detail from a valid shared URL", async () => {
    render(<OrderDetailPage orderId={orderId} />);

    await screen.findByRole("dialog");
    expect(runtime.get).toHaveBeenCalledWith(orderId);
  });

  it("does not request an invalid order URL", async () => {
    render(<OrderDetailPage orderId="not-an-order-id" />);

    await screen.findByRole("alert");
    expect(runtime.get).not.toHaveBeenCalled();
  });

  it("retries a not-found detail without exposing the server error", async () => {
    runtime.get
      .mockRejectedValueOnce(new ApiError("internal detail", { status: 404 }))
      .mockResolvedValueOnce(detail());
    render(<OrderDetailPage orderId={orderId} />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toContain("internal detail");
    fireEvent.click(screen.getByRole("button", { name: "重试加载详情" }));

    await screen.findByRole("dialog");
    expect(runtime.get).toHaveBeenCalledTimes(2);
  });

  it("ignores an older detail response after the URL changes", async () => {
    const nextOrderId = "77777777-7777-4777-8777-777777777777";
    const first = deferred<ReturnType<typeof detail>>();
    const second = deferred<ReturnType<typeof detail>>();
    runtime.get.mockImplementation((id: string) =>
      id === orderId ? first.promise : second.promise,
    );
    const view = render(<OrderDetailPage orderId={orderId} />);
    view.rerender(<OrderDetailPage orderId={nextOrderId} />);

    second.resolve(detail({ id: nextOrderId, externalOrderRef: "ORDER-NEW" }));
    await screen.findByText("ORDER-NEW");
    first.resolve(detail({ externalOrderRef: "ORDER-OLD" }));

    await waitFor(() => expect(screen.queryByText("ORDER-OLD")).toBeNull());
    expect(screen.getByText("ORDER-NEW")).not.toBeNull();
  });

  it("restores the asynchronously reloaded order-list trigger and its context", async () => {
    const focusId = orderDetailTriggerId(orderId);
    runtime.search = `?page=2&shopId=${shopId}&status=HOLD&keyword=needle&returnFocus=${focusId}`;
    const detailView = render(<OrderDetailPage orderId={orderId} />);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    detailView.unmount();

    await waitFor(() =>
      expect(runtime.pushes).toContain(
        `/orders?page=2&shopId=${shopId}&status=HOLD&keyword=needle`,
      ),
    );
    const reloaded = deferred<ReturnType<typeof page>>();
    runtime.search = `?page=2&shopId=${shopId}&status=HOLD&keyword=needle`;
    runtime.list.mockReturnValueOnce(reloaded.promise);
    render(<OrderCenterPage />);
    expect(document.getElementById(focusId)).toBeNull();

    reloaded.resolve(page([order()]));
    const trigger = await screen.findByRole("button", { name: "查看详情" });
    expect(trigger.id).toBe(focusId);
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("uses line-grain queue trigger identities and restores the exact queue row", async () => {
    const secondLineId = "44444444-4444-4444-8444-444444444444";
    const focusId = queueOrderDetailTriggerId(orderId, secondLineId);
    runtime.search = `?view=queue&page=0&returnFocus=${focusId}`;
    const detailView = render(<OrderDetailPage orderId={orderId} />);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    detailView.unmount();

    runtime.search = "?view=queue&page=0";
    const reloaded = deferred<{
      items: Array<Record<string, unknown>>;
      page: number;
      size: number;
      totalElements: number;
      totalPages: number;
    }>();
    runtime.listSkuMatchQueue.mockReturnValueOnce(reloaded.promise);
    render(<OrderCenterPage />);
    reloaded.resolve({
      items: [
        {
          orderId,
          orderVersion: 1,
          orderStatus: "RECEIVED",
          shopId,
          externalOrderRef: "QUEUE-1",
          placedAt: "2026-01-01T00:00:00Z",
          lineId,
          externalLineRef: "LINE-1",
          titleSnapshot: "Widget 1",
          skuMatchSource: "UNMATCHED",
        },
        {
          orderId,
          orderVersion: 1,
          orderStatus: "RECEIVED",
          shopId,
          externalOrderRef: "QUEUE-1",
          placedAt: "2026-01-01T00:00:00Z",
          lineId: secondLineId,
          externalLineRef: "LINE-2",
          titleSnapshot: "Widget 2",
          skuMatchSource: "UNMATCHED",
        },
      ],
      page: 0,
      size: 25,
      totalElements: 2,
      totalPages: 1,
    });

    const triggers = await screen.findAllByRole("button", { name: "查看详情" });
    expect(new Set(triggers.map((trigger) => trigger.id)).size).toBe(2);
    expect(document.getElementById(focusId)).toBe(triggers[1]);
    await waitFor(() => expect(document.activeElement).toBe(triggers[1]));
  });

  it("uses the list heading as the direct-link focus fallback", async () => {
    runtime.search = "?page=0";
    const detailView = render(<OrderDetailPage orderId={orderId} />);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    detailView.unmount();

    render(<OrderCenterPage />);
    const heading = screen.getByRole("heading", { name: "订单列表" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });
});
