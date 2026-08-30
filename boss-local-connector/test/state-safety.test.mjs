import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { accountSafety, freezeAccount, loadState, recoverAccountMonitoring, saveDeviceCredentials } from '../src/lib/state.mjs'

const account={accountId:'11111111-1111-4111-8111-111111111111'}
const credentials={deviceId:'device-1',deviceToken:'secret-local-token',accountId:account.accountId,accountName:'测试账号'}

test('persists frozen account across connector restart and requires manual evidence',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'connector-state-'))
  try{
    const state=await loadState(directory)
    await saveDeviceCredentials(directory,state,account,credentials)
    await freezeAccount(directory,state,account.accountId,'RISK_OR_VERIFICATION')
    await saveDeviceCredentials(directory,state,account,{...credentials,deviceId:'device-repaired'})
    const restarted=await loadState(directory)
    assert.equal(accountSafety(restarted,account.accountId).state,'FROZEN')
    await assert.rejects(()=>recoverAccountMonitoring(directory,restarted,account.accountId,{humanConfirmed:true,pageState:'CHAT_PAGE_READY',hasRiskOrVerification:false,stableCycles:2}),/证据不足/)
    const recovered=await recoverAccountMonitoring(directory,restarted,account.accountId,{humanConfirmed:true,pageState:'CHAT_PAGE_READY',hasRiskOrVerification:false,stableCycles:3})
    assert.equal(recovered.state,'MONITORING')
    assert.equal(recovered.stopCode,null)
  }finally{await rm(directory,{recursive:true,force:true})}
})

test('serializes safety writes for isolated accounts',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'connector-state-'))
  try{
    const state=await loadState(directory)
    const second={accountId:'22222222-2222-4222-8222-222222222222'}
    await saveDeviceCredentials(directory,state,account,credentials)
    await saveDeviceCredentials(directory,state,second,{...credentials,deviceId:'device-2',accountId:second.accountId})
    await Promise.all([freezeAccount(directory,state,account.accountId,'LOGIN_REQUIRED'),freezeAccount(directory,state,second.accountId,'RISK_OR_VERIFICATION')])
    const restarted=await loadState(directory)
    assert.equal(accountSafety(restarted,account.accountId).state,'FROZEN')
    assert.equal(accountSafety(restarted,second.accountId).state,'FROZEN')
  }finally{await rm(directory,{recursive:true,force:true})}
})
