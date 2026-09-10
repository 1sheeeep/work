import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { productCenterApi, type ProductSku } from "../modules/productCenterApi";
import { productSupplyPriceApi, type ProductSupplyPrice } from "../modules/productSupplyPriceApi";
import { ProductSupplyPriceSection } from "./ProductSupplyPriceSection";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const skuId = "20000000-0000-4000-8000-000000000002";

function price(overrides: Partial<ProductSupplyPrice> = {}): ProductSupplyPrice {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    skuType: "INVENTORY",
    referenceId: skuId,
    skuCode: "SKU-BAG-01",
    skuName: "收纳包",
    salesCountry: "US",
    currency: "USD",
    unitPrice: 12.5,
    minimumQuantity: 2,
    validFrom: "2026-08-10",
    status: "ACTIVE",
    note: "美国供货目录",
    version: 0,
    createdByDisplayName: "系统管理员",
    updatedByDisplayName: "系统管理员",
    createdAt: "2026-08-10T10:00:00Z",
    updatedAt: "2026-08-10T10:00:00Z",
    ...overrides,
  };
}

const sku: ProductSku = {
  id: skuId,
  spuId: "30000000-0000-4000-8000-000000000003",
  masterSku: {
    id: "30000000-0000-4000-8000-000000000003",
    businessCode: "MASTER-BAG",
    name: "收纳用品",
  },
  businessCode: "SKU-BAG-01",
  name: "收纳包",
  status: "ACTIVE",
  createdAt: "2026-08-10T09:00:00Z",
  updatedAt: "2026-08-10T10:00:00Z",
  version: 0,
};

describe("ProductSupplyPriceSection", () => {
  it("loads the price catalog and submits typed filters", async () => {
    vi.spyOn(productSupplyPriceApi, "list").mockResolvedValue({
      items: [price()], page: 0, size: 25, totalElements: 1, totalPages: 1,
    });
    const onFilter = vi.fn();
    render(<ProductSupplyPriceSection keyword="" skuType="" country="" canWrite onFilter={onFilter} />);

    expect(await screen.findByText("SKU-BAG-01")).toBeTruthy();
    expect(screen.getByText("USD 12.50")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("供货价搜索内容"), { target: { value: " BAG " } });
    fireEvent.change(screen.getByLabelText("供货价 SKU 类型"), { target: { value: "INVENTORY" } });
    fireEvent.change(screen.getByLabelText("供货价销售国家"), { target: { value: "US" } });
    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    expect(onFilter).toHaveBeenCalledWith("BAG", "INVENTORY", "US");
  });

  it("creates a supply price from a real SKU selection", async () => {
    vi.spyOn(productSupplyPriceApi, "list").mockResolvedValue({
      items: [], page: 0, size: 25, totalElements: 0, totalPages: 0,
    });
    vi.spyOn(productCenterApi, "listSkus").mockResolvedValue({
      items: [sku], page: 0, size: 25, totalElements: 1, totalPages: 1,
    });
    const create = vi.spyOn(productSupplyPriceApi, "create").mockResolvedValue(price());
    render(<ProductSupplyPriceSection keyword="" skuType="" country="" canWrite onFilter={vi.fn()} />);

    await screen.findByText("暂无商品供货价");
    fireEvent.click(screen.getByRole("button", { name: "新增供货价" }));
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    expect(await screen.findByText("SKU-BAG-01")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "选择" }));
    fireEvent.change(screen.getByLabelText("供货单价"), { target: { value: "12.50" } });
    fireEvent.change(screen.getByLabelText("最小供货量"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("生效日期"), { target: { value: "2026-08-10" } });
    fireEvent.change(screen.getByLabelText("备注（可选）"), { target: { value: "美国供货目录" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(create).toHaveBeenCalledWith({
      skuType: "INVENTORY", referenceId: skuId, salesCountry: "US",
      currency: "USD", unitPrice: 12.5, minimumQuantity: 2,
      validFrom: "2026-08-10", validTo: undefined,
      status: "ACTIVE", note: "美国供货目录",
    }));
  });

  it("updates selected prices in one guarded batch", async () => {
    vi.spyOn(productSupplyPriceApi, "list").mockResolvedValue({
      items: [price({ version: 3 })], page: 0, size: 25,
      totalElements: 1, totalPages: 1,
    });
    const batch = vi.spyOn(productSupplyPriceApi, "batchStatus")
      .mockResolvedValue([price({ status: "INACTIVE", version: 4 })]);
    render(<ProductSupplyPriceSection keyword="" skuType="" country="" canWrite onFilter={vi.fn()} />);

    await screen.findByText("SKU-BAG-01");
    fireEvent.click(screen.getByLabelText("选择 SKU-BAG-01"));
    fireEvent.click(screen.getByRole("button", { name: "批量停用" }));
    await waitFor(() => expect(batch).toHaveBeenCalledWith("INACTIVE", [{
      id: price().id, expectedVersion: 3,
    }]));
  });

  it("requires confirmation before archiving", async () => {
    vi.spyOn(productSupplyPriceApi, "list").mockResolvedValue({
      items: [price()], page: 0, size: 25, totalElements: 1, totalPages: 1,
    });
    const archive = vi.spyOn(productSupplyPriceApi, "archive")
      .mockResolvedValue(price({ status: "ARCHIVED", version: 1 }));
    render(<ProductSupplyPriceSection keyword="" skuType="" country="" canWrite onFilter={vi.fn()} />);

    await screen.findByText("SKU-BAG-01");
    fireEvent.click(screen.getByRole("button", { name: "归档" }));
    expect(screen.getByRole("alertdialog", { name: "归档商品供货价" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认归档" }));
    await waitFor(() => expect(archive).toHaveBeenCalledWith(price().id, 0));
  });
});
