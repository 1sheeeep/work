package ai.xzkj.recruitment.jobs;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** 岗位级回复模板。模板只负责已知事实的确定性渲染，不替代复杂消息的 AI 判断。 */
@Service
public class JobReplyTemplateService {

    private static final List<TemplateDefinition> DEFAULTS = List.of(
            new TemplateDefinition("SALARY", "您好，这个岗位目前薪资为{{SALARY_VALUE}}。如果您对岗位感兴趣，我可以继续为您介绍。", "SALARY_VALUE"),
            new TemplateDefinition("LOCATION", "您好，工作地点在{{LOCATION_VALUE}}。如果您对岗位感兴趣，可以继续沟通。", "LOCATION_VALUE"),
            new TemplateDefinition("RESPONSIBILITIES", "您好，这个岗位主要负责{{RESPONSIBILITIES_VALUE}}。如果您想了解具体安排，我可以继续介绍。", "RESPONSIBILITIES_VALUE"),
            new TemplateDefinition("EXPERIENCE", "您好，岗位经验要求是{{EXPERIENCE_VALUE}}，欢迎结合您的情况进一步沟通。", "EXPERIENCE_VALUE"),
            new TemplateDefinition("EDUCATION", "您好，岗位学历要求是{{EDUCATION_VALUE}}，欢迎结合您的情况进一步沟通。", "EDUCATION_VALUE"),
            new TemplateDefinition("WORK_TIME", "您好，上班时间为{{WORK_TIME_VALUE}}。如果您对岗位感兴趣，可以继续沟通。", "WORK_TIME_VALUE"),
            new TemplateDefinition("BENEFITS", "您好，公司福利待遇包括{{BENEFITS_VALUE}}。如果您想了解更多，我可以继续介绍。", "BENEFITS_VALUE"),
            new TemplateDefinition("TRIAL_PERIOD", "岗位试岗安排为{{TRIAL_PERIOD_VALUE}}，具体细节面试时再详细沟通。", "TRIAL_PERIOD_VALUE"),
            new TemplateDefinition("MEALS_LODGING", "吃住自理", ""),
            new TemplateDefinition("SOCIAL_GREETING", "您好", ""),
            new TemplateDefinition("SOCIAL_THANKS", "不客气，您后续有问题可以随时沟通。", ""),
            new TemplateDefinition("SOCIAL_ACKNOWLEDGEMENT", "好的", ""),
            new TemplateDefinition("CANDIDATE_CONSIDERING", "好的，您可以先了解和考虑，有需要时随时联系我。", ""),
            new TemplateDefinition("RESUME_WILL_SEND", "好的，您方便时发过来即可，我收到后会及时查看。", ""),
            new TemplateDefinition("RESUME_SENT", "好的，我先看一下您的简历，了解后再和您联系。", ""),
            new TemplateDefinition("CANDIDATE_DECLINE", "感谢投递，祝您求职顺利。", ""),
            new TemplateDefinition("CONVERSATION_CLOSING", "好的，后续有需要欢迎随时联系。", "")
    );

    private final JobReplyTemplateRepository templates;

    public JobReplyTemplateService(JobReplyTemplateRepository templates) {
        this.templates = templates;
    }

    @Transactional
    public void ensureDefaults(JobPosition job) {
        if (job == null) return;
        Map<String, JobReplyTemplate> existing = new LinkedHashMap<>();
        templates.findAllByJobPositionId(job.getId()).forEach(template -> existing.put(template.getIntent(), template));
        Instant now = Instant.now();
        for (TemplateDefinition definition : DEFAULTS) {
            JobReplyTemplate template = existing.get(definition.intent());
            if (template == null) {
                templates.save(new JobReplyTemplate(job, definition.intent(), definition.templateText(),
                        definition.requiredFactKeys(), now));
            }
        }
    }

