#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  lstat,
  readdir,
  realpath,
  rmdir,
  stat,
  symlink,
  unlink,
  readFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse,
  delimiter,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = resolve(dirname(SCRIPT_PATH), "..", "..");
const BACKEND_DIRECTORY = "platform/backend";
const CACHE_RELATIVE_PATH = [".m2", "repository"];
const JUNCTION_PREFIX = "xz-erp-maven-agent-";
const FIXED_MAVEN_LAYOUT = Object.freeze([
  ".codex",
  "tmp",
  "erp-production-readiness-toolchain",
  "maven",
  "apache-maven-3.9.11",
  "bin",
  "mvn.cmd",
]);
const FIXED_MAVEN_ROOT_LAYOUT = Object.freeze(FIXED_MAVEN_LAYOUT.slice(0, 4));
const FIXED_JDK_LAYOUT = Object.freeze([
  ".codex",
  "tmp",
  "erp-production-readiness-toolchain",
  "jdk",
  "jdk-25.0.4+7",
  "bin",
  "java.exe",
]);
const FIXED_JDK_ROOT_LAYOUT = Object.freeze(FIXED_JDK_LAYOUT.slice(0, 5));
const SMOKE_TESTS = Object.freeze([
  "cn.xzkj.erp.iam.web.AuthControllerTest",
  "cn.xzkj.erp.platformadmin.application.PlatformAdminCredentialServiceTest",
  "cn.xzkj.erp.iam.application.PasswordCredentialRedemptionCostTest",
  "cn.xzkj.erp.order.service.OrderCenterServiceTest",
  "cn.xzkj.erp.order.service.OrderShopifyCatalogPreviewServiceTest",
  "cn.xzkj.erp.order.service.OrderShopifyCatalogImportServiceTest",
  "cn.xzkj.erp.order.api.OrderCenterControllerIntegrationTest",
]);

const STORE_APP_PREPARATION_TESTS = Object.freeze([
  "cn.xzkj.erp.platform.connector.ShopifyCoordinationPreparationPostgresql16GateTest",
  "cn.xzkj.erp.platform.connector.InventoryCommandPreparationPostgresql16GateTest",
  "cn.xzkj.erp.platform.connector.CustomerServiceIdentityPreparationContractTest",
  "cn.xzkj.erp.platform.connector.CustomerServiceIdentityPreparationPostgresql16GateTest",
  "cn.xzkj.erp.platform.connector.IdentityPreparationBrowserTest",
  "cn.xzkj.erp.platform.connector.IdentityPreparationRestoreTest",
  "cn.xzkj.erp.iam.application.LoginServiceTest",
  "cn.xzkj.erp.iam.security.BearerTokenAuthenticationFilterTest",
  "cn.xzkj.erp.iam.web.AuthControllerTest",
  "cn.xzkj.erp.platform.connector.StoreAppReadPreparationTest",
  "cn.xzkj.erp.platform.connector.StoreAppReadPreparationProcessTest",
  "cn.xzkj.erp.platform.connector.StoreAppReadPreparationPostgresql16GateTest",
  "cn.xzkj.erp.platform.connector.XzErpAppChannelConnectorGatewayTest",
  "cn.xzkj.erp.platform.service.ShopChannelServiceTest",
  "cn.xzkj.erp.platform.service.ShopChannelServiceTransactionBoundaryTest",
  // Existing tenant-scoped query/pagination contracts are also part of the
  // preparation regression baseline; this is not an arbitrary test selector.
  "cn.xzkj.erp.persistence.TenantListQueryPlanPostgresql16Test",
]);
const SAFE_ENVIRONMENT_KEYS = Object.freeze([
  "PATH",
  "Path",
  "PATHEXT",
  "SystemRoot",
  "SYSTEMROOT",
  "ComSpec",
  "COMSPEC",
  "JAVA_HOME",
  "USERPROFILE",
  "TEMP",
  "TMP",
  "TMPDIR",
  "LANG",
  "LC_ALL",
]);

export class MavenAgentPathGateError extends Error {
  constructor(code) {
    super(code);
    this.name = "MavenAgentPathGateError";
    this.code = code;
  }
}

