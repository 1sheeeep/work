import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../customer-service/frontend/package.json',import.meta.url));
const ts=require('typescript');
const source=fs.readFileSync(new URL('../customer-service/frontend/src/api.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function fixture(status){const events=[];const exports={};vm.runInNewContext(code,{exports,URL,FormData,CustomEvent,window:{dispatchEvent:event=>events.push(event)},fetch:async()=>({ok:false,status,statusText:'fixture',text:async()=>JSON.stringify({error:'fixture failure'})})});return {API:exports.PlatformAPI,events};}
test('protected 401 carries only API-instance identity for global logout',async()=>{const {API,events}=fixture(401);const api=new API('http://127.0.0.1','synthetic-local-session','fixture');await assert.rejects(api.me());assert.equal(events.length,1);assert.equal(events[0].type,'xzdesk:session-expired');assert.equal(events[0].detail,api);});
test('failed password login does not expire a different authenticated session',async()=>{const {API,events}=fixture(401);await assert.rejects(new API('http://127.0.0.1').login('fixture@example.test','fixture-only'));assert.equal(events.length,0);});
test('temporary identity outage keeps local session for retry',async()=>{const {API,events}=fixture(503);await assert.rejects(new API('http://127.0.0.1','synthetic-local-session').me());assert.equal(events.length,0);});
test('late request is identifiable as an old API instance',async()=>{const {API,events}=fixture(401);const old=new API('http://127.0.0.1','old-synthetic-session');const current=new API('http://127.0.0.1','new-synthetic-session');await assert.rejects(old.me());assert.notEqual(events[0].detail,current);});
