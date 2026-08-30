import { EXECUTOR_MANIFEST } from './offline-action-executor.mjs'

export async function runConnectorPreflight(config,state,{stateFileSecurity,cdpProbe}) {
  const checks=[]
  const add=(code,passed,blocking,detail)=>checks.push({code,passed,blocking,detail})
  add('PRODUCTION_EXECUTOR_DISABLED',EXECUTOR_MANIFEST.productionEnabled===false,true,'真实页面执行器必须保持关闭')
  const backend=new URL(config.backendUrl)
  add('BACKEND_TRANSPORT',backend.protocol==='https:'||['localhost','127.0.0.1','::1'].includes(backend.hostname),true,'远程后台必须使用 HTTPS，本机允许 HTTP')
  add('STATE_FILE_PERMISSION',stateFileSecurity.exists&&stateFileSecurity.secure,true,stateFileSecurity.exists?`状态文件权限 ${stateFileSecurity.mode}`:'尚未创建本地状态文件')
  const profiles=new Set(config.accounts.map(x=>x.profileDirectory)),ports=new Set(config.accounts.map(x=>x.cdpPort))
  add('ACCOUNT_RUNTIME_ISOLATION',profiles.size===config.accounts.length&&ports.size===config.accounts.length,true,'每个账号必须使用独立 Profile 和 CDP 端口')
  for(const account of config.accounts){
    const local=state.accounts[account.accountId]
    const safety=local?.runtimeSafety?.state??'MONITORING'
    const cdp=await cdpProbe(account.cdpPort)
    add(`ACCOUNT_PAIRED:${account.label}`,Boolean(local?.deviceId&&local?.deviceToken),true,'后台设备凭据仅检查是否存在')
    add(`ACCOUNT_NOT_FROZEN:${account.label}`,safety!=='FROZEN',true,safety==='FROZEN'?`账号保持冻结：${local.runtimeSafety.stopCode}`:'账号未冻结')
    add(`ACCOUNT_CDP:${account.label}`,cdp.available,false,cdp.available?(cdp.zhipinPageOpen?'Chrome 已连接且存在 BOSS 页面':'Chrome 已连接，尚未打开 BOSS 页面'):'Chrome/CDP 尚未运行')
  }
  const blockers=checks.filter(x=>x.blocking&&!x.passed)
  return {mode:'PREFLIGHT_ONLY',productionEnabled:false,readyForRealPageValidation:blockers.length===0,readyForProduction:false,accountCount:config.accounts.length,blockerCount:blockers.length,checks}
}
