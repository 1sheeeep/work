import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  formatResult,
  main,
  resolveInsideRoot,
  runReadinessChecks,
} from './server-readiness-check.mjs';

const BASELINE_MIGRATIONS = [
  'V1__identity_and_permissions.sql',
  'V10__iam_authentication_foundation.sql',
  'V20__platform_shop_center.sql',
  'V21__iam_administration.sql',
  'V30__product_center.sql',
  'V31__iam_password_credentials.sql',
  'V32__order_center.sql',
  'V33__order_line_sku_matching.sql',
  'V34__iam_permission_catalog.sql',
  'V35__iam_login_throttles.sql',
  'V36__warehouse_master_data.sql',
  'V37__platform_system_administration.sql',
  'V38__supplier_master_data.sql',
  'V39__supplier_sku_mappings.sql',
];

const SAFE_PRODUCTION_PROFILE = `spring:
  datasource:
    url: \${ERP_DB_URL}
    username: \${ERP_DB_USER}
    password: \${ERP_DB_PASSWORD}
  flyway:
    enabled: false
  jpa:
    hibernate:
      ddl-auto: validate
management:
  endpoint:
    health:
      show-details: never
      show-components: never
      group:
        readiness:
          include: readinessState,db
  endpoints:
    web:
      exposure:
        include: health,info
erp:
  environment: production
  bootstrap:
    initial-admin:
      enabled: false
    platform-admin:
      enabled: false
  security:
    password-credential-ttl: PT30M
`;

const SAFE_PRODUCTION_PROCESSOR = `
Map.entry("spring.datasource.url", "\${ERP_DB_URL}"),
Map.entry("spring.datasource.username", "\${ERP_DB_USER}"),
Map.entry("spring.datasource.password", "\${ERP_DB_PASSWORD}"),
Map.entry("spring.flyway.enabled", "false"),
Map.entry("spring.jpa.hibernate.ddl-auto", "validate"),
Map.entry("management.endpoint.health.show-details", "never"),
Map.entry("management.endpoint.health.group.readiness.include", "readinessState,db"),
Map.entry("management.endpoints.web.exposure.include", "health,info"),
Map.entry("spring.web.error.include-path", "never"),
Map.entry("erp.environment", "production"),
Map.entry("erp.bootstrap.initial-admin.enabled", "false"),
Map.entry("erp.bootstrap.platform-admin.enabled", "false")
`;

async function write(root, path, content = '') {
  const target = join(root, ...path.split('/'));
  await mkdir(join(target, '..'), { recursive: true });
  await writeFile(target, content, 'utf8');
}

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'erp-readiness-'));
  await write(root, 'platform/.env.example',
    'ERP_DB_PASSWORD=replace-with-a-random-local-password\n');
  await write(root, 'platform/.gitignore', '.env\n');
  await write(root, 'platform/compose.yaml', `services:
  postgres:
    environment:
      POSTGRES_PASSWORD: \${ERP_DB_PASSWORD:-local-development-only}
`);
  await write(
    root,
    'platform/backend/Dockerfile',
    'FROM scratch\nRUN mvn -B -q -DskipTests package\n',
  );
  await write(root, 'platform/backend/pom.xml', '<project />\n');
  await write(
    root,
    'platform/backend/src/main/resources/application.yml',
    `spring:
  web:
    error:
      include-path: never
erp:
  environment: \${ERP_ENVIRONMENT:local}
`,
  );
  await write(
    root,
    'platform/backend/src/main/resources/application-production.yml',
    SAFE_PRODUCTION_PROFILE,
  );
  await write(
    root,
    'platform/backend/src/main/java/cn/xzkj/erp/config/'
      + 'ProductionSafetyEnvironmentPostProcessor.java',
    SAFE_PRODUCTION_PROCESSOR,
  );
  await write(
    root,
    'platform/docs/server-readiness-requirements.md',
    '# Server readiness\n',
  );
  await write(root, 'platform/frontend/Dockerfile', 'FROM scratch\n');
  await write(
    root,
    'platform/frontend/nginx.conf',
    'server { listen 80; }\n',
  );
  await write(
    root,
    'platform/infra/staging/compose.staging.yaml',
    'services: {}\n',
  );
  for (const migration of BASELINE_MIGRATIONS) {
    await write(
      root,
      `platform/backend/src/main/resources/db/migration/${migration}`,
      '-- fixture\n',
    );
  }
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

function find(checks, rule) {
  return checks.find((check) => check.rule === rule);
}

