<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import type { FormInstance, FormRules } from "element-plus";
import { ElMessage, ElMessageBox } from "element-plus";
import { Briefcase, Refresh, Search } from "@element-plus/icons-vue";
import { api, apiErrorMessage, ensureCsrf } from "../services/api";
import { authStore } from "../stores/auth";
import type {
  BossAccount,
  Company,
  JobPosition,
  JobPositionStatus,
} from "../types";

interface JobReviewFormValue {
  location: string;
  salaryMinK: number;
  salaryMaxK: number;
  salaryMonths: number;
  experienceRequirement: string;
  educationRequirement: string;
  description: string;
  screeningRequirements: string;
  recruitmentType: string;
  jobCategory: string;
  overseasRequirement: string;
  jobKeywords: string;
  workAddress: string;
  replySummary: string;
  salaryDisplay: string;
  captureConfirmed: boolean;
  knowledgeApproved: boolean;
  activateConfirmed: boolean;
}

const loading = ref(true);
const router = useRouter();
const loadError = ref("");
const jobs = ref<JobPosition[]>([]);
const companies = ref<Company[]>([]);
const bossAccounts = ref<BossAccount[]>([]);
const keyword = ref("");
const companyFilter = ref("");
const statusFilter = ref<JobPositionStatus | "">("");
const changingStatusId = ref("");
const reviewDialogOpen = ref(false);
const reviewJob = ref<JobPosition | null>(null);
const reviewSaving = ref(false);
const reviewFormRef = ref<FormInstance>();
const reviewForm = reactive<JobReviewFormValue>({
  location: "",
  salaryMinK: 1,
  salaryMaxK: 1,
  salaryMonths: 12,
  experienceRequirement: "",
  educationRequirement: "",
  recruitmentType: "",
  jobCategory: "",
  overseasRequirement: "",
  jobKeywords: "",
  workAddress: "",
  description: "",
  screeningRequirements: "",
  replySummary: "",
  salaryDisplay: "",
  captureConfirmed: false,
  knowledgeApproved: false,
  activateConfirmed: false,
});

const canManage = computed(() =>
  ["SYSTEM_ADMIN", "RECRUITMENT_ADMIN"].includes(
    authStore.state.user?.role ?? "",
  ),
);
const stats = computed(() => ({
  total: jobs.value.length,
  active: jobs.value.filter((job) => job.status === "ACTIVE").length,
  draft: jobs.value.filter((job) => job.status === "DRAFT").length,
  safeReady: jobs.value.filter(
    (job) => job.status === "ACTIVE" && job.safeReplyReady,
  ).length,
  pageCaptured: jobs.value.filter((job) => job.captureSource === "VISIBLE_PAGE")
    .length,
}));
const latestPageCapture = computed(
  () =>
    jobs.value
      .filter((job) => job.captureSource === "VISIBLE_PAGE" && job.capturedAt)
      .map((job) => job.capturedAt as string)
      .sort()
      .at(-1) ?? "",
);
const reviewQueue = computed(() =>
  jobs.value
    .filter((job) => job.reviewReadiness?.importedDraft)
    .sort((a, b) => b.observationCount - a.observationCount),
);
const statusLabels: Record<JobPositionStatus, string> = {
  DRAFT: "草稿",
  ACTIVE: "已启用",
  CLOSED: "已关闭",
};
const reviewRules: FormRules<JobReviewFormValue> = {
  location: [{ required: true, message: "请输入工作地址", trigger: "blur" }],
  experienceRequirement: [
    { required: true, message: "请输入经验", trigger: "blur" },
  ],
  educationRequirement: [
    { required: true, message: "请输入学历", trigger: "blur" },
  ],
  description: [
    { required: true, message: "请输入真实职位描述", trigger: "blur" },
  ],
};

function statusTagType(status: JobPositionStatus) {
  return ({ DRAFT: "warning", ACTIVE: "success", CLOSED: "info" } as const)[
    status
  ];
}