    @Transactional
    public Optional<RenderedReply> renderFixedFact(JobPosition job, String message) {
        if (job == null || !job.isKnowledgeApproved() || message == null || message.isBlank()) return Optional.empty();
        ensureDefaults(job);
        String intent = JobReplyIntentMatcher.detectFixedIntent(message);
        if (intent == null) return Optional.empty();
        JobReplyTemplate template = templates.findAllByJobPositionId(job.getId()).stream()
                .filter(candidate -> candidate.isEnabled() && intent.equals(candidate.getIntent()))
                .findFirst().orElse(null);
        if (template == null) return Optional.empty();
        Map<String, String> facts = facts(job);
        for (String key : template.getRequiredFactKeys().split(",")) {
            if (!key.isBlank() && (!facts.containsKey(key) || facts.get(key).isBlank())) return Optional.empty();
        }
        String rendered = template.getTemplateText();
        for (Map.Entry<String, String> fact : facts.entrySet()) {
            rendered = rendered.replace("{{" + fact.getKey() + "}}", fact.getValue());
        }
        if (rendered.contains("{{") || rendered.length() > 200) return Optional.empty();
        return Optional.of(new RenderedReply(intent, rendered,
                "已命中岗位固定事实模板，未调用 AI；事实来自当前岗位已审核资料"));
    }

    @Transactional
    public Optional<RenderedReply> renderSocialReply(JobPosition job, String message) {
        if (job == null || message == null || message.isBlank()) return Optional.empty();
        ensureDefaults(job);
        String intent = JobReplyIntentMatcher.detectSocialIntent(message);
        if (intent == null) return Optional.empty();
        JobReplyTemplate template = templates.findAllByJobPositionId(job.getId()).stream()
                .filter(candidate -> candidate.isEnabled() && intent.equals(candidate.getIntent()))
                .findFirst().orElse(null);
        if (template == null || !template.getRequiredFactKeys().isBlank()) return Optional.empty();
        return Optional.of(new RenderedReply(intent, template.getTemplateText(),
                "已命中岗位社交模板，可选用轻量 AI 仅润色语气"));
    }

    private Map<String, String> facts(JobPosition job) {
        Map<String, String> facts = new LinkedHashMap<>();
        put(facts, "SALARY_VALUE", job.getSalaryDisplay());
        put(facts, "LOCATION_VALUE", first(job.getWorkAddress(), job.getLocation()));
        put(facts, "RESPONSIBILITIES_VALUE", first(job.getReplySummary(), job.getDescription()));
        put(facts, "EXPERIENCE_VALUE", job.getExperienceRequirement());
        put(facts, "EDUCATION_VALUE", job.getEducationRequirement());
        put(facts, "WORK_TIME_VALUE", job.getWorkTime());
        put(facts, "BENEFITS_VALUE", job.getBenefits());
        put(facts, "TRIAL_PERIOD_VALUE", trialPeriod(job));
        return facts;
    }

    /**
     * 优先复用当前岗位已审核资料中的试岗安排；岗位资料没有明确写出时，
     * 使用统一的业务兜底“三天”，避免候选人询问试岗期时被错误静默或转人工。
     */
    private String trialPeriod(JobPosition job) {
        String source = String.join(" ", clean(job.getDescription()), clean(job.getReplySummary()),
                clean(job.getScreeningRequirements()));
        if (source.isBlank() || !source.contains("试岗")) return "3天";
        java.util.regex.Matcher matcher = java.util.regex.Pattern.compile(
                "([^。；;\\n]{0,80}试岗(?:期|安排)[^。；;\\n]{0,120})").matcher(source);
        if (!matcher.find()) return "3天";
        return clean(matcher.group(1));
    }

    private static String first(String preferred, String fallback) {
        return preferred != null && !preferred.isBlank() ? preferred.trim() : clean(fallback);
    }

    private static void put(Map<String, String> facts, String key, String value) {
        String clean = clean(value);
        if (!clean.isBlank() && !clean.contains("待补全") && !clean.contains("未提供")) facts.put(key, clean);
    }

    private static String clean(String value) {
        return value == null ? "" : value.replaceAll("\\s+", " ").trim();
    }

    public record RenderedReply(String intent, String content, String reason) {
    }

    private record TemplateDefinition(String intent, String templateText, String requiredFactKeys) {
    }
}
