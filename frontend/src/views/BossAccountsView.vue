<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import type { FormInstance, FormRules } from 'element-plus'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Connection, Plus, Refresh, Search } from '@element-plus/icons-vue'
import { api, apiErrorMessage, apiFieldErrors, ensureCsrf } from '../services/api'
import { authStore } from '../stores/auth'
import type { BossAccount, BossAccountStatus, BossCapability, BossConnectionStatus, BrowserDevice, Company, MockBossProfile } from '../types'

interface AccountFormValue { companyId: string; displayName: string; externalIdentifier: string; mockProfile: MockBossProfile }

const loading = ref(true)
const loadError = ref('')
const accounts = ref<BossAccount[]>([])
const devices = ref<BrowserDevice[]>([])
const companies = ref<Company[]>([])
const keyword = ref('')
const companyFilter = ref('')
const statusFilter = ref<BossAccountStatus | ''>('')
const connectionFilter = ref<BossConnectionStatus | ''>('')
const dialogOpen = ref(false)
const saving = ref(false)
const editingAccount = ref<BossAccount | null>(null)
const formRef = ref<FormInstance>()
const form = reactive<AccountFormValue>({ companyId: '', displayName: '', externalIdentifier: '', mockProfile: 'FULL' })
const formError = ref('')
const fieldErrors = reactive<Record<string, string>>({})
const checkingId = ref('')
const changingStatusId = ref('')
const connectionOpen = ref(false)
const selectedAccount = ref<BossAccount | null>(null)
const pairingLoading = ref(false)
const pairingToken = ref('')
const pairingExpiresAt = ref('')

const canManage = computed(() => ['SYSTEM_ADMIN', 'RECRUITMENT_ADMIN'].includes(authStore.state.user?.role ?? ''))
const activeCompanies = computed(() => companies.value.filter((company) => company.status === 'ACTIVE'))
const stats = computed(() => ({
  total: accounts.value.length,
  connected: accounts.value.filter((account) => account.connectionStatus === 'CONNECTED').length,
  attention: accounts.value.filter((account) => ['DEGRADED', 'UNAVAILABLE'].includes(account.connectionStatus)).length,
}))
const dialogTitle = computed(() => editingAccount.value ? '编辑 BOSS 账号' : '新增 BOSS 账号')
const rules: FormRules<AccountFormValue> = {
  companyId: [{ required: true, message: '请选择归属企业', trigger: 'change' }],
  displayName: [{ required: true, message: '请输入账号名称', trigger: 'blur' }, { max: 100, message: '最多 100 个字符', trigger: 'blur' }],
  externalIdentifier: [{ required: true, message: '请输入外部标识', trigger: 'blur' }, { max: 120, message: '最多 120 个字符', trigger: 'blur' }],
  mockProfile: [{ required: true, message: '请选择 Mock 场景', trigger: 'change' }],
}
const connectionLabels: Record<BossConnectionStatus, string> = { UNVERIFIED: '未检查', CONNECTED: '连接正常', DEGRADED: '能力受限', UNAVAILABLE: '不可用' }
const capabilityLabels: Record<BossCapability, string> = { JOB_SYNC: '职位同步', CANDIDATE_READ: '候选人读取', MESSAGE_SEND: '消息发送', INTERVIEW_INVITE: '面试邀约' }
const profileLabels: Record<MockBossProfile, string> = { FULL: '完整能力', READ_ONLY: '只读能力', UNAVAILABLE: '不可用' }

function connectionTagType(status: BossConnectionStatus) {
  return ({ UNVERIFIED: 'info', CONNECTED: 'success', DEGRADED: 'warning', UNAVAILABLE: 'danger' } as const)[status]
}
function clearFieldErrors() { Object.keys(fieldErrors).forEach((key) => delete fieldErrors[key]) }