async function loadData() {
  loading.value = true;
  loadError.value = "";
  try {
    const [jobResponse, companyResponse, accountResponse] = await Promise.all([
      api.get<JobPosition[]>("/job-positions", {
        params: {
          keyword: keyword.value.trim() || undefined,
          companyId: companyFilter.value || undefined,
          status: statusFilter.value || undefined,
        },
      }),
      api.get<Company[]>("/organization/companies"),
      api.get<BossAccount[]>("/boss-accounts"),
    ]);
    jobs.value = jobResponse.data;
    companies.value = companyResponse.data;
    bossAccounts.value = accountResponse.data;
  } catch (error) {
    loadError.value = apiErrorMessage(error, "职位资料加载失败，请重试");
  } finally {
    loading.value = false;
  }
}

async function changeStatus(job: JobPosition, status: JobPositionStatus) {
  if (status === "CLOSED") {
    try {
      await ElMessageBox.confirm(
        `关闭后，“${job.title}”不能再编辑或重新启用，历史数据会保留。`,
        "确认关闭职位",
        {
          type: "warning",
          confirmButtonText: "确认关闭",
          cancelButtonText: "取消",
        },
      );
    } catch {
      return;
    }
  }
  changingStatusId.value = job.id;
  try {
    await ensureCsrf();
    await api.patch(`/job-positions/${job.id}/status`, { status });
    ElMessage.success(status === "ACTIVE" ? "职位已启用" : "职位已关闭");
    await loadData();
  } catch (error) {
    ElMessage.error(apiErrorMessage(error, "职位状态变更失败"));
  } finally {
    changingStatusId.value = "";
  }
}

function salaryLabel(job: JobPosition) {
  return job.captureSource === "UNREAD_OBSERVATION"
    ? "详细待遇待补全"
    : `${job.salaryMinK}-${job.salaryMaxK}K·${job.salaryMonths}薪`;
}
function captureLabel(job: JobPosition) {
  if (job.captureSource === "UNREAD_OBSERVATION")
    return `未读观察导入 · ${job.observationCount} 次 · ${job.captureVerified ? "已核对" : "待补全"}`;
  return job.captureSource === "VISIBLE_PAGE"
    ? `页面采集${job.captureCompleteness ? ` · ${job.captureCompleteness} 个公开字段` : ""} · ${job.captureVerified ? "已核对" : "待核对"}`
    : "手工录入";
}

