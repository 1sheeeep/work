<script setup lang="ts">
import PageHeader from '../components/PageHeader.vue'
import AsyncState from '../components/AsyncState.vue'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, ArrowRight, ChatDotRound, CircleCheck, Clock, Close, InfoFilled, Position, Refresh } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox, ElNotification } from 'element-plus'
import { api, apiErrorMessage, ensureCsrf } from '../services/api'
import { useNotificationCenter } from '../composables/useNotificationCenter'
import type { AiDutyReply, AiDutyReviewRequired, AutoReplyPolicy, BrowserDevice, BrowserUnreadObservation, UnmatchedJobGroup } from '../types'

const router = useRouter(); const notify = useNotificationCenter(); const loading = ref(true); const switching = ref(false); const cycleCancelling = ref(false); const loadError = ref('')
const policies = ref<AutoReplyPolicy[]>([]); const devices = ref<BrowserDevice[]>([]); const observations = ref<BrowserUnreadObservation[]>([]); const groups = ref<UnmatchedJobGroup[]>([])
const dutyReplies = ref<AiDutyReply[]>([])
const dutyReviewRequired = ref<AiDutyReviewRequired[]>([])
const manualReviewObservationIds = computed(() => new Set(dutyReviewRequired.value.map(item => item.observationId)))
const startOpen = ref(false); const hours = ref(2); const tab = ref<'UNREAD'|'DONE'>('UNREAD'); const page = ref(1); const pageInput = ref(1); const selected = ref<BrowserUnreadObservation | null>(null); const jobId = ref('')
const locatingId = ref<string | null>(null)
const dutyRepliesListRef = ref<HTMLElement | null>(null)
const dutyReviewRequiredListRef = ref<HTMLElement | null>(null)
const dutyRepliesScroll = ref({ left: true, right: false })
const dutyReviewRequiredScroll = ref({ left: true, right: false })
const lastRefreshed = ref<Date>(new Date()); const autoRefreshEnabled = ref(true); const refreshIntervalSec = ref(60)
const noticeDismissed = ref(false); const liveMessage = ref(''); const detailPanelRef = ref<HTMLElement | null>(null); const messageListRef = ref<HTMLElement | null>(null)
let noticeTimer: ReturnType<typeof setTimeout> | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
const refreshAgo = computed(() => { const s = Math.floor((Date.now() - lastRefreshed.value.getTime()) / 1000); if (s < 10) return '刚刚'; if (s < 60) return `${s} 秒前`; const m = Math.floor(s / 60); if (m < 60) return `${m} 分钟前`; return `${Math.floor(m / 60)} 小时前` })
const active = computed(() => policies.value.filter(x => x.awayActive)); const watchable = computed(() => policies.value.filter(x => x.accountStatus === 'ACTIVE' && ['CONNECTED','DEGRADED'].includes(x.connectionStatus)))
const currentId = computed(() => observations.value.filter(x => x.detailVerifiedAt).sort((a,b) => +new Date(b.detailVerifiedAt!) - +new Date(a.detailVerifiedAt!))[0]?.id)
const ordered = (items: BrowserUnreadObservation[]) => [...items].sort((a,b) => a.id === currentId.value ? -1 : b.id === currentId.value ? 1 : +new Date(b.latestMessageAt || b.lastSeenAt) - +new Date(a.latestMessageAt || a.lastSeenAt))
const cycleActive = (x:BrowserUnreadObservation) => ['ACTIVE','WAITING_RESUME_REVIEW','WAITING_HUMAN_INTERVIEW'].includes(x.cycleTestStatus)
const unread = computed(() => ordered(observations.value.filter(x => x.unread && x.resolutionStatus === 'UNRESOLVED'))); const workQueue = computed(() => ordered(observations.value.filter(x => manualReviewObservationIds.value.has(x.id) || (x.unread && x.resolutionStatus === 'UNRESOLVED') || cycleActive(x)))); const done = computed(() => ordered(observations.value.filter(x => !manualReviewObservationIds.value.has(x.id) && !cycleActive(x) && (!x.unread || x.resolutionStatus !== 'UNRESOLVED')))); const items = computed(() => tab.value === 'UNREAD' ? workQueue.value : done.value)
const pages = computed(() => Math.max(1, Math.ceil(items.value.length / 6))); const visible = computed(() => items.value.slice((page.value - 1) * 6, page.value * 6)); const online = computed(() => devices.value.filter(x => x.status === 'ACTIVE' && x.runtimeState === 'RUNNING').length); const drafts = computed(() => unread.value.filter(x => x.draftQualification === 'KNOWLEDGE_READY').length); const issues = computed(() => new Set(devices.value.filter(x => x.status === 'ACTIVE' && x.runtimeState !== 'RUNNING').map(x => x.accountId)).size)
const selectedGroup = computed(() => selected.value ? groups.value.find(x => x.observationIds.includes(selected.value!.id)) : undefined); const candidates = computed(() => selectedGroup.value?.candidates.filter(x => x.knowledgeReady) ?? [])
const labels: Record<BrowserUnreadObservation['eligibilityStatus'],string> = { OBSERVING:'观察中',AWAY_INACTIVE:'未挂机',SNAPSHOT_CONFIRMATION_REQUIRED:'等待确认',DETAIL_REQUIRED:'等待详情',READY_FOR_REVIEW:'待处理',HR_REPLIED:'HR 已回复',HR_HANDLED:'已处理',APPROVED_DRAFT:'草稿已审核',REJECTED:'已忽略',HUMAN_TAKEOVER:'人工接管',AWAITING_REPLY:'等待求职者回复',CYCLE_ACTIVE:'周期测试进行中' }
const fill: Record<BrowserUnreadObservation['fillStatus'],string> = { NONE:'尚未批准填入',READY:'待填入 BOSS',CLAIMED:'填入中',FILLED:'已填入未发送',UNKNOWN:'结果待人工确认' }
const stageLabels = { UNKNOWN:'阶段待识别',INITIAL_CONTACT:'首次接触',AWAITING_REPLY:'等待求职者回复',CAN_REQUEST_RESUME:'可索要简历',RESUME_REQUESTED:'已索要简历',RESUME_RECEIVED:'简历已到达',RESUME_APPROVED:'简历已通过复核',CAN_EXCHANGE_CONTACT:'可交换联系方式',CONTACT_EXCHANGED:'联系方式已交换',CAN_SCHEDULE_INTERVIEW:'待人工约面试',INTERVIEW_SCHEDULED:'面试已确认' } as const
const cycleLabels:Record<BrowserUnreadObservation['cycleTestStatus'],string>={NOT_STARTED:'未启动',ACTIVE:'自动阶段进行中',WAITING_RESUME_REVIEW:'等待 HR 审核简历',WAITING_HUMAN_INTERVIEW:'等待 HR 安排面试',COMPLETED:'周期已完成',FAILED:'周期已停止',CANCELLED:'周期已取消'}
const resumePipelineLabels={NOT_DETECTED:'等待识别',DETECTED:'已识别，等待导入',IMPORTING:'正在导入',ANALYZING:'AI 分析中',SUCCEEDED:'分析完成',FAILED:'处理失败'} as const
function effectiveResumePipelineStatus(item:BrowserUnreadObservation){return item.resumePipelineStatus&&item.resumePipelineStatus!=='NOT_DETECTED'?item.resumePipelineStatus:item.cycleTestStatus==='WAITING_RESUME_REVIEW'?'DETECTED':'NOT_DETECTED'}
function resumePipelineStep(item:BrowserUnreadObservation){return ({NOT_DETECTED:0,DETECTED:1,IMPORTING:2,ANALYZING:3,SUCCEEDED:4,FAILED:3} as Record<string,number>)[effectiveResumePipelineStatus(item)]??0}
function resumePipelineTag(item:BrowserUnreadObservation){const status=effectiveResumePipelineStatus(item);return status==='FAILED'?'danger':status==='SUCCEEDED'?'success':status==='DETECTED'?'warning':'primary'}
function openResumeAnalysis(item:BrowserUnreadObservation){router.push({path:'/resume-intakes',query:item.resumeIntakeId?{intake:item.resumeIntakeId}:{}})}

