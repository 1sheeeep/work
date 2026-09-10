import { apiClient } from "../api/client";

const API_BASE = "/api/v1/analytics/dashboard-product-sales";
const WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ProductSalesBoardItem = {
  skuId: string;
  skuCode: string;
  skuName: string;
  variantSummary?: string;
  orderCount: number;
  salesQuantity: number;
  lastPlacedAt?: string;
};

export type ProductSalesBoard = {
  hotItems: ProductSalesBoardItem[];
  lowItems: ProductSalesBoardItem[];
  activeSkuCount: number;
  soldSkuCount: number;
  salesQuantity: number;
  rangeFrom: string;
  observedAt: string;
};

type Request = {
  observedAt: string;
  limit?: number;
  signal?: AbortSignal;
};

type UnknownRecord = Record<string, unknown>;

function invalid(field: string): never {
  throw new Error(`Invalid product sales board response: ${field}`);
}

function record(value: unknown, field: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid(field);
  return value as UnknownRecord;
}

function exact(value: UnknownRecord, keys: readonly string[], field: string) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    invalid(`${field}.shape`);
  }
}

function string(value: unknown, field: string) {
  return typeof value === "string" && value.length > 0 ? value : invalid(field);
}

function optionalString(value: unknown, field: string) {
  return value == null ? undefined : string(value, field);
}

function nonNegative(value: unknown, field: string) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : invalid(field);
}

function timestamp(value: unknown, field: string) {
  const result = string(value, field);
  return Number.isNaN(Date.parse(result)) ? invalid(field) : result;
}

function item(value: unknown, field: string): ProductSalesBoardItem {
  const wire = record(value, field);
  exact(wire, [
    "skuId", "skuCode", "skuName", "variantSummary", "orderCount",
    "salesQuantity", "lastPlacedAt",
  ], field);
  const skuId = string(wire.skuId, `${field}.skuId`);
  if (!UUID_PATTERN.test(skuId)) invalid(`${field}.skuId`);
  return {
    skuId,
    skuCode: string(wire.skuCode, `${field}.skuCode`),
    skuName: string(wire.skuName, `${field}.skuName`),
    variantSummary: optionalString(wire.variantSummary, `${field}.variantSummary`),
    orderCount: nonNegative(wire.orderCount, `${field}.orderCount`),
    salesQuantity: nonNegative(wire.salesQuantity, `${field}.salesQuantity`),
    lastPlacedAt: wire.lastPlacedAt == null
      ? undefined
      : timestamp(wire.lastPlacedAt, `${field}.lastPlacedAt`),
  };
}

export function parseProductSalesBoard(value: unknown, limit: number): ProductSalesBoard {
  const wire = record(value, "board");
  exact(wire, [
    "hotItems", "lowItems", "activeSkuCount", "soldSkuCount",
    "salesQuantity", "rangeFrom", "observedAt",
  ], "board");
  if (!Array.isArray(wire.hotItems) || !Array.isArray(wire.lowItems)) invalid("board.items");
  const result = {
    hotItems: wire.hotItems.map((entry, index) => item(entry, `board.hotItems[${index}]`)),
    lowItems: wire.lowItems.map((entry, index) => item(entry, `board.lowItems[${index}]`)),
    activeSkuCount: nonNegative(wire.activeSkuCount, "board.activeSkuCount"),
    soldSkuCount: nonNegative(wire.soldSkuCount, "board.soldSkuCount"),
    salesQuantity: nonNegative(wire.salesQuantity, "board.salesQuantity"),
    rangeFrom: timestamp(wire.rangeFrom, "board.rangeFrom"),
    observedAt: timestamp(wire.observedAt, "board.observedAt"),
  };
  const unique = (items: ProductSalesBoardItem[]) =>
    new Set(items.map((entry) => entry.skuId)).size === items.length;
  const coherentItem = (entry: ProductSalesBoardItem) => entry.salesQuantity > 0
    ? entry.orderCount > 0 && entry.lastPlacedAt !== undefined
    : entry.orderCount === 0 && entry.lastPlacedAt === undefined;
  if (result.hotItems.length > limit || result.lowItems.length > limit
      || !unique(result.hotItems) || !unique(result.lowItems)
      || !result.hotItems.every(coherentItem) || !result.lowItems.every(coherentItem)
      || result.soldSkuCount > result.activeSkuCount
      || result.hotItems.length !== Math.min(result.soldSkuCount, limit)
      || result.lowItems.length !== Math.min(result.activeSkuCount, limit)
      || (result.soldSkuCount === 0) !== (result.salesQuantity === 0)
      || Date.parse(result.observedAt) - Date.parse(result.rangeFrom) !== WINDOW_MS) {
    invalid("board.cardinality");
  }
  return result;
}

export const productSalesBoardApi = {
  async summarize(request: Request): Promise<ProductSalesBoard> {
    const limit = request.limit ?? 5;
    if (Number.isNaN(Date.parse(request.observedAt))
        || !Number.isSafeInteger(limit) || limit < 1 || limit > 10) {
      throw new Error("Invalid product sales board request");
    }
    const query = new URLSearchParams({ observedAt: request.observedAt, limit: String(limit) });
    const result = parseProductSalesBoard(
      await apiClient.request<unknown>(`${API_BASE}?${query}`, { signal: request.signal }),
      limit,
    );
    if (result.observedAt !== request.observedAt) invalid("board.requestIdentity");
    return result;
  },
};
