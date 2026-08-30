<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import type { FormInstance, FormRules } from 'element-plus'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Connection, Plus, Refresh } from '@element-plus/icons-vue'
import { api, apiErrorMessage, apiFieldErrors, ensureCsrf } from '../services/api'
import { authStore } from '../stores/auth'
import type { BossAccount, BossAccountStatus, BrowserDevice, Company } from '../types'

interface AccountFormValue { companyId: string; displayName: string; externalIdentifier: string }

const loading = ref(true)
const loadError = ref('')
const accounts = ref<BossAccount[]>([])
const devices = ref<BrowserDevice[]>([])
const companies = ref<Company[]>([])
const dialogOpen = ref(false)
const saving = ref(false)
const editingAccount = ref<BossAccount | null>(null)
const formRef = ref<FormInstance>()
const form = reactive<AccountFormValue>({ companyId: '', displayName: '', externalIdentifier: '' })
const formError = ref('')
const fieldErrors = reactive<Record<string, string>>({})
const changingStatusId = ref('')
const connectionOpen = ref(false)
const selectedAccount = ref<BossAccount | null>(null)
const pairingLoading = ref(false)
const pairingToken = ref('')
const pairingExpiresAt = ref('')
const advancedPairingOpen = ref<string[]>([])
const savedAccountsOpen = ref<string[]>([])

const canManage = computed(() => ['SYSTEM_ADMIN', 'RECRUITMENT_ADMIN'].includes(authStore.state.user?.role ?? ''))
const activeCompanies = computed(() => companies.value.filter(company => company.status === 'ACTIVE'))
const connectableAccounts = computed(() => accounts.value.filter(account => account.gatewayType === 'LOCAL_CDP_CONNECTOR'))
const activeDevices = computed(() => devices.value.filter(device => device.status === 'ACTIVE'))
const dialogTitle = computed(() => editingAccount.value ? '编辑招聘账号' : '新增招聘账号')
const rules: FormRules<AccountFormValue> = {
  companyId: [{ required: true, message: '请选择归属企业', trigger: 'change' }],
  displayName: [{ required: true, message: '请输入账号名称', trigger: 'blur' }, { max: 100, message: '最多 100 个字符', trigger: 'blur' }],
  externalIdentifier: [{ required: true, message: '请输入内部标识', trigger: 'blur' }, { max: 120, message: '最多 120 个字符', trigger: 'blur' }],
}

function clearFieldErrors() { Object.keys(fieldErrors).forEach(key => delete fieldErrors[key]) }
function activeDevice(accountId: string) { return devices.value.find(device => device.accountId === accountId && device.status === 'ACTIVE') }
function connectionState(account: BossAccount) {
  const device = activeDevice(account.id)
  if (!device) return { label: '未接入', type: 'info' as const, detail: '账号尚未与该 Chrome Profile 中的只读桥接器配对。' }
  if (device.runtimeState === 'RUNNING') return { label: '已连接', type: 'success' as const, detail: '当前仍遵循只读监测，不会自动发送消息。' }
  if (device.runtimeState === 'PAUSED' && /^只监测：/.test(device.stopReason || '')) return { label: '只读观察', type: 'warning' as const, detail: '页面已接入，但当前仅同步状态。' }
  return { label: '未运行', type: 'info' as const, detail: '之前的本机连接已停止；不影响账号资料，也不会产生任何平台操作。' }
}

async function loadData() {
  loading.value = true
  loadError.value = ''
  try {
    const [accountResponse, companyResponse, deviceResponse] = await Promise.all([
      api.get<BossAccount[]>('/boss-accounts'), api.get<Company[]>('/organization/companies'), api.get<BrowserDevice[]>('/local-connector/devices'),
    ])
    accounts.value = accountResponse.data
    companies.value = companyResponse.data
    devices.value = deviceResponse.data
  } catch (error) { loadError.value = apiErrorMessage(error, '账号资料加载失败，请重试') }
  finally { loading.value = false }
}

