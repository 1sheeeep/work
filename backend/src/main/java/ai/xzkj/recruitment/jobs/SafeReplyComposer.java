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
    public static final int MAX_REPLY_LENGTH = 240;

    private SafeReplyComposer() {
    }

    public static Composition compose(JobPosition job) {
        Company company = job.getCompany();
        List<String> missing = new ArrayList<>();
        List<String> blockers = new ArrayList<>();
        addIf("VISIBLE_PAGE".equals(job.getCaptureSource()) && !job.isCaptureVerified(), blockers, missing, "VISIBLE_CAPTURE_UNVERIFIED", "页面采集资料待核对");
        addIf("UNREAD_OBSERVATION".equals(job.getCaptureSource()) && !job.isCaptureVerified(), blockers, missing, "OBSERVED_JOB_UNVERIFIED", "未读观察岗位资料待补全核对");
        addIf(!job.isKnowledgeApproved(), blockers, missing, "JOB_KNOWLEDGE_UNAPPROVED", "岗位知识未审核");
        if (!missing.isEmpty()) {
            return new Composition("GENERIC", GENERIC_REPLY, List.copyOf(blockers), List.copyOf(missing),
                    "资料不完整，已使用通用回退：" + String.join("、", missing));
        }

        String title = concise(job.getTitle(), 48);
        String location = concise(job.getLocation(), 36);
        String salary = isBlank(job.getSalaryDisplay()) ? "" : "，薪资为" + concise(job.getSalaryDisplay(), 28);
        String content = "您好，已收到您关于「" + title + "」的消息。岗位地点为" + location
                + salary + "；如果您有兴趣，欢迎继续沟通。";
        if (content.length() > MAX_REPLY_LENGTH) {
            content = "您好，已收到您关于「" + concise(title, 32) + "」的消息。如果您有兴趣，欢迎继续沟通。";
        }
        return new Composition("KNOWLEDGE", content, List.of(), List.of(),
                "已使用审核通过的岗位知识 v" + job.getKnowledgeVersion());
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

    private static String concise(String value, int maxLength) {
        String cleaned = value == null ? "" : value.replaceAll("\\s+", " ").trim();
        return cleaned.length() <= maxLength ? cleaned : cleaned.substring(0, maxLength - 1) + "…";
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
