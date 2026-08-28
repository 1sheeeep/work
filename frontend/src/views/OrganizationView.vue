<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import type { FormInstance, FormRules } from 'element-plus'
import { ElMessage, ElMessageBox } from 'element-plus'
import { EditPen, OfficeBuilding, Plus, Refresh, Search } from '@element-plus/icons-vue'
import { api, apiErrorMessage, apiFieldErrors, ensureCsrf } from '../services/api'
import { authStore } from '../stores/auth'
import type { Company, CompanyFormValue, CompanyStatus, GroupProfile } from '../types'

interface GroupFormValue { name: string; shortName: string; timezone: string; description: string }

const loading = ref(true)
const loadError = ref('')
const group = ref<GroupProfile | null>(null)
const companies = ref<Company[]>([])
const groupEditing = ref(false)
const groupSaving = ref(false)
const groupError = ref('')
const groupFormRef = ref<FormInstance>()
const groupForm = reactive<GroupFormValue>({ name: '', shortName: '', timezone: 'Asia/Shanghai', description: '' })
const groupFieldErrors = reactive<Record<string, string>>({})
const companyStats = reactive({ total: 0, active: 0, inactive: 0 })
const groupRules: FormRules<GroupFormValue> = {
  name: [{ required: true, message: '请输入集团名称', trigger: 'blur' }, { max: 120, message: '最多 120 个字符', trigger: 'blur' }],
  shortName: [{ required: true, message: '请输入集团简称', trigger: 'blur' }, { max: 60, message: '最多 60 个字符', trigger: 'blur' }],
  timezone: [{ required: true, message: '请选择时区', trigger: 'change' }],
  description: [{ max: 500, message: '最多 500 个字符', trigger: 'blur' }],
}

const keyword = ref('')
const statusFilter = ref<CompanyStatus | ''>('')
const companiesLoading = ref(false)
const companyDialogOpen = ref(false)
const companySaving = ref(false)
const editingCompany = ref<Company | null>(null)
const companyError = ref('')
const companyFormRef = ref<FormInstance>()
const companyForm = reactive<CompanyFormValue>({ name: '', code: '', location: '', notes: '' })
const companyFieldErrors = reactive<Record<string, string>>({})
const companyRules: FormRules<CompanyFormValue> = {
  name: [{ required: true, message: '请输入企业名称', trigger: 'blur' }, { max: 120, message: '最多 120 个字符', trigger: 'blur' }],
  code: [
    { required: true, message: '请输入企业编码', trigger: 'blur' },
    { pattern: /^[A-Za-z0-9_-]{2,32}$/, message: '请输入 2-32 位字母、数字、下划线或短横线', trigger: 'blur' },
  ],
  location: [{ max: 120, message: '最多 120 个字符', trigger: 'blur' }],
  notes: [{ max: 500, message: '最多 500 个字符', trigger: 'blur' }],
}

const dialogTitle = computed(() => editingCompany.value ? '编辑企业' : '新增企业')
const canManage = computed(() => authStore.state.user?.role === 'SYSTEM_ADMIN')

function assignFieldErrors(target: Record<string, string>, source: Record<string, string>) {
  Object.keys(target).forEach((key) => delete target[key])
  Object.assign(target, source)
}

function hydrateGroupForm(value: GroupProfile) {
  groupForm.name = value.name
  groupForm.shortName = value.shortName
  groupForm.timezone = value.timezone
  groupForm.description = value.description ?? ''
}

function updateCompanyStats(items: Company[]) {
  companyStats.total = items.length
  companyStats.active = items.filter((company) => company.status === 'ACTIVE').length
  companyStats.inactive = companyStats.total - companyStats.active
}

async function loadAll() {
  loading.value = true
  loadError.value = ''
  try {
    const [groupResponse, companiesResponse] = await Promise.all([
      api.get<GroupProfile>('/organization/group'),
      api.get<Company[]>('/organization/companies'),
    ])
    group.value = groupResponse.data
    companies.value = companiesResponse.data
    updateCompanyStats(companiesResponse.data)
    hydrateGroupForm(groupResponse.data)
  } catch (error) {
    loadError.value = apiErrorMessage(error, '组织资料加载失败，请检查服务状态后重试')
  } finally {
    loading.value = false
  }
}

