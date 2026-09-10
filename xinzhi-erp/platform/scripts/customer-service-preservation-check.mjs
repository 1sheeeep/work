#!/usr/bin/env node

// Offline snapshot comparison only. No collector, deployment or production access.
import { closeSync, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_RECORDS = 20_000;
const REF = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const HISTORY_KINDS = ['conversations', 'messages', 'tickets', 'assignments', 'audit'];
const COLLECTIONS = ['users', 'roles', 'shops', 'channels', 'history'];
const META = ['schemaVersion', 'environment', 'enterpriseRef', 'baselineRef',
  'captureRef', 'capturedAt', 'historyCutoff', 'complete'];

class SnapshotError extends Error {
  constructor(code, side, collection = null, index = null) {
    super(code);
    this.issue = { code, side, collection, index };
  }
}

function demand(condition, code, side, collection = null, index = null) {
  if (!condition) throw new SnapshotError(code, side, collection, index);
}

function shape(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}

const ref = value => typeof value === 'string' && REF.test(value);
const nullableRef = value => value === null || ref(value);
const digest = value => typeof value === 'string' && DIGEST.test(value);
function refs(value) {
  return Array.isArray(value) && value.length <= 512
    && value.every(ref) && new Set(value).size === value.length;
}
function instant(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

const CHECKS = {
  users: value => shape(value, ['ref', 'status', 'roleRefs', 'scopeDigest'])
    && ref(value.ref) && ref(value.status) && refs(value.roleRefs) && digest(value.scopeDigest),
  roles: value => shape(value, ['ref', 'permissionCodes'])
    && ref(value.ref) && refs(value.permissionCodes),
  shops: value => shape(value, ['ref', 'status', 'shopifyShopRef', 'appRef', 'installationRef', 'grantedScopes'])
    && ref(value.ref) && ref(value.status) && nullableRef(value.shopifyShopRef)
    && nullableRef(value.appRef) && nullableRef(value.installationRef)
    && (value.grantedScopes === null || refs(value.grantedScopes)),
  channels: value => shape(value, ['ref', 'shopRef', 'kind', 'enabled', 'configurationDigest'])
    && ref(value.ref) && nullableRef(value.shopRef) && ['email', 'chat'].includes(value.kind)
    && typeof value.enabled === 'boolean' && digest(value.configurationDigest),
  history: value => shape(value, ['kind', 'recordCount', 'digest'])
    && HISTORY_KINDS.includes(value.kind) && Number.isSafeInteger(value.recordCount)
    && value.recordCount >= 0 && digest(value.digest),
};

function recordKey(collection, record) {
  return collection === 'history' ? record.kind : record.ref;
}

function validate(snapshot, side) {
  demand(shape(snapshot, [...META, ...COLLECTIONS]), 'INVALID_SHAPE', side);
  demand(snapshot.schemaVersion === 1, 'UNSUPPORTED_SCHEMA', side);
  demand(['synthetic', 'isolated', 'production'].includes(snapshot.environment), 'INVALID_ENVIRONMENT', side);
  demand(['enterpriseRef', 'baselineRef', 'captureRef'].every(key => ref(snapshot[key])), 'INVALID_CONTEXT', side);
  demand(instant(snapshot.capturedAt) && instant(snapshot.historyCutoff), 'INVALID_TIME', side);
  demand(snapshot.historyCutoff <= snapshot.capturedAt, 'INVALID_CUTOFF', side);
  demand(snapshot.complete === true, 'INCOMPLETE_SNAPSHOT', side);
  const indexes = {};
  for (const collection of COLLECTIONS) {
    const records = snapshot[collection];
    demand(Array.isArray(records) && records.length <= MAX_RECORDS, 'INVALID_COLLECTION', side, collection);
    if (['users', 'roles', 'shops'].includes(collection)) {
      demand(records.length > 0, 'EMPTY_BASELINE', side, collection);
    }
    const index = new Map();
    for (const [position, record] of records.entries()) {
      demand(CHECKS[collection](record), 'INVALID_RECORD', side, collection, position);
      const key = recordKey(collection, record);
      demand(!index.has(key), 'DUPLICATE_RECORD', side, collection, position);
      index.set(key, { record, position });
    }
    indexes[collection] = index;
  }
  demand(HISTORY_KINDS.every(kind => indexes.history.has(kind)), 'INCOMPLETE_HISTORY', side, 'history');
  for (const [index, user] of snapshot.users.entries()) {
    demand(user.roleRefs.every(role => indexes.roles.has(role)), 'UNKNOWN_ROLE', side, 'users', index);
  }
  for (const [index, channel] of snapshot.channels.entries()) {
    demand(channel.shopRef === null || indexes.shops.has(channel.shopRef), 'UNKNOWN_SHOP', side, 'channels', index);
  }
  const shopIds = snapshot.shops.map(shop => shop.shopifyShopRef).filter(value => value !== null);
  demand(new Set(shopIds).size === shopIds.length, 'DUPLICATE_SHOP_MAPPING', side, 'shops');
  return indexes;
}

// Permission/scope arrays are sets. Record array order and object key order are irrelevant.
function canonical(value) {
  if (Array.isArray(value)) return JSON.stringify([...value].sort());
  return JSON.stringify(value);
}

function baseReport(status, issues = []) {
  return {
    status,
    comparisonOnly: true,
    sourceAuthenticityVerified: false,
    productionReady: false,
    issues,
  };
}

export function compareSnapshots(before, after) {
  try {
    const left = validate(before, 'before');
    const right = validate(after, 'after');
    for (const key of ['environment', 'enterpriseRef', 'baselineRef', 'historyCutoff']) {
      demand(before[key] === after[key], 'CONTEXT_MISMATCH', 'pair');
    }
    demand(before.captureRef !== after.captureRef, 'SAME_CAPTURE', 'pair');
    demand(after.capturedAt > before.capturedAt, 'CAPTURE_ORDER_INVALID', 'pair');
    const issues = [];
    for (const collection of COLLECTIONS) {
      for (const [key, { record, position }] of left[collection]) {
        const candidate = right[collection].get(key);
        if (!candidate) {
          issues.push({ code: 'RECORD_MISSING', side: 'before', collection, index: position });
          continue;
        }
        const fields = Object.keys(record).filter(field => canonical(record[field]) !== canonical(candidate.record[field]));
        if (fields.length) {
          issues.push({ code: 'RECORD_CHANGED', side: 'before', collection, index: position, fields });
        }
      }
      for (const [key, { position }] of right[collection]) {
        if (!left[collection].has(key)) {
          issues.push({ code: 'RECORD_ADDED', side: 'after', collection, index: position });
        }
      }
    }
    return {
      ...baseReport(issues.length ? 'DRIFT_DETECTED' : 'SNAPSHOTS_MATCH', issues),
      comparedRecords: Object.fromEntries(COLLECTIONS.map(key => [key, before[key].length])),
    };
  } catch (error) {
    return baseReport('INVALID_INPUT', [error instanceof SnapshotError
      ? error.issue : { code: 'INVALID_SNAPSHOT', side: 'pair', collection: null, index: null }]);
  }
}

function readSnapshot(file, side) {
  let fd;
  try {
    // Do not read devices, pipes or leaf symlinks. Read at most MAX_BYTES + 1.
    demand(lstatSync(file).isFile(), 'REGULAR_FILE_REQUIRED', side);
    fd = openSync(file, 'r');
    const initial = fstatSync(fd);
    demand(initial.isFile(), 'REGULAR_FILE_REQUIRED', side);
    demand(initial.size > 0 && initial.size <= MAX_BYTES, 'INPUT_SIZE_INVALID', side);
    const bytes = Buffer.alloc(Math.min(initial.size + 1, MAX_BYTES + 1));
    let size = 0;
    while (size < bytes.length) {
      const count = readSync(fd, bytes, size, bytes.length - size, null);
      if (count === 0) break;
      size += count;
    }
    const final = fstatSync(fd);
    demand(size === initial.size && final.size === initial.size && final.mtimeMs === initial.mtimeMs,
      'INPUT_CHANGED_DURING_READ', side);
    const body = bytes.subarray(0, size);
    const snapshot = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
    return { snapshot, sha256: createHash('sha256').update(body).digest('hex') };
  } catch (error) {
    if (error instanceof SnapshotError) throw error;
    // Never print parser messages, OS errors, supplied paths or snapshot values.
    throw new SnapshotError('INPUT_UNREADABLE_OR_INVALID_JSON', side);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function runCheck(argv) {
  try {
    demand(argv.length === 4 && argv[0] === '--before' && argv[2] === '--after'
      && typeof argv[1] === 'string' && argv[1].length > 0
      && typeof argv[3] === 'string' && argv[3].length > 0, 'INVALID_ARGUMENTS', 'pair');
    const before = readSnapshot(argv[1], 'before');
    const after = readSnapshot(argv[3], 'after');
    const report = compareSnapshots(before.snapshot, after.snapshot);
    return {
      exitCode: report.status === 'SNAPSHOTS_MATCH' ? 0 : report.status === 'DRIFT_DETECTED' ? 1 : 2,
      report: {
        ...report,
        ...(report.status === 'INVALID_INPUT' ? {} : {
          inputSha256: { before: before.sha256, after: after.sha256 },
        }),
      },
    };
  } catch (error) {
    return {
      exitCode: 2,
      report: baseReport('INVALID_INPUT', [error instanceof SnapshotError
        ? error.issue : { code: 'INPUT_ERROR', side: 'pair', collection: null, index: null }]),
    };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { report, exitCode } = runCheck(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.exitCode = exitCode;
}
