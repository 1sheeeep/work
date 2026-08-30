export class DrillCircuitBreaker {
  constructor({ failureThreshold = 2 } = {}) {
    if (!Number.isInteger(failureThreshold) || failureThreshold < 1) throw new Error('invalid failure threshold')
    this.failureThreshold = failureThreshold
    this.consecutiveFailures = 0
    this.state = 'CLOSED'
    this.reason = null
  }
  assertAllowed() { if (this.state === 'OPEN') throw new Error(`offline drill circuit open: ${this.reason}`) }
  record(result) {
    if (!result || !['PASSED', 'FAILED'].includes(result.outcome)) throw new Error('invalid drill result')
    if (this.state === 'OPEN') return this.snapshot()
    if (result.outcome === 'PASSED') { this.consecutiveFailures = 0; this.reason = null; return this.snapshot() }
    this.consecutiveFailures += 1
    this.reason = String(result.failureReason || 'offline drill failed').slice(0, 300)
    if (this.consecutiveFailures >= this.failureThreshold) this.state = 'OPEN'
    return this.snapshot()
  }
  manualReset({ evidenceSource } = {}) {
    if (evidenceSource !== 'FIXTURE_ONLY') throw new Error('only fixture evidence can reset the drill breaker')
    this.consecutiveFailures = 0; this.state = 'CLOSED'; this.reason = null
    return this.snapshot()
  }
  snapshot() { return { state: this.state, consecutiveFailures: this.consecutiveFailures, reason: this.reason } }
}
