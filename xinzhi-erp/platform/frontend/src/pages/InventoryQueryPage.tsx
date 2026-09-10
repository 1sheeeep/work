import { CircleDashed, Layers3, ShieldAlert } from "lucide-react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { DialogCloseButton } from "../components/DialogCloseButton";
import {
  type InventoryBalance,
  type InventoryBalanceListRequest,
  type InventoryBalanceSearchField,
  type Page,
  type ShopifyInventoryPreview,
  type ShopifyInventoryPublication,
  inventoryApi,
} from "../modules/inventoryApi";
import {
  type ProductCategory,
  productCenterApi,
} from "../modules/productCenterApi";
import {
  type TenantShop,
  shopDisplayName,
  shopCenterApi,
} from "../modules/shopCenterApi";
import {
  type Warehouse,
  warehouseCenterApi,
} from "../modules/warehouseCenterApi";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE = 9_999;
const EXPORT_PAGE_SIZE = 200;
const MAX_EXPORT_ROWS = 10_000;
const MAX_EXPORT_PAGES = MAX_EXPORT_ROWS / EXPORT_PAGE_SIZE;
const MAX_WAREHOUSE_ITEMS = 10_000;
const MAX_WAREHOUSE_PAGES = MAX_WAREHOUSE_ITEMS / 200;
const MAX_CATEGORY_ITEMS = 10_000;
const MAX_CATEGORY_PAGES = MAX_CATEGORY_ITEMS / 200;
const MAX_SHOP_ITEMS = 10_000;
const MAX_SHOP_PAGES = MAX_SHOP_ITEMS / 200;
export const INVENTORY_QUERY_AUTO_LOAD_STORAGE_KEY =
  "xz.erp.inventoryQuery.autoLoad.v1";
export const SHOPIFY_INVENTORY_PUBLICATION_STORAGE_PREFIX =
  "xz.erp.shopifyInventoryPublication.v1";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export type InventoryQuery = {
  warehouseId?: string;
  categoryId?: string;
  searchField: InventoryBalanceSearchField;
  keyword: string;
  onHandMin?: number;
  onHandMax?: number;
  updatedFrom?: string;
  updatedTo?: string;
  page: number;
  size: number;
};

const inventorySearchFields = [
  ["ALL", "全部字段"],
  ["MASTER_SKU", "按主 SKU 编号"],
  ["NAME_ZH", "按中文名"],
  ["NAME_EN", "按英文名"],
  ["INVENTORY_SKU", "按库存 SKU 编号"],
] as const satisfies ReadonlyArray<
  readonly [InventoryBalanceSearchField, string]
>;

function inventorySearchField(
  value: string | null,
): InventoryBalanceSearchField {
  return inventorySearchFields.find(([field]) => field === value)?.[0]
    ?? "ALL";
}

function signedInteger(value: string | null) {
  if (!value || !/^-?\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function inventoryDate(value: string | null) {
  if (!value) return undefined;
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || year > 9999) return undefined;
  const candidate = new Date(`${value}T00:00:00Z`);
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  )
    ? value
    : undefined;
}

type LoadState<T> =
  | { status: "loading"; data?: T }
  | { status: "ready"; data: T }
  | { status: "error"; message: string };

type BalanceLoadState =
  | LoadState<Page<InventoryBalance>>
  | { status: "idle" };

export function readInventoryQueryAutoLoad() {
  try {
    return window.localStorage.getItem(
      INVENTORY_QUERY_AUTO_LOAD_STORAGE_KEY,
    ) !== "false";
  } catch {
    return true;
  }
}

export function saveInventoryQueryAutoLoad(enabled: boolean) {
  try {
    window.localStorage.setItem(
      INVENTORY_QUERY_AUTO_LOAD_STORAGE_KEY,
      String(enabled),
    );
    return true;
  } catch {
    return false;
  }
}

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

export function parseInventoryQuery(search: string): InventoryQuery {
  const params = new URLSearchParams(search);
  const warehouseId = params.get("warehouseId");
  const categoryId = params.get("categoryId");
  const onHandMin = signedInteger(params.get("onHandMin"));
  const onHandMax = signedInteger(params.get("onHandMax"));
  const updatedFrom = inventoryDate(params.get("updatedFrom"));
  const updatedTo = inventoryDate(params.get("updatedTo"));
  const validOnHandRange =
    onHandMin === undefined ||
    onHandMax === undefined ||
    onHandMin <= onHandMax;
  const validUpdatedRange =
    updatedFrom === undefined ||
    updatedTo === undefined ||
    updatedFrom <= updatedTo;
  return {
    warehouseId:
      warehouseId && UUID_PATTERN.test(warehouseId)
        ? warehouseId
        : undefined,
    categoryId:
      categoryId && UUID_PATTERN.test(categoryId)
        ? categoryId
        : undefined,
    searchField: inventorySearchField(params.get("searchField")),
    keyword: (params.get("keyword") ?? "").trim().slice(0, 100),
    onHandMin: validOnHandRange ? onHandMin : undefined,
    onHandMax: validOnHandRange ? onHandMax : undefined,
    updatedFrom: validUpdatedRange ? updatedFrom : undefined,
    updatedTo: validUpdatedRange ? updatedTo : undefined,
    page: bounded(params.get("page"), 0, 0, MAX_PAGE),
    size: bounded(params.get("size"), DEFAULT_PAGE_SIZE, 1, 200),
  };
}

export function toInventoryQueryUrl(query: InventoryQuery) {
  const params = new URLSearchParams({
    searchField: query.searchField,
    page: String(query.page),
    size: String(query.size),
  });
  if (query.warehouseId && UUID_PATTERN.test(query.warehouseId)) {
    params.set("warehouseId", query.warehouseId);
  }
  if (query.categoryId && UUID_PATTERN.test(query.categoryId)) {
    params.set("categoryId", query.categoryId);
  }
  if (query.keyword) params.set("keyword", query.keyword.slice(0, 100));
  const validOnHandRange =
    (query.onHandMin === undefined || Number.isSafeInteger(query.onHandMin)) &&
    (query.onHandMax === undefined || Number.isSafeInteger(query.onHandMax)) &&
    (
      query.onHandMin === undefined ||
      query.onHandMax === undefined ||
      query.onHandMin <= query.onHandMax
    );
  if (validOnHandRange) {
    if (query.onHandMin !== undefined) {
      params.set("onHandMin", String(query.onHandMin));
    }
    if (query.onHandMax !== undefined) {
      params.set("onHandMax", String(query.onHandMax));
    }
  }
  const validUpdatedRange =
    (query.updatedFrom === undefined ||
      inventoryDate(query.updatedFrom) !== undefined) &&
    (query.updatedTo === undefined ||
      inventoryDate(query.updatedTo) !== undefined) &&
    (
      query.updatedFrom === undefined ||
      query.updatedTo === undefined ||
      query.updatedFrom <= query.updatedTo
    );
  if (validUpdatedRange) {
    if (query.updatedFrom) params.set("updatedFrom", query.updatedFrom);
    if (query.updatedTo) params.set("updatedTo", query.updatedTo);
  }
  return `/products/inventory-query?${params.toString()}`;
}

