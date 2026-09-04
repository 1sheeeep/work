<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import type { FormInstance, FormRules } from 'element-plus'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Connection, MoreFilled, Plus, Refresh } from '@element-plus/icons-vue'
import { api, apiErrorMessage, apiFieldErrors, ensureCsrf } from '../services/api'
import { authStore } from '../stores/auth'
import type { BossAccount, BossAccountStatus, BrowserDevice, BrowserUnreadObservation, Company, JobPosition } from '../types'

interface AccountFormValue { displayName: string; externalIdentifier: string }

const loading = ref(true)
const loadError = ref('')
const accounts = ref<BossAccount[]>([])
const devices = ref<BrowserDevice[]>([])
const companies = ref<Company[]>([])
const observations = ref<BrowserUnreadObservation[]>([])
const jobs = ref<JobPosition[]>([])
const dialogOpen = ref(false)
const saving = ref(false)
const editingAccount = ref<BossAccount | null>(null)
const formRef = ref<FormInstance>()
const form = reactive<AccountFormValue>({ displayName: '', externalIdentifier: '' })
const formError = ref('')
const fieldErrors = reactive<Record<string, string>>({})
const changingStatusId = ref('')
const connectionOpen = ref(false)
const selectedAccount = ref<BossAccount | null>(null)
const pairingLoading = ref(false)
const pairingToken = ref('')
const pairingExpiresAt = ref('')
const accountFilter = ref<'ALL' | 'ONLINE' | 'ATTENTION' | 'PAUSED'>('ALL')
const accountFilterOptions: Array<{ value: 'ALL' | 'ONLINE' | 'ATTENTION' | 'PAUSED'; label: string }> = [
  { value: 'ALL', label: '全部' }, { value: 'ONLINE', label: '运行正常' }, { value: 'ATTENTION', label: '需要关注' }, { value: 'PAUSED', label: '已暂停' },
]

const canManage = computed(() => ['SYSTEM_ADMIN', 'RECRUITMENT_ADMIN'].includes(authStore.state.user?.role ?? ''))
const activeCompany = computed(() => companies.value.find(company => company.status === 'ACTIVE'))
const visibleAccounts = computed(() => accounts.value.filter(account => account.gatewayType === 'LOCAL_CDP_CONNECTOR'))
const connectedCount = computed(() => visibleAccounts.value.filter(account => activeDevice(account.id)?.runtimeState === 'RUNNING').length)
const collectingCount = computed(() => visibleAccounts.value.filter(account => {
  const device = activeDevice(account.id)
  return device?.runtimeState === 'RUNNING' && !!device.lastSuccessfulChatSyncAt && device.recoveryStatus !== 'WAITING_RECOLLECTION'
}).length)
const activeUnread = computed(() => observations.value.filter(item => item.unread && item.resolutionStatus === 'UNRESOLVED'))
const activeJobs = computed(() => jobs.value.filter(item => item.captureSource === 'VISIBLE_PAGE' && item.status !== 'CLOSED'))
const collectionBlockedCount = computed(() => Math.max(0, visibleAccounts.value.length - collectingCount.value))
const attentionCount = computed(() => visibleAccounts.value.filter(account => {
  const device = activeDevice(account.id)
  return device?.runtimeState !== 'RUNNING' || !device.lastSuccessfulChatSyncAt || device.recoveryStatus === 'WAITING_RECOLLECTION' || unreadTotal(account.id) > 0 || draftJobCount(account.id) > 0
}).length)
const accountDistribution = computed(() => {
  const total = visibleAccounts.value.length
  const paused = visibleAccounts.value.filter(account => account.status !== 'ACTIVE' || activeDevice(account.id)?.runtimeState === 'PAUSED').length
  const attention = visibleAccounts.value.filter(account => {
    const device = activeDevice(account.id)
    return account.status === 'ACTIVE' && device?.runtimeState !== 'PAUSED' && (device?.runtimeState !== 'RUNNING' || collectionState(account).tone !== 'healthy')
  }).length
  const normal = Math.max(0, total - paused - attention)
  const normalEnd = total ? normal / total * 360 : 0
  const attentionEnd = total ? normalEnd + attention / total * 360 : 0
  return {
    total,
    normal,
    attention,
    paused,
    ringStyle: { background: `conic-gradient(var(--success) 0deg ${normalEnd}deg, var(--warning) ${normalEnd}deg ${attentionEnd}deg, #98a6bb ${attentionEnd}deg 360deg)` },
  }
})
const filteredAccounts = computed(() => visibleAccounts.value.filter(account => {
  const device = activeDevice(account.id)
  if (accountFilter.value === 'ONLINE') return device?.runtimeState === 'RUNNING' && collectionState(account).tone === 'healthy'
  if (accountFilter.value === 'PAUSED') return device?.runtimeState === 'PAUSED' || account.status !== 'ACTIVE'
  if (accountFilter.value === 'ATTENTION') return device?.runtimeState !== 'RUNNING' || collectionState(account).tone !== 'healthy' || unreadTotal(account.id) > 0 || draftJobCount(account.id) > 0
  return true
}))
const dialogTitle = computed(() => editingAccount.value ? '编辑招聘账号' : '新增招聘账号')
const rules: FormRules<AccountFormValue> = {
  displayName: [{ required: true, message: '请输入账号名称', trigger: 'blur' }, { max: 100, message: '最多 100 个字符', trigger: 'blur' }],
  externalIdentifier: [{ required: true, message: '请输入内部标识', trigger: 'blur' }, { max: 120, message: '最多 120 个字符', trigger: 'blur' }],
}

