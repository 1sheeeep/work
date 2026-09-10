#!/usr/bin/env node
// Read only fixed source files. No credentials, database, Git mutation or deployment.
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FILES = ['go.mod', 'go.sum', 'internal/platform/postgres.go', 'internal/platform/domain.go',
  'internal/platform/store.go', 'internal/platform/file_store.go', 'internal/platform/auth.go'];
const LIMIT = 2 * 1024 * 1024;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fixedReport = status => ({ status, sourceOnly: true, runtimeVersionVerified: false,
  productionReady: false, deploymentAllowed: false });

export function compareSourceProfiles(original, candidate) {
  const invalid = () => ({ ...fixedReport('INVALID_SOURCE'), issues: ['SOURCE_PROFILE_INVALID'] });
  const valid = p => p && ['single-url', 'schema-role-config'].includes(p.databaseContract)
    && /^[a-f0-9]{64}$/.test(p.sourceDigest) && /^[a-f0-9]{64}$/.test(p.dependencyDigest)
    && Array.isArray(p.migrations) && p.migrations.length > 0 && p.migrations.length <= 256
    && p.migrations.every(m => m && /^\d{3}_[a-z0-9_]+\.sql$/.test(m.name) && /^[a-f0-9]{64}$/.test(m.sha256))
    && new Set(p.migrations.map(m => m.name)).size === p.migrations.length;
  if (!valid(original) || !valid(candidate)) return invalid();
  const issues = [];
  if (original.databaseContract !== candidate.databaseContract) issues.push('DATABASE_BOOTSTRAP_CONTRACT_DIFFERS');
  if (original.dependencyDigest !== candidate.dependencyDigest) issues.push('DEPENDENCY_BASELINE_DIFFERS');
  const left = new Map(original.migrations.map(m => [m.name, m.sha256]));
  const right = new Map(candidate.migrations.map(m => [m.name, m.sha256]));
  const missingFromCandidate = [...left.keys()].filter(name => !right.has(name)).sort();
  const addedToCandidate = [...right.keys()].filter(name => !left.has(name)).sort();
  const changedInCandidate = [...left.keys()].filter(name => right.has(name) && right.get(name) !== left.get(name)).sort();
  if (missingFromCandidate.length || addedToCandidate.length || changedInCandidate.length) issues.push('MIGRATION_LINEAGE_DIFFERS');
  if (original.sourceDigest !== candidate.sourceDigest) issues.push('REVIEWED_SOURCE_DELTA_REQUIRED');
  return { ...fixedReport(issues.length ? 'REPLACEMENT_BLOCKED' : 'SELECTED_SOURCE_FILES_MATCH'), issues,
    originalSourceDigest: original.sourceDigest, candidateSourceDigest: candidate.sourceDigest,
    originalDatabaseContract: original.databaseContract, candidateDatabaseContract: candidate.databaseContract,
    migrationDifferences: { missingFromCandidate, addedToCandidate, changedInCandidate },
    warning: 'Selected source comparison only. A match never authorizes replacement or proves deployed compatibility.' };
}

export function inspectSource(root) {
  const absolute = resolve(root);
  if (!lstatSync(absolute).isDirectory() || realpathSync(absolute) !== absolute) throw new Error('SOURCE_DIRECTORY_INVALID');
  const checkedPath = name => {
    const full = join(absolute, name);
    const rel = relative(absolute, realpathSync(full));
    if (rel === '..' || rel.startsWith(`..${sep}`) || resolve(absolute, rel) !== full
      || lstatSync(full).isSymbolicLink()) throw new Error('SOURCE_PATH_INVALID');
    return full;
  };
  const read = name => {
    const full = checkedPath(name); const before = lstatSync(full);
    if (!before.isFile() || before.size < 1 || before.size > LIMIT) throw new Error('SOURCE_FILE_INVALID');
    const bytes = readFileSync(full); const after = lstatSync(full);
    if (bytes.length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error('SOURCE_CHANGED');
    return bytes;
  };
  const selected = FILES.map(name => ({ name, bytes: read(name) }));
  const postgres = new TextDecoder('utf-8', { fatal: true }).decode(selected.find(f => f.name.endsWith('/postgres.go')).bytes);
  const databaseContract = classifyDatabaseContract(postgres);
  const folder = checkedPath('internal/platform/migrations');
  const names = readdirSync(folder).sort();
  if (names.length < 1 || names.length > 256 || names.some(name => !/^\d{3}_[a-z0-9_]+\.sql$/.test(name))) throw new Error('MIGRATION_SET_INVALID');
  const migrations = names.map(name => ({ name, sha256: sha(read(`internal/platform/migrations/${name}`)) }));
  const selectedHashes = selected.map(f => ({ name: f.name, sha256: sha(f.bytes) }));
  return { databaseContract, migrations,
    dependencyDigest: sha(JSON.stringify(selectedHashes.slice(0, 2))),
    sourceDigest: sha(JSON.stringify({ selectedHashes, migrations })) };
}

export function classifyDatabaseContract(postgres) {
  const single = /func OpenPostgresStore\(ctx context\.Context, [A-Za-z_][A-Za-z0-9_]* string\)/.test(postgres);
  const configured = /type PostgresStoreConfig struct/.test(postgres)
    && /func OpenPostgresStore\(ctx context\.Context, [A-Za-z_][A-Za-z0-9_]* PostgresStoreConfig\)/.test(postgres);
  if (single === configured) throw new Error('DATABASE_CONTRACT_UNRECOGNIZED');
  return single ? 'single-url' : 'schema-role-config';
}

export function main(args = process.argv.slice(2)) {
  if (args.length) {
    process.stdout.write(`${JSON.stringify({ ...fixedReport('INVALID_SOURCE'), issues: ['EXTERNAL_INPUT_REJECTED'] })}\n`);
    return 2;
  }
  try {
    const report = compareSourceProfiles(inspectSource(resolve(ROOT, '../客服助手')), inspectSource(join(ROOT, 'platform/customer-service')));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.status === 'SELECTED_SOURCE_FILES_MATCH' ? 0 : report.status === 'REPLACEMENT_BLOCKED' ? 1 : 2;
  } catch {
    process.stdout.write(`${JSON.stringify({ ...fixedReport('INVALID_SOURCE'), issues: ['FIXED_SOURCE_UNAVAILABLE_OR_UNRECOGNIZED'] })}\n`);
    return 2;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = main();