export function safeInventoryMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 403) {
    return "当前账号没有读取库存余额所需权限。登录状态仍保持不变。";
  }
  if (error instanceof ApiError && error.status === 404) {
    return "筛选的仓库不存在，或当前账号无法访问。";
  }
  return "暂时无法读取库存余额，请稍后重试。";
}

function csvCell(value: string | number) {
  if (typeof value === "number") return String(value);
  const text = String(value);
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

const inventoryBalanceCsvColumns = [
  "库存SKU编号",
  "商品名称",
  "仓库编号",
  "仓库名称",
  "现货库存",
  "已预留",
  "可用库存",
  "更新时间",
] as const;

export function inventoryBalanceCsv(items: InventoryBalance[]) {
  return `\uFEFF${[
    inventoryBalanceCsvColumns.join(","),
    ...items.map((balance) => [
      balance.skuBusinessCode,
      balance.skuName,
      balance.warehouseBusinessCode,
      balance.warehouseName,
      balance.onHand,
      balance.reserved,
      balance.available,
      balance.updatedAt,
    ].map(csvCell).join(",")),
  ].join("\n")}\n`;
}

export async function loadInventoryBalanceExportRows(
  request: Omit<InventoryBalanceListRequest, "page" | "size">,
) {
  const first = await inventoryApi.listBalances({
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
    const next = await inventoryApi.listBalances({
      ...request,
      page,
      size: EXPORT_PAGE_SIZE,
    });
    if (
      next.page !== page ||
      next.totalElements !== first.totalElements ||
      next.totalPages !== first.totalPages
    ) {
      throw new Error("导出期间库存余额发生变化，请刷新后重试。");
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
    throw new Error("导出期间库存余额发生变化，请刷新后重试。");
  }
  return rows;
}

function InventoryDateTime({ value }: { value: string }) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "—";
  return (
    <time dateTime={value}>
      {new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(date)}
    </time>
  );
}

async function loadInventoryCategories() {
  const first = await productCenterApi.listCategories({
    page: 0,
    size: 200,
  });
  if (
    first.totalElements > MAX_CATEGORY_ITEMS ||
    first.totalPages > MAX_CATEGORY_PAGES
  ) {
    throw new Error("商品目录超过 10,000 项，无法安全加载筛选选项。");
  }
  const items = [...first.items];
  for (let page = 1; page < first.totalPages; page += 1) {
    items.push(...(await productCenterApi.listCategories({
      page,
      size: 200,
    })).items);
    if (items.length > MAX_CATEGORY_ITEMS) {
      throw new Error("商品目录超过 10,000 项，无法安全加载筛选选项。");
    }
  }
  if (new Set(items.map((category) => category.id)).size !== items.length) {
    throw new Error("商品目录返回了重复记录。");
  }
  return items;
}

async function loadInventoryWarehouses() {
  const first = await warehouseCenterApi.listWarehouses({
    page: 0,
    size: 200,
  });
  if (
    first.totalElements > MAX_WAREHOUSE_ITEMS ||
    first.totalPages > MAX_WAREHOUSE_PAGES
  ) {
    throw new Error(
      "仓库目录超过 10,000 项，无法安全加载筛选选项。",
    );
  }
  const items = [...first.items];
  for (let page = 1; page < first.totalPages; page += 1) {
    items.push(...(await warehouseCenterApi.listWarehouses({
      page,
      size: 200,
    })).items);
    if (items.length > MAX_WAREHOUSE_ITEMS) {
      throw new Error(
        "仓库目录超过 10,000 项，无法安全加载筛选选项。",
      );
    }
  }
  if (new Set(items.map((warehouse) => warehouse.id)).size !== items.length) {
    throw new Error("仓库目录返回了重复记录。");
  }
  return items;
}

async function loadAuthorizedInventoryShops() {
  const first = await shopCenterApi.listShops({
    includeArchived: false,
    status: "ACTIVE",
    authorizationStatus: "AUTHORIZED",
    page: 0,
    size: 200,
  });
  if (
    first.totalElements > MAX_SHOP_ITEMS ||
    first.totalPages > MAX_SHOP_PAGES
  ) {
    throw new Error("已授权店铺超过 10,000 个，无法安全加载。");
  }
  const items = [...first.items];
  for (let page = 1; page < first.totalPages; page += 1) {
    const next = await shopCenterApi.listShops({
      includeArchived: false,
      status: "ACTIVE",
      authorizationStatus: "AUTHORIZED",
      page,
      size: 200,
    });
    if (
      next.page !== page ||
      next.totalElements !== first.totalElements ||
      next.totalPages !== first.totalPages
    ) {
      throw new Error("加载期间店铺目录发生变化。");
    }
    items.push(...next.items);
  }
  if (
    items.length !== first.totalElements ||
    new Set(items.map((shop) => shop.id)).size !== items.length
  ) {
    throw new Error("店铺目录返回不完整。");
  }
  return items;
}

function safeShopifyInventoryRequestMessage(
  error: unknown,
  operation: "preview" | "publish" | "status",
) {
  const details =
    error instanceof ApiError &&
    error.details &&
    typeof error.details === "object" &&
    !Array.isArray(error.details)
      ? error.details as Record<string, unknown>
      : {};
  if (
    error instanceof ApiError &&
    error.status === 409 &&
    (error.code === "shopify_authorization_conflict" ||
      details.reason === "shopify_scope_missing")
  ) {
    const permission = details.scope === "read_locations"
      ? "地点读取权限"
      : "库存更新权限";
    return `Shopify 店铺授权未连接或${permission}不可用，无法${
      operation === "publish" ? "发布库存" : "完成库存预检"
    }。请在店铺详情重新授权后再试。`;
  }
  if (
    error instanceof ApiError &&
    error.status === 409 &&
    details.reason === "shopify_connection_not_connected"
  ) {
    return "Shopify 店铺授权未连接，无法处理库存。请先在店铺详情重新连接。";
  }
  if (error instanceof ApiError && error.status === 403) {
    return operation === "preview"
      ? "当前账号没有读取 Shopify 库存预检所需权限。"
      : "当前账号没有发布 Shopify 库存所需权限。";
  }
  if (error instanceof ApiError && error.status === 404) {
    return operation === "status"
      ? "该库存发布任务不存在或已不可访问，请重新预检。"
      : "库存余额或店铺已不存在，请刷新页面后重试。";
  }
  if (error instanceof ApiError && error.status === 409) {
    return operation === "preview"
      ? "预检未通过。请检查商品库存映射、仓库库位映射及店铺授权状态。"
      : "库存状态或 Shopify 授权已变化，请重新预检后再发布。";
  }
  if (error instanceof ApiError && error.status === 0) {
    return "网络暂时不可用，请检查连接后重试。";
  }
  return operation === "status"
    ? "暂时无法查询发布状态，请稍后继续查询。"
    : operation === "preview"
      ? "暂时无法完成 Shopify 库存预检，请稍后重试。"
      : "暂时无法提交 Shopify 库存发布，请稍后重试。";
}

function inventoryPublicationMessage(publication: ShopifyInventoryPublication) {
  if (publication.status === "QUEUED") {
    return "发布任务已排队，系统将按预检快照安全处理。";
  }
  if (publication.status === "PROCESSING") {
    return "正在向 Shopify 发布库存，请勿重复提交。";
  }
  if (publication.status === "APPLIED") {
    return "Shopify 可用库存已更新。";
  }
  if (publication.status === "UNCERTAIN") {
    return "结果仍在确认中，系统会继续核对；请勿重复提交。";
  }
  if (publication.status === "STALE") {
    return publication.safeErrorCode === "ERP_INVENTORY_STATE_CHANGED"
      ? "ERP 库存已变化，本次未发布。请重新预检。"
      : "Shopify 库存已变化，本次未覆盖。请重新预检。";
  }
  if (publication.safeErrorCode === "SHOPIFY_IDEMPOTENCY_CONFLICT") {
    return "发布请求与既有幂等任务冲突，请重新预检。";
  }
  if (publication.safeErrorCode === "SHOPIFY_IDEMPOTENCY_FAILED") {
    return "Shopify 未接受既有发布任务，请重新预检后再试。";
  }
  return "Shopify 拒绝了库存更新，本次未修改库存。请重新预检后再试。";
}

function publicationTone(publication: ShopifyInventoryPublication) {
  if (publication.status === "STALE" || publication.status === "REJECTED") {
    return "alert";
  }
  return "status";
}

function createInventoryPublicationKeys() {
  const value = globalThis.crypto.randomUUID();
  return {
    idempotencyKey: `inventory:${value}`,
    requestId: `inventory-ui.${value}`,
  };
}

export function shopifyInventoryPublicationStorageKey(
  shopId: string,
  balanceId: string,
) {
  return `${SHOPIFY_INVENTORY_PUBLICATION_STORAGE_PREFIX}:${shopId}:${balanceId}`;
}

function readStoredInventoryPublication(
  shopId: string,
  balanceId: string,
) {
  const key = shopifyInventoryPublicationStorageKey(shopId, balanceId);
  try {
    const value = window.sessionStorage.getItem(key) ?? "";
    if (UUID_PATTERN.test(value)) return value;
    if (value) window.sessionStorage.removeItem(key);
  } catch {
    // Session persistence is an aid; backend idempotency and CAS remain authoritative.
  }
  return undefined;
}

function storeInventoryPublication(
  shopId: string,
  balanceId: string,
  publicationId?: string,
) {
  const key = shopifyInventoryPublicationStorageKey(shopId, balanceId);
  try {
    if (publicationId && UUID_PATTERN.test(publicationId)) {
      window.sessionStorage.setItem(key, publicationId);
    } else {
      window.sessionStorage.removeItem(key);
    }
  } catch {
    // The publication remains protected by server-side idempotency and CAS.
  }
}

function ShopifyInventoryDialog({
  balance,
  canPublish,
  onClose,
}: {
  balance: InventoryBalance;
  canPublish: boolean;
  onClose: () => void;
}) {
  const [shops, setShops] = useState<LoadState<TenantShop[]>>({
    status: "loading",
  });
  const [shopId, setShopId] = useState("");
  const [preview, setPreview] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "ready"; data: ShopifyInventoryPreview }
    | { status: "error"; message: string }
  >({ status: "idle" });
  const [publication, setPublication] =
    useState<ShopifyInventoryPublication>();
  const [publicationError, setPublicationError] = useState<string>();
  const [resumeState, setResumeState] = useState<
    "idle" | "checking" | "ready" | "error"
  >("idle");
  const [resumeError, setResumeError] = useState<string>();
  const [resumeRetryKey, setResumeRetryKey] = useState(0);
  const [resumedPublication, setResumedPublication] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [polling, setPolling] = useState(false);
  const publicationKeys = useRef<
    ReturnType<typeof createInventoryPublicationKeys> | undefined
  >(undefined);

  useEffect(() => {
    let active = true;
    void loadAuthorizedInventoryShops().then(
      (data) => {
        if (!active) return;
        setShops({ status: "ready", data });
        if (data.length === 1) setShopId(data[0].id);
      },
      () => {
        if (active) {
          setShops({
            status: "error",
            message: "暂时无法读取已授权店铺，请稍后重试。",
          });
        }
      },
    );
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setPublication(undefined);
    setPublicationError(undefined);
    setResumeError(undefined);
    setResumedPublication(false);
    if (!shopId) {
      setResumeState("idle");
      return () => {
        active = false;
      };
    }
    if (!canPublish) {
      setResumeState("ready");
      return () => {
        active = false;
      };
    }
    const publicationId = readStoredInventoryPublication(shopId, balance.id);
    setResumeState("checking");
    const lookup = publicationId
      ? inventoryApi.getShopifyInventoryPublication(publicationId).catch(
          (error) => {
            if (error instanceof ApiError && error.status === 404) {
              storeInventoryPublication(shopId, balance.id);
              return inventoryApi.getLatestShopifyInventoryPublication(
                shopId,
                balance.id,
              );
            }
            throw error;
          },
        )
      : inventoryApi.getLatestShopifyInventoryPublication(shopId, balance.id);
    void lookup.then(
      (next) => {
        if (!active) return;
        if (next.shopId !== shopId || next.balanceId !== balance.id) {
          storeInventoryPublication(shopId, balance.id);
          setResumeState("ready");
          return;
        }
        setPublication(next);
        setResumedPublication(true);
        if (["QUEUED", "PROCESSING", "UNCERTAIN"].includes(next.status)) {
          storeInventoryPublication(next.shopId, next.balanceId, next.id);
        } else {
          storeInventoryPublication(shopId, balance.id);
        }
        setResumeState("ready");
      },
      (error) => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 404) {
          storeInventoryPublication(shopId, balance.id);
          setResumeState("ready");
          return;
        }
        setResumeState("error");
        setResumeError(
          "无法确认上次库存发布任务的状态。为避免重复提交，请恢复连接后重新查询。",
        );
      },
    );
    return () => {
      active = false;
    };
  }, [balance.id, canPublish, resumeRetryKey, shopId]);

  const pollPublication = useCallback(async () => {
    if (!publication || polling) return;
    setPolling(true);
    setPublicationError(undefined);
    try {
      const next = await inventoryApi.getShopifyInventoryPublication(
        publication.id,
      );
      if (
        next.shopId !== publication.shopId ||
        next.balanceId !== publication.balanceId ||
        next.expectedBalanceVersion !== publication.expectedBalanceVersion ||
        next.expectedShopifyAvailable !== publication.expectedShopifyAvailable ||
        next.targetAvailable !== publication.targetAvailable
      ) {
        throw new Error("Publication identity changed");
      }
      if (["QUEUED", "PROCESSING", "UNCERTAIN"].includes(next.status)) {
        storeInventoryPublication(next.shopId, next.balanceId, next.id);
      } else {
        storeInventoryPublication(next.shopId, next.balanceId);
      }
      setPublication(next);
    } catch (error) {
      setPublicationError(
        safeShopifyInventoryRequestMessage(error, "status"),
      );
    } finally {
      setPolling(false);
    }
  }, [polling, publication]);

  useEffect(() => {
    if (
      !publication ||
      publicationError ||
      !["QUEUED", "PROCESSING", "UNCERTAIN"].includes(publication.status)
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      void pollPublication();
    }, 2_000);
    return () => window.clearTimeout(timer);
  }, [pollPublication, publication, publicationError]);

  const runPreview = async () => {
    if (
      !shopId ||
      preview.status === "loading" ||
      resumeState !== "ready"
    ) return;
    setPreview({ status: "loading" });
    setPublication(undefined);
    setPublicationError(undefined);
    setResumedPublication(false);
    publicationKeys.current = undefined;
    try {
      const data = await inventoryApi.previewShopifyInventory(
        shopId,
        balance.id,
      );
      if (
        data.skuId !== balance.skuId ||
        data.warehouseId !== balance.warehouseId
      ) {
        throw new Error("Preview identity changed");
      }
      setPreview({ status: "ready", data });
      publicationKeys.current = createInventoryPublicationKeys();
    } catch (error) {
      setPreview({
        status: "error",
        message: safeShopifyInventoryRequestMessage(error, "preview"),
      });
    }
  };

  const publish = async () => {
    if (
      preview.status !== "ready" ||
      publishing ||
      publication ||
      resumeState !== "ready" ||
      !publicationKeys.current
    ) {
      return;
    }
    const data = preview.data;
    if (!window.confirm(
      `确认将 ERP 可用库存 ${data.erpAvailable} 发布到 Shopify？当前 Shopify 可用库存为 ${data.shopifyAvailable}。`,
    )) {
      return;
    }
    setPublishing(true);
    setPublicationError(undefined);
    try {
      const next = await inventoryApi.enqueueShopifyInventoryPublication({
        shopId: data.shopId,
        balanceId: data.balanceId,
        expectedBalanceVersion: data.balanceVersion,
        expectedShopifyAvailable: data.shopifyAvailable,
      }, publicationKeys.current.idempotencyKey, publicationKeys.current.requestId);
      if (next.targetAvailable !== data.erpAvailable) {
        throw new Error("Publication target changed");
      }
      if (["QUEUED", "PROCESSING", "UNCERTAIN"].includes(next.status)) {
        storeInventoryPublication(next.shopId, next.balanceId, next.id);
      } else {
        storeInventoryPublication(next.shopId, next.balanceId);
      }
      setResumedPublication(false);
      setPublication(next);
    } catch (error) {
      setPublicationError(
        safeShopifyInventoryRequestMessage(error, "publish"),
      );
    } finally {
      setPublishing(false);
    }
  };

  const previewReady = preview.status === "ready";
  const targetInRange = previewReady &&
    preview.data.erpAvailable >= -1_000_000_000 &&
    preview.data.erpAvailable <= 1_000_000_000;
  const hasDifference = previewReady && preview.data.availableDifference !== 0;
  const publicationActive = Boolean(publication &&
    ["QUEUED", "PROCESSING", "UNCERTAIN"].includes(publication.status));
  const selectedShop = shops.status === "ready"
    ? shops.data.find((shop) => shop.id === shopId)
    : undefined;

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="write-dialog shopify-inventory-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shopify-inventory-dialog-title"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !publishing) {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <header className="table-heading">
          <div>
            <h2 id="shopify-inventory-dialog-title">Shopify 库存发布</h2>
            <span>{balance.skuBusinessCode} · {balance.warehouseName}</span>
          </div>
          <DialogCloseButton disabled={publishing} onClick={onClose} />
        </header>

        <div className="shopify-inventory-dialog-body">
          <label className="shopify-inventory-shop-field">
            Shopify 店铺
            <select
              autoFocus
              value={shopId}
              disabled={shops.status !== "ready" || publicationActive}
              onChange={(event) => {
                setShopId(event.currentTarget.value);
                setPreview({ status: "idle" });
                setPublication(undefined);
                setPublicationError(undefined);
                setResumeError(undefined);
                setResumedPublication(false);
                publicationKeys.current = undefined;
              }}
            >
              <option value="">
                {shops.status === "loading"
                  ? "正在加载已授权店铺…"
                  : "请选择已授权店铺"}
              </option>
              {shops.status === "ready" && shops.data.map((shop) => (
                <option key={shop.id} value={shop.id}>
                  {shopDisplayName(shop)} · {shop.externalShopRef}
                </option>
              ))}
            </select>
          </label>
          {shops.status === "ready" && shops.data.length === 0 && (
            <div className="inline-alert" role="status">
              当前没有可用的已授权店铺，请先在店铺管理完成 Shopify 授权。
            </div>
          )}
          {shops.status === "error" && (
            <div className="inline-alert" role="alert">
              {shops.message}
            </div>
          )}
          {selectedShop && (
            <p className="form-help">
              将使用 {shopDisplayName(selectedShop)} 的现有 Shopify 授权执行预检。
            </p>
          )}

          {resumeState === "checking" && (
            <div className="product-state" role="status" aria-live="polite">
              <CircleDashed className="spin" size={20} aria-hidden="true" />
              正在查询上次库存发布任务
            </div>
          )}
          {resumeState === "error" && resumeError && (
            <div className="inline-alert" role="alert">
              <ShieldAlert size={19} aria-hidden="true" />
              <span>{resumeError}</span>
              <button
                className="button button-secondary"
                type="button"
                onClick={() => setResumeRetryKey((value) => value + 1)}
              >
                重新查询现有任务
              </button>
            </div>
          )}

          {preview.status === "loading" && (
            <div className="product-state" role="status" aria-live="polite">
              <CircleDashed className="spin" size={20} aria-hidden="true" />
              正在读取 Shopify 库存并核对映射
            </div>
          )}
          {preview.status === "error" && (
            <div className="inline-alert" role="alert">
              <ShieldAlert size={19} aria-hidden="true" />
              <span>{preview.message}</span>
            </div>
          )}
          {previewReady && (
            <section
              className="shopify-inventory-preview"
              aria-labelledby="shopify-inventory-preview-title"
            >
              <h3 id="shopify-inventory-preview-title">发布预检</h3>
              <dl className="shopify-inventory-comparison">
                <div>
                  <dt>ERP 可用库存</dt>
                  <dd>{preview.data.erpAvailable}</dd>
                </div>
                <div>
                  <dt>Shopify 可用库存</dt>
                  <dd>{preview.data.shopifyAvailable}</dd>
                </div>
                <div>
                  <dt>待调整</dt>
                  <dd>{preview.data.availableDifference > 0 ? "+" : ""}{preview.data.availableDifference}</dd>
                </div>
              </dl>
              <div className="shopify-inventory-mapping-summary">
                <span>库存项 <code>{preview.data.externalInventoryItemRef}</code></span>
                <span>库位 <code>{preview.data.externalLocationRef}</code></span>
                <span>预检时间 <InventoryDateTime value={preview.data.fetchedAt} /></span>
              </div>
              {!targetInRange && (
                <div className="inline-alert" role="alert">
                  ERP 可用库存超出当前 Shopify 发布安全范围，不能提交。
                </div>
              )}
              {!hasDifference && (
                <div className="product-state" role="status">
                  ERP 与 Shopify 可用库存一致，无需发布。
                </div>
              )}
            </section>
          )}

          {publication && (
            <div
              className={`shopify-inventory-publication is-${publication.status.toLowerCase()}`}
              role={publicationTone(publication)}
              aria-live="polite"
            >
              <strong>{publication.status}</strong>
              <span>{inventoryPublicationMessage(publication)}</span>
              <small>
                任务 {publication.id} · 尝试 {publication.attemptCount} 次
                {publication.replayed ? " · 已复用原任务" : ""}
                {resumedPublication ? " · 已恢复已有任务" : ""}
              </small>
            </div>
          )}
          {publicationError && (
            <div className="inline-alert" role="alert">
              <ShieldAlert size={19} aria-hidden="true" />
              <span>{publicationError}</span>
              {publication && (
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={polling}
                  onClick={() => void pollPublication()}
                >
                  {polling ? "正在查询…" : "继续查询状态"}
                </button>
              )}
            </div>
          )}
        </div>

        <footer className="form-actions">
          <button className="text-button" type="button" onClick={onClose}>
            取消
          </button>
          <button
            className="button button-secondary"
            type="button"
            disabled={
              !shopId ||
              preview.status === "loading" ||
              publishing ||
              publicationActive ||
              resumeState !== "ready"
            }
            aria-busy={preview.status === "loading"}
            onClick={() => void runPreview()}
          >
            {preview.status === "loading"
              ? "正在预检…"
              : resumeState === "checking"
                ? "正在恢复任务…"
                : resumeState === "error"
                  ? "先确认现有任务"
              : publicationActive
                ? "等待发布完成"
                : publication
                  ? "重新预检"
                  : "读取并预检"}
          </button>
          {canPublish && (
            <button
              className="button button-primary"
              type="button"
              disabled={
                !previewReady ||
                !targetInRange ||
                !hasDifference ||
                publishing ||
                Boolean(publication)
              }
              aria-busy={publishing}
              onClick={() => void publish()}
            >
              {publishing ? "正在提交…" : "发布到 Shopify"}
            </button>
          )}
        </footer>
        {!canPublish && (
          <p className="form-help shopify-inventory-readonly-note">
            当前账号仅可执行预检，没有 Shopify 库存发布权限。
          </p>
        )}
      </section>
    </div>
  );
}

