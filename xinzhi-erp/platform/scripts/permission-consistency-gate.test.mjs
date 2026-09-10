import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  PermissionGateError,
  inspectPermissionConsistency,
  runPermissionConsistencyGate,
} from "./permission-consistency-gate.mjs";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..", "..");
const temporaryRoots = [];

function fixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "xz-erp-permission-gate-"),
  );
  temporaryRoots.push(root);
  for (const relative of [
    "platform/backend/src/main",
    "platform/frontend/src",
  ]) {
    const source = path.join(REPOSITORY_ROOT, relative);
    const destination = path.join(root, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(source, destination, { recursive: true });
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
    () => runPermissionConsistencyGate(root),
    (error) =>
      error instanceof PermissionGateError &&
      error.issues.some((value) => value.code === expectedCode),
  );
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the real repository passes with deterministic, source-derived facts", () => {
  const first = runPermissionConsistencyGate(REPOSITORY_ROOT);
  const second = runPermissionConsistencyGate(REPOSITORY_ROOT);
  assert.deepEqual(first.summary, second.summary);
  assert.deepEqual(first.placeholderModules, second.placeholderModules);
  assert.equal(
    first.summary.failClosedPlaceholders,
    first.placeholderModules.length,
  );
  assert.ok(first.placeholderModules.length > 0);
  assert.equal(first.issues.length, 0);
});

test("an injected frontend spelling drift fails as an unknown permission", () => {
  const root = fixture();
  edit(
    root,
    "platform/frontend/src/pages/WarehouseCenterPage.tsx",
    (content) => `${content}\nvoid hasPermission("warehouses.reed")\n`,
  );
  expectIssue(root, "FRONTEND_PERMISSION_NOT_CATALOGED");
});

test("an injected backend authority without a catalog entry fails", () => {
  const root = fixture();
  edit(
    root,
    "platform/backend/src/main/java/cn/xzkj/erp/warehouse/api/WarehouseController.java",
    (content) =>
      content.replace(
        "hasAuthority('warehouses.read')",
        "hasAuthority('warehouses.reed')",
      ),
  );
  expectIssue(root, "BACKEND_PERMISSION_NOT_CATALOGED");
});

test("an internal endpoint authority must be issued by its authentication filter", () => {
  const root = fixture();
  edit(
    root,
    "platform/backend/src/main/java/cn/xzkj/erp/customer/service/CustomerServiceEntryController.java",
    (content) =>
      content.replace(
        "internal.customer_service.entry_grant.redeem",
        "internal.customer_service.entry_grant.unknown",
      ),
  );
  expectIssue(root, "BACKEND_PERMISSION_NOT_CATALOGED");
});

test("an unknown role-bootstrap permission is rejected", () => {
  const root = fixture();
  edit(
    root,
    "platform/backend/src/main/java/cn/xzkj/erp/iam/bootstrap/TenantAdminPermissionCodes.java",
    (content) =>
      content.replace(
        '"iam:permission:assign"',
        '"iam:permission:assing"',
      ),
  );
  expectIssue(root, "BACKEND_PERMISSION_NOT_CATALOGED");
});

test("a tenant administrator bootstrap permission drift is rejected", () => {
  const root = fixture();
  edit(
    root,
    "platform/backend/src/main/java/cn/xzkj/erp/iam/bootstrap/TenantAdminPermissionCodes.java",
    (content) => content.replace('            "inventory.read",\n', ""),
  );
  expectIssue(root, "TENANT_ADMIN_PERMISSION_MISSING");
});

test("a retired permission is excluded by the later catalog deletion", () => {
  const root = fixture();
  edit(
    root,
    "platform/backend/src/main/resources/db/migration/V76__shipping_weighing.sql",
    (content) =>
      content.replace(
        "DELETE FROM permissions\nWHERE code IN ('orders.dispute.read', 'orders.dispute.write');\n",
        "",
      ),
  );
  expectIssue(root, "TENANT_ADMIN_PERMISSION_MISSING");
});

test("removing a backend business endpoint authority guard is rejected", () => {
  const root = fixture();
  edit(
    root,
    "platform/backend/src/main/java/cn/xzkj/erp/warehouse/api/WarehouseController.java",
    (content) =>
      content.replace(
        '    @PreAuthorize("hasAuthority(\'warehouses.read\')")\n',
        "",
      ),
  );
  expectIssue(root, "BACKEND_ENDPOINT_GUARD_MISSING");
});

test("removing the dynamic direct-route guard fails closed verification", () => {
  const root = fixture();
  edit(root, "platform/frontend/src/App.tsx", (content) =>
    content.replace(
      "<ModuleAccessGate module={module}>",
      "<ModuleAccessGateBypassed module={module}>",
    ),
  );
  expectIssue(root, "ROUTE_GUARD_MISSING");
});

test("removing a dedicated detail-route guard is rejected", () => {
  const root = fixture();
  edit(root, "platform/frontend/src/App.tsx", (content) =>
    content.replace(
      "<ModuleAccessGate module={shopsModule}>",
      "<ModuleAccessGateBypassed module={shopsModule}>",
    ),
  );
  expectIssue(root, "ROUTE_GUARD_MISSING");
});

