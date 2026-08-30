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
        if (!company.isKnowledgeApproved()) missing.add("公司知识未审核");
        if (isBlank(company.getKnowledgeIndustry())) missing.add("公司行业");
        if (isBlank(company.getKnowledgeSummary())) missing.add("公司介绍");
        if ("VISIBLE_PAGE".equals(job.getCaptureSource()) && !job.isCaptureVerified()) missing.add("页面采集资料待核对");
        if (!job.isKnowledgeApproved()) missing.add("岗位知识未审核");
        if (isBlank(job.getReplySummary())) missing.add("岗位简介");
        if (!missing.isEmpty()) {
            return new Composition("GENERIC", GENERIC_REPLY, List.copyOf(missing),
                    "资料不完整，已使用通用回退：" + String.join("、", missing));
        }

        String salary = isBlank(job.getSalaryDisplay()) ? "" : "，薪资说明为" + job.getSalaryDisplay();
        String content = "您好，已收到您关于「" + job.getTitle() + "」的消息。该岗位工作地点为"
                + job.getLocation() + salary + "，主要工作是" + job.getReplySummary() + "。"
                + company.getName() + "属于" + company.getKnowledgeIndustry() + "行业，"
                + company.getKnowledgeSummary() + "。招聘同事当前暂时不在线，稍后会继续与您沟通。";
        return new Composition("KNOWLEDGE", content, List.of(),
                "已使用审核通过的公司知识 v" + company.getKnowledgeVersion()
                        + " 与岗位知识 v" + job.getKnowledgeVersion());
    }

    /**
     * 只容忍展示层差异（全半角、大小写、空白和标点）；不做包含或相似度猜测。
     */
    public static Optional<JobPosition> matchActiveJob(String observedTitle, List<JobPosition> activeJobs) {
        String target = normalizeTitle(observedTitle);
        if (target.isEmpty()) return Optional.empty();
        List<JobPosition> matched = activeJobs.stream()
                .filter(job -> normalizeTitle(job.getTitle()).equals(target))
                .toList();
        return matched.size() == 1 ? Optional.of(matched.get(0)) : Optional.empty();
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

    public record Composition(String mode, String content, List<String> missingFields, String reason) {
    }
}