function openConnection(account: BossAccount) {
  selectedAccount.value = account
  pairingToken.value = ''
  pairingExpiresAt.value = ''
  advancedPairingOpen.value = []
  connectionOpen.value = true
}
async function generatePairing() {
  if (!selectedAccount.value) return
  pairingLoading.value = true
  try {
    await ensureCsrf()
    const { data } = await api.post<{ pairingToken: string; expiresAt: string }>('/local-connector/devices/pairings', { accountId: selectedAccount.value.id })
    pairingToken.value = data.pairingToken
    pairingExpiresAt.value = data.expiresAt
    ElMessage.success('临时接入码已生成，仅用于本机配对')
  } catch (error) { ElMessage.error(apiErrorMessage(error, '接入码生成失败')) }
  finally { pairingLoading.value = false }
}
async function copyToken() {
  try { await navigator.clipboard.writeText(pairingToken.value); ElMessage.success('接入码已复制') }
  catch { ElMessage.warning('复制失败，请手动复制接入码') }
}
function openCreate() {
  editingAccount.value = null
  Object.assign(form, { companyId: activeCompanies.value[0]?.id ?? '', displayName: '', externalIdentifier: '' })
  formError.value = ''
  clearFieldErrors()
  dialogOpen.value = true
}
function openEdit(account: BossAccount) {
  editingAccount.value = account
  Object.assign(form, { companyId: account.company.id, displayName: account.displayName, externalIdentifier: account.externalIdentifier })
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
      ElMessage.success('招聘账号已更新')
    } else {
      await api.post('/boss-accounts', form)
      ElMessage.success('招聘账号已保存，等真实账号到位后再接入浏览器')
    }
    dialogOpen.value = false
    await loadData()
  } catch (error) {
    Object.assign(fieldErrors, apiFieldErrors(error))
    formError.value = apiErrorMessage(error, '招聘账号保存失败，请重试')
  } finally { saving.value = false }
}
async function toggleStatus(account: BossAccount) {
  const status: BossAccountStatus = account.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'
  if (status === 'INACTIVE') {
    try { await ElMessageBox.confirm(`停用后，“${account.displayName}”不会参与后续招聘处理，历史记录仍会保留。`, '确认停用账号', { type: 'warning', confirmButtonText: '确认停用', cancelButtonText: '取消' }) }
    catch { return }
  }
  changingStatusId.value = account.id
  try {
    await ensureCsrf()
    await api.patch(`/boss-accounts/${account.id}/status`, { status })
    ElMessage.success(status === 'ACTIVE' ? '招聘账号已启用' : '招聘账号已停用')
    await loadData()
  } catch (error) { ElMessage.error(apiErrorMessage(error, '账号状态变更失败')) }
  finally { changingStatusId.value = '' }
}
function formatDate(value?: string) { return value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '尚无记录' }
onMounted(loadData)
</script>

