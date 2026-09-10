import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";

const runtime = vi.hoisted(() => ({
  blocker: vi.fn(),
  hasPermission: vi.fn(),
  pushes: [] as string[],
  search: "",
}));

vi.mock("@tanstack/react-router", () => ({
  useBlocker: runtime.blocker,
  useRouter: () => ({
    history: { push: (path: string) => runtime.pushes.push(path) },
  }),
  useRouterState: ({ select }: { select: (state: unknown) => string }) =>
    select({ location: { searchStr: runtime.search } }),
}));

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ hasPermission: runtime.hasPermission }),
}));

import {
  productCenterApi,
  type ProductSku,
  type ProductSpu,
} from "../modules/productCenterApi";
import {
  loadAllMasterData,
  ProductMasterDataPage,
  productMasterNewPath,
  productMasterPagePath,
} from "./ProductMasterDataPage";

const spuId = "11111111-1111-4111-8111-111111111111";
const skuId = "22222222-2222-4222-8222-222222222222";

function spu(overrides: Partial<ProductSpu> = {}): ProductSpu {
  return {
    id: spuId,
    businessCode: "MASTER_001",
    name: "中文名称",
    nameZh: "中文名称",
    nameEn: "English name",
    brandName: "兼容品牌",
    productNote: "已有备注",
    volumetricDivisor: 5000,
    sensitiveAttributeCodes: ["BATTERY", "MAGNETIC"],
    status: "ACTIVE",
    skuSummary: { totalSkuCount: 1, activeSkuCount: 1 },
    createdAt: "2026-07-30T10:00:00Z",
    updatedAt: "2026-07-30T10:00:00Z",
    version: 2,
    ...overrides,
  };
}

function skuPage() {
  return {
    items: [
      {
        id: skuId,
        spuId,
        businessCode: "SKU_001",
        name: "子商品",
        variantSummary: "蓝色",
        status: "ACTIVE" as const,
        createdAt: "2026-07-30T09:00:00Z",
        updatedAt: "2026-07-30T10:00:00Z",
        version: 1,
      },
    ],
    page: 0,
    size: 25,
    totalElements: 1,
    totalPages: 1,
  };
}

function sku(overrides: Partial<ProductSku> = {}): ProductSku {
  return {
    id: skuId,
    spuId,
    businessCode: "SKU_001",
    name: "子商品",
    variantSummary: "蓝色",
    status: "ACTIVE",
    createdAt: "2026-07-30T09:00:00Z",
    updatedAt: "2026-07-30T10:00:00Z",
    version: 1,
    ...overrides,
  };
}

