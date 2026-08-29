const form=document.querySelector('#form'),status=document.querySelector('#status'),save=document.querySelector('#save')
document.querySelector('#refresh').onclick=load
form.addEventListener('submit',saveDraft)
await load()

async function load(){
 setStatus('正在读取当前 BOSS 岗位详情页…','')
 const pending=await chrome.storage.session.get(['pendingJobCapture','pendingJobTabId'])
 await chrome.storage.session.remove(['pendingJobCapture','pendingJobTabId'])
 if(pending.pendingJobCapture?.ok){fillCapture(pending.pendingJobCapture);return}
 const tabs=await chrome.tabs.query({url:['https://*.zhipin.com/*']});const tab=tabs.find(item=>item.id===pending.pendingJobTabId)||tabs.sort((a,b)=>(b.lastAccessed||0)-(a.lastAccessed||0))[0]
 if(!tab?.id)return setStatus('没有找到已打开的 BOSS 页面。请先打开一个岗位详情页。','error')
 try{const result=await chrome.tabs.sendMessage(tab.id,{type:'CAPTURE_CURRENT_JOB'});if(!result?.ok)return setStatus(result?.reason||'当前页面无法采集，请确认已打开岗位详情。','error');fillCapture(result)}catch{setStatus('页面脚本尚未连接。请刷新 BOSS 岗位页后重试。','error')}
}
function fillCapture(result){fill(result.data);setStatus(result.missing?.length?`已自动填写，请补充：${result.missing.join('、')}`:'页面信息已自动采集并填写，请核对后保存。',result.missing?.length?'warning':'success')}
function fill(data){for(const [key,value]of Object.entries(data||{})){const field=form.elements.namedItem(key);if(field)field.value=value??''}}
async function saveDraft(event){
 event.preventDefault();if(!form.reportValidity())return
 const values=Object.fromEntries(new FormData(form).entries());const payload={...values,salaryMinK:Number(values.salaryMinK),salaryMaxK:Number(values.salaryMaxK),salaryMonths:Number(values.salaryMonths)}
 if(payload.salaryMaxK<payload.salaryMinK)return setStatus('月薪上限不能低于下限。','error')
 save.disabled=true;setStatus('正在保存到招聘系统…','')
 try{const result=await chrome.runtime.sendMessage({type:'IMPORT_JOB_DRAFT',payload});if(!result?.ok)return setStatus(errorLabel(result?.action),'error');if(result.created)setStatus(`已创建职位草稿：${result.title}（${result.companyName} / ${result.accountName}）`,'success');else setStatus(`系统中已存在该岗位：${result.title}，未重复创建。`,'warning')}finally{save.disabled=false}
}
function errorLabel(action){return({DEVICE_NOT_PAIRED:'扩展尚未与招聘系统账号配对。',DEVICE_UNAUTHORIZED:'配对已失效，请重新连接。',BACKEND_UNREACHABLE:'招聘系统当前无法连接。',BACKEND_REJECTED:'岗位资料校验未通过，请检查必填项。'}[action]||'保存失败，请稍后重试。')}
function setStatus(message,type){status.textContent=message;status.className=`capture-status ${type}`}
