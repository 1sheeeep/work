<script setup lang="ts">
import PageHeader from '../components/PageHeader.vue'
import AsyncState from '../components/AsyncState.vue'
import MetricCard from '../components/MetricCard.vue'
import StatusBadge from '../components/StatusBadge.vue'
import { computed, onMounted, ref } from 'vue'
import { CircleCheck, Clock, DocumentCopy, Refresh, Search, Warning } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { api, apiErrorMessage } from '../services/api'
import type { AuditLog, OperationsSummary } from '../types'

const loading = ref(true)
const errorMessage = ref('')
const summary = ref<OperationsSummary | null>(null)
const logs = ref<AuditLog[]>([])
const resultFilter = ref<'ALL' | 'FAILURE'>('ALL')
const keyword = ref('')
const selectedLog = ref<AuditLog | null>(null)
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
}

async function load() {
  loading.value = true
  errorMessage.value = ''
  try {
    const [operationsResponse, logsResponse] = await Promise.all([
      api.get<OperationsSummary>('/operations'),
      api.get<AuditLog[]>('/audit-logs', { params: { limit: 100 } }),
    ])
    summary.value = operationsResponse.data
    logs.value = logsResponse.data
  } catch (error) { errorMessage.value = apiErrorMessage(error, '项目运行日志加载失败') }
  finally { loading.value = false }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(value))
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
    `详情：${log.details || '—'}`,
    log.requestId ? `请求标识：${log.requestId}` : '',
  ].filter(Boolean).join('\n')
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('日志详情已复制')
  } catch {
    ElMessage.warning('当前浏览器无法复制，请打开详情后手动复制')
  }
}

onMounted(load)
</script>

