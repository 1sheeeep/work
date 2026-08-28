<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { CircleCheck, Refresh, Warning } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { api, apiErrorMessage, ensureCsrf } from '../services/api'
import type { OperationsSummary } from '../types'

const loading = ref(true)
const trialSending = ref(false)
const errorMessage = ref('')
const trialResult = ref('')
const summary = ref<OperationsSummary | null>(null)
const openCircuits = computed(() => summary.value?.gateways.filter(item => item.circuitOpenUntil && new Date(item.circuitOpenUntil) > new Date()).length ?? 0)

async function load() {
  loading.value = true
  errorMessage.value = ''
  try {
    summary.value = (await api.get<OperationsSummary>('/operations')).data
  } catch (error) {
    errorMessage.value = apiErrorMessage(error, '运行状态加载失败')
  } finally {
    loading.value = false
  }
}

async function sendTrial() {
  trialSending.value = true
  trialResult.value = ''
  try {
    await ensureCsrf()
    const { data } = await api.post<{ succeeded: boolean; message: string }>('/operations/notification-trial')
    if (!data.succeeded) {
      ElMessage.error(data.message)
      return
    }
    trialResult.value = data.message
    ElMessage.success('试运行通知已送达')
    await load()
  } catch (error) {
    ElMessage.error(apiErrorMessage(error, '试运行通知发送失败'))
  } finally {
    trialSending.value = false
  }
}

function formatDate(value?: string) {
  return value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(value)) : '暂无待执行任务'
}

onMounted(load)
</script>

<template>
  <div class="page-shell">
    <header class="page-heading">
      <div>
        <h1>运行保障</h1>
        <p>核对数据库迁移、审计防篡改、后台调度与 Gateway 保护状态。</p>
      </div>
      <div class="heading-actions">
        <el-button v-if="summary?.notification?.trialEnabled" type="primary" :loading="trialSending" @click="sendTrial">发送 HR 试运行通知</el-button>
        <el-button :icon="Refresh" :loading="loading" @click="load">重新检查</el-button>
      </div>
    </header>

    <div v-if="loading" class="surface-panel skeleton-stack"><el-skeleton :rows="7" animated /></div>
    <div v-else-if="errorMessage" class="surface-panel error-state">
      <el-icon><Warning /></el-icon><strong>运行信息暂时无法加载</strong><span>{{ errorMessage }}</span><el-button @click="load">重试</el-button>
    </div>

    <template v-else-if="summary">
      <el-alert v-if="trialResult" class="trial-result" type="success" :closable="false" :title="trialResult" show-icon />
      <div class="ops-metrics">
        <article><span>应用状态</span><strong class="healthy"><el-icon><CircleCheck /></el-icon>{{ summary.status }}</strong></article>
        <article><span>Flyway</span><strong>V{{ summary.flywayVersion }}</strong></article>
        <article><span>审计日志</span><strong :class="summary.auditAppendOnly ? 'healthy' : 'danger'">{{ summary.auditAppendOnly ? '只追加' : '需检查' }}</strong></article>
        <article><span>已打开断路</span><strong :class="openCircuits ? 'danger' : 'healthy'">{{ openCircuits }}</strong></article>
      </div>

      <section v-if="summary.scheduler" class="surface-panel scheduler-panel">
        <div class="section-title-row"><div><h2>后台调度与任务租约</h2><p>实例 {{ summary.scheduler.instanceId }}</p></div><el-tag :type="summary.scheduler.enabled ? 'success' : 'danger'">{{ summary.scheduler.enabled ? '已启用' : '已停用' }}</el-tag></div>
        <dl><div><dt>当前租约</dt><dd>{{ summary.scheduler.activeLeases }}</dd></div><div><dt>已到期任务</dt><dd>{{ summary.scheduler.dueTasks }}</dd></div><div><dt>下次计划</dt><dd class="date-value">{{ formatDate(summary.scheduler.nextRunAt) }}</dd></div></dl>
      </section>

      <section v-if="summary.notification" class="surface-panel notification-panel">
        <div class="section-title-row"><div><h2>HR 通知渠道</h2><p>真实渠道仅发送候选人匿名引用，不发送联系人明文。</p></div><el-tag :type="summary.notification.configured ? 'success' : 'warning'">{{ summary.notification.mode }}</el-tag></div>
        <dl><div><dt>渠道配置</dt><dd>{{ summary.notification.configured ? '完整' : '待配置' }}</dd></div><div><dt>试运行开关</dt><dd>{{ summary.notification.trialEnabled ? '已启用' : '已关闭' }}</dd></div></dl>
      </section>

      <section class="surface-panel">
        <div class="section-title-row"><div><h2>Gateway 保护状态</h2><p>检查时间：{{ formatDate(summary.checkedAt) }}</p></div></div>
        <div v-if="!summary.gateways.length" class="empty-state"><el-icon><CircleCheck /></el-icon><strong>尚无 Gateway 调用</strong><span>首次能力检查、任务执行、消息或通知后将显示指标。</span></div>
        <div v-else class="gateway-grid"><article v-for="item in summary.gateways" :key="item.operation"><header><strong>{{ item.operation }}</strong><el-tag :type="item.circuitOpenUntil ? 'danger' : 'success'">{{ item.circuitOpenUntil ? '断路' : '可用' }}</el-tag></header><dl><div><dt>60 秒请求</dt><dd>{{ item.requestsInWindow }}</dd></div><div><dt>连续失败</dt><dd>{{ item.consecutiveFailures }}</dd></div><div><dt>可用并发</dt><dd>{{ item.availablePermits }}</dd></div></dl><p v-if="item.circuitOpenUntil">恢复探测：{{ formatDate(item.circuitOpenUntil) }}</p></article></div>
      </section>

      <section class="surface-panel readiness">
        <div class="section-title-row"><div><h2>上线核对</h2><p>真实证书、域名和密钥仍需在目标环境配置</p></div></div>
        <ul><li><el-icon><CircleCheck /></el-icon>HTTPS / Secure Cookie 生产编排已提供</li><li><el-icon><CircleCheck /></el-icon>Prometheus 指标与存活/就绪探针已提供</li><li><el-icon><CircleCheck /></el-icon>预发布、签名通知试运行与回滚手册已提供</li></ul>
      </section>
    </template>
  </div>
