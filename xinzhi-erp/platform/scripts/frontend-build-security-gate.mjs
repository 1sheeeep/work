import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIRECTORY = path.dirname(SCRIPT_PATH);
const LOCKED_REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..", "..");
const BUILD_RELATIVE = "platform/frontend/dist";
const NGINX_RELATIVE = "platform/frontend/nginx.conf";
const PACKAGE_LOCK_RELATIVE = "platform/frontend/package-lock.json";
const PRODUCT_SOURCE_RELATIVE = "platform/frontend/src";
const VITE_CONFIG_RELATIVE = "platform/frontend/vite.config.ts";
const MAX_FILES = 10_000;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_BUILD_BYTES = 128 * 1024 * 1024;
const ROOT_ARTIFACTS = new Set([
  "favicon.ico",
  "index.html",
  "manifest.webmanifest",
]);
const TEXT_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".mjs",
  ".svg",
  ".webmanifest",
]);
const ASSET_EXTENSIONS = new Set([
  ".avif",
  ".css",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".js",
  ".json",
  ".mjs",
  ".png",
  ".svg",
  ".ttf",
  ".webmanifest",
  ".webp",
  ".woff",
  ".woff2",
]);
const FORBIDDEN_FILE_EXTENSIONS = new Set([
  ".bak",
  ".conf",
  ".crt",
  ".env",
  ".java",
  ".jsx",
  ".key",
  ".log",
  ".map",
  ".orig",
  ".pem",
  ".properties",
  ".sql",
  ".swp",
  ".ts",
  ".tsx",
  ".vue",
  ".yaml",
  ".yml",
]);
const FORBIDDEN_BASENAMES = new Set([
  "dockerfile",
  "license",
  "nginx.conf",
  "package-lock.json",
  "package.json",
  "settings.js",
  "settings.json",
]);
const SAFE_ABSOLUTE_URL_PREFIXES = [
  "http://www.w3.org/1998/math/mathml",
  "http://www.w3.org/1999/xlink",
  "http://www.w3.org/2000/svg",
  "http://www.w3.org/xml/1998/namespace",
  "https://react.dev/errors/",
];

