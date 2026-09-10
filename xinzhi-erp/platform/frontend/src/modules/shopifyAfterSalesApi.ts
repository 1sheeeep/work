import { apiClient } from "../api/client";

const API_BASE = "/api/v1/order-center/shopify";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type Money = { amount: string; currencyCode: string };
export type MoneyBag = { shopMoney: Money; presentmentMoney: Money };

export type ShopifyReturnLine = {
  externalReturnLineRef: string;
  externalFulfillmentLineRef: string;
  externalOrderLineRef: string;
  name: string;
  sku?: string;
  quantity: number;
  processableQuantity: number;
  processedQuantity: number;
  refundableQuantity: number;
  refundedQuantity: number;
  reasonHandle?: string;
  reasonName?: string;
};

export type ShopifyReturn = {
  externalReturnRef: string;
  name: string;
  externalOrderRef: string;
  orderName: string;
  status: "CANCELED" | "CLOSED" | "DECLINED" | "OPEN" | "REQUESTED";
  createdAt: string;
  closedAt?: string;
  requestApprovedAt?: string;
  totalQuantity: number;
  lineItems: ShopifyReturnLine[];
};

export type ShopifyReturnPage = {
  shopId: string;
  cursor?: string;
  hasNextPage: boolean;
  fetchedAt: string;
  returns: ShopifyReturn[];
};

export type RefundSelection = {
  externalReturnRef: string;
  lineItems: { externalReturnLineRef: string; quantity: number }[];
  refundShipping: boolean;
  refundDuties: { externalDutyRef: string; refundType: "FULL" | "PROPORTIONAL" }[];
};

export type RefundPreview = RefundSelection & {
  state: "REFUNDABLE" | "NOT_REFUNDABLE";
  shippingAmount?: MoneyBag;
  dutyAmount?: MoneyBag;
  refundAmount: MoneyBag;
  maximumRefundable: MoneyBag;
  previewToken?: string;
  expiresAt?: string;
  fetchedAt: string;
};

export type RefundProcessResult = {
  externalReturnRef: string;
  returnStatus: string;
  outcome: "APPLIED" | "PENDING" | "REVIEW_REQUIRED";
  refundAmount: MoneyBag;
  recoveredFromShopify: boolean;
  updatedAt: string;
};

export type ShopifyDispute = {
  externalDisputeRef: string;
  externalOrderRef?: string;
  orderName?: string;
  status: "ACCEPTED" | "LOST" | "NEEDS_RESPONSE" | "PREVENTED" | "UNDER_REVIEW" | "WON" | "CHARGE_REFUNDED";
  type: "CHARGEBACK" | "INQUIRY";
  reason: string;
  networkReasonCode?: string;
  amount: Money;
  initiatedAt: string;
  evidenceDueBy?: string;
  evidenceSentOn?: string;
  finalizedOn?: string;
};

