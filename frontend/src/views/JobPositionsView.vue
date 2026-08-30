<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
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

const loading = ref(true)
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
const verifyingCaptureId = ref('')
const knowledgeDialogOpen = ref(false)
const knowledgeJob = ref<JobPosition | null>(null)
const knowledgeSaving = ref(false)
const knowledgeForm = reactive({ replySummary: '', salaryDisplay: '', approved: false })
const preview = ref<{ mode: string; content: string; missingFields: string[] } | null>(null)

const canManage = computed(() => ['SYSTEM_ADMIN', 'RECRUITMENT_ADMIN'].includes(authStore.state.user?.role ?? ''))
const activeCompanies = computed(() => companies.value.filter((company) => company.status === 'ACTIVE'))
const eligibleAccounts = computed(() => bossAccounts.value.filter((account) =>
  account.company.id === form.companyId && account.status === 'ACTIVE' && account.capabilities.includes('JOB_SYNC')))
const stats = computed(() => ({
  total: jobs.value.length,
  active: jobs.value.filter((job) => job.status === 'ACTIVE').length,
  draft: jobs.value.filter((job) => job.status === 'DRAFT').length,
  safeReady: jobs.value.filter((job) => job.status === 'ACTIVE' && job.safeReplyReady).length,
}))
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
  const formalAccount = bossAccounts.value.find((account) => account.gatewayType === 'BROWSER_COMPANION' && account.status === 'ACTIVE' && account.capabilities.includes('JOB_SYNC'))
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

function salaryLabel(job: JobPosition) { return `${job.salaryMinK}-${job.salaryMaxK}K·${job.salaryMonths}薪` }
function captureLabel(job: JobPosition) { return job.captureSource === 'VISIBLE_PAGE' ? `页面采集${job.captureCompleteness ? ` · ${job.captureCompleteness}/6` : ''} · ${job.captureVerified ? '已核对' : '待核对'}` : '手工录入' }

