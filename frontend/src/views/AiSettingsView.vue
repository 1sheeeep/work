<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { CircleCheck, CopyDocument, Cpu, Refresh, Warning } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { api, apiErrorMessage, ensureCsrf } from '../services/api'
import type { OpenAiConfigurationStatus, OpenAiConnectionTest } from '../types'

const router = useRouter()
const loading = ref(true)
const testing = ref(false)
const errorMessage = ref('')
const status = ref<OpenAiConfigurationStatus | null>(null)
const testResult = ref<OpenAiConnectionTest | null>(null)
const completedSteps = computed(() => status.value ? [status.value.apiKeyConfigured, status.value.modelConfigured, status.value.enabled, !!testResult.value?.success].filter(Boolean).length : 0)
const environmentSnippet = `APP_OPENAI_ENABLED=true
OPENAI_API_KEY=请在本机填写你的项目API密钥
OPENAI_MODEL=填写该项目可用且支持Structured Outputs的模型
OPENAI_TIMEOUT=60s`

async function load() {
  loading.value = true
  errorMessage.value = ''
  try { status.value = (await api.get<OpenAiConfigurationStatus>('/ai-configuration/status')).data }
  catch (error) { errorMessage.value = apiErrorMessage(error, 'AI 接入状态加载失败') }
  finally { loading.value = false }
}
async function testConnection() {
  testing.value = true
  testResult.value = null
  try {
    await ensureCsrf()
    testResult.value = (await api.post<OpenAiConnectionTest>('/ai-configuration/test', {}, { timeout: 75_000 })).data
    ElMessage.success('OpenAI 连通测试通过')
  } catch (error) { ElMessage.error(apiErrorMessage(error, 'OpenAI 连通测试失败')) }
  finally { testing.value = false }
}
async function copySnippet() {
  try { await navigator.clipboard.writeText(environmentSnippet); ElMessage.success('配置模板已复制，请只在本机填写 API Key') }
  catch { ElMessage.warning('复制失败，请手动复制配置模板') }
}
function formatDate(value?: string) { return value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(value)) : '尚未测试' }
onMounted(load)
</script>

