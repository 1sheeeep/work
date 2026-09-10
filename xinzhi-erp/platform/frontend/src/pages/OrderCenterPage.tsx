import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import {
  ArrowDownUp,
  ArrowUpDown,
  CircleCheck,
  CloudDownload,
  Columns3,
  Eye,
  Layers3,
  LockKeyhole,
  Plus,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { CurrencyCodeInput } from "../components/CurrencyCodeInput";
import { PageSelectionCheckbox } from "../components/PageSelectionCheckbox";
import {
  AdvancedFilterPanel,
  AdvancedFilterSection,
} from "../components/AdvancedFilterPanel";
import { DialogCloseButton } from "../components/DialogCloseButton";
import {
  orderCenterApi,
  conditionFields,
  conditionOperators,
  orderListStages,
  orderStatuses,
  orderSortFields,
  orderTimeFields,
  type Order,
  type DashboardSummary,
  type OrderDetail,
  type OrderStatus,
  type OrderListStage,
  type OrderConditionField,
  type OrderConditionOperator,
  type OrderConditionLogic,
  type OrderTimeField,
  type OrderSortField,
  type OrderProfileInput,
  type OrderOperationalInput,
  type Page,
  type OrderTransferJob,
  type SkuMatchSource,
  type SkuMatchQueueItem,
  type CreateOrderInput,
  type FulfillmentPlan,
  type ShippingPackagingTemplate,
  type ShippingScale,
  type ShopifyFulfillmentPreview,
  type ShopifyOrderCatalogImportResult,
  type ShopifyOrderCatalogPreview,
  type ShopifyOrderLineMatchStatus,
  type ShopifyShippingAddressUpdateInput,
} from "../modules/orderCenterApi";
import {
  productCenterApi,
  type ProductListing,
  type ProductSku,
} from "../modules/productCenterApi";
import {
  shopCenterApi,
  shopDisplayName,
  type PlatformCatalogEntry,
  type TenantShop,
} from "../modules/shopCenterApi";
import {
  warehouseCenterApi,
  type Warehouse,
  type WarehouseLocation,
} from "../modules/warehouseCenterApi";
import { iamAdminApi, type Member } from "../modules/iamAdminApi";
import { systemGeneralSettingApi } from "../modules/systemGeneralSettingApi";
import {
  logisticsAuthorizationApi,
  type LogisticsAuthorizationChannel,
} from "../modules/logisticsAuthorizationApi";
import { shopifyScopePreflight } from "../modules/shopifyScopePreflight";

const PAGE_SIZE = 25;
const PAGE_SIZES = [25, 50, 100, 200] as const;
const TRANSFER_PAGE_SIZES = [10, 20, 50, 100, 200] as const;
const MAX_PAGE = 9_999;
const MAX_KEYWORD_LENGTH = 100;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORDER_LIST_FALLBACK_FOCUS_ID = "order-list-focus-target";
const ORDER_DETAIL_FOCUS_PARAM = "returnFocus";
const ORDER_COLUMNS_STORAGE_KEY = "xz.erp.orders.visibleColumns.v1";
const DIRECTORY_PAGE_SIZE = 200;
const MEMBER_DIRECTORY_PAGE_SIZE = 100;
const MAX_DIRECTORY_PAGES = 100;

type DirectoryPage<T> = {
  items: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
};

async function listAllDirectoryItems<T extends { id: string }>(
  pageSize: number,
  loadPage: (page: number) => Promise<DirectoryPage<T>>,
) {
  const first = await loadPage(0);
  if (
    first.page !== 0 ||
    first.size !== pageSize ||
    first.totalPages > MAX_DIRECTORY_PAGES
  ) {
    throw new Error("Unexpected directory pagination");
  }

  const items = [...first.items];
  for (let page = 1; page < first.totalPages; page += 1) {
    const next = await loadPage(page);
    if (
      next.page !== page ||
      next.size !== pageSize ||
      next.totalElements !== first.totalElements ||
      next.totalPages !== first.totalPages
    ) {
      throw new Error("Inconsistent directory pagination");
    }
    items.push(...next.items);
  }

  if (
    items.length !== first.totalElements ||
    new Set(items.map((item) => item.id)).size !== items.length
  ) {
    throw new Error("Incomplete directory pagination");
  }
  return items;
}

const orderColumns = [
  ["placedAt", "下单时间"],
  ["shop", "店铺信息"],
  ["buyer", "买家引用"],
  ["status", "状态"],
  ["payment", "收款 / 金额"],
  ["logistics", "物流 / 时限"],
  ["destination", "目的地"],
  ["items", "商品明细"],
  ["flags", "处理标记"],
  ["platformStatus", "平台状态"],
  ["paymentStatus", "付款状态"],
  ["currency", "币种"],
  ["totalAmount", "订单金额"],
  ["shippingAmount", "运费"],
  ["weight", "重量"],
  ["paidAt", "付款时间"],
  ["shipByAt", "最晚发货时间"],
  ["shippedAt", "发货时间"],
  ["createdAt", "创建时间"],
  ["updatedAt", "更新时间"],
  ["trackingStatus", "跟踪状态"],
  ["warehouse", "仓库"],
  ["location", "仓位"],
  ["picker", "配货员"],
  ["shipper", "发货员"],
  ["purchaser", "采购员"],
  ["developer", "商品负责人"],
  ["postalCode", "邮编"],
  ["categories", "订单分类"],
  ["skuSummary", "SKU 摘要"],
  ["titleSummary", "商品标题摘要"],
  ["lineCount", "商品明细数"],
  ["reshipment", "补发信息"],
  ["salesRecordNumber", "交易号"],
  ["shoppingCartReference", "购物车单号"],
  ["customOrderReference", "内部 / 自定义单号"],
  ["trackingReference", "物流单号"],
  ["secondaryTrackingReference", "第二物流单号"],
  ["actualPaid", "实付金额"],
  ["profit", "利润"],
  ["actualShipping", "物流支出"],
  ["itemAmount", "商品金额"],
  ["platformFee", "平台费用"],
  ["insuranceFee", "保险费用"],
  ["paymentFee", "支付手续费"],
  ["otherIncome", "其他收入"],
  ["otherExpense", "其他支出"],
  ["tax", "税费"],
  ["estimatedShipping", "预估物流支出"],
  ["salesperson", "业务员"],
  ["manager", "订单负责人"],
  ["orderRemark", "订单备注"],
  ["customerCategory", "客户分类"],
  ["productKindCount", "商品种类数"],
  ["supplierReference", "供应商引用"],
  ["parentProductCategory", "商品父目录"],
  ["childProductCategory", "商品子目录"],
  ["productStatus", "商品状态"],
  ["extendedAttribute", "扩展属性"],
  ["printedAt", "打印时间"],
  ["platformReturnedAt", "回传平台发货时间"],
  ["exceptionReviewedAt", "异常审核时间"],
  ["platformSpecifiedHandoverAt", "平台指定交运时间"],
  ["platformLabelRequestedAt", "平台指定拉取面单时间"],
  ["deliveryDeadlineAt", "订单发货期限"],
  ["cancelledAt", "作废时间"],
  ["handedOverAt", "交运时间"],
  ["deliveredAt", "签收时间"],
] as const;
type OrderColumn = (typeof orderColumns)[number][0];
const defaultOrderColumns = orderColumns.slice(0, 9).map(([key]) => key);

function loadOrderColumns(): OrderColumn[] {
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(ORDER_COLUMNS_STORAGE_KEY) ?? "null",
    );
    if (Array.isArray(stored)) {
      const allowed = new Set<OrderColumn>(
        orderColumns.map(([key]) => key),
      );
      const result = stored.filter(
        (value): value is OrderColumn =>
          typeof value === "string" && allowed.has(value as OrderColumn),
      );
      if (result.length > 0) return [...new Set(result)];
    }
  } catch {
    // Fail closed to the reviewed default column set.
  }
  return defaultOrderColumns;
}

const transitions: Record<OrderStatus, OrderStatus[]> = {
  UNPAID: ["REVIEW_PENDING", "HOLD", "CANCELLED"],
  RECEIVED: ["REVIEW_PENDING", "MERGE_PENDING", "HOLD", "CANCELLED"],
  REVIEW_PENDING: ["READY_TO_FULFILL", "MERGE_PENDING", "HOLD", "CANCELLED"],
  MERGE_PENDING: ["REVIEW_PENDING", "READY_TO_FULFILL", "HOLD", "CANCELLED"],
  HOLD: ["REVIEW_PENDING", "MERGE_PENDING", "CANCELLED"],
  READY_TO_FULFILL: [],
  FULFILLING: [],
  SHIPPED: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
};

const orderStatusLabels: Record<OrderStatus, string> = {
  UNPAID: "未付款",
  RECEIVED: "已接收",
  REVIEW_PENDING: "待审核",
  MERGE_PENDING: "待合并",
  HOLD: "已挂起",
  READY_TO_FULFILL: "待处理",
  FULFILLING: "配货中",
  SHIPPED: "已发货",
  DELIVERED: "已妥投",
  CANCELLED: "已取消",
};

const skuMatchSourceLabels: Record<SkuMatchSource, string> = {
  PROVIDED: "订单提供",
  LISTING_MAPPING: "刊登映射",
  MANUAL: "人工匹配",
  UNMATCHED: "未匹配",
};

export type OrderListQuery = {
  view: "orders" | "queue";
  shopId: string;
  platformId: string;
  status?: OrderStatus;
  stage: OrderListStage;
  keyword: string;
  skuKeyword: string;
  warehouseId: string;
  locationId: string;
  paymentStatus: "" | "UNPAID" | "PAID" | "PARTIALLY_REFUNDED" | "REFUNDED";
  platformStatus: string;
  countryCode: string;
  trackingStatus: string;
  logisticsChannel: string;
  currency: string;
  printed?: boolean;
  reshipment?: boolean;
  fixedCategory: string;
  customCategory: string;
  customerCategory: string;
  pickerUserId: string;
  shipperUserId: string;
  salespersonUserId: string;
  purchaserUserId: string;
  developerUserId: string;
  managerUserId: string;
  supplierReference: string;
  parentProductCategory: string;
  childProductCategory: string;
  productStatus: string;
  extendedAttribute: string;
  minProductKinds?: number;
  maxProductKinds?: number;
  minAmountMinor?: number;
  maxAmountMinor?: number;
  minWeightGrams?: number;
  maxWeightGrams?: number;
  placedFrom: string;
  placedTo: string;
  paidFrom: string;
  paidTo: string;
  conditionField1?: OrderConditionField;
  conditionOperator1?: OrderConditionOperator;
  conditionValue1: string;
  conditionField2?: OrderConditionField;
  conditionOperator2?: OrderConditionOperator;
  conditionValue2: string;
  conditionLogic: OrderConditionLogic;
  timeField1?: OrderTimeField;
  timeFrom1: string;
  timeTo1: string;
  timeField2?: OrderTimeField;
  timeFrom2: string;
  timeTo2: string;
  sortField: OrderSortField;
  sortDirection: "ASC" | "DESC";
  page: number;
  size: number;
};

type ListState = "loading" | "ready" | "error";
type DetailState = "idle" | "loading" | "error";
type DashboardState = "idle" | "loading" | "ready" | "error";

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function isOrderId(value: string): boolean {
  return isUuid(value);
}

export function parseOrderQuery(search: string): OrderListQuery {
  const params = new URLSearchParams(search);
  const shopId = params.get("shopId") ?? "";
  const status = params.get("status");
  const page = Number(params.get("page"));
  const requestedSize = Number(params.get("size"));
  const number = (name: string) => {
    const raw = params.get(name);
    if (raw === null || raw === "") return undefined;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  };
  const triState = (name: string) => {
    const value = params.get(name);
    return value === "true" ? true : value === "false" ? false : undefined;
  };
  const uuid = (name: string) => {
    const value = params.get(name) ?? "";
    return isUuid(value) ? value : "";
  };
  const text = (name: string, max = 160) =>
    (params.get(name) ?? "").slice(0, max);
  const enumValue = <T extends string>(
    name: string,
    allowed: readonly T[],
  ): T | undefined => {
    const value = params.get(name);
    return value && allowed.includes(value as T) ? value as T : undefined;
  };
  const paymentStatus = params.get("paymentStatus");

  return {
    view: params.get("view") === "queue" ? "queue" : "orders",
    shopId: isUuid(shopId) ? shopId : "",
    platformId: uuid("platformId"),
    status: orderStatuses.includes(status as OrderStatus)
      ? (status as OrderStatus)
      : undefined,
    stage: enumValue("stage", orderListStages) ?? "ALL",
    keyword: (params.get("keyword") ?? "").slice(0, MAX_KEYWORD_LENGTH),
    skuKeyword: (params.get("skuKeyword") ?? "").slice(0, MAX_KEYWORD_LENGTH),
    warehouseId: uuid("warehouseId"),
    locationId: uuid("locationId"),
    paymentStatus: ["UNPAID", "PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(
      paymentStatus ?? "",
    ) ? paymentStatus as OrderListQuery["paymentStatus"] : "",
    platformStatus: (params.get("platformStatus") ?? "").slice(0, 64),
    countryCode: /^[A-Z]{2}$/.test(params.get("countryCode") ?? "")
      ? params.get("countryCode") ?? "" : "",
    trackingStatus: (params.get("trackingStatus") ?? "").slice(0, 32),
    logisticsChannel: text("logisticsChannel", 80),
    currency: /^[A-Z]{3}$/.test(params.get("currency") ?? "")
      ? params.get("currency") ?? "" : "",
    printed: triState("printed"),
    reshipment: triState("reshipment"),
    fixedCategory: text("fixedCategory", 80),
    customCategory: text("customCategory", 80),
    customerCategory: text("customerCategory", 80),
    pickerUserId: uuid("pickerUserId"),
    shipperUserId: uuid("shipperUserId"),
    salespersonUserId: "",
    purchaserUserId: uuid("purchaserUserId"),
    developerUserId: "",
    managerUserId: uuid("managerUserId"),
    supplierReference: text("supplierReference", 160),
    parentProductCategory: text("parentProductCategory", 120),
    childProductCategory: text("childProductCategory", 120),
    productStatus: text("productStatus", 40),
    extendedAttribute: text("extendedAttribute", 160),
    minProductKinds: number("minProductKinds"),
    maxProductKinds: number("maxProductKinds"),
    minAmountMinor: number("minAmountMinor"),
    maxAmountMinor: number("maxAmountMinor"),
    minWeightGrams: number("minWeightGrams"),
    maxWeightGrams: number("maxWeightGrams"),
    placedFrom: (params.get("placedFrom") ?? "").slice(0, 30),
    placedTo: (params.get("placedTo") ?? "").slice(0, 30),
    paidFrom: (params.get("paidFrom") ?? "").slice(0, 30),
    paidTo: (params.get("paidTo") ?? "").slice(0, 30),
    conditionField1: enumValue("conditionField1", conditionFields),
    conditionOperator1: enumValue(
      "conditionOperator1",
      conditionOperators,
    ),
    conditionValue1: text("conditionValue1", 200),
    conditionField2: enumValue("conditionField2", conditionFields),
    conditionOperator2: enumValue(
      "conditionOperator2",
      conditionOperators,
    ),
    conditionValue2: text("conditionValue2", 200),
    conditionLogic: params.get("conditionLogic") === "OR" ? "OR" : "AND",
    timeField1: enumValue("timeField1", orderTimeFields),
    timeFrom1: text("timeFrom1", 30),
    timeTo1: text("timeTo1", 30),
    timeField2: enumValue("timeField2", orderTimeFields),
    timeFrom2: text("timeFrom2", 30),
    timeTo2: text("timeTo2", 30),
    sortField: enumValue("sortField", orderSortFields) ?? "PLACED_AT",
    sortDirection: params.get("sortDirection") === "ASC" ? "ASC" : "DESC",
    page:
      Number.isSafeInteger(page) && page >= 0 && page <= MAX_PAGE ? page : 0,
    size: PAGE_SIZES.includes(requestedSize as (typeof PAGE_SIZES)[number])
      ? requestedSize : PAGE_SIZE,
  };
}

export function orderListPath(query: OrderListQuery): string {
  const params = new URLSearchParams({ page: String(query.page) });
  if (query.size !== PAGE_SIZE) params.set("size", String(query.size));
  if (query.view === "queue") params.set("view", "queue");
  if (query.shopId) params.set("shopId", query.shopId);
  if (query.platformId) params.set("platformId", query.platformId);
  if (query.status) params.set("status", query.status);
  if (query.stage !== "ALL") params.set("stage", query.stage);
  if (query.keyword) params.set("keyword", query.keyword);
  if (query.skuKeyword) params.set("skuKeyword", query.skuKeyword);
  if (query.warehouseId) params.set("warehouseId", query.warehouseId);
  if (query.locationId) params.set("locationId", query.locationId);
  if (query.paymentStatus) params.set("paymentStatus", query.paymentStatus);
  if (query.platformStatus) params.set("platformStatus", query.platformStatus);
  if (query.countryCode) params.set("countryCode", query.countryCode);
  if (query.trackingStatus) params.set("trackingStatus", query.trackingStatus);
  if (query.logisticsChannel) params.set("logisticsChannel", query.logisticsChannel);
  if (query.currency) params.set("currency", query.currency);
  if (query.printed !== undefined) params.set("printed", String(query.printed));
  if (query.reshipment !== undefined) params.set("reshipment", String(query.reshipment));
  const strings: Array<[string, string]> = [
    ["fixedCategory", query.fixedCategory],
    ["customCategory", query.customCategory],
    ["customerCategory", query.customerCategory],
    ["pickerUserId", query.pickerUserId],
    ["shipperUserId", query.shipperUserId],
    ["purchaserUserId", query.purchaserUserId],
    ["managerUserId", query.managerUserId],
    ["supplierReference", query.supplierReference],
    ["parentProductCategory", query.parentProductCategory],
    ["childProductCategory", query.childProductCategory],
    ["productStatus", query.productStatus],
    ["extendedAttribute", query.extendedAttribute],
    ["conditionValue1", query.conditionValue1],
    ["conditionValue2", query.conditionValue2],
    ["timeFrom1", query.timeFrom1],
    ["timeTo1", query.timeTo1],
    ["timeFrom2", query.timeFrom2],
    ["timeTo2", query.timeTo2],
  ];
  strings.forEach(([name, value]) => {
    if (value) params.set(name, value);
  });
  const optionals: Array<[string, string | undefined]> = [
    ["conditionField1", query.conditionField1],
    ["conditionOperator1", query.conditionOperator1],
    ["conditionField2", query.conditionField2],
    ["conditionOperator2", query.conditionOperator2],
    ["timeField1", query.timeField1],
    ["timeField2", query.timeField2],
  ];
  optionals.forEach(([name, value]) => {
    if (value) params.set(name, value);
  });
  if (query.conditionField1 || query.conditionField2) {
    params.set("conditionLogic", query.conditionLogic);
  }
  if (query.sortField !== "PLACED_AT") params.set("sortField", query.sortField);
  if (query.sortDirection !== "DESC") params.set("sortDirection", query.sortDirection);
  if (query.minProductKinds !== undefined) params.set("minProductKinds", String(query.minProductKinds));
  if (query.maxProductKinds !== undefined) params.set("maxProductKinds", String(query.maxProductKinds));
  if (query.minAmountMinor !== undefined) params.set("minAmountMinor", String(query.minAmountMinor));
  if (query.maxAmountMinor !== undefined) params.set("maxAmountMinor", String(query.maxAmountMinor));
  if (query.minWeightGrams !== undefined) params.set("minWeightGrams", String(query.minWeightGrams));
  if (query.maxWeightGrams !== undefined) params.set("maxWeightGrams", String(query.maxWeightGrams));
  if (query.placedFrom) params.set("placedFrom", query.placedFrom);
  if (query.placedTo) params.set("placedTo", query.placedTo);
  if (query.paidFrom) params.set("paidFrom", query.paidFrom);
  if (query.paidTo) params.set("paidTo", query.paidTo);
  return `/orders?${params.toString()}`;
}

export function orderDetailPath(
  orderId: string,
  query: OrderListQuery,
  returnFocusId?: string,
): string {
  const listPath = orderListPath(query);
  const search = listPath.split("?", 2)[1];
  const params = new URLSearchParams(search);
  if (returnFocusId && isOrderDetailTriggerId(returnFocusId)) {
    params.set(ORDER_DETAIL_FOCUS_PARAM, returnFocusId);
  }
  return `/orders/${encodeURIComponent(orderId)}?${params.toString()}`;
}

export function orderDetailTriggerId(orderId: string): string {
  return `order-detail-trigger-${orderId}`;
}

export function queueOrderDetailTriggerId(orderId: string, lineId: string): string {
  return `order-queue-detail-trigger-${orderId}-${lineId}`;
}

function isOrderDetailTriggerId(value: string): boolean {
  const orderPrefix = "order-detail-trigger-";
  const queuePrefix = "order-queue-detail-trigger-";
  if (value.startsWith(orderPrefix)) {
    return isUuid(value.slice(orderPrefix.length));
  }
  if (!value.startsWith(queuePrefix)) return false;
  const ids = value.slice(queuePrefix.length).split("-");
  const orderId = ids.slice(0, 5).join("-");
  const lineId = ids.slice(5).join("-");
  return isUuid(orderId) && isUuid(lineId);
}

export function orderDetailReturnFocusId(search: string): string | undefined {
  const value = new URLSearchParams(search).get(ORDER_DETAIL_FOCUS_PARAM);
  return value && isOrderDetailTriggerId(value) ? value : undefined;
}

let pendingOrderListFocusId: string | undefined | null = null;

export function requestOrderListFocus(triggerId?: string) {
  pendingOrderListFocusId = triggerId;
}

function restorePendingOrderListFocus(settled: boolean) {
  if (pendingOrderListFocusId === null) return;
  const triggerId = pendingOrderListFocusId;
  if (triggerId) {
    const trigger = document.getElementById(triggerId);
    if (trigger instanceof HTMLElement && !trigger.matches(":disabled")) {
      trigger.focus();
      pendingOrderListFocusId = null;
      return;
    }
    if (!settled) return;
  }

  const fallback = document.getElementById(ORDER_LIST_FALLBACK_FOCUS_ID);
  if (fallback instanceof HTMLElement) {
    fallback.focus();
    pendingOrderListFocusId = null;
  }
}

function OrderListFocusRestorer({ settled }: { settled: boolean }) {
  useEffect(() => {
    restorePendingOrderListFocus(settled);
  }, [settled]);

  return null;
}

export function safeOrderError(error: unknown): string {
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
    errorDetails.reason === "order_pull_blackout"
  ) {
    const resumesAt = typeof errorDetails.resumesAt === "string"
      ? errorDetails.resumesAt.slice(0, 5) : "设置的结束时间";
    return `当前处于订单拉取禁用时段，请于北京时间 ${resumesAt} 后重试。`;
  }
  if (
    error instanceof ApiError &&
    error.status === 409 &&
    errorDetails.reason === "shopify_protected_customer_data_required"
  ) {
    return "Shopify 尚未开放订单所需的受保护客户数据（姓名、地址、电话和邮箱）。请在应用的受保护客户数据设置中勾选这些字段并保存，然后重新预览订单。";
  }
  if (
    error instanceof ApiError &&
    error.status === 409 &&
    errorDetails.reason === "shopify_fulfillment_scope_missing"
  ) {
    return "Shopify 商家自管履约权限不可用，暂时无法回传发货。请在店铺详情重新授权后再试。";
  }
  if (
    error instanceof ApiError &&
    error.status === 409 &&
    errorDetails.reason === "shopify_connection_not_connected"
  ) {
    return "Shopify 店铺未连接，不能回传发货。请在店铺详情重新连接。";
  }
  if (
    error instanceof ApiError &&
    error.status === 409 &&
    errorDetails.reason === "shopify_fulfillment_uncertain"
  ) {
    return "Shopify 发货结果尚未确认。请使用“核对并重试回传”，系统会先核对已有发货，避免重复。";
  }
  if (
    error instanceof ApiError &&
    error.status === 409 &&
    [
      "idempotency_conflict",
      "publication_conflict",
      "publication_in_progress",
      "shopify_publication_not_allowed",
      "shopify_publication_not_ready",
    ].includes(String(errorDetails.reason))
  ) {
    return "当前包裹的 Shopify 回传状态或首次请求参数已变化，请刷新履约明细后按页面提示处理。";
  }
  if (
    error instanceof ApiError &&
    error.status === 409 &&
    (errorDetails.scope === "write_orders" ||
      error.message.includes("write_orders"))
  ) {
    return "Shopify 订单维护权限不可用，暂时不能写回收货地址。请在店铺详情重新授权后再试。";
  }
  if (
    error instanceof ApiError &&
    error.status === 409 &&
    errorDetails.reason === "shopify_order_edit_uncertain"
  ) {
    return "Shopify 订单编辑结果尚未确认。请保留当前数量后重试，系统会先核对订单状态。";
  }
  if (
    error instanceof ApiError &&
    error.status === 409 &&
    (errorDetails.scope === "read_order_edits" ||
      errorDetails.scope === "write_order_edits")
  ) {
    return "Shopify 订单编辑权限不可用。请在店铺详情重新授权后再修改订单。";
  }
  if (
    error instanceof ApiError &&
    error.status === 409 &&
    (error.code === "shopify_authorization_conflict" ||
      errorDetails.reason === "shopify_connection_not_connected" ||
      errorDetails.reason === "shopify_scope_unavailable" ||
      errorDetails.scope === "read_orders" ||
      error.message.includes("Shopify connection") ||
      error.message.includes("read_orders"))
  ) {
    return "Shopify 店铺授权未连接或订单权限不可用，暂时无法读取或导入订单。请在店铺详情刷新授权状态后重试。";
  }
  if (error instanceof ApiError && error.status === 409) {
    return "订单资料已更新，请刷新后重试。";
  }
  if (error instanceof ApiError && error.status === 403) {
    return "无操作权限，当前会话保持有效。";
  }
  if (error instanceof ApiError && error.status === 404) {
    return "订单不存在或当前不可访问。";
  }

  return "请求未能安全完成，请稍后重试。";
}

export function allowedTargets(status: OrderStatus): OrderStatus[] {
  return transitions[status];
}

function orderStatusLabel(status: OrderStatus): string {
  return orderStatusLabels[status];
}

function orderDisplayReference(
  order: Pick<Order, "externalOrderRef" | "customOrderReference">,
  customOrderReference = order.customOrderReference,
): string {
  const platformOrderName = customOrderReference?.trim();
  return order.externalOrderRef.startsWith("gid://shopify/Order/") &&
    platformOrderName
    ? platformOrderName
    : order.externalOrderRef;
}

function skuMatchSourceLabel(source: SkuMatchSource): string {
  return skuMatchSourceLabels[source];
}

const fulfillmentStatusLabels: Record<string, string> = {
  PENDING_ALLOCATION: "待分配",
  ALLOCATED: "已分配",
  PICKING: "拣货中",
  PACKING: "包装验货中",
  READY_TO_SHIP: "待称重出库",
  PARTIALLY_SHIPPED: "部分出库",
  SHIPPED: "已出库",
  PARTIALLY_FULFILLED: "部分履约",
  CANCELLED: "已取消",
  EXCEPTION: "异常",
};

const packageStatusLabels: Record<FulfillmentPlan["packages"][number]["status"], string> = {
  DRAFT: "待封箱",
  SEALED: "待称重出库",
  HANDED_OVER: "已仓库交接",
  HANDOVER_CORRECTED: "发货已冲销",
  VOIDED: "已作废",
};

const logisticsBookingStatusLabels: Record<
  FulfillmentPlan["packages"][number]["logisticsBookingStatus"],
  string
> = {
  NOT_REQUESTED: "尚未获取运单",
  BOOKING: "正在获取运单",
  BOOKED: "运单已获取",
  FAILED: "获取失败",
  UNCERTAIN: "结果待核对",
};

const logisticsTrackingStatusLabels: Record<
  NonNullable<FulfillmentPlan["packages"][number]["logisticsTrackingStatus"]>,
  string
> = {
  CREATED: "已创建",
  IN_TRANSIT: "运输中",
  DELIVERED: "已签收",
  EXCEPTION: "物流异常",
  UNKNOWN: "待更新",
};

function fulfillmentStatusLabel(status: string): string {
  return fulfillmentStatusLabels[status] ?? status;
}

function fulfillmentPauseLabel(state: FulfillmentPlan["pauseState"]): string {
  return state === "PAUSED" ? "已暂停" : "正常";
}

function fulfillmentShortageLabel(
  state: FulfillmentPlan["shortageState"],
): string {
  return {
    NONE: "无缺货",
    PARTIAL: "部分缺货",
    FULL: "全部缺货",
    UNKNOWN: "待确认",
  }[state];
}

export function formatMinor(minor: number, currency: string): string {
  if (!Number.isSafeInteger(minor) || !/^[A-Z]{3}$/.test(currency)) {
    return `${minor} ${currency || "最小货币单位"}`;
  }

  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).format(minor / 100);
  } catch {
    return `${minor} ${currency}`;
  }
}

