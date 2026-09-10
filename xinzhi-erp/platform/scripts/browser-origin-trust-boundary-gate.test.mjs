import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  BrowserOriginGateError,
  inspectBrowserOriginTrustBoundary,
  runBrowserOriginTrustBoundaryGate,
} from "./browser-origin-trust-boundary-gate.mjs";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..", "..");
const temporaryRoots = [];

function fixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "xz-erp-browser-origin-gate-"),
  );
  temporaryRoots.push(root);
  for (const relative of [
    "platform/backend/src/main/java",
    "platform/backend/src/main/resources",
    "platform/frontend/nginx.conf",
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

function expectIssue(root, code) {
  assert.throws(
    () => runBrowserOriginTrustBoundaryGate(root),
    (error) =>
      error instanceof BrowserOriginGateError
      && error.issues.some((value) => value.code === code),
  );
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the repository facts pass deterministically with zero skipped checks", () => {
  const first = runBrowserOriginTrustBoundaryGate(REPOSITORY_ROOT);
  const second = runBrowserOriginTrustBoundaryGate(REPOSITORY_ROOT);
  assert.deepEqual(first.summary, second.summary);
  assert.equal(first.summary.skipped, 0);
  assert.ok(first.summary.javaFiles > 0);
  assert.ok(first.summary.relativeLocations > 0);
  assert.deepEqual(first.issues, []);
});

test("enabling an application CORS surface requires explicit review", () => {
  const root = fixture();
  edit(
    root,
    "platform/backend/src/main/java/cn/xzkj/erp/config/SecurityConfig.java",
    (content) => content.replace(
      ".csrf(csrf -> csrf.disable())",
      ".cors(cors -> {}).csrf(csrf -> csrf.disable())",
    ),
  );
  expectIssue(root, "CORS_POLICY_UNREVIEWED");
});

test("stateful session authentication fails the static boundary", () => {
  const root = fixture();
  edit(
    root,
    "platform/backend/src/main/java/cn/xzkj/erp/config/SecurityConfig.java",
    (content) => content.replace(
      "SessionCreationPolicy.STATELESS",
      "SessionCreationPolicy.IF_REQUIRED",
    ),
  );
  expectIssue(root, "STATELESS_BOUNDARY_CHANGED");
});

test("a backend authentication cookie surface is rejected", () => {
  const root = fixture();
  edit(
    root,
    "platform/backend/src/main/java/cn/xzkj/erp/config/SecurityConfig.java",
    (content) => content.replace(
      "public class SecurityConfig {",
      "public class SecurityConfig { jakarta.servlet.http.Cookie forbiddenCookie;",
    ),
  );
  expectIssue(root, "AUTH_COOKIE_SURFACE");
});

test("an Nginx origin reflection policy is rejected", () => {
  const root = fixture();
  edit(
    root,
    "platform/frontend/nginx.conf",
    (content) => content.replace(
      "location ^~ /api/ {",
      "location ^~ /api/ {\n        add_header Access-Control-Allow-Origin $http_origin;",
    ),
  );
  expectIssue(root, "EDGE_CORS_POLICY_UNREVIEWED");
});

test("credentialed wildcard CORS is rejected explicitly", () => {
  const root = fixture();
  edit(
    root,
    "platform/frontend/nginx.conf",
    (content) => content.replace(
      "location ^~ /api/ {",
      [
        "location ^~ /api/ {",
        '        add_header Access-Control-Allow-Origin "*";',
        '        add_header Access-Control-Allow-Credentials "true";',
      ].join("\n"),
    ),
  );
  expectIssue(root, "CREDENTIALED_WILDCARD");
});

test("a request-derived absolute Location is rejected", () => {
  const root = fixture();
  edit(
    root,
    "platform/backend/src/main/java/cn/xzkj/erp/order/api/OrderCenterController.java",
    (content) => content.replace(
      'URI.create("/api/v1/order-center/orders/" + response.id())',
      'URI.create("https://host.invalid/api/v1/order-center/orders/" + response.id())',
    ),
  );
  expectIssue(root, "ABSOLUTE_OR_UNSCOPED_LOCATION");
});

test("forwarded-header and edge canonicalization fact drift is rejected", () => {
  const root = fixture();
  edit(
    root,
    "platform/backend/src/main/resources/application.yml",
    (content) => content.replace(
      "forward-headers-strategy: framework",
      "forward-headers-strategy: native",
    ),
  );
  edit(
    root,
    "platform/frontend/nginx.conf",
    (content) => content.replace(
      "proxy_set_header Host $host;",
      "proxy_set_header Host $http_host;",
    ),
  );
  const result = inspectBrowserOriginTrustBoundary(root);
  assert.deepEqual(
    result.issues.map((value) => value.code),
    [
      "EDGE_HOST_FORWARDING_CHANGED",
      "FORWARDED_HEADER_FACT_CHANGED",
    ],
  );
});

test("a backend-source symbolic link is rejected", () => {
  const root = fixture();
  const outside = fs.mkdtempSync(
    path.join(os.tmpdir(), "xz-erp-browser-origin-outside-"),
  );
  temporaryRoots.push(outside);
  fs.symlinkSync(
    outside,
    path.join(root, "platform/backend/src/main/java/__external"),
    "junction",
  );
  expectIssue(root, "SOURCE_ALIAS_REJECTED");
});

test("the executable rejects all external path and origin input", () => {
  const result = spawnSync(
    process.execPath,
    [
      path.join(
        REPOSITORY_ROOT,
        "platform/scripts/browser-origin-trust-boundary-gate.mjs",
      ),
      "--origin",
      "https://untrusted.invalid",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /\[EXTERNAL_INPUT_REJECTED\]/);
  assert.match(result.stderr, /skipped=0/);
  assert.doesNotMatch(result.stderr, /untrusted\.invalid/);
});
