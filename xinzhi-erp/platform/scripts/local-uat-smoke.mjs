#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export const PASSWORD_ENV = 'XZ_ERP_UAT_PLATFORM_PASSWORD';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ISO_INSTANT_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(\.\d{1,9})?Z$/;
const USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,119}$/;
const TENANT_CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const BUSINESS_CODE_PATTERN = /^[A-Z][A-Z0-9_-]{1,63}$/i;
const STATUS_VALUES = new Set(['ACTIVE', 'INACTIVE', 'ARCHIVED']);
const SUPPLIER_SKU_MAPPING_STATUS_VALUES = new Set(['ACTIVE', 'INACTIVE']);
const UAT_PAGE_SIZE = 200;
const SUPPLIER_SKU_MAPPING_KEYS = [
  'id',
  'supplierId',
  'skuId',
  'supplierSkuCode',
  'status',
  'preferred',
  'leadTimeDays',
  'skuBusinessCode',
  'skuName',
  'createdAt',
  'updatedAt',
  'version',
];

const HELP = `Usage:
  node platform/scripts/local-uat-smoke.mjs --base-url <url> --platform-username <username> --tenant-code <code> [--supplier-code <businessCode>] [--allow-non-loopback]

Required:
  --base-url <url>             Explicit ERP base URL. By default only
                               http://127.0.0.1[:port] or http://localhost[:port].
  --platform-username <name>   SYSTEM_ADMIN username.
  --tenant-code <code>         Enterprise code to enter for the tenant smoke check.

Optional:
  --supplier-code <businessCode>  Read and validate that supplier's SKU mappings.
  --allow-non-loopback          Explicitly allow a non-loopback base URL.
  --help                        Show this help.

Password:
  Read only from ${PASSWORD_ENV}. Plaintext password flags are rejected.
  The smoke check is read-only apart from creating and revoking temporary sessions.
`;

export class UatFailure extends Error {
  constructor(stage, reason) {
    super(`${stage}: ${reason}`);
    this.name = 'UatFailure';
    this.stage = stage;
    this.reason = reason;
  }
}

function fail(stage, reason) {
  throw new UatFailure(stage, reason);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireRecord(value, stage, field = 'response') {
  if (!isRecord(value)) {
    fail(stage, `invalid ${field} structure`);
  }
  return value;
}

function requireString(value, stage, field, { nonEmpty = true, pattern, max } = {}) {
  if (typeof value !== 'string'
      || (nonEmpty && value.length === 0)
      || (max !== undefined && value.length > max)
      || (pattern && !pattern.test(value))) {
    fail(stage, `invalid ${field}`);
  }
  return value;
}

function requireNullableString(value, stage, field, options = {}) {
  if (value !== null) {
    requireString(value, stage, field, options);
  }
  return value;
}

function requireNullableTrimmedString(value, stage, field, options = {}) {
  requireNullableString(value, stage, field, options);
  if (value !== null && value !== value.trim()) {
    fail(stage, `invalid ${field}`);
  }
  return value;
}

function requireUuid(value, stage, field) {
  requireString(value, stage, field, { pattern: UUID_PATTERN });
  return value;
}

function requireNonNegativeInteger(value, stage, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(stage, `invalid ${field}`);
  }
  return value;
}

function requireArray(value, stage, field) {
  if (!Array.isArray(value)) {
    fail(stage, `invalid ${field}`);
  }
  return value;
}

function hasExactKeys(value, keys) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function requireStatus(value, stage, field, allowed = STATUS_VALUES) {
  requireString(value, stage, field);
  if (!allowed.has(value)) {
    fail(stage, `invalid ${field}`);
  }
  return value;
}

function requireActiveAdmin(admin, stage) {
  if (admin.status !== 'ACTIVE') {
    fail(stage, 'system administrator is not active');
  }
}

