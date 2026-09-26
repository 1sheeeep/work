<script setup lang="ts">
import PageHeader from '../components/PageHeader.vue'
import AsyncState from '../components/AsyncState.vue'
import StatusBadge from '../components/StatusBadge.vue'
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import type { FormInstance, FormRules } from 'element-plus'
import { ElMessage, ElMessageBox, ElNotification } from 'element-plus'
import { Connection, InfoFilled, MoreFilled, Plus, Refresh } from '@element-plus/icons-vue'
import { api, apiErrorMessage, apiFieldErrors, ensureCsrf } from '../services/api'
import { authStore } from '../stores/auth'
import type { BossAccount, BrowserDevice, BrowserUnreadObservation, Company, JobPosition, HrUser } from '../types'

interface AccountFormValue { displayName: string; recruiterIds: string[] }

const loading = ref(true)
const loadError = ref('')
const accounts = ref<BossAccount[]>([])
type BindableAccount = { id: string; displayName: string; bindingStatus: 'AVAILABLE' | 'BOUND' | 'MINE' | 'UNAVAILABLE' }
const bindableAccounts = ref<BindableAccount[]>([])
const claimingId = ref('')
const devices = ref<BrowserDevice[]>([])
const companies = ref<Company[]>([])
const observations = ref<BrowserUnreadObservation[]>([])
const jobs = ref<JobPosition[]>([])
const dialogOpen = ref(false)
const saving = ref(false)
const editingAccount = ref<BossAccount | null>(null)
const formRef = ref<FormInstance>()
const form = reactive<AccountFormValue>({ displayName: '', recruiterIds: [] })
const hrUsers = ref<HrUser[]>([])
const assignableRecruiters = computed(() => hrUsers.value.filter(user => user.enabled && user.role === 'RECRUITER'
  && user.companies.some(company => company.id === (editingAccount.value?.company.id ?? activeCompany.value?.id))))
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
function syncTypeLabel(type?: BrowserDevice['lastSuccessfulSyncType']) { return type === 'CHAT' ? '沟通页' : type === 'JOB' ? '职位页' : '无' }
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
    const [accountResponse, companyResponse, deviceResponse, observationResponse, jobResponse, hrResponse, bindableResponse] = await Promise.all([
      api.get<BossAccount[]>('/boss-accounts'),
      api.get<Company[]>('/organization/companies'),
      api.get<BrowserDevice[]>('/local-connector/devices'),
      api.get<BrowserUnreadObservation[]>('/local-connector/observations'),
      api.get<JobPosition[]>('/job-positions'),
      canManage.value ? api.get<HrUser[]>('/hr-users') : Promise.resolve({ data: [] as HrUser[] }),
      !canManage.value ? api.get<BindableAccount[]>('/boss-accounts/bindable') : Promise.resolve({ data: [] as BindableAccount[] }),
    ])
    accounts.value = accountResponse.data
    companies.value = companyResponse.data
    devices.value = deviceResponse.data
    observations.value = observationResponse.data
    jobs.value = jobResponse.data
    hrUsers.value = hrResponse.data
    bindableAccounts.value = bindableResponse.data
  } catch (error) { loadError.value = apiErrorMessage(error, '招聘账号加载失败') }
  finally { loading.value = false }
}

function openConnection(account: BossAccount) {
  selectedAccount.value = account
  pairingToken.value = ''
  pairingExpiresAt.value = ''
  connectionOpen.value = true
}

async function claimAccount(account: BindableAccount) {
  try {
    await ElMessageBox.confirm(`绑定“${account.displayName}”后，你可以查看该账号的历史值守记录并配对插件。请确认这是你负责的 BOSS 账号。`, '绑定招聘账号', { confirmButtonText: '确认绑定', cancelButtonText: '取消' })
  } catch { return }
  claimingId.value = account.id
  try {
    await ensureCsrf()
    const { data } = await api.post<BossAccount>(`/boss-accounts/${account.id}/claim`)
    await loadData()
    openConnection(data)
    ElMessage.success('绑定成功，请生成连接码配对插件')
  } catch (error) {
    ElMessage.error(apiErrorMessage(error, '绑定失败'))
    await loadData()
  } finally { claimingId.value = '' }
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
  Object.assign(form, { displayName: '', recruiterIds: [] })
  formError.value = ''
  clearFieldErrors()
  dialogOpen.value = true
}

