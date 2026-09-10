import { apiClient } from "../api/client";

const API_BASE = "/api/v1/order-center";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export const orderStatuses = [
  "UNPAID",
  "RECEIVED",
  "REVIEW_PENDING",
  "MERGE_PENDING",
  "READY_TO_FULFILL",
  "FULFILLING",
  "SHIPPED",
  "DELIVERED",
  "HOLD",
  "CANCELLED",
] as const;

export type OrderStatus = (typeof orderStatuses)[number];
export const skuMatchSources = [
  "PROVIDED",
  "LISTING_MAPPING",
  "MANUAL",
  "UNMATCHED",
] as const;
export type SkuMatchSource = (typeof skuMatchSources)[number];

export type Page<T> = {
  items: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
};

export type Order = {
  id: string;
  shopId: string;
  shopName: string;
  warehouseId?: string;
  externalOrderRef: string;
  currency: string;
  buyerReference?: string;
  status: OrderStatus;
  holdReason?: string;
  lineCount: number;
  placedAt: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  platformStatus?: string;
  paymentStatus?: "UNPAID" | "PAID" | "PARTIALLY_REFUNDED" | "REFUNDED";
  logisticsChannel?: string;
  countryCode?: string;
  province?: string;
  postalCode?: string;
  buyerSelectedLogistics?: string;
  totalAmountMinor?: number;
  shippingAmountMinor?: number;
  weightGrams?: number;
  paidAt?: string;
  shipByAt?: string;
  shippedAt?: string;
  trackingStatus?: string;
  fixedCategory?: string;
  customCategory?: string;
  reshipment: boolean;
  reshipmentReason?: string;
  platformHandoverRequired: boolean;
  printed: boolean;
  salesRecordNumber?: string;
  shoppingCartReference?: string;
  customOrderReference?: string;
  trackingReference?: string;
  secondaryTrackingReference?: string;
  actualPaidMinor?: number;
  profitMinor?: number;
  actualShippingMinor?: number;
  itemAmountMinor?: number;
  platformFeeMinor?: number;
  insuranceFeeMinor?: number;
  paymentFeeMinor?: number;
  otherIncomeMinor?: number;
  otherExpenseMinor?: number;
  taxMinor?: number;
  estimatedShippingMinor?: number;
  salespersonDisplayName?: string;
  managerDisplayName?: string;
  orderRemark?: string;
  customerCategory?: string;
  productKindCount?: number;
  supplierReference?: string;
  parentProductCategory?: string;
  childProductCategory?: string;
  productStatus?: string;
  extendedAttribute?: string;
  warehouseDisplayName?: string;
  locationBusinessCode?: string;
  pickerDisplayName?: string;
  shipperDisplayName?: string;
  purchaserDisplayName?: string;
  developerDisplayName?: string;
  printedAt?: string;
  platformReturnedAt?: string;
  exceptionReviewedAt?: string;
  platformSpecifiedHandoverAt?: string;
  platformLabelRequestedAt?: string;
  deliveryDeadlineAt?: string;
  cancelledAt?: string;
  handedOverAt?: string;
  deliveredAt?: string;
  skuSummary?: string;
  titleSummary?: string;
};

export type OrderDetail = Order & {
  profile: OrderProfile;
  activities: OrderActivity[];
  lines: Array<{
    id: string;
    skuId?: string;
    skuCode?: string;
    lineKind: "PRODUCT" | "CUSTOM_AMOUNT";
    externalListingRef?: string;
    externalVariantRef?: string;
    skuMatchSource: SkuMatchSource;
    externalLineRef: string;
    titleSnapshot: string;
    quantity: number;
    unitPriceMinor: number;
    currency: string;
    discountTotalMinor: number;
    discountDescription?: string;
    createdAt: string;
    platformSku?: string;
    warehouseId?: string;
    locationId?: string;
    purchaseReference?: string;
  }>;
};

export const orderListStages = [
  "ALL",
  "UNPAID",
  "REVIEW_PENDING",
  "MERGE_PENDING",
  "PROCESSING",
  "FULFILLING",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
] as const;
export type OrderListStage = (typeof orderListStages)[number];

export const conditionFields = [
  "ORDER_NUMBER",
  "SALES_RECORD_NUMBER",
  "SHOPPING_CART_REFERENCE",
  "CUSTOMER_ID",
  "CUSTOMER_CODE",
  "RECIPIENT_NAME",
  "RECIPIENT_EMAIL",
  "RECIPIENT_PHONE",
  "POSTAL_CODE",
  "PROVINCE",
  "CITY",
  "TRACKING_REFERENCE",
  "PLATFORM_STATUS",
  "SUPPLIER_REFERENCE",
  "ORDER_REMARK",
  "EXTENDED_ATTRIBUTE",
  "PLATFORM_SKU",
  "INVENTORY_SKU",
  "PRODUCT_NAME",
] as const;
export type OrderConditionField = (typeof conditionFields)[number];
export const conditionOperators = [
  "EQUALS",
  "NOT_EQUALS",
  "CONTAINS",
  "NOT_CONTAINS",
  "IS_EMPTY",
  "IS_NOT_EMPTY",
] as const;
export type OrderConditionOperator = (typeof conditionOperators)[number];
export type OrderConditionLogic = "AND" | "OR";
export const orderTimeFields = [
  "PLACED",
  "PAID",
  "SHIPPED",
  "PRINTED",
  "CREATED",
  "PLATFORM_RETURNED",
  "EXCEPTION_REVIEWED",
  "CANCELLED",
  "HANDED_OVER",
  "PLATFORM_SPECIFIED_HANDOVER",
  "PLATFORM_LABEL_REQUESTED",
  "DELIVERY_DEADLINE",
  "DELIVERED",
] as const;
export type OrderTimeField = (typeof orderTimeFields)[number];
export const orderSortFields = [
  "PLACED_AT",
  "PAID_AT",
  "CREATED_AT",
  "UPDATED_AT",
  "SHIP_BY_AT",
  "TOTAL_AMOUNT",
  "EXTERNAL_ORDER_REF",
] as const;
export type OrderSortField = (typeof orderSortFields)[number];

export type OrderQuery = {
  shopId?: string;
  platformId?: string;
  status?: OrderStatus;
  stage?: OrderListStage;
  keyword?: string;
  skuKeyword?: string;
  warehouseId?: string;
  locationId?: string;
  paymentStatus?: Order["paymentStatus"];
  platformStatus?: string;
  countryCode?: string;
  trackingStatus?: string;
  logisticsChannel?: string;
  currency?: string;
  printed?: boolean;
  reshipment?: boolean;
  fixedCategory?: string;
  customCategory?: string;
  customerCategory?: string;
  pickerUserId?: string;
  shipperUserId?: string;
  salespersonUserId?: string;
  purchaserUserId?: string;
  developerUserId?: string;
  managerUserId?: string;
  supplierReference?: string;
  parentProductCategory?: string;
  childProductCategory?: string;
  productStatus?: string;
  extendedAttribute?: string;
  minProductKinds?: number;
  maxProductKinds?: number;
  minAmountMinor?: number;
  maxAmountMinor?: number;
  minWeightGrams?: number;
  maxWeightGrams?: number;
  placedFrom?: string;
  placedTo?: string;
  paidFrom?: string;
  paidTo?: string;
  conditionField1?: OrderConditionField;
  conditionOperator1?: OrderConditionOperator;
  conditionValue1?: string;
  conditionField2?: OrderConditionField;
  conditionOperator2?: OrderConditionOperator;
  conditionValue2?: string;
  conditionLogic?: OrderConditionLogic;
  timeField1?: OrderTimeField;
  timeFrom1?: string;
  timeTo1?: string;
  timeField2?: OrderTimeField;
  timeFrom2?: string;
  timeTo2?: string;
  sortField?: OrderSortField;
  sortDirection?: "ASC" | "DESC";
  page: number;
  size: number;
};

export type OrderProfile = {
  salesRecordNumber?: string;
  shoppingCartReference?: string;
  customOrderReference?: string;
  customerId?: string;
  customerCode?: string;
  recipientName?: string;
  recipientPhone?: string;
  recipientEmail?: string;
  recipientCompany?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  district?: string;
  town?: string;
  doorCode?: string;
  shippingService?: string;
  trackingReference?: string;
  secondaryTrackingReference?: string;
  itemAmountMinor?: number;
  platformFeeMinor?: number;
  insuranceFeeMinor?: number;
  paymentFeeMinor?: number;
  otherIncomeMinor?: number;
  otherExpenseMinor?: number;
  actualPaidMinor?: number;
  profitMinor?: number;
  taxMinor?: number;
  estimatedShippingMinor?: number;
  actualShippingMinor?: number;
  platformMessage?: string;
  platformRemark?: string;
  orderRemark?: string;
  declarationPlan?: string;
  declarationActual?: string;
  customerCategory?: string;
  productKindCount?: number;
  locationId?: string;
  pickerUserId?: string;
  shipperUserId?: string;
  salespersonUserId?: string;
  purchaserUserId?: string;
  developerUserId?: string;
  managerUserId?: string;
  supplierReference?: string;
  parentProductCategory?: string;
  childProductCategory?: string;
  productStatus?: string;
  extendedAttribute?: string;
  printedAt?: string;
  platformReturnedAt?: string;
  exceptionReviewedAt?: string;
  cancelledAt?: string;
  handedOverAt?: string;
  platformSpecifiedHandoverAt?: string;
  platformLabelRequestedAt?: string;
  deliveryDeadlineAt?: string;
  deliveredAt?: string;
  version: number;
  createdAt?: string;
  updatedAt?: string;
};

export type OrderActivity = {
  id: string;
  activityType: string;
  safeSummary: string;
  createdAt: string;
};

export type OrderTransferResult = {
  jobId: string;
  status: "SUCCEEDED" | "PARTIALLY_FAILED" | "FAILED";
  requestedCount: number;
  succeededCount: number;
  failedCount: number;
  filename?: string;
  mediaType?: string;
  contentBase64?: string;
};

export type OrderTransferJob = {
  id: string;
  jobType: "IMPORT" | "EXPORT" | "BULK_STATUS" | "BULK_EXCEPTION_RETRY";
  status:
    | "PENDING"
    | "RUNNING"
    | "SUCCEEDED"
    | "PARTIALLY_FAILED"
    | "FAILED"
    | "CANCELLED";
  requestedCount: number;
  succeededCount: number;
  failedCount: number;
  safeErrorSummary?: string;
  version: number;
  createdAt: string;
  completedAt?: string;
};

export type CreateOrderInput = {
  shopId: string;
  warehouseId?: string;
  externalOrderRef: string;
  idempotencyKey: string;
  currency: string;
  buyerReference?: string;
  placedAt: string;
  operational?: OrderOperationalInput;
  profile?: OrderProfileInput;
  lines: Array<{
    skuId?: string;
    externalListingRef?: string;
    externalVariantRef?: string;
    externalLineRef: string;
    titleSnapshot: string;
    quantity: number;
    unitPriceMinor: number;
    currency: string;
  }>;
};

export type OrderOperationalInput = {
  paymentStatus?: Order["paymentStatus"];
  platformStatus?: string;
  logisticsChannel?: string;
  countryCode?: string;
  province?: string;
  postalCode?: string;
  buyerSelectedLogistics?: string;
  totalAmountMinor?: number;
  shippingAmountMinor?: number;
  weightGrams?: number;
  paidAt?: string;
  shipByAt?: string;
  shippedAt?: string;
  trackingStatus?: string;
  fixedCategory?: string;
  customCategory?: string;
  reshipment?: boolean;
  reshipmentReason?: string;
  platformHandoverRequired?: boolean;
  printed?: boolean;
};