function showQueueHelp() {
  ElNotification({
    title: '消息队列说明',
    message: '消息队列仅展示匿名求职者、岗位与招聘账号，不显示消息正文。每页固定展示 6 条记录，支持一键定位到 BOSS 会话。',
    duration: 4000,
    type: 'info',
  })
}
function scrollDutyList(refKey: 'dutyReplies' | 'dutyReviewRequired', dir: 'left' | 'right') {
  const el = refKey === 'dutyReplies' ? dutyRepliesListRef.value : dutyReviewRequiredListRef.value
  if (!el) return
  const amount = el.clientWidth * 0.75
  el.scrollBy({ left: dir === 'left' ? -amount : amount, behavior: 'smooth' })
}
function updateDutyScrollState(refKey: 'dutyReplies' | 'dutyReviewRequired') {
  const el = refKey === 'dutyReplies' ? dutyRepliesListRef.value : dutyReviewRequiredListRef.value
  if (!el) return
  const atLeft = el.scrollLeft <= 2
  const atRight = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2
  if (refKey === 'dutyReplies') dutyRepliesScroll.value = { left: atLeft, right: atRight }
  else dutyReviewRequiredScroll.value = { left: atLeft, right: atRight }
}

async function load(silent = false){
  if (!silent) { loading.value = true; loadError.value = '' }
  const previousReviewIds = new Set(dutyReviewRequired.value.map(x => x.id))
  try {
    const [p, d, o, g, r, reviewRequired] = await Promise.all([
      api.get<AutoReplyPolicy[]>('/auto-replies/policies'),
      api.get<BrowserDevice[]>('/local-connector/devices'),
      api.get<BrowserUnreadObservation[]>('/local-connector/observations'),
      api.get<UnmatchedJobGroup[]>('/local-connector/observations/unmatched-job-groups'),
      api.get<AiDutyReply[]>('/local-connector/ai-duty-replies'),
      api.get<AiDutyReviewRequired[]>('/local-connector/ai-duty-review-required')
    ])
    policies.value = p.data; devices.value = d.data; observations.value = o.data; groups.value = g.data; dutyReplies.value = r.data; dutyReviewRequired.value = reviewRequired.data
    lastRefreshed.value = new Date()
    const newManualReviews = reviewRequired.data.filter(x => !previousReviewIds.has(x.id))
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
function select(item:BrowserUnreadObservation){selected.value=item;jobId.value='';nextTick(()=>{detailPanelRef.value?.focus()})}; function closeDetail(){const prevId=selected.value?.id;selected.value=null;if(prevId){const el=messageListRef.value?.querySelector(`[data-id="${prevId}"]`) as HTMLElement;el?.focus()}}; function move(value:number){page.value=Math.min(Math.max(1,value),pages.value);pageInput.value=page.value}; function age(value:string){const n=Math.max(0,Math.floor((Date.now()- +new Date(value))/60000));return n<60?`${n} 分钟`:n<1440?`${Math.floor(n/60)} 小时`:`${Math.floor(n/1440)} 天`}
function openDutyReply(reply:AiDutyReply){const item=observations.value.find(x=>x.id===reply.observationId);if(!item)return ElMessage.warning('该会话已超出当前消息列表范围');select(item)}
function openDutyReviewRequired(item:AiDutyReviewRequired){const observation=observations.value.find(x=>x.id===item.observationId);if(!observation)return ElMessage.warning('该会话已超出当前消息列表范围，请刷新后重试');select(observation)}
async function locateInBoss(item:BrowserUnreadObservation){
  locatingId.value=item.id
  try{await ensureCsrf();await api.post(`/local-connector/observations/${item.id}/locate`);ElMessage.success('正在打开对应的 BOSS 会话')}
  catch(e){ElMessage.error(apiErrorMessage(e,'无法定位到 BOSS 会话'))}
  finally{locatingId.value=null}
}
function priorityOf(item:BrowserUnreadObservation){if(item.eligibilityStatus==='READY_FOR_REVIEW')return 'urgent';if(item.eligibilityStatus==='SNAPSHOT_CONFIRMATION_REQUIRED'||item.eligibilityStatus==='DETAIL_REQUIRED')return 'high';return 'normal'}
function cycleStep(item:BrowserUnreadObservation){const steps:Record<string,number>={INITIAL_CONTACT:0,AWAITING_REPLY:1,CAN_REQUEST_RESUME:2,RESUME_REQUESTED:2,RESUME_RECEIVED:3,RESUME_APPROVED:4,CAN_EXCHANGE_CONTACT:4,CONTACT_EXCHANGED:5,CAN_SCHEDULE_INTERVIEW:5,INTERVIEW_SCHEDULED:6};return steps[item.conversationStage||'UNKNOWN']??0}
const priorityColor:Record<string,string>={urgent:'var(--warning)',high:'var(--color-info)',normal:'transparent'}
function avatarHue(name:string){let h=0;for(let i=0;i<name.length;i++)h=name.charCodeAt(i)+((h<<5)-h);return Math.abs(h)%360}
function dismissNotice(){noticeDismissed.value=true;if(noticeTimer){clearTimeout(noticeTimer);noticeTimer=null}}
function onListKeydown(e:KeyboardEvent){if(e.key==='Escape'&&selected.value){e.preventDefault();closeDetail();return}if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const rows=messageListRef.value?.querySelectorAll('.message-row');if(!rows?.length)return;const focused=document.activeElement;let idx=Array.from(rows).indexOf(focused as Element);if(idx===-1)idx=0;else idx+=e.key==='ArrowDown'?1:-1;idx=Math.max(0,Math.min(rows.length-1,idx));(rows[idx] as HTMLElement)?.focus()}}
function toggle(value:boolean|string|number){if(Boolean(value)){if(!watchable.value.length)return ElMessage.warning('请先连接至少一个招聘账号');startOpen.value=true}else void stop()}
async function start(){switching.value=true;try{await ensureCsrf();const endsAt=new Date(Date.now()+hours.value*3600000).toISOString();await Promise.all(watchable.value.map(x=>api.put(`/auto-replies/policies/${x.accountId}/away-mode`,{mode:hours.value>=24?'AFTER_HOURS':'TEMPORARY',endsAt,autoReplyEnabled:true})));startOpen.value=false;ElMessage.success('自动值守已开启，当前未读将立即进入处理');await load()}catch(e){ElMessage.error(apiErrorMessage(e,'挂机值守开启失败'))}finally{switching.value=false}}
async function stop(){try{await ElMessageBox.confirm('确认结束全部招聘账号的自动值守?','结束挂机');switching.value=true;await ensureCsrf();await Promise.all(active.value.map(x=>api.put(`/auto-replies/policies/${x.accountId}/away-mode`,{mode:'IN_OFFICE',endsAt:null,autoReplyEnabled:false})));await load()}catch(e){if(e!=='cancel'&&e!=='close')ElMessage.error(apiErrorMessage(e,'挂机值守结束失败'))}finally{switching.value=false}}
async function review(decision:'APPROVED'|'HUMAN_TAKEOVER'){if(!selected.value)return;try{let content:string|null=null,note='';if(decision==='APPROVED'){if(selected.value.draftQualification!=='KNOWLEDGE_READY')return ElMessage.warning('岗位回复资料尚未就绪');content=(await ElMessageBox.prompt('核对本次回复草稿','审核回复草稿',{inputValue:selected.value.reviewedContent||selected.value.draftContent||'',inputType:'textarea'})).value}else note=(await ElMessageBox.prompt('填写接管备注','人工接管')).value;await ensureCsrf();await api.put(`/local-connector/observations/${selected.value.id}/review`,{decision,content,note});selected.value=null;await load()}catch(e){if(e!=='cancel'&&e!=='close')ElMessage.error(apiErrorMessage(e,'会话处理失败'))}}
async function startCycleTest(){if(!selected.value)return;try{if(selected.value.selectedConversationUnread)return ElMessage.warning('请先在 BOSS 中打开该会话并确认其已读');if(selected.value.draftQualification!=='KNOWLEDGE_READY')return ElMessage.warning('请先关联并审核真实岗位资料');const content=(await ElMessageBox.prompt('确认首次联系内容','启动单会话完整周期测试',{inputValue:selected.value.reviewedContent||selected.value.draftContent||'',inputType:'textarea',confirmButtonText:'下一步'})).value;await ElMessageBox.confirm('只会对当前匿名定位码对应的已读会话执行；后续简历到达时会暂停等待人工复核，面试不会自动安排。','确认启动完整周期测试',{type:'warning',confirmButtonText:'确认启动'});await ensureCsrf();const response=await api.post<BrowserUnreadObservation>(`/local-connector/observations/${selected.value.id}/cycle-test/start`,{content,confirmed:true});selected.value=response.data;ElMessage.success('完整周期测试已启动，请保持目标会话处于选中状态');await load(true)}catch(e){if(e!=='cancel'&&e!=='close')ElMessage.error(apiErrorMessage(e,'完整周期测试启动失败'))}}
async function cancelCycleTest(){if(!selected.value||!cycleActive(selected.value))return;try{await ElMessageBox.confirm('将停止当前会话的周期测试，并取消所有尚未执行的自动动作。已完成的 BOSS 操作不会撤回。','取消完整周期测试',{type:'warning',confirmButtonText:'确认取消',cancelButtonText:'继续测试'});cycleCancelling.value=true;await ensureCsrf();const response=await api.post<BrowserUnreadObservation>(`/local-connector/observations/${selected.value.id}/cycle-test/cancel`,{confirmed:true,note:'HR 在值守台主动取消完整周期测试'});selected.value=response.data;ElMessage.success('周期测试已取消，可以重新开始');await load(true)}catch(e){if(e!=='cancel'&&e!=='close')ElMessage.error(apiErrorMessage(e,'周期测试取消失败'))}finally{cycleCancelling.value=false}}
async function reviewCycleResume(decision:'APPROVED'|'REJECTED'){if(!selected.value)return;try{const note=(await ElMessageBox.prompt(decision==='APPROVED'?'确认该简历可以进入联系方式交换阶段':'填写停止原因','人工复核简历',{confirmButtonText:decision==='APPROVED'?'审核通过':'停止周期'})).value;await ensureCsrf();const response=await api.put<BrowserUnreadObservation>(`/local-connector/observations/${selected.value.id}/cycle-test/resume-review`,{decision,note});selected.value=response.data;ElMessage.success(decision==='APPROVED'?'简历已通过，系统将在页面条件满足时优先交换微信':'周期已停止并转人工处理');await load(true)}catch(e){if(e!=='cancel'&&e!=='close')ElMessage.error(apiErrorMessage(e,'简历复核失败'))}}
async function match(){const group=selectedGroup.value,job=candidates.value.find(x=>x.id===jobId.value);if(!group||!job)return ElMessage.warning('请选择一个已就绪的真实岗位');try{await ensureCsrf();await api.put('/local-connector/observations/manual-job-match',{observationIds:group.observationIds,jobPositionId:job.id,observedTitle:group.observedTitle,confirmedJobTitle:job.title,confirmed:true});selected.value=null;await load()}catch(e){ElMessage.error(apiErrorMessage(e,'岗位关联失败'))}}
watch([tab,items],()=>move(1))
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

      <!-- ── 通知条（可关闭 + 15s 自动消失） ── -->
      <div v-if="issues && !noticeDismissed" class="notice-bar">
        <el-icon><InfoFilled /></el-icon>
        <span>{{ issues }} 个账号连接需要检查</span>
        <button class="notice-bar__link" @click="router.push('/boss-accounts')">检查账号 →</button>
        <button class="notice-bar__close" aria-label="关闭通知" @click="dismissNotice">
          <el-icon :size="14"><Close /></el-icon>
        </button>
      </div>

      <section class="card-panel duty-review" aria-labelledby="duty-review-title">
        <header class="duty-review__header">
          <div>
            <span class="duty-review__eyebrow">过去 24 小时</span>
            <h2 id="duty-review-title">AI 值守回顾</h2>
            <p>仅展示已收到浏览器成功回执的回复，不包含候选人原始消息。</p>
          </div>
          <div class="duty-review__header-right">
            <span class="duty-review__count"><b>{{ dutyReplies.length }}</b> 次已回复</span>
            <div v-if="dutyReplies.length > 5" class="duty-review__arrows">
              <button class="scroll-arrow" :disabled="dutyRepliesScroll.left" @click="scrollDutyList('dutyReplies','left')" aria-label="向左滚动">
                <el-icon :size="14"><ArrowLeft /></el-icon>
              </button>
              <button class="scroll-arrow" :disabled="dutyRepliesScroll.right" @click="scrollDutyList('dutyReplies','right')" aria-label="向右滚动">
                <el-icon :size="14"><ArrowRight /></el-icon>
              </button>
            </div>
          </div>
        </header>
        <AsyncState v-if="!dutyReplies.length" state="empty" embedded title="暂无 AI 自动回复记录" message="挂机期间确认发送成功的回复会出现在这里。">
          <template #icon><el-icon><ChatDotRound /></el-icon></template>
        </AsyncState>
        <div v-else ref="dutyRepliesListRef" class="duty-review__list" @scroll="updateDutyScrollState('dutyReplies')">
          <button v-for="reply in dutyReplies" :key="reply.id" class="duty-reply" type="button" @click="openDutyReply(reply)">
            <span class="duty-reply__status" :class="{ followup: reply.needsFollowUp }"></span>
            <span class="duty-reply__main">
              <strong>{{ reply.jobTitle }}</strong>
              <small>{{ reply.accountName }}</small>
              <span>{{ reply.replyContent }}</span>
            </span>
            <span class="duty-reply__meta">
              <em v-if="reply.needsFollowUp" :title="reply.followUpReason || '有新回复，待跟进'">{{ reply.followUpReason || '有新回复，待跟进' }}</em>
              <time :datetime="reply.sentAt">{{ new Date(reply.sentAt).toLocaleTimeString('zh-CN', { hour:'2-digit', minute:'2-digit' }) }}</time>
            </span>
          </button>
        </div>
      </section>

      <section class="card-panel duty-review duty-review--required" aria-labelledby="duty-review-required-title">
        <header class="duty-review__header">
          <div>
            <span class="duty-review__eyebrow">过去 24 小时</span>
            <h2 id="duty-review-required-title">已读未回复 · 待 HR 复核</h2>
            <p>收录面试时间协商、无关或敏感内容、含义不清及事实校验未通过，且仍待 HR 处理的会话。</p>
          </div>
          <div class="duty-review__header-right">
            <span class="duty-review__count duty-review__count--warning"><b>{{ dutyReviewRequired.length }}</b> 条待复核</span>
            <div v-if="dutyReviewRequired.length > 5" class="duty-review__arrows">
              <button class="scroll-arrow" :disabled="dutyReviewRequiredScroll.left" @click="scrollDutyList('dutyReviewRequired','left')" aria-label="向左滚动">
                <el-icon :size="14"><ArrowLeft /></el-icon>
              </button>
              <button class="scroll-arrow" :disabled="dutyReviewRequiredScroll.right" @click="scrollDutyList('dutyReviewRequired','right')" aria-label="向右滚动">
                <el-icon :size="14"><ArrowRight /></el-icon>
              </button>
            </div>
          </div>
        </header>
        <AsyncState v-if="!dutyReviewRequired.length" state="empty" embedded title="暂无已读未回复会话" message="AI 安全跳过的无关消息会出现在这里，便于 HR 返回后复核。">
          <template #icon><el-icon><CircleCheck /></el-icon></template>
        </AsyncState>
        <div v-else ref="dutyReviewRequiredListRef" class="duty-review__list" @scroll="updateDutyScrollState('dutyReviewRequired')">
          <button v-for="item in dutyReviewRequired" :key="item.id" class="duty-reply duty-reply--required" type="button" @click="openDutyReviewRequired(item)">
            <span class="duty-reply__status followup"></span>
            <span class="duty-reply__main">
              <strong>匿名求职者</strong>
              <small>{{ item.jobTitle }} · {{ item.accountName }}</small>
              <span>{{ item.reason }}</span>
            </span>
            <span class="duty-reply__meta"><em>AI 未回复，需人工判断</em><time :datetime="item.decidedAt">{{ new Date(item.decidedAt).toLocaleTimeString('zh-CN', { hour:'2-digit', minute:'2-digit' }) }}</time></span>
          </button>
        </div>
      </section>

      <!-- ── 屏幕阅读器实时播报 ── -->
      <div aria-live="polite" aria-atomic="true" class="sr-only">{{ liveMessage }}</div>

      <!-- ── 双栏工作区 ── -->
      <div class="workspace-split">
        <!-- 左栏：消息队列 -->
        <section class="queue-column">
          <article id="message-queue" class="card-panel queue">
            <header>
              <div>
                <h2>消息队列</h2>
                <p>按匿名求职者与应聘岗位展示；每页 6 条。</p>
              </div>
              <div class="tabs">
                <button :class="{ active: tab === 'UNREAD' }" :aria-pressed="tab === 'UNREAD'" @click="tab = 'UNREAD'">未读 {{ unread.length }}</button>
                <button :class="{ active: tab === 'DONE' }" :aria-pressed="tab === 'DONE'" @click="tab = 'DONE'">最近处理</button>
              </div>
            </header>

            <AsyncState v-if="!visible.length" state="empty" embedded :title="'当前没有' + (tab === 'UNREAD' ? '未读' : '已处理') + '消息'" message="新的会话状态产生后会在这里显示。">
              <template #icon><el-icon><Clock /></el-icon></template>
            </AsyncState>

            <div v-else class="message-list" ref="messageListRef" @keydown="onListKeydown">
              <article
                v-for="item in visible" :key="item.id" class="message-row"
                :class="{
                  selected: item.id === selected?.id,
                  current: item.id === currentId,
                  'message--review': item.eligibilityStatus === 'READY_FOR_REVIEW',
                  'message--manual': manualReviewObservationIds.has(item.id),
                  'message--high': priorityOf(item) === 'high'
                }"
                :data-id="item.id"
                tabindex="0" role="button"
                :aria-label="`查看 ${item.observedJobTitle || '待识别岗位'} 的消息`"
                @click="select(item)" @keydown.enter="select(item)" @keydown.space.prevent="select(item)"
              >
                <span class="message-row__priority" :style="{ background: priorityColor[priorityOf(item)] }"></span>
                <div class="message-row__avatar" :style="{ background: `hsl(${avatarHue(item.anonymousKey)}, 65%, 93%)`, color: `hsl(${avatarHue(item.anonymousKey)}, 55%, 35%)` }">求</div>
                <div class="message-row__info">
                  <strong class="message-row__title">匿名求职者</strong>
                  <span class="message-row__meta">
                    {{ item.observedJobTitle || '岗位待识别' }} · {{ item.accountName }}
                    <em v-if="item.id === currentId">当前浏览器会话</em>
                  </span>
                </div>
                <div class="message-row__stats">
                  <span v-if="manualReviewObservationIds.has(item.id)" class="message-row__manual">需 HR 手动处理</span>
                  <span class="message-row__badge">{{ item.unreadCount }} 条未读</span>
                  <span class="message-row__age">{{ age(item.firstSeenAt) }}</span>
                </div>
              </article>
            </div>

            <footer>
              <span>共 {{ items.length }} 条 · 已处理 {{ done.length }} 条</span>
              <el-button :disabled="page === 1" @click="move(page - 1)">上一页</el-button>
              <b>{{ page }} / {{ pages }}</b>
              <el-button :disabled="page === pages" @click="move(page + 1)">下一页</el-button>
              <label v-if="pages > 3">前往 <el-input-number v-model="pageInput" :min="1" :max="pages" controls-position="right" @change="move(Number(pageInput))" /> 页</label>
            </footer>
          </article>
        </section>

        <!-- 右栏：详情面板 -->
        <aside class="detail-panel" :class="{ 'detail-panel--open': selected }" ref="detailPanelRef" tabindex="-1" role="complementary" :aria-label="selected ? '消息详情' : '详情面板'">
          <Transition name="detail-fade" mode="out-in">
            <div v-if="selected" key="detail" class="detail-inner">
              <header class="detail-header">
                <div class="detail-header__title">
                  <span class="detail-header__avatar" :style="{ background: `hsl(${avatarHue(selected.accountName)}, 65%, 93%)`, color: `hsl(${avatarHue(selected.accountName)}, 55%, 35%)` }">{{ (selected.observedJobTitle || '待').slice(0, 1) }}</span>
                  <div>
                    <h3>{{ selected.observedJobTitle || '岗位待识别' }}</h3>
                    <small>{{ selected.accountName }}</small>
                  </div>
                </div>
                <div class="detail-header__actions">
                  <el-button :icon="Position" :loading="locatingId === selected.id" @click="locateInBoss(selected)">定位到 BOSS 会话</el-button>
                  <button class="detail-close" aria-label="关闭详情" @click="closeDetail"><el-icon :size="16"><Close /></el-icon></button>
                </div>
              </header>

            <div class="detail-body">
              <div class="detail-status">
                <span class="detail-status__item">
                  <b>状态</b>
                  <span :class="{ 'detail-status--review': selected.eligibilityStatus === 'READY_FOR_REVIEW' }">{{ labels[selected.eligibilityStatus] }}</span>
                </span>
                <span class="detail-status__item">
                  <b>未读</b>
                  <span>{{ selected.unreadCount }} 条</span>
                </span>
                <span class="detail-status__item">
                  <b>时长</b>
                  <span>{{ age(selected.firstSeenAt) }}</span>
                </span>
                <span class="detail-status__item">
                  <b>招聘阶段</b>
                  <span>{{ stageLabels[selected.conversationStage || 'UNKNOWN'] }}</span>
                </span>
              </div>

              <section v-if="selected.cycleTestStatus !== 'NOT_STARTED'" class="cycle-progress" aria-label="完整招聘周期测试进度">
                <header>
                  <strong>单会话完整周期测试</strong>
                  <el-tag size="small" :type="selected.cycleTestStatus === 'FAILED' ? 'danger' : selected.cycleTestStatus === 'WAITING_RESUME_REVIEW' ? 'warning' : 'success'">{{ cycleLabels[selected.cycleTestStatus] }}</el-tag>
                </header>
                <el-steps :active="cycleStep(selected)" simple finish-status="success">
                  <el-step title="首次联系" />
                  <el-step title="等待回复" />
                  <el-step title="索要简历" />
                  <el-step title="简历复核" />
                  <el-step title="交换联系" />
                  <el-step title="人工约面" />
                </el-steps>
                <p>当前：{{ stageLabels[selected.conversationStage || 'UNKNOWN'] }}。测试周期免能力与生产批准；动作仍严格锁定当前会话，并使用单次租约防止重复执行。</p>
              </section>

              <section v-if="selected.conversationSignals?.resumeReceived || effectiveResumePipelineStatus(selected) !== 'NOT_DETECTED'" class="resume-pipeline" aria-live="polite" aria-label="简历导入与 AI 分析状态">
                <header>
                  <div>
                    <strong>简历导入与 AI 分析</strong>
                    <small v-if="selected.resumePipelineUpdatedAt">更新于 {{ new Date(selected.resumePipelineUpdatedAt).toLocaleTimeString('zh-CN', { hour:'2-digit', minute:'2-digit', second:'2-digit' }) }}</small>
                  </div>
                  <el-tag size="small" :type="resumePipelineTag(selected)">{{ resumePipelineLabels[effectiveResumePipelineStatus(selected)] }}</el-tag>
                </header>
                <el-progress :percentage="resumePipelineStep(selected) * 25" :status="selected.resumePipelineStatus === 'FAILED' ? 'exception' : selected.resumePipelineStatus === 'SUCCEEDED' ? 'success' : undefined" :stroke-width="8" />
                <div class="resume-pipeline__steps" aria-hidden="true">
                  <span :class="{ active: resumePipelineStep(selected) >= 1 }">已识别</span>
                  <span :class="{ active: resumePipelineStep(selected) >= 2 }">已导入</span>
                  <span :class="{ active: resumePipelineStep(selected) >= 3 }">AI 分析</span>
                  <span :class="{ active: resumePipelineStep(selected) >= 4 }">已完成</span>
                </div>
                <p :class="{ 'resume-pipeline__error': selected.resumePipelineStatus === 'FAILED' }">{{ selected.resumePipelineReason || '等待插件识别并提取 BOSS 在线简历。' }}</p>
                <el-button v-if="selected.resumeIntakeId" type="primary" plain @click="openResumeAnalysis(selected)">查看分析结果</el-button>
              </section>

              <section v-if="selectedGroup" class="detail-match">
                <strong>关联真实岗位</strong>
                <small>选择同账号已就绪岗位</small>
                <el-select v-model="jobId" placeholder="选择同账号已就绪岗位" style="width:100%">
                  <el-option v-for="job in candidates" :key="job.id" :label="job.title" :value="job.id" />
                </el-select>
                <el-button type="primary" :disabled="!jobId" @click="match">确认关联</el-button>
              </section>

              <section v-if="selected.draftContent" class="detail-draft">
                <header>
                  <strong>回复草稿</strong>
                  <el-tag v-if="cycleActive(selected)" size="small" type="success">周期测试已授权</el-tag>
                  <el-tag v-else-if="selected.reviewStatus === 'APPROVED'" size="small">{{ fill[selected.fillStatus] }}</el-tag>
                </header>
                <p>{{ selected.reviewedContent || selected.draftContent }}</p>
                <small v-if="selected.fillStatus === 'FILLED'">已填入未发送，需人工确认。</small>
              </section>
            </div>

            <footer v-if="selected.cycleTestStatus === 'WAITING_RESUME_REVIEW'" class="detail-actions">
              <el-button @click="reviewCycleResume('REJECTED')">不通过并转人工</el-button>
              <el-button type="primary" @click="reviewCycleResume('APPROVED')">简历审核通过</el-button>
            </footer>
            <footer v-else-if="cycleActive(selected)" class="detail-actions cycle-start-actions">
              <span>取消后，尚未执行的自动动作将全部停止。</span>
              <el-button type="danger" plain :loading="cycleCancelling" @click="cancelCycleTest">取消测试</el-button>
            </footer>
            <footer v-else-if="selected.eligibilityStatus === 'READY_FOR_REVIEW'" class="detail-actions">
              <el-button @click="review('HUMAN_TAKEOVER')">人工接管</el-button>
              <el-button type="primary" @click="review('APPROVED')">审核草稿</el-button>
            </footer>
            <footer v-else-if="['NOT_STARTED','CANCELLED','FAILED','COMPLETED'].includes(selected.cycleTestStatus) && !selected.selectedConversationUnread" class="detail-actions cycle-start-actions">
              <span>开始前可先定位并确认 BOSS 当前会话。</span>
              <el-button type="primary" :disabled="selected.draftQualification !== 'KNOWLEDGE_READY'" @click="startCycleTest">{{ selected.cycleTestStatus === 'NOT_STARTED' ? '启动完整周期测试' : '重新开始测试' }}</el-button>
            </footer>
            </div>
          </Transition>

          <div v-if="!selected" class="detail-empty">
            <div class="detail-empty__icon">
              <el-icon :size="40" color="var(--text-tertiary)"><ChatDotRound /></el-icon>
            </div>
            <p>选择一条消息查看详情</p>
            <small>点击左侧列表中的任意消息</small>
            <small class="detail-empty__hint">快捷键：↑↓ 切换消息 · Esc 关闭</small>
          </div>
        </aside>
      </div>
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
  padding: 12px 20px;
  margin-bottom: 16px;
  border-radius: var(--radius-panel);
  border: 1px solid var(--border-teal);
  background: var(--surface-teal);
  box-shadow: var(--shadow-rest);
  transition: background 300ms ease, border-color 300ms ease;
}
.dashboard-bar--active {
  background: linear-gradient(135deg, #0d9488 0%, #0f766e 50%, #0c1f2d 100%);
  background-size: 200% 200%;
  animation: barShimmer 6s ease-in-out infinite;
  border-color: var(--brand-600);
  color: white;
}
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
  padding: 5px 12px;
  border-radius: var(--radius-pill);
  background: var(--surface);
  border: 1px solid var(--border-subtle);
  font-size: 12px;
  color: var(--text-secondary);
  transition: background 200ms ease, border-color 200ms ease, color 200ms ease;
}
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

