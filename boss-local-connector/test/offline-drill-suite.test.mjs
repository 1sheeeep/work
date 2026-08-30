import test from 'node:test'
import assert from 'node:assert/strict'
import { runOfflineDrillSuite } from '../src/lib/offline-drill-suite.mjs'

test('drills every controlled action without enabling production', async () => {
  const report = await runOfflineDrillSuite()
  assert.equal(report.mode, 'FIXTURE_ONLY')
  assert.equal(report.productionEnabled, false)
  assert.equal(report.passed, true)
  assert.deepEqual(report.results.map(x => x.actionType), ['SEND_MESSAGE', 'REQUEST_RESUME', 'EXCHANGE_WECHAT', 'EXCHANGE_PHONE'])
  assert.ok(report.results.every(x => x.evidenceSource === 'FIXTURE_ONLY' && x.beforeDigest !== x.afterDigest))
})
