import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  BackendEgressGateError,
  inspectBackendEgressBoundary,
  runBackendEgressBoundaryGate,
} from "./backend-egress-boundary-gate.mjs";

const execFileAsync = promisify(execFile);
const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..", "..");
const SCRIPT_RELATIVE =
  "platform/scripts/backend-egress-boundary-gate.mjs";
const TEST_RELATIVE =
  "platform/scripts/backend-egress-boundary-gate.test.mjs";
const DOCUMENT_RELATIVE =
  "platform/docs/backend-egress-boundary-gate.md";
const REVIEWED_TEST_NETWORK_FILES = [
  "platform/backend/src/test/java/cn/xzkj/erp/config/DatabaseResiliencePostgresql16GateTest.java",
  "platform/backend/src/test/java/cn/xzkj/erp/config/ProductionReadinessIntegrationTest.java",
  "platform/backend/src/test/java/cn/xzkj/erp/security/HttpRoutingTrustBoundaryIntegrationTest.java",
  "platform/backend/src/test/java/cn/xzkj/erp/security/ObservabilityBoundaryPostgresql16GateTest.java",
  "platform/backend/src/test/java/cn/xzkj/erp/platform/connector/XzErpAppChannelConnectorGatewayTest.java",
  "platform/backend/src/test/java/cn/xzkj/erp/logistics/authorization/ChudaLogisticsProviderConnectorTest.java",
  "platform/backend/src/test/java/cn/xzkj/erp/logistics/authorization/HualeiLogisticsProviderConnectorTest.java",
  "platform/backend/src/test/java/cn/xzkj/erp/logistics/authorization/ItdidaLogisticsProviderConnectorTest.java",
];
const temporaryRoots = [];

function copyPath(root, relative) {
  const source = path.join(REPOSITORY_ROOT, relative);
  const destination = path.join(root, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true });
}

function fixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "xz-erp-backend-egress-gate-"),
  );
  temporaryRoots.push(root);
  for (const relative of [
    "platform/backend/pom.xml",
    "platform/backend/src/main",
    SCRIPT_RELATIVE,
    TEST_RELATIVE,
    DOCUMENT_RELATIVE,
    ...REVIEWED_TEST_NETWORK_FILES,
  ]) {
    copyPath(root, relative);
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

function addJava(root, relative, content) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

function expectIssue(root, code) {
  assert.throws(
    () => runBackendEgressBoundaryGate(root),
    (error) =>
      error instanceof BackendEgressGateError
      && error.issues.some((value) => value.code === code),
  );
}

function injectedClient(urlExpression) {
  return [
    "package cn.xzkj.erp.security;",
    "import java.net.URI;",
    "import java.net.http.HttpClient;",
    "import java.net.http.HttpRequest;",
    "final class InjectedClient {",
    "  void send() throws Exception {",
    `    var request = HttpRequest.newBuilder(URI.create(${urlExpression})).build();`,
    "    HttpClient.newHttpClient().send(",
    "        request, java.net.http.HttpResponse.BodyHandlers.ofString());",
    "  }",
    "}",
  ].join("\n");
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("repository facts pass deterministically with four source-locked connector clients", () => {
  const first = runBackendEgressBoundaryGate(REPOSITORY_ROOT);
  const second = runBackendEgressBoundaryGate(REPOSITORY_ROOT);
  assert.deepEqual(first.summary, second.summary);
  assert.equal(first.summary.productionHttpClientFiles, 4);
  assert.equal(first.summary.outboundAllowlistEntries, 4);
  assert.equal(first.summary.skipped, 0);
  assert.ok(first.summary.productionJavaFiles > 0);
  assert.ok(first.summary.relativeLocationUris > 0);
  assert.ok(first.summary.gateTests > 0);
  assert.deepEqual(first.issues, []);
});

test("reviewed connector source, test, and persisted URL schema are hash locked", () => {
  const sourceRoot = fixture();
  edit(
    sourceRoot,
    "platform/backend/src/main/java/cn/xzkj/erp/platform/connector/XzErpAppChannelConnectorGateway.java",
    (content) => `${content}\n`,
  );
  expectIssue(sourceRoot, "REVIEWED_NETWORK_SOURCE_DRIFT");

  const testRoot = fixture();
  edit(
    testRoot,
    "platform/backend/src/test/java/cn/xzkj/erp/platform/connector/XzErpAppChannelConnectorGatewayTest.java",
    (content) => `${content}\n`,
  );
  expectIssue(testRoot, "REVIEWED_TEST_NETWORK_DRIFT");

  const resourceRoot = fixture();
  edit(
    resourceRoot,
    "platform/backend/src/main/resources/db/migration/V50__shopify_fulfillment_publications.sql",
    (content) => `${content}\n`,
  );
  expectIssue(resourceRoot, "REVIEWED_NETWORK_RESOURCE_DRIFT");
});

test("an additional production HTTP client hard-fails the reviewed allowlist", () => {
  const root = fixture();
  addJava(
    root,
    "platform/backend/src/main/java/cn/xzkj/erp/security/InjectedClient.java",
    injectedClient('"https://example.invalid/api"'),
  );
  const result = inspectBackendEgressBoundary(root);
  assert.ok(result.issues.some(
    (value) => value.code === "PRODUCTION_HTTP_CLIENT",
  ));
  assert.ok(result.issues.some(
    (value) => value.code === "OUTBOUND_ALLOWLIST_VIOLATION",
  ));
  assert.ok(result.issues.some(
    (value) => value.code === "OUTBOUND_ALLOWLIST_EMPTY",
  ));
});

const maliciousLocations = [
  ["file scheme", '"file:///etc/passwd"', "FORBIDDEN_URI_SCHEME"],
  ["jar scheme", '"jar:file:///tmp/app.jar!/secret"', "FORBIDDEN_URI_SCHEME"],
  ["gopher scheme", '"gopher://127.0.0.1/_x"', "FORBIDDEN_URI_SCHEME"],
  ["ftp scheme", '"ftp://127.0.0.1/private"', "FORBIDDEN_URI_SCHEME"],
  [
    "userinfo authority",
    '"http://public.invalid@127.0.0.1/private"',
    "NETWORK_LOCATION_USERINFO",
  ],
  [
    "fragment",
    '"https://public.invalid/path#private"',
    "NETWORK_LOCATION_FRAGMENT",
  ],
  [
    "backslash confusion",
    '"http:\\\\\\\\127.0.0.1\\\\private"',
    "NETWORK_LOCATION_OBFUSCATED",
  ],
  [
    "encoded authority confusion",
    '"http:%2f%2f127.0.0.1/private"',
    "NETWORK_LOCATION_OBFUSCATED",
  ],
  ["IPv4 loopback", '"http://127.0.0.1/private"', "NON_PUBLIC_NETWORK_TARGET"],
  ["IPv6 loopback", '"http://[::1]/private"', "NON_PUBLIC_NETWORK_TARGET"],
  ["private IPv4", '"http://10.1.2.3/private"', "NON_PUBLIC_NETWORK_TARGET"],
  ["private IPv6", '"http://[fc00::1]/private"', "NON_PUBLIC_NETWORK_TARGET"],
  ["unspecified host", '"http://0.0.0.0/private"', "NON_PUBLIC_NETWORK_TARGET"],
  ["localhost", '"http://localhost/private"', "LOCAL_NETWORK_TARGET"],
  [
    "Docker host",
    '"http://host.docker.internal/private"',
    "LOCAL_NETWORK_TARGET",
  ],
  [
    "AWS metadata",
    '"http://169.254.169.254/latest/meta-data/"',
    "CLOUD_METADATA_TARGET",
  ],
  [
    "Google metadata DNS",
    '"http://metadata.google.internal/computeMetadata/v1/"',
    "CLOUD_METADATA_TARGET",
  ],
  ["multicast", '"http://224.0.0.1/private"', "NON_PUBLIC_NETWORK_TARGET"],
  [
    "numeric host confusion",
    '"http://2130706433/private"',
    "NETWORK_LOCATION_OBFUSCATED",
  ],
];

for (const [name, location, expectedCode] of maliciousLocations) {
  test(`rejects ${name}`, () => {
    const root = fixture();
    addJava(
      root,
      "platform/backend/src/main/java/cn/xzkj/erp/security/InjectedClient.java",
      injectedClient(location),
    );
    expectIssue(root, expectedCode);
  });
}

test("a request-controlled URI surface is rejected", () => {
  const root = fixture();
  addJava(
    root,
    "platform/backend/src/main/java/cn/xzkj/erp/security/DynamicUri.java",
    [
      "package cn.xzkj.erp.security;",
      "import java.net.URI;",
      "final class DynamicUri {",
      "  URI fromRequest(String target) { return URI.create(target); }",
      "}",
    ].join("\n"),
  );
  expectIssue(root, "DYNAMIC_URI_SURFACE");
});

test("a dynamic request-header read is rejected", () => {
  const root = fixture();
  addJava(
    root,
    "platform/backend/src/main/java/cn/xzkj/erp/security/DynamicHeader.java",
    [
      "package cn.xzkj.erp.security;",
      "final class DynamicHeader {",
      "  String read(jakarta.servlet.http.HttpServletRequest request, String name) {",
      "    return request.getHeader(name);",
      "  }",
      "}",
    ].join("\n"),
  );
  expectIssue(root, "REQUEST_HEADER_TRUST_SURFACE");
});

test("a URL-like request or persisted field is rejected", () => {
  const root = fixture();
  addJava(
    root,
    "platform/backend/src/main/java/cn/xzkj/erp/security/WebhookRequest.java",
    [
      "package cn.xzkj.erp.security;",
      "record WebhookRequest(String callbackUrl) {}",
    ].join("\n"),
  );
  const migration =
    "platform/backend/src/main/resources/db/migration/V20__platform_shop_center.sql";
  edit(
    root,
    migration,
    (content) => content.replace(
      "external_shop_ref VARCHAR(160) NOT NULL,",
      "external_shop_ref VARCHAR(160) NOT NULL,\n    webhook_url VARCHAR(500),",
    ),
  );
  const result = inspectBackendEgressBoundary(root);
  assert.ok(result.issues.some(
    (value) => value.code === "DYNAMIC_NETWORK_FIELD",
  ));
  assert.ok(result.issues.some(
    (value) => value.code === "PERSISTED_NETWORK_LOCATION",
  ));
});

test("an outbound URL configuration property is rejected", () => {
  const root = fixture();
  edit(
    root,
    "platform/backend/src/main/resources/application.yml",
    (content) =>
      `${content}\npartner:\n  endpoint: \${PARTNER_ENDPOINT}\n  base-url: \${PARTNER_BASE_URL}\n`,
  );
  expectIssue(root, "DYNAMIC_NETWORK_CONFIGURATION");
});

test("DNS, socket, process, redirect, proxy, and Forwarded surfaces fail", () => {
  const root = fixture();
  addJava(
    root,
    "platform/backend/src/main/java/cn/xzkj/erp/security/UnsafeSurfaces.java",
    [
      "package cn.xzkj.erp.security;",
      "import java.net.InetAddress;",
      "import java.net.http.HttpClient;",
      "final class UnsafeSurfaces {",
      "  void run(jakarta.servlet.http.HttpServletRequest request) throws Exception {",
      '    request.getHeader("Forwarded");',
      '    System.getenv("HTTP_PROXY");',
      '    InetAddress.getByName("example.invalid");',
      '    new ProcessBuilder("curl", "https://example.invalid").start();',
      "    HttpClient.newBuilder().followRedirects(HttpClient.Redirect.ALWAYS);",
      "  }",
      "}",
    ].join("\n"),
  );
  const codes = inspectBackendEgressBoundary(root).issues.map(
    (value) => value.code,
  );
  for (const code of [
    "FORWARDED_AUTHORITY_TRUST",
    "HTTP_REDIRECT_SURFACE",
    "PRODUCTION_DNS_OR_SOCKET",
    "PRODUCTION_PROCESS_EXECUTION",
    "PROXY_TRUST_SURFACE",
    "REQUEST_HEADER_TRUST_SURFACE",
  ]) {
    assert.ok(codes.includes(code), `${code} was not reported`);
  }
});

test("any backend dependency-set change requires review", () => {
  const root = fixture();
  edit(
    root,
    "platform/backend/pom.xml",
    (content) => content.replace(
      "    </dependencies>",
      [
        "        <dependency>",
        "            <groupId>com.squareup.okhttp3</groupId>",
        "            <artifactId>okhttp</artifactId>",
        "        </dependency>",
        "    </dependencies>",
      ].join("\n"),
    ),
  );
  expectIssue(root, "DEPENDENCY_SET_CHANGED");
});

test("an unreviewed test client or non-loopback target is rejected", () => {
  const root = fixture();
  addJava(
    root,
    "platform/backend/src/test/java/cn/xzkj/erp/security/InternetTest.java",
    injectedClient('"https://example.invalid/api"'),
  );
  edit(
    root,
    REVIEWED_TEST_NETWORK_FILES[1],
    (content) => content.replace("127.0.0.1", "example.invalid"),
  );
  const codes = inspectBackendEgressBoundary(root).issues.map(
    (value) => value.code,
  );
  assert.ok(codes.includes("TEST_NETWORK_SURFACE_UNREVIEWED"));
  assert.ok(codes.includes("TEST_NETWORK_NOT_LOOPBACK"));
});

test("a reviewed test file cannot hide a non-loopback HTTP target", () => {
  const root = fixture();
  edit(
    root,
    REVIEWED_TEST_NETWORK_FILES[1],
    (content) => content
      .replace("http://127.0.0.1:", "http://example.invalid:")
      .replace(
        "class ProductionReadinessIntegrationTest {",
        'class ProductionReadinessIntegrationTest { String decoy = "127.0.0.1";',
      ),
  );
  expectIssue(root, "TEST_NETWORK_NOT_LOOPBACK");
});

test("test redirect enablement is rejected", () => {
  const root = fixture();
  edit(
    root,
    REVIEWED_TEST_NETWORK_FILES[2],
    (content) => content.replace(
      "HttpClient.Redirect.NEVER",
      "HttpClient.Redirect.ALWAYS",
    ),
  );
  expectIssue(root, "TEST_REDIRECTS_ENABLED");
});

test("missing required files and zero or skipped gate tests hard-fail", () => {
  const missingRoot = fixture();
  fs.rmSync(path.join(missingRoot, REVIEWED_TEST_NETWORK_FILES[0]));
  expectIssue(missingRoot, "REQUIRED_FILE_MISSING");

  const zeroRoot = fixture();
  edit(
    zeroRoot,
    TEST_RELATIVE,
    (content) => content.replaceAll("test(", "caseTest("),
  );
  expectIssue(zeroRoot, "ZERO_GATE_TESTS");

  const skippedRoot = fixture();
  edit(
    skippedRoot,
    TEST_RELATIVE,
    (content) => `${content}\ntest.skip("forbidden skip", () => {});\n`,
  );
  expectIssue(skippedRoot, "SKIPPED_GATE_TEST");
});

test("backend source aliases are rejected", () => {
  const root = fixture();
  const outside = fs.mkdtempSync(
    path.join(os.tmpdir(), "xz-erp-backend-egress-outside-"),
  );
  temporaryRoots.push(outside);
  fs.symlinkSync(
    outside,
    path.join(root, "platform/backend/src/main/java/__external"),
    "junction",
  );
  expectIssue(root, "SOURCE_ALIAS_REJECTED");
});

test("the executable rejects external input without reflecting secrets", () => {
  const secret = "credential-canary-do-not-print";
  const result = spawnSync(
    process.execPath,
    [
      path.join(REPOSITORY_ROOT, SCRIPT_RELATIVE),
      "--url",
      `http://127.0.0.1/${secret}`,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /\[EXTERNAL_INPUT_REJECTED\]/);
  assert.match(result.stderr, /skipped=0/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(secret));
});

test("proxy and target environment variables cause no loopback access", async () => {
  let requests = 0;
  const server = http.createServer((_request, response) => {
    requests += 1;
    response.writeHead(500);
    response.end("unexpected");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const localTarget = `http://127.0.0.1:${address.port}`;
  try {
    const result = await execFileAsync(
      process.execPath,
      [path.join(REPOSITORY_ROOT, SCRIPT_RELATIVE)],
      {
        cwd: os.tmpdir(),
        encoding: "utf8",
        env: {
          ...process.env,
          HTTP_PROXY: localTarget,
          HTTPS_PROXY: localTarget,
          ALL_PROXY: localTarget,
          NO_PROXY: "",
          ERP_OUTBOUND_URL: `${localTarget}/metadata`,
          ERP_OUTBOUND_CREDENTIAL: "credential-canary-do-not-print",
        },
      },
    );
    assert.match(result.stdout, /PASS backend egress boundary gate/);
    assert.doesNotMatch(
      `${result.stdout}${result.stderr}`,
      /credential-canary-do-not-print/,
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(requests, 0);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("the checker source never reads process environment or dotenv files", () => {
  const source = fs.readFileSync(
    path.join(REPOSITORY_ROOT, SCRIPT_RELATIVE),
    "utf8",
  );
  assert.doesNotMatch(source, /\bprocess\.env\b/);
  assert.doesNotMatch(source, /\bdotenv\b|\.env(?:["'`]|\s)/i);
});
