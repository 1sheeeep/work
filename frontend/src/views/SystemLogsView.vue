<script setup lang="ts">
import PageHeader from '../components/PageHeader.vue'
import AsyncState from '../components/AsyncState.vue'
import MetricCard from '../components/MetricCard.vue'
import StatusBadge from '../components/StatusBadge.vue'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { CircleCheck, Clock, DocumentCopy, Search, Warning } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { api, apiErrorMessage } from '../services/api'
import { replyPhaseLabel, replyUiStatus } from '../utils/inboundReplyLifecycle'
import type { AuditLog, InboundReplyRuntimeEvent, OperationsSummary } from '../types'

const loading = ref(true)
const errorMessage = ref('')
const summary = ref<OperationsSummary | null>(null)
const logs = ref<AuditLog[]>([])
const resultFilter = ref<'ALL' | 'FAILURE'>('ALL')
const keyword = ref('')
const selectedLog = ref<AuditLog | null>(null)
const refreshWarning = ref('')
let refreshTimer: ReturnType<typeof setInterval> | null = null
const detailDrawerOpen = computed({
  get: () => !!selectedLog.value,
  set: value => { if (!value) selectedLog.value = null },
})
const displayedLogs = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  return logs.value.filter(item => {
    if (resultFilter.value !== 'ALL' && item.result !== resultFilter.value) return false
    if (!query) return true
    return [actionLabels[item.action] || item.action, item.targetLabel, item.actorName, item.details, item.requestId]
      .some(value => String(value || '').toLowerCase().includes(query))
  })
})
const actionLabels: Record<string, string> = {
  LOGIN: '登录系统', LOGOUT: '退出系统', LOGIN_FAILED: '登录失败',
  CREATE_BOSS_ACCOUNT: '新增招聘账号', UPDATE_BOSS_ACCOUNT: '更新招聘账号', CHANGE_BOSS_ACCOUNT_STATUS: '变更账号状态',
  CREATE_JOB_POSITION: '新增岗位', UPDATE_JOB_POSITION: '更新岗位', CHANGE_JOB_POSITION_STATUS: '变更岗位状态',
  IMPORT_OBSERVED_JOB_TITLE: '同步真实岗位', CREATE_CONNECTOR_ACTION_TASK: '创建浏览器任务',
  CREATE_LOCAL_CONNECTOR_PAIRING: '生成浏览器连接码', RECALCULATE_SAFE_DRAFTS: '重新评估安全草稿',
  UPDATE_COMPANY_KNOWLEDGE: '更新公司回复资料', UPDATE_JOB_REPLY_KNOWLEDGE: '更新岗位回复资料',
  APPROVE_RESUME_INTAKE: '审核简历', REVIEW_RESUME_INTAKE: '审核简历事件',
  REQUEST_RESUME_AI_ANALYSIS: '提交 AI 分析', REQUEST_OPENAI_RESUME_ANALYSIS: '提交 AI 分析',
  TEST_OPENAI_CONNECTION: '测试 AI 服务',
  ENABLE_COMPANY_AI_AUTO_ANALYSIS: '启用公司 AI 自动分析',
  BROWSER_DEVICE_OFFLINE: '浏览器桥接离线', BROWSER_DEVICE_ONLINE: '浏览器桥接恢复',
  AUTO_REPLY_DIAGNOSTIC_BLOCKED: '自动回复阻塞诊断',
  AUTO_REPLY_DIAGNOSTIC_RECOVERED: '自动回复诊断恢复',
  AI_REPLY_RETRY_SCHEDULED: 'AI 回复已安排重试',
  RETRY_FAILED_INBOUND_REPLY: '库存任务已安全复核并重新入队',
  AI_REPLY_TASK_FAILED: 'AI 回复最终失败',
  AI_REPLY_SAFETY_SKIPPED: 'AI 回复安全跳过',
  AI_REPLY_SEND_FAILED: 'AI 回复发送失败',
  AI_REPLY_SEND_UNKNOWN: 'AI 回复发送待确认',
}
const queueState = computed(() => {
  const q = summary.value?.inboundReplyQueue
  if (!q) return { tone: 'green', label: '队列正常' }
  if (!q.autoSendEnabled) return { tone: 'amber', label: '自动发送已关闭' }
  if (q.sendUnknown > 0 || q.failedLastHour > 0) return { tone: 'red', label: '需要人工检查' }
  if (q.retryWaiting > 0 || (q.oldestPendingSeconds || 0) > 60) return { tone: 'amber', label: '存在延迟' }
  return { tone: 'green', label: '队列正常' }
})
const automationState = computed(() => {
  const q = summary.value?.inboundReplyQueue
  if (!q?.autoSendEnabled) return { tone: 'danger' as const, label: '总开关关闭', note: '后端禁止自动发送，请检查部署环境配置。' }
  if (q.sendUnknown > 0) return { tone: 'danger' as const, label: '发送结果待确认', note: '存在未收到回执的发送，系统已禁止重复发送，请人工核对。' }
  if (q.failedLastHour > 0) return { tone: 'danger' as const, label: '运行异常', note: '近一小时存在失败任务，请查看下方自动回复记录。' }
  if (!summary.value?.activeDutyPolicies) return { tone: 'warning' as const, label: '挂机未开启', note: '请在“今日值守”开启挂机，未读会话才会进入自动处理。' }
  if (!summary.value?.activeBrowserDevices || summary.value.staleBrowserDevices > 0) return { tone: 'warning' as const, label: '桥接未就绪', note: '挂机策略已开启，但浏览器桥接离线或心跳异常。' }
  return { tone: 'success' as const, label: '自动回复运行中', note: '插件采集、持久队列与页面发送链路均已开启。' }
})
const recentReplyEvents = computed(() => summary.value?.recentInboundReplyEvents || [])
const replyProblemEvents = computed(() => recentReplyEvents.value.filter(event => {
  const status = replyUiStatus(event)
  return status === 'FAILED' || status === 'UNCONFIRMED' || status === 'RETRY_WAIT' || status === 'SILENT' || !!event.errorCode
}))
function queueAge(seconds?: number) { if (seconds == null) return '当前无积压'; if (seconds < 60) return `最久等待 ${seconds} 秒`; return `最久等待 ${Math.floor(seconds / 60)} 分钟` }

