import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateApiContract } from "./api-contract-gate.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIRECTORY = path.dirname(SCRIPT_PATH);
const LOCKED_REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..", "..");

const APPLICATION_YAML =
  "platform/backend/src/main/resources/application.yml";
const PRODUCTION_YAML =
  "platform/backend/src/main/resources/application-production.yml";
const NGINX_CONFIG = "platform/frontend/nginx.conf";
const POM = "platform/backend/pom.xml";

const MEDIA_TYPE_HANDLER_FILES = [
  "platform/backend/src/main/java/cn/xzkj/erp/platform/api/ApiExceptionHandler.java",
  "platform/backend/src/main/java/cn/xzkj/erp/order/api/OrderApiExceptionHandler.java",
  "platform/backend/src/main/java/cn/xzkj/erp/iam/web/AuthExceptionHandler.java",
  "platform/backend/src/main/java/cn/xzkj/erp/iam/web/PasswordCredentialExchangeExceptionHandler.java",
  "platform/backend/src/main/java/cn/xzkj/erp/iam/web/IamExceptionHandler.java",
  "platform/backend/src/main/java/cn/xzkj/erp/platformadmin/web/PlatformAdminExceptionHandler.java",
];

const ALL_LIST_OPERATIONS = [
  "AddressMappingController#list",
  "ApprovalRuleController#list",
  "AuthSessionController#list",
  "FulfillmentController#list",
  "IamAdminController#listAuditLogs",
  "IamAdminController#listMembers",
  "IamAdminController#listPermissions",
  "IamAdminController#listRoles",
  "InternalNoticeController#list",
  "InventoryAgingReportController#summarize",
  "InventoryController#listBalances",
  "InventoryCountController#list",
  "InventoryPeriodReportController#summarize",
  "InventoryRealtimeSalesController#summarize",
  "ListingRealtimeSalesController#summarize",
  "LabelTemplateController#list",
  "LogisticsAddressController#list",
  "LogisticsDeclarationEntityController#list",
  "LogisticsDeclarationEntityController#shopOptions",
  "LogisticsStatisticsController#summarize",
  "LogisticsTrackingController#list",
  "TrackingNumberController#list",
  "ManualMovementController#boxStock",
  "ManualMovementController#list",
  "ManualMovementController#locationOptions",
  "ManualMovementController#skuOptions",
  "ManualMovementController#types",
  "ManualMovementController#warehouseOptions",
  "MatchingRuleController#list",
  "MemberApplicationAccessController#list",
  "OperationalTaskController#list",
  "OrderCenterController#listOrders",
  "OrderCenterController#listSkuMatchQueue",
  "OrderOperationsController#listTransfers",
  "OrderStatusReportController#summarize",
  "PasswordCredentialAdminController#list",
  "PlatformAdminController#listSystemAdmins",
  "PlatformAdminController#listTenants",
  "PlatformAdminController#listEnterpriseAdmins",
  "ProductCenterController#listListings",
  "ProductCenterController#listSkus",
  "ProductCenterController#listSpus",
  "ProductMasterDataController#listAssignableMembers",
  "ProductMasterDataController#listCategories",
  "ProductMasterDataController#listPackageMaterials",
  "ProductSalesReportController#summarize",
  "ProductBundleController#list",
  "ProductSupplyPriceController#list",
  "ProcurementPlanController#list",
  "ProcurementPlanController#locationOptions",
  "ProcurementPlanController#skuOptions",
  "ProcurementPlanController#warehouseOptions",
  "ProcurementRecommendationController#summarize",
  "ProcurementPurchaseOrderController#list",
  "ProcurementPurchaseOrderController#listOrderReceipts",
  "ProcurementPurchaseOrderController#listReceipts",
  "ProcurementPurchaseOrderController#listReturns",
  "ProcurementPurchaseOrderController#returnableOrders",
  "ProcurementPurchaseOrderController#supplierOptions",
  "ProcurementPurchaseOrderController#supplierOptionsForSku",
  "PurchaserStatisticsController#summarize",
  "ShopCenterController#listPlatforms",
  "ShopCenterController#listShops",
  "ShopCenterController#listSyncJobs",
  "SettingsMessageController#list",
  "SettingsTransferTaskController#list",
  "ShippingFeeController#regions",
  "ShippingFeeController#rules",
  "ShopAliasController#list",
  "StoreHealthController#list",
  "SupplierController#list",
  "SupplierSkuMappingController#list",
  "WarehouseController#listLocations",
  "WarehouseController#listWarehouses",
  "WarehouseDocumentController#list",
  "WarehouseTransferController#list",
];

