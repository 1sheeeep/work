<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { Refresh, Setting, Warning } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { api, apiErrorMessage, ensureCsrf } from '../services/api'
import { authStore } from '../stores/auth'
import type { AutoReplyAttempt, AutoReplyAttemptStatus, AutoReplyPolicy } from '../types'

const policies = ref<AutoReplyPolicy[]>([])
const attempts = ref<AutoReplyAttempt[]>([])
const loading = ref(true)
const saving = ref(false)
const errorMessage = ref('')
const dialogOpen = ref(false)
const editing = ref<AutoReplyPolicy>()
const canManage = computed(() => authStore.state.user?.role !== 'RECRUITER')
const stats = computed(() => ({
  total: policies.value.length,
  enabled: policies.value.filter(item => item.enabled).length,
  automatic: policies.value.filter(item => item.autoSendEnabled).length,
  paused: policies.value.filter(item => item.pausedUntil && new Date(item.pausedUntil) > new Date()).length,
}))
const form = reactive({ enabled: false, autoSendEnabled: false, responseTimeoutMinutes: 120, dailyLimit: 20,
  minimumIntervalSeconds: 180, sendingWindowStart: '09:00:00', sendingWindowEnd: '21:00:00', timezone: 'Asia/Shanghai',
  maxConsecutiveFailures: 3, replyTemplate: '' })
const statusLabels: Record<AutoReplyAttemptStatus, string> = { CLAIMED: '处理中', PENDING_REVIEW: '待人工审核', SENT: '已发送', FAILED: '失败', SKIPPED: '已跳过' }