function clearFieldErrors() { Object.keys(fieldErrors).forEach(key => delete fieldErrors[key]) }
function activeDevice(accountId: string) { return devices.value.find(device => device.accountId === accountId && device.status === 'ACTIVE') }
function unreadTotal(accountId: string) { return activeUnread.value.filter(item => item.accountId === accountId).reduce((total, item) => total + item.unreadCount, 0) }
function syncedJobCount(accountId: string) { return activeJobs.value.filter(item => item.bossAccount.id === accountId).length }
function draftJobCount(accountId: string) { return jobs.value.filter(item => item.bossAccount.id === accountId && item.status === 'DRAFT').length }
function pageContextLabel(device?: BrowserDevice) {
  return ({ CHAT: '沟通页', JOB_LIST: '职位列表', JOB_DETAIL: '职位详情', OTHER_BOSS: '其他页面', NO_BOSS_PAGE: '未打开工作页' } as const)[device?.pageContext ?? 'NO_BOSS_PAGE']
}
function connectionState(account: BossAccount) {
  const device = activeDevice(account.id)
  if (!device) return { label: '未桥接', type: 'info' as const, tone: 'offline' }
  if (device.runtimeState === 'RUNNING') return { label: '桥接在线', type: 'success' as const, tone: 'online' }
  if (device.runtimeState === 'PAUSED') return { label: '桥接暂停', type: 'warning' as const, tone: 'paused' }
  return { label: '桥接离线', type: 'info' as const, tone: 'offline' }
}
function collectionState(account: BossAccount) {
  const device = activeDevice(account.id)
  if (!device) return { label: '尚未桥接', type: 'info' as const, tone: 'unknown' }
  if (device.recoveryStatus === 'WAITING_RECOLLECTION') return { label: '等待重新采集', type: 'warning' as const, tone: 'pending' }
  if (device.recoveryStatus === 'NEVER_COLLECTED') return { label: '尚无成功采集', type: 'info' as const, tone: 'unknown' }
  if (device.recoveryStatus === 'RECOLLECTED') return { label: '恢复已确认', type: 'success' as const, tone: 'healthy' }
  return { label: '采集正常', type: 'success' as const, tone: 'healthy' }
}
function syncTypeLabel(type?: BrowserDevice['lastSuccessfulSyncType']) { return type === 'CHAT' ? '沟通页' : type === 'JOB' ? '职位页' : '—' }
function lastSuccessfulSync(device?: BrowserDevice) {
  return device?.lastSuccessfulSyncAt ? `${formatDate(device.lastSuccessfulSyncAt)} · ${syncTypeLabel(device.lastSuccessfulSyncType)}` : '尚无成功采集记录'
}
function pauseReason(device?: BrowserDevice) {
  if (!device) return '尚未建立浏览器桥接'
  return (device.runtimeState === 'RUNNING' ? device.lastPauseReason : device.stopReason || device.lastPauseReason) || '暂无暂停记录'
}
function recoveryEvidence(device?: BrowserDevice) {
  if (!device) return '等待首次配对和采集'
  if (device.recoveryStatus === 'WAITING_RECOLLECTION') return `自 ${formatDate(device.recoveryRequiredSince)} 起，尚未收到新的沟通页稳定快照`
  if (device.recoveryStatus === 'RECOLLECTED') return `${formatDate(device.lastRecoveredAt)} 已完成沟通页重新采集`
  if (device.recoveryStatus === 'HEALTHY') return '最近一次沟通页稳定快照已成功入库'
  return '等待首次沟通页稳定快照'
}

async function loadData() {
  loading.value = true
  loadError.value = ''
  try {
    const [accountResponse, companyResponse, deviceResponse, observationResponse, jobResponse] = await Promise.all([
      api.get<BossAccount[]>('/boss-accounts'),
      api.get<Company[]>('/organization/companies'),
      api.get<BrowserDevice[]>('/local-connector/devices'),
      api.get<BrowserUnreadObservation[]>('/local-connector/observations'),
      api.get<JobPosition[]>('/job-positions'),
    ])
    accounts.value = accountResponse.data
    companies.value = companyResponse.data
    devices.value = deviceResponse.data
    observations.value = observationResponse.data
    jobs.value = jobResponse.data
  } catch (error) { loadError.value = apiErrorMessage(error, '招聘账号加载失败') }
  finally { loading.value = false }
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
    const { data } = await api.post<{ pairingToken: string; expiresAt: string }>('/local-connector/devices/pairings', { accountId: selectedAccount.value.id })
    pairingToken.value = data.pairingToken
    pairingExpiresAt.value = data.expiresAt
    ElMessage.success('一次性连接码已生成')
  } catch (error) { ElMessage.error(apiErrorMessage(error, '连接码生成失败')) }
  finally { pairingLoading.value = false }
}

async function copyToken() {
  try { await navigator.clipboard.writeText(pairingToken.value); ElMessage.success('连接码已复制') }
  catch { ElMessage.warning('复制失败，请手动复制') }
}

function openCreate() {
  if (!activeCompany.value) { ElMessage.error('内部企业主体尚未初始化，暂时无法新增账号'); return }
  editingAccount.value = null
  Object.assign(form, { displayName: '', externalIdentifier: '' })
  formError.value = ''
  clearFieldErrors()
  dialogOpen.value = true
}

function openEdit(account: BossAccount) {
  editingAccount.value = account
  Object.assign(form, { displayName: account.displayName, externalIdentifier: account.externalIdentifier })
  formError.value = ''
  clearFieldErrors()
  dialogOpen.value = true
}

async function saveAccount() {
  formError.value = ''
  clearFieldErrors()
  if (!(await formRef.value?.validate().catch(() => false))) return
  const companyId = editingAccount.value?.company.id ?? activeCompany.value?.id
  if (!companyId) { formError.value = '内部企业主体尚未初始化'; return }
  saving.value = true
  try {
    await ensureCsrf()
    const payload = { ...form, companyId }
    if (editingAccount.value) await api.put(`/boss-accounts/${editingAccount.value.id}`, payload)
    else await api.post('/boss-accounts', payload)
    ElMessage.success(editingAccount.value ? '招聘账号已更新' : '招聘账号已创建')
    dialogOpen.value = false
    await loadData()
  } catch (error) {
    Object.assign(fieldErrors, apiFieldErrors(error))
    formError.value = apiErrorMessage(error, '招聘账号保存失败')
  } finally { saving.value = false }
}

