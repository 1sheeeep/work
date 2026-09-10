import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIRECTORY = path.dirname(SCRIPT_PATH);
const LOCKED_REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..", "..");
const PERMISSION_CODE =
  /^[a-z][a-z0-9_]*(?:(?::|\.)[a-z][a-z0-9_-]*)+$/;
const PERMISSION_REFERENCE_LITERAL =
  /^[a-z][a-z0-9_]*(?:(?::|\.)[a-z][a-z0-9_-]*)*(?::|\.)(?:read|write|assign|claim|reply|transfer|close|manage|adjust|post|reverse|approve|configure)$/;
const SOURCE_EXTENSIONS = new Set([".java", ".sql", ".ts", ".tsx"]);

export class PermissionGateError extends Error {
  constructor(issues) {
    super(issues.map((issue) => `[${issue.code}] ${issue.message}`).join("\n"));
    this.name = "PermissionGateError";
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
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function validateTree(root) {
  const resolved = path.resolve(root);
  if (!fs.existsSync(resolved)) {
    throw new PermissionGateError([
      issue("REPOSITORY_ROOT_MISSING", "repository root does not exist"),
    ]);
  }
  const realRoot = fs.realpathSync.native(resolved);
  if (realRoot !== resolved) {
    throw new PermissionGateError([
      issue(
        "REPOSITORY_ROOT_ALIAS",
        "repository root must be its canonical absolute path",
      ),
    ]);
  }
  for (const required of [
    "platform/backend/src/main",
    "platform/frontend/src",
  ]) {
    const target = path.resolve(realRoot, required);
    if (!isWithin(realRoot, target) || !fs.existsSync(target)) {
      throw new PermissionGateError([
        issue(
          "REPOSITORY_LAYOUT_INVALID",
          `required repository path is missing: ${required}`,
        ),
      ]);
    }
    const realTarget = fs.realpathSync.native(target);
    if (!isWithin(realRoot, realTarget) || realTarget !== target) {
      throw new PermissionGateError([
        issue(
          "SOURCE_PATH_ESCAPE",
          `required source path is aliased or leaves the repository: ${required}`,
        ),
      ]);
    }
  }
  return realRoot;
}

function walkSourceFiles(root, relativeDirectory) {
  const start = path.resolve(root, relativeDirectory);
  const files = [];
  const visit = (directory) => {
    const entries = fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (!isWithin(root, absolute)) {
        throw new PermissionGateError([
          issue("SOURCE_PATH_ESCAPE", "source traversal left the repository"),
        ]);
      }
      const metadata = fs.lstatSync(absolute);
      const relative = slash(path.relative(root, absolute));
      if (metadata.isSymbolicLink()) {
        throw new PermissionGateError([
          issue(
            "SOURCE_SYMLINK_REJECTED",
            `symbolic links are not accepted in scanned source: ${relative}`,
          ),
        ]);
      }
      if (metadata.isDirectory()) {
        visit(absolute);
      } else if (
        metadata.isFile() &&
        SOURCE_EXTENSIONS.has(path.extname(entry.name))
      ) {
        files.push({
          absolute,
          relative,
          content: fs.readFileSync(absolute, "utf8"),
        });
      }
    }
  };
  visit(start);
  return files;
}

function splitSqlTuples(values) {
  const tuples = [];
  let start = -1;
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < values.length; index += 1) {
    const character = values[index];
    if (character === "'") {
      if (quoted && values[index + 1] === "'") {
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (quoted) continue;
    if (character === "(") {
      if (depth === 0) start = index + 1;
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        tuples.push(values.slice(start, index));
        start = -1;
      }
    }
  }
  return tuples;
}

function splitSqlFields(tuple) {
  const fields = [];
  let start = 0;
  let quoted = false;
  for (let index = 0; index < tuple.length; index += 1) {
    const character = tuple[index];
    if (character === "'") {
      if (quoted && tuple[index + 1] === "'") {
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      fields.push(tuple.slice(start, index).trim());
      start = index + 1;
    }
  }
  fields.push(tuple.slice(start).trim());
  return fields;
}

function unquoteSql(value) {
  const match = value.match(/^'((?:''|[^'])*)'$/s);
  return match ? match[1].replaceAll("''", "'") : null;
}