const CONTENT_RULES = [
  [
    "SOURCE_MAP_REFERENCE",
    /(?:sourceMappingURL\s*=|sourceURL\s*=|sourcesContent["']?\s*:|webpack:\/\/|vite:\/\/)/i,
    "source-map or source-URL metadata is present",
  ],
  [
    "SOURCE_PATH_DISCLOSURE",
    /(?:[A-Za-z]:[\\/](?:Users|workspace|src|app|build)[\\/]|\/(?:Users|home|workspace|var\/www|app|build)\/[A-Za-z0-9._/-]+|\b(?:src|source)[\\/][A-Za-z0-9._/-]+\.(?:jsx?|tsx?|vue|svelte)\b)/i,
    "a source or absolute build path is present",
  ],
  [
    "INLINE_ENVIRONMENT_OBJECT",
    /(?:import\.meta\.env|process\.env|window\.__ENV__|globalThis\.__ENV__|\bVITE_[A-Z0-9_]+\b|\bNODE_ENV\s*[:=]\s*["']development["'])/i,
    "an environment object or development build marker is present",
  ],
  [
    "PRIVATE_KEY_SIGNATURE",
    /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/,
    "a private-key signature is present",
  ],
  [
    "AWS_KEY_SIGNATURE",
    /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
    "an AWS access-key signature is present",
  ],
  [
    "GITHUB_TOKEN_SIGNATURE",
    /\b(?:gh[pousr]_[A-Za-z0-9]{20,255}|github_pat_[A-Za-z0-9_]{20,255})\b/,
    "a GitHub token signature is present",
  ],
  [
    "OPENAI_KEY_SIGNATURE",
    /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/,
    "an OpenAI key signature is present",
  ],
  [
    "JWT_SIGNATURE",
    /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/,
    "a JWT-shaped value is present",
  ],
  [
    "HARDCODED_SECRET_VALUE",
    /\b(?:access[_-]?token|api[_-]?key|client[_-]?secret|credential|password|passwd|private[_-]?key|refresh[_-]?token|secret|token)["']?\s*[:=]\s*["'`](?!<?(?:placeholder|redacted|example)[^"'`]*>?["'`])[^"'`\r\n]{8,}["'`]/i,
    "a credential-like field has a hard-coded literal value",
  ],
  [
    "HARDCODED_BEARER_VALUE",
    /\bAuthorization\s*[:=]\s*["'`]Bearer\s+[A-Za-z0-9._~-]{12,}["'`]/i,
    "a hard-coded bearer value is present",
  ],
  [
    "DATABASE_ENDPOINT",
    /\b(?:jdbc:(?:mariadb|mysql|oracle|postgresql|sqlserver):|(?:mariadb|mysql|postgres(?:ql)?):\/\/|(?:database|db|mysql|postgres)\.(?:cluster\.local|internal|local|svc)\b)/i,
    "a database endpoint or internal database host is present",
  ],
  [
    "DEBUG_BUILD_MARKER",
    /(?:\bdebug\s*[:=]\s*(?:true|1|["']true["'])|\b__DEV__\b|\bVITE_DEBUG\b|\/__vite_ping\b)/i,
    "a debug or development-runtime marker is present",
  ],
  [
    "FIXED_TEST_ACCOUNT",
    /\b(?:default[_-]?(?:account|user|username)|test[_-]?(?:account|user|username)|uat[_-]?(?:account|user|username)|username)["']?\s*[:=]\s*["'`](?:admin|demo|test|uat)(?:[-_.][A-Za-z0-9]+)?["'`]/i,
    "a fixed test or UAT account is present",
  ],
  [
    "NONPUBLIC_API_PATH",
    /(?:\/actuator(?:\/|["'`?])|\/_backend(?:\/|["'`?])|\/internal(?:\/|["'`?]))/i,
    "a non-public actuator or internal API path is present",
  ],
  [
    "LICENSE_COMMENT_RESIDUE",
    /(?:\/\*!|@license\b|@preserve\b)/i,
    "a retained license or preservation comment is present",
  ],
];

export class FrontendBuildSecurityGateError extends Error {
  constructor(issues) {
    super(issues.map((value) => `[${value.code}] ${value.message}`).join("\n"));
    this.name = "FrontendBuildSecurityGateError";
    this.issues = issues;
  }
}

function issue(code, message, file) {
  return file ? { code, message, file } : { code, message };
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
    throw new FrontendBuildSecurityGateError([
      issue("REPOSITORY_ROOT_MISSING", "repository root does not exist"),
    ]);
  }
  const metadata = fs.lstatSync(resolved);
  const realRoot = fs.realpathSync.native(resolved);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || realRoot !== resolved) {
    throw new FrontendBuildSecurityGateError([
      issue(
        "REPOSITORY_ROOT_ALIAS",
        "repository root must be its canonical, non-symbolic absolute path",
      ),
    ]);
  }
  return realRoot;
}

function lockedPath(root, relative, expectedKind) {
  const absolute = path.resolve(root, relative);
  if (!isWithin(root, absolute) || !fs.existsSync(absolute)) {
    throw new FrontendBuildSecurityGateError([
      issue(
        expectedKind === "directory" ? "BUILD_MISSING" : "NGINX_CONFIG_MISSING",
        expectedKind === "directory"
          ? "the fixed frontend production build directory is missing"
          : "the fixed repository Nginx configuration is missing",
      ),
    ]);
  }
  const metadata = fs.lstatSync(absolute);
  const real = fs.realpathSync.native(absolute);
  const validKind = expectedKind === "directory"
    ? metadata.isDirectory()
    : metadata.isFile();
  if (
    !validKind
    || metadata.isSymbolicLink()
    || real !== absolute
    || !isWithin(root, real)
  ) {
    throw new FrontendBuildSecurityGateError([
      issue(
        expectedKind === "directory" ? "BUILD_ALIAS_REJECTED" : "NGINX_ALIAS_REJECTED",
        expectedKind === "directory"
          ? "the production build must be a non-symbolic directory inside the repository"
          : "the Nginx configuration must be a non-symbolic regular file inside the repository",
      ),
    ]);
  }
  return absolute;
}

function repositoryEntry(root, relative, expectedKind, issues, code) {
  const absolute = path.resolve(root, relative);
  if (!isWithin(root, absolute) || !fs.existsSync(absolute)) {
    issues.push(issue(code, "a required fixed repository input is missing", relative));
    return null;
  }
  const metadata = fs.lstatSync(absolute);
  const real = fs.realpathSync.native(absolute);
  const validKind = expectedKind === "directory"
    ? metadata.isDirectory()
    : metadata.isFile();
  if (
    !validKind
    || metadata.isSymbolicLink()
    || real !== absolute
    || !isWithin(root, real)
  ) {
    issues.push(issue(
      code,
      "a required fixed repository input is aliased or has the wrong type",
      relative,
    ));
    return null;
  }
  return absolute;
}

function normalizedRelative(root, absolute) {
  return path.relative(root, absolute).split(path.sep).join("/");
}

function sortedUnique(issues) {
  const unique = new Map();
  for (const value of issues) {
    unique.set(`${value.code}\0${value.file ?? ""}\0${value.message}`, value);
  }
  return [...unique.values()].sort((left, right) =>
    left.code.localeCompare(right.code, "en")
      || (left.file ?? "").localeCompare(right.file ?? "", "en")
      || left.message.localeCompare(right.message, "en"));
}

function walkBuild(buildRoot, issues) {
  const files = new Map();
  const directories = [buildRoot];
  let totalBytes = 0;

  while (directories.length > 0) {
    const directory = directories.pop();
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = normalizedRelative(buildRoot, absolute);
      const metadata = fs.lstatSync(absolute);
      if (metadata.isSymbolicLink()) {
        issues.push(issue(
          "BUILD_ALIAS_REJECTED",
          "the production build contains a symbolic filesystem entry",
          relative,
        ));
        continue;
      }
      if (metadata.isDirectory()) {
        directories.push(absolute);
        continue;
      }
      if (!metadata.isFile()) {
        issues.push(issue(
          "BUILD_SPECIAL_FILE",
          "the production build contains a non-regular filesystem entry",
          relative,
        ));
        continue;
      }
      const real = fs.realpathSync.native(absolute);
      if (!isWithin(buildRoot, real) || real !== absolute) {
        issues.push(issue(
          "BUILD_ALIAS_REJECTED",
          "the production build contains an aliased file",
          relative,
        ));
        continue;
      }
      totalBytes += metadata.size;
      if (metadata.size > MAX_FILE_BYTES) {
        issues.push(issue(
          "BUILD_FILE_TOO_LARGE",
          "a production artifact exceeds the bounded per-file inspection limit",
          relative,
        ));
      }
      files.set(relative, { absolute, size: metadata.size });
      if (files.size > MAX_FILES || totalBytes > MAX_BUILD_BYTES) {
        throw new FrontendBuildSecurityGateError([
          issue(
            "BUILD_BOUNDS_EXCEEDED",
            "the production build exceeds the fixed inspection bounds",
          ),
        ]);
      }
    }
  }
  return { files, totalBytes };
}

function inspectArtifactNames(files, issues) {
  for (const relative of files.keys()) {
    const segments = relative.split("/");
    const basename = segments.at(-1);
    const lower = basename.toLowerCase();
    const extension = path.posix.extname(lower);
    if (
      segments.some((segment) => segment.startsWith("."))
      || lower === ".env"
      || lower.startsWith(".env.")
    ) {
      issues.push(issue(
        "SENSITIVE_ARTIFACT_NAME",
        "a hidden or environment-named artifact is present",
        relative,
      ));
    }
    if (
      FORBIDDEN_FILE_EXTENSIONS.has(extension)
      || FORBIDDEN_BASENAMES.has(lower)
      || /(?:^|[._-])(?:backup|credentials?|passwords?|private[-_]?key|secrets?|settings)(?:[._-]|$)/i.test(lower)
    ) {
      issues.push(issue(
        "SENSITIVE_ARTIFACT_NAME",
        "a source, configuration, secret, backup, or source-map artifact is present",
        relative,
      ));
    }
    if (!ROOT_ARTIFACTS.has(relative)) {
      if (segments[0] !== "assets" || segments.length < 2) {
        issues.push(issue(
          "UNEXPECTED_ARTIFACT_PATH",
          "production artifacts other than index.html must be below assets/",
          relative,
        ));
      } else if (!ASSET_EXTENSIONS.has(extension)) {
        issues.push(issue(
          "UNAPPROVED_ASSET_TYPE",
          "an asset has an unapproved production extension",
          relative,
        ));
      }
    }
  }
  if (!files.has("index.html")) {
    issues.push(issue(
      "INDEX_MISSING",
      "the production build must contain index.html",
    ));
  }
}

function decodeText(buffer, relative, issues) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    issues.push(issue(
      "INVALID_TEXT_ENCODING",
      "a text artifact is not valid UTF-8",
      relative,
    ));
    return null;
  }
}

function inspectContent(relative, content, issues) {
  for (const [code, expression, message] of CONTENT_RULES) {
    if (expression.test(content)) {
      issues.push(issue(code, message, relative));
    }
  }

  for (const match of content.matchAll(/https?:\/\/[^\s"'`<>()\\]+/gi)) {
    const candidate = match[0].toLowerCase();
    if (SAFE_ABSOLUTE_URL_PREFIXES.some((prefix) => candidate.startsWith(prefix))) {
      continue;
    }
    if (
      /\/(?:api|graphql)(?:\/|[?#]|$)/i.test(candidate)
      || /(?:dev|development|internal|local|staging|test|uat)[.-]/i.test(candidate)
    ) {
      issues.push(issue(
        "UNAPPROVED_ABSOLUTE_URL",
        "an absolute API, development, test, or internal URL is present",
        relative,
      ));
      break;
    }
  }

  if (
    relative.endsWith(".html")
    && /<script\b(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script\s*>/i.test(content)
  ) {
    issues.push(issue(
      "INLINE_EXECUTABLE_SCRIPT",
      "an inline executable script is present",
      relative,
    ));
  }
}

function manifestReferences(content, relative, issues) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    issues.push(issue(
      "INVALID_MANIFEST",
      "a JSON or web manifest artifact is not valid JSON",
      relative,
    ));
    return [];
  }
  const references = [];
  const stack = [parsed];
  while (stack.length > 0) {
    const value = stack.pop();
    if (Array.isArray(value)) {
      stack.push(...value);
    } else if (value && typeof value === "object") {
      stack.push(...Object.values(value));
    } else if (
      typeof value === "string"
      && /^(?:https?:|\/\/|data:|blob:|javascript:|\/?assets\/|\.\.?\/)/i.test(value)
    ) {
      references.push(value);
    }
  }
  return references;
}

function collectReferences(relative, content, issues) {
  const extension = path.posix.extname(relative).toLowerCase();
  const references = [];
  if (extension === ".html") {
    for (const match of content.matchAll(
      /\b(?:href|poster|src)\s*=\s*(["'])(.*?)\1/gi,
    )) {
      references.push(match[2]);
    }
  }
  if (extension === ".css") {
    for (const match of content.matchAll(
      /(?:@import\s+|url\()\s*(["']?)([^"'()\s]+)\1\s*\)?/gi,
    )) {
      references.push(match[2]);
    }
  }
  if (extension === ".js" || extension === ".mjs") {
    for (const expression of [
      /\b(?:from|import\s*\()\s*(["'])(.*?)\1/g,
      /\bimport\s*(["'])(.*?)\1/g,
      /\bnew\s+URL\s*\(\s*(["'])(.*?)\1\s*,\s*import\.meta\.url\s*\)/g,
      /(["'])((?:\/|\.\.?\/)?assets\/[^"'`?#\s]+)\1/g,
    ]) {
      for (const match of content.matchAll(expression)) {
        references.push(match[2]);
      }
    }
  }
  if (extension === ".json" || extension === ".webmanifest") {
    references.push(...manifestReferences(content, relative, issues));
  }
  return references;
}

function resolveReference(source, raw, issues) {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed.startsWith("#")) return null;
  if (/^(?:https?:)?\/\//i.test(trimmed) || /^[A-Za-z][A-Za-z0-9+.-]*:/i.test(trimmed)) {
    issues.push(issue(
      "EXTERNAL_ASSET_REFERENCE",
      "an HTML, CSS, JavaScript, or manifest resource uses a non-same-origin reference",
      source,
    ));
    return null;
  }
  if (trimmed.includes("\\") || /%(?:2e|2f|5c)/i.test(trimmed)) {
    issues.push(issue(
      "UNSAFE_ASSET_REFERENCE",
      "an asset reference contains traversal or non-canonical separators",
      source,
    ));
    return null;
  }
  const withoutFragment = trimmed.split("#", 1)[0];
  const withoutQuery = withoutFragment.split("?", 1)[0];
  if (withoutQuery === "") return null;
  let decoded;
  try {
    decoded = decodeURIComponent(withoutQuery);
  } catch {
    issues.push(issue(
      "UNSAFE_ASSET_REFERENCE",
      "an asset reference is not valid URL encoding",
      source,
    ));
    return null;
  }
  const sourceDirectory = path.posix.dirname(source);
  const candidate = decoded.startsWith("/")
    ? path.posix.normalize(decoded.slice(1))
    : decoded.startsWith("assets/")
      ? path.posix.normalize(decoded)
      : path.posix.normalize(path.posix.join(sourceDirectory, decoded));
  if (
    candidate === ""
    || candidate === "."
    || candidate === ".."
    || candidate.startsWith("../")
    || path.posix.isAbsolute(candidate)
    || (!ROOT_ARTIFACTS.has(candidate) && !candidate.startsWith("assets/"))
  ) {
    issues.push(issue(
      "UNSAFE_ASSET_REFERENCE",
      "an asset reference escapes the production build root",
      source,
    ));
    return null;
  }
  return candidate;
}

function inspectReferenceGraph(files, text, issues) {
  const reachable = new Set();
  const queue = files.has("index.html") ? ["index.html"] : [];
  let references = 0;

  while (queue.length > 0) {
    const current = queue.shift();
    if (reachable.has(current)) continue;
    reachable.add(current);
    const content = text.get(current);
    if (content === undefined) continue;
    for (const raw of collectReferences(current, content, issues)) {
      references += 1;
      const target = resolveReference(current, raw, issues);
      if (target === null) continue;
      if (!files.has(target)) {
        issues.push(issue(
          "MISSING_REFERENCED_ASSET",
          "a production resource references a missing same-origin asset",
          current,
        ));
        continue;
      }
      queue.push(target);
    }
  }

  for (const relative of files.keys()) {
    if (!reachable.has(relative)) {
      issues.push(issue(
        "UNREFERENCED_ARTIFACT",
        "a production artifact is not reachable from index.html",
        relative,
      ));
    }
  }
  return references;
}

function inspectDependencyVersions(root, issues) {
  const packageLockPath = repositoryEntry(
    root,
    PACKAGE_LOCK_RELATIVE,
    "file",
    issues,
    "DEPENDENCY_CONSTANT_PROVENANCE",
  );
  if (packageLockPath === null) return false;
  let lock;
  try {
    lock = JSON.parse(fs.readFileSync(packageLockPath, "utf8"));
  } catch {
    issues.push(issue(
      "DEPENDENCY_CONSTANT_PROVENANCE",
      "the package lock is not valid JSON",
      PACKAGE_LOCK_RELATIVE,
    ));
    return false;
  }
  const expected = [
    ["node_modules/@tanstack/react-router", "1.170.18"],
    ["node_modules/@tanstack/router-core", "1.171.15"],
  ];
  const valid = expected.every(([packagePath, version]) =>
    lock.packages?.[packagePath]?.version === version);
  if (!valid) {
    issues.push(issue(
      "DEPENDENCY_CONSTANT_PROVENANCE",
      "the accepted dependency constant versions have drifted",
      PACKAGE_LOCK_RELATIVE,
    ));
  }
  return valid;
}

function scrubReviewedProductSource(relative, content) {
  let reviewed = content;
  if (relative === "platform/frontend/src/auth/redirects.ts") {
    reviewed = reviewed
      .replace(
        /new URL\(value,\s*(["'])https:\/\/erp\.local\1\)/,
        "new URL(value, '')",
      )
      .replace(
        /target\.origin\s*!==\s*(["'])https:\/\/erp\.local\1/,
        "target.origin !== ''",
      );
  }
  if (relative === "platform/frontend/src/pages/ShopDetailPage.tsx") {
    reviewed = reviewed.replace(
      /new URL\((["'])https:\/\/erp\.local\1\)/,
      "new URL('')",
    );
  }
  if (relative === "platform/frontend/src/pages/OrderCenterPage.tsx") {
    reviewed = reviewed.replace('placeholder="https://…"', 'placeholder=""');
  }
  if (relative === "platform/frontend/src/modules/customerServiceEntry.ts") {
    reviewed = reviewed
      .replace("import.meta.env.DEV", "false")
      .replace("import.meta.env.VITE_CUSTOMER_SERVICE_WORKBENCH_URL", "undefined")
      .replace('"127.0.0.1"', '""')
      .replace('"localhost"', '""')
      .replace('"[::1]"', '""');
  }
  return reviewed;
}

function inspectProductSource(root, issues) {
  const sourceRoot = repositoryEntry(
    root,
    PRODUCT_SOURCE_RELATIVE,
    "directory",
    issues,
    "PRODUCT_SOURCE_BOUNDARY",
  );
  if (sourceRoot === null) return 0;
  const directories = [sourceRoot];
  let sourceFiles = 0;
  while (directories.length > 0) {
    const directory = directories.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = normalizedRelative(root, absolute);
      const metadata = fs.lstatSync(absolute);
      if (metadata.isSymbolicLink()) {
        issues.push(issue(
          "PRODUCT_SOURCE_BOUNDARY",
          "the product source tree contains a symbolic filesystem entry",
          relative,
        ));
        continue;
      }
      if (metadata.isDirectory()) {
        directories.push(absolute);
        continue;
      }
      if (
        !metadata.isFile()
        || !/\.[cm]?[jt]sx?$/.test(entry.name)
        || /\.test\.[jt]sx?$/.test(entry.name)
        || /\.d\.ts$/.test(entry.name)
      ) {
        continue;
      }
      sourceFiles += 1;
      const content = fs.readFileSync(absolute, "utf8");
      const reviewedContent = scrubReviewedProductSource(relative, content);
      if (
        /(?:\blocalhost\b|\bhost\.docker\.internal\b|\b127\.0\.0\.1\b|\b0\.0\.0\.0\b|\[::1\])/i.test(reviewedContent)
      ) {
        issues.push(issue(
          "PRODUCT_LOCAL_ENDPOINT",
          "product source contains a local or development endpoint",
          relative,
        ));
      }
      const requestConfigurationSurface = reviewedContent;
      if (
        /(?:https?:\/\/|(?:^|["'`])\/\/[A-Za-z0-9])/im.test(requestConfigurationSurface)
        || /(?:import\.meta\.env|process\.env|\bVITE_[A-Z0-9_]+\b)/i.test(requestConfigurationSurface)
      ) {
        issues.push(issue(
          "PRODUCT_EXTERNAL_REQUEST_CONFIG",
          "product source contains an absolute external URL or build-time environment injection",
          relative,
        ));
      }
    }
  }
  return sourceFiles;
}

function inspectViteDevelopmentBoundary(root, issues) {
  const vitePath = repositoryEntry(
    root,
    VITE_CONFIG_RELATIVE,
    "file",
    issues,
    "VITE_DEVELOPMENT_BOUNDARY",
  );
  if (vitePath === null) return false;
  const vite = fs.readFileSync(vitePath, "utf8");
  const proxyExpression =
    /(["'])\/api\1\s*:\s*(["'])http:\/\/localhost:8080\2/g;
  const proxyMatches = [...vite.matchAll(proxyExpression)];
  const withoutApprovedProxy = vite.replace(proxyExpression, "");
  const valid =
    proxyMatches.length === 1
    && /\bserver\s*:\s*\{/.test(vite)
    && /\bproxy\s*:\s*\{/.test(vite)
    && !/(?:\bbuild\s*:|\bdefine\s*:|\benvPrefix\s*:|\bloadEnv\s*\(|\bimport\.meta\.env\b|\bprocess\.env\b)/.test(vite)
    && !/(?:https?:\/\/|\blocalhost\b|\bhost\.docker\.internal\b|\b127\.0\.0\.1\b|\b0\.0\.0\.0\b|\[::1\])/i.test(withoutApprovedProxy);
  if (!valid) {
    issues.push(issue(
      "VITE_DEVELOPMENT_BOUNDARY",
      "the sole localhost value must remain the Vite dev-server /api proxy and must not enter build configuration",
      VITE_CONFIG_RELATIVE,
    ));
  }
  return valid;
}

function inspectAcceptedDependencyConstant(root, text, issues) {
  const issueCount = issues.length;
  const matches = [];
  for (const [relative, content] of text) {
    for (const match of content.matchAll(/localhost/gi)) {
      matches.push({ relative, content, offset: match.index });
    }
    if (
      /(?:\bhost\.docker\.internal\b|\b127\.0\.0\.1\b|\b0\.0\.0\.0\b|\[::1\])/i.test(content)
    ) {
      issues.push(issue(
        "LOCAL_OR_DEVELOPMENT_HOST",
        "a non-approved local or development host is present",
        relative,
      ));
    }
  }
  if (matches.length !== 1) {
    issues.push(issue(
      "DEPENDENCY_CONSTANT_COUNT",
      "the accepted TanStack Router localhost constant must occur exactly once across all text artifacts",
    ));
  } else {
    const match = matches[0];
    const start = Math.max(0, match.offset - 240);
    const end = Math.min(match.content.length, match.offset + 80);
    const context = match.content.slice(start, end);
    const exactFallback =
      /window\?\.origin&&window\.origin!==([`'"])null\1\?[^;]{0,180}window\.origin:[^;]{0,120}([`'"])http:\/\/localhost\2/.test(context);
    if (!exactFallback) {
      issues.push(issue(
        "DEPENDENCY_CONSTANT_CONTEXT",
        "the localhost value is not the reviewed window.origin fallback",
        match.relative,
      ));
    }
  }
  inspectDependencyVersions(root, issues);
  const sourceFiles = inspectProductSource(root, issues);
  inspectViteDevelopmentBoundary(root, issues);
  return {
    accepted: issues.length === issueCount ? 1 : 0,
    sourceFiles,
  };
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

function inspectNginxPolicy(nginx, issues) {
  if (!/\bserver_tokens\s+off\s*;/.test(nginx)) {
    issues.push(issue(
      "NGINX_SERVER_TOKENS",
      "the edge must suppress Nginx version tokens",
      NGINX_RELATIVE,
    ));
  }
  if (/\bautoindex\s+on\s*;/.test(nginx)) {
    issues.push(issue(
      "NGINX_DIRECTORY_LISTING",
      "directory listing must remain disabled",
      NGINX_RELATIVE,
    ));
  }

  const apiLocations = [...nginx.matchAll(
    /^\s*location\s+[^\r\n{]*\/api(?:\/|\b)[^\r\n{]*\{/gm,
  )];
  const api = blockStartingAt(nginx, "location ^~ /api/");
  if (
    // Reviewed API locations: the prefix proxy, its nested actuator deny, and
    // the exact long-running Shopify app release endpoint.
    apiLocations.length !== 3
    || !/^\s*location\s+\^~\s+\/api\/\s*\{/m.test(nginx)
    || api === ""
    || !/\bproxy_pass\s+http:\/\/backend:8080\s*;/.test(api)
  ) {
    issues.push(issue(
      "NGINX_API_TRUST_DOMAIN_POLICY",
      "the API trust domain must retain one ^~ /api/ proxy immune to static regex locations",
      NGINX_RELATIVE,
    ));
  }
  const actuator = blockStartingAt(
    nginx,
    "location ~* ^/actuator(?:/|$)",
  );
  const apiActuator = blockStartingAt(
    api,
    "location ~* ^/api/actuator(?:/|$)",
  );
  if (
    actuator === ""
    || apiActuator === ""
    || !/return\s+404\s+"not found\\n"\s*;/.test(actuator)
    || !/return\s+404\s+"not found\\n"\s*;/.test(apiActuator)
    || !/\bdefault_type\s+text\/plain\s*;/.test(actuator)
    || !/\bdefault_type\s+text\/plain\s*;/.test(apiActuator)
  ) {
    issues.push(issue(
      "NGINX_ACTUATOR_POLICY",
      "actuator namespaces must fail closed before SPA fallback and API proxying",
      NGINX_RELATIVE,
    ));
  }

  const dotfiles = blockStartingAt(nginx, "location ~ (^|/)\\.");
  if (dotfiles === "" || !/return\s+404\s+"not found\\n"\s*;/.test(dotfiles)) {
    issues.push(issue(
      "NGINX_DOTFILE_POLICY",
      "hidden paths must fail closed with the generic 404 response",
      NGINX_RELATIVE,
    ));
  }

  const assets = blockStartingAt(nginx, "location ~* ^/assets/");
  if (
    assets === ""
    || !/try_files\s+\$uri\s+@static_not_found\s*;/.test(assets)
    || /\.(?:map|tsx?|ya\?ml)/i.test(assets.split("{", 1)[0])
  ) {
    issues.push(issue(
      "NGINX_ASSET_ALLOWLIST",
      "assets must use the reviewed extension allowlist and fail closed when missing",
      NGINX_RELATIVE,
    ));
  }

  for (const marker of ["location /assets/", "location = /assets"]) {
    const block = blockStartingAt(nginx, marker);
    if (block === "" || !/return\s+404\s+"not found\\n"\s*;/.test(block)) {
      issues.push(issue(
        "NGINX_UNKNOWN_ASSET_POLICY",
        "unknown asset and asset-directory requests must return the generic 404 response",
        NGINX_RELATIVE,
      ));
    }
  }

  const index = blockStartingAt(nginx, "location = /index.html");
  if (
    index === ""
    || !/try_files\s+\/index\.html\s+@static_not_found\s*;/.test(index)
  ) {
    issues.push(issue(
      "NGINX_INDEX_POLICY",
      "index.html must be the only directly served root artifact",
      NGINX_RELATIVE,
    ));
  }

  for (const rootArtifact of ["favicon.ico", "manifest.webmanifest"]) {
    const block = blockStartingAt(nginx, `location = /${rootArtifact}`);
    if (
      block === ""
      || !new RegExp(
        `try_files\\s+\\/${rootArtifact.replace(".", "\\.")}\\s+@static_not_found\\s*;`,
      ).test(block)
    ) {
      issues.push(issue(
        "NGINX_ROOT_ASSET_POLICY",
        "favicon and web manifest must use exact fail-closed root locations",
        NGINX_RELATIVE,
      ));
    }
  }

  const staticNotFound = blockStartingAt(nginx, "location @static_not_found");
  if (
    staticNotFound === ""
    || !/return\s+404\s+"not found\\n"\s*;/.test(staticNotFound)
  ) {
    issues.push(issue(
      "NGINX_STATIC_ERROR_POLICY",
      "static misses must use the generic response without internal details",
      NGINX_RELATIVE,
    ));
  }

  const fallback = blockStartingAt(nginx, "location / ");
  if (
    fallback === ""
    || !/try_files\s+\/index\.html\s+@static_not_found\s*;/.test(fallback)
    || /try_files\s+\$uri/.test(fallback)
  ) {
    issues.push(issue(
      "NGINX_SPA_FALLBACK_POLICY",
      "SPA routes must fall back only to index.html and never expose arbitrary root files",
      NGINX_RELATIVE,
    ));
  }

  const dottedStatic = blockStartingAt(
    nginx,
    "location ~ ^/.+\\.[^/]+$",
  );
  const assetAllowlistOffset = nginx.indexOf("location ~* ^/assets/");
  const dottedStaticOffset = nginx.indexOf("location ~ ^/.+\\.[^/]+$");
  if (
    dottedStatic === ""
    || assetAllowlistOffset < 0
    || dottedStaticOffset < assetAllowlistOffset
    || !/return\s+404\s+"not found\\n"\s*;/.test(dottedStatic)
  ) {
    issues.push(issue(
      "NGINX_DOTTED_STATIC_POLICY",
      "every non-API request whose final path segment has an extension must fail closed unless explicitly served",
      NGINX_RELATIVE,
    ));
  }

  const deniedBasenames =
    "location ~* (?:^|/)(?:dockerfile|license|nginx\\.conf|package-lock\\.json|package\\.json|settings\\.(?:js|json))$";
  if (!nginx.includes(deniedBasenames)) {
    issues.push(issue(
      "NGINX_SENSITIVE_NAME_POLICY",
      "source, map, configuration, credential, and backup filenames must fail closed",
      NGINX_RELATIVE,
    ));
  }
}

export function inspectFrontendBuildSecurity(repositoryRoot) {
  const root = validateRoot(repositoryRoot);
  const buildRoot = lockedPath(root, BUILD_RELATIVE, "directory");
  const nginxPath = lockedPath(root, NGINX_RELATIVE, "file");
  const issues = [];
  const { files, totalBytes } = walkBuild(buildRoot, issues);
  inspectArtifactNames(files, issues);

  const text = new Map();
  for (const [relative, metadata] of files) {
    const extension = path.posix.extname(relative).toLowerCase();
    if (!TEXT_EXTENSIONS.has(extension) || metadata.size > MAX_FILE_BYTES) continue;
    const content = decodeText(fs.readFileSync(metadata.absolute), relative, issues);
    if (content === null) continue;
    text.set(relative, content);
    inspectContent(relative, content, issues);
  }
  const dependencyConstant = inspectAcceptedDependencyConstant(root, text, issues);
  const references = inspectReferenceGraph(files, text, issues);
  const nginx = fs.readFileSync(nginxPath, "utf8");
  inspectNginxPolicy(nginx, issues);

  return {
    root,
    issues: sortedUnique(issues),
    summary: {
      files: files.size,
      bytes: totalBytes,
      textFiles: text.size,
      references,
      nginxFiles: 1,
      sourceFiles: dependencyConstant.sourceFiles,
      acceptedDependencyConstants: dependencyConstant.accepted,
      skipped: 0,
    },
  };
}

export function runFrontendBuildSecurityGate(repositoryRoot) {
  const result = inspectFrontendBuildSecurity(repositoryRoot);
  if (result.issues.length > 0) {
    throw new FrontendBuildSecurityGateError(result.issues);
  }
  return result;
}

function printFailure(error) {
  const issues = error instanceof FrontendBuildSecurityGateError
    ? error.issues
    : [issue(
      "GATE_INTERNAL_ERROR",
      "the frontend build security gate could not complete",
    )];
  process.stderr.write([
    "FAIL frontend build security gate",
    ...issues.map((value) =>
      `[${value.code}] ${value.message}${value.file ? ` (${value.file})` : ""}`),
    "skipped=0",
  ].join("\n") + "\n");
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(SCRIPT_PATH);
if (invokedDirectly) {
  if (process.argv.length !== 2) {
    printFailure(new FrontendBuildSecurityGateError([
      issue(
        "EXTERNAL_INPUT_REJECTED",
        "the gate accepts no path, URL, environment, credential, or other input",
      ),
    ]));
    process.exitCode = 2;
  } else {
    try {
      const result = runFrontendBuildSecurityGate(LOCKED_REPOSITORY_ROOT);
      process.stdout.write([
        "PASS frontend build security gate",
        `files=${result.summary.files}`,
        `bytes=${result.summary.bytes}`,
        `text_files=${result.summary.textFiles}`,
        `references=${result.summary.references}`,
        `nginx_files=${result.summary.nginxFiles}`,
        `source_files=${result.summary.sourceFiles}`,
        `accepted_dependency_constants=${result.summary.acceptedDependencyConstants}`,
        "skipped=0",
      ].join("\n") + "\n");
    } catch (error) {
      printFailure(error);
      process.exitCode = error instanceof FrontendBuildSecurityGateError ? 1 : 2;
    }
  }
}
