#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const POSTGRES_IMAGE =
  'postgres:16-alpine@sha256:'
  + '57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777';
const OWNER_LABEL = 'cn.xzkj.erp.migration-rehearsal';
const MIGRATION_DIRECTORY =
  'platform/backend/src/main/resources/db/migration';
const MANIFEST_PATH =
  'platform/scripts/flyway-migration-manifest.json';
const BACKEND_DIRECTORY = 'platform/backend';
const MIGRATION_NAME =
  /^V([1-9][0-9]*)__([A-Za-z0-9][A-Za-z0-9_-]*)\.sql$/;
const HASH = /^[a-f0-9]{64}$/;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const EXPECTED_EVIDENCE_CHECKS = [
  'emptyDatabaseV1ToLatest',
  'upgradeV38ToLatest',
  'validateSucceeded',
  'duplicateRejected',
  'tamperRejected',
  'failedDatabaseNotDeliverable',
  'applicationNotStarted',
];
const SAFE_ENVIRONMENT_KEYS = [
  'PATH',
  'Path',
  'PATHEXT',
  'SystemRoot',
  'SYSTEMROOT',
  'ComSpec',
  'COMSPEC',
  'TEMP',
  'TMP',
  'TMPDIR',
  'JAVA_HOME',
  'MAVEN_HOME',
  'USERPROFILE',
  'HOME',
  'LANG',
  'LC_ALL',
];

class GateError extends Error {
  constructor(stage, hint = null) {
    super(stage);
    this.name = 'GateError';
    this.stage = stage;
    this.hint = hint;
  }
}

class InvocationError extends Error {
  constructor() {
    super('invalid invocation');
    this.name = 'InvocationError';
  }
}

export function resolveInsideRoot(root, relativePath) {
  if (typeof relativePath !== 'string'
      || relativePath.length === 0
      || isAbsolute(relativePath)
      || relativePath.includes('\0')) {
    throw new GateError('repository-path-safety');
  }
  const absoluteRoot = resolve(root);
  const target = resolve(absoluteRoot, relativePath);
  const fromRoot = relative(absoluteRoot, target);
  if (fromRoot === '..'
      || fromRoot.startsWith(`..${sep}`)
      || isAbsolute(fromRoot)) {
    throw new GateError('repository-path-safety');
  }
  return target;
}

async function assertNoSymlinkPath(root, relativePath, expectedKind) {
  const target = resolveInsideRoot(root, relativePath);
  const parts = relative(resolve(root), target).split(sep).filter(Boolean);
  let current = resolve(root);
  for (const part of parts) {
    current = resolve(current, part);
    let stat;
    try {
      stat = await lstat(current);
    } catch {
      throw new GateError('repository-path-safety');
    }
    if (stat.isSymbolicLink()) {
      throw new GateError('repository-path-safety');
    }
    if (current === target) {
      const matches = expectedKind === 'file'
        ? stat.isFile()
        : stat.isDirectory();
      if (!matches) {
        throw new GateError('repository-path-safety');
      }
    }
  }
  return target;
}

async function sha256File(path) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) {
    throw new GateError('migration-file-safety');
  }
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

function assertManifestShape(manifest) {
  if (manifest?.schemaVersion !== 1
      || manifest?.algorithm !== 'sha256'
      || !Array.isArray(manifest?.migrations)
      || manifest.migrations.length === 0) {
    throw new GateError('migration-manifest-format');
  }

  let previousVersion = 0;
  const names = new Set();
  for (const entry of manifest.migrations) {
    if (!Number.isSafeInteger(entry?.version)
        || entry.version <= previousVersion
        || typeof entry.file !== 'string'
        || !MIGRATION_NAME.test(entry.file)
        || Number(MIGRATION_NAME.exec(entry.file)[1]) !== entry.version
        || typeof entry.sha256 !== 'string'
        || !HASH.test(entry.sha256)
        || names.has(entry.file)) {
      throw new GateError('migration-manifest-format');
    }
    previousVersion = entry.version;
    names.add(entry.file);
  }
}