async function loadData() {
  loading.value = true
  loadError.value = ''
  try {
    const [accountResponse, companyResponse, deviceResponse] = await Promise.all([
      api.get<BossAccount[]>('/boss-accounts', { params: {
        keyword: keyword.value.trim() || undefined,
        companyId: companyFilter.value || undefined,
        status: statusFilter.value || undefined,
        connectionStatus: connectionFilter.value || undefined,
      } }),
      api.get<Company[]>('/organization/companies'),
      api.get<BrowserDevice[]>('/browser-devices'),
    ])
    accounts.value = accountResponse.data
    companies.value = companyResponse.data
    devices.value = deviceResponse.data
  } catch (error) { loadError.value = apiErrorMessage(error, 'BOSS 账号资料加载失败，请重试') }
  finally { loading.value = false }
}

function activeDevice(accountId: string) {
  return devices.value.find((device) => device.accountId === accountId && device.status === 'ACTIVE')
}

function readiness(account?: BossAccount | null) {
  if (!account) return { step: 1, label: '尚未连接', type: 'info' as const }
  const device = activeDevice(account.id)
  if (!device) return { step: 1, label: '尚未连接', type: 'info' as const }
  if (device.runtimeState === 'RUNNING') return { step: 4, label: '已准备就绪', type: 'success' as const }
  if (device.runtimeState === 'PAUSED' && device.stopReason?.includes('紧急停止')) return { step: 4, label: '只监测中', type: 'warning' as const }
  if (device.runtimeState === 'PAUSED') return { step: 3, label: '需要检查页面', type: 'warning' as const }
  return { step: 2, label: '等待打开招聘页面', type: 'warning' as const }
}

function openConnection(account: BossAccount) {
  selectedAccount.value = account
  pairingToken.value = ''
  pairingExpiresAt.value = ''
  connectionOpen.value = true
}

async function generatePairing() {
  if (!selectedAccount.value) return
  pairingLoading.value = true
  try {
    await ensureCsrf()
    const { data } = await api.post<{ pairingToken: string; expiresAt: string }>('/browser-devices/pairings', { accountId: selectedAccount.value.id })
    pairingToken.value = data.pairingToken
    pairingExpiresAt.value = data.expiresAt
    ElMessage.success('连接码已生成，请在 10 分钟内完成连接')
  } catch (error) { ElMessage.error(apiErrorMessage(error, '连接码生成失败')) }
  finally { pairingLoading.value = false }
}

async function copyToken() {
  try {
    await navigator.clipboard.writeText(pairingToken.value)
    ElMessage.success('连接码已复制')
  } catch { ElMessage.warning('复制失败，请手动复制连接码') }
}

function openCreate() {
  editingAccount.value = null
  Object.assign(form, { companyId: activeCompanies.value[0]?.id ?? '', displayName: '', externalIdentifier: '', mockProfile: 'FULL' })
  formError.value = ''
  clearFieldErrors()
  dialogOpen.value = true
}

function openEdit(account: BossAccount) {
  editingAccount.value = account
  Object.assign(form, { companyId: account.company.id, displayName: account.displayName, externalIdentifier: account.externalIdentifier, mockProfile: account.mockProfile })
  formError.value = ''
  clearFieldErrors()
  dialogOpen.value = true
}

async function saveAccount() {
  formError.value = ''
  clearFieldErrors()
  if (!(await formRef.value?.validate().catch(() => false))) return
  saving.value = true
  try {
    await ensureCsrf()
    if (editingAccount.value) {
      await api.put(`/boss-accounts/${editingAccount.value.id}`, form)
      ElMessage.success('BOSS 账号已更新')
    } else {
      await api.post('/boss-accounts', form)
      ElMessage.success('BOSS 账号已创建')
    }
    dialogOpen.value = false
    await loadData()
  } catch (error) {
    Object.assign(fieldErrors, apiFieldErrors(error))
    formError.value = apiErrorMessage(error, 'BOSS 账号保存失败，请重试')
  } finally { saving.value = false }
}

async function toggleStatus(account: BossAccount) {
  const status: BossAccountStatus = account.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'
  if (status === 'INACTIVE') {
    try {
      await ElMessageBox.confirm(`停用后，“${account.displayName}”不能执行招聘能力，历史记录会保留。`, '确认停用 BOSS 账号', { type: 'warning', confirmButtonText: '确认停用', cancelButtonText: '取消' })
    } catch { return }
  }
  changingStatusId.value = account.id
  try {
    await ensureCsrf()
    await api.patch(`/boss-accounts/${account.id}/status`, { status })
    ElMessage.success(status === 'ACTIVE' ? 'BOSS 账号已启用' : 'BOSS 账号已停用')
    await loadData()
  } catch (error) { ElMessage.error(apiErrorMessage(error, 'BOSS 账号状态变更失败')) }
  finally { changingStatusId.value = '' }
}

