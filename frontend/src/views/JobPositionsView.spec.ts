import { flushPromises, mount } from '@vue/test-utils'
import { api } from '../services/api'
import JobPositionsView from './JobPositionsView.vue'

vi.mock('../services/api', () => ({
  api: { get: vi.fn() },
  apiErrorMessage: (_error: unknown, fallback: string) => fallback,
  apiFieldErrors: () => ({}),
  ensureCsrf: vi.fn(),
}))
vi.mock('../stores/auth', () => ({
  authStore: { state: { user: { id: 'admin', username: 'admin', displayName: '系统管理员', role: 'SYSTEM_ADMIN' } } },
}))

describe('JobPositionsView', () => {
  it('validates required ownership, account and job fields before creating a draft', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })
    const wrapper = mount(JobPositionsView, { attachTo: document.body })
    await flushPromises()

    await wrapper.findAll('button').find((button) => button.text().includes('新增职位'))?.trigger('click')
    await flushPromises()
    const dialog = wrapper.get('.el-dialog')
    await dialog.findAll('button').find((button) => button.text().includes('创建草稿'))?.trigger('click')
    await flushPromises()

    expect(dialog.findAll('.el-form-item.is-error')).toHaveLength(7)
    expect(api.get).toHaveBeenCalledWith('/job-positions', expect.any(Object))
    wrapper.unmount()
  })
})