export async function readManifest(root) {
  const path = await assertNoSymlinkPath(root, MANIFEST_PATH, 'file');
  const stat = await lstat(path);
  if (stat.size > MAX_FILE_BYTES) {
    throw new GateError('migration-manifest-format');
  }
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new GateError('migration-manifest-format');
  }
  assertManifestShape(manifest);
  return manifest;
}

export async function scanMigrations(root) {
  const directory = await assertNoSymlinkPath(
    root,
    MIGRATION_DIRECTORY,
    'directory',
  );
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.length === 0) {
    throw new GateError('migration-filename-order');
  }

  const migrations = [];
  for (const entry of entries) {
    const match = MIGRATION_NAME.exec(entry.name);
    if (!entry.isFile() || entry.isSymbolicLink() || !match) {
      throw new GateError('migration-filename-order');
    }
    const version = Number(match[1]);
    if (!Number.isSafeInteger(version)) {
      throw new GateError('migration-filename-order');
    }
    migrations.push({
      version,
      file: entry.name,
      sha256: await sha256File(join(directory, entry.name)),
    });
  }

  migrations.sort((left, right) =>
    left.version - right.version || left.file.localeCompare(right.file, 'en'));
  for (let index = 1; index < migrations.length; index += 1) {
    if (migrations[index].version <= migrations[index - 1].version) {
      throw new GateError('migration-filename-order');
    }
  }
  return migrations;
}

export function buildCandidateManifest(manifest, migrations, allowAppend) {
  assertManifestShape(manifest);
  const actual = {
    schemaVersion: 1,
    algorithm: 'sha256',
    migrations,
  };
  assertManifestShape(actual);

  for (let index = 0; index < manifest.migrations.length; index += 1) {
    const expected = manifest.migrations[index];
    const found = migrations[index];
    if (!found
        || expected.version !== found.version
        || expected.file !== found.file
        || expected.sha256 !== found.sha256) {
      throw new GateError('migration-checksum-integrity');
    }
  }

  if (migrations.length === manifest.migrations.length) {
    return manifest;
  }
  if (!allowAppend || migrations.length < manifest.migrations.length) {
    throw new GateError(
      'migration-manifest-update-required',
      'Run --update-manifest only after migration version and content review.',
    );
  }

  const baselineMax =
    manifest.migrations[manifest.migrations.length - 1].version;
  if (migrations.slice(manifest.migrations.length)
    .some(({ version }) => version <= baselineMax)) {
    throw new GateError('migration-filename-order');
  }
  return actual;
}

function canonicalManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

async function writeManifest(root, manifest) {
  const path = await assertNoSymlinkPath(root, MANIFEST_PATH, 'file');
  const temporary = `${path}.${randomBytes(8).toString('hex')}.new`;
  try {
    await writeFile(temporary, canonicalManifest(manifest), {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o644,
    });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export function assertLoopbackJdbcUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('jdbc:postgresql://')) {
    throw new GateError('database-target-safety');
  }
  let parsed;
  try {
    parsed = new URL(value.slice('jdbc:'.length));
  } catch {
    throw new GateError('database-target-safety');
  }
  if (parsed.protocol !== 'postgresql:'
      || parsed.username
      || parsed.password
      || !['127.0.0.1', 'localhost'].includes(parsed.hostname)
      || !/^[1-9][0-9]{0,4}$/.test(parsed.port)
      || Number(parsed.port) > 65535
      || !/^\/[A-Za-z0-9_]+$/.test(parsed.pathname)) {
    throw new GateError('database-target-safety');
  }
  return value;
}

export function safeChildEnvironment(additions = {}) {
  const environment = {};
  for (const key of SAFE_ENVIRONMENT_KEYS) {
    if (process.env[key] !== undefined) {
      environment[key] = process.env[key];
    }
  }
  return { ...environment, ...additions };
}

