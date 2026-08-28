<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import type { FormInstance, FormRules } from 'element-plus'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Key, Plus, Refresh, Search, User } from '@element-plus/icons-vue'
import { api, apiErrorMessage, apiFieldErrors, ensureCsrf } from '../services/api'
import type { Company, HrUser } from '../types'

type HrRole = 'RECRUITMENT_ADMIN' | 'RECRUITER'
interface UserFormValue { username: string; displayName: string; role: HrRole; password: string; companyIds: string[] }

const loading = ref(true)
const users = ref<HrUser[]>([])
const companies = ref<Company[]>([])
const loadError = ref('')
const keyword = ref('')
const roleFilter = ref<HrRole | ''>('')
const enabledFilter = ref<boolean | ''>('')
const dialogOpen = ref(false)
const saving = ref(false)
const editingUser = ref<HrUser | null>(null)
const formRef = ref<FormInstance>()
const form = reactive<UserFormValue>({ username: '', displayName: '', role: 'RECRUITER', password: '', companyIds: [] })
const formError = ref('')
const fieldErrors = reactive<Record<string, string>>({})
const passwordDialogOpen = ref(false)
const passwordSaving = ref(false)
const passwordUser = ref<HrUser | null>(null)
const newPassword = ref('')

const activeCompanies = computed(() => companies.value.filter((company) => company.status === 'ACTIVE'))
const stats = computed(() => ({
  total: users.value.length,
  enabled: users.value.filter((user) => user.enabled).length,
  admins: users.value.filter((user) => user.role === 'RECRUITMENT_ADMIN').length,
}))
const dialogTitle = computed(() => editingUser.value ? '编辑 HR 用户' : '新增 HR 用户')
const rules: FormRules<UserFormValue> = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { pattern: /^[A-Za-z0-9._-]+$/, message: '只能包含字母、数字、点、下划线和横线', trigger: 'blur' },
  ],
  displayName: [{ required: true, message: '请输入姓名', trigger: 'blur' }, { max: 100, message: '最多 100 个字符', trigger: 'blur' }],
  role: [{ required: true, message: '请选择角色', trigger: 'change' }],
  password: [{ validator: (_rule, value: string, callback) => {
    if (!editingUser.value && !value) callback(new Error('请输入初始密码'))
    else if (value && (value.length < 12 || value.length > 72)) callback(new Error('密码长度应为 12 至 72 位'))
    else callback()
  }, trigger: 'blur' }],
  companyIds: [{ type: 'array', required: true, min: 1, message: '请至少授权一家企业', trigger: 'change' }],
}

function roleLabel(role: HrRole) { return role === 'RECRUITMENT_ADMIN' ? '招聘管理员' : '招聘专员' }
function clearFieldErrors() { Object.keys(fieldErrors).forEach((key) => delete fieldErrors[key]) }

async function loadData() {
  loading.value = true
  loadError.value = ''
  try {
    const [usersResponse, companiesResponse] = await Promise.all([
      api.get<HrUser[]>('/hr-users', { params: { keyword: keyword.value.trim() || undefined, role: roleFilter.value || undefined, enabled: enabledFilter.value === '' ? undefined : enabledFilter.value } }),
      api.get<Company[]>('/organization/companies'),
    ])
    users.value = usersResponse.data
    companies.value = companiesResponse.data
  } catch (error) {
    loadError.value = apiErrorMessage(error, 'HR 用户资料加载失败，请重试')
  } finally { loading.value = false }
}

function openCreate() {
  editingUser.value = null
  Object.assign(form, { username: '', displayName: '', role: 'RECRUITER', password: '', companyIds: [] })
  formError.value = ''
  clearFieldErrors()
  dialogOpen.value = true
}

function openEdit(user: HrUser) {
  editingUser.value = user
  Object.assign(form, { username: user.username, displayName: user.displayName, role: user.role, password: '', companyIds: user.companies.map((company) => company.id) })
  formError.value = ''
  clearFieldErrors()
  dialogOpen.value = true
}

async function saveUser() {
  formError.value = ''
  clearFieldErrors()
  if (!(await formRef.value?.validate().catch(() => false))) return
  saving.value = true
  try {
    await ensureCsrf()
    if (editingUser.value) {
      await api.put(`/hr-users/${editingUser.value.id}`, { displayName: form.displayName, role: form.role, companyIds: form.companyIds })
      ElMessage.success('HR 用户已更新')
    } else {
      await api.post('/hr-users', form)
      ElMessage.success('HR 用户已创建')
    }
    dialogOpen.value = false
    await loadData()
  } catch (error) {
    Object.assign(fieldErrors, apiFieldErrors(error))
    formError.value = apiErrorMessage(error, 'HR 用户保存失败，请重试')
  } finally { saving.value = false }
}

async function toggleStatus(user: HrUser) {
  const enabled = !user.enabled
  if (!enabled) {
    try {
      await ElMessageBox.confirm(`停用后，“${user.displayName}”将无法登录，但授权和历史记录会保留。`, '确认停用 HR 用户', { type: 'warning', confirmButtonText: '确认停用', cancelButtonText: '取消' })
    } catch { return }
  }
  try {
    await ensureCsrf()
    await api.patch(`/hr-users/${user.id}/status`, { enabled })
    ElMessage.success(enabled ? '用户已启用' : '用户已停用')
    await loadData()
  } catch (error) { ElMessage.error(apiErrorMessage(error, '状态变更失败，请重试')) }
}

function openPasswordDialog(user: HrUser) {
  passwordUser.value = user
  newPassword.value = ''
  passwordDialogOpen.value = true
}

async function resetPassword() {
  if (newPassword.value.length < 12 || newPassword.value.length > 72) {
    ElMessage.warning('新密码长度应为 12 至 72 位')
    return
  }
  passwordSaving.value = true
  try {
    await ensureCsrf()
    await api.put(`/hr-users/${passwordUser.value?.id}/password`, { password: newPassword.value })
    passwordDialogOpen.value = false
    ElMessage.success('密码已重置')
  } catch (error) { ElMessage.error(apiErrorMessage(error, '密码重置失败，请重试')) }
  finally { passwordSaving.value = false }
}

onMounted(loadData)
</script>

<template>
  <div class="page-shell">
    <header class="page-heading"><div><h1>HR 用户与企业授权</h1><p>管理招聘团队账号、固定角色及可操作的企业范围。</p></div><el-button type="primary" :icon="Plus" @click="openCreate">新增 HR 用户</el-button></header>
    <div v-if="loading" class="surface-panel skeleton-stack"><el-skeleton :rows="7" animated /></div>
    <div v-else-if="loadError" class="surface-panel error-state" role="alert"><span class="error-state__icon"><el-icon><Refresh /></el-icon></span><strong>用户资料暂时无法加载</strong><span>{{ loadError }}</span><el-button :icon="Refresh" @click="loadData">重新加载</el-button></div>
    <template v-else>
      <div class="metrics-strip"><div><span>HR 用户总数</span><strong>{{ stats.total }}</strong></div><div><span>已启用</span><strong>{{ stats.enabled }}</strong></div><div><span>招聘管理员</span><strong>{{ stats.admins }}</strong></div></div>
      <section class="surface-panel users-panel">
        <div class="section-title-row users-title"><div><h2>HR 用户列表</h2><p>系统管理员不在此列表中，不会被误停用</p></div><div class="filters"><el-input v-model="keyword" clearable placeholder="搜索姓名或用户名" :prefix-icon="Search" @keyup.enter="loadData" /><el-select v-model="roleFilter" @change="loadData"><el-option label="全部角色" value="" /><el-option label="招聘管理员" value="RECRUITMENT_ADMIN" /><el-option label="招聘专员" value="RECRUITER" /></el-select><el-select v-model="enabledFilter" @change="loadData"><el-option label="全部状态" value="" /><el-option label="已启用" :value="true" /><el-option label="已停用" :value="false" /></el-select><el-button @click="loadData">查询</el-button></div></div>
        <div v-if="users.length === 0" class="empty-state"><span class="empty-state__icon"><el-icon><User /></el-icon></span><strong>还没有符合条件的 HR 用户</strong><span>创建用户并配置企业授权后，对方即可登录。</span><el-button type="primary" :icon="Plus" @click="openCreate">新增 HR 用户</el-button></div>
        <template v-else>
          <el-table :data="users" class="users-table"><el-table-column label="用户" min-width="180"><template #default="{ row }"><div class="identity"><strong>{{ row.displayName }}</strong><span>{{ row.username }}</span></div></template></el-table-column><el-table-column label="角色" min-width="130"><template #default="{ row }">{{ roleLabel(row.role) }}</template></el-table-column><el-table-column label="企业授权" min-width="260"><template #default="{ row }"><div class="scope-tags"><el-tag v-for="company in row.companies" :key="company.id" :type="company.status === 'ACTIVE' ? undefined : 'info'" size="small">{{ company.name }}{{ company.status === 'INACTIVE' ? '（已停用）' : '' }}</el-tag></div></template></el-table-column><el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="row.enabled ? 'success' : 'info'">{{ row.enabled ? '已启用' : '已停用' }}</el-tag></template></el-table-column><el-table-column label="操作" width="230" fixed="right"><template #default="{ row }"><el-button link type="primary" @click="openEdit(row as HrUser)">编辑</el-button><el-button link :icon="Key" @click="openPasswordDialog(row as HrUser)">重置密码</el-button><el-button link :type="row.enabled ? 'danger' : 'success'" @click="toggleStatus(row as HrUser)">{{ row.enabled ? '停用' : '启用' }}</el-button></template></el-table-column></el-table>
          <div class="user-cards"><article v-for="item in users" :key="item.id"><header><div class="identity"><strong>{{ item.displayName }}</strong><span>{{ item.username }}</span></div><el-tag :type="item.enabled ? 'success' : 'info'" size="small">{{ item.enabled ? '已启用' : '已停用' }}</el-tag></header><p>{{ roleLabel(item.role) }}</p><div class="scope-tags"><el-tag v-for="company in item.companies" :key="company.id" size="small">{{ company.name }}</el-tag></div><footer><el-button @click="openEdit(item)">编辑</el-button><el-button @click="openPasswordDialog(item)">重置密码</el-button><el-button :type="item.enabled ? 'danger' : 'success'" plain @click="toggleStatus(item)">{{ item.enabled ? '停用' : '启用' }}</el-button></footer></article></div>
        </template>
      </section>
    </template>

    <el-dialog v-model="dialogOpen" :title="dialogTitle" width="600px" destroy-on-close><el-alert v-if="formError" :title="formError" type="error" :closable="false" show-icon class="dialog-alert" /><el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent="saveUser"><div class="form-grid"><el-form-item label="用户名" prop="username" :error="fieldErrors.username"><el-input v-model="form.username" :disabled="!!editingUser" maxlength="64" placeholder="例如：zhang.san" /></el-form-item><el-form-item label="姓名" prop="displayName" :error="fieldErrors.displayName"><el-input v-model="form.displayName" maxlength="100" /></el-form-item><el-form-item label="角色" prop="role" :error="fieldErrors.role"><el-select v-model="form.role"><el-option label="招聘管理员" value="RECRUITMENT_ADMIN" /><el-option label="招聘专员" value="RECRUITER" /></el-select></el-form-item><el-form-item v-if="!editingUser" label="初始密码" prop="password" :error="fieldErrors.password"><el-input v-model="form.password" type="password" show-password autocomplete="new-password" placeholder="12-72 位" /></el-form-item><el-form-item class="wide-field" label="企业授权范围" prop="companyIds" :error="fieldErrors.companyIds"><el-select v-model="form.companyIds" multiple filterable collapse-tags :max-collapse-tags="3" placeholder="请至少选择一家有效企业"><el-option v-for="company in activeCompanies" :key="company.id" :label="`${company.name}（${company.code}）`" :value="company.id" /></el-select></el-form-item></div></el-form><template #footer><el-button @click="dialogOpen = false">取消</el-button><el-button type="primary" :loading="saving" @click="saveUser">{{ editingUser ? '保存修改' : '确认创建' }}</el-button></template></el-dialog>
    <el-dialog v-model="passwordDialogOpen" title="重置密码" width="460px"><p class="password-hint">为 <strong>{{ passwordUser?.displayName }}</strong> 设置新密码，不会在日志中记录密码内容。</p><el-input v-model="newPassword" type="password" show-password autocomplete="new-password" placeholder="12-72 位新密码" @keyup.enter="resetPassword" /><template #footer><el-button @click="passwordDialogOpen = false">取消</el-button><el-button type="primary" :loading="passwordSaving" @click="resetPassword">确认重置</el-button></template></el-dialog>
  </div>
