#!/usr/bin/env node

import {
  lstat,
  readFile,
  readdir,
} from 'node:fs/promises';
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MAX_CONFIG_BYTES = 1024 * 1024;
const MIGRATION_DIRECTORY =
  'platform/backend/src/main/resources/db/migration';
const PRODUCTION_PROFILE =
  'platform/backend/src/main/resources/application-production.yml';
const BASE_APPLICATION =
  'platform/backend/src/main/resources/application.yml';
const BACKEND_DOCKERFILE = 'platform/backend/Dockerfile';
const PRODUCTION_SAFETY_PROCESSOR =
  'platform/backend/src/main/java/cn/xzkj/erp/config/'
  + 'ProductionSafetyEnvironmentPostProcessor.java';
const ERP_PRODUCTION_EXCLUDED_PREFIXES = [
  'platform/customer-service/',
];

const REQUIRED_FILES = [
  'platform/.env.example',
  'platform/.gitignore',
  'platform/compose.yaml',
  'platform/backend/Dockerfile',
  'platform/backend/pom.xml',
  'platform/backend/src/main/resources/application.yml',
  'platform/docs/server-readiness-requirements.md',
  'platform/frontend/Dockerfile',
  'platform/frontend/nginx.conf',
  'platform/infra/staging/compose.staging.yaml',
];

const BASELINE_MIGRATIONS = new Map([
  [1, 'V1__identity_and_permissions.sql'],
  [10, 'V10__iam_authentication_foundation.sql'],
  [20, 'V20__platform_shop_center.sql'],
  [21, 'V21__iam_administration.sql'],
  [30, 'V30__product_center.sql'],
  [31, 'V31__iam_password_credentials.sql'],
  [32, 'V32__order_center.sql'],
  [33, 'V33__order_line_sku_matching.sql'],
  [34, 'V34__iam_permission_catalog.sql'],
  [35, 'V35__iam_login_throttles.sql'],
  [36, 'V36__warehouse_master_data.sql'],
  [37, 'V37__platform_system_administration.sql'],
  [38, 'V38__supplier_master_data.sql'],
  [39, 'V39__supplier_sku_mappings.sql'],
]);
const BASELINE_MAX_VERSION = Math.max(...BASELINE_MIGRATIONS.keys());

const MIGRATION_NAME =
  /^V([1-9][0-9]*)__([A-Za-z0-9][A-Za-z0-9_-]*)\.sql$/;
const SECRET_KEY =
  /(?:^|[_.-])(?:password|passwd|secret|token|api[_-]?key|private[_-]?key|access[_-]?key)(?:_b64)?$/i;
const SECRET_SIGNATURES = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
];
const PLACEHOLDER_VALUES = [
  /^$/,
  /^(?:null|~|false)$/i,
  /^<[^>]+>$/,
  /^(?:replace|set|inject|provide|generate|use)[-_ ].*(?:password|secret|token|key|value)$/i,
  /^(?:replace-with|not-a-real-secret|example|placeholder).*/i,
  /^local-development-only$/i,
];
const PRODUCTION_PATH =
  /(?:^|[/_.-])(?:production|prod|preprod|pre-production)(?:[/_.-]|$)/i;
const LOOPBACK =
  /(?:^|[^A-Za-z0-9])(?:localhost|127(?:\.[0-9]{1,3}){3})(?:[^A-Za-z0-9]|$)/i;
const SENSITIVE_DEFAULT =
  /\$\{(?:[^}:]*(?:DB|DATABASE|PASSWORD|PASSWD|SECRET|TOKEN|USER|USERNAME|ENVIRONMENT|CORS|ORIGIN)[^}:]*):[-]?[^}]+\}/i;
