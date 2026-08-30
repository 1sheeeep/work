import test from 'node:test'
import assert from 'node:assert/strict'
import { runOfflineFaultMatrix } from '../src/lib/offline-fault-matrix.mjs'

test('fails closed for every injected executor fault',async()=>{
  const report=await runOfflineFaultMatrix()
  assert.equal(report.mode,'FIXTURE_ONLY')
  assert.equal(report.productionEnabled,false)
  assert.equal(report.scenarioCount,5)
  assert.equal(report.passed,true)
  assert.ok(report.results.every(x=>x.passed&&x.reason==='BLOCKED_AS_EXPECTED'))
})
