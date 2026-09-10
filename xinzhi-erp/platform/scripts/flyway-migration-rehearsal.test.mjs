import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  assertLoopbackJdbcUrl,
  buildCandidateManifest,
  main,
  readManifest,
  resolveInsideRoot,
  scanMigrations,
  spawnProcess,
} from './flyway-migration-rehearsal.mjs';

const MANIFEST =
  'platform/scripts/flyway-migration-manifest.json';
const MIGRATIONS =
  'platform/backend/src/main/resources/db/migration';

function hash(content) {
  return createHash('sha256').update(content).digest('hex');
}

async function write(root, relativePath, content) {
  const path = resolveInsideRoot(root, relativePath);
  await mkdir(resolve(path, '..'), { recursive: true });
  await writeFile(path, content, 'utf8');
}

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'xz-erp-flyway-test-'));
  const migrationContents = new Map([
    ['V1__baseline.sql', '-- v1\n'],
    ['V38__previous.sql', '-- v38\n'],
    ['V39__latest.sql', '-- v39\n'],
  ]);
  for (const [name, content] of migrationContents) {
    await write(root, `${MIGRATIONS}/${name}`, content);
  }
  await write(
    root,
    MANIFEST,
    `${JSON.stringify({
      schemaVersion: 1,
      algorithm: 'sha256',
      migrations: [
        {
          version: 1,
          file: 'V1__baseline.sql',
          sha256: hash('-- v1\n'),
        },
        {
          version: 38,
          file: 'V38__previous.sql',
          sha256: hash('-- v38\n'),
        },
        {
          version: 39,
          file: 'V39__latest.sql',
          sha256: hash('-- v39\n'),
        },
      ],
    }, null, 2)}\n`,
  );
  await mkdir(resolveInsideRoot(root, 'platform/backend'), {
    recursive: true,
  });
  return root;
}

