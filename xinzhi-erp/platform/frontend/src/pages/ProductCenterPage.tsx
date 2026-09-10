import {
  Archive,
  CircleDashed,
  Eye,
  Layers3,
  Link2,
  LockKeyhole,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { CurrencyCodeInput } from "../components/CurrencyCodeInput";
import {
  AdvancedFilterPanel,
  AdvancedFilterSection,
} from "../components/AdvancedFilterPanel";
import { DialogCloseButton } from "../components/DialogCloseButton";
import { ErpIconButton } from "../components/ErpVisualPrimitives";
import { PageSelectionCheckbox } from "../components/PageSelectionCheckbox";
import { optionalAmountCurrencyError } from "../modules/currencyInput";
import {
  type ListRequest,
  type ListingInput,
  type Page,
  type ProductListing,
  type ProductImage,
  type ProductAssignableMember,
  type ProductCategory,
  type ProductListingSearchField,
  type ProductPackageMaterial,
  type ProductSku,
  type ProductSkuMatchMode,
  type ProductSkuSortField,
  type ProductSpu,
  type ProductStatus,
  type ShopifyCatalogImportResult,
  type ShopifyCatalogImportStatus,
  type ShopifyCatalogPreview,
  type ShopifyCatalogVariantPreview,
  type SkuListRequest,
  type SkuListingSummary,
  productCenterApi,
  sensitiveAttributeCodes,
} from "../modules/productCenterApi";
import {
  type PlatformCatalogEntry,
  type TenantShop,
  shopDisplayName,
  shopCenterApi,
} from "../modules/shopCenterApi";
import {
  type InventorySkuSummary,
  inventoryApi,
} from "../modules/inventoryApi";
import { shopifyScopePreflight } from "../modules/shopifyScopePreflight";
import {
  type SkuSalesSummary,
  orderCenterApi,
} from "../modules/orderCenterApi";
import {
  type PreferredSupplierSkuSummary,
  supplierSkuMappingApi,
} from "../modules/supplierSkuMappingApi";
import { type Warehouse, warehouseCenterApi } from "../modules/warehouseCenterApi";
import {
  productMasterNewPath,
  productMasterPagePath,
} from "./productMasterPaths";
import { ProductMasterDataManager } from "./ProductMasterDataManager";
import { SkuPackagingRuleDialog } from "./SkuPackagingRuleDialog";
import { ProductBundleSection } from "./ProductBundleSection";
import { ProductSupplyPriceSection } from "./ProductSupplyPriceSection";
import {
  InventoryAgingSection,
  InventoryReportSection,
  InventorySyncExceptionsSection,
  InventorySyncRulesSection,
} from "./ProductArchiveShells";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE = 9_999;
const EXPORT_PAGE_SIZE = 200;
const MAX_EXPORT_ROWS = 10_000;
const MAX_EXPORT_PAGES = MAX_EXPORT_ROWS / EXPORT_PAGE_SIZE;
const MAX_REFERENCE_ITEMS = 10_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BUSINESS_CODE_PATTERN = /^[A-Z][A-Z0-9_-]{1,63}$/;
const statuses: ProductStatus[] = ["ACTIVE", "INACTIVE", "ARCHIVED"];
const productViews = [
  "online",
  "master",
  "inventory",
  "bundle",
  "supply-price",
  "aging",
  "inventory-report",
  "sync-rules",
  "sync-exceptions",
] as const;
const productViewLabels: Record<(typeof productViews)[number], string> = {
  online: "在线商品匹配",
  master: "主 SKU",
  inventory: "库存 SKU",
  bundle: "组合 SKU",
  "supply-price": "商品供货价管理",
  aging: "库龄分析",
  "inventory-report": "进销存报表",
  "sync-rules": "同步规则管理",
  "sync-exceptions": "库存同步异常",
};
export const masterProductSearchFields = [
  ["ALL", "全部字段"],
  ["MASTER_CODE", "按主 SKU 编号"],
  ["NAME_ZH", "按中文名"],
  ["NAME_EN", "按英文名"],
  ["INVENTORY_SKU", "按库存 SKU"],
] as const;
const SHOPIFY_PLATFORM_CODE = "SHOPIFY";
const INVENTORY_SKU_COLUMNS_STORAGE_KEY =
  "xz.erp.products.inventorySku.visibleColumns.v1";
const inventorySkuColumns = [
  ["thumbnail", "缩略图", "商品信息"],
  ["businessCode", "库存 SKU", "商品信息"],
  ["supplierSkuCode", "原厂 SKU", "商品信息"],
  ["spuIdentity", "主 SKU", "商品信息"],
  ["name", "商品中文名 / 多属性", "商品信息"],
  ["nameEn", "英文名", "商品信息"],
  ["brandName", "商品品牌", "商品信息"],
  ["category", "商品目录", "商品信息"],
  ["unitCost", "统一成本价", "采购与仓库"],
  ["defaultWarehouse", "默认仓库", "采购与仓库"],
  ["preferredSupplier", "默认供应商", "采购与仓库"],
  ["onHand", "库存总量", "库存"],
  ["reserved", "锁定库存", "库存"],
  ["available", "可用库存", "库存"],
  ["sales", "销量（7/28/42 天）", "销售"],
  ["activeListingCount", "已配对在线量", "销售"],
  ["actualWeight", "重量", "重量与包装"],
  ["dimensions", "尺寸", "重量与包装"],
  ["packageMaterial", "包装资料", "重量与包装"],
  ["packageableCount", "每包装件数", "重量与包装"],
  ["status", "状态", "状态与时间"],
  ["createdAt", "创建时间", "状态与时间"],
  ["creatorName", "创建人员", "状态与时间"],
  ["updatedAt", "更新时间", "状态与时间"],
] as const;
type InventorySkuColumn = (typeof inventorySkuColumns)[number][0];
const defaultInventorySkuColumns = inventorySkuColumns.map(
  ([key]) => key,
) as InventorySkuColumn[];

function loadInventorySkuColumns(): InventorySkuColumn[] {
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(INVENTORY_SKU_COLUMNS_STORAGE_KEY) ?? "null",
    );
    if (Array.isArray(stored)) {
      const selected = new Set(
        stored.filter(
          (value): value is InventorySkuColumn =>
            typeof value === "string" &&
            inventorySkuColumns.some(([key]) => key === value),
        ),
      );
      const ordered = defaultInventorySkuColumns.filter((key) =>
        selected.has(key),
      );
      if (ordered.length > 0) return ordered;
    }
  } catch {
    // Browser storage is optional; the complete table remains available.
  }
  return defaultInventorySkuColumns;
}

export type ProductView = (typeof productViews)[number];

type Query = {
  view: ProductView;
  status?: ProductStatus;
  keyword: string;
  searchField?: "ALL" | "MASTER_CODE" | "NAME_ZH" | "NAME_EN" | "INVENTORY_SKU";
  categoryId?: string;
  creatorId?: string;
  createdFrom?: string;
  createdTo?: string;
  sortBy?: "BUSINESS_CODE" | "CATEGORY" | "SALES_42" | "FORECAST_DAILY_SALES" | "CREATED_AT";
  descending?: boolean;
  page: number;
  size: number;
  spuId?: string;
  skuStatus?: ProductStatus;
  skuKeyword: string;
  skuSearchField: "ALL" | "INVENTORY_SKU" | "NAME_ZH" | "NAME_EN"
    | "MASTER_CODE" | "ORIGINAL_SKU" | "DEFAULT_SUPPLIER";
  skuMatchMode: ProductSkuMatchMode;
  skuSortBy: ProductSkuSortField;
  skuDescending: boolean;
  skuCreatorId?: string;
  skuCreatedFrom?: string;
  skuCreatedTo?: string;
  skuPage: number;
  skuSize: number;
  listingStatus?: ProductStatus;
  listingKeyword: string;
  listingSearchField: ProductListingSearchField;
  listingShopId?: string;
  listingPage: number;
  listingSize: number;
  bundleKeyword?: string;
  bundleStart?: string;
  bundleEnd?: string;
  supplyPriceKeyword?: string;
  supplyPriceSkuType?: string;
  supplyPriceCountry?: string;
  agingKeyword?: string;
  agingCutoff?: string;
  agingWarehouseId?: string;
  reportKeyword?: string;
  reportStart?: string;
  reportEnd?: string;
  syncPlatform?: string;
  syncShop?: string;
  syncStart?: string;
  syncEnd?: string;
  syncKeyword?: string;
};

type LoadState<T> =
  | { status: "loading"; data?: T }
  | { status: "ready"; data: T }
  | { status: "error"; message: string };

type ListingShopOptionsState =
  | { status: "idle" }
  | { status: "loading"; data?: ListingShopOptions }
  | { status: "ready"; data: ListingShopOptions }
  | { status: "error"; message: string };

type ListingShopOptions = {
  shops: TenantShop[];
  platforms: Map<string, PlatformCatalogEntry>;
};

export type ProductEditorKind = "sku" | "listing";
export type ProductEditorAction =
  | "create"
  | "edit"
  | "archive"
  | "activate"
  | "deactivate";
type ProductEditorItem = ProductSku | ProductListing;
export type ProductEditor = {
  kind: ProductEditorKind;
  action: ProductEditorAction;
  item?: ProductEditorItem;
  skuId?: string;
};

function bounded(
  value: string | null,
  fallback: number,
  min: number,
  max: number,
) {
  if (!value || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : fallback;
}

function queryStatus(value: string | null) {
  return statuses.includes(value as ProductStatus)
    ? (value as ProductStatus)
    : undefined;
}

function queryText(value: string | null) {
  return (value?.trim() ?? "").slice(0, 100);
}

function queryMasterSearchField(value: string | null): Query["searchField"] {
  return value === "MASTER_CODE" || value === "NAME_ZH" || value === "NAME_EN"
    || value === "INVENTORY_SKU" ? value : "ALL";
}

function queryInventorySkuSearchField(
  value: string | null,
): Query["skuSearchField"] {
  return value === "ALL" || value === "NAME_ZH" || value === "NAME_EN"
    || value === "MASTER_CODE" || value === "ORIGINAL_SKU"
    || value === "DEFAULT_SUPPLIER"
    ? value
    : "INVENTORY_SKU";
}

function queryListingSearchField(
  value: string | null,
): ProductListingSearchField {
  return value === "PLATFORM_PRODUCT"
    || value === "PLATFORM_VARIANT"
    || value === "EXTERNAL_STATUS"
    || value === "INVENTORY_SKU"
    ? value
    : "ALL";
}

function queryInventorySkuMatchMode(
  value: string | null,
): ProductSkuMatchMode {
  return value === "EQUALS" || value === "CONTAINS"
    || value === "ENDS_WITH" || value === "EMPTY"
    || value === "NOT_EMPTY" ? value : "STARTS_WITH";
}

function queryInventorySkuSortField(
  value: string | null,
): ProductSkuSortField {
  return value === "CREATED_AT" ? value : "BUSINESS_CODE";
}

function queryUuid(value: string | null) {
  return value && isValidProductId(value) ? value : undefined;
}

function queryDate(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(new Date(`${value}T00:00:00Z`).valueOf()) ? value : undefined;
}

function queryMasterSort(value: string | null): NonNullable<Query["sortBy"]> {
  return value === "CATEGORY" || value === "SALES_42"
    || value === "FORECAST_DAILY_SALES" || value === "CREATED_AT"
    ? value
    : "BUSINESS_CODE";
}

export function dateStartUtc8(value?: string) {
  return value
    ? new Date(`${value}T00:00:00+08:00`).toISOString()
    : undefined;
}

export function dateEndExclusiveUtc8(value?: string) {
  if (!value) return undefined;
  return new Date(
    new Date(`${value}T00:00:00+08:00`).valueOf() + 86_400_000,
  ).toISOString();
}

function isProductView(value: string | null): value is ProductView {
  return productViews.includes(value as ProductView);
}

function queryView(value: string | null): ProductView {
  return isProductView(value) ? value : "online";
}

export function isValidProductId(value: string) {
  return UUID_PATTERN.test(value);
}

export function shouldLoadListings(
  canReadListings: boolean,
  view: ProductView = "online",
) {
  return canReadListings && view === "online";
}

export function shouldLoadSpus(view: ProductView, selectedSpuId?: string) {
  return view === "master" && !selectedSpuId;
}

export function skuReadScope(view: ProductView, selectedSpuId?: string) {
  if (view !== "inventory" && (view !== "master" || !selectedSpuId)) {
    return { load: false } as const;
  }
  return {
    load: true,
    spuId: view === "master" ? selectedSpuId : undefined,
  } as const;
}

export function shouldLoadListingShopOptions(
  canReadListingShops: boolean,
  isListingCreate: boolean,
) {
  return canReadListingShops && isListingCreate;
}

export function parseProductCenterQuery(search: string): Query {
  const params = new URLSearchParams(search);
  const spuId = params.get("spuId") ?? undefined;
  return {
    view: queryView(params.get("view")),
    status: queryStatus(params.get("status")),
    keyword: queryText(params.get("keyword")),
    searchField: queryMasterSearchField(params.get("searchField")),
    categoryId: queryUuid(params.get("categoryId")),
    creatorId: queryUuid(params.get("creatorId")),
    createdFrom: queryDate(params.get("createdFrom")),
    createdTo: queryDate(params.get("createdTo")),
    sortBy: queryMasterSort(params.get("sortBy")),
    descending: params.get("descending") === "true",
    page: bounded(params.get("page"), 0, 0, MAX_PAGE),
    size: bounded(params.get("size"), DEFAULT_PAGE_SIZE, 1, 100),
    spuId: spuId && isValidProductId(spuId) ? spuId : undefined,
    skuStatus: queryStatus(params.get("skuStatus")),
    skuKeyword: queryText(params.get("skuKeyword")),
    skuSearchField: queryInventorySkuSearchField(
      params.get("skuSearchField"),
    ),
    skuMatchMode: queryInventorySkuMatchMode(
      params.get("skuMatchMode"),
    ),
    skuSortBy: queryInventorySkuSortField(params.get("skuSortBy")),
    skuDescending: params.get("skuDescending") === "true",
    skuCreatorId: queryUuid(params.get("skuCreatorId")),
    skuCreatedFrom: queryDate(params.get("skuCreatedFrom")),
    skuCreatedTo: queryDate(params.get("skuCreatedTo")),
    skuPage: bounded(params.get("skuPage"), 0, 0, MAX_PAGE),
    skuSize: bounded(params.get("skuSize"), DEFAULT_PAGE_SIZE, 1, 100),
    listingStatus: queryStatus(params.get("listingStatus")),
    listingKeyword: queryText(params.get("listingKeyword")),
    listingSearchField: queryListingSearchField(
      params.get("listingSearchField"),
    ),
    listingShopId: queryUuid(params.get("listingShopId")),
    listingPage: bounded(params.get("listingPage"), 0, 0, MAX_PAGE),
    listingSize: bounded(params.get("listingSize"), DEFAULT_PAGE_SIZE, 1, 100),
    bundleKeyword: queryText(params.get("bundleKeyword")),
    bundleStart: queryDate(params.get("bundleStart")),
    bundleEnd: queryDate(params.get("bundleEnd")),
    supplyPriceKeyword: queryText(params.get("supplyPriceKeyword")),
    supplyPriceSkuType: queryText(params.get("supplyPriceSkuType")),
    supplyPriceCountry: queryText(params.get("supplyPriceCountry")),
    agingKeyword: queryText(params.get("agingKeyword")),
    agingCutoff: queryDate(params.get("agingCutoff")),
    agingWarehouseId: queryUuid(params.get("agingWarehouseId")),
    reportKeyword: queryText(params.get("reportKeyword")),
    reportStart: queryDate(params.get("reportStart")),
    reportEnd: queryDate(params.get("reportEnd")),
    syncPlatform: queryText(params.get("syncPlatform")),
    syncShop: queryText(params.get("syncShop")),
    syncStart: queryDate(params.get("syncStart")),
    syncEnd: queryDate(params.get("syncEnd")),
    syncKeyword: queryText(params.get("syncKeyword")),
  };
}

export function toProductCenterUrl(query: Query) {
  const params = new URLSearchParams({ view: query.view });
  const set = (name: string, value: string | number | undefined) => {
    if (value !== undefined && value !== "") params.set(name, String(value));
  };
  const setPage = (prefix: string, page: number | undefined, size: number | undefined) => {
    set(`${prefix}Page`, page ?? 0);
    set(`${prefix}Size`, size ?? DEFAULT_PAGE_SIZE);
  };

  if (query.view === "online") {
    set("listingStatus", query.listingStatus);
    set("listingKeyword", query.listingKeyword);
    set(
      "listingSearchField",
      query.listingSearchField === "ALL"
        ? undefined
        : query.listingSearchField,
    );
    set("listingShopId", query.listingShopId);
    setPage("listing", query.listingPage, query.listingSize);
  } else if (query.view === "master") {
    set("status", query.status);
    set("keyword", query.keyword);
    set("searchField", !query.searchField || query.searchField === "ALL" ? undefined : query.searchField);
    set("categoryId", query.categoryId);
    set("creatorId", query.creatorId);
    set("createdFrom", query.createdFrom);
    set("createdTo", query.createdTo);
    set("sortBy", !query.sortBy || query.sortBy === "BUSINESS_CODE" ? undefined : query.sortBy);
    set("descending", query.descending ? "true" : undefined);
    set("page", query.page);
    set("size", query.size);
    if (query.spuId && isValidProductId(query.spuId)) set("spuId", query.spuId);
    set("skuStatus", query.skuStatus);
    set("skuKeyword", query.skuKeyword);
    setPage("sku", query.skuPage, query.skuSize);
  } else if (query.view === "inventory") {
    set("skuStatus", query.skuStatus);
    set("skuKeyword", query.skuKeyword);
    set("categoryId", query.categoryId);
    set(
      "skuSearchField",
      query.skuSearchField === "INVENTORY_SKU"
        ? undefined
        : query.skuSearchField,
    );
    set(
      "skuMatchMode",
      query.skuMatchMode === "STARTS_WITH"
        ? undefined
        : query.skuMatchMode,
    );
    set(
      "skuSortBy",
      query.skuSortBy === "BUSINESS_CODE"
        ? undefined
        : query.skuSortBy,
    );
    set("skuDescending", query.skuDescending ? "true" : undefined);
    set("skuCreatorId", query.skuCreatorId);
    set("skuCreatedFrom", query.skuCreatedFrom);
    set("skuCreatedTo", query.skuCreatedTo);
    setPage("sku", query.skuPage, query.skuSize);
  } else if (query.view === "bundle") {
    set("bundleKeyword", query.bundleKeyword);
    set("bundleStart", query.bundleStart);
    set("bundleEnd", query.bundleEnd);
  } else if (query.view === "supply-price") {
    set("supplyPriceKeyword", query.supplyPriceKeyword);
    set("supplyPriceSkuType", query.supplyPriceSkuType);
    set("supplyPriceCountry", query.supplyPriceCountry);
  } else if (query.view === "aging") {
    set("agingKeyword", query.agingKeyword);
    set("agingCutoff", query.agingCutoff);
    set("agingWarehouseId", query.agingWarehouseId);
  } else if (query.view === "inventory-report") {
    set("reportKeyword", query.reportKeyword);
    set("reportStart", query.reportStart);
    set("reportEnd", query.reportEnd);
  } else if (query.view === "sync-rules") {
    set("syncShop", query.syncShop);
  } else if (query.view === "sync-exceptions") {
    set("syncPlatform", query.syncPlatform);
    set("syncShop", query.syncShop);
    set("syncStart", query.syncStart);
    set("syncEnd", query.syncEnd);
    set("syncKeyword", query.syncKeyword);
  }
  return `/products?${params.toString()}`;
}

export function unsupportedProductViewUrl(search: string) {
  const view = new URLSearchParams(search).get("view");
  return view !== null && !isProductView(view)
    ? toProductCenterUrl(parseProductCenterQuery(search))
    : undefined;
}

export function safeProductMessage(error: unknown, subject: string) {
  if (error instanceof ApiError && error.status === 403)
    return `当前账号没有${subject}所需权限。登录状态保持不变。`;
  if (error instanceof ApiError && error.status === 404)
    return "请求的商品资源不存在，或当前账号无法访问。";
  const errorDetails =
    error instanceof ApiError &&
    error.details &&
    typeof error.details === "object" &&
    !Array.isArray(error.details)
      ? (error.details as Record<string, unknown>)
      : {};
  if (
    error instanceof ApiError &&
    error.status === 409 &&
    (error.code === "shopify_authorization_conflict" ||
      errorDetails.reason === "shopify_connection_not_connected" ||
      errorDetails.reason === "shopify_scope_unavailable" ||
      errorDetails.scope === "read_products" ||
      error.message.includes("Shopify connection") ||
      error.message.includes("read_products"))
  ) {
    return "Shopify 店铺授权未连接或商品读取权限不可用，暂时无法读取或导入商品目录。请在店铺详情刷新授权状态后重试。";
  }
  if (error instanceof ApiError && error.status === 409)
    return "商品数据已变更。请刷新后再试。";
  return `暂时无法${subject}，请稍后重试。`;
}

const productDateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "short",
  timeStyle: "short",
});

export function ProductDateTime({ value }: { value?: string }) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "—";

  return <time dateTime={value}>{productDateTimeFormatter.format(date)}</time>;
}

