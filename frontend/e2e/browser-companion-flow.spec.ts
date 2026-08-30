import { expect, test } from '@playwright/test'

test('manager pairs a browser device, binds a conversation and idempotently syncs a message', async ({ page }, testInfo) => {
  test.setTimeout(45_000)
  const username=process.env.E2E_USERNAME,password=process.env.E2E_PASSWORD
  if(!username||!password)throw new Error('E2E credentials are not configured')
  const suffix=testInfo.project.name.includes('mobile')?'mobile':'desktop',stamp=Date.now()
  await page.goto('/login?redirect=/organization');await page.getByLabel('用户名').fill(username);await page.getByLabel('密码').fill(password);await page.getByRole('button',{name:'登录',exact:true}).click()
  await expect(page.getByRole('heading',{name:'集团与企业'})).toBeVisible()
  const csrf=await page.evaluate(async()=>await(await fetch('/api/auth/csrf')).json())
  const accounts=await get('/api/boss-accounts'),account=accounts.find((a:any)=>a.gatewayType==='LOCAL_CDP_CONNECTOR'&&a.status==='ACTIVE'&&a.connectionStatus==='CONNECTED')
  expect(account).toBeTruthy()
  const jobs=await get('/api/job-positions'),job=jobs.find((j:any)=>j.status==='ACTIVE'&&j.bossAccount.id===account.id)
  expect(job).toBeTruthy()
  const created=await mutate('/api/candidate-contacts','POST',{jobPositionId:job.id,source:'BOSS_MOCK',externalCandidateId:`browser-${suffix}-${stamp}`,displayName:`E2E 浏览器候选人 ${suffix} ${stamp}`,currentTitle:'Java 工程师',yearsExperience:3,education:'本科',skillsSummary:'Spring Boot',hardRuleOutcome:'PASS',hardRuleRationale:'通过',aiOutcome:'PASS',aiRationale:'通过',modelVersion:'mock-v1',promptVersion:'e2e-v1'})
  const pairing=await mutate('/api/browser-devices/pairings','POST',{accountId:account.id})
  expect(pairing.pairingToken.length).toBeGreaterThan(30)
  const credentials=await mutate('/api/browser-runtime/pair','POST',{pairingToken:pairing.pairingToken,deviceName:`E2E Chrome ${suffix}`},false)
  expect(credentials.deviceToken.length).toBeGreaterThan(30)
  const auth={Authorization:`Device ${credentials.deviceToken}`}
  const heartbeat=await mutate('/api/browser-runtime/heartbeat','POST',{state:'RUNNING',reason:''},false,auth)
  expect(heartbeat.runtimeState).toBe('RUNNING')
  const chatId=`browser-chat-${suffix}-${stamp}`
  await mutate(`/api/browser-devices/${account.id}/bindings`,'POST',{contactId:created.candidate.id,externalChatId:chatId,displayHint:`E2E ${suffix}`})
  const policy={enabled:true,autoSendEnabled:true,responseTimeoutMinutes:5,dailyLimit:10,minimumIntervalSeconds:30,sendingWindowStart:'00:00:00',sendingWindowEnd:'23:59:59',timezone:'Asia/Shanghai',maxConsecutiveFailures:3,replyTemplate:'您好，已收到您关于「{jobTitle}」的消息。'}
  await mutate(`/api/auto-replies/policies/${account.id}`,'PUT',policy)
  const runtimePolicy=await getWithHeaders('/api/browser-runtime/policy',auth)
  expect(runtimePolicy).toMatchObject({configured:true,enabled:true,automaticSend:true,timeoutMinutes:5,dailyLimit:10,minimumIntervalSeconds:30,template:policy.replyTemplate})
  const payload={externalChatId:chatId,externalMessageId:`browser-message-${suffix}-${stamp}`,direction:'INBOUND',createdAt:new Date(Date.now()-6*60_000).toISOString(),content:null}
  const first=await mutate('/api/browser-runtime/messages','POST',payload,false,auth),replay=await mutate('/api/browser-runtime/messages','POST',payload,false,auth)
  expect(first).toMatchObject({bound:true,replayed:false,action:'INBOUND_STORED'})
  expect(replay).toMatchObject({bound:true,replayed:true,action:'IGNORED_REPLAY'})
  const claimPayload={externalChatId:chatId,inboundExternalMessageId:payload.externalMessageId,replyDigest:'a'.repeat(64)}
  let claim=await mutate('/api/browser-runtime/send-claims','POST',claimPayload,false,auth)
  if(claim.action==='MINIMUM_INTERVAL'){await page.waitForTimeout(31_000);claim=await mutate('/api/browser-runtime/send-claims','POST',claimPayload,false,auth)}
  expect(claim).toMatchObject({allowed:true,action:'SEND',dailyLimit:10})
  const duplicateClaim=await mutate('/api/browser-runtime/send-claims','POST',claimPayload,false,auth)
  expect(duplicateClaim).toMatchObject({allowed:false,action:'ALREADY_CLAIMED',claimId:claim.claimId})
  const receipt=await mutate(`/api/browser-runtime/send-claims/${claim.claimId}/receipt`,'POST',{status:'SENT',externalOutboundMessageId:`browser-outbound-${suffix}-${stamp}`},false,auth)
  expect(receipt).toMatchObject({status:'SENT',sentToday:claim.sentToday+1})
  const replayedReceipt=await mutate(`/api/browser-runtime/send-claims/${claim.claimId}/receipt`,'POST',{status:'SENT',externalOutboundMessageId:`browser-outbound-${suffix}-${stamp}`},false,auth)
  expect(replayedReceipt).toMatchObject({status:'SENT',sentToday:claim.sentToday+1})
  await page.waitForTimeout(500)
  const attempts=await get('/api/auto-replies/attempts')
  expect(attempts.some((item:any)=>item.contactId===created.candidate.id)).toBe(false)
  await mutate(`/api/auto-replies/policies/${account.id}`,'PUT',{...policy,enabled:false,autoSendEnabled:false})
  await mutate(`/api/browser-devices/${credentials.deviceId}`,'DELETE',undefined)
  const rejected=await page.evaluate(async({token})=>{const r=await fetch('/api/browser-runtime/heartbeat',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Device ${token}`},body:JSON.stringify({state:'RUNNING',reason:''})});return r.status},{token:credentials.deviceToken})
  expect(rejected).toBe(401)

  async function get(url:string){return page.evaluate(async u=>await(await fetch(u)).json(),url)}
  async function getWithHeaders(url:string,headers:Record<string,string>){return page.evaluate(async({url,headers})=>{const response=await fetch(url,{headers});if(!response.ok)throw new Error(`GET ${url}: ${response.status} ${await response.text()}`);return response.json()},{url,headers})}
  async function mutate(url:string,method:string,body?:unknown,withCsrf=true,extra:Record<string,string>={}){return page.evaluate(async({url,method,body,withCsrf,extra,csrf})=>{const headers:Record<string,string>={'Content-Type':'application/json',...extra};if(withCsrf)headers[csrf.headerName]=csrf.token;const response=await fetch(url,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});if(!response.ok)throw new Error(`${method} ${url}: ${response.status} ${await response.text()}`);const text=await response.text();return text?JSON.parse(text):null},{url,method,body,withCsrf,extra,csrf})}
})