.duty-review { margin-bottom:16px; padding:0; overflow:hidden; }
.duty-review__header { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:16px 20px; border-bottom:1px solid var(--border); }
.duty-review__header h2 { margin:2px 0 0; }
.duty-review__header p { margin:4px 0 0; color:var(--text-secondary); font-size:12px; }
.duty-review__eyebrow { color:var(--primary); font-size:11px; font-weight:700; }
.duty-review__header-right { display:flex; align-items:center; gap:10px; flex-shrink:0; }
.duty-review__count { flex:0 0 auto; padding:6px 10px; border-radius:var(--radius-pill); background:var(--surface-teal); color:var(--text-secondary); font-size:12px; }
.duty-review__count b { color:var(--primary); font-size:16px; }
.duty-review__arrows { display:flex; gap:4px; }
.duty-review__list { display:flex; overflow-x:auto; scroll-behavior:smooth; scrollbar-width:thin; scrollbar-color:var(--border-subtle) transparent; }
.scroll-arrow { display:grid; place-items:center; width:28px; height:28px; padding:0; border:1px solid var(--border-subtle); border-radius:6px; background:var(--surface); color:var(--text-secondary); cursor:pointer; transition:background var(--transition-fast),color var(--transition-fast),border-color var(--transition-fast); }
.scroll-arrow:hover:not(:disabled) { background:var(--surface-soft); color:var(--primary); border-color:var(--border-teal); }
.scroll-arrow:disabled { opacity:0.3; cursor:not-allowed; }
.duty-reply { display:grid; grid-template-columns:8px minmax(0,1fr); gap:8px; flex-shrink:0; width:200px; padding:14px 16px; border:0; border-right:1px solid var(--border-subtle); background:var(--surface); color:var(--text-primary); text-align:left; cursor:pointer; }
.duty-reply:last-child { border-right:0; }
.duty-reply:hover { background:var(--surface-row); }
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
  gap: 20px;
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
  padding: 0;
  border-radius: var(--radius-panel);
  border: 1px solid var(--border-subtle);
  background: var(--surface);
  position: relative;
  box-shadow: var(--shadow-rest);
  transition: box-shadow var(--transition-normal);
}
.queue:hover { box-shadow: var(--shadow-hover); }
.queue > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
  background: linear-gradient(180deg, var(--surface), var(--surface-soft));
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
  transition: background var(--transition-fast);
}
.message-row__priority {
  grid-row: 1;
  grid-column: 1;
  width: 3px;
  height: 100%;
  min-height: 36px;
  border-radius: 0 2px 2px 0;
  align-self: stretch;
  transition: background 200ms ease;
}
.message-row__avatar { grid-column: 2; }
.message-row:last-child { border-bottom: 0; }
.message-row:hover { background: var(--surface-row); }
.message-row:focus-visible {
  outline: 2px solid var(--border-focus);
  outline-offset: -2px;
  border-radius: 4px;
  z-index: 1;
}
.message-row.selected {
  background: var(--brand-50);
}
.message-row.current {
  background: var(--brand-50);
}
.message-row.selected.current {
  background: var(--brand-50);
}
.message-row.message--review {
  background: linear-gradient(135deg, rgba(255,247,233,.9), rgba(255,243,225,.7));
  border: 1px solid var(--border-amber);
  border-radius: var(--radius-control);
  margin: 0 6px;
}
.message-row.message--high {
  background: linear-gradient(135deg, rgba(241,246,253,.9), rgba(241,246,253,.6));
}
.message-row.message--manual {
  margin: 4px 6px;
  border: 1px solid var(--border-amber);
  border-radius: var(--radius-control);
  background: var(--surface-amber);
  box-shadow: 0 4px 14px rgba(183,110,0,.09);
}
.message-row.message--manual .message-row__priority { background: var(--warning) !important; }
.message-row.message--manual .message-row__avatar { background: rgba(183,110,0,.12) !important; color: var(--warning) !important; }

