import test from 'node:test'
import assert from 'node:assert/strict'
import { DrillCircuitBreaker } from '../src/lib/drill-circuit-breaker.mjs'

test('opens after consecutive failures and fails closed', () => {
  const breaker = new DrillCircuitBreaker({ failureThreshold: 2 })
  breaker.record({ outcome: 'FAILED', failureReason: 'target drift' })
  assert.equal(breaker.snapshot().state, 'CLOSED')
  breaker.record({ outcome: 'FAILED', failureReason: 'risk page' })
  assert.equal(breaker.snapshot().state, 'OPEN')
  assert.throws(() => breaker.assertAllowed(), /circuit open/)
})

test('success resets failures only before circuit opens', () => {
  const breaker = new DrillCircuitBreaker({ failureThreshold: 2 })
  breaker.record({ outcome: 'FAILED', failureReason: 'timeout' })
  breaker.record({ outcome: 'PASSED' })
  assert.deepEqual(breaker.snapshot(), { state: 'CLOSED', consecutiveFailures: 0, reason: null })
  breaker.record({ outcome: 'FAILED', failureReason: 'timeout' })
  breaker.record({ outcome: 'FAILED', failureReason: 'timeout' })
  breaker.record({ outcome: 'PASSED' })
  assert.equal(breaker.snapshot().state, 'OPEN')
})

test('requires explicit fixture-only reset', () => {
  const breaker = new DrillCircuitBreaker({ failureThreshold: 1 })
  breaker.record({ outcome: 'FAILED', failureReason: 'unknown receipt' })
  assert.throws(() => breaker.manualReset({ evidenceSource: 'REAL_PAGE' }), /fixture evidence/)
  assert.deepEqual(breaker.manualReset({ evidenceSource: 'FIXTURE_ONLY' }), { state: 'CLOSED', consecutiveFailures: 0, reason: null })
})
