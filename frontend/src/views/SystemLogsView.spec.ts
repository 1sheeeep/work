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
      .mockResolvedValueOnce({ data: {
        status: 'READY', activeBrowserDevices: 1, staleBrowserDevices: 0, unreadObservations: 8,
        unverifiedPageCaptures: 0, activeDutyPolicies: 1, gateways: [],
        inboundReplyQueue: { pending: 0, processing: 0, retryWaiting: 0, readyToSend: 0, sendLeased: 0, sendUnknown: 0, failedLastHour: 0, sentLastHour: 1, sentLastDay: 3, maxPendingPerAccount: 100, maxPendingGlobal: 1000, sendLimitPerHour: 20, sendLimitPerDay: 100, autoSendEnabled: true },
        recentInboundReplyEvents: [{ id: 'r1', accountName: '主账号', jobTitle: '跨境客服', anonymousChatKey: 'abc123', taskStatus: 'COMPLETED', sendStatus: 'SUCCEEDED', replyContent: '您好，该岗位薪资为 8-13K。', attemptCount: 1, createdAt: '2026-08-31T08:00:00Z', updatedAt: '2026-08-31T08:00:02Z', completedAt: '2026-08-31T08:00:02Z' }],
      } })
      .mockResolvedValueOnce({ data: [{ id: 'l1', actorName: '系统管理员', action: 'CREATE_BOSS_ACCOUNT', targetLabel: '主账号', result: 'SUCCESS', occurredAt: '2026-08-31T08:00:00Z' }] })

    const wrapper = mount(SystemLogsView)
    await flushPromises()

    expect(wrapper.text()).toContain('项目运行日志')
    expect(wrapper.text()).toContain('在线桥接')
    expect(wrapper.text()).toContain('新增招聘账号')
    expect(wrapper.text()).toContain('自动回复运行中')
    expect(wrapper.text()).toContain('已自动回复')
    expect(wrapper.text()).toContain('会话 abc123')
    expect(wrapper.text()).toContain('您好，该岗位薪资为 8-13K。')
    expect(wrapper.text()).not.toContain('上线核对')
  })
})
