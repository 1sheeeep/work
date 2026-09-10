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
  + 'TEST-cn.xzkj.erp.config.DatabaseResiliencePostgresql16GateTest.xml';

const FIXED_FILES = Object.freeze({
  pom: 'platform/backend/pom.xml',
  production:
    'platform/backend/src/main/resources/application-production.yml',
  safety:
    'platform/backend/src/main/java/cn/xzkj/erp/config/'
    + 'ProductionSafetyEnvironmentPostProcessor.java',
  filter:
    'platform/backend/src/main/java/cn/xzkj/erp/iam/security/'
    + 'BearerTokenAuthenticationFilter.java',
  sanitizer:
    'platform/backend/src/main/java/cn/xzkj/erp/config/'
    + 'DatabaseConnectionLogSanitizer.java',
  gate:
    'platform/backend/src/test/java/cn/xzkj/erp/config/'
    + 'DatabaseResiliencePostgresql16GateTest.java',
  report: REPORT,
});

const HIKARI_THRESHOLD = /(?:spring[._-]datasource[._-]hikari[._-](?:maximum[._-]pool[._-]size|minimum[._-]idle|connection[._-]timeout|validation[._-]timeout|idle[._-]timeout|max[._-]lifetime|leak[._-]detection[._-]threshold|initialization[._-]fail[._-]timeout)|\b(?:maximum-pool-size|minimum-idle|connection-timeout|validation-timeout|idle-timeout|max-lifetime|leak-detection-threshold|initialization-fail-timeout)\s*:|set(?:MaximumPoolSize|MinimumIdle|ConnectionTimeout|ValidationTimeout|IdleTimeout|MaxLifetime|LeakDetectionThreshold|InitializationFailTimeout)\s*\()/i;

const TRANSACTION_THRESHOLD = /(?:spring[._-]transaction[._-]default[._-]timeout|\bdefault-timeout\s*:|@Transactional\s*\([^)]*\btimeout\s*=|setDefaultTimeout\s*\()/i;

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
  const productionRuntime = [
    sources.production,
    sources.safety,
    sources.mainRuntime,
  ].join('\n');
  return [
    check(
      'dependency-baseline',
      includesAll(sources.pom, [
        '<version>4.1.0</version>',
        '<testcontainers.version>1.21.4</testcontainers.version>',
      ]),
      FIXED_FILES.pom,
    ),
    check(
      'health-responsibility-split',
      includesAll(sources.production, [
        'include: livenessState',
        'include: readinessState,db',
        'show-details: never',
        'show-components: never',
      ]) && includesAll(sources.safety, [
        '"management.endpoint.health.group.liveness.include"',
        '"livenessState"',
        '"management.endpoint.health.group.readiness.include"',
        '"readinessState,db"',
      ]),
      FIXED_FILES.production,
    ),
    check(
      'authentication-database-fail-closed',
      includesAll(sources.filter, [
        'catch (DataAccessResourceFailureException unavailable)',
        'SC_SERVICE_UNAVAILABLE',
        'service_unavailable',
        'Service is temporarily unavailable',
        'HttpHeaders.CACHE_CONTROL, "no-store"',
      ]) && !/catch\s*\(\s*(?:RuntimeException|Exception|Throwable)\b/
        .test(sources.filter),
      FIXED_FILES.filter,
    ),
    check(
      'connection-log-redaction-boundary',
      includesAll(sources.sanitizer, [
        '@Profile("production")',
        'DataSourceHealthIndicator',
        'org.hibernate.orm.jdbc.error',
        'com.zaxxer.hikari.pool.PoolBase',
        'com.zaxxer.hikari.pool.ProxyConnection',
        'FilterReply.DENY',
        'startsWith("08")',
      ]),
      FIXED_FILES.sanitizer,
    ),
    check(
      'production-hikari-threshold-review',
      !HIKARI_THRESHOLD.test(productionRuntime),
      FIXED_FILES.production,
    ),
    check(
      'production-transaction-timeout-review',
      !TRANSACTION_THRESHOLD.test(productionRuntime),
      'platform/backend/src/main',
    ),
    check(
      'pg16-runtime-gate-source',
      includesAll(sources.gate, [
        'postgres:16-alpine',
        'DatabaseResiliencePostgresql16GateTest',
        'DATABASE_RESILIENCE_GATE_EVIDENCE',
        'tests=1 failures=0 skipped=0',
      ]) && !sources.gate.includes('Assumptions.'),
      FIXED_FILES.gate,
    ),
  ];
}

function attribute(xml, name) {
  return new RegExp(`\\b${name}="([0-9]+)"`).exec(xml)?.[1];
}

export function inspectReport(xml) {
  const suite =
    xml.includes(
      'name="cn.xzkj.erp.config.DatabaseResiliencePostgresql16GateTest"',
    )
    && attribute(xml, 'tests') === '1'
    && attribute(xml, 'failures') === '0'
    && attribute(xml, 'errors') === '0'
    && attribute(xml, 'skipped') === '0';
  const evidence = includesAll(xml, [
    'DATABASE_RESILIENCE_GATE_EVIDENCE',
    'testcontainers=1.21.4',
    'image=postgres:16-alpine',
    'postgresql=16.14',
    'flyway=39',
    'hikari=7.0.2',
    'spring-tx=7.0.8',
    'tests=1 failures=0 skipped=0',
  ]);
  return [
    check('pg16-runtime-gate-result', suite, REPORT),
    check('pg16-runtime-gate-evidence', evidence, REPORT),
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

async function readMainRuntime(root) {
  const base = resolve(root, 'platform/backend/src/main');
  const collected = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) {
        throw new Error('runtime source contains symlink');
      }
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile()
          && /\.(?:java|ya?ml|properties)$/.test(entry.name)) {
        const repositoryPath = relative(root, path).split(sep).join('/');
        collected.push(await safeRead(root, repositoryPath));
      }
    }
  }
  await walk(base);
  return collected.join('\n');
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
  sources.mainRuntime = await readMainRuntime(canonicalRoot);
  return [
    ...inspectSources(sources),
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
