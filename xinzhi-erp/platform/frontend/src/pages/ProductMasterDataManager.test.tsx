import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { productCenterApi } from "../modules/productCenterApi";
import { ProductMasterDataManager } from "./ProductMasterDataManager";

const categoryId = "11111111-1111-4111-8111-111111111111";
const packageId = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:product-categories"),
    revokeObjectURL: vi.fn(),
  });
  vi.spyOn(productCenterApi, "listCategories").mockResolvedValue({
    items: [{ id: categoryId, name: "家居", sortOrder: 10, status: "ACTIVE", createdAt: "2026-07-30T10:00:00Z", updatedAt: "2026-07-30T10:00:00Z", version: 1 }],
    page: 0, size: 25, totalElements: 1, totalPages: 1,
  });
  vi.spyOn(productCenterApi, "listPackageMaterials").mockResolvedValue({
    items: [{ id: packageId, name: "纸箱", unitPrice: "1.2500", currencyCode: "CNY", status: "ACTIVE", createdByType: "TENANT_USER", createdBy: categoryId, createdAt: "2026-07-30T10:00:00Z", updatedAt: "2026-07-30T10:00:00Z", version: 1 }],
    page: 0, size: 25, totalElements: 1, totalPages: 1,
  });
  vi.spyOn(productCenterApi, "createCategory").mockResolvedValue({
    id: categoryId, name: "家居", sortOrder: 10, status: "ACTIVE", createdAt: "2026-07-30T10:00:00Z", updatedAt: "2026-07-30T10:00:00Z", version: 1,
  });
  vi.spyOn(productCenterApi, "createPackageMaterial").mockResolvedValue({
    id: packageId, name: "纸箱", status: "ACTIVE", createdByType: "TENANT_USER", createdBy: categoryId, createdAt: "2026-07-30T10:00:00Z", updatedAt: "2026-07-30T10:00:00Z", version: 1,
  });
  vi.spyOn(productCenterApi, "exportCategoriesCsv").mockResolvedValue({
    filename: "product-categories.csv",
    mediaType: "text/csv;charset=UTF-8",
    rowCount: 1,
    content: "\uFEFF类目名称,排序,状态,创建时间,更新时间\r\n家居,10,启用,2026-07-30T10:00:00Z,2026-07-30T10:00:00Z\r\n",
  });
  vi.spyOn(productCenterApi, "exportPackageMaterialsCsv").mockResolvedValue({
    filename: "product-package-materials.csv",
    mediaType: "text/csv;charset=UTF-8",
    rowCount: 1,
    content: "\uFEFF包装资料名称,参考价格,币种,包装重量（克）,包装层级,长（毫米）,宽（毫米）,高（毫米）,状态,创建时间,更新时间\r\n纸箱,1.2500,CNY,,,,,,,启用,2026-07-30T10:00:00Z,2026-07-30T10:00:00Z\r\n",
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ProductMasterDataManager", () => {
  it("creates a tenant category and refreshes the selectable directory", async () => {
    const changed = vi.fn();
    const create = vi.spyOn(productCenterApi, "createCategory");
    render(<ProductMasterDataManager kind="category" canWrite onClose={vi.fn()} onChanged={changed} />);
    await screen.findByText("家居");
    fireEvent.click(screen.getByRole("button", { name: "新增类目" }));
    fireEvent.change(screen.getByLabelText("类目名称"), { target: { value: "数码" } });
    fireEvent.change(screen.getByLabelText("排序"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({ name: "数码", sortOrder: 20 }));
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("shows the package material history state and keeps price with currency", async () => {
    const create = vi.spyOn(productCenterApi, "createPackageMaterial");
    render(<ProductMasterDataManager kind="package" canWrite onClose={vi.fn()} onChanged={vi.fn()} />);
    await screen.findByText("纸箱");
    fireEvent.click(screen.getByRole("button", { name: "新增包装资料" }));
    fireEvent.change(screen.getByLabelText("包装资料名称"), { target: { value: "气泡袋" } });
    fireEvent.change(screen.getByLabelText("参考价格"), { target: { value: "2.50" } });
    fireEvent.change(screen.getByLabelText("币种"), { target: { value: "cny" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ name: "气泡袋", unitPrice: "2.50", currencyCode: "CNY" })));
  });

  it("keeps the reference price optional and explains a currency without an amount", async () => {
    const create = vi.spyOn(productCenterApi, "createPackageMaterial");
    render(<ProductMasterDataManager kind="package" canWrite onClose={vi.fn()} onChanged={vi.fn()} />);
    await screen.findByText("纸箱");
    fireEvent.click(screen.getByRole("button", { name: "新增包装资料" }));
    fireEvent.change(screen.getByLabelText("包装资料名称"), { target: { value: "气泡袋" } });

    const currency = screen.getByLabelText("币种") as HTMLInputElement;
    expect(currency.getAttribute("list")).toBe("product-package-currency-options");
    expect(document.querySelector('#product-package-currency-options option[value="CNY"]')?.getAttribute("label"))
      .toBe("人民币（CNY）");
    fireEvent.change(currency, { target: { value: "CNY" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByText("未填写参考价格时不需要选择币种。")).toBeTruthy();
    expect(create).not.toHaveBeenCalled();

    fireEvent.change(currency, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ name: "气泡袋" })));
    expect(create.mock.calls[0]?.[0]).toMatchObject({ unitPrice: undefined, currencyCode: undefined });
  });

  it("paginates master data with a selectable page size and resets the page", async () => {
    const item = {
      id: categoryId,
      name: "家居",
      sortOrder: 10,
      status: "ACTIVE" as const,
      createdAt: "2026-07-30T10:00:00Z",
      updatedAt: "2026-07-30T10:00:00Z",
      version: 1,
    };
    const list = vi
      .spyOn(productCenterApi, "listCategories")
      .mockImplementation(async (request) => ({
        items: [item],
        page: request.page,
        size: request.size,
        totalElements: 101,
        totalPages: Math.ceil(101 / request.size),
      }));

    render(
      <ProductMasterDataManager
        kind="category"
        canWrite
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    );

    await screen.findByText("家居");
    expect(list).toHaveBeenCalledWith({
      query: undefined,
      status: undefined,
      page: 0,
      size: 25,
    });

    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith({
        query: undefined,
        status: undefined,
        page: 1,
        size: 25,
      }),
    );

    fireEvent.change(screen.getByLabelText("商品目录管理分页每页条数"), {
      target: { value: "50" },
    });
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith({
        query: undefined,
        status: undefined,
        page: 0,
        size: 50,
      }),
    );
  });

  it("refreshes the category version after a conflict without losing the entered values", async () => {
    const update = vi
      .spyOn(productCenterApi, "updateCategory")
      .mockRejectedValueOnce(new ApiError("conflict", { status: 409 }))
      .mockResolvedValue({
        id: categoryId,
        name: "数码",
        sortOrder: 10,
        status: "ACTIVE",
        createdAt: "2026-07-30T10:00:00Z",
        updatedAt: "2026-07-30T10:01:00Z",
        version: 3,
      });
    vi.spyOn(productCenterApi, "getCategory").mockResolvedValue({
      id: categoryId,
      name: "家居",
      sortOrder: 10,
      status: "ACTIVE",
      createdAt: "2026-07-30T10:00:00Z",
      updatedAt: "2026-07-30T10:01:00Z",
      version: 2,
    });

    render(<ProductMasterDataManager kind="category" canWrite onClose={vi.fn()} onChanged={vi.fn()} />);
    await screen.findByText("家居");
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByLabelText("类目名称"), { target: { value: "数码" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await screen.findByRole("alert");
    expect((screen.getByLabelText("类目名称") as HTMLInputElement).value).toBe("数码");
    expect(update).toHaveBeenLastCalledWith(categoryId, expect.objectContaining({ version: 1, name: "数码" }));

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(update).toHaveBeenLastCalledWith(categoryId, expect.objectContaining({ version: 2, name: "数码" })));
  });

  it("refreshes the package material version after a conflict without losing the entered values", async () => {
    const update = vi
      .spyOn(productCenterApi, "updatePackageMaterial")
      .mockRejectedValueOnce(new ApiError("conflict", { status: 409 }))
      .mockResolvedValue({
        id: packageId,
        name: "大号纸箱",
        status: "ACTIVE",
        createdByType: "TENANT_USER",
        createdBy: categoryId,
        createdAt: "2026-07-30T10:00:00Z",
        updatedAt: "2026-07-30T10:01:00Z",
        version: 3,
      });
    vi.spyOn(productCenterApi, "getPackageMaterial").mockResolvedValue({
      id: packageId,
      name: "纸箱",
      unitPrice: "1.2500",
      currencyCode: "CNY",
      status: "ACTIVE",
      createdByType: "TENANT_USER",
      createdBy: categoryId,
      createdAt: "2026-07-30T10:00:00Z",
      updatedAt: "2026-07-30T10:01:00Z",
      version: 2,
    });

    render(<ProductMasterDataManager kind="package" canWrite onClose={vi.fn()} onChanged={vi.fn()} />);
    await screen.findByText("纸箱");
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByLabelText("包装资料名称"), { target: { value: "大号纸箱" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await screen.findByRole("alert");
    expect((screen.getByLabelText("包装资料名称") as HTMLInputElement).value).toBe("大号纸箱");
    expect(update).toHaveBeenLastCalledWith(packageId, expect.objectContaining({ version: 1, name: "大号纸箱" }));

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(update).toHaveBeenLastCalledWith(packageId, expect.objectContaining({ version: 2, name: "大号纸箱" })));
  });

  it("keeps a failed delete visible and retries the same versioned record", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const remove = vi
      .spyOn(productCenterApi, "deleteCategory")
      .mockRejectedValueOnce(new ApiError("conflict", { status: 409 }))
      .mockResolvedValue(undefined);
    render(<ProductMasterDataManager kind="category" canWrite onClose={vi.fn()} onChanged={vi.fn()} />);
    await screen.findByText("家居");
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(2));
    expect(remove).toHaveBeenNthCalledWith(1, categoryId, 1);
    expect(remove).toHaveBeenNthCalledWith(2, categoryId, 1);
  });

  it("keeps archived package material history read-only", async () => {
    vi.spyOn(productCenterApi, "listPackageMaterials").mockResolvedValue({
      items: [{ id: packageId, name: "历史纸箱", status: "ARCHIVED", createdByType: "TENANT_USER", createdBy: categoryId, createdAt: "2026-07-30T10:00:00Z", updatedAt: "2026-07-30T10:00:00Z", version: 1 }],
      page: 0, size: 25, totalElements: 1, totalPages: 1,
    });
    render(<ProductMasterDataManager kind="package" canWrite onClose={vi.fn()} onChanged={vi.fn()} />);
    await screen.findByText("历史纸箱");
    expect(screen.getByText("历史只读")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "编辑" })).toBeNull();
    expect(screen.queryByRole("button", { name: "删除" })).toBeNull();
  });

  it("downloads all category rows for the active filters", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const exportCsv = vi.spyOn(productCenterApi, "exportCategoriesCsv");
    render(<ProductMasterDataManager kind="category" canWrite={false} onClose={vi.fn()} onChanged={vi.fn()} />);
    await screen.findByText("家居");
    fireEvent.change(screen.getByLabelText("搜索商品目录管理"), {
      target: { value: "  家居  " },
    });
    fireEvent.change(screen.getByLabelText("状态筛选"), {
      target: { value: "ACTIVE" },
    });
    const exportButton = screen.getByRole("button", { name: "导出 CSV" });
    await waitFor(() => expect((exportButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(exportButton);

    await waitFor(() => expect(exportCsv).toHaveBeenCalledWith({
      query: "家居",
      status: "ACTIVE",
    }));
    expect((await screen.findByRole("status")).textContent)
      .toContain("已导出 1 条商品类目。");
    expect(click).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:product-categories");
  });

  it("keeps category export usable after the bounded result is rejected", async () => {
    const exportCsv = vi
      .spyOn(productCenterApi, "exportCategoriesCsv")
      .mockRejectedValueOnce(new ApiError("conflict", { status: 409 }))
      .mockResolvedValue({
        filename: "product-categories.csv",
        mediaType: "text/csv;charset=UTF-8",
        rowCount: 1,
        content: "\uFEFF类目名称,排序,状态,创建时间,更新时间\r\n家居,10,启用,2026-07-30T10:00:00Z,2026-07-30T10:00:00Z\r\n",
      });
    vi.spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    render(<ProductMasterDataManager kind="category" canWrite onClose={vi.fn()} onChanged={vi.fn()} />);
    await screen.findByText("家居");
    fireEvent.click(screen.getByRole("button", { name: "导出 CSV" }));
    expect((await screen.findByRole("alert")).textContent)
      .toContain("筛选结果超过 10,000 条，请缩小筛选范围后重试。");

    fireEvent.click(screen.getByRole("button", { name: "导出 CSV" }));
    await waitFor(() => expect(exportCsv).toHaveBeenCalledTimes(2));
    expect((await screen.findByRole("status")).textContent)
      .toContain("已导出 1 条商品类目。");
  });

  it("downloads all package material rows for the active filters", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const exportCsv = vi.spyOn(productCenterApi, "exportPackageMaterialsCsv");
    render(<ProductMasterDataManager kind="package" canWrite={false} onClose={vi.fn()} onChanged={vi.fn()} />);
    await screen.findByText("纸箱");
    fireEvent.change(screen.getByLabelText("搜索包装资料管理"), {
      target: { value: "  CNY  " },
    });
    const exportButton = screen.getByRole("button", { name: "导出 CSV" });
    await waitFor(() => expect((exportButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(exportButton);

    await waitFor(() => expect(exportCsv).toHaveBeenCalledWith({
      query: "CNY",
      status: undefined,
    }));
    expect((await screen.findByRole("status")).textContent)
      .toContain("已导出 1 条包装资料。");
    expect(click).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:product-categories");
  });
});
