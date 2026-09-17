import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { api } from '../services/api'
import DashboardView from './DashboardView.vue'

enableAutoUnmount(afterEach)

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('../services/api', () => ({
  api: { get: vi.fn(), put: vi.fn() },
  ensureCsrf: vi.fn(),
  apiErrorMessage: (_error: unknown, fallback: string) => fallback,
}))

describe('DashboardView', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset()
    vi.mocked(api.put).mockReset()
    vi.mocked(api.get).mockResolvedValue({ data: [] })
  })
  it('summarizes hang-up duty and unread observations', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: [{ accountId: 'a1', accountName: '主招聘账号', configured: true, awayActive: false, accountStatus: 'ACTIVE', connectionStatus: 'CONNECTED' }] })
      .mockResolvedValueOnce({ data: [{ id: 'd1', accountId: 'a1', status: 'ACTIVE', runtimeState: 'RUNNING', pageContext: 'CHAT' }] })
      .mockResolvedValueOnce({ data: [{
        id: 'o1', accountId: 'a1', accountName: '主招聘账号', anonymousKey: 'a82c19e1',
        unreadCount: 2, unread: true, observedJobTitle: 'Node.js 全栈开发工程师',
        eligibilityStatus: 'OBSERVING', resolutionStatus: 'UNRESOLVED',
        draftQualification: 'KNOWLEDGE_READY', reviewStatus: 'PENDING', fillStatus: 'NONE',
        firstSeenAt: '2026-08-31T08:00:00Z', lastSeenAt: '2026-08-31T08:01:00Z',
      }] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })

    const wrapper = mount(DashboardView)
    await flushPromises()

    expect(wrapper.text()).toContain('挂机值守')
    expect(wrapper.text()).toContain('1 个账号可用')
    expect(wrapper.text()).toContain('1 未读')
    expect(wrapper.text()).toContain('1 待审')
    expect(wrapper.text()).not.toContain('最近自动接待')
  })

  it('keeps a connected account available for first-time duty before a policy exists', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: [{
        accountId: 'a1', accountName: '主招聘账号', configured: false, awayActive: false,
        accountStatus: 'ACTIVE', connectionStatus: 'CONNECTED', autoSendEnabled: false,
      }] })
      .mockResolvedValueOnce({ data: [{ id: 'd1', accountId: 'a1', status: 'ACTIVE', runtimeState: 'RUNNING', pageContext: 'CHAT' }] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })

    const wrapper = mount(DashboardView)
    await flushPromises()

    expect(wrapper.text()).toContain('1 个账号可用')
    expect(wrapper.find('[role="switch"]').attributes('aria-disabled')).not.toBe('true')
  })

  it('shows only confirmed AI send receipts in the duty review', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [{ id:'o1', accountId:'a1', accountName:'主招聘账号', anonymousKey:'abc123', unreadCount:1, unread:true, observedJobTitle:'跨境客服', eligibilityStatus:'OBSERVING', resolutionStatus:'UNRESOLVED', reviewStatus:'PENDING', fillStatus:'NONE', latestDirection:'INBOUND', firstSeenAt:'2026-08-31T08:00:00Z', lastSeenAt:'2026-08-31T08:01:00Z' }] })
      .mockResolvedValueOnce({ data: [{ id:'r1', observationId:'o1', anonymousKey:'abc123', accountName:'主招聘账号', jobTitle:'跨境客服', category:'SALARY', taskStatus:'COMPLETED', sendStatus:'SUCCEEDED', replyContent:'您好，该岗位薪资为 8-13K。', updatedAt:'2026-08-31T08:01:00Z', completedAt:'2026-08-31T08:01:00Z', attemptCount:1, needsFollowUp:true, followUpReason:'有新回复，待跟进' }] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })

    const wrapper = mount(DashboardView)
    await flushPromises()

    expect(wrapper.text()).toContain('AI 值守回顾')
    expect(wrapper.text()).toContain('您好，该岗位薪资为 8-13K。')
    expect(wrapper.text()).toContain('1 条成功回复')
    expect(wrapper.text()).not.toContain('AI 未成功回复，待 HR 判断')
  })

  it('splits successful replies from silent, failed, and retrying events', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [
        { id:'ok', observationId:'o-ok', anonymousKey:'ok01', accountName:'主招聘账号', jobTitle:'跨境客服', category:'SALARY', taskStatus:'COMPLETED', sendStatus:'SUCCEEDED', messageText:'请问薪资？', replyContent:'您好，薪资为 8-13K。', detail:'页面已确认发送', updatedAt:'2026-09-14T08:00:00Z', completedAt:'2026-09-14T08:00:00Z', attemptCount:1, needsFollowUp:false },
        { id:'silent', observationId:'o-silent', anonymousKey:'silent01', accountName:'主招聘账号', jobTitle:'跨境客服', category:'SOCIAL_ACKNOWLEDGEMENT', taskStatus:'COMPLETED', sendStatus:'SKIPPED', messageText:'好的', detail:'正常静默：无需重复客套', updatedAt:'2026-09-14T08:01:00Z', completedAt:'2026-09-14T08:01:00Z', attemptCount:1, needsFollowUp:false },
        { id:'retry', observationId:'o-retry', anonymousKey:'retry01', accountName:'主招聘账号', jobTitle:'跨境客服', category:'GENERAL_JOB_CONSULTATION', taskStatus:'FAILED', sendStatus:'SKIPPED', messageText:'可以详细介绍下吗', detail:'AI 输出重试已耗尽', updatedAt:'2026-09-14T08:02:00Z', completedAt:'2026-09-14T08:02:00Z', attemptCount:3, needsFollowUp:false },
      ] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })

    const wrapper = mount(DashboardView)
    await flushPromises()

    const panels = wrapper.findAll('.duty-grid-layout > .duty-review')
    expect(panels[0].text()).toContain('请问薪资？')
    expect(panels[0].text()).toContain('您好，薪资为 8-13K。')
    expect(panels[0].text()).not.toContain('好的')
    expect(panels[1].text()).toContain('好的')
    expect(panels[1].text()).toContain('AI 输出重试已耗尽')
    expect(panels[1].text()).toContain('已重试 2 次')
  })

  it('labels a partial AI answer with its HR follow-up reason', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [{ id:'r2', observationId:'o2', anonymousKey:'partial01', accountName:'主招聘账号', jobTitle:'跨境客服', category:'LOCATION', taskStatus:'COMPLETED', sendStatus:'SUCCEEDED', replyContent:'地点在广州，排班需要招聘人员确认。', detail:'已部分回答，仍需 HR 补充：OTHER_RECRUITMENT', updatedAt:'2026-08-31T08:01:00Z', completedAt:'2026-08-31T08:01:00Z', attemptCount:1, needsFollowUp:true, followUpReason:'已部分回答，仍需 HR 补充：OTHER_RECRUITMENT' }] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })

    const wrapper = mount(DashboardView)
    await flushPromises()

    expect(wrapper.text()).toContain('已部分回答，仍需 HR 补充')
  })

  it('shows AI-read but intentionally unanswered unrelated conversations for HR review', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [{ id:'o3', accountId:'a1', accountName:'主招聘账号', anonymousKey:'offtopic01', unreadCount:1, unread:true, observedJobTitle:'跨境客服', eligibilityStatus:'OBSERVING', resolutionStatus:'UNRESOLVED', reviewStatus:'PENDING', fillStatus:'NONE', latestDirection:'INBOUND', firstSeenAt:'2026-08-31T08:00:00Z', lastSeenAt:'2026-08-31T08:01:00Z' }] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [{ id:'skip1', observationId:'o3', anonymousKey:'offtopic01', accountName:'主招聘账号', jobTitle:'跨境客服', category:'UNRELATED', reason:'AI 判定该消息与当前岗位无关，未自动回复', decidedAt:'2026-08-31T08:01:00Z' }] })
      .mockResolvedValueOnce({ data: [] })

    const wrapper = mount(DashboardView)
    await flushPromises()

    expect(wrapper.text()).toContain('已读未回复 · 待 HR 复核')
    expect(wrapper.text()).toContain('AI 判定该消息与当前岗位无关')
    expect(wrapper.text()).toContain('匿名求职者')
  })

  it('renders the AI reply quality card with a readable legend and an actionable attention panel', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [{ id:'r1', observationId:'o1', anonymousKey:'needhr01', accountName:'主招聘账号', jobTitle:'短视频剪辑师', category:'GENERAL_JOB_CONSULTATION', reason:'意图识别置信度不足，已转人工', decidedAt:'2026-09-12T15:00:00Z' }] })
      .mockResolvedValueOnce({ data: {
        evaluated: 64, replyApproved: 21, sent: 41, expectedSilence: 12,
        reviewRequired: 5, shadowEvaluated: 3, failed: 1, unconfirmedSends: 5,
        averageConfidence: 0.82,
        categories: { SOCIAL_GREETING: 3, JOB_INTEREST: 2 },
        outcomes: { EXPECTED_SILENCE: 2, REVIEW_REQUIRED: 4 },
        generatedAt: '2026-09-12T15:00:00Z',
      } })

    const wrapper = mount(DashboardView)
    await flushPromises()

    expect(wrapper.find('#attention-panel').exists()).toBe(true)
    expect(wrapper.text()).toContain('AI 回复质量')
    expect(wrapper.text()).toContain('24h 决策')
    expect(wrapper.text()).toContain('发送结果未确认')
    expect(wrapper.text()).toContain('待复核会话')
    expect(wrapper.find('.quality-funnel__seg--unconfirmed').exists()).toBe(true)
    expect(wrapper.text()).toContain('社交寒暄')
    expect(wrapper.text()).toContain('求职意向')
    expect(wrapper.text()).toContain('正常静默')
    expect(wrapper.text()).not.toContain('其他（SOCIAL_GREETING）')
  })
})