function fail(code) {
  throw new MavenAgentPathGateError(code);
}

export function isAscii(value) {
  return typeof value === "string" && /^[\x20-\x7e]+$/.test(value);
}

function normalizedWindowsPath(value) {
  return resolve(value).replaceAll("/", "\\").toLowerCase();
}

export function expectedMavenRepository(homeDirectory) {
  if (typeof homeDirectory !== "string" || !isAbsolute(homeDirectory)) {
    fail("HOME_DIRECTORY_INVALID");
  }
  return resolve(homeDirectory, ...CACHE_RELATIVE_PATH);
}

export function validateRepositoryTarget({ homeDirectory, repository }) {
  const expected = expectedMavenRepository(homeDirectory);
  if (typeof repository !== "string"
      || !isAbsolute(repository)
      || normalizedWindowsPath(repository) !== normalizedWindowsPath(expected)) {
    fail("MAVEN_CACHE_TARGET_REJECTED");
  }
  return expected;
}

export function junctionParentFor(repository) {
  const root = parse(resolve(repository)).root;
  if (!/^[A-Za-z]:\\$/.test(root)) {
    fail("JUNCTION_PARENT_REJECTED");
  }
  return resolve(root, "Users", "Public");
}

export function junctionPathFor({ repository, suffix }) {
  const parent = junctionParentFor(repository);
  if (!/^[a-f0-9]{16}$/.test(suffix)) {
    fail("JUNCTION_NAME_REJECTED");
  }
  const link = resolve(parent, `${JUNCTION_PREFIX}${suffix}`);
  const relativeLink = relative(parent, link);
  if (relativeLink.includes("..")
      || relativeLink.includes(sep)
      || basename(link) !== `${JUNCTION_PREFIX}${suffix}`
      || !isAscii(link)) {
    fail("JUNCTION_PATH_REJECTED");
  }
  return link;
}

export function needsJunction({ platform, repository }) {
  return platform === "win32" && !isAscii(repository);
}

export function mavenArguments({ full, preparation = false, repositoryOverride }) {
  if (full && preparation) fail("EXTERNAL_INPUT_REJECTED");
  const argumentsList = [
    "--batch-mode",
    "--no-transfer-progress",
    "--offline",
    "-DfailIfNoTests=true",
  ];
  if (repositoryOverride !== null) {
    if (!isAbsolute(repositoryOverride) || !isAscii(repositoryOverride)) {
      fail("MAVEN_REPOSITORY_OVERRIDE_REJECTED");
    }
    argumentsList.push(`-Dmaven.repo.local=${repositoryOverride}`);
  }
  if (!full) {
    argumentsList.push(`-Dtest=${(preparation ? STORE_APP_PREPARATION_TESTS : SMOKE_TESTS).join(",")}`);
  }
  argumentsList.push("test");
  return argumentsList;
}

function isWithinWindowsPath(child, root) {
  const normalizedChild = normalizedWindowsPath(child);
  const normalizedRoot = normalizedWindowsPath(root).replace(/[\\/]$/, "");
  return normalizedChild.startsWith(`${normalizedRoot}\\`)
    && normalizedChild !== normalizedRoot;
}

export function fixedMavenPaths(homeDirectory) {
  if (typeof homeDirectory !== "string" || !isAbsolute(homeDirectory)) {
    fail("HOME_DIRECTORY_INVALID");
  }
  const allowedRoot = resolve(homeDirectory, ...FIXED_MAVEN_ROOT_LAYOUT);
  return {
    allowedRoot,
    executable: resolve(homeDirectory, ...FIXED_MAVEN_LAYOUT),
  };
}

export function quoteWindowsCommandArgument(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes('"')) {
    fail("MAVEN_COMMAND_ARGUMENT_REJECTED");
  }
  return `"${value}"`;
}

