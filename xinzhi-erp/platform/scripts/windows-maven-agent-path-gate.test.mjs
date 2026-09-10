import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  MavenAgentPathGateError,
  cacheSnapshotMatches,
  discoverJavaRuntime,
  discoverMavenExecutable,
  evaluateCleanupEvidence,
  expectedMavenRepository,
  fixedMavenPaths,
  fixedJdkPaths,
  isAscii,
  junctionPathFor,
  mavenArguments,
  mavenInvocation,
  needsJunction,
  parseSurefireReport,
  parseJavaMajorVersion,
  quoteWindowsCommandArgument,
  summarizeSurefireReports,
  validateRepositoryTarget,
} from "./windows-maven-agent-path-gate.mjs";

const SCRIPT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "windows-maven-agent-path-gate.mjs",
);
const UNICODE_HOME = "C:\\Users\\新知科技";
const UNICODE_REPOSITORY = "C:\\Users\\新知科技\\.m2\\repository";

function code(action) {
  try {
    action();
  } catch (error) {
    assert.ok(error instanceof MavenAgentPathGateError);
    return error.code;
  }
  assert.fail("expected MavenAgentPathGateError");
}

test("ASCII detection and the default Maven cache contract are deterministic", () => {
  assert.equal(isAscii("C:\\Users\\Public"), true);
  assert.equal(isAscii(UNICODE_HOME), false);
  assert.equal(expectedMavenRepository(UNICODE_HOME), UNICODE_REPOSITORY);
  assert.equal(
    validateRepositoryTarget({ homeDirectory: UNICODE_HOME, repository: UNICODE_REPOSITORY }),
    UNICODE_REPOSITORY,
  );
});

test("path escape, cache root, and arbitrary targets fail closed", () => {
  assert.equal(code(() => validateRepositoryTarget({
    homeDirectory: UNICODE_HOME,
    repository: "C:\\Users\\新知科技\\.m2",
  })), "MAVEN_CACHE_TARGET_REJECTED");
  assert.equal(code(() => validateRepositoryTarget({
    homeDirectory: UNICODE_HOME,
    repository: "C:\\temp\\repository",
  })), "MAVEN_CACHE_TARGET_REJECTED");
  assert.equal(code(() => validateRepositoryTarget({
    homeDirectory: "relative",
    repository: UNICODE_REPOSITORY,
  })), "HOME_DIRECTORY_INVALID");
});

test("only Windows Unicode cache paths use a task-owned ASCII junction", () => {
  assert.equal(needsJunction({ platform: "win32", repository: UNICODE_REPOSITORY }), true);
  assert.equal(needsJunction({ platform: "linux", repository: UNICODE_REPOSITORY }), false);
  assert.equal(needsJunction({ platform: "win32", repository: "C:\\Users\\ascii\\.m2\\repository" }), false);
  assert.equal(
    junctionPathFor({ repository: UNICODE_REPOSITORY, suffix: "0123456789abcdef" }),
    "C:\\Users\\Public\\xz-erp-maven-agent-0123456789abcdef",
  );
  assert.equal(code(() => junctionPathFor({ repository: UNICODE_REPOSITORY, suffix: "../escape" })), "JUNCTION_NAME_REJECTED");
});

test("offline Maven arguments use only a reviewed ASCII override", () => {
  const junction = "C:\\Users\\Public\\xz-erp-maven-agent-0123456789abcdef";
  const smoke = mavenArguments({ full: false, repositoryOverride: junction });
  assert.deepEqual(smoke, [
    "--batch-mode",
    "--no-transfer-progress",
    "--offline",
    "-DfailIfNoTests=true",
    `-Dmaven.repo.local=${junction}`,
    "-Dtest=cn.xzkj.erp.iam.web.AuthControllerTest,cn.xzkj.erp.platformadmin.application.PlatformAdminCredentialServiceTest,cn.xzkj.erp.iam.application.PasswordCredentialRedemptionCostTest,cn.xzkj.erp.order.service.OrderCenterServiceTest,cn.xzkj.erp.order.service.OrderShopifyCatalogPreviewServiceTest,cn.xzkj.erp.order.service.OrderShopifyCatalogImportServiceTest,cn.xzkj.erp.order.api.OrderCenterControllerIntegrationTest",
    "test",
  ]);
  assert.equal(mavenArguments({ full: true, repositoryOverride: null }).includes("-Dmaven.repo.local"), false);
  assert.equal(code(() => mavenArguments({ full: false, repositoryOverride: UNICODE_REPOSITORY })), "MAVEN_REPOSITORY_OVERRIDE_REJECTED");
});

