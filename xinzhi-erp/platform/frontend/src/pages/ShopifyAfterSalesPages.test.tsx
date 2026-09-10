import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  canWrite: true,
  listShops: vi.fn(),
  getChannels: vi.fn(),
  listReturns: vi.fn(),
  decideReturn: vi.fn(),
  previewRefund: vi.fn(),
  processRefund: vi.fn(),
  listDisputes: vi.fn(),
}));

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ hasPermission: () => runtime.canWrite }),
}));

vi.mock("../modules/shopCenterApi", () => ({
  shopCenterApi: { listShops: runtime.listShops, getChannels: runtime.getChannels },
}));

vi.mock("../modules/shopifyAfterSalesApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../modules/shopifyAfterSalesApi")>();
  return {
    ...actual,
    shopifyAfterSalesApi: {
      listReturns: runtime.listReturns,
      decideReturn: runtime.decideReturn,
      previewRefund: runtime.previewRefund,
      processRefund: runtime.processRefund,
      listDisputes: runtime.listDisputes,
    },
  };
});

import { ShopifyDisputePage, ShopifyReturnRefundPage } from "./ShopifyAfterSalesPages";

const shopId = "fa000000-0000-4000-8000-000000000003";
const returnRef = "gid://shopify/Return/10";
const lineRef = "gid://shopify/ReturnLineItem/20";
const moneyBag = {
  shopMoney: { amount: "12.00", currencyCode: "USD" },
  presentmentMoney: { amount: "12.00", currencyCode: "USD" },
};

function shops(items = [{ id: shopId, displayName: "测试店铺" }]) {
  return { page: 0, size: 200, totalPages: items.length ? 1 : 0, totalElements: items.length, items };
}

function returnPage(status: "REQUESTED" | "OPEN") {
  return {
    shopId,
    hasNextPage: false,
    fetchedAt: "2026-08-15T08:00:00Z",
    returns: [{
      externalReturnRef: returnRef,
      name: "Return #10",
      externalOrderRef: "gid://shopify/Order/1",
      orderName: "#1001",
      status,
      createdAt: "2026-08-15T07:00:00Z",
      totalQuantity: 1,
      lineItems: [{
        externalReturnLineRef: lineRef,
        externalFulfillmentLineRef: "gid://shopify/FulfillmentLineItem/3",
        externalOrderLineRef: "gid://shopify/LineItem/4",
        name: "测试商品",
        sku: "SKU-1",
        quantity: 1,
        processableQuantity: 1,
        processedQuantity: 0,
        refundableQuantity: 1,
        refundedQuantity: 0,
      }],
    }],
  };
}

beforeEach(() => {
  runtime.canWrite = true;
  runtime.listShops.mockResolvedValue(shops());
  runtime.listReturns.mockResolvedValue(returnPage("REQUESTED"));
  runtime.listDisputes.mockResolvedValue({
    shopId,
    hasNextPage: false,
    fetchedAt: "2026-08-15T08:00:00Z",
    disputes: [],
  });
  runtime.getChannels.mockResolvedValue({
    mode: "XZ_ERP_APP",
    shopify: { status: "CONNECTED" },
    shopifyScopes: [
      { scope: "write_returns", purpose: "退货处理", status: "GRANTED" },
      { scope: "write_orders", purpose: "订单读取与维护", status: "GRANTED" },
      { scope: "read_shopify_payments_disputes", purpose: "拒付读取", status: "GRANTED" },
    ],
    activity: [],
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ShopifyAfterSalesPages", () => {
  it("requires approval before refunding a requested return", async () => {
    render(<ShopifyReturnRefundPage />);

    expect(await screen.findByText("请先批准退货请求，再预览退款。")).not.toBeNull();
    expect(screen.getByRole("spinbutton", { name: "退款数量" }).matches(":disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "预览退款" }).matches(":disabled")).toBe(true);
  });

  it("blocks an expired refund preview before any irreversible request", async () => {
    runtime.listReturns.mockResolvedValue(returnPage("OPEN"));
    runtime.previewRefund.mockResolvedValue({
      externalReturnRef: returnRef,
      state: "REFUNDABLE",
      lineItems: [{ externalReturnLineRef: lineRef, quantity: 1 }],
      refundShipping: false,
      refundDuties: [],
      refundAmount: moneyBag,
      maximumRefundable: moneyBag,
      previewToken: "expired-preview",
      expiresAt: "2020-01-01T00:00:00Z",
      fetchedAt: "2019-12-31T23:50:00Z",
    });
    render(<ShopifyReturnRefundPage />);

    fireEvent.change(await screen.findByRole("spinbutton", { name: "退款数量" }), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "预览退款" }));
    await screen.findByText("Shopify 退款预览");
    fireEvent.click(screen.getByRole("button", { name: "确认退款" }));

    expect((await screen.findByRole("alert")).textContent).toContain("退款预览已过期");
    expect(runtime.processRefund).not.toHaveBeenCalled();
  });

  it("shows a complete empty state when no Shopify shop is connected", async () => {
    runtime.listShops.mockResolvedValue(shops([]));
    render(<ShopifyDisputePage />);

    await waitFor(() => expect(screen.getByText("暂无已连接的 Shopify 店铺。")).not.toBeNull());
    expect(runtime.listDisputes).not.toHaveBeenCalled();
  });

  it("shows business-safe permission guidance before provider reads", async () => {
    runtime.getChannels.mockResolvedValue({
      mode: "XZ_ERP_APP",
      shopify: { status: "CONNECTED" },
      shopifyScopes: [],
      activity: [],
    });

    const returns = render(<ShopifyReturnRefundPage />);
    expect(await screen.findByText(/Shopify 应用权限不足/)).not.toBeNull();
    expect(document.body.textContent).not.toContain("write_returns");
    expect(runtime.listReturns).not.toHaveBeenCalled();
    returns.unmount();

    render(<ShopifyDisputePage />);
    expect(await screen.findByText(/Shopify 应用权限不足/)).not.toBeNull();
    expect(document.body.textContent).not.toContain("read_shopify_payments_disputes");
    expect(runtime.listDisputes).not.toHaveBeenCalled();
  });

  it("shows dispute metadata and keeps evidence handling in Shopify Admin", async () => {
    runtime.listDisputes.mockResolvedValue({
      shopId,
      hasNextPage: false,
      fetchedAt: "2026-08-15T08:00:00Z",
      disputes: [{
        externalDisputeRef: "gid://shopify/ShopifyPaymentsDispute/1",
        externalOrderRef: "gid://shopify/Order/1",
        orderName: "#1001",
        status: "NEEDS_RESPONSE",
        type: "CHARGEBACK",
        reason: "FRAUDULENT",
        networkReasonCode: "4827",
        amount: { amount: "12.00", currencyCode: "USD" },
        initiatedAt: "2026-08-15T07:00:00Z",
        evidenceDueBy: "2026-08-20T07:00:00Z",
      }],
    });

    render(<ShopifyDisputePage />);

    expect(await screen.findByText("#1001")).not.toBeNull();
    expect(screen.getByText("12.00 USD")).not.toBeNull();
    expect(screen.getByText(/证据材料的查看、编辑和提交请在 Shopify Admin 中完成/)).not.toBeNull();
    expect(screen.queryByRole("button", { name: /证据/ })).toBeNull();
  });
});
