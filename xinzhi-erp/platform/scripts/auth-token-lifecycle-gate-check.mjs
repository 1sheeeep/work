import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIRECTORY = path.dirname(SCRIPT_PATH);
const LOCKED_REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..", "..");
const SUITE =
  "cn.xzkj.erp.security.AuthenticationTokenLifecyclePostgresql16GateTest";
const REPORT_RELATIVE =
  `platform/backend/target/surefire-reports/TEST-${SUITE}.xml`;
const REQUIRED_SOURCE_FILES = [
  "platform/backend/pom.xml",
  "platform/backend/src/test/java/cn/xzkj/erp/security/"
    + "AuthenticationTokenLifecyclePostgresql16GateTest.java",
  "platform/backend/src/test/java/cn/xzkj/erp/security/"
    + "PostgresqlApiFixture.java",
];
const REQUIRED_CASES = [
  "runsRealSpringSecurityAgainstOwnedPostgresql16WithPinnedRunnerFacts",
  "tenantBaseAndTenantSessionTrustDomainsCannotBeMixed",
  "tenantLogoutSessionRevocationAndSubjectDisableFailClosed",
  "systemAdminDisableAndDeleteRevokeEveryRelatedSecret",
  "tenantCredentialIssueResetReplayExpiryAndConcurrencyAreSingleUse"
    + "(CapturedOutput)",
  "platformCredentialReplayExpiryAndConcurrencyInvalidateSessions"
    + "(CapturedOutput)",
  "expiryForgeryMalformedCredentialsAndCheapFailuresNeverLeakOrSucceed"
    + "(CapturedOutput)",
  "concurrentLogoutIsIdempotentButRevokesAndAuditsOnlyOnce",
];
const FORBIDDEN_ENVIRONMENT_KEYS = [
  "AUTH_TOKEN_LIFECYCLE_GATE_REPORT",
  "DATABASE_URL",
  "JDBC_URL",
  "SPRING_DATASOURCE_URL",
  "SPRING_DATASOURCE_USERNAME",
  "SPRING_DATASOURCE_PASSWORD",
  "DB_PASSWORD",
  "DOTENV_CONFIG_PATH",
  "ENV_FILE",
];

export class AuthenticationTokenLifecycleGateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AuthenticationTokenLifecycleGateError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new AuthenticationTokenLifecycleGateError(code, message);
}

function attribute(openingTag, name) {
  const value = openingTag.match(
    new RegExp(`\\b${name}="([0-9]+)"`),
  )?.[1];
  if (value === undefined) {
    fail(
      "REPORT_ATTRIBUTE_MISSING",
      `Surefire report is missing testsuite attribute: ${name}`,
    );
  }
  return Number.parseInt(value, 10);
}

function canonicalRegularFile(root, relative) {
  const candidate = path.resolve(root, relative);
  const rootRelative = path.relative(root, candidate);
  if (
    rootRelative === ".."
    || rootRelative.startsWith(`..${path.sep}`)
    || path.isAbsolute(rootRelative)
  ) {
    fail("LOCKED_ROOT_ESCAPE", "required gate file leaves repository root");
  }
  if (!fs.existsSync(candidate)) {
    fail("REQUIRED_FILE_MISSING", `required gate file is missing: ${relative}`);
  }
  const metadata = fs.lstatSync(candidate);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    fail(
      "FILE_ALIAS_REJECTED",
      `required gate file must be a regular file: ${relative}`,
    );
  }
  if (fs.realpathSync.native(candidate) !== candidate) {
    fail(
      "FILE_ALIAS_REJECTED",
      `required gate file must use its canonical path: ${relative}`,
    );
  }
  return { candidate, metadata };
}

function validateLockedRoot(repositoryRoot) {
  const resolved = path.resolve(repositoryRoot);
  if (!fs.existsSync(resolved)) {
    fail("REPOSITORY_ROOT_MISSING", "locked repository root does not exist");
  }
  if (fs.realpathSync.native(resolved) !== resolved) {
    fail(
      "REPOSITORY_ROOT_ALIAS",
      "locked repository root must be canonical",
    );
  }
  return resolved;
}

