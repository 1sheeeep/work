import assert from 'node:assert/strict';
import test from 'node:test';

import {
  inspectMigrations,
  inspectReport,
  inspectSources,
  main,
  parseArgs,
} from './schema-drift-gate-check.mjs';

const SAFE = {
  pom: '<version>4.1.0</version>\n'
    + '<java.version>25</java.version>\n'
    + '<testcontainers.version>1.21.4</testcontainers.version>',
  application: 'ddl-auto: validate\nlocations: classpath:db/migration',
  tenantBase: '@MappedSuperclass '
    + '@Column(name = "tenant_id", nullable = false, updatable = false) '
    + '@Version @Column(nullable = false)',
  systemBase: '@MappedSuperclass @Version @Column(nullable = false)',
  gate: 'new PostgreSQLContainer<>(IMAGE) '
    + 'private static final String IMAGE = "postgres:16-alpine"; '
    + '.locations("classpath:db/migration") .cleanDisabled(true) '
    + '"spring.jpa.hibernate.ddl-auto", "validate" '
    + 'assertJpaColumnsMatchCatalog assertCrossTenantReferencesFail '
    + 'assertMutatedSchemaFailsClosed SCHEMA_DRIFT_GATE_EVIDENCE '
    + 'tests=1 failures=0 skipped=0',
  contract: 'V1→V73 V74 不是产品合同 有意的数据库强化 危险漂移 '
    + '不读取 `.env` 0 skipped',
};

const MIGRATIONS = [
  1, 10, 20, 21, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39,
  40, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54,
  55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68,
  69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89,
].map((version) => `V${version}__migration.sql`);

function find(results, rule) {
  return results.find((result) => result.rule === rule);
}

test('reviewed source and migration facts pass', () => {
  assert.equal(
    inspectSources(SAFE).every(({ status }) => status === 'PASS'),
    true,
  );
  assert.equal(
    inspectMigrations(MIGRATIONS)
      .every(({ status }) => status === 'PASS'),
    true,
  );
});

test('runtime gate source fails closed for external input or a skip path', () => {
  for (const unsafe of [
    'System.getenv("ERP_DB_URL")',
    'System.getProperty("jdbc.url")',
    '@Disabled',
    'Assumptions.',
  ]) {
    const results = inspectSources({
      ...SAFE,
      gate: `${SAFE.gate}\n${unsafe}`,
    });
    assert.equal(
      find(results, 'isolated-pg16-runtime-gate-source').status,
      'FAIL',
    );
  }
});

test('migration boundary rejects missing history files and duplicates', () => {
  assert.equal(
    find(
      inspectMigrations(MIGRATIONS.filter((name) => !name.startsWith('V31__'))),
      'flyway-v1-v89-boundary',
    ).status,
    'FAIL',
  );
  assert.equal(
    find(
      inspectMigrations([...MIGRATIONS, 'V39__duplicate.sql']),
      'flyway-v1-v89-boundary',
    ).status,
    'FAIL',
  );
});

test('report requires one complete non-skipped PG16 evidence result', () => {
  const good = `<testsuite
    name="cn.xzkj.erp.persistence.SchemaDriftPostgresql16GateTest"
    tests="1" failures="0" errors="0" skipped="0">
    SCHEMA_DRIFT_GATE_EVIDENCE testcontainers=1.21.4
    image=postgres:16-alpine postgresql=16 flyway=80 mapped_entities=30
    hibernate_validate=passed catalog=passed tenant_negative=passed
    mutation_negative=passed tests=1 failures=0 skipped=0
  </testsuite>`;
  assert.equal(
    inspectReport(good).every(({ status }) => status === 'PASS'),
    true,
  );
  for (const bad of [
    good.replace('skipped="0"', 'skipped="1"'),
    good.replace('catalog=passed', 'catalog=failed'),
    good.replace('mapped_entities=30', 'mapped_entities=29'),
  ]) {
    assert.equal(
      inspectReport(bad).some(({ status }) => status === 'FAIL'),
      true,
    );
  }
});

test('arguments are rejected without echoing their values', async () => {
  assert.doesNotThrow(() => parseArgs([]));
  assert.throws(() => parseArgs(['--jdbc', 'jdbc:canary']));
  const output = [];
  assert.equal(
    await main(
      ['--jdbc', 'jdbc:canary'],
      (line) => output.push(line),
    ),
    2,
  );
  assert.deepEqual(output, ['[FAIL]\tchecker-arguments\t.']);
  assert.equal(output.join('').includes('jdbc:canary'), false);
});
