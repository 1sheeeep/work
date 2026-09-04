import { flushPromises, mount } from '@vue/test-utils'
import { api } from '../services/api'
import SystemLogsView from './SystemLogsView.vue'

vi.mock('../services/api', () => ({
  api: { get: vi.fn() },
  apiErrorMessage: (_error: unknown, fallback: string) => fallback,
}))

describe('SystemLogsView', () => {
  it('combines runtime health and audit events', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: { status: 'READY', activeBrowserDevices: 1, staleBrowserDevices: 0, unreadObservations: 8, unverifiedPageCaptures: 0, gateways: [] } })
      .mockResolvedValueOnce({ data: [{ id: 'l1', actorName: '系统管理员', action: 'CREATE_BOSS_ACCOUNT', targetLabel: '主账号', result: 'SUCCESS', occurredAt: '2026-08-31T08:00:00Z' }] })

    const wrapper = mount(SystemLogsView)
    await flushPromises()

    expect(wrapper.text()).toContain('项目运行日志')
    expect(wrapper.text()).toContain('在线桥接')
    expect(wrapper.text()).toContain('新增招聘账号')
    expect(wrapper.text()).not.toContain('上线核对')
  })
})
