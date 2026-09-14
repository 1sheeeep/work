import { flushPromises, mount } from '@vue/test-utils'
import { api } from '../services/api'
import ResumeIntakesView from './ResumeIntakesView.vue'

vi.mock('../services/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
  ensureCsrf: vi.fn(),
  apiErrorMessage: (_error: unknown, fallback: string) => fallback,
}))

vi.mock('../stores/auth', () => ({
  authStore: { state: { user: { id: 'admin', displayName: '系统管理员', role: 'SYSTEM_ADMIN' } } },
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
  beforeEach(() => {
    vi.mocked(api.get).mockReset()
    vi.mocked(api.post).mockReset()
    vi.mocked(api.put).mockReset()
  })

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
      .mockResolvedValueOnce({ data: {
        items: [], page: 0, pageSize: 100, total: 0,
        counts: { total: 0, withResume: 0, analyzed: 0, processing: 0, failed: 0 },
      } })
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

  it('uploads a dropped external PDF directly for AI job matching', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/resume-intakes') return { data: [] }
      if (url === '/candidate-contacts') return { data: [] }
      if (url === '/ai-configuration/status') return { data: { ready: true, model: 'qwen-plus' } }
      if (url === '/organization/companies') return { data: [] }
      if (url === '/talent-candidates/page?page=0&pageSize=100') return { data: { items: [], page: 0, pageSize: 100, total: 0, counts: { total: 0, withResume: 0, analyzed: 0, processing: 0, failed: 0 } } }
      return { data: [] }
    })
    vi.mocked(api.post).mockResolvedValue({ data: {
      intake: { ...baseIntake, id: 'external-1', source: 'MANUAL', candidateName: '张三', jobTitle: 'Node.js 全栈开发工程师' },
      analysis: { id: 'run-external-1' },
      comparedJobCount: 7,
    } })

    const wrapper = mount(ResumeIntakesView)
    await flushPromises()
    const file = new File(['%PDF-1.4 test'], 'resume.pdf', { type: 'application/pdf' })
    await wrapper.find('.external-pdf-drop').trigger('drop', { dataTransfer: { files: [file] } })
    await flushPromises()

    expect(api.post).toHaveBeenCalledWith(
      '/resume-intakes/external-pdf-analysis',
      expect.any(FormData),
      { timeout: 120_000 },
    )
  })

  it('links the selected resume to its talent profile without blocking analysis', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/resume-intakes') return { data: [{ ...baseIntake, id: 'intake-profile', contactId: 'contact-profile', candidateName: '候选人甲', analysisStatus: 'NOT_REQUESTED' }] }
      if (url === '/candidate-contacts') return { data: [{ id: 'contact-profile', candidateId: 'candidate-profile', company: { id: 'company-1', name: '新知科技集团', code: 'XINZHI' }, jobPosition: { id: 'job-1', title: 'Java 开发' }, bossAccount: { id: 'account-1', displayName: '主招聘账号' }, source: 'BOSS', sourceReference: 'source', displayName: '候选人甲', privacyStatus: 'ACTIVE', status: 'SCREENING', humanTakenOver: false, needsHrFollowUp: false, pendingReviewDraft: false }] }
      if (url === '/ai-configuration/status') return { data: { ready: true, model: 'qwen-plus' } }
      if (url === '/organization/companies') return { data: [] }
      if (url === '/talent-candidates/page?page=0&pageSize=100') return { data: { items: [{ candidateId: 'candidate-profile', company: { id: 'company-1', name: '新知科技集团', code: 'XINZHI' }, source: 'BOSS', sourceReference: 'BOSS · source', displayName: '候选人甲', privacyStatus: 'ACTIVE', resumeCount: 1, relatedJobs: [{ id: 'job-1', title: 'Java 开发' }], createdAt: '2026-08-31T08:00:00Z', updatedAt: '2026-08-31T08:00:00Z' }], page: 0, pageSize: 100, total: 1, counts: { total: 1, withResume: 1, analyzed: 0, processing: 0, failed: 0 } } }
      if (url === '/resume-intakes/intake-profile/analysis-runs') return { data: [] }
      if (url === '/talent-candidates/candidate-profile') return { data: { candidate: { candidateId: 'candidate-profile', company: { id: 'company-1', name: '新知科技集团', code: 'XINZHI' }, source: 'BOSS', sourceReference: 'BOSS · source', displayName: '候选人甲', currentTitle: 'Java 开发工程师', skillsSummary: 'Java、Spring', privacyStatus: 'ACTIVE', resumeCount: 1, relatedJobs: [{ id: 'job-1', title: 'Java 开发' }], createdAt: '2026-08-31T08:00:00Z', updatedAt: '2026-08-31T08:00:00Z' }, contacts: [{ id: 'contact-profile', jobPositionId: 'job-1', jobTitle: 'Java 开发', bossAccountId: 'account-1', accountName: '主招聘账号', status: 'SCREENING', humanTakenOver: false }], resumes: [{ id: 'intake-profile', contactId: 'contact-profile', source: 'BOSS_VISIBLE', displayLabel: '候选人已提供附件简历', receivedAt: '2026-08-31T08:00:00Z', status: 'APPROVED_FOR_AI', processingStatus: 'READY_FOR_AI', documentType: 'PDF', analysisStatus: 'NOT_REQUESTED', analysisQueueAttempts: 0 }], analyses: [], timeline: [] } }
      return { data: [] }
    })

    const wrapper = mount(ResumeIntakesView)
    await flushPromises()
    await flushPromises()

    expect(wrapper.text()).toContain('已关联人才库')
    expect(wrapper.text()).toContain('关联岗位 1 个')
    expect(wrapper.text()).toContain('已关联简历')
    expect(wrapper.text()).toContain('候选人已提供附件简历')
    expect(wrapper.text()).toContain('技能摘要：Java、Spring')
  })

  it('scans duplicate candidates and requests a final merge preview', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/resume-intakes') return { data: [] }
      if (url === '/candidate-contacts') return { data: [] }
      if (url === '/ai-configuration/status') return { data: { ready: true, model: 'qwen-plus' } }
      if (url === '/organization/companies') return { data: [] }
      if (url === '/talent-candidates/page?page=0&pageSize=100') return { data: { items: [], page: 0, pageSize: 100, total: 0, counts: { total: 0, withResume: 0, analyzed: 0, processing: 0, failed: 0 } } }
      if (url === '/talent-candidates/duplicate-preview') return { data: {
        generatedAt: '2026-08-31T08:00:00Z', scannedCandidates: 2, duplicateGroups: 1,
        groups: [{
          groupId: 'group-1', confidence: 'HIGH', recommendation: '手机号摘要一致', suggestedPrimaryCandidateId: 'candidate-primary', reasons: ['手机号摘要一致'],
          candidates: [
            { candidateId: 'candidate-primary', source: 'BOSS', displayName: '候选人甲', companyName: '新知科技集团', resumeCount: 2, contactCount: 1, successfulAnalyses: 1, latestAnalysisStatus: 'SUCCEEDED', hasPhoneIdentity: true, hasEmailIdentity: false, createdAt: '2026-08-01T08:00:00Z', updatedAt: '2026-08-31T08:00:00Z' },
            { candidateId: 'candidate-duplicate', source: 'MANUAL', displayName: '候选人甲（外部）', companyName: '新知科技集团', resumeCount: 1, contactCount: 1, successfulAnalyses: 0, latestAnalysisStatus: 'FAILED', hasPhoneIdentity: true, hasEmailIdentity: false, createdAt: '2026-08-02T08:00:00Z', updatedAt: '2026-08-30T08:00:00Z' },
          ],
        }],
      } }
      if (url === '/talent-candidates/merge/operations?activeOnly=true') return { data: [] }
      return { data: [] }
    })
    vi.mocked(api.post).mockResolvedValue({ data: {
      primaryCandidateId: 'candidate-primary', duplicateCandidateIds: ['candidate-duplicate'], candidateCount: 2,
      contactCount: 2, resumeCount: 3, successfulAnalysisCount: 1, conversationMessageCount: 4, warnings: [],
    } })

    const wrapper = mount(ResumeIntakesView)
    await flushPromises()
    const scanButton = wrapper.findAll('button').find((button) => button.text().includes('重复档案'))
    expect(scanButton).toBeTruthy()
    await scanButton?.trigger('click')
    await flushPromises()

    const bodyText = () => document.body.textContent || ''
    expect(bodyText()).toContain('手机号摘要一致')
    expect(bodyText()).toContain('候选人甲（外部）')
    const previewButton = Array.from(document.body.querySelectorAll('.duplicate-dialog button')).find((button) => button.textContent?.includes('查看最终预览'))
    expect(previewButton).toBeTruthy()
    ;(previewButton as HTMLElement).click()
    await flushPromises()

    expect(api.post).toHaveBeenCalledWith('/talent-candidates/merge/preview', {
      primaryCandidateId: 'candidate-primary', duplicateCandidateIds: ['candidate-duplicate'],
    })
    expect(bodyText()).toContain('沟通消息')
    expect(bodyText()).toContain('未发现阻断项')
  })

  it('shows a distinct scan error instead of an empty duplicate result', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/resume-intakes') return { data: [] }
      if (url === '/candidate-contacts') return { data: [] }
      if (url === '/ai-configuration/status') return { data: { ready: true, model: 'qwen-plus' } }
      if (url === '/organization/companies') return { data: [] }
      if (url === '/talent-candidates/page?page=0&pageSize=100') return { data: { items: [], page: 0, pageSize: 100, total: 0, counts: { total: 0, withResume: 0, analyzed: 0, processing: 0, failed: 0 } } }
      if (url === '/talent-candidates/duplicate-preview') throw new Error('404')
      if (url === '/talent-candidates/merge/operations?activeOnly=true') return { data: [] }
      return { data: [] }
    })

    const wrapper = mount(ResumeIntakesView)
    await flushPromises()
    const scanButton = wrapper.findAll('button').find((button) => button.text().includes('重复档案'))
    await scanButton?.trigger('click')
    await flushPromises()

    expect(document.body.textContent || '').toContain('重复候选人扫描失败')
    expect(document.body.textContent || '').not.toContain('暂未发现重复候选人')
    wrapper.unmount()
  })
})
