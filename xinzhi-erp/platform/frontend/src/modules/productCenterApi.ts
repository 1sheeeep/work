import { apiClient } from "../api/client";

const API_BASE = "/api/v1/product-center";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ProductStatus = "ACTIVE" | "INACTIVE" | "ARCHIVED";
export type ProductMasterDataStatus = "ACTIVE" | "INACTIVE" | "ARCHIVED";
export const sensitiveAttributeCodes = [
  "BATTERY",
  "INFRINGEMENT",
  "MAGNETIC",
  "COSMETIC_NON_LIQUID",
  "COSMETIC_LIQUID",
  "LIQUID_NON_COSMETIC",
  "POWDER",
  "PASTE",
  "BLADED_ITEM",
  "FLAMMABLE",
] as const;
export type SensitiveAttributeCode = (typeof sensitiveAttributeCodes)[number];

export type Page<T> = {
  items: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
};

export type ProductSpu = {
  id: string;
  businessCode: string;
  name: string;
  nameZh?: string;
  nameEn?: string;
  brandName?: string;
  productNote?: string;
  category?: ProductReference;
  lengthMm?: number;
  widthMm?: number;
  heightMm?: number;
  actualWeightGrams?: number;
  volumetricDivisor: 5000 | 6000;
  packageMaterial?: ProductReference;
  packageableCount?: number;
  artMember?: ProductReference;
  developerMember?: ProductReference;
  developerAssistantMember?: ProductReference;
  salesMember?: ProductReference;
  sensitiveAttributeCodes: SensitiveAttributeCode[];
  status: ProductStatus;
  skuSummary: { totalSkuCount: number; activeSkuCount: number };
  metrics?: {
    totalInventory: number;
    sales7: number;
    sales28: number;
    sales42: number;
    forecastDailySales: number;
    creatorName?: string;
  };
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type ProductReference = {
  id: string;
  displayName: string;
};

export type ProductCategory = {
  id: string;
  name: string;
  sortOrder: number;
  status: ProductMasterDataStatus;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type ProductCategoryExportRequest = {
  status?: ProductMasterDataStatus;
  query?: string;
};

export type ProductCategoryExport = {
  filename: "product-categories.csv";
  mediaType: "text/csv;charset=UTF-8";
  rowCount: number;
  content: string;
};

export type ProductAssignableMember = {
  id: string;
  displayName: string;
};

export type ProductPackageMaterial = {
  id: string;
  name: string;
  unitPrice?: string;
  currencyCode?: string;
  weightGrams?: number;
  level?: number;
  lengthMm?: number;
  widthMm?: number;
  heightMm?: number;
  status: ProductMasterDataStatus;
  createdByType: "TENANT_USER" | "SYSTEM_ADMIN";
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type ProductPackageMaterialExportRequest = {
  status?: ProductMasterDataStatus;
  query?: string;
};

export type ProductPackageMaterialExport = {
  filename: "product-package-materials.csv";
  mediaType: "text/csv;charset=UTF-8";
  rowCount: number;
  content: string;
};

export type ProductImage = {
  id: string;
  spuId: string;
  contentType: "image/jpeg" | "image/png";
  byteSize: number;
  widthPixels: number;
  heightPixels: number;
  sortOrder: number;
  primary: boolean;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type ProductSku = {
  id: string;
  spuId: string;
  masterSku?: {
    id: string;
    businessCode: string;
    name: string;
    thumbnailImageId?: string;
    brandName?: string;
    category?: ProductReference;
    developerMember?: ProductReference;
    developerAssistantMember?: ProductReference;
    artMember?: ProductReference;
    salesMember?: ProductReference;
    actualWeightGrams?: number;
    lengthMm?: number;
    widthMm?: number;
    heightMm?: number;
    packageMaterial?: ProductReference;
    packageableCount?: number;
  };
  creatorName?: string;
  businessCode: string;
  name: string;
  nameEn?: string;
  variantSummary?: string;
  unitCost?: string;
  currencyCode?: string;
  defaultWarehouse?: ProductReference;
  standardWeightGrams?: number;
  status: ProductStatus;
  createdAt: string;
  updatedAt: string;
  version: number;
};

// Deliberately excludes metadataNote: it is a controlled audit note and must never be displayed or reused by the Web client.
export type ProductListing = {
  id: string;
  shopId: string;
  platformId: string;
  skuId: string;
  sku: {
    id: string;
    businessCode: string;
    name: string;
  };
  externalListingRef: string;
  externalVariantRef?: string;
  externalStatus?: string;
  status: ProductStatus;
  updatedAt: string;
  version: number;
};

export type SkuListingSummary = {
  skuId: string;
  activeListingCount: number;
};

export type ListRequest = {
  status?: ProductStatus;
  keyword?: string;
  searchField?: "ALL" | "MASTER_CODE" | "NAME_ZH" | "NAME_EN"
    | "INVENTORY_SKU" | "ORIGINAL_SKU" | "DEFAULT_SUPPLIER";
  categoryId?: string;
  developerMemberId?: string;
  creatorId?: string;
  createdFrom?: string;
  createdTo?: string;
  sortBy?: "BUSINESS_CODE" | "CATEGORY" | "SALES_42" | "FORECAST_DAILY_SALES" | "CREATED_AT";
  descending?: boolean;
  page: number;
  size: number;
};

export type ProductSkuMatchMode =
  | "STARTS_WITH"
  | "EQUALS"
  | "CONTAINS"
  | "ENDS_WITH"
  | "EMPTY"
  | "NOT_EMPTY";

export type ProductSkuSortField = "BUSINESS_CODE" | "CREATED_AT";

export type ProductListingSearchField =
  | "ALL"
  | "PLATFORM_PRODUCT"
  | "PLATFORM_VARIANT"
  | "EXTERNAL_STATUS"
  | "INVENTORY_SKU";

export type SkuListRequest = Omit<ListRequest, "sortBy" | "descending"> & {
  spuId?: string;
  developerAssistantMemberId?: string;
  salesMemberId?: string;
  artMemberId?: string;
  matchMode?: ProductSkuMatchMode;
  sortBy?: ProductSkuSortField;
  descending?: boolean;
};
export type ListingListRequest = Omit<ListRequest, "searchField"> & {
  shopId?: string;
  skuId?: string;
  searchField?: ProductListingSearchField;
};
export type MasterDataListRequest = {
  status?: ProductMasterDataStatus;
  query?: string;
  page: number;
  size: number;
};

export type CategoryInput = {
  name: string;
  sortOrder: number;
  status?: ProductMasterDataStatus;
  version?: number;
};

export type PackageMaterialInput = {
  name: string;
  unitPrice?: string;
  currencyCode?: string;
  weightGrams?: number;
  level?: number;
  lengthMm?: number;
  widthMm?: number;
  heightMm?: number;
  status?: ProductMasterDataStatus;
  version?: number;
};

export type SpuInput = {
  businessCode?: string;
  name: string;
  nameZh?: string;
  nameEn?: string;
  brandName?: string;
  productNote?: string;
  categoryId?: string;
  lengthMm?: number;
  widthMm?: number;
  heightMm?: number;
  actualWeightGrams?: number;
  volumetricDivisor?: 5000 | 6000;
  packageMaterialId?: string;
  packageableCount?: number;
  artMemberId?: string;
  developerMemberId?: string;
  developerAssistantMemberId?: string;
  salesMemberId?: string;
  sensitiveAttributeCodes?: SensitiveAttributeCode[];
  initialSkus?: InitialSkuInput[];
  status?: ProductStatus;
  version?: number;
};

export type SkuInput = {
  businessCode?: string;
  name: string;
  nameEn?: string;
  variantSummary?: string;
  unitCost?: string;
  currencyCode?: string;
  defaultWarehouseId?: string;
  status?: ProductStatus;
  version?: number;
};

export type InitialSkuInput = Required<Pick<SkuInput, "businessCode" | "name">> &
  Pick<SkuInput, "nameEn" | "variantSummary" | "unitCost" | "currencyCode" | "defaultWarehouseId">;

export type VersionedProductResource = { id: string; version: number };
export type ImportedSpuInput = Required<Pick<SpuInput, "businessCode" | "name">> & SpuInput;

export type ListingInput = {
  shopId: string;
  skuId: string;
  externalListingRef: string;
  externalVariantRef?: string;
  externalStatus?: string;
  metadataNote?: string;
  status?: ProductStatus;
  version?: number;
};

export type ShopifyCatalogMatchStatus =
  | "EXACT_SKU_MATCH"
  | "MISSING_LOCAL_SKU"
  | "EMPTY_PLATFORM_SKU";

export type ShopifyCatalogPreviewRequest = {
  shopId: string;
  limit?: number;
  cursor?: string;
  query?: string;
};

export type ShopifyCatalogPreview = {
  mode: "UNCONFIGURED" | "DETERMINISTIC_FAKE" | "XZ_ERP_APP";
  connectionStatus: "NOT_CONNECTED" | "PENDING" | "CONNECTED" | "FAILED" | "REVOKED";
  cursor?: string;
  hasNextPage: boolean;
  fetchedAt: string;
  products: ShopifyCatalogProductPreview[];
};

export type ShopifyCatalogProductPreview = {
  externalListingRef: string;
  title: string;
  handle?: string;
  externalStatus?: string;
  updatedAt?: string;
  variants: ShopifyCatalogVariantPreview[];
};

export type ShopifyCatalogVariantPreview = {
  externalVariantRef: string;
  inventoryItemRef?: string;
  platformSku?: string;
  title: string;
  price?: string;
  currencyCode?: string;
  availableForSale: boolean;
  inventoryTracked: boolean;
  matchStatus: ShopifyCatalogMatchStatus;
  localSku?: {
    id: string;
    businessCode: string;
    name: string;
    status: ProductStatus;
  };
};

export type ShopifyCatalogImportStatus =
  | "IMPORTED_OR_ALREADY_BOUND"
  | "SKIPPED_NOT_IN_PAGE"
  | "SKIPPED_EMPTY_PLATFORM_SKU"
  | "SKIPPED_MISSING_LOCAL_SKU"
  | "SKIPPED_CONFLICT";

export type ShopifyCatalogImportRequest = ShopifyCatalogPreviewRequest & {
  externalVariantRefs: string[];
};

export type ShopifyCatalogImportResult = {
  requestedCount: number;
  importedCount: number;
  skippedCount: number;
  items: ShopifyCatalogImportItemResult[];
};

export type ShopifyCatalogImportItemResult = {
  externalListingRef?: string;
  externalVariantRef: string;
  platformSku?: string;
  skuId?: string;
  listingId?: string;
  status: ShopifyCatalogImportStatus;
  safeSummary?: string;
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`Invalid product API response: ${field}`);
  return value;
}

function requiredUuid(value: unknown, field: string): string {
  const id = requiredString(value, field);
  if (!UUID_PATTERN.test(id)) {
    throw new Error(`Invalid product API response: ${field}`);
  }
  return id.toLowerCase();
}

function canonicalSpuId(id: string): string {
  if (!UUID_PATTERN.test(id)) {
    throw new Error("Invalid product API identifier: spu.id");
  }
  return id.toLowerCase();
}

function canonicalSkuId(id: string): string {
  if (!UUID_PATTERN.test(id)) {
    throw new Error("Invalid product API identifier: sku.id");
  }
  return id.toLowerCase();
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requiredString(value, field);
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error(`Invalid product API response: ${field}`);
  return value;
}

function signedInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`Invalid product API response: ${field}`);
  }
  return value;
}