export function inspectAuthenticationTokenLifecycleReport(xml) {
  const openingTag = xml.match(/<testsuite\b[^>]*>/)?.[0];
  if (!openingTag) {
    fail("REPORT_INVALID", "Surefire report does not contain a testsuite");
  }
  if (!openingTag.includes(`name="${SUITE}"`)) {
    fail("SUITE_MISMATCH", `unexpected Surefire suite; expected ${SUITE}`);
  }

  const tests = attribute(openingTag, "tests");
  const failures = attribute(openingTag, "failures");
  const errors = attribute(openingTag, "errors");
  const skipped = attribute(openingTag, "skipped");
  if (tests === 0) {
    fail("ZERO_TESTS", "authentication token lifecycle gate ran zero tests");
  }
  if (failures !== 0 || errors !== 0 || skipped !== 0) {
    fail(
      "TESTS_NOT_CLEAN",
      `gate is not clean: tests=${tests}, failures=${failures}, `
        + `errors=${errors}, skipped=${skipped}`,
    );
  }
  if (tests !== REQUIRED_CASES.length) {
    fail(
      "TEST_COUNT_DRIFT",
      `expected ${REQUIRED_CASES.length} lifecycle cases; found ${tests}`,
    );
  }

  const testCases = [
    ...xml.matchAll(/<testcase\b[^>]*\bname="([^"]+)"/g),
  ].map((match) => match[1]);
  if (testCases.length !== tests) {
    fail(
      "TESTCASE_COUNT_MISMATCH",
      `declared ${tests} tests but found ${testCases.length} cases`,
    );
  }
  for (const required of REQUIRED_CASES) {
    if (!testCases.includes(required)) {
      fail("REQUIRED_CASE_MISSING", `required lifecycle case is missing: ${required}`);
    }
  }

  const evidence = [
    ["owned PostgreSQL image", /AUTH_TOKEN_LIFECYCLE_GATE image=postgres:16-alpine /],
    ["PostgreSQL 16 runtime", / postgresql=16\.[0-9]+/],
    ["Flyway V39", / flyway=39 /],
    ["Testcontainers 1.21.4", / testcontainers=1\.21\.4 /],
    ["live Docker API marker", / api\.version=1\.[0-9]+/],
  ];
  for (const [label, pattern] of evidence) {
    if (!pattern.test(xml)) {
      fail("RUNNER_EVIDENCE_MISSING", `report lacks evidence: ${label}`);
    }
  }

  return {
    suite: SUITE,
    tests,
    failures,
    errors,
    skipped,
    requiredCases: REQUIRED_CASES.length,
  };
}

export function runAuthenticationTokenLifecycleGate(
  repositoryRoot = LOCKED_REPOSITORY_ROOT,
) {
  const root = validateLockedRoot(repositoryRoot);
  const report = canonicalRegularFile(root, REPORT_RELATIVE);
  const sources = REQUIRED_SOURCE_FILES.map((relative) =>
    canonicalRegularFile(root, relative));
  const newestSource = Math.max(
    ...sources.map((value) => value.metadata.mtimeMs),
  );
  if (report.metadata.mtimeMs < newestSource) {
    fail(
      "STALE_REPORT",
      "Surefire report predates the authentication gate sources",
    );
  }
  const result = inspectAuthenticationTokenLifecycleReport(
    fs.readFileSync(report.candidate, "utf8"),
  );
  return {
    root,
    report: REPORT_RELATIVE,
    ...result,
  };
}

function rejectExternalInputs() {
  if (process.argv.length !== 2) {
    fail(
      "EXTERNAL_INPUT_REJECTED",
      "gate accepts no path, URL, JDBC, credential, or .env argument",
    );
  }
  if (FORBIDDEN_ENVIRONMENT_KEYS.some((key) => process.env[key] !== undefined)) {
    fail(
      "EXTERNAL_INPUT_REJECTED",
      "gate rejects database, credential, report-path, and .env overrides",
    );
  }
}

function printFailure(error) {
  const code = error instanceof AuthenticationTokenLifecycleGateError
    ? error.code
    : "GATE_INTERNAL_ERROR";
  const message = error instanceof AuthenticationTokenLifecycleGateError
    ? error.message
    : "authentication token lifecycle gate could not complete";
  process.stderr.write([
    "FAIL authentication token lifecycle PostgreSQL 16 gate",
    `[${code}] ${message}`,
    "skipped=0",
  ].join("\n") + "\n");
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(SCRIPT_PATH);
if (invokedDirectly) {
  try {
    rejectExternalInputs();
    const result = runAuthenticationTokenLifecycleGate();
    process.stdout.write([
      "PASS authentication token lifecycle PostgreSQL 16 gate",
      `suite=${result.suite}`,
      `tests=${result.tests}`,
      "failures=0",
      "errors=0",
      "skipped=0",
    ].join("\n") + "\n");
  } catch (error) {
    printFailure(error);
    process.exitCode =
      error instanceof AuthenticationTokenLifecycleGateError
      && error.code === "EXTERNAL_INPUT_REJECTED"
        ? 2
        : 1;
  }
}