test("Windows invocation propagates the reviewed repository argument through cmd", () => {
  const executable = "C:\\Users\\新知科技\\Program Files\\apache-maven-3.9.11\\bin\\mvn.cmd";
  const invocation = mavenInvocation({
    platform: "win32",
    environment: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
    argumentsList: ["--offline", "test"],
    executable,
  });
  assert.deepEqual(invocation, {
    command: "C:\\Windows\\System32\\cmd.exe",
    args: ["/d", "/s", "/c", `"${executable}" --offline test`],
    windowsVerbatimArguments: true,
  });
  assert.equal(quoteWindowsCommandArgument(executable), `"${executable}"`);
  assert.equal(code(() => quoteWindowsCommandArgument('C:\\bad"path\\mvn.cmd')), "MAVEN_COMMAND_ARGUMENT_REJECTED");
});

test("Maven executable discovery prioritizes a verified PATH entry and uses only the fixed fallback", async () => {
  const { allowedRoot, executable } = fixedMavenPaths(homedir());
  const fixedBin = path.dirname(executable);
  const discoveredFromPath = await discoverMavenExecutable({
    platform: "win32",
    environment: { PATH: fixedBin },
    homeDirectory: homedir(),
  });
  assert.equal(discoveredFromPath, await realpath(executable));
  const discoveredFromFallback = await discoverMavenExecutable({
    platform: "win32",
    environment: { PATH: "C:\\definitely-missing-maven-path" },
    homeDirectory: homedir(),
  });
  assert.equal(discoveredFromFallback, await realpath(executable));
  assert.match(allowedRoot, /erp-production-readiness-toolchain[\\/]maven$/i);
});

test("Maven executable discovery rejects missing fixed tools and relative PATH escape inputs", async () => {
  await assert.rejects(
    discoverMavenExecutable({
      platform: "win32",
      environment: { PATH: "..\\untrusted-bin" },
      homeDirectory: "C:\\Users\\Public\\missing-codex-home",
    }),
    (error) => error instanceof MavenAgentPathGateError && error.code === "MAVEN_EXECUTABLE_NOT_FOUND",
  );
});

test("Java discovery validates Java 25 and uses the exact homedir fallback", async () => {
  const { allowedRoot, executable } = fixedJdkPaths(homedir());
  const fallback = await discoverJavaRuntime({
    platform: "win32",
    environment: {},
    homeDirectory: homedir(),
  });
  assert.equal(fallback.home, await realpath(allowedRoot));
  assert.equal(fallback.executable, await realpath(executable));
  const explicit = await discoverJavaRuntime({
    platform: "win32",
    environment: { JAVA_HOME: fallback.home },
    homeDirectory: homedir(),
  });
  assert.deepEqual(explicit, fallback);
  assert.equal(parseJavaMajorVersion('openjdk version "25.0.4" 2025-07-15'), 25);
  assert.equal(code(() => parseJavaMajorVersion('openjdk version "17.0.12" 2024-07-16')), "JAVA_RUNTIME_VERSION_REJECTED");
});

test("Java discovery rejects caller JAVA_HOME paths, escapes, and missing fallback", async () => {
  await assert.rejects(
    discoverJavaRuntime({
      platform: "win32",
      environment: { JAVA_HOME: "relative\\jdk" },
      homeDirectory: homedir(),
    }),
    (error) => error instanceof MavenAgentPathGateError && error.code === "JAVA_HOME_INVALID",
  );
  await assert.rejects(
    discoverJavaRuntime({
      platform: "win32",
      environment: { JAVA_HOME: "C:\\Users\\Public\\..\\untrusted-jdk" },
      homeDirectory: homedir(),
    }),
    (error) => error instanceof MavenAgentPathGateError && error.code === "JAVA_HOME_NOT_FOUND",
  );
  await assert.rejects(
    discoverJavaRuntime({
      platform: "win32",
      environment: {},
      homeDirectory: "C:\\Users\\Public\\missing-codex-home",
    }),
    (error) => error instanceof MavenAgentPathGateError && error.code === "JAVA_FALLBACK_NOT_FOUND",
  );
});

