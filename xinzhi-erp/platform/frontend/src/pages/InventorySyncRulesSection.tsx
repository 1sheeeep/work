import { ArrowRight, CircleDashed, RefreshCw, Store } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError } from "../api/client";
import {
  type PlatformCatalogEntry,
  type TenantShop,
  shopCenterApi,
  shopDisplayName,
} from "../modules/shopCenterApi";
import { ShopifyLocationMappingPanel } from "./ShopifyLocationMappingPanel";

type SyncRuleDirectory = {
  platforms: Map<string, PlatformCatalogEntry>;
  shops: TenantShop[];
};

type DirectoryState =
  | { status: "not-permitted" }
  | { status: "loading" }
  | { status: "ready"; data: SyncRuleDirectory }
  | { status: "error"; message: string };

function safeDirectoryMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 403) {
    return "当前账号缺少店铺、平台或仓库读取权限，无法管理库存同步规则。";
  }
  return "暂时无法读取已授权店铺，请稍后重试。";
}

function isShopifyShop(
  shop: TenantShop,
  platforms: Map<string, PlatformCatalogEntry>,
) {
  return platforms.get(shop.platformId)?.code.trim().toUpperCase() === "SHOPIFY";
}

export function InventorySyncRulesSection({
  selectedShopId,
  canRead,
  canWrite,
  onShopChange,
}: {
  selectedShopId?: string;
  canRead: boolean;
  canWrite: boolean;
  onShopChange: (shopId: string) => void;
}) {
  const [state, setState] = useState<DirectoryState>(
    canRead ? { status: "loading" } : { status: "not-permitted" },
  );
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    if (!canRead) {
      setState({ status: "not-permitted" });
      return;
    }
    setState({ status: "loading" });
    try {
      const [platformPage, shopPage] = await Promise.all([
        shopCenterApi.listPlatforms({
          page: 0,
          size: 200,
          includeArchived: false,
        }),
        shopCenterApi.listShops({
          page: 0,
          size: 200,
          includeArchived: false,
          status: "ACTIVE",
          authorizationStatus: "AUTHORIZED",
        }),
      ]);
      const platforms = new Map(
        platformPage.items.map((platform) => [platform.id, platform]),
      );
      setState({
        status: "ready",
        data: {
          platforms,
          shops: shopPage.items.filter((shop) => isShopifyShop(shop, platforms)),
        },
      });
    } catch (error) {
      setState({ status: "error", message: safeDirectoryMessage(error) });
    }
  }, [canRead]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const selectedShop = useMemo(() => {
    if (state.status !== "ready") return undefined;
    return state.data.shops.find((shop) => shop.id === selectedShopId)
      ?? state.data.shops[0];
  }, [selectedShopId, state]);

  return (
    <section
      className="detail-card product-section erp-data-workbench inventory-sync-rules-section"
      aria-labelledby="inventory-sync-rules-title"
    >
      <div className="table-heading">
        <div>
          <h2 id="inventory-sync-rules-title">同步规则管理</h2>
          <p>将 Shopify 地点一对一映射到 ERP 仓库，作为库存发布的目标规则。</p>
        </div>
        <button
          className="button button-secondary"
          type="button"
          disabled={state.status === "loading" || state.status === "not-permitted"}
          onClick={() => setRefreshKey((value) => value + 1)}
        >
          <RefreshCw size={16} aria-hidden="true" />刷新店铺
        </button>
      </div>

      {state.status === "not-permitted" && (
        <div className="compact-empty-state" role="status">
          <strong>当前账号无法管理同步规则</strong>
          <span>需要店铺、平台和仓库读取权限；修改映射还需要店铺和仓库写入权限。</span>
        </div>
      )}

      {state.status === "loading" && (
        <div className="compact-empty-state" role="status" aria-live="polite">
          <CircleDashed className="spin" size={20} aria-hidden="true" />
          <strong>正在读取已授权 Shopify 店铺</strong>
        </div>
      )}

      {state.status === "error" && (
        <div className="compact-empty-state" role="alert">
          <strong>无法读取店铺目录</strong>
          <span>{state.message}</span>
          <button className="button button-secondary" type="button" onClick={() => void load()}>
            重试
          </button>
        </div>
      )}

      {state.status === "ready" && state.data.shops.length === 0 && (
        <div className="compact-empty-state" role="status">
          <strong>暂无可配置的 Shopify 店铺</strong>
          <span>请先启用店铺并完成 Shopify 授权，再配置地点与仓库映射。</span>
          <a className="button button-secondary" href="/shops">前往店铺列表</a>
        </div>
      )}

      {state.status === "ready" && selectedShop && (
        <>
          <div className="inventory-sync-rule-toolbar">
            <label>
              Shopify 店铺
              <select
                aria-label="同步规则店铺"
                value={selectedShop.id}
                onChange={(event) => onShopChange(event.target.value)}
              >
                {state.data.shops.map((shop) => (
                  <option key={shop.id} value={shop.id}>
                    {shopDisplayName(shop)} · {shop.externalShopRef}
                  </option>
                ))}
              </select>
            </label>
            <div className="inventory-sync-rule-actions" aria-label="同步规则相关操作">
              <a className="button button-secondary" href={`/shops/${selectedShop.id}`}>
                店铺授权与地点设置
              </a>
              <a
                className="button button-primary"
                href={`/products/inventory-query?shopId=${selectedShop.id}`}
              >
                库存查询与发布<ArrowRight size={16} aria-hidden="true" />
              </a>
            </div>
          </div>

          <div className="inventory-sync-rule-summary">
            <Store size={18} aria-hidden="true" />
            <div>
              <strong>{shopDisplayName(selectedShop)}</strong>
              <span>{selectedShop.externalShopRef}</span>
            </div>
            <span className="status-chip">店铺启用</span>
            <span
              className={`status-chip${
                selectedShop.authorization.scopes.includes("read_locations")
                  ? ""
                  : " status-planned"
              }`}
            >
              {selectedShop.authorization.scopes.includes("read_locations")
                ? "地点权限已授权"
                : "地点权限待更新"}
            </span>
          </div>

          <p className="inventory-sync-rule-note">
            每个 Shopify 地点只能对应一个 ERP 仓库。发布库存时系统会先展示 ERP 可用量、
            Shopify 当前量与目标量，确认后才会提交更新。
          </p>

          <ShopifyLocationMappingPanel
            shopId={selectedShop.id}
            canRead={canRead}
            canWrite={canWrite}
            shopActive={selectedShop.status === "ACTIVE"}
          />
        </>
      )}
    </section>
  );
}