function sameUuid(left, right) {
  return typeof left === 'string'
    && typeof right === 'string'
    && left.toLowerCase() === right.toLowerCase();
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year, month) {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function isStrictIsoInstant(value) {
  if (typeof value !== 'string') {
    return false;
  }
  const match = ISO_INSTANT_PATTERN.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return day <= daysInMonth(year, month);
}

function requireIsoInstant(value, stage, field) {
  if (!isStrictIsoInstant(value)) {
    fail(stage, `invalid ${field}`);
  }
  return value;
}

export function isStrictBearerToken(value) {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

function requireBearerToken(value, stage) {
  if (!isStrictBearerToken(value)) {
    fail(stage, 'invalid bearer token');
  }
  return value;
}

function requireTokenType(value, stage) {
  if (value !== 'Bearer') {
    fail(stage, 'invalid token type');
  }
}

function validateAdminView(value, stage, { withTimestamps = false } = {}) {
  const admin = requireRecord(value, stage, 'admin');
  requireUuid(admin.id, stage, 'admin.id');
  requireString(admin.username, stage, 'admin.username', {
    pattern: USERNAME_PATTERN,
  });
  requireString(admin.displayName, stage, 'admin.displayName', { max: 160 });
  requireStatus(admin.status, stage, 'admin.status', new Set(['ACTIVE', 'DISABLED', 'DELETED', 'PENDING_ACTIVATION']));
  if (withTimestamps) {
    requireIsoInstant(admin.createdAt, stage, 'admin.createdAt');
    requireIsoInstant(admin.updatedAt, stage, 'admin.updatedAt');
    requireNonNegativeInteger(admin.version, stage, 'admin.version');
  }
  return admin;
}

function validatePlatformLogin(value, stage) {
  const response = requireRecord(value, stage);
  requireTokenType(response.tokenType, stage);
  const accessToken = requireBearerToken(response.accessToken, stage);
  requireIsoInstant(response.expiresAt, stage, 'expiresAt');
  const admin = validateAdminView(response.admin, stage);
  requireActiveAdmin(admin, stage);
  return { accessToken, admin };
}

function validatePlatformMe(value, stage) {
  const response = requireRecord(value, stage);
  const admin = validateAdminView(response.admin, stage);
  requireActiveAdmin(admin, stage);
  requireIsoInstant(response.expiresAt, stage, 'expiresAt');
}

function validateTenantView(value, stage) {
  const tenant = requireRecord(value, stage, 'tenant');
  requireUuid(tenant.id, stage, 'tenant.id');
  requireString(tenant.code, stage, 'tenant.code', { pattern: TENANT_CODE_PATTERN });
  requireString(tenant.name, stage, 'tenant.name', { max: 160 });
  requireStatus(tenant.status, stage, 'tenant.status', new Set(['ACTIVE', 'DISABLED', 'ARCHIVED']));
  requireIsoInstant(tenant.createdAt, stage, 'tenant.createdAt');
  requireIsoInstant(tenant.updatedAt, stage, 'tenant.updatedAt');
  requireNonNegativeInteger(tenant.version, stage, 'tenant.version');
  requireNonNegativeInteger(tenant.adminCount, stage, 'tenant.adminCount');
  requireNonNegativeInteger(tenant.memberCount, stage, 'tenant.memberCount');
  return tenant;
}

function validatePageEnvelope(value, stage, itemValidator) {
  const page = requireRecord(value, stage);
  const items = requireArray(page.items, stage, 'items');
  requireNonNegativeInteger(page.page, stage, 'page');
  if (!Number.isSafeInteger(page.size) || page.size < 1) {
    fail(stage, 'invalid size');
  }
  requireNonNegativeInteger(page.totalElements, stage, 'totalElements');
  requireNonNegativeInteger(page.totalPages, stage, 'totalPages');
  items.forEach((item) => itemValidator(item, stage));
  return items;
}

function validateSystemAdminList(value, stage) {
  return validatePageEnvelope(value, stage, (item, itemStage) => {
    validateAdminView(item, itemStage, { withTimestamps: true });
  });
}

function validateTenantList(value, stage) {
  return validatePageEnvelope(value, stage, validateTenantView);
}

function validateEnterTenant(value, stage) {
  const response = requireRecord(value, stage);
  requireTokenType(response.tokenType, stage);
  const accessToken = requireBearerToken(response.accessToken, stage);
  requireIsoInstant(response.expiresAt, stage, 'expiresAt');
  const tenant = requireRecord(response.tenant, stage, 'tenant');
  requireUuid(tenant.id, stage, 'tenant.id');
  requireString(tenant.code, stage, 'tenant.code', { pattern: TENANT_CODE_PATTERN });
  requireString(tenant.name, stage, 'tenant.name', { max: 160 });
  requireStatus(tenant.status, stage, 'tenant.status', new Set(['ACTIVE', 'DISABLED', 'ARCHIVED']));
  const platformAdmin = validateAdminView(response.platformAdmin, stage);
  requireActiveAdmin(platformAdmin, stage);
  const permissions = requireArray(response.permissions, stage, 'permissions');
  permissions.forEach((permission) => requireString(permission, stage, 'permission'));
  return { accessToken, tenant, platformAdmin };
}

function validateTenantMe(value, stage) {
  const response = requireRecord(value, stage);
  const tenant = requireRecord(response.tenant, stage, 'tenant');
  requireUuid(tenant.id, stage, 'tenant.id');
  requireString(tenant.code, stage, 'tenant.code', { pattern: TENANT_CODE_PATTERN });
  requireString(tenant.name, stage, 'tenant.name', { max: 160 });
  if (response.user !== null) {
    fail(stage, 'unexpected tenant user identity');
  }
  const platformAdmin = validateAdminView(response.platformAdmin, stage);
  requireActiveAdmin(platformAdmin, stage);
  const permissions = requireArray(response.permissions, stage, 'permissions');
  permissions.forEach((permission) => requireString(permission, stage, 'permission'));
  requireIsoInstant(response.expiresAt, stage, 'expiresAt');
  return { tenant, platformAdmin };
}

function validateSupplierList(value, stage) {
  return validatePageEnvelope(value, stage, (item, itemStage) => {
    const supplier = requireRecord(item, itemStage, 'supplier');
    requireUuid(supplier.id, itemStage, 'supplier.id');
    requireString(supplier.businessCode, itemStage, 'supplier.businessCode', {
      pattern: BUSINESS_CODE_PATTERN,
      max: 64,
    });
    requireString(supplier.name, itemStage, 'supplier.name', { max: 200 });
    requireStatus(supplier.status, itemStage, 'supplier.status');
    requireNullableString(supplier.contactName, itemStage, 'supplier.contactName', { max: 120 });
    requireNullableString(supplier.contactPhone, itemStage, 'supplier.contactPhone', { max: 40 });
    requireNullableString(supplier.contactEmail, itemStage, 'supplier.contactEmail', { max: 254 });
    requireNullableString(supplier.address, itemStage, 'supplier.address', { max: 500 });
    requireNullableString(supplier.notes, itemStage, 'supplier.notes', { max: 2000 });
    requireIsoInstant(supplier.createdAt, itemStage, 'supplier.createdAt');
    requireIsoInstant(supplier.updatedAt, itemStage, 'supplier.updatedAt');
    requireNonNegativeInteger(supplier.version, itemStage, 'supplier.version');
  });
}

function validateSupplierSkuMapping(value, stage, supplierId) {
  const mapping = requireRecord(value, stage, 'supplier SKU mapping');
  if (!hasExactKeys(mapping, SUPPLIER_SKU_MAPPING_KEYS)) {
    fail(stage, 'invalid supplier SKU mapping fields');
  }
  requireUuid(mapping.id, stage, 'mapping.id');
  requireUuid(mapping.supplierId, stage, 'mapping.supplierId');
  if (!sameUuid(mapping.supplierId, supplierId)) {
    fail(stage, 'supplier SKU mapping supplier mismatch');
  }
  requireUuid(mapping.skuId, stage, 'mapping.skuId');
  requireNullableTrimmedString(mapping.supplierSkuCode, stage, 'mapping.supplierSkuCode', {
    max: 120,
  });
  requireStatus(
      mapping.status,
      stage,
      'mapping.status',
      SUPPLIER_SKU_MAPPING_STATUS_VALUES);
  if (typeof mapping.preferred !== 'boolean') {
    fail(stage, 'invalid mapping.preferred');
  }
  if (mapping.leadTimeDays !== null) {
    requireNonNegativeInteger(mapping.leadTimeDays, stage, 'mapping.leadTimeDays');
    if (mapping.leadTimeDays > 3650) {
      fail(stage, 'invalid mapping.leadTimeDays');
    }
  }
  requireString(mapping.skuBusinessCode, stage, 'mapping.skuBusinessCode', {
    pattern: BUSINESS_CODE_PATTERN,
    max: 64,
  });
  requireString(mapping.skuName, stage, 'mapping.skuName', { max: 200 });
  if (mapping.skuName.trim().length === 0 || mapping.skuName !== mapping.skuName.trim()) {
    fail(stage, 'invalid mapping.skuName');
  }
  requireIsoInstant(mapping.createdAt, stage, 'mapping.createdAt');
  requireIsoInstant(mapping.updatedAt, stage, 'mapping.updatedAt');
  requireNonNegativeInteger(mapping.version, stage, 'mapping.version');
  return mapping;
}

function validateSupplierSkuMappingPage(value, stage, supplierId) {
  const page = requireRecord(value, stage);
  if (!hasExactKeys(page, ['items', 'page', 'size', 'totalElements', 'totalPages'])) {
    fail(stage, 'invalid pagination fields');
  }
  const items = requireArray(page.items, stage, 'items');
  if (page.page !== 0) {
    fail(stage, 'invalid page');
  }
  if (page.size !== UAT_PAGE_SIZE) {
    fail(stage, 'invalid size');
  }
  requireNonNegativeInteger(page.totalElements, stage, 'totalElements');
  requireNonNegativeInteger(page.totalPages, stage, 'totalPages');
  const expectedTotalPages = page.totalElements === 0
    ? 0
    : Math.ceil(page.totalElements / page.size);
  const expectedItemCount = Math.min(page.size, page.totalElements);
  if (page.totalPages !== expectedTotalPages || items.length !== expectedItemCount) {
    fail(stage, 'invalid pagination totals');
  }
  items.forEach((item) => validateSupplierSkuMapping(item, stage, supplierId));
  return items;
}

export function validateBaseUrl(value, allowNonLoopback = false) {
  if (typeof value !== 'string' || value.length === 0) {
    fail('configuration', 'base URL is required');
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    fail('configuration', 'invalid base URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)
      || url.username
      || url.password
      || url.search
      || url.hash
      || (url.pathname !== '' && url.pathname !== '/')) {
    fail('configuration', 'invalid base URL');
  }
  const isAllowedLoopback = url.protocol === 'http:'
    && (url.hostname.toLowerCase() === '127.0.0.1' || url.hostname.toLowerCase() === 'localhost');
  if (!allowNonLoopback && !isAllowedLoopback) {
    fail('configuration', 'non-loopback base URL requires --allow-non-loopback');
  }
  return url.origin;
}

function requireOptionValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    fail('configuration', `${flag} requires a value`);
  }
  return value;
}

export function parseArgs(argv) {
  let baseUrl;
  let platformUsername;
  let tenantCode;
  let supplierCode;
  let allowNonLoopback = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      return { help: true };
    }
    if (argument === '--allow-non-loopback') {
      allowNonLoopback = true;
    } else if (argument === '--base-url') {
      baseUrl = requireOptionValue(argv, index, argument);
      index += 1;
    } else if (argument === '--platform-username') {
      platformUsername = requireOptionValue(argv, index, argument);
      index += 1;
    } else if (argument === '--tenant-code') {
      tenantCode = requireOptionValue(argv, index, argument);
      index += 1;
    } else if (argument === '--supplier-code') {
      supplierCode = requireOptionValue(argv, index, argument);
      index += 1;
    } else if (argument === '--platform-password'
        || argument.startsWith('--platform-password=')
        || argument === '--password'
        || argument.startsWith('--password=')) {
      fail('configuration', 'plaintext password flags are not accepted');
    } else {
      fail('configuration', `unknown option ${argument.startsWith('--') ? argument : 'argument'}`);
    }
  }

  if (!baseUrl || !platformUsername || !tenantCode) {
    fail('configuration', 'base URL, platform username, and tenant code are required');
  }
  validateBaseUrl(baseUrl, allowNonLoopback);
  requireString(platformUsername, 'configuration', 'platform username', {
    pattern: USERNAME_PATTERN,
  });
  requireString(tenantCode, 'configuration', 'tenant code', {
    pattern: TENANT_CODE_PATTERN,
  });
  if (supplierCode !== undefined) {
    requireString(supplierCode, 'configuration', 'supplier code', {
      pattern: BUSINESS_CODE_PATTERN,
      max: 64,
    });
  }
  return {
    baseUrl,
    platformUsername,
    tenantCode,
    supplierCode,
    allowNonLoopback,
    help: false,
  };
}

