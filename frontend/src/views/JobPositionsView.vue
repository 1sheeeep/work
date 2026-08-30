<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { FormInstance, FormRules } from 'element-plus'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Briefcase, Plus, Refresh, Search } from '@element-plus/icons-vue'
import { api, apiErrorMessage, apiFieldErrors, ensureCsrf } from '../services/api'
import { authStore } from '../stores/auth'
import type { BossAccount, Company, JobPosition, JobPositionStatus } from '../types'

interface JobFormValue {
  companyId: string
  bossAccountId: string
  title: string
  location: string
  salaryMinK: number
  salaryMaxK: number
  salaryMonths: number
  experienceRequirement: string
  educationRequirement: string
  description: string
  screeningRequirements: string
}

interface JobReviewFormValue {
  location: string; salaryMinK: number; salaryMaxK: number; salaryMonths: number
  experienceRequirement: string; educationRequirement: string; description: string; screeningRequirements: string
  replySummary: string; salaryDisplay: string; captureConfirmed: boolean; knowledgeApproved: boolean; activateConfirmed: boolean
}

const loading = ref(true)
const router = useRouter()
const loadError = ref('')
const jobs = ref<JobPosition[]>([])
const companies = ref<Company[]>([])
const bossAccounts = ref<BossAccount[]>([])
const keyword = ref('')
const companyFilter = ref('')
const statusFilter = ref<JobPositionStatus | ''>('')
const dialogOpen = ref(false)
const saving = ref(false)
const editingJob = ref<JobPosition | null>(null)
const formRef = ref<FormInstance>()
const form = reactive<JobFormValue>({ companyId: '', bossAccountId: '', title: '', location: '', salaryMinK: 20, salaryMaxK: 30, salaryMonths: 13, experienceRequirement: '', educationRequirement: '', description: '', screeningRequirements: '' })
const formError = ref('')
const fieldErrors = reactive<Record<string, string>>({})
const changingStatusId = ref('')
const knowledgeDialogOpen = ref(false)
const knowledgeJob = ref<JobPosition | null>(null)
const knowledgeSaving = ref(false)
const knowledgeForm = reactive({ replySummary: '', salaryDisplay: '', approved: false })
const preview = ref<{ mode: string; content: string; missingFields: string[] } | null>(null)
const reviewDialogOpen = ref(false)
const reviewJob = ref<JobPosition | null>(null)
const reviewSaving = ref(false)
const reviewFormRef = ref<FormInstance>()
const reviewForm = reactive<JobReviewFormValue>({ location: '', salaryMinK: 1, salaryMaxK: 1, salaryMonths: 12, experienceRequirement: '', educationRequirement: '', description: '', screeningRequirements: '', replySummary: '', salaryDisplay: '', captureConfirmed: false, knowledgeApproved: false, activateConfirmed: false })

const canManage = computed(() => ['SYSTEM_ADMIN', 'RECRUITMENT_ADMIN'].includes(authStore.state.user?.role ?? ''))
const activeCompanies = computed(() => companies.value.filter((company) => company.status === 'ACTIVE'))
const eligibleAccounts = computed(() => bossAccounts.value.filter((account) =>
  account.company.id === form.companyId && account.status === 'ACTIVE' && account.capabilities.includes('JOB_SYNC')))
const stats = computed(() => ({
  total: jobs.value.length,
  active: jobs.value.filter((job) => job.status === 'ACTIVE').length,
  draft: jobs.value.filter((job) => job.status === 'DRAFT').length,
  safeReady: jobs.value.filter((job) => job.status === 'ACTIVE' && job.safeReplyReady).length,
  pageCaptured: jobs.value.filter((job) => job.captureSource === 'VISIBLE_PAGE').length,
}))
const latestPageCapture = computed(() => jobs.value.filter((job) => job.captureSource === 'VISIBLE_PAGE' && job.capturedAt)
  .map((job) => job.capturedAt as string).sort().at(-1) ?? '')
const reviewQueue = computed(() => jobs.value.filter((job) => job.reviewReadiness?.importedDraft)
  .sort((a, b) => b.observationCount - a.observationCount))