<template>
  <div class="page-shell ai-settings-page">
    <header class="page-heading"><div><span class="eyebrow">OPENAI SETUP</span><h1>AI 接入</h1><p>由系统管理员在服务器环境配置 OpenAI。API Key 不进入浏览器、数据库、日志或 Git。</p></div><el-button :icon="Refresh" :loading="loading" @click="load">重新读取状态</el-button></header>
    <div v-if="loading" class="surface-panel skeleton-stack"><el-skeleton :rows="8" animated /></div>
    <div v-else-if="errorMessage" class="surface-panel error-state"><el-icon><Warning /></el-icon><strong>AI 配置状态暂时无法读取</strong><span>{{ errorMessage }}</span><el-button @click="load">重试</el-button></div>
    <template v-else-if="status">
      <section class="ai-hero" :class="{ ready: status.ready }"><div><span class="state-chip"><i></i>{{ status.ready ? '配置已就绪，等待连通测试' : '尚未完成配置' }}</span><h2>{{ status.ready ? '可以验证 OpenAI 连接' : '按下面四步完成 AI 接入' }}</h2><p>{{ status.ready ? `服务端已识别模型 ${status.model}，测试请求不会包含候选人或简历数据。` : `还缺少：${status.missingConfiguration.join('、')}` }}</p></div><div class="progress-ring"><strong>{{ completedSteps }}/4</strong><span>完成步骤</span></div></section>

      <section class="status-grid"><article><span>AI 开关</span><strong :class="status.enabled ? 'ok' : 'missing'">{{ status.enabled ? '已开启' : '未开启' }}</strong></article><article><span>服务端 API Key</span><strong :class="status.apiKeyConfigured ? 'ok' : 'missing'">{{ status.apiKeyConfigured ? '已配置' : '未配置' }}</strong><small>永不显示密钥内容</small></article><article><span>分析模型</span><strong :class="status.modelConfigured ? 'ok' : 'missing'">{{ status.model }}</strong></article><article><span>官方服务地址</span><strong :class="status.officialEndpoint ? 'ok' : 'missing'">{{ status.endpointHost || '无效地址' }}</strong></article><article><span>请求存储</span><strong class="ok">store=false</strong></article><article><span>本地结果保留</span><strong>{{ status.resultRetentionDays }} 天</strong></article></section>

      <section class="setup-grid">
        <article class="surface-panel setup-steps"><div class="section-title-row"><div><h2>接入步骤</h2><p>密钥只在项目根目录的本机 `.env` 中填写。</p></div></div><ol><li :class="{done:status.apiKeyConfigured}"><b>{{status.apiKeyConfigured?'✓':'1'}}</b><div><strong>创建 OpenAI 项目 API Key</strong><p>登录 OpenAI Platform，进入 API Keys，为本项目创建单独密钥。不要使用管理员密钥，也不要把密钥发到聊天或前端页面。</p><a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">打开 OpenAI API Keys</a></div></li><li :class="{done:status.apiKeyConfigured&&status.modelConfigured}"><b>{{status.apiKeyConfigured&&status.modelConfigured?'✓':'2'}}</b><div><strong>填写服务器环境变量</strong><p>打开项目根目录 `.env`，填写下面四项。模型必须是你的 OpenAI 项目已获权限且支持 Structured Outputs 的模型。</p><pre>{{ environmentSnippet }}</pre><el-button :icon="CopyDocument" @click="copySnippet">复制配置模板</el-button></div></li><li :class="{done:status.enabled}"><b>{{status.enabled?'✓':'3'}}</b><div><strong>重新创建后端容器</strong><p>保存 `.env` 后，在项目根目录执行以下命令，让服务端读取新配置：</p><pre>docker compose up -d --no-build --force-recreate backend</pre><p>完成后回到本页，点击“重新读取状态”。</p></div></li><li :class="{done:!!testResult?.success}"><b>{{testResult?.success?'✓':'4'}}</b><div><strong>执行无简历数据的连通测试</strong><p>测试只发送固定配置检查文本，验证 API Key、模型、Responses API 和 Structured Outputs，不发送候选人信息。</p><el-button type="primary" :icon="Cpu" :disabled="!status.ready" :loading="testing" @click="testConnection">测试 OpenAI 连接</el-button></div></li></ol></article>

        <aside class="surface-panel test-panel"><div class="section-title-row"><div><h2>测试结果</h2><p>用于排查权限、额度、模型和网络问题。</p></div></div><div v-if="testResult" class="test-success"><el-icon><CircleCheck /></el-icon><strong>{{ testResult.message }}</strong><dl><div><dt>模型</dt><dd>{{ testResult.model }}</dd></div><div><dt>耗时</dt><dd>{{ testResult.elapsedMilliseconds }} ms</dd></div><div><dt>请求 ID</dt><dd>{{ testResult.requestId }}</dd></div><div><dt>时间</dt><dd>{{ formatDate(testResult.checkedAt) }}</dd></div></dl><el-button type="primary" @click="router.push('/resume-intakes')">进入简历审核与分析</el-button></div><div v-else class="test-empty"><span>尚未完成连通测试</span><small>配置状态就绪后，由系统管理员执行一次测试。</small></div><footer><strong>安全说明</strong><p>真实简历分析仍需先审核来源、再由 HR 对每次外部发送单独确认。连通成功不会开启自动筛选、自动淘汰或自动发送。</p></footer></aside>
      </section>
    </template>
  </div>
</template>

