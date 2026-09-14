package ai.xzkj.recruitment.localconnector;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import jakarta.persistence.LockModeType;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

interface InboundAiReplyTaskRepository extends JpaRepository<InboundAiReplyTask, UUID> {
    Optional<InboundAiReplyTask> findByAccountIdAndChatDigestAndMessageDigest(UUID accountId,String chatDigest,String messageDigest);
    Optional<InboundAiReplyTask> findFirstByAccountIdAndStatusOrderByCreatedAtAsc(UUID accountId,String status);
    List<InboundAiReplyTask> findTop100ByStatusOrderByCreatedAtAsc(String status);
    List<InboundAiReplyTask> findTop100ByAccountIdAndStatusAndSendStatusOrderByUpdatedAtAsc(UUID accountId,String status,String sendStatus);
    List<InboundAiReplyTask> findTop100ByAccountIdAndSendStatusOrderByUpdatedAtAsc(UUID accountId,String sendStatus);
    @Query(value = """
            SELECT task.*
              FROM inbound_ai_reply_tasks task
             WHERE task.account_id = :accountId
               AND task.safe_replay_count < 1
               AND (
                    (task.send_status = 'FAILED' AND task.status = 'COMPLETED' AND task.reply_allowed = TRUE)
                    OR
                    (task.send_status = 'SKIPPED' AND (
                        (task.status = 'FAILED' AND task.last_error_code IN (
                            'AI_OUTPUT_INVALID', 'INBOUND_REPLY_AI_REQUEST_FAILED', 'INBOUND_REPLY_AI_TIMEOUT',
                            'INBOUND_REPLY_AI_INVALID', 'INBOUND_REPLY_AI_INVALID_RESULT',
                            'INBOUND_REPLY_AI_OUTPUT_MISSING', 'INBOUND_REPLY_AI_RATE_LIMITED',
                            'INBOUND_REPLY_AI_UPSTREAM_5XX'))
                        OR
                        (task.status = 'COMPLETED' AND (
                            (task.category = 'INTERVIEW_COORDINATION' AND task.message_text IS NOT NULL)
                            OR
                            task.result_reason LIKE 'AI 回复未通过%'
                            OR task.result_reason LIKE 'AI 社交回复未通过%'
                            OR task.result_reason LIKE 'AI 澄清问题未通过%'
                            OR task.result_reason LIKE '无法可靠判断消息意图%'
                            OR task.result_reason LIKE 'AI 判断该消息需要人工复核%'
                            OR task.result_reason LIKE '正常静默：%'))
                    ))
               )
             ORDER BY task.updated_at ASC
             LIMIT 100
            """, nativeQuery = true)
    List<InboundAiReplyTask> findSafeReplayInventory(@Param("accountId") UUID accountId);
    List<InboundAiReplyTask> findByStatusAndStartedAtBefore(String status, Instant cutoff);
    List<InboundAiReplyTask> findTop100ByStatusAndNextAttemptAtBeforeOrderByNextAttemptAtAsc(String status,Instant cutoff);
    boolean existsByAccountIdAndStatus(UUID accountId,String status);
    long countByStatus(String status);
    long countByAccountIdAndStatusIn(UUID accountId,List<String> statuses);
    long countByStatusIn(List<String> statuses);
    long countBySendStatus(String sendStatus);
    long countByAccountIdAndSendStatus(UUID accountId,String sendStatus);
    long countByAccountIdAndSendStatusAndSendCompletedAtAfter(UUID accountId,String sendStatus,Instant cutoff);
    List<InboundAiReplyTask> findTop100BySendStatusOrderBySendCompletedAtDesc(String sendStatus);
    List<InboundAiReplyTask> findTop100BySendStatusOrderByCompletedAtDesc(String sendStatus);
    List<InboundAiReplyTask> findTop500ByCompletedAtAfterOrderByCompletedAtDesc(Instant cutoff);
    List<InboundAiReplyTask> findTop500ByUpdatedAtAfterOrderByUpdatedAtDesc(Instant cutoff);
    @Lock(LockModeType.PESSIMISTIC_WRITE) Optional<InboundAiReplyTask> findForUpdateById(UUID id);
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<InboundAiReplyTask> findForUpdateBySendLeaseTokenHash(String tokenHash);
    List<InboundAiReplyTask> findBySendStatusAndSendLeaseUntilBefore(String status,Instant cutoff);
}
