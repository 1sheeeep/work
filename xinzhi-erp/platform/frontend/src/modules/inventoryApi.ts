import { apiClient } from "../api/client";

const API_BASE = "/api/v1/inventory-center";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type Page<T> = {
  items: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
};

export type InventoryBalance = {
  id: string;
  skuId: string;
  skuBusinessCode: string;
  skuName: string;
  warehouseId: string;
  warehouseBusinessCode: string;
  warehouseName: string;
  onHand: number;
  reserved: number;
  available: number;
  version: number;
  updatedAt: string;
};

export type ShopifyInventoryPreview = {
  shopId: string;
  balanceId: string;
  balanceVersion: number;
  skuId: string;
  skuCode: string;
  skuName: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  externalVariantRef: string;
  externalInventoryItemRef: string;
  externalLocationRef: string;
  erpOnHand: number;
  erpReserved: number;
  erpAvailable: number;
  shopifyAvailable: number;
  shopifyOnHand?: number;
  availableDifference: number;
  fetchedAt: string;
};

export type ShopifyInventoryPublicationStatus =
  | "QUEUED"
  | "PROCESSING"
  | "APPLIED"
  | "STALE"
  | "REJECTED"
  | "UNCERTAIN";

export type ShopifyInventoryPublication = {
  id: string;
  shopId: string;
  balanceId: string;
  expectedBalanceVersion: number;
  expectedShopifyAvailable: number;
  targetAvailable: number;
  status: ShopifyInventoryPublicationStatus;
  attemptCount: number;
  safeErrorCode?: string;
  replayed: boolean;
};

export type ShopifyInventoryPublicationException = {
  id: string;
  shopId: string;
  shopName: string;
  externalShopRef: string;
  balanceId: string;
  skuId: string;
  skuCode: string;
  skuName: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  expectedShopifyAvailable: number;
  targetAvailable: number;
  status: "STALE" | "REJECTED" | "UNCERTAIN";
  attemptCount: number;
  safeErrorCode?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type ShopifyInventoryExceptionListRequest = {
  shopId?: string;
  start?: string;
  end?: string;
  keyword?: string;
  limit?: number;
};

export type EnqueueShopifyInventoryPublicationInput = {
  shopId: string;
  balanceId: string;
  expectedBalanceVersion: number;
  expectedShopifyAvailable: number;
};

export type InventoryBalanceListRequest = {
  warehouseId?: string;
  skuId?: string;
  categoryId?: string;
  searchField?: InventoryBalanceSearchField;
  keyword?: string;
  onHandMin?: number;
  onHandMax?: number;
  updatedFrom?: string;
  updatedTo?: string;
  page: number;
  size: number;
};

export type InventoryBalanceSearchField =
  | "ALL"
  | "MASTER_SKU"
  | "NAME_ZH"
  | "NAME_EN"
  | "INVENTORY_SKU";

const inventoryBalanceSearchFields: ReadonlySet<string> = new Set([
  "ALL",
  "MASTER_SKU",
  "NAME_ZH",
  "NAME_EN",
  "INVENTORY_SKU",
]);

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isoDate(value: string) {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || year > 9999) return false;
  const candidate = new Date(`${value}T00:00:00Z`);
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

export type InventorySkuSummary = {
  skuId: string;
  onHand: number;
  reserved: number;
  available: number;
};

type UnknownRecord = Record<string, unknown>;

function invalid(field: string): never {
  throw new Error(`Invalid inventory response: ${field}`);
}

function invalidRequest(field: string): never {
  throw new Error(`Invalid inventory request: ${field}`);
}

function record(value: unknown, field: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid(field);
  }
  return value as UnknownRecord;
}

function string(value: unknown, field: string) {
  return typeof value === "string" && value.length > 0
    ? value
    : invalid(field);
}

function uuid(value: unknown, field: string) {
  const parsed = string(value, field);
  return UUID_PATTERN.test(parsed) ? parsed : invalid(field);
}

function integer(value: unknown, field: string) {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : invalid(field);
}

