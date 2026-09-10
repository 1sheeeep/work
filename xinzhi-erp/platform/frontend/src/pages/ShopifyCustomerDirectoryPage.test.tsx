import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  listShops: vi.fn(),
  listPlatforms: vi.fn(),
  getChannels: vi.fn(),
  listCustomers: vi.fn(),
}));

vi.mock("../modules/shopCenterApi", () => ({
  shopCenterApi: {
    listShops: runtime.listShops,
    listPlatforms: runtime.listPlatforms,
    getChannels: runtime.getChannels,
  },
}));

vi.mock("../modules/shopifyCustomerApi", () => ({
  shopifyCustomerApi: { list: runtime.listCustomers },
}));

import { ShopifyCustomerDirectoryPage } from "./ShopifyCustomerDirectoryPage";

const shopId = "fa000000-0000-4000-8000-000000000003";

beforeEach(() => {
  runtime.listPlatforms.mockResolvedValue({
    page: 0,
    size: 200,
    totalPages: 1,
    totalElements: 1,
    items: [{ id: "shopify-platform", code: "SHOPIFY", displayName: "Shopify", status: "ACTIVE" }],
  });
  runtime.listShops.mockResolvedValue({
    page: 0,
    size: 200,
    totalPages: 1,
    totalElements: 1,
    items: [{ id: shopId, platformId: "shopify-platform", displayName: "测试店铺" }],
  });
  runtime.listCustomers.mockResolvedValue({
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
      defaultLocation: {
        city: "Austin",
        province: "Texas",
        country: "United States",
        countryCode: "US",
      },
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
  runtime.getChannels.mockResolvedValue({
    mode: "XZ_ERP_APP",
    shopify: { status: "CONNECTED" },
    shopifyScopes: [{ scope: "read_customers", purpose: "客户档案", status: "GRANTED" }],
    activity: [],
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ShopifyCustomerDirectoryPage", () => {
  it("shows customer, order context, and a real order search link", async () => {
    render(<ShopifyCustomerDirectoryPage />);

    expect(await screen.findAllByText("Mia Customer")).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "Shopify 客户目录" })).not.toBeNull();
    expect(screen.getByRole("combobox", { name: "店铺" })).not.toBeNull();
    expect(screen.getByRole("form", { name: "客户筛选" })).not.toBeNull();
    expect(screen.getByText("只读客户资料")).not.toBeNull();
    expect(screen.getByText("3 单")).not.toBeNull();
    expect(screen.getByText("邮箱已验证")).not.toBeNull();
    expect(screen.getByText("mia@example.com", { selector: "dd" }).parentElement?.classList.contains("customer-profile-email")).toBe(true);
    expect(screen.getByText("已支付")).not.toBeNull();
    expect(screen.getByText("已履约")).not.toBeNull();
    expect(screen.getByLabelText("客户目录摘要")).not.toBeNull();
    expect(screen.queryByText("VIP")).toBeNull();
    expect(screen.getByRole("link", { name: "查看相关订单" }).getAttribute("href"))
      .toBe("/orders?view=queue&page=0&keyword=%231009");
  });

  it("passes a user search term without inventing customer operations", async () => {
    render(<ShopifyCustomerDirectoryPage />);

    await screen.findAllByText("Mia Customer");
    fireEvent.change(screen.getByRole("textbox", { name: "客户关键词" }), {
      target: { value: "mia@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "查询" }));

    await waitFor(() => expect(runtime.listCustomers).toHaveBeenLastCalledWith(
      shopId,
      25,
      undefined,
      "mia@example.com",
    ));
    expect(screen.queryByRole("button", { name: /编辑|营销|导出|发消息|会话|工单/ })).toBeNull();
  });

  it("shows an actionable empty state when no shop is connected", async () => {
    runtime.listShops.mockResolvedValue({
      page: 0,
      size: 200,
      totalPages: 0,
      totalElements: 0,
      items: [],
    });

    render(<ShopifyCustomerDirectoryPage />);

    expect(await screen.findByText("暂无可用的 Shopify 店铺")).not.toBeNull();
    expect(runtime.listCustomers).not.toHaveBeenCalled();
  });

  it("does not expose active shops from another platform", async () => {
    runtime.listShops.mockResolvedValue({
      page: 0,
      size: 200,
      totalPages: 1,
      totalElements: 1,
      items: [{ id: "other-shop", platformId: "other-platform", displayName: "其他平台店铺" }],
    });

    render(<ShopifyCustomerDirectoryPage />);

    expect(await screen.findByText("暂无可用的 Shopify 店铺")).not.toBeNull();
    expect(screen.queryByText("其他平台店铺")).toBeNull();
    expect(runtime.listCustomers).not.toHaveBeenCalled();
  });

  it("shows business-safe permission guidance before contacting Shopify", async () => {
    runtime.getChannels.mockResolvedValue({
      mode: "XZ_ERP_APP",
      shopify: { status: "CONNECTED" },
      shopifyScopes: [{ scope: "read_customers", purpose: "客户档案", status: "MISSING" }],
      activity: [],
    });

    render(<ShopifyCustomerDirectoryPage />);

    expect(await screen.findByText(/Shopify 应用权限不足/)).not.toBeNull();
    expect(document.body.textContent).not.toContain("read_customers");
    expect(screen.getByText("当前店铺客户资料不可用")).not.toBeNull();
    expect(screen.queryByText("正在读取客户资料")).toBeNull();
    expect(runtime.listCustomers).not.toHaveBeenCalled();
  });
});
