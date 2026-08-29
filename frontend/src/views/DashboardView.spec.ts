import { flushPromises, mount } from '@vue/test-utils'
import { api } from '../services/api'
import DashboardView from './DashboardView.vue'

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))
vi.mock('../services/api', () => ({ api: { get: vi.fn() } }))
vi.mock('../stores/auth', () => ({ authStore: { state: { user: { displayName: '招聘专员', role: 'RECRUITER' } } } }))

describe('DashboardView', () => {
  it('presents key metrics, clear module cards and attention items', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: [{ id: 'c1', status: 'ACTIVE' }] })
      .mockResolvedValueOnce({ data: [{ id: 'a1', status: 'ACTIVE', connectionStatus: 'DEGRADED' }] })
      .mockResolvedValueOnce({ data: [{ id: 'j1', status: 'ACTIVE' }] })
      .mockResolvedValueOnce({ data: [{ id: 'p1', status: 'SCREENING' }] })
      .mockResolvedValueOnce({ data: [{ accountId: 'a1', enabled: true, autoSendEnabled: true }] })
      .mockResolvedValueOnce({ data: [{ id: 'd1', status: 'ACTIVE', runtimeState: 'PAUSED' }] })
    const wrapper = mount(DashboardView)
    await flushPromises()
    expect(wrapper.text()).toContain('你好，招聘专员')
    expect(wrapper.text()).toContain('在招职位')
    expect(wrapper.text()).toContain('候选人工作台')
    expect(wrapper.text()).toContain('自动跟进')
    expect(wrapper.text()).toContain('BOSS 账号')
    expect(wrapper.text()).toContain('连接需要检查')
  })
})
