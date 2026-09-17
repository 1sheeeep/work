<script setup lang="ts">
import PageHeader from '../components/PageHeader.vue'
import AsyncState from '../components/AsyncState.vue'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, Calendar, ChatDotRound, Clock, Close, InfoFilled, Location, Refresh, Search } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api, apiErrorMessage, ensureCsrf } from '../services/api'
import { useNotificationCenter } from '../composables/useNotificationCenter'
import type { AiDutyConversationTimeline, AiDutyEvent, AiDutyReviewRequired, AiReplyQualitySummary, AutoReplyPolicy, BrowserDevice, BrowserUnreadObservation, ConversationMessage } from '../types'

const router = useRouter(); const notify = useNotificationCenter(); const loading = ref(true); const switching = ref(false); const loadError = ref('')
const policies = ref<AutoReplyPolicy[]>([]); const devices = ref<BrowserDevice[]>([]); const observations = ref<BrowserUnreadObservation[]>([])
const dutyReplies = ref<AiDutyEvent[]>([])
const dutyReviewRequired = ref<AiDutyReviewRequired[]>([])
const locatingObservationId = ref<string | null>(null)
const qualitySummary = ref<AiReplyQualitySummary | null>(null)
const lastRefreshed = ref<Date | null>(null); const refreshTick = ref(0); const autoRefreshEnabled = ref(true); const refreshIntervalSec = ref(15)
const partialRefreshWarning = ref('')
const noticeDismissed = ref(false); const liveMessage = ref('')
let noticeTimer: ReturnType<typeof setTimeout> | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let loadRequestId = 0

type DutySessionFilter = 'ALL' | 'SUCCESS' | 'SILENT' | 'FAILED' | 'REVIEW' | 'PROCESSING' | 'UNREAD'
type DutySessionState = 'SUCCESS' | 'REVIEW' | 'PROCESSING' | 'UNREAD'
interface DutySession {
  observationId: string
  anonymousKey: string
  accountName: string
  jobTitle: string
  latestAt: string
  unread: boolean
  unreadCount: number
  state: DutySessionState
  category?: string
  messageText?: string
  replyContent?: string
  detail?: string
  attemptCount: number
  resumeReceived?: boolean
  event?: AiDutyEvent
  review?: AiDutyReviewRequired
  observation?: BrowserUnreadObservation
}

const dutyFilterOptions: Array<[DutySessionFilter, string]> = [
  ['ALL', '全部'],
  ['SUCCESS', '已回复'],
  ['SILENT', '静默处理'],
  ['FAILED', '失败'],
  ['REVIEW', '待复核'],
  ['PROCESSING', '处理中'],
  ['UNREAD', '未读'],
]

function recentDateRange(days: number): [Date, Date] {
  const end = new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - Math.max(0, days - 1))
  start.setHours(0, 0, 0, 0)
  return [start, end]
}

const dutyDateRange = ref<[Date, Date]>(recentDateRange(7))
const dutyDateShortcuts = [
  { text: '今天', value: () => recentDateRange(1) },
  { text: '最近 7 天', value: () => recentDateRange(7) },
  { text: '最近 30 天', value: () => recentDateRange(30) },
  { text: '最近 90 天', value: () => recentDateRange(90) },
]

const dutyDateQuery = computed(() => {
  const [startValue, endValue] = dutyDateRange.value
  const start = new Date(startValue)
  start.setHours(0, 0, 0, 0)
  const end = new Date(endValue)
  end.setHours(0, 0, 0, 0)
  end.setDate(end.getDate() + 1)
  return { from: start.toISOString(), to: end.toISOString() }
})
function isInDutyDateRange(value?: string): boolean {
  const at = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(at) && at >= Date.parse(dutyDateQuery.value.from) && at < Date.parse(dutyDateQuery.value.to)
}

const dutyDateRangeLabel = computed(() => {
  const [startValue, endValue] = dutyDateRange.value
  const start = new Date(startValue)
  const end = new Date(endValue)
  const today = new Date()
  const sameDay = start.toDateString() === end.toDateString()
  if (sameDay && end.toDateString() === today.toDateString()) return '今天'
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate())
  const days = Math.round((endDay.getTime() - startDay.getTime()) / 86_400_000) + 1
  if (end.toDateString() === today.toDateString() && [7, 30, 90].includes(days)) return `最近 ${days} 天`
  const format = (value: Date) => `${value.getMonth() + 1}月${value.getDate()}日`
  return `${format(start)} - ${format(end)}`
})

const disableFutureDutyDate = (date: Date) => date.getTime() > new Date().setHours(23, 59, 59, 999)

const refreshAgo = computed(() => { 
  if (!lastRefreshed.value) return '尚未完整刷新'
  const s = Math.floor((Date.now() - lastRefreshed.value.getTime()) / 1000)
  if (s < 10) return '刚刚'
  if (s < 60) return `${s} 秒前`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} 分钟前`
  return `${Math.floor(m / 60)} 小时前` 
})
const refreshIsStale = computed(() => !lastRefreshed.value || Date.now() - lastRefreshed.value.getTime() >= 60_000)

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
const successfulDutyReplies = computed(() => dutyReplies.value.filter(event => event.sendStatus === 'SUCCEEDED'))
const reviewItemCount = computed(() => dutyReplies.value.filter(event => event.sendStatus !== 'SUCCEEDED').length + dutyReviewRequired.value.filter(item => !dutyReplies.value.some(event => event.observationId === item.observationId)).length)
const attentionUnconfirmed = computed(() => qualitySummary.value?.unconfirmedSends ?? 0)
const attentionReview = computed(() => reviewItemCount.value)
const attentionTotal = computed(() => attentionUnconfirmed.value + attentionReview.value)
const dutySessionSearch = ref('')
const dutySessionFilter = ref<DutySessionFilter>('ALL')
const dutyJobFilter = ref('')
const selectedDutySessionId = ref<string | null>(null)
const dutyContextOpen = ref(true)
const mobileDutyDetailOpen = ref(false)
const dutySessionSearchInput = ref<HTMLInputElement | null>(null)
const dutyTimelineCache = ref<Record<string, AiDutyConversationTimeline>>({})
const dutyTimelineLoading = ref<string | null>(null)
const dutyTimelineErrors = ref<Record<string, string>>({})

function dutyTimestamp(value?: string): number { return value ? Date.parse(value) || 0 : 0 }
function dutyTimeLabel(value?: string): string {
  const date = value ? new Date(value) : null
  return date && Number.isFinite(date.getTime()) ? date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '暂无时间'
}
function dutyTimelineDay(value?: string): string {
  const date = value ? new Date(value) : null
  return date && Number.isFinite(date.getTime())
    ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` : ''
}
function dutyTimelineDayLabel(value?: string): string {
  const date = value ? new Date(value) : null
  return date && Number.isFinite(date.getTime())
    ? date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }) : ''
}
function sessionState(event?: AiDutyEvent, review?: AiDutyReviewRequired, observation?: BrowserUnreadObservation): DutySessionState {
  if (event?.sendStatus === 'SUCCEEDED') return 'SUCCESS'
  if (event && (event.sendStatus === 'FAILED' || event.sendStatus === 'UNKNOWN' || event.sendStatus === 'SKIPPED')) return 'REVIEW'
  if (event && ['QUEUED', 'PROCESSING', 'RETRY_WAIT'].includes(event.taskStatus)) return 'PROCESSING'
  if (review || observation?.unread) return 'REVIEW'
  return 'UNREAD'
}
function sessionStateLabel(state: DutySessionState): string {
  return state === 'SUCCESS' ? '已回复' : state === 'REVIEW' ? '待复核' : state === 'PROCESSING' ? '处理中' : '未读'
}
function sessionStateTone(state: DutySessionState): 'success' | 'warning' | 'info' | 'neutral' {
  return state === 'SUCCESS' ? 'success' : state === 'REVIEW' ? 'warning' : state === 'PROCESSING' ? 'info' : 'neutral'
}