export type OrderProfileInput = {
  references?: {
    salesRecordNumber?: string;
    shoppingCartReference?: string;
    customOrderReference?: string;
    customerId?: string;
    customerCode?: string;
    shippingService?: string;
    trackingReference?: string;
    secondaryTrackingReference?: string;
  };
  recipient?: {
    name?: string;
    phone?: string;
    email?: string;
    company?: string;
    addressLine1?: string;
    addressLine2?: string;
    city?: string;
    district?: string;
    town?: string;
    doorCode?: string;
  };
  financials?: {
    itemAmountMinor?: number;
    platformFeeMinor?: number;
    insuranceFeeMinor?: number;
    paymentFeeMinor?: number;
    otherIncomeMinor?: number;
    otherExpenseMinor?: number;
    actualPaidMinor?: number;
    profitMinor?: number;
    taxMinor?: number;
    estimatedShippingMinor?: number;
    actualShippingMinor?: number;
  };
  messages?: {
    platformMessage?: string;
    platformRemark?: string;
    orderRemark?: string;
    declarationPlan?: string;
    declarationActual?: string;
  };
  classification?: {
    customerCategory?: string;
    productKindCount?: number;
    supplierReference?: string;
    parentProductCategory?: string;
    childProductCategory?: string;
    productStatus?: string;
    extendedAttribute?: string;
  };
  assignments?: {
    locationId?: string;
    pickerUserId?: string;
    shipperUserId?: string;
    salespersonUserId?: string;
    purchaserUserId?: string;
    developerUserId?: string;
    managerUserId?: string;
  };
  times?: {
    printedAt?: string;
    platformReturnedAt?: string;
    exceptionReviewedAt?: string;
    cancelledAt?: string;
    handedOverAt?: string;
    platformSpecifiedHandoverAt?: string;
    platformLabelRequestedAt?: string;
    deliveryDeadlineAt?: string;
    deliveredAt?: string;
  };
};

export type SkuMatchQueueItem = {
  orderId: string;
  orderVersion: number;
  orderStatus: Extract<OrderStatus, "RECEIVED" | "REVIEW_PENDING" | "HOLD">;
  shopId: string;
  externalOrderRef: string;
  placedAt: string;
  lineId: string;
  externalLineRef: string;
  titleSnapshot: string;
  externalListingRef?: string;
  externalVariantRef?: string;
  skuId?: string;
  skuMatchSource: "UNMATCHED";
};

export type SkuMatchQueueQuery = {
  shopId?: string;
  keyword?: string;
  page: number;
  size: number;
};

export const shopifyOrderLineMatchStatuses = [
  "EXACT_SKU_MATCH",
  "MISSING_LOCAL_SKU",
  "EMPTY_PLATFORM_SKU",
] as const;
export type ShopifyOrderLineMatchStatus =
  (typeof shopifyOrderLineMatchStatuses)[number];

export type ShopifyOrderCatalogPreviewRequest = {
  shopId: string;
  limit?: number;
  cursor?: string;
  query?: string;
  historical?: boolean;
};

export type ShopifyOrderCatalogImportRequest = ShopifyOrderCatalogPreviewRequest & {
  externalOrderRefs: string[];
};

export type ShopifyOrderCatalogImportResult = {
  requestedCount: number;
  importedCount: number;
  skippedCount: number;
  items: ShopifyOrderCatalogImportItemResult[];
};

export type ShopifyShippingAddressUpdateInput = {
  version: number;
  profileVersion: number;
  idempotencyKey: string;
  address: {
    firstName?: string;
    lastName?: string;
    company?: string;
    address1: string;
    address2?: string;
    city: string;
    provinceCode?: string;
    countryCode: string;
    zip?: string;
    phone?: string;
  };
};

export type ShopifyShippingAddressUpdateResult = {
  order: OrderDetail;
  synchronizedAt?: string;
  replayed: boolean;
};

export type ShopifyLineQuantityUpdateInput = {
  lineId: string;
  expectedQuantity: number;
  quantity: number;
  restock: boolean;
  notifyCustomer: boolean;
  idempotencyKey: string;
};

export type ShopifyLineQuantityUpdateResult = {
  order: OrderDetail;
  recoveredFromShopify: boolean;
  replayed: boolean;
  totalAmountMinor: number;
  currency: string;
  synchronizedAt?: string;
};

export type ShopifyVariantAddInput = {
  listingId: string;
  quantity: number;
  notifyCustomer: boolean;
  idempotencyKey: string;
};

export type ShopifyVariantAddResult = {
  order: OrderDetail;
  lineId: string;
  externalLineRef: string;
  recoveredFromShopify: boolean;
  replayed: boolean;
  unitPriceMinor: number;
  totalAmountMinor: number;
  currency: string;
  synchronizedAt?: string;
};

export type ShopifyCustomItemAddInput = {
  title: string;
  unitPriceMinor: number;
  quantity: number;
  requiresShipping: boolean;
  taxable: boolean;
  notifyCustomer: boolean;
  idempotencyKey: string;
};

export type ShopifyCustomItemAddResult = ShopifyVariantAddResult;

export type ShopifyLineDiscountInput = {
  lineId: string;
  description: string;
  discountType: "FIXED" | "PERCENTAGE";
  fixedValueMinor?: number;
  percentBasisPoints?: number;
  notifyCustomer: boolean;
  idempotencyKey: string;
};

export type ShopifyLineDiscountResult = {
  order: OrderDetail;
  lineId: string;
  recoveredFromShopify: boolean;
  replayed: boolean;
  discountTotalMinor: number;
  totalAmountMinor: number;
  currency: string;
  synchronizedAt?: string;
};

export type ShopifyOrderCancellationInput = {
  reason: "CUSTOMER" | "DECLINED" | "FRAUD" | "INVENTORY" | "STAFF" | "OTHER";
  staffNote?: string;
  refundOriginalPaymentMethods: boolean;
  restock: boolean;
  notifyCustomer: boolean;
  idempotencyKey: string;
};

export type ShopifyOrderCancellationResult = {
  order: OrderDetail;
  recoveredFromShopify: boolean;
  replayed: boolean;
  cancelledAt: string;
  jobId?: string;
  synchronizedAt?: string;
};

export type ShopifyOrderCatalogImportItemResult = {
  externalOrderRef: string;
  name?: string;
  orderId?: string;
  status:
    | "IMPORTED"
    | "SKIPPED_DUPLICATE"
    | "SKIPPED_NOT_IN_PAGE"
    | "SKIPPED_INVALID_ORDER"
    | "SKIPPED_CONFLICT";
  safeSummary?: string;
};

export type ShopifyOrderCatalogPreview = {
  mode: "UNCONFIGURED" | "DETERMINISTIC_FAKE" | "XZ_ERP_APP";
  connectionStatus:
    | "NOT_CONNECTED"
    | "PENDING"
    | "CONNECTED"
    | "FAILED"
    | "REVOKED";
  cursor?: string;
  hasNextPage: boolean;
  fetchedAt?: string;
  orders: ShopifyOrderPreview[];
};

export type ShopifyOrderPreview = {
  externalOrderRef: string;
  legacyResourceId?: string;
  name: string;
  email?: string;
  sourceName?: string;
  createdAt: string;
  updatedAt?: string;
  cancelledAt?: string;
  financialStatus?: string;
  fulfillmentStatus?: string;
  paymentGatewayNames: string[];
  total?: ShopifyMoneyPreview;
  subtotal?: ShopifyMoneyPreview;
  shipping?: ShopifyMoneyPreview;
  shippingAddress?: ShopifyAddressPreview;
  customer?: ShopifyCustomerPreview;
  lineItems: ShopifyOrderLinePreview[];
  fulfillments: ShopifyFulfillmentPreview[];
};

export type ShopifyOrderLinePreview = {
  externalLineRef: string;
  externalListingRef?: string;
  externalVariantRef?: string;
  inventoryItemRef?: string;
  name: string;
  title?: string;
  quantity: number;
  platformSku?: string;
  variantTitle?: string;
  requiresShipping: boolean;
  discountedTotal?: ShopifyMoneyPreview;
  originalUnitPrice?: ShopifyMoneyPreview;
  matchStatus: ShopifyOrderLineMatchStatus;
  localSku?: {
    id: string;
    businessCode: string;
    name: string;
    status: "ACTIVE" | "INACTIVE" | "ARCHIVED";
  };
};

export type ShopifyMoneyPreview = {
  amount?: string;
  amountMinor?: number;
  currencyCode?: string;
};

export type ShopifyAddressPreview = {
  name?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  address1?: string;
  address2?: string;
  city?: string;
  province?: string;
  provinceCode?: string;
  country?: string;
  countryCode?: string;
  zip?: string;
  phone?: string;
  formatted: string[];
};

export type ShopifyCustomerPreview = {
  externalCustomerRef?: string;
  displayName?: string;
  email?: string;
  phone?: string;
  createdAt?: string;
  totalSpent?: ShopifyMoneyPreview;
};

export type ShopifyFulfillmentPreview = {
  externalFulfillmentRef?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  trackingInfo: Array<{
    company?: string;
    number?: string;
    url?: string;
  }>;
};

export type DashboardSummary = {
  totalOrders: number;
  unpaidOrders: number;
  receivedOrders: number;
  reviewPendingOrders: number;
  mergePendingOrders: number;
  holdOrders: number;
  readyToFulfillOrders: number;
  fulfillingOrders: number;
  shippedOrders: number;
  deliveredOrders: number;
  cancelledOrders: number;
  editableOrders: number;
  unmatchedLines: number;
  oldestUnmatchedPlacedAt?: string;
};

export type SkuSalesSummary = {
  skuId: string;
  sales7: number;
  sales28: number;
  sales42: number;
};

export type FulfillmentPlan = {
  id: string;
  orderId: string;
  shopId: string;
  sourceOrderVersion: number;
  externalOrderRef: string;
  status: string;
  pauseState: "ACTIVE" | "PAUSED";
  pauseReasonCode?: string;
  shortageState: "NONE" | "PARTIAL" | "FULL" | "UNKNOWN";
  plannedQuantity: number;
  pickedQuantity: number;
  packedQuantity: number;
  shippedQuantity: number;
  cancelledQuantity: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  lines: Array<{
    id: string;
    orderLineId: string;
    splitSequence: number;
    skuId: string;
    warehouseId?: string;
    locationId?: string;
    plannedQuantity: number;
    pickedQuantity: number;
    packedQuantity: number;
    shippedQuantity: number;
    cancelledQuantity: number;
    externalLineRef: string;
    skuBusinessCode: string;
    skuName: string;
    inventoryOperationRef?: string;
    exceptionCode?: string;
  }>;
  packages: Array<{
    id: string;
    warehouseId: string;
    packageNumber: string;
    status: "DRAFT" | "SEALED" | "HANDED_OVER" | "HANDOVER_CORRECTED" | "VOIDED";
    weightGrams?: number;
    packagingTemplateId?: string;
    packagingCode?: string;
    packagingName?: string;
    packagingWeightGrams?: number;
    expectedWeightGrams?: number;
    allowedToleranceGrams?: number;
    weightDifferenceGrams?: number;
    weighingStatus: "PENDING" | "MISSING_WEIGHT" | "PASSED" | "BLOCKED" | "OVERRIDDEN";
    weighingSource?: "SCALE" | "MANUAL";
    shippingScaleId?: string;
    weighedAt?: string;
    version: number;
    sealedAt?: string;
    handedOverAt?: string;
    carrierCode?: string;
    serviceCode?: string;
    trackingReference?: string;
    logisticsAuthorizationId?: string;
    logisticsChannelId?: string;
    logisticsProviderCode?: string;
    logisticsProviderName?: string;
    logisticsAccountLabel?: string;
    logisticsChannelName?: string;
    logisticsClientReference?: string;
    logisticsProviderOrderReference?: string;
    logisticsLabelUrl?: string;
    logisticsBookingStatus:
      | "NOT_REQUESTED"
      | "BOOKING"
      | "BOOKED"
      | "FAILED"
      | "UNCERTAIN";
    logisticsTrackingStatus?:
      | "CREATED"
      | "IN_TRANSIT"
      | "DELIVERED"
      | "EXCEPTION"
      | "UNKNOWN";
    logisticsTrackingSummary?: string;
    logisticsLastSyncedAt?: string;
    logisticsSafeErrorCode?: string;
    logisticsProviderHandoverPending: boolean;
    shopifyPublicationStatus:
      | "NOT_PUBLISHED"
      | "PUBLISHING"
      | "PUBLISHED"
      | "UNCERTAIN";
    shopifyNotifyCustomer?: boolean;
    shopifyTrackingUrl?: string;
    externalShopifyFulfillmentRef?: string;
    shopifyPublishedAt?: string;
    items: Array<{ fulfillmentLineId: string; quantity: number }>;
  }>;
};