export function spawnProcess(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
      stdio: options.capture ? ['ignore', 'pipe', 'ignore'] : 'ignore',
    });
    let stdout = '';
    if (options.capture) {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        if (stdout.length < 65536) {
          stdout += chunk.slice(0, 65536 - stdout.length);
        }
      });
    }
    child.once('error', rejectPromise);
    child.once('close', (code) => {
      resolvePromise({ code: code ?? -1, stdout });
    });
  });
}

export async function requireCommand(
  executor,
  command,
  args,
  options,
  stage,
  hint,
) {
  let result;
  try {
    result = await executor(command, args, options);
  } catch {
    throw new GateError(stage, hint);
  }
  if (result.code !== 0) {
    throw new GateError(stage, hint);
  }
  return result.stdout ?? '';
}

export function parsePublishedPort(output) {
  const match = /^127\.0\.0\.1:([1-9][0-9]{0,4})\s*$/.exec(output);
  if (!match || Number(match[1]) > 65535) {
    throw new GateError('database-target-safety');
  }
  return Number(match[1]);
}

export async function waitForHealthyContainer(
  executor,
  name,
  environment,
) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    let result;
    try {
      result = await executor(
        'docker',
        ['inspect', '--format', '{{.State.Health.Status}}', name],
        { capture: true, env: environment },
      );
    } catch {
      throw new GateError('postgres16-start');
    }
    if (result.code !== 0) {
      throw new GateError('postgres16-start');
    }
    if (result.stdout.trim() === 'healthy') {
      return;
    }
    if (result.stdout.trim() === 'unhealthy') {
      throw new GateError('postgres16-start');
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  throw new GateError('postgres16-start');
}

function assertEvidence(evidence, latestVersion, migrationCount) {
  if (evidence?.schemaVersion !== 1
      || evidence?.postgresMajor !== 16
      || evidence?.latestVersion !== String(latestVersion)
      || evidence?.migrationCount !== migrationCount
      || evidence?.skipped !== 0
      || typeof evidence?.checks !== 'object') {
    throw new GateError('migration-evidence');
  }
  for (const check of EXPECTED_EVIDENCE_CHECKS) {
    if (evidence.checks[check] !== true) {
      throw new GateError('migration-evidence');
    }
  }
}

export async function removeOwnedContainer(
  executor,
  name,
  runId,
  environment,
  ownerLabel = OWNER_LABEL,
  requireOwnershipCheck = false,
) {
  if (typeof ownerLabel !== 'string'
      || !/^[a-z0-9][a-z0-9.-]{0,127}$/.test(ownerLabel)) {
    throw new GateError('cleanup-ownership');
  }
  let inspected;
  try {
    inspected = await executor(
      'docker',
      [
        'inspect',
        '--format',
        `{{index .Config.Labels "${ownerLabel}"}}`,
        name,
      ],
      { capture: true, env: environment },
    );
  } catch {
    if (requireOwnershipCheck) {
      throw new GateError('cleanup-container-inspection');
    }
    return;
  }
  if (inspected.code !== 0) {
    if (requireOwnershipCheck) {
      throw new GateError('cleanup-container-inspection');
    }
    return;
  }
  if (inspected.stdout.trim() !== runId) {
    throw new GateError('cleanup-ownership');
  }
  const removed = await executor(
    'docker',
    ['rm', '--force', name],
    { env: environment },
  );
  if (removed.code !== 0) {
    throw new GateError('cleanup-container');
  }
}

export async function removeOwnedTemporaryDirectory(
  directory,
  runId,
  prefix = 'xz-erp-flyway-rehearsal-',
) {
  const absoluteTemporaryRoot = resolve(tmpdir());
  const absoluteDirectory = resolve(directory);
  const fromTemporaryRoot = relative(
    absoluteTemporaryRoot,
    absoluteDirectory,
  );
  if (typeof prefix !== 'string'
      || !/^xz-erp-[a-z0-9-]+-$/.test(prefix)
      || !absoluteDirectory.startsWith(
        resolve(absoluteTemporaryRoot, prefix),
      )
      || fromTemporaryRoot.startsWith(`..${sep}`)
      || isAbsolute(fromTemporaryRoot)) {
    throw new GateError('cleanup-ownership');
  }
  const stat = await lstat(absoluteDirectory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new GateError('cleanup-ownership');
  }
  const marker = await readFile(join(absoluteDirectory, '.owner'), 'utf8');
  if (marker !== runId) {
    throw new GateError('cleanup-ownership');
  }
  await rm(absoluteDirectory, { recursive: true });
}

