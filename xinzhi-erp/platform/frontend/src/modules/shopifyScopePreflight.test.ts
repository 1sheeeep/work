import { afterEach, describe, expect, it, vi } from "vitest";
import { shopCenterApi } from "./shopCenterApi";
import { shopifyScopePreflight } from "./shopifyScopePreflight";

afterEach(() => vi.restoreAllMocks());

describe("shopifyScopePreflight", () => {
  it("passes only when the exact required scope is granted", async () => {
    vi.spyOn(shopCenterApi, "getChannels").mockResolvedValue({
      mode: "XZ_ERP_APP",
      shopify: { status: "CONNECTED" },
      shopifyScopes: [
        { scope: "write_returns", purpose: "退货处理", status: "GRANTED" },
        { scope: "read_shopify_payments_disputes", purpose: "拒付读取", status: "GRANTED" },
      ],
      activity: [],
    });

    await expect(shopifyScopePreflight("shop-id", "write_returns", "读取退货数据"))
      .resolves.toBeNull();
    await expect(shopifyScopePreflight("shop-id", "read_customers", "读取客户档案"))
      .resolves.toBe("Shopify 应用权限不足，无法读取客户档案。请在店铺详情重新授权后再试。");
    await expect(shopifyScopePreflight(
      "shop-id",
      ["read_shopify_payments_disputes", "read_customers"],
      "读取拒付及客户数据",
    )).resolves.toBe("Shopify 应用权限不足，无法读取拒付及客户数据。请在店铺详情重新授权后再试。");
  });

  it("fails closed for disconnected and unverifiable authorization", async () => {
    vi.spyOn(shopCenterApi, "getChannels").mockResolvedValueOnce({
      mode: "XZ_ERP_APP",
      shopify: { status: "REVOKED" },
      shopifyScopes: [],
      activity: [],
    }).mockRejectedValueOnce(new Error("offline"));

    await expect(shopifyScopePreflight("shop-id", "write_orders", "读取订单"))
      .resolves.toContain("尚未授权");
    await expect(shopifyScopePreflight("shop-id", "write_orders", "读取订单"))
      .resolves.toContain("无法检查 Shopify 应用权限");
  });
});
