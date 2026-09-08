package ai.xzkj.recruitment.boss;

import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import jakarta.persistence.LockModeType;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface BossAccountRepository extends JpaRepository<BossAccount, UUID> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<BossAccount> findForUpdateById(UUID id);
    @EntityGraph(attributePaths = {"company", "capabilities"})
    List<BossAccount> findAllByOrderByCreatedAtDesc();

    @EntityGraph(attributePaths = {"company", "capabilities"})
    Optional<BossAccount> findWithDetailsById(UUID id);

    boolean existsByCompanyIdAndExternalIdentifierIgnoreCase(UUID companyId, String externalIdentifier);
    boolean existsByCompanyIdAndExternalIdentifierIgnoreCaseAndIdNot(
            UUID companyId, String externalIdentifier, UUID id);
}
