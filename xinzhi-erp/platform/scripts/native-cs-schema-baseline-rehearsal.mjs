#!/usr/bin/env node
// Offline structure reference only: fixed ERP-owned archive, local Docker,
// networkless disposable empty database. No production connection arguments.
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const HASH='0cd16ab8cab966d96f13290e9c2fc2861b11ca9659c45b4f11b428661333a513';
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const canonical=value=>JSON.stringify(value,(_,v)=>v && typeof v==='object' && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b,'en'))) : v);

export function compareCatalogs(reference,observed) {
  const index=snapshot=>{
    if(snapshot?.format!=='native-cs-catalog-v1' || snapshot.readOnly!=='on'
      || snapshot.isolation!=='repeatable read' || !Array.isArray(snapshot.objects)
      || !Array.isArray(snapshot.schemas) || !snapshot.schemas.every(s=>typeof s==='string')
      || !Array.isArray(snapshot.extensions) || !snapshot.extensions.every(e=>typeof e?.name==='string' && typeof e?.version==='string')
      || typeof snapshot.serverVersion!=='string' || !/^\d+\.\d+/.test(snapshot.serverVersion)) throw new Error('CATALOG_INVALID');
    const result=new Map();
    for(const item of snapshot.objects) {
      if(typeof item?.kind!=='string' || typeof item?.name!=='string'
        || !item.properties || Array.isArray(item.properties) || typeof item.properties!=='object') throw new Error('CATALOG_INVALID');
      const key=`${item.kind}:${item.name}`;
      if(result.has(key))throw new Error('CATALOG_DUPLICATE');
      result.set(key,canonical(item.properties));
    }
    return result;
  };
  const before=index(reference),after=index(observed);
  const missing=[...before.keys()].filter(key=>!after.has(key)).sort();
  const additional=[...after.keys()].filter(key=>!before.has(key)).sort();
  const changed=[...before.keys()].filter(key=>after.has(key) && before.get(key)!==after.get(key)).sort();
  const structuralDigest=s=>sha(canonical({schemas:[...s.schemas].sort(),
    extensions:[...s.extensions].sort((a,b)=>a.name.localeCompare(b.name,'en')),
    objects:[...s.objects].sort((a,b)=>`${a.kind}:${a.name}`.localeCompare(`${b.kind}:${b.name}`,'en'))}));
  const schemasMatch=canonical([...reference.schemas].sort())===canonical([...observed.schemas].sort());
  const extensionsMatch=canonical([...reference.extensions].sort((a,b)=>a.name.localeCompare(b.name,'en')))
    ===canonical([...observed.extensions].sort((a,b)=>a.name.localeCompare(b.name,'en')));
  const serverMajorMatch=reference.serverVersion?.split('.')[0]===observed.serverVersion?.split('.')[0];
  return {status:missing.length || additional.length || changed.length || !schemasMatch || !extensionsMatch || !serverMajorMatch
    ? 'STRUCTURE_REVIEW_REQUIRED' : 'CATALOG_MATCH_NOT_RELEASE_APPROVAL',
    productionReady:false,deploymentAllowed:false,missing,additional,changed,schemasMatch,extensionsMatch,serverMajorMatch,
    referenceDigest:structuralDigest(reference),observedDigest:structuralDigest(observed)};
}

