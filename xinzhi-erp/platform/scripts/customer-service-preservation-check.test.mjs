import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { compareSnapshots, runCheck } from './customer-service-preservation-check.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const script = fileURLToPath(new URL('./customer-service-preservation-check.mjs', import.meta.url));

function snapshots() {
  const before = {
    schemaVersion: 1,
    environment: 'synthetic',
    enterpriseRef: 'fixture-enterprise',
    baselineRef: 'fixture-baseline',
    captureRef: 'fixture-capture-before',
    capturedAt: '2026-09-06T10:00:00.000Z',
    historyCutoff: '2026-09-06T09:00:00.000Z',
    complete: true,
    users: [
      { ref: 'fixture-agent', status: 'active', roleRefs: ['fixture-agent-role'], scopeDigest: digest('fixture-shop-1-only') },
      { ref: 'fixture-disabled', status: 'disabled', roleRefs: [], scopeDigest: digest('fixture-no-shops') },
    ],
    roles: [
      { ref: 'fixture-agent-role', permissionCodes: ['workbench.access', 'conversations.reply'] },
      { ref: 'fixture-unused-role', permissionCodes: [] },
    ],
    shops: [
      { ref: 'fixture-shop-1', status: 'active', shopifyShopRef: 'gid://shopify/Shop/1', appRef: 'fixture-app-1', installationRef: 'fixture-install-1', grantedScopes: ['read_products', 'write_orders'] },
      { ref: 'fixture-shop-2', status: 'inactive', shopifyShopRef: null, appRef: null, installationRef: null, grantedScopes: null },
    ],
    channels: [
      { ref: 'fixture-chat', shopRef: 'fixture-shop-1', kind: 'chat', enabled: true, configurationDigest: digest('fixture-chat-config-without-secrets') },
      { ref: 'fixture-email', shopRef: null, kind: 'email', enabled: true, configurationDigest: digest('fixture-email-config-without-secrets') },
    ],
    history: ['conversations', 'messages', 'tickets', 'assignments', 'audit'].map(kind => ({
      kind, recordCount: 2, digest: digest(`fixture-${kind}-immutable-records-before-cutoff`),
    })),
  };
  const after = structuredClone(before);
  after.captureRef = 'fixture-capture-after';
  after.capturedAt = '2026-09-06T10:05:00.000Z';
  return { before, after };
}

function files(t) {
  const root = mkdtempSync(join(tmpdir(), 'xz-cs-preservation-'));
  const beforePath = join(root, 'before.json');
  const afterPath = join(root, 'after.json');
  const { before, after } = snapshots();
  writeFileSync(beforePath, JSON.stringify(before));
  writeFileSync(afterPath, JSON.stringify(after));
  t.after(() => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(root.startsWith(join(tmpdir(), 'xz-cs-preservation-')));
    // Delete only the two files owned by this fixture, never recursively.
    unlinkSync(beforePath);
    unlinkSync(afterPath);
    rmdirSync(root);
  });
  return { root, beforePath, afterPath, before, after, args: ['--before', beforePath, '--after', afterPath] };
}

test('matching protected snapshots never claim production readiness or verified provenance', () => {
  const { before, after } = snapshots();
  const report = compareSnapshots(before, after);
  assert.equal(report.status, 'SNAPSHOTS_MATCH');
  assert.equal(report.comparisonOnly, true);
  assert.equal(report.sourceAuthenticityVerified, false);
  assert.equal(report.productionReady, false);
  assert.deepEqual(report.comparedRecords, { users: 2, roles: 2, shops: 2, channels: 2, history: 5 });
  assert.deepEqual(report.issues, []);
});

test('record, object-key and permission/scope-set order do not create drift or mutate inputs', () => {
  const { before, after } = snapshots();
  for (const group of ['users', 'roles', 'shops', 'channels', 'history']) after[group].reverse();
  after.roles[1].permissionCodes.reverse();
  after.shops[1].grantedScopes.reverse();
  after.users[1] = Object.fromEntries(Object.entries(after.users[1]).reverse());
  const originalBefore = JSON.stringify(before);
  const originalAfter = JSON.stringify(after);
  assert.equal(compareSnapshots(before, after).status, 'SNAPSHOTS_MATCH');
  assert.equal(JSON.stringify(before), originalBefore);
  assert.equal(JSON.stringify(after), originalAfter);
});