async function verifyCapture(job: JobPosition) {
  try {
    await ElMessageBox.confirm(`请确认已在 BOSS 岗位详情页逐项核对「${job.title}」的名称、地点、薪资、经验、学历和职位描述。确认后才能用于带岗位信息的安全草稿。`, '确认页面采集资料', { type: 'warning', confirmButtonText: '已核对并确认', cancelButtonText: '取消' })
  } catch { return }
  verifyingCaptureId.value = job.id
  try {
    await ensureCsrf()
    await api.patch(`/job-positions/${job.id}/capture-verification`)
    ElMessage.success('页面采集资料已核对，可继续审核回复知识')
    await loadData()
  } catch (error) { ElMessage.error(apiErrorMessage(error, '页面采集核对失败')) }
  finally { verifyingCaptureId.value = '' }
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

onMounted(loadData)
</script>

<template>
  <div class="page-shell">
    <header class="page-heading"><div><h1>职位管理</h1><p>统一管理企业职位、筛选要求和 BOSS 账号绑定，为候选人会话与回复模板提供上下文。</p></div><el-button v-if="canManage" type="primary" :icon="Plus" @click="openCreate">新增职位</el-button></header>
    <el-alert title="职位只能绑定同企业、已启用且通过能力检查的 BOSS 账号；关闭后保留历史且不可重新启用。" type="info" :closable="false" show-icon class="scope-alert" />
    <div v-if="loading" class="surface-panel skeleton-stack"><el-skeleton :rows="7" animated /></div>
    <div v-else-if="loadError" class="surface-panel error-state" role="alert"><span class="error-state__icon"><el-icon><Refresh /></el-icon></span><strong>职位暂时无法加载</strong><span>{{ loadError }}</span><el-button :icon="Refresh" @click="loadData">重新加载</el-button></div>
    <template v-else>
      <div class="metrics-strip"><div><span>职位总数</span><strong>{{ stats.total }}</strong></div><div><span>已启用</span><strong>{{ stats.active }}</strong></div><div><span>安全草稿就绪</span><strong>{{ stats.safeReady }}</strong></div><div><span>待完善草稿</span><strong>{{ stats.draft }}</strong></div></div>
      <section class="surface-panel jobs-panel">
        <div class="section-title-row jobs-title"><div><h2>职位列表</h2><p>草稿完善后才可启用，启用时会再次校验 BOSS Capability</p></div><div class="filters"><el-input v-model="keyword" clearable placeholder="搜索职位、地点或 BOSS 账号" :prefix-icon="Search" @keyup.enter="loadData" /><el-select v-model="companyFilter" clearable placeholder="全部企业" @change="loadData"><el-option v-for="company in companies" :key="company.id" :label="company.name" :value="company.id" /></el-select><el-select v-model="statusFilter" placeholder="全部状态" @change="loadData"><el-option label="全部状态" value="" /><el-option label="草稿" value="DRAFT" /><el-option label="已启用" value="ACTIVE" /><el-option label="已关闭" value="CLOSED" /></el-select><el-button @click="loadData">查询</el-button></div></div>
        <div v-if="jobs.length === 0" class="empty-state"><span class="empty-state__icon"><el-icon><Briefcase /></el-icon></span><strong>还没有符合条件的职位</strong><span v-if="canManage">请先确保 BOSS 账号具备职位同步能力，再创建职位草稿。</span><span v-else>请联系招聘管理员创建职位。</span><el-button v-if="canManage" type="primary" :icon="Plus" @click="openCreate">新增职位</el-button></div>
        <template v-else>
          <el-table :data="jobs" class="jobs-table"><el-table-column label="职位" min-width="210"><template #default="{ row }"><div class="job-identity"><strong>{{ row.title }}</strong><span>{{ row.location }} · {{ salaryLabel(row as JobPosition) }}</span></div></template></el-table-column><el-table-column label="归属企业" min-width="165"><template #default="{ row }"><strong>{{ row.company.name }}</strong><div class="muted">{{ row.company.code }}</div></template></el-table-column><el-table-column label="BOSS 账号" min-width="175"><template #default="{ row }"><strong>{{ row.bossAccount.displayName }}</strong><div class="muted">{{ row.bossAccount.externalIdentifier }}</div></template></el-table-column><el-table-column label="资料来源" min-width="135"><template #default="{ row }"><el-tag :type="row.captureSource === 'VISIBLE_PAGE' ? (row.captureVerified ? 'success' : 'warning') : 'info'">{{ captureLabel(row as JobPosition) }}</el-tag><div v-if="row.captureSource === 'VISIBLE_PAGE'" class="muted">{{ row.captureVerified ? '已人工核对' : '需对照 BOSS 页面核对' }}</div></template></el-table-column><el-table-column label="安全草稿" min-width="160"><template #default="{ row }"><el-tag :type="row.safeReplyReady ? 'success' : 'warning'">{{ row.safeReplyReady ? `已就绪 v${row.knowledgeVersion}` : '资料待完善' }}</el-tag><div v-if="!row.safeReplyReady" class="readiness-issues">{{ row.safeReplyIssues.join('、') }}</div></template></el-table-column><el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="statusTagType(row.status)">{{ statusLabels[row.status as JobPositionStatus] }}</el-tag></template></el-table-column><el-table-column v-if="canManage" label="操作" width="310" fixed="right"><template #default="{ row }"><el-button v-if="row.captureSource === 'VISIBLE_PAGE' && !row.captureVerified" link type="warning" :loading="verifyingCaptureId === row.id" @click="verifyCapture(row as JobPosition)">核对采集</el-button><el-button link type="primary" @click="openKnowledge(row as JobPosition)">回复知识</el-button><el-button v-if="row.status !== 'CLOSED'" link type="primary" @click="openEdit(row as JobPosition)">编辑</el-button><el-button v-if="row.status === 'DRAFT'" link type="success" :loading="changingStatusId === row.id" @click="changeStatus(row as JobPosition, 'ACTIVE')">启用</el-button><el-button v-if="row.status !== 'CLOSED'" link type="danger" :loading="changingStatusId === row.id" @click="changeStatus(row as JobPosition, 'CLOSED')">关闭</el-button></template></el-table-column></el-table>
          <div class="job-cards"><article v-for="job in jobs" :key="job.id"><header><div class="job-identity"><strong>{{ job.title }}</strong><span>{{ job.location }} · {{ salaryLabel(job) }}</span></div><el-tag :type="statusTagType(job.status)" size="small">{{ statusLabels[job.status] }}</el-tag></header><dl><div><dt>归属企业</dt><dd>{{ job.company.name }}</dd></div><div><dt>BOSS 账号</dt><dd>{{ job.bossAccount.displayName }}</dd></div><div><dt>资料来源</dt><dd>{{ captureLabel(job) }}</dd></div><div><dt>经验 / 学历</dt><dd>{{ job.experienceRequirement }} · {{ job.educationRequirement }}</dd></div></dl><p class="job-description">{{ job.description }}</p><footer v-if="canManage && job.status !== 'CLOSED'"><el-button v-if="job.captureSource === 'VISIBLE_PAGE' && !job.captureVerified" type="warning" plain :loading="verifyingCaptureId === job.id" @click="verifyCapture(job)">核对采集</el-button><el-button @click="openEdit(job)">编辑</el-button><el-button v-if="job.status === 'DRAFT'" type="success" plain :loading="changingStatusId === job.id" @click="changeStatus(job, 'ACTIVE')">启用</el-button><el-button type="danger" plain :loading="changingStatusId === job.id" @click="changeStatus(job, 'CLOSED')">关闭</el-button></footer></article></div>
        </template>
      </section>
    </template>

    <el-dialog v-model="dialogOpen" :title="dialogTitle" width="760px" destroy-on-close><el-alert v-if="formError" :title="formError" type="error" :closable="false" show-icon class="dialog-alert" /><el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent="saveJob"><div class="form-grid"><el-form-item label="归属企业" prop="companyId" :error="fieldErrors.companyId"><el-select v-model="form.companyId" filterable placeholder="请选择有效企业"><el-option v-for="company in activeCompanies" :key="company.id" :label="`${company.name}（${company.code}）`" :value="company.id" /></el-select></el-form-item><el-form-item label="BOSS 账号" prop="bossAccountId" :error="fieldErrors.bossAccountId"><el-select v-model="form.bossAccountId" filterable placeholder="请选择可同步职位的账号"><el-option v-for="account in eligibleAccounts" :key="account.id" :label="`${account.displayName}（${account.externalIdentifier}）`" :value="account.id" /></el-select><div v-if="form.companyId && eligibleAccounts.length === 0" class="form-tip warning">该企业暂无具备“职位同步”能力的已启用账号</div></el-form-item><el-form-item label="职位名称" prop="title" :error="fieldErrors.title"><el-input v-model="form.title" maxlength="120" placeholder="例如：Java 开发工程师" /></el-form-item><el-form-item label="工作地点" prop="location" :error="fieldErrors.location"><el-input v-model="form.location" maxlength="120" placeholder="例如：上海·浦东" /></el-form-item><el-form-item label="月薪下限（K）" prop="salaryMinK" :error="fieldErrors.salaryMinK"><el-input-number v-model="form.salaryMinK" :min="1" :max="1000" controls-position="right" /></el-form-item><el-form-item label="月薪上限（K）" prop="salaryMaxK" :error="fieldErrors.salaryMaxK"><el-input-number v-model="form.salaryMaxK" :min="1" :max="1000" controls-position="right" /></el-form-item><el-form-item label="薪数" prop="salaryMonths" :error="fieldErrors.salaryMonths"><el-input-number v-model="form.salaryMonths" :min="12" :max="16" controls-position="right" /></el-form-item><el-form-item label="经验要求" prop="experienceRequirement" :error="fieldErrors.experienceRequirement"><el-input v-model="form.experienceRequirement" maxlength="80" placeholder="例如：3-5 年" /></el-form-item><el-form-item label="学历要求" prop="educationRequirement" :error="fieldErrors.educationRequirement"><el-input v-model="form.educationRequirement" maxlength="80" placeholder="例如：本科及以上" /></el-form-item></div><el-form-item label="职位描述（JD）" prop="description" :error="fieldErrors.description"><el-input v-model="form.description" type="textarea" :rows="6" maxlength="10000" show-word-limit placeholder="请说明岗位职责、工作内容和任职条件" /></el-form-item><el-form-item label="筛选要求" prop="screeningRequirements" :error="fieldErrors.screeningRequirements"><el-input v-model="form.screeningRequirements" type="textarea" :rows="4" maxlength="5000" show-word-limit placeholder="用于后续规则筛选和 AI 建议，例如必备技能、排除条件" /></el-form-item></el-form><template #footer><el-button @click="dialogOpen = false">取消</el-button><el-button type="primary" :loading="saving" @click="saveJob">{{ editingJob ? '保存修改' : '创建草稿' }}</el-button></template></el-dialog>
    <el-dialog v-model="knowledgeDialogOpen" :title="`${knowledgeJob?.title ?? ''} · 回复知识`" width="650px"><el-alert title="这里只生成预览；测试阶段不会向 BOSS 发送任何消息。公司资料未审核时会自动使用通用接待语。" type="warning" :closable="false" show-icon class="dialog-alert"/><el-form label-position="top"><el-form-item label="候选人可见的岗位简介"><el-input v-model="knowledgeForm.replySummary" type="textarea" :rows="4" maxlength="1000" show-word-limit placeholder="用简洁、准确、无夸大的语言说明主要工作" /></el-form-item><el-form-item label="候选人可见的薪资说明（可选）"><el-input v-model="knowledgeForm.salaryDisplay" maxlength="120" placeholder="例如：20-30K·13薪，具体以面试沟通为准" /></el-form-item><el-checkbox v-model="knowledgeForm.approved">我已核对内容，同意用于回复预览</el-checkbox></el-form><div v-if="preview" class="reply-preview"><el-tag :type="preview.mode === 'KNOWLEDGE' ? 'success' : 'warning'">{{ preview.mode === 'KNOWLEDGE' ? '知识回复' : '通用回退' }}</el-tag><p>{{ preview.content }}</p><small v-if="preview.missingFields.length">缺少：{{ preview.missingFields.join('、') }}</small></div><template #footer><el-button @click="loadPreview">生成安全预览</el-button><el-button type="primary" :loading="knowledgeSaving" @click="saveKnowledge">保存</el-button></template></el-dialog>
  </div>
</template>

<style scoped>
.scope-alert{margin-bottom:20px}.metrics-strip{display:grid;grid-template-columns:repeat(4,1fr);margin-bottom:20px;border:1px solid var(--border);border-radius:12px;background:var(--surface);overflow:hidden}.metrics-strip div{padding:18px 24px;border-right:1px solid var(--border)}.metrics-strip div:last-child{border:0}.metrics-strip span,.metrics-strip strong{display:block}.metrics-strip span{color:var(--text-secondary);font-size:12px}.metrics-strip strong{margin-top:5px;font-size:24px}.jobs-panel{overflow:hidden}.jobs-title{align-items:flex-end}.filters{display:grid;grid-template-columns:minmax(220px,280px) 155px 125px auto;gap:8px}.jobs-table{width:100%}.job-identity strong,.job-identity span{display:block}.job-identity span,.muted{margin-top:4px;color:var(--text-secondary);font-size:12px}.readiness-issues{margin-top:5px;color:var(--warning);font-size:11px;line-height:1.35}.job-cards{display:none}.dialog-alert{margin-bottom:18px}.form-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:0 18px}.form-grid .el-select,.form-grid .el-input-number{width:100%}.form-tip{margin-top:6px;font-size:12px;line-height:1.45}.form-tip.warning{color:var(--warning)}
.reply-preview{margin-top:18px;padding:16px;border:1px solid var(--border);border-radius:10px;background:var(--surface-muted)}.reply-preview p{line-height:1.7}.reply-preview small{color:var(--warning)}
@media(max-width:1250px){.jobs-title{display:grid}.filters{width:100%;grid-template-columns:minmax(200px,1fr) 150px 120px auto}}
@media(max-width:720px){.metrics-strip div{padding:14px 12px}.metrics-strip strong{font-size:21px}.filters{grid-template-columns:1fr}.jobs-table{display:none}.job-cards{display:grid;gap:12px;padding:14px}.job-cards article{padding:16px;border:1px solid var(--border);border-radius:10px}.job-cards header{display:flex;justify-content:space-between;gap:12px}.job-cards dl{display:grid;gap:11px;margin:17px 0}.job-cards dl div{display:grid;grid-template-columns:90px 1fr;gap:10px}.job-cards dt{color:var(--text-secondary);font-size:13px}.job-cards dd{margin:0;font-size:13px}.job-description{display:-webkit-box;margin:0;color:var(--text-secondary);font-size:13px;line-height:1.6;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:3}.job-cards footer{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:18px}.job-cards footer .el-button{min-height:42px;margin:0}.job-cards footer .el-button:last-child:nth-child(3){grid-column:1/-1}.form-grid{grid-template-columns:1fr}}
</style>
