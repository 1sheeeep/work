import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIRECTORY = path.dirname(SCRIPT_PATH);
const LOCKED_REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..", "..");
const REQUIRED_FILES = [
  "platform/frontend/nginx.conf",
  "platform/backend/pom.xml",
  "platform/backend/src/main/java/cn/xzkj/erp/config/SecurityConfig.java",
  "platform/backend/src/main/java/cn/xzkj/erp/config/ProductionSafetyEnvironmentPostProcessor.java",
  "platform/backend/src/main/resources/application.yml",
  "platform/backend/src/main/resources/application-production.yml",
  "platform/scripts/http-routing-boundary-gate.mjs",
];
const PARSER_LOGGER =
  "logging.level.org.apache.coyote.http11.Http11Processor";

export class HttpRoutingBoundaryGateError extends Error {
  constructor(issues) {
    super(issues.map((value) => `[${value.code}] ${value.message}`).join("\n"));
    this.name = "HttpRoutingBoundaryGateError";
    this.issues = issues;
  }
}

function issue(code, message) {
  return { code, message };
}

function slash(value) {
  return value.split(path.sep).join("/");
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === ""
    || (!relative.startsWith(`..${path.sep}`)
      && relative !== ".."
      && !path.isAbsolute(relative))
  );
}

function validateRoot(repositoryRoot) {
  const resolved = path.resolve(repositoryRoot);
  if (!fs.existsSync(resolved)) {
    throw new HttpRoutingBoundaryGateError([
      issue("REPOSITORY_ROOT_MISSING", "repository root does not exist"),
    ]);
  }
  const metadata = fs.lstatSync(resolved);
  const real = fs.realpathSync.native(resolved);
  if (
    !metadata.isDirectory()
    || metadata.isSymbolicLink()
    || real !== resolved
  ) {
    throw new HttpRoutingBoundaryGateError([
      issue(
        "REPOSITORY_ROOT_ALIAS",
        "repository root must be its canonical non-symbolic absolute path",
      ),
    ]);
  }
  return real;
}

function readLocked(root, relative) {
  const absolute = path.resolve(root, relative);
  if (!isWithin(root, absolute) || !fs.existsSync(absolute)) {
    throw new HttpRoutingBoundaryGateError([
      issue("REQUIRED_FILE_MISSING", `required file is missing: ${relative}`),
    ]);
  }
  const metadata = fs.lstatSync(absolute);
  const real = fs.realpathSync.native(absolute);
  if (
    !metadata.isFile()
    || metadata.isSymbolicLink()
    || real !== absolute
    || !isWithin(root, real)
  ) {
    throw new HttpRoutingBoundaryGateError([
      issue(
        "SOURCE_ALIAS_REJECTED",
        `required source must be a canonical regular file: ${relative}`,
      ),
    ]);
  }
  return fs.readFileSync(absolute, "utf8");
}

function walkRuntimeSources(root) {
  const starts = [
    "platform/backend/src/main/java",
    "platform/backend/src/main/resources",
  ];
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, "en"))) {
      const absolute = path.join(directory, entry.name);
      const relative = slash(path.relative(root, absolute));
      const metadata = fs.lstatSync(absolute);
      if (metadata.isSymbolicLink()) {
        throw new HttpRoutingBoundaryGateError([
          issue(
            "SOURCE_ALIAS_REJECTED",
            `runtime source contains a symbolic link: ${relative}`,
          ),
        ]);
      }
      if (metadata.isDirectory()) {
        visit(absolute);
      } else if (metadata.isFile()) {
        files.push({
          relative,
          content: fs.readFileSync(absolute, "utf8"),
        });
      }
    }
  };
  for (const relative of starts) {
    visit(path.resolve(root, relative));
  }
  return files;
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

function requirePattern(content, pattern, code, message, issues) {
  if (!pattern.test(content)) {
    issues.push(issue(code, message));
  }
}

function rejectPattern(content, pattern, code, message, issues) {
  if (pattern.test(content)) {
    issues.push(issue(code, message));
  }
}

