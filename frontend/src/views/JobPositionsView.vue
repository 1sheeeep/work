<script setup lang="ts">
import PageHeader from '../components/PageHeader.vue'
import AsyncState from '../components/AsyncState.vue'
import MetricCard from '../components/MetricCard.vue'
import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import type { FormInstance, FormRules } from "element-plus";
import { ElMessage, ElMessageBox, ElNotification } from "element-plus";
import { Briefcase, Connection, DocumentChecked, InfoFilled, Refresh, Search, Warning } from "@element-plus/icons-vue";
import { api, apiErrorMessage, ensureCsrf } from "../services/api";
import { authStore } from "../stores/auth";
import type { Company, JobPosition, JobPositionStatus } from "../types";

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
const loadError = ref("");
const jobs = ref<JobPosition[]>([]);
const companies = ref<Company[]>([]);
const keyword = ref("");
const statusFilter = ref<JobPositionStatus | "">("");
const changingStatusId = ref("");
const reviewDialogOpen = ref(false);
const reviewJob = ref<JobPosition | null>(null);
const reviewSaving = ref(false);
const reviewFormRef = ref<FormInstance>();
const companyDialogOpen = ref(false);
const companySaving = ref(false);
const selectedCompany = ref<Company | null>(null);
const companyForm = reactive({ industry: "", scale: "", summary: "", approved: false });
let refreshTimer: ReturnType<typeof setInterval> | null = null;
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
const canApproveCompanyKnowledge = computed(() => authStore.state.user?.role === "SYSTEM_ADMIN");
const visibleCompanies = computed(() => {
  const ids = new Set(jobs.value.map((job) => job.company.id));
  return companies.value.filter((company) => ids.has(company.id));
});
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
  replySummary: [
    { required: true, message: "请填写挂机回复中的岗位介绍", trigger: "blur" },
  ],
};

function statusTagType(status: JobPositionStatus) {
  return ({ DRAFT: "warning", ACTIVE: "success", CLOSED: "info" } as const)[
    status
  ];
}

async function loadData(silent = false) {
  if (!silent) {
    loading.value = true;
    loadError.value = "";
  }
  try {
    const [jobResponse, companyResponse] = await Promise.all([
      api.get<JobPosition[]>("/job-positions", {
        params: {
          keyword: keyword.value.trim() || undefined,
          status: statusFilter.value || undefined,
        },
      }),
      api.get<Company[]>("/organization/companies"),
    ]);
    jobs.value = jobResponse.data.filter(
      (job) => job.captureSource === "VISIBLE_PAGE",
    );
    companies.value = companyResponse.data;
  } catch (error) {
    if (!silent) loadError.value = apiErrorMessage(error, "职位资料加载失败，请重试");
  } finally {
    if (!silent) loading.value = false;
  }
}

function refreshVisibleJobs() {
  if (document.visibilityState === "visible" && !loading.value && !reviewDialogOpen.value && !companyDialogOpen.value) {
    void loadData(true);
  }
}

function openCompanyKnowledge(company: Company) {
  selectedCompany.value = company;
  Object.assign(companyForm, {
    industry: company.knowledgeIndustry ?? "",
    scale: company.knowledgeScale ?? "",
    summary: company.knowledgeSummary ?? "",
    approved: company.knowledgeApproved,
  });
  companyDialogOpen.value = true;
}

function openJobCompanyKnowledge(job: JobPosition) {
  const company = companies.value.find((item) => item.id === job.company.id);
  if (company) openCompanyKnowledge(company);
}

async function recalculateDrafts() {
  try {
    await api.post("/local-connector/observations/recalculate-drafts");
    return true;
  } catch {
    return false;
  }
}

