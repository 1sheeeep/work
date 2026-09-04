import { expect, type Page, test } from '@playwright/test'

const currentPages = [
  { path: '/dashboard', navigation: '今日值守', heading: '今天的招聘工作' },
  { path: '/boss-accounts', navigation: '招聘账号', heading: '多账号运营中心' },
  { path: '/job-positions', navigation: '岗位资料', heading: '岗位资料 · 运营面板' },
  { path: '/resume-intakes', navigation: '简历分析', heading: '候选人决策面板' },
  { path: '/system-logs', navigation: '项目运行日志', heading: '项目运行日志' },
] as const

const legacyRedirects = [
  { from: '/organization', to: '/job-positions', heading: '岗位资料 · 运营面板' },
  { from: '/candidates', to: '/dashboard', heading: '今天的招聘工作' },
  { from: '/auto-replies', to: '/dashboard', heading: '今天的招聘工作' },
  { from: '/hr-users', to: '/dashboard', heading: '今天的招聘工作' },
  { from: '/ai-settings', to: '/resume-intakes', heading: '候选人决策面板' },
  { from: '/audit-logs', to: '/system-logs', heading: '项目运行日志' },
  { from: '/operations', to: '/system-logs', heading: '项目运行日志' },
] as const

async function login(page: Page, redirect = '/dashboard') {
  const username = process.env.E2E_USERNAME
  const password = process.env.E2E_PASSWORD
  if (!username || !password) throw new Error('E2E credentials are not configured')

  await page.goto(`/login?redirect=${encodeURIComponent(redirect)}`)
  await page.getByLabel('用户名').fill(username)
  await page.getByLabel('密码').fill(password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`${redirect.replace('/', '\\/')}$`))
}

async function openNavigation(page: Page, label: string, mobile: boolean) {
  if (mobile) {
    await page.getByRole('button', { name: '打开导航' }).click()
    const navigation = page.getByRole('navigation', { name: '移动端主导航' })
    await navigation.getByRole('button', { name: label, exact: true }).click()
    await expect(navigation).toBeHidden()
    return
  }
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: label, exact: true }).click()
}

test('登录后五个收敛页面都可从主导航到达', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile-chrome'
  await login(page)

  for (const destination of currentPages) {
    if (destination.path !== '/dashboard') await openNavigation(page, destination.navigation, mobile)
    await expect(page).toHaveURL(new RegExp(`${destination.path.replace('/', '\\/')}$`))
    await expect(page.getByRole('heading', { name: destination.heading, exact: true, level: 1 })).toBeVisible()
  }

  const viewport = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.width)
})

test('已删除模块的旧 URL 只转到当前业务入口', async ({ page }) => {
  await login(page)

  for (const redirect of legacyRedirects) {
    await page.goto(redirect.from)
    await expect(page).toHaveURL(new RegExp(`${redirect.to.replace('/', '\\/')}$`))
    await expect(page.getByRole('heading', { name: redirect.heading, exact: true, level: 1 })).toBeVisible()
  }
})

test('关键页面在 320、760、900 像素宽度下没有页面级横向溢出', async ({ page }) => {
  await login(page)

  for (const width of [320, 760, 900]) {
    await page.setViewportSize({ width, height: 900 })
    for (const destination of currentPages) {
      await page.goto(destination.path)
      await expect(page.getByRole('heading', { name: destination.heading, exact: true, level: 1 })).toBeVisible()
      const viewport = await page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }))
      expect(viewport.scrollWidth, `${destination.path} 在 ${width}px 下出现页面级横向溢出`).toBeLessThanOrEqual(viewport.width)
    }
  }
})
