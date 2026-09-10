import assert from 'node:assert/strict';
import {
  access,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assertEmptyRestoreTarget,
  assertEvidence,
  assertInternalDatabaseName,
  assertNode24,
  main,
  parseArgs,
} from './pg16-backup-restore-rehearsal.mjs';
import {
  removeOwnedContainer,
  removeOwnedTemporaryDirectory,
  spawnProcess,
} from './flyway-migration-rehearsal.mjs';

const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const OWNER_LABEL = 'cn.xzkj.erp.backup-restore-rehearsal';
const TEMPORARY_PREFIX = 'xz-erp-pg16-backup-restore-';

function validEvidence(overrides = {}) {
  return {
    schemaVersion: 1,
    postgresMajor: 16,
    latestMigration: '80',
    migrationSuccessfulCount: 54,
    syntheticDatasetVersion: 'v1-v80-synthetic-1',
    dumpFormat: 'custom',
    counts: {
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
    },
    countsMatched: true,
    constraintsValidated: true,
    indexesValidated: true,
    tenantIsolationValidated: true,
    passwordHashesSyntheticOnly: true,
    auditRowsValidated: true,
    sequenceUuidTimeValidated: true,
    flywayValidated: true,
    hibernateValidated: true,
    negativeChecks: {
      truncatedDumpRejected: true,
      wrongFormatRejected: true,
      nonEmptyTargetRejected: true,
      wrongSchemaRejected: true,
      pgRestoreNonZero: true,
      versionMismatchRejected: true,
      checksumMismatchRejected: true,
    },
    skipped: 0,
    cleanupOwnershipValidated: true,
    ...overrides,
  };
}

test('CLI accepts no operator target, name, or path arguments', () => {
  assert.deepEqual(parseArgs([]), {});
  for (const unsafe of [
    ['--jdbc-url', 'jdbc:postgresql://127.0.0.1:5432/current'],
    ['--container', 'running-erp-postgres'],
    ['--dump-path', '../outside.dump'],
    ['--database', 'backup_restore_target'],
    ['--help'],
  ]) {
    assert.throws(() => parseArgs(unsafe), /invalid invocation/);
  }
});

test('Node 24 and fixed internal database names fail closed', () => {
  assert.doesNotThrow(() => assertNode24('24.16.0'));
  assert.throws(() => assertNode24('22.18.0'), /node24-required/);
  assert.equal(
    assertInternalDatabaseName('backup_restore_target'),
    'backup_restore_target',
  );
  for (const unsafe of [
    'xz_erp',
    'backup_restore_target;DROP DATABASE current',
    '../backup_restore_target',
    'backup_restore_unknown',
  ]) {
    assert.throws(
      () => assertInternalDatabaseName(unsafe),
      /database-target-safety/,
    );
  }
});

test('restore preflight accepts only a completely empty target', async () => {
  const calls = [];
  const emptyExecutor = async (command, args, options) => {
    calls.push({ command, args, options });
    return { code: 0, stdout: '0\n' };
  };
  await assertEmptyRestoreTarget(
    emptyExecutor,
    'owned-container',
    'backup_restore_target',
    {},
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'docker');
  assert.deepEqual(calls[0].args.slice(0, 4), [
    'exec',
    '--user',
    'postgres',
    'owned-container',
  ]);
  assert.equal(calls[0].args.includes('psql'), true);
  assert.equal(calls[0].options.capture, true);

  for (const objectCount of ['1\n', '2\n', 'unexpected\n']) {
    await assert.rejects(
      assertEmptyRestoreTarget(
        async () => ({ code: 0, stdout: objectCount }),
        'owned-container',
        'backup_restore_target',
        {},
      ),
      /restore-target-not-empty/,
    );
  }
});

test('evidence requires all validations and zero skips', () => {
  assert.doesNotThrow(() => assertEvidence(validEvidence(), 54));
  assert.throws(
    () => assertEvidence(validEvidence({ skipped: 1 }), 54),
    /backup-restore-evidence/,
  );
  assert.throws(
    () => assertEvidence(
      validEvidence({ countsMatched: false }),
      54,
    ),
    /backup-restore-evidence/,
  );
  assert.throws(
    () => assertEvidence(
      validEvidence({
        negativeChecks: {
          ...validEvidence().negativeChecks,
          truncatedDumpRejected: false,
        },
      }),
      54,
    ),
    /backup-restore-evidence/,
  );
  assert.throws(
    () => assertEvidence(validEvidence(), 15),
    /backup-restore-evidence/,
  );
});

test('invalid target-like invocation never reaches an executor', async () => {
  let invoked = false;
  const output = [];
  const exitCode = await main(
    ['--dump-path', 'safe.dump;docker rm current'],
    {
      executor: async () => {
        invoked = true;
        return { code: 0, stdout: '' };
      },
      logger: (line) => output.push(line),
    },
  );
  assert.equal(exitCode, 2);
  assert.equal(invoked, false);
  assert.deepEqual(output, ['[FAIL]\tbackup-restore-arguments']);
});

