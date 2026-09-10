import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  inspectReports,
  inspectSources,
  main,
  parseArgs,
} from "./observability-boundary-gate-check.mjs";

const SAFE = {
  pom: [
    "<artifactId>spring-boot-starter-actuator</artifactId>",
    "<version>4.1.0</version>",
    "<testcontainers.version>1.21.4</testcontainers.version>",
  ].join("\n"),
  application: "spring:\n  web:\n    error:\n"
    + "      include-path: never\nmanagement:\n  endpoints:\n    web:\n"
    + "      exposure:\n        include: health,info",
  production: "management:\n  endpoint:\n    health:\n"
    + "      show-details: never\n      show-components: never\n"
    + "      group:\n        liveness:\n"
    + "          include: livenessState\n        readiness:\n"
    + "          include: readinessState,db\n"
    + "  endpoints:\n    web:\n      exposure:\n"
    + "        include: health,info",
  productionSafety:
    'Map.entry("spring.web.error.include-path", "never")',
  security: [
    ".requestMatchers(",
    '  "/actuator/health", "/actuator/health/**"',
    ").permitAll()",
    ".requestMatchers(",
    '  "/actuator", "/actuator/**"',
    ").denyAll()",
    '"/api/v1/platform-admin/tenant-session"',
    '"authentication_required"',
    '"permission_denied"',
  ].join("\n"),
  nginx: [
    "log_format api_access '\"path\":\"$uri\"';",
    "server {",
    " location = /healthz { access_log off; }",
    " location = /readyz { access_log off; }",
    " location ~* ^/readyz { access_log off; }",
    " location ~* ^/actuator(?:/|$) {",
    "   default_type text/plain;",
    '   return 404 "not found\\n";',
    " }",
    " location @readiness_unavailable { access_log off; }",
    " location ^~ /api/ {",
    "   location ~* ^/api/actuator(?:/|$) {",
    "     default_type text/plain;",
    '     return 404 "not found\\n";',
    "   }",
    "   proxy_pass http://backend:8080;",
    " }",
    " location / {}",
    "}",
  ].join("\n"),
  localCompose: [
    "services:",
    "  backend:",
    "    networks:",
    "      - data",
    "      - app",
    "  web:",
    "    ports:",
    '      - "127.0.0.1:18888:80"',
  ].join("\n"),
  stagingCompose: [
    "services:",
    "  backend:",
    "    networks:",
    "      - data",
    "      - app",
    "  web:",
    "    networks:",
    "      app:",
    "      public_ingress:",
    "volumes:",
  ].join("\n"),
  javaGate: [
    "class ObservabilityBoundaryPostgresql16GateTest",
    "postgres:16-alpine",
    "MeterRegistry",
    "REPEATED_FAILURES = 128",
    "assertUnknownBusinessPathsRedacted",
    "assertAuditSurfacesSafe",
    "spring.web.error.include-path",
    "OBSERVABILITY_BOUNDARY_GATE_EVIDENCE",
    "tests=1 failures=0 skipped=0",
  ].join("\n"),
  edgeGate: [
    "Docker is required",
    '"/actuator"',
    '"/ACTUATOR/ENV"',
    '"/actuator//metrics"',
    '"/%61ctuator/configprops"',
    '"/actuator/%2Fenv"',
    '"/api/actuator"',
    '"/api/ACTUATOR/ENV"',
    "actuator probe must retain normalized access-log path",
  ].join("\n"),
  logRuntime: [
    '"/actuator/env"',
    '"/api/actuator/prometheus"',
    'record.path === "/index.html"',
  ].join("\n"),
  contract: [
    "Edge responsibility",
    "Direct-backend responsibility",
    "not proof of production network isolation",
    "Liveness",
    "Readiness",
    "cardinality",
    "0 skipped",
  ].join("\n"),
  mainRuntime: "class RuntimeWithoutCustomTelemetry {}",
};

function find(results, rule) {
  return results.find((result) => result.rule === rule);
}

test("safe observability source facts pass", () => {
  const results = inspectSources(SAFE);
  assert.equal(
    results.every(({ status }) => status === "PASS"),
    true,
    JSON.stringify(results.filter(({ status }) => status === "FAIL")),
  );
});

test("exposure additions and authorization reordering fail closed", () => {
  const exposure = inspectSources({
    ...SAFE,
    production: SAFE.production.replace(
      "include: health,info",
      "include: health,info,env",
    ),
  });
  assert.equal(
    find(exposure, "actuator-exposure-allowlist").status,
    "FAIL",
  );

  const reordered = inspectSources({
    ...SAFE,
    security: SAFE.security.replace(
      '"/actuator/health", "/actuator/health/**"',
      '"/actuator", "/actuator/**"',
    ),
  });
  assert.equal(
    find(reordered, "spring-actuator-authorization-order").status,
    "FAIL",
  );
});

test("error path redaction requires the Boot 4.1 default and production override", () => {
  const missingDefault = inspectSources({
    ...SAFE,
    application: SAFE.application.replace(
      "      include-path: never\n",
      "",
    ),
  });
  assert.equal(
    find(
      missingDefault,
      "error-path-redaction-default-and-override",
    ).status,
    "FAIL",
  );

  const ineffectiveOverride = inspectSources({
    ...SAFE,
    productionSafety:
      'Map.entry("server.error.include-path", "never")',
  });
  assert.equal(
    find(
      ineffectiveOverride,
      "error-path-redaction-default-and-override",
    ).status,
    "FAIL",
  );
});

