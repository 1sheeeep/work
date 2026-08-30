import test from 'node:test'
import assert from 'node:assert/strict'
import { AccountRuntimeSupervisor } from '../src/lib/account-runtime-supervisor.mjs'
import { runOfflineIsolationDrill } from '../src/lib/offline-isolation-drill.mjs'

test('freezes only the failing account',()=>{
  const x=new AccountRuntimeSupervisor(['a','b'])
  x.recordFailure('a','RISK_OR_VERIFICATION')
  assert.equal(x.snapshot('a').state,'FROZEN')
  assert.equal(x.snapshot('b').state,'MONITORING')
})

test('transient failures use an account-local threshold',()=>{
  const x=new AccountRuntimeSupervisor(['a','b'],{transientFailureThreshold:2})
  assert.equal(x.recordFailure('a','NETWORK_ERROR').state,'DEGRADED')
  assert.equal(x.recordFailure('a','NETWORK_ERROR').state,'FROZEN')
  assert.equal(x.snapshot('b').consecutiveFailures,0)
})

test('frozen account never recovers automatically or enables writes',()=>{
  const x=new AccountRuntimeSupervisor(['a'])
  x.recordFailure('a','LOGIN_EXPIRED')
  x.recordHealthy('a')
  assert.equal(x.snapshot('a').state,'FROZEN')
  assert.throws(()=>x.recover('a',{humanConfirmed:true,pageState:'CHAT_PAGE_READY',hasRiskOrVerification:false,stableCycles:2}),/evidence rejected/)
  const recovered=x.recover('a',{humanConfirmed:true,pageState:'CHAT_PAGE_READY',hasRiskOrVerification:false,stableCycles:3})
  assert.equal(recovered.state,'MONITORING')
  assert.equal(recovered.writeEnabled,false)
})

test('offline isolation drill passes without production capability',()=>{
  const report=runOfflineIsolationDrill()
  assert.equal(report.passed,true)
  assert.equal(report.productionEnabled,false)
  assert.ok(report.results.every(x=>x.passed))
})