async function inspectMavenExecutable(candidate, allowedRoot, { missingIsNull = true } = {}) {
  let candidateStat;
  try {
    candidateStat = await lstat(candidate);
  } catch (error) {
    if (missingIsNull && error?.code === "ENOENT") return null;
    fail("MAVEN_EXECUTABLE_NOT_FOUND");
  }
  if (!candidateStat.isFile() || candidateStat.isSymbolicLink()) {
    fail("MAVEN_EXECUTABLE_REJECTED");
  }
  let candidateReal;
  let rootReal;
  try {
    [candidateReal, rootReal] = await Promise.all([realpath(candidate), realpath(allowedRoot)]);
  } catch (error) {
    if (missingIsNull && error?.code === "ENOENT") return null;
    fail("MAVEN_EXECUTABLE_NOT_FOUND");
  }
  if (!isWithinWindowsPath(candidateReal, rootReal)) {
    fail("MAVEN_EXECUTABLE_ESCAPE");
  }
  return candidateReal;
}

async function inspectPathMavenExecutable(candidate, pathEntry) {
  let entryStat;
  try {
    entryStat = await lstat(pathEntry);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    fail("MAVEN_EXECUTABLE_REJECTED");
  }
  if (!entryStat.isDirectory() || entryStat.isSymbolicLink()) {
    fail("MAVEN_EXECUTABLE_REJECTED");
  }
  let entryReal;
  try {
    entryReal = await realpath(pathEntry);
  } catch {
    fail("MAVEN_EXECUTABLE_REJECTED");
  }
  if (!sameWindowsPath(entryReal, pathEntry)) {
    fail("MAVEN_EXECUTABLE_ESCAPE");
  }
  return inspectMavenExecutable(candidate, entryReal);
}

async function fixedMavenExecutable(homeDirectory) {
  const { allowedRoot, executable } = fixedMavenPaths(homeDirectory);
  let rootStat;
  try {
    rootStat = await lstat(allowedRoot);
  } catch (error) {
    if (error?.code === "ENOENT") fail("MAVEN_EXECUTABLE_NOT_FOUND");
    fail("MAVEN_EXECUTABLE_REJECTED");
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    fail("MAVEN_EXECUTABLE_REJECTED");
  }
  let rootReal;
  try {
    rootReal = await realpath(allowedRoot);
  } catch {
    fail("MAVEN_EXECUTABLE_NOT_FOUND");
  }
  if (!sameWindowsPath(rootReal, allowedRoot)) {
    fail("MAVEN_EXECUTABLE_ESCAPE");
  }
  return inspectMavenExecutable(executable, rootReal, { missingIsNull: false });
}

export async function discoverMavenExecutable({
  platform = process.platform,
  environment = process.env,
  homeDirectory = homedir(),
} = {}) {
  if (platform !== "win32") return "mvn";
  const pathValue = environment.PATH ?? environment.Path;
  if (typeof pathValue === "string") {
    for (const rawEntry of pathValue.split(delimiter)) {
      if (rawEntry.length === 0 || !isAbsolute(rawEntry)) continue;
      const pathEntry = resolve(rawEntry);
      const candidate = join(pathEntry, "mvn.cmd");
      const discovered = await inspectPathMavenExecutable(candidate, pathEntry);
      if (discovered !== null) return discovered;
    }
  }
  return fixedMavenExecutable(homeDirectory);
}

export function fixedJdkPaths(homeDirectory) {
  if (typeof homeDirectory !== "string" || !isAbsolute(homeDirectory)) {
    fail("HOME_DIRECTORY_INVALID");
  }
  const allowedRoot = resolve(homeDirectory, ...FIXED_JDK_ROOT_LAYOUT);
  return {
    allowedRoot,
    executable: resolve(homeDirectory, ...FIXED_JDK_LAYOUT),
  };
}