function extractCatalog(sqlFiles, issues) {
  const codes = new Set();
  let inserts = 0;
  const migrations = [...sqlFiles].sort((left, right) => {
    const leftMatch = path.basename(left.relative).match(/^V(\d+)__/);
    const rightMatch = path.basename(right.relative).match(/^V(\d+)__/);
    const leftVersion = leftMatch ? Number(leftMatch[1]) : Number.MAX_SAFE_INTEGER;
    const rightVersion = rightMatch
      ? Number(rightMatch[1])
      : Number.MAX_SAFE_INTEGER;
    return (
      leftVersion - rightVersion ||
      left.relative.localeCompare(right.relative, "en")
    );
  });
  for (const file of migrations) {
    const mutations = [];
    const insertPattern =
      /INSERT\s+INTO\s+permissions\s*\(([^)]*)\)\s*VALUES\s*([\s\S]*?)(?=ON\s+CONFLICT|;)/gi;
    for (const match of file.content.matchAll(insertPattern)) {
      inserts += 1;
      const columns = match[1]
        .split(",")
        .map((column) => column.trim().toLowerCase());
      const codeIndex = columns.indexOf("code");
      if (codeIndex < 0) {
        issues.push(
          issue(
            "CATALOG_INSERT_UNRESOLVED",
            `${file.relative} inserts permissions without a code column`,
          ),
        );
        continue;
      }
      const insertedCodes = [];
      for (const tuple of splitSqlTuples(match[2])) {
        const fields = splitSqlFields(tuple);
        const code = unquoteSql(fields[codeIndex] ?? "");
        if (!code || !PERMISSION_CODE.test(code)) {
          issues.push(
            issue(
              "CATALOG_CODE_INVALID",
              `${file.relative} contains an invalid or dynamic permission code`,
            ),
          );
        } else {
          insertedCodes.push(code);
        }
      }
      mutations.push({
        index: match.index,
        type: "insert",
        codes: insertedCodes,
      });
    }

    const deletePattern =
      /DELETE\s+FROM\s+permissions\s+WHERE\s+([\s\S]*?);/gi;
    for (const match of file.content.matchAll(deletePattern)) {
      const predicate = match[1].trim();
      const inMatch = predicate.match(/^code\s+IN\s*\(([\s\S]*)\)$/i);
      const equalsMatch = predicate.match(
        /^code\s*=\s*('(?:''|[^'])*')$/i,
      );
      const values = inMatch?.[1] ?? equalsMatch?.[1];
      if (!values) {
        issues.push(
          issue(
            "CATALOG_DELETE_UNRESOLVED",
            `${file.relative} deletes permissions with a dynamic predicate`,
          ),
        );
        continue;
      }
      const deletedCodes = [...values.matchAll(/'((?:''|[^'])*)'/g)].map(
        (value) => value[1].replaceAll("''", "'"),
      );
      if (
        deletedCodes.length === 0 ||
        deletedCodes.some((code) => !PERMISSION_CODE.test(code))
      ) {
        issues.push(
          issue(
            "CATALOG_DELETE_UNRESOLVED",
            `${file.relative} deletes permissions without a static valid code list`,
          ),
        );
        continue;
      }
      mutations.push({
        index: match.index,
        type: "delete",
        codes: deletedCodes,
      });
    }

    for (const mutation of mutations.sort((left, right) =>
      left.index - right.index,
    )) {
      for (const code of mutation.codes) {
        if (mutation.type === "insert") {
          codes.add(code);
        } else {
          codes.delete(code);
        }
      }
    }
  }
  if (inserts === 0 || codes.size === 0) {
    issues.push(
      issue(
        "CATALOG_EMPTY",
        "no formal permission catalog entries were found in Flyway migrations",
      ),
    );
  }
  return codes;
}