</template>

<style scoped>
.heading-actions{display:flex;gap:10px}.trial-result{margin-bottom:16px}.ops-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px}.ops-metrics article{padding:18px 20px;border:1px solid var(--border);border-radius:12px;background:var(--surface)}.ops-metrics span{display:block;color:var(--text-secondary);font-size:12px}.ops-metrics strong{display:flex;align-items:center;gap:6px;margin-top:8px;font-size:22px}.healthy{color:var(--success)}.danger{color:var(--danger)}.scheduler-panel,.notification-panel{margin-bottom:20px}.scheduler-panel dl,.notification-panel dl{display:grid;grid-template-columns:160px 160px 1fr;gap:16px;padding:0 24px 22px}.scheduler-panel dt,.notification-panel dt,.gateway-grid dt{color:var(--text-secondary);font-size:12px}.scheduler-panel dd,.notification-panel dd,.gateway-grid dd{margin:5px 0 0;font-size:20px;font-weight:700}.scheduler-panel .date-value{font-size:15px}.gateway-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;padding:0 20px 20px}.gateway-grid article{padding:16px;border:1px solid var(--border);border-radius:10px}.gateway-grid header{display:flex;justify-content:space-between;gap:12px}.gateway-grid dl{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.gateway-grid p{color:var(--danger);font-size:12px}.readiness{margin-top:20px}.readiness ul{display:grid;gap:12px;padding:0 24px 22px;list-style:none}.readiness li{display:flex;align-items:center;gap:8px}.readiness .el-icon{color:var(--success)}
@media(max-width:720px){.heading-actions{flex-wrap:wrap;justify-content:flex-end}.ops-metrics,.gateway-grid{grid-template-columns:1fr 1fr}.gateway-grid{padding:0 14px 14px}.scheduler-panel dl,.notification-panel dl{grid-template-columns:1fr 1fr}.scheduler-panel dl div:last-child{grid-column:1/-1}}
@media(max-width:460px){.ops-metrics,.gateway-grid,.scheduler-panel dl,.notification-panel dl{grid-template-columns:1fr}.scheduler-panel dl div:last-child{grid-column:auto}}
</style>