for (const [name, mutate, collection, field] of [
  ['disabled account reactivated', x => { x.users[1].status = 'active'; }, 'users', 'status'],
  ['agent role elevated', x => { x.users[0].roleRefs.push('fixture-unused-role'); }, 'users', 'roleRefs'],
  ['shop access broadened', x => { x.users[0].scopeDigest = digest('all-shops'); }, 'users', 'scopeDigest'],
  ['role permissions changed', x => { x.roles[0].permissionCodes.push('settings.manage'); }, 'roles', 'permissionCodes'],
  ['shop identity replaced', x => { x.shops[0].shopifyShopRef = 'gid://shopify/Shop/999'; }, 'shops', 'shopifyShopRef'],
  ['app silently switched', x => { x.shops[0].appRef = 'fixture-app-other'; }, 'shops', 'appRef'],
  ['installation silently switched', x => { x.shops[0].installationRef = 'fixture-install-other'; }, 'shops', 'installationRef'],
  ['scope removed', x => { x.shops[0].grantedScopes.pop(); }, 'shops', 'grantedScopes'],
  ['unknown scope changed to empty', x => { x.shops[1].grantedScopes = []; }, 'shops', 'grantedScopes'],
  ['shop disabled', x => { x.shops[0].status = 'inactive'; }, 'shops', 'status'],
  ['email disabled', x => { x.channels[1].enabled = false; }, 'channels', 'enabled'],
  ['chat mapped to other shop', x => { x.channels[0].shopRef = 'fixture-shop-2'; }, 'channels', 'shopRef'],
  ['channel configuration changed', x => { x.channels[0].configurationDigest = digest('unexpected-channel-config'); }, 'channels', 'configurationDigest'],
  ['historical records lost', x => { x.history[0].recordCount--; }, 'history', 'recordCount'],
  ['history rewritten at same count', x => { x.history[1].digest = digest('rewritten-message-parent'); }, 'history', 'digest'],
]) {
  test(`detects ${name}`, () => {
    const { before, after } = snapshots();
    mutate(after);
    const report = compareSnapshots(before, after);
    assert.equal(report.status, 'DRIFT_DETECTED');
    assert.ok(report.issues.some(issue => issue.collection === collection && issue.fields?.includes(field)));
    assert.equal(report.productionReady, false);
  });
}

for (const group of ['users', 'roles', 'shops', 'channels']) {
  test(`detects missing ${group} record`, () => {
    const { before, after } = snapshots();
    after[group].pop();
    const report = compareSnapshots(before, after);
    assert.equal(report.status, 'DRIFT_DETECTED');
    assert.ok(report.issues.some(issue => issue.code === 'RECORD_MISSING' && issue.collection === group));
  });
}

test('same-count user ID replacement is both removal and addition, not an email merge', () => {
  const { before, after } = snapshots();
  after.users[1].ref = 'fixture-replacement-user';
  const report = compareSnapshots(before, after);
  assert.equal(report.status, 'DRIFT_DETECTED');
  assert.deepEqual(report.issues.map(issue => issue.code), ['RECORD_MISSING', 'RECORD_ADDED']);
});

test('extra account is not silently allowed', () => {
  const { before, after } = snapshots();
  after.users.push({ ...after.users[1], ref: 'fixture-extra-user' });
  assert.equal(compareSnapshots(before, after).issues[0].code, 'RECORD_ADDED');
});

