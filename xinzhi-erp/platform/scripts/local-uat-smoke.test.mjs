import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PASSWORD_ENV,
  UatFailure,
  isStrictBearerToken,
  isStrictIsoInstant,
  parseArgs,
  runSmoke,
} from './local-uat-smoke.mjs';

const BASE_URL = 'http://127.0.0.1:18888';
const PLATFORM_USERNAME = 'uat-admin';
const TENANT_CODE = 'acme';
const PASSWORD = 'placeholder-password-not-a-real-secret';
const PLATFORM_TOKEN = 'P'.repeat(43);
const TENANT_TOKEN = 'T'.repeat(43);
const UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const SKU_ID = '11111111-2222-3333-4444-555555555555';
const MAPPING_ID = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
const OTHER_SUPPLIER_ID = '99999999-8888-7777-6666-555555555555';
const NOW = '2026-07-29T12:34:56.123Z';

function jsonResponse(status, body) {
  return {
    status,
    async json() {
      return body;
    },
  };
}

function page(items, size = 20) {
  return {
    items,
    page: 0,
    size,
    totalElements: items.length,
    totalPages: items.length === 0 ? 0 : 1,
  };
}

function textResponse(status, body, contentType = 'text/plain') {
  return {
    status,
    headers: {
      get(name) {
        return name.toLowerCase() === 'content-type' ? contentType : null;
      },
    },
    async text() {
      return body;
    },
  };
}

function mappingPage(items, overrides = {}) {
  return {
    items,
    page: 0,
    size: 200,
    totalElements: items.length,
    totalPages: items.length === 0 ? 0 : 1,
    ...overrides,
  };
}

function platformAdmin() {
  return {
    id: UUID,
    username: PLATFORM_USERNAME,
    displayName: 'UAT administrator',
    status: 'ACTIVE',
  };
}

function platformAdminWithTimestamps() {
  return {
    ...platformAdmin(),
    createdAt: NOW,
    updatedAt: NOW,
    version: 0,
  };
}

function tenant() {
  return {
    id: UUID,
    code: TENANT_CODE,
    name: 'Acme enterprise',
    status: 'ACTIVE',
    createdAt: NOW,
    updatedAt: NOW,
    version: 0,
    adminCount: 1,
    memberCount: 1,
  };
}

function supplier() {
  return {
    id: UUID,
    businessCode: 'SUP_NORTH',
    name: 'North supplier',
    status: 'ACTIVE',
    contactName: null,
    contactPhone: null,
    contactEmail: null,
    address: null,
    notes: null,
    createdAt: NOW,
    updatedAt: NOW,
    version: 0,
  };
}

function supplierSkuMapping(overrides = {}) {
  return {
    id: MAPPING_ID,
    supplierId: UUID,
    skuId: SKU_ID,
    supplierSkuCode: 'SUP-SKU-1',
    status: 'ACTIVE',
    preferred: true,
    leadTimeDays: 7,
    skuBusinessCode: 'SKU_001',
    skuName: 'Test SKU',
    createdAt: NOW,
    updatedAt: NOW,
    version: 0,
    ...overrides,
  };
}