export function parseJavaMajorVersion(output) {
  const match = String(output).match(/version\s+"(\d+)(?:[.+-]|\")/i);
  if (!match || Number.parseInt(match[1], 10) !== 25) {
    fail("JAVA_RUNTIME_VERSION_REJECTED");
  }
  return 25;
}

async function validateJavaExecutable(homeDirectory, executable, missingCode) {
  let homeStat;
  try {
    homeStat = await lstat(homeDirectory);
  } catch (error) {
    if (error?.code === "ENOENT") fail(missingCode);
    fail("JAVA_HOME_REJECTED");
  }
  if (!homeStat.isDirectory() || homeStat.isSymbolicLink()) {
    fail("JAVA_HOME_REJECTED");
  }
  let homeReal;
  try {
    homeReal = await realpath(homeDirectory);
  } catch {
    fail(missingCode);
  }
  if (!sameWindowsPath(homeReal, homeDirectory)) {
    fail("JAVA_HOME_ESCAPE");
  }
  let executableStat;
  try {
    executableStat = await lstat(executable);
  } catch (error) {
    if (error?.code === "ENOENT") fail(missingCode);
    fail("JAVA_EXECUTABLE_REJECTED");
  }
  if (!executableStat.isFile() || executableStat.isSymbolicLink()) {
    fail("JAVA_EXECUTABLE_REJECTED");
  }
  let executableReal;
  try {
    executableReal = await realpath(executable);
  } catch {
    fail(missingCode);
  }
  const executableRoot = resolve(dirname(dirname(executableReal)));
  if (!isWithinWindowsPath(executableReal, homeReal)
      || !sameWindowsPath(executableRoot, homeReal)) {
    fail("JAVA_HOME_ESCAPE");
  }
  return { home: homeReal, executable: executableReal };
}

function javaVersionProbeEnvironment() {
  const environment = {};
  for (const key of ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP"]) {
    if (typeof process.env[key] === "string" && process.env[key] !== "") {
      environment[key] = process.env[key];
    }
  }
  return environment;
}

async function assertJava25(javaExecutable) {
  await new Promise((resolveProbe, rejectProbe) => {
    const child = spawn(javaExecutable, ["-version"], {
      env: javaVersionProbeEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      windowsVerbatimArguments: true,
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("error", () => rejectProbe(new MavenAgentPathGateError("JAVA_VERSION_PROBE_FAILED")));
    child.once("exit", (code, signal) => {
      if (code !== 0 || signal !== null) {
        rejectProbe(new MavenAgentPathGateError("JAVA_VERSION_PROBE_FAILED"));
        return;
      }
      try {
        parseJavaMajorVersion(output);
        resolveProbe();
      } catch (error) {
        rejectProbe(error);
      }
    });
  });
}

export async function discoverJavaRuntime({
  platform = process.platform,
  environment = process.env,
  homeDirectory = homedir(),
} = {}) {
  if (platform !== "win32") return null;
  let runtime;
  if (typeof environment.JAVA_HOME === "string" && environment.JAVA_HOME.length > 0) {
    if (!isAbsolute(environment.JAVA_HOME)) fail("JAVA_HOME_INVALID");
    const javaHome = resolve(environment.JAVA_HOME);
    runtime = await validateJavaExecutable(
      javaHome,
      resolve(javaHome, "bin", "java.exe"),
      "JAVA_HOME_NOT_FOUND",
    );
  } else {
    const { allowedRoot, executable } = fixedJdkPaths(homeDirectory);
    runtime = await validateJavaExecutable(allowedRoot, executable, "JAVA_FALLBACK_NOT_FOUND");
  }
  await assertJava25(runtime.executable);
  return runtime;
}

export function mavenInvocation({ platform, environment, argumentsList, executable = "mvn.cmd" }) {
  if (platform !== "win32") {
    return { command: "mvn", args: argumentsList };
  }
  const commandShell = environment.ComSpec ?? environment.COMSPEC ?? "cmd.exe";
  const commandLine = [quoteWindowsCommandArgument(executable), ...argumentsList].join(" ");
  return {
    command: commandShell,
    args: ["/d", "/s", "/c", commandLine],
    windowsVerbatimArguments: true,
  };
}

export function evaluateCleanupEvidence({ exists, isJunction, targetMatches, removed }) {
  if (!exists) return null;
  if (!isJunction || !targetMatches) return "JUNCTION_CLEANUP_REFUSED";
  if (!removed) return "JUNCTION_CLEANUP_FAILED";
  return null;
}

function safeChildEnvironment({ javaHome, mavenExecutable }) {
  const environment = {};
  for (const key of SAFE_ENVIRONMENT_KEYS) {
    if (key !== "JAVA_HOME"
        && key !== "PATH"
        && key !== "Path"
        && typeof process.env[key] === "string"
        && process.env[key] !== "") {
      environment[key] = process.env[key];
    }
  }
  const existingPath = process.env.PATH ?? process.env.Path ?? "";
  const controlledPrefix = [];
  if (typeof mavenExecutable === "string" && isAbsolute(mavenExecutable)) {
    controlledPrefix.push(dirname(mavenExecutable));
  }
  if (typeof javaHome === "string" && javaHome.length > 0) {
    controlledPrefix.push(resolve(javaHome, "bin"));
  }
  const existingEntries = existingPath.split(delimiter)
    .filter((entry) => entry.length > 0)
    .filter((entry) => !controlledPrefix.some((prefix) => sameWindowsPath(entry, prefix)));
  environment.PATH = [...controlledPrefix, ...existingEntries].join(delimiter);
  if (typeof javaHome === "string" && javaHome.length > 0) {
    environment.JAVA_HOME = javaHome;
  } else if (typeof process.env.JAVA_HOME === "string" && process.env.JAVA_HOME.length > 0) {
    environment.JAVA_HOME = process.env.JAVA_HOME;
  }
  return environment;
}

async function assertRegularDirectory(path, code) {
  let entry;
  try {
    entry = await lstat(path);
  } catch {
    fail(code);
  }
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    fail(code);
  }
}

function sameWindowsPath(left, right) {
  return normalizedWindowsPath(left) === normalizedWindowsPath(right);
}

async function snapshotDirectory(root) {
  const entries = new Map();
  async function visit(current, relativePath) {
    const children = await readdir(current, { withFileTypes: true });
    for (const child of children) {
      const childRelative = relativePath === "" ? child.name : `${relativePath}/${child.name}`;
      const childPath = join(current, child.name);
      const childStat = await lstat(childPath);
      if (childStat.isDirectory() && !childStat.isSymbolicLink()) {
        entries.set(childRelative, `directory:${childStat.mtimeMs}`);
        await visit(childPath, childRelative);
      } else if (childStat.isFile()) {
        entries.set(childRelative, `file:${childStat.size}:${childStat.mtimeMs}`);
      } else {
        entries.set(childRelative, `other:${childStat.size}:${childStat.mtimeMs}`);
      }
    }
  }
  await visit(root, "");
  return entries;
}

export function cacheSnapshotMatches(before, after) {
  if (before.size !== after.size) return false;
  for (const [key, value] of before) {
    if (after.get(key) !== value) return false;
  }
  return true;
}

function reportPathFor(testName) {
  return resolve(
    REPOSITORY_ROOT,
    BACKEND_DIRECTORY,
    "target",
    "surefire-reports",
    `TEST-${testName}.xml`,
  );
}

function suiteAttribute(xml, name) {
  const match = xml.match(new RegExp(`<testsuite\\b[^>]*\\b${name}="(\\d+)"`, "i"));
  if (!match) fail("SUREFIRE_REPORT_INVALID");
  return Number.parseInt(match[1], 10);
}

export function parseSurefireReport(xml) {
  const tests = suiteAttribute(xml, "tests");
  const failures = suiteAttribute(xml, "failures");
  const errors = suiteAttribute(xml, "errors");
  const skippedMatch = xml.match(/<testsuite\b[^>]*\bskipped="(\d+)"/i);
  const skipped = skippedMatch ? Number.parseInt(skippedMatch[1], 10) : 0;
  if (![tests, failures, errors, skipped].every(Number.isSafeInteger)) {
    fail("SUREFIRE_REPORT_INVALID");
  }
  return { tests, failures, errors, skipped };
}

export function summarizeSurefireReports(reports, expectedTests = null) {
  if (reports.length === 0
      || reports.some((report) => !Number.isSafeInteger(report.tests)
        || report.tests <= 0)) {
    fail("SUREFIRE_RESULT_REJECTED");
  }
  const summary = reports.reduce((total, report) => ({
    tests: total.tests + report.tests,
    failures: total.failures + report.failures,
    errors: total.errors + report.errors,
    skipped: total.skipped + report.skipped,
  }), { tests: 0, failures: 0, errors: 0, skipped: 0 });
  if (summary.tests <= 0
      || summary.failures !== 0
      || summary.errors !== 0
      || summary.skipped !== 0
      || (expectedTests !== null && summary.tests !== expectedTests)) {
    fail("SUREFIRE_RESULT_REJECTED");
  }
  return summary;
}

async function readFreshReport(path, startedAt) {
  let reportStat;
  try {
    reportStat = await stat(path);
  } catch {
    fail("SUREFIRE_REPORT_MISSING");
  }
  // NTFS/Surefire timestamps can be recorded at a coarser precision than
  // Date.now(). A two-second grace still rejects reports from a prior run.
  if (!reportStat.isFile() || reportStat.mtimeMs < startedAt - 2_000) {
    fail("SUREFIRE_REPORT_STALE");
  }
  return parseSurefireReport(await readFile(path, "utf8"));
}

async function assertSurefireResults({ full, preparation = false, startedAt }) {
  if (!full) {
    const reports = await Promise.all((preparation ? STORE_APP_PREPARATION_TESTS : SMOKE_TESTS).map((testName) =>
      readFreshReport(reportPathFor(testName), startedAt)));
    return summarizeSurefireReports(reports);
  }
  const reportDirectory = resolve(REPOSITORY_ROOT, BACKEND_DIRECTORY, "target", "surefire-reports");
  let entries;
  try {
    entries = await readdir(reportDirectory, { withFileTypes: true });
  } catch {
    fail("SUREFIRE_REPORT_MISSING");
  }
  const reportPaths = entries
    .filter((entry) => entry.isFile() && /^TEST-.+\.xml$/.test(entry.name))
    .map((entry) => join(reportDirectory, entry.name));
  if (reportPaths.length === 0) fail("SUREFIRE_REPORT_MISSING");
  const reports = await Promise.all(reportPaths.map((path) => readFreshReport(path, startedAt)));
  return summarizeSurefireReports(reports);
}

async function createJunction(repository) {
  const parent = junctionParentFor(repository);
  await assertRegularDirectory(parent, "JUNCTION_PARENT_REJECTED");
  const link = junctionPathFor({
    repository,
    suffix: randomBytes(8).toString("hex"),
  });
  try {
    await symlink(repository, link, "junction");
  } catch {
    fail("JUNCTION_CREATE_FAILED");
  }
  let linkStat;
  let linkTarget;
  try {
    linkStat = await lstat(link);
    linkTarget = await realpath(link);
  } catch {
    fail("JUNCTION_CREATE_FAILED");
  }
  const repositoryTarget = await realpath(repository);
  if (!linkStat.isSymbolicLink() || !sameWindowsPath(linkTarget, repositoryTarget)) {
    fail("JUNCTION_TARGET_REJECTED");
  }
  return { link, repositoryTarget };
}

async function removeJunction({ link, repositoryTarget }) {
  let exists = false;
  let isJunction = false;
  let targetMatches = false;
  try {
    const linkStat = await lstat(link);
    exists = true;
    isJunction = linkStat.isSymbolicLink();
    if (isJunction) {
      targetMatches = sameWindowsPath(await realpath(link), repositoryTarget);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") fail("JUNCTION_CLEANUP_FAILED");
  }
  const refusal = evaluateCleanupEvidence({
    exists,
    isJunction,
    targetMatches,
    removed: false,
  });
  if (refusal === "JUNCTION_CLEANUP_REFUSED") fail(refusal);
  if (!exists) return;
  try {
    await unlink(link);
  } catch {
    try {
      await rmdir(link);
    } catch {
      fail("JUNCTION_CLEANUP_FAILED");
    }
  }
  const stillExists = await lstat(link).then(() => true).catch((error) => {
    if (error?.code === "ENOENT") return false;
    fail("JUNCTION_CLEANUP_FAILED");
  });
  const cleanupFailure = evaluateCleanupEvidence({
    exists: true,
    isJunction,
    targetMatches,
    removed: !stillExists,
  });
  if (cleanupFailure) fail(cleanupFailure);
}

function runCommand(invocation, options) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(invocation.command, invocation.args, {
      ...options,
      stdio: "inherit",
      windowsHide: true,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments ?? false,
    });
    child.once("error", rejectRun);
    child.once("exit", (code, signal) => {
      if (code === 0 && signal === null) resolveRun();
      else rejectRun(new MavenAgentPathGateError("MAVEN_TEST_FAILED"));
    });
  });
}