export function formatOrderDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function OrderDateTime({
  value,
  missingLabel = "—",
}: {
  value?: string;
  missingLabel?: string;
}) {
  if (!value) {
    return <>{missingLabel}</>;
  }

  const formatted = formatOrderDateTime(value);
  if (formatted === "—") {
    return <>—</>;
  }

  return <time dateTime={value}>{formatted}</time>;
}

function RetryableOrderError({
  message,
  retryLabel,
  onRetry,
}: {
  message: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <div className="inline-alert" role="alert">
      <p>{message}</p>
      <button className="text-button" type="button" onClick={onRetry}>
        {retryLabel}
      </button>
    </div>
  );
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute("hidden"));
}

export function OrderCenterPage() {
  const { hasPermission } = useAuth();
  const router = useRouter();
  const search = useRouterState({
    select: (state) => state.location.searchStr,
  });
  const query = useMemo(() => parseOrderQuery(search), [search]);
  const listRequest = useRef(0);
  const [orders, setOrders] = useState<Order[]>([]);
  const [page, setPage] = useState({ totalElements: 0, totalPages: 0 });
  const [listState, setListState] = useState<ListState>("loading");
  const [listMessage, setListMessage] = useState("");
  const [listRefresh, setListRefresh] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [operationMessage, setOperationMessage] = useState("");
  const [operationBusy, setOperationBusy] = useState(false);
  const [bulkTarget, setBulkTarget] = useState<OrderStatus | "">("");
  const [visibleColumns, setVisibleColumns] =
    useState<OrderColumn[]>(loadOrderColumns);
  const [queueFocusSettled, setQueueFocusSettled] = useState(false);
  const canRead = hasPermission("orders.read");
  const canWrite = hasPermission("orders.write");
  const canTransferRead = hasPermission("orders.transfer.read");
  const canTransferWrite = hasPermission("orders.transfer.write");

  useEffect(() => {
    try {
      window.localStorage.setItem(
        ORDER_COLUMNS_STORAGE_KEY,
        JSON.stringify(visibleColumns),
      );
    } catch {
      // Column preferences are optional; order access must remain available.
    }
  }, [visibleColumns]);

  useEffect(() => {
    setQueueFocusSettled(false);
    setSelected(new Set());
  }, [query.view, search]);

  useEffect(() => {
    if (!canRead) {
      listRequest.current += 1;
      return;
    }

    const request = ++listRequest.current;

    setListState("loading");
    setListMessage("");

    void orderCenterApi
      .list({
        shopId: query.shopId || undefined,
        platformId: query.platformId || undefined,
        status: query.status,
        stage: query.stage,
        keyword: query.keyword || undefined,
        skuKeyword: query.skuKeyword || undefined,
        warehouseId: query.warehouseId || undefined,
        locationId: query.locationId || undefined,
        paymentStatus: query.paymentStatus || undefined,
        platformStatus: query.platformStatus || undefined,
        countryCode: query.countryCode || undefined,
        trackingStatus: query.trackingStatus || undefined,
        logisticsChannel: query.logisticsChannel || undefined,
        currency: query.currency || undefined,
        printed: query.printed,
        reshipment: query.reshipment,
        fixedCategory: query.fixedCategory || undefined,
        customCategory: query.customCategory || undefined,
        customerCategory: query.customerCategory || undefined,
        pickerUserId: query.pickerUserId || undefined,
        shipperUserId: query.shipperUserId || undefined,
        purchaserUserId: query.purchaserUserId || undefined,
        managerUserId: query.managerUserId || undefined,
        supplierReference: query.supplierReference || undefined,
        parentProductCategory:
          query.parentProductCategory || undefined,
        childProductCategory:
          query.childProductCategory || undefined,
        productStatus: query.productStatus || undefined,
        extendedAttribute: query.extendedAttribute || undefined,
        minProductKinds: query.minProductKinds,
        maxProductKinds: query.maxProductKinds,
        minAmountMinor: query.minAmountMinor,
        maxAmountMinor: query.maxAmountMinor,
        minWeightGrams: query.minWeightGrams,
        maxWeightGrams: query.maxWeightGrams,
        placedFrom: query.placedFrom || undefined,
        placedTo: query.placedTo || undefined,
        paidFrom: query.paidFrom || undefined,
        paidTo: query.paidTo || undefined,
        conditionField1: query.conditionField1,
        conditionOperator1: query.conditionOperator1,
        conditionValue1: query.conditionValue1 || undefined,
        conditionField2: query.conditionField2,
        conditionOperator2: query.conditionOperator2,
        conditionValue2: query.conditionValue2 || undefined,
        conditionLogic: query.conditionLogic,
        timeField1: query.timeField1,
        timeFrom1: query.timeFrom1 || undefined,
        timeTo1: query.timeTo1 || undefined,
        timeField2: query.timeField2,
        timeFrom2: query.timeFrom2 || undefined,
        timeTo2: query.timeTo2 || undefined,
        sortField: query.sortField,
        sortDirection: query.sortDirection,
        page: query.page,
        size: query.size,
      })
      .then((result) => {
        if (request !== listRequest.current) {
          return;
        }

        setOrders(result.items);
        setPage({
          totalElements: result.totalElements,
          totalPages: result.totalPages,
        });
        setListState("ready");
      })
      .catch((error: unknown) => {
        if (request !== listRequest.current) {
          return;
        }

        setListMessage(safeOrderError(error));
        setListState("error");
      });

    return () => {
      if (request === listRequest.current) {
        listRequest.current += 1;
      }
    };
  }, [canRead, listRefresh, search]);

  const push = (patch: Partial<OrderListQuery>) => {
    const next = { ...query, ...patch };
    router.history.push(orderListPath(next));
  };

  const transferFilter = () => {
    const {
      page: ignoredPage,
      size: ignoredSize,
      view: ignoredView,
      ...filter
    } = query;
    void ignoredPage;
    void ignoredSize;
    void ignoredView;
    return {
      ...filter,
      shopId: filter.shopId || undefined,
      warehouseId: filter.warehouseId || undefined,
      status: filter.status,
      keyword: filter.keyword || undefined,
      skuKeyword: filter.skuKeyword || undefined,
      paymentStatus: filter.paymentStatus || undefined,
      platformStatus: filter.platformStatus || undefined,
      countryCode: filter.countryCode || undefined,
      trackingStatus: filter.trackingStatus || undefined,
      currency: filter.currency || undefined,
      placedFrom: filter.placedFrom || undefined,
      placedTo: filter.placedTo || undefined,
      paidFrom: filter.paidFrom || undefined,
      paidTo: filter.paidTo || undefined,
    };
  };

  const exportOrders = async () => {
    if (operationBusy) return;
    setOperationBusy(true);
    setOperationMessage("");
    try {
      const result = await orderCenterApi.exportCsv(transferFilter());
      if (!result.filename || !result.mediaType || !result.contentBase64) {
        throw new Error("Invalid export response");
      }
      const bytes = Uint8Array.from(atob(result.contentBase64), (value) =>
        value.charCodeAt(0),
      );
      const url = URL.createObjectURL(new Blob([bytes], { type: result.mediaType }));
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename;
      link.click();
      URL.revokeObjectURL(url);
      setOperationMessage(`已导出 ${result.succeededCount} 条订单。`);
    } catch (error) {
      setOperationMessage(safeOrderError(error));
    } finally {
      setOperationBusy(false);
    }
  };

  const importOrders = async (file: File) => {
    if (operationBusy) return;
    setOperationBusy(true);
    setOperationMessage("");
    try {
      const result = await orderCenterApi.importCsv(
        file,
        `web.${crypto.randomUUID()}`,
      );
      setOperationMessage(`已导入 ${result.succeededCount} 张订单。`);
      setListRefresh((current) => current + 1);
    } catch (error) {
      setOperationMessage(safeOrderError(error));
    } finally {
      setOperationBusy(false);
    }
  };

  const applyBulkStatus = async () => {
    if (operationBusy || !bulkTarget || selected.size === 0) return;
    const selectedOrders = orders
      .filter((order) => selected.has(order.id))
      .map((order) => ({ orderId: order.id, version: order.version }));
    if (selectedOrders.length !== selected.size) {
      setOperationMessage("选择中包含已不在当前结果内的订单，请刷新后重试。");
      return;
    }
    setOperationBusy(true);
    setOperationMessage("");
    try {
      const result = await orderCenterApi.bulkStatus({
        commandId: crypto.randomUUID(),
        targetStatus: bulkTarget,
        orders: selectedOrders,
      });
      setOperationMessage(`已更新 ${result.succeededCount} 张订单。`);
      setSelected(new Set());
      setBulkTarget("");
      setListRefresh((current) => current + 1);
    } catch (error) {
      setOperationMessage(safeOrderError(error));
    } finally {
      setOperationBusy(false);
    }
  };

  if (!canRead) {
    return (
      <section
        className="order-center-page"
        aria-labelledby={ORDER_LIST_FALLBACK_FOCUS_ID}
      >
        <h1 className="sr-only" id={ORDER_LIST_FALLBACK_FOCUS_ID} tabIndex={-1}>订单列表</h1>
        <div className="compact-empty-state" role="alert">
          <strong>暂无访问权限</strong>
          <span>需要订单查看权限后才能查看订单列表。</span>
        </div>
      </section>
    );
  }

  return (
    <section
      className="order-center-page"
      aria-labelledby={ORDER_LIST_FALLBACK_FOCUS_ID}
    >
      <h1 className="sr-only" id={ORDER_LIST_FALLBACK_FOCUS_ID} tabIndex={-1}>订单列表</h1>

      <nav className="order-view-tabs" aria-label="订单视图">
        <button
          type="button"
          className="order-view-tab"
          aria-current={query.view === "orders" ? "page" : undefined}
          onClick={() =>
            router.history.push(orderViewPath("orders", query))
          }
        >
          订单列表
        </button>
        <button
          type="button"
          className="order-view-tab"
          aria-current={query.view === "queue" ? "page" : undefined}
          onClick={() =>
            router.history.push(orderViewPath("queue", query))
          }
        >
          SKU 匹配队列
        </button>
      </nav>

      <OrderDashboardOverview
        canRead={canRead}
        shopId={query.shopId}
      />
      <OrderListFocusRestorer
        settled={
          query.view === "queue" ? queueFocusSettled : listState !== "loading"
        }
      />

      {query.view === "queue" ? (
        <SkuMatchQueue
          onOpen={(id, triggerId) =>
            router.history.push(orderDetailPath(id, query, triggerId))
          }
          onSettled={() => setQueueFocusSettled(true)}
        />
      ) : (
        <>
          <OrderFilters query={query} onApply={push} />
          <OrderActionBar
            canWrite={canWrite}
            canTransferWrite={canTransferWrite}
            selectedCount={selected.size}
            bulkTarget={bulkTarget}
            sortField={query.sortField}
            sortDirection={query.sortDirection}
            busy={operationBusy}
            message={operationMessage}
            visibleColumns={visibleColumns}
            onBulkTarget={setBulkTarget}
            onBulk={() => void applyBulkStatus()}
            onClearSelection={() => {
              setSelected(new Set());
              setBulkTarget("");
            }}
            onVisibleColumnsChange={setVisibleColumns}
            onExport={() => void exportOrders()}
            onImport={(file) => void importOrders(file)}
            onOpenSelected={() => {
              const [id] = [...selected];
              if (id) {
                router.history.push(orderDetailPath(
                  id,
                  query,
                  "order-selected-action",
                ));
              }
            }}
            onSort={(sortField, sortDirection) =>
              push({ sortField, sortDirection, page: 0 })
            }
            onCreated={() => {
              setOperationMessage("订单已创建。");
              setListRefresh((current) => current + 1);
            }}
            onImported={() => setListRefresh((current) => current + 1)}
          />
          {canTransferRead && (
            <section className="order-list-utilities" aria-label="订单列表辅助设置">
              <OrderTransferHistory refreshKey={listRefresh} />
            </section>
          )}

          {listState === "loading" && <p className="order-list-state" aria-busy="true">正在加载订单…</p>}
          {listState === "error" && (
            <RetryableOrderError
              message={listMessage}
              retryLabel="重试加载订单"
              onRetry={() => setListRefresh((current) => current + 1)}
            />
          )}

          {listState === "ready" && orders.length === 0 && (
            <div className="compact-empty-state">
              <strong>没有符合条件的订单</strong>
              <span>请调整筛选条件后重新查询。</span>
            </div>
          )}

          {listState === "ready" && orders.length > 0 && (
            <>
              <OrderTable
                orders={orders}
                selected={selected}
                visibleColumns={visibleColumns}
                onSelectionChange={setSelected}
                onOpen={(id, triggerId) =>
                  router.history.push(orderDetailPath(id, query, triggerId))
                }
              />
              <OrderPagination
                page={query.page}
                totalElements={page.totalElements}
                totalPages={page.totalPages}
                size={query.size}
                onPageChange={(nextPage) => push({ page: nextPage })}
                onSizeChange={(size) => push({ page: 0, size })}
              />
            </>
          )}
        </>
      )}
    </section>
  );
}

function orderViewPath(view: OrderListQuery["view"], query: OrderListQuery): string {
  const normalized = {
    ...query,
    view,
    status: view === "orders" ? query.status : undefined,
    page: 0,
  };
  const serialized = new URLSearchParams(
    orderListPath(normalized).split("?", 2)[1],
  );
  serialized.delete("view");
  serialized.delete("page");
  serialized.delete("size");
  if (view === "orders" && serialized.size === 0) {
    return "/orders";
  }
  const params = new URLSearchParams();
  if (view === "queue") params.set("view", "queue");
  params.set("page", "0");
  if (query.size !== PAGE_SIZE) params.set("size", String(query.size));
  serialized.forEach((value, key) => params.set(key, value));
  return `/orders?${params}`;
}

function OrderDashboardOverview({
  canRead,
  shopId,
}: {
  canRead: boolean;
  shopId: string;
}) {
  const request = useRef(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [state, setState] = useState<DashboardState>("idle");
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!canRead) {
      request.current += 1;
      setSummary(null);
      setMessage("");
      setState("idle");
      return;
    }

    const id = ++request.current;
    setSummary(null);
    setMessage("");
    setState("loading");

    void orderCenterApi
      .dashboardSummary(shopId || undefined)
      .then((result) => {
        if (id !== request.current) return;
        setSummary(result);
        setState("ready");
      })
      .catch((error: unknown) => {
        if (id !== request.current) return;
        setMessage(safeOrderError(error));
        setState("error");
      });

    return () => {
      if (id === request.current) request.current += 1;
    };
  }, [canRead, refreshKey, shopId]);

  if (!canRead) return null;

  return (
    <section className="order-overview-panel" aria-labelledby="order-overview-title">
      <h2 className="sr-only" id="order-overview-title">订单概览</h2>

      {state === "loading" && <p className="order-list-state" aria-busy="true">正在加载概览…</p>}
      {state === "error" && (
        <div className="inline-alert" role="alert">
          <p>{message}</p>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => setRefreshKey((current) => current + 1)}
          >
            重试
          </button>
        </div>
      )}
      {state === "ready" && summary && (
        <DashboardMetrics
          summary={summary}
          scopeLabel={shopId
            ? "当前店铺的订单状态概览"
            : "全部可访问店铺的订单状态概览"}
          onRefresh={() => setRefreshKey((current) => current + 1)}
        />
      )}
    </section>
  );
}

function DashboardMetrics({
  summary,
  scopeLabel,
  onRefresh,
}: {
  summary: DashboardSummary;
  scopeLabel: string;
  onRefresh: () => void;
}) {
  return (
    <div className="order-overview-supporting-bar">
      <dl className="order-overview-supporting">
        <div>
          <dt>可编辑订单</dt>
          <dd>{summary.editableOrders}</dd>
        </div>
        <div>
          <dt>未匹配明细</dt>
          <dd>{summary.unmatchedLines}</dd>
        </div>
        <div>
          <dt>最早未匹配下单时间</dt>
          <dd>
            <OrderDateTime
              value={summary.oldestUnmatchedPlacedAt}
              missingLabel="暂无"
            />
          </dd>
        </div>
      </dl>
      <button
        aria-label={`刷新${scopeLabel}`}
        className="button button-secondary order-overview-refresh"
        title={scopeLabel}
        type="button"
        onClick={onRefresh}
      >
        <RefreshCw aria-hidden="true" size={14} />
        刷新
      </button>
    </div>
  );
}

function SkuMatchQueue({
  onOpen,
  onSettled,
}: {
  onOpen: (id: string, triggerId: string) => void;
  onSettled: () => void;
}) {
  const router = useRouter();
  const search = useRouterState({
    select: (state) => state.location.searchStr,
  });
  const params = new URLSearchParams(search);
  const shopId = isUuid(params.get("shopId") ?? "")
    ? (params.get("shopId") ?? "")
    : "";
  const keyword = (params.get("keyword") ?? "").slice(0, MAX_KEYWORD_LENGTH);
  const page = Math.max(0, Math.min(MAX_PAGE, Number(params.get("page")) || 0));
  const requestedSize = Number(params.get("size"));
  const size = PAGE_SIZES.includes(requestedSize as (typeof PAGE_SIZES)[number])
    ? requestedSize : PAGE_SIZE;
  const request = useRef(0);
  const [items, setItems] = useState<SkuMatchQueueItem[]>([]);
  const [state, setState] = useState<ListState>("loading");
  const [message, setMessage] = useState("");
  const [totalPages, setTotalPages] = useState(0);
  const [totalElements, setTotalElements] = useState(0);
  const [retryKey, setRetryKey] = useState(0);
  const directoryRequest = useRef(0);
  const [shops, setShops] = useState<TenantShop[]>([]);
  const [directoryLoading, setDirectoryLoading] = useState(true);
  const [directoryWarning, setDirectoryWarning] = useState("");
  const [directoryReload, setDirectoryReload] = useState(0);
  useEffect(() => {
    const id = ++directoryRequest.current;
    setDirectoryLoading(true);
    setDirectoryWarning("");
    void listAllDirectoryItems(DIRECTORY_PAGE_SIZE, (page) =>
      shopCenterApi.listShops({
        includeArchived: true,
        page,
        size: DIRECTORY_PAGE_SIZE,
      })
    )
      .then((items) => {
        if (id === directoryRequest.current) {
          setShops(items);
        }
      })
      .catch(() => {
        if (id === directoryRequest.current) {
          setShops([]);
          setDirectoryWarning(
            "店铺目录暂时不可用；已保留已选店铺。",
          );
        }
      })
      .finally(() => {
        if (id === directoryRequest.current) {
          setDirectoryLoading(false);
        }
      });
    return () => {
      if (id === directoryRequest.current) directoryRequest.current += 1;
    };
  }, [directoryReload]);
  useEffect(() => {
    if (state !== "loading") onSettled();
  }, [onSettled, state]);
  useEffect(() => {
    const id = ++request.current;
    setState("loading");
    void orderCenterApi
      .listSkuMatchQueue({
        shopId: shopId || undefined,
        keyword: keyword || undefined,
        page,
        size,
      })
      .then((result) => {
        if (id === request.current) {
          if (
            page > 0 &&
            result.items.length === 0 &&
            result.totalPages <= page
          ) {
            navigate(page - 1, size);
            return;
          }
          setItems(result.items);
          setTotalPages(result.totalPages);
          setTotalElements(result.totalElements);
          setState("ready");
        }
      })
      .catch((error) => {
        if (id === request.current) {
          setMessage(safeOrderError(error));
          setState("error");
        }
      });
    return () => {
      request.current += 1;
    };
  }, [shopId, keyword, page, size, retryKey]);
  const navigate = (nextPage: number, nextSize = size) => {
    const next = new URLSearchParams({
      view: "queue",
      page: String(nextPage),
    });
    if (nextSize !== PAGE_SIZE) next.set("size", String(nextSize));
    if (shopId) next.set("shopId", shopId);
    if (keyword) next.set("keyword", keyword);
    router.history.push(`/orders?${next}`);
  };
  const shopDirectory = new Map(shops.map((shop) => [shop.id, shop]));
  return (
    <section className="order-list-panel" aria-labelledby="sku-queue-title">
      <div className="order-list-panel-heading">
        <div>
          <h2 id="sku-queue-title">SKU 匹配队列</h2>
          <p>集中处理当前未匹配库存 SKU 的订单明细。</p>
        </div>
        {state === "ready" && <span>共 {totalElements} 条待处理明细</span>}
      </div>
      <form
        className="order-filter-bar order-filter-panel erp-filter-panel"
        aria-label="SKU 匹配队列筛选"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const next = new URLSearchParams({ view: "queue", page: "0" });
          if (size !== PAGE_SIZE) next.set("size", String(size));
          const nextShop = String(form.get("shopId") ?? "");
          const nextKeyword = String(form.get("keyword") ?? "").slice(
            0,
            MAX_KEYWORD_LENGTH,
          );
          if (isUuid(nextShop)) next.set("shopId", nextShop);
          if (nextKeyword) next.set("keyword", nextKeyword);
          router.history.push(`/orders?${next}`);
        }}
      >
        <div className="erp-filter-row order-quick-filter-row">
          <span className="erp-filter-label">快捷筛选：</span>
          <div className="erp-filter-options order-quick-filter-options">
            <label htmlFor="queue-shop-id">
              店铺
              <select id="queue-shop-id" name="shopId" defaultValue={shopId}>
                <option value="">全部店铺</option>
                {shopId &&
                  !shops.some((shop) => shop.id === shopId) && (
                    <option value={shopId}>当前所选店铺</option>
                  )}
                {shops.map((shop) => (
                  <option key={shop.id} value={shop.id}>
                    {shopDisplayName(shop)} · {shop.externalShopRef}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <div className="erp-filter-row erp-filter-search-row order-search-row">
          <span className="erp-filter-label">搜索内容：</span>
          <input
            name="keyword"
            aria-label="关键字"
            placeholder="输入订单号、商品标题或外部引用"
            defaultValue={keyword}
          />
          <button className="button button-primary" type="submit">查询</button>
          <button
            className="button button-secondary"
            type="button"
            onClick={() =>
              router.history.push("/orders?view=queue&page=0")
            }
          >
            清空筛选
          </button>
        </div>
        {directoryLoading && (
          <span className="toolbar-note" aria-busy="true">
            正在加载店铺目录…
          </span>
        )}
        {directoryWarning && (
          <span className="toolbar-note" role="status">
            {directoryWarning}
            <button
              className="text-button"
              type="button"
              disabled={directoryLoading}
              onClick={() => setDirectoryReload((value) => value + 1)}
            >重试店铺目录</button>
          </span>
        )}
      </form>
      {state === "loading" && <p className="order-list-state" aria-busy="true">正在加载匹配队列…</p>}
      {state === "error" && (
        <RetryableOrderError
          message={message}
          retryLabel="重试加载匹配队列"
          onRetry={() => setRetryKey((current) => current + 1)}
        />
      )}
      {state === "ready" && items.length === 0 && (
        <div className="compact-empty-state">
          <strong>没有待匹配的 SKU 明细</strong>
          <span>当前筛选条件下暂无需要处理的订单明细。</span>
        </div>
      )}
      {state === "ready" && items.length > 0 && (
        <div className="order-table-shell">
          <div className="shop-table-scroll">
            <table className="shop-table">
              <thead>
                <tr>
                  <th>订单号</th>
                  <th>店铺</th>
                  <th>下单时间</th>
                  <th>明细编号</th>
                  <th>商品标题</th>
                  <th>外部引用</th>
                  <th>匹配状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.lineId}>
                    <td>{item.externalOrderRef}</td>
                    <td>
                      {shopDirectory.get(item.shopId) ? shopDisplayName(shopDirectory.get(item.shopId)!) :
                        item.shopId}
                      <small>
                        {shopDirectory.get(item.shopId)?.externalShopRef ??
                          item.shopId}
                      </small>
                    </td>
                    <td>
                      <OrderDateTime value={item.placedAt} />
                    </td>
                    <td>{item.externalLineRef}</td>
                    <td>{item.titleSnapshot}</td>
                    <td>
                      {item.externalListingRef || "—"} / {item.externalVariantRef || "—"}
                    </td>
                    <td>{skuMatchSourceLabel(item.skuMatchSource)}</td>
                    <td>
                      <button
                        className="text-button"
                        type="button"
                        id={queueOrderDetailTriggerId(item.orderId, item.lineId)}
                        onClick={() =>
                          onOpen(
                            item.orderId,
                            queueOrderDetailTriggerId(item.orderId, item.lineId),
                          )
                        }
                      >
                        查看详情
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <OrderPagination
            page={page}
            size={size}
            totalPages={totalPages}
            onPageChange={(nextPage) => navigate(nextPage)}
            onSizeChange={(nextSize) => navigate(0, nextSize)}
          />
        </div>
      )}
    </section>
  );
}

type OrderFilterOptions = {
  platforms: PlatformCatalogEntry[];
  shops: TenantShop[];
  warehouses: Warehouse[];
  members: Member[];
  locations: WarehouseLocation[];
  loading: boolean;
  warning: string;
  retry: () => void;
};

function useOrderFilterOptions(warehouseId: string): OrderFilterOptions {
  const request = useRef(0);
  const locationRequest = useRef(0);
  const [options, setOptions] = useState<
    Omit<OrderFilterOptions, "locations" | "retry">
  >({
    platforms: [],
    shops: [],
    warehouses: [],
    members: [],
    loading: true,
    warning: "",
  });
  const [locations, setLocations] = useState<WarehouseLocation[]>([]);
  const [locationWarning, setLocationWarning] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const id = ++request.current;
    setOptions((current) => ({ ...current, loading: true, warning: "" }));
    void Promise.allSettled([
      listAllDirectoryItems(DIRECTORY_PAGE_SIZE, (page) => shopCenterApi.listPlatforms({
        includeArchived: false,
        page,
        size: DIRECTORY_PAGE_SIZE,
      })),
      listAllDirectoryItems(DIRECTORY_PAGE_SIZE, (page) => shopCenterApi.listShops({
        includeArchived: true,
        page,
        size: DIRECTORY_PAGE_SIZE,
      })),
      listAllDirectoryItems(DIRECTORY_PAGE_SIZE, (page) =>
        warehouseCenterApi.listWarehouses({
          page,
          size: DIRECTORY_PAGE_SIZE,
        })
      ),
      listAllDirectoryItems(MEMBER_DIRECTORY_PAGE_SIZE, (page) => iamAdminApi.listMembers({
        status: "ACTIVE",
        page,
        size: MEMBER_DIRECTORY_PAGE_SIZE,
      })),
    ]).then(([platforms, shops, warehouses, members]) => {
      if (id !== request.current) return;
      const failed = [platforms, shops, warehouses, members].filter(
        (result) => result.status === "rejected",
      ).length;
      setOptions({
        platforms: platforms.status === "fulfilled" ? platforms.value : [],
        shops: shops.status === "fulfilled" ? shops.value : [],
        warehouses: warehouses.status === "fulfilled" ? warehouses.value : [],
        members: members.status === "fulfilled" ? members.value : [],
        loading: false,
        warning:
          failed === 0
            ? ""
            : "部分筛选项暂时不可用；已保留已选条件。",
      });
    });
    return () => {
      if (id === request.current) request.current += 1;
    };
  }, [reload]);

  useEffect(() => {
    if (!warehouseId) {
      locationRequest.current += 1;
      setLocations([]);
      setLocationWarning("");
      return;
    }
    const id = ++locationRequest.current;
    setLocationWarning("");
    void listAllDirectoryItems(DIRECTORY_PAGE_SIZE, (page) => warehouseCenterApi
      .listLocations(warehouseId, { page, size: DIRECTORY_PAGE_SIZE }))
      .then((items) => {
        if (id === locationRequest.current) setLocations(items);
      })
      .catch(() => {
        if (id === locationRequest.current) {
          setLocations([]);
          setLocationWarning("当前仓库的仓位目录不可用。");
        }
      });
    return () => {
      if (id === locationRequest.current) locationRequest.current += 1;
    };
  }, [warehouseId, reload]);

  return {
    ...options,
    locations,
    warning: [options.warning, locationWarning].filter(Boolean).join(" "),
    retry: () => setReload((value) => value + 1),
  };
}

const conditionFieldLabels: Record<OrderConditionField, string> = {
  ORDER_NUMBER: "订单号",
  SALES_RECORD_NUMBER: "销售记录号",
  SHOPPING_CART_REFERENCE: "购物车号",
  CUSTOMER_ID: "客户 ID",
  CUSTOMER_CODE: "客户代码",
  RECIPIENT_NAME: "收件人",
  RECIPIENT_EMAIL: "收件邮箱",
  RECIPIENT_PHONE: "收件电话",
  POSTAL_CODE: "邮编",
  PROVINCE: "省 / 州",
  CITY: "城市",
  TRACKING_REFERENCE: "物流跟踪号",
  PLATFORM_STATUS: "平台状态",
  PLATFORM_SKU: "平台 SKU",
  INVENTORY_SKU: "库存 SKU",
  PRODUCT_NAME: "商品名称",
  SUPPLIER_REFERENCE: "供应商",
  ORDER_REMARK: "订单备注",
  EXTENDED_ATTRIBUTE: "扩展属性",
};

const conditionOperatorLabels: Record<OrderConditionOperator, string> = {
  EQUALS: "等于",
  NOT_EQUALS: "不等于",
  CONTAINS: "包含",
  NOT_CONTAINS: "不包含",
  IS_EMPTY: "为空",
  IS_NOT_EMPTY: "不为空",
};

