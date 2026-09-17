package ai.xzkj.recruitment.candidates;

import ai.xzkj.recruitment.boss.BossAccount;
import ai.xzkj.recruitment.jobs.JobPosition;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * 将浏览器观测到的真实沟通和 AI 生成的回复写入人才库时间线。
 * 外部摘要只用于幂等键，不把页面 Cookie、URL 或文件路径写入时间线。
 */
@Service
public class ConversationTimelineService {
    private static final String BOSS_MESSAGE_PREFIX = "boss:";
    private static final String AI_MESSAGE_PREFIX = "ai-task:";

    public record HistoryMessage(String messageDigest, MessageDirection direction, String content, Instant messageAt) { }
    public record HistoryImportResult(int created, int duplicates, int skipped) { }

    private final CandidateProfileRepository candidates;
    private final CandidateJobContactRepository contacts;
    private final ConversationMessageRepository messages;
    private final CandidateIdentityService identity;

    public ConversationTimelineService(CandidateProfileRepository candidates,
                                       CandidateJobContactRepository contacts,
                                       ConversationMessageRepository messages) {
        this(candidates, contacts, messages, null);
    }

    @Autowired
    public ConversationTimelineService(CandidateProfileRepository candidates,
                                       CandidateJobContactRepository contacts,
                                       ConversationMessageRepository messages,
                                       CandidateIdentityService identity) {
        this.candidates = candidates;
        this.contacts = contacts;
        this.messages = messages;
        this.identity = identity;
    }