async function withFixture(callback) {
  const root = await createFixture();
  try {
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function ownedFakeExecutor({
  mavenResult = 0,
  secret = null,
  evidenceOverrides = {},
} = {}) {
  let ownerId = null;
  const calls = [];
  const executor = async (command, args, options = {}) => {
    calls.push({ command, args });
    if (command === 'docker' && args[0] === 'run') {
      const label = args[args.indexOf('--label') + 1];
      ownerId = label.split('=').at(-1);
      return { code: 0, stdout: '' };
    }
    if (command === 'docker'
        && args[0] === 'inspect'
        && args.includes('{{.State.Health.Status}}')) {
      return { code: 0, stdout: 'healthy\n' };
    }
    if (command === 'docker' && args[0] === 'port') {
      return { code: 0, stdout: '127.0.0.1:55432\n' };
    }
    if (command === 'docker'
        && args[0] === 'inspect'
        && args.some((arg) => arg.includes('.Config.Labels'))) {
      return { code: 0, stdout: `${ownerId}\n` };
    }
    if (command === 'mvn'
        || command === 'mvn.cmd'
        || args.includes(
          '-Dtest=cn.xzkj.erp.config.FlywayMigrationRehearsalIT',
        )) {
      if (mavenResult === 0) {
        const evidence = {
          schemaVersion: 1,
          postgresMajor: 16,
          latestVersion: '39',
          migrationCount: 3,
          skipped: 0,
          checks: {
            emptyDatabaseV1ToLatest: true,
            upgradeV38ToLatest: true,
            validateSucceeded: true,
            duplicateRejected: true,
            tamperRejected: true,
            failedDatabaseNotDeliverable: true,
            applicationNotStarted: true,
          },
        };
        await writeFile(
          options.env.XZ_ERP_FLYWAY_REHEARSAL_EVIDENCE,
          JSON.stringify({ ...evidence, ...evidenceOverrides }),
          'utf8',
        );
      }
      return { code: mavenResult, stdout: secret ?? '' };
    }
    return { code: 0, stdout: '' };
  };
  return { executor, calls };
}

test('repository-only check verifies the deterministic manifest', async () => {
  await withFixture(async (root) => {
    const output = [];
    const exitCode = await main(
      ['--check-only'],
      { root, logger: (line) => output.push(line) },
    );
    assert.equal(exitCode, 0);
    assert.deepEqual(output, [
      '[PASS]\tmigration-filename-order',
      '[PASS]\tmigration-checksum-integrity',
      '[PASS]\trepository-only-check',
    ]);
  });
});

test('tampered historical migration fails without rendering content', async () => {
  await withFixture(async (root) => {
    const canary = 'tampered-sql-canary-do-not-render';
    await write(
      root,
      `${MIGRATIONS}/V38__previous.sql`,
      `-- v38\n-- ${canary}\n`,
    );
    const output = [];
    const exitCode = await main(
      ['--check-only'],
      { root, logger: (line) => output.push(line) },
    );
    assert.equal(exitCode, 1);
    assert.equal(output.join('\n').includes(canary), false);
    assert.deepEqual(output, ['[FAIL]\tmigration-checksum-integrity']);
  });
});

test('duplicate and out-of-order versions fail closed', async () => {
  await withFixture(async (root) => {
    await write(root, `${MIGRATIONS}/V39__duplicate.sql`, '-- duplicate\n');
    await assert.rejects(scanMigrations(root), /migration-filename-order/);
  });
  await withFixture(async (root) => {
    await write(root, `${MIGRATIONS}/V37__late_insert.sql`, '-- inserted\n');
    const manifest = await readManifest(root);
    const migrations = await scanMigrations(root);
    assert.throws(
      () => buildCandidateManifest(manifest, migrations, true),
      /migration-checksum-integrity/,
    );
  });
});

test('a reviewed later version has an explicit append workflow', async () => {
  await withFixture(async (root) => {
    await write(root, `${MIGRATIONS}/V40__future.sql`, '-- future\n');
    const manifest = await readManifest(root);
    const migrations = await scanMigrations(root);
    assert.throws(
      () => buildCandidateManifest(manifest, migrations, false),
      /migration-manifest-update-required/,
    );
    const candidate = buildCandidateManifest(manifest, migrations, true);
    assert.equal(candidate.migrations.at(-1).version, 40);
    assert.equal(candidate.migrations.at(-1).file, 'V40__future.sql');
    assert.equal(candidate.migrations.length, 4);

    const originalSql = await readFile(
      resolveInsideRoot(root, `${MIGRATIONS}/V40__future.sql`),
      'utf8',
    );
    const fake = ownedFakeExecutor({
      evidenceOverrides: {
        latestVersion: '40',
        migrationCount: 4,
      },
    });
    const exitCode = await main(
      ['--update-manifest'],
      { root, executor: fake.executor, logger: () => {} },
    );
    assert.equal(exitCode, 0);
    assert.equal(
      (await readManifest(root)).migrations.at(-1).version,
      40,
    );
    assert.equal(
      await readFile(
        resolveInsideRoot(root, `${MIGRATIONS}/V40__future.sql`),
        'utf8',
      ),
      originalSql,
    );
  });
});

test('path traversal, absolute paths, and symlink-like NUL input are rejected', () => {
  const root = join(tmpdir(), 'xz-erp-root');
  assert.throws(
    () => resolveInsideRoot(root, '../outside'),
    /repository-path-safety/,
  );
  assert.throws(
    () => resolveInsideRoot(root, resolve(root, 'outside')),
    /repository-path-safety/,
  );
  assert.throws(
    () => resolveInsideRoot(root, 'platform/\0escape'),
    /repository-path-safety/,
  );
});

test('database target validator permits loopback only and no credentials', () => {
  assert.equal(
    assertLoopbackJdbcUrl(
      'jdbc:postgresql://127.0.0.1:5432/rehearsal',
    ),
    'jdbc:postgresql://127.0.0.1:5432/rehearsal',
  );
  for (const unsafe of [
    'jdbc:postgresql://database.internal:5432/rehearsal',
    'jdbc:postgresql://10.0.0.8:5432/rehearsal',
    'jdbc:postgresql://user:secret@127.0.0.1:5432/rehearsal',
    'jdbc:postgresql://127.0.0.1:5432/xz-erp',
  ]) {
    assert.throws(
      () => assertLoopbackJdbcUrl(unsafe),
      /database-target-safety/,
    );
  }
});

test('command execution uses argument arrays with shell disabled', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xz-erp-command-test-'));
  try {
    const marker = join(root, 'injected.txt');
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
    await rm(root, { recursive: true, force: true });
  }
});

test('invalid target-like CLI input cannot reach a command executor', async () => {
  let invoked = false;
  const output = [];
  const exitCode = await main(
    [
      '--database-url',
      'jdbc:postgresql://127.0.0.1:5432/db;docker rm something',
    ],
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
  assert.deepEqual(output, ['[FAIL]\trehearsal-arguments']);
});

test('child failure never echoes secrets or reports deliverable', async () => {
  await withFixture(async (root) => {
    const canary = 'rehearsal-password-canary-do-not-echo';
    const output = [];
    const fake = ownedFakeExecutor({ mavenResult: 1, secret: canary });
    const exitCode = await main(
      [],
      {
        root,
        executor: fake.executor,
        logger: (line) => output.push(line),
      },
    );
    const rendered = output.join('\n');
    assert.equal(exitCode, 1);
    assert.equal(rendered.includes(canary), false);
    assert.equal(rendered.includes('[PASS]\tapplication-not-started'), false);
    assert.match(rendered, /\[FAIL\]\tflyway-pg16-rehearsal/);
  });
});

test('successful evidence requires zero skips and owned cleanup', async () => {
  await withFixture(async (root) => {
    const output = [];
    const fake = ownedFakeExecutor();
    const exitCode = await main(
      [],
      {
        root,
        executor: fake.executor,
        logger: (line) => output.push(line),
      },
    );
    assert.equal(exitCode, 0);
    assert.match(output.join('\n'), /\[PASS\]\tzero-skipped/);
    assert.equal(
      fake.calls.some(({ command, args }) =>
        command === 'docker'
        && args[0] === 'rm'
        && args[1] === '--force'),
      true,
    );
  });
});

test('Docker unavailability and skipped evidence are hard failures', async () => {
  await withFixture(async (root) => {
    const output = [];
    const exitCode = await main(
      [],
      {
        root,
        executor: async () => {
          throw new Error('canary detail must stay hidden');
        },
        logger: (line) => output.push(line),
      },
    );
    assert.equal(exitCode, 1);
    assert.deepEqual(output, [
      '[PASS]\tmigration-filename-order',
      '[PASS]\tmigration-checksum-integrity',
      '[FAIL]\tdocker-unavailable',
      '[HINT]\tStart Docker and pre-load the repository-pinned PostgreSQL 16 image.',
    ]);
  });
  await withFixture(async (root) => {
    const output = [];
    const fake = ownedFakeExecutor({
      evidenceOverrides: { skipped: 1 },
    });
    const exitCode = await main(
      [],
      {
        root,
        executor: fake.executor,
        logger: (line) => output.push(line),
      },
    );
    assert.equal(exitCode, 1);
    assert.equal(output.includes('[PASS]\tzero-skipped'), false);
    assert.equal(output.at(-1), '[FAIL]\tmigration-evidence');
  });
});

test('cleanup refuses a container whose ownership label changed', async () => {
  await withFixture(async (root) => {
    let removeAttempted = false;
    const base = ownedFakeExecutor({ mavenResult: 1 });
    const executor = async (command, args, options) => {
      if (command === 'docker'
          && args[0] === 'inspect'
          && args.some((arg) => arg.includes('.Config.Labels'))) {
        return { code: 0, stdout: 'different-owner\n' };
      }
      if (command === 'docker' && args[0] === 'rm') {
        removeAttempted = true;
      }
      return base.executor(command, args, options);
    };
    const exitCode = await main([], { root, executor, logger: () => {} });
    assert.equal(exitCode, 1);
    assert.equal(removeAttempted, false);
  });
});
