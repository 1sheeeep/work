import { createHash } from 'node:crypto'
import { runOfflineActionDrill } from './offline-action-executor.mjs'

const digest = value => createHash('sha256').update(value).digest('hex')
const target = digest('fault-fixture-target')
const lease = { mode: 'OFFLINE_DRILL', actionType: 'SEND_MESSAGE', targetDigest: target }
const snapshot = (state, overrides = {}) => ({ targetDigest: target, stateDigest: digest(state), hasRiskOrVerification: false, ...overrides })

const scenarios = [
  { code: 'TARGET_DRIFT', expected: /目标发生变化/, adapter: () => { let n=0; return { mode:'FIXTURE_ONLY', inspect:async()=>snapshot(`drift-${n++}`,n>1?{targetDigest:digest('other-target')}:{}), simulate:async()=>({mode:'SIMULATED_NO_BROWSER_INPUT'}) } } },
  { code: 'RISK_BEFORE', expected: /执行前出现风险/, adapter: () => ({ mode:'FIXTURE_ONLY', inspect:async()=>snapshot('risk-before',{hasRiskOrVerification:true}), simulate:async()=>({mode:'SIMULATED_NO_BROWSER_INPUT'}) }) },
  { code: 'STATE_UNCHANGED', expected: /状态未发生/, adapter: () => ({ mode:'FIXTURE_ONLY', inspect:async()=>snapshot('same-state'), simulate:async()=>({mode:'SIMULATED_NO_BROWSER_INPUT'}) }) },
  { code: 'BROWSER_INPUT_ATTEMPT', expected: /离开纯仿真模式/, adapter: () => ({ mode:'FIXTURE_ONLY', inspect:async()=>snapshot('input-state'), simulate:async()=>({mode:'CLICK'}) }) },
  { code: 'STEP_TIMEOUT', expected: /仿真动作超时/, timeout:20, adapter: () => ({ mode:'FIXTURE_ONLY', inspect:async()=>snapshot('timeout-state'), simulate:async()=>new Promise(()=>{}) }) }
]

export async function runOfflineFaultMatrix() {
  const results=[]
  for (const scenario of scenarios) {
    try {
      await runOfflineActionDrill(scenario.adapter(), lease, { stepTimeoutMs: scenario.timeout || 100 })
      results.push({ code: scenario.code, passed: false, reason: 'FAULT_NOT_BLOCKED' })
    } catch (error) {
      const reason=error instanceof Error?error.message:'unknown failure'
      results.push({ code: scenario.code, passed: scenario.expected.test(reason), reason: scenario.expected.test(reason)?'BLOCKED_AS_EXPECTED':'UNEXPECTED_FAILURE' })
    }
  }
  return { mode:'FIXTURE_ONLY',productionEnabled:false,scenarioCount:results.length,passed:results.every(x=>x.passed),results }
}
