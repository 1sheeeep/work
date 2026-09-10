import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "../api/client";
import { productCenterApi } from "./productCenterApi";

afterEach(() => vi.restoreAllMocks());

const spuId = "10000000-0000-4000-8000-000000000001";
const otherSpuId = "20000000-0000-4000-8000-000000000002";
const skuId = "30000000-0000-4000-8000-000000000003";
const otherSkuId = "40000000-0000-4000-8000-000000000004";
const thumbnailImageId = "50000000-0000-4000-8000-000000000005";
const shopId = "60000000-0000-4000-8000-000000000006";
const listingId = "70000000-0000-4000-8000-000000000007";

function spuResponse(id = spuId) {
  return {
    id,
    businessCode: "SPU_1",
    name: "Name",
    volumetricDivisor: 5000,
    sensitiveAttributeCodes: [],
    status: "ACTIVE",
    skuSummary: { totalSkuCount: 0, activeSkuCount: 0 },
    createdAt: "2026-07-28T10:00:00Z",
    updatedAt: "2026-07-28T10:00:00Z",
    version: 2,
  };
}

function skuResponse(
  id = skuId,
  parentSpuId = spuId,
) {
  return {
    id,
    spuId: parentSpuId,
    businessCode: "SKU_1",
    name: "Name",
    status: "ACTIVE",
    createdAt: "2026-07-28T09:00:00Z",
    updatedAt: "2026-07-28T10:00:00Z",
    version: 2,
  };
}