async function toggleStatus(account: BossAccount) {
  const status: BossAccountStatus = account.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'
  if (status === 'INACTIVE') {
    try { await ElMessageBox.confirm(`确认停用“${account.displayName}”？`, '停用招聘账号', { confirmButtonText: '停用', cancelButtonText: '取消' }) }
    catch { return }
  }
  changingStatusId.value = account.id
  try {
    await ensureCsrf()
    await api.patch(`/boss-accounts/${account.id}/status`, { status })
    await loadData()
  } catch (error) { ElMessage.error(apiErrorMessage(error, '账号状态变更失败')) }
  finally { changingStatusId.value = '' }
}

function handleAccountCommand(account: BossAccount, command: 'edit' | 'toggle') {
  if (command === 'edit') openEdit(account)
  else void toggleStatus(account)
}

function formatDate(value?: string) {
  return value ? new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '—'
}

onMounted(loadData)
</script>

<template>
  <div class="page-shell accounts-page">
    <header class="page-heading compact-heading">
      <div><h1>多账号运营中心</h1><p>一眼查看账号的连接、采集与待恢复状态。</p></div>
      <div class="heading-actions"><el-button :icon="Refresh" :loading="loading" @click="loadData">刷新</el-button><el-button v-if="canManage" type="primary" :icon="Plus" @click="openCreate">新增账号</el-button></div>
    </header>

    <div v-if="loading" class="surface-panel skeleton-stack"><el-skeleton :rows="7" animated /></div>
    <div v-else-if="loadError" class="surface-panel error-state"><span class="error-state__icon"><el-icon><Refresh /></el-icon></span><strong>账号暂时无法加载</strong><span>{{ loadError }}</span><el-button @click="loadData">重试</el-button></div>
    <template v-else>
      <section class="accounts-overview" aria-label="招聘账号概览">
        <article class="surface-panel section-card card-panel connection-overview">
          <div class="overview-heading"><div><span>正常采集账号</span><strong>{{ collectingCount }} / {{ visibleAccounts.length }}</strong></div><span class="overview-state" :class="collectingCount === visibleAccounts.length ? 'healthy' : 'warning'"><i></i>{{ collectingCount === visibleAccounts.length ? '采集正常' : `${collectionBlockedCount} 个账号待恢复` }}</span></div>
          <p>{{ collectingCount === visibleAccounts.length ? '所有账号均已连接，并完成最近一次沟通页同步。' : '有账号尚未完成沟通页采集，请查看下方状态与暂停原因。' }}</p>
          <div class="overview-metrics"><span><b>{{ connectedCount }}</b> 个桥接在线</span><span><b>{{ activeUnread.length }}</b> 个未读会话</span><span><b>{{ activeJobs.length }}</b> 个已同步岗位</span></div>
        </article>
        <article class="surface-panel section-card card-panel attention-overview" :class="{ 'attention-overview--warning': attentionCount, 'card-emphasis': attentionCount, 'card-emphasis--warning': attentionCount }">
          <div class="overview-heading"><div><span>当前优先处理</span><strong>{{ attentionCount ? `${attentionCount} 个账号待关注` : '暂无待关注账号' }}</strong></div><span class="attention-mark" :class="{ 'attention-mark--quiet': !attentionCount }"></span></div>
          <div class="attention-list">
            <p v-if="activeUnread.length">{{ activeUnread.length }} 个会话仍处于未读观察中，可到“今日值守”集中处理。</p>
            <p v-if="collectionBlockedCount">{{ collectionBlockedCount }} 个账号需要恢复采集，请查看下方暂停原因和恢复状态。</p>
            <p v-if="!activeUnread.length && !collectionBlockedCount">桥接和沟通页采集状态正常，暂时没有需要立即处理的项目。</p>
          </div>
        </article>
        <article class="surface-panel section-card card-panel account-distribution-overview">
          <div class="overview-heading"><div><span>账号总览</span><strong>运行分布</strong></div></div>
          <div class="distribution-content">
            <div class="distribution-ring" :style="accountDistribution.ringStyle"><div><b>{{ accountDistribution.total }}</b><small>总账号</small></div></div>
            <dl>
              <div><dt><i class="normal"></i>运行正常</dt><dd>{{ accountDistribution.normal }}<small>（{{ accountDistribution.total ? Math.round(accountDistribution.normal / accountDistribution.total * 100) : 0 }}%）</small></dd></div>
              <div><dt><i class="attention"></i>需要关注</dt><dd>{{ accountDistribution.attention }}<small>（{{ accountDistribution.total ? Math.round(accountDistribution.attention / accountDistribution.total * 100) : 0 }}%）</small></dd></div>
              <div><dt><i class="paused"></i>已暂停</dt><dd>{{ accountDistribution.paused }}<small>（{{ accountDistribution.total ? Math.round(accountDistribution.paused / accountDistribution.total * 100) : 0 }}%）</small></dd></div>
            </dl>
          </div>
        </article>
      </section>
      <section class="account-workspace card-panel" aria-label="招聘账号工作区">
      <div v-if="visibleAccounts.length" class="account-toolbar" aria-label="账号状态筛选">
        <div><strong>多账号运行状态</strong><span>按桥接与采集状态快速定位账号</span></div>
        <div class="account-filter-tabs">
          <button v-for="option in accountFilterOptions" :key="option.value" type="button" :class="{ active: accountFilter === option.value }" :aria-pressed="accountFilter === option.value" @click="accountFilter = option.value">{{ option.label }}</button>
        </div>
      </div>
      <section v-if="!visibleAccounts.length" class="empty-state"><span class="empty-state__icon"><el-icon><Connection /></el-icon></span><strong>尚未添加招聘账号</strong><el-button v-if="canManage" type="primary" @click="openCreate">新增账号</el-button></section>
      <section v-else-if="filteredAccounts.length" class="account-grid" :class="{ 'account-grid--single': filteredAccounts.length === 1 }">
        <article v-for="account in filteredAccounts" :key="account.id" class="entity-card account-card" aria-label="招聘账号运行状态">
          <header><span class="account-avatar">{{ account.displayName.slice(0, 1) }}</span><div><strong>{{ account.displayName }}</strong><small>{{ account.externalIdentifier }}</small></div><el-tag :type="connectionState(account).type" effect="plain">{{ connectionState(account).label }}</el-tag></header>
          <div class="bridge-state" :class="connectionState(account).tone"><span class="status-dot"></span><div><strong>{{ pageContextLabel(activeDevice(account.id)) }}</strong><small>最近心跳 {{ formatDate(activeDevice(account.id)?.lastHeartbeatAt) }}</small></div></div>
          <section class="collection-health" :class="`collection-health--${collectionState(account).tone}`">
            <header><strong>采集健康</strong><el-tag size="small" :type="collectionState(account).type">{{ collectionState(account).label }}</el-tag></header>
            <dl>
              <div><dt>最后成功同步</dt><dd>{{ lastSuccessfulSync(activeDevice(account.id)) }}</dd></div>
              <div><dt>{{ activeDevice(account.id)?.runtimeState === 'RUNNING' ? '最近暂停原因' : '暂停原因' }}</dt><dd>{{ pauseReason(activeDevice(account.id)) }}</dd></div>
              <div><dt>恢复后重采集</dt><dd>{{ recoveryEvidence(activeDevice(account.id)) }}</dd></div>
            </dl>
          </section>
          <div class="account-facts" aria-label="账号同步数据"><span><b>{{ unreadTotal(account.id) }}</b> 条未读</span><span><b>{{ syncedJobCount(account.id) }}</b> 个同步岗位</span><span><b>{{ draftJobCount(account.id) }}</b> 个待核对岗位</span></div>
          <footer>
            <el-button type="primary" plain @click="openConnection(account)">{{ activeDevice(account.id) ? '查看桥接' : '连接浏览器' }}</el-button>
            <el-dropdown v-if="canManage" trigger="click" @command="handleAccountCommand(account, $event as 'edit' | 'toggle')">
              <el-button text :icon="MoreFilled" aria-label="更多账号操作">更多</el-button>
              <template #dropdown><el-dropdown-menu><el-dropdown-item command="edit">编辑账号</el-dropdown-item><el-dropdown-item command="toggle" :disabled="changingStatusId === account.id" :class="{ 'danger-menu-item': account.status === 'ACTIVE' }">{{ account.status === 'ACTIVE' ? '停用账号' : '启用账号' }}</el-dropdown-item></el-dropdown-menu></template>
            </el-dropdown>
          </footer>
        </article>
      </section>
      <section v-else class="empty-state"><span class="empty-state__icon"><el-icon><Connection /></el-icon></span><strong>当前筛选下没有账号</strong><span>切换其他状态查看全部招聘账号。</span></section>
      </section>
    </template>

    <el-dialog v-model="connectionOpen" :title="`${selectedAccount?.displayName ?? ''} · 浏览器桥接`" width="560px" destroy-on-close>
      <div v-if="selectedAccount" class="connection-dialog">
        <section class="connection-now"><span class="status-dot" :class="connectionState(selectedAccount).tone"></span><div><strong>{{ connectionState(selectedAccount).label }} · {{ collectionState(selectedAccount).label }}</strong><small>{{ pageContextLabel(activeDevice(selectedAccount.id)) }} · 最近心跳 {{ formatDate(activeDevice(selectedAccount.id)?.lastHeartbeatAt) }} · 最后成功同步 {{ lastSuccessfulSync(activeDevice(selectedAccount.id)) }}</small></div></section>
        <ol><li><b>1</b><span>使用该账号专属的 Chrome Profile 登录 BOSS。</span></li><li><b>2</b><span>打开本机桥接扩展，粘贴下方一次性连接码。</span></li><li><b>3</b><span>回到此处刷新，状态显示“桥接在线”即可。</span></li></ol>
        <div v-if="pairingToken" class="token-box"><code>{{ pairingToken }}</code><el-button type="primary" @click="copyToken">复制</el-button><small>{{ formatDate(pairingExpiresAt) }} 前有效</small></div>
        <el-button v-else type="primary" :loading="pairingLoading" @click="generatePairing">生成一次性连接码</el-button>
      </div>
      <template #footer><el-button :icon="Refresh" @click="loadData">刷新状态</el-button><el-button type="primary" @click="connectionOpen = false">完成</el-button></template>
    </el-dialog>

    <el-dialog v-model="dialogOpen" :title="dialogTitle" width="500px" destroy-on-close>
      <el-alert v-if="formError" :title="formError" type="error" :closable="false" class="dialog-alert" />
      <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent="saveAccount">
        <el-form-item label="账号名称" prop="displayName" :error="fieldErrors.displayName"><el-input v-model="form.displayName" maxlength="100" placeholder="例如：BOSS 主招聘账号" /></el-form-item>
        <el-form-item label="内部标识" prop="externalIdentifier" :error="fieldErrors.externalIdentifier"><el-input v-model="form.externalIdentifier" maxlength="120" placeholder="例如：boss-main-01" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="dialogOpen = false">取消</el-button><el-button type="primary" :loading="saving" @click="saveAccount">保存</el-button></template>
    </el-dialog>
  </div>
