import { ApiError, apiClient } from "../api/client";

export type CustomerServiceOverview = {
  totalShops: number;
  enabledShops: number;
  authorizedShops: number;
  readyShops: number;
  pendingSetupShops: number;
};

const overviewFields = [
  "totalShops",
  "enabledShops",
  "authorizedShops",
  "readyShops",
  "pendingSetupShops",
] as const;

export async function loadCustomerServiceOverview(signal?: AbortSignal) {
  const response = await apiClient.request<unknown>(
    "/api/v1/customer-service/overview",
    { signal },
  );
  if (!isOverview(response)) {
    throw new ApiError("客服概览返回了无效的数据。", { status: 0 });
  }
  return response;
}

function isOverview(value: unknown): value is CustomerServiceOverview {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return overviewFields.every((field) => Number.isSafeInteger(candidate[field])
    && (candidate[field] as number) >= 0);
}
