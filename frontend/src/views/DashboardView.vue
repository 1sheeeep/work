<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ChatDotRound, Connection, DocumentChecked, Refresh, Right, Warning } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api, apiErrorMessage, ensureCsrf } from '../services/api'
import { authStore } from '../stores/auth'
import type { AutoReplyAttempt, AutoReplyPolicy, BossAccount, BrowserDevice, CandidateContact, Company, JobPosition } from '../types'

const router = useRouter()
const loading = ref(true)
const actionId = ref('')
const updatedAt = ref<Date | null>(null)
const accounts = ref<BossAccount[]>([])
const candidates = ref<CandidateContact[]>([])
const policies = ref<AutoReplyPolicy[]>([])
const devices = ref<BrowserDevice[]>([])
const attempts = ref<AutoReplyAttempt[]>([])
const companies = ref<Company[]>([])
const jobs = ref<JobPosition[]>([])
const displayName = computed(() => authStore.state.user?.displayName || 'HR')
const activePolicies = computed(() => policies.value.filter(x => x.awayActive))
const followUps = computed(() => candidates.value.filter(x => x.needsHrFollowUp))
const sentToday = computed(() => policies.value.reduce((n, x) => n + x.sentToday, 0))
function isSafeMonitoringDevice(device?: BrowserDevice) { return device?.runtimeState === 'PAUSED' && /^只监测：/.test(device.stopReason || '') }
const connectionIssues = computed(() => policies.value.filter(x => {
  const device = devices.value.find(d => d.accountId === x.accountId && d.status === 'ACTIVE')
  return x.accountStatus !== 'ACTIVE' || !x.messageSendCapable || !device || (device.runtimeState !== 'RUNNING' && !isSafeMonitoringDevice(device))
}))
const recentAttempts = computed(() => attempts.value.slice(0, 5))
const formalAccounts = computed(() => accounts.value.filter(x => x.gatewayType === 'LOCAL_CDP_CONNECTOR' && x.status === 'ACTIVE'))
const linkedFormalAccounts = computed(() => formalAccounts.value.filter(x => devices.value.some(d => d.accountId === x.id && d.status === 'ACTIVE')))
const formalCompanyIds = computed(() => new Set(formalAccounts.value.map(x => x.company.id)))
const activeFormalJobs = computed(() => jobs.value.filter(x => x.status === 'ACTIVE' && formalAccounts.value.some(a => a.id === x.bossAccount.id)))
const readyFormalJobs = computed(() => activeFormalJobs.value.filter(x => x.safeReplyReady))
const replyCompanies = computed(() => companies.value.filter(x => formalCompanyIds.value.has(x.id)))
const readinessSteps = computed(() => [
  { key: 'account', title: '连接账号与浏览器', done: linkedFormalAccounts.value.length > 0, detail: linkedFormalAccounts.value.length ? `${linkedFormalAccounts.value.length} 个账号已连接本机 Chrome` : '真实 BOSS 账号到位后，从这里开始连接。', action: '账号与浏览器', path: '/boss-accounts', icon: Connection },
  { key: 'job', title: '确认岗位资料', done: activeFormalJobs.value.length > 0, detail: activeFormalJobs.value.length ? `${activeFormalJobs.value.length} 个启用岗位已关联` : '等待真实岗位页面后，一键采集并由 HR 核对。', action: '岗位资料', path: '/job-positions', icon: DocumentChecked },
  { key: 'company', title: '审核回复知识', done: replyCompanies.value.length > 0 && replyCompanies.value.every(x => x.knowledgeApproved), detail: replyCompanies.value.length ? `${replyCompanies.value.filter(x => x.knowledgeApproved).length}/${replyCompanies.value.length} 家企业资料已审核` : '不需要编造资料，拿到真实信息后再填写。', action: '企业与集团', path: '/organization', icon: ChatDotRound },
  { key: 'reply', title: '开启安全草稿', done: activeFormalJobs.value.length > 0 && readyFormalJobs.value.length === activeFormalJobs.value.length, detail: activeFormalJobs.value.length ? `${readyFormalJobs.value.length}/${activeFormalJobs.value.length} 个岗位可生成草稿` : '资料完整后自动解锁；当前不会发送消息。', action: '值守规则', path: '/auto-replies', icon: ChatDotRound },
])
const nextReadinessStep = computed(() => readinessSteps.value.find(x => !x.done) || null)
const overallState = computed(() => activePolicies.value.length ? `${activePolicies.value.length} 个账号正在托管` : '你当前在岗')
const subtitle = computed(() => activePolicies.value.length ? '系统正在观察已连接账号。候选人消息只会进入安全草稿与人工处理链路。' : '尚未开启离开托管。你离开前可为指定账号设定时长，系统会先安全观察。')
const statusHint = computed(() => activePolicies.value.length ? '离开托管中' : '等待你开启值守')