async function main() {
  if(process.argv.length!==2)throw new Error('EXTERNAL_INPUT_REJECTED');
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>
    ['path','pathext','systemroot','comspec','userprofile','temp','tmp','localappdata'].includes(key.toLowerCase())));
  const run=(exe,args,input)=>{
    const r=spawnSync(exe,args,{cwd:ROOT,env,input,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:4*1024*1024});
    if(r.error || r.status!==0)throw new Error(`OWNED_SCHEMA_COMMAND_FAILED:${exe}:${args.slice(0,3).join(':')}:${r.error?.code??r.status}`);
    return r.stdout.trim();
  };
  const docker=(args,input)=>run('docker',['--context','desktop-linux',...args],input);
  const ownedRoot=realpathSync(join(ROOT,'platform/backend/target'));
  const archive=realpathSync(join(ownedRoot,'native-baseline-5f8a1f3-complete/native-source.tar'));
  if(!archive.startsWith(ownedRoot+sep) || sha(readFileSync(archive))!==HASH)throw new Error('OWNED_ARCHIVE_REQUIRED');
  const migrations=run('tar',['-tf',archive]).split(/\r?\n/)
    .filter(name=>/^internal\/platform\/migrations\/[0-9]{3}_[a-z0-9_]+\.sql$/.test(name)).sort();
  // The pinned archive contains two distinct 024_* files, hence 63, not 62.
  if(migrations.length!==63 || new Set(migrations).size!==63)throw new Error('MIGRATION_INVENTORY_CHANGED');
  if(docker(['context','inspect','desktop-linux','--format','{{.Endpoints.docker.Host}}'])!=='npipe:////./pipe/dockerDesktopLinuxEngine')throw new Error('LOCAL_DOCKER_REQUIRED');
  docker(['version','--format','{{.Server.Version}}']);
  mkdirSync(ownedRoot,{recursive:true});
  const output=mkdtempSync(join(ownedRoot,'owned-native-schema-'));
  const containerName=`owned-native-schema-${randomUUID()}`;
  writeFileSync(join(output,'container-intent.json'),JSON.stringify({containerName,network:'none',productionReady:false})+'\n');
  let container;
  let creationAttempted=false;
  let creationAcknowledged=false;
  try {
    creationAttempted=true;
    container=docker(['run','--detach','--rm','--pull=never','--network=none',
      '--name',containerName,'--label','xz.erp.preparation=native-schema-owned',
      '--memory','512m','--cpus','1','--tmpfs','/var/lib/postgresql/data:rw,size=256m',
      '--env','POSTGRES_USER=synthetic_schema','--env','POSTGRES_PASSWORD=synthetic-schema-only',
      '--env','POSTGRES_DB=synthetic_schema','postgres:16-alpine']);
    if(!/^[a-f0-9]{64}$/.test(container))throw new Error('OWNED_CONTAINER_ID_REQUIRED');
    creationAcknowledged=true;
    let ready=false;
    const readinessDeadline=Date.now()+90000;
    for(let attempt=0;Date.now()<readinessDeadline;attempt++) {
      // Do not accept the image's temporary Unix-socket initialization server.
      try {docker(['exec',container,'pg_isready','-h','127.0.0.1','-t','2','-U','synthetic_schema','-d','synthetic_schema']);ready=true;break;}
      catch {await new Promise(resolve=>setTimeout(resolve,500));}
    }
    if(!ready)throw new Error('OWNED_DATABASE_NOT_READY');
    const psql=['exec','-i',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','synthetic_schema','-d','synthetic_schema'];
    // Historical SQL is executed ONLY in this newly created, networkless DB.
    const migrationSql=migrations.map(name=>run('tar',['-xOf',archive,name])).join('\n');
    docker(psql,migrationSql);
    const catalog=JSON.parse(docker(psql,readFileSync(join(ROOT,'platform/preparation/sql/native-cs-schema-readonly.sql'),'utf8')));
    compareCatalogs(catalog,catalog);
    writeFileSync(join(output,'catalog.json'),JSON.stringify(catalog,null,2)+'\n');
    const receipt={status:'OWNED_SCHEMA_BASELINE_CREATED',productionReady:false,deploymentAllowed:false,
      sourceCommit:'5f8a1f3ab3a36bb194d1fe517a19bce3c2e602f2',archiveSha256:HASH,migrations:migrations.length,
      catalogSha256:sha(canonical(catalog)),output};
    writeFileSync(join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
    process.stdout.write(JSON.stringify(receipt)+'\n');
  } finally {
    // A timed-out create can still succeed in the engine. Resolve the exact
    // pre-recorded name, never remove by a broad label or reset Docker/WSL.
    if(creationAttempted) {
      const matches=docker(['ps','-aq','--no-trunc','--filter',`name=^/${containerName}$`]).split(/\r?\n/).filter(Boolean);
      if(matches.length>1 || matches.some(id=>!/^[a-f0-9]{64}$/.test(id)))throw new Error('OWNED_CLEANUP_UNVERIFIED');
      container=matches[0];
      if(!container && !creationAcknowledged) {
        writeFileSync(join(output,'cleanup-review.json'),JSON.stringify({status:'LATE_CREATE_REQUIRES_RECHECK',containerName})+'\n');
        process.stderr.write(`LATE_CREATE_REQUIRES_RECHECK:${containerName}\n`);
      }
    }
    if(container) {
      const label=docker(['inspect','--format','{{index .Config.Labels "xz.erp.preparation"}}',container]);
      if(label!=='native-schema-owned')throw new Error('OWNED_CONTAINER_LABEL_MISMATCH');
      docker(['rm','--force',container]);
    }
  }
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main().catch(error=>{process.stderr.write(`${error.message}\n`);process.exitCode=1;});
}