type DutyOutcome = 'SUCCESS' | 'SILENT' | 'FAILED' | 'REVIEW' | 'PROCESSING' | 'UNREAD'
function dutyOutcome(session: Pick<DutySession, 'event' | 'review' | 'observation' | 'detail'>): DutyOutcome {
  const event = session.event
  if (event?.sendStatus === 'SUCCEEDED') return 'SUCCESS'
  if (event?.sendStatus === 'FAILED' || event?.sendStatus === 'UNKNOWN') return 'FAILED'
  if (event?.sendStatus === 'SKIPPED') {
    if (session.review) return 'REVIEW'
    if (event.dispositionCode) return event.dispositionCode === 'EXPECTED_SILENCE' ? 'SILENT' : 'REVIEW'
    const detail = `${session.detail || ''} ${event.detail || ''}`
    return /安全作废|保持静默|正常静默|无需回复|已由 HR 处理|已处理/.test(detail) ? 'SILENT' : 'REVIEW'
  }
  if (event && ['QUEUED', 'PROCESSING', 'RETRY_WAIT'].includes(event.taskStatus)) return 'PROCESSING'
  if (session.review || session.observation?.unread) return 'REVIEW'
  return 'UNREAD'
}
function dutyOutcomeLabel(session: Pick<DutySession, 'event' | 'review' | 'observation' | 'detail'>): string {
  const labels: Record<DutyOutcome, string> = { SUCCESS: '已回复', SILENT: '静默处理', FAILED: '失败', REVIEW: '待复核', PROCESSING: 'AI 处理中', UNREAD: '待处理' }
  if (dutyOutcome(session) === 'PROCESSING') {
    const seconds = processingElapsedSeconds(session)
    const phase = session.event?.taskStatus === 'QUEUED' ? '排队中' : session.event?.taskStatus === 'RETRY_WAIT' ? '等待重试' : 'AI 处理中'
    return `${phase} ${formatProcessingDuration(seconds)}${seconds >= 90 ? ' · 已超时' : ''}`
  }
  const dispositionLabels: Record<string, string> = {
    EXPECTED_SILENCE: '正常静默', INTERVIEW_HR: '面试交 HR', FACT_UNVERIFIED: '岗位事实待核实',
    MODEL_FAILED_RETRYABLE: '模型失败待复核', MODEL_FAILED_FINAL: '模型失败待 HR',
    MODEL_INVALID_RETRYABLE: '模型结果待重试', SEND_UNCONFIRMED: '发送待确认',
    SEND_FAILED_RETRYABLE: '发送失败待复核', SEND_FAILED_FINAL: '发送失败待 HR',
    STALE_CONTEXT: '旧任务已作废', OFF_TOPIC: '岗位无关已跳过', SAFETY_BLOCKED: '安全拦截待 HR',
  }
  if (session.event?.dispositionCode && dispositionLabels[session.event.dispositionCode]) {
    return dispositionLabels[session.event.dispositionCode]
  }
  return labels[dutyOutcome(session)]
}
function dutyOutcomeTone(session: Pick<DutySession, 'event' | 'review' | 'observation' | 'detail'>): 'success' | 'neutral' | 'danger' | 'warning' | 'info' {
  const tones: Record<DutyOutcome, 'success' | 'neutral' | 'danger' | 'warning' | 'info'> = { SUCCESS: 'success', SILENT: 'neutral', FAILED: 'danger', REVIEW: 'warning', PROCESSING: 'info', UNREAD: 'neutral' }
  if (dutyOutcome(session) === 'PROCESSING') return processingElapsedSeconds(session) >= 90 ? 'danger' : processingElapsedSeconds(session) >= 60 ? 'warning' : 'info'
  return tones[dutyOutcome(session)]
}
function processingElapsedSeconds(session: Pick<DutySession, 'event'>): number {
  refreshTick.value
  const startedAt = session.event?.processingStartedAt || session.event?.createdAt
  if (!startedAt) return 0
  return Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000))
}
function formatProcessingDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}秒`
  const minutes = Math.floor(seconds / 60)
  return seconds < 3600 ? `${minutes}分${seconds % 60}秒` : `${Math.floor(minutes / 60)}时${minutes % 60}分`
}
function matchesDutyFilter(session: DutySession): boolean {
  return dutySessionFilter.value === 'ALL' || dutyOutcome(session) === dutySessionFilter.value
}

const dutySessions = computed<DutySession[]>(() => {
  const observationsById = new Map(observations.value.map(item => [item.id, item]))
  const grouped = new Map<string, DutySession>()
  const ensure = (observationId: string, base: Partial<DutySession>) => {
    const safeObservationId = String(observationId || 'unknown')
    const observation = observationsById.get(observationId)
    const current = grouped.get(observationId)
    if (current) return current
    const created: DutySession = {
      observationId: safeObservationId, anonymousKey: base.anonymousKey || observation?.anonymousKey || `会话 ${safeObservationId.slice(0, 8)}`,
      accountName: base.accountName || observation?.accountName || '招聘账号',
      jobTitle: base.jobTitle || observation?.observedJobTitle || '未识别岗位',
      latestAt: base.latestAt || observation?.latestMessageAt || observation?.lastSeenAt || observation?.firstSeenAt || new Date().toISOString(),
      unread: Boolean(observation?.unread), unreadCount: observation?.unreadCount || 0,
      state: base.state || sessionState(undefined, undefined, observation), category: base.category,
      messageText: base.messageText, replyContent: base.replyContent, detail: base.detail,
      attemptCount: base.attemptCount || 0, resumeReceived: Boolean(base.resumeReceived || observation?.conversationSignals?.resumeReceived), observation,
    }
    grouped.set(observationId, created)
    return created
  }
  for (const event of dutyReplies.value) {
    const session = ensure(event.observationId, { anonymousKey: event.anonymousKey, accountName: event.accountName, jobTitle: event.jobTitle })
    if (!session.event || dutyTimestamp(dutyEventTime(event)) >= dutyTimestamp(dutyEventTime(session.event))) {
      session.event = event; session.latestAt = dutyEventTime(event) || session.latestAt; session.state = sessionState(event, session.review, session.observation)
      session.category = event.category; session.messageText = event.messageText; session.replyContent = event.replyContent; session.detail = event.detail; session.attemptCount = event.attemptCount
    }
  }
  for (const review of dutyReviewRequired.value) {
    const session = ensure(review.observationId, { anonymousKey: review.anonymousKey, accountName: review.accountName, jobTitle: review.jobTitle, latestAt: review.decidedAt })
    session.review = review
    session.resumeReceived = Boolean(review.resumeReceived || session.resumeReceived)
    if (!session.event || dutyTimestamp(review.decidedAt) >= dutyTimestamp(session.latestAt)) {
      session.latestAt = review.decidedAt; session.state = sessionState(session.event, review, session.observation); session.category = review.category
      session.messageText = review.incomingMessage || session.messageText; session.detail = review.reason; session.attemptCount = session.attemptCount || 1
    }
  }
  for (const observation of observations.value) {
    if (!observation.unread && observation.latestDirection !== 'INBOUND') continue
    // lastSeenAt changes on every scan, even when the actual message is days old.
    if (!isInDutyDateRange(observation.latestMessageAt)) continue
    ensure(observation.id, { state: sessionState(undefined, undefined, observation) })
  }
  const query = dutySessionSearch.value.trim().toLowerCase()
  return [...grouped.values()]
    .filter(matchesDutyFilter)
    .filter(session => !dutyJobFilter.value || session.jobTitle === dutyJobFilter.value)
    .filter(session => !query || [session.anonymousKey, session.accountName, session.jobTitle, session.messageText].some(value => value?.toLowerCase().includes(query)))
    .sort((a, b) => dutyTimestamp(b.latestAt) - dutyTimestamp(a.latestAt))
})

const selectedDutySession = computed(() => dutySessions.value.find(item => item.observationId === selectedDutySessionId.value) || dutySessions.value[0] || null)
type DutyTimelineRow = { id: string; kind: 'candidate' | 'ai' | 'status'; label: string; content: string; at?: string; tone?: string; deliveryStatus?: string }

function timelineMessageRow(sessionId: string, message: ConversationMessage): DutyTimelineRow {
  const candidate = message.direction === 'INBOUND' || message.senderType === 'CANDIDATE'
  const label = message.senderType === 'AI' ? 'AI 回复' : message.senderType === 'HR' ? 'HR' : message.senderType === 'SYSTEM' ? '系统' : '候选人'
  const at = message.senderType === 'AI' && message.deliveryStatus === 'SENT'
    ? message.approvedAt || message.createdAt : message.createdAt
  return { id: `${sessionId}-${message.id}`, kind: candidate ? 'candidate' : message.senderType === 'SYSTEM' ? 'status' : 'ai', label, content: cleanConversationDisplayText(message.content), at, deliveryStatus: message.deliveryStatus }
}

function cleanConversationDisplayText(value?: string) {
  return String(value || '').replace(/(?:^|[\s|｜·•])(?:已?送达|已读|未读|发送中|发送失败|发送成功)(?=$|[\s|｜·•])/g, ' ').replace(/\s{2,}/g, ' ').trim()
}

/** 前端最后一道展示幂等保护：历史导入可能因摘要变化产生重复气泡。 */
function deduplicateDutyTimelineRows(rows: DutyTimelineRow[]): DutyTimelineRow[] {
  const seen = new Set<string>()
  return rows.filter(row => {
    const minute = row.at && Number.isFinite(Date.parse(row.at)) ? Math.floor(Date.parse(row.at) / 60_000) : 'unknown'
    const key = `${row.kind}|${minute}|${cleanConversationDisplayText(row.content)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const selectedDutyTimeline = computed<DutyTimelineRow[]>(() => {
  const session = selectedDutySession.value
  if (!session) return []
  const imported = dutyTimelineCache.value[session.observationId]
  const rows: DutyTimelineRow[] = imported?.available
    ? imported.messages.map(message => timelineMessageRow(session.observationId, message))
    : []
  const contains = (kind: DutyTimelineRow['kind'], content: string, at?: string) => rows.some(row => {
    if (row.kind !== kind || row.content.trim() !== cleanConversationDisplayText(content)) return false
    const left = at ? Date.parse(at) : Number.NaN
    const right = row.at ? Date.parse(row.at) : Number.NaN
    return !Number.isFinite(left) || !Number.isFinite(right) || Math.abs(left - right) <= 120_000
  })
  const candidateAt = session.event?.createdAt || session.review?.decidedAt
  if (session.messageText && !contains('candidate', session.messageText, candidateAt)) {
    rows.push({ id: `${session.observationId}-candidate-${session.event?.id || 'latest'}`, kind: 'candidate', label: '候选人', content: cleanConversationDisplayText(session.messageText), at: candidateAt })
  }
  const replyAt = session.event?.sendCompletedAt || session.event?.completedAt || session.event?.updatedAt
  if (session.replyContent && !contains('ai', session.replyContent, replyAt)) {
    const deliveryStatus = session.event?.sendStatus === 'SUCCEEDED' ? 'SENT'
      : session.event?.sendStatus === 'FAILED' ? 'FAILED' : 'PENDING_REVIEW'
    rows.push({ id: `${session.observationId}-ai-${session.event?.id || 'latest'}`, kind: 'ai', label: 'AI 回复', content: cleanConversationDisplayText(session.replyContent), at: replyAt, deliveryStatus })
  }
  if (session.detail && !session.replyContent) rows.push({ id: `${session.observationId}-status`, kind: 'status', label: sessionStateLabel(session.state), content: session.detail, at: session.latestAt, tone: sessionStateTone(session.state) })
  return deduplicateDutyTimelineRows(rows.sort((left, right) => {
    const leftAt = left.at ? Date.parse(left.at) : Number.MAX_SAFE_INTEGER
    const rightAt = right.at ? Date.parse(right.at) : Number.MAX_SAFE_INTEGER
    return leftAt - rightAt
  }))
})
function startsTimelineDay(rows: DutyTimelineRow[], index: number): boolean {
  const day = dutyTimelineDay(rows[index]?.at)
  return Boolean(day && (index === 0 || day !== dutyTimelineDay(rows[index - 1]?.at)))
}

watch(dutySessions, (sessions) => {
  if (!sessions.some(item => item.observationId === selectedDutySessionId.value)) selectedDutySessionId.value = sessions[0]?.observationId || null
}, { immediate: true })

async function loadDutyTimeline(observationId: string, refresh = false) {
  if (!observationId || (!refresh && dutyTimelineCache.value[observationId]) || dutyTimelineLoading.value === observationId) return
  dutyTimelineLoading.value = observationId
  try {
    const { data } = await api.get<AiDutyConversationTimeline>(`/local-connector/ai-duty-sessions/${observationId}/timeline`)
    dutyTimelineCache.value = { ...dutyTimelineCache.value, [observationId]: data }
    if (data.available) {
      const remaining = { ...dutyTimelineErrors.value }
      delete remaining[observationId]
      dutyTimelineErrors.value = remaining
    }
    if (!data.available && data.reason) dutyTimelineErrors.value = { ...dutyTimelineErrors.value, [observationId]: data.reason }
  } catch (error) {
    dutyTimelineErrors.value = { ...dutyTimelineErrors.value, [observationId]: apiErrorMessage(error, '完整沟通时间线暂时无法加载') }
  } finally {
    if (dutyTimelineLoading.value === observationId) dutyTimelineLoading.value = null
  }
}

watch(selectedDutySessionId, (observationId) => {
  if (observationId) void loadDutyTimeline(observationId)
}, { immediate: true })

function selectDutySession(session: DutySession) { selectedDutySessionId.value = session.observationId; dutyContextOpen.value = true; mobileDutyDetailOpen.value = true }
function timelineDeliveryLabel(status?: string) { return status === 'PENDING_REVIEW' ? '待发送确认' : status === 'FAILED' ? '发送失败' : status === 'REJECTED' ? '已拒绝' : '' }
function filterDutyByJob(jobTitle: string) { dutyJobFilter.value = jobTitle; dutySessionSearch.value = ''; dutySessionFilter.value = 'ALL' }
function clearDutyFilters() { dutySessionSearch.value = ''; dutyJobFilter.value = ''; dutySessionFilter.value = 'ALL' }
function showAllDutySessions() { clearDutyFilters(); void nextTick(() => dutySessionSearchInput.value?.focus()) }
function handleDutySessionKeydown(event: KeyboardEvent) {
  if (event.key === '/' && document.activeElement !== dutySessionSearchInput.value) { event.preventDefault(); dutySessionSearchInput.value?.focus(); return }
  if (event.key === 'Escape') { dutyContextOpen.value = false; mobileDutyDetailOpen.value = false; return }
  if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key) || !dutySessions.value.length) return
  const index = Math.max(0, dutySessions.value.findIndex(item => item.observationId === selectedDutySessionId.value))
  if (event.key === 'Enter') { event.preventDefault(); selectDutySession(dutySessions.value[index]); return }
  event.preventDefault(); const next = event.key === 'ArrowDown' ? Math.min(index + 1, dutySessions.value.length - 1) : Math.max(index - 1, 0); selectDutySession(dutySessions.value[next])
}