for (const [name, mutate, code] of [
  ['omitted collection', x => { delete x.channels; }, 'INVALID_SHAPE'],
  ['unreviewed coverage', x => { x.complete = false; }, 'INCOMPLETE_SNAPSHOT'],
  ['unsupported schema', x => { x.schemaVersion = 2; }, 'UNSUPPORTED_SCHEMA'],
  ['unsupported environment', x => { x.environment = 'any'; }, 'INVALID_ENVIRONMENT'],
  ['empty users', x => { x.users = []; }, 'EMPTY_BASELINE'],
  ['duplicate user', x => { x.users.push(x.users[0]); }, 'DUPLICATE_RECORD'],
  ['duplicate scope', x => { x.shops[0].grantedScopes.push('write_orders'); }, 'INVALID_RECORD'],
  ['duplicate permission', x => { x.roles[0].permissionCodes.push('workbench.access'); }, 'INVALID_RECORD'],
  ['duplicate Shopify mapping', x => { x.shops[1].shopifyShopRef = x.shops[0].shopifyShopRef; }, 'DUPLICATE_SHOP_MAPPING'],
  ['dangling role', x => { x.users[0].roleRefs = ['fixture-absent-role']; }, 'UNKNOWN_ROLE'],
  ['dangling channel shop', x => { x.channels[0].shopRef = 'fixture-absent-shop'; }, 'UNKNOWN_SHOP'],
  ['missing history category', x => { x.history.pop(); }, 'INCOMPLETE_HISTORY'],
  ['negative history count', x => { x.history[0].recordCount = -1; }, 'INVALID_RECORD'],
  ['unsafe history count', x => { x.history[0].recordCount = Number.MAX_SAFE_INTEGER + 1; }, 'INVALID_RECORD'],
  ['invalid digest', x => { x.users[0].scopeDigest = ''; }, 'INVALID_RECORD'],
  ['unexpected secret field', x => { x.users[0].password = 'NEVER_OUTPUT_SECRET'; }, 'INVALID_RECORD'],
  ['unexpected top-level field', x => { x.accessToken = 'NEVER_OUTPUT_SECRET'; }, 'INVALID_SHAPE'],
  ['invalid timestamp', x => { x.capturedAt = '2026-02-30T10:00:00.000Z'; }, 'INVALID_TIME'],
  ['noncanonical timestamp', x => { x.capturedAt = '2026-09-06T10:05:00Z'; }, 'INVALID_TIME'],
  ['cutoff after capture', x => { x.historyCutoff = '2026-09-06T11:00:00.000Z'; }, 'INVALID_CUTOFF'],
  ['different enterprise', x => { x.enterpriseRef = 'fixture-other-enterprise'; }, 'CONTEXT_MISMATCH'],
  ['different environment', x => { x.environment = 'production'; }, 'CONTEXT_MISMATCH'],
  ['different protected cohort', x => { x.baselineRef = 'fixture-other-baseline'; }, 'CONTEXT_MISMATCH'],
  ['different history cutoff', x => { x.historyCutoff = '2026-09-06T08:00:00.000Z'; }, 'CONTEXT_MISMATCH'],
  ['same capture reused', x => { x.captureRef = 'fixture-capture-before'; }, 'SAME_CAPTURE'],
  ['reversed capture order', x => { x.capturedAt = '2026-09-06T09:30:00.000Z'; }, 'CAPTURE_ORDER_INVALID'],
]) {
  test(`rejects ${name}`, () => {
    const { before, after } = snapshots();
    mutate(after);
    const report = compareSnapshots(before, after);
    assert.equal(report.status, 'INVALID_INPUT');
    assert.equal(report.issues[0].code, code);
    assert.equal(report.productionReady, false);
    assert.ok(!JSON.stringify(report).includes('NEVER_OUTPUT_SECRET'));
  });
}

test('invalid before snapshot is rejected as well as invalid after snapshot', () => {
  const { before, after } = snapshots();
  before.complete = false;
  const report = compareSnapshots(before, after);
  assert.equal(report.status, 'INVALID_INPUT');
  assert.equal(report.issues[0].side, 'before');
});

test('null, arrays and malformed records fail closed without throwing values', () => {
  const { before, after } = snapshots();
  for (const invalid of [null, [], {}, 'NEVER_OUTPUT_SECRET']) {
    assert.equal(compareSnapshots(before, invalid).status, 'INVALID_INPUT');
  }
  after.users[0] = null;
  assert.equal(compareSnapshots(before, after).status, 'INVALID_INPUT');
});

