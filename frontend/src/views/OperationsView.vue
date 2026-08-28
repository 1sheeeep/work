<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { CircleCheck, Refresh, Warning } from '@element-plus/icons-vue'
import { api, apiErrorMessage } from '../services/api'
import type { OperationsSummary } from '../types'

const loading = ref(true)
const errorMessage = ref('')
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

function formatDate(value?: string) {
  return value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(value)) : '暂无数据'
}

onMounted(load)
</script>

<template>
  <div class="page-shell">
    <header class="page-heading">
      <div>
        <h1>运行保障</h1>
        <p>核对数据库迁移、审计防篡改与 Gateway 保护状态。</p>
      </div>
      <div class="heading-actions">
        <el-button :icon="Refresh" :loading="loading" @click="load">重新检查</el-button>
      </div>
    </header>

    <div v-if="loading" class="surface-panel skeleton-stack"><el-skeleton :rows="7" animated /></div>
    <div v-else-if="errorMessage" class="surface-panel error-state">
      <el-icon><Warning /></el-icon><strong>运行信息暂时无法加载</strong><span>{{ errorMessage }}</span><el-button @click="load">重试</el-button>
    </div>

    <template v-else-if="summary">
      <div class="ops-metrics">
        <article><span>应用状态</span><strong class="healthy"><el-icon><CircleCheck /></el-icon>{{ summary.status }}</strong></article>
        <article><span>Flyway</span><strong>V{{ summary.flywayVersion }}</strong></article>
        <article><span>审计日志</span><strong :class="summary.auditAppendOnly ? 'healthy' : 'danger'">{{ summary.auditAppendOnly ? '只追加' : '需检查' }}</strong></article>
        <article><span>已打开断路</span><strong :class="openCircuits ? 'danger' : 'healthy'">{{ openCircuits }}</strong></article>
      </div>

      <section class="surface-panel">
        <div class="section-title-row"><div><h2>Gateway 保护状态</h2><p>检查时间：{{ formatDate(summary.checkedAt) }}</p></div></div>
        <div v-if="!summary.gateways.length" class="empty-state"><el-icon><CircleCheck /></el-icon><strong>尚无 Gateway 调用</strong><span>首次能力检查、任务执行、消息或通知后将显示指标。</span></div>
        <div v-else class="gateway-grid"><article v-for="item in summary.gateways" :key="item.operation"><header><strong>{{ item.operation }}</strong><el-tag :type="item.circuitOpenUntil ? 'danger' : 'success'">{{ item.circuitOpenUntil ? '断路' : '可用' }}</el-tag></header><dl><div><dt>60 秒请求</dt><dd>{{ item.requestsInWindow }}</dd></div><div><dt>连续失败</dt><dd>{{ item.consecutiveFailures }}</dd></div><div><dt>可用并发</dt><dd>{{ item.availablePermits }}</dd></div></dl><p v-if="item.circuitOpenUntil">恢复探测：{{ formatDate(item.circuitOpenUntil) }}</p></article></div>
      </section>

      <section class="surface-panel readiness">
        <div class="section-title-row"><div><h2>上线核对</h2><p>真实证书、域名和密钥仍需在目标环境配置</p></div></div>
        <ul><li><el-icon><CircleCheck /></el-icon>HTTPS / Secure Cookie 生产编排已提供</li><li><el-icon><CircleCheck /></el-icon>Prometheus 指标与存活/就绪探针已提供</li><li><el-icon><CircleCheck /></el-icon>浏览器设备心跳、撤销和风险停机已提供</li></ul>
      </section>
    </template>
  </div>
</template>

<style scoped>
.heading-actions{display:flex;gap:10px}.ops-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px}.ops-metrics article{padding:18px 20px;border:1px solid var(--border);border-radius:12px;background:var(--surface)}.ops-metrics span{display:block;color:var(--text-secondary);font-size:12px}.ops-metrics strong{display:flex;align-items:center;gap:6px;margin-top:8px;font-size:22px}.healthy{color:var(--success)}.danger{color:var(--danger)}.gateway-grid dt{color:var(--text-secondary);font-size:12px}.gateway-grid dd{margin:5px 0 0;font-size:20px;font-weight:700}.gateway-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;padding:0 20px 20px}.gateway-grid article{padding:16px;border:1px solid var(--border);border-radius:10px}.gateway-grid header{display:flex;justify-content:space-between;gap:12px}.gateway-grid dl{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.gateway-grid p{color:var(--danger);font-size:12px}.readiness{margin-top:20px}.readiness ul{display:grid;gap:12px;padding:0 24px 22px;list-style:none}.readiness li{display:flex;align-items:center;gap:8px}.readiness .el-icon{color:var(--success)}
@media(max-width:720px){.heading-actions{flex-wrap:wrap;justify-content:flex-end}.ops-metrics,.gateway-grid{grid-template-columns:1fr 1fr}.gateway-grid{padding:0 14px 14px}}
@media(max-width:460px){.ops-metrics,.gateway-grid{grid-template-columns:1fr}}
</style>