function csvCell(value: string | number | undefined) {
  const text = value === undefined ? "" : String(value);
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

const inventorySkuCsvColumns = [
  "id",
  "version",
  "businessCode",
  "nameZh",
  "nameEn",
  "variantSummary",
  "masterSkuId",
  "masterSku",
  "unitCost",
  "currencyCode",
  "defaultWarehouseId",
  "status",
] as const;

export function inventorySkuCsv(items: ProductSku[]) {
  const lines = [
    inventorySkuCsvColumns.join(","),
    ...items.map((sku) => inventorySkuCsvColumns.map((column) => csvCell(
      column === "id" ? sku.id
        : column === "version" ? sku.version
        : column === "businessCode" ? sku.businessCode
        : column === "nameZh" ? sku.name
        : column === "nameEn" ? sku.nameEn
        : column === "variantSummary" ? sku.variantSummary
        : column === "masterSkuId" ? sku.masterSku?.id
        : column === "masterSku" ? sku.masterSku?.businessCode
        : column === "unitCost" ? sku.unitCost
        : column === "currencyCode" ? sku.currencyCode
        : column === "defaultWarehouseId" ? sku.defaultWarehouse?.id
        : sku.status,
    )).join(",")),
  ];
  return `\uFEFF${lines.join("\n")}\n`;
}

async function loadStableProductExportRows<T extends { id: string }>(
  request: Record<string, unknown>,
  loadPage: (request: Record<string, unknown>) => Promise<Page<T>>,
  subject: string,
) {
  const first = await loadPage({
    ...request,
    page: 0,
    size: EXPORT_PAGE_SIZE,
  });
  if (
    first.totalElements > MAX_EXPORT_ROWS ||
    first.totalPages > MAX_EXPORT_PAGES
  ) {
    throw new Error("导出结果超过 10,000 条，请先缩小筛选范围。");
  }
  const rows = [...first.items];
  for (let page = 1; page < first.totalPages; page += 1) {
    const next = await loadPage({
      ...request,
      page,
      size: EXPORT_PAGE_SIZE,
    });
    if (
      next.page !== page ||
      next.totalElements !== first.totalElements ||
      next.totalPages !== first.totalPages
    ) {
      throw new Error(`导出的${subject}数据已发生变化，请刷新后重试。`);
    }
    rows.push(...next.items);
    if (rows.length > MAX_EXPORT_ROWS) {
      throw new Error("导出结果超过 10,000 条，请先缩小筛选范围。");
    }
  }
  if (
    rows.length !== first.totalElements ||
    new Set(rows.map((row) => row.id)).size !== rows.length
  ) {
    throw new Error(`导出的${subject}数据已发生变化，请刷新后重试。`);
  }
  return rows;
}

export function loadMasterSpuExportRows(
  request: Omit<ListRequest, "page" | "size">,
) {
  return loadStableProductExportRows(
    request,
    (pageRequest) => productCenterApi.listSpus(pageRequest as ListRequest),
    "主 SKU",
  );
}

export function loadInventorySkuExportRows(
  request: Omit<SkuListRequest, "page" | "size">,
) {
  return loadStableProductExportRows(
    request,
    (pageRequest) => productCenterApi.listSkus(pageRequest as SkuListRequest),
    "库存 SKU",
  );
}

function csvRows(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') { value += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else value += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") { row.push(value); value = ""; }
    else if (character === "\n") { row.push(value.replace(/\r$/, "")); rows.push(row); row = []; value = ""; }
    else value += character;
  }
  if (quoted) throw new Error("CSV 引号未闭合");
  if (value || row.length > 0) { row.push(value.replace(/\r$/, "")); rows.push(row); }
  return rows;
}

const masterSpuCsvColumns = [
  "id", "version", "businessCode", "nameZh", "nameEn", "brandName", "productNote",
  "categoryId", "lengthMm", "widthMm", "heightMm", "actualWeightGrams", "volumetricDivisor",
  "packageMaterialId", "packageableCount", "sensitiveAttributeCodes", "status", "imageFiles",
] as const;

type MasterSpuCsvRow = {
  rowNumber: number;
  values: Record<(typeof masterSpuCsvColumns)[number], string>;
};

export function parseMasterSpuCsv(source: string): MasterSpuCsvRow[] {
  const rows = csvRows(source).filter((row) => row.some((value) => value.trim()));
  if (rows.length < 2 || rows.length > 201) throw new Error("导入文件需包含 1–200 条数据行。");
  const headers = rows[0].map((value) => value.trim());
  if (new Set(headers).size !== headers.length || headers.some((header) => !masterSpuCsvColumns.includes(header as (typeof masterSpuCsvColumns)[number]))) {
    throw new Error("CSV 含有重复或不支持的列，请使用下载的导入模板。");
  }
  const required = ["businessCode", "nameZh"];
  if (required.some((key) => !headers.includes(key))) throw new Error("CSV 缺少 businessCode 或 nameZh 列。");
  return rows.slice(1).map((row, index) => ({
    rowNumber: index + 2,
    values: Object.fromEntries(masterSpuCsvColumns.map((column) => [
      column,
      row[headers.indexOf(column)]?.trim() ?? "",
    ])) as MasterSpuCsvRow["values"],
  }));
}

function csvOptionalUuid(value: string, field: string) {
  if (!value) return undefined;
  if (!isValidProductId(value)) throw new Error(`${field} 必须是模板中导出的标识。`);
  return value.toLowerCase();
}

function csvOptionalInteger(value: string, field: string, max: number) {
  if (!value) return undefined;
  if (!/^\d+$/.test(value)) throw new Error(`${field} 必须是正整数。`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) throw new Error(`${field} 超出允许范围。`);
  return parsed;
}

function csvSensitiveAttributes(value: string) {
  if (!value) return [];
  const codes = value.split(";").map((item) => item.trim()).filter(Boolean);
  if (codes.some((code) => !sensitiveAttributeCodes.includes(code as (typeof sensitiveAttributeCodes)[number])) || new Set(codes).size !== codes.length) {
    throw new Error("敏感属性选项无效，请重新选择。");
  }
  return codes as (typeof sensitiveAttributeCodes)[number][];
}

export function masterSpuInputFromCsv(row: MasterSpuCsvRow) {
  const values = row.values;
  const businessCode = values.businessCode.toUpperCase();
  if (!BUSINESS_CODE_PATTERN.test(businessCode)) throw new Error("主 SKU 编码格式不正确。");
  if (!values.nameZh || values.nameZh.length > 200) throw new Error("中文名称不能为空且不得超过 200 个字符。");
  const divisor = values.volumetricDivisor ? Number(values.volumetricDivisor) : undefined;
  if (divisor !== undefined && divisor !== 5000 && divisor !== 6000) throw new Error("体积重系数只能是 5000 或 6000。");
  const dimensions = [values.lengthMm, values.widthMm, values.heightMm]
    .map((value) => csvOptionalInteger(value, "尺寸", 1_000_000));
  if (dimensions.filter((value) => value !== undefined).length % 3 !== 0) throw new Error("长、宽、高必须同时填写。");
  const packageMaterialId = csvOptionalUuid(values.packageMaterialId, "包装资料");
  const packageableCount = csvOptionalInteger(values.packageableCount, "每包装件数", 1_000_000);
  if ((packageMaterialId === undefined) !== (packageableCount === undefined)) throw new Error("包装资料与每包装件数必须同时填写。");
  return {
    businessCode,
    name: values.nameZh,
    nameZh: values.nameZh,
    nameEn: values.nameEn || undefined,
    brandName: values.brandName || undefined,
    productNote: values.productNote || undefined,
    categoryId: csvOptionalUuid(values.categoryId, "商品目录"),
    lengthMm: dimensions[0], widthMm: dimensions[1], heightMm: dimensions[2],
    actualWeightGrams: csvOptionalInteger(values.actualWeightGrams, "实际重量", 1_000_000_000),
    volumetricDivisor: divisor as 5000 | 6000 | undefined,
    packageMaterialId, packageableCount,
    sensitiveAttributeCodes: csvSensitiveAttributes(values.sensitiveAttributeCodes),
  };
}

function statusLabel(status: ProductStatus) {
  return status === "ACTIVE"
    ? "启用"
    : status === "INACTIVE"
      ? "停用"
      : "已归档";
}

function SpuThumbnail({ spu }: { spu: ProductSpu }) {
  const [state, setState] = useState<
    { status: "loading" } | { status: "ready"; url?: string } | { status: "error" }
  >({ status: "loading" });
  useEffect(() => {
    let active = true;
    let url: string | undefined;
    void productCenterApi.listSpuImages(spu.id).then(
      async (images) => {
        const image: ProductImage | undefined = images.find((candidate) => candidate.primary) ?? images[0];
        if (!image) {
          if (active) setState({ status: "ready" });
          return;
        }
        const blob = await productCenterApi.getSpuImageBlob(spu.id, image.id);
        const nextUrl = URL.createObjectURL(blob);
        if (active) {
          url = nextUrl;
          setState({ status: "ready", url });
        } else {
          URL.revokeObjectURL(nextUrl);
        }
      },
      () => {
        if (active) setState({ status: "error" });
      },
    ).catch(() => {
      if (active) setState({ status: "error" });
    });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [spu.id]);
  if (state.status === "ready" && state.url) {
    return <img className="product-list-thumbnail" src={state.url} alt={`${spu.name} 图片`} />;
  }
  return <span className="product-list-thumbnail product-list-thumbnail-empty" aria-label={state.status === "error" ? "商品图片暂时不可用" : "商品待补图"}>{state.status === "loading" ? "加载中" : state.status === "error" ? "图片不可用" : "待补图"}</span>;
}

function useSpuThumbnailUrl(spuId: string) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    void productCenterApi.listSpuImages(spuId).then(async (images) => {
      const image = images.find((candidate) => candidate.primary) ?? images[0];
      if (!image) return;
      objectUrl = URL.createObjectURL(await productCenterApi.getSpuImageBlob(spuId, image.id));
      if (active) setUrl(objectUrl);
      else URL.revokeObjectURL(objectUrl);
    }).catch(() => undefined);
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [spuId]);
  return url;
}

function skuThumbnailKey(spuId: string, imageId: string) {
  return `${spuId}:${imageId}`;
}

