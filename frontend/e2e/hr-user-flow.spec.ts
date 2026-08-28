import { expect, test } from '@playwright/test'

test('administrator can manage HR role, company scope, password and status', async ({ page }, testInfo) => {
  const adminUsername = process.env.E2E_USERNAME
  const adminPassword = process.env.E2E_PASSWORD
  if (!adminUsername || !adminPassword) throw new Error('E2E credentials are not configured')

  const isMobile = testInfo.project.name === 'mobile-chrome'
  const suffix = isMobile ? 'mobile' : 'desktop'
  const username = `e2e.${suffix}`
  const displayName = `E2E 招聘专员 ${suffix}`
  const fixturePassword = 'E2eRecruit!2026'

  await page.goto('/login')
  await page.getByLabel('用户名').fill(adminUsername)
  await page.getByLabel('密码').fill(adminPassword)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('heading', { name: '集团与企业' })).toBeVisible()

  // HR 用户流程独立维护一家固定的有效授权企业，不依赖其他测试的执行顺序。
  const scopeCompanyName = `E2E HR 授权企业 ${suffix}`
  const scopeCompanyCode = `E2E_HR_${suffix}`.toUpperCase()
  const companySearch = page.getByLabel('搜索企业')
  await companySearch.fill(scopeCompanyCode)
  await page.getByRole('button', { name: '查询' }).click()
  const scopeCompany = isMobile
    ? page.locator('.company-card', { hasText: scopeCompanyName })
    : page.locator('.el-table__row', { hasText: scopeCompanyName })
  if (await scopeCompany.count() === 0) {
    await page.getByRole('button', { name: '新增企业' }).first().click()
    const companyDialog = page.getByRole('dialog', { name: '新增企业' })
    await companyDialog.getByLabel('企业名称').fill(scopeCompanyName)
    await companyDialog.getByLabel('企业编码').fill(scopeCompanyCode)
    await companyDialog.getByLabel('备注').fill('HR 用户 E2E 固定授权企业')
    await companyDialog.getByRole('button', { name: '确认新增' }).click()
    await expect(page.getByText('企业已新增')).toBeVisible()
    await companySearch.fill(scopeCompanyCode)
    await page.getByRole('button', { name: '查询' }).click()
  } else if (await scopeCompany.getByText('已停用').count()) {
    await scopeCompany.getByRole('button', { name: '启用' }).click()
    await expect(page.getByText('企业已启用')).toBeVisible()
  }
  await expect(scopeCompany).toBeVisible()

  if (isMobile) {
    await page.getByRole('button', { name: '打开导航' }).click()
    await page.getByRole('navigation', { name: '移动端主导航' }).getByRole('button', { name: 'HR 用户' }).click()
  } else {
    await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: 'HR 用户' }).click()
  }
  await expect(page.getByRole('heading', { name: 'HR 用户与企业授权' })).toBeVisible()

  const search = page.getByPlaceholder('搜索姓名或用户名')
  const queryUsers = async () => {
    await Promise.all([
      page.waitForResponse((response) => {
        const url = new URL(response.url())
        return url.pathname.endsWith('/api/hr-users') && url.searchParams.get('keyword') === username
      }),
      page.getByRole('button', { name: '查询' }).click(),
    ])
  }
  await search.fill(username)
  await queryUsers()
  const userContainer = isMobile
    ? page.locator('.user-cards article', { hasText: username })
    : page.locator('.users-table .el-table__row', { hasText: username })

  if (await userContainer.count() === 0) {
    await page.getByRole('button', { name: '新增 HR 用户' }).first().click()
    const createDialog = page.getByRole('dialog', { name: '新增 HR 用户' })
    await createDialog.getByLabel('用户名').fill(username)
    await createDialog.getByLabel('姓名').fill(displayName)
    await createDialog.getByLabel('初始密码').fill(fixturePassword)
    await createDialog.locator('.el-form-item', { hasText: '企业授权范围' }).locator('.el-select').click()
    await page.getByRole('option', { name: `${scopeCompanyName}（${scopeCompanyCode}）` }).click()
    await page.keyboard.press('Escape')
    await createDialog.getByRole('button', { name: '确认创建' }).click()
    await expect(page.getByText('HR 用户已创建')).toBeVisible()
    await search.fill(username)
    await queryUsers()
  }
  await expect(userContainer).toBeVisible()

  if (await userContainer.getByText('已停用').count()) {
    await userContainer.getByRole('button', { name: '启用' }).click()
    await expect(page.getByText('用户已启用')).toBeVisible()
  }
  await userContainer.getByRole('button', { name: '编辑' }).click()
  const editDialog = page.getByRole('dialog', { name: '编辑 HR 用户' })
  await editDialog.locator('.el-form-item', { hasText: '角色' }).locator('.el-select').click()
  await page.getByRole('option', { name: '招聘管理员' }).click()
  await editDialog.getByRole('button', { name: '保存修改' }).click()
  await expect(page.getByText('HR 用户已更新')).toBeVisible()
  await expect(userContainer.getByText('招聘管理员')).toBeVisible()

  await userContainer.getByRole('button', { name: '重置密码' }).click()
  const passwordDialog = page.getByRole('dialog', { name: '重置密码' })
  await passwordDialog.getByPlaceholder('12-72 位新密码').fill(fixturePassword)
  await passwordDialog.getByRole('button', { name: '确认重置' }).click()
  await expect(page.getByText('密码已重置')).toBeVisible()

  // 测试结束后将固定账号停用；下次执行复用而不追加数据。
  await userContainer.getByRole('button', { name: '停用' }).click()
  await page.getByRole('button', { name: '确认停用' }).click()
  await expect(page.getByText('用户已停用')).toBeVisible()
  await expect(userContainer.getByText('已停用')).toBeVisible()
})