const qualityDetailPanel = ref<HTMLDetailsElement | null>(null)

function revealUnconfirmedSends() {
  if (qualityDetailPanel.value) qualityDetailPanel.value.open = true
}

function revealReviewRequired() {
  dutySessionFilter.value = 'REVIEW'
  void nextTick(() => document.querySelector('.duty-chat-workspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
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
  const requestId = ++loadRequestId
  if (!silent) { loading.value = true; loadError.value = '' }
  const previousReviewIds = new Set(dutyReviewRequired.value.map(x => x.id))
  const requestLabels = ['值守策略', '桥接设备', '未读会话', 'AI 处理记录', '待 HR 复核', '回复质量']
  try {
    const results = await Promise.allSettled([
      api.get<AutoReplyPolicy[]>('/auto-replies/policies'),
      api.get<BrowserDevice[]>('/local-connector/devices'),
      api.get<BrowserUnreadObservation[]>('/local-connector/observations'),
      api.get<AiDutyEvent[]>('/local-connector/ai-duty-events', { params: dutyDateQuery.value }),
      api.get<AiDutyReviewRequired[]>('/local-connector/ai-duty-review-required', { params: dutyDateQuery.value }),
      api.get<AiReplyQualitySummary>('/local-connector/ai-reply-quality-summary')
    ])
    if (requestId !== loadRequestId) return
    const read = <T>(index: number, fallback: T): T => {
      const result = results[index] as PromiseSettledResult<{ data: T }>
      return result.status === 'fulfilled' ? result.value.data : fallback
    }
    policies.value = read(0, policies.value); devices.value = read(1, devices.value); observations.value = read(2, observations.value)
    dutyReplies.value = read(3, dutyReplies.value); dutyReviewRequired.value = read(4, dutyReviewRequired.value); qualitySummary.value = read(5, qualitySummary.value)
    refreshTick.value += 1
    const failedLabels = results.flatMap((result, index) => result.status === 'rejected' ? [requestLabels[index]] : [])
    if (failedLabels.length) {
      partialRefreshWarning.value = failedLabels.length === results.length
        ? '全部数据刷新失败，请重试；未更新的数据可能仍是上次结果'
        : `${failedLabels.join('、')}刷新失败，请重试；未更新的数据不会视为本次结果`
      if (failedLabels.length === results.length && !lastRefreshed.value && !silent) loadError.value = '今日值守数据加载失败，请检查网络后重试'
    } else {
      partialRefreshWarning.value = ''
      lastRefreshed.value = new Date()
    }
    const newManualReviews = dutyReviewRequired.value.filter(x => !previousReviewIds.has(x.id))
    for (const item of newManualReviews) {
      notify.addNotification('MANUAL_REVIEW_REQUIRED', 'AI 已读未回复', `${item.jobTitle} · ${item.accountName}`, '/dashboard', item.id)
    }
    if (newManualReviews.length) liveMessage.value = `${newManualReviews.length} 条会话需要 HR 手动处理`
    if (selectedDutySessionId.value) void loadDutyTimeline(selectedDutySessionId.value, true)
  } catch (e) {
    if (!silent && requestId === loadRequestId) { loadError.value = apiErrorMessage(e, '值守状态加载失败') }
  } finally {
    if (!silent && requestId === loadRequestId) { loading.value = false }
  }
}

function applyDutyDateRange() {
  // Never render the previous range's cached results under the newly selected date.
  dutyReplies.value = []
  dutyReviewRequired.value = []
  lastRefreshed.value = null
  liveMessage.value = `正在查询${dutyDateRangeLabel.value}的值守记录`
  void load()
}

function startPolling() {
  stopPolling()
  if (autoRefreshEnabled.value) {
    pollTimer = setInterval(() => load(true), refreshIntervalSec.value * 1000)
  }
}

function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null } }
watch(autoRefreshEnabled, (val) => { if (val) startPolling(); else stopPolling() })

function dutyEventTime(event:AiDutyEvent){return event.sendCompletedAt||event.completedAt||event.updatedAt}

