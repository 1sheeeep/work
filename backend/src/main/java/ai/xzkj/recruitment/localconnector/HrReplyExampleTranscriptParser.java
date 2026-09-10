package ai.xzkj.recruitment.localconnector;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Parses only the clipboard format emitted by the local browser bridge. */
final class HrReplyExampleTranscriptParser {
    private static final Pattern JOB = Pattern.compile("^岗位[：:]\\s*(.+)$");
    private static final Pattern MESSAGE = Pattern.compile("^(?:\\[[^]]{1,40}]\\s*)?(候选人|HR)[：:]\\s*(.+)$");

    private HrReplyExampleTranscriptParser() { }

    static ParsedTranscript parse(String raw) {
        String jobTitle = null;
        List<String> candidateTurns = new ArrayList<>();
        List<Pair> pairs = new ArrayList<>();
        for (String rawLine : raw.replace('\r', '\n').split("\\n")) {
            String line = clean(rawLine, 4500);
            if (line.isBlank()) continue;
            Matcher job = JOB.matcher(line);
            if (job.matches()) { jobTitle = clean(job.group(1), 120); continue; }
            Matcher message = MESSAGE.matcher(line);
            if (!message.matches()) continue;
            String speaker = message.group(1);
            String text = clean(message.group(2), 4000);
            if (text.isBlank()) continue;
            if ("候选人".equals(speaker)) candidateTurns.add(text);
            else if (!candidateTurns.isEmpty()) {
                pairs.add(new Pair(String.join("\n", candidateTurns), text));
                candidateTurns.clear();
            }
        }
        return new ParsedTranscript(jobTitle, pairs);
    }

    static String redact(String value, int max) {
        return clean(value, max)
                .replaceAll("(?<!\\d)1[3-9]\\d{9}(?!\\d)", "[手机号已脱敏]")
                .replaceAll("(?i)[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}", "[邮箱已脱敏]")
                .replaceAll("(?<!\\d)\\d{17}[\\dXx](?!\\d)", "[身份证号已脱敏]")
                .replaceAll("(?i)((?:微信|微 信|v信|wx)\\s*[:：]?\\s*)[A-Z][A-Z0-9_-]{5,19}", "$1[微信号已脱敏]");
    }

    private static String clean(String value, int max) {
        String text = value == null ? "" : value.replace('\u0000', ' ').replaceAll("\\s+", " ").trim();
        return text.substring(0, Math.min(max, text.length()));
    }

    record ParsedTranscript(String jobTitle, List<Pair> pairs) { }
    record Pair(String candidateMessage, String hrReply) { }
}
