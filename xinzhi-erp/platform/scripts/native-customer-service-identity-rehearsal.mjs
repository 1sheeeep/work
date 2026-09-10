#!/usr/bin/env node
// Source-only native compatibility rehearsal. Never builds/runs in the original repository.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { compareCatalogs } from './native-cs-schema-baseline-rehearsal.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const BASELINE='5f8a1f3ab3a36bb194d1fe517a19bce3c2e602f2';
const ARCHIVE_SHA256='0cd16ab8cab966d96f13290e9c2fc2861b11ca9659c45b4f11b428661333a513';
const TEMPLATE=join(ROOT,'platform/preparation/native-identity-rehearsal');
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>
  ['path','pathext','systemroot','comspec','userprofile','temp','tmp','localappdata'].includes(key.toLowerCase())));
Object.assign(env,{GOPROXY:'off',GOSUMDB:'off'});
let ownedContainer;
let phase='input-validation';
const command=(exe,args,cwd=ROOT,timeout=30000)=>{
  const result=spawnSync(exe,args,{cwd,env,encoding:'utf8',timeout,maxBuffer:64*1024*1024,windowsHide:true});
  if(result.error || result.status!==0) throw Object.assign(new Error('REHEARSAL_COMMAND_FAILED'),{
    phase, exitCode:result.status, processCode:result.error?.code, signal:result.signal,
    diagnostic:phase==='owned-database-marker' ? (result.stderr??'').slice(0,1200) : undefined,
  });
  return result.stdout.trim();
};
const docker=args=>command('docker',['--context','desktop-linux',...args]);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const changeOnce=(text,before,after)=>{
  if(text.split(before).length!==2)throw new Error('NATIVE_SOURCE_PATCH_CONFLICT');
  return text.replace(before,after);
};

