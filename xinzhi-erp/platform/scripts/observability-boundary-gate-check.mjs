import {
  lstat,
  readFile,
  realpath,
  readdir,
} from "node:fs/promises";
import {
  dirname,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SCRIPT), "../..");
const JAVA_REPORT = "platform/backend/target/surefire-reports/"
  + "TEST-cn.xzkj.erp.security."
  + "ObservabilityBoundaryPostgresql16GateTest.xml";
const EDGE_REPORT = "platform/backend/target/"
  + "observability-edge-runtime.junit.xml";

const FIXED_SOURCES = Object.freeze({
  pom: "platform/backend/pom.xml",
  application: "platform/backend/src/main/resources/application.yml",
  production:
    "platform/backend/src/main/resources/application-production.yml",
  productionSafety:
    "platform/backend/src/main/java/cn/xzkj/erp/config/"
    + "ProductionSafetyEnvironmentPostProcessor.java",
  security:
    "platform/backend/src/main/java/cn/xzkj/erp/config/SecurityConfig.java",
  nginx: "platform/frontend/nginx.conf",
  localCompose: "platform/compose.yaml",
  stagingCompose: "platform/infra/staging/compose.staging.yaml",
  javaGate:
    "platform/backend/src/test/java/cn/xzkj/erp/security/"
    + "ObservabilityBoundaryPostgresql16GateTest.java",
  edgeGate: "platform/scripts/http-routing-edge-runtime.test.mjs",
  logRuntime: "platform/scripts/nginx-api-access-log-runtime.test.mjs",
  contract: "platform/backend/docs/observability-boundary-gate.md",
});

const FIXED_REPORTS = Object.freeze({
  javaReport: JAVA_REPORT,
  edgeReport: EDGE_REPORT,
});

const DANGEROUS_ENDPOINTS = [
  "metrics",
  "prometheus",
  "env",
  "configprops",
  "beans",
  "loggers",
  "heapdump",
  "threaddump",
  "mappings",
];

function check(rule, passed, location) {
  return {
    rule,
    status: passed ? "PASS" : "FAIL",
    location,
  };
}

function includesAll(content, values) {
  return values.every((value) => content.includes(value));
}

function includesAllNormalized(content, values) {
  const normalized = content.replace(/\s+/g, " ");
  return values.every((value) =>
    normalized.includes(value.replace(/\s+/g, " ")));
}

function blockStartingAt(content, marker) {
  const start = content.indexOf(marker);
  if (start < 0) return "";
  const open = content.indexOf("{", start + marker.length);
  if (open < 0) return "";
  let depth = 0;
  for (let index = open; index < content.length; index += 1) {
    if (content[index] === "{") depth += 1;
    if (content[index] === "}") {
      depth -= 1;
      if (depth === 0) return content.slice(start, index + 1);
    }
  }
  return "";
}

