<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Clock, Refresh } from '@element-plus/icons-vue'
import { api, apiErrorMessage } from '../services/api'
import type { AuditLog } from '../types'

const loading = ref(true)
const errorMessage = ref('')
const logs = ref<AuditLog[]>([])
const actionLabels: Record<string, string> = {
  LOGIN: '登录系统', LOGOUT: '退出系统', UPDATE_GROUP: '更新集团资料',
  CREATE_COMPANY: '新增企业', UPDATE_COMPANY: '更新企业资料', CHANGE_COMPANY_STATUS: '变更企业状态',
  CREATE_HR_USER: '新增 HR 用户', UPDATE_HR_USER: '更新 HR 用户',
  CHANGE_HR_USER_STATUS: '变更 HR 用户状态', RESET_HR_USER_PASSWORD: '重置 HR 用户密码',
  CREATE_BOSS_ACCOUNT: '新增 BOSS 账号', UPDATE_BOSS_ACCOUNT: '更新 BOSS 账号',
  CHANGE_BOSS_ACCOUNT_STATUS: '变更 BOSS 账号状态', CHECK_BOSS_CAPABILITIES: '检查 BOSS 账号能力',
  CREATE_JOB_POSITION: '新增职位', UPDATE_JOB_POSITION: '更新职位',
  CHANGE_JOB_POSITION_STATUS: '变更职位状态',
  CREATE_RECRUITMENT_TASK: '新增招聘任务', UPDATE_RECRUITMENT_TASK: '更新招聘任务',
  CHANGE_RECRUITMENT_TASK_STATUS: '变更招聘任务状态', RUN_RECRUITMENT_TASK: '执行招聘任务',
  RETRY_RECRUITMENT_TASK: '重试招聘任务',
  CREATE_CANDIDATE_CONTACT: '新增候选人', TAKE_OVER_CANDIDATE: '人工接管候选人',
  RELEASE_CANDIDATE: '释放人工接管', OVERRIDE_CANDIDATE_SCREENING: '人工覆盖筛选结论',
  IMPORT_CANDIDATE_MESSAGE: '写入候选人消息', CREATE_MESSAGE_DRAFT: '新增外发草稿',
  REVIEW_AND_SEND_MESSAGE: '审核并发送消息', REJECT_MESSAGE_DRAFT: '驳回外发草稿',
  ANONYMIZE_CANDIDATE: '匿名化候选人',
}

async function loadLogs() {
  loading.value = true
  errorMessage.value = ''
  try {
    const { data } = await api.get<AuditLog[]>('/audit-logs', { params: { limit: 100 } })
    logs.value = data
  } catch (error) {
    errorMessage.value = apiErrorMessage(error, '操作日志加载失败，请重试')
  } finally {
    loading.value = false
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(value))
}

onMounted(loadLogs)
</script>

<template>
  <div class="page-shell">
    <header class="page-heading">
      <div><h1>操作日志</h1><p>查看管理员与系统关键操作，当前保留最近 100 条记录。</p></div>
      <el-button :icon="Refresh" :loading="loading" @click="loadLogs">刷新日志</el-button>
    </header>
    <section class="surface-panel audit-panel" aria-labelledby="audit-heading">
      <div class="section-title-row"><div><h2 id="audit-heading">最近操作</h2><p>登录、组织资料和企业状态变更均会留痕</p></div></div>
      <div v-if="loading" class="skeleton-stack" aria-label="正在加载操作日志"><el-skeleton :rows="6" animated /></div>
      <div v-else-if="errorMessage" class="error-state" role="alert">
        <span class="error-state__icon"><el-icon><Refresh /></el-icon></span><strong>日志暂时无法加载</strong><span>{{ errorMessage }}</span><el-button @click="loadLogs">重新加载</el-button>
      </div>
      <div v-else-if="logs.length === 0" class="empty-state"><span class="empty-state__icon"><el-icon><Clock /></el-icon></span><strong>暂无操作日志</strong><span>完成登录或组织资料变更后，记录会显示在这里。</span></div>
      <template v-else>
        <el-table :data="logs" class="audit-table">
          <el-table-column label="时间" min-width="190"><template #default="{ row }">{{ formatDate(row.occurredAt) }}</template></el-table-column>
          <el-table-column prop="actorName" label="操作人" min-width="120" />
          <el-table-column label="操作" min-width="150"><template #default="{ row }"><strong>{{ actionLabels[row.action] || row.action }}</strong></template></el-table-column>
          <el-table-column prop="targetLabel" label="对象" min-width="160"><template #default="{ row }">{{ row.targetLabel || '系统' }}</template></el-table-column>
          <el-table-column prop="details" label="详情" min-width="220" />
          <el-table-column label="结果" width="100"><template #default="{ row }"><el-tag :type="row.result === 'SUCCESS' ? 'success' : 'danger'">{{ row.result === 'SUCCESS' ? '成功' : '失败' }}</el-tag></template></el-table-column>
        </el-table>
        <div class="audit-cards">
          <article v-for="log in logs" :key="log.id"><header><strong>{{ actionLabels[log.action] || log.action }}</strong><el-tag :type="log.result === 'SUCCESS' ? 'success' : 'danger'" size="small">{{ log.result === 'SUCCESS' ? '成功' : '失败' }}</el-tag></header><strong class="audit-target">{{ log.targetLabel || '系统' }}</strong><p>{{ log.details || '系统操作' }}</p><footer><span>{{ log.actorName }}</span><time>{{ formatDate(log.occurredAt) }}</time></footer></article>
        </div>
      </template>
    </section>
  </div>
</template>

<style scoped>
.audit-panel { overflow: hidden; }
.audit-table { width: 100%; }
.audit-cards { display: none; }
@media (max-width: 720px) {
  .audit-table { display: none; }
  .audit-cards { display: grid; gap: 12px; padding: 14px; }
  .audit-cards article { padding: 16px; border: 1px solid var(--border); border-radius: 10px; }
  .audit-cards header, .audit-cards footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .audit-target { display: block; margin-top: 16px; font-size: 14px; }
  .audit-cards p { margin: 6px 0 14px; color: var(--text-secondary); line-height: 1.55; }
  .audit-cards footer { color: var(--text-secondary); font-size: 12px; }
}
</style>