const EXPLICIT_PAGE_CAPS = new Map([
  ["AuthSessionController#list", "SessionManagementService.MAX_PAGE_NUMBER"],
  ["FulfillmentController#list", "1_000_000"],
  ["IamAdminController#listAuditLogs", "IamAdministrationService.MAX_PAGE_NUMBER"],
  ["IamAdminController#listMembers", "IamAdministrationService.MAX_PAGE_NUMBER"],
  ["IamAdminController#listPermissions", "IamAdministrationService.MAX_PAGE_NUMBER"],
  ["IamAdminController#listRoles", "IamAdministrationService.MAX_PAGE_NUMBER"],
  ["MemberApplicationAccessController#list", "IamAdministrationService.MAX_PAGE_NUMBER"],
  ["OrderCenterController#listOrders", "1_000_000"],
  ["OrderCenterController#listSkuMatchQueue", "1_000_000"],
  ["OrderOperationsController#listTransfers", "1_000_000"],
  [
    "PasswordCredentialAdminController#list",
    "PasswordCredentialService.MAX_PAGE_NUMBER",
  ],
  [
    "PlatformAdminController#listSystemAdmins",
    "PlatformAdminManagementService.MAX_PAGE_NUMBER",
  ],
  [
    "PlatformAdminController#listTenants",
    "PlatformTenantManagementService.MAX_PAGE_NUMBER",
  ],
  [
    "PlatformAdminController#listEnterpriseAdmins",
    "PlatformTenantManagementService.MAX_PAGE_NUMBER",
  ],
]);

const DECLARED_PAGE_CAP_GAPS = ALL_LIST_OPERATIONS.filter(
  (operation) => !EXPLICIT_PAGE_CAPS.has(operation),
);

