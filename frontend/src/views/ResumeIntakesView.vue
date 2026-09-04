<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { Check, Cpu, Refresh, UploadFilled, Warning } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api, apiErrorMessage, ensureCsrf } from '../services/api'
import { authStore } from '../stores/auth'
import type {
  CandidateContact,
  Company,
  OpenAiConfigurationStatus,
  ResumeAnalysisFeedbackType,
  ResumeAnalysisRecommendation,
  ResumeAnalysisResult,
  ResumeAnalysisRun,
  ResumeIntake,
  ResumeIntakeStatus,
} from '../types'

type ResumeDocumentPreview = {
  documentType: string
  extractedText: string
  documentHashPrefix: string
  malwareScanned: boolean
  reviewMessage: string
}

const loading = ref(true)
const saving = ref(false)
const feedbackSaving = ref(false)
const fileSubmitting = ref(false)
const errorMessage = ref('')
const intakes = ref<ResumeIntake[]>([])
const contacts = ref<CandidateContact[]>([])
const companies = ref<Company[]>([])
const aiStatus = ref<OpenAiConfigurationStatus | null>(null)
const dialogOpen = ref(false)
const feedbackDialogOpen = ref(false)
const fileDialogOpen = ref(false)
const textDialogOpen = ref(false)
const analyzingId = ref<string>()
const selectedIntakeId = ref('')
const draggingId = ref('')
const dragOver = ref(false)
const analysisByIntake = ref<Record<string, ResumeAnalysisRun[]>>({})
const autoAnalysisDialogOpen = ref(false)
const autoAnalysisSaving = ref(false)
const autoAnalysisForm = reactive({ enabled: false, resumeProcessingAuthorized: false, candidateNoticeConfirmed: false, retentionPolicyConfirmed: false })

const form = reactive({ contactId: '', displayLabel: '候选人已提供附件简历', reference: '' })
const feedbackForm = reactive({ runId: '', feedbackType: 'ADOPTED' as ResumeAnalysisFeedbackType, note: '' })
const fileForm = reactive({ intakeId: '', file: null as File | null })
const analysisForm = reactive({ intakeId: '', resumeText: '', consent: false, source: '' })

const pending = computed(() => intakes.value.filter((item) => item.status === 'PENDING_REVIEW'))
const processing = computed(() => intakes.value.filter((item) => item.processingStatus === 'PROCESSING' || item.analysisStatus === 'ANALYZING'))
const processingFailures = computed(() => intakes.value.filter((item) => item.processingStatus === 'FAILED'))
const analysisExceptions = computed(() => intakes.value.filter((item) => item.analysisStatus !== undefined && ['FAILED', 'NOT_AUTHORIZED', 'NOT_CONFIGURED'].includes(item.analysisStatus)))
const exceptionCount = computed(() => new Set([...processingFailures.value, ...analysisExceptions.value].map((item) => item.id)).size)
const analyzed = computed(() => intakes.value.filter((item) => latestAnalysis(item.id)?.status === 'SUCCEEDED').length)
const bossIntakes = computed(() => intakes.value.filter((item) => item.source === 'BOSS_VISIBLE').length)
const selectedIntake = computed(() => intakes.value.find((item) => item.id === selectedIntakeId.value))
const selectedAnalysis = computed(() => selectedIntake.value ? latestAnalysis(selectedIntake.value.id) : undefined)
const candidateOptions = computed(() => contacts.value.filter((item) => item.privacyStatus === 'ACTIVE'))
const canConfigureAutoAnalysis = computed(() => authStore.state.user?.role === 'SYSTEM_ADMIN')
const analysisCompany = computed(() => {
  const companyId = selectedIntake.value?.companyId || intakes.value[0]?.companyId
  return companies.value.find((company) => company.id === companyId) || companies.value.find((company) => company.status === 'ACTIVE')
})

const recommendationMeta: Record<ResumeAnalysisRecommendation, { label: string; type: 'success' | 'primary' | 'warning' }> = {
  PRIORITY_VIEW: { label: '建议优先查看', type: 'success' },
  NORMAL_VIEW: { label: '建议正常查看', type: 'primary' },
  INFORMATION_NEEDED: { label: '信息不足待确认', type: 'warning' },
}

const feedbackMeta: Record<ResumeAnalysisFeedbackType, { label: string; type: 'success' | 'warning' | 'info' }> = {
  ADOPTED: { label: '作为参考采纳', type: 'success' },
  AMENDED: { label: 'HR 已修正', type: 'warning' },
  NOT_USED: { label: '本次未采用', type: 'info' },
}

function formatDate(value?: string) {
  return value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—'
}

function latestAnalysis(id: string) {
  return analysisByIntake.value[id]?.[0]
}

function processingLabel(item: ResumeIntake) {
  if (item.processingStatus === 'FAILED') return '提取失败'
  if (item.processingStatus === 'READY_FOR_AI') return `${item.documentType || '文本'} 已提取`
  if (item.processingStatus === 'PROCESSING') return '正在提取'
  return '已接收'
}

function analysisLabel(item: ResumeIntake) {
  if (item.analysisStatus === 'SUCCEEDED') return 'AI 已完成'
  if (item.analysisStatus === 'ANALYZING') return 'AI 分析中'
  if (item.analysisStatus === 'FAILED') return 'AI 失败'
  if (item.analysisStatus === 'NOT_AUTHORIZED') return '待授权'
  if (item.analysisStatus === 'NOT_CONFIGURED') return 'AI 未配置'
  return '待分析'
}

function analysisTagType(item: ResumeIntake): 'success' | 'warning' | 'danger' | 'info' {
  if (item.analysisStatus === 'SUCCEEDED') return 'success'
  if (item.analysisStatus === 'ANALYZING' || item.analysisStatus === 'NOT_CONFIGURED') return 'warning'
  if (item.analysisStatus === 'FAILED') return 'danger'
  return 'info'
}

function evidenceCoverage(result: ResumeAnalysisResult) {
  return result.evidence.length ? Math.round(result.evidence.filter(item => item.status === 'FOUND').length / result.evidence.length * 100) : 0
}

function selectIntake(id: string) {
  selectedIntakeId.value = id
}

function startDrag(event: DragEvent, item: ResumeIntake) {
  if (item.source !== 'BOSS_VISIBLE') return
  draggingId.value = item.id
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', item.id)
  }
}

function endDrag() {
  draggingId.value = ''
  dragOver.value = false
}

function dropResume(event: DragEvent) {
  const intakeId = draggingId.value || event.dataTransfer?.getData('text/plain') || ''
  const intake = intakes.value.find((item) => item.id === intakeId && item.source === 'BOSS_VISIBLE')
  dragOver.value = false
  draggingId.value = ''
  if (!intake) return
  selectedIntakeId.value = intake.id
  ElMessage.success({ message: '已放入分析工作区', duration: 1200 })
}

async function loadAnalysis(items: ResumeIntake[]) {
  const attempted = items.filter((item) => item.analysisStatus !== 'NOT_REQUESTED' || item.status === 'APPROVED_FOR_AI')
  const results = await Promise.all(attempted.map(async (item) => {
    const { data } = await api.get<ResumeAnalysisRun[]>(`/resume-intakes/${item.id}/analysis-runs`)
    return [item.id, data] as const
  }))
  analysisByIntake.value = Object.fromEntries(results)
}