const timeFieldLabels: Record<OrderTimeField, string> = {
  PLACED: "下单时间",
  PAID: "付款时间",
  SHIPPED: "发货时间",
  PRINTED: "打印时间",
  CREATED: "创建时间",
  PLATFORM_RETURNED: "平台返回时间",
  EXCEPTION_REVIEWED: "异常审核时间",
  CANCELLED: "作废时间",
  HANDED_OVER: "仓库交接时间",
  PLATFORM_SPECIFIED_HANDOVER: "平台指定交接时间",
  PLATFORM_LABEL_REQUESTED: "平台面单申请时间",
  DELIVERY_DEADLINE: "妥投截止时间",
  DELIVERED: "妥投时间",
};

const orderSortFieldLabels: Record<OrderSortField, string> = {
  PLACED_AT: "下单时间",
  PAID_AT: "付款时间",
  CREATED_AT: "创建时间",
  UPDATED_AT: "更新时间",
  SHIP_BY_AT: "最晚发货时间",
  TOTAL_AMOUNT: "订单金额",
  EXTERNAL_ORDER_REF: "订单号",
};

const advancedOrderFilterKeys = [
  "platformId",
  "locationId",
  "skuKeyword",
  "paymentStatus",
  "platformStatus",
  "countryCode",
  "trackingStatus",
  "currency",
  "printed",
  "reshipment",
  "fixedCategory",
  "customCategory",
  "customerCategory",
  "logisticsChannel",
  "pickerUserId",
  "shipperUserId",
  "purchaserUserId",
  "managerUserId",
  "supplierReference",
  "parentProductCategory",
  "childProductCategory",
  "productStatus",
  "extendedAttribute",
  "minProductKinds",
  "maxProductKinds",
  "minAmountMinor",
  "maxAmountMinor",
  "minWeightGrams",
  "maxWeightGrams",
  "placedFrom",
  "placedTo",
  "paidFrom",
  "paidTo",
  "conditionField1",
  "conditionOperator1",
  "conditionValue1",
  "conditionField2",
  "conditionOperator2",
  "conditionValue2",
  "conditionLogic",
  "timeField1",
  "timeFrom1",
  "timeTo1",
  "timeField2",
  "timeFrom2",
  "timeTo2",
  "sortField",
  "sortDirection",
] as const satisfies ReadonlyArray<keyof OrderListQuery>;

function clearAdvancedOrderFilters(query: OrderListQuery): OrderListQuery {
  const defaults = parseOrderQuery("");
  const cleared = { ...query };
  advancedOrderFilterKeys.forEach((key) => {
    Object.assign(cleared, { [key]: defaults[key] });
  });
  return cleared;
}

function orderAdvancedFilterCount(query: OrderListQuery) {
  return [
    query.platformId,
    query.locationId,
    query.skuKeyword,
    query.paymentStatus,
    query.platformStatus,
    query.countryCode,
    query.trackingStatus,
    query.currency,
    query.printed !== undefined,
    query.reshipment !== undefined,
    query.fixedCategory,
    query.customCategory,
    query.customerCategory,
    query.logisticsChannel,
    query.supplierReference,
    query.parentProductCategory,
    query.childProductCategory,
    query.productStatus,
    query.extendedAttribute,
    query.pickerUserId,
    query.shipperUserId,
    query.purchaserUserId,
    query.managerUserId,
    query.minProductKinds !== undefined,
    query.maxProductKinds !== undefined,
    query.minAmountMinor !== undefined,
    query.maxAmountMinor !== undefined,
    query.minWeightGrams !== undefined,
    query.maxWeightGrams !== undefined,
    query.placedFrom || query.placedTo,
    query.paidFrom || query.paidTo,
    query.conditionField1,
    query.conditionField2,
    query.timeField1,
    query.timeField2,
    query.sortField !== "PLACED_AT" || query.sortDirection !== "DESC",
  ].filter(Boolean).length;
}

