import { shopCenterApi, type ShopifyPermissionScope } from "./shopCenterApi";

export async function shopifyScopePreflight(
  shopId: string,
  requiredScope: string | readonly string[],
  action: string,
): Promise<string | null> {
  try {
    const snapshot = await shopCenterApi.getChannels(shopId);
    if (snapshot.shopify.status !== "CONNECTED") {
      return `Shopify 尚未授权，无法${action}。请先在店铺详情完成授权。`;
    }
    const requiredScopes = typeof requiredScope === "string" ? [requiredScope] : requiredScope;
    const granted = new Set(
      snapshot.shopifyScopes
        .filter((item: ShopifyPermissionScope) => item.status === "GRANTED")
        .map((item: ShopifyPermissionScope) => item.scope),
    );
    const hasMissingScope = requiredScopes.some((scope) => !granted.has(scope));
    if (hasMissingScope) {
      return `Shopify 应用权限不足，无法${action}。请在店铺详情重新授权后再试。`;
    }
    return null;
  } catch {
    return `暂时无法检查 Shopify 应用权限，无法${action}。请到店铺详情刷新权限状态后重试。`;
  }
}