function replyEventState(event: InboundReplyRuntimeEvent) {
  const status = replyUiStatus(event)
  const label = replyPhaseLabel(event)
  const tone = status === 'SUCCESS' ? 'success' as const
    : status === 'FAILED' || status === 'UNCONFIRMED' ? 'danger' as const
      : status === 'RETRY_WAIT' || status === 'READY_TO_SEND' ? 'warning' as const
        : status === 'SENDING' || status === 'PROCESSING' ? 'info' as const : 'neutral' as const
  return { label, tone }
}
function replyEventDetail(event: InboundReplyRuntimeEvent) {
  if (event.detail) return event.detail
  const status = replyUiStatus(event)
  if (status === 'SUCCESS') return '回复已通过页面回执确认。'
  if (status === 'PROCESSING') return '正在理解求职者问题并生成受控回复。'
  if (status === 'READY_TO_SEND') return 'AI 已完成，等待插件领取并发送。'
  return '任务状态已记录。'
}

async function load(silent = false) {
  if (!silent) { loading.value = true; errorMessage.value = '' }
  refreshWarning.value = ''
  try {
    const [operationsResponse, logsResponse] = await Promise.all([
      api.get<OperationsSummary>('/operations'),
      api.get<AuditLog[]>('/audit-logs', { params: { limit: 100 } }),
    ])
    summary.value = operationsResponse.data
    logs.value = logsResponse.data
  } catch (error) {
    const message = apiErrorMessage(error, '项目运行日志加载失败')
    if (silent) refreshWarning.value = `自动刷新失败：${message}`
    else errorMessage.value = message
  }
  finally { if (!silent) loading.value = false }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(value))
}

function formatProcessingDuration(value?: number | null) {
  if (value == null || value < 0) return ''
  if (value < 1000) return `${value} ms`
  const seconds = value / 1000
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} 秒`
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.round(seconds % 60)
  return remainder ? `${minutes} 分 ${remainder} 秒` : `${minutes} 分钟`
}

function openDetails(log: AuditLog) {
  selectedLog.value = log
}

async function copyDetails(log: AuditLog) {
  const text = [
    `时间：${formatDate(log.occurredAt)}`,
    `事件：${actionLabels[log.action] || log.action}`,
    `对象：${log.targetLabel || '系统'}`,
    `来源：${log.actorName || '系统'}`,
    `结果：${log.result === 'SUCCESS' ? '成功' : '失败'}`,
    `详情：${log.details || '无'}`,
    log.requestId ? `请求标识：${log.requestId}` : '',
  ].filter(Boolean).join('\n')
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('日志详情已复制')
  } catch {
    ElMessage.warning('当前浏览器无法复制，请打开详情后手动复制')
  }
}

function replyProblemRecord(event: InboundReplyRuntimeEvent) {
  return {
    timestamp: event.updatedAt,
    stage: replyEventState(event).label,
    account: event.accountName,
    conversation: event.anonymousChatKey,
    job: event.jobTitle,
    taskStatus: event.taskStatus,
    sendStatus: event.sendStatus,
    errorCode: event.errorCode || null,
    attempts: event.attemptCount,
    processingDurationMs: event.processingDurationMs ?? null,
    incomingMessage: event.messageText || null,
    detail: replyEventDetail(event),
  }
}

function replyProblemText(event: InboundReplyRuntimeEvent) {
  return JSON.stringify(replyProblemRecord(event), null, 2)
}

async function writeClipboard(text: string, success: string) {
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success(success)
  } catch {
    ElMessage.warning('当前浏览器无法复制，请检查剪贴板权限')
  }
}

async function copyReplyProblem(event: InboundReplyRuntimeEvent) {
  await writeClipboard(replyProblemText(event), '问题信息已复制')
}

async function copyReplyProblems() {
  if (!replyProblemEvents.value.length) return ElMessage.info('当前没有可复制的 AI 自动回复问题')
  const report = {
    type: 'AI_AUTO_REPLY_PROBLEM_REPORT',
    generatedAt: new Date().toISOString(),
    count: replyProblemEvents.value.length,
    problems: replyProblemEvents.value.map(replyProblemRecord),
  }
  const text = `\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\``
  await writeClipboard(text, `已复制 ${replyProblemEvents.value.length} 条问题`)
}

