import { flushPromises, mount } from '@vue/test-utils'
import { api } from '../services/api'
import DashboardView from './DashboardView.vue'

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))
vi.mock('../services/api', () => ({ api: { get: vi.fn(),put:vi.fn() },ensureCsrf:vi.fn(),apiErrorMessage:(_e:unknown,f:string)=>f }))
vi.mock('../stores/auth', () => ({ authStore: { state: { user: { displayName: '招聘专员', role: 'RECRUITER' } } } }))

describe('DashboardView', () => {
  it('presents away controls, follow-up metrics and connection issues', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: [{ id: 'a1', status: 'ACTIVE', connectionStatus: 'DEGRADED' }] })
      .mockResolvedValueOnce({ data: [{ id: 'p1', needsHrFollowUp:true }] })
      .mockResolvedValueOnce({ data: [{ accountId: 'a1',accountName:'上海账号',configured:true,awayActive:false,accountStatus:'ACTIVE',messageSendCapable:true,sentToday:2 }] })
      .mockResolvedValueOnce({ data: [{ id: 'd1', status: 'ACTIVE', runtimeState: 'PAUSED' }] })
      .mockResolvedValueOnce({ data: [{ id:'r1',candidateName:'张同学',jobTitle:'Java',accountName:'上海账号',status:'SENT',createdAt:'2026-08-29T06:00:00Z' }] })
    const wrapper = mount(DashboardView)
    await flushPromises()
    expect(wrapper.text()).toContain('你好，招聘专员')
    expect(wrapper.text()).toContain('你当前在岗')
    expect(wrapper.text()).toContain('离开 1 小时')
    expect(wrapper.text()).toContain('待 HR 跟进')
    expect(wrapper.text()).toContain('最近自动接待')
    expect(wrapper.text()).toContain('连接需要检查')
  })
})