function nonNegativeInteger(value: unknown, field: string) {
  const parsed = integer(value, field);
  return parsed >= 0 ? parsed : invalid(field);
}

function positiveInteger(value: unknown, field: string) {
  const parsed = nonNegativeInteger(value, field);
  return parsed > 0 ? parsed : invalid(field);
}

function timestamp(value: unknown, field: string) {
  const parsed = string(value, field);
  return Number.isNaN(Date.parse(parsed)) ? invalid(field) : parsed;
}

function optionalUuid(value: unknown, field: string) {
  return value === null || value === undefined
    ? undefined
    : uuid(value, field);
}

function optionalString(value: unknown, field: string) {
  return value === null || value === undefined
    ? undefined
    : string(value, field);
}

function mapBalance(value: unknown): InventoryBalance {
  const wire = record(value, "balance");
  const onHand = integer(wire.onHand, "balance.onHand");
  const reserved = integer(wire.reserved, "balance.reserved");
  const available = integer(wire.available, "balance.available");
  if (
    !Number.isSafeInteger(onHand - reserved) ||
    available !== onHand - reserved
  ) {
    return invalid("balance.available");
  }
  return {
    id: uuid(wire.id, "balance.id"),
    skuId: uuid(wire.skuId, "balance.skuId"),
    skuBusinessCode: string(
      wire.skuBusinessCode,
      "balance.skuBusinessCode",
    ),
    skuName: string(wire.skuName, "balance.skuName"),
    warehouseId: uuid(wire.warehouseId, "balance.warehouseId"),
    warehouseBusinessCode: string(
      wire.warehouseBusinessCode,
      "balance.warehouseBusinessCode",
    ),
    warehouseName: string(wire.warehouseName, "balance.warehouseName"),
    onHand,
    reserved,
    available,
    version: nonNegativeInteger(wire.version, "balance.version"),
    updatedAt: timestamp(wire.updatedAt, "balance.updatedAt"),
  };
}

function mapShopifyInventoryPreview(value: unknown): ShopifyInventoryPreview {
  const wire = record(value, "shopifyInventoryPreview");
  const erpOnHand = integer(
    wire.erpOnHand,
    "shopifyInventoryPreview.erpOnHand",
  );
  const erpReserved = integer(
    wire.erpReserved,
    "shopifyInventoryPreview.erpReserved",
  );
  const erpAvailable = integer(
    wire.erpAvailable,
    "shopifyInventoryPreview.erpAvailable",
  );
  const shopifyAvailable = integer(
    wire.shopifyAvailable,
    "shopifyInventoryPreview.shopifyAvailable",
  );
  const availableDifference = integer(
    wire.availableDifference,
    "shopifyInventoryPreview.availableDifference",
  );
  if (
    !Number.isSafeInteger(erpOnHand - erpReserved) ||
    erpAvailable !== erpOnHand - erpReserved ||
    !Number.isSafeInteger(erpAvailable - shopifyAvailable) ||
    availableDifference !== erpAvailable - shopifyAvailable
  ) {
    return invalid("shopifyInventoryPreview.quantities");
  }
  return {
    shopId: uuid(wire.shopId, "shopifyInventoryPreview.shopId"),
    balanceId: uuid(wire.balanceId, "shopifyInventoryPreview.balanceId"),
    balanceVersion: nonNegativeInteger(
      wire.balanceVersion,
      "shopifyInventoryPreview.balanceVersion",
    ),
    skuId: uuid(wire.skuId, "shopifyInventoryPreview.skuId"),
    skuCode: string(wire.skuCode, "shopifyInventoryPreview.skuCode"),
    skuName: string(wire.skuName, "shopifyInventoryPreview.skuName"),
    warehouseId: uuid(
      wire.warehouseId,
      "shopifyInventoryPreview.warehouseId",
    ),
    warehouseCode: string(
      wire.warehouseCode,
      "shopifyInventoryPreview.warehouseCode",
    ),
    warehouseName: string(
      wire.warehouseName,
      "shopifyInventoryPreview.warehouseName",
    ),
    externalVariantRef: string(
      wire.externalVariantRef,
      "shopifyInventoryPreview.externalVariantRef",
    ),
    externalInventoryItemRef: string(
      wire.externalInventoryItemRef,
      "shopifyInventoryPreview.externalInventoryItemRef",
    ),
    externalLocationRef: string(
      wire.externalLocationRef,
      "shopifyInventoryPreview.externalLocationRef",
    ),
    erpOnHand,
    erpReserved,
    erpAvailable,
    shopifyAvailable,
    shopifyOnHand:
      wire.shopifyOnHand === null || wire.shopifyOnHand === undefined
        ? undefined
        : integer(
            wire.shopifyOnHand,
            "shopifyInventoryPreview.shopifyOnHand",
          ),
    availableDifference,
    fetchedAt: timestamp(wire.fetchedAt, "shopifyInventoryPreview.fetchedAt"),
  };
}