async function locateBossConversation(item:Pick<AiDutyReviewRequired, 'observationId'>){
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
  <div class="page-shell duty-page duty-page--talent">
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
          <span v-if="partialRefreshWarning" class="refresh-warning" role="status" :title="partialRefreshWarning">
            <el-icon :size="13"><InfoFilled /></el-icon>
            部分刷新失败
          </span>
          <span class="refresh-indicator" :class="{ 'refresh-indicator--stale': refreshIsStale }" :title="lastRefreshed ? `上次完整刷新：${lastRefreshed.toLocaleString()}` : partialRefreshWarning">
            <el-icon :key="`refresh-${refreshTick}`" class="refresh-indicator__icon" :size="13"><Refresh /></el-icon>
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

      <div class="duty-history-filter" role="group" aria-label="筛选值守记录日期">
        <div class="duty-history-filter__label">
          <span class="duty-history-filter__icon"><el-icon><Calendar /></el-icon></span>
          <span><strong>记录日期</strong><small>同时筛选成功回复与待 HR 复核</small></span>
        </div>
        <el-date-picker
          v-model="dutyDateRange"
          class="duty-history-filter__picker"
          type="daterange"
          format="YYYY/MM/DD"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          :clearable="false"
          :disabled-date="disableFutureDutyDate"
          :shortcuts="dutyDateShortcuts"
          unlink-panels
          aria-label="选择值守记录日期范围"
          @change="applyDutyDateRange"
        />
      </div>

      <section class="duty-chat-workspace duty-chat-workspace--timeline card-panel" aria-label="BOSS 会话工作区">
        <aside class="duty-chat-list" @keydown="handleDutySessionKeydown">
          <header class="duty-chat-list__header">
            <div>
              <span class="duty-chat-list__eyebrow">最近处理 · {{ dutyDateRangeLabel }}</span>
              <h2>BOSS 会话</h2>
              <p>AI 值守回顾 · 已读未回复待 HR 复核 · {{ dutySessions.length }} 条近期处理记录</p>
            </div>
            <div class="duty-chat-list__header-actions">
              <span class="duty-chat-list__count">{{ successfulDutyReplies.length }} 已回复</span>
              <button type="button" class="duty-chat-list__all" @click="showAllDutySessions">查看全部</button>
            </div>
          </header>
          <label class="duty-chat-search">
            <el-icon :size="15"><Search /></el-icon>
            <input ref="dutySessionSearchInput" v-model="dutySessionSearch" type="search" placeholder="搜索会话、岗位或账号" aria-label="搜索会话、岗位或账号" />
            <button v-if="dutySessionSearch" type="button" aria-label="清除搜索" @click="dutySessionSearch = ''">×</button>
          </label>
          <div class="duty-chat-filters" role="tablist" aria-label="会话筛选">
            <button v-for="filter in dutyFilterOptions" :key="filter[0]" type="button" role="tab" :aria-selected="dutySessionFilter === filter[0]" :class="{ active: dutySessionFilter === filter[0] }" @click="dutySessionFilter = filter[0]">{{ filter[1] }}</button>
          </div>
          <div v-if="dutyJobFilter || dutySessionSearch || dutySessionFilter !== 'ALL'" class="duty-chat-list__filter-state">
            <span>{{ dutyJobFilter ? `岗位：${dutyJobFilter}` : '已应用筛选' }}</span>
            <button type="button" @click="clearDutyFilters">清除</button>
          </div>
          <TransitionGroup v-if="dutySessions.length" name="duty-session" tag="div" class="duty-chat-list__items">
            <button v-for="session in dutySessions" :key="session.observationId" type="button" class="duty-chat-session" :class="{ selected: selectedDutySession?.observationId === session.observationId }" @click="selectDutySession(session)">
              <span class="duty-chat-session__dot" :class="`is-${dutyOutcomeTone(session)}`"></span>
              <span class="duty-chat-session__body">
                <span class="duty-chat-session__top"><strong>{{ session.anonymousKey }}</strong><time :datetime="session.latestAt">{{ dutyTimelineDay(session.latestAt) === dutyTimelineDay(new Date().toISOString()) ? dutyTimeLabel(session.latestAt) : `${dutyTimelineDay(session.latestAt).slice(5)} ${dutyTimeLabel(session.latestAt)}` }}</time></span>
                <span class="duty-chat-session__context" :title="`${session.jobTitle} · ${session.accountName}`">{{ session.jobTitle }} · {{ session.accountName }}</span>
                <span class="duty-chat-session__preview" :title="cleanConversationDisplayText(session.messageText) || cleanConversationDisplayText(session.replyContent) || session.detail || '等待新的会话消息'">{{ cleanConversationDisplayText(session.messageText) || cleanConversationDisplayText(session.replyContent) || session.detail || '等待新的会话消息' }}</span>
                <span class="duty-chat-session__state" :class="`is-${dutyOutcomeTone(session)}`">{{ dutyOutcomeLabel(session) }}</span>
              </span>
              <span v-if="session.unreadCount" class="duty-chat-session__unread">{{ session.unreadCount > 99 ? '99+' : session.unreadCount }}</span>
            </button>
          </TransitionGroup>
          <AsyncState v-else state="empty" embedded title="暂无会话" message="当前日期和筛选条件下没有可展示的值守记录。">
            <template #icon><el-icon><ChatDotRound /></el-icon></template>
          </AsyncState>
        </aside>

        <section class="duty-chat-thread" :class="{ 'duty-chat-thread--mobile-open': mobileDutyDetailOpen }" aria-live="polite">
          <header class="duty-chat-thread__header">
            <button type="button" class="duty-chat-mobile-back" aria-label="返回会话列表" @click="mobileDutyDetailOpen = false"><el-icon><ArrowLeft /></el-icon></button>
            <div v-if="selectedDutySession" class="duty-chat-thread__title">
              <span class="duty-chat-thread__eyebrow">值守时间轴</span>
              <h2>{{ selectedDutySession.anonymousKey }}</h2>
              <p>{{ selectedDutySession.jobTitle }} · {{ selectedDutySession.accountName }}</p>
            </div>
            <button v-if="selectedDutySession" type="button" class="duty-chat-context-toggle" :aria-expanded="dutyContextOpen" @click="dutyContextOpen = !dutyContextOpen"><el-icon><InfoFilled /></el-icon><span>详情</span></button>
            <span v-if="selectedDutySession" class="duty-chat-status" :class="`duty-chat-status--${dutyOutcomeTone(selectedDutySession)}`">{{ dutyOutcomeLabel(selectedDutySession) }}</span>
          </header>
          <Transition name="duty-thread" mode="out-in">
            <div v-if="selectedDutySession" :key="selectedDutySession.observationId" class="duty-chat-thread__body">
              <p class="duty-chat-thread__notice">
                <span v-if="dutyTimelineLoading === selectedDutySession.observationId">正在加载已导入的完整沟通时间线…</span>
                <span v-else-if="dutyTimelineErrors[selectedDutySession.observationId]">{{ dutyTimelineErrors[selectedDutySession.observationId] }}，当前保留值守处理片段。</span>
                <span v-else>按 BOSS 会话消息时间排列；尚未同步的值守处理结果会补充在相应位置。</span>
              </p>
              <div v-if="selectedDutyTimeline.length" class="duty-chat-timeline">
                <template v-for="(row, index) in selectedDutyTimeline" :key="row.id">
                  <div v-if="startsTimelineDay(selectedDutyTimeline, index)" class="duty-chat-timeline__date" role="separator" :aria-label="dutyTimelineDayLabel(row.at)">
                    <time :datetime="dutyTimelineDay(row.at)">{{ dutyTimelineDayLabel(row.at) }}</time>
                  </div>
                  <article class="duty-chat-bubble" :class="[`duty-chat-bubble--${row.kind}`, { 'duty-chat-bubble--latest': index === selectedDutyTimeline.length - 1, 'duty-chat-bubble--pending': row.deliveryStatus === 'PENDING_REVIEW', 'duty-chat-bubble--failed': row.deliveryStatus === 'FAILED' }]" :style="{ '--timeline-index': index }" :aria-label="`${row.label}消息`">
                    <time v-if="row.at" class="duty-chat-bubble__time" :datetime="row.at">{{ dutyTimeLabel(row.at) }}</time>
                    <p>{{ row.content }}</p>
                    <span v-if="timelineDeliveryLabel(row.deliveryStatus)" class="duty-chat-bubble__delivery">{{ timelineDeliveryLabel(row.deliveryStatus) }}</span>
                  </article>
                </template>
              </div>
              <AsyncState v-else state="empty" embedded title="暂无消息片段" message="该会话暂未同步可展示的正文，将保留处理状态。">
                <template #icon><el-icon><ChatDotRound /></el-icon></template>
              </AsyncState>
            </div>
            <div v-else key="empty-thread" class="duty-chat-thread__empty">
              <el-icon :size="30"><ChatDotRound /></el-icon>
              <strong>选择左侧会话</strong>
              <span>查看 AI 处理时间线和当前状态</span>
            </div>
          </Transition>
        </section>

        <Transition name="duty-context" mode="out-in">
        <aside v-if="selectedDutySession" :key="selectedDutySession.observationId" class="duty-chat-context" :class="{ 'duty-chat-context--closed': !dutyContextOpen }">
          <template v-if="selectedDutySession">
            <header class="duty-chat-context__header"><div><span class="duty-chat-context__eyebrow">处理详情</span><h2>会话上下文</h2></div><span>{{ selectedDutySession.anonymousKey }}</span><button type="button" class="duty-chat-context__close" aria-label="关闭会话详情" @click="dutyContextOpen = false"><el-icon :size="14"><Close /></el-icon></button></header>
            <dl class="duty-chat-facts">
              <div><dt>岗位</dt><dd><button type="button" class="duty-chat-context__job" @click="filterDutyByJob(selectedDutySession.jobTitle)">{{ selectedDutySession.jobTitle }}</button></dd></div>
              <div><dt>招聘账号</dt><dd>{{ selectedDutySession.accountName }}</dd></div>
              <div><dt>处理状态</dt><dd :class="`is-${dutyOutcomeTone(selectedDutySession)}`">{{ dutyOutcomeLabel(selectedDutySession) }}</dd></div>
              <div v-if="dutyOutcome(selectedDutySession) === 'PROCESSING'"><dt>处理耗时</dt><dd :class="`is-${dutyOutcomeTone(selectedDutySession)}`">{{ formatProcessingDuration(processingElapsedSeconds(selectedDutySession)) }}</dd></div>
              <div><dt>意图类别</dt><dd>{{ qualityLabel(selectedDutySession.category || '') }}</dd></div>
              <div><dt>尝试次数</dt><dd>{{ selectedDutySession.attemptCount || 0 }}</dd></div>
            </dl>
            <section class="duty-chat-context__section">
              <h3>AI 判定</h3>
              <p>{{ selectedDutySession.detail || selectedDutySession.event?.followUpReason || '暂无额外判定说明' }}</p>
            </section>
            <div class="duty-chat-context__actions">
              <button type="button" class="duty-chat-action duty-chat-action--primary" @click="locateBossConversation({ observationId: selectedDutySession.observationId })"><el-icon><Location /></el-icon>定位 BOSS 会话</button>
              <button v-if="selectedDutySession.resumeReceived" type="button" class="duty-chat-action" @click="router.push('/resume-intakes')">查看简历分析</button>
            </div>
          </template>
        </aside>
        <aside v-else key="empty-context" class="duty-chat-context duty-chat-context__empty">选中会话后显示岗位与处理上下文。</aside>
        </Transition>
      </section>

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
.duty-page { max-width: 1480px; position: relative; isolation: isolate; }
.duty-page::before {
  content: '';
  position: absolute;
  inset: -24px -32px -44px;
  z-index: -1;
  pointer-events: none;
  background:
    radial-gradient(circle at 8% 10%, rgba(20,184,166,.10), transparent 28%),
    radial-gradient(circle at 88% 16%, rgba(37,99,235,.08), transparent 24%),
    linear-gradient(rgba(15,118,110,.08) 1px, transparent 1px),
    linear-gradient(90deg, rgba(15,118,110,.08) 1px, transparent 1px);
  background-size: auto, auto, 28px 28px, 28px 28px;
  mask-image: linear-gradient(180deg, #000 0%, rgba(0,0,0,.86) 74%, transparent 100%);
  animation: duty-grid-drift 40s linear infinite;
}
.duty-page::after {
  content: '';
  position: absolute;
  inset: -24px -32px -44px;
  z-index: -1;
  pointer-events: none;
  background:
    radial-gradient(ellipse at 20% 80%, rgba(45,212,191,.06), transparent 40%),
    radial-gradient(ellipse at 85% 15%, rgba(37,99,235,.05), transparent 35%);
  filter: blur(40px);
  animation: duty-glow-shift 20s ease-in-out infinite;
}

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
  transition: background 300ms ease, border-color 300ms ease, box-shadow 300ms ease;
  position: relative;
  overflow: hidden;
  animation: duty-surface-in 220ms cubic-bezier(.16,1,.3,1) both, barBreathe 4s ease-in-out 220ms infinite;
}
.dashboard-bar:hover { box-shadow: var(--shadow-floating), inset 0 1px 0 rgba(255,255,255,.62), 0 0 0 1px rgba(20,184,166,.08); }
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
.dashboard-bar::after {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 2px;
  border-radius: var(--radius-panel) var(--radius-panel) 0 0;
  background: linear-gradient(90deg, transparent 5%, rgba(20,184,166,.35) 25%, rgba(45,212,212,.5) 50%, rgba(37,99,235,.3) 75%, transparent 95%);
  pointer-events: none;
  animation: barTopPulse 3s ease-in-out infinite;
}
.dashboard-bar--active {
  background: linear-gradient(135deg, #0d9488 0%, #0f766e 50%, #0c1f2d 100%);
  background-size: 200% 200%;
  animation: duty-surface-in 220ms cubic-bezier(.16,1,.3,1) both, barShimmer 6s ease-in-out 220ms infinite;
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
  padding: 5px 12px;
  border-radius: var(--radius-pill);
  background: var(--surface-soft);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  transition: background 200ms ease, color 200ms ease, box-shadow 200ms ease;
}
.duty-badge--on {
  background: linear-gradient(135deg, color-mix(in srgb, var(--brand-100) 78%, transparent), color-mix(in srgb, var(--surface-teal) 92%, transparent));
  color: var(--primary);
  box-shadow: 0 0 10px color-mix(in srgb, var(--brand-600) 16%, transparent);
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
  gap: 6px;
  min-height: 34px;
  padding: 6px 16px;
  border-radius: var(--radius-capsule);
  background: linear-gradient(135deg, color-mix(in srgb, var(--surface-teal) 92%, var(--surface)), color-mix(in srgb, var(--surface-teal) 52%, var(--surface)));
  border: 1px solid color-mix(in srgb, var(--border-teal) 62%, transparent);
  font-size: 12px;
  color: var(--text-secondary);
  box-shadow: var(--shadow-capsule);
  transition: background 200ms ease, border-color 200ms ease, color 200ms ease, transform 200ms ease, box-shadow 200ms ease;
}
.dashboard-bar__metrics .metric-pill { animation: duty-surface-in 200ms cubic-bezier(.16,1,.3,1) calc(var(--metric-index, 0) * 40ms + 40ms) both; }
.dashboard-bar__metrics .metric-pill:nth-child(1) { --metric-index: 0; }
.dashboard-bar__metrics .metric-pill:nth-child(2) { --metric-index: 1; }
.dashboard-bar__metrics .metric-pill:nth-child(3) { --metric-index: 2; }
.dashboard-bar__metrics .metric-pill:nth-child(4) { --metric-index: 3; }
.metric-pill:hover { transform: translateY(-2px); border-color: var(--border-teal); box-shadow: var(--shadow-capsule-hover), 0 0 14px color-mix(in srgb, var(--brand-600) 12%, transparent); }
.metric-pill b {
  font-variant-numeric: tabular-nums;
  font-weight: 800;
  font-size: 15px;
  letter-spacing: -.01em;
  color: var(--primary);
  transition: color 200ms ease;
  animation: metricPulse 0.35s cubic-bezier(.16,1,.3,1);
}
@keyframes metricPulse {
  0% { transform: scale(1.18); opacity: .6; }
  60% { transform: scale(1.02); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
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
.refresh-warning { display: inline-flex; align-items: center; gap: 5px; color: var(--warning); font-size: 11px; font-weight: 600; white-space: nowrap; }
.dashboard-bar--active .refresh-warning { color: rgba(255,230,170,.9); }
.refresh-indicator__icon { animation: refresh-spin 380ms cubic-bezier(.16,1,.3,1), refreshPulse 600ms ease-in 380ms; }
@keyframes refresh-spin { from { transform: rotate(-35deg); } to { transform: rotate(0deg); } }
@keyframes refreshPulse { 0% { opacity: 1; } 40% { opacity: .4; } 100% { opacity: 1; } }

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
  border-top: 2px solid color-mix(in srgb, var(--primary) 34%, transparent);
  border-radius: var(--radius-capsule);
  background: linear-gradient(180deg, color-mix(in srgb, var(--surface-teal) 60%, var(--surface)), var(--surface));
  box-shadow: var(--shadow-capsule);
  animation: duty-surface-in 220ms cubic-bezier(.16,1,.3,1) 40ms both;
}
.quality-strip__head { display: flex; align-items: baseline; gap: 8px; }
.quality-strip__head h2 { margin: 0; color: var(--text-primary); font-size: 13px; font-weight: 600; }
.quality-strip__period { color: var(--text-secondary); font-size: 11px; }
.quality-strip__shadow { margin-left: auto; color: var(--text-secondary); font-size: 11px; }

/* 指标胶囊：与顶部仪表条的 .metric-pill 同规范 */
.quality-metrics { display: flex; flex-wrap: wrap; gap: 8px; }
.quality-metric { display: inline-flex; align-items: baseline; gap: 6px; min-height: 36px; padding: 6px 16px; border: 1px solid color-mix(in srgb, var(--border-teal) 62%, transparent); border-radius: var(--radius-capsule); background: linear-gradient(135deg, color-mix(in srgb, var(--surface-teal) 92%, var(--surface)), color-mix(in srgb, var(--surface-teal) 50%, var(--surface))); color: var(--text-secondary); font-size: 12px; box-shadow: var(--shadow-capsule); }
.quality-metric b { color: var(--primary); font-size: 23px; font-weight: 800; line-height: 1; letter-spacing: -.03em; font-variant-numeric: tabular-nums; }
.quality-metric--alert { border-color: var(--border-rose); background: var(--surface-rose); }
.quality-metric--alert b { color: var(--danger); }

.quality-funnel { min-width: 0; }
.quality-funnel__track { display: flex; height: 8px; padding: 2px; box-sizing: border-box; border: 1px solid var(--border-subtle); border-radius: var(--radius-pill); overflow: hidden; background: var(--surface-muted); }
.quality-funnel__seg { display: block; flex: 0 0 auto; min-width: 0; height: 100%; transition: width 400ms cubic-bezier(.16,1,.3,1); animation: funnelShimmer 6s ease-in-out infinite; }
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
.quality-strip__detail-toggle::before { content: ''; display: inline-block; width: 6px; height: 6px; border-right: 1px solid currentColor; border-bottom: 1px solid currentColor; transform: rotate(45deg) translateY(-2px); transition: transform .2s ease; }
.quality-strip__detail[open] .quality-strip__detail-toggle::before { transform: rotate(225deg) translateY(-2px); }
.quality-detail-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-top: 8px; padding: 12px 14px; border-radius: var(--radius-control); background: var(--surface-soft); animation: detailExpand 280ms cubic-bezier(.16,1,.3,1) both; }
@keyframes detailExpand {
  from { opacity: 0; max-height: 0; margin-top: 0; padding-top: 0; padding-bottom: 0; }
  to { opacity: 1; max-height: 600px; }
}
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
  padding: 10px 16px 10px 14px;
  margin-bottom: 16px;
  border-radius: var(--radius-capsule);
  border: 1px solid var(--border-amber);
  border-left: 3px solid var(--warning);
  background: linear-gradient(135deg, color-mix(in srgb, var(--surface-amber) 94%, var(--surface)), color-mix(in srgb, var(--surface-amber) 46%, var(--surface)));
  font-size: 13px;
  color: var(--text-primary);
  box-shadow: var(--shadow-capsule);
  animation: noticeSlideIn 320ms cubic-bezier(.16,1,.3,1) both;
}
@keyframes noticeSlideIn {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: translateY(0); }
}
.notice-bar .el-icon { color: var(--warning); font-size: 17px; filter: drop-shadow(0 0 4px color-mix(in srgb, var(--warning) 32%, transparent)); }
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
.duty-history-filter {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin: 0 0 12px;
  padding: 10px 12px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-control);
  background: color-mix(in srgb, var(--surface) 92%, var(--surface-teal));
  box-shadow: var(--shadow-rest);
  animation: duty-surface-in 220ms cubic-bezier(.16,1,.3,1) 80ms both;
}

