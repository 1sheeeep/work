import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIRECTORY = path.dirname(SCRIPT_PATH);
const LOCKED_REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..", "..");
const REQUIRED_FILES = [
  "platform/backend/src/main/java/cn/xzkj/erp/config/SecurityConfig.java",
  "platform/backend/src/main/java/cn/xzkj/erp/iam/security/BearerTokenAuthenticationFilter.java",
  "platform/backend/src/main/resources/application.yml",
  "platform/backend/src/main/resources/application-production.yml",
  "platform/frontend/nginx.conf",
];

export class BrowserOriginGateError extends Error {
  constructor(issues) {
    super(issues.map((value) => `[${value.code}] ${value.message}`).join("\n"));
    this.name = "BrowserOriginGateError";
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
    throw new BrowserOriginGateError([
      issue("REPOSITORY_ROOT_MISSING", "repository root does not exist"),
    ]);
  }
  const realRoot = fs.realpathSync.native(resolved);
  if (realRoot !== resolved) {
    throw new BrowserOriginGateError([
      issue(
        "REPOSITORY_ROOT_ALIAS",
        "repository root must be its canonical absolute path",
      ),
    ]);
  }
  return realRoot;
}

function readRequiredFile(root, relative) {
  const absolute = path.resolve(root, relative);
  if (!isWithin(root, absolute) || !fs.existsSync(absolute)) {
    throw new BrowserOriginGateError([
      issue("REQUIRED_FILE_MISSING", `required file is missing: ${relative}`),
    ]);
  }
  const metadata = fs.lstatSync(absolute);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new BrowserOriginGateError([
      issue(
        "SOURCE_ALIAS_REJECTED",
        `required source must be a regular file: ${relative}`,
      ),
    ]);
  }
  const real = fs.realpathSync.native(absolute);
  if (real !== absolute || !isWithin(root, real)) {
    throw new BrowserOriginGateError([
      issue(
        "SOURCE_ALIAS_REJECTED",
        `required source is aliased or leaves the repository: ${relative}`,
      ),
    ]);
  }
  return fs.readFileSync(absolute, "utf8");
}

function walkJava(root) {
  const start = path.resolve(root, "platform/backend/src/main/java");
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, "en"))) {
      const absolute = path.join(directory, entry.name);
      const relative = slash(path.relative(root, absolute));
      const metadata = fs.lstatSync(absolute);
      if (metadata.isSymbolicLink()) {
        throw new BrowserOriginGateError([
          issue(
            "SOURCE_ALIAS_REJECTED",
            `symbolic links are not accepted in backend source: ${relative}`,
          ),
        ]);
      }
      if (metadata.isDirectory()) {
        visit(absolute);
      } else if (metadata.isFile() && entry.name.endsWith(".java")) {
        files.push({
          relative,
          content: fs.readFileSync(absolute, "utf8"),
        });
      }
    }
  };
  visit(start);
  return files;
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

function apiLocationBlock(nginx) {
  const start = nginx.indexOf("location ^~ /api/");
  if (start < 0) return "";
  const open = nginx.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < nginx.length; index += 1) {
    if (nginx[index] === "{") depth += 1;
    if (nginx[index] === "}") {
      depth -= 1;
      if (depth === 0) return nginx.slice(start, index + 1);
    }
  }
  return "";
}