function dateTimeLocalValue(value: string) {
  if (!value) return "";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  const date = new Date(timestamp);
  return new Date(timestamp - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

function dateTimeIsoValue(value: string) {
  if (!value) return "";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

function OrderFilters({
  query,
  onApply,
}: {
  query: OrderListQuery;
  onApply: (patch: Partial<OrderListQuery>) => void;
}) {
  const [draft, setDraft] = useState(query);
  const [conditionBuilderOpen, setConditionBuilderOpen] = useState(Boolean(
    query.conditionField1 || query.conditionField2,
  ));
  const [timeBuilderOpen, setTimeBuilderOpen] = useState(Boolean(
    query.timeField1 || query.timeField2,
  ));
  const options = useOrderFilterOptions(draft.warehouseId);

  useEffect(() => {
    setDraft(query);
  }, [query]);

  useEffect(() => {
    if (query.conditionField1 || query.conditionField2) {
      setConditionBuilderOpen(true);
    }
    if (query.timeField1 || query.timeField2) setTimeBuilderOpen(true);
  }, [
    query.conditionField1,
    query.conditionField2,
    query.timeField1,
    query.timeField2,
  ]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onApply({
      ...draft,
      shopId: isUuid(draft.shopId) ? draft.shopId : "",
      platformId: isUuid(draft.platformId) ? draft.platformId : "",
      warehouseId: isUuid(draft.warehouseId) ? draft.warehouseId : "",
      locationId: isUuid(draft.locationId) ? draft.locationId : "",
      status: draft.status || undefined,
      page: 0,
    });
  };
  const set = <K extends keyof OrderListQuery>(
    key: K,
    value: OrderListQuery[K],
  ) => setDraft((current) => ({ ...current, [key]: value }));
  const optionalNumber = (value: string) =>
    value === "" ? undefined : Number(value);
  const optionalBoolean = (value: string) =>
    value === "" ? undefined : value === "true";
  const advancedFilterCount = orderAdvancedFilterCount(draft);
  const hasActiveListFilters = Boolean(
    draft.shopId ||
    draft.warehouseId ||
    draft.status ||
    draft.keyword ||
    advancedFilterCount,
  );
  const resetListFilters = () => {
    const defaults = parseOrderQuery("");
    onApply({
      ...defaults,
      view: "orders",
      stage: query.stage,
      size: query.size,
      page: 0,
    });
  };
  const setConditionField = (
    index: 1 | 2,
    field: OrderConditionField | undefined,
  ) => setDraft((current) => index === 1
    ? {
        ...current,
        conditionField1: field,
        ...(!field && {
          conditionOperator1: undefined,
          conditionValue1: "",
        }),
      }
    : {
        ...current,
        conditionField2: field,
        ...(!field && {
          conditionOperator2: undefined,
          conditionValue2: "",
        }),
      });
  const setTimeField = (
    index: 1 | 2,
    field: OrderTimeField | undefined,
  ) => setDraft((current) => index === 1
    ? {
        ...current,
        timeField1: field,
        ...(!field && { timeFrom1: "", timeTo1: "" }),
      }
    : {
        ...current,
        timeField2: field,
        ...(!field && { timeFrom2: "", timeTo2: "" }),
      });

  return (
    <form
      className="order-filter-bar order-filter-panel erp-filter-panel"
      aria-label="订单列表筛选"
      onSubmit={submit}
    >
      <div className="order-search-toolbar">
          <label className="order-search-control" htmlFor="shop-id">
            <span className="sr-only">店铺</span>
            <select
              aria-label="店铺"
              id="shop-id"
              name="shopId"
              value={draft.shopId}
              onChange={(event) => set("shopId", event.target.value)}
            >
              <option value="">全部店铺</option>
              {draft.shopId &&
                !options.shops.some((shop) => shop.id === draft.shopId) && (
                  <option value={draft.shopId}>当前所选店铺</option>
                )}
              {options.shops.map((shop) => (
                <option key={shop.id} value={shop.id}>
                  {shopDisplayName(shop)} · {shop.externalShopRef}
                </option>
              ))}
            </select>
          </label>
          <label className="order-search-control" htmlFor="order-warehouse">
            <span className="sr-only">仓库</span>
            <select
              aria-label="仓库"
              id="order-warehouse"
              value={draft.warehouseId}
              onChange={(event) => {
                set("warehouseId", event.target.value);
                set("locationId", "");
              }}
            >
              <option value="">全部仓库</option>
              {draft.warehouseId &&
                !options.warehouses.some(
                  (warehouse) => warehouse.id === draft.warehouseId,
                ) && <option value={draft.warehouseId}>当前所选仓库</option>}
              {options.warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.businessCode} · {warehouse.name}
                </option>
              ))}
            </select>
          </label>
          <label className="order-search-control" htmlFor="order-status">
            <span className="sr-only">订单状态</span>
            <select
              aria-label="订单状态"
              id="order-status"
              name="status"
              value={draft.status ?? ""}
              onChange={(event) =>
                set("status", event.target.value
                  ? event.target.value as OrderStatus : undefined)
              }
            >
              <option value="">全部状态</option>
              {orderStatuses.map((status) => (
                <option key={status} value={status}>
                  {orderStatusLabel(status)}
                </option>
              ))}
            </select>
          </label>
          <label className="order-search-control order-keyword-control" htmlFor="order-keyword">
            <span className="sr-only">关键字</span>
            <input
              id="order-keyword"
              name="keyword"
              aria-label="关键字"
              placeholder="搜索订单号、物流单号、交易号或内部单号"
              value={draft.keyword}
              onChange={(event) =>
                set("keyword", event.target.value.slice(0, MAX_KEYWORD_LENGTH))
              }
            />
          </label>
        <button className="button button-primary" type="submit">查询</button>
      <AdvancedFilterPanel
        className="order-advanced-filter-panel"
        activeCount={advancedFilterCount}
        appliedKey={JSON.stringify(query)}
        actions={(
          <>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => {
                setDraft((current) => clearAdvancedOrderFilters(current));
                setConditionBuilderOpen(false);
                setTimeBuilderOpen(false);
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
          title="订单属性"
          description="按平台、仓位、支付和履约状态筛选。"
        >
          <div className="advanced-filter-grid">
          <label>
            平台
            <select
              value={draft.platformId}
              onChange={(event) => set("platformId", event.target.value)}
            >
              <option value="">全部平台</option>
              {draft.platformId &&
                !options.platforms.some(
                  (platform) => platform.id === draft.platformId,
                ) && <option value={draft.platformId}>当前所选平台</option>}
              {options.platforms.map((platform) => (
                <option key={platform.id} value={platform.id}>
                  {platform.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            仓位
            <select
              disabled={!draft.warehouseId}
              value={draft.locationId}
              onChange={(event) => set("locationId", event.target.value)}
            >
              <option value="">全部仓位</option>
              {draft.locationId &&
                !options.locations.some(
                  (location) => location.id === draft.locationId,
                ) && <option value={draft.locationId}>当前所选仓位</option>}
              {options.locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.businessCode} · {location.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            SKU / 商品
            <input
              maxLength={MAX_KEYWORD_LENGTH}
              value={draft.skuKeyword}
              onChange={(event) => set("skuKeyword", event.target.value)}
            />
          </label>
          <label>
            付款状态
            <select
              value={draft.paymentStatus}
              onChange={(event) => set(
                "paymentStatus",
                event.target.value as OrderListQuery["paymentStatus"],
              )}
            >
              <option value="">全部付款状态</option>
              <option value="UNPAID">未付款</option>
              <option value="PAID">已付款</option>
              <option value="PARTIALLY_REFUNDED">部分退款</option>
              <option value="REFUNDED">已退款</option>
            </select>
          </label>
          <label>
            平台状态
            <input
              maxLength={64}
              value={draft.platformStatus}
              onChange={(event) => set("platformStatus", event.target.value)}
            />
          </label>
          <label>
            国家代码
            <input
              maxLength={2}
              value={draft.countryCode}
              onChange={(event) =>
                set("countryCode", event.target.value.toUpperCase())
              }
            />
          </label>
          <label>
            物流跟踪状态
            <input
              maxLength={32}
              value={draft.trackingStatus}
              onChange={(event) => set("trackingStatus", event.target.value)}
            />
          </label>
          <label>
            物流渠道
            <input
              aria-label="筛选物流"
              maxLength={80}
              placeholder="全部物流"
              value={draft.logisticsChannel}
              onChange={(event) => set("logisticsChannel", event.target.value)}
            />
          </label>
          <label>
            币种
            <CurrencyCodeInput
              listId="order-filter-currency-options"
              value={draft.currency}
              onChange={(event) =>
                set("currency", event.target.value.toUpperCase())
              }
            />
          </label>
          <label>
            打印状态
            <select
              value={draft.printed === undefined ? "" : String(draft.printed)}
              onChange={(event) => set("printed", optionalBoolean(event.target.value))}
            >
              <option value="">全部打印状态</option>
              <option value="true">已打印</option>
              <option value="false">未打印</option>
            </select>
          </label>
          <label>
            补发订单
            <select
              value={draft.reshipment === undefined ? "" : String(draft.reshipment)}
              onChange={(event) => set("reshipment", optionalBoolean(event.target.value))}
            >
              <option value="">全部补发状态</option>
              <option value="true">是</option>
              <option value="false">否</option>
            </select>
          </label>
          </div>
        </AdvancedFilterSection>
        <AdvancedFilterSection
          title="商品与分类"
          description="按 SKU、供应商、商品目录和内部分类筛选。"
        >
          <div className="advanced-filter-grid">
          {([
            ["fixedCategory", "固定分类", 80],
            ["customCategory", "自定义分类", 80],
            ["customerCategory", "客户分类", 80],
            ["supplierReference", "供应商", 160],
            ["parentProductCategory", "父商品目录", 120],
            ["childProductCategory", "子商品目录", 120],
            ["productStatus", "商品状态", 40],
            ["extendedAttribute", "扩展属性", 160],
          ] as const).map(([key, label, maxLength]) => (
            <label key={key}>
              {label}
              <input
                maxLength={maxLength}
                value={draft[key]}
                onChange={(event) => set(key, event.target.value)}
              />
            </label>
          ))}
          </div>
        </AdvancedFilterSection>
        <AdvancedFilterSection
          title="业务人员"
          description="按订单当前环节的负责人筛选。"
        >
          <div className="advanced-filter-grid">
          {([
            ["pickerUserId", "配货员"],
            ["shipperUserId", "发货员"],
            ["purchaserUserId", "采购员"],
            ["managerUserId", "订单负责人"],
          ] as const).map(([key, label]) => (
            <label key={key}>
              {label}
              <select
                value={draft[key]}
                onChange={(event) => set(key, event.target.value)}
              >
                <option value="">全部人员</option>
                {draft[key] &&
                  !options.members.some(
                    (member) => member.id === draft[key],
                  ) && <option value={draft[key]}>当前所选人员</option>}
                {options.members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.displayName} · {member.email ?? member.username}
                  </option>
                ))}
              </select>
            </label>
          ))}
          </div>
        </AdvancedFilterSection>
        <AdvancedFilterSection
          title="数量、金额与时间"
          description="使用范围条件筛选商品数量、金额、重量和订单时间。"
        >
          <div className="advanced-filter-grid">
          <label>
            最少商品种类
            <input
              min="1"
              type="number"
              value={draft.minProductKinds ?? ""}
              onChange={(event) =>
                set("minProductKinds", optionalNumber(event.target.value))
              }
            />
          </label>
          <label>
            最多商品种类
            <input
              min="1"
              type="number"
              value={draft.maxProductKinds ?? ""}
              onChange={(event) =>
                set("maxProductKinds", optionalNumber(event.target.value))
              }
            />
          </label>
          <label>
            最低金额（按所选币种计价）
            <input
              min="0"
              type="number"
              value={draft.minAmountMinor ?? ""}
              onChange={(event) => set("minAmountMinor", optionalNumber(event.target.value))}
            />
          </label>
          <label>
            最高金额（按所选币种计价）
            <input
              min="0"
              type="number"
              value={draft.maxAmountMinor ?? ""}
              onChange={(event) => set("maxAmountMinor", optionalNumber(event.target.value))}
            />
          </label>
          <label>
            最低重量（克）
            <input
              min="0"
              step="0.001"
              type="number"
              value={draft.minWeightGrams ?? ""}
              onChange={(event) => set("minWeightGrams", optionalNumber(event.target.value))}
            />
          </label>
          <label>
            最高重量（克）
            <input
              min="0"
              step="0.001"
              type="number"
              value={draft.maxWeightGrams ?? ""}
              onChange={(event) => set("maxWeightGrams", optionalNumber(event.target.value))}
            />
          </label>
          {([
            ["placedFrom", "下单时间起"],
            ["placedTo", "下单时间止"],
            ["paidFrom", "付款时间起"],
            ["paidTo", "付款时间止"],
          ] as const).map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                type="datetime-local"
                step="60"
                value={dateTimeLocalValue(draft[key])}
                onChange={(event) =>
                  set(key, dateTimeIsoValue(event.target.value))}
              />
            </label>
          ))}
          </div>
        </AdvancedFilterSection>
        <AdvancedFilterSection
          title="自定义条件"
          description="仅在常用筛选无法满足时使用，可组合两个字段或两个时间条件。"
          className="advanced-filter-section-wide"
        >
          <details
            className="advanced-filter-builder"
            open={conditionBuilderOpen}
            onToggle={(event) =>
              setConditionBuilderOpen(event.currentTarget.open)}
          >
            <summary>
              组合条件
              {(draft.conditionField1 || draft.conditionField2) && (
                <span className="advanced-filter-count">
                  {[draft.conditionField1, draft.conditionField2].filter(Boolean).length} 项
                </span>
              )}
            </summary>
            <div>
            {([1, 2] as const).map((index) => {
              const fieldKey = `conditionField${index}` as const;
              const operatorKey = `conditionOperator${index}` as const;
              const valueKey = `conditionValue${index}` as const;
              const noValue = draft[operatorKey] === "IS_EMPTY" ||
                draft[operatorKey] === "IS_NOT_EMPTY";
              return (
                <div className="advanced-filter-condition-row" key={index}>
                  <label>
                    条件 {index}
                    <select
                      value={draft[fieldKey] ?? ""}
                      onChange={(event) => setConditionField(
                        index,
                        event.target.value
                          ? event.target.value as OrderConditionField
                          : undefined,
                      )}
                    >
                      <option value="">不使用</option>
                      {conditionFields.map((field) => (
                        <option key={field} value={field}>
                          {conditionFieldLabels[field]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    匹配方式
                    <select
                      disabled={!draft[fieldKey]}
                      value={draft[operatorKey] ?? ""}
                      onChange={(event) =>
                        set(
                          operatorKey,
                          event.target.value
                            ? event.target.value as OrderConditionOperator
                            : undefined,
                        )
                      }
                    >
                      <option value="">请选择</option>
                      {conditionOperators.map((operator) => (
                        <option key={operator} value={operator}>
                          {conditionOperatorLabels[operator]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    查询值
                    <input
                      disabled={!draft[fieldKey] || noValue}
                      maxLength={200}
                      value={draft[valueKey]}
                      onChange={(event) =>
                        set(valueKey, event.target.value)
                      }
                    />
                  </label>
                </div>
              );
            })}
            <label className="advanced-filter-field">
              条件关系
              <select
                value={draft.conditionLogic}
                onChange={(event) =>
                  set(
                    "conditionLogic",
                    event.target.value as OrderConditionLogic,
                  )
                }
              >
                <option value="AND">同时满足（且）</option>
                <option value="OR">满足任一（或）</option>
              </select>
            </label>
            </div>
          </details>
          <details
            className="advanced-filter-builder"
            open={timeBuilderOpen}
            onToggle={(event) => setTimeBuilderOpen(event.currentTarget.open)}
          >
            <summary>
              时间条件
              {(draft.timeField1 || draft.timeField2) && (
                <span className="advanced-filter-count">
                  {[draft.timeField1, draft.timeField2].filter(Boolean).length} 项
                </span>
              )}
            </summary>
            <div>
            {([1, 2] as const).map((index) => {
              const fieldKey = `timeField${index}` as const;
              const fromKey = `timeFrom${index}` as const;
              const toKey = `timeTo${index}` as const;
              return (
                <div className="advanced-filter-condition-row" key={index}>
                  <label>
                    时间 {index}
                    <select
                      value={draft[fieldKey] ?? ""}
                      onChange={(event) => setTimeField(
                        index,
                        event.target.value
                          ? event.target.value as OrderTimeField
                          : undefined,
                      )}
                    >
                      <option value="">不使用</option>
                      {orderTimeFields.map((field) => (
                        <option key={field} value={field}>
                          {timeFieldLabels[field]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    起始时间
                    <input
                      disabled={!draft[fieldKey]}
                      type="datetime-local"
                      step="60"
                      value={dateTimeLocalValue(draft[fromKey])}
                      onChange={(event) =>
                        set(fromKey, dateTimeIsoValue(event.target.value))}
                    />
                  </label>
                  <label>
                    结束时间
                    <input
                      disabled={!draft[fieldKey]}
                      type="datetime-local"
                      step="60"
                      value={dateTimeLocalValue(draft[toKey])}
                      onChange={(event) =>
                        set(toKey, dateTimeIsoValue(event.target.value))}
                    />
                  </label>
                </div>
              );
            })}
            </div>
          </details>
        </AdvancedFilterSection>
        <AdvancedFilterSection
          title="排序"
          description="默认按下单时间从新到旧排列。"
          className="advanced-filter-section-wide"
        >
          <div className="advanced-filter-grid advanced-filter-sort-grid">
          <label>
            排序字段
            <select
              value={draft.sortField}
              onChange={(event) =>
                set("sortField", event.target.value as OrderSortField)
              }
            >
              {orderSortFields.map((field) => (
                <option key={field} value={field}>
                  {orderSortFieldLabels[field]}
                </option>
              ))}
            </select>
          </label>
          <label>
            排序方向
            <select
              value={draft.sortDirection}
              onChange={(event) =>
                set(
                  "sortDirection",
                  event.target.value as "ASC" | "DESC",
                )
              }
            >
              <option value="DESC">降序</option>
              <option value="ASC">升序</option>
            </select>
          </label>
          </div>
        </AdvancedFilterSection>
      </AdvancedFilterPanel>
        {hasActiveListFilters && (
          <button
            className="text-button order-clear-filters"
            type="button"
            onClick={resetListFilters}
          >
            清除筛选
          </button>
        )}
      </div>
      {options.loading && <span className="toolbar-note" aria-busy="true">正在加载管理目录…</span>}
      {options.warning && (
        <span className="toolbar-note" role="status">
          {options.warning}
          <button
            className="text-button"
            type="button"
            disabled={options.loading}
            onClick={options.retry}
          >重试目录加载</button>
        </span>
      )}
    </form>
  );
}

function closeOrderActionMenu(element: HTMLElement) {
  element.closest("details")?.removeAttribute("open");
}

function OrderActionBar({
  canWrite,
  canTransferWrite,
  selectedCount,
  bulkTarget,
  sortField,
  sortDirection,
  busy,
  message,
  visibleColumns,
  onBulkTarget,
  onBulk,
  onClearSelection,
  onVisibleColumnsChange,
  onExport,
  onImport,
  onOpenSelected,
  onSort,
  onCreated,
  onImported,
}: {
  canWrite: boolean;
  canTransferWrite: boolean;
  selectedCount: number;
  bulkTarget: OrderStatus | "";
  sortField: OrderSortField;
  sortDirection: "ASC" | "DESC";
  busy: boolean;
  message: string;
  visibleColumns: OrderColumn[];
  onBulkTarget: (status: OrderStatus | "") => void;
  onBulk: () => void;
  onClearSelection: () => void;
  onVisibleColumnsChange: (columns: OrderColumn[]) => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onOpenSelected: () => void;
  onSort: (
    field: OrderSortField,
    direction: "ASC" | "DESC",
  ) => void;
  onCreated: () => void;
  onImported: () => void;
}) {
  const importInput = useRef<HTMLInputElement>(null);
  return (
    <section className="order-filter-bar order-action-bar" aria-label="订单处理操作">
      <div className="order-global-actions">
        <div className="order-global-actions-start">
          <ShopifyOrderCatalogPreviewPanel
            busy={busy}
            canImport={canWrite}
            onImported={onImported}
          />
        </div>
        <div className="order-global-actions-end">
          <details className="erp-action-menu">
            <summary className="button button-secondary">
              <ArrowUpDown size={15} aria-hidden="true" />
              排序
              <span className="order-action-summary-value">
                {orderSortFieldLabels[sortField]}
                {sortDirection === "ASC" ? " ↑" : " ↓"}
              </span>
            </summary>
            <div className="erp-action-menu-popover order-action-menu-popover">
              {orderSortFields.map((field) => (
                <button
                  aria-pressed={sortField === field}
                  key={field}
                  type="button"
                  onClick={(event) => {
                    closeOrderActionMenu(event.currentTarget);
                    onSort(
                      field,
                      field === sortField && sortDirection === "DESC"
                        ? "ASC"
                        : "DESC",
                    );
                  }}
                >
                  {orderSortFieldLabels[field]}
                  {sortField === field && (
                    <span aria-hidden="true">
                      {sortDirection === "ASC" ? " ↑" : " ↓"}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </details>
          <OrderColumnSettings
            visible={visibleColumns}
            onChange={onVisibleColumnsChange}
          />
          {canTransferWrite && (
            <details className="erp-action-menu">
              <summary className="button button-secondary"><ArrowDownUp size={15} aria-hidden="true" />导入 / 导出</summary>
              <div className="erp-action-menu-popover order-action-menu-popover">
                <button
                  disabled={busy}
                  type="button"
                  onClick={(event) => {
                    closeOrderActionMenu(event.currentTarget);
                    onExport();
                  }}
                >
                  导出订单明细（当前筛选）
                </button>
                <button
                  disabled={busy}
                  type="button"
                  onClick={(event) => {
                    closeOrderActionMenu(event.currentTarget);
                    importInput.current?.click();
                  }}
                >
                  订单导入（CSV）
                </button>
              </div>
              <input
                accept=".csv,text/csv"
                disabled={busy}
                hidden
                ref={importInput}
                type="file"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onImport(file);
                  event.target.value = "";
                }}
              />
            </details>
          )}
          {canWrite && <CreateOrderPanel busy={busy} onCreated={onCreated} />}
        </div>
      </div>
      {canWrite && selectedCount > 0 && (
        <div className="order-selection-actions" role="region" aria-label="已选订单批量操作">
          <strong>已选择 {selectedCount} 张订单</strong>
          <label className="order-bulk-target">
            <span>目标状态</span>
            <select
              aria-label="批量目标状态"
              disabled={busy}
              value={bulkTarget}
              onChange={(event) =>
                onBulkTarget(event.target.value as OrderStatus | "")
              }
            >
              <option value="">请选择</option>
              {orderStatuses.map((status) => (
                <option key={status} value={status}>
                  {orderStatusLabel(status)}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button button-primary"
            disabled={busy || !bulkTarget}
            type="button"
            onClick={onBulk}
          >
            <Layers3 size={15} aria-hidden="true" />
            批量变更
          </button>
          {selectedCount === 1 && (
            <button
              className="button button-secondary"
              id="order-selected-action"
              disabled={busy}
              type="button"
              onClick={onOpenSelected}
            >
              打开订单
            </button>
          )}
          <button
            className="text-button order-clear-selection"
            disabled={busy}
            type="button"
            onClick={onClearSelection}
          >
            清除选择
          </button>
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}

function ShopifyOrderCatalogPreviewPanel({
  busy,
  canImport,
  onImported,
}: {
  busy: boolean;
  canImport: boolean;
  onImported: () => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [shops, setShops] = useState<TenantShop[]>([]);
  const [shopId, setShopId] = useState("");
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState("");
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [limit, setLimit] = useState(50);
  const [historical, setHistorical] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [preview, setPreview] =
    useState<ShopifyOrderCatalogPreview | null>(null);
  const [selectedOrderRefs, setSelectedOrderRefs] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] =
    useState<ShopifyOrderCatalogImportResult | null>(null);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryWarning, setDirectoryWarning] = useState("");
  const [directoryReload, setDirectoryReload] = useState(0);
  const selectedShopRef = useRef("");

  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();
    return () => triggerRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setDirectoryLoading(true);
    setDirectoryWarning("");
    setMessage("");
    void Promise.all([
      listAllDirectoryItems(DIRECTORY_PAGE_SIZE, (page) =>
        shopCenterApi.listShops({
          includeArchived: false,
          page,
          size: DIRECTORY_PAGE_SIZE,
        }),
      ),
      listAllDirectoryItems(DIRECTORY_PAGE_SIZE, (page) =>
        shopCenterApi.listPlatforms({
          includeArchived: false,
          page,
          size: DIRECTORY_PAGE_SIZE,
        }),
      ),
    ])
      .then(([shopItems, platformItems]) => {
        if (!active) return;
        const platformMap = new Map(
          platformItems.map((platform) => [platform.id, platform]),
        );
        const items = shopItems.filter((shop) =>
          shop.status === "ACTIVE" &&
          platformMap.get(shop.platformId)?.code.trim().toUpperCase() === "SHOPIFY"
        );
        setShops(items);
        const current = selectedShopRef.current;
        const next = items.some((shop) => shop.id === current)
          ? current
          : items[0]?.id || "";
        selectedShopRef.current = next;
        setShopId(next);
        if (next !== current) {
          setPreview(null);
          setCursor("");
          setCursorHistory([]);
          setSelectedOrderRefs([]);
          setImportResult(null);
        }
      })
      .catch((error) => {
        if (!active) return;
        setShops([]);
        selectedShopRef.current = "";
        setShopId("");
        setPreview(null);
        setCursor("");
        setCursorHistory([]);
        setSelectedOrderRefs([]);
        setImportResult(null);
        setDirectoryWarning(safeOrderError(error));
      })
      .finally(() => {
        if (active) setDirectoryLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, directoryReload]);

  const resetPreview = () => {
    setCursor("");
    setCursorHistory([]);
    setPreview(null);
    setSelectedOrderRefs([]);
    setImportResult(null);
    setMessage("");
  };

  const previewOrders = async (
    targetCursor: string,
    targetHistory: string[],
  ) => {
    if (loading || directoryLoading || busy) return;
    if (!isUuid(shopId)) {
      setMessage("请先选择有效店铺。");
      return;
    }
    setLoading(true);
    setMessage("");
    setImportResult(null);
    try {
      const preflightMessage = await shopifyScopePreflight(
        shopId,
        historical ? ["write_orders", "read_all_orders"] : "write_orders",
        historical ? "读取 60 天以前的历史订单" : "读取订单",
      );
      if (preflightMessage) {
        setMessage(preflightMessage);
        setPreview(null);
        return;
      }
      const result = await orderCenterApi.previewShopifyCatalog({
        shopId,
        limit,
        cursor: targetCursor.trim() || undefined,
        query: query.trim() || undefined,
        historical,
      });
      setPreview(result);
      setCursor(targetCursor);
      setCursorHistory(targetHistory);
      setSelectedOrderRefs([]);
      if (result.connectionStatus !== "CONNECTED") {
        setMessage("Shopify 授权未连接，当前没有可预览订单。");
      }
    } catch (error) {
      setMessage(safeOrderError(error));
    } finally {
      setLoading(false);
    }
  };

  const importOrders = async () => {
    if (
      loading ||
      directoryLoading ||
      importing ||
      busy ||
      !isUuid(shopId) ||
      !canImport ||
      selectedOrderRefs.length === 0
    ) return;
    setImporting(true);
    setMessage("");
    setImportResult(null);
    try {
      const preflightMessage = await shopifyScopePreflight(
        shopId,
        historical ? ["write_orders", "read_all_orders"] : "write_orders",
        "导入订单到 ERP",
      );
      if (preflightMessage) {
        setMessage(preflightMessage);
        return;
      }
      const result = await orderCenterApi.importShopifyCatalog({
        shopId,
        limit,
        cursor: cursor.trim() || undefined,
        query: query.trim() || undefined,
        historical,
        externalOrderRefs: selectedOrderRefs,
      });
      setSelectedOrderRefs([]);
      setImportResult(result);
      setMessage(
        `订单导入完成：已导入 ${result.importedCount}，跳过 ${result.skippedCount}`,
      );
      if (result.importedCount > 0) {
        onImported();
      }
    } catch (error) {
      setMessage(safeOrderError(error));
    } finally {
      setImporting(false);
    }
  };

  const toggleOrderRef = (externalOrderRef: string, checked: boolean) => {
    setSelectedOrderRefs((current) => {
      if (checked) {
        return current.includes(externalOrderRef)
          ? current
          : [...current, externalOrderRef];
      }
      return current.filter((value) => value !== externalOrderRef);
    });
  };

  const rows = preview?.orders.flatMap((order) =>
    order.lineItems.map((line, lineIndex) => ({
      order,
      line,
      lineCount: order.lineItems.length,
      lineIndex,
    })),
  ) ?? [];
  const matchedLines = rows.filter(
    ({ line }) => line.matchStatus === "EXACT_SKU_MATCH",
  ).length;
  const selectedSet = new Set(selectedOrderRefs);
  const messageIsSuccess = Boolean(
    importResult && message.startsWith("订单导入完成"),
  );

  const closeDialog = () => {
    if (loading || importing) return;
    setOpen(false);
  };

  const onDialogKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && !loading && !importing) {
      event.preventDefault();
      closeDialog();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const elements = focusableElements(dialogRef.current);
    const first = elements[0];
    const last = elements.at(-1);
    if (!first || !last) {
      event.preventDefault();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <>
      <button
        className="button button-secondary"
        disabled={busy}
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
      >
        <CloudDownload size={15} aria-hidden="true" />
        Shopify 订单预览
      </button>
      {open && (
        <div className="dialog-backdrop" role="presentation">
          <section
            aria-labelledby="shopify-order-import-title"
            aria-modal="true"
            className="write-dialog shopify-order-import-dialog"
            ref={dialogRef}
            role="dialog"
            onKeyDown={onDialogKeyDown}
          >
            <header className="table-heading">
              <div>
                <h2 id="shopify-order-import-title">Shopify 订单预览与导入</h2>
                <p>先核对订单、收件地区、履约状态和 SKU 匹配，再选择性导入 ERP。</p>
              </div>
              <DialogCloseButton
                disabled={loading || importing}
                onClick={closeDialog}
                ref={closeButtonRef}
              />
            </header>

            <div className="shopify-order-boundary" role="note">
              <Eye size={19} aria-hidden="true" />
              <div>
                <strong>预览只读取 Shopify，不修改店铺订单</strong>
                <span>
                  应用已包含订单读取能力；
                  {canImport
                    ? "导入仅在明确确认后写入 ERP 本地订单。"
                    : "当前账号只有 ERP 订单读取权限，不显示导入操作。"}
                </span>
              </div>
            </div>

            <div className="detail-form shopify-order-controls">
              <label className="shopify-order-shop-field">
                来源店铺
                <select
                  aria-label="选择 Shopify 订单来源店铺"
                  disabled={busy || loading || directoryLoading}
                  value={shopId}
                  onChange={(event) => {
                    selectedShopRef.current = event.target.value;
                    setShopId(event.target.value);
                    resetPreview();
                  }}
                >
                  {!shopId && <option value="">请选择 Shopify 店铺</option>}
                  {shops.map((shop) => (
                    <option key={shop.id} value={shop.id}>
                      {shopDisplayName(shop)}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset className="shopify-order-time-range">
                <legend>订单时间范围</legend>
                <label className="checkbox-label">
                  <input
                    aria-label="读取 60 天以前的 Shopify 历史订单"
                    checked={historical}
                    disabled={busy || loading || importing}
                    type="checkbox"
                    onChange={(event) => {
                      setHistorical(event.currentTarget.checked);
                      resetPreview();
                    }}
                  />
                  读取 60 天以前的历史订单
                </label>
                <small>
                  仅在补录、售后追溯或客服查询时启用，系统会自动核验历史订单访问权限。
                </small>
              </fieldset>
              <label className="shopify-order-query-field">
                订单筛选（可选）
                <input
                  aria-label="Shopify 订单查询条件"
                  disabled={busy || loading}
                  maxLength={500}
                  placeholder="例如：name:#1001"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    resetPreview();
                  }}
                />
                <small>支持按订单号等 Shopify 查询条件缩小读取范围。</small>
              </label>
              <label className="shopify-order-limit-field">
                每页订单数
                <select
                  aria-label="Shopify 订单每页数量"
                  disabled={busy || loading}
                  value={limit}
                  onChange={(event) => {
                    setLimit(Number(event.target.value));
                    resetPreview();
                  }}
                >
                  {[25, 50, 100].map((value) => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
              </label>
              <div className="form-actions shopify-order-preview-actions">
                <button
                  className="button button-primary"
                  disabled={busy || loading || directoryLoading || importing || !shopId}
                  type="button"
                  onClick={() => void previewOrders("", [])}
                >
                  <RefreshCw
                    className={loading ? "spin" : undefined}
                    size={16}
                    aria-hidden="true"
                  />
                  {loading ? "正在读取" : "刷新预览"}
                </button>
                <button
                  className="button"
                  disabled={loading || importing || cursorHistory.length === 0}
                  type="button"
                  onClick={() => {
                    const previous = cursorHistory.at(-1) ?? "";
                    void previewOrders(previous, cursorHistory.slice(0, -1));
                  }}
                >上一页</button>
                <button
                  className="button"
                  disabled={loading || importing || !preview?.hasNextPage || !preview.cursor}
                  type="button"
                  onClick={() => void previewOrders(
                    preview?.cursor ?? "",
                    [...cursorHistory, cursor],
                  )}
                >下一页</button>
              </div>
              {directoryLoading && (
                <p className="product-state" role="status" aria-busy="true">
                  正在加载 Shopify 店铺目录…
                </p>
              )}
              {!directoryLoading && !directoryWarning && shops.length === 0 && (
                <p className="inline-alert" role="status">
                  暂无已启用的 Shopify 店铺，请先在店铺中心确认应用授权状态。
                </p>
              )}
              {directoryWarning && (
                <div className="inline-alert" role="alert">
                  <ShieldAlert size={18} aria-hidden="true" />
                  <span>{directoryWarning}</span>
                  <button
                    className="text-button"
                    type="button"
                    disabled={directoryLoading}
                    onClick={() => setDirectoryReload((value) => value + 1)}
                  >重试店铺目录</button>
                </div>
              )}
              {message && (
                <div
                  className={`inline-alert shopify-order-feedback ${
                    messageIsSuccess ? "is-success" : "is-warning"
                  }`}
                  role={messageIsSuccess ? "status" : "alert"}
                >
                  {messageIsSuccess
                    ? <CircleCheck size={18} aria-hidden="true" />
                    : <ShieldAlert size={18} aria-hidden="true" />}
                  <span>{message}</span>
                </div>
              )}
            </div>

            {importResult && (
              <div className="erp-table-scroll shopify-order-import-result">
                <table className="erp-table compact-table">
                  <caption>最近一次 Shopify 订单导入结果</caption>
                  <thead>
                    <tr>
                      <th>订单</th>
                      <th>结果</th>
                      <th>ERP 订单</th>
                      <th>说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importResult.items.map((item) => (
                      <tr key={item.externalOrderRef}>
                        <td>{item.name || item.externalOrderRef}</td>
                        <td>{shopifyOrderImportStatusLabel(item.status)}</td>
                        <td>{item.orderId || "—"}</td>
                        <td>{item.safeSummary || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {preview && (
              <>
                <div className="shopify-order-preview-meta">
                  <span>连接状态：{shopifyConnectionStatusLabel(preview.connectionStatus)}</span>
                  <span>
                    最近读取：{preview.fetchedAt
                      ? <OrderDateTime value={preview.fetchedAt} />
                      : "—"}
                  </span>
                  <span>{preview.hasNextPage ? "还有下一页" : "已到最后一页"}</span>
                </div>
                <dl className="shopify-catalog-summary shopify-order-summary" aria-label="订单预览摘要">
                  <div><dt>本页订单</dt><dd>{preview.orders.length}</dd></div>
                  <div><dt>商品明细</dt><dd>{rows.length}</dd></div>
                  <div className="is-success"><dt>已匹配 SKU</dt><dd>{matchedLines}</dd></div>
                  <div className={rows.length - matchedLines > 0 ? "is-warning" : "is-success"}>
                    <dt>待匹配</dt><dd>{rows.length - matchedLines}</dd>
                  </div>
                </dl>
                {rows.length > 0 && (
                  <div className="erp-operation-bar" aria-label="Shopify 订单导入操作">
                    <div className="erp-operation-start">
                      {canImport ? (
                        <span className="erp-selection-count">
                          已选 {selectedOrderRefs.length} 个订单
                        </span>
                      ) : (
                        <span className="shopify-catalog-readonly-mode">
                          <LockKeyhole size={16} aria-hidden="true" />
                          当前为只读预览
                        </span>
                      )}
                    </div>
                    {canImport && (
                      <div className="erp-operation-end">
                        <button
                          className="button button-primary"
                          disabled={importing || selectedOrderRefs.length === 0}
                          type="button"
                          onClick={() => void importOrders()}
                        >
                          {importing ? "正在导入 ERP" : `导入到 ERP (${selectedOrderRefs.length})`}
                        </button>
                      </div>
                    )}
                  </div>
                )}
                <div className="erp-table-scroll shopify-order-preview-table-scroll">
                  {rows.length === 0 ? (
                    <div className="empty-table-state">当前条件没有可预览的 Shopify 订单明细。</div>
                  ) : (
                    <table className="erp-table compact-table shopify-order-preview-table">
                      <caption className="sr-only">Shopify 订单预览</caption>
                      <thead>
                        <tr>
                          {canImport && <th>选择</th>}
                          <th>订单</th>
                          <th>平台状态</th>
                          <th>SKU 匹配</th>
                          <th>商品</th>
                          <th>数量</th>
                          <th>金额</th>
                          <th>运单</th>
                          <th>收件国家</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(({ order, line, lineCount, lineIndex }) => (
                          <tr key={`${order.externalOrderRef}:${line.externalLineRef}`}>
                            {canImport && lineIndex === 0 && (
                              <td rowSpan={lineCount}>
                                <label className="shopify-order-select">
                                  <input
                                    aria-label={`选择 Shopify 订单 ${order.name}`}
                                    checked={selectedSet.has(order.externalOrderRef)}
                                    disabled={busy || loading || importing}
                                    type="checkbox"
                                    onChange={(event) => toggleOrderRef(
                                      order.externalOrderRef,
                                      event.currentTarget.checked,
                                    )}
                                  />
                                </label>
                              </td>
                            )}
                            {lineIndex === 0 && (
                              <>
                                <td rowSpan={lineCount}>
                                  <strong>{order.name}</strong>
                                  <small>{order.email || "未提供邮箱"}</small>
                                  <small><OrderDateTime value={order.createdAt} /></small>
                                </td>
                                <td rowSpan={lineCount}>
                                  <span>{shopifyFinancialStatusLabel(order.financialStatus)}</span>
                                  <small>{shopifyFulfillmentStatusLabel(order.fulfillmentStatus)}</small>
                                </td>
                              </>
                            )}
                            <td>
                              <span className={`shopify-match-status ${line.matchStatus === "EXACT_SKU_MATCH" ? "is-success" : "is-warning"}`}>
                                {shopifyOrderLineMatchStatusLabel(line.matchStatus)}
                              </span>
                              <small>{line.localSku?.businessCode || line.platformSku || "未提供 SKU"}</small>
                            </td>
                            <td>{line.name}</td>
                            <td>{line.quantity}</td>
                            <td>
                              {line.discountedTotal?.amountMinor !== undefined &&
                              line.discountedTotal.currencyCode
                                ? formatMinor(
                                    line.discountedTotal.amountMinor,
                                    line.discountedTotal.currencyCode,
                                  )
                                : line.discountedTotal?.amount || "—"}
                            </td>
                            {lineIndex === 0 && (
                              <>
                                <td rowSpan={lineCount}>{shopifyOrderTrackingSummary(order.fulfillments)}</td>
                                <td rowSpan={lineCount}>{order.shippingAddress?.countryCode || "—"}</td>
                              </>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}

function shopifyConnectionStatusLabel(status: ShopifyOrderCatalogPreview["connectionStatus"]) {
  return {
    NOT_CONNECTED: "未连接",
    PENDING: "待连接",
    CONNECTED: "已连接",
    FAILED: "连接失败",
    REVOKED: "授权已撤销",
  }[status];
}

function shopifyFinancialStatusLabel(status?: string) {
  return {
    AUTHORIZED: "已授权",
    PAID: "已支付",
    PARTIALLY_PAID: "部分支付",
    PARTIALLY_REFUNDED: "部分退款",
    PENDING: "待支付",
    REFUNDED: "已退款",
    VOIDED: "已作废",
  }[status?.trim().toUpperCase() ?? ""] ?? "状态未知";
}

function shopifyFulfillmentStatusLabel(status?: string) {
  return {
    FULFILLED: "已履约",
    IN_PROGRESS: "处理中",
    ON_HOLD: "已暂停",
    OPEN: "未完成",
    PARTIAL: "部分履约",
    RESTOCKED: "已退回库存",
    SCHEDULED: "已计划",
    UNFULFILLED: "未履约",
  }[status?.trim().toUpperCase() ?? ""] ?? "状态未知";
}

function shopifyOrderLineMatchStatusLabel(
  status: ShopifyOrderLineMatchStatus,
): string {
  return {
    EXACT_SKU_MATCH: "SKU 精确匹配",
    MISSING_LOCAL_SKU: "缺少库存 SKU",
    EMPTY_PLATFORM_SKU: "平台 SKU 为空",
  }[status];
}

function shopifyOrderTrackingSummary(
  fulfillments: ShopifyFulfillmentPreview[],
): string {
  const tracking = fulfillments
    .flatMap((fulfillment) => fulfillment.trackingInfo)
    .find((item) => item.number || item.company);
  if (!tracking) return "—";
  return [tracking.company, tracking.number].filter(Boolean).join(" / ");
}

function shopifyOrderImportStatusLabel(
  status: ShopifyOrderCatalogImportResult["items"][number]["status"],
): string {
  return {
    IMPORTED: "已导入",
    SKIPPED_DUPLICATE: "已存在，跳过",
    SKIPPED_NOT_IN_PAGE: "不在当前页，跳过",
    SKIPPED_INVALID_ORDER: "订单数据不完整，跳过",
    SKIPPED_CONFLICT: "冲突，跳过",
  }[status];
}

function CreateOrderPanel({
  busy,
  onCreated,
}: {
  busy: boolean;
  onCreated: () => void;
}) {
  const emptyLine = () => ({
    externalLineRef: "",
    titleSnapshot: "",
    quantity: 1,
    unitPriceMinor: 0,
    skuId: "",
    externalListingRef: "",
    externalVariantRef: "",
  });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [shopId, setShopId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [externalOrderRef, setExternalOrderRef] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [buyerReference, setBuyerReference] = useState("");
  const [placedAt, setPlacedAt] = useState("");
  const currencyEdited = useRef(false);
  const [operational, setOperational] =
    useState<OrderOperationalInput>({});
  const [profileText, setProfileText] = useState<Record<string, string>>({});
  const [profileAmounts, setProfileAmounts] =
    useState<Record<string, number | undefined>>({});
  const [lines, setLines] = useState([emptyLine()]);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const options = useOrderFilterOptions(warehouseId);
  const profileValue = (name: string) => profileText[name] ?? "";
  const setProfileValue = (name: string, value: string) =>
    setProfileText((current) => ({ ...current, [name]: value }));
  const setOperationalValue = <K extends keyof OrderOperationalInput>(
    name: K,
    value: OrderOperationalInput[K],
  ) => setOperational((current) => ({ ...current, [name]: value }));
  const optionalText = (value: string) => value.trim() || undefined;

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const elements = focusableElements(dialogRef.current);
      const first = elements[0];
      const last = elements.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      triggerRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    const controller = new AbortController();
    void systemGeneralSettingApi.get(controller.signal).then((setting) => {
      if (!currencyEdited.current) setCurrency(setting.defaultCurrency);
    }).catch(() => undefined);
    return () => controller.abort();
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || busy) return;
    const placed = new Date(placedAt);
    if (
      !isUuid(shopId) ||
      (!!warehouseId && !isUuid(warehouseId)) ||
      !externalOrderRef.trim() ||
      !/^[A-Z]{3}$/.test(currency) ||
      Number.isNaN(placed.getTime()) ||
      lines.some((line) =>
        !line.externalLineRef.trim() ||
        !line.titleSnapshot.trim() ||
        line.quantity < 1 ||
        line.unitPriceMinor < 0 ||
        (!!line.skuId && !isUuid(line.skuId))
      )
    ) {
      setMessage("请完整填写合法的店铺、时间、币种和订单明细。");
      return;
    }
    setSubmitting(true);
    setMessage("");
    const input: CreateOrderInput = {
      shopId,
      warehouseId: warehouseId || undefined,
      externalOrderRef: externalOrderRef.trim(),
      idempotencyKey: `web.${crypto.randomUUID()}`,
      currency,
      buyerReference: buyerReference.trim() || undefined,
      placedAt: placed.toISOString(),
      operational: {
        ...operational,
        platformStatus: optionalText(operational.platformStatus ?? ""),
        logisticsChannel: optionalText(operational.logisticsChannel ?? ""),
        province: optionalText(operational.province ?? ""),
        postalCode: optionalText(operational.postalCode ?? ""),
        buyerSelectedLogistics:
          optionalText(operational.buyerSelectedLogistics ?? ""),
        trackingStatus: optionalText(operational.trackingStatus ?? ""),
        fixedCategory: optionalText(operational.fixedCategory ?? ""),
        customCategory: optionalText(operational.customCategory ?? ""),
        reshipmentReason: optionalText(operational.reshipmentReason ?? ""),
      },
      profile: {
        references: {
          salesRecordNumber: optionalText(profileValue("salesRecordNumber")),
          shoppingCartReference:
            optionalText(profileValue("shoppingCartReference")),
          customOrderReference:
            optionalText(profileValue("customOrderReference")),
          customerId: optionalText(profileValue("customerId")),
          customerCode: optionalText(profileValue("customerCode")),
          shippingService: optionalText(profileValue("shippingService")),
          trackingReference: optionalText(profileValue("trackingReference")),
          secondaryTrackingReference:
            optionalText(profileValue("secondaryTrackingReference")),
        },
        recipient: {
          name: optionalText(profileValue("recipientName")),
          phone: optionalText(profileValue("recipientPhone")),
          email: optionalText(profileValue("recipientEmail")),
          company: optionalText(profileValue("recipientCompany")),
          addressLine1: optionalText(profileValue("addressLine1")),
          addressLine2: optionalText(profileValue("addressLine2")),
          city: optionalText(profileValue("city")),
          district: optionalText(profileValue("district")),
          town: optionalText(profileValue("town")),
          doorCode: optionalText(profileValue("doorCode")),
        },
        financials: {
          itemAmountMinor: profileAmounts.itemAmountMinor,
          platformFeeMinor: profileAmounts.platformFeeMinor,
          insuranceFeeMinor: profileAmounts.insuranceFeeMinor,
          paymentFeeMinor: profileAmounts.paymentFeeMinor,
          otherIncomeMinor: profileAmounts.otherIncomeMinor,
          otherExpenseMinor: profileAmounts.otherExpenseMinor,
          actualPaidMinor: profileAmounts.actualPaidMinor,
          profitMinor: profileAmounts.profitMinor,
          taxMinor: profileAmounts.taxMinor,
          estimatedShippingMinor:
            profileAmounts.estimatedShippingMinor,
          actualShippingMinor: profileAmounts.actualShippingMinor,
        },
        messages: {
          platformMessage: optionalText(profileValue("platformMessage")),
          platformRemark: optionalText(profileValue("platformRemark")),
          orderRemark: optionalText(profileValue("orderRemark")),
          declarationPlan: optionalText(profileValue("declarationPlan")),
          declarationActual: optionalText(profileValue("declarationActual")),
        },
        classification: {
          customerCategory: optionalText(profileValue("customerCategory")),
          productKindCount: profileAmounts.productKindCount,
          supplierReference: optionalText(profileValue("supplierReference")),
          parentProductCategory:
            optionalText(profileValue("parentProductCategory")),
          childProductCategory:
            optionalText(profileValue("childProductCategory")),
          productStatus: optionalText(profileValue("productStatus")),
          extendedAttribute: optionalText(profileValue("extendedAttribute")),
        },
        assignments: {
          locationId: optionalText(profileValue("locationId")),
          pickerUserId: optionalText(profileValue("pickerUserId")),
          shipperUserId: optionalText(profileValue("shipperUserId")),
          salespersonUserId: optionalText(profileValue("salespersonUserId")),
          purchaserUserId: optionalText(profileValue("purchaserUserId")),
          developerUserId: optionalText(profileValue("developerUserId")),
          managerUserId: optionalText(profileValue("managerUserId")),
        },
      },
      lines: lines.map((line) => ({
        skuId: line.skuId || undefined,
        externalListingRef: line.externalListingRef.trim() || undefined,
        externalVariantRef: line.externalVariantRef.trim() || undefined,
        externalLineRef: line.externalLineRef.trim(),
        titleSnapshot: line.titleSnapshot.trim(),
        quantity: line.quantity,
        unitPriceMinor: line.unitPriceMinor,
        currency,
      })),
    };
    try {
      await orderCenterApi.create(input);
      setExternalOrderRef("");
      setBuyerReference("");
      setPlacedAt("");
      setWarehouseId("");
      setOperational({});
      setProfileText({});
      setProfileAmounts({});
      setLines([emptyLine()]);
      setOpen(false);
      onCreated();
    } catch (error) {
      setMessage(safeOrderError(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        className="button button-primary"
        disabled={busy}
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
      >
        <Plus size={15} aria-hidden="true" />新建订单
      </button>
      {open && (
        <div
          className="modal-backdrop order-create-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setOpen(false);
          }}
          role="presentation"
        >
          <section
            aria-labelledby="order-create-title"
            aria-modal="true"
            className="write-dialog order-create-dialog"
            ref={dialogRef}
            role="dialog"
          >
            <header className="table-heading">
              <div>
                <h2 id="order-create-title">新建订单</h2>
                <p>录入订单基础信息、业务属性和商品明细。</p>
              </div>
              <DialogCloseButton
                label="关闭新建订单"
                onClick={() => setOpen(false)}
                ref={closeButtonRef}
              />
            </header>
            <form className="detail-form order-create-form" onSubmit={(event) => void submit(event)}>
        <label>
          店铺
          <select value={shopId} onChange={(event) => setShopId(event.target.value)}>
            <option value="">请选择店铺</option>
            {options.shops
              .filter((shop) => shop.status !== "ARCHIVED")
              .map((shop) => (
                <option key={shop.id} value={shop.id}>
                  {shopDisplayName(shop)} · {shop.externalShopRef}
                </option>
              ))}
          </select>
        </label>
        <label>
          仓库
          <select
            value={warehouseId}
            onChange={(event) => {
              setWarehouseId(event.target.value);
              setProfileValue("locationId", "");
            }}
          >
            <option value="">未分配仓库</option>
            {options.warehouses
              .filter((warehouse) => warehouse.status === "ACTIVE")
              .map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.businessCode} · {warehouse.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          仓位
          <select
            disabled={!warehouseId}
            value={profileValue("locationId")}
            onChange={(event) =>
              setProfileValue("locationId", event.target.value)
            }
          >
            <option value="">未分配仓位</option>
            {options.locations
              .filter((location) => location.status === "ACTIVE")
              .map((location) => (
                <option key={location.id} value={location.id}>
                  {location.businessCode} · {location.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          订单号
          <input
            maxLength={160}
            value={externalOrderRef}
            onChange={(event) => setExternalOrderRef(event.target.value)}
          />
        </label>
        <label>
          下单时间
          <input
            type="datetime-local"
            value={placedAt}
            onChange={(event) => setPlacedAt(event.target.value)}
          />
        </label>
        <label>
          币种
          <CurrencyCodeInput
            listId="order-create-currency-options"
            value={currency}
            onChange={(event) => {
              currencyEdited.current = true;
              setCurrency(event.target.value.toUpperCase());
            }}
          />
          <small>订单金额和明细共用此币种；可选择常用币种，或输入 ISO 三位代码。</small>
        </label>
        <label>
          买家引用
          <input
            maxLength={200}
            value={buyerReference}
            onChange={(event) => setBuyerReference(event.target.value)}
          />
        </label>
        <fieldset>
          <legend>付款、费用与物流</legend>
          <label>
            付款状态
            <select
              value={operational.paymentStatus ?? ""}
              onChange={(event) =>
                setOperationalValue(
                  "paymentStatus",
                  event.target.value
                    ? event.target.value as Order["paymentStatus"]
                    : undefined,
                )
              }
            >
              <option value="">未提供</option>
              <option value="UNPAID">未付款</option>
              <option value="PAID">已付款</option>
              <option value="PARTIALLY_REFUNDED">部分退款</option>
              <option value="REFUNDED">已退款</option>
            </select>
          </label>
          {([
            ["totalAmountMinor", "订单金额（最小货币单位）"],
            ["shippingAmountMinor", "运费（最小货币单位）"],
            ["weightGrams", "包裹重量（克）"],
          ] as const).map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                min={key === "weightGrams" ? "0.001" : "0"}
                step={key === "weightGrams" ? "0.001" : "1"}
                type="number"
                value={operational[key] ?? ""}
                onChange={(event) =>
                  setOperationalValue(
                    key,
                    event.target.value === ""
                      ? undefined : Number(event.target.value),
                  )
                }
              />
            </label>
          ))}
          {([
            ["logisticsChannel", "物流渠道", 80],
            ["buyerSelectedLogistics", "买家选择物流", 120],
            ["trackingStatus", "跟踪状态", 32],
            ["countryCode", "国家代码", 2],
            ["province", "省 / 州", 120],
            ["postalCode", "邮编", 32],
            ["fixedCategory", "固定分类", 80],
            ["customCategory", "自定义分类", 80],
          ] as const).map(([key, label, maxLength]) => (
            <label key={key}>
              {label}
              <input
                maxLength={maxLength}
                value={String(operational[key] ?? "")}
                onChange={(event) =>
                  setOperationalValue(
                    key,
                    key === "countryCode"
                      ? event.target.value.toUpperCase()
                      : event.target.value,
                  )
                }
              />
            </label>
          ))}
          {([
            ["paidAt", "付款时间"],
            ["shipByAt", "最晚发货时间"],
            ["shippedAt", "发货时间"],
          ] as const).map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                type="datetime-local"
                value={operational[key] ?? ""}
                onChange={(event) =>
                  setOperationalValue(
                    key,
                    event.target.value
                      ? new Date(event.target.value).toISOString()
                      : undefined,
                  )
                }
              />
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>收件人与地址</legend>
          {([
            ["recipientName", "收件人", 200],
            ["recipientPhone", "联系电话", 40],
            ["recipientEmail", "联系邮箱", 254],
            ["recipientCompany", "公司", 200],
            ["addressLine1", "地址 1", 300],
            ["addressLine2", "地址 2", 300],
            ["city", "城市", 120],
            ["district", "区 / 县", 120],
            ["town", "乡镇", 120],
            ["doorCode", "门牌 / 门禁", 80],
          ] as const).map(([key, label, maxLength]) => (
            <label key={key}>
              {label}
              <input
                maxLength={maxLength}
                value={profileValue(key)}
                onChange={(event) => setProfileValue(key, event.target.value)}
              />
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>订单引用、备注与申报</legend>
          {([
            ["salesRecordNumber", "销售记录号", 160],
            ["shoppingCartReference", "购物车号", 160],
            ["customOrderReference", "自定义订单号", 160],
            ["customerId", "客户 ID", 160],
            ["customerCode", "客户代码", 160],
            ["shippingService", "物流服务", 120],
            ["trackingReference", "物流跟踪号", 160],
            ["secondaryTrackingReference", "第二物流跟踪号", 160],
            ["platformMessage", "平台留言", 1000],
            ["platformRemark", "平台备注", 1000],
            ["orderRemark", "订单备注", 1000],
            ["declarationPlan", "申报方案", 1000],
            ["declarationActual", "实际申报", 1000],
          ] as const).map(([key, label, maxLength]) => (
            <label key={key}>
              {label}
              <textarea
                maxLength={maxLength}
                value={profileValue(key)}
                onChange={(event) => setProfileValue(key, event.target.value)}
              />
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>费用明细</legend>
          {([
            ["itemAmountMinor", "商品金额"],
            ["platformFeeMinor", "平台费"],
            ["insuranceFeeMinor", "保险费"],
            ["paymentFeeMinor", "支付费"],
            ["otherIncomeMinor", "其他收入"],
            ["otherExpenseMinor", "其他支出"],
            ["actualPaidMinor", "实付金额"],
            ["profitMinor", "利润（人工录入）"],
            ["taxMinor", "税费（人工录入）"],
            ["estimatedShippingMinor", "预估运费"],
            ["actualShippingMinor", "实际运费"],
          ] as const).map(([key, label]) => (
            <label key={key}>
              {label}（最小货币单位）
              <input
                min={key === "profitMinor" || key === "taxMinor"
                  ? undefined : "0"}
                type="number"
                value={profileAmounts[key] ?? ""}
                onChange={(event) => setProfileAmounts((current) => ({
                  ...current,
                  [key]: event.target.value === ""
                    ? undefined : Number(event.target.value),
                }))}
              />
            </label>
          ))}
        </fieldset>
        {lines.map((line, index) => (
          <fieldset key={index}>
            <legend>明细 {index + 1}</legend>
            <label>
              明细编号
              <input
                maxLength={160}
                value={line.externalLineRef}
                onChange={(event) => setLines((current) =>
                  current.map((item, itemIndex) => itemIndex === index
                    ? { ...item, externalLineRef: event.target.value } : item))}
              />
            </label>
            <label>
              商品标题
              <input
                maxLength={300}
                value={line.titleSnapshot}
                onChange={(event) => setLines((current) =>
                  current.map((item, itemIndex) => itemIndex === index
                    ? { ...item, titleSnapshot: event.target.value } : item))}
              />
            </label>
            <label>
              SKU ID（可选）
              <input
                value={line.skuId}
                onChange={(event) => setLines((current) =>
                  current.map((item, itemIndex) => itemIndex === index
                    ? { ...item, skuId: event.target.value } : item))}
              />
            </label>
            <label>
              平台商品引用（可选）
              <input
                maxLength={160}
                value={line.externalListingRef}
                onChange={(event) => setLines((current) =>
                  current.map((item, itemIndex) => itemIndex === index
                    ? { ...item, externalListingRef: event.target.value } : item))}
              />
            </label>
            <label>
              平台变体引用（可选）
              <input
                disabled={!line.externalListingRef}
                maxLength={160}
                value={line.externalVariantRef}
                onChange={(event) => setLines((current) =>
                  current.map((item, itemIndex) => itemIndex === index
                    ? { ...item, externalVariantRef: event.target.value } : item))}
              />
            </label>
            <label>
              数量
              <input
                min="1"
                type="number"
                value={line.quantity}
                onChange={(event) => setLines((current) =>
                  current.map((item, itemIndex) => itemIndex === index
                    ? { ...item, quantity: Number(event.target.value) } : item))}
              />
            </label>
            <label>
              单价（最小货币单位）
              <input
                min="0"
                type="number"
                value={line.unitPriceMinor}
                onChange={(event) => setLines((current) =>
                  current.map((item, itemIndex) => itemIndex === index
                    ? { ...item, unitPriceMinor: Number(event.target.value) } : item))}
              />
            </label>
            {lines.length > 1 && (
              <button
                className="text-button"
                type="button"
                onClick={() => setLines((current) =>
                  current.filter((_, itemIndex) => itemIndex !== index))}
              >
                删除明细
              </button>
            )}
          </fieldset>
        ))}
        <button
          className="button button-secondary"
          disabled={lines.length >= 200}
          type="button"
          onClick={() => setLines((current) => [...current, emptyLine()])}
        >
          添加明细
        </button>
        {message && <p role="alert">{message}</p>}
        <button
          className="button button-primary"
          disabled={submitting || busy}
          type="submit"
        >
          {submitting ? "正在创建…" : "创建订单"}
        </button>
            </form>
          </section>
        </div>
      )}
    </>
  );
}

function OrderTransferHistory({ refreshKey }: { refreshKey: number }) {
  const request = useRef(0);
  const [retryKey, setRetryKey] = useState(0);
  const [state, setState] = useState<ListState>("loading");
  const [history, setHistory] = useState<Page<OrderTransferJob> | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const id = ++request.current;
    setState("loading");
    setMessage("");
    void orderCenterApi.listTransfers(page, pageSize)
      .then((result) => {
        if (id !== request.current) return;
        setHistory(result);
        setState("ready");
      })
      .catch((error: unknown) => {
        if (id !== request.current) return;
        setMessage(safeOrderError(error));
        setState("error");
      });
    return () => {
      if (id === request.current) request.current += 1;
    };
  }, [page, pageSize, refreshKey, retryKey]);

  const jobs = history?.items ?? [];

  return (
    <details className="order-advanced-filters">
      <summary>导入导出与批处理记录</summary>
      {state === "loading" && <p aria-busy="true">正在加载任务记录…</p>}
      {state === "error" && (
        <RetryableOrderError
          message={message}
          retryLabel="重试加载任务记录"
          onRetry={() => setRetryKey((current) => current + 1)}
        />
      )}
      {state === "ready" && jobs.length === 0 && (
        <p>暂无导入、导出或批处理记录。</p>
      )}
      {state === "ready" && jobs.length > 0 && (
        <>
          <div className="shop-table-scroll">
            <table className="shop-table">
              <thead>
                <tr>
                  <th>任务类型</th>
                  <th>状态</th>
                  <th>结果</th>
                  <th>创建时间</th>
                  <th>完成时间</th>
                  <th>安全摘要</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td>{transferJobTypeLabel(job.jobType)}</td>
                    <td>{transferJobStatusLabel(job.status)}</td>
                    <td>
                      请求 {job.requestedCount} / 成功 {job.succeededCount}
                      {" / "}失败 {job.failedCount}
                    </td>
                    <td><OrderDateTime value={job.createdAt} /></td>
                    <td><OrderDateTime value={job.completedAt} /></td>
                    <td>{job.safeErrorSummary || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {history && (
            <nav className="pagination" aria-label="批处理记录分页">
              <span>
                第 {history.page + 1} / {Math.max(history.totalPages, 1)} 页
              </span>
              <div>
                <label>
                  每页
                  <select
                    aria-label="批处理记录分页每页条数"
                    value={pageSize}
                    onChange={(event) => {
                      setPage(0);
                      setPageSize(Number(event.target.value));
                    }}
                  >
                    {TRANSFER_PAGE_SIZES.map((size) => (
                      <option key={size} value={size}>{size} 条</option>
                    ))}
                  </select>
                </label>
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={history.page === 0}
                  onClick={() => setPage(history.page - 1)}
                >
                  上一页
                </button>
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={history.page + 1 >= history.totalPages}
                  onClick={() => setPage(history.page + 1)}
                >
                  下一页
                </button>
              </div>
            </nav>
          )}
        </>
      )}
    </details>
  );
}

function transferJobTypeLabel(value: OrderTransferJob["jobType"]): string {
  return {
    IMPORT: "订单导入",
    EXPORT: "订单导出",
    BULK_STATUS: "批量状态",
    BULK_EXCEPTION_RETRY: "批量异常重试",
  }[value];
}

function transferJobStatusLabel(value: OrderTransferJob["status"]): string {
  return {
    PENDING: "等待中",
    RUNNING: "处理中",
    SUCCEEDED: "成功",
    PARTIALLY_FAILED: "部分失败",
    FAILED: "失败",
    CANCELLED: "已取消",
  }[value];
}

function OrderColumnSettings({
  visible,
  onChange,
}: {
  visible: OrderColumn[];
  onChange: (columns: OrderColumn[]) => void;
}) {
  const selected = new Set(visible);
  return (
    <details className="erp-action-menu order-column-settings">
      <summary className="button button-secondary">
        <Columns3 size={15} aria-hidden="true" />
        列表设置
      </summary>
      <div className="erp-action-menu-popover order-action-menu-popover order-column-settings-menu">
        {orderColumns.map(([key, label]) => (
          <label key={key}>
            <input
              checked={selected.has(key)}
              type="checkbox"
              onChange={(event) => {
                const next = new Set(selected);
                if (event.target.checked) next.add(key);
                else next.delete(key);
                if (next.size > 0) {
                  onChange(
                    orderColumns
                      .map(([column]) => column)
                      .filter((column) => next.has(column)),
                  );
                }
              }}
            />
            {label}
          </label>
        ))}
        <button
          type="button"
          onClick={() => onChange(defaultOrderColumns)}
        >
          恢复默认字段
        </button>
      </div>
    </details>
  );
}

const extraOrderColumns: Array<{
  key: OrderColumn;
  label: string;
  render: (order: Order) => ReactNode;
}> = [
  { key: "platformStatus", label: "平台状态", render: (order) => order.platformStatus || "—" },
  { key: "paymentStatus", label: "付款状态", render: (order) => order.paymentStatus || "—" },
  { key: "currency", label: "币种", render: (order) => order.currency },
  {
    key: "totalAmount",
    label: "订单金额",
    render: (order) => order.totalAmountMinor === undefined
      ? "—" : formatMinor(order.totalAmountMinor, order.currency),
  },
  {
    key: "shippingAmount",
    label: "运费",
    render: (order) => order.shippingAmountMinor === undefined
      ? "—" : formatMinor(order.shippingAmountMinor, order.currency),
  },
  { key: "weight", label: "重量", render: (order) =>
    order.weightGrams === undefined ? "—" : `${order.weightGrams} 克` },
  { key: "paidAt", label: "付款时间", render: (order) => <OrderDateTime value={order.paidAt} /> },
  { key: "shipByAt", label: "最晚发货时间", render: (order) => <OrderDateTime value={order.shipByAt} /> },
  { key: "shippedAt", label: "发货时间", render: (order) => <OrderDateTime value={order.shippedAt} /> },
  { key: "createdAt", label: "创建时间", render: (order) => <OrderDateTime value={order.createdAt} /> },
  { key: "updatedAt", label: "更新时间", render: (order) => <OrderDateTime value={order.updatedAt} /> },
  { key: "trackingStatus", label: "跟踪状态", render: (order) => order.trackingStatus || "—" },
  {
    key: "warehouse",
    label: "仓库",
    render: (order) => order.warehouseDisplayName || order.warehouseId || "未分配",
  },
  {
    key: "location",
    label: "仓位",
    render: (order) => order.locationBusinessCode || "—",
  },
  {
    key: "picker",
    label: "配货员",
    render: (order) => order.pickerDisplayName || "—",
  },
  {
    key: "shipper",
    label: "发货员",
    render: (order) => order.shipperDisplayName || "—",
  },
  {
    key: "purchaser",
    label: "采购员",
    render: (order) => order.purchaserDisplayName || "—",
  },
  {
    key: "developer",
    label: "商品负责人",
    render: (order) => order.developerDisplayName || "—",
  },
  { key: "postalCode", label: "邮编", render: (order) => order.postalCode || "—" },
  {
    key: "categories",
    label: "订单分类",
    render: (order) =>
      [order.fixedCategory, order.customCategory].filter(Boolean).join(" / ") || "—",
  },
  { key: "skuSummary", label: "SKU 摘要", render: (order) => order.skuSummary || "—" },
  { key: "titleSummary", label: "商品标题摘要", render: (order) => order.titleSummary || "—" },
  { key: "lineCount", label: "商品明细数", render: (order) => `${order.lineCount} 条` },
  {
    key: "reshipment",
    label: "补发信息",
    render: (order) => order.reshipment
      ? order.reshipmentReason || "已标记补发" : "否",
  },
  {
    key: "salesRecordNumber",
    label: "交易号",
    render: (order) => order.salesRecordNumber || "—",
  },
  {
    key: "shoppingCartReference",
    label: "购物车单号",
    render: (order) => order.shoppingCartReference || "—",
  },
  {
    key: "customOrderReference",
    label: "内部 / 自定义单号",
    render: (order) => order.customOrderReference || "—",
  },
  {
    key: "trackingReference",
    label: "物流单号",
    render: (order) => order.trackingReference || "—",
  },
  {
    key: "secondaryTrackingReference",
    label: "第二物流单号",
    render: (order) => order.secondaryTrackingReference || "—",
  },
  {
    key: "actualPaid",
    label: "实付金额",
    render: (order) => order.actualPaidMinor === undefined
      ? "—" : formatMinor(order.actualPaidMinor, order.currency),
  },
  {
    key: "profit",
    label: "利润",
    render: (order) => order.profitMinor === undefined
      ? "—" : formatMinor(order.profitMinor, order.currency),
  },
  {
    key: "actualShipping",
    label: "物流支出",
    render: (order) => order.actualShippingMinor === undefined
      ? "—" : formatMinor(order.actualShippingMinor, order.currency),
  },
  {
    key: "itemAmount",
    label: "商品金额",
    render: (order) => order.itemAmountMinor === undefined
      ? "—" : formatMinor(order.itemAmountMinor, order.currency),
  },
  {
    key: "platformFee",
    label: "平台费用",
    render: (order) => order.platformFeeMinor === undefined
      ? "—" : formatMinor(order.platformFeeMinor, order.currency),
  },
  {
    key: "insuranceFee",
    label: "保险费用",
    render: (order) => order.insuranceFeeMinor === undefined
      ? "—" : formatMinor(order.insuranceFeeMinor, order.currency),
  },
  {
    key: "paymentFee",
    label: "支付手续费",
    render: (order) => order.paymentFeeMinor === undefined
      ? "—" : formatMinor(order.paymentFeeMinor, order.currency),
  },
  {
    key: "otherIncome",
    label: "其他收入",
    render: (order) => order.otherIncomeMinor === undefined
      ? "—" : formatMinor(order.otherIncomeMinor, order.currency),
  },
  {
    key: "otherExpense",
    label: "其他支出",
    render: (order) => order.otherExpenseMinor === undefined
      ? "—" : formatMinor(order.otherExpenseMinor, order.currency),
  },
  {
    key: "tax",
    label: "税费",
    render: (order) => order.taxMinor === undefined
      ? "—" : formatMinor(order.taxMinor, order.currency),
  },
  {
    key: "estimatedShipping",
    label: "预估物流支出",
    render: (order) => order.estimatedShippingMinor === undefined
      ? "—" : formatMinor(order.estimatedShippingMinor, order.currency),
  },
  {
    key: "salesperson",
    label: "业务员",
    render: (order) => order.salespersonDisplayName || "—",
  },
  {
    key: "manager",
    label: "订单负责人",
    render: (order) => order.managerDisplayName || "—",
  },
  {
    key: "orderRemark",
    label: "订单备注",
    render: (order) => order.orderRemark || "—",
  },
  {
    key: "customerCategory",
    label: "客户分类",
    render: (order) => order.customerCategory || "—",
  },
  {
    key: "productKindCount",
    label: "商品种类数",
    render: (order) => order.productKindCount === undefined
      ? "—" : `${order.productKindCount} 种`,
  },
  {
    key: "supplierReference",
    label: "供应商引用",
    render: (order) => order.supplierReference || "—",
  },
  {
    key: "parentProductCategory",
    label: "商品父目录",
    render: (order) => order.parentProductCategory || "—",
  },
  {
    key: "childProductCategory",
    label: "商品子目录",
    render: (order) => order.childProductCategory || "—",
  },
  {
    key: "productStatus",
    label: "商品状态",
    render: (order) => order.productStatus || "—",
  },
  {
    key: "extendedAttribute",
    label: "扩展属性",
    render: (order) => order.extendedAttribute || "—",
  },
  {
    key: "printedAt",
    label: "打印时间",
    render: (order) => <OrderDateTime value={order.printedAt} />,
  },
  {
    key: "platformReturnedAt",
    label: "回传平台发货时间",
    render: (order) => <OrderDateTime value={order.platformReturnedAt} />,
  },
  {
    key: "exceptionReviewedAt",
    label: "异常审核时间",
    render: (order) => <OrderDateTime value={order.exceptionReviewedAt} />,
  },
  {
    key: "platformSpecifiedHandoverAt",
    label: "平台指定交运时间",
    render: (order) => <OrderDateTime value={order.platformSpecifiedHandoverAt} />,
  },
  {
    key: "platformLabelRequestedAt",
    label: "平台指定拉取面单时间",
    render: (order) => <OrderDateTime value={order.platformLabelRequestedAt} />,
  },
  {
    key: "deliveryDeadlineAt",
    label: "订单发货期限",
    render: (order) => <OrderDateTime value={order.deliveryDeadlineAt} />,
  },
  {
    key: "cancelledAt",
    label: "作废时间",
    render: (order) => <OrderDateTime value={order.cancelledAt} />,
  },
  {
    key: "handedOverAt",
    label: "交运时间",
    render: (order) => <OrderDateTime value={order.handedOverAt} />,
  },
  {
    key: "deliveredAt",
    label: "签收时间",
    render: (order) => <OrderDateTime value={order.deliveredAt} />,
  },
];

function OrderTable({
  orders,
  selected,
  visibleColumns,
  onSelectionChange,
  onOpen,
}: {
  orders: Order[];
  selected: Set<string>;
  visibleColumns: OrderColumn[];
  onSelectionChange: (selected: Set<string>) => void;
  onOpen: (id: string, triggerId: string) => void;
}) {
  const visible = new Set(visibleColumns);
  return (
    <div className="order-table-shell">
      <div className="shop-table-scroll">
        <table className="shop-table erp-pinned-actions">
          <thead>
            <tr>
              <th>
                <PageSelectionCheckbox
                  aria-label="选择当前页全部订单"
                  selectedCount={orders.filter(order => selected.has(order.id)).length}
                  totalCount={orders.length}
                  onChange={(event) =>
                    onSelectionChange(event.target.checked
                      ? new Set(orders.map((order) => order.id))
                      : new Set())
                  }
                />
              </th>
              <th>订单号</th>
              {visible.has("placedAt") && <th>下单时间</th>}
              {visible.has("shop") && <th>店铺</th>}
              {visible.has("buyer") && <th>买家引用</th>}
              {visible.has("status") && <th>状态</th>}
              {visible.has("payment") && <th>收款 / 金额</th>}
              {visible.has("logistics") && <th>物流 / 时限</th>}
              {visible.has("destination") && <th>目的地</th>}
              {visible.has("items") && <th>商品明细</th>}
              {visible.has("flags") && <th>处理标记</th>}
              {extraOrderColumns
                .filter((column) => visible.has(column.key))
                .map((column) => <th key={column.key}>{column.label}</th>)}
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id}>
                <td>
                  <input
                    aria-label={`选择订单 ${orderDisplayReference(order)}`}
                    checked={selected.has(order.id)}
                    type="checkbox"
                    onChange={(event) => {
                      const next = new Set(selected);
                      if (event.target.checked) next.add(order.id);
                      else next.delete(order.id);
                      onSelectionChange(next);
                    }}
                  />
                </td>
                <td>{orderDisplayReference(order)}</td>
                {visible.has("placedAt") && <td>
                  <OrderDateTime value={order.placedAt} />
                </td>}
                {visible.has("shop") && <td className="order-shop-cell">
                  <strong>{order.shopName}</strong>
                  <small title={order.shopId}>{order.shopId}</small>
                </td>}
                {visible.has("buyer") && <td>{order.buyerReference || "—"}</td>}
                {visible.has("status") && <td>
                  {orderStatusLabel(order.status)}
                  {order.platformStatus && (
                    <><br /><small>平台：{order.platformStatus}</small></>
                  )}
                  {order.status === "HOLD" && (
                    <>
                      <br />
                      <small>原因：{order.holdReason || "—"}</small>
                    </>
                  )}
                </td>}
                {visible.has("payment") && <td>
                  {order.paymentStatus || "—"}
                  <br />
                  <small>
                    {order.totalAmountMinor === undefined
                      ? order.currency
                      : formatMinor(order.totalAmountMinor, order.currency)}
                    {order.shippingAmountMinor === undefined
                      ? "" : ` / 运费 ${formatMinor(order.shippingAmountMinor, order.currency)}`}
                  </small>
                </td>}
                {visible.has("logistics") && <td>
                  {order.logisticsChannel || order.buyerSelectedLogistics || "—"}
                  <br />
                  <small
                    className="order-tracking-reference"
                    title={order.trackingReference || undefined}
                  >
                    物流单号：{order.trackingReference || "—"}
                  </small>
                  <br />
                  <small>跟踪：{order.trackingStatus || "—"}</small>
                  <br />
                  <small>最晚发货：<OrderDateTime value={order.shipByAt} /></small>
                </td>}
                {visible.has("destination") && <td>
                  {[order.countryCode, order.province, order.postalCode]
                    .filter(Boolean).join(" / ") || "—"}
                  <br />
                  <small>仓库：{order.warehouseId || "未分配"}</small>
                </td>}
                {visible.has("items") && <td>
                  {order.lineCount} 条
                  <br />
                  <small>{order.skuSummary || "暂无 SKU 摘要"}</small>
                  <br />
                  <small>{order.titleSummary || "暂无商品摘要"}</small>
                </td>}
                {visible.has("flags") && <td>
                  {order.printed ? "已打印" : "未打印"}
                  {order.reshipment && (
                    <><br /><small>补发：{order.reshipmentReason || "已标记"}</small></>
                  )}
                  {order.weightGrams !== undefined && (
                    <><br /><small>{order.weightGrams} 克</small></>
                  )}
                </td>}
                {extraOrderColumns
                  .filter((column) => visible.has(column.key))
                  .map((column) => (
                    <td key={column.key}>{column.render(order)}</td>
                  ))}
                <td>
                  <div className="row-actions order-row-actions">
                    <button
                      className="text-button"
                      type="button"
                      id={orderDetailTriggerId(order.id)}
                      onClick={() =>
                        onOpen(order.id, orderDetailTriggerId(order.id))
                      }
                    >
                      查看详情
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OrderPagination({
  page,
  size,
  totalElements,
  totalPages,
  onPageChange,
  onSizeChange,
}: {
  page: number;
  size: number;
  totalElements?: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onSizeChange: (size: number) => void;
}) {
  const displayPages = Math.max(totalPages, 1);
  const [targetPage, setTargetPage] = useState(String(page + 1));

  useEffect(() => {
    setTargetPage(String(page + 1));
  }, [page]);

  return (
    <nav className="pagination" aria-label="订单分页">
      <span>
        {totalElements === undefined ? "" : `共 ${totalElements} 条 · `}第 {page + 1}/{displayPages} 页
      </span>
      <div>
        <label>
          每页
          <select
            aria-label="每页订单数"
            value={size}
            onChange={(event) => onSizeChange(Number(event.target.value))}
          >
            {PAGE_SIZES.map((value) => (
              <option key={value} value={value}>{value} 条</option>
            ))}
          </select>
        </label>
        <button
          className="button button-secondary"
          disabled={page === 0}
          type="button"
          onClick={() => onPageChange(page - 1)}
        >
          上一页
        </button>
        <button
          className="button button-secondary"
          disabled={page + 1 >= totalPages}
          type="button"
          onClick={() => onPageChange(page + 1)}
        >
          下一页
        </button>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const requested = Number(targetPage);
            if (Number.isSafeInteger(requested)
                && requested >= 1 && requested <= displayPages) {
              onPageChange(requested - 1);
            } else {
              setTargetPage(String(page + 1));
            }
          }}
        >
          <label>
            跳至
            <input
              aria-label="跳转页码"
              inputMode="numeric"
              min="1"
              max={displayPages}
              type="number"
              value={targetPage}
              onChange={(event) => setTargetPage(event.target.value)}
            />
          </label>
          <button className="button button-secondary" type="submit">跳转</button>
        </form>
      </div>
    </nav>
  );
}

export function OrderDialog({
  detail,
  canWrite,
  canShopifyEdit,
  canReadProducts,
  canReadListings,
  fulfillmentPermissions,
  onClose,
  onChanged,
}: {
  detail: OrderDetail;
  canWrite: boolean;
  canShopifyEdit: boolean;
  canReadProducts: boolean;
  canReadListings: boolean;
  fulfillmentPermissions: {
    read: boolean;
    allocate: boolean;
    pick: boolean;
    pack: boolean;
    ship: boolean;
    weighOverride: boolean;
    correct: boolean;
    exceptions: boolean;
    cancel: boolean;
  };
  onClose: () => void;
  onChanged: (detail: OrderDetail) => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [target, setTarget] = useState<OrderStatus | "">("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [fulfillmentMessage, setFulfillmentMessage] = useState("");

  useEffect(() => {
    closeButton.current?.focus();
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key !== "Tab" || !dialog.current) {
      return;
    }

    const elements = focusableElements(dialog.current);
    const first = elements[0];
    const last = elements[elements.length - 1];

    if (!first || !last) {
      event.preventDefault();
      return;
    }

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const submit = async () => {
    if (!target || submitting) {
      return;
    }

    if (target === "HOLD" && !reason.trim()) {
      setMessage("挂起订单时必须填写原因。");
      return;
    }

    if (
      target === "READY_TO_FULFILL" &&
      !window.confirm("请确认所有订单明细已匹配 SKU 后再进入履约状态。")
    ) {
      return;
    }

    setSubmitting(true);
    setMessage("");

    try {
      const changed = await orderCenterApi.changeStatus(detail.id, {
        version: detail.version,
        targetStatus: target,
        reason: target === "HOLD" ? reason.trim() : undefined,
      });

      onChanged(changed);
      setTarget("");
      setReason("");
    } catch (error) {
      setMessage(safeOrderError(error));
    } finally {
      setSubmitting(false);
    }
  };

  const targets = allowedTargets(detail.status);

  return (
    <div className="dialog-backdrop">
      <section
        ref={dialog}
        aria-labelledby="order-detail-title"
        aria-modal="true"
        className="write-dialog order-detail-dialog"
        role="dialog"
        onKeyDown={onKeyDown}
      >
        <header className="order-detail-header">
          <div>
            <span className="order-detail-eyebrow">订单详情</span>
            <h2 id="order-detail-title">
              {orderDisplayReference(
                detail,
                detail.profile.customOrderReference,
              )}
            </h2>
            <div className="order-detail-context">
              <span>买家参考：{detail.buyerReference || "—"}</span>
              <span className="status-chip">{orderStatusLabel(detail.status)}</span>
            </div>
          </div>
          <DialogCloseButton ref={closeButton} onClick={onClose} />
        </header>

        <section
          className="order-detail-section order-detail-summary"
          aria-labelledby="order-information-title"
        >
          <div className="order-detail-section-heading">
            <h3 id="order-information-title">订单信息</h3>
            <span>{detail.currency}</span>
          </div>
          <dl className="order-overview-metrics">
            <div><dt>平台状态</dt><dd>{detail.platformStatus || "—"}</dd></div>
            <div><dt>付款状态</dt><dd>{detail.paymentStatus || "—"}</dd></div>
            <div><dt>物流渠道</dt><dd>{detail.logisticsChannel || detail.buyerSelectedLogistics || "—"}</dd></div>
            <div><dt>物流跟踪</dt><dd>{detail.trackingStatus || "—"}</dd></div>
            <div><dt>目的地</dt><dd>{[detail.countryCode, detail.province, detail.postalCode].filter(Boolean).join(" / ") || "—"}</dd></div>
            <div><dt>订单金额</dt><dd>{detail.totalAmountMinor === undefined ? "—" : formatMinor(detail.totalAmountMinor, detail.currency)}</dd></div>
            <div><dt>运费</dt><dd>{detail.shippingAmountMinor === undefined ? "—" : formatMinor(detail.shippingAmountMinor, detail.currency)}</dd></div>
            <div><dt>重量</dt><dd>{detail.weightGrams === undefined ? "—" : `${detail.weightGrams} 克`}</dd></div>
            <div><dt>付款时间</dt><dd><OrderDateTime value={detail.paidAt} /></dd></div>
            <div><dt>最晚发货</dt><dd><OrderDateTime value={detail.shipByAt} /></dd></div>
            <div><dt>发货时间</dt><dd><OrderDateTime value={detail.shippedAt} /></dd></div>
            <div><dt>处理标记</dt><dd>{detail.printed ? "已打印" : "未打印"}{detail.reshipment ? " / 补发" : ""}</dd></div>
          </dl>
        </section>

        <details className="order-advanced-filters order-detail-disclosure" open>
          <summary>收件人、地址与物流资料</summary>
          <dl className="order-overview-metrics">
            <div><dt>收件人</dt><dd>{detail.profile.recipientName || "—"}</dd></div>
            <div><dt>联系电话</dt><dd>{detail.profile.recipientPhone || "—"}</dd></div>
            <div><dt>联系邮箱</dt><dd>{detail.profile.recipientEmail || "—"}</dd></div>
            <div><dt>公司</dt><dd>{detail.profile.recipientCompany || "—"}</dd></div>
            <div>
              <dt>地址</dt>
              <dd>
                {[
                  detail.profile.addressLine1,
                  detail.profile.addressLine2,
                  detail.profile.city,
                  detail.profile.district,
                  detail.profile.town,
                  detail.profile.doorCode,
                ].filter(Boolean).join(" / ") || "—"}
              </dd>
            </div>
            <div><dt>物流服务</dt><dd>{detail.profile.shippingService || "—"}</dd></div>
            <div><dt>跟踪号</dt><dd>{detail.profile.trackingReference || "—"}</dd></div>
            <div><dt>第二跟踪号</dt><dd>{detail.profile.secondaryTrackingReference || "—"}</dd></div>
            <div><dt>仓库</dt><dd>{detail.warehouseId || "未分配"}</dd></div>
            <div><dt>仓位</dt><dd>{detail.profile.locationId || "未分配"}</dd></div>
          </dl>
        </details>

        <details className="order-advanced-filters order-detail-disclosure">
          <summary>平台留言、备注与申报</summary>
          <dl className="order-overview-metrics">
            <div><dt>平台留言</dt><dd>{detail.profile.platformMessage || "—"}</dd></div>
            <div><dt>平台备注</dt><dd>{detail.profile.platformRemark || "—"}</dd></div>
            <div><dt>订单备注</dt><dd>{detail.profile.orderRemark || "—"}</dd></div>
            <div><dt>申报方案</dt><dd>{detail.profile.declarationPlan || "—"}</dd></div>
            <div><dt>实际申报</dt><dd>{detail.profile.declarationActual || "—"}</dd></div>
          </dl>
        </details>

        <details className="order-advanced-filters order-detail-disclosure">
          <summary>费用、利润与税费</summary>
          <dl className="order-overview-metrics">
            {([
              ["itemAmountMinor", "商品金额"],
              ["platformFeeMinor", "平台费"],
              ["insuranceFeeMinor", "保险费"],
              ["paymentFeeMinor", "支付费"],
              ["otherIncomeMinor", "其他收入"],
              ["otherExpenseMinor", "其他支出"],
              ["actualPaidMinor", "实付金额"],
              ["profitMinor", "利润（人工录入）"],
              ["taxMinor", "税费（人工录入）"],
              ["estimatedShippingMinor", "预估运费"],
              ["actualShippingMinor", "实际运费"],
            ] as const).map(([key, label]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>
                  {detail.profile[key] === undefined
                    ? "—"
                    : formatMinor(detail.profile[key] as number, detail.currency)}
                </dd>
              </div>
            ))}
          </dl>
        </details>

        <details className="order-advanced-filters order-detail-disclosure">
          <summary>订单引用、分类与人员</summary>
          <dl className="order-overview-metrics">
            <div><dt>销售记录号</dt><dd>{detail.profile.salesRecordNumber || "—"}</dd></div>
            <div><dt>购物车号</dt><dd>{detail.profile.shoppingCartReference || "—"}</dd></div>
            <div><dt>自定义订单号</dt><dd>{detail.profile.customOrderReference || "—"}</dd></div>
            <div><dt>客户</dt><dd>{[detail.profile.customerId, detail.profile.customerCode].filter(Boolean).join(" / ") || "—"}</dd></div>
            <div><dt>客户分类</dt><dd>{detail.profile.customerCategory || "—"}</dd></div>
            <div><dt>供应商</dt><dd>{detail.profile.supplierReference || "—"}</dd></div>
            <div><dt>商品目录</dt><dd>{[detail.profile.parentProductCategory, detail.profile.childProductCategory].filter(Boolean).join(" / ") || "—"}</dd></div>
            <div><dt>商品状态 / 扩展属性</dt><dd>{[detail.profile.productStatus, detail.profile.extendedAttribute].filter(Boolean).join(" / ") || "—"}</dd></div>
            <div><dt>商品种类</dt><dd>{detail.profile.productKindCount ?? "—"}</dd></div>
            <div><dt>配货 / 发货人员</dt><dd>{[detail.profile.pickerUserId, detail.profile.shipperUserId].filter(Boolean).join(" / ") || "—"}</dd></div>
            <div><dt>采购 / 订单负责人</dt><dd>{[
              detail.profile.purchaserUserId,
              detail.profile.managerUserId,
            ].filter(Boolean).join(" / ") || "—"}</dd></div>
          </dl>
        </details>

        {canWrite && (
          <ShopifyShippingAddressEditor
            detail={detail}
            onChanged={onChanged}
          />
        )}

        <ShopifyOrderCancellationEditor
          detail={detail}
          canCancel={canShopifyEdit}
          onChanged={onChanged}
        />

        {canWrite && (
          <OrderProfileEditor detail={detail} onChanged={onChanged} />
        )}

        <section
          className="order-detail-section order-detail-line-section"
          aria-labelledby="order-lines-title"
        >
          <div className="order-detail-section-heading">
            <h3 id="order-lines-title">商品信息</h3>
            <span>共 {detail.lines.length} 条明细</span>
          </div>
          <ShopifyVariantAdder
            detail={detail}
            canEdit={canShopifyEdit}
            canReadListings={canReadListings}
            onChanged={onChanged}
          />
          <ShopifyCustomItemAdder
            detail={detail}
            canEdit={canShopifyEdit}
            onChanged={onChanged}
          />
          <div className="shop-table-scroll">
            <table className="shop-table">
              <thead>
                <tr>
                  <th>商品标题</th>
                  <th>SKU</th>
                  <th>匹配信息</th>
                  <th>外部引用</th>
                  <th>数量</th>
                  <th>单价</th>
                  <th>折扣</th>
                  <th>仓库 / 库位</th>
                  <th>采购引用</th>
                </tr>
              </thead>
              <tbody>
                {detail.lines.map((line) => (
                  <tr key={line.id}>
                    <td>{line.titleSnapshot}</td>
                    <td>{line.skuCode || (line.skuId ? "已匹配" : "未匹配")}</td>
                    <td>
                      {line.lineKind === "CUSTOM_AMOUNT" ? (
                        <span>自定义金额，无需 SKU 匹配</span>
                      ) : (
                        <LineSkuMatch
                          canReadProducts={canReadProducts}
                          canWrite={canWrite}
                          line={line}
                          orderId={detail.id}
                          orderStatus={detail.status}
                          version={detail.version}
                          onChanged={onChanged}
                        />
                      )}
                    </td>
                    <td>
                      刊登：{line.externalListingRef || "—"}
                      <br />
                      变体：{line.externalVariantRef || "—"}
                    </td>
                    <td>
                      <ShopifyLineQuantityEditor
                        detail={detail}
                        line={line}
                        canEdit={canShopifyEdit}
                        onChanged={onChanged}
                      />
                    </td>
                    <td>{formatMinor(line.unitPriceMinor, line.currency)}</td>
                    <td>
                      <ShopifyLineDiscountEditor
                        detail={detail}
                        line={line}
                        canEdit={canShopifyEdit}
                        onChanged={onChanged}
                      />
                    </td>
                    <td>{line.warehouseId || "—"}<br /><small>{line.locationId || "—"}</small></td>
                    <td>{line.purchaseReference || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <details className="order-advanced-filters order-detail-disclosure">
          <summary>操作日志（{detail.activities.length}）</summary>
          {detail.activities.length === 0 ? (
            <p>暂无操作日志。</p>
          ) : (
            <ol>
              {detail.activities.map((activity) => (
                <li key={activity.id}>
                  <OrderDateTime value={activity.createdAt} /> ·{" "}
                  {activity.safeSummary}
                </li>
              ))}
            </ol>
          )}
        </details>

        <FulfillmentWorkflow
          detail={detail}
          permissions={fulfillmentPermissions}
          onOrderChanged={onChanged}
          operationMessage={fulfillmentMessage}
          setOperationMessage={setFulfillmentMessage}
        />

        {canWrite && targets.length > 0 && (
          <section
            className="order-detail-section order-detail-status-panel"
            aria-labelledby="order-status-change-title"
          >
            <div className="order-detail-section-heading">
              <h3 id="order-status-change-title">订单状态变更</h3>
              <span>当前：{orderStatusLabel(detail.status)}</span>
            </div>
            <div className="detail-form">
              <label htmlFor="target-status">
                目标状态
                <select
                  id="target-status"
                  disabled={submitting}
                  value={target}
                  onChange={(event) => {
                    const nextTarget = event.target.value as OrderStatus | "";
                    setTarget(nextTarget);
                    setMessage("");
                    if (nextTarget !== "HOLD") {
                      setReason("");
                    }
                  }}
                >
                  <option value="">请选择</option>
                  {targets.map((status) => (
                    <option key={status} value={status}>
                      {orderStatusLabel(status)}
                    </option>
                  ))}
                </select>
              </label>

              {target === "HOLD" && (
                <label htmlFor="reason">
                  挂起原因
                  <input
                    id="reason"
                    disabled={submitting}
                    maxLength={500}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </label>
              )}

              {message && <p role="alert">{message}</p>}

              <button
                className="button button-primary"
                disabled={!target || submitting}
                type="button"
                onClick={() => void submit()}
              >
                {submitting ? "正在提交…" : "确认变更"}
              </button>
            </div>
          </section>
        )}
      </section>
    </div>
  );
}

function profileInputFromDetail(detail: OrderDetail): OrderProfileInput {
  const profile = detail.profile;
  return {
    references: {
      salesRecordNumber: profile.salesRecordNumber,
      shoppingCartReference: profile.shoppingCartReference,
      customOrderReference: profile.customOrderReference,
      customerId: profile.customerId,
      customerCode: profile.customerCode,
      shippingService: profile.shippingService,
      trackingReference: profile.trackingReference,
      secondaryTrackingReference: profile.secondaryTrackingReference,
    },
    recipient: {
      name: profile.recipientName,
      phone: profile.recipientPhone,
      email: profile.recipientEmail,
      company: profile.recipientCompany,
      addressLine1: profile.addressLine1,
      addressLine2: profile.addressLine2,
      city: profile.city,
      district: profile.district,
      town: profile.town,
      doorCode: profile.doorCode,
    },
    financials: {
      itemAmountMinor: profile.itemAmountMinor,
      platformFeeMinor: profile.platformFeeMinor,
      insuranceFeeMinor: profile.insuranceFeeMinor,
      paymentFeeMinor: profile.paymentFeeMinor,
      otherIncomeMinor: profile.otherIncomeMinor,
      otherExpenseMinor: profile.otherExpenseMinor,
      actualPaidMinor: profile.actualPaidMinor,
      profitMinor: profile.profitMinor,
      taxMinor: profile.taxMinor,
      estimatedShippingMinor: profile.estimatedShippingMinor,
      actualShippingMinor: profile.actualShippingMinor,
    },
    messages: {
      platformMessage: profile.platformMessage,
      platformRemark: profile.platformRemark,
      orderRemark: profile.orderRemark,
      declarationPlan: profile.declarationPlan,
      declarationActual: profile.declarationActual,
    },
    classification: {
      customerCategory: profile.customerCategory,
      productKindCount: profile.productKindCount,
      supplierReference: profile.supplierReference,
      parentProductCategory: profile.parentProductCategory,
      childProductCategory: profile.childProductCategory,
      productStatus: profile.productStatus,
      extendedAttribute: profile.extendedAttribute,
    },
    assignments: {
      locationId: profile.locationId,
      pickerUserId: profile.pickerUserId,
      shipperUserId: profile.shipperUserId,
      salespersonUserId: profile.salespersonUserId,
      purchaserUserId: profile.purchaserUserId,
      developerUserId: profile.developerUserId,
      managerUserId: profile.managerUserId,
    },
    times: {
      printedAt: profile.printedAt,
      platformReturnedAt: profile.platformReturnedAt,
      exceptionReviewedAt: profile.exceptionReviewedAt,
      cancelledAt: profile.cancelledAt,
      handedOverAt: profile.handedOverAt,
      platformSpecifiedHandoverAt:
        profile.platformSpecifiedHandoverAt,
      platformLabelRequestedAt: profile.platformLabelRequestedAt,
      deliveryDeadlineAt: profile.deliveryDeadlineAt,
      deliveredAt: profile.deliveredAt,
    },
  };
}

function operationalInputFromDetail(
  detail: OrderDetail,
): OrderOperationalInput {
  return {
    paymentStatus: detail.paymentStatus,
    platformStatus: detail.platformStatus,
    logisticsChannel: detail.logisticsChannel,
    countryCode: detail.countryCode,
    province: detail.province,
    postalCode: detail.postalCode,
    buyerSelectedLogistics: detail.buyerSelectedLogistics,
    totalAmountMinor: detail.totalAmountMinor,
    shippingAmountMinor: detail.shippingAmountMinor,
    weightGrams: detail.weightGrams,
    paidAt: detail.paidAt,
    shipByAt: detail.shipByAt,
    shippedAt: detail.shippedAt,
    trackingStatus: detail.trackingStatus,
    fixedCategory: detail.fixedCategory,
    customCategory: detail.customCategory,
    reshipment: detail.reshipment,
    reshipmentReason: detail.reshipmentReason,
    platformHandoverRequired: detail.platformHandoverRequired,
    printed: detail.printed,
  };
}

type ShopifyShippingAddressForm = ShopifyShippingAddressUpdateInput["address"] & {
  firstName: string;
  lastName: string;
  company: string;
  address2: string;
  provinceCode: string;
  zip: string;
  phone: string;
};

function shopifyShippingAddressFromDetail(
  detail: OrderDetail,
): ShopifyShippingAddressForm {
  const recipientName = (detail.profile.recipientName ?? "").trim();
  const nameParts = recipientName.split(/\s+/).filter(Boolean);
  const lastName = nameParts.length > 1 ? nameParts.pop() ?? "" : "";
  return {
    firstName: nameParts.join(" ").slice(0, 100),
    lastName: lastName.slice(0, 100),
    company: (detail.profile.recipientCompany ?? "").slice(0, 200),
    address1: detail.profile.addressLine1 ?? "",
    address2: detail.profile.addressLine2 ?? "",
    city: detail.profile.city ?? "",
    provinceCode: (detail.province ?? "").slice(0, 32).toUpperCase(),
    countryCode: (detail.countryCode ?? "").slice(0, 2).toUpperCase(),
    zip: (detail.postalCode ?? "").slice(0, 32),
    phone: (detail.profile.recipientPhone ?? "").slice(0, 40),
  };
}

function ShopifyShippingAddressEditor({
  detail,
  onChanged,
}: {
  detail: OrderDetail;
  onChanged: (detail: OrderDetail) => void;
}) {
  const [address, setAddress] = useState<ShopifyShippingAddressForm>(
    () => shopifyShippingAddressFromDetail(detail),
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const isShopifyOrder = detail.externalOrderRef.startsWith(
    "gid://shopify/Order/",
  );
  const fulfillmentStarted = [
    "FULFILLING",
    "SHIPPED",
    "DELIVERED",
    "CANCELLED",
  ].includes(detail.status);

  useEffect(() => {
    setAddress(shopifyShippingAddressFromDetail(detail));
  }, [detail.id, detail.version, detail.profile.version]);

  if (!isShopifyOrder) return null;

  const setField = (key: keyof ShopifyShippingAddressForm, value: string) => {
    setAddress((current) => ({ ...current, [key]: value }));
    setMessage("");
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || fulfillmentStarted) return;
    if (!/^[A-Z]{2}$/.test(address.countryCode)) {
      setMessage("国家/地区代码必须是两个大写英文字母。");
      return;
    }
    if (!window.confirm("确认将当前收货地址直接写回 Shopify 订单？")) {
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const result = await orderCenterApi.updateShopifyShippingAddress(
        detail.id,
        {
          version: detail.version,
          profileVersion: detail.profile.version,
          idempotencyKey: `web.${crypto.randomUUID()}`,
          address,
        },
      );
      onChanged(result.order);
      setMessage(
        result.replayed
          ? "该地址修改已处理，ERP 已恢复最新结果。"
          : "收货地址已写回 Shopify，并同步到 ERP。",
      );
    } catch (error) {
      setMessage(safeOrderError(error));
    } finally {
      setBusy(false);
    }
  };

  const fields = [
    ["firstName", "名", 100],
    ["lastName", "姓", 100],
    ["company", "公司", 200],
    ["address1", "地址 1", 300],
    ["address2", "地址 2", 300],
    ["city", "城市", 120],
    ["provinceCode", "省/州代码", 32],
    ["countryCode", "国家/地区代码", 2],
    ["zip", "邮编", 32],
    ["phone", "联系电话", 40],
  ] as const;

  return (
    <details className="order-advanced-filters order-detail-disclosure">
      <summary>写回 Shopify 收货地址</summary>
      <form className="detail-form" onSubmit={(event) => void submit(event)}>
        <p>
          此操作会直接修改 Shopify 订单，并把平台返回的标准化地址同步回 ERP。
        </p>
        {fulfillmentStarted && (
          <p role="status">订单已进入履约或结束状态，不能再修改平台收货地址。</p>
        )}
        {fields.map(([key, label, maxLength]) => (
          <label key={key}>
            {`Shopify ${label}`}
            <input
              disabled={busy || fulfillmentStarted}
              maxLength={maxLength}
              required={key === "address1" || key === "city" || key === "countryCode"}
              value={address[key]}
              onChange={(event) => setField(
                key,
                key === "countryCode" || key === "provinceCode"
                  ? event.target.value.toUpperCase()
                  : event.target.value,
              )}
            />
          </label>
        ))}
        {message && <p role="alert">{message}</p>}
        <button
          className="button button-primary"
          disabled={busy || fulfillmentStarted}
          type="submit"
        >
          {busy ? "正在写回…" : "写回 Shopify"}
        </button>
      </form>
    </details>
  );
}

function OrderProfileEditor({
  detail,
  onChanged,
}: {
  detail: OrderDetail;
  onChanged: (detail: OrderDetail) => void;
}) {
  const [warehouseId, setWarehouseId] = useState(detail.warehouseId ?? "");
  const [profile, setProfile] =
    useState<OrderProfileInput>(() => profileInputFromDetail(detail));
  const [operational, setOperational] =
    useState<OrderOperationalInput>(
      () => operationalInputFromDetail(detail),
    );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const options = useOrderFilterOptions(warehouseId);

  useEffect(() => {
    setWarehouseId(detail.warehouseId ?? "");
    setProfile(profileInputFromDetail(detail));
    setOperational(operationalInputFromDetail(detail));
  }, [detail]);

  const text = (
    group: "references" | "recipient" | "messages" | "classification",
    key: string,
  ) => String(
    (profile[group] as Record<string, unknown> | undefined)?.[key] ?? "",
  );
  const setText = (
    group: "references" | "recipient" | "messages" | "classification",
    key: string,
    value: string,
  ) => setProfile((current) => ({
    ...current,
    [group]: {
      ...(current[group] as Record<string, unknown> | undefined),
      [key]: value.trim() ? value : undefined,
    },
  }));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const changed = await orderCenterApi.updateProfile(detail.id, {
        version: detail.version,
        profileVersion: detail.profile.version,
        warehouseId: warehouseId || undefined,
        operational,
        profile,
      });
      onChanged(changed);
      setMessage("订单资料已更新。");
    } catch (error) {
      setMessage(safeOrderError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="order-advanced-filters order-detail-disclosure">
      <summary>编辑订单资料</summary>
      <form className="detail-form" onSubmit={(event) => void submit(event)}>
        <label>
          仓库
          <select
            value={warehouseId}
            onChange={(event) => {
              setWarehouseId(event.target.value);
              setProfile((current) => ({
                ...current,
                assignments: {
                  ...current.assignments,
                  locationId: undefined,
                },
              }));
            }}
          >
            <option value="">未分配</option>
            {options.warehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.businessCode} · {warehouse.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          仓位
          <select
            disabled={!warehouseId}
            value={profile.assignments?.locationId ?? ""}
            onChange={(event) => setProfile((current) => ({
              ...current,
              assignments: {
                ...current.assignments,
                locationId: event.target.value || undefined,
              },
            }))}
          >
            <option value="">未分配</option>
            {options.locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.businessCode} · {location.name}
              </option>
            ))}
          </select>
        </label>
        {([
          ["recipient", "name", "收件人", 200],
          ["recipient", "phone", "联系电话", 40],
          ["recipient", "email", "联系邮箱", 254],
          ["recipient", "company", "公司", 200],
          ["recipient", "addressLine1", "地址 1", 300],
          ["recipient", "addressLine2", "地址 2", 300],
          ["recipient", "city", "城市", 120],
          ["recipient", "district", "区 / 县", 120],
          ["recipient", "town", "乡镇", 120],
          ["recipient", "doorCode", "门牌 / 门禁", 80],
          ["references", "shippingService", "物流服务", 120],
          ["references", "trackingReference", "物流跟踪号", 160],
          ["references", "secondaryTrackingReference", "第二跟踪号", 160],
          ["messages", "platformMessage", "平台留言", 1000],
          ["messages", "platformRemark", "平台备注", 1000],
          ["messages", "orderRemark", "订单备注", 1000],
          ["messages", "declarationPlan", "申报方案", 1000],
          ["messages", "declarationActual", "实际申报", 1000],
          ["classification", "customerCategory", "客户分类", 80],
          ["classification", "supplierReference", "供应商", 160],
          ["classification", "parentProductCategory", "父商品目录", 120],
          ["classification", "childProductCategory", "子商品目录", 120],
          ["classification", "productStatus", "商品状态", 40],
          ["classification", "extendedAttribute", "扩展属性", 160],
        ] as const).map(([group, key, label, maxLength]) => (
          <label key={`${group}.${key}`}>
            {label}
            {maxLength > 300 ? (
              <textarea
                maxLength={maxLength}
                value={text(group, key)}
                onChange={(event) =>
                  setText(group, key, event.target.value)
                }
              />
            ) : (
              <input
                maxLength={maxLength}
                value={text(group, key)}
                onChange={(event) =>
                  setText(group, key, event.target.value)
                }
              />
            )}
          </label>
        ))}
        <label>
          订单物流渠道（记录）
          <input
            maxLength={80}
            value={operational.logisticsChannel ?? ""}
            onChange={(event) => setOperational((current) => ({
              ...current,
              logisticsChannel: event.target.value || undefined,
            }))}
          />
        </label>
        <label>
          跟踪状态
          <input
            maxLength={32}
            value={operational.trackingStatus ?? ""}
            onChange={(event) => setOperational((current) => ({
              ...current,
              trackingStatus: event.target.value || undefined,
            }))}
          />
        </label>
        <label>
          包裹重量（克）
          <input
            min="0.001"
            step="0.001"
            type="number"
            value={operational.weightGrams ?? ""}
            onChange={(event) => setOperational((current) => ({
              ...current,
              weightGrams: event.target.value === ""
                ? undefined : Number(event.target.value),
            }))}
          />
        </label>
        {message && <p role={message.includes("已更新") ? "status" : "alert"}>{message}</p>}
        <button
          className="button button-primary"
          disabled={busy}
          type="submit"
        >
          {busy ? "正在保存…" : "保存订单资料"}
        </button>
      </form>
    </details>
  );
}

function ShopifyFulfillmentPublishForm({
  planId,
  item,
  busy,
  execute,
}: {
  planId: string;
  item: FulfillmentPlan["packages"][number];
  busy: boolean;
  execute: (
    command: () => Promise<FulfillmentPlan>,
    success: string,
  ) => Promise<void>;
}) {
  const [trackingUrl, setTrackingUrl] = useState(
    item.shopifyTrackingUrl ?? "",
  );
  const [notifyCustomer, setNotifyCustomer] = useState(
    item.shopifyNotifyCustomer ?? true,
  );

  useEffect(() => {
    setTrackingUrl(item.shopifyTrackingUrl ?? "");
    setNotifyCustomer(item.shopifyNotifyCustomer ?? true);
  }, [
    item.id,
    item.shopifyNotifyCustomer,
    item.shopifyTrackingUrl,
  ]);

  return (
    <div className="detail-form">
      <h4>回传 Shopify 发货</h4>
      <p>
        跟踪号：{item.trackingReference || "未填写"} · 承运商：
        {item.carrierCode || "未填写"}
      </p>
      {item.shopifyPublicationStatus === "UNCERTAIN" && (
        <p role="status">
          上次结果不确定；重试时会先按跟踪号和商品明细核对 Shopify，避免重复发货。
        </p>
      )}
      <label>
        Shopify 物流查询链接（可选）
        <input
          disabled={busy || item.shopifyPublicationStatus === "UNCERTAIN"}
          maxLength={2048}
          placeholder="https://…"
          type="url"
          value={trackingUrl}
          onChange={(event) => setTrackingUrl(event.target.value)}
        />
      </label>
      <label>
        <input
          checked={notifyCustomer}
          disabled={busy || item.shopifyPublicationStatus === "UNCERTAIN"}
          type="checkbox"
          onChange={(event) => setNotifyCustomer(event.target.checked)}
        />
        通知 Shopify 客户
      </label>
      {item.shopifyPublicationStatus === "UNCERTAIN" && (
        <small>为保证幂等恢复，核对重试会沿用首次提交参数。</small>
      )}
      <button
        className="button button-primary"
        disabled={busy || !item.trackingReference}
        type="button"
        onClick={() => void execute(
          () => orderCenterApi.publishShopifyFulfillment(
            planId,
            item.id,
            {
              idempotencyKey: `web.shopify-fulfillment.${item.id}`,
              notifyCustomer,
              trackingUrl: trackingUrl.trim() || undefined,
            },
          ).then((result) => result.plan),
          item.shopifyPublicationStatus === "UNCERTAIN"
            ? "已完成 Shopify 发货核对与回传。"
            : "发货与物流信息已回传 Shopify。",
        )}
      >
        {item.shopifyPublicationStatus === "UNCERTAIN"
          ? "核对并重试回传"
          : "回传 Shopify 发货"}
      </button>
    </div>
  );
}

function playWeighingAlert(): void {
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(740, context.currentTime);
    oscillator.frequency.setValueAtTime(520, context.currentTime + 0.16);
    gain.gain.setValueAtTime(0.08, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.32);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.32);
    oscillator.addEventListener("ended", () => void context.close(), { once: true });
  } catch {
    // Visible blocking feedback remains available when browser audio is unavailable.
  }
}

function FulfillmentWorkflow({
  detail,
  permissions,
  onOrderChanged,
  operationMessage,
  setOperationMessage,
}: {
  detail: OrderDetail;
  permissions: {
    read: boolean;
    allocate: boolean;
    pick: boolean;
    pack: boolean;
    ship: boolean;
    weighOverride: boolean;
    correct: boolean;
    exceptions: boolean;
    cancel: boolean;
  };
  onOrderChanged: (detail: OrderDetail) => void;
  operationMessage: string;
  setOperationMessage: (message: string) => void;
}) {
  const [plan, setPlan] = useState<FulfillmentPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [allocationWarehouse, setAllocationWarehouse] =
    useState(detail.warehouseId ?? "");
  const [allocationLocation, setAllocationLocation] = useState("");
  const [packageNumber, setPackageNumber] = useState("");
  const [packageWarehouse, setPackageWarehouse] =
    useState(detail.warehouseId ?? "");
  const [manualLogistics, setManualLogistics] = useState<Record<
    string,
    { carrierCode: string; serviceCode: string; trackingReference: string }
  >>({});
  const [logisticsChannels, setLogisticsChannels] = useState<
    LogisticsAuthorizationChannel[]
  >([]);
  const [logisticsChannelChoice, setLogisticsChannelChoice] = useState<
    Record<string, string>
  >({});
  const [weightGrams, setWeightGrams] = useState<Record<string, string>>({});
  const [packagingChoice, setPackagingChoice] = useState<Record<string, string>>({});
  const [scaleChoice, setScaleChoice] = useState<Record<string, string>>({});
  const [packagingOptions, setPackagingOptions] = useState<
    Record<string, ShippingPackagingTemplate[]>
  >({});
  const [scaleOptions, setScaleOptions] = useState<Record<string, ShippingScale[]>>({});
  const options = useOrderFilterOptions(
    allocationWarehouse || packageWarehouse,
  );
  const active = [
    "FULFILLING",
    "SHIPPED",
    "DELIVERED",
  ].includes(detail.status);

  useEffect(() => {
    if (!permissions.read || !active) {
      setPlan(null);
      return;
    }
    let current = true;
    setLoading(true);
    setOperationMessage("");
    void orderCenterApi.getFulfillmentPlanByOrder(detail.id)
      .then((value) => {
        if (current) setPlan(value);
      })
      .catch((error: unknown) => {
        if (current) setOperationMessage(safeOrderError(error));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [active, detail.id, permissions.read]);

  useEffect(() => {
    if (!permissions.ship || !active) {
      setLogisticsChannels([]);
      return;
    }
    let current = true;
    void logisticsAuthorizationApi.listEnabledChannels()
      .then((items) => {
        if (current) setLogisticsChannels(items);
      })
      .catch((error: unknown) => {
        if (current) setOperationMessage(safeOrderError(error));
      });
    return () => {
      current = false;
    };
  }, [active, permissions.ship, setOperationMessage]);

  const shippingWarehouseKey = useMemo(
    () => [...new Set(plan?.packages.map((item) => item.warehouseId) ?? [])]
      .sort()
      .join(","),
    [plan?.packages],
  );

  useEffect(() => {
    if (!permissions.read || !shippingWarehouseKey) return;
    let current = true;
    const warehouseIds = shippingWarehouseKey.split(",");
    void Promise.all(warehouseIds.map(async (warehouseId) => ({
      warehouseId,
      packaging: await orderCenterApi.listShippingPackagingTemplates(warehouseId),
      scales: await orderCenterApi.listShippingScales(warehouseId),
    }))).then((items) => {
      if (!current) return;
      setPackagingOptions(Object.fromEntries(
        items.map((item) => [item.warehouseId, item.packaging]),
      ));
      setScaleOptions(Object.fromEntries(
        items.map((item) => [item.warehouseId, item.scales]),
      ));
    }).catch((error: unknown) => {
      if (current) setOperationMessage(safeOrderError(error));
    });
    return () => {
      current = false;
    };
  }, [permissions.read, shippingWarehouseKey]);

  const execute = async (
    command: () => Promise<FulfillmentPlan>,
    success: string,
  ) => {
    if (busy) return;
    setBusy(true);
    setOperationMessage("");
    try {
      const changed = await command();
      setPlan(changed);
      setOperationMessage(success);
      onOrderChanged(await orderCenterApi.get(detail.id));
    } catch (error) {
      setOperationMessage(safeOrderError(error));
    } finally {
      setBusy(false);
    }
  };

  const renderLogisticsShipment = (
    item: FulfillmentPlan["packages"][number],
  ) => {
    const selectedChannel = logisticsChannels.find(
      (channel) => channel.id === logisticsChannelChoice[item.id],
    ) ?? (logisticsChannels.length === 1 ? logisticsChannels[0] : undefined);
    const bookingReady = item.logisticsBookingStatus === "NOT_REQUESTED" ||
      item.logisticsBookingStatus === "FAILED";
    const manual = manualLogistics[item.id] ?? {
      carrierCode: "",
      serviceCode: "",
      trackingReference: "",
    };
    const updateManual = (
      field: keyof typeof manual,
      value: string,
    ) => setManualLogistics((current) => ({
      ...current,
      [item.id]: { ...manual, [field]: value },
    }));
    const hasProviderShipment = item.logisticsBookingStatus === "BOOKED" ||
      item.logisticsBookingStatus === "UNCERTAIN" ||
      item.logisticsBookingStatus === "BOOKING";

    return (
      <section
        className="fulfillment-logistics-panel"
        aria-label={`包裹 ${item.packageNumber} 物流处理`}
      >
        <div className="fulfillment-logistics-heading">
          <div>
            <h4>物流运单</h4>
            <p>
              {item.logisticsProviderName
                ? `${item.logisticsProviderName}${item.logisticsAccountLabel ? ` · ${item.logisticsAccountLabel}` : ""}`
                : "从已启用的物流渠道获取运单"}
            </p>
          </div>
          <span className={`status-badge ${
            item.logisticsBookingStatus === "BOOKED"
              ? "is-success"
              : item.logisticsBookingStatus === "FAILED" ||
                  item.logisticsTrackingStatus === "EXCEPTION"
                ? "is-danger"
                : item.logisticsBookingStatus === "UNCERTAIN"
                  ? "is-warning"
                  : ""
          }`}>
            {logisticsBookingStatusLabels[item.logisticsBookingStatus]}
          </span>
        </div>

        {bookingReady && (
          <div className="fulfillment-logistics-booking">
            <label>
              物流渠道
              <select
                value={selectedChannel?.id ?? ""}
                onChange={(event) => setLogisticsChannelChoice((current) => ({
                  ...current,
                  [item.id]: event.target.value,
                }))}
              >
                <option value="">请选择已启用渠道</option>
                {logisticsChannels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channel.providerName} · {channel.accountLabel} · {channel.channelName}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button button-primary"
              disabled={busy || !selectedChannel}
              type="button"
              onClick={() => selectedChannel && void execute(
                () => orderCenterApi.bookLogisticsShipment(
                  plan!.id,
                  item.id,
                  {
                    packageVersion: item.version,
                    authorizationId: selectedChannel.authorizationId,
                    channelId: selectedChannel.id,
                    idempotencyKey: `web.logistics-booking.${item.id}`,
                  },
                ),
                "物流运单已获取；请核对单号和面单后确认交运。",
              )}
            >
              {busy ? "正在获取…" : "获取运单"}
            </button>
            {logisticsChannels.length === 0 && (
              <p role="status">暂无已启用渠道，请先在物流授权中启用渠道。</p>
            )}
          </div>
        )}

        {hasProviderShipment && (
          <>
            <dl className="fulfillment-logistics-summary">
              <div>
                <dt>渠道</dt>
                <dd>{item.logisticsChannelName || "待确认"}</dd>
              </div>
              <div>
                <dt>物流单号</dt>
                <dd>{item.trackingReference || "待返回"}</dd>
              </div>
              <div>
                <dt>物流状态</dt>
                <dd>{item.logisticsTrackingStatus
                  ? logisticsTrackingStatusLabels[item.logisticsTrackingStatus]
                  : "待同步"}</dd>
              </div>
              <div>
                <dt>最近同步</dt>
                <dd>{item.logisticsLastSyncedAt
                  ? formatOrderDateTime(item.logisticsLastSyncedAt)
                  : "尚未同步"}</dd>
              </div>
            </dl>
            {item.logisticsTrackingSummary && (
              <p className="fulfillment-logistics-message">
                {item.logisticsTrackingSummary}
              </p>
            )}
            {item.logisticsSafeErrorCode && (
              <p className="fulfillment-logistics-warning" role="status">
                最近一次处理未完成，请重试；若仍失败，请检查物流商账号和渠道配置。
              </p>
            )}
            {item.logisticsProviderHandoverPending && (
              <p className="fulfillment-logistics-warning" role="status">
                ERP 发货记录已保存，物流商的交运确认正在自动重试。
              </p>
            )}
            <div className="fulfillment-logistics-actions">
              {item.logisticsLabelUrl && (
                <a
                  className="button button-secondary"
                  href={item.logisticsLabelUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  查看面单
                </a>
              )}
              <button
                className="button button-secondary"
                disabled={busy || item.logisticsBookingStatus === "BOOKING"}
                type="button"
                onClick={() => void execute(
                  () => orderCenterApi.syncLogisticsShipment(plan!.id, item.id),
                  "物流单号与轨迹已同步。",
                )}
              >
                同步物流信息
              </button>
              {item.logisticsBookingStatus === "BOOKED" && (
                <button
                  className="button button-primary"
                  disabled={busy || !item.trackingReference}
                  type="button"
                  onClick={() => void execute(
                    () => orderCenterApi.handoverBookedLogisticsShipment(
                      plan!.id,
                      item.id,
                      {
                        version: plan!.version,
                        packageVersion: item.version,
                        commandId: crypto.randomUUID(),
                        occurredAt: new Date().toISOString(),
                      },
                    ),
                    "仓库交接与发货记录已完成，物流信息将继续自动同步。",
                  )}
                >
                  确认交运并发货
                </button>
              )}
            </div>
          </>
        )}

        {!hasProviderShipment && (
          <details className="fulfillment-manual-logistics">
            <summary>自有物流或手工单号</summary>
            <div className="detail-form">
              <label>
                承运商代码
                <input
                  maxLength={64}
                  value={manual.carrierCode}
                  onChange={(event) => updateManual(
                    "carrierCode",
                    event.target.value.toUpperCase(),
                  )}
                />
              </label>
              <label>
                服务代码
                <input
                  maxLength={64}
                  value={manual.serviceCode}
                  onChange={(event) => updateManual(
                    "serviceCode",
                    event.target.value.toUpperCase(),
                  )}
                />
              </label>
              <label>
                物流单号
                <input
                  maxLength={160}
                  value={manual.trackingReference}
                  onChange={(event) => updateManual(
                    "trackingReference",
                    event.target.value,
                  )}
                />
              </label>
              <button
                className="button button-secondary"
                disabled={busy ||
                  !/^[A-Z][A-Z0-9_]{0,63}$/.test(manual.carrierCode) ||
                  (detail.externalOrderRef.startsWith(
                    "gid://shopify/Order/",
                  ) && !manual.trackingReference.trim())}
                type="button"
                onClick={() => void execute(
                  () => orderCenterApi.handoverFulfillmentPackage(
                    plan!.id,
                    item.id,
                    {
                      version: plan!.version,
                      packageVersion: item.version,
                      commandId: crypto.randomUUID(),
                      occurredAt: new Date().toISOString(),
                      carrierCode: manual.carrierCode,
                      serviceCode: manual.serviceCode || undefined,
                      trackingReference:
                        manual.trackingReference.trim() || undefined,
                    },
                  ),
                  "仓库交接已形成不可变发货记录。",
                )}
              >
                使用手工单号发货
              </button>
            </div>
          </details>
        )}
      </section>
    );
  };

  if (
    detail.status !== "READY_TO_FULFILL" &&
    !active
  ) return null;

  if (!permissions.read && detail.status !== "READY_TO_FULFILL") {
    return <p>需要履约查看权限后才能查看配货与发货进度。</p>;
  }

  const remainingToPack = plan?.lines.filter(
    (line) => line.pickedQuantity > line.packedQuantity,
  ) ?? [];

  return (
    <details
      className="order-advanced-filters order-detail-disclosure fulfillment-workbench"
      open
    >
      <summary>配货、包装验货与称重出库</summary>
      {loading && <p aria-busy="true">正在加载履约计划…</p>}
      {!plan && detail.status === "READY_TO_FULFILL" && (
        <button
          className="button button-primary"
          disabled={busy || !permissions.allocate}
          type="button"
          onClick={() => void execute(
            () => orderCenterApi.createFulfillmentPlan(
              detail.id,
              `web.plan.${detail.id}`,
            ),
            "已建立履约计划；尚未分配仓库和数量。",
          )}
        >
          {busy ? "正在建立…" : "建立履约计划"}
        </button>
      )}
      {plan && (
        <>
          <dl className="order-overview-metrics fulfillment-overview">
            <div><dt>履约状态</dt><dd>{fulfillmentStatusLabel(plan.status)}</dd></div>
            <div><dt>暂停状态</dt><dd>{fulfillmentPauseLabel(plan.pauseState)}</dd></div>
            <div><dt>缺货状态</dt><dd>{fulfillmentShortageLabel(plan.shortageState)}</dd></div>
            <div><dt>计划数量</dt><dd>{plan.plannedQuantity}</dd></div>
            <div><dt>已拣货</dt><dd>{plan.pickedQuantity}</dd></div>
            <div><dt>已包装</dt><dd>{plan.packedQuantity}</dd></div>
            <div><dt>已发货</dt><dd>{plan.shippedQuantity}</dd></div>
            <div><dt>已取消</dt><dd>{plan.cancelledQuantity}</dd></div>
          </dl>
          <section
            className="fulfillment-section"
            aria-labelledby="fulfillment-lines-title"
          >
            <div className="order-detail-section-heading">
              <h3 id="fulfillment-lines-title">履约明细</h3>
              <span>共 {plan.lines.length} 条</span>
            </div>
            <div className="shop-table-scroll">
              <table className="shop-table">
                <thead>
                  <tr>
                    <th>订单明细</th>
                    <th>拆分序号</th>
                    <th>SKU</th>
                    <th>仓库 / 仓位</th>
                    <th>计划 / 拣货 / 包装 / 发货 / 取消</th>
                    <th>库存事实</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.lines.map((line) => (
                    <tr key={line.id}>
                      <td>{line.externalLineRef}</td>
                      <td>{line.splitSequence + 1}</td>
                      <td>{line.skuBusinessCode} · {line.skuName}</td>
                      <td>{line.warehouseId || "未分配"}<br /><small>{line.locationId || "—"}</small></td>
                      <td>
                        {line.plannedQuantity} / {line.pickedQuantity} /{" "}
                        {line.packedQuantity} / {line.shippedQuantity} /{" "}
                        {line.cancelledQuantity}
                      </td>
                      <td>{line.inventoryOperationRef || "尚未预留"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {plan.status === "PENDING_ALLOCATION" && permissions.allocate && (
            <section
              className="detail-form fulfillment-action-panel"
              aria-labelledby="fulfillment-allocation-title"
            >
              <h4 id="fulfillment-allocation-title">配货分配</h4>
              <label>
                分配仓库
                <select
                  value={allocationWarehouse}
                  onChange={(event) => {
                    setAllocationWarehouse(event.target.value);
                    setAllocationLocation("");
                  }}
                >
                  <option value="">请选择仓库</option>
                  {options.warehouses
                    .filter((warehouse) => warehouse.status === "ACTIVE")
                    .map((warehouse) => (
                      <option key={warehouse.id} value={warehouse.id}>
                        {warehouse.businessCode} · {warehouse.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                分配仓位
                <select
                  disabled={!allocationWarehouse}
                  value={allocationLocation}
                  onChange={(event) =>
                    setAllocationLocation(event.target.value)
                  }
                >
                  <option value="">不指定仓位</option>
                  {options.locations
                    .filter((location) => location.status === "ACTIVE")
                    .map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.businessCode} · {location.name}
                      </option>
                    ))}
                </select>
              </label>
              <p>
                首次分配按每条订单明细的全部数量执行。需要部分履约时，
                可在后续包裹中按数量拆分；库存不足会记录负可用事实，不会静默拒绝。
              </p>
              <button
                className="button button-primary"
                disabled={busy || !allocationWarehouse}
                type="button"
                onClick={() => void execute(
                  () => orderCenterApi.allocateFulfillment(plan.id, {
                    version: plan.version,
                    commandId: crypto.randomUUID(),
                    assignments: detail.lines.map((line) => ({
                      orderLineId: line.id,
                      quantity: line.quantity,
                      warehouseId: allocationWarehouse,
                      locationId: allocationLocation || undefined,
                    })),
                  }),
                  "已完成仓库分配并预留库存。",
                )}
              >
                确认分配与预留
              </button>
            </section>
          )}

          {["ALLOCATED", "PICKING"].includes(plan.status) &&
            permissions.pick && (
              <section
                className="fulfillment-action-panel fulfillment-action-row"
                aria-labelledby="fulfillment-picking-title"
              >
                <div>
                  <h4 id="fulfillment-picking-title">拣货确认</h4>
                  <p>按履约计划记录全部当前可处理数量。</p>
                </div>
                <button
                  className="button button-primary"
                  disabled={busy}
                  type="button"
                  onClick={() => void execute(
                    () => orderCenterApi.pickFulfillment(plan.id, {
                      version: plan.version,
                      commandId: crypto.randomUUID(),
                      quantities: plan.lines.map((line) => ({
                        lineId: line.id,
                        quantity: line.plannedQuantity -
                          line.cancelledQuantity,
                      })),
                    }),
                    "拣货数量已记录。",
                  )}
                >
                  记录全部可处理数量已拣货
                </button>
              </section>
            )}

          {remainingToPack.length > 0 && permissions.pack && (
            <section
              className="detail-form fulfillment-action-panel"
              aria-labelledby="fulfillment-packing-title"
            >
              <h4 id="fulfillment-packing-title">包装验货</h4>
              <label>
                包裹号
                <input
                  maxLength={80}
                  value={packageNumber}
                  onChange={(event) => setPackageNumber(event.target.value)}
                />
              </label>
              <label>
                包裹仓库
                <select
                  value={packageWarehouse}
                  onChange={(event) => setPackageWarehouse(event.target.value)}
                >
                  <option value="">请选择仓库</option>
                  {[...new Set(
                    remainingToPack
                      .map((line) => line.warehouseId)
                      .filter((value): value is string => Boolean(value)),
                  )].map((warehouseId) => (
                    <option key={warehouseId} value={warehouseId}>
                      {options.warehouses.find(
                        (warehouse) => warehouse.id === warehouseId,
                      )?.name ?? warehouseId}
                    </option>
                  ))}
                </select>
              </label>
              <p>
                本次包裹收纳所选仓库内的全部剩余已拣数量；不同仓库必须建立不同包裹。
              </p>
              <button
                className="button button-primary"
                disabled={busy || !packageNumber.trim() || !packageWarehouse}
                type="button"
                onClick={() => void execute(
                  () => orderCenterApi.createFulfillmentPackage(plan.id, {
                    version: plan.version,
                    commandId: crypto.randomUUID(),
                    warehouseId: packageWarehouse,
                    packageNumber: packageNumber.trim(),
                    items: remainingToPack
                      .filter((line) => line.warehouseId === packageWarehouse)
                      .map((line) => ({
                        fulfillmentLineId: line.id,
                        quantity: line.pickedQuantity - line.packedQuantity,
                      })),
                  }),
                  "包裹已建立；生成包裹不等于发货。",
                )}
              >
                建立包裹
              </button>
            </section>
          )}

          <section
            className="fulfillment-section fulfillment-packages"
            aria-labelledby="fulfillment-packages-title"
          >
            <div className="order-detail-section-heading">
              <h3 id="fulfillment-packages-title">包裹与称重出库</h3>
              <span>共 {plan.packages.length} 个包裹</span>
            </div>
            {plan.packages.length === 0 && (
              <p className="fulfillment-empty">尚未建立包裹。</p>
            )}
            {plan.packages.map((item) => (
              <fieldset key={item.id} className="fulfillment-package">
                <legend>包裹 {item.packageNumber}</legend>
                <p>
                  {packageStatusLabels[item.status]} · 仓库 {item.warehouseId} ·{" "}
                  {item.items.reduce((sum, line) => sum + line.quantity, 0)} 件
                </p>
                {item.status === "HANDED_OVER" &&
                  detail.externalOrderRef.startsWith("gid://shopify/Order/") && (
                    <p>
                      Shopify 回传：
                      {{
                        NOT_PUBLISHED: "未回传",
                        PUBLISHING: "正在处理",
                        PUBLISHED: "已回传",
                        UNCERTAIN: "结果待核对",
                      }[item.shopifyPublicationStatus]}
                      {item.externalShopifyFulfillmentRef
                        ? ` · ${item.externalShopifyFulfillmentRef}`
                        : ""}
                    </p>
                  )}
              {item.status === "DRAFT" && permissions.pack && (
                <div className="detail-form">
                  <h4>包装模板</h4>
                  {item.packagingTemplateId ? (
                    <p>
                      已选 {item.packagingCode} · {item.packagingName} · 发货包装
                      {item.packagingWeightGrams} 克
                    </p>
                  ) : (
                    <>
                      <label>
                        本包裹使用的包装
                        <select
                          value={packagingChoice[item.id] ?? ""}
                          onChange={(event) => setPackagingChoice((current) => ({
                            ...current,
                            [item.id]: event.target.value,
                          }))}
                        >
                          <option value="">请选择包装模板</option>
                          {(packagingOptions[item.warehouseId] ?? [])
                            .filter((template) => template.status === "ACTIVE")
                            .map((template) => (
                              <option key={template.id} value={template.id}>
                                {template.businessCode} · {template.name} · {template.standardWeightGrams} 克
                              </option>
                            ))}
                        </select>
                      </label>
                      <p>单 SKU 包裹命中数量规则时会自动选择；混装包裹由打包人员确认。</p>
                      <button
                        className="button button-secondary"
                        disabled={busy || !packagingChoice[item.id]}
                        type="button"
                        onClick={() => void execute(
                          () => orderCenterApi.assignFulfillmentPackaging(
                            plan.id,
                            item.id,
                            {
                              packageVersion: item.version,
                              packagingTemplateId: packagingChoice[item.id]!,
                            },
                          ),
                          "包装模板已绑定，预期重量已按 SKU 标准重量计算。",
                        )}
                      >
                        确认包装模板
                      </button>
                    </>
                  )}
                  <button
                    className="button button-secondary"
                    disabled={busy || !item.packagingTemplateId}
                    type="button"
                    onClick={() => void execute(
                      () => orderCenterApi.sealFulfillmentPackage(
                        plan.id,
                        item.id,
                        {
                          version: plan.version,
                          packageVersion: item.version,
                          commandId: crypto.randomUUID(),
                        },
                      ),
                      "包裹已封箱；称重通过前不能交接出库。",
                    )}
                  >
                    封箱并进入称重
                  </button>
                </div>
              )}
              {item.status === "SEALED" && permissions.ship && (
                <div className="detail-form">
                  <h4>称重校验</h4>
                  <p>
                    包装：{item.packagingCode} · {item.packagingName}；预期重量：
                    {item.expectedWeightGrams === undefined
                      ? "缺少 SKU 标准重量"
                      : `${item.expectedWeightGrams} 克`}
                    {item.allowedToleranceGrams !== undefined
                      ? `；允许误差 ±${item.allowedToleranceGrams} 克`
                      : ""}
                  </p>
                  <p
                    className={item.weighingStatus === "BLOCKED"
                      ? "fulfillment-weighing-blocked"
                      : "fulfillment-weighing-status"}
                    role={item.weighingStatus === "BLOCKED" ? "alert" : "status"}
                  >
                    称重状态：{{
                      PENDING: "待称重",
                      MISSING_WEIGHT: "缺少标准重量，需授权人工放行",
                      PASSED: "已通过",
                      BLOCKED: "重量超差，已阻止交接，请复称",
                      OVERRIDDEN: "已由授权人员强制放行",
                    }[item.weighingStatus]}
                    {item.weightGrams !== undefined
                      ? `；实际 ${item.weightGrams} 克`
                      : ""}
                    {item.weightDifferenceGrams !== undefined
                      ? `；差值 ${item.weightDifferenceGrams > 0 ? "+" : ""}${item.weightDifferenceGrams} 克`
                      : ""}
                  </p>
                  {!(["PASSED", "OVERRIDDEN"] as const).includes(
                    item.weighingStatus as "PASSED" | "OVERRIDDEN",
                  ) && (
                    <>
                      {item.expectedWeightGrams !== undefined && (
                        <label>
                          电子秤
                          <select
                            value={scaleChoice[item.id] ?? ""}
                            onChange={(event) => setScaleChoice((current) => ({
                              ...current,
                              [item.id]: event.target.value,
                            }))}
                          >
                            <option value="">请选择本仓电子秤</option>
                            {(scaleOptions[item.warehouseId] ?? [])
                              .filter((scale) => scale.status === "ACTIVE")
                              .map((scale) => (
                                <option key={scale.id} value={scale.id}>
                                  {scale.deviceNumber} · {scale.displayName}
                                </option>
                              ))}
                          </select>
                        </label>
                      )}
                      <label>
                        稳定后的实际重量（克）
                        <input
                          min="1"
                          step="1"
                          type="number"
                          value={weightGrams[item.id] ?? ""}
                          onChange={(event) => setWeightGrams((current) => ({
                            ...current,
                            [item.id]: event.target.value,
                          }))}
                        />
                      </label>
                      {item.expectedWeightGrams !== undefined && (
                        <button
                          className="button button-primary"
                          disabled={busy || !scaleChoice[item.id] ||
                            !Number.isInteger(Number(weightGrams[item.id])) ||
                            Number(weightGrams[item.id]) <= 0}
                          type="button"
                          onClick={() => void execute(
                            async () => {
                              const changed = await orderCenterApi.weighFulfillmentPackage(
                                plan.id,
                                item.id,
                                {
                                  packageVersion: item.version,
                                  commandId: crypto.randomUUID(),
                                  scaleId: scaleChoice[item.id]!,
                                  actualWeightGrams: Number(weightGrams[item.id]),
                                  occurredAt: new Date().toISOString(),
                                },
                              );
                              if (changed.packages.find((entry) => entry.id === item.id)
                                ?.weighingStatus === "BLOCKED") {
                                playWeighingAlert();
                              }
                              return changed;
                            },
                            "称重结果已记录。超差包裹必须复称或由授权人员强制放行。",
                          )}
                        >
                          记录电子秤结果
                        </button>
                      )}
                      {permissions.weighOverride && (
                        <button
                          className="button button-secondary"
                          disabled={busy || !Number.isInteger(Number(weightGrams[item.id])) ||
                            Number(weightGrams[item.id]) <= 0}
                          type="button"
                          onClick={() => {
                            const reason = window.prompt(
                              "请输入强制放行原因（将写入不可修改的审计记录）",
                              item.weighingStatus === "MISSING_WEIGHT"
                                ? "SKU 缺少标准重量"
                                : "电子秤故障或复核后确认放行",
                            )?.trim();
                            if (!reason) return;
                            void execute(
                              () => orderCenterApi.overrideFulfillmentWeighing(
                                plan.id,
                                item.id,
                                {
                                  packageVersion: item.version,
                                  commandId: crypto.randomUUID(),
                                  actualWeightGrams: Number(weightGrams[item.id]),
                                  occurredAt: new Date().toISOString(),
                                  reason,
                                },
                              ),
                              "称重异常已由授权人员强制放行并完成审计留痕。",
                            );
                          }}
                        >
                          授权强制放行
                        </button>
                      )}
                    </>
                  )}
                  {(["PASSED", "OVERRIDDEN"] as const).includes(
                    item.weighingStatus as "PASSED" | "OVERRIDDEN",
                  ) && (
                    renderLogisticsShipment(item)
                  )}
                </div>
              )}
              {item.status === "HANDED_OVER" &&
                permissions.ship &&
                detail.externalOrderRef.startsWith("gid://shopify/Order/") &&
                ["NOT_PUBLISHED", "UNCERTAIN"].includes(
                  item.shopifyPublicationStatus,
                ) && (
                  <ShopifyFulfillmentPublishForm
                    busy={busy}
                    execute={execute}
                    item={item}
                    planId={plan.id}
                  />
                )}
              {item.status === "HANDED_OVER" &&
                item.shopifyPublicationStatus === "NOT_PUBLISHED" &&
                permissions.correct && (
                <button
                  className="button button-secondary"
                  disabled={busy}
                  type="button"
                  onClick={() => {
                    const reasonCode = window.prompt(
                      "请输入冲销原因代码（大写字母、数字或下划线）",
                      "HANDOVER_ERROR",
                    );
                    if (
                      !reasonCode ||
                      !/^[A-Z][A-Z0-9_]{0,63}$/.test(reasonCode)
                    ) return;
                    void execute(
                      () => orderCenterApi.correctFulfillmentHandover(
                        plan.id,
                        item.id,
                        {
                          version: plan.version,
                          packageVersion: item.version,
                          commandId: crypto.randomUUID(),
                          occurredAt: new Date().toISOString(),
                          reasonCode,
                        },
                      ),
                      "已追加唯一发货冲销事实；原发货事实未被修改。",
                    );
                  }}
                >
                  冲销错误发货事实
                </button>
              )}
              </fieldset>
            ))}
          </section>

          <div className="detail-form fulfillment-exception-actions">
            {permissions.exceptions && plan.pauseState === "ACTIVE" && (
              <button
                className="button button-secondary"
                disabled={busy}
                type="button"
                onClick={() => void execute(
                  () => orderCenterApi.pauseFulfillment(plan.id, {
                    version: plan.version,
                    commandId: crypto.randomUUID(),
                    reasonCode: "MANUAL_REVIEW",
                  }),
                  "履约已暂停，既有发货事实保持不变。",
                )}
              >
                暂停履约
              </button>
            )}
            {permissions.exceptions && plan.pauseState === "PAUSED" && (
              <button
                className="button button-secondary"
                disabled={busy}
                type="button"
                onClick={() => void execute(
                  () => orderCenterApi.resumeFulfillment(plan.id, {
                    version: plan.version,
                    commandId: crypto.randomUUID(),
                  }),
                  "履约已恢复。",
                )}
              >
                恢复履约
              </button>
            )}
            {permissions.cancel && !["SHIPPED", "CANCELLED"].includes(plan.status) && (
              <button
                className="button button-secondary"
                disabled={busy}
                type="button"
                onClick={() => {
                  if (!window.confirm("确认取消全部未发余量吗？已发货事实不会删除。")) return;
                  void execute(
                    () => orderCenterApi.cancelFulfillment(plan.id, {
                      version: plan.version,
                      commandId: crypto.randomUUID(),
                      reasonCode: "MANUAL_CANCEL",
                    }),
                    "未发余量已取消，库存预留已释放。",
                  );
                }}
              >
                取消未发余量
              </button>
            )}
          </div>
        </>
      )}
      {operationMessage && <p role="status">{operationMessage}</p>}
    </details>
  );
}

function ShopifyCustomItemAdder({
  detail,
  canEdit,
  onChanged,
}: {
  detail: OrderDetail;
  canEdit: boolean;
  onChanged: (detail: OrderDetail) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [requiresShipping, setRequiresShipping] = useState(false);
  const [taxable, setTaxable] = useState(true);
  const [notifyCustomer, setNotifyCustomer] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const mutable = ![
    "READY_TO_FULFILL",
    "FULFILLING",
    "SHIPPED",
    "DELIVERED",
    "CANCELLED",
  ].includes(detail.status) && /^gid:\/\/shopify\/Order\/[0-9]+$/.test(
    detail.externalOrderRef,
  );
  const normalizedTitle = title.trim();
  const targetQuantity = Number(quantity);
  const unitPriceMinor = (() => {
    const match = /^(0|[1-9][0-9]{0,12})(?:\.([0-9]{1,2}))?$/.exec(
      unitPrice.trim(),
    );
    if (!match) return undefined;
    const value = Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
    return Number.isSafeInteger(value) ? value : undefined;
  })();
  const enabled = canEdit && mutable;
  const valid = normalizedTitle.length > 0 && normalizedTitle.length <= 255 &&
    unitPriceMinor !== undefined && Number.isInteger(targetQuantity) &&
    targetQuantity >= 1 && targetQuantity <= 100_000;

  const submit = async () => {
    if (busy || !enabled || !valid || unitPriceMinor === undefined) return;
    if (!window.confirm(
      `确认向 Shopify 订单新增“${normalizedTitle}” × ${targetQuantity}？订单总额和待收款可能随之变化。`,
    )) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await orderCenterApi.addShopifyOrderCustomItem(
        detail.id,
        {
          title: normalizedTitle,
          unitPriceMinor,
          quantity: targetQuantity,
          requiresShipping,
          taxable,
          notifyCustomer,
          idempotencyKey: `web.order-custom.${detail.id}.${Date.now()}`,
        },
      );
      onChanged(result.order);
      setOpen(false);
      setTitle("");
      setUnitPrice("");
      setQuantity("1");
      setMessage(
        result.recoveredFromShopify || result.replayed
          ? "已核对 Shopify 并恢复自定义订单项结果。"
          : "自定义订单项已新增，订单总额已同步。",
      );
    } catch (error) {
      setMessage(safeOrderError(error));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="order-line-add-toolbar">
        <button
          className="button button-secondary"
          type="button"
          disabled={!enabled}
          aria-describedby={!enabled ? "shopify-add-custom-disabled" : undefined}
          onClick={() => {
            setOpen(true);
            setMessage("");
          }}
        >
          新增自定义金额
        </button>
        {!enabled && (
          <small id="shopify-add-custom-disabled">
            {!canEdit
              ? "需要 Shopify 订单编辑权限。"
              : "当前订单状态不允许新增自定义订单项。"}
          </small>
        )}
        {message && <small role="status">{message}</small>}
      </div>
    );
  }

  return (
    <section
      className="order-line-add-panel"
      aria-labelledby="shopify-add-custom-title"
    >
      <div className="order-detail-section-heading">
        <h4 id="shopify-add-custom-title">新增 Shopify 自定义金额</h4>
        <button
          className="text-button"
          type="button"
          disabled={busy}
          onClick={() => setOpen(false)}
        >
          收起
        </button>
      </div>
      <p className="form-help">
        用于礼品包装、安装服务或一次性费用。金额按订单币种 {detail.currency} 计算，提交后会直接编辑 Shopify 订单。
      </p>
      <div className="order-line-add-controls">
        <label htmlFor="shopify-custom-item-title">
          名称
          <input
            id="shopify-custom-item-title"
            type="text"
            maxLength={255}
            disabled={busy}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label htmlFor="shopify-custom-item-price">
          单价（{detail.currency}）
          <input
            id="shopify-custom-item-price"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            maxLength={16}
            disabled={busy}
            value={unitPrice}
            onChange={(event) => setUnitPrice(event.target.value)}
          />
        </label>
        <label htmlFor="shopify-custom-item-quantity">
          数量
          <input
            id="shopify-custom-item-quantity"
            type="number"
            min={1}
            max={100000}
            step={1}
            disabled={busy}
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={requiresShipping}
            disabled={busy}
            onChange={(event) => setRequiresShipping(event.target.checked)}
          />
          需要发货
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={taxable}
            disabled={busy}
            onChange={(event) => setTaxable(event.target.checked)}
          />
          计税
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={notifyCustomer}
            disabled={busy}
            onChange={(event) => setNotifyCustomer(event.target.checked)}
          />
          通知客户
        </label>
      </div>
      <div className="inline-actions">
        <button
          className="button button-primary"
          type="button"
          disabled={busy || !valid}
          onClick={() => void submit()}
        >
          {busy ? "正在同步…" : "确认新增"}
        </button>
        <button
          className="button button-secondary"
          type="button"
          disabled={busy}
          onClick={() => setOpen(false)}
        >
          取消
        </button>
      </div>
      {message && <p role="status">{message}</p>}
    </section>
  );
}

function ShopifyVariantAdder({
  detail,
  canEdit,
  canReadListings,
  onChanged,
}: {
  detail: OrderDetail;
  canEdit: boolean;
  canReadListings: boolean;
  onChanged: (detail: OrderDetail) => void;
}) {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [listings, setListings] = useState<ProductListing[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [notifyCustomer, setNotifyCustomer] = useState(true);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const mutable = ![
    "READY_TO_FULFILL",
    "FULFILLING",
    "SHIPPED",
    "DELIVERED",
    "CANCELLED",
  ].includes(detail.status) && /^gid:\/\/shopify\/Order\/[0-9]+$/.test(
    detail.externalOrderRef,
  );
  const existingVariants = useMemo(
    () => new Set(detail.lines.map((line) => line.externalVariantRef)
      .filter((value): value is string => Boolean(value))),
    [detail.lines],
  );
  const targetQuantity = Number(quantity);
  const validQuantity = Number.isInteger(targetQuantity) &&
    targetQuantity >= 1 && targetQuantity <= 100_000;
  const selected = listings.find((listing) => listing.id === selectedId);
  const enabled = canEdit && canReadListings && mutable;

  useEffect(() => {
    if (!open || !enabled) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setMessage("");
      void productCenterApi.listListings({
        shopId: detail.shopId,
        status: "ACTIVE",
        keyword: keyword.trim() || undefined,
        searchField: "ALL",
        page: 0,
        size: 20,
      }).then((page) => {
        if (cancelled) return;
        setListings(page.items.filter((listing) =>
          /^gid:\/\/shopify\/Product\/[0-9]+$/.test(
            listing.externalListingRef,
          ) && /^gid:\/\/shopify\/ProductVariant\/[0-9]+$/.test(
            listing.externalVariantRef || "",
          ) && !existingVariants.has(listing.externalVariantRef || "")
        ));
      }).catch((error) => {
        if (cancelled) return;
        setListings([]);
        setMessage(safeOrderError(error));
      }).finally(() => {
        if (!cancelled) setLoading(false);
      });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [detail.shopId, enabled, existingVariants, keyword, open]);

  const submit = async () => {
    if (busy || !selected || !validQuantity) return;
    if (!window.confirm(
      `确认向 Shopify 订单新增 ${selected.sku.businessCode} × ${targetQuantity}？订单总额和待收款可能随之增加。`,
    )) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await orderCenterApi.addShopifyOrderVariant(
        detail.id,
        {
          listingId: selected.id,
          quantity: targetQuantity,
          notifyCustomer,
          idempotencyKey: `web.order-add.${detail.id}.${Date.now()}`,
        },
      );
      onChanged(result.order);
      setOpen(false);
      setSelectedId("");
      setKeyword("");
      setMessage(
        result.recoveredFromShopify || result.replayed
          ? "已核对 Shopify 并恢复新增商品结果。"
          : "商品已新增，订单总额已同步。",
      );
    } catch (error) {
      setMessage(safeOrderError(error));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="order-line-add-toolbar">
        <button
          className="button button-secondary"
          type="button"
          disabled={!enabled}
          aria-describedby={!enabled ? "shopify-add-variant-disabled" : undefined}
          onClick={() => {
            setOpen(true);
            setMessage("");
          }}
        >
          新增 Shopify 商品
        </button>
        {!enabled && (
          <small id="shopify-add-variant-disabled">
            {!canReadListings
              ? "需要商品刊登读权限。"
              : !canEdit
                ? "需要 Shopify 订单编辑权限。"
                : "当前订单状态不允许新增商品。"}
          </small>
        )}
        {message && <small role="status">{message}</small>}
      </div>
    );
  }

  return (
    <section
      className="order-line-add-panel"
      aria-labelledby="shopify-add-variant-title"
    >
      <div className="order-detail-section-heading">
        <h4 id="shopify-add-variant-title">新增 Shopify 商品</h4>
        <button
          className="text-button"
          type="button"
          disabled={busy}
          onClick={() => setOpen(false)}
        >
          收起
        </button>
      </div>
      <p className="form-help">
        仅显示当前店铺已映射且未在订单中的活动变体。已存在的变体请使用“编辑数量”。
      </p>
      <div className="order-line-add-controls">
        <label htmlFor="shopify-add-variant-search">
          搜索刊登 / SKU
          <input
            id="shopify-add-variant-search"
            type="search"
            maxLength={100}
            disabled={busy}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
        </label>
        <label htmlFor="shopify-add-variant-quantity">
          数量
          <input
            id="shopify-add-variant-quantity"
            type="number"
            min={1}
            max={100000}
            step={1}
            disabled={busy}
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={notifyCustomer}
            disabled={busy}
            onChange={(event) => setNotifyCustomer(event.target.checked)}
          />
          通知客户
        </label>
      </div>
      {loading ? (
        <p role="status">正在读取店铺刊登…</p>
      ) : listings.length === 0 ? (
        <p className="form-help">没有可新增的已映射商品。</p>
      ) : (
        <div className="shop-table-scroll order-line-add-results">
          <table className="shop-table">
            <thead>
              <tr>
                <th scope="col">选择</th>
                <th scope="col">SKU</th>
                <th scope="col">商品</th>
                <th scope="col">Shopify 变体</th>
              </tr>
            </thead>
            <tbody>
              {listings.map((listing) => (
                <tr key={listing.id}>
                  <td>
                    <input
                      aria-label={`选择 ${listing.sku.businessCode}`}
                      type="radio"
                      name="shopify-order-add-variant"
                      value={listing.id}
                      checked={selectedId === listing.id}
                      disabled={busy}
                      onChange={() => setSelectedId(listing.id)}
                    />
                  </td>
                  <td>{listing.sku.businessCode}</td>
                  <td>{listing.sku.name}</td>
                  <td>{listing.externalVariantRef}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="inline-actions">
        <button
          className="button button-primary"
          type="button"
          disabled={busy || !selected || !validQuantity}
          onClick={() => void submit()}
        >
          {busy ? "正在同步…" : "确认新增"}
        </button>
        <button
          className="button button-secondary"
          type="button"
          disabled={busy}
          onClick={() => setOpen(false)}
        >
          取消
        </button>
      </div>
      {message && <p role="status">{message}</p>}
    </section>
  );
}

function ShopifyOrderCancellationEditor({
  detail,
  canCancel,
  onChanged,
}: {
  detail: OrderDetail;
  canCancel: boolean;
  onChanged: (detail: OrderDetail) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<
    "CUSTOMER" | "DECLINED" | "FRAUD" | "INVENTORY" | "STAFF" | "OTHER"
  >("CUSTOMER");
  const [staffNote, setStaffNote] = useState("");
  const [refund, setRefund] = useState(true);
  const [restock, setRestock] = useState(true);
  const [notifyCustomer, setNotifyCustomer] = useState(true);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const mapped = /^gid:\/\/shopify\/Order\/[0-9]+$/.test(
    detail.externalOrderRef,
  );
  const eligible = canCancel && mapped && ![
    "FULFILLING", "SHIPPED", "DELIVERED", "CANCELLED",
  ].includes(detail.status);

  const submit = async () => {
    if (!eligible || busy || !acknowledged || staffNote.trim().length > 180) return;
    if (!window.confirm(
      "确认取消 Shopify 平台订单？此操作不可撤销，并可能退款、回补库存及通知买家。",
    )) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await orderCenterApi.cancelShopifyOrder(detail.id, {
        reason,
        staffNote: staffNote.trim() || undefined,
        refundOriginalPaymentMethods: refund,
        restock,
        notifyCustomer,
        idempotencyKey: `web.order-cancel.${detail.id}.${Date.now()}`,
      });
      onChanged(result.order);
      setOpen(false);
      setMessage(
        result.recoveredFromShopify || result.replayed
          ? "已核对 Shopify 并恢复取消结果。"
          : "Shopify 订单已取消并同步到 ERP。",
      );
    } catch (error) {
      setMessage(safeOrderError(error));
    } finally {
      setBusy(false);
    }
  };

  if (!eligible && !message) return null;
  if (!open) {
    return (
      <section className="order-detail-section">
        {eligible && (
          <button className="button button-danger" type="button" onClick={() => setOpen(true)}>
            取消 Shopify 平台订单
          </button>
        )}
        {message && <p role="status">{message}</p>}
      </section>
    );
  }
  return (
    <section className="order-detail-section detail-form" aria-label="取消 Shopify 平台订单">
      <h3>取消 Shopify 平台订单</h3>
      <p>此操作不可撤销。请逐项确认退款、库存和买家通知选项。</p>
      <label>取消原因
        <select value={reason} disabled={busy} onChange={(event) => setReason(event.target.value as typeof reason)}>
          <option value="CUSTOMER">买家要求</option>
          <option value="DECLINED">付款失败</option>
          <option value="FRAUD">欺诈风险</option>
          <option value="INVENTORY">库存不足</option>
          <option value="STAFF">员工操作</option>
          <option value="OTHER">其他</option>
        </select>
      </label>
      <label>内部备注
        <input value={staffNote} maxLength={180} disabled={busy}
          onChange={(event) => setStaffNote(event.target.value)} />
      </label>
      {[
        ["退回原付款方式", refund, setRefund],
        ["回补库存", restock, setRestock],
        ["通知买家", notifyCustomer, setNotifyCustomer],
      ].map(([label, checked, setter]) => (
        <label className="checkbox-row" key={String(label)}>
          <input type="checkbox" checked={checked as boolean} disabled={busy}
            onChange={(event) => (setter as (value: boolean) => void)(event.target.checked)} />
          {label as string}
        </label>
      ))}
      <label className="checkbox-row">
        <input type="checkbox" checked={acknowledged} disabled={busy}
          onChange={(event) => setAcknowledged(event.target.checked)} />
        我已确认该操作不可撤销，并已核对退款和库存选项
      </label>
      <div className="inline-actions">
        <button className="button button-danger" type="button"
          disabled={busy || !acknowledged} onClick={() => void submit()}>
          {busy ? "正在核对并取消…" : "确认永久取消"}
        </button>
        <button className="text-button" type="button" disabled={busy}
          onClick={() => { setOpen(false); setAcknowledged(false); setMessage(""); }}>
          返回
        </button>
      </div>
      {message && <p role="alert">{message}</p>}
    </section>
  );
}

function ShopifyLineDiscountEditor({
  detail,
  line,
  canEdit,
  onChanged,
}: {
  detail: OrderDetail;
  line: OrderDetail["lines"][number];
  canEdit: boolean;
  onChanged: (detail: OrderDetail) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState("");
  const [discountType, setDiscountType] = useState<"FIXED" | "PERCENTAGE">("FIXED");
  const [value, setValue] = useState("");
  const [notifyCustomer, setNotifyCustomer] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const mutable = ![
    "READY_TO_FULFILL",
    "FULFILLING",
    "SHIPPED",
    "DELIVERED",
    "CANCELLED",
  ].includes(detail.status);
  const mapped = line.lineKind === "PRODUCT" &&
    /^gid:\/\/shopify\/Order\/[0-9]+$/.test(detail.externalOrderRef) &&
    /^gid:\/\/shopify\/LineItem\/[0-9]+$/.test(line.externalLineRef) &&
    /^gid:\/\/shopify\/ProductVariant\/[0-9]+$/.test(
      line.externalVariantRef || "",
    );
  const editable = canEdit && mutable && mapped && line.quantity > 0;
  const normalizedDescription = description.trim();
  const fixedValueMinor = (() => {
    if (discountType !== "FIXED") return undefined;
    const match = /^([1-9][0-9]{0,12}|0)(?:\.([0-9]{1,2}))?$/.exec(value.trim());
    if (!match) return undefined;
    const parsed = Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
  })();
  const percentBasisPoints = (() => {
    if (discountType !== "PERCENTAGE") return undefined;
    const match = /^(100(?:\.0{1,2})?|(?:[0-9]{1,2})(?:\.([0-9]{1,2}))?)$/.exec(
      value.trim(),
    );
    if (!match) return undefined;
    const parsed = Math.round(Number(value) * 100);
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= 10_000
      ? parsed : undefined;
  })();
  const valid = normalizedDescription.length > 0 &&
    normalizedDescription.length <= 255 &&
    (fixedValueMinor !== undefined || percentBasisPoints !== undefined);

  const submit = async () => {
    if (busy || !editable || !valid) return;
    const displayValue = discountType === "FIXED"
      ? formatMinor(fixedValueMinor as number, detail.currency)
      : `${(percentBasisPoints as number) / 100}%`;
    if (!window.confirm(
      `确认向“${line.titleSnapshot}”添加 ${displayValue} 折扣？订单总额和待收款可能随之变化。`,
    )) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await orderCenterApi.addShopifyOrderLineDiscount(
        detail.id,
        {
          lineId: line.id,
          description: normalizedDescription,
          discountType,
          fixedValueMinor,
          percentBasisPoints,
          notifyCustomer,
          idempotencyKey: `web.order-discount.${line.id}.${Date.now()}`,
        },
      );
      onChanged(result.order);
      setEditing(false);
      setDescription("");
      setValue("");
      setMessage(
        result.recoveredFromShopify || result.replayed
          ? "已核对 Shopify 并恢复折扣结果。"
          : "商品折扣与订单总额已同步。",
      );
    } catch (error) {
      setMessage(safeOrderError(error));
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <div className="order-line-quantity-cell">
        <span>
          {line.discountTotalMinor > 0
            ? formatMinor(line.discountTotalMinor, line.currency)
            : "—"}
        </span>
        {line.discountDescription && <small>{line.discountDescription}</small>}
        {editable && (
          <button
            className="text-button"
            type="button"
            onClick={() => {
              setEditing(true);
              setMessage("");
            }}
          >
            添加折扣
          </button>
        )}
        {message && <small role="status">{message}</small>}
      </div>
    );
  }

  return (
    <div className="detail-form order-line-quantity-editor">
      <label htmlFor={`shopify-line-discount-description-${line.id}`}>
        折扣说明
        <input
          id={`shopify-line-discount-description-${line.id}`}
          type="text"
          maxLength={255}
          disabled={busy}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <label htmlFor={`shopify-line-discount-type-${line.id}`}>
        折扣类型
        <select
          id={`shopify-line-discount-type-${line.id}`}
          disabled={busy}
          value={discountType}
          onChange={(event) => {
            setDiscountType(event.target.value as "FIXED" | "PERCENTAGE");
            setValue("");
          }}
        >
          <option value="FIXED">固定金额</option>
          <option value="PERCENTAGE">百分比</option>
        </select>
      </label>
      <label htmlFor={`shopify-line-discount-value-${line.id}`}>
        {discountType === "FIXED"
          ? `折扣金额（${detail.currency}）`
          : "折扣百分比（%）"}
        <input
          id={`shopify-line-discount-value-${line.id}`}
          type="text"
          inputMode="decimal"
          placeholder={discountType === "FIXED" ? "0.00" : "10"}
          maxLength={16}
          disabled={busy}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={notifyCustomer}
          disabled={busy}
          onChange={(event) => setNotifyCustomer(event.target.checked)}
        />
        通知客户
      </label>
      <div className="inline-actions">
        <button
          className="button button-primary"
          type="button"
          disabled={busy || !valid}
          onClick={() => void submit()}
        >
          {busy ? "正在同步…" : "确认添加折扣"}
        </button>
        <button
          className="text-button"
          type="button"
          disabled={busy}
          onClick={() => {
            setEditing(false);
            setDescription("");
            setValue("");
            setMessage("");
          }}
        >
          取消
        </button>
      </div>
      {message && <small role="alert">{message}</small>}
    </div>
  );
}

function ShopifyLineQuantityEditor({
  detail,
  line,
  canEdit,
  onChanged,
}: {
  detail: OrderDetail;
  line: OrderDetail["lines"][number];
  canEdit: boolean;
  onChanged: (detail: OrderDetail) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [quantity, setQuantity] = useState(String(line.quantity));
  const [restock, setRestock] = useState(false);
  const [notifyCustomer, setNotifyCustomer] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const targetQuantity = Number(quantity);
  const mutable = ![
    "READY_TO_FULFILL",
    "FULFILLING",
    "SHIPPED",
    "DELIVERED",
    "CANCELLED",
  ].includes(detail.status);
  const mapped = /^gid:\/\/shopify\/Order\/[0-9]+$/.test(
    detail.externalOrderRef,
  ) && /^gid:\/\/shopify\/LineItem\/[0-9]+$/.test(
    line.externalLineRef,
  ) && /^gid:\/\/shopify\/ProductVariant\/[0-9]+$/.test(
    line.externalVariantRef || "",
  );
  const editable = canEdit && mutable && mapped && line.quantity > 0;
  const validTarget = Number.isInteger(targetQuantity) &&
    targetQuantity >= 0 && targetQuantity <= 100_000 &&
    targetQuantity !== line.quantity;

  useEffect(() => {
    setQuantity(String(line.quantity));
    setRestock(false);
  }, [line.quantity]);

  const submit = async () => {
    if (busy || !validTarget) return;
    const decreasing = targetQuantity < line.quantity;
    if (!window.confirm(
      `确认将 Shopify 商品数量从 ${line.quantity} 改为 ${targetQuantity}？订单总额和付款差额可能随之变化。`,
    )) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await orderCenterApi.updateShopifyLineQuantity(
        detail.id,
        {
          lineId: line.id,
          expectedQuantity: line.quantity,
          quantity: targetQuantity,
          restock: decreasing && restock,
          notifyCustomer,
          idempotencyKey: `web.order-line.${line.id}.${Date.now()}`,
        },
      );
      onChanged(result.order);
      setEditing(false);
      setMessage(
        result.recoveredFromShopify || result.replayed
          ? "已核对 Shopify 并同步数量。"
          : "Shopify 数量与订单总额已同步。",
      );
    } catch (error) {
      setMessage(safeOrderError(error));
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <div className="order-line-quantity-cell">
        <span>{line.quantity}</span>
        {editable && (
          <button
            className="text-button"
            type="button"
            onClick={() => {
              setEditing(true);
              setMessage("");
            }}
          >
            编辑数量
          </button>
        )}
        {message && <small role="status">{message}</small>}
      </div>
    );
  }

  return (
    <div className="detail-form order-line-quantity-editor">
      <label htmlFor={`shopify-line-quantity-${line.id}`}>
        新数量
        <input
          id={`shopify-line-quantity-${line.id}`}
          type="number"
          min={0}
          max={100000}
          step={1}
          disabled={busy}
          value={quantity}
          onChange={(event) => {
            const next = event.target.value;
            setQuantity(next);
            if (Number(next) >= line.quantity) setRestock(false);
          }}
        />
      </label>
      {targetQuantity < line.quantity && (
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={restock}
            disabled={busy}
            onChange={(event) => setRestock(event.target.checked)}
          />
          减少的数量退回库存
        </label>
      )}
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={notifyCustomer}
          disabled={busy}
          onChange={(event) => setNotifyCustomer(event.target.checked)}
        />
        通知客户
      </label>
      <div className="inline-actions">
        <button
          className="button button-primary"
          type="button"
          disabled={busy || !validTarget}
          onClick={() => void submit()}
        >
          {busy ? "正在同步…" : "确认修改"}
        </button>
        <button
          className="text-button"
          type="button"
          disabled={busy}
          onClick={() => {
            setEditing(false);
            setQuantity(String(line.quantity));
            setRestock(false);
            setMessage("");
          }}
        >
          取消
        </button>
      </div>
      {message && <small role="alert">{message}</small>}
    </div>
  );
}

function LineSkuMatch({
  canReadProducts,
  canWrite,
  line,
  orderId,
  orderStatus,
  version,
  onChanged,
}: {
  canReadProducts: boolean;
  canWrite: boolean;
  line: OrderDetail["lines"][number];
  orderId: string;
  orderStatus: OrderStatus;
  version: number;
  onChanged: (detail: OrderDetail) => void;
}) {
  const request = useRef(0);
  const [keyword, setKeyword] = useState("");
  const [skus, setSkus] = useState<ProductSku[]>([]);
  const [selectedSkuId, setSelectedSkuId] = useState("");
  const [searchState, setSearchState] = useState<DetailState>("idle");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const editable =
    canWrite && ["RECEIVED", "REVIEW_PENDING", "HOLD"].includes(orderStatus);

  useEffect(() => {
    if (!editable || !canReadProducts || !keyword.trim()) {
      request.current += 1;
      setSkus([]);
      setSelectedSkuId("");
      setSearchState("idle");
      return;
    }

    const currentRequest = ++request.current;
    setSearchState("loading");
    setMessage("");
    void productCenterApi
      .listSkus({
        keyword: keyword.trim(),
        status: "ACTIVE",
        page: 0,
        size: 25,
      })
      .then((response) => {
        if (currentRequest === request.current) {
          setSkus(response.items);
          setSelectedSkuId((current) =>
            response.items.some((sku) => sku.id === current) ? current : "",
          );
          setSearchState("idle");
        }
      })
      .catch((error: unknown) => {
        if (currentRequest === request.current) {
          setMessage(safeOrderError(error));
          setSearchState("error");
        }
      });

    return () => {
      if (currentRequest === request.current) {
        request.current += 1;
      }
    };
  }, [canReadProducts, editable, keyword]);

  const submit = async (skuId: string | null) => {
    if (submitting) {
      return;
    }
    if (skuId === null && !window.confirm("确认清除这条订单明细的 SKU 匹配吗？")) {
      return;
    }

    setSubmitting(true);
    setMessage("");
    try {
      onChanged(
        await orderCenterApi.changeLineSkuMatch(orderId, line.id, {
          version,
          skuId,
        }),
      );
      setSelectedSkuId("");
    } catch (error) {
      setMessage(safeOrderError(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="detail-form">
      <p>
        匹配来源：{skuMatchSourceLabel(line.skuMatchSource)}
        {line.skuMatchSource === "UNMATCHED" ? "（尚未匹配 SKU）" : ""}
      </p>
      {editable && !canReadProducts && (
        <p>需要商品查看权限后才能匹配 SKU。</p>
      )}
      {editable && canReadProducts && (
        <>
          <label htmlFor={`sku-search-${line.id}`}>
            搜索启用中的 SKU
            <input
              id={`sku-search-${line.id}`}
              disabled={submitting}
              value={keyword}
              onChange={(event) => {
                setSelectedSkuId("");
                setKeyword(event.target.value.slice(0, 100));
              }}
            />
          </label>
          {searchState === "loading" && <p aria-busy="true">正在搜索 SKU…</p>}
          {searchState === "error" && <p role="alert">{message}</p>}
          {searchState === "idle" && keyword && skus.length === 0 && (
            <p>未找到启用中的 SKU。</p>
          )}
          {skus.length > 0 && (
            <label htmlFor={`sku-choice-${line.id}`}>
              选择 SKU
              <select
                id={`sku-choice-${line.id}`}
                disabled={submitting}
                value={selectedSkuId}
                onChange={(event) => setSelectedSkuId(event.target.value)}
              >
                <option value="">请选择 SKU</option>
                {skus.map((sku) => (
                  <option key={sku.id} value={sku.id}>
                    {sku.businessCode} · {sku.name} ·{" "}
                    {sku.variantSummary || "—"} · {sku.id}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            className="button button-secondary"
            disabled={!selectedSkuId || submitting}
            type="button"
            onClick={() => void submit(selectedSkuId)}
          >
            {submitting ? "正在更新…" : "设置 SKU"}
          </button>
          {message && searchState !== "error" && <p role="alert">{message}</p>}
        </>
      )}
      {editable && line.skuId && (
        <button
          className="text-button"
          disabled={submitting}
          type="button"
          onClick={() => void submit(null)}
        >
          清除 SKU 匹配
        </button>
      )}
    </div>
  );
}
