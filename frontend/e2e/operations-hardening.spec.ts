import { expect,test } from '@playwright/test'

test('administrator can inspect hardening state and mutation without CSRF is rejected',async({page,request},testInfo)=>{
  const username=process.env.E2E_USERNAME,password=process.env.E2E_PASSWORD
  if(!username||!password)throw new Error('E2E credentials are not configured')
  const isMobile=testInfo.project.name==='mobile-chrome'
  const traceId=`hardening-${isMobile?'mobile':'desktop'}`
  const health=await request.get('/actuator/health/readiness',{headers:{'X-Request-Id':traceId}})
  expect(health.ok()).toBeTruthy()
  expect(health.headers()['x-request-id']).toBe(traceId)
  expect(health.headers()['x-content-type-options']).toBe('nosniff')
  expect(health.headers()['x-frame-options']).toBe('DENY')

  await page.goto('/login')
  await page.getByLabel('用户名').fill(username)
  await page.getByLabel('密码').fill(password)
  await page.getByRole('button',{name:'登录',exact:true}).click()
  await expect(page.getByRole('heading',{name:'集团与企业'})).toBeVisible()
  await navigate('运行保障')
  await expect(page.getByRole('heading',{name:'运行保障'})).toBeVisible()
  await expect(page.getByText('READY',{exact:true})).toBeVisible()
  await expect(page.getByText('V8',{exact:true})).toBeVisible()
  await expect(page.getByText('只追加',{exact:true})).toBeVisible()

  const csrfResult=await page.evaluate(async()=>{
    const response=await fetch('/api/interviews',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})
    return {status:response.status,body:await response.json()}
  })
  expect(csrfResult.status).toBe(403)
  expect(csrfResult.body.code).toBe('FORBIDDEN')
  const dimensions=await page.evaluate(()=>({width:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth}))
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width)
  await page.screenshot({path:`test-results/${testInfo.project.name}-operations-hardening.png`,fullPage:false})

  async function navigate(label:string){
    if(isMobile){
      await page.getByRole('button',{name:'打开导航'}).click()
      const mobileNavigation=page.getByRole('navigation',{name:'移动端主导航'})
      await mobileNavigation.getByRole('button',{name:label}).click()
      await expect(mobileNavigation).toBeHidden()
    }
    else await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:label}).click()
  }
})
