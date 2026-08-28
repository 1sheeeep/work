import { expect, test } from '@playwright/test'

test('recruiter can confirm an interview and idempotently retry the HR notification', async ({ page }, testInfo) => {
  const adminUsername = process.env.E2E_USERNAME
  const adminPassword = process.env.E2E_PASSWORD
  if (!adminUsername || !adminPassword) throw new Error('E2E credentials are not configured')
  const isMobile = testInfo.project.name === 'mobile-chrome'
  const suffix = isMobile ? 'mobile' : 'desktop'
  const companyName = `E2E 职位企业 ${suffix}`
  const jobTitle = `E2E Java 开发 ${suffix}`
  const candidateName = `E2E 候选人 ${suffix}`

  await page.goto('/login')
  await page.getByLabel('用户名').fill(adminUsername)
  await page.getByLabel('密码').fill(adminPassword)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('heading', { name: '集团与企业' })).toBeVisible()
  await navigate('面试协调')
  await expect(page.getByRole('heading', { name: '面试协调' })).toBeVisible()

  const search = page.getByPlaceholder('搜索候选人、职位或负责 HR')
  const scheduleContainer = () => isMobile
    ? page.locator('.interview-cards article', { hasText: candidateName })
    : page.locator('.interviews-table .el-table__row', { hasText: candidateName })
  await querySchedules()
  if (await scheduleContainer().count() === 0) {
    await page.getByRole('button', { name: '安排面试' }).first().click()
    const createDialog = page.getByRole('dialog', { name: '安排面试' })
    await createDialog.locator('.el-form-item', { hasText: '候选人 / 职位' }).locator('.el-select').click()
    await page.getByRole('option', { name: `${candidateName} · ${jobTitle}（${companyName}）` }).click()
    await selectMockOutcome(createDialog, '失败')
    await fillSlots(createDialog)
    await createDialog.getByRole('button', { name: '创建面试安排' }).click()
    await expect(page.getByText('面试候选时间已创建')).toBeVisible()
  } else {
    await scheduleContainer().getByRole('button', { name: isMobile ? '打开协调台' : '协调' }).click()
  }

  const drawer = page.getByRole('dialog', { name: `${candidateName} · 面试协调台` })
  await expect(drawer).toBeVisible()
  const summary = drawer.locator('.schedule-summary')
  if (await summary.getByText('已确认', { exact: true }).count() || await summary.getByText('需重新约定', { exact: true }).count()) {
    await summary.getByRole('button', { name: '重新约定' }).click()
    const rescheduleDialog = page.getByRole('dialog', { name: '重新约定面试' })
    await fillSlots(rescheduleDialog)
    await rescheduleDialog.getByRole('button', { name: '发出新一轮时间' }).click()
    await expect(page.getByText('新一轮候选时间已发出')).toBeVisible()
  }
  await expect(summary.getByText('待候选人确认', { exact: true })).toBeVisible()

  await drawer.getByRole('tab', { name: 'HR 通知' }).click()
  await selectMockOutcome(drawer.locator('.mock-config'), '失败')
  await drawer.getByRole('button', { name: '保存 Mock 结果' }).click()
  await expect(page.getByText('Mock 通知结果已更新')).toBeVisible()
  await drawer.getByRole('tab', { name: '候选时间' }).click()
  await drawer.getByRole('button', { name: '候选人确认此时间' }).first().click()
  await expect(page.getByText('面试已确认，但 HR 通知失败')).toBeVisible()
  await expect(summary.getByText('已确认', { exact: true })).toBeVisible()

  await drawer.getByRole('tab', { name: 'HR 通知' }).click()
  const failedNotification = drawer.locator('.notification-list article', { hasText: 'FAILED' }).first()
  await expect(failedNotification).toBeVisible()
  await selectMockOutcome(drawer.locator('.mock-config'), '成功')
  await drawer.getByRole('button', { name: '保存 Mock 结果' }).click()
  await expect(page.getByText('Mock 通知结果已更新')).toBeVisible()
  await drawer.getByRole('tab', { name: 'HR 通知' }).click()
  const retryButton = drawer.locator('.notification-list article', { hasText: 'FAILED' }).first().getByRole('button', { name: '重试通知' })
  await expect(retryButton).toBeEnabled()
  await retryButton.click()
  await expect(page.getByText('HR 通知重试成功')).toBeVisible()
  await drawer.getByRole('tab', { name: 'HR 通知' }).click()
  await expect(drawer.locator('.notification-list article', { hasText: 'SENT' }).first()).toBeVisible()

  await drawer.screenshot({ path: `test-results/${testInfo.project.name}-interview-coordination.png` })
  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()
  await querySchedules()
  await expect(scheduleContainer().getByText('已确认', { exact: true })).toBeVisible()
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }))
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width)
  await expect(page.locator('.el-message')).toHaveCount(0, { timeout: 10_000 })
  await page.screenshot({ path: `test-results/${testInfo.project.name}-interviews.png`, fullPage: false })

  async function querySchedules() {
    await search.fill(candidateName)
    await Promise.all([
      page.waitForResponse(response => {
        const url = new URL(response.url())
        return url.pathname.endsWith('/api/interviews') && url.searchParams.get('keyword') === candidateName
      }),
      page.getByRole('button', { name: '查询' }).click(),
    ])
  }

  async function selectMockOutcome(container: ReturnType<typeof page.locator>, option: '成功' | '失败') {
    await container.locator('.el-select').last().click()
    await page.getByRole('option', { name: option === '成功' ? /^(Mock )?成功$/ : /^(Mock )?失败$/ }).click()
  }

  async function fillSlots(dialog: ReturnType<typeof page.getByRole>) {
    const first = new Date()
    first.setDate(first.getDate() + 4)
    first.setHours(isMobile ? 14 : 9, 0, 0, 0)
    const second = new Date(first)
    second.setDate(second.getDate() + 1)
    const localValue = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
    await dialog.getByLabel('候选时间 1 开始').fill(localValue(first))
    await dialog.getByLabel('候选时间 1 结束').fill(localValue(new Date(first.getTime() + 60 * 60 * 1000)))
    await dialog.getByLabel('候选时间 2 开始').fill(localValue(second))
    await dialog.getByLabel('候选时间 2 结束').fill(localValue(new Date(second.getTime() + 60 * 60 * 1000)))
  }

  async function navigate(label: string) {
    if (isMobile) {
      await page.getByRole('button', { name: '打开导航' }).click()
      await page.getByRole('navigation', { name: '移动端主导航' }).getByRole('button', { name: label }).click()
    } else await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: label }).click()
  }
})
