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
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<InboundAiReplyTask> findFirstByAccountIdAndStatusOrderByCreatedAtAsc(UUID accountId,String status);
    List<InboundAiReplyTask> findTop100ByStatusOrderByCreatedAtAsc(String status);
    List<InboundAiReplyTask> findTop100ByAccountIdAndStatusAndSendStatusOrderByUpdatedAtAsc(UUID accountId,String status,String sendStatus);
    List<InboundAiReplyTask> findTop100ByAccountIdAndSendStatusOrderByUpdatedAtAsc(UUID accountId,String sendStatus);
    List<InboundAiReplyTask> findTop500ByAccountIdAndChatDigestAndSendStatusOrderBySendCompletedAtDesc(
            UUID accountId, String chatDigest, String sendStatus);
    @Query(value = """
            SELECT task.*
              FROM inbound_ai_reply_tasks task
             WHERE task.account_id = :accountId
               AND (
                    (task.safe_replay_count < 1 AND (
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
                            (task.category = 'INTERVIEW_COORDINATION' AND task.message_text IS NOT NULL AND (
                                task.message_text LIKE '%取消%面试%'
                                OR task.message_text LIKE '%面试%取消%'
                                OR task.message_text LIKE '%不参加%面试%'
                                OR task.message_text LIKE '%去不了%面试%'
                                OR task.message_text LIKE '%无法%参加%面试%'
                                OR task.message_text LIKE '%不能%参加%面试%'
                                OR task.message_text LIKE '%没法%参加%面试%'))
                            OR
                            task.result_reason LIKE 'AI 回复未通过独立意图校验%'
                            OR task.result_reason LIKE 'AI 回复未通过独立质量校验%'
                            OR task.result_reason LIKE 'AI 社交回复未通过安全校验%'
                            OR task.result_reason LIKE 'AI 澄清问题未通过安全校验%'))
                    ))))
                    OR
                    (task.safe_replay_count < 2
                        AND task.status = 'COMPLETED'
                        AND task.send_status = 'SKIPPED'
                        AND task.send_result_reason = '会话已由 HR 处理或已不再处于候选人未读状态，待发送回复已安全作废'
                        AND (task.category IS DISTINCT FROM 'INTERVIEW_COORDINATION' OR (
                            task.message_text LIKE '%取消%面试%'
                            OR task.message_text LIKE '%面试%取消%'
                            OR task.message_text LIKE '%不参加%面试%'
                            OR task.message_text LIKE '%去不了%面试%'
                            OR task.message_text LIKE '%无法%参加%面试%'
                            OR task.message_text LIKE '%不能%参加%面试%'
                            OR task.message_text LIKE '%没法%参加%面试%'))
                        AND task.updated_at >= CURRENT_TIMESTAMP - INTERVAL '2 days')
               )
             ORDER BY task.updated_at ASC
             LIMIT 100
            """, nativeQuery = true)
    List<InboundAiReplyTask> findSafeReplayInventory(@Param("accountId") UUID accountId);
    List<InboundAiReplyTask> findTop100ByStatusAndStartedAtBeforeOrderByStartedAtAsc(String status, Instant cutoff);
    List<InboundAiReplyTask> findTop100ByStatusAndNextAttemptAtBeforeOrderByNextAttemptAtAsc(String status,Instant cutoff);
    boolean existsByAccountIdAndStatus(UUID accountId,String status);
    long countByStatus(String status);
    long countByQueueLane(String queueLane);
    long countByAccountIdAndQueueLane(UUID accountId, String queueLane);
    long countByAccountIdAndStatusIn(UUID accountId,List<String> statuses);
    long countByStatusIn(List<String> statuses);
    long countBySendStatus(String sendStatus);
    long countByAccountIdAndSendStatus(UUID accountId,String sendStatus);
    long countByAccountIdAndSendStatusAndSendCompletedAtAfter(UUID accountId,String sendStatus,Instant cutoff);
    List<InboundAiReplyTask> findTop100BySendStatusOrderBySendCompletedAtDesc(String sendStatus);
    List<InboundAiReplyTask> findTop100BySendStatusOrderByCompletedAtDesc(String sendStatus);
    List<InboundAiReplyTask> findTop100BySendStatusAndCompletedAtBeforeOrderByCompletedAtAsc(String sendStatus,Instant cutoff);
    List<InboundAiReplyTask> findTop500ByCompletedAtAfterOrderByCompletedAtDesc(Instant cutoff);
    List<InboundAiReplyTask> findTop500ByUpdatedAtAfterOrderByUpdatedAtDesc(Instant cutoff);
    @Query(value = """
            SELECT task.*
              FROM inbound_ai_reply_tasks task
             WHERE task.send_status = 'SKIPPED'
               AND COALESCE(task.send_completed_at, task.completed_at, task.updated_at) >= :from
               AND COALESCE(task.send_completed_at, task.completed_at, task.updated_at) < :to
             ORDER BY COALESCE(task.send_completed_at, task.completed_at, task.updated_at) DESC
             LIMIT 500
            """, nativeQuery = true)
    List<InboundAiReplyTask> findRecentSkippedDutyEvents(@Param("from") Instant from, @Param("to") Instant to);
    @Query(value = """
            SELECT task.*
              FROM inbound_ai_reply_tasks task
             WHERE COALESCE(task.send_completed_at, task.completed_at, task.updated_at) >= :from
               AND COALESCE(task.send_completed_at, task.completed_at, task.updated_at) < :to
             ORDER BY COALESCE(task.send_completed_at, task.completed_at, task.updated_at) DESC
             LIMIT 500
            """, nativeQuery = true)
    List<InboundAiReplyTask> findRecentDutyEvents(@Param("from") Instant from, @Param("to") Instant to);
    @Lock(LockModeType.PESSIMISTIC_WRITE) Optional<InboundAiReplyTask> findForUpdateById(UUID id);
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<InboundAiReplyTask> findForUpdateBySendLeaseTokenHash(String tokenHash);
    List<InboundAiReplyTask> findTop100BySendStatusAndSendLeaseUntilBeforeOrderBySendLeaseUntilAsc(String status,Instant cutoff);
}