function productStatus(value: unknown, field: string): ProductStatus {
  if (value === "ACTIVE" || value === "INACTIVE" || value === "ARCHIVED")
    return value;
  throw new Error(`Invalid product API response: ${field}`);
}

function connectionMode(value: unknown, field: string): ShopifyCatalogPreview["mode"] {
  if (
    value === "UNCONFIGURED" ||
    value === "DETERMINISTIC_FAKE" ||
    value === "XZ_ERP_APP"
  ) return value;
  throw new Error(`Invalid product API response: ${field}`);
}

function connectionStatus(
  value: unknown,
  field: string,
): ShopifyCatalogPreview["connectionStatus"] {
  if (
    value === "NOT_CONNECTED" ||
    value === "PENDING" ||
    value === "CONNECTED" ||
    value === "FAILED" ||
    value === "REVOKED"
  ) return value;
  throw new Error(`Invalid product API response: ${field}`);
}

function catalogMatchStatus(
  value: unknown,
  field: string,
): ShopifyCatalogMatchStatus {
  if (
    value === "EXACT_SKU_MATCH" ||
    value === "MISSING_LOCAL_SKU" ||
    value === "EMPTY_PLATFORM_SKU"
  ) return value;
  throw new Error(`Invalid product API response: ${field}`);
}

