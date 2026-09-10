import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ApiContractGateError,
  runApiContractGate,
} from "./api-contract-gate.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIRECTORY = path.dirname(SCRIPT_PATH);
const LOCKED_REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..", "..");
const BASELINE_RELATIVE =
  "platform/contracts/audit-coverage-baseline.json";
const JAVA_ROOT_RELATIVE = "platform/backend/src/main/java";
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CLASSIFICATIONS = new Set([
  "tenant-security-event",
  "tenant-iam-success",
  "tenant-business-success",
  "tenant-fail-closed-no-success",
  "platform-security-event",
  "platform-admin-success",
]);
const SENSITIVE_DETAIL =
  /(password|token|credential|jdbc|sql|contact|email|phone|errorSummary|requestBody)/i;

export function isReadOnlyExportEndpoint(endpoint) {
  return endpoint?.method === "POST"
    && typeof endpoint.path === "string"
    && endpoint.path.endsWith("/exports")
    && Array.isArray(endpoint.requiredAuthorities)
    && endpoint.requiredAuthorities.length > 0
    && endpoint.requiredAuthorities.every((authority) =>
      typeof authority === "string" && authority.endsWith(".read")
    );
}

export class AuditCoverageGateError extends Error {
  constructor(issues) {
    super(issues.map((value) => `[${value.code}] ${value.message}`).join("\n"));
    this.name = "AuditCoverageGateError";
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

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => left.localeCompare(right, "en"))
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

function integrity(value) {
  const copy = structuredClone(value);
  delete copy.integritySha256;
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonical(copy)))
    .digest("hex");
}

function readSafeFile(root, relative, issues) {
  if (
    typeof relative !== "string" ||
    relative.length === 0 ||
    path.isAbsolute(relative) ||
    relative.includes("\0") ||
    /(^|[\\/])\.env(?:[\\/]|$)/i.test(relative) ||
    /^[a-z][a-z0-9+.-]*:/i.test(relative)
  ) {
    issues.push(issue("SOURCE_PATH_REJECTED", "a source path is not permitted"));
    return null;
  }
  const target = path.resolve(root, relative);
  if (!isWithin(root, target) || !fs.existsSync(target)) {
    issues.push(
      issue("SOURCE_PATH_REJECTED", `required source is unavailable: ${relative}`),
    );
    return null;
  }
  const metadata = fs.lstatSync(target);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    issues.push(
      issue("SOURCE_SYMLINK_REJECTED", `source must be a regular file: ${relative}`),
    );
    return null;
  }
  const realTarget = fs.realpathSync.native(target);
  if (realTarget !== target || !isWithin(root, realTarget)) {
    issues.push(
      issue("SOURCE_PATH_REJECTED", `source path is aliased: ${relative}`),
    );
    return null;
  }
  return fs.readFileSync(target, "utf8");
}

function walkJava(root, issues) {
  const start = path.resolve(root, JAVA_ROOT_RELATIVE);
  const files = new Map();
  const visit = (directory) => {
    for (const entry of fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, "en"))) {
      const absolute = path.join(directory, entry.name);
      const relative = slash(path.relative(root, absolute));
      const metadata = fs.lstatSync(absolute);
      if (metadata.isSymbolicLink()) {
        issues.push(
          issue(
            "SOURCE_SYMLINK_REJECTED",
            `symbolic source is not accepted: ${relative}`,
          ),
        );
        continue;
      }
      if (metadata.isDirectory()) visit(absolute);
      else if (metadata.isFile() && entry.name.endsWith(".java")) {
        files.set(relative, fs.readFileSync(absolute, "utf8"));
      }
    }
  };
  visit(start);
  return files;
}

