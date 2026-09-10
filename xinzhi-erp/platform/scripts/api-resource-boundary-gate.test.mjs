import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ApiResourceBoundaryGateError,
  inspectApiResourceBoundaries,
  runApiResourceBoundaryGate,
} from "./api-resource-boundary-gate.mjs";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..", "..");
const temporaryRoots = [];

function fixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "xz-erp-api-resource-boundary-"),
  );
  temporaryRoots.push(root);
  for (const relative of [
    "platform/backend/src/main/java",
    "platform/backend/src/main/resources/application.yml",
    "platform/backend/src/main/resources/application-production.yml",
    "platform/backend/pom.xml",
    "platform/frontend/nginx.conf",
  ]) {
    fs.cpSync(path.join(REPOSITORY_ROOT, relative), path.join(root, relative), {
      recursive: true,
    });
  }
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
    () => runApiResourceBoundaryGate(root),
    (error) =>
      error instanceof ApiResourceBoundaryGateError &&
      error.issues.some((value) => value.code === expectedCode),
  );
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the repository fact matrix is complete and deterministic", () => {
  const first = runApiResourceBoundaryGate(REPOSITORY_ROOT);
  const second = runApiResourceBoundaryGate(REPOSITORY_ROOT);
  assert.deepEqual(first, second);
  assert.deepEqual(first.summary, {
    listEndpoints: 76,
    explicitPageCaps: 14,
    undefinedPageCaps: 62,
    searchLimits: 47,
    dtoLimits: 11,
    unsupportedMediaTypeMappings: 6,
    configuredBodyLimits: 1,
    skipped: 0,
  });
  assert.equal(first.issues.length, 0);
  assert.equal(first.facts.unknownJsonFields, "explicit-fail-closed");
});

test("removing an explicit page cap fails closed", () => {
  const root = fixture();
  edit(
    root,
    "platform/backend/src/main/java/cn/xzkj/erp/order/api/OrderCenterController.java",
    (content) => content.replace(" @Min(0) @Max(1_000_000) int page", " @Min(0) int page"),
  );
  expectIssue(root, "PAGE_MAX_CLASSIFICATION_DRIFT");
});

test("removing a page-size cap fails closed", () => {
  const root = fixture();
  edit(
    root,
    "platform/backend/src/main/java/cn/xzkj/erp/warehouse/api/WarehouseController.java",
    (content) =>
      content.replace(
        '@RequestParam(defaultValue = "50") @Min(1) @Max(MAX_PAGE_SIZE) int size',
        '@RequestParam(defaultValue = "50") @Min(1) int size',
      ),
  );
  expectIssue(root, "PAGE_SIZE_BOUND_DRIFT");
});

test("label paper size is not mistaken for its pagination limit", () => {
  const root = fixture();
  edit(root,
    "platform/backend/src/main/java/cn/xzkj/erp/logistics/labeltemplate/LabelTemplateController.java",
    (content) => content.replace("@Min(1) @Max(100) int pageSize", "@Min(1) int pageSize"));
  expectIssue(root, "PAGE_SIZE_BOUND_DRIFT");
});

test("a newly inventoried member application cap cannot disappear", () => {
  const root = fixture();
  edit(root,
    "platform/backend/src/main/java/cn/xzkj/erp/tenantaccess/MemberApplicationAccessController.java",
    (content) => content.replace("@Max(IamAdministrationService.MAX_PAGE_NUMBER)", ""));
  expectIssue(root, "PAGE_MAX_CLASSIFICATION_DRIFT");
});

test("DTO and search limit drift is rejected", () => {
  const root = fixture();
  edit(
    root,
    "platform/backend/src/main/java/cn/xzkj/erp/product/api/ProductCenterDtos.java",
    (content) =>
      content.replace(
        "@Size(max = 200) String name,",
        "@Size(max = 2000) String name,",
      ),
  );
  edit(
    root,
    "platform/backend/src/main/java/cn/xzkj/erp/product/api/ProductCenterController.java",
    (content) => content.replaceAll("@Size(max = 100) String keyword", "@Size(max = 1000) String keyword"),
  );
  const result = inspectApiResourceBoundaries(root);
  assert.ok(result.issues.some((value) => value.code === "DTO_BOUNDARY_DRIFT"));
  assert.ok(result.issues.some((value) => value.code === "SEARCH_BOUNDARY_DRIFT"));
});

test("unknown-field fail-closed policy drift is rejected", () => {
  const root = fixture();
  edit(
    root,
    "platform/backend/src/main/resources/application.yml",
    (content) =>
      content.replace(
        "fail-on-unknown-properties: true",
        "fail-on-unknown-properties: false",
      ),
  );
  expectIssue(root, "UNKNOWN_FIELD_POLICY_DRIFT");
});

test("new server body or parser thresholds require explicit review", () => {
  const root = fixture();
  edit(
    root,
    "platform/backend/src/main/resources/application-production.yml",
    (content) => `${content}\nserver:\n  tomcat:\n    max-swallow-size: 1MB\n`,
  );
  expectIssue(root, "SERVER_BOUNDARY_REVIEW_REQUIRED");
});

test("Testcontainers version drift is rejected", () => {
  const root = fixture();
  edit(
    root,
    "platform/backend/pom.xml",
    (content) =>
      content.replace(
        "<testcontainers.version>1.21.4</testcontainers.version>",
        "<testcontainers.version>1.22.0</testcontainers.version>",
      ),
  );
  expectIssue(root, "TESTCONTAINERS_VERSION_DRIFT");
});

test("removing a safe 415 advice mapping fails closed", () => {
  const root = fixture();
  edit(
    root,
    "platform/backend/src/main/java/cn/xzkj/erp/iam/web/AuthExceptionHandler.java",
    (content) =>
      content.replace(
        "HttpStatus.UNSUPPORTED_MEDIA_TYPE",
        "HttpStatus.BAD_REQUEST",
      ),
  );
  expectIssue(root, "UNSUPPORTED_MEDIA_TYPE_MAPPING_DRIFT");
});

test("logging from a 415 mapping is rejected as a disclosure risk", () => {
  const root = fixture();
  edit(
    root,
    "platform/backend/src/main/java/cn/xzkj/erp/platform/api/ApiExceptionHandler.java",
    (content) =>
      content.replace(
        'return error(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "invalid_request",',
        'LOGGER.warn("unsupported media");\n        return error(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "invalid_request",',
      ),
  );
  expectIssue(root, "UNSUPPORTED_MEDIA_TYPE_DISCLOSURE_RISK");
});

test("the executable accepts no external input and reports zero skipped", () => {
  const result = spawnSync(
    process.execPath,
    [
      path.join(
        REPOSITORY_ROOT,
        "platform/scripts/api-resource-boundary-gate.mjs",
      ),
      REPOSITORY_ROOT,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /\[EXTERNAL_INPUT_REJECTED\]/);
  assert.match(result.stderr, /skipped=0/);
});