test("removing the IAM page-level 403 guard is rejected", () => {
  const root = fixture();
  edit(
    root,
    "platform/frontend/src/pages/IamConsolePage.tsx",
    (content) => content.replace("if (!any)", "if (false)"),
  );
  expectIssue(root, "IAM_DIRECT_ROUTE_GUARD_MISSING");
});

test("bypassing permission-filtered grouped navigation is rejected", () => {
  const root = fixture();
  edit(
    root,
    "platform/frontend/src/components/AppShell.tsx",
    (content) =>
      content.replace(
        "getAccessibleTenantNavigation(hasPermission)",
        "tenantNavigation",
      ),
  );
  expectIssue(root, "MENU_GUARD_MISSING");
});

test("drifting the IAM navigation permission set is rejected", () => {
  const root = fixture();
  edit(
    root,
    "platform/frontend/src/modules/navigationDefinitions.ts",
    (content) =>
      content.replace('"iam:audit:read",', '"shop:read",'),
  );
  expectIssue(root, "IAM_MENU_PAGE_GUARD_DRIFT");
});

test("mixing SYSTEM_ADMIN into an entered enterprise session is rejected", () => {
  const root = fixture();
  edit(
    root,
    "platform/backend/src/main/java/cn/xzkj/erp/iam/security/BearerTokenAuthenticationFilter.java",
    (content) => {
      const marker = "private void authenticatePlatformTenantSession(";
      const start = content.indexOf(marker);
      assert.notEqual(start, -1);
      return (
        content.slice(0, start) +
        content
          .slice(start)
          .replace(
            "PlatformAdminAuthorities.TENANT_SESSION",
            "PlatformAdminAuthorities.SYSTEM_ADMIN",
          )
      );
    },
  );
  expectIssue(root, "TRUST_DOMAIN_MIXED");
});

test("granting enterprise catalog permissions to a base SYSTEM_ADMIN session is rejected", () => {
  const root = fixture();
  edit(
    root,
    "platform/backend/src/main/java/cn/xzkj/erp/iam/security/BearerTokenAuthenticationFilter.java",
    (content) =>
      content.replace(
        "PlatformAdminSessionEntity platformSession = session;",
        "permissionRepository.findAllCodes();\n                    PlatformAdminSessionEntity platformSession = session;",
      ),
  );
  expectIssue(root, "TRUST_DOMAIN_MIXED");
});

test("a placeholder becoming foundation without a catalog entry is rejected", () => {
  const root = fixture();
  edit(
    root,
    "platform/frontend/src/modules/moduleDefinitions.ts",
    (content) =>
      content.replace(
        /(id:\s*'automation'[\s\S]*?status:\s*)'planned'/,
        "$1'foundation'",
      ),
  );
  expectIssue(root, "FRONTEND_PERMISSION_NOT_CATALOGED");
});

test("a placeholder gaining a dedicated page without a catalog entry is rejected", () => {
  const root = fixture();
  edit(root, "platform/frontend/src/App.tsx", (content) =>
    content.replace(
      "<LazyModulePage module={module} />",
      '{module.id === "automation" ? <LazyAutomationPage /> : <LazyModulePage module={module} />}',
    ),
  );
  expectIssue(root, "FRONTEND_PERMISSION_NOT_CATALOGED");
});

test("a placeholder gaining an API client without a catalog entry is rejected", () => {
  const root = fixture();
  edit(
    root,
    "platform/frontend/src/modules/orderCenterApi.ts",
    (content) => `${content}\nvoid "/api/v1/automation"\n`,
  );
  expectIssue(root, "FRONTEND_PERMISSION_NOT_CATALOGED");
});

test("a symbolic link inside scanned source is rejected", () => {
  const root = fixture();
  const external = fs.mkdtempSync(
    path.join(os.tmpdir(), "xz-erp-permission-link-target-"),
  );
  temporaryRoots.push(external);
  const link = path.join(root, "platform/frontend/src/__gate_external_link");
  fs.symlinkSync(external, link, "junction");
  expectIssue(root, "SOURCE_SYMLINK_REJECTED");
});

test("the executable rejects repository paths and all other CLI input", () => {
  const result = spawnSync(
    process.execPath,
    [
      path.join(REPOSITORY_ROOT, "platform/scripts/permission-consistency-gate.mjs"),
      REPOSITORY_ROOT,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /\[EXTERNAL_INPUT_REJECTED\]/);
  assert.match(result.stderr, /skipped=0/);
});

test("inspection reports sorted deterministic failures without throwing", () => {
  const root = fixture();
  edit(
    root,
    "platform/frontend/src/pages/OrderCenterPage.tsx",
    (content) => `${content}\nvoid hasPermission("orders.reed")\n`,
  );
  const result = inspectPermissionConsistency(root);
  assert.ok(result.issues.length > 0);
  assert.deepEqual(
    result.issues,
    [...result.issues].sort(
      (left, right) =>
        left.code.localeCompare(right.code, "en") ||
        left.message.localeCompare(right.message, "en"),
    ),
  );
});