<template>
  <div class="page-shell accounts-page">
    <el-dialog v-model="connectionOpen" :title="`${selectedAccount?.displayName ?? ''} · 本机接入说明`" width="600px" destroy-on-close>
      <el-alert type="info" :closable="false" show-icon title="当前仅接入只读桥接器：不会点击、跳转、填写或发送 BOSS 消息。" />
      <section v-if="selectedAccount" class="connection-summary">
        <span>当前状态</span><strong>{{ connectionState(selectedAccount).label }}</strong><p>{{ connectionState(selectedAccount).detail }}</p>
      </section>
      <el-collapse v-model="advancedPairingOpen" class="advanced-connection">
        <el-collapse-item name="pairing"><template #title><strong>在对应 Chrome Profile 中完成一次只读桥接</strong></template>
          <ol><li>为该 BOSS 账号使用独立 Chrome Profile，由 HR 手动登录。</li><li>在 <code>chrome://extensions</code> 加载项目中的 <code>boss-browser-bridge</code> 目录。</li><li>在下方生成一次性接入码，粘贴到扩展弹窗完成配对。</li><li>手动打开 BOSS 沟通页并刷新一次，再返回此页确认“只读观察”状态。</li></ol>
          <div v-if="pairingToken" class="token-box"><code>{{ pairingToken }}</code><el-button type="primary" @click="copyToken">复制临时接入码</el-button><small>请在 {{ formatDate(pairingExpiresAt) }} 前完成；它不能用于登录 BOSS。</small></div>
          <el-button v-else type="primary" :loading="pairingLoading" @click="generatePairing">生成临时接入码</el-button>
        </el-collapse-item>
      </el-collapse>
      <template #footer><el-button :icon="Refresh" @click="loadData">刷新状态</el-button><el-button type="primary" @click="connectionOpen = false">关闭</el-button></template>
    </el-dialog>

    <header class="page-heading"><div><span class="eyebrow">ACCOUNT CONNECTION</span><h1>账号与浏览器</h1><p>一个 BOSS 账号对应一个 Chrome Profile 和一份只读桥接器配对，登录与验证始终由 HR 在 BOSS 页面手动完成。</p></div><el-button v-if="canManage" type="primary" :icon="Plus" @click="openCreate">新增 BOSS 账号</el-button></header>
    <el-alert class="scope-alert" type="warning" :closable="false" show-icon title="当前为只读准备模式：不会保存密码、Cookie，也不会自动操作或发送 BOSS 消息。" />
    <div v-if="loading" class="surface-panel skeleton-stack"><el-skeleton :rows="7" animated /></div>
    <div v-else-if="loadError" class="surface-panel error-state" role="alert"><span class="error-state__icon"><el-icon><Refresh /></el-icon></span><strong>账号资料暂时无法加载</strong><span>{{ loadError }}</span><el-button :icon="Refresh" @click="loadData">重新加载</el-button></div>
    <template v-else>
      <section class="preparation-panel">
        <div class="preparation-copy"><span class="section-kicker">CURRENT STAGE</span><h2>先完成只读观测闭环</h2><p>当前只验证“真实未读 → 脱敏摘要 → 岗位去重 → 安全草稿”，不包含任何 BOSS 页面写操作。</p><div class="future-flow"><span>独立 Profile 登录</span><i></i><span>只读桥接配对</span><i></i><span>核对未读与岗位</span></div></div>
        <div class="preparation-stats"><article><span>已保存账号</span><strong>{{ connectableAccounts.length }}</strong></article><article><span>活跃浏览器设备</span><strong>{{ activeDevices.length }}</strong></article><article><span>自动发送</span><strong>关闭</strong></article></div>
      </section>

      <section class="surface-panel saved-panel">
        <el-collapse v-model="savedAccountsOpen">
          <el-collapse-item name="accounts"><template #title><div class="saved-title"><span class="saved-title__icon"><el-icon><Connection /></el-icon></span><div><strong>已有账号配置</strong><small>{{ connectableAccounts.length ? `已保存 ${connectableAccounts.length} 个内部账号标识；当前不代表已登录或正在运行。` : '暂无账号配置。' }}</small></div></div></template>
            <div v-if="!connectableAccounts.length" class="compact-empty"><span>暂时没有需要管理的账号</span><small>真实账号到位后，由管理员添加一个内部名称和标识即可。</small><el-button v-if="canManage" type="primary" @click="openCreate">新增 BOSS 账号</el-button></div>
            <div v-else class="account-grid"><article v-for="account in connectableAccounts" :key="account.id"><header><div class="account-avatar">{{ account.displayName.slice(0, 1) }}</div><div><strong>{{ account.displayName }}</strong><small>{{ account.company.name }} · {{ account.externalIdentifier }}</small></div><el-tag :type="connectionState(account).type">{{ connectionState(account).label }}</el-tag></header><p>{{ connectionState(account).detail }}</p><dl><div><dt>账号状态</dt><dd>{{ account.status === 'ACTIVE' ? '已启用' : '已停用' }}</dd></div><div><dt>最近本机心跳</dt><dd>{{ formatDate(activeDevice(account.id)?.lastHeartbeatAt) }}</dd></div></dl><footer><el-button @click="openConnection(account)">查看接入说明</el-button><template v-if="canManage"><el-button @click="openEdit(account)">编辑</el-button><el-button :type="account.status === 'ACTIVE' ? 'danger' : 'success'" plain :loading="changingStatusId === account.id" @click="toggleStatus(account)">{{ account.status === 'ACTIVE' ? '停用' : '启用' }}</el-button></template></footer></article></div>
          </el-collapse-item>
        </el-collapse>
      </section>
    </template>

    <el-dialog v-model="dialogOpen" :title="dialogTitle" width="600px" destroy-on-close><el-alert v-if="formError" :title="formError" type="error" :closable="false" show-icon class="dialog-alert" /><el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent="saveAccount"><div class="form-grid"><el-form-item label="归属企业" prop="companyId" :error="fieldErrors.companyId"><el-select v-model="form.companyId" filterable placeholder="请选择有效企业"><el-option v-for="company in activeCompanies" :key="company.id" :label="`${company.name}（${company.code}）`" :value="company.id" /></el-select></el-form-item><el-form-item label="账号名称" prop="displayName" :error="fieldErrors.displayName"><el-input v-model="form.displayName" maxlength="100" placeholder="例如：上海社招账号" /></el-form-item><el-form-item label="账号内部标识" prop="externalIdentifier" :error="fieldErrors.externalIdentifier"><el-input v-model="form.externalIdentifier" maxlength="120" placeholder="例如：boss-shanghai-01；不要填手机号、Cookie 或 Token" /></el-form-item></div><el-alert title="此处仅保存内部标识。真实账号到位后才由 HR 在独立浏览器中手动登录；系统不会保存 BOSS 密码、Cookie 或 Token。" type="success" :closable="false" /></el-form><template #footer><el-button @click="dialogOpen = false">取消</el-button><el-button type="primary" :loading="saving" @click="saveAccount">{{ editingAccount ? '保存修改' : '确认创建' }}</el-button></template></el-dialog>
  </div>