onMounted(() => { void load(); refreshTimer = setInterval(() => void load(true), 30_000) })
onUnmounted(() => { if (refreshTimer) clearInterval(refreshTimer) })
</script>

<template>
  <div class="page-shell logs-page">
    <PageHeader>
      <div></div>
    </PageHeader>

    <AsyncState v-if="loading" state="loading" :rows="8" aria-label="正在加载项目运行日志" />
    <AsyncState v-else-if="errorMessage" state="error" title="日志暂时无法加载" :message="errorMessage" @retry="load"><template #icon><el-icon><Warning /></el-icon></template></AsyncState>
    <template v-else>
      <div v-if="refreshWarning" class="refresh-warning" role="status">{{ refreshWarning }}；当前仍显示上一次成功数据。</div>
      <section v-if="summary" class="runtime-strip" aria-label="系统运行摘要">
        <MetricCard class="runtime-card runtime-card--healthy" label="系统状态" description="核心服务当前可用" tone="green"><template #value><el-icon><CircleCheck /></el-icon>运行正常</template></MetricCard>
        <MetricCard class="runtime-card runtime-card--bridge" label="在线桥接" :value="summary.activeBrowserDevices" :description="summary.staleBrowserDevices ? `${summary.staleBrowserDevices} 个桥接已失联` : '浏览器连接无失联'" tone="teal" />
        <MetricCard class="runtime-card runtime-card--unread" label="未读会话" :value="summary.unreadObservations" description="等待值守流程处理" tone="blue" />
        <MetricCard class="runtime-card runtime-card--jobs" label="待核对岗位" :value="summary.unverifiedPageCaptures" :description="summary.unverifiedPageCaptures ? '需人工确认页面资料' : '岗位页面均已核对'" tone="amber" />
      </section>

      <section v-if="summary?.inboundReplyQueue" class="card-panel queue-health" aria-label="AI 自动回复队列状态">
        <header class="queue-health__head">
          <div><span class="section-kicker">无人值守链路</span><h2>AI 自动回复队列</h2><p>数据来自后端持久队列，浏览器重启不会清空。</p></div>
          <StatusBadge :label="queueState.label" :tone="queueState.tone === 'red' ? 'danger' : queueState.tone === 'amber' ? 'warning' : 'success'" />
        </header>
        <div class="queue-health__grid">
          <div><span>等待 / 处理中</span><strong>{{ summary.inboundReplyQueue.pending }} / {{ summary.inboundReplyQueue.processing }}</strong><small>{{ queueAge(summary.inboundReplyQueue.oldestPendingSeconds) }}</small></div>
          <div><span>等待重试</span><strong>{{ summary.inboundReplyQueue.retryWaiting }}</strong><small>失败后按退避策略重试</small></div>
          <div><span>等待页面发送</span><strong>{{ summary.inboundReplyQueue.readyToSend }}</strong><small>{{ summary.inboundReplyQueue.sendLeased }} 条已领取租约</small></div>
          <div :class="{ danger: summary.inboundReplyQueue.sendUnknown > 0 }"><span>结果待确认</span><strong>{{ summary.inboundReplyQueue.sendUnknown }}</strong><small>必须人工核对，系统不会重发</small></div>
          <div :class="{ danger: summary.inboundReplyQueue.failedLastHour > 0 }"><span>近一小时失败</span><strong>{{ summary.inboundReplyQueue.failedLastHour }}</strong><small>AI 处理终止任务</small></div>
          <div><span>发送额度</span><strong>{{ summary.inboundReplyQueue.sentLastHour }} / {{ summary.inboundReplyQueue.sendLimitPerHour }}</strong><small>今日 {{ summary.inboundReplyQueue.sentLastDay }} / {{ summary.inboundReplyQueue.sendLimitPerDay }}</small></div>
        </div>
      </section>

      <section v-if="summary" class="card-panel automation-runtime" aria-label="自动回复运行状态与最近记录">
        <header class="automation-runtime__head">
          <div><span class="section-kicker">状态与追踪</span><h2>自动回复运行状态</h2><p>{{ automationState.note }}</p></div>
          <StatusBadge :label="automationState.label" :tone="automationState.tone" />
        </header>
        <div class="automation-runtime__facts">
          <div><span>挂机账号</span><strong>{{ summary.activeDutyPolicies }}</strong><small>由今日值守统一控制</small></div>
          <div><span>在线桥接</span><strong>{{ summary.activeBrowserDevices }}</strong><small>{{ summary.staleBrowserDevices ? `${summary.staleBrowserDevices} 个心跳异常` : '采集链路正常' }}</small></div>
          <div><span>近一小时已回复</span><strong>{{ summary.inboundReplyQueue.sentLastHour }}</strong><small>以页面成功回执为准</small></div>
        </div>
        <div class="reply-events__title flex-between"><div><h3>最近自动回复记录</h3><p>已发送内容以页面成功回执为准；异常、重试、静默和安全跳过均保留原因。</p></div><div class="reply-events__actions"><span>最近 {{ recentReplyEvents.length }} 条 · 问题 {{ replyProblemEvents.length }} 条</span><el-button size="small" :icon="DocumentCopy" :disabled="!replyProblemEvents.length" @click="copyReplyProblems">复制问题汇总</el-button></div></div>
        <AsyncState v-if="!recentReplyEvents.length" state="empty" embedded class="reply-events__empty" title="暂无自动回复记录" message="开启挂机并处理到符合条件的未读会话后，阶段状态会显示在这里。" />
        <div v-else class="reply-events">
          <article v-for="event in recentReplyEvents" :key="event.id" class="reply-event" :class="{ 'reply-event--danger': replyEventState(event).tone === 'danger' }">
            <div class="reply-event__main"><span class="result-dot" :class="`result-dot--${replyEventState(event).tone === 'success' ? 'success' : replyEventState(event).tone === 'danger' ? 'failure' : 'pending'}`" aria-hidden="true"></span><div><strong>{{ event.jobTitle }}</strong><p>{{ event.accountName }} · 会话 {{ event.anonymousChatKey }}</p></div></div>
            <StatusBadge compact :label="replyEventState(event).label" :tone="replyEventState(event).tone" />
            <blockquote v-if="replyUiStatus(event) === 'SUCCESS' && event.replyContent" class="reply-event__content">“{{ event.replyContent }}”</blockquote>
            <blockquote v-if="replyProblemEvents.some(item => item.id === event.id) && event.messageText" class="reply-event__incoming"><strong>候选人原话</strong><span>“{{ event.messageText }}”</span></blockquote>
            <p v-else-if="replyProblemEvents.some(item => item.id === event.id)" class="reply-event__incoming-missing">候选人原话未留存（历史记录）</p>
            <p class="reply-event__detail" :title="replyEventDetail(event)">{{ replyEventDetail(event) }}</p>
            <div class="reply-event__meta"><span v-if="event.errorCode" class="error-code">{{ event.errorCode }}</span><span>尝试 {{ event.attemptCount }} 次</span><span v-if="formatProcessingDuration(event.processingDurationMs)">处理耗时 {{ formatProcessingDuration(event.processingDurationMs) }}</span><time>{{ formatDate(event.updatedAt) }}</time></div>
            <button v-if="replyProblemEvents.some(item => item.id === event.id)" type="button" class="reply-event__copy" :aria-label="`复制 ${event.jobTitle} 的问题信息`" @click="copyReplyProblem(event)"><el-icon><DocumentCopy /></el-icon>复制问题</button>
          </article>
        </div>
      </section>

      <section class="card-panel log-panel">
        <header class="log-head">
          <div class="log-head__title"><span class="section-kicker">最近 100 条</span><h2>问题定位</h2><p>失败事件优先查看，完整技术详情仅在抽屉中展示。</p></div>
          <div class="log-tools">
            <el-input v-model="keyword" clearable :prefix-icon="Search" placeholder="搜索事件、对象或错误" aria-label="搜索运行日志" />
            <div class="log-tabs" aria-label="按处理结果筛选">
              <button :class="{ active: resultFilter === 'ALL' }" :aria-pressed="resultFilter === 'ALL'" @click="resultFilter = 'ALL'">全部</button>
              <button :class="{ active: resultFilter === 'FAILURE' }" :aria-pressed="resultFilter === 'FAILURE'" @click="resultFilter = 'FAILURE'">失败</button>
            </div>
          </div>
        </header>

        <AsyncState v-if="!displayedLogs.length" state="empty" embedded class="log-empty" :title="resultFilter === 'FAILURE' ? '当前没有失败记录' : '暂无相关运行记录'" :message="keyword ? '请调整搜索关键词后重试。' : '系统产生关键运行事件后会在这里显示。'"><template #icon><el-icon><Clock /></el-icon></template></AsyncState>
        <el-table v-else :data="displayedLogs" size="small" class="log-table" row-key="id">
          <el-table-column label="时间" min-width="142"><template #default="{ row }"><time class="log-time">{{ formatDate(row.occurredAt) }}</time></template></el-table-column>
          <el-table-column label="事件" min-width="180"><template #default="{ row }"><div class="event-cell"><span class="result-dot" :class="`result-dot--${row.result.toLowerCase()}`" aria-hidden="true"></span><strong>{{ actionLabels[row.action] || row.action }}</strong></div></template></el-table-column>
          <el-table-column label="对象" min-width="160"><template #default="{ row }"><span class="target-cell" :title="row.targetLabel || '系统'">{{ row.targetLabel || '系统' }}</span></template></el-table-column>
          <el-table-column label="结果与影响" min-width="250"><template #default="{ row }"><div class="result-cell" :class="{ 'result-cell--failure': row.result === 'FAILURE' }"><StatusBadge compact :label="row.result === 'SUCCESS' ? '成功' : '失败'" :tone="row.result === 'SUCCESS' ? 'success' : 'danger'" /><span>{{ row.result === 'FAILURE' ? (row.details || '本次操作未完成，请查看详情。') : (row.details || '操作已完成') }}</span></div></template></el-table-column>
          <el-table-column label="操作" width="76" fixed="right"><template #default="{ row }"><el-button link type="primary" @click="openDetails(row as AuditLog)">详情</el-button></template></el-table-column>
        </el-table>
        <div v-if="displayedLogs.length" class="log-cards" aria-label="运行日志列表">
          <article v-for="log in displayedLogs" :key="log.id" class="card-entity log-card" :class="{ 'log-card--failure': log.result === 'FAILURE' }" tabindex="0" @click="openDetails(log)" @keydown.enter="openDetails(log)" @keydown.space.prevent="openDetails(log)" role="button">
            <header><div class="event-cell"><span class="result-dot" :class="`result-dot--${log.result.toLowerCase()}`" aria-hidden="true"></span><strong>{{ actionLabels[log.action] || log.action }}</strong></div><StatusBadge compact :label="log.result === 'SUCCESS' ? '成功' : '失败'" :tone="log.result === 'SUCCESS' ? 'success' : 'danger'" /></header>
            <p class="log-card__target">{{ log.targetLabel || '系统' }}</p>
            <p v-if="log.result === 'FAILURE'" class="log-card__impact">{{ log.details || '本次操作未完成，请打开详情检查原因。' }}</p>
            <footer><time>{{ formatDate(log.occurredAt) }}</time><span>查看详情</span></footer>
          </article>
        </div>
      </section>
    </template>

    <el-drawer v-model="detailDrawerOpen" title="日志详情" size="min(480px, 100vw)" append-to-body>
      <template v-if="selectedLog">
        <div class="drawer-result" :class="{ 'drawer-result--failure': selectedLog.result === 'FAILURE' }">
          <span class="result-dot" :class="`result-dot--${selectedLog.result.toLowerCase()}`" aria-hidden="true"></span>
          <div><strong>{{ selectedLog.result === 'SUCCESS' ? '操作已完成' : '操作未完成' }}</strong><p>{{ selectedLog.result === 'SUCCESS' ? '该事件已正常记录，无需额外处理。' : '请核对下方错误详情，并根据影响范围人工处理。' }}</p></div>
        </div>
        <dl class="log-detail-list">
          <div><dt>时间</dt><dd>{{ formatDate(selectedLog.occurredAt) }}</dd></div>
          <div><dt>事件</dt><dd>{{ actionLabels[selectedLog.action] || selectedLog.action }}</dd></div>
          <div><dt>对象</dt><dd>{{ selectedLog.targetLabel || '系统' }}</dd></div>
          <div><dt>来源</dt><dd>{{ selectedLog.actorName || '系统' }}</dd></div>
          <div><dt>处理结果</dt><dd><StatusBadge :label="selectedLog.result === 'SUCCESS' ? '成功' : '失败'" :tone="selectedLog.result === 'SUCCESS' ? 'success' : 'danger'" /></dd></div>
          <div v-if="selectedLog.requestId"><dt>请求标识</dt><dd class="detail-mono">{{ selectedLog.requestId }}</dd></div>
          <div class="log-detail-list__wide"><dt>详情</dt><dd class="detail-content">{{ selectedLog.details || '无' }}</dd></div>
        </dl>
        <el-button :icon="DocumentCopy" @click="copyDetails(selectedLog)">复制错误与事件信息</el-button>
      </template>
    </el-drawer>
  </div>
