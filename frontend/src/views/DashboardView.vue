<script setup lang="ts">
import PageHeader from '../components/PageHeader.vue'
import AsyncState from '../components/AsyncState.vue'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ChatDotRound, CircleCheck, Clock, Close, InfoFilled, Refresh } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api, apiErrorMessage, ensureCsrf } from '../services/api'
import { useNotificationCenter } from '../composables/useNotificationCenter'
import type { AiDutyEvent, AiDutyReviewRequired, AiReplyQualitySummary, AutoReplyPolicy, BrowserDevice, BrowserUnreadObservation } from '../types'

const router = useRouter(); const notify = useNotificationCenter(); const loading = ref(true); const switching = ref(false); const loadError = ref('')
const policies = ref<AutoReplyPolicy[]>([]); const devices = ref<BrowserDevice[]>([]); const observations = ref<BrowserUnreadObservation[]>([])
const dutyReplies = ref<AiDutyEvent[]>([])
const dutyReviewRequired = ref<AiDutyReviewRequired[]>([])
const qualitySummary = ref<AiReplyQualitySummary | null>(null)
const reviewExpanded = ref(true); const reviewRequiredExpanded = ref(true)
const lastRefreshed = ref<Date>(new Date()); const autoRefreshEnabled = ref(true); const refreshIntervalSec = ref(15)
const noticeDismissed = ref(false); const liveMessage = ref('')
let noticeTimer: ReturnType<typeof setTimeout> | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null

