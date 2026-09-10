import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { compareSourceProfiles, classifyDatabaseContract } from './customer-service-source-compatibility-check.mjs';

const digest = 'a'.repeat(64);
const profile = () => ({ databaseContract: 'single-url', sourceDigest: digest, dependencyDigest: digest,
  migrations: [{ name: '001_init.sql', sha256: digest }] });

test('recognizes both observed source signatures without depending on parameter variable name', () => {
  assert.equal(classifyDatabaseContract('func OpenPostgresStore(ctx context.Context, databaseURL string)'), 'single-url');
  for (const parameter of ['input', 'config']) assert.equal(classifyDatabaseContract(`type PostgresStoreConfig struct {}\nfunc OpenPostgresStore(ctx context.Context, ${parameter} PostgresStoreConfig)`), 'schema-role-config');
  assert.throws(() => classifyDatabaseContract('unknown'), /DATABASE_CONTRACT_UNRECOGNIZED/);
  assert.throws(() => classifyDatabaseContract('func OpenPostgresStore(ctx context.Context, url string)\ntype PostgresStoreConfig struct {}\nfunc OpenPostgresStore(ctx context.Context, input PostgresStoreConfig)'), /DATABASE_CONTRACT_UNRECOGNIZED/);
});

test('matching selected files never authorize deployment or imply runtime verification', () => {
  const result = compareSourceProfiles(profile(), profile());
  assert.equal(result.status, 'SELECTED_SOURCE_FILES_MATCH');
  assert.equal(result.productionReady, false); assert.equal(result.deploymentAllowed, false);
  assert.equal(result.runtimeVersionVerified, false);
});
for (const [label, change, expected] of [
  ['database bootstrap', p => p.databaseContract = 'schema-role-config', 'DATABASE_BOOTSTRAP_CONTRACT_DIFFERS'],
  ['dependency baseline', p => p.dependencyDigest = 'b'.repeat(64), 'DEPENDENCY_BASELINE_DIFFERS'],
  ['selected source delta', p => p.sourceDigest = 'b'.repeat(64), 'REVIEWED_SOURCE_DELTA_REQUIRED'],
  ['migration added', p => p.migrations.push({ name: '041_erp_tenant_binding.sql', sha256: digest }), 'MIGRATION_LINEAGE_DIFFERS'],
  ['same filename changed', p => p.migrations[0].sha256 = 'b'.repeat(64), 'MIGRATION_LINEAGE_DIFFERS'],
]) test(`blocks replacement when ${label} differs`, () => {
  const after = profile(); change(after);
  const result = compareSourceProfiles(profile(), after);
  assert.equal(result.status, 'REPLACEMENT_BLOCKED'); assert.ok(result.issues.includes(expected));
});
test('missing production migration is not silently treated as an older compatible schema', () => {
  const original = profile(); original.migrations.push({ name: '062_conversation_reply_language.sql', sha256: digest });
  assert.deepEqual(compareSourceProfiles(original, profile()).migrationDifferences.missingFromCandidate, ['062_conversation_reply_language.sql']);
});
for (const invalid of [null, {}, { ...profile(), migrations: [] },
  { ...profile(), migrations: [profile().migrations[0], profile().migrations[0]] },
  { ...profile(), sourceDigest: 'synthetic-secret-must-not-echo' }]) test('invalid source profile stays blocked and sanitized', () => {
  const result = compareSourceProfiles(profile(), invalid);
  assert.equal(result.status, 'INVALID_SOURCE'); assert.ok(!JSON.stringify(result).includes('synthetic-secret'));
});
test('CLI accepts no caller-provided path or credentials', () => {
  const result = spawnSync(process.execPath, ['platform/scripts/customer-service-source-compatibility-check.mjs', '--source', 'synthetic-secret'], { encoding: 'utf8' });
  assert.equal(result.status, 2); assert.ok(!result.stdout.includes('synthetic-secret'));
  assert.equal(JSON.parse(result.stdout).deploymentAllowed, false); assert.equal(result.stderr, '');
});
