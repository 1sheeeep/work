package ai.xzkj.recruitment.jobs;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Pattern;

/** 岗位级回复模板。模板只负责已知事实的确定性渲染，不替代复杂消息的 AI 判断。 */
@Service
public class JobReplyTemplateService {
    private static final Pattern SALARY = Pattern.compile("(薪资|工资|月薪|年薪|底薪|提成|多少钱|薪酬|待遇)");
    private static final Pattern LOCATION = Pattern.compile("(工作地址|上班地址|工作地点|上班地点|办公地址|在哪里上班|在哪上班|工作地)");
    private static final Pattern RESPONSIBILITIES = Pattern.compile("(工作内容|主要做什么|主要负责|岗位职责|职责是什么|平时做什么|日常工作|干什么|干嘛)");
    private static final Pattern WORK_TIME = Pattern.compile("(上班时间|工作时间|上下班时间|几点上班|几点下班|打卡时间|休息时间|月休|休息几天|每周休息|单双休|大小周)");
    private static final Pattern BENEFITS = Pattern.compile("(福利待遇|福利|五险一金|社保|公积金|补贴|奖金|年终奖|带薪年假)");
    private static final Pattern EXPERIENCE = Pattern.compile("(经验要求|需要经验|工作经验|几年经验|无经验|没有经验|没经验|应届生|应届毕业)");
    private static final Pattern EDUCATION = Pattern.compile("(学历要求|学历|什么学历|大专|本科|中专|高中|硕士|博士)");
    private static final Pattern SOCIAL_GREETING = Pattern.compile("^(?:你?好|哈喽|hello|hi)[啊呀呢哈哦的了～~。！!，,\\s]*$", Pattern.CASE_INSENSITIVE);
    private static final Pattern SOCIAL_THANKS = Pattern.compile("^(?:谢谢|感谢|多谢)[啊呀呢哈哦的了～~。！!，,\\s]*$");
    private static final Pattern SOCIAL_ACK = Pattern.compile("^(?:好的?|好哒|嗯+|收到|知道了|明白了|可以|行|没问题)[啊呀呢哈哦的了～~。！!，,\\s]*$");
    private static final Pattern CONSIDERING = Pattern.compile("(考虑一下|再看看|想一想|先了解一下|回去考虑)");
    private static final Pattern RESUME_WILL_SEND = Pattern.compile("(?:(?:稍后|晚点|一会儿|马上|这就).{0,4}(?:发|发送|投递|上传).{0,6}简历|可以.{0,8}发.{0,4}简历)");
    private static final Pattern RESUME_SENT = Pattern.compile("(?:(?:已|已经|刚刚?|刚才).{0,6}(?:发|发送|投递|上传).{0,6}简历|简历.{0,8}(?:发了|发送了|已发|投递了|上传了))");
    private static final Pattern DECLINE = Pattern.compile("(不考虑|不再考虑|不在考虑范围|不太合适|不合适|暂时不考虑|没兴趣|不感兴趣|无法接受|不方便入职|不想入职|距离太远|办公地点太远|加班太晚)");
    private static final Pattern CLOSING = Pattern.compile("(再见|拜拜|晚安|先这样|回头联系)");

    private static final List<TemplateDefinition> DEFAULTS = List.of(
            new TemplateDefinition("SALARY", "您好，这个岗位目前薪资为{{SALARY_VALUE}}。如果您对岗位感兴趣，我可以继续为您介绍。", "SALARY_VALUE"),
            new TemplateDefinition("LOCATION", "您好，工作地点在{{LOCATION_VALUE}}。如果您对岗位感兴趣，可以继续沟通。", "LOCATION_VALUE"),
            new TemplateDefinition("RESPONSIBILITIES", "您好，这个岗位主要负责{{RESPONSIBILITIES_VALUE}}。如果您想了解具体安排，我可以继续介绍。", "RESPONSIBILITIES_VALUE"),
            new TemplateDefinition("EXPERIENCE", "您好，岗位经验要求是{{EXPERIENCE_VALUE}}，欢迎结合您的情况进一步沟通。", "EXPERIENCE_VALUE"),
            new TemplateDefinition("EDUCATION", "您好，岗位学历要求是{{EDUCATION_VALUE}}，欢迎结合您的情况进一步沟通。", "EDUCATION_VALUE"),
            new TemplateDefinition("WORK_TIME", "您好，上班时间为{{WORK_TIME_VALUE}}。如果您对岗位感兴趣，可以继续沟通。", "WORK_TIME_VALUE"),
            new TemplateDefinition("BENEFITS", "您好，公司福利待遇包括{{BENEFITS_VALUE}}。如果您想了解更多，我可以继续介绍。", "BENEFITS_VALUE"),
            new TemplateDefinition("SOCIAL_GREETING", "您好，已收到您的消息，方便的话可以继续了解这个岗位。", ""),
            new TemplateDefinition("SOCIAL_THANKS", "不客气，您后续有问题可以随时沟通。", ""),
            new TemplateDefinition("SOCIAL_ACKNOWLEDGEMENT", "好的，收到，您有问题可以继续沟通。", ""),
            new TemplateDefinition("CANDIDATE_CONSIDERING", "好的，您可以先了解和考虑，有需要时随时联系我。", ""),
            new TemplateDefinition("RESUME_WILL_SEND", "好的，您方便时发过来即可，我收到后会及时查看。", ""),
            new TemplateDefinition("RESUME_SENT", "好的，简历已收到，我先看一下，稍后和您沟通。", ""),
            new TemplateDefinition("CANDIDATE_DECLINE", "好的，感谢您的投递。", ""),
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
        String intent = detectFixedIntent(message);
        if (intent == null) return Optional.empty();
        JobReplyTemplate template = templates.findAllByJobPositionId(job.getId()).stream()
                .filter(candidate -> candidate.isEnabled() && intent.equals(candidate.getIntent()))
                .findFirst().orElse(null);
        if (template == null) return Optional.empty();
        Map<String, String> facts = facts(job);
        for (String key : template.getRequiredFactKeys().split(",")) {
            if (!facts.containsKey(key) || facts.get(key).isBlank()) return Optional.empty();
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
        String intent = detectSocialIntent(message);
        if (intent == null) return Optional.empty();
        JobReplyTemplate template = templates.findAllByJobPositionId(job.getId()).stream()
                .filter(candidate -> candidate.isEnabled() && intent.equals(candidate.getIntent()))
                .findFirst().orElse(null);
        if (template == null || !template.getRequiredFactKeys().isBlank()) return Optional.empty();
        return Optional.of(new RenderedReply(intent, template.getTemplateText(),
                "已命中岗位社交模板，可选用轻量 AI 仅润色语气"));
    }

    static String detectFixedIntent(String message) {
        String value = message.replaceAll("\\s+", " ").trim();
        List<String> matches = new java.util.ArrayList<>();
        if (SALARY.matcher(value).find()) matches.add("SALARY");
        if (LOCATION.matcher(value).find()) matches.add("LOCATION");
        if (RESPONSIBILITIES.matcher(value).find()) matches.add("RESPONSIBILITIES");
        if (WORK_TIME.matcher(value).find()) matches.add("WORK_TIME");
        if (BENEFITS.matcher(value).find()) matches.add("BENEFITS");
        if (EXPERIENCE.matcher(value).find()) matches.add("EXPERIENCE");
        if (EDUCATION.matcher(value).find()) matches.add("EDUCATION");
        return matches.size() == 1 ? matches.getFirst() : null;
    }

    static String detectSocialIntent(String message) {
        String value = message.replaceAll("\\s+", " ").trim();
        if (RESUME_SENT.matcher(value).find()) return "RESUME_SENT";
        if (RESUME_WILL_SEND.matcher(value).find()) return "RESUME_WILL_SEND";
        if (DECLINE.matcher(value).find()) return "CANDIDATE_DECLINE";
        if (CONSIDERING.matcher(value).find()) return "CANDIDATE_CONSIDERING";
        if (CLOSING.matcher(value).find()) return "CONVERSATION_CLOSING";
        if (SOCIAL_THANKS.matcher(value).matches()) return "SOCIAL_THANKS";
        if (SOCIAL_GREETING.matcher(value).matches()) return "SOCIAL_GREETING";
        if (SOCIAL_ACK.matcher(value).matches()) return "SOCIAL_ACKNOWLEDGEMENT";
        return null;
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
        return facts;
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
