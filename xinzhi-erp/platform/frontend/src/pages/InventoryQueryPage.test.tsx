import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { inventoryApi } from "../modules/inventoryApi";
import { productCenterApi } from "../modules/productCenterApi";
import { shopCenterApi } from "../modules/shopCenterApi";
import { warehouseCenterApi } from "../modules/warehouseCenterApi";
import {
  INVENTORY_QUERY_AUTO_LOAD_STORAGE_KEY,
  InventoryQueryPage,
  inventoryBalanceCsv,
  loadInventoryBalanceExportRows,
  parseInventoryQuery,
  safeInventoryMessage,
  shopifyInventoryPublicationStorageKey,
  toInventoryQueryUrl,
} from "./InventoryQueryPage";

const routerState = vi.hoisted(() => ({
  search: "",
  push: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ history: { push: routerState.push } }),
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: { searchStr: routerState.search } }),
}));

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ hasPermission: () => true }),
}));

const warehouseId = "96000000-0000-4000-8000-000000000010";
const categoryId = "95000000-0000-4000-8000-000000000010";
const warehouse = {
  id: warehouseId,
  businessCode: "WH_NORTH",
  name: "北区仓",
  status: "ACTIVE" as const,
  version: 1,
  createdAt: "2026-07-31T00:00:00Z",
  updatedAt: "2026-07-31T00:00:00Z",
};
const secondWarehouse = {
  ...warehouse,
  id: "96000000-0000-4000-8000-000000000011",
  businessCode: "WH_SOUTH",
  name: "南区仓",
};
const category = {
  id: categoryId,
  name: "配件类",
  sortOrder: 10,
  status: "ACTIVE" as const,
  version: 1,
  createdAt: "2026-07-31T00:00:00Z",
  updatedAt: "2026-07-31T00:00:00Z",
};
const shopId = "94000000-0000-4000-8000-000000000010";
const shop = {
  id: shopId,
  platformId: "93000000-0000-4000-8000-000000000010",
  externalShopRef: "inventory-test.myshopify.com",
  displayName: "Shopify 测试店",
  status: "ACTIVE" as const,
  authorization: {
    status: "AUTHORIZED" as const,
    credentialConfigured: true,
    scopes: ["read_inventory", "write_inventory"],
  },
  updatedAt: "2026-07-31T00:00:00Z",
};
const inventoryBalance = {
  id: "98000000-0000-4000-8000-000000000010",
  skuId: "97000000-0000-4000-8000-000000000010",
  skuBusinessCode: "SKU_100",
  skuName: "测试商品",
  warehouseId,
  warehouseBusinessCode: "WH_NORTH",
  warehouseName: "北区仓",
  onHand: 12,
  reserved: 3,
  available: 9,
  version: 2,
  updatedAt: "2026-07-31T00:00:00Z",
};
const inventoryPreview = {
  shopId,
  balanceId: inventoryBalance.id,
  balanceVersion: inventoryBalance.version,
  skuId: inventoryBalance.skuId,
  skuCode: inventoryBalance.skuBusinessCode,
  skuName: inventoryBalance.skuName,
  warehouseId,
  warehouseCode: inventoryBalance.warehouseBusinessCode,
  warehouseName: inventoryBalance.warehouseName,
  externalVariantRef: "gid://shopify/ProductVariant/101",
  externalInventoryItemRef: "gid://shopify/InventoryItem/201",
  externalLocationRef: "gid://shopify/Location/301",
  erpOnHand: 12,
  erpReserved: 3,
  erpAvailable: 9,
  shopifyAvailable: 7,
  shopifyOnHand: 8,
  availableDifference: 2,
  fetchedAt: "2026-07-31T01:00:00Z",
};
const publication = {
  id: "92000000-0000-4000-8000-000000000010",
  shopId,
  balanceId: inventoryBalance.id,
  expectedBalanceVersion: inventoryBalance.version,
  expectedShopifyAvailable: 7,
  targetAvailable: 9,
  status: "QUEUED" as const,
  attemptCount: 0,
  safeErrorCode: undefined,
  replayed: false,
};

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  routerState.search = "";
  routerState.push.mockReset();
  vi.spyOn(inventoryApi, "listBalances").mockResolvedValue({
    items: [],
    page: 0,
    size: 50,
    totalElements: 0,
    totalPages: 0,
  });
  vi.spyOn(warehouseCenterApi, "listWarehouses").mockResolvedValue({
    items: [warehouse],
    page: 0,
    size: 200,
    totalElements: 1,
    totalPages: 1,
  });
  vi.spyOn(productCenterApi, "listCategories").mockResolvedValue({
    items: [category],
    page: 0,
    size: 200,
    totalElements: 1,
    totalPages: 1,
  });
  vi.spyOn(shopCenterApi, "listShops").mockResolvedValue({
    items: [shop],
    page: 0,
    size: 200,
    totalElements: 1,
    totalPages: 1,
  });
  vi.spyOn(inventoryApi, "previewShopifyInventory")
    .mockResolvedValue(inventoryPreview);
  vi.spyOn(inventoryApi, "enqueueShopifyInventoryPublication")
    .mockResolvedValue(publication);
  vi.spyOn(inventoryApi, "getShopifyInventoryPublication")
    .mockResolvedValue(publication);
  vi.spyOn(inventoryApi, "getLatestShopifyInventoryPublication")
    .mockRejectedValue(new ApiError("not found", { status: 404 }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("InventoryQueryPage", () => {
  it("bounds shareable filters and retains only valid catalog ids", () => {
    expect(
      parseInventoryQuery(
        `?warehouseId=${warehouseId}&categoryId=${categoryId}&searchField=NAME_EN&keyword=${"x".repeat(120)}&onHandMin=-5&onHandMax=12&updatedFrom=2026-07-01&updatedTo=2026-07-31&page=-1&size=999`,
      ),
    ).toEqual({
      warehouseId,
      categoryId,
      searchField: "NAME_EN",
      keyword: "x".repeat(100),
      onHandMin: -5,
      onHandMax: 12,
      updatedFrom: "2026-07-01",
      updatedTo: "2026-07-31",
      page: 0,
      size: 50,
    });
    expect(
      parseInventoryQuery("?warehouseId=bad").warehouseId,
    ).toBeUndefined();
    expect(
      parseInventoryQuery("?categoryId=bad").categoryId,
    ).toBeUndefined();
    expect(
      parseInventoryQuery("?searchField=UNSUPPORTED").searchField,
    ).toBe("ALL");
    expect(
      toInventoryQueryUrl({
        warehouseId,
        categoryId,
        searchField: "MASTER_SKU",
        keyword: "SKU_100",
        onHandMin: -2,
        onHandMax: 10,
        updatedFrom: "2026-07-01",
        updatedTo: "2026-07-31",
        page: 2,
        size: 100,
      }),
    ).toContain(`warehouseId=${warehouseId}`);
    expect(
      toInventoryQueryUrl({
        warehouseId,
        categoryId,
        searchField: "ALL",
        keyword: "",
        page: 0,
        size: 50,
      }),
    ).toContain(`categoryId=${categoryId}`);
    expect(safeInventoryMessage(new ApiError("hidden", { status: 403 })))
      .not.toContain("hidden");
  });

  it("exports visible inventory balance fields with formula protection", () => {
    const output = inventoryBalanceCsv([{
      id: "98000000-0000-4000-8000-000000000010",
      skuId: "97000000-0000-4000-8000-000000000010",
      skuBusinessCode: "=SKU_UNSAFE",
      skuName: "测试,商品",
      warehouseId,
      warehouseBusinessCode: "WH_NORTH",
      warehouseName: "北区仓",
      onHand: -2,
      reserved: 3,
      available: -5,
      version: 1,
      updatedAt: "2026-07-31T00:00:00Z",
    }]);

    expect(output).toContain("\uFEFF库存SKU编号,商品名称");
    expect(output).toContain("'=SKU_UNSAFE");
    expect(output).toContain("\"测试,商品\"");
    expect(output).toContain("-2,3,-5");
  });

  it("loads every stable inventory export page and rejects duplicate rows", async () => {
    const firstBalance = {
      id: "98000000-0000-4000-8000-000000000010",
      skuId: "97000000-0000-4000-8000-000000000010",
      skuBusinessCode: "SKU_100",
      skuName: "测试商品",
      warehouseId,
      warehouseBusinessCode: "WH_NORTH",
      warehouseName: "北区仓",
      onHand: 9,
      reserved: 3,
      available: 6,
      version: 1,
      updatedAt: "2026-07-31T00:00:00Z",
    };
    const secondBalance = {
      ...firstBalance,
      id: "98000000-0000-4000-8000-000000000011",
      skuId: "97000000-0000-4000-8000-000000000011",
      skuBusinessCode: "SKU_101",
    };
    vi.mocked(inventoryApi.listBalances).mockResolvedValueOnce({
      items: [firstBalance],
      page: 0,
      size: 200,
      totalElements: 2,
      totalPages: 2,
    }).mockResolvedValueOnce({
      items: [secondBalance],
      page: 1,
      size: 200,
      totalElements: 2,
      totalPages: 2,
    });

    await expect(loadInventoryBalanceExportRows({
      searchField: "INVENTORY_SKU",
      keyword: "SKU",
    })).resolves.toEqual([firstBalance, secondBalance]);
    expect(inventoryApi.listBalances).toHaveBeenNthCalledWith(2, {
      searchField: "INVENTORY_SKU",
      keyword: "SKU",
      page: 1,
      size: 200,
    });

    vi.mocked(inventoryApi.listBalances).mockResolvedValueOnce({
      items: [firstBalance],
      page: 0,
      size: 200,
      totalElements: 2,
      totalPages: 2,
    }).mockResolvedValueOnce({
      items: [firstBalance],
      page: 1,
      size: 200,
      totalElements: 2,
      totalPages: 2,
    });
    await expect(loadInventoryBalanceExportRows({}))
      .rejects.toThrow("导出期间库存余额发生变化，请刷新后重试。");
  });

  it("keeps the inventory table visible when empty and applies filters", async () => {
    render(<InventoryQueryPage />);

    expect(
      await screen.findByRole("table", { name: "库存余额列表" }),
    ).toBeTruthy();
    expect(screen.getByText("没有符合筛选条件的库存余额。")).toBeTruthy();
    expect(screen.getByLabelText("仓库：")).toBeTruthy();
    expect(screen.getByLabelText("商品目录：")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "按主 SKU 编号" }));
    fireEvent.change(screen.getByLabelText("库存查询关键词"), {
      target: { value: "SKU_100" },
    });
    fireEvent.change(screen.getByLabelText("现货库存最小值（含）"), {
      target: { value: "-2" },
    });
    fireEvent.change(screen.getByLabelText("现货库存最大值（含）"), {
      target: { value: "10" },
    });
    fireEvent.change(screen.getByLabelText("仓库："), {
      target: { value: warehouseId },
    });
    await screen.findByRole("option", { name: "配件类" });
    fireEvent.change(screen.getByLabelText("商品目录："), {
      target: { value: categoryId },
    });
    fireEvent.change(
      screen.getByLabelText("余额更新时间起始日期（含）"),
      { target: { value: "2026-07-01" } },
    );
    fireEvent.change(
      screen.getByLabelText("余额更新时间截止日期（含）"),
      { target: { value: "2026-07-31" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    expect(routerState.push).toHaveBeenCalledWith(
      `/products/inventory-query?searchField=MASTER_SKU&page=0&size=50&warehouseId=${warehouseId}&categoryId=${categoryId}&keyword=SKU_100&onHandMin=-2&onHandMax=10&updatedFrom=2026-07-01&updatedTo=2026-07-31`,
    );
  });

  it("loads every bounded warehouse page for a complete filter catalog", async () => {
    vi.mocked(warehouseCenterApi.listWarehouses)
      .mockResolvedValueOnce({
        items: [warehouse],
        page: 0,
        size: 200,
        totalElements: 2,
        totalPages: 2,
      })
      .mockResolvedValueOnce({
        items: [secondWarehouse],
        page: 1,
        size: 200,
        totalElements: 2,
        totalPages: 2,
      });

    render(<InventoryQueryPage />);
    expect(
      await screen.findByRole("option", { name: /WH_SOUTH/ }),
    ).toBeTruthy();
    expect(warehouseCenterApi.listWarehouses).toHaveBeenNthCalledWith(
      2,
      { page: 1, size: 200 },
    );
  });

  it("keeps a recovery-link warehouse selected after the directory loads", async () => {
    routerState.search =
      `?warehouseId=${warehouseId}&categoryId=${categoryId}` +
      "&searchField=INVENTORY_SKU&keyword=SKU_100&page=0&size=50";

    render(<InventoryQueryPage />);
    await screen.findByRole("option", { name: /WH_NORTH/ });
    await screen.findByRole("option", { name: "配件类" });

    expect((screen.getByLabelText("仓库：") as HTMLSelectElement).value)
      .toBe(warehouseId);
    expect((screen.getByLabelText("商品目录：") as HTMLSelectElement).value)
      .toBe(categoryId);
  });

  it("fails closed when the warehouse filter catalog is too large", async () => {
    vi.mocked(warehouseCenterApi.listWarehouses).mockResolvedValueOnce({
      items: [],
      page: 0,
      size: 200,
      totalElements: 10_001,
      totalPages: 51,
    });

    render(<InventoryQueryPage />);

    expect(
      await screen.findByText(/仓库目录暂时无法读取/),
    ).toBeTruthy();
    expect(warehouseCenterApi.listWarehouses).toHaveBeenCalledOnce();
  });

  it("rejects an inverted on-hand quantity range near the fields", async () => {
    render(<InventoryQueryPage />);
    await screen.findByRole("table", { name: "库存余额列表" });
    routerState.push.mockClear();
    fireEvent.change(screen.getByLabelText("现货库存最小值（含）"), {
      target: { value: "10" },
    });
    fireEvent.change(screen.getByLabelText("现货库存最大值（含）"), {
      target: { value: "-2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));

    expect(
      screen.getByRole("alert").textContent,
    ).toContain("现货库存最小值不能大于最大值");
    expect(routerState.push).not.toHaveBeenCalled();
  });

  it("rejects an inverted balance updated date range near the fields", async () => {
    render(<InventoryQueryPage />);
    await screen.findByRole("table", { name: "库存余额列表" });
    routerState.push.mockClear();
    fireEvent.change(
      screen.getByLabelText("余额更新时间起始日期（含）"),
      { target: { value: "2026-08-01" } },
    );
    fireEvent.change(
      screen.getByLabelText("余额更新时间截止日期（含）"),
      { target: { value: "2026-07-31" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));

    expect(
      screen.getByRole("alert").textContent,
    ).toContain("余额更新时间起始日期不能晚于截止日期");
    expect(routerState.push).not.toHaveBeenCalled();
  });

  it("persists the archived automatic initialization setting", async () => {
    render(<InventoryQueryPage />);
    await screen.findByRole("table", { name: "库存余额列表" });

    fireEvent.click(screen.getByRole("button", { name: "页面设置" }));
    expect(screen.getByRole("dialog", { name: "页面设置" })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "关闭" }));
    fireEvent.click(screen.getByRole("button", { name: "保存设置" }));

    expect(
      window.localStorage.getItem(
        INVENTORY_QUERY_AUTO_LOAD_STORAGE_KEY,
      ),
    ).toBe("false");
    expect(screen.queryByRole("dialog", { name: "页面设置" })).toBeNull();
  });

  it("waits for an explicit query when automatic initialization is off", async () => {
    window.localStorage.setItem(
      INVENTORY_QUERY_AUTO_LOAD_STORAGE_KEY,
      "false",
    );
    render(<InventoryQueryPage />);

    expect(
      screen.getByText(/已关闭进入页面自动查询/),
    ).toBeTruthy();
    expect(inventoryApi.listBalances).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "查询" }));

    expect(
      await screen.findByRole("table", { name: "库存余额列表" }),
    ).toBeTruthy();
    expect(inventoryApi.listBalances).toHaveBeenCalledOnce();
  });

  it("resets the compact filters while preserving page size", async () => {
    routerState.search =
      `?warehouseId=${warehouseId}&categoryId=${categoryId}&keyword=SKU_100&page=2&size=100`;
    render(<InventoryQueryPage />);
    await screen.findByRole("table", { name: "库存余额列表" });

    fireEvent.click(
      screen.getByRole("button", { name: "重置" }),
    );

    expect(routerState.push).toHaveBeenLastCalledWith(
      "/products/inventory-query?searchField=INVENTORY_SKU&page=0&size=100",
    );
  });

  it("renders signed on-hand, reserved and available quantities", async () => {
    routerState.search = "?searchField=INVENTORY_SKU&page=0&size=17";
    vi.mocked(inventoryApi.listBalances).mockResolvedValue({
      items: [{
        id: "98000000-0000-4000-8000-000000000010",
        skuId: "97000000-0000-4000-8000-000000000010",
        skuBusinessCode: "SKU_NEGATIVE",
        skuName: "负库存测试",
        warehouseId,
        warehouseBusinessCode: "WH_NORTH",
        warehouseName: "北区仓",
        onHand: -2,
        reserved: 3,
        available: -5,
        version: 1,
        updatedAt: "2026-07-31T00:00:00Z",
      }],
      page: 0,
      size: 17,
      totalElements: 1,
      totalPages: 1,
    });

    render(<InventoryQueryPage />);
    expect(await screen.findByText("SKU_NEGATIVE")).toBeTruthy();
    expect(
      screen.getByText(/可用库存 = 现货库存 − 已预留/),
    ).toBeTruthy();
    expect(screen.getByText("-2")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("-5")).toBeTruthy();
    expect(screen.getByLabelText("每页条数")).toHaveProperty("value", "17");
  });

  it("prevents duplicate inventory exports while the download is loading", async () => {
    let resolveExport: ((value: Awaited<
      ReturnType<typeof inventoryApi.listBalances>
    >) => void) | undefined;
    vi.mocked(inventoryApi.listBalances).mockResolvedValueOnce({
      items: [],
      page: 0,
      size: 50,
      totalElements: 0,
      totalPages: 0,
    }).mockImplementationOnce(() => new Promise((resolve) => {
      resolveExport = resolve;
    }));

    render(<InventoryQueryPage />);
    await screen.findByRole("table", { name: "库存余额列表" });
    fireEvent.click(screen.getByRole("button", { name: "导出查询结果" }));

    const busyButton = await screen.findByRole("button", {
      name: "正在导出…",
    });
    expect(busyButton).toHaveProperty("disabled", true);
    fireEvent.click(busyButton);
    expect(inventoryApi.listBalances).toHaveBeenCalledTimes(2);

    resolveExport?.({
      items: [],
      page: 0,
      size: 200,
      totalElements: 0,
      totalPages: 0,
    });
  });

  it("requires an explicit Shopify preflight and confirmation before publishing", async () => {
    vi.mocked(inventoryApi.listBalances).mockResolvedValue({
      items: [inventoryBalance],
      page: 0,
      size: 50,
      totalElements: 1,
      totalPages: 1,
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<InventoryQueryPage />);
    fireEvent.click(await screen.findByRole("button", {
      name: "Shopify 库存",
    }));
    expect(
      await screen.findByRole("dialog", { name: "Shopify 库存发布" }),
    ).toBeTruthy();
    await screen.findByRole("option", {
      name: "Shopify 测试店 · inventory-test.myshopify.com",
    });
    expect(inventoryApi.enqueueShopifyInventoryPublication)
      .not.toHaveBeenCalled();

    const previewButton = screen.getByRole("button", { name: "读取并预检" });
    await waitFor(() => expect(previewButton).toHaveProperty("disabled", false));
    fireEvent.click(previewButton);
    expect(await screen.findByText("发布预检")).toBeTruthy();
    expect(inventoryApi.previewShopifyInventory).toHaveBeenCalledWith(
      shopId,
      inventoryBalance.id,
    );
    expect(screen.getByText("+2")).toBeTruthy();
    expect(inventoryApi.enqueueShopifyInventoryPublication)
      .not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", {
      name: "发布到 Shopify",
    }));
    await waitFor(() => {
      expect(inventoryApi.enqueueShopifyInventoryPublication)
        .toHaveBeenCalledOnce();
    });
    expect(confirm).toHaveBeenCalledWith(
      "确认将 ERP 可用库存 9 发布到 Shopify？当前 Shopify 可用库存为 7。",
    );
    expect(
      vi.mocked(inventoryApi.enqueueShopifyInventoryPublication)
        .mock.calls[0]?.[0],
    ).toEqual({
      shopId,
      balanceId: inventoryBalance.id,
      expectedBalanceVersion: inventoryBalance.version,
      expectedShopifyAvailable: 7,
    });
    expect(
      vi.mocked(inventoryApi.enqueueShopifyInventoryPublication)
        .mock.calls[0]?.[1],
    ).toMatch(/^inventory:[0-9a-f-]{36}$/);
    expect(window.sessionStorage.getItem(
      shopifyInventoryPublicationStorageKey(shopId, inventoryBalance.id),
    )).toBe(publication.id);
    expect(await screen.findByText(/发布任务已排队/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "发布到 Shopify" }))
      .toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "等待发布完成" }))
      .toHaveProperty("disabled", true);
  });

  it("restores an active Shopify inventory publication before allowing another preview", async () => {
    vi.mocked(inventoryApi.listBalances).mockResolvedValue({
      items: [inventoryBalance],
      page: 0,
      size: 50,
      totalElements: 1,
      totalPages: 1,
    });
    window.sessionStorage.setItem(
      shopifyInventoryPublicationStorageKey(shopId, inventoryBalance.id),
      publication.id,
    );

    render(<InventoryQueryPage />);
    fireEvent.click(await screen.findByRole("button", {
      name: "Shopify 库存",
    }));

    expect(
      await screen.findByText(/已恢复已有任务/),
    ).toBeTruthy();
    expect(inventoryApi.getShopifyInventoryPublication)
      .toHaveBeenCalledWith(publication.id);
    expect(inventoryApi.previewShopifyInventory).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "等待发布完成" }))
      .toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "发布到 Shopify" }))
      .toHaveProperty("disabled", true);
  });

  it("recovers the latest active publication from the server without browser state", async () => {
    vi.mocked(inventoryApi.listBalances).mockResolvedValue({
      items: [inventoryBalance],
      page: 0,
      size: 50,
      totalElements: 1,
      totalPages: 1,
    });
    vi.mocked(inventoryApi.getLatestShopifyInventoryPublication)
      .mockResolvedValueOnce(publication);

    render(<InventoryQueryPage />);
    fireEvent.click(await screen.findByRole("button", {
      name: "Shopify 库存",
    }));

    expect(await screen.findByText(/已恢复已有任务/)).toBeTruthy();
    expect(inventoryApi.getLatestShopifyInventoryPublication)
      .toHaveBeenCalledWith(shopId, inventoryBalance.id);
    expect(window.sessionStorage.getItem(
      shopifyInventoryPublicationStorageKey(shopId, inventoryBalance.id),
    )).toBe(publication.id);
    expect(screen.getByRole("button", { name: "等待发布完成" }))
      .toHaveProperty("disabled", true);
  });

  it("fails closed when an existing Shopify inventory task cannot be confirmed", async () => {
    vi.mocked(inventoryApi.listBalances).mockResolvedValue({
      items: [inventoryBalance],
      page: 0,
      size: 50,
      totalElements: 1,
      totalPages: 1,
    });
    window.sessionStorage.setItem(
      shopifyInventoryPublicationStorageKey(shopId, inventoryBalance.id),
      publication.id,
    );
    vi.mocked(inventoryApi.getShopifyInventoryPublication)
      .mockRejectedValueOnce(new ApiError("hidden network detail", { status: 0 }))
      .mockResolvedValueOnce(publication);

    render(<InventoryQueryPage />);
    fireEvent.click(await screen.findByRole("button", {
      name: "Shopify 库存",
    }));

    expect(await screen.findByText(/为避免重复提交/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "先确认现有任务" }))
      .toHaveProperty("disabled", true);
    expect(inventoryApi.previewShopifyInventory).not.toHaveBeenCalled();
    expect(screen.queryByText(/hidden network detail/)).toBeNull();

    fireEvent.click(screen.getByRole("button", {
      name: "重新查询现有任务",
    }));
    expect(
      await screen.findByText(/已恢复已有任务/),
    ).toBeTruthy();
    expect(inventoryApi.getShopifyInventoryPublication)
      .toHaveBeenCalledTimes(2);
  });

  it("maps Shopify preflight conflicts to a fixed recovery message", async () => {
    vi.mocked(inventoryApi.listBalances).mockResolvedValue({
      items: [inventoryBalance],
      page: 0,
      size: 50,
      totalElements: 1,
      totalPages: 1,
    });
    vi.mocked(inventoryApi.previewShopifyInventory).mockRejectedValue(
      new ApiError("raw provider detail", { status: 409 }),
    );

    render(<InventoryQueryPage />);
    fireEvent.click(await screen.findByRole("button", {
      name: "Shopify 库存",
    }));
    await screen.findByRole("option", {
      name: "Shopify 测试店 · inventory-test.myshopify.com",
    });
    const previewButton = screen.getByRole("button", { name: "读取并预检" });
    await waitFor(() => expect(previewButton).toHaveProperty("disabled", false));
    fireEvent.click(previewButton);

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("请检查商品库存映射、仓库库位映射及店铺授权状态"),
    );
    expect(screen.queryByText(/raw provider detail/)).toBeNull();
    expect(inventoryApi.enqueueShopifyInventoryPublication)
      .not.toHaveBeenCalled();
  });

  it("explains missing Shopify inventory scope during preflight", async () => {
    vi.mocked(inventoryApi.listBalances).mockResolvedValue({
      items: [inventoryBalance],
      page: 0,
      size: 50,
      totalElements: 1,
      totalPages: 1,
    });
    vi.mocked(inventoryApi.previewShopifyInventory).mockRejectedValue(
      new ApiError("Shopify authorization must include the required scope", {
        status: 409,
        code: "shopify_authorization_conflict",
        details: { reason: "shopify_scope_missing", scope: "write_inventory" },
      }),
    );

    render(<InventoryQueryPage />);
    fireEvent.click(await screen.findByRole("button", {
      name: "Shopify 库存",
    }));
    await screen.findByRole("option", {
      name: "Shopify 测试店 · inventory-test.myshopify.com",
    });
    const previewButton = screen.getByRole("button", { name: "读取并预检" });
    await waitFor(() => expect(previewButton).toHaveProperty("disabled", false));
    fireEvent.click(previewButton);

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("Shopify 店铺授权未连接或库存更新权限不可用"),
    );
    expect(inventoryApi.enqueueShopifyInventoryPublication)
      .not.toHaveBeenCalled();
  });
});
