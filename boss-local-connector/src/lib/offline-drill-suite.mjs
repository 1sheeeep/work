import { createHash } from 'node:crypto'
import { runOfflineActionDrill, EXECUTOR_MANIFEST } from './offline-action-executor.mjs'
import { DrillCircuitBreaker } from './drill-circuit-breaker.mjs'

const digest = value => createHash('sha256').update(value).digest('hex')

function fixtureAdapter(actionType) {
  let revision = 0
  const targetDigest = digest(`fixture-target:${actionType}`)
  return {
    mode: 'FIXTURE_ONLY',
    async inspect() { return { targetDigest, stateDigest: digest(`fixture-state:${actionType}:${revision}`), hasRiskOrVerification: false } },
    async simulate(action) {
      if (action !== actionType) throw new Error('fixture action mismatch')
      revision += 1
      return { mode: 'SIMULATED_NO_BROWSER_INPUT' }
    }
  }
}

export async function runOfflineDrillSuite() {
  const breaker = new DrillCircuitBreaker({ failureThreshold: 1 })
  const results = []
  for (const actionType of EXECUTOR_MANIFEST.actions) {
    breaker.assertAllowed()
    try {
      const result = await runOfflineActionDrill(fixtureAdapter(actionType), { mode: 'OFFLINE_DRILL', actionType, targetDigest: digest(`fixture-target:${actionType}`) })
      breaker.record(result)
      results.push(result)
    } catch (error) {
      breaker.record({ outcome: 'FAILED', failureReason: error instanceof Error ? error.message : 'unknown fixture failure' })
      throw error
    }
  }
  return { mode: 'FIXTURE_ONLY', productionEnabled: false, actionCount: results.length, passed: results.every(x => x.outcome === 'PASSED'), results }
}
