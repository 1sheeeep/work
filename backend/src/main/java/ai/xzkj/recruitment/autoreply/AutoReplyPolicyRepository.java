package ai.xzkj.recruitment.autoreply;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.*;
import org.springframework.data.repository.query.Param;
import java.util.*;

public interface AutoReplyPolicyRepository extends JpaRepository<AutoReplyPolicy, UUID> {
    @EntityGraph(attributePaths={"bossAccount","bossAccount.company","bossAccount.capabilities"})
    List<AutoReplyPolicy> findAllByOrderByCreatedAtDesc();
    @EntityGraph(attributePaths={"bossAccount","bossAccount.company","bossAccount.capabilities"})
    Optional<AutoReplyPolicy> findByBossAccountId(UUID accountId);
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from AutoReplyPolicy p join fetch p.bossAccount a join fetch a.company where p.id=:id")
    Optional<AutoReplyPolicy> findLockedById(@Param("id") UUID id);
}
