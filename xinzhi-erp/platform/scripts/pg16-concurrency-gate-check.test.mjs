import assert from 'node:assert/strict';
import test from 'node:test';

import {
  inspectConcurrencyGateReport,
} from './pg16-concurrency-gate-check.mjs';

const suite =
  'cn.xzkj.erp.security.CrossModulePostgresqlConcurrencyGateTest';

function report({
  tests = 2,
  failures = 0,
  errors = 0,
  skipped = 0,
  evidence = true,
  testcontainersFromClasspath = false,
} = {}) {
  const testCases = Array.from(
    { length: tests },
    (_, index) => `<testcase name="case-${index}"/>`,
  ).join('');
  const proof = evidence
    ? `
      ${testcontainersFromClasspath
        ? '/testcontainers/1.21.4/testcontainers-1.21.4.jar'
        : 'Testcontainers version: 1.21.4'}
      postgres:16-alpine
      (PostgreSQL 16.14)
      now at version v39`
    : '';
  return `
    <testsuite name="${suite}" tests="${tests}" failures="${failures}"
      errors="${errors}" skipped="${skipped}">
      ${proof}
      ${testCases}
    </testsuite>`;
}

test('accepts a non-empty clean report with runner evidence', () => {
  assert.deepEqual(inspectConcurrencyGateReport(report()), {
    suite,
    tests: 2,
    failures: 0,
    errors: 0,
    skipped: 0,
  });
});

test('accepts Testcontainers version proof from the Surefire classpath', () => {
  assert.equal(
    inspectConcurrencyGateReport(
      report({ testcontainersFromClasspath: true }),
    ).tests,
    2,
  );
});

test('rejects zero tests', () => {
  assert.throws(
    () => inspectConcurrencyGateReport(report({ tests: 0 })),
    /zero tests/,
  );
});

test('rejects failures, errors, and skips', () => {
  for (const field of ['failures', 'errors', 'skipped']) {
    assert.throws(
      () => inspectConcurrencyGateReport(report({ [field]: 1 })),
      /not clean/,
    );
  }
});

test('rejects missing Docker, Testcontainers, PG16, migration, or API proof', () => {
  assert.throws(
    () => inspectConcurrencyGateReport(report({ evidence: false })),
    /lacks evidence/,
  );
});

test('rejects a testcase count mismatch', () => {
  assert.throws(
    () => inspectConcurrencyGateReport(
      report().replace('<testcase name="case-1"/>', ''),
    ),
    /testcase count mismatch/,
  );
});