function mapShopifyInventoryPublication(
  value: unknown,
): ShopifyInventoryPublication {
  const wire = record(value, "shopifyInventoryPublication");
  const status = wire.status;
  if (
    status !== "QUEUED" &&
    status !== "PROCESSING" &&
    status !== "APPLIED" &&
    status !== "STALE" &&
    status !== "REJECTED" &&
    status !== "UNCERTAIN"
  ) {
    return invalid("shopifyInventoryPublication.status");
  }
  if (typeof wire.replayed !== "boolean") {
    return invalid("shopifyInventoryPublication.replayed");
  }
  return {
    id: uuid(wire.id, "shopifyInventoryPublication.id"),
    shopId: uuid(wire.shopId, "shopifyInventoryPublication.shopId"),
    balanceId: uuid(
      wire.balanceId,
      "shopifyInventoryPublication.balanceId",
    ),
    expectedBalanceVersion: nonNegativeInteger(
      wire.expectedBalanceVersion,
      "shopifyInventoryPublication.expectedBalanceVersion",
    ),
    expectedShopifyAvailable: integer(
      wire.expectedShopifyAvailable,
      "shopifyInventoryPublication.expectedShopifyAvailable",
    ),
    targetAvailable: integer(
      wire.targetAvailable,
      "shopifyInventoryPublication.targetAvailable",
    ),
    status,
    attemptCount: nonNegativeInteger(
      wire.attemptCount,
      "shopifyInventoryPublication.attemptCount",
    ),
    safeErrorCode: optionalString(
      wire.safeErrorCode,
      "shopifyInventoryPublication.safeErrorCode",
    ),
    replayed: wire.replayed,
  };
}

function mapShopifyInventoryPublicationException(
  value: unknown,
): ShopifyInventoryPublicationException {
  const wire = record(value, "shopifyInventoryPublicationException");
  const status = wire.status;
  if (status !== "STALE" && status !== "REJECTED" && status !== "UNCERTAIN") {
    return invalid("shopifyInventoryPublicationException.status");
  }
  return {
    id: uuid(wire.id, "shopifyInventoryPublicationException.id"),
    shopId: uuid(wire.shopId, "shopifyInventoryPublicationException.shopId"),
    shopName: string(wire.shopName, "shopifyInventoryPublicationException.shopName"),
    externalShopRef: string(
      wire.externalShopRef,
      "shopifyInventoryPublicationException.externalShopRef",
    ),
    balanceId: uuid(
      wire.balanceId,
      "shopifyInventoryPublicationException.balanceId",
    ),
    skuId: uuid(wire.skuId, "shopifyInventoryPublicationException.skuId"),
    skuCode: string(wire.skuCode, "shopifyInventoryPublicationException.skuCode"),
    skuName: string(wire.skuName, "shopifyInventoryPublicationException.skuName"),
    warehouseId: uuid(
      wire.warehouseId,
      "shopifyInventoryPublicationException.warehouseId",
    ),
    warehouseCode: string(
      wire.warehouseCode,
      "shopifyInventoryPublicationException.warehouseCode",
    ),
    warehouseName: string(
      wire.warehouseName,
      "shopifyInventoryPublicationException.warehouseName",
    ),
    expectedShopifyAvailable: integer(
      wire.expectedShopifyAvailable,
      "shopifyInventoryPublicationException.expectedShopifyAvailable",
    ),
    targetAvailable: integer(
      wire.targetAvailable,
      "shopifyInventoryPublicationException.targetAvailable",
    ),
    status,
    attemptCount: nonNegativeInteger(
      wire.attemptCount,
      "shopifyInventoryPublicationException.attemptCount",
    ),
    safeErrorCode: optionalString(
      wire.safeErrorCode,
      "shopifyInventoryPublicationException.safeErrorCode",
    ),
    createdAt: timestamp(
      wire.createdAt,
      "shopifyInventoryPublicationException.createdAt",
    ),
    updatedAt: timestamp(
      wire.updatedAt,
      "shopifyInventoryPublicationException.updatedAt",
    ),
    completedAt: wire.completedAt === null || wire.completedAt === undefined
      ? undefined
      : timestamp(
          wire.completedAt,
          "shopifyInventoryPublicationException.completedAt",
        ),
  };
}