test('safe fixture passes and a sparse baseline plus later V40 is accepted', async () => {
  await withFixture(async (root) => {
    await write(
      root,
      'platform/backend/src/main/resources/db/migration/V40__future_change.sql',
      '-- fixture\n',
    );
    const checks = await runReadinessChecks(root);
    assert.equal(checks.every(({ status }) => status === 'PASS'), true);
    assert.equal(find(checks, 'flyway-version-order').status, 'PASS');
  });
});

test('backend image build must package without hiding test compilation', async () => {
  await withFixture(async (root) => {
    await write(
      root,
      'platform/backend/Dockerfile',
      'FROM scratch\nRUN mvn -B -q verify\n',
    );
    let checks = await runReadinessChecks(root);
    assert.equal(
      find(checks, 'backend-image-package-boundary').status,
      'FAIL',
    );

    await write(
      root,
      'platform/backend/Dockerfile',
      'FROM scratch\nRUN mvn -B -q -Dmaven.test.skip=true package\n',
    );
    checks = await runReadinessChecks(root);
    assert.equal(
      find(checks, 'backend-image-package-boundary').status,
      'FAIL',
    );
  });
});

test('duplicate and inserted historical Flyway versions fail without requiring gaps', async () => {
  await withFixture(async (root) => {
    await write(
      root,
      'platform/backend/src/main/resources/db/migration/V38__duplicate.sql',
      '-- fixture\n',
    );
    await write(
      root,
      'platform/backend/src/main/resources/db/migration/V29__late_lower_version.sql',
      '-- fixture\n',
    );
    const checks = await runReadinessChecks(root);
    assert.equal(find(checks, 'flyway-version-unique').status, 'FAIL');
    assert.equal(find(checks, 'flyway-baseline-consistency').status, 'FAIL');
    assert.equal(find(checks, 'flyway-version-order').status, 'FAIL');
  });
});

test('unsafe production defaults fail the production rules', async () => {
  await withFixture(async (root) => {
    await write(
      root,
      'platform/backend/src/main/resources/application-production.yml',
      `spring:
  datasource:
    url: \${ERP_DB_URL:jdbc:postgresql://127.0.0.1:5432/xz_erp}
    username: \${ERP_DB_USER:erp_app}
    password: \${ERP_DB_PASSWORD:change-me}
  jpa:
    hibernate:
      ddl-auto: update
erp:
  environment: local
  bootstrap:
    initial-admin:
      enabled: true
`,
    );
    const checks = await runReadinessChecks(root);
    assert.equal(find(checks, 'production-loopback').status, 'FAIL');
    assert.equal(find(checks, 'production-secret-injection').status, 'FAIL');
    assert.equal(find(checks, 'production-dangerous-defaults').status, 'FAIL');
    assert.equal(
      find(checks, 'production-environment-explicit').status,
      'FAIL',
    );
    assert.equal(find(checks, 'production-bootstrap-disabled').status, 'FAIL');
    assert.equal(find(checks, 'production-flyway-disabled').status, 'FAIL');
    assert.equal(find(checks, 'production-schema-validation').status, 'FAIL');
    assert.equal(
      find(checks, 'production-health-details-hidden').status,
      'FAIL',
    );
    assert.equal(
      find(checks, 'production-approved-actuator-exposure').status,
      'FAIL',
    );
    assert.equal(
      find(checks, 'production-database-readiness').status,
      'FAIL',
    );
  });
});

test('independent customer-service production files do not redefine ERP production', async () => {
  await withFixture(async (root) => {
    await write(
      root,
      'platform/customer-service/deploy/compose.production.yml',
      `services:
  api:
    environment:
      ERP_ENVIRONMENT: staging
    healthcheck:
      test: http://127.0.0.1:8787/healthz
`,
    );
    const checks = await runReadinessChecks(root);
    assert.equal(find(checks, 'production-loopback').status, 'PASS');
    assert.equal(find(checks, 'production-dangerous-defaults').status, 'PASS');
  });
});

test('missing production safety overrides fail closed', async () => {
  await withFixture(async (root) => {
    await write(
      root,
      'platform/backend/src/main/java/cn/xzkj/erp/config/'
        + 'ProductionSafetyEnvironmentPostProcessor.java',
      'class ProductionSafetyEnvironmentPostProcessor {}\n',
    );
    const checks = await runReadinessChecks(root);
    assert.equal(
      find(checks, 'production-safety-overrides').status,
      'FAIL',
    );
  });
});