function inspectNginx(nginx, issues) {
  const api = blockStartingAt(nginx, "location ^~ /api/");
  const shopifyRelease = blockStartingAt(
    nginx,
    "location = /api/v1/erp-operator/shopify-app-release/publish",
  );
  const shopify = blockStartingAt(
    nginx,
    "location ~ ^/(?:shopify/",
  );
  const actuator = blockStartingAt(
    nginx,
    "location ~* ^/actuator(?:/|$)",
  );
  const apiActuator = blockStartingAt(
    api,
    "location ~* ^/api/actuator(?:/|$)",
  );
  requirePattern(
    nginx,
    /^\s*location\s+\^~\s+\/api\/\s*\{/m,
    "API_LOCATION_CHANGED",
    "the ^~ /api/ prefix location must remain present",
    issues,
  );
  requirePattern(
    api,
    /\bproxy_pass\s+http:\/\/backend:8080\s*;/,
    "PROXY_PASS_URI_CHANGED",
    "the /api/ proxy_pass must retain no URI component",
    issues,
  );
  rejectPattern(
    api,
    /\bproxy_pass\s+http:\/\/backend:8080\/|\brewrite\b|\bproxy_method\b/,
    "PROXY_ROUTE_REWRITE",
    "the API proxy must not add a URI suffix, rewrite, or method override",
    issues,
  );
  requirePattern(
    shopifyRelease,
    /^\s*location\s+=\s+\/api\/v1\/erp-operator\/shopify-app-release\/publish\s*\{/m,
    "SHOPIFY_RELEASE_EDGE_ROUTE_CHANGED",
    "the Shopify release route must remain an exact delegated ERP operator path",
    issues,
  );
  requirePattern(
    shopifyRelease,
    /\bproxy_pass\s+http:\/\/backend:8080\s*;/,
    "SHOPIFY_RELEASE_EDGE_TARGET_CHANGED",
    "the Shopify release route must retain the fixed ERP backend target",
    issues,
  );
  requirePattern(
    shopifyRelease,
    /\bproxy_connect_timeout\s+5s\s*;[\s\S]*?\bproxy_send_timeout\s+11m\s*;[\s\S]*?\bproxy_read_timeout\s+11m\s*;/,
    "SHOPIFY_RELEASE_EDGE_TIMEOUT_CHANGED",
    "the Shopify release route must retain bounded long-operation timeouts",
    issues,
  );
  rejectPattern(
    shopifyRelease,
    /\brewrite\b|\bproxy_method\b|\bproxy_pass\s+http:\/\/backend:8080\//,
    "SHOPIFY_RELEASE_EDGE_REWRITE",
    "the Shopify release route must not rewrite URI or method",
    issues,
  );
  requirePattern(
    shopify,
    /^\s*location\s+~\s+\^\/\(\?:shopify\/\(\?:oauth\/\(\?:authorize\|callback\)\|app\|session\/\(\?:exchange\|products\|orders\)\|proxy\/chat\/session\|privacy\|terms\|data-processing-terms\|support\|data-deletion\|guide\)\|webhooks\/shopify\/\(\?:app\/uninstalled\|compliance\)\)\$\s*\{/m,
    "SHOPIFY_EDGE_ALLOWLIST_CHANGED",
    "the Shopify connector route must retain its exact public path allowlist",
    issues,
  );
  requirePattern(
    shopify,
    /\bresolver\s+127\.0\.0\.11\s+valid=30s\s+ipv6=off\s*;/,
    "SHOPIFY_CONNECTOR_RESOLVER_CHANGED",
    "the Shopify connector must use bounded Docker DNS resolution",
    issues,
  );
  requirePattern(
    shopify,
    /\bset\s+\$shopify_connector\s+http:\/\/shopify-connector:8790\s*;/,
    "SHOPIFY_CONNECTOR_TARGET_CHANGED",
    "the Shopify connector target must remain the internal fixed service",
    issues,
  );
  requirePattern(
    shopify,
    /\bproxy_pass\s+\$shopify_connector\s*;/,
    "SHOPIFY_CONNECTOR_PROXY_CHANGED",
    "the Shopify connector route must preserve the original request URI",
    issues,
  );
  rejectPattern(
    shopify,
    /\brewrite\b|\bproxy_method\b|\bproxy_pass\s+\$shopify_connector\//,
    "SHOPIFY_CONNECTOR_ROUTE_REWRITE",
    "the Shopify connector route must not rewrite URI or method",
    issues,
  );
  rejectPattern(
    nginx,
    /\bmerge_slashes\s+off\s*;/,
    "EDGE_PATH_NORMALIZATION_CHANGED",
    "Nginx slash merging must not be disabled without review",
    issues,
  );
  for (const [name, block] of [
    ["root actuator", actuator],
    ["API actuator", apiActuator],
  ]) {
    requirePattern(
      block,
      /\bdefault_type\s+text\/plain\s*;/,
      "ACTUATOR_EDGE_DENY_CHANGED",
      `${name} namespace must retain a generic text response`,
      issues,
    );
    requirePattern(
      block,
      /return\s+404\s+"not found\\n"\s*;/,
      "ACTUATOR_EDGE_DENY_CHANGED",
      `${name} namespace must fail closed before SPA or proxy routing`,
      issues,
    );
    rejectPattern(
      block,
      /\baccess_log\s+off\s*;/,
      "ACTUATOR_EDGE_LOGGING_CHANGED",
      `${name} probes must inherit the query-free redacted access log`,
      issues,
    );
  }
  if (
    nginx.indexOf("location ~* ^/actuator(?:/|$)")
      > nginx.indexOf("location / {")
    || !api.includes("location ~* ^/api/actuator(?:/|$)")
  ) {
    issues.push(issue(
      "ACTUATOR_EDGE_ORDER_CHANGED",
      "actuator deny locations must precede SPA fallback and API proxy routing",
    ));
  }

  const proxyTargets = [...nginx.matchAll(/\bproxy_pass\s+([^;]+);/g)]
    .map((match) => match[1].trim())
    .sort();
  const expectedTargets = [
    "$shopify_connector",
    "http://backend:8080",
    "http://backend:8080",
    "http://backend:8080/actuator/health/readiness?",
  ].sort();
  if (
    proxyTargets.length !== expectedTargets.length
    || proxyTargets.some(
      (target, index) => target !== expectedTargets[index]
    )
  ) {
    issues.push(issue(
      "PROXY_TARGET_SET_CHANGED",
      "repository Nginx proxy targets changed and require routing review",
    ));
  }

  requirePattern(
    nginx,
    /\baccess_log\s+\/var\/log\/nginx\/access\.log\s+api_access\s*;/,
    "SERVER_SAFE_LOG_DEFAULT_CHANGED",
    "the server must retain the redacted access-log default",
    issues,
  );
  requirePattern(
    nginx,
    /"path":"\$uri"/,
    "QUERY_FREE_LOG_PATH_CHANGED",
    "the access log must retain normalized query-free $uri",
    issues,
  );
  const logFormats = [...nginx.matchAll(
    /\blog_format\s+[A-Za-z0-9_]+\s+([\s\S]*?);/g,
  )].map((match) => match[1]).join("\n");
  rejectPattern(
    logFormats,
    /\$request\b|\$args\b|\$query_string\b|\$http_|\$request_body\b/,
    "UNSAFE_EDGE_LOG_INPUT",
    "Nginx logging must not include request-line, query, header, or body data",
    issues,
  );

  for (const marker of [
    "location = /healthz",
    "location = /readyz",
    "location ~* ^/readyz",
    "location @readiness_unavailable",
  ]) {
    requirePattern(
      blockStartingAt(nginx, marker),
      /\baccess_log\s+off\s*;/,
      "PROBE_LOGGING_CHANGED",
      "health and readiness paths must retain access_log off",
      issues,
    );
  }
}

function inspectSpring(files, runtimeFiles, issues) {
  const security = files.get(REQUIRED_FILES[2]);
  const safety = files.get(REQUIRED_FILES[3]);
  const application = files.get(REQUIRED_FILES[4]);
  const production = files.get(REQUIRED_FILES[5]);
  const pom = files.get(REQUIRED_FILES[1]);
  const runtime = runtimeFiles
    .map((file) => `\n// ${file.relative}\n${file.content}`)
    .join("\n");

  requirePattern(
    application,
    /forward-headers-strategy\s*:\s*framework\b/,
    "FORWARDED_HEADER_STRATEGY_CHANGED",
    "Spring forwarded-header handling must remain explicit",
    issues,
  );
  requirePattern(
    production,
    /org\.apache\.coyote\.http11\.Http11Processor\s*:\s*WARN\b/,
    "PARSER_LOG_REDACTION_CHANGED",
    "production must suppress unsafe Tomcat parser INFO/DEBUG details",
    issues,
  );
  requirePattern(
    safety,
    /"logging\.level\.org\.apache\.coyote\.http11\.Http11Processor"\s*,\s*"WARN"/,
    "PARSER_LOG_OVERRIDE_CHANGED",
    "the production safety override must force the exact parser logger to WARN",
    issues,
  );
  requirePattern(
    pom,
    /<testcontainers\.version>1\.21\.4<\/testcontainers\.version>/,
    "TESTCONTAINERS_VERSION_CHANGED",
    "routing evidence must retain Testcontainers 1.21.4",
    issues,
  );

  rejectPattern(
    runtime,
    /\bHiddenHttpMethodFilter\b|\bHttpMethodOverrideFilter\b|X-HTTP-Method-Override|X-Method-Override|spring\.mvc\.hiddenmethod\.filter\.enabled/,
    "METHOD_OVERRIDE_ENABLED",
    "method override support requires explicit security review",
    issues,
  );
  rejectPattern(
    runtime,
    /\bUrlPathHelper\b|\bPathPatternParser\b|\bStrictHttpFirewall\b|\bDefaultHttpFirewall\b|spring\.mvc\.pathmatch|remove-semicolon-content|relaxed-path-chars|relaxed-query-chars|allow-trace/,
    "PATH_MATCHING_CUSTOMIZED",
    "path matching, firewall, or connector parsing was customized",
    issues,
  );

  requirePattern(
    security,
    /"\/actuator\/health"\s*,\s*"\/actuator\/health\/\*\*"/,
    "ACTUATOR_MATCHER_CHANGED",
    "only the existing health matcher family may remain public",
    issues,
  );
  requirePattern(
    security,
    /"\/actuator"\s*,\s*"\/actuator\/\*\*"\s*\)\.denyAll\(\)/,
    "ACTUATOR_DENY_MATCHER_CHANGED",
    "non-health actuator requests must retain an explicit denyAll matcher",
    issues,
  );
  const healthMatcher = security.indexOf("\"/actuator/health\"");
  const actuatorDeny = security.indexOf("\"/actuator\"", healthMatcher + 1);
  const businessMatchers = security.indexOf(
    "\"/api/v1/platform-admin/tenant-session\"",
  );
  if (
    healthMatcher < 0
    || actuatorDeny < 0
    || businessMatchers < 0
    || !(healthMatcher < actuatorDeny && actuatorDeny < businessMatchers)
  ) {
    issues.push(issue(
      "ACTUATOR_MATCHER_ORDER_CHANGED",
      "health permitAll must precede non-health actuator denyAll and business rules",
    ));
  }
  requirePattern(
    security,
    /\.requestMatchers\("\/api\/v1\/platform-admin\/\*\*"\)\s*\.hasAuthority\(PlatformAdminAuthorities\.SYSTEM_ADMIN\)/,
    "PLATFORM_TRUST_DOMAIN_CHANGED",
    "platform-admin routes must retain SYSTEM_ADMIN enforcement",
    issues,
  );
  requirePattern(
    security,
    /platformBaseSession[\s\S]*?current\.isAuthenticated\(\)[\s\S]*?!platformBaseSession/,
    "TENANT_TRUST_DOMAIN_CHANGED",
    "base SYSTEM_ADMIN sessions must remain excluded from tenant APIs",
    issues,
  );
}

function inspectCheckerInput(checker, issues) {
  rejectPattern(
    checker,
    /process\.env|Bun\.env|Deno\.env/,
    "EXTERNAL_ENVIRONMENT_INPUT",
    "the offline checker must not read process environment input",
    issues,
  );
}

function sortedUnique(issues) {
  const unique = new Map();
  for (const value of issues) {
    unique.set(`${value.code}\0${value.message}`, value);
  }
  return [...unique.values()].sort((left, right) =>
    left.code.localeCompare(right.code, "en")
      || left.message.localeCompare(right.message, "en"));
}

export function inspectHttpRoutingBoundary(repositoryRoot) {
  const root = validateRoot(repositoryRoot);
  const files = new Map(
    REQUIRED_FILES.map((relative) => [
      relative,
      readLocked(root, relative),
    ]),
  );
  const runtimeFiles = walkRuntimeSources(root);
  const issues = [];
  inspectNginx(files.get(REQUIRED_FILES[0]), issues);
  inspectSpring(files, runtimeFiles, issues);
  inspectCheckerInput(files.get(REQUIRED_FILES[6]), issues);
  return {
    root,
    issues: sortedUnique(issues),
    summary: {
      requiredFiles: files.size,
      runtimeFiles: runtimeFiles.length,
      proxyTargets: 2,
      skipped: 0,
    },
  };
}

export function runHttpRoutingBoundaryGate(repositoryRoot) {
  const result = inspectHttpRoutingBoundary(repositoryRoot);
  if (result.issues.length > 0) {
    throw new HttpRoutingBoundaryGateError(result.issues);
  }
  return result;
}

function printFailure(error) {
  const issues = error instanceof HttpRoutingBoundaryGateError
    ? error.issues
    : [issue(
      "GATE_INTERNAL_ERROR",
      "the HTTP routing boundary gate could not complete",
    )];
  process.stderr.write([
    "FAIL HTTP routing boundary gate",
    ...issues.map((value) => `[${value.code}] ${value.message}`),
    "skipped=0",
  ].join("\n") + "\n");
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(SCRIPT_PATH);
if (invokedDirectly) {
  if (process.argv.length !== 2) {
    printFailure(new HttpRoutingBoundaryGateError([
      issue(
        "EXTERNAL_INPUT_REJECTED",
        "the gate accepts no path, URL, environment, credential, or other input",
      ),
    ]));
    process.exitCode = 2;
  } else {
    try {
      const result = runHttpRoutingBoundaryGate(LOCKED_REPOSITORY_ROOT);
      process.stdout.write([
        "PASS HTTP routing boundary gate",
        `required_files=${result.summary.requiredFiles}`,
        `runtime_files=${result.summary.runtimeFiles}`,
        `proxy_targets=${result.summary.proxyTargets}`,
        "skipped=0",
      ].join("\n") + "\n");
    } catch (error) {
      printFailure(error);
      process.exitCode = 1;
    }
  }
}
