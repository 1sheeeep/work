import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import AppLayout from './AppLayout.vue'

const authState = vi.hoisted(() => ({
  user: {
    id: 'admin',
    displayName: '系统管理员',
    role: 'SYSTEM_ADMIN',
  } as { id: string; displayName: string; role: string } | null,
}))

vi.mock('../stores/auth', () => ({
  authStore: {
    state: authState,
    logout: vi.fn(),
  },
}))

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/dashboard', component: { template: '<div>dashboard</div>' } },
      { path: '/boss-accounts', component: { template: '<div>accounts</div>' } },
      { path: '/job-positions', component: { template: '<div>jobs</div>' } },
      { path: '/resume-intakes', component: { template: '<div>resumes</div>' } },
      { path: '/system-logs', component: { template: '<div>logs</div>' } },
      { path: '/login', component: { template: '<div>login</div>' } },
    ],
  })
}

async function mountLayout(role: string) {
  authState.user = { id: role, displayName: role, role }
  const router = createTestRouter()
  await router.push('/dashboard')
  await router.isReady()
  return mount(AppLayout, { global: { plugins: [router] } })
}

function navigationLabels(wrapper: ReturnType<typeof mount>) {
  return wrapper.get('nav[aria-label="主导航"]').findAll('button').map(button => button.text())
}

describe('AppLayout navigation contract', () => {
  it('shows the five current entries to a system administrator', async () => {
    const wrapper = await mountLayout('SYSTEM_ADMIN')

    expect(navigationLabels(wrapper)).toEqual([
      '今日值守',
      '招聘账号',
      '岗位资料',
      '简历分析',
      '项目运行日志',
    ])
    wrapper.unmount()
  })

  it('keeps system logs out of the four-entry recruiter navigation', async () => {
    const wrapper = await mountLayout('RECRUITMENT_ADMIN')

    expect(navigationLabels(wrapper)).toEqual([
      '今日值守',
      '招聘账号',
      '岗位资料',
      '简历分析',
    ])
    wrapper.unmount()
  })
})