const DANGEROUS_PRODUCTION = [
  /\bddl-auto\s*:\s*(?:create|create-drop|update)\b/i,
  /\bshow-details\s*:\s*always\b/i,
  /\bdebug\s*:\s*true\b/i,
  /\binclude-stacktrace\s*:\s*always\b/i,
  /\ballowed-origins?\s*:\s*["']?\*["']?\s*$/im,
  /\berp[_-]?environment\s*[:=]\s*(?:local|dev|development|uat|staging)\b/i,
  /\benvironment\s*:\s*(?:local|dev|development|uat|staging)\b/i,
  /\bbootstrap\b[\s\S]{0,500}\benabled\s*:\s*true\b/i,
  /\bERP_BOOTSTRAP_[A-Z0-9_]+_ENABLED\s*[:=]\s*true\b/i,
];

function result(rule, passed, location) {
  return {
    rule,
    status: passed ? 'PASS' : 'FAIL',
    location: toDisplayPath(location),
  };
}

function toDisplayPath(value) {
  const normalized = value.split(sep).join('/');
  return normalized.length === 0 ? '.' : normalized;
}

export function resolveInsideRoot(root, relativePath) {
  if (typeof relativePath !== 'string'
      || relativePath.length === 0
      || isAbsolute(relativePath)) {
    throw new Error('unsafe path');
  }
  const absoluteRoot = resolve(root);
  const target = resolve(absoluteRoot, relativePath);
  const fromRoot = relative(absoluteRoot, target);
  if (fromRoot === '..'
      || fromRoot.startsWith(`..${sep}`)
      || isAbsolute(fromRoot)) {
    throw new Error('unsafe path');
  }
  return target;
}

async function inspectPath(root, relativePath) {
  let target;
  try {
    target = resolveInsideRoot(root, relativePath);
  } catch {
    return { kind: 'unsafe' };
  }

  const parts = relative(resolve(root), target)
    .split(sep)
    .filter(Boolean);
  let current = resolve(root);
  for (const part of parts) {
    current = resolve(current, part);
    let stat;
    try {
      stat = await lstat(current);
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
        return { kind: 'missing' };
      }
      return { kind: 'unreadable' };
    }
    if (stat.isSymbolicLink()) {
      return { kind: 'unsafe' };
    }
    if (current === target) {
      if (stat.isFile()) return { kind: 'file', size: stat.size, target };
      if (stat.isDirectory()) return { kind: 'directory', target };
      return { kind: 'unsupported' };
    }
  }
  return { kind: 'directory', target };
}

async function readSafeText(root, relativePath) {
  const inspected = await inspectPath(root, relativePath);
  if (inspected.kind !== 'file') {
    return { ...inspected, content: null };
  }
  if (inspected.size > MAX_CONFIG_BYTES) {
    return { kind: 'oversize', content: null };
  }
  try {
    return {
      kind: 'file',
      content: await readFile(inspected.target, 'utf8'),
    };
  } catch {
    return { kind: 'unreadable', content: null };
  }
}

async function walkRegularFiles(root, startRelativePath) {
  const files = [];
  const unsafe = [];
  const start = await inspectPath(root, startRelativePath);
  if (start.kind === 'missing') {
    return { files, unsafe };
  }
  if (start.kind !== 'directory') {
    unsafe.push(startRelativePath);
    return { files, unsafe };
  }

  const queue = [startRelativePath];
  while (queue.length > 0) {
    const directory = queue.shift();
    const absoluteDirectory = resolveInsideRoot(root, directory);
    let entries;
    try {
      entries = await readdir(absoluteDirectory, { withFileTypes: true });
    } catch {
      unsafe.push(directory);
      continue;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      const child = `${directory}/${entry.name}`;
      if (entry.isSymbolicLink()) {
        unsafe.push(child);
      } else if (entry.isDirectory()) {
        if (!['node_modules', 'target', 'dist', 'release', '.git']
          .includes(entry.name)) {
          queue.push(child);
        }
      } else if (entry.isFile()) {
        files.push(child);
      } else {
        unsafe.push(child);
      }
    }
  }
  return { files, unsafe };
}

function isConfigCandidate(path) {
  const name = path.split('/').at(-1);
  if (/^\.env(?:\.|$)/i.test(name)
      && !/\.(?:example|sample|template)$/i.test(name)) {
    return false;
  }
  return /^compose(?:\.[^.]+)*\.ya?ml$/i.test(name)
    || name === '.env.example'
    || /\.(?:example|sample|template)$/i.test(name)
    || PRODUCTION_PATH.test(path);
}

