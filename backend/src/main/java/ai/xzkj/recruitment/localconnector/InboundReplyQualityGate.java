package ai.xzkj.recruitment.localconnector;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 独立于模型提示词的确定性质量门。只检查可明确判断的错答与机器人话术，
 * 不尝试替代模型理解口语，避免把模糊但正常的招聘沟通再次过度拦截。
 */
final class InboundReplyQualityGate {
    private static final Pattern LOCATION = Pattern.compile("(地址|地点|哪里上班|在哪上班|工作地|办公地)");
    private static final Pattern SALARY = Pattern.compile("(薪资|工资|月薪|年薪|底薪|提成|多少钱)");
    private static final Pattern WORK_TIME = Pattern.compile("(上班时间|工作时间|上下班时间|几点上班|几点下班|打卡时间|休息时间)");
    private static final Pattern BENEFITS = Pattern.compile("(福利待遇|福利|五险一金|社保|公积金|补贴|奖金|年终奖|带薪年假)");
    private static final Pattern EXPERIENCE = Pattern.compile("(经验要求|需要经验|几年经验|没(?:有)?经验|无经验|应届|小白)");
    private static final Pattern EDUCATION = Pattern.compile("(学历|大专|本科|中专|高中|硕士|博士)");
    private static final Pattern RESPONSIBILITIES = Pattern.compile("(做什么|干嘛|职责|工作内容|主要负责|日常工作)");
    private static final Pattern ROBOTIC_OR_META = Pattern.compile(
            "(作为(?:一个)?AI|作为语言模型|根据(?:您)?提供的信息|根据岗位信息|ALLOWED_FACTS|CONVERSATION_STATE|系统提示词|后续安排以招聘人员确认为准|感谢您对本岗位的关注)");
    private static final Pattern EXCESSIVE_PUNCTUATION = Pattern.compile("[!！?？。]{3,}");

    private InboundReplyQualityGate() { }

    static String validateClassification(String rawMessage, InboundJobReplyService.Topic topic) {
        return validateClassification(rawMessage, topic, List.of());
    }

    static String validateClassification(String rawMessage, InboundJobReplyService.Topic topic,
                                         List<String> evidenceKeys) {
        Set<String> explicit = explicitIntents(rawMessage);
        if (explicit.isEmpty()) return null;
        Set<String> modeled = new LinkedHashSet<>();
        modeled.add(topic.category());
        modeled.addAll(topic.secondaryCategories());
        for (String evidence : evidenceKeys) {
            switch (evidence) {
                case "LOCATION", "WORK_ADDRESS" -> modeled.add("LOCATION");
                case "SALARY" -> modeled.add("SALARY");
                case "WORK_TIME" -> modeled.add("WORK_TIME");
                case "BENEFITS" -> modeled.add("BENEFITS");
                case "EXPERIENCE" -> modeled.add("EXPERIENCE");
                case "EDUCATION" -> modeled.add("EDUCATION");
                case "REPLY_SUMMARY", "DESCRIPTION", "KEYWORDS", "RECRUITMENT_TYPE" -> modeled.add("RESPONSIBILITIES");
                default -> { }
            }
        }
        if (!modeled.containsAll(explicit)) {
            Set<String> missing = new LinkedHashSet<>(explicit);
            missing.removeAll(modeled);
            return "最后一条消息包含明确岗位问题，但 AI 未覆盖意图：" + String.join("、", missing);
        }
        if ("NO_REPLY".equals(topic.action()) || "SOCIAL_REPLY".equals(topic.responseMode()))
            return "最后一条消息包含明确岗位问题，不能按纯社交消息静默或回复";
        return null;
    }

    static String validateReply(String rawReply) {
        String reply = normalize(rawReply);
        if (reply.isBlank()) return "允许回复时正文为空";
        if (ROBOTIC_OR_META.matcher(reply).find()) return "回复包含模型元信息或明显模板化话术";
        if (EXCESSIVE_PUNCTUATION.matcher(reply).find()) return "回复包含连续重复标点";
        return null;
    }

    static Set<String> explicitIntents(String rawMessage) {
        String message = normalize(rawMessage);
        Set<String> intents = new LinkedHashSet<>();
        if (LOCATION.matcher(message).find()) intents.add("LOCATION");
        if (SALARY.matcher(message).find()) intents.add("SALARY");
        if (WORK_TIME.matcher(message).find()) intents.add("WORK_TIME");
        if (BENEFITS.matcher(message).find()) intents.add("BENEFITS");
        if (EXPERIENCE.matcher(message).find()) intents.add("EXPERIENCE");
        if (EDUCATION.matcher(message).find()) intents.add("EDUCATION");
        if (RESPONSIBILITIES.matcher(message).find()) intents.add("RESPONSIBILITIES");
        return intents;
    }

    static String reasonCode(InboundJobReplyService.Decision decision) {
        String reason = normalize(decision.reason());
        if (decision.retryable()
                || reason.contains("独立意图校验")
                || reason.contains("独立质量校验")
                || reason.contains("模型未提供事实证据字段")) return "AI_OUTPUT_INVALID";
        if (reason.startsWith("正常静默：")) return "EXPECTED_SILENCE";
        if (reason.startsWith("影子评测：")) return "SHADOW";
        if (reason.contains("事实校验")) return "FACT_VALIDATION";
        if (reason.contains("质量校验") || reason.contains("未覆盖意图")) return "QUALITY_VALIDATION";
        if (reason.contains("置信度")) return "LOW_CONFIDENCE";
        if (reason.contains("敏感") || reason.contains("越权")) return "SENSITIVE";
        if (reason.contains("无关")) return "OFF_TOPIC";
        if (reason.contains("人工") || reason.contains("HR")) return "HUMAN_HANDOFF";
        return decision.replyAllowed() ? "ALLOWED" : "OTHER";
    }

    private static String normalize(String value) {
        return value == null ? "" : value.replace('\u0000', ' ').replaceAll("\\s+", " ").trim();
    }
}