const SEARCH_LIMITS = new Map([
  ["FulfillmentController#list:keyword", 100],
  ["IamAdminController#listAuditLogs:action", 160],
  ["IamAdminController#listAuditLogs:resourceType", 100],
  ["InventoryCountController#list:keyword", 100],
  ["InventoryPeriodReportController#summarize:keyword", 100],
  ["InventoryRealtimeSalesController#summarize:keyword", 100],
  ["ListingRealtimeSalesController#summarize:keyword", 100],
  ["LogisticsAddressController#list:keyword", 120],
  ["LogisticsDeclarationEntityController#list:keyword", 120],
  ["LogisticsDeclarationEntityController#shopOptions:keyword", 120],
  ["LogisticsStatisticsController#summarize:value", 100],
  ["LogisticsTrackingController#list:carrier", 100],
  ["LogisticsTrackingController#list:category", 100],
  ["LogisticsTrackingController#list:keyword", 120],
  ["LogisticsTrackingController#list:shop", 100],
  ["LogisticsTrackingController#list:warehouse", 100],
  ["TrackingNumberController#list:channel", 100],
  ["TrackingNumberController#list:keyword", 120],
  ["OrderCenterController#listOrders:keyword", 100],
  ["OrderCenterController#listSkuMatchQueue:keyword", 100],
  ["OrderStatusReportController#summarize:shop", 100],
  ["ManualMovementController#boxStock:keyword", 100],
  ["ManualMovementController#list:keyword", 100],
  ["ManualMovementController#locationOptions:keyword", 100],
  ["ManualMovementController#skuOptions:keyword", 100],
  ["ManualMovementController#warehouseOptions:keyword", 100],
  ["ProductCenterController#listListings:keyword", 100],
  ["ProductCenterController#listSkus:keyword", 100],
  ["ProductCenterController#listSpus:keyword", 100],
  ["ProductSalesReportController#summarize:keyword", 100],
  ["ProcurementPlanController#list:keyword", 120],
  ["ProcurementPlanController#locationOptions:keyword", 120],
  ["ProcurementPlanController#skuOptions:keyword", 120],
  ["ProcurementPlanController#warehouseOptions:keyword", 120],
  ["ProcurementRecommendationController#summarize:keyword", 120],
  ["ProcurementRecommendationController#summarize:supplier", 100],
  ["ProcurementPurchaseOrderController#list:keyword", 120],
  ["ProcurementPurchaseOrderController#listReceipts:purchaseKeyword", 120],
  ["ProcurementPurchaseOrderController#listReceipts:supplierKeyword", 120],
  ["ProcurementPurchaseOrderController#supplierOptions:keyword", 120],
  ["PurchaserStatisticsController#summarize:purchaser", 100],
  ["SupplierController#list:query", 100],
  ["SupplierSkuMappingController#list:query", 120],
  ["WarehouseController#listLocations:keyword", 100],
  ["WarehouseController#listWarehouses:keyword", 100],
  ["WarehouseDocumentController#list:keyword", 100],
  ["WarehouseTransferController#list:keyword", 100],
]);

const DTO_LIMITS = new Map([
  ["cn.xzkj.erp.iam.web.LoginRequest:password", "@Size(max = 128)"],
  [
    "cn.xzkj.erp.iam.web.RedeemCredentialRequest:token",
    "@Size(min = 1, max = 512)",
  ],
  [
    "cn.xzkj.erp.iam.web.ReplaceAssignmentsRequest:ids",
    "@Size(max = 200)",
  ],
  [
    "cn.xzkj.erp.platformadmin.web.CreateTenantRequest:name",
    "@Size(max = 160)",
  ],
  [
    "cn.xzkj.erp.platform.api.CreatePlatformRequest:displayName",
    "@Size(max = 160)",
  ],
  [
    "cn.xzkj.erp.platform.api.UpdateAuthorizationRequest:scopes",
    "@Size(max = 40)",
  ],
  [
    "cn.xzkj.erp.product.api.CreateSpuRequest:name",
    "@Size(max = 200)",
  ],
  [
    "cn.xzkj.erp.order.api.CreateOrderRequest:lines",
    "@Size(min = 1, max = 200)",
  ],
  [
    "cn.xzkj.erp.warehouse.api.CreateWarehouseRequest:name",
    "@Size(max = 200)",
  ],
  [
    "cn.xzkj.erp.procurement.api.CreateRequest:note",
    "@Size(max = 500)",
  ],
  [
    "cn.xzkj.erp.procurement.api.VoidRequest:reason",
    "@Size(max = 500)",
  ],
]);

const BODY_LIMIT_KEYS = [
  "client_max_body_size",
  "max-http-request-size",
  "max-http-form-post-size",
  "max-post-size",
  "max-request-size",
  "max-swallow-size",
  "max-request-body-size",
  "max-nesting-depth",
  "max-string-length",
  "stream-read-constraints",
];

export class ApiResourceBoundaryGateError extends Error {
  constructor(issues) {
    super(issues.map((value) => `[${value.code}] ${value.message}`).join("\n"));
    this.name = "ApiResourceBoundaryGateError";
    this.issues = issues;
  }
}

function issue(code, message) {
  return { code, message };
}

