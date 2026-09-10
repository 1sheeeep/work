#!/usr/bin/env node
// Read-only source inventory, deliberately NOT a deployment or readiness gate.
import {createHash} from 'node:crypto';
import {lstat,readFile,realpath} from 'node:fs/promises';
import {resolve,dirname,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const SCRIPT=fileURLToPath(import.meta.url);
const ROOT=resolve(dirname(SCRIPT),'../..');
export const FILES=Object.freeze([
  'platform/backend/src/main/java/cn/xzkj/erp/iam/persistence/AuthSessionRepository.java',
  'platform/backend/src/main/java/cn/xzkj/erp/iam/preparation/CustomerServiceIdentityPreparation.java',
  'platform/backend/src/main/java/cn/xzkj/erp/iam/preparation/PersistentIdentityPreparationState.java',
  'platform/backend/src/main/java/cn/xzkj/erp/iam/preparation/IdentityPreparationBrowser.java',
  'platform/backend/src/test/java/cn/xzkj/erp/platform/connector/CustomerServiceIdentityPreparationContractTest.java',
  'platform/backend/src/test/java/cn/xzkj/erp/platform/connector/CustomerServiceIdentityPreparationPostgresql16GateTest.java',
  'platform/backend/src/test/java/cn/xzkj/erp/platform/connector/IdentityPreparationBrowserTest.java',
  'platform/backend/src/test/java/cn/xzkj/erp/platform/connector/IdentityPreparationRestoreTest.java',
  'platform/backend/src/test/java/cn/xzkj/erp/platform/connector/StoreAppReadPreparationProcessTest.java',
  'platform/customer-service/cmd/identity-preparation-rehearsal/main.go',
  'platform/customer-service/internal/preparation/identity/synthetic.go',
  'platform/customer-service/internal/platform/domain.go',
  'platform/customer-service/internal/platform/store.go',
  'platform/customer-service/internal/platform/file_store.go',
  'platform/customer-service/internal/platform/erp_identity_preparation.go',
  'platform/customer-service/internal/platform/erp_identity_preparation_test.go',
  'platform/customer-service/internal/platform/erp_identity_revision.go',
  'platform/customer-service/internal/platform/erp_identity_revision_test.go',
  'platform/customer-service/internal/platform/erp_identity_state.go',
  'platform/preparation/sql/customer-service-identity.sql',
  'platform/preparation/sql/erp-identity.sql',
  'platform/scripts/windows-maven-agent-path-gate.mjs',
  'platform/scripts/windows-maven-agent-path-gate.test.mjs',
  'platform/scripts/identity-preparation-source-manifest.mjs',
  'platform/scripts/identity-preparation-source-manifest.test.mjs',
  'platform/docs/customer-service-identity-preparation-rehearsal.md',
  'platform/preparation/README.md',
]);

const fail=()=>{throw new Error('PREPARATION_SOURCE_INVALID');};
export function sourceManifest(entries){
  if(!Array.isArray(entries)||entries.length!==FILES.length)fail();
  const byPath=new Map(entries.map(e=>[e?.path,e]));
  if(byPath.size!==FILES.length)fail();
  const files=FILES.map(path=>{
    const entry=byPath.get(path);
    if(!entry||!Buffer.isBuffer(entry.bytes)||entry.bytes.length===0||entry.bytes.length>2*1024*1024)fail();
    return {path,bytes:entry.bytes.length,sha256:createHash('sha256').update(entry.bytes).digest('hex')};
  });
  return {schemaVersion:1,kind:'identity-preparation-source-inventory',sourceOnly:true,
    deploymentAllowed:false,productionReady:false,testVersionCorrespondenceVerified:false,
    warning:'Not a release package. Review overlapping changes and verify the exact built version separately.',
    digest:createHash('sha256').update(JSON.stringify(files)).digest('hex'),files};
}

export async function inspectSources(root=ROOT){
  const actualRoot=await realpath(root);
  const entries=[];
  for(const path of FILES){
    const target=resolve(root,path);
    const actual=await realpath(target);
    const rel=relative(actualRoot,actual);
    const before=await lstat(target);
    if(isAbsolute(rel)||rel==='..'||rel.startsWith('..'+sep)||before.isSymbolicLink()||!before.isFile()||before.size>2*1024*1024)fail();
    const bytes=await readFile(target);
    const after=await lstat(target);
    if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ino!==after.ino)fail();
    entries.push({path,bytes});
  }
  return sourceManifest(entries);
}

if(process.argv[1]&&resolve(process.argv[1])===resolve(SCRIPT)){
  try{
    if(process.argv.length!==2)fail();
    process.stdout.write(JSON.stringify(await inspectSources(),null,2)+'\n');
  }catch{
    process.stderr.write('PREPARATION_SOURCE_INVALID\n');process.exitCode=1;
  }
}