export async function runWindowsMavenAgentPathGate({ full = false, preparation = false } = {}) {
  const homeDirectory = homedir();
  const repository = validateRepositoryTarget({
    homeDirectory,
    repository: expectedMavenRepository(homeDirectory),
  });
  await assertRegularDirectory(repository, "MAVEN_CACHE_TARGET_REJECTED");
  const usesJunction = needsJunction({ platform: process.platform, repository });
  let junction = null;
  let beforeSnapshot = null;
  let operationError = null;
  let summary = null;
  try {
    if (usesJunction) {
      junction = await createJunction(repository);
      beforeSnapshot = await snapshotDirectory(repository);
    }
    const argumentsList = mavenArguments({
      full,
      preparation,
      repositoryOverride: junction?.link ?? null,
    });
    const executable = await discoverMavenExecutable({
      platform: process.platform,
      environment: process.env,
      homeDirectory,
    });
    const javaRuntime = await discoverJavaRuntime({
      platform: process.platform,
      environment: process.env,
      homeDirectory,
    });
    const environment = safeChildEnvironment({
      javaHome: javaRuntime?.home,
      mavenExecutable: executable,
    });
    const invocation = mavenInvocation({
      platform: process.platform,
      environment,
      argumentsList,
      executable,
    });
    const startedAt = Date.now();
    await runCommand(invocation, {
      cwd: resolve(REPOSITORY_ROOT, BACKEND_DIRECTORY),
      env: environment,
    });
    summary = await assertSurefireResults({ full, preparation, startedAt });
  } catch (error) {
    operationError = error instanceof MavenAgentPathGateError
      ? error
      : new MavenAgentPathGateError("GATE_INTERNAL_ERROR");
  }
  let cacheError = null;
  if (usesJunction && beforeSnapshot !== null) {
    try {
      if (!cacheSnapshotMatches(beforeSnapshot, await snapshotDirectory(repository))) {
        fail("MAVEN_CACHE_MUTATED");
      }
    } catch (error) {
      cacheError = error instanceof MavenAgentPathGateError
        ? error
        : new MavenAgentPathGateError("MAVEN_CACHE_SNAPSHOT_FAILED");
    }
  }
  let cleanupError = null;
  if (junction) {
    try {
      await removeJunction(junction);
    } catch (error) {
      cleanupError = error instanceof MavenAgentPathGateError
        ? error
        : new MavenAgentPathGateError("JUNCTION_CLEANUP_FAILED");
    }
  }
  if (cleanupError) throw cleanupError;
  if (cacheError) throw cacheError;
  if (operationError) throw operationError;
  return { full, preparation, usesJunction, summary, skipped: 0 };
}