function inventoryPublicationExceptionsPath(
  request: ShopifyInventoryExceptionListRequest,
) {
  const query = new URLSearchParams();
  if (request.shopId) {
    if (!UUID_PATTERN.test(request.shopId)) return invalidRequest("shopId");
    query.set("shopId", request.shopId);
  }
  if (request.start) {
    if (!isoDate(request.start)) return invalidRequest("start");
    query.set("start", request.start);
  }
  if (request.end) {
    if (!isoDate(request.end)) return invalidRequest("end");
    query.set("end", request.end);
  }
  if (request.start && request.end && request.start > request.end) {
    return invalidRequest("dateRange");
  }
  const keyword = request.keyword?.trim() ?? "";
  if (keyword.length > 100) return invalidRequest("keyword");
  if (keyword) query.set("keyword", keyword);
  const limit = request.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
    return invalidRequest("limit");
  }
  query.set("limit", String(limit));
  return `${API_BASE}/shopify/publications/exceptions?${query.toString()}`;
}

function mapSkuSummary(value: unknown): InventorySkuSummary {
  const wire = record(value, "skuSummary");
  const onHand = integer(wire.onHand, "skuSummary.onHand");
  const reserved = integer(wire.reserved, "skuSummary.reserved");
  const available = integer(wire.available, "skuSummary.available");
  if (
    !Number.isSafeInteger(onHand - reserved) ||
    available !== onHand - reserved
  ) {
    return invalid("skuSummary.available");
  }
  return {
    skuId: uuid(wire.skuId, "skuSummary.skuId"),
    onHand,
    reserved,
    available,
  };
}

function mapPage<T>(value: unknown, mapItem: (item: unknown) => T): Page<T> {
  const wire = record(value, "page");
  if (!Array.isArray(wire.items)) return invalid("page.items");
  return {
    items: wire.items.map((item) => mapItem(item)),
    page: nonNegativeInteger(wire.page, "page.page"),
    size: positiveInteger(wire.size, "page.size"),
    totalElements: nonNegativeInteger(
      wire.totalElements,
      "page.totalElements",
    ),
    totalPages: nonNegativeInteger(wire.totalPages, "page.totalPages"),
  };
}