test("cache snapshot drift and unsafe cleanup evidence fail closed", () => {
  const before = new Map([["a.jar", "file:1:1"]]);
  assert.equal(cacheSnapshotMatches(before, new Map([["a.jar", "file:1:1"]])), true);
  assert.equal(cacheSnapshotMatches(before, new Map([["a.jar", "file:2:1"]])), false);
  assert.equal(evaluateCleanupEvidence({ exists: true, isJunction: false, targetMatches: true, removed: false }), "JUNCTION_CLEANUP_REFUSED");
  assert.equal(evaluateCleanupEvidence({ exists: true, isJunction: true, targetMatches: false, removed: false }), "JUNCTION_CLEANUP_REFUSED");
  assert.equal(evaluateCleanupEvidence({ exists: true, isJunction: true, targetMatches: true, removed: false }), "JUNCTION_CLEANUP_FAILED");
  assert.equal(evaluateCleanupEvidence({ exists: true, isJunction: true, targetMatches: true, removed: true }), null);
});

test("Surefire parsing requires zero failures, errors, and skips", () => {
  const clean = parseSurefireReport('<testsuite tests="2" failures="0" errors="0" skipped="0"/>');
  assert.deepEqual(summarizeSurefireReports([clean, { ...clean, tests: 1 }, { ...clean, tests: 1 }], 4), {
    tests: 4,
    failures: 0,
    errors: 0,
    skipped: 0,
  });
  assert.equal(code(() => summarizeSurefireReports([{ ...clean, skipped: 1 }])), "SUREFIRE_RESULT_REJECTED");
  assert.equal(code(() => summarizeSurefireReports([{ ...clean, tests: 0 }])), "SUREFIRE_RESULT_REJECTED");
  assert.equal(code(() => summarizeSurefireReports([])), "SUREFIRE_RESULT_REJECTED");
  assert.equal(code(() => parseSurefireReport('<testsuite tests="x" failures="0" errors="0"/>')), "SUREFIRE_REPORT_INVALID");
});

test("store app preparation has a fixed bounded selection and cannot masquerade as full", () => {
  const args = mavenArguments({ full: false, preparation: true, repositoryOverride: null });
  assert.ok(args.includes("--offline"));
  const selection = args.find(arg => arg.startsWith("-Dtest="));
    assert.ok(selection.includes("StoreAppReadPreparationTest"));
    assert.ok(selection.includes("InventoryCommandPreparationPostgresql16GateTest"));
  assert.ok(selection.includes("CustomerServiceIdentityPreparationContractTest"));
  assert.ok(selection.includes("CustomerServiceIdentityPreparationPostgresql16GateTest"));
  assert.ok(selection.includes("IdentityPreparationBrowserTest"));
  assert.ok(selection.includes("BearerTokenAuthenticationFilterTest"));
  assert.ok(selection.includes("StoreAppReadPreparationProcessTest"));
  assert.ok(selection.includes("XzErpAppChannelConnectorGatewayTest"));
  assert.ok(selection.includes("TenantListQueryPlanPostgresql16Test"));
  assert.equal(code(() => mavenArguments({ full: true, preparation: true, repositoryOverride: null })), "EXTERNAL_INPUT_REJECTED");
});

test("the executable rejects external targets and does not echo them", () => {
  const canary = "C:\\untrusted\\credential-canary";
  const result = spawnSync(process.execPath, [SCRIPT_PATH, "--cache", canary], {
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[EXTERNAL_INPUT_REJECTED\]/);
  assert.match(result.stderr, /skipped=0/);
  assert.doesNotMatch(result.stderr, /untrusted|credential-canary/);
});
