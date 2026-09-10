import { apiClient } from "../api/client";
import type { Page, ProductStatus } from "./productCenterApi";

const API_BASE = "/api/v1/product-center/supply-prices";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type SupplyPriceSkuType = "INVENTORY" | "BUNDLE";

export type ProductSupplyPrice = {
  id: string;
  skuType: SupplyPriceSkuType;
  referenceId: string;
  skuCode: string;
  skuName: string;
  salesCountry: string;
  currency: string;
  unitPrice: number;
  minimumQuantity: number;
  validFrom: string;
  validTo?: string;
  status: ProductStatus;
  note?: string;
  version: number;
  createdByDisplayName: string;
  updatedByDisplayName: string;
  createdAt: string;
  updatedAt: string;
};

export type ProductSupplyPriceInput = {
  skuType?: SupplyPriceSkuType;
  referenceId?: string;
  salesCountry?: string;
  currency: string;
  unitPrice: number;
  minimumQuantity: number;
  validFrom: string;
  validTo?: string;
  status?: Exclude<ProductStatus, "ARCHIVED">;
  note?: string;
};

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number, pattern?: RegExp, optional = false) {
  if (value === undefined || value === null) return optional ? undefined : null;
  if (typeof value !== "string" || value.length < 1 || value.length > max
      || (pattern && !pattern.test(value))) return null;
  return value;
}

function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) {
  return Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max
    ? Number(value) : null;
}

function date(value: unknown, optional = false) {
  return text(value, 10, /^\d{4}-\d{2}-\d{2}$/, optional);
}

function dateTime(value: unknown) {
  return typeof value === "string" && value.length <= 64
    && !Number.isNaN(Date.parse(value)) ? value : null;
}

export function parseProductSupplyPrice(value: unknown): ProductSupplyPrice {
  if (!object(value)) throw new Error("Invalid product supply price response");
  const id = text(value.id, 36, UUID_PATTERN);
  const skuType = value.skuType;
  const referenceId = text(value.referenceId, 36, UUID_PATTERN);
  const skuCode = text(value.skuCode, 64);
  const skuName = text(value.skuName, 200);
  const salesCountry = text(value.salesCountry, 2, /^[A-Z]{2}$/);
  const currency = text(value.currency, 3, /^[A-Z]{3}$/);
  const unitPrice = typeof value.unitPrice === "number" && Number.isFinite(value.unitPrice)
    && value.unitPrice > 0 ? value.unitPrice : null;
  const minimumQuantity = integer(value.minimumQuantity, 1, 1_000_000);
  const validFrom = date(value.validFrom);
  const validTo = date(value.validTo, true);
  const status = value.status;
  const note = text(value.note, 500, undefined, true);
  const version = integer(value.version);
  const createdByDisplayName = text(value.createdByDisplayName, 160);
  const updatedByDisplayName = text(value.updatedByDisplayName, 160);
  const createdAt = dateTime(value.createdAt);
  const updatedAt = dateTime(value.updatedAt);
  if (!id || (skuType !== "INVENTORY" && skuType !== "BUNDLE")
      || !referenceId || !skuCode || !skuName || !salesCountry || !currency
      || unitPrice === null || minimumQuantity === null || !validFrom
      || validTo === null || (validTo && validTo < validFrom)
      || (status !== "ACTIVE" && status !== "INACTIVE" && status !== "ARCHIVED")
      || note === null || version === null || !createdByDisplayName
      || !updatedByDisplayName || !createdAt || !updatedAt) {
    throw new Error("Invalid product supply price response");
  }
  return {
    id, skuType, referenceId, skuCode, skuName, salesCountry, currency,
    unitPrice, minimumQuantity, validFrom, validTo, status, note, version,
    createdByDisplayName, updatedByDisplayName, createdAt, updatedAt,
  };
}

function parsePage(value: unknown): Page<ProductSupplyPrice> {
  if (!object(value) || !Array.isArray(value.items)) {
    throw new Error("Invalid product supply price page response");
  }
  const page = integer(value.page, 0, 9_999);
  const size = integer(value.size, 1, 100);
  const totalElements = integer(value.totalElements, 0);
  const totalPages = integer(value.totalPages, 0, 10_000);
  if (page === null || size === null || totalElements === null || totalPages === null) {
    throw new Error("Invalid product supply price page response");
  }
  const items = value.items.map(parseProductSupplyPrice);
  if (items.length > size || (totalElements === 0) !== (totalPages === 0)) {
    throw new Error("Invalid product supply price page response");
  }
  return { items, page, size, totalElements, totalPages };
}

export const productSupplyPriceApi = {
  async list(request: {
    status?: ProductStatus;
    skuType?: SupplyPriceSkuType;
    country?: string;
    keyword?: string;
    page: number;
    size: number;
  }) {
    const params = new URLSearchParams({ page: String(request.page), size: String(request.size) });
    if (request.status) params.set("status", request.status);
    if (request.skuType) params.set("skuType", request.skuType);
    if (request.country) params.set("country", request.country);
    if (request.keyword) params.set("keyword", request.keyword);
    return parsePage(await apiClient.request<unknown>(`${API_BASE}?${params}`));
  },

  async create(input: ProductSupplyPriceInput & {
    skuType: SupplyPriceSkuType;
    referenceId: string;
    salesCountry: string;
  }) {
    const { status: _status, ...body } = input;
    return parseProductSupplyPrice(await apiClient.request<unknown>(API_BASE, {
      method: "POST", body,
    }));
  },

  async update(id: string, expectedVersion: number, input: ProductSupplyPriceInput) {
    const { skuType: _skuType, referenceId: _referenceId,
      salesCountry: _salesCountry, ...body } = input;
    return parseProductSupplyPrice(await apiClient.request<unknown>(
      `${API_BASE}/${encodeURIComponent(id)}`,
      { method: "PUT", body: { ...body, expectedVersion } },
    ));
  },

  async archive(id: string, expectedVersion: number) {
    return parseProductSupplyPrice(await apiClient.request<unknown>(
      `${API_BASE}/${encodeURIComponent(id)}/archive`,
      { method: "POST", body: { expectedVersion } },
    ));
  },

  async batchStatus(
    status: "ACTIVE" | "INACTIVE",
    items: Array<{ id: string; expectedVersion: number }>,
  ) {
    const value = await apiClient.request<unknown>(`${API_BASE}/batch-status`, {
      method: "POST", body: { status, items },
    });
    if (!object(value) || !Array.isArray(value.items)) {
      throw new Error("Invalid product supply price batch response");
    }
    return value.items.map(parseProductSupplyPrice);
  },
};
