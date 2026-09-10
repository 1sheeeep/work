import {readFileSync,writeFileSync,copyFileSync,mkdirSync,mkdtempSync,realpathSync} from 'node:fs';
import {resolve,join,dirname,sep} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'../..');
const input=realpathSync(resolve(process.argv[2]??''));
if(!input.startsWith(realpathSync(join(root,'platform/backend/target'))+sep))throw Error('OWNED_SOURCE_REQUIRED');
const receipt=JSON.parse(readFileSync(join(input,'receipt.json')));
if(receipt.status!=='NATIVE_REHEARSAL_PASSED' || receipt.nativeSourceCommit!=='5f8a1f3ab3a36bb194d1fe517a19bce3c2e602f2')throw Error('NATIVE_REPLAY_REQUIRED');
const manifest=JSON.parse(readFileSync(join(input,'candidate-source-manifest.json')));
const out=mkdtempSync(join(root,'platform/backend/target/native-identity-runtime-'));const source=join(out,'source');
const hash=b=>createHash('sha256').update(b).digest('hex');
for(const file of manifest.files){
 if(!/^[a-zA-Z0-9_./-]+$/.test(file.path) || file.path.split('/').includes('..'))throw Error('INVALID_SOURCE_PATH');
 const from=join(input,'source',file.path);if(hash(readFileSync(from))!==file.sha256)throw Error('SOURCE_DRIFT');
 const to=join(source,file.path);mkdirSync(dirname(to),{recursive:true});copyFileSync(from,to);
}
for(const [template,path] of [['runtime_store.go.txt','internal/platform/erp_identity_runtime.go'],['runtime_main.go.txt','cmd/erp-identity-runtime/main.go']]){
 const to=join(source,path);mkdirSync(dirname(to),{recursive:true});copyFileSync(join(root,'platform/preparation/native-identity-rehearsal',template),to);
}
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>['path','pathext','systemroot','comspec','userprofile','temp','tmp','localappdata'].includes(k.toLowerCase())));
Object.assign(env,{GOPROXY:'off',GOSUMDB:'off',GOOS:'linux',GOARCH:'amd64',CGO_ENABLED:'0'});
const runtime=join(out,'runtime');mkdirSync(runtime);
const built=spawnSync('go',['build','-trimpath','-ldflags=-s -w','-o',join(runtime,'identity-bridge'),'./cmd/erp-identity-runtime'],{cwd:source,env,windowsHide:true,encoding:'utf8',timeout:120000});
if(built.status!==0){process.stderr.write(built.stderr??'');throw Error('RUNTIME_BUILD_FAILED');}
writeFileSync(join(runtime,'Dockerfile'),'FROM scratch\nCOPY --chmod=0555 identity-bridge /identity-bridge\nUSER 65532:65532\nHEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 CMD ["/identity-bridge", "--health"]\nENTRYPOINT ["/identity-bridge"]\n');
writeFileSync(join(out,'build-receipt.json'),JSON.stringify({sourceCommit:receipt.nativeSourceCommit,sourceDigest:manifest.candidateSourceDigest,binarySha256:hash(readFileSync(join(runtime,'identity-bridge'))),nativeServerStarted:false,productionEnabled:false},null,2));
console.log(out);
