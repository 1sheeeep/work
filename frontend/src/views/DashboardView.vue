<script setup lang="ts">
import PageHeader from '../components/PageHeader.vue'
import AsyncState from '../components/AsyncState.vue'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ChatDotRound, CircleCheck, Clock, Close, InfoFilled, Location, Refresh } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api, apiErrorMessage, ensureCsrf } from '../services/api'
import { useNotificationCenter } from '../composables/useNotificationCenter'
import type { AiDutyEvent, AiDutyReviewRequired, AiReplyQualitySummary, AutoReplyPolicy, BrowserDevice, BrowserUnreadObservation } from '../types'

const router = useRouter(); const notify = useNotificationCenter(); const loading = ref(true); const switching = ref(false); const loadError = ref('')
const policies = ref<AutoReplyPolicy[]>([]); const devices = ref<BrowserDevice[]>([]); const observations = ref<BrowserUnreadObservation[]>([])
const dutyReplies = ref<AiDutyEvent[]>([])
const dutyReviewRequired = ref<AiDutyReviewRequired[]>([])
const locatingObservationId = ref<string | null>(null)
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

const funnelSegments = computed(() => {
  const q = qualitySummary.value
  if (!q || !q.evaluated) return []
  const classified = q.sent + q.unconfirmedSends + q.reviewRequired + q.expectedSilence + q.failed
  const rows = [
    { key: 'sent', label: '发送成功', value: q.sent },
    { key: 'unconfirmed', label: '待确认', value: q.unconfirmedSends },
    { key: 'review', label: '待人工', value: q.reviewRequired },
    { key: 'silence', label: '正常静默', value: q.expectedSilence },
    { key: 'failed', label: '失败', value: q.failed },
    { key: 'other', label: '其他', value: Math.max(0, q.evaluated - classified) },
  ]
  return rows.filter(row => row.value > 0).map(row => ({ ...row, pct: (row.value / q.evaluated) * 100 }))
})
const funnelSummary = computed(() => funnelSegments.value.map(seg => `${seg.label} ${seg.value}`).join('，'))
const confPct = computed(() => {
  const value = qualitySummary.value?.averageConfidence
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) : 0
})
const qualityLabels: Record<string, string> = {
  // 意图类别：与后端 category 枚举（AiDutyReviewRequired.category）保持一致
  greeting: '问候',
  social_greeting: '社交问候',
  social_thanks: '致谢',
  social_acknowledgement: '礼貌回应',
  candidate_considering: '考虑中',
  candidate_decline: '候选人婉拒',
  conversation_closing: '会话结束',
  resume_will_send: '将发简历',
  resume_sent: '已收简历',
  job_interest: '求职意向',
  job_status: '在招咨询',
  location: '地点',
  salary: '薪资',
  experience: '经验要求',
  education: '学历要求',
  responsibilities: '工作内容',
  general_job_consultation: '岗位咨询',
  clarification_required: '需澄清',
  interview_coordination: '面试协调',
  human_handoff: '转人工',
  true_off_topic: '无关话题',
  unrelated: '非招聘相关',
  sensitive: '敏感内容',
  uncertain: '无法判定',
  other_recruitment: '其他招聘相关',
  superseded: '已作废',
  // 结果分布：与后端 outcome 取值保持一致
  sent: '已发送',
  ready: '待发送',
  expected_silence: '正常静默',
  review_required: '待人工复核',
  shadow: '影子评测',
  failed: '处理失败',
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

// 「需要关注」区：待确认发送结果 + 待 HR 复核会话，两者共同构成行动入口
const attentionUnconfirmed = computed(() => qualitySummary.value?.unconfirmedSends ?? 0)
const attentionReview = computed(() => dutyReviewRequired.value.length)
const attentionTotal = computed(() => attentionUnconfirmed.value + attentionReview.value)
const reviewRequiredSection = ref<HTMLElement | null>(null)
const qualityDetailPanel = ref<HTMLDetailsElement | null>(null)

function revealUnconfirmedSends() {
  if (qualityDetailPanel.value) qualityDetailPanel.value.open = true
}

function revealReviewRequired() {
  reviewRequiredExpanded.value = true
  void nextTick(() => reviewRequiredSection.value?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
}

// 类别分布：把模型的原始细分类别归并为人可读的语义组，组内以词云呈现（字号表达量级）
const QUALITY_CATEGORY_GROUPS: { key: string; label: string; members: string[] }[] = [
  { key: 'intent', label: '求职意向', members: ['job_interest', 'resume_will_send', 'resume_sent', 'candidate_considering', 'candidate_decline', 'conversation_closing'] },
  { key: 'consult', label: '岗位咨询', members: ['salary', 'location', 'benefits', 'work_time', 'experience', 'education', 'responsibilities', 'job_status', 'general_job_consultation', 'clarification_required'] },
  { key: 'social', label: '社交寒暄', members: ['greeting', 'social_greeting', 'social_thanks', 'social_acknowledgement'] },
  { key: 'flow', label: '流程协作', members: ['interview_coordination', 'human_handoff', 'superseded'] },
  { key: 'review', label: '需人工判断', members: ['uncertain', 'true_off_topic', 'unrelated', 'sensitive', 'other_recruitment'] },
]

const categoryTotal = computed(() => Object.values(qualitySummary.value?.categories ?? {}).reduce((sum, count) => sum + count, 0))

// 类别分布：把模型的细分类别归并为 5 个语义组，避免把 19 个原始类别直接铺给 HR
const categoryRows = computed(() => {
  const categories = qualitySummary.value?.categories ?? {}
  const total = categoryTotal.value || 1
  const buckets = QUALITY_CATEGORY_GROUPS.map(group => ({ key: group.key, label: group.label, members: group.members, count: 0 }))
  const fallback = { key: 'fallback', label: '其他', members: [] as string[], count: 0 }
  for (const [raw, count] of Object.entries(categories)) {
    const normalized = raw.toLowerCase().replace(/[\s-]+/g, '_')
    const bucket = buckets.find(group => group.members.includes(normalized)) ?? fallback
    bucket.count += count
  }
  return [...buckets, fallback]
    .filter(row => row.count > 0)
    .sort((a, b) => b.count - a.count)
    .map(row => ({ key: row.key, label: row.label, count: row.count, pct: Math.round((row.count / total) * 100) }))
})

const outcomeTotal = computed(() => Object.values(qualitySummary.value?.outcomes ?? {}).reduce((sum, count) => sum + count, 0))
const outcomeRows = computed(() => {
  const outcomes = qualitySummary.value?.outcomes ?? {}
  const total = outcomeTotal.value || 1
  return Object.entries(outcomes)
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({ key, label: qualityLabel(key), count, pct: Math.round((count / total) * 100) }))
})

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
  if(event.sendStatus==='SKIPPED' && event.detail?.startsWith('正常静默：'))return {label:'正常静默',tone:'neutral' as const}
  if(event.sendStatus==='SKIPPED')return {label:'已安全跳过',tone:'neutral' as const}
  return {label:'等待处理',tone:'neutral' as const}
}