function read(root, relative) {
  const absolute = path.resolve(root, relative);
  const back = path.relative(root, absolute);
  if (
    back === ".." ||
    back.startsWith(`..${path.sep}`) ||
    path.isAbsolute(back) ||
    !fs.existsSync(absolute) ||
    fs.lstatSync(absolute).isSymbolicLink()
  ) {
    throw new ApiResourceBoundaryGateError([
      issue("SOURCE_LAYOUT_INVALID", `required source is unsafe or missing: ${relative}`),
    ]);
  }
  return fs.readFileSync(absolute, "utf8");
}

function constraintValue(constraints, annotation) {
  const match = constraints.find((value) =>
    value.startsWith(`@${annotation}(`),
  );
  if (!match) return null;
  if (annotation === "Max") {
    return match.match(/^@Max\(\s*([A-Za-z0-9_.$]+)\s*\)$/)?.[1] ?? null;
  }
  return match.match(/max\s*=\s*([A-Za-z0-9_.$]+)/)?.[1] ?? null;
}

function parameter(endpoint, name) {
  return endpoint.queryParameters.find((value) => value.name === name);
}

// Label templates use `size` for the paper format; pagination is `pageSize`.
// Keep the exception explicit so a renamed or unbounded parameter fails closed.
function pageSizeParameter(endpoint) {
  return parameter(endpoint, endpoint.operationId === "LabelTemplateController#list" ? "pageSize" : "size");
}

function inspectServerFacts(root, issues) {
  const application = read(root, APPLICATION_YAML);
  const production = read(root, PRODUCTION_YAML);
  const nginx = read(root, NGINX_CONFIG);
  const pom = read(root, POM);
  const combined = `${application}\n${production}\n${nginx}`.toLowerCase();
  const approvedProductImageMultipartLimit =
    /^\s*max-file-size:\s*5MB\s*\r?\n\s*max-request-size:\s*6MB\s*$/m.test(application);

  if (
    !/fail-on-unknown-properties:\s*true/.test(application) ||
    /fail-on-unknown-properties:\s*false/.test(combined)
  ) {
    issues.push(
      issue(
        "UNKNOWN_FIELD_POLICY_DRIFT",
        "Jackson must keep the explicit fail-on-unknown-properties=true policy",
      ),
    );
  }
  for (const key of BODY_LIMIT_KEYS) {
    if (combined.includes(key) && !(key === "max-request-size" && approvedProductImageMultipartLimit)) {
      issues.push(
        issue(
          "SERVER_BOUNDARY_REVIEW_REQUIRED",
          `body/parser boundary '${key}' changed from the documented undefined/default state`,
        ),
      );
    }
  }
  if (application.includes("max-request-size") && !approvedProductImageMultipartLimit) {
    issues.push(
      issue(
        "SERVER_BOUNDARY_REVIEW_REQUIRED",
        "product image multipart limits must remain max-file-size=5MB and max-request-size=6MB",
      ),
    );
  }
  if (
    !/<testcontainers\.version>1\.21\.4<\/testcontainers\.version>/.test(pom)
  ) {
    issues.push(
      issue(
        "TESTCONTAINERS_VERSION_DRIFT",
        "Testcontainers must remain pinned to 1.21.4 for this gate",
      ),
    );
  }
}

