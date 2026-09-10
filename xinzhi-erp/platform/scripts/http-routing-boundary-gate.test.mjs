import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  HttpRoutingBoundaryGateError,
  runHttpRoutingBoundaryGate,
} from "./http-routing-boundary-gate.mjs";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..", "..");
const temporaryRoots = [];

function fixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "xz-erp-http-routing-gate-"),
  );
  temporaryRoots.push(root);
  for (const relative of [
    "platform/frontend/nginx.conf",
    "platform/backend/pom.xml",
    "platform/backend/src/main/java",
    "platform/backend/src/main/resources",
    "platform/scripts/http-routing-boundary-gate.mjs",
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
  assert.notEqual(changed, original, `fixture edit must change ${relative}`);
  fs.writeFileSync(target, changed, "utf8");
}

function expectIssue(root, code) {
  assert.throws(
    () => runHttpRoutingBoundaryGate(root),
    (error) =>
      error instanceof HttpRoutingBoundaryGateError
      && error.issues.some((value) => value.code === code),
  );
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("repository routing facts pass deterministically with zero skips", () => {
  const first = runHttpRoutingBoundaryGate(REPOSITORY_ROOT);
  const second = runHttpRoutingBoundaryGate(REPOSITORY_ROOT);
  assert.deepEqual(first.summary, second.summary);
  assert.deepEqual(first.issues, []);
  assert.equal(first.summary.requiredFiles, 7);
  assert.equal(first.summary.proxyTargets, 2);
  assert.equal(first.summary.skipped, 0);
  assert.ok(first.summary.runtimeFiles > 0);
});

test("the signed Shopify storefront session proxy reaches the connector", () => {
  const nginx = fs.readFileSync(
    path.join(REPOSITORY_ROOT, "platform/frontend/nginx.conf"),
    "utf8",
  );
  assert.match(nginx, /\|proxy\/chat\/session\|/);
  assert.match(nginx, /set \$shopify_connector http:\/\/shopify-connector:8790;/);
});

test("the API prefix cannot lose static-regex precedence", () => {
  const root = fixture();
  edit(
    root,
    "platform/frontend/nginx.conf",
    (content) => content.replace("location ^~ /api/ {", "location /api/ {"),
  );
  expectIssue(root, "API_LOCATION_CHANGED");
});

test("the Shopify release route remains exact, bounded, and fixed", () => {
  const routeRoot = fixture();
  edit(
    routeRoot,
    "platform/frontend/nginx.conf",
    (content) => content.replace(
      "location = /api/v1/erp-operator/shopify-app-release/publish {",
      "location = /api/v1/erp-operator/shopify-app-release/release {",
    ),
  );
  expectIssue(routeRoot, "SHOPIFY_RELEASE_EDGE_ROUTE_CHANGED");

  const timeoutRoot = fixture();
  edit(
    timeoutRoot,
    "platform/frontend/nginx.conf",
    (content) => content.replace("proxy_read_timeout 11m;", "proxy_read_timeout 1h;"),
  );
  expectIssue(timeoutRoot, "SHOPIFY_RELEASE_EDGE_TIMEOUT_CHANGED");
});

test("edge and Spring actuator deny boundaries fail closed on drift", async (t) => {
  await t.test("root edge deny", () => {
    const root = fixture();
    edit(
      root,
      "platform/frontend/nginx.conf",
      (content) => content.replace(
        "location ~* ^/actuator(?:/|$) {",
        "location ~* ^/management(?:/|$) {",
      ),
    );
    expectIssue(root, "ACTUATOR_EDGE_DENY_CHANGED");
  });
  await t.test("API edge deny", () => {
    const root = fixture();
    edit(
      root,
      "platform/frontend/nginx.conf",
      (content) => content.replace(
        "location ~* ^/api/actuator(?:/|$) {",
        "location ~* ^/api/management(?:/|$) {",
      ),
    );
    expectIssue(root, "ACTUATOR_EDGE_DENY_CHANGED");
  });
  await t.test("Spring deny", () => {
    const root = fixture();
    edit(
      root,
      "platform/backend/src/main/java/cn/xzkj/erp/config/SecurityConfig.java",
      (content) => content.replace(
        '"/actuator",\n                                "/actuator/**"\n                        ).denyAll()',
        '"/actuator"\n                        ).permitAll()',
      ),
    );
    expectIssue(root, "ACTUATOR_DENY_MATCHER_CHANGED");
  });
});

test("a proxy_pass URI suffix or rewrite fails closed", async (t) => {
  for (const transform of [
    (content) => content.replace(
      "proxy_pass http://backend:8080;",
      "proxy_pass http://backend:8080/;",
    ),
    (content) => content.replace(
      "location ^~ /api/ {",
      "location ^~ /api/ {\n        rewrite ^/api/(.*)$ /$1 break;",
    ),
  ]) {
    await t.test("route drift", () => {
      const root = fixture();
      edit(root, "platform/frontend/nginx.conf", transform);
      expectIssue(root, "PROXY_ROUTE_REWRITE");
    });
  }
});

test("a new proxy target or disabled slash merging requires review", async (t) => {
  await t.test("proxy target", () => {
    const root = fixture();
    edit(
      root,
      "platform/frontend/nginx.conf",
      (content) => content.replace(
        "server {",
        "server {\n    location /api/internal { proxy_pass http://internal:8081; }",
      ),
    );
    expectIssue(root, "PROXY_TARGET_SET_CHANGED");
  });
  await t.test("merge slashes", () => {
    const root = fixture();
    edit(
      root,
      "platform/frontend/nginx.conf",
      (content) => content.replace(
        "server {",
        "server {\n    merge_slashes off;",
      ),
    );
    expectIssue(root, "EDGE_PATH_NORMALIZATION_CHANGED");
  });
});

test("Shopify connector edge allowlist and fixed target fail closed on drift", async (t) => {
  await t.test("path allowlist", () => {
    const root = fixture();
    edit(
      root,
      "platform/frontend/nginx.conf",
      (content) => content.replace(
        "|guide)|webhooks/shopify/",
        "|guide|unknown)|webhooks/shopify/",
      ),
    );
    expectIssue(root, "SHOPIFY_EDGE_ALLOWLIST_CHANGED");
  });
  await t.test("internal target", () => {
    const root = fixture();
    edit(
      root,
      "platform/frontend/nginx.conf",
      (content) => content.replace(
        "http://shopify-connector:8790",
        "http://external.invalid:8790",
      ),
    );
    expectIssue(root, "SHOPIFY_CONNECTOR_TARGET_CHANGED");
  });
});

test("method override and path-matcher customization fail closed", async (t) => {
  await t.test("method override", () => {
    const root = fixture();
    edit(
      root,
      "platform/backend/src/main/java/cn/xzkj/erp/config/SecurityConfig.java",
      (content) => content.replace(
        "public class SecurityConfig {",
        "public class SecurityConfig { HiddenHttpMethodFilter forbidden;",
      ),
    );
    expectIssue(root, "METHOD_OVERRIDE_ENABLED");
  });
  await t.test("path matcher", () => {
    const root = fixture();
    edit(
      root,
      "platform/backend/src/main/resources/application.yml",
      (content) => content + "\nspring.mvc.pathmatch.matching-strategy: legacy\n",
    );
    expectIssue(root, "PATH_MATCHING_CUSTOMIZED");
  });
});

test("parser logger redaction must exist in profile and safety override", async (t) => {
  await t.test("profile", () => {
    const root = fixture();
    edit(
      root,
      "platform/backend/src/main/resources/application-production.yml",
      (content) => content.replace(
        "org.apache.coyote.http11.Http11Processor: WARN",
        "org.apache.coyote.http11.Http11Processor: INFO",
      ),
    );
    expectIssue(root, "PARSER_LOG_REDACTION_CHANGED");
  });
  await t.test("safety override", () => {
    const root = fixture();
    edit(
      root,
      "platform/backend/src/main/java/cn/xzkj/erp/config/ProductionSafetyEnvironmentPostProcessor.java",
      (content) => content.replace(
        '"logging.level.org.apache.coyote.http11.Http11Processor",\n                    "WARN"',
        '"logging.level.org.apache.coyote.http11.Http11Processor",\n                    "DEBUG"',
      ),
    );
    expectIssue(root, "PARSER_LOG_OVERRIDE_CHANGED");
  });
});

test("an unsafe Nginx request or header log variable is rejected", () => {
  const root = fixture();
  edit(
    root,
    "platform/frontend/nginx.conf",
    (content) => content.replace(
      '"duration":$request_time}\'',
      '"duration":$request_time,"request":"$request"}\'',
    ),
  );
  expectIssue(root, "UNSAFE_EDGE_LOG_INPUT");
});

test("a runtime-source symbolic link is rejected", () => {
  const root = fixture();
  const outside = fs.mkdtempSync(
    path.join(os.tmpdir(), "xz-erp-http-routing-outside-"),
  );
  temporaryRoots.push(outside);
  fs.symlinkSync(
    outside,
    path.join(root, "platform/backend/src/main/java/__external"),
    "junction",
  );
  expectIssue(root, "SOURCE_ALIAS_REJECTED");
});

test("the executable rejects external inputs without echoing them", () => {
  const canary = "https://outside.invalid/path?password=credential-canary";
  const result = spawnSync(
    process.execPath,
    [
      path.join(
        REPOSITORY_ROOT,
        "platform/scripts/http-routing-boundary-gate.mjs",
      ),
      "--root",
      canary,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        ERP_DB_URL: "jdbc:postgresql://outside.invalid/secret",
      },
    },
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /\[EXTERNAL_INPUT_REJECTED\]/);
  assert.match(result.stderr, /skipped=0/);
  assert.doesNotMatch(
    `${result.stdout}\n${result.stderr}`,
    /outside\.invalid|credential-canary|jdbc:postgresql/,
  );
});
