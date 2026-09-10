import { apiClient } from "../api/client";

const API_BASE = "/api/v1/analytics/inventory-sales";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type InventoryRealtimeSalesItem = {
  balanceId: string;
  skuId: string;
  skuCode: string;
  skuName: string;
  variantSummary?: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  onHand: number;
  reserved: number;
  available: number;
  rangeSalesQuantity: number;
  rangeOrderCount: number;
  todaySalesQuantity: number;
  yesterdaySalesQuantity: number;
  last7DaysSalesQuantity: number;
  last28DaysSalesQuantity: number;
  last42DaysSalesQuantity: number;
  updatedAt: string;
};

export type InventoryRealtimeSalesPage = {
  items: InventoryRealtimeSalesItem[];
  totalBalanceCount: number;
  totalOnHand: number;
  totalReserved: number;
  totalAvailable: number;
  totalRangeSalesQuantity: number;
  observedAt: string;
  page: number;
  size: number;
  totalPages: number;
};

export type InventoryRealtimeSalesExport = {
  filename: "inventory-realtime-sales.csv";
  mediaType: "text/csv;charset=utf-8";
  rowCount: number;
  content: string;
};

type Request = {
  keyword?: string;
  rangeFrom?: string;
  asOf: string;
  page: number;
  size: number;
  signal?: AbortSignal;
};

type UnknownRecord = Record<string, unknown>;

