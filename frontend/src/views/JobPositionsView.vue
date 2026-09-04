<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import type { FormInstance, FormRules } from "element-plus";
import { ElMessage, ElMessageBox } from "element-plus";
import { Briefcase, Connection, DocumentChecked, Refresh, Search, Warning } from "@element-plus/icons-vue";
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

async function loadData() {
  loading.value = true;
  loadError.value = "";
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
    loadError.value = apiErrorMessage(error, "职位资料加载失败，请重试");
  } finally {
    loading.value = false;
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

onMounted(loadData);
</script>

<template>
  <div class="page-shell positions-page">
    <header class="page-heading">
      <div>
        <h1>岗位资料 · 运营面板</h1>
        <p>同步、核对并维护当前实际招聘岗位。</p>
      </div>
      <el-button :icon="Refresh" :loading="loading" @click="loadData">刷新</el-button>
    </header>
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
        <div class="static-card card-indicator">
          <el-icon><Briefcase /></el-icon><div><span>职位总数</span><strong>{{ stats.total }}</strong><small>当前维护的岗位总数</small></div>
        </div>
        <div class="static-card card-indicator">
          <el-icon><Connection /></el-icon><div><span>页面同步</span><strong>{{ stats.pageCaptured }}</strong><small>已同步的页面数量</small></div>
        </div>
        <div class="static-card card-indicator">
          <el-icon><DocumentChecked /></el-icon><div><span>安全草稿就绪</span><strong>{{ stats.safeReady }}</strong><small>已就绪可发布的草稿</small></div>
        </div>
        <div class="static-card card-indicator">
          <el-icon><Warning /></el-icon><div><span>待完善草稿</span><strong>{{ stats.draft }}</strong><small>需要完善后发布</small></div>
        </div>
      </div>
      <div class="positions-workspace card-panel">
      <section v-if="visibleCompanies.length" class="company-knowledge-panel">
        <div class="section-title-row">
          <div>
            <h2>公司介绍</h2>
            <p>用于候选人咨询时的公司基本情况回复。</p>
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
        <div class="company-ambient" aria-hidden="true"><i></i><i></i><i></i><b></b></div>
      </section>
      <section v-if="reviewQueue.length" class="review-queue">
        <div class="section-title-row">
          <div>
            <h2>真实岗位待办</h2>
            <p>核对同步资料并启用可参与值守的岗位。</p>
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
            <p>仅显示从真实 BOSS 页面同步的岗位，状态变化保留人工确认。</p>
          </div>
          <div class="filters">
            <el-input
              v-model="keyword"
              clearable
              placeholder="搜索职位、地点或 BOSS 账号"
              :prefix-icon="Search"
              @keyup.enter="loadData"
            /><el-select
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
          ><span>真实岗位同步后会显示在这里。</span>
        </div>
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
  grid-template-columns: minmax(220px, 280px) 155px auto;
  gap: 8px;
}
.jobs-table {
  width: 100%;
}
.jobs-table :deep(.el-table__row > td) {
  height: 92px;
  padding: 0;
  vertical-align: top;
}
.jobs-table :deep(.el-table__row > td > .cell) {
  padding-top: 16px;
  padding-bottom: 16px;
}
.jobs-table :deep(.cell) {
  min-width: 0;
  overflow: hidden;
}
.jobs-table :deep(td .cell > strong),
.jobs-table .muted,
.jobs-table .readiness-issues {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.jobs-table .job-identity strong {
  display: -webkit-box;
  min-height: 40px;
  overflow: hidden;
  line-height: 20px;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.jobs-table .job-identity span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.jobs-table :deep(.job-status-column .cell),
.jobs-table :deep(.job-actions-column .cell) {
  overflow: visible;
  text-overflow: clip;
  white-space: nowrap;
}
.jobs-table :deep(.job-state-stack-column .el-tag),
.jobs-table :deep(.job-status-column .el-tag) {
  height: 24px;
  line-height: 22px;
  vertical-align: top;
}
.job-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
}
.job-actions .el-button + .el-button {
  margin-left: 0;
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
.company-knowledge-panel {
  margin-bottom: 20px;
}
.company-knowledge-list {
  display: grid;
  gap: 10px;
  padding: 0 20px 20px;
}
.company-knowledge-list article {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface-muted);
}
.company-knowledge-list strong,
.company-knowledge-list span {
  display: block;
}
.company-knowledge-list span,
.company-knowledge-list small {
  margin-top: 4px;
  color: var(--text-secondary);
  font-size: 11px;
}
.company-form-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
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
  grid-template-columns: repeat(4, 1fr);
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
.internal-blocker{align-self:center;color:var(--warning);font-size:11px}
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
    grid-template-columns: minmax(200px, 1fr) 150px auto;
  }
}
@media (max-width: 1360px) {
  .jobs-table {
    display: none;
  }
  .job-cards {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    padding: 14px;
  }
  .job-cards article {
    min-width: 0;
    padding: 16px;
    border: 1px solid var(--border);
    background: var(--surface-raised);
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
    grid-template-columns: 90px minmax(0, 1fr);
    gap: 10px;
  }
  .job-cards dt {
    color: var(--text-secondary);
    font-size: 13px;
  }
  .job-cards dd {
    min-width: 0;
    margin: 0;
    overflow-wrap: anywhere;
    font-size: 13px;
  }
  .job-description {
    display: -webkit-box;
    margin: 0;
    overflow: hidden;
    color: var(--text-secondary);
    font-size: 13px;
    line-height: 1.6;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
  }
  .job-cards footer {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 18px;
  }
  .job-cards footer .el-button {
    margin: 0;
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
  .review-cards,
  .company-form-grid {
    grid-template-columns: 1fr;
  }
  .company-knowledge-list article {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .company-knowledge-list article .el-button,
  .company-knowledge-list article > small {
    grid-column: 1 / -1;
    justify-self: start;
  }
  .jobs-table {
    display: none;
  }
  .job-cards {
    grid-template-columns: 1fr;
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

/* 指标静止、待审核项强调、移动岗位卡保留实体反馈。 */
.metrics-strip .static-card { min-height: 92px; padding: 18px 20px; border: 1px solid var(--border); border-left: 3px solid var(--card-accent, var(--brand-600)); border-radius: var(--card-radius); background: #fff; box-shadow: var(--shadow-card); transform: none; }
.metrics-strip .static-card:nth-child(2) { --card-accent: var(--color-info); }
.metrics-strip .static-card:nth-child(3) { --card-accent: var(--success); }
.metrics-strip .static-card:nth-child(4) { --card-accent: var(--warning); }
.metrics-strip .static-card strong { font-size: 30px; line-height: 1; }
.metrics-strip .static-card:hover { border-color: var(--border); box-shadow: var(--shadow-card); transform: none; }
.review-cards article.decision-card { padding: 16px 14px; border: 0; border-left: 3px solid var(--warning); border-radius: 10px; background: #fff9ed; }
.job-cards article.entity-card { border: 1px solid var(--border); border-radius: var(--card-radius); background: #fff; box-shadow: var(--shadow-card); }
.job-cards article.entity-card:hover { border-color: var(--border-strong); background: #fff; box-shadow: var(--shadow-card-hover); transform: translateY(-1px); }

.metrics-strip {
  gap: 14px;
  border: 0;
  border-radius: 0;
  background: transparent;
  overflow: visible;
}

.metrics-strip div {
  position: relative;
  min-width: 0;
  overflow: hidden;
  padding: 18px 20px;
  border: 1px solid var(--border);
  border-radius: var(--card-radius);
  background: linear-gradient(145deg, #fff 35%, #f8fbfa 100%);
  box-shadow: var(--shadow-sm);
  transition: transform var(--transition-fast), border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.metrics-strip div::after {
  position: absolute;
  top: -24px;
  right: -20px;
  width: 70px;
  height: 70px;
  border-radius: 50%;
  background: #d8f4ee;
  content: '';
  opacity: .58;
}

.metrics-strip div:nth-child(2)::after { background: #dceaff; }
.metrics-strip div:nth-child(3)::after { background: #d7f1dd; }
.metrics-strip div:nth-child(4)::after { background: #fff0c9; }
.metrics-strip div > * { position: relative; z-index: 1; }
.metrics-strip div:hover { transform: translateY(-2px); border-color: var(--border-strong); box-shadow: var(--shadow-card-hover); }

.review-cards article,
.job-cards article {
  border-radius: var(--card-radius);
  transition: transform var(--transition-fast), border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.review-cards article:hover,
.job-cards article:hover {
  transform: translateY(-2px);
  border-color: #dcb86b;
  box-shadow: var(--shadow-card-hover);
}

.jobs-title { background: linear-gradient(180deg, #fff, #fbfcfc); }
.filters > * { min-width: 0; }
.captured-job-detail dl div { border: 1px solid #e6edeb; }
@media (max-width: 720px) {
  .metrics-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .metrics-strip div { border-right: 1px solid var(--border); }
  .job-cards article { border-radius: var(--card-radius); background: linear-gradient(145deg, #fff 35%, #fbfcfc 100%); box-shadow: var(--shadow-sm); }
}
@media (max-width: 430px) {
  .metrics-strip { grid-template-columns: 1fr; }
}

/* 岗位资料采用“同步情况 → 待办 → 列表”的渐进层级，降低长表单压迫感。 */
.metrics-strip { gap: 12px; }
.metrics-strip div { padding: 17px 18px; background: var(--surface-raised); }
.metrics-strip div::after { display: none; }
.metrics-strip div:first-child { border-left: 3px solid var(--brand-600); }
.metrics-strip div:nth-child(2) { border-left: 3px solid #5587bd; }
.metrics-strip div:nth-child(3) { border-left: 3px solid #15936c; }
.metrics-strip div:nth-child(4) { border-left: 3px solid #d18a20; }
.metrics-strip div { min-height: 94px; border-radius: var(--radius-lg); box-shadow: var(--shadow-card); transform: none; }
.metrics-strip div:hover { border-color: var(--border); box-shadow: var(--shadow-card); transform: none; }
.company-knowledge-list { padding: 0 22px 22px; }
.company-knowledge-list article { border-color: var(--border-subtle); background: #f8faf9; }
.review-cards { padding: 0 22px 22px; }
.review-cards article { border-color: #efd8a9; background: #fffcf7; }
.review-steps span { border: 1px solid transparent; }
.review-steps span.done { border-color: #c5ead9; }
.jobs-title { align-items: center; background: #fff; }
.filters .el-input, .filters .el-select { min-width: 0; }
.jobs-table :deep(.el-table__expanded-cell) { padding-top: 0; padding-bottom: 0; background: #fbfcfc; }
.captured-job-detail { padding: 18px 30px 24px; }
.captured-job-detail h3 { color: var(--brand-900); font-size: 15px; }
.captured-job-detail dl div { border-color: var(--border-subtle); border-radius: 10px; background: #fff; }
.reply-preview { border-color: #cce5df; background: #f5fbf9; }
.review-confirmations { border-color: #ead49f; background: #fffcf7; }
@media (max-width: 720px) { .company-knowledge-list, .review-cards { padding: 0 16px 16px; } .captured-job-detail { padding: 16px; } }

/* 外层面板负责分区，内部资料与待办改用平面行，避免卡片继续嵌套。 */
.company-knowledge-list { padding-bottom: 10px; }
.company-knowledge-list article { padding: 14px 2px; border: 0; border-top: 1px solid var(--border-subtle); border-radius: 0; background: transparent; }
.company-knowledge-list article { grid-template-columns: minmax(0, 1fr) auto; }
.company-knowledge-list article:first-child { border-top: 0; }
.company-knowledge-state { display: flex !important; align-items: center; gap: 7px; }
.company-knowledge-state i { width: 6px; height: 6px; flex: 0 0 auto; border-radius: 50%; background: var(--warning); }
.company-knowledge-state.ready i { background: var(--success); }
.review-cards { gap: 0 20px; padding-bottom: 12px; }
.review-cards article { padding: 16px 2px; border: 0; border-top: 1px solid var(--border-subtle); border-radius: 0; background: transparent; box-shadow: none; }
.review-cards article:nth-child(-n + 2) { border-top: 0; }
.review-cards article:hover { border-color: var(--border-subtle); background: #fbfcfc; box-shadow: none; transform: none; }
.review-steps { gap: 8px; }
.review-steps span { padding: 6px 3px; border: 0; border-bottom: 2px solid #dfe6eb; border-radius: 0; background: transparent; }
.review-steps span.done { border: 0; border-bottom: 2px solid #55b99b; background: transparent; color: #147255; }
.review-cards article > p { padding: 0; background: transparent; }
.jobs-title { padding: 24px 26px; }
.jobs-panel { border-radius: var(--radius-lg); }
.jobs-table :deep(.el-table__row) { height: 86px; }
.jobs-table :deep(.el-table__cell) { vertical-align: middle; }
.jobs-table :deep(.el-tag) { display: inline-flex; align-items: center; min-height: 26px; line-height: 1.2; }
.job-cards article:hover { border-color: var(--border); box-shadow: var(--shadow-card); transform: none; }
@media (max-width: 720px) {
  .review-cards article:nth-child(2) { border-top: 1px solid var(--border-subtle); }
}

/* V80 岗位运营面板：摘要、公司资料、真实岗位表在同一阅读节奏中。 */
.page-shell { width: min(100%, 1440px); max-width: none; }
.page-heading { margin-bottom: 30px; }.page-heading h1 { font-size: clamp(30px, 2.5vw, 38px); letter-spacing: -.035em; }
.metrics-strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 20px; margin-bottom: 26px; }
.metrics-strip > .static-card { display: grid; grid-template-columns: 58px minmax(0, 1fr); align-items: center; gap: 17px; min-height: 122px; padding: 22px; border: 1px solid var(--border); border-left: 3px solid var(--card-accent, var(--brand-600)); border-radius: 16px; background: #fff; box-shadow: 0 8px 22px rgba(23, 32, 51, .045); }
.metrics-strip > .static-card:nth-child(2) { --card-accent: #4e8cf7; }.metrics-strip > .static-card:nth-child(3) { --card-accent: #8b6feb; }.metrics-strip > .static-card:nth-child(4) { --card-accent: var(--warning); }
.metrics-strip > .static-card::after { display: none; }.metrics-strip > .static-card > .el-icon { display: grid; width: 58px; height: 58px; place-items: center; border-radius: 17px; background: color-mix(in srgb, var(--card-accent, var(--brand-600)) 10%, white); color: var(--card-accent, var(--brand-600)); font-size: 27px; }
.metrics-strip > .static-card > div { position: static; display: block; min-width: 0; overflow: visible; padding: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none; transform: none; transition: none; }
.metrics-strip > .static-card > div::after { display: none; }.metrics-strip > .static-card span, .metrics-strip > .static-card strong, .metrics-strip > .static-card small { display: block; }.metrics-strip > .static-card span { color: var(--text-secondary); font-size: 12px; }.metrics-strip > .static-card strong { margin-top: 4px; font-size: 30px; line-height: 1; }.metrics-strip > .static-card small { margin-top: 8px; color: var(--text-tertiary); font-size: 11px; }
.company-knowledge-panel { min-height: 162px; overflow: hidden; border-radius: 17px; background: linear-gradient(110deg, #fff 62%, #f3fbf9); }.company-knowledge-panel .section-title-row { padding: 22px 24px 12px; }.company-knowledge-list { padding: 0 24px 18px; }.company-knowledge-list article { min-height: 58px; padding-block: 11px; }
.review-queue { margin-bottom: 20px; border-radius: 17px; }.review-queue .section-title-row { padding: 21px 24px 12px; }.review-cards { padding: 0 24px 12px; }.review-cards article { min-height: 146px; padding-block: 16px; }.review-steps { grid-template-columns: repeat(4, minmax(0, 1fr)); }.review-steps span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.jobs-panel { overflow: hidden; border-radius: 17px; }.jobs-title { min-height: 96px; padding: 20px 24px; }.jobs-title h2 { font-size: 20px; }.filters { gap: 10px; }.filters .el-input { width: 308px; }.filters .el-select { width: 156px; }.filters .el-button { min-height: 40px; padding-inline: 18px; }
.jobs-table :deep(.el-table__header-wrapper th) { height: 44px; background: #f8fafc; color: #4d5d68; font-size: 12px; }.jobs-table :deep(.el-table__row) { height: 78px; }.jobs-table :deep(.el-table__cell) { padding-top: 10px; padding-bottom: 10px; }.jobs-table :deep(.cell) { overflow: visible; }.jobs-table :deep(.el-table__row:hover > td) { background: #f7fbfa !important; }.jobs-table :deep(.el-table__body tr:last-child > td) { border-bottom: 0; }
.job-identity strong { font-size: 14px; }.job-identity span, .jobs-table .muted { font-size: 11px; }.jobs-table :deep(.el-tag) { min-height: 24px; border-radius: 6px; font-size: 11px; }.job-actions { justify-content: flex-end; gap: 10px; }.job-actions .el-button { min-height: 28px; padding-inline: 6px; }
@media (max-width: 1160px) { .metrics-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }.filters .el-input { width: min(280px, 28vw); } }
@media (max-width: 760px) { .page-heading { margin-bottom: 22px; }.metrics-strip { gap: 12px; margin-bottom: 18px; }.metrics-strip > .static-card { min-height: 100px; padding: 17px; }.metrics-strip > .static-card > .el-icon { width: 44px; height: 44px; border-radius: 13px; font-size: 21px; }.filters { width: 100%; display: grid; grid-template-columns: minmax(0, 1fr) 122px auto; }.filters .el-input, .filters .el-select { width: 100%; }.jobs-title { align-items: stretch; }.jobs-title > div:first-child { margin-bottom: 12px; } }
@media (max-width: 520px) { .metrics-strip { grid-template-columns: 1fr; }.filters { grid-template-columns: 1fr; }.filters .el-button { width: 100%; }.company-knowledge-panel .section-title-row, .company-knowledge-list, .review-queue .section-title-row, .review-cards, .jobs-title { padding-inline: 16px; } }

/* 公司介绍使用低对比度轮廓，仅作为空间层次，不承载信息或操作。 */
.company-knowledge-panel { position: relative; isolation: isolate; }.company-knowledge-panel .section-title-row, .company-knowledge-panel .company-knowledge-list { position: relative; z-index: 1; }.company-ambient { position: absolute; right: 34px; bottom: 0; z-index: 0; display: flex; align-items: end; gap: 8px; height: 120px; opacity: .36; pointer-events: none; }.company-ambient i { display: block; width: 28px; height: 70px; border: 1px solid #9bddd0; border-bottom: 0; border-radius: 5px 5px 0 0; background: linear-gradient(90deg, rgba(135,220,203,.14) 0 24%, transparent 24% 36%, rgba(135,220,203,.14) 36% 60%, transparent 60% 72%, rgba(135,220,203,.14) 72%); }.company-ambient i:nth-child(2) { width: 38px; height: 104px; }.company-ambient i:nth-child(3) { width: 25px; height: 54px; }.company-ambient b { position: absolute; right: -34px; bottom: 0; width: 230px; height: 54px; border-radius: 100% 0 0; background: radial-gradient(ellipse at bottom, rgba(139,223,207,.3), transparent 68%); }.company-knowledge-list article { padding-right: 260px; }
@media (max-width: 760px) { .company-ambient { right: 14px; transform: scale(.75); transform-origin: right bottom; }.company-knowledge-list article { padding-right: 160px; } }
@media (max-width: 520px) { .company-ambient { display: none; }.company-knowledge-list article { padding-right: 0; } }

/* 筛选区按可收缩网格布局，避免搜索框覆盖状态选择器。 */
.jobs-title { display: grid; grid-template-columns: minmax(220px, 1fr) minmax(0, 650px); align-items: center; gap: 22px; }.jobs-title > div:first-child { min-width: 0; }.filters { display: grid; grid-template-columns: minmax(0, 1fr) 156px auto; width: 100%; min-width: 0; }.filters .el-input, .filters .el-select { width: 100% !important; min-width: 0; }
@media (max-width: 1120px) { .jobs-title { grid-template-columns: 1fr; }.filters { max-width: none; }.jobs-title > div:first-child { margin-bottom: 0; } }
@media (max-width: 560px) { .filters { grid-template-columns: 1fr; }.filters .el-button { width: 100%; } }

/* 单一岗位工作区：内部模块依靠分区标题和分隔线组织，不继续叠加卡片。 */
.positions-workspace { padding: 0; overflow: hidden; }
.positions-workspace > section {
  min-width: 0;
  margin: 0;
  border: 0;
  border-bottom: 1px solid var(--border-subtle);
  border-radius: 0;
  background: #fff;
  box-shadow: none;
}
.positions-workspace > section:last-child { border-bottom: 0; }
.positions-workspace .section-title-row { border-bottom: 1px solid var(--border-subtle); }
.positions-workspace .filters { align-items: center; }
</style>