.message-row__avatar {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  border-radius: 9px;
  font-size: 14px;
  font-weight: 700;
  transition: background 200ms ease, color 200ms ease;
}
.message-row.selected .message-row__avatar { background: rgba(13,148,136,.15); }
.message-row.current .message-row__avatar { background: rgba(13,148,136,.12); }
.message-row.message--review .message-row__avatar { background: rgba(183,110,0,.1); color: var(--warning); }

.message-row__info { min-width: 0; }
.message-row__title {
  display: block;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.message-row__meta {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}
.message-row__meta em {
  display: inline;
  font-style: normal;
  color: var(--primary);
  font-weight: 500;
}

.message-row__stats { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; }
.message-row__badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: var(--radius-pill);
  background: var(--surface-soft);
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
}
.message-row.selected .message-row__badge { background: rgba(13,148,136,.1); color: var(--primary); }
.message-row__manual {
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  border: 1px solid var(--border-amber);
  border-radius: var(--radius-pill);
  background: var(--surface);
  color: var(--warning);
  font-size: 10px;
  font-weight: 700;
  white-space: nowrap;
}
.message-row__age { font-size: 10px; color: var(--text-tertiary); }

/* ── 分页 ── */
.queue > footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid var(--border);
  font-size: 12px;
  background: var(--surface-soft);
  border-radius: 0 0 var(--radius-panel) var(--radius-panel);
}
.queue > footer > span { margin-right: auto; color: var(--text-secondary); }
.queue label { display: flex; align-items: center; gap: 6px; }
.queue :deep(.el-input-number) { width: 76px; }
.queue footer .el-button { margin: 0; }

