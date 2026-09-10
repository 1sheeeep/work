import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ApiContractGateError,
  inspectApiContract,
  runApiContractGate,
} from "./api-contract-gate.mjs";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..", "..");
const temporaryRoots = [];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xz-erp-api-contract-"));
  temporaryRoots.push(root);
  fs.cpSync(
    path.join(REPOSITORY_ROOT, "platform/backend/src/main"),
    path.join(root, "platform/backend/src/main"),
    { recursive: true },
  );
  fs.cpSync(
    path.join(REPOSITORY_ROOT, "platform/contracts/api-contract-baseline.json"),
    path.join(root, "platform/contracts/api-contract-baseline.json"),
    { recursive: true },
  );
  return root;
}

function edit(root, relative, transform) {
  const target = path.join(root, relative);
  const original = fs.readFileSync(target, "utf8");
  const changed = transform(original);
  assert.notEqual(changed, original, `fixture edit did not change ${relative}`);
  fs.writeFileSync(target, changed, "utf8");
}

function expectIssue(root, expectedCode) {
  assert.throws(
    () => runApiContractGate(root),
    (error) =>
      error instanceof ApiContractGateError &&
      error.issues.some((value) => value.code === expectedCode),
  );
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the real repository passes deterministically with source-derived facts", () => {
  const first = runApiContractGate(REPOSITORY_ROOT);
  const second = runApiContractGate(REPOSITORY_ROOT);
  assert.deepEqual(first.summary, second.summary);
  assert.deepEqual(first.baseline, second.baseline);
  assert.equal(first.summary.skipped, 0);
  assert.equal(first.issues.length, 0);
  assert.equal(first.summary.endpoints, 302);
  assert.equal(first.summary.requestSchemas, 155);
  const inventoryExceptions = first.baseline.endpoints.find(
    (endpoint) =>
      endpoint.operationId === "InventoryShopifyController#listExceptions",
  );
  assert.deepEqual(inventoryExceptions?.requiredAuthorities, [
    "inventory.read",
    "inventory.shopify.publish",
    "shop:read",
  ]);
  const createPurchaseOrder = first.baseline.endpoints.find(
    (endpoint) => endpoint.operationId === "ProcurementPurchaseOrderController#create",
  );
  assert.deepEqual(createPurchaseOrder?.requiredAuthorities, ["procurement.write"]);
  const listPurchaseOrders = first.baseline.endpoints.find(
    (endpoint) => endpoint.operationId === "ProcurementPurchaseOrderController#list",
  );
  const receivableOnly = listPurchaseOrders?.queryParameters.find(
    (parameter) => parameter.name === "receivableOnly",
  );
  assert.equal(receivableOnly?.required, false);
  assert.equal(receivableOnly?.defaultValue, "false");
  const receivePurchaseOrder = first.baseline.endpoints.find(
    (endpoint) => endpoint.operationId === "ProcurementPurchaseOrderController#receive",
  );
  assert.equal(receivePurchaseOrder?.path, "/api/v1/procurement/orders/{purchaseOrderId}/receipts");
  assert.deepEqual(receivePurchaseOrder?.requiredAuthorities, ["procurement.write"]);
  const listPurchaseReceipts = first.baseline.endpoints.find(
    (endpoint) => endpoint.operationId === "ProcurementPurchaseOrderController#listReceipts",
  );
  assert.equal(listPurchaseReceipts?.path, "/api/v1/procurement/orders/receipts");
  assert.deepEqual(listPurchaseReceipts?.requiredAuthorities, ["procurement.read"]);
  const purchaseKeyword = listPurchaseReceipts?.queryParameters.find(
    (parameter) => parameter.name === "purchaseKeyword",
  );
  assert.equal(purchaseKeyword?.required, false);
  assert.ok(purchaseKeyword?.constraints.includes("@Size(max = 120)"));
  const createMember = first.baseline.requestSchemas.find(
    (schema) =>
      schema.name === "cn.xzkj.erp.iam.web.CreateMemberRequest",
  );
  const email = createMember?.fields.find(
    (field) => field.name === "email",
  );
  assert.equal(email?.required, false);
  assert.ok(
    email?.constraints.includes(
      "@Size(max = 254)",
    ),
  );
  const listShops = first.baseline.endpoints.find(
    (endpoint) => endpoint.operationId === "ShopCenterController#listShops",
  );
  assert.deepEqual(
    listShops?.requiredAuthorities,
    ["customer_service.read", "shop:read"],
  );
  const getShopChannels = first.baseline.endpoints.find(
    (endpoint) => endpoint.operationId === "ShopChannelController#get",
  );
  assert.deepEqual(
    getShopChannels?.requiredAuthorities,
    ["customer_service.read", "shop:read"],
  );
  const listSkus = first.baseline.endpoints.find(
    (endpoint) => endpoint.operationId === "ProductCenterController#listSkus",
  );
  assert.deepEqual(
    listSkus?.requiredAuthorities,
    ["products.read", "suppliers.read"],
  );
  assert.deepEqual(
    listSkus?.queryParameters
      .map((parameter) => parameter.name)
      .filter((name) => [
        "artMemberId",
        "developerAssistantMemberId",
        "developerMemberId",
        "salesMemberId",
      ].includes(name)),
    [
      "artMemberId",
      "developerAssistantMemberId",
      "developerMemberId",
      "salesMemberId",
    ],
  );
  const listOrders = first.baseline.endpoints.find(
    (endpoint) => endpoint.operationId === "OrderCenterController#listOrders",
  );
  assert.deepEqual(
    listOrders?.queryParameters
      .map((parameter) => parameter.name)
      .filter((name) => ["developerUserId", "salespersonUserId"].includes(name)),
    ["developerUserId", "salespersonUserId"],
  );
  assert.ok(
    !first.baseline.endpoints.some(
      (endpoint) => endpoint.operationId === "ProductCenterController#hasAuthority",
    ),
  );
  const shopifyOrderImport = first.baseline.requestSchemas.find(
    (schema) =>
      schema.name === "cn.xzkj.erp.order.api.ShopifyOrderCatalogImportRequest",
  );
  const externalOrderRefs = shopifyOrderImport?.fields.find(
    (field) => field.name === "externalOrderRefs",
  );
  assert.equal(externalOrderRefs?.required, true);
  assert.ok(externalOrderRefs?.constraints.includes("@NotEmpty"));
});

test("endpoint deletion is a breaking change", () => {
  const root = fixture();
  edit(
    root,
    "platform/backend/src/main/java/cn/xzkj/erp/warehouse/api/WarehouseController.java",
    (content) => content.replace('    @GetMapping("/{warehouseId}")\n', ""),
  );
  expectIssue(root, "ENDPOINT_REMOVED");
});

test("method or path changes are a breaking change", () => {
  const root = fixture();
  edit(
    root,
    "platform/backend/src/main/java/cn/xzkj/erp/product/api/ProductCenterController.java",
    (content) => content.replace('@GetMapping("/spus/{spuId}")', '@PostMapping("/spus/{spuId}")'),
  );
  expectIssue(root, "ENDPOINT_METHOD_OR_PATH_CHANGED");
});

test("permission lowering is rejected", () => {
  const root = fixture();
  edit(
    root,
    "platform/backend/src/main/java/cn/xzkj/erp/warehouse/api/WarehouseController.java",
    (content) => content.replace("hasAuthority('warehouses.write')", "hasAuthority('warehouses.read')"),
  );
  expectIssue(root, "AUTHORITY_CHANGED");
});

test("permission removal is rejected", () => {
  const root = fixture();
  edit(
    root,
    "platform/backend/src/main/java/cn/xzkj/erp/supplier/api/SupplierController.java",
    (content) => content.replace('    @PreAuthorize("hasAuthority(\'suppliers.read\')")\n', ""),
  );
  expectIssue(root, "AUTHORITY_CHANGED");
});

test("platform-admin and tenant trust domains cannot be mixed", () => {
  const root = fixture();
  edit(
    root,
    "platform/backend/src/main/java/cn/xzkj/erp/platformadmin/web/PlatformAdminController.java",
    (content) => content.replace('@RequestMapping("/api/v1/platform-admin")', '@RequestMapping("/api/v1/platform-center")'),
  );
  expectIssue(root, "TRUST_DOMAIN_CHANGED");
});

test("required request fields cannot be removed", () => {
  const root = fixture();
  edit(
    root,
    "platform/backend/src/main/java/cn/xzkj/erp/warehouse/api/WarehouseDtos.java",
    (content) => content.replace('            @NotBlank @Pattern(regexp = BUSINESS_CODE_PATTERN) String businessCode,\n', ""),
  );
  expectIssue(root, "REQUEST_FIELD_REMOVED");
});

test("regex quantifiers in Pattern constraints are parsed and protected", () => {
  const root = fixture();
  edit(
    root,
    "platform/backend/src/main/java/cn/xzkj/erp/iam/web/IamAdminController.java",
    (content) => content.replace(
      '@Pattern(regexp = "^[a-z][a-z0-9_-]{0,99}$")\n            String code',
      '@Pattern(regexp = "^[a-z][a-z0-9_-]{0,98}$")\n            String code',
    ),
  );
  expectIssue(root, "REQUEST_FIELD_CONSTRAINT_CHANGED");
});