function successFetch({
  mappingItems = [],
  mappingPageOverrides = {},
  suppliers = [supplier()],
} = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/healthz')) {
      return textResponse(200, 'ok\n');
    }
    if (url.endsWith('/readyz')) {
      return textResponse(200, 'ready\n');
    }
    if (url.endsWith('/platform-admin/auth/login')) {
      return jsonResponse(200, {
        tokenType: 'Bearer',
        accessToken: PLATFORM_TOKEN,
        expiresAt: NOW,
        admin: platformAdmin(),
      });
    }
    if (url.endsWith('/platform-admin/auth/me')) {
      return jsonResponse(200, { admin: platformAdmin(), expiresAt: NOW });
    }
    if (url.endsWith('/platform-admin/system-admins')) {
      return jsonResponse(200, page([platformAdminWithTimestamps()]));
    }
    if (url.endsWith('/platform-admin/tenants')) {
      return jsonResponse(200, page([tenant()]));
    }
    if (url.endsWith(`/platform-admin/tenants/${UUID}/enter`)) {
      return jsonResponse(200, {
        tokenType: 'Bearer',
        accessToken: TENANT_TOKEN,
        expiresAt: NOW,
        tenant: {
          id: UUID,
          code: TENANT_CODE,
          name: 'Acme enterprise',
          status: 'ACTIVE',
        },
        platformAdmin: platformAdmin(),
        permissions: ['suppliers.read'],
      });
    }
    if (url.endsWith('/auth/me')) {
      return jsonResponse(200, {
        tenant: { id: UUID, code: TENANT_CODE, name: 'Acme enterprise' },
        user: null,
        platformAdmin: platformAdmin(),
        permissions: ['suppliers.read'],
        expiresAt: NOW,
      });
    }
    if (url.startsWith(`${BASE_URL}/api/v1/suppliers`)
        && !url.includes('/sku-mappings')) {
      return jsonResponse(200, page(suppliers, url.includes('?page=0&size=200') ? 200 : 20));
    }
    if (url.endsWith('/sku-mappings?page=0&size=200')) {
      return jsonResponse(200, mappingPage(mappingItems, mappingPageOverrides));
    }
    if (url.endsWith('/tenant-session') || url.endsWith('/auth/session')) {
      return jsonResponse(204, null);
    }
    throw new Error('unexpected test URL');
  };
  return { calls, fetchImpl };
}

const config = {
  baseUrl: BASE_URL,
  platformUsername: PLATFORM_USERNAME,
  tenantCode: TENANT_CODE,
};

const supplierConfig = {
  ...config,
  supplierCode: 'SUP_NORTH',
};

test('successful smoke accepts a non-RFC-version PostgreSQL UUID and revokes both sessions', async () => {
  assert.equal(isStrictBearerToken(PLATFORM_TOKEN), true);
  assert.equal(isStrictIsoInstant(NOW), true);
  const { calls, fetchImpl } = successFetch();
  const output = [];

  const result = await runSmoke(config, {
    fetchImpl,
    env: { [PASSWORD_ENV]: PASSWORD },
    logger: (line) => output.push(line),
  });

  assert.equal(result.checks.includes('smoke complete'), false);
  assert.equal(calls.at(-2).init.method, 'DELETE');
  assert.equal(calls.at(-1).init.method, 'DELETE');
  assert.equal(calls.at(-2).init.headers.Authorization, `Bearer ${TENANT_TOKEN}`);
  assert.equal(calls.at(-1).init.headers.Authorization, `Bearer ${PLATFORM_TOKEN}`);
  assert.equal(calls[0].url, `${BASE_URL}/healthz`);
  assert.equal(calls[0].init.headers.Accept, 'text/plain');
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[1].url, `${BASE_URL}/readyz`);
  assert.equal(calls[1].init.headers.Accept, 'text/plain');
  assert.equal(calls[1].init.redirect, 'error');
  assert.equal(calls.every(({ init }) => init.redirect === 'error'), true);
  assert.equal(output.join('\n').includes(PLATFORM_TOKEN), false);
  assert.equal(output.join('\n').includes(TENANT_TOKEN), false);
  assert.equal(output.join('\n').includes(PASSWORD), false);
});

test('health rejects HTML 200 responses without echoing the response body', async () => {
  const output = [];
  const fetchImpl = async (url, init) => {
    if (url.endsWith('/healthz')) {
      assert.equal(init.redirect, 'error');
      return textResponse(200, '<html>secret-response-body</html>', 'text/html');
    }
    throw new Error('must not reach API calls');
  };

  await assert.rejects(
    runSmoke(config, {
      fetchImpl,
      env: { [PASSWORD_ENV]: PASSWORD },
      logger: (line) => output.push(line),
    }),
    (error) => error instanceof UatFailure
      && error.stage === 'health'
      && error.reason === 'invalid health response'
      && !error.message.includes('secret-response-body'),
  );
  assert.equal(output.join('\n').includes('secret-response-body'), false);
});

