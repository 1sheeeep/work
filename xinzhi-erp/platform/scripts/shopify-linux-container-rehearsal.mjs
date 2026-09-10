#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

if (process.argv.length !== 2) throw new Error('No external inputs accepted');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = path.join(root, '.codex-doc-build/connector-rollback-2BhV0N');
const recorded = JSON.parse(readFileSync(path.join(source, 'receipt.json')));
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 45000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
assert.equal(docker('context', 'show'), 'desktop-linux', 'local Docker context required');
assert.equal(docker('info', '--format', '{{.OSType}}|{{.OperatingSystem}}|{{.Name}}'), 'linux|Docker Desktop|docker-desktop', 'local Linux Docker Desktop required');
const base = 'alpine@sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce';
docker('image', 'inspect', base, '--format', '{{.Id}}');
const id = `erp-connector-rehearsal-${randomUUID()}`;
const dir = mkdtempSync(path.join(root, '.codex-doc-build/linux-connector-'));
const volume = `${id}-synthetic`;
const fixture = path.join(dir, 'fixture.enc');
copyFileSync(path.join(source, 'synthetic-new-backup.enc'), fixture);
assert.equal(hash(fixture), recorded.backupSha256);
const images = {};
for (const variant of ['current', 'recovery']) {
 const input = path.join(source, `shopify-connector-${variant}-linux-amd64`);
 assert.equal(hash(input), recorded.binaries[variant].sha256);
 const context = path.join(dir, variant); mkdirSync(context); copyFileSync(input, path.join(context, 'connector'));
 writeFileSync(path.join(context, 'Dockerfile'), `FROM ${base}\nCOPY --chmod=0555 connector /connector\nUSER 65532:65532\nHEALTHCHECK --interval=1s --timeout=2s --start-period=1s --retries=10 CMD wget -q --spider http://127.0.0.1:8790/healthz || exit 1\nENTRYPOINT ["/connector"]\nCMD ["-addr","127.0.0.1:8790"]\n`);
 const tag = `${id}:${variant}`;
 docker('build', '--network=none', '--pull=false', '-t', tag, context);
 images[variant] = { tag, imageId: docker('image', 'inspect', tag, '--format', '{{.Id}}') };
}
docker('volume', 'create', '--label', `erp.rehearsal=${id}`, volume);
docker('run', '--rm', '--network=none', '--mount', `type=volume,source=${volume},target=/data`, '--mount', `type=bind,source=${fixture},target=/fixture.enc,readonly`, base, 'sh', '-c', 'cp /fixture.enc /data/state.enc && chown -R 65532:65532 /data');
const settings = {
 XZ_ERP_CONNECTOR_TOKEN: 'synthetic-service-only', SHOPIFY_APP_API_KEY: 'synthetic-app', SHOPIFY_APP_API_SECRET: 'synthetic-secret',
 SHOPIFY_APP_SCOPES: 'read_products,read_orders', SHOPIFY_APP_API_VERSION: '2026-07',
 SHOPIFY_CONNECTOR_CALLBACK_URL: 'https://connector.invalid/shopify/oauth/callback', SHOPIFY_CONNECTOR_DATA_FILE: '/data/state.enc',
 SHOPIFY_CONNECTOR_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'), SHOPIFY_CONNECTOR_ENCRYPTION_KEY_VERSION: 'synthetic-v1',
 SHOPIFY_CONNECTOR_REVOCATION_EFFECTS_MODE: 'connector-only', SHOPIFY_CHAT_WIDGET_SERVICE_ORIGIN: 'https://support.invalid',
};
for (const name of ['LEGAL_NAME','COMPANY_WEBSITE','SUPPORT_EMAIL','PRIVACY_EMAIL','EFFECTIVE_DATE','BUSINESS_ADDRESS','PROCESSING_REGIONS','SUBPROCESSORS','TRANSFER_MECHANISM','ORDER_RETENTION','BACKUP_RETENTION','DELETION_PROCESS','PRIVACY_OFFICER']) settings[`SHOPIFY_PUBLIC_${name}`] = 'Synthetic rehearsal only';
Object.assign(settings, { SHOPIFY_PUBLIC_COMPANY_WEBSITE: 'https://company.invalid', SHOPIFY_PUBLIC_SUPPORT_EMAIL: 'support@fixture.invalid', SHOPIFY_PUBLIC_PRIVACY_EMAIL: 'privacy@fixture.invalid', SHOPIFY_PUBLIC_EFFECTIVE_DATE: '2026-09-08' });
const phases = []; let active; let stableHash;
try {
 for (const [index, variant] of ['current', 'recovery', 'current'].entries()) {
  const name = `${id}-${index}`;
  // Only one process owns the synthetic data volume at a time.
  assert.equal(active, undefined);
  docker('run', '-d', '--name', name, '--label', `erp.rehearsal=${id}`, '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--memory=128m', '--cpus=0.5', '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=16m', '--mount', `type=volume,source=${volume},target=/data`, ...Object.entries(settings).flatMap(([k,v])=>['-e',`${k}=${v}`]), images[variant].tag);
  active = name;
  let healthy = false;
  for (let i=0;i<30;i++) { if (docker('inspect','--format','{{.State.Health.Status}}',name)==='healthy') {healthy=true;break;} await new Promise(r=>setTimeout(r,500)); }
  assert.ok(healthy, 'synthetic runtime did not become healthy');
  assert.equal(docker('exec',name,'sha256sum','/connector').split(' ')[0],recorded.binaries[variant].sha256);
  const policy = JSON.parse(docker('inspect','--format','{{json .HostConfig}}',name));
  assert.equal(policy.NetworkMode,'none'); assert.equal(policy.ReadonlyRootfs,true); assert.ok(!policy.PortBindings || Object.keys(policy.PortBindings).length===0);
  for (const page of ['app','privacy','terms','data-processing-terms','data-deletion','support','guide']) {
   const output=docker('exec',name,'sh','-c',`wget -S -O - http://127.0.0.1:8790/shopify/${page} 2>&1`);
   assert.match(output,/200 OK/); assert.match(output,/Referrer-Policy: no-referrer/i); assert.match(output,/frame-ancestors 'none'/);
   if(page==='app') assert.equal(output.includes('App Home temporarily unavailable'),variant==='recovery');
  }
  for(const endpoint of ['link-grant','chat-setup']) {
   const denied=docker('exec',name,'sh','-c',`wget -S -O /dev/null --post-data='' http://127.0.0.1:8790/shopify/session/${endpoint} 2>&1 || true`);
   assert.match(denied,/401 Unauthorized/);
  }
  const dataHash=docker('exec',name,'sha256sum','/data/state.enc').split(' ')[0];
  if(stableHash) assert.equal(dataHash,stableHash,'recovery startup rewrote stable data');
  stableHash=dataHash;
  docker('stop','--time','15',name);
  assert.equal(docker('inspect','--format','{{.State.ExitCode}}',name),'0');
  phases.push({variant,healthy:true,publicPages:7,unauthenticatedEndpointsDenied:2,dataHash,gracefulExit:0});
  active=undefined;
 }
 const receipt={status:'LINUX_CONTAINER_REHEARSAL_PASSED',images,phases,network:'none',user:'65532:65532',volume,productionAccess:false,deploymentAllowed:false,backendRollbackAvailable:false};
 writeFileSync(path.join(dir,'receipt.json'),JSON.stringify(receipt,null,2)); console.log(JSON.stringify({...receipt,receipt:path.join(dir,'receipt.json')},null,2));
} finally { if(active) docker('stop','--time','15',active); }
// Stopped labeled containers, images and synthetic volume are retained for inspection.