async function load() {
  loading.value = true; errorMessage.value = ''
  try {
    const [policyResponse, attemptResponse] = await Promise.all([
      api.get<AutoReplyPolicy[]>('/auto-replies/policies'), api.get<AutoReplyAttempt[]>('/auto-replies/attempts'),
    ])
    policies.value = policyResponse.data; attempts.value = attemptResponse.data
  } catch (error) { errorMessage.value = apiErrorMessage(error, '自动跟进配置加载失败') }
  finally { loading.value = false }
}
function openPolicy(policy: AutoReplyPolicy) {
  editing.value = policy
  Object.assign(form, { enabled: policy.enabled, autoSendEnabled: policy.autoSendEnabled,
    responseTimeoutMinutes: policy.responseTimeoutMinutes, dailyLimit: policy.dailyLimit,
    minimumIntervalSeconds: policy.minimumIntervalSeconds, sendingWindowStart: policy.sendingWindowStart,
    sendingWindowEnd: policy.sendingWindowEnd, timezone: policy.timezone,
    maxConsecutiveFailures: policy.maxConsecutiveFailures, replyTemplate: policy.replyTemplate })
  dialogOpen.value = true
}
async function save() {
  if (!editing.value) return
  if (form.autoSendEnabled && !form.enabled) { ElMessage.error('开启自动发送前必须启用策略'); return }
  saving.value = true
  try {
    await ensureCsrf(); await api.put(`/auto-replies/policies/${editing.value.accountId}`, form)
    ElMessage.success('账号自动跟进策略已保存'); dialogOpen.value = false; await load()
  } catch (error) { ElMessage.error(apiErrorMessage(error, '策略保存失败')) }
  finally { saving.value = false }
}
function formatDate(value?: string) { return value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—' }
function attemptType(status: AutoReplyAttemptStatus) { return status === 'SENT' ? 'success' : status === 'FAILED' ? 'danger' : status === 'SKIPPED' ? 'info' : 'warning' }
function accountReady(item: AutoReplyPolicy) { return item.accountStatus === 'ACTIVE' && item.messageSendCapable }
onMounted(load)
</script>

<template>
  <div class="page-shell">
    <header class="page-heading"><div><h1>多账号自动跟进</h1><p>候选人消息超过设定时间无人回复时，按账号独立生成草稿或通过已授权 Gateway 自动发送。</p></div><el-button :icon="Refresh" :loading="loading" @click="load">刷新状态</el-button></header>
    <el-alert class="safety-alert" type="warning" :closable="false" show-icon title="无法承诺任何平台账号绝不被封禁。系统只使用官方授权能力，并通过账号级限额、发送间隔、静默时段、人工接管阻断和连续失败暂停来降低风险；禁止 Cookie 模拟、反检测或绕过平台风控。" />
    <div v-if="loading" class="surface-panel skeleton-stack"><el-skeleton :rows="8" animated /></div>
    <div v-else-if="errorMessage" class="surface-panel error-state"><el-icon><Warning /></el-icon><strong>自动跟进状态暂时无法加载</strong><span>{{ errorMessage }}</span><el-button @click="load">重试</el-button></div>
    <template v-else>
      <div class="metrics"><article><span>多账号总数</span><strong>{{ stats.total }}</strong></article><article><span>已启用策略</span><strong>{{ stats.enabled }}</strong></article><article><span>自动发送账号</span><strong>{{ stats.automatic }}</strong></article><article><span>安全暂停账号</span><strong :class="stats.paused ? 'danger' : ''">{{ stats.paused }}</strong></article></div>
      <section class="surface-panel accounts-panel"><div class="section-title-row"><div><h2>账号独立策略</h2><p>每个账号拥有自己的超时时间、日上限、最小间隔、发送窗口和失败暂停阈值。</p></div></div>
        <div class="account-grid"><article v-for="item in policies" :key="item.accountId"><header><div><strong>{{ item.accountName }}</strong><span>{{ item.companyName }}</span></div><el-tag :type="item.enabled ? 'success' : 'info'">{{ item.enabled ? '已启用' : '未启用' }}</el-tag></header>
          <div class="account-health"><el-tag :type="accountReady(item) ? 'success' : 'danger'" size="small">{{ accountReady(item) ? '可发送' : '能力不可用' }}</el-tag><el-tag v-if="item.autoSendEnabled" type="warning" size="small">自动发送</el-tag><el-tag v-else size="small">人工审核</el-tag></div>
          <dl><div><dt>超时触发</dt><dd>{{ item.responseTimeoutMinutes }} 分钟</dd></div><div><dt>今日处理</dt><dd>{{ item.sentToday }} / {{ item.dailyLimit }}</dd></div><div><dt>最小间隔</dt><dd>{{ item.minimumIntervalSeconds }} 秒</dd></div><div><dt>发送窗口</dt><dd>{{ item.sendingWindowStart.slice(0,5) }}–{{ item.sendingWindowEnd.slice(0,5) }}</dd></div><div><dt>连续失败</dt><dd>{{ item.consecutiveFailures }} / {{ item.maxConsecutiveFailures }}</dd></div><div><dt>暂停至</dt><dd>{{ formatDate(item.pausedUntil) }}</dd></div></dl>
          <el-button v-if="canManage" :icon="Setting" :disabled="!item.messageSendCapable" @click="openPolicy(item)">配置此账号</el-button></article></div>
      </section>
      <section class="surface-panel attempts-panel"><div class="section-title-row"><div><h2>最近自动跟进</h2><p>跨账号统一观察，发送正文仍在候选人工作台中按权限查看。</p></div></div><el-empty v-if="!attempts.length" :image-size="72" description="暂无自动跟进记录" /><el-table v-else :data="attempts"><el-table-column prop="accountName" label="账号" min-width="150" /><el-table-column label="候选人与职位" min-width="220"><template #default="{ row }"><strong>{{ row.candidateName }}</strong><div class="muted">{{ row.jobTitle }}</div></template></el-table-column><el-table-column label="状态" width="120"><template #default="{ row }"><el-tag :type="attemptType(row.status)">{{ statusLabels[row.status as AutoReplyAttemptStatus] }}</el-tag></template></el-table-column><el-table-column prop="resultMessage" label="处理结果" min-width="230" /><el-table-column label="时间" width="180"><template #default="{ row }">{{ formatDate(row.createdAt) }}</template></el-table-column></el-table></section>
    </template>

    <el-dialog v-model="dialogOpen" :title="`${editing?.accountName ?? ''} · 自动跟进策略`" width="720px">
      <el-alert type="info" :closable="false" show-icon title="建议先开启“生成待审核草稿”观察一周；自动发送必须确认账号已取得官方授权，并遵守平台频率和内容规则。" />
      <el-form label-position="top" class="policy-form"><div class="switch-row"><el-form-item label="启用超时跟进"><el-switch v-model="form.enabled" /></el-form-item><el-form-item label="无需人工审核自动发送"><el-switch v-model="form.autoSendEnabled" :disabled="!form.enabled" /></el-form-item></div><div class="form-grid"><el-form-item label="无人回复超时（分钟）"><el-input-number v-model="form.responseTimeoutMinutes" :min="5" :max="10080" /></el-form-item><el-form-item label="账号每日上限"><el-input-number v-model="form.dailyLimit" :min="1" :max="200" /></el-form-item><el-form-item label="最小处理间隔（秒）"><el-input-number v-model="form.minimumIntervalSeconds" :min="30" :max="86400" /></el-form-item><el-form-item label="连续失败暂停阈值"><el-input-number v-model="form.maxConsecutiveFailures" :min="1" :max="20" /></el-form-item><el-form-item label="发送窗口开始"><el-time-picker v-model="form.sendingWindowStart" value-format="HH:mm:ss" format="HH:mm" /></el-form-item><el-form-item label="发送窗口结束"><el-time-picker v-model="form.sendingWindowEnd" value-format="HH:mm:ss" format="HH:mm" /></el-form-item><el-form-item label="IANA 时区"><el-input v-model="form.timezone" maxlength="64" /></el-form-item></div><el-form-item label="自动回复模板"><el-input v-model="form.replyTemplate" type="textarea" :rows="4" maxlength="1000" show-word-limit /><span class="template-help">支持变量：{jobTitle}；不会将候选人原消息发送给生成模型。</span></el-form-item></el-form>
      <template #footer><el-button @click="dialogOpen = false">取消</el-button><el-button type="primary" :loading="saving" @click="save">保存账号策略</el-button></template>
    </el-dialog>
  </div>
</template>

<style scoped>
.safety-alert,.metrics,.accounts-panel{margin-bottom:20px}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.metrics article{padding:18px 20px;border:1px solid var(--border);border-radius:12px;background:var(--surface)}.metrics span{display:block;color:var(--text-secondary);font-size:12px}.metrics strong{display:block;margin-top:6px;font-size:24px}.danger{color:var(--danger)}.account-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;padding:0 20px 20px}.account-grid article{padding:18px;border:1px solid var(--border);border-radius:12px}.account-grid header{display:flex;justify-content:space-between;gap:12px}.account-grid header span{display:block;margin-top:4px;color:var(--text-secondary);font-size:12px}.account-health{display:flex;gap:7px;margin:14px 0}.account-grid dl{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.account-grid dt{color:var(--text-secondary);font-size:12px}.account-grid dd{margin:4px 0 0}.account-grid .el-button{width:100%;margin-top:8px}.attempts-panel{overflow:hidden}.muted,.template-help{color:var(--text-secondary);font-size:12px}.policy-form{margin-top:18px}.switch-row,.form-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:0 18px}.policy-form .el-input-number,.policy-form .el-date-editor{width:100%}.template-help{display:block;margin-top:6px}
@media(max-width:760px){.metrics,.account-grid{grid-template-columns:1fr 1fr}.account-grid{padding:0 14px 14px}.switch-row,.form-grid{grid-template-columns:1fr}.attempts-panel{overflow-x:auto}.attempts-panel .el-table{min-width:760px}}
@media(max-width:480px){.metrics,.account-grid{grid-template-columns:1fr}}
</style>
