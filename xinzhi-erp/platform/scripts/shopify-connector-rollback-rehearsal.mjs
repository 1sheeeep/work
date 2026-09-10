#!/usr/bin/env node
// Local-only: exact git archives, synthetic credentials, no Docker/SSH/runtime env.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.argv.length !== 2) throw new Error('No paths, URLs, credentials or other arguments accepted');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const oldRef = 'fd5e0085';
const newRef = '0c429e37';
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const env = { ...process.env, GOPROXY: 'off', GOSUMDB: 'off', GOTOOLCHAIN: 'local', GOFLAGS: '' };
for (const key of Object.keys(env)) if (/^(SHOPIFY_|XZ_|ERP_)/i.test(key)) delete env[key];
const go = process.platform === 'win32' ? 'C:/Program Files/Go/bin/go.exe' : 'go';
const parent = path.join(root, '.codex-doc-build');
mkdirSync(parent, { recursive: true });
const owned = mkdtempSync(path.join(parent, 'connector-rollback-'));
const file = path.join(owned, 'synthetic.enc');
const backup = path.join(owned, 'synthetic-new-backup.enc');
const dirs = {};
const refs = {};
for (const [name, ref] of [['old', oldRef], ['current', newRef], ['recovery', newRef]]) {
 refs[name] = execFileSync('git', ['rev-parse', ref], { cwd: root, encoding: 'utf8' }).trim();
 const dir = path.join(owned, name); mkdirSync(dir); dirs[name] = dir;
 const archive = path.join(owned, `${name}.tar`);
 execFileSync('git', ['archive', '--format=tar', `--output=${archive}`, `${ref}:platform/customer-service`], { cwd: root });
 execFileSync('tar', ['-xf', archive, '-C', dir]);
 const target = path.join(dir, 'internal/connectors/shopify/installations');
 for (const fixture of ['rehearsal_common_test.go', ...(name !== 'old' ? ['rehearsal_current_test.go'] : [])]) {
  copyFileSync(path.join(root, 'platform/scripts/fixtures/connector-rollback', fixture), path.join(target, fixture));
 }
 if (name === 'recovery') {
  const app = path.join(target, 'embedded_app.go');
  const source = readFileSync(app, 'utf8');
  const marker = 'const embeddedAppHTML = `';
  if (source.split(marker).length !== 2 || !source.trimEnd().endsWith('`')) throw new Error('Frozen app template boundary changed');
  const html = readFileSync(path.join(root, 'platform/scripts/fixtures/connector-rollback/recovery-app.html'), 'utf8');
  if (html.includes('`') || /<script/i.test(html)) throw new Error('Recovery page must be script-free');
  writeFileSync(app, source.slice(0, source.indexOf(marker)) + marker + html + '`\n');
 }
}
const phases = [];
function run(version, phase, current = false) {
 execFileSync(go, ['test', './internal/connectors/shopify/installations', '-count=1', '-run', current ? '^TestConnectorCurrentRehearsal$' : '^TestConnectorArchiveRehearsal$'], {
  cwd: dirs[version], env: { ...env, ERP_SYNTHETIC_REHEARSAL_FILE: file, ERP_SYNTHETIC_REHEARSAL_PHASE: phase },
  stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000,
 });
 phases.push(`${version}:${phase}`); console.log(`PASS ${version}:${phase}`);
}
run('old', 'seed-old');
run('current', 'read');
run('current', 'public-pages', true);
run('current', 'seed-new', true);
run('current', 'verify-preserved', true);
const lifecycleBackup = path.join(owned, 'before-lifecycle.enc');
copyFileSync(file, lifecycleBackup);
run('recovery', 'write-old');
run('current', 'verify-preserved', true);
run('recovery', 'public-pages', true);
run('recovery', 'lifecycle', true);
run('current', 'verify-lifecycle', true);
// Keep the downgrade-loss scenario independent of the lifecycle fixture.
copyFileSync(lifecycleBackup, file);
copyFileSync(file, backup);
const backupHash = sha(backup);
run('old', 'read');
if (sha(file) !== backupHash) throw new Error('Old read mutated current state');
run('old', 'write-old');
run('current', 'verify-loss', true);
// Restoration is deliberately only on this runner-owned synthetic file, with no concurrent writes.
copyFileSync(backup, file);
if (sha(file) !== backupHash) throw new Error('Synthetic backup restore mismatch');
run('current', 'verify-preserved', true);
run('current', 'read');
const changedFiles = [];
function compareTree(relative = '') {
 for (const entry of readdirSync(path.join(dirs.current, relative), { withFileTypes: true })) {
  const child = path.join(relative, entry.name);
  if (entry.isDirectory()) compareTree(child);
  else if (sha(path.join(dirs.current, child)) !== sha(path.join(dirs.recovery, child))) changedFiles.push(child.replaceAll('\\', '/'));
 }
}
compareTree();
if (JSON.stringify(changedFiles) !== JSON.stringify(['internal/connectors/shopify/installations/embedded_app.go'])) throw new Error('Recovery changed more than frozen App Home template');
const binaries = {};
for (const name of ['current', 'recovery']) {
 const output = path.join(owned, `shopify-connector-${name}-linux-amd64`);
 execFileSync(go, ['build', '-trimpath', '-buildvcs=false', '-o', output, './cmd/shopify-connector'], {
  cwd: dirs[name], env: { ...env, GOOS: 'linux', GOARCH: 'amd64', CGO_ENABLED: '0' }, stdio: 'pipe', timeout: 120000,
 });
 binaries[name] = { path: output, sha256: sha(output) };
}
const receipt = {
 status: 'REHEARSAL_PASSED_DOWNGRADE_UNSAFE', refs, phases,
 legacyUpgradePreserved: true, legacyReadPreservedBytes: true,
 legacyWriteDropsNewFields: true, syntheticBackupRestorePassed: true,
 concurrentWriteRestoreSafe: false, deploymentAllowed: false, productionReady: false,
 isolatedPublicPagesPassed: 7, sharedProxyRuntimeTested: false,
 recoveryScope: 'App Home script-free temporary recovery only; not a backend rollback',
 recoveryWritePreservesNewState: true, recoveryRevocationExpiryReplayStaleWriterPassed: true,
 changedFiles, binaries,
 network: 'No provider clients invoked; dependency downloads disabled',
 backupSha256: backupHash,
};
writeFileSync(path.join(owned, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({ ...receipt, receipt: path.join(owned, 'receipt.json') }, null, 2));