test('argument arrays do not execute command-injection payloads', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'xz-erp-command-test-'));
  try {
    const marker = join(directory, 'injected.txt');
    const payload = `safe;echo injected>${marker}&echo injected>${marker}`;
    const result = await spawnProcess(
      process.execPath,
      ['-e', 'process.stdout.write(process.argv[1])', payload],
      { capture: true },
    );
    assert.equal(result.code, 0);
    assert.equal(result.stdout, payload);
    await assert.rejects(access(marker));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Docker failure is hard, redacted, and emits no evidence', async () => {
  const canary = 'backup-restore-password-canary-do-not-render';
  const output = [];
  const exitCode = await main(
    [],
    {
      root: REPOSITORY_ROOT,
      executor: async () => {
        throw new Error(canary);
      },
      logger: (line) => output.push(line),
    },
  );
  const rendered = output.join('\n');
  assert.equal(exitCode, 1);
  assert.equal(rendered.includes(canary), false);
  assert.equal(rendered.includes('[EVIDENCE]'), false);
  assert.match(rendered, /\[FAIL\]\tdocker-unavailable/);
});

test('image, Java, Maven, and PostgreSQL tools never silently skip', async () => {
  for (const expectedStage of [
    'postgres16-image-unavailable',
    'java-unavailable',
    'maven-unavailable',
    'postgres-tools-unavailable',
  ]) {
    let owner = null;
    const executor = async (command, args) => {
      if (command === 'docker'
          && args[0] === 'image'
          && expectedStage === 'postgres16-image-unavailable') {
        return { code: 1, stdout: 'tool-detail-canary' };
      }
      if (args.includes('java.exe')
          && expectedStage === 'java-unavailable') {
        return { code: 1, stdout: 'tool-detail-canary' };
      }
      if (args.includes('mvn.cmd')
          && args.includes('--version')
          && expectedStage === 'maven-unavailable') {
        return { code: 1, stdout: 'tool-detail-canary' };
      }
      if (command === 'docker' && args[0] === 'run') {
        owner = args[args.indexOf('--label') + 1].split('=').at(-1);
        return { code: 0, stdout: '' };
      }
      if (command === 'docker'
          && args[0] === 'inspect'
          && args.includes('{{.State.Health.Status}}')) {
        return { code: 0, stdout: 'healthy\n' };
      }
      if (command === 'docker'
          && args[0] === 'exec'
          && args.includes('pg_dump')
          && args.includes('--version')
          && expectedStage === 'postgres-tools-unavailable') {
        return { code: 1, stdout: 'tool-detail-canary' };
      }
      if (command === 'docker'
          && args[0] === 'inspect'
          && args.some((arg) => arg.includes('.Config.Labels'))) {
        return { code: 0, stdout: `${owner}\n` };
      }
      return { code: 0, stdout: '' };
    };
    const output = [];
    const exitCode = await main(
      [],
      {
        root: REPOSITORY_ROOT,
        executor,
        logger: (line) => output.push(line),
      },
    );
    const rendered = output.join('\n');
    assert.equal(exitCode, 1);
    assert.match(rendered, new RegExp(`\\[FAIL\\]\\t${expectedStage}`));
    assert.equal(rendered.includes('[EVIDENCE]'), false);
    assert.equal(rendered.includes('tool-detail-canary'), false);
  }
});

test('cleanup refuses a container with a changed ownership label', async () => {
  let removalAttempted = false;
  const executor = async (command, args) => {
    if (command === 'docker' && args[0] === 'inspect') {
      return { code: 0, stdout: 'different-owner\n' };
    }
    if (command === 'docker' && args[0] === 'rm') {
      removalAttempted = true;
    }
    return { code: 0, stdout: '' };
  };
  await assert.rejects(
    removeOwnedContainer(
      executor,
      'owned-container',
      'expected-owner',
      {},
      OWNER_LABEL,
    ),
    /cleanup-ownership/,
  );
  assert.equal(removalAttempted, false);
});

test('deliverable cleanup requires a successful ownership inspection', async () => {
  await assert.rejects(
    removeOwnedContainer(
      async () => ({ code: 1, stdout: '' }),
      'owned-container',
      'expected-owner',
      {},
      OWNER_LABEL,
      true,
    ),
    /cleanup-container-inspection/,
  );
});

test('cleanup label injection cannot reach Docker', async () => {
  let invoked = false;
  await assert.rejects(
    removeOwnedContainer(
      async () => {
        invoked = true;
        return { code: 0, stdout: '' };
      },
      'owned-container',
      'expected-owner',
      {},
      'label"}} malicious-template',
      true,
    ),
    /cleanup-ownership/,
  );
  assert.equal(invoked, false);
});

test('cleanup refuses a temporary directory with a changed owner', async () => {
  const directory = await mkdtemp(join(tmpdir(), TEMPORARY_PREFIX));
  try {
    await writeFile(
      join(directory, '.owner'),
      'different-owner',
      'utf8',
    );
    await assert.rejects(
      removeOwnedTemporaryDirectory(
        directory,
        'expected-owner',
        TEMPORARY_PREFIX,
      ),
      /cleanup-ownership/,
    );
    assert.equal(
      (await readFile(join(directory, '.owner'), 'utf8')),
      'different-owner',
    );
    await writeFile(
      join(directory, '.owner'),
      'expected-owner',
      'utf8',
    );
    await removeOwnedTemporaryDirectory(
      directory,
      'expected-owner',
      TEMPORARY_PREFIX,
    );
    await assert.rejects(access(directory));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('implementation never enables shell execution', async () => {
  const source = await readFile(
    join(dirname(fileURLToPath(import.meta.url)),
      'pg16-backup-restore-rehearsal.mjs'),
    'utf8',
  );
  assert.equal(source.includes('shell: true'), false);
  assert.equal(source.includes('process.env.ERP_'), false);
  assert.equal(/['"]\.env['"]/.test(source), false);
});
