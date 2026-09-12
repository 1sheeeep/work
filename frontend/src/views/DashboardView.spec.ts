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
  it('combines hang-up duty and unread messages in one workspace', async () => {
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
    expect(wrapper.text()).toContain('消息队列')
    expect(wrapper.text()).toContain('Node.js 全栈开发工程师')
    expect(wrapper.text()).toContain('2')
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

  it('shows the real approved-draft fill state without calling it sent', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [{
        id: 'o2', accountId: 'a1', accountName: '主招聘账号', anonymousKey: 'b91f02a1',
        unreadCount: 1, unread: true, observedJobTitle: '人事前台', draftContent: '已审核安全草稿', reviewedContent: '已审核安全草稿',
        eligibilityStatus: 'APPROVED_DRAFT', resolutionStatus: 'UNRESOLVED', draftQualification: 'KNOWLEDGE_READY', reviewStatus: 'APPROVED', fillStatus: 'FILLED', filledAt: '2026-08-31T10:00:00Z',
        firstSeenAt: '2026-08-31T08:00:00Z', lastSeenAt: '2026-08-31T08:01:00Z',
      }] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })

    const wrapper = mount(DashboardView)
    await flushPromises()
    await wrapper.get('.message-grid button.message-card').trigger('click')

    expect(wrapper.text()).toContain('已填入未发送')
    expect(wrapper.text()).not.toContain('已发送')
  })

  it('pins the recently verified browser conversation and shows its locator', async () => {
    vi.setSystemTime(new Date('2026-08-31T10:02:00Z'))
    vi.mocked(api.get).mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [
      { id: 'current', accountId: 'a1', accountName: '主招聘账号', anonymousKey: 'current001', unreadCount: 1, unread: true, observedJobTitle: '当前岗位', eligibilityStatus: 'OBSERVING', resolutionStatus: 'UNRESOLVED', reviewStatus: 'PENDING', fillStatus: 'NONE', detailVerifiedAt: '2026-08-31T10:01:00Z', latestMessageAt: '2026-08-31T09:00:00Z', firstSeenAt: '2026-08-31T08:00:00Z', lastSeenAt: '2026-08-31T10:01:00Z' },
      { id: 'newer', accountId: 'a1', accountName: '主招聘账号', anonymousKey: 'latest0001', unreadCount: 1, unread: true, observedJobTitle: '最新岗位', eligibilityStatus: 'OBSERVING', resolutionStatus: 'UNRESOLVED', reviewStatus: 'PENDING', fillStatus: 'NONE', latestMessageAt: '2026-08-31T10:01:30Z', firstSeenAt: '2026-08-31T08:00:00Z', lastSeenAt: '2026-08-31T10:01:30Z' },
    ] }).mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [] })
    const wrapper = mount(DashboardView)
    await flushPromises()
    const rows = wrapper.findAll('.message-grid button.message-card')
    expect(rows[0].text()).toContain('当前岗位')
    expect(rows[0].text()).toContain('当前浏览器会话')
    expect(rows[0].find('.message-card__avatar').text()).toBe('求')
    vi.useRealTimers()
  })

  it('offers a compact manual job match only for an unmatched observation', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [{
        id: 'unmatched-1', accountId: 'a1', accountName: '主招聘账号', anonymousKey: 'unmatched001', unreadCount: 1,
        unread: true, observedJobTitle: 'Node全栈', eligibilityStatus: 'OBSERVING', resolutionStatus: 'UNRESOLVED',
        draftQualification: 'JOB_UNMATCHED', reviewStatus: 'PENDING', fillStatus: 'NONE',
        firstSeenAt: '2026-08-31T08:00:00Z', lastSeenAt: '2026-08-31T08:01:00Z',
      }] })
      .mockResolvedValueOnce({ data: [{
        groupKey: 'group-1', accountId: 'a1', accountName: '主招聘账号', companyName: '新知科技集团', observedTitle: 'Node全栈',
        observationIds: ['unmatched-1'], conversations: 1, unreadCount: 1, firstSeenAt: '2026-08-31T08:00:00Z', lastSeenAt: '2026-08-31T08:01:00Z',
        candidates: [{ id: 'job-1', title: 'Node.js 全栈开发工程师', knowledgeReady: true, blockers: [] }],
      }] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })

    const wrapper = mount(DashboardView)
    await flushPromises()
    await wrapper.get('.message-grid button.message-card').trigger('click')

    expect(wrapper.text()).toContain('关联真实岗位')
    expect(wrapper.text()).toContain('选择同账号已就绪岗位')
  })

  it('shows only confirmed AI send receipts in the duty review', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [{ id:'o1', accountId:'a1', accountName:'主招聘账号', anonymousKey:'abc123', unreadCount:1, unread:true, observedJobTitle:'跨境客服', eligibilityStatus:'OBSERVING', resolutionStatus:'UNRESOLVED', reviewStatus:'PENDING', fillStatus:'NONE', latestDirection:'INBOUND', firstSeenAt:'2026-08-31T08:00:00Z', lastSeenAt:'2026-08-31T08:01:00Z' }] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [{ id:'r1', observationId:'o1', anonymousKey:'abc123', accountName:'主招聘账号', jobTitle:'跨境客服', category:'SALARY', taskStatus:'COMPLETED', sendStatus:'SUCCEEDED', replyContent:'您好，该岗位薪资为 8-13K。', updatedAt:'2026-08-31T08:01:00Z', completedAt:'2026-08-31T08:01:00Z', attemptCount:1, needsFollowUp:true, followUpReason:'有新回复，待跟进' }] })
      .mockResolvedValueOnce({ data: [] })

    const wrapper = mount(DashboardView)
    await flushPromises()

    expect(wrapper.text()).toContain('AI 值守回顾')
    expect(wrapper.text()).toContain('您好，该岗位薪资为 8-13K。')
    expect(wrapper.text()).toContain('有新回复，待跟进')
  })

  it('labels a partial AI answer with its HR follow-up reason', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [{ id:'r2', observationId:'o2', anonymousKey:'partial01', accountName:'主招聘账号', jobTitle:'跨境客服', category:'LOCATION', taskStatus:'COMPLETED', sendStatus:'SUCCEEDED', replyContent:'地点在广州，排班需要招聘人员确认。', detail:'已部分回答，仍需 HR 补充：OTHER_RECRUITMENT', updatedAt:'2026-08-31T08:01:00Z', completedAt:'2026-08-31T08:01:00Z', attemptCount:1, needsFollowUp:true, followUpReason:'已部分回答，仍需 HR 补充：OTHER_RECRUITMENT' }] })
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
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [{ id:'skip1', observationId:'o3', anonymousKey:'offtopic01', accountName:'主招聘账号', jobTitle:'跨境客服', category:'UNRELATED', reason:'AI 判定该消息与当前岗位无关，未自动回复', decidedAt:'2026-08-31T08:01:00Z' }] })

    const wrapper = mount(DashboardView)
    await flushPromises()

    expect(wrapper.text()).toContain('已读未回复 · 待 HR 复核')
    expect(wrapper.text()).toContain('AI 判定该消息与当前岗位无关')
    expect(wrapper.text()).toContain('匿名求职者')
  })
})
