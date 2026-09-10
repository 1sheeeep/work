package ai.xzkj.recruitment.localconnector;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import jakarta.persistence.LockModeType;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

interface InboundAiReplyTaskRepository extends JpaRepository<InboundAiReplyTask, UUID> {
    Optional<InboundAiReplyTask> findByAccountIdAndChatDigestAndMessageDigest(UUID accountId,String chatDigest,String messageDigest);
    Optional<InboundAiReplyTask> findFirstByAccountIdAndStatusOrderByCreatedAtAsc(UUID accountId,String status);
    List<InboundAiReplyTask> findTop100ByStatusOrderByCreatedAtAsc(String status);
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
    @Lock(LockModeType.PESSIMISTIC_WRITE) Optional<InboundAiReplyTask> findForUpdateById(UUID id);
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<InboundAiReplyTask> findForUpdateBySendLeaseTokenHash(String tokenHash);
    List<InboundAiReplyTask> findBySendStatusAndSendLeaseUntilBefore(String status,Instant cutoff);
}
