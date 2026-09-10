import { apiClient } from "../api/client";
import type { Page, ProductStatus } from "./productCenterApi";

const API_BASE = "/api/v1/product-center/bundles";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ProductBundleComponent = {
  skuId: string;
  skuCode: string;
  skuName: string;
  quantity: number;
};

export type ProductBundle = {
  id: string;
  businessCode: string;
  name: string;
  description?: string;
  status: ProductStatus;
  components: ProductBundleComponent[];
  componentCount: number;
  totalUnits: number;
  version: number;
  createdByDisplayName: string;
  updatedByDisplayName: string;
  createdAt: string;
  updatedAt: string;
};

export type ProductBundleListRequest = {
  status?: ProductStatus;
  keyword?: string;
  from?: string;
  to?: string;
  page: number;
  size: number;
};

export type ProductBundleInput = {
  businessCode?: string;
  name: string;
  description?: string;
  status?: Exclude<ProductStatus, "ARCHIVED">;
  components: Array<{ skuId: string; quantity: number }>;
};

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(
  value: unknown,
  options: { max: number; optional?: boolean; pattern?: RegExp } = { max: 1 },
) {
  if (value === undefined || value === null) return options.optional ? undefined : null;
  if (typeof value !== "string" || value.length < 1 || value.length > options.max
      || (options.pattern && !options.pattern.test(value))) return null;
  return value;
}

function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) {
  return Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max
    ? Number(value)
    : null;
}

function dateTime(value: unknown) {
  return typeof value === "string" && value.length <= 64
    && !Number.isNaN(Date.parse(value)) ? value : null;
}

function parseComponent(value: unknown): ProductBundleComponent | null {
  if (!object(value)) return null;
  const skuId = stringValue(value.skuId, { max: 36, pattern: UUID_PATTERN });
  const skuCode = stringValue(value.skuCode, { max: 64 });
  const skuName = stringValue(value.skuName, { max: 200 });
  const quantity = integer(value.quantity, 1, 1_000_000);
  if (!skuId || !skuCode || !skuName || quantity === null) return null;
  return { skuId, skuCode, skuName, quantity };
}

export function parseProductBundle(value: unknown): ProductBundle {
  if (!object(value)) throw new Error("Invalid product bundle response");
  const id = stringValue(value.id, { max: 36, pattern: UUID_PATTERN });
  const businessCode = stringValue(value.businessCode, { max: 64 });
  const name = stringValue(value.name, { max: 200 });
  const description = stringValue(value.description, { max: 1000, optional: true });
  const status = value.status;
  const version = integer(value.version);
  const componentCount = integer(value.componentCount, 1, 100);
  const totalUnits = integer(value.totalUnits, 1, 100_000_000);
  const createdByDisplayName = stringValue(value.createdByDisplayName, { max: 160 });
  const updatedByDisplayName = stringValue(value.updatedByDisplayName, { max: 160 });
  const createdAt = dateTime(value.createdAt);
  const updatedAt = dateTime(value.updatedAt);
  if (!Array.isArray(value.components)) throw new Error("Invalid product bundle response");
  const components = value.components.map(parseComponent);
  if (!id || !businessCode || !name || description === null
      || (status !== "ACTIVE" && status !== "INACTIVE" && status !== "ARCHIVED")
      || version === null || componentCount === null || totalUnits === null
      || !createdByDisplayName || !updatedByDisplayName || !createdAt || !updatedAt
      || components.some((item) => item === null)
      || components.length !== componentCount
      || new Set(components.map((item) => item!.skuId)).size !== components.length
      || components.reduce((sum, item) => sum + item!.quantity, 0) !== totalUnits) {
    throw new Error("Invalid product bundle response");
  }
  return {
    id, businessCode, name, description, status,
    components: components as ProductBundleComponent[],
    componentCount, totalUnits, version,
    createdByDisplayName, updatedByDisplayName, createdAt, updatedAt,
  };
}

function parsePage(value: unknown): Page<ProductBundle> {
  if (!object(value) || !Array.isArray(value.items)) {
    throw new Error("Invalid product bundle page response");
  }
  const page = integer(value.page, 0, 9_999);
  const size = integer(value.size, 1, 100);
  const totalElements = integer(value.totalElements, 0);
  const totalPages = integer(value.totalPages, 0, 10_000);
  if (page === null || size === null || totalElements === null || totalPages === null) {
    throw new Error("Invalid product bundle page response");
  }
  const items = value.items.map(parseProductBundle);
  if (items.length > size || (totalElements === 0) !== (totalPages === 0)) {
    throw new Error("Invalid product bundle page response");
  }
  return { items, page, size, totalElements, totalPages };
}

function requestBody(input: ProductBundleInput, includeStatus: boolean) {
  return {
    businessCode: input.businessCode,
    name: input.name,
    description: input.description,
    ...(includeStatus ? { status: input.status } : {}),
    components: input.components,
  };
}

export const productBundleApi = {
  async list(request: ProductBundleListRequest) {
    const params = new URLSearchParams({
      page: String(request.page),
      size: String(request.size),
    });
    if (request.status) params.set("status", request.status);
    if (request.keyword) params.set("keyword", request.keyword);
    if (request.from) params.set("from", request.from);
    if (request.to) params.set("to", request.to);
    return parsePage(await apiClient.request<unknown>(`${API_BASE}?${params}`));
  },

  async get(id: string) {
    return parseProductBundle(await apiClient.request<unknown>(
      `${API_BASE}/${encodeURIComponent(id)}`,
    ));
  },

  async create(input: ProductBundleInput & { businessCode: string }) {
    return parseProductBundle(await apiClient.request<unknown>(API_BASE, {
      method: "POST",
      body: requestBody(input, false),
    }));
  },

  async update(id: string, expectedVersion: number, input: ProductBundleInput) {
    return parseProductBundle(await apiClient.request<unknown>(
      `${API_BASE}/${encodeURIComponent(id)}`,
      {
        method: "PUT",
        body: { ...requestBody(input, true), businessCode: undefined, expectedVersion },
      },
    ));
  },

  async archive(id: string, expectedVersion: number) {
    return parseProductBundle(await apiClient.request<unknown>(
      `${API_BASE}/${encodeURIComponent(id)}/archive`,
      { method: "POST", body: { expectedVersion } },
    ));
  },
};
