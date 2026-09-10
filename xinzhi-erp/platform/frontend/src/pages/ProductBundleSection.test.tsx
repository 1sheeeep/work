import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { productBundleApi, type ProductBundle } from "../modules/productBundleApi";
import { productCenterApi, type ProductSku } from "../modules/productCenterApi";
import { ProductBundleSection } from "./ProductBundleSection";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const skuId = "20000000-0000-4000-8000-000000000002";

function bundle(overrides: Partial<ProductBundle> = {}): ProductBundle {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    businessCode: "KIT-TRAVEL-01",
    name: "出行套装",
    description: "常用出行商品组合",
    status: "ACTIVE",
    components: [{ skuId, skuCode: "SKU-BAG-01", skuName: "收纳包", quantity: 2 }],
    componentCount: 1,
    totalUnits: 2,
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

describe("ProductBundleSection", () => {
  it("loads data and submits bounded filters", async () => {
    vi.spyOn(productBundleApi, "list").mockResolvedValue({
      items: [bundle()], page: 0, size: 25, totalElements: 1, totalPages: 1,
    });
    const onFilter = vi.fn();
    render(<ProductBundleSection keyword="" canWrite onFilter={onFilter} />);

    expect(await screen.findByText("KIT-TRAVEL-01")).toBeTruthy();
    expect(screen.getByText("SKU-BAG-01 × 2")).toBeTruthy();
    expect(screen.getByRole("button", { name: "新增组合 SKU" })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("组合 SKU 搜索内容"), { target: { value: " KIT-02 " } });
    fireEvent.change(screen.getByLabelText("组合 SKU 起始日期"), { target: { value: "2026-08-02" } });
    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    expect(onFilter).toHaveBeenCalledWith("KIT-02", "2026-08-02", undefined);
  });

  it("creates a bundle from a real inventory SKU selection", async () => {
    vi.spyOn(productBundleApi, "list").mockResolvedValue({
      items: [], page: 0, size: 25, totalElements: 0, totalPages: 0,
    });
    vi.spyOn(productCenterApi, "listSkus").mockResolvedValue({
      items: [sku], page: 0, size: 25, totalElements: 1, totalPages: 1,
    });
    const create = vi.spyOn(productBundleApi, "create").mockResolvedValue(bundle());
    render(<ProductBundleSection keyword="" canWrite onFilter={vi.fn()} />);

    await screen.findByText("暂无组合 SKU");
    fireEvent.click(screen.getAllByRole("button", { name: "新增组合 SKU" })[0]);
    fireEvent.change(screen.getByLabelText("组合 SKU 编号"), { target: { value: "kit-travel-01" } });
    fireEvent.change(screen.getByLabelText("组合名称"), { target: { value: "出行套装" } });
    fireEvent.change(screen.getByLabelText("库存 SKU"), { target: { value: "BAG" } });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    expect(await screen.findByText("SKU-BAG-01")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "添加" }));
    fireEvent.change(screen.getByLabelText("SKU-BAG-01 组成数量"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(create).toHaveBeenCalledWith({
      businessCode: "KIT-TRAVEL-01",
      name: "出行套装",
      description: undefined,
      status: "ACTIVE",
      components: [{ skuId, quantity: 2 }],
    }));
    expect(await screen.findByText("已保存 KIT-TRAVEL-01。")).toBeTruthy();
  });

  it("requires confirmation before archiving", async () => {
    vi.spyOn(productBundleApi, "list").mockResolvedValue({
      items: [bundle()], page: 0, size: 25, totalElements: 1, totalPages: 1,
    });
    const archive = vi.spyOn(productBundleApi, "archive").mockResolvedValue(bundle({ status: "ARCHIVED", version: 1 }));
    render(<ProductBundleSection keyword="" canWrite onFilter={vi.fn()} />);

    await screen.findByText("KIT-TRAVEL-01");
    fireEvent.click(screen.getByRole("button", { name: "归档" }));
    expect(screen.getByRole("alertdialog", { name: "归档组合 SKU" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认归档" }));
    await waitFor(() => expect(archive).toHaveBeenCalledWith(bundle().id, 0));
  });

  it("updates the latest version with edited components", async () => {
    vi.spyOn(productBundleApi, "list").mockResolvedValue({
      items: [bundle({ version: 3 })], page: 0, size: 25, totalElements: 1, totalPages: 1,
    });
    const update = vi.spyOn(productBundleApi, "update").mockResolvedValue(bundle({
      name: "出行组合套装",
      totalUnits: 3,
      version: 4,
      components: [{ skuId, skuCode: "SKU-BAG-01", skuName: "收纳包", quantity: 3 }],
    }));
    render(<ProductBundleSection keyword="" canWrite onFilter={vi.fn()} />);

    await screen.findByText("KIT-TRAVEL-01");
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByLabelText("组合名称"), { target: { value: "出行组合套装" } });
    fireEvent.change(screen.getByLabelText("SKU-BAG-01 组成数量"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(update).toHaveBeenCalledWith(
      bundle().id,
      3,
      {
        name: "出行组合套装",
        description: "常用出行商品组合",
        status: "ACTIVE",
        components: [{ skuId, quantity: 3 }],
      },
    ));
  });
});
