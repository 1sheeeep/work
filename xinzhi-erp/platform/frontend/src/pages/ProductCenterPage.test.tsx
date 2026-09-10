import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  Page,
  ProductListing,
  ProductSku,
  ProductSpu,
} from "../modules/productCenterApi";
import { ApiError } from "../api/client";
import { supplierSkuMappingApi } from "../modules/supplierSkuMappingApi";
import {
  BundleSkuSection,
  InventorySkuParentPickerDialog,
  ListingSection,
  ListingShopPicker,
  MasterProductFilters,
  Pagination,
  ProductDateTime,
  ProductWriteDialog,
  ShopifyCatalogImportDialog,
  SkuSection,
  SpuSection,
  SupplyPriceSection,
  dateEndExclusiveUtc8,
  dateStartUtc8,
  inventorySkuCsv,
  isValidProductId,
  isShopifyShop,
  loadAllPages,
  loadInventorySkuExportRows,
  loadMasterSpuExportRows,
  masterProductSearchFields,
  masterSpuInputFromCsv,
  masterSpuImageValidationError,
  parseMasterSpuCsv,
  parseProductCenterQuery,
  safeProductMessage,
  shouldLoadListingShopOptions,
  shouldLoadListings,
  shouldLoadSpus,
  skuReadScope,
  toProductCenterUrl,
  unsupportedProductViewUrl,
} from "./ProductCenterPage";
import { productCenterApi } from "../modules/productCenterApi";
import { productBundleApi } from "../modules/productBundleApi";
import { productSupplyPriceApi } from "../modules/productSupplyPriceApi";
import { inventoryApi } from "../modules/inventoryApi";
import { orderCenterApi } from "../modules/orderCenterApi";
import {
  type PlatformCatalogEntry,
  type TenantShop,
  shopCenterApi,
} from "../modules/shopCenterApi";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const activeShop: TenantShop = {
  id: "10000000-0000-4000-8000-000000000001",
  platformId: "20000000-0000-4000-8000-000000000001",
  externalShopRef: "STORE-1",
  displayName: "旗舰店",
  status: "ACTIVE",
  authorization: { status: "AUTHORIZED", credentialConfigured: true, scopes: [] },
  updatedAt: "2026-07-28T10:00:00Z",
};

const activePlatform: PlatformCatalogEntry = {
  id: "20000000-0000-4000-8000-000000000001",
  code: "SHOPIFY",
  displayName: "Shopify",
  status: "ACTIVE",
};

const listingSku = {
  id: "40000000-0000-4000-8000-000000000001",
  businessCode: "SKU_LOCAL_001",
  name: "本地库存商品",
};

function page<T>(items: T[]) {
  return { items, page: 0, size: 200, totalElements: items.length, totalPages: 1 };
}