function balancesPath(request: InventoryBalanceListRequest) {
  if (
    request.warehouseId &&
    !UUID_PATTERN.test(request.warehouseId)
  ) {
    return invalidRequest("warehouseId");
  }
  if (request.skuId && !UUID_PATTERN.test(request.skuId)) {
    return invalidRequest("skuId");
  }
  if (request.categoryId && !UUID_PATTERN.test(request.categoryId)) {
    return invalidRequest("categoryId");
  }
  if (
    request.searchField &&
    !inventoryBalanceSearchFields.has(request.searchField)
  ) {
    return invalidRequest("searchField");
  }
  for (const [field, value] of [
    ["onHandMin", request.onHandMin],
    ["onHandMax", request.onHandMax],
  ] as const) {
    if (value !== undefined && !Number.isSafeInteger(value)) {
      return invalidRequest(field);
    }
  }
  if (
    request.onHandMin !== undefined &&
    request.onHandMax !== undefined &&
    request.onHandMin > request.onHandMax
  ) {
    return invalidRequest("onHandRange");
  }
  for (const [field, value] of [
    ["updatedFrom", request.updatedFrom],
    ["updatedTo", request.updatedTo],
  ] as const) {
    if (value !== undefined && !isoDate(value)) {
      return invalidRequest(field);
    }
  }
  if (
    request.updatedFrom !== undefined &&
    request.updatedTo !== undefined &&
    request.updatedFrom > request.updatedTo
  ) {
    return invalidRequest("updatedRange");
  }
  if (
    !Number.isSafeInteger(request.page) ||
    request.page < 0 ||
    !Number.isSafeInteger(request.size) ||
    request.size < 1 ||
    request.size > 200
  ) {
    return invalidRequest("page");
  }
  const query = new URLSearchParams({
    page: String(request.page),
    size: String(request.size),
  });
  if (request.warehouseId) {
    query.set("warehouseId", request.warehouseId);
  }
  if (request.skuId) query.set("skuId", request.skuId);
  if (request.categoryId) query.set("categoryId", request.categoryId);
  if (request.searchField) query.set("searchField", request.searchField);
  const keyword = request.keyword?.trim().slice(0, 100);
  if (keyword) query.set("keyword", keyword);
  if (request.onHandMin !== undefined) {
    query.set("onHandMin", String(request.onHandMin));
  }
  if (request.onHandMax !== undefined) {
    query.set("onHandMax", String(request.onHandMax));
  }
  if (request.updatedFrom) query.set("updatedFrom", request.updatedFrom);
  if (request.updatedTo) query.set("updatedTo", request.updatedTo);
  return `${API_BASE}/balances?${query.toString()}`;
}

function skuSummariesPath(skuIds: string[]) {
  const unique = [...new Set(skuIds)];
  if (unique.length < 1 || unique.length > 50 || unique.length !== skuIds.length) {
    return invalidRequest("skuIds");
  }
  const query = new URLSearchParams();
  for (const skuId of unique) {
    if (!UUID_PATTERN.test(skuId)) return invalidRequest("skuIds");
    query.append("skuId", skuId);
  }
  return `${API_BASE}/balance-summaries?${query.toString()}`;
}

