package ai.xzkj.recruitment.jobs;

import ai.xzkj.recruitment.organization.Company;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

/**
 * 安全回复的唯一拼装入口。只使用已审核知识；任何必填事实缺失时整段回退。
 */
public final class SafeReplyComposer {
    public static final String GENERIC_REPLY = "您好，已收到您的消息。招聘同事当前暂时不在线，稍后会尽快与您沟通。";

    private SafeReplyComposer() {
    }

    public static Composition compose(JobPosition job) {
        Company company = job.getCompany();
        List<String> missing = new ArrayList<>();
        List<String> blockers = new ArrayList<>();
        addIf(!company.isKnowledgeApproved(), blockers, missing, "COMPANY_KNOWLEDGE_UNAPPROVED", "公司知识未审核");
        addIf(isBlank(company.getKnowledgeIndustry()), blockers, missing, "COMPANY_INDUSTRY_MISSING", "公司行业");
        addIf(isBlank(company.getKnowledgeSummary()), blockers, missing, "COMPANY_SUMMARY_MISSING", "公司介绍");
        addIf("VISIBLE_PAGE".equals(job.getCaptureSource()) && !job.isCaptureVerified(), blockers, missing, "VISIBLE_CAPTURE_UNVERIFIED", "页面采集资料待核对");
        addIf("UNREAD_OBSERVATION".equals(job.getCaptureSource()) && !job.isCaptureVerified(), blockers, missing, "OBSERVED_JOB_UNVERIFIED", "未读观察岗位资料待补全核对");
        addIf(!job.isKnowledgeApproved(), blockers, missing, "JOB_KNOWLEDGE_UNAPPROVED", "岗位知识未审核");
        addIf(isBlank(job.getReplySummary()), blockers, missing, "JOB_REPLY_SUMMARY_MISSING", "岗位简介");
        if (!missing.isEmpty()) {
            return new Composition("GENERIC", GENERIC_REPLY, List.copyOf(blockers), List.copyOf(missing),
                    "资料不完整，已使用通用回退：" + String.join("、", missing));
        }

        String salary = isBlank(job.getSalaryDisplay()) ? "" : "，薪资说明为" + job.getSalaryDisplay();
        String content = "您好，已收到您关于「" + job.getTitle() + "」的消息。该岗位工作地点为"
                + job.getLocation() + salary + "，主要工作是" + job.getReplySummary() + "。"
                + company.getName() + "属于" + company.getKnowledgeIndustry() + "行业，"
                + company.getKnowledgeSummary() + "。招聘同事当前暂时不在线，稍后会继续与您沟通。";
        return new Composition("KNOWLEDGE", content, List.of(), List.of(),
                "已使用审核通过的公司知识 v" + company.getKnowledgeVersion()
                        + " 与岗位知识 v" + job.getKnowledgeVersion());
    }

    /**
     * 只容忍展示层差异（全半角、大小写、空白和标点）；不做包含或相似度猜测。
     */
    public static Optional<JobPosition> matchActiveJob(String observedTitle, List<JobPosition> activeJobs) {
        return matchActiveJobDetailed(observedTitle, activeJobs).job();
    }

    public static JobMatch matchActiveJobDetailed(String observedTitle, List<JobPosition> activeJobs) {
        String target = normalizeTitle(observedTitle);
        if (target.isEmpty()) return new JobMatch("TITLE_MISSING", Optional.empty());
        List<JobPosition> matched = activeJobs.stream()
                .filter(job -> normalizeTitle(job.getTitle()).equals(target))
                .toList();
        if (matched.isEmpty()) return new JobMatch("NOT_FOUND", Optional.empty());
        if (matched.size() > 1) return new JobMatch("AMBIGUOUS", Optional.empty());
        return new JobMatch("MATCHED", Optional.of(matched.getFirst()));
    }

    static String normalizeTitle(String value) {
        if (value == null) return "";
        String normalized = Normalizer.normalize(value, Normalizer.Form.NFKC)
                .toLowerCase(Locale.ROOT);
        return normalized.replaceAll("[\\p{P}\\p{Z}\\s]+", "");
    }

    public static String normalizePublicTitle(String value) {
        return normalizeTitle(value);
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private static void addIf(boolean condition, List<String> blockers, List<String> missing, String code, String label) {
        if (condition) {
            blockers.add(code);
            missing.add(label);
        }
    }

    public record JobMatch(String status, Optional<JobPosition> job) {
    }

    public record Composition(String mode, String content, List<String> blockerCodes, List<String> missingFields, String reason) {
    }
}