const refreshAgo = computed(() => { 
  const s = Math.floor((Date.now() - lastRefreshed.value.getTime()) / 1000)
  if (s < 10) return '刚刚'
  if (s < 60) return `${s} 秒前`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} 分钟前`
  return `${Math.floor(m / 60)} 小时前` 
})

const active = computed(() => policies.value.filter(x => x.awayActive))
const watchable = computed(() => policies.value.filter(x => x.accountStatus === 'ACTIVE' && ['CONNECTED','DEGRADED'].includes(x.connectionStatus)))
const online = computed(() => devices.value.filter(x => x.status === 'ACTIVE' && x.runtimeState === 'RUNNING').length)
const issues = computed(() => new Set(devices.value.filter(x => x.status === 'ACTIVE' && x.runtimeState !== 'RUNNING').map(x => x.accountId)).size)

const currentId = computed(() => observations.value.filter(x => x.detailVerifiedAt).sort((a,b) => +new Date(b.detailVerifiedAt!) - +new Date(a.detailVerifiedAt!))[0]?.id)
const ordered = (items: BrowserUnreadObservation[]) => [...items].sort((a,b) => a.id === currentId.value ? -1 : b.id === currentId.value ? 1 : +new Date(b.latestMessageAt || b.lastSeenAt) - +new Date(a.latestMessageAt || a.lastSeenAt))
const unread = computed(() => ordered(observations.value.filter(x => x.unread && x.resolutionStatus === 'UNRESOLVED')))
const drafts = computed(() => unread.value.filter(x => x.draftQualification === 'KNOWLEDGE_READY').length)

const funnelPct = computed(() => {
  if (!qualitySummary.value || !qualitySummary.value.evaluated) return { sent: 0, review: 0, silence: 0, failed: 0 }
  const q = qualitySummary.value
  return {
    sent: (q.sent / q.evaluated) * 100,
    review: (q.reviewRequired / q.evaluated) * 100,
    silence: (q.expectedSilence / q.evaluated) * 100,
    failed: (q.failed / q.evaluated) * 100,
  }
})
const confPct = computed(() => qualitySummary.value ? Math.round(qualitySummary.value.averageConfidence * 100) : 0)
const confDash = computed(() => {
  const r = 15.9155
  const pct = confPct.value
  return `${(pct / 100) * (2 * Math.PI * r)} ${2 * Math.PI * r}`
})
const catMax = computed(() => {
  if (!qualitySummary.value?.categories) return 1
  const vals = Object.values(qualitySummary.value.categories)
  const outVals = qualitySummary.value.outcomes ? Object.values(qualitySummary.value.outcomes) : []
  return Math.max(...vals, ...outVals, 1)
})

const qualityLabels: Record<string, string> = {
  technical: '技术能力',
  experience: '工作经验',
  education: '学历背景',
  communication: '沟通表达',
  culture_fit: '文化匹配',
  salary: '薪资期望',
  stability: '稳定性',
  job_relevance: '岗位相关性',
  greeting: '问候沟通',
  thanks: '感谢回应',
  considering: '考虑中',
  resume: '简历意向',
  approved: '建议回复',
  rejected: '不建议回复',
  silence: '建议静默',
  review: '需人工复核',
  failed: '处理失败',
  sent: '已发送',
  other: '其他',
}

function qualityLabel(key: string): string {
  const raw = String(key || '').trim()
  if (!raw) return '其他'
  const normalized = raw.toLowerCase().replace(/[\s-]+/g, '_')
  if (qualityLabels[normalized]) return qualityLabels[normalized]
  if (/[\u4e00-\u9fff]/.test(raw)) return raw
  return `其他（${raw}）`
}

function showQueueHelp() {
  ElMessage.info('消息队列已移除，现在您可以直接在左右卡片中查看 AI 值守回顾和待复核会话。')
}

async function load(silent = false){
  if (!silent) { loading.value = true; loadError.value = '' }
  const previousReviewIds = new Set(dutyReviewRequired.value.map(x => x.id))
  try {
    const results = await Promise.allSettled([
      api.get<AutoReplyPolicy[]>('/auto-replies/policies'),
      api.get<BrowserDevice[]>('/local-connector/devices'),
      api.get<BrowserUnreadObservation[]>('/local-connector/observations'),
      api.get<AiDutyEvent[]>('/local-connector/ai-duty-events'),
      api.get<AiDutyReviewRequired[]>('/local-connector/ai-duty-review-required'),
      api.get<AiReplyQualitySummary>('/local-connector/ai-reply-quality-summary')
    ])
    const read = <T>(index: number, fallback: T): T => {
      const result = results[index] as PromiseSettledResult<{ data: T }>
      return result.status === 'fulfilled' ? result.value.data : fallback
    }
    policies.value = read(0, policies.value); devices.value = read(1, devices.value); observations.value = read(2, observations.value)
    dutyReplies.value = read(3, dutyReplies.value); dutyReviewRequired.value = read(4, dutyReviewRequired.value); qualitySummary.value = read(5, qualitySummary.value)
    lastRefreshed.value = new Date()
    const newManualReviews = dutyReviewRequired.value.filter(x => !previousReviewIds.has(x.id))
    for (const item of newManualReviews) {
      notify.addNotification('MANUAL_REVIEW_REQUIRED', 'AI 已读未回复', `${item.jobTitle} · ${item.accountName}`, '/dashboard', item.id)
    }
    if (newManualReviews.length) liveMessage.value = `${newManualReviews.length} 条会话需要 HR 手动处理`
  } catch (e) {
    if (!silent) { loadError.value = apiErrorMessage(e, '值守状态加载失败') }
  } finally {
    if (!silent) { loading.value = false }
  }
}

function startPolling() {
  stopPolling()
  if (autoRefreshEnabled.value) {
    pollTimer = setInterval(() => load(true), refreshIntervalSec.value * 1000)
  }
}

function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null } }
watch(autoRefreshEnabled, (val) => { if (val) startPolling(); else stopPolling() })

function openDutyReply(reply:AiDutyEvent){
  // 详情页已移除，此处可改为跳转到对应账号的会话或仅做提示
  ElMessage.info(`查看会话: ${reply.jobTitle}`)
}

function dutyEventState(event:AiDutyEvent){
  if(event.sendStatus==='SUCCEEDED')return {label:'已自动回复',tone:'success' as const}
  if(event.sendStatus==='UNKNOWN')return {label:'发送待确认',tone:'danger' as const}
  if(event.taskStatus==='FAILED'||event.sendStatus==='FAILED')return {label:'处理失败',tone:'danger' as const}
  if(event.taskStatus==='RETRY_WAIT')return {label:'等待重试',tone:'warning' as const}
  if(event.sendStatus==='READY')return {label:'等待页面发送',tone:'warning' as const}
  if(event.sendStatus==='CLAIMED')return {label:'正在发送',tone:'info' as const}
  if(event.taskStatus==='PROCESSING')return {label:'AI 处理中',tone:'info' as const}
  if(event.sendStatus==='SKIPPED')return {label:'已安全跳过',tone:'neutral' as const}
  return {label:'等待处理',tone:'neutral' as const}
}

function dutyEventTime(event:AiDutyEvent){return event.completedAt||event.updatedAt}

function openDutyReviewRequired(item:AiDutyReviewRequired){
  ElMessage.info(`需人工复核: ${item.jobTitle}`)
}

function dismissNotice(){noticeDismissed.value=true;if(noticeTimer){clearTimeout(noticeTimer);noticeTimer=null}}

function toggle(value:boolean|string|number){
  if(Boolean(value)){
    if(!watchable.value.length)return ElMessage.warning('请先连接至少一个招聘账号')
    startOpen.value=true
  } else void stop()
}

const startOpen = ref(false); const hours = ref(2)
async function start(){
  switching.value=true
  try{
    await ensureCsrf()
    const endsAt=new Date(Date.now()+hours.value*3600000).toISOString()
    await Promise.all(watchable.value.map(x=>api.put(`/auto-replies/policies/${x.accountId}/away-mode`,{mode:hours.value>=24?'AFTER_HOURS':'TEMPORARY',endsAt,autoReplyEnabled:true})))
    startOpen.value=false
    ElMessage.success('自动值守已开启')
    await load()
  } catch(e) {
    ElMessage.error(apiErrorMessage(e,'挂机值守开启失败'))
  } finally {
    switching.value=false
  }
}

async function stop(){
  try{
    await ElMessageBox.confirm('确认结束全部招聘账号的自动值守?','结束挂机')
    switching.value=true
    await ensureCsrf()
    await Promise.all(active.value.map(x=>api.put(`/auto-replies/policies/${x.accountId}/away-mode`,{mode:'IN_OFFICE',endsAt:null,autoReplyEnabled:false})))
    await load()
  } catch(e) {
    if(e!=='cancel'&&e!=='close')ElMessage.error(apiErrorMessage(e,'挂机值守结束失败'))
  } finally {
    switching.value=false
  }
}

onMounted(() => { load(); startPolling(); noticeTimer = setTimeout(() => { noticeDismissed.value = true }, 15000) })
onUnmounted(() => { stopPolling(); if (noticeTimer) { clearTimeout(noticeTimer); noticeTimer = null } })
</script>
<template>
  <div class="page-shell duty-page">
    <PageHeader>
      <div>
        <h1>今天的招聘值守</h1>
        <p>开启后立即处理符合安全条件的未读消息，并持续监测新来信。<el-button :icon="InfoFilled" size="small" link @click="showQueueHelp">查看说明</el-button></p>
      </div>
    </PageHeader>

    <AsyncState v-if="loading" state="loading" :rows="8" aria-label="正在加载今日值守" />
    <AsyncState v-else-if="loadError" state="error" title="今日值守暂时无法加载" :message="loadError" @retry="load">
      <template #icon><el-icon><Refresh /></el-icon></template>
    </AsyncState>

    <template v-else>
      <!-- ── 顶部迷你仪表条 ── -->
      <section class="dashboard-bar" :class="{ 'dashboard-bar--active': active.length }">
        <div class="dashboard-bar__left">
          <span class="duty-badge" :class="{ 'duty-badge--on': active.length }">
            <el-icon :size="14"><Clock /></el-icon>
            {{ active.length ? '挂机值守中' : '挂机值守' }}
          </span>
          <el-switch :model-value="!!active.length" :loading="switching" aria-label="挂机值守开关" @change="toggle" />
          <small class="duty-sub">{{ active.length ? `${active.length} 个账号监测中` : `${watchable.length} 个账号可用` }}</small>
        </div>
        <div class="dashboard-bar__metrics">
          <span class="metric-pill metric-pill--primary">
            <b :key="'u-' + unread.length">{{ unread.length }}</b> 未读
          </span>
          <span class="metric-pill metric-pill--primary" :class="{ 'metric-pill--alert': drafts > 0 }">
            <b :key="'d-' + drafts">{{ drafts }}</b> 待审
          </span>
          <span class="metric-pill">
            <b :key="'o-' + online">{{ online }}</b> 在线
          </span>
          <span class="metric-pill" :class="{ 'metric-pill--warn': issues > 0 }">
            <b :key="'i-' + issues">{{ issues }}</b> 异常
          </span>
        </div>
        <div class="dashboard-bar__right">
          <span class="refresh-indicator" :class="{ 'refresh-indicator--stale': refreshAgo.includes('分钟') && !refreshAgo.includes('秒') }">
            <el-icon :size="13"><Clock /></el-icon>
            {{ refreshAgo }}
          </span>
          <el-button :icon="Refresh" size="small" :loading="loading" @click="load()">刷新</el-button>
        </div>
      </section>

      <section v-if="qualitySummary" class="quality-strip" aria-labelledby="quality-strip-title">
        <div class="quality-strip__intro">
          <span>过去 24 小时</span>
          <h2 id="quality-strip-title">AI 回复质量</h2>
        </div>
        <div class="quality-strip__body">
          <div class="quality-funnel" role="img" :aria-label="`发送 ${qualitySummary.sent}，待人工 ${qualitySummary.reviewRequired}，静默 ${qualitySummary.expectedSilence}，失败 ${qualitySummary.failed}`">
            <div class="quality-funnel__track">
              <span class="quality-funnel__seg quality-funnel__seg--sent" :style="{ width: funnelPct.sent + '%' }" aria-hidden="true"></span>
              <span class="quality-funnel__seg quality-funnel__seg--review" :style="{ width: funnelPct.review + '%' }" aria-hidden="true"></span>
              <span class="quality-funnel__seg quality-funnel__seg--silence" :style="{ width: funnelPct.silence + '%' }" aria-hidden="true"></span>
              <span class="quality-funnel__seg quality-funnel__seg--failed" :style="{ width: funnelPct.failed + '%' }" aria-hidden="true"></span>
            </div>
            <div class="quality-funnel__legend">
              <span class="quality-funnel__label quality-funnel__label--sent">发送成功 {{ qualitySummary.sent }}</span>
              <span class="quality-funnel__label quality-funnel__label--review">待人工 {{ qualitySummary.reviewRequired }}</span>
              <span class="quality-funnel__label quality-funnel__label--silence">正常静默 {{ qualitySummary.expectedSilence }}</span>
              <span v-if="qualitySummary.failed" class="quality-funnel__label quality-funnel__label--failed">失败 {{ qualitySummary.failed }}</span>
            </div>
          </div>
          <div class="quality-strip__stats">
            <div class="quality-stat"><dt>已评估</dt><dd>{{ qualitySummary.evaluated }}</dd></div>
            <div class="quality-stat"><dt>建议回复</dt><dd>{{ qualitySummary.replyApproved }}</dd></div>
            <div class="quality-confidence" role="meter" :aria-valuenow="confPct" aria-valuemin="0" aria-valuemax="100" aria-label="平均置信度">
              <div class="quality-confidence__visual">
                <svg viewBox="0 0 36 36" class="quality-confidence__ring">
                  <circle cx="18" cy="18" r="15.9155" fill="none" stroke="var(--border-subtle)" stroke-width="3"/>
                  <circle cx="18" cy="18" r="15.9155" fill="none" :stroke="confPct >= 80 ? 'var(--success)' : confPct >= 60 ? 'var(--warning)' : 'var(--danger)'" stroke-width="3" :stroke-dasharray="confDash" stroke-linecap="round" transform="rotate(-90 18 18)"/>
                </svg>
                <span class="quality-confidence__value">{{ confPct }}%</span>
              </div>
              <span class="quality-confidence__label">置信度</span>
            </div>
          </div>
        </div>
        <span v-if="qualitySummary.shadowEvaluated" class="quality-strip__shadow">影子评测 {{ qualitySummary.shadowEvaluated }}</span>
        <details v-if="Object.keys(qualitySummary.categories || {}).length || Object.keys(qualitySummary.outcomes || {}).length" class="quality-strip__detail">
          <summary class="quality-strip__detail-toggle">分类与结果分布</summary>
          <div class="quality-detail-grid">
            <div v-if="Object.keys(qualitySummary.categories).length" class="quality-detail-col">
              <h3>类别分布</h3>
              <div v-for="(count, cat) in qualitySummary.categories" :key="cat" class="quality-detail-row">
                <span class="quality-detail-row__name" :title="cat">{{ qualityLabel(cat) }}</span>
                <div class="quality-detail-row__track"><div class="quality-detail-row__fill" :style="{ width: (count / catMax * 100) + '%' }"></div></div>
                <strong>{{ count }}</strong>
              </div>
            </div>
            <div v-if="Object.keys(qualitySummary.outcomes).length" class="quality-detail-col">
              <h3>结果分布</h3>
              <div v-for="(count, outcome) in qualitySummary.outcomes" :key="outcome" class="quality-detail-row">
                <span class="quality-detail-row__name" :title="outcome">{{ qualityLabel(outcome) }}</span>
                <div class="quality-detail-row__track"><div class="quality-detail-row__fill quality-detail-row__fill--outcome" :style="{ width: (count / catMax * 100) + '%' }"></div></div>
                <strong>{{ count }}</strong>
              </div>
            </div>
          </div>
        </details>
      </section>

      <!-- ── 通知条（可关闭 + 15s 自动消失） ── -->
      <div v-if="issues && !noticeDismissed" class="notice-bar">
        <el-icon><InfoFilled /></el-icon>
        <span>{{ issues }} 个账号连接需要检查</span>
        <button class="notice-bar__link" @click="router.push('/boss-accounts')">检查账号 →</button>
        <button class="notice-bar__close" aria-label="关闭通知" @click="dismissNotice">
          <el-icon :size="14"><Close /></el-icon>
        </button>
      </div>

      <div class="duty-grid-layout">
        <section class="card-panel duty-review" aria-labelledby="duty-review-title">
          <header class="duty-review__header">
            <div>
              <button
                class="duty-review__toggle"
                :class="{ 'duty-review__toggle--open': reviewExpanded }"
                @click="reviewExpanded = !reviewExpanded"
                aria-label="展开/折叠 AI 值守回顾"
              ><span class="duty-review__eyebrow">最近 7 天</span></button>
              <h2 id="duty-review-title">AI 值守回顾</h2>
              <p>仅展示已收到浏览器成功回执的回复，不包含候选人原始消息。</p>
            </div>
            <div class="duty-review__header-right">
              <span class="duty-review__count"><b>{{ dutyReplies.length }}</b> 次已回复</span>
            </div>
          </header>
          <div v-show="reviewExpanded" class="duty-review__body">
            <AsyncState v-if="!dutyReplies.length" state="empty" embedded title="暂无 AI 处理记录" message="挂机期间 AI 处理过的任务会在这里显示。">
              <template #icon><el-icon><ChatDotRound /></el-icon></template>
            </AsyncState>
            <div v-else ref="dutyRepliesListRef" class="duty-review__vertical-list">
              <button v-for="(reply, idx) in dutyReplies" :key="reply.id" class="duty-reply-item" :class="`duty-reply-item--hue-${idx % 6}`" type="button" @click="openDutyReply(reply)">
                <span class="duty-reply-item__status" :class="{ followup: ['warning','danger'].includes(dutyEventState(reply).tone) }"></span>
                <div class="duty-reply-item__content">
                  <div class="duty-reply-item__header">
                    <strong>{{ reply.jobTitle }}</strong>
                    <time :datetime="dutyEventTime(reply)">{{ new Date(dutyEventTime(reply)).toLocaleTimeString('zh-CN', { hour:'2-digit', minute:'2-digit' }) }}</time>
                  </div>
                  <small>{{ reply.accountName }} · {{ reply.category || '未分类' }}</small>
                  <p v-if="reply.sendStatus === 'SUCCEEDED' && reply.replyContent">{{ reply.replyContent }}</p>
                </div>
              </button>
            </div>
          </div>
        </section>

        <section class="card-panel duty-review duty-review--required" aria-labelledby="duty-review-required-title">
          <header class="duty-review__header">
            <div>
              <button
                class="duty-review__toggle"
                :class="{ 'duty-review__toggle--open': reviewRequiredExpanded }"
                @click="reviewRequiredExpanded = !reviewRequiredExpanded"
                aria-label="展开/折叠已读未回复"
              ><span class="duty-review__eyebrow">过去 24 小时</span></button>
              <h2 id="duty-review-required-title">已读未回复 · 待 HR 复核</h2>
              <p>收录面试时间协商、无关或敏感内容、含义不清及事实校验未通过的会话。</p>
            </div>
            <div class="duty-review__header-right">
              <span class="duty-review__count duty-review__count--warning"><b>{{ dutyReviewRequired.length }}</b> 条待复核</span>
            </div>
          </header>
          <div v-show="reviewRequiredExpanded" class="duty-review__body">
            <AsyncState v-if="!dutyReviewRequired.length" state="empty" embedded title="暂无已读未回复会话" message="AI 安全跳过的无关消息会出现在这里。">
              <template #icon><el-icon><CircleCheck /></el-icon></template>
            </AsyncState>
            <div v-else ref="dutyReviewRequiredListRef" class="duty-review__vertical-list">
              <button v-for="item in dutyReviewRequired" :key="item.id" class="duty-reply-item duty-reply-item--required" type="button" @click="openDutyReviewRequired(item)">
                <span class="duty-reply-item__status followup"></span>
                <div class="duty-reply-item__content">
                  <div class="duty-reply-item__header">
                    <strong>匿名求职者</strong>
                    <time :datetime="item.decidedAt">{{ new Date(item.decidedAt).toLocaleTimeString('zh-CN', { hour:'2-digit', minute:'2-digit' }) }}</time>
                  </div>
                  <small>{{ item.jobTitle }} · {{ item.accountName }}</small>
                  <p>{{ item.reason }}</p>
                  <em class="duty-reply-item__note">AI 未回复，需人工判断</em>
                </div>
              </button>
            </div>
          </div>
        </section>
      </div>

      <!-- ── 屏幕阅读器实时播报 ── -->
      <div aria-live="polite" aria-atomic="true" class="sr-only">{{ liveMessage }}</div>
    </template>

    <el-dialog append-to-body v-model="startOpen" title="开启挂机值守" width="440px">
      <el-radio-group v-model="hours">
        <el-radio-button :value="2">2 小时</el-radio-button>
        <el-radio-button :value="4">4 小时</el-radio-button>
        <el-radio-button :value="24">全天</el-radio-button>
      </el-radio-group>
      <template #footer>
        <el-button @click="startOpen = false">取消</el-button>
        <el-button type="primary" :loading="switching" @click="start">开始挂机</el-button>
      </template>
    </el-dialog>
  </div>
</template>
<style scoped>
.duty-page { max-width: 1480px; }

/* ── 屏幕阅读器专用 ── */
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); border: 0; }

/* ═══════════════════════════════════════
   顶部迷你仪表条
   ═══════════════════════════════════════ */
.dashboard-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 20px;
  margin-bottom: 18px;
  border-radius: var(--radius-panel);
  border: 1px solid var(--border-teal);
  background:
    linear-gradient(135deg, rgba(238,249,246,.92), rgba(255,255,255,.72)),
    var(--surface-teal);
  box-shadow: var(--shadow-raised), inset 0 1px 0 rgba(255,255,255,.62);
  transition: background 300ms ease, border-color 300ms ease;
  position: relative;
  overflow: hidden;
}
.dashboard-bar::before {
  content: '';
  position: absolute;
  inset: -80% auto auto 48%;
  width: 420px;
  height: 220px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(20,184,166,.16), transparent 68%);
  pointer-events: none;
}
.dashboard-bar--active {
  background: linear-gradient(135deg, #0d9488 0%, #0f766e 50%, #0c1f2d 100%);
  background-size: 200% 200%;
  animation: barShimmer 6s ease-in-out infinite;
  border-color: var(--brand-600);
  color: white;
}
.dashboard-bar > * { position: relative; z-index: 1; }
@keyframes barShimmer {
  0%, 100% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
}

.dashboard-bar__left {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.duty-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: var(--radius-pill);
  background: var(--surface-soft);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  transition: background 200ms ease, color 200ms ease;
}
.duty-badge--on {
  background: rgba(94,234,212,.15);
  color: var(--primary);
}
.dashboard-bar--active .duty-badge {
  background: rgba(255,255,255,.15);
  color: rgba(255,255,255,.9);
}
.duty-sub {
  font-size: 11px;
  color: var(--text-tertiary);
  white-space: nowrap;
  transition: color 200ms ease;
}
.dashboard-bar--active .duty-sub { color: rgba(255,255,255,.55); }

.dashboard-bar__metrics {
  display: flex;
  gap: 8px;
  flex: 1;
  justify-content: center;
}
.metric-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 32px;
  padding: 5px 13px;
  border-radius: var(--radius-pill);
  background: rgba(255,255,255,.78);
  border: 1px solid var(--border-subtle);
  font-size: 12px;
  color: var(--text-secondary);
  box-shadow: 0 1px 2px rgba(17,28,45,.04), inset 0 1px 0 rgba(255,255,255,.5);
  transition: background 200ms ease, border-color 200ms ease, color 200ms ease, transform 200ms ease;
}
.metric-pill:hover { transform: translateY(-1px); }
.metric-pill b {
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  color: var(--text-primary);
  transition: color 200ms ease;
  animation: metricPulse 0.35s cubic-bezier(.16,1,.3,1);
}
@keyframes metricPulse {
  0% { transform: scale(1.15); }
  100% { transform: scale(1); }
}
.metric-pill--primary b { color: var(--primary); }
.metric-pill--alert b { color: var(--warning); }
.metric-pill--warn { border-color: var(--border-rose); background: var(--surface-rose); }
.metric-pill--warn b { color: var(--danger); }

.dashboard-bar--active .metric-pill {
  background: rgba(255,255,255,.1);
  border-color: rgba(255,255,255,.12);
  color: rgba(255,255,255,.6);
}
.dashboard-bar--active .metric-pill b { color: white; }
.dashboard-bar--active .metric-pill--alert b { color: #fbbf24; }
.dashboard-bar--active .metric-pill--warn { background: rgba(180,35,24,.2); border-color: rgba(248,113,113,.2); }
.dashboard-bar--active .metric-pill--warn b { color: #f87171; }

.dashboard-bar__right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.refresh-indicator {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-tertiary);
  white-space: nowrap;
  transition: color var(--transition-normal);
}
.refresh-indicator--stale { color: var(--warning); }
.dashboard-bar--active .refresh-indicator { color: rgba(255,255,255,.5); }

.quality-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 12px 20px;
  margin-bottom: 16px;
  padding: 14px 18px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-card);
  background: linear-gradient(110deg, color-mix(in srgb, var(--surface-teal) 60%, white), rgba(255,255,255,.78));
  box-shadow: var(--shadow-sm);
}
.quality-strip__intro { flex: 0 0 auto; min-width: 112px; }
.quality-strip__intro span { color: var(--primary); font-size: 10px; font-weight: 700; letter-spacing: .08em; }
.quality-strip__intro h2 { margin: 2px 0 0; font-size: 15px; }
.quality-strip__body { display: flex; flex: 1; min-width: 0; gap: 18px; align-items: center; }
.quality-strip__stats { display: flex; gap: 16px; align-items: center; flex-shrink: 0; }
.quality-stat { padding: 0 12px; border-left: 1px solid var(--border-subtle); }
.quality-stat:first-child { border-left: 0; padding-left: 0; }
.quality-stat dt { color: var(--text-tertiary); font-size: 10px; }
.quality-stat dd { margin: 3px 0 0; color: var(--text-primary); font-size: 17px; font-weight: 700; font-variant-numeric: tabular-nums; }
.quality-strip__shadow { flex: 0 0 auto; padding: 5px 9px; border-radius: var(--radius-pill); background: var(--surface-amber); color: var(--warning); font-size: 11px; font-weight: 600; }

.quality-funnel { flex: 1; min-width: 0; }
.quality-funnel__track { display: flex; height: 8px; padding: 2px; box-sizing: border-box; border: 1px solid var(--border-subtle); border-radius: var(--radius-pill); overflow: hidden; background: color-mix(in srgb, var(--surface-muted) 72%, transparent); box-shadow: inset 0 1px 2px rgba(15, 23, 42, .06); }
.quality-funnel__seg { display: block; flex: 0 0 auto; min-width: 0; height: 100%; transition: width .4s cubic-bezier(.16,1,.3,1); }
.quality-funnel__seg + .quality-funnel__seg { box-shadow: inset 1px 0 rgba(255,255,255,.5); }
.quality-funnel__seg--sent { background: color-mix(in srgb, var(--success) 84%, white); }
.quality-funnel__seg--review { background: color-mix(in srgb, var(--warning) 84%, white); }
.quality-funnel__seg--silence { background: color-mix(in srgb, var(--text-tertiary) 60%, white); }
.quality-funnel__seg--failed { background: color-mix(in srgb, var(--danger) 84%, white); }
.quality-funnel__legend { display: flex; flex-wrap: wrap; gap: 8px 14px; margin-top: 6px; }
.quality-funnel__label { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--text-secondary); }
.quality-funnel__label::before { content: ''; width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; box-shadow: 0 0 0 2px color-mix(in srgb, currentColor 12%, transparent); }
.quality-funnel__label--sent::before { background: var(--success); }
.quality-funnel__label--review::before { background: var(--warning); }
.quality-funnel__label--silence::before { background: var(--text-tertiary); opacity: .55; }
.quality-funnel__label--failed::before { background: var(--danger); }

.quality-confidence { display: flex; flex: 0 0 68px; flex-direction: column; align-items: center; gap: 3px; min-height: 72px; }
.quality-confidence__visual { position: relative; width: 48px; height: 48px; display: grid; place-items: center; }
.quality-confidence__ring { width: 48px; height: 48px; }
.quality-confidence__value { position: absolute; font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--text-primary); }
.quality-confidence__label { position: static; font-size: 10px; line-height: 1; color: var(--text-tertiary); white-space: nowrap; }

.quality-strip__detail { flex-basis: 100%; margin-top: 4px; }
.quality-strip__detail-toggle { display: inline-flex; align-items: center; gap: 4px; padding: 4px 0; border: 0; background: none; color: var(--primary); font-size: 12px; font-weight: 600; cursor: pointer; list-style: none; }
.quality-strip__detail-toggle::before { content: ''; display: inline-block; width: 0; height: 0; border-left: 4px solid transparent; border-right: 4px solid transparent; border-top: 5px solid var(--primary); transition: transform .2s ease; }
.quality-strip__detail[open] .quality-strip__detail-toggle::before { transform: rotate(180deg); }
.quality-detail-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-top: 10px; padding: 12px 14px; border-radius: var(--radius-control); background: var(--surface-soft); }
.quality-detail-col h3 { margin: 0 0 8px; font-size: 12px; color: var(--text-secondary); }
.quality-detail-row { display: grid; grid-template-columns: 96px 1fr 32px; gap: 6px; align-items: center; margin-bottom: 5px; }
.quality-detail-row__name { font-size: 11px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.quality-detail-row__track { height: 6px; border-radius: 3px; background: var(--border-subtle); overflow: hidden; }
.quality-detail-row__fill { height: 100%; border-radius: 3px; background: var(--success); transition: width .4s cubic-bezier(.16,1,.3,1); }
.quality-detail-row__fill--outcome { background: var(--primary); }
.quality-detail-row strong { font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--text-primary); text-align: right; }

@media (max-width: 980px) {
  .quality-strip__body { flex-direction: column; align-items: stretch; }
  .quality-strip__stats { justify-content: flex-start; }
}
@media (max-width: 560px) {
  .quality-strip__stats { flex-wrap: wrap; gap: 10px; }
  .quality-stat { border-left: 0; padding: 0; }
  .quality-detail-grid { grid-template-columns: 1fr; }
}

/* ── 通知条 ── */
.notice-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  margin-bottom: 16px;
  border-radius: var(--radius-control);
  border: 1px solid var(--border-amber);
  background: var(--surface-amber);
  font-size: 13px;
  color: var(--text-primary);
}
.notice-bar .el-icon { color: var(--warning); font-size: 16px; }
.notice-bar__link {
  margin-left: auto;
  padding: 0;
  border: none;
  background: none;
  color: var(--primary);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: color var(--transition-fast);
}
.notice-bar__link:hover { color: var(--brand-700); }
.notice-bar__close {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  margin-left: 8px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast);
}
.notice-bar__close:hover { background: var(--surface-muted); color: var(--text-primary); }

.duty-review { margin-bottom:18px; padding:0; overflow:hidden; }
.duty-review__header { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:18px 20px; border-bottom:2px solid transparent; border-image:linear-gradient(90deg, transparent, var(--border-subtle) 15%, var(--border-subtle) 85%, transparent) 1; background:linear-gradient(180deg, rgba(255,255,255,.64), transparent); }
.duty-review__header h2 { margin:2px 0 0; }
.duty-review__header p { margin:4px 0 0; color:var(--text-secondary); font-size:12px; }
.duty-review__eyebrow { color:var(--primary); font-size:11px; font-weight:700; }
.duty-review__header-right { display:flex; align-items:center; gap:10px; flex-shrink:0; }
.duty-review__count { flex:0 0 auto; padding:6px 10px; border-radius:var(--radius-pill); background:var(--surface-teal); color:var(--text-secondary); font-size:12px; }
.duty-review__count b { color:var(--primary); font-size:16px; }

/* ── 折叠/展开 ── */
.duty-review__toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
  color: inherit;
  font: inherit;
}
.duty-review__toggle::after {
  content: '';
  display: inline-block;
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 5px solid var(--text-tertiary);
  transition: transform 200ms ease;
}
.duty-review__toggle--open::after { transform: rotate(180deg); }
.duty-review__body { overflow: hidden; }

.duty-review__arrows { display:flex; gap:4px; }
.duty-review__list { display:flex; overflow-x:auto; scroll-behavior:smooth; scrollbar-width:thin; scrollbar-color:var(--border-subtle) transparent; }
.scroll-arrow { display:grid; place-items:center; width:28px; height:28px; padding:0; border:1px solid var(--border-subtle); border-radius:6px; background:var(--surface); color:var(--text-secondary); cursor:pointer; transition:background var(--transition-fast),color var(--transition-fast),border-color var(--transition-fast); }
.scroll-arrow:hover:not(:disabled) { background:var(--surface-soft); color:var(--primary); border-color:var(--border-teal); }
.scroll-arrow:disabled { opacity:0.3; cursor:not-allowed; }
.duty-reply { display:grid; grid-template-columns:8px minmax(0,1fr); gap:8px; flex-shrink:0; width:208px; padding:15px 16px; border:0; border-right:1px solid var(--border-subtle); background:linear-gradient(145deg, rgba(13,148,136,.06) 0%, rgba(255,255,255,.66) 100%); color:var(--text-primary); text-align:left; cursor:pointer; transition:background var(--transition-fast), box-shadow var(--transition-fast), transform var(--transition-fast); }
.duty-reply:last-child { border-right:0; }
.duty-reply:hover { background:linear-gradient(145deg, rgba(13,148,136,.10) 0%, rgba(255,255,255,.82) 100%); box-shadow:inset 3px 0 0 rgba(13,148,136,.25), 0 2px 8px rgba(13,148,136,.08); transform:translateY(-1px); }
.duty-reply--hue-0 { background:linear-gradient(145deg, rgba(13,148,136,.02) 0%, rgba(236,249,246,.18) 100%); }
.duty-reply--hue-0:hover { background:linear-gradient(145deg, rgba(13,148,136,.06) 0%, rgba(236,249,246,.38) 100%); box-shadow:inset 3px 0 0 rgba(13,148,136,.18), 0 2px 8px rgba(13,148,136,.06); }
.duty-reply--hue-0 .duty-reply__status { background:#0d9488; }
.duty-reply--hue-1 { background:linear-gradient(145deg, rgba(37,99,235,.06) 0%, rgba(239,246,255,.35) 100%); }
.duty-reply--hue-1:hover { background:linear-gradient(145deg, rgba(37,99,235,.11) 0%, rgba(239,246,255,.55) 100%); box-shadow:inset 3px 0 0 rgba(37,99,235,.22), 0 2px 8px rgba(37,99,235,.08); }
.duty-reply--hue-1 .duty-reply__status { background:#2563eb; }
.duty-reply--hue-2 { background:linear-gradient(145deg, rgba(124,58,237,.11) 0%, rgba(245,243,255,.52) 100%); }
.duty-reply--hue-2:hover { background:linear-gradient(145deg, rgba(124,58,237,.18) 0%, rgba(245,243,255,.72) 100%); box-shadow:inset 3px 0 0 rgba(124,58,237,.28), 0 2px 8px rgba(124,58,237,.10); }
.duty-reply--hue-2 .duty-reply__status { background:#7c3aed; }
.duty-reply--hue-3 { background:linear-gradient(145deg, rgba(217,119,6,.16) 0%, rgba(255,251,240,.68) 100%); }
.duty-reply--hue-3:hover { background:linear-gradient(145deg, rgba(217,119,6,.25) 0%, rgba(255,251,240,.88) 100%); box-shadow:inset 3px 0 0 rgba(217,119,6,.34), 0 2px 8px rgba(217,119,6,.12); }
.duty-reply--hue-3 .duty-reply__status { background:#d97706; }
.duty-reply--hue-4 { background:linear-gradient(145deg, rgba(225,29,72,.22) 0%, rgba(255,241,242,.82) 100%); }
.duty-reply--hue-4:hover { background:linear-gradient(145deg, rgba(225,29,72,.32) 0%, rgba(255,241,242,.96) 100%); box-shadow:inset 3px 0 0 rgba(225,29,72,.40), 0 2px 8px rgba(225,29,72,.14); }
.duty-reply--hue-4 .duty-reply__status { background:#e11d48; }
.duty-reply--hue-5 { background:linear-gradient(145deg, rgba(5,150,105,.28) 0%, rgba(236,253,245,.95) 100%); }
.duty-reply--hue-5:hover { background:linear-gradient(145deg, rgba(5,150,105,.40) 0%, rgba(236,253,245,1) 100%); box-shadow:inset 3px 0 0 rgba(5,150,105,.48), 0 2px 8px rgba(5,150,105,.16); }
.duty-reply--hue-5 .duty-reply__status { background:#059669; }
.duty-reply:active { animation:card-press 180ms ease-out both; }
.duty-reply:focus-visible { outline:2px solid var(--border-focus); outline-offset:-2px; }
.duty-reply__status { width:7px; height:7px; margin-top:5px; border-radius:50%; background:var(--success); }
.duty-reply__status.followup { background:var(--warning); }
.duty-reply__main { display:block; min-width:0; }
.duty-reply__main strong,.duty-reply__main small,.duty-reply__main>span { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.duty-reply__main strong { font-size:13px; }
.duty-reply__main small { margin-top:2px; color:var(--text-tertiary); font-size:10px; }
.duty-reply__main>span { margin-top:8px; color:var(--text-secondary); font-size:12px; }
.duty-reply__meta { grid-column:2; display:flex; align-items:center; justify-content:space-between; gap:8px; margin-top:5px; color:var(--text-tertiary); font-size:10px; }
.duty-reply__meta em { color:var(--warning); font-style:normal; font-weight:600; }
.duty-event-state--success { color:var(--success) !important; }
.duty-event-state--danger { color:var(--danger) !important; }
.duty-event-state--info { color:var(--primary) !important; }
.duty-event-state--neutral { color:var(--text-tertiary) !important; }
.duty-review--required { margin-top:14px; border-color:var(--border-amber); }
.duty-review__count--warning { background:var(--surface-amber); color:var(--warning); }
.duty-reply--required { background:linear-gradient(145deg,var(--surface-amber),var(--surface) 68%); }

@media (max-width:1200px) { .duty-reply { width:180px; } }
@media (max-width:760px) { .duty-review__header { align-items:flex-start; flex-wrap:wrap; }.duty-reply { width:160px; }.duty-review__count { white-space:nowrap; } }

/* ═══════════════════════════════════════
   双栏工作区
   ═══════════════════════════════════════ */
.workspace-split {
  display: flex;
  gap: 22px;
  align-items: flex-start;
}

.queue-column {
  flex: 1;
  min-width: 0;
}

/* ── 消息队列面板 ── */
.queue {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 400px;
  padding: 0;
  border-radius: var(--radius-panel);
  border: 1px solid color-mix(in srgb, var(--border-subtle) 82%, transparent);
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  position: relative;
  box-shadow: var(--shadow-raised), inset 0 1px 0 var(--glass-highlight), inset 0 -1px 0 var(--glass-shadow-inner);
  transition: box-shadow var(--transition-normal);
}
.queue:hover { box-shadow: var(--shadow-floating), inset 0 1px 0 var(--glass-highlight), inset 0 -1px 0 var(--glass-shadow-inner); }
.queue > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
  background: linear-gradient(180deg, rgba(255,255,255,.72), rgba(247,249,250,.82));
  border-radius: var(--radius-panel) var(--radius-panel) 0 0;
}
h2 { margin: 0; font-size: 16px; }
.queue p { font-size: 12px; color: var(--text-secondary); margin: 4px 0 0; line-height: 1.5; }

.tabs {
  display: flex;
  flex-shrink: 0;
  gap: 3px;
  padding: 3px;
  background: var(--surface-soft);
  border-radius: var(--radius-control);
}
.tabs button {
  padding: 6px 10px;
  background: transparent;
  border: 0;
  border-radius: 6px;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 12px;
  transition: background var(--transition-fast), color var(--transition-fast);
}
.tabs button.active {
  background: var(--surface);
  color: var(--primary);
  box-shadow: var(--shadow-rest);
  font-weight: 600;
}

/* ── 消息行 ── */
.message-list { flex: 1; }
.message-row {
  display: grid;
  grid-template-columns: 3px 36px minmax(0, 1fr) auto;
  align-items: center;
  gap: 0 12px;
  padding: 14px 20px 14px 0;
  border: 0;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--surface);
  cursor: pointer;
  transition: background var(--transition-fast), box-shadow var(--transition-fast), transform var(--transition-fast);
}
/* ── 消息卡片网格 ── */
/* ── 今日值守左右分栏布局 ── */
.duty-grid-layout {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
  gap: 24px;
  align-items: stretch;
  margin-bottom: 32px;
}

.card-panel.duty-review {
  display: flex;
  flex-direction: column;
  height: auto;
  min-height: 380px;
  margin-bottom: 0;
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.3s ease;
}

.card-panel.duty-review:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-floating);
}

.duty-review__body {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 0 0 16px;
}

/* 优化空状态下的间距 */
.duty-review__body :deep(.async-state--embedded) {
  padding: 24px;
  flex: 1;
  justify-content: center;
}

.duty-review__vertical-list {
  flex: 1;
  display: flex;
  flex-direction: column;
  max-height: 520px; /* 适度缩小最大高度 */
  overflow-y: auto;
  padding: 4px 0 8px;
  gap: 2px;
  scrollbar-width: thin;
  scrollbar-color: var(--border-subtle) transparent;
}

.duty-review__vertical-list::-webkit-scrollbar { width: 5px; }
.duty-review__vertical-list::-webkit-scrollbar-thumb { background: var(--border-subtle); border-radius: 10px; }

.duty-reply-item {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 20px 24px;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
}

.duty-reply-item::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 24px;
  right: 24px;
  height: 1px;
  background: linear-gradient(90deg, var(--border-subtle), transparent);
}

.duty-reply-item:last-child::after { display: none; }

.duty-reply-item:hover {
  background: rgba(255, 255, 255, 0.4);
  padding-left: 28px;
}

.duty-reply-item__status {
  flex-shrink: 0;
  width: 10px;
  height: 10px;
  margin-top: 5px;
  border-radius: 50%;
  background: var(--success);
  box-shadow: 0 0 8px var(--success);
}

.duty-reply-item__status.followup { 
  background: var(--warning); 
  box-shadow: 0 0 8px var(--warning);
}

.duty-reply-item__content {
  flex: 1;
  min-width: 0;
}

.duty-reply-item__header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 6px;
}

.duty-reply-item__header strong {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.duty-reply-item__header time {
  font-size: 12px;
  color: var(--text-tertiary);
  font-family: var(--font-mono);
}

.duty-reply-item__content small {
  display: block;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 10px;
  opacity: 0.8;
}

.duty-reply-item__content p {
  font-size: 14px;
  color: var(--text-primary);
  line-height: 1.6;
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  opacity: 0.9;
}

.duty-reply-item__note {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 10px;
  padding: 2px 8px;
  background: var(--surface-amber);
  border-radius: 4px;
  font-size: 11px;
  color: var(--warning);
  font-style: normal;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

/* 渐变装饰 */
.duty-reply-item--hue-0 { border-left: 4px solid #14b8a6; }
.duty-reply-item--hue-1 { border-left: 4px solid #3b82f6; }
.duty-reply-item--hue-2 { border-left: 4px solid #8b5cf6; }
.duty-reply-item--hue-3 { border-left: 4px solid #f59e0b; }
.duty-reply-item--hue-4 { border-left: 4px solid #ef4444; }
.duty-reply-item--hue-5 { border-left: 4px solid #10b981; }

@media (max-width: 1024px) {
  .duty-grid-layout {
    grid-template-columns: 1fr;
    gap: 16px;
  }
  .card-panel.duty-review {
    min-height: auto; /* 移动端不需要强制等高 */
  }
}

@media (max-width: 640px) {
  .duty-reply-item {
    padding: 16px 18px;
    gap: 10px;
  }
  .duty-review__header {
    padding: 14px 16px;
  }
}

.duty-review__header { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:18px 20px; border-bottom:2px solid transparent; border-image:linear-gradient(90deg, transparent, var(--border-subtle) 15%, var(--border-subtle) 85%, transparent) 1; background:linear-gradient(180deg, rgba(255,255,255,.64), transparent); }
.duty-review__header h2 { margin:2px 0 0; }
.duty-review__header p { margin:4px 0 0; color:var(--text-secondary); font-size:12px; }
.duty-review__eyebrow { color:var(--primary); font-size:11px; font-weight:700; }
.duty-review__header-right { display:flex; align-items:center; gap:10px; flex-shrink:0; }
.duty-review__count { flex:0 0 auto; padding:6px 10px; border-radius:var(--radius-pill); background:var(--surface-teal); color:var(--text-secondary); font-size:12px; }
.duty-review__count b { color:var(--primary); font-size:16px; }
.duty-review__count--warning { background:var(--surface-amber); color:var(--warning); }

/* ── 折叠/展开 ── */
.duty-review__toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
  color: inherit;
  font: inherit;
}
.duty-review__toggle::after {
  content: '';
  display: inline-block;
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 5px solid var(--text-tertiary);
  transition: transform 200ms ease;
}
.duty-review__toggle--open::after { transform: rotate(180deg); }
.duty-review__body { overflow: hidden; }

/* ── 对话卡片动画 ── */
@keyframes card-press {
  0% { transform: scale(1); }
  50% { transform: scale(0.98); }
  100% { transform: scale(1); }
}

@keyframes card-select-breathe {
  0% { transform: scale(1); }
  50% { transform: scale(1.01); }
  100% { transform: scale(1); }
}
.detail-status__item b {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: .04em;
}
.detail-status__item span {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}
.detail-status--review { color: var(--warning); }

.cycle-progress {
  display: grid;
  gap: 12px;
  margin: 0 0 16px;
  padding: 14px;
  border: 1px solid color-mix(in srgb, var(--primary) 22%, var(--border));
  border-radius: var(--radius-control);
  background: color-mix(in srgb, var(--primary) 6%, var(--surface));
}
.cycle-progress header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.cycle-progress p { margin: 0; color: var(--text-secondary); font-size: 12px; line-height: 1.6; }
.cycle-progress :deep(.el-steps--simple) { padding: 10px 12px; background: var(--surface); border-radius: 10px; }
.cycle-progress :deep(.el-step__title) { font-size: 11px; }

.resume-pipeline {
  display: grid;
  gap: 10px;
  margin: 0 0 16px;
  padding: 14px;
  border: 1px solid color-mix(in srgb, var(--primary) 20%, var(--border));
  border-radius: var(--radius-control);
  background: color-mix(in srgb, var(--primary) 4%, var(--surface));
}
.resume-pipeline header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.resume-pipeline header > div { display: grid; gap: 3px; }
.resume-pipeline header small { color: var(--text-tertiary); font-size: 11px; }
.resume-pipeline p { margin: 0; color: var(--text-secondary); font-size: 12px; line-height: 1.6; }
.resume-pipeline__steps { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; color: var(--text-tertiary); font-size: 11px; text-align: center; }
.resume-pipeline__steps .active { color: var(--primary); font-weight: 700; }
.resume-pipeline__error { color: var(--danger) !important; }
.resume-pipeline .el-button { justify-self: end; }

.detail-match,
.detail-draft {
  display: grid;
  gap: 10px;
  margin-top: 16px;
  padding: 14px;
  border-radius: var(--radius-control);
  background: var(--surface-soft);
}
.detail-match small,
.detail-draft small { color: var(--text-secondary); }
.detail-draft header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.detail-draft p {
  white-space: pre-wrap;
  line-height: 1.7;
  margin: 0;
  font-size: 13px;
}

.detail-actions {
  display: flex;
  gap: 8px;
  padding: 14px 20px;
  border-top: 1px solid var(--border);
  background: var(--surface-soft);
}
.detail-actions .el-button { flex: 1; }
.cycle-start-actions { align-items: center; }
.cycle-start-actions span { flex: 1; color: var(--text-secondary); font-size: 12px; line-height: 1.5; }
.cycle-start-actions .el-button { flex: 0 0 auto; }

.detail-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 40px 20px;
  text-align: center;
}
.detail-empty__icon {
  display: grid;
  place-items: center;
  width: 74px;
  height: 74px;
  border-radius: 22px;
  background: linear-gradient(145deg, rgba(238,249,246,.92), rgba(255,255,255,.68));
  box-shadow: var(--shadow-raised), inset 0 1px 0 rgba(255,255,255,.62);
  animation: emptyFloat 3s ease-in-out infinite;
}
@keyframes emptyFloat {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
}
.detail-empty p {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-secondary);
}
.detail-empty small {
  font-size: 12px;
  color: var(--text-tertiary);
}
.detail-empty__hint {
  margin-top: 8px;
  font-size: 11px;
  color: var(--text-tertiary);
  opacity: .7;
  font-family: var(--font-mono, monospace);
}

/* ═══════════════════════════════════════
   队列光斑装饰
   ═══════════════════════════════════════ */
.queue::before {
  content: '';
  position: absolute;
  top: -40%;
  right: -20%;
  width: 60%;
  height: 60%;
  border-radius: 50%;
  background: radial-gradient(circle, #5eead4, transparent 70%);
  pointer-events: none;
  z-index: 0;
  opacity: .035;
}
.queue::after {
  content: '';
  position: absolute;
  top: 0; left: 12px; right: 12px;
  height: 3px;
  border-radius: 0 0 2px 2px;
  background: linear-gradient(90deg, var(--primary), color-mix(in srgb, var(--primary) 45%, transparent), transparent);
  opacity: .72;
  z-index: 2;
  pointer-events: none;
}

/* ═══════════════════════════════════════
   响应式
   ═══════════════════════════════════════ */
@media (max-width: 1100px) {
  .detail-panel { flex: 0 0 340px; }
}

@media (max-width: 900px) {
  .workspace-split { flex-direction: column; }
  .detail-panel {
    flex: none;
    width: 100%;
    max-height: 50vh;
    position: relative;
    top: 0;
    order: -1;
    min-height: 0;
  }
  .detail-panel--open { min-height: 280px; }
}

@media (max-width: 600px) {
  .dashboard-bar {
    flex-wrap: wrap;
    gap: 10px;
    padding: 10px 14px;
  }
  .dashboard-bar__metrics { order: 3; flex-basis: 100%; justify-content: flex-start; }
  .dashboard-bar__right { margin-left: auto; }
  .metric-pill { padding: 4px 8px; font-size: 11px; }
  .queue > header { align-items: stretch; flex-direction: column; padding: 14px; }
  .tabs button { flex: 1; }
  .message-row {
    grid-template-columns: 3px 32px minmax(0, 1fr) auto;
    gap: 0 10px;
    padding: 12px 14px 12px 0;
  }
  .message-row__stats { display: none; }
  .queue > footer { padding: 12px 14px; }
  .queue > footer > span { flex-basis: 100%; }
  .detail-panel { max-height: 45vh; }
  .detail-header__actions { flex-direction: column-reverse; align-items: flex-end; }
  .detail-header__actions :deep(.el-button) { min-height: 44px; }
  .detail-empty__hint { display: none; }
}

@media (max-width: 480px) {
  .dashboard-bar { padding: 8px 12px; }
  .duty-sub { display: none; }
  .metric-pill { padding: 3px 6px; font-size: 10px; }
  .detail-panel { max-height: 40vh; }
}

/* ═══════════════════════════════════════
   暗色模式适配
   ═══════════════════════════════════════ */
:root[data-theme="dark"] .dashboard-bar:not(.dashboard-bar--active) {
  background: linear-gradient(135deg, rgba(13,148,136,.08), rgba(13,148,136,.04));
}
:root[data-theme="dark"] .metric-pill {
  background: rgba(255,255,255,.06);
  border-color: rgba(255,255,255,.08);
}
:root[data-theme="dark"] .metric-pill b { color: var(--text-primary); }
:root[data-theme="dark"] .metric-pill--warn {
  background: rgba(180,35,24,.12);
  border-color: rgba(248,113,113,.15);
}
:root[data-theme="dark"] .message-row.selected {
  background: rgba(13,148,136,.08);
}
:root[data-theme="dark"] .message-row.current {
  background: rgba(13,148,136,.08);
}
:root[data-theme="dark"] .message-row.message--review {
  background: linear-gradient(135deg, rgba(251,191,36,.08), rgba(251,191,36,.04));
}
:root[data-theme="dark"] .message-row.message--high {
  background: linear-gradient(135deg, rgba(37,99,235,.08), rgba(37,99,235,.04));
}
:root[data-theme="dark"] .message-row.message--manual {
  background: rgba(183,110,0,.13);
  border-color: rgba(232,173,75,.34);
}
:root[data-theme="dark"] .message-row__avatar {
  background: linear-gradient(135deg, rgba(13,148,136,.12), rgba(13,148,136,.06));
}
:root[data-theme="dark"] .queue > footer {
  background: linear-gradient(180deg, var(--surface-soft), var(--surface-muted));
}
:root[data-theme="dark"] .detail-panel {
  background: var(--surface);
  border-color: var(--border-subtle);
}
:root[data-theme="dark"] .detail-header__avatar {
  background: linear-gradient(135deg, rgba(13,148,136,.15), rgba(13,148,136,.08));
}
:root[data-theme="dark"] .detail-status {
  background: rgba(255,255,255,.04);
}
:root[data-theme="dark"] .detail-match,
:root[data-theme="dark"] .detail-draft {
  background: rgba(255,255,255,.04);
}
:root[data-theme="dark"] .detail-close {
  background: rgba(255,255,255,.06);
}

/* ── 回顾区暗色玻璃 ── */
:root[data-theme="dark"] .duty-review__header {
  background: linear-gradient(180deg, rgba(255,255,255,.04), transparent);
}
:root[data-theme="dark"] .duty-reply {
  background: rgba(255,255,255,.035);
}
:root[data-theme="dark"] .duty-reply:hover {
  background: rgba(255,255,255,.06);
}

/* ── 空态图标暗色 ── */
:root[data-theme="dark"] .detail-empty__icon {
  background: linear-gradient(145deg, rgba(13,148,136,.12), rgba(13,148,136,.04));
  box-shadow: var(--shadow-raised), inset 0 1px 0 rgba(255,255,255,.06);
}

/* ═══════════════════════════════════════
   减少动效偏好
   ═══════════════════════════════════════ */
@media (prefers-reduced-motion: reduce) {
  .metric-pill b { animation: none; }
  .dashboard-bar--active { transition: none; animation: none; }
  .detail-empty__icon { animation: none; }
  .detail-fade-enter-active,
  .detail-fade-leave-active { transition: none; }
}
</style>