<template>
  <div class="page-shell logs-page">
    <PageHeader>
      <div><span class="page-kicker">运行监测与问题定位</span><h1>项目运行日志</h1><p>查看关键事件、失败影响与对应对象，快速定位运行问题。</p></div>
      <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
    </PageHeader>

    <AsyncState v-if="loading" state="loading" :rows="8" aria-label="正在加载项目运行日志" />
    <AsyncState v-else-if="errorMessage" state="error" title="日志暂时无法加载" :message="errorMessage" @retry="load"><template #icon><el-icon><Warning /></el-icon></template></AsyncState>
    <template v-else>
      <section v-if="summary" class="runtime-strip" aria-label="系统运行摘要">
        <MetricCard class="runtime-card runtime-card--healthy" label="系统状态" description="核心服务当前可用" tone="green"><template #value><el-icon><CircleCheck /></el-icon>运行正常</template></MetricCard>
        <MetricCard class="runtime-card runtime-card--bridge" label="在线桥接" :value="summary.activeBrowserDevices" :description="summary.staleBrowserDevices ? `${summary.staleBrowserDevices} 个桥接已失联` : '浏览器连接无失联'" tone="teal" />
        <MetricCard class="runtime-card runtime-card--unread" label="未读会话" :value="summary.unreadObservations" description="等待值守流程处理" tone="blue" />
        <MetricCard class="runtime-card runtime-card--jobs" label="待核对岗位" :value="summary.unverifiedPageCaptures" :description="summary.unverifiedPageCaptures ? '需人工确认页面资料' : '岗位页面均已核对'" tone="amber" />
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
          <div class="log-detail-list__wide"><dt>详情</dt><dd class="detail-content">{{ selectedLog.details || '—' }}</dd></div>
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
.runtime-card { min-width:0; min-height:112px; padding:18px 20px; border-color:var(--runtime-border,var(--border)); background:linear-gradient(145deg,var(--runtime-surface,var(--surface)),var(--surface)); border-radius:var(--radius-lg); box-shadow:var(--shadow-card); }
.runtime-card--healthy { --runtime-accent:var(--success); --runtime-surface:#eff9f3; --runtime-border:#d1eadb; }
.runtime-card--bridge { --runtime-accent:var(--brand-600); --runtime-surface:var(--surface-teal); --runtime-border:var(--border-teal); }
.runtime-card--unread { --runtime-accent:var(--color-info); --runtime-surface:var(--surface-blue); --runtime-border:var(--border-blue); }
.runtime-card--jobs { --runtime-accent:var(--warning); --runtime-surface:var(--surface-amber); --runtime-border:var(--border-amber); }
.runtime-card { --metric-value-size:28px; }
.runtime-card :deep(.metric-card-ui__content > span) { color:var(--text-secondary); font-size:12px; }
.runtime-card :deep(.metric-card-ui__content > strong) { margin:7px 0 5px; color:var(--text-main); line-height:1; }
.runtime-card--healthy :deep(.metric-card-ui__content > strong) { display:flex; align-items:center; gap:7px; color:var(--success); font-size:18px; }
.runtime-card :deep(.metric-card-ui__content > small) { color:var(--text-tertiary); font-size:11px; }
.runtime-card .warning { color: var(--warning); }
.log-panel { overflow: hidden; padding: 0; border-radius: var(--radius-lg); }
.log-head { display: flex; min-height: 92px; align-items: center; justify-content: space-between; gap: 20px; padding: 18px 22px; border-bottom: 1px solid var(--border); }
.log-head__title { min-width: 0; }
.log-head h2 { margin: 5px 0 0; font-size: 19px; }
.log-head p { margin: 5px 0 0; color: var(--text-secondary); font-size: 12px; }
.log-tools { display: flex; flex: 0 1 auto; align-items: center; gap: 10px; }
.log-tools .el-input { width: min(300px, 30vw); }
.log-tabs { display: flex; flex: 0 0 auto; padding: 4px; border: 1px solid var(--border-subtle); border-radius: 10px; background: var(--surface-soft); }
.log-tabs button { min-width: 56px; padding: 7px 12px; border: 0; border-radius: 7px; background: transparent; color: var(--text-secondary); font-size: 12px; cursor: pointer; transition: background .15s ease, color .15s ease, box-shadow .15s ease; }
.log-tabs button.active { background: #fff; color: var(--text-main); font-weight: 700; box-shadow: 0 1px 4px rgba(17,28,45,.09); }
.log-tabs button:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }
.log-table { width: 100%; }
.log-table :deep(.el-table__header th) { height: 44px; background: #f7f9fa; color: var(--text-secondary); font-size: 11px; }
.log-table :deep(.el-table__cell) { height: 54px; vertical-align: middle; }
.log-table :deep(.el-table__row:hover > td.el-table__cell) { background: #f7fbfa; }
.log-time { color: var(--text-secondary); font-variant-numeric: tabular-nums; white-space: nowrap; }
.event-cell { display: flex; min-width: 0; align-items: center; gap: 9px; }
.event-cell strong, .target-cell { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.result-dot { display: block; width: 8px; height: 8px; flex: 0 0 auto; border-radius: 50%; background: #98a2b3; }
.result-dot--success { background: var(--success); box-shadow: 0 0 0 4px rgba(22,163,74,.08); }
.result-dot--failure { background: var(--danger); box-shadow: 0 0 0 4px rgba(220,38,38,.07); }
.result-cell { display: flex; min-width: 0; align-items: center; gap: 9px; }
.result-cell > span:last-child { min-width: 0; overflow: hidden; color: var(--text-secondary); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.result-cell--failure > span:last-child { color: #8a3a32; }
.log-cards { display: none; }
.log-empty { min-height: 280px; }
.log-empty p { margin: 0; color: var(--text-tertiary); font-size: 12px; }
.drawer-result { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 18px; padding: 15px; border-radius: 12px; background: #f4faf7; }
.drawer-result--failure { background: #fff5f3; }
.drawer-result .result-dot { margin-top: 5px; }
.drawer-result strong, .drawer-result p { display: block; margin: 0; }
.drawer-result p { margin-top: 5px; color: var(--text-secondary); font-size: 12px; line-height: 1.55; }
.log-detail-list { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 0 0 20px; }
.log-detail-list > div { min-width: 0; padding: 13px; border: 1px solid var(--border-subtle); border-radius: 11px; background: #f8faf9; }
.log-detail-list dt { color: var(--text-tertiary); font-size: 11px; }
.log-detail-list dd { margin: 5px 0 0; color: var(--text-main); font-size: 13px; line-height: 1.55; overflow-wrap: anywhere; }
.log-detail-list__wide { grid-column: 1 / -1; }
.detail-content { white-space: pre-wrap; }
.detail-mono { font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace; font-size: 11px !important; }
@media (max-width: 900px) {
  .runtime-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .log-head { align-items: stretch; flex-direction: column; }
  .log-tools .el-input { width: 100%; }
}
@media (max-width: 1180px) {
  .log-table { display: none; }
  .log-cards { display: grid; }
  .log-card { padding: 15px 16px; border: 0; border-top: 1px solid var(--border-subtle); border-radius: 0; box-shadow: none; }
  .log-card--failure { background: #fffaf9; }
  .log-card header, .log-card footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .log-card header strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .log-card__target { margin: 8px 0 0; overflow: hidden; color: var(--text-secondary); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
  .log-card__impact { display: -webkit-box; margin: 8px 0 0; overflow: hidden; color: #8a3a32; font-size: 12px; line-height: 1.5; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
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
}
@media (prefers-reduced-motion: reduce) { .log-tabs button { transition: none; } }
</style>
