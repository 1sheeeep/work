import { flushPromises, mount } from '@vue/test-utils'
import { api } from '../services/api'
import ResumeIntakesView from './ResumeIntakesView.vue'

vi.mock('../services/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
  ensureCsrf: vi.fn(),
  apiErrorMessage: (_error: unknown, fallback: string) => fallback,
}))

const baseIntake = {
  contactId: 'contact-1',
  companyId: 'company-1',
  companyName: '新知科技集团',
  accountName: 'BOSS 主招聘账号',
  source: 'BOSS_VISIBLE',
  anonymousKey: 'c914f60a',
  displayLabel: '候选人已提供附件简历',
  status: 'APPROVED_FOR_AI',
  processingStatus: 'READY_FOR_AI',
  documentType: 'PDF',
  malwareScanned: true,
  analysisStatus: 'NOT_REQUESTED',
  receivedAt: '2026-08-31T08:00:00Z',
  createdAt: '2026-08-31T08:00:00Z',
}

describe('ResumeIntakesView', () => {
  it('lets HR drag a BOSS resume into the analysis workspace without submitting it', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: [
        { ...baseIntake, id: 'intake-1', candidateName: '候选人甲', jobTitle: '跨境电商运营助理', status: 'PENDING_REVIEW' },
        { ...baseIntake, id: 'intake-2', candidateName: '候选人乙', jobTitle: 'Node.js 全栈开发工程师', analysisStatus: 'SUCCEEDED' },
      ] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: { ready: true, model: 'qwen-plus' } })
      .mockResolvedValueOnce({ data: [{
        id: 'company-1', name: '新知科技集团', code: 'XINZHI', status: 'ACTIVE', knowledgeApproved: true,
        knowledgeVersion: 1, aiAutoAnalysisEnabled: true, version: 1,
      }] })
      .mockResolvedValueOnce({ data: [{
        id: 'run-2',
        resumeIntakeId: 'intake-2',
        candidateName: '候选人乙',
        jobTitle: 'Node.js 全栈开发工程师',
        provider: 'AI服务',
        modelVersion: 'qwen-plus',
        status: 'SUCCEEDED',
        origin: 'UNATTENDED',
        result: {
          recommendation: 'PRIORITY_VIEW',
          summary: '技术经历与岗位要求整体匹配。',
          evidence: [{ criterion: 'Node.js', finding: '具有三年项目经验', status: 'FOUND' }],
          gaps: [],
          risks: [],
          followUpQuestions: ['请确认最近项目中的职责范围。'],
        },
        errorMessage: undefined,
        feedback: [],
        createdBy: 'SYSTEM',
        createdAt: '2026-08-31T08:02:00Z',
      }] })

    const wrapper = mount(ResumeIntakesView)
    await flushPromises()

    expect(wrapper.text()).toContain('BOSS 已接收')
    expect(wrapper.text()).toContain('技术经历与岗位要求整体匹配')
    expect(wrapper.text()).toContain('AI 分析服务可用')
    expect(wrapper.text()).toContain('qwen-plus')
    expect(wrapper.text()).toContain('自动分析已开启')

    const transfer = {
      effectAllowed: 'none',
      setData: vi.fn(),
      getData: vi.fn(() => 'intake-1'),
    }
    const tickets = wrapper.findAll('.resume-ticket--boss')
    await tickets[0].trigger('dragstart', { dataTransfer: transfer })
    await wrapper.find('.analysis-board').trigger('drop', { dataTransfer: transfer })
    await flushPromises()

    expect(wrapper.find('.candidate-header').text()).toContain('候选人甲')
    expect(wrapper.text()).toContain('等待 HR 核对来源')
    expect(wrapper.text()).toContain('确认来源')
    expect(api.post).not.toHaveBeenCalled()
  })
})