function validateConfig(config) {
  const baseUrl = validateBaseUrl(config.baseUrl, config.allowNonLoopback === true);
  requireString(config.platformUsername, 'configuration', 'platform username', {
    pattern: USERNAME_PATTERN,
  });
  requireString(config.tenantCode, 'configuration', 'tenant code', {
    pattern: TENANT_CODE_PATTERN,
  });
  if (config.supplierCode !== undefined) {
    requireString(config.supplierCode, 'configuration', 'supplier code', {
      pattern: BUSINESS_CODE_PATTERN,
      max: 64,
    });
  }
  return { ...config, baseUrl };
}

async function requestJson(fetchImpl, baseUrl, stage, path, { method = 'GET', token, body } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  let response;
  try {
    response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers,
      redirect: 'error',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    fail(stage, 'network request failed');
  }
  if (!response || !Number.isInteger(response.status)) {
    fail(stage, 'invalid HTTP response');
  }
  if (response.status !== 200) {
    fail(stage, `unexpected HTTP status ${response.status}`);
  }
  try {
    return await response.json();
  } catch {
    fail(stage, 'invalid JSON response');
  }
}

async function requestPlainProbe(
    fetchImpl,
    baseUrl,
    stage,
    path,
    expectedBody,
    responseKind) {
  let response;
  try {
    response = await fetchImpl(`${baseUrl}${path}`, {
      method: 'GET',
      headers: { Accept: 'text/plain' },
      redirect: 'error',
    });
  } catch {
    fail(stage, 'network request failed');
  }
  if (!response || !Number.isInteger(response.status)) {
    fail(stage, 'invalid HTTP response');
  }
  if (response.status !== 200) {
    fail(stage, `unexpected HTTP status ${response.status}`);
  }
  const contentType = response.headers?.get?.('content-type');
  const mediaTypes = typeof contentType === 'string'
    ? contentType.split(',').map((value) => value.split(';', 1)[0].trim().toLowerCase())
    : [];
  if (!mediaTypes.includes('text/plain')
      || mediaTypes.some((mediaType) => !['text/plain', 'application/octet-stream'].includes(mediaType))) {
    fail(stage, `invalid ${responseKind} response`);
  }
  let body;
  try {
    body = await response.text();
  } catch {
    fail(stage, `invalid ${responseKind} response`);
  }
  if (body !== expectedBody && body !== `${expectedBody}\n`) {
    fail(stage, `invalid ${responseKind} response`);
  }
}

