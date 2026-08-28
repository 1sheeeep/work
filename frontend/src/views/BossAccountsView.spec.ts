import { flushPromises, mount } from '@vue/test-utils'
import { api } from '../services/api'
import BossAccountsView from './BossAccountsView.vue'

vi.mock('../services/api', () => ({
  api: { get: vi.fn() },
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
})