beforeEach(() => {
  runtime.search = "?view=master&page=2&status=ACTIVE&keyword=needle";
  runtime.pushes = [];
  runtime.hasPermission.mockImplementation(
    (permission: string) => [
      "products.read",
      "products.write",
      "products.master_data.read",
      "iam:user:read",
    ].includes(permission),
  );
  vi.spyOn(productCenterApi, "getSpu").mockResolvedValue(spu());
  vi.spyOn(productCenterApi, "listSkus").mockResolvedValue(skuPage());
  vi.spyOn(productCenterApi, "createSpu").mockResolvedValue(spu());
  vi.spyOn(productCenterApi, "createSpuWithImages").mockResolvedValue(spu());
  vi.spyOn(productCenterApi, "updateSpu").mockResolvedValue(spu());
  vi.spyOn(productCenterApi, "listSpuImages").mockResolvedValue([]);
  vi.spyOn(productCenterApi, "listCategories").mockResolvedValue({
    items: [], page: 0, size: 200, totalElements: 0, totalPages: 0,
  });
  vi.spyOn(productCenterApi, "listPackageMaterials").mockResolvedValue({
    items: [], page: 0, size: 200, totalElements: 0, totalPages: 0,
  });
  vi.spyOn(productCenterApi, "listAssignableMembers").mockResolvedValue({
    items: [], page: 0, size: 100, totalElements: 0, totalPages: 0,
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:product-preview"),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  runtime.blocker.mockReset();
  runtime.hasPermission.mockReset();
});

function selectNewProductImage(name = "test-product.png") {
  const image = new File(["png"], name, { type: "image/png" });
  fireEvent.change(screen.getByLabelText("选择主商品图片文件"), {
    target: { files: [image] },
  });
  return image;
}

describe("ProductMasterDataPage", () => {
  it("creates a parent with its required product image and without child SKUs", async () => {
    const create = vi.spyOn(productCenterApi, "createSpuWithImages");
    render(<ProductMasterDataPage initialMode="edit" />);

    expect(screen.getByRole("heading", { name: "新增主商品" })).toBeTruthy();
    expect(screen.getByText("尚未添加子 SKU。可先保存主商品，或在此直接新增子 SKU 行后一起保存。")).toBeTruthy();
    expect(productCenterApi.listSkus).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("主 SKU"), {
      target: { value: "master_100" },
    });
    fireEvent.change(screen.getByLabelText("中文名称"), {
      target: { value: "新主商品" },
    });
    const image = new File(["png"], "master.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("选择主商品图片文件"), {
      target: { files: [image] },
    });
    fireEvent.click(screen.getByLabelText("含电池"));
    fireEvent.submit(document.getElementById("product-master-form")!);

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          businessCode: "MASTER_100",
          name: "新主商品",
          nameZh: "新主商品",
          sensitiveAttributeCodes: ["BATTERY"],
        }),
        [image],
      ),
    );
    expect(productCenterApi.listAssignableMembers).not.toHaveBeenCalled();
    expect(runtime.pushes).toContain(productMasterPagePath(spuId, runtime.search, true));
  });

  it("creates initial child SKU rows atomically with a new parent", async () => {
    const create = vi.spyOn(productCenterApi, "createSpuWithImages");
    render(<ProductMasterDataPage initialMode="edit" />);
    fireEvent.change(screen.getByLabelText("主 SKU"), { target: { value: "MASTER_101" } });
    fireEvent.change(screen.getByLabelText("中文名称"), { target: { value: "带子 SKU 的主商品" } });
    const image = new File(["png"], "master-with-sku.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("选择主商品图片文件"), { target: { files: [image] } });
    fireEvent.click(screen.getByRole("button", { name: "新增子 SKU" }));
    fireEvent.change(screen.getByLabelText("子 SKU 编码 1"), { target: { value: "SKU_101" } });
    fireEvent.change(screen.getByLabelText("子 SKU 名称 1"), { target: { value: "库存 SKU" } });
    fireEvent.submit(document.getElementById("product-master-form")!);

    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({
      initialSkus: [expect.objectContaining({ businessCode: "SKU_101", name: "库存 SKU", variantSummary: undefined })],
    }), [image]));
  });

  it("blocks a new parent without an image and focuses the recovery action", async () => {
    const create = vi.spyOn(productCenterApi, "createSpuWithImages");
    render(<ProductMasterDataPage initialMode="edit" />);
    fireEvent.change(screen.getByLabelText("主 SKU"), { target: { value: "MASTER_NO_IMAGE" } });
    fireEvent.change(screen.getByLabelText("中文名称"), { target: { value: "缺少图片的主商品" } });

    fireEvent.submit(document.getElementById("product-master-form")!);

    expect(await screen.findByText("请至少选择 1 张商品图片后再保存主商品。")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "选择图片" }));
    expect(create).not.toHaveBeenCalled();
  });

  it("blocks an initial SKU cost without its currency before creating the parent", async () => {
    const create = vi.spyOn(productCenterApi, "createSpuWithImages");
    render(<ProductMasterDataPage initialMode="edit" />);
    fireEvent.change(screen.getByLabelText("主 SKU"), { target: { value: "MASTER_102" } });
    fireEvent.change(screen.getByLabelText("中文名称"), { target: { value: "成本待补充主商品" } });
    fireEvent.click(screen.getByRole("button", { name: "新增子 SKU" }));
    fireEvent.change(screen.getByLabelText("子 SKU 编码 1"), { target: { value: "SKU_102" } });
    fireEvent.change(screen.getByLabelText("子 SKU 名称 1"), { target: { value: "库存 SKU" } });
    fireEvent.change(screen.getByLabelText("子 SKU 成本价 1"), { target: { value: "2.50" } });
    fireEvent.submit(document.getElementById("product-master-form")!);

    expect(await screen.findByText("第 1 行子 SKU：填写成本价后请选择币种。")).toBeTruthy();
    expect(create).not.toHaveBeenCalled();
  });

  it("creates selected new-master images with the parent and keeps them for a retry", async () => {
    const create = vi.spyOn(productCenterApi, "createSpu");
    const createWithImages = vi.spyOn(productCenterApi, "createSpuWithImages")
      .mockRejectedValueOnce(new ApiError("temporary", { status: 500 }))
      .mockResolvedValueOnce(spu());
    render(<ProductMasterDataPage initialMode="edit" />);
    fireEvent.change(screen.getByLabelText("主 SKU"), { target: { value: "MASTER_IMAGE" } });
    fireEvent.change(screen.getByLabelText("中文名称"), { target: { value: "带图片的主商品" } });
    const image = new File(["png"], "new-master.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("选择主商品图片文件"), { target: { files: [image] } });
    fireEvent.submit(document.getElementById("product-master-form")!);
    await screen.findByRole("alert");
    expect(create).not.toHaveBeenCalled();
    expect(createWithImages).toHaveBeenCalledWith(expect.objectContaining({ businessCode: "MASTER_IMAGE" }), [image]);
    fireEvent.submit(document.getElementById("product-master-form")!);
    await waitFor(() => expect(createWithImages).toHaveBeenCalledTimes(2));
    expect(runtime.pushes).toContain(productMasterPagePath(spuId, runtime.search, true));
  });

  it("loads every page of the tenant category directory before presenting the selector", async () => {
    const anotherCategoryId = "44444444-4444-4444-8444-444444444444";
    vi.spyOn(productCenterApi, "listCategories").mockImplementation(async ({ page }) => ({
      items: page === 0
        ? [{ id: "33333333-3333-4333-8333-333333333333", name: "家居", sortOrder: 10, status: "ACTIVE" as const, createdAt: "2026-07-30T10:00:00Z", updatedAt: "2026-07-30T10:00:00Z", version: 1 }]
        : [{ id: anotherCategoryId, name: "数码", sortOrder: 20, status: "ACTIVE" as const, createdAt: "2026-07-30T10:00:00Z", updatedAt: "2026-07-30T10:00:00Z", version: 1 }],
      page,
      size: 200,
      totalElements: 2,
      totalPages: 2,
    }));
    render(<ProductMasterDataPage initialMode="edit" />);
    await waitFor(() => expect(productCenterApi.listCategories).toHaveBeenCalledWith({ page: 1, size: 200 }));
    expect(screen.getByRole("option", { name: "数码" })).toBeTruthy();
  });

  it("rejects duplicate identities in a paged master-data directory", async () => {
    const item = { id: "33333333-3333-4333-8333-333333333333" };
    const loadPage = vi.fn()
      .mockResolvedValueOnce({
        items: [item],
        page: 0,
        size: 200,
        totalElements: 2,
        totalPages: 2,
      })
      .mockResolvedValueOnce({
        items: [item],
        page: 1,
        size: 200,
        totalElements: 2,
        totalPages: 2,
      });

    await expect(loadAllMasterData(loadPage))
      .rejects.toThrow("目录分页结果不一致，请刷新后重试。");
  });

  it("uploads a selected local image directly to the saved parent without a URL field", async () => {
    const upload = vi.spyOn(productCenterApi, "uploadSpuImage").mockResolvedValue({
      id: "33333333-3333-4333-8333-333333333333",
      spuId,
      contentType: "image/png",
      byteSize: 4,
      widthPixels: 1,
      heightPixels: 1,
      sortOrder: 0,
      primary: true,
      createdAt: "2026-07-30T10:00:00Z",
      updatedAt: "2026-07-30T10:00:00Z",
      version: 1,
    });
    render(<ProductMasterDataPage spuId={spuId} />);
    await screen.findByRole("heading", { name: "主商品详情" });

    const file = new File(["png"], "product.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("选择商品图片文件"), {
      target: { files: [file] },
    });

    await waitFor(() => expect(upload).toHaveBeenCalledWith(spuId, file, 0, true));
    expect(screen.queryByLabelText(/图片链接|图片 URL/i)).toBeNull();
  });

  it("keeps a failed direct image upload retryable with the same selected file", async () => {
    const upload = vi
      .spyOn(productCenterApi, "uploadSpuImage")
      .mockRejectedValueOnce(new ApiError("temporary", { status: 500 }))
      .mockResolvedValue({
        id: "33333333-3333-4333-8333-333333333333",
        spuId,
        contentType: "image/png",
        byteSize: 4,
        widthPixels: 1,
        heightPixels: 1,
        sortOrder: 0,
        primary: true,
        createdAt: "2026-07-30T10:00:00Z",
        updatedAt: "2026-07-30T10:00:00Z",
        version: 1,
      });
    render(<ProductMasterDataPage spuId={spuId} />);
    await screen.findByRole("heading", { name: "主商品详情" });
    const file = new File(["png"], "retry.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("选择商品图片文件"), {
      target: { files: [file] },
    });
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    expect(upload).toHaveBeenLastCalledWith(spuId, file, 0, true);
  });

  it("keeps the form local when the new master SKU code does not meet the backend rule", async () => {
    const create = vi.spyOn(productCenterApi, "createSpu");
    render(<ProductMasterDataPage initialMode="edit" />);

    fireEvent.change(screen.getByLabelText("主 SKU"), {
      target: { value: "1bad" },
    });
    fireEvent.change(screen.getByLabelText("中文名称"), {
      target: { value: "保留的中文名称" },
    });
    fireEvent.submit(document.getElementById("product-master-form")!);

    expect(create).not.toHaveBeenCalled();
    expect(screen.getByText("主 SKU 需为 2–64 位字母、数字、下划线或连字符，并以字母开头。")).toBeTruthy();
    expect(screen.getByDisplayValue("1BAD")).toBeTruthy();
    expect(screen.getByDisplayValue("保留的中文名称")).toBeTruthy();
  });

  it("calculates the visible volume and dimensional weight from the saved-unit fields", () => {
    render(<ProductMasterDataPage initialMode="edit" />);
    fireEvent.change(screen.getByLabelText("长（毫米）"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("宽（毫米）"), { target: { value: "200" } });
    fireEvent.change(screen.getByLabelText("高（毫米）"), { target: { value: "300" } });
    expect(screen.getByText("体积：6,000 cm³；体积重：1.2 kg。")) .toBeTruthy();
  });

  it("shows safe field feedback for a 400 envelope and preserves the new-master input", async () => {
    vi.spyOn(productCenterApi, "createSpuWithImages").mockRejectedValueOnce(
      new ApiError("private validation detail", {
        status: 400,
        code: "validation_failed",
        details: { businessCode: "invalid", name: "invalid" },
      }),
    );
    render(<ProductMasterDataPage initialMode="edit" />);

    fireEvent.change(screen.getByLabelText("主 SKU"), {
      target: { value: "master_400" },
    });
    fireEvent.change(screen.getByLabelText("中文名称"), {
      target: { value: "服务端拒绝后保留" },
    });
    selectNewProductImage("validation-error.png");
    fireEvent.submit(document.getElementById("product-master-form")!);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("提交信息不符合要求");
    expect(alert.textContent).not.toContain("private validation detail");
    expect(screen.getByText("请填写不超过 200 个字符的中文名称。")).toBeTruthy();
    expect((screen.getByLabelText("主 SKU") as HTMLInputElement).getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByDisplayValue("MASTER_400")).toBeTruthy();
    expect(screen.getByDisplayValue("服务端拒绝后保留")).toBeTruthy();
  });

  it("asks the user to log in again after a 401 and does not discard input", async () => {
    vi.spyOn(productCenterApi, "createSpuWithImages").mockRejectedValueOnce(
      new ApiError("private authentication detail", { status: 401 }),
    );
    render(<ProductMasterDataPage initialMode="edit" />);

    fireEvent.change(screen.getByLabelText("主 SKU"), {
      target: { value: "master_401" },
    });
    fireEvent.change(screen.getByLabelText("中文名称"), {
      target: { value: "登录失效后保留" },
    });
    selectNewProductImage("authentication-error.png");
    fireEvent.submit(document.getElementById("product-master-form")!);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("登录状态已失效，请重新登录");
    expect(alert.textContent).not.toContain("private authentication detail");
    expect(screen.getByDisplayValue("MASTER_401")).toBeTruthy();
    expect(screen.getByDisplayValue("登录失效后保留")).toBeTruthy();
  });

  it("reports a duplicate new-master code without submitting the same request twice", async () => {
    let rejectCreate!: (reason: unknown) => void;
    const pending = new Promise<ProductSpu>((_, reject) => {
      rejectCreate = reject;
    });
    const create = vi.spyOn(productCenterApi, "createSpuWithImages").mockReturnValue(pending);
    render(<ProductMasterDataPage initialMode="edit" />);

    fireEvent.change(screen.getByLabelText("主 SKU"), {
      target: { value: "master_409" },
    });
    fireEvent.change(screen.getByLabelText("中文名称"), {
      target: { value: "重复编码" },
    });
    selectNewProductImage("duplicate-code.png");
    const form = document.getElementById("product-master-form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));

    rejectCreate(new ApiError("duplicate code secret", {
      status: 409,
      code: "spu_business_code_conflict",
    }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("主 SKU 已存在");
    expect(alert.textContent).not.toContain("duplicate code secret");
    expect(screen.getByDisplayValue("MASTER_409")).toBeTruthy();
  });

  it("does not misreport image storage failures as duplicate master codes", async () => {
    vi.spyOn(productCenterApi, "createSpuWithImages").mockRejectedValueOnce(
      new ApiError("private storage detail", {
        status: 503,
        code: "product_image_storage_unavailable",
      }),
    );
    render(<ProductMasterDataPage initialMode="edit" />);

    fireEvent.change(screen.getByLabelText("主 SKU"), {
      target: { value: "storage_retry" },
    });
    fireEvent.change(screen.getByLabelText("中文名称"), {
      target: { value: "图片存储重试" },
    });
    selectNewProductImage("storage-retry.png");
    fireEvent.submit(document.getElementById("product-master-form")!);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("商品图片暂时无法保存");
    expect(alert.textContent).toContain("主商品尚未创建");
    expect(alert.textContent).not.toContain("主 SKU 已存在");
    expect(alert.textContent).not.toContain("private storage detail");
    expect(screen.getByDisplayValue("STORAGE_RETRY")).toBeTruthy();
  });

  it("loads an editable deep link and refills all governed V45 fields", async () => {
    const update = vi.spyOn(productCenterApi, "updateSpu");
    render(<ProductMasterDataPage spuId={spuId} initialMode="edit" />);

    await screen.findByDisplayValue("中文名称");
    expect(screen.getByDisplayValue("English name")).toBeTruthy();
    expect(screen.getByDisplayValue("已有备注")).toBeTruthy();
    expect((screen.getByLabelText("含电池") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("含磁性物质") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("heading", { name: "子 SKU" })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("中文名称"), {
      target: { value: "更新后的名称" },
    });
    fireEvent.submit(document.getElementById("product-master-form")!);

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        spuId,
        expect.objectContaining({
          name: "更新后的名称",
          nameZh: "更新后的名称",
          productNote: "已有备注",
          volumetricDivisor: 5000,
          sensitiveAttributeCodes: ["BATTERY", "MAGNETIC"],
          version: 2,
        }),
      ),
    );
  });

  it("retains historical inactive category and package selections while allowing only active choices", async () => {
    const categoryId = "33333333-3333-4333-8333-333333333333";
    const materialId = "44444444-4444-4444-8444-444444444444";
    vi.spyOn(productCenterApi, "getSpu").mockResolvedValue(spu({
      category: { id: categoryId, displayName: "历史类目" },
      packageMaterial: { id: materialId, displayName: "历史包材" },
      packageableCount: 2,
    }));
    vi.spyOn(productCenterApi, "listCategories").mockResolvedValue({
      items: [{ id: categoryId, name: "历史类目", sortOrder: 1, status: "INACTIVE", createdAt: "2026-07-30T10:00:00Z", updatedAt: "2026-07-30T10:00:00Z", version: 1 }],
      page: 0, size: 200, totalElements: 1, totalPages: 1,
    });
    vi.spyOn(productCenterApi, "listPackageMaterials").mockResolvedValue({
      items: [{ id: materialId, name: "历史包材", status: "ARCHIVED", createdByType: "TENANT_USER", createdBy: spuId, createdAt: "2026-07-30T10:00:00Z", updatedAt: "2026-07-30T10:00:00Z", version: 1 }],
      page: 0, size: 200, totalElements: 1, totalPages: 1,
    });
    render(<ProductMasterDataPage spuId={spuId} initialMode="edit" />);

    await screen.findByDisplayValue("中文名称");
    const category = screen.getByRole("option", { name: "历史类目（已停用）" }) as HTMLOptionElement;
    const material = screen.getByRole("option", { name: "历史包材（已归档）" }) as HTMLOptionElement;
    expect(category.selected).toBe(true);
    expect(category.disabled).toBe(false);
    expect(material.selected).toBe(true);
    expect(material.disabled).toBe(false);
  });

  it("manages saved-parent child SKUs in place through the shared SKU dialog", async () => {
    const create = vi
      .spyOn(productCenterApi, "createSku")
      .mockResolvedValue(sku({ id: "33333333-3333-4333-8333-333333333333" }));
    render(<ProductMasterDataPage spuId={spuId} initialMode="edit" />);

    await screen.findByText("SKU_001");
    fireEvent.click(screen.getByRole("button", { name: "新增 SKU" }));
    await screen.findByRole("dialog");
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText("业务编码")),
    );
    fireEvent.change(screen.getByLabelText("业务编码"), {
      target: { value: "SKU_002" },
    });
    fireEvent.change(screen.getByLabelText("名称"), {
      target: { value: "第二个子商品" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "保存" }).closest("form")!);

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        spuId,
        expect.objectContaining({ businessCode: "SKU_002", name: "第二个子商品" }),
      ),
    );
    await waitFor(() =>
      expect(runtime.pushes).toContain(
        `/products/master/${spuId}?view=master&status=ACTIVE&keyword=needle&page=2&skuId=33333333-3333-4333-8333-333333333333`,
      ),
    );
  });

  it("pages through link candidates even when the current page only contains existing children", async () => {
    const externalSpuId = "33333333-3333-4333-8333-333333333333";
    const externalSku = sku({
      id: "44444444-4444-4444-8444-444444444444",
      spuId: externalSpuId,
      businessCode: "SKU_EXTERNAL",
      name: "外部子商品",
    });
    const list = vi.spyOn(productCenterApi, "listSkus")
      .mockImplementation(async (request) => {
        if (request.spuId) return skuPage();
        return {
          items: request.page === 0 ? [sku()] : [externalSku],
          page: request.page,
          size: 50,
          totalElements: 2,
          totalPages: 2,
        };
      });
    render(<ProductMasterDataPage spuId={spuId} initialMode="edit" />);

    await screen.findByText("SKU_001");
    fireEvent.change(screen.getByLabelText("库存 SKU"), {
      target: { value: "SKU" },
    });
    const linkSection = screen.getByRole("region", { name: "关联已有子 SKU" });
    fireEvent.click(within(linkSection).getByRole("button", { name: "搜索" }));

    expect(await screen.findByText("当前页未找到可关联的启用库存 SKU。")).toBeTruthy();
    const pagination = screen.getByRole("navigation", { name: "可关联子 SKU 分页" });
    fireEvent.click(within(pagination).getByRole("button", { name: "下一页" }));
    expect(await screen.findByText("SKU_EXTERNAL")).toBeTruthy();
    expect(list).toHaveBeenCalledWith({
      keyword: "SKU", status: "ACTIVE", page: 0, size: 50,
    });
    expect(list).toHaveBeenCalledWith({
      keyword: "SKU", status: "ACTIVE", page: 1, size: 50,
    });
  });

  it("keeps child input on a 409 and refreshes against the original parent", async () => {
    const update = vi
      .spyOn(productCenterApi, "updateSku")
      .mockRejectedValueOnce(new ApiError("child conflict secret", { status: 409 }));
    const get = vi.spyOn(productCenterApi, "getSku").mockResolvedValue(
      sku({ version: 2 }),
    );
    render(<ProductMasterDataPage spuId={spuId} initialMode="edit" />);

    await screen.findByText("SKU_001");
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByLabelText("名称"), {
      target: { value: "本地子商品草稿" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "保存" }).closest("form")!);

    await screen.findByRole("alert");
    expect(screen.getByDisplayValue("本地子商品草稿")).toBeTruthy();
    expect(get).toHaveBeenCalledWith(skuId, spuId);
    expect(update).toHaveBeenCalledWith(
      skuId,
      expect.objectContaining({ version: 1 }),
      spuId,
    );
  });

  it("uses the shared two-step archive confirmation and restores a selected child URL", async () => {
    runtime.search = `?view=master&page=2&status=ACTIVE&keyword=needle&skuId=${skuId}`;
    const archive = vi
      .spyOn(productCenterApi, "archiveSku")
      .mockResolvedValue(sku({ status: "ARCHIVED", version: 2 }));
    render(<ProductMasterDataPage spuId={spuId} initialMode="edit" />);

    await screen.findByText("SKU_001");
    await waitFor(() =>
      expect(document.activeElement?.id).toBe(`product-sku-row-${skuId}`),
    );
    fireEvent.click(screen.getByRole("button", { name: "归档" }));
    fireEvent.submit(screen.getByRole("button", { name: "继续确认" }).closest("form")!);
    fireEvent.submit(screen.getByRole("button", { name: "确认归档" }).closest("form")!);

    await waitFor(() => expect(archive).toHaveBeenCalledWith(skuId, 1, spuId));
  });

  it("keeps the unsaved-parent child-SKU gate and disables only creation for an inactive parent", async () => {
    vi.spyOn(productCenterApi, "getSpu").mockResolvedValue(spu({ status: "INACTIVE" }));
    render(<ProductMasterDataPage spuId={spuId} initialMode="edit" />);

    await screen.findByText("SKU_001");
    expect(screen.queryByRole("button", { name: "新增 SKU" })).toBeNull();
    expect(screen.getByRole("button", { name: "编辑" })).toBeTruthy();
  });

  it("retries child-list failures without exposing server details", async () => {
    const list = vi
      .spyOn(productCenterApi, "listSkus")
      .mockRejectedValueOnce(new ApiError("child list secret", { status: 500 }))
      .mockResolvedValueOnce(skuPage());
    render(<ProductMasterDataPage spuId={spuId} initialMode="edit" />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toContain("child list secret");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByText("SKU_001");
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("ignores an older child-list response after SKU query history changes", async () => {
    let resolveStale!: (value: ReturnType<typeof skuPage>) => void;
    const stale = new Promise<ReturnType<typeof skuPage>>((resolve) => {
      resolveStale = resolve;
    });
    const fresh = {
      ...skuPage(),
      items: [sku({ id: "33333333-3333-4333-8333-333333333333", businessCode: "SKU_NEW" })],
    };
    const list = vi
      .spyOn(productCenterApi, "listSkus")
      .mockReturnValueOnce(stale)
      .mockResolvedValueOnce(fresh);
    const view = render(<ProductMasterDataPage spuId={spuId} initialMode="edit" />);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));

    runtime.search = "?view=master&page=2&status=ACTIVE&keyword=needle&skuPage=1";
    view.rerender(<ProductMasterDataPage spuId={spuId} initialMode="edit" />);
    await screen.findByText("SKU_NEW");
    resolveStale(skuPage());
    await Promise.resolve();
    expect(screen.getByText("SKU_NEW")).toBeTruthy();
    expect(screen.queryByText("SKU_001")).toBeNull();
  });

  it("keeps draft input after a conflict and refreshes only the version source", async () => {
    const latest = spu({ version: 3, productNote: "其他人更新的备注" });
    vi.spyOn(productCenterApi, "updateSpu").mockRejectedValueOnce(
      new ApiError("conflict secret", { status: 409 }),
    );
    const get = vi.spyOn(productCenterApi, "getSpu")
      .mockResolvedValueOnce(spu())
      .mockResolvedValueOnce(latest);
    render(<ProductMasterDataPage spuId={spuId} initialMode="edit" />);
    await screen.findByDisplayValue("中文名称");
    fireEvent.change(screen.getByLabelText("商品备注"), {
      target: { value: "我的未保存备注" },
    });
    fireEvent.submit(document.getElementById("product-master-form")!);

    await screen.findByRole("alert");
    expect(screen.getByDisplayValue("我的未保存备注")).toBeTruthy();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("stops safely when the fail-closed 409 refresh rejects a mismatched identity", async () => {
    const update = vi.spyOn(productCenterApi, "updateSpu")
      .mockRejectedValueOnce(new ApiError("conflict secret", { status: 409 }))
      .mockResolvedValueOnce(spu());
    const get = vi.spyOn(productCenterApi, "getSpu")
      .mockResolvedValueOnce(spu())
      .mockRejectedValueOnce(new Error("Invalid product API response: spu.id"));
    render(<ProductMasterDataPage spuId={spuId} initialMode="edit" />);
    await screen.findByDisplayValue("中文名称");
    fireEvent.change(screen.getByLabelText("商品备注"), {
      target: { value: "保留的输入" },
    });
    fireEvent.submit(document.getElementById("product-master-form")!);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toContain("spu.id");
    expect(get).toHaveBeenLastCalledWith(spuId);
    expect(update).toHaveBeenCalledTimes(1);

    fireEvent.submit(document.getElementById("product-master-form")!);
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls[1][0]).toBe(spuId);
  });

  it("keeps the existing archive action on the full-page editor", async () => {
    const archive = vi.spyOn(productCenterApi, "archiveSpu").mockResolvedValue(
      spu({ status: "ARCHIVED", version: 3 }),
    );
    render(<ProductMasterDataPage spuId={spuId} initialMode="edit" />);
    await screen.findByDisplayValue("中文名称");
    fireEvent.click(screen.getByRole("button", { name: "归档主商品" }));

    await waitFor(() => expect(archive).toHaveBeenCalledWith(spuId, 2));
    expect(runtime.pushes).toContain(productMasterPagePath(spuId, runtime.search));
  });

  it("retries a safe not-found error and ignores an older direct-link response", async () => {
    const nextId = "33333333-3333-4333-8333-333333333333";
    const first = new Promise<ProductSpu>(() => undefined);
    vi.spyOn(productCenterApi, "getSpu")
      .mockRejectedValueOnce(new ApiError("not found secret", { status: 404 }))
      .mockResolvedValueOnce(spu());
    const notFound = render(<ProductMasterDataPage spuId={spuId} />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toContain("not found secret");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByDisplayValue("中文名称");
    notFound.unmount();

    vi.spyOn(productCenterApi, "getSpu")
      .mockReset()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce(spu({ id: nextId, businessCode: "MASTER_002" }));
    const view = render(<ProductMasterDataPage spuId={spuId} />);
    view.rerender(<ProductMasterDataPage spuId={nextId} />);
    await screen.findByDisplayValue("MASTER_002");
  });

  it("does not request an invalid direct-link identifier", () => {
    const get = vi.spyOn(productCenterApi, "getSpu");
    render(<ProductMasterDataPage spuId="not-a-uuid" />);

    expect(screen.getByRole("alert").textContent).toContain("主商品地址无效");
    expect(get).not.toHaveBeenCalled();
  });

  it("keeps only master-list context in shareable page and return URLs", async () => {
    expect(productMasterNewPath("?view=online&listingPage=4")).toBe("/products/master/new?view=master");
    expect(productMasterPagePath(spuId, runtime.search, true)).toBe(
      `/products/master/${spuId}?view=master&status=ACTIVE&keyword=needle&page=2&mode=edit`,
    );
    render(<ProductMasterDataPage spuId={spuId} />);
    await screen.findByDisplayValue("中文名称");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(runtime.pushes).toContain(
      "/products?view=master&status=ACTIVE&keyword=needle&page=2",
    );
  });

  it("asks before discarding a local form change", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<ProductMasterDataPage initialMode="edit" />);
    fireEvent.change(screen.getByLabelText("中文名称"), {
      target: { value: "未保存" },
    });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(runtime.pushes).toEqual([]);
    expect(window.confirm).toHaveBeenCalled();
  });

  it("preserves all master filters and sort settings through edit and cancel", async () => {
    const filters = new URLSearchParams({ view: "master", status: "ACTIVE", keyword: "背包 & 蓝色", page: "2", size: "50", searchField: "NAME_ZH", categoryId: spuId, creatorId: skuId, createdFrom: "2026-09-01", createdTo: "2026-09-07", sortBy: "CREATED_AT", descending: "true" });
    const source = `?${filters}&skuPage=4&skuKeyword=child&listingPage=3&from=https://outside.example`;
    const editPath = productMasterPagePath(spuId, source, true);
    expect(Object.fromEntries(new URLSearchParams(editPath.split("?")[1]))).toEqual({ ...Object.fromEntries(filters), mode: "edit" });
    expect(Object.fromEntries(new URLSearchParams(productMasterNewPath(source).split("?")[1]))).toEqual(Object.fromEntries(filters));
    runtime.search = `?${editPath.split("?")[1]}`;
    render(<ProductMasterDataPage spuId={spuId} />);
    await screen.findByDisplayValue("中文名称");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(Object.fromEntries(new URLSearchParams(runtime.pushes.at(-1)!.split("?")[1]))).toEqual(Object.fromEntries(filters));
  });
});
