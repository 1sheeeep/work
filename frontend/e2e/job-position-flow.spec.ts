import { expect, test } from '@playwright/test'

test('administrator can create, edit, activate and close job positions', async ({ page }, testInfo) => {
  const adminUsername = process.env.E2E_USERNAME
  const adminPassword = process.env.E2E_PASSWORD
  if (!adminUsername || !adminPassword) throw new Error('E2E credentials are not configured')

  const isMobile = testInfo.project.name === 'mobile-chrome'
  const suffix = isMobile ? 'mobile' : 'desktop'
  const companyName = `E2E 职位企业 ${suffix}`
  const companyCode = `E2E_JOB_${suffix}`.toUpperCase()
  const accountName = `E2E 职位账号 ${suffix}`
  const externalIdentifier = `mock-job-${suffix}`
  const activeJobTitle = `E2E Java 开发 ${suffix}`
  const closedJobTitle = `E2E 已关闭职位 ${suffix}`

  await page.goto('/login')
  await page.getByLabel('用户名').fill(adminUsername)
  await page.getByLabel('密码').fill(adminPassword)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('heading', { name: '集团与企业' })).toBeVisible()

  const companySearch = page.getByLabel('搜索企业')
  await companySearch.fill(companyCode)
  await page.getByRole('button', { name: '查询' }).click()
  const companyContainer = isMobile
    ? page.locator('.company-card', { hasText: companyName })
    : page.locator('.el-table__row', { hasText: companyName })
  if (await companyContainer.count() === 0) {
    await page.getByRole('button', { name: '新增企业' }).first().click()
    const dialog = page.getByRole('dialog', { name: '新增企业' })
    await dialog.getByLabel('企业名称').fill(companyName)
    await dialog.getByLabel('企业编码').fill(companyCode)
    await dialog.getByLabel('备注').fill('职位管理 E2E 固定企业')
    await dialog.getByRole('button', { name: '确认新增' }).click()
    await expect(page.getByText('企业已新增')).toBeVisible()
    await companySearch.fill(companyCode)
    await page.getByRole('button', { name: '查询' }).click()
  } else if (await companyContainer.getByText('已停用').count()) {
    await companyContainer.getByRole('button', { name: '启用' }).click()
    await expect(page.getByText('企业已启用')).toBeVisible()
  }

  await navigate('BOSS 账号')
  await expect(page.getByRole('heading', { name: 'BOSS 账号与能力' })).toBeVisible()
  const accountSearch = page.getByPlaceholder('搜索账号名称或外部标识')
  const queryAccounts = async () => {
    await Promise.all([
      page.waitForResponse((response) => {
        const url = new URL(response.url())
        return url.pathname.endsWith('/api/boss-accounts') && url.searchParams.get('keyword') === externalIdentifier
      }),
      page.getByRole('button', { name: '查询' }).click(),
    ])
  }
  await accountSearch.fill(externalIdentifier)
  await queryAccounts()
  const accountContainer = isMobile
    ? page.locator('.account-cards article', { hasText: externalIdentifier })
    : page.locator('.accounts-table .el-table__row', { hasText: externalIdentifier })
  if (await accountContainer.count() === 0) {
    await page.getByRole('button', { name: '新增 BOSS 账号' }).first().click()
    const dialog = page.getByRole('dialog', { name: '新增 BOSS 账号' })
    await dialog.locator('.el-form-item', { hasText: '归属企业' }).locator('.el-select').click()
    await page.getByRole('option', { name: `${companyName}（${companyCode}）` }).click()
    await dialog.getByLabel('账号名称').fill(accountName)
    await dialog.getByLabel('外部标识').fill(externalIdentifier)
    await dialog.getByRole('button', { name: '确认创建' }).click()
    await expect(page.getByText('BOSS 账号已创建')).toBeVisible()
    await accountSearch.fill(externalIdentifier)
    await queryAccounts()
  }
  if (await accountContainer.getByText('已停用').count()) {
    await accountContainer.getByRole('button', { name: '启用' }).click()
    await expect(page.getByText('BOSS 账号已启用')).toBeVisible()
  }
  await accountContainer.getByRole('button', { name: '编辑' }).click()
  const accountDialog = page.getByRole('dialog', { name: '编辑 BOSS 账号' })
  await accountDialog.locator('.el-form-item', { hasText: 'Mock 场景' }).locator('.el-select').click()
  await page.getByRole('option', { name: '完整能力' }).click()
  await accountDialog.getByRole('button', { name: '保存修改' }).click()
  await expect(page.getByText('BOSS 账号已更新')).toBeVisible()
  await accountContainer.getByRole('button', { name: '检查能力' }).click()
  await expect(page.getByText('能力检查完成：连接正常')).toBeVisible()
  await expect(accountContainer.getByText('职位同步')).toBeVisible()

  await navigate('职位管理')
  await expect(page.getByRole('heading', { name: '职位管理' })).toBeVisible()
  const jobSearch = page.getByPlaceholder('搜索职位、地点或 BOSS 账号')
  const queryJobs = async (title: string) => {
    await jobSearch.fill(title)
    await Promise.all([
      page.waitForResponse((response) => {
        const url = new URL(response.url())
        return url.pathname.endsWith('/api/job-positions') && url.searchParams.get('keyword') === title
      }),
      page.getByRole('button', { name: '查询' }).click(),
    ])
  }
  const jobContainer = (title: string) => isMobile
    ? page.locator('.job-cards article', { hasText: title })
    : page.locator('.jobs-table .el-table__row', { hasText: title })

  const createJob = async (title: string) => {
    await page.getByRole('button', { name: '新增职位' }).first().click()
    const dialog = page.getByRole('dialog', { name: '新增职位' })
    await dialog.locator('.el-form-item', { hasText: '归属企业' }).locator('.el-select').click()
    await page.getByRole('option', { name: `${companyName}（${companyCode}）` }).click()
    await dialog.locator('.el-form-item', { hasText: 'BOSS 账号' }).locator('.el-select').click()
    await page.getByRole('option', { name: `${accountName}（${externalIdentifier}）` }).click()
    await dialog.getByLabel('职位名称').fill(title)
    await dialog.getByLabel('工作地点').fill('上海·浦东')
    await dialog.getByLabel('经验要求').fill('3-5 年')
    await dialog.getByLabel('学历要求').fill('本科及以上')
    await dialog.getByLabel('职位描述（JD）').fill('负责 Java 后端服务设计、开发和稳定性建设。')
    await dialog.getByLabel('筛选要求').fill('熟悉 Spring Boot 和 PostgreSQL，具备系统设计经验。')
    await dialog.getByRole('button', { name: '创建草稿' }).click()
    await expect(page.getByText('职位草稿已创建')).toBeVisible()
  }

  await queryJobs(activeJobTitle)
  if (await jobContainer(activeJobTitle).count() === 0) {
    await createJob(activeJobTitle)
    await queryJobs(activeJobTitle)
  }
  const activeContainer = jobContainer(activeJobTitle)
  await expect(activeContainer).toBeVisible()
  if (await activeContainer.getByText('草稿', { exact: true }).count()) {
    await activeContainer.getByRole('button', { name: '编辑' }).click()
    const editDialog = page.getByRole('dialog', { name: '编辑职位' })
    await editDialog.getByLabel('职位描述（JD）').fill('负责 Java 后端服务设计、开发、测试和稳定性建设。')
    await editDialog.getByRole('button', { name: '保存修改' }).click()
    await expect(page.getByText('职位已更新')).toBeVisible()
    await activeContainer.getByRole('button', { name: '启用' }).click()
    await expect(page.getByText('职位已启用')).toBeVisible()
  }
  await queryJobs(activeJobTitle)
  await expect(activeContainer.getByText('已启用', { exact: true })).toBeVisible()

  await queryJobs(closedJobTitle)
  if (await jobContainer(closedJobTitle).count() === 0) {
    await createJob(closedJobTitle)
    await queryJobs(closedJobTitle)
  }
  const closedContainer = jobContainer(closedJobTitle)
  if (await closedContainer.getByText('草稿', { exact: true }).count()) {
    await closedContainer.getByRole('button', { name: '关闭' }).click()
    await page.getByRole('button', { name: '确认关闭' }).click()
    await expect(page.getByText('职位已关闭')).toBeVisible()
  }
  await queryJobs(closedJobTitle)
  await expect(closedContainer.getByText('已关闭', { exact: true })).toBeVisible()

  await queryJobs(activeJobTitle)
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }))
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width)
  await expect(page.locator('.el-message')).toHaveCount(0, { timeout: 10_000 })
  await page.screenshot({ path: `test-results/${testInfo.project.name}-job-positions.png`, fullPage: false })
  await jobContainer(activeJobTitle).screenshot({ path: `test-results/${testInfo.project.name}-job-position.png` })

  async function navigate(label: string) {
    if (isMobile) {
      await page.getByRole('button', { name: '打开导航' }).click()
      await page.getByRole('navigation', { name: '移动端主导航' }).getByRole('button', { name: label }).click()
    } else {
      await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: label }).click()
    }
  }
})
