package ai.xzkj.recruitment.autoreply;

import org.springframework.data.jpa.repository.*;
import java.util.*;

public interface AutoReplyAttemptRepository extends JpaRepository<AutoReplyAttempt, UUID> {
    @EntityGraph(attributePaths={"policy","bossAccount","bossAccount.company","bossAccount.capabilities","contact","contact.candidate","contact.jobPosition","inboundMessage","outboundMessage"})
    Optional<AutoReplyAttempt> findWithDetailsById(UUID id);
    @EntityGraph(attributePaths={"bossAccount","bossAccount.company","contact","contact.candidate","contact.jobPosition","outboundMessage"})
    List<AutoReplyAttempt> findTop100ByOrderByCreatedAtDesc();
    Optional<AutoReplyAttempt> findFirstByContactIdOrderByCreatedAtDesc(UUID contactId);
}
