import { AccountRuntimeSupervisor } from './account-runtime-supervisor.mjs'

export function runOfflineIsolationDrill() {
  const supervisor=new AccountRuntimeSupervisor(['fixture-account-a','fixture-account-b'],{transientFailureThreshold:3})
  supervisor.recordFailure('fixture-account-a','RISK_OR_VERIFICATION')
  const isolated=supervisor.snapshot('fixture-account-a').state==='FROZEN'&&supervisor.snapshot('fixture-account-b').state==='MONITORING'
  supervisor.recordHealthy('fixture-account-a')
  const noAutomaticRecovery=supervisor.snapshot('fixture-account-a').state==='FROZEN'
  const recovered=supervisor.recover('fixture-account-a',{humanConfirmed:true,pageState:'CHAT_PAGE_READY',hasRiskOrVerification:false,stableCycles:3})
  const safeManualRecovery=recovered.state==='MONITORING'&&recovered.writeEnabled===false
  return {mode:'FIXTURE_ONLY',productionEnabled:false,passed:isolated&&noAutomaticRecovery&&safeManualRecovery,results:[{code:'ACCOUNT_ISOLATION',passed:isolated},{code:'NO_AUTOMATIC_RECOVERY',passed:noAutomaticRecovery},{code:'MANUAL_MONITOR_ONLY_RECOVERY',passed:safeManualRecovery}]}
}
