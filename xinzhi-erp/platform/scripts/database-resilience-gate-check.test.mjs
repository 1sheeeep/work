import assert from 'node:assert/strict';
import test from 'node:test';

import {
  inspectReport,
  inspectSources,
  main,
  parseArgs,
} from './database-resilience-gate-check.mjs';

const SAFE = {
  pom: '<version>4.1.0</version>\n'
    + '<testcontainers.version>1.21.4</testcontainers.version>',
  production: 'include: livenessState\ninclude: readinessState,db\n'
    + 'show-details: never\nshow-components: never',
  safety: '"management.endpoint.health.group.liveness.include",'
    + '"livenessState"'
    + '"management.endpoint.health.group.readiness.include",'
    + '"readinessState,db"',
  filter: 'catch (DataAccessResourceFailureException unavailable) {'
    + ' SC_SERVICE_UNAVAILABLE "service_unavailable"'
    + ' "Service is temporarily unavailable"'
    + ' HttpHeaders.CACHE_CONTROL, "no-store" }',
  sanitizer: '@Profile("production") DataSourceHealthIndicator '
    + 'org.hibernate.orm.jdbc.error com.zaxxer.hikari.pool.PoolBase '
    + 'com.zaxxer.hikari.pool.ProxyConnection FilterReply.DENY '
    + 'startsWith("08")',
  gate: 'class DatabaseResiliencePostgresql16GateTest { '
    + '"postgres:16-alpine" DATABASE_RESILIENCE_GATE_EVIDENCE '
    + '"tests=1 failures=0 skipped=0"; }',
  mainRuntime: 'class Runtime {}',
};

function find(results, rule) {
  return results.find((result) => result.rule === rule);
}

test('safe source facts pass', () => {
  assert.equal(
    inspectSources(SAFE).every(({ status }) => status === 'PASS'),
    true,
  );
});

test('production Hikari or transaction thresholds require explicit review', () => {
  const hikari = inspectSources({
    ...SAFE,
    production: `${SAFE.production}\n`
      + 'spring.datasource.hikari.maximum-pool-size: 42',
  });
  assert.equal(
    find(hikari, 'production-hikari-threshold-review').status,
    'FAIL',
  );

  const transaction = inspectSources({
    ...SAFE,
    mainRuntime: '@Transactional(timeout = 9) void mutate() {}',
  });
  assert.equal(
    find(transaction, 'production-transaction-timeout-review').status,
    'FAIL',
  );
});

test('broad authentication catches fail the boundary', () => {
  const results = inspectSources({
    ...SAFE,
    filter: `${SAFE.filter}\ncatch (RuntimeException failure) {}`,
  });
  assert.equal(
    find(results, 'authentication-database-fail-closed').status,
    'FAIL',
  );
});

test('report must contain a non-skipped PG16 16.14 result and evidence', () => {
  const good = `<testsuite
    name="cn.xzkj.erp.config.DatabaseResiliencePostgresql16GateTest"
    tests="1" failures="0" errors="0" skipped="0">
    DATABASE_RESILIENCE_GATE_EVIDENCE testcontainers=1.21.4
    image=postgres:16-alpine postgresql=16.14 flyway=39
    hikari=7.0.2 spring-tx=7.0.8 tests=1 failures=0 skipped=0
  </testsuite>`;
  assert.equal(
    inspectReport(good).every(({ status }) => status === 'PASS'),
    true,
  );
  assert.equal(
    find(
      inspectReport(good.replace('skipped="0"', 'skipped="1"')),
      'pg16-runtime-gate-result',
    ).status,
    'FAIL',
  );
});

test('all arguments are rejected without rendering their values', async () => {
  assert.doesNotThrow(() => parseArgs([]));
  assert.throws(() => parseArgs(['--root', 'jdbc:canary']));
  const output = [];
  assert.equal(
    await main(['--root', 'jdbc:canary'], (line) => output.push(line)),
    2,
  );
  assert.deepEqual(output, ['[FAIL]\tchecker-arguments\t.']);
  assert.equal(output.join('').includes('jdbc:canary'), false);
});