test("request field type changes are rejected", () => {
  const root = fixture();
  edit(
    root,
    "platform/backend/src/main/java/cn/xzkj/erp/warehouse/operations/api/ManualMovementDtos.java",
    (content) => content.replace("String contactPhone", "Integer contactPhone"),
  );
  expectIssue(root, "REQUEST_FIELD_TYPE_CHANGED");
});

test("required query parameter changes are rejected", () => {
  const root = fixture();
  edit(
    root,
    "platform/backend/src/main/java/cn/xzkj/erp/warehouse/api/WarehouseController.java",
    (content) => content.replace('@RequestParam(defaultValue = "0") @Min(0) int page', '@RequestParam @Min(0) int page'),
  );
  expectIssue(root, "REQUEST_PARAMETER_CHANGED");
});

test("response type and status changes are rejected", () => {
  const root = fixture();
  edit(
    root,
    "platform/backend/src/main/java/cn/xzkj/erp/iam/web/AuthController.java",
    (content) => content
      .replace("@ResponseStatus(HttpStatus.NO_CONTENT)\n    public void logout", "@ResponseStatus(HttpStatus.OK)\n    public void logout")
      .replace("public CurrentUserResponse me(", "public LoginResponse me("),
  );
  expectIssue(root, "RESPONSE_CONTRACT_CHANGED");
});

test("new endpoints are surfaced for explicit refresh and review", () => {
  const root = fixture();
  edit(
    root,
    "platform/backend/src/main/java/cn/xzkj/erp/warehouse/api/WarehouseController.java",
    (content) => content.replace("    private static Pageable pageable", "    @GetMapping(\"/new-contract\")\n    @PreAuthorize(\"hasAuthority('warehouses.read')\")\n    public String newContract() { return \"ok\"; }\n\n    private static Pageable pageable"),
  );
  expectIssue(root, "NEW_ENDPOINT_REQUIRES_REVIEW");
});

test("dynamic mappings fail closed", () => {
  const root = fixture();
  edit(
    root,
    "platform/backend/src/main/java/cn/xzkj/erp/system/SystemInfoController.java",
    (content) => content.replace('@GetMapping("/info")', "@GetMapping(SYSTEM_INFO_PATH)"),
  );
  expectIssue(root, "DYNAMIC_MAPPING_UNRESOLVED");
});

test("literal mapping paths remain resolvable with other Spring mapping attributes", () => {
  const root = fixture();
  edit(
    root,
    "platform/backend/src/main/java/cn/xzkj/erp/warehouse/api/WarehouseController.java",
    (content) => content.replace(
      '@GetMapping("/{warehouseId}")',
      '@GetMapping(value = "/{warehouseId}", produces = "application/json")',
    ),
  );
  const result = inspectApiContract(root);
  assert.ok(!result.issues.some((value) => value.code === "DYNAMIC_MAPPING_UNRESOLVED"));
});

test("tampered baseline integrity is rejected", () => {
  const root = fixture();
  edit(
    root,
    "platform/contracts/api-contract-baseline.json",
    (content) => content.replace('"schemaVersion": 1', '"schemaVersion": 2'),
  );
  expectIssue(root, "BASELINE_INTEGRITY_MISMATCH");
});

test("source symbolic links are rejected", () => {
  const root = fixture();
  const external = fs.mkdtempSync(path.join(os.tmpdir(), "xz-erp-api-link-target-"));
  temporaryRoots.push(external);
  fs.symlinkSync(external, path.join(root, "platform/backend/src/main/java/__external"), "junction");
  expectIssue(root, "SOURCE_SYMLINK_REJECTED");
});

test("the executable rejects path, URL, and root injection", () => {
  const result = spawnSync(
    process.execPath,
    [path.join(REPOSITORY_ROOT, "platform/scripts/api-contract-gate.mjs"), REPOSITORY_ROOT],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /\[EXTERNAL_INPUT_REJECTED\]/);
  assert.match(result.stderr, /skipped=0/);
});

test("failure reports are sorted and never silently skipped", () => {
  const root = fixture();
  edit(
    root,
    "platform/backend/src/main/java/cn/xzkj/erp/warehouse/api/WarehouseController.java",
    (content) => content.replace("hasAuthority('warehouses.read')", "hasAuthority('warehouses.reed')"),
  );
  const result = inspectApiContract(root);
  assert.ok(result.issues.length > 0);
  assert.equal(result.summary.skipped, 0);
  assert.deepEqual(
    result.issues,
    [...result.issues].sort((left, right) =>
      left.code.localeCompare(right.code, "en") ||
      left.message.localeCompare(right.message, "en"),
    ),
  );
});