test('error path suppression requires the Boot 4.1 base default and production override', async () => {
  await withFixture(async (root) => {
    await write(
      root,
      'platform/backend/src/main/resources/application.yml',
      'erp:\n  environment: ${ERP_ENVIRONMENT:local}\n',
    );
    let checks = await runReadinessChecks(root);
    assert.equal(
      find(checks, 'error-path-redaction-default-and-override').status,
      'FAIL',
    );

    await write(
      root,
      'platform/backend/src/main/resources/application.yml',
      `spring:
  web:
    error:
      include-path: never
erp:
  environment: \${ERP_ENVIRONMENT:local}
`,
    );
    await write(
      root,
      'platform/backend/src/main/java/cn/xzkj/erp/config/'
        + 'ProductionSafetyEnvironmentPostProcessor.java',
      SAFE_PRODUCTION_PROCESSOR.replace(
        '"spring.web.error.include-path", "never"',
        '"server.error.include-path", "never"',
      ),
    );
    checks = await runReadinessChecks(root);
    assert.equal(
      find(checks, 'error-path-redaction-default-and-override').status,
      'FAIL',
    );
  });
});

test('committed secret is detected but never rendered', async () => {
  await withFixture(async (root) => {
    const canary = 'canary-real-secret-value-7Qz9';
    await write(
      root,
      'platform/infra/preprod/compose.preprod.yaml',
      `services:\n  db:\n    environment:\n      DB_PASSWORD: ${canary}\n`,
    );
    const checks = await runReadinessChecks(root);
    const rendered = checks.map(formatResult).join('\n');
    assert.equal(find(checks, 'config-secret-literals').status, 'FAIL');
    assert.equal(rendered.includes(canary), false);
    assert.match(
      rendered,
      /\[FAIL\]\tconfig-secret-literals\tplatform\/infra\/preprod\/compose\.preprod\.yaml/,
    );
  });
});

test('required environment references are not treated as committed secrets', async () => {
  await withFixture(async (root) => {
    await write(
      root,
      'platform/infra/preprod/compose.preprod.yaml',
      `services:
  db:
    environment:
      DB_PASSWORD: \${DB_PASSWORD:?DB_PASSWORD is required}
      API_SECRET: \${API_SECRET?API_SECRET is required}
`,
    );
    const checks = await runReadinessChecks(root);
    assert.equal(find(checks, 'config-secret-literals').status, 'PASS');
  });
});

test('.env and process environment values are never read or echoed', async () => {
  await withFixture(async (root) => {
    const envFileCanary = 'do-not-read-dot-env-canary';
    const productionEnvCanary = 'do-not-read-production-dot-env-canary';
    const processCanary = 'do-not-read-process-env-canary';
    await write(root, 'platform/.env', `ERP_DB_PASSWORD=${envFileCanary}\n`);
    await write(
      root,
      'platform/infra/production/.env',
      `ERP_DB_PASSWORD=${productionEnvCanary}\n`,
    );
    const previous = process.env.ERP_DB_PASSWORD;
    process.env.ERP_DB_PASSWORD = processCanary;
    try {
      const output = [];
      const exitCode = await main(['--root', root], (line) =>
        output.push(line));
      const rendered = output.join('\n');
      assert.equal(exitCode, 0);
      assert.equal(rendered.includes(envFileCanary), false);
      assert.equal(rendered.includes(productionEnvCanary), false);
      assert.equal(rendered.includes(processCanary), false);
    } finally {
      if (previous === undefined) {
        delete process.env.ERP_DB_PASSWORD;
      } else {
        process.env.ERP_DB_PASSWORD = previous;
      }
    }
  });
});

test('path resolver rejects absolute paths and traversal outside the root', () => {
  const root = join(tmpdir(), 'erp-readiness-root');
  assert.throws(() => resolveInsideRoot(root, '../outside'), /unsafe path/);
  assert.throws(() => resolveInsideRoot(root, '../../outside'), /unsafe path/);
  assert.throws(
    () => resolveInsideRoot(root, resolveInsideRoot(root, 'platform')),
    /unsafe path/,
  );
  assert.equal(
    resolveInsideRoot(root, 'platform/compose.yaml'),
    join(root, 'platform', 'compose.yaml'),
  );
});

test('invalid CLI arguments return a safe CI usage failure', async () => {
  const output = [];
  const exitCode = await main(['--unknown'], (line) => output.push(line));
  assert.equal(exitCode, 2);
  assert.deepEqual(output, ['[FAIL]\tchecker-arguments\t.']);
});