function realValue(value?: string) {
  if (!value) return "";
  if (
    value.includes("待从 BOSS 岗位页补全") ||
    value.includes("由真实 BOSS 职位管理页只读采集")
  )
    return "";
  return value;
}
function suggestedReplySummary(job: JobPosition) {
  const salary =
    job.salaryDisplay ||
    `${job.salaryMinK}-${job.salaryMaxK}K${job.salaryMonths > 12 ? `·${job.salaryMonths}薪` : ""}`;
  return `${job.title}，工作地址${job.workAddress || job.location}，薪资详情${salary}，经验${job.experienceRequirement}，学历${job.educationRequirement}。具体工作内容和安排以招聘同事后续沟通为准。`;
}
function reviewEvidenceLabel(job: JobPosition) {
  if (job.captureSource === "VISIBLE_PAGE")
    return `BOSS 职位页已同步 · ${job.captureCompleteness ?? 0} 个公开字段`;
  return `在未读列表出现 ${job.observationCount} 次`;
}
function openImportedReview(job: JobPosition) {
  reviewJob.value = job;
  Object.assign(reviewForm, {
    location: realValue(job.location),
    salaryMinK: job.salaryMinK,
    salaryMaxK: job.salaryMaxK,
    salaryMonths: job.salaryMonths,
    experienceRequirement: realValue(job.experienceRequirement),
    educationRequirement: realValue(job.educationRequirement),
    recruitmentType: realValue(job.recruitmentType),
    jobCategory: realValue(job.jobCategory),
    overseasRequirement: realValue(job.overseasRequirement),
    jobKeywords: realValue(job.jobKeywords),
    workAddress: realValue(job.workAddress),
    description: realValue(job.description),
    screeningRequirements: realValue(job.screeningRequirements),
    replySummary: job.replySummary || suggestedReplySummary(job),
    salaryDisplay: job.salaryDisplay ?? "",
    captureConfirmed: false,
    knowledgeApproved: false,
    activateConfirmed: false,
  });
  reviewDialogOpen.value = true;
}
function goToCompanyKnowledge() {
  router.push("/organization");
}
async function completeImportedReview() {
  if (reviewJob.value) {
    reviewForm.location = reviewForm.workAddress || reviewForm.location;
    reviewForm.replySummary = `${reviewJob.value.title}，工作地址${reviewForm.workAddress || reviewForm.location}，薪资详情${reviewForm.salaryDisplay || `${reviewForm.salaryMinK}-${reviewForm.salaryMaxK}K`}，经验${reviewForm.experienceRequirement}，学历${reviewForm.educationRequirement}。具体信息以招聘同事后续沟通为准。`;
    reviewForm.screeningRequirements = "";
  }
  if (
    !reviewJob.value ||
    !(await reviewFormRef.value?.validate().catch(() => false))
  )
    return;
  if (reviewForm.salaryMaxK < reviewForm.salaryMinK) {
    ElMessage.error("薪资详情中的上限不能低于下限");
    return;
  }
  if (
    !reviewForm.captureConfirmed ||
    !reviewForm.knowledgeApproved ||
    !reviewForm.activateConfirmed
  ) {
    ElMessage.warning("请完成三项人工确认后再启用岗位");
    return;
  }
  reviewSaving.value = true;
  try {
    await ensureCsrf();
    await api.post(
      `/job-positions/${reviewJob.value.id}/review-and-activate`,
      reviewForm,
    );
    let recalculated = true;
    try {
      await api.post("/local-connector/observations/recalculate-drafts");
    } catch {
      recalculated = false;
    }
    ElMessage.success(
      recalculated
        ? "岗位已审核启用，现有未读草稿已重新评估"
        : "岗位已审核启用；草稿将在下次观测时重新评估",
    );
    reviewDialogOpen.value = false;
    await loadData();
  } catch (error) {
    ElMessage.error(apiErrorMessage(error, "岗位审核启用失败"));
  } finally {
    reviewSaving.value = false;
  }
}

onMounted(loadData);
</script>

