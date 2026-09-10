import {
  lstat,
  readFile,
  realpath,
  readdir,
} from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SCRIPT), '../..');
const REPORT = 'platform/backend/target/surefire-reports/'
  + 'TEST-cn.xzkj.erp.persistence.SchemaDriftPostgresql16GateTest.xml';

const FIXED_FILES = Object.freeze({
  pom: 'platform/backend/pom.xml',
  application: 'platform/backend/src/main/resources/application.yml',
  tenantBase:
    'platform/backend/src/main/java/cn/xzkj/erp/platform/domain/'
    + 'TenantOwnedEntity.java',
  systemBase:
    'platform/backend/src/main/java/cn/xzkj/erp/platform/domain/'
    + 'SystemManagedEntity.java',
  gate:
    'platform/backend/src/test/java/cn/xzkj/erp/persistence/'
    + 'SchemaDriftPostgresql16GateTest.java',
  contract:
    'platform/backend/docs/jpa-flyway-schema-drift-pg16-gate.md',
  report: REPORT,
});

function check(rule, passed, location) {
  return {
    rule,
    status: passed ? 'PASS' : 'FAIL',
    location,
  };
}

function includesAll(content, values) {
  return values.every((value) => content.includes(value));
}

export function inspectSources(sources) {
  return [
    check(
      'fixed-dependency-baseline',
      includesAll(sources.pom, [
        '<version>4.1.0</version>',
        '<java.version>25</java.version>',
        '<testcontainers.version>1.21.4</testcontainers.version>',
      ]),
      FIXED_FILES.pom,
    ),
    check(
      'hibernate-validate-default',
      includesAll(sources.application, [
        'ddl-auto: validate',
        'locations: classpath:db/migration',
      ]),
      FIXED_FILES.application,
    ),
    check(
      'optimistic-lock-mapped-bases',
      includesAll(sources.tenantBase, [
        '@MappedSuperclass',
        '@Column(name = "tenant_id", nullable = false, updatable = false)',
        '@Version',
        '@Column(nullable = false)',
      ]) && includesAll(sources.systemBase, [
        '@MappedSuperclass',
        '@Version',
        '@Column(nullable = false)',
      ]),
      FIXED_FILES.tenantBase,
    ),
    check(
      'isolated-pg16-runtime-gate-source',
      includesAll(sources.gate, [
        'new PostgreSQLContainer<>(IMAGE)',
        'private static final String IMAGE = "postgres:16-alpine"',
        '.locations("classpath:db/migration")',
        '.cleanDisabled(true)',
        '"spring.jpa.hibernate.ddl-auto", "validate"',
        'assertJpaColumnsMatchCatalog',
        'assertCrossTenantReferencesFail',
        'assertMutatedSchemaFailsClosed',
        'SCHEMA_DRIFT_GATE_EVIDENCE',
        'tests=1 failures=0 skipped=0',
      ])
        && !sources.gate.includes('Assumptions.')
        && !sources.gate.includes('System.getenv')
        && !sources.gate.includes('System.getProperty')
        && !sources.gate.includes('@Disabled'),
      FIXED_FILES.gate,
    ),
    check(
      'responsibility-boundary-documented',
      includesAll(sources.contract, [
        'reviewed boundary: V1 through V89',
        'not a product contract',
        'intentional database hardening',
        'dangerous drift',
        'does not read `.env`',
        '0 skipped',
      ]) || includesAll(sources.contract, [
        'V1→V73',
        'V74',
        '不是产品合同',
        '有意的数据库强化',
        '危险漂移',
        '不读取 `.env`',
        '0 skipped',
      ]),
      FIXED_FILES.contract,
    ),
  ];
}

export function inspectMigrations(names) {
  const versions = [];
  let valid = true;
  for (const name of names) {
    const match = /^V([1-9][0-9]*)__[A-Za-z0-9][A-Za-z0-9_-]*\.sql$/
      .exec(name);
    if (!match) {
      valid = false;
      continue;
    }
    versions.push(Number.parseInt(match[1], 10));
  }
  const unique = new Set(versions);
  const expected = [
    1, 10, 20, 21, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39,
    40, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54,
    55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68,
    69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89,
  ];
  return [
    check(
      'flyway-v1-v89-boundary',
      valid
        && versions.length === expected.length
        && unique.size === versions.length
        && expected.every((version) => unique.has(version))
        && Math.max(...versions) === 89,
      'platform/backend/src/main/resources/db/migration',
    ),
  ];
}