const dialogTitle = computed(() => editingJob.value ? '编辑职位' : '新增职位')
const statusLabels: Record<JobPositionStatus, string> = { DRAFT: '草稿', ACTIVE: '已启用', CLOSED: '已关闭' }
const rules: FormRules<JobFormValue> = {
  companyId: [{ required: true, message: '请选择归属企业', trigger: 'change' }],
  bossAccountId: [{ required: true, message: '请选择具备职位同步能力的 BOSS 账号', trigger: 'change' }],
  title: [{ required: true, message: '请输入职位名称', trigger: 'blur' }, { max: 120, message: '最多 120 个字符', trigger: 'blur' }],
  location: [{ required: true, message: '请输入工作地点', trigger: 'blur' }],
  experienceRequirement: [{ required: true, message: '请输入经验要求', trigger: 'blur' }],
  educationRequirement: [{ required: true, message: '请输入学历要求', trigger: 'blur' }],
  description: [{ required: true, message: '请输入职位描述', trigger: 'blur' }],
}
const reviewRules: FormRules<JobReviewFormValue> = {
  location: [{ required: true, message: '请输入真实工作地点', trigger: 'blur' }],
  experienceRequirement: [{ required: true, message: '请输入真实经验要求', trigger: 'blur' }],
  educationRequirement: [{ required: true, message: '请输入真实学历要求', trigger: 'blur' }],
  description: [{ required: true, message: '请输入真实职位描述', trigger: 'blur' }],
  replySummary: [{ required: true, message: '请填写候选人可见的岗位简介', trigger: 'blur' }],
}

watch(() => form.companyId, () => {
  if (form.bossAccountId && !eligibleAccounts.value.some((account) => account.id === form.bossAccountId)) form.bossAccountId = ''
})

function statusTagType(status: JobPositionStatus) {
  return ({ DRAFT: 'warning', ACTIVE: 'success', CLOSED: 'info' } as const)[status]
}
function clearFieldErrors() { Object.keys(fieldErrors).forEach((key) => delete fieldErrors[key]) }

async function loadData() {
  loading.value = true
  loadError.value = ''
  try {
    const [jobResponse, companyResponse, accountResponse] = await Promise.all([
      api.get<JobPosition[]>('/job-positions', { params: { keyword: keyword.value.trim() || undefined, companyId: companyFilter.value || undefined, status: statusFilter.value || undefined } }),
      api.get<Company[]>('/organization/companies'),
      api.get<BossAccount[]>('/boss-accounts'),
    ])
    jobs.value = jobResponse.data
    companies.value = companyResponse.data
    bossAccounts.value = accountResponse.data
  } catch (error) { loadError.value = apiErrorMessage(error, '职位资料加载失败，请重试') }
  finally { loading.value = false }
}

function openCreate() {
  editingJob.value = null
  const formalAccount = bossAccounts.value.find((account) => account.gatewayType === 'LOCAL_CDP_CONNECTOR' && account.status === 'ACTIVE' && account.capabilities.includes('JOB_SYNC'))
  Object.assign(form, { companyId: formalAccount?.company.id ?? activeCompanies.value[0]?.id ?? '', bossAccountId: '', title: '', location: '', salaryMinK: 20, salaryMaxK: 30, salaryMonths: 13, experienceRequirement: '', educationRequirement: '', description: '', screeningRequirements: '' })
  form.bossAccountId = eligibleAccounts.value[0]?.id ?? ''
  formError.value = ''
  clearFieldErrors()
  dialogOpen.value = true
}

function openEdit(job: JobPosition) {
  editingJob.value = job
  Object.assign(form, { companyId: job.company.id, bossAccountId: job.bossAccount.id, title: job.title, location: job.location, salaryMinK: job.salaryMinK, salaryMaxK: job.salaryMaxK, salaryMonths: job.salaryMonths, experienceRequirement: job.experienceRequirement, educationRequirement: job.educationRequirement, description: job.description, screeningRequirements: job.screeningRequirements ?? '' })
  formError.value = ''
  clearFieldErrors()
  dialogOpen.value = true
}

async function saveJob() {
  formError.value = ''
  clearFieldErrors()
  if (!(await formRef.value?.validate().catch(() => false))) return
  if (form.salaryMaxK < form.salaryMinK) { formError.value = '月薪上限不能低于月薪下限'; return }
  saving.value = true
  try {
    await ensureCsrf()
    if (editingJob.value) {
      await api.put(`/job-positions/${editingJob.value.id}`, form)
      ElMessage.success('职位已更新')
    } else {
      await api.post('/job-positions', form)
      ElMessage.success('职位草稿已创建')
    }
    dialogOpen.value = false
    await loadData()
  } catch (error) {
    Object.assign(fieldErrors, apiFieldErrors(error))
    formError.value = apiErrorMessage(error, '职位保存失败，请重试')
  } finally { saving.value = false }
}

