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
  authStore: { state: { user: { id: 'admin', username: 'admin', displayName: '系统管理员', role: 'SYSTEM_ADMIN' } } },
}))

describe('BossAccountsView', () => {
  it('requires company, display name and external identifier before creating an account', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })
    const wrapper = mount(BossAccountsView, { attachTo: document.body })
    await flushPromises()

    await wrapper.findAll('button').find((button) => button.text().includes('新增 BOSS 账号'))?.trigger('click')
    await flushPromises()
    const dialog = wrapper.get('.el-dialog')
    await dialog.findAll('button').find((button) => button.text().includes('确认创建'))?.trigger('click')
    await flushPromises()

    expect(dialog.findAll('.el-form-item.is-error')).toHaveLength(3)
    expect(api.get).toHaveBeenCalledWith('/boss-accounts')
    wrapper.unmount()
  })

  it('keeps local pairing behind the account preparation view', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: [{
        id: 'account-1', displayName: '上海社招账号', externalIdentifier: 'boss-shanghai', status: 'ACTIVE',
        connectionStatus: 'UNVERIFIED', capabilities: [], company: { id: 'company-1', name: '测试企业', code: 'TEST' },
        gatewayType: 'LOCAL_CDP_CONNECTOR',
      }] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })
    const wrapper = mount(BossAccountsView, { attachTo: document.body })
    await flushPromises()
    await wrapper.findAll('.el-collapse-item__header').find((item) => item.text().includes('已有账号配置'))?.trigger('click')
    await wrapper.findAll('button').find((button) => button.text().includes('查看接入说明'))?.trigger('click')
    await flushPromises()

    expect(document.body.textContent).toContain('本机接入说明')
    expect(document.body.textContent).toContain('当前是准备阶段')
    expect(document.body.textContent).toContain('真实账号到位后，再打开本机接入设置')
    expect(document.body.textContent).not.toContain('复制连接码并配对')
    wrapper.unmount()
  })
})