export type ShippingPackagingTemplate = {
  id: string;
  businessCode: string;
  name: string;
  packagingType: "BOX" | "MAILER" | "BAG" | "OTHER";
  standardWeightGrams: number;
  status: "ACTIVE" | "INACTIVE" | "ARCHIVED";
};

export type ShippingScale = {
  id: string;
  warehouseId: string;
  deviceNumber: string;
  displayName: string;
  status: "ACTIVE" | "INACTIVE";
};

export type ShopifyFulfillmentPublicationResult = {
  plan: FulfillmentPlan;
  externalFulfillmentRef: string;
  recoveredFromShopify: boolean;
  publishedAt: string;
  replayed: boolean;
};

type UnknownRecord = Record<string, unknown>;

function invalidResponse(): never {
  throw new Error("Invalid order response");
}

function invalidRequest(): never {
  throw new Error("Invalid order request");
}

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object";
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isCurrency(value: unknown): value is string {
  return typeof value === "string" && CURRENCY_PATTERN.test(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}

function isInstant(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) &&
    Number.isFinite(Date.parse(value))
  );
}

function isSafeHttpUrl(value: string, maxLength: number): boolean {
  if (
    value.length < 1 ||
    value.length > maxLength ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) return false;
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      Boolean(parsed.hostname) &&
      parsed.username === "" &&
      parsed.password === ""
    );
  } catch {
    return false;
  }
}

function isLineCount(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= 1 &&
    (value as number) <= 200
  );
}

function isStatus(value: unknown): value is OrderStatus {
  return (
    typeof value === "string" && orderStatuses.includes(value as OrderStatus)
  );
}

function isSkuMatchSource(value: unknown): value is SkuMatchSource {
  return (
    typeof value === "string" &&
    skuMatchSources.includes(value as SkuMatchSource)
  );
}

function stringField(value: unknown): string {
  if (typeof value !== "string") {
    invalidResponse();
  }

  return value;
}

function optionalString(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    invalidResponse();
  }

  return value;
}

function optionalUuid(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (!isUuid(value)) {
    invalidResponse();
  }

  return value;
}

function optionalInstant(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (!isInstant(value)) invalidResponse();
  return value;
}

function optionalNonNegativeNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    invalidResponse();
  }
  return value;
}

function optionalSafeInteger(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (!Number.isSafeInteger(value)) invalidResponse();
  return value as number;
}

function optionalPositiveInteger(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (!isPositiveInteger(value)) invalidResponse();
  return value;
}

function optionalPaymentStatus(value: unknown): Order["paymentStatus"] {
  if (value === null || value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    !["UNPAID", "PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(value)
  ) invalidResponse();
  return value as Order["paymentStatus"];
}

function optionalStringArray(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    invalidResponse();
  }
  return [...value];
}

function optionalMoney(value: unknown): ShopifyMoneyPreview | undefined {
  if (value === null || value === undefined) return undefined;
  if (!isRecord(value)) invalidResponse();
  return {
    amount: optionalString(value.amount),
    amountMinor: optionalNonNegativeNumber(value.amountMinor),
    currencyCode: optionalString(value.currencyCode),
  };
}

function optionalShopifyAddress(
  value: unknown,
): ShopifyAddressPreview | undefined {
  if (value === null || value === undefined) return undefined;
  if (!isRecord(value)) invalidResponse();
  return {
    name: optionalString(value.name),
    firstName: optionalString(value.firstName),
    lastName: optionalString(value.lastName),
    company: optionalString(value.company),
    address1: optionalString(value.address1),
    address2: optionalString(value.address2),
    city: optionalString(value.city),
    province: optionalString(value.province),
    provinceCode: optionalString(value.provinceCode),
    country: optionalString(value.country),
    countryCode: optionalString(value.countryCode),
    zip: optionalString(value.zip),
    phone: optionalString(value.phone),
    formatted: optionalStringArray(value.formatted),
  };
}

function optionalShopifyCustomer(
  value: unknown,
): ShopifyCustomerPreview | undefined {
  if (value === null || value === undefined) return undefined;
  if (!isRecord(value)) invalidResponse();
  return {
    externalCustomerRef: optionalString(value.externalCustomerRef),
    displayName: optionalString(value.displayName),
    email: optionalString(value.email),
    phone: optionalString(value.phone),
    createdAt: optionalInstant(value.createdAt),
    totalSpent: optionalMoney(value.totalSpent),
  };
}

function mapOrder(value: unknown): Order {
  if (!isRecord(value)) {
    invalidResponse();
  }

  if (
    !isUuid(value.id) ||
    !isUuid(value.shopId) ||
    !isCurrency(value.currency) ||
    !isStatus(value.status) ||
    !isLineCount(value.lineCount) ||
    !isNonNegativeInteger(value.version) ||
    typeof value.reshipment !== "boolean" ||
    typeof value.platformHandoverRequired !== "boolean" ||
    typeof value.printed !== "boolean"
  ) {
    invalidResponse();
  }

  return {
    id: value.id,
    shopId: value.shopId,
    // List responses carry the joined shop name, while the detail contract
    // intentionally returns only shopId. Keep the shared mapper compatible
    // with both response shapes instead of rejecting a valid detail payload.
    shopName: optionalString(value.shopName) ?? "—",
    warehouseId: optionalUuid(value.warehouseId),
    externalOrderRef: stringField(value.externalOrderRef),
    currency: value.currency,
    buyerReference: optionalString(value.buyerReference),
    status: value.status,
    holdReason: optionalString(value.holdReason),
    lineCount: value.lineCount,
    placedAt: stringField(value.placedAt),
    createdAt: stringField(value.createdAt),
    updatedAt: stringField(value.updatedAt),
    version: value.version,
    platformStatus: optionalString(value.platformStatus),
    paymentStatus: optionalPaymentStatus(value.paymentStatus),
    logisticsChannel: optionalString(value.logisticsChannel),
    countryCode: optionalString(value.countryCode),
    province: optionalString(value.province),
    postalCode: optionalString(value.postalCode),
    buyerSelectedLogistics: optionalString(value.buyerSelectedLogistics),
    totalAmountMinor: optionalNonNegativeNumber(value.totalAmountMinor),
    shippingAmountMinor: optionalNonNegativeNumber(value.shippingAmountMinor),
    weightGrams: optionalNonNegativeNumber(value.weightGrams),
    paidAt: optionalInstant(value.paidAt),
    shipByAt: optionalInstant(value.shipByAt),
    shippedAt: optionalInstant(value.shippedAt),
    trackingStatus: optionalString(value.trackingStatus),
    fixedCategory: optionalString(value.fixedCategory),
    customCategory: optionalString(value.customCategory),
    reshipment: value.reshipment,
    reshipmentReason: optionalString(value.reshipmentReason),
    platformHandoverRequired: value.platformHandoverRequired,
    printed: value.printed,
    salesRecordNumber: optionalString(value.salesRecordNumber),
    shoppingCartReference: optionalString(value.shoppingCartReference),
    customOrderReference: optionalString(value.customOrderReference),
    trackingReference: optionalString(value.trackingReference),
    secondaryTrackingReference:
      optionalString(value.secondaryTrackingReference),
    actualPaidMinor: optionalNonNegativeNumber(value.actualPaidMinor),
    profitMinor: optionalSafeInteger(value.profitMinor),
    actualShippingMinor: optionalNonNegativeNumber(value.actualShippingMinor),
    itemAmountMinor: optionalNonNegativeNumber(value.itemAmountMinor),
    platformFeeMinor: optionalNonNegativeNumber(value.platformFeeMinor),
    insuranceFeeMinor: optionalNonNegativeNumber(value.insuranceFeeMinor),
    paymentFeeMinor: optionalNonNegativeNumber(value.paymentFeeMinor),
    otherIncomeMinor: optionalNonNegativeNumber(value.otherIncomeMinor),
    otherExpenseMinor: optionalNonNegativeNumber(value.otherExpenseMinor),
    taxMinor: optionalSafeInteger(value.taxMinor),
    estimatedShippingMinor:
      optionalNonNegativeNumber(value.estimatedShippingMinor),
    salespersonDisplayName: optionalString(value.salespersonDisplayName),
    managerDisplayName: optionalString(value.managerDisplayName),
    orderRemark: optionalString(value.orderRemark),
    customerCategory: optionalString(value.customerCategory),
    productKindCount: optionalPositiveInteger(value.productKindCount),
    supplierReference: optionalString(value.supplierReference),
    parentProductCategory: optionalString(value.parentProductCategory),
    childProductCategory: optionalString(value.childProductCategory),
    productStatus: optionalString(value.productStatus),
    extendedAttribute: optionalString(value.extendedAttribute),
    warehouseDisplayName: optionalString(value.warehouseDisplayName),
    locationBusinessCode: optionalString(value.locationBusinessCode),
    pickerDisplayName: optionalString(value.pickerDisplayName),
    shipperDisplayName: optionalString(value.shipperDisplayName),
    purchaserDisplayName: optionalString(value.purchaserDisplayName),
    developerDisplayName: optionalString(value.developerDisplayName),
    printedAt: optionalInstant(value.printedAt),
    platformReturnedAt: optionalInstant(value.platformReturnedAt),
    exceptionReviewedAt: optionalInstant(value.exceptionReviewedAt),
    platformSpecifiedHandoverAt:
      optionalInstant(value.platformSpecifiedHandoverAt),
    platformLabelRequestedAt: optionalInstant(value.platformLabelRequestedAt),
    deliveryDeadlineAt: optionalInstant(value.deliveryDeadlineAt),
    cancelledAt: optionalInstant(value.cancelledAt),
    handedOverAt: optionalInstant(value.handedOverAt),
    deliveredAt: optionalInstant(value.deliveredAt),
    skuSummary: optionalString(value.skuSummary),
    titleSummary: optionalString(value.titleSummary),
  };
}

function mapLine(value: unknown): OrderDetail["lines"][number] {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !isCurrency(value.currency) ||
    !isSkuMatchSource(value.skuMatchSource) ||
    (value.lineKind !== "PRODUCT" && value.lineKind !== "CUSTOM_AMOUNT")
  ) {
    invalidResponse();
  }

  if (
    !Number.isSafeInteger(value.quantity) ||
    (value.quantity as number) <= 0 ||
    !Number.isSafeInteger(value.unitPriceMinor) ||
    (value.unitPriceMinor as number) < 0 ||
    !isNonNegativeInteger(value.discountTotalMinor)
  ) {
    invalidResponse();
  }

  const skuId = optionalUuid(value.skuId);
  const skuCode = optionalString(value.skuCode);
  const externalListingRef = optionalString(value.externalListingRef);
  const externalVariantRef = optionalString(value.externalVariantRef);

  if (externalVariantRef && !externalListingRef) {
    invalidResponse();
  }
  if (value.skuMatchSource === "UNMATCHED" ? skuId : !skuId) {
    invalidResponse();
  }
  if (!skuId && skuCode) {
    invalidResponse();
  }
  if (
    value.lineKind === "CUSTOM_AMOUNT" &&
    (skuId || externalListingRef || externalVariantRef ||
      value.skuMatchSource !== "UNMATCHED" ||
      value.discountTotalMinor !== 0 || value.discountDescription != null)
  ) {
    invalidResponse();
  }

  return {
    id: value.id,
    skuId,
    skuCode,
    lineKind: value.lineKind,
    externalListingRef,
    externalVariantRef,
    skuMatchSource: value.skuMatchSource,
    externalLineRef: stringField(value.externalLineRef),
    titleSnapshot: stringField(value.titleSnapshot),
    quantity: value.quantity as number,
    unitPriceMinor: value.unitPriceMinor as number,
    currency: value.currency,
    discountTotalMinor: value.discountTotalMinor,
    discountDescription: optionalString(value.discountDescription),
    createdAt: stringField(value.createdAt),
    platformSku: optionalString(value.platformSku),
    warehouseId: optionalUuid(value.warehouseId),
    locationId: optionalUuid(value.locationId),
    purchaseReference: optionalString(value.purchaseReference),
  };
}