async function changeStatus(job: JobPosition, status: JobPositionStatus) {
  if (status === 'CLOSED') {
    try {
      await ElMessageBox.confirm(`关闭后，“${job.title}”不能再编辑或重新启用，历史数据会保留。`, '确认关闭职位', { type: 'warning', confirmButtonText: '确认关闭', cancelButtonText: '取消' })
    } catch { return }
  }
  changingStatusId.value = job.id
  try {
    await ensureCsrf()
    await api.patch(`/job-positions/${job.id}/status`, { status })
    ElMessage.success(status === 'ACTIVE' ? '职位已启用' : '职位已关闭')
    await loadData()
  } catch (error) { ElMessage.error(apiErrorMessage(error, '职位状态变更失败')) }
  finally { changingStatusId.value = '' }
}

function salaryLabel(job: JobPosition) { return job.captureSource === 'UNREAD_OBSERVATION' ? '详细待遇待补全' : `${job.salaryMinK}-${job.salaryMaxK}K·${job.salaryMonths}薪` }
function captureLabel(job: JobPosition) {
  if (job.captureSource === 'UNREAD_OBSERVATION') return `未读观察导入 · ${job.observationCount} 次 · ${job.captureVerified ? '已核对' : '待补全'}`
  return job.captureSource === 'VISIBLE_PAGE' ? `页面采集${job.captureCompleteness ? ` · ${job.captureCompleteness} 个公开字段` : ''} · ${job.captureVerified ? '已核对' : '待核对'}` : '手工录入'
}

function openKnowledge(job: JobPosition) {
  knowledgeJob.value = job
  Object.assign(knowledgeForm, { replySummary: job.replySummary ?? '', salaryDisplay: job.salaryDisplay ?? '', approved: job.knowledgeApproved })
  preview.value = null
  knowledgeDialogOpen.value = true
}

async function saveKnowledge() {
  if (!knowledgeJob.value) return
  knowledgeSaving.value = true
  try {
    await ensureCsrf()
    await api.put(`/job-positions/${knowledgeJob.value.id}/knowledge`, knowledgeForm)
    ElMessage.success(knowledgeForm.approved ? '岗位知识已审核，可用于安全回复' : '岗位知识草稿已保存')
    await loadData()
  } catch (error) { ElMessage.error(apiErrorMessage(error, '岗位知识保存失败')) }
  finally { knowledgeSaving.value = false }
}

async function loadPreview() {
  if (!knowledgeJob.value) return
  try {
    const { data } = await api.get<{ mode: string; content: string; missingFields: string[] }>(`/job-positions/${knowledgeJob.value.id}/reply-preview`)
    preview.value = data
  } catch (error) { ElMessage.error(apiErrorMessage(error, '回复预览生成失败')) }
}

function realValue(value?: string) {
  if (!value) return ''
  if (value.includes('待从 BOSS 岗位页补全') || value.includes('由真实 BOSS 职位管理页只读采集')) return ''
  return value
}
function suggestedReplySummary(job: JobPosition) {
  const salary = job.salaryDisplay || `${job.salaryMinK}-${job.salaryMaxK}K${job.salaryMonths > 12 ? `·${job.salaryMonths}薪` : ''}`
  return `${job.title}，工作地点${job.location}，薪资${salary}，经验要求${job.experienceRequirement}，学历要求${job.educationRequirement}。具体工作内容和安排以招聘同事后续沟通为准。`
}
function reviewEvidenceLabel(job: JobPosition) {
  if (job.captureSource === 'VISIBLE_PAGE') return `BOSS 职位页已同步 · ${job.captureCompleteness ?? 0} 个公开字段`
  return `在未读列表出现 ${job.observationCount} 次`
}
function openImportedReview(job: JobPosition) {
  reviewJob.value = job
  Object.assign(reviewForm, {
    location: realValue(job.location), salaryMinK: job.salaryMinK, salaryMaxK: job.salaryMaxK,
    salaryMonths: job.salaryMonths, experienceRequirement: realValue(job.experienceRequirement),
    educationRequirement: realValue(job.educationRequirement), description: realValue(job.description),
    screeningRequirements: realValue(job.screeningRequirements), replySummary: job.replySummary || suggestedReplySummary(job),
    salaryDisplay: job.salaryDisplay ?? '', captureConfirmed: false, knowledgeApproved: false, activateConfirmed: false,
  })
  reviewDialogOpen.value = true
}
function goToCompanyKnowledge() { router.push('/organization') }
async function completeImportedReview() {
  if (!reviewJob.value || !(await reviewFormRef.value?.validate().catch(() => false))) return
  if (reviewForm.salaryMaxK < reviewForm.salaryMinK) { ElMessage.error('月薪上限不能低于月薪下限'); return }
  if (!reviewForm.captureConfirmed || !reviewForm.knowledgeApproved || !reviewForm.activateConfirmed) {
    ElMessage.warning('请完成三项人工确认后再启用岗位'); return
  }
  reviewSaving.value = true
  try {
    await ensureCsrf()
    await api.post(`/job-positions/${reviewJob.value.id}/review-and-activate`, reviewForm)
    let recalculated = true
    try { await api.post('/local-connector/observations/recalculate-drafts') } catch { recalculated = false }
    ElMessage.success(recalculated ? '岗位已审核启用，现有未读草稿已重新评估' : '岗位已审核启用；草稿将在下次观测时重新评估')
    reviewDialogOpen.value = false
    await loadData()
  } catch (error) { ElMessage.error(apiErrorMessage(error, '岗位审核启用失败')) }
  finally { reviewSaving.value = false }
}