.duty-history-filter__label {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  color: var(--text-primary);
}

.duty-history-filter__label > span:last-child {
  display: grid;
  gap: 1px;
}

.duty-history-filter__label strong { font-size: 13px; }
.duty-history-filter__label small { color: var(--text-secondary); font-size: 11px; }

.duty-history-filter__icon {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  border-radius: 8px;
  background: var(--surface-teal);
  color: var(--primary);
}

.duty-history-filter__picker { width: 276px !important; flex: 0 0 auto; }
.duty-history-filter :deep(.el-range-editor) {
  border-radius: 8px;
  box-shadow: 0 0 0 1px var(--border-subtle) inset;
}
.duty-history-filter :deep(.el-range-editor:hover) { box-shadow: 0 0 0 1px var(--border-teal) inset; }
.duty-history-filter :deep(.el-range-editor.is-active) { box-shadow: 0 0 0 2px var(--border-focus) inset; }

/* ── 三栏会话工作区：列表 / 处理时间线 / 上下文 ── */
.duty-chat-workspace {
  display: grid;
  grid-template-columns: minmax(236px, 22%) minmax(0, 1fr) minmax(260px, 24%);
  height: min(680px, calc(100dvh - 360px));
  min-height: 520px;
  max-height: 720px;
  margin-bottom: 32px;
  overflow: hidden;
  align-items: stretch;
  position: relative;
  border-radius: var(--radius-panel);
  border: 1px solid var(--border-subtle);
  background: var(--surface);
  box-shadow: var(--shadow-rest);
  animation: duty-surface-in 220ms cubic-bezier(.16,1,.3,1) 120ms both;
}
.duty-chat-workspace--timeline { background: linear-gradient(145deg, color-mix(in srgb, var(--surface) 90%, var(--surface-teal)), var(--surface)); }
.duty-chat-workspace::before { content: ''; position: absolute; top: 0; left: 18px; right: 18px; z-index: 3; height: 3px; border-radius: 0 0 3px 3px; background: linear-gradient(90deg, transparent, var(--primary) 22%, color-mix(in srgb, var(--accent) 74%, transparent) 68%, transparent); opacity: .7; pointer-events: none; animation: workspaceLinePulse 4s ease-in-out infinite; }
.duty-chat-list,
.duty-chat-thread,
.duty-chat-context { min-width: 0; min-height: 0; background: var(--surface); }
.duty-chat-list { display: flex; min-height: 0; flex-direction: column; overflow: hidden; border-right: 1px solid var(--border-subtle); background: color-mix(in srgb, var(--surface) 88%, var(--surface-teal)); backdrop-filter: blur(8px) saturate(1.08); -webkit-backdrop-filter: blur(8px) saturate(1.08); }
.duty-chat-thread { display: flex; min-height: 0; flex-direction: column; overflow: hidden; border-right: 1px solid var(--border-subtle); }
.duty-chat-context { min-height: 0; overflow-y: auto; transition: opacity 180ms cubic-bezier(.16,1,.3,1), transform 180ms cubic-bezier(.16,1,.3,1); }
.duty-chat-list__header,
.duty-chat-thread__header,
.duty-chat-context__header { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 68px; padding: 14px 16px; border-bottom: 1px solid var(--border-subtle); }
.duty-chat-list__eyebrow,
.duty-chat-thread__eyebrow,
.duty-chat-context__eyebrow { display: block; margin-bottom: 4px; color: var(--primary); font-size: 10px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
.duty-chat-list__header h2,
.duty-chat-thread__header h2,
.duty-chat-context__header h2 { margin: 0; color: var(--text-primary); font-size: 15px; }
.duty-chat-list__header-actions { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
.duty-chat-list__all { padding: 3px 0; border: 0; background: transparent; color: var(--primary); font-size: 10px; cursor: pointer; }
.duty-chat-list__all:hover { text-decoration: underline; text-underline-offset: 3px; }
.duty-chat-list__all:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; border-radius: 3px; }
.duty-chat-list__header p,
.duty-chat-thread__header p { margin: 4px 0 0; color: var(--text-secondary); font-size: 11px; }
.duty-chat-context__header > div { min-width: 0; }
.duty-chat-list__count,
.duty-chat-status { flex: 0 0 auto; padding: 4px 8px; border-radius: var(--radius-pill); background: var(--surface-teal); color: var(--primary); font-size: 11px; font-weight: 700; }
.duty-chat-status--success { background: var(--surface-teal); color: var(--success); }
.duty-chat-status--warning { background: var(--surface-amber); color: var(--warning); }
.duty-chat-status--danger { background: var(--surface-rose); color: var(--danger); }
.duty-chat-status--info { background: var(--surface-blue); color: var(--primary); }
.duty-chat-status--neutral { background: var(--surface-muted); color: var(--text-secondary); }
.duty-chat-search { display: flex; align-items: center; gap: 7px; height: 36px; margin: 12px; padding: 0 10px; border: 1px solid var(--border-subtle); border-radius: var(--radius-control); background: var(--surface-soft); color: var(--text-tertiary); transition: border-color var(--transition-fast), box-shadow var(--transition-fast); }
.duty-chat-search:focus-within { border-color: var(--primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 13%, transparent); }
.duty-chat-search input { min-width: 0; flex: 1; border: 0; outline: 0; background: transparent; color: var(--text-primary); font: inherit; font-size: 12px; }
.duty-chat-search input::placeholder { color: var(--text-tertiary); }
.duty-chat-search button { display: grid; place-items: center; width: 20px; height: 20px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: var(--text-tertiary); cursor: pointer; }
.duty-chat-search button:hover { background: var(--surface-row); color: var(--text-primary); }
.duty-chat-filters { display: flex; gap: 5px; padding: 0 12px 10px; overflow-x: auto; scrollbar-width: none; }
.duty-chat-filters::-webkit-scrollbar { display: none; }
.duty-chat-filters button { min-height: 28px; padding: 4px 10px; border: 0; border-radius: var(--radius-pill); background: transparent; color: var(--text-secondary); font-size: 11px; cursor: pointer; transition: background var(--transition-fast), color var(--transition-fast), transform 180ms cubic-bezier(.16,1,.3,1), box-shadow 180ms cubic-bezier(.16,1,.3,1); }
.duty-chat-filters button:hover { background: var(--surface-row); }
.duty-chat-filters button:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }
.duty-chat-filters button.active { background: var(--surface-teal); color: var(--primary); font-weight: 700; box-shadow: 0 1px 4px color-mix(in srgb, var(--brand-600) 12%, transparent), inset 0 1px 0 rgba(255,255,255,.42); }
.duty-chat-list__filter-state { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: -2px 12px 8px; padding: 5px 8px; border: 1px solid var(--border-subtle); border-radius: 8px; background: var(--surface-soft); color: var(--text-secondary); font-size: 10px; }
.duty-chat-list__filter-state span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.duty-chat-list__filter-state button { flex: 0 0 auto; padding: 0; border: 0; background: transparent; color: var(--primary); font: inherit; cursor: pointer; }
.duty-chat-list__filter-state button:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; border-radius: 3px; }
.duty-chat-list__items { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: var(--border-subtle) transparent; }
.duty-chat-session { position: relative; display: flex; align-items: flex-start; gap: 8px; width: 100%; min-height: 76px; margin: 4px 8px; padding: 12px 14px 12px 16px; border: 1px solid color-mix(in srgb, var(--border-teal) 72%, transparent); border-left: 3px solid color-mix(in srgb, var(--primary) 22%, transparent); border-radius: var(--radius-capsule); background: linear-gradient(135deg, color-mix(in srgb, var(--surface-teal) 88%, var(--surface)), color-mix(in srgb, var(--surface-teal) 46%, var(--surface))); color: var(--text-primary); text-align: left; cursor: pointer; box-shadow: var(--shadow-capsule); transition: background var(--transition-fast), border-color var(--transition-fast), box-shadow var(--transition-fast), transform var(--transition-fast); animation: duty-session-in 220ms ease both; }
.duty-chat-session:hover { background: linear-gradient(135deg, var(--surface-teal), color-mix(in srgb, var(--surface-teal) 62%, var(--surface))); border-color: color-mix(in srgb, var(--primary) 26%, transparent); border-left-color: var(--primary); transform: translateY(-3px); box-shadow: var(--shadow-capsule-hover); }
.duty-chat-session:active { transform: translateY(-1px); box-shadow: var(--shadow-capsule); }
.duty-chat-session.selected { background: linear-gradient(100deg, color-mix(in srgb, var(--brand-100) 58%, var(--surface)), color-mix(in srgb, var(--surface-teal) 76%, var(--surface))); border-color: color-mix(in srgb, var(--primary) 34%, transparent); border-left-color: var(--primary); box-shadow: var(--shadow-capsule-hover), 0 0 0 1px color-mix(in srgb, var(--primary) 12%, transparent); animation: selectBounce 280ms cubic-bezier(.16,1,.3,1) both; }
/* 会话状态映射到左侧强调线，颜色与状态点语义一致 */
.duty-chat-session:has(.duty-chat-session__dot.is-success) { border-left-color: var(--success); }
.duty-chat-session:has(.duty-chat-session__dot.is-warning) { border-left-color: var(--warning); }
.duty-chat-session:has(.duty-chat-session__dot.is-danger) { border-left-color: var(--danger); }
.duty-chat-session:has(.duty-chat-session__dot.is-info) { border-left-color: var(--primary); }
@keyframes selectBounce {
  0% { transform: scale(.97); }
  50% { transform: scale(1.01); }
  100% { transform: scale(1); }
}
.duty-chat-session:focus-visible { outline: 2px solid var(--border-focus); outline-offset: -2px; }
.duty-session-enter-active, .duty-session-leave-active { transition: opacity 180ms cubic-bezier(.16,1,.3,1), transform 180ms cubic-bezier(.16,1,.3,1); }
.duty-session-enter-from, .duty-session-leave-to { opacity: 0; transform: translateY(6px); }
.duty-session-move { transition: transform 180ms cubic-bezier(.16,1,.3,1); }
.duty-chat-session__dot { width: 8px; height: 8px; margin-top: 5px; flex: 0 0 auto; border-radius: 50%; background: var(--text-tertiary); }
.duty-chat-session__dot.is-success { background: var(--success); }
.duty-chat-session__dot.is-warning { background: var(--warning); }
.duty-chat-session__dot.is-danger { background: var(--danger); }
.duty-chat-session__dot.is-info { background: var(--primary); }
.duty-chat-session__body { display: grid; min-width: 0; flex: 1; gap: 4px; }
.duty-chat-session__top { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.duty-chat-session__top strong { overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.duty-chat-session__top time { flex: 0 0 auto; color: var(--text-tertiary); font-size: 10px; font-variant-numeric: tabular-nums; }
.duty-chat-session__context,
.duty-chat-session__preview { display: -webkit-box; overflow: hidden; color: var(--text-secondary); font-size: 11px; text-overflow: ellipsis; -webkit-box-orient: vertical; -webkit-line-clamp: 1; }
.duty-chat-session__preview { color: var(--text-tertiary); }
.duty-chat-session__state { justify-self: start; margin-top: 2px; color: var(--text-tertiary); font-size: 10px; }
.duty-chat-session__state.is-success { color: var(--success); }
.duty-chat-session__state.is-warning { color: var(--warning); }
.duty-chat-session__state.is-danger { color: var(--danger); }
.duty-chat-session__state.is-info { color: var(--primary); }
.duty-chat-session__unread { display: grid; place-items: center; min-width: 18px; height: 18px; margin-left: auto; border-radius: 9px; background: var(--primary); color: #fff; font-size: 10px; font-variant-numeric: tabular-nums; animation: unreadPulse 2.4s ease-in-out infinite; }
@keyframes unreadPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(13,148,136,.35); }
  50% { box-shadow: 0 0 0 5px rgba(13,148,136,0); }
}
.duty-chat-thread__header { min-height: 68px; }
.duty-chat-thread__title { min-width: 0; flex: 1; }
.duty-chat-mobile-back { display: none; place-items: center; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 8px; background: var(--surface-soft); color: var(--text-secondary); cursor: pointer; }
.duty-chat-thread__body { min-width: 0; flex: 1; overflow-y: auto; padding: 18px 20px 24px; }
.duty-chat-thread__notice { margin: 0 0 18px; color: var(--text-tertiary); font-size: 11px; line-height: 1.6; }
.duty-chat-timeline { display: grid; gap: 16px; padding: 4px 6px 10px; }
.duty-chat-timeline__date { display: flex; align-items: center; gap: 12px; margin: 8px 0 2px; color: var(--text-secondary); font-size: 11px; font-weight: 600; text-align: center; }
.duty-chat-timeline__date::before, .duty-chat-timeline__date::after { content: ''; height: 1px; flex: 1; background: var(--border-subtle); }
.duty-chat-timeline__date time { flex: 0 0 auto; padding: 5px 10px; border: 1px solid var(--border-subtle); border-radius: var(--radius-capsule); background: var(--surface-soft); font-variant-numeric: tabular-nums; }
.duty-chat-bubble { position: relative; max-width: min(78%, 680px); padding: 13px 17px 14px; overflow: hidden; border: 1px solid color-mix(in srgb, var(--border-subtle) 78%, transparent); border-radius: var(--radius-capsule) var(--radius-capsule) var(--radius-capsule) 6px; background: color-mix(in srgb, var(--surface) 82%, transparent); color: var(--text-primary); box-shadow: var(--shadow-capsule), inset 0 1px 0 color-mix(in srgb, #fff 62%, transparent); backdrop-filter: blur(14px) saturate(1.12); -webkit-backdrop-filter: blur(14px) saturate(1.12); animation: duty-timeline-in 280ms cubic-bezier(.16,1,.3,1) calc(var(--timeline-index, 0) * 60ms) both; transition: border-color var(--transition-fast), box-shadow var(--transition-fast), transform var(--transition-fast); }
.duty-chat-bubble:hover { border-color: var(--border-teal); box-shadow: var(--shadow-capsule-hover), inset 0 1px 0 color-mix(in srgb, #fff 68%, transparent); transform: translateY(-3px); }
.duty-chat-bubble--latest { border-color: color-mix(in srgb, var(--primary) 32%, var(--border-subtle)); }
.duty-chat-bubble--ai { margin-left: auto; border-color: color-mix(in srgb, var(--primary) 22%, var(--border-subtle)); border-radius: var(--radius-capsule) var(--radius-capsule) 6px var(--radius-capsule); background: color-mix(in srgb, var(--surface-teal) 78%, transparent); }
.duty-chat-bubble--status { max-width: 88%; margin-inline: auto; border-color: var(--border-amber); border-radius: var(--radius-capsule); background: color-mix(in srgb, var(--surface-amber) 82%, transparent); text-align: center; }
.duty-chat-bubble__time { display: block; margin: 0 0 4px; color: var(--text-tertiary); font-size: 10px; font-variant-numeric: tabular-nums; line-height: 1.2; text-align: right; }
.duty-chat-bubble p { margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; font-size: 14px; line-height: 1.65; }
.duty-chat-bubble__delivery { display: block; margin-top: 5px; color: var(--warning); font-size: 10px; text-align: right; }
.duty-chat-bubble--failed { border-color: color-mix(in srgb, var(--danger) 32%, var(--border-subtle)); }
.duty-chat-bubble--failed .duty-chat-bubble__delivery { color: var(--danger); }
.duty-chat-thread__empty,
.duty-chat-context__empty { display: grid; place-items: center; align-content: center; gap: 8px; min-height: 280px; padding: 24px; color: var(--text-tertiary); text-align: center; }
.duty-chat-thread__empty strong { color: var(--text-secondary); font-size: 14px; }
.duty-chat-thread__empty .el-icon { color: var(--primary); }
.duty-chat-context__header { align-items: baseline; }
.duty-chat-context__header span { overflow: hidden; color: var(--text-tertiary); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.duty-chat-context__close { display: grid; place-items: center; width: 28px; height: 28px; flex: 0 0 auto; padding: 0; border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--text-tertiary); cursor: pointer; transition: color var(--transition-fast), background var(--transition-fast), border-color var(--transition-fast); }
.duty-chat-context__close:hover { border-color: var(--border-subtle); background: var(--surface-soft); color: var(--text-primary); }
.duty-chat-context__close:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }
.duty-chat-context--closed { opacity: 0; pointer-events: none; transform: translateX(12px); max-width: 0; overflow: hidden; }
.duty-chat-context { transition: opacity 220ms cubic-bezier(.16,1,.3,1), transform 220ms cubic-bezier(.16,1,.3,1), max-width 280ms cubic-bezier(.16,1,.3,1); }
.duty-chat-facts { display: grid; gap: 0; margin: 0; padding: 4px 16px 10px; }
.duty-chat-facts div { display: grid; grid-template-columns: 70px minmax(0, 1fr); gap: 12px; padding: 11px 0; border-bottom: 1px solid var(--border-subtle); }
.duty-chat-facts dt { color: var(--text-tertiary); font-size: 11px; }
.duty-chat-facts dd { min-width: 0; margin: 0; overflow-wrap: anywhere; color: var(--text-primary); font-size: 12px; font-weight: 600; }
.duty-chat-context__job { max-width: 100%; padding: 0; border: 0; background: transparent; color: inherit; font: inherit; font-weight: inherit; text-align: left; cursor: pointer; }
.duty-chat-context__job:hover { color: var(--primary); text-decoration: underline; text-underline-offset: 3px; }
.duty-chat-context__job:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; border-radius: 3px; }
.duty-chat-facts dd.is-success { color: var(--success); }
.duty-chat-facts dd.is-warning { color: var(--warning); }
.duty-chat-facts dd.is-info { color: var(--primary); }
.duty-chat-facts dd.is-danger { color: var(--danger); }
.duty-chat-context__section { margin: 12px 16px; padding: 12px; border-radius: var(--radius-control); background: var(--surface-soft); }
.duty-chat-context__section h3 { margin: 0 0 7px; color: var(--text-primary); font-size: 12px; }
.duty-chat-context__section p { margin: 0; color: var(--text-secondary); font-size: 12px; line-height: 1.6; }
.duty-chat-context__actions { display: grid; gap: 8px; padding: 12px 16px 18px; }
.duty-chat-action { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 40px; padding: 9px 16px; border: 1px solid var(--border-subtle); border-radius: var(--radius-capsule); background: linear-gradient(135deg, var(--surface), color-mix(in srgb, var(--surface-teal) 46%, var(--surface))); color: var(--text-primary); font-size: 12px; font-weight: 600; cursor: pointer; box-shadow: var(--shadow-capsule); transition: background var(--transition-fast), border-color var(--transition-fast), transform var(--transition-fast), box-shadow var(--transition-fast); }
.duty-chat-action:hover { border-color: var(--border-teal); background: linear-gradient(135deg, var(--surface-row), color-mix(in srgb, var(--surface-teal) 62%, var(--surface))); transform: translateY(-3px); box-shadow: var(--shadow-capsule-hover); }
.duty-chat-action--primary { border-color: transparent; background: linear-gradient(135deg, var(--brand-600), var(--brand-700)); color: #fff; box-shadow: 0 4px 12px color-mix(in srgb, var(--brand-600) 24%, transparent), inset 0 1px 0 rgba(255,255,255,.14); }
.duty-chat-action--primary:hover { border-color: transparent; background: linear-gradient(135deg, var(--brand-700), var(--brand-900)); transform: translateY(-3px); box-shadow: 0 8px 20px color-mix(in srgb, var(--brand-600) 30%, transparent), 0 0 18px color-mix(in srgb, var(--brand-600) 12%, transparent), inset 0 1px 0 rgba(255,255,255,.14); }
.duty-context-enter-active, .duty-context-leave-active { transition: opacity 180ms cubic-bezier(.16,1,.3,1), transform 180ms cubic-bezier(.16,1,.3,1); }
.duty-context-enter-from, .duty-context-leave-to { opacity: 0; transform: translateX(12px); }
.duty-thread-enter-active, .duty-thread-leave-active { transition: opacity 180ms ease, transform 180ms ease; }
.duty-thread-enter-from { opacity: 0; transform: translateY(5px); }
.duty-thread-leave-to { opacity: 0; transform: translateY(-5px); }
@keyframes duty-session-in { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
@keyframes duty-timeline-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
@keyframes duty-surface-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
@keyframes duty-grid-drift { 0% { background-position: 0 0, 0 0, 0 0, 0 0; } 100% { background-position: 0 0, 0 0, 28px 28px, 28px 28px; } }
@keyframes duty-glow-shift { 0%, 100% { opacity: .6; transform: translateX(0); } 50% { opacity: 1; transform: translateX(12px); } }
@keyframes barBreathe { 0%, 100% { box-shadow: var(--shadow-raised), inset 0 1px 0 rgba(255,255,255,.62); } 50% { box-shadow: var(--shadow-raised), inset 0 1px 0 rgba(255,255,255,.62), 0 0 16px rgba(13,148,136,.06); } }
@keyframes barTopPulse { 0%, 100% { opacity: .5; } 50% { opacity: .9; } }
@keyframes workspaceLinePulse { 0%, 100% { opacity: .5; } 50% { opacity: .85; } }
@keyframes funnelShimmer { 0%, 100% { filter: brightness(1); } 50% { filter: brightness(1.15); } }
.duty-chat-session:nth-child(1) { animation-delay: 20ms; }
.duty-chat-session:nth-child(2) { animation-delay: 40ms; }
.duty-chat-session:nth-child(3) { animation-delay: 60ms; }
.duty-chat-session:nth-child(4) { animation-delay: 80ms; }

@media (max-width: 1200px) {
  .duty-chat-workspace { grid-template-columns: 240px minmax(0, 1fr); height: min(640px, calc(100dvh - 340px)); }
  .duty-chat-context { display: none; }
}
@media (max-width: 768px) {
  .duty-chat-workspace { display: block; height: auto; min-height: 520px; }
  .duty-chat-list { height: 520px; min-height: 520px; border-right: 0; }
  .duty-chat-thread { display: none; height: 520px; min-height: 520px; border-right: 0; }
  .duty-chat-thread--mobile-open { display: flex; }
  .duty-chat-mobile-back { display: grid; }
  .duty-chat-bubble { max-width: 88%; }
}
@media (prefers-reduced-motion: reduce) {
  .duty-chat-session, .duty-chat-action, .duty-chat-bubble, .duty-session-enter-active, .duty-session-leave-active, .duty-session-move, .duty-context-enter-active, .duty-context-leave-active, .duty-thread-enter-active, .duty-thread-leave-active, .refresh-indicator__icon, .duty-chat-workspace, .duty-history-filter, .quality-strip, .dashboard-bar, .dashboard-bar__metrics .metric-pill, .duty-chat-session__unread, .notice-bar, .quality-detail-grid, .duty-chat-filters button, .duty-page::before, .duty-page::after, .dashboard-bar::after, .duty-chat-workspace::before, .quality-funnel__seg, .duty-reply-item { transition: none; animation: none; }
  .duty-chat-session:hover, .duty-chat-session:active, .duty-chat-action:hover, .duty-reply-item:hover { transform: none; }
  .duty-chat-bubble:hover { transform: none; }
  .duty-chat-filters button.active { transform: none; box-shadow: none; }
  .dashboard-bar:hover { box-shadow: var(--shadow-raised), inset 0 1px 0 rgba(255,255,255,.62); }
}

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
  transition: transform 180ms cubic-bezier(.16,1,.3,1), box-shadow 180ms ease;
}

.card-panel.duty-review:hover {
  transform: translateY(-2px);
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
  margin: 3px 8px;
  border: 1px solid transparent;
  border-left: 3px solid transparent;
  border-radius: var(--radius-capsule);
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background var(--transition-fast), border-color var(--transition-fast), padding var(--transition-fast), transform 180ms cubic-bezier(.16,1,.3,1), box-shadow var(--transition-fast);
  position: relative;
}

.duty-reply-item::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 28px;
  right: 28px;
  height: 1px;
  background: linear-gradient(90deg, var(--border-subtle), transparent);
}

.duty-reply-item:last-child::after { display: none; }

.duty-reply-item:hover {
  background: linear-gradient(135deg, color-mix(in srgb, var(--surface-teal) 78%, var(--surface)), color-mix(in srgb, var(--surface-teal) 40%, var(--surface)));
  border-color: color-mix(in srgb, var(--primary) 16%, transparent);
  border-left-color: var(--primary);
  padding-left: 24px;
  transform: translateY(-2px);
  box-shadow: var(--shadow-capsule);
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
  .duty-history-filter { align-items: stretch; flex-direction: column; gap: 10px; }
  .duty-history-filter__picker { width: 100% !important; }
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
:root[data-theme="dark"] .quality-metric { background: linear-gradient(135deg, color-mix(in srgb, var(--surface-teal) 92%, var(--surface)), color-mix(in srgb, var(--surface-teal) 44%, var(--surface))); border-color: color-mix(in srgb, var(--border-teal) 76%, transparent); }
:root[data-theme="dark"] .quality-metric:not(.quality-metric--alert) b { color: color-mix(in srgb, var(--brand-600) 42%, var(--text-primary)); }
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
  background: linear-gradient(135deg, color-mix(in srgb, var(--surface-teal) 92%, var(--surface)), color-mix(in srgb, var(--surface-teal) 46%, var(--surface)));
  border-color: color-mix(in srgb, var(--border-teal) 78%, transparent);
  box-shadow: var(--shadow-capsule);
}
:root[data-theme="dark"] .metric-pill:not(.metric-pill--alert):not(.metric-pill--warn) b { color: color-mix(in srgb, var(--brand-600) 42%, var(--text-primary)); }
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
:root[data-theme="dark"] .duty-history-filter {
  background: color-mix(in srgb, var(--surface-raised) 92%, var(--surface-teal));
}
:root[data-theme="dark"] .duty-history-filter :deep(.el-range-editor) {
  background: var(--surface);
}
:root[data-theme="dark"] .duty-reply {
  background: rgba(255,255,255,.035);
}
:root[data-theme="dark"] .duty-reply:hover {
  background: rgba(255,255,255,.06);
}
:global(:root[data-theme="dark"]) .duty-chat-workspace,
:global(:root[data-theme="dark"]) .duty-chat-list,
:global(:root[data-theme="dark"]) .duty-chat-thread,
:global(:root[data-theme="dark"]) .duty-chat-context { background: color-mix(in srgb, var(--surface) 94%, var(--surface-blue)); }
:global(:root[data-theme="dark"]) .duty-chat-workspace { background: color-mix(in srgb, var(--surface-page) 86%, var(--primary)); box-shadow: 0 18px 40px rgba(0,0,0,.18); }
:global(:root[data-theme="dark"]) .duty-page::before { background: radial-gradient(circle at 8% 10%, rgba(20,184,166,.14), transparent 28%), radial-gradient(circle at 88% 16%, rgba(37,99,235,.11), transparent 24%), linear-gradient(rgba(94,234,212,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(94,234,212,.035) 1px, transparent 1px); background-size: auto, auto, 28px 28px, 28px 28px; }
:global(:root[data-theme="dark"]) .duty-chat-list,
:global(:root[data-theme="dark"]) .duty-chat-thread { background: color-mix(in srgb, var(--surface) 96%, var(--surface-blue)); }
:global(:root[data-theme="dark"]) .duty-chat-session { background: linear-gradient(135deg, color-mix(in srgb, var(--surface-teal) 52%, var(--surface)), color-mix(in srgb, var(--surface) 88%, transparent)); }
:global(:root[data-theme="dark"]) .duty-chat-search,
:global(:root[data-theme="dark"]) .duty-chat-context__section { background: var(--surface-soft); }
:global(:root[data-theme="dark"]) .duty-chat-session:hover,
:global(:root[data-theme="dark"]) .duty-chat-session.selected { background: linear-gradient(100deg, color-mix(in srgb, var(--primary) 17%, var(--surface)), color-mix(in srgb, var(--primary) 6%, var(--surface))); }
:global(:root[data-theme="dark"]) .duty-chat-bubble { background: color-mix(in srgb, var(--surface-soft) 78%, transparent); box-shadow: 0 10px 28px rgba(0,0,0,.2), inset 0 1px 0 rgba(255,255,255,.06); }
:global(:root[data-theme="dark"]) .duty-chat-bubble--ai { background: color-mix(in srgb, var(--primary) 16%, transparent); }
:global(:root[data-theme="dark"]) .duty-chat-bubble--status { background: color-mix(in srgb, var(--warning) 12%, transparent); }
:global(:root[data-theme="dark"]) .duty-chat-action { background: var(--surface-raised); }
:global(:root[data-theme="dark"]) .duty-chat-bubble--latest { box-shadow: 0 10px 30px rgba(0,0,0,.24), inset 0 1px 0 rgba(255,255,255,.08); }

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
  .duty-chat-session.selected { animation: none; }
  .notice-bar { animation: none; }
  .duty-chat-session__unread { animation: none; }
  .quality-detail-grid { animation: none; }
  .refresh-indicator__icon { animation: none; }
}

/* ── 今日值守与人才库视觉对齐 ──
   结构沿用人才库：外层留白，内部以结构面板承载工作内容，实体卡片负责选择反馈。 */
.duty-page--talent .dashboard-bar,
.duty-page--talent .quality-strip,
.duty-page--talent .duty-history-filter {
  border-color: color-mix(in srgb, var(--border-subtle) 82%, transparent);
  background: var(--glass-bg);
  box-shadow: var(--shadow-raised), inset 0 1px 0 var(--glass-highlight);
}
.duty-page--talent .dashboard-bar--active {
  background: linear-gradient(145deg, var(--surface-teal), var(--surface));
  color: var(--text-primary);
  border-color: var(--border-teal);
  animation: duty-surface-in 220ms cubic-bezier(.16,1,.3,1) both;
}
.duty-page--talent .dashboard-bar--active .duty-badge {
  background: var(--surface-teal);
  color: var(--primary);
}
.duty-page--talent .dashboard-bar--active .duty-sub,
.duty-page--talent .dashboard-bar--active .refresh-indicator {
  color: var(--text-secondary);
}
.duty-page--talent .dashboard-bar--active .metric-pill {
  border-color: var(--border-subtle);
  background: var(--surface-soft);
  color: var(--text-secondary);
}
.duty-page--talent .dashboard-bar--active .metric-pill b { color: var(--primary); }
.duty-page--talent .dashboard-bar--active .metric-pill--alert b { color: var(--warning); }

.duty-page--talent .duty-chat-workspace {
  grid-template-columns: minmax(320px, 360px) minmax(0, 1fr) minmax(280px, 320px);
  gap: 20px;
  height: min(720px, calc(100dvh - 350px));
  min-height: 560px;
  max-height: 760px;
  scroll-margin-top: 72px;
  overflow: visible;
  border: 0;
  background: transparent;
  box-shadow: none;
  animation: none;
}
.duty-page--talent .duty-chat-workspace::before { display: none; }
.duty-page--talent .duty-chat-list,
.duty-page--talent .duty-chat-thread,
.duty-page--talent .duty-chat-context {
  border: 1px solid color-mix(in srgb, var(--border-subtle) 82%, transparent);
  border-radius: var(--radius-panel);
  background: var(--glass-bg);
  box-shadow: var(--shadow-raised), inset 0 1px 0 var(--glass-highlight);
}
.duty-page--talent .duty-chat-list,
.duty-page--talent .duty-chat-thread { border-right-width: 1px; }
.duty-page--talent .duty-chat-list__header,
.duty-page--talent .duty-chat-thread__header,
.duty-page--talent .duty-chat-context__header {
  min-height: 82px;
  padding: 18px 20px;
  border-bottom-color: var(--border-teal);
  background: linear-gradient(180deg, var(--surface-soft), var(--surface));
}
.duty-page--talent .duty-chat-list__items {
  display: grid;
  grid-auto-rows: max-content;
  align-content: start;
  gap: 6px;
  padding: 8px;
}
.duty-page--talent .duty-chat-session {
  align-self: start;
  height: auto;
  min-height: 104px;
  padding: 12px 14px;
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-panel);
  background: linear-gradient(135deg, var(--surface), var(--surface-soft));
  box-shadow: 0 1px 2px rgba(17, 28, 45, .03), inset 0 1px 0 rgba(255,255,255,.58);
}
.duty-page--talent .duty-chat-session:hover {
  transform: translateY(-1px);
  background: var(--surface-row);
  box-shadow: var(--shadow-raised);
}
.duty-page--talent .duty-chat-session.selected {
  border-color: var(--border-teal);
  background: linear-gradient(135deg, var(--surface-teal), var(--surface));
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary) 22%, transparent), var(--shadow-raised);
}
.duty-page--talent .duty-chat-session__state {
  display: inline-flex;
  width: fit-content;
  padding: 3px 8px;
  border-radius: var(--radius-pill);
  background: var(--surface-muted);
}
.duty-page--talent .duty-chat-session__context,
.duty-page--talent .duty-chat-session__preview { overflow-wrap: anywhere; }
.duty-page--talent .duty-chat-session__preview { -webkit-line-clamp: 2; }
.duty-page--talent .duty-chat-filters { flex-wrap: nowrap; }
.duty-page--talent .duty-chat-filters button { flex: 0 0 auto; white-space: nowrap; }
.duty-page--talent .duty-chat-thread__title p { display: -webkit-box; overflow: hidden; overflow-wrap: anywhere; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.duty-page--talent .duty-chat-context-toggle { display: none; align-items: center; justify-content: center; gap: 5px; min-height: 34px; padding: 6px 9px; flex: 0 0 auto; border: 1px solid var(--border-subtle); border-radius: var(--radius-control); background: var(--surface-soft); color: var(--text-secondary); font-size: 11px; font-weight: 600; cursor: pointer; }
.duty-page--talent .duty-chat-context-toggle:hover { border-color: var(--border-teal); color: var(--primary); }
.duty-page--talent .duty-chat-context-toggle:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }
.duty-page--talent .duty-chat-thread__body { padding: 20px 22px 26px; background: var(--surface); }
.duty-page--talent .duty-chat-context { overflow-y: auto; }
.duty-page--talent .duty-chat-context__section { margin: 14px 18px; padding: 14px; background: var(--surface-soft); }
.duty-page--talent .duty-chat-context__actions { padding: 14px 18px 20px; }
.duty-page--talent .duty-chat-action { min-height: 40px; }