/* ═══════════════════════════════════════
   右侧详情面板
   ═══════════════════════════════════════ */
.detail-panel {
  flex: 0 0 400px;
  min-height: 400px;
  max-height: calc(100vh - 180px);
  position: sticky;
  top: 20px;
  border-radius: var(--radius-panel);
  border: 1px solid var(--border-subtle);
  background: var(--surface);
  box-shadow: var(--shadow-rest);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: box-shadow var(--transition-normal), opacity 300ms ease;
}
.detail-panel--open { box-shadow: var(--shadow-hover); }

.detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 20px;
  border-bottom: 1px solid var(--border);
  background: linear-gradient(180deg, var(--surface), var(--surface-soft));
}
.detail-header__title {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.detail-header__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}
.detail-header__actions :deep(.el-button) { margin: 0; }
.detail-header__avatar {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  flex: 0 0 auto;
  border-radius: 10px;
  background: linear-gradient(135deg, var(--brand-50), var(--brand-100));
  color: var(--primary);
  font-size: 16px;
  font-weight: 700;
}
.detail-header h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.3;
}
.detail-header small {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-secondary);
}
.detail-close {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  flex: 0 0 auto;
  border: 0;
  border-radius: 8px;
  background: var(--surface-soft);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast);
}
.detail-close:hover { background: var(--surface-muted); color: var(--text-primary); }

/* ── 详情面板过渡动画 ── */
.detail-fade-enter-active { transition: opacity 200ms ease, transform 200ms ease; }
.detail-fade-leave-active { transition: opacity 150ms ease, transform 150ms ease; }
.detail-fade-enter-from { opacity: 0; transform: translateX(12px); }
.detail-fade-leave-to { opacity: 0; transform: translateX(-8px); }

.detail-inner {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}

.detail-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}

.detail-status {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
  padding: 12px;
  border-radius: var(--radius-control);
  background: var(--surface-soft);
}
.detail-status__item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
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