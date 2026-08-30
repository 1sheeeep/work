<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Refresh, Search, UserFilled } from "@element-plus/icons-vue";
import {
  api,
  apiErrorMessage,
  ensureCsrf,
} from "../services/api";
import { authStore } from "../stores/auth";
import type {
  CandidateContact,
  CandidateContactStatus,
  CandidateDetail,
  Company,
  ScreeningOutcome,
} from "../types";

const loading = ref(true),
  loadError = ref(""),
  candidates = ref<CandidateContact[]>([]),
  companies = ref<Company[]>([]);
const keyword = ref(""),
  companyFilter = ref(""),
  statusFilter = ref<CandidateContactStatus | "">(""),
  takeoverFilter = ref("");
const detailOpen = ref(false),
  detailLoading = ref(false),
  detail = ref<CandidateDetail | null>(null),
  acting = ref(false);
const selectedId = ref(""),
  quickFilter = ref<"ALL" | "NEEDS_REPLY" | "AUTO_REPLIED" | "DRAFT" | "TAKEN">("NEEDS_REPLY");
const displayedCandidates = computed(() =>
  candidates.value.filter(
    (candidate) =>
      quickFilter.value === "ALL" ||
      (quickFilter.value === "NEEDS_REPLY" && candidate.needsHrFollowUp) ||
      (quickFilter.value === "AUTO_REPLIED" && candidate.latestAutoReplyStatus === "SENT") ||
      (quickFilter.value === "DRAFT" && candidate.pendingReviewDraft) ||
      (quickFilter.value === "TAKEN" && candidate.humanTakenOver) ||
      false,
  ),
);
const selectedCandidate = computed(
  () =>
    candidates.value.find((candidate) => candidate.id === selectedId.value) ||
    displayedCandidates.value[0] ||
    null,
);
const quickFilters = computed(() => [
  {
    value: "ALL" as const,
    label: "全部会话",
    count: candidates.value.length,
  },
  {
    value: "NEEDS_REPLY" as const,
    label: "待 HR 跟进",
    count: candidates.value.filter((item) => item.needsHrFollowUp).length,
  },
  {
    value: "AUTO_REPLIED" as const,
    label: "已自动接待",
    count: candidates.value.filter((item) => item.latestAutoReplyStatus === "SENT").length,
  },
  {
    value: "DRAFT" as const,
    label: "待审核草稿",
    count: candidates.value.filter((item) => item.pendingReviewDraft).length,
  },
  {
    value: "TAKEN" as const,
    label: "人工接管",
    count: candidates.value.filter((item) => item.humanTakenOver).length,
  },
]);
const canAnonymize = computed(() => authStore.state.user?.role !== "RECRUITER");
const stats = computed(() => ({
  total: candidates.value.length,
  replied: candidates.value.filter((c) => c.latestAutoReplyStatus === "SENT").length,
  taken: candidates.value.filter((c) => c.humanTakenOver).length,
  pending: candidates.value.filter((c) => c.needsHrFollowUp).length,
}));
const statusLabels: Record<CandidateContactStatus, string> = {
  NEW: "新候选人",
  SCREENING: "筛选中",
  QUALIFIED: "已通过",
  REJECTED: "已淘汰",
  CONTACTING: "沟通中",
};
const outcomeLabels: Record<ScreeningOutcome, string> = {
  PASS: "通过",
  REJECT: "淘汰",
  REVIEW: "待复核",
};

