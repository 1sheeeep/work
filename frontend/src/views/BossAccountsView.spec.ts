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
    expect(api.get).toHaveBeenCalledWith('/boss-accounts', expect.any(Object))
    wrapper.unmount()
  })

  it('guides an HR through pairing and monitor-only verification', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: [{
        id: 'account-1', displayName: '上海社招账号', externalIdentifier: 'boss-shanghai', status: 'ACTIVE',
        connectionStatus: 'UNVERIFIED', capabilities: [], company: { id: 'company-1', name: '测试企业', code: 'TEST' },
        gatewayType: 'LOCAL_CDP_CONNECTOR',
      }] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })
    vi.mocked(api.post).mockResolvedValueOnce({ data: { pairingToken: 'pairing-token-123', expiresAt: '2026-08-29T16:00:00Z' } })

    const wrapper = mount(BossAccountsView, { attachTo: document.body })
    await flushPromises()
    await wrapper.findAll('button').find((button) => button.text().includes('开始连接'))?.trigger('click')
    await flushPromises()

    expect(document.body.textContent).toContain('安装浏览器助手')
    expect(document.body.textContent).toContain('复制连接码')
    expect(document.body.textContent).toContain('打开 BOSS 聊天页面')
    expect(document.body.textContent).toContain('先安全观察')

    const generateButton = wrapper.findAll('button').find((button) => button.text().includes('生成连接码'))
    await generateButton?.trigger('click')
    await flushPromises()

    expect(api.post).toHaveBeenCalledWith('/browser-devices/pairings', { accountId: 'account-1' })
    expect(document.body.textContent).toContain('pairing-token-123')
    wrapper.unmount()
  })
})