function exactExposure(content) {
  const values = [...content.matchAll(
    /^\s*exposure\s*:\s*\r?\n\s*include\s*:\s*([^#\r\n]+?)\s*$/gm,
  )].map((match) => match[1].trim());
  return values.length === 1 && values[0] === "health,info";
}

function serviceBlock(compose, name) {
  const match = new RegExp(
    `^  ${name}:\\r?\\n([\\s\\S]*?)(?=^  [a-zA-Z0-9_-]+:\\r?$|^volumes:|^networks:|(?![\\s\\S]))`,
    "m",
  ).exec(compose);
  return match?.[0] ?? "";
}

function serviceNetworks(service) {
  const block = /^    networks:\s*\r?\n((?:^      .*(?:\r?\n|$))*)/m
    .exec(service)?.[1] ?? "";
  return new Set(
    [...block.matchAll(
      /^      (?:-\s+)?([a-zA-Z0-9_-]+)(?::)?\s*$/gm,
    )].map((match) => match[1]),
  );
}

function exactNames(actual, expected) {
  return actual.size === expected.length
    && expected.every((name) => actual.has(name));
}

export function inspectSources(sources) {
  const api = blockStartingAt(
    sources.nginx,
    "location ^~ /api/",
  );
  const edgeActuator = blockStartingAt(
    sources.nginx,
    "location ~* ^/actuator(?:/|$)",
  );
  const edgeApiActuator = blockStartingAt(
    api,
    "location ~* ^/api/actuator(?:/|$)",
  );
  const healthMatcher = sources.security.indexOf(
    "\"/actuator/health\"",
  );
  const denyMatcher = sources.security.indexOf(
    "\"/actuator\"",
    healthMatcher + 1,
  );
  const businessMatcher = sources.security.indexOf(
    "\"/api/v1/platform-admin/tenant-session\"",
  );
  const logFormats = [...sources.nginx.matchAll(
    /\blog_format\s+[A-Za-z0-9_]+\s+([\s\S]*?);/g,
  )].map((match) => match[1]).join("\n");
  const localBackend = serviceBlock(sources.localCompose, "backend");
  const stagingBackend = serviceBlock(
    sources.stagingCompose,
    "backend",
  );
  const stagingWeb = serviceBlock(sources.stagingCompose, "web");
  const localBackendNetworks = serviceNetworks(localBackend);
  const stagingBackendNetworks = serviceNetworks(stagingBackend);
  const stagingWebNetworks = serviceNetworks(stagingWeb);
  const exposureSurface = `${sources.application}\n${sources.production}`;

  return [
    check(
      "dependency-baseline",
      includesAll(sources.pom, [
        "<artifactId>spring-boot-starter-actuator</artifactId>",
        "<version>4.1.0</version>",
        "<testcontainers.version>1.21.4</testcontainers.version>",
      ]),
      FIXED_SOURCES.pom,
    ),
    check(
      "actuator-exposure-allowlist",
      exactExposure(sources.application)
        && exactExposure(sources.production)
        && !new RegExp(
          `include\\s*:\\s*[^\\r\\n]*(?:\\*|${DANGEROUS_ENDPOINTS.join("|")})`,
          "i",
        ).test(exposureSurface),
      FIXED_SOURCES.production,
    ),
    check(
      "health-detail-redaction",
      includesAll(sources.production, [
        "show-details: never",
        "show-components: never",
        "include: livenessState",
        "include: readinessState,db",
      ]),
      FIXED_SOURCES.production,
    ),
    check(
      "error-path-redaction-default-and-override",
      /^  web:\r?\n    error:\r?\n      include-path:\s*never\s*$/m
        .test(sources.application)
        && sources.productionSafety.includes(
          '"spring.web.error.include-path", "never"',
        )
        && !sources.application.includes("server.error.include-path")
        && !sources.productionSafety.includes(
          "server.error.include-path",
        ),
      FIXED_SOURCES.application,
    ),
    check(
      "spring-actuator-authorization-order",
      includesAll(sources.security, [
        "\"/actuator/health\"",
        "\"/actuator/health/**\"",
        "\"/actuator\"",
        "\"/actuator/**\"",
        ").denyAll()",
        "\"authentication_required\"",
        "\"permission_denied\"",
      ])
        && healthMatcher >= 0
        && denyMatcher > healthMatcher
        && businessMatcher > denyMatcher,
      FIXED_SOURCES.security,
    ),
    check(
      "edge-actuator-deny",
      edgeActuator !== ""
        && edgeApiActuator !== ""
        && [edgeActuator, edgeApiActuator].every((block) =>
          /\bdefault_type\s+text\/plain\s*;/.test(block)
          && /return\s+404\s+"not found\\n"\s*;/.test(block)
          && !/\baccess_log\s+off\s*;/.test(block)),
      FIXED_SOURCES.nginx,
    ),
    check(
      "edge-log-redaction",
      /"path":"\$uri"/.test(sources.nginx)
        && !/\$request\b|\$args\b|\$query_string\b|\$http_|\$request_body\b/
          .test(logFormats)
        && [
          "location = /healthz",
          "location = /readyz",
          "location ~* ^/readyz",
          "location @readiness_unavailable",
        ].every((marker) =>
          /\baccess_log\s+off\s*;/.test(
            blockStartingAt(sources.nginx, marker),
          )),
      FIXED_SOURCES.nginx,
    ),
    check(
      "backend-network-responsibility",
      localBackend !== ""
        && stagingBackend !== ""
        && stagingWeb !== ""
        && !/^\s+ports\s*:/m.test(localBackend)
        && !/^\s+ports\s*:/m.test(stagingBackend)
        && exactNames(localBackendNetworks, ["app", "data"])
        && exactNames(stagingBackendNetworks, ["app", "data"])
        && exactNames(stagingWebNetworks, ["app", "public_ingress"]),
      FIXED_SOURCES.stagingCompose,
    ),
    check(
      "custom-telemetry-review",
      !/(?:io\.micrometer|MeterRegistry|ObservationRegistry|MeterBinder|Counter\.builder|Timer\.builder|DistributionSummary\.builder|Gauge\.builder|lowCardinalityKeyValue|highCardinalityKeyValue)/.test(
        sources.mainRuntime,
      ),
      "platform/backend/src/main",
    ),
    check(
      "pg16-observability-gate-source",
      includesAll(sources.javaGate, [
        "ObservabilityBoundaryPostgresql16GateTest",
        "postgres:16-alpine",
        "MeterRegistry",
        "REPEATED_FAILURES = 128",
        "assertUnknownBusinessPathsRedacted",
        "assertAuditSurfacesSafe",
        "spring.web.error.include-path",
        "OBSERVABILITY_BOUNDARY_GATE_EVIDENCE",
        "tests=1 failures=0 skipped=0",
      ])
        && !sources.javaGate.includes("Assumptions."),
      FIXED_SOURCES.javaGate,
    ),
    check(
      "real-edge-gate-source",
      includesAll(sources.edgeGate, [
        "\"/actuator\"",
        "\"/ACTUATOR/ENV\"",
        "\"/actuator//metrics\"",
        "\"/%61ctuator/configprops\"",
        "\"/actuator/%2Fenv\"",
        "\"/api/actuator\"",
        "\"/api/ACTUATOR/ENV\"",
        "actuator probe must retain normalized access-log path",
        "Docker is required",
      ]),
      FIXED_SOURCES.edgeGate,
    ),
    check(
      "existing-access-log-runtime-source",
      includesAll(sources.logRuntime, [
        "\"/actuator/env\"",
        "\"/api/actuator/prometheus\"",
        "record.path === \"/index.html\"",
      ]),
      FIXED_SOURCES.logRuntime,
    ),
    check(
      "responsibility-boundary-contract",
      includesAllNormalized(sources.contract, [
        "Edge responsibility",
        "Direct-backend responsibility",
        "not proof of production network isolation",
        "Liveness",
        "Readiness",
        "cardinality",
        "0 skipped",
      ]),
      FIXED_SOURCES.contract,
    ),
  ];
}

function attribute(xml, name) {
  return new RegExp(`\\b${name}="([0-9]+)"`).exec(xml)?.[1];
}

function commentCount(xml, name) {
  return new RegExp(`<!--\\s*${name}\\s+([0-9]+)\\s*-->`)
    .exec(xml)?.[1];
}

function zeroFailureSuite(xml, expectedName) {
  if (!xml.includes(expectedName)) return false;
  const tests = attribute(xml, "tests");
  if (tests !== undefined) {
    return Number(tests) > 0
      && attribute(xml, "failures") === "0"
      && attribute(xml, "errors") === "0"
      && attribute(xml, "skipped") === "0";
  }
  const nodeTests = commentCount(xml, "tests");
  return Number(nodeTests ?? "0") > 0
    && commentCount(xml, "pass") === nodeTests
    && commentCount(xml, "fail") === "0"
    && commentCount(xml, "cancelled") === "0"
    && commentCount(xml, "skipped") === "0"
    && commentCount(xml, "todo") === "0";
}

export function inspectReports(reports) {
  const javaResult = zeroFailureSuite(
    reports.javaReport,
    "cn.xzkj.erp.security.ObservabilityBoundaryPostgresql16GateTest",
  );
  const javaEvidence = includesAll(reports.javaReport, [
    "OBSERVABILITY_BOUNDARY_GATE_EVIDENCE",
    "testcontainers=1.21.4",
    "image=postgres:16-alpine",
    "postgresql=16.",
    "spring=4.1.0",
    "sessions=4",
    "unknown_path_cases=4",
    "audit_matches=0",
    "repeated_failures=128",
    "meter_growth_max=4",
    "tests=1 failures=0 skipped=0",
  ]);
  const edgeResult = zeroFailureSuite(
    reports.edgeReport,
    "real repository edge preserves route and method",
  );
  return [
    check("pg16-runtime-result", javaResult, JAVA_REPORT),
    check("pg16-runtime-evidence", javaEvidence, JAVA_REPORT),
    check("real-edge-runtime-result", edgeResult, EDGE_REPORT),
  ];
}

export function parseArgs(argv) {
  if (argv.length !== 0) {
    throw new Error("arguments are not accepted");
  }
}

async function safeFile(root, repositoryPath, optional = false) {
  if (
    repositoryPath.includes("..")
    || repositoryPath.includes("://")
    || repositoryPath.startsWith("/")
    || /^[A-Za-z]:/.test(repositoryPath)
  ) {
    throw new Error("unsafe fixed path");
  }
  const target = resolve(root, ...repositoryPath.split("/"));
  const targetRelative = relative(root, target);
  if (targetRelative === ".." || targetRelative.startsWith(`..${sep}`)) {
    throw new Error("path escaped repository");
  }
  let stat;
  try {
    stat = await lstat(target);
  } catch (error) {
    if (optional && error?.code === "ENOENT") {
      return { content: "", mtimeMs: 0 };
    }
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("fixed path is not a regular file");
  }
  const canonical = await realpath(target);
  const canonicalRelative = relative(await realpath(root), canonical);
  if (
    canonicalRelative === ".."
    || canonicalRelative.startsWith(`..${sep}`)
  ) {
    throw new Error("canonical path escaped repository");
  }
  return {
    content: await readFile(target, "utf8"),
    mtimeMs: stat.mtimeMs,
  };
}

async function readMainRuntime(root) {
  const base = resolve(root, "platform/backend/src/main");
  const collected = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) {
        throw new Error("runtime source contains symlink");
      }
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (
        entry.isFile()
        && /\.(?:java|ya?ml|properties)$/.test(entry.name)
      ) {
        const repositoryPath = relative(root, path).split(sep).join("/");
        collected.push((await safeFile(root, repositoryPath)).content);
      }
    }
  }
  await walk(base);
  return collected.join("\n");
}

export async function runChecks(root = ROOT) {
  const canonicalRoot = await realpath(root);
  if (canonicalRoot !== await realpath(ROOT)) {
    throw new Error("external root rejected");
  }
  const sources = {};
  const sourceTimes = [];
  for (const [name, path] of Object.entries(FIXED_SOURCES)) {
    const file = await safeFile(canonicalRoot, path);
    sources[name] = file.content;
    sourceTimes.push(file.mtimeMs);
  }
  sources.mainRuntime = await readMainRuntime(canonicalRoot);

  const reports = {};
  const reportTimes = [];
  for (const [name, path] of Object.entries(FIXED_REPORTS)) {
    const file = await safeFile(canonicalRoot, path, true);
    reports[name] = file.content;
    reportTimes.push(file.mtimeMs);
  }
  const freshness = reportTimes.every(
    (time) => time >= Math.max(...sourceTimes),
  );
  return [
    ...inspectSources(sources),
    ...inspectReports(reports),
    check(
      "runtime-evidence-freshness",
      freshness,
      "platform/backend/target",
    ),
  ];
}

export function formatResult(result) {
  return `[${result.status}]\t${result.rule}\t${result.location}`;
}

export async function main(argv, logger = console.log) {
  try {
    parseArgs(argv);
  } catch {
    logger("[FAIL]\tchecker-arguments\t.");
    return 2;
  }
  try {
    const results = await runChecks();
    results.forEach((result) => logger(formatResult(result)));
    return results.some(({ status }) => status === "FAIL") ? 1 : 0;
  } catch {
    logger("[FAIL]\tchecker-internal\t.");
    return 2;
  }
}

const invoked = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (import.meta.url === invoked) {
  process.exitCode = await main(process.argv.slice(2));
}
