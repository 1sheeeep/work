#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import {
  access,
  chmod,
  copyFile,
  lstat,
  mkdtemp,
  readFile,
  stat,
  truncate,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  POSTGRES_IMAGE,
  assertLoopbackJdbcUrl,
  buildCandidateManifest,
  parsePublishedPort,
  readManifest,
  removeOwnedContainer,
  removeOwnedTemporaryDirectory,
  requireCommand,
  resolveInsideRoot,
  safeChildEnvironment,
  scanMigrations,
  spawnProcess,
  waitForHealthyContainer,
} from './flyway-migration-rehearsal.mjs';

const OWNER_LABEL = 'cn.xzkj.erp.backup-restore-rehearsal';
const TEMPORARY_PREFIX = 'xz-erp-pg16-backup-restore-';
const BACKEND_DIRECTORY = 'platform/backend';
const DATABASE_USER = 'backup_restore_gate';
const SOURCE_DATABASE = 'backup_restore_source';
const RESTORE_DATABASE = 'backup_restore_target';
const NONEMPTY_DATABASE = 'backup_restore_nonempty';
const WRONG_SCHEMA_DATABASE = 'backup_restore_wrong_schema';
const CORRUPT_DATABASE = 'backup_restore_corrupt';
const CHECKSUM_DATABASE = 'backup_restore_checksum';
const VERSION_DATABASE = 'backup_restore_version';
const DATASET_VERSION = 'v1-v89-synthetic-1';
const EXPECTED_LATEST_MIGRATION = 89;
const EXPECTED_COUNTS = Object.freeze({
  tenants: 2,
  users: 2,
  roles: 2,
  auditLogs: 2,
  authSessions: 2,
  passwordCredentials: 2,
  shops: 2,
  productSpus: 2,
  productSkus: 2,
  productListings: 2,
  orders: 2,
  orderLines: 2,
  warehouses: 2,
  warehouseLocations: 2,
  suppliers: 2,
  supplierSkuMappings: 2,
});
const INTERNAL_DATABASES = new Set([
  SOURCE_DATABASE,
  RESTORE_DATABASE,
  NONEMPTY_DATABASE,
  WRONG_SCHEMA_DATABASE,
  CORRUPT_DATABASE,
  CHECKSUM_DATABASE,
  VERSION_DATABASE,
]);
const EMPTY_TARGET_QUERY = `
SELECT (
    SELECT count(*)
    FROM pg_catalog.pg_namespace
    WHERE nspname NOT IN (
        'pg_catalog', 'information_schema', 'pg_toast', 'public'
    )
      AND nspname !~ '^pg_temp_'
      AND nspname !~ '^pg_toast_temp_'
) + (
    SELECT count(*)
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname NOT IN (
        'pg_catalog', 'information_schema', 'pg_toast'
    )
      AND namespace.nspname !~ '^pg_temp_'
      AND namespace.nspname !~ '^pg_toast_temp_'
      AND relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
);
`;