async function load() {
  loading.value = true
  errorMessage.value = ''
  try {
    const [intakeResult, contactResult, aiResult, companyResult] = await Promise.all([
      api.get<ResumeIntake[]>('/resume-intakes'),
      api.get<CandidateContact[]>('/candidate-contacts'),
      api.get<OpenAiConfigurationStatus>('/ai-configuration/status'),
      api.get<Company[]>('/organization/companies'),
    ])
    intakes.value = intakeResult.data
    contacts.value = contactResult.data
    aiStatus.value = aiResult.data
    companies.value = companyResult.data
    await loadAnalysis(intakes.value)
    if (!intakes.value.some((item) => item.id === selectedIntakeId.value)) {
      selectedIntakeId.value = intakes.value.find((item) => latestAnalysis(item.id)?.status === 'SUCCEEDED')?.id
        || intakes.value.find((item) => item.source === 'BOSS_VISIBLE')?.id
        || intakes.value[0]?.id
        || ''
    }
  } catch (error) {
    errorMessage.value = apiErrorMessage(error, '简历分析暂时无法加载')
  } finally {
    loading.value = false
  }
}

function openAutoAnalysisAuthorization() {
  if (!analysisCompany.value) {
    ElMessage.warning('当前没有可用公司')
    return
  }
  Object.assign(autoAnalysisForm, {
    enabled: analysisCompany.value.aiAutoAnalysisEnabled,
    resumeProcessingAuthorized: false,
    candidateNoticeConfirmed: false,
    retentionPolicyConfirmed: false,
  })
  autoAnalysisDialogOpen.value = true
}

async function saveAutoAnalysisAuthorization() {
  const company = analysisCompany.value
  if (!company) return
  if (autoAnalysisForm.enabled && (!autoAnalysisForm.resumeProcessingAuthorized || !autoAnalysisForm.candidateNoticeConfirmed || !autoAnalysisForm.retentionPolicyConfirmed)) {
    ElMessage.warning('开启自动分析前请完成三项合规确认')
    return
  }
  autoAnalysisSaving.value = true
  try {
    await ensureCsrf()
    await api.put(`/organization/companies/${company.id}/ai-auto-analysis`, {
      enabled: autoAnalysisForm.enabled,
      resumeProcessingAuthorized: autoAnalysisForm.enabled && autoAnalysisForm.resumeProcessingAuthorized,
      candidateNoticeConfirmed: autoAnalysisForm.enabled && autoAnalysisForm.candidateNoticeConfirmed,
      retentionPolicyConfirmed: autoAnalysisForm.enabled && autoAnalysisForm.retentionPolicyConfirmed,
    })
    autoAnalysisDialogOpen.value = false
    ElMessage.success(autoAnalysisForm.enabled ? 'BOSS 新收到的安全简历将自动进入 AI 分析' : '简历自动分析已关闭')
    await load()
  } catch (error) {
    ElMessage.error(apiErrorMessage(error, '自动分析授权保存失败'))
  } finally {
    autoAnalysisSaving.value = false
  }
}

function openCreate() {
  form.contactId = candidateOptions.value[0]?.id || ''
  form.displayLabel = '候选人已提供附件简历'
  form.reference = ''
  dialogOpen.value = true
}

async function save() {
  if (!form.contactId) {
    ElMessage.warning('请选择候选人和岗位')
    return
  }
  if (!form.reference.trim()) {
    ElMessage.warning('请填写仅供生成摘要的内部参考值')
    return
  }
  saving.value = true
  try {
    await ensureCsrf()
    await api.post(`/candidate-contacts/${form.contactId}/resume-intakes`, { reference: form.reference, displayLabel: form.displayLabel })
    ElMessage.success('简历事件已登记，等待 HR 审核')
    dialogOpen.value = false
    await load()
  } catch (error) {
    ElMessage.error(apiErrorMessage(error, '简历登记失败'))
  } finally {
    saving.value = false
  }
}

async function review(item: ResumeIntake, decision: Extract<ResumeIntakeStatus, 'APPROVED_FOR_AI' | 'REJECTED'>) {
  try {
    const title = decision === 'APPROVED_FOR_AI' ? '授权进入 AI 分析' : '拒绝简历登记'
    const text = decision === 'APPROVED_FOR_AI'
      ? '请先核对简历来源。授权后，每次分析仍需明确确认向 AI 服务发送本次文本。'
      : '该登记将不会进入后续 AI 分析。'
    const result = await ElMessageBox.prompt(text, title, {
      inputPlaceholder: '可选审核备注',
      confirmButtonText: decision === 'APPROVED_FOR_AI' ? '确认授权' : '确认拒绝',
      cancelButtonText: '取消',
      type: decision === 'APPROVED_FOR_AI' ? 'success' : 'warning',
    })
    await ensureCsrf()
    await api.put(`/resume-intakes/${item.id}/review`, { decision, note: result.value || null })
    ElMessage.success(decision === 'APPROVED_FOR_AI' ? '已授权，可在需要时提交 AI 分析' : '已拒绝该登记')
    await load()
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(apiErrorMessage(error, '审核失败'))
  }
}

function openTextAnalysis(item: ResumeIntake, text = '', source = '手工粘贴的已审核简历文本') {
  analysisForm.intakeId = item.id
  analysisForm.resumeText = text
  analysisForm.consent = false
  analysisForm.source = source
  textDialogOpen.value = true
}

async function submitTextAnalysis() {
  if (!aiStatus.value?.ready) {
    ElMessage.warning('请先由系统管理员完成 AI 服务端配置')
    return
  }
  if (!analysisForm.resumeText.trim()) {
    ElMessage.warning('请核对并保留本次分析所需的简历文本')
    return
  }
  if (!analysisForm.consent) {
    ElMessage.warning('请确认可将已审核文本发送给 AI 服务')
    return
  }
  analyzingId.value = analysisForm.intakeId
  try {
    await ensureCsrf()
    await api.post(`/resume-intakes/${analysisForm.intakeId}/analysis`, {
      resumeText: analysisForm.resumeText,
      externalProcessingConfirmed: true,
    }, { timeout: 105_000 })
    ElMessage.success('AI 分析已完成，请结合原简历由 HR 做最终判断')
    textDialogOpen.value = false
    await loadAnalysis(intakes.value)
  } catch (error) {
    ElMessage.error(apiErrorMessage(error, 'AI 分析未完成'))
  } finally {
    analyzingId.value = undefined
  }
}

function openFileAnalysis(item: ResumeIntake) {
  fileForm.intakeId = item.id
  fileForm.file = null
  fileDialogOpen.value = true
}

function selectDocument(file: { raw?: File }) {
  fileForm.file = file.raw || null
}

async function previewFile() {
  if (!fileForm.file) {
    ElMessage.warning('请选择 PDF、DOCX、PNG 或 JPG 简历')
    return
  }
  fileSubmitting.value = true
  try {
    const payload = new FormData()
    payload.append('file', fileForm.file)
    await ensureCsrf()
    const { data } = await api.post<ResumeDocumentPreview>(`/resume-intakes/${fileForm.intakeId}/document-preview`, payload, { timeout: 75_000 })
    fileDialogOpen.value = false
    const item = intakes.value.find((value) => value.id === fileForm.intakeId)
    if (item) openTextAnalysis(item, data.extractedText, `${data.documentType} 本机提取 · 摘要 ${data.documentHashPrefix}`)
    ElMessage.success('已提取文本，请先由 HR 核对和修正')
  } catch (error) {
    ElMessage.error(apiErrorMessage(error, '简历文本提取未完成'))
  } finally {
    fileSubmitting.value = false
  }
}

function openFeedback(run: ResumeAnalysisRun) {
  feedbackForm.runId = run.id
  feedbackForm.feedbackType = 'ADOPTED'
  feedbackForm.note = ''
  feedbackDialogOpen.value = true
}

