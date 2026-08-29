import { expect, test } from '@playwright/test'

test('administrator can create, edit, deactivate and revisit a company', async ({ page }, testInfo) => {
  const username = process.env.E2E_USERNAME
  const password = process.env.E2E_PASSWORD
  if (!username || !password) throw new Error('E2E credentials are not configured')

  // 每个端口复用一个固定测试企业，避免每次 E2E 都向数据库追加时间戳数据。
  const suffix = testInfo.project.name === 'mobile-chrome' ? 'MOBILE' : 'DESKTOP'
  const companyName = `浏览器验证企业${suffix}`
  const companyCode = `UI_${suffix}`.toUpperCase().slice(0, 32)

  await page.goto('/login?redirect=/organization')
  await page.getByLabel('用户名').fill(username)
  await page.getByLabel('密码').fill(password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('heading', { name: '集团与企业' })).toBeVisible()

  const search = page.getByLabel('搜索企业')
  await search.fill(companyCode)
  await page.getByRole('button', { name: '查询' }).click()

  const isMobile = testInfo.project.name === 'mobile-chrome'
  const companyContainer = isMobile
    ? page.locator('.company-card', { hasText: companyName })
    : page.locator('.el-table__row', { hasText: companyName })
  if (await companyContainer.count() === 0) {
    await page.getByRole('button', { name: '新增企业' }).first().click()
    const dialog = page.getByRole('dialog', { name: '新增企业' })
    await dialog.getByLabel('企业名称').fill(companyName)
    await dialog.getByLabel('企业编码').fill(companyCode)
    await dialog.getByLabel('所在地').fill('上海市静安区')
    await dialog.getByLabel('备注').fill('桌面与移动端真实流程验证')
    await dialog.getByRole('button', { name: '确认新增' }).click()
    await expect(page.getByText('企业已新增')).toBeVisible()
    await search.fill(companyCode)
    await page.getByRole('button', { name: '查询' }).click()
  } else if (await companyContainer.getByText('已停用').count()) {
    await companyContainer.getByRole('button', { name: '启用' }).click()
    await expect(page.getByText('企业已启用')).toBeVisible()
  }
  await expect(companyContainer).toBeVisible()
  await companyContainer.getByRole('button', { name: '编辑' }).click()
  const editDialog = page.getByRole('dialog', { name: '编辑企业' })
  await editDialog.getByLabel('所在地').fill('上海市徐汇区')
  await editDialog.getByRole('button', { name: '保存修改' }).click()
  await expect(page.getByText('企业资料已更新')).toBeVisible()

  await companyContainer.getByRole('button', { name: '停用' }).click()
  await page.getByRole('button', { name: '确认停用' }).click()
  await expect(page.getByText('企业已停用')).toBeVisible()
  await expect(companyContainer.getByText('已停用')).toBeVisible()

  await page.reload()
  await page.getByLabel('搜索企业').fill(companyCode)
  await page.getByRole('button', { name: '查询' }).click()
  await expect(companyContainer).toBeVisible()
  await expect(companyContainer.getByText('已停用')).toBeVisible()

  const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }))
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: `test-results/${testInfo.project.name}-organization-top.png`, fullPage: false })
  await companyContainer.screenshot({ path: `test-results/${testInfo.project.name}-company.png` })

  if (isMobile) {
    await page.getByRole('button', { name: '打开导航' }).click()
    await page.getByRole('navigation', { name: '移动端主导航' }).getByRole('button', { name: '操作日志' }).click()
  } else {
    await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '操作日志' }).click()
  }
  await expect(page.getByRole('heading', { name: '操作日志' })).toBeVisible()
  const auditContainer = isMobile
    ? page.locator('.audit-cards article', { hasText: companyName }).first()
    : page.locator('.audit-table .el-table__row', { hasText: companyName }).first()
  await expect(auditContainer).toBeVisible()

  await page.getByRole('button', { name: '退出' }).click()
  await expect(page.getByRole('heading', { name: '登录招聘控制台' })).toBeVisible()
})