async function load() {
  loading.value = true
  const results = await Promise.allSettled([
    api.get<BossAccount[]>('/boss-accounts'), api.get<CandidateContact[]>('/candidate-contacts'), api.get<AutoReplyPolicy[]>('/auto-replies/policies'), api.get<BrowserDevice[]>('/browser-devices'), api.get<AutoReplyAttempt[]>('/auto-replies/attempts'), api.get<Company[]>('/organization/companies'), api.get<JobPosition[]>('/job-positions'),
  ])
  const targets = [accounts, candidates, policies, devices, attempts, companies, jobs]
  results.forEach((result, index) => { if (result.status === 'fulfilled' && result.value?.data) targets[index]!.value = result.value.data as never })
  updatedAt.value = new Date()
  loading.value = false
}
async function setAway(policy: AutoReplyPolicy, mode: 'IN_OFFICE' | 'TEMPORARY' | 'AFTER_HOURS', hours = 0) {
  if (!policy.configured) { ElMessage.warning('请先由管理员配置该账号的托管策略'); return }
  actionId.value = policy.accountId
  try {
    await ensureCsrf()
    await api.put(`/auto-replies/policies/${policy.accountId}/away-mode`, { mode, endsAt: mode === 'IN_OFFICE' ? null : new Date(Date.now() + hours * 3600000).toISOString() })
    ElMessage.success(mode === 'IN_OFFICE' ? '已结束该账号托管' : '离开托管已开启')
    await load()
  } catch (error) {
    ElMessage.error(apiErrorMessage(error, '托管状态更新失败'))
  } finally { actionId.value = '' }
}
async function endAll() {
  if (!activePolicies.value.length) return
  try {
    await ElMessageBox.confirm(`确认结束 ${activePolicies.value.length} 个账号的离开托管？`, '我已返回', { confirmButtonText: '结束全部托管' })
    for (const policy of activePolicies.value) await setAway(policy, 'IN_OFFICE')
    ElMessage.success('全部托管已结束，欢迎回来')
  } catch (error) { if (error !== 'cancel' && error !== 'close') ElMessage.error('结束全部托管失败，请检查账号状态') }
}
function open(path: string) { void router.push(path) }
function formatTime(value?: string) { return value ? new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', month: 'numeric', day: 'numeric' }).format(new Date(value)) : '—' }
function statusLabel(status: string) { return { SENT: '已接待', FAILED: '发送失败', SKIPPED: '已跳过', PENDING_REVIEW: '待审核', CLAIMED: '处理中' }[status] || status }
onMounted(load)
</script>

<template>
  <div class="page-shell dashboard-page">
    <header class="command-hero" :class="{ active: activePolicies.length }">
      <div class="hero-copy">
        <span class="stage-chip"><i></i>{{ activePolicies.length ? '离开托管中' : '测试阶段 · 只读值守' }}</span>
        <h1>今天的招聘值守</h1>
        <p>{{ subtitle }}</p>
        <div class="hero-facts"><span><b>{{ linkedFormalAccounts.length }}</b> 已连接账号</span><span><b>{{ followUps.length }}</b> 待 HR 跟进</span><span><b>{{ sentToday }}</b> 今日接待记录</span></div>
      </div>
      <aside class="hero-status">
        <span>当前状态</span><strong>{{ overallState }}</strong><small>{{ statusHint }} · {{ updatedAt ? `更新于 ${formatTime(updatedAt.toISOString())}` : '正在读取状态' }}</small>
        <div class="hero-actions"><el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button><el-button v-if="activePolicies.length" type="success" @click="endAll">我已返回</el-button></div>
      </aside>
    </header>

    <el-alert class="test-mode-alert" type="warning" :closable="false" show-icon title="当前处于安全测试阶段：只同步状态和生成草稿，不会向 BOSS 发送消息。" />

    <div v-if="loading" class="surface-panel skeleton-stack"><el-skeleton :rows="9" animated /></div>
    <template v-else>
      <section class="metric-grid" aria-label="今日状态">
        <button class="metric-card metric-card--teal" @click="open('/auto-replies')"><i>托</i><span>正在托管</span><strong>{{ activePolicies.length }}</strong><small>共 {{ policies.length }} 个账号</small><b>查看规则 <Right /></b></button>
        <button class="metric-card metric-card--orange" @click="open('/candidates')"><i>待</i><span>待 HR 跟进</span><strong>{{ followUps.length }}</strong><small>返回后优先处理</small><b>进入消息 <Right /></b></button>
        <button class="metric-card metric-card--blue" @click="open('/auto-replies')"><i>记</i><span>今日接待记录</span><strong>{{ sentToday }}</strong><small>成功、失败与跳过均可追溯</small><b>查看记录 <Right /></b></button>
        <button class="metric-card metric-card--red" @click="open('/boss-accounts')"><i>连</i><span>连接需要检查</span><strong :class="{ danger: connectionIssues.length }">{{ connectionIssues.length }}</strong><small>异常账号会保持暂停</small><b>检查连接 <Right /></b></button>
      </section>

      <section class="workbench-grid">
        <article class="surface-panel priority-panel">
          <header class="section-title-row"><div><span class="section-kicker">START HERE</span><h2>现在优先完成</h2><p>没有真实账号时，不需要虚构数据。先明确后续接入顺序即可。</p></div><el-button text @click="open(nextReadinessStep?.path || '/boss-accounts')">查看详情</el-button></header>
          <div v-if="nextReadinessStep" class="next-step">
            <span class="next-step__number">{{ readinessSteps.findIndex(x => x.key === nextReadinessStep?.key) + 1 }}</span>
            <div><small>当前下一步</small><strong>{{ nextReadinessStep.title }}</strong><p>{{ nextReadinessStep.detail }}</p></div>
            <el-button type="primary" @click="open(nextReadinessStep.path)">前往{{ nextReadinessStep.action }}</el-button>
          </div>
          <div class="readiness-list">
            <button v-for="(step, index) in readinessSteps" :key="step.key" :class="{ done: step.done, current: nextReadinessStep?.key === step.key }" @click="open(step.path)"><span>{{ step.done ? '✓' : index + 1 }}</span><div><strong>{{ step.title }}</strong><small>{{ step.done ? '已完成' : step.detail }}</small></div><Right /></button>
          </div>
        </article>

        <aside class="surface-panel safety-panel">
          <header class="section-title-row"><div><span class="section-kicker">SAFE MODE</span><h2>运行安全边界</h2></div></header>
          <ul><li><b>不保存</b><span>账号密码、Cookie 与聊天正文</span></li><li><b>不自动发送</b><span>真实页面验证前，所有回复仅为草稿</span></li><li><b>异常即暂停</b><span>掉线、验证、风控或页面变化时停止运行</span></li></ul>
          <footer><span>需要查看本机连接器状态？</span><el-button link type="primary" @click="open('/operations')">运行保障</el-button></footer>
        </aside>
      </section>

      <section class="surface-panel away-panel">
        <header class="section-title-row"><div><span class="section-kicker">AWAY MODE</span><h2>离开托管</h2><p>为每个账号选择离开时长；到期会停止，HR 返回后可随时接管。</p></div><small>你好，{{ displayName }}</small></header>
        <div v-if="!policies.length" class="compact-empty"><span>暂未配置可托管账号</span><small>真实账号到位后，在“账号与浏览器”完成连接，再回到这里设定离开时段。</small><el-button type="primary" @click="open('/boss-accounts')">查看连接准备</el-button></div>
        <div v-else class="account-list">
          <article v-for="policy in policies" :key="policy.accountId">
            <div class="account-status" :class="{ active: policy.awayActive }"><i></i><div><strong>{{ policy.accountName }}</strong><small v-if="policy.awayActive">{{ policy.awayMode === 'AFTER_HOURS' ? '下班托管' : '临时离开' }} · 至 {{ formatTime(policy.awayEndsAt) }}</small><small v-else>当前在岗，不会自动接待</small></div></div>
            <div class="account-actions"><el-button v-if="policy.awayActive" type="success" plain :loading="actionId === policy.accountId" @click="setAway(policy, 'IN_OFFICE')">我已返回</el-button><template v-else><el-button :loading="actionId === policy.accountId" @click="setAway(policy, 'TEMPORARY', 1)">离开 1 小时</el-button><el-button type="primary" :loading="actionId === policy.accountId" @click="setAway(policy, 'TEMPORARY', 2)">离开 2 小时</el-button><el-button @click="setAway(policy, 'AFTER_HOURS', 12)">下班托管</el-button></template></div>
          </article>
        </div>
      </section>

      <section class="lower-grid">
        <article class="surface-panel attention-panel"><header class="section-title-row"><div><span class="section-kicker">ATTENTION</span><h2>需要处理</h2><p>先检查异常账号，再处理候选人跟进。</p></div></header><div v-if="!connectionIssues.length && !followUps.length" class="all-clear"><span>✓</span><strong>当前没有阻断事项</strong><small>账号连接和待跟进队列状态正常</small></div><button v-for="policy in connectionIssues" :key="`issue-${policy.accountId}`" @click="open('/boss-accounts')"><Warning/><span><strong>{{ policy.accountName }} 连接需要检查</strong><small>登录、页面识别或设备心跳异常</small></span><Right/></button><button v-if="followUps.length" @click="open('/candidates')"><ChatDotRound/><span><strong>{{ followUps.length }} 个会话等待 HR 跟进</strong><small>自动接待不代表沟通已完成</small></span><Right/></button></article>
        <article class="surface-panel recent-panel"><header class="section-title-row"><div><span class="section-kicker">ACTIVITY</span><h2>最近自动接待</h2><p>快速确认离开期间发生了什么。</p></div><el-button text @click="open('/auto-replies')">查看全部</el-button></header><div v-if="!recentAttempts.length" class="recent-empty"><span>暂未产生接待记录</span><small>真实账号接入并开启值守后，会在这里展示每次处理结果。</small></div><div v-else class="attempt-list"><article v-for="attempt in recentAttempts" :key="attempt.id"><span class="avatar">{{ attempt.candidateName.slice(0, 1) }}</span><div><strong>{{ attempt.candidateName }}</strong><small>{{ attempt.jobTitle }} · {{ attempt.accountName }}</small></div><el-tag :type="attempt.status === 'SENT' ? 'success' : attempt.status === 'FAILED' ? 'danger' : 'info'">{{ statusLabel(attempt.status) }}</el-tag><time>{{ formatTime(attempt.completedAt || attempt.createdAt) }}</time></article></div></article>
      </section>
    </template>
  </div>
</template>

<style scoped>
.dashboard-page{padding-top:32px}.command-hero{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:28px;align-items:stretch;margin-bottom:18px;padding:30px;border:1px solid #cfe4df;border-radius:22px;background:radial-gradient(circle at 94% 0,rgba(168,243,232,.72),transparent 38%),linear-gradient(130deg,#fff 0%,#effaf7 100%);box-shadow:var(--shadow-sm)}.command-hero.active{border-color:#93d7c9;background:radial-gradient(circle at 94% 0,rgba(167,243,208,.72),transparent 38%),linear-gradient(130deg,#fff 0%,#edfcf4 100%)}.stage-chip,.section-kicker{display:inline-flex;align-items:center;gap:7px;color:var(--brand-700);font-size:10px;font-weight:800;letter-spacing:.12em}.stage-chip{padding:7px 10px;border-radius:999px;background:#dff6f1;letter-spacing:.06em}.stage-chip i{width:7px;height:7px;border-radius:50%;background:#e79b25;box-shadow:0 0 0 4px rgba(231,155,37,.12)}.command-hero.active .stage-chip{background:#d9f8e7;color:#087f5b}.command-hero.active .stage-chip i{background:#12b76a}.hero-copy h1{margin:15px 0 9px;font-size:clamp(30px,3vw,42px);letter-spacing:-.045em;line-height:1.08}.hero-copy>p{max-width:710px;margin:0;color:var(--text-secondary);line-height:1.7}.hero-facts{display:flex;flex-wrap:wrap;gap:22px;margin-top:22px}.hero-facts span{color:var(--text-secondary);font-size:12px}.hero-facts b{margin-right:5px;color:var(--text);font-size:18px}.hero-status{display:flex;flex-direction:column;justify-content:center;padding:22px;border:1px solid rgba(158,204,195,.76);border-radius:16px;background:rgba(255,255,255,.76)}.hero-status>span{color:var(--text-secondary);font-size:11px}.hero-status strong{margin:8px 0 5px;font-size:19px}.hero-status small{color:var(--text-secondary);font-size:11px;line-height:1.55}.hero-actions{display:flex;gap:8px;margin-top:18px}.hero-actions .el-button{flex:1}.test-mode-alert{margin-bottom:18px}.metric-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:18px}.metric-card{position:relative;display:grid;grid-template-columns:42px 1fr;column-gap:12px;align-items:start;min-height:166px;padding:18px;border:1px solid var(--border);border-radius:16px;background:#fff;color:var(--text);text-align:left;cursor:pointer;box-shadow:var(--shadow-sm);overflow:hidden;transition:transform .18s,border-color .18s,box-shadow .18s}.metric-card:hover{transform:translateY(-2px);border-color:#9fccc4;box-shadow:var(--shadow-md)}.metric-card>i{display:grid;width:42px;height:42px;place-items:center;border-radius:12px;background:#e8f6f3;color:#087f5b;font-style:normal;font-weight:800}.metric-card>span{padding-top:2px;color:var(--text-secondary);font-size:12px}.metric-card>strong{grid-column:2;margin-top:-16px;font-size:30px;letter-spacing:-.04em}.metric-card>small{grid-column:2;color:var(--text-secondary);font-size:11px;line-height:1.45}.metric-card>b{position:absolute;bottom:16px;left:18px;display:flex;align-items:center;gap:3px;color:var(--brand-700);font-size:11px}.metric-card b :deep(svg){width:14px}.metric-card--orange>i{background:#fff3df;color:#b54708}.metric-card--blue>i{background:#ebf2ff;color:#3538cd}.metric-card--red>i{background:#fff0ee;color:#b42318}.metric-card .danger{color:var(--danger)}.workbench-grid,.lower-grid{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(300px,.8fr);gap:18px;margin-bottom:18px}.priority-panel,.safety-panel,.away-panel,.attention-panel,.recent-panel{overflow:hidden}.section-title-row{padding:20px 22px 16px}.section-kicker{display:block;margin-bottom:5px}.next-step{display:grid;grid-template-columns:42px minmax(0,1fr) auto;align-items:center;gap:13px;margin:0 22px 10px;padding:16px;border:1px solid #b9ded6;border-radius:13px;background:linear-gradient(90deg,#effaf7,#fbfefd)}.next-step__number{display:grid;width:38px;height:38px;place-items:center;border-radius:11px;background:var(--brand-700);color:#fff;font-weight:800}.next-step small{color:var(--brand-700);font-size:11px;font-weight:700}.next-step strong{display:block;margin-top:4px}.next-step p{margin:5px 0 0;color:var(--text-secondary);font-size:12px;line-height:1.45}.readiness-list{padding:0 22px 18px}.readiness-list button{display:grid;width:100%;grid-template-columns:28px minmax(0,1fr) auto;align-items:center;gap:10px;padding:12px 0;border:0;border-top:1px solid #edf2f0;background:transparent;color:var(--text);text-align:left;cursor:pointer}.readiness-list button:first-child{border-top:0}.readiness-list button>span{display:grid;width:25px;height:25px;place-items:center;border-radius:8px;background:#eef2f4;color:#667085;font-size:11px;font-weight:700}.readiness-list button.done>span{background:#d9f8e7;color:#087f5b}.readiness-list button.current>span{background:#dff6f1;color:var(--brand-700)}.readiness-list strong,.readiness-list small{display:block}.readiness-list small{margin-top:3px;color:var(--text-secondary);font-size:11px;line-height:1.4}.readiness-list :deep(svg){width:15px;color:#98a2b3}.safety-panel{background:linear-gradient(180deg,#102f2c 0%,#082725 100%);border-color:#183f3b;color:#fff}.safety-panel .section-title-row{border-color:rgba(255,255,255,.1)}.safety-panel .section-title-row h2{color:#fff}.safety-panel .section-kicker{color:#76d8ca}.safety-panel ul{display:grid;gap:16px;margin:0;padding:18px 22px 20px;list-style:none}.safety-panel li{display:grid;gap:4px;padding-left:14px;border-left:2px solid #35bba8}.safety-panel b{font-size:13px}.safety-panel li span{color:#abc9c4;font-size:11px;line-height:1.5}.safety-panel footer{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:13px 22px;border-top:1px solid rgba(255,255,255,.1);color:#95b8b2;font-size:11px}.safety-panel :deep(.el-button){color:#81e6d6}.away-panel{margin-bottom:18px}.compact-empty{display:grid;justify-items:start;gap:8px;padding:30px 22px 26px}.compact-empty span{font-weight:700}.compact-empty small{color:var(--text-secondary);line-height:1.5}.account-list{padding:0 22px 20px}.account-list article{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-top:10px;padding:16px;border:1px solid #e6edeb;border-radius:13px;background:#fbfcfc}.account-status{display:flex;align-items:center;gap:12px}.account-status>i{width:10px;height:10px;border-radius:50%;background:#98a2b3}.account-status.active>i{background:#12b76a;box-shadow:0 0 0 5px #d1fadf}.account-status small{display:block;margin-top:5px;color:var(--text-secondary);font-size:12px}.account-actions{display:flex;gap:8px}.attention-panel>button{display:grid;width:100%;grid-template-columns:25px 1fr auto;align-items:center;gap:10px;padding:16px 22px;border:0;border-top:1px solid var(--border);background:#fff;color:var(--text);text-align:left;cursor:pointer}.attention-panel>button:hover{background:#fffaf5}.attention-panel>button>svg{width:19px;color:var(--warning)}.attention-panel button small{display:block;margin-top:4px;color:var(--text-secondary);font-size:12px}.all-clear{display:grid;justify-items:center;gap:6px;padding:38px 20px}.all-clear>span{display:grid;width:42px;height:42px;place-items:center;border-radius:50%;background:#ecfdf3;color:var(--success);font-size:22px}.all-clear small,.recent-empty small{color:var(--text-secondary);font-size:12px}.recent-empty{display:grid;gap:6px;padding:38px 22px}.recent-empty span{font-weight:700}.attempt-list{padding:0 22px 8px}.attempt-list article{display:grid;grid-template-columns:38px minmax(0,1fr) auto auto;align-items:center;gap:11px;padding:13px 0;border-top:1px solid #edf1f0}.avatar{display:grid;width:36px;height:36px;place-items:center;border-radius:11px;background:var(--brand-100);color:var(--brand-700);font-weight:700}.attempt-list strong,.attempt-list small{display:block}.attempt-list small{margin-top:4px;color:var(--text-secondary);font-size:11px}.attempt-list time{color:var(--text-secondary);font-size:11px;text-align:right}@media(max-width:1100px){.metric-grid{grid-template-columns:repeat(2,1fr)}.workbench-grid,.lower-grid{grid-template-columns:1fr}.safety-panel{min-height:0}}@media(max-width:700px){.dashboard-page{padding-top:20px}.command-hero{grid-template-columns:1fr;padding:22px}.hero-copy h1{font-size:31px}.hero-status{padding:18px}.metric-grid{grid-template-columns:1fr 1fr}.next-step{grid-template-columns:38px 1fr}.next-step .el-button{grid-column:1/-1}.account-list article{align-items:flex-start;flex-direction:column}.account-actions{flex-wrap:wrap}.attempt-list article{grid-template-columns:36px 1fr auto}.attempt-list time{grid-column:2/4;text-align:left}.lower-grid{margin-bottom:0}}@media(max-width:430px){.metric-grid{grid-template-columns:1fr}.hero-facts{gap:11px}.hero-actions{flex-direction:column}.readiness-list{padding-right:16px;padding-left:16px}.next-step{margin-right:16px;margin-left:16px}.section-title-row{padding-right:16px;padding-left:16px}}
</style>