function mapProfile(value: unknown): OrderProfile {
  if (!isRecord(value) || !isNonNegativeInteger(value.version)) {
    invalidResponse();
  }
  const optionalStrings = [
    "salesRecordNumber",
    "shoppingCartReference",
    "customOrderReference",
    "customerId",
    "customerCode",
    "recipientName",
    "recipientPhone",
    "recipientEmail",
    "recipientCompany",
    "addressLine1",
    "addressLine2",
    "city",
    "district",
    "town",
    "doorCode",
    "shippingService",
    "trackingReference",
    "secondaryTrackingReference",
    "platformMessage",
    "platformRemark",
    "orderRemark",
    "declarationPlan",
    "declarationActual",
    "customerCategory",
    "supplierReference",
    "parentProductCategory",
    "childProductCategory",
    "productStatus",
    "extendedAttribute",
  ] as const;
  const strings = Object.fromEntries(
    optionalStrings.map((name) => [name, optionalString(value[name])]),
  ) as Pick<OrderProfile, (typeof optionalStrings)[number]>;
  const optionalUuids = [
    "locationId",
    "pickerUserId",
    "shipperUserId",
    "salespersonUserId",
    "purchaserUserId",
    "developerUserId",
    "managerUserId",
  ] as const;
  const uuids = Object.fromEntries(
    optionalUuids.map((name) => [name, optionalUuid(value[name])]),
  ) as Pick<OrderProfile, (typeof optionalUuids)[number]>;
  const optionalInstants = [
    "printedAt",
    "platformReturnedAt",
    "exceptionReviewedAt",
    "cancelledAt",
    "handedOverAt",
    "platformSpecifiedHandoverAt",
    "platformLabelRequestedAt",
    "deliveryDeadlineAt",
    "deliveredAt",
    "createdAt",
    "updatedAt",
  ] as const;
  const instants = Object.fromEntries(
    optionalInstants.map((name) => [name, optionalInstant(value[name])]),
  ) as Pick<OrderProfile, (typeof optionalInstants)[number]>;
  return {
    ...strings,
    ...uuids,
    itemAmountMinor: optionalNonNegativeNumber(value.itemAmountMinor),
    platformFeeMinor: optionalNonNegativeNumber(value.platformFeeMinor),
    insuranceFeeMinor: optionalNonNegativeNumber(value.insuranceFeeMinor),
    paymentFeeMinor: optionalNonNegativeNumber(value.paymentFeeMinor),
    otherIncomeMinor: optionalNonNegativeNumber(value.otherIncomeMinor),
    otherExpenseMinor: optionalNonNegativeNumber(value.otherExpenseMinor),
    actualPaidMinor: optionalNonNegativeNumber(value.actualPaidMinor),
    profitMinor: optionalSafeInteger(value.profitMinor),
    taxMinor: optionalSafeInteger(value.taxMinor),
    estimatedShippingMinor:
      optionalNonNegativeNumber(value.estimatedShippingMinor),
    actualShippingMinor:
      optionalNonNegativeNumber(value.actualShippingMinor),
    productKindCount: optionalNonNegativeNumber(value.productKindCount),
    ...instants,
    version: value.version,
  };
}

function mapActivity(value: unknown): OrderActivity {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    typeof value.activityType !== "string" ||
    typeof value.safeSummary !== "string" ||
    !isInstant(value.createdAt)
  ) invalidResponse();
  return {
    id: value.id,
    activityType: value.activityType,
    safeSummary: value.safeSummary,
    createdAt: value.createdAt,
  };
}

function mapTransferResult(value: unknown): OrderTransferResult {
  if (
    !isRecord(value) ||
    !isUuid(value.jobId) ||
    !["SUCCEEDED", "PARTIALLY_FAILED", "FAILED"].includes(
      String(value.status),
    ) ||
    !isNonNegativeInteger(value.requestedCount) ||
    !isNonNegativeInteger(value.succeededCount) ||
    !isNonNegativeInteger(value.failedCount)
  ) invalidResponse();
  return {
    jobId: value.jobId,
    status: value.status as OrderTransferResult["status"],
    requestedCount: value.requestedCount,
    succeededCount: value.succeededCount,
    failedCount: value.failedCount,
    filename: optionalString(value.filename),
    mediaType: optionalString(value.mediaType),
    contentBase64: optionalString(value.contentBase64),
  };
}

function mapTransferJob(value: unknown): OrderTransferJob {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !(["IMPORT", "EXPORT", "BULK_STATUS", "BULK_EXCEPTION_RETRY"] as const)
      .includes(value.jobType as OrderTransferJob["jobType"]) ||
    !(
      ["PENDING", "RUNNING", "SUCCEEDED", "PARTIALLY_FAILED", "FAILED", "CANCELLED"] as const
    ).includes(value.status as OrderTransferJob["status"]) ||
    !isNonNegativeInteger(value.requestedCount) ||
    !isNonNegativeInteger(value.succeededCount) ||
    !isNonNegativeInteger(value.failedCount) ||
    value.succeededCount + value.failedCount > value.requestedCount ||
    !isNonNegativeInteger(value.version) ||
    !isInstant(value.createdAt)
  ) invalidResponse();
  const completedAt =
    value.completedAt === null ? undefined : stringField(value.completedAt);
  if (completedAt && !isInstant(completedAt)) invalidResponse();
  return {
    id: value.id,
    jobType: value.jobType as OrderTransferJob["jobType"],
    status: value.status as OrderTransferJob["status"],
    requestedCount: value.requestedCount,
    succeededCount: value.succeededCount,
    failedCount: value.failedCount,
    safeErrorSummary: optionalString(value.safeErrorSummary),
    version: value.version,
    createdAt: value.createdAt,
    completedAt,
  };
}

function mapTransferPage(value: unknown): Page<OrderTransferJob> {
  if (
    !isRecord(value) ||
    !Array.isArray(value.items) ||
    !isNonNegativeInteger(value.page) ||
    !isPositiveInteger(value.size) ||
    !isNonNegativeInteger(value.totalElements) ||
    !isNonNegativeInteger(value.totalPages)
  ) invalidResponse();
  return {
    items: value.items.map(mapTransferJob),
    page: value.page,
    size: value.size,
    totalElements: value.totalElements,
    totalPages: value.totalPages,
  };
}

function mapDetail(value: unknown): OrderDetail {
  const order = mapOrder(value);

  if (
    !isRecord(value) ||
    !Array.isArray(value.lines) ||
    !Array.isArray(value.activities)
  ) {
    invalidResponse();
  }

  return {
    ...order,
    profile: mapProfile(value.profile),
    activities: value.activities.map(mapActivity),
    lines: value.lines.map(mapLine),
  };
}

function mapPage(value: unknown): Page<Order> {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    invalidResponse();
  }

  if (
    !isNonNegativeInteger(value.page) ||
    !isPositiveInteger(value.size) ||
    !isNonNegativeInteger(value.totalElements) ||
    !isNonNegativeInteger(value.totalPages)
  ) {
    invalidResponse();
  }

  return {
    items: value.items.map(mapOrder),
    page: value.page,
    size: value.size,
    totalElements: value.totalElements,
    totalPages: value.totalPages,
  };
}

function mapSkuMatchQueueItem(value: unknown): SkuMatchQueueItem {
  if (
    !isRecord(value) ||
    !isUuid(value.orderId) ||
    !isUuid(value.lineId) ||
    !isUuid(value.shopId) ||
    !isNonNegativeInteger(value.orderVersion)
  )
    invalidResponse();
  if (
    !(["RECEIVED", "REVIEW_PENDING", "HOLD"] as const).includes(
      value.orderStatus as "RECEIVED" | "REVIEW_PENDING" | "HOLD",
    )
  )
    invalidResponse();
  const listing = optionalString(value.externalListingRef);
  const variant = optionalString(value.externalVariantRef);
  if (
    (variant && !listing) ||
    optionalUuid(value.skuId) ||
    value.skuMatchSource !== "UNMATCHED"
  )
    invalidResponse();
  return {
    orderId: value.orderId,
    orderVersion: value.orderVersion,
    orderStatus: value.orderStatus as SkuMatchQueueItem["orderStatus"],
    shopId: value.shopId,
    externalOrderRef: stringField(value.externalOrderRef),
    placedAt: stringField(value.placedAt),
    lineId: value.lineId,
    externalLineRef: stringField(value.externalLineRef),
    titleSnapshot: stringField(value.titleSnapshot),
    externalListingRef: listing,
    externalVariantRef: variant,
    skuId: undefined,
    skuMatchSource: "UNMATCHED",
  };
}

function mapSkuMatchQueuePage(value: unknown): Page<SkuMatchQueueItem> {
  if (
    !isRecord(value) ||
    !Array.isArray(value.items) ||
    !isNonNegativeInteger(value.page) ||
    !isPositiveInteger(value.size) ||
    !isNonNegativeInteger(value.totalElements) ||
    !isNonNegativeInteger(value.totalPages)
  )
    invalidResponse();
  return {
    items: value.items.map(mapSkuMatchQueueItem),
    page: value.page,
    size: value.size,
    totalElements: value.totalElements,
    totalPages: value.totalPages,
  };
}

function mapShopifyOrderLine(
  value: unknown,
): ShopifyOrderLinePreview {
  if (
    !isRecord(value) ||
    typeof value.externalLineRef !== "string" ||
    typeof value.name !== "string" ||
    !isPositiveInteger(value.quantity) ||
    typeof value.requiresShipping !== "boolean" ||
    !shopifyOrderLineMatchStatuses.includes(
      value.matchStatus as ShopifyOrderLineMatchStatus,
    )
  ) {
    invalidResponse();
  }
  const localSku =
    value.localSku === null || value.localSku === undefined
      ? undefined
      : value.localSku;
  if (localSku !== undefined) {
    if (
      !isRecord(localSku) ||
      !isUuid(localSku.id) ||
      typeof localSku.businessCode !== "string" ||
      typeof localSku.name !== "string" ||
      !["ACTIVE", "INACTIVE", "ARCHIVED"].includes(String(localSku.status))
    ) {
      invalidResponse();
    }
  }
  const mappedLocalSku =
    localSku === undefined
      ? undefined
      : {
          id: localSku.id as string,
          businessCode: localSku.businessCode as string,
          name: localSku.name as string,
          status: localSku.status as "ACTIVE" | "INACTIVE" | "ARCHIVED",
        };
  if (
    value.matchStatus === "EXACT_SKU_MATCH"
      ? mappedLocalSku === undefined
      : mappedLocalSku !== undefined
  ) {
    invalidResponse();
  }
  return {
    externalLineRef: value.externalLineRef,
    externalListingRef: optionalString(value.externalListingRef),
    externalVariantRef: optionalString(value.externalVariantRef),
    inventoryItemRef: optionalString(value.inventoryItemRef),
    name: value.name,
    title: optionalString(value.title),
    quantity: value.quantity,
    platformSku: optionalString(value.platformSku),
    variantTitle: optionalString(value.variantTitle),
    requiresShipping: value.requiresShipping,
    discountedTotal: optionalMoney(value.discountedTotal),
    originalUnitPrice: optionalMoney(value.originalUnitPrice),
    matchStatus: value.matchStatus as ShopifyOrderLineMatchStatus,
    localSku: mappedLocalSku,
  };
}

function mapShopifyFulfillment(
  value: unknown,
): ShopifyFulfillmentPreview {
  if (!isRecord(value)) invalidResponse();
  if (!Array.isArray(value.trackingInfo)) invalidResponse();
  return {
    externalFulfillmentRef: optionalString(value.externalFulfillmentRef),
    status: optionalString(value.status),
    createdAt: optionalInstant(value.createdAt),
    updatedAt: optionalInstant(value.updatedAt),
    trackingInfo: value.trackingInfo.map((tracking) => {
      if (!isRecord(tracking)) invalidResponse();
      return {
        company: optionalString(tracking.company),
        number: optionalString(tracking.number),
        url: optionalString(tracking.url),
      };
    }),
  };
}

