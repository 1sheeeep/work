package ai.xzkj.recruitment.candidates;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * 展示层的最后一道幂等保护。
 *
 * BOSS 的历史导出偶尔会为同一条消息生成不同的外部摘要，入库层无法
 * 仅凭 external_message_id 合并。这里仅对同一联系人、同一方向、同一
 * 内容且落在同一分钟的可见消息折叠，保留最早的一条；不会修改数据库。
 */
public final class ConversationMessageDeduplicator {
    private ConversationMessageDeduplicator() { }

    public static List<ConversationMessage> forDisplay(List<ConversationMessage> messages) {
        if (messages == null || messages.size() < 2) return messages == null ? List.of() : messages;
        Set<String> seen = new HashSet<>();
        List<ConversationMessage> result = new ArrayList<>(messages.size());
        for (ConversationMessage message : messages) {
            if (message == null) continue;
            if (seen.add(key(message))) result.add(message);
        }
        return result;
    }

    private static String key(ConversationMessage message) {
        Instant at = message.getCreatedAt();
        long minute = at == null ? Long.MIN_VALUE : Math.floorDiv(at.getEpochSecond(), 60);
        String source = message.getExternalMessageId() != null
                && message.getExternalMessageId().startsWith("ai-task:") ? "AI" : "BOSS";
        String content = normalize(message.getContent());
        return source + '|' + message.getDirection() + '|' + minute + '|' + content;
    }

    private static String normalize(String value) {
        if (value == null) return "";
        return value.replaceAll("(?:已?送达|已读|未读|发送中|发送失败|发送成功)", "")
                .replaceAll("\\s+", " ").trim();
    }
}