<template>
  <div class="page-shell">
    <header class="page-heading">
      <div>
        <h1>职位管理</h1>
        <p>同步并核对 BOSS 职位管理页中的真实职位信息。</p>
      </div>
    </header>
    <el-alert
      title="职位只能绑定同企业、已启用且通过能力检查的 BOSS 账号；关闭后保留历史且不可重新启用。"
      type="info"
      :closable="false"
      show-icon
      class="scope-alert"
    />
    <div v-if="loading" class="surface-panel skeleton-stack">
      <el-skeleton :rows="7" animated />
    </div>
    <div v-else-if="loadError" class="surface-panel error-state" role="alert">
      <span class="error-state__icon"
        ><el-icon><Refresh /></el-icon></span
      ><strong>职位暂时无法加载</strong><span>{{ loadError }}</span
      ><el-button :icon="Refresh" @click="loadData">重新加载</el-button>
    </div>
    <template v-else>
      <div class="metrics-strip">
        <div>
          <span>职位总数</span><strong>{{ stats.total }}</strong>
        </div>
        <div>
          <span>页面同步</span><strong>{{ stats.pageCaptured }}</strong>
        </div>
        <div>
          <span>安全草稿就绪</span><strong>{{ stats.safeReady }}</strong>
        </div>
        <div>
          <span>待完善草稿</span><strong>{{ stats.draft }}</strong>
        </div>
      </div>
      <section class="surface-panel browser-import-guide">
        <div>
          <strong>BOSS 职位管理页同步</strong>
          <p>
            在已配对的 Chrome Profile
            中手动打开“职位管理”，点击扩展里的“同步当前职位页”。系统按招聘账号和岗位标题去重，只创建待审核草稿。
          </p>
          <small v-if="latestPageCapture"
            >最近入库：{{
              new Date(latestPageCapture).toLocaleString("zh-CN")
            }}</small
          ><small v-else>尚无职位管理页采集记录</small>
        </div>
        <el-button :icon="Refresh" @click="loadData">刷新同步结果</el-button>
      </section>
      <section v-if="reviewQueue.length" class="surface-panel review-queue">
        <div class="section-title-row">
          <div>
            <h2>真实岗位待办</h2>
            <p>
              优先处理已有真实页面或未读证据的岗位。每个岗位必须单独补全、核对和批准，不提供批量自动审核。
            </p>
          </div>
          <el-tag type="warning">{{ reviewQueue.length }} 个待处理</el-tag>
        </div>
        <div class="review-cards">
          <article v-for="job in reviewQueue" :key="job.id">
            <header>
              <div class="job-identity">
                <strong>{{ job.title }}</strong
                ><span
                  >{{ job.bossAccount.displayName }} ·
                  {{ reviewEvidenceLabel(job) }}</span
                >
              </div>
              <el-tag type="warning">待审核</el-tag>
            </header>
            <div class="review-steps">
              <span :class="{ done: job.reviewReadiness.profileComplete }"
                >1 岗位资料</span
              ><span :class="{ done: job.reviewReadiness.captureReady }"
                >2 页面核对</span
              ><span
                :class="{ done: job.reviewReadiness.companyKnowledgeReady }"
                >3 企业知识</span
              ><span :class="{ done: job.reviewReadiness.jobKnowledgeReady }"
                >4 岗位知识</span
              ><span :class="{ done: job.status === 'ACTIVE' }">5 启用</span>
            </div>
            <p>
              {{
                job.reviewReadiness.blockers.join("、") ||
                "资料已具备，可完成最终审核"
              }}
            </p>
            <footer>
              <el-button
                v-if="!job.reviewReadiness.companyKnowledgeReady"
                text
                type="warning"
                @click="goToCompanyKnowledge"
                >先审核企业资料</el-button
              ><el-button
                type="primary"
                :disabled="!job.reviewReadiness.companyKnowledgeReady"
                @click="openImportedReview(job)"
                >补全、审核并启用</el-button
              >
            </footer>
          </article>
        </div>
      </section>
      <section class="surface-panel jobs-panel">
        <div class="section-title-row jobs-title">
          <div>
            <h2>职位列表</h2>
            <p>草稿完善后才可启用，启用时会再次校验 BOSS Capability</p>
          </div>
          <div class="filters">
            <el-input
              v-model="keyword"
              clearable
              placeholder="搜索职位、地点或 BOSS 账号"
              :prefix-icon="Search"
              @keyup.enter="loadData"
            /><el-select
              v-model="companyFilter"
              clearable
              placeholder="全部企业"
              @change="loadData"
              ><el-option
                v-for="company in companies"
                :key="company.id"
                :label="company.name"
                :value="company.id" /></el-select
            ><el-select
              v-model="statusFilter"
              placeholder="全部状态"
              @change="loadData"
              ><el-option label="全部状态" value="" /><el-option
                label="草稿"
                value="DRAFT" /><el-option
                label="已启用"
                value="ACTIVE" /><el-option
                label="已关闭"
                value="CLOSED" /></el-select
            ><el-button @click="loadData">查询</el-button>
          </div>
        </div>
        <div v-if="jobs.length === 0" class="empty-state">
          <span class="empty-state__icon"
            ><el-icon><Briefcase /></el-icon></span
          ><strong>还没有符合条件的职位</strong
          ><span>请在 BOSS 职位管理页使用只读桥接同步真实职位。</span>
        </div>
        <template v-else>
          <el-table :data="jobs" class="jobs-table"
            ><el-table-column type="expand"
              ><template #default="{ row }"
                ><div class="captured-job-detail">
                  <h3>职位基本信息与要求</h3>
                  <dl>
                    <div>
                      <dt>公司</dt>
                      <dd>{{ row.company.name }}</dd>
                    </div>
                    <div>
                      <dt>招聘类型</dt>
                      <dd>{{ row.recruitmentType || "待详情页同步" }}</dd>
                    </div>
                    <div>
                      <dt>职位名称</dt>
                      <dd>{{ row.title }}</dd>
                    </div>
                    <div class="job-description-field">
                      <dt>职位描述</dt>
                      <dd>{{ row.description }}</dd>
                    </div>
                    <div>
                      <dt>职位类型</dt>
                      <dd>{{ row.jobCategory || "待详情页同步" }}</dd>
                    </div>
                    <div>
                      <dt>是否驻外</dt>
                      <dd>{{ row.overseasRequirement || "待详情页同步" }}</dd>
                    </div>
                    <div>
                      <dt>经验</dt>
                      <dd>{{ row.experienceRequirement }}</dd>
                    </div>
                    <div>
                      <dt>学历</dt>
                      <dd>{{ row.educationRequirement }}</dd>
                    </div>
                    <div>
                      <dt>薪资详情</dt>
                      <dd>
                        {{
                          row.salaryDisplay || salaryLabel(row as JobPosition)
                        }}
                      </dd>
                    </div>
                    <div>
                      <dt>职位关键词</dt>
                      <dd>{{ row.jobKeywords || "未设置" }}</dd>
                    </div>
                    <div>
                      <dt>工作地址</dt>
                      <dd>{{ row.workAddress || row.location }}</dd>
                    </div>
                  </dl>
                </div></template
              ></el-table-column
            ><el-table-column label="职位名称" min-width="210"
              ><template #default="{ row }"
                ><div class="job-identity">
                  <strong>{{ row.title }}</strong
                  ><span
                    >{{ row.location }} ·
                    {{ salaryLabel(row as JobPosition) }}</span
                  >
                </div></template
              ></el-table-column
            ><el-table-column label="公司" min-width="165"
              ><template #default="{ row }"
                ><strong>{{ row.company.name }}</strong>
                <div class="muted">{{ row.company.code }}</div></template
              ></el-table-column
            ><el-table-column label="BOSS 账号" min-width="175"
              ><template #default="{ row }"
                ><strong>{{ row.bossAccount.displayName }}</strong>
                <div class="muted">
                  {{ row.bossAccount.externalIdentifier }}
                </div></template
              ></el-table-column
            ><el-table-column label="资料来源" min-width="155"
              ><template #default="{ row }"
                ><el-tag
                  :type="
                    row.captureSource === 'VISIBLE_PAGE'
                      ? row.captureVerified
                        ? 'success'
                        : 'warning'
                      : row.captureSource === 'UNREAD_OBSERVATION'
                        ? row.captureVerified
                          ? 'success'
                          : 'warning'
                        : 'info'
                  "
                  >{{ captureLabel(row as JobPosition) }}</el-tag
                >
                <div v-if="row.captureSource === 'VISIBLE_PAGE'" class="muted">
                  {{
                    row.captureVerified ? "已人工核对" : "需对照 BOSS 页面核对"
                  }}
                </div>
                <div
                  v-else-if="row.captureSource === 'UNREAD_OBSERVATION'"
                  class="muted"
                >
                  {{
                    row.captureVerified
                      ? "已补全并人工核对"
                      : "仅标题可信，编辑补全后再启用"
                  }}
                </div></template
              ></el-table-column
            ><el-table-column label="安全草稿" min-width="160"
              ><template #default="{ row }"
                ><el-tag :type="row.safeReplyReady ? 'success' : 'warning'">{{
                  row.safeReplyReady
                    ? `已就绪 v${row.knowledgeVersion}`
                    : "资料待完善"
                }}</el-tag>
                <div v-if="!row.safeReplyReady" class="readiness-issues">
                  {{ row.safeReplyIssues.join("、") }}
                </div></template
              ></el-table-column
            ><el-table-column label="状态" width="100"
              ><template #default="{ row }"
                ><el-tag :type="statusTagType(row.status)">{{
                  statusLabels[row.status as JobPositionStatus]
                }}</el-tag></template
              ></el-table-column
            ><el-table-column
              v-if="canManage"
              label="操作"
              width="310"
              fixed="right"
              ><template #default="{ row }"
                ><el-button
                  v-if="row.reviewReadiness?.importedDraft"
                  link
                  type="warning"
                  @click="openImportedReview(row as JobPosition)"
                  >完整审核</el-button
                ><el-button
                  v-if="
                    row.status === 'DRAFT' && row.captureSource === 'MANUAL'
                  "
                  link
                  type="success"
                  :loading="changingStatusId === row.id"
                  @click="changeStatus(row as JobPosition, 'ACTIVE')"
                  >启用</el-button
                ><el-button
                  v-if="row.status !== 'CLOSED'"
                  link
                  type="danger"
                  :loading="changingStatusId === row.id"
                  @click="changeStatus(row as JobPosition, 'CLOSED')"
                  >关闭</el-button
                ></template
              ></el-table-column
            ></el-table
          >
          <div class="job-cards">
            <article v-for="job in jobs" :key="job.id">
              <header>
                <div class="job-identity">
                  <strong>{{ job.title }}</strong
                  ><span>{{ job.location }} · {{ salaryLabel(job) }}</span>
                </div>
                <el-tag :type="statusTagType(job.status)" size="small">{{
                  statusLabels[job.status]
                }}</el-tag>
              </header>
              <dl>
                <div>
                  <dt>公司</dt>
                  <dd>{{ job.company.name }}</dd>
                </div>
                <div>
                  <dt>BOSS 账号</dt>
                  <dd>{{ job.bossAccount.displayName }}</dd>
                </div>
                <div>
                  <dt>资料来源</dt>
                  <dd>{{ captureLabel(job) }}</dd>
                </div>
                <div>
                  <dt>经验 / 学历</dt>
                  <dd>
                    {{ job.experienceRequirement }} ·
                    {{ job.educationRequirement }}
                  </dd>
                </div>
              </dl>
              <p class="job-description">{{ job.description }}</p>
              <footer v-if="canManage && job.status !== 'CLOSED'">
                <el-button
                  v-if="job.reviewReadiness?.importedDraft"
                  type="warning"
                  plain
                  @click="openImportedReview(job)"
                  >完整审核</el-button
                ><el-button
                  v-if="
                    job.status === 'DRAFT' && job.captureSource === 'MANUAL'
                  "
                  type="success"
                  plain
                  :loading="changingStatusId === job.id"
                  @click="changeStatus(job, 'ACTIVE')"
                  >启用</el-button
                ><el-button
                  type="danger"
                  plain
                  :loading="changingStatusId === job.id"
                  @click="changeStatus(job, 'CLOSED')"
                  >关闭</el-button
                >
              </footer>
            </article>
          </div>
        </template>
      </section>
    </template>

    <el-dialog
      v-model="reviewDialogOpen"
      :title="`${reviewJob?.title ?? ''} · 完成真实岗位审核`"
      width="820px"
      destroy-on-close
      ><el-alert
        title="以下字段名称和顺序与 BOSS 职位详情页保持一致；请只核对真实页面信息。"
        type="warning"
        :closable="false"
        show-icon
        class="dialog-alert"
      /><el-form
        ref="reviewFormRef"
        :model="reviewForm"
        :rules="reviewRules"
        label-position="top"
        ><h3 class="boss-section-title">职位基本信息</h3>
        <div class="form-grid boss-field-grid">
          <el-form-item label="公司">
            <el-input :model-value="reviewJob?.company.name" disabled />
          </el-form-item>
          <el-form-item label="招聘类型">
            <el-input v-model="reviewForm.recruitmentType" maxlength="40" />
          </el-form-item>
          <el-form-item label="职位名称">
            <el-input :model-value="reviewJob?.title" disabled />
          </el-form-item>
          <el-form-item label="职位类型">
            <el-input v-model="reviewForm.jobCategory" maxlength="120" />
          </el-form-item>
          <el-form-item label="是否驻外">
            <el-input v-model="reviewForm.overseasRequirement" maxlength="40" />
          </el-form-item>
        </div>
        <el-form-item label="职位描述" prop="description"
          ><el-input
            v-model="reviewForm.description"
            type="textarea"
            :rows="5"
            maxlength="10000"
            show-word-limit
            placeholder="与 BOSS 职位描述保持一致"
        /></el-form-item>
        <h3 class="boss-section-title">职位要求</h3>
        <div class="form-grid boss-field-grid">
          <el-form-item label="经验" prop="experienceRequirement">
            <el-input
              v-model="reviewForm.experienceRequirement"
              maxlength="80"
            />
          </el-form-item>
          <el-form-item label="学历" prop="educationRequirement">
            <el-input
              v-model="reviewForm.educationRequirement"
              maxlength="80"
            />
          </el-form-item>
          <el-form-item label="薪资详情">
            <el-input v-model="reviewForm.salaryDisplay" maxlength="120" />
          </el-form-item>
          <el-form-item label="职位关键词">
            <el-input v-model="reviewForm.jobKeywords" maxlength="500" />
          </el-form-item>
          <el-form-item label="工作地址" prop="location">
            <el-input v-model="reviewForm.workAddress" maxlength="240" />
          </el-form-item>
        </div>
        <div class="review-confirmations">
          <el-checkbox v-model="reviewForm.captureConfirmed"
            >我已对照真实 BOSS 岗位页核对上述资料</el-checkbox
          ><el-checkbox v-model="reviewForm.knowledgeApproved"
            >我确认系统仅使用上述真实字段生成安全草稿</el-checkbox
          ><el-checkbox v-model="reviewForm.activateConfirmed"
            >我确认现在启用此岗位，并参与严格标题匹配</el-checkbox
          >
        </div></el-form
      ><template #footer
        ><el-button @click="reviewDialogOpen = false">取消</el-button
        ><el-button
          type="primary"
          :loading="reviewSaving"
          @click="completeImportedReview"
          >确认审核并启用</el-button
        ></template
      ></el-dialog
    >
  </div>