function validateTenantAdminGrantContract(javaFiles, catalog, issues) {
  const contract = javaFiles.find((file) =>
    file.relative.endsWith(
      "/iam/bootstrap/TenantAdminPermissionCodes.java",
    ),
  );
  if (!contract) {
    issues.push(
      issue(
        "TENANT_ADMIN_GRANT_CONTRACT_MISSING",
        "the explicit tenant_admin bootstrap grant contract was not found",
      ),
    );
    return;
  }

  const declaration = contract.content.match(
    /EXACT_CODES\s*=\s*List\.of\(([\s\S]*?)\);/,
  );
  if (!declaration) {
    issues.push(
      issue(
        "TENANT_ADMIN_GRANT_CONTRACT_UNRESOLVED",
        `${contract.relative} does not contain a statically verifiable EXACT_CODES list`,
      ),
    );
    return;
  }

  const entries = [...declaration[1].matchAll(/"([a-z][a-z0-9_.:-]+)"/g)].map(
    (match) => match[1],
  );
  const grants = new Set(entries);
  if (grants.size !== entries.length) {
    issues.push(
      issue(
        "TENANT_ADMIN_PERMISSION_DUPLICATE",
        `${contract.relative} contains duplicate tenant_admin permissions`,
      ),
    );
  }
  for (const code of [...catalog].sort((left, right) =>
    left.localeCompare(right, "en"),
  )) {
    if (!grants.has(code)) {
      issues.push(
        issue(
          "TENANT_ADMIN_PERMISSION_MISSING",
          `tenant_admin bootstrap contract is missing catalog permission ${code}`,
        ),
      );
    }
  }
  for (const code of [...grants].sort((left, right) =>
    left.localeCompare(right, "en"),
  )) {
    if (!catalog.has(code)) {
      issues.push(
        issue(
          "TENANT_ADMIN_PERMISSION_UNKNOWN",
          `tenant_admin bootstrap contract contains unknown permission ${code}`,
        ),
      );
    }
  }
}

