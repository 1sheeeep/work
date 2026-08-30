const form=document.querySelector('#form'),status=document.querySelector('#status'),quality=document.querySelector('#quality'),save=document.querySelector('#save')
const requiredLabels={title:'职位名称',location:'工作地点',salaryMinK:'月薪下限',salaryMaxK:'月薪上限',salaryMonths:'薪数',experienceRequirement:'经验要求',educationRequirement:'学历要求',description:'职位描述'}
let captureConfidence=null
document.querySelector('#refresh').onclick=load
form.addEventListener('submit',saveDraft)
form.addEventListener('input',event=>{const field=event.target;if(field?.name&&field.dataset.capturedValue!==undefined&&field.dataset.capturedValue!==field.value)markCaptured(field,false);renderQuality()})
await load()

async function load(){
 setStatus('正在读取当前 BOSS 岗位详情页…','')
 const pending=await chrome.storage.session.get(['pendingJobCapture','pendingJobTabId'])
 await chrome.storage.session.remove(['pendingJobCapture','pendingJobTabId'])
 if(pending.pendingJobCapture?.ok){fillCapture(pending.pendingJobCapture);return}
 const tabs=await chrome.tabs.query({url:['https://*.zhipin.com/*','http://localhost:8091/*']});const tab=tabs.find(item=>item.id===pending.pendingJobTabId)||tabs.sort((a,b)=>(b.lastAccessed||0)-(a.lastAccessed||0))[0]
 if(!tab?.id)return setStatus('没有找到已打开的 BOSS 页面。请先打开一个岗位详情页。','error')
 try{const result=await chrome.tabs.sendMessage(tab.id,{type:'CAPTURE_CURRENT_JOB'});if(!result?.ok)return setStatus(result?.reason||'当前页面无法采集，请确认已打开岗位详情。','error');fillCapture(result)}catch{setStatus('页面脚本尚未连接。请刷新 BOSS 岗位页后重试。','error')}
}
function fillCapture(result){captureConfidence=result.confidence||null;fill(result.data);renderQuality();const confidenceText=captureConfidence?`详情识别 ${captureConfidence.recognized}/${captureConfidence.total} 项。`:'';setStatus(result.missing?.length?`${confidenceText} 已自动填写，请补充：${result.missing.join('、')}`:`${confidenceText} 页面信息已自动采集并填写，请核对后保存。`,result.missing?.length?'warning':'success')}
function fill(data){for(const [key,value]of Object.entries(data||{})){const field=form.elements.namedItem(key);if(field){field.value=value??'';markCaptured(field,Boolean(String(value??'').trim()))}}}
function markCaptured(field,captured){const label=field.closest('label');label?.classList.toggle('captured',captured);if(captured)field.dataset.capturedValue=field.value;else delete field.dataset.capturedValue}
function renderQuality(){
 const values=Object.fromEntries(new FormData(form).entries()),missing=Object.entries(requiredLabels).filter(([key])=>!String(values[key]??'').trim()).map(([,label])=>label),warnings=[]
 const min=Number(values.salaryMinK),max=Number(values.salaryMaxK),months=Number(values.salaryMonths)
 if(!missing.includes('月薪下限')&&!missing.includes('月薪上限')&&min>max)warnings.push('月薪上限不能低于下限')
 if(!missing.includes('薪数')&&(months<12||months>16))warnings.push('薪数应在 12 至 16 之间')
 if(String(values.description||'').trim().length>0&&String(values.description||'').trim().length<30)warnings.push('职位描述过短，建议补充职责和任职条件')
 if(String(values.title||'').trim().length>0&&String(values.title||'').trim().length<2)warnings.push('职位名称过短，无法稳定匹配会话中的岗位名称')
 const captured=[...form.elements].filter(field=>field?.dataset?.capturedValue!==undefined).length
 quality.hidden=false;quality.className=`capture-quality ${missing.length?'error':warnings.length?'warning':''}`
 quality.replaceChildren();const heading=document.createElement('h2');heading.textContent=missing.length?'请先补齐必填信息':warnings.length?'请核对以下信息':'采集结果可创建岗位草稿';const note=document.createElement('p');const confidence=captureConfidence?`当前详情识别完整度 ${captureConfidence.recognized}/${captureConfidence.total}。`:'';note.textContent=`已从页面读取 ${captured}/8 个关键字段。${confidence}岗位名称应保持与 BOSS 页面展示一致，保存后仍需在控制台审核回复知识。`;quality.append(heading,note)
 const notices=[...missing.map(label=>`缺少：${label}`),...warnings];if(notices.length){const list=document.createElement('ul');for(const notice of notices){const item=document.createElement('li');item.textContent=notice;list.append(item)}quality.append(list)}
}
async function saveDraft(event){
 event.preventDefault();if(!form.reportValidity())return
 const values=Object.fromEntries(new FormData(form).entries());const payload={...values,salaryMinK:Number(values.salaryMinK),salaryMaxK:Number(values.salaryMaxK),salaryMonths:Number(values.salaryMonths)}
 if(payload.salaryMaxK<payload.salaryMinK)return setStatus('月薪上限不能低于下限。','error')
 save.disabled=true;setStatus('正在保存到招聘系统…','')
 try{const result=await chrome.runtime.sendMessage({type:'IMPORT_JOB_DRAFT',payload});if(!result?.ok)return setStatus(errorLabel(result?.action),'error');if(result.created)setStatus(`已创建职位草稿：${result.title}（${result.companyName} / ${result.accountName}）`,'success');else setStatus(`系统中已存在该岗位：${result.title}，未重复创建。`,'warning')}finally{save.disabled=false}
}
function errorLabel(action){return({DEVICE_NOT_PAIRED:'扩展尚未与招聘系统账号配对。',DEVICE_UNAUTHORIZED:'配对已失效，请重新连接。',BACKEND_UNREACHABLE:'招聘系统当前无法连接。',BACKEND_REJECTED:'岗位资料校验未通过，请检查必填项。'}[action]||'保存失败，请稍后重试。')}
function setStatus(message,type){status.textContent=message;status.className=`capture-status ${type}`}