    /**
     * 保存当前详情页最后一条真实消息。重复观测只会命中外部消息幂等键。
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void recordObservedMessage(BossAccount account, JobPosition job, String chatDigest,
                                      String messageDigest, MessageDirection direction, String content,
                                      Instant messageAt) {
        if (!validScope(account, job) || blank(chatDigest) || blank(messageDigest)
                || direction == null || blank(content)) return;
        CandidateJobContact contact = resolveContact(account, job, chatDigest, content);
        String externalId = BOSS_MESSAGE_PREFIX + messageDigest;
        if (messages.findByContactIdAndExternalMessageId(contact.getId(), externalId).isPresent()) return;
        messages.save(new ConversationMessage(contact, externalId, direction,
                direction == MessageDirection.INBOUND ? MessageSenderType.CANDIDATE : MessageSenderType.HR,
                direction == MessageDirection.INBOUND ? MessageDeliveryStatus.RECEIVED : MessageDeliveryStatus.SENT,
                    bounded(cleanConversationContent(content)), null, null, null, safeTime(messageAt)));
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public HistoryImportResult recordObservedMessages(BossAccount account, JobPosition job, String chatDigest,
                                                       List<HistoryMessage> history, Instant observedAt,
                                                       boolean completeCapture) {
        if (!validScope(account, job) || blank(chatDigest) || history == null || history.isEmpty()) {
            return new HistoryImportResult(0, 0, history == null ? 0 : history.size());
        }
        CandidateJobContact contact = resolveContact(account, job, chatDigest, null);
        List<ConversationMessage> existing = new ArrayList<>(messages.findByContactIdOrderByCreatedAtAsc(contact.getId()));
        List<ConversationMessage> previouslyVisibleBoss = existing.stream()
                .filter(message -> message.getExternalMessageId().startsWith(BOSS_MESSAGE_PREFIX))
                .filter(message -> message.getSupersededAt() == null).toList();
        Set<UUID> capturedBossIds = new HashSet<>();
        int created = 0, duplicates = 0, skipped = 0;
        for (HistoryMessage item : history) {
            if (item == null || blank(item.messageDigest()) || item.direction() == null || blank(item.content())) { skipped++; continue; }
            String externalId = BOSS_MESSAGE_PREFIX + item.messageDigest();
            String content = bounded(cleanConversationContent(item.content()));
            if (content.isBlank()) { skipped++; continue; }
            Instant at = safeTime(item.messageAt() == null ? observedAt : item.messageAt());
            ConversationMessage match = existing.stream()
                    .filter(message -> message.getExternalMessageId().equals(externalId))
                    .findFirst().orElse(null);
            if (match == null) {
                // BOSS does not always expose a stable per-message DOM id. A detail
                // snapshot and the full transcript may therefore hash the same
                // turn differently. Match one occurrence at a time, never every
                // message that happens to have the same text and minute.
                match = existing.stream()
                        .filter(message -> message.getExternalMessageId().startsWith(BOSS_MESSAGE_PREFIX))
                        .filter(message -> !capturedBossIds.contains(message.getId()))
                        .filter(message -> sameTurn(message, item.direction(), content, at, false))
                        .findFirst().orElse(null);
            }
            if (match != null) {
                if (capturedBossIds.add(match.getId())) match.restore();
                duplicates++;
                continue;
            }
            ConversationMessage added = messages.save(new ConversationMessage(contact, externalId, item.direction(),
                    item.direction() == MessageDirection.INBOUND ? MessageSenderType.CANDIDATE : MessageSenderType.HR,
                    item.direction() == MessageDirection.INBOUND ? MessageDeliveryStatus.RECEIVED : MessageDeliveryStatus.SENT,
                    content, null, null, null, at));
            existing.add(added);
            capturedBossIds.add(added.getId());
            created++;
        }
        // A scroll container can appear complete while BOSS has only mounted a
        // subset of older turns. Never hide old rows unless the new capture
        // independently covers every previously visible real BOSS turn.
        boolean coversPreviousTurns = previouslyVisibleBoss.stream().allMatch(previous -> existing.stream()
                .filter(message -> capturedBossIds.contains(message.getId()))
                .anyMatch(message -> sameTurn(message, previous.getDirection(),
                        cleanConversationContent(previous.getContent()), previous.getCreatedAt(), true)));
        if (completeCapture && skipped == 0 && coversPreviousTurns) {
            Instant reconciledAt = Instant.now();
            for (ConversationMessage message : existing) {
                if (message.getExternalMessageId().startsWith(BOSS_MESSAGE_PREFIX)
                        && !capturedBossIds.contains(message.getId())) message.supersede(reconciledAt);
            }
            reconcileSentAiRows(existing, capturedBossIds, reconciledAt);
        }
        return new HistoryImportResult(created, duplicates, skipped);
    }

    private void reconcileSentAiRows(List<ConversationMessage> existing, Set<UUID> capturedBossIds, Instant at) {
        Set<UUID> pairedBossIds = new HashSet<>();
        existing.stream().filter(message -> message.getExternalMessageId().startsWith(AI_MESSAGE_PREFIX))
                .filter(message -> message.getDeliveryStatus() == MessageDeliveryStatus.SENT)
                .sorted(Comparator.comparing(ConversationMessage::getCreatedAt))
                .forEach(ai -> {
                    Instant sentAt = ai.getApprovedAt() == null ? ai.getCreatedAt() : ai.getApprovedAt();
                    ConversationMessage observed = existing.stream()
                            .filter(message -> capturedBossIds.contains(message.getId()))
                            .filter(message -> !pairedBossIds.contains(message.getId()))
                            .filter(message -> message.getDirection() == MessageDirection.OUTBOUND)
                            .filter(message -> cleanConversationContent(message.getContent()).equals(cleanConversationContent(ai.getContent())))
                            .filter(message -> Math.abs(Duration.between(message.getCreatedAt(), sentAt).toSeconds()) <= 120)
                            .min(Comparator.comparingLong(message -> Math.abs(Duration.between(message.getCreatedAt(), sentAt).toSeconds())))
                            .orElse(null);
                    if (observed == null) ai.restore();
                    else {
                        pairedBossIds.add(observed.getId());
                        ai.supersede(at);
                    }
                });
    }

    private boolean sameTurn(ConversationMessage message, MessageDirection direction, String content, Instant at,
                             boolean allowBossMinuteDrift) {
        return message.getDirection() == direction
                && cleanConversationContent(message.getContent()).equals(content)
                && (message.getCreatedAt().equals(at) || allowBossMinuteDrift
                && Math.abs(Duration.between(message.getCreatedAt(), at).toSeconds()) <= 120);
    }

    /** 保存 AI 允许发送的回复，发送前状态为待发送，避免伪造已发送结果。 */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void recordAiReply(UUID accountId, UUID jobId, String chatDigest, UUID taskId,
                             boolean replyAllowed, String content, Instant createdAt,
                             JobPosition job) {
        if (!replyAllowed || blank(content)
                || taskId == null || !validScope(job == null ? null : job.getBossAccount(), job)) return;
        BossAccount account = job.getBossAccount();
        if (!account.getId().equals(accountId) || !job.getId().equals(jobId) || blank(chatDigest)) return;
        CandidateJobContact contact = resolveContact(account, job, chatDigest, null);
        String externalId = AI_MESSAGE_PREFIX + taskId;
        if (messages.findByContactIdAndExternalMessageId(contact.getId(), externalId).isPresent()) return;
        messages.save(new ConversationMessage(contact, externalId, MessageDirection.OUTBOUND,
                MessageSenderType.AI, MessageDeliveryStatus.PENDING_REVIEW, bounded(content),
                "inbound-reply", "inbound-reply-v1", null, safeTime(createdAt)));
    }

