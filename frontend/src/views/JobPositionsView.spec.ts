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
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))

describe('JobPositionsView', () => {
  beforeEach(() => vi.mocked(api.get).mockReset())

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

  it('shows imported jobs in a five-step human review queue', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: [{
        id: 'job-1', title: '跨境电商运营助理', location: '待从 BOSS 岗位页补全', salaryMinK: 1, salaryMaxK: 1,
        salaryMonths: 12, experienceRequirement: '待从 BOSS 岗位页补全', educationRequirement: '待从 BOSS 岗位页补全',
        description: '待从 BOSS 岗位页补全', observationCount: 8, captureSource: 'UNREAD_OBSERVATION', captureVerified: false,
        knowledgeApproved: false, knowledgeVersion: 0, safeReplyReady: false, safeReplyIssues: ['公司知识未审核'], status: 'DRAFT',
        company: { id: 'company-1', name: '新知科技集团', code: 'XINZHI', status: 'ACTIVE' },
        bossAccount: { id: 'account-1', displayName: 'BOSS 主招聘账号', externalIdentifier: 'boss-main-01', status: 'ACTIVE', connectionStatus: 'CONNECTED' },
        reviewReadiness: { importedDraft: true, profileComplete: false, captureReady: false, companyKnowledgeReady: false, jobKnowledgeReady: false, activationReady: false, blockers: ['岗位详情待补全', '企业回复知识待审核'] },
      }] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })
    const wrapper = mount(JobPositionsView)
    await flushPromises()

    expect(wrapper.text()).toContain('真实岗位待办')
    expect(wrapper.text()).toContain('在未读列表出现 8 次')
    expect(wrapper.text()).toContain('先审核企业资料')
    wrapper.unmount()
  })

  it('labels visible-page evidence without presenting sync count as unread occurrences', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: [{
        id: 'job-visible', title: 'Node.js 全栈开发工程师', location: '广州', salaryMinK: 20, salaryMaxK: 30,
        salaryMonths: 13, experienceRequirement: '1-3年', educationRequirement: '本科',
        description: '由真实 BOSS 职位管理页只读采集，职位描述待 HR 核对补全。', observationCount: 129,
        captureSource: 'VISIBLE_PAGE', captureCompleteness: 5, captureVerified: false,
        knowledgeApproved: false, knowledgeVersion: 0, safeReplyReady: false, safeReplyIssues: ['职位描述待补全'], status: 'DRAFT',
        company: { id: 'company-1', name: '新知科技集团', code: 'XINZHI', status: 'ACTIVE' },
        bossAccount: { id: 'account-1', displayName: 'BOSS 主招聘账号', externalIdentifier: 'boss-main-01', status: 'ACTIVE', connectionStatus: 'CONNECTED' },
        reviewReadiness: { importedDraft: true, profileComplete: false, captureReady: false, companyKnowledgeReady: true, jobKnowledgeReady: false, activationReady: false, blockers: ['职位描述待补全'] },
      }] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })
    const wrapper = mount(JobPositionsView)
    await flushPromises()

    expect(wrapper.text()).toContain('BOSS 职位页已同步 · 5 个公开字段')
    expect(wrapper.text()).not.toContain('在未读列表出现 129 次')
    wrapper.unmount()
  })
})