function mapShopifyOrder(value: unknown): ShopifyOrderPreview {
  if (
    !isRecord(value) ||
    typeof value.externalOrderRef !== "string" ||
    typeof value.name !== "string" ||
    !isInstant(value.createdAt) ||
    !Array.isArray(value.lineItems) ||
    !Array.isArray(value.fulfillments)
  ) {
    invalidResponse();
  }
  return {
    externalOrderRef: value.externalOrderRef,
    legacyResourceId: optionalString(value.legacyResourceId),
    name: value.name,
    email: optionalString(value.email),
    sourceName: optionalString(value.sourceName),
    createdAt: value.createdAt,
    updatedAt: optionalInstant(value.updatedAt),
    cancelledAt: optionalInstant(value.cancelledAt),
    financialStatus: optionalString(value.financialStatus),
    fulfillmentStatus: optionalString(value.fulfillmentStatus),
    paymentGatewayNames: optionalStringArray(value.paymentGatewayNames),
    total: optionalMoney(value.total),
    subtotal: optionalMoney(value.subtotal),
    shipping: optionalMoney(value.shipping),
    shippingAddress: optionalShopifyAddress(value.shippingAddress),
    customer: optionalShopifyCustomer(value.customer),
    lineItems: value.lineItems.map(mapShopifyOrderLine),
    fulfillments: value.fulfillments.map(mapShopifyFulfillment),
  };
}

function mapShopifyOrderCatalogPreview(
  value: unknown,
): ShopifyOrderCatalogPreview {
  if (
    !isRecord(value) ||
    !["UNCONFIGURED", "DETERMINISTIC_FAKE", "XZ_ERP_APP"].includes(
      String(value.mode),
    ) ||
    !["NOT_CONNECTED", "PENDING", "CONNECTED", "FAILED", "REVOKED"]
      .includes(String(value.connectionStatus)) ||
    typeof value.hasNextPage !== "boolean" ||
    !Array.isArray(value.orders)
  ) {
    invalidResponse();
  }
  return {
    mode: value.mode as ShopifyOrderCatalogPreview["mode"],
    connectionStatus:
      value.connectionStatus as ShopifyOrderCatalogPreview["connectionStatus"],
    cursor: optionalString(value.cursor),
    hasNextPage: value.hasNextPage,
    fetchedAt: optionalInstant(value.fetchedAt),
    orders: value.orders.map(mapShopifyOrder),
  };
}

function mapShopifyOrderCatalogImportResult(
  value: unknown,
): ShopifyOrderCatalogImportResult {
  if (
    !isRecord(value) ||
    !isNonNegativeInteger(value.requestedCount) ||
    !isNonNegativeInteger(value.importedCount) ||
    !isNonNegativeInteger(value.skippedCount) ||
    !Array.isArray(value.items)
  ) {
    invalidResponse();
  }
  return {
    requestedCount: value.requestedCount,
    importedCount: value.importedCount,
    skippedCount: value.skippedCount,
    items: value.items.map((item) => {
      if (
        !isRecord(item) ||
        typeof item.externalOrderRef !== "string" ||
        ![
          "IMPORTED",
          "SKIPPED_DUPLICATE",
          "SKIPPED_NOT_IN_PAGE",
          "SKIPPED_INVALID_ORDER",
          "SKIPPED_CONFLICT",
        ].includes(String(item.status))
      ) {
        invalidResponse();
      }
      return {
        externalOrderRef: item.externalOrderRef,
        name: optionalString(item.name),
        orderId: optionalUuid(item.orderId),
        status: item.status as ShopifyOrderCatalogImportItemResult["status"],
        safeSummary: optionalString(item.safeSummary),
      };
    }),
  };
}

function mapShopifyShippingAddressUpdateResult(
  value: unknown,
): ShopifyShippingAddressUpdateResult {
  if (!isRecord(value) || typeof value.replayed !== "boolean") {
    invalidResponse();
  }
  return {
    order: mapDetail(value.order),
    synchronizedAt: optionalInstant(value.synchronizedAt),
    replayed: value.replayed,
  };
}

function mapShopifyLineQuantityUpdateResult(
  value: unknown,
): ShopifyLineQuantityUpdateResult {
  if (
    !isRecord(value) ||
    typeof value.recoveredFromShopify !== "boolean" ||
    typeof value.replayed !== "boolean" ||
    !isNonNegativeInteger(value.totalAmountMinor) ||
    typeof value.currency !== "string" ||
    !/^[A-Z]{3}$/.test(value.currency)
  ) {
    invalidResponse();
  }
  return {
    order: mapDetail(value.order),
    recoveredFromShopify: value.recoveredFromShopify,
    replayed: value.replayed,
    totalAmountMinor: value.totalAmountMinor,
    currency: value.currency,
    synchronizedAt: optionalInstant(value.synchronizedAt),
  };
}

function mapShopifyVariantAddResult(
  value: unknown,
): ShopifyVariantAddResult {
  if (
    !isRecord(value) ||
    !isUuid(value.lineId) ||
    typeof value.externalLineRef !== "string" ||
    !/^gid:\/\/shopify\/LineItem\/[0-9]+$/.test(value.externalLineRef) ||
    typeof value.recoveredFromShopify !== "boolean" ||
    typeof value.replayed !== "boolean" ||
    !isNonNegativeInteger(value.unitPriceMinor) ||
    !isNonNegativeInteger(value.totalAmountMinor) ||
    typeof value.currency !== "string" ||
    !CURRENCY_PATTERN.test(value.currency)
  ) {
    invalidResponse();
  }
  return {
    order: mapDetail(value.order),
    lineId: value.lineId,
    externalLineRef: value.externalLineRef,
    recoveredFromShopify: value.recoveredFromShopify,
    replayed: value.replayed,
    unitPriceMinor: value.unitPriceMinor,
    totalAmountMinor: value.totalAmountMinor,
    currency: value.currency,
    synchronizedAt: optionalInstant(value.synchronizedAt),
  };
}

function mapShopifyCustomItemAddResult(
  value: unknown,
): ShopifyCustomItemAddResult {
  return mapShopifyVariantAddResult(value);
}

function mapShopifyLineDiscountResult(
  value: unknown,
): ShopifyLineDiscountResult {
  if (
    !isRecord(value) ||
    !isUuid(value.lineId) ||
    typeof value.recoveredFromShopify !== "boolean" ||
    typeof value.replayed !== "boolean" ||
    !isNonNegativeInteger(value.discountTotalMinor) ||
    value.discountTotalMinor < 1 ||
    !isNonNegativeInteger(value.totalAmountMinor) ||
    !isCurrency(value.currency)
  ) {
    invalidResponse();
  }
  return {
    order: mapDetail(value.order),
    lineId: value.lineId,
    recoveredFromShopify: value.recoveredFromShopify,
    replayed: value.replayed,
    discountTotalMinor: value.discountTotalMinor,
    totalAmountMinor: value.totalAmountMinor,
    currency: value.currency,
    synchronizedAt: optionalInstant(value.synchronizedAt),
  };
}

function mapShopifyOrderCancellationResult(
  value: unknown,
): ShopifyOrderCancellationResult {
  if (
    !isRecord(value) || typeof value.recoveredFromShopify !== "boolean" ||
    typeof value.replayed !== "boolean" || !isInstant(value.cancelledAt)
  ) invalidResponse();
  return {
    order: mapDetail(value.order),
    recoveredFromShopify: value.recoveredFromShopify,
    replayed: value.replayed,
    cancelledAt: value.cancelledAt,
    jobId: optionalString(value.jobId),
    synchronizedAt: optionalInstant(value.synchronizedAt),
  };
}

function validateShopifyLineQuantityUpdate(
  orderId: string,
  input: ShopifyLineQuantityUpdateInput,
): void {
  if (
    !isUuid(orderId) ||
    !isUuid(input.lineId) ||
    !Number.isInteger(input.expectedQuantity) ||
    input.expectedQuantity < 1 ||
    input.expectedQuantity > 100_000 ||
    !isNonNegativeInteger(input.quantity) ||
    input.quantity > 100_000 ||
    input.quantity === input.expectedQuantity ||
    (input.restock && input.quantity >= input.expectedQuantity) ||
    typeof input.notifyCustomer !== "boolean" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(input.idempotencyKey)
  ) {
    invalidRequest();
  }
}

function validateShopifyVariantAdd(
  orderId: string,
  input: ShopifyVariantAddInput,
): void {
  if (
    !isUuid(orderId) ||
    !isUuid(input.listingId) ||
    !Number.isInteger(input.quantity) ||
    input.quantity < 1 ||
    input.quantity > 100_000 ||
    typeof input.notifyCustomer !== "boolean" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(input.idempotencyKey)
  ) {
    invalidRequest();
  }
}

function validateShopifyCustomItemAdd(
  orderId: string,
  input: ShopifyCustomItemAddInput,
): void {
  if (
    !isUuid(orderId) ||
    typeof input.title !== "string" ||
    input.title.trim().length < 1 ||
    input.title.trim().length > 255 ||
    !isNonNegativeInteger(input.unitPriceMinor) ||
    !Number.isInteger(input.quantity) ||
    input.quantity < 1 ||
    input.quantity > 100_000 ||
    typeof input.requiresShipping !== "boolean" ||
    typeof input.taxable !== "boolean" ||
    typeof input.notifyCustomer !== "boolean" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(input.idempotencyKey)
  ) {
    invalidRequest();
  }
}

function validateShopifyLineDiscount(
  orderId: string,
  input: ShopifyLineDiscountInput,
): void {
  const fixed = input.discountType === "FIXED" &&
    isPositiveInteger(input.fixedValueMinor) &&
    input.percentBasisPoints === undefined;
  const percentage = input.discountType === "PERCENTAGE" &&
    input.fixedValueMinor === undefined &&
    isPositiveInteger(input.percentBasisPoints) &&
    input.percentBasisPoints <= 10_000;
  if (
    !isUuid(orderId) || !isUuid(input.lineId) ||
    typeof input.description !== "string" ||
    input.description.trim().length < 1 ||
    input.description.trim().length > 255 ||
    (!fixed && !percentage) ||
    typeof input.notifyCustomer !== "boolean" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(input.idempotencyKey)
  ) {
    invalidRequest();
  }
}

function validateShopifyOrderCancellation(
  orderId: string,
  input: ShopifyOrderCancellationInput,
): void {
  if (
    !isUuid(orderId) ||
    !(["CUSTOMER", "DECLINED", "FRAUD", "INVENTORY", "STAFF", "OTHER"] as const)
      .includes(input.reason) ||
    (input.staffNote !== undefined && (
      typeof input.staffNote !== "string" || input.staffNote.trim().length > 180 ||
      /[\u0000-\u001f\u007f]/.test(input.staffNote)
    )) ||
    typeof input.refundOriginalPaymentMethods !== "boolean" ||
    typeof input.restock !== "boolean" ||
    typeof input.notifyCustomer !== "boolean" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(input.idempotencyKey)
  ) invalidRequest();
}

function validateShopifyShippingAddressUpdate(
  id: string,
  input: ShopifyShippingAddressUpdateInput,
): void {
  const { address } = input;
  const validOptional = (value: string | undefined, maxLength: number) =>
    value === undefined || value.trim().length <= maxLength;
  if (
    !isUuid(id) ||
    !isNonNegativeInteger(input.version) ||
    !isNonNegativeInteger(input.profileVersion) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(input.idempotencyKey) ||
    !isRecord(address) ||
    typeof address.address1 !== "string" ||
    address.address1.trim().length < 1 ||
    address.address1.trim().length > 300 ||
    typeof address.city !== "string" ||
    address.city.trim().length < 1 ||
    address.city.trim().length > 120 ||
    typeof address.countryCode !== "string" ||
    !/^[A-Z]{2}$/.test(address.countryCode) ||
    !validOptional(address.firstName, 100) ||
    !validOptional(address.lastName, 100) ||
    !validOptional(address.company, 200) ||
    !validOptional(address.address2, 300) ||
    !validOptional(address.provinceCode, 32) ||
    !validOptional(address.zip, 32) ||
    !validOptional(address.phone, 40)
  ) {
    invalidRequest();
  }
}