function inspectRuntimeBoundary(files, javaFiles, issues) {
  const security = files.get(REQUIRED_FILES[0]);
  const bearer = files.get(REQUIRED_FILES[1]);
  const application = files.get(REQUIRED_FILES[2]);
  const production = files.get(REQUIRED_FILES[3]);
  const nginx = files.get(REQUIRED_FILES[4]);
  const java = javaFiles
    .map((file) => `\n// ${file.relative}\n${file.content}`)
    .join("\n");

  requirePattern(
    security,
    /\.csrf\(\s*csrf\s*->\s*csrf\.disable\(\)\s*\)/,
    "CSRF_BOUNDARY_CHANGED",
    "stateless bearer authentication must retain explicit CSRF disablement",
    issues,
  );
  requirePattern(
    security,
    /sessionCreationPolicy\(\s*SessionCreationPolicy\.STATELESS\s*\)/,
    "STATELESS_BOUNDARY_CHANGED",
    "the security chain must remain STATELESS",
    issues,
  );
  for (const feature of ["httpBasic", "formLogin", "logout", "requestCache"]) {
    requirePattern(
      security,
      new RegExp(`\\.${feature}\\(AbstractHttpConfigurer::disable\\)`),
      "AMBIENT_AUTH_SURFACE_ENABLED",
      `${feature} must remain disabled in the bearer-only chain`,
      issues,
    );
  }
  requirePattern(
    bearer,
    /request\.getHeader\(\s*"Authorization"\s*\)/,
    "BEARER_TRANSPORT_CHANGED",
    "authentication must remain sourced from the Authorization header",
    issues,
  );
  requirePattern(
    bearer,
    /private\s+static\s+final\s+String\s+PREFIX\s*=\s*"Bearer\s+"/,
    "BEARER_TRANSPORT_CHANGED",
    "the authentication filter must retain the Bearer scheme",
    issues,
  );
  rejectPattern(
    java,
    /@CrossOrigin\b|\bCorsConfiguration(?:Source)?\b|\.cors\s*\(/,
    "CORS_POLICY_UNREVIEWED",
    "application CORS policy changed and requires explicit security review",
    issues,
  );
  rejectPattern(
    java,
    /\bHttpSession\b|\bjakarta\.servlet\.http\.Cookie\b|\.addCookie\s*\(|SET_COOKIE/,
    "AUTH_COOKIE_SURFACE",
    "backend source introduces a cookie or servlet-session surface",
    issues,
  );
  requirePattern(
    application,
    /forward-headers-strategy\s*:\s*framework\b/,
    "FORWARDED_HEADER_FACT_CHANGED",
    "application forwarded-header strategy must remain explicit",
    issues,
  );
  requirePattern(
    production,
    /\berp\s*:\s*[\s\S]*?\benvironment\s*:\s*production\b/,
    "PRODUCTION_PROFILE_FACT_CHANGED",
    "production environment identity must remain explicit",
    issues,
  );
}

function inspectEdgeBoundary(files, issues) {
  const nginx = files.get(REQUIRED_FILES[4]);
  const api = apiLocationBlock(nginx);
  requirePattern(
    api,
    /proxy_set_header\s+Host\s+\$host\s*;/,
    "EDGE_HOST_FORWARDING_CHANGED",
    "repository edge must retain its documented Host forwarding behavior",
    issues,
  );
  requirePattern(
    api,
    /proxy_set_header\s+X-Real-IP\s+\$remote_addr\s*;/,
    "EDGE_FORWARDING_CHANGED",
    "repository edge must set X-Real-IP from the direct peer",
    issues,
  );
  requirePattern(
    api,
    /proxy_set_header\s+X-Forwarded-For\s+\$proxy_add_x_forwarded_for\s*;/,
    "EDGE_FORWARDING_CHANGED",
    "repository edge must retain its documented X-Forwarded-For behavior",
    issues,
  );
  requirePattern(
    api,
    /proxy_set_header\s+X-Forwarded-Proto\s+\$scheme\s*;/,
    "EDGE_FORWARDING_CHANGED",
    "repository edge must set X-Forwarded-Proto from its request scheme",
    issues,
  );
  rejectPattern(
    nginx,
    /Access-Control-Allow-(?:Origin|Credentials|Headers|Methods)|\$http_origin/,
    "EDGE_CORS_POLICY_UNREVIEWED",
    "repository Nginx must not silently introduce a CORS policy",
    issues,
  );
  rejectPattern(
    nginx,
    /add_header\s+Set-Cookie\b/i,
    "EDGE_AUTH_COOKIE_SURFACE",
    "repository Nginx must not synthesize cookies",
    issues,
  );
  if (
    /Access-Control-Allow-Origin["'\s:]+\*/i.test(nginx)
    && /Access-Control-Allow-Credentials["'\s:]+true/i.test(nginx)
  ) {
    issues.push(issue(
      "CREDENTIALED_WILDCARD",
      "credentialed wildcard CORS is prohibited",
    ));
  }
}

function inspectLocations(javaFiles, issues) {
  let locations = 0;
  for (const file of javaFiles.filter((value) =>
    value.relative.endsWith("Controller.java"))) {
    rejectPattern(
      file.content,
      /ServletUriComponentsBuilder|getRequestURL\s*\(|getServerName\s*\(|getHeader\(\s*"Host"\s*\)/,
      "REQUEST_DERIVED_LOCATION",
      `${file.relative} derives a response URL from request authority`,
      issues,
    );
    for (const match of file.content.matchAll(
      /URI\.create\s*\(\s*"([^"]*)"/g,
    )) {
      locations += 1;
      if (!match[1].startsWith("/api/v1/")) {
        issues.push(issue(
          "ABSOLUTE_OR_UNSCOPED_LOCATION",
          `${file.relative} creates a non-relative API Location`,
        ));
      }
    }
  }
  if (locations === 0) {
    issues.push(issue(
      "LOCATION_FACTS_MISSING",
      "no controller resource-creation Location facts were found",
    ));
  }
  return locations;
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

export function inspectBrowserOriginTrustBoundary(repositoryRoot) {
  const root = validateRoot(repositoryRoot);
  const files = new Map(
    REQUIRED_FILES.map((relative) => [
      relative,
      readRequiredFile(root, relative),
    ]),
  );
  const javaFiles = walkJava(root);
  const issues = [];
  inspectRuntimeBoundary(files, javaFiles, issues);
  inspectEdgeBoundary(files, issues);
  const relativeLocations = inspectLocations(javaFiles, issues);
  return {
    root,
    issues: sortedUnique(issues),
    summary: {
      requiredFiles: files.size,
      javaFiles: javaFiles.length,
      relativeLocations,
      skipped: 0,
    },
  };
}

export function runBrowserOriginTrustBoundaryGate(repositoryRoot) {
  const result = inspectBrowserOriginTrustBoundary(repositoryRoot);
  if (result.issues.length > 0) {
    throw new BrowserOriginGateError(result.issues);
  }
  return result;
}

function printFailure(error) {
  const issues = error instanceof BrowserOriginGateError
    ? error.issues
    : [issue("GATE_INTERNAL_ERROR", "browser-origin gate could not complete")];
  process.stderr.write([
    "FAIL browser origin trust boundary gate",
    ...issues.map((value) => `[${value.code}] ${value.message}`),
    "skipped=0",
  ].join("\n") + "\n");
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(SCRIPT_PATH);
if (invokedDirectly) {
  if (process.argv.length !== 2) {
    printFailure(new BrowserOriginGateError([
      issue(
        "EXTERNAL_INPUT_REJECTED",
        "the gate accepts no path, environment, URL, origin, or credential input",
      ),
    ]));
    process.exitCode = 2;
  } else {
    try {
      const result = runBrowserOriginTrustBoundaryGate(
        LOCKED_REPOSITORY_ROOT,
      );
      process.stdout.write([
        "PASS browser origin trust boundary gate",
        `required_files=${result.summary.requiredFiles}`,
        `java_files=${result.summary.javaFiles}`,
        `relative_locations=${result.summary.relativeLocations}`,
        "skipped=0",
      ].join("\n") + "\n");
    } catch (error) {
      printFailure(error);
      process.exitCode = 1;
    }
  }
}
