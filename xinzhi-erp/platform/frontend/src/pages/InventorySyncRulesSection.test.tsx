import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shopCenterApi } from "../modules/shopCenterApi";
import { InventorySyncRulesSection } from "./InventorySyncRulesSection";

const platformId = "10000000-0000-4000-8000-000000000001";
const shopId = "20000000-0000-4000-8000-000000000001";
const warehouseId = "30000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.spyOn(shopCenterApi, "listPlatforms").mockResolvedValue({
    items: [{
      id: platformId,
      code: "SHOPIFY",
      displayName: "Shopify",
      status: "ACTIVE",
    }],
    page: 0,
    size: 200,
    totalElements: 1,
    totalPages: 1,
  });
  vi.spyOn(shopCenterApi, "listShops").mockResolvedValue({
    items: [{
      id: shopId,
      platformId,
      externalShopRef: "uat-shop.myshopify.com",
      displayName: "UAT 店铺",
      status: "ACTIVE",
      authorization: {
        status: "AUTHORIZED",
        credentialConfigured: true,
        scopes: ["read_locations", "read_inventory", "write_inventory"],
      },
      updatedAt: "2026-08-11T00:00:00Z",
    }],
    page: 0,
    size: 200,
    totalElements: 1,
    totalPages: 1,
  });
  vi.spyOn(shopCenterApi, "getShopifyLocationMappings").mockResolvedValue({
    locations: [{
      externalLocationRef: "gid://shopify/Location/1001",
      name: "Shopify UAT 地点",
      active: true,
      fulfillsOnlineOrders: true,
      hasActiveInventory: true,
      fulfillmentService: false,
      city: "深圳",
      countryCode: "CN",
      providerPresent: true,
    }],
    warehouses: [{
      id: warehouseId,
      businessCode: "UAT-MAIN",
      name: "UAT 主仓",
    }],
  });
  vi.spyOn(shopCenterApi, "upsertShopifyLocationMapping").mockResolvedValue({
    externalLocationRef: "gid://shopify/Location/1001",
    name: "Shopify UAT 地点",
    active: true,
    fulfillsOnlineOrders: true,
    hasActiveInventory: true,
    fulfillmentService: false,
    providerPresent: true,
    mapping: {
      mappingId: "40000000-0000-4000-8000-000000000001",
      warehouseId,
      businessCode: "UAT-MAIN",
      name: "UAT 主仓",
      status: "ACTIVE",
      version: 0,
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("inventory synchronization rules", () => {
  it("loads authorized Shopify shops and saves a real location mapping", async () => {
    const onShopChange = vi.fn();
    render(
      <InventorySyncRulesSection
        selectedShopId={shopId}
        canRead
        canWrite
        onShopChange={onShopChange}
      />,
    );

    expect(await screen.findByRole("heading", {
      name: "Shopify 地点与 ERP 仓库映射",
    })).toBeTruthy();
    expect((screen.getByLabelText("同步规则店铺") as HTMLSelectElement).value)
      .toBe(shopId);
    expect(screen.getByText("地点权限已授权")).toBeTruthy();
    expect(screen.getByRole("link", { name: "库存查询与发布" }).getAttribute("href"))
      .toBe(`/products/inventory-query?shopId=${shopId}`);

    fireEvent.change(
      screen.getByRole("combobox", {
        name: /Shopify UAT 地点.*ERP 仓库/,
      }),
      { target: { value: warehouseId } },
    );

    await waitFor(() => expect(
      shopCenterApi.upsertShopifyLocationMapping,
    ).toHaveBeenCalledWith(
      shopId,
      "gid://shopify/Location/1001",
      warehouseId,
    ));
    expect(await screen.findByText("地点映射已保存。")).toBeTruthy();
  });

  it("fails closed when the account cannot read the required directories", () => {
    render(
      <InventorySyncRulesSection
        canRead={false}
        canWrite={false}
        onShopChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("status").textContent)
      .toContain("当前账号无法管理同步规则");
    expect(shopCenterApi.listShops).not.toHaveBeenCalled();
  });
});