function quotedPermissionOccurrences(files) {
  const occurrences = [];
  const pattern = /(["'])([a-z][a-z0-9_-]*(?:(?::|\.)[a-z0-9_-]+)+)\1/g;
  for (const file of files) {
    for (const match of file.content.matchAll(pattern)) {
      const lineStart = file.content.lastIndexOf("\n", match.index) + 1;
      const lineEnd = file.content.indexOf("\n", match.index);
      const sourceLine = file.content.slice(
        lineStart,
        lineEnd < 0 ? undefined : lineEnd,
      );
      const explicitPermissionSink =
        /\b(?:hasPermission|can)\s*\(|requiredPermission\s*:/.test(
          sourceLine,
        );
      const auditActionLiteral =
        file.relative.endsWith("AuditActions.java") &&
        !explicitPermissionSink;
      if (
        auditActionLiteral ||
        !PERMISSION_REFERENCE_LITERAL.test(match[2]) &&
        !explicitPermissionSink
      ) {
        continue;
      }
      const line = file.content.slice(0, match.index).split(/\r?\n/).length;
      occurrences.push({
        code: match[2],
        file: file.relative,
        line,
      });
    }
  }
  return occurrences;
}

function internalAuthorityCatalog(javaFiles, catalog, issues) {
  const authorities = new Set();
  for (const file of javaFiles.filter((candidate) =>
    candidate.relative.endsWith("AuthenticationFilter.java"),
  )) {
    if (
      !/extends\s+OncePerRequestFilter/.test(file.content) ||
      !/\/api\/v1\/internal\//.test(file.content)
    ) {
      continue;
    }
    for (const match of file.content.matchAll(
      /public\s+static\s+final\s+String\s+([A-Z][A-Z0-9_]*)\s*=\s*"(internal\.[a-z0-9_.-]+)"\s*;/g,
    )) {
      const symbol = match[1];
      const code = match[2];
      const authorityUse = new RegExp(
        `new\\s+SimpleGrantedAuthority\\(\\s*${symbol}\\s*\\)`,
      );
      if (!authorityUse.test(file.content)) continue;
      authorities.add(code);
      if (catalog.has(code)) {
        issues.push(
          issue(
            "INTERNAL_AUTHORITY_CATALOGED",
            `${file.relative} internal authority ${code} must not be assignable to enterprise roles`,
          ),
        );
      }
    }
  }
  return authorities;
}

function javaConstants(javaFiles) {
  const constants = new Map();
  for (const file of javaFiles) {
    const className = path.basename(file.absolute, ".java");
    const pattern =
      /public\s+static\s+final\s+String\s+([A-Z][A-Z0-9_]*)\s*=\s*"([^"]+)"\s*;/g;
    for (const match of file.content.matchAll(pattern)) {
      constants.set(`${className}.${match[1]}`, match[2]);
    }
  }
  return constants;
}

function extractBackendAuthorities(javaFiles, catalog, issues) {
  const constants = javaConstants(javaFiles);
  const internalAuthorities = internalAuthorityCatalog(
    javaFiles,
    catalog,
    issues,
  );
  const authorities = [];
  let endpointMappings = 0;
  for (const file of javaFiles.filter((candidate) =>
    candidate.relative.endsWith("Controller.java"),
  )) {
    endpointMappings += [
      ...file.content.matchAll(
        /@(Get|Post|Put|Patch|Delete|Request)Mapping(?:\s*\([^)]*\))?/g,
      ),
    ].length;
    const requiresMethodPermission =
      file.relative.includes("/api/") ||
      (file.relative.includes("/iam/web/") &&
        file.relative.endsWith("AdminController.java"));
    if (requiresMethodPermission) {
      const classDeclaration = file.content.search(
        /\bpublic\s+class\s+[A-Za-z0-9_]+Controller\b/,
      );
      const classAnnotations =
        classDeclaration < 0 ? "" : file.content.slice(0, classDeclaration);
      const classProtected = /@PreAuthorize\(/.test(classAnnotations);
      for (const mapping of file.content.matchAll(
        /@(Get|Post|Put|Patch|Delete)Mapping(?:\s*\([^)]*\))?/g,
      )) {
        const methodStart = file.content.indexOf("public ", mapping.index);
        const annotationStart = file.content.lastIndexOf(
          "\n\n",
          mapping.index,
        );
        const annotationBlock = file.content.slice(
          annotationStart < 0 ? 0 : annotationStart,
          methodStart < 0 ? mapping.index : methodStart,
        );
        if (!classProtected && !/@PreAuthorize\(/.test(annotationBlock)) {
          const line = file.content
            .slice(0, mapping.index)
            .split(/\r?\n/).length;
          issues.push(
            issue(
              "BACKEND_ENDPOINT_GUARD_MISSING",
              `${file.relative}:${line} business endpoint has no explicit @PreAuthorize guard`,
            ),
          );
        }
      }
    }
    for (const match of file.content.matchAll(/@PreAuthorize\((.+)\)/g)) {
      const expression = match[1];
      const found = new Set();
      for (const invocation of expression.matchAll(
        /has(?:Any)?Authority\(([^)]*)\)/g,
      )) {
        for (const literal of invocation[1].matchAll(
          /'([a-z][a-z0-9_.:-]+)'/g,
        )) {
          found.add(literal[1]);
        }
      }
      for (const reference of expression.matchAll(
        /([A-Z][A-Za-z0-9]*PermissionCodes\.[A-Z][A-Z0-9_]*)/g,
      )) {
        const value = constants.get(reference[1]);
        if (value) found.add(value);
      }
      if (found.size === 0) {
        issues.push(
          issue(
            "BACKEND_AUTHORITY_UNRESOLVED",
            `${file.relative} has a @PreAuthorize expression the gate cannot resolve`,
          ),
        );
      }
      for (const code of found) {
        authorities.push({ code, file: file.relative });
        if (!catalog.has(code) && !internalAuthorities.has(code)) {
          issues.push(
            issue(
              "BACKEND_PERMISSION_NOT_CATALOGED",
              `${file.relative} protects an endpoint with unknown permission ${code}`,
            ),
          );
        }
      }
    }
  }
  for (const occurrence of quotedPermissionOccurrences(javaFiles)) {
    if (!catalog.has(occurrence.code)) {
      issues.push(
        issue(
          "BACKEND_PERMISSION_NOT_CATALOGED",
          `${occurrence.file}:${occurrence.line} references unknown permission ${occurrence.code}`,
        ),
      );
    }
  }
  for (const file of javaFiles.filter((candidate) =>
    candidate.relative.endsWith("PermissionCodes.java"),
  )) {
    for (const match of file.content.matchAll(
      /"([a-z][a-z0-9_-]*(?:(?::|\.)[a-z0-9_-]+)+)"/g,
    )) {
      if (!catalog.has(match[1])) {
        issues.push(
          issue(
            "BACKEND_PERMISSION_NOT_CATALOGED",
            `${file.relative} declares unknown permission ${match[1]}`,
          ),
        );
      }
    }
  }
  return { authorities, endpointMappings };
}

function requirePattern(content, pattern, code, message, issues) {
  if (!pattern.test(content)) issues.push(issue(code, message));
}

function extractMethod(content, methodName, nextMethodName = null) {
  const start = content.indexOf(methodName);
  if (start < 0) return "";
  const end = nextMethodName ? content.indexOf(nextMethodName, start + 1) : -1;
  return content.slice(start, end < 0 ? undefined : end);
}