async function loadCompanyStats() {
  const { data } = await api.get<Company[]>('/organization/companies')
  updateCompanyStats(data)
}

async function loadCompanies() {
  companiesLoading.value = true
  try {
    const { data } = await api.get<Company[]>('/organization/companies', {
      params: { keyword: keyword.value.trim() || undefined, status: statusFilter.value || undefined },
    })
    companies.value = data
  } catch (error) {
    ElMessage.error(apiErrorMessage(error, '企业列表加载失败，请重试'))
  } finally {
    companiesLoading.value = false
  }
}

async function refreshCompanyViews() {
  await loadCompanies()
  try {
    await loadCompanyStats()
  } catch {
    ElMessage.warning('企业操作已完成，但概览统计刷新失败，请稍后刷新页面')
  }
}

function beginGroupEdit() {
  if (group.value) hydrateGroupForm(group.value)
  groupError.value = ''
  assignFieldErrors(groupFieldErrors, {})
  groupEditing.value = true
}

function cancelGroupEdit() {
  if (group.value) hydrateGroupForm(group.value)
  groupEditing.value = false
}

async function saveGroup() {
  groupError.value = ''
  assignFieldErrors(groupFieldErrors, {})
  if (!(await groupFormRef.value?.validate().catch(() => false))) return
  groupSaving.value = true
  try {
    await ensureCsrf()
    const { data } = await api.put<GroupProfile>('/organization/group', groupForm)
    group.value = data
    hydrateGroupForm(data)
    groupEditing.value = false
    ElMessage.success('集团资料已更新')
  } catch (error) {
    assignFieldErrors(groupFieldErrors, apiFieldErrors(error))
    groupError.value = apiErrorMessage(error, '集团资料保存失败，请重试')
  } finally {
    groupSaving.value = false
  }
}

function openCreateCompany() {
  editingCompany.value = null
  Object.assign(companyForm, { name: '', code: '', location: '', notes: '' })
  companyError.value = ''
  assignFieldErrors(companyFieldErrors, {})
  companyDialogOpen.value = true
}

function openEditCompany(company: Company) {
  editingCompany.value = company
  Object.assign(companyForm, {
    name: company.name, code: company.code, location: company.location ?? '', notes: company.notes ?? '',
  })
  companyError.value = ''
  assignFieldErrors(companyFieldErrors, {})
  companyDialogOpen.value = true
}

async function saveCompany() {
  companyError.value = ''
  assignFieldErrors(companyFieldErrors, {})
  if (!(await companyFormRef.value?.validate().catch(() => false))) return
  companySaving.value = true
  try {
    await ensureCsrf()
    if (editingCompany.value) {
      await api.put(`/organization/companies/${editingCompany.value.id}`, companyForm)
      ElMessage.success('企业资料已更新')
    } else {
      await api.post('/organization/companies', companyForm)
      ElMessage.success('企业已新增')
    }
    companyDialogOpen.value = false
    await refreshCompanyViews()
  } catch (error) {
    assignFieldErrors(companyFieldErrors, apiFieldErrors(error))
    companyError.value = apiErrorMessage(error, '企业保存失败，请重试')
  } finally {
    companySaving.value = false
  }
}