async function saveCompanyKnowledge() {
  if (!selectedCompany.value) return;
  if (!companyForm.industry.trim() || !companyForm.summary.trim()) {
    ElMessage.warning("请填写行业和公司介绍");
    return;
  }
  if (!companyForm.approved) {
    ElMessage.warning("请确认审核后再保存");
    return;
  }
  companySaving.value = true;
  try {
    await ensureCsrf();
    await api.put(`/organization/companies/${selectedCompany.value.id}/knowledge`, {
      industry: companyForm.industry.trim(),
      scale: companyForm.scale.trim() || null,
      summary: companyForm.summary.trim(),
      approved: true,
    });
    const recalculated = await recalculateDrafts();
    companyDialogOpen.value = false;
    ElMessage.success(recalculated ? "公司回复资料已生效，未读草稿已重新评估" : "公司回复资料已生效");
    await loadData();
  } catch (error) {
    ElMessage.error(apiErrorMessage(error, "公司回复资料保存失败"));
  } finally {
    companySaving.value = false;
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
  const description = realValue(job.description).replace(/\s+/g, " ").trim();
  return description
    ? description.slice(0, 1000)
    : `负责${job.title}相关工作，具体职责以招聘同事后续沟通为准`;
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
async function completeImportedReview() {
  if (reviewJob.value) {
    reviewForm.location = reviewForm.workAddress || reviewForm.location;
    if (!reviewForm.replySummary.trim()) reviewForm.replySummary = suggestedReplySummary(reviewJob.value);
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
    const recalculated = await recalculateDrafts();
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

onMounted(() => {
  void loadData();
  refreshTimer = setInterval(refreshVisibleJobs, 15_000);
  window.addEventListener("focus", refreshVisibleJobs);
  document.addEventListener("visibilitychange", refreshVisibleJobs);
});
onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer);
  window.removeEventListener("focus", refreshVisibleJobs);
  document.removeEventListener("visibilitychange", refreshVisibleJobs);
});

function showMetricsHelp() {
  ElNotification({
    title: '指标说明',
    message: '<b>职位总数</b>：当前系统中维护的所有岗位<br/><b>页面同步</b>：从BOSS直聘页面实际采集的岗位数<br/><b>安全草稿就绪</b>：已具备完整资料可自动回复的岗位<br/><b>待完善草稿</b>：需要补充信息才能发布的岗位',
    duration: 5000,
    type: 'info',
    dangerouslyUseHTMLString: true,
  })
}

function showCompanyHelp() {
  ElNotification({
    title: '公司介绍说明',
    message: '公司介绍用于候选人在咨询时，系统自动回复公司基本情况。需要填写行业、规模和简介，并经管理员审核后才能生效。',
    duration: 5000,
    type: 'info',
  })
}

function showReviewHelp() {
  ElNotification({
    title: '审核流程说明',
    message: '真实岗位待办需要完成以下步骤：<br/>1. 岗位资料：补全职位基本信息<br/>2. 页面核对：对照BOSS页面核实资料<br/>3. 回复内容：编写自动回复的岗位介绍<br/>4. 已启用：岗位正式参与招聘值守',
    duration: 6000,
    type: 'info',
    dangerouslyUseHTMLString: true,
  })
}

function showJobsHelp() {
  ElNotification({
    title: '岗位列表说明',
    message: '本列表仅显示从真实BOSS页面同步的岗位。资料来源显示岗位信息采集方式，安全草稿显示是否已准备好自动回复。状态变化均需人工确认。',
    duration: 5000,
    type: 'info',
  })
}
</script>

<template>
  <div class="page-shell positions-page">
    <PageHeader>
      <div>
        <h1>岗位资料 · 运营面板</h1>
        <p>同步、核对并维护当前实际招聘岗位。<el-button :icon="InfoFilled" size="small" type="text" @click="showMetricsHelp">查看说明</el-button></p>
      </div>
      <el-button :icon="Refresh" :loading="loading" @click="loadData()">刷新</el-button>
    </PageHeader>
    <AsyncState v-if="loading" state="loading" aria-label="正在加载岗位资料" />
    <AsyncState v-else-if="loadError" state="error" title="职位暂时无法加载" :message="loadError" retry-label="重新加载" @retry="loadData()">
      <template #icon><el-icon><Refresh /></el-icon></template>
    </AsyncState>
    <template v-else>
      <div class="metrics-strip">
        <MetricCard label="职位总数" :value="stats.total" description="当前维护的岗位总数" tone="teal"><template #icon><el-icon><Briefcase /></el-icon></template></MetricCard>
        <MetricCard label="页面同步" :value="stats.pageCaptured" description="已同步的页面数量" tone="blue"><template #icon><el-icon><Connection /></el-icon></template></MetricCard>
        <MetricCard label="安全草稿就绪" :value="stats.safeReady" description="已就绪可发布的草稿" tone="violet"><template #icon><el-icon><DocumentChecked /></el-icon></template></MetricCard>
        <MetricCard label="待完善草稿" :value="stats.draft" description="需要完善后发布" tone="amber"><template #icon><el-icon><Warning /></el-icon></template></MetricCard>
      </div>
      <div class="positions-workspace card-panel">
      <section v-if="visibleCompanies.length" class="company-knowledge-panel">
        <div class="section-title-row">
          <div>
            <h2>公司介绍</h2>
            <p>用于候选人咨询时的公司基本情况回复。<el-button :icon="InfoFilled" size="small" type="text" @click="showCompanyHelp">查看说明</el-button></p>
          </div>
        </div>
        <div class="company-knowledge-list">
          <article v-for="company in visibleCompanies" :key="company.id">
            <div>
              <strong>{{ company.name }}</strong>
              <span class="company-knowledge-state" :class="{ ready: company.knowledgeApproved }"><i></i>{{ company.knowledgeApproved ? `${company.knowledgeIndustry} · 已审核 v${company.knowledgeVersion}` : '未完成，公司信息暂不用于自动回复' }}</span>
            </div>
            <el-button v-if="canApproveCompanyKnowledge" @click="openCompanyKnowledge(company)">{{ company.knowledgeApproved ? '查看公司介绍' : '完善公司介绍' }}</el-button>
            <small v-else-if="!company.knowledgeApproved">需系统管理员完成</small>
          </article>
        </div>

      </section>
      <section v-if="reviewQueue.length" class="review-queue">
        <div class="section-title-row">
          <div>
            <h2>真实岗位待办</h2>
            <p>核对同步资料并启用可参与值守的岗位。<el-button :icon="InfoFilled" size="small" type="text" @click="showReviewHelp">查看说明</el-button></p>
          </div>
          <el-tag type="warning">{{ reviewQueue.length }} 个待处理</el-tag>
        </div>
        <div class="review-cards">
          <article v-for="job in reviewQueue" :key="job.id" class="decision-card decision-card--warning card-emphasis card-emphasis--warning">
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
              ><span :class="{ done: job.reviewReadiness.jobKnowledgeReady }"
                >3 回复内容</span
              ><span :class="{ done: job.status === 'ACTIVE' }">4 已启用</span>
            </div>
            <p>
              {{
                job.reviewReadiness.blockers.join("、") ||
                "资料已具备，可完成最终审核"
              }}
            </p>
            <footer>
              <el-button v-if="!job.reviewReadiness.companyKnowledgeReady && canApproveCompanyKnowledge" link type="warning" @click="openJobCompanyKnowledge(job)">先完善公司回复资料</el-button><span v-else-if="!job.reviewReadiness.companyKnowledgeReady" class="internal-blocker">公司回复资料未就绪</span><el-button
                type="primary"
                :disabled="!job.reviewReadiness.companyKnowledgeReady"
                @click="openImportedReview(job)"
                >补全、审核并启用</el-button
              >
            </footer>
          </article>
        </div>
      </section>
      <section class="jobs-panel">
        <div class="section-title-row jobs-title">
          <div>
            <h2>招聘岗位</h2>
            <p>仅显示从真实 BOSS 页面同步的岗位，状态变化保留人工确认。<el-button :icon="InfoFilled" size="small" type="text" @click="showJobsHelp">查看说明</el-button></p>
          </div>
          <div class="filters">
            <el-input
              v-model="keyword"
              clearable
              placeholder="搜索职位、地点或 BOSS 账号" aria-label="搜索岗位"
              :prefix-icon="Search"
              @keyup.enter="loadData"
            /><el-select
              v-model="statusFilter"
              placeholder="全部状态" aria-label="岗位状态"
              @change="loadData"
              ><el-option label="全部状态" value="" /><el-option
                label="草稿"
                value="DRAFT" /><el-option
                label="已启用"
                value="ACTIVE" /></el-select
            ><el-button @click="loadData()">查询</el-button>
          </div>
        </div>
        <AsyncState v-if="jobs.length === 0" state="empty" embedded title="还没有符合条件的职位" message="真实岗位同步后会显示在这里。">
          <template #icon><el-icon><Briefcase /></el-icon></template>
        </AsyncState>
        <template v-else>
          <el-table :data="jobs" class="jobs-table" table-layout="fixed"
            ><el-table-column type="expand" width="44"
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
                  <strong :title="row.title">{{ row.title }}</strong
                  ><span :title="`${row.location} · ${salaryLabel(row as JobPosition)}`"
                    >{{ row.location }} ·
                    {{ salaryLabel(row as JobPosition) }}</span
                  >
                </div></template
              ></el-table-column
            ><el-table-column label="公司" min-width="145"
              ><template #default="{ row }"
                ><strong>{{ row.company.name }}</strong>
                <div class="muted">{{ row.company.code }}</div></template
              ></el-table-column
            ><el-table-column label="BOSS 账号" min-width="155"
              ><template #default="{ row }"
                ><strong>{{ row.bossAccount.displayName }}</strong>
                <div class="muted">
                  {{ row.bossAccount.externalIdentifier }}
                </div></template
              ></el-table-column
            ><el-table-column label="资料来源" min-width="160" class-name="job-state-stack-column"
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
            ><el-table-column label="安全草稿" min-width="150" class-name="job-state-stack-column"
              ><template #default="{ row }"
                ><el-tag :type="row.safeReplyReady ? 'success' : 'warning'">{{
                  row.safeReplyReady
                    ? `已就绪 v${row.knowledgeVersion}`
                    : "资料待完善"
                }}</el-tag>
                <div v-if="!row.safeReplyReady" class="readiness-issues" :title="row.safeReplyIssues.join('、')">
                  {{ row.safeReplyIssues.join("、") }}
                </div></template
              ></el-table-column
            ><el-table-column label="状态" width="100" class-name="job-status-column"
              ><template #default="{ row }"
                ><el-tag :type="statusTagType(row.status)">{{
                  statusLabels[row.status as JobPositionStatus]
                }}</el-tag></template
              ></el-table-column
            ><el-table-column
              v-if="canManage"
              label="操作"
              width="120"
              class-name="job-actions-column"
              ><template #default="{ row }"
                ><div class="job-actions"><el-button
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
                ></div></template
              ></el-table-column
            ></el-table
          >
          <div class="job-cards">
            <article v-for="job in jobs" :key="job.id" class="entity-card">
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
      </div>
    </template>

    <el-dialog
      v-model="reviewDialogOpen"
      :title="`${reviewJob?.title ?? ''} · 完成真实岗位审核`"
      width="820px"
      append-to-body
      destroy-on-close
      ><div class="review-dialog-header"><span>请对照真实BOSS职位页面信息填写以下字段</span><el-button :icon="InfoFilled" size="small" type="text" @click="showReviewHelp">查看说明</el-button></div><el-form
        ref="reviewFormRef"
        :model="reviewForm"
        :rules="reviewRules"
        label-position="top"
        ><h3 class="boss-section-title">基础信息</h3>
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
        <h3 class="boss-section-title">岗位内容</h3>
        <el-form-item label="职位描述" prop="description"
          ><el-input
            v-model="reviewForm.description"
            type="textarea"
            :rows="5"
            maxlength="10000"
            show-word-limit
            placeholder="与 BOSS 职位描述保持一致"
        /></el-form-item>
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
        <h3 class="boss-section-title">回复内容</h3>
        <el-form-item label="岗位工作内容" prop="replySummary">
          <el-input v-model="reviewForm.replySummary" type="textarea" :rows="4" maxlength="1000" show-word-limit placeholder="仅填写主要工作内容；地点、薪资和公司介绍由系统使用上方已审核字段组合" />
        </el-form-item>
        <h3 class="boss-section-title">审核结果</h3>
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
    <el-dialog v-model="companyDialogOpen" :title="`${selectedCompany?.name ?? ''} · 公司统一回复资料`" width="620px" append-to-body>
      <el-form label-position="top">
        <div class="form-grid company-form-grid">
          <el-form-item label="所属行业" required><el-input v-model="companyForm.industry" maxlength="120" /></el-form-item>
          <el-form-item label="公司规模"><el-input v-model="companyForm.scale" maxlength="120" /></el-form-item>
        </div>
        <el-form-item label="公司介绍" required><el-input v-model="companyForm.summary" type="textarea" :rows="5" maxlength="1000" show-word-limit /></el-form-item>
        <el-checkbox v-model="companyForm.approved">我已核对上述公开资料，确认可用于挂机回复</el-checkbox>
      </el-form>
      <template #footer><el-button @click="companyDialogOpen = false">取消</el-button><el-button type="primary" :loading="companySaving" @click="saveCompanyKnowledge">保存并生效</el-button></template>
    </el-dialog>
  </div>
</template>

<style scoped>
.positions-workspace { overflow:hidden; container-type:inline-size; }
.jobs-title { display:grid; grid-template-columns:minmax(200px,1fr) minmax(0,1.15fr); align-items:center; }
.filters { display:grid; grid-template-columns:minmax(0,1fr) 140px auto; gap:10px; min-width:0; }
.filters :deep(.el-input),.filters :deep(.el-select) { width:100%; min-width:0; }
.company-knowledge-panel { border-bottom:1px solid var(--border-teal); background:var(--surface-teal); }
.company-knowledge-list { position:relative; z-index:1; padding:16px 22px 22px; }
.company-knowledge-list article { display:flex; align-items:center; justify-content:space-between; gap:16px; }
.company-knowledge-list strong { display:block; font-size:15px; }
.company-knowledge-state { display:flex; align-items:center; gap:7px; color:var(--text-secondary); font-size:12px; margin-top:8px; }
.company-knowledge-state i { width:7px; height:7px; border-radius:50%; background:var(--warning); flex:0 0 auto; }.company-knowledge-state.ready i { background:var(--success); }
.review-queue { border-bottom:1px solid var(--border); }
.review-cards { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; padding:20px 22px; }
.review-cards article { padding:18px; border:1px solid var(--border-amber); border-radius:var(--radius-panel); background:var(--surface-amber); }
.review-cards header,.review-cards footer { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.review-cards header > .job-identity { flex:1; min-width:0; }
.review-steps { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:6px; margin:16px 0; }
.review-steps span { padding:6px 2px; border-bottom:2px solid var(--border-strong); color:var(--text-secondary); font-size:11px; text-align:center; }
.review-steps span.done { border-color:var(--success); color:var(--success); }
.review-cards article > p,.internal-blocker { color:var(--warning); font-size:12px; line-height:1.6; }.review-cards article > p { margin:0 0 14px; }
.jobs-table { width:100%; }.jobs-table :deep(td.el-table__cell) { height:90px; vertical-align:top; padding:16px 0; background:var(--surface); }
.jobs-table :deep(.el-table__header th) { background:var(--surface-muted); }
.jobs-table :deep(.el-table__row:nth-child(even) td.el-table__cell) { background:var(--surface-soft); }
.jobs-table :deep(.el-table__row:hover td.el-table__cell) { background:var(--surface-row); }
.jobs-table :deep(.cell) { padding-inline:12px; }.jobs-table :deep(.el-tag) { height:24px; max-width:100%; vertical-align:top; }
.jobs-table :deep(.el-tag__content) { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.job-identity strong { display:-webkit-box; overflow:hidden; -webkit-box-orient:vertical; -webkit-line-clamp:2; line-clamp:2; line-height:20px; font-size:13px; }
.job-identity span,.muted { display:block; margin-top:5px; color:var(--text-secondary); font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.jobs-table :deep(td .cell > strong) { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13px; }
.readiness-issues { margin-top:5px; color:var(--warning); font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.job-actions { display:flex; flex-wrap:wrap; align-items:center; gap:4px 8px; }.job-actions .el-button { margin:0; min-height:24px; }
.job-cards { display:none; }.job-cards article { padding:20px; border-bottom:1px solid var(--border-subtle); background:var(--surface); transition:background var(--transition-fast); position:relative; }
.job-cards article:nth-child(even) { background:var(--surface-soft); }
.job-cards article:hover { background:var(--surface-row); }
.job-cards article:last-child { border:0; }.job-cards header { display:flex; align-items:flex-start; justify-content:space-between; gap:14px; }.job-cards .job-identity { min-width:0; flex:1; }
.job-cards dl { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; margin:16px 0; }.job-cards dt { color:var(--text-secondary); font-size:11px; }.job-cards dd { margin:5px 0 0; font-size:12px; overflow-wrap:anywhere; }
.job-description { display:-webkit-box; -webkit-line-clamp:3; line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; font-size:12px; color:var(--text-secondary); line-height:1.6; }
.job-cards footer { display:flex; align-items:center; flex-wrap:wrap; gap:8px; margin-top:16px; }
.captured-job-detail { padding:20px; background:var(--surface-soft); }.captured-job-detail h3 { margin:0 0 16px; font-size:15px; }
.captured-job-detail dl { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:16px; margin:0; }.captured-job-detail dt { font-size:11px; color:var(--text-secondary); }.captured-job-detail dd { margin:5px 0 0; line-height:1.6; overflow-wrap:anywhere; }.job-description-field { grid-column:1/-1; }.job-description-field dd { white-space:pre-wrap; }
.form-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:0 18px; }.form-grid :deep(.el-select),.form-grid :deep(.el-input-number) { width:100%; }
.company-form-grid,.boss-field-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
.review-dialog-header,.review-confirmations,.reply-preview { padding:16px; margin-bottom:18px; background:var(--surface-soft); border-radius:var(--radius-control); }
.review-dialog-header { display:flex; align-items:center; justify-content:space-between; gap:10px; }.review-confirmations { display:grid; gap:12px; background:var(--color-warning-bg); }
.review-confirmations :deep(.el-checkbox) { height:auto; white-space:normal; margin:0; }.form-tip { margin-top:6px; font-size:12px; line-height:1.6; }.form-tip.warning,.reply-preview small { color:var(--warning); }.reply-preview p { line-height:1.7; }.dialog-alert { margin-bottom:18px; }
.boss-section-title { font-size:16px; padding-bottom:12px; border-bottom:1px solid var(--border); margin:20px 0 16px; }
@container (max-width:1100px) { .jobs-table { display:none; }.job-cards { display:block; }.jobs-title { grid-template-columns:1fr; } }
@media(max-width:760px) { .review-cards { grid-template-columns:1fr; padding:16px; }.company-knowledge-list { padding:16px; }.company-knowledge-list article { align-items:flex-start; flex-direction:column; }.form-grid,.company-form-grid,.boss-field-grid { grid-template-columns:1fr; }.filters { grid-template-columns:minmax(0,1fr) auto; }.filters > :first-child { grid-column:1/-1; }.review-cards footer { flex-wrap:wrap; }.captured-job-detail dl { grid-template-columns:1fr; } }
@media(max-width:480px) { .job-cards article { padding:14px; }.job-cards dl { gap:8px; }.review-cards article { padding:14px; }.review-steps { gap:4px; }.review-steps span { font-size:10px; } }
</style>