function validateTrustDomains(javaFiles, catalog, issues) {
  const bySuffix = (suffix) =>
    javaFiles.find((file) => file.relative.endsWith(suffix))?.content ?? "";
  const security = bySuffix("/config/SecurityConfig.java");
  const filter = bySuffix(
    "/iam/security/BearerTokenAuthenticationFilter.java",
  );
  const service = bySuffix(
    "/platformadmin/application/PlatformTenantSessionService.java",
  );
  const authorities = bySuffix(
    "/platformadmin/security/PlatformAdminAuthorities.java",
  );

  requirePattern(
    security,
    /HttpMethod\.DELETE,\s*"\/api\/v1\/platform-admin\/tenant-session"[\s\S]{0,160}\.hasAuthority\(PlatformAdminAuthorities\.TENANT_SESSION\)/,
    "TRUST_TENANT_EXIT_BOUNDARY",
    "platform tenant-session exit must require TENANT_SESSION",
    issues,
  );
  requirePattern(
    security,
    /\.requestMatchers\("\/api\/v1\/platform-admin\/\*\*"\)\s*\.hasAuthority\(PlatformAdminAuthorities\.SYSTEM_ADMIN\)/,
    "TRUST_PLATFORM_BOUNDARY",
    "platform-admin routes must require SYSTEM_ADMIN",
    issues,
  );
  requirePattern(
    security,
    /\.anyRequest\(\)[\s\S]*?SYSTEM_ADMIN[\s\S]*?!platformBaseSession/,
    "TRUST_ENTERPRISE_BOUNDARY",
    "the enterprise request boundary must reject a base SYSTEM_ADMIN session",
    issues,
  );

  const baseBlock = extractMethod(
    filter,
    "private boolean authenticatePlatformSession(",
    "private void authenticatePlatformTenantSession(",
  );
  const tenantBlock = extractMethod(
    filter,
    "private void authenticatePlatformTenantSession(",
  );
  requirePattern(
    baseBlock,
    /PlatformAdminAuthorities\.SYSTEM_ADMIN/,
    "TRUST_BASE_AUTHORITY_MISSING",
    "base platform sessions must carry SYSTEM_ADMIN",
    issues,
  );
  if (
    /findAllCodes|PlatformAdminAuthorities\.TENANT_SESSION/.test(baseBlock)
  ) {
    issues.push(
      issue(
        "TRUST_DOMAIN_MIXED",
        "base SYSTEM_ADMIN sessions must not receive enterprise permissions or TENANT_SESSION",
      ),
    );
  }
  requirePattern(
    tenantBlock,
    /permissionRepository\s*\.\s*findAllCodes\(\)/,
    "TRUST_TENANT_ALL_PERMISSIONS_MISSING",
    "entered platform tenant sessions must load the formal permission catalog",
    issues,
  );
  requirePattern(
    tenantBlock,
    /PlatformAdminAuthorities\.TENANT_SESSION/,
    "TRUST_TENANT_AUTHORITY_MISSING",
    "entered platform tenant sessions must carry TENANT_SESSION",
    issues,
  );
  if (/PlatformAdminAuthorities\.SYSTEM_ADMIN/.test(tenantBlock)) {
    issues.push(
      issue(
        "TRUST_DOMAIN_MIXED",
        "entered enterprise sessions must not retain SYSTEM_ADMIN",
      ),
    );
  }
  requirePattern(
    service,
    /enter\([\s\S]*?permissionRepository\.findAllCodes\(\)[\s\S]*?EnteredTenantSession/,
    "TRUST_ENTER_RESPONSE_INCOMPLETE",
    "tenant entry response must expose all formal business permissions",
    issues,
  );

  const authorityValues = [
    ...authorities.matchAll(
      /public\s+static\s+final\s+String\s+[A-Z_]+\s*=\s*"([^"]+)"/g,
    ),
  ].map((match) => match[1]);
  for (const value of authorityValues) {
    if (catalog.has(value) || PERMISSION_CODE.test(value)) {
      issues.push(
        issue(
          "TRUST_DOMAIN_MIXED",
          `platform authority ${value} must not be a business permission`,
        ),
      );
    }
  }
}