function openEdit(account: BossAccount) {
  editingAccount.value = account
  Object.assign(form, { displayName: account.displayName, recruiterIds: [...(account.recruiterIds ?? [])] })
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

async function deleteAccount(account: BossAccount) {
  try { await ElMessageBox.confirm(`确认删除“${account.displayName}”？关联插件将失效，历史简历和会话记录保留。`, '删除招聘账号', { confirmButtonText: '确认删除', cancelButtonText: '取消', type: 'warning' }) }
  catch { return }
  changingStatusId.value = account.id
  try {
    await ensureCsrf()
    await api.delete(`/boss-accounts/${account.id}`)
    ElMessage.success('招聘账号已删除')
    await loadData()
  } catch (error) { ElMessage.error(apiErrorMessage(error, '账号删除失败')) }
  finally { changingStatusId.value = '' }
}

function handleAccountCommand(account: BossAccount, command: 'edit' | 'delete') {
  if (command === 'edit') openEdit(account)
  else void deleteAccount(account)
}

function showConnectionHelp() {
  ElNotification({
    title: '浏览器桥接说明',
    message: '1. 使用该账号专属的 Chrome Profile 登录 BOSS。<br/>2. 打开本机桥接扩展，粘贴一次性连接码。<br/>3. 回到此处刷新，状态显示"桥接在线"即可。',
    duration: 5000,
    type: 'info',
    dangerouslyUseHTMLString: true,
  })
}

function showFilterHelp() {
  ElNotification({
    title: '筛选说明',
    message: '<b>运行正常</b>：桥接在线且采集健康<br/><b>需要关注</b>：存在未读会话或采集异常<br/><b>已暂停</b>：账号已停用或桥接已暂停<br/><b>全部</b>：显示所有账号',
    duration: 5000,
    type: 'info',
    dangerouslyUseHTMLString: true,
  })
}

function formatDate(value?: string) {
  return value ? new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '无'
}

onMounted(loadData)
onUnmounted(() => { document.removeEventListener('visibilitychange', onVisChange) })
function onVisChange() { if (document.visibilityState === 'visible') void loadData() }
document.addEventListener('visibilitychange', onVisChange)
</script>

<template>
  <div class="page-shell accounts-page">
    <PageHeader>
      <div></div>
      <div class="heading-actions"><el-button v-if="canManage" type="primary" :icon="Plus" @click="openCreate">新增账号</el-button></div>
    </PageHeader>

    <AsyncState v-if="loading" state="loading" aria-label="正在加载招聘账号" />
    <AsyncState v-else-if="loadError" state="error" title="账号暂时无法加载" :message="loadError" @retry="loadData"><template #icon><el-icon><Refresh /></el-icon></template></AsyncState>
    <template v-else>
      <section v-if="!canManage" class="account-workspace card-panel" aria-label="选择招聘账号">
        <div class="account-toolbar"><div><strong>选择招聘账号</strong><span>仅展示授权企业内的账号。绑定后可查看值守记录并连接插件。</span></div></div>
        <section v-if="bindableAccounts.length" class="account-grid">
          <article v-for="account in bindableAccounts" :key="account.id" class="entity-card account-card">
            <header><strong>{{ account.displayName }}</strong><span>{{ { AVAILABLE: '未绑定', BOUND: '已被绑定', MINE: '我的账号', UNAVAILABLE: '不可绑定' }[account.bindingStatus] }}</span></header>
            <el-button v-if="account.bindingStatus === 'AVAILABLE'" type="primary" :loading="claimingId === account.id" :disabled="!!claimingId" @click="claimAccount(account)">绑定此账号</el-button>
            <small v-else-if="account.bindingStatus === 'BOUND'">如需转交，请联系管理员</small>
          </article>
        </section>
        <p v-else>授权企业内暂无招聘账号，请联系管理员创建。</p>
      </section>
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

      </section>
      <section class="account-workspace card-panel" aria-label="招聘账号工作区">
      <div v-if="visibleAccounts.length" class="account-toolbar" aria-label="账号状态筛选">
        <div><strong>多账号运行状态</strong><span>按桥接与采集状态快速定位账号<el-button :icon="InfoFilled" size="small" type="text" @click="showFilterHelp">查看说明</el-button></span></div>
        <div class="account-filter-tabs">
          <button v-for="option in accountFilterOptions" :key="option.value" type="button" :class="{ active: accountFilter === option.value }" :aria-pressed="accountFilter === option.value" @click="accountFilter = option.value">{{ option.label }}</button>
        </div>
      </div>
      <AsyncState v-if="!visibleAccounts.length" state="empty" embedded :title="canManage ? '尚未添加招聘账号' : '尚未绑定招聘账号，请在上方选择账号'" ><template #icon><el-icon><Connection /></el-icon></template><el-button v-if="canManage" type="primary" @click="openCreate">新增账号</el-button></AsyncState>
      <section v-else-if="filteredAccounts.length" class="account-grid" :class="{ 'account-grid--single': filteredAccounts.length === 1 }">
        <article v-for="account in filteredAccounts" :key="account.id" class="entity-card account-card" aria-label="招聘账号运行状态">
          <header><span class="account-avatar">{{ account.displayName.slice(0, 1) }}</span><div><strong>{{ account.displayName }}</strong></div><StatusBadge :label="connectionState(account).label" :tone="connectionState(account).type" /></header>
          <div class="bridge-state" :class="connectionState(account).tone"><span class="status-dot"></span><div><strong>{{ pageContextLabel(activeDevice(account.id)) }}</strong><small>最近心跳 {{ formatDate(activeDevice(account.id)?.lastHeartbeatAt) }}</small></div><StatusBadge compact class="bridge-collection-badge" :label="collectionState(account).label" :tone="collectionState(account).type" /></div>
          <div class="account-facts" aria-label="账号同步数据"><span><b>{{ unreadTotal(account.id) }}</b> 条未读</span><span><b>{{ syncedJobCount(account.id) }}</b> 个同步岗位</span><span><b>{{ draftJobCount(account.id) }}</b> 个待核对岗位</span><span class="account-facts__sync">最后同步 {{ lastSuccessfulSync(activeDevice(account.id)) }}</span></div>
          <details class="collection-health" :class="`collection-health--${collectionState(account).tone}`">
            <summary><strong>采集详情</strong><small>{{ activeDevice(account.id)?.runtimeState === 'RUNNING' ? '最近暂停原因' : '暂停原因' }}：{{ pauseReason(activeDevice(account.id)) }}</small></summary>
            <dl>
              <div><dt>最后成功同步</dt><dd>{{ lastSuccessfulSync(activeDevice(account.id)) }}</dd></div>
              <div><dt>{{ activeDevice(account.id)?.runtimeState === 'RUNNING' ? '最近暂停原因' : '暂停原因' }}</dt><dd>{{ pauseReason(activeDevice(account.id)) }}</dd></div>
              <div><dt>恢复后重采集</dt><dd>{{ recoveryEvidence(activeDevice(account.id)) }}</dd></div>
            </dl>
          </details>
          <footer>
            <el-button type="primary" plain @click="openConnection(account)">{{ activeDevice(account.id) ? '查看桥接' : '连接浏览器' }}</el-button>
            <el-dropdown v-if="canManage" trigger="click" @command="handleAccountCommand(account, $event as 'edit' | 'delete')">
              <el-button text :icon="MoreFilled" aria-label="更多账号操作">更多</el-button>
              <template #dropdown><el-dropdown-menu><el-dropdown-item command="edit">编辑账号</el-dropdown-item><el-dropdown-item command="delete" :disabled="changingStatusId === account.id" class="danger-menu-item">删除账号</el-dropdown-item></el-dropdown-menu></template>
            </el-dropdown>
          </footer>
        </article>
      </section>
      <AsyncState v-else state="empty" embedded title="当前筛选下没有账号" message="切换其他状态查看全部招聘账号。"><template #icon><el-icon><Connection /></el-icon></template></AsyncState>
      </section>
    </template>

    <el-dialog append-to-body v-model="connectionOpen" :title="`${selectedAccount?.displayName ?? ''} · 浏览器桥接`" width="560px" destroy-on-close>
      <div v-if="selectedAccount" class="connection-dialog">
        <section class="connection-now"><StatusBadge :label="`${connectionState(selectedAccount).label} · ${collectionState(selectedAccount).label}`" :tone="connectionState(selectedAccount).type" /><div><small>{{ pageContextLabel(activeDevice(selectedAccount.id)) }} · 最近心跳 {{ formatDate(activeDevice(selectedAccount.id)?.lastHeartbeatAt) }} · 最后成功同步 {{ lastSuccessfulSync(activeDevice(selectedAccount.id)) }}</small></div></section>
        <div class="connection-steps-header"><strong>连接步骤</strong><el-button :icon="InfoFilled" size="small" type="text" @click="showConnectionHelp">查看说明</el-button></div>
        <ol><li><b>1</b><span>使用该账号专属的 Chrome Profile 登录 BOSS。</span></li><li><b>2</b><span>打开本机桥接扩展，粘贴下方一次性连接码。</span></li><li><b>3</b><span>回到此处刷新，状态显示"桥接在线"即可。</span></li></ol>
        <div v-if="pairingToken" class="token-box"><code>{{ pairingToken }}</code><el-button type="primary" @click="copyToken">复制</el-button><small>{{ formatDate(pairingExpiresAt) }} 前有效</small></div>
        <el-button v-else type="primary" :loading="pairingLoading" @click="generatePairing">生成一次性连接码</el-button>
      </div>
      <template #footer><el-button :icon="Refresh" @click="loadData">刷新状态</el-button><el-button type="primary" @click="connectionOpen = false">完成</el-button></template>
    </el-dialog>

    <el-dialog append-to-body v-model="dialogOpen" :title="dialogTitle" width="500px" destroy-on-close>
      <el-alert v-if="formError" :title="formError" type="error" :closable="false" class="dialog-alert" />
      <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent="saveAccount">
        <el-form-item label="账号名称" prop="displayName" :error="fieldErrors.displayName"><el-input v-model="form.displayName" maxlength="100" placeholder="例如：BOSS 主招聘账号" /></el-form-item>
        <el-form-item label="可访问的招聘专员" prop="recruiterIds"><el-select v-model="form.recruiterIds" multiple style="width:100%" placeholder="不选择时，仅管理员可访问"><el-option v-for="user in assignableRecruiters" :key="user.id" :label="user.username" :value="user.id" /></el-select></el-form-item>
        <p>专员仅能查看分配给自己的账号和值守记录。修改分配后需重新配对插件。</p>
      </el-form>
      <template #footer><el-button @click="dialogOpen = false">取消</el-button><el-button type="primary" :loading="saving" @click="saveAccount">保存</el-button></template>
    </el-dialog>
  </div>
</template>

<style scoped>
.accounts-overview { display:grid; grid-template-columns:minmax(0,1.3fr) minmax(0,1fr); gap:18px; margin-bottom:24px; }
.section-card { padding:22px; position:relative; overflow:hidden; box-shadow:var(--shadow-raised), inset 0 1px 0 rgba(255,255,255,.58); }
.overview-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; position:relative; z-index:1; }
.overview-heading > div { min-width:0; }
.overview-heading span,.overview-heading strong { display:block; }
.overview-heading span { color:var(--text-secondary); font-size:12px; }
.overview-heading strong { margin-top:4px; font-size:18px; line-height:1.3; font-variant-numeric:tabular-nums; }
.connection-overview .overview-heading strong { font-size:24px; }
.overview-heading .overview-state { display:flex; align-items:center; gap:6px; font-size:11px; flex-shrink:0; }
.overview-state i,.attention-mark,.status-dot { width:8px; height:8px; border-radius:50%; background:var(--text-tertiary); flex:0 0 auto; }
.overview-state.healthy { color:var(--success); }.overview-state.healthy i { background:var(--success); }
.overview-state.warning { color:var(--warning); }.overview-state.warning i,.attention-mark { background:var(--warning); }
.connection-overview > p { margin:14px 0 20px; color:var(--text-secondary); font-size:12px; line-height:1.65; position:relative; z-index:1; }
.overview-metrics { display:flex; flex-wrap:wrap; gap:10px 16px; position:relative; z-index:1; }
.overview-metrics span { color:var(--text-secondary); font-size:12px; }
.overview-metrics b { color:var(--text); font-variant-numeric:tabular-nums; }
.connection-overview { border-color:var(--border-teal); background:linear-gradient(145deg, rgba(238,249,246,.94) 0%, rgba(255,255,255,.72) 86%); }
.connection-overview::before {
  content: '';
  position: absolute;
  top: -48px;
  right: -48px;
  width: 180px;
  height: 180px;
  border-radius: 50%;
  background: radial-gradient(circle, color-mix(in srgb, var(--brand-600) 8%, transparent) 0%, transparent 70%);
  pointer-events: none;
}
.attention-overview { border-color:var(--border-amber); background:linear-gradient(145deg, rgba(255,247,233,.94) 0%, rgba(255,255,255,.72) 86%); }
.attention-overview::before {
  content: '';
  position: absolute;
  top: -48px;
  right: -48px;
  width: 180px;
  height: 180px;
  border-radius: 50%;
  background: radial-gradient(circle, color-mix(in srgb, var(--warning) 7%, transparent) 0%, transparent 70%);
  pointer-events: none;
}
.attention-overview--warning { background:linear-gradient(145deg, var(--surface-amber) 0%, var(--surface) 72%); border-color:var(--border-amber); }
.attention-mark { margin-top:7px; }.attention-mark--quiet { background:var(--success); }
.attention-list { display:grid; gap:12px; margin-top:18px; }.attention-list p { margin:0; color:var(--text-secondary); font-size:12px; line-height:1.65; }
.account-workspace { overflow:hidden; }
.account-toolbar { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:20px 22px; background:linear-gradient(180deg, rgba(255,255,255,.72), rgba(247,249,250,.82)); }
.account-toolbar strong { display:block; font-size:17px; }.account-toolbar > div > span { display:block; color:var(--text-secondary); font-size:12px; margin-top:5px; }
.account-filter-tabs { display:flex; flex-wrap:wrap; gap:4px; padding:4px; border-radius:var(--radius-control); background:var(--surface-soft); }
.account-filter-tabs button { padding:8px 12px; border:0; border-radius:6px; color:var(--text-secondary); background:transparent; cursor:pointer; font-size:12px; }
.account-filter-tabs button.active { background:var(--primary); color:white; }.account-filter-tabs button:hover:not(.active) { background:var(--border-subtle); }
.account-grid { display:grid; grid-template-columns:1fr; gap:10px; padding:12px; }
.account-card { padding:18px; background:linear-gradient(135deg, rgba(255,255,255,.88) 0%, rgba(255,255,255,.72) 100%); border:0; border-radius:var(--radius-panel); box-shadow:0 1px 2px rgba(17,28,45,.035), 0 4px 16px rgba(17,28,45,.05), inset 0 1px 0 rgba(255,255,255,.72); transition:background var(--transition-fast), box-shadow 280ms cubic-bezier(.2,0,0,1), transform 280ms cubic-bezier(.2,0,0,1); position:relative; }
.account-card:nth-child(even) { background:linear-gradient(135deg, rgba(247,249,250,.88) 0%, rgba(247,249,250,.72) 100%); }
.account-card:hover { background:linear-gradient(135deg, rgba(255,255,255,.96) 0%, rgba(255,255,255,.84) 100%); box-shadow:0 2px 4px rgba(17,28,45,.05), 0 12px 32px rgba(17,28,45,.10), inset 0 1px 0 rgba(255,255,255,.88), 2px 0 0 0 rgba(13,148,136,.12); transform:translateY(-3px); }
.account-card:active { animation:card-press 180ms ease-out both; }
.account-card--attention { background:linear-gradient(135deg, var(--surface-amber) 0%, rgba(255,255,255,.78) 100%); box-shadow:0 1px 2px rgba(17,28,45,.035), 0 4px 16px rgba(17,28,45,.05), inset 0 1px 0 rgba(255,255,255,.72), 2px 0 0 0 rgba(183,110,0,.12); }
.account-card--attention:hover { box-shadow:0 2px 4px rgba(17,28,45,.05), 0 12px 32px rgba(17,28,45,.10), inset 0 1px 0 rgba(255,255,255,.88), 2px 0 0 0 rgba(183,110,0,.18); }
.account-card > header { display:flex; align-items:center; gap:12px; }.account-card > header > div { flex:1; min-width:0; }
.account-card > header strong { display:block; font-size:17px; overflow-wrap:anywhere; }.account-card > header small { display:block; margin-top:4px; color:var(--text-secondary); font-size:12px; }
.account-avatar { display:grid; width:44px; height:44px; place-items:center; flex:0 0 auto; border-radius:12px; background:linear-gradient(145deg, #14b8a6 0%, #0d9488 40%, #0f766e 100%); color:white; font-weight:700; font-size:18px; box-shadow:0 4px 14px rgba(13,148,136,.22), 0 1px 2px rgba(0,0,0,.08), inset 0 1px 0 rgba(255,255,255,.18); }
.bridge-state { display:flex; align-items:center; gap:10px; margin-top:12px; padding:10px 12px; border-radius:var(--radius-control); background:rgba(247,249,250,.56); }
.bridge-collection-badge { margin-left:auto; flex-shrink:0; }
.bridge-state strong,.bridge-state small,.connection-now strong,.connection-now small { display:block; }
.bridge-state strong { font-size:13px; }.bridge-state small,.connection-now small { margin-top:4px; font-size:12px; color:var(--text-secondary); line-height:1.6; }
.online .status-dot,.status-dot.online { background:var(--success); }.paused .status-dot,.status-dot.paused { background:var(--warning); }
.collection-health { margin:8px 0 0; border-radius:var(--radius-control); background:rgba(247,249,250,.48); }
.collection-health summary { display:flex; align-items:center; gap:8px; padding:8px 12px; font-size:12px; cursor:pointer; list-style:none; color:var(--text-secondary); }
.collection-health summary::before { content:'›'; color:var(--primary); font-size:14px; line-height:1; transition:transform .2s ease; }
.collection-health[open] summary::before { transform:rotate(90deg); }
.collection-health summary strong { color:var(--text); font-size:12px; }
.collection-health summary small { color:var(--text-tertiary); font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.collection-health > header { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:14px; font-size:13px; }
.collection-health dl { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:20px; margin:0; padding:4px 12px 10px; }
.collection-health dl > div + div { padding-left:20px; border-left:0; position:relative; }
.collection-health dl > div + div::before { content:''; position:absolute; left:0; top:4px; bottom:4px; width:1px; background:linear-gradient(180deg, transparent, var(--border-subtle) 40%, var(--border-subtle) 60%, transparent); }
.collection-health dt { color:var(--text-secondary); font-size:11px; margin-bottom:6px; }.collection-health dd { margin:0; font-size:12px; line-height:1.7; overflow-wrap:anywhere; }
.account-facts { display:flex; flex-wrap:wrap; gap:8px 20px; margin-top:10px; color:var(--text-secondary); font-size:12px; }
.account-facts b { color:var(--text); font-size:14px; font-variant-numeric:tabular-nums; }
.account-facts__sync { color:var(--text-tertiary); font-size:11px; }
.account-card > footer { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-top:14px; }
.connection-dialog { display:grid; gap:18px; }.connection-now { display:flex; align-items:center; gap:12px; background:var(--surface-soft); padding:16px; border-radius:10px; }
.connection-steps-header { display:flex; align-items:center; justify-content:space-between; gap:10px; }
.connection-dialog ol { list-style:none; margin:0; padding:0; display:grid; gap:14px; }.connection-dialog li { display:flex; align-items:center; gap:12px; line-height:1.6; }
.connection-dialog li b { display:grid; place-items:center; width:28px; height:28px; flex:0 0 auto; border-radius:50%; background:var(--brand-50); color:var(--primary); }
.token-box { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:10px; }.token-box code { padding:12px; background:var(--surface-soft); overflow-wrap:anywhere; }.token-box small { grid-column:1/-1; color:var(--text-secondary); }
.dialog-alert { margin-bottom:16px; }

:global(:root[data-theme="dark"]) .connection-overview::before { background: radial-gradient(circle, color-mix(in srgb, var(--brand-600) 14%, transparent) 0%, transparent 70%); }
:global(:root[data-theme="dark"]) .attention-overview::before { background: radial-gradient(circle, color-mix(in srgb, var(--warning) 12%, transparent) 0%, transparent 70%); }
:global(:root[data-theme="dark"]) .account-card { background:linear-gradient(135deg, rgba(30,36,51,.88) 0%, rgba(26,31,44,.78) 100%); box-shadow:0 1px 2px rgba(0,0,0,.22), 0 4px 16px rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.04); }
:global(:root[data-theme="dark"]) .account-card:nth-child(even) { background:linear-gradient(135deg, rgba(34,40,55,.88) 0%, rgba(30,36,51,.78) 100%); }
:global(:root[data-theme="dark"]) .account-card:hover { background:linear-gradient(135deg, rgba(36,42,58,.96) 0%, rgba(30,36,51,.84) 100%); box-shadow:0 2px 4px rgba(0,0,0,.30), 0 12px 32px rgba(0,0,0,.28), inset 0 1px 0 rgba(255,255,255,.06), 2px 0 0 0 rgba(13,148,136,.16); }
:global(:root[data-theme="dark"]) .account-card--attention { background:linear-gradient(135deg, rgba(42,34,22,.88) 0%, rgba(30,36,51,.78) 100%); box-shadow:0 1px 2px rgba(0,0,0,.22), 0 4px 16px rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.04), 2px 0 0 0 rgba(183,110,0,.16); }
:global(:root[data-theme="dark"]) .account-card--attention:hover { box-shadow:0 2px 4px rgba(0,0,0,.30), 0 12px 32px rgba(0,0,0,.28), inset 0 1px 0 rgba(255,255,255,.06), 2px 0 0 0 rgba(183,110,0,.22); }
:global(:root[data-theme="dark"]) .bridge-state { background:rgba(34,40,55,.42); }
:global(:root[data-theme="dark"]) .collection-health { background:rgba(34,40,55,.36); }
:global(:root[data-theme="dark"]) .account-toolbar { background:linear-gradient(180deg, rgba(30,36,51,.72), rgba(26,31,44,.82)); }

@media(max-width:760px) { .accounts-overview { grid-template-columns:1fr; }.account-toolbar { align-items:stretch; flex-direction:column; }.account-filter-tabs button { flex:1; padding-inline:6px; }.collection-health dl { grid-template-columns:1fr; gap:14px; }.collection-health dl > div + div { padding-left:0; border-left:0; }.collection-health dl > div + div::before { display:none; }.account-card { padding:18px; }.overview-heading { flex-wrap:wrap; }.account-card > header { flex-wrap:wrap; } }
@media(max-width:480px) { .account-facts { gap:8px 16px; }.account-facts b { font-size:14px; }.account-card > footer { flex-wrap:wrap; gap:8px; }.bridge-state { flex-wrap:wrap; }.account-card { padding:14px; }.section-card { padding:16px; } }
</style>