async function checkCapabilities(account: BossAccount) {
  checkingId.value = account.id
  try {
    await ensureCsrf()
    const { data } = await api.post<BossAccount>(`/boss-accounts/${account.id}/capabilities/check`)
    ElMessage.success(`能力检查完成：${connectionLabels[data.connectionStatus]}`)
    await loadData()
  } catch (error) { ElMessage.error(apiErrorMessage(error, '能力检查失败，请重试')) }
  finally { checkingId.value = '' }
}

function formatDate(value?: string) {
  return value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '尚未检查'
}

onMounted(loadData)
</script>

<template>
  <div class="page-shell">
    <el-dialog v-model="connectionOpen" :title="`${selectedAccount?.displayName ?? ''} · 连接向导`" width="680px" destroy-on-close>
      <div class="wizard-steps">
        <article class="done"><b>1</b><div><strong>准备专用 Chrome</strong><p>在 HR 日常使用的电脑上安装托管助手扩展，并使用独立浏览器资料登录 BOSS 招聘端。系统不会索取账号密码或上传 Cookie。</p></div></article>
        <article :class="{ done: !!activeDevice(selectedAccount?.id ?? '') }"><b>2</b><div><strong>连接托管助手</strong><p>生成一次性连接码，然后在浏览器扩展中粘贴。连接码只绑定当前招聘账号，10 分钟后自动失效。</p><div v-if="pairingToken" class="token-box"><code>{{ pairingToken }}</code><el-button @click="copyToken">复制连接码</el-button><small>有效至 {{ formatDate(pairingExpiresAt) }}</small></div><el-button v-else type="primary" :loading="pairingLoading" @click="generatePairing">生成一次性连接码</el-button></div></article>
        <article :class="{ done: readiness(selectedAccount).step >= 3 }"><b>3</b><div><strong>打开招聘会话页面</strong><p>保持 BOSS 招聘端已登录并打开会话列表。助手会检查页面是否可识别；验证码、登录失效或页面变化时会自动停止。</p></div></article>
        <article :class="{ done: readiness(selectedAccount).step >= 4 }"><b>4</b><div><strong>先进行只监测</strong><p>先观察新消息识别、超时计算和停止保护是否正常，不发送任何消息。确认稳定后，再由 HR 主动开启托管回复。</p></div></article>
      </div>
      <el-alert v-if="activeDevice(selectedAccount?.id ?? '')?.stopReason" :title="activeDevice(selectedAccount?.id ?? '')?.stopReason" type="warning" :closable="false" show-icon class="dialog-alert" />
      <template #footer><el-button @click="loadData">刷新连接状态</el-button><el-button type="primary" @click="connectionOpen = false">完成</el-button></template>
    </el-dialog>
    <header class="page-heading"><div><h1>BOSS 账号连接</h1><p>在正常登录的招聘页面旁连接托管助手；系统不要求输入 BOSS 密码，也不会上传 Cookie。</p></div><el-button v-if="canManage" type="primary" :icon="Plus" @click="openCreate">新增账号资料</el-button></header>
    <el-alert title="连接后默认保持安全停止。请先完成页面识别与只监测验证，再由 HR 主动允许托管。" type="info" :closable="false" show-icon class="scope-alert" />
    <div v-if="loading" class="surface-panel skeleton-stack"><el-skeleton :rows="7" animated /></div>
    <div v-else-if="loadError" class="surface-panel error-state" role="alert"><span class="error-state__icon"><el-icon><Refresh /></el-icon></span><strong>BOSS 账号暂时无法加载</strong><span>{{ loadError }}</span><el-button :icon="Refresh" @click="loadData">重新加载</el-button></div>
    <template v-else>
      <div class="metrics-strip"><div><span>账号总数</span><strong>{{ stats.total }}</strong></div><div><span>连接正常</span><strong>{{ stats.connected }}</strong></div><div><span>需要关注</span><strong>{{ stats.attention }}</strong></div></div>
      <section class="surface-panel connect-panel"><div class="section-title-row"><div><h2>连接招聘账号</h2><p>选择账号后，向导会一步步完成扩展、连接和页面检查。</p></div></div><div v-if="accounts.length === 0" class="empty-state"><span class="empty-state__icon"><el-icon><Connection /></el-icon></span><strong>还没有可连接的招聘账号</strong><span>{{ canManage ? '请先新增账号资料。' : '请联系招聘管理员为你分配账号。' }}</span></div><div v-else class="connect-grid"><article v-for="account in accounts" :key="account.id"><header><div class="identity"><strong>{{ account.displayName }}</strong><span>{{ account.company.name }}</span></div><el-tag :type="readiness(account).type">{{ readiness(account).label }}</el-tag></header><div class="readiness"><span v-for="step in 4" :key="step" :class="{done:step<=readiness(account).step}">{{ step }}</span></div><p>{{ activeDevice(account.id)?.stopReason || (readiness(account).step===4 ? '招聘页面和系统连接正常，可以进入只监测试运行。' : '点击继续连接，按向导完成剩余步骤。') }}</p><el-button type="primary" plain @click="openConnection(account)">{{ readiness(account).step===4 ? '查看连接状态' : '继续连接' }}</el-button></article></div></section>
      <section v-if="canManage" class="surface-panel accounts-panel">
        <div class="section-title-row accounts-title"><div><h2>BOSS 账号列表</h2><p>能力结果来自 Gateway 检查，不由前端手工勾选</p></div><div class="filters"><el-input v-model="keyword" clearable placeholder="搜索账号名称或外部标识" :prefix-icon="Search" @keyup.enter="loadData" /><el-select v-model="companyFilter" clearable placeholder="全部企业" @change="loadData"><el-option v-for="company in companies" :key="company.id" :label="company.name" :value="company.id" /></el-select><el-select v-model="statusFilter" placeholder="全部状态" @change="loadData"><el-option label="全部状态" value="" /><el-option label="已启用" value="ACTIVE" /><el-option label="已停用" value="INACTIVE" /></el-select><el-select v-model="connectionFilter" placeholder="全部连接" @change="loadData"><el-option label="全部连接" value="" /><el-option label="未检查" value="UNVERIFIED" /><el-option label="连接正常" value="CONNECTED" /><el-option label="能力受限" value="DEGRADED" /><el-option label="不可用" value="UNAVAILABLE" /></el-select><el-button @click="loadData">查询</el-button></div></div>
        <div v-if="accounts.length === 0" class="empty-state"><span class="empty-state__icon"><el-icon><Connection /></el-icon></span><strong>还没有符合条件的 BOSS 账号</strong><span v-if="canManage">创建 Mock 账号后即可检查 Capability。</span><span v-else>请联系招聘管理员配置账号。</span><el-button v-if="canManage" type="primary" :icon="Plus" @click="openCreate">新增 BOSS 账号</el-button></div>
        <template v-else>
          <el-table :data="accounts" class="accounts-table"><el-table-column label="账号" min-width="190"><template #default="{ row }"><div class="identity"><strong>{{ row.displayName }}</strong><span>{{ row.externalIdentifier }}</span></div></template></el-table-column><el-table-column label="归属企业" min-width="170"><template #default="{ row }"><strong>{{ row.company.name }}</strong><div class="muted">{{ row.company.code }}</div></template></el-table-column><el-table-column label="连接" width="125"><template #default="{ row }"><el-tag :type="connectionTagType(row.connectionStatus)">{{ connectionLabels[row.connectionStatus as BossConnectionStatus] }}</el-tag></template></el-table-column><el-table-column label="Capability" min-width="260"><template #default="{ row }"><div v-if="row.capabilities.length" class="capability-tags"><el-tag v-for="capability in row.capabilities" :key="capability" size="small" effect="plain">{{ capabilityLabels[capability as BossCapability] }}</el-tag></div><span v-else class="muted">尚无可用能力</span></template></el-table-column><el-table-column label="账号状态" width="105"><template #default="{ row }"><el-tag :type="row.status === 'ACTIVE' ? 'success' : 'info'">{{ row.status === 'ACTIVE' ? '已启用' : '已停用' }}</el-tag></template></el-table-column><el-table-column v-if="canManage" label="操作" width="245" fixed="right"><template #default="{ row }"><el-button link type="primary" @click="openEdit(row as BossAccount)">编辑</el-button><el-button link type="primary" :loading="checkingId === row.id" :disabled="row.status !== 'ACTIVE'" @click="checkCapabilities(row as BossAccount)">检查能力</el-button><el-button link :type="row.status === 'ACTIVE' ? 'danger' : 'success'" :loading="changingStatusId === row.id" @click="toggleStatus(row as BossAccount)">{{ row.status === 'ACTIVE' ? '停用' : '启用' }}</el-button></template></el-table-column></el-table>
          <div class="account-cards"><article v-for="account in accounts" :key="account.id"><header><div class="identity"><strong>{{ account.displayName }}</strong><span>{{ account.externalIdentifier }}</span></div><el-tag :type="account.status === 'ACTIVE' ? 'success' : 'info'" size="small">{{ account.status === 'ACTIVE' ? '已启用' : '已停用' }}</el-tag></header><dl><div><dt>归属企业</dt><dd>{{ account.company.name }}</dd></div><div><dt>连接状态</dt><dd><el-tag :type="connectionTagType(account.connectionStatus)" size="small">{{ connectionLabels[account.connectionStatus] }}</el-tag></dd></div><div><dt>最后检查</dt><dd>{{ formatDate(account.lastCheckedAt) }}</dd></div></dl><div class="capability-tags"><el-tag v-for="capability in account.capabilities" :key="capability" size="small" effect="plain">{{ capabilityLabels[capability] }}</el-tag><span v-if="account.capabilities.length === 0" class="muted">尚无可用能力</span></div><footer v-if="canManage"><el-button @click="openEdit(account)">编辑</el-button><el-button :loading="checkingId === account.id" :disabled="account.status !== 'ACTIVE'" @click="checkCapabilities(account)">检查能力</el-button><el-button :type="account.status === 'ACTIVE' ? 'danger' : 'success'" plain @click="toggleStatus(account)">{{ account.status === 'ACTIVE' ? '停用' : '启用' }}</el-button></footer></article></div>
        </template>
      </section>
    </template>

    <el-dialog v-model="dialogOpen" :title="dialogTitle" width="600px" destroy-on-close><el-alert v-if="formError" :title="formError" type="error" :closable="false" show-icon class="dialog-alert" /><el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent="saveAccount"><div class="form-grid"><el-form-item label="归属企业" prop="companyId" :error="fieldErrors.companyId"><el-select v-model="form.companyId" filterable placeholder="请选择有效企业"><el-option v-for="company in activeCompanies" :key="company.id" :label="`${company.name}（${company.code}）`" :value="company.id" /></el-select></el-form-item><el-form-item label="Mock 场景" prop="mockProfile" :error="fieldErrors.mockProfile"><el-select v-model="form.mockProfile"><el-option label="完整能力" value="FULL" /><el-option label="只读能力" value="READ_ONLY" /><el-option label="不可用" value="UNAVAILABLE" /></el-select></el-form-item><el-form-item label="账号名称" prop="displayName" :error="fieldErrors.displayName"><el-input v-model="form.displayName" maxlength="100" placeholder="例如：上海社招账号" /></el-form-item><el-form-item label="外部标识" prop="externalIdentifier" :error="fieldErrors.externalIdentifier"><el-input v-model="form.externalIdentifier" maxlength="120" placeholder="仅保存标识，不填 Cookie/Token" /></el-form-item></div><el-alert :title="`Mock 场景用于验证状态和能力流程：${profileLabels[form.mockProfile]}`" type="info" :closable="false" /></el-form><template #footer><el-button @click="dialogOpen = false">取消</el-button><el-button type="primary" :loading="saving" @click="saveAccount">{{ editingAccount ? '保存修改' : '确认创建' }}</el-button></template></el-dialog>
  </div>
