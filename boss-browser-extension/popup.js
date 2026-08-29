const response=await chrome.runtime.sendMessage({type:'GET_STATE'}),runtime=response.runtime,config=response.config
document.querySelector('#state').innerHTML=`<p><b>${runtime.state}</b></p><p>${escape(runtime.reason||'运行正常')}</p><p>后端：${escape(response.backendState||'未知')}</p><p>账号：${escape(config.accountAlias||'未命名')}</p><p>今日已发：${runtime.sentToday} / ${config.dailyLimit}</p>`
const emergency=document.querySelector('#emergency');emergency.textContent=config.emergencyStop?'恢复本机自动发送':'紧急停止';emergency.onclick=async()=>{await chrome.runtime.sendMessage({type:'SET_EMERGENCY_STOP',value:!config.emergencyStop});location.reload()}
document.querySelector('#options').onclick=()=>chrome.runtime.openOptionsPage()
function escape(value){const d=document.createElement('div');d.textContent=value;return d.innerHTML}