export class GateError extends Error {
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

function gateError(error, fallbackStage) {
  if (error instanceof GateError) {
    return error;
  }
  if (typeof error?.stage === 'string') {
    return new GateError(error.stage, error.hint ?? null);
  }
  return new GateError(fallbackStage);
}

export function parseArgs(argv) {
  if (argv.length !== 0) {
    throw new InvocationError();
  }
  return {};
}

export function assertNode24(version = process.versions.node) {
  if (!/^24\./.test(version)) {
    throw new GateError(
      'node24-required',
      'Run this gate with the repository-required Node.js 24 runtime.',
    );
  }
}

export function assertInternalDatabaseName(database) {
  if (!INTERNAL_DATABASES.has(database)
      || !/^[a-z][a-z0-9_]{0,62}$/.test(database)) {
    throw new GateError('database-target-safety');
  }
  return database;
}

function containerPath(runId, fileName = null) {
  if (!/^[a-f0-9]{32}$/.test(runId)
      || (fileName !== null
        && !/^[a-z0-9][a-z0-9.-]*$/.test(fileName))) {
    throw new GateError('dump-path-safety');
  }
  const directory = `/tmp/xz-erp-pg16-backup-restore-${runId}`;
  return fileName === null ? directory : `${directory}/${fileName}`;
}

async function assertOwnedPath(path, directory, expectedKind = 'file') {
  const normalizedDirectory = resolve(directory);
  const normalizedPath = resolve(path);
  if (dirname(normalizedPath) !== normalizedDirectory) {
    throw new GateError('dump-path-safety');
  }
  const item = await lstat(normalizedPath);
  if (item.isSymbolicLink()
      || (expectedKind === 'file' && !item.isFile())) {
    throw new GateError('dump-path-safety');
  }
}

function dockerExecArguments(containerName, commandArguments) {
  return [
    'exec',
    '--user',
    'postgres',
    containerName,
    ...commandArguments,
  ];
}

async function runDockerCommand(
  executor,
  containerName,
  commandArguments,
  environment,
  stage,
  capture = false,
) {
  return requireCommand(
    executor,
    'docker',
    dockerExecArguments(containerName, commandArguments),
    { capture, env: environment },
    stage,
  );
}

async function expectDockerFailure(
  executor,
  containerName,
  commandArguments,
  environment,
  stage,
) {
  let result;
  try {
    result = await executor(
      'docker',
      dockerExecArguments(containerName, commandArguments),
      { env: environment },
    );
  } catch {
    throw new GateError(stage);
  }
  if (result.code === 0) {
    throw new GateError(stage);
  }
}

async function createDatabase(
  executor,
  containerName,
  database,
  environment,
) {
  assertInternalDatabaseName(database);
  await runDockerCommand(
    executor,
    containerName,
    [
      'createdb',
      '--username',
      DATABASE_USER,
      '--no-password',
      database,
    ],
    environment,
    'database-create',
  );
}

async function runPsql(
  executor,
  containerName,
  database,
  sql,
  environment,
  { capture = false, stage = 'database-command' } = {},
) {
  assertInternalDatabaseName(database);
  if (typeof sql !== 'string' || sql.length === 0) {
    throw new GateError('database-command-safety');
  }
  return runDockerCommand(
    executor,
    containerName,
    [
      'psql',
      '--no-password',
      '--set',
      'ON_ERROR_STOP=1',
      '--tuples-only',
      '--no-align',
      '--username',
      DATABASE_USER,
      '--dbname',
      database,
      '--command',
      sql,
    ],
    environment,
    stage,
    capture,
  );
}

export async function assertEmptyRestoreTarget(
  executor,
  containerName,
  database,
  environment,
) {
  const output = await runPsql(
    executor,
    containerName,
    database,
    EMPTY_TARGET_QUERY,
    environment,
    { capture: true, stage: 'restore-target-inspection' },
  );
  if (output.trim() !== '0') {
    throw new GateError('restore-target-not-empty');
  }
}

async function restoreDump(
  executor,
  containerName,
  database,
  runId,
  dumpFileName,
  environment,
) {
  assertInternalDatabaseName(database);
  await assertEmptyRestoreTarget(
    executor,
    containerName,
    database,
    environment,
  );
  await runDockerCommand(
    executor,
    containerName,
    [
      'pg_restore',
      '--exit-on-error',
      '--single-transaction',
      '--no-owner',
      '--no-privileges',
      '--username',
      DATABASE_USER,
      '--dbname',
      database,
      containerPath(runId, dumpFileName),
    ],
    environment,
    'pg-restore',
  );
}

async function copyFromContainer(
  executor,
  containerName,
  runId,
  fileName,
  destination,
  environment,
) {
  await requireCommand(
    executor,
    'docker',
    [
      'cp',
      `${containerName}:${containerPath(runId, fileName)}`,
      destination,
    ],
    { env: environment },
    'dump-copy-out',
  );
}

async function copyToContainer(
  executor,
  containerName,
  runId,
  fileName,
  source,
  environment,
) {
  await requireCommand(
    executor,
    'docker',
    [
      'cp',
      source,
      `${containerName}:${containerPath(runId, fileName)}`,
    ],
    { env: environment },
    'dump-copy-in',
  );
}

async function expectGateStage(stage, action) {
  try {
    await action();
  } catch (error) {
    if (error instanceof GateError && error.stage === stage) {
      return;
    }
    throw new GateError(stage);
  }
  throw new GateError(stage);
}

function mavenCommand(environment, mavenArguments) {
  if (process.platform !== 'win32') {
    return { command: 'mvn', args: mavenArguments };
  }
  return {
    command: environment.ComSpec ?? environment.COMSPEC ?? 'cmd.exe',
    args: ['/d', '/s', '/c', 'mvn.cmd', ...mavenArguments],
  };
}

function rehearsalEnvironment({
  jdbcUrl,
  password,
  phase,
  snapshotPath,
  evidencePath,
}) {
  return safeChildEnvironment({
    XZ_ERP_BACKUP_RESTORE_REHEARSAL: 'true',
    XZ_ERP_BACKUP_RESTORE_PHASE: phase,
    XZ_ERP_BACKUP_RESTORE_JDBC_URL: jdbcUrl,
    XZ_ERP_BACKUP_RESTORE_USER: DATABASE_USER,
    XZ_ERP_BACKUP_RESTORE_PASSWORD: password,
    XZ_ERP_BACKUP_RESTORE_SNAPSHOT: snapshotPath,
    XZ_ERP_BACKUP_RESTORE_EVIDENCE: evidencePath,
  });
}

async function runMavenPhase({
  executor,
  root,
  jdbcUrl,
  password,
  phase,
  snapshotPath,
  evidencePath,
  expectFailure = false,
}) {
  const environment = rehearsalEnvironment({
    jdbcUrl,
    password,
    phase,
    snapshotPath,
    evidencePath,
  });
  const mavenArguments = [
    '--batch-mode',
    '--no-transfer-progress',
    '--offline',
    '-DfailIfNoTests=true',
    '-Dtest=cn.xzkj.erp.config.Pg16BackupRestoreRehearsalIT',
    'test',
  ];
  const invocation = mavenCommand(environment, mavenArguments);
  const options = {
    cwd: resolveInsideRoot(root, BACKEND_DIRECTORY),
    env: environment,
  };
  if (!expectFailure) {
    await requireCommand(
      executor,
      invocation.command,
      invocation.args,
      options,
      phase === 'prepare'
        ? 'synthetic-source-prepare'
        : 'restored-database-validation',
      'Use Java 25 and Maven with repository dependencies cached.',
    );
    return;
  }

  let result;
  try {
    result = await executor(invocation.command, invocation.args, options);
  } catch {
    throw new GateError('mismatch-validation-execution');
  }
  if (result.code === 0) {
    throw new GateError('mismatch-not-rejected');
  }
  try {
    await access(evidencePath);
  } catch {
    return;
  }
  throw new GateError('failed-database-evidence');
}

function assertBooleanFields(value, fields) {
  for (const field of fields) {
    if (value?.[field] !== true) {
      throw new GateError('backup-restore-evidence');
    }
  }
}

function assertBaseEvidence(evidence, migrationCount) {
  if (evidence?.schemaVersion !== 1
      || evidence?.postgresMajor !== 16
      || evidence?.latestMigration !== '80'
      || evidence?.migrationSuccessfulCount !== migrationCount
      || evidence?.syntheticDatasetVersion !== DATASET_VERSION
      || evidence?.dumpFormat !== 'custom'
      || evidence?.skipped !== 0
      || JSON.stringify(evidence?.counts) !== JSON.stringify(EXPECTED_COUNTS)) {
    throw new GateError('backup-restore-evidence');
  }
  assertBooleanFields(evidence, [
    'countsMatched',
    'constraintsValidated',
    'indexesValidated',
    'tenantIsolationValidated',
    'passwordHashesSyntheticOnly',
    'auditRowsValidated',
    'sequenceUuidTimeValidated',
    'flywayValidated',
    'hibernateValidated',
  ]);
}

export function assertEvidence(evidence, migrationCount) {
  assertBaseEvidence(evidence, migrationCount);
  if (evidence?.cleanupOwnershipValidated !== true) {
    throw new GateError('backup-restore-evidence');
  }
  assertBooleanFields(evidence?.negativeChecks, [
    'truncatedDumpRejected',
    'wrongFormatRejected',
    'nonEmptyTargetRejected',
    'wrongSchemaRejected',
    'pgRestoreNonZero',
    'versionMismatchRejected',
    'checksumMismatchRejected',
  ]);
}

async function readEvidence(path, migrationCount) {
  let evidence;
  try {
    evidence = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new GateError('backup-restore-evidence');
  }
  assertBaseEvidence(evidence, migrationCount);
  return evidence;
}

async function preflightRuntime(executor, environment) {
  assertNode24();
  await requireCommand(
    executor,
    'docker',
    ['version', '--format', '{{.Server.Version}}'],
    { env: environment },
    'docker-unavailable',
    'Start Docker and pre-load the repository-pinned PostgreSQL 16 image.',
  );
  await requireCommand(
    executor,
    'docker',
    ['image', 'inspect', POSTGRES_IMAGE],
    { env: environment },
    'postgres16-image-unavailable',
    'Pre-load the exact PostgreSQL image digest from platform/compose.yaml.',
  );
  await requireCommand(
    executor,
    process.platform === 'win32'
      ? (environment.ComSpec ?? environment.COMSPEC ?? 'cmd.exe')
      : 'java',
    process.platform === 'win32'
      ? ['/d', '/s', '/c', 'java.exe', '-version']
      : ['-version'],
    { env: environment },
    'java-unavailable',
    'Use the repository-required Java 25 runtime.',
  );
  const invocation = mavenCommand(environment, ['--version']);
  await requireCommand(
    executor,
    invocation.command,
    invocation.args,
    { env: environment },
    'maven-unavailable',
    'Use Maven with repository dependencies cached.',
  );
}

async function assertContainerTools(
  executor,
  containerName,
  environment,
) {
  for (const command of ['pg_dump', 'pg_restore', 'psql', 'createdb']) {
    await runDockerCommand(
      executor,
      containerName,
      [command, '--version'],
      environment,
      'postgres-tools-unavailable',
    );
  }
}

async function runRehearsal(root, migrations, executor) {
  const runId = randomBytes(16).toString('hex');
  const containerName = `xz-erp-pg16-restore-${runId}`;
  const password = randomBytes(32).toString('base64url');
  const directory = await mkdtemp(join(tmpdir(), TEMPORARY_PREFIX));
  const ownerPath = join(directory, '.owner');
  const environmentPath = join(directory, 'postgres.env');
  const snapshotPath = join(directory, 'source.snapshot');
  const javaEvidencePath = join(directory, 'java-evidence.json');
  const dumpPath = join(directory, 'source.dump');
  const truncatedPath = join(directory, 'truncated.dump');
  const wrongFormatPath = join(directory, 'wrong-format.dump');
  const childEnvironment = safeChildEnvironment();
  let containerCreated = false;
  let primaryError = null;

  await chmod(directory, 0o700);
  await writeFile(ownerPath, runId, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });

  try {
    const manifest = await readManifest(root);
    buildCandidateManifest(manifest, migrations, false);
    if (migrations.at(-1)?.version !== EXPECTED_LATEST_MIGRATION) {
      throw new GateError('latest-migration-contract');
    }

    await writeFile(
      environmentPath,
      [
        `POSTGRES_DB=${SOURCE_DATABASE}`,
        `POSTGRES_USER=${DATABASE_USER}`,
        `POSTGRES_PASSWORD=${password}`,
        '',
      ].join('\n'),
      { encoding: 'utf8', flag: 'wx', mode: 0o600 },
    );
    await preflightRuntime(executor, childEnvironment);
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
        environmentPath,
        '--publish',
        '127.0.0.1::5432',
        '--health-cmd',
        `pg_isready -U ${DATABASE_USER} -d ${SOURCE_DATABASE}`,
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
    await assertContainerTools(
      executor,
      containerName,
      childEnvironment,
    );
    await runDockerCommand(
      executor,
      containerName,
      [
        'mkdir',
        '-m',
        '700',
        containerPath(runId),
      ],
      childEnvironment,
      'dump-directory-create',
    );
    const published = await requireCommand(
      executor,
      'docker',
      ['port', containerName, '5432/tcp'],
      { capture: true, env: childEnvironment },
      'database-target-safety',
    );
    const port = parsePublishedPort(published);
    const sourceJdbcUrl = assertLoopbackJdbcUrl(
      `jdbc:postgresql://127.0.0.1:${port}/${SOURCE_DATABASE}`,
    );

    await runMavenPhase({
      executor,
      root,
      jdbcUrl: sourceJdbcUrl,
      password,
      phase: 'prepare',
      snapshotPath,
      evidencePath: javaEvidencePath,
    });

    await runDockerCommand(
      executor,
      containerName,
      [
        'pg_dump',
        '--format=custom',
        '--compress=6',
        '--no-owner',
        '--no-privileges',
        '--no-password',
        '--username',
        DATABASE_USER,
        '--dbname',
        SOURCE_DATABASE,
        '--file',
        containerPath(runId, 'source.dump'),
      ],
      childEnvironment,
      'pg-dump',
    );
    await copyFromContainer(
      executor,
      containerName,
      runId,
      'source.dump',
      dumpPath,
      childEnvironment,
    );
    await assertOwnedPath(dumpPath, directory);
    await chmod(dumpPath, 0o600);
    await runDockerCommand(
      executor,
      containerName,
      [
        'pg_restore',
        '--list',
        containerPath(runId, 'source.dump'),
      ],
      childEnvironment,
      'custom-dump-format',
    );

    await copyFile(dumpPath, truncatedPath);
    await assertOwnedPath(truncatedPath, directory);
    const dumpStat = await stat(truncatedPath);
    if (dumpStat.size < 2) {
      throw new GateError('truncated-dump-rejection');
    }
    await truncate(truncatedPath, Math.floor(dumpStat.size / 2));
    await writeFile(
      wrongFormatPath,
      'synthetic wrong-format canary; not a PostgreSQL archive\n',
      { encoding: 'utf8', flag: 'wx', mode: 0o600 },
    );
    await chmod(truncatedPath, 0o644);
    await chmod(wrongFormatPath, 0o644);
    await copyToContainer(
      executor,
      containerName,
      runId,
      'truncated.dump',
      truncatedPath,
      childEnvironment,
    );
    await copyToContainer(
      executor,
      containerName,
      runId,
      'wrong-format.dump',
      wrongFormatPath,
      childEnvironment,
    );
    await chmod(truncatedPath, 0o600);
    await chmod(wrongFormatPath, 0o600);
    await expectDockerFailure(
      executor,
      containerName,
      [
        'pg_restore',
        '--list',
        containerPath(runId, 'truncated.dump'),
      ],
      childEnvironment,
      'truncated-dump-rejection',
    );
    await expectDockerFailure(
      executor,
      containerName,
      [
        'pg_restore',
        '--list',
        containerPath(runId, 'wrong-format.dump'),
      ],
      childEnvironment,
      'wrong-format-rejection',
    );

    await createDatabase(
      executor,
      containerName,
      CORRUPT_DATABASE,
      childEnvironment,
    );
    await expectDockerFailure(
      executor,
      containerName,
      [
        'pg_restore',
        '--exit-on-error',
        '--no-owner',
        '--no-privileges',
        '--username',
        DATABASE_USER,
        '--dbname',
        CORRUPT_DATABASE,
        containerPath(runId, 'truncated.dump'),
      ],
      childEnvironment,
      'pg-restore-nonzero',
    );

    await createDatabase(
      executor,
      containerName,
      NONEMPTY_DATABASE,
      childEnvironment,
    );
    await runPsql(
      executor,
      containerName,
      NONEMPTY_DATABASE,
      'CREATE TABLE public.preexisting_marker(id integer PRIMARY KEY);',
      childEnvironment,
    );
    await expectGateStage(
      'restore-target-not-empty',
      () => assertEmptyRestoreTarget(
        executor,
        containerName,
        NONEMPTY_DATABASE,
        childEnvironment,
      ),
    );

    await createDatabase(
      executor,
      containerName,
      WRONG_SCHEMA_DATABASE,
      childEnvironment,
    );
    await runPsql(
      executor,
      containerName,
      WRONG_SCHEMA_DATABASE,
      'CREATE SCHEMA wrong_restore_target;',
      childEnvironment,
    );
    await expectGateStage(
      'restore-target-not-empty',
      () => assertEmptyRestoreTarget(
        executor,
        containerName,
        WRONG_SCHEMA_DATABASE,
        childEnvironment,
      ),
    );

    await createDatabase(
      executor,
      containerName,
      CHECKSUM_DATABASE,
      childEnvironment,
    );
    await restoreDump(
      executor,
      containerName,
      CHECKSUM_DATABASE,
      runId,
      'source.dump',
      childEnvironment,
    );
    await runPsql(
      executor,
      containerName,
      CHECKSUM_DATABASE,
      `UPDATE public.flyway_schema_history
       SET checksum = checksum + 1
       WHERE installed_rank = (
           SELECT max(installed_rank)
           FROM public.flyway_schema_history
       );`,
      childEnvironment,
    );
    await runMavenPhase({
      executor,
      root,
      jdbcUrl: assertLoopbackJdbcUrl(
        `jdbc:postgresql://127.0.0.1:${port}/${CHECKSUM_DATABASE}`,
      ),
      password,
      phase: 'validate',
      snapshotPath,
      evidencePath: join(directory, 'checksum-evidence.json'),
      expectFailure: true,
    });

    await createDatabase(
      executor,
      containerName,
      VERSION_DATABASE,
      childEnvironment,
    );
    await restoreDump(
      executor,
      containerName,
      VERSION_DATABASE,
      runId,
      'source.dump',
      childEnvironment,
    );
    await runPsql(
      executor,
      containerName,
      VERSION_DATABASE,
      `DELETE FROM public.flyway_schema_history
       WHERE installed_rank = (
           SELECT max(installed_rank)
           FROM public.flyway_schema_history
       );`,
      childEnvironment,
    );
    await runMavenPhase({
      executor,
      root,
      jdbcUrl: assertLoopbackJdbcUrl(
        `jdbc:postgresql://127.0.0.1:${port}/${VERSION_DATABASE}`,
      ),
      password,
      phase: 'validate',
      snapshotPath,
      evidencePath: join(directory, 'version-evidence.json'),
      expectFailure: true,
    });

    await createDatabase(
      executor,
      containerName,
      RESTORE_DATABASE,
      childEnvironment,
    );
    await restoreDump(
      executor,
      containerName,
      RESTORE_DATABASE,
      runId,
      'source.dump',
      childEnvironment,
    );
    await runMavenPhase({
      executor,
      root,
      jdbcUrl: assertLoopbackJdbcUrl(
        `jdbc:postgresql://127.0.0.1:${port}/${RESTORE_DATABASE}`,
      ),
      password,
      phase: 'validate',
      snapshotPath,
      evidencePath: javaEvidencePath,
    });
    const evidence = await readEvidence(
      javaEvidencePath,
      migrations.length,
    );
    return evidence;
  } catch (error) {
    primaryError = gateError(
      error,
      'backup-restore-rehearsal-internal',
    );
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
          OWNER_LABEL,
          true,
        );
      }
    } catch (error) {
      cleanupError = error;
    }
    try {
      await removeOwnedTemporaryDirectory(
        directory,
        runId,
        TEMPORARY_PREFIX,
      );
    } catch (error) {
      cleanupError ??= error;
    }
    if (!primaryError && cleanupError) {
      throw cleanupError;
    }
  }
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
  try {
    parseArgs(argv);
  } catch {
    fail(logger, 'backup-restore-arguments');
    return 2;
  }

  try {
    const manifest = await readManifest(root);
    const migrations = await scanMigrations(root);
    buildCandidateManifest(manifest, migrations, false);
    if (migrations.at(-1)?.version !== EXPECTED_LATEST_MIGRATION) {
      throw new GateError('latest-migration-contract');
    }
    pass(logger, 'migration-manifest-v1-v80');

    const evidence = await runRehearsal(root, migrations, executor);
    const finalEvidence = {
      ...evidence,
      negativeChecks: {
        truncatedDumpRejected: true,
        wrongFormatRejected: true,
        nonEmptyTargetRejected: true,
        wrongSchemaRejected: true,
        pgRestoreNonZero: true,
        versionMismatchRejected: true,
        checksumMismatchRejected: true,
      },
      cleanupOwnershipValidated: true,
    };
    assertEvidence(finalEvidence, migrations.length);
    pass(logger, 'postgres16-custom-dump');
    pass(logger, 'fresh-database-restore');
    pass(logger, 'flyway-history-and-validate');
    pass(logger, 'schema-constraints-and-indexes');
    pass(logger, 'synthetic-data-consistency');
    pass(logger, 'hibernate-schema-validation');
    pass(logger, 'negative-restore-cases');
    pass(logger, 'owned-resource-cleanup');
    pass(logger, 'zero-skipped');
    logger(`[EVIDENCE]\t${JSON.stringify(finalEvidence)}`);
    return 0;
  } catch (error) {
    const failure = gateError(
      error,
      'backup-restore-rehearsal-internal',
    );
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
