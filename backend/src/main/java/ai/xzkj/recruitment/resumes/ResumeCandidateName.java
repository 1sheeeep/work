package ai.xzkj.recruitment.resumes;

import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 简历姓名的保守识别与证据校验。
 *
 * 姓名只有在简历正文中能够被原文严格验证时才允许写入人才档案；
 * 无法验证时继续使用会话摘要匿名名，避免把学校、岗位或地区误当成姓名。
 */
final class ResumeCandidateName {
    private static final Pattern LABELED_HAN_NAME = Pattern.compile(
            "(?:姓\\s*名|候选人\\s*姓\\s*名|真\\s*实\\s*姓\\s*名)\\s*[:：]\\s*([\\p{IsHan}·]{2,20})");
    private static final Pattern LABELED_ENGLISH_NAME = Pattern.compile(
            "(?i)(?:name|candidate\\s*name)\\s*[:：]\\s*([A-Za-z][A-Za-z .'-]{1,80})");
    private static final Pattern HAN_NAME = Pattern.compile("[\\p{IsHan}·]{2,20}");
    private static final Pattern SHORT_HAN_NAME = Pattern.compile("[\\p{IsHan}·]{2,4}");
    private static final Pattern ENGLISH_NAME = Pattern.compile("[A-Za-z][A-Za-z .'-]{1,80}");
    private static final Set<String> FIELD_TOKENS = Set.of(
            "姓", "名", "姓名", "候选人", "候选人姓名", "真实", "真实姓名",
            "民", "族", "民族", "性", "别", "性别", "电", "话", "电话",
            "邮", "箱", "邮箱", "住", "址", "住址", "出生", "出生年月", "身高",
            "政治", "政治面貌", "就读", "就读院校", "院校", "专业", "学历", "籍贯");
    private static final Set<String> NON_NAME_VALUES = Set.of(
            "汉族", "少数民族", "群众", "党员", "团员", "男", "女", "本科", "大专", "硕士", "博士",
            "应届", "实习", "全职", "电话", "邮箱", "地址", "未知", "暂无", "无");

    private ResumeCandidateName() {}

    static String recognize(String text) {
        if (text == null || text.isBlank()) return null;
        Matcher labeled = LABELED_HAN_NAME.matcher(text);
        if (labeled.find()) return cleanDisplayName(labeled.group(1));
        Matcher english = LABELED_ENGLISH_NAME.matcher(text);
        if (english.find()) return cleanDisplayName(english.group(1));

        // OCR 常把“姓名”拆成“姓 名”，甚至把基本字段全部排在姓名值之前。
        // 只有在前面已经出现姓名/基本信息字段时，才从短中文 token 中取候选名。
        String[] tokens = text.replace('\u0000', ' ')
                .replaceAll("[：:|｜,，;；。]", " ")
                .split("\\s+");
        boolean nameLabelSeen = false;
        int fieldScore = 0;
        for (String raw : tokens) {
            String token = raw.trim();
            if (token.isBlank()) continue;
            if (FIELD_TOKENS.contains(token)) {
                fieldScore++;
                if ("姓".equals(token) || "姓名".equals(token)
                        || "候选人姓名".equals(token) || "真实姓名".equals(token)) {
                    nameLabelSeen = true;
                }
                continue;
            }
            if (nameLabelSeen && fieldScore >= 1 && SHORT_HAN_NAME.matcher(token).matches()
                    && !NON_NAME_VALUES.contains(token)) {
                return cleanDisplayName(token);
            }
        }

        // 另一类常见 PDF 会将姓名单独放在开头一行，保留原先的严格规则作为兜底。
        String[] lines = text.replace('\u0000', ' ').replace('\r', '\n').split("\\n");
        for (int i = 0; i < Math.min(lines.length, 20); i++) {
            String line = lines[i].replaceAll("[\\t ]+", " ").trim();
            if (SHORT_HAN_NAME.matcher(line).matches() && !NON_NAME_VALUES.contains(line)
                    && !FIELD_TOKENS.contains(line)) return cleanDisplayName(line);
        }
        return null;
    }

    static String verified(String candidateName, String resumeText) {
        String clean = cleanDisplayName(candidateName);
        if (!isUsable(clean) || resumeText == null || resumeText.isBlank()) return null;
        String compactName = compact(clean);
        String compactText = compact(resumeText);
        return compactText.contains(compactName) ? clean : null;
    }

    static boolean isAnonymousPlaceholder(String value) {
        String clean = value == null ? "" : value.trim();
        return clean.isBlank() || clean.startsWith("匿名候选人") || clean.startsWith("已匿名候选人")
                || clean.equals("匿名") || clean.equalsIgnoreCase("unknown");
    }

    private static String cleanDisplayName(String value) {
        if (value == null) return "";
        String clean = value.replace('\n', ' ').replace('\r', ' ').trim().replaceAll("\\s+", " ");
        String compactHan = clean.replaceAll("\\s+", "");
        if (compactHan.matches("[\\p{IsHan}·]+")) return compactHan;
        return clean;
    }

    private static boolean isUsable(String value) {
        if (value.isBlank() || isAnonymousPlaceholder(value)) return false;
        if (value.contains("候选人") || value.contains("姓名") || value.contains("unknown")) return false;
        return HAN_NAME.matcher(value).matches() || ENGLISH_NAME.matcher(value).matches();
    }

    private static String compact(String value) {
        return value == null ? "" : value.replaceAll("[\\p{Z}\\s]+", "");
    }
}