export type ShopifyDisputePage = {
  shopId: string;
  cursor?: string;
  hasNextPage: boolean;
  fetchedAt: string;
  disputes: ShopifyDispute[];
};

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, limit: number, required = true): string | undefined {
  if ((value === null || value === undefined || value === "") && !required) return undefined;
  if (typeof value !== "string" || value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
  if (required && value.length === 0) throw new Error(`Invalid ${label}`);
  return value;
}

function instant(value: unknown, label: string, required = true): string | undefined {
  const result = text(value, label, 64, required);
  if (!result) return undefined;
  if (Number.isNaN(Date.parse(result))) throw new Error(`Invalid ${label}`);
  return result;
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function money(value: unknown, label: string): Money {
  const wire = record(value, label);
  const amount = text(wire.amount, `${label}.amount`, 80)!;
  const currencyCode = text(wire.currencyCode, `${label}.currencyCode`, 3)!;
  if (!/^-?[0-9]+(?:\.[0-9]+)?$/.test(amount) || !/^[A-Z]{3}$/.test(currencyCode)) {
    throw new Error(`Invalid ${label}`);
  }
  return { amount, currencyCode };
}

function moneyBag(value: unknown, label: string): MoneyBag {
  const wire = record(value, label);
  return { shopMoney: money(wire.shopMoney, `${label}.shopMoney`), presentmentMoney: money(wire.presentmentMoney, `${label}.presentmentMoney`) };
}

function returnLine(value: unknown): ShopifyReturnLine {
  const wire = record(value, "return line");
  const quantity = integer(wire.quantity, "quantity", 1, 100_000_000);
  return {
    externalReturnLineRef: text(wire.externalReturnLineRef, "externalReturnLineRef", 160)!,
    externalFulfillmentLineRef: text(wire.externalFulfillmentLineRef, "externalFulfillmentLineRef", 160)!,
    externalOrderLineRef: text(wire.externalOrderLineRef, "externalOrderLineRef", 160)!,
    name: text(wire.name, "name", 500)!,
    sku: text(wire.sku, "sku", 300, false),
    quantity,
    processableQuantity: integer(wire.processableQuantity, "processableQuantity", 0, quantity),
    processedQuantity: integer(wire.processedQuantity, "processedQuantity", 0, quantity),
    refundableQuantity: integer(wire.refundableQuantity, "refundableQuantity", 0, quantity),
    refundedQuantity: integer(wire.refundedQuantity, "refundedQuantity", 0, quantity),
    reasonHandle: text(wire.reasonHandle, "reasonHandle", 100, false),
    reasonName: text(wire.reasonName, "reasonName", 300, false),
  };
}

function returnItem(value: unknown): ShopifyReturn {
  const wire = record(value, "return");
  if (!Array.isArray(wire.lineItems) || wire.lineItems.length === 0 || wire.lineItems.length > 100) throw new Error("Invalid return lines");
  const lineItems = wire.lineItems.map(returnLine);
  const status = text(wire.status, "status", 32)! as ShopifyReturn["status"];
  if (!["CANCELED", "CLOSED", "DECLINED", "OPEN", "REQUESTED"].includes(status)) throw new Error("Invalid return status");
  return {
    externalReturnRef: text(wire.externalReturnRef, "externalReturnRef", 160)!,
    name: text(wire.name, "name", 300)!,
    externalOrderRef: text(wire.externalOrderRef, "externalOrderRef", 160)!,
    orderName: text(wire.orderName, "orderName", 300)!,
    status,
    createdAt: instant(wire.createdAt, "createdAt")!,
    closedAt: instant(wire.closedAt, "closedAt", false),
    requestApprovedAt: instant(wire.requestApprovedAt, "requestApprovedAt", false),
    totalQuantity: integer(wire.totalQuantity, "totalQuantity", 1, 100_000_000),
    lineItems,
  };
}

function returnPage(value: unknown): ShopifyReturnPage {
  const wire = record(value, "return page");
  const shopId = text(wire.shopId, "shopId", 36)!;
  if (!UUID.test(shopId) || !Array.isArray(wire.returns) || typeof wire.hasNextPage !== "boolean") throw new Error("Invalid return page");
  const cursor = text(wire.cursor, "cursor", 4096, false);
  if (wire.hasNextPage && !cursor) throw new Error("Invalid return page cursor");
  return {
    shopId,
    cursor,
    hasNextPage: wire.hasNextPage,
    fetchedAt: instant(wire.fetchedAt, "fetchedAt")!,
    returns: wire.returns.map(returnItem),
  };
}

function refundPreview(value: unknown): RefundPreview {
  const wire = record(value, "refund preview");
  if (!Array.isArray(wire.lineItems) || !Array.isArray(wire.refundDuties)) throw new Error("Invalid refund preview selection");
  const state = text(wire.state, "state", 32)! as RefundPreview["state"];
  if (!["REFUNDABLE", "NOT_REFUNDABLE"].includes(state)) throw new Error("Invalid refund preview state");
  return {
    externalReturnRef: text(wire.externalReturnRef, "externalReturnRef", 160)!,
    state,
    lineItems: wire.lineItems.map((item) => {
      const line = record(item, "refund line");
      return { externalReturnLineRef: text(line.externalReturnLineRef, "externalReturnLineRef", 160)!, quantity: integer(line.quantity, "quantity", 1, 1_000_000) };
    }),
    refundShipping: wire.refundShipping === true,
    refundDuties: wire.refundDuties.map((item) => {
      const duty = record(item, "refund duty");
      const refundType = text(duty.refundType, "refundType", 32)! as "FULL" | "PROPORTIONAL";
      if (!['FULL', 'PROPORTIONAL'].includes(refundType)) throw new Error("Invalid refund duty type");
      return { externalDutyRef: text(duty.externalDutyRef, "externalDutyRef", 160)!, refundType };
    }),
    shippingAmount: wire.shippingAmount ? moneyBag(wire.shippingAmount, "shippingAmount") : undefined,
    dutyAmount: wire.dutyAmount ? moneyBag(wire.dutyAmount, "dutyAmount") : undefined,
    refundAmount: moneyBag(wire.refundAmount, "refundAmount"),
    maximumRefundable: moneyBag(wire.maximumRefundable, "maximumRefundable"),
    previewToken: text(wire.previewToken, "previewToken", 4096, false),
    expiresAt: instant(wire.expiresAt, "expiresAt", false),
    fetchedAt: instant(wire.fetchedAt, "fetchedAt")!,
  };
}

function dispute(value: unknown): ShopifyDispute {
  const wire = record(value, "dispute");
  const status = text(wire.status, "status", 32)! as ShopifyDispute["status"];
  const type = text(wire.type, "type", 32)! as ShopifyDispute["type"];
  if (!["ACCEPTED", "LOST", "NEEDS_RESPONSE", "PREVENTED", "UNDER_REVIEW", "WON", "CHARGE_REFUNDED"].includes(status) || !["CHARGEBACK", "INQUIRY"].includes(type)) throw new Error("Invalid dispute state");
  return {
    externalDisputeRef: text(wire.externalDisputeRef, "externalDisputeRef", 160)!,
    externalOrderRef: text(wire.externalOrderRef, "externalOrderRef", 160, false),
    orderName: text(wire.orderName, "orderName", 300, false),
    status,
    type,
    reason: text(wire.reason, "reason", 80)!,
    networkReasonCode: text(wire.networkReasonCode, "networkReasonCode", 120, false),
    amount: money(wire.amount, "amount"),
    initiatedAt: instant(wire.initiatedAt, "initiatedAt")!,
    evidenceDueBy: instant(wire.evidenceDueBy, "evidenceDueBy", false),
    evidenceSentOn: instant(wire.evidenceSentOn, "evidenceSentOn", false),
    finalizedOn: instant(wire.finalizedOn, "finalizedOn", false),
  };
}

function disputePage(value: unknown): ShopifyDisputePage {
  const wire = record(value, "dispute page");
  const shopId = text(wire.shopId, "shopId", 36)!;
  if (!UUID.test(shopId) || !Array.isArray(wire.disputes) || typeof wire.hasNextPage !== "boolean") throw new Error("Invalid dispute page");
  const cursor = text(wire.cursor, "cursor", 4096, false);
  if (wire.hasNextPage && !cursor) throw new Error("Invalid dispute page cursor");
  return { shopId, cursor, hasNextPage: wire.hasNextPage, fetchedAt: instant(wire.fetchedAt, "fetchedAt")!, disputes: wire.disputes.map(dispute) };
}

function sameRefundSelection(actual: RefundSelection, expected: RefundSelection) {
  if (actual.externalReturnRef !== expected.externalReturnRef || actual.refundShipping !== expected.refundShipping || actual.lineItems.length !== expected.lineItems.length || actual.refundDuties.length !== expected.refundDuties.length) return false;
  const lines = new Map(actual.lineItems.map((item) => [item.externalReturnLineRef, item.quantity]));
  const duties = new Map(actual.refundDuties.map((item) => [item.externalDutyRef, item.refundType]));
  return expected.lineItems.every((item) => lines.get(item.externalReturnLineRef) === item.quantity)
    && expected.refundDuties.every((item) => duties.get(item.externalDutyRef) === item.refundType);
}

function commandHash(value: string, seed: number) {
  let hash = seed >>> 0;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function afterSalesCommandKey(prefix: string, identity: string, payload: unknown) {
  const canonical = JSON.stringify(payload);
  const numeric = identity.split("/").at(-1) ?? "command";
  return `web.${prefix}.${numeric}.${commandHash(canonical, 0x811c9dc5)}${commandHash(canonical, 0x9e3779b9)}`;
}

export const shopifyAfterSalesApi = {
  async listReturns(shopId: string, limit = 50, cursor?: string, query?: string) {
    const params = new URLSearchParams({ shopId, limit: String(limit) });
    if (cursor) params.set("cursor", cursor);
    if (query) params.set("query", query);
    const result = returnPage(await apiClient.request<unknown>(`${API_BASE}/returns?${params}`));
    if (result.shopId !== shopId) throw new Error("Invalid return shop");
    return result;
  },
  async decideReturn(input: { shopId: string; externalReturnRef: string; decision: "APPROVE" | "DECLINE"; declineReason?: "FINAL_SALE" | "OTHER" | "RETURN_PERIOD_ENDED"; declineNote?: string; notifyCustomer: boolean; idempotencyKey: string }) {
    const wire = record(await apiClient.request<unknown>(`${API_BASE}/returns/decision`, { method: "POST", body: input }), "return decision");
    const externalReturnRef = text(wire.externalReturnRef, "externalReturnRef", 160)!;
    const status = text(wire.status, "status", 32)!;
    if (externalReturnRef !== input.externalReturnRef || !["CANCELED", "CLOSED", "DECLINED", "OPEN", "REQUESTED"].includes(status) || typeof wire.recoveredFromShopify !== "boolean") throw new Error("Invalid return decision");
    return { externalReturnRef, status, recoveredFromShopify: wire.recoveredFromShopify, updatedAt: instant(wire.updatedAt, "updatedAt")! };
  },
  async previewRefund(input: { shopId: string } & RefundSelection) {
    const result = refundPreview(await apiClient.request<unknown>(`${API_BASE}/returns/refund-preview`, { method: "POST", body: input }));
    if (!sameRefundSelection(result, input)) throw new Error("Invalid refund preview selection");
    return result;
  },
  async processRefund(input: { shopId: string } & RefundSelection & { previewToken: string; notifyCustomer: boolean; idempotencyKey: string }) {
    const wire = record(await apiClient.request<unknown>(`${API_BASE}/returns/refund-process`, { method: "POST", body: input }), "refund result");
    const outcome = text(wire.outcome, "outcome", 32)! as RefundProcessResult["outcome"];
    const externalReturnRef = text(wire.externalReturnRef, "externalReturnRef", 160)!;
    if (externalReturnRef !== input.externalReturnRef || !["APPLIED", "PENDING", "REVIEW_REQUIRED"].includes(outcome) || typeof wire.recoveredFromShopify !== "boolean") throw new Error("Invalid refund result");
    return { externalReturnRef, returnStatus: text(wire.returnStatus, "returnStatus", 32)!, outcome, refundAmount: moneyBag(wire.refundAmount, "refundAmount"), recoveredFromShopify: wire.recoveredFromShopify, updatedAt: instant(wire.updatedAt, "updatedAt")! };
  },
  async listDisputes(shopId: string, limit = 50, cursor?: string) {
    const params = new URLSearchParams({ shopId, limit: String(limit) });
    if (cursor) params.set("cursor", cursor);
    const result = disputePage(await apiClient.request<unknown>(`${API_BASE}/disputes?${params}`));
    if (result.shopId !== shopId) throw new Error("Invalid dispute shop");
    return result;
  },
};
