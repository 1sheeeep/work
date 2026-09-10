import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script=fileURLToPath(new URL('./native-customer-service-identity-rehearsal.mjs',import.meta.url));
const root=fileURLToPath(new URL('../../',import.meta.url));
function rejected(args,code){
  const result=spawnSync(process.execPath,[script,...args],{cwd:root,encoding:'utf8',timeout:10000,windowsHide:true});
  assert.equal(result.status,2);
  const report=JSON.parse(result.stdout.trim());
  assert.equal(report.code,code);
  assert.equal(report.productionReady,false);
  assert.equal(report.deploymentAllowed,false);
  assert.equal(report.phase,'input-validation');
  assert.doesNotMatch(result.stdout,/postgres:\/\//);
}

for(const args of [[],['--production'],['--source-archive'],['--source-archive','unused','extra']]){
  test(`reject unsafe or implicit invocation ${JSON.stringify(args)}`,()=>rejected(args,'EXTERNAL_INPUT_REJECTED'));
}
test('reject an archive outside the owned ERP build directory',()=>{
  const directory=mkdtempSync(join(tmpdir(),'native-rehearsal-boundary-'));
  const archive=join(directory,'native-source.tar');
  try {writeFileSync(archive,'synthetic-only');rejected(['--source-archive',archive],'OWNED_ARCHIVE_REQUIRED');}
  finally {unlinkSync(archive);rmdirSync(directory);}
});
test('reject changed archive bytes before starting Docker or extracting files',()=>{
  const parent=join(root,'platform/backend/target');mkdirSync(parent,{recursive:true});
  const directory=mkdtempSync(join(parent,'native-rehearsal-boundary-'));
  const archive=join(directory,'native-source.tar');
  try {writeFileSync(archive,'synthetic-only');rejected(['--source-archive',archive],'NATIVE_ARCHIVE_HASH_MISMATCH');}
  finally {unlinkSync(archive);rmdirSync(directory);}
});