try {
  const args=process.argv.slice(2);
  if(args.length!==2 || args[0]!=='--source-archive')throw new Error('EXTERNAL_INPUT_REJECTED');
  let pinnedArchive,tree;
  {
    // Offline mode reads only an already owned ERP source artifact, never the
    // original repository, credentials, deployment state or customer database.
    pinnedArchive=realpathSync(resolve(args[1]));
    const allowed=realpathSync(join(ROOT,'platform/backend/target'))+sep;
    if(!pinnedArchive.startsWith(allowed) || !pinnedArchive.endsWith(`${sep}native-source.tar`))throw new Error('OWNED_ARCHIVE_REQUIRED');
    if(sha(readFileSync(pinnedArchive))!==ARCHIVE_SHA256)throw new Error('NATIVE_ARCHIVE_HASH_MISMATCH');
    phase='owned-archive-inventory';
    tree=command('tar',['-tf',pinnedArchive]).split(/\r?\n/).filter(path=>!path.endsWith('/'))
      .map(path=>`100644 blob ${'0'.repeat(40)}\t${path}`);
  }
  if(tree.length!==276 || tree.some(line=>!/^100644 blob [a-f0-9]{40}\t(?:go\.(?:mod|sum)|internal\/[A-Za-z0-9_./-]+\.(?:go|sql|js|css)|extensions\/xinzhi-support-chat\/[A-Za-z0-9_./-]+\.(?:liquid|json|toml))$/.test(line)))throw new Error('NATIVE_ARCHIVE_SCOPE_CHANGED');
  phase='local-docker-context';
  if(docker(['context','inspect','desktop-linux','--format','{{.Endpoints.docker.Host}}'])!=='npipe:////./pipe/dockerDesktopLinuxEngine')throw new Error('LOCAL_DOCKER_REQUIRED');
  const parent=join(ROOT,'platform/backend/target');mkdirSync(parent,{recursive:true});
  const owned=mkdtempSync(join(parent,'owned-native-cs-identity-'));
  const source=join(owned,'source');mkdirSync(source);
  const archive=join(owned,'native-source.tar');
  phase='owned-source-export';
  copyFileSync(pinnedArchive,archive);
  command('tar',['-xf',archive,'-C',source]);
  const exportedHashes=new Map(tree.map(line=>{const path=line.split('\t')[1];return [path,sha(readFileSync(join(source,path)))];}));
  const platform=join(source,'internal/platform');
  const patch=(file,fn)=>{const path=join(platform,file);writeFileSync(path,fn(readFileSync(path,'utf8')));};
  patch('domain.go',text=>changeOnce(text,'PasswordHash          string            `json:"-"`','PasswordHash          string            `json:"-"`\n\tIdentityRevision      int64             `json:"-"`'));
  patch('file_store.go',text=>{
    text=changeOnce(text,'PasswordHash string `json:"passwordHash"`','PasswordHash string `json:"passwordHash"`\n\tIdentityRevision int64 `json:"identityRevision,omitempty"`');
    text=changeOnce(text,'fileUser{User: value, PasswordHash: value.PasswordHash}','fileUser{User: value, PasswordHash: value.PasswordHash, IdentityRevision: value.IdentityRevision}');
    return changeOnce(text,'user.PasswordHash = value.PasswordHash','user.PasswordHash = value.PasswordHash\n\t\tuser.IdentityRevision = value.IdentityRevision');
  });
  patch('store.go',text=>{
    const start=text.indexOf('func (s *MemoryStore) UpdateUser('),end=text.indexOf('\nfunc ',start+1);
    if(start<0 || end<0)throw new Error('NATIVE_SOURCE_PATCH_CONFLICT');
    let body=text.slice(start,end);
    body=changeOnce(body,'\tif strings.TrimSpace(input.DisplayName)','\tprevious := user\n\tif strings.TrimSpace(input.DisplayName)');
    body=changeOnce(body,'\tuser.UpdatedAt = time.Now().UTC()',
      '\tif user.PasswordHash != previous.PasswordHash || user.Status != previous.Status || user.Email != previous.Email || user.SystemAdmin != previous.SystemAdmin {\n\t\tuser.IdentityRevision++\n\t}\n\tuser.UpdatedAt = time.Now().UTC()');
    return text.slice(0,start)+body+text.slice(end);
  });
  patch('postgres.go',text=>{
    const start=text.indexOf('func (s *PostgresStore) Migrate(ctx context.Context) error {');
    const end=text.indexOf('\nfunc ',start+1);
    if(start<0 || end<0)throw new Error('NATIVE_SOURCE_PATCH_CONFLICT');
    return text.slice(0,start)+'func (s *PostgresStore) Migrate(ctx context.Context) error {\n\treturn s.migrateWithNativeLedger(ctx)\n}\n'+text.slice(end);
  });
  // The legacy contract explicitly expected restart to repair/replace a stored
  // shop scope. The user-approved preservation contract supersedes that one
  // assertion; retain the rest of the native contract test unchanged.
  patch('postgres_test.go',text=>{
    text=changeOnce(text,'defaultUser.ShopScope != AccessScopeAssigned','defaultUser.ShopScope != AccessScopeAll');
    return changeOnce(text,'default agent scope was not repaired: user=%#v err=%v','restart unexpectedly rewrote stored agent scope: user=%#v err=%v');
  });
  const copied=['erp_identity_preparation.go','erp_identity_revision.go','erp_identity_state.go','erp_identity_preparation_test.go','erp_identity_revision_test.go',
    'erp_store_app_read.go','erp_store_app_read_test.go','erp_store_app_inventory_preparation.go','erp_store_app_inventory_preparation_test.go'];
  for(const file of copied)copyFileSync(join(ROOT,'platform/customer-service/internal/platform',file),join(platform,file));
  // Reuse only the existing connector DTO and immediate Admin API dependencies.
  // No installation/OAuth service, copied business server or production main.
  const connectorFiles=['port.go','installation.go','adminapi/product_catalog.go','adminapi/order_catalog.go',
    'adminapi/read_binding.go','adminapi/standalone_writes.go','adminapi/preparation_budget.go'];
  for(const file of connectorFiles){const destination=join(source,'internal/connectors/shopify',file);mkdirSync(dirname(destination),{recursive:true});copyFileSync(join(ROOT,'platform/customer-service/internal/connectors/shopify',file),destination);}
  copyFileSync(join(TEMPLATE,'identity_bridge.go.txt'),join(platform,'erp_identity_native_bridge.go'));
  copyFileSync(join(TEMPLATE,'identity_native_test.go.txt'),join(platform,'erp_identity_native_test.go'));
  copyFileSync(join(TEMPLATE,'runtime_store.go.txt'),join(platform,'erp_identity_runtime.go'));
  copyFileSync(join(TEMPLATE,'runtime_test.go.txt'),join(platform,'erp_identity_runtime_test.go'));
  copyFileSync(join(TEMPLATE,'migration_ledger.go.txt'),join(platform,'erp_native_migration_ledger.go'));
  copyFileSync(join(TEMPLATE,'migration_ledger_test.go.txt'),join(platform,'erp_native_migration_ledger_test.go'));
  copyFileSync(join(TEMPLATE,'preservation.go.txt'),join(platform,'erp_native_preservation.go'));
  copyFileSync(join(TEMPLATE,'continuity_test.go.txt'),join(platform,'erp_native_continuity_test.go'));
  copyFileSync(join(TEMPLATE,'inventory_native_test.go.txt'),join(platform,'erp_native_inventory_test.go'));
  copyFileSync(join(TEMPLATE,'restore_native_test.go.txt'),join(platform,'erp_native_restore_test.go'));
  copyFileSync(join(TEMPLATE,'identity.sql'),join(platform,'erp_identity_native_rehearsal.sql'));
  const expectedChanges=new Set(['domain.go','file_store.go','store.go','postgres.go','postgres_test.go'].map(file=>`internal/platform/${file}`));
  for(const line of tree){const path=line.split('\t')[1];if(expectedChanges.has(path))continue;
    if(sha(readFileSync(join(source,path)))!==exportedHashes.get(path))throw new Error('UNINTENDED_NATIVE_SOURCE_CHANGE');
  }
  const sourcePaths=[...new Set([...tree.map(line=>line.split('\t')[1]),...copied.map(file=>`internal/platform/${file}`),...connectorFiles.map(file=>`internal/connectors/shopify/${file}`),
    ...['erp_identity_runtime.go','erp_identity_runtime_test.go','erp_identity_native_bridge.go','erp_identity_native_test.go','erp_native_migration_ledger.go','erp_native_migration_ledger_test.go','erp_native_preservation.go','erp_native_continuity_test.go','erp_native_inventory_test.go','erp_native_restore_test.go','erp_identity_native_rehearsal.sql'].map(file=>`internal/platform/${file}`)])].sort();
  const candidateFiles=sourcePaths.map(path=>({path,sha256:sha(readFileSync(join(source,path)))}));
  const candidateSourceDigest=sha(JSON.stringify(candidateFiles));
  writeFileSync(join(owned,'candidate-source-manifest.json'),JSON.stringify({sourceOnly:true,deploymentAllowed:false,candidateSourceDigest,files:candidateFiles},null,2));
  process.stdout.write('Native source exported to an owned ERP directory; original files and migrations untouched.\n');
  phase='owned-source-compile';
  const compile=spawnSync('go',['test','-json','./internal/platform','-run','^$'],{cwd:source,env,encoding:'utf8',timeout:90000,maxBuffer:16*1024*1024,windowsHide:true});
  writeFileSync(join(owned,'compile.jsonl'),compile.stdout??'');writeFileSync(join(owned,'compile.stderr.txt'),compile.stderr??'');
  if(compile.status!==0)throw new Error('NATIVE_CANDIDATE_COMPILE_FAILED');
  phase='owned-database-start';
  ownedContainer=docker(['run','--detach','--rm','--pull=never','--label','xz.erp.preparation=native-identity-owned',
    '--publish','127.0.0.1::5432','--env','POSTGRES_USER=synthetic_native_identity','--env','POSTGRES_PASSWORD=synthetic-native-only',
    '--env','POSTGRES_DB=native_cs_identity_rehearsal','postgres:16-alpine']);
  if(!/^[a-f0-9]{64}$/.test(ownedContainer))throw new Error('OWNED_CONTAINER_INVALID');
  let ready=false;
  const readinessDeadline=Date.now()+90000;
  for(let attempt=0;Date.now()<readinessDeadline;attempt++){
    // The image's initialization server listens on Unix sockets only. Waiting
    // on TCP avoids accepting that temporary server before database creation.
    const status=spawnSync('docker',['--context','desktop-linux','exec',ownedContainer,'pg_isready','-h','127.0.0.1','-U','synthetic_native_identity','-d','native_cs_identity_rehearsal'],{env,encoding:'utf8',windowsHide:true,timeout:5000});
    if(status.status===0){ready=true;break;}
    if(attempt>0 && attempt%20===0)process.stdout.write('Owned PostgreSQL is still initializing; no application tests started yet.\n');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,500);
  }
  if(!ready)throw new Error('OWNED_DATABASE_NOT_READY');
  phase='owned-database-marker';
  docker(['exec',ownedContainer,'psql','-U','synthetic_native_identity','-d','native_cs_identity_rehearsal','-v','ON_ERROR_STOP=1','-c',
    "COMMENT ON DATABASE native_cs_identity_rehearsal IS 'xz-owned-native-cs-identity-v1'"]);
  phase='owned-database-port';
  const portLine=docker(['port',ownedContainer,'5432/tcp']);
  if(!/^127\.0\.0\.1:\d+$/.test(portLine))throw new Error('OWNED_LOOPBACK_PORT_INVALID');
  const port=portLine.split(':')[1];
  process.stdout.write('Running native platform regression plus identity tests against owned loopback PostgreSQL.\n');
  const result=spawnSync('go',['test','-json','./internal/platform','-count=1','-args',`-owned-identity-port=${port}`],
    {cwd:source,env,encoding:'utf8',timeout:240000,maxBuffer:64*1024*1024,windowsHide:true});
  writeFileSync(join(owned,'native-tests.jsonl'),result.stdout??'');writeFileSync(join(owned,'native-tests.stderr.txt'),result.stderr??'');
  const events=(result.stdout??'').split(/\r?\n/).filter(Boolean).flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
  const counts=Object.fromEntries(['pass','fail','skip'].map(action=>[action,events.filter(e=>e.Test && e.Action===action).length]));
  const nativePassed=events.some(e=>e.Test==='TestNativeIdentityPreparationPreservesOriginalPostgresAndSessions' && e.Action==='pass');
  const restartVerified=events.some(e=>e.Test==='TestNativeIdentityPreparationPreservesOriginalPostgresAndSessions' && /NATIVE_LEDGER_RESTART_VERIFIED/.test(e.Output??''));
  const restartBlocked=!restartVerified;
  let postgresRegression,restore,rollback,publicSchemaComparison;
  if(result.status===0 && nativePassed){
    phase='owned-regression-database-create';
    docker(['exec',ownedContainer,'psql','-U','synthetic_native_identity','-d','native_cs_identity_rehearsal','-v','ON_ERROR_STOP=1','-c','CREATE DATABASE native_cs_regression']);
    const regressionURL=`postgres://synthetic_native_identity:synthetic-native-only@127.0.0.1:${port}/native_cs_regression?sslmode=disable`;
    process.stdout.write('Running native PostgreSQL regression in a second owned synthetic database.\n');
    const regression=spawnSync('go',['test','-json','./internal/platform','-count=1','-run','^(TestPostgres|TestConversationContactCorrectionStores)'],
      {cwd:source,env:{...env,TEST_DATABASE_URL:regressionURL,DATABASE_URL:regressionURL},encoding:'utf8',timeout:240000,maxBuffer:64*1024*1024,windowsHide:true});
    writeFileSync(join(owned,'native-postgres-tests.jsonl'),regression.stdout??'');
    writeFileSync(join(owned,'native-postgres-tests.stderr.txt'),regression.stderr??'');
    const regressionEvents=(regression.stdout??'').split(/\r?\n/).filter(Boolean).flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
    postgresRegression={exitCode:regression.status,...Object.fromEntries(['pass','fail','skip'].map(action=>[action,regressionEvents.filter(e=>e.Test && e.Action===action).length]))};
    if(postgresRegression.exitCode===0){
      phase='owned-public-schema-comparison';
      const catalog=JSON.parse(docker(['exec',ownedContainer,'psql','-X','-qAt','-v','ON_ERROR_STOP=1',
        '-U','synthetic_native_identity','-d','native_cs_identity_rehearsal','-c',
        readFileSync(join(ROOT,'platform/preparation/sql/native-cs-schema-readonly.sql'),'utf8')]));
      writeFileSync(join(owned,'public-catalog.json'),JSON.stringify(catalog,null,2));
      // Only the candidate's explicitly created ledger schema is expected to
      // differ. No production object/column/index differences are suppressed.
      const reviewed=JSON.parse(readFileSync(join(ROOT,'platform/preparation/evidence/2026-09-07-native-cs-production-catalog.json'),'utf8'));
      publicSchemaComparison=compareCatalogs(reviewed,{...catalog,schemas:catalog.schemas.filter(name=>name!=='erp_native_preparation')});
      writeFileSync(join(owned,'public-schema-comparison.json'),JSON.stringify(publicSchemaComparison,null,2));
      phase='owned-native-backup-restore';
      const snapshot=database=>{
        const names=docker(['exec',ownedContainer,'psql','-U','synthetic_native_identity','-d',database,'-At','-v','ON_ERROR_STOP=1','-c',"SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"]).split(/\r?\n/);
        if(names.length<1 || names.some(name=>!/^[_a-z][_a-z0-9]*$/.test(name)))throw new Error('OWNED_RESTORE_CATALOG_INVALID');
        return names.map(name=>({table:name,summary:docker(['exec',ownedContainer,'psql','-U','synthetic_native_identity','-d',database,'-At','-v','ON_ERROR_STOP=1','-c',`SELECT count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),'')) FROM public."${name}" t`])}));
      };
      const before=snapshot('native_cs_identity_rehearsal');
      docker(['exec',ownedContainer,'pg_dump','-U','synthetic_native_identity','-d','native_cs_identity_rehearsal','--format=custom','--file=/tmp/owned-native.dump']);
      docker(['cp',`${ownedContainer}:/tmp/owned-native.dump`,join(owned,'owned-native.dump')]);
      docker(['exec',ownedContainer,'psql','-U','synthetic_native_identity','-d','native_cs_identity_rehearsal','-v','ON_ERROR_STOP=1','-c','CREATE DATABASE native_cs_restore']);
      docker(['exec',ownedContainer,'pg_restore','-U','synthetic_native_identity','-d','native_cs_restore','--exit-on-error','/tmp/owned-native.dump']);
      docker(['exec',ownedContainer,'psql','-U','synthetic_native_identity','-d','native_cs_restore','-v','ON_ERROR_STOP=1','-c',"COMMENT ON DATABASE native_cs_restore IS 'xz-owned-native-cs-restore-v1'"]);
      const after=snapshot('native_cs_restore');
      const restoreTest=spawnSync('go',['test','-json','./internal/platform','-count=1','-run','^TestNativeOwnedRestoreRetainsSessionsAndNewChannelMessages$','-args',`-owned-identity-port=${port}`],{cwd:source,env,encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024,windowsHide:true});
      writeFileSync(join(owned,'restore-tests.jsonl'),restoreTest.stdout??'');
      const restored=snapshot('native_cs_restore');
      restore={verified:JSON.stringify(before)===JSON.stringify(after) && JSON.stringify(before)===JSON.stringify(restored) && restoreTest.status===0 && /NATIVE_RESTORE_VERIFIED/.test(restoreTest.stdout??''),tables:before.length,backupSha256:sha(readFileSync(join(owned,'owned-native.dump')))};
      phase='owned-native-rollback-binary';
      const rollbackSource=join(owned,'source-rollback');mkdirSync(rollbackSource);
      command('tar',['-xf',archive,'-C',rollbackSource]);
      const rollbackPlatform=join(rollbackSource,'internal/platform');
      const rollbackPostgres=join(rollbackPlatform,'postgres.go');
      let rollbackText=readFileSync(rollbackPostgres,'utf8');
      const rollbackStart=rollbackText.indexOf('func (s *PostgresStore) Migrate(ctx context.Context) error {'),rollbackEnd=rollbackText.indexOf('\nfunc ',rollbackStart+1);
      if(rollbackStart<0 || rollbackEnd<0)throw new Error('NATIVE_SOURCE_PATCH_CONFLICT');
      writeFileSync(rollbackPostgres,rollbackText.slice(0,rollbackStart)+'func (s *PostgresStore) Migrate(ctx context.Context) error {\n\treturn s.migrateWithNativeLedger(ctx)\n}\n'+rollbackText.slice(rollbackEnd));
      copyFileSync(join(TEMPLATE,'migration_ledger.go.txt'),join(rollbackPlatform,'erp_native_migration_ledger.go'));
      copyFileSync(join(TEMPLATE,'preservation.go.txt'),join(rollbackPlatform,'erp_native_preservation.go'));
      copyFileSync(join(TEMPLATE,'rollback_native_test.go.txt'),join(rollbackPlatform,'erp_native_rollback_test.go'));
      const rollbackTest=spawnSync('go',['test','-json','./internal/platform','-count=1','-run','^TestOwnedNativeRollbackBinaryRetainsDataAndOriginalSession$','-args',`-owned-rollback-port=${port}`],{cwd:rollbackSource,env,encoding:'utf8',timeout:90000,maxBuffer:16*1024*1024,windowsHide:true});
      writeFileSync(join(owned,'rollback-tests.jsonl'),rollbackTest.stdout??'');writeFileSync(join(owned,'rollback-tests.stderr.txt'),rollbackTest.stderr??'');
      rollback={verified:rollbackTest.status===0 && /NATIVE_ROLLBACK_BINARY_VERIFIED/.test(rollbackTest.stdout??''),identityAndSourceAdapterAbsent:true,
        businessRowsUnchanged:JSON.stringify(before)===JSON.stringify(snapshot('native_cs_identity_rehearsal'))};
    }
  }
  const report={status:result.status===0 && nativePassed && postgresRegression?.exitCode===0 && restore?.verified && rollback?.verified && rollback.businessRowsUnchanged?(restartBlocked?'NATIVE_ADAPTER_VERIFIED_RESTART_BLOCKED':'NATIVE_REHEARSAL_PASSED'):'NATIVE_REHEARSAL_FAILED',sourceOnly:true,
    productionReady:false,deploymentAllowed:false,nativeSourceCommit:BASELINE,nativeDatabaseAndSessionsVerified:nativePassed,
    testCountsIncludingSubtests:counts,originalBusinessMigrationsUnchanged:true,originalProjectModified:false,
    originalSourceFiles:tree.length,artifactDirectory:owned,archiveSha256:sha(readFileSync(archive)),
    nativeContractAdjustment:'restart_preserves_stored_shop_scope_instead_of_legacy_repair',
    originalProjectRead:false,processExitCode:result.status,processCode:result.error?.code,
    nativeRestartPreservationVerified:!restartBlocked && nativePassed,postgresRegression,restore,rollback,candidateSourceDigest,publicSchemaComparison,
    sourceOwnerAdapterVerified:nativePassed && events.some(e=>/NATIVE_STORE_APP_ADAPTER_VERIFIED/.test(e.Output??'')),
    nativeBusinessPreservationVerified:nativePassed && events.some(e=>/NATIVE_PRESERVATION_VERIFIED/.test(e.Output??'')),
    nativeChannelContinuityVerified:nativePassed && events.filter(e=>/NATIVE_CONTINUITY_VERIFIED/.test(e.Output??'')).length===2};
  writeFileSync(join(owned,'receipt.json'),JSON.stringify(report,null,2));process.stdout.write(`${JSON.stringify(report,null,2)}\n`);
  process.exitCode=report.status==='NATIVE_REHEARSAL_PASSED'?0:report.status==='NATIVE_ADAPTER_VERIFIED_RESTART_BLOCKED'?2:1;
} catch(error) {
  process.stdout.write(`${JSON.stringify({status:'NATIVE_REHEARSAL_BLOCKED',productionReady:false,deploymentAllowed:false,
    code:/^[A-Z_]+$/.test(error.message)?error.message:'REHEARSAL_FAILED',phase:error.phase??phase,
    exitCode:error.exitCode,processCode:error.processCode,signal:error.signal,diagnostic:error.diagnostic})}\n`);process.exitCode=2;
} finally {
  if(ownedContainer && /^[a-f0-9]{64}$/.test(ownedContainer)){
    const result=spawnSync('docker',['--context','desktop-linux','stop','--time','5',ownedContainer],{env,encoding:'utf8',timeout:20000,windowsHide:true});
    if(result.status!==0){process.stdout.write('OWNED_CONTAINER_CLEANUP_REQUIRES_CHECK\n');process.exitCode=2;}
  }
}