function invalid(field: string): never {
  throw new Error(`Invalid inventory realtime sales response: ${field}`);
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

function integer(value: unknown, field: string) {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : invalid(field);
}

function nonNegative(value: unknown, field: string) {
  const result = integer(value, field);
  return result >= 0 ? result : invalid(field);
}

function positive(value: unknown, field: string) {
  const result = nonNegative(value, field);
  return result > 0 ? result : invalid(field);
}

function timestamp(value: unknown, field: string) {
  const result = string(value, field);
  return Number.isNaN(Date.parse(result)) ? invalid(field) : result;
}

function uuid(value: unknown, field: string) {
  const result = string(value, field);
  return UUID_PATTERN.test(result) ? result : invalid(field);
}

function item(value: unknown): InventoryRealtimeSalesItem {
  const wire = record(value, "item");
  exact(wire, [
    "balanceId", "skuId", "skuCode", "skuName", "variantSummary",
    "warehouseId", "warehouseCode", "warehouseName", "onHand", "reserved",
    "available", "rangeSalesQuantity", "rangeOrderCount", "todaySalesQuantity",
    "yesterdaySalesQuantity", "last7DaysSalesQuantity", "last28DaysSalesQuantity",
    "last42DaysSalesQuantity", "updatedAt",
  ], "item");
  const onHand = integer(wire.onHand, "item.onHand");
  const reserved = nonNegative(wire.reserved, "item.reserved");
  const available = integer(wire.available, "item.available");
  if (!Number.isSafeInteger(onHand - reserved) || available !== onHand - reserved) {
    invalid("item.available");
  }
  const result = {
    balanceId: uuid(wire.balanceId, "item.balanceId"),
    skuId: uuid(wire.skuId, "item.skuId"),
    skuCode: string(wire.skuCode, "item.skuCode"),
    skuName: string(wire.skuName, "item.skuName"),
    variantSummary: optionalString(wire.variantSummary, "item.variantSummary"),
    warehouseId: uuid(wire.warehouseId, "item.warehouseId"),
    warehouseCode: string(wire.warehouseCode, "item.warehouseCode"),
    warehouseName: string(wire.warehouseName, "item.warehouseName"),
    onHand,
    reserved,
    available,
    rangeSalesQuantity: nonNegative(wire.rangeSalesQuantity, "item.rangeSalesQuantity"),
    rangeOrderCount: nonNegative(wire.rangeOrderCount, "item.rangeOrderCount"),
    todaySalesQuantity: nonNegative(wire.todaySalesQuantity, "item.todaySalesQuantity"),
    yesterdaySalesQuantity: nonNegative(wire.yesterdaySalesQuantity, "item.yesterdaySalesQuantity"),
    last7DaysSalesQuantity: nonNegative(wire.last7DaysSalesQuantity, "item.last7DaysSalesQuantity"),
    last28DaysSalesQuantity: nonNegative(wire.last28DaysSalesQuantity, "item.last28DaysSalesQuantity"),
    last42DaysSalesQuantity: nonNegative(wire.last42DaysSalesQuantity, "item.last42DaysSalesQuantity"),
    updatedAt: timestamp(wire.updatedAt, "item.updatedAt"),
  };
  if (result.todaySalesQuantity > result.last7DaysSalesQuantity
      || result.yesterdaySalesQuantity > result.last7DaysSalesQuantity
      || result.last7DaysSalesQuantity > result.last28DaysSalesQuantity
      || result.last28DaysSalesQuantity > result.last42DaysSalesQuantity
      || (result.rangeSalesQuantity === 0) !== (result.rangeOrderCount === 0)) {
    invalid("item.salesConsistency");
  }
  return result;
}

function exportResult(value: unknown): InventoryRealtimeSalesExport {
  const wire = record(value, "export");
  exact(wire, ["filename", "mediaType", "rowCount", "content"], "export");
  const filename = string(wire.filename, "export.filename");
  const mediaType = string(wire.mediaType, "export.mediaType");
  const rowCount = nonNegative(wire.rowCount, "export.rowCount");
  const content = typeof wire.content === "string" ? wire.content : invalid("export.content");
  if (filename !== "inventory-realtime-sales.csv"
      || mediaType !== "text/csv;charset=utf-8"
      || rowCount > 10_000
      || content.length > 30_000_000
      || !content.startsWith("\uFEFF库存SKU,SKU名称,规格,仓库编码,仓库名称,现货,预留,可用,所选区间销量,所选区间订单数,今日销量,昨日销量,近7天销量,近28天销量,近42天销量,库存更新时间,统计截至\r\n")) {
    invalid("export.contract");
  }
  return {
    filename: "inventory-realtime-sales.csv",
    mediaType: "text/csv;charset=utf-8",
    rowCount,
    content,
  };
}

export function parseInventoryRealtimeSalesPage(value: unknown): InventoryRealtimeSalesPage {
  const wire = record(value, "report");
  exact(wire, [
    "items", "totalBalanceCount", "totalOnHand", "totalReserved", "totalAvailable",
    "totalRangeSalesQuantity", "observedAt", "page", "size", "totalPages",
  ], "report");
  if (!Array.isArray(wire.items)) invalid("report.items");
  const totalOnHand = integer(wire.totalOnHand, "report.totalOnHand");
  const totalReserved = nonNegative(wire.totalReserved, "report.totalReserved");
  const totalAvailable = integer(wire.totalAvailable, "report.totalAvailable");
  if (!Number.isSafeInteger(totalOnHand - totalReserved)
      || totalAvailable !== totalOnHand - totalReserved) {
    invalid("report.totalAvailable");
  }
  const result = {
    items: wire.items.map(item),
    totalBalanceCount: nonNegative(wire.totalBalanceCount, "report.totalBalanceCount"),
    totalOnHand,
    totalReserved,
    totalAvailable,
    totalRangeSalesQuantity: nonNegative(wire.totalRangeSalesQuantity, "report.totalRangeSalesQuantity"),
    observedAt: timestamp(wire.observedAt, "report.observedAt"),
    page: nonNegative(wire.page, "report.page"),
    size: positive(wire.size, "report.size"),
    totalPages: nonNegative(wire.totalPages, "report.totalPages"),
  };
  const expectedPages = result.totalBalanceCount === 0 ? 0 : Math.ceil(result.totalBalanceCount / result.size);
  if (result.totalPages !== expectedPages || result.items.length > result.size
      || result.items.length > result.totalBalanceCount
      || (result.items.length > 0 && result.page >= result.totalPages)
      || (result.totalBalanceCount === 0 && (result.totalOnHand !== 0
        || result.totalReserved !== 0 || result.totalAvailable !== 0
        || result.totalRangeSalesQuantity !== 0))
      || new Set(result.items.map((entry) => entry.balanceId)).size !== result.items.length) {
    invalid("report.cardinality");
  }
  return result;
}

function validInstant(value: string, field: string) {
  if (!value || Number.isNaN(Date.parse(value))) {
    throw new Error(`Invalid inventory realtime sales request: ${field}`);
  }
  return value;
}

export const inventoryRealtimeSalesApi = {
  async summarize(request: Request): Promise<InventoryRealtimeSalesPage> {
    const asOf = validInstant(request.asOf, "asOf");
    const rangeFrom = request.rangeFrom ? validInstant(request.rangeFrom, "rangeFrom") : undefined;
    if (rangeFrom && Date.parse(rangeFrom) >= Date.parse(asOf)) {
      throw new Error("Invalid inventory realtime sales request: range");
    }
    if (!Number.isSafeInteger(request.page) || request.page < 0
        || !Number.isSafeInteger(request.size) || request.size < 1 || request.size > 100) {
      throw new Error("Invalid inventory realtime sales request: page");
    }
    const query = new URLSearchParams({
      asOf,
      page: String(request.page),
      size: String(request.size),
    });
    if (rangeFrom) query.set("rangeFrom", rangeFrom);
    if (request.keyword?.trim()) query.set("keyword", request.keyword.trim().slice(0, 100));
    const result = parseInventoryRealtimeSalesPage(
      await apiClient.request<unknown>(`${API_BASE}?${query}`, { signal: request.signal }),
    );
    if (result.page !== request.page || result.size !== request.size
        || Date.parse(result.observedAt) !== Date.parse(asOf)) {
      invalid("report.requestIdentity");
    }
    return result;
  },
  async exportCsv(request: Omit<Request, "page" | "size" | "signal">): Promise<InventoryRealtimeSalesExport> {
    const asOf = validInstant(request.asOf, "asOf");
    const rangeFrom = request.rangeFrom ? validInstant(request.rangeFrom, "rangeFrom") : undefined;
    if (rangeFrom && Date.parse(rangeFrom) >= Date.parse(asOf)) {
      throw new Error("Invalid inventory realtime sales request: range");
    }
    return exportResult(await apiClient.request<unknown>(`${API_BASE}/exports`, {
      method: "POST",
      body: {
        keyword: request.keyword?.trim().slice(0, 100) || undefined,
        rangeFrom,
        asOf,
      },
    }));
  },
};
