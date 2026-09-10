import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => vi.fn());

vi.mock("../api/client", async (loadOriginal) => {
  const original = await loadOriginal<typeof import("../api/client")>();
  return { ...original, apiClient: { request } };
});

import { loadCustomerServiceOverview } from "./customerServiceOverviewApi";

beforeEach(() => request.mockReset());

describe("customerServiceOverviewApi", () => {
  it("loads the tenant-scoped ERP overview contract", async () => {
    const overview = {
      totalShops: 4,
      enabledShops: 3,
      authorizedShops: 2,
      readyShops: 1,
      pendingSetupShops: 3,
    };
    request.mockResolvedValue(overview);

    await expect(loadCustomerServiceOverview()).resolves.toEqual(overview);
    expect(request).toHaveBeenCalledWith(
      "/api/v1/customer-service/overview",
      { signal: undefined },
    );
  });

  it("fails closed on malformed or negative counters", async () => {
    request.mockResolvedValue({
      totalShops: 1,
      enabledShops: 1,
      authorizedShops: 1,
      readyShops: 1,
      pendingSetupShops: -1,
    });

    await expect(loadCustomerServiceOverview()).rejects.toThrow("无效的数据");
  });
});
