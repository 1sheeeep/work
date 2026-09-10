import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  AuthenticationTokenLifecycleGateError,
  inspectAuthenticationTokenLifecycleReport,
  runAuthenticationTokenLifecycleGate,
} from "./auth-token-lifecycle-gate-check.mjs";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..", "..");
const SCRIPT_PATH = path.join(
  SCRIPT_DIRECTORY,
  "auth-token-lifecycle-gate-check.mjs",
);
const SUITE =
  "cn.xzkj.erp.security.AuthenticationTokenLifecyclePostgresql16GateTest";
const CASES = [
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
const temporaryRoots = [];

function report({
  tests = CASES.length,
  failures = 0,
  errors = 0,
  skipped = 0,
  cases = CASES,
  evidence = true,
} = {}) {
  const testCases = cases
    .map((name) => `<testcase name="${name}" classname="${SUITE}"/>`)
    .join("");
  const proof = evidence
    ? `
      <properties>
      </properties>
      <system-out><![CDATA[
        AUTH_TOKEN_LIFECYCLE_GATE image=postgres:16-alpine postgresql=16.14 flyway=39 testcontainers=1.21.4 api.version=1.55
      ]]></system-out>`
    : "";
  return `
    <testsuite name="${SUITE}" tests="${tests}" failures="${failures}"
      errors="${errors}" skipped="${skipped}">
      ${testCases}
      ${proof}
    </testsuite>`;
}

function expectCode(callback, code) {
  assert.throws(
    callback,
    (error) =>
      error instanceof AuthenticationTokenLifecycleGateError
      && error.code === code,
  );
}

function lockedRootFixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "xz-erp-auth-lifecycle-gate-"),
  );
  temporaryRoots.push(root);
  const files = [
    "platform/backend/pom.xml",
    "platform/backend/src/test/java/cn/xzkj/erp/security/"
      + "AuthenticationTokenLifecyclePostgresql16GateTest.java",
    "platform/backend/src/test/java/cn/xzkj/erp/security/"
      + "PostgresqlApiFixture.java",
  ];
  for (const relative of files) {
    const destination = path.join(root, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, "gate source\n", "utf8");
  }
  const reportPath = path.join(
    root,
    "platform/backend/target/surefire-reports",
    `TEST-${SUITE}.xml`,
  );
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, report(), "utf8");
  const future = new Date(Date.now() + 2_000);
  fs.utimesSync(reportPath, future, future);
  return { root, reportPath, sourcePath: path.join(root, files[1]) };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("accepts the complete clean lifecycle report with pinned evidence", () => {
  assert.deepEqual(inspectAuthenticationTokenLifecycleReport(report()), {
    suite: SUITE,
    tests: 8,
    failures: 0,
    errors: 0,
    skipped: 0,
    requiredCases: 8,
  });
});

test("rejects zero, failed, errored, skipped, or count-drifted suites", () => {
  expectCode(
    () => inspectAuthenticationTokenLifecycleReport(
      report({ tests: 0, cases: [] }),
    ),
    "ZERO_TESTS",
  );
  for (const field of ["failures", "errors", "skipped"]) {
    expectCode(
      () => inspectAuthenticationTokenLifecycleReport(
        report({ [field]: 1 }),
      ),
      "TESTS_NOT_CLEAN",
    );
  }
  expectCode(
    () => inspectAuthenticationTokenLifecycleReport(
      report({ tests: 7, cases: CASES.slice(0, 7) }),
    ),
    "TEST_COUNT_DRIFT",
  );
});

test("rejects missing cases, testcase mismatch, and missing runner proof", () => {
  const changedCases = [...CASES];
  changedCases[0] = "renamedCase";
  expectCode(
    () => inspectAuthenticationTokenLifecycleReport(
      report({ cases: changedCases }),
    ),
    "REQUIRED_CASE_MISSING",
  );
  expectCode(
    () => inspectAuthenticationTokenLifecycleReport(
      report().replace(`<testcase name="${CASES[0]}"`, "<case"),
    ),
    "TESTCASE_COUNT_MISMATCH",
  );
  expectCode(
    () => inspectAuthenticationTokenLifecycleReport(
      report({ evidence: false }),
    ),
    "RUNNER_EVIDENCE_MISSING",
  );
});

test("locked-root runner accepts only a fresh canonical regular report", () => {
  const fixture = lockedRootFixture();
  assert.equal(
    runAuthenticationTokenLifecycleGate(fixture.root).tests,
    CASES.length,
  );
  const future = new Date(Date.now() + 4_000);
  fs.utimesSync(fixture.sourcePath, future, future);
  expectCode(
    () => runAuthenticationTokenLifecycleGate(fixture.root),
    "STALE_REPORT",
  );
});

test("executable rejects path, URL, JDBC, credential, and dotenv arguments", () => {
  for (const input of [
    "C:\\outside\\report.xml",
    "https://outside.invalid/report.xml",
    "jdbc:postgresql://outside.invalid/erp",
    "--password=secret",
    ".env",
  ]) {
    const result = spawnSync(process.execPath, [SCRIPT_PATH, input], {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /\[EXTERNAL_INPUT_REJECTED\]/);
    assert.match(result.stderr, /skipped=0/);
    assert.doesNotMatch(result.stderr, /outside\.invalid|secret/);
  }
});

test("executable rejects database and dotenv environment overrides", () => {
  for (const key of [
    "DATABASE_URL",
    "SPRING_DATASOURCE_PASSWORD",
    "DOTENV_CONFIG_PATH",
  ]) {
    const result = spawnSync(process.execPath, [SCRIPT_PATH], {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
      env: { ...process.env, [key]: "secret-canary" },
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /\[EXTERNAL_INPUT_REJECTED\]/);
    assert.doesNotMatch(result.stderr, /secret-canary/);
  }
});