describe("productCenterApi", () => {
  it("sends only supported SPU query parameters and no tenant selector", async () => {
    const request = vi.spyOn(apiClient, "request").mockResolvedValue({
      items: [],
      page: 0,
      size: 25,
      totalElements: 0,
      totalPages: 0,
    });
    await productCenterApi.listSpus({
      status: "ACTIVE",
      keyword: "CODE",
      page: 0,
      size: 25,
    });
    expect(request).toHaveBeenCalledWith(
      "/api/v1/product-center/spus?status=ACTIVE&keyword=CODE&page=0&size=25",
    );
    expect(JSON.stringify(request.mock.calls[0])).not.toContain("tenantId");
    expect(JSON.stringify(request.mock.calls[0])).not.toContain("X-Tenant-Id");
  });

  it("uses the product-scoped assignable-member directory and projects no IAM profile fields", async () => {
    const request = vi.spyOn(apiClient, "request").mockResolvedValue({
      items: [{ id: spuId, displayName: "商品开发员", email: "private@example.com" }],
      page: 0,
      size: 100,
      totalElements: 1,
      totalPages: 1,
    });
    const result = await productCenterApi.listAssignableMembers({ page: 0, size: 100 });
    expect(request).toHaveBeenCalledWith(
      "/api/v1/product-center/master-data/assignable-members?page=0&size=100",
    );
    expect(result.items).toEqual([{ id: spuId, displayName: "商品开发员" }]);
    expect(JSON.stringify(result.items)).not.toContain("private@example.com");
  });

  it("maps listing responses to safe business fields only", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue({
      items: [
        {
          id: "listing-1",
          shopId: "shop-1",
          platformId: "platform-1",
          skuId: "sku-1",
          sku: {
            id: "sku-1",
            businessCode: "SKU_001",
            name: "测试库存商品",
          },
          externalListingRef: "listing-ref",
          metadataNote: "controlled audit note",
          status: "ACTIVE",
          updatedAt: "2026-07-28T10:00:00Z",
          version: 2,
          credentialReference: "vault://secret",
          rawPayload: { token: "secret" },
        },
      ],
      page: 0,
      size: 25,
      totalElements: 1,
      totalPages: 1,
    });
    const result = await productCenterApi.listListings({ page: 0, size: 25 });
    expect(result.items[0]).toMatchObject({
      externalListingRef: "listing-ref",
      sku: {
        businessCode: "SKU_001",
        name: "测试库存商品",
      },
      version: 2,
    });
    expect(result.items[0]).not.toHaveProperty("credentialReference");
    expect(result.items[0]).not.toHaveProperty("rawPayload");
    expect(result.items[0]).not.toHaveProperty("metadataNote");
  });

  it("rejects a listing SKU summary that does not match the mapped SKU", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue({
      items: [
        {
          id: "listing-1",
          shopId: "shop-1",
          platformId: "platform-1",
          skuId: "sku-1",
          sku: {
            id: "sku-2",
            businessCode: "SKU_002",
            name: "错误库存商品",
          },
          externalListingRef: "listing-ref",
          status: "ACTIVE",
          updatedAt: "2026-07-28T10:00:00Z",
          version: 2,
        },
      ],
      page: 0,
      size: 25,
      totalElements: 1,
      totalPages: 1,
    });

    await expect(
      productCenterApi.listListings({ page: 0, size: 25 }),
    ).rejects.toThrow("Invalid product API response: listing.sku.id");
  });

  it("loads strict tenant-derived active listing counts for requested SKUs", async () => {
    const request = vi.spyOn(apiClient, "request").mockResolvedValue({
      items: [
        { skuId, activeListingCount: 3 },
        { skuId: otherSkuId, activeListingCount: 0 },
      ],
    });

    await expect(
      productCenterApi.listSkuListingSummaries([skuId, otherSkuId]),
    ).resolves.toEqual([
      { skuId, activeListingCount: 3 },
      { skuId: otherSkuId, activeListingCount: 0 },
    ]);
    expect(request).toHaveBeenCalledWith(
      `/api/v1/product-center/skus/listing-summaries?skuId=${skuId}&skuId=${otherSkuId}`,
    );
    expect(JSON.stringify(request.mock.calls[0])).not.toContain("tenantId");
  });

  it("rejects listing-summary identities outside the requested SKU set", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue({
      items: [{ skuId: spuId, activeListingCount: 1 }],
    });

    await expect(
      productCenterApi.listSkuListingSummaries([skuId]),
    ).rejects.toThrow(
      "Invalid product API response: skuListingSummaries",
    );
  });

  it("maps governed V45 SPU fields needed to preserve an existing edit", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue({
      id: spuId,
      businessCode: "SPU_1",
      name: "Name",
      nameZh: "中文名",
      nameEn: "English name",
      productNote: "已有备注",
      category: { id: spuId, displayName: "家居类" },
      lengthMm: 100,
      widthMm: 50,
      heightMm: 20,
      actualWeightGrams: 300,
      volumetricDivisor: 6000,
      packageMaterial: { id: otherSpuId, displayName: "纸箱" },
      packageableCount: 2,
      sensitiveAttributeCodes: ["BATTERY", "MAGNETIC"],
      status: "ACTIVE",
      skuSummary: { totalSkuCount: 0, activeSkuCount: 0 },
      createdAt: "2026-07-28T10:00:00Z",
      updatedAt: "2026-07-28T10:00:00Z",
      version: 2,
    });

    await expect(productCenterApi.getSpu(spuId)).resolves.toMatchObject({
      nameZh: "中文名",
      productNote: "已有备注",
      category: { displayName: "家居类" },
      volumetricDivisor: 6000,
      sensitiveAttributeCodes: ["BATTERY", "MAGNETIC"],
    });
  });

  it("keeps signed warehouse inventory totals while retaining strict response validation", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue({
      items: [{
        ...spuResponse(),
        metrics: {
          totalInventory: -3,
          sales7: 0,
          sales28: 0,
          sales42: 0,
          forecastDailySales: 0,
        },
      }],
      page: 0,
      size: 25,
      totalElements: 1,
      totalPages: 1,
    });

    await expect(productCenterApi.listSpus({ page: 0, size: 25 }))
      .resolves.toMatchObject({ items: [{ metrics: { totalInventory: -3 } }] });
  });

  it("sends the supported minimal master-product create body without a tenant selector", async () => {
    const request = vi.spyOn(apiClient, "request").mockResolvedValue(spuResponse());

    await productCenterApi.createSpu({
      businessCode: "MASTER_100",
      name: "新主商品",
      nameZh: "新主商品",
      sensitiveAttributeCodes: [],
    });

    expect(request).toHaveBeenCalledWith("/api/v1/product-center/spus", {
      method: "POST",
      body: {
        businessCode: "MASTER_100",
        name: "新主商品",
        nameZh: "新主商品",
        nameEn: undefined,
        brandName: undefined,
        productNote: undefined,
        categoryId: undefined,
        lengthMm: undefined,
        widthMm: undefined,
        heightMm: undefined,
        actualWeightGrams: undefined,
        volumetricDivisor: undefined,
        packageMaterialId: undefined,
        packageableCount: undefined,
        artMemberId: undefined,
        developerMemberId: undefined,
        developerAssistantMemberId: undefined,
        salesMemberId: undefined,
        sensitiveAttributeCodes: [],
      },
    });
    expect(JSON.stringify(request.mock.calls[0])).not.toContain("tenantId");
  });

  it("rejects unknown or unstable sensitive attribute codes fail-closed", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue({
      id: spuId,
      businessCode: "SPU_1",
      name: "Name",
      volumetricDivisor: 5000,
      sensitiveAttributeCodes: ["MAGNETIC", "BATTERY"],
      status: "ACTIVE",
      skuSummary: { totalSkuCount: 0, activeSkuCount: 0 },
      createdAt: "2026-07-28T10:00:00Z",
      updatedAt: "2026-07-28T10:00:00Z",
      version: 2,
    });

    await expect(productCenterApi.getSpu(spuId)).rejects.toThrow(
      "Invalid product API response: spu.sensitiveAttributeCodes",
    );
  });

  it("rejects a mismatched SPU identity for direct reads and mutations", async () => {
    const request = vi
      .spyOn(apiClient, "request")
      .mockResolvedValue(spuResponse(otherSpuId));

    await expect(productCenterApi.getSpu(spuId)).rejects.toThrow(
      "Invalid product API response: spu.id",
    );
    await expect(
      productCenterApi.updateSpu(spuId, {
        name: "Name",
        status: "ACTIVE",
        version: 2,
      }),
    ).rejects.toThrow("Invalid product API response: spu.id");
    await expect(productCenterApi.archiveSpu(spuId, 2)).rejects.toThrow(
      "Invalid product API response: spu.id",
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      `/api/v1/product-center/spus/${spuId}`,
      expect.any(Object),
    );
    expect(request).toHaveBeenNthCalledWith(
      3,
      `/api/v1/product-center/spus/${spuId}/archive`,
      expect.any(Object),
    );
  });

  it("sends direct-image creates and updates as multipart requests with identity checks", async () => {
    const request = vi.spyOn(apiClient, "request").mockResolvedValue(spuResponse());
    const image = new File(["png"], "product.png", { type: "image/png" });
    await productCenterApi.createSpuWithImages({ businessCode: "SPU_IMAGE", name: "Name" }, [image]);
    expect(request).toHaveBeenCalledWith("/api/v1/product-center/spus/with-images", expect.objectContaining({ method: "POST" }));
    const createBody = request.mock.calls[0][1]?.body;
    expect(createBody).toBeInstanceOf(FormData);
    expect((createBody as FormData).getAll("images")).toEqual([image]);

    request.mockResolvedValue(spuResponse(otherSpuId));
    await expect(productCenterApi.updateSpuWithImages(spuId, {
      name: "Name", status: "ACTIVE", version: 2,
    }, [image])).rejects.toThrow("Invalid product API response: spu.id");
    expect(request).toHaveBeenLastCalledWith(
      `/api/v1/product-center/spus/${spuId}/with-images`,
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("rejects a direct-image create without at least one image", async () => {
    const request = vi.spyOn(apiClient, "request");

    await expect(productCenterApi.createSpuWithImages({
      businessCode: "SPU_NO_IMAGE",
      name: "No image",
    }, [])).rejects.toThrow("New master products require 1 to 10 images");

    expect(request).not.toHaveBeenCalled();
  });

  it("rejects non-UUID SPU identities returned by create and list responses", async () => {
    const request = vi
      .spyOn(apiClient, "request")
      .mockResolvedValue(spuResponse("not-a-uuid"));

    await expect(
      productCenterApi.createSpu({ businessCode: "SPU_1", name: "Name" }),
    ).rejects.toThrow("Invalid product API response: spu.id");

    request.mockResolvedValue({
      items: [spuResponse("not-a-uuid")],
      page: 0,
      size: 25,
      totalElements: 1,
      totalPages: 1,
    });
    await expect(productCenterApi.listSpus({ page: 0, size: 25 })).rejects.toThrow(
      "Invalid product API response: spu.id",
    );
  });

  it("rejects malformed product responses instead of exposing partially trusted data", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue({
      items: [{ id: "spu-1", businessCode: "SPU_1" }],
      page: 0,
      size: 25,
      totalElements: 1,
      totalPages: 1,
    });
    await expect(
      productCenterApi.listSpus({ page: 0, size: 25 }),
    ).rejects.toThrow("Invalid product API response");
  });

  it("binds master-data refreshes to the requested category and package material", async () => {
    const request = vi.spyOn(apiClient, "request");
    request.mockResolvedValueOnce({
      id: otherSpuId,
      name: "类目",
      sortOrder: 10,
      status: "ACTIVE",
      createdAt: "2026-07-28T10:00:00Z",
      updatedAt: "2026-07-28T10:00:00Z",
      version: 1,
    });
    await expect(productCenterApi.getCategory(spuId)).rejects.toThrow(
      "Invalid product API response: productCategory.id",
    );

    request.mockResolvedValueOnce({
      id: otherSpuId,
      name: "包材",
      status: "ACTIVE",
      createdByType: "TENANT_USER",
      createdBy: spuId,
      createdAt: "2026-07-28T10:00:00Z",
      updatedAt: "2026-07-28T10:00:00Z",
      version: 1,
    });
    await expect(productCenterApi.getPackageMaterial(spuId)).rejects.toThrow(
      "Invalid product API response: packageMaterial.id",
    );
  });

  it("passes supported listing filters only", async () => {
    const request = vi.spyOn(apiClient, "request").mockResolvedValue({
      items: [],
      page: 0,
      size: 25,
      totalElements: 0,
      totalPages: 0,
    });
    await productCenterApi.listListings({
      status: "INACTIVE",
      keyword: "listing-ref",
      searchField: "INVENTORY_SKU",
      page: 0,
      size: 25,
    });
    expect(request).toHaveBeenCalledWith(
      "/api/v1/product-center/listings?status=INACTIVE&keyword=listing-ref&searchField=INVENTORY_SKU&page=0&size=25",
    );
  });

  it("loads Shopify catalog preview with strict SKU match mapping", async () => {
    const request = vi.spyOn(apiClient, "request").mockResolvedValue({
      mode: "XZ_ERP_APP",
      connectionStatus: "CONNECTED",
      cursor: "next-cursor",
      hasNextPage: true,
      fetchedAt: "2026-07-31T06:00:00Z",
      products: [{
        externalListingRef: "gid://shopify/Product/1",
        title: "HD Sunglasses",
        handle: "hd-sunglasses",
        externalStatus: "ACTIVE",
        updatedAt: "2026-07-31T05:59:00Z",
        variants: [{
          externalVariantRef: "gid://shopify/ProductVariant/10",
          inventoryItemRef: "gid://shopify/InventoryItem/20",
          platformSku: "HD-B-M",
          title: "Black / M",
          price: "19.99",
          currencyCode: "USD",
          availableForSale: true,
          inventoryTracked: true,
          matchStatus: "EXACT_SKU_MATCH",
          localSku: {
            id: skuId,
            businessCode: "HD-B-M",
            name: "HD Black M",
            status: "ACTIVE",
          },
        }],
      }],
    });

    await expect(productCenterApi.previewShopifyCatalog({
      shopId,
      limit: 25,
      query: "status:active",
    })).resolves.toMatchObject({
      mode: "XZ_ERP_APP",
      connectionStatus: "CONNECTED",
      products: [{
        externalListingRef: "gid://shopify/Product/1",
        variants: [{
          externalVariantRef: "gid://shopify/ProductVariant/10",
          matchStatus: "EXACT_SKU_MATCH",
          localSku: { id: skuId, businessCode: "HD-B-M" },
        }],
      }],
    });
    expect(request).toHaveBeenCalledWith(
      `/api/v1/product-center/listings/shopify/catalog-preview?shopId=${shopId}&limit=25&query=status%3Aactive`,
    );
  });

  it("rejects inconsistent Shopify catalog preview match payloads", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue({
      mode: "XZ_ERP_APP",
      connectionStatus: "CONNECTED",
      hasNextPage: false,
      fetchedAt: "2026-07-31T06:00:00Z",
      products: [{
        externalListingRef: "gid://shopify/Product/1",
        title: "HD Sunglasses",
        variants: [{
          externalVariantRef: "gid://shopify/ProductVariant/10",
          title: "Black / M",
          availableForSale: true,
          inventoryTracked: true,
          matchStatus: "EXACT_SKU_MATCH",
          localSku: null,
        }],
      }],
    });

    await expect(productCenterApi.previewShopifyCatalog({
      shopId,
      limit: 25,
    })).rejects.toThrow(
      "Invalid product API response: shopifyCatalogVariant.localSku",
    );
  });

  it("imports selected Shopify catalog variants without tenant selectors", async () => {
    const request = vi.spyOn(apiClient, "request").mockResolvedValue({
      requestedCount: 1,
      importedCount: 1,
      skippedCount: 0,
      items: [{
        externalListingRef: "gid://shopify/Product/1",
        externalVariantRef: "gid://shopify/ProductVariant/10",
        platformSku: "HD-B-M",
        skuId,
        listingId,
        status: "IMPORTED_OR_ALREADY_BOUND",
      }],
    });

    await expect(productCenterApi.importShopifyCatalogListings({
      shopId,
      limit: 25,
      query: "status:active",
      externalVariantRefs: ["gid://shopify/ProductVariant/10"],
    })).resolves.toMatchObject({
      requestedCount: 1,
      importedCount: 1,
      items: [{
        externalVariantRef: "gid://shopify/ProductVariant/10",
        skuId,
        listingId,
        status: "IMPORTED_OR_ALREADY_BOUND",
      }],
    });
    expect(request).toHaveBeenCalledWith(
      "/api/v1/product-center/listings/shopify/catalog-import",
      {
        method: "POST",
        body: {
          shopId,
          limit: 25,
          cursor: undefined,
          query: "status:active",
          externalVariantRefs: ["gid://shopify/ProductVariant/10"],
        },
      },
    );
    expect(JSON.stringify(request.mock.calls[0])).not.toContain("tenantId");
  });

  it("uses only the selected SPU and supported pagination fields for SKU reads", async () => {
    const request = vi.spyOn(apiClient, "request").mockResolvedValue({
      items: [],
      page: 0,
      size: 100,
      totalElements: 0,
      totalPages: 0,
    });
    await productCenterApi.listSkus({
      spuId,
      page: 0,
      size: 100,
    });
    expect(request).toHaveBeenCalledWith(
      `/api/v1/product-center/skus?spuId=${spuId}&page=0&size=100`,
    );
    expect(JSON.stringify(request.mock.calls[0])).not.toContain("tenantId");
  });

  it("permits tenant-scoped SKU search without an SPU selector", async () => {
    const categoryId = "10000000-0000-4000-8000-000000000001";
    const developerMemberId = "10000000-0000-4000-8000-000000000002";
    const developerAssistantMemberId = "10000000-0000-4000-8000-000000000003";
    const salesMemberId = "10000000-0000-4000-8000-000000000004";
    const artMemberId = "10000000-0000-4000-8000-000000000005";
    const creatorId = "10000000-0000-4000-8000-000000000006";
    const request = vi.spyOn(apiClient, "request").mockResolvedValue({
      items: [],
      page: 0,
      size: 25,
      totalElements: 0,
      totalPages: 0,
    });
    await productCenterApi.listSkus({
      status: "ACTIVE",
      keyword: "match",
      categoryId,
      developerMemberId,
      developerAssistantMemberId,
      salesMemberId,
      artMemberId,
      creatorId,
      createdFrom: "2026-06-30T16:00:00.000Z",
      createdTo: "2026-07-31T16:00:00.000Z",
      searchField: "NAME_EN",
      matchMode: "STARTS_WITH",
      page: 0,
      size: 25,
    });
    expect(request).toHaveBeenCalledWith(
      `/api/v1/product-center/skus?status=ACTIVE&keyword=match&categoryId=${categoryId}&developerMemberId=${developerMemberId}&developerAssistantMemberId=${developerAssistantMemberId}&salesMemberId=${salesMemberId}&artMemberId=${artMemberId}&creatorId=${creatorId}&createdFrom=2026-06-30T16%3A00%3A00.000Z&createdTo=2026-07-31T16%3A00%3A00.000Z&searchField=NAME_EN&matchMode=STARTS_WITH&page=0&size=25`,
    );
  });

  it("omits the default all-field SKU search dimension", async () => {
    const request = vi.spyOn(apiClient, "request").mockResolvedValue({
      items: [],
      page: 0,
      size: 25,
      totalElements: 0,
      totalPages: 0,
    });
    await productCenterApi.listSkus({
      searchField: "ALL",
      matchMode: "CONTAINS",
      page: 0,
      size: 25,
    });
    expect(request).toHaveBeenCalledWith(
      "/api/v1/product-center/skus?page=0&size=25",
    );
  });

  it("serializes original SKU searches", async () => {
    const request = vi.spyOn(apiClient, "request").mockResolvedValue({
      items: [],
      page: 0,
      size: 25,
      totalElements: 0,
      totalPages: 0,
    });
    await productCenterApi.listSkus({
      keyword: "blue_m",
      searchField: "ORIGINAL_SKU",
      matchMode: "ENDS_WITH",
      page: 0,
      size: 25,
    });
    expect(request).toHaveBeenCalledWith(
      "/api/v1/product-center/skus?keyword=blue_m&searchField=ORIGINAL_SKU&matchMode=ENDS_WITH&page=0&size=25",
    );
  });

  it("sends only non-default inventory SKU ordering", async () => {
    const request = vi.spyOn(apiClient, "request").mockResolvedValue({
      items: [],
      page: 0,
      size: 25,
      totalElements: 0,
      totalPages: 0,
    });
    await productCenterApi.listSkus({
      sortBy: "CREATED_AT",
      descending: true,
      page: 0,
      size: 25,
    });
    expect(request).toHaveBeenCalledWith(
      "/api/v1/product-center/skus?sortBy=CREATED_AT&descending=true&page=0&size=25",
    );
  });

  it("requires a tenant-scoped master SKU identity on list rows", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue({
      items: [
        {
          id: skuId,
          spuId,
          masterSku: {
            id: spuId,
            businessCode: "MASTER_ONE",
            name: "Master one",
            thumbnailImageId,
            brandName: "Example brand",
            category: {
              id: otherSpuId,
              displayName: "服装",
            },
            developerMember: {
              id: otherSkuId,
              displayName: "开发员",
            },
            developerAssistantMember: null,
            artMember: null,
            salesMember: null,
            actualWeightGrams: 320,
            lengthMm: 300,
            widthMm: 200,
            heightMm: 40,
            packageMaterial: null,
            packageableCount: 2,
          },
          businessCode: "SKU_1",
          name: "Name",
          creatorName: "创建用户",
          status: "ACTIVE",
          createdAt: "2026-07-28T09:00:00Z",
          updatedAt: "2026-07-28T10:00:00Z",
          version: 2,
        },
      ],
      page: 0,
      size: 25,
      totalElements: 1,
      totalPages: 1,
    });

    const page = await productCenterApi.listSkus({
      page: 0,
      size: 25,
    });

    expect(page.items[0]?.masterSku).toEqual({
      id: spuId,
      businessCode: "MASTER_ONE",
      name: "Master one",
      thumbnailImageId,
      brandName: "Example brand",
      category: {
        id: otherSpuId,
        displayName: "服装",
      },
      developerMember: {
        id: otherSkuId,
        displayName: "开发员",
      },
      developerAssistantMember: undefined,
      artMember: undefined,
      salesMember: undefined,
      actualWeightGrams: 320,
      lengthMm: 300,
      widthMm: 200,
      heightMm: 40,
      packageMaterial: undefined,
      packageableCount: 2,
    });
    expect(page.items[0]?.creatorName).toBe("创建用户");
    expect(page.items[0]?.createdAt).toBe("2026-07-28T09:00:00Z");
  });

  it("rejects malformed inventory SKU creator names", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue({
      items: [
        {
          ...skuResponse(),
          creatorName: 42,
          masterSku: {
            id: spuId,
            businessCode: "MASTER_ONE",
            name: "Master one",
          },
        },
      ],
      page: 0,
      size: 25,
      totalElements: 1,
      totalPages: 1,
    });

    await expect(
      productCenterApi.listSkus({ page: 0, size: 25 }),
    ).rejects.toThrow("Invalid product API response: sku.creatorName");
  });

  it("rejects malformed master SKU thumbnail identities", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue({
      items: [
        {
          id: skuId,
          spuId,
          masterSku: {
            id: spuId,
            businessCode: "MASTER_ONE",
            name: "Master one",
            thumbnailImageId: "external-image-url",
          },
          businessCode: "SKU_1",
          name: "Name",
          status: "ACTIVE",
          createdAt: "2026-07-28T09:00:00Z",
          updatedAt: "2026-07-28T10:00:00Z",
          version: 2,
        },
      ],
      page: 0,
      size: 25,
      totalElements: 1,
      totalPages: 1,
    });

    await expect(
      productCenterApi.listSkus({ page: 0, size: 25 }),
    ).rejects.toThrow(
      "Invalid product API response: sku.masterSku.thumbnailImageId",
    );
  });

  it("rejects malformed master SKU physical measurements", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue({
      items: [
        {
          ...skuResponse(),
          masterSku: {
            id: spuId,
            businessCode: "MASTER_ONE",
            name: "Master one",
            actualWeightGrams: -1,
          },
        },
      ],
      page: 0,
      size: 25,
      totalElements: 1,
      totalPages: 1,
    });

    await expect(
      productCenterApi.listSkus({ page: 0, size: 25 }),
    ).rejects.toThrow(
      "Invalid product API response: sku.masterSku.actualWeightGrams",
    );
  });

  it("rejects SKU rows that do not belong to the requested parent SPU", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue({
      items: [
        {
          id: skuId,
          spuId: otherSpuId,
          businessCode: "SKU_1",
          name: "Name",
          status: "ACTIVE",
          createdAt: "2026-07-28T09:00:00Z",
          updatedAt: "2026-07-28T10:00:00Z",
          version: 2,
        },
      ],
      page: 0,
      size: 25,
      totalElements: 1,
      totalPages: 1,
    });

    await expect(
      productCenterApi.listSkus({ spuId, page: 0, size: 25 }),
    ).rejects.toThrow("Invalid product API response: sku.spuId");
  });

  it("binds SKU read and write responses to their requested SKU and parent", async () => {
    vi
      .spyOn(apiClient, "request")
      .mockResolvedValue(skuResponse(otherSkuId, otherSpuId));

    await expect(productCenterApi.getSku(skuId, spuId)).rejects.toThrow(
      "Invalid product API response: sku.identity",
    );
    await expect(
      productCenterApi.updateSku(
        skuId,
        { name: "Name", status: "ACTIVE", version: 2 },
        spuId,
      ),
    ).rejects.toThrow("Invalid product API response: sku.identity");
    await expect(productCenterApi.archiveSku(skuId, 2, spuId)).rejects.toThrow(
      "Invalid product API response: sku.identity",
    );
    await expect(
      productCenterApi.createSku(spuId, {
        businessCode: "SKU_1",
        name: "Name",
      }),
    ).rejects.toThrow("Invalid product API response: sku.identity");
  });

  it("serializes optimistic versions without tenant selectors for writes", async () => {
    const request = vi.spyOn(apiClient, "request").mockResolvedValue({
      id: spuId,
      businessCode: "SKU_1",
      name: "Name",
      volumetricDivisor: 5000,
      sensitiveAttributeCodes: [],
      status: "ACTIVE",
      skuSummary: { totalSkuCount: 0, activeSkuCount: 0 },
      createdAt: "2026-07-28T10:00:00Z",
      updatedAt: "2026-07-28T10:00:00Z",
      version: 3,
    });
    await productCenterApi.archiveSpu(spuId, 2);
    expect(request).toHaveBeenCalledWith(
      `/api/v1/product-center/spus/${spuId}/archive`,
      { method: "POST", body: { version: 2 } },
    );
    expect(JSON.stringify(request.mock.calls[0])).not.toContain("tenantId");
  });

  it("exports the tenant category directory with normalized filters", async () => {
    const content = "\uFEFF类目名称,排序,状态,创建时间,更新时间\r\n家居,10,启用,2026-07-30T10:00:00Z,2026-07-30T10:00:00Z\r\n";
    const request = vi.spyOn(apiClient, "request").mockResolvedValue({
      filename: "product-categories.csv",
      mediaType: "text/csv;charset=UTF-8",
      rowCount: 1,
      content,
    });

    await expect(productCenterApi.exportCategoriesCsv({
      status: "ACTIVE",
      query: "  家居  ",
    })).resolves.toEqual({
      filename: "product-categories.csv",
      mediaType: "text/csv;charset=UTF-8",
      rowCount: 1,
      content,
    });
    expect(request).toHaveBeenCalledWith(
      "/api/v1/product-center/master-data/categories/exports",
      {
        method: "POST",
        body: { status: "ACTIVE", query: "家居" },
      },
    );
    expect(JSON.stringify(request.mock.calls[0])).not.toContain("tenantId");
  });

  it("rejects an unsafe category export response contract", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue({
      filename: "product-categories.csv",
      mediaType: "text/csv;charset=UTF-8",
      rowCount: 1,
      content: "\uFEFF错误表头\r\n",
      credentialReference: "vault://secret",
    });

    await expect(productCenterApi.exportCategoriesCsv({}))
      .rejects.toThrow("Invalid product API response: productCategoryExport.fields");
  });

  it("exports the tenant package material directory with normalized filters", async () => {
    const content = "\uFEFF包装资料名称,参考价格,币种,包装重量（克）,包装层级,长（毫米）,宽（毫米）,高（毫米）,状态,创建时间,更新时间\r\n纸箱,1.2500,CNY,500,2,300,200,150,停用,2026-07-30T10:00:00Z,2026-07-30T10:00:00Z\r\n";
    const request = vi.spyOn(apiClient, "request").mockResolvedValue({
      filename: "product-package-materials.csv",
      mediaType: "text/csv;charset=UTF-8",
      rowCount: 1,
      content,
    });

    await expect(productCenterApi.exportPackageMaterialsCsv({
      status: "INACTIVE",
      query: "  CNY  ",
    })).resolves.toEqual({
      filename: "product-package-materials.csv",
      mediaType: "text/csv;charset=UTF-8",
      rowCount: 1,
      content,
    });
    expect(request).toHaveBeenCalledWith(
      "/api/v1/product-center/master-data/package-materials/exports",
      {
        method: "POST",
        body: { status: "INACTIVE", query: "CNY" },
      },
    );
    expect(JSON.stringify(request.mock.calls[0])).not.toContain("tenantId");
  });

  it("rejects an unsafe package material export response contract", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue({
      filename: "product-package-materials.csv",
      mediaType: "text/csv;charset=UTF-8",
      rowCount: 10_001,
      content: "\uFEFF包装资料名称,参考价格,币种,包装重量（克）,包装层级,长（毫米）,宽（毫米）,高（毫米）,状态,创建时间,更新时间\r\n",
    });

    await expect(productCenterApi.exportPackageMaterialsCsv({}))
      .rejects.toThrow(
        "Invalid product API response: productPackageMaterialExport.contract",
      );
  });
});