function balancedEnd(content, openIndex, open = "(", close = ")") {
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = openIndex; index < content.length; index += 1) {
    const character = content[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === open) depth += 1;
    else if (character === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function javaMethod(content, methodName) {
  const escaped = methodName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(
    `\\b(?:public|protected|private)\\s+(?:static\\s+)?[\\w<>,.?\\[\\] ]+\\s+${escaped}\\s*\\(`,
    "g",
  );
  const match = matcher.exec(content);
  if (!match) return null;
  const openParameters = content.indexOf("(", match.index);
  const closeParameters = balancedEnd(content, openParameters);
  if (closeParameters < 0) return null;
  const openBody = content.indexOf("{", closeParameters);
  if (openBody < 0) return null;
  const closeBody = balancedEnd(content, openBody, "{", "}");
  if (closeBody < 0) return null;
  return {
    body: content.slice(openBody + 1, closeBody),
    declaration: content.slice(
      Math.max(0, match.index - 240),
      openBody,
    ),
  };
}

function auditInvocations(content) {
  const values = [];
  const matcher = /\baudit(?:LineMatch)?\s*\(/g;
  let match;
  while ((match = matcher.exec(content))) {
    const open = content.indexOf("(", match.index);
    const close = balancedEnd(content, open);
    if (close < 0) break;
    values.push(content.slice(match.index, close + 1));
    matcher.lastIndex = close + 1;
  }
  return values;
}

function expectedTrust(classification) {
  if (classification === "tenant-business-success"
      || classification === "tenant-iam-success"
      || classification === "tenant-fail-closed-no-success") {
    return new Set(["tenant"]);
  }
  if (classification === "tenant-security-event") {
    return new Set(["public", "tenant"]);
  }
  if (classification === "platform-admin-success") {
    return new Set(["platform-admin"]);
  }
  return new Set(["public", "platform-admin"]);
}

function validateOperation(
  root,
  operation,
  endpoint,
  javaFiles,
  allJava,
  issues,
) {
  const label = operation.operationId;
  if (!CLASSIFICATIONS.has(operation.classification)) {
    issues.push(issue("CLASSIFICATION_INVALID", `${label}: classification is invalid`));
    return;
  }
  if (!expectedTrust(operation.classification).has(endpoint.trustDomain)) {
    issues.push(
      issue(
        "TRUST_DOMAIN_MISMATCH",
        `${label}: classification does not match endpoint trust domain`,
      ),
    );
  }

  const controller = javaFiles.get(endpoint.source);
  const controllerMethod = controller
    ? javaMethod(controller, label.split("#")[1])
    : null;
  if (!controllerMethod) {
    issues.push(
      issue("CONTROLLER_METHOD_MISSING", `${label}: controller method was not found`),
    );
  } else if (
    !new RegExp(`\\.${operation.controllerCall}\\s*\\(`).test(
      controllerMethod.body,
    )
  ) {
    issues.push(
      issue(
        "CONTROLLER_SERVICE_CALL_MISSING",
        `${label}: approved application-service call was not found`,
      ),
    );
  }

  const evidence = javaFiles.get(operation.evidenceFile);
  if (!evidence) {
    issues.push(
      issue("AUDIT_EVIDENCE_MISSING", `${label}: evidence source was not found`),
    );
    return;
  }
  const evidenceMethod = javaMethod(evidence, operation.evidenceMethod);
  if (!evidenceMethod) {
    issues.push(
      issue("AUDIT_EVIDENCE_MISSING", `${label}: evidence method was not found`),
    );
  }
  if (operation.classification === "tenant-fail-closed-no-success") {
    const reason = operation.failureReason;
    const body = evidenceMethod?.body ?? "";
    const writesOrAudits =
      /\b(?:store|workflowStore|inventoryService|auditRecorder)\s*\./.test(body)
      || /\brecordAtomically\s*\(/.test(body);
    if (
      operation.recorder !== "none"
      || (operation.actions ?? []).length !== 0
      || (operation.resourceTypes ?? []).length !== 0
      || typeof reason !== "string"
      || !/^[a-z][a-z0-9_]{1,63}$/.test(reason)
      || !controllerMethod?.body.includes("actor(principal")
      || !body.includes("requireWriteActor(actor)")
      || !body.includes("throw new ManualMovementConflictException(")
      || !body.includes(`"${reason}"`)
      || writesOrAudits
    ) {
      issues.push(
        issue(
          "FAIL_CLOSED_NO_SUCCESS_EVIDENCE_INVALID",
          `${label}: endpoint must authenticate then throw its reviewed conflict before writes or audit`,
        ),
      );
    }
    return;
  }
  if (!evidence.includes("@Transactional")) {
    issues.push(
      issue("TRANSACTION_EVIDENCE_MISSING", `${label}: transactional evidence is missing`),
    );
  }
  if (!evidence.includes("recordAtomically(")) {
    issues.push(
      issue("ATOMIC_RECORDER_MISSING", `${label}: atomic recorder evidence is missing`),
    );
  }
  const eventType = operation.recorder === "platform-atomic"
    ? "PlatformAdminAuditEvent"
    : operation.recorder === "security-atomic"
      ? "SecurityAuditEvent"
      : null;
  if (!eventType || !evidence.includes(eventType)) {
    issues.push(
      issue("RECORDER_DOMAIN_MISMATCH", `${label}: recorder trust domain is invalid`),
    );
  }

  for (const action of operation.actions ?? []) {
    const escapedSymbol = action.symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedValue = action.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const constant = new RegExp(
      `\\b${escapedSymbol}\\s*=\\s*\"${escapedValue}\"`,
      "s",
    );
    if (!constant.test(allJava)) {
      issues.push(
        issue(
          "ACTION_CONTRACT_MISMATCH",
          `${label}: approved action constant is not present`,
        ),
      );
    }
    if (
      operation.classification === "tenant-business-success" &&
      evidenceMethod &&
      !evidenceMethod.body.includes(action.symbol)
    ) {
      issues.push(
        issue(
          "METHOD_ACTION_EVIDENCE_MISSING",
          `${label}: service method does not select the approved action`,
        ),
      );
    }
  }
  for (const resourceType of operation.resourceTypes ?? []) {
    if (!evidence.includes(`"${resourceType}"`)) {
      issues.push(
        issue(
          "RESOURCE_CONTRACT_MISMATCH",
          `${label}: approved resource type is not present`,
        ),
      );
    }
  }

  if (operation.classification === "tenant-business-success") {
    if (
      !controllerMethod?.body.includes("actor(principal") ||
      !evidenceMethod?.declaration.includes("@Transactional") ||
      !/\baudit(?:LineMatch)?\s*\(/.test(evidenceMethod?.body ?? "")
    ) {
      issues.push(
        issue(
          "TRANSACTIONAL_SUCCESS_CHAIN_MISSING",
          `${label}: controller actor to transactional audit chain is incomplete`,
        ),
      );
    }
    for (const invocation of auditInvocations(evidenceMethod?.body ?? "")) {
      if (SENSITIVE_DETAIL.test(invocation)) {
        issues.push(
          issue(
            "SENSITIVE_DETAIL_BOUNDARY_VIOLATION",
            `${label}: audit invocation references a forbidden secret-bearing field`,
          ),
        );
      }
    }
  }
}

function deduplicate(issues) {
  const unique = new Map();
  for (const value of issues) {
    unique.set(`${value.code}\0${value.message}`, value);
  }
  return [...unique.values()].sort(
    (left, right) =>
      left.code.localeCompare(right.code, "en") ||
      left.message.localeCompare(right.message, "en"),
  );
}

export function inspectAuditCoverage(repositoryRoot) {
  const root = path.resolve(repositoryRoot);
  const issues = [];
  let api;
  try {
    api = runApiContractGate(root);
  } catch (error) {
    if (error instanceof ApiContractGateError) {
      issues.push(
        ...error.issues.map((value) =>
          issue("API_CONTRACT_GATE_FAILED", `${value.code}: ${value.message}`),
        ),
      );
    } else {
      issues.push(issue("API_CONTRACT_GATE_FAILED", "API contract gate failed"));
    }
  }

  const baselineText = readSafeFile(root, BASELINE_RELATIVE, issues);
  let baseline = null;
  if (baselineText) {
    try {
      baseline = JSON.parse(baselineText);
    } catch {
      issues.push(issue("BASELINE_INVALID", "audit baseline is not valid JSON"));
    }
  }
  if (baseline && baseline.schemaVersion !== 1) {
    issues.push(issue("BASELINE_INVALID", "audit baseline schema is unsupported"));
  }
  if (baseline && baseline.integritySha256 !== integrity(baseline)) {
    issues.push(issue("BASELINE_INTEGRITY_MISMATCH", "audit baseline integrity is invalid"));
  }

  const javaFiles = walkJava(root, issues);
  const allJava = [...javaFiles.values()].join("\n");
  const writes = (api?.baseline.endpoints ?? []).filter((endpoint) =>
    WRITE_METHODS.has(endpoint.method) && !isReadOnlyExportEndpoint(endpoint),
  );
  const endpointById = new Map(
    writes.map((endpoint) => [endpoint.operationId, endpoint]),
  );
  const operationById = new Map();
  for (const operation of baseline?.operations ?? []) {
    if (operationById.has(operation.operationId)) {
      issues.push(
        issue(
          "DUPLICATE_OPERATION",
          `${operation.operationId}: operation is classified more than once`,
        ),
      );
    }
    operationById.set(operation.operationId, operation);
  }
  for (const endpoint of writes) {
    if (!operationById.has(endpoint.operationId)) {
      issues.push(
        issue(
          "WRITE_ENDPOINT_UNCLASSIFIED",
          `${endpoint.operationId}: write endpoint requires explicit audit classification`,
        ),
      );
    }
  }
  for (const [operationId, operation] of operationById) {
    const endpoint = endpointById.get(operationId);
    if (!endpoint) {
      issues.push(
        issue(
          "STALE_OPERATION_CLASSIFICATION",
          `${operationId}: classification does not match a current write endpoint`,
        ),
      );
      continue;
    }
    validateOperation(root, operation, endpoint, javaFiles, allJava, issues);
  }

  const attempted = baseline?.attemptedEvidence;
  const attemptedSource = attempted
    ? javaFiles.get(attempted.source)
    : null;
  if (
    !attemptedSource ||
    attempted?.semantics !== "attempted-only" ||
    attempted?.countsAsTransactionalSuccess !== false ||
    !attemptedSource.includes(`"${attempted.action}"`) ||
    !attemptedSource.includes("auditRecorder.record(new SecurityAuditEvent") ||
    attemptedSource.includes("auditRecorder.recordAtomically(")
  ) {
    issues.push(
      issue(
        "ATTEMPTED_EVIDENCE_MISCLASSIFIED",
        "platform-admin attempted filter must remain non-transactional supplemental evidence",
      ),
    );
  }

  const classifications = Object.fromEntries(
    [...CLASSIFICATIONS].map((classification) => [
      classification,
      [...operationById.values()].filter(
        (operation) => operation.classification === classification,
      ).length,
    ]),
  );
  return {
    issues: deduplicate(issues),
    baseline,
    summary: {
      writeEndpoints: writes.length,
      classified: operationById.size,
      transactionalBusiness:
        classifications["tenant-business-success"],
      tenantIam: classifications["tenant-iam-success"],
      tenantSecurity: classifications["tenant-security-event"],
      platformAdmin: classifications["platform-admin-success"],
      platformSecurity: classifications["platform-security-event"],
      failClosedNoSuccess:
        classifications["tenant-fail-closed-no-success"],
      attemptedEvidence: attemptedSource ? 1 : 0,
      skipped: 0,
    },
  };
}

export function runAuditCoverageGate(repositoryRoot) {
  const result = inspectAuditCoverage(repositoryRoot);
  if (result.issues.length > 0) {
    throw new AuditCoverageGateError(result.issues);
  }
  return result;
}

function printSuccess(result) {
  const value = result.summary;
  process.stdout.write(
    [
      "PASS audit coverage check",
      `write_endpoints=${value.writeEndpoints}`,
      `classified=${value.classified}`,
      `transactional_business=${value.transactionalBusiness}`,
      `tenant_iam=${value.tenantIam}`,
      `tenant_security=${value.tenantSecurity}`,
      `platform_admin=${value.platformAdmin}`,
      `platform_security=${value.platformSecurity}`,
      `fail_closed_no_success=${value.failClosedNoSuccess}`,
      `attempted_evidence=${value.attemptedEvidence}`,
      "skipped=0",
    ].join("\n") + "\n",
  );
}

function printFailure(error) {
  const issues = error instanceof AuditCoverageGateError
    ? error.issues
    : [issue("GATE_INTERNAL_ERROR", "audit coverage gate could not complete")];
  process.stderr.write(
    [
      "FAIL audit coverage gate",
      ...issues.map((value) => `[${value.code}] ${value.message}`),
      "skipped=0",
    ].join("\n") + "\n",
  );
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(SCRIPT_PATH);
if (invokedDirectly) {
  if (process.argv.length !== 2) {
    printFailure(
      new AuditCoverageGateError([
        issue(
          "EXTERNAL_INPUT_REJECTED",
          "the gate accepts no repository root, path, URL, environment, or other input",
        ),
      ]),
    );
    process.exitCode = 2;
  } else {
    try {
      printSuccess(runAuditCoverageGate(LOCKED_REPOSITORY_ROOT));
    } catch (error) {
      printFailure(error);
      process.exitCode = 1;
    }
  }
}