function statusType(status: CandidateContactStatus) {
  return (
    {
      NEW: "info",
      SCREENING: "warning",
      QUALIFIED: "success",
      REJECTED: "danger",
      CONTACTING: "primary",
    } as const
  )[status];
}
function decisionType(outcome?: ScreeningOutcome) {
  return outcome === "PASS"
    ? "success"
    : outcome === "REJECT"
      ? "danger"
      : "warning";
}
async function loadData() {
  loading.value = true;
  loadError.value = "";
  try {
    const [cr, or] = await Promise.all([
      api.get<CandidateContact[]>("/candidate-contacts", {
        params: {
          keyword: keyword.value.trim() || undefined,
          companyId: companyFilter.value || undefined,
          status: statusFilter.value || undefined,
          humanTakenOver:
            takeoverFilter.value === ""
              ? undefined
              : takeoverFilter.value === "true",
        },
      }),
      api.get<Company[]>("/organization/companies"),
    ]);
    candidates.value = cr.data;
    companies.value = or.data;
    if (!cr.data.some((item) => item.id === selectedId.value))
      selectedId.value = cr.data[0]?.id || "";
  } catch (e) {
    loadError.value = apiErrorMessage(e, "候选人加载失败");
  } finally {
    loading.value = false;
  }
}
function selectCandidate(candidate: CandidateContact) {
  selectedId.value = candidate.id;
}
function relativeTime(value: string) {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 60_000),
  );
  if (minutes < 1) return "刚刚更新";
  if (minutes < 60) return `${minutes} 分钟前更新`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前更新`;
  return `${Math.floor(hours / 24)} 天前更新`;
}
async function openDetail(candidate: CandidateContact) {
  detailOpen.value = true;
  detailLoading.value = true;
  try {
    detail.value = (
      await api.get<CandidateDetail>(`/candidate-contacts/${candidate.id}`)
    ).data;
  } catch (e) {
    ElMessage.error(apiErrorMessage(e, "候选人详情加载失败"));
  } finally {
    detailLoading.value = false;
  }
}
async function refreshDetail() {
  if (detail.value) await openDetail(detail.value.candidate);
}
async function mutate(path: string, success: string) {
  if (!detail.value) return;
  acting.value = true;
  try {
    await ensureCsrf();
    await api.post(path);
    ElMessage.success(success);
    await refreshDetail();
    await loadData();
  } catch (e) {
    ElMessage.error(apiErrorMessage(e, "操作失败"));
  } finally {
    acting.value = false;
  }
}
async function takeover() {
  await mutate(
    `/candidate-contacts/${detail.value?.candidate.id}/takeover`,
    "已由当前 HR 人工接管",
  );
}
async function release() {
  await mutate(
    `/candidate-contacts/${detail.value?.candidate.id}/release`,
    "已释放人工接管",
  );
}
async function humanDecision(outcome: ScreeningOutcome) {
  if (!detail.value) return;
  try {
    const { value } = await ElMessageBox.prompt(
      "请输入人工判断理由",
      "人工覆盖筛选结论",
      {
        inputPlaceholder: "说明通过、淘汰或待复核的原因",
        inputValidator: (v) => !!v.trim() || "理由不能为空",
        confirmButtonText: "确认记录",
      },
    );
    await ensureCsrf();
    await api.post(
      `/candidate-contacts/${detail.value.candidate.id}/screening/human`,
      { outcome, rationale: value },
    );
    ElMessage.success("人工筛选结论已记录");
    await refreshDetail();
    await loadData();
  } catch (e) {
    if (e !== "cancel" && e !== "close")
      ElMessage.error(apiErrorMessage(e, "人工结论保存失败"));
  }
}
async function anonymize() {
  if (!detail.value) return;
  try {
    await ElMessageBox.confirm(
      "将清除候选人资料、筛选理由与会话正文，仅保留不可逆去重摘要和审计链。",
      "确认匿名化",
      { type: "warning", confirmButtonText: "确认匿名化" },
    );
    await mutate(
      `/candidate-contacts/${detail.value.candidate.id}/anonymize`,
      "候选人资料已匿名化",
    );
  } catch (e) {
    if (e !== "cancel" && e !== "close")
      ElMessage.error(apiErrorMessage(e, "匿名化失败"));
  }
}
function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
onMounted(loadData);
</script>

<template>
  <div class="page-shell">
    <header class="page-heading">
      <div>
        <h1>待跟进会话</h1>
        <p>HR 返回后优先处理仍在等待的候选人；已自动接待的会话不会被当作已经完成。</p>
      </div>
      <el-button :icon="Refresh" @click="loadData">刷新</el-button>
    </header>
    <el-alert
      title="隐私保护：原始外部候选人 ID 不落库，联系方式不采集；所有外发消息默认进入人工审核。"
      type="info"
      :closable="false"
      show-icon
      class="privacy-alert"
    />
    <div v-if="loading" class="surface-panel skeleton-stack">
      <el-skeleton :rows="7" animated />
    </div>
    <div v-else-if="loadError" class="surface-panel error-state">
      <el-icon><Refresh /></el-icon><strong>候选人暂时无法加载</strong
      ><span>{{ loadError }}</span
      ><el-button @click="loadData">重新加载</el-button>
    </div>
    <template v-else
      ><div class="candidate-metrics">
        <div>
          <span>全部会话</span><strong>{{ stats.total }}</strong>
        </div>
        <div>
          <span>已自动接待</span><strong>{{ stats.replied }}</strong>
        </div>
        <div>
          <span>待 HR 跟进</span><strong>{{ stats.pending }}</strong>
        </div>
        <div>
          <span>人工接管</span><strong>{{ stats.taken }}</strong>
        </div>
      </div>
      <section class="surface-panel candidates-panel">
        <div class="section-title-row candidates-title">
          <div>
            <h2>会话队列</h2>
            <p>等待最久的未完成会话优先排列</p>
          </div>
          <div class="filters">
            <el-input
              v-model="keyword"
              clearable
              placeholder="搜索候选人、当前职位或目标职位"
              :prefix-icon="Search"
              @keyup.enter="loadData"
            /><el-select
              v-model="companyFilter"
              clearable
              placeholder="全部企业"
              @change="loadData"
              ><el-option
                v-for="c in companies"
                :key="c.id"
                :label="c.name"
                :value="c.id" /></el-select
            ><el-select
              v-model="statusFilter"
              placeholder="全部状态"
              @change="loadData"
              ><el-option label="全部状态" value="" /><el-option
                v-for="(label, value) in statusLabels"
                :key="value"
                :label="label"
                :value="value" /></el-select
            ><el-select
              v-model="takeoverFilter"
              placeholder="全部接管状态"
              @change="loadData"
              ><el-option label="全部接管状态" value="" /><el-option
                label="人工接管"
                value="true" /><el-option
                label="自动流程"
                value="false" /></el-select
            ><el-button @click="loadData">查询</el-button>
          </div>
        </div>
        <div v-if="!candidates.length" class="empty-state">
          <el-icon><UserFilled /></el-icon
          ><strong>还没有符合条件的候选人</strong
          ><span>真实候选人会由本地连接器和后端受信链路建立，不能在前端手工造数据。</span>
        </div>
        <template v-else>
          <div class="candidate-workspace">
            <aside class="candidate-queues" aria-label="候选人快捷分类">
              <span class="workspace-label">快捷分类</span>
              <button
                v-for="item in quickFilters"
                :key="item.value"
                type="button"
                :class="{ active: quickFilter === item.value }"
                @click="quickFilter = item.value"
              >
                <span>{{ item.label }}</span
                ><strong>{{ item.count }}</strong>
              </button>
            </aside>
            <section class="candidate-inbox" aria-label="候选人列表">
              <header>
                <div>
                  <strong>{{
                    quickFilters.find((item) => item.value === quickFilter)
                      ?.label
                  }}</strong
                  ><span>{{ displayedCandidates.length }} 个会话</span>
                </div>
              </header>
              <div v-if="!displayedCandidates.length" class="queue-empty">
                当前分类暂无候选人
              </div>
              <button
                v-for="candidate in displayedCandidates"
                :key="candidate.id"
                type="button"
                class="candidate-row"
                :class="{ active: selectedCandidate?.id === candidate.id }"
                @click="selectCandidate(candidate)"
              >
                <span class="candidate-avatar">{{
                  candidate.displayName.slice(0, 1)
                }}</span>
                <span class="candidate-main"
                  ><strong>{{ candidate.displayName }}</strong
                  ><small>{{ candidate.latestMessagePreview || "暂无会话消息" }}</small
                  ><em>{{ candidate.jobPosition.title }} · {{ candidate.bossAccount.displayName }}</em
                  ></span
                >
                <span class="candidate-state"
                  ><el-tag :type="candidate.needsHrFollowUp ? 'warning' : 'info'" size="small">{{ candidate.needsHrFollowUp ? "待跟进" : "已处理" }}</el-tag
                  ><small>{{ candidate.latestMessageAt ? relativeTime(candidate.latestMessageAt) : "暂无消息" }}</small></span
                >
              </button>
            </section>
            <aside
              v-if="selectedCandidate"
              class="candidate-preview"
              aria-label="候选人摘要"
            >
              <header>
                <span class="preview-avatar">{{
                  selectedCandidate.displayName.slice(0, 1)
                }}</span>
                <div>
                  <h3>{{ selectedCandidate.displayName }}</h3>
                  <p>
                    {{ selectedCandidate.currentTitle || "未填写当前职位" }}
                  </p>
                </div>
                <el-tag :type="statusType(selectedCandidate.status)">{{
                  statusLabels[selectedCandidate.status]
                }}</el-tag>
              </header>
              <section>
                <span class="workspace-label">应聘信息</span>
                <dl>
                  <div>
                    <dt>目标职位</dt>
                    <dd>{{ selectedCandidate.jobPosition.title }}</dd>
                  </div>
                  <div>
                    <dt>所属企业</dt>
                    <dd>{{ selectedCandidate.company.name }}</dd>
                  </div>
                  <div>
                    <dt>工作年限</dt>
                    <dd>{{ selectedCandidate.yearsExperience ?? "-" }} 年</dd>
                  </div>
                  <div>
                    <dt>学历</dt>
                    <dd>{{ selectedCandidate.education || "-" }}</dd>
                  </div>
                </dl>
              </section>
              <section>
                <span class="workspace-label">会话与接管</span>
                <div class="decision-summary">
                  <p>
                    <span>当前状态</span><el-tag size="small" :type="selectedCandidate.needsHrFollowUp ? 'warning' : 'success'">{{ selectedCandidate.needsHrFollowUp ? "等待 HR 跟进" : "无需跟进" }}</el-tag>
                  </p>
                  <p>
                    <span>自动接待</span><strong>{{ selectedCandidate.latestAutoReplyStatus === "SENT" ? "已发送" : selectedCandidate.pendingReviewDraft ? "草稿待审核" : "尚未发送" }}</strong>
                  </p>
                  <p>
                    <span>处理方式</span
                    ><strong>{{
                      selectedCandidate.humanTakenOver
                        ? selectedCandidate.assignedHr?.displayName ||
                          "人工接管"
                        : "自动流程"
                    }}</strong>
                  </p>
                </div>
              </section>
              <footer>
                <el-button type="primary" @click="openDetail(selectedCandidate)">打开会话并跟进</el-button><small>{{ selectedCandidate.latestMessageAt ? relativeTime(selectedCandidate.latestMessageAt) : "暂无消息" }}</small>
              </footer>
            </aside>
          </div>
          <el-table :data="candidates" class="candidates-table legacy-table"
            ><el-table-column label="候选人" min-width="180"
              ><template #default="{ row }"
                ><strong>{{ row.displayName }}</strong>
                <div class="muted">
                  {{ row.currentTitle || "未填写当前职位" }} ·
                  {{ row.sourceReference }}
                </div></template
              ></el-table-column
            ><el-table-column label="目标职位 / 企业" min-width="210"
              ><template #default="{ row }"
                ><strong>{{ row.jobPosition.title }}</strong>
                <div class="muted">{{ row.company.name }}</div></template
              ></el-table-column
            ><el-table-column label="筛选结论" min-width="190"
              ><template #default="{ row }"
                ><el-tag
                  size="small"
                  :type="decisionType(row.latestHardRule?.outcome)"
                  >硬规则
                  {{
                    outcomeLabels[
                      row.latestHardRule?.outcome as ScreeningOutcome
                    ]
                  }}</el-tag
                ><el-tag
                  size="small"
                  :type="decisionType(row.latestAiSuggestion?.outcome)"
                  >AI
                  {{
                    outcomeLabels[
                      row.latestAiSuggestion?.outcome as ScreeningOutcome
                    ]
                  }}</el-tag
                ></template
              ></el-table-column
            ><el-table-column label="状态" width="120"
              ><template #default="{ row }"
                ><el-tag :type="statusType(row.status)">{{
                  statusLabels[row.status as CandidateContactStatus]
                }}</el-tag></template
              ></el-table-column
            ><el-table-column label="接管" width="120"
              ><template #default="{ row }">{{
                row.humanTakenOver
                  ? row.assignedHr?.displayName || "人工接管"
                  : "自动流程"
              }}</template></el-table-column
            ><el-table-column label="操作" width="100" fixed="right"
              ><template #default="{ row }"
                ><el-button
                  link
                  type="primary"
                  @click="openDetail(row as CandidateContact)"
                  >工作台</el-button
                ></template
              ></el-table-column
            ></el-table
          >
          <div class="candidate-cards">
            <article v-for="candidate in candidates" :key="candidate.id">
              <header>
                <div>
                  <strong>{{ candidate.displayName }}</strong
                  ><span>{{ candidate.currentTitle || "未填写当前职位" }}</span>
                </div>
                <el-tag :type="statusType(candidate.status)" size="small">{{
                  statusLabels[candidate.status]
                }}</el-tag>
              </header>
              <dl>
                <div>
                  <dt>目标职位</dt>
                  <dd>{{ candidate.jobPosition.title }}</dd>
                </div>
                <div>
                  <dt>企业</dt>
                  <dd>{{ candidate.company.name }}</dd>
                </div>
                <div>
                  <dt>筛选</dt>
                  <dd>
                    硬规则
                    {{
                      outcomeLabels[
                        candidate.latestHardRule?.outcome as ScreeningOutcome
                      ]
                    }}
                    / AI
                    {{
                      outcomeLabels[
                        candidate.latestAiSuggestion
                          ?.outcome as ScreeningOutcome
                      ]
                    }}
                  </dd>
                </div>
                <div>
                  <dt>接管</dt>
                  <dd>
                    {{
                      candidate.humanTakenOver
                        ? candidate.assignedHr?.displayName || "人工接管"
                        : "自动流程"
                    }}
                  </dd>
                </div>
              </dl>
              <el-button type="primary" plain @click="openDetail(candidate)"
                >打开工作台</el-button
              >
            </article>
          </div></template
        >
      </section></template
    >

    <el-drawer
      v-model="detailOpen"
      :title="`${detail?.candidate.displayName ?? ''} · 候选人工作台`"
      size="min(760px,96vw)"
      ><el-skeleton v-if="detailLoading" :rows="8" animated /><template
        v-else-if="detail"
        ><section class="profile-card">
          <div>
            <el-tag :type="statusType(detail.candidate.status)">{{
              statusLabels[detail.candidate.status]
            }}</el-tag
            ><strong
              >{{ detail.candidate.jobPosition.title }} ·
              {{ detail.candidate.company.name }}</strong
            ><span
              >{{ detail.candidate.sourceReference }} · 不保存原始外部 ID</span
            >
          </div>
          <div class="profile-actions">
            <el-button
              v-if="!detail.candidate.humanTakenOver"
              type="warning"
              :loading="acting"
              @click="takeover"
              >人工接管</el-button
            ><el-button v-else :loading="acting" @click="release"
              >释放接管</el-button
            ><el-button
              v-if="canAnonymize && detail.candidate.privacyStatus === 'ACTIVE'"
              type="danger"
              plain
              @click="anonymize"
              >匿名化</el-button
            >
          </div>
        </section>
        <el-tabs
          ><el-tab-pane label="筛选记录"
            ><div class="decision-actions">
              <el-button type="success" plain @click="humanDecision('PASS')"
                >人工通过</el-button
              ><el-button type="warning" plain @click="humanDecision('REVIEW')"
                >待复核</el-button
              ><el-button type="danger" plain @click="humanDecision('REJECT')"
                >人工淘汰</el-button
              >
            </div>
            <div class="timeline-list">
              <article v-for="decision in detail.decisions" :key="decision.id">
                <header>
                  <strong>{{
                    decision.decisionType === "HARD_RULE"
                      ? "硬规则"
                      : decision.decisionType === "AI_SUGGESTION"
                        ? "AI 建议"
                        : "人工覆盖"
                  }}</strong
                  ><el-tag
                    :type="decisionType(decision.outcome)"
                    size="small"
                    >{{ outcomeLabels[decision.outcome] }}</el-tag
                  >
                </header>
                <p>{{ decision.rationale }}</p>
                <footer>
                  <span>{{
                    decision.modelVersion ||
                    decision.engineVersion ||
                    decision.createdBy?.displayName
                  }}</span
                  ><time>{{ formatDate(decision.createdAt) }}</time>
                </footer>
              </article>
            </div></el-tab-pane
          ><el-tab-pane label="会话记录"
            ><el-alert
              class="conversation-source-note"
              type="info"
              :closable="false"
              title="会话记录来自本地连接器，当前页面不提供手工补录或发送入口。"
            /><el-empty
              v-if="!detail.messages.length"
              description="暂无会话消息"
            />
            <div v-else class="message-list">
              <article
                v-for="message in detail.messages"
                :key="message.id"
                :class="message.direction.toLowerCase()"
              >
                <header>
                  <strong>{{
                    message.senderType === "CANDIDATE"
                      ? "候选人"
                      : message.senderType
                  }}</strong
                  ><el-tag
                    size="small"
                    :type="
                      message.deliveryStatus === 'SENT' ||
                      message.deliveryStatus === 'RECEIVED'
                        ? 'success'
                        : message.deliveryStatus === 'PENDING_REVIEW'
                          ? 'warning'
                          : 'danger'
                    "
                    >{{ message.deliveryStatus }}</el-tag
                  >
                </header>
                <p>{{ message.content }}</p>
                <footer>
                  {{ formatDate(message.createdAt)
                  }}<span v-if="message.modelVersion"
                    >{{ message.modelVersion }} /
                    {{ message.promptVersion }}</span
                  >
                </footer>
              </article>
            </div></el-tab-pane
          ></el-tabs
        ></template
      ></el-drawer
    >

  </div>
</template>

<style scoped>
.privacy-alert {
  margin-bottom: 20px;
}
.candidate-metrics {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  margin-bottom: 20px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  overflow: hidden;
}
.conversation-source-note {
  margin-bottom: 16px;
}
.candidate-metrics div {
  padding: 18px 22px;
  border-right: 1px solid var(--border);
}
.candidate-metrics div:last-child {
  border: 0;
}
.candidate-metrics span,
.candidate-metrics strong {
  display: block;
}
.candidate-metrics span,
.muted {
  color: var(--text-secondary);
  font-size: 12px;
}
.candidate-metrics strong {
  margin-top: 5px;
  font-size: 24px;
}
.candidates-panel {
  overflow: hidden;
}
.candidates-title {
  align-items: flex-end;
}
.filters {
  display: grid;
  grid-template-columns: minmax(230px, 1fr) 140px 130px 145px auto;
  gap: 8px;
}
.candidates-table {
  width: 100%;
}
.legacy-table {
  display: none;
}
.candidate-workspace {
  display: grid;
  min-height: 570px;
  grid-template-columns: 180px minmax(340px, 1fr) 320px;
  background: #fff;
}
.candidate-queues {
  padding: 18px 12px;
  border-right: 1px solid var(--border);
  background: #f8faf9;
}
.workspace-label {
  display: block;
  margin: 0 10px 10px;
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
}
.candidate-queues button {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 5px;
  padding: 11px 10px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: #475467;
  cursor: pointer;
  text-align: left;
}
.candidate-queues button:hover {
  background: #eef5f3;
}
.candidate-queues button.active {
  background: #dff4ef;
  color: var(--brand-900);
  font-weight: 750;
}
.candidate-queues button strong {
  display: grid;
  min-width: 25px;
  height: 25px;
  place-items: center;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.8);
  font-size: 12px;
}
.candidate-inbox {
  min-width: 0;
  border-right: 1px solid var(--border);
}
.candidate-inbox > header {
  display: flex;
  min-height: 62px;
  align-items: center;
  padding: 0 17px;
  border-bottom: 1px solid var(--border);
}
.candidate-inbox > header strong,
.candidate-inbox > header span {
  display: block;
}
.candidate-inbox > header span {
  margin-top: 3px;
  color: var(--text-secondary);
  font-size: 11px;
}
.candidate-row {
  display: grid;
  width: 100%;
  grid-template-columns: 42px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 15px 16px;
  border: 0;
  border-bottom: 1px solid #edf1f0;
  background: #fff;
  color: var(--text);
  cursor: pointer;
  text-align: left;
}
.candidate-row:hover {
  background: #f8fbfa;
}
.candidate-row.active {
  background: #eff8f6;
  box-shadow: inset 3px 0 0 var(--brand-600);
}
.candidate-avatar,
.preview-avatar {
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: #e7f5f2;
  color: var(--brand-900);
  font-weight: 800;
}
.candidate-avatar {
  width: 42px;
  height: 42px;
}
.candidate-main {
  min-width: 0;
}
.candidate-main strong,
.candidate-main small,
.candidate-main em {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.candidate-main small {
  margin-top: 3px;
  color: #667085;
  font-size: 12px;
}
.candidate-main em {
  margin-top: 6px;
  color: #344054;
  font-size: 11px;
  font-style: normal;
}
.candidate-state {
  display: grid;
  justify-items: end;
  gap: 7px;
}
.candidate-state small {
  color: #98a2b3;
  font-size: 10px;
  white-space: nowrap;
}
.queue-empty {
  padding: 64px 20px;
  color: var(--text-secondary);
  text-align: center;
}
.candidate-preview {
  padding: 20px;
  background: #fcfdfd;
}
.candidate-preview > header {
  display: grid;
  grid-template-columns: 48px 1fr auto;
  align-items: center;
  gap: 12px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--border);
}
.preview-avatar {
  width: 48px;
  height: 48px;
  font-size: 17px;
}
.candidate-preview h3 {
  margin: 0;
  font-size: 17px;
}
.candidate-preview header p {
  margin: 4px 0 0;
  color: var(--text-secondary);
  font-size: 12px;
}
.candidate-preview > section {
  padding: 20px 0 12px;
  border-bottom: 1px solid var(--border);
}
.candidate-preview > section .workspace-label {
  margin-left: 0;
}
.candidate-preview dl {
  display: grid;
  gap: 12px;
  margin: 0;
}
.candidate-preview dl div {
  display: grid;
  grid-template-columns: 74px 1fr;
  gap: 10px;
}
.candidate-preview dt {
  color: var(--text-secondary);
  font-size: 12px;
}
.candidate-preview dd {
  margin: 0;
  font-size: 12px;
  font-weight: 650;
}
.decision-summary p {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 10px 0;
}
.decision-summary p > span {
  color: var(--text-secondary);
  font-size: 12px;
}
.decision-summary p > strong {
  font-size: 12px;
}
.candidate-preview footer {
  display: grid;
  gap: 10px;
  padding-top: 20px;
  text-align: center;
}
.candidate-preview footer small {
  color: var(--text-secondary);
  font-size: 11px;
}
.candidates-table .el-tag + .el-tag {
  margin-left: 6px;
}
.candidate-cards {
  display: none;
}
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 18px;
}
.form-grid .el-select,
.form-grid .el-input-number {
  width: 100%;
}
.profile-card {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 10px;
}
.profile-card strong,
.profile-card span {
  display: block;
  margin-top: 8px;
}
.profile-card span {
  color: var(--text-secondary);
  font-size: 12px;
}
.profile-actions {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.decision-actions {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}
.timeline-list,
.message-list {
  display: grid;
  gap: 12px;
}
.timeline-list article,
.message-list article {
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
}
.timeline-list header,
.timeline-list footer,
.message-list header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.timeline-list p,
.message-list p {
  line-height: 1.65;
}
.timeline-list footer,
.message-list footer {
  color: var(--text-secondary);
  font-size: 12px;
}
.message-list article.outbound {
  margin-left: 32px;
  background: var(--brand-50);
}
.message-list article.inbound {
  margin-right: 32px;
}
.message-list footer span {
  float: right;
}
@media (max-width: 1250px) {
  .candidates-title {
    display: grid;
  }
  .filters {
    width: 100%;
    grid-template-columns: 2fr 1fr 1fr 1fr auto;
  }
  .candidate-workspace {
    grid-template-columns: 160px minmax(320px, 1fr) 280px;
  }
}
@media (max-width: 900px) {
  .candidate-workspace {
    display: none;
  }
}
@media (max-width: 720px) {
  .candidate-metrics {
    grid-template-columns: repeat(2, 1fr);
  }
  .candidate-metrics div:nth-child(2) {
    border-right: 0;
  }
  .candidate-metrics div:nth-child(-n + 2) {
    border-bottom: 1px solid var(--border);
  }
  .filters {
    grid-template-columns: 1fr;
  }
  .candidates-table {
    display: none;
  }
  .candidate-cards {
    display: grid;
    gap: 12px;
    padding: 14px;
  }
  .candidate-cards article {
    padding: 16px;
    border: 1px solid var(--border);
    border-radius: 10px;
  }
  .candidate-cards header {
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }
  .candidate-cards header span {
    display: block;
    margin-top: 5px;
    color: var(--text-secondary);
    font-size: 12px;
  }
  .candidate-cards dl {
    display: grid;
    gap: 10px;
    margin: 16px 0;
  }
  .candidate-cards dl div {
    display: grid;
    grid-template-columns: 72px 1fr;
  }
  .candidate-cards dt {
    color: var(--text-secondary);
  }
  .candidate-cards dd {
    margin: 0;
  }
  .candidate-cards .el-button {
    width: 100%;
    min-height: 42px;
  }
  .form-grid {
    grid-template-columns: 1fr;
  }
  .profile-card {
    display: grid;
  }
  .profile-actions,
  .decision-actions {
    display: grid;
    grid-template-columns: 1fr;
  }
  .profile-actions .el-button,
  .decision-actions .el-button {
    margin: 0;
  }
  .message-list article.outbound,
  .message-list article.inbound {
    margin: 0;
  }
}
</style>