async function runPostgresRehearsal(
  root,
  migrations,
  executor,
) {
  const runId = randomBytes(16).toString('hex');
  const containerName = `xz-erp-flyway-rehearsal-${runId}`;
  const password = randomBytes(32).toString('base64url');
  const directory = await mkdtemp(join(
    tmpdir(),
    'xz-erp-flyway-rehearsal-',
  ));
  const ownerPath = join(directory, '.owner');
  const envFile = join(directory, 'postgres.env');
  const evidencePath = join(directory, 'evidence.json');
  const childEnvironment = safeChildEnvironment();
  let containerCreated = false;
  let primaryError = null;

  await writeFile(ownerPath, runId, { encoding: 'utf8', mode: 0o600 });

  try {
    await writeFile(
      envFile,
      [
        'POSTGRES_DB=flyway_rehearsal',
        'POSTGRES_USER=flyway_rehearsal',
        `POSTGRES_PASSWORD=${password}`,
        '',
      ].join('\n'),
      { encoding: 'utf8', mode: 0o600 },
    );
    await requireCommand(
      executor,
      'docker',
      ['version', '--format', '{{.Server.Version}}'],
      { env: childEnvironment },
      'docker-unavailable',
      'Start Docker and pre-load the repository-pinned PostgreSQL 16 image.',
    );
    await requireCommand(
      executor,
      'docker',
      ['image', 'inspect', POSTGRES_IMAGE],
      { env: childEnvironment },
      'postgres16-image-unavailable',
      'Pre-load the exact PostgreSQL image digest from platform/compose.yaml.',
    );
    await requireCommand(
      executor,
      'docker',
      [
        'run',
        '--detach',
        '--rm',
        '--pull=never',
        '--name',
        containerName,
        '--label',
        `${OWNER_LABEL}=${runId}`,
        '--env-file',
        envFile,
        '--publish',
        '127.0.0.1::5432',
        '--health-cmd',
        'pg_isready -U flyway_rehearsal -d flyway_rehearsal',
        '--health-interval',
        '1s',
        '--health-timeout',
        '3s',
        '--health-retries',
        '30',
        POSTGRES_IMAGE,
      ],
      { env: childEnvironment },
      'postgres16-start',
    );
    containerCreated = true;
    await waitForHealthyContainer(
      executor,
      containerName,
      childEnvironment,
    );
    const published = await requireCommand(
      executor,
      'docker',
      ['port', containerName, '5432/tcp'],
      { capture: true, env: childEnvironment },
      'database-target-safety',
    );
    const port = parsePublishedPort(published);
    const jdbcUrl = assertLoopbackJdbcUrl(
      `jdbc:postgresql://127.0.0.1:${port}/flyway_rehearsal`,
    );

    const mavenEnvironment = safeChildEnvironment({
      XZ_ERP_FLYWAY_REHEARSAL: 'true',
      XZ_ERP_FLYWAY_REHEARSAL_JDBC_URL: jdbcUrl,
      XZ_ERP_FLYWAY_REHEARSAL_USER: 'flyway_rehearsal',
      XZ_ERP_FLYWAY_REHEARSAL_PASSWORD: password,
      XZ_ERP_FLYWAY_REHEARSAL_EVIDENCE: evidencePath,
    });
    const mavenArguments = [
      '--batch-mode',
      '--no-transfer-progress',
      '--offline',
      '-DfailIfNoTests=true',
      '-Dtest=cn.xzkj.erp.config.FlywayMigrationRehearsalIT',
      'test',
    ];
    const mavenCommand = process.platform === 'win32'
      ? (mavenEnvironment.ComSpec
        ?? mavenEnvironment.COMSPEC
        ?? 'cmd.exe')
      : 'mvn';
    // Windows cannot execute .cmd files directly. All cmd.exe tokens here are
    // fixed constants; no CLI value or database setting enters the command.
    const mavenCommandArguments = process.platform === 'win32'
      ? ['/d', '/s', '/c', 'mvn.cmd', ...mavenArguments]
      : mavenArguments;
    await requireCommand(
      executor,
      mavenCommand,
      mavenCommandArguments,
      {
        cwd: resolveInsideRoot(root, BACKEND_DIRECTORY),
        env: mavenEnvironment,
      },
      'flyway-pg16-rehearsal',
      'Use Java 25 and Maven with the repository dependencies already cached.',
    );

    let evidence;
    try {
      evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
    } catch {
      throw new GateError('migration-evidence');
    }
    const latest = migrations[migrations.length - 1].version;
    assertEvidence(evidence, latest, migrations.length);
    return evidence;
  } catch (error) {
    primaryError = error instanceof GateError
      ? error
      : new GateError('migration-rehearsal-internal');
    throw primaryError;
  } finally {
    let cleanupError = null;
    try {
      if (containerCreated) {
        await removeOwnedContainer(
          executor,
          containerName,
          runId,
          childEnvironment,
        );
      }
    } catch (error) {
      cleanupError = error;
    }
    try {
      await removeOwnedTemporaryDirectory(directory, runId);
    } catch (error) {
      cleanupError ??= error;
    }
    if (!primaryError && cleanupError) {
      throw cleanupError;
    }
  }
}

