import { flushPromises, mount } from '@vue/test-utils'
import { api } from '../services/api'
import BossAccountsView from './BossAccountsView.vue'

vi.mock('../services/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn() },
  apiErrorMessage: (_error: unknown, fallback: string) => fallback,
  apiFieldErrors: () => ({}),
  ensureCsrf: vi.fn(),
}))
vi.mock('../stores/auth', () => ({
  authStore: { state: { user: { id: 'admin', displayName: '系统管理员', role: 'SYSTEM_ADMIN' } } },
}))

const company = { id: 'company-1', name: '内部企业', code: 'INTERNAL', status: 'ACTIVE' }

describe('BossAccountsView', () => {
  it('creates an internal account without exposing company administration', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [company] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })
    const wrapper = mount(BossAccountsView, { attachTo: document.body })
    await flushPromises()

    await wrapper.findAll('button').find(button => button.text().includes('新增账号'))?.trigger('click')
    await flushPromises()
    const dialog = wrapper.get('.el-dialog')
    await dialog.findAll('button').find(button => button.text() === '保存')?.trigger('click')
    await flushPromises()

    expect(dialog.findAll('.el-form-item.is-error')).toHaveLength(2)
    expect(dialog.text()).not.toContain('归属企业')
    wrapper.unmount()
  })

  it('shows bridge status in the list and keeps pairing guidance in a dialog', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: [{
        id: 'account-1', displayName: 'BOSS 主招聘账号', externalIdentifier: 'boss-main-01', status: 'ACTIVE',
        connectionStatus: 'CONNECTED', capabilities: [], company, gatewayType: 'LOCAL_CDP_CONNECTOR',
      }] })
      .mockResolvedValueOnce({ data: [company] })
      .mockResolvedValueOnce({ data: [{ id: 'device-1', accountId: 'account-1', status: 'ACTIVE', runtimeState: 'RUNNING', pageContext: 'CHAT', lastHeartbeatAt: '2026-08-31T08:00:00Z', lastSuccessfulSyncAt: '2026-08-31T07:59:55Z', lastSuccessfulSyncType: 'CHAT', lastSuccessfulChatSyncAt: '2026-08-31T07:59:55Z', lastPauseAt: '2026-08-31T07:55:00Z', lastPauseReason: 'BOSS 页面脚本尚未就绪', lastRecoveredAt: '2026-08-31T07:59:55Z', recoveryStatus: 'RECOLLECTED' }] })
      .mockResolvedValueOnce({ data: [{ id: 'observation-1', accountId: 'account-1', unread: true, unreadCount: 2, resolutionStatus: 'UNRESOLVED' }] })
      .mockResolvedValueOnce({ data: [{ id: 'job-1', bossAccount: { id: 'account-1' }, captureSource: 'VISIBLE_PAGE', status: 'ACTIVE' }] })
    const wrapper = mount(BossAccountsView, { attachTo: document.body })
    await flushPromises()

    expect(wrapper.text()).toContain('桥接在线')
    expect(wrapper.text()).toContain('沟通页')
    expect(wrapper.text()).toContain('恢复已确认')
    expect(wrapper.text()).toContain('最后成功同步')
    expect(wrapper.text()).toContain('BOSS 页面脚本尚未就绪')
    expect(wrapper.text()).toContain('2 条未读')
    expect(wrapper.text()).toContain('1 个同步岗位')
    expect(wrapper.text()).not.toContain('独立 Profile 登录')
    await wrapper.findAll('button').find(button => button.text().includes('查看桥接'))?.trigger('click')
    await flushPromises()

    expect(document.body.textContent).toContain('浏览器桥接')
    expect(document.body.textContent).toContain('专属的 Chrome Profile')
    expect(document.body.textContent).toContain('生成一次性连接码')
    wrapper.unmount()
  })
})