function dutyEventTime(event:AiDutyEvent){return event.completedAt||event.updatedAt}

async function locateBossConversation(item:AiDutyReviewRequired){
  if (locatingObservationId.value) return
  locatingObservationId.value = item.observationId
  try {
    await ensureCsrf()
    const { data } = await api.post<{ reason?: string }>(`/local-connector/observations/${item.observationId}/locate`)
    ElMessage.success(data?.reason || '定位请求已发送，请稍候')
  } catch (e) {
    ElMessage.error(apiErrorMessage(e, 'BOSS 会话定位失败，请确认扩展已配对'))
  } finally {
    locatingObservationId.value = null
  }
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
      <div></div>
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
        </div>
      </section>

      <section v-if="qualitySummary" class="quality-strip" aria-labelledby="quality-strip-title">
        <div class="quality-strip__head">
          <h2 id="quality-strip-title">AI 回复质量</h2>
          <span class="quality-strip__period">过去 24 小时</span>
          <span v-if="qualitySummary.shadowEvaluated" class="quality-strip__shadow">影子评测 {{ qualitySummary.shadowEvaluated }}</span>
        </div>
        <div class="quality-metrics">
          <span class="quality-metric"><b>{{ qualitySummary.evaluated ?? 0 }}</b>24h 决策</span>
          <span class="quality-metric"><b>{{ qualitySummary.sent ?? 0 }}</b>已发送</span>
          <span class="quality-metric"><b>{{ qualitySummary.reviewRequired ?? 0 }}</b>待人工</span>
          <span v-if="qualitySummary.unconfirmedSends" class="quality-metric quality-metric--alert"><b>{{ qualitySummary.unconfirmedSends }}</b>待确认</span>
          <span v-if="qualitySummary.failed" class="quality-metric quality-metric--alert"><b>{{ qualitySummary.failed }}</b>失败</span>
          <span class="quality-metric"><b>{{ confPct }}%</b>置信度</span>
        </div>
        <div v-if="funnelSegments.length" class="quality-funnel" role="img" :aria-label="funnelSummary">
          <div class="quality-funnel__track">
            <span
              v-for="seg in funnelSegments"
              :key="seg.key"
              class="quality-funnel__seg"
              :class="`quality-funnel__seg--${seg.key}`"
              :style="{ width: seg.pct + '%' }"
              :title="`${seg.label} ${seg.value}`"
              aria-hidden="true"
            ></span>
          </div>
        </div>
        <p v-else class="quality-strip__empty">近 24 小时暂无 AI 决策记录</p>
        <div id="attention-panel" class="quality-strip__foot">
          <span v-if="attentionTotal" class="quality-strip__attention">需要关注 <b>{{ attentionTotal }}</b></span>
          <span v-else class="quality-strip__clear">近 24 小时无需人工介入</span>
          <button v-if="attentionUnconfirmed" type="button" class="quality-strip__action" @click="revealUnconfirmedSends">发送结果未确认 {{ attentionUnconfirmed }}</button>
          <button v-if="attentionReview" type="button" class="quality-strip__action" @click="revealReviewRequired">待复核会话 {{ attentionReview }}</button>
        </div>
        <details ref="qualityDetailPanel" v-if="categoryRows.length || outcomeRows.length" class="quality-strip__detail">
          <summary class="quality-strip__detail-toggle">分类与结果明细</summary>
          <div class="quality-detail-grid">
            <div v-if="categoryRows.length" class="quality-detail-col">
              <h3>类别分布 · 共 {{ categoryTotal }} 条</h3>
              <div v-for="row in categoryRows" :key="row.key" class="quality-detail-row">
                <span class="quality-detail-row__name">{{ row.label }}</span>
                <span class="quality-detail-row__track"><i :style="{ width: row.pct + '%' }"></i></span>
                <b class="quality-detail-row__num">{{ row.count }}</b>
              </div>
            </div>
            <div v-if="outcomeRows.length" class="quality-detail-col">
              <h3>结果分布 · 共 {{ outcomeTotal }} 条</h3>
              <div v-for="row in outcomeRows" :key="row.key" class="quality-detail-row">
                <span class="quality-detail-row__name">{{ row.label }}</span>
                <span class="quality-detail-row__track"><i :style="{ width: row.pct + '%' }"></i></span>
                <b class="quality-detail-row__num">{{ row.count }}</b>
              </div>
            </div>
          </div>
        </details>
      </section>
      <section v-else-if="loading" class="quality-strip quality-strip--loading" aria-hidden="true">
        <span class="quality-strip__skeleton-line"></span>
        <span class="quality-strip__skeleton-bar"></span>
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
              <p>展示最近 7 天 AI 处理过的全部消息，包括成功、静默、失败和重试。</p>
            </div>
            <div class="duty-review__header-right">
              <span class="duty-review__count"><b>{{ dutyReplies.length }}</b> 条已处理</span>
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
                  <p v-if="reply.messageText" class="duty-reply-item__incoming">候选人：{{ reply.messageText }}</p>
                  <p class="duty-reply-item__reason">{{ dutyEventState(reply).label }} · {{ reply.detail || '暂无处理原因' }}</p>
                  <p v-if="reply.replyContent" class="duty-reply-item__outgoing">回复：{{ reply.replyContent }}</p>
                </div>
              </button>
            </div>
          </div>
        </section>

        <section ref="reviewRequiredSection" class="card-panel duty-review duty-review--required" aria-labelledby="duty-review-required-title">
          <header class="duty-review__header">
            <div>
              <button
                class="duty-review__toggle"
                :class="{ 'duty-review__toggle--open': reviewRequiredExpanded }"
                @click="reviewRequiredExpanded = !reviewRequiredExpanded"
                aria-label="展开/折叠已读未回复"
              ><span class="duty-review__eyebrow">过去 24 小时</span></button>
              <h2 id="duty-review-required-title">已读未回复 · 待 HR 复核</h2>
              <p>收录收到简历、面试协商、无关或敏感内容、含义不清及事实校验未通过的会话。</p>
            </div>
            <div class="duty-review__header-right">
              <span class="duty-review__count duty-review__count--warning"><b>{{ dutyReviewRequired.length }}</b> 条待复核</span>
            </div>
          </header>
          <div v-show="reviewRequiredExpanded" class="duty-review__body">
            <AsyncState v-if="!dutyReviewRequired.length" state="empty" embedded title="暂无待跟进会话" message="收到简历或 AI 安全跳过的会话会出现在这里。">
              <template #icon><el-icon><CircleCheck /></el-icon></template>
            </AsyncState>
            <div v-else ref="dutyReviewRequiredListRef" class="duty-review__vertical-list">
              <article v-for="item in dutyReviewRequired" :key="item.id" class="duty-reply-item duty-reply-item--required">
                <span class="duty-reply-item__status followup"></span>
                <div class="duty-reply-item__content">
                  <div class="duty-reply-item__header">
                    <strong>{{ item.candidateName || `匿名求职者 ${item.anonymousKey}` }}</strong>
                    <time :datetime="item.decidedAt">{{ new Date(item.decidedAt).toLocaleTimeString('zh-CN', { hour:'2-digit', minute:'2-digit' }) }}</time>
                  </div>
                  <small>{{ item.jobTitle }} · {{ item.accountName }}</small>
                  <span v-if="item.resumeReceived" class="duty-reply-item__resume-tag">已收到简历<span v-if="item.resumePipelineStatus"> · {{ item.resumePipelineStatus === 'SUCCEEDED' ? '已入库' : item.resumePipelineStatus === 'FAILED' ? '分析失败' : '待处理' }}</span></span>
                  <p v-if="item.incomingMessage" class="duty-reply-item__incoming">候选人：{{ item.incomingMessage }}</p>
                  <p>{{ item.reason }}</p>
                  <div class="duty-reply-item__actions">
                    <em class="duty-reply-item__note">{{ item.resumeReceived ? '简历会话，待 HR 跟进' : 'AI 未回复，需人工判断' }}</em>
                    <button class="duty-reply-item__locate" type="button" :disabled="locatingObservationId === item.observationId" @click.stop="locateBossConversation(item)" :aria-label="`定位 ${item.candidateName || '该候选人'} 的 BOSS 会话`">
                      <el-icon><Location /></el-icon>
                      {{ locatingObservationId === item.observationId ? '定位中…' : '定位 BOSS 会话' }}
                    </button>
                  </div>
                </div>
              </article>
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

/* ═══ AI 回复质量（摘要数字 + 漏斗 + 明细表） ═══
   字号仅 4 档：20 / 13 / 12 / 11
   间距仅 4 档：4 / 8 / 12 / 16
   文字色仅 3 种：正文、次要、危险（折叠开关用主色） */
.quality-strip {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
  padding: 16px 18px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-panel);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}