</template>

<style scoped>
.connect-panel{margin-bottom:20px;overflow:hidden}.connect-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;padding:0 20px 20px}.connect-grid article{padding:18px;border:1px solid var(--border);border-radius:12px;background:var(--surface)}.connect-grid article>header{display:flex;justify-content:space-between;gap:12px}.connect-grid article>p{min-height:40px;color:var(--text-secondary);font-size:13px;line-height:1.55}.connect-grid article>.el-button{width:100%}.readiness{display:grid;grid-template-columns:repeat(4,28px);justify-content:space-between;margin:18px 0}.readiness span{display:grid;width:28px;height:28px;place-items:center;border-radius:50%;background:#eef2f6;color:#667085;font-size:12px}.readiness span.done{background:var(--brand-100);color:var(--brand-700);font-weight:700}.wizard-steps{display:grid}.wizard-steps article{display:grid;grid-template-columns:36px 1fr;gap:14px;padding:18px 0;border-bottom:1px solid var(--border)}.wizard-steps article:first-child{padding-top:0}.wizard-steps article:last-child{border-bottom:0}.wizard-steps article>b{display:grid;width:32px;height:32px;place-items:center;border-radius:50%;background:#eef2f6;color:#667085}.wizard-steps article.done>b{background:var(--brand-700);color:#fff}.wizard-steps strong{font-size:15px}.wizard-steps p{margin:6px 0 12px;color:var(--text-secondary);line-height:1.55}.token-box{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px}.token-box code{padding:11px;border-radius:8px;background:var(--surface-soft);word-break:break-all}.token-box small{grid-column:1/-1;color:var(--text-secondary)}
.scope-alert{margin-bottom:20px}.metrics-strip{display:grid;grid-template-columns:repeat(3,1fr);margin-bottom:20px;border:1px solid var(--border);border-radius:12px;background:var(--surface);overflow:hidden}.metrics-strip div{padding:18px 24px;border-right:1px solid var(--border)}.metrics-strip div:last-child{border:0}.metrics-strip span,.metrics-strip strong{display:block}.metrics-strip span{color:var(--text-secondary);font-size:12px}.metrics-strip strong{margin-top:5px;font-size:24px}.accounts-panel{overflow:hidden}.accounts-title{align-items:flex-end}.filters{display:grid;grid-template-columns:minmax(190px,250px) 150px 125px 135px auto;gap:8px}.accounts-table{width:100%}.identity strong,.identity span{display:block}.identity span,.muted{margin-top:4px;color:var(--text-secondary);font-size:12px}.identity span{font-family:"Cascadia Code",monospace}.capability-tags{display:flex;flex-wrap:wrap;gap:5px}.account-cards{display:none}.dialog-alert{margin-bottom:18px}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 18px}
@media(max-width:1250px){.accounts-title{display:grid}.filters{width:100%;grid-template-columns:minmax(180px,1fr) 145px 120px 130px auto}}
@media(max-width:720px){.connect-grid{grid-template-columns:1fr;padding:0 14px 14px}.metrics-strip div{padding:14px 12px}.metrics-strip strong{font-size:21px}.filters{grid-template-columns:1fr}.accounts-table{display:none}.account-cards{display:grid;gap:12px;padding:14px}.account-cards article{padding:16px;border:1px solid var(--border);border-radius:10px}.account-cards header{display:flex;justify-content:space-between;gap:12px}.account-cards dl{display:grid;gap:11px;margin:17px 0}.account-cards dl div{display:grid;grid-template-columns:76px 1fr;gap:10px}.account-cards dt{color:var(--text-secondary);font-size:13px}.account-cards dd{margin:0;font-size:13px}.account-cards footer{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:18px}.account-cards footer .el-button{min-height:42px;margin:0}.account-cards footer .el-button:last-child{grid-column:1/-1}.form-grid{grid-template-columns:1fr}.token-box{grid-template-columns:1fr}.token-box small{grid-column:1}}
</style>