async function toggleCompanyStatus(company: Company) {
  const nextStatus: CompanyStatus = company.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'
  const verb = nextStatus === 'INACTIVE' ? '停用' : '启用'
  if (nextStatus === 'INACTIVE') {
    try {
      await ElMessageBox.confirm(
        `停用后，“${company.name}”将不能用于新增业务配置，但历史数据会保留。`,
        '确认停用企业',
        { confirmButtonText: '确认停用', cancelButtonText: '取消', type: 'warning' },
      )
    } catch {
      return
    }
  }
  try {
    await ensureCsrf()
    await api.patch(`/organization/companies/${company.id}/status`, { status: nextStatus })
    ElMessage.success(`企业已${verb}`)
    await refreshCompanyViews()
  } catch (error) {
    ElMessage.error(apiErrorMessage(error, `${verb}失败，请重试`))
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

onMounted(loadAll)
</script>

<template>
  <div class="page-shell">
    <header class="page-heading">
      <div><h1>集团与企业</h1><p>维护集团统一资料和企业用工主体，为后续 BOSS 账号与职位归属提供可靠边界。</p></div>
      <el-button v-if="canManage" type="primary" :icon="Plus" @click="openCreateCompany">新增企业</el-button>
    </header>

    <div v-if="loading" class="surface-panel skeleton-stack" aria-label="正在加载组织资料">
      <el-skeleton :rows="7" animated />
    </div>
    <div v-else-if="loadError" class="surface-panel error-state" role="alert">
      <span class="error-state__icon"><el-icon><Refresh /></el-icon></span><strong>组织资料暂时无法加载</strong><span>{{ loadError }}</span>
      <el-button :icon="Refresh" @click="loadAll">重新加载</el-button>
    </div>
    <template v-else>
      <section class="surface-panel group-panel" aria-labelledby="group-heading">
        <div class="section-title-row">
          <div><h2 id="group-heading">集团资料</h2><p>集团是当前系统的最高管理层级</p></div>
          <el-button v-if="canManage && !groupEditing" :icon="EditPen" @click="beginGroupEdit">编辑集团资料</el-button>
        </div>
        <div v-if="groupEditing" class="group-form-wrap">
          <el-alert v-if="groupError" :title="groupError" type="error" :closable="false" show-icon />
          <el-form ref="groupFormRef" :model="groupForm" :rules="groupRules" label-position="top">
            <div class="form-grid">
              <el-form-item label="集团名称" prop="name" :error="groupFieldErrors.name"><el-input v-model="groupForm.name" maxlength="120" /></el-form-item>
              <el-form-item label="集团简称" prop="shortName" :error="groupFieldErrors.shortName"><el-input v-model="groupForm.shortName" maxlength="60" /></el-form-item>
              <el-form-item label="默认时区" prop="timezone" :error="groupFieldErrors.timezone">
                <el-select v-model="groupForm.timezone"><el-option label="中国标准时间（Asia/Shanghai）" value="Asia/Shanghai" /></el-select>
              </el-form-item>
              <el-form-item class="wide-field" label="集团说明" prop="description" :error="groupFieldErrors.description">
                <el-input v-model="groupForm.description" type="textarea" :rows="3" maxlength="500" show-word-limit />
              </el-form-item>
            </div>
            <div class="form-actions"><el-button @click="cancelGroupEdit">取消</el-button><el-button type="primary" :loading="groupSaving" @click="saveGroup">保存集团资料</el-button></div>
          </el-form>
        </div>
        <div v-else-if="group" class="group-summary">
          <div class="group-identity"><span class="group-symbol"><OfficeBuilding /></span><div><strong>{{ group.name }}</strong><span>{{ group.shortName }}</span></div></div>
          <dl class="detail-list">
            <div><dt>默认时区</dt><dd>{{ group.timezone }}</dd></div>
            <div><dt>集团说明</dt><dd>{{ group.description || '尚未填写' }}</dd></div>
            <div><dt>最近更新</dt><dd>{{ formatDate(group.updatedAt) }}</dd></div>
          </dl>
        </div>
      </section>

      <div class="metrics-strip" aria-label="企业概览">
        <div><span>企业总数</span><strong>{{ companyStats.total }}</strong></div>
        <div><span>正常企业</span><strong>{{ companyStats.active }}</strong></div>
        <div><span>已停用</span><strong>{{ companyStats.inactive }}</strong></div>
      </div>

      <section class="surface-panel companies-panel" aria-labelledby="companies-heading">
        <div class="section-title-row companies-title-row">
          <div><h2 id="companies-heading">企业列表</h2><p>正式职位和 BOSS 账号都必须归属一个具体企业</p></div>
          <div class="company-filters">
            <el-input v-model="keyword" clearable placeholder="搜索名称或编码" :prefix-icon="Search" aria-label="搜索企业" @keyup.enter="loadCompanies" @clear="loadCompanies" />
            <el-select v-model="statusFilter" aria-label="筛选企业状态" @change="loadCompanies">
              <el-option label="全部状态" value="" /><el-option label="正常" value="ACTIVE" /><el-option label="已停用" value="INACTIVE" />
            </el-select>
            <el-button :loading="companiesLoading" @click="loadCompanies">查询</el-button>
          </div>
        </div>

        <div v-if="companiesLoading && companies.length === 0" class="skeleton-stack"><el-skeleton :rows="4" animated /></div>
        <div v-else-if="companies.length === 0" class="empty-state">
          <span class="empty-state__icon"><el-icon><OfficeBuilding /></el-icon></span><strong>还没有符合条件的企业</strong><span>新增企业后，后续账号和职位才能建立明确归属。</span>
          <el-button v-if="canManage" type="primary" :icon="Plus" @click="openCreateCompany">新增企业</el-button>
        </div>
        <template v-else>
          <el-table v-loading="companiesLoading" :data="companies" class="company-table">
            <el-table-column label="企业" min-width="210"><template #default="{ row }"><div class="company-name"><strong>{{ row.name }}</strong><span>{{ row.code }}</span></div></template></el-table-column>
            <el-table-column prop="location" label="所在地" min-width="140"><template #default="{ row }">{{ row.location || '未填写' }}</template></el-table-column>
            <el-table-column label="状态" width="110"><template #default="{ row }"><el-tag :type="row.status === 'ACTIVE' ? 'success' : 'info'" effect="light">{{ row.status === 'ACTIVE' ? '正常' : '已停用' }}</el-tag></template></el-table-column>
            <el-table-column label="更新时间" min-width="180"><template #default="{ row }">{{ formatDate(row.updatedAt) }}</template></el-table-column>
            <el-table-column v-if="canManage" label="操作" width="180" fixed="right"><template #default="{ row }"><el-button link type="primary" @click="openEditCompany(row as Company)">编辑</el-button><el-button link :type="row.status === 'ACTIVE' ? 'danger' : 'success'" @click="toggleCompanyStatus(row as Company)">{{ row.status === 'ACTIVE' ? '停用' : '启用' }}</el-button></template></el-table-column>
          </el-table>
          <div class="company-cards">
            <article v-for="company in companies" :key="company.id" class="company-card">
              <header><div><strong>{{ company.name }}</strong><span>{{ company.code }}</span></div><el-tag :type="company.status === 'ACTIVE' ? 'success' : 'info'" size="small">{{ company.status === 'ACTIVE' ? '正常' : '已停用' }}</el-tag></header>
              <dl><div><dt>所在地</dt><dd>{{ company.location || '未填写' }}</dd></div><div><dt>更新时间</dt><dd>{{ formatDate(company.updatedAt) }}</dd></div></dl>
              <footer v-if="canManage"><el-button @click="openEditCompany(company)">编辑</el-button><el-button :type="company.status === 'ACTIVE' ? 'danger' : 'success'" plain @click="toggleCompanyStatus(company)">{{ company.status === 'ACTIVE' ? '停用' : '启用' }}</el-button></footer>
            </article>
          </div>
        </template>
      </section>
    </template>

    <el-dialog v-model="companyDialogOpen" :title="dialogTitle" width="560px" destroy-on-close>
      <el-alert v-if="companyError" :title="companyError" type="error" :closable="false" show-icon class="dialog-alert" />
      <el-form ref="companyFormRef" :model="companyForm" :rules="companyRules" label-position="top" @submit.prevent="saveCompany">
        <div class="form-grid">
          <el-form-item label="企业名称" prop="name" :error="companyFieldErrors.name"><el-input v-model="companyForm.name" maxlength="120" placeholder="例如：上海某某科技有限公司" /></el-form-item>
          <el-form-item label="企业编码" prop="code" :error="companyFieldErrors.code"><el-input v-model="companyForm.code" maxlength="32" placeholder="例如：SH_TECH" @input="companyForm.code = companyForm.code.toUpperCase()" /></el-form-item>
          <el-form-item class="wide-field" label="所在地" prop="location" :error="companyFieldErrors.location"><el-input v-model="companyForm.location" maxlength="120" placeholder="例如：上海市徐汇区" /></el-form-item>
          <el-form-item class="wide-field" label="备注" prop="notes" :error="companyFieldErrors.notes"><el-input v-model="companyForm.notes" type="textarea" :rows="3" maxlength="500" show-word-limit placeholder="可填写用工主体或招聘协作说明" /></el-form-item>
        </div>
      </el-form>
      <template #footer><el-button @click="companyDialogOpen = false">取消</el-button><el-button type="primary" :loading="companySaving" @click="saveCompany">{{ editingCompany ? '保存修改' : '确认新增' }}</el-button></template>
    </el-dialog>
  </div>
</template>

<style scoped>
.group-panel { overflow: hidden; }
.group-summary { display: grid; grid-template-columns: minmax(240px,.8fr) 1.2fr; gap: 32px; padding: 26px 24px; }
.group-identity { display: flex; align-items: center; gap: 16px; }
.group-symbol { display: grid; width: 52px; height: 52px; place-items: center; border-radius: 12px; background: var(--brand-100); color: var(--brand-700); }
.group-symbol svg { width: 25px; }
.group-identity strong, .group-identity span { display: block; }
.group-identity strong { font-size: 19px; }
.group-identity span { margin-top: 5px; color: var(--text-secondary); font-size: 13px; }
.detail-list { display: grid; grid-template-columns: .7fr 1.3fr .9fr; gap: 24px; margin: 0; }
.detail-list dt { color: var(--text-secondary); font-size: 12px; }
.detail-list dd { margin: 7px 0 0; font-size: 14px; line-height: 1.55; }
.group-form-wrap { padding: 24px; }
.group-form-wrap .el-alert { margin-bottom: 18px; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 18px; }
.wide-field { grid-column: 1 / -1; }
.form-actions { display: flex; justify-content: flex-end; gap: 8px; }
.metrics-strip { display: grid; grid-template-columns: repeat(3,1fr); margin: 20px 0; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); overflow: hidden; }
.metrics-strip div { padding: 18px 24px; border-right: 1px solid var(--border); }
.metrics-strip div:last-child { border-right: 0; }
.metrics-strip span, .metrics-strip strong { display: block; }
.metrics-strip span { color: var(--text-secondary); font-size: 12px; }
.metrics-strip strong { margin-top: 5px; font-size: 24px; font-variant-numeric: tabular-nums; }
.companies-panel { overflow: hidden; }
.companies-title-row { align-items: flex-end; }
.company-filters { display: grid; grid-template-columns: minmax(190px,260px) 130px auto; gap: 8px; }
.company-name strong, .company-name span { display: block; }
.company-name span { margin-top: 4px; color: var(--text-secondary); font-family: "Cascadia Code", monospace; font-size: 12px; }
.company-table { width: 100%; }
.company-cards { display: none; }
.dialog-alert { margin-bottom: 18px; }
@media (max-width: 1000px) {
  .group-summary { grid-template-columns: 1fr; }
  .companies-title-row { display: grid; }
  .company-filters { grid-template-columns: minmax(180px,1fr) 130px auto; width: 100%; }
}
@media (max-width: 720px) {
  .group-summary { gap: 24px; padding: 20px 16px; }
  .detail-list { grid-template-columns: 1fr; gap: 18px; }
  .group-form-wrap { padding: 18px 16px; }
  .form-grid { grid-template-columns: 1fr; }
  .wide-field { grid-column: auto; }
  .metrics-strip div { padding: 14px 12px; }
  .metrics-strip strong { font-size: 21px; }
  .company-filters { grid-template-columns: 1fr; }
  .company-table { display: none; }
  .company-cards { display: grid; gap: 12px; padding: 14px; }
  .company-card { padding: 16px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
  .company-card header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .company-card header strong, .company-card header span { display: block; }
  .company-card header span { margin-top: 4px; color: var(--text-secondary); font-family: "Cascadia Code", monospace; font-size: 12px; }
  .company-card dl { display: grid; gap: 12px; margin: 18px 0; }
  .company-card dl div { display: grid; grid-template-columns: 74px 1fr; gap: 10px; }
  .company-card dt { color: var(--text-secondary); font-size: 13px; }
  .company-card dd { margin: 0; font-size: 13px; }
  .company-card footer { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .company-card footer .el-button { min-height: 44px; margin: 0; }
}
</style>