</template>

<style scoped>
.logs-page { width: min(100%, 1480px); }
.logs-heading { align-items: center; }
.page-kicker, .section-kicker { display: block; color: var(--color-primary); font-size: 10px; font-weight: 760; letter-spacing: .055em; }
.logs-heading h1 { margin-top: 6px; }
.loading-panel { padding: 28px; }
.runtime-strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-bottom: 18px; }
.runtime-card { min-width:0; min-height:112px; padding:18px 20px; border-color:var(--runtime-border,var(--border)); background:linear-gradient(145deg,var(--runtime-surface,var(--surface)),var(--surface)); border-radius:var(--radius-panel); box-shadow:var(--shadow-raised); }
.runtime-card--healthy { --runtime-accent:var(--success); --runtime-surface:var(--surface-green); --runtime-border:var(--border-green); }
.runtime-card--bridge { --runtime-accent:var(--brand-600); --runtime-surface:var(--surface-teal); --runtime-border:var(--border-teal); }
.runtime-card--unread { --runtime-accent:var(--color-info); --runtime-surface:var(--surface-blue); --runtime-border:var(--border-blue); }
.runtime-card--jobs { --runtime-accent:var(--warning); --runtime-surface:var(--surface-amber); --runtime-border:var(--border-amber); }
.runtime-card { --metric-value-size:28px; }
.runtime-card :deep(.metric-card-ui__content > span) { color:var(--text-secondary); font-size:12px; }
.runtime-card :deep(.metric-card-ui__content > strong) { margin:7px 0 5px; color:var(--text-main); line-height:1; }
.runtime-card--healthy :deep(.metric-card-ui__content > strong) { display:flex; align-items:center; gap:7px; color:var(--success); font-size:18px; }
.runtime-card :deep(.metric-card-ui__content > small) { color:var(--text-tertiary); font-size:11px; }
.runtime-card .warning { color: var(--warning); }
.refresh-warning { margin-bottom:12px; padding:9px 12px; border:1px solid var(--border-amber); border-radius:var(--radius-control); background:var(--surface-amber); color:var(--warning); font-size:12px; }
.queue-health { margin-bottom:18px; padding:0; overflow:hidden; }
.queue-health__head { display:flex; align-items:center; justify-content:space-between; gap:18px; padding:18px 22px; border-bottom:1px solid var(--border); background:linear-gradient(180deg, var(--surface-soft), var(--surface)); }
.queue-health__head h2 { margin:5px 0 0; font-size:18px; }
.queue-health__head p { margin:4px 0 0; color:var(--text-secondary); font-size:12px; }
.queue-health__grid { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); }
.queue-health__grid > div { display:flex; min-width:0; flex-direction:column; gap:5px; padding:16px 18px; border-right:1px solid var(--border-subtle); background:var(--surface); transition:background var(--transition-fast); }
.queue-health__grid > div:hover { background:var(--surface-row); }
.queue-health__grid > div:last-child { border-right:0; }
.queue-health__grid span,.queue-health__grid small { color:var(--text-secondary); font-size:11px; }
.queue-health__grid strong { color:var(--text-main); font-size:22px; line-height:1.15; }
.queue-health__grid .danger { background:var(--surface-red); }
.queue-health__grid .danger strong { color:var(--danger); }
.automation-runtime { margin-bottom:18px; padding:0; overflow:hidden; }
.automation-runtime__head { display:flex; align-items:center; justify-content:space-between; gap:18px; padding:18px 22px; border-bottom:1px solid var(--border); background:linear-gradient(180deg, var(--surface-soft), var(--surface)); }
.automation-runtime__head h2 { margin:5px 0 0; font-size:18px; }
.automation-runtime__head p { margin:4px 0 0; color:var(--text-secondary); font-size:12px; }
.automation-runtime__facts { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); border-bottom:1px solid var(--border-subtle); background:var(--surface-soft); }
.automation-runtime__facts>div { display:flex; flex-direction:column; gap:4px; padding:14px 22px; border-right:1px solid var(--border-subtle); }
.automation-runtime__facts>div:last-child { border-right:0; }
.automation-runtime__facts span,.automation-runtime__facts small { color:var(--text-secondary); font-size:11px; }
.automation-runtime__facts strong { color:var(--text-main); font-size:22px; }
.reply-events__title { padding:16px 22px 12px; }
.reply-events__title h3 { margin:0; font-size:14px; }
.reply-events__title p { margin:4px 0 0; color:var(--text-tertiary); font-size:11px; }
.reply-events__title>span { color:var(--text-tertiary); font-size:11px; white-space:nowrap; }
.reply-events__actions { display:flex; align-items:center; gap:10px; }
.reply-events__actions>span { color:var(--text-tertiary); font-size:11px; white-space:nowrap; }
.reply-events { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; padding:0 22px 20px; }
.reply-event { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:9px 12px; min-width:0; padding:13px 14px; border:1px solid var(--border-subtle); border-radius:var(--radius-control); background:var(--surface); box-shadow:var(--shadow-ground); transition:box-shadow var(--transition-fast), transform var(--transition-fast), background var(--transition-fast); }
.reply-event:hover { background:var(--surface-row); box-shadow:var(--shadow-raised); transform:translateY(-1px); }
.reply-event--danger { border-color:var(--border-rose); background:var(--surface-rose); }
.reply-event__main { display:flex; min-width:0; align-items:center; gap:10px; }
.reply-event__main>div { min-width:0; }
.reply-event__main strong,.reply-event__main p { display:block; overflow:hidden; margin:0; text-overflow:ellipsis; white-space:nowrap; }
.reply-event__main strong { color:var(--text-main); font-size:13px; }
.reply-event__main p { margin-top:3px; color:var(--text-tertiary); font-size:11px; }
.reply-event__detail { grid-column:1/-1; overflow:hidden; margin:0; color:var(--text-secondary); font-size:12px; text-overflow:ellipsis; white-space:nowrap; }
.reply-event__content { grid-column:1/-1; margin:0; padding:9px 11px; border-left:3px solid var(--color-primary); border-radius:0 7px 7px 0; background:var(--surface-teal); color:var(--text-main); font-size:12px; line-height:1.55; overflow-wrap:anywhere; }
.reply-event__incoming { display:grid; grid-column:1/-1; gap:4px; margin:0; padding:9px 11px; border-left:3px solid var(--warning); border-radius:0 7px 7px 0; background:var(--surface-amber); color:var(--text-main); font-size:12px; line-height:1.55; overflow-wrap:anywhere; }
.reply-event__incoming strong { color:var(--warning); font-size:10px; letter-spacing:.04em; }
.reply-event__incoming-missing { grid-column:1/-1; margin:0; color:var(--text-tertiary); font-size:11px; }
.reply-event__meta { display:flex; grid-column:1/-1; align-items:center; gap:10px; color:var(--text-tertiary); font-size:10px; }
.reply-event__meta time { margin-left:auto; }
.reply-event__copy { display:inline-flex; grid-column:1/-1; width:max-content; align-items:center; gap:5px; padding:4px 0; border:0; background:transparent; color:var(--color-primary); font-size:11px; font-weight:650; cursor:pointer; }
.reply-event__copy:hover { color:var(--brand-700); text-decoration:underline; }
.reply-event__copy:focus-visible { outline:2px solid var(--border-focus); outline-offset:3px; border-radius:3px; }
.error-code { max-width:180px; overflow:hidden; padding:2px 6px; border-radius:5px; background:var(--surface-red); color:var(--danger); font-family:ui-monospace,SFMono-Regular,Consolas,monospace; text-overflow:ellipsis; white-space:nowrap; }
.result-dot--pending { background:var(--warning); box-shadow:0 0 0 4px rgba(217,119,6,.08); }
.reply-events__empty { min-height:150px; }
@media (max-width:1100px){.queue-health__grid{grid-template-columns:repeat(3,minmax(0,1fr))}.queue-health__grid>div:nth-child(3){border-right:0}}
@media (max-width:640px){.queue-health__head{align-items:flex-start}.queue-health__grid{grid-template-columns:repeat(2,minmax(0,1fr))}.queue-health__grid>div:nth-child(3){border-right:1px solid var(--border-subtle)}.queue-health__grid>div:nth-child(even){border-right:0}.reply-events__title{align-items:flex-start;flex-direction:column}.reply-events__actions{width:100%;justify-content:space-between}.reply-events{grid-template-columns:1fr}}
.log-panel { overflow: hidden; padding: 0; border-radius: var(--radius-panel); }
.log-head { display: flex; min-height: 92px; align-items: center; justify-content: space-between; gap: 20px; padding: 18px 22px; border-bottom: 1px solid var(--border); background:linear-gradient(180deg, rgba(255,255,255,.72), rgba(247,249,250,.82)); }
.log-head__title { min-width: 0; }
.log-head h2 { margin: 5px 0 0; font-size: 19px; }
.log-head p { margin: 5px 0 0; color: var(--text-secondary); font-size: 12px; }
.log-tools { display: flex; flex: 0 1 auto; align-items: center; gap: 10px; }
.log-tools .el-input { width: min(300px, 30vw); }
.log-tabs { display: flex; flex: 0 0 auto; padding: 4px; border: 1px solid var(--border-subtle); border-radius: var(--radius-control); background: var(--surface-soft); }
.log-tabs button { min-width: 56px; padding: 7px 12px; border: 0; border-radius: 6px; background: transparent; color: var(--text-secondary); font-size: 12px; cursor: pointer; transition: background .15s ease, color .15s ease, box-shadow .15s ease; }
.log-tabs button.active { background: var(--surface); color: var(--text-main); font-weight: 700; box-shadow: 0 1px 4px rgba(17,28,45,.09); }
.log-tabs button:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }
.log-table { width: 100%; }
.log-table :deep(.el-table__header th) { height: 44px; background: var(--surface-muted); color: var(--text-secondary); font-size: 11px; }
.log-table :deep(.el-table__cell) { height: 54px; vertical-align: middle; background:var(--surface); }
.log-table :deep(.el-table__row:nth-child(even) > td.el-table__cell) { background: var(--surface-soft); }
.log-table :deep(.el-table__row:hover > td.el-table__cell) { background: var(--surface-row); }
.log-time { color: var(--text-secondary); font-variant-numeric: tabular-nums; white-space: nowrap; }
.event-cell { display: flex; min-width: 0; align-items: center; gap: 9px; }
.event-cell strong, .target-cell { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.result-dot { display: block; width: 8px; height: 8px; flex: 0 0 auto; border-radius: 50%; background: var(--text-tertiary); }
.result-dot--success { background: var(--success); box-shadow: 0 0 0 4px rgba(22,163,74,.08); }
.result-dot--failure { background: var(--danger); box-shadow: 0 0 0 4px rgba(220,38,38,.07); }
.result-cell { display: flex; min-width: 0; align-items: center; gap: 9px; }
.result-cell > span:last-child { min-width: 0; overflow: hidden; color: var(--text-secondary); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.result-cell--failure > span:last-child { color: var(--danger); }
.log-cards { display: none; }
.log-empty { min-height: 280px; }
.log-empty p { margin: 0; color: var(--text-tertiary); font-size: 12px; }
.drawer-result { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 18px; padding: 15px; border-radius: var(--radius-panel); background: var(--surface-teal); }
.drawer-result--failure { background: var(--surface-rose); }
.drawer-result .result-dot { margin-top: 5px; }
.drawer-result strong, .drawer-result p { display: block; margin: 0; }
.drawer-result p { margin-top: 5px; color: var(--text-secondary); font-size: 12px; line-height: 1.55; }
.log-detail-list { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 0 0 20px; }
.log-detail-list > div { min-width: 0; padding: 13px; border: 1px solid var(--border-subtle); border-radius: var(--radius-control); background: var(--surface-soft); }
.log-detail-list dt { color: var(--text-tertiary); font-size: 11px; }
.log-detail-list dd { margin: 5px 0 0; color: var(--text-main); font-size: 13px; line-height: 1.55; overflow-wrap: anywhere; }
.log-detail-list__wide { grid-column: 1 / -1; }
.detail-content { white-space: pre-wrap; }
.detail-mono { font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace; font-size: 11px !important; }
@media (max-width: 900px) {
  .runtime-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .reply-events { grid-template-columns:1fr; }
  .log-head { align-items: stretch; flex-direction: column; }
  .log-tools .el-input { width: 100%; }
}
@media (max-width: 1180px) {
  .log-table { display: none; }
  .log-cards { display: grid; }
  .log-card { padding: 15px 16px; border: 0; border-top: 1px solid var(--border-subtle); border-radius: 0; box-shadow: none; background:var(--surface); transition:background var(--transition-fast); }
  .log-card:nth-child(even) { background:var(--surface-soft); }
  .log-card:hover { background:var(--surface-row); }
  .log-card:active { animation:card-press 180ms ease-out both; }
  .log-card--failure { background:linear-gradient(90deg,var(--surface-rose),var(--surface) 72%); box-shadow:inset 0 0 0 1px var(--border-rose); }
  .log-card header, .log-card footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .log-card header strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .log-card__target { margin: 8px 0 0; overflow: hidden; color: var(--text-secondary); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
  .log-card__impact { display: -webkit-box; margin: 8px 0 0; overflow: hidden; color: var(--danger); font-size: 12px; line-height: 1.5; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
  .log-card footer { margin-top: 12px; color: var(--text-tertiary); font-size: 11px; }
  .log-card footer span { color: var(--color-primary); font-weight: 700; }
}
@media (max-width: 560px) {
  .runtime-strip { grid-template-columns: 1fr; }
  .runtime-card { min-height: 92px; }
  .log-tools { align-items: stretch; flex-direction: column; }
  .log-tabs button { flex: 1; min-height: 36px; }
  .log-detail-list { grid-template-columns: 1fr; }
  .log-detail-list__wide { grid-column: auto; }
  .automation-runtime__head { align-items:flex-start; flex-direction:column; }
  .automation-runtime__facts { grid-template-columns:1fr; }
  .automation-runtime__facts>div { border-right:0; border-bottom:1px solid var(--border-subtle); }
  .automation-runtime__facts>div:last-child { border-bottom:0; }
  .reply-events { padding-inline:12px; }
}
@media (prefers-reduced-motion: reduce) { .log-tabs button { transition: none; } }
</style>