function balancedObjects(content, arrayStart) {
  const objects = [];
  let quoted = null;
  let escaped = false;
  let depth = 0;
  let start = -1;
  for (let index = arrayStart; index < content.length; index += 1) {
    const character = content[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quoted) quoted = null;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quoted = character;
      continue;
    }
    if (character === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        objects.push(content.slice(start, index + 1));
        start = -1;
      }
    } else if (character === "]" && depth === 0) {
      break;
    }
  }
  return objects;
}

function balancedBlockAt(content, start) {
  let quoted = null;
  let escaped = false;
  let depth = 0;
  for (let index = start; index < content.length; index += 1) {
    const character = content[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quoted) quoted = null;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quoted = character;
      continue;
    }
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return content.slice(start, index + 1);
    }
  }
  return "";
}

function createRouteBlocks(content) {
  const blocks = [];
  for (const match of content.matchAll(
    /const\s+([A-Za-z0-9_]+Route)\s*=\s*createRoute\s*\(\s*/g,
  )) {
    const start = content.indexOf("{", match.index + match[0].length);
    const block = start < 0 ? "" : balancedBlockAt(content, start);
    if (block) blocks.push({ name: match[1], content: block });
  }
  return blocks;
}

function field(object, name) {
  return object.match(
    new RegExp(`${name}\\s*:\\s*["']([^"']+)["']`),
  )?.[1];
}

function parseModules(content, issues) {
  const marker = "export const moduleDefinitions";
  const markerIndex = content.indexOf(marker);
  const assignment = content.indexOf("=", markerIndex);
  const arrayStart = content.indexOf("[", assignment);
  if (markerIndex < 0 || arrayStart < 0) {
    issues.push(
      issue(
        "FRONTEND_MODULES_UNRESOLVED",
        "moduleDefinitions array was not found",
      ),
    );
    return [];
  }
  const modules = balancedObjects(content, arrayStart).map((object) => ({
    id: field(object, "id"),
    path: field(object, "path"),
    status: field(object, "status"),
    apiNamespace: field(object, "apiNamespace"),
    requiredPermission: field(object, "requiredPermission"),
  }));
  for (const module of modules) {
    if (Object.values(module).some((value) => !value)) {
      issues.push(
        issue(
          "FRONTEND_MODULE_UNRESOLVED",
          "every module must expose id, path, status, apiNamespace and requiredPermission",
        ),
      );
    }
  }
  return modules;
}

function permissionSetFromArray(content, declaration) {
  const match = content.match(
    new RegExp(
      `(?:const\\s+${declaration}\\s*=|\\{\\s*)\\s*\\[([\\s\\S]*?)\\](?:\\s*as\\s+const)?`,
    ),
  );
  if (!match) return null;
  return new Set(
    [...match[1].matchAll(/["']([^"']+)["']/g)]
      .map((entry) => entry[1])
      .filter((value) => PERMISSION_CODE.test(value)),
  );
}

function sameSet(left, right) {
  return (
    left.size === right.size && [...left].every((value) => right.has(value))
  );
}

function validateFrontend(frontendFiles, backendFiles, catalog, issues) {
  const get = (suffix) =>
    frontendFiles.find((file) => file.relative.endsWith(suffix))?.content ?? "";
  const app = get("/frontend/src/App.tsx");
  const shell = get("/frontend/src/components/AppShell.tsx");
  const access = get("/frontend/src/modules/moduleAccess.ts");
  const definitions = get("/frontend/src/modules/moduleDefinitions.ts");
  const navigation = get(
    "/frontend/src/modules/navigationDefinitions.ts",
  );
  const iamPage = get("/frontend/src/pages/IamConsolePage.tsx");
  const modules = parseModules(definitions, issues);
  const specializedIds = new Set(
    [...app.matchAll(/module\.id\s*===\s*["']([^"']+)["']\s*\?/g)].map(
      (match) => match[1],
    ),
  );
  const genericFallback =
    /:\s*\(\s*<LazyModulePage\s+module=\{module\}\s*\/>\s*\)/.test(app);
  const dynamicGuard =
    /function\s+createModuleRoute[\s\S]*?<ModuleAccessGate\s+module=\{module\}>[\s\S]*?moduleDefinitions\.map\(createModuleRoute\)/.test(
      app,
    );
  if (!genericFallback) {
    issues.push(
      issue(
        "PLACEHOLDER_FALLBACK_MISSING",
        "dynamic module routes must retain the generic ModulePage fallback",
      ),
    );
  }
  if (!dynamicGuard) {
    issues.push(
      issue(
        "ROUTE_GUARD_MISSING",
        "every dynamic module route must be wrapped by ModuleAccessGate",
      ),
    );
  }
  requirePattern(
    access,
    /return\s+hasPermission\(module\.requiredPermission\)/,
    "ROUTE_GUARD_NOT_FAIL_CLOSED",
    "ModuleAccessGate must decide access from the exact requiredPermission",
    issues,
  );
  requirePattern(
    shell,
    /getAccessibleTenantNavigation\(\s*hasPermission\s*,?\s*\)/,
    "MENU_GUARD_MISSING",
    "tenant navigation must be derived from permission-filtered navigation definitions",
    issues,
  );
  requirePattern(
    shell,
    /navigation[\s\S]*?\.map\(\(item\)\s*=>/,
    "MENU_GUARD_MISSING",
    "primary menu entries must come only from accessible tenant navigation",
    issues,
  );

  const iamReads = permissionSetFromArray(iamPage, "READ_PERMISSIONS");
  const iamMenuReads = permissionSetFromArray(
    navigation,
    "iamReadPermissions",
  );
  if (!iamReads || !iamMenuReads || !sameSet(iamReads, iamMenuReads)) {
    issues.push(
      issue(
        "IAM_MENU_PAGE_GUARD_DRIFT",
        "IAM menu visibility and page read permissions must be the same source facts",
      ),
    );
  }
  requirePattern(
    navigation,
    /to:\s*["']\/settings\/iam["'][\s\S]{0,160}permissions:\s*iamReadPermissions/,
    "IAM_MENU_PAGE_GUARD_DRIFT",
    "IAM navigation entry must use the shared IAM read-permission set",
    issues,
  );
  requirePattern(
    iamPage,
    /const\s+any\s*=\s*READ_PERMISSIONS\.some\(can\)[\s\S]*?if\s*\(!any\)[\s\S]*?403(?:\s+FORBIDDEN|\s+无权访问)/,
    "IAM_DIRECT_ROUTE_GUARD_MISSING",
    "the IAM page must fail closed with 403 when no IAM read permission is present",
    issues,
  );
  requirePattern(
    app,
    /path:\s*["']settings\/iam["'][\s\S]{0,180}component:\s*LazyIamConsolePage/,
    "IAM_ROUTE_MISSING",
    "the checked IAM page must remain the /settings/iam route component",
    issues,
  );
  for (const route of createRouteBlocks(app)) {
    if (!/getParentRoute:\s*\(\)\s*=>\s*appShellRoute/.test(route.content)) {
      continue;
    }
    const routePath = route.content.match(/path:\s*["']([^"']+)["']/)?.[1];
    if (
      !routePath ||
      routePath === "/" ||
      routePath === "settings/iam"
    ) {
      continue;
    }
    if (!/<ModuleAccessGate\s+module=\{[A-Za-z0-9_]+\}>/.test(route.content)) {
      issues.push(
        issue(
          "ROUTE_GUARD_MISSING",
          `${route.name} (${routePath}) is reachable by direct URL without ModuleAccessGate`,
        ),
      );
    }
  }

  const occurrences = quotedPermissionOccurrences(frontendFiles);
  const byCode = new Map();
  for (const occurrence of occurrences) {
    const values = byCode.get(occurrence.code) ?? [];
    values.push(occurrence);
    byCode.set(occurrence.code, values);
  }
  const placeholderExceptions = [];
  for (const [code, values] of [...byCode.entries()].sort(([left], [right]) =>
    left.localeCompare(right, "en"),
  )) {
    if (catalog.has(code)) continue;
    const candidates = modules.filter(
      (module) => module.requiredPermission === code,
    );
    const onlyDefinition =
      values.length === 1 &&
      values[0].file.endsWith("/frontend/src/modules/moduleDefinitions.ts");
    const module = candidates.length === 1 ? candidates[0] : null;
    const placeholderStatus =
      module?.status === "planned" || module?.status === "integration";
    const noDedicatedPage = module && !specializedIds.has(module.id);
    const noApiClient =
      module &&
      !frontendFiles
        .filter(
          (file) =>
            !file.relative.endsWith("/modules/moduleDefinitions.ts") &&
            /Api\.ts$/.test(file.relative),
        )
        .some(
          (file) =>
            file.content.includes(module.apiNamespace) ||
            file.content.includes(code),
        );
    const noBackendEndpoint =
      module &&
      !backendFiles.some(
        (file) =>
          file.content.includes(module.apiNamespace) ||
          file.content.includes(code),
      );
    if (
      onlyDefinition &&
      placeholderStatus &&
      noDedicatedPage &&
      genericFallback &&
      dynamicGuard &&
      noApiClient &&
      noBackendEndpoint
    ) {
      placeholderExceptions.push(module.id);
      continue;
    }
    issues.push(
      issue(
        "FRONTEND_PERMISSION_NOT_CATALOGED",
        `${values[0].file}:${values[0].line} references unknown permission ${code} outside the fail-closed placeholder contract`,
      ),
    );
  }
  return {
    modules,
    occurrences,
    placeholderExceptions: placeholderExceptions.sort((left, right) =>
      left.localeCompare(right, "en"),
    ),
  };
}

function deduplicateIssues(issues) {
  const unique = new Map();
  for (const value of issues) {
    unique.set(`${value.code}\0${value.message}`, value);
  }
  return [...unique.values()].sort((left, right) => {
    const codeOrder = left.code.localeCompare(right.code, "en");
    return codeOrder || left.message.localeCompare(right.message, "en");
  });
}

export function inspectPermissionConsistency(repositoryRoot) {
  const root = validateTree(repositoryRoot);
  const backendFiles = walkSourceFiles(root, "platform/backend/src/main");
  const frontendFiles = walkSourceFiles(root, "platform/frontend/src").filter(
    (file) => !/\.test\.[^.]+$/.test(file.relative),
  );
  const sqlFiles = backendFiles.filter((file) => file.relative.endsWith(".sql"));
  const javaFiles = backendFiles.filter((file) =>
    file.relative.endsWith(".java"),
  );
  const issues = [];
  const catalog = extractCatalog(sqlFiles, issues);
  validateTenantAdminGrantContract(javaFiles, catalog, issues);
  const backend = extractBackendAuthorities(javaFiles, catalog, issues);
  validateTrustDomains(javaFiles, catalog, issues);
  const frontend = validateFrontend(
    frontendFiles,
    backendFiles,
    catalog,
    issues,
  );
  return {
    root,
    issues: deduplicateIssues(issues),
    summary: {
      catalogPermissions: catalog.size,
      backendEndpointMappings: backend.endpointMappings,
      backendPermissionChecks: backend.authorities.length,
      frontendPermissionReferences: frontend.occurrences.length,
      moduleRoutes: frontend.modules.length,
      failClosedPlaceholders: frontend.placeholderExceptions.length,
    },
    placeholderModules: frontend.placeholderExceptions,
  };
}

export function runPermissionConsistencyGate(repositoryRoot) {
  const result = inspectPermissionConsistency(repositoryRoot);
  if (result.issues.length > 0) {
    throw new PermissionGateError(result.issues);
  }
  return result;
}

function printSuccess(result) {
  const summary = result.summary;
  process.stdout.write(
    [
      "PASS permission consistency gate",
      `catalog_permissions=${summary.catalogPermissions}`,
      `backend_endpoint_mappings=${summary.backendEndpointMappings}`,
      `backend_permission_checks=${summary.backendPermissionChecks}`,
      `frontend_permission_references=${summary.frontendPermissionReferences}`,
      `module_routes=${summary.moduleRoutes}`,
      `fail_closed_placeholders=${summary.failClosedPlaceholders}`,
      "skipped=0",
    ].join("\n") + "\n",
  );
}

function printFailure(error) {
  const issues =
    error instanceof PermissionGateError
      ? error.issues
      : [issue("GATE_INTERNAL_ERROR", "permission gate could not complete")];
  process.stderr.write(
    [
      "FAIL permission consistency gate",
      ...issues.map((value) => `[${value.code}] ${value.message}`),
      "skipped=0",
    ].join("\n") + "\n",
  );
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(SCRIPT_PATH);
if (invokedDirectly) {
  if (process.argv.length !== 2) {
    printFailure(
      new PermissionGateError([
        issue(
          "EXTERNAL_INPUT_REJECTED",
          "the gate accepts no path, environment, URL or fixture arguments",
        ),
      ]),
    );
    process.exitCode = 2;
  } else {
    try {
      printSuccess(runPermissionConsistencyGate(LOCKED_REPOSITORY_ROOT));
    } catch (error) {
      printFailure(error);
      process.exitCode = 1;
    }
  }
}