onMounted(loadData)
</script>

<template>
  <div class="page-shell">
    <header class="page-heading"><div><h1>职位管理</h1><p>统一管理企业职位、筛选要求和 BOSS 账号绑定，为候选人会话与回复模板提供上下文。</p></div><el-button v-if="canManage" type="primary" :icon="Plus" @click="openCreate">新增职位</el-button></header>
    <el-alert title="职位只能绑定同企业、已启用且通过能力检查的 BOSS 账号；关闭后保留历史且不可重新启用。" type="info" :closable="false" show-icon class="scope-alert" />
    <div v-if="loading" class="surface-panel skeleton-stack"><el-skeleton :rows="7" animated /></div>
    <div v-else-if="loadError" class="surface-panel error-state" role="alert"><span class="error-state__icon"><el-icon><Refresh /></el-icon></span><strong>职位暂时无法加载</strong><span>{{ loadError }}</span><el-button :icon="Refresh" @click="loadData">重新加载</el-button></div>
    <template v-else>
      <div class="metrics-strip"><div><span>职位总数</span><strong>{{ stats.total }}</strong></div><div><span>页面同步</span><strong>{{ stats.pageCaptured }}</strong></div><div><span>安全草稿就绪</span><strong>{{ stats.safeReady }}</strong></div><div><span>待完善草稿</span><strong>{{ stats.draft }}</strong></div></div>
      <section class="surface-panel browser-import-guide"><div><strong>BOSS 职位管理页同步</strong><p>在已配对的 Chrome Profile 中手动打开“职位管理”，点击扩展里的“同步当前职位页”。系统按招聘账号和岗位标题去重，只创建待审核草稿。</p><small v-if="latestPageCapture">最近入库：{{ new Date(latestPageCapture).toLocaleString('zh-CN') }}</small><small v-else>尚无职位管理页采集记录</small></div><el-button :icon="Refresh" @click="loadData">刷新同步结果</el-button></section>
      <section v-if="reviewQueue.length" class="surface-panel review-queue"><div class="section-title-row"><div><h2>真实岗位待办</h2><p>优先处理已有真实页面或未读证据的岗位。每个岗位必须单独补全、核对和批准，不提供批量自动审核。</p></div><el-tag type="warning">{{ reviewQueue.length }} 个待处理</el-tag></div><div class="review-cards"><article v-for="job in reviewQueue" :key="job.id"><header><div class="job-identity"><strong>{{ job.title }}</strong><span>{{ job.bossAccount.displayName }} · {{ reviewEvidenceLabel(job) }}</span></div><el-tag type="warning">待审核</el-tag></header><div class="review-steps"><span :class="{done:job.reviewReadiness.profileComplete}">1 岗位资料</span><span :class="{done:job.reviewReadiness.captureReady}">2 页面核对</span><span :class="{done:job.reviewReadiness.companyKnowledgeReady}">3 企业知识</span><span :class="{done:job.reviewReadiness.jobKnowledgeReady}">4 岗位知识</span><span :class="{done:job.status==='ACTIVE'}">5 启用</span></div><p>{{ job.reviewReadiness.blockers.join('、') || '资料已具备，可完成最终审核' }}</p><footer><el-button v-if="!job.reviewReadiness.companyKnowledgeReady" text type="warning" @click="goToCompanyKnowledge">先审核企业资料</el-button><el-button type="primary" :disabled="!job.reviewReadiness.companyKnowledgeReady" @click="openImportedReview(job)">补全、审核并启用</el-button></footer></article></div></section>
      <section class="surface-panel jobs-panel">
        <div class="section-title-row jobs-title"><div><h2>职位列表</h2><p>草稿完善后才可启用，启用时会再次校验 BOSS Capability</p></div><div class="filters"><el-input v-model="keyword" clearable placeholder="搜索职位、地点或 BOSS 账号" :prefix-icon="Search" @keyup.enter="loadData" /><el-select v-model="companyFilter" clearable placeholder="全部企业" @change="loadData"><el-option v-for="company in companies" :key="company.id" :label="company.name" :value="company.id" /></el-select><el-select v-model="statusFilter" placeholder="全部状态" @change="loadData"><el-option label="全部状态" value="" /><el-option label="草稿" value="DRAFT" /><el-option label="已启用" value="ACTIVE" /><el-option label="已关闭" value="CLOSED" /></el-select><el-button @click="loadData">查询</el-button></div></div>
        <div v-if="jobs.length === 0" class="empty-state"><span class="empty-state__icon"><el-icon><Briefcase /></el-icon></span><strong>还没有符合条件的职位</strong><span v-if="canManage">请先确保 BOSS 账号具备职位同步能力，再创建职位草稿。</span><span v-else>请联系招聘管理员创建职位。</span><el-button v-if="canManage" type="primary" :icon="Plus" @click="openCreate">新增职位</el-button></div>
        <template v-else>
          <el-table :data="jobs" class="jobs-table"><el-table-column type="expand"><template #default="{ row }"><div class="captured-job-detail"><h3>职位基本信息与要求</h3><dl><div><dt>招聘类型</dt><dd>{{ row.recruitmentType || '待详情页同步' }}</dd></div><div><dt>职位类别</dt><dd>{{ row.jobCategory || '待详情页同步' }}</dd></div><div><dt>是否驻外</dt><dd>{{ row.overseasRequirement || '待详情页同步' }}</dd></div><div><dt>工作地址</dt><dd>{{ row.workAddress || row.location }}</dd></div><div><dt>经验要求</dt><dd>{{ row.experienceRequirement }}</dd></div><div><dt>学历要求</dt><dd>{{ row.educationRequirement }}</dd></div><div><dt>薪资详情</dt><dd>{{ row.salaryDisplay || salaryLabel(row as JobPosition) }}</dd></div><div><dt>职位关键词</dt><dd>{{ row.jobKeywords || '未设置' }}</dd></div></dl><section><strong>职位描述</strong><p>{{ row.description }}</p></section></div></template></el-table-column><el-table-column label="职位" min-width="210"><template #default="{ row }"><div class="job-identity"><strong>{{ row.title }}</strong><span>{{ row.location }} · {{ salaryLabel(row as JobPosition) }}</span></div></template></el-table-column><el-table-column label="归属企业" min-width="165"><template #default="{ row }"><strong>{{ row.company.name }}</strong><div class="muted">{{ row.company.code }}</div></template></el-table-column><el-table-column label="BOSS 账号" min-width="175"><template #default="{ row }"><strong>{{ row.bossAccount.displayName }}</strong><div class="muted">{{ row.bossAccount.externalIdentifier }}</div></template></el-table-column><el-table-column label="资料来源" min-width="155"><template #default="{ row }"><el-tag :type="row.captureSource === 'VISIBLE_PAGE' ? (row.captureVerified ? 'success' : 'warning') : row.captureSource === 'UNREAD_OBSERVATION' ? (row.captureVerified ? 'success' : 'warning') : 'info'">{{ captureLabel(row as JobPosition) }}</el-tag><div v-if="row.captureSource === 'VISIBLE_PAGE'" class="muted">{{ row.captureVerified ? '已人工核对' : '需对照 BOSS 页面核对' }}</div><div v-else-if="row.captureSource === 'UNREAD_OBSERVATION'" class="muted">{{ row.captureVerified ? '已补全并人工核对' : '仅标题可信，编辑补全后再启用' }}</div></template></el-table-column><el-table-column label="安全草稿" min-width="160"><template #default="{ row }"><el-tag :type="row.safeReplyReady ? 'success' : 'warning'">{{ row.safeReplyReady ? `已就绪 v${row.knowledgeVersion}` : '资料待完善' }}</el-tag><div v-if="!row.safeReplyReady" class="readiness-issues">{{ row.safeReplyIssues.join('、') }}</div></template></el-table-column><el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="statusTagType(row.status)">{{ statusLabels[row.status as JobPositionStatus] }}</el-tag></template></el-table-column><el-table-column v-if="canManage" label="操作" width="310" fixed="right"><template #default="{ row }"><el-button v-if="row.reviewReadiness?.importedDraft" link type="warning" @click="openImportedReview(row as JobPosition)">完整审核</el-button><el-button link type="primary" @click="openKnowledge(row as JobPosition)">回复知识</el-button><el-button v-if="row.status !== 'CLOSED'" link type="primary" @click="openEdit(row as JobPosition)">编辑</el-button><el-button v-if="row.status === 'DRAFT' && row.captureSource === 'MANUAL'" link type="success" :loading="changingStatusId === row.id" @click="changeStatus(row as JobPosition, 'ACTIVE')">启用</el-button><el-button v-if="row.status !== 'CLOSED'" link type="danger" :loading="changingStatusId === row.id" @click="changeStatus(row as JobPosition, 'CLOSED')">关闭</el-button></template></el-table-column></el-table>
          <div class="job-cards"><article v-for="job in jobs" :key="job.id"><header><div class="job-identity"><strong>{{ job.title }}</strong><span>{{ job.location }} · {{ salaryLabel(job) }}</span></div><el-tag :type="statusTagType(job.status)" size="small">{{ statusLabels[job.status] }}</el-tag></header><dl><div><dt>归属企业</dt><dd>{{ job.company.name }}</dd></div><div><dt>BOSS 账号</dt><dd>{{ job.bossAccount.displayName }}</dd></div><div><dt>资料来源</dt><dd>{{ captureLabel(job) }}</dd></div><div><dt>经验 / 学历</dt><dd>{{ job.experienceRequirement }} · {{ job.educationRequirement }}</dd></div></dl><p class="job-description">{{ job.description }}</p><footer v-if="canManage && job.status !== 'CLOSED'"><el-button v-if="job.reviewReadiness?.importedDraft" type="warning" plain @click="openImportedReview(job)">完整审核</el-button><el-button @click="openEdit(job)">编辑</el-button><el-button v-if="job.status === 'DRAFT' && job.captureSource === 'MANUAL'" type="success" plain :loading="changingStatusId === job.id" @click="changeStatus(job, 'ACTIVE')">启用</el-button><el-button type="danger" plain :loading="changingStatusId === job.id" @click="changeStatus(job, 'CLOSED')">关闭</el-button></footer></article></div>
        </template>
      </section>
    </template>

    <el-dialog v-model="dialogOpen" :title="dialogTitle" width="760px" destroy-on-close><el-alert v-if="formError" :title="formError" type="error" :closable="false" show-icon class="dialog-alert" /><el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent="saveJob"><div class="form-grid"><el-form-item label="归属企业" prop="companyId" :error="fieldErrors.companyId"><el-select v-model="form.companyId" filterable placeholder="请选择有效企业"><el-option v-for="company in activeCompanies" :key="company.id" :label="`${company.name}（${company.code}）`" :value="company.id" /></el-select></el-form-item><el-form-item label="BOSS 账号" prop="bossAccountId" :error="fieldErrors.bossAccountId"><el-select v-model="form.bossAccountId" filterable placeholder="请选择可同步职位的账号"><el-option v-for="account in eligibleAccounts" :key="account.id" :label="`${account.displayName}（${account.externalIdentifier}）`" :value="account.id" /></el-select><div v-if="form.companyId && eligibleAccounts.length === 0" class="form-tip warning">该企业暂无具备“职位同步”能力的已启用账号</div></el-form-item><el-form-item label="职位名称" prop="title" :error="fieldErrors.title"><el-input v-model="form.title" maxlength="120" placeholder="例如：Java 开发工程师" /></el-form-item><el-form-item label="工作地点" prop="location" :error="fieldErrors.location"><el-input v-model="form.location" maxlength="120" placeholder="例如：上海·浦东" /></el-form-item><el-form-item label="月薪下限（K）" prop="salaryMinK" :error="fieldErrors.salaryMinK"><el-input-number v-model="form.salaryMinK" :min="1" :max="1000" controls-position="right" /></el-form-item><el-form-item label="月薪上限（K）" prop="salaryMaxK" :error="fieldErrors.salaryMaxK"><el-input-number v-model="form.salaryMaxK" :min="1" :max="1000" controls-position="right" /></el-form-item><el-form-item label="薪数" prop="salaryMonths" :error="fieldErrors.salaryMonths"><el-input-number v-model="form.salaryMonths" :min="12" :max="16" controls-position="right" /></el-form-item><el-form-item label="经验要求" prop="experienceRequirement" :error="fieldErrors.experienceRequirement"><el-input v-model="form.experienceRequirement" maxlength="80" placeholder="例如：3-5 年" /></el-form-item><el-form-item label="学历要求" prop="educationRequirement" :error="fieldErrors.educationRequirement"><el-input v-model="form.educationRequirement" maxlength="80" placeholder="例如：本科及以上" /></el-form-item></div><el-form-item label="职位描述（JD）" prop="description" :error="fieldErrors.description"><el-input v-model="form.description" type="textarea" :rows="6" maxlength="10000" show-word-limit placeholder="请说明岗位职责、工作内容和任职条件" /></el-form-item><el-form-item label="筛选要求" prop="screeningRequirements" :error="fieldErrors.screeningRequirements"><el-input v-model="form.screeningRequirements" type="textarea" :rows="4" maxlength="5000" show-word-limit placeholder="用于后续规则筛选和 AI 建议，例如必备技能、排除条件" /></el-form-item></el-form><template #footer><el-button @click="dialogOpen = false">取消</el-button><el-button type="primary" :loading="saving" @click="saveJob">{{ editingJob ? '保存修改' : '创建草稿' }}</el-button></template></el-dialog>
    <el-dialog v-model="knowledgeDialogOpen" :title="`${knowledgeJob?.title ?? ''} · 回复知识`" width="650px"><el-alert title="这里只生成预览；测试阶段不会向 BOSS 发送任何消息。公司资料未审核时会自动使用通用接待语。" type="warning" :closable="false" show-icon class="dialog-alert"/><el-form label-position="top"><el-form-item label="候选人可见的岗位简介"><el-input v-model="knowledgeForm.replySummary" type="textarea" :rows="4" maxlength="1000" show-word-limit placeholder="用简洁、准确、无夸大的语言说明主要工作" /></el-form-item><el-form-item label="候选人可见的薪资说明（可选）"><el-input v-model="knowledgeForm.salaryDisplay" maxlength="120" placeholder="例如：20-30K·13薪，具体以面试沟通为准" /></el-form-item><el-checkbox v-model="knowledgeForm.approved">我已核对内容，同意用于回复预览</el-checkbox></el-form><div v-if="preview" class="reply-preview"><el-tag :type="preview.mode === 'KNOWLEDGE' ? 'success' : 'warning'">{{ preview.mode === 'KNOWLEDGE' ? '知识回复' : '通用回退' }}</el-tag><p>{{ preview.content }}</p><small v-if="preview.missingFields.length">缺少：{{ preview.missingFields.join('、') }}</small></div><template #footer><el-button @click="loadPreview">生成安全预览</el-button><el-button type="primary" :loading="knowledgeSaving" @click="saveKnowledge">保存</el-button></template></el-dialog>
    <el-dialog v-model="reviewDialogOpen" :title="`${reviewJob?.title ?? ''} · 完成真实岗位审核`" width="780px" destroy-on-close><el-alert :title="reviewJob?.captureSource === 'VISIBLE_PAGE' ? '地点、薪资、经验和学历已从当前 BOSS 职位页预填；请补充真实职位描述并逐项核对后启用。' : '本操作会一次保存岗位详情、确认页面来源、审核岗位回复知识并启用岗位。企业知识必须已由系统管理员审核。'" type="warning" :closable="false" show-icon class="dialog-alert"/><el-form ref="reviewFormRef" :model="reviewForm" :rules="reviewRules" label-position="top"><div class="form-grid"><el-form-item label="工作地点" prop="location"><el-input v-model="reviewForm.location" maxlength="120"/></el-form-item><el-form-item label="月薪下限（K）"><el-input-number v-model="reviewForm.salaryMinK" :min="1" :max="1000"/></el-form-item><el-form-item label="月薪上限（K）"><el-input-number v-model="reviewForm.salaryMaxK" :min="1" :max="1000"/></el-form-item><el-form-item label="薪数"><el-input-number v-model="reviewForm.salaryMonths" :min="12" :max="16"/></el-form-item><el-form-item label="经验要求" prop="experienceRequirement"><el-input v-model="reviewForm.experienceRequirement" maxlength="80"/></el-form-item><el-form-item label="学历要求" prop="educationRequirement"><el-input v-model="reviewForm.educationRequirement" maxlength="80"/></el-form-item></div><el-form-item label="职位描述" prop="description"><el-input v-model="reviewForm.description" type="textarea" :rows="5" maxlength="10000" show-word-limit placeholder="请补充候选人可理解的真实工作内容与职责"/></el-form-item><el-form-item label="筛选要求（可选）"><el-input v-model="reviewForm.screeningRequirements" type="textarea" :rows="3" maxlength="5000" show-word-limit/></el-form-item><el-form-item label="候选人可见的岗位简介" prop="replySummary"><el-input v-model="reviewForm.replySummary" type="textarea" :rows="4" maxlength="1000" show-word-limit placeholder="只填写已确认、可对候选人公开的岗位基本信息"/></el-form-item><el-form-item label="候选人可见的薪资说明（可选）"><el-input v-model="reviewForm.salaryDisplay" maxlength="120" placeholder="例如：20-30K·13薪，具体以面试沟通为准"/></el-form-item><div class="review-confirmations"><el-checkbox v-model="reviewForm.captureConfirmed">我已对照真实 BOSS 岗位页核对上述资料</el-checkbox><el-checkbox v-model="reviewForm.knowledgeApproved">我确认岗位简介准确、无夸大或录用承诺</el-checkbox><el-checkbox v-model="reviewForm.activateConfirmed">我确认现在启用此岗位，并参与严格标题匹配</el-checkbox></div></el-form><template #footer><el-button @click="reviewDialogOpen=false">取消</el-button><el-button type="primary" :loading="reviewSaving" @click="completeImportedReview">确认审核并启用</el-button></template></el-dialog>
  </div>