export function parseArgs(argv) {
  if (argv.length === 0) {
    return { checkOnly: false, updateManifest: false };
  }
  if (argv.length === 1 && argv[0] === '--check-only') {
    return { checkOnly: true, updateManifest: false };
  }
  if (argv.length === 1 && argv[0] === '--update-manifest') {
    return { checkOnly: false, updateManifest: true };
  }
  throw new InvocationError();
}

function pass(logger, stage) {
  logger(`[PASS]\t${stage}`);
}

function fail(logger, stage) {
  logger(`[FAIL]\t${stage}`);
}

export async function main(
  argv,
  {
    root = resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
    logger = console.log,
    executor = spawnProcess,
  } = {},
) {
  let options;
  try {
    options = parseArgs(argv);
  } catch {
    fail(logger, 'rehearsal-arguments');
    return 2;
  }

  try {
    const manifest = await readManifest(root);
    const migrations = await scanMigrations(root);
    const candidate = buildCandidateManifest(
      manifest,
      migrations,
      options.updateManifest,
    );
    pass(logger, 'migration-filename-order');
    pass(logger, 'migration-checksum-integrity');

    if (options.checkOnly) {
      pass(logger, 'repository-only-check');
      return 0;
    }

    await runPostgresRehearsal(root, migrations, executor);
    pass(logger, 'postgres16-empty-v1-to-latest');
    pass(logger, 'postgres16-v38-to-latest');
    pass(logger, 'flyway-validate');
    pass(logger, 'duplicate-migration-rejected');
    pass(logger, 'tampered-migration-rejected');
    pass(logger, 'failed-database-not-deliverable');
    pass(logger, 'application-not-started');
    pass(logger, 'zero-skipped');

    if (options.updateManifest
        && canonicalManifest(candidate) !== canonicalManifest(manifest)) {
      await writeManifest(root, candidate);
      pass(logger, 'migration-manifest-updated');
    }
    return 0;
  } catch (error) {
    const failure = error instanceof GateError
      ? error
      : new GateError('migration-rehearsal-internal');
    fail(logger, failure.stage);
    if (failure.hint) {
      logger(`[HINT]\t${failure.hint}`);
    }
    return 1;
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : '';
if (import.meta.url === invokedPath) {
  process.exitCode = await main(process.argv.slice(2));
}
