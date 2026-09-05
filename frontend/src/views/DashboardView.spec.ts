import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { api } from '../services/api'
import DashboardView from './DashboardView.vue'

enableAutoUnmount(afterEach)

vi.mock('../services/api', () => ({
  api: { get: vi.fn(), put: vi.fn() },
  ensureCsrf: vi.fn(),
  apiErrorMessage: (_error: unknown, fallback: string) => fallback,
}))

describe('DashboardView', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset()
    vi.mocked(api.put).mockReset()
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

    const wrapper = mount(DashboardView)
    await flushPromises()
    await wrapper.get('.message-list article').trigger('click')

    expect(document.body.textContent).toContain('已填入未发送')
    expect(document.body.textContent).not.toContain('已发送')
  })

  it('pins the recently verified browser conversation and shows its locator', async () => {
    vi.setSystemTime(new Date('2026-08-31T10:02:00Z'))
    vi.mocked(api.get).mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [
      { id: 'current', accountId: 'a1', accountName: '主招聘账号', anonymousKey: 'current001', unreadCount: 1, unread: true, observedJobTitle: '当前岗位', eligibilityStatus: 'OBSERVING', resolutionStatus: 'UNRESOLVED', reviewStatus: 'PENDING', fillStatus: 'NONE', detailVerifiedAt: '2026-08-31T10:01:00Z', latestMessageAt: '2026-08-31T09:00:00Z', firstSeenAt: '2026-08-31T08:00:00Z', lastSeenAt: '2026-08-31T10:01:00Z' },
      { id: 'newer', accountId: 'a1', accountName: '主招聘账号', anonymousKey: 'latest0001', unreadCount: 1, unread: true, observedJobTitle: '最新岗位', eligibilityStatus: 'OBSERVING', resolutionStatus: 'UNRESOLVED', reviewStatus: 'PENDING', fillStatus: 'NONE', latestMessageAt: '2026-08-31T10:01:30Z', firstSeenAt: '2026-08-31T08:00:00Z', lastSeenAt: '2026-08-31T10:01:30Z' },
    ] }).mockResolvedValueOnce({ data: [] })
    const wrapper = mount(DashboardView)
    await flushPromises()
    const rows = wrapper.findAll('.message-list article')
    expect(rows[0].text()).toContain('当前岗位')
    expect(rows[0].text()).toContain('当前浏览器会话')
    expect(rows[0].text()).toContain('定位码 current001')
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

    const wrapper = mount(DashboardView)
    await flushPromises()
    await wrapper.get('.message-list article').trigger('click')

    expect(document.body.textContent).toContain('关联真实岗位')
    expect(document.body.textContent).toContain('选择同账号已就绪岗位')
  })
})