test('readiness rejects upstream failure without reaching authenticated APIs or echoing the body', async () => {
  const output = [];
  const fetchImpl = async (url, init) => {
    if (url.endsWith('/healthz')) {
      return textResponse(200, 'ok\n');
    }
    if (url.endsWith('/readyz')) {
      assert.equal(init.redirect, 'error');
      return textResponse(
        503,
        'database=jdbc:postgresql://backend.internal/secret username=erp_secret',
      );
    }
    throw new Error('must not reach API calls');
  };

  await assert.rejects(
    runSmoke(config, {
      fetchImpl,
      env: { [PASSWORD_ENV]: PASSWORD },
      logger: (line) => output.push(line),
    }),
    (error) => error instanceof UatFailure
      && error.stage === 'readiness'
      && error.reason === 'unexpected HTTP status 503'
      && !error.message.includes('jdbc:postgresql:')
      && !error.message.includes('erp_secret'),
  );
  assert.equal(output.join('\n').includes('jdbc:postgresql:'), false);
  assert.equal(output.join('\n').includes('erp_secret'), false);
});

test('supplier-code validates an empty V39 mapping page with a read-only GET', async () => {
  const { calls, fetchImpl } = successFetch();

  await runSmoke(supplierConfig, {
    fetchImpl,
    env: { [PASSWORD_ENV]: PASSWORD },
  });

  const mappingCall = calls.find(({ url }) => url.includes('/sku-mappings?'));
  assert.ok(mappingCall);
  assert.equal(mappingCall.url, `${BASE_URL}/api/v1/suppliers/${UUID}/sku-mappings?page=0&size=200`);
  assert.equal(mappingCall.init.method, 'GET');
  assert.equal(mappingCall.init.redirect, 'error');
});

test('supplier-code accepts a valid V39 mapping and canonical non-version UUIDs', async () => {
  const { fetchImpl } = successFetch({ mappingItems: [supplierSkuMapping()] });

  const result = await runSmoke(supplierConfig, {
    fetchImpl,
    env: { [PASSWORD_ENV]: PASSWORD },
  });

  assert.equal(result.checks.includes('supplier SKU mapping list'), true);
});

test('supplier SKU mapping rejects unknown sensitive fields and supplier mismatches', async (t) => {
  await t.test('unknown sensitive field', async () => {
    const output = [];
    const { fetchImpl } = successFetch({
      mappingItems: [supplierSkuMapping({
        tenantId: `response-body-${PASSWORD}`,
        price: 123,
      })],
    });

    await assert.rejects(
      runSmoke(supplierConfig, {
        fetchImpl,
        env: { [PASSWORD_ENV]: PASSWORD },
        logger: (line) => output.push(line),
      }),
      (error) => error instanceof UatFailure
        && error.stage === 'supplier SKU mapping list'
        && !error.message.includes(PASSWORD),
    );
    assert.equal(output.join('\n').includes(PASSWORD), false);
  });

  await t.test('supplierId mismatch', async () => {
    const { fetchImpl } = successFetch({
      mappingItems: [supplierSkuMapping({ supplierId: OTHER_SUPPLIER_ID })],
    });

    await assert.rejects(
      runSmoke(supplierConfig, {
        fetchImpl,
        env: { [PASSWORD_ENV]: PASSWORD },
      }),
      (error) => error instanceof UatFailure
        && error.stage === 'supplier SKU mapping list',
    );
  });
});

