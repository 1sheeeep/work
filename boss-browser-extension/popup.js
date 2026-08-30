const response=await chrome.runtime.sendMessage({type:'GET_STATE'}),runtime=response.runtime,config=response.config
const labels={RUNNING:'连接正常',PAUSED:'需要人工处理',DISABLED:'当前未托管',OFFLINE:'页面已离线'}
const ready=[!['DEVICE_NOT_PAIRED','DEVICE_UNAUTHORIZED'].includes(response.backendState),response.backendState==='CONNECTED',Boolean(runtime.diagnostic?.status==='READY'||runtime.diagnostic?.status==='OBSERVING'),!config.emergencyStop&&!config.monitorOnly]
document.querySelector('#state').innerHTML=`${config.monitorOnly?'<div class="popup-state ok"><b>只监测测试中</b><span>发送通道已硬性关闭</span></div>':''}<div class="popup-state ${runtime.state==='RUNNING'?'ok':''}"><b>${escape(labels[runtime.state]||runtime.state)}</b><span>${escape(runtime.reason||'运行正常')}</span></div><div class="checklist">${['账号已连接','招聘系统在线','会话页面已识别','允许自动发送'].map((label,index)=>`<p class="${ready[index]?'done':''}"><i>${ready[index]?'✓':index+1}</i>${label}</p>`).join('')}</div><p class="quota">今日已接待 ${runtime.sentToday} / ${config.dailyLimit}</p>`
const emergency=document.querySelector('#emergency');emergency.textContent=config.emergencyStop?'完成检查后允许托管':'紧急停止';emergency.onclick=async()=>{await chrome.runtime.sendMessage({type:'SET_EMERGENCY_STOP',value:!config.emergencyStop});location.reload()}
document.querySelector('#options').onclick=()=>chrome.runtime.openOptionsPage()
document.querySelector('#capture').onclick=async()=>{
 const [tab]=await chrome.tabs.query({active:true,currentWindow:true})
 let capture=null
 try{if(tab?.id&&isCapturableJobPage(tab.url||''))capture=await chrome.tabs.sendMessage(tab.id,{type:'CAPTURE_CURRENT_JOB'})}catch{}
 await chrome.storage.session.set({pendingJobCapture:capture,pendingJobTabId:tab?.id||null})
 await chrome.tabs.create({url:chrome.runtime.getURL('job-capture.html')})
}
function escape(value){const d=document.createElement('div');d.textContent=value;return d.innerHTML}
function isCapturableJobPage(url){try{const parsed=new URL(url);return parsed.hostname==='zhipin.com'||parsed.hostname.endsWith('.zhipin.com')||(parsed.hostname==='localhost'&&parsed.port==='8091')}catch{return false}}