function inspectListFacts(baseline, issues) {
  const endpoints = new Map(
    baseline.endpoints.map((value) => [value.operationId, value]),
  );
  const actualLists = baseline.endpoints
    .filter(
      (endpoint) =>
        endpoint.method === "GET" &&
        parameter(endpoint, "page") &&
        pageSizeParameter(endpoint),
    )
    .map((endpoint) => endpoint.operationId)
    .sort();

  if (JSON.stringify(actualLists) !== JSON.stringify([...ALL_LIST_OPERATIONS].sort())) {
    issues.push(
      issue(
        "LIST_ENDPOINT_INVENTORY_DRIFT",
        "the source-derived page/size endpoint inventory changed and needs review",
      ),
    );
  }

  for (const operation of ALL_LIST_OPERATIONS) {
    const endpoint = endpoints.get(operation);
    if (!endpoint) continue;
    const page = parameter(endpoint, "page");
    const size = pageSizeParameter(endpoint);
    if (
      page.type !== "int" ||
      page.defaultValue !== "0" ||
      !page.constraints.includes("@Min(0)")
    ) {
      issues.push(
        issue(
          "PAGE_LOWER_BOUND_DRIFT",
          `${operation} no longer has the formal int/default-0/@Min(0) contract`,
        ),
      );
    }
    if (
      size.type !== "int" ||
      !size.constraints.includes("@Min(1)") ||
      !constraintValue(size.constraints, "Max")
    ) {
      issues.push(
        issue(
          "PAGE_SIZE_BOUND_DRIFT",
          `${operation} no longer has a formal @Min(1)/@Max page-size contract`,
        ),
      );
    }
    const expectedPageMax = EXPLICIT_PAGE_CAPS.get(operation);
    const actualPageMax = constraintValue(page.constraints, "Max");
    if ((expectedPageMax ?? null) !== actualPageMax) {
      issues.push(
        issue(
          "PAGE_MAX_CLASSIFICATION_DRIFT",
          `${operation} page max changed from ${expectedPageMax ?? "undefined"} to ${actualPageMax ?? "undefined"}`,
        ),
      );
    }
  }

  for (const [key, expectedMax] of SEARCH_LIMITS) {
    const split = key.lastIndexOf(":");
    const operation = key.slice(0, split);
    const name = key.slice(split + 1);
    const endpoint = endpoints.get(operation);
    const current = endpoint && parameter(endpoint, name);
    if (
      !current ||
      constraintValue(current.constraints, "Size") !== String(expectedMax)
    ) {
      issues.push(
        issue(
          "SEARCH_BOUNDARY_DRIFT",
          `${key} must retain @Size(max = ${expectedMax})`,
        ),
      );
    }
  }
}

function inspectDtoFacts(baseline, issues) {
  const schemas = new Map(
    baseline.requestSchemas.map((value) => [value.name, value]),
  );
  for (const [key, expectedConstraint] of DTO_LIMITS) {
    const split = key.lastIndexOf(":");
    const schemaName = key.slice(0, split);
    const fieldName = key.slice(split + 1);
    const schema = schemas.get(schemaName);
    const field = schema?.fields.find((value) => value.name === fieldName);
    if (!field?.constraints.includes(expectedConstraint)) {
      issues.push(
        issue(
          "DTO_BOUNDARY_DRIFT",
          `${key} must retain ${expectedConstraint}`,
        ),
      );
    }
  }
}

function inspectMediaTypeMappings(root, issues) {
  for (const relative of MEDIA_TYPE_HANDLER_FILES) {
    const source = read(root, relative);
    const annotation =
      "@ExceptionHandler(HttpMediaTypeNotSupportedException.class)";
    const start = source.indexOf(annotation);
    const next = source.indexOf("@ExceptionHandler", start + annotation.length);
    const mapping = source.slice(
      start,
      next === -1 ? source.length : next,
    );
    if (
      start === -1 ||
      !mapping.includes("HttpStatus.UNSUPPORTED_MEDIA_TYPE") ||
      !mapping.includes('"invalid_request"') ||
      !mapping.includes('"Content type is not supported"')
    ) {
      issues.push(
        issue(
          "UNSUPPORTED_MEDIA_TYPE_MAPPING_DRIFT",
          `${relative} must retain the explicit safe 415 invalid_request mapping`,
        ),
      );
      continue;
    }
    if (
      /LOGGER\.(error|warn)|exception\.(getMessage|toString)|getContentType|getSupportedMediaTypes/.test(
        mapping,
      )
    ) {
      issues.push(
        issue(
          "UNSUPPORTED_MEDIA_TYPE_DISCLOSURE_RISK",
          `${relative} 415 mapping must not log or expose request/exception media details`,
        ),
      );
    }
  }
}

