import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  AuditCoverageGateError,
  isReadOnlyExportEndpoint,
  inspectAuditCoverage,
  runAuditCoverageGate,
} from "./audit-coverage-gate.mjs";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..", "..");
const temporaryRoots = [];

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => left.localeCompare(right, "en"))
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xz-erp-audit-gate-"));
  temporaryRoots.push(root);
  fs.cpSync(
    path.join(REPOSITORY_ROOT, "platform/backend/src/main"),
    path.join(root, "platform/backend/src/main"),
    { recursive: true },
  );
  fs.cpSync(
    path.join(REPOSITORY_ROOT, "platform/contracts"),
    path.join(root, "platform/contracts"),
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

function rewriteAuditBaseline(root, transform) {
  const relative = "platform/contracts/audit-coverage-baseline.json";
  const target = path.join(root, relative);
  const value = JSON.parse(fs.readFileSync(target, "utf8"));
  transform(value);
  delete value.integritySha256;
  value.integritySha256 = crypto
    .createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function expectIssue(root, expectedCode) {
  assert.throws(
    () => runAuditCoverageGate(root),
    (error) =>
      error instanceof AuditCoverageGateError &&
      error.issues.some((value) => value.code === expectedCode),
  );
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("real repository has deterministic, complete write classification", () => {
  const first = runAuditCoverageGate(REPOSITORY_ROOT);
  const second = runAuditCoverageGate(REPOSITORY_ROOT);
  assert.deepEqual(first.summary, second.summary);
  assert.equal(first.summary.writeEndpoints, 166);
  assert.equal(first.summary.classified, 166);
  assert.equal(first.summary.transactionalBusiness, 128);
  assert.equal(first.summary.failClosedNoSuccess, 0);
  assert.equal(first.summary.skipped, 0);
});

test("read-authorized synchronous exports are not treated as state changes", () => {
  assert.equal(isReadOnlyExportEndpoint({
    method: "POST",
    path: "/api/v1/inventory-center/counts/exports",
    requiredAuthorities: ["inventory.read"],
  }), true);
  assert.equal(isReadOnlyExportEndpoint({
    method: "POST",
    path: "/api/v1/order-center/orders/exports",
    requiredAuthorities: ["orders.write"],
  }), false);
  assert.equal(isReadOnlyExportEndpoint({
    method: "POST",
    path: "/api/v1/inventory-center/counts/rebuild",
    requiredAuthorities: ["inventory.read"],
  }), false);
});

test("a write endpoint cannot disappear from the classification", () => {
  const root = fixture();
  rewriteAuditBaseline(root, (value) => {
    value.operations = value.operations.filter(
      (operation) =>
        operation.operationId !== "ProductCenterController#createSpu",
    );
  });
  expectIssue(root, "WRITE_ENDPOINT_UNCLASSIFIED");
});

test("a business service method must select its approved action", () => {
  const root = fixture();
  edit(
    root,
    "platform/backend/src/main/java/cn/xzkj/erp/product/service/ProductCenterService.java",
    (content) =>
      content.replace(
        "audit(actor, SPU_CREATED,",
        "audit(actor, SPU_UPDATED,",
      ),
  );
  expectIssue(root, "METHOD_ACTION_EVIDENCE_MISSING");
});

test("attempted filter evidence never satisfies committed success", () => {
  const root = fixture();
  edit(
    root,
    "platform/backend/src/main/java/cn/xzkj/erp/product/service/ProductCenterService.java",
    (content) =>
      content.replace(
        "auditRecorder.recordAtomically(new SecurityAuditEvent(",
        "auditRecorder.record(new SecurityAuditEvent(",
      ),
  );
  expectIssue(root, "ATOMIC_RECORDER_MISSING");
});

test("attempted filter must retain attempted-only recorder semantics", () => {
  const root = fixture();
  edit(
    root,
    "platform/backend/src/main/java/cn/xzkj/erp/platformadmin/security/PlatformAdminTenantWriteAuditFilter.java",
    (content) =>
      content.replace(
        "auditRecorder.record(new SecurityAuditEvent(",
        "auditRecorder.recordAtomically(new SecurityAuditEvent(",
      ),
  );
  expectIssue(root, "ATTEMPTED_EVIDENCE_MISCLASSIFIED");
});

test("secret-bearing fields cannot enter business audit details", () => {
  const root = fixture();
  edit(
    root,
    "platform/backend/src/main/java/cn/xzkj/erp/warehouse/service/WarehouseMasterDataService.java",
    (content) =>
      content.replace(
        'Map.of("status", saved.getStatus().name()))',
        'Map.of("password", name))',
      ),
  );
  expectIssue(root, "SENSITIVE_DETAIL_BOUNDARY_VIOLATION");
});

test("action and resource contracts are source verified", () => {
  const root = fixture();
  rewriteAuditBaseline(root, (value) => {
    const operation = value.operations.find(
      (candidate) =>
        candidate.operationId === "WarehouseController#createWarehouse",
    );
    operation.actions[0].value = "warehouse.created.unreviewed";
    operation.resourceTypes = ["request_body"];
  });
  const result = inspectAuditCoverage(root);
  assert.ok(
    result.issues.some((value) => value.code === "ACTION_CONTRACT_MISMATCH"),
  );
  assert.ok(
    result.issues.some((value) => value.code === "RESOURCE_CONTRACT_MISMATCH"),
  );
});

test("new writes fail closed before audit classification can absorb them", () => {
  const root = fixture();
  edit(
    root,
    "platform/backend/src/main/java/cn/xzkj/erp/warehouse/api/WarehouseController.java",
    (content) =>
      content.replace(
        "    private static Pageable pageable",
        '    @PostMapping("/unreviewed")\n'
          + '    @PreAuthorize("hasAuthority(\'warehouses.write\')")\n'
          + "    public void unreviewed() { }\n\n"
          + "    private static Pageable pageable",
      ),
  );
  expectIssue(root, "API_CONTRACT_GATE_FAILED");
});

test("source symbolic links fail closed", () => {
  const root = fixture();
  const external = fs.mkdtempSync(path.join(os.tmpdir(), "xz-erp-audit-link-"));
  temporaryRoots.push(external);
  fs.symlinkSync(
    external,
    path.join(root, "platform/backend/src/main/java/__external"),
    "junction",
  );
  expectIssue(root, "API_CONTRACT_GATE_FAILED");
});

test("CLI rejects repository roots, paths, URLs, and other input", () => {
  const script = path.join(
    REPOSITORY_ROOT,
    "platform/scripts/audit-coverage-gate.mjs",
  );
  for (const input of [
    REPOSITORY_ROOT,
    "platform/contracts/audit-coverage-baseline.json",
    "https://example.invalid/audit.json",
    ".env",
  ]) {
    const result = spawnSync(process.execPath, [script, input], {
      encoding: "utf8",
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /\[EXTERNAL_INPUT_REJECTED\]/);
    assert.match(result.stderr, /skipped=0/);
    assert.doesNotMatch(result.stderr, /example\.invalid/);
  }
});

test("baseline tampering and failures are deterministic and sorted", () => {
  const root = fixture();
  edit(
    root,
    "platform/contracts/audit-coverage-baseline.json",
    (content) => content.replace('"schemaVersion": 1', '"schemaVersion": 2'),
  );
  const first = inspectAuditCoverage(root);
  const second = inspectAuditCoverage(root);
  assert.deepEqual(first.issues, second.issues);
  assert.equal(first.summary.skipped, 0);
  assert.ok(
    first.issues.some((value) => value.code === "BASELINE_INTEGRITY_MISMATCH"),
  );
  assert.deepEqual(
    first.issues,
    [...first.issues].sort(
      (left, right) =>
        left.code.localeCompare(right.code, "en") ||
        left.message.localeCompare(right.message, "en"),
    ),
  );
});
