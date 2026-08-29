(()=>{
 const RISK_TEXT=/(验证码|安全验证|操作频繁|异常访问|账号异常|请完成验证|登录状态已失效|重新登录)/
 let busy=false,timer=0
 const schedule=(delay=1000)=>{clearTimeout(timer);timer=setTimeout(tick,delay)}
 chrome.runtime.onMessage.addListener((message,_sender,respond)=>{if(message.type!=='START_PICKER')return false;startPicker(message.label).then(selector=>respond({ok:Boolean(selector),selector}));return true})
 new MutationObserver(()=>schedule()).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class','data-direction','data-message-id','data-created-at']})
 setInterval(()=>schedule(0),60_000);schedule(0)

 async function tick(){
  if(busy)return;busy=true
  try{
   const state=await send({type:'GET_STATE'}),config=state.config
   if(config.emergencyStop)return heartbeat('PAUSED','本机紧急停止已开启')
   if(!config.enabled)return heartbeat('DISABLED','后端监测策略未开启')
   if(RISK_TEXT.test(document.body?.innerText||''))return pause('检测到登录、验证码或平台风险提示')
   if(config.requireVisibleTab&&document.visibilityState!=='visible')return heartbeat('PAUSED','会话页不在前台')
   const snapshot=readSnapshot(config.selectors);if(!snapshot.ok)return heartbeat('PAUSED',snapshot.reason)
   const synced=await send({type:'SYNC_MESSAGE',payload:{externalChatId:snapshot.chatId,externalMessageId:snapshot.messageId,direction:snapshot.direction,createdAt:new Date(snapshot.createdAt).toISOString(),content:config.syncMessageContent?snapshot.content:null}})
   if(!synced?.ok)return heartbeat('PAUSED',synced?.action==='DEVICE_NOT_PAIRED'?'扩展尚未与招聘系统配对':'招聘系统连接失败或设备已撤销')
   if(!synced.bound)return heartbeat('PAUSED','当前网页会话尚未与候选人人工绑定')
   await heartbeat('RUNNING','')
   if(!config.automaticSend||snapshot.direction!=='INBOUND')return
   const leadership=await send({type:'ACQUIRE_TAB'});if(!leadership?.leader)return heartbeat('PAUSED','另一个 BOSS 会话标签页正在执行监测')
   const content=render(config.template,snapshot),replyDigest=await digest(content)
   const claim=await send({type:'CLAIM_SEND',payload:{externalChatId:snapshot.chatId,inboundExternalMessageId:snapshot.messageId,replyDigest}})
   if(!claim?.ok)return pause('无法向后端申请发送租约')
   if(!claim.allowed)return handleDenial(claim.action)
   await delay(3000)
   const verified=readSnapshot(config.selectors)
   if(!verified.ok||verified.messageKey!==snapshot.messageKey||verified.direction!=='INBOUND'){await receipt(claim.claimId,'UNKNOWN');return}
   fillEditor(verified.editor,content)
   const finalCheck=readSnapshot(config.selectors)
   if(!finalCheck.ok||finalCheck.messageKey!==snapshot.messageKey||finalCheck.direction!=='INBOUND'){clearEditor(verified.editor);await receipt(claim.claimId,'UNKNOWN');return}
   verified.sendButton.click()
   const outbound=await waitForOutbound(config.selectors,content,15_000)
   if(!outbound){await receipt(claim.claimId,'UNKNOWN');return}
   await receipt(claim.claimId,'SENT',outbound.messageId)
  }catch(error){await pause(`页面适配失败：${String(error?.message||error).slice(0,160)}`)}finally{busy=false}
 }

 function readSnapshot(s){
  let active,editor,sendButton,last
  try{active=document.querySelector(s.activeConversation);editor=document.querySelector(s.editor);sendButton=document.querySelector(s.sendButton);last=[...(active?.querySelectorAll(s.message)||[])].at(-1)}catch{return{ok:false,reason:'页面选择器无效'}}
  if(!active||!editor||!sendButton)return{ok:false,reason:'未找到当前会话、输入框或发送按钮'}
  if(!last)return{ok:false,reason:'当前会话暂无可识别消息'}
  const chatId=attribute(active,s.conversationIdAttribute),messageId=attribute(last,s.messageIdAttribute),rawDirection=attribute(last,s.directionAttribute).toUpperCase(),rawTime=attribute(last,s.timeAttribute),parsed=Date.parse(rawTime)
  if(!chatId)return{ok:false,reason:'页面未提供稳定会话 ID，已禁止猜测'}
  if(!messageId)return{ok:false,reason:'页面未提供稳定消息 ID，已禁止发送'}
  const inbound=['INBOUND','RECEIVED','GEEK'].includes(rawDirection),outbound=['OUTBOUND','SENT','BOSS','HR'].includes(rawDirection)
  if(!inbound&&!outbound)return{ok:false,reason:'无法确定最后一条消息方向'}
  if(!Number.isFinite(parsed))return{ok:false,reason:'无法确定最后一条消息时间'}
  return{ok:true,chatId,messageId,content:last.textContent?.trim()||'',messageKey:`${chatId}:${messageId}`,direction:inbound?'INBOUND':'OUTBOUND',createdAt:parsed,candidateName:text(s.candidateName),jobTitle:text(s.jobTitle),editor,sendButton}
 }
 async function waitForOutbound(selectors,expected,timeout){const end=Date.now()+timeout;while(Date.now()<end){await delay(400);const current=readSnapshot(selectors);if(current.ok&&current.direction==='OUTBOUND'&&current.content===expected)return current}return null}
 async function receipt(claimId,status,externalOutboundMessageId){return send({type:'SEND_RECEIPT',claimId,payload:{status,externalOutboundMessageId}})}
 async function handleDenial(action){const quiet={NOT_TIMED_OUT:'尚未达到超时时间',MINIMUM_INTERVAL:'账号最小发送间隔未到',OUTSIDE_WINDOW:'当前不在后端允许的发送时段',DAILY_LIMIT_REACHED:'已达到后端账号日配额',ALREADY_CLAIMED:'该来信已有发送记录'};return heartbeat(quiet[action]?'RUNNING':'PAUSED',quiet[action]||`后端拒绝发送：${action}`)}
 function attribute(node,name){return String(name?node.getAttribute(name)||'':'').trim()}
 function startPicker(label){return new Promise(resolve=>{const previous=document.body.style.cursor;document.body.style.cursor='crosshair';const hint=document.createElement('div');hint.textContent=`请点击页面中的「${label}」，Esc 取消`;Object.assign(hint.style,{position:'fixed',zIndex:'2147483647',top:'12px',left:'50%',transform:'translateX(-50%)',padding:'10px 16px',background:'#111827',color:'#fff',borderRadius:'8px',fontSize:'14px'});document.documentElement.append(hint);const cleanup=()=>{document.body.style.cursor=previous;hint.remove();document.removeEventListener('click',pick,true);document.removeEventListener('keydown',cancel,true)},pick=event=>{event.preventDefault();event.stopPropagation();const selector=uniqueSelector(event.target);cleanup();resolve(selector)},cancel=event=>{if(event.key==='Escape'){cleanup();resolve('')}};document.addEventListener('click',pick,true);document.addEventListener('keydown',cancel,true)})}
 function uniqueSelector(node){if(!(node instanceof Element))return'';if(node.id)return`#${CSS.escape(node.id)}`;const stable=[...node.attributes].find(a=>a.name.startsWith('data-')&&a.value&&document.querySelectorAll(`[${a.name}="${CSS.escape(a.value)}"]`).length===1);if(stable)return`[${stable.name}="${CSS.escape(stable.value)}"]`;const parts=[];for(let current=node;current&&current!==document.body;current=current.parentElement){let part=current.localName;const classes=[...current.classList].filter(x=>!/[0-9]{4,}/.test(x)).slice(0,2);if(classes.length)part+=classes.map(x=>`.${CSS.escape(x)}`).join('');if(current.parentElement?.querySelectorAll(`:scope > ${part}`).length>1)part+=`:nth-child(${[...current.parentElement.children].indexOf(current)+1})`;parts.unshift(part);const selector=parts.join(' > ');if(document.querySelectorAll(selector).length===1)return selector}return parts.join(' > ')}
 function fillEditor(editor,value){editor.focus();if('value'in editor){const prototype=editor instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value')?.set?.call(editor,value)}else editor.textContent=value;editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:value}))}
 function clearEditor(editor){if('value'in editor)editor.value='';else editor.textContent='';editor.dispatchEvent(new Event('input',{bubbles:true}))}
 function text(selector){try{return selector?document.querySelector(selector)?.textContent?.trim()||'':''}catch{return''}}
 function render(template,data){return template.replaceAll('{jobTitle}',data.jobTitle||'该职位').replaceAll('{candidateName}',data.candidateName||'您')}
 async function digest(value){const bytes=new TextEncoder().encode(value),hash=await crypto.subtle.digest('SHA-256',bytes);return[...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('')}
 const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),send=message=>chrome.runtime.sendMessage(message),heartbeat=(state,reason)=>send({type:'HEARTBEAT',state,reason}),pause=reason=>send({type:'PAUSE',reason})
})()