function mapFulfillmentPlan(value: unknown): FulfillmentPlan {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !isUuid(value.orderId) ||
    !isUuid(value.shopId) ||
    !isNonNegativeInteger(value.sourceOrderVersion) ||
    typeof value.externalOrderRef !== "string" ||
    typeof value.status !== "string" ||
    !["ACTIVE", "PAUSED"].includes(String(value.pauseState)) ||
    !["NONE", "PARTIAL", "FULL", "UNKNOWN"].includes(
      String(value.shortageState),
    ) ||
    !isNonNegativeInteger(value.plannedQuantity) ||
    !isNonNegativeInteger(value.pickedQuantity) ||
    !isNonNegativeInteger(value.packedQuantity) ||
    !isNonNegativeInteger(value.shippedQuantity) ||
    !isNonNegativeInteger(value.cancelledQuantity) ||
    !isNonNegativeInteger(value.version) ||
    !isInstant(value.createdAt) ||
    !isInstant(value.updatedAt) ||
    !Array.isArray(value.lines) ||
    !Array.isArray(value.packages)
  ) invalidResponse();
  const lines = value.lines.map((item) => {
    if (
      !isRecord(item) ||
      !isUuid(item.id) ||
      !isUuid(item.orderLineId) ||
      !isUuid(item.skuId) ||
      !isNonNegativeInteger(item.splitSequence) ||
      !isNonNegativeInteger(item.plannedQuantity) ||
      !isNonNegativeInteger(item.pickedQuantity) ||
      !isNonNegativeInteger(item.packedQuantity) ||
      !isNonNegativeInteger(item.shippedQuantity) ||
      !isNonNegativeInteger(item.cancelledQuantity)
    ) invalidResponse();
    return {
      id: item.id,
      orderLineId: item.orderLineId,
      splitSequence: item.splitSequence,
      skuId: item.skuId,
      warehouseId: optionalUuid(item.warehouseId),
      locationId: optionalUuid(item.locationId),
      plannedQuantity: item.plannedQuantity,
      pickedQuantity: item.pickedQuantity,
      packedQuantity: item.packedQuantity,
      shippedQuantity: item.shippedQuantity,
      cancelledQuantity: item.cancelledQuantity,
      externalLineRef: stringField(item.externalLineRef),
      skuBusinessCode: stringField(item.skuBusinessCode),
      skuName: stringField(item.skuName),
      inventoryOperationRef:
        optionalString(item.inventoryOperationRef),
      exceptionCode: optionalString(item.exceptionCode),
    };
  });
  const packages = value.packages.map((item) => {
    if (!isRecord(item)) invalidResponse();
    const logisticsBookingStatus = item.logisticsBookingStatus ??
      "NOT_REQUESTED";
    const logisticsProviderHandoverPending =
      item.logisticsProviderHandoverPending ?? false;
    if (
      !isUuid(item.id) ||
      !isUuid(item.warehouseId) ||
      typeof item.packageNumber !== "string" ||
      !["DRAFT", "SEALED", "HANDED_OVER", "HANDOVER_CORRECTED", "VOIDED"]
        .includes(String(item.status)) ||
      !["NOT_PUBLISHED", "PUBLISHING", "PUBLISHED", "UNCERTAIN"]
        .includes(String(item.shopifyPublicationStatus)) ||
      !["PENDING", "MISSING_WEIGHT", "PASSED", "BLOCKED", "OVERRIDDEN"]
        .includes(String(item.weighingStatus)) ||
      !["NOT_REQUESTED", "BOOKING", "BOOKED", "FAILED", "UNCERTAIN"]
        .includes(String(logisticsBookingStatus)) ||
      (item.logisticsTrackingStatus !== undefined &&
        item.logisticsTrackingStatus !== null &&
        !["CREATED", "IN_TRANSIT", "DELIVERED", "EXCEPTION", "UNKNOWN"]
          .includes(String(item.logisticsTrackingStatus))) ||
      typeof logisticsProviderHandoverPending !== "boolean" ||
      !isNonNegativeInteger(item.version) ||
      !Array.isArray(item.items)
    ) invalidResponse();
    const externalShopifyFulfillmentRef = optionalString(
      item.externalShopifyFulfillmentRef,
    );
    const shopifyPublishedAt = optionalInstant(item.shopifyPublishedAt);
    const shopifyNotifyCustomer =
      typeof item.shopifyNotifyCustomer === "boolean"
        ? item.shopifyNotifyCustomer
        : undefined;
    if (
      item.shopifyNotifyCustomer !== undefined &&
      item.shopifyNotifyCustomer !== null &&
      shopifyNotifyCustomer === undefined
    ) invalidResponse();
    const shopifyTrackingUrl = optionalString(item.shopifyTrackingUrl);
    const logisticsLabelUrl = optionalString(item.logisticsLabelUrl);
    if (
      shopifyTrackingUrl !== undefined &&
      !isSafeHttpUrl(shopifyTrackingUrl, 2048)
    ) invalidResponse();
    if (
      logisticsLabelUrl !== undefined &&
      !isSafeHttpUrl(logisticsLabelUrl, 2048)
    ) invalidResponse();
    if (
      externalShopifyFulfillmentRef !== undefined &&
      !/^gid:\/\/shopify\/Fulfillment\/[0-9]+$/.test(
        externalShopifyFulfillmentRef,
      )
    ) invalidResponse();
    if (
      String(item.shopifyPublicationStatus) === "PUBLISHED" &&
      (!externalShopifyFulfillmentRef || !shopifyPublishedAt)
    ) invalidResponse();
    if (
      String(item.shopifyPublicationStatus) !== "NOT_PUBLISHED" &&
      shopifyNotifyCustomer === undefined
    ) invalidResponse();
    if (
      String(item.shopifyPublicationStatus) === "NOT_PUBLISHED" &&
      (shopifyNotifyCustomer !== undefined || shopifyTrackingUrl !== undefined)
    ) invalidResponse();
    return {
      id: item.id,
      warehouseId: item.warehouseId,
      packageNumber: item.packageNumber,
      status: item.status as FulfillmentPlan["packages"][number]["status"],
      weightGrams: optionalNonNegativeNumber(item.weightGrams),
      packagingTemplateId: optionalUuid(item.packagingTemplateId),
      packagingCode: optionalString(item.packagingCode),
      packagingName: optionalString(item.packagingName),
      packagingWeightGrams: optionalPositiveInteger(item.packagingWeightGrams),
      expectedWeightGrams: optionalPositiveInteger(item.expectedWeightGrams),
      allowedToleranceGrams: optionalSafeInteger(item.allowedToleranceGrams),
      weightDifferenceGrams: optionalSafeInteger(item.weightDifferenceGrams),
      weighingStatus:
        item.weighingStatus as FulfillmentPlan["packages"][number]["weighingStatus"],
      weighingSource: item.weighingSource === "SCALE" || item.weighingSource === "MANUAL"
        ? item.weighingSource as "SCALE" | "MANUAL"
        : undefined,
      shippingScaleId: optionalUuid(item.shippingScaleId),
      weighedAt: optionalInstant(item.weighedAt),
      version: item.version,
      sealedAt: optionalInstant(item.sealedAt),
      handedOverAt: optionalInstant(item.handedOverAt),
      carrierCode: optionalString(item.carrierCode),
      serviceCode: optionalString(item.serviceCode),
      trackingReference: optionalString(item.trackingReference),
      logisticsAuthorizationId: optionalUuid(item.logisticsAuthorizationId),
      logisticsChannelId: optionalUuid(item.logisticsChannelId),
      logisticsProviderCode: optionalString(item.logisticsProviderCode),
      logisticsProviderName: optionalString(item.logisticsProviderName),
      logisticsAccountLabel: optionalString(item.logisticsAccountLabel),
      logisticsChannelName: optionalString(item.logisticsChannelName),
      logisticsClientReference: optionalString(item.logisticsClientReference),
      logisticsProviderOrderReference:
        optionalString(item.logisticsProviderOrderReference),
      logisticsLabelUrl,
      logisticsBookingStatus:
        logisticsBookingStatus as FulfillmentPlan["packages"][number]["logisticsBookingStatus"],
      logisticsTrackingStatus: item.logisticsTrackingStatus as
        FulfillmentPlan["packages"][number]["logisticsTrackingStatus"],
      logisticsTrackingSummary: optionalString(item.logisticsTrackingSummary),
      logisticsLastSyncedAt: optionalInstant(item.logisticsLastSyncedAt),
      logisticsSafeErrorCode: optionalString(item.logisticsSafeErrorCode),
      logisticsProviderHandoverPending,
      shopifyPublicationStatus:
        item.shopifyPublicationStatus as FulfillmentPlan["packages"][number]["shopifyPublicationStatus"],
      shopifyNotifyCustomer,
      shopifyTrackingUrl,
      externalShopifyFulfillmentRef,
      shopifyPublishedAt,
      items: item.items.map((packageItem) => {
        if (
          !isRecord(packageItem) ||
          !isUuid(packageItem.fulfillmentLineId) ||
          !isPositiveInteger(packageItem.quantity)
        ) invalidResponse();
        return {
          fulfillmentLineId: packageItem.fulfillmentLineId,
          quantity: packageItem.quantity,
        };
      }),
    };
  });
  return {
    id: value.id,
    orderId: value.orderId,
    shopId: value.shopId,
    sourceOrderVersion: value.sourceOrderVersion,
    externalOrderRef: value.externalOrderRef,
    status: value.status,
    pauseState: value.pauseState as FulfillmentPlan["pauseState"],
    pauseReasonCode: optionalString(value.pauseReasonCode),
    shortageState: value.shortageState as FulfillmentPlan["shortageState"],
    plannedQuantity: value.plannedQuantity,
    pickedQuantity: value.pickedQuantity,
    packedQuantity: value.packedQuantity,
    shippedQuantity: value.shippedQuantity,
    cancelledQuantity: value.cancelledQuantity,
    version: value.version,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    completedAt: optionalInstant(value.completedAt),
    lines,
    packages,
  };
}

function mapShopifyFulfillmentPublicationResult(
  value: unknown,
): ShopifyFulfillmentPublicationResult {
  if (
    !isRecord(value) ||
    typeof value.externalFulfillmentRef !== "string" ||
    !/^gid:\/\/shopify\/Fulfillment\/[0-9]+$/.test(
      value.externalFulfillmentRef,
    ) ||
    typeof value.recoveredFromShopify !== "boolean" ||
    !isInstant(value.publishedAt) ||
    typeof value.replayed !== "boolean"
  ) invalidResponse();
  return {
    plan: mapFulfillmentPlan(value.plan),
    externalFulfillmentRef: value.externalFulfillmentRef,
    recoveredFromShopify: value.recoveredFromShopify,
    publishedAt: value.publishedAt,
    replayed: value.replayed,
  };
}

function mapDashboardSummary(value: unknown): DashboardSummary {
  if (
    !isRecord(value) ||
    !isNonNegativeInteger(value.totalOrders) ||
    !isNonNegativeInteger(value.unpaidOrders) ||
    !isNonNegativeInteger(value.receivedOrders) ||
    !isNonNegativeInteger(value.reviewPendingOrders) ||
    !isNonNegativeInteger(value.mergePendingOrders) ||
    !isNonNegativeInteger(value.holdOrders) ||
    !isNonNegativeInteger(value.readyToFulfillOrders) ||
    !isNonNegativeInteger(value.fulfillingOrders) ||
    !isNonNegativeInteger(value.shippedOrders) ||
    !isNonNegativeInteger(value.deliveredOrders) ||
    !isNonNegativeInteger(value.cancelledOrders) ||
    !isNonNegativeInteger(value.editableOrders) ||
    !isNonNegativeInteger(value.unmatchedLines)
  ) {
    invalidResponse();
  }

  const oldestUnmatchedPlacedAt = value.oldestUnmatchedPlacedAt;
  if (
    (oldestUnmatchedPlacedAt !== null && !isInstant(oldestUnmatchedPlacedAt)) ||
    (value.unmatchedLines === 0 && oldestUnmatchedPlacedAt !== null) ||
    (value.unmatchedLines > 0 && !isInstant(oldestUnmatchedPlacedAt)) ||
    value.totalOrders !==
      value.receivedOrders +
        value.unpaidOrders +
        value.reviewPendingOrders +
        value.mergePendingOrders +
        value.holdOrders +
        value.readyToFulfillOrders +
        value.fulfillingOrders +
        value.shippedOrders +
        value.deliveredOrders +
        value.cancelledOrders ||
    value.editableOrders !==
      value.unpaidOrders +
        value.receivedOrders +
        value.reviewPendingOrders +
        value.mergePendingOrders +
        value.holdOrders
  ) {
    invalidResponse();
  }

  return {
    totalOrders: value.totalOrders,
    unpaidOrders: value.unpaidOrders,
    receivedOrders: value.receivedOrders,
    reviewPendingOrders: value.reviewPendingOrders,
    mergePendingOrders: value.mergePendingOrders,
    holdOrders: value.holdOrders,
    readyToFulfillOrders: value.readyToFulfillOrders,
    fulfillingOrders: value.fulfillingOrders,
    shippedOrders: value.shippedOrders,
    deliveredOrders: value.deliveredOrders,
    cancelledOrders: value.cancelledOrders,
    editableOrders: value.editableOrders,
    unmatchedLines: value.unmatchedLines,
    oldestUnmatchedPlacedAt:
      oldestUnmatchedPlacedAt === null ? undefined : oldestUnmatchedPlacedAt,
  };
}