</template>

<style scoped>
.browser-import-guide{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:20px;padding:18px 20px;border-left:4px solid var(--primary)}
.browser-import-guide p{margin:5px 0;color:var(--text-secondary);font-size:13px;line-height:1.6}
.browser-import-guide small{color:var(--text-secondary)}
.scope-alert{margin-bottom:20px}.metrics-strip{display:grid;grid-template-columns:repeat(4,1fr);margin-bottom:20px;border:1px solid var(--border);border-radius:12px;background:var(--surface);overflow:hidden}.metrics-strip div{padding:18px 24px;border-right:1px solid var(--border)}.metrics-strip div:last-child{border:0}.metrics-strip span,.metrics-strip strong{display:block}.metrics-strip span{color:var(--text-secondary);font-size:12px}.metrics-strip strong{margin-top:5px;font-size:24px}.jobs-panel{overflow:hidden}.jobs-title{align-items:flex-end}.filters{display:grid;grid-template-columns:minmax(220px,280px) 155px 125px auto;gap:8px}.jobs-table{width:100%}.job-identity strong,.job-identity span{display:block}.job-identity span,.muted{margin-top:4px;color:var(--text-secondary);font-size:12px}.readiness-issues{margin-top:5px;color:var(--warning);font-size:11px;line-height:1.35}.job-cards{display:none}.dialog-alert{margin-bottom:18px}.form-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:0 18px}.form-grid .el-select,.form-grid .el-input-number{width:100%}.form-tip{margin-top:6px;font-size:12px;line-height:1.45}.form-tip.warning{color:var(--warning)}
.reply-preview{margin-top:18px;padding:16px;border:1px solid var(--border);border-radius:10px;background:var(--surface-muted)}.reply-preview p{line-height:1.7}.reply-preview small{color:var(--warning)}
.review-queue{margin-bottom:20px}.review-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;padding:0 20px 20px}.review-cards article{padding:16px;border:1px solid #f0d49b;border-radius:12px;background:#fffaf3}.review-cards header,.review-cards footer{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.review-steps{display:grid;grid-template-columns:repeat(5,1fr);gap:5px;margin:14px 0}.review-steps span{padding:7px 5px;border-radius:7px;background:#f2f4f7;color:var(--text-secondary);font-size:10px;text-align:center}.review-steps span.done{background:#dcfae6;color:#067647}.review-cards article>p{margin:0 0 13px;color:#b54708;font-size:12px}.review-confirmations{display:grid;gap:10px;padding:14px;border:1px solid #f0d49b;border-radius:10px;background:#fffaf3}.review-confirmations .el-checkbox{height:auto;white-space:normal}.review-confirmations .el-checkbox+.el-checkbox{margin-left:0}
.captured-job-detail{padding:8px 36px 22px}.captured-job-detail h3{margin:0 0 14px}.captured-job-detail dl{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:0}.captured-job-detail dl div{padding:11px;border-radius:8px;background:var(--surface-muted)}.captured-job-detail dt{color:var(--text-secondary);font-size:12px}.captured-job-detail dd{margin:5px 0 0;line-height:1.5}.captured-job-detail section{margin-top:14px;padding:14px;border:1px solid var(--border);border-radius:9px}.captured-job-detail section p{margin:8px 0 0;white-space:pre-wrap;line-height:1.7}
@media(max-width:1250px){.jobs-title{display:grid}.filters{width:100%;grid-template-columns:minmax(200px,1fr) 150px 120px auto}}
@media(max-width:720px){.metrics-strip div{padding:14px 12px}.metrics-strip strong{font-size:21px}.filters,.review-cards{grid-template-columns:1fr}.jobs-table{display:none}.job-cards{display:grid;gap:12px;padding:14px}.job-cards article{padding:16px;border:1px solid var(--border);border-radius:10px}.job-cards header{display:flex;justify-content:space-between;gap:12px}.job-cards dl{display:grid;gap:11px;margin:17px 0}.job-cards dl div{display:grid;grid-template-columns:90px 1fr;gap:10px}.job-cards dt{color:var(--text-secondary);font-size:13px}.job-cards dd{margin:0;font-size:13px}.job-description{display:-webkit-box;margin:0;color:var(--text-secondary);font-size:13px;line-height:1.6;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:3}.job-cards footer{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:18px}.job-cards footer .el-button{min-height:42px;margin:0}.job-cards footer .el-button:last-child:nth-child(3){grid-column:1/-1}.form-grid{grid-template-columns:1fr}}
</style>