describe("ProductCenterPage helpers", () => {
  it("requires images for create imports while keeping update images optional", () => {
    expect(masterSpuImageValidationError("create", 0)).toBe("新建主商品时至少选择 1 张商品图片。");
    expect(masterSpuImageValidationError("create", 1)).toBeUndefined();
    expect(masterSpuImageValidationError("update", 0)).toBeUndefined();
  });
  it("matches the archived master-product search labels", () => {
    expect(masterProductSearchFields).toEqual([
      ["ALL", "全部字段"],
      ["MASTER_CODE", "按主 SKU 编号"],
      ["NAME_ZH", "按中文名"],
      ["NAME_EN", "按英文名"],
      ["INVENTORY_SKU", "按库存 SKU"],
    ]);
  });

  it("renders valid update times semantically and invalid values safely", () => {
    const value = "2026-07-28T10:00:00Z";
    const expected = new Intl.DateTimeFormat("zh-CN", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(value));
    const { rerender } = render(<ProductDateTime value={value} />);

    const time = screen.getByText(expected).closest("time");
    expect(time?.getAttribute("dateTime")).toBe(value);

    rerender(<ProductDateTime value="not-a-date" />);
    expect(screen.getByText("—").closest("time")).toBeNull();

    rerender(<ProductDateTime />);
    expect(screen.getByText("—").closest("time")).toBeNull();
  });

  it("converts archived UTC+8 date boundaries to exclusive instants", () => {
    expect(dateStartUtc8("2026-07-01"))
      .toBe("2026-06-30T16:00:00.000Z");
    expect(dateEndExclusiveUtc8("2026-07-31"))
      .toBe("2026-07-31T16:00:00.000Z");
    expect(dateStartUtc8()).toBeUndefined();
    expect(dateEndExclusiveUtc8()).toBeUndefined();
  });

  it("renders signed warehouse inventory totals without failing the master list", () => {
    const item: ProductSpu = {
      id: "10000000-0000-4000-8000-000000000001",
      businessCode: "SPU_NEGATIVE",
      name: "负库存商品",
      volumetricDivisor: 5000,
      sensitiveAttributeCodes: [],
      status: "ACTIVE",
      skuSummary: { totalSkuCount: 1, activeSkuCount: 1 },
      metrics: {
        totalInventory: -3,
        sales7: 0,
        sales28: 0,
        sales42: 0,
        forecastDailySales: 0,
      },
      createdAt: "2026-07-28T10:00:00Z",
      updatedAt: "2026-07-28T10:00:00Z",
      version: 1,
    };
    render(<SpuSection
      state={{ status: "ready", data: { ...page([item]), size: 17 } }}
      canWrite={false}
      onEdit={vi.fn()}
      onView={vi.fn()}
      onSelect={vi.fn()}
      onCreateSku={vi.fn()}
      onRetry={vi.fn()}
      onPageChange={vi.fn()}
      onPageSizeChange={vi.fn()}
      categories={[]}
      packages={[]}
      sortBy="BUSINESS_CODE"
      descending={false}
      onSort={vi.fn()}
    />);

    expect(screen.getByText("-3")).not.toBeNull();
    for (const heading of [
      "缩略图",
      "商品中文/英文名称",
      "关联子 SKU 总库存量",
      "子 SKU 种类数",
    ]) {
      expect(screen.getByRole("columnheader", { name: heading })).toBeTruthy();
    }
    expect(screen.getByRole("columnheader", { name: /^主 SKU/ })).toBeTruthy();
    expect(screen.getByText(/^销量（7\/28\/42）/)).toBeTruthy();
    expect(screen.getByText(/^预测日销量/)).toBeTruthy();
    expect(screen.getByLabelText("每页")).toHaveProperty("value", "17");
  });

  it("exposes the archived master row actions without inventing delete behavior", () => {
    const item: ProductSpu = {
      id: "10000000-0000-4000-8000-000000000001",
      businessCode: "SPU_ACTIONS",
      name: "操作入口商品",
      volumetricDivisor: 5000,
      sensitiveAttributeCodes: [],
      status: "ACTIVE",
      skuSummary: { totalSkuCount: 1, activeSkuCount: 1 },
      createdAt: "2026-07-28T10:00:00Z",
      updatedAt: "2026-07-28T10:00:00Z",
      version: 1,
    };
    const onEdit = vi.fn();
    const onSelect = vi.fn();
    const onCreateSku = vi.fn();
    const onPageChange = vi.fn();
    render(<SpuSection
      state={{
        status: "ready",
        data: {
          ...page([item]),
          page: 1,
          size: 25,
          totalElements: 51,
          totalPages: 3,
        },
      }}
      canWrite
      onEdit={onEdit}
      onView={vi.fn()}
      onSelect={onSelect}
      onCreateSku={onCreateSku}
      onRetry={vi.fn()}
      onPageChange={onPageChange}
      onPageSizeChange={vi.fn()}
      categories={[]}
      packages={[]}
      sortBy="BUSINESS_CODE"
      descending={false}
      onSort={vi.fn()}
    />);

    fireEvent.click(screen.getByRole("button", { name: "关联子 SKU" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.click(screen.getByRole("button", { name: "创建子 SKU" }));
    fireEvent.click(screen.getByRole("button", { name: "首页" }));
    fireEvent.click(screen.getByRole("button", { name: "末页" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "选择主商品 SPU_ACTIONS" }));
    fireEvent.click(screen.getByRole("button", { name: "批量修改主 SKU" }));

    expect(onSelect).toHaveBeenCalledWith(item.id);
    expect(onEdit).toHaveBeenCalledWith(item);
    expect(onCreateSku).toHaveBeenCalledWith(item);
    expect(onPageChange).toHaveBeenNthCalledWith(1, 0);
    expect(onPageChange).toHaveBeenNthCalledWith(2, 2);
    expect(screen.getByText(/共 51 条，当前显示第\s*26-\s*50 条，\s*2\/3 页/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "删除" })).toBeNull();
    expect(screen.getByRole("checkbox", { name: "商品备注" })).toBeTruthy();
  });

  it("keeps the standalone inventory SKU table structure visible when empty", () => {
    const categoryId = "10000000-0000-4000-8000-000000000001";
    const creatorId = "10000000-0000-4000-8000-000000000006";
    const onRetry = vi.fn();
    const onFilter = vi.fn();
    const onSort = vi.fn();
    const onInventoryQuery = vi.fn();
    const onExport = vi.fn();
    const { container } = render(
      <SkuSection
        state={{ status: "ready", data: page([]) }}
        title="库存 SKU 身份"
        description="租户级 SKU 身份目录。"
        standalone
        showSpuIdentity
        canWrite={false}
        canWriteListings={false}
        canReadListingShops={false}
        canReadSuppliers
        keyword=""
        searchField="INVENTORY_SKU"
        matchMode="STARTS_WITH"
        categories={[{
          id: categoryId,
          name: "服装",
          sortOrder: 1,
          status: "ACTIVE",
          createdAt: "2026-07-01T00:00:00Z",
          updatedAt: "2026-07-01T00:00:00Z",
          version: 0,
        }]}
        members={[
          { id: creatorId, displayName: "创建人一号" },
        ]}
        referenceFiltersReady
        sortBy="BUSINESS_CODE"
        descending={false}
        onFilter={onFilter}
        onEdit={vi.fn()}
        onCreate={vi.fn()}
        onMap={vi.fn()}
        onSort={onSort}
        onRetry={onRetry}
        onPageChange={vi.fn()}
        onInventoryQuery={onInventoryQuery}
        onExport={onExport}
        toolbarActions={<button type="button">更多主数据</button>}
      />,
    );

    expect(screen.getByRole("table", { name: "库存 SKU 列表" })).toBeTruthy();
    expect(screen.getByText("没有符合筛选条件的库存 SKU。")).toBeTruthy();
    expect(screen.getByPlaceholderText("双击可批量查询")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "全部字段" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "默认供应商" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "原厂 SKU" })).toBeTruthy();
    expect(screen.getByText("SKU 状态：")).toBeTruthy();
    const advancedSummary = screen.getByRole("button", { name: /高级搜索/ });
    expect(advancedSummary.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByLabelText("SKU 分页")).toBeNull();
    expect(
      screen.getByRole("button", { name: "更多主数据" }),
    ).toBeTruthy();
    fireEvent.click(advancedSummary);
    expect(advancedSummary.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("dialog", { name: "高级搜索" })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "全部字段" }));
    expect(screen.getByLabelText("匹配方式")).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByLabelText("匹配方式")).toHaveProperty(
      "value",
      "CONTAINS",
    );
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    expect(onFilter).toHaveBeenCalledWith(
      undefined,
      "",
      "ALL",
      "CONTAINS",
      undefined,
      undefined,
      undefined,
      undefined,
    );
    fireEvent.click(screen.getByRole("radio", { name: "英文名称" }));
    expect(screen.getByLabelText("匹配方式")).toHaveProperty(
      "disabled",
      false,
    );
    fireEvent.change(screen.getByLabelText("关键词"), {
      target: { value: "Widget" },
    });
    fireEvent.change(screen.getByLabelText("匹配方式"), {
      target: { value: "ENDS_WITH" },
    });
    fireEvent.change(screen.getByLabelText("商品目录："), {
      target: { value: categoryId },
    });
    fireEvent.change(screen.getByLabelText("商品创建人："), {
      target: { value: creatorId },
    });
    fireEvent.change(screen.getByLabelText("库存 SKU 创建开始"), {
      target: { value: "2026-07-01" },
    });
    fireEvent.change(screen.getByLabelText("库存 SKU 创建结束"), {
      target: { value: "2026-07-31" },
    });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    expect(onFilter).toHaveBeenCalledWith(
      undefined,
      "Widget",
      "NAME_EN",
      "ENDS_WITH",
      categoryId,
      creatorId,
      "2026-07-01",
      "2026-07-31",
    );
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    expect(onRetry).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "SKU 库存查询" }));
    expect(onInventoryQuery).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "导出搜索的全部记录" }));
    expect(onExport).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByLabelText("库存 SKU 排序"), {
      target: { value: "CREATED_AT" },
    });
    expect(onSort).toHaveBeenCalledWith("CREATED_AT", false);
    fireEvent.click(
      screen.getByRole("button", {
        name: "库存 SKU 当前升序，切换为降序",
      }),
    );
    expect(onSort).toHaveBeenCalledWith("BUSINESS_CODE", true);
  });

  it("disables duplicate inventory SKU exports while one is running", () => {
    const onExport = vi.fn();
    render(
      <SkuSection
        state={{ status: "ready", data: page([]) }}
        title="库存 SKU 身份"
        description="租户级 SKU 身份目录。"
        standalone
        canWrite={false}
        canWriteListings={false}
        canReadListingShops={false}
        keyword=""
        onFilter={vi.fn()}
        onEdit={vi.fn()}
        onCreate={vi.fn()}
        onMap={vi.fn()}
        onRetry={vi.fn()}
        onPageChange={vi.fn()}
        onExport={onExport}
        exportBusy
      />,
    );

    const button = screen.getByRole("button", { name: "正在导出…" });
    expect(button).toHaveProperty("disabled", true);
    expect(screen.queryByRole("radio", { name: "原厂 SKU" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "默认供应商" })).toBeNull();
    expect(screen.getByRole("status").textContent).toContain(
      "正在导出库存 SKU…",
    );
    fireEvent.click(button);
    expect(onExport).not.toHaveBeenCalled();
  });

  it("customizes and persists existing inventory SKU list fields", async () => {
    const item: ProductSku = {
      id: "10000000-0000-4000-8000-000000000001",
      spuId: "20000000-0000-4000-8000-000000000001",
      masterSku: {
        id: "20000000-0000-4000-8000-000000000001",
        businessCode: "MASTER_SHIRT",
        name: "衬衫",
        brandName: "示例品牌",
        category: {
          id: "40000000-0000-4000-8000-000000000001",
          displayName: "服装",
        },
        actualWeightGrams: 320,
        lengthMm: 300,
        widthMm: 200,
        heightMm: 40,
        packageMaterial: {
          id: "90000000-0000-4000-8000-000000000001",
          displayName: "纸箱",
        },
        packageableCount: 2,
      },
      businessCode: "SKU_BLUE_M",
      name: "蓝色衬衫",
      nameEn: "Blue shirt",
      variantSummary: "蓝色 / M",
      unitCost: "15.00",
      currencyCode: "CNY",
      defaultWarehouse: {
        id: "30000000-0000-4000-8000-000000000001",
        displayName: "深圳仓",
      },
      creatorName: "创建用户",
      status: "ACTIVE",
      createdAt: "2026-07-28T09:00:00Z",
      updatedAt: "2026-07-28T10:00:00Z",
      version: 1,
    };
    vi.spyOn(
      supplierSkuMappingApi,
      "listPreferredSummaries",
    ).mockResolvedValue([{
      skuId: item.id,
      supplierSkuCode: "FACTORY_BLUE_M",
      supplierId: "91000000-0000-4000-8000-000000000001",
      supplierBusinessCode: "SUP_ONE",
      supplierName: "默认供应商",
    }]);
    vi.spyOn(
      productCenterApi,
      "listSkuListingSummaries",
    ).mockResolvedValue([{
      skuId: item.id,
      activeListingCount: 3,
    }]);
    render(
      <SkuSection
        state={{ status: "ready", data: page([item]) }}
        title="库存 SKU 身份"
        description="租户级 SKU 身份目录。"
        standalone
        showSpuIdentity
        canWrite={false}
        canWriteListings={false}
        canReadListingShops={false}
        canReadSuppliers
        canReadListings
        keyword=""
        searchField="INVENTORY_SKU"
        onFilter={vi.fn()}
        onEdit={vi.fn()}
        onCreate={vi.fn()}
        onMap={vi.fn()}
        onRetry={vi.fn()}
        onPageChange={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "自定义列表字段" }),
    );
    const dialog = screen.getByRole("dialog", { name: "自定义列表字段" });
    expect(dialog).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "英文名" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "统一成本价" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(screen.queryByRole("columnheader", { name: "英文名" })).toBeNull();
    expect(
      screen.queryByRole("columnheader", { name: "统一成本价" }),
    ).toBeNull();
    expect(
      screen.getByRole("columnheader", { name: "库存 SKU" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("columnheader", { name: "库存总量" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("columnheader", { name: "锁定库存" }),
    ).toBeTruthy();
    expect(screen.getByText("MASTER_SHIRT")).toBeTruthy();
    expect(screen.getByText("示例品牌")).toBeTruthy();
    expect(screen.getByText("服装")).toBeTruthy();
    expect(screen.getByText("320 g")).toBeTruthy();
    expect(screen.getByText("300 × 200 × 40 mm")).toBeTruthy();
    expect(screen.getByText("纸箱")).toBeTruthy();
    expect(screen.getByText("创建用户")).toBeTruthy();
    expect(await screen.findByText("SUP_ONE · 默认供应商")).toBeTruthy();
    expect(screen.getByText("FACTORY_BLUE_M")).toBeTruthy();
    expect(
      (await screen.findByLabelText("已配对在线商品数量")).textContent,
    ).toBe("3");
    expect(screen.queryByText(item.spuId)).toBeNull();
    expect(
      JSON.parse(
        window.localStorage.getItem(
          "xz.erp.products.inventorySku.visibleColumns.v1",
        ) ?? "null",
      ),
    ).not.toContain("nameEn");
  });

  it("loads one protected thumbnail for inventory SKUs sharing a master SKU", async () => {
    const masterId = "20000000-0000-4000-8000-000000000001";
    const thumbnailImageId = "40000000-0000-4000-8000-000000000001";
    const inventorySku = (
      id: string,
      businessCode: string,
    ): ProductSku => ({
      id,
      spuId: masterId,
      masterSku: {
        id: masterId,
        businessCode: "MASTER_SHIRT",
        name: "衬衫",
        thumbnailImageId,
      },
      businessCode,
      name: businessCode,
      status: "ACTIVE",
      createdAt: "2026-07-28T09:00:00Z",
      updatedAt: "2026-07-28T10:00:00Z",
      version: 1,
    });
    const getImage = vi
      .spyOn(productCenterApi, "getSpuImageBlob")
      .mockResolvedValue(new Blob(["image"], { type: "image/png" }));
    const createObjectUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:inventory-thumbnail");
    const revokeObjectUrl = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);

    const rendered = render(
      <SkuSection
        state={{
          status: "ready",
          data: page([
            inventorySku(
              "10000000-0000-4000-8000-000000000001",
              "SKU_BLUE_M",
            ),
            inventorySku(
              "10000000-0000-4000-8000-000000000002",
              "SKU_BLUE_L",
            ),
          ]),
        }}
        title="库存 SKU 身份"
        description="租户级 SKU 身份目录。"
        standalone
        showSpuIdentity
        canWrite={false}
        canWriteListings={false}
        canReadListingShops={false}
        keyword=""
        searchField="INVENTORY_SKU"
        onFilter={vi.fn()}
        onEdit={vi.fn()}
        onCreate={vi.fn()}
        onMap={vi.fn()}
        onRetry={vi.fn()}
        onPageChange={vi.fn()}
      />,
    );

    const images = await screen.findAllByRole("img", { name: "衬衫 图片" });
    expect(images).toHaveLength(2);
    expect(images[0]?.getAttribute("src")).toBe("blob:inventory-thumbnail");
    expect(getImage).toHaveBeenCalledOnce();
    expect(getImage).toHaveBeenCalledWith(masterId, thumbnailImageId);
    expect(createObjectUrl).toHaveBeenCalledOnce();

    rendered.unmount();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:inventory-thumbnail");
  });

  it("loads warehouse-scoped inventory summaries only with inventory permission", async () => {
    const item: ProductSku = {
      id: "10000000-0000-4000-8000-000000000001",
      spuId: "20000000-0000-4000-8000-000000000001",
      masterSku: {
        id: "20000000-0000-4000-8000-000000000001",
        businessCode: "MASTER_SHIRT",
        name: "衬衫",
      },
      businessCode: "SKU_BLUE_M",
      name: "蓝色衬衫",
      status: "ACTIVE",
      createdAt: "2026-07-28T09:00:00Z",
      updatedAt: "2026-07-28T10:00:00Z",
      version: 1,
    };
    const summaries = vi
      .spyOn(inventoryApi, "listSkuSummaries")
      .mockResolvedValue([
        {
          skuId: item.id,
          onHand: -2,
          reserved: 3,
          available: -5,
        },
      ]);

    render(
      <SkuSection
        state={{ status: "ready", data: page([item]) }}
        title="库存 SKU 身份"
        description="租户级 SKU 身份目录。"
        standalone
        showSpuIdentity
        canWrite={false}
        canWriteListings={false}
        canReadListingShops={false}
        canReadInventory
        keyword=""
        searchField="INVENTORY_SKU"
        onFilter={vi.fn()}
        onEdit={vi.fn()}
        onCreate={vi.fn()}
        onMap={vi.fn()}
        onRetry={vi.fn()}
        onPageChange={vi.fn()}
      />,
    );

    expect(await screen.findByText("-5")).toBeTruthy();
    expect(screen.getByText("-2")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(summaries).toHaveBeenCalledOnce();
    expect(summaries).toHaveBeenCalledWith([item.id]);
  });

  it("loads 7/28/42 day SKU sales only with order read permission", async () => {
    const item: ProductSku = {
      id: "10000000-0000-4000-8000-000000000001",
      spuId: "20000000-0000-4000-8000-000000000001",
      masterSku: {
        id: "20000000-0000-4000-8000-000000000001",
        businessCode: "MASTER_SHIRT",
        name: "衬衫",
      },
      businessCode: "SKU_BLUE_M",
      name: "蓝色衬衫",
      status: "ACTIVE",
      createdAt: "2026-07-28T09:00:00Z",
      updatedAt: "2026-07-28T10:00:00Z",
      version: 1,
    };
    const summaries = vi
      .spyOn(orderCenterApi, "listSkuSalesSummaries")
      .mockResolvedValue([
        {
          skuId: item.id,
          sales7: 2,
          sales28: 5,
          sales42: 8,
        },
      ]);

    render(
      <SkuSection
        state={{ status: "ready", data: page([item]) }}
        title="库存 SKU 身份"
        description="租户级 SKU 身份目录。"
        standalone
        showSpuIdentity
        canWrite={false}
        canWriteListings={false}
        canReadListingShops={false}
        canReadOrders
        keyword=""
        searchField="INVENTORY_SKU"
        onFilter={vi.fn()}
        onEdit={vi.fn()}
        onCreate={vi.fn()}
        onMap={vi.fn()}
        onRetry={vi.fn()}
        onPageChange={vi.fn()}
      />,
    );

    expect(await screen.findByText("2 / 5 / 8")).toBeTruthy();
    expect(summaries).toHaveBeenCalledOnce();
    expect(summaries).toHaveBeenCalledWith([item.id]);
  });

  it("does not request protected SKU summaries without their permissions", () => {
    const summaries = vi.spyOn(
      orderCenterApi,
      "listSkuSalesSummaries",
    );
    const listingSummaries = vi.spyOn(
      productCenterApi,
      "listSkuListingSummaries",
    );
    const item: ProductSku = {
      id: "10000000-0000-4000-8000-000000000001",
      spuId: "20000000-0000-4000-8000-000000000001",
      masterSku: {
        id: "20000000-0000-4000-8000-000000000001",
        businessCode: "MASTER_SHIRT",
        name: "衬衫",
      },
      businessCode: "SKU_BLUE_M",
      name: "蓝色衬衫",
      status: "ACTIVE",
      createdAt: "2026-07-28T09:00:00Z",
      updatedAt: "2026-07-28T10:00:00Z",
      version: 1,
    };

    render(
      <SkuSection
        state={{ status: "ready", data: page([item]) }}
        title="库存 SKU 身份"
        description="租户级 SKU 身份目录。"
        standalone
        showSpuIdentity
        canWrite={false}
        canWriteListings={false}
        canReadListingShops={false}
        keyword=""
        searchField="INVENTORY_SKU"
        onFilter={vi.fn()}
        onEdit={vi.fn()}
        onCreate={vi.fn()}
        onMap={vi.fn()}
        onRetry={vi.fn()}
        onPageChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("需要订单读取权限").textContent)
      .toBe("无权限");
    expect(summaries).not.toHaveBeenCalled();
    expect(screen.getByLabelText("需要在线商品读取权限").textContent)
      .toBe("无权限");
    expect(listingSummaries).not.toHaveBeenCalled();
  });

  it("selects an active master SKU before creating an inventory SKU", async () => {
    const item: ProductSpu = {
      id: "10000000-0000-4000-8000-000000000001",
      businessCode: "MASTER_SHIRT",
      name: "衬衫",
      category: {
        id: "20000000-0000-4000-8000-000000000001",
        displayName: "服装",
      },
      volumetricDivisor: 5000,
      sensitiveAttributeCodes: [],
      status: "ACTIVE",
      skuSummary: { totalSkuCount: 0, activeSkuCount: 0 },
      createdAt: "2026-07-28T10:00:00Z",
      updatedAt: "2026-07-28T10:00:00Z",
      version: 1,
    };
    vi.spyOn(productCenterApi, "listSpus").mockResolvedValue(page([item]));
    const onSelect = vi.fn();
    render(
      <InventorySkuParentPickerDialog
        onClose={vi.fn()}
        onSelect={onSelect}
      />,
    );

    expect(
      await screen.findByRole("table", { name: "可选主 SKU 列表" }),
    ).toBeTruthy();
    expect(productCenterApi.listSpus).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ACTIVE", size: 50 }),
    );
    fireEvent.click(
      screen.getByRole("radio", { name: "选择主 SKU MASTER_SHIRT" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "下一步：填写库存 SKU" }),
    );

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(item));
  });

  it("creates an inventory SKU under the selected master SKU", async () => {
    const parentId = "10000000-0000-4000-8000-000000000001";
    const created: ProductSku = {
      id: "20000000-0000-4000-8000-000000000001",
      spuId: parentId,
      businessCode: "SKU_SHIRT_BLUE",
      name: "蓝色衬衫",
      status: "ACTIVE",
      createdAt: "2026-07-28T09:00:00Z",
      updatedAt: "2026-07-28T10:00:00Z",
      version: 0,
    };
    vi.spyOn(productCenterApi, "createSku").mockResolvedValue(created);
    const onSaved = vi.fn();
    render(
      <ProductWriteDialog
        editor={{ kind: "sku", action: "create" }}
        selectedSpuId={parentId}
        availableSkus={[]}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );

    fireEvent.change(screen.getByLabelText("业务编码"), {
      target: { value: "SKU_SHIRT_BLUE" },
    });
    fireEvent.change(screen.getByLabelText("名称"), {
      target: { value: "蓝色衬衫" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(productCenterApi.createSku).toHaveBeenCalledWith(
        parentId,
        expect.objectContaining({
          businessCode: "SKU_SHIRT_BLUE",
          name: "蓝色衬衫",
        }),
      ),
    );
    expect(onSaved).toHaveBeenCalledWith(created);
  });

  it("blocks a SKU cost without its currency before submitting", async () => {
    const create = vi.spyOn(productCenterApi, "createSku");
    render(
      <ProductWriteDialog
        editor={{ kind: "sku", action: "create" }}
        selectedSpuId="10000000-0000-4000-8000-000000000001"
        availableSkus={[]}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("业务编码"), { target: { value: "SKU_SHIRT_COST" } });
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "成本待补充商品" } });
    fireEvent.change(screen.getByLabelText("成本价"), { target: { value: "2.50" } });
    fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);

    expect(await screen.findByText("填写成本价后请选择币种。")).toBeTruthy();
    expect(create).not.toHaveBeenCalled();
  });

  it("bounds shareable filters and only retains valid selected SPU ids", () => {
    expect(
      parseProductCenterQuery(
        "?status=bad&keyword=" +
          "x".repeat(101) +
          "&page=-1&size=999&spuId=bad",
      ),
    ).toEqual(
      expect.objectContaining({
        status: undefined,
        keyword: "x".repeat(100),
        page: 0,
        size: 25,
        spuId: undefined,
      }),
    );
    const id = "10000000-0000-4000-8000-000000000001";
    expect(isValidProductId(id)).toBe(true);
    expect(
      toProductCenterUrl({
        status: "ACTIVE",
        keyword: "shoe",
        page: 1,
        size: 25,
        view: "master",
        spuId: id,
        skuKeyword: "",
        skuSearchField: "INVENTORY_SKU",
        skuMatchMode: "STARTS_WITH",
        skuSortBy: "BUSINESS_CODE",
        skuDescending: false,
        skuPage: 0,
        skuSize: 25,
        listingKeyword: "",
        listingSearchField: "ALL",
        listingPage: 0,
        listingSize: 25,
      }),
    ).toContain("spuId=" + id);
    expect(parseProductCenterQuery("?view=unknown").view).toBe("online");
    expect(parseProductCenterQuery("?view=bundle").view).toBe("bundle");
    expect(parseProductCenterQuery("?view=master").view).toBe("master");
    expect(parseProductCenterQuery("?view=inventory").view).toBe("inventory");
    expect(
      parseProductCenterQuery(
        "?view=inventory&skuSortBy=CREATED_AT&skuDescending=true",
      ),
    ).toEqual(expect.objectContaining({
      skuSortBy: "CREATED_AT",
      skuDescending: true,
    }));
    expect(
      toProductCenterUrl(parseProductCenterQuery(
        "?view=inventory&skuSortBy=CREATED_AT&skuDescending=true",
      )),
    ).toContain("skuSortBy=CREATED_AT&skuDescending=true");
    expect(
      parseProductCenterQuery(
        "?view=inventory&skuSortBy=SALES_42&skuDescending=invalid",
      ),
    ).toEqual(expect.objectContaining({
      skuSortBy: "BUSINESS_CODE",
      skuDescending: false,
    }));
    expect(
      parseProductCenterQuery(
        `?view=online&listingShopId=${id}`,
      ).listingShopId,
    ).toBe(id);
    expect(
      toProductCenterUrl({
        ...parseProductCenterQuery("?view=online"),
        listingShopId: id,
      }),
    ).toContain(`listingShopId=${id}`);
    expect(
      parseProductCenterQuery(
        "?view=online&listingShopId=not-a-shop-id",
      ).listingShopId,
    ).toBeUndefined();
    expect(
      parseProductCenterQuery(
        "?view=online&listingSearchField=UNKNOWN",
      ).listingSearchField,
    ).toBe("ALL");
    expect(
      toProductCenterUrl({
        ...parseProductCenterQuery("?view=online"),
        listingSearchField: "INVENTORY_SKU",
      }),
    ).toContain("listingSearchField=INVENTORY_SKU");
    expect(unsupportedProductViewUrl("?view=unknown&bundlePage=2")).toContain(
      "view=online",
    );
    expect(unsupportedProductViewUrl("?view=bundle")).toBeUndefined();
    expect(unsupportedProductViewUrl("?view=master")).toBeUndefined();
  });

  it("keeps the restored bundle SKU filters shareable without loading another product domain", () => {
    const parsed = parseProductCenterQuery(
      "?view=bundle&bundleKeyword=KIT-100&bundleStart=2026-07-01&bundleEnd=2026-07-31",
    );
    expect(parsed).toEqual(expect.objectContaining({
      view: "bundle",
      bundleKeyword: "KIT-100",
      bundleStart: "2026-07-01",
      bundleEnd: "2026-07-31",
    }));
    expect(toProductCenterUrl(parsed)).toBe(
      "/products?view=bundle&bundleKeyword=KIT-100&bundleStart=2026-07-01&bundleEnd=2026-07-31",
    );
    expect(skuReadScope("bundle")).toEqual({ load: false });
    expect(shouldLoadSpus("bundle")).toBe(false);
    expect(shouldLoadListings(true, "bundle")).toBe(false);
  });

  it("renders the real bundle SKU workbench and keeps URL filters independent", async () => {
    vi.spyOn(productBundleApi, "list").mockResolvedValue({
      items: [], page: 0, size: 25, totalElements: 0, totalPages: 0,
    });
    const onFilter = vi.fn();
    render(
      <BundleSkuSection
        keyword="KIT-100"
        start="2026-07-01"
        end="2026-07-31"
        onFilter={onFilter}
      />,
    );

    expect(screen.getByRole("heading", { name: "组合 SKU" })).toBeTruthy();
    expect(await screen.findByText("暂无组合 SKU")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "组合SKU设置" })).toBeNull();
    expect(screen.queryByRole("button", { name: "添加/导出" })).toBeNull();
    fireEvent.change(screen.getByLabelText("组合 SKU 搜索内容"), {
      target: { value: " KIT-200 " },
    });
    fireEvent.change(screen.getByLabelText("组合 SKU 起始日期"), {
      target: { value: "2026-07-02" },
    });
    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    expect(onFilter).toHaveBeenCalledWith(
      "KIT-200",
      "2026-07-02",
      "2026-07-31",
    );
  });

  it("keeps the restored supply-price filters independent from cost and order prices", () => {
    const parsed = parseProductCenterQuery(
      "?view=supply-price&supplyPriceKeyword=SKU-100&supplyPriceSkuType=INVENTORY&supplyPriceCountry=DE",
    );
    expect(parsed).toEqual(expect.objectContaining({
      view: "supply-price",
      supplyPriceKeyword: "SKU-100",
      supplyPriceSkuType: "INVENTORY",
      supplyPriceCountry: "DE",
    }));
    expect(toProductCenterUrl(parsed)).toBe(
      "/products?view=supply-price&supplyPriceKeyword=SKU-100" +
        "&supplyPriceSkuType=INVENTORY&supplyPriceCountry=DE",
    );
    expect(skuReadScope("supply-price")).toEqual({ load: false });
  });

  it("keeps the inventory report URL bounded to supported filters", () => {
    const report = parseProductCenterQuery(
      "?view=inventory-report&reportKeyword=SKU-1&reportStart=2026-07-01" +
        "&reportEnd=2026-07-31&reportMin=10&reportMax=20",
    );
    expect(toProductCenterUrl(report)).toBe(
      "/products?view=inventory-report&reportKeyword=SKU-1" +
        "&reportStart=2026-07-01&reportEnd=2026-07-31",
    );
    const exceptions = parseProductCenterQuery(
      "?view=sync-exceptions&syncPlatform=SHOPIFY&syncShop=旗舰店" +
        "&syncStart=2026-07-01&syncEnd=2026-07-31&syncKeyword=failed",
    );
    expect(toProductCenterUrl(exceptions)).toContain(
      "view=sync-exceptions&syncPlatform=SHOPIFY",
    );
    expect(exceptions).toEqual(expect.objectContaining({
      syncShop: "旗舰店",
      syncKeyword: "failed",
    }));
    const agingWarehouseId = "a3000000-0000-4000-8000-000000000002";
    const aging = parseProductCenterQuery(
      `?view=aging&agingKeyword=SKU-2&agingCutoff=2026-08-10&agingWarehouseId=${agingWarehouseId}`,
    );
    expect(toProductCenterUrl(aging)).toBe(
      "/products?view=aging&agingKeyword=SKU-2&agingCutoff=2026-08-10" +
        `&agingWarehouseId=${agingWarehouseId}`,
    );
    const syncRuleShopId = "b3000000-0000-4000-8000-000000000003";
    const syncRules = parseProductCenterQuery(
      `?view=sync-rules&syncShop=${syncRuleShopId}`,
    );
    expect(syncRules.view).toBe("sync-rules");
    expect(toProductCenterUrl(syncRules)).toBe(
      `/products?view=sync-rules&syncShop=${syncRuleShopId}`,
    );
    expect(skuReadScope("inventory-report")).toEqual({ load: false });
    expect(skuReadScope("sync-exceptions")).toEqual({ load: false });
  });

  it("renders a functional supply-price catalog with typed filters", async () => {
    vi.spyOn(productSupplyPriceApi, "list").mockResolvedValue({
      items: [], page: 0, size: 25, totalElements: 0, totalPages: 0,
    });
    const onFilter = vi.fn();
    render(
      <SupplyPriceSection
        keyword="SKU-100"
        skuType="INVENTORY"
        country="DE"
        canWrite
        onFilter={onFilter}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "商品供货价管理" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "新增供货价" }))
      .toHaveProperty("disabled", false);
    expect(screen.getByRole("button", { name: "导出筛选结果" }))
      .toHaveProperty("disabled", false);
    expect(await screen.findByText("暂无商品供货价")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("供货价搜索内容"), {
      target: { value: " SKU-200 " },
    });
    fireEvent.change(screen.getByLabelText("供货价销售国家"), {
      target: { value: "FR" },
    });
    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    expect(onFilter).toHaveBeenCalledWith("SKU-200", "INVENTORY", "FR");
  });

  it("keeps master SKU field filters and whitelisted ordering in the shareable URL", () => {
    const categoryId = "10000000-0000-4000-8000-000000000001";
    const parsed = parseProductCenterQuery(
      `?view=master&searchField=INVENTORY_SKU&categoryId=${categoryId}&developerMemberId=10000000-0000-4000-8000-000000000002&createdFrom=2026-07-01&createdTo=2026-07-31&sortBy=FORECAST_DAILY_SALES&descending=true`,
    );
    expect(parsed).toEqual(expect.objectContaining({
      searchField: "INVENTORY_SKU", categoryId,
      createdFrom: "2026-07-01", createdTo: "2026-07-31",
      sortBy: "FORECAST_DAILY_SALES", descending: true,
    }));
    expect(toProductCenterUrl(parsed)).toContain("searchField=INVENTORY_SKU");
    expect(toProductCenterUrl(parsed)).not.toContain("developerMemberId");
    expect(toProductCenterUrl(parsed)).toContain("sortBy=FORECAST_DAILY_SALES");
    expect(parseProductCenterQuery("?view=master&sortBy=SALES_42").sortBy)
      .toBe("SALES_42");
  });

  it("submits the supported creator filter with the member directory", () => {
    const creatorId =
      "10000000-0000-4000-8000-000000000002";
    const onApply = vi.fn();
    render(
      <MasterProductFilters
        query={parseProductCenterQuery("?view=master")}
        categories={[]}
        members={[{ id: creatorId, displayName: "创建人一号" }]}
        onApply={onApply}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /高级搜索/ }));
    fireEvent.change(screen.getByLabelText("创建人员："), {
      target: { value: creatorId },
    });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));

    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({
      creatorId,
    }));
  });

  it("keeps only supported inventory SKU search fields and match modes in the shareable URL", () => {
    const categoryId = "10000000-0000-4000-8000-000000000001";
    const creatorId = "10000000-0000-4000-8000-000000000006";
    const parsed = parseProductCenterQuery(
      `?view=inventory&skuSearchField=NAME_EN&skuMatchMode=ENDS_WITH&skuKeyword=widget&categoryId=${categoryId}&developerMemberId=10000000-0000-4000-8000-000000000002&developerAssistantMemberId=10000000-0000-4000-8000-000000000003&salesMemberId=10000000-0000-4000-8000-000000000004&artMemberId=10000000-0000-4000-8000-000000000005&skuCreatorId=${creatorId}&skuCreatedFrom=2026-07-01&skuCreatedTo=2026-07-31`,
    );
    expect(parsed.skuSearchField).toBe("NAME_EN");
    expect(parsed.skuMatchMode).toBe("ENDS_WITH");
    expect(toProductCenterUrl(parsed)).toContain("skuSearchField=NAME_EN");
    expect(toProductCenterUrl(parsed)).toContain("skuMatchMode=ENDS_WITH");
    expect(toProductCenterUrl(parsed)).toContain(`categoryId=${categoryId}`);
    expect(toProductCenterUrl(parsed)).not.toContain("developerMemberId");
    expect(toProductCenterUrl(parsed)).not.toContain("developerAssistantMemberId");
    expect(toProductCenterUrl(parsed)).not.toContain("salesMemberId");
    expect(toProductCenterUrl(parsed)).not.toContain("artMemberId");
    expect(toProductCenterUrl(parsed)).toContain(`skuCreatorId=${creatorId}`);
    expect(toProductCenterUrl(parsed)).toContain("skuCreatedFrom=2026-07-01");
    expect(toProductCenterUrl(parsed)).toContain("skuCreatedTo=2026-07-31");
    expect(
      parseProductCenterQuery(
        "?view=inventory&skuSearchField=DEFAULT_SUPPLIER",
      ).skuSearchField,
    ).toBe("DEFAULT_SUPPLIER");
    expect(
      parseProductCenterQuery(
        "?view=inventory&skuSearchField=ORIGINAL_SKU",
      ).skuSearchField,
    ).toBe("ORIGINAL_SKU");
    const allFields = parseProductCenterQuery(
      "?view=inventory&skuSearchField=ALL&skuMatchMode=CONTAINS",
    );
    expect(allFields.skuSearchField).toBe("ALL");
    expect(allFields.skuMatchMode).toBe("CONTAINS");
    expect(toProductCenterUrl(allFields)).toContain("skuSearchField=ALL");
    expect(
      parseProductCenterQuery(
        "?view=inventory&skuMatchMode=REGEX",
      ).skuMatchMode,
    ).toBe("STARTS_WITH");
    expect(
      toProductCenterUrl(
        parseProductCenterQuery("?view=inventory"),
      ),
    ).not.toContain("skuSearchField");
    expect(
      toProductCenterUrl(
        parseProductCenterQuery("?view=inventory"),
      ),
    ).not.toContain("skuMatchMode");
  });

  it("parses the complete master SKU CSV fields and rejects unsafe controlled references", () => {
    const categoryId = "10000000-0000-4000-8000-000000000001";
    const packageId = "20000000-0000-4000-8000-000000000001";
    const [row] = parseMasterSpuCsv([
      "businessCode,nameZh,nameEn,categoryId,lengthMm,widthMm,heightMm,actualWeightGrams,volumetricDivisor,packageMaterialId,packageableCount,sensitiveAttributeCodes",
      `MASTER_100,中文名,English,${categoryId},100,50,20,300,6000,${packageId},2,BATTERY;MAGNETIC`,
    ].join("\n"));
    expect(masterSpuInputFromCsv(row)).toMatchObject({
      businessCode: "MASTER_100", categoryId, lengthMm: 100, widthMm: 50,
      heightMm: 20, actualWeightGrams: 300, volumetricDivisor: 6000,
      packageMaterialId: packageId, packageableCount: 2,
      sensitiveAttributeCodes: ["BATTERY", "MAGNETIC"],
    });
    const [unsafe] = parseMasterSpuCsv("businessCode,nameZh,categoryId\nMASTER_101,中文名,not-an-id");
    expect(() => masterSpuInputFromCsv(unsafe)).toThrow("商品目录 必须是模板中导出的标识");
  });

  it("exports bounded inventory SKU fields with spreadsheet formula protection", () => {
    const output = inventorySkuCsv([{
      id: "10000000-0000-4000-8000-000000000001",
      spuId: "20000000-0000-4000-8000-000000000001",
      masterSku: {
        id: "20000000-0000-4000-8000-000000000001",
        businessCode: "MASTER_100",
        name: "主商品",
      },
      businessCode: "SKU_100",
      name: "=危险公式",
      status: "ACTIVE",
      createdAt: "2026-07-28T09:00:00Z",
      updatedAt: "2026-07-28T10:00:00Z",
      version: 3,
    }]);

    expect(output.startsWith("\uFEFFid,version,businessCode,nameZh"))
      .toBe(true);
    expect(output).toContain("SKU_100,'=危险公式,");
    expect(output).toContain("MASTER_100");
    expect(output).not.toContain("createdAt");
  });

  it("loads stable product export pages and rejects duplicate identities", async () => {
    const firstSku: ProductSku = {
      id: "10000000-0000-4000-8000-000000000001",
      spuId: "20000000-0000-4000-8000-000000000001",
      businessCode: "SKU_100",
      name: "库存商品一",
      status: "ACTIVE",
      createdAt: "2026-07-28T09:00:00Z",
      updatedAt: "2026-07-28T10:00:00Z",
      version: 1,
    };
    const secondSku: ProductSku = {
      ...firstSku,
      id: "10000000-0000-4000-8000-000000000002",
      businessCode: "SKU_101",
      name: "库存商品二",
    };
    vi.spyOn(productCenterApi, "listSkus")
      .mockResolvedValueOnce({
        items: [firstSku],
        page: 0,
        size: 200,
        totalElements: 2,
        totalPages: 2,
      })
      .mockResolvedValueOnce({
        items: [secondSku],
        page: 1,
        size: 200,
        totalElements: 2,
        totalPages: 2,
      });

    await expect(loadInventorySkuExportRows({ keyword: "SKU" }))
      .resolves.toEqual([firstSku, secondSku]);
    expect(productCenterApi.listSkus).toHaveBeenNthCalledWith(2, {
      keyword: "SKU",
      page: 1,
      size: 200,
    });

    const master: ProductSpu = {
      id: "20000000-0000-4000-8000-000000000001",
      businessCode: "MASTER_100",
      name: "主商品",
      volumetricDivisor: 5000,
      sensitiveAttributeCodes: [],
      status: "ACTIVE",
      skuSummary: { totalSkuCount: 1, activeSkuCount: 1 },
      createdAt: "2026-07-28T09:00:00Z",
      updatedAt: "2026-07-28T10:00:00Z",
      version: 1,
    };
    vi.spyOn(productCenterApi, "listSpus")
      .mockResolvedValueOnce({
        items: [master],
        page: 0,
        size: 200,
        totalElements: 2,
        totalPages: 2,
      })
      .mockResolvedValueOnce({
        items: [master],
        page: 1,
        size: 200,
        totalElements: 2,
        totalPages: 2,
      });
    await expect(loadMasterSpuExportRows({}))
      .rejects.toThrow("导出的主 SKU数据已发生变化，请刷新后重试。");
  });

  it("loads complete bounded reference directories and rejects duplicates", async () => {
    const first = { id: "10000000-0000-4000-8000-000000000001" };
    const second = { id: "10000000-0000-4000-8000-000000000002" };
    const stablePage = vi.fn()
      .mockResolvedValueOnce({
        items: [first],
        page: 0,
        size: 200,
        totalElements: 2,
        totalPages: 2,
      })
      .mockResolvedValueOnce({
        items: [second],
        page: 1,
        size: 200,
        totalElements: 2,
        totalPages: 2,
      });

    await expect(loadAllPages(stablePage, () => true))
      .resolves.toEqual([first, second]);
    expect(stablePage).toHaveBeenNthCalledWith(2, 1);

    const duplicatePage = vi.fn()
      .mockResolvedValueOnce({
        items: [first],
        page: 0,
        size: 200,
        totalElements: 2,
        totalPages: 2,
      })
      .mockResolvedValueOnce({
        items: [first],
        page: 1,
        size: 200,
        totalElements: 2,
        totalPages: 2,
      });
    await expect(loadAllPages(duplicatePage, () => true))
      .rejects.toThrow("目录分页结果不一致，请刷新后重试。");
  });

  it("does not load or render listing data without products.listing.read", () => {
    expect(shouldLoadListings(false)).toBe(false);
    expect(shouldLoadListings(true, "master")).toBe(false);
    expect(shouldLoadListings(true, "online")).toBe(true);
    expect(shouldLoadSpus("master")).toBe(true);
    expect(skuReadScope("master")).toEqual({ load: false });
    expect(
      skuReadScope("master", "10000000-0000-4000-8000-000000000001"),
    ).toEqual({
      load: true,
      spuId: "10000000-0000-4000-8000-000000000001",
    });
    expect(skuReadScope("inventory")).toEqual({
      load: true,
      spuId: undefined,
    });
    expect(skuReadScope("bundle")).toEqual({ load: false });
    render(
      <ListingSection
        state={{ status: "not-permitted" }}
        canWrite={false}
        canReadListingShops={false}
        keyword=""
        onFilter={vi.fn()}
        onEdit={vi.fn()}
        onCreate={vi.fn()}
        onImported={vi.fn()}
        onRetry={vi.fn()}
        onPageChange={vi.fn()}
      />,
    );
    expect(
      screen.getByText("当前账号没有读取在线商品映射的权限。"),
    ).toBeTruthy();
  });

  it("keeps the online-product table visible when empty and applies a safe shop filter", () => {
    const onFilter = vi.fn();
    const onRetry = vi.fn();
    render(
      <ListingSection
        state={{ status: "ready", data: page([]) }}
        shopOptions={{
          status: "ready",
          data: {
            shops: [activeShop],
            platforms: new Map([[activePlatform.id, activePlatform]]),
          },
        }}
        canWrite
        canReadListingShops
        keyword=""
        searchField="ALL"
        onFilter={onFilter}
        onEdit={vi.fn()}
        onCreate={vi.fn()}
        onImported={vi.fn()}
        onRetry={onRetry}
        onPageChange={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("table", { name: "在线商品匹配列表" }),
    ).toBeTruthy();
    expect(
      screen.getByText("当前没有符合筛选条件的在线商品映射。"),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("店铺："), {
      target: { value: activeShop.id },
    });
    fireEvent.change(screen.getByLabelText("搜索字段："), {
      target: { value: "INVENTORY_SKU" },
    });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    expect(onFilter).toHaveBeenCalledWith(
      activeShop.id,
      undefined,
      "INVENTORY_SKU",
      "",
    );
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("shows only functional online actions and opens Shopify catalog import", () => {
    const onCreate = vi.fn();
    render(
      <ListingSection
        state={{ status: "ready", data: page([]) }}
        shopOptions={{
          status: "ready",
          data: {
            shops: [activeShop],
            platforms: new Map([[activePlatform.id, activePlatform]]),
          },
        }}
        canWrite
        canReadListingShops
        keyword=""
        onFilter={vi.fn()}
        onEdit={vi.fn()}
        onCreate={onCreate}
        onImported={vi.fn()}
        onRetry={vi.fn()}
        onPageChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "匹配库存 SKU" }))
      .toHaveProperty("disabled", false);
    for (const label of [
      "按规则批量匹配",
      "按表格批量匹配",
      "批量解除关系",
      "添加到同步规则",
      "导出勾选商品（含图片）",
      "添加导出任务",
      "导出任务",
    ]) {
      expect(screen.queryByRole("button", { name: label })).toBeNull();
    }
    expect(screen.getByRole("button", { name: "导出勾选商品" }))
      .toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "预览 Shopify 商品" }))
      .toHaveProperty("disabled", false);
    fireEvent.click(screen.getByRole("button", { name: "匹配库存 SKU" }));
    expect(onCreate).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "预览 Shopify 商品" }));
    expect(screen.getByRole("dialog", { name: "Shopify 商品目录预览" }))
      .toBeTruthy();
  });

  it("exports only selected online-product mappings without platform writes", async () => {
    const item: ProductListing = {
      id: "30000000-0000-4000-8000-000000000001",
      shopId: activeShop.id,
      platformId: activePlatform.id,
      skuId: listingSku.id,
      sku: listingSku,
      externalListingRef: "listing-1",
      externalVariantRef: "variant-1",
      externalStatus: "online",
      status: "ACTIVE",
      updatedAt: "2026-07-28T10:00:00Z",
      version: 0,
    };
    const createObjectUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:listing-export");
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const createListing = vi.spyOn(productCenterApi, "createListing");
    render(
      <ListingSection
        state={{ status: "ready", data: page([item]) }}
        shopOptions={{
          status: "ready",
          data: {
            shops: [activeShop],
            platforms: new Map([[activePlatform.id, activePlatform]]),
          },
        }}
        canWrite={false}
        canReadListingShops
        shopId={activeShop.id}
        keyword=""
        onFilter={vi.fn()}
        onEdit={vi.fn()}
        onCreate={vi.fn()}
        onImported={vi.fn()}
        onRetry={vi.fn()}
        onPageChange={vi.fn()}
      />,
    );

    expect(screen.getByText("SKU_LOCAL_001")).toBeTruthy();
    expect(screen.getByText("本地库存商品")).toBeTruthy();
    expect(screen.queryByText(listingSku.id)).toBeNull();
    const exportButton = screen.getByRole("button", {
      name: "导出勾选商品",
    });
    expect((exportButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "选择在线商品映射 listing-1",
      }),
    );
    expect(screen.getByText("共 1 条，已选 1 条")).toBeTruthy();
    fireEvent.click(exportButton);

    expect(createObjectUrl).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    const blob = createObjectUrl.mock.calls[0][0] as Blob;
    await expect(blob.text()).resolves.toContain("listing-1");
    await expect(blob.text()).resolves.toContain(activeShop.displayName);
    await expect(blob.text()).resolves.toContain("SKU_LOCAL_001");
    await expect(blob.text()).resolves.toContain("本地库存商品");
    await expect(blob.text()).resolves.not.toContain(listingSku.id);
    expect(createListing).not.toHaveBeenCalled();
  });

  it("allows read-only Shopify catalog preview but disables mapping import without listing write", async () => {
    vi.spyOn(shopCenterApi, "getChannels").mockResolvedValue({
      mode: "XZ_ERP_APP",
      shopify: { status: "CONNECTED" },
      shopifyScopes: [
        { scope: "read_products", purpose: "商品目录读取", status: "GRANTED" },
      ],
      activity: [],
    });
    vi.spyOn(productCenterApi, "previewShopifyCatalog")
      .mockResolvedValue({
        mode: "XZ_ERP_APP",
        connectionStatus: "CONNECTED",
        cursor: undefined,
        hasNextPage: false,
        fetchedAt: "2026-07-31T06:00:00Z",
        products: [{
          externalListingRef: "gid://shopify/Product/1",
          title: "HD Sunglasses",
          externalStatus: "ACTIVE",
          variants: [{
            externalVariantRef: "gid://shopify/ProductVariant/10",
            platformSku: "HD-B-M",
            title: "Black / M",
            availableForSale: true,
            inventoryTracked: true,
            matchStatus: "EXACT_SKU_MATCH",
            localSku: {
              id: listingSku.id,
              businessCode: listingSku.businessCode,
              name: listingSku.name,
              status: "ACTIVE",
            },
          }],
        }],
      });
    const imported = vi.spyOn(productCenterApi, "importShopifyCatalogListings")
      .mockResolvedValue({
        requestedCount: 0,
        importedCount: 0,
        skippedCount: 0,
        items: [],
      });

    render(
      <ListingSection
        state={{ status: "ready", data: page([]) }}
        shopOptions={{
          status: "ready",
          data: {
            shops: [activeShop],
            platforms: new Map([[activePlatform.id, activePlatform]]),
          },
        }}
        canWrite={false}
        canReadListingShops
        shopId={activeShop.id}
        keyword=""
        onFilter={vi.fn()}
        onEdit={vi.fn()}
        onCreate={vi.fn()}
        onImported={vi.fn()}
        onRetry={vi.fn()}
        onPageChange={vi.fn()}
      />,
    );

    const previewButton = screen.getByRole("button", { name: "预览 Shopify 商品" });
    expect(previewButton).toHaveProperty("disabled", false);
    fireEvent.click(previewButton);
    fireEvent.click(screen.getByRole("button", { name: "刷新预览" }));

    await screen.findByText("Black / M");
    expect(screen.getByText("只读 Shopify 预览")).toBeTruthy();
    expect(screen.getByText("当前为只读预览")).toBeTruthy();
    expect(screen.getByText("在售")).toBeTruthy();
    expect(screen.getByText("商品 ID：1")).toBeTruthy();
    expect(screen.queryByLabelText("游标")).toBeNull();
    expect(screen.queryByRole("button", { name: "导入到 ERP" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: /选择 Shopify 变体/ })).toBeNull();
    expect(imported).not.toHaveBeenCalled();
  });

  it("previews and imports matched Shopify catalog variants", async () => {
    vi.spyOn(shopCenterApi, "getChannels").mockResolvedValue({
      mode: "XZ_ERP_APP",
      shopify: { status: "CONNECTED" },
      shopifyScopes: [
        { scope: "read_products", purpose: "商品目录读取", status: "GRANTED" },
      ],
      activity: [],
    });
    const preview = vi.spyOn(productCenterApi, "previewShopifyCatalog")
      .mockResolvedValue({
        mode: "XZ_ERP_APP",
        connectionStatus: "CONNECTED",
        cursor: undefined,
        hasNextPage: false,
        fetchedAt: "2026-07-31T06:00:00Z",
        products: [{
          externalListingRef: "gid://shopify/Product/1",
          title: "HD Sunglasses",
          externalStatus: "ACTIVE",
          variants: [
            {
              externalVariantRef: "gid://shopify/ProductVariant/10",
              platformSku: "HD-B-M",
              title: "Black / M",
              availableForSale: true,
              inventoryTracked: true,
              matchStatus: "EXACT_SKU_MATCH",
              localSku: {
                id: listingSku.id,
                businessCode: listingSku.businessCode,
                name: listingSku.name,
                status: "ACTIVE",
              },
            },
            {
              externalVariantRef: "gid://shopify/ProductVariant/11",
              platformSku: "NO-LOCAL",
              title: "White / M",
              availableForSale: true,
              inventoryTracked: true,
              matchStatus: "MISSING_LOCAL_SKU",
            },
          ],
        }],
      });
    const imported = vi.spyOn(productCenterApi, "importShopifyCatalogListings")
      .mockResolvedValue({
        requestedCount: 1,
        importedCount: 1,
        skippedCount: 0,
        items: [{
          externalListingRef: "gid://shopify/Product/1",
          externalVariantRef: "gid://shopify/ProductVariant/10",
          platformSku: "HD-B-M",
          skuId: listingSku.id,
          listingId: "70000000-0000-4000-8000-000000000007",
          status: "IMPORTED_OR_ALREADY_BOUND",
        }],
      });
    const onImported = vi.fn();

    const { container } = render(
      <ShopifyCatalogImportDialog
        shopOptions={{
          status: "ready",
          data: {
            shops: [activeShop],
            platforms: new Map([[activePlatform.id, activePlatform]]),
          },
        }}
        initialShopId={activeShop.id}
        onClose={vi.fn()}
        onImported={onImported}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "刷新预览" }));
    await screen.findByText("Black / M");
    expect(screen.getByText("SKU_LOCAL_001")).toBeTruthy();
    expect(screen.getByText("缺少库存 SKU")).toBeTruthy();
    expect(preview).toHaveBeenCalledWith({
      shopId: activeShop.id,
      limit: 50,
      cursor: undefined,
      query: "status:active",
    });

    fireEvent.click(screen.getByRole("button", { name: "导入到 ERP" }));
    await waitFor(() => expect(imported).toHaveBeenCalledWith({
      shopId: activeShop.id,
      limit: 50,
      cursor: undefined,
      query: "status:active",
      externalVariantRefs: ["gid://shopify/ProductVariant/10"],
    }));
    expect(onImported).toHaveBeenCalledOnce();
    expect(screen.getByText(/成功\/已存在 1 个/)).toBeTruthy();
  });

  it("does not refresh listing data when Shopify catalog import only skips", async () => {
    vi.spyOn(shopCenterApi, "getChannels").mockResolvedValue({
      mode: "XZ_ERP_APP",
      shopify: { status: "CONNECTED" },
      shopifyScopes: [
        { scope: "read_products", purpose: "商品目录读取", status: "GRANTED" },
      ],
      activity: [],
    });
    vi.spyOn(productCenterApi, "previewShopifyCatalog")
      .mockResolvedValue({
        mode: "XZ_ERP_APP",
        connectionStatus: "CONNECTED",
        cursor: undefined,
        hasNextPage: false,
        fetchedAt: "2026-07-31T01:02:03Z",
        products: [{
          externalListingRef: "gid://shopify/Product/1",
          title: "HD Sunglasses",
          externalStatus: "ACTIVE",
          variants: [{
            externalVariantRef: "gid://shopify/ProductVariant/10",
            platformSku: "HD-B-M",
            title: "Black / M",
            availableForSale: true,
            inventoryTracked: true,
            matchStatus: "EXACT_SKU_MATCH",
            localSku: {
              id: listingSku.id,
              businessCode: listingSku.businessCode,
              name: listingSku.name,
              status: "ACTIVE",
            },
          }],
        }],
      });
    vi.spyOn(productCenterApi, "importShopifyCatalogListings")
      .mockResolvedValue({
        requestedCount: 1,
        importedCount: 0,
        skippedCount: 1,
        items: [{
          externalListingRef: "gid://shopify/Product/1",
          externalVariantRef: "gid://shopify/ProductVariant/10",
          platformSku: "HD-B-M",
          status: "SKIPPED_CONFLICT",
          safeSummary: "Listing could not be imported because it conflicts with existing product data",
        }],
      });
    const onImported = vi.fn();

    const { container } = render(
      <ShopifyCatalogImportDialog
        shopOptions={{
          status: "ready",
          data: {
            shops: [activeShop],
            platforms: new Map([[activePlatform.id, activePlatform]]),
          },
        }}
        initialShopId={activeShop.id}
        onClose={vi.fn()}
        onImported={onImported}
      />,
    );

    fireEvent.click(container.querySelectorAll("button.button-primary")[0]);
    await screen.findByText("Black / M");
    const primaryButtons = container.querySelectorAll("button.button-primary");
    fireEvent.click(primaryButtons[primaryButtons.length - 1]);

    await waitFor(() =>
      expect(productCenterApi.importShopifyCatalogListings)
        .toHaveBeenCalled(),
    );
    expect(await screen.findByText(
      "与现有 ERP 商品映射冲突，请检查后重试。",
    )).toBeTruthy();
    expect(onImported).not.toHaveBeenCalled();
  });

  it("blocks Shopify catalog preview when the app grant is missing read_products", async () => {
    vi.spyOn(shopCenterApi, "getChannels").mockResolvedValue({
      mode: "XZ_ERP_APP",
      shopify: { status: "CONNECTED" },
      shopifyScopes: [
        { scope: "read_products", purpose: "商品目录读取", status: "MISSING" },
      ],
      activity: [],
    });
    const preview = vi.spyOn(productCenterApi, "previewShopifyCatalog")
      .mockResolvedValue({
        mode: "XZ_ERP_APP",
        connectionStatus: "CONNECTED",
        cursor: undefined,
        hasNextPage: false,
        fetchedAt: "2026-07-31T01:02:03Z",
        products: [],
      });

    const { container } = render(
      <ShopifyCatalogImportDialog
        shopOptions={{
          status: "ready",
          data: {
            shops: [activeShop],
            platforms: new Map([[activePlatform.id, activePlatform]]),
          },
        }}
        initialShopId={activeShop.id}
        onClose={vi.fn()}
        onImported={vi.fn()}
      />,
    );

    fireEvent.click(container.querySelectorAll("button.button-primary")[0]);

    expect(await screen.findByText(/Shopify 应用权限不足/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("read_products");
    expect(preview).not.toHaveBeenCalled();
  });

  it("blocks Shopify catalog import when read_products is revoked after preview", async () => {
    vi.spyOn(shopCenterApi, "getChannels")
      .mockResolvedValueOnce({
        mode: "XZ_ERP_APP",
        shopify: { status: "CONNECTED" },
        shopifyScopes: [
          { scope: "read_products", purpose: "商品目录读取", status: "GRANTED" },
        ],
        activity: [],
      })
      .mockResolvedValueOnce({
        mode: "XZ_ERP_APP",
        shopify: { status: "CONNECTED" },
        shopifyScopes: [
          { scope: "read_products", purpose: "商品目录读取", status: "MISSING" },
        ],
        activity: [],
      });
    vi.spyOn(productCenterApi, "previewShopifyCatalog")
      .mockResolvedValue({
        mode: "XZ_ERP_APP",
        connectionStatus: "CONNECTED",
        cursor: undefined,
        hasNextPage: false,
        fetchedAt: "2026-07-31T01:02:03Z",
        products: [{
          externalListingRef: "gid://shopify/Product/1",
          title: "HD Sunglasses",
          variants: [{
            externalVariantRef: "gid://shopify/ProductVariant/10",
            platformSku: "HD-B-M",
            title: "Black / M",
            availableForSale: true,
            inventoryTracked: true,
            matchStatus: "EXACT_SKU_MATCH",
            localSku: {
              id: listingSku.id,
              businessCode: listingSku.businessCode,
              name: listingSku.name,
              status: "ACTIVE",
            },
          }],
        }],
      });
    const imported = vi.spyOn(productCenterApi, "importShopifyCatalogListings")
      .mockResolvedValue({ requestedCount: 0, importedCount: 0, skippedCount: 0, items: [] });

    const { container } = render(
      <ShopifyCatalogImportDialog
        shopOptions={{
          status: "ready",
          data: {
            shops: [activeShop],
            platforms: new Map([[activePlatform.id, activePlatform]]),
          },
        }}
        initialShopId={activeShop.id}
        onClose={vi.fn()}
        onImported={vi.fn()}
      />,
    );

    fireEvent.click(container.querySelectorAll("button.button-primary")[0]);
    await screen.findByText("Black / M");
    const primaryButtons = container.querySelectorAll("button.button-primary");
    fireEvent.click(primaryButtons[primaryButtons.length - 1]);

    expect(await screen.findByText(/Shopify 应用权限不足/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("read_products");
    expect(imported).not.toHaveBeenCalled();
  });

  it("fails closed to Shopify shops for new online-product mappings", () => {
    const nonShopifyPlatform = {
      ...activePlatform,
      id: "20000000-0000-4000-8000-000000000002",
      code: "TIKTOK",
      displayName: "TikTok Shop",
    };
    const nonShopifyShop = {
      ...activeShop,
      id: "10000000-0000-4000-8000-000000000002",
      platformId: nonShopifyPlatform.id,
    };
    const platforms = new Map([
      [activePlatform.id, activePlatform],
      [nonShopifyPlatform.id, nonShopifyPlatform],
    ]);
    expect(isShopifyShop(activeShop, platforms)).toBe(true);
    expect(isShopifyShop(nonShopifyShop, platforms)).toBe(false);
    expect(isShopifyShop(activeShop, new Map())).toBe(false);
    expect(
      isShopifyShop({ ...activeShop, status: "SUSPENDED" }, platforms),
    ).toBe(false);

    render(
      <ListingShopPicker
        state={{
          status: "ready",
          data: { shops: [activeShop, nonShopifyShop], platforms },
        }}
        search=""
        selectedShopId=""
        onSearchChange={vi.fn()}
        onSelectedShopChange={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByRole("option", { name: /Shopify.*旗舰店/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /TikTok Shop/ })).toBeNull();
  });

  it("paginates and keeps 401/403/404/409 messages safe", () => {
    const onPageChange = vi.fn();
    const onPageSizeChange = vi.fn();
    const page: Page<unknown> = {
      items: [{}],
      page: 0,
      size: 25,
      totalElements: 26,
      totalPages: 2,
    };
    render(
      <Pagination
        page={page}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
        label="测试分页"
      />,
    );
    expect(screen.getByText("共 26 条，第 1 / 2 页")).toBeTruthy();
    expect(
      screen.getByRole("option", { name: "200" }),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("测试分页每页条数"), {
      target: { value: "50" },
    });
    expect(onPageSizeChange).toHaveBeenCalledWith(50);
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(onPageChange).toHaveBeenCalledWith(1);
    for (const status of [401, 403, 404, 409]) {
      expect(
        safeProductMessage(
          new ApiError("internal secret", { status }),
          "读取商品",
        ),
      ).not.toContain("internal secret");
    }
  });

  it("maps Shopify product scope conflicts from code or details without exposing raw server details", () => {
    const conflicts = [
      new ApiError("raw backend detail from code", {
        status: 409,
        code: "shopify_authorization_conflict",
      }),
      new ApiError("raw backend detail from details", {
        status: 409,
        details: { reason: "shopify_scope_missing", scope: "read_products" },
      }),
    ];

    for (const conflict of conflicts) {
      const message = safeProductMessage(
        conflict,
        "导入 Shopify 商品映射",
      );
      expect(message).toContain("商品读取权限不可用");
      expect(message).not.toContain("read_products");
      expect(message).not.toContain(conflict.message);
    }
  });

  it("redacts ordinary product 409 details behind the generic conflict message", () => {
    const message = safeProductMessage(
      new ApiError("secret raw detail", { status: 409 }),
      "读取商品",
    );

    expect(message).toBe("商品数据已变更。请刷新后再试。");
    expect(message).not.toContain("secret raw detail");
  });

  it("creates a mapping without rendering sensitive metadata and restores focus on close", async () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const onClose = vi.fn();
    const onSaved = vi.fn();
    const create = vi
      .spyOn(productCenterApi, "createListing")
      .mockResolvedValue({
        id: "30000000-0000-4000-8000-000000000001",
        shopId: "10000000-0000-4000-8000-000000000001",
        platformId: "20000000-0000-4000-8000-000000000001",
        skuId: listingSku.id,
        sku: listingSku,
        externalListingRef: "listing-1",
        status: "ACTIVE",
        updatedAt: "2026-07-28T10:00:00Z",
        version: 0,
      });
    vi.spyOn(shopCenterApi, "listShops").mockResolvedValue({
      items: [
        {
          id: "10000000-0000-4000-8000-000000000001",
          platformId: "20000000-0000-4000-8000-000000000001",
          externalShopRef: "STORE-1",
          displayName: "旗舰店",
          status: "ACTIVE",
          authorization: {
            status: "AUTHORIZED",
            credentialConfigured: true,
            scopes: [],
          },
          updatedAt: "2026-07-28T10:00:00Z",
        },
      ],
      page: 0,
      size: 200,
      totalElements: 1,
      totalPages: 1,
    });
    vi.spyOn(shopCenterApi, "listPlatforms").mockResolvedValue({
      items: [
        {
          id: "20000000-0000-4000-8000-000000000001",
          code: "SHOPIFY",
          displayName: "Shopify",
          status: "ACTIVE",
        },
      ],
      page: 0,
      size: 200,
      totalElements: 1,
      totalPages: 1,
    });
    const view = render(
      <ProductWriteDialog
        editor={{
          kind: "listing",
          action: "create",
          skuId: "40000000-0000-4000-8000-000000000001",
        }}
        availableSkus={[]}
        canReadListingShops
        onClose={onClose}
        onSaved={onSaved}
      />,
    );
    expect(screen.queryByText(/metadataNote/i)).toBeNull();
    const shopSearch = await screen.findByLabelText("搜索店铺");
    const shopSelect = screen.getByLabelText("店铺");
    for (const term of ["Shopify", "旗舰店", "STORE-1"]) {
      fireEvent.change(shopSearch, { target: { value: term } });
      expect(screen.getByRole("option", { name: /旗舰店/ })).toBeTruthy();
    }
    fireEvent.change(shopSearch, { target: { value: "" } });
    fireEvent.change(shopSelect, {
      target: { value: "10000000-0000-4000-8000-000000000001" },
    });
    fireEvent.change(screen.getByLabelText("店铺平台商品引用"), {
      target: { value: "listing-1" },
    });
    fireEvent.submit(
      screen.getByRole("button", { name: "保存" }).closest("form")!,
    );
    await vi.waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          shopId: "10000000-0000-4000-8000-000000000001",
          skuId: "40000000-0000-4000-8000-000000000001",
        }),
      ),
    );
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    view.unmount();
    expect(document.activeElement).toBe(trigger);
    document.body.removeChild(trigger);
  });

  it("does not request shop directories or allow a free UUID fallback without directory read permission", async () => {
    const listShops = vi.spyOn(shopCenterApi, "listShops");
    const listPlatforms = vi.spyOn(shopCenterApi, "listPlatforms");
    expect(shouldLoadListingShopOptions(false, true)).toBe(false);
    render(
      <ProductWriteDialog
        editor={{ kind: "listing", action: "create" }}
        availableSkus={[]}
        canReadListingShops={false}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    await Promise.resolve();
    expect(listShops).not.toHaveBeenCalled();
    expect(listPlatforms).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("店铺 ID")).toBeNull();
    expect(screen.getByText(/需要管理员授予店铺和平台目录读取权限/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "保存" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("handles empty shop options and safe directory failures with a retry", async () => {
    const listShops = vi.spyOn(shopCenterApi, "listShops").mockResolvedValue(page([]));
    vi.spyOn(shopCenterApi, "listPlatforms").mockResolvedValue(page([]));
    const { unmount } = render(
      <ProductWriteDialog
        editor={{ kind: "listing", action: "create" }}
        availableSkus={[]}
        canReadListingShops
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    expect(
      await screen.findByText(
        "暂无可用于在线商品匹配的启用 Shopify 店铺。",
      ),
    ).toBeTruthy();
    unmount();

    listShops
      .mockReset()
      .mockRejectedValueOnce(new ApiError("internal shop connector detail", { status: 500 }))
      .mockResolvedValue(page([activeShop]));
    vi.spyOn(shopCenterApi, "listPlatforms").mockReset().mockResolvedValue(page([activePlatform]));
    render(
      <ProductWriteDialog
        editor={{ kind: "listing", action: "create" }}
        availableSkus={[]}
        canReadListingShops
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toContain("internal shop connector detail");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByLabelText("店铺");
    expect(listShops).toHaveBeenCalledTimes(2);
  });

  it("ignores an older shop-directory response after a new request starts", async () => {
    let resolveStaleShops!: (value: Page<TenantShop>) => void;
    let resolveStalePlatforms!: (value: Page<PlatformCatalogEntry>) => void;
    const staleShops = new Promise<Page<TenantShop>>((resolve) => {
      resolveStaleShops = resolve;
    });
    const stalePlatforms = new Promise<Page<PlatformCatalogEntry>>((resolve) => {
      resolveStalePlatforms = resolve;
    });
    const freshShop = { ...activeShop, displayName: "新店铺" };
    vi.spyOn(shopCenterApi, "listShops")
      .mockReturnValueOnce(staleShops)
      .mockResolvedValueOnce(page([freshShop]));
    vi.spyOn(shopCenterApi, "listPlatforms")
      .mockReturnValueOnce(stalePlatforms)
      .mockResolvedValueOnce(page([activePlatform]));
    const view = render(
      <ProductWriteDialog
        editor={{ kind: "listing", action: "create" }}
        availableSkus={[]}
        canReadListingShops
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    view.rerender(
      <ProductWriteDialog
        editor={{ kind: "listing", action: "create" }}
        availableSkus={[]}
        canReadListingShops={false}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    view.rerender(
      <ProductWriteDialog
        editor={{ kind: "listing", action: "create" }}
        availableSkus={[]}
        canReadListingShops
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    expect(await screen.findByText(/新店铺/)).toBeTruthy();
    resolveStaleShops(page([activeShop]));
    resolveStalePlatforms(page([activePlatform]));
    await Promise.resolve();
    expect(screen.queryByText(/旗舰店/)).toBeNull();
  });

  it("recovers a mapping version conflict with the latest server version", async () => {
    const item = {
      id: "30000000-0000-4000-8000-000000000001",
      shopId: "10000000-0000-4000-8000-000000000001",
      platformId: "20000000-0000-4000-8000-000000000001",
      skuId: listingSku.id,
      sku: listingSku,
      externalListingRef: "listing-1",
      externalStatus: "old",
      status: "ACTIVE" as const,
      updatedAt: "2026-07-28T10:00:00Z",
      version: 2,
    };
    const latest = { ...item, externalStatus: "new", version: 3 };
    const update = vi
      .spyOn(productCenterApi, "updateListing")
      .mockRejectedValueOnce(new ApiError("stale", { status: 409 }))
      .mockResolvedValueOnce(latest);
    vi.spyOn(productCenterApi, "getListing").mockResolvedValue(latest);
    const onSaved = vi.fn();
    render(
      <ProductWriteDialog
        editor={{ kind: "listing", action: "edit", item }}
        availableSkus={[]}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );
    const form = screen.getByRole("button", { name: "保存" }).closest("form")!;
    fireEvent.submit(form);
    await vi.waitFor(() =>
      expect(productCenterApi.getListing).toHaveBeenCalledWith(item.id),
    );
    expect(update.mock.calls[0]?.[1]).not.toHaveProperty("shopId");
    expect(update.mock.calls[0]?.[1]).not.toHaveProperty("skuId");
    expect(update.mock.calls[0]?.[1]).not.toHaveProperty("externalListingRef");
    expect(screen.getByRole("alert").textContent).toContain("商品资料已更新");
    fireEvent.submit(form);
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(update.mock.calls[1][1]).toMatchObject({ version: 3 });
  });
});