function attribute(xml, name) {
  return new RegExp(`\\b${name}="([0-9]+)"`).exec(xml)?.[1];
}

export function inspectReport(xml) {
  const suite =
    xml.includes(
      'name="cn.xzkj.erp.persistence.SchemaDriftPostgresql16GateTest"',
    )
    && attribute(xml, 'tests') === '1'
    && attribute(xml, 'failures') === '0'
    && attribute(xml, 'errors') === '0'
    && attribute(xml, 'skipped') === '0';
  const evidence = includesAll(xml, [
    'SCHEMA_DRIFT_GATE_EVIDENCE',
    'testcontainers=1.21.4',
    'image=postgres:16-alpine',
    'postgresql=16',
    'flyway=80',
    'mapped_entities=30',
    'hibernate_validate=passed',
    'catalog=passed',
    'tenant_negative=passed',
    'mutation_negative=passed',
    'tests=1 failures=0 skipped=0',
  ]);
  return [
    check('pg16-schema-gate-result', suite, REPORT),
    check('pg16-schema-gate-evidence', evidence, REPORT),
  ];
}

export function parseArgs(argv) {
  if (argv.length !== 0) {
    throw new Error('arguments are not accepted');
  }
}

async function safeRead(root, repositoryPath) {
  if (repositoryPath.includes('..')
      || repositoryPath.includes('://')
      || repositoryPath.startsWith('/')
      || /^[A-Za-z]:/.test(repositoryPath)) {
    throw new Error('unsafe fixed path');
  }
  const target = resolve(root, ...repositoryPath.split('/'));
  const targetRelative = relative(root, target);
  if (targetRelative.startsWith(`..${sep}`) || targetRelative === '..') {
    throw new Error('path escaped repository');
  }
  const stat = await lstat(target);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('fixed path is not a regular file');
  }
  const canonical = await realpath(target);
  const canonicalRelative = relative(await realpath(root), canonical);
  if (canonicalRelative.startsWith(`..${sep}`)
      || canonicalRelative === '..') {
    throw new Error('canonical path escaped repository');
  }
  return readFile(target, 'utf8');
}

async function migrationNames(root) {
  const directory = resolve(
    root,
    'platform/backend/src/main/resources/db/migration',
  );
  const canonicalRoot = await realpath(root);
  const canonicalDirectory = await realpath(directory);
  const directoryRelative = relative(canonicalRoot, canonicalDirectory);
  if (directoryRelative.startsWith(`..${sep}`)
      || directoryRelative === '..') {
    throw new Error('migration directory escaped repository');
  }
  const names = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || !entry.isFile()) {
      throw new Error('migration directory contains unsafe entry');
    }
    names.push(entry.name);
  }
  return names.sort();
}

export async function runChecks(root = ROOT) {
  const canonicalRoot = await realpath(root);
  if (canonicalRoot !== await realpath(ROOT)) {
    throw new Error('external root rejected');
  }
  const sources = {};
  for (const [name, path] of Object.entries(FIXED_FILES)) {
    sources[name] = await safeRead(canonicalRoot, path);
  }
  return [
    ...inspectSources(sources),
    ...inspectMigrations(await migrationNames(canonicalRoot)),
    ...inspectReport(sources.report),
  ];
}

export function formatResult(result) {
  return `[${result.status}]\t${result.rule}\t${result.location}`;
}

export async function main(argv, logger = console.log) {
  try {
    parseArgs(argv);
  } catch {
    logger('[FAIL]\tchecker-arguments\t.');
    return 2;
  }
  try {
    const results = await runChecks();
    results.forEach((result) => logger(formatResult(result)));
    return results.some(({ status }) => status === 'FAIL') ? 1 : 0;
  } catch {
    logger('[FAIL]\tchecker-internal\t.');
    return 2;
  }
}

const invoked = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : '';
if (import.meta.url === invoked) {
  process.exitCode = await main(process.argv.slice(2));
}