test("edge deny or access-log suppression fails closed", () => {
  const missing = inspectSources({
    ...SAFE,
    nginx: SAFE.nginx.replace(
      "location ~* ^/api/actuator(?:/|$)",
      "location ~* ^/api/management(?:/|$)",
    ),
  });
  assert.equal(find(missing, "edge-actuator-deny").status, "FAIL");

  const hidden = inspectSources({
    ...SAFE,
    nginx: SAFE.nginx.replace(
      "location ~* ^/actuator(?:/|$) {",
      "location ~* ^/actuator(?:/|$) { access_log off;",
    ),
  });
  assert.equal(find(hidden, "edge-actuator-deny").status, "FAIL");
});

test("backend network responsibility accepts list and mapping forms only", () => {
  assert.equal(
    find(inspectSources(SAFE), "backend-network-responsibility").status,
    "PASS",
  );

  const exposedBackend = inspectSources({
    ...SAFE,
    stagingCompose: SAFE.stagingCompose.replace(
      "      - app\n  web:",
      "      - app\n      - public_ingress\n  web:",
    ),
  });
  assert.equal(
    find(exposedBackend, "backend-network-responsibility").status,
    "FAIL",
  );

  const missingWebBoundary = inspectSources({
    ...SAFE,
    stagingCompose: SAFE.stagingCompose.replace(
      "      public_ingress:\n",
      "",
    ),
  });
  assert.equal(
    find(missingWebBoundary, "backend-network-responsibility").status,
    "FAIL",
  );
});

test("responsibility contract accepts wrapping but rejects isolation claims", () => {
  const wrapped = inspectSources({
    ...SAFE,
    contract: SAFE.contract.replace(
      "not proof of production network isolation",
      "not proof of\nproduction network isolation",
    ),
  });
  assert.equal(
    find(wrapped, "responsibility-boundary-contract").status,
    "PASS",
  );

  const overstated = inspectSources({
    ...SAFE,
    contract: SAFE.contract.replace(
      "not proof of production network isolation",
      "proof of production network isolation",
    ),
  });
  assert.equal(
    find(overstated, "responsibility-boundary-contract").status,
    "FAIL",
  );
});

test("custom Micrometer and high-cardinality tag code requires review", () => {
  const results = inspectSources({
    ...SAFE,
    mainRuntime:
      'MeterRegistry registry; registry.counter("x", "tenant.id", tenantId);',
  });
  assert.equal(find(results, "custom-telemetry-review").status, "FAIL");
});

test("runtime reports require PG16 evidence, tests, and zero skips", () => {
  const javaReport = `<testsuite
    name="cn.xzkj.erp.security.ObservabilityBoundaryPostgresql16GateTest"
    tests="1" failures="0" errors="0" skipped="0">
    OBSERVABILITY_BOUNDARY_GATE_EVIDENCE testcontainers=1.21.4
    image=postgres:16-alpine postgresql=16.14 spring=4.1.0 sessions=4
    unknown_path_cases=4 audit_matches=0
    repeated_failures=128 meter_growth_max=4
    tests=1 failures=0 skipped=0
  </testsuite>`;
  const edgeReport = `<testsuites>
    <testcase name="real repository edge preserves route and method"/>
    <!-- tests 1 -->
    <!-- suites 0 -->
    <!-- pass 1 -->
    <!-- fail 0 -->
    <!-- cancelled 0 -->
    <!-- skipped 0 -->
    <!-- todo 0 -->
  </testsuites>`;
  assert.equal(
    inspectReports({ javaReport, edgeReport })
      .every(({ status }) => status === "PASS"),
    true,
  );
  assert.equal(
    find(
      inspectReports({
        javaReport: javaReport.replace('skipped="0"', 'skipped="1"'),
        edgeReport,
      }),
      "pg16-runtime-result",
    ).status,
    "FAIL",
  );
  assert.equal(
    find(
      inspectReports({
        javaReport,
        edgeReport: edgeReport.replace(
          "<!-- skipped 0 -->",
          "<!-- skipped 1 -->",
        ),
      }),
      "real-edge-runtime-result",
    ).status,
    "FAIL",
  );
  assert.equal(
    find(
      inspectReports({
        javaReport,
        edgeReport: edgeReport.replace(
          "<!-- pass 1 -->",
          "<!-- pass 0 -->",
        ).replace(
          "<!-- fail 0 -->",
          "<!-- fail 1 -->",
        ),
      }),
      "real-edge-runtime-result",
    ).status,
    "FAIL",
  );
  assert.equal(
    find(
      inspectReports({
        javaReport,
        edgeReport: edgeReport.replace(
          "<!-- tests 1 -->",
          "<!-- tests 0 -->",
        ).replace(
          "<!-- pass 1 -->",
          "<!-- pass 0 -->",
        ),
      }),
      "real-edge-runtime-result",
    ).status,
    "FAIL",
  );
  assert.equal(
    find(
      inspectReports({ javaReport: "", edgeReport }),
      "pg16-runtime-evidence",
    ).status,
    "FAIL",
  );
});

test("arguments are rejected without rendering input", async () => {
  const canary = "jdbc:postgresql://outside.invalid/?password=canary";
  assert.doesNotThrow(() => parseArgs([]));
  assert.throws(() => parseArgs(["--root", canary]));
  const output = [];
  assert.equal(
    await main(["--root", canary], (line) => output.push(line)),
    2,
  );
  assert.deepEqual(output, ["[FAIL]\tchecker-arguments\t."]);
  assert.equal(output.join("").includes(canary), false);
});

test("the checker never reads process environment input", async () => {
  const source = await readFile(
    new URL("./observability-boundary-gate-check.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /process\.env|Bun\.env|Deno\.env/);
});
