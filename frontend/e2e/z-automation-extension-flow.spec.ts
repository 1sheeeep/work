import { expect, test } from '@playwright/test'

test('administrator can import candidates, use AI assistance and send a signed HR trial notification', async ({ page, request }, testInfo) => {
  test.setTimeout(90_000)
  const username = process.env.E2E_USERNAME
  const password = process.env.E2E_PASSWORD
  if (!username || !password) throw new Error('E2E credentials are not configured')
  const isMobile = testInfo.project.name === 'mobile-chrome'
  const suffix = isMobile ? 'mobile' : 'desktop'
  const runId = Date.now()
  const importedName = `E2E 导入候选人 ${suffix} ${runId}`
  const externalId = `import-${suffix}-${runId}`

  await page.goto('/login')
  await page.getByLabel('用户名').fill(username)
  await page.getByLabel('密码').fill(password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('heading', { name: '集团与企业' })).toBeVisible()

  await navigate('批量导入')
  await expect(page.getByRole('heading', { name: '候选人批量导入' })).toBeVisible()
  await page.locator('input[type="file"]').setInputFiles({
    name: `candidates-${suffix}.csv`,
    mimeType: 'text/csv',
    buffer: Buffer.from([
      'externalCandidateId,displayName,currentTitle,yearsExperience,education,skillsSummary',
      `${externalId},${importedName},Java开发工程师,5,本科,"Java,Spring Boot,PostgreSQL"`,
      `${externalId},重复候选人,Java开发工程师,4,本科,Java`,
      `missing-name-${suffix},,测试工程师,2,本科,测试`,
    ].join('\n')),
  })
  await page.getByRole('button', { name: '解析并预览' }).click()
  await expect(page.getByText('文件解析完成，请确认预览结果')).toBeVisible()
  const metrics = page.locator('.import-metrics')
  await expect(metrics).toContainText('3')
  await expect(metrics).toContainText('1')
  await expect(page.getByText('文件内外部候选人 ID 重复')).toBeVisible()
  await expect(page.getByText('外部候选人 ID 和姓名为必填项')).toBeVisible()
  await page.getByRole('button', { name: '确认导入 1 行' }).click()
  await expect(page.getByText('已导入 1 个候选人')).toBeVisible()

  await navigate('AI 辅助')
  await expect(page.getByRole('heading', { name: 'AI 招聘辅助' })).toBeVisible()
  await page.getByRole('button', { name: '生成解析建议' }).click()
  await expect(page.getByText('AI 职位解析建议已生成')).toBeVisible()
  await expect(page.locator('.result-grid')).toContainText('Java')
  const candidateSelect = page.locator('.ai-grid section').nth(1).locator('.el-select')
  await candidateSelect.click()
  await page.getByRole('option', { name: new RegExp(importedName) }).click()
  await page.getByRole('button', { name: '生成筛选建议' }).click()
  await expect(page.getByText('AI 筛选建议已写入候选人时间线')).toBeVisible()
  await expect(page.locator('.screen-result')).toContainText('MOCK')

  await navigate('运行保障')
  await expect(page.getByText('V15', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'HR 通知渠道' })).toBeVisible()
  await page.getByRole('button', { name: '发送 HR 试运行通知' }).click()
  await expect(page.getByText('试运行通知已送达')).toBeVisible()
  const events = await request.get('http://127.0.0.1:8090/events')
  expect(events.ok()).toBeTruthy()
  const body = await events.json()
  expect(body.count).toBeGreaterThan(0)
  expect(body.events.at(-1).payload.candidateReference).toBe('trial-reference')
  expect(body.events.at(-1).payload).not.toHaveProperty('candidateName')

  async function navigate(label: string) {
    if (isMobile) {
      await page.getByRole('button', { name: '打开导航' }).click()
      await page.getByRole('navigation', { name: '移动端主导航' }).getByRole('button', { name: label }).click()
    } else {
      await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: label }).click()
    }
  }
})
