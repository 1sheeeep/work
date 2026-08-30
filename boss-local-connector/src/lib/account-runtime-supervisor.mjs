const IMMEDIATE_STOPS = new Set(['RISK_OR_VERIFICATION', 'TARGET_DRIFT', 'UNKNOWN_RECEIPT', 'LOGIN_EXPIRED'])

export class AccountRuntimeSupervisor {
  constructor(accountIds, { transientFailureThreshold = 3 } = {}) {
    if (!Array.isArray(accountIds) || !accountIds.length || new Set(accountIds).size !== accountIds.length) throw new Error('invalid isolated account set')
    if (!Number.isInteger(transientFailureThreshold) || transientFailureThreshold < 1 || transientFailureThreshold > 10) throw new Error('invalid transient failure threshold')
    this.threshold = transientFailureThreshold
    this.accounts = new Map(accountIds.map(id => [id, { state: 'MONITORING', consecutiveFailures: 0, stopReason: null, writeEnabled: false }]))
  }

  recordHealthy(accountId) {
    const account = this.require(accountId)
    if (account.state === 'FROZEN') return this.snapshot(accountId)
    account.consecutiveFailures = 0
    account.stopReason = null
    account.state = 'MONITORING'
    return this.snapshot(accountId)
  }

  recordFailure(accountId, code) {
    const account = this.require(accountId)
    if (account.state === 'FROZEN') return this.snapshot(accountId)
    account.consecutiveFailures += 1
    account.stopReason = code
    if (IMMEDIATE_STOPS.has(code) || account.consecutiveFailures >= this.threshold) account.state = 'FROZEN'
    else account.state = 'DEGRADED'
    account.writeEnabled = false
    return this.snapshot(accountId)
  }

  recover(accountId, evidence) {
    const account = this.require(accountId)
    if (account.state !== 'FROZEN') throw new Error('account is not frozen')
    if (!evidence?.humanConfirmed || evidence.pageState !== 'CHAT_PAGE_READY' || evidence.hasRiskOrVerification !== false || !Number.isInteger(evidence.stableCycles) || evidence.stableCycles < 3) throw new Error('manual recovery evidence rejected')
    account.state = 'MONITORING'
    account.consecutiveFailures = 0
    account.stopReason = null
    account.writeEnabled = false
    return this.snapshot(accountId)
  }

  snapshot(accountId) { const x=this.require(accountId); return Object.freeze({ accountId, ...x }) }
  all() { return [...this.accounts.keys()].map(id => this.snapshot(id)) }
  require(accountId) { const account=this.accounts.get(accountId); if(!account)throw new Error('unknown account'); return account }
}
