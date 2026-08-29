import { expect, test } from '@playwright/test'

test('HR lands on a clear recruitment overview and can open a module card', async ({ page }) => {
  const username=process.env.E2E_USERNAME,password=process.env.E2E_PASSWORD
  if(!username||!password)throw new Error('E2E credentials are not configured')
  await page.goto('/login')
  await page.getByLabel('用户名').fill(username)
  await page.getByLabel('密码').fill(password)
  await page.getByRole('button',{name:'登录',exact:true}).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByRole('heading',{name:/你好/})).toBeVisible()
  await expect(page.getByRole('heading',{name:'招聘功能'})).toBeVisible()
  await expect(page.getByText('在招职位',{exact:true})).toBeVisible()
  await page.getByRole('button',{name:/候选人工作台/}).click()
  await expect(page.getByRole('heading',{name:'候选人工作台'})).toBeVisible()
})