function unquote(value) {
  const trimmed = value.trim().replace(/\s+#.*$/, '').trim();
  if (trimmed.length >= 2
      && ((trimmed.startsWith('"') && trimmed.endsWith('"'))
        || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function isPlaceholderValue(rawValue) {
  const value = unquote(rawValue);
  if (PLACEHOLDER_VALUES.some((pattern) => pattern.test(value))) {
    return true;
  }
  const reference = /^\$\{[A-Za-z_][A-Za-z0-9_]*(?:(:?[-?])([^}]*))?\}$/
    .exec(value);
  if (!reference) {
    return false;
  }
  if (reference[1] === undefined || reference[1].includes('?')) {
    return true;
  }
  return PLACEHOLDER_VALUES.some((pattern) => pattern.test(reference[2]));
}

function containsSecretLiteral(content) {
  if (SECRET_SIGNATURES.some((pattern) => pattern.test(content))) {
    return true;
  }
  for (const line of content.split(/\r?\n/)) {
    if (/^\s*(?:#|$)/.test(line)) continue;
    const assignment = /^\s*(?:-\s*)?([A-Za-z0-9_.-]+)\s*[:=]\s*(.*?)\s*$/
      .exec(line);
    if (!assignment || !SECRET_KEY.test(assignment[1])) continue;
    if (!isPlaceholderValue(assignment[2])) {
      return true;
    }
  }
  return false;
}

async function checkRequiredFiles(root) {
  const results = [];
  for (const path of REQUIRED_FILES) {
    const inspected = await inspectPath(root, path);
    results.push(result('required-file', inspected.kind === 'file', path));
  }
  const migrationDirectory = await inspectPath(root, MIGRATION_DIRECTORY);
  results.push(result(
    'required-directory',
    migrationDirectory.kind === 'directory',
    MIGRATION_DIRECTORY,
  ));
  return results;
}

async function checkBackendDockerBuildBoundary(root) {
  const dockerfile = await readSafeText(root, BACKEND_DOCKERFILE);
  const content = dockerfile.kind === 'file' ? dockerfile.content : '';
  const mavenBuildLines = content.split(/\r?\n/)
    .filter((line) => /^\s*RUN\s+mvn\b/i.test(line));
  const packagesWithoutRunningTests = mavenBuildLines.some((line) =>
    /\bpackage\b/i.test(line)
    && /(?:^|\s)-DskipTests(?:=true)?(?=\s|$)/i.test(line));
  const runsVerify = mavenBuildLines.some((line) =>
    /\bverify\b/i.test(line));
  const skipsTestCompilation = mavenBuildLines.some((line) =>
    /(?:^|\s)-Dmaven\.test\.skip(?:=true)?(?=\s|$)/i.test(line));
  return result(
    'backend-image-package-boundary',
    dockerfile.kind === 'file'
      && packagesWithoutRunningTests
      && !runsVerify
      && !skipsTestCompilation,
    BACKEND_DOCKERFILE,
  );
}

async function checkMigrations(root) {
  const directory = await inspectPath(root, MIGRATION_DIRECTORY);
  if (directory.kind !== 'directory') {
    return [
      result('flyway-filename-format', false, MIGRATION_DIRECTORY),
      result('flyway-version-unique', false, MIGRATION_DIRECTORY),
      result('flyway-baseline-consistency', false, MIGRATION_DIRECTORY),
      result('flyway-version-order', false, MIGRATION_DIRECTORY),
    ];
  }

  let entries;
  try {
    entries = await readdir(directory.target, { withFileTypes: true });
  } catch {
    return [
      result('flyway-filename-format', false, MIGRATION_DIRECTORY),
      result('flyway-version-unique', false, MIGRATION_DIRECTORY),
      result('flyway-baseline-consistency', false, MIGRATION_DIRECTORY),
      result('flyway-version-order', false, MIGRATION_DIRECTORY),
    ];
  }

  const sqlEntries = entries
    .filter((entry) => entry.name.toLowerCase().endsWith('.sql'));
  const unsafeEntry = sqlEntries.some((entry) =>
    entry.isSymbolicLink() || !entry.isFile());
  const parsed = [];
  let namesValid = !unsafeEntry && sqlEntries.length > 0;
  for (const entry of sqlEntries) {
    const match = MIGRATION_NAME.exec(entry.name);
    if (!match) {
      namesValid = false;
      continue;
    }
    parsed.push({ version: Number(match[1]), name: entry.name });
  }

  const byVersion = new Map();
  for (const migration of parsed) {
    const names = byVersion.get(migration.version) ?? [];
    names.push(migration.name);
    byVersion.set(migration.version, names);
  }
  const versionsUnique = [...byVersion.values()]
    .every((names) => names.length === 1);

  const baselineMatches = [...BASELINE_MIGRATIONS.entries()]
    .every(([version, name]) =>
      byVersion.get(version)?.length === 1
      && byVersion.get(version)[0] === name);
  const noInsertedHistoricalVersion = parsed.every(({ version, name }) =>
    version > BASELINE_MAX_VERSION
    || BASELINE_MIGRATIONS.get(version) === name);
  const baselineConsistent =
    namesValid && baselineMatches && noInsertedHistoricalVersion;

  const sortedVersions = parsed
    .map(({ version }) => version)
    .sort((left, right) => left - right);
  const strictlyIncreasing = sortedVersions.every((version, index) =>
    index === 0 || version > sortedVersions[index - 1]);
  const versionOrderSafe =
    namesValid
    && versionsUnique
    && strictlyIncreasing
    && noInsertedHistoricalVersion;

  return [
    result('flyway-filename-format', namesValid, MIGRATION_DIRECTORY),
    result('flyway-version-unique', versionsUnique, MIGRATION_DIRECTORY),
    result(
      'flyway-baseline-consistency',
      baselineConsistent,
      MIGRATION_DIRECTORY,
    ),
    result('flyway-version-order', versionOrderSafe, MIGRATION_DIRECTORY),
  ];
}

async function checkConfigurationSecrets(root) {
  const walked = await walkRegularFiles(root, 'platform');
  const candidates = walked.files.filter(isConfigCandidate);
  let passed = walked.unsafe.length === 0;
  let failureLocation = walked.unsafe[0] ?? 'platform';

  for (const path of candidates) {
    const file = await readSafeText(root, path);
    if (file.kind !== 'file' || containsSecretLiteral(file.content)) {
      passed = false;
      failureLocation = path;
      break;
    }
  }
  return result('config-secret-literals', passed, failureLocation);
}

async function productionConfigFiles(root) {
  const walked = await walkRegularFiles(root, 'platform');
  return {
    files: walked.files.filter((path) =>
      !ERP_PRODUCTION_EXCLUDED_PREFIXES.some((prefix) =>
        path.startsWith(prefix))
      && PRODUCTION_PATH.test(path)
      && /\.(?:ya?ml|properties|conf|json|example|sample|template)$/i
        .test(path)),
    unsafe: walked.unsafe,
  };
}

async function checkProductionProfile(root) {
  const baseApplication = await readSafeText(root, BASE_APPLICATION);
  const profile = await readSafeText(root, PRODUCTION_PROFILE);
  const safetyProcessor = await readSafeText(
    root,
    PRODUCTION_SAFETY_PROCESSOR,
  );
  const exists = profile.kind === 'file';
  const content = exists ? profile.content : '';
  const discovered = await productionConfigFiles(root);

  let loopbackSafe = exists && discovered.unsafe.length === 0;
  let requiredSecrets = exists;
  let dangerousDefaultsSafe = exists;
  let environmentExplicit = exists;
  let bootstrapDisabled = exists;
  let flywayDisabled = exists;
  let schemaValidation = exists;
  let healthDetailsHidden = exists;
  let actuatorExposureApproved = exists;
  let databaseReadiness = exists;
  let safetyOverrides = safetyProcessor.kind === 'file';
  let errorPathRedaction =
    baseApplication.kind === 'file'
    && safetyProcessor.kind === 'file';
  let failureLocation =
    discovered.unsafe[0] ?? PRODUCTION_PROFILE;

  for (const path of discovered.files) {
    const file = await readSafeText(root, path);
    if (file.kind !== 'file') {
      loopbackSafe = false;
      dangerousDefaultsSafe = false;
      failureLocation = path;
      continue;
    }
    if (LOOPBACK.test(file.content)) {
      loopbackSafe = false;
      failureLocation = path;
    }
    if (SENSITIVE_DEFAULT.test(file.content)
        || DANGEROUS_PRODUCTION.some((pattern) =>
          pattern.test(file.content))) {
      dangerousDefaultsSafe = false;
      failureLocation = path;
    }
  }

  if (exists) {
    requiredSecrets = [
      '${ERP_DB_URL}',
      '${ERP_DB_USER}',
      '${ERP_DB_PASSWORD}',
    ].every((placeholder) => content.includes(placeholder));
    environmentExplicit =
      /\benvironment\s*:\s*production\b/i.test(content)
      || /\bERP_ENVIRONMENT\s*[:=]\s*production\b/i.test(content);
    bootstrapDisabled =
      /\binitial-admin\s*:\s*(?:\r?\n[ \t]+[^\r\n]*){0,4}\r?\n?[ \t]*enabled\s*:\s*false\b/i
        .test(content)
      && /\bplatform-admin\s*:\s*(?:\r?\n[ \t]+[^\r\n]*){0,4}\r?\n?[ \t]*enabled\s*:\s*false\b/i
        .test(content);
    flywayDisabled =
      /\bflyway\s*:\s*(?:\r?\n[ \t]+[^\r\n]*){0,4}\r?\n?[ \t]*enabled\s*:\s*false\b/i
        .test(content);
    schemaValidation = /\bddl-auto\s*:\s*validate\b/i.test(content);
    healthDetailsHidden =
      /\bshow-details\s*:\s*never\b/i.test(content)
      && /\bshow-components\s*:\s*never\b/i.test(content);
    actuatorExposureApproved =
      /\bexposure\s*:\s*(?:\r?\n[ \t]+[^\r\n]*){0,4}\r?\n?[ \t]*include\s*:\s*(?:health\s*,\s*info|info\s*,\s*health)\s*$/im
        .test(content);
    databaseReadiness =
      /\breadiness\s*:\s*(?:\r?\n[ \t]+[^\r\n]*){0,6}\r?\n?[ \t]*include\s*:\s*[^\r\n]*\breadinessState\b[^\r\n]*\bdb\b/i
        .test(content);
  }

  if (safetyProcessor.kind === 'file') {
    const requiredOverrides = [
      '"spring.datasource.url", "${ERP_DB_URL}"',
      '"spring.datasource.username", "${ERP_DB_USER}"',
      '"spring.datasource.password", "${ERP_DB_PASSWORD}"',
      '"spring.flyway.enabled", "false"',
      '"spring.jpa.hibernate.ddl-auto", "validate"',
      '"management.endpoint.health.show-details", "never"',
      '"management.endpoint.health.group.readiness.include"',
      '"readinessState,db"',
      '"management.endpoints.web.exposure.include"',
      '"health,info"',
      '"spring.web.error.include-path", "never"',
      '"erp.environment", "production"',
      '"erp.bootstrap.initial-admin.enabled", "false"',
      '"erp.bootstrap.platform-admin.enabled", "false"',
    ];
    safetyOverrides = requiredOverrides.every((token) =>
      safetyProcessor.content.includes(token));
  }

  if (errorPathRedaction) {
    errorPathRedaction =
      /^  web:\r?\n    error:\r?\n      include-path:\s*never\s*$/m
        .test(baseApplication.content)
      && safetyProcessor.content.includes(
        '"spring.web.error.include-path", "never"',
      )
      && !baseApplication.content.includes('server.error.include-path')
      && !safetyProcessor.content.includes('server.error.include-path');
  }

  return [
    result('production-profile', exists, PRODUCTION_PROFILE),
    result('production-loopback', loopbackSafe, failureLocation),
    result(
      'production-secret-injection',
      requiredSecrets,
      PRODUCTION_PROFILE,
    ),
    result(
      'production-dangerous-defaults',
      dangerousDefaultsSafe,
      failureLocation,
    ),
    result(
      'production-environment-explicit',
      environmentExplicit,
      PRODUCTION_PROFILE,
    ),
    result(
      'production-bootstrap-disabled',
      bootstrapDisabled,
      PRODUCTION_PROFILE,
    ),
    result(
      'production-flyway-disabled',
      flywayDisabled,
      PRODUCTION_PROFILE,
    ),
    result(
      'production-schema-validation',
      schemaValidation,
      PRODUCTION_PROFILE,
    ),
    result(
      'production-health-details-hidden',
      healthDetailsHidden,
      PRODUCTION_PROFILE,
    ),
    result(
      'production-approved-actuator-exposure',
      actuatorExposureApproved,
      PRODUCTION_PROFILE,
    ),
    result(
      'production-database-readiness',
      databaseReadiness,
      PRODUCTION_PROFILE,
    ),
    result(
      'production-safety-overrides',
      safetyOverrides,
      PRODUCTION_SAFETY_PROCESSOR,
    ),
    result(
      'error-path-redaction-default-and-override',
      errorPathRedaction,
      BASE_APPLICATION,
    ),
  ];
}

export async function runReadinessChecks(root = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../..',
)) {
  const absoluteRoot = resolve(root);
  const checks = [
    ...(await checkRequiredFiles(absoluteRoot)),
    await checkBackendDockerBuildBoundary(absoluteRoot),
    ...(await checkMigrations(absoluteRoot)),
    await checkConfigurationSecrets(absoluteRoot),
    ...(await checkProductionProfile(absoluteRoot)),
  ];
  return checks;
}

export function formatResult(check) {
  return `[${check.status}]\t${check.rule}\t${check.location}`;
}

export function parseArgs(argv) {
  if (argv.length === 0) {
    return {};
  }
  if (argv.length === 2 && argv[0] === '--root' && argv[1].length > 0) {
    return { root: argv[1] };
  }
  throw new Error('invalid arguments');
}

export async function main(argv, logger = console.log) {
  let options;
  try {
    options = parseArgs(argv);
  } catch {
    logger(formatResult(result('checker-arguments', false, '.')));
    return 2;
  }

  try {
    const checks = await runReadinessChecks(options.root);
    checks.forEach((check) => logger(formatResult(check)));
    return checks.some((check) => check.status === 'FAIL') ? 1 : 0;
  } catch {
    logger(formatResult(result('checker-internal', false, '.')));
    return 2;
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : '';
if (import.meta.url === invokedPath) {
  process.exitCode = await main(process.argv.slice(2));
}
