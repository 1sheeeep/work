import test from 'node:test'
import assert from 'node:assert/strict'
import { runConnectorPreflight } from '../src/lib/preflight.mjs'

const config={backendUrl:'http://localhost:8088',accounts:[{accountId:'a',label:'账号A',profileDirectory:'/tmp/a',cdpPort:54101},{accountId:'b',label:'账号B',profileDirectory:'/tmp/b',cdpPort:54102}]}
const paired={accounts:{a:{deviceId:'1',deviceToken:'secret-a'},b:{deviceId:'2',deviceToken:'secret-b'}}}
const cdpProbe=async()=>({available:false,zhipinPageOpen:false})

test('passes engineering gates while keeping production false',async()=>{
  const report=await runConnectorPreflight(config,paired,{stateFileSecurity:{exists:true,secure:true,mode:'600'},cdpProbe})
  assert.equal(report.readyForRealPageValidation,true)
  assert.equal(report.readyForProduction,false)
  assert.equal(report.productionEnabled,false)
  assert.equal(JSON.stringify(report).includes('secret-'),false)
})

test('blocks an unpaired or frozen account independently',async()=>{
  const state={accounts:{a:{deviceId:'1'},b:{deviceId:'2',deviceToken:'secret-b',runtimeSafety:{state:'FROZEN',stopCode:'LOGIN_REQUIRED'}}}}
  const report=await runConnectorPreflight(config,state,{stateFileSecurity:{exists:true,secure:true,mode:'600'},cdpProbe})
  assert.equal(report.readyForRealPageValidation,false)
  assert.equal(report.blockerCount,2)
  assert.ok(report.checks.some(x=>x.code==='ACCOUNT_PAIRED:账号A'&&!x.passed))
  assert.ok(report.checks.some(x=>x.code==='ACCOUNT_NOT_FROZEN:账号B'&&!x.passed))
})

test('blocks insecure remote transport and state permissions',async()=>{
  const report=await runConnectorPreflight({...config,backendUrl:'http://hr.example.com'},paired,{stateFileSecurity:{exists:true,secure:false,mode:'644'},cdpProbe})
  assert.equal(report.blockerCount,2)
})
