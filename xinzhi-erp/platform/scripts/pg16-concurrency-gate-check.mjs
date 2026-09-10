import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const SUITE = 'cn.xzkj.erp.security.CrossModulePostgresqlConcurrencyGateTest';
const DEFAULT_REPORT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../backend/target/surefire-reports',
  `TEST-${SUITE}.xml`,
);

function attribute(openingTag, name) {
  const match = openingTag.match(new RegExp(`\\b${name}="([0-9]+)"`));
  if (!match) {
    throw new Error(`Surefire report is missing testsuite attribute: ${name}`);
  }
  return Number.parseInt(match[1], 10);
}

export function inspectConcurrencyGateReport(xml) {
  const openingTag = xml.match(/<testsuite\b[^>]*>/)?.[0];
  if (!openingTag) {
    throw new Error('Surefire report does not contain a testsuite');
  }
  if (!openingTag.includes(`name="${SUITE}"`)) {
    throw new Error(`Unexpected Surefire suite; expected ${SUITE}`);
  }

  const tests = attribute(openingTag, 'tests');
  const failures = attribute(openingTag, 'failures');
  const errors = attribute(openingTag, 'errors');
  const skipped = attribute(openingTag, 'skipped');
  if (tests <= 0) {
    throw new Error('Concurrency gate ran zero tests');
  }
  if (failures !== 0 || errors !== 0 || skipped !== 0) {
    throw new Error(
      `Concurrency gate is not clean: tests=${tests}, failures=${failures}, `
        + `errors=${errors}, skipped=${skipped}`,
    );
  }

  const testCases = [...xml.matchAll(/<testcase\b/g)].length;
  if (testCases !== tests) {
    throw new Error(
      `Surefire testcase count mismatch: declared=${tests}, found=${testCases}`,
    );
  }

  const requiredEvidence = [
    ['Testcontainers 1.21.4',
      'Testcontainers version: 1.21.4',
      '/testcontainers/1.21.4/testcontainers-1.21.4.jar'],
    ['owned PostgreSQL image', 'postgres:16-alpine'],
    ['PostgreSQL major version', '(PostgreSQL 16.'],
    ['Flyway schema version', 'now at version v39'],
  ];
  for (const [label, ...alternatives] of requiredEvidence) {
    if (!alternatives.some((evidence) => xml.includes(evidence))) {
      throw new Error(`Concurrency gate report lacks evidence: ${label}`);
    }
  }

  return { suite: SUITE, tests, failures, errors, skipped };
}

export async function checkConcurrencyGateReport(reportPath = DEFAULT_REPORT) {
  const xml = await readFile(reportPath, 'utf8');
  return inspectConcurrencyGateReport(xml);
}

async function main() {
  const reportPath = process.argv[2]
    ? resolve(process.cwd(), process.argv[2])
    : DEFAULT_REPORT;
  const result = await checkConcurrencyGateReport(reportPath);
  process.stdout.write(`${JSON.stringify({ reportPath, ...result })}\n`);
}

if (process.argv[1]
    && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`PG16 concurrency gate check failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