<style scoped>
.ai-settings-page{max-width:1340px}.eyebrow{display:block;margin-bottom:8px;color:var(--brand-700);font-size:10px;font-weight:800;letter-spacing:.12em}.ai-hero{display:flex;align-items:center;justify-content:space-between;gap:24px;margin-bottom:16px;padding:26px 28px;border:1px solid #f0d8ac;border-radius:19px;background:radial-gradient(circle at 88% 0,rgba(255,225,170,.65),transparent 38%),linear-gradient(135deg,#fff,#fffaf1);box-shadow:var(--shadow-sm)}.ai-hero.ready{border-color:#a9dacd;background:radial-gradient(circle at 88% 0,rgba(186,246,230,.75),transparent 38%),linear-gradient(135deg,#fff,#f0fbf8)}.state-chip{display:inline-flex;align-items:center;gap:7px;padding:6px 9px;border-radius:999px;background:#fff1d8;color:#9a6700;font-size:11px;font-weight:700}.state-chip i{width:7px;height:7px;border-radius:50%;background:#e79b25}.ready .state-chip{background:#dff7ef;color:#087f5b}.ready .state-chip i{background:#12b76a}.ai-hero h2{margin:12px 0 7px;font-size:26px;letter-spacing:-.025em}.ai-hero p{margin:0;color:var(--text-secondary);line-height:1.6}.progress-ring{display:grid;width:108px;height:108px;flex:0 0 auto;place-items:center;align-content:center;border:8px solid #e7efed;border-top-color:var(--brand-600);border-radius:50%;background:#fff}.progress-ring strong{font-size:22px}.progress-ring span{color:var(--text-secondary);font-size:10px}.status-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:16px}.status-grid article{padding:16px;border:1px solid var(--border);border-radius:13px;background:#fff}.status-grid span,.status-grid strong,.status-grid small{display:block}.status-grid span{color:var(--text-secondary);font-size:11px}.status-grid strong{margin-top:7px;font-size:15px;word-break:break-word}.status-grid small{margin-top:5px;color:var(--text-secondary);font-size:10px}.ok{color:var(--success)}.missing{color:var(--warning)}.setup-grid{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(330px,.75fr);gap:16px}.setup-steps,.test-panel{overflow:hidden}.setup-steps ol{display:grid;margin:0;padding:0 22px 22px;list-style:none}.setup-steps li{display:grid;grid-template-columns:34px 1fr;gap:13px;padding:18px 0;border-top:1px solid var(--border)}.setup-steps li:first-child{border-top:0}.setup-steps li>b{display:grid;width:30px;height:30px;place-items:center;border-radius:9px;background:#eef2f4;color:#667085}.setup-steps li.done>b{background:#d9f8e7;color:#087f5b}.setup-steps li strong{font-size:14px}.setup-steps p{margin:5px 0 9px;color:var(--text-secondary);font-size:12px;line-height:1.6}.setup-steps a{color:var(--brand-700);font-size:12px;font-weight:700}.setup-steps pre{margin:10px 0;padding:13px;border-radius:10px;background:#102f2c;color:#d8f3ee;font:12px/1.65 "Cascadia Code",monospace;white-space:pre-wrap;word-break:break-word}.test-panel{align-self:start}.test-success{display:grid;justify-items:start;gap:8px;padding:24px}.test-success>svg{width:38px;color:var(--success)}.test-success dl{display:grid;width:100%;gap:10px;margin:10px 0}.test-success dl div{display:grid;grid-template-columns:72px 1fr;gap:8px}.test-success dt{color:var(--text-secondary);font-size:11px}.test-success dd{margin:0;font-size:12px;word-break:break-all}.test-empty{display:grid;gap:6px;padding:32px 22px}.test-empty span{font-weight:700}.test-empty small{color:var(--text-secondary)}.test-panel footer{padding:17px 22px;border-top:1px solid var(--border);background:var(--surface-soft)}.test-panel footer strong{font-size:12px}.test-panel footer p{margin:6px 0 0;color:var(--text-secondary);font-size:11px;line-height:1.6}@media(max-width:1100px){.status-grid{grid-template-columns:repeat(3,1fr)}.setup-grid{grid-template-columns:1fr}}@media(max-width:700px){.ai-hero{align-items:flex-start;padding:22px}.progress-ring{width:88px;height:88px}.status-grid{grid-template-columns:repeat(2,1fr)}.setup-steps ol{padding:0 16px 16px}}@media(max-width:460px){.ai-hero{flex-direction:column}.status-grid{grid-template-columns:1fr}}
</style>
