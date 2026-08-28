import { expect, test } from '@playwright/test'

test('administrator can configure, run and retry an automatic recruitment task', async ({ page }, testInfo) => {
  test.setTimeout(60_000)
  const adminUsername = process.env.E2E_USERNAME
  const adminPassword = process.env.E2E_PASSWORD
  if (!adminUsername || !adminPassword) throw new Error('E2E credentials are not configured')

  const isMobile = testInfo.project.name === 'mobile-chrome'
  const suffix = isMobile ? 'mobile' : 'desktop'
  const companyName = `E2E 职位企业 ${suffix}`
  const jobTitle = `E2E Java 开发 ${suffix}`
  const taskName = `E2E 自动招聘任务 ${suffix}`

  await page.goto('/login')
  await page.getByLabel('用户名').fill(adminUsername)
  await page.getByLabel('密码').fill(adminPassword)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('heading', { name: '集团与企业' })).toBeVisible()
  await navigate('招聘任务')
  await expect(page.getByRole('heading', { name: '自动招聘任务' })).toBeVisible()

  const search = page.getByPlaceholder('搜索任务、职位或 BOSS 账号')
  const taskContainer = () => isMobile
    ? page.locator('.task-cards article', { hasText: taskName })
    : page.locator('.tasks-table .el-table__row', { hasText: taskName })

  await queryTasks()
  if (await taskContainer().count() === 0) {
    await page.getByRole('button', { name: '新增任务' }).first().click()
    const dialog = page.getByRole('dialog', { name: '新增招聘任务' })
    await dialog.locator('.el-form-item', { hasText: '已启用职位' }).locator('.el-select').click()
    await page.getByRole('option', { name: `${jobTitle}（${companyName}）` }).click()
    await dialog.getByLabel('任务名称').fill(taskName)
    await dialog.locator('.el-form-item', { hasText: 'Mock 执行结果' }).locator('.el-select').click()
    await page.getByRole('option', { name: '失败', exact: true }).click()
    await dialog.getByLabel('每日配额').fill('500')
    await dialog.getByRole('button', { name: '创建草稿' }).click()
    await expect(page.getByText('任务草稿已创建')).toBeVisible()
    await queryTasks()
  }

  await expect(taskContainer()).toBeVisible()
  await normalizeToRunningWithFailure()

  await taskContainer().getByRole('button', { name: '执行一轮' }).click()
  await expect(taskContainer().getByText('失败', { exact: true })).toBeVisible()
  await editOutcome('成功')
  await taskContainer().getByRole('button', { name: '重试' }).click()
  await expect(page.getByText('Mock 执行成功，处理 5 项')).toBeVisible()
  await expect(taskContainer().getByText('运行中', { exact: true })).toBeVisible()

  await taskContainer().getByRole('button', { name: '记录' }).click()
  const drawer = page.getByRole('dialog', { name: `${taskName} · 执行记录` })
  await expect(drawer.getByText('失败', { exact: true }).first()).toBeVisible()
  await expect(drawer.getByText('成功', { exact: true }).first()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()

  await taskContainer().getByRole('button', { name: '暂停' }).click()
  await expect(taskContainer().getByText('已暂停', { exact: true })).toBeVisible()
  const beforeScheduledRun = await fetchTask()
  await taskContainer().getByRole('button', { name: '恢复' }).click()
  await expect.poll(async () => (await fetchTask()).processedToday, { timeout: 25_000, intervals: [1_000] })
    .toBeGreaterThan(beforeScheduledRun.processedToday)
  const afterScheduledRun = await fetchTask()
  expect(afterScheduledRun.lastSchedulerOwner).toBeTruthy()
  expect(afterScheduledRun.nextRunAt).toBeTruthy()
  await queryTasks()
  await taskContainer().getByRole('button', { name: '暂停' }).click()
  await expect(taskContainer().getByText('已暂停', { exact: true })).toBeVisible()
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }))
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width)
  await expect(page.locator('.el-message')).toHaveCount(0, { timeout: 10_000 })
  await page.screenshot({ path: `test-results/${testInfo.project.name}-recruitment-tasks.png`, fullPage: false })
  await taskContainer().screenshot({ path: `test-results/${testInfo.project.name}-recruitment-task.png` })

  async function queryTasks() {
    await search.fill(taskName)
    await Promise.all([
      page.waitForResponse((response) => {
        const url = new URL(response.url())
        return url.pathname.endsWith('/api/recruitment-tasks') && url.searchParams.get('keyword') === taskName
      }),
      page.getByRole('button', { name: '查询' }).click(),
    ])
  }

  async function fetchTask() {
    return page.evaluate(async (name) => {
      const response = await fetch(`/api/recruitment-tasks?keyword=${encodeURIComponent(name)}`)
      if (!response.ok) throw new Error(`任务读取失败：${response.status}`)
      const tasks = await response.json()
      return tasks.find((task: { name: string }) => task.name === name)
    }, taskName)
  }

  async function editOutcome(option: '成功' | '失败') {
    await taskContainer().getByRole('button', { name: '编辑' }).click()
    const dialog = page.getByRole('dialog', { name: '编辑招聘任务' })
    await dialog.locator('.el-form-item', { hasText: 'Mock 执行结果' }).locator('.el-select').click()
    await page.getByRole('option', { name: option, exact: true }).click()
    await dialog.getByRole('button', { name: '保存修改' }).click()
    await expect(page.getByText('任务已更新')).toBeVisible()
  }

  async function normalizeToRunningWithFailure() {
    const container = taskContainer()
    if (await container.getByText('草稿', { exact: true }).count()) {
      await editOutcome('失败')
      await container.getByRole('button', { name: '就绪' }).click()
      await expect(container.getByText('待启动', { exact: true })).toBeVisible()
      await container.getByRole('button', { name: '启动' }).click()
    } else if (await container.getByText('待启动', { exact: true }).count()) {
      await container.getByRole('button', { name: '启动' }).click()
      await expect(container.getByText('运行中', { exact: true })).toBeVisible()
      await container.getByRole('button', { name: '暂停' }).click()
      await expect(container.getByText('已暂停', { exact: true })).toBeVisible()
      await editOutcome('失败')
      await container.getByRole('button', { name: '恢复' }).click()
    } else if (await container.getByText('运行中', { exact: true }).count()) {
      await container.getByRole('button', { name: '暂停' }).click()
      await expect(container.getByText('已暂停', { exact: true })).toBeVisible()
      await editOutcome('失败')
      await container.getByRole('button', { name: '恢复' }).click()
    } else if (await container.getByText('已暂停', { exact: true }).count()) {
      await editOutcome('失败')
      await container.getByRole('button', { name: '恢复' }).click()
    } else if (await container.getByText('失败', { exact: true }).count() || await container.getByText('需人工介入', { exact: true }).count()) {
      await editOutcome('成功')
      await container.getByRole('button', { name: '重试' }).click()
      await expect(container.getByText('运行中', { exact: true })).toBeVisible()
      await container.getByRole('button', { name: '暂停' }).click()
      await expect(container.getByText('已暂停', { exact: true })).toBeVisible()
      await editOutcome('失败')
      await container.getByRole('button', { name: '恢复' }).click()
    } else {
      throw new Error('固定 E2E 任务已完成，请更换任务名称')
    }
    await expect(container.getByText('运行中', { exact: true })).toBeVisible()
  }

  async function navigate(label: string) {
    if (isMobile) {
      await page.getByRole('button', { name: '打开导航' }).click()
      await page.getByRole('navigation', { name: '移动端主导航' }).getByRole('button', { name: label }).click()
    } else {
      await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: label }).click()
    }
  }
})
