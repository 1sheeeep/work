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

type DutyLoad = {
  policies?: unknown[]
  devices?: unknown[]
  observations?: unknown[]
  events?: unknown[]
  reviews?: unknown[]
  quality?: unknown
  timelines?: Record<string, unknown>
}

function mockDutyLoad(data: DutyLoad = {}) {
  const responses: Record<string, unknown> = {
    '/auto-replies/policies': data.policies ?? [],
    '/local-connector/devices': data.devices ?? [],
    '/local-connector/observations': data.observations ?? [],
    '/local-connector/ai-duty-events': data.events ?? [],
    '/local-connector/ai-duty-review-required': data.reviews ?? [],
    '/local-connector/ai-reply-quality-summary': data.quality ?? [],
  }
  vi.mocked(api.get).mockImplementation((url) => {
    const key = String(url)
    const timeline = key.match(/^\/local-connector\/ai-duty-sessions\/([^/]+)\/timeline$/)
    return Promise.resolve({ data: timeline ? data.timelines?.[timeline[1]] ?? [] : responses[key] ?? [] }) as never
  })
}

describe('DashboardView', () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.mocked(api.get).mockReset()
    vi.mocked(api.put).mockReset()
    mockDutyLoad()
  })

  it('combines duty controls and recent BOSS sessions in one workspace', async () => {
    const observedAt = new Date().toISOString()
    mockDutyLoad({
      policies: [{ accountId: 'a1', accountName: '主招聘账号', configured: true, awayActive: false, accountStatus: 'ACTIVE', connectionStatus: 'CONNECTED' }],
      devices: [{ id: 'd1', accountId: 'a1', status: 'ACTIVE', runtimeState: 'RUNNING' }],
      observations: [{ id: 'o1', accountId: 'a1', accountName: '主招聘账号', anonymousKey: 'a82c19e1', unreadCount: 2, unread: true, observedJobTitle: 'Node.js 全栈开发工程师', eligibilityStatus: 'OBSERVING', resolutionStatus: 'UNRESOLVED', reviewStatus: 'PENDING', fillStatus: 'NONE', firstSeenAt: observedAt, lastSeenAt: observedAt, latestMessageAt: observedAt }],
    })

    const wrapper = mount(DashboardView)
    await flushPromises()

    expect(wrapper.text()).toContain('挂机值守')
    expect(wrapper.text()).toContain('BOSS 会话')
    expect(wrapper.text()).toContain('Node.js 全栈开发工程师')
    expect(wrapper.text()).toContain('2')
    expect(wrapper.text()).not.toContain('消息队列')
  })

  it('keeps a connected account available for first-time duty before a policy exists', async () => {
    mockDutyLoad({
      policies: [{ accountId: 'a1', accountName: '主招聘账号', configured: false, awayActive: false, accountStatus: 'ACTIVE', connectionStatus: 'CONNECTED', autoSendEnabled: false }],
      devices: [{ id: 'd1', accountId: 'a1', status: 'ACTIVE', runtimeState: 'RUNNING', pageContext: 'CHAT' }],
    })

    const wrapper = mount(DashboardView)
    await flushPromises()

    expect(wrapper.text()).toContain('1 个账号可用')
    expect(wrapper.find('[role="switch"]').attributes('aria-disabled')).not.toBe('true')
  })

  it('renders the latest AI event in the selected conversation thread', async () => {
    mockDutyLoad({
      events: [{ id: 'event-1', observationId: 'o1', anonymousKey: 'abc123', accountName: '主招聘账号', jobTitle: '跨境客服', category: 'SALARY', taskStatus: 'COMPLETED', sendStatus: 'SUCCEEDED', messageText: '请问薪资？', replyContent: '您好，薪资为 8-13K。', detail: '页面已确认发送', updatedAt: '2026-08-31T08:01:00Z', completedAt: '2026-08-31T08:01:00Z', attemptCount: 1, needsFollowUp: false }],
    })

    const wrapper = mount(DashboardView)
    await flushPromises()
    await wrapper.get('.duty-chat-session').trigger('click')

    expect(wrapper.findAll('.duty-chat-bubble').some(bubble => bubble.attributes('aria-label') === '候选人消息')).toBe(true)
    expect(wrapper.text()).toContain('请问薪资？')
    expect(wrapper.text()).toContain('AI 回复')
    expect(wrapper.text()).toContain('您好，薪资为 8-13K。')
  })

  it('loads the imported full timeline for the selected observation', async () => {
    mockDutyLoad({
      events: [{ id: 'event-2', observationId: 'o2', anonymousKey: 'timeline01', accountName: '主招聘账号', jobTitle: 'Java 开发', category: 'JOB_INTEREST', taskStatus: 'COMPLETED', sendStatus: 'SUCCEEDED', messageText: '旧的摘要', replyContent: '旧的回复', updatedAt: '2026-08-31T08:01:00Z', completedAt: '2026-08-31T08:01:00Z', attemptCount: 1, needsFollowUp: false }],
      timelines: {
        o2: { observationId: 'o2', anonymousKey: 'timeline01', contactId: 'contact-1', available: true, reason: null, messages: [
          { id: 'm1', externalMessageId: 'boss:m1', direction: 'INBOUND', senderType: 'CANDIDATE', deliveryStatus: 'RECEIVED', content: '我有两年 Java 经验', createdAt: '2026-08-31T08:00:00Z' },
          { id: 'm2', externalMessageId: 'boss:m2', direction: 'OUTBOUND', senderType: 'HR', deliveryStatus: 'SENT', content: '收到，我先了解一下', createdAt: '2026-08-31T08:01:00Z' },
        ] },
      },
    })

    const wrapper = mount(DashboardView)
    await flushPromises()
    await flushPromises()

    expect(wrapper.text()).toContain('我有两年 Java 经验')
    expect(wrapper.text()).toContain('HR')
    expect(wrapper.text()).toContain('收到，我先了解一下')
    expect(vi.mocked(api.get).mock.calls.some(([url]) => url === '/local-connector/ai-duty-sessions/o2/timeline')).toBe(true)
  })

  it('groups real BOSS message times by calendar day without changing bubble order', async () => {
    mockDutyLoad({
      events: [{ id: 'event-day', observationId: 'o-day', anonymousKey: 'day123', accountName: '主招聘账号', jobTitle: 'Java 开发', category: 'JOB_INTEREST', taskStatus: 'COMPLETED', sendStatus: 'SUCCEEDED', messageText: '第二天的消息', replyContent: '第二天的回复', updatedAt: '2026-09-17T11:03:00Z', completedAt: '2026-09-17T11:03:00Z', attemptCount: 1, needsFollowUp: false }],
      timelines: { 'o-day': { observationId: 'o-day', anonymousKey: 'day123', contactId: 'contact-day', available: true, reason: null, messages: [
        { id: 'old', externalMessageId: 'boss:old', direction: 'INBOUND', senderType: 'CANDIDATE', deliveryStatus: 'RECEIVED', content: '第一天的消息', createdAt: '2026-09-16T11:03:00Z' },
        { id: 'new', externalMessageId: 'boss:new', direction: 'INBOUND', senderType: 'CANDIDATE', deliveryStatus: 'RECEIVED', content: '第二天的消息', createdAt: '2026-09-17T11:03:00Z' },
        { id: 'reply', externalMessageId: 'boss:reply', direction: 'OUTBOUND', senderType: 'HR', deliveryStatus: 'SENT', content: '第二天的回复', createdAt: '2026-09-17T11:03:00Z' },
      ] } },
    })

    const wrapper = mount(DashboardView)
    await flushPromises()
    await flushPromises()

    expect(wrapper.findAll('.duty-chat-timeline__date')).toHaveLength(2)
    expect(wrapper.findAll('.duty-chat-bubble').map(bubble => bubble.text())).toEqual([
      expect.stringContaining('第一天的消息'),
      expect.stringContaining('第二天的消息'),
      expect.stringContaining('第二天的回复'),
    ])
    expect(wrapper.findAll('.duty-chat-timeline__date time').map(item => item.attributes('datetime'))).toEqual(['2026-09-16', '2026-09-17'])
  })

  it('keeps a transparent fallback when the transcript is not available', async () => {
    mockDutyLoad({
      events: [{ id: 'event-3', observationId: 'o3', anonymousKey: 'missing01', accountName: '主招聘账号', jobTitle: '产品运营', category: 'JOB_INTEREST', taskStatus: 'COMPLETED', sendStatus: 'SUCCEEDED', messageText: '摘要消息', replyContent: '收到', updatedAt: '2026-08-31T08:01:00Z', completedAt: '2026-08-31T08:01:00Z', attemptCount: 1, needsFollowUp: false }],
      timelines: { o3: { observationId: 'o3', anonymousKey: 'missing01', available: false, reason: '该会话尚未导入人才库时间线', messages: [] } },
    })

    const wrapper = mount(DashboardView)
    await flushPromises()
    await flushPromises()

    expect(wrapper.text()).toContain('该会话尚未导入人才库时间线')
    expect(wrapper.text()).toContain('摘要消息')
  })

  it('filters the session list to review items from the quality attention action', async () => {
    mockDutyLoad({
      events: [{ id: 'event-4', observationId: 'o4', anonymousKey: 'review01', accountName: '主招聘账号', jobTitle: '跨境客服', category: 'UNCERTAIN', taskStatus: 'COMPLETED', sendStatus: 'SKIPPED', messageText: '请问有宿舍吗', detail: '无法可靠判断消息意图，已转人工', updatedAt: '2026-08-31T08:01:00Z', completedAt: '2026-08-31T08:01:00Z', attemptCount: 1, needsFollowUp: false }],
      quality: { evaluated: 1, replyApproved: 0, sent: 0, expectedSilence: 0, reviewRequired: 1, shadowEvaluated: 0, failed: 0, unconfirmedSends: 0, averageConfidence: 0.4, categories: { UNCERTAIN: 1 }, outcomes: { REVIEW_REQUIRED: 1 }, generatedAt: '2026-08-31T08:01:00Z' },
    })

    const wrapper = mount(DashboardView)
    await flushPromises()
    const reviewAction = wrapper.findAll('button').find(button => button.text().includes('待复核会话'))
    expect(reviewAction).toBeTruthy()
    await reviewAction!.trigger('click')

    expect(wrapper.find('.duty-chat-filters button.active').text()).toBe('待复核')
    expect(wrapper.text()).toContain('请问有宿舍吗')
  })

  it('uses one seven-day date range for both duty event and review queries', async () => {
    vi.setSystemTime(new Date('2026-09-15T04:00:00Z'))
    const wrapper = mount(DashboardView)
    await flushPromises()

    const eventCall = vi.mocked(api.get).mock.calls.find(([url]) => url === '/local-connector/ai-duty-events')
    const reviewCall = vi.mocked(api.get).mock.calls.find(([url]) => url === '/local-connector/ai-duty-review-required')
    const eventParams = eventCall?.[1]?.params as { from: string; to: string }
    const reviewParams = reviewCall?.[1]?.params as { from: string; to: string }

    expect(eventParams).toEqual(reviewParams)
    expect((new Date(eventParams.to).getTime() - new Date(eventParams.from).getTime()) / 86_400_000).toBe(7)
    expect(wrapper.get('.duty-history-filter').text()).toContain('同时筛选成功回复与待 HR 复核')
    vi.useRealTimers()
  })

  it('only keeps conversations active on the selected day, not old messages rescanned today', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-17T04:00:00Z'))
    const oldObservation = { id: 'o-old', accountId: 'a1', accountName: '主招聘账号', anonymousKey: 'tuesday-chat', unreadCount: 1, unread: true, latestDirection: 'INBOUND', observedJobTitle: '旧岗位', firstSeenAt: '2026-09-15T03:00:00Z', latestMessageAt: '2026-09-15T03:00:00Z', lastSeenAt: '2026-09-17T03:59:00Z' }
    const todayObservation = { id: 'o-today', accountId: 'a1', accountName: '主招聘账号', anonymousKey: 'today-chat', unreadCount: 1, unread: true, latestDirection: 'INBOUND', observedJobTitle: '今日岗位', firstSeenAt: '2026-09-17T03:00:00Z', latestMessageAt: '2026-09-17T03:00:00Z', lastSeenAt: '2026-09-17T03:59:00Z' }
    const unknownDateObservation = { id: 'o-unknown', accountId: 'a1', accountName: '主招聘账号', anonymousKey: 'unknown-date', unreadCount: 1, unread: true, latestDirection: 'INBOUND', observedJobTitle: '待核岗位', firstSeenAt: '2026-09-17T03:00:00Z', lastSeenAt: '2026-09-17T03:59:00Z' }
    const oldEvent = { id: 'e-old', observationId: 'o-old', anonymousKey: 'tuesday-chat', accountName: '主招聘账号', jobTitle: '旧岗位', taskStatus: 'COMPLETED', sendStatus: 'SUCCEEDED', messageText: '周二提问', replyContent: '周二回复', updatedAt: '2026-09-17T03:00:00Z', completedAt: '2026-09-15T03:01:00Z', sendCompletedAt: '2026-09-15T03:02:00Z', attemptCount: 1, needsFollowUp: false }
    const todayEvent = { id: 'e-today', observationId: 'o-today', anonymousKey: 'today-chat', accountName: '主招聘账号', jobTitle: '今日岗位', taskStatus: 'COMPLETED', sendStatus: 'SUCCEEDED', messageText: '今日提问', replyContent: '今日回复', updatedAt: '2026-09-17T03:30:00Z', completedAt: '2026-09-17T03:31:00Z', sendCompletedAt: '2026-09-17T03:32:00Z', attemptCount: 1, needsFollowUp: false }
    mockDutyLoad({ observations: [oldObservation, todayObservation, unknownDateObservation], events: [oldEvent, todayEvent] })

    const wrapper = mount(DashboardView)
    await flushPromises()
    expect(wrapper.findAll('.duty-chat-session')).toHaveLength(2)

    vi.mocked(api.get).mockImplementation((url) => Promise.resolve({ data: url === '/local-connector/observations' ? [oldObservation, todayObservation, unknownDateObservation]
      : url === '/local-connector/ai-duty-events' ? [todayEvent] : [] }) as never)
    const picker = wrapper.findComponent({ name: 'ElDatePicker' })
    expect(picker.exists()).toBe(true)
    picker.vm.$emit('update:modelValue', [new Date('2026-09-17T00:00:00+08:00'), new Date('2026-09-17T00:00:00+08:00')])
    picker.vm.$emit('change')
    await flushPromises()

    expect(wrapper.findAll('.duty-chat-session')).toHaveLength(1)
    expect(wrapper.get('.duty-chat-session').text()).toContain('today-chat')
    expect(wrapper.text()).not.toContain('tuesday-chat')
    expect(wrapper.text()).not.toContain('unknown-date')
    expect(wrapper.get('.duty-chat-list__count').text()).toContain('1 已回复')
    const dateCall = vi.mocked(api.get).mock.calls.filter(([url]) => url === '/local-connector/ai-duty-events').at(-1)
    const params = dateCall?.[1]?.params as { from: string; to: string }
    expect(params.from).toBe('2026-09-16T16:00:00.000Z')
    expect(params.to).toBe('2026-09-17T16:00:00.000Z')
    vi.useRealTimers()
  })

  it('does not report a successful refresh when one dashboard source fails', async () => {
    vi.mocked(api.get).mockImplementation((url) => {
      if (url === '/local-connector/devices') return Promise.reject(new Error('network')) as never
      return Promise.resolve({ data: url === '/local-connector/ai-reply-quality-summary' ? {} : [] }) as never
    })

    const wrapper = mount(DashboardView)
    await flushPromises()

    expect(wrapper.get('.refresh-warning').attributes('title')).toContain('桥接设备刷新失败')
    expect(wrapper.get('.refresh-indicator').text()).toContain('尚未完整刷新')
  })

  it('shows processing duration and highlights a timed-out AI task', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-15T04:00:00Z'))
    mockDutyLoad({
      events: [{ id: 'event-processing', observationId: 'o-processing', anonymousKey: 'running01', accountName: '主招聘账号', jobTitle: 'AI 应用开发助理', taskStatus: 'PROCESSING', sendStatus: 'PENDING', messageText: '您好', createdAt: '2026-09-15T03:58:20Z', processingStartedAt: '2026-09-15T03:58:25Z', updatedAt: '2026-09-15T03:58:25Z', attemptCount: 1, needsFollowUp: false }],
    })

    const wrapper = mount(DashboardView)
    await flushPromises()

    expect(wrapper.text()).toContain('AI 处理中 1分35秒 · 已超时')
    expect(wrapper.find('.duty-chat-status--danger').exists()).toBe(true)
    vi.useRealTimers()
  })
})