test('supplier SKU mapping rejects invalid UUID, instant, status, and pagination', async (t) => {
  const cases = [
    ['UUID', { id: 'not-a-uuid' }],
    ['instant', { updatedAt: '2026-02-29T12:34:56Z' }],
    ['status', { status: 'ARCHIVED' }],
  ];
  for (const [label, overrides] of cases) {
    await t.test(label, async () => {
      const { fetchImpl } = successFetch({
        mappingItems: [supplierSkuMapping(overrides)],
      });
      await assert.rejects(
        runSmoke(supplierConfig, {
          fetchImpl,
          env: { [PASSWORD_ENV]: PASSWORD },
        }),
        (error) => error instanceof UatFailure
          && error.stage === 'supplier SKU mapping list',
      );
    });
  }

  await t.test('pagination', async () => {
    const { fetchImpl } = successFetch({ mappingPageOverrides: { size: 199 } });
    await assert.rejects(
      runSmoke(supplierConfig, {
        fetchImpl,
        env: { [PASSWORD_ENV]: PASSWORD },
      }),
      (error) => error instanceof UatFailure
        && error.stage === 'supplier SKU mapping list',
    );
  });
});

test('supplier-code rejects missing and duplicate tenant supplier matches', async (t) => {
  await t.test('missing supplier', async () => {
    const { calls, fetchImpl } = successFetch();

    await assert.rejects(
      runSmoke({ ...config, supplierCode: 'SUP_MISSING' }, {
        fetchImpl,
        env: { [PASSWORD_ENV]: PASSWORD },
      }),
      (error) => error instanceof UatFailure
        && error.stage === 'supplier selection'
        && error.reason === 'supplier code not found',
    );
    assert.equal(calls.some(({ url }) => url.includes('/sku-mappings?')), false);
    assert.equal(calls.filter(({ init }) => init.method === 'DELETE').length, 2);
  });

  await t.test('duplicate supplier', async () => {
    const { fetchImpl } = successFetch({ suppliers: [supplier(), supplier()] });

    await assert.rejects(
      runSmoke(supplierConfig, {
        fetchImpl,
        env: { [PASSWORD_ENV]: PASSWORD },
      }),
      (error) => error instanceof UatFailure
        && error.stage === 'supplier selection'
        && error.reason === 'supplier code is not unique',
    );
  });
});

test('V39 mapping failure still revokes tenant and platform sessions without response-body output', async () => {
  const { calls, fetchImpl: baseFetch } = successFetch();
  const output = [];
  const fetchImpl = async (url, init) => {
    if (url.includes('/sku-mappings?')) {
      return jsonResponse(503, {
        details: `response-body ${PASSWORD} ${PLATFORM_TOKEN} ${TENANT_TOKEN} Authorization`,
      });
    }
    return baseFetch(url, init);
  };

  await assert.rejects(
    runSmoke(supplierConfig, {
      fetchImpl,
      env: { [PASSWORD_ENV]: PASSWORD },
      logger: (line) => output.push(line),
    }),
    (error) => error instanceof UatFailure
      && error.stage === 'supplier SKU mapping list'
      && !error.message.includes('response-body')
      && !error.message.includes(PASSWORD)
      && !error.message.includes(PLATFORM_TOKEN)
      && !error.message.includes(TENANT_TOKEN)
      && !error.message.includes('Authorization'),
  );
  assert.equal(calls.filter(({ init }) => init.method === 'DELETE').length, 2);
  assert.equal(output.join('\n').includes('response-body'), false);
  assert.equal(output.join('\n').includes(PASSWORD), false);
  assert.equal(output.join('\n').includes(PLATFORM_TOKEN), false);
  assert.equal(output.join('\n').includes(TENANT_TOKEN), false);
  assert.equal(output.join('\n').includes('Authorization'), false);
});

test('rejects non-loopback addresses unless explicitly allowed', () => {
  assert.throws(
    () => parseArgs([
      '--base-url', 'http://192.0.2.10:8080',
      '--platform-username', PLATFORM_USERNAME,
      '--tenant-code', TENANT_CODE,
    ]),
    (error) => error instanceof UatFailure
      && error.stage === 'configuration'
      && error.reason.includes('non-loopback'),
  );

  const options = parseArgs([
    '--base-url', 'http://192.0.2.10:8080',
    '--platform-username', PLATFORM_USERNAME,
    '--tenant-code', TENANT_CODE,
    '--allow-non-loopback',
  ]);
  assert.equal(options.allowNonLoopback, true);
});