export const inventoryApi = {
  async listBalances(
    request: InventoryBalanceListRequest,
  ): Promise<Page<InventoryBalance>> {
    return mapPage(
      await apiClient.request<unknown>(balancesPath(request)),
      mapBalance,
    );
  },

  async listSkuSummaries(
    skuIds: string[],
  ): Promise<InventorySkuSummary[]> {
    const expected = new Set(skuIds);
    const wire = await apiClient.request<unknown>(
      skuSummariesPath(skuIds),
    );
    const response = record(wire, "skuSummaries");
    if (!Array.isArray(response.items)) return invalid("skuSummaries.items");
    const summaries = response.items.map(mapSkuSummary);
    const returned = new Set(summaries.map((summary) => summary.skuId));
    if (
      returned.size !== summaries.length ||
      summaries.some((summary) => !expected.has(summary.skuId))
    ) {
      return invalid("skuSummaries.identity");
    }
    return summaries;
  },

  async previewShopifyInventory(
    shopId: string,
    balanceId: string,
  ): Promise<ShopifyInventoryPreview> {
    if (!UUID_PATTERN.test(shopId)) return invalidRequest("shopId");
    if (!UUID_PATTERN.test(balanceId)) return invalidRequest("balanceId");
    const query = new URLSearchParams({ shopId, balanceId });
    const preview = mapShopifyInventoryPreview(
      await apiClient.request<unknown>(
        `${API_BASE}/shopify/preview?${query.toString()}`,
      ),
    );
    if (preview.shopId !== shopId || preview.balanceId !== balanceId) {
      return invalid("shopifyInventoryPreview.identity");
    }
    return preview;
  },

  async enqueueShopifyInventoryPublication(
    input: EnqueueShopifyInventoryPublicationInput,
    idempotencyKey: string,
    requestId: string,
  ): Promise<ShopifyInventoryPublication> {
    if (!UUID_PATTERN.test(input.shopId)) return invalidRequest("shopId");
    if (!UUID_PATTERN.test(input.balanceId)) return invalidRequest("balanceId");
    if (
      !Number.isSafeInteger(input.expectedBalanceVersion) ||
      input.expectedBalanceVersion < 0
    ) {
      return invalidRequest("expectedBalanceVersion");
    }
    if (
      !Number.isSafeInteger(input.expectedShopifyAvailable) ||
      input.expectedShopifyAvailable < -1_000_000_000 ||
      input.expectedShopifyAvailable > 1_000_000_000
    ) {
      return invalidRequest("expectedShopifyAvailable");
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(idempotencyKey)) {
      return invalidRequest("idempotencyKey");
    }
    if (!/^[A-Za-z0-9._:-]{1,100}$/.test(requestId)) {
      return invalidRequest("requestId");
    }
    const publication = mapShopifyInventoryPublication(
      await apiClient.request<unknown>(`${API_BASE}/shopify/publications`, {
        method: "POST",
        headers: {
          "Idempotency-Key": idempotencyKey,
          "X-Request-Id": requestId,
        },
        body: input,
      }),
    );
    if (
      publication.shopId !== input.shopId ||
      publication.balanceId !== input.balanceId ||
      publication.expectedBalanceVersion !== input.expectedBalanceVersion ||
      publication.expectedShopifyAvailable !== input.expectedShopifyAvailable
    ) {
      return invalid("shopifyInventoryPublication.identity");
    }
    return publication;
  },

  async getShopifyInventoryPublication(
    publicationId: string,
  ): Promise<ShopifyInventoryPublication> {
    if (!UUID_PATTERN.test(publicationId)) {
      return invalidRequest("publicationId");
    }
    const publication = mapShopifyInventoryPublication(
      await apiClient.request<unknown>(
        `${API_BASE}/shopify/publications/${publicationId}`,
      ),
    );
    if (publication.id !== publicationId) {
      return invalid("shopifyInventoryPublication.identity");
    }
    return publication;
  },

  async getLatestShopifyInventoryPublication(
    shopId: string,
    balanceId: string,
  ): Promise<ShopifyInventoryPublication> {
    if (!UUID_PATTERN.test(shopId)) return invalidRequest("shopId");
    if (!UUID_PATTERN.test(balanceId)) return invalidRequest("balanceId");
    const query = new URLSearchParams({ shopId, balanceId });
    const publication = mapShopifyInventoryPublication(
      await apiClient.request<unknown>(
        `${API_BASE}/shopify/publications/latest?${query.toString()}`,
      ),
    );
    if (
      publication.shopId !== shopId ||
      publication.balanceId !== balanceId
    ) {
      return invalid("shopifyInventoryPublication.identity");
    }
    return publication;
  },

  async listShopifyInventoryPublicationExceptions(
    request: ShopifyInventoryExceptionListRequest,
  ): Promise<ShopifyInventoryPublicationException[]> {
    const wire = record(
      await apiClient.request<unknown>(
        inventoryPublicationExceptionsPath(request),
      ),
      "shopifyInventoryPublicationExceptions",
    );
    if (!Array.isArray(wire.items)) {
      return invalid("shopifyInventoryPublicationExceptions.items");
    }
    const items = wire.items.map(mapShopifyInventoryPublicationException);
    if (new Set(items.map((item) => item.id)).size !== items.length) {
      return invalid("shopifyInventoryPublicationExceptions.identity");
    }
    return items;
  },
};