</template>

<style scoped>
.metrics-strip { display:grid; grid-template-columns:repeat(3,1fr); margin-bottom:20px; border:1px solid var(--border); border-radius:12px; background:var(--surface); overflow:hidden; }
.metrics-strip div { padding:18px 24px; border-right:1px solid var(--border); }.metrics-strip div:last-child{border:0}.metrics-strip span,.metrics-strip strong{display:block}.metrics-strip span{color:var(--text-secondary);font-size:12px}.metrics-strip strong{margin-top:5px;font-size:24px}
.users-panel{overflow:hidden}.users-title{align-items:flex-end}.filters{display:grid;grid-template-columns:minmax(180px,240px) 145px 125px auto;gap:8px}.users-table{width:100%}.identity strong,.identity span{display:block}.identity span{margin-top:4px;color:var(--text-secondary);font-family:"Cascadia Code",monospace;font-size:12px}.scope-tags{display:flex;flex-wrap:wrap;gap:6px}.user-cards{display:none}.dialog-alert{margin-bottom:18px}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 18px}.wide-field{grid-column:1/-1}.password-hint{margin:0 0 18px;color:var(--text-secondary);line-height:1.6}
@media(max-width:1100px){.users-title{display:grid}.filters{width:100%;grid-template-columns:minmax(180px,1fr) 145px 125px auto}}
@media(max-width:720px){.metrics-strip div{padding:14px 12px}.metrics-strip strong{font-size:21px}.filters{grid-template-columns:1fr}.users-table{display:none}.user-cards{display:grid;gap:12px;padding:14px}.user-cards article{padding:16px;border:1px solid var(--border);border-radius:10px}.user-cards header{display:flex;justify-content:space-between;gap:12px}.user-cards p{color:var(--text-secondary);font-size:13px}.user-cards footer{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:18px}.user-cards footer .el-button{min-height:42px;margin:0}.user-cards footer .el-button:last-child{grid-column:1/-1}.form-grid{grid-template-columns:1fr}.wide-field{grid-column:auto}}
</style>
