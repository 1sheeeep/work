import { apiClient } from "../api/client";

const API_BASE = "/api/v1/order-center/shopify/customers";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CustomerMoney = { amount: string; currencyCode: string };
export type CustomerLocation = { city?: string; province?: string; country?: string; countryCode?: string };
export type CustomerOrderSummary = {
  externalOrderRef: string;
  name: string;
  createdAt: string;
  financialStatus?: string;
  fulfillmentStatus?: string;
  total: CustomerMoney;
};
export type ShopifyCustomerProfile = {
  externalCustomerRef: string;
  legacyResourceId?: string;
  displayName: string;
  email?: string;
  phone?: string;
  createdAt: string;
  updatedAt: string;
  verifiedEmail: boolean;
  tags: string[];
  numberOfOrders: string;
  totalSpent: CustomerMoney;
  defaultLocation?: CustomerLocation;
  lastOrder?: CustomerOrderSummary;
};
export type ShopifyCustomerPage = {
  shopId: string;
  cursor?: string;
  hasNextPage: boolean;
  fetchedAt: string;
  customers: ShopifyCustomerProfile[];
};

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${label}`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, limit: number, required = true) {
  if ((value === null || value === undefined || value === "") && !required) return undefined;
  if (typeof value !== "string" || value.length > limit || /[\u0000-\u001f\u007f]/.test(value) || (required && value.length === 0)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function instant(value: unknown, label: string) {
  const result = text(value, label, 64)!;
  if (Number.isNaN(Date.parse(result))) throw new Error(`Invalid ${label}`);
  return result;
}

function money(value: unknown, label: string): CustomerMoney {
  const wire = record(value, label);
  const amount = text(wire.amount, `${label}.amount`, 80)!;
  const currencyCode = text(wire.currencyCode, `${label}.currencyCode`, 3)!;
  if (!/^-?[0-9]+(?:\.[0-9]+)?$/.test(amount) || !/^[A-Z]{3}$/.test(currencyCode)) throw new Error(`Invalid ${label}`);
  return { amount, currencyCode };
}

function location(value: unknown): CustomerLocation | undefined {
  if (value === null || value === undefined) return undefined;
  const wire = record(value, "customer location");
  return {
    city: text(wire.city, "city", 255, false),
    province: text(wire.province, "province", 255, false),
    country: text(wire.country, "country", 255, false),
    countryCode: text(wire.countryCode, "countryCode", 64, false),
  };
}

function lastOrder(value: unknown): CustomerOrderSummary | undefined {
  if (value === null || value === undefined) return undefined;
  const wire = record(value, "last order");
  return {
    externalOrderRef: text(wire.externalOrderRef, "externalOrderRef", 160)!,
    name: text(wire.name, "order name", 255)!,
    createdAt: instant(wire.createdAt, "order createdAt"),
    financialStatus: text(wire.financialStatus, "financialStatus", 64, false),
    fulfillmentStatus: text(wire.fulfillmentStatus, "fulfillmentStatus", 64, false),
    total: money(wire.total, "order total"),
  };
}

function customer(value: unknown): ShopifyCustomerProfile {
  const wire = record(value, "customer");
  if (!Array.isArray(wire.tags) || wire.tags.length > 250 || typeof wire.verifiedEmail !== "boolean") throw new Error("Invalid customer");
  const tags = wire.tags.map((tag) => text(tag, "tag", 255)!);
  const numberOfOrders = text(wire.numberOfOrders, "numberOfOrders", 40)!;
  if (!/^[0-9]+$/.test(numberOfOrders)) throw new Error("Invalid numberOfOrders");
  return {
    externalCustomerRef: text(wire.externalCustomerRef, "externalCustomerRef", 160)!,
    legacyResourceId: text(wire.legacyResourceId, "legacyResourceId", 64, false),
    displayName: text(wire.displayName, "displayName", 512)!,
    email: text(wire.email, "email", 320, false),
    phone: text(wire.phone, "phone", 64, false),
    createdAt: instant(wire.createdAt, "createdAt"),
    updatedAt: instant(wire.updatedAt, "updatedAt"),
    verifiedEmail: wire.verifiedEmail,
    tags,
    numberOfOrders,
    totalSpent: money(wire.totalSpent, "totalSpent"),
    defaultLocation: location(wire.defaultLocation),
    lastOrder: lastOrder(wire.lastOrder),
  };
}

function page(value: unknown): ShopifyCustomerPage {
  const wire = record(value, "customer page");
  const shopId = text(wire.shopId, "shopId", 36)!;
  const cursor = text(wire.cursor, "cursor", 4096, false);
  const fetchedAt = instant(wire.fetchedAt, "fetchedAt");
  if (!UUID.test(shopId) || typeof wire.hasNextPage !== "boolean" || !Array.isArray(wire.customers) || wire.customers.length > 100 || (wire.hasNextPage && !cursor)) {
    throw new Error("Invalid customer page");
  }
  const customers = wire.customers.map(customer);
  if (new Set(customers.map((item) => item.externalCustomerRef)).size !== customers.length) throw new Error("Duplicate customer");
  return { shopId, cursor, hasNextPage: wire.hasNextPage, fetchedAt, customers };
}

export const shopifyCustomerApi = {
  async list(shopId: string, limit = 25, cursor?: string, query?: string) {
    if (!UUID.test(shopId) || limit < 1 || limit > 100 || !Number.isInteger(limit)) throw new Error("Invalid customer request");
    const params = new URLSearchParams({ shopId, limit: String(limit) });
    if (cursor) params.set("cursor", cursor);
    if (query) params.set("query", query);
    const result = page(await apiClient.request<unknown>(`${API_BASE}?${params}`));
    if (result.shopId !== shopId) throw new Error("Invalid customer shop");
    return result;
  },
};