test('requires the password environment variable and rejects password flags', async () => {
  await assert.rejects(
    runSmoke(config, { fetchImpl: () => { throw new Error('must not fetch'); }, env: {} }),
    (error) => error instanceof UatFailure
      && error.stage === 'configuration'
      && error.reason === `${PASSWORD_ENV} is required`,
  );

  assert.throws(
    () => parseArgs([
      '--base-url', BASE_URL,
      '--platform-username', PLATFORM_USERNAME,
      '--tenant-code', TENANT_CODE,
      '--platform-password', 'plaintext',
    ]),
    /plaintext password flags are not accepted/,
  );

  assert.equal(parseArgs([
    '--base-url', BASE_URL,
    '--platform-username', PLATFORM_USERNAME,
    '--tenant-code', TENANT_CODE,
    '--supplier-code', 'sup_north',
  ]).supplierCode, 'sup_north');
});

test('redacts error response bodies and never prints token, password, or authorization data', async () => {
  const output = [];
  const fetchImpl = async () => jsonResponse(500, {
    code: 'invalid_credentials',
    message: `password=${PASSWORD} token=${PLATFORM_TOKEN}`,
    Authorization: `Bearer ${PLATFORM_TOKEN}`,
  });

  await assert.rejects(
    runSmoke(config, {
      fetchImpl,
      env: { [PASSWORD_ENV]: PASSWORD },
      logger: (line) => output.push(line),
    }),
    (error) => {
      assert.equal(error instanceof UatFailure, true);
      assert.equal(error.stage, 'health');
      assert.equal(error.message.includes(PASSWORD), false);
      assert.equal(error.message.includes(PLATFORM_TOKEN), false);
      assert.equal(error.message.includes('Authorization'), false);
      return true;
    },
  );
  const rendered = output.join('\n');
  assert.equal(rendered.includes(PASSWORD), false);
  assert.equal(rendered.includes(PLATFORM_TOKEN), false);
  assert.equal(rendered.includes('Authorization'), false);
});

test('failure after tenant entry still attempts tenant and platform cleanup', async () => {
  const { calls, fetchImpl: baseFetch } = successFetch();
  const fetchImpl = async (url, init) => {
    if (url.endsWith('/suppliers')) {
      return jsonResponse(503, {
        details: `sensitive ${PASSWORD} ${TENANT_TOKEN}`,
      });
    }
    return baseFetch(url, init);
  };
  const output = [];

  await assert.rejects(
    runSmoke(config, {
      fetchImpl,
      env: { [PASSWORD_ENV]: PASSWORD },
      logger: (line) => output.push(line),
    }),
    (error) => error instanceof UatFailure && error.stage === 'supplier list',
  );

  const deletes = calls.filter(({ init }) => init.method === 'DELETE');
  assert.equal(deletes.length, 2);
  assert.equal(deletes[0].init.headers.Authorization, `Bearer ${TENANT_TOKEN}`);
  assert.equal(deletes[1].init.headers.Authorization, `Bearer ${PLATFORM_TOKEN}`);
  assert.equal(output.join('\n').includes(PASSWORD), false);
  assert.equal(output.join('\n').includes(TENANT_TOKEN), false);
});

test('strict validators reject offsets, invalid dates, and malformed bearer tokens', () => {
  assert.equal(isStrictIsoInstant('2026-07-29T12:34:56+08:00'), false);
  assert.equal(isStrictIsoInstant('2026-02-29T12:34:56Z'), false);
  assert.equal(isStrictBearerToken('not-a-token'), false);
  assert.equal(isStrictBearerToken('P'.repeat(42)), false);
});
