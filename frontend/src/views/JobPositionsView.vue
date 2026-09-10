<script setup lang="ts">
import PageHeader from '../components/PageHeader.vue'
import AsyncState from '../components/AsyncState.vue'
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from "vue";
import type { FormInstance, FormRules } from "element-plus";
import { ElMessage, ElMessageBox, ElNotification } from "element-plus";
import { Briefcase, DataAnalysis, InfoFilled, Refresh, Search } from "@element-plus/icons-vue";
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
const expandedJobIds = ref<string[]>([]);
const restoringExpandedRows = ref(false);
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
    const nextJobs = jobResponse.data.filter(
      (job) => job.captureSource === "VISIBLE_PAGE",
    );
    if (silent && expandedJobIds.value.length) restoringExpandedRows.value = true;
    jobs.value = nextJobs;
    const availableIds = new Set(nextJobs.map((job) => job.id));
    expandedJobIds.value = expandedJobIds.value.filter((id) => availableIds.has(id));
    if (restoringExpandedRows.value) {
      await nextTick();
      restoringExpandedRows.value = false;
    }
    companies.value = companyResponse.data;
  } catch (error) {
    if (!silent) loadError.value = apiErrorMessage(error, "职位资料加载失败，请重试");
  } finally {
    restoringExpandedRows.value = false;
    if (!silent) loading.value = false;
  }
}

