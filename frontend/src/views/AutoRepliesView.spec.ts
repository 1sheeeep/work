import { flushPromises, mount } from '@vue/test-utils'
import { api } from '../services/api'
import AutoRepliesView from './AutoRepliesView.vue'

vi.mock('../services/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  apiErrorMessage: (_error: unknown, fallback: string) => fallback,
  ensureCsrf: vi.fn(),
}))
vi.mock('../stores/auth', () => ({
  authStore: { state: { user: { id: 'admin', username: 'admin', displayName: '系统管理员', role: 'SYSTEM_ADMIN' } } },
}))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))

describe('AutoRepliesView', () => {
  it('groups unmatched conversations into a guarded job matching workbench', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => Promise.resolve({ data: url.endsWith('/unmatched-job-groups') ? [{
      groupKey: 'group-1', accountId: 'account-1', accountName: 'BOSS 主招聘账号', companyName: '新知科技集团',
      observedTitle: '跨境电商运营助理+无责4K', observationIds: ['observation-1', 'observation-2'], conversations: 2,
      unreadCount: 3, firstSeenAt: '2026-08-30T10:00:00Z', lastSeenAt: '2026-08-30T11:00:00Z',
      candidates: [{ id: 'job-1', title: '跨境电商运营助理', knowledgeReady: true, blockers: [] }],
    }] : [] }))

    const wrapper = mount(AutoRepliesView)
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text().includes('待审草稿'))?.trigger('click')

    expect(wrapper.text()).toContain('未匹配岗位批量处理')
    expect(wrapper.text()).toContain('跨境电商运营助理+无责4K')
    expect(wrapper.text()).toContain('2 个匿名会话 · 3 条未读')
    expect(wrapper.text()).toContain('核对并批量关联')
    wrapper.unmount()
  })
})
