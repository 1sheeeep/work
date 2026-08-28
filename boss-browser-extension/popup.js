const response=await chrome.runtime.sendMessage({type:'GET_STATE'}),runtime=response.runtime,config=response.config
document.querySelector('#state').innerHTML=`<p><b>${runtime.state}</b></p><p>${runtime.reason||'运行正常'}</p><p>账号：${escape(config.accountAlias||'未命名')}</p><p>今日已发：${runtime.sentToday} / ${config.dailyLimit}</p>`
document.querySelector('#options').onclick=()=>chrome.runtime.openOptionsPage()
function escape(value){const d=document.createElement('div');d.textContent=value;return d.innerHTML}