@media (max-width: 1200px) {
  .duty-page--talent .duty-chat-workspace {
    grid-template-columns: minmax(280px, 320px) minmax(0, 1fr);
    gap: 16px;
    height: min(680px, calc(100dvh - 350px));
    overflow: hidden;
  }
  .duty-page--talent .duty-chat-context { display: block; position: absolute; inset: 0 0 0 auto; z-index: 6; width: min(340px, 45%); max-width: none; border-radius: var(--radius-panel); box-shadow: -16px 0 36px rgba(17,28,45,.14), var(--shadow-raised); }
  .duty-page--talent .duty-chat-context--closed { max-width: none; opacity: 0; overflow: hidden; pointer-events: none; transform: translateX(calc(100% + 20px)); }
  .duty-page--talent .duty-chat-context-toggle { display: inline-flex; }
}
@media (max-width: 768px) {
  .duty-page--talent .duty-chat-workspace { display: block; height: auto; min-height: 520px; }
  .duty-page--talent .duty-chat-list { height: 520px; min-height: 520px; }
  .duty-page--talent .duty-chat-thread { height: 520px; min-height: 520px; margin-top: 16px; }
  .duty-page--talent .duty-chat-context { inset: 536px 0 auto auto; width: 100%; height: 520px; }
}
@media (max-width: 480px) {
  .duty-page--talent .duty-chat-thread__header > .duty-chat-status { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .duty-page--talent .dashboard-bar--active,
  .duty-page--talent .duty-chat-session,
  .duty-page--talent .duty-chat-workspace { animation: none; transition: none; }
  .duty-page--talent .duty-chat-session:hover,
  .duty-page--talent .duty-chat-session:active { transform: none; }
}

:global(:root[data-theme="dark"]) .duty-page--talent .dashboard-bar--active,
:global(:root[data-theme="dark"]) .duty-page--talent .dashboard-bar,
:global(:root[data-theme="dark"]) .duty-page--talent .quality-strip,
:global(:root[data-theme="dark"]) .duty-page--talent .duty-history-filter {
  background: linear-gradient(145deg, var(--surface-teal), var(--surface));
  border-color: var(--border-subtle);
  box-shadow: var(--shadow-raised), inset 0 1px 0 rgba(255,255,255,.05);
}
:global(:root[data-theme="dark"]) .duty-page--talent .duty-chat-list,
:global(:root[data-theme="dark"]) .duty-page--talent .duty-chat-thread,
:global(:root[data-theme="dark"]) .duty-page--talent .duty-chat-context {
  background: var(--surface);
  box-shadow: var(--shadow-raised), inset 0 1px 0 rgba(255,255,255,.04);
}
:global(:root[data-theme="dark"]) .duty-page--talent .duty-chat-list__header,
:global(:root[data-theme="dark"]) .duty-page--talent .duty-chat-thread__header,
:global(:root[data-theme="dark"]) .duty-page--talent .duty-chat-context__header {
  background: linear-gradient(180deg, var(--surface-soft), var(--surface));
}
:global(:root[data-theme="dark"]) .duty-page--talent .duty-chat-session {
  border-color: var(--border-subtle);
  background: linear-gradient(135deg, var(--surface-raised), var(--surface));
  box-shadow: 0 1px 2px rgba(0,0,0,.22), inset 0 1px 0 rgba(255,255,255,.04);
}
:global(:root[data-theme="dark"]) .duty-page--talent .duty-chat-session:hover {
  background: var(--surface-row);
  box-shadow: var(--shadow-raised);
}
:global(:root[data-theme="dark"]) .duty-page--talent .duty-chat-session.selected {
  border-color: var(--border-teal);
  background: linear-gradient(135deg, var(--surface-teal), var(--surface));
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary) 30%, transparent), var(--shadow-raised);
}
:global(:root[data-theme="dark"]) .duty-page--talent .duty-chat-thread__body { background: var(--surface); }
</style>