export function InventoryQueryPage() {
  const { hasPermission } = useAuth();
  const router = useRouter();
  const search = useRouterState({
    select: (state) => state.location.searchStr,
  });
  const query = useMemo(() => parseInventoryQuery(search), [search]);
  const [autoLoad, setAutoLoad] = useState(readInventoryQueryAutoLoad);
  const [queryEnabled, setQueryEnabled] = useState(autoLoad);
  const [balances, setBalances] = useState<BalanceLoadState>(
    autoLoad ? { status: "loading" } : { status: "idle" },
  );
  const [warehouses, setWarehouses] = useState<
    LoadState<Warehouse[]> | { status: "not-permitted" }
  >({ status: "not-permitted" });
  const [categories, setCategories] = useState<
    LoadState<ProductCategory[]> | { status: "not-permitted" }
  >({ status: "not-permitted" });
  const [refreshKey, setRefreshKey] = useState(0);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draftAutoLoad, setDraftAutoLoad] = useState(autoLoad);
  const [settingsError, setSettingsError] = useState<string>();
  const [rangeError, setRangeError] = useState<string>();
  const [dateError, setDateError] = useState<string>();
  const [selectedShopifyBalance, setSelectedShopifyBalance] =
    useState<InventoryBalance>();
  const balanceVersion = useRef(0);
  const warehouseVersion = useRef(0);
  const categoryVersion = useRef(0);
  const exportBusyRef = useRef(false);
  const canReadWarehouses = hasPermission("warehouses.read");
  const canReadCategories = hasPermission("products.master_data.read");
  const canReadShopifyInventory = hasPermission("shop:read");
  const canPublishShopifyInventory = hasPermission(
    "inventory.shopify.publish",
  );
  const updateQuery = useCallback(
    (patch: Partial<InventoryQuery>) => {
      router.history.push(toInventoryQueryUrl({ ...query, ...patch }));
    },
    [query, router.history],
  );

  useEffect(() => {
    if (!queryEnabled) return;
    const version = ++balanceVersion.current;
    setBalances((previous) => ({
      status: "loading",
      data: "data" in previous ? previous.data : undefined,
    }));
    void inventoryApi.listBalances({
      warehouseId: query.warehouseId,
      categoryId: query.categoryId,
      searchField: query.searchField,
      keyword: query.keyword || undefined,
      onHandMin: query.onHandMin,
      onHandMax: query.onHandMax,
      updatedFrom: query.updatedFrom,
      updatedTo: query.updatedTo,
      page: query.page,
      size: query.size,
    }).then(
      (data) => {
        if (version === balanceVersion.current) {
          setBalances({ status: "ready", data });
        }
      },
      (error) => {
        if (version === balanceVersion.current) {
          setBalances({
            status: "error",
            message: safeInventoryMessage(error),
          });
        }
      },
    );
  }, [
    query.categoryId,
    query.keyword,
    query.onHandMax,
    query.onHandMin,
    query.page,
    query.searchField,
    query.size,
    query.updatedFrom,
    query.updatedTo,
    query.warehouseId,
    queryEnabled,
    refreshKey,
  ]);

  useEffect(() => {
    const version = ++warehouseVersion.current;
    if (!canReadWarehouses) {
      setWarehouses({ status: "not-permitted" });
      return;
    }
    setWarehouses({ status: "loading" });
    void loadInventoryWarehouses().then(
      (data) => {
        if (version === warehouseVersion.current) {
          setWarehouses({ status: "ready", data });
        }
      },
      () => {
        if (version === warehouseVersion.current) {
          setWarehouses({
            status: "error",
            message: "仓库目录暂时无法读取；仍可按 SKU 搜索库存。",
          });
        }
      },
    );
  }, [canReadWarehouses, refreshKey]);

  useEffect(() => {
    const version = ++categoryVersion.current;
    if (!canReadCategories) {
      setCategories({ status: "not-permitted" });
      return;
    }
    setCategories({ status: "loading" });
    void loadInventoryCategories().then(
      (data) => {
        if (version === categoryVersion.current) {
          setCategories({ status: "ready", data });
        }
      },
      () => {
        if (version === categoryVersion.current) {
          setCategories({
            status: "error",
            message:
              "商品目录暂时无法读取；仍可按其他条件搜索库存。",
          });
        }
      },
    );
  }, [canReadCategories, refreshKey]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const submittedWarehouseId = String(values.get("warehouseId") ?? "");
    const submittedCategoryId = String(values.get("categoryId") ?? "");
    const rawOnHandMin = String(values.get("onHandMin") ?? "").trim();
    const rawOnHandMax = String(values.get("onHandMax") ?? "").trim();
    const rawUpdatedFrom = String(values.get("updatedFrom") ?? "").trim();
    const rawUpdatedTo = String(values.get("updatedTo") ?? "").trim();
    const onHandMin = signedInteger(rawOnHandMin);
    const onHandMax = signedInteger(rawOnHandMax);
    const updatedFrom = inventoryDate(rawUpdatedFrom);
    const updatedTo = inventoryDate(rawUpdatedTo);
    setRangeError(undefined);
    setDateError(undefined);
    if (
      (rawOnHandMin && onHandMin === undefined) ||
      (rawOnHandMax && onHandMax === undefined)
    ) {
      setRangeError("现货库存范围必须使用安全整数。");
      return;
    }
    if (
      onHandMin !== undefined &&
      onHandMax !== undefined &&
      onHandMin > onHandMax
    ) {
      setRangeError("现货库存最小值不能大于最大值。");
      return;
    }
    if (
      (rawUpdatedFrom && updatedFrom === undefined) ||
      (rawUpdatedTo && updatedTo === undefined)
    ) {
      setDateError("余额更新时间范围必须使用有效日期。");
      return;
    }
    if (updatedFrom && updatedTo && updatedFrom > updatedTo) {
      setDateError("余额更新时间起始日期不能晚于截止日期。");
      return;
    }
    const safeWarehouseId = warehouses.status === "ready"
      ? warehouses.data.some(
          (warehouse) => warehouse.id === submittedWarehouseId,
        )
        ? submittedWarehouseId
        : undefined
      : query.warehouseId;
    const safeCategoryId = categories.status === "ready"
      ? categories.data.some(
          (category) => category.id === submittedCategoryId,
        )
        ? submittedCategoryId
        : undefined
      : query.categoryId;
    updateQuery({
      warehouseId: safeWarehouseId,
      categoryId: safeCategoryId,
      searchField: inventorySearchField(
        String(values.get("searchField") ?? ""),
      ),
      keyword: String(values.get("keyword") ?? "").trim().slice(0, 100),
      onHandMin,
      onHandMax,
      updatedFrom,
      updatedTo,
      page: 0,
    });
    setQueryEnabled(true);
  };

  const openSettings = () => {
    setDraftAutoLoad(autoLoad);
    setSettingsError(undefined);
    setSettingsOpen(true);
  };

  const saveSettings = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!saveInventoryQueryAutoLoad(draftAutoLoad)) {
      setSettingsError(
        "浏览器无法保存页面设置；当前页面仍可正常查询库存。",
      );
      return;
    }
    setAutoLoad(draftAutoLoad);
    setSettingsOpen(false);
  };

  const exportBalances = useCallback(async () => {
    if (exportBusyRef.current) return;
    exportBusyRef.current = true;
    setExportBusy(true);
    setExportError(undefined);
    try {
      const rows = await loadInventoryBalanceExportRows({
        warehouseId: query.warehouseId,
        categoryId: query.categoryId,
        searchField: query.searchField,
        keyword: query.keyword || undefined,
        onHandMin: query.onHandMin,
        onHandMax: query.onHandMax,
        updatedFrom: query.updatedFrom,
        updatedTo: query.updatedTo,
      });
      const url = URL.createObjectURL(new Blob(
        [inventoryBalanceCsv(rows)],
        { type: "text/csv;charset=utf-8" },
      ));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "库存查询结果.csv";
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      setExportError(
        error instanceof Error && !(error instanceof ApiError)
          ? error.message
          : safeInventoryMessage(error),
      );
    } finally {
      exportBusyRef.current = false;
      setExportBusy(false);
    }
  }, [
    query.categoryId,
    query.keyword,
    query.onHandMax,
    query.onHandMin,
    query.searchField,
    query.updatedFrom,
    query.updatedTo,
    query.warehouseId,
  ]);

  return (
    <section
      className="product-center-page"
      aria-labelledby="inventory-query-title"
    >
      <header className="product-workbench-heading">
        <h1 id="inventory-query-title">库存查询</h1>
      </header>
      <section
        className="detail-card product-section erp-data-workbench"
        aria-labelledby="inventory-balance-title"
      >
        <h2 className="sr-only" id="inventory-balance-title">
          库存余额
        </h2>
        <form
          className="product-filters erp-filter-panel erp-compact-filter-panel"
          aria-label="库存筛选"
          key={`${query.warehouseId ?? ""}:${query.categoryId ?? ""}:${query.searchField}:${query.keyword}:${query.onHandMin ?? ""}:${query.onHandMax ?? ""}:${query.updatedFrom ?? ""}:${query.updatedTo ?? ""}`}
          onSubmit={submit}
        >
          <div className="erp-filter-row erp-filter-search-row">
            <span className="erp-filter-label">搜索内容：</span>
            <fieldset
              className="erp-filter-options"
              aria-label="库存查询搜索字段"
            >
              {inventorySearchFields.map(([value, label]) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="searchField"
                    value={value}
                    defaultChecked={query.searchField === value}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
            <input
              aria-label="库存查询关键词"
              name="keyword"
              defaultValue={query.keyword}
              maxLength={100}
              placeholder="输入搜索内容"
            />
            <button className="button button-primary" type="submit">
              搜索
            </button>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => {
                setRangeError(undefined);
                setDateError(undefined);
                updateQuery({
                  warehouseId: undefined,
                  categoryId: undefined,
                  searchField: "INVENTORY_SKU",
                  keyword: "",
                  onHandMin: undefined,
                  onHandMax: undefined,
                  updatedFrom: undefined,
                  updatedTo: undefined,
                  page: 0,
                });
                setQueryEnabled(true);
              }}
            >
              重置
            </button>
          </div>
          <div className="inventory-query-inline-filters">
            <div className="inventory-query-filter-grid">
              <label className="erp-filter-row">
            <span className="erp-filter-label">仓库：</span>
            <select
              key={`warehouse-${warehouses.status}`}
              name="warehouseId"
              defaultValue={query.warehouseId ?? ""}
              disabled={warehouses.status !== "ready"}
            >
              <option
                value={
                  warehouses.status === "ready"
                    ? ""
                    : query.warehouseId ?? ""
                }
              >
                {warehouses.status === "loading"
                  ? "正在加载仓库…"
                  : warehouses.status === "not-permitted"
                    ? "没有仓库读取权限"
                    : warehouses.status === "error"
                      ? "仓库目录暂时不可用"
                      : "全部可访问仓库"}
              </option>
              {warehouses.status === "ready" &&
                query.warehouseId &&
                !warehouses.data.some(
                  (warehouse) => warehouse.id === query.warehouseId,
                ) && (
                  <option value={query.warehouseId}>
                    当前仓库不可用
                  </option>
                )}
              {warehouses.status === "ready" &&
                warehouses.data.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.businessCode} · {warehouse.name}
                  </option>
                ))}
            </select>
              </label>
              <label className="erp-filter-row">
            <span className="erp-filter-label">商品目录：</span>
            <select
              key={`category-${categories.status}`}
              name="categoryId"
              defaultValue={query.categoryId ?? ""}
              disabled={categories.status !== "ready"}
            >
              <option
                value={
                  categories.status === "ready"
                    ? ""
                    : query.categoryId ?? ""
                }
              >
                {categories.status === "loading"
                  ? "正在加载商品目录…"
                  : categories.status === "not-permitted"
                    ? "没有商品目录读取权限"
                    : categories.status === "error"
                      ? "商品目录暂时不可用"
                      : "全部商品目录"}
              </option>
              {categories.status === "ready" &&
                query.categoryId &&
                !categories.data.some(
                  (category) => category.id === query.categoryId,
                ) && (
                  <option value={query.categoryId}>
                    当前商品目录不可用
                  </option>
                )}
              {categories.status === "ready" &&
                categories.data.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                    {category.status === "ACTIVE"
                      ? ""
                      : category.status === "INACTIVE"
                        ? "（已停用）"
                        : "（已归档）"}
                  </option>
                ))}
            </select>
              </label>
              <div
            className="erp-filter-row erp-filter-range"
            role="group"
            aria-label="现货库存范围"
            aria-describedby={rangeError ? "on-hand-range-error" : undefined}
          >
            <span className="erp-filter-label">现货库存：</span>
            <label>
              最小（含）
              <input
                aria-label="现货库存最小值（含）"
                name="onHandMin"
                type="number"
                step="1"
                defaultValue={query.onHandMin ?? ""}
              />
            </label>
            <span aria-hidden="true">—</span>
            <label>
              最大（含）
              <input
                aria-label="现货库存最大值（含）"
                name="onHandMax"
                type="number"
                step="1"
                defaultValue={query.onHandMax ?? ""}
              />
            </label>
              </div>
              {rangeError && (
                <div
                  className="inline-alert"
                  id="on-hand-range-error"
                  role="alert"
                >
                  {rangeError}
                </div>
              )}
              <div
            className="erp-filter-row erp-filter-range erp-filter-date-range"
            role="group"
            aria-label="余额更新时间范围（UTC+8）"
            aria-describedby={dateError ? "updated-range-error" : undefined}
          >
            <span className="erp-filter-label">时间段：</span>
            <span className="erp-filter-range-context">
              余额更新时间（UTC+8）
            </span>
            <label>
              起始日期
              <input
                aria-label="余额更新时间起始日期（含）"
                name="updatedFrom"
                type="date"
                defaultValue={query.updatedFrom ?? ""}
              />
            </label>
            <span aria-hidden="true">—</span>
            <label>
              截止日期
              <input
                aria-label="余额更新时间截止日期（含）"
                name="updatedTo"
                type="date"
                defaultValue={query.updatedTo ?? ""}
              />
            </label>
              </div>
              {dateError && (
                <div
                  className="inline-alert"
                  id="updated-range-error"
                  role="alert"
                >
                  {dateError}
                </div>
              )}
            </div>
          </div>
        </form>
        {warehouses.status === "error" && (
          <div className="inline-alert" role="status">
            <ShieldAlert size={19} aria-hidden="true" />
            <span>{warehouses.message}</span>
          </div>
        )}
        {categories.status === "error" && (
          <div className="inline-alert" role="status">
            <ShieldAlert size={19} aria-hidden="true" />
            <span>{categories.message}</span>
          </div>
        )}
        {exportError && (
          <div className="inline-alert" role="alert">
            <ShieldAlert size={19} aria-hidden="true" />
            <span>{exportError}</span>
          </div>
        )}
        <div className="erp-operation-bar" aria-label="库存操作">
          <div className="erp-operation-start">
            <span className="erp-selection-count">
              {balances.status === "ready"
                ? `共 ${balances.data.totalElements} 条`
                : balances.status === "idle"
                  ? "尚未查询"
                  : "库存余额"}
            </span>
          </div>
          <div className="erp-operation-end">
            <button
              className="button"
              type="button"
              disabled={exportBusy}
              aria-busy={exportBusy}
              onClick={() => void exportBalances()}
            >
              {exportBusy ? "正在导出…" : "导出查询结果"}
            </button>
            <button
              className="button"
              type="button"
              onClick={openSettings}
            >
              页面设置
            </button>
            <button
              className="button"
              type="button"
              onClick={() => {
                setQueryEnabled(true);
                setRefreshKey((value) => value + 1);
              }}
            >
              {balances.status === "idle" ? "查询" : "刷新"}
            </button>
          </div>
        </div>
        <p className="form-help inventory-balance-formula" role="note">
          可用库存 = 现货库存 − 已预留；负库存按真实余额显示，不按 0
          截断。
        </p>
        {balances.status === "idle" && (
          <div className="product-state" role="status">
            <Layers3 size={20} aria-hidden="true" />
            <span>
              已关闭进入页面自动查询。设置筛选条件后点击“搜索”或“查询”加载库存余额。
            </span>
          </div>
        )}
        {balances.status === "loading" && !balances.data && (
          <div className="product-state" role="status" aria-live="polite">
            <CircleDashed className="spin" size={20} aria-hidden="true" />
            正在加载库存余额
          </div>
        )}
        {balances.status === "error" && (
          <div className="product-state" role="alert">
            <ShieldAlert size={20} aria-hidden="true" />
            <span>{balances.message}</span>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => setRefreshKey((value) => value + 1)}
            >
              重试
            </button>
          </div>
        )}
        {balances.status === "ready" && (
          <>
            <div className="shop-table-scroll">
              <table className="shop-table">
                <caption className="sr-only">库存余额列表</caption>
                <thead>
                  <tr>
                    <th>库存 SKU 编号</th>
                    <th>商品名称</th>
                    <th>仓库</th>
                    <th>现货库存</th>
                    <th>已预留</th>
                    <th>可用库存</th>
                    <th>更新时间</th>
                    {canReadShopifyInventory && <th>操作</th>}
                  </tr>
                </thead>
                <tbody>
                  {balances.data.items.map((balance) => (
                    <tr key={balance.id}>
                      <td><code>{balance.skuBusinessCode}</code></td>
                      <td>{balance.skuName}</td>
                      <td>
                        <strong>{balance.warehouseName}</strong>
                        <small>{balance.warehouseBusinessCode}</small>
                      </td>
                      <td>{balance.onHand}</td>
                      <td>{balance.reserved}</td>
                      <td>
                        <strong>{balance.available}</strong>
                      </td>
                      <td>
                        <InventoryDateTime value={balance.updatedAt} />
                      </td>
                      {canReadShopifyInventory && (
                        <td>
                          <button
                            className="button button-secondary"
                            type="button"
                            onClick={() => setSelectedShopifyBalance(balance)}
                          >
                            Shopify 库存
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {balances.data.items.length === 0 ? (
              <div className="product-state">
                <Layers3 size={20} aria-hidden="true" />
                没有符合筛选条件的库存余额。
              </div>
            ) : (
              <nav className="pagination" aria-label="库存分页">
                <span>
                  第 {balances.data.page + 1} /{" "}
                  {Math.max(balances.data.totalPages, 1)} 页
                </span>
                <label className="pagination-settings">
                  每页
                  <select
                    aria-label="每页条数"
                    value={query.size}
                    onChange={(event) =>
                      updateQuery({
                        size: Number(event.currentTarget.value),
                        page: 0,
                      })
                    }
                  >
                    {[...new Set([25, 50, 100, 200, query.size])]
                      .sort((left, right) => left - right)
                      .map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                      ))}
                  </select>
                  条
                </label>
                <div>
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={balances.data.page === 0}
                    onClick={() => updateQuery({ page: query.page - 1 })}
                  >
                    上一页
                  </button>
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={
                      balances.data.page + 1 >= balances.data.totalPages
                    }
                    onClick={() => updateQuery({ page: query.page + 1 })}
                  >
                    下一页
                  </button>
                </div>
              </nav>
            )}
          </>
        )}
        {settingsOpen && (
          <div className="dialog-backdrop" role="presentation">
            <section
              className="write-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="inventory-query-settings-title"
              aria-describedby="inventory-query-settings-help"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setSettingsOpen(false);
                }
              }}
            >
              <header className="table-heading">
                <h2 id="inventory-query-settings-title">页面设置</h2>
                <DialogCloseButton onClick={() => setSettingsOpen(false)} />
              </header>
              <form
                className="product-master-data-form"
                onSubmit={saveSettings}
              >
                <fieldset
                  className="erp-filter-options"
                  aria-label="库存查询页面数据初始化查询"
                >
                  <legend>库存查询页面数据初始化查询：</legend>
                  <label>
                    <input
                      autoFocus={draftAutoLoad}
                      type="radio"
                      name="autoLoad"
                      checked={draftAutoLoad}
                      onChange={() => setDraftAutoLoad(true)}
                    />
                    开启
                  </label>
                  <label>
                    <input
                      autoFocus={!draftAutoLoad}
                      type="radio"
                      name="autoLoad"
                      checked={!draftAutoLoad}
                      onChange={() => setDraftAutoLoad(false)}
                    />
                    关闭
                  </label>
                </fieldset>
                <p
                  className="form-help"
                  id="inventory-query-settings-help"
                >
                  该设置默认为开启。关闭后，每次进入库存查询页面不会自动加载数据，需要手工触发查询。
                </p>
                {settingsError && (
                  <div className="inline-alert" role="alert">
                    {settingsError}
                  </div>
                )}
                <footer className="form-actions">
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => setSettingsOpen(false)}
                  >
                    取消
                  </button>
                  <button
                    className="button button-primary"
                    type="submit"
                  >
                    保存设置
                  </button>
                </footer>
              </form>
            </section>
          </div>
        )}
        {selectedShopifyBalance && (
          <ShopifyInventoryDialog
            balance={selectedShopifyBalance}
            canPublish={canPublishShopifyInventory}
            onClose={() => setSelectedShopifyBalance(undefined)}
          />
        )}
      </section>
    </section>
  );
}