</template>

<style scoped>
.browser-import-guide {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 20px;
  padding: 18px 20px;
  border-left: 4px solid var(--primary);
}
.browser-import-guide p {
  margin: 5px 0;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.6;
}
.browser-import-guide small {
  color: var(--text-secondary);
}
.scope-alert {
  margin-bottom: 20px;
}
.metrics-strip {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  margin-bottom: 20px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  overflow: hidden;
}
.metrics-strip div {
  padding: 18px 24px;
  border-right: 1px solid var(--border);
}
.metrics-strip div:last-child {
  border: 0;
}
.metrics-strip span,
.metrics-strip strong {
  display: block;
}
.metrics-strip span {
  color: var(--text-secondary);
  font-size: 12px;
}
.metrics-strip strong {
  margin-top: 5px;
  font-size: 24px;
}
.jobs-panel {
  overflow: hidden;
}
.jobs-title {
  align-items: flex-end;
}
.filters {
  display: grid;
  grid-template-columns: minmax(220px, 280px) 155px 125px auto;
  gap: 8px;
}
.jobs-table {
  width: 100%;
}
.job-identity strong,
.job-identity span {
  display: block;
}
.job-identity span,
.muted {
  margin-top: 4px;
  color: var(--text-secondary);
  font-size: 12px;
}
.readiness-issues {
  margin-top: 5px;
  color: var(--warning);
  font-size: 11px;
  line-height: 1.35;
}
.job-cards {
  display: none;
}
.dialog-alert {
  margin-bottom: 18px;
}
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 0 18px;
}
.form-grid .el-select,
.form-grid .el-input-number {
  width: 100%;
}
.form-tip {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.45;
}
.form-tip.warning {
  color: var(--warning);
}
.reply-preview {
  margin-top: 18px;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-muted);
}
.reply-preview p {
  line-height: 1.7;
}
.reply-preview small {
  color: var(--warning);
}
.review-queue {
  margin-bottom: 20px;
}
.review-cards {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  padding: 0 20px 20px;
}
.review-cards article {
  padding: 16px;
  border: 1px solid #f0d49b;
  border-radius: 12px;
  background: #fffaf3;
}
.review-cards header,
.review-cards footer {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.review-steps {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 5px;
  margin: 14px 0;
}
.review-steps span {
  padding: 7px 5px;
  border-radius: 7px;
  background: #f2f4f7;
  color: var(--text-secondary);
  font-size: 10px;
  text-align: center;
}
.review-steps span.done {
  background: #dcfae6;
  color: #067647;
}
.review-cards article > p {
  margin: 0 0 13px;
  color: #b54708;
  font-size: 12px;
}
.review-confirmations {
  display: grid;
  gap: 10px;
  padding: 14px;
  border: 1px solid #f0d49b;
  border-radius: 10px;
  background: #fffaf3;
}
.review-confirmations .el-checkbox {
  height: auto;
  white-space: normal;
}
.review-confirmations .el-checkbox + .el-checkbox {
  margin-left: 0;
}
.boss-section-title {
  margin: 4px 0 16px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border);
  font-size: 16px;
}
.boss-field-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.captured-job-detail {
  padding: 8px 36px 22px;
}
.captured-job-detail h3 {
  margin: 0 0 14px;
}
.captured-job-detail dl {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin: 0;
}
.captured-job-detail dl div {
  padding: 11px;
  border-radius: 8px;
  background: var(--surface-muted);
}
.captured-job-detail .job-description-field {
  grid-column: 1 / -1;
}
.captured-job-detail .job-description-field dd {
  white-space: pre-wrap;
}
.captured-job-detail dt {
  color: var(--text-secondary);
  font-size: 12px;
}
.captured-job-detail dd {
  margin: 5px 0 0;
  line-height: 1.5;
}
.captured-job-detail section {
  margin-top: 14px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 9px;
}
.captured-job-detail section p {
  margin: 8px 0 0;
  white-space: pre-wrap;
  line-height: 1.7;
}
@media (max-width: 1250px) {
  .jobs-title {
    display: grid;
  }
  .filters {
    width: 100%;
    grid-template-columns: minmax(200px, 1fr) 150px 120px auto;
  }
}
@media (max-width: 720px) {
  .metrics-strip div {
    padding: 14px 12px;
  }
  .metrics-strip strong {
    font-size: 21px;
  }
  .filters,
  .review-cards {
    grid-template-columns: 1fr;
  }
  .jobs-table {
    display: none;
  }
  .job-cards {
    display: grid;
    gap: 12px;
    padding: 14px;
  }
  .job-cards article {
    padding: 16px;
    border: 1px solid var(--border);
    border-radius: 10px;
  }
  .job-cards header {
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }
  .job-cards dl {
    display: grid;
    gap: 11px;
    margin: 17px 0;
  }
  .job-cards dl div {
    display: grid;
    grid-template-columns: 90px 1fr;
    gap: 10px;
  }
  .job-cards dt {
    color: var(--text-secondary);
    font-size: 13px;
  }
  .job-cards dd {
    margin: 0;
    font-size: 13px;
  }
  .job-description {
    display: -webkit-box;
    margin: 0;
    color: var(--text-secondary);
    font-size: 13px;
    line-height: 1.6;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
  }
  .job-cards footer {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
    margin-top: 18px;
  }
  .job-cards footer .el-button {
    min-height: 42px;
    margin: 0;
  }
  .job-cards footer .el-button:last-child:nth-child(3) {
    grid-column: 1/-1;
  }
  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