function handleJobExpandChange(row: JobPosition, expandedRows: JobPosition[] | boolean) {
  if (restoringExpandedRows.value) return;
  const isExpanded = typeof expandedRows === "boolean" ? expandedRows : expandedRows.some((item) => item.id === row.id);
  if (isExpanded) expandedJobIds.value = [...new Set([...expandedJobIds.value, row.id])];
  else expandedJobIds.value = expandedJobIds.value.filter((id) => id !== row.id);
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
    !reviewForm.activateConfirmed
  ) {
    ElMessage.warning("请完成资料核对和启用确认后再启用岗位");
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
      <div class="metrics-panel">
        <div class="metrics-panel__left">
          <el-icon><DataAnalysis /></el-icon>
          <span class="metrics-panel__title">运营概览</span>
        </div>
        <div class="metrics-panel__items">
          <div class="metric-tile metric-tile--teal"><b>{{ stats.total }}</b><span>职位总数</span></div>
          <div class="metric-tile metric-tile--blue"><b>{{ stats.pageCaptured }}</b><span>页面同步</span></div>
          <div class="metric-tile metric-tile--violet"><b>{{ stats.safeReady }}</b><span>草稿就绪</span></div>
          <div class="metric-tile metric-tile--amber"><b>{{ stats.draft }}</b><span>待完善</span></div>
        </div>
        <div class="metrics-panel__right">
          <small class="metrics-panel__hint"><el-icon><InfoFilled /></el-icon> 实时统计</small>
        </div>
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
              <span :class="{ done: job.reviewReadiness.profileComplete }"><i></i>1 岗位资料</span
              ><span :class="{ done: job.reviewReadiness.captureReady }"><i></i>2 页面核对</span
              ><span :class="{ done: job.reviewReadiness.jobKnowledgeReady }"><i></i>3 回复内容</span
              ><span :class="{ done: job.status === 'ACTIVE' }"><i></i>4 已启用</span>
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
          <el-table :data="jobs" row-key="id" :expand-row-keys="expandedJobIds" @expand-change="handleJobExpandChange" class="jobs-table" table-layout="fixed"
            ><el-table-column type="expand" width="44"
              ><template #default="{ row }"
                ><div class="captured-job-detail">
                  <div class="detail-heading"><div><span class="detail-eyebrow">岗位档案</span><h3>职位基本信息与要求</h3></div><span class="detail-hint">展开查看完整资料</span></div>
                  <div class="detail-section detail-overview"><div class="detail-section-title"><span class="detail-section-icon">01</span><strong>核心信息</strong></div><dl class="detail-grid">
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
                  </dl></div>
                  <div class="detail-section detail-description"><div class="detail-section-title"><span class="detail-section-icon">02</span><strong>职位描述</strong><span class="detail-section-line"></span></div><div class="detail-description-content">{{ row.description }}</div></div>
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
.positions-workspace { overflow:hidden; container-type:inline-size; box-shadow:var(--shadow-raised); }
.jobs-title { display:grid; grid-template-columns:minmax(200px,1fr) minmax(0,1.15fr); align-items:center; }
.filters { display:grid; grid-template-columns:minmax(0,1fr) 140px auto; gap:10px; min-width:0; }
.filters :deep(.el-input),.filters :deep(.el-select) { width:100%; min-width:0; }
.company-knowledge-panel { background:linear-gradient(135deg, rgba(238,249,246,.88), rgba(255,255,255,.72)); }
.company-knowledge-list { position:relative; z-index:1; padding:16px 22px 22px; }
.company-knowledge-list article { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:14px 16px; border-radius:var(--radius-panel); background:linear-gradient(135deg, rgba(255,255,255,.78), rgba(238,249,246,.52)); box-shadow:0 1px 2px rgba(17,28,45,.03), 0 2px 8px rgba(17,28,45,.04), inset 0 1px 0 rgba(255,255,255,.7); transition:box-shadow var(--transition-fast), transform var(--transition-fast); }
.company-knowledge-list article:hover { box-shadow:0 2px 4px rgba(17,28,45,.05), 0 8px 20px rgba(17,28,45,.08), inset 0 1px 0 rgba(255,255,255,.82); transform:translateY(-1px); }
.company-knowledge-list article:active { animation:card-press 180ms ease-out both; }
.company-knowledge-list strong { display:block; font-size:15px; }
.company-knowledge-state { display:flex; align-items:center; gap:7px; color:var(--text-secondary); font-size:12px; margin-top:8px; }
.company-knowledge-state i { width:7px; height:7px; border-radius:50%; background:var(--warning); flex:0 0 auto; }.company-knowledge-state.ready i { background:var(--success); }
.review-queue { background:linear-gradient(180deg, rgba(255,255,255,.72), rgba(247,249,250,.82)); }
.review-cards { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; padding:20px 22px; }
.review-cards article { padding:20px; border:0; border-radius:var(--radius-panel); background:linear-gradient(145deg, rgba(255,247,233,.94) 0%, rgba(255,255,255,.84) 100%); box-shadow:0 1px 2px rgba(17,28,45,.035), 0 4px 16px rgba(17,28,45,.05), inset 0 1px 0 rgba(255,255,255,.72), 2px 0 0 0 rgba(183,110,0,.12); transition:box-shadow var(--transition-fast), transform 280ms cubic-bezier(.2,0,0,1); }
.review-cards article:hover { box-shadow:0 2px 4px rgba(17,28,45,.06), 0 12px 32px rgba(17,28,45,.12), inset 0 1px 0 rgba(255,255,255,.88), 2px 0 0 0 rgba(183,110,0,.18); transform:translateY(-3px); }
.review-cards article:active { animation:card-press 180ms ease-out both; }
.review-cards header,.review-cards footer { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.review-cards header > .job-identity { flex:1; min-width:0; }
.review-steps { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:0; margin:16px 0; position:relative; }
.review-steps::before { content:''; position:absolute; top:9px; left:calc(12.5%); right:calc(12.5%); height:2px; background:var(--border-strong); z-index:0; border-radius:1px; }
.review-steps span { position:relative; display:flex; flex-direction:column; align-items:center; gap:8px; padding-top:0; border-bottom:0; color:var(--text-secondary); font-size:11px; z-index:1; }
.review-steps span i { display:block; width:16px; height:16px; border-radius:50%; border:2px solid var(--border-strong); background:var(--surface); flex:0 0 auto; transition:border-color var(--transition-fast), background var(--transition-fast), box-shadow var(--transition-fast); }
.review-steps span.done i { border-color:var(--success); background:var(--success); box-shadow:0 0 0 3px rgba(22,128,91,.12); }
.review-steps span.done { color:var(--success); }
.review-cards article > p,.internal-blocker { color:var(--warning); font-size:12px; line-height:1.6; }.review-cards article > p { margin:0 0 14px; }
.metrics-panel { display:grid; grid-template-columns:auto minmax(0,1fr) auto; align-items:center; gap:18px; padding:12px 18px; margin-bottom:18px; border-radius:var(--radius-panel); border:1px solid var(--border-teal); background:linear-gradient(135deg, rgba(238,249,246/.92), rgba(255,255,255/.72)), var(--surface-teal); box-shadow:0 1px 2px rgba(17,28,45/.03), 0 4px 16px rgba(17,28,45/.06), inset 0 1px 0 rgba(255,255,255/.62); transition:background 300ms ease, border-color 300ms ease, box-shadow 280ms cubic-bezier(.2,0,0,1); position:relative; overflow:hidden; }
.metrics-panel::before { content:''; position:absolute; inset:-80% auto auto 48%; width:420px; height:220px; border-radius:50%; background:radial-gradient(circle, rgba(20,184,166/.12), transparent 68%); pointer-events:none; }
.metrics-panel > * { position:relative; z-index:1; }
.metrics-panel:hover { box-shadow:0 2px 4px rgba(17,28,45/.05), 0 10px 28px rgba(17,28,45/.10), inset 0 1px 0 rgba(255,255,255/.78); }
.metrics-panel__left { display:flex; align-items:center; gap:8px; flex-shrink:0; }
.metrics-panel__left .el-icon { font-size:18px; color:var(--primary); }
.metrics-panel__title { font-size:14px; font-weight:600; color:var(--text-primary); white-space:nowrap; }
.metrics-panel__items { display:flex; align-items:center; justify-content:center; gap:10px; min-width:0; }
.metric-tile { display:inline-flex; align-items:center; gap:6px; min-width:0; padding:7px 12px; border:1px solid var(--tile-border); border-radius:var(--radius-pill); background:var(--tile-bg); color:var(--text-secondary); box-shadow:0 1px 2px rgba(17,28,45,.035), inset 0 1px 0 rgba(255,255,255,.72); transition:transform 220ms cubic-bezier(.2,.8,.2,1), box-shadow 220ms ease, border-color 220ms ease; }
.metric-tile:hover { transform:translateY(-2px); border-color:var(--tile-accent); box-shadow:0 6px 16px color-mix(in srgb,var(--tile-accent) 14%,transparent), inset 0 1px 0 rgba(255,255,255,.85); }
.metric-tile b { color:var(--tile-accent); font-size:15px; line-height:1; font-variant-numeric:tabular-nums; }
.metric-tile span { font-size:11px; white-space:nowrap; }
.metric-tile--teal { --tile-accent:var(--primary); --tile-bg:rgba(13,148,136,.07); --tile-border:rgba(13,148,136,.18); }
.metric-tile--blue { --tile-accent:var(--color-info); --tile-bg:rgba(37,99,235,.07); --tile-border:rgba(37,99,235,.18); }
.metric-tile--violet { --tile-accent:var(--color-violet); --tile-bg:rgba(124,58,237,.07); --tile-border:rgba(124,58,237,.18); }
.metric-tile--amber { --tile-accent:var(--warning); --tile-bg:rgba(217,119,6,.07); --tile-border:rgba(217,119,6,.18); }
.metric-pill { display:inline-flex; align-items:center; gap:6px; padding:6px 12px; border:1px solid var(--border-subtle); border-radius:var(--radius-pill); background:rgba(255,255,255,.55); color:var(--text-secondary); font-size:12px; cursor:pointer; transition:background 180ms ease, border-color 180ms ease, box-shadow 200ms ease, transform 200ms cubic-bezier(.2,0,0,1); white-space:nowrap; }
.metric-pill b { color:var(--text-primary); font-weight:700; font-variant-numeric:tabular-nums; }
.metric-pill:hover { background:rgba(255,255,255/.82); border-color:var(--border-teal); box-shadow:0 2px 8px rgba(13,148,136/.08); transform:translateY(-1px); }
.metric-pill:active { animation:card-press 160ms ease-out both; }
.metric-pill--teal { --pill-accent:var(--primary); --pill-bg:rgba(13,148,136/.07); --pill-border:var(--border-teal); }
.metric-pill--blue { --pill-accent:var(--color-info); --pill-bg:rgba(37,99,235/.07); --pill-border:var(--border-blue); }
.metric-pill--violet { --pill-accent:var(--color-violet); --pill-bg:rgba(124,58,237/.07); --pill-border:var(--border-violet); }
.metric-pill--amber { --pill-accent:var(--warning); --pill-bg:rgba(217,119,6/.07); --pill-border:var(--border-amber); }
.metric-pill:not(:hover) { background:var(--pill-bg); border-color:var(--pill-border); }
.metric-pill:hover { border-color:var(--pill-accent); box-shadow:0 2px 8px color-mix(in srgb, var(--pill-accent) 22%, transparent); }
.metric-pill b { color:var(--pill-accent); }
.metrics-panel__right { flex-shrink:0; }
.metrics-panel__hint { display:flex; align-items:center; gap:4px; color:var(--text-tertiary); font-size:11px; white-space:nowrap; }
.jobs-table { width:100%; }.jobs-table :deep(td.el-table__cell) { height:90px; vertical-align:top; padding:16px 0; background:var(--surface); }
.jobs-table :deep(.el-table__header th) { background:linear-gradient(180deg, var(--surface-muted), var(--surface-soft)); }
.jobs-table :deep(.el-table__row:nth-child(even) td.el-table__cell) { background:var(--surface-soft); }
.jobs-table :deep(.el-table__row:hover td.el-table__cell) { background:var(--surface-row); }
.jobs-table :deep(.cell) { padding-inline:12px; }.jobs-table :deep(.el-tag) { height:24px; max-width:100%; vertical-align:top; }
.jobs-table :deep(.el-tag__content) { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.job-identity strong { display:-webkit-box; overflow:hidden; -webkit-box-orient:vertical; -webkit-line-clamp:2; line-clamp:2; line-height:20px; font-size:13px; }
.job-identity span,.muted { display:block; margin-top:5px; color:var(--text-secondary); font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.jobs-table :deep(td .cell > strong) { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13px; }
.readiness-issues { margin-top:5px; color:var(--warning); font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.job-actions { display:flex; flex-wrap:wrap; align-items:center; gap:4px 8px; }.job-actions .el-button { margin:0; min-height:24px; }
.job-cards { display:none; }
.job-cards article { padding:20px; border:0; border-radius:var(--radius-panel); margin-bottom:10px; background:linear-gradient(135deg, rgba(255,255,255,.88) 0%, rgba(255,255,255,.72) 100%); box-shadow:0 1px 2px rgba(17,28,45,.035), 0 4px 16px rgba(17,28,45,.05), inset 0 1px 0 rgba(255,255,255,.72); transition:background var(--transition-fast), box-shadow 280ms cubic-bezier(.2,0,0,1), transform 280ms cubic-bezier(.2,0,0,1); position:relative; }
.job-cards article:nth-child(even) { background:linear-gradient(135deg, rgba(247,249,250,.88) 0%, rgba(247,249,250,.72) 100%); }
.job-cards article:hover { background:linear-gradient(135deg, rgba(255,255,255,.96) 0%, rgba(255,255,255,.84) 100%); box-shadow:0 2px 4px rgba(17,28,45,.05), 0 12px 32px rgba(17,28,45,.10), inset 0 1px 0 rgba(255,255,255,.88), 2px 0 0 0 rgba(13,148,136,.12); transform:translateY(-3px); }
.job-cards article:active { animation:card-press 180ms ease-out both; }
.job-cards article:last-child { margin-bottom:0; }.job-cards header { display:flex; align-items:flex-start; justify-content:space-between; gap:14px; }.job-cards .job-identity { min-width:0; flex:1; }
.job-cards dl { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; margin:16px 0; }.job-cards dl > div { padding:12px 14px; border-radius:var(--radius-panel); background:linear-gradient(145deg, rgba(255,255,255,.82) 0%, rgba(255,255,255,.66) 100%); box-shadow:0 1px 2px rgba(17,28,45,.03), 0 2px 8px rgba(17,28,45,.04), inset 0 1px 0 rgba(255,255,255,.72); transition:background 180ms ease, box-shadow 280ms cubic-bezier(.2,0,0,1), transform 280ms cubic-bezier(.2,0,0,1); position:relative; overflow:hidden; }.job-cards dl > div::before { content:''; position:absolute; top:0; left:0; right:0; height:1px; background:linear-gradient(90deg, transparent 0%, rgba(255,255,255,.5) 25%, color-mix(in srgb, var(--primary) 14%, rgba(255,255,255,.88)) 50%, rgba(255,255,255,.5) 75%, transparent 100%); opacity:.82; pointer-events:none; }.job-cards dl > div:hover { background:linear-gradient(145deg, rgba(255,255,255,.94) 0%, rgba(255,255,255,.82) 100%); box-shadow:0 2px 4px rgba(17,28,45,.05), 0 8px 24px rgba(17,28,45,.10), inset 0 1px 0 rgba(255,255,255,.88), 2px 0 0 0 rgba(13,148,136,.10); transform:translateY(-2px); }.job-cards dl > div:active { animation:card-press 180ms ease-out both; }.job-cards dt { color:var(--text-secondary); font-size:11px; letter-spacing:.02em; }.job-cards dd { margin:5px 0 0; font-size:12px; overflow-wrap:anywhere; }
.job-description { display:-webkit-box; -webkit-line-clamp:3; line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; font-size:12px; color:var(--text-secondary); line-height:1.6; }
.job-cards footer { display:flex; align-items:center; flex-wrap:wrap; gap:8px; margin-top:16px; }
.captured-job-detail { padding:22px 24px 24px; background:linear-gradient(180deg, rgba(244,248,250,.9), rgba(255,255,255,.68)); border-top:1px solid rgba(65,85,105,.08); animation:detail-reveal 320ms cubic-bezier(.2,.8,.2,1) both; }
.detail-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:20px; margin-bottom:18px; }.detail-heading h3 { margin:3px 0 0; font-size:16px; letter-spacing:.01em; }.detail-eyebrow { color:var(--accent); font-size:10px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; }.detail-hint { color:var(--text-tertiary); font-size:11px; padding-top:5px; }
.detail-section { border:0; border-radius:var(--radius-panel); background:linear-gradient(145deg, rgba(255,255,255,.72) 0%, rgba(255,255,255,.58) 100%); box-shadow:0 1px 2px rgba(17,28,45,.03), 0 4px 14px rgba(17,28,45,.05), inset 0 1px 0 rgba(255,255,255,.82); }.detail-section + .detail-section { margin-top:14px; }.detail-section-title { display:flex; align-items:center; gap:9px; padding:14px 16px 11px; color:var(--text-primary); font-size:13px; }.detail-section-icon { display:grid; place-items:center; width:22px; height:22px; border-radius:7px; background:linear-gradient(145deg, rgba(13,148,136,.12) 0%, rgba(13,148,136,.06) 100%); color:var(--primary); font-size:10px; font-weight:700; box-shadow:0 1px 3px rgba(13,148,136,.10); }.detail-section-line { height:1px; flex:1; margin-left:3px; background:linear-gradient(90deg, rgba(80,102,120,.15), transparent); }
.detail-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; margin:0 12px 12px; }.detail-grid > div { min-width:0; padding:14px 16px; border-radius:var(--radius-panel); background:linear-gradient(145deg, rgba(255,255,255,.82) 0%, rgba(255,255,255,.66) 100%); box-shadow:0 1px 2px rgba(17,28,45,.03), 0 2px 8px rgba(17,28,45,.04), inset 0 1px 0 rgba(255,255,255,.72); transition:background 180ms ease, box-shadow 280ms cubic-bezier(.2,0,0,1), transform 280ms cubic-bezier(.2,0,0,1); position:relative; overflow:hidden; }.detail-grid > div::before { content:''; position:absolute; top:0; left:0; right:0; height:1px; background:linear-gradient(90deg, transparent 0%, rgba(255,255,255,.5) 25%, color-mix(in srgb, var(--primary) 14%, rgba(255,255,255,.88)) 50%, rgba(255,255,255,.5) 75%, transparent 100%); opacity:.82; pointer-events:none; }.detail-grid > div:hover { background:linear-gradient(145deg, rgba(255,255,255,.94) 0%, rgba(255,255,255,.82) 100%); box-shadow:0 2px 4px rgba(17,28,45,.05), 0 8px 24px rgba(17,28,45,.10), inset 0 1px 0 rgba(255,255,255,.88), 2px 0 0 0 rgba(13,148,136,.10); transform:translateY(-2px); }.detail-grid > div:active { animation:card-press 180ms ease-out both; }.detail-item-primary dd { font-weight:650; }.detail-item-accent { background:linear-gradient(145deg, rgba(236,249,246,.82) 0%, rgba(255,255,255,.66) 100%)!important; }.detail-item-wide { grid-column:1/-1; }.detail-grid dt { color:var(--text-secondary); font-size:11px; line-height:1.3; letter-spacing:.02em; }.detail-grid dd { margin:6px 0 0; line-height:1.55; font-size:13px; overflow-wrap:anywhere; }.detail-description-content { margin:0 16px 17px; padding:16px 18px; border-radius:var(--radius-panel); background:linear-gradient(145deg, rgba(246,249,250,.82) 0%, rgba(255,255,255,.66) 100%); box-shadow:0 1px 2px rgba(17,28,45,.03), 0 2px 8px rgba(17,28,45,.04), inset 0 1px 0 rgba(255,255,255,.72), 3px 0 0 0 var(--primary); color:var(--text-secondary); white-space:pre-wrap; line-height:1.75; font-size:13px; position:relative; overflow:hidden; }.detail-description-content::before { content:''; position:absolute; top:0; left:0; right:0; height:1px; background:linear-gradient(90deg, transparent 0%, rgba(255,255,255,.5) 25%, color-mix(in srgb, var(--primary) 14%, rgba(255,255,255,.88)) 50%, rgba(255,255,255,.5) 75%, transparent 100%); opacity:.82; pointer-events:none; }
@keyframes detail-reveal { from { opacity:0; transform:translateY(-5px); } to { opacity:1; transform:translateY(0); } }
.form-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:0 18px; }.form-grid :deep(.el-select),.form-grid :deep(.el-input-number) { width:100%; }
.company-form-grid,.boss-field-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
.review-dialog-header,.review-confirmations,.reply-preview { padding:16px; margin-bottom:18px; background:var(--surface-soft); border-radius:var(--radius-control); }
.review-dialog-header { display:flex; align-items:center; justify-content:space-between; gap:10px; }.review-confirmations { display:grid; gap:12px; background:var(--color-warning-bg); }
.review-confirmations :deep(.el-checkbox) { height:auto; white-space:normal; margin:0; }.form-tip { margin-top:6px; font-size:12px; line-height:1.6; }.form-tip.warning,.reply-preview small { color:var(--warning); }.reply-preview p { line-height:1.7; }.dialog-alert { margin-bottom:18px; }
.boss-section-title { font-size:16px; padding-bottom:12px; border-bottom:1px solid var(--border); margin:20px 0 16px; }
@container (max-width:1100px) { .jobs-table { display:none; }.job-cards { display:block; }.jobs-title { grid-template-columns:1fr; } }
@media(max-width:760px) { .review-cards { grid-template-columns:1fr; padding:16px; }.company-knowledge-list { padding:16px; }.company-knowledge-list article { align-items:flex-start; flex-direction:column; }.form-grid,.company-form-grid,.boss-field-grid { grid-template-columns:1fr; }.filters { grid-template-columns:minmax(0,1fr) auto; }.filters > :first-child { grid-column:1/-1; }.review-cards footer { flex-wrap:wrap; }.captured-job-detail { padding:18px 16px; }.detail-heading { gap:10px; }.detail-hint { display:none; }.detail-grid { grid-template-columns:repeat(2,minmax(0,1fr)); margin-inline:8px; }.detail-item-wide { grid-column:1/-1; }.metrics-panel { display:flex; flex-wrap:wrap; gap:10px; padding:12px 14px; }.metrics-panel__left { flex-basis:100%; margin-bottom:2px; }.metrics-panel__items { order:3; flex-basis:100%; justify-content:flex-start; overflow-x:auto; scrollbar-width:thin; padding-bottom:2px; }.metrics-panel__right { order:2; margin-top:-30px; } }
@media(max-width:480px) { .job-cards article { padding:14px; }.job-cards dl { gap:8px; }.review-cards article { padding:14px; }.review-steps { gap:4px; }.review-steps span { font-size:10px; } }

:global(:root[data-theme="dark"]) .company-knowledge-panel { background:linear-gradient(135deg, rgba(15,31,29,.88), rgba(30,36,51,.72)); }
:global(:root[data-theme="dark"]) .company-knowledge-list article { background:linear-gradient(135deg, rgba(30,36,51,.78), rgba(15,31,29,.52)); box-shadow:0 1px 2px rgba(0,0,0,.22), 0 2px 8px rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.04); }
:global(:root[data-theme="dark"]) .company-knowledge-list article:hover { box-shadow:0 2px 4px rgba(0,0,0,.30), 0 8px 20px rgba(0,0,0,.24), inset 0 1px 0 rgba(255,255,255,.06); }
:global(:root[data-theme="dark"]) .review-queue { background:linear-gradient(180deg, rgba(30,36,51,.72), rgba(26,31,44,.82)); }
:global(:root[data-theme="dark"]) .review-cards article { background:linear-gradient(145deg, rgba(42,34,22,.88) 0%, rgba(30,36,51,.78) 100%); box-shadow:0 1px 2px rgba(0,0,0,.22), 0 4px 16px rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.04), 2px 0 0 0 rgba(183,110,0,.16); }
:global(:root[data-theme="dark"]) .review-cards article:hover { box-shadow:0 2px 4px rgba(0,0,0,.30), 0 12px 32px rgba(0,0,0,.28), inset 0 1px 0 rgba(255,255,255,.06), 2px 0 0 0 rgba(183,110,0,.22); }
:global(:root[data-theme="dark"]) .review-steps span i { border-color:var(--border-strong); background:var(--surface); }
:global(:root[data-theme="dark"]) .job-cards article { background:linear-gradient(135deg, rgba(30,36,51,.88) 0%, rgba(26,31,44,.78) 100%); box-shadow:0 1px 2px rgba(0,0,0,.22), 0 4px 16px rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.04); }
:global(:root[data-theme="dark"]) .job-cards article:nth-child(even) { background:linear-gradient(135deg, rgba(34,40,55,.88) 0%, rgba(30,36,51,.78) 100%); }
:global(:root[data-theme="dark"]) .job-cards article:hover { background:linear-gradient(135deg, rgba(36,42,58,.96) 0%, rgba(30,36,51,.84) 100%); box-shadow:0 2px 4px rgba(0,0,0,.30), 0 12px 32px rgba(0,0,0,.28), inset 0 1px 0 rgba(255,255,255,.06), 2px 0 0 0 rgba(13,148,136,.16); }
:global(:root[data-theme="dark"]) .captured-job-detail { background:linear-gradient(180deg, rgba(26,31,44,.9), rgba(30,36,51,.68)); border-top-color:rgba(255,255,255,.06); }
:global(:root[data-theme="dark"]) .detail-section { background:linear-gradient(145deg, rgba(30,36,51,.72) 0%, rgba(26,31,44,.58) 100%); box-shadow:0 1px 2px rgba(0,0,0,.22), 0 4px 14px rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.04); }
:global(:root[data-theme="dark"]) .detail-grid > div { background:linear-gradient(145deg, rgba(30,36,51,.82) 0%, rgba(26,31,44,.66) 100%); box-shadow:0 1px 2px rgba(0,0,0,.22), 0 2px 8px rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.04); }
:global(:root[data-theme="dark"]) .detail-grid > div:hover { background:linear-gradient(145deg, rgba(36,42,58,.94) 0%, rgba(30,36,51,.82) 100%); box-shadow:0 2px 4px rgba(0,0,0,.30), 0 8px 24px rgba(0,0,0,.28), inset 0 1px 0 rgba(255,255,255,.06), 2px 0 0 0 rgba(20,184,166,.12); }
:global(:root[data-theme="dark"]) .detail-grid > div::before { background:linear-gradient(90deg, transparent 0%, rgba(255,255,255,.08) 25%, rgba(255,255,255,.22) 50%, rgba(255,255,255,.08) 75%, transparent 100%); }
:global(:root[data-theme="dark"]) .detail-item-accent { background:linear-gradient(145deg, rgba(15,31,29,.82) 0%, rgba(30,36,51,.66) 100%)!important; }
:global(:root[data-theme="dark"]) .detail-description-content { background:linear-gradient(145deg, rgba(15,31,29,.82) 0%, rgba(30,36,51,.66) 100%); box-shadow:0 1px 2px rgba(0,0,0,.22), 0 2px 8px rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.04), 3px 0 0 0 var(--primary); }
:global(:root[data-theme="dark"]) .detail-description-content::before { background:linear-gradient(90deg, transparent 0%, rgba(255,255,255,.08) 25%, rgba(255,255,255,.22) 50%, rgba(255,255,255,.08) 75%, transparent 100%); }
:global(:root[data-theme="dark"]) .jobs-table :deep(td.el-table__cell) { background:linear-gradient(135deg, rgba(30,36,51,.88) 0%, rgba(26,31,44,.72) 100%); }
:global(:root[data-theme="dark"]) .jobs-table :deep(.el-table__row:nth-child(even) td.el-table__cell) { background:linear-gradient(135deg, rgba(34,40,55,.88) 0%, rgba(30,36,51,.72) 100%); }
:global(:root[data-theme="dark"]) .jobs-table :deep(.el-table__row:hover td.el-table__cell) { background:linear-gradient(135deg, rgba(36,42,58,.96) 0%, rgba(30,36,51,.84) 100%); box-shadow:inset 2px 0 0 rgba(20,184,166,.14); }
:global(:root[data-theme="dark"]) .job-cards dl > div { background:linear-gradient(145deg, rgba(30,36,51,.82) 0%, rgba(26,31,44,.66) 100%); box-shadow:0 1px 2px rgba(0,0,0,.22), 0 2px 8px rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.04); }
:global(:root[data-theme="dark"]) .job-cards dl > div:hover { background:linear-gradient(145deg, rgba(36,42,58,.94) 0%, rgba(30,36,51,.82) 100%); box-shadow:0 2px 4px rgba(0,0,0,.30), 0 8px 24px rgba(0,0,0,.28), inset 0 1px 0 rgba(255,255,255,.06), 2px 0 0 0 rgba(20,184,166,.12); }
:global(:root[data-theme="dark"]) .job-cards dl > div::before { background:linear-gradient(90deg, transparent 0%, rgba(255,255,255,.08) 25%, rgba(255,255,255,.22) 50%, rgba(255,255,255,.08) 75%, transparent 100%); }
:global(:root[data-theme="dark"]) .metrics-panel { background:linear-gradient(135deg, rgba(15,23,32/.92), rgba(26,31,44/.72)), var(--surface-teal); border-color:var(--brand-600); box-shadow:0 1px 2px rgba(0,0,0/.22), 0 4px 16px rgba(0,0,0/.18), inset 0 1px 0 rgba(255,255,255/.04); }
:global(:root[data-theme="dark"]) .metrics-panel:hover { box-shadow:0 2px 4px rgba(0,0,0/.30), 0 10px 28px rgba(0,0,0/.26), inset 0 1px 0 rgba(255,255,255/.06); }
:global(:root[data-theme="dark"]) .metric-pill { background:rgba(255,255,255/.04); border-color:rgba(255,255,255/.06); color:rgba(255,255,255/.55); }
:global(:root[data-theme="dark"]) .metric-pill--teal { --pill-bg:rgba(13,148,136/.10); --pill-border:rgba(20,184,166/.18); }
:global(:root[data-theme="dark"]) .metric-pill--blue { --pill-bg:rgba(37,99,235/.10); --pill-border:rgba(37,99,235/.18); }
:global(:root[data-theme="dark"]) .metric-pill--violet { --pill-bg:rgba(124,58,237/.10); --pill-border:rgba(124,58,237/.18); }
:global(:root[data-theme="dark"]) .metric-pill--amber { --pill-bg:rgba(217,119,6/.10); --pill-border:rgba(217,119,6/.18); }
:global(:root[data-theme="dark"]) .metric-pill:hover { background:rgba(255,255,255/.08); }
</style>