function mapSkuSalesSummary(value: unknown): SkuSalesSummary {
  if (!isRecord(value)) invalidResponse();
  const sales7 = value.sales7;
  const sales28 = value.sales28;
  const sales42 = value.sales42;
  if (
    !isUuid(value.skuId) ||
    !isNonNegativeInteger(sales7) ||
    !isNonNegativeInteger(sales28) ||
    !isNonNegativeInteger(sales42) ||
    sales7 > sales28 ||
    sales28 > sales42
  ) {
    invalidResponse();
  }
  return {
    skuId: value.skuId,
    sales7,
    sales28,
    sales42,
  };
}

function skuSalesSummariesPath(skuIds: string[]): string {
  const unique = [...new Set(skuIds)];
  if (
    unique.length < 1 ||
    unique.length > 50 ||
    unique.length !== skuIds.length ||
    unique.some((skuId) => !UUID_PATTERN.test(skuId))
  ) {
    invalidRequest();
  }
  const query = new URLSearchParams();
  for (const skuId of unique) query.append("skuId", skuId);
  return `${API_BASE}/sku-sales-summaries?${query.toString()}`;
}

export const orderCenterApi = {
  async listTransfers(page = 0, size = 20): Promise<Page<OrderTransferJob>> {
    return mapTransferPage(
      await apiClient.request<unknown>(
        `${API_BASE}/transfers?page=${page}&size=${size}`,
      ),
    );
  },
  async create(input: CreateOrderInput): Promise<OrderDetail> {
    return mapDetail(
      await apiClient.request<unknown>(`${API_BASE}/orders`, {
        method: "POST",
        body: input,
      }),
    );
  },
  async dashboardSummary(shopId?: string): Promise<DashboardSummary> {
    const params = new URLSearchParams();
    if (shopId) params.set("shopId", shopId);
    const query = params.size > 0 ? `?${params}` : "";
    return mapDashboardSummary(
      await apiClient.request<unknown>(`${API_BASE}/dashboard-summary${query}`),
    );
  },
  async listSkuSalesSummaries(
    skuIds: string[],
  ): Promise<SkuSalesSummary[]> {
    const expected = new Set(skuIds);
    const wire = await apiClient.request<unknown>(
      skuSalesSummariesPath(skuIds),
    );
    if (!isRecord(wire) || !Array.isArray(wire.items)) {
      invalidResponse();
    }
    const summaries = wire.items.map(mapSkuSalesSummary);
    const returned = new Set(
      summaries.map((summary) => summary.skuId),
    );
    if (
      returned.size !== summaries.length ||
      summaries.some((summary) => !expected.has(summary.skuId))
    ) {
      invalidResponse();
    }
    return summaries;
  },
  async listSkuMatchQueue(
    query: SkuMatchQueueQuery,
  ): Promise<Page<SkuMatchQueueItem>> {
    const params = new URLSearchParams({
      page: String(query.page),
      size: String(query.size),
    });
    if (query.shopId) params.set("shopId", query.shopId);
    if (query.keyword) params.set("keyword", query.keyword.slice(0, 100));
    return mapSkuMatchQueuePage(
      await apiClient.request<unknown>(`${API_BASE}/sku-match-queue?${params}`),
    );
  },
  async previewShopifyCatalog(
    input: ShopifyOrderCatalogPreviewRequest,
  ): Promise<ShopifyOrderCatalogPreview> {
    if (!isUuid(input.shopId)) invalidRequest();
    const limit = input.limit ?? 50;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      invalidRequest();
    }
    const params = new URLSearchParams({
      shopId: input.shopId,
      limit: String(limit),
    });
    if (input.cursor) params.set("cursor", input.cursor.slice(0, 4096));
    if (input.query) params.set("query", input.query.slice(0, 500));
    if (input.historical === true) params.set("historical", "true");
    return mapShopifyOrderCatalogPreview(
      await apiClient.request<unknown>(
        `${API_BASE}/shopify/catalog-preview?${params}`,
      ),
    );
  },
  async importShopifyCatalog(
    input: ShopifyOrderCatalogImportRequest,
  ): Promise<ShopifyOrderCatalogImportResult> {
    if (!isUuid(input.shopId)) invalidRequest();
    const limit = input.limit ?? 50;
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      input.externalOrderRefs.length < 1 ||
      input.externalOrderRefs.length > 50 ||
      input.externalOrderRefs.some((ref) => !ref || ref.length > 160)
    ) {
      invalidRequest();
    }
    return mapShopifyOrderCatalogImportResult(
      await apiClient.request<unknown>(
        `${API_BASE}/shopify/catalog-import`,
        {
          method: "POST",
          body: {
            shopId: input.shopId,
            limit,
            cursor: input.cursor?.slice(0, 4096),
            query: input.query?.slice(0, 500),
            ...(input.historical === true ? { historical: true } : {}),
            externalOrderRefs: input.externalOrderRefs,
          },
        },
      ),
    );
  },
  async list(query: OrderQuery): Promise<Page<Order>> {
    const params = new URLSearchParams({
      page: String(query.page),
      size: String(query.size),
    });

    if (query.shopId) {
      params.set("shopId", query.shopId);
    }
    if (query.platformId) params.set("platformId", query.platformId);
    if (query.status) {
      params.set("status", query.status);
    }
    if (query.stage && query.stage !== "ALL") params.set("stage", query.stage);
    if (query.keyword) {
      params.set("keyword", query.keyword);
    }
    if (query.skuKeyword) params.set("skuKeyword", query.skuKeyword);
    if (query.warehouseId) params.set("warehouseId", query.warehouseId);
    if (query.locationId) params.set("locationId", query.locationId);
    if (query.paymentStatus) params.set("paymentStatus", query.paymentStatus);
    if (query.platformStatus) params.set("platformStatus", query.platformStatus);
    if (query.countryCode) params.set("countryCode", query.countryCode);
    if (query.trackingStatus) params.set("trackingStatus", query.trackingStatus);
    if (query.logisticsChannel) {
      params.set("logisticsChannel", query.logisticsChannel);
    }
    if (query.currency) params.set("currency", query.currency);
    if (query.printed !== undefined) params.set("printed", String(query.printed));
    if (query.reshipment !== undefined) params.set("reshipment", String(query.reshipment));
    if (query.fixedCategory) params.set("fixedCategory", query.fixedCategory);
    if (query.customCategory) params.set("customCategory", query.customCategory);
    if (query.customerCategory) params.set("customerCategory", query.customerCategory);
    const uuidFilters = [
      ["pickerUserId", query.pickerUserId],
      ["shipperUserId", query.shipperUserId],
      ["salespersonUserId", query.salespersonUserId],
      ["purchaserUserId", query.purchaserUserId],
      ["developerUserId", query.developerUserId],
      ["managerUserId", query.managerUserId],
    ] as const;
    uuidFilters.forEach(([name, value]) => {
      if (value) params.set(name, value);
    });
    const textFilters = [
      ["supplierReference", query.supplierReference],
      ["parentProductCategory", query.parentProductCategory],
      ["childProductCategory", query.childProductCategory],
      ["productStatus", query.productStatus],
      ["extendedAttribute", query.extendedAttribute],
    ] as const;
    textFilters.forEach(([name, value]) => {
      if (value) params.set(name, value);
    });
    if (query.minProductKinds !== undefined) {
      params.set("minProductKinds", String(query.minProductKinds));
    }
    if (query.maxProductKinds !== undefined) {
      params.set("maxProductKinds", String(query.maxProductKinds));
    }
    if (query.minAmountMinor !== undefined) params.set("minAmountMinor", String(query.minAmountMinor));
    if (query.maxAmountMinor !== undefined) params.set("maxAmountMinor", String(query.maxAmountMinor));
    if (query.minWeightGrams !== undefined) params.set("minWeightGrams", String(query.minWeightGrams));
    if (query.maxWeightGrams !== undefined) params.set("maxWeightGrams", String(query.maxWeightGrams));
    if (query.placedFrom) params.set("placedFrom", query.placedFrom);
    if (query.placedTo) params.set("placedTo", query.placedTo);
    if (query.paidFrom) params.set("paidFrom", query.paidFrom);
    if (query.paidTo) params.set("paidTo", query.paidTo);
    const conditionFilters = [
      ["conditionField1", query.conditionField1],
      ["conditionOperator1", query.conditionOperator1],
      ["conditionValue1", query.conditionValue1],
      ["conditionField2", query.conditionField2],
      ["conditionOperator2", query.conditionOperator2],
      ["conditionValue2", query.conditionValue2],
      ["conditionLogic", query.conditionLogic],
      ["timeField1", query.timeField1],
      ["timeFrom1", query.timeFrom1],
      ["timeTo1", query.timeTo1],
      ["timeField2", query.timeField2],
      ["timeFrom2", query.timeFrom2],
      ["timeTo2", query.timeTo2],
      ["sortField", query.sortField],
      ["sortDirection", query.sortDirection],
    ] as const;
    conditionFilters.forEach(([name, value]) => {
      if (value) params.set(name, value);
    });

    const response = await apiClient.request<unknown>(
      `${API_BASE}/orders?${params}`,
    );

    return mapPage(response);
  },

  async get(id: string): Promise<OrderDetail> {
    return mapDetail(
      await apiClient.request<unknown>(
        `${API_BASE}/orders/${encodeURIComponent(id)}`,
      ),
    );
  },

  async changeStatus(
    id: string,
    input: { version: number; targetStatus: OrderStatus; reason?: string },
  ): Promise<OrderDetail> {
    return mapDetail(
      await apiClient.request<unknown>(
        `${API_BASE}/orders/${encodeURIComponent(id)}/status`,
        {
          method: "PUT",
          body: {
            version: input.version,
            targetStatus: input.targetStatus,
            reason: input.reason,
          },
        },
      ),
    );
  },

  async updateProfile(
    id: string,
    input: {
      version: number;
      profileVersion: number;
      warehouseId?: string;
      operational: OrderOperationalInput;
      profile: OrderProfileInput;
    },
  ): Promise<OrderDetail> {
    return mapDetail(
      await apiClient.request<unknown>(
        `${API_BASE}/orders/${encodeURIComponent(id)}/profile`,
        { method: "PUT", body: input },
      ),
    );
  },

  async updateShopifyShippingAddress(
    id: string,
    input: ShopifyShippingAddressUpdateInput,
  ): Promise<ShopifyShippingAddressUpdateResult> {
    validateShopifyShippingAddressUpdate(id, input);
    return mapShopifyShippingAddressUpdateResult(
      await apiClient.request<unknown>(
        `${API_BASE}/orders/${encodeURIComponent(id)}/shopify/shipping-address`,
        { method: "PUT", body: input },
      ),
    );
  },

  async updateShopifyLineQuantity(
    orderId: string,
    input: ShopifyLineQuantityUpdateInput,
  ): Promise<ShopifyLineQuantityUpdateResult> {
    validateShopifyLineQuantityUpdate(orderId, input);
    return mapShopifyLineQuantityUpdateResult(
      await apiClient.request<unknown>(
        `${API_BASE}/orders/${encodeURIComponent(orderId)}/shopify/line-quantity`,
        { method: "PUT", body: input },
      ),
    );
  },

  async addShopifyOrderVariant(
    orderId: string,
    input: ShopifyVariantAddInput,
  ): Promise<ShopifyVariantAddResult> {
    validateShopifyVariantAdd(orderId, input);
    return mapShopifyVariantAddResult(
      await apiClient.request<unknown>(
        `${API_BASE}/orders/${encodeURIComponent(orderId)}/shopify/variants`,
        { method: "POST", body: input },
      ),
    );
  },

  async addShopifyOrderCustomItem(
    orderId: string,
    input: ShopifyCustomItemAddInput,
  ): Promise<ShopifyCustomItemAddResult> {
    validateShopifyCustomItemAdd(orderId, input);
    return mapShopifyCustomItemAddResult(
      await apiClient.request<unknown>(
        `${API_BASE}/orders/${encodeURIComponent(orderId)}/shopify/custom-items`,
        { method: "POST", body: input },
      ),
    );
  },

  async addShopifyOrderLineDiscount(
    orderId: string,
    input: ShopifyLineDiscountInput,
  ): Promise<ShopifyLineDiscountResult> {
    validateShopifyLineDiscount(orderId, input);
    return mapShopifyLineDiscountResult(
      await apiClient.request<unknown>(
        `${API_BASE}/orders/${encodeURIComponent(orderId)}/shopify/line-discounts`,
        { method: "POST", body: input },
      ),
    );
  },

  async cancelShopifyOrder(
    orderId: string,
    input: ShopifyOrderCancellationInput,
  ): Promise<ShopifyOrderCancellationResult> {
    validateShopifyOrderCancellation(orderId, input);
    return mapShopifyOrderCancellationResult(
      await apiClient.request<unknown>(
        `${API_BASE}/orders/${encodeURIComponent(orderId)}/shopify/cancellation`,
        { method: "POST", body: input },
      ),
    );
  },

  async changeLineSkuMatch(
    orderId: string,
    lineId: string,
    input: { version: number; skuId: string | null },
  ): Promise<OrderDetail> {
    return mapDetail(
      await apiClient.request<unknown>(
        `${API_BASE}/orders/${encodeURIComponent(orderId)}/lines/${encodeURIComponent(lineId)}/sku-match`,
        {
          method: "PUT",
          body: { version: input.version, skuId: input.skuId },
        },
      ),
    );
  },

  async bulkStatus(input: {
    commandId: string;
    targetStatus: OrderStatus;
    reason?: string;
    orders: Array<{ orderId: string; version: number }>;
  }): Promise<OrderTransferResult> {
    return mapTransferResult(
      await apiClient.request<unknown>(`${API_BASE}/orders/bulk-status`, {
        method: "POST",
        body: input,
      }),
    );
  },

  async exportCsv(query: Omit<OrderQuery, "page" | "size">): Promise<OrderTransferResult> {
    return mapTransferResult(
      await apiClient.request<unknown>(`${API_BASE}/transfers/exports`, {
        method: "POST",
        body: query,
      }),
    );
  },

  async importCsv(file: File, idempotencyKey: string): Promise<OrderTransferResult> {
    const body = new FormData();
    body.set("file", file);
    body.set("idempotencyKey", idempotencyKey);
    return mapTransferResult(
      await apiClient.request<unknown>(`${API_BASE}/transfers/imports`, {
        method: "POST",
        body,
      }),
    );
  },

  async createFulfillmentPlan(
    orderId: string,
    idempotencyKey: string,
  ): Promise<FulfillmentPlan> {
    const value = await apiClient.request<unknown>(
      "/api/v1/fulfillment-center/plans",
      { method: "POST", body: { orderId, idempotencyKey } },
    );
    const plan = mapFulfillmentPlan(value);
    if (plan.orderId !== orderId) invalidResponse();
    return plan;
  },

  async getFulfillmentPlan(planId: string): Promise<FulfillmentPlan> {
    return mapFulfillmentPlan(
      await apiClient.request<unknown>(
        `/api/v1/fulfillment-center/plans/${encodeURIComponent(planId)}`,
      ),
    );
  },

  async getFulfillmentPlanByOrder(
    orderId: string,
  ): Promise<FulfillmentPlan> {
    const plan = mapFulfillmentPlan(
      await apiClient.request<unknown>(
        `/api/v1/fulfillment-center/orders/${encodeURIComponent(orderId)}/plan`,
      ),
    );
    if (plan.orderId !== orderId) invalidResponse();
    return plan;
  },

  async allocateFulfillment(
    planId: string,
    input: {
      version: number;
      commandId: string;
      assignments: Array<{
        orderLineId: string;
        quantity: number;
        warehouseId: string;
        locationId?: string;
      }>;
    },
  ): Promise<FulfillmentPlan> {
    return fulfillmentCommand(planId, "allocations", input);
  },

  async pickFulfillment(
    planId: string,
    input: {
      version: number;
      commandId: string;
      quantities: Array<{ lineId: string; quantity: number }>;
    },
  ): Promise<FulfillmentPlan> {
    return fulfillmentCommand(planId, "picks", input);
  },

  async createFulfillmentPackage(
    planId: string,
    input: {
      version: number;
      commandId: string;
      warehouseId: string;
      packageNumber: string;
      items: Array<{ fulfillmentLineId: string; quantity: number }>;
    },
  ): Promise<FulfillmentPlan> {
    return fulfillmentCommand(planId, "packages", input);
  },

  async sealFulfillmentPackage(
    planId: string,
    packageId: string,
    input: { version: number; packageVersion: number; commandId: string },
  ): Promise<FulfillmentPlan> {
    return fulfillmentPackageCommand(planId, packageId, "seal", input);
  },

  async handoverFulfillmentPackage(
    planId: string,
    packageId: string,
    input: {
      version: number;
      packageVersion: number;
      commandId: string;
      occurredAt: string;
      carrierCode: string;
      serviceCode?: string;
      trackingReference?: string;
    },
  ): Promise<FulfillmentPlan> {
    return fulfillmentPackageCommand(planId, packageId, "handover", input);
  },

  async bookLogisticsShipment(
    planId: string,
    packageId: string,
    input: {
      packageVersion: number;
      authorizationId: string;
      channelId: string;
      idempotencyKey: string;
    },
  ): Promise<FulfillmentPlan> {
    return fulfillmentPackageCommand(
      planId,
      packageId,
      "logistics-booking",
      input,
    );
  },

  async syncLogisticsShipment(
    planId: string,
    packageId: string,
  ): Promise<FulfillmentPlan> {
    return fulfillmentPackageCommand(
      planId,
      packageId,
      "logistics-sync",
      {},
    );
  },

  async handoverBookedLogisticsShipment(
    planId: string,
    packageId: string,
    input: {
      version: number;
      packageVersion: number;
      commandId: string;
      occurredAt: string;
    },
  ): Promise<FulfillmentPlan> {
    return fulfillmentPackageCommand(
      planId,
      packageId,
      "logistics-handover",
      input,
    );
  },

  async listShippingPackagingTemplates(
    warehouseId: string,
  ): Promise<ShippingPackagingTemplate[]> {
    if (!isUuid(warehouseId)) invalidRequest();
    const response = await apiClient.request<unknown>(
      `/api/v1/shipping-configuration/warehouses/${encodeURIComponent(warehouseId)}/packaging-templates`,
    );
    if (!isRecord(response)) invalidResponse();
    const value = response.items;
    if (!Array.isArray(value)) invalidResponse();
    return value.filter((item) => isRecord(item) && item.enabled === true)
      .map((item) => {
        const template = item.template;
        if (!isRecord(template) || !isUuid(template.id) ||
          typeof template.businessCode !== "string" ||
          typeof template.name !== "string" ||
          !["BOX", "MAILER", "BAG", "OTHER"].includes(String(template.packagingType)) ||
          !isPositiveInteger(template.standardWeightGrams) ||
          !["ACTIVE", "INACTIVE", "ARCHIVED"].includes(String(template.status))) {
          invalidResponse();
        }
        return template as ShippingPackagingTemplate;
      });
  },

  async listShippingScales(warehouseId: string): Promise<ShippingScale[]> {
    if (!isUuid(warehouseId)) invalidRequest();
    const response = await apiClient.request<unknown>(
      `/api/v1/shipping-configuration/warehouses/${encodeURIComponent(warehouseId)}/scales`,
    );
    if (!isRecord(response)) invalidResponse();
    const value = response.items;
    if (!Array.isArray(value)) invalidResponse();
    return value.map((item) => {
      if (!isRecord(item) || !isUuid(item.id) || item.warehouseId !== warehouseId ||
        typeof item.deviceNumber !== "string" || typeof item.displayName !== "string" ||
        !["ACTIVE", "INACTIVE"].includes(String(item.status))) invalidResponse();
      return item as ShippingScale;
    });
  },

  async assignFulfillmentPackaging(
    planId: string,
    packageId: string,
    input: { packageVersion: number; packagingTemplateId: string },
  ): Promise<FulfillmentPlan> {
    await apiClient.request<unknown>(
      `/api/v1/fulfillment-center/plans/${encodeURIComponent(planId)}` +
        `/packages/${encodeURIComponent(packageId)}/packaging`,
      { method: "PUT", body: input },
    );
    return this.getFulfillmentPlan(planId);
  },

  async weighFulfillmentPackage(
    planId: string,
    packageId: string,
    input: {
      packageVersion: number;
      commandId: string;
      scaleId: string;
      actualWeightGrams: number;
      occurredAt: string;
    },
  ): Promise<FulfillmentPlan> {
    await apiClient.request<unknown>(
      `/api/v1/fulfillment-center/plans/${encodeURIComponent(planId)}` +
        `/packages/${encodeURIComponent(packageId)}/weighings`,
      { method: "POST", body: input },
    );
    return this.getFulfillmentPlan(planId);
  },

  async overrideFulfillmentWeighing(
    planId: string,
    packageId: string,
    input: {
      packageVersion: number;
      commandId: string;
      actualWeightGrams: number;
      occurredAt: string;
      reason: string;
    },
  ): Promise<FulfillmentPlan> {
    await apiClient.request<unknown>(
      `/api/v1/fulfillment-center/plans/${encodeURIComponent(planId)}` +
        `/packages/${encodeURIComponent(packageId)}/weighing-overrides`,
      { method: "POST", body: input },
    );
    return this.getFulfillmentPlan(planId);
  },

  async publishShopifyFulfillment(
    planId: string,
    packageId: string,
    input: {
      idempotencyKey: string;
      notifyCustomer: boolean;
      trackingUrl?: string;
    },
  ): Promise<ShopifyFulfillmentPublicationResult> {
    if (
      !isUuid(planId) ||
      !isUuid(packageId) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(input.idempotencyKey) ||
      typeof input.notifyCustomer !== "boolean" ||
      (input.trackingUrl !== undefined &&
        !isSafeHttpUrl(input.trackingUrl, 2048))
    ) invalidRequest();
    return mapShopifyFulfillmentPublicationResult(
      await apiClient.request<unknown>(
        `/api/v1/fulfillment-center/plans/${encodeURIComponent(planId)}` +
          `/packages/${encodeURIComponent(packageId)}/shopify-publication`,
        { method: "POST", body: input },
      ),
    );
  },

  async correctFulfillmentHandover(
    planId: string,
    packageId: string,
    input: {
      version: number;
      packageVersion: number;
      commandId: string;
      occurredAt: string;
      reasonCode: string;
    },
  ): Promise<FulfillmentPlan> {
    return fulfillmentPackageCommand(
      planId,
      packageId,
      "handover-corrections",
      input,
    );
  },

  async pauseFulfillment(
    planId: string,
    input: { version: number; commandId: string; reasonCode: string },
  ): Promise<FulfillmentPlan> {
    return fulfillmentCommand(planId, "pause", input);
  },

  async resumeFulfillment(
    planId: string,
    input: { version: number; commandId: string },
  ): Promise<FulfillmentPlan> {
    return fulfillmentCommand(planId, "resume", input);
  },

  async cancelFulfillment(
    planId: string,
    input: { version: number; commandId: string; reasonCode: string },
  ): Promise<FulfillmentPlan> {
    return fulfillmentCommand(planId, "cancel", input);
  },
};

async function fulfillmentCommand(
  planId: string,
  action: string,
  body: unknown,
): Promise<FulfillmentPlan> {
  return mapFulfillmentPlan(
    await apiClient.request<unknown>(
      `/api/v1/fulfillment-center/plans/${encodeURIComponent(planId)}/${action}`,
      { method: "POST", body },
    ),
  );
}

async function fulfillmentPackageCommand(
  planId: string,
  packageId: string,
  action: string,
  body: unknown,
): Promise<FulfillmentPlan> {
  return mapFulfillmentPlan(
    await apiClient.request<unknown>(
      `/api/v1/fulfillment-center/plans/${encodeURIComponent(planId)}/packages/${encodeURIComponent(packageId)}/${action}`,
      { method: "POST", body },
    ),
  );
}
