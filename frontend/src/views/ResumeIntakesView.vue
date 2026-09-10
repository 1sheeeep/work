<script setup lang="ts">
import PageHeader from '../components/PageHeader.vue'
import AsyncState from '../components/AsyncState.vue'
import MetricCard from '../components/MetricCard.vue'
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { Check, Cpu, InfoFilled, Refresh, UploadFilled, Warning } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox, ElNotification } from 'element-plus'
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
const externalSubmitting = ref(false)
const externalDragOver = ref(false)
const externalFileInput = ref<HTMLInputElement>()
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
type ExternalResumeAnalysisResponse = { intake: ResumeIntake; analysis: ResumeAnalysisRun; comparedJobCount: number }

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
  return value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '无'
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

let refreshTimer: number | undefined

async function load(silentOrEvent: boolean | Event = false) {
  const silent = silentOrEvent === true
  if (!silent) loading.value = true
  errorMessage.value = ''
  try {
    const previousIds = new Set(intakes.value.map((item) => item.id))
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
    const arrived = intakes.value.find((item) => !previousIds.has(item.id) && item.source === 'BOSS_VISIBLE')
    if (silent && arrived) {
      selectedIntakeId.value = arrived.id
      ElMessage.success(arrived.analysisStatus === 'SUCCEEDED' ? 'BOSS 简历已完成 AI 分析' : 'BOSS 简历已进入分析工作区')
    }
    if (!intakes.value.some((item) => item.id === selectedIntakeId.value)) {
      selectedIntakeId.value = intakes.value.find((item) => latestAnalysis(item.id)?.status === 'SUCCEEDED')?.id
        || intakes.value.find((item) => item.source === 'BOSS_VISIBLE')?.id
        || intakes.value[0]?.id
        || ''
    }
  } catch (error) {
    errorMessage.value = apiErrorMessage(error, '简历分析暂时无法加载')
  } finally {
    if (!silent) loading.value = false
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

async function reanalyzeStored(item: ResumeIntake) {
  if (analyzingId.value) return
  analyzingId.value = item.id
  try {
    await ensureCsrf()
    await api.post(`/resume-intakes/${item.id}/reanalyze`, undefined, { timeout: 120_000 })
    ElMessage.success('已使用后端保存的 PDF 重新分析')
    await loadAnalysis(intakes.value)
    await load()
  } catch (error) {
    ElMessage.error(apiErrorMessage(error, '重新分析未完成'))
  } finally {
    analyzingId.value = undefined
  }
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

function validateExternalPdf(file?: File | null) {
  if (!file) return '请选择 PDF 简历'
  if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') return '外部简历分析当前仅支持 PDF 文件'
  if (file.size > 8 * 1024 * 1024) return 'PDF 文件不能超过 8MB'
  if (!file.size) return 'PDF 文件为空'
  return ''
}

async function submitExternalPdf(file?: File | null) {
  const validation = validateExternalPdf(file)
  if (validation) { ElMessage.warning(validation); return }
  if (!aiStatus.value?.ready) { ElMessage.warning('当前 AI 服务未就绪，暂时无法分析外部 PDF'); return }
  externalSubmitting.value = true
  externalDragOver.value = false
  try {
    const payload = new FormData()
    payload.append('file', file as File)
    payload.append('externalProcessingConfirmed', 'true')
    await ensureCsrf()
    const { data } = await api.post<ExternalResumeAnalysisResponse>('/resume-intakes/external-pdf-analysis', payload, { timeout: 120_000 })
    await load()
    selectedIntakeId.value = data.intake.id
    ElMessage.success(`已识别 ${data.intake.candidateName}，并与 ${data.comparedJobCount} 个已启用岗位完成匹配`)
  } catch (error) {
    ElMessage.error(apiErrorMessage(error, '外部 PDF 分析未完成'))
  } finally {
    externalSubmitting.value = false
    if (externalFileInput.value) externalFileInput.value.value = ''
  }
}

function chooseExternalPdf() { if (!externalSubmitting.value) externalFileInput.value?.click() }
function handleExternalFileChange(event: Event) { void submitExternalPdf((event.target as HTMLInputElement).files?.[0]) }
function dropExternalPdf(event: DragEvent) { externalDragOver.value = false; void submitExternalPdf(event.dataTransfer?.files?.[0]) }

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

onMounted(() => {
  void load()
  refreshTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible') void load(true)
  }, 2000)
})
onBeforeUnmount(() => window.clearInterval(refreshTimer))

function showPageHelp() {
  ElNotification({
    title: '决策面板说明',
    message: '候选人决策面板提供从简历接收到AI辅助结论的完整工作流程。左侧队列展示所有简历，右侧工作区用于查看分析结果和进行HR复核。BOSS来源的简历支持拖拽到分析区。',
    duration: 5000,
    type: 'info',
  })
}

function showQueueHelp() {
  ElNotification({
    title: '简历队列说明',
    message: '简历队列按接收时间排序，BOSS来源的简历可以拖拽到右侧分析工作区。点击卡片可以查看简历的处理状态和分析结果。',
    duration: 5000,
    type: 'info',
  })
}

function showAnalysisHelp() {
  ElNotification({
    title: 'AI分析说明',
    message: 'AI分析结果包含推荐建议、证据覆盖度和建议追问。HR需要根据实际情况进行复核，可以选择采纳、修正或不采用AI结论。',
    duration: 5000,
    type: 'info',
  })
}
</script>

<template>
  <div class="page-shell resume-page">
    <PageHeader>
      <div>
        <span class="page-kicker">简历处理与人工复核</span>
        <h1>候选人决策面板</h1>
        <p>从简历接收到 AI 辅助结论，在同一工作区完成核对与复核。<el-button :icon="InfoFilled" size="small" type="text" @click="showPageHelp">查看说明</el-button></p>
      </div>
      <div class="heading-actions">
        <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
        <el-button type="primary" :icon="UploadFilled" @click="openCreate">人工补录</el-button>
      </div>
    </PageHeader>
    <div class="sr-only" aria-live="polite" aria-atomic="true">当前 {{ pending.length }} 份简历待 HR 处理，{{ processing.length }} 份分析中，{{ exceptionCount }} 份需要关注。</div>

    <section class="external-pdf-drop card-entity" :class="{ 'external-pdf-drop--active': externalDragOver, 'external-pdf-drop--loading': externalSubmitting }" role="button" tabindex="0" :aria-busy="externalSubmitting" aria-label="拖入或选择外部 PDF 简历并立即进行 AI 岗位匹配" @click="chooseExternalPdf" @keydown.enter="chooseExternalPdf" @keydown.space.prevent="chooseExternalPdf" @dragenter.prevent="externalDragOver = true" @dragover.prevent="externalDragOver = true" @dragleave.self="externalDragOver = false" @drop.prevent="dropExternalPdf">
      <input ref="externalFileInput" class="external-pdf-input" type="file" accept=".pdf,application/pdf" tabindex="-1" @change="handleExternalFileChange" />
      <span class="external-pdf-drop__icon"><el-icon><UploadFilled /></el-icon></span>
      <div><strong>{{ externalSubmitting ? '正在识别姓名并匹配岗位…' : externalDragOver ? '松开后立即开始 AI 分析' : '拖入外部 PDF 简历' }}</strong><small>从 PDF 识别姓名，并与当前权限内的已启用岗位匹配；不长期保存原文件。</small></div>
      <el-button type="primary" :loading="externalSubmitting" @click.stop="chooseExternalPdf">{{ externalSubmitting ? '分析中' : '选择 PDF' }}</el-button>
    </section>

    <AsyncState v-if="loading" state="loading" aria-label="正在加载简历分析" />
    <AsyncState v-else-if="errorMessage" state="error" title="简历分析暂时无法加载" :message="errorMessage" @retry="load">
      <template #icon><el-icon><Warning /></el-icon></template>
    </AsyncState>

    <template v-else>
      <section class="metrics analysis-pipeline" aria-label="简历处理流程概览">
        <MetricCard class="metric-card metric-card--teal" label="BOSS 已接收" :value="bossIntakes" description="可拖入右侧分析区" tone="teal"><template #icon><el-icon><UploadFilled /></el-icon></template></MetricCard>
        <MetricCard class="metric-card metric-card--blue" label="待 HR 处理" :value="pending.length" description="待复核或待授权" tone="blue"><template #icon><el-icon><Check /></el-icon></template></MetricCard>
        <MetricCard class="metric-card metric-card--violet" label="分析处理中" :value="processing.length" description="提取与 AI 任务" tone="violet"><template #icon><el-icon><Cpu /></el-icon></template></MetricCard>
        <MetricCard class="metric-card" :class="[exceptionCount ? 'metric-card--red' : 'metric-card--green', { 'metric-card--active': !exceptionCount && analyzed > 0 }]" :label="exceptionCount ? '需要关注' : '已完成分析'" :value="exceptionCount || analyzed" :description="exceptionCount ? '提取或分析异常' : '等待 HR 复核'" :tone="exceptionCount ? 'rose' : 'green'">
          <template #icon><el-icon><Warning v-if="exceptionCount" /><Check v-else /></el-icon></template>
        </MetricCard>
      </section>

      <AsyncState v-if="!intakes.length" state="empty" title="尚未收到简历" message="收到 BOSS 简历或完成人工补录后，将在这里进入分析队列。"><template #icon><el-icon><UploadFilled /></el-icon></template><el-button type="primary" @click="openCreate">人工补录</el-button></AsyncState>

      <section v-else class="analysis-workspace">
        <aside class="surface-panel section-card card-panel resume-queue-panel">
          <div class="section-title-row queue-heading"><div><span class="section-kicker">待选择</span><h2>简历队列</h2><p>{{ intakes.length }} 份简历 · BOSS 简历可拖拽<el-button :icon="InfoFilled" size="small" type="text" @click="showQueueHelp">查看说明</el-button></p></div></div>
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
                'resume-ticket--pending': item.status === 'PENDING_REVIEW',
                'resume-ticket--rejected': item.status === 'REJECTED',
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
                  {{ item.source === 'BOSS_VISIBLE' ? 'BOSS 收到' : item.displayLabel.startsWith('外部 PDF') ? '外部 PDF' : '人工补录' }}
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
              <strong>{{ dragOver ? '松开即可放入分析工作区' : '简历分析工作区' }}</strong><el-button :icon="InfoFilled" size="small" type="text" @click="showAnalysisHelp">查看说明</el-button>
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
                <span>{{ selectedIntake.source === 'BOSS_VISIBLE' ? 'BOSS 简历' : selectedIntake.displayLabel.startsWith('外部 PDF') ? '外部 PDF' : '人工补录' }}</span>
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
              <div class="decision-card card-emphasis recommendation-card">
                <div><span>AI 辅助结论</span><h3>{{ recommendationMeta[selectedAnalysis.result.recommendation].label }}</h3></div>
                <div class="evidence-coverage"><span>证据覆盖度 {{ evidenceCoverage(selectedAnalysis.result) }}%</span><el-progress :percentage="evidenceCoverage(selectedAnalysis.result)" :show-text="false" :stroke-width="7" /></div>

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
                <el-button type="primary" :loading="analyzingId === selectedIntake.id" @click="reanalyzeStored(selectedIntake)">重新分析该简历</el-button>
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
                  <el-button type="primary" @click="selectedAnalysis?.status === 'FAILED' ? reanalyzeStored(selectedIntake) : openFileAnalysis(selectedIntake)">{{ selectedAnalysis?.status === 'FAILED' ? '重新分析该简历' : '上传文件分析' }}</el-button>
                </template>
              </div>
            </footer>
          </template>
        </main>
      </section>
    </template>

    <el-dialog append-to-body v-model="dialogOpen" title="登记简历事件" width="560px">
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

    <el-dialog append-to-body v-model="autoAnalysisDialogOpen" title="BOSS 简历自动分析" width="560px">
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

    <el-dialog append-to-body v-model="feedbackDialogOpen" title="记录 HR 复核" width="520px">
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

    <el-dialog append-to-body v-model="fileDialogOpen" title="提取简历文本" width="560px">
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

    <el-dialog append-to-body v-model="textDialogOpen" title="核对文本并提交 AI 分析" width="680px">
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
.external-pdf-input { display: none; }
.external-pdf-drop { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 14px; margin: 16px 0 18px; padding: 16px 18px; border: 1px dashed var(--border-teal); border-radius: var(--radius-panel); background:linear-gradient(135deg, rgba(238,249,246,.82), rgba(255,255,255,.76)); box-shadow:var(--shadow-raised), inset 0 1px 0 rgba(255,255,255,.62); cursor: pointer; transition:border-color var(--transition-fast), box-shadow var(--transition-fast), transform var(--transition-fast), background var(--transition-fast); }
.external-pdf-drop:hover { border-color:var(--primary); box-shadow:var(--shadow-floating); transform:translateY(-1px); }
.external-pdf-drop__icon { display: grid; width: 44px; height: 44px; place-items: center; border-radius: var(--radius-control); background:linear-gradient(145deg, var(--surface-teal), rgba(255,255,255,.7)); color: var(--primary); font-size: 22px; box-shadow:inset 0 1px 0 rgba(255,255,255,.65), 0 6px 16px rgba(13,148,136,.08); }
.external-pdf-drop strong, .external-pdf-drop small { display: block; }
.external-pdf-drop strong { color: var(--text-main); font-size: 14px; }
.external-pdf-drop small { margin-top: 4px; color: var(--text-secondary); font-size: 12px; line-height: 1.5; }
.external-pdf-drop--active { border-color: var(--primary); background: var(--surface-teal); box-shadow: 0 0 0 4px rgba(13,148,136,.1); }
.external-pdf-drop--loading { cursor: wait; opacity: .82; }
.skeleton { padding: 26px; }
.error { display: grid; justify-items: center; gap: 10px; padding: 48px; color: var(--text-secondary); }
.error svg { font-size: 28px; color: var(--danger); }



.metrics .metric-card--teal { --metric-accent:#168b7f; --indicator-accent:#168b7f; --indicator-surface:var(--surface-teal); --indicator-border:var(--border-teal); }
.metrics .metric-card--blue { --metric-accent:#326fc1; --indicator-accent:#326fc1; --indicator-surface:var(--surface-blue); --indicator-border:var(--border-blue); }
.metrics .metric-card--violet { --metric-accent:#7253a6; --indicator-accent:#7253a6; --indicator-surface:var(--surface-violet); --indicator-border:var(--border-violet); }
.metrics .metric-card--green { --metric-accent:var(--success); --indicator-accent:var(--success); --indicator-surface:#eff9f3; --indicator-border:#d1eadb; }
.metrics .metric-card--red { --metric-accent:var(--danger); --indicator-accent:var(--danger); --indicator-surface:var(--surface-rose); --indicator-border:var(--border-rose); }
.metric-card span, .metric-card small { position: relative; z-index: 1; display: block; color: var(--text-secondary); font-size: 12px; }
.metric-card strong { position: relative; z-index: 1; display: block; margin: 7px 0 4px; font-size: 29px; line-height: 1; }
.analysis-workspace { display:grid; grid-template-columns:320px minmax(0,1fr); gap:20px; align-items:stretch; }
.analysis-workspace > * { min-width: 0; }
.resume-queue-panel, .analysis-board { overflow: hidden; }
.resume-queue-panel { background: var(--glass-bg); box-shadow:var(--shadow-raised); }
.analysis-board { position:relative; background: var(--glass-bg); box-shadow:var(--shadow-raised); }
.analysis-board > * { position:relative; z-index:1; }
.queue-heading { padding: 18px 20px; }
.ai-service-inline { display:grid; grid-template-columns:32px minmax(0,1fr); align-items:center; gap:10px; margin:0; padding:16px 20px; border-bottom:1px solid var(--border); background:linear-gradient(180deg, var(--surface-soft), rgba(255,255,255,.56)); }
.ai-service-inline > div { min-width: 0; margin-right: auto; }
.ai-service-inline--ready { background:var(--surface-soft); }
.ai-service-inline__mark { display: grid; width: 32px; height: 32px; flex: 0 0 auto; place-items: center; border-radius: var(--radius-control); background: var(--surface-muted); color: var(--text-tertiary); }
.ai-service-inline--ready .ai-service-inline__mark { background: var(--surface-teal); color: var(--success); }
.ai-service-inline strong, .ai-service-inline small { display: block; }
.ai-service-inline strong { font-size: 12px; }
.ai-service-inline small { margin-top: 3px; color: var(--text-secondary); font-size: 11px; line-height: 1.4; }
.ai-service-inline__actions { grid-column:1/-1; display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:6px; }
.authorization-checks { display: grid; gap: 12px; padding: 14px; border: 1px solid var(--border); border-radius: var(--radius-panel); background: var(--surface-muted); }
.authorization-checks .el-checkbox { height: auto; margin: 0; white-space: normal; }
.resume-queue { display:grid; align-content:start; max-height:760px; overflow:auto; padding:8px; gap:6px; scrollbar-width:thin; }
.resume-ticket { min-width:0; padding:16px 18px; border:0; border-radius:var(--radius-panel); background:linear-gradient(135deg, rgba(255,255,255,.88) 0%, rgba(255,255,255,.72) 100%); cursor:pointer; transition:background 180ms ease, box-shadow 280ms cubic-bezier(.2,0,0,1), transform 280ms cubic-bezier(.2,0,0,1); position:relative; box-shadow:0 1px 2px rgba(17,28,45,.03), 0 2px 8px rgba(17,28,45,.04), inset 0 1px 0 rgba(255,255,255,.72); }
.resume-ticket:nth-child(even) { background:linear-gradient(135deg, rgba(247,249,250,.88) 0%, rgba(247,249,250,.72) 100%); }
.resume-ticket--boss { cursor: grab; }
.resume-ticket:hover { background:linear-gradient(135deg, rgba(255,255,255,.96) 0%, rgba(255,255,255,.84) 100%); transform:translateY(-2px); box-shadow:0 2px 4px rgba(17,28,45,.05), 0 8px 24px rgba(17,28,45,.10), inset 0 1px 0 rgba(255,255,255,.88), 2px 0 0 0 rgba(13,148,136,.12); }
.resume-ticket:active { animation:card-press 180ms ease-out both; }
.resume-ticket--selected { background:linear-gradient(135deg, rgba(240,253,250,.96) 0%, rgba(255,255,255,.82) 100%); box-shadow:0 0 0 2px rgba(13,148,136,.28), 0 4px 18px rgba(13,148,136,.10), inset 0 1px 0 rgba(255,255,255,.78); animation:card-select-breathe 420ms cubic-bezier(.2,0,0,1) both; }
.resume-ticket--dragging { opacity: .5; cursor: grabbing; transform:rotate(1.5deg) scale(.97); }
.resume-ticket--pending { background:linear-gradient(135deg, var(--surface-amber) 0%, rgba(255,255,255,.78) 100%); box-shadow:0 1px 2px rgba(17,28,45,.03), 0 2px 8px rgba(17,28,45,.04), inset 0 1px 0 rgba(255,255,255,.72), 2px 0 0 0 rgba(183,110,0,.12); }
.resume-ticket--rejected { background:linear-gradient(135deg, var(--surface-rose) 0%, rgba(255,255,255,.78) 100%); box-shadow:0 1px 2px rgba(17,28,45,.03), 0 2px 8px rgba(17,28,45,.04), inset 0 1px 0 rgba(255,255,255,.72), 2px 0 0 0 rgba(180,35,24,.10); }
.ticket-topline, .ticket-person, .ticket-tags, .resume-ticket footer, .candidate-header, .candidate-status, .recommendation-card, .insight-card header, .feedback-heading { display: flex; align-items: center; }
.ticket-topline, .resume-ticket footer, .recommendation-card, .insight-card header, .feedback-heading { justify-content: space-between; }
.source-badge { display: inline-flex; align-items: center; min-height: 24px; padding: 0 9px; border-radius: var(--radius-pill); font-size: 11px; font-weight: 750; }
.source-badge--boss { background: var(--surface-teal); color: var(--brand-800); }
.source-badge--manual { background: var(--surface-slate); color: var(--text-tertiary); }
.drag-hint { color: var(--text-tertiary); font-size: 11px; }
.ticket-person { min-width: 0; gap: 11px; margin: 14px 0; }
.candidate-avatar { display: grid; flex: 0 0 auto; width: 38px; height: 38px; place-items: center; border-radius: 12px; background:linear-gradient(145deg, #14b8a6 0%, #0d9488 40%, #0f766e 100%); color: white; font-weight: 800; box-shadow:0 3px 10px rgba(13,148,136,.18), 0 1px 2px rgba(0,0,0,.06), inset 0 1px 0 rgba(255,255,255,.16); }
.candidate-avatar--large { width: 54px; height: 54px; border-radius: 16px; font-size: 20px; }
.ticket-person > div:last-child, .candidate-title { min-width: 0; }
.ticket-person strong, .ticket-person span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ticket-person strong { margin-bottom: 4px; font-size: 15px; }
.ticket-person span, .resume-ticket footer { color: var(--text-secondary); font-size: 12px; }
.ticket-tags, .candidate-status { flex-wrap: wrap; gap: 6px; }
.resume-ticket footer { gap: 10px; margin-top: 13px; padding-top: 12px; }
.resume-ticket footer span, .resume-ticket footer time { min-width: 0; overflow-wrap: anywhere; }
.resume-ticket footer time { text-align: right; }
.analysis-board { min-height: 640px; transition: border-color .18s ease, box-shadow .18s ease, transform .18s ease; }
.analysis-board--dragover { border-color: var(--primary); box-shadow: 0 0 0 4px rgba(15,118,110,.12), var(--shadow-md); }
.analysis-dropzone { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 86px; padding: 18px 22px; border-bottom: 1px dashed var(--border-teal); background:linear-gradient(135deg, rgba(238,249,246,.94), rgba(255,255,255,.66)); transition: background .18s ease; }
.analysis-dropzone--active { background: var(--surface-blue); }
.analysis-dropzone > div { min-width: 0; }
.analysis-dropzone strong, .analysis-dropzone small { display: block; }
.analysis-dropzone strong { font-size: 16px; }
.analysis-dropzone small { margin-top: 4px; color: var(--text-secondary); font-size: 12px; line-height: 1.5; }
.board-empty { display: grid; justify-items: center; align-content: center; min-height: 520px; padding: 42px; text-align: center; }
.board-empty--compact { min-height: 360px; }
.board-empty__icon { display: grid; width: 64px; height: 64px; place-items: center; border-radius: 20px; background:linear-gradient(145deg, var(--surface-teal), rgba(255,255,255,.7)); color: var(--primary); font-size: 26px; box-shadow:var(--shadow-raised), inset 0 1px 0 rgba(255,255,255,.62); }
.board-empty__icon--danger { background: var(--surface-rose); color: var(--danger); }
.board-empty h2 { margin: 17px 0 7px; font-size: 20px; }
.board-empty p { max-width: 460px; margin: 0; color: var(--text-secondary); line-height: 1.7; }
.empty-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 9px; margin-top: 20px; }
.candidate-header { align-items:center; flex-wrap:wrap; gap:14px; padding:22px; border-bottom:1px solid var(--border); background:linear-gradient(180deg, rgba(255,255,255,.72), rgba(247,249,250,.82)); }
.candidate-title { flex: 1; }
.candidate-title > span { color: var(--primary); font-size: 11px; font-weight: 800; }
.candidate-title h2 { margin: 4px 0 3px; font-size: 21px; }
.candidate-title p { margin: 0; color: var(--text-secondary); line-height: 1.5; overflow-wrap: anywhere; }
.candidate-status { justify-content: flex-end; }
.status-alert { display: grid; gap: 4px; margin: 18px 22px 0; padding: 13px 15px; border-radius: var(--radius-panel); font-size: 13px; }
.status-alert--danger { border: 1px solid var(--status-alert-danger-border); background: var(--status-alert-danger-bg); color: var(--status-alert-danger-text); }
.analysis-content { display: grid; gap: 16px; padding: 22px; }
.recommendation-card { gap: 14px; padding: 18px 20px; border: 1px solid var(--color-violet-border); border-radius: var(--radius-panel); background:linear-gradient(145deg, var(--surface-violet), rgba(255,255,255,.72)); position:relative; overflow:hidden; box-shadow:var(--shadow-ground), inset 0 1px 0 rgba(255,255,255,.6); }
.recommendation-card span, .summary-card > span { color: var(--text-secondary); font-size: 12px; font-weight: 700; position:relative; z-index:1; }
.recommendation-card h3 { margin: 5px 0 0; font-size: 21px; position:relative; z-index:1; }
.summary-card, .insight-card, .feedback-section { padding:18px 0 0; border-top:1px solid var(--border); }
.summary-card { padding:0; }
.summary-card p { margin: 8px 0 0; line-height: 1.75; overflow-wrap: anywhere; }
.summary-flags { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 13px; }
.flag { display: inline-flex; max-width: 100%; padding: 4px 8px; border-radius: 6px; font-size: 11px; overflow-wrap: anywhere; line-height:1.45; }
.flag--warning { background: var(--flag-warning-bg); color: var(--flag-warning-text); }
.flag--danger { background: var(--flag-danger-bg); color: var(--flag-danger-text); }
.insight-grid { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, .8fr); gap: 14px; }
.insight-card { overflow: hidden; border-radius:var(--radius-panel); box-shadow:var(--shadow-ground); }
.insight-card header { gap: 12px; padding: 14px 16px; border-bottom: 1px solid var(--color-violet-border); background: var(--color-violet-soft); }
.insight-card header span { font-weight: 750; }
.insight-card header strong { display: grid; width: 27px; height: 27px; place-items: center; border-radius: var(--radius-control); background:var(--color-violet-badge-bg); color:var(--color-violet-badge-text); font-size: 12px; }
.insight-card ul, .insight-card ol { display: grid; gap: 0; margin: 0; padding: 0; list-style: none; }
.insight-card li { min-width: 0; padding: 13px 16px; border-bottom: 1px solid var(--border-subtle); color: var(--text-secondary); font-size: 12px; line-height: 1.55; background:var(--surface); transition:background var(--transition-fast); }
.insight-card li:nth-child(even) { background:var(--surface-soft); }
.insight-card li:hover { background:var(--surface-row); }
.insight-card li:last-child { border-bottom: 0; }
.insight-card:not(.insight-card--questions) li { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.insight-card li > div { min-width: 0; }
.insight-card li strong { color: var(--text); }
.insight-card li p { margin: 3px 0 0; overflow-wrap: anywhere; }
.insight-card--questions ol { counter-reset: questions; }
.insight-card--questions li { position: relative; padding-left: 50px; counter-increment: questions; overflow-wrap: anywhere; }
.insight-card--questions li::before { position: absolute; top: 12px; left: 16px; display: grid; width: 23px; height: 23px; place-items: center; border-radius: var(--radius-control); background: var(--color-question-marker-bg); color: var(--color-question-marker-text); content: counter(questions); font-weight: 800; }
.feedback-section { padding: 17px; }
.feedback-heading { gap: 14px; }
.feedback-heading h3 { margin: 0; font-size: 15px; }
.feedback-heading p { margin: 4px 0 0; color: var(--text-secondary); font-size: 12px; }
.feedback-empty { margin: 14px 0 0; padding: 12px; border-radius: var(--radius-control); background: var(--surface-muted); color: var(--text-secondary); font-size: 12px; text-align: center; }
.feedback-item { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 7px 10px; align-items: start; margin-top: 11px; padding: 12px; border-radius: var(--radius-control); background: var(--surface-soft); color: var(--text-secondary); font-size: 12px; line-height: 1.5; }
.feedback-item span { overflow-wrap: anywhere; }
.feedback-item small { grid-column: 2; }
.analysis-footnote { color: var(--text-secondary); font-size: 11px; line-height: 1.6; }
.intake-details { display: flex; flex-wrap: wrap; gap: 8px 16px; padding: 14px 22px; border-top: 1px solid var(--border); background: var(--surface-soft); color: var(--text-secondary); font-size: 11px; }
.intake-details span { max-width: 100%; overflow-wrap: anywhere; }
.analysis-actionbar { position: sticky; z-index: 5; bottom: 0; display: flex; min-height: 72px; align-items: center; justify-content: space-between; gap: 18px; padding: 13px 22px; border-top: 1px solid var(--border-teal); background:color-mix(in srgb, var(--surface) 88%, transparent); backdrop-filter:blur(14px) saturate(1.08); -webkit-backdrop-filter:blur(14px) saturate(1.08); box-shadow: 0 -12px 30px rgba(17,28,45,.07); }
.analysis-actionbar > div:first-child { min-width: 0; }
.analysis-actionbar strong, .analysis-actionbar span { display: block; }
.analysis-actionbar strong { color: var(--text-main); font-size: 12px; }
.analysis-actionbar span { margin-top: 4px; overflow: hidden; color: var(--text-secondary); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.analysis-actionbar__buttons { display: flex; flex: 0 0 auto; align-items: center; justify-content: flex-end; gap: 8px; }
.intake-form { margin-top: 18px; }
.intake-form .el-select { width: 100%; }
.intake-form small { display: block; margin-top: 5px; color: var(--text-secondary); font-size: 12px; line-height: 1.5; }

.evidence-coverage { flex:0 1 200px; min-width:130px; margin-left:auto; }.evidence-coverage > span { display:block; margin-bottom:8px; font-size:11px; }
.evidence-coverage :deep(.el-progress-bar__outer) { background:var(--border); }
.evidence-coverage :deep(.el-progress-bar__inner) { background:var(--primary); }
.recommendation-card { flex-wrap:wrap; }
.sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
@media(min-width:1181px) {
 .analysis-workspace { height:calc(100dvh - 100px); min-height:620px; }
 .resume-queue-panel { display:flex; flex-direction:column; min-height:0; }.resume-queue { flex:1; max-height:none; min-height:0; }.analysis-board { overflow-y:auto; overscroll-behavior:contain; }
}
@media(max-width:1180px) { .analysis-workspace { grid-template-columns:1fr; }.resume-queue { grid-template-columns:repeat(2,minmax(0,1fr)); max-height:400px; }.insight-grid { grid-template-columns:1fr; }.analysis-actionbar { position:static; flex-wrap:wrap; }.candidate-status { justify-content:flex-start; } }
@media(max-width:600px) { .external-pdf-drop { grid-template-columns:40px minmax(0,1fr); }.external-pdf-drop > .el-button { grid-column:1/-1; width:100%; }.resume-queue { grid-template-columns:1fr; }.candidate-header,.analysis-content,.analysis-dropzone,.intake-details,.analysis-actionbar { padding:16px; }.candidate-title { flex-basis:calc(100% - 80px); }.candidate-status { flex-basis:100%; }.analysis-actionbar__buttons { flex-wrap:wrap; width:100%; }.analysis-actionbar__buttons .el-button { flex:1; margin:0; }.recommendation-card { padding:16px; }.evidence-coverage { flex-basis:100%; margin:0; }.board-empty { padding:24px 16px; min-height:280px; } }

:root[data-theme="dark"] .metrics .metric-card--green {
  --indicator-surface: var(--surface-green);
  --indicator-border: var(--border-green);
}
:global(:root[data-theme="dark"]) .resume-ticket { background:linear-gradient(135deg, rgba(30,36,51,.88) 0%, rgba(26,31,44,.78) 100%); box-shadow:0 1px 2px rgba(0,0,0,.22), 0 2px 8px rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.04); }
:global(:root[data-theme="dark"]) .resume-ticket:nth-child(even) { background:linear-gradient(135deg, rgba(34,40,55,.88) 0%, rgba(30,36,51,.78) 100%); }
:global(:root[data-theme="dark"]) .resume-ticket:hover { background:linear-gradient(135deg, rgba(36,42,58,.96) 0%, rgba(30,36,51,.84) 100%); box-shadow:0 2px 4px rgba(0,0,0,.30), 0 8px 24px rgba(0,0,0,.28), inset 0 1px 0 rgba(255,255,255,.06), 2px 0 0 0 rgba(13,148,136,.16); }
:global(:root[data-theme="dark"]) .resume-ticket--selected { background:linear-gradient(135deg, rgba(15,31,29,.96) 0%, rgba(30,36,51,.82) 100%); box-shadow:0 0 0 2px rgba(20,184,166,.32), 0 4px 18px rgba(20,184,166,.14), inset 0 1px 0 rgba(255,255,255,.06); }
:global(:root[data-theme="dark"]) .resume-ticket--pending { background:linear-gradient(135deg, rgba(42,34,22,.88) 0%, rgba(30,36,51,.78) 100%); box-shadow:0 1px 2px rgba(0,0,0,.22), 0 2px 8px rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.04), 2px 0 0 0 rgba(183,110,0,.16); }
:global(:root[data-theme="dark"]) .resume-ticket--rejected { background:linear-gradient(135deg, rgba(42,19,19,.88) 0%, rgba(30,36,51,.78) 100%); box-shadow:0 1px 2px rgba(0,0,0,.22), 0 2px 8px rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.04), 2px 0 0 0 rgba(180,35,24,.14); }
</style>