<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { authStore } from '../stores/auth'
import { api, apiErrorMessage, ensureCsrf } from '../services/api'
import type { Company, HrUser, UserRole } from '../types'

type HrRole = Exclude<UserRole, 'SYSTEM_ADMIN'>

const users = ref<HrUser[]>([])
const companies = ref<Company[]>([])
const loading = ref(false)
const saving = ref(false)
const dialogOpen = ref(false)
const loadError = ref('')
const deletingId = ref<string | null>(null)
const isSystemAdmin = computed(() => authStore.state.user?.role === 'SYSTEM_ADMIN')
const availableRoles = computed(() => isSystemAdmin.value ? roleLabels : { RECRUITER: '招聘专员' })

const form = reactive<{
  username: string
  role: HrRole
  password: string
  companyIds: string[]
}>({
  username: '',
  role: 'RECRUITER',
  password: '',
  companyIds: [],
})

const activeCompanies = computed(() => companies.value.filter((company) => company.status === 'ACTIVE'))
const roleLabels: Record<HrRole, string> = {
  RECRUITMENT_ADMIN: '招聘管理员',
  RECRUITER: '招聘专员',
}

function roleLabel(role: UserRole) {
  return role === 'SYSTEM_ADMIN' ? '系统管理员' : roleLabels[role]
}

function resetForm() {
  Object.assign(form, { username: '', role: 'RECRUITER', password: '', companyIds: [] })
}

function openCreateDialog() {
  resetForm()
  dialogOpen.value = true
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const [userResult, companyResult] = await Promise.all([
      api.get<HrUser[]>('/hr-users'),
      api.get<Company[]>('/organization/companies', { params: { status: 'ACTIVE' } }),
    ])
    users.value = userResult.data
    companies.value = companyResult.data
  } catch (error) {
    loadError.value = apiErrorMessage(error, '用户列表加载失败，请刷新重试')
  } finally {
    loading.value = false
  }
}

function validateForm() {
  if (!/^[\p{Script=Han}A-Za-z0-9._-]+$/u.test(form.username.trim())) return '用户名只能包含中文、英文字母、数字、点、下划线和横线'
  if (form.password.length < 12) return '初始密码至少需要 12 个字符'
  if (!form.companyIds.length) return '请至少授权一家企业'
  return ''
}

async function createUser() {
  const validationError = validateForm()
  if (validationError) {
    ElMessage.warning(validationError)
    return
  }
  saving.value = true
  try {
    await ensureCsrf()
    await api.post('/hr-users', {
      username: form.username.trim(),
      displayName: form.username.trim(),
      role: form.role,
      password: form.password,
      companyIds: form.companyIds,
    })
    ElMessage.success('HR 账号创建成功')
    dialogOpen.value = false
    await load()
  } catch (error) {
    ElMessage.error(apiErrorMessage(error, 'HR 账号创建失败，请检查输入后重试'))
  } finally {
    saving.value = false
  }
}

async function deleteUser(user: HrUser) {
  try {
    await ElMessageBox.confirm(`删除“${user.displayName}（${user.username}）”后，该账号无法登录，关联插件将失效。历史招聘记录保留，用户名不可复用。`, '删除 HR 账号', {
      confirmButtonText: '确认删除', cancelButtonText: '取消', type: 'warning',
    })
  } catch { return }
  deletingId.value = user.id
  try {
    await ensureCsrf()
    await api.delete(`/hr-users/${user.id}`)
    ElMessage.success('HR 账号已删除')
    await load()
  } catch (error) { ElMessage.error(apiErrorMessage(error, '删除失败')) }
  finally { deletingId.value = null }
}

onMounted(load)
onUnmounted(() => { document.removeEventListener('visibilitychange', onVisChange) })
function onVisChange() { if (document.visibilityState === 'visible') void load() }
document.addEventListener('visibilitychange', onVisChange)
</script>

<template>
  <main class="hr-users-page">
    <header class="page-heading">
      <div></div>
      <div class="heading-actions">
        <el-button type="primary" @click="openCreateDialog">创建 HR 账号</el-button>
      </div>
    </header>

    <section class="notice-panel" aria-label="权限说明">
      <span class="notice-dot" aria-hidden="true"></span>
      <div><strong>{{ isSystemAdmin ? '管理招聘管理员与招聘专员' : '管理授权企业内的招聘专员' }}</strong><p>删除账号后无法登录，历史招聘记录保留。招聘管理员仅能管理企业授权完全在自己范围内的专员。</p></div>
    </section>

    <section class="users-panel" aria-labelledby="users-title">
      <div class="panel-heading"><div><span class="eyebrow">账号列表</span><h2 id="users-title">已配置的 HR 账号</h2></div><span class="count-badge">{{ users.length }} 个</span></div>
      <el-alert v-if="loadError" :title="loadError" type="error" :closable="false" show-icon />
      <div v-if="loading" class="loading-state" aria-live="polite"><span v-for="item in 3" :key="item" class="skeleton-row"></span></div>
      <div v-else-if="users.length" class="table-wrap">
        <table>
          <thead><tr><th>用户</th><th>角色</th><th>企业授权</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="user in users" :key="user.id">
              <td><strong>{{ user.displayName }}</strong><span v-if="user.displayName !== user.username" class="subtext">{{ user.username }}</span></td>
              <td><span class="role-badge">{{ roleLabel(user.role) }}</span></td>
              <td><div class="company-list"><span v-for="company in user.companies" :key="company.id">{{ company.name }}</span></div></td>
              <td><span class="status-badge" :class="{ enabled: user.enabled }"><i></i>{{ user.enabled ? '已启用' : '已停用' }}</span></td>
              <td class="subtext">{{ new Date(user.createdAt).toLocaleDateString('zh-CN') }}</td>
              <td><el-button type="danger" link :loading="deletingId === user.id" :disabled="deletingId !== null" @click="deleteUser(user)">删除</el-button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="empty-state"><strong>还没有 HR 账号</strong><p>创建第一个账号后，HR 就可以使用分配的企业范围登录。</p><el-button type="primary" @click="openCreateDialog">创建 HR 账号</el-button></div>
    </section>

    <el-dialog v-model="dialogOpen" title="创建 HR 账号" width="560px" destroy-on-close append-to-body>
      <el-form label-position="top" @submit.prevent="createUser">
        <div class="form-grid">
          <el-form-item label="用户名" required><el-input v-model="form.username" maxlength="64" autocomplete="username" placeholder="例如：张三、招聘小李或 hr_beijing" /></el-form-item>
          <el-form-item label="初始密码" required><el-input v-model="form.password" type="password" show-password maxlength="72" autocomplete="new-password" placeholder="至少 12 个字符" /></el-form-item>
        </div>
        <el-form-item label="角色" required><el-select v-model="form.role" class="full-width"><el-option v-for="(label, value) in availableRoles" :key="value" :label="label" :value="value" /></el-select></el-form-item>
        <el-form-item label="企业授权" required><el-select v-model="form.companyIds" class="full-width" multiple collapse-tags collapse-tags-tooltip placeholder="请选择可访问的企业"><el-option v-for="company in activeCompanies" :key="company.id" :label="`${company.name}（${company.code}）`" :value="company.id" /></el-select></el-form-item>
        <p class="dialog-note">账号创建后，HR 使用用户名和初始密码登录；系统不会在页面中再次显示密码。</p>
      </el-form>
      <template #footer><el-button @click="dialogOpen = false">取消</el-button><el-button type="primary" :loading="saving" @click="createUser">创建账号</el-button></template>
    </el-dialog>
  </main>
</template>

<style scoped>
.hr-users-page { display: grid; gap: 22px; max-width: 1180px; margin: 0 auto; }
.page-heading { display:flex; align-items:center; justify-content:space-between; gap:20px; margin-bottom:12px; }
.eyebrow { color:var(--brand-700); font-size:12px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; }
h1 { margin:0 0 4px; font-size:clamp(18px,1.6vw,22px); letter-spacing:-.01em; }
.page-heading p { margin:0; color:var(--text-secondary); font-size:13px; }
.heading-actions { display:flex; gap:10px; flex:0 0 auto; }
.notice-panel,.users-panel { border:1px solid var(--border); border-radius:var(--radius-panel); background:var(--surface); box-shadow:var(--shadow-card); }
.notice-panel { display:flex; align-items:flex-start; gap:12px; padding:16px 18px; background:linear-gradient(135deg, color-mix(in srgb,var(--brand-50) 78%,var(--surface)), var(--surface)); }
.notice-dot { width:9px; height:9px; margin-top:5px; flex:0 0 auto; border-radius:50%; background:var(--brand-600); box-shadow:0 0 0 5px color-mix(in srgb,var(--brand-500) 15%,transparent); }
.notice-panel strong { font-size:14px; }.notice-panel p { margin:5px 0 0; color:var(--text-secondary); font-size:13px; }
.users-panel { overflow:hidden; }.panel-heading { display:flex; align-items:center; justify-content:space-between; padding:20px 22px; border-bottom:1px solid var(--border-subtle); }.panel-heading h2 { margin:7px 0 0; font-size:18px; }.count-badge { padding:5px 10px; border-radius:var(--radius-pill); background:var(--brand-50); color:var(--brand-700); font-size:12px; font-weight:700; }
.users-panel > .el-alert { margin:16px 22px 0; }.table-wrap { overflow-x:auto; } table { width:100%; border-collapse:collapse; font-size:13px; } th,td { padding:15px 22px; border-bottom:1px solid var(--border-subtle); text-align:left; vertical-align:middle; } th { color:var(--text-tertiary); font-size:11px; font-weight:700; letter-spacing:.05em; text-transform:uppercase; background:var(--surface-muted); } tbody tr:last-child td { border-bottom:0; } tbody tr { transition:background var(--transition-fast); } tbody tr:hover { background:var(--surface-hover); } td strong { display:block; font-size:14px; }.subtext { display:block; margin-top:4px; color:var(--text-secondary); font-size:12px; }.role-badge,.status-badge { display:inline-flex; align-items:center; gap:6px; padding:5px 9px; border-radius:var(--radius-pill); background:var(--surface-muted); color:var(--text-secondary); font-size:12px; }.status-badge i { width:6px; height:6px; border-radius:50%; background:var(--text-tertiary); }.status-badge.enabled { background:color-mix(in srgb,var(--success) 12%,var(--surface)); color:var(--success); }.status-badge.enabled i { background:var(--success); }.company-list { display:flex; flex-wrap:wrap; gap:5px; }.company-list span { padding:4px 7px; border:1px solid var(--border-subtle); border-radius:6px; color:var(--text-secondary); font-size:12px; }
.loading-state { display:grid; gap:12px; padding:22px; }.skeleton-row { height:52px; border-radius:10px; background:linear-gradient(90deg,var(--surface-muted),var(--surface-hover),var(--surface-muted)); background-size:200% 100%; animation:shimmer 1.5s ease-in-out infinite; }.empty-state { display:grid; justify-items:center; gap:8px; padding:64px 22px; text-align:center; }.empty-state strong { font-size:16px; }.empty-state p { margin:0 0 8px; color:var(--text-secondary); font-size:13px; }.form-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; }.full-width { width:100%; }.dialog-note { margin:2px 0 0; color:var(--text-tertiary); font-size:12px; line-height:1.6; }
@keyframes shimmer { from { background-position:200% 0; } to { background-position:-200% 0; } }
@media(max-width:700px) { .page-heading { align-items:flex-start; flex-direction:column; }.heading-actions { width:100%; }.heading-actions .el-button { flex:1; }.panel-heading { padding-inline:16px; } th,td { padding-inline:16px; }.form-grid { grid-template-columns:1fr; gap:0; } }
@media(prefers-reduced-motion:reduce) { .skeleton-row { animation:none; } tbody tr { transition:none; } }
</style>