function useSkuThumbnailUrls(skus: ProductSku[]) {
  const references = useMemo(() => {
    const unique = new Map<string, { spuId: string; imageId: string }>();
    for (const sku of skus) {
      const imageId = sku.masterSku?.thumbnailImageId;
      if (!imageId) continue;
      const key = skuThumbnailKey(sku.spuId, imageId);
      unique.set(key, { spuId: sku.spuId, imageId });
    }
    return [...unique.entries()].map(([key, reference]) => ({
      key,
      ...reference,
    }));
  }, [skus]);
  const signature = references
    .map((reference) => reference.key)
    .join("|");
  const [urls, setUrls] = useState<Map<string, string | null>>(
    () => new Map(),
  );
  useEffect(() => {
    let active = true;
    let cursor = 0;
    const objectUrls: string[] = [];
    const loaded = new Map<string, string | null>();
    setUrls(new Map());
    const worker = async () => {
      while (cursor < references.length) {
        const reference = references[cursor];
        cursor += 1;
        if (!reference) continue;
        try {
          const blob = await productCenterApi.getSpuImageBlob(
            reference.spuId,
            reference.imageId,
          );
          const url = URL.createObjectURL(blob);
          if (!active) {
            URL.revokeObjectURL(url);
            return;
          }
          objectUrls.push(url);
          loaded.set(reference.key, url);
        } catch {
          loaded.set(reference.key, null);
        }
      }
    };
    const workers = Array.from(
      { length: Math.min(4, references.length) },
      () => worker(),
    );
    void Promise.all(workers).then(() => {
      if (active) setUrls(new Map(loaded));
    });
    return () => {
      active = false;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [signature]);
  return urls;
}

function SkuThumbnail({
  sku,
  parentThumbnailUrl,
  urls,
}: {
  sku: ProductSku;
  parentThumbnailUrl?: string;
  urls: Map<string, string | null>;
}) {
  if (parentThumbnailUrl) {
    return (
      <img
        className="product-list-thumbnail"
        src={parentThumbnailUrl}
        alt="主商品图片"
      />
    );
  }
  const imageId = sku.masterSku?.thumbnailImageId;
  if (!imageId) {
    return (
      <span className="product-list-thumbnail product-list-thumbnail-empty">
        暂无主商品图片
      </span>
    );
  }
  const key = skuThumbnailKey(sku.spuId, imageId);
  const url = urls.get(key);
  if (typeof url === "string") {
    return (
      <img
        className="product-list-thumbnail"
        src={url}
        alt={`${sku.masterSku?.name ?? "主商品"} 图片`}
      />
    );
  }
  return (
    <span
      className="product-list-thumbnail product-list-thumbnail-empty"
      aria-label={url === null ? "商品图片暂时不可用" : "正在加载商品图片"}
    >
      {url === null ? "图片不可用" : "加载中"}
    </span>
  );
}

type InventorySkuSummaryState =
  | { status: "not-permitted" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; values: Map<string, InventorySkuSummary> };

function useInventorySkuSummaries(
  skus: ProductSku[],
  enabled: boolean,
): InventorySkuSummaryState {
  const skuIds = useMemo(
    () => [...new Set(skus.map((sku) => sku.id))],
    [skus],
  );
  const signature = skuIds.join("|");
  const [state, setState] = useState<InventorySkuSummaryState>(
    enabled
      ? { status: "ready", values: new Map() }
      : { status: "not-permitted" },
  );
  useEffect(() => {
    let active = true;
    if (!enabled) {
      setState({ status: "not-permitted" });
      return () => {
        active = false;
      };
    }
    if (skuIds.length === 0) {
      setState({ status: "ready", values: new Map() });
      return () => {
        active = false;
      };
    }
    setState({ status: "loading" });
    const chunks: string[][] = [];
    for (let index = 0; index < skuIds.length; index += 50) {
      chunks.push(skuIds.slice(index, index + 50));
    }
    void Promise.all(
      chunks.map((chunk) => inventoryApi.listSkuSummaries(chunk)),
    ).then(
      (results) => {
        if (!active) return;
        setState({
          status: "ready",
          values: new Map(
            results
              .flat()
              .map((summary) => [summary.skuId, summary] as const),
          ),
        });
      },
      () => {
        if (active) setState({ status: "error" });
      },
    );
    return () => {
      active = false;
    };
  }, [enabled, signature]);
  return state;
}

function InventorySkuQuantity({
  skuId,
  field,
  state,
}: {
  skuId: string;
  field: "onHand" | "reserved" | "available";
  state: InventorySkuSummaryState;
}) {
  if (state.status === "not-permitted") {
    return <span aria-label="需要库存读取权限">无权限</span>;
  }
  if (state.status === "loading") {
    return <span aria-label="正在加载库存摘要">加载中</span>;
  }
  if (state.status === "error") {
    return <span aria-label="库存摘要暂时不可用">暂不可用</span>;
  }
  return <>{state.values.get(skuId)?.[field] ?? 0}</>;
}

type SkuSalesSummaryState =
  | { status: "not-permitted" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; values: Map<string, SkuSalesSummary> };

function useSkuSalesSummaries(
  skus: ProductSku[],
  enabled: boolean,
): SkuSalesSummaryState {
  const skuIds = useMemo(
    () => [...new Set(skus.map((sku) => sku.id))],
    [skus],
  );
  const signature = skuIds.join("|");
  const [state, setState] = useState<SkuSalesSummaryState>(
    enabled
      ? { status: "ready", values: new Map() }
      : { status: "not-permitted" },
  );
  useEffect(() => {
    let active = true;
    if (!enabled) {
      setState({ status: "not-permitted" });
      return () => {
        active = false;
      };
    }
    if (skuIds.length === 0) {
      setState({ status: "ready", values: new Map() });
      return () => {
        active = false;
      };
    }
    setState({ status: "loading" });
    const chunks: string[][] = [];
    for (let index = 0; index < skuIds.length; index += 50) {
      chunks.push(skuIds.slice(index, index + 50));
    }
    void Promise.all(
      chunks.map((chunk) =>
        orderCenterApi.listSkuSalesSummaries(chunk)),
    ).then(
      (results) => {
        if (!active) return;
        setState({
          status: "ready",
          values: new Map(
            results
              .flat()
              .map((summary) => [summary.skuId, summary] as const),
          ),
        });
      },
      () => {
        if (active) setState({ status: "error" });
      },
    );
    return () => {
      active = false;
    };
  }, [enabled, signature]);
  return state;
}

type SkuListingSummaryState =
  | { status: "not-permitted" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; values: Map<string, SkuListingSummary> };

function useSkuListingSummaries(
  skus: ProductSku[],
  enabled: boolean,
): SkuListingSummaryState {
  const skuIds = useMemo(
    () => [...new Set(skus.map((sku) => sku.id))],
    [skus],
  );
  const signature = skuIds.join("|");
  const [state, setState] = useState<SkuListingSummaryState>(
    enabled
      ? { status: "ready", values: new Map() }
      : { status: "not-permitted" },
  );
  useEffect(() => {
    let active = true;
    if (!enabled) {
      setState({ status: "not-permitted" });
    } else if (skuIds.length === 0) {
      setState({ status: "ready", values: new Map() });
    } else {
      setState({ status: "loading" });
      const chunks: string[][] = [];
      for (let index = 0; index < skuIds.length; index += 50) {
        chunks.push(skuIds.slice(index, index + 50));
      }
      void Promise.all(
        chunks.map((chunk) =>
          productCenterApi.listSkuListingSummaries(chunk)),
      ).then(
        (results) => {
          if (active) {
            setState({
              status: "ready",
              values: new Map(results.flat().map(
                (summary) => [summary.skuId, summary] as const,
              )),
            });
          }
        },
        () => {
          if (active) setState({ status: "error" });
        },
      );
    }
    return () => {
      active = false;
    };
  }, [enabled, signature]);
  return state;
}

function SkuListingCount({
  skuId,
  state,
}: {
  skuId: string;
  state: SkuListingSummaryState;
}) {
  if (state.status === "not-permitted") {
    return <span aria-label="需要在线商品读取权限">无权限</span>;
  }
  if (state.status === "loading") {
    return <span aria-label="正在加载在线商品配对数量">加载中</span>;
  }
  if (state.status === "error") {
    return <span aria-label="在线商品配对数量暂时不可用">暂不可用</span>;
  }
  return (
    <span aria-label="已配对在线商品数量">
      {state.values.get(skuId)?.activeListingCount ?? 0}
    </span>
  );
}

function SkuSalesValue({
  skuId,
  state,
}: {
  skuId: string;
  state: SkuSalesSummaryState;
}) {
  if (state.status === "not-permitted") {
    return <span aria-label="需要订单读取权限">无权限</span>;
  }
  if (state.status === "loading") {
    return <span aria-label="正在加载 SKU 销量">加载中</span>;
  }
  if (state.status === "error") {
    return <span aria-label="SKU 销量暂时不可用">暂不可用</span>;
  }
  const summary = state.values.get(skuId);
  return summary
    ? <>{summary.sales7} / {summary.sales28} / {summary.sales42}</>
    : <>0 / 0 / 0</>;
}

type PreferredSupplierState =
  | { status: "not-permitted" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; values: Map<string, PreferredSupplierSkuSummary> };

function usePreferredSuppliers(
  skus: ProductSku[],
  enabled: boolean,
): PreferredSupplierState {
  const skuIds = useMemo(
    () => [...new Set(skus.map((sku) => sku.id))],
    [skus],
  );
  const signature = skuIds.join("|");
  const [state, setState] = useState<PreferredSupplierState>(
    enabled
      ? { status: "ready", values: new Map() }
      : { status: "not-permitted" },
  );
  useEffect(() => {
    let active = true;
    if (!enabled) {
      setState({ status: "not-permitted" });
    } else if (skuIds.length === 0) {
      setState({ status: "ready", values: new Map() });
    } else {
      setState({ status: "loading" });
      const chunks: string[][] = [];
      for (let index = 0; index < skuIds.length; index += 50) {
        chunks.push(skuIds.slice(index, index + 50));
      }
      void Promise.all(
        chunks.map((chunk) =>
          supplierSkuMappingApi.listPreferredSummaries(chunk)),
      ).then(
        (results) => {
          if (active) {
            setState({
              status: "ready",
              values: new Map(results.flat().map(
                (summary) => [summary.skuId, summary] as const,
              )),
            });
          }
        },
        () => {
          if (active) setState({ status: "error" });
        },
      );
    }
    return () => {
      active = false;
    };
  }, [enabled, signature]);
  return state;
}

function PreferredSupplierValue({
  skuId,
  state,
}: {
  skuId: string;
  state: PreferredSupplierState;
}) {
  if (state.status === "not-permitted") {
    return <span aria-label="需要供应商读取权限">无权限</span>;
  }
  if (state.status === "loading") return <>加载中</>;
  if (state.status === "error") return <>暂不可用</>;
  const value = state.values.get(skuId);
  return value
    ? <>{value.supplierBusinessCode} · {value.supplierName}</>
    : <>—</>;
}

function nextStatusAction(status: ProductStatus): ProductEditorAction | null {
  if (status === "ACTIVE") return "deactivate";
  if (status === "INACTIVE") return "activate";
  return null;
}

export function ProductCenterPage() {
  const { hasPermission } = useAuth();
  const router = useRouter();
  const search = useRouterState({
    select: (state) => state.location.searchStr,
  });
  const query = useMemo(() => parseProductCenterQuery(search), [search]);
  const unsupportedViewUrl = useMemo(
    () => unsupportedProductViewUrl(search),
    [search],
  );
  const [spus, setSpus] = useState<LoadState<Page<ProductSpu>>>({
    status: "loading",
  });
  const [skus, setSkus] = useState<
    LoadState<Page<ProductSku>> | { status: "idle" }
  >({ status: "idle" });
  const [listings, setListings] = useState<
    LoadState<Page<ProductListing>> | { status: "not-permitted" }
  >({ status: "not-permitted" });
  const [listingFilterOptions, setListingFilterOptions] =
    useState<ListingShopOptionsState>({ status: "idle" });
  const [masterFilterOptions, setMasterFilterOptions] = useState<
    { status: "idle" } | { status: "ready"; categories: ProductCategory[]; members: ProductAssignableMember[]; packages: ProductPackageMaterial[] }
  >({ status: "idle" });
  const [refreshKey, setRefreshKey] = useState(0);
  const [editor, setEditor] = useState<ProductEditor | null>(null);
  const [packagingRulesSku, setPackagingRulesSku] =
    useState<ProductSku | null>(null);
  const [skuParentPickerOpen, setSkuParentPickerOpen] = useState(false);
  const [skuCreateParent, setSkuCreateParent] = useState<ProductSpu | null>(
    null,
  );
  const [masterDataManager, setMasterDataManager] = useState<
    "category" | "package" | null
  >(null);
  const [masterTransferMode, setMasterTransferMode] = useState<"create" | "update" | null>(null);
  const [masterTransferError, setMasterTransferError] = useState<string>();
  const [inventoryExportError, setInventoryExportError] = useState<string>();
  const [inventoryExportBusy, setInventoryExportBusy] = useState(false);
  const spuVersion = useRef(0);
  const skuVersion = useRef(0);
  const listingVersion = useRef(0);
  const inventoryExportBusyRef = useRef(false);
  const canReadListings = hasPermission("products.listing.read");
  const canWriteProducts = hasPermission("products.write");
  const canWriteListings = hasPermission("products.listing.write");
  // A listing maps to a tenant shop and displays its platform. Both directories
  // must be readable before the selector can safely be opened.
  const canReadListingShops =
    hasPermission("shop:read") && hasPermission("platform:read");
  const canReadMasterData = hasPermission("products.master_data.read");
  const canReadInventory = hasPermission("inventory.read");
  const canReadOrders = hasPermission("orders.read");
  const canReadSuppliers = hasPermission("suppliers.read");
  const canWriteSkuWeight = hasPermission("products.weight.write");

  const updateQuery = useCallback(
    (patch: Partial<Query>) => {
      router.history.push(toProductCenterUrl({ ...query, ...patch }));
    },
    [query, router.history],
  );

  const loadSpus = useCallback(async () => {
    const version = ++spuVersion.current;
    if (!shouldLoadSpus(query.view, query.spuId)) return;
    setSpus((previous) => ({
      status: "loading",
      data: "data" in previous ? previous.data : undefined,
    }));
    try {
      const page = await productCenterApi.listSpus({
        status: query.status,
        keyword: query.keyword || undefined,
        searchField: query.searchField ?? "ALL",
        categoryId: query.categoryId,
        creatorId: query.creatorId,
        createdFrom: dateStartUtc8(query.createdFrom),
        createdTo: dateEndExclusiveUtc8(query.createdTo),
        sortBy: query.sortBy ?? "BUSINESS_CODE",
        descending: query.descending,
        page: query.page,
        size: query.size,
      });
      if (version === spuVersion.current)
        setSpus({ status: "ready", data: page });
    } catch (error) {
      if (version === spuVersion.current)
        setSpus({
          status: "error",
          message: safeProductMessage(error, "读取商品主数据"),
        });
    }
  }, [
    query.keyword,
    query.searchField,
    query.categoryId,
    query.creatorId,
    query.createdFrom,
    query.createdTo,
    query.sortBy,
    query.descending,
    query.page,
    query.size,
    query.spuId,
    query.status,
    query.view,
  ]);

  const loadSkus = useCallback(async () => {
    const version = ++skuVersion.current;
    const scope = skuReadScope(query.view, query.spuId);
    if (!scope.load) {
      setSkus({ status: "idle" });
      return;
    }
    setSkus((previous) => ({
      status: "loading",
      data: "data" in previous ? previous.data : undefined,
    }));
    try {
      const page = await productCenterApi.listSkus({
        spuId: scope.spuId,
        status: query.skuStatus,
        keyword: query.skuKeyword || undefined,
        categoryId: query.view === "inventory"
          ? query.categoryId
          : undefined,
        creatorId: query.view === "inventory"
          ? query.skuCreatorId
          : undefined,
        createdFrom: query.view === "inventory"
          ? dateStartUtc8(query.skuCreatedFrom)
          : undefined,
        createdTo: query.view === "inventory"
          ? dateEndExclusiveUtc8(query.skuCreatedTo)
          : undefined,
        searchField: query.view === "inventory"
          ? query.skuSearchField
          : "ALL",
        matchMode: query.view === "inventory"
          ? query.skuMatchMode
          : "CONTAINS",
        sortBy: query.view === "inventory"
          ? query.skuSortBy
          : "BUSINESS_CODE",
        descending: query.view === "inventory"
          ? query.skuDescending
          : false,
        page: query.skuPage,
        size: query.skuSize,
      });
      if (version === skuVersion.current)
        setSkus({ status: "ready", data: page });
    } catch (error) {
      if (version === skuVersion.current)
        setSkus({
          status: "error",
          message: safeProductMessage(error, "读取 SKU 列表"),
        });
    }
  }, [
    query.skuKeyword,
    query.categoryId,
    query.skuCreatorId,
    query.skuCreatedFrom,
    query.skuCreatedTo,
    query.skuMatchMode,
    query.skuPage,
    query.skuSearchField,
    query.skuSortBy,
    query.skuDescending,
    query.skuSize,
    query.skuStatus,
    query.spuId,
    query.view,
  ]);

  const loadListings = useCallback(async () => {
    const version = ++listingVersion.current;
    if (!shouldLoadListings(canReadListings, query.view)) {
      setListings({ status: "not-permitted" });
      return;
    }
    setListings((previous) => ({
      status: "loading",
      data: "data" in previous ? previous.data : undefined,
    }));
    try {
      const page = await productCenterApi.listListings({
        shopId: query.listingShopId,
        status: query.listingStatus,
        keyword: query.listingKeyword || undefined,
        searchField: query.listingSearchField,
        page: query.listingPage,
        size: query.listingSize,
      });
      if (version === listingVersion.current)
        setListings({ status: "ready", data: page });
    } catch (error) {
      if (version === listingVersion.current)
        setListings({
          status: "error",
          message: safeProductMessage(error, "读取在线商品映射"),
        });
    }
  }, [
    canReadListings,
    query.listingKeyword,
    query.listingPage,
    query.listingSearchField,
    query.listingShopId,
    query.listingSize,
    query.listingStatus,
    query.view,
  ]);

  const refreshAll = useCallback(() => setRefreshKey((value) => value + 1), []);
  const exportMasterSpus = useCallback(async (templateOnly = false) => {
    const columns = masterSpuCsvColumns;
    try {
      const request = {
        status: query.status, keyword: query.keyword || undefined, searchField: query.searchField ?? "ALL",
        categoryId: query.categoryId,
        creatorId: query.creatorId,
        createdFrom: dateStartUtc8(query.createdFrom),
        createdTo: dateEndExclusiveUtc8(query.createdTo),
        sortBy: query.sortBy ?? "BUSINESS_CODE", descending: query.descending,
      };
      const rows = templateOnly ? [] : await loadMasterSpuExportRows(request);
      const lines = [columns.join(","), ...rows.map((spu) => columns.map((column) => csvCell(
        column === "id" ? spu.id
          : column === "version" ? spu.version
          : column === "businessCode" ? spu.businessCode
          : column === "nameZh" ? spu.nameZh ?? spu.name
          : column === "nameEn" ? spu.nameEn
          : column === "brandName" ? spu.brandName
          : column === "productNote" ? spu.productNote
          : column === "categoryId" ? spu.category?.id
          : column === "lengthMm" ? spu.lengthMm
          : column === "widthMm" ? spu.widthMm
          : column === "heightMm" ? spu.heightMm
          : column === "actualWeightGrams" ? spu.actualWeightGrams
          : column === "volumetricDivisor" ? spu.volumetricDivisor
          : column === "packageMaterialId" ? spu.packageMaterial?.id
          : column === "packageableCount" ? spu.packageableCount
          : column === "sensitiveAttributeCodes" ? spu.sensitiveAttributeCodes.join(";")
          : column === "status" ? spu.status
          : "",
      )).join(","))];
      const url = URL.createObjectURL(new Blob([`\uFEFF${lines.join("\n")}\n`], { type: "text/csv;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = templateOnly ? "主SKU导入模板.csv" : "主SKU导出.csv";
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      setMasterTransferError(
        error instanceof Error && !(error instanceof ApiError)
          ? error.message
          : safeProductMessage(error, "导出主商品"),
      );
    }
  }, [query]);
  const exportInventorySkus = useCallback(async () => {
    if (inventoryExportBusyRef.current) return;
    inventoryExportBusyRef.current = true;
    setInventoryExportBusy(true);
    setInventoryExportError(undefined);
    try {
      const request = {
        status: query.skuStatus,
        keyword: query.skuKeyword || undefined,
        categoryId: query.categoryId,
        creatorId: query.skuCreatorId,
        createdFrom: dateStartUtc8(query.skuCreatedFrom),
        createdTo: dateEndExclusiveUtc8(query.skuCreatedTo),
        searchField: query.skuSearchField,
        matchMode: query.skuMatchMode,
        sortBy: query.skuSortBy,
        descending: query.skuDescending,
      };
      const rows = await loadInventorySkuExportRows(request);
      const url = URL.createObjectURL(new Blob(
        [inventorySkuCsv(rows)],
        { type: "text/csv;charset=utf-8" },
      ));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "库存SKU导出.csv";
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      setInventoryExportError(
        error instanceof Error && !(error instanceof ApiError)
          ? error.message
          : safeProductMessage(error, "导出库存 SKU"),
      );
    } finally {
      inventoryExportBusyRef.current = false;
      setInventoryExportBusy(false);
    }
  }, [query]);
  useEffect(() => {
    if (unsupportedViewUrl) router.history.replace(unsupportedViewUrl);
  }, [unsupportedViewUrl, router.history]);
  useEffect(() => {
    void loadSpus();
  }, [loadSpus, refreshKey]);
  useEffect(() => {
    void loadSkus();
  }, [loadSkus, refreshKey]);
  useEffect(() => {
    void loadListings();
  }, [loadListings, refreshKey]);
  useEffect(() => {
    let active = true;
    if (!["master", "inventory"].includes(query.view) || !canReadMasterData) {
      setMasterFilterOptions({ status: "idle" });
      return () => { active = false; };
    }
    const isCurrent = () => active;
    void Promise.all([
      loadAllPages(
        (page) => productCenterApi.listCategories({ page, size: 200 }),
        isCurrent,
      ),
      loadAllPages(
        // The product-scoped member directory caps page size at 100.
        (page) => productCenterApi.listAssignableMembers({ page, size: 100 }),
        isCurrent,
      ),
      loadAllPages(
        (page) => productCenterApi.listPackageMaterials({ page, size: 200 }),
        isCurrent,
      ),
    ]).then(([categories, members, packages]) => {
      if (!active || !categories || !members || !packages) return;
      setMasterFilterOptions({ status: "ready", categories, members, packages });
    }, () => {
      if (active) setMasterFilterOptions({ status: "idle" });
    });
    return () => { active = false; };
  }, [canReadMasterData, query.view]);
  useEffect(() => {
    let active = true;
    if (query.view !== "online" || !canReadListingShops) {
      setListingFilterOptions({ status: "idle" });
      return () => { active = false; };
    }
    setListingFilterOptions((previous) => ({
      status: "loading",
      data: "data" in previous ? previous.data : undefined,
    }));
    const isCurrent = () => active;
    void Promise.all([
      loadAllPages(
        (page) => shopCenterApi.listShops({
          includeArchived: false,
          page,
          size: 200,
        }),
        isCurrent,
      ),
      loadAllPages(
        (page) => shopCenterApi.listPlatforms({
          includeArchived: false,
          page,
          size: 200,
        }),
        isCurrent,
      ),
    ]).then(([shops, platforms]) => {
      if (!active || !shops || !platforms) return;
      setListingFilterOptions({
        status: "ready",
        data: {
          shops,
          platforms: new Map(platforms.map((platform) => [platform.id, platform])),
        },
      });
    }, () => {
      if (active) {
        setListingFilterOptions({
          status: "error",
          message: "店铺目录暂时无法读取，请稍后重试。",
        });
      }
    });
    return () => { active = false; };
  }, [canReadListingShops, query.view, refreshKey]);

  const availableSkus = skus.status === "ready" ? skus.data.items : [];
  return (
    <section
      className="product-center-page"
      aria-labelledby="product-center-title"
    >
      <header className="product-workbench-heading">
        <h1 id="product-center-title">{productViewLabels[query.view]}</h1>
      </header>
      {query.view === "online" && (
        <ListingSection
          state={listings}
          shopOptions={listingFilterOptions}
          canWrite={canWriteListings}
          canReadListingShops={canReadListingShops}
          shopId={query.listingShopId}
          status={query.listingStatus}
          keyword={query.listingKeyword}
          searchField={query.listingSearchField}
          onFilter={(
            listingShopId,
            listingStatus,
            listingSearchField,
            listingKeyword,
          ) =>
            updateQuery({
              listingShopId,
              listingStatus,
              listingSearchField,
              listingKeyword,
              listingPage: 0,
            })
          }
          onEdit={(item, action) =>
            setEditor({ kind: "listing", action, item })
          }
          onCreate={() => setEditor({ kind: "listing", action: "create" })}
          onImported={refreshAll}
          onRetry={refreshAll}
          onPageChange={(listingPage) => updateQuery({ listingPage })}
          onPageSizeChange={(listingSize) =>
            updateQuery({ listingSize, listingPage: 0 })
          }
        />
      )}
      {query.view === "bundle" && (
        <BundleSkuSection
          keyword={query.bundleKeyword ?? ""}
          start={query.bundleStart}
          end={query.bundleEnd}
          canWrite={canWriteProducts}
          onFilter={(bundleKeyword, bundleStart, bundleEnd) =>
            updateQuery({ bundleKeyword, bundleStart, bundleEnd })
          }
        />
      )}
      {query.view === "supply-price" && (
        <SupplyPriceSection
          keyword={query.supplyPriceKeyword ?? ""}
          skuType={query.supplyPriceSkuType ?? ""}
          country={query.supplyPriceCountry ?? ""}
          canWrite={canWriteProducts}
          onFilter={(
            supplyPriceKeyword,
            supplyPriceSkuType,
            supplyPriceCountry,
          ) =>
            updateQuery({
              supplyPriceKeyword,
              supplyPriceSkuType,
              supplyPriceCountry,
            })
          }
        />
      )}
      {query.view === "aging" && (
        <InventoryAgingSection
          keyword={query.agingKeyword ?? ""}
          cutoff={query.agingCutoff}
          warehouseId={query.agingWarehouseId}
          onFilter={(agingKeyword, agingCutoff, agingWarehouseId) =>
            updateQuery({ agingKeyword, agingCutoff, agingWarehouseId })
          }
          onReset={() =>
            updateQuery({
              agingKeyword: undefined,
              agingCutoff: undefined,
              agingWarehouseId: undefined,
            })
          }
        />
      )}
      {query.view === "inventory-report" && (
        <InventoryReportSection
          keyword={query.reportKeyword ?? ""}
          start={query.reportStart}
          end={query.reportEnd}
          onFilter={(
            reportKeyword,
            reportStart,
            reportEnd,
          ) =>
            updateQuery({
              reportKeyword,
              reportStart,
              reportEnd,
            })
          }
          onReset={() =>
            updateQuery({
              reportKeyword: undefined,
              reportStart: undefined,
              reportEnd: undefined,
            })
          }
        />
      )}
      {query.view === "sync-rules" && (
        <InventorySyncRulesSection
          selectedShopId={query.syncShop}
          canRead={
            hasPermission("shop:read")
            && hasPermission("platform:read")
            && hasPermission("warehouses.read")
          }
          canWrite={
            hasPermission("shop:write")
            && hasPermission("warehouses.write")
          }
          onShopChange={(syncShop) => updateQuery({ syncShop })}
        />
      )}
      {query.view === "sync-exceptions" && (
        <InventorySyncExceptionsSection
          platform={query.syncPlatform ?? ""}
          shop={query.syncShop ?? ""}
          start={query.syncStart}
          end={query.syncEnd}
          keyword={query.syncKeyword ?? ""}
          onFilter={(
            syncPlatform,
            syncShop,
            syncStart,
            syncEnd,
            syncKeyword,
          ) =>
            updateQuery({
              syncPlatform,
              syncShop,
              syncStart,
              syncEnd,
              syncKeyword,
            })
          }
        />
      )}
      {query.view === "master" && (
        query.spuId ? (
          <SkuSection
            state={skus}
            selectedSpuId={query.spuId}
            title="销售 SKU"
            description="查看所选主商品的销售 SKU。"
            canWrite={canWriteProducts}
            canWriteListings={canWriteListings}
            canReadListingShops={canReadListingShops}
            status={query.skuStatus}
            keyword={query.skuKeyword}
            searchField="INVENTORY_SKU"
            matchMode="CONTAINS"
            onFilter={(skuStatus, skuKeyword) =>
              updateQuery({ skuStatus, skuKeyword, skuPage: 0 })
            }
            onEdit={(item, action) => setEditor({ kind: "sku", action, item })}
            onCreate={() => setEditor({ kind: "sku", action: "create" })}
            onMap={(skuId) =>
              setEditor({ kind: "listing", action: "create", skuId })
            }
            onPackagingRules={setPackagingRulesSku}
            onClear={() => updateQuery({ spuId: undefined, skuPage: 0 })}
            onRetry={refreshAll}
            onPageChange={(skuPage) => updateQuery({ skuPage })}
            onPageSizeChange={(skuSize) =>
              updateQuery({ skuSize, skuPage: 0 })
            }
          />
        ) : (
          <>
            {masterTransferError && <div className="inline-alert" role="alert">{masterTransferError}</div>}
            <MasterProductFilters
              query={query}
              categories={masterFilterOptions.status === "ready" ? masterFilterOptions.categories : []}
              members={masterFilterOptions.status === "ready" ? masterFilterOptions.members : []}
              onApply={(patch) => updateQuery({ ...patch, page: 0, spuId: undefined })}
            />
            <SpuSection
              state={spus}
              selectedSpuId={query.spuId}
              canWrite={canWriteProducts}
              onEdit={(item) =>
                router.history.push(productMasterPagePath(item.id, search, true))
              }
              onView={(item) =>
                router.history.push(productMasterPagePath(item.id, search))
              }
              onSelect={(spuId) => updateQuery({ spuId, skuPage: 0 })}
              onCreateSku={(spu) => {
                setSkuCreateParent(spu);
                setEditor({ kind: "sku", action: "create" });
              }}
              onRetry={refreshAll}
              onPageChange={(page) => updateQuery({ page })}
              onPageSizeChange={(size) => updateQuery({ size, page: 0 })}
              categories={masterFilterOptions.status === "ready" ? masterFilterOptions.categories : []}
              packages={masterFilterOptions.status === "ready" ? masterFilterOptions.packages : []}
              sortBy={query.sortBy ?? "BUSINESS_CODE"}
              descending={Boolean(query.descending)}
              onSort={(sortBy) => updateQuery({ sortBy, descending: query.sortBy === sortBy ? !query.descending : false, page: 0 })}
              toolbarActions={canWriteProducts ? (
                <details className="erp-action-menu erp-add-menu">
                  <summary className="button button-primary">添加</summary>
                  <div className="erp-action-menu-popover">
                    <button type="button" onClick={(event) => { closeActionMenu(event.currentTarget); router.history.push(productMasterNewPath(search)); }}>新增主 SKU</button>
                    <button type="button" onClick={(event) => { closeActionMenu(event.currentTarget); setMasterTransferMode("update"); }}>更新已有主 SKU</button>
                    <button type="button" onClick={(event) => { closeActionMenu(event.currentTarget); setMasterTransferMode("create"); }}>模板导入主 SKU</button>
                    <button type="button" onClick={(event) => { closeActionMenu(event.currentTarget); void exportMasterSpus(false); }}>导出主 SKU</button>
                  </div>
                </details>
              ) : undefined}
            />
          </>
        )
      )}
      {query.view === "inventory" && (
        <>
          {inventoryExportError && <div className="inline-alert" role="alert">{inventoryExportError}</div>}
          <SkuSection
          state={skus}
          title="库存 SKU 身份"
          description="统一维护库存 SKU 资料；库存按可查看仓库汇总，销量按账号权限展示。"
          standalone
          showSpuIdentity
          canWrite={canWriteProducts}
          canWriteListings={canWriteListings}
          canReadListingShops={canReadListingShops}
          canReadInventory={canReadInventory}
          canReadOrders={canReadOrders}
          canReadSuppliers={canReadSuppliers}
          canReadListings={canReadListings}
          status={query.skuStatus}
          keyword={query.skuKeyword}
          searchField={query.skuSearchField}
          matchMode={query.skuMatchMode}
          categoryId={query.categoryId}
          creatorId={query.skuCreatorId}
          createdFrom={query.skuCreatedFrom}
          createdTo={query.skuCreatedTo}
          categories={masterFilterOptions.status === "ready" ? masterFilterOptions.categories : []}
          members={masterFilterOptions.status === "ready" ? masterFilterOptions.members : []}
          referenceFiltersReady={masterFilterOptions.status === "ready"}
          sortBy={query.skuSortBy}
          descending={query.skuDescending}
          onFilter={(
            skuStatus,
            skuKeyword,
            skuSearchField,
            skuMatchMode,
            categoryId,
            skuCreatorId,
            skuCreatedFrom,
            skuCreatedTo,
          ) =>
            updateQuery({
              skuStatus,
              skuKeyword,
              skuSearchField,
              skuMatchMode,
              categoryId,
              skuCreatorId,
              skuCreatedFrom,
              skuCreatedTo,
              skuPage: 0,
            })
          }
          onEdit={(item, action) => setEditor({ kind: "sku", action, item })}
          onCreate={() => setSkuParentPickerOpen(true)}
          onMap={(skuId) =>
            setEditor({ kind: "listing", action: "create", skuId })
          }
          onPackagingRules={setPackagingRulesSku}
          onClear={() => undefined}
          onSort={(skuSortBy, skuDescending) =>
            updateQuery({ skuSortBy, skuDescending, skuPage: 0 })
          }
          onRetry={refreshAll}
          onPageChange={(skuPage) => updateQuery({ skuPage })}
          onPageSizeChange={(skuSize) =>
            updateQuery({ skuSize, skuPage: 0 })
          }
          onInventoryQuery={canReadInventory
            ? () => router.history.push("/products/inventory-query")
            : undefined}
          onExport={() => void exportInventorySkus()}
          exportBusy={inventoryExportBusy}
          toolbarActions={canReadMasterData ? (
            <details className="erp-action-menu">
              <summary className="button">更多功能</summary>
              <div className="erp-action-menu-popover">
                <button
                  type="button"
                  onClick={(event) => {
                    closeActionMenu(event.currentTarget);
                    setMasterDataManager("category");
                  }}
                >
                  商品目录管理
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    closeActionMenu(event.currentTarget);
                    setMasterDataManager("package");
                  }}
                >
                  包装资料管理
                </button>
              </div>
            </details>
          ) : undefined}
          />
        </>
      )}
      {masterDataManager && (
        <ProductMasterDataManager
          kind={masterDataManager}
          canWrite={hasPermission("products.master_data.write")}
          onClose={() => setMasterDataManager(null)}
          onChanged={refreshAll}
        />
      )}
      {skuParentPickerOpen && (
        <InventorySkuParentPickerDialog
          onClose={() => setSkuParentPickerOpen(false)}
          onSelect={(spu) => {
            setSkuParentPickerOpen(false);
            setSkuCreateParent(spu);
            setEditor({ kind: "sku", action: "create" });
          }}
        />
      )}
      {packagingRulesSku && (
        <SkuPackagingRuleDialog
          sku={packagingRulesSku}
          canWrite={canWriteSkuWeight}
          onClose={() => setPackagingRulesSku(null)}
        />
      )}
      {editor && (
        <ProductWriteDialog
          editor={editor}
          selectedSpuId={
            editor.kind === "sku" && editor.action === "create"
              ? skuCreateParent?.id ?? query.spuId
              : query.spuId
          }
          availableSkus={availableSkus}
          canReadListingShops={canReadListingShops}
          canReadSkuWarehouses={hasPermission("warehouses.read")}
          canWriteSkuWeight={canWriteSkuWeight}
          onClose={() => {
            setEditor(null);
            setSkuCreateParent(null);
          }}
          onSaved={(saved) => {
            setEditor(null);
            setSkuCreateParent(null);
            refreshAll();
            if (query.view === "master" && "spuId" in saved) {
              updateQuery({ spuId: saved.spuId });
            }
          }}
        />
      )}
      {masterTransferMode && <MasterSpuTransferDialog
        mode={masterTransferMode}
        onDownloadTemplate={() => exportMasterSpus(masterTransferMode === "create")}
        onClose={() => setMasterTransferMode(null)}
        onComplete={() => { setMasterTransferError(undefined); setMasterTransferMode(null); refreshAll(); }}
      />}
    </section>
  );
}

function ProductFilters({
  title,
  status,
  keyword,
  searchField = "INVENTORY_SKU",
  matchMode = "CONTAINS",
  categoryId,
  creatorId,
  createdFrom,
  createdTo,
  categories = [],
  members = [],
  referenceFiltersReady = false,
  showSearchFields = false,
  canReadSuppliers = false,
  onApply,
}: {
  title: string;
  status?: ProductStatus;
  keyword: string;
  searchField?: Query["skuSearchField"];
  matchMode?: ProductSkuMatchMode;
  categoryId?: string;
  creatorId?: string;
  createdFrom?: string;
  createdTo?: string;
  categories?: ProductCategory[];
  members?: ProductAssignableMember[];
  referenceFiltersReady?: boolean;
  showSearchFields?: boolean;
  canReadSuppliers?: boolean;
  onApply: (
    status: ProductStatus | undefined,
    keyword: string,
    searchField: Query["skuSearchField"],
    matchMode: ProductSkuMatchMode,
    categoryId: string | undefined,
    creatorId: string | undefined,
    createdFrom: string | undefined,
    createdTo: string | undefined,
  ) => void;
}) {
  const [selectedSearchField, setSelectedSearchField] =
    useState<Query["skuSearchField"]>(searchField);
  const [selectedMatchMode, setSelectedMatchMode] =
    useState<ProductSkuMatchMode>(matchMode);
  const advancedFilterCount = [
    categoryId,
    creatorId,
    createdFrom,
    createdTo,
  ].filter(Boolean).length;
  const applyForm = (form: HTMLFormElement, clearAdvanced = false) => {
    const values = new FormData(form);
    const submittedSearchField = queryInventorySkuSearchField(
      String(values.get("searchField") ?? ""),
    );
    onApply(
      queryStatus(String(values.get("status") ?? "")),
      String(values.get("keyword") ?? "")
        .trim()
        .slice(0, 100),
      submittedSearchField,
      submittedSearchField === "ALL"
        ? "CONTAINS"
        : queryInventorySkuMatchMode(
            String(values.get("matchMode") ?? ""),
          ),
      !clearAdvanced && showSearchFields && referenceFiltersReady
        ? queryUuid(String(values.get("categoryId") ?? ""))
        : clearAdvanced ? undefined : categoryId,
      !clearAdvanced && showSearchFields && referenceFiltersReady
        ? queryUuid(String(values.get("creatorId") ?? ""))
        : clearAdvanced ? undefined : creatorId,
      !clearAdvanced && showSearchFields
        ? queryDate(String(values.get("createdFrom") ?? ""))
        : clearAdvanced ? undefined : createdFrom,
      !clearAdvanced && showSearchFields
        ? queryDate(String(values.get("createdTo") ?? ""))
        : clearAdvanced ? undefined : createdTo,
    );
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    applyForm(event.currentTarget);
  };
  const searchFields = ([
    ["ALL", "全部字段"],
    ["INVENTORY_SKU", "库存 SKU"],
    ["NAME_ZH", "中文名称"],
    ["NAME_EN", "英文名称"],
    ["ORIGINAL_SKU", "原厂 SKU"],
    ["MASTER_CODE", "主 SKU"],
    ["DEFAULT_SUPPLIER", "默认供应商"],
  ] as const).filter(([value]) => canReadSuppliers
    || (value !== "ORIGINAL_SKU" && value !== "DEFAULT_SUPPLIER"));
  const matchModes = [
    ["STARTS_WITH", "开头是"],
    ["EQUALS", "等于"],
    ["CONTAINS", "包含"],
    ["ENDS_WITH", "结尾是"],
    ["EMPTY", "为空"],
    ["NOT_EMPTY", "不为空"],
  ] as const;
  return (
    <form
      className="product-filters erp-filter-panel erp-compact-filter-panel"
      aria-label={title}
      key={`${status ?? ""}:${keyword}:${searchField}:${matchMode}:${categoryId ?? ""}:${creatorId ?? ""}:${createdFrom ?? ""}:${createdTo ?? ""}:${referenceFiltersReady}`}
      onSubmit={submit}
    >
      <div className="erp-filter-row erp-filter-search-row">
        <span className="erp-filter-label">搜索内容：</span>
        {showSearchFields && (
          <fieldset className="erp-filter-options" aria-label="库存 SKU 搜索字段">
            {searchFields.map(([value, label]) => (
              <label key={value}>
                <input
                  type="radio"
                  name="searchField"
                  value={value}
                  checked={selectedSearchField === value}
                  onChange={() => setSelectedSearchField(value)}
                />
                {label}
              </label>
            ))}
          </fieldset>
        )}
        {!showSearchFields && (
          <input type="hidden" name="searchField" value={searchField} />
        )}
        {showSearchFields ? (
          <select
            aria-label="匹配方式"
            name="matchMode"
            value={selectedSearchField === "ALL"
              ? "CONTAINS"
              : selectedMatchMode}
            disabled={selectedSearchField === "ALL"}
            onChange={(event) => setSelectedMatchMode(
              queryInventorySkuMatchMode(event.target.value),
            )}
          >
            {matchModes.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        ) : (
          <input type="hidden" name="matchMode" value={matchMode} />
        )}
        <input
          aria-label="关键词"
          name="keyword"
          defaultValue={keyword}
          maxLength={100}
          placeholder={showSearchFields ? "双击可批量查询" : "业务编码、名称或外部引用"}
        />
        <button className="button button-primary" type="submit">
          搜索
        </button>
      </div>
      <div className="erp-filter-row">
        <span className="erp-filter-label">{showSearchFields ? "SKU 状态：" : "状态："}</span>
        <fieldset className="erp-filter-options" aria-label={showSearchFields ? "SKU 状态" : "状态"}>
          <label>
            <input
              type="radio"
              name="status"
              value=""
              defaultChecked={!status}
            />
            未归档
          </label>
          {statuses.map((item) => (
            <label key={item}>
              <input
                type="radio"
                name="status"
                value={item}
                defaultChecked={status === item}
              />
              {statusLabel(item)}
            </label>
          ))}
        </fieldset>
      </div>
      {showSearchFields && (
        <AdvancedFilterPanel
          activeCount={advancedFilterCount}
          appliedKey={JSON.stringify([status, keyword, searchField, matchMode, categoryId, creatorId, createdFrom, createdTo])}
          actions={(
            <>
              <button
                className="button button-secondary"
                type="button"
                onClick={(event) => {
                  const form = event.currentTarget.form;
                  if (form) applyForm(form, true);
                }}
              >
                重置条件
              </button>
              <button className="button button-primary" type="submit">
                应用筛选
              </button>
            </>
          )}
        >
          <AdvancedFilterSection
            title="商品属性"
            description="按目录、创建人和创建时间缩小 SKU 范围。"
            className="advanced-filter-section-wide"
          >
            <div className="advanced-filter-grid product-advanced-filter-grid">
            <label className="product-advanced-filter-field">
              <span>商品目录：</span>
            <select
              name="categoryId"
              defaultValue={categoryId ?? ""}
              disabled={!referenceFiltersReady}
            >
              <option value="">
                {referenceFiltersReady ? "全部商品目录" : "筛选目录不可用"}
              </option>
              {categoryId && !categories.some((item) => item.id === categoryId) && (
                <option value={categoryId}>当前商品目录不可用</option>
              )}
              {categories.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
            </label>
            <label className="product-advanced-filter-field">
              <span>商品创建人：</span>
            <select
              name="creatorId"
              defaultValue={creatorId ?? ""}
              disabled={!referenceFiltersReady}
            >
              <option value="">
                {referenceFiltersReady ? "全部创建人" : "筛选创建人不可用"}
              </option>
              {creatorId && !members.some((item) => item.id === creatorId) && (
                <option value={creatorId}>当前创建人不可用</option>
              )}
              {members.map((item) => (
                <option key={item.id} value={item.id}>{item.displayName}</option>
              ))}
            </select>
            </label>
            <fieldset className="product-advanced-date-filter">
              <legend className="sr-only">创建时间（UTC+8）</legend>
              <span className="product-advanced-filter-label">
                创建时间（UTC+8）：
              </span>
              <label>
                <span className="sr-only">库存 SKU 创建开始</span>
                <input
                  aria-label="库存 SKU 创建开始"
                  name="createdFrom"
                  type="date"
                  defaultValue={createdFrom ?? ""}
                  max={createdTo}
                />
              </label>
              <span>至</span>
              <label>
                <span className="sr-only">库存 SKU 创建结束</span>
                <input
                  aria-label="库存 SKU 创建结束"
                  name="createdTo"
                  type="date"
                  defaultValue={createdTo ?? ""}
                  min={createdFrom}
                />
              </label>
            </fieldset>
            </div>
          </AdvancedFilterSection>
        </AdvancedFilterPanel>
      )}
    </form>
  );
}

export function MasterProductFilters({
  query,
  categories,
  members,
  onApply,
}: {
  query: Query;
  categories: ProductCategory[];
  members: ProductAssignableMember[];
  onApply: (patch: Pick<Query, "status" | "keyword" | "searchField" | "categoryId" | "creatorId" | "createdFrom" | "createdTo">) => void;
}) {
  const advancedFilterCount = [
    query.categoryId,
    query.creatorId,
    query.createdFrom,
    query.createdTo,
  ].filter(Boolean).length;
  const applyForm = (form: HTMLFormElement, clearAdvanced = false) => {
    const values = new FormData(form);
    const selected = (name: string) => queryUuid(String(values.get(name) ?? ""));
    onApply({
      status: queryStatus(String(values.get("status") ?? "")),
      keyword: String(values.get("keyword") ?? "").trim().slice(0, 100),
      searchField: queryMasterSearchField(String(values.get("searchField") ?? "")),
      categoryId: clearAdvanced ? undefined : selected("categoryId"),
      creatorId: clearAdvanced ? undefined : selected("creatorId"),
      createdFrom: clearAdvanced
        ? undefined
        : queryDate(String(values.get("createdFrom") ?? "")),
      createdTo: clearAdvanced
        ? undefined
        : queryDate(String(values.get("createdTo") ?? "")),
    });
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    applyForm(event.currentTarget);
  };
  return <form className="product-filters erp-filter-panel erp-compact-filter-panel" aria-label="主商品筛选" key={`${query.status ?? ""}:${query.keyword}:${query.searchField}:${query.categoryId ?? ""}:${query.creatorId ?? ""}:${query.createdFrom ?? ""}:${query.createdTo ?? ""}`} onSubmit={submit}>
    <div className="erp-filter-row erp-filter-search-row">
      <span className="erp-filter-label">搜索内容：</span>
      <fieldset className="erp-filter-options" aria-label="搜索字段">
        {masterProductSearchFields.map(([value, label]) => <label key={value}><input type="radio" name="searchField" value={value} defaultChecked={(query.searchField ?? "ALL") === value} />{label}</label>)}
      </fieldset>
      <input aria-label="关键词" name="keyword" defaultValue={query.keyword} maxLength={100} placeholder="输入搜索内容" />
      <button className="button button-primary" type="submit">搜索</button>
    </div>
    <div className="erp-filter-row">
      <span className="erp-filter-label">状态：</span>
      <fieldset className="erp-filter-options" aria-label="主商品状态">
        <label><input type="radio" name="status" value="" defaultChecked={!query.status} />未归档</label>
        {statuses.map((item) => (
          <label key={item}><input type="radio" name="status" value={item} defaultChecked={query.status === item} />{statusLabel(item)}</label>
        ))}
      </fieldset>
    </div>
    <AdvancedFilterPanel
      activeCount={advancedFilterCount}
      appliedKey={JSON.stringify(query)}
      actions={(
        <>
          <button
            className="button button-secondary"
            type="button"
            onClick={(event) => {
              const form = event.currentTarget.form;
              if (form) applyForm(form, true);
            }}
          >
            重置条件
          </button>
          <button className="button button-primary" type="submit">
            应用筛选
          </button>
        </>
      )}
    >
      <AdvancedFilterSection
        title="商品属性"
        description="按商品目录、创建人员和创建时间缩小结果。"
        className="advanced-filter-section-wide"
      >
        <div className="advanced-filter-grid">
          <label>
            商品目录：
            <select name="categoryId" defaultValue={query.categoryId ?? ""}>
              <option value="">全部商品目录</option>
              {categories.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
          <label>
            创建人员：
            <select name="creatorId" defaultValue={query.creatorId ?? ""}>
              <option value="">全部创建人员</option>
              {members.map((item) => (
                <option key={item.id} value={item.id}>{item.displayName}</option>
              ))}
            </select>
          </label>
          <label>
            创建开始
            <input
              aria-label="创建开始"
              name="createdFrom"
              type="date"
              defaultValue={query.createdFrom ?? ""}
            />
          </label>
          <label>
            创建结束
            <input
              aria-label="创建结束"
              name="createdTo"
              type="date"
              defaultValue={query.createdTo ?? ""}
            />
          </label>
        </div>
      </AdvancedFilterSection>
    </AdvancedFilterPanel>
  </form>;
}

function ResourceActions<T extends ProductEditorItem>({
  item,
  canWrite,
  onEdit,
}: {
  item: T;
  canWrite: boolean;
  onEdit: (item: T, action: ProductEditorAction) => void;
}) {
  if (!canWrite || item.status === "ARCHIVED") return null;
  const switchAction = nextStatusAction(item.status);
  return (
    <span className="row-actions">
      <ErpIconButton
        icon={Pencil}
        label="编辑"
        type="button"
        onClick={() => onEdit(item, "edit")}
      />
      {switchAction && (
        <ErpIconButton
          icon={Power}
          label={switchAction === "activate" ? "启用" : "停用"}
          type="button"
          onClick={() => onEdit(item, switchAction)}
        />
      )}
      <ErpIconButton
        icon={Archive}
        label="归档"
        tone="danger"
        type="button"
        onClick={() => onEdit(item, "archive")}
      />
    </span>
  );
}

export function SupplyPriceSection({
  keyword,
  skuType,
  country,
  canWrite = false,
  onFilter,
}: {
  keyword: string;
  skuType: string;
  country: string;
  canWrite?: boolean;
  onFilter: (keyword: string, skuType: string, country: string) => void;
}) {
  return <ProductSupplyPriceSection
    keyword={keyword}
    skuType={skuType}
    country={country}
    canWrite={canWrite}
    onFilter={onFilter}
  />;
}

export function BundleSkuSection({
  keyword,
  start,
  end,
  canWrite = false,
  onFilter,
}: {
  keyword: string;
  start?: string;
  end?: string;
  canWrite?: boolean;
  onFilter: (keyword: string, start?: string, end?: string) => void;
}) {
  return <ProductBundleSection
    keyword={keyword}
    start={start}
    end={end}
    canWrite={canWrite}
    onFilter={onFilter}
  />;
}

export function SpuSection({
  state,
  selectedSpuId,
  canWrite,
  onEdit,
  onView,
  onSelect,
  onCreateSku,
  onRetry,
  onPageChange,
  onPageSizeChange,
  categories,
  packages,
  sortBy,
  descending,
  onSort,
  toolbarActions,
}: {
  state: LoadState<Page<ProductSpu>>;
  selectedSpuId?: string;
  canWrite: boolean;
  onEdit: (item: ProductSpu) => void;
  onView: (item: ProductSpu) => void;
  onSelect: (id: string) => void;
  onCreateSku: (item: ProductSpu) => void;
  onRetry: () => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  categories: ProductCategory[];
  packages: ProductPackageMaterial[];
  sortBy: NonNullable<Query["sortBy"]>;
  descending: boolean;
  onSort: (sortBy: NonNullable<Query["sortBy"]>) => void;
  toolbarActions?: ReactNode;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchError, setBatchError] = useState<string>();
  const [batchEditOpen, setBatchEditOpen] = useState(false);
  const [batchFields, setBatchFields] = useState<string[]>([]);
  const [batchNameZh, setBatchNameZh] = useState("");
  const [batchNameEn, setBatchNameEn] = useState("");
  const [batchNote, setBatchNote] = useState("");
  const [batchCategoryId, setBatchCategoryId] = useState("");
  const [batchStatus, setBatchStatus] = useState<ProductStatus>("ACTIVE");
  const [batchLengthMm, setBatchLengthMm] = useState("");
  const [batchWidthMm, setBatchWidthMm] = useState("");
  const [batchHeightMm, setBatchHeightMm] = useState("");
  const [batchWeightGrams, setBatchWeightGrams] = useState("");
  const [batchDivisor, setBatchDivisor] = useState<"5000" | "6000">("5000");
  const [batchPackageId, setBatchPackageId] = useState("");
  const [batchPackageableCount, setBatchPackageableCount] = useState("");
  const [batchSensitiveCodes, setBatchSensitiveCodes] = useState<(typeof sensitiveAttributeCodes)[number][]>([]);
  const pageItems = state.status === "ready" ? state.data.items : [];
  const selectedItems = pageItems.filter((item) => selected.includes(item.id));
  useEffect(() => {
    setSelected((ids) => ids.filter((id) => pageItems.some((item) => item.id === id)));
  }, [state.status === "ready" ? state.data.page : -1, pageItems.map((item) => item.id).join(",")]);
  const runBatch = async (action: "activate" | "deactivate" | "archive") => {
    if (!canWrite || selectedItems.length === 0 || batchBusy) return;
    if (action === "archive" && !window.confirm("归档后不会删除审计记录；包含未归档子 SKU 的主商品将整体失败。确定继续吗？")) return;
    setBatchBusy(true);
    setBatchError(undefined);
    try {
      const items = selectedItems.map((item) => ({ id: item.id, version: item.version }));
      if (action === "archive") await productCenterApi.archiveSpuBatch(items);
      else await productCenterApi.updateSpuBatchStatus(items, action === "activate" ? "ACTIVE" : "INACTIVE");
      setSelected([]);
      onRetry();
    } catch (error) {
      setBatchError(safeProductMessage(error, "批量处理主商品"));
    } finally {
      setBatchBusy(false);
    }
  };
  const runBatchEdit = async () => {
    if (!canWrite || selectedItems.length === 0 || batchBusy) return;
    if (batchFields.length === 0) {
      setBatchError("请至少选择一个需要批量修改的字段。");
      return;
    }
    if (batchFields.includes("nameZh") && !batchNameZh.trim()) {
      setBatchError("批量修改中文名称时不能为空。");
      return;
    }
    const positive = (value: string, label: string, max: number) => {
      if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max) {
        throw new Error(`${label}必须是允许范围内的正整数。`);
      }
      return Number(value);
    };
    let dimensions: [number, number, number] | undefined;
    let weight: number | undefined;
    let packageableCount: number | undefined;
    try {
      if (batchFields.includes("dimensions")) {
        dimensions = [
          positive(batchLengthMm, "长度", 1_000_000),
          positive(batchWidthMm, "宽度", 1_000_000),
          positive(batchHeightMm, "高度", 1_000_000),
        ];
      }
      if (batchFields.includes("actualWeightGrams")) weight = positive(batchWeightGrams, "实际重量", 1_000_000_000);
      if (batchFields.includes("packageMaterial")) {
        if (!batchPackageId) throw new Error("请选择包装资料。");
        packageableCount = positive(batchPackageableCount, "每包装件数", 1_000_000);
      }
    } catch (error) {
      setBatchError(error instanceof Error ? error.message : "批量字段无效。");
      return;
    }
    setBatchBusy(true);
    setBatchError(undefined);
    try {
      const latest = await Promise.all(selectedItems.map((item) => productCenterApi.getSpu(item.id)));
      await productCenterApi.importSpuUpdates(latest.map((item) => ({
        id: item.id,
        values: {
          name: batchFields.includes("nameZh") ? batchNameZh.trim() : item.name,
          nameZh: batchFields.includes("nameZh") ? batchNameZh.trim() : undefined,
          nameEn: batchFields.includes("nameEn") ? batchNameEn.trim() || undefined : undefined,
          productNote: batchFields.includes("productNote") ? batchNote.trim() || undefined : undefined,
          categoryId: batchFields.includes("categoryId") ? batchCategoryId || undefined : undefined,
          lengthMm: dimensions?.[0],
          widthMm: dimensions?.[1],
          heightMm: dimensions?.[2],
          actualWeightGrams: weight,
          volumetricDivisor: batchFields.includes("volumetricDivisor") ? Number(batchDivisor) as 5000 | 6000 : undefined,
          packageMaterialId: batchFields.includes("packageMaterial") ? batchPackageId : undefined,
          packageableCount,
          sensitiveAttributeCodes: batchFields.includes("sensitiveAttributeCodes") ? batchSensitiveCodes : undefined,
          status: batchFields.includes("status") ? batchStatus : item.status,
          version: item.version,
        },
      })));
      setBatchEditOpen(false);
      setSelected([]);
      onRetry();
    } catch (error) {
      setBatchError(safeProductMessage(error, "批量修改主商品"));
    } finally {
      setBatchBusy(false);
    }
  };
  return (
    <section
      className="detail-card product-section erp-data-workbench"
      aria-labelledby="spu-title"
    >
      <h2 className="sr-only" id="spu-title">主 SKU（SPU）</h2>
      <div className="erp-operation-bar">
        <div className="erp-operation-start">
          {canWrite && state.status === "ready" && (
            <details className="erp-action-menu">
              <summary className="button button-secondary">批量处理功能</summary>
              <div className="erp-action-menu-popover">
                <button type="button" disabled={selectedItems.length === 0 || batchBusy} onClick={(event) => { closeActionMenu(event.currentTarget); setBatchEditOpen(true); }}>批量修改主 SKU</button>
                <button type="button" disabled={selectedItems.length === 0 || batchBusy} onClick={(event) => { closeActionMenu(event.currentTarget); void runBatch("activate"); }}>批量启用</button>
                <button type="button" disabled={selectedItems.length === 0 || batchBusy} onClick={(event) => { closeActionMenu(event.currentTarget); void runBatch("deactivate"); }}>批量停用</button>
                <button className="danger" type="button" disabled={selectedItems.length === 0 || batchBusy} onClick={(event) => { closeActionMenu(event.currentTarget); void runBatch("archive"); }}>批量归档</button>
              </div>
            </details>
          )}
          {state.status === "ready" && <span className="erp-selection-count">已选 {selectedItems.length} 项</span>}
        </div>
        <div className="erp-operation-end">{toolbarActions}</div>
      </div>
      {batchError && <div className="inline-alert" role="alert">{batchError}</div>}
      {batchEditOpen && (
        <div className="dialog-backdrop" role="presentation">
          <section className="write-dialog" role="dialog" aria-modal="true" aria-labelledby="batch-spu-edit-title">
            <header className="table-heading">
              <h2 id="batch-spu-edit-title">批量修改主 SKU</h2>
              <DialogCloseButton disabled={batchBusy} onClick={() => setBatchEditOpen(false)} />
            </header>
            <p>仅更新勾选字段；如有一条记录冲突或校验失败，本次修改将全部取消。</p>
            <div className="product-master-checkboxes">
              {(["nameZh", "nameEn", "productNote", "categoryId", "dimensions", "actualWeightGrams", "volumetricDivisor", "packageMaterial", "sensitiveAttributeCodes", "status"] as const).map((field) => (
                <label key={field}>
                  <input type="checkbox" checked={batchFields.includes(field)} onChange={(event) => setBatchFields((fields) => event.target.checked ? [...fields, field] : fields.filter((item) => item !== field))} />
                  {{ nameZh: "中文名称", nameEn: "英文名称", productNote: "商品备注", categoryId: "商品目录", dimensions: "长宽高", actualWeightGrams: "实际重量", volumetricDivisor: "体积重系数", packageMaterial: "包装资料与每包装件数", sensitiveAttributeCodes: "敏感属性", status: "状态" }[field]}
                </label>
              ))}
            </div>
            {batchFields.includes("nameZh") && <label>中文名称<input value={batchNameZh} maxLength={200} onChange={(event) => setBatchNameZh(event.target.value)} /></label>}
            {batchFields.includes("nameEn") && <label>英文名称<input value={batchNameEn} maxLength={200} onChange={(event) => setBatchNameEn(event.target.value)} /></label>}
            {batchFields.includes("productNote") && <label>商品备注<textarea value={batchNote} maxLength={2000} onChange={(event) => setBatchNote(event.target.value)} /></label>}
            {batchFields.includes("categoryId") && <label>商品目录<select value={batchCategoryId} onChange={(event) => setBatchCategoryId(event.target.value)}><option value="">未选择</option>{categories.filter((category) => category.status === "ACTIVE").map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>}
            {batchFields.includes("dimensions") && <span className="inline-field"><label>长度<input inputMode="numeric" value={batchLengthMm} onChange={(event) => setBatchLengthMm(event.target.value)} /></label><label>宽度<input inputMode="numeric" value={batchWidthMm} onChange={(event) => setBatchWidthMm(event.target.value)} /></label><label>高度<input inputMode="numeric" value={batchHeightMm} onChange={(event) => setBatchHeightMm(event.target.value)} /></label></span>}
            {batchFields.includes("actualWeightGrams") && <label>实际重量（克）<input inputMode="numeric" value={batchWeightGrams} onChange={(event) => setBatchWeightGrams(event.target.value)} /></label>}
            {batchFields.includes("volumetricDivisor") && <label>体积重系数<select value={batchDivisor} onChange={(event) => setBatchDivisor(event.target.value as "5000" | "6000")}><option value="5000">5000</option><option value="6000">6000</option></select></label>}
            {batchFields.includes("packageMaterial") && <><span className="inline-field"><label>包装资料<select value={batchPackageId} onChange={(event) => setBatchPackageId(event.target.value)}><option value="">请选择</option>{packages.filter((item) => item.status === "ACTIVE").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>每包装件数<input inputMode="numeric" value={batchPackageableCount} onChange={(event) => setBatchPackageableCount(event.target.value)} /></label></span><small className="form-help">用于维护商品包装信息；实际发货包装和称重请使用 SKU 发货包装规则与仓库发货设置。</small></>}
            {batchFields.includes("sensitiveAttributeCodes") && <div className="product-master-checkboxes">{sensitiveAttributeCodes.map((code) => <label key={code}><input type="checkbox" checked={batchSensitiveCodes.includes(code)} onChange={(event) => setBatchSensitiveCodes((codes) => event.target.checked ? [...codes, code] : codes.filter((item) => item !== code))} />{code}</label>)}</div>}
            {batchFields.includes("status") && <label>状态<select value={batchStatus} onChange={(event) => setBatchStatus(event.target.value as ProductStatus)}><option value="ACTIVE">启用</option><option value="INACTIVE">停用</option></select></label>}
            <footer className="form-actions">
              <button className="button button-secondary" type="button" disabled={batchBusy} onClick={() => setBatchEditOpen(false)}>取消</button>
              <button className="button button-primary" type="button" disabled={batchBusy} onClick={() => void runBatchEdit()}>{batchBusy ? "正在保存…" : "确认批量修改"}</button>
            </footer>
          </section>
        </div>
      )}
      {state.status === "loading" && <Loading label="正在加载主 SKU" />}
      {state.status === "error" && (
        <ErrorState message={state.message} onRetry={onRetry} />
      )}
      {state.status === "ready" &&
        (state.data.items.length === 0 ? (
          <EmptyState label="没有符合筛选条件的主 SKU。" />
        ) : (
          <>
            <div className="shop-table-scroll">
              <table className="shop-table erp-pinned-actions">
                <caption className="sr-only">主 SKU 列表</caption>
                <thead>
                  <tr>
                    <th><PageSelectionCheckbox aria-label="全选本页主商品" selectedCount={selectedItems.length} totalCount={pageItems.length} onChange={(event) => setSelected(event.target.checked ? pageItems.map((item) => item.id) : [])} /></th>
                    <th><button className="text-button" type="button" onClick={() => onSort("BUSINESS_CODE")}>主 SKU{sortBy === "BUSINESS_CODE" ? (descending ? " ↓" : " ↑") : ""}</button></th>
                    <th>缩略图</th>
                    <th>商品中文/英文名称</th>
                    <th><button className="text-button" type="button" onClick={() => onSort("CATEGORY")}>商品目录{sortBy === "CATEGORY" ? (descending ? " ↓" : " ↑") : ""}</button></th>
                    <th>状态</th>
                    <th>关联子 SKU 总库存量</th>
                    <th>子 SKU 种类数</th>
                    <th><button className="text-button" type="button" aria-label="按 42 天销量排序" onClick={() => onSort("SALES_42")}>销量（7/28/42）{sortBy === "SALES_42" ? (descending ? " ↓" : " ↑") : ""}</button></th>
                    <th><button className="text-button" type="button" aria-label="按预测日销量排序" onClick={() => onSort("FORECAST_DAILY_SALES")}>预测日销量{sortBy === "FORECAST_DAILY_SALES" ? (descending ? " ↓" : " ↑") : ""}</button></th>
                    <th><button className="text-button" type="button" onClick={() => onSort("CREATED_AT")}>创建时间{sortBy === "CREATED_AT" ? (descending ? " ↓" : " ↑") : ""}</button></th>
                    <th>创建人员</th>
                    <th>更新时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {state.data.items.map((spu) => (
                    <tr key={spu.id}>
                      <td><input aria-label={`选择主商品 ${spu.businessCode}`} type="checkbox" checked={selected.includes(spu.id)} onChange={(event) => setSelected((ids) => event.target.checked ? [...ids, spu.id] : ids.filter((id) => id !== spu.id))} /></td>
                      <td>
                        <button
                          className="text-button"
                          type="button"
                          onClick={() => onView(spu)}
                        >
                          <code>{spu.businessCode}</code>
                        </button>
                      </td>
                      <td><SpuThumbnail spu={spu} /></td>
                      <td>
                        <strong>{spu.name}</strong>
                        <small>
                          {[spu.nameEn, spu.brandName]
                            .filter(Boolean)
                            .join(" / ") || "—"}
                        </small>
                      </td>
                      <td>{spu.category?.displayName ?? "—"}</td>
                      <td>{statusLabel(spu.status)}</td>
                      <td>{spu.metrics?.totalInventory ?? "—"}</td>
                      <td>{spu.skuSummary.totalSkuCount}</td>
                      <td>{spu.metrics ? `${spu.metrics.sales7} / ${spu.metrics.sales28} / ${spu.metrics.sales42}` : "—"}</td>
                      <td>{spu.metrics ? new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 3 }).format(spu.metrics.forecastDailySales) : "—"}</td>
                      <td><ProductDateTime value={spu.createdAt} /></td>
                      <td>{spu.metrics?.creatorName ?? "—"}</td>
                      <td><ProductDateTime value={spu.updatedAt} /></td>
                      <td>
                        <span className="row-actions">
                          {canWrite && spu.status !== "ARCHIVED" && (
                            <>
                              <ErpIconButton
                                icon={Pencil}
                                label="编辑"
                                type="button"
                                onClick={() => onEdit(spu)}
                              />
                            </>
                          )}
                          <ErpIconButton
                            icon={Link2}
                            label={selectedSpuId === spu.id ? "已关联" : "关联子 SKU"}
                            type="button"
                            onClick={() => onSelect(spu.id)}
                          />
                          {canWrite && spu.status !== "ARCHIVED" && (
                            <>
                              <ErpIconButton
                                icon={Plus}
                                label="创建子 SKU"
                                type="button"
                                onClick={() => onCreateSku(spu)}
                              />
                            </>
                          )}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <form className="pagination pagination-complete" aria-label="主商品分页" onSubmit={(event) => {
              event.preventDefault();
              const requested = Number(new FormData(event.currentTarget).get("page"));
              if (Number.isSafeInteger(requested) && requested >= 1 && requested <= Math.max(state.data.totalPages, 1)) onPageChange(requested - 1);
            }}>
              <div className="erp-pagination-selection">
                <button className="text-button" type="button" onClick={() => setSelected(pageItems.map((item) => item.id))}>全选</button>
                <button className="text-button" type="button" onClick={() => setSelected(pageItems.filter((item) => !selected.includes(item.id)).map((item) => item.id))}>反选</button>
                <span>
                  共 {state.data.totalElements} 条，当前显示第{" "}
                  {state.data.page * state.data.size + 1}-
                  {Math.min((state.data.page + 1) * state.data.size, state.data.totalElements)} 条，
                  {state.data.page + 1}/{Math.max(state.data.totalPages, 1)} 页
                </span>
              </div>
              <div className="pagination-settings">
                <label>每页<select value={state.data.size} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
                  {[...new Set([25, 50, 100, state.data.size])]
                    .sort((left, right) => left - right)
                    .map((size) => <option key={size} value={size}>{size}</option>)}
                </select></label>
                <label>跳转至<input name="page" type="number" min="1" max={Math.max(state.data.totalPages, 1)} defaultValue={state.data.page + 1} /></label>
                <button className="button button-secondary" type="submit">跳转</button>
                <button className="button button-secondary" type="button" disabled={state.data.page === 0} onClick={() => onPageChange(0)}>首页</button>
                <button className="button button-secondary" type="button" disabled={state.data.page === 0} onClick={() => onPageChange(state.data.page - 1)}>上一页</button>
                <button className="button button-secondary" type="button" disabled={state.data.page + 1 >= state.data.totalPages} onClick={() => onPageChange(state.data.page + 1)}>下一页</button>
                <button className="button button-secondary" type="button" disabled={state.data.page + 1 >= state.data.totalPages} onClick={() => onPageChange(Math.max(state.data.totalPages - 1, 0))}>末页</button>
              </div>
            </form>
          </>
        ))}
    </section>
  );
}

export function SkuSection({
  state,
  sectionId,
  selectedSpuId,
  selectedSkuId,
  title,
  description,
  standalone = false,
  showSpuIdentity = false,
  canWrite,
  canCreate = canWrite,
  canWriteListings,
  canReadListingShops,
  canReadInventory = false,
  canReadOrders = false,
  canReadSuppliers = false,
  canReadListings = false,
  status,
  keyword,
  searchField = "INVENTORY_SKU",
  matchMode = "CONTAINS",
  categoryId,
  creatorId,
  createdFrom,
  createdTo,
  categories = [],
  members = [],
  referenceFiltersReady = false,
  sortBy = "BUSINESS_CODE",
  descending = false,
  onFilter,
  onEdit,
  onCreate,
  onMap,
  onPackagingRules,
  onClear,
  onSort,
  onRetry,
  onPageChange,
  onPageSizeChange,
  onInventoryQuery,
  onExport,
  exportBusy = false,
  toolbarActions,
  parentThumbnailUrl,
}: {
  state: LoadState<Page<ProductSku>> | { status: "idle" };
  sectionId?: string;
  selectedSpuId?: string;
  selectedSkuId?: string;
  title: string;
  description: string;
  standalone?: boolean;
  showSpuIdentity?: boolean;
  canWrite: boolean;
  canCreate?: boolean;
  canWriteListings: boolean;
  canReadListingShops: boolean;
  canReadInventory?: boolean;
  canReadOrders?: boolean;
  canReadSuppliers?: boolean;
  canReadListings?: boolean;
  status?: ProductStatus;
  keyword: string;
  searchField?: Query["skuSearchField"];
  matchMode?: ProductSkuMatchMode;
  categoryId?: string;
  creatorId?: string;
  createdFrom?: string;
  createdTo?: string;
  categories?: ProductCategory[];
  members?: ProductAssignableMember[];
  referenceFiltersReady?: boolean;
  sortBy?: ProductSkuSortField;
  descending?: boolean;
  onFilter: (
    status: ProductStatus | undefined,
    keyword: string,
    searchField: Query["skuSearchField"],
    matchMode: ProductSkuMatchMode,
    categoryId: string | undefined,
    creatorId: string | undefined,
    createdFrom: string | undefined,
    createdTo: string | undefined,
  ) => void;
  onEdit: (item: ProductSku, action: ProductEditorAction) => void;
  onCreate: () => void;
  onMap: (skuId: string) => void;
  onPackagingRules?: (sku: ProductSku) => void;
  onClear?: () => void;
  onSort?: (
    sortBy: ProductSkuSortField,
    descending: boolean,
  ) => void;
  onRetry: () => void;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  onInventoryQuery?: () => void;
  onExport?: () => void;
  exportBusy?: boolean;
  toolbarActions?: ReactNode;
  parentThumbnailUrl?: string;
}) {
  const thumbnailUrls = useSkuThumbnailUrls(
    state.status === "ready" ? state.data.items : [],
  );
  const inventorySummaries = useInventorySkuSummaries(
    state.status === "ready" ? state.data.items : [],
    standalone && canReadInventory,
  );
  const salesSummaries = useSkuSalesSummaries(
    state.status === "ready" ? state.data.items : [],
    standalone && canReadOrders,
  );
  const preferredSuppliers = usePreferredSuppliers(
    state.status === "ready" ? state.data.items : [],
    standalone && canReadSuppliers,
  );
  const listingSummaries = useSkuListingSummaries(
    state.status === "ready" ? state.data.items : [],
    standalone && canReadListings,
  );
  const [visibleColumns, setVisibleColumns] = useState<InventorySkuColumn[]>(
    loadInventorySkuColumns,
  );
  const [columnSettingsOpen, setColumnSettingsOpen] = useState(false);
  const [draftColumns, setDraftColumns] =
    useState<InventorySkuColumn[]>(visibleColumns);
  const visible = standalone
    ? new Set(visibleColumns)
    : new Set(defaultInventorySkuColumns);
  useEffect(() => {
    if (!standalone) return;
    try {
      window.localStorage.setItem(
        INVENTORY_SKU_COLUMNS_STORAGE_KEY,
        JSON.stringify(visibleColumns),
      );
    } catch {
      // Column preferences must never prevent access to the SKU directory.
    }
  }, [standalone, visibleColumns]);
  const openColumnSettings = () => {
    setDraftColumns(visibleColumns);
    setColumnSettingsOpen(true);
  };
  const saveColumnSettings = () => {
    const selected = new Set(draftColumns);
    const ordered = defaultInventorySkuColumns.filter((key) =>
      selected.has(key),
    );
    if (ordered.length === 0) return;
    setVisibleColumns(ordered);
    setColumnSettingsOpen(false);
  };
  return (
    <section
      id={sectionId}
      className={`detail-card product-section${standalone ? " erp-data-workbench" : ""}`}
      aria-labelledby="sku-title"
    >
      <div className="table-heading">
        <div className={standalone ? "sr-only" : undefined}>
          <h2 id="sku-title">{title}</h2>
          <p>{description}</p>
        </div>
        {selectedSpuId && (
          <div className="row-actions">
            {canCreate && (
              <button className="text-button" type="button" onClick={onCreate}>
                新增 SKU
              </button>
            )}
            {onClear && (
              <button className="text-button" type="button" onClick={onClear}>
                取消选择
              </button>
            )}
          </div>
        )}
      </div>
      {state.status === "idle" && (
        <EmptyState label="选择一条 SPU 后加载、筛选和维护其 SKU。" />
      )}
      {state.status !== "idle" && (
        <ProductFilters
          title="SKU 筛选"
          status={status}
          keyword={keyword}
          searchField={searchField}
          matchMode={matchMode}
          categoryId={categoryId}
          creatorId={creatorId}
          createdFrom={createdFrom}
          createdTo={createdTo}
          categories={categories}
          members={members}
          referenceFiltersReady={referenceFiltersReady}
          showSearchFields={standalone}
          canReadSuppliers={canReadSuppliers}
          onApply={onFilter}
        />
      )}
      {state.status === "loading" && <Loading label={standalone ? "正在加载库存 SKU" : "正在加载 SKU"} />}
      {state.status === "error" && (
        <ErrorState message={state.message} onRetry={onRetry} />
      )}
      {state.status === "ready" && (
        <>
          {standalone && (
            <div className="erp-operation-bar" aria-label="SKU 操作">
              <div className="erp-operation-start">
                {(canCreate || onExport) && (
                  <details className="erp-action-menu erp-add-menu">
                    <summary className="button button-primary">添加/导出</summary>
                    <div className="erp-action-menu-popover">
                      {canCreate && (
                        <button type="button" onClick={(event) => { closeActionMenu(event.currentTarget); onCreate(); }}>
                          手动创建库存 SKU
                        </button>
                      )}
                      {onExport && (
                        <button
                          type="button"
                          disabled={exportBusy}
                          aria-busy={exportBusy}
                          onClick={(event) => {
                            closeActionMenu(event.currentTarget);
                            onExport();
                          }}
                        >
                          {exportBusy ? "正在导出…" : "导出搜索的全部记录"}
                        </button>
                      )}
                    </div>
                  </details>
                )}
                <span className="erp-selection-count">
                  共 {state.data.totalElements} 条
                </span>
                {exportBusy && (
                  <span className="erp-selection-count" role="status">
                    正在导出库存 SKU…
                  </span>
                )}
              </div>
              <div className="erp-operation-end">
                {onSort && (
                  <div className="erp-sort-controls">
                    <label>
                      排序
                      <select
                        aria-label="库存 SKU 排序"
                        value={sortBy}
                        onChange={(event) =>
                          onSort(
                            event.target.value as ProductSkuSortField,
                            descending,
                          )
                        }
                      >
                        <option value="BUSINESS_CODE">库存 SKU</option>
                        <option value="CREATED_AT">创建时间</option>
                      </select>
                    </label>
                    <button
                      className="button"
                      type="button"
                      aria-label={
                        descending
                          ? "库存 SKU 当前降序，切换为升序"
                          : "库存 SKU 当前升序，切换为降序"
                      }
                      onClick={() => onSort(sortBy, !descending)}
                    >
                      {descending ? "降序" : "升序"}
                    </button>
                  </div>
                )}
                {toolbarActions}
                {onInventoryQuery && (
                  <button
                    className="button"
                    type="button"
                    onClick={onInventoryQuery}
                  >
                    SKU 库存查询
                  </button>
                )}
                <button
                  className="button"
                  type="button"
                  onClick={openColumnSettings}
                >
                  自定义列表字段
                </button>
                <button className="button" type="button" onClick={onRetry}>
                  刷新
                </button>
              </div>
            </div>
          )}
          {standalone && columnSettingsOpen && (
            <div className="dialog-backdrop" role="presentation">
              <section
                className="write-dialog inventory-sku-column-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="inventory-sku-column-dialog-title"
              >
                <header className="table-heading">
                  <div>
                    <h2 id="inventory-sku-column-dialog-title">
                      自定义列表字段
                    </h2>
                    <p>选择库存 SKU 列表中需要显示的字段。</p>
                  </div>
                  <DialogCloseButton onClick={() => setColumnSettingsOpen(false)} />
                </header>
                <div className="inventory-sku-column-groups">
                  {[
                    "商品信息",
                    "人员",
                    "采购与仓库",
                    "库存",
                    "销售",
                    "重量与包装",
                    "状态与时间",
                  ].map((group) => (
                    <fieldset key={group}>
                      <legend>{group}</legend>
                      {inventorySkuColumns
                        .filter(([, , columnGroup]) => columnGroup === group)
                        .map(([key, label]) => (
                          <label key={key}>
                            <input
                              type="checkbox"
                              checked={draftColumns.includes(key)}
                              onChange={(event) =>
                                setDraftColumns((columns) =>
                                  event.target.checked
                                    ? [...columns, key]
                                    : columns.filter((column) => column !== key),
                                )
                              }
                            />
                            {label}
                          </label>
                        ))}
                    </fieldset>
                  ))}
                </div>
                {draftColumns.length === 0 && (
                  <p className="field-error" role="alert">
                    至少保留一个列表字段。
                  </p>
                )}
                <footer className="form-actions">
                  <button
                    className="text-button"
                    type="button"
                    onClick={() =>
                      setDraftColumns(defaultInventorySkuColumns)
                    }
                  >
                    恢复默认字段
                  </button>
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => setColumnSettingsOpen(false)}
                  >
                    取消
                  </button>
                  <button
                    className="button button-primary"
                    type="button"
                    disabled={draftColumns.length === 0}
                    onClick={saveColumnSettings}
                  >
                    保存
                  </button>
                </footer>
              </section>
            </div>
          )}
          {(standalone || state.data.items.length > 0) && (
            <div className="shop-table-scroll">
              <table className="shop-table erp-pinned-actions">
                <caption className="sr-only">库存 SKU 列表</caption>
                <thead>
                  <tr>
                    {visible.has("thumbnail") && <th>缩略图</th>}
                    {visible.has("businessCode") && <th>库存 SKU</th>}
                    {visible.has("supplierSkuCode") && <th>原厂 SKU</th>}
                    {showSpuIdentity && visible.has("spuIdentity") && (
                      <th>主 SKU</th>
                    )}
                    {visible.has("name") && <th>商品中文名 / 多属性</th>}
                    {visible.has("nameEn") && <th>英文名</th>}
                    {visible.has("brandName") && <th>商品品牌</th>}
                    {visible.has("category") && <th>商品目录</th>}
                    {visible.has("unitCost") && <th>统一成本价</th>}
                    {visible.has("defaultWarehouse") && <th>默认仓库</th>}
                    {visible.has("preferredSupplier") && <th>默认供应商</th>}
                    {visible.has("onHand") && <th>库存总量</th>}
                    {visible.has("reserved") && <th>锁定库存</th>}
                    {visible.has("available") && <th>可用库存</th>}
                    {visible.has("sales") && <th>销量（7/28/42 天）</th>}
                    {visible.has("activeListingCount") && (
                      <th>已配对在线量</th>
                    )}
                    {visible.has("actualWeight") && <th>重量</th>}
                    {visible.has("dimensions") && <th>尺寸</th>}
                    {visible.has("packageMaterial") && <th>包装资料</th>}
                    {visible.has("packageableCount") && <th>每包装件数</th>}
                    {visible.has("status") && <th>状态</th>}
                    {visible.has("createdAt") && <th>创建时间</th>}
                    {visible.has("creatorName") && <th>创建人员</th>}
                    {visible.has("updatedAt") && <th>更新时间</th>}
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {state.data.items.map((sku) => (
                    <tr
                      key={sku.id}
                      id={`product-sku-row-${sku.id}`}
                      tabIndex={selectedSkuId === sku.id ? -1 : undefined}
                      data-selected={selectedSkuId === sku.id || undefined}
                    >
                      {visible.has("thumbnail") && (
                        <td>
                          <SkuThumbnail
                            sku={sku}
                            parentThumbnailUrl={parentThumbnailUrl}
                            urls={thumbnailUrls}
                          />
                        </td>
                      )}
                      {visible.has("businessCode") && (
                        <td>
                          <code>{sku.businessCode}</code>
                        </td>
                      )}
                      {visible.has("supplierSkuCode") && (
                        <td>
                          {preferredSuppliers.status === "not-permitted"
                            ? <span aria-label="需要供应商读取权限">无权限</span>
                            : preferredSuppliers.status === "loading"
                              ? "加载中"
                              : preferredSuppliers.status === "error"
                                ? "暂不可用"
                                : preferredSuppliers.values.get(sku.id)
                                    ?.supplierSkuCode ?? "—"}
                        </td>
                      )}
                      {showSpuIdentity && visible.has("spuIdentity") && (
                        <td>
                          {sku.masterSku ? (
                            <span className="product-table-identity">
                              <code>{sku.masterSku.businessCode}</code>
                              <small>{sku.masterSku.name}</small>
                            </span>
                          ) : (
                            <span aria-label="主 SKU 信息不可用">—</span>
                          )}
                        </td>
                      )}
                      {visible.has("name") && (
                        <td>
                          <strong>{sku.name}</strong>
                          <small>{sku.variantSummary ?? "—"}</small>
                        </td>
                      )}
                      {visible.has("nameEn") && <td>{sku.nameEn ?? "—"}</td>}
                      {visible.has("brandName") && (
                        <td>{sku.masterSku?.brandName ?? "—"}</td>
                      )}
                      {visible.has("category") && (
                        <td>{sku.masterSku?.category?.displayName ?? "—"}</td>
                      )}
                      {visible.has("unitCost") && (
                        <td>{sku.unitCost && sku.currencyCode ? `${sku.unitCost} ${sku.currencyCode}` : "—"}</td>
                      )}
                      {visible.has("defaultWarehouse") && (
                        <td>{sku.defaultWarehouse?.displayName ?? "—"}</td>
                      )}
                      {visible.has("preferredSupplier") && (
                        <td>
                          <PreferredSupplierValue
                            skuId={sku.id}
                            state={preferredSuppliers}
                          />
                        </td>
                      )}
                      {visible.has("onHand") && (
                        <td>
                          <InventorySkuQuantity
                            skuId={sku.id}
                            field="onHand"
                            state={inventorySummaries}
                          />
                        </td>
                      )}
                      {visible.has("reserved") && (
                        <td>
                          <InventorySkuQuantity
                            skuId={sku.id}
                            field="reserved"
                            state={inventorySummaries}
                          />
                        </td>
                      )}
                      {visible.has("available") && (
                        <td>
                          <InventorySkuQuantity
                            skuId={sku.id}
                            field="available"
                            state={inventorySummaries}
                          />
                        </td>
                      )}
                      {visible.has("sales") && (
                        <td>
                          <SkuSalesValue
                            skuId={sku.id}
                            state={salesSummaries}
                          />
                        </td>
                      )}
                      {visible.has("activeListingCount") && (
                        <td>
                          <SkuListingCount
                            skuId={sku.id}
                            state={listingSummaries}
                          />
                        </td>
                      )}
                      {visible.has("actualWeight") && (
                        <td>
                          {sku.masterSku?.actualWeightGrams == null
                            ? "—"
                            : `${sku.masterSku.actualWeightGrams} g`}
                        </td>
                      )}
                      {visible.has("dimensions") && (
                        <td>
                          {sku.masterSku?.lengthMm != null &&
                          sku.masterSku.widthMm != null &&
                          sku.masterSku.heightMm != null
                            ? `${sku.masterSku.lengthMm} × ${sku.masterSku.widthMm} × ${sku.masterSku.heightMm} mm`
                            : "—"}
                        </td>
                      )}
                      {visible.has("packageMaterial") && (
                        <td>
                          {sku.masterSku?.packageMaterial?.displayName ?? "—"}
                        </td>
                      )}
                      {visible.has("packageableCount") && (
                        <td>{sku.masterSku?.packageableCount ?? "—"}</td>
                      )}
                      {visible.has("status") && <td>{statusLabel(sku.status)}</td>}
                      {visible.has("createdAt") && (
                        <td><ProductDateTime value={sku.createdAt} /></td>
                      )}
                      {visible.has("creatorName") && (
                        <td>{sku.creatorName ?? "—"}</td>
                      )}
                      {visible.has("updatedAt") && (
                        <td><ProductDateTime value={sku.updatedAt} /></td>
                      )}
                      <td>
                        <span className="row-actions">
                          {onPackagingRules && (
                            <button
                              className="text-button"
                              type="button"
                              onClick={() => onPackagingRules(sku)}
                            >
                              发货包装规则
                            </button>
                          )}
                          {canWriteListings && sku.status !== "ARCHIVED" && (
                            <button
                              className="text-button"
                              type="button"
                              onClick={() => onMap(sku.id)}
                              disabled={!canReadListingShops}
                              title={
                                canReadListingShops
                                  ? undefined
                                  : "需要管理员授予店铺和平台目录读取权限后才能选择店铺。"
                              }
                            >
                              创建在线商品映射
                            </button>
                          )}
                          <ResourceActions
                            item={sku}
                            canWrite={canWrite}
                            onEdit={onEdit}
                          />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {state.data.items.length === 0 ? (
            <EmptyState label="没有符合筛选条件的库存 SKU。" />
          ) : (
            <Pagination
              page={state.data}
              onPageChange={onPageChange}
              onPageSizeChange={onPageSizeChange}
              label="SKU 分页"
            />
          )}
        </>
      )}
    </section>
  );
}

export function InventorySkuParentPickerDialog({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (spu: ProductSpu) => void;
}) {
  const [state, setState] = useState<LoadState<Page<ProductSpu>>>({
    status: "loading",
  });
  const [keyword, setKeyword] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [requestKey, setRequestKey] = useState(0);
  const requestVersion = useRef(0);
  const dialogRef = useRef<HTMLElement>(null);
  const onKeyDown = useDialogFocus(dialogRef, onClose, false);

  useEffect(() => {
    const version = ++requestVersion.current;
    setState((previous) => ({
      status: "loading",
      data: "data" in previous ? previous.data : undefined,
    }));
    void productCenterApi
      .listSpus({
        status: "ACTIVE",
        keyword: keyword || undefined,
        searchField: "ALL",
        sortBy: "BUSINESS_CODE",
        page: 0,
        size: 50,
      })
      .then(
        (data) => {
          if (version === requestVersion.current) {
            setState({ status: "ready", data });
            setSelectedId((current) =>
              data.items.some((item) => item.id === current) ? current : "",
            );
          }
        },
        (error) => {
          if (version === requestVersion.current) {
            setState({
              status: "error",
              message: safeProductMessage(error, "读取可用主 SKU"),
            });
          }
        },
      );
    return () => {
      requestVersion.current += 1;
    };
  }, [requestKey]);

  const selected =
    state.status === "ready"
      ? state.data.items.find((item) => item.id === selectedId)
      : undefined;
  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="write-dialog inventory-sku-parent-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="inventory-sku-parent-dialog-title"
        onKeyDown={onKeyDown}
      >
        <header className="table-heading">
          <div>
            <h2 id="inventory-sku-parent-dialog-title">选择所属主 SKU</h2>
            <p>库存 SKU 必须归属一个启用的主 SKU。</p>
          </div>
          <DialogCloseButton onClick={onClose} />
        </header>
        <form
          className="inventory-sku-parent-search"
          aria-label="搜索主 SKU"
          onSubmit={(event) => {
            event.preventDefault();
            const value = String(
              new FormData(event.currentTarget).get("keyword") ?? "",
            )
              .trim()
              .slice(0, 100);
            setKeyword(value);
            setRequestKey((current) => current + 1);
          }}
        >
          <label>
            业务编码或名称
            <input
              name="keyword"
              maxLength={100}
              defaultValue={keyword}
              placeholder="输入主 SKU 编码或名称"
            />
          </label>
          <button className="button button-primary" type="submit">
            搜索
          </button>
        </form>
        {state.status === "loading" && <Loading label="正在读取可用主 SKU" />}
        {state.status === "error" && (
          <ErrorState
            message={state.message}
            onRetry={() => setRequestKey((current) => current + 1)}
          />
        )}
        {state.status === "ready" &&
          (state.data.items.length === 0 ? (
            <EmptyState label="没有符合条件的启用主 SKU。" />
          ) : (
            <>
              <div className="shop-table-scroll inventory-sku-parent-results">
                <table className="shop-table">
                  <caption className="sr-only">可选主 SKU 列表</caption>
                  <thead>
                    <tr>
                      <th>选择</th>
                      <th>业务编码</th>
                      <th>商品名称</th>
                      <th>商品目录</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.data.items.map((spu) => (
                      <tr key={spu.id}>
                        <td>
                          <input
                            aria-label={`选择主 SKU ${spu.businessCode}`}
                            type="radio"
                            name="parentSpu"
                            value={spu.id}
                            checked={selectedId === spu.id}
                            onChange={() => setSelectedId(spu.id)}
                          />
                        </td>
                        <td><code>{spu.businessCode}</code></td>
                        <td>{spu.name}</td>
                        <td>{spu.category?.displayName ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted-cell">
                显示前 {state.data.items.length} 条匹配结果，请通过搜索缩小范围。
              </p>
            </>
          ))}
        <footer className="form-actions">
          <button
            className="button button-secondary"
            type="button"
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="button button-primary"
            type="button"
            disabled={!selected}
            onClick={() => selected && onSelect(selected)}
          >
            下一步：填写库存 SKU
          </button>
        </footer>
      </section>
    </div>
  );
}

function ListingFilters({
  shopOptions,
  shopId,
  status,
  searchField,
  keyword,
  onApply,
}: {
  shopOptions: ListingShopOptionsState;
  shopId?: string;
  status?: ProductStatus;
  searchField: ProductListingSearchField;
  keyword: string;
  onApply: (
    shopId: string | undefined,
    status: ProductStatus | undefined,
    searchField: ProductListingSearchField,
    keyword: string,
  ) => void;
}) {
  const shopifyShops = shopOptions.status === "ready"
    ? shopOptions.data.shops.filter((shop) =>
        isShopifyShop(shop, shopOptions.data.platforms)
      )
    : [];
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const submittedShopId = String(values.get("shopId") ?? "");
    const safeShopId = shopOptions.status === "ready"
      ? shopifyShops.some((shop) => shop.id === submittedShopId)
        ? submittedShopId
        : undefined
      : shopId;
    onApply(
      safeShopId,
      queryStatus(String(values.get("status") ?? "")),
      queryListingSearchField(String(values.get("searchField") ?? "")),
      String(values.get("keyword") ?? "").trim().slice(0, 100),
    );
  };
  return (
    <form
      className="product-filters erp-filter-panel erp-compact-filter-panel"
      aria-label="在线商品筛选"
      key={`${shopId ?? ""}:${status ?? ""}:${searchField}:${keyword}:${shopOptions.status}`}
      onSubmit={submit}
    >
      <div className="erp-filter-row">
        <span className="erp-filter-label">平台：</span>
        <span>Shopify</span>
      </div>
      <label className="erp-filter-row">
        <span className="erp-filter-label">店铺：</span>
        <select
          name="shopId"
          defaultValue={shopId ?? ""}
          disabled={shopOptions.status !== "ready"}
        >
          <option value="">
            {shopOptions.status === "loading" ? "正在加载店铺…" : "全部店铺"}
          </option>
          {shopifyShops.map((shop) => (
            <option key={shop.id} value={shop.id}>
              {shopDisplayName(shop)}
            </option>
          ))}
        </select>
      </label>
      <label className="erp-filter-row erp-filter-short-row">
        <span className="erp-filter-label">映射状态：</span>
        <select name="status" defaultValue={status ?? ""}>
          <option value="">未归档（默认）</option>
          {statuses.map((item) => (
            <option key={item} value={item}>
              {statusLabel(item)}
            </option>
          ))}
        </select>
      </label>
      <label className="erp-filter-row erp-filter-short-row">
        <span className="erp-filter-label">搜索字段：</span>
        <select name="searchField" defaultValue={searchField}>
          <option value="ALL">全部可用字段</option>
          <option value="PLATFORM_PRODUCT">平台商品引用</option>
          <option value="PLATFORM_VARIANT">平台变体引用</option>
          <option value="EXTERNAL_STATUS">外部状态</option>
          <option value="INVENTORY_SKU">库存 SKU</option>
        </select>
      </label>
      <div className="erp-filter-row erp-filter-search-row">
        <span className="erp-filter-label">搜索内容：</span>
        <input
          aria-label="商品、变体引用、外部状态或库存 SKU"
          name="keyword"
          defaultValue={keyword}
          maxLength={100}
          placeholder="平台商品、变体引用、外部状态或库存 SKU"
        />
        <button className="button button-primary" type="submit">
          搜索
        </button>
      </div>
    </form>
  );
}

export function ListingSection({
  state,
  shopOptions = { status: "idle" },
  canWrite,
  canReadListingShops,
  shopId,
  status,
  searchField = "ALL",
  keyword,
  onFilter,
  onEdit,
  onCreate,
  onImported,
  onRetry,
  onPageChange,
  onPageSizeChange,
}: {
  state: LoadState<Page<ProductListing>> | { status: "not-permitted" };
  shopOptions?: ListingShopOptionsState;
  canWrite: boolean;
  canReadListingShops: boolean;
  shopId?: string;
  status?: ProductStatus;
  searchField?: ProductListingSearchField;
  keyword: string;
  onFilter: (
    shopId: string | undefined,
    status: ProductStatus | undefined,
    searchField: ProductListingSearchField,
    keyword: string,
  ) => void;
  onEdit: (item: ProductListing, action: ProductEditorAction) => void;
  onCreate: () => void;
  onImported: () => void;
  onRetry: () => void;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
}) {
  const optionData = shopOptions.status === "ready"
    ? shopOptions.data
    : undefined;
  const shopsById = new Map(
    optionData?.shops.map((shop) => [shop.id, shop]) ?? [],
  );
  const pageItems = state.status === "ready" ? state.data.items : [];
  const [selected, setSelected] = useState<string[]>([]);
  const [shopifyImportOpen, setShopifyImportOpen] = useState(false);
  const selectedItems = pageItems.filter((item) => selected.includes(item.id));
  useEffect(() => {
    setSelected((ids) =>
      ids.filter((id) => pageItems.some((item) => item.id === id)),
    );
  }, [
    state.status === "ready" ? state.data.page : -1,
    pageItems.map((item) => item.id).join(","),
  ]);
  const exportSelected = () => {
    if (selectedItems.length === 0) return;
    const columns = [
      "平台",
      "店铺",
      "店铺业务标识",
      "平台商品引用",
      "平台变体引用",
      "外部状态",
      "库存 SKU",
      "库存 SKU 中文名",
      "映射状态",
      "更新时间",
    ];
    const lines = [
      columns.join(","),
      ...selectedItems.map((listing) => {
        const shop = shopsById.get(listing.shopId);
        const platform = optionData?.platforms.get(listing.platformId);
        return [
          platform?.displayName ?? "Shopify",
          shop ? shopDisplayName(shop) : undefined,
          shop?.externalShopRef,
          listing.externalListingRef,
          listing.externalVariantRef,
          listing.externalStatus,
          listing.sku.businessCode,
          listing.sku.name,
          statusLabel(listing.status),
          listing.updatedAt,
        ]
          .map((value) => csvCell(value))
          .join(",");
      }),
    ];
    const url = URL.createObjectURL(
      new Blob([`\uFEFF${lines.join("\n")}\n`], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `在线商品匹配_选中${selectedItems.length}条.csv`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  return (
    <section
      className="detail-card product-section erp-data-workbench"
      aria-labelledby="listing-title"
    >
      <div className="table-heading">
        <div className="sr-only">
          <h2 id="listing-title">在线商品匹配</h2>
          <p>管理 Shopify 商品与库存 SKU 的匹配关系。</p>
        </div>
      </div>
      {canWrite && !canReadListingShops && (
        <div className="inline-alert" role="status">
          <ShieldAlert size={19} aria-hidden="true" />
          <span>
            需要管理员授予店铺和平台目录读取权限后，才能选择店铺并匹配库存 SKU。
          </span>
        </div>
      )}
      {shopOptions.status === "error" && (
        <div className="inline-alert" role="status">
          <ShieldAlert size={19} aria-hidden="true" />
          <span>{shopOptions.message}</span>
        </div>
      )}
      {state.status !== "not-permitted" && (
        <ListingFilters
          shopOptions={shopOptions}
          shopId={shopId}
          status={status}
          searchField={searchField}
          keyword={keyword}
          onApply={onFilter}
        />
      )}
      {state.status === "not-permitted" && (
        <EmptyState label="当前账号没有读取在线商品映射的权限。" />
      )}
      {state.status === "loading" && <Loading label="正在加载在线商品映射" />}
      {state.status === "error" && (
        <ErrorState message={state.message} onRetry={onRetry} />
      )}
      {state.status === "ready" && (
        <>
          <div className="erp-operation-bar" aria-label="在线商品操作">
            <div className="erp-operation-start">
              {canWrite && (
                <>
                  <button
                    className="button button-primary"
                    type="button"
                    onClick={onCreate}
                    disabled={!canReadListingShops}
                  >
                    匹配库存 SKU
                  </button>
                </>
              )}
              <span className="erp-selection-count">
                共 {state.data.totalElements} 条，已选 {selectedItems.length} 条
              </span>
            </div>
            <div className="erp-operation-end">
              <button
                className="button"
                type="button"
                disabled={!canReadListingShops}
                title={
                  !canReadListingShops
                    ? "需要店铺目录和平台目录权限才能读取 Shopify 商品"
                    : canWrite
                    ? "只读刷新 Shopify 商品目录，并按库存 SKU 预匹配"
                    : "只读预览 Shopify 商品目录；不会修改 Shopify"
                }
                onClick={() => setShopifyImportOpen(true)}
              >
                预览 Shopify 商品
              </button>
              <button
                className="button"
                type="button"
                disabled={selectedItems.length === 0}
                onClick={exportSelected}
              >
                导出勾选商品
              </button>
              <button className="button" type="button" onClick={onRetry}>
                刷新
              </button>
            </div>
          </div>
          <div className="shop-table-scroll">
            <table className="shop-table">
              <caption className="sr-only">在线商品匹配列表</caption>
              <thead>
                <tr>
                  <th>
                    <input
                      aria-label="选择当前页全部在线商品映射"
                      type="checkbox"
                      checked={
                        pageItems.length > 0 &&
                        selectedItems.length === pageItems.length
                      }
                      onChange={(event) =>
                        setSelected(
                          event.target.checked
                            ? pageItems.map((item) => item.id)
                            : [],
                        )
                      }
                    />
                  </th>
                  <th>平台 / 店铺</th>
                  <th>平台商品 / 变体</th>
                  <th>外部状态</th>
                  <th>匹配库存 SKU</th>
                  <th>映射状态</th>
                  <th>更新时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {state.data.items.map((listing) => {
                  const shop = shopsById.get(listing.shopId);
                  const platform = optionData?.platforms.get(listing.platformId);
                  return (
                    <tr key={listing.id}>
                      <td>
                        <input
                          aria-label={`选择在线商品映射 ${listing.externalListingRef}`}
                          type="checkbox"
                          checked={selected.includes(listing.id)}
                          onChange={(event) =>
                            setSelected((ids) =>
                              event.target.checked
                                ? [...ids, listing.id]
                                : ids.filter((id) => id !== listing.id),
                            )
                          }
                        />
                      </td>
                      <td>
                        <strong>{platform?.displayName ?? "Shopify"}</strong>
                        <small>{shop ? shopDisplayName(shop) : listing.shopId}</small>
                      </td>
                      <td>
                        <strong>{listing.externalListingRef}</strong>
                        <small>变体：{listing.externalVariantRef ?? "—"}</small>
                      </td>
                      <td>{listing.externalStatus ?? "—"}</td>
                      <td>
                        <strong><code>{listing.sku.businessCode}</code></strong>
                        <small>{listing.sku.name}</small>
                      </td>
                      <td>{statusLabel(listing.status)}</td>
                      <td><ProductDateTime value={listing.updatedAt} /></td>
                      <td>
                        <ResourceActions
                          item={listing}
                          canWrite={canWrite}
                          onEdit={onEdit}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {state.data.items.length === 0 ? (
            <EmptyState label="当前没有符合筛选条件的在线商品映射。" />
          ) : (
            <Pagination
              page={state.data}
              onPageChange={onPageChange}
              onPageSizeChange={onPageSizeChange}
              label="在线商品映射分页"
            />
          )}
        </>
      )}
      {shopifyImportOpen && (
        <ShopifyCatalogImportDialog
          shopOptions={shopOptions}
          initialShopId={shopId}
          canImport={canWrite}
          onRefreshShops={onRetry}
          onClose={() => setShopifyImportOpen(false)}
          onImported={onImported}
        />
      )}
    </section>
  );
}

type ShopifyCatalogPreviewState =
  | { status: "idle" }
  | { status: "loading"; data?: ShopifyCatalogPreview }
  | { status: "ready"; data: ShopifyCatalogPreview }
  | { status: "error"; message: string; data?: ShopifyCatalogPreview };

type ShopifyCatalogVariantRow = {
  product: ShopifyCatalogPreview["products"][number];
  variant: ShopifyCatalogVariantPreview;
};

export function ShopifyCatalogImportDialog({
  shopOptions,
  initialShopId,
  canImport = true,
  onRefreshShops,
  onClose,
  onImported,
}: {
  shopOptions: ListingShopOptionsState;
  initialShopId?: string;
  canImport?: boolean;
  onRefreshShops?: () => void;
  onClose: () => void;
  onImported: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const [shopSearch, setShopSearch] = useState("");
  const [selectedShopId, setSelectedShopId] = useState(initialShopId ?? "");
  const [query, setQuery] = useState("status:active");
  const [cursor, setCursor] = useState("");
  const [preview, setPreview] =
    useState<ShopifyCatalogPreviewState>({ status: "idle" });
  const [selectedVariantRefs, setSelectedVariantRefs] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] =
    useState<ShopifyCatalogImportResult | null>(null);
  const onKeyDown = useDialogFocus(dialogRef, onClose, importing);
  const rows = useMemo(
    () => preview.status === "ready" || preview.status === "error"
      ? shopifyCatalogVariantRows(preview.data)
      : [],
    [preview],
  );
  const previewData = "data" in preview ? preview.data : undefined;
  const selectedSet = useMemo(
    () => new Set(selectedVariantRefs),
    [selectedVariantRefs],
  );
  const exactRows = rows.filter(
    (row) => row.variant.matchStatus === "EXACT_SKU_MATCH",
  );
  const selectableRows = canImport
    ? exactRows.filter((row) => row.variant.externalVariantRef)
    : [];
  const selectedRows = rows.filter((row) =>
    selectedSet.has(row.variant.externalVariantRef),
  );
  const unmatchedRows = rows.length - exactRows.length;

  useEffect(() => {
    if (
      shopOptions.status === "ready" &&
      selectedShopId &&
      !shopOptions.data.shops.some((shop) => shop.id === selectedShopId)
    ) {
      setSelectedShopId("");
    }
  }, [selectedShopId, shopOptions]);

  const loadPreview = async (nextCursor = cursor) => {
    if (!selectedShopId) {
      setPreview({ status: "error", message: "请先选择 Shopify 店铺。" });
      return;
    }
    setImportResult(null);
    setPreview((previous) => ({
      status: "loading",
      data: "data" in previous ? previous.data : undefined,
    }));
    try {
      const preflightMessage = await shopifyScopePreflight(
        selectedShopId,
        "read_products",
        "商品目录读取",
      );
      if (preflightMessage) {
        setPreview((previous) => ({
          status: "error",
          message: preflightMessage,
          data: "data" in previous ? previous.data : undefined,
        }));
        return;
      }
      const data = await productCenterApi.previewShopifyCatalog({
        shopId: selectedShopId,
        limit: 50,
        cursor: nextCursor.trim() || undefined,
        query: query.trim() || undefined,
      });
      setCursor(nextCursor);
      setPreview({ status: "ready", data });
      setSelectedVariantRefs(
        canImport
          ? shopifyCatalogVariantRows(data)
              .filter((row) => row.variant.matchStatus === "EXACT_SKU_MATCH")
              .map((row) => row.variant.externalVariantRef)
          : [],
      );
    } catch (reason) {
      setPreview((previous) => ({
        status: "error",
        message: safeProductMessage(reason, "读取 Shopify 商品目录"),
        data: "data" in previous ? previous.data : undefined,
      }));
    }
  };

  const importSelected = async () => {
    if (!canImport || !selectedShopId || selectedVariantRefs.length === 0) return;
    setImporting(true);
    setImportResult(null);
    try {
      const preflightMessage = await shopifyScopePreflight(
        selectedShopId,
        "read_products",
        "商品映射导入",
      );
      if (preflightMessage) {
        setPreview((previous) => ({
          status: "error",
          message: preflightMessage,
          data: "data" in previous ? previous.data : undefined,
        }));
        return;
      }
      const result = await productCenterApi.importShopifyCatalogListings({
        shopId: selectedShopId,
        limit: 50,
        cursor: cursor.trim() || undefined,
        query: query.trim() || undefined,
        externalVariantRefs: selectedVariantRefs,
      });
      setImportResult(result);
      if (result.importedCount > 0) {
        onImported();
      }
    } catch (reason) {
      setPreview((previous) => ({
        status: "error",
        message: safeProductMessage(reason, "导入 Shopify 商品映射"),
        data: "data" in previous ? previous.data : undefined,
      }));
    } finally {
      setImporting(false);
    }
  };

  const toggleVariant = (variantRef: string, checked: boolean) => {
    setSelectedVariantRefs((current) =>
      checked
        ? current.includes(variantRef)
          ? current
          : [...current, variantRef]
        : current.filter((value) => value !== variantRef),
    );
  };

  const selectedShopReady = shopOptions.status === "ready"
    && shopOptions.data.shops.some((shop) => shop.id === selectedShopId);

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="write-dialog shopify-catalog-import-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shopify-catalog-import-title"
        onKeyDown={onKeyDown}
      >
        <header className="table-heading">
          <div>
            <h2 id="shopify-catalog-import-title">Shopify 商品目录预览</h2>
            <p>
              核对商品、变体、状态、平台 SKU 与 ERP 库存 SKU 的匹配结果。
            </p>
          </div>
          <DialogCloseButton disabled={importing} onClick={onClose} />
        </header>
        <div className="shopify-catalog-boundary" role="note">
          <Eye size={19} aria-hidden="true" />
          <div>
            <strong>只读 Shopify 预览</strong>
            <span>
              刷新仅读取 Shopify 商品目录，不修改商品、售价或库存。
              {canImport
                ? " 导入只会在明确确认后保存 ERP 商品映射。"
                : " 当前账号没有 ERP 映射写入权限。"}
            </span>
          </div>
        </div>
        <div className="detail-form shopify-catalog-controls">
          <ListingShopPicker
            state={shopOptions}
            search={shopSearch}
            selectedShopId={selectedShopId}
            onSearchChange={setShopSearch}
            onSelectedShopChange={(value) => {
              setSelectedShopId(value);
              setPreview({ status: "idle" });
              setSelectedVariantRefs([]);
              setImportResult(null);
            }}
            onRefresh={onRefreshShops}
          />
          <label className="shopify-catalog-query-field">
            商品范围
            <select
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setCursor("");
                setPreview({ status: "idle" });
                setSelectedVariantRefs([]);
                setImportResult(null);
              }}
            >
              <option value="status:active">在售商品</option>
              <option value="">全部商品</option>
              <option value="status:draft">草稿商品</option>
              <option value="status:archived">已归档商品</option>
            </select>
            <small>切换范围后请重新刷新预览。</small>
          </label>
          <div className="form-actions shopify-catalog-refresh-actions">
            <button
              className="button button-primary"
              type="button"
              disabled={!selectedShopReady || preview.status === "loading" || importing}
              onClick={() => void loadPreview("")}
            >
              <RefreshCw
                className={preview.status === "loading" ? "spin" : undefined}
                size={16}
                aria-hidden="true"
              />
              {preview.status === "loading" ? "正在刷新" : "刷新预览"}
            </button>
            <button
              className="button"
              type="button"
              disabled={
                !selectedShopReady ||
                !previewData?.hasNextPage ||
                preview.status === "loading" ||
                importing
              }
              onClick={() => void loadPreview(previewData?.cursor ?? "")}
            >
              下一页
            </button>
            {previewData?.fetchedAt && (
              <span className="shopify-catalog-fetched-at">
                最近读取：<ProductDateTime value={previewData.fetchedAt} />
              </span>
            )}
          </div>
        </div>
        {preview.status === "loading" && (
          <Loading label="正在读取 Shopify 商品目录" />
        )}
        {preview.status === "error" && (
          <div className="inline-alert" role="alert">
            <ShieldAlert size={18} aria-hidden="true" />
            <span>{preview.message}</span>
          </div>
        )}
        {(preview.status === "ready" || preview.status === "error") && (
          <>
            <dl className="shopify-catalog-summary" aria-label="商品目录预览摘要">
              <div>
                <dt>本页商品</dt>
                <dd>{previewData?.products.length ?? 0}</dd>
              </div>
              <div>
                <dt>本页变体</dt>
                <dd>{rows.length}</dd>
              </div>
              <div className="is-success">
                <dt>已匹配库存 SKU</dt>
                <dd>{exactRows.length}</dd>
              </div>
              <div className={unmatchedRows > 0 ? "is-warning" : "is-success"}>
                <dt>待匹配</dt>
                <dd>{unmatchedRows}</dd>
              </div>
            </dl>
            <div className="erp-operation-bar" aria-label="Shopify 商品目录操作">
              <div className="erp-operation-start">
                {canImport ? (
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={
                        selectableRows.length > 0 &&
                        selectedRows.length === selectableRows.length
                      }
                      disabled={selectableRows.length === 0 || importing}
                      onChange={(event) =>
                        setSelectedVariantRefs(
                          event.target.checked
                            ? selectableRows.map((row) =>
                                row.variant.externalVariantRef)
                            : [],
                        )
                      }
                    />
                    勾选全部已匹配变体
                  </label>
                ) : (
                  <span className="shopify-catalog-readonly-mode">
                    <LockKeyhole size={16} aria-hidden="true" />
                    当前为只读预览
                  </span>
                )}
              </div>
              <div className="erp-operation-end">
                {canImport && (
                  <>
                    <span className="erp-selection-count">
                      已选 {selectedRows.length} 个精确匹配变体
                    </span>
                    <button
                      className="button button-primary"
                      type="button"
                      disabled={selectedVariantRefs.length === 0 || importing}
                      onClick={() => void importSelected()}
                    >
                      {importing ? "正在导入 ERP" : "导入到 ERP"}
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className="shop-table-scroll">
              <table className="shop-table">
                <caption className="sr-only">Shopify 商品目录预览</caption>
                <thead>
                  <tr>
                    {canImport && <th>选择</th>}
                    <th>Shopify 商品</th>
                    <th>Shopify 变体 / SKU</th>
                    <th>商品状态</th>
                    <th>售价</th>
                    <th>库存跟踪</th>
                    <th>ERP 库存 SKU</th>
                    <th>匹配结果</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ product, variant }) => {
                    const selectable =
                      variant.matchStatus === "EXACT_SKU_MATCH";
                    return (
                      <tr key={variant.externalVariantRef}>
                        {canImport && (
                          <td>
                            <input
                              aria-label={`选择 Shopify 变体 ${variant.externalVariantRef}`}
                              type="checkbox"
                              disabled={!selectable || importing}
                              checked={selectedSet.has(variant.externalVariantRef)}
                              onChange={(event) =>
                                toggleVariant(
                                  variant.externalVariantRef,
                                  event.target.checked,
                                )
                              }
                            />
                          </td>
                        )}
                        <td>
                          <strong>{product.title}</strong>
                          <small>{shopifyReferenceLabel(product.externalListingRef, "商品")}</small>
                        </td>
                        <td>
                          <strong>{variant.title}</strong>
                          <small>{shopifyReferenceLabel(variant.externalVariantRef, "变体")}</small>
                          <small>SKU：{variant.platformSku || "—"}</small>
                        </td>
                        <td>
                          <span className={`shopify-product-status ${shopifyProductStatusClass(product.externalStatus)}`}>
                            {shopifyProductStatusLabel(product.externalStatus)}
                          </span>
                          <small>更新：<ProductDateTime value={product.updatedAt} /></small>
                        </td>
                        <td>
                          {variant.price ?? "—"}
                          {variant.currencyCode ? ` ${variant.currencyCode}` : ""}
                        </td>
                        <td>
                          {variant.inventoryTracked ? "跟踪" : "不跟踪"}
                          <small>{variant.availableForSale ? "可售" : "不可售"}</small>
                        </td>
                        <td>
                          {variant.localSku ? (
                            <>
                              <strong><code>{variant.localSku.businessCode}</code></strong>
                              <small>{variant.localSku.name}</small>
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>
                          <span className={`shopify-match-status ${shopifyMatchStatusClass(variant.matchStatus)}`}>
                            {shopifyMatchStatusLabel(variant.matchStatus)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {rows.length === 0 && (
              <EmptyState label="当前 Shopify 查询没有返回商品。" />
            )}
          </>
        )}
        {importResult && (
          <div className="inline-alert" role="status">
            <span>
              已请求 {importResult.requestedCount} 个，成功/已存在 {importResult.importedCount} 个，
              跳过 {importResult.skippedCount} 个。
            </span>
            {importResult.items.length > 0 && (
              <details>
                <summary>查看导入结果</summary>
                <div className="shop-table-scroll">
                  <table className="shop-table compact-table">
                    <caption className="sr-only">Shopify 商品导入结果明细</caption>
                    <thead>
                      <tr>
                        <th>商品</th>
                        <th>变体 / SKU</th>
                        <th>结果</th>
                        <th>说明</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importResult.items.map((item) => (
                        <tr key={item.externalVariantRef}>
                          <td>{item.externalListingRef}</td>
                          <td>
                            <code>{item.platformSku ?? item.externalVariantRef}</code>
                            <small>{item.externalVariantRef}</small>
                          </td>
                          <td>{shopifyImportStatusLabel(item.status)}</td>
                          <td>{shopifyImportSummary(item.status)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function shopifyCatalogVariantRows(
  preview: ShopifyCatalogPreview | undefined,
): ShopifyCatalogVariantRow[] {
  if (!preview) return [];
  return preview.products.flatMap((product) =>
    product.variants.map((variant) => ({ product, variant })),
  );
}

function shopifyMatchStatusLabel(
  status: ShopifyCatalogVariantPreview["matchStatus"],
) {
  if (status === "EXACT_SKU_MATCH") return "已匹配";
  if (status === "MISSING_LOCAL_SKU") return "缺少库存 SKU";
  return "平台 SKU 为空";
}

function shopifyMatchStatusClass(
  status: ShopifyCatalogVariantPreview["matchStatus"],
) {
  return status === "EXACT_SKU_MATCH" ? "is-success" : "is-warning";
}

function shopifyProductStatusLabel(status?: string) {
  const normalized = status?.trim().toUpperCase();
  if (normalized === "ACTIVE") return "在售";
  if (normalized === "DRAFT") return "草稿";
  if (normalized === "ARCHIVED") return "已归档";
  return "状态未知";
}

function shopifyProductStatusClass(status?: string) {
  const normalized = status?.trim().toUpperCase();
  if (normalized === "ACTIVE") return "is-success";
  if (normalized === "DRAFT") return "is-warning";
  return "is-muted";
}

function shopifyReferenceLabel(reference: string, subject: "商品" | "变体") {
  const identifier = reference.split("/").filter(Boolean).at(-1);
  return identifier ? `${subject} ID：${identifier}` : `${subject} ID：—`;
}

function shopifyImportStatusLabel(status: ShopifyCatalogImportStatus) {
  if (status === "IMPORTED_OR_ALREADY_BOUND") return "已导入/已存在";
  if (status === "SKIPPED_NOT_IN_PAGE") return "不在当前预览页";
  if (status === "SKIPPED_EMPTY_PLATFORM_SKU") return "平台 SKU 为空";
  if (status === "SKIPPED_MISSING_LOCAL_SKU") return "缺少库存 SKU";
  return "映射冲突";
}

function shopifyImportSummary(status: ShopifyCatalogImportStatus) {
  if (status === "IMPORTED_OR_ALREADY_BOUND") {
    return "ERP 映射已保存或原记录已存在。";
  }
  if (status === "SKIPPED_NOT_IN_PAGE") return "该变体不在本次预览结果中。";
  if (status === "SKIPPED_EMPTY_PLATFORM_SKU") return "平台 SKU 为空，未导入。";
  if (status === "SKIPPED_MISSING_LOCAL_SKU") return "未找到同编码库存 SKU，未导入。";
  return "与现有 ERP 商品映射冲突，请检查后重试。";
}

type MasterSpuTransferItem = MasterSpuCsvRow & {
  images: File[];
  outcome?: { kind: "success" | "error"; message: string };
};

export function masterSpuImageValidationError(
  mode: "create" | "update",
  imageCount: number,
) {
  return mode === "create" && imageCount < 1
    ? "新建主商品时至少选择 1 张商品图片。"
    : undefined;
}

function MasterSpuTransferDialog({
  mode,
  onDownloadTemplate,
  onClose,
  onComplete,
}: {
  mode: "create" | "update";
  onDownloadTemplate: () => Promise<void>;
  onClose: () => void;
  onComplete: () => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  const [items, setItems] = useState<MasterSpuTransferItem[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const onKeyDown = useDialogFocus(dialog, onClose, busy);
  const updateImages = (rowNumber: number, files: FileList | null) => {
    if (!files) return;
    const additions = Array.from(files);
    if (additions.some((file) => !["image/jpeg", "image/png"].includes(file.type) || file.size < 1 || file.size > 5 * 1024 * 1024)) {
      setError("图片仅支持不超过 5 MiB 的 JPEG 或 PNG 文件。");
      return;
    }
    setItems((current) => current.map((item) => {
      if (item.rowNumber !== rowNumber) return item;
      if (item.images.length + additions.length > 10) {
        setError(`第 ${rowNumber} 行最多可选择 10 张图片。`);
        return item;
      }
      return { ...item, images: [...item.images, ...additions], outcome: undefined };
    }));
  };
  const load = async (file: File | undefined) => {
    if (!file) return;
    if (file.size < 1 || file.size > 2 * 1024 * 1024 || !/\.csv$/i.test(file.name)) {
      setError("请选择不超过 2 MiB 的 CSV 文件。");
      return;
    }
    try {
      const parsed = parseMasterSpuCsv(await file.text());
      setItems(parsed.map((item) => ({ ...item, images: [] })));
      setError(undefined);
    } catch (reason) {
      setItems([]);
      setError(reason instanceof Error ? reason.message : "无法读取导入文件。");
    }
  };
  const validate = (item: MasterSpuTransferItem) => {
    const values = masterSpuInputFromCsv(item);
    if (mode === "create") {
      const imageError = masterSpuImageValidationError(mode, item.images.length);
      if (imageError) throw new Error(imageError);
      return values;
    }
    const id = csvOptionalUuid(item.values.id, "主商品");
    if (!id || !/^\d+$/.test(item.values.version)) throw new Error("更新必须使用导出文件中的 id 与 version。");
    const version = Number(item.values.version);
    if (!Number.isSafeInteger(version) || version < 0) throw new Error("版本号无效。");
    if (!statuses.includes(item.values.status as ProductStatus)) throw new Error("状态必须为启用、停用或已归档对应的导出值。");
    return { ...values, id, version, status: item.values.status as ProductStatus };
  };
  const run = async () => {
    if (busy || items.length === 0) return;
    const pending = items.filter((item) => item.outcome?.kind !== "success");
    const localErrors = new Map<number, string>();
    for (const item of pending) {
      try { validate(item); } catch (reason) { localErrors.set(item.rowNumber, reason instanceof Error ? reason.message : "字段无效。"); }
    }
    if (localErrors.size > 0) {
      setItems((current) => current.map((item) => localErrors.has(item.rowNumber)
        ? { ...item, outcome: { kind: "error", message: localErrors.get(item.rowNumber)! } } : item));
      setError("请先修正标记为错误的 CSV 数据行。");
      return;
    }
    setBusy(true);
    setError(undefined);
    for (const item of pending) {
      try {
        const input = validate(item);
        if (mode === "create") {
          await productCenterApi.createSpuWithImages(input, item.images);
        } else {
          const update = input as ReturnType<typeof validate> & { id: string; version: number; status: ProductStatus };
          if (item.images.length > 0) await productCenterApi.updateSpuWithImages(update.id, update, item.images);
          else await productCenterApi.updateSpu(update.id, update);
        }
        setItems((current) => current.map((candidate) => candidate.rowNumber === item.rowNumber
          ? { ...candidate, outcome: { kind: "success", message: "已保存" } } : candidate));
      } catch (reason) {
        setItems((current) => current.map((candidate) => candidate.rowNumber === item.rowNumber
          ? { ...candidate, outcome: { kind: "error", message: safeProductMessage(reason, "保存该行主商品") } } : candidate));
      }
    }
    setBusy(false);
  };
  const successCount = items.filter((item) => item.outcome?.kind === "success").length;
  const errorCount = items.filter((item) => item.outcome?.kind === "error").length;
  return <div className="dialog-backdrop" role="presentation"><section ref={dialog} className="write-dialog product-transfer-dialog" role="dialog" aria-modal="true" aria-labelledby="master-spu-transfer-title" onKeyDown={onKeyDown}>
    <header className="table-heading"><div><h2 id="master-spu-transfer-title">{mode === "create" ? "模板导入主 SKU" : "更新已有主 SKU"}</h2><p>请使用下载模板的完整字段；导入时会校验目录状态和资料关联。</p></div><DialogCloseButton disabled={busy} onClick={onClose} /></header>
    <label>CSV 文件<input type="file" accept=".csv,text/csv" disabled={busy} onChange={(event) => { void load(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} /></label>
    <button className="button button-secondary" type="button" disabled={busy} onClick={() => void onDownloadTemplate()}>
      {mode === "create" ? "下载 CSV 模板" : "下载更新模板"}
    </button>
    <p className="form-help">{mode === "create" ? "每行至少选择 1 张 JPEG 或 PNG 图片，第 1 张作为主图。" : "可为需要补充或替换图片的商品选择 JPEG 或 PNG 文件；不改图片时可留空。"}</p>
    {error && <div className="inline-alert" role="alert">{error}</div>}
    {items.length > 0 && <><div className="shop-table-scroll"><table className="shop-table"><caption className="sr-only">主 SKU 导入预览</caption><thead><tr><th>行</th><th>主 SKU</th><th>中文名称</th><th>目录</th><th>尺寸/重量</th><th>包装资料</th><th>敏感属性</th><th>{mode === "create" ? "图片（必填）" : "图片"}</th><th>结果</th></tr></thead><tbody>{items.map((item) => <tr key={item.rowNumber}><td>{item.rowNumber}</td><td><code>{item.values.businessCode}</code></td><td>{item.values.nameZh}<small>{item.values.nameEn || "—"}</small></td><td>{item.values.categoryId || "—"}</td><td>{[item.values.lengthMm, item.values.widthMm, item.values.heightMm].filter(Boolean).join(" × ") || "—"}<small>{item.values.actualWeightGrams ? `${item.values.actualWeightGrams} g` : "—"}</small></td><td>{item.values.packageMaterialId || "—"}</td><td>{item.values.sensitiveAttributeCodes || "—"}</td><td><label className="text-button">选择图片<input className="sr-only" type="file" accept="image/jpeg,image/png" multiple disabled={busy} onChange={(event) => { updateImages(item.rowNumber, event.currentTarget.files); event.currentTarget.value = ""; }} /></label><small>{item.images.length === 0 ? (mode === "create" ? "未选择（必填）" : "未选择") : `已选择 ${item.images.length} 张`}</small></td><td>{item.outcome?.kind === "success" ? <span className="status-badge status-active">已保存</span> : item.outcome ? <span className="field-error">{item.outcome.message}</span> : "待处理"}</td></tr>)}</tbody></table></div><footer className="form-actions"><span>{successCount > 0 ? `已保存 ${successCount} 行` : ""}{errorCount > 0 ? `；${errorCount} 行可修正后重试` : ""}</span><button className="button button-secondary" type="button" disabled={busy} onClick={onClose}>{successCount === items.length ? "完成" : "取消"}</button><button className="button button-primary" type="button" disabled={busy || successCount === items.length} onClick={() => void run()}>{busy ? "正在处理…" : errorCount > 0 ? "重试失败行" : "确认处理"}</button>{successCount === items.length && <button className="button button-primary" type="button" onClick={onComplete}>刷新列表</button>}</footer></>}
  </section></div>;
}

function Loading({ label }: { label: string }) {
  return (
    <div className="product-state" aria-busy="true">
      <CircleDashed className="spin" size={20} aria-hidden="true" />
      {label}
    </div>
  );
}
function EmptyState({ label }: { label: string }) {
  return (
    <div className="product-state">
      <Layers3 size={20} aria-hidden="true" />
      {label}
    </div>
  );
}
function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="product-state" role="alert">
      <ShieldAlert size={20} aria-hidden="true" />
      <span>{message}</span>
      <button
        className="button button-secondary"
        type="button"
        onClick={onRetry}
      >
        重试
      </button>
    </div>
  );
}

function focusableElements(root: HTMLElement) {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute("hidden"));
}

function closeActionMenu(source: HTMLElement) {
  source.closest("details")?.removeAttribute("open");
}

function useDialogFocus(
  dialogRef: React.RefObject<HTMLElement | null>,
  onClose: () => void,
  submitting: boolean,
) {
  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const timer = window.setTimeout(
      () => {
        if (!dialogRef.current) return;
        const preferred = dialogRef.current.querySelector<HTMLElement>(
          "[autofocus], input:not([type='hidden']):not(:disabled), select:not(:disabled), textarea:not(:disabled)",
        );
        (preferred ?? focusableElements(dialogRef.current).at(0))?.focus();
      },
      0,
    );
    return () => {
      window.clearTimeout(timer);
      previouslyFocused?.focus();
    };
  }, [dialogRef]);

  return (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && !submitting) {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const elements = focusableElements(event.currentTarget);
    if (elements.length === 0) return;
    const first = elements[0];
    const last = elements[elements.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
}

async function readLatest(
  kind: ProductEditorKind,
  id: string,
  expectedSpuId?: string,
): Promise<ProductEditorItem> {
  if (kind === "sku") return productCenterApi.getSku(id, expectedSpuId);
  return productCenterApi.getListing(id);
}

export async function loadAllPages<T extends { id: string }>(
  loadPage: (page: number) => Promise<Page<T>>,
  isCurrent: () => boolean,
): Promise<T[] | undefined> {
  const first = await loadPage(0);
  if (!isCurrent()) return undefined;
  if (
    first.totalElements > MAX_REFERENCE_ITEMS ||
    first.totalPages >
      Math.ceil(MAX_REFERENCE_ITEMS / Math.max(first.size, 1))
  ) {
    throw new Error("目录超过 10,000 项，无法安全加载。");
  }
  const items = [...first.items];
  for (let page = 1; page < first.totalPages; page += 1) {
    const next = await loadPage(page);
    if (!isCurrent()) return undefined;
    if (
      next.page !== page ||
      next.totalElements !== first.totalElements ||
      next.totalPages !== first.totalPages
    ) {
      throw new Error("目录分页结果不一致，请刷新后重试。");
    }
    items.push(...next.items);
    if (items.length > MAX_REFERENCE_ITEMS) {
      throw new Error("目录超过 10,000 项，无法安全加载。");
    }
  }
  if (
    items.length !== first.totalElements ||
    new Set(items.map((item) => item.id)).size !== items.length
  ) {
    throw new Error("目录分页结果不一致，请刷新后重试。");
  }
  return items;
}

function listingShopLabel(
  shop: TenantShop,
  platforms: Map<string, PlatformCatalogEntry>,
) {
  const platform = platforms.get(shop.platformId);
  const platformLabel = platform
    ? `${platform.displayName}（${platform.code}）`
    : `平台 ${shop.platformId}`;
  return `${platformLabel} / ${shopDisplayName(shop)} / ${shop.externalShopRef}`;
}

export function isShopifyShop(
  shop: TenantShop,
  platforms: Map<string, PlatformCatalogEntry>,
) {
  return (
    platforms.get(shop.platformId)?.code.trim().toUpperCase() ===
      SHOPIFY_PLATFORM_CODE && shop.status === "ACTIVE"
  );
}

export function ListingShopPicker({
  state,
  search,
  selectedShopId,
  onSearchChange,
  onSelectedShopChange,
  onRefresh,
}: {
  state: ListingShopOptionsState;
  search: string;
  selectedShopId: string;
  onSearchChange: (value: string) => void;
  onSelectedShopChange: (value: string) => void;
  onRefresh?: () => void;
}) {
  if (state.status === "loading") {
    return <Loading label="正在加载可用店铺" />;
  }
  if (state.status === "error") {
    return onRefresh
      ? <ErrorState message={state.message} onRetry={onRefresh} />
      : <div className="inline-alert" role="alert">{state.message}</div>;
  }
  if (state.status === "idle") {
    return (
      <div className="inline-alert" role="status">
        需要管理员授予店铺和平台目录读取权限后才能选择店铺。
      </div>
    );
  }

  const { shops, platforms } = state.data;
  const shopifyShops = shops.filter((shop) => isShopifyShop(shop, platforms));
  if (shopifyShops.length === 0) {
    return <EmptyState label="暂无可用于在线商品匹配的启用 Shopify 店铺。" />;
  }
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const matchingShops = shopifyShops.filter((shop) =>
    listingShopLabel(shop, platforms).toLocaleLowerCase().includes(normalizedSearch),
  );
  const selectedShop = shopifyShops.find((shop) => shop.id === selectedShopId);
  const options =
    selectedShop && !matchingShops.some((shop) => shop.id === selectedShop.id)
      ? [selectedShop, ...matchingShops]
      : matchingShops;
  const selectedPlatform = selectedShop
    ? platforms.get(selectedShop.platformId)
    : undefined;

  return (
    <>
      <label>
        搜索店铺
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value.slice(0, 160))}
          maxLength={160}
          placeholder="Shopify 店铺名称或业务标识"
        />
      </label>
      <label>
        店铺
        <select
          name="shopId"
          required
          value={selectedShopId}
          onChange={(event) => onSelectedShopChange(event.target.value)}
          disabled={options.length === 0}
        >
          <option value="">请选择店铺</option>
          {options.map((shop) => (
            <option key={shop.id} value={shop.id}>
              {listingShopLabel(shop, platforms)}
            </option>
          ))}
        </select>
      </label>
      {options.length === 0 && (
        <p role="status">没有匹配的可映射店铺。</p>
      )}
      {selectedShop && (
        <p className="muted-cell" role="status">
          已选择：{shopDisplayName(selectedShop)}（{selectedShop.externalShopRef}） / {" "}
          {selectedPlatform
            ? `${selectedPlatform.displayName}（${selectedPlatform.code}）`
            : `平台 ${selectedShop.platformId}`}
        </p>
      )}
      {onRefresh && (
        <button className="text-button" type="button" onClick={onRefresh}>
          刷新可映射店铺
        </button>
      )}
    </>
  );
}

export function ProductWriteDialog({
  editor,
  selectedSpuId,
  availableSkus,
  canReadListingShops = false,
  canReadSkuWarehouses = false,
  canWriteSkuWeight = false,
  onClose,
  onSaved,
}: {
  editor: ProductEditor;
  selectedSpuId?: string;
  availableSkus: ProductSku[];
  canReadListingShops?: boolean;
  canReadSkuWarehouses?: boolean;
  canWriteSkuWeight?: boolean;
  onClose: () => void;
  onSaved: (saved: ProductSku | ProductListing) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [costFieldError, setCostFieldError] = useState<string | null>(null);
  const [conflictRecovered, setConflictRecovered] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [currentItem, setCurrentItem] = useState<ProductEditorItem | undefined>(
    editor.item,
  );
  const [listingShopOptions, setListingShopOptions] =
    useState<ListingShopOptionsState>({ status: "idle" });
  const [shopSearch, setShopSearch] = useState("");
  const [selectedShopId, setSelectedShopId] = useState("");
  const [skuWarehouses, setSkuWarehouses] = useState<
    { status: "idle" | "loading" | "error" | "ready"; data?: Warehouse[]; message?: string }
  >({ status: "idle" });
  const dialogRef = useRef<HTMLElement>(null);
  const listingShopOptionsVersion = useRef(0);
  const onKeyDown = useDialogFocus(dialogRef, onClose, submitting);
  const item = currentItem;
  const skuParentId =
    editor.kind === "sku"
      ? selectedSpuId ?? (item as ProductSku | undefined)?.spuId
      : undefined;
  const isListingCreate = editor.kind === "listing" && editor.action === "create";
  const isArchive = editor.action === "archive";
  // Warehouse choices are fetched only after the caller confirms directory access.
  // A denied or unavailable directory leaves the selector disabled without exposing options.
  const canLoadSkuWarehouses = editor.kind === "sku" && canReadSkuWarehouses;
  const targetStatus: ProductStatus | undefined =
    editor.action === "activate"
      ? "ACTIVE"
      : editor.action === "deactivate"
        ? "INACTIVE"
        : undefined;
  const title = isArchive
    ? `确认归档${editor.kind.toUpperCase()}`
    : editor.action === "create"
      ? `新增${editor.kind.toUpperCase()}`
      : targetStatus
        ? `${targetStatus === "ACTIVE" ? "启用" : "停用"}${editor.kind.toUpperCase()}`
        : `编辑${editor.kind.toUpperCase()}`;

  const loadListingShopOptions = useCallback(async () => {
    const version = listingShopOptionsVersion.current + 1;
    listingShopOptionsVersion.current = version;
    if (!shouldLoadListingShopOptions(canReadListingShops, isListingCreate)) {
      setListingShopOptions({ status: "idle" });
      return;
    }
    const isCurrent = () => version === listingShopOptionsVersion.current;
    setListingShopOptions((previous) => ({
      status: "loading",
      data: "data" in previous ? previous.data : undefined,
    }));
    try {
      const [shops, platforms] = await Promise.all([
        loadAllPages(
          (page) =>
            shopCenterApi.listShops({
              includeArchived: false,
              page,
              size: 200,
            }),
          isCurrent,
        ),
        loadAllPages(
          (page) =>
            shopCenterApi.listPlatforms({
              includeArchived: false,
              page,
              size: 200,
            }),
          isCurrent,
        ),
      ]);
      if (!isCurrent() || !shops || !platforms) return;
      const platformMap = new Map(
        platforms.map((platform) => [platform.id, platform]),
      );
      setListingShopOptions({
        status: "ready",
        data: {
          // The first product-identity batch is Shopify-only. Keep the
          // selectable set fail-closed even if the platform directory is
          // incomplete or the tenant also owns other platform shops.
          shops: shops.filter((shop) => isShopifyShop(shop, platformMap)),
          platforms: platformMap,
        },
      });
    } catch (reason) {
      if (!isCurrent()) return;
      setListingShopOptions({
        status: "error",
        message: safeProductMessage(reason, "读取可映射店铺"),
      });
    }
  }, [canReadListingShops, isListingCreate]);

  useEffect(() => {
    void loadListingShopOptions();
    return () => {
      listingShopOptionsVersion.current += 1;
    };
  }, [loadListingShopOptions]);

  useEffect(() => {
    let active = true;
    if (editor.kind !== "sku" || !canLoadSkuWarehouses) {
      setSkuWarehouses({ status: "idle" });
      return () => { active = false; };
    }
    setSkuWarehouses({ status: "loading" });
    void loadAllPages((page) => warehouseCenterApi.listWarehouses({
      status: "ACTIVE", page, size: 200,
    }), () => active).then(
      (items) => { if (active && items) setSkuWarehouses({ status: "ready", data: items }); },
      () => { if (active) setSkuWarehouses({ status: "error", message: "仓库目录暂时无法读取，请稍后重试。" }); },
    );
    return () => { active = false; };
  }, [canLoadSkuWarehouses, editor.kind]);

  useEffect(() => {
    if (
      listingShopOptions.status === "ready" &&
      selectedShopId &&
      !listingShopOptions.data.shops.some((shop) => shop.id === selectedShopId)
    ) {
      setSelectedShopId("");
    }
  }, [listingShopOptions, selectedShopId]);

  const selectedListingShop =
    listingShopOptions.status === "ready"
      ? listingShopOptions.data.shops.find(
          (shop) =>
            shop.id === selectedShopId &&
            isShopifyShop(shop, listingShopOptions.data.platforms),
        )
      : undefined;

  const save = async (form: FormData) => {
    if (isArchive) {
      if (!item) throw new Error("Missing product resource");
      if (editor.kind === "sku")
        return productCenterApi.archiveSku(
          item.id,
          item.version,
          skuParentId,
        );
      return productCenterApi.archiveListing(item.id, item.version);
    }
    if (editor.kind === "sku") {
      const input = {
        businessCode: String(form.get("businessCode") ?? "").trim(),
        name: String(form.get("name") ?? "").trim(),
        nameEn: String(form.get("nameEn") ?? "").trim() || undefined,
        variantSummary:
          String(form.get("variantSummary") ?? "").trim() || undefined,
        unitCost: String(form.get("unitCost") ?? "").trim() || undefined,
        currencyCode: String(form.get("currencyCode") ?? "").trim().toUpperCase() || undefined,
        defaultWarehouseId: String(form.get("defaultWarehouseId") ?? "").trim() || undefined,
      };
      if (editor.action === "create") {
        if (!selectedSpuId) throw new Error("Missing selected SPU");
        const created = await productCenterApi.createSku(selectedSpuId, input);
        const weight = String(form.get("standardWeightGrams") ?? "").trim();
        return canWriteSkuWeight && weight
          ? productCenterApi.updateSkuStandardWeight(created.id, {
              version: created.version,
              standardWeightGrams: Number(weight),
            })
          : created;
      }
      const saved = await productCenterApi.updateSku(item!.id, {
        ...input,
        status: targetStatus ?? item!.status,
        version: item!.version,
      }, skuParentId);
      if (!canWriteSkuWeight || targetStatus) return saved;
      const rawWeight = String(form.get("standardWeightGrams") ?? "").trim();
      const nextWeight = rawWeight ? Number(rawWeight) : null;
      if ((nextWeight ?? undefined) === (item as ProductSku).standardWeightGrams) {
        return saved;
      }
      return productCenterApi.updateSkuStandardWeight(saved.id, {
        version: saved.version,
        standardWeightGrams: nextWeight,
      });
    }
    const externalStatus =
      String(form.get("externalStatus") ?? "").trim() || undefined;
    if (editor.action === "create") {
      const shopId = String(form.get("shopId") ?? "").trim();
      if (!selectedListingShop || shopId !== selectedListingShop.id) {
        throw new Error("Invalid Shopify shop selection");
      }
      const listingInput: ListingInput = {
        shopId,
        skuId: String(form.get("skuId") ?? "").trim(),
        externalListingRef: String(form.get("externalListingRef") ?? "").trim(),
        externalVariantRef:
          String(form.get("externalVariantRef") ?? "").trim() || undefined,
        externalStatus,
      };
      return productCenterApi.createListing(listingInput);
    }
    return productCenterApi.updateListing(item!.id, {
      externalStatus,
      status: targetStatus ?? (item as ProductListing).status,
      version: item!.version,
    });
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isArchive && !confirmed) {
      setConfirmed(true);
      return;
    }
    const form = new FormData(event.currentTarget);
    if (editor.kind === "sku" && !targetStatus) {
      const costError = optionalAmountCurrencyError(
        String(form.get("unitCost") ?? ""),
        String(form.get("currencyCode") ?? ""),
        "成本价",
      );
      if (costError) {
        setCostFieldError(costError);
        setError(null);
        return;
      }
    }
    setSubmitting(true);
    setError(null);
    setCostFieldError(null);
    try {
      const saved = await save(form);
      onSaved(saved as ProductSku | ProductListing);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409 && item) {
        try {
          const latest = await readLatest(
            editor.kind,
            item.id,
            skuParentId,
          );
          setCurrentItem(latest);
          setConflictRecovered(true);
          setError(
            "商品资料已更新。已保留本次输入，请确认后再次保存。",
          );
        } catch (refreshError) {
          setError(safeProductMessage(refreshError, "刷新冲突资源"));
        }
      } else {
        setError(safeProductMessage(reason, "保存商品资料"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const listingItem = item as ProductListing | undefined;
  const skuItem = item as ProductSku | undefined;
  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="write-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="write-title"
        onKeyDown={onKeyDown}
      >
        <header className="table-heading">
          <h2 id="write-title">{title}</h2>
          <DialogCloseButton disabled={submitting} onClick={onClose} />
        </header>
        {isArchive ? (
          <form onSubmit={submit}>
            <p>
              {editor.kind === "sku"
                  ? "归档 SKU 前必须先归档其全部在线商品映射；归档不会级联执行。"
                  : "归档后，该映射不再参与后续商品匹配，也不会更改店铺商品。"}
            </p>
            {confirmed && <p role="alert">请再次确认此归档操作。</p>}
            {error && <p role="alert">{error}</p>}
            <DialogActions
              submitting={submitting}
              onClose={onClose}
              submitLabel={confirmed ? "确认归档" : "继续确认"}
              danger
            />
          </form>
        ) : (
          <form className="detail-form" onSubmit={submit}>
            {editor.kind === "sku" && (
              <>
                <label>
                  业务编码
                  <input
                    name="businessCode"
                    required
                    pattern="[A-Z][A-Z0-9_-]{1,63}"
                    title="以大写字母开头，仅可包含大写字母、数字、下划线和连字符。"
                    defaultValue={
                      editor.action === "create"
                        ? ""
                        : (skuItem?.businessCode ?? "")
                    }
                    disabled={editor.action !== "create"}
                  />
                </label>
                <label>
                  名称
                  <input
                    name="name"
                    required
                    maxLength={200}
                    defaultValue={skuItem?.name ?? ""}
                    disabled={Boolean(targetStatus)}
                  />
                </label>
                <label>
                  商品英文名
                  <input name="nameEn" maxLength={200} defaultValue={skuItem?.nameEn ?? ""} disabled={Boolean(targetStatus)} />
                </label>
                <label>
                  规格
                  <input
                    name="variantSummary"
                    maxLength={1000}
                    defaultValue={skuItem?.variantSummary ?? ""}
                    disabled={Boolean(targetStatus)}
                  />
                </label>
                <label>
                  成本价
                  <input name="unitCost" inputMode="decimal" pattern="(0|[1-9][0-9]{0,9})(\\.[0-9]{1,4})?" defaultValue={skuItem?.unitCost ?? ""} disabled={Boolean(targetStatus)} placeholder="例如 2.50" onChange={() => setCostFieldError(null)} />
                </label>
                <label>
                  成本币种
                  <CurrencyCodeInput name="currencyCode" listId="product-sku-cost-currency-options" defaultValue={skuItem?.currencyCode ?? ""} disabled={Boolean(targetStatus)} onChange={(event) => { event.currentTarget.value = event.currentTarget.value.toUpperCase(); setCostFieldError(null); }} />
                </label>
                <div className="product-sku-cost-help">
                  <small>成本价非必填；填写后请选择币种。可选择常用币种，或输入 ISO 三位代码。</small>
                  {costFieldError && <small className="field-error" role="alert">{costFieldError}</small>}
                </div>
                {canWriteSkuWeight && (
                  <label>
                    单件标准重量（克）
                    <input
                      name="standardWeightGrams"
                      type="number"
                      min="1"
                      max="999999999"
                      step="1"
                      defaultValue={skuItem?.standardWeightGrams ?? ""}
                      disabled={Boolean(targetStatus)}
                    />
                    <small>留空表示待补充；缺失时包裹必须由高风险权限人工放行。</small>
                  </label>
                )}
                <label>
                  默认仓库
                  <select name="defaultWarehouseId" defaultValue={skuItem?.defaultWarehouse?.id ?? ""} disabled={Boolean(targetStatus) || skuWarehouses.status !== "ready"}>
                    <option value="">未选择</option>
                    {skuWarehouses.data?.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
                    {skuItem?.defaultWarehouse && !skuWarehouses.data?.some((warehouse) => warehouse.id === skuItem.defaultWarehouse?.id) && <option value={skuItem.defaultWarehouse.id} disabled>{skuItem.defaultWarehouse.displayName}（历史引用）</option>}
                  </select>
                </label>
                {skuWarehouses.status === "error" && <p role="alert">{skuWarehouses.message}</p>}
              </>
            )}
            {editor.kind === "listing" && (
              <>
                <p>
                  此操作只维护商品与店铺商品的对应关系；备注不会显示或回填。
                </p>
                {isListingCreate ? (
                  <>
                    <ListingShopPicker
                      state={listingShopOptions}
                      search={shopSearch}
                      selectedShopId={selectedShopId}
                      onSearchChange={setShopSearch}
                      onSelectedShopChange={setSelectedShopId}
                      onRefresh={() => void loadListingShopOptions()}
                    />
                    <label>
                      库存 SKU 标识
                      <input
                        name="skuId"
                        required
                        pattern={UUID_PATTERN.source}
                        list="product-sku-options"
                        title="请选择或输入有效的库存 SKU 标识。"
                        defaultValue={editor.skuId ?? ""}
                      />
                    </label>
                    <datalist id="product-sku-options">
                      {availableSkus.map((sku) => (
                        <option key={sku.id} value={sku.id}>
                          {sku.businessCode} — {sku.name}
                        </option>
                      ))}
                    </datalist>
                    <label>
                      店铺平台商品引用
                      <input name="externalListingRef" required maxLength={160} />
                    </label>
                    <label>
                      店铺平台变体引用
                      <input name="externalVariantRef" maxLength={160} />
                    </label>
                  </>
                ) : (
                  <div className="inline-alert" role="status">
                    <span>
                      编辑时只能修改匹配资料，店铺、平台、SKU、商品和变体不会改变。
                    </span>
                    <code>店铺：{listingItem?.shopId}</code>
                    <code>平台：{listingItem?.platformId}</code>
                    <code>SKU：{listingItem?.skuId}</code>
                    <code>商品：{listingItem?.externalListingRef}</code>
                    <code>变体：{listingItem?.externalVariantRef ?? "—"}</code>
                  </div>
                )}
                <label>
                  外部状态
                  <input
                    name="externalStatus"
                    maxLength={80}
                    defaultValue={listingItem?.externalStatus ?? ""}
                    disabled={Boolean(targetStatus)}
                  />
                </label>
              </>
            )}
            {targetStatus && (
              <p>
                将此{editor.kind.toUpperCase()}设为{statusLabel(targetStatus)}
                ，不会变更其他字段。
              </p>
            )}
            {conflictRecovered && <p role="status">已加载最新商品资料。</p>}
            {error && <p role="alert">{error}</p>}
            <DialogActions
              submitting={submitting}
              onClose={onClose}
              submitDisabled={
                isListingCreate &&
                (listingShopOptions.status !== "ready" ||
                  !selectedListingShop)
              }
              submitLabel={
                targetStatus ? `确认${statusLabel(targetStatus)}` : "保存"
              }
            />
          </form>
        )}
      </section>
    </div>
  );
}

function DialogActions({
  submitting,
  onClose,
  submitLabel,
  submitDisabled = false,
  danger = false,
}: {
  submitting: boolean;
  onClose: () => void;
  submitLabel: string;
  submitDisabled?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="form-actions">
      <button
        className="button button-secondary"
        type="button"
        onClick={onClose}
        disabled={submitting}
      >
        取消
      </button>
      <button
        className={`button ${danger ? "button-danger" : "button-primary"}`}
        type="submit"
        disabled={submitting || submitDisabled}
      >
        {submitting ? "正在保存" : submitLabel}
      </button>
    </div>
  );
}

export function Pagination({
  page,
  onPageChange,
  onPageSizeChange,
  label,
}: {
  page: Page<unknown>;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  label: string;
}) {
  const pageSizes = [...new Set([25, 50, 100, 200, page.size])]
    .sort((left, right) => left - right);
  return (
    <nav className="pagination" aria-label={label}>
      <span>
        共 {page.totalElements} 条，第 {page.page + 1} /{" "}
        {Math.max(page.totalPages, 1)} 页
      </span>
      <div className="pagination-settings">
        {onPageSizeChange && (
          <label>
            每页
            <select
              aria-label={`${label}每页条数`}
              value={page.size}
              onChange={(event) =>
                onPageSizeChange(Number(event.target.value))
              }
            >
              {pageSizes.map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </label>
        )}
        <button
          className="button button-secondary"
          type="button"
          disabled={page.page === 0}
          onClick={() => onPageChange(page.page - 1)}
        >
          上一页
        </button>
        <button
          className="button button-secondary"
          type="button"
          disabled={page.page + 1 >= page.totalPages}
          onClick={() => onPageChange(page.page + 1)}
        >
          下一页
        </button>
      </div>
    </nav>
  );
}
