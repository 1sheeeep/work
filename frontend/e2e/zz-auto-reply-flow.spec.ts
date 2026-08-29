import { expect, test } from '@playwright/test'

test('multi-account policy automatically replies to an overdue unanswered candidate message', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const username = process.env.E2E_USERNAME, password = process.env.E2E_PASSWORD
  if (!username || !password) throw new Error('E2E credentials are not configured')
  const isMobile = testInfo.project.name === 'mobile-chrome'
  const suffix = isMobile ? 'mobile' : 'desktop'
  const accountName = `E2E 职位账号 ${suffix}`
  const startedAt = Date.now()
  const candidateName = `E2E 自动回复候选人 ${suffix} ${startedAt}`

  await page.goto('/login?redirect=/organization')
  await page.getByLabel('用户名').fill(username)
  await page.getByLabel('密码').fill(password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('heading', { name: '集团与企业' })).toBeVisible()

  const csrf = await page.evaluate(async () => (await fetch('/api/auth/csrf')).json())
  const accounts = await page.evaluate(async () => (await fetch('/api/boss-accounts')).json())
  const account = accounts.find((item: { displayName: string }) => item.displayName === accountName)
  expect(account).toBeTruthy()
  const policy = { enabled: true, autoSendEnabled: true, responseTimeoutMinutes: 5,
    dailyLimit: isMobile ? 9 : 7, minimumIntervalSeconds: 30, sendingWindowStart: '00:00:00', sendingWindowEnd: '23:59:59',
    timezone: 'Asia/Shanghai', maxConsecutiveFailures: 3,
    replyTemplate: '您好，已收到您关于「{jobTitle}」的消息，招聘团队会尽快处理。' }
  const savedPolicy = await mutate(`/api/auto-replies/policies/${account.id}`, 'PUT', policy)

  const jobs = await page.evaluate(async () => (await fetch('/api/job-positions')).json())
  const job = jobs.find((item: { bossAccount: { id: string }, status: string }) => item.bossAccount.id === account.id && item.status === 'ACTIVE')
  expect(job).toBeTruthy()
  const created = await mutate('/api/candidate-contacts', 'POST', {
    jobPositionId: job.id, source: 'BOSS_MOCK', externalCandidateId: `auto-reply-${suffix}-${startedAt}`,
    displayName: candidateName, currentTitle: 'Java 开发工程师', yearsExperience: 3, education: '本科',
    skillsSummary: 'Spring Boot、PostgreSQL', hardRuleOutcome: 'PASS', hardRuleRationale: '符合硬性要求',
    aiOutcome: 'PASS', aiRationale: '自动回复端到端验证', modelVersion: 'mock-v1', promptVersion: 'e2e-v1',
  })
  const contact = created.candidate
  const inbound = await mutate(`/api/candidate-contacts/${contact.id}/messages/inbound`, 'POST', {
    externalMessageId: `auto-follow-up-${suffix}-${startedAt}`,
    content: '您好，请问这个职位目前还在招聘吗？',
    receivedAt: new Date(Date.now() - 6 * 60_000).toISOString(),
  })

  await expect.poll(async () => {
    const detail = await page.evaluate(async (id) => (await fetch(`/api/candidate-contacts/${id}`)).json(), contact.id)
    return detail.messages.find((message: { externalMessageId: string }) => message.externalMessageId === `auto-reply:${inbound.message.id}`)?.deliveryStatus
  }, { timeout: 40_000, intervals: [1_000] }).toBe('SENT')

  const blockedName = `E2E 人工接管候选人 ${suffix} ${startedAt}`
  const blocked = await mutate('/api/candidate-contacts', 'POST', {
    jobPositionId: job.id, source: 'BOSS_MOCK', externalCandidateId: `auto-reply-takeover-${suffix}-${startedAt}`,
    displayName: blockedName, currentTitle: 'Java 开发工程师', yearsExperience: 3, education: '本科',
    skillsSummary: 'Spring Boot、PostgreSQL', hardRuleOutcome: 'PASS', hardRuleRationale: '符合硬性要求',
    aiOutcome: 'PASS', aiRationale: '人工接管防护验证', modelVersion: 'mock-v1', promptVersion: 'e2e-v1',
  })
  await mutate(`/api/candidate-contacts/${blocked.candidate.id}/takeover`, 'POST')
  const blockedInbound = await mutate(`/api/candidate-contacts/${blocked.candidate.id}/messages/inbound`, 'POST', {
    externalMessageId: `auto-follow-up-takeover-${suffix}-${startedAt}`, content: '这条消息必须由人工处理。',
    receivedAt: new Date(Date.now() - 6 * 60_000).toISOString(),
  })
  await page.waitForTimeout(16_500)
  const blockedDetail = await page.evaluate(async (id) => (await fetch(`/api/candidate-contacts/${id}`)).json(), blocked.candidate.id)
  expect(blockedDetail.messages.some((message: { externalMessageId: string }) => message.externalMessageId === `auto-reply:${blockedInbound.message.id}`)).toBe(false)

  await navigate('自动跟进')
  await expect(page.getByRole('heading', { name: '多账号自动跟进' })).toBeVisible()
  const accountCard = page.locator('.account-grid article', { hasText: accountName })
  await expect(accountCard).toContainText('已启用')
  await expect(accountCard).toContainText('自动发送')
  await expect(accountCard).toContainText(`${savedPolicy.sentToday + 1} / ${policy.dailyLimit}`)
  await expect(page.locator('.attempts-panel')).toContainText(candidateName)
  await expect(page.locator('.attempts-panel')).toContainText('已发送')
  await expect(page.locator('.attempts-panel')).not.toContainText(blockedName)

  await mutate(`/api/auto-replies/policies/${account.id}`, 'PUT', { ...policy, enabled: false, autoSendEnabled: false })

  async function mutate(url: string, method: string, body?: unknown) {
    return page.evaluate(async ({ url, method, body, headerName, token }) => {
      const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json', [headerName]: token }, body: body === undefined ? undefined : JSON.stringify(body) })
      if (!response.ok) throw new Error(`${method} ${url} failed: ${response.status} ${await response.text()}`)
      const text = await response.text(); return text ? JSON.parse(text) : null
    }, { url, method, body, headerName: csrf.headerName, token: csrf.token })
  }
  async function navigate(label: string) {
    if (isMobile) { await page.getByRole('button', { name: '打开导航' }).click(); await page.getByRole('navigation', { name: '移动端主导航' }).getByRole('button', { name: label }).click() }
    else await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: label }).click()
  }
})
