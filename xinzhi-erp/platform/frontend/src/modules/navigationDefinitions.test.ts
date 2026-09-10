import { describe, expect, it } from "vitest";
import {
  getAccessibleTenantNavigation,
  getCurrentPrimaryNavigation,
  getCurrentSecondaryNavigation,
  resolveSecondaryNavigationTarget,
} from "./navigationDefinitions";

describe("tenant navigation", () => {
  it("returns from master details to the filtered list without leaking context to other views", () => {
    const items = getAccessibleTenantNavigation(() => true).find(item => item.id === "products")!.groups.flatMap(group => group.items);
    const master = items.find(item => item.productView === "master")!;
    const source = "?page=3&size=50&createdFrom=2026-09-01&sortBy=CREATED_AT&descending=true&mode=edit&skuKeyword=child";
    const returned = new URL(resolveSecondaryNavigationTarget(master, source, "/products/master/example"), "https://erp.test");
    expect(Object.fromEntries(returned.searchParams)).toEqual({ view: "master", page: "3", size: "50", createdFrom: "2026-09-01", sortBy: "CREATED_AT", descending: "true" });
    expect(resolveSecondaryNavigationTarget(master, source, "/orders/example")).toBe("/products?view=master");
    expect(resolveSecondaryNavigationTarget(items.find(item => item.productView === "inventory")!, source, "/products/master/example")).toBe("/products?view=inventory");
  });
  it("shows the implemented product and warehouse entries", () => {
    const navigation = getAccessibleTenantNavigation(() => true);
    const products = navigation.find((item) => item.id === "products")!;
    const orders = navigation.find((item) => item.id === "orders")!;
    const warehouse = navigation.find((item) => item.id === "warehouse")!;
    const logistics = navigation.find((item) => item.id === "logistics")!;
    const supplyChain = navigation.find((item) => item.id === "supply-chain")!;
    const analytics = navigation.find((item) => item.id === "analytics")!;
    const settings = navigation.find((item) => item.id === "settings")!;
    expect(navigation.some((item) => item.id === "customer-service")).toBe(false);
    expect(getCurrentPrimaryNavigation(
      "/customer-service",
      (permission) => permission === "customer_service.read",
    )).toBeUndefined();

    expect(orders.groups[0]?.items.map((item) => item.id)).toEqual([
      "order-list",
      "order-unpaid",
      "order-review-pending",
      "order-merge-pending",
      "order-processing",
      "order-fulfilling",
      "order-shipped",
      "order-delivered",
      "order-cancelled",
      "customer-directory",
    ]);
    const orderItems = orders.groups.flatMap((group) => group.items);
    expect(getCurrentSecondaryNavigation(
      orderItems,
      "/orders",
      "?stage=PROCESSING&shopId=shop-1",
    )?.item.id).toBe("order-processing");
    expect(getCurrentSecondaryNavigation(
      orderItems,
      "/orders",
      "?view=queue&stage=PROCESSING",
    )?.item.id).toBe("order-list");
    expect(resolveSecondaryNavigationTarget(
      orderItems.find((item) => item.id === "order-shipped")!,
      "?page=4&shopId=shop-1&view=queue&status=RECEIVED&keyword=needle",
    )).toBe("/orders?shopId=shop-1&keyword=needle&stage=SHIPPED");
    expect(resolveSecondaryNavigationTarget(
      orderItems.find((item) => item.id === "order-list")!,
      "?page=4&shopId=shop-1&stage=SHIPPED&keyword=needle",
    )).toBe("/orders?shopId=shop-1&keyword=needle");

    expect(products.groups.flatMap((group) => group.items.map((item) => item.id))).toEqual([
      "online",
      "master",
      "inventory",
      "bundle",
      "supply-price",
      "aging",
      "inventory-report",
      "inventory-query",
      "sync-rules",
      "sync-exceptions",
    ]);
    expect(products.groups.map((group) => group.label)).toEqual([
      "商品管理",
      "同步库存",
    ]);
    expect(warehouse.groups.flatMap((group) => group.items.map((item) => item.id))).toEqual([
      "warehouse-list",
      "location-list",
      "manual-movements",
      "inventory-counts",
      "warehouse-transfers",
      "warehouse-documents",
    ]);
    expect(warehouse.groups.map((group) => group.label)).toEqual(["仓库信息"]);
    expect(warehouse.to).toBe("/warehouses");
    expect(supplyChain.to).toBe("/procurement/orders");
    expect(supplyChain.groups.map((group) => group.label)).toEqual([
      "采购流程",
      "基础资料",
      "数据统计",
    ]);
    expect(supplyChain.groups.flatMap((group) => group.items)).toEqual([
      expect.objectContaining({
        id: "procurement-orders",
        to: "/procurement/orders",
        permissions: ["procurement.read"],
      }),
      expect.objectContaining({
        id: "suppliers",
        to: "/procurement/suppliers",
        permissions: ["suppliers.read"],
      }),
      expect.objectContaining({
        id: "purchaser-performance",
        to: "/procurement/statistics/purchaser-performance",
        permissions: ["procurement.read"],
      }),
    ]);
    expect(analytics.to).toBe("/analytics/sales/order-status");
    expect(analytics.groups).toEqual([
      expect.objectContaining({
        id: "analytics-sales-reports",
        label: "销售报告",
        items: [
          expect.objectContaining({ id: "analytics-order-status", to: "/analytics/sales/order-status", permissions: ["analytics.read"] }),
          expect.objectContaining({ id: "analytics-product-sales", to: "/analytics/sales/product-sales", permissions: ["analytics.read"] }),
          expect.objectContaining({ id: "analytics-order-analysis", to: "/analytics/sales/order-analysis", permissions: ["analytics.read"] }),
          expect.objectContaining({ id: "analytics-listing-realtime", to: "/analytics/sales/listing-realtime", permissions: ["analytics.read"] }),
          expect.objectContaining({ id: "analytics-inventory-realtime", to: "/analytics/sales/inventory-realtime", permissions: ["analytics.read"] }),
        ],
      }),
      expect.objectContaining({
        id: "analytics-product-reports",
        label: "商品报告",
        items: [
          expect.objectContaining({ id: "analytics-inventory-report", to: "/analytics/products/inventory-report", permissions: ["analytics.read"] }),
          expect.objectContaining({ id: "analytics-inventory-aging", to: "/analytics/products/inventory-aging", permissions: ["analytics.read"] }),
        ],
      }),
      expect.objectContaining({
        id: "analytics-store-reports",
        label: "店铺报告",
        items: [expect.objectContaining({ id: "analytics-store-health", to: "/analytics/stores/health", permissions: ["analytics.read"] })],
      }),
    ]);
    expect(settings.to).toBe("/settings/tasks/approvals");
    expect(settings.groups[0]).toEqual(expect.objectContaining({
      id: "settings-task-announcements",
      label: "任务公告",
      items: [
        expect.objectContaining({ id: "settings-approvals", permissions: ["settings.read"] }),
        expect.objectContaining({ id: "settings-task-list", permissions: ["settings.read"] }),
        expect.objectContaining({ id: "settings-messages", permissions: ["settings.read"] }),
        expect.objectContaining({ id: "settings-import-export", permissions: ["settings.read"] }),
        expect.objectContaining({ id: "settings-attachments", permissions: ["settings.read"] }),
        expect.objectContaining({ id: "settings-task-center", permissions: ["settings.read"] }),
        expect.objectContaining({ id: "settings-notices", permissions: ["settings.read"] }),
      ],
    }));
    expect(settings.groups.find((group) => group.id === "settings-parameters")).toEqual(expect.objectContaining({
      label: "参数设置",
      items: [
        expect.objectContaining({ id: "settings-aliases", permissions: ["settings.read"] }),
        expect.objectContaining({ id: "settings-order-exceptions", permissions: ["settings.read"] }),
        expect.objectContaining({ id: "settings-shipping-deadline", permissions: ["settings.read"] }),
        expect.objectContaining({ id: "settings-approval-rules", permissions: ["settings.read"] }),
        expect.objectContaining({ id: "settings-address-mappings", permissions: ["settings.read"] }),
      ],
    }));
    expect(settings.groups.find((group) => group.id === "settings-system")).toEqual(expect.objectContaining({
      label: "系统设置",
      items: [
        expect.objectContaining({ id: "settings-general", label: "基础设置", permissions: ["settings.read"] }),
        expect.objectContaining({ id: "settings-enterprise", permissions: ["settings.read"] }),
        expect.objectContaining({ id: "settings-task-management", permissions: ["settings.read"] }),
        expect.objectContaining({ id: "settings-erp-operator", permissions: ["PLATFORM_ADMIN_TENANT_SESSION"] }),
      ],
    }));
    expect(settings.groups.find((group) => group.id === "organization-access")).toEqual(expect.objectContaining({
      label: "组织与权限",
      items: [
        expect.objectContaining({ id: "iam", label: "员工与权限", to: "/settings/iam" }),
        expect.objectContaining({ id: "member-application-access", to: "/settings/application-access", permissions: ["iam:user:read"] }),
      ],
    }));
    expect(settings.groups.flatMap((group) => group.items).some((item) => item.to === "/settings/employees")).toBe(false);
    expect(settings.groups.flatMap((group) => group.items).some((item) => item.label.includes("速卖通"))).toBe(false);
    expect(logistics.to).toBe("/logistics/declaration-entities");
    expect(logistics.groups).toEqual([
      expect.objectContaining({
        id: "logistics-management",
        label: "物流管理",
        items: [
          expect.objectContaining({
            id: "logistics-declaration-entities",
            to: "/logistics/declaration-entities",
            permissions: ["logistics.read"],
          }),
          expect.objectContaining({
            id: "logistics-authorizations",
            permissions: ["logistics.read"],
          }),
          expect.objectContaining({
            id: "logistics-matching-rules",
            to: "/logistics/matching-rules",
            permissions: ["logistics.read"],
          }),
          expect.objectContaining({
            id: "logistics-custom-fees",
            to: "/logistics/custom-fees",
            permissions: ["logistics.read"],
          }),
          expect.objectContaining({
            id: "logistics-label-templates",
            to: "/logistics/label-templates",
            permissions: ["logistics.read"],
          }),
          expect.objectContaining({
            id: "logistics-tracking-numbers",
            to: "/logistics/tracking-numbers",
            permissions: ["logistics.read"],
          }),
          expect.objectContaining({
            id: "logistics-addresses",
            to: "/logistics/addresses",
            permissions: ["logistics.read"],
          }),
        ],
      }),
      expect.objectContaining({
        id: "logistics-value-added",
        label: "增值服务",
        items: [
          expect.objectContaining({ id: "logistics-fees", to: "/logistics/fees", permissions: ["logistics.read"] }),
          expect.objectContaining({ id: "logistics-tracking", to: "/logistics/tracking", permissions: ["logistics.read"] }),
          expect.objectContaining({ id: "logistics-forecasts", to: "/logistics/forecasts", permissions: ["logistics.read"] }),
          expect.objectContaining({ id: "logistics-inquiries", to: "/logistics/inquiries", permissions: ["logistics.read"] }),
        ],
      }),
      expect.objectContaining({
        id: "logistics-statistics",
        label: "数据统计",
        items: [expect.objectContaining({
          id: "logistics-statistics-overview",
          to: "/logistics/statistics",
          permissions: ["logistics.read"],
        })],
      }),
    ]);
  });

  it("does not expose logistics under unrelated permissions", () => {
    const logisticsOnly = (permission: string) => permission === "logistics.read";
    const navigation = getAccessibleTenantNavigation(logisticsOnly);

    expect(navigation.map((item) => item.id)).toEqual(["dashboard", "logistics"]);
    expect(getCurrentPrimaryNavigation("/logistics/authorizations", logisticsOnly)?.id)
      .toBe("logistics");
  });

  it("exposes supplier master data only to supplier readers", () => {
    const procurementOnly = (permission: string) => permission === "procurement.read";
    const supplierOnly = (permission: string) => permission === "suppliers.read";

    const procurementNavigation = getAccessibleTenantNavigation(procurementOnly);
    const procurement = procurementNavigation.find((item) => item.id === "supply-chain")!;
    expect(procurement.to).toBe("/procurement/orders");
    expect(procurement.groups.map((group) => group.id)).toEqual(["procurement-flow", "procurement-statistics"]);
    expect(getCurrentPrimaryNavigation("/procurement/plans", procurementOnly)?.id).toBe("supply-chain");

    const supplierNavigation = getAccessibleTenantNavigation(supplierOnly);
    expect(supplierNavigation.map((item) => item.id)).toEqual(["dashboard", "supply-chain"]);
    expect(supplierNavigation.find((item) => item.id === "supply-chain")?.to).toBe("/procurement/suppliers");
    expect(getCurrentPrimaryNavigation("/procurement/suppliers/supplier-id", supplierOnly)?.id).toBe("supply-chain");
  });

  it("places the existing shop routes under Settings channel authorization without broadening access", () => {
    const shopOnly = (permission: string) => permission === "shop:read";
    const navigation = getAccessibleTenantNavigation(shopOnly);

    expect(navigation.map((item) => item.id)).toEqual(["dashboard", "settings"]);
    expect(navigation.some((item) => item.id === "shops")).toBe(false);

    const settings = navigation.find((item) => item.id === "settings")!;
    expect(settings.to).toBe("/shops");
    expect(settings.groups).toEqual([
      expect.objectContaining({
        id: "channel-authorization",
        label: "渠道授权",
        items: [expect.objectContaining({ id: "shop-list", to: "/shops", permissions: ["shop:read"] })],
      }),
    ]);
    expect(getCurrentPrimaryNavigation("/shops/shop-id", shopOnly)?.id).toBe("settings");
    expect(
      getCurrentSecondaryNavigation(settings.groups.flatMap((group) => group.items), "/shops/shop-id", "")?.item.id,
    ).toBe("shop-list");
  });

  it("keeps paused finance navigation unavailable", () => {
    const financeOnly = (permission: string) => permission === "finance.read";
    const navigation = getAccessibleTenantNavigation(financeOnly);
    expect(navigation.map((item) => item.id)).toEqual(["dashboard"]);
    expect(getCurrentPrimaryNavigation("/finance/bank-accounts", financeOnly)).toBeUndefined();
  });

  it.each(["/products/master/new", "/products/master/spu-id"])("resolves the accessible master list for %s", pathname => {
    const navigation = getAccessibleTenantNavigation(permission => permission === "products.read");
    const items = navigation.flatMap(primary => primary.groups).flatMap(group => group.items);
    const match = getCurrentSecondaryNavigation(items, pathname, "");
    expect(match?.item.to).toBe("/products?view=master");
    expect(match?.matchType).toBe("path-prefix");
    expect(getCurrentSecondaryNavigation([], pathname, "")).toBeUndefined();
  });

  it("keeps analytics navigation isolated behind analytics.read", () => {
    const analyticsOnly = (permission: string) => permission === "analytics.read";
    const navigation = getAccessibleTenantNavigation(analyticsOnly);
    expect(navigation.map((item) => item.id)).toEqual(["dashboard", "analytics"]);
    expect(getCurrentPrimaryNavigation("/analytics/sales/order-analysis", analyticsOnly)?.id)
      .toBe("analytics");
  });

  it("keeps task and announcement settings isolated behind settings.read", () => {
    const settingsOnly = (permission: string) => permission === "settings.read";
    const navigation = getAccessibleTenantNavigation(settingsOnly);
    expect(navigation.map((item) => item.id)).toEqual(["dashboard", "settings"]);
    const settings = navigation[1];
    expect(settings.to).toBe("/settings/tasks/approvals");
    expect(settings.groups.map((group) => group.id)).toEqual(["settings-task-announcements", "settings-system", "settings-parameters"]);
    expect(getCurrentPrimaryNavigation("/settings/tasks/center", settingsOnly)?.id).toBe("settings");
  });

  it("shows ERP operations only to a delegated One platform administrator", () => {
    const delegatedOperatorOnly = (permission: string) =>
      permission === "PLATFORM_ADMIN_TENANT_SESSION";
    const navigation = getAccessibleTenantNavigation(delegatedOperatorOnly);

    expect(navigation.map((item) => item.id)).toEqual(["dashboard", "settings"]);
    expect(navigation[1].groups).toEqual([
      expect.objectContaining({
        id: "settings-system",
        items: [
          expect.objectContaining({
            id: "settings-erp-operator",
            to: "/settings/system/erp-operator",
          }),
        ],
      }),
    ]);

    const enterpriseAdministrator = (permission: string) =>
      permission === "settings.read";
    expect(
      getAccessibleTenantNavigation(enterpriseAdministrator)
        .flatMap((item) => item.groups)
        .flatMap((group) => group.items)
        .some((item) => item.id === "settings-erp-operator"),
    ).toBe(false);
  });
});