</template>

<style scoped>
.accounts-page{max-width:1280px}.compact-heading{align-items:center}.heading-actions{display:flex;gap:10px}.accounts-overview{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(300px,.75fr);gap:14px;margin-bottom:18px}.connection-overview,.attention-overview{padding:21px 22px}.overview-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}.overview-heading span,.overview-heading strong{display:block}.overview-heading span{color:var(--text-secondary);font-size:12px}.overview-heading strong{margin-top:5px;font-size:21px;line-height:1.2}.connection-overview>p{max-width:560px;margin:12px 0 16px;color:var(--text-secondary);font-size:12px;line-height:1.65}.overview-metrics{display:flex;flex-wrap:wrap;gap:8px}.overview-metrics span,.account-facts span{padding:8px 10px;border-radius:9px;background:#f4f8f7;color:var(--text-secondary);font-size:11px}.overview-metrics b,.account-facts b{margin-right:3px;color:var(--text);font-size:13px}.attention-overview{background:linear-gradient(145deg,#fff 0%,#fbfcfc 58%,#f4faf8 100%)}.attention-mark{display:block;width:10px;height:10px;margin-top:5px;border-radius:50%;background:#d99018;box-shadow:0 0 0 6px rgba(217,144,24,.12);animation:status-pulse 2.4s ease-out infinite}.attention-mark--quiet{background:#18a879;box-shadow:0 0 0 6px rgba(24,168,121,.12);animation:none}.attention-list{display:grid;gap:8px;margin-top:15px}.attention-list p{margin:0;padding:9px 11px;border-radius:10px;background:#f7f9f8;color:var(--text-secondary);font-size:12px;line-height:1.5}.account-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.account-grid--single{grid-template-columns:minmax(0,1fr)}.account-card{padding:19px;border:1px solid var(--border);border-radius:15px;background:#fff;box-shadow:var(--shadow-sm)}.account-card header{display:grid;grid-template-columns:42px minmax(0,1fr) auto;align-items:center;gap:11px}.account-avatar{display:grid;width:42px;height:42px;place-items:center;border-radius:12px;background:var(--brand-100);color:var(--brand-700);font-weight:800}.account-card header strong,.account-card header small{display:block}.account-card header small{margin-top:4px;color:var(--text-secondary);font-size:11px}.bridge-state{display:flex;align-items:center;gap:11px;margin:16px 0 12px;padding:13px;border-radius:11px;background:var(--surface-soft)}.status-dot{display:block;width:9px;height:9px;flex:0 0 auto;border-radius:50%;background:#9aa8a5}.bridge-state.online .status-dot,.connection-now .status-dot.online{background:#18a879;box-shadow:0 0 0 5px rgba(24,168,121,.12);animation:status-pulse 2.4s ease-out infinite}.bridge-state.paused .status-dot,.connection-now .status-dot.paused{background:#d99018}.bridge-state strong,.bridge-state small,.connection-now strong,.connection-now small{display:block}.bridge-state strong{font-size:13px}.bridge-state small,.connection-now small{margin-top:4px;color:var(--text-secondary);font-size:11px}.account-facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:15px}.account-facts span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.account-card footer{display:flex;gap:8px}.connection-dialog{display:grid;gap:18px}.connection-now{display:flex;align-items:center;gap:13px;padding:15px;border-radius:12px;background:var(--surface-soft)}.connection-dialog ol{display:grid;gap:12px;margin:0;padding:0;list-style:none}.connection-dialog li{display:flex;align-items:center;gap:12px;color:var(--text-secondary);font-size:13px}.connection-dialog li b{display:grid;width:28px;height:28px;place-items:center;border-radius:9px;background:var(--brand-100);color:var(--brand-700)}.token-box{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px}.token-box code{padding:11px;border-radius:8px;background:var(--surface-soft);word-break:break-all}.token-box small{grid-column:1/-1;color:var(--text-secondary);font-size:11px}.dialog-alert{margin-bottom:16px}@keyframes status-pulse{0%{box-shadow:0 0 0 0 rgba(24,168,121,.24)}70%{box-shadow:0 0 0 8px rgba(24,168,121,0)}100%{box-shadow:0 0 0 0 rgba(24,168,121,0)}}@media(max-width:860px){.accounts-overview{grid-template-columns:1fr}.account-grid{grid-template-columns:1fr}}@media(max-width:760px){.heading-actions{width:100%}.heading-actions .el-button{flex:1}.account-facts{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:460px){.account-facts{grid-template-columns:1fr}.overview-metrics{display:grid;grid-template-columns:1fr 1fr}.overview-metrics span:last-child{grid-column:1/-1}}

/* 运营中心版式：首屏健康概览，下面只保留真实账号实体。 */
.accounts-page { width: min(100%, 1440px); max-width: none; }
.account-workspace { padding: 24px; }
.account-workspace > .account-toolbar { margin-top: 0; }
.accounts-page .page-heading { margin-bottom: 32px; }
.accounts-page .page-heading h1 { font-size: clamp(30px, 2.5vw, 38px); letter-spacing: -.035em; }
.accounts-overview { grid-template-columns: minmax(380px, 1.38fr) minmax(280px, .72fr) minmax(330px, .88fr); gap: 22px; margin-bottom: 28px; }
.connection-overview, .attention-overview, .account-distribution-overview { min-height: 206px; padding: 28px 30px; border: 1px solid var(--border); border-radius: 17px; background: #fff; box-shadow: 0 8px 22px rgba(23, 32, 51, .045); }
.connection-overview { border-left: 3px solid var(--brand-600); background: linear-gradient(135deg, #ffffff 66%, #f1fbf8); }
.overview-heading strong { font-size: 27px; letter-spacing: -.025em; }
.connection-overview > p { margin: 15px 0 22px; font-size: 13px; }
.overview-state { align-self: flex-start; }
.overview-metrics { gap: 0; }
.overview-metrics span { padding: 2px 18px; border: 0; border-left: 1px solid var(--border-subtle); border-radius: 0; background: transparent; }
.overview-metrics span:first-child { padding-left: 0; border-left: 0; }
.attention-overview { position: relative; overflow: hidden; }
.attention-overview::after { position: absolute; right: 28px; bottom: 27px; width: 46px; height: 46px; border-radius: 15px; background: #e6f8f4; content: ''; }
.attention-overview .overview-heading, .attention-overview .attention-list { position: relative; z-index: 1; }
.attention-overview .overview-heading strong { font-size: 26px; }
.attention-list p { padding-block: 9px; font-size: 13px; }
.account-distribution-overview { padding-inline: 28px; }
.account-distribution-overview .overview-heading strong { margin-top: 3px; color: var(--text-secondary); font-size: 13px; font-weight: 600; }
.distribution-content { display: grid; grid-template-columns: 128px minmax(0, 1fr); align-items: center; gap: 26px; margin-top: 12px; }
.distribution-ring { display: grid; width: 118px; height: 118px; place-items: center; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(255,255,255,.8); }
.distribution-ring > div { display: grid; width: 76px; height: 76px; place-items: center; align-content: center; border-radius: 50%; background: #fff; }
.distribution-ring b { font-size: 22px; line-height: 1; }
.distribution-ring small { margin-top: 4px; color: var(--text-secondary); font-size: 10px; }
.account-distribution-overview dl { display: grid; gap: 11px; margin: 0; }
.account-distribution-overview dl > div { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.account-distribution-overview dt, .account-distribution-overview dd { margin: 0; font-size: 12px; }
.account-distribution-overview dt { display: inline-flex; align-items: center; gap: 7px; color: var(--text-secondary); }
.account-distribution-overview dt i { width: 8px; height: 8px; border-radius: 50%; }
.account-distribution-overview dt .normal { background: var(--success); }
.account-distribution-overview dt .attention { background: var(--warning); }
.account-distribution-overview dt .paused { background: #98a6bb; }
.account-distribution-overview dd { color: var(--text); font-weight: 750; }
.account-distribution-overview dd small { margin-left: 5px; color: var(--text-secondary); font-size: 10px; font-weight: 600; }
.account-toolbar { margin: 0 0 18px; }
.account-toolbar strong { font-size: 18px; }
.account-toolbar span { font-size: 12px; }
.account-filter-tabs { padding: 5px; border-radius: 12px; background: #f3f6f8; }
.account-filter-tabs button { min-height: 32px; padding: 7px 14px; }
.account-filter-tabs button.active { background: var(--brand-700); color: #fff; box-shadow: 0 5px 12px rgba(15,118,110,.15); }
.account-grid { gap: 18px; }
.account-card { padding: 23px; border-radius: 17px; }
.account-card header { grid-template-columns: 50px minmax(0, 1fr) auto; gap: 13px; }
.account-avatar { width: 50px; height: 50px; border-radius: 15px; font-size: 18px; }
.account-card header strong { font-size: 18px; }
.account-card header small { font-size: 12px; }
.bridge-state { margin-top: 18px; padding: 13px 0; }
.bridge-state strong { font-size: 14px; }
.collection-health { margin-top: 0; }
.collection-health > header { padding: 12px 2px; }
.collection-health dl > div { min-height: 98px; padding: 15px 16px; }
.account-facts { padding: 14px 0; }
.account-card footer { min-height: 56px; align-items: center; }
.account-card footer .el-button:first-child { min-height: 40px; }
@media (max-width: 1200px) { .accounts-overview { grid-template-columns: minmax(0, 1.25fr) minmax(300px, .75fr); } .account-distribution-overview { grid-column: 1 / -1; min-height: auto; } .distribution-content { grid-template-columns: 118px minmax(0, 360px); } }
@media (max-width: 820px) { .accounts-page .page-heading { margin-bottom: 22px; } .accounts-overview { grid-template-columns: 1fr; gap: 14px; } .account-distribution-overview { grid-column: auto; } .connection-overview, .attention-overview, .account-distribution-overview { min-height: auto; padding: 22px; } }
@media (max-width: 520px) { .distribution-content { grid-template-columns: 104px minmax(0, 1fr); gap: 14px; } .distribution-ring { width: 100px; height: 100px; } .distribution-ring > div { width: 64px; height: 64px; } }

/* 账号是可操作实体；概览与状态说明保持静止。 */
.connection-overview, .attention-overview { background: #fff; box-shadow: var(--shadow-card); transform: none; }
.attention-overview.decision-card--warning { background: #fff9ed; }
.attention-overview.decision-card--success { background: #f0faf5; }
.account-card.entity-card { border: 1px solid var(--border); border-radius: var(--card-radius); background: #fff; box-shadow: var(--shadow-card); }
.account-card.entity-card:hover { border-color: var(--border-strong); background: #fff; box-shadow: var(--shadow-card-hover); transform: translateY(-1px); }
.account-card.entity-card:focus-within { outline: 3px solid rgba(15,118,110,.18); outline-offset: 2px; }

.account-summary {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  max-width: 420px;
}

.account-summary article {
  position: relative;
  min-width: 0;
  overflow: hidden;
  border-radius: var(--card-radius);
  background: linear-gradient(145deg, #fff 35%, #f8fbfa 100%);
  box-shadow: var(--shadow-sm);
  transition: transform var(--transition-fast), border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.account-summary article::after {
  position: absolute;
  top: -24px;
  right: -20px;
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: #d8f4ee;
  content: '';
  opacity: .6;
}

.account-summary article:nth-child(2)::after { background: #dceaff; }
.account-summary article > * { position: relative; z-index: 1; }
.account-summary article:hover { transform: translateY(-2px); border-color: var(--border-strong); box-shadow: var(--shadow-card-hover); }

.account-card {
  border-radius: var(--card-radius);
  background: linear-gradient(145deg, #fff 35%, #fbfcfc 100%);
  transition: transform var(--transition-fast), border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.account-card:hover { transform: translateY(-2px); border-color: #9acfc8; box-shadow: var(--shadow-card-hover); }
.account-card header > div { min-width: 0; }
.account-card header strong,
.account-card header small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.account-card footer { flex-wrap: wrap; padding-top: 2px; }
.bridge-state { border: 1px solid #e4eeeb; }
.collection-health { margin-bottom: 12px; overflow: hidden; border: 1px solid #e4ebe9; border-radius: 13px; background: #fbfcfc; }
.collection-health--healthy { border-color: #cbe8df; background: linear-gradient(120deg, #f5fcf9, #fbfdfc); }
.collection-health--pending { border-color: #f0d9ad; background: #fffaf2; }
.collection-health > header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 13px; border-bottom: 1px solid rgba(214, 225, 222, .72); }
.collection-health > header strong { font-size: 12px; }
.collection-health dl { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); margin: 0; }
.collection-health dl > div { min-width: 0; padding: 12px 13px; border-left: 1px solid #e8eeec; }
.collection-health dl > div:first-child { border-left: 0; }
.collection-health dt { color: var(--text-secondary); font-size: 10px; }
.collection-health dd { display: -webkit-box; min-height: 34px; margin: 5px 0 0; overflow: hidden; color: var(--text); font-size: 11px; line-height: 1.55; overflow-wrap: anywhere; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.connection-now { border: 1px solid #e0ece9; background: linear-gradient(120deg, #f2fbf9, #f8fbff); }
.connection-dialog li b { border-radius: 10px; }
@media (max-width: 460px) {
  .account-card header { grid-template-columns: 42px minmax(0, 1fr); }
  .account-card header .el-tag { grid-column: 2; justify-self: start; }
  .account-card footer .el-button:first-child { width: 100%; }
  .collection-health dl { grid-template-columns: 1fr; }
  .collection-health dl > div { border-top: 1px solid #e8eeec; border-left: 0; }
  .collection-health dl > div:first-child { border-top: 0; }
}

/* 账号页以“是否可稳定采集”为第一判断，不再让所有摘要卡片争夺注意力。 */
.accounts-page { max-width: 1320px; }
.connection-overview { border-left: 3px solid var(--brand-600); }
.attention-overview { background: #fbfcfc; }
.overview-metrics span, .account-facts span { border: 1px solid var(--border-subtle); background: #f7faf9; }
.account-card { padding: 20px; background: var(--surface-raised); }
.account-card:hover { border-color: #9acfc8; }
.bridge-state { margin: 15px 0 12px; border: 1px solid var(--border-subtle); background: #f7faf9; }
.collection-health { border-radius: 12px; }
.collection-health > header { background: #fbfdfc; }
.collection-health dl > div { padding: 12px; }
.collection-health dd { color: #41534e; }
.account-card footer { padding-top: 2px; border-top: 1px solid var(--border-subtle); }
.account-card footer .el-button:first-child { margin-right: auto; }
.connection-dialog ol { padding: 2px 0; }
.account-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 18px; margin: 2px 0 14px; }
.account-toolbar strong, .account-toolbar span { display: block; }
.account-toolbar strong { font-size: 15px; }
.account-toolbar span { margin-top: 3px; color: var(--text-secondary); font-size: 11px; }
.account-filter-tabs { display: flex; gap: 3px; padding: 4px; border: 1px solid var(--border-subtle); border-radius: 10px; background: #edf3f6; }
.account-filter-tabs button { padding: 7px 11px; border: 0; border-radius: 7px; background: transparent; color: var(--text-secondary); font-size: 11px; font-weight: 650; cursor: pointer; transition: background var(--transition-fast), color var(--transition-fast), box-shadow var(--transition-fast); }
.account-filter-tabs button:hover { color: var(--brand-800); }
.account-filter-tabs button.active { background: #fff; color: var(--brand-800); box-shadow: 0 2px 7px rgba(16,42,67,.09); }
@media (max-width: 620px) { .account-card footer .el-button:first-child { width: 100%; margin-right: 0; } }
@media (max-width: 720px) { .account-toolbar { align-items: stretch; flex-direction: column; } .account-filter-tabs { overflow-x: auto; } .account-filter-tabs button { flex: 1 0 auto; } }

/* 只保留“页面区块”和“账号实体”两层容器，状态信息改为分隔线与留白。 */
.overview-state { display: inline-flex !important; align-items: center; gap: 7px; padding-top: 2px; color: var(--text-secondary) !important; font-size: 11px !important; font-weight: 700; white-space: nowrap; }
.overview-state i { width: 7px; height: 7px; border-radius: 50%; background: var(--success); box-shadow: 0 0 0 4px var(--color-success-bg); }
.overview-state.warning { color: #9a5b0a !important; }
.overview-state.warning i { background: var(--warning); box-shadow: 0 0 0 4px var(--color-warning-bg); }
.overview-metrics { gap: 0; padding-top: 2px; }
.overview-metrics span, .account-facts span { border: 0; border-radius: 0; background: transparent; }
.overview-metrics span { padding: 2px 18px; }
.overview-metrics span:first-child { padding-left: 0; }
.overview-metrics span + span { border-left: 1px solid var(--border-subtle); }
.attention-list { gap: 0; }
.attention-list p { position: relative; padding: 10px 0 10px 15px; border-radius: 0; background: transparent; }
.attention-list p + p { border-top: 1px solid var(--border-subtle); }
.attention-list p::before { position: absolute; top: 16px; left: 1px; width: 5px; height: 5px; border-radius: 50%; background: var(--warning); content: ''; }
.attention-mark { animation: none; }
.connection-overview, .attention-overview { padding: 26px 28px; border-radius: var(--radius-lg); }
.connection-overview { background: linear-gradient(135deg, #ffffff 60%, #f1faf8); }
.account-card { border-radius: var(--radius-lg); box-shadow: var(--shadow-card); transform: none; }
.account-card:hover { border-color: var(--border); box-shadow: var(--shadow-card); transform: none; }
.account-avatar { border-radius: 13px; }
.account-toolbar { margin-top: 26px; }
.account-filter-tabs button:focus-visible { outline: 3px solid rgba(20, 184, 166, .2); outline-offset: 2px; }
.bridge-state { margin: 14px 0 0; padding: 12px 2px; border: 0; border-top: 1px solid var(--border-subtle); border-radius: 0; background: transparent; }
.collection-health, .collection-health--healthy, .collection-health--pending { margin: 0; border-width: 1px 0; border-color: var(--border-subtle); border-radius: 0; background: transparent; }
.collection-health > header { padding: 10px 2px; background: transparent; }
.collection-health dl > div { padding: 11px 12px; }
.account-facts { gap: 0; margin: 0; padding: 11px 0; border-bottom: 1px solid var(--border-subtle); }
.account-facts span { padding: 2px 12px; }
.account-facts span:first-child { padding-left: 2px; }
.account-facts span + span { border-left: 1px solid var(--border-subtle); }
.account-card footer { padding-top: 12px; }
@media (max-width: 460px) {
  .overview-metrics span { padding-inline: 10px; }
  .overview-metrics span:first-child { padding-left: 0; }
  .account-facts span, .account-facts span:first-child { padding: 7px 2px; }
  .account-facts span + span { border-top: 1px solid var(--border-subtle); border-left: 0; }
}
@media (max-width: 720px) {
  .connection-overview, .attention-overview { padding: 21px 20px; }
}

/* V80 最终布局覆盖：与今日值守保持同一工作台尺度。 */
.accounts-page { width: min(100%, 1440px); max-width: none; }
.accounts-page .page-heading { margin-bottom: 32px; }
.accounts-page .page-heading h1 { font-size: clamp(30px, 2.5vw, 38px); letter-spacing: -.035em; }
.accounts-overview { grid-template-columns: minmax(380px, 1.38fr) minmax(280px, .72fr) minmax(330px, .88fr); gap: 22px; margin-bottom: 28px; }
.connection-overview, .attention-overview, .account-distribution-overview { min-height: 206px; padding: 28px 30px; border: 1px solid var(--border); border-radius: 17px; background: #fff; box-shadow: 0 8px 22px rgba(23, 32, 51, .045); }
.connection-overview { border-left: 3px solid var(--brand-600); background: linear-gradient(135deg, #ffffff 66%, #f1fbf8); }
.overview-heading strong { font-size: 27px; letter-spacing: -.025em; }
.connection-overview > p { margin: 15px 0 22px; font-size: 13px; }
.overview-state { align-self: flex-start; }
.overview-metrics { gap: 0; }
.overview-metrics span { padding: 2px 18px; border: 0; border-left: 1px solid var(--border-subtle); border-radius: 0; background: transparent; }
.overview-metrics span:first-child { padding-left: 0; border-left: 0; }
.attention-overview { position: relative; overflow: hidden; }
.attention-overview::after { position: absolute; right: 28px; bottom: 27px; width: 46px; height: 46px; border-radius: 15px; background: #e6f8f4; content: ''; }
.attention-overview .overview-heading, .attention-overview .attention-list { position: relative; z-index: 1; }
.attention-overview .overview-heading strong { font-size: 26px; }
.attention-list p { padding-block: 9px; font-size: 13px; }
.account-distribution-overview { padding-inline: 28px; }
.account-distribution-overview .overview-heading strong { margin-top: 3px; color: var(--text-secondary); font-size: 13px; font-weight: 600; }
.distribution-content { display: grid; grid-template-columns: 128px minmax(0, 1fr); align-items: center; gap: 26px; margin-top: 12px; }
.distribution-ring { display: grid; width: 118px; height: 118px; place-items: center; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(255,255,255,.8); }
.distribution-ring > div { display: grid; width: 76px; height: 76px; place-items: center; align-content: center; border-radius: 50%; background: #fff; }
.distribution-ring b { font-size: 22px; line-height: 1; }
.distribution-ring small { margin-top: 4px; color: var(--text-secondary); font-size: 10px; }
.account-distribution-overview dl { display: grid; gap: 11px; margin: 0; }
.account-distribution-overview dl > div { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.account-distribution-overview dt, .account-distribution-overview dd { margin: 0; font-size: 12px; }
.account-distribution-overview dt { display: inline-flex; align-items: center; gap: 7px; color: var(--text-secondary); }
.account-distribution-overview dt i { width: 8px; height: 8px; border-radius: 50%; }
.account-distribution-overview dt .normal { background: var(--success); }.account-distribution-overview dt .attention { background: var(--warning); }.account-distribution-overview dt .paused { background: #98a6bb; }
.account-distribution-overview dd { color: var(--text); font-weight: 750; }.account-distribution-overview dd small { margin-left: 5px; color: var(--text-secondary); font-size: 10px; font-weight: 600; }
.account-toolbar { margin: 0 0 18px; }.account-toolbar strong { font-size: 18px; }.account-toolbar span { font-size: 12px; }
.account-filter-tabs { padding: 5px; border-radius: 12px; background: #f3f6f8; }.account-filter-tabs button { min-height: 32px; padding: 7px 14px; }.account-filter-tabs button.active { background: var(--brand-700); color: #fff; box-shadow: 0 5px 12px rgba(15,118,110,.15); }
.account-grid { gap: 18px; }.account-card { padding: 23px; border-radius: 17px; }.account-card header { grid-template-columns: 50px minmax(0, 1fr) auto; gap: 13px; }.account-avatar { width: 50px; height: 50px; border-radius: 15px; font-size: 18px; }.account-card header strong { font-size: 18px; }.account-card header small { font-size: 12px; }
.bridge-state { margin-top: 18px; padding: 13px 0; }.bridge-state strong { font-size: 14px; }.collection-health { margin-top: 0; }.collection-health > header { padding: 12px 2px; }.collection-health dl > div { min-height: 98px; padding: 15px 16px; }.account-facts { padding: 14px 0; }.account-card footer { min-height: 56px; align-items: center; }.account-card footer .el-button:first-child { min-height: 40px; }
@media (max-width: 1200px) { .accounts-overview { grid-template-columns: minmax(0, 1.25fr) minmax(300px, .75fr); }.account-distribution-overview { grid-column: 1 / -1; min-height: auto; }.distribution-content { grid-template-columns: 118px minmax(0, 360px); } }
@media (max-width: 820px) { .accounts-page .page-heading { margin-bottom: 22px; }.accounts-overview { grid-template-columns: 1fr; gap: 14px; }.account-distribution-overview { grid-column: auto; }.connection-overview, .attention-overview, .account-distribution-overview { min-height: auto; padding: 22px; } }
@media (max-width: 520px) { .distribution-content { grid-template-columns: 104px minmax(0, 1fr); gap: 14px; }.distribution-ring { width: 100px; height: 100px; }.distribution-ring > div { width: 64px; height: 64px; } }
@media (max-width: 520px) { .account-workspace { padding: 16px; } }
.attention-overview::after { display: none; }
</style>
