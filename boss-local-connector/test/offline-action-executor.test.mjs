import test from 'node:test';
import assert from 'node:assert/strict';
import { EXECUTOR_MANIFEST, runOfflineActionDrill } from '../src/lib/offline-action-executor.mjs';

const target='a'.repeat(64);
function adapter(options={}){let changed=false;return{mode:options.mode??'FIXTURE_ONLY',async inspect(){return{targetDigest:options.changedTarget?'c'.repeat(64):target,stateDigest:(changed?'b':'a').repeat(64),hasRiskOrVerification:Boolean(options.risk)}},async simulate(){changed=true;return{mode:options.simulationMode??'SIMULATED_NO_BROWSER_INPUT'}}};}
test('manifest can never enable production',()=>{assert.equal(EXECUTOR_MANIFEST.productionEnabled,false);assert.equal(EXECUTOR_MANIFEST.selectorSetId,null);});
test('runs all evidence steps only against a fixture',async()=>{const result=await runOfflineActionDrill(adapter(),{actionType:'SEND_MESSAGE',targetDigest:target,mode:'OFFLINE_DRILL'});assert.equal(result.outcome,'PASSED');assert.equal(result.evidenceSource,'FIXTURE_ONLY');assert.equal(result.productionEnabled,false);});
test('rejects a non fixture adapter',async()=>{await assert.rejects(()=>runOfflineActionDrill(adapter({mode:'BOSS_PAGE'}),{actionType:'SEND_MESSAGE',targetDigest:target,mode:'OFFLINE_DRILL'}),/只允许本地 fixture/);});
test('stops when target changes or risk appears',async()=>{await assert.rejects(()=>runOfflineActionDrill(adapter({changedTarget:true}),{actionType:'REQUEST_RESUME',targetDigest:target,mode:'OFFLINE_DRILL'}),/目标发生变化/);await assert.rejects(()=>runOfflineActionDrill(adapter({risk:true}),{actionType:'EXCHANGE_PHONE',targetDigest:target,mode:'OFFLINE_DRILL'}),/风险或验证提示/);});
test('rejects an adapter that attempts browser input',async()=>{await assert.rejects(()=>runOfflineActionDrill(adapter({simulationMode:'CLICK'}),{actionType:'EXCHANGE_WECHAT',targetDigest:target,mode:'OFFLINE_DRILL'}),/离开纯仿真模式/);});