</template>

<style scoped>
.accounts-page{max-width:1340px}.eyebrow,.section-kicker{display:block;margin-bottom:8px;color:var(--brand-700);font-size:10px;font-weight:800;letter-spacing:.12em}.scope-alert{margin-bottom:18px}.preparation-panel{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(310px,.8fr);gap:26px;margin-bottom:18px;padding:26px 28px;border:1px solid #cfe4df;border-radius:19px;background:radial-gradient(circle at 88% 0,rgba(184,243,233,.7),transparent 35%),linear-gradient(135deg,#fff,#f1fbf8);box-shadow:var(--shadow-sm)}.preparation-copy h2{margin:0;font-size:24px;letter-spacing:-.025em}.preparation-copy>p{max-width:640px;margin:9px 0 20px;color:var(--text-secondary);line-height:1.65}.future-flow{display:flex;align-items:center;gap:11px;color:var(--brand-700);font-size:12px;font-weight:700}.future-flow span{padding:8px 10px;border:1px solid #c4e5df;border-radius:9px;background:rgba(255,255,255,.76)}.future-flow i{width:24px;height:1px;background:#91cabe}.preparation-stats{display:grid;grid-template-columns:repeat(3,1fr);align-self:center;border:1px solid #dcebe8;border-radius:14px;background:rgba(255,255,255,.78);overflow:hidden}.preparation-stats article{padding:18px 14px;border-right:1px solid #dcebe8}.preparation-stats article:last-child{border-right:0}.preparation-stats span,.preparation-stats strong{display:block}.preparation-stats span{color:var(--text-secondary);font-size:11px}.preparation-stats strong{margin-top:7px;font-size:21px}.saved-panel{overflow:hidden}.saved-panel :deep(.el-collapse){border:0}.saved-panel :deep(.el-collapse-item__header){height:auto;min-height:86px;padding:0 22px;border:0}.saved-panel :deep(.el-collapse-item__wrap){border:0}.saved-title{display:flex;align-items:center;gap:12px}.saved-title__icon{display:grid;width:40px;height:40px;place-items:center;border-radius:11px;background:var(--brand-100);color:var(--brand-700);font-size:19px}.saved-title strong,.saved-title small{display:block}.saved-title small{margin-top:4px;color:var(--text-secondary);font-size:12px;font-weight:400;line-height:1.45}.account-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;padding:0 22px 22px}.account-grid article{padding:18px;border:1px solid var(--border);border-radius:14px;background:#fff}.account-grid header{display:grid;grid-template-columns:42px minmax(0,1fr) auto;align-items:center;gap:11px}.account-avatar{display:grid;width:42px;height:42px;place-items:center;border-radius:11px;background:var(--brand-100);color:var(--brand-700);font-size:16px;font-weight:800}.account-grid header strong,.account-grid header small{display:block}.account-grid header small{margin-top:4px;color:var(--text-secondary);font-size:11px}.account-grid>article>p{min-height:42px;margin:16px 0 14px;color:var(--text-secondary);font-size:12px;line-height:1.55}.account-grid dl{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:0;padding:12px;border-radius:10px;background:var(--surface-soft)}.account-grid dt{color:var(--text-secondary);font-size:11px}.account-grid dd{margin:5px 0 0;font-size:12px}.account-grid footer{display:flex;flex-wrap:wrap;gap:8px;margin-top:15px}.compact-empty{display:grid;justify-items:start;gap:7px;padding:0 22px 24px}.compact-empty span{font-weight:700}.compact-empty small{color:var(--text-secondary);font-size:12px;line-height:1.5}.connection-summary{margin:18px 0;padding:16px;border:1px solid #d5e7e3;border-radius:12px;background:#f6fbfa}.connection-summary span{display:block;color:var(--text-secondary);font-size:11px}.connection-summary strong{display:block;margin:5px 0;color:var(--brand-700);font-size:17px}.connection-summary p{margin:0;color:var(--text-secondary);line-height:1.55}.advanced-connection{margin-top:14px}.advanced-connection :deep(.el-collapse){border-top:1px solid var(--border);border-bottom:1px solid var(--border)}.advanced-connection :deep(.el-collapse-item__header){color:var(--text);font-size:13px}.advanced-connection ol{display:grid;gap:8px;margin:0 0 15px;padding-left:20px;color:var(--text-secondary);font-size:13px;line-height:1.55}.token-box{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px}.token-box code{padding:11px;border-radius:8px;background:var(--surface-soft);word-break:break-all}.token-box small{grid-column:1/-1;color:var(--text-secondary);font-size:11px}.dialog-alert{margin-bottom:18px}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 18px}.form-grid .el-form-item:first-child{grid-column:1/-1}.form-grid .el-select{width:100%}@media(max-width:900px){.preparation-panel{grid-template-columns:1fr}.preparation-stats{max-width:560px}}@media(max-width:700px){.preparation-panel{padding:22px}.future-flow{align-items:flex-start;flex-direction:column}.future-flow i{width:1px;height:13px;margin-left:10px}.preparation-stats{width:100%}.preparation-stats article{padding:14px 10px}.account-grid{grid-template-columns:1fr;padding:0 16px 16px}.saved-panel :deep(.el-collapse-item__header){padding:0 16px}.form-grid{grid-template-columns:1fr}.form-grid .el-form-item:first-child{grid-column:auto}.token-box{grid-template-columns:1fr}}
</style>