.quality-strip__head { display: flex; align-items: baseline; gap: 8px; }
.quality-strip__head h2 { margin: 0; color: var(--text-primary); font-size: 13px; font-weight: 600; }
.quality-strip__period { color: var(--text-secondary); font-size: 11px; }
.quality-strip__shadow { margin-left: auto; color: var(--text-secondary); font-size: 11px; }

/* 指标胶囊：与顶部仪表条的 .metric-pill 同规范 */
.quality-metrics { display: flex; flex-wrap: wrap; gap: 8px; }
.quality-metric { display: inline-flex; align-items: baseline; gap: 4px; min-height: 32px; padding: 5px 13px; border: 1px solid var(--border-subtle); border-radius: var(--radius-pill); background: var(--surface-soft); color: var(--text-secondary); font-size: 12px; }
.quality-metric b { color: var(--text-primary); font-size: 20px; font-weight: 700; line-height: 1; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.quality-metric--alert { border-color: var(--border-rose); background: var(--surface-rose); }
.quality-metric--alert b { color: var(--danger); }

.quality-funnel { min-width: 0; }
.quality-funnel__track { display: flex; height: 8px; padding: 2px; box-sizing: border-box; border: 1px solid var(--border-subtle); border-radius: var(--radius-pill); overflow: hidden; background: var(--surface-muted); }
.quality-funnel__seg { display: block; flex: 0 0 auto; min-width: 0; height: 100%; transition: width .4s cubic-bezier(.16,1,.3,1); }
.quality-funnel__seg + .quality-funnel__seg { box-shadow: inset 1px 0 rgba(255,255,255,.5); }
.quality-funnel__seg--sent { background: var(--success); }
.quality-funnel__seg--unconfirmed { background: var(--danger); }
.quality-funnel__seg--review { background: var(--warning); }
.quality-funnel__seg--silence { background: var(--text-tertiary); }
.quality-funnel__seg--failed { background: var(--danger); }
.quality-funnel__seg--other { background: var(--border-strong); }
.quality-strip__empty { margin: 0; color: var(--text-secondary); font-size: 12px; }

/* 关注行：一行文字 + 可点胶囊（同时作为 /candidates 落点 #attention-panel） */
.quality-strip__foot { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.quality-strip__attention { color: var(--text-secondary); font-size: 12px; }
.quality-strip__attention b { margin-left: 4px; color: var(--danger); font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; }
.quality-strip__clear { color: var(--text-secondary); font-size: 12px; }
.quality-strip__action { padding: 4px 12px; border: 1px solid var(--border-subtle); border-radius: var(--radius-pill); background: var(--surface); color: var(--text-primary); font-size: 12px; cursor: pointer; transition: background var(--transition-fast), border-color var(--transition-fast); }
.quality-strip__action:hover { border-color: var(--border); background: var(--surface-row); }
.quality-strip__action:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 1px; }

/* ── 加载骨架：形状与最终布局一致，避免数据到达时跳动 ── */
.quality-strip--loading { gap: 12px; }
.quality-strip__skeleton-line,
.quality-strip__skeleton-bar {
  display: block;
  border-radius: var(--radius-control);
  background: linear-gradient(90deg, var(--surface-muted) 25%, var(--surface-soft) 50%, var(--surface-muted) 75%);
  background-size: 200% 100%;
  animation: quality-skeleton 1.4s ease-in-out infinite;
}
.quality-strip__skeleton-line { flex: 0 0 auto; width: 112px; height: 34px; }
.quality-strip__skeleton-bar { flex: 1; min-width: 0; height: 46px; }
@keyframes quality-skeleton {
  from { background-position: 200% 0; }
  to { background-position: -200% 0; }
}

.quality-strip__detail { margin-top: 0; }
.quality-strip__detail-toggle { display: inline-flex; align-items: center; gap: 4px; padding: 4px 0; border: 0; background: none; color: var(--primary); font-size: 12px; cursor: pointer; list-style: none; }
.quality-strip__detail-toggle::before { content: ''; display: inline-block; width: 0; height: 0; border-left: 4px solid transparent; border-right: 4px solid transparent; border-top: 5px solid currentColor; transition: transform .2s ease; }
.quality-strip__detail[open] .quality-strip__detail-toggle::before { transform: rotate(180deg); }
.quality-detail-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-top: 8px; padding: 12px 14px; border-radius: var(--radius-control); background: var(--surface-soft); }
.quality-detail-col h3 { margin: 0 0 8px; color: var(--text-secondary); font-size: 12px; font-weight: 600; }
.quality-detail-row { display: grid; grid-template-columns: minmax(0, 88px) minmax(0, 1fr) 32px; gap: 8px; align-items: center; margin-bottom: 4px; }
.quality-detail-row__name { overflow: hidden; color: var(--text-secondary); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.quality-detail-row__track { height: 6px; border-radius: 3px; background: var(--border-subtle); overflow: hidden; }
.quality-detail-row__track i { display: block; height: 100%; border-radius: 3px; background: var(--primary); }
.quality-detail-row__num { color: var(--text-primary); font-size: 12px; font-weight: 700; text-align: right; font-variant-numeric: tabular-nums; }

@media (max-width: 560px) {
  .quality-strip { gap: 8px; padding: 12px; }
  .quality-detail-grid { grid-template-columns: 1fr; }
  .quality-strip__shadow { margin-left: 0; }
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

.duty-review { margin-bottom:14px; padding:0; overflow:hidden; }
.duty-review__header { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:14px 18px; border-bottom:2px solid transparent; border-image:linear-gradient(90deg, transparent, var(--border-subtle) 15%, var(--border-subtle) 85%, transparent) 1; background:linear-gradient(180deg, rgba(255,255,255,.64), transparent); }
.duty-review__header h2 { margin:0; font-size:15px; }
.duty-review__header p { margin:3px 0 0; color:var(--text-secondary); font-size:12px; }
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
  gap: 12px;
  padding: 12px 20px;
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
  padding-left: 24px;
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
  margin-bottom: 3px;
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
  margin-bottom: 4px;
  opacity: 0.8;
}

.duty-reply-item__content p {
  font-size: 13px;
  color: var(--text-primary);
  line-height: 1.5;
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
  opacity: 0.9;
}

.duty-reply-item__incoming {
  color: var(--text-secondary) !important;
}

.duty-reply-item--required {
  cursor: default;
}

.duty-reply-item--required:hover {
  padding-left: 20px;
}

.duty-reply-item__resume-tag {
  display: inline-flex;
  align-items: center;
  margin: 3px 0 4px;
  padding: 2px 7px;
  border: 1px solid color-mix(in srgb, var(--success) 34%, transparent);
  border-radius: 999px;
  color: var(--success);
  background: color-mix(in srgb, var(--success) 9%, transparent);
  font-size: 11px;
  font-weight: 700;
}

.duty-reply-item__reason {
  margin-top: 6px !important;
  color: var(--text-tertiary) !important;
  font-size: 12px !important;
}

.duty-reply-item__outgoing {
  margin-top: 6px !important;
  color: var(--primary) !important;
}

.duty-reply-item__note {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
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

.duty-reply-item__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 6px;
}

.duty-reply-item__actions .duty-reply-item__note {
  margin-top: 0;
}

.duty-reply-item__locate {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  padding: 5px 9px;
  border: 1px solid color-mix(in srgb, var(--primary) 28%, var(--border));
  border-radius: 6px;
  background: var(--surface);
  color: var(--primary);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  transition: background var(--transition-fast), border-color var(--transition-fast), opacity var(--transition-fast);
}

.duty-reply-item__locate:hover:not(:disabled) {
  border-color: var(--primary);
  background: color-mix(in srgb, var(--primary) 8%, var(--surface));
}

.duty-reply-item__locate:disabled {
  cursor: wait;
  opacity: .6;
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

.duty-review__header { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:14px 18px; border-bottom:2px solid transparent; border-image:linear-gradient(90deg, transparent, var(--border-subtle) 15%, var(--border-subtle) 85%, transparent) 1; background:linear-gradient(180deg, rgba(255,255,255,.64), transparent); }
.duty-review__header h2 { margin:0; font-size:15px; }
.duty-review__header p { margin:3px 0 0; color:var(--text-secondary); font-size:12px; }
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
:root[data-theme="dark"] .quality-metric { background: var(--surface-muted); }
:root[data-theme="dark"] .quality-metric--alert { background: color-mix(in srgb, var(--surface-rose) 82%, var(--surface-raised)); }
:root[data-theme="dark"] .quality-strip__action { background: var(--surface-raised); }
:root[data-theme="dark"] .quality-strip__action:hover { background: var(--surface-row); }
:root[data-theme="dark"] .quality-funnel__seg--sent { background: color-mix(in srgb, var(--success) 72%, var(--surface-page)); }
:root[data-theme="dark"] .quality-funnel__seg--unconfirmed { background: color-mix(in srgb, var(--danger) 68%, var(--surface-page)); }
:root[data-theme="dark"] .quality-funnel__seg--review { background: color-mix(in srgb, var(--warning) 72%, var(--surface-page)); }
:root[data-theme="dark"] .quality-funnel__seg--silence { background: color-mix(in srgb, var(--text-tertiary) 58%, var(--surface-page)); }
:root[data-theme="dark"] .quality-funnel__seg--failed { background: color-mix(in srgb, var(--danger) 72%, var(--surface-page)); }
:root[data-theme="dark"] .quality-funnel__seg--other { background: color-mix(in srgb, var(--border-strong) 58%, var(--surface-page)); }
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
  .quality-strip__skeleton-line,
  .quality-strip__skeleton-bar { animation: none; }
  .quality-strip__action { transition: none; }
  .quality-funnel__seg { transition: none; }
  .detail-fade-enter-active,
  .detail-fade-leave-active { transition: none; }
}
</style>