async function requestNoContent(fetchImpl, baseUrl, stage, path, token) {
  const headers = { Accept: 'application/json' };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  let response;
  try {
    response = await fetchImpl(`${baseUrl}${path}`, {
      method: 'DELETE',
      headers,
      redirect: 'error',
    });
  } catch {
    fail(stage, 'network request failed');
  }
  if (!response || !Number.isInteger(response.status)) {
    fail(stage, 'invalid HTTP response');
  }
  if (response.status !== 204) {
    fail(stage, `unexpected HTTP status ${response.status}`);
  }
}

function readPassword(env) {
  const password = env?.[PASSWORD_ENV];
  if (typeof password !== 'string' || password.length === 0) {
    fail('configuration', `${PASSWORD_ENV} is required`);
  }
  return password;
}

function asUatFailure(error, fallbackStage) {
  if (error instanceof UatFailure) {
    return error;
  }
  return new UatFailure(fallbackStage, 'unexpected failure');
}

export async function runSmoke(config, {
  fetchImpl = globalThis.fetch,
  env = process.env,
  logger = () => {},
} = {}) {
  const options = validateConfig(config);
  const password = readPassword(env);
  if (typeof fetchImpl !== 'function') {
    fail('configuration', 'fetch is unavailable');
  }
  const baseUrl = options.baseUrl;
  let platformToken;
  let tenantToken;
  let primaryError;
  const cleanupFailures = [];
  const passedChecks = [];
  const pass = (stage) => {
    passedChecks.push(stage);
    logger(`[PASS] ${stage}`);
  };

  try {
    await requestPlainProbe(
        fetchImpl,
        baseUrl,
        'health',
        '/healthz',
        'ok',
        'health');
    pass('health');

    await requestPlainProbe(
        fetchImpl,
        baseUrl,
        'readiness',
        '/readyz',
        'ready',
        'readiness');
    pass('readiness');

    const platformLoginResponse = await requestJson(
        fetchImpl,
        baseUrl,
        'platform login',
        '/api/v1/platform-admin/auth/login',
        {
          method: 'POST',
          body: { username: options.platformUsername, password },
        });
    const candidatePlatformToken = requireBearerToken(
        requireRecord(platformLoginResponse, 'platform login').accessToken,
        'platform login');
    platformToken = candidatePlatformToken;
    const platformLogin = validatePlatformLogin(platformLoginResponse, 'platform login');
    if (platformLogin.admin.username.toLowerCase() !== options.platformUsername.toLowerCase()) {
      fail('platform login', 'authenticated username mismatch');
    }
    pass('platform login');

    const platformMe = await requestJson(
        fetchImpl,
        baseUrl,
        'platform /auth/me',
        '/api/v1/platform-admin/auth/me',
        { token: platformToken });
    validatePlatformMe(platformMe, 'platform /auth/me');
    pass('platform /auth/me');

    const systemAdmins = await requestJson(
        fetchImpl,
        baseUrl,
        'system-admin list',
        '/api/v1/platform-admin/system-admins',
        { token: platformToken });
    validateSystemAdminList(systemAdmins, 'system-admin list');
    pass('system-admin list');

    const tenantList = await requestJson(
        fetchImpl,
        baseUrl,
        'tenant list',
        '/api/v1/platform-admin/tenants',
        { token: platformToken });
    const tenants = validateTenantList(tenantList, 'tenant list');
    const targetTenant = tenants.find((tenant) => tenant.code === options.tenantCode);
    if (!targetTenant) {
      fail('tenant selection', 'tenant code not found');
    }
    if (targetTenant.status !== 'ACTIVE') {
      fail('tenant selection', 'tenant is not active');
    }
    pass('tenant list');

    const enterResponse = await requestJson(
        fetchImpl,
        baseUrl,
        'tenant enter',
        `/api/v1/platform-admin/tenants/${targetTenant.id}/enter`,
        { method: 'POST', token: platformToken });
    const candidateTenantToken = requireBearerToken(
        requireRecord(enterResponse, 'tenant enter').accessToken,
        'tenant enter');
    tenantToken = candidateTenantToken;
    const entered = validateEnterTenant(enterResponse, 'tenant enter');
    if (entered.tenant.code !== options.tenantCode
        || !sameUuid(entered.tenant.id, targetTenant.id)) {
      fail('tenant enter', 'entered tenant mismatch');
    }
    pass('tenant enter');

    const tenantMe = await requestJson(
        fetchImpl,
        baseUrl,
        'tenant /auth/me',
        '/api/v1/auth/me',
        { token: tenantToken });
    const currentTenant = validateTenantMe(tenantMe, 'tenant /auth/me');
    if (currentTenant.tenant.code !== options.tenantCode
        || !sameUuid(currentTenant.tenant.id, targetTenant.id)) {
      fail('tenant /auth/me', 'authenticated tenant mismatch');
    }
    pass('tenant /auth/me');

    const supplierListPath = options.supplierCode === undefined
      ? '/api/v1/suppliers'
      : `/api/v1/suppliers?page=0&size=${UAT_PAGE_SIZE}`;
    const suppliers = await requestJson(
        fetchImpl,
        baseUrl,
        'supplier list',
        supplierListPath,
        { token: tenantToken });
    const supplierItems = validateSupplierList(suppliers, 'supplier list');
    if (options.supplierCode !== undefined) {
      const supplierPage = requireRecord(suppliers, 'supplier list');
      if (supplierPage.page !== 0
          || supplierPage.size !== UAT_PAGE_SIZE
          || supplierPage.totalPages > 1
          || supplierPage.items.length !== supplierPage.totalElements) {
        fail('supplier list', 'supplier list is incomplete');
      }
    }
    pass('supplier list');

    if (options.supplierCode !== undefined) {
      const matchingSuppliers = supplierItems.filter((supplier) =>
        supplier.businessCode.toLowerCase() === options.supplierCode.toLowerCase());
      if (matchingSuppliers.length === 0) {
        fail('supplier selection', 'supplier code not found');
      }
      if (matchingSuppliers.length !== 1) {
        fail('supplier selection', 'supplier code is not unique');
      }
      const targetSupplier = matchingSuppliers[0];
      const mappingPath = `/api/v1/suppliers/${targetSupplier.id}/sku-mappings?page=0&size=${UAT_PAGE_SIZE}`;
      const mappings = await requestJson(
          fetchImpl,
          baseUrl,
          'supplier SKU mapping list',
          mappingPath,
          { token: tenantToken });
      validateSupplierSkuMappingPage(mappings, 'supplier SKU mapping list', targetSupplier.id);
      pass('supplier SKU mapping list');
    }

    await requestNoContent(
        fetchImpl,
        baseUrl,
        'tenant logout',
        '/api/v1/platform-admin/tenant-session',
        tenantToken);
    tenantToken = undefined;
    pass('tenant logout');

    await requestNoContent(
        fetchImpl,
        baseUrl,
        'platform logout',
        '/api/v1/platform-admin/auth/session',
        platformToken);
    platformToken = undefined;
    pass('platform logout');
  } catch (error) {
    primaryError = asUatFailure(error, 'smoke run');
  } finally {
    if (tenantToken) {
      try {
        await requestNoContent(
            fetchImpl,
            baseUrl,
            'tenant cleanup',
            '/api/v1/platform-admin/tenant-session',
            tenantToken);
        tenantToken = undefined;
        pass('tenant cleanup');
      } catch {
        cleanupFailures.push('tenant session');
      }
    }
    if (platformToken) {
      try {
        await requestNoContent(
            fetchImpl,
            baseUrl,
            'platform cleanup',
            '/api/v1/platform-admin/auth/session',
            platformToken);
        platformToken = undefined;
        pass('platform cleanup');
      } catch {
        cleanupFailures.push('platform session');
      }
    }
  }

  if (primaryError) {
    if (cleanupFailures.length > 0) {
      throw new UatFailure(primaryError.stage, `${primaryError.reason}; session cleanup failed`);
    }
    throw primaryError;
  }
  if (cleanupFailures.length > 0) {
    fail('cleanup', 'session cleanup failed');
  }
  logger('[PASS] smoke complete');
  return { checks: passedChecks };
}

async function main(argv = process.argv.slice(2), env = process.env) {
  try {
    const options = parseArgs(argv);
    if (options.help) {
      process.stdout.write(HELP);
      return 0;
    }
    await runSmoke(options, {
      env,
      logger: (line) => process.stdout.write(`${line}\n`),
    });
    return 0;
  } catch (error) {
    const failure = asUatFailure(error, 'smoke run');
    process.stderr.write(`[FAIL] ${failure.stage}: ${failure.reason}\n`);
    return 1;
  }
}

const isMainModule = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMainModule) {
  const exitCode = await main();
  process.exitCode = exitCode;
}
