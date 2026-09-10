import { apiClient } from "../api/client";

const API_BASE = "/api/v1/analytics/product-sales";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ProductSalesReportItem = {
  skuId: string;
  skuCode: string;
  skuName: string;
  variantSummary?: string;
  orderCount: number;
  salesQuantity: number;
  firstPlacedAt: string;
  lastPlacedAt: string;
};

export type ProductSalesReportPage = {
  items: ProductSalesReportItem[];
  totalSkuCount: number;
  totalSalesQuantity: number;
  page: number;
  size: number;
  totalPages: number;
};

export type ProductSalesReportExport = {
  filename: "product-sales-report.csv";
  mediaType: "text/csv;charset=utf-8";
  rowCount: number;
  content: string;
};

type Request = {
  keyword?: string;
  placedFrom?: string;
  placedToExclusive?: string;
  page: number;
  size: number;
  signal?: AbortSignal;
};

type UnknownRecord = Record<string, unknown>;

function invalid(field: string): never {
  throw new Error(`Invalid product sales report response: ${field}`);
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

function positive(value: unknown, field: string) {
  const result = nonNegative(value, field);
  return result > 0 ? result : invalid(field);
}

function timestamp(value: unknown, field: string) {
  const result = string(value, field);
  return Number.isNaN(Date.parse(result)) ? invalid(field) : result;
}

function item(value: unknown): ProductSalesReportItem {
  const wire = record(value, "item");
  exact(wire, [
    "skuId", "skuCode", "skuName", "variantSummary", "orderCount",
    "salesQuantity", "firstPlacedAt", "lastPlacedAt",
  ], "item");
  const skuId = string(wire.skuId, "item.skuId");
  if (!UUID_PATTERN.test(skuId)) invalid("item.skuId");
  return {
    skuId,
    skuCode: string(wire.skuCode, "item.skuCode"),
    skuName: string(wire.skuName, "item.skuName"),
    variantSummary: optionalString(wire.variantSummary, "item.variantSummary"),
    orderCount: positive(wire.orderCount, "item.orderCount"),
    salesQuantity: positive(wire.salesQuantity, "item.salesQuantity"),
    firstPlacedAt: timestamp(wire.firstPlacedAt, "item.firstPlacedAt"),
    lastPlacedAt: timestamp(wire.lastPlacedAt, "item.lastPlacedAt"),
  };
}

function exportResult(value: unknown): ProductSalesReportExport {
  const wire = record(value, "export");
  exact(wire, ["filename", "mediaType", "rowCount", "content"], "export");
  const filename = string(wire.filename, "export.filename");
  const mediaType = string(wire.mediaType, "export.mediaType");
  const rowCount = nonNegative(wire.rowCount, "export.rowCount");
  const content = typeof wire.content === "string" ? wire.content : invalid("export.content");
  if (filename !== "product-sales-report.csv"
      || mediaType !== "text/csv;charset=utf-8"
      || rowCount > 10_000
      || content.length > 30_000_000
      || !content.startsWith("\uFEFF库存SKU,SKU名称,规格,关联订单数,销售数量,首次下单,最近下单\r\n")) {
    invalid("export.contract");
  }
  return {
    filename: "product-sales-report.csv",
    mediaType: "text/csv;charset=utf-8",
    rowCount,
    content,
  };
}

export function parseProductSalesReportPage(value: unknown): ProductSalesReportPage {
  const wire = record(value, "report");
  exact(wire, [
    "items", "totalSkuCount", "totalSalesQuantity", "page", "size", "totalPages",
  ], "report");
  if (!Array.isArray(wire.items)) invalid("report.items");
  const result = {
    items: wire.items.map(item),
    totalSkuCount: nonNegative(wire.totalSkuCount, "report.totalSkuCount"),
    totalSalesQuantity: nonNegative(wire.totalSalesQuantity, "report.totalSalesQuantity"),
    page: nonNegative(wire.page, "report.page"),
    size: positive(wire.size, "report.size"),
    totalPages: nonNegative(wire.totalPages, "report.totalPages"),
  };
  const expectedPages = result.totalSkuCount === 0 ? 0 : Math.ceil(result.totalSkuCount / result.size);
  if (result.totalPages !== expectedPages || result.items.length > result.size
      || result.items.length > result.totalSkuCount
      || (result.items.length > 0 && result.page >= result.totalPages)
      || (result.items.length > 0 && result.totalSalesQuantity === 0)
      || new Set(result.items.map((entry) => entry.skuId)).size !== result.items.length) {
    invalid("report.cardinality");
  }
  return result;
}

export const productSalesReportApi = {
  async summarize(request: Request): Promise<ProductSalesReportPage> {
    if (!Number.isSafeInteger(request.page) || request.page < 0
        || !Number.isSafeInteger(request.size) || request.size < 1 || request.size > 100) {
      throw new Error("Invalid product sales report request: page");
    }
    const query = new URLSearchParams({ page: String(request.page), size: String(request.size) });
    if (request.keyword?.trim()) query.set("keyword", request.keyword.trim().slice(0, 100));
    if (request.placedFrom) query.set("placedFrom", request.placedFrom);
    if (request.placedToExclusive) query.set("placedToExclusive", request.placedToExclusive);
    const result = parseProductSalesReportPage(
      await apiClient.request<unknown>(`${API_BASE}?${query}`, { signal: request.signal }),
    );
    if (result.page !== request.page || result.size !== request.size) {
      invalid("report.requestIdentity");
    }
    return result;
  },
  async exportCsv(
    request: Omit<Request, "page" | "size" | "signal">,
  ): Promise<ProductSalesReportExport> {
    return exportResult(await apiClient.request<unknown>(`${API_BASE}/exports`, {
      method: "POST",
      body: {
        keyword: request.keyword?.trim().slice(0, 100) || undefined,
        placedFrom: request.placedFrom,
        placedToExclusive: request.placedToExclusive,
      },
    }));
  },
};