function parseInvocation(argumentsList) {
  if (argumentsList.length === 0) return { full: false };
  if (argumentsList.length === 1 && argumentsList[0] === "--full") return { full: true };
  if (argumentsList.length === 1 && argumentsList[0] === "--store-app-preparation") return { preparation: true };
  fail("EXTERNAL_INPUT_REJECTED");
}

function printFailure(error) {
  const code = error instanceof MavenAgentPathGateError
    ? error.code
    : "GATE_INTERNAL_ERROR";
  process.stderr.write(`FAIL windows Maven agent path gate\n[${code}]\nskipped=0\n`);
}

const invokedDirectly = process.argv[1]
  && resolve(process.argv[1]) === resolve(SCRIPT_PATH);
if (invokedDirectly) {
  try {
    const result = await runWindowsMavenAgentPathGate(parseInvocation(process.argv.slice(2)));
    process.stdout.write([
      "PASS windows Maven agent path gate",
      `mode=${result.full ? "full" : result.preparation ? "store-app-preparation" : "smoke"}`,
      `junction=${result.usesJunction ? "used" : "not-needed"}`,
      `tests=${result.summary.tests}`,
      "skipped=0",
    ].join("\n") + "\n");
  } catch (error) {
    printFailure(error);
    process.exitCode = error instanceof MavenAgentPathGateError ? 1 : 2;
  }
}
