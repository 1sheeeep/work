import { expect, test } from '@playwright/test'

test('administrator can manage a local connector BOSS account', async ({ page }, testInfo) => {
  const adminUsername = process.env.E2E_USERNAME
  const adminPassword = process.env.E2E_PASSWORD
  if (!adminUsername || !adminPassword) throw new Error('E2E credentials are not configured')

  const isMobile = testInfo.project.name === 'mobile-chrome'
  const suffix = isMobile ? 'mobile' : 'desktop'
  const companyName = `E2E BOSS 授权企业 ${suffix}`
  const companyCode = `E2E_BOSS_${suffix}`.toUpperCase()
  const accountName = `E2E BOSS 账号 ${suffix}`
  const externalIdentifier = `local-boss-${suffix}`

  await page.goto('/login?redirect=/organization')
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
    await dialog.getByLabel('备注').fill('BOSS 账号 E2E 固定企业')
    await dialog.getByRole('button', { name: '确认新增' }).click()
    await expect(page.getByText('企业已新增')).toBeVisible()
    await companySearch.fill(companyCode)
    await page.getByRole('button', { name: '查询' }).click()
  } else if (await companyContainer.getByText('已停用').count()) {
    await companyContainer.getByRole('button', { name: '启用' }).click()
    await expect(page.getByText('企业已启用')).toBeVisible()
  }

  if (isMobile) {
    await page.getByRole('button', { name: '打开导航' }).click()
    await page.getByRole('navigation', { name: '移动端主导航' }).getByRole('button', { name: 'BOSS 账号' }).click()
  } else {
    await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: 'BOSS 账号' }).click()
  }
  await expect(page.getByRole('heading', { name: 'BOSS 账号与能力' })).toBeVisible()

  const search = page.getByPlaceholder('搜索账号名称或外部标识')
  const queryAccounts = async () => {
    await Promise.all([
      page.waitForResponse((response) => {
        const url = new URL(response.url())
        return url.pathname.endsWith('/api/boss-accounts') && url.searchParams.get('keyword') === externalIdentifier
      }),
      page.getByRole('button', { name: '查询' }).click(),
    ])
  }
  await search.fill(externalIdentifier)
  await queryAccounts()
  const accountContainer = isMobile
    ? page.locator('.account-cards article', { hasText: externalIdentifier })
    : page.locator('.accounts-table .el-table__row', { hasText: externalIdentifier })

  if (await accountContainer.count() === 0) {
    await page.getByRole('button', { name: '新增 BOSS 账号' }).first().click()
    const createDialog = page.getByRole('dialog', { name: '新增 BOSS 账号' })
    await createDialog.locator('.el-form-item', { hasText: '归属企业' }).locator('.el-select').click()
    await page.getByRole('option', { name: `${companyName}（${companyCode}）` }).click()
    await createDialog.getByLabel('账号名称').fill(accountName)
    await createDialog.getByLabel('外部标识').fill(externalIdentifier)
    await createDialog.getByRole('button', { name: '确认创建' }).click()
    await expect(page.getByText('BOSS 账号已创建')).toBeVisible()
    await search.fill(externalIdentifier)
    await queryAccounts()
  }
  await expect(accountContainer).toBeVisible()
  if (await accountContainer.getByText('已停用').count()) {
    await accountContainer.getByRole('button', { name: '启用' }).click()
    await expect(page.getByText('BOSS 账号已启用')).toBeVisible()
  }

  await expect(accountContainer.getByText('本地连接器')).toBeVisible()

  const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }))
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width)
  await expect(page.locator('.el-message')).toHaveCount(0, { timeout: 10_000 })
  await page.screenshot({ path: `test-results/${testInfo.project.name}-boss-accounts.png`, fullPage: false })
  await accountContainer.screenshot({ path: `test-results/${testInfo.project.name}-boss-account.png` })

  await accountContainer.getByRole('button', { name: '停用' }).click()
  await page.getByRole('button', { name: '确认停用' }).click()
  await expect(page.getByText('BOSS 账号已停用')).toBeVisible()
})
