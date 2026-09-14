package ai.xzkj.recruitment.jobs;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/** Shared matcher for deterministic job facts and social reply templates. */
public final class JobReplyIntentMatcher {
    private static final Pattern SALARY = Pattern.compile("(薪资|工资|月薪|年薪|底薪|提成|多少钱|薪酬|待遇)");
    private static final Pattern LOCATION = Pattern.compile("(工作地址|上班地址|工作地点|上班地点|办公地址|在哪里上班|在哪上班|工作地)");
    private static final Pattern RESPONSIBILITIES = Pattern.compile("(工作内容|主要做什么|主要负责|岗位职责|职责是什么|平时做什么|日常工作|干什么|干嘛)");
    private static final Pattern WORK_TIME = Pattern.compile("(上班时间|工作时间|上下班时间|几点上班|几点下班|打卡时间|休息时间|月休|休息几天|每周休息|单双休|大小周)");
    private static final Pattern WORK_SCHEDULE_REASON = Pattern.compile("(?:(?:为什么|为何|什么原因).{0,12}(?:上班|下班|开始|下午|上午|早上|晚上|中午)|(?:下午|上午|早上|晚上|中午).{0,8}(?:开始)?上班)");
    private static final Pattern BENEFITS = Pattern.compile("(福利待遇|福利|五险一金|五险|社保|公积金|补贴|奖金|年终奖|带薪年假)");
    private static final Pattern MEALS_LODGING = Pattern.compile("(吃住|食宿|住宿|宿舍|租房|住房|包吃|包住)");
    private static final Pattern EXPERIENCE = Pattern.compile("(经验要求|需要经验|工作经验|几年经验|无经验|没有经验|没经验|应届生|应届毕业)");
    private static final Pattern EDUCATION = Pattern.compile("(学历要求|学历|什么学历|大专|本科|中专|高中|硕士|博士)");
    private static final Pattern SOCIAL_GREETING = Pattern.compile("^(?:你?好|哈喽|hello|hi)[啊呀呢哈哦的了～~。！!，,\\s]*$", Pattern.CASE_INSENSITIVE);
    private static final Pattern SOCIAL_THANKS = Pattern.compile("^(?:谢谢|感谢|多谢)[啊呀呢哈哦的了～~。！!，,\\s]*$");
    private static final Pattern SOCIAL_ACK = Pattern.compile("^(?:好的?|好哒|好嘿|好滴|嗯+|收到|知道了|晓得了|明白了|了解了?|可以|行|没问题|ok(?:ay)?)[啊呀呢哈哦的了～~。！!，,\\s]*$", Pattern.CASE_INSENSITIVE);
    private static final Pattern CONSIDERING = Pattern.compile("(考虑一下|再看看|想一想|先了解一下|回去考虑)");
    private static final Pattern RESUME_WILL_SEND = Pattern.compile("(?:(?:稍后|晚点|一会儿|马上|这就).{0,4}(?:发|发送|投递|上传).{0,6}简历|可以.{0,8}发.{0,4}简历)");
    private static final Pattern RESUME_SENT = Pattern.compile("(?:(?:已|已经|刚刚?|刚才).{0,6}(?:发|发送|投递|上传).{0,6}简历|简历.{0,8}(?:发了|发送了|已发|投递了|上传了))");
    private static final Pattern DECLINE = Pattern.compile("((?:抱歉|不好意思).{0,30}(?:不考虑|不方便|无法|不能|不去|不参加|面试|入职|距离|加班)|不考虑|不再考虑|不在考虑范围|不太合适|不合适|暂时不考虑|没兴趣|不感兴趣|无法接受|不方便入职|不想入职|不考虑入职|距离太远|办公地点太远|加班太晚)");
    private static final Pattern CLOSING = Pattern.compile("(再见|拜拜|晚安|先这样|回头联系)");

    private JobReplyIntentMatcher() {}

    public static String detectFixedIntent(String message) {
        String value = normalize(message);
        if (value.isBlank()) return null;
        List<String> matches = new ArrayList<>();
        if (SALARY.matcher(value).find()) matches.add("SALARY");
        if (LOCATION.matcher(value).find()) matches.add("LOCATION");
        if (RESPONSIBILITIES.matcher(value).find()) matches.add("RESPONSIBILITIES");
        if (WORK_TIME.matcher(value).find() || WORK_SCHEDULE_REASON.matcher(value).find()) matches.add("WORK_TIME");
        if (BENEFITS.matcher(value).find()) matches.add("BENEFITS");
        if (MEALS_LODGING.matcher(value).find()) matches.add("MEALS_LODGING");
        if (EXPERIENCE.matcher(value).find()) matches.add("EXPERIENCE");
        if (EDUCATION.matcher(value).find()) matches.add("EDUCATION");
        return matches.size() == 1 ? matches.getFirst() : null;
    }

    public static String detectSocialIntent(String message) {
        String value = normalize(message);
        if (value.isBlank()) return null;
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

    public static boolean isCandidateDecline(String message) {
        return message != null && DECLINE.matcher(normalize(message)).find();
    }

    public static boolean isMealsLodgingQuestion(String message) {
        return message != null && MEALS_LODGING.matcher(normalize(message)).find();
    }

    private static String normalize(String message) {
        return message == null ? "" : message.replaceAll("\\s+", " ").trim();
    }
}
