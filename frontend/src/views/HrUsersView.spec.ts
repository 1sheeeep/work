import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { api } from '../services/api'
import HrUsersView from './HrUsersView.vue'

vi.mock('../services/api', () => ({
  api: { get: vi.fn() },
  apiErrorMessage: (_error: unknown, fallback: string) => fallback,
  apiFieldErrors: () => ({}),
  ensureCsrf: vi.fn(),
}))

describe('HrUsersView', () => {
  it('requires identity, password and company scope before creating an HR user', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [{ id: 'company-1', name: '测试企业', code: 'TEST', status: 'ACTIVE' }] })
    const wrapper = mount(HrUsersView, { attachTo: document.body })
    await flushPromises()
    await wrapper.get('button').trigger('click')
    await nextTick()

    const dialog = wrapper.get('.el-dialog')
    const submit = dialog.findAll('button').find((button) => button.text().includes('确认创建'))
    await submit?.trigger('click')
    await flushPromises()

    expect(dialog.findAll('.el-form-item.is-error')).toHaveLength(4)
    expect(api.get).toHaveBeenCalledWith('/hr-users', expect.any(Object))
    wrapper.unmount()
  })
})