async function saveFeedback() {
  if (!feedbackForm.note.trim()) {
    ElMessage.warning('请填写 HR 复核说明')
    return
  }
  feedbackSaving.value = true
  try {
    await ensureCsrf()
    await api.post(`/resume-analysis-runs/${feedbackForm.runId}/feedback`, {
      feedbackType: feedbackForm.feedbackType,
      note: feedbackForm.note,
    })
    ElMessage.success('HR 复核已追加到该次分析记录')
    feedbackDialogOpen.value = false
    await loadAnalysis(intakes.value)
  } catch (error) {
    ElMessage.error(apiErrorMessage(error, 'HR 复核保存失败'))
  } finally {
    feedbackSaving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="page-shell resume-page">
    <header class="page-heading">
      <div>
        <span class="page-kicker">简历处理与人工复核</span>
        <h1>候选人决策面板</h1>
        <p>从简历接收到 AI 辅助结论，在同一工作区完成核对与复核。</p>
      </div>
      <div class="heading-actions">
        <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
        <el-button type="primary" :icon="UploadFilled" @click="openCreate">人工补录</el-button>
      </div>
    </header>
    <div class="sr-only" aria-live="polite" aria-atomic="true">当前 {{ pending.length }} 份简历待 HR 处理，{{ processing.length }} 份分析中，{{ exceptionCount }} 份需要关注。</div>

    <div v-if="loading" class="surface-panel skeleton"><el-skeleton :rows="7" animated /></div>
    <div v-else-if="errorMessage" class="surface-panel error">
      <el-icon><Warning /></el-icon>
      <strong>简历分析暂时无法加载</strong>
      <span>{{ errorMessage }}</span>
      <el-button @click="load">重试</el-button>
    </div>

    <template v-else>
      <section class="metrics analysis-pipeline" aria-label="简历处理流程概览">
        <article class="static-card card-indicator metric-card metric-card--teal"><el-icon><UploadFilled /></el-icon><div><span>BOSS 已接收</span><strong>{{ bossIntakes }}</strong><small>可拖入右侧分析区</small></div></article>
        <article class="static-card card-indicator metric-card metric-card--blue"><el-icon><Check /></el-icon><div><span>待 HR 处理</span><strong>{{ pending.length }}</strong><small>待复核或待授权</small></div></article>
        <article class="static-card card-indicator metric-card metric-card--violet"><el-icon><Cpu /></el-icon><div><span>分析处理中</span><strong>{{ processing.length }}</strong><small>提取与 AI 任务</small></div></article>
        <article class="static-card card-indicator metric-card" :class="[exceptionCount ? 'metric-card--red' : 'metric-card--green', { 'metric-card--active': !exceptionCount && analyzed > 0 }]">
          <el-icon><Warning v-if="exceptionCount" /><Check v-else /></el-icon><div><span>{{ exceptionCount ? '需要关注' : '已完成分析' }}</span><strong>{{ exceptionCount || analyzed }}</strong><small>{{ exceptionCount ? '提取或分析异常' : '等待 HR 复核' }}</small></div>
        </article>
      </section>

      <div v-if="!intakes.length" class="surface-panel empty-state"><el-empty :image-size="82" description="尚未收到简历" /></div>

      <section v-else class="analysis-workspace">
        <aside class="surface-panel section-card card-panel resume-queue-panel">
          <div class="section-title-row queue-heading"><div><span class="section-kicker">待选择</span><h2>简历队列</h2><p>{{ intakes.length }} 份简历 · BOSS 简历可拖拽</p></div></div>
          <div class="ai-service-inline" :class="{ 'ai-service-inline--ready': aiStatus?.ready }" aria-label="AI 分析服务状态">
            <span class="ai-service-inline__mark"><el-icon><Cpu /></el-icon></span>
            <div>
              <strong>{{ aiStatus?.ready ? 'AI 分析服务可用' : 'AI 分析服务未就绪' }}</strong>
              <small>{{ analysisCompany?.aiAutoAnalysisEnabled ? `${aiStatus?.model || 'AI'} · BOSS 简历自动分析已授权` : aiStatus?.ready ? `${aiStatus.model} · 手工分析可用` : '未授权的简历不会被提交分析' }}</small>
            </div>
            <div class="ai-service-inline__actions">
              <el-tag :type="analysisCompany?.aiAutoAnalysisEnabled ? 'success' : 'info'">{{ analysisCompany?.aiAutoAnalysisEnabled ? '自动分析已开启' : '自动分析已关闭' }}</el-tag>
              <el-button v-if="canConfigureAutoAnalysis" link type="primary" @click="openAutoAnalysisAuthorization">授权设置</el-button>
            </div>
          </div>
          <div class="resume-queue">
            <article
              v-for="item in intakes"
              :key="item.id"
              class="entity-card card-entity resume-ticket"
              :class="{
                'resume-ticket--selected': selectedIntakeId === item.id,
                'resume-ticket--dragging': draggingId === item.id,
                'resume-ticket--boss': item.source === 'BOSS_VISIBLE',
              }"
              :draggable="item.source === 'BOSS_VISIBLE'"
              role="button"
              tabindex="0"
              :aria-label="`查看 ${item.candidateName} 的简历分析`"
              @click="selectIntake(item.id)"
              @keydown.enter="selectIntake(item.id)"
              @keydown.space.prevent="selectIntake(item.id)"
              @dragstart="startDrag($event, item)"
              @dragend="endDrag"
            >
              <div class="ticket-topline">
                <span class="source-badge" :class="item.source === 'BOSS_VISIBLE' ? 'source-badge--boss' : 'source-badge--manual'">
                  {{ item.source === 'BOSS_VISIBLE' ? 'BOSS 收到' : '人工补录' }}
                </span>
                <span v-if="item.source === 'BOSS_VISIBLE'" class="drag-hint">拖到右侧 ···</span>
              </div>
              <div class="ticket-person">
                <div class="candidate-avatar">{{ item.candidateName.slice(0, 1) }}</div>
                <div><strong>{{ item.candidateName }}</strong><span>{{ item.jobTitle }}</span></div>
              </div>
              <div class="ticket-tags">
                <el-tag size="small" :type="item.processingStatus === 'FAILED' ? 'danger' : item.processingStatus === 'READY_FOR_AI' ? 'success' : 'info'">{{ processingLabel(item) }}</el-tag>
                <el-tag size="small" :type="analysisTagType(item)">{{ analysisLabel(item) }}</el-tag>
              </div>
              <footer><span>{{ item.accountName }}</span><time>{{ formatDate(item.receivedAt) }}</time></footer>
            </article>
          </div>
        </aside>

        <main
          class="surface-panel section-card card-panel analysis-board"
          :class="{ 'analysis-board--dragover': dragOver }"
          @dragenter.prevent="dragOver = true"
          @dragover.prevent="dragOver = true"
          @dragleave.self="dragOver = false"
          @drop.prevent="dropResume"
        >
          <div class="analysis-dropzone" :class="{ 'analysis-dropzone--active': dragOver }">
            <div>
              <strong>{{ dragOver ? '松开即可放入分析工作区' : '简历分析工作区' }}</strong>
              <small>拖拽只会切换当前简历，不会自动向 AI 发送数据</small>
            </div>
            <el-tag v-if="selectedIntake" type="success" effect="light">已选择 1 份</el-tag>
          </div>

          <div v-if="!selectedIntake" class="board-empty">
            <div class="board-empty__icon"><Cpu /></div>
            <h2>把 BOSS 简历拖到这里</h2>
            <p>也可以直接点击左侧卡片，在这里查看处理状态和分析结果。</p>
          </div>

          <template v-else>
            <header class="candidate-header">
              <div class="candidate-avatar candidate-avatar--large">{{ selectedIntake.candidateName.slice(0, 1) }}</div>
              <div class="candidate-title">
                <span>{{ selectedIntake.source === 'BOSS_VISIBLE' ? 'BOSS 简历' : '人工补录' }}</span>
                <h2>{{ selectedIntake.candidateName }}</h2>
                <p>{{ selectedIntake.jobTitle }} · {{ selectedIntake.accountName }}</p>
              </div>
              <div class="candidate-status">
                <el-tag :type="selectedIntake.processingStatus === 'FAILED' ? 'danger' : selectedIntake.processingStatus === 'READY_FOR_AI' ? 'success' : 'info'">{{ processingLabel(selectedIntake) }}</el-tag>
                <el-tag :type="analysisTagType(selectedIntake)">{{ analysisLabel(selectedIntake) }}</el-tag>
              </div>
            </header>

            <div v-if="selectedIntake.processingStatus === 'FAILED' || selectedIntake.analysisFailureCode" class="decision-card decision-card--danger card-emphasis card-emphasis--danger status-alert status-alert--danger">
              <strong>此简历需要处理</strong>
              <span v-if="selectedIntake.processingStatus === 'FAILED'">{{ selectedIntake.failureCode }} · {{ selectedIntake.failureReason }}</span>
              <span v-if="selectedIntake.analysisFailureCode">{{ selectedIntake.analysisFailureCode }} · {{ selectedIntake.analysisFailureReason }}</span>
            </div>

            <section v-if="selectedAnalysis?.resultPurgedAt" class="analysis-content">
              <el-alert type="info" :closable="false" title="AI 分析内容已按保留策略清除" :description="`已于 ${formatDate(selectedAnalysis.resultPurgedAt)} 清除结构化结果与 HR 复核内容；输入摘要和审计记录仍保留。`" />
            </section>

            <section v-else-if="selectedAnalysis?.status === 'SUCCEEDED' && selectedAnalysis.result" class="analysis-content">
              <div class="decision-card decision-card--success card-emphasis card-emphasis--success recommendation-card">
                <div><span>AI 辅助结论</span><h3>{{ recommendationMeta[selectedAnalysis.result.recommendation].label }}</h3></div>
                <div class="evidence-coverage"><span>证据覆盖度 {{ evidenceCoverage(selectedAnalysis.result) }}%</span><el-progress :percentage="evidenceCoverage(selectedAnalysis.result)" :show-text="false" :stroke-width="7" /></div>
                <el-tag :type="recommendationMeta[selectedAnalysis.result.recommendation].type" effect="dark">{{ recommendationMeta[selectedAnalysis.result.recommendation].label }}</el-tag>
              </div>
              <div class="summary-card">
                <span>分析摘要</span>
                <p>{{ selectedAnalysis.result.summary }}</p>
                <div v-if="selectedAnalysis.result.gaps.length || selectedAnalysis.result.risks.length" class="summary-flags">
                  <span v-for="gap in selectedAnalysis.result.gaps" :key="`gap-${gap}`" class="flag flag--warning">待确认 · {{ gap }}</span>
                  <span v-for="risk in selectedAnalysis.result.risks" :key="`risk-${risk}`" class="flag flag--danger">关注 · {{ risk }}</span>
                </div>
              </div>
              <div class="insight-grid">
                <article class="insight-card">
                  <header><span>匹配证据</span><strong>{{ selectedAnalysis.result.evidence.length }}</strong></header>
                  <ul>
                    <li v-for="evidence in selectedAnalysis.result.evidence" :key="`${evidence.criterion}-${evidence.finding}`">
                      <div><strong>{{ evidence.criterion }}</strong><p>{{ evidence.finding }}</p></div>
                      <el-tag size="small" :type="evidence.status === 'FOUND' ? 'success' : evidence.status === 'NOT_FOUND' ? 'danger' : 'info'">{{ evidence.status === 'FOUND' ? '已发现' : evidence.status === 'NOT_FOUND' ? '未发现' : '待确认' }}</el-tag>
                    </li>
                  </ul>
                </article>
                <article class="insight-card insight-card--questions">
                  <header><span>建议追问</span><strong>{{ selectedAnalysis.result.followUpQuestions.length }}</strong></header>
                  <ol><li v-for="question in selectedAnalysis.result.followUpQuestions" :key="question">{{ question }}</li></ol>
                </article>
              </div>
              <div class="feedback-section">
                <div class="feedback-heading"><div><h3>HR 复核</h3><p>AI 结论仅供参考，最终判断由 HR 作出。</p></div></div>
                <p v-if="!selectedAnalysis.feedback.length" class="feedback-empty">尚未添加复核记录</p>
                <article v-for="entry in selectedAnalysis.feedback" :key="entry.id" class="feedback-item">
                  <el-tag size="small" :type="feedbackMeta[entry.feedbackType].type">{{ feedbackMeta[entry.feedbackType].label }}</el-tag>
                  <span>{{ entry.note }}</span>
                  <small>{{ entry.createdBy }} · {{ formatDate(entry.createdAt) }}</small>
                </article>
              </div>
              <small class="analysis-footnote">
                {{ selectedAnalysis.provider }} · {{ selectedAnalysis.modelVersion }} · {{ formatDate(selectedAnalysis.createdAt) }}
                <template v-if="selectedAnalysis.resultExpiresAt"> · 预计清除 {{ formatDate(selectedAnalysis.resultExpiresAt) }}</template>
              </small>
            </section>

            <section v-else-if="selectedAnalysis?.status === 'FAILED'" class="analysis-content">
              <div class="board-empty board-empty--compact">
                <div class="board-empty__icon board-empty__icon--danger"><Warning /></div>
                <h2>最近一次分析未完成</h2>
                <p>{{ selectedAnalysis.errorMessage || '请检查 AI 服务配置后再试。' }}</p>
              </div>
            </section>

            <section v-else class="analysis-content">
              <div class="board-empty board-empty--compact">
                <div class="board-empty__icon"><Cpu /></div>
                <h2>{{ selectedIntake.status === 'PENDING_REVIEW' ? '等待 HR 核对来源' : '尚未生成分析结果' }}</h2>
                <p v-if="selectedIntake.status === 'PENDING_REVIEW'">先确认简历来源，再选择文件或文本进入分析。</p>
                <p v-else>可上传简历文件自动提取，或粘贴已核对的必要文本。</p>
              </div>
            </section>

            <footer class="intake-details">
              <span>{{ selectedIntake.displayLabel }}</span>
              <span>摘要 {{ selectedIntake.anonymousKey }}</span>
              <span>接收于 {{ formatDate(selectedIntake.receivedAt) }}</span>
            </footer>
            <footer class="analysis-actionbar" aria-label="当前简历操作">
              <div><strong>当前处理</strong><span>{{ selectedIntake.candidateName }} · {{ analysisLabel(selectedIntake) }}</span></div>
              <div class="analysis-actionbar__buttons">
                <template v-if="selectedIntake.status === 'PENDING_REVIEW'">
                  <el-button @click="review(selectedIntake, 'REJECTED')">拒绝登记</el-button>
                  <el-button :icon="Check" type="primary" @click="review(selectedIntake, 'APPROVED_FOR_AI')">确认来源</el-button>
                </template>
                <template v-else-if="selectedAnalysis?.status === 'SUCCEEDED'">
                  <el-button :loading="analyzingId === selectedIntake.id" @click="openFileAnalysis(selectedIntake)">重新分析</el-button>
                  <el-button v-if="selectedAnalysis" type="primary" @click="openFeedback(selectedAnalysis)">记录 HR 复核</el-button>
                </template>
                <template v-else-if="selectedIntake.status === 'APPROVED_FOR_AI'">
                  <el-button :icon="Cpu" :loading="analyzingId === selectedIntake.id" @click="openTextAnalysis(selectedIntake)">粘贴文本</el-button>
                  <el-button type="primary" @click="openFileAnalysis(selectedIntake)">{{ selectedAnalysis?.status === 'FAILED' ? '上传文件重试' : '上传文件分析' }}</el-button>
                </template>
              </div>
            </footer>
          </template>
        </main>
      </section>
    </template>

    <el-dialog v-model="dialogOpen" title="登记简历事件" width="560px">
      <el-alert type="info" :closable="false" title="这里只登记候选人已提供简历的事件；简历原文仅会在 HR 后续主动提交分析时处理。" />
      <el-form label-position="top" class="intake-form">
        <el-form-item label="候选人和岗位" required>
          <el-select v-model="form.contactId" filterable placeholder="选择内部候选人记录">
            <el-option v-for="item in candidateOptions" :key="item.id" :value="item.id" :label="`${item.displayName} · ${item.jobPosition.title}`" />
          </el-select>
        </el-form-item>
        <el-form-item label="简历标签" required>
          <el-select v-model="form.displayLabel">
            <el-option label="候选人已提供附件简历" value="候选人已提供附件简历" />
            <el-option label="候选人已提供在线简历" value="候选人已提供在线简历" />
            <el-option label="HR 已人工收到简历" value="HR 已人工收到简历" />
          </el-select>
        </el-form-item>
        <el-form-item label="内部参考值" required>
          <el-input v-model="form.reference" maxlength="120" placeholder="例如：2026-08-30-附件-01" />
          <small>仅用于生成 SHA-256 摘要；系统不会保存该原文。</small>
        </el-form-item>
      </el-form>
      <template #footer><el-button @click="dialogOpen = false">取消</el-button><el-button type="primary" :loading="saving" @click="save">确认登记</el-button></template>
    </el-dialog>

    <el-dialog v-model="autoAnalysisDialogOpen" title="BOSS 简历自动分析" width="560px">
      <el-form label-position="top" class="intake-form">
        <el-form-item label="自动分析">
          <el-switch v-model="autoAnalysisForm.enabled" inline-prompt active-text="开" inactive-text="关" />
        </el-form-item>
        <div v-if="autoAnalysisForm.enabled" class="authorization-checks">
          <el-checkbox v-model="autoAnalysisForm.resumeProcessingAuthorized">已确认公司有权处理收到的求职简历</el-checkbox>
          <el-checkbox v-model="autoAnalysisForm.candidateNoticeConfirmed">已确认候选人告知与隐私要求</el-checkbox>
          <el-checkbox v-model="autoAnalysisForm.retentionPolicyConfirmed">已确认结果保留和到期清理策略</el-checkbox>
        </div>
      </el-form>
      <template #footer><el-button @click="autoAnalysisDialogOpen = false">取消</el-button><el-button type="primary" :loading="autoAnalysisSaving" @click="saveAutoAnalysisAuthorization">保存</el-button></template>
    </el-dialog>

    <el-dialog v-model="feedbackDialogOpen" title="记录 HR 复核" width="520px">
      <el-alert type="info" :closable="false" title="复核不会自动改变候选人状态，也不会发送招聘消息。" />
      <el-form label-position="top" class="intake-form">
        <el-form-item label="复核结论" required>
          <el-radio-group v-model="feedbackForm.feedbackType">
            <el-radio-button label="ADOPTED">作为参考采纳</el-radio-button>
            <el-radio-button label="AMENDED">HR 已修正</el-radio-button>
            <el-radio-button label="NOT_USED">本次未采用</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="HR 复核说明" required><el-input v-model="feedbackForm.note" type="textarea" :rows="4" maxlength="1000" show-word-limit placeholder="例如：需在电话沟通中确认实际职责" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="feedbackDialogOpen = false">取消</el-button><el-button type="primary" :loading="feedbackSaving" @click="saveFeedback">保存复核</el-button></template>
    </el-dialog>

    <el-dialog v-model="fileDialogOpen" title="提取简历文本" width="560px">
      <el-alert type="warning" :closable="false" title="文件仅在本机临时处理。支持 PDF、DOCX、PNG、JPG/JPEG（最大 8MB），提取后不会自动发送给 AI。" />
      <el-form label-position="top" class="intake-form">
        <el-form-item label="已审核的简历文件" required>
          <el-upload accept=".pdf,.docx,.png,.jpg,.jpeg,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg" :auto-upload="false" :limit="1" :on-change="selectDocument">
            <el-button>选择简历文件</el-button>
            <template #tip><div class="el-upload__tip">扫描件会进入 OCR，并由 HR 核对提取结果。</div></template>
          </el-upload>
        </el-form-item>
      </el-form>
      <template #footer><el-button @click="fileDialogOpen = false">取消</el-button><el-button type="primary" :loading="fileSubmitting" @click="previewFile">提取文本并核对</el-button></template>
    </el-dialog>

    <el-dialog v-model="textDialogOpen" title="核对文本并提交 AI 分析" width="680px">
      <el-alert type="warning" :closable="false" title="只有点击确认后，当前文本才会发送给 AI 服务；AI 不会自动淘汰、录用或发送消息。" />
      <el-form label-position="top" class="intake-form">
        <el-form-item label="文本来源"><el-tag type="info">{{ analysisForm.source }}</el-tag></el-form-item>
        <el-form-item label="HR 已核对的必要文本" required><el-input v-model="analysisForm.resumeText" type="textarea" :rows="12" maxlength="30000" show-word-limit placeholder="核对提取内容，删除与岗位判断无关的敏感信息后再提交" /></el-form-item>
        <el-form-item><el-checkbox v-model="analysisForm.consent">我已核对上述文本，并确认可将必要内容发送给 AI 服务用于本次招聘辅助分析。</el-checkbox></el-form-item>
      </el-form>
      <template #footer><el-button @click="textDialogOpen = false">暂不提交</el-button><el-button type="primary" :loading="analyzingId === analysisForm.intakeId" @click="submitTextAnalysis">确认并发送给 AI</el-button></template>
    </el-dialog>
  </div>
</template>

<style scoped>
.resume-page { width: min(100%, 1480px); }
.page-kicker, .section-kicker { display: block; color: var(--color-primary); font-size: 10px; font-weight: 760; letter-spacing: .055em; }
.resume-page .page-heading h1 { margin-top: 6px; }
.heading-actions { display: flex; flex-wrap: wrap; gap: 10px; }
.skeleton, .error { margin-top: 20px; }
.skeleton { padding: 26px; }
.error { display: grid; justify-items: center; gap: 10px; padding: 48px; color: var(--text-secondary); }
.error svg { font-size: 28px; color: var(--danger); }
.metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-bottom: 18px; }
.metric-card { position: relative; min-width: 0; overflow: hidden; padding: 18px 20px; border: 1px solid var(--border); border-radius: 16px; background: linear-gradient(145deg, #fff 35%, #f8fbfa 100%); box-shadow: var(--shadow-sm); transition: transform .18s ease, border-color .18s ease, box-shadow .18s ease; }
.metric-card::after { position: absolute; top: -24px; right: -20px; width: 76px; height: 76px; border-radius: 50%; background: var(--metric-accent, #d9eeeb); content: ''; opacity: .52; }
.metric-card:hover { transform: translateY(-2px); border-color: var(--border-strong); box-shadow: var(--shadow-card-hover); }
.metric-card--teal { --metric-accent: #b9eee7; }
.metric-card--blue { --metric-accent: #cde4ff; }
.metric-card--violet { --metric-accent: #e2d8ff; }
.metric-card--green { --metric-accent: #ccefdc; }
.metric-card--red { --metric-accent: #ffd8d4; }
.metric-card span, .metric-card small { position: relative; z-index: 1; display: block; color: var(--text-secondary); font-size: 12px; }
.metric-card strong { position: relative; z-index: 1; display: block; margin: 7px 0 4px; font-size: 29px; line-height: 1; }
.analysis-workspace { display: grid; grid-template-columns: minmax(300px, 370px) minmax(0, 1fr); gap: 18px; align-items: start; }
.analysis-workspace > * { min-width: 0; }
.resume-queue-panel, .analysis-board { overflow: hidden; }
.queue-heading { padding: 18px 20px; }
.ai-service-inline { display: flex; align-items: center; gap: 11px; margin: 14px 14px 0; padding: 12px; border: 1px solid #e6ecea; border-radius: 12px; background: #f7f9f8; }
.ai-service-inline > div { min-width: 0; margin-right: auto; }
.ai-service-inline--ready { border-color: #c7e8df; background: linear-gradient(115deg, #effbf7, #f7fbfa); }
.ai-service-inline__mark { display: grid; width: 32px; height: 32px; flex: 0 0 auto; place-items: center; border-radius: 10px; background: #e9efed; color: #63736f; }
.ai-service-inline--ready .ai-service-inline__mark { background: #d6f5ec; color: var(--success); }
.ai-service-inline strong, .ai-service-inline small { display: block; }
.ai-service-inline strong { font-size: 12px; }
.ai-service-inline small { margin-top: 3px; color: var(--text-secondary); font-size: 11px; line-height: 1.4; }
.ai-service-inline__actions { display: flex; flex: 0 0 auto; align-items: center; gap: 6px; }
.authorization-checks { display: grid; gap: 12px; padding: 14px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface-muted); }
.authorization-checks .el-checkbox { height: auto; margin: 0; white-space: normal; }
.resume-queue { display: grid; gap: 11px; max-height: 760px; overflow: auto; padding: 14px; background: #f7faf9; scrollbar-width: thin; }
.resume-ticket { min-width: 0; padding: 15px; border: 1px solid #e2e9e7; border-radius: 14px; background: #fff; box-shadow: 0 2px 10px rgba(16,48,43,.035); cursor: pointer; transition: transform .18s ease, border-color .18s ease, box-shadow .18s ease, opacity .18s ease; }
.resume-ticket--boss { cursor: grab; }
.resume-ticket:hover, .resume-ticket--selected { transform: translateY(-2px); border-color: #7cc4bd; box-shadow: 0 12px 28px rgba(15,118,110,.12); }
.resume-ticket--selected { background: linear-gradient(145deg, #fff 40%, #effaf8 100%); box-shadow: inset 3px 0 0 var(--primary), 0 12px 28px rgba(15,118,110,.1); }
.resume-ticket--dragging { opacity: .5; cursor: grabbing; }
.ticket-topline, .ticket-person, .ticket-tags, .resume-ticket footer, .candidate-header, .candidate-status, .recommendation-card, .insight-card header, .feedback-heading { display: flex; align-items: center; }
.ticket-topline, .resume-ticket footer, .recommendation-card, .insight-card header, .feedback-heading { justify-content: space-between; }
.source-badge { display: inline-flex; align-items: center; min-height: 24px; padding: 0 9px; border-radius: 999px; font-size: 11px; font-weight: 750; }
.source-badge--boss { background: #d9f5ef; color: #08776d; }
.source-badge--manual { background: #eef1f4; color: #5d6876; }
.drag-hint { color: #83938f; font-size: 11px; }
.ticket-person { min-width: 0; gap: 11px; margin: 14px 0; }
.candidate-avatar { display: grid; flex: 0 0 auto; width: 38px; height: 38px; place-items: center; border-radius: 12px; background: linear-gradient(145deg, #d5f4ef, #b8e9e1); color: var(--brand-900); font-weight: 800; }
.candidate-avatar--large { width: 54px; height: 54px; border-radius: 16px; font-size: 20px; }
.ticket-person > div:last-child, .candidate-title { min-width: 0; }
.ticket-person strong, .ticket-person span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ticket-person strong { margin-bottom: 4px; font-size: 15px; }
.ticket-person span, .resume-ticket footer { color: var(--text-secondary); font-size: 12px; }
.ticket-tags, .candidate-status { flex-wrap: wrap; gap: 6px; }
.resume-ticket footer { gap: 10px; margin-top: 13px; padding-top: 12px; border-top: 1px solid #edf1f0; }
.resume-ticket footer span, .resume-ticket footer time { min-width: 0; overflow-wrap: anywhere; }
.resume-ticket footer time { text-align: right; }
.analysis-board { min-height: 640px; transition: border-color .18s ease, box-shadow .18s ease; }
.analysis-board--dragover { border-color: var(--primary); box-shadow: 0 0 0 4px rgba(15,118,110,.12), var(--shadow-md); }
.analysis-dropzone { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 86px; padding: 18px 22px; border-bottom: 1px dashed #c9dcd8; background: linear-gradient(110deg, #f1fbf9, #f8fbff); transition: background .18s ease; }
.analysis-dropzone--active { background: linear-gradient(110deg, #dff8f3, #eef7ff); }
.analysis-dropzone > div { min-width: 0; }
.analysis-dropzone strong, .analysis-dropzone small { display: block; }
.analysis-dropzone strong { font-size: 16px; }
.analysis-dropzone small { margin-top: 4px; color: var(--text-secondary); font-size: 12px; line-height: 1.5; }
.board-empty { display: grid; justify-items: center; align-content: center; min-height: 520px; padding: 42px; text-align: center; }
.board-empty--compact { min-height: 360px; }
.board-empty__icon { display: grid; width: 58px; height: 58px; place-items: center; border-radius: 18px; background: #e4f7f3; color: var(--primary); font-size: 26px; }
.board-empty__icon--danger { background: #fff0ee; color: var(--danger); }
.board-empty h2 { margin: 17px 0 7px; font-size: 20px; }
.board-empty p { max-width: 460px; margin: 0; color: var(--text-secondary); line-height: 1.7; }
.empty-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 9px; margin-top: 20px; }
.candidate-header { align-items: flex-start; gap: 14px; padding: 22px; border-bottom: 1px solid var(--border); }
.candidate-title { flex: 1; }
.candidate-title > span { color: var(--primary); font-size: 11px; font-weight: 800; }
.candidate-title h2 { margin: 4px 0 3px; font-size: 21px; }
.candidate-title p { margin: 0; color: var(--text-secondary); line-height: 1.5; overflow-wrap: anywhere; }
.candidate-status { justify-content: flex-end; }
.status-alert { display: grid; gap: 4px; margin: 18px 22px 0; padding: 13px 15px; border-radius: 12px; font-size: 13px; }
.status-alert--danger { border: 1px solid #ffd3cf; background: #fff4f2; color: #8f221a; }
.analysis-content { display: grid; gap: 16px; padding: 22px; }
.recommendation-card { gap: 14px; padding: 18px 20px; border: 1px solid #bfe7df; border-radius: 15px; background: linear-gradient(120deg, #ecfaf7, #f7fbff); }
.recommendation-card span, .summary-card > span { color: var(--text-secondary); font-size: 12px; font-weight: 700; }
.recommendation-card h3 { margin: 5px 0 0; font-size: 21px; }
.summary-card, .insight-card, .feedback-section { min-width: 0; border: 1px solid #e1e9e7; border-radius: 15px; background: #fff; }
.summary-card { padding: 18px 20px; }
.summary-card p { margin: 8px 0 0; line-height: 1.75; overflow-wrap: anywhere; }
.summary-flags { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 13px; }
.flag { display: inline-flex; max-width: 100%; padding: 6px 9px; border-radius: 8px; font-size: 12px; overflow-wrap: anywhere; }
.flag--warning { background: #fff7e8; color: #975a16; }
.flag--danger { background: #fff0ee; color: #a03329; }
.insight-grid { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, .8fr); gap: 14px; }
.insight-card { overflow: hidden; }
.insight-card header { gap: 12px; padding: 14px 16px; border-bottom: 1px solid #e9efed; background: #f8faf9; }
.insight-card header span { font-weight: 750; }
.insight-card header strong { display: grid; width: 27px; height: 27px; place-items: center; border-radius: 9px; background: #e1f3ef; color: var(--primary); font-size: 12px; }
.insight-card ul, .insight-card ol { display: grid; gap: 0; margin: 0; padding: 0; list-style: none; }
.insight-card li { min-width: 0; padding: 13px 16px; border-bottom: 1px solid #eef2f1; color: var(--text-secondary); font-size: 12px; line-height: 1.55; }
.insight-card li:last-child { border-bottom: 0; }
.insight-card:not(.insight-card--questions) li { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.insight-card li > div { min-width: 0; }
.insight-card li strong { color: var(--text); }
.insight-card li p { margin: 3px 0 0; overflow-wrap: anywhere; }
.insight-card--questions ol { counter-reset: questions; }
.insight-card--questions li { position: relative; padding-left: 50px; counter-increment: questions; overflow-wrap: anywhere; }
.insight-card--questions li::before { position: absolute; top: 12px; left: 16px; display: grid; width: 23px; height: 23px; place-items: center; border-radius: 8px; background: #edf2ff; color: #5366a6; content: counter(questions); font-weight: 800; }
.feedback-section { padding: 17px; }
.feedback-heading { gap: 14px; }
.feedback-heading h3 { margin: 0; font-size: 15px; }
.feedback-heading p { margin: 4px 0 0; color: var(--text-secondary); font-size: 12px; }
.feedback-empty { margin: 14px 0 0; padding: 12px; border-radius: 10px; background: var(--surface-muted); color: var(--text-secondary); font-size: 12px; text-align: center; }
.feedback-item { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 7px 10px; align-items: start; margin-top: 11px; padding: 12px; border-radius: 10px; background: #f7faf9; color: var(--text-secondary); font-size: 12px; line-height: 1.5; }
.feedback-item span { overflow-wrap: anywhere; }
.feedback-item small { grid-column: 2; }
.analysis-footnote { color: var(--text-secondary); font-size: 11px; line-height: 1.6; }
.intake-details { display: flex; flex-wrap: wrap; gap: 8px 16px; padding: 14px 22px; border-top: 1px solid var(--border); background: #fafcfb; color: var(--text-secondary); font-size: 11px; }
.intake-details span { max-width: 100%; overflow-wrap: anywhere; }
.analysis-actionbar { position: sticky; z-index: 5; bottom: 0; display: flex; min-height: 72px; align-items: center; justify-content: space-between; gap: 18px; padding: 13px 22px; border-top: 1px solid var(--border); background: rgba(255,255,255,.96); box-shadow: 0 -8px 22px rgba(15,23,42,.055); backdrop-filter: blur(12px); }
.analysis-actionbar > div:first-child { min-width: 0; }
.analysis-actionbar strong, .analysis-actionbar span { display: block; }
.analysis-actionbar strong { color: var(--text-main); font-size: 12px; }
.analysis-actionbar span { margin-top: 4px; overflow: hidden; color: var(--text-secondary); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.analysis-actionbar__buttons { display: flex; flex: 0 0 auto; align-items: center; justify-content: flex-end; gap: 8px; }
.intake-form { margin-top: 18px; }
.intake-form .el-select { width: 100%; }
.intake-form small { display: block; margin-top: 5px; color: var(--text-secondary); font-size: 12px; line-height: 1.5; }
@media (max-width: 1180px) {
  .analysis-workspace { grid-template-columns: 1fr; }
  .resume-queue { grid-template-columns: repeat(2, minmax(0, 1fr)); max-height: 520px; }
  .insight-grid { grid-template-columns: 1fr; }
}
@media (max-width: 900px) {
  .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 640px) {
  .heading-actions, .heading-actions .el-button { width: 100%; }
  .metrics, .resume-queue { grid-template-columns: 1fr; }
  .analysis-dropzone, .candidate-header, .recommendation-card, .feedback-heading { align-items: flex-start; flex-direction: column; }
  .candidate-status { justify-content: flex-start; }
  .analysis-content, .candidate-header { padding: 17px; }
  .board-empty { min-height: 390px; padding: 28px 18px; }
  .insight-card:not(.insight-card--questions) li { flex-direction: column; }
  .analysis-actionbar { align-items: stretch; flex-direction: column; }
  .analysis-actionbar__buttons, .analysis-actionbar__buttons .el-button { width: 100%; }
  .analysis-actionbar__buttons { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .analysis-actionbar__buttons .el-button { margin: 0; }
}

/* 简历概览静止，队列实体可选择，AI 结论独占强调层级。 */
.metrics .metric-card.static-card { min-height: 104px; padding: 18px 20px; border: 1px solid var(--border); border-left: 3px solid var(--metric-accent, var(--brand-600)); border-radius: var(--card-radius); background: #fff; box-shadow: var(--shadow-card); transform: none; }
.metrics .metric-card.static-card strong { font-size: 30px; line-height: 1; }
.metrics .metric-card.static-card:hover { border-color: var(--border); box-shadow: var(--shadow-card); transform: none; }
.resume-ticket.entity-card { border: 0; border-top: 1px solid var(--border-subtle); border-radius: 0; background: #fff; box-shadow: none; }
.resume-ticket.entity-card:first-child { border-top: 0; }
.resume-ticket.entity-card:hover { border-color: var(--border-subtle); background: var(--surface-soft); box-shadow: inset 3px 0 0 #b9d9d4; transform: none; }
.resume-ticket.entity-card.resume-ticket--selected { border-color: var(--border-subtle); background: #eefaf7; box-shadow: inset 3px 0 0 var(--brand-600); transform: none; }
.resume-ticket.entity-card:focus-visible { outline: 3px solid rgba(15,118,110,.22); outline-offset: 2px; }
.recommendation-card.decision-card { border: 0; border-left: 3px solid var(--success); background: #f0faf5; box-shadow: none; }
.status-alert.decision-card { border: 0; border-left: 3px solid var(--danger); background: #fff3f1; }

/* 分析页让候选人队列保持紧凑，把阅读空间留给 HR 需要判断的 AI 结果。 */
.resume-page { width: min(100%, 1360px); }
.metric-card { border-radius: var(--card-radius); background: var(--surface-raised); }
.metric-card::after { display: none; }
.metric-card { border-left: 3px solid var(--metric-accent, var(--brand-600)); }
.metric-card--teal { --metric-accent: #0f8b80; }
.metric-card--blue { --metric-accent: #5a82ba; }
.metric-card--violet { --metric-accent: #8066ae; }
.metric-card--green { --metric-accent: #14855f; }
.metric-card--red { --metric-accent: #c64c42; }
.metric-card strong { font-size: 27px; }
.metrics { grid-template-columns: 1.25fr repeat(3, minmax(0, 1fr)); }
.metric-card { min-height: 112px; padding: 22px; border-radius: var(--radius-lg); box-shadow: var(--shadow-card); transform: none; }
.metric-card:hover { border-color: var(--border); box-shadow: var(--shadow-card); transform: none; }
.metric-card:first-child { background: linear-gradient(135deg, #fff 55%, #eefaf7); }
.analysis-workspace { gap: 16px; }
.resume-queue { gap: 0; padding: 0; background: #fff; }
.resume-ticket { padding: 15px 16px; border-radius: 0; box-shadow: none; }
.resume-ticket:hover, .resume-ticket--selected { box-shadow: inset 3px 0 0 var(--brand-600); }
.analysis-dropzone { min-height: 78px; padding: 16px 20px; border-bottom-color: #c9ddd8; }
.resume-queue-panel, .analysis-board { border-radius: var(--radius-lg); }
.analysis-board { background: var(--surface-raised); }
.ai-service-inline, .ai-service-inline--ready { margin: 0 14px; padding: 12px 0; border-width: 1px 0; border-color: var(--border-subtle); border-radius: 0; background: transparent; }
.candidate-header { padding: 20px 22px; background: linear-gradient(110deg, #fbfefd, #fff); }
.status-alert--danger { border-color: #f3c8c3; }
.recommendation-card { border-color: #bcded7; }
.evidence-coverage { width: min(220px, 32%); margin-left: auto; }
.evidence-coverage > span { display: block; margin-bottom: 6px; color: var(--text-secondary); font-size: 10px; text-align: right; }
.summary-card, .insight-card, .feedback-section { border-color: var(--border-subtle); box-shadow: none; }
.insight-card header { background: #f8faf9; }
.insight-card li { border-color: var(--border-subtle); }
.intake-details { background: #fafcfb; }
@media (max-width: 1180px) { .resume-page { width: min(100%, 1180px); } }
@media (max-width: 900px) { .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 640px) { .evidence-coverage { width: 100%; margin-left: 0; } .evidence-coverage > span { text-align: left; } }

/* V80 候选人决策面板：左侧队列、中央结论、右侧证据保持稳定三栏。 */
.resume-page { width: min(100%, 1440px); max-width: none; }
.resume-page .page-heading { margin-bottom: 28px; }.resume-page .page-heading h1 { font-size: clamp(30px, 2.5vw, 38px); letter-spacing: -.035em; }
.metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 20px; margin-bottom: 20px; }
.metrics .metric-card.static-card { display: grid; grid-template-columns: 58px minmax(0, 1fr); align-items: center; gap: 17px; min-height: 106px; padding: 20px 22px; border: 1px solid var(--border); border-left: 3px solid var(--metric-accent, var(--brand-600)); border-radius: 15px; background: #fff; box-shadow: 0 8px 22px rgba(23,32,51,.045); }
.metrics .metric-card.static-card::after { display: none; }.metrics .metric-card.static-card > .el-icon { display: grid; width: 58px; height: 58px; place-items: center; border-radius: 17px; background: color-mix(in srgb, var(--metric-accent, var(--brand-600)) 10%, white); color: var(--metric-accent, var(--brand-600)); font-size: 28px; }
.metrics .metric-card.static-card > div { position: static; display: block; padding: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none; transform: none; }.metrics .metric-card.static-card > div::after { display: none; }.metrics .metric-card.static-card span, .metrics .metric-card.static-card strong, .metrics .metric-card.static-card small { display: block; }.metrics .metric-card.static-card span { color: var(--text-secondary); font-size: 12px; }.metrics .metric-card.static-card strong { margin-top: 4px; font-size: 30px; line-height: 1; }.metrics .metric-card.static-card small { margin-top: 8px; color: var(--text-tertiary); font-size: 11px; }
.analysis-workspace { grid-template-columns: minmax(260px, .75fr) minmax(430px, 1.28fr) minmax(300px, .92fr); gap: 16px; }.resume-queue-panel { grid-column: 1; }.analysis-board { grid-column: 2 / 4; }
.resume-queue-panel, .analysis-board { border-radius: 17px; box-shadow: 0 8px 22px rgba(23,32,51,.045); }.queue-heading { min-height: 72px; padding: 18px 20px; }.queue-heading h2 { font-size: 18px; }.ai-service-inline { margin: 0 20px; }.resume-ticket { min-height: 108px; padding: 15px 18px; }.resume-ticket .ticket-person { margin-top: 9px; }.candidate-avatar { width: 42px; height: 42px; border-radius: 13px; }.candidate-avatar--large { width: 54px; height: 54px; border-radius: 16px; font-size: 20px; }.analysis-dropzone { min-height: 76px; padding: 16px 22px; }.candidate-header { min-height: 112px; padding: 22px; }.candidate-title h2 { font-size: 22px; }.analysis-content { padding: 18px 22px 22px; }.recommendation-card { min-height: 92px; padding: 18px; }.recommendation-card h3 { font-size: 21px; }.summary-card { margin-top: 14px; padding: 18px; }.insight-grid { gap: 14px; margin-top: 14px; }.insight-card { border-radius: 13px; }.feedback-section { margin-top: 14px; padding-top: 16px; }.intake-details { min-height: 48px; padding: 13px 22px; }
@media (max-width: 1180px) { .analysis-workspace { grid-template-columns: minmax(250px, .72fr) minmax(0, 1.28fr); }.analysis-board { grid-column: 2; }.insight-grid { grid-template-columns: 1fr; } }
@media (max-width: 900px) { .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }.analysis-workspace { grid-template-columns: 1fr; }.resume-queue-panel, .analysis-board { grid-column: auto; }.resume-queue { grid-template-columns: repeat(2, minmax(0, 1fr)); }.resume-ticket { border-left: 1px solid var(--border-subtle); }.resume-ticket:nth-child(odd) { border-left: 0; } }
@media (max-width: 620px) { .metrics { grid-template-columns: 1fr; gap: 12px; }.metrics .metric-card.static-card { min-height: 88px; padding: 16px; }.metrics .metric-card.static-card > .el-icon { width: 44px; height: 44px; border-radius: 13px; font-size: 21px; }.resume-queue { grid-template-columns: 1fr; }.resume-ticket { border-left: 0; }.candidate-header, .analysis-content, .intake-details { padding-inline: 16px; } }

/* 简历处理步骤在宽屏连续呈现，窄屏仍回退为易读的独立摘要。 */
@media (min-width: 1040px) {
  .analysis-pipeline { position: relative; isolation: isolate; }
  .analysis-pipeline::before {
    position: absolute;
    z-index: -1;
    top: 52px;
    right: calc(12.5% + 28px);
    left: calc(12.5% + 28px);
    height: 2px;
    background: linear-gradient(90deg, #a9dfd3, #b9cced 35%, #d8c8f1 68%, #b9dfcb);
    content: '';
  }
  .analysis-pipeline .metric-card::before {
    position: absolute;
    z-index: 2;
    top: 45px;
    right: -12px;
    width: 0;
    height: 0;
    border-top: 6px solid transparent;
    border-bottom: 6px solid transparent;
    border-left: 8px solid #b9cced;
    content: '';
  }
  .analysis-pipeline .metric-card:last-child::before { display: none; }
  .analysis-pipeline .metric-card--active {
    border-color: #9bd8c5;
    box-shadow: 0 1px 3px rgba(16,24,40,.06), 0 12px 28px rgba(21,143,106,.12);
  }
  .analysis-pipeline .metric-card--active > .el-icon {
    box-shadow: 0 0 0 5px rgba(22,163,74,.08);
  }
}

/* 深度工作区：队列与分析结果共享固定视口，分别独立滚动。 */
@media (min-width: 1181px) {
  .analysis-workspace {
    display: flex;
    height: calc(100dvh - 120px);
    min-height: 680px;
    gap: 20px;
    align-items: stretch;
  }
  .resume-queue-panel {
    display: flex;
    width: 320px;
    min-width: 320px;
    flex: 0 0 320px;
    flex-direction: column;
  }
  .ai-service-inline {
    display: grid;
    grid-template-columns: 32px minmax(0, 1fr);
    align-items: start;
  }
  .ai-service-inline__actions {
    grid-column: 1 / -1;
    justify-content: space-between;
    width: 100%;
  }
  .resume-queue {
    min-height: 0;
    flex: 1;
    max-height: none;
    overflow-y: auto;
  }
  .analysis-board {
    display: block;
    min-width: 0;
    flex: 1;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
}
</style>
