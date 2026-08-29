import { expect, test } from '@playwright/test'

test('recruiter workflow can deduplicate a candidate, take over and review a message', async ({ page }, testInfo) => {
  const adminUsername = process.env.E2E_USERNAME
  const adminPassword = process.env.E2E_PASSWORD
  if (!adminUsername || !adminPassword) throw new Error('E2E credentials are not configured')
  const isMobile = testInfo.project.name === 'mobile-chrome'
  const suffix = isMobile ? 'mobile' : 'desktop'
  const companyName = `E2E 职位企业 ${suffix}`
  const jobTitle = `E2E Java 开发 ${suffix}`
  const candidateName = `E2E 候选人 ${suffix}`
  const externalCandidateId = `mock-candidate-${suffix}`
  const inboundId = `mock-inbound-${suffix}`

  await page.goto('/login?redirect=/organization')
  await page.getByLabel('用户名').fill(adminUsername)
  await page.getByLabel('密码').fill(adminPassword)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('heading', { name: '集团与企业' })).toBeVisible()
  await navigate('候选人工作台')
  await expect(page.getByRole('heading', { name: '候选人工作台' })).toBeVisible()

  const search = page.getByPlaceholder('搜索候选人、当前职位或目标职位')
  const candidateContainer = () => isMobile
    ? page.locator('.candidate-cards article', { hasText: candidateName })
    : page.locator('.candidate-row', { hasText: candidateName })
  await queryCandidates()
  if (await candidateContainer().count() === 0) {
    await page.getByRole('button', { name: '新增候选人' }).first().click()
    const dialog = page.getByRole('dialog', { name: '新增候选人' })
    await dialog.locator('.el-form-item', { hasText: '已启用职位' }).locator('.el-select').click()
    await page.getByRole('option', { name: `${jobTitle}（${companyName}）` }).click()
    await dialog.getByLabel('来源候选人 ID').fill(externalCandidateId)
    await dialog.getByLabel('候选人姓名').fill(candidateName)
    await dialog.getByLabel('当前职位').fill('Java 开发工程师')
    await dialog.getByLabel('技能摘要').fill('Spring Boot、PostgreSQL、分布式系统')
    await dialog.locator('.el-form-item', { hasText: 'AI 建议' }).locator('.el-select').click()
    await page.getByRole('option', { name: '通过', exact: true }).click()
    await dialog.getByRole('button', { name: '加入工作台' }).click()
    await expect(page.getByText('候选人已加入工作台')).toBeVisible()
  } else {
    if(isMobile)await candidateContainer().getByRole('button', { name: '打开工作台' }).click()
    else{await candidateContainer().click();await page.getByRole('button',{name:'打开完整工作台'}).click()}
  }

  const drawer = page.getByRole('dialog', { name: `${candidateName} · 候选人工作台` })
  await expect(drawer).toBeVisible()
  if (await drawer.getByRole('button', { name: '释放接管' }).count()) {
    await drawer.getByRole('button', { name: '释放接管' }).click()
    await expect(drawer.getByRole('button', { name: '人工接管' })).toBeVisible()
  }
  await drawer.getByRole('button', { name: '人工接管' }).click()
  await expect(drawer.getByRole('button', { name: '释放接管' })).toBeVisible()

  await drawer.getByRole('tab', { name: '会话与审核' }).click()
  await drawer.getByRole('button', { name: '写入 Mock 来信' }).click()
  const inboundDialog = page.getByRole('dialog', { name: '写入 Mock 候选人来信' })
  await inboundDialog.getByLabel('外部消息 ID').fill(inboundId)
  await inboundDialog.getByLabel('消息内容').fill('您好，我对这个职位有兴趣。')
  await inboundDialog.getByRole('button', { name: '幂等写入' }).click()
  await expect(page.getByText(/(候选人消息已幂等写入|该外部消息已存在)/)).toBeVisible()

  await drawer.getByRole('tab', { name: '会话与审核' }).click()
  await drawer.getByRole('button', { name: '新增外发草稿' }).click()
  const draftDialog = page.getByRole('dialog', { name: '新增外发草稿' })
  await draftDialog.getByLabel('草稿内容').fill(`您好 ${candidateName}，想与您进一步沟通职位细节。`)
  await draftDialog.getByRole('button', { name: '提交人工审核' }).click()
  await expect(page.getByText('外发草稿已进入人工审核')).toBeVisible()
  await drawer.getByRole('tab', { name: '会话与审核' }).click()
  const pendingMessage = drawer.locator('.message-list article', { hasText: `您好 ${candidateName}` }).filter({ hasText: 'PENDING_REVIEW' })
  await expect(pendingMessage).toBeVisible()
  await pendingMessage.getByRole('button', { name: '审核并发送' }).click()
  await expect(page.getByText('Mock 消息已审核并发送')).toBeVisible()
  await drawer.getByRole('tab', { name: '会话与审核' }).click()
  await expect(drawer.locator('.message-list article', { hasText: `您好 ${candidateName}` }).filter({ hasText: 'SENT' }).last()).toBeVisible()

  await drawer.getByRole('button', { name: '释放接管' }).click()
  await expect(drawer.getByRole('button', { name: '人工接管' })).toBeVisible()
  await drawer.screenshot({ path: `test-results/${testInfo.project.name}-candidate-workbench.png` })
  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()
  await queryCandidates()
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }))
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width)
  await expect(page.locator('.el-message')).toHaveCount(0, { timeout: 10_000 })
  await page.screenshot({ path: `test-results/${testInfo.project.name}-candidates.png`, fullPage: false })

  async function queryCandidates() {
    await search.fill(candidateName)
    await Promise.all([
      page.waitForResponse(response => {
        const url = new URL(response.url())
        return url.pathname.endsWith('/api/candidate-contacts') && url.searchParams.get('keyword') === candidateName
      }),
      page.getByRole('button', { name: '查询' }).click(),
    ])
  }
  async function navigate(label:string) {
    if (isMobile) {
      await page.getByRole('button', { name: '打开导航' }).click()
      await page.getByRole('navigation', { name: '移动端主导航' }).getByRole('button', { name: label }).click()
    } else await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: label }).click()
  }
})