function catalogImportStatus(
  value: unknown,
  field: string,
): ShopifyCatalogImportStatus {
  if (
    value === "IMPORTED_OR_ALREADY_BOUND" ||
    value === "SKIPPED_NOT_IN_PAGE" ||
    value === "SKIPPED_EMPTY_PLATFORM_SKU" ||
    value === "SKIPPED_MISSING_LOCAL_SKU" ||
    value === "SKIPPED_CONFLICT"
  ) return value;
  throw new Error(`Invalid product API response: ${field}`);
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Invalid product API response: ${field}`);
  }
  return value;
}

function masterDataStatus(
  value: unknown,
  field: string,
): ProductMasterDataStatus {
  if (value === "ACTIVE" || value === "INACTIVE" || value === "ARCHIVED") return value;
  throw new Error(`Invalid product API response: ${field}`);
}

function optionalNonNegativeInteger(
  value: unknown,
  field: string,
): number | undefined {
  if (value === undefined || value === null) return undefined;
  return nonNegativeInteger(value, field);
}

function optionalReference(
  value: unknown,
  field: string,
): ProductReference | undefined {
  if (value === undefined || value === null) return undefined;
  const wire = asRecord(value, field);
  return {
    id: requiredUuid(wire.id, `${field}.id`),
    displayName: requiredString(wire.displayName, `${field}.displayName`),
  };
}

function sensitiveAttributes(value: unknown): SensitiveAttributeCode[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid product API response: spu.sensitiveAttributeCodes");
  }
  const codes = value.map((code) => {
    if (!sensitiveAttributeCodes.includes(code as SensitiveAttributeCode)) {
      throw new Error("Invalid product API response: spu.sensitiveAttributeCodes");
    }
    return code as SensitiveAttributeCode;
  });
  if (new Set(codes).size !== codes.length) {
    throw new Error("Invalid product API response: spu.sensitiveAttributeCodes");
  }
  if (
    codes.some(
      (code, index) =>
        index > 0 &&
        sensitiveAttributeCodes.indexOf(codes[index - 1]) >=
          sensitiveAttributeCodes.indexOf(code),
    )
  ) {
    throw new Error("Invalid product API response: spu.sensitiveAttributeCodes");
  }
  return codes;
}

function asRecord(value: unknown, field: string): UnknownRecord {
  if (!isRecord(value))
    throw new Error(`Invalid product API response: ${field}`);
  return value;
}

function mapSpu(value: unknown): ProductSpu {
  const wire = asRecord(value, "SPU");
  const summary = asRecord(wire.skuSummary, "skuSummary");
  const metrics = wire.metrics === null || wire.metrics === undefined
    ? undefined
    : asRecord(wire.metrics, "spu.metrics");
  return {
    id: requiredUuid(wire.id, "spu.id"),
    businessCode: requiredString(wire.businessCode, "spu.businessCode"),
    name: requiredString(wire.name, "spu.name"),
    nameZh: optionalString(wire.nameZh, "spu.nameZh"),
    nameEn: optionalString(wire.nameEn, "spu.nameEn"),
    brandName: optionalString(wire.brandName, "spu.brandName"),
    productNote: optionalString(wire.productNote, "spu.productNote"),
    category: optionalReference(wire.category, "spu.category"),
    lengthMm: optionalNonNegativeInteger(wire.lengthMm, "spu.lengthMm"),
    widthMm: optionalNonNegativeInteger(wire.widthMm, "spu.widthMm"),
    heightMm: optionalNonNegativeInteger(wire.heightMm, "spu.heightMm"),
    actualWeightGrams: optionalNonNegativeInteger(
      wire.actualWeightGrams,
      "spu.actualWeightGrams",
    ),
    volumetricDivisor:
      wire.volumetricDivisor === 5000 || wire.volumetricDivisor === 6000
        ? wire.volumetricDivisor
        : (() => {
            throw new Error("Invalid product API response: spu.volumetricDivisor");
          })(),
    packageMaterial: optionalReference(
      wire.packageMaterial,
      "spu.packageMaterial",
    ),
    packageableCount: optionalNonNegativeInteger(
      wire.packageableCount,
      "spu.packageableCount",
    ),
    artMember: optionalReference(wire.artMember, "spu.artMember"),
    developerMember: optionalReference(
      wire.developerMember,
      "spu.developerMember",
    ),
    developerAssistantMember: optionalReference(
      wire.developerAssistantMember,
      "spu.developerAssistantMember",
    ),
    salesMember: optionalReference(wire.salesMember, "spu.salesMember"),
    sensitiveAttributeCodes: sensitiveAttributes(wire.sensitiveAttributeCodes),
    status: productStatus(wire.status, "spu.status"),
    skuSummary: {
      totalSkuCount: nonNegativeInteger(
        summary.totalSkuCount,
        "skuSummary.totalSkuCount",
      ),
      activeSkuCount: nonNegativeInteger(
        summary.activeSkuCount,
        "skuSummary.activeSkuCount",
      ),
    },
    metrics: metrics
      ? {
          totalInventory: signedInteger(metrics.totalInventory, "spu.metrics.totalInventory"),
          sales7: nonNegativeInteger(metrics.sales7, "spu.metrics.sales7"),
          sales28: nonNegativeInteger(metrics.sales28, "spu.metrics.sales28"),
          sales42: nonNegativeInteger(metrics.sales42, "spu.metrics.sales42"),
          forecastDailySales: (() => {
            if (typeof metrics.forecastDailySales !== "number"
              || !Number.isFinite(metrics.forecastDailySales)
              || metrics.forecastDailySales < 0) {
              throw new Error("Invalid product API response: spu.metrics.forecastDailySales");
            }
            return metrics.forecastDailySales;
          })(),
          creatorName: optionalString(metrics.creatorName, "spu.metrics.creatorName"),
        }
      : undefined,
    createdAt: requiredString(wire.createdAt, "spu.createdAt"),
    updatedAt: requiredString(wire.updatedAt, "spu.updatedAt"),
    version: nonNegativeInteger(wire.version, "spu.version"),
  };
}

function mapExpectedSpu(value: unknown, expectedId: string): ProductSpu {
  const spu = mapSpu(value);
  if (spu.id !== expectedId) {
    throw new Error("Invalid product API response: spu.id");
  }
  return spu;
}

function mapSku(value: unknown): ProductSku {
  const wire = asRecord(value, "SKU");
  const spuId = requiredUuid(wire.spuId, "sku.spuId");
  const masterWire = wire.masterSku == null
    ? undefined
    : asRecord(wire.masterSku, "sku.masterSku");
  const masterSku = masterWire
    ? {
        id: requiredUuid(masterWire.id, "sku.masterSku.id"),
        businessCode: requiredString(
          masterWire.businessCode,
          "sku.masterSku.businessCode",
        ),
        name: requiredString(masterWire.name, "sku.masterSku.name"),
        thumbnailImageId: masterWire.thumbnailImageId == null
          ? undefined
          : requiredUuid(
              masterWire.thumbnailImageId,
              "sku.masterSku.thumbnailImageId",
            ),
        brandName: optionalString(
          masterWire.brandName,
          "sku.masterSku.brandName",
        ),
        category: optionalReference(
          masterWire.category,
          "sku.masterSku.category",
        ),
        developerMember: optionalReference(
          masterWire.developerMember,
          "sku.masterSku.developerMember",
        ),
        developerAssistantMember: optionalReference(
          masterWire.developerAssistantMember,
          "sku.masterSku.developerAssistantMember",
        ),
        artMember: optionalReference(
          masterWire.artMember,
          "sku.masterSku.artMember",
        ),
        salesMember: optionalReference(
          masterWire.salesMember,
          "sku.masterSku.salesMember",
        ),
        actualWeightGrams: optionalNonNegativeInteger(
          masterWire.actualWeightGrams,
          "sku.masterSku.actualWeightGrams",
        ),
        lengthMm: optionalNonNegativeInteger(
          masterWire.lengthMm,
          "sku.masterSku.lengthMm",
        ),
        widthMm: optionalNonNegativeInteger(
          masterWire.widthMm,
          "sku.masterSku.widthMm",
        ),
        heightMm: optionalNonNegativeInteger(
          masterWire.heightMm,
          "sku.masterSku.heightMm",
        ),
        packageMaterial: optionalReference(
          masterWire.packageMaterial,
          "sku.masterSku.packageMaterial",
        ),
        packageableCount: optionalNonNegativeInteger(
          masterWire.packageableCount,
          "sku.masterSku.packageableCount",
        ),
      }
    : undefined;
  if (masterSku && masterSku.id !== spuId) {
    throw new Error("Invalid product API response: sku.masterSku.id");
  }
  return {
    id: requiredUuid(wire.id, "sku.id"),
    spuId,
    masterSku,
    creatorName: optionalString(wire.creatorName, "sku.creatorName"),
    businessCode: requiredString(wire.businessCode, "sku.businessCode"),
    name: requiredString(wire.name, "sku.name"),
    nameEn: optionalString(wire.nameEn, "sku.nameEn"),
    variantSummary: optionalString(wire.variantSummary, "sku.variantSummary"),
    unitCost: optionalString(wire.unitCost, "sku.unitCost"),
    currencyCode: optionalString(wire.currencyCode, "sku.currencyCode"),
    defaultWarehouse: optionalReference(wire.defaultWarehouse, "sku.defaultWarehouse"),
    standardWeightGrams: optionalNonNegativeInteger(
      wire.standardWeightGrams,
      "sku.standardWeightGrams",
    ),
    status: productStatus(wire.status, "sku.status"),
    createdAt: requiredString(wire.createdAt, "sku.createdAt"),
    updatedAt: requiredString(wire.updatedAt, "sku.updatedAt"),
    version: nonNegativeInteger(wire.version, "sku.version"),
  };
}

function mapExpectedSku(
  value: unknown,
  expectedId?: string,
  expectedSpuId?: string,
): ProductSku {
  const sku = mapSku(value);
  if (
    (expectedId && sku.id !== expectedId) ||
    (expectedSpuId && sku.spuId !== expectedSpuId)
  ) {
    throw new Error("Invalid product API response: sku.identity");
  }
  return sku;
}

function mapCategory(value: unknown): ProductCategory {
  const wire = asRecord(value, "productCategory");
  return {
    id: requiredUuid(wire.id, "productCategory.id"),
    name: requiredString(wire.name, "productCategory.name"),
    sortOrder: nonNegativeInteger(wire.sortOrder, "productCategory.sortOrder"),
    status: masterDataStatus(wire.status, "productCategory.status"),
    createdAt: requiredString(wire.createdAt, "productCategory.createdAt"),
    updatedAt: requiredString(wire.updatedAt, "productCategory.updatedAt"),
    version: nonNegativeInteger(wire.version, "productCategory.version"),
  };
}

function mapCategoryExport(value: unknown): ProductCategoryExport {
  const wire = asRecord(value, "productCategoryExport");
  const expectedFields = ["filename", "mediaType", "rowCount", "content"];
  if (
    Object.keys(wire).length !== expectedFields.length ||
    expectedFields.some((field) => !(field in wire))
  ) {
    throw new Error("Invalid product API response: productCategoryExport.fields");
  }
  const filename = requiredString(
    wire.filename,
    "productCategoryExport.filename",
  );
  const mediaType = requiredString(
    wire.mediaType,
    "productCategoryExport.mediaType",
  );
  const rowCount = nonNegativeInteger(
    wire.rowCount,
    "productCategoryExport.rowCount",
  );
  const content = requiredString(
    wire.content,
    "productCategoryExport.content",
  );
  if (
    filename !== "product-categories.csv" ||
    mediaType !== "text/csv;charset=UTF-8" ||
    rowCount > 10_000 ||
    content.length > 30_000_000 ||
    !content.startsWith("\uFEFF类目名称,排序,状态,创建时间,更新时间\r\n")
  ) {
    throw new Error("Invalid product API response: productCategoryExport.contract");
  }
  return {
    filename: "product-categories.csv",
    mediaType: "text/csv;charset=UTF-8",
    rowCount,
    content,
  };
}

function mapAssignableMember(value: unknown): ProductAssignableMember {
  const wire = asRecord(value, "assignableMember");
  return {
    id: requiredUuid(wire.id, "assignableMember.id"),
    displayName: requiredString(wire.displayName, "assignableMember.displayName"),
  };
}

function mapPackageMaterial(value: unknown): ProductPackageMaterial {
  const wire = asRecord(value, "packageMaterial");
  const createdByType = wire.createdByType;
  if (createdByType !== "TENANT_USER" && createdByType !== "SYSTEM_ADMIN") {
    throw new Error("Invalid product API response: packageMaterial.createdByType");
  }
  return {
    id: requiredUuid(wire.id, "packageMaterial.id"),
    name: requiredString(wire.name, "packageMaterial.name"),
    unitPrice: optionalString(wire.unitPrice, "packageMaterial.unitPrice"),
    currencyCode: optionalString(
      wire.currencyCode,
      "packageMaterial.currencyCode",
    ),
    weightGrams: optionalNonNegativeInteger(
      wire.weightGrams,
      "packageMaterial.weightGrams",
    ),
    level: optionalNonNegativeInteger(wire.level, "packageMaterial.level"),
    lengthMm: optionalNonNegativeInteger(
      wire.lengthMm,
      "packageMaterial.lengthMm",
    ),
    widthMm: optionalNonNegativeInteger(
      wire.widthMm,
      "packageMaterial.widthMm",
    ),
    heightMm: optionalNonNegativeInteger(
      wire.heightMm,
      "packageMaterial.heightMm",
    ),
    status: masterDataStatus(wire.status, "packageMaterial.status"),
    createdByType,
    createdBy: requiredUuid(wire.createdBy, "packageMaterial.createdBy"),
    createdAt: requiredString(wire.createdAt, "packageMaterial.createdAt"),
    updatedAt: requiredString(wire.updatedAt, "packageMaterial.updatedAt"),
    version: nonNegativeInteger(wire.version, "packageMaterial.version"),
  };
}

function mapPackageMaterialExport(value: unknown): ProductPackageMaterialExport {
  const wire = asRecord(value, "productPackageMaterialExport");
  const expectedFields = ["filename", "mediaType", "rowCount", "content"];
  if (
    Object.keys(wire).length !== expectedFields.length ||
    expectedFields.some((field) => !(field in wire))
  ) {
    throw new Error(
      "Invalid product API response: productPackageMaterialExport.fields",
    );
  }
  const filename = requiredString(
    wire.filename,
    "productPackageMaterialExport.filename",
  );
  const mediaType = requiredString(
    wire.mediaType,
    "productPackageMaterialExport.mediaType",
  );
  const rowCount = nonNegativeInteger(
    wire.rowCount,
    "productPackageMaterialExport.rowCount",
  );
  const content = requiredString(
    wire.content,
    "productPackageMaterialExport.content",
  );
  if (
    filename !== "product-package-materials.csv" ||
    mediaType !== "text/csv;charset=UTF-8" ||
    rowCount > 10_000 ||
    content.length > 30_000_000 ||
    !content.startsWith(
      "\uFEFF包装资料名称,参考价格,币种,包装重量（克）,包装层级,长（毫米）,宽（毫米）,高（毫米）,状态,创建时间,更新时间\r\n",
    )
  ) {
    throw new Error(
      "Invalid product API response: productPackageMaterialExport.contract",
    );
  }
  return {
    filename: "product-package-materials.csv",
    mediaType: "text/csv;charset=UTF-8",
    rowCount,
    content,
  };
}

function mapImage(value: unknown, expectedSpuId?: string): ProductImage {
  const wire = asRecord(value, "productImage");
  const contentType = wire.contentType;
  if (contentType !== "image/jpeg" && contentType !== "image/png") {
    throw new Error("Invalid product API response: productImage.contentType");
  }
  const image = {
    id: requiredUuid(wire.id, "productImage.id"),
    spuId: requiredUuid(wire.spuId, "productImage.spuId"),
    contentType,
    byteSize: nonNegativeInteger(wire.byteSize, "productImage.byteSize"),
    widthPixels: nonNegativeInteger(
      wire.widthPixels,
      "productImage.widthPixels",
    ),
    heightPixels: nonNegativeInteger(
      wire.heightPixels,
      "productImage.heightPixels",
    ),
    sortOrder: nonNegativeInteger(wire.sortOrder, "productImage.sortOrder"),
    primary: typeof wire.primary === "boolean" ? wire.primary : (() => {
      throw new Error("Invalid product API response: productImage.primary");
    })(),
    createdAt: requiredString(wire.createdAt, "productImage.createdAt"),
    updatedAt: requiredString(wire.updatedAt, "productImage.updatedAt"),
    version: nonNegativeInteger(wire.version, "productImage.version"),
  } satisfies ProductImage;
  if (expectedSpuId && image.spuId !== expectedSpuId) {
    throw new Error("Invalid product API response: productImage.spuId");
  }
  return image;
}

function mapListing(value: unknown): ProductListing {
  const wire = asRecord(value, "listing");
  const skuId = requiredString(wire.skuId, "listing.skuId");
  const skuWire = asRecord(wire.sku, "listing.sku");
  const sku = {
    id: requiredString(skuWire.id, "listing.sku.id"),
    businessCode: requiredString(
      skuWire.businessCode,
      "listing.sku.businessCode",
    ),
    name: requiredString(skuWire.name, "listing.sku.name"),
  };
  if (sku.id !== skuId) {
    throw new Error("Invalid product API response: listing.sku.id");
  }
  return {
    id: requiredString(wire.id, "listing.id"),
    shopId: requiredString(wire.shopId, "listing.shopId"),
    platformId: requiredString(wire.platformId, "listing.platformId"),
    skuId,
    sku,
    externalListingRef: requiredString(
      wire.externalListingRef,
      "listing.externalListingRef",
    ),
    externalVariantRef: optionalString(
      wire.externalVariantRef,
      "listing.externalVariantRef",
    ),
    externalStatus: optionalString(
      wire.externalStatus,
      "listing.externalStatus",
    ),
    status: productStatus(wire.status, "listing.status"),
    updatedAt: requiredString(wire.updatedAt, "listing.updatedAt"),
    version: nonNegativeInteger(wire.version, "listing.version"),
  };
}

function mapShopifyCatalogLocalSku(
  value: unknown,
  field: string,
): ShopifyCatalogVariantPreview["localSku"] {
  if (value === undefined || value === null) return undefined;
  const wire = asRecord(value, field);
  return {
    id: requiredUuid(wire.id, `${field}.id`),
    businessCode: requiredString(wire.businessCode, `${field}.businessCode`),
    name: requiredString(wire.name, `${field}.name`),
    status: productStatus(wire.status, `${field}.status`),
  };
}

function mapShopifyCatalogVariantPreview(
  value: unknown,
): ShopifyCatalogVariantPreview {
  const wire = asRecord(value, "shopifyCatalogVariant");
  const variant = {
    externalVariantRef: requiredString(
      wire.externalVariantRef,
      "shopifyCatalogVariant.externalVariantRef",
    ),
    inventoryItemRef: optionalString(
      wire.inventoryItemRef,
      "shopifyCatalogVariant.inventoryItemRef",
    ),
    platformSku: optionalString(
      wire.platformSku,
      "shopifyCatalogVariant.platformSku",
    ),
    title: requiredString(wire.title, "shopifyCatalogVariant.title"),
    price: optionalString(wire.price, "shopifyCatalogVariant.price"),
    currencyCode: optionalString(
      wire.currencyCode,
      "shopifyCatalogVariant.currencyCode",
    ),
    availableForSale: requiredBoolean(
      wire.availableForSale,
      "shopifyCatalogVariant.availableForSale",
    ),
    inventoryTracked: requiredBoolean(
      wire.inventoryTracked,
      "shopifyCatalogVariant.inventoryTracked",
    ),
    matchStatus: catalogMatchStatus(
      wire.matchStatus,
      "shopifyCatalogVariant.matchStatus",
    ),
    localSku: mapShopifyCatalogLocalSku(
      wire.localSku,
      "shopifyCatalogVariant.localSku",
    ),
  } satisfies ShopifyCatalogVariantPreview;
  if (variant.matchStatus === "EXACT_SKU_MATCH" && !variant.localSku) {
    throw new Error("Invalid product API response: shopifyCatalogVariant.localSku");
  }
  if (variant.matchStatus !== "EXACT_SKU_MATCH" && variant.localSku) {
    throw new Error("Invalid product API response: shopifyCatalogVariant.localSku");
  }
  return variant;
}

function mapShopifyCatalogProductPreview(
  value: unknown,
): ShopifyCatalogProductPreview {
  const wire = asRecord(value, "shopifyCatalogProduct");
  if (!Array.isArray(wire.variants)) {
    throw new Error("Invalid product API response: shopifyCatalogProduct.variants");
  }
  return {
    externalListingRef: requiredString(
      wire.externalListingRef,
      "shopifyCatalogProduct.externalListingRef",
    ),
    title: requiredString(wire.title, "shopifyCatalogProduct.title"),
    handle: optionalString(wire.handle, "shopifyCatalogProduct.handle"),
    externalStatus: optionalString(
      wire.externalStatus,
      "shopifyCatalogProduct.externalStatus",
    ),
    updatedAt: optionalString(wire.updatedAt, "shopifyCatalogProduct.updatedAt"),
    variants: wire.variants.map(mapShopifyCatalogVariantPreview),
  };
}

function mapShopifyCatalogPreview(value: unknown): ShopifyCatalogPreview {
  const wire = asRecord(value, "shopifyCatalogPreview");
  if (!Array.isArray(wire.products)) {
    throw new Error("Invalid product API response: shopifyCatalogPreview.products");
  }
  return {
    mode: connectionMode(wire.mode, "shopifyCatalogPreview.mode"),
    connectionStatus: connectionStatus(
      wire.connectionStatus,
      "shopifyCatalogPreview.connectionStatus",
    ),
    cursor: optionalString(wire.cursor, "shopifyCatalogPreview.cursor"),
    hasNextPage: requiredBoolean(
      wire.hasNextPage,
      "shopifyCatalogPreview.hasNextPage",
    ),
    fetchedAt: requiredString(wire.fetchedAt, "shopifyCatalogPreview.fetchedAt"),
    products: wire.products.map(mapShopifyCatalogProductPreview),
  };
}

function mapShopifyCatalogImportItem(
  value: unknown,
): ShopifyCatalogImportItemResult {
  const wire = asRecord(value, "shopifyCatalogImportItem");
  return {
    externalListingRef: optionalString(
      wire.externalListingRef,
      "shopifyCatalogImportItem.externalListingRef",
    ),
    externalVariantRef: requiredString(
      wire.externalVariantRef,
      "shopifyCatalogImportItem.externalVariantRef",
    ),
    platformSku: optionalString(
      wire.platformSku,
      "shopifyCatalogImportItem.platformSku",
    ),
    skuId: wire.skuId == null
      ? undefined
      : requiredUuid(wire.skuId, "shopifyCatalogImportItem.skuId"),
    listingId: wire.listingId == null
      ? undefined
      : requiredUuid(wire.listingId, "shopifyCatalogImportItem.listingId"),
    status: catalogImportStatus(
      wire.status,
      "shopifyCatalogImportItem.status",
    ),
    safeSummary: optionalString(
      wire.safeSummary,
      "shopifyCatalogImportItem.safeSummary",
    ),
  };
}

function mapShopifyCatalogImportResult(
  value: unknown,
): ShopifyCatalogImportResult {
  const wire = asRecord(value, "shopifyCatalogImport");
  if (!Array.isArray(wire.items)) {
    throw new Error("Invalid product API response: shopifyCatalogImport.items");
  }
  return {
    requestedCount: nonNegativeInteger(
      wire.requestedCount,
      "shopifyCatalogImport.requestedCount",
    ),
    importedCount: nonNegativeInteger(
      wire.importedCount,
      "shopifyCatalogImport.importedCount",
    ),
    skippedCount: nonNegativeInteger(
      wire.skippedCount,
      "shopifyCatalogImport.skippedCount",
    ),
    items: wire.items.map(mapShopifyCatalogImportItem),
  };
}

function mapPage<T>(value: unknown, mapItem: (item: unknown) => T): Page<T> {
  const wire = asRecord(value, "page");
  if (!Array.isArray(wire.items))
    throw new Error("Invalid product API response: page.items");
  return {
    items: wire.items.map((item) => mapItem(item)),
    page: nonNegativeInteger(wire.page, "page.page"),
    size: nonNegativeInteger(wire.size, "page.size"),
    totalElements: nonNegativeInteger(wire.totalElements, "page.totalElements"),
    totalPages: nonNegativeInteger(wire.totalPages, "page.totalPages"),
  };
}

function mapSkuListingSummary(value: unknown): SkuListingSummary {
  const wire = asRecord(value, "skuListingSummary");
  if (
    Object.keys(wire).length !== 2 ||
    !Object.prototype.hasOwnProperty.call(wire, "skuId") ||
    !Object.prototype.hasOwnProperty.call(wire, "activeListingCount")
  ) {
    throw new Error("Invalid product API response: skuListingSummary");
  }
  return {
    skuId: requiredUuid(wire.skuId, "skuListingSummary.skuId"),
    activeListingCount: nonNegativeInteger(
      wire.activeListingCount,
      "skuListingSummary.activeListingCount",
    ),
  };
}

function pagePath(
  path: string,
  request: Record<string, string | number | boolean | undefined>,
) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(request)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  return `${path}?${query.toString()}`;
}

export const productCenterApi = {
  async listAssignableMembers(
    request: Pick<MasterDataListRequest, "page" | "size">,
  ): Promise<Page<ProductAssignableMember>> {
    return mapPage(
      await apiClient.request<unknown>(
        pagePath(`${API_BASE}/master-data/assignable-members`, request),
      ),
      mapAssignableMember,
    );
  },

  async listSpus(request: ListRequest): Promise<Page<ProductSpu>> {
    return mapPage(
      await apiClient.request<unknown>(pagePath(`${API_BASE}/spus`, {
        ...request,
        searchField: request.searchField === "ALL" ? undefined : request.searchField,
      })),
      mapSpu,
    );
  },

  async getSpu(id: string) {
    const spuId = canonicalSpuId(id);
    return mapExpectedSpu(
      await apiClient.request<unknown>(`${API_BASE}/spus/${spuId}`),
      spuId,
    );
  },

  async listSkus(request: SkuListRequest): Promise<Page<ProductSku>> {
    const parentSpuId = request.spuId
      ? canonicalSpuId(request.spuId)
      : undefined;
    const page = mapPage(
      await apiClient.request<unknown>(
        pagePath(`${API_BASE}/skus`, {
          ...request,
          spuId: parentSpuId,
          searchField:
            request.searchField === "ALL"
              ? undefined
              : request.searchField,
          matchMode:
            request.matchMode === "CONTAINS"
              ? undefined
              : request.matchMode,
          sortBy:
            request.sortBy === "BUSINESS_CODE"
              ? undefined
              : request.sortBy,
          descending: request.descending ? true : undefined,
        }),
      ),
      mapSku,
    );
    if (
      parentSpuId &&
      page.items.some((sku) => sku.spuId !== parentSpuId)
    ) {
      throw new Error("Invalid product API response: sku.spuId");
    }
    if (page.items.some((sku) => !sku.masterSku)) {
      throw new Error("Invalid product API response: sku.masterSku");
    }
    return page;
  },

  async getSku(id: string, expectedSpuId?: string) {
    const skuId = canonicalSkuId(id);
    const parentSpuId = expectedSpuId
      ? canonicalSpuId(expectedSpuId)
      : undefined;
    return mapExpectedSku(
      await apiClient.request<unknown>(`${API_BASE}/skus/${skuId}`),
      skuId,
      parentSpuId,
    );
  },

  async listListings(
    request: ListingListRequest,
  ): Promise<Page<ProductListing>> {
    return mapPage(
      await apiClient.request<unknown>(
        pagePath(`${API_BASE}/listings`, request),
      ),
      mapListing,
    );
  },

  async previewShopifyCatalog(
    request: ShopifyCatalogPreviewRequest,
  ): Promise<ShopifyCatalogPreview> {
    return mapShopifyCatalogPreview(
      await apiClient.request<unknown>(
        pagePath(`${API_BASE}/listings/shopify/catalog-preview`, {
          shopId: request.shopId,
          limit: request.limit,
          cursor: request.cursor,
          query: request.query,
        }),
      ),
    );
  },

  async importShopifyCatalogListings(
    request: ShopifyCatalogImportRequest,
  ): Promise<ShopifyCatalogImportResult> {
    return mapShopifyCatalogImportResult(
      await apiClient.request<unknown>(
        `${API_BASE}/listings/shopify/catalog-import`,
        {
          method: "POST",
          body: {
            shopId: request.shopId,
            limit: request.limit,
            cursor: request.cursor,
            query: request.query,
            externalVariantRefs: request.externalVariantRefs,
          },
        },
      ),
    );
  },

  async listSkuListingSummaries(
    requestedSkuIds: string[],
  ): Promise<SkuListingSummary[]> {
    const skuIds = requestedSkuIds.map(canonicalSkuId);
    if (
      skuIds.length < 1 ||
      skuIds.length > 50 ||
      new Set(skuIds).size !== skuIds.length
    ) {
      throw new Error("Invalid product API identifier: skuIds");
    }
    const query = new URLSearchParams();
    skuIds.forEach((skuId) => query.append("skuId", skuId));
    const response = asRecord(
      await apiClient.request<unknown>(
        `${API_BASE}/skus/listing-summaries?${query.toString()}`,
      ),
      "skuListingSummaries",
    );
    if (
      Object.keys(response).length !== 1 ||
      !Object.prototype.hasOwnProperty.call(response, "items") ||
      !Array.isArray(response.items)
    ) {
      throw new Error("Invalid product API response: skuListingSummaries");
    }
    const summaries = response.items.map(mapSkuListingSummary);
    const requested = new Set(skuIds);
    if (
      new Set(summaries.map((summary) => summary.skuId)).size !==
        summaries.length ||
      summaries.some((summary) => !requested.has(summary.skuId))
    ) {
      throw new Error("Invalid product API response: skuListingSummaries");
    }
    return summaries;
  },

  async getListing(id: string) {
    return mapListing(
      await apiClient.request<unknown>(`${API_BASE}/listings/${id}`),
    );
  },

  async createSpu(
    input: Required<Pick<SpuInput, "businessCode" | "name">> &
      Omit<SpuInput, "businessCode" | "name">,
  ) {
    return mapSpu(
      await apiClient.request<unknown>(`${API_BASE}/spus`, {
        method: "POST",
        body: {
          businessCode: input.businessCode,
          name: input.name,
          nameZh: input.nameZh,
          nameEn: input.nameEn,
          brandName: input.brandName,
          productNote: input.productNote,
          categoryId: input.categoryId,
          lengthMm: input.lengthMm,
          widthMm: input.widthMm,
          heightMm: input.heightMm,
          actualWeightGrams: input.actualWeightGrams,
          volumetricDivisor: input.volumetricDivisor,
          packageMaterialId: input.packageMaterialId,
          packageableCount: input.packageableCount,
          artMemberId: input.artMemberId,
          developerMemberId: input.developerMemberId,
          developerAssistantMemberId: input.developerAssistantMemberId,
          salesMemberId: input.salesMemberId,
          sensitiveAttributeCodes: input.sensitiveAttributeCodes,
          initialSkus: input.initialSkus,
        },
      }),
    );
  },

  async createSpuWithImages(
    input: Required<Pick<SpuInput, "businessCode" | "name">> &
      Omit<SpuInput, "businessCode" | "name">,
    images: File[],
  ) {
    if (images.length < 1 || images.length > 10) {
      throw new Error("New master products require 1 to 10 images");
    }
    const form = new FormData();
    form.append("request", new Blob([JSON.stringify({
      businessCode: input.businessCode,
      name: input.name,
      nameZh: input.nameZh,
      nameEn: input.nameEn,
      brandName: input.brandName,
      productNote: input.productNote,
      categoryId: input.categoryId,
      lengthMm: input.lengthMm,
      widthMm: input.widthMm,
      heightMm: input.heightMm,
      actualWeightGrams: input.actualWeightGrams,
      volumetricDivisor: input.volumetricDivisor,
      packageMaterialId: input.packageMaterialId,
      packageableCount: input.packageableCount,
      artMemberId: input.artMemberId,
      developerMemberId: input.developerMemberId,
      developerAssistantMemberId: input.developerAssistantMemberId,
      salesMemberId: input.salesMemberId,
      sensitiveAttributeCodes: input.sensitiveAttributeCodes,
      initialSkus: input.initialSkus,
    })], { type: "application/json" }));
    for (const image of images) form.append("images", image, image.name);
    return mapSpu(
      await apiClient.request<unknown>(`${API_BASE}/spus/with-images`, {
        method: "POST",
        body: form,
      }),
    );
  },

  async updateSpu(
    id: string,
    input: Required<Pick<SpuInput, "name" | "status" | "version">> & SpuInput,
  ) {
    const spuId = canonicalSpuId(id);
    return mapExpectedSpu(
      await apiClient.request<unknown>(`${API_BASE}/spus/${spuId}`, {
        method: "PUT",
        body: {
          name: input.name,
          nameZh: input.nameZh,
          nameEn: input.nameEn,
          brandName: input.brandName,
          productNote: input.productNote,
          categoryId: input.categoryId,
          lengthMm: input.lengthMm,
          widthMm: input.widthMm,
          heightMm: input.heightMm,
          actualWeightGrams: input.actualWeightGrams,
          volumetricDivisor: input.volumetricDivisor,
          packageMaterialId: input.packageMaterialId,
          packageableCount: input.packageableCount,
          artMemberId: input.artMemberId,
          developerMemberId: input.developerMemberId,
          developerAssistantMemberId: input.developerAssistantMemberId,
          salesMemberId: input.salesMemberId,
          sensitiveAttributeCodes: input.sensitiveAttributeCodes,
          status: input.status,
          version: input.version,
        },
      }),
      spuId,
    );
  },

  async updateSpuWithImages(
    id: string,
    input: Required<Pick<SpuInput, "name" | "status" | "version">> & SpuInput,
    images: File[],
  ) {
    const spuId = canonicalSpuId(id);
    const form = new FormData();
    form.append("request", new Blob([JSON.stringify({
      name: input.name,
      nameZh: input.nameZh,
      nameEn: input.nameEn,
      brandName: input.brandName,
      productNote: input.productNote,
      categoryId: input.categoryId,
      lengthMm: input.lengthMm,
      widthMm: input.widthMm,
      heightMm: input.heightMm,
      actualWeightGrams: input.actualWeightGrams,
      volumetricDivisor: input.volumetricDivisor,
      packageMaterialId: input.packageMaterialId,
      packageableCount: input.packageableCount,
      artMemberId: input.artMemberId,
      developerMemberId: input.developerMemberId,
      developerAssistantMemberId: input.developerAssistantMemberId,
      salesMemberId: input.salesMemberId,
      sensitiveAttributeCodes: input.sensitiveAttributeCodes,
      status: input.status,
      version: input.version,
    })], { type: "application/json" }));
    for (const image of images) form.append("images", image, image.name);
    return mapExpectedSpu(
      await apiClient.request<unknown>(`${API_BASE}/spus/${spuId}/with-images`, {
        method: "PUT",
        body: form,
      }),
      spuId,
    );
  },

  async archiveSpu(id: string, version: number) {
    const spuId = canonicalSpuId(id);
    return mapExpectedSpu(
      await apiClient.request<unknown>(`${API_BASE}/spus/${spuId}/archive`, {
        method: "POST",
        body: { version },
      }),
      spuId,
    );
  },

  async updateSpuBatchStatus(
    items: VersionedProductResource[],
    status: Exclude<ProductStatus, "ARCHIVED">,
  ) {
    const response = await apiClient.request<unknown>(`${API_BASE}/spus/batch/status`, {
      method: "PUT",
      body: { items, status },
    });
    if (!Array.isArray(response)) throw new Error("Invalid product API response: batch SPU response");
    return response.map(mapSpu);
  },

  async archiveSpuBatch(items: VersionedProductResource[]) {
    const response = await apiClient.request<unknown>(`${API_BASE}/spus/batch/archive`, {
      method: "POST",
      body: { items },
    });
    if (!Array.isArray(response)) throw new Error("Invalid product API response: batch SPU response");
    return response.map(mapSpu);
  },

  async importSpus(items: ImportedSpuInput[]) {
    const response = await apiClient.request<unknown>(`${API_BASE}/spus/import`, {
      method: "POST",
      body: { items },
    });
    if (!Array.isArray(response)) throw new Error("Invalid product API response: imported SPUs");
    return response.map(mapSpu);
  },

  async importSpuUpdates(items: Array<{ id: string; values: Required<Pick<SpuInput, "name" | "status" | "version">> & SpuInput }>) {
    const response = await apiClient.request<unknown>(`${API_BASE}/spus/import`, {
      method: "PUT",
      body: { items },
    });
    if (!Array.isArray(response)) throw new Error("Invalid product API response: imported SPUs");
    return response.map(mapSpu);
  },

  async createSku(
    spuId: string,
    input: Required<Pick<SkuInput, "businessCode" | "name">> & SkuInput,
  ) {
    const parentSpuId = canonicalSpuId(spuId);
    return mapExpectedSku(
      await apiClient.request<unknown>(`${API_BASE}/spus/${parentSpuId}/skus`, {
        method: "POST",
        body: {
          businessCode: input.businessCode,
          name: input.name,
          nameEn: input.nameEn,
          variantSummary: input.variantSummary,
          unitCost: input.unitCost,
          currencyCode: input.currencyCode,
          defaultWarehouseId: input.defaultWarehouseId,
        },
      }),
      undefined,
      parentSpuId,
    );
  },

  async updateSku(
    id: string,
    input: Required<Pick<SkuInput, "name" | "status" | "version">> & SkuInput,
    expectedSpuId?: string,
  ) {
    const skuId = canonicalSkuId(id);
    const parentSpuId = expectedSpuId
      ? canonicalSpuId(expectedSpuId)
      : undefined;
    return mapExpectedSku(
      await apiClient.request<unknown>(`${API_BASE}/skus/${skuId}`, {
        method: "PUT",
        body: {
          name: input.name,
          nameEn: input.nameEn,
          variantSummary: input.variantSummary,
          unitCost: input.unitCost,
          currencyCode: input.currencyCode,
          defaultWarehouseId: input.defaultWarehouseId,
          status: input.status,
          version: input.version,
        },
      }),
      skuId,
      parentSpuId,
    );
  },

  async updateSkuStandardWeight(
    id: string,
    input: { version: number; standardWeightGrams: number | null },
  ) {
    const skuId = canonicalSkuId(id);
    if (!Number.isSafeInteger(input.version) || input.version < 0 ||
      (input.standardWeightGrams !== null &&
        (!Number.isSafeInteger(input.standardWeightGrams) ||
          input.standardWeightGrams < 1 || input.standardWeightGrams > 999999999))) {
      throw new Error("Invalid product API request: SKU standard weight");
    }
    return mapExpectedSku(
      await apiClient.request<unknown>(`${API_BASE}/skus/${skuId}/standard-weight`, {
        method: "PUT",
        body: input,
      }),
      skuId,
    );
  },

  async archiveSku(id: string, version: number, expectedSpuId?: string) {
    const skuId = canonicalSkuId(id);
    const parentSpuId = expectedSpuId
      ? canonicalSpuId(expectedSpuId)
      : undefined;
    return mapExpectedSku(
      await apiClient.request<unknown>(`${API_BASE}/skus/${skuId}/archive`, {
        method: "POST",
        body: { version },
      }),
      skuId,
      parentSpuId,
    );
  },

  async reassignSku(id: string, spuId: string, version: number) {
    const skuId = canonicalSkuId(id);
    const targetSpuId = canonicalSpuId(spuId);
    return mapExpectedSku(
      await apiClient.request<unknown>(`${API_BASE}/skus/${skuId}/parent`, {
        method: "PUT",
        body: { spuId: targetSpuId, version },
      }),
      skuId,
      targetSpuId,
    );
  },

  async createListing(
    input: Required<
      Pick<ListingInput, "shopId" | "skuId" | "externalListingRef">
    > &
      ListingInput,
  ) {
    return mapListing(
      await apiClient.request<unknown>(`${API_BASE}/listings`, {
        method: "POST",
        body: {
          shopId: input.shopId,
          skuId: input.skuId,
          externalListingRef: input.externalListingRef,
          externalVariantRef: input.externalVariantRef,
          externalStatus: input.externalStatus,
          metadataNote: input.metadataNote,
        },
      }),
    );
  },

  async updateListing(
    id: string,
    input: Required<Pick<ListingInput, "status" | "version">> &
      Pick<ListingInput, "externalStatus" | "metadataNote">,
  ) {
    return mapListing(
      await apiClient.request<unknown>(`${API_BASE}/listings/${id}`, {
        method: "PUT",
        body: {
          externalStatus: input.externalStatus,
          metadataNote: input.metadataNote,
          status: input.status,
          version: input.version,
        },
      }),
    );
  },

  async archiveListing(id: string, version: number) {
    return mapListing(
      await apiClient.request<unknown>(`${API_BASE}/listings/${id}/archive`, {
        method: "POST",
        body: { version },
      }),
    );
  },

  async listCategories(request: MasterDataListRequest) {
    return mapPage(
      await apiClient.request<unknown>(
        pagePath(`${API_BASE}/master-data/categories`, request),
      ),
      mapCategory,
    );
  },

  async exportCategoriesCsv(request: ProductCategoryExportRequest) {
    return mapCategoryExport(
      await apiClient.request<unknown>(
        `${API_BASE}/master-data/categories/exports`,
        {
          method: "POST",
          body: {
            status: request.status,
            query: request.query?.trim().slice(0, 100) || undefined,
          },
        },
      ),
    );
  },

  async createCategory(input: Required<Pick<CategoryInput, "name" | "sortOrder">>) {
    return mapCategory(
      await apiClient.request<unknown>(`${API_BASE}/master-data/categories`, {
        method: "POST",
        body: { name: input.name, sortOrder: input.sortOrder },
      }),
    );
  },

  async getCategory(id: string) {
    const categoryId = requiredUuid(id, "category.id");
    const category = mapCategory(
      await apiClient.request<unknown>(
        `${API_BASE}/master-data/categories/${categoryId}`,
      ),
    );
    if (category.id !== categoryId) {
      throw new Error("Invalid product API response: productCategory.id");
    }
    return category;
  },

  async updateCategory(
    id: string,
    input: Required<Pick<CategoryInput, "name" | "sortOrder" | "status" | "version">>,
  ) {
    const categoryId = requiredUuid(id, "category.id");
    const category = mapCategory(
      await apiClient.request<unknown>(
        `${API_BASE}/master-data/categories/${categoryId}`,
        { method: "PUT", body: input },
      ),
    );
    if (category.id !== categoryId) {
      throw new Error("Invalid product API response: productCategory.id");
    }
    return category;
  },

  async deleteCategory(id: string, version: number) {
    const categoryId = requiredUuid(id, "category.id");
    await apiClient.request<void>(
      pagePath(`${API_BASE}/master-data/categories/${categoryId}`, { version }),
      { method: "DELETE" },
    );
  },

  async listPackageMaterials(request: MasterDataListRequest) {
    return mapPage(
      await apiClient.request<unknown>(
        pagePath(`${API_BASE}/master-data/package-materials`, request),
      ),
      mapPackageMaterial,
    );
  },

  async exportPackageMaterialsCsv(request: ProductPackageMaterialExportRequest) {
    return mapPackageMaterialExport(
      await apiClient.request<unknown>(
        `${API_BASE}/master-data/package-materials/exports`,
        {
          method: "POST",
          body: {
            status: request.status,
            query: request.query?.trim().slice(0, 100) || undefined,
          },
        },
      ),
    );
  },

  async createPackageMaterial(
    input: Required<Pick<PackageMaterialInput, "name">> & PackageMaterialInput,
  ) {
    return mapPackageMaterial(
      await apiClient.request<unknown>(`${API_BASE}/master-data/package-materials`, {
        method: "POST",
        body: input,
      }),
    );
  },

  async getPackageMaterial(id: string) {
    const materialId = requiredUuid(id, "packageMaterial.id");
    const material = mapPackageMaterial(
      await apiClient.request<unknown>(
        `${API_BASE}/master-data/package-materials/${materialId}`,
      ),
    );
    if (material.id !== materialId) {
      throw new Error("Invalid product API response: packageMaterial.id");
    }
    return material;
  },

  async updatePackageMaterial(
    id: string,
    input: Required<Pick<PackageMaterialInput, "name" | "status" | "version">> &
      PackageMaterialInput,
  ) {
    const materialId = requiredUuid(id, "packageMaterial.id");
    const material = mapPackageMaterial(
      await apiClient.request<unknown>(
        `${API_BASE}/master-data/package-materials/${materialId}`,
        { method: "PUT", body: input },
      ),
    );
    if (material.id !== materialId) {
      throw new Error("Invalid product API response: packageMaterial.id");
    }
    return material;
  },

  async deletePackageMaterial(id: string, version: number) {
    const materialId = requiredUuid(id, "packageMaterial.id");
    await apiClient.request<void>(
      pagePath(`${API_BASE}/master-data/package-materials/${materialId}`, {
        version,
      }),
      { method: "DELETE" },
    );
  },

  async listSpuImages(spuId: string) {
    const canonicalId = canonicalSpuId(spuId);
    const images = await apiClient.request<unknown>(
      `${API_BASE}/spus/${canonicalId}/images`,
    );
    if (!Array.isArray(images)) {
      throw new Error("Invalid product API response: productImages");
    }
    return images.map((image) => mapImage(image, canonicalId));
  },

  async getSpuImageBlob(spuId: string, imageId: string) {
    const canonicalId = canonicalSpuId(spuId);
    const canonicalImageId = requiredUuid(imageId, "productImage.id");
    return apiClient.requestBlob(
      `${API_BASE}/spus/${canonicalId}/images/${canonicalImageId}/content`,
    );
  },

  async uploadSpuImage(
    spuId: string,
    file: File,
    sortOrder: number,
    primary: boolean,
  ) {
    const canonicalId = canonicalSpuId(spuId);
    const body = new FormData();
    body.set("file", file);
    body.set("sortOrder", String(sortOrder));
    body.set("primary", String(primary));
    return mapImage(
      await apiClient.request<unknown>(`${API_BASE}/spus/${canonicalId}/images`, {
        method: "POST",
        body,
      }),
      canonicalId,
    );
  },

  async updateSpuImage(
    spuId: string,
    imageId: string,
    version: number,
    sortOrder: number,
    primary: boolean,
  ) {
    const canonicalId = canonicalSpuId(spuId);
    const canonicalImageId = requiredUuid(imageId, "productImage.id");
    return mapImage(
      await apiClient.request<unknown>(
        `${API_BASE}/spus/${canonicalId}/images/${canonicalImageId}`,
        { method: "PUT", body: { version, sortOrder, primary } },
      ),
      canonicalId,
    );
  },

  async replaceSpuImage(
    spuId: string,
    imageId: string,
    version: number,
    file: File,
  ) {
    const canonicalId = canonicalSpuId(spuId);
    const canonicalImageId = requiredUuid(imageId, "productImage.id");
    const body = new FormData();
    body.set("file", file);
    return mapImage(
      await apiClient.request<unknown>(
        pagePath(`${API_BASE}/spus/${canonicalId}/images/${canonicalImageId}/content`, {
          version,
        }),
        { method: "PUT", body },
      ),
      canonicalId,
    );
  },

  async deleteSpuImage(spuId: string, imageId: string, version: number) {
    const canonicalId = canonicalSpuId(spuId);
    const canonicalImageId = requiredUuid(imageId, "productImage.id");
    await apiClient.request<void>(
      pagePath(`${API_BASE}/spus/${canonicalId}/images/${canonicalImageId}`, {
        version,
      }),
      { method: "DELETE" },
    );
  },
};