    /** 将一次性发送回执映射到人才库时间线；UNKNOWN 保持待发送，禁止伪造成功或失败。 */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void recordAiSendReceipt(UUID accountId, UUID jobId, String chatDigest, UUID taskId,
                                    String outcome, JobPosition job) {
        if (taskId == null || !validScope(job == null ? null : job.getBossAccount(), job)
                || !job.getBossAccount().getId().equals(accountId) || blank(chatDigest)) return;
        CandidateJobContact contact = resolveContact(job.getBossAccount(), job, chatDigest, null);
        messages.findByContactIdAndExternalMessageId(contact.getId(), AI_MESSAGE_PREFIX + taskId)
                .ifPresent(message -> {
                    if ("SUCCEEDED".equals(outcome)) message.sent();
                    else if ("FAILED".equals(outcome)) message.failed();
                });
    }

    private CandidateJobContact resolveContact(BossAccount account, JobPosition job, String chatDigest, String observedText) {
        CandidateProfile profile = identity == null
                ? candidates.findByCompanyIdAndSourceAndDedupKey(account.getCompany().getId(), CandidateSource.BOSS, chatDigest)
                    .orElseGet(() -> candidates.save(new CandidateProfile(account.getCompany(), CandidateSource.BOSS,
                            chatDigest, "匿名候选人 " + chatDigest.substring(0, Math.min(8, chatDigest.length())),
                            null, null, null, null)))
                : identity.resolve(account.getCompany(), CandidateSource.BOSS, chatDigest,
                    "匿名候选人 " + chatDigest.substring(0, Math.min(8, chatDigest.length())),
                    null, null, null, null, identity.extractPhone(observedText), identity.extractEmail(observedText));
        return contacts.findByCandidateIdAndJobPositionId(profile.getId(), job.getId())
                .orElseGet(() -> contacts.save(new CandidateJobContact(profile, job, account)));
    }

    private boolean validScope(BossAccount account, JobPosition job) {
        return account != null && job != null && job.getBossAccount() != null
                && account.getId().equals(job.getBossAccount().getId())
                && account.getCompany() != null && job.getCompany() != null
                && account.getCompany().getId().equals(job.getCompany().getId());
    }

    private Instant safeTime(Instant value) { return value == null ? Instant.now() : value; }
    private boolean blank(String value) { return value == null || value.isBlank(); }
    private String bounded(String value) {
        String clean = value.replace('\n', ' ').replace('\r', ' ').trim();
        return clean.substring(0, Math.min(4000, clean.length()));
    }

    private String cleanConversationContent(String value) {
        if (value == null) return "";
        return value.replaceAll("(?:^|[\\s|｜·•])(已?送达|已读|未读|发送中|发送失败|发送成功|点击预览附件简历)(?=$|[\\s|｜·•])", " ")
                .replaceAll("\\s{2,}", " ").trim();
    }
}
