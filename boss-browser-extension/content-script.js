(()=>{
 if(globalThis.__recruitmentBossCompanionLoaded)return
 globalThis.__recruitmentBossCompanionLoaded=true
 const RISK_TEXT=/(验证码|安全验证|操作频繁|异常访问|账号异常|请完成验证|登录状态已失效|重新登录)/
 let busy=false,timer=0
 const schedule=(delay=1000)=>{clearTimeout(timer);timer=setTimeout(tick,delay)}
 chrome.runtime.onMessage.addListener((message,_sender,respond)=>{
  if(message.type==='PING'){respond({ok:true,readyState:document.readyState});return false}
  if(message.type==='RUN_DIAGNOSTIC'){schedule(0);respond({ok:true});return false}
  if(message.type!=='START_PICKER')return false
  startPicker(message.label).then(selector=>respond({ok:Boolean(selector),selector}));return true
 })
 new MutationObserver(()=>schedule()).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class','data-direction','data-message-id','data-created-at']})
 setInterval(()=>schedule(0),60_000);schedule(0)

 async function tick(){
  if(busy)return;busy=true
  try{
   const state=await send({type:'GET_STATE'}),config=state.config
   const risk=visibleRisk();if(risk){await report(config,null,'RISK',risk);return pause(risk)}
   const snapshot=await stableSnapshot(config.selectors,config.stabilityDelayMs);if(!snapshot.ok){await report(config,null,'BLOCKED',snapshot.reason);return heartbeat('PAUSED',snapshot.reason)}
   await report(config,snapshot,'OBSERVING',config.emergencyStop?'本机紧急停止已开启':'页面结构识别成功')
   if(config.emergencyStop)return heartbeat('PAUSED','本机紧急停止已开启')
   if(!config.enabled)return heartbeat('DISABLED','后端监测策略未开启')
   if(config.requireVisibleTab&&document.visibilityState!=='visible')return heartbeat('PAUSED','会话页不在前台')
   const synced=await send({type:'SYNC_MESSAGE',payload:{externalChatId:snapshot.chatId,externalMessageId:snapshot.messageId,direction:snapshot.direction,createdAt:new Date(snapshot.createdAt).toISOString(),content:config.syncMessageContent?snapshot.content:null}})
   if(!synced?.ok){await report(config,snapshot,'BACKEND_ERROR',synced?.action||'BACKEND_ERROR');return heartbeat('PAUSED',synced?.action==='DEVICE_NOT_PAIRED'?'扩展尚未与招聘系统配对':'招聘系统连接失败或设备已撤销')}
   if(!synced.bound){await report(config,snapshot,'UNBOUND','当前网页会话尚未绑定',false);return heartbeat('PAUSED','当前网页会话尚未与候选人人工绑定')}
   if(config.monitorOnly){await report(config,snapshot,'READY','只监测模式：页面识别和消息同步正常，不会发送',true);return heartbeat('PAUSED','只监测模式已开启，禁止自动发送')}
   await report(config,snapshot,'READY','页面结构与会话绑定均正常',true)
   await heartbeat('RUNNING','')
   if(!config.automaticSend||snapshot.direction!=='INBOUND')return
   const leadership=await send({type:'ACQUIRE_TAB'});if(!leadership?.leader)return heartbeat('PAUSED','另一个 BOSS 会话标签页正在执行监测')
   const content=render(config.template,snapshot),replyDigest=await digest(content)
   const claim=await send({type:'CLAIM_SEND',payload:{externalChatId:snapshot.chatId,inboundExternalMessageId:snapshot.messageId,replyDigest}})
   if(!claim?.ok)return pause('无法向后端申请发送租约')
   if(!claim.allowed)return handleDenial(claim.action)
   await delay(3000)
   const verified=await stableSnapshot(config.selectors,config.stabilityDelayMs)
   if(!verified.ok||verified.messageKey!==snapshot.messageKey||verified.direction!=='INBOUND'){await receipt(claim.claimId,'UNKNOWN');return}
   const blocked=interactionBlocker(verified);if(blocked){await report(config,verified,'BLOCKED',blocked,true);await receipt(claim.claimId,'UNKNOWN');return pause(blocked)}
   fillEditor(verified.editor,content)
   const finalCheck=await readSnapshot(config.selectors)
   const finalBlocker=finalCheck.ok?interactionBlocker(finalCheck):'填写回复后页面结构发生变化'
   if(!finalCheck.ok||finalCheck.messageKey!==snapshot.messageKey||finalCheck.direction!=='INBOUND'||finalBlocker){clearEditor(verified.editor);await report(config,finalCheck.ok?finalCheck:null,'BLOCKED',finalBlocker||'发送前会话发生变化',true);await receipt(claim.claimId,'UNKNOWN');return pause(finalBlocker||'发送前会话发生变化')}
   verified.sendButton.click()
   const outbound=await waitForOutbound(config.selectors,content,15_000)
   if(!outbound){await receipt(claim.claimId,'UNKNOWN');return}
   await receipt(claim.claimId,'SENT',outbound.messageId)
  }catch(error){await pause(`页面适配失败：${String(error?.message||error).slice(0,160)}`)}finally{busy=false}
 }

 async function readSnapshot(s){
  let active,identity,editor,sendButton,last
  const missing=['conversationIdentity','activeConversation','message'].filter(key=>!String(s?.[key]||'').trim())
  if(missing.length)return{ok:false,reason:`页面适配器尚未配置：${missing.join(', ')}`}
  try{active=document.querySelector(s.activeConversation);identity=document.querySelector(s.conversationIdentity);editor=s.editor?document.querySelector(s.editor):null;sendButton=s.sendButton?document.querySelector(s.sendButton):null;const items=[...(active?.querySelectorAll(s.message)||[])];last=items.filter(item=>directionOf(item,s)).at(-1)}catch{return{ok:false,reason:'页面选择器无效'}}
  if(!active||!identity)return{ok:false,reason:'未找到当前会话或选中会话标识'}
  if(!active.isConnected||!identity.isConnected)return{ok:false,reason:'会话页面正在重新加载'}
  if(!last)return{ok:false,reason:'当前会话暂无可识别消息'}
  const chatId=attribute(identity,s.conversationIdAttribute),direction=directionOf(last,s),content=last.textContent?.trim()||'',rawMessageId=attribute(last,s.messageIdAttribute),messageId=rawMessageId||`derived-${await digest(`${chatId}|${direction}|${content}`)}`,rawTime=attribute(last,s.timeAttribute)||(s.messageTime?last.querySelector(s.messageTime)?.textContent?.trim()||'':''),parsed=parseVisibleTime(rawTime),createdAt=Number.isFinite(parsed)?parsed:firstObserved(messageId)
  if(!chatId)return{ok:false,reason:'页面未提供稳定会话 ID，已禁止猜测'}
  if(!direction)return{ok:false,reason:'无法确定最后一条消息方向'}
  return{ok:true,chatId,messageId,content,messageKey:`${chatId}:${messageId}`,direction,createdAt,candidateName:text(s.candidateName),jobTitle:text(s.jobTitle),editor,sendButton}
 }
 async function stableSnapshot(selectors,wait=800){const first=await readSnapshot(selectors);if(!first.ok)return first;await delay(Math.max(300,Math.min(2000,Number(wait)||800)));const second=await readSnapshot(selectors);if(!second.ok)return second;if(first.messageKey!==second.messageKey||first.direction!==second.direction)return{ok:false,reason:'会话消息仍在更新，等待页面稳定'};return second}
 function visibleRisk(){const walker=document.createTreeWalker(document.body||document.documentElement,NodeFilter.SHOW_TEXT);let node,scanned=0;while(scanned++<5000&&(node=walker.nextNode())){const value=node.nodeValue?.trim();if(!value||!RISK_TEXT.test(value))continue;const element=node.parentElement;if(element&&isVisible(element))return`检测到可见安全提示：${value.slice(0,60)}`}return''}
 function interactionBlocker(snapshot){if(!isVisible(snapshot.editor)||!isVisible(snapshot.sendButton))return'输入框或发送按钮当前不可见';if(snapshot.editor.disabled||snapshot.editor.readOnly||snapshot.editor.getAttribute('aria-disabled')==='true')return'输入框当前不可编辑';if(snapshot.sendButton.disabled||snapshot.sendButton.getAttribute('aria-disabled')==='true')return'发送按钮当前不可用';if(!isTopmost(snapshot.editor)||!isTopmost(snapshot.sendButton))return'页面弹窗或遮罩层覆盖了消息输入区域';return''}
 function isVisible(element){const style=getComputedStyle(element),rect=element.getBoundingClientRect();return style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity)!==0&&rect.width>0&&rect.height>0}
 function isTopmost(element){const rect=element.getBoundingClientRect(),x=Math.min(innerWidth-1,Math.max(0,rect.left+rect.width/2)),y=Math.min(innerHeight-1,Math.max(0,rect.top+rect.height/2)),top=document.elementFromPoint(x,y);return Boolean(top&&(top===element||element.contains(top)||top.contains(element)))}
 async function waitForOutbound(selectors,expected,timeout){const end=Date.now()+timeout;while(Date.now()<end){await delay(400);const current=await readSnapshot(selectors);if(current.ok&&current.direction==='OUTBOUND'&&current.content===expected)return current}return null}
 async function receipt(claimId,status,externalOutboundMessageId){return send({type:'SEND_RECEIPT',claimId,payload:{status,externalOutboundMessageId}})}
 async function report(config,snapshot,status,reason,bound){const adapterDigest=await digest(JSON.stringify(config.selectors||{})),list=conversationStats(config.selectors),payload={status,reason,adapterDigest,visible:document.visibilityState==='visible',bound,...list};if(snapshot){payload.chatDigest=await digest(snapshot.chatId);payload.messageDigest=await digest(snapshot.messageId);payload.direction=snapshot.direction;payload.createdAt=new Date(snapshot.createdAt).toISOString();payload.ageMinutes=(Date.now()-snapshot.createdAt)/60_000}return send({type:'DIAGNOSTIC',payload})}
 async function handleDenial(action){const quiet={NOT_TIMED_OUT:'尚未达到超时时间',MINIMUM_INTERVAL:'账号最小发送间隔未到',OUTSIDE_WINDOW:'当前不在后端允许的发送时段',DAILY_LIMIT_REACHED:'已达到后端账号日配额',ALREADY_CLAIMED:'该来信已有发送记录'};return heartbeat(quiet[action]?'RUNNING':'PAUSED',quiet[action]||`后端拒绝发送：${action}`)}
 function attribute(node,name){return String(name?node.getAttribute(name)||'':'').trim()}
 function conversationStats(s){try{const items=s.conversation?[...document.querySelectorAll(s.conversation)]:[],unread=s.conversationUnread?items.filter(item=>item.querySelector(s.conversationUnread)):[],selected=document.querySelector(s.conversationIdentity);return{conversationCount:items.length,unreadConversationCount:unread.length,selectedConversationUnread:Boolean(selected&&s.conversationUnread&&selected.querySelector(s.conversationUnread))}}catch{return{conversationCount:0,unreadConversationCount:0,selectedConversationUnread:false}}}
 function directionOf(node,s){const raw=attribute(node,s.directionAttribute).toUpperCase();if(['INBOUND','RECEIVED','GEEK'].includes(raw))return'INBOUND';if(['OUTBOUND','SENT','BOSS','HR'].includes(raw))return'OUTBOUND';try{if(s.inboundMarker&&node.querySelector(s.inboundMarker))return'INBOUND';if(s.outboundMarker&&node.querySelector(s.outboundMarker))return'OUTBOUND'}catch{}return''}
 const firstObservedTimes=new Map()
 function firstObserved(messageId){if(!firstObservedTimes.has(messageId))firstObservedTimes.set(messageId,Date.now());return firstObservedTimes.get(messageId)}
 function parseVisibleTime(value){const direct=Date.parse(value);if(Number.isFinite(direct))return direct;const match=String(value||'').match(/(\d{1,2}):(\d{2})/);if(!match)return NaN;const date=new Date();date.setHours(Number(match[1]),Number(match[2]),0,0);if(date.getTime()>Date.now()+60_000)date.setDate(date.getDate()-1);return date.getTime()}
 function startPicker(label){return new Promise(resolve=>{const previous=document.body.style.cursor;document.body.style.cursor='crosshair';const hint=document.createElement('div');hint.textContent=`请点击页面中的「${label}」，Esc 取消`;Object.assign(hint.style,{position:'fixed',zIndex:'2147483647',top:'12px',left:'50%',transform:'translateX(-50%)',padding:'10px 16px',background:'#111827',color:'#fff',borderRadius:'8px',fontSize:'14px'});document.documentElement.append(hint);const cleanup=()=>{document.body.style.cursor=previous;hint.remove();document.removeEventListener('click',pick,true);document.removeEventListener('keydown',cancel,true)},pick=event=>{event.preventDefault();event.stopPropagation();const selector=uniqueSelector(event.target);cleanup();resolve(selector)},cancel=event=>{if(event.key==='Escape'){cleanup();resolve('')}};document.addEventListener('click',pick,true);document.addEventListener('keydown',cancel,true)})}
 function uniqueSelector(node){if(!(node instanceof Element))return'';if(node.id)return`#${CSS.escape(node.id)}`;const stable=[...node.attributes].find(a=>a.name.startsWith('data-')&&a.value&&document.querySelectorAll(`[${a.name}="${CSS.escape(a.value)}"]`).length===1);if(stable)return`[${stable.name}="${CSS.escape(stable.value)}"]`;const parts=[];for(let current=node;current&&current!==document.body;current=current.parentElement){let part=current.localName;const classes=[...current.classList].filter(x=>!/[0-9]{4,}/.test(x)).slice(0,2);if(classes.length)part+=classes.map(x=>`.${CSS.escape(x)}`).join('');if(current.parentElement?.querySelectorAll(`:scope > ${part}`).length>1)part+=`:nth-child(${[...current.parentElement.children].indexOf(current)+1})`;parts.unshift(part);const selector=parts.join(' > ');if(document.querySelectorAll(selector).length===1)return selector}return parts.join(' > ')}
 function fillEditor(editor,value){editor.focus();if('value'in editor){const prototype=editor instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value')?.set?.call(editor,value)}else editor.textContent=value;editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:value}))}
 function clearEditor(editor){if('value'in editor)editor.value='';else editor.textContent='';editor.dispatchEvent(new Event('input',{bubbles:true}))}
 function text(selector){try{return selector?document.querySelector(selector)?.textContent?.trim()||'':''}catch{return''}}
 function render(template,data){return template.replaceAll('{jobTitle}',data.jobTitle||'该职位').replaceAll('{candidateName}',data.candidateName||'您')}
 async function digest(value){const bytes=new TextEncoder().encode(value),hash=await crypto.subtle.digest('SHA-256',bytes);return[...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('')}
 const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),send=message=>chrome.runtime.sendMessage(message),heartbeat=(state,reason)=>send({type:'HEARTBEAT',state,reason}),pause=reason=>send({type:'PAUSE',reason})
})()
