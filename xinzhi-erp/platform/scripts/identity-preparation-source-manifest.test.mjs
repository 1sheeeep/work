import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {FILES,sourceManifest,inspectSources} from './identity-preparation-source-manifest.mjs';
const entries=()=>FILES.map(path=>({path,bytes:Buffer.from('synthetic-source')}));
test('inventory is deterministic and never authorizes deployment',()=>{
  const result=sourceManifest(entries());
  assert.deepEqual(result,sourceManifest(entries().reverse()));
  assert.equal(result.deploymentAllowed,false);assert.equal(result.productionReady,false);
  assert.equal(result.testVersionCorrespondenceVerified,false);assert.equal(result.sourceOnly,true);
  assert.match(result.digest,/^[a-f0-9]{64}$/);assert.equal(result.files.length,FILES.length);
  assert.ok(!JSON.stringify(result).includes('synthetic-source'));
});
test('one-byte edits change both the file and overall inventory digest',()=>{
  const before=sourceManifest(entries());const changed=entries();changed[0].bytes=Buffer.from('synthetic-sourcf');
  const after=sourceManifest(changed);assert.notEqual(before.digest,after.digest);assert.notEqual(before.files[0].sha256,after.files[0].sha256);
});
for(const kind of ['missing','extra','duplicate','empty','oversize','not-bytes','unexpected-path'])test('rejects '+kind,()=>{
  const value=entries();
  if(kind==='missing')value.pop();if(kind==='extra')value.push(value[0]);if(kind==='duplicate')value[1]=value[0];
  if(kind==='empty')value[0].bytes=Buffer.alloc(0);if(kind==='oversize')value[0].bytes=Buffer.alloc(2097153);
  if(kind==='not-bytes')value[0].bytes='sensitive-canary';if(kind==='unexpected-path')value[0].path='../credentials.env';
  assert.throws(()=>sourceManifest(value),/^Error: PREPARATION_SOURCE_INVALID$/);
});
test('fixed real source inventory excludes credentials and user reference assets',async()=>{
  const result=await inspectSources();assert.equal(result.files.length,FILES.length);
  for(const file of result.files)assert.doesNotMatch(file.path,/\.env|\.png|\.jpg|\.zip|\/one\//);
});
test('CLI rejects caller targets without echoing values',()=>{
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('./identity-preparation-source-manifest.mjs',import.meta.url)),'--source','credential-canary'],{encoding:'utf8',windowsHide:true});
  assert.equal(result.status,1);assert.equal(result.stderr,'PREPARATION_SOURCE_INVALID\n');assert.equal(result.stdout,'');
});