export function inspectApiResourceBoundaries(repositoryRoot) {
  const root = path.resolve(repositoryRoot);
  const issues = [];
  let baseline;
  try {
    baseline = generateApiContract(root).baseline;
    inspectServerFacts(root, issues);
    inspectListFacts(baseline, issues);
    inspectDtoFacts(baseline, issues);
    inspectMediaTypeMappings(root, issues);
  } catch (error) {
    if (error instanceof ApiResourceBoundaryGateError) throw error;
    issues.push(
      issue(
        "SOURCE_EXTRACTION_FAILED",
        error instanceof Error ? error.message : String(error),
      ),
    );
  }
  issues.sort(
    (left, right) =>
      left.code.localeCompare(right.code, "en") ||
      left.message.localeCompare(right.message, "en"),
  );
  return {
    issues,
    summary: {
      listEndpoints: ALL_LIST_OPERATIONS.length,
      explicitPageCaps: EXPLICIT_PAGE_CAPS.size,
      undefinedPageCaps: DECLARED_PAGE_CAP_GAPS.length,
      searchLimits: SEARCH_LIMITS.size,
      dtoLimits: DTO_LIMITS.size,
      unsupportedMediaTypeMappings: MEDIA_TYPE_HANDLER_FILES.length,
      configuredBodyLimits: 1,
      skipped: 0,
    },
    facts: {
      declaredPageCapGaps: [...DECLARED_PAGE_CAP_GAPS],
      bodyByteLimit: "6MB product image multipart",
      decompressedBodyLimit: "undefined",
      contentEncodingPolicy: "container-default",
      duplicateQueryParameterPolicy: "container-default",
      parserDepthLimit: "dependency-default",
      unknownJsonFields: "explicit-fail-closed",
    },
  };
}

export function runApiResourceBoundaryGate(repositoryRoot) {
  const result = inspectApiResourceBoundaries(repositoryRoot);
  if (result.issues.length) {
    throw new ApiResourceBoundaryGateError(result.issues);
  }
  return result;
}

function printSummary(result, passed) {
  const status = passed ? "PASS" : "FAIL";
  const summary = result.summary;
  const line =
    `API resource boundary gate ${status}: ` +
    `lists=${summary.listEndpoints}, explicitPageCaps=${summary.explicitPageCaps}, ` +
    `undefinedPageCaps=${summary.undefinedPageCaps}, searchLimits=${summary.searchLimits}, ` +
    `dtoLimits=${summary.dtoLimits}, unsupportedMediaTypeMappings=${summary.unsupportedMediaTypeMappings}, ` +
    `configuredBodyLimits=${summary.configuredBodyLimits}, ` +
    `skipped=${summary.skipped}`;
  (passed ? console.log : console.error)(line);
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  if (process.argv.length !== 2) {
    const failure = {
      issues: [
        issue(
          "EXTERNAL_INPUT_REJECTED",
          "this offline gate accepts no path, URL, environment, or credential input",
        ),
      ],
      summary: {
        listEndpoints: 0,
        explicitPageCaps: 0,
        undefinedPageCaps: 0,
        searchLimits: 0,
        dtoLimits: 0,
        unsupportedMediaTypeMappings: 0,
        configuredBodyLimits: 0,
        skipped: 0,
      },
    };
    console.error(failure.issues.map((value) => `[${value.code}] ${value.message}`).join("\n"));
    printSummary(failure, false);
    process.exitCode = 2;
  } else {
    const result = inspectApiResourceBoundaries(LOCKED_REPOSITORY_ROOT);
    if (result.issues.length) {
      console.error(
        result.issues
          .map((value) => `[${value.code}] ${value.message}`)
          .join("\n"),
      );
      printSummary(result, false);
      process.exitCode = 1;
    } else {
      printSummary(result, true);
    }
  }
}