test('reports contain only fixed categories, indices and field names, not supplied identifiers', () => {
  const { before, after } = snapshots();
  after.users[1].ref = 'NEVER_OUTPUT_USER_ID';
  after.shops[0].appRef = 'NEVER_OUTPUT_APP_ID';
  const report = JSON.stringify(compareSnapshots(before, after));
  assert.ok(!report.includes('NEVER_OUTPUT'));
  assert.ok(!report.includes('fixture-'));
  assert.ok(!report.includes('gid://'));
});

test('real CLI matches snapshots, records exact input hashes and does not change inputs', t => {
  const fixture = files(t);
  const beforeBody = readFileSync(fixture.beforePath);
  const afterBody = readFileSync(fixture.afterPath);
  const child = spawnSync(process.execPath, [script, ...fixture.args], {
    encoding: 'utf8', timeout: 10_000, env: { SystemRoot: process.env.SystemRoot ?? '' },
  });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stderr, '');
  const report = JSON.parse(child.stdout);
  assert.equal(report.status, 'SNAPSHOTS_MATCH');
  assert.equal(report.productionReady, false);
  assert.equal(report.inputSha256.before, digest(beforeBody));
  assert.equal(report.inputSha256.after, digest(afterBody));
  assert.deepEqual(readFileSync(fixture.beforePath), beforeBody);
  assert.deepEqual(readFileSync(fixture.afterPath), afterBody);
  assert.deepEqual(readdirSync(fixture.root).sort(), ['after.json', 'before.json']);
});

test('CLI returns drift code without echoing account data', t => {
  const fixture = files(t);
  fixture.after.users[1].status = 'active';
  writeFileSync(fixture.afterPath, JSON.stringify(fixture.after));
  const result = runCheck(fixture.args);
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.status, 'DRIFT_DETECTED');
  assert.ok(!JSON.stringify(result).includes('fixture-disabled'));
});

test('invalid schema does not emit a digest of accidentally supplied secret data', t => {
  const fixture = files(t);
  writeFileSync(fixture.afterPath, JSON.stringify({ password: 'NEVER_OUTPUT_SECRET' }));
  const result = runCheck(fixture.args);
  assert.equal(result.exitCode, 2);
  assert.equal(result.report.status, 'INVALID_INPUT');
  assert.equal(Object.hasOwn(result.report, 'inputSha256'), false);
  assert.ok(!JSON.stringify(result).includes('NEVER_OUTPUT_SECRET'));
});

for (const [name, body] of [
  ['truncated JSON containing a secret', '{"password":"NEVER_OUTPUT_SECRET"'],
  ['invalid UTF-8', Buffer.from([0xff, 0xfe, 0xff])],
  ['empty file', ''],
  ['oversized input', Buffer.alloc(2 * 1024 * 1024 + 1, 'x')],
]) {
  test(`CLI rejects ${name}`, t => {
    const fixture = files(t);
    writeFileSync(fixture.afterPath, body);
    const result = runCheck(fixture.args);
    assert.equal(result.exitCode, 2);
    assert.equal(result.report.status, 'INVALID_INPUT');
    assert.ok(!JSON.stringify(result).includes('NEVER_OUTPUT_SECRET'));
    assert.ok(!JSON.stringify(result).includes(fixture.root));
  });
}

test('CLI rejects missing files, directories, reused captures and extra arguments', t => {
  const fixture = files(t);
  for (const args of [
    [], ['--force'], [...fixture.args, '--ignore-drift'],
    ['--before', join(fixture.root, 'NEVER_OUTPUT_SECRET'), '--after', fixture.afterPath],
    ['--before', fixture.root, '--after', fixture.afterPath],
    ['--before', fixture.beforePath, '--after', fixture.beforePath],
  ]) {
    const result = runCheck(args);
    assert.equal(result.exitCode, 2);
    assert.ok(!JSON.stringify(result).includes('NEVER_OUTPUT_SECRET'));
    assert.ok(!JSON.stringify(result).includes(fixture.root));
  }
});
