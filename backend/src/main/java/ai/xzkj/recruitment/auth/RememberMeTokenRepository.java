package ai.xzkj.recruitment.auth;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;

interface RememberMeTokenRepository extends JpaRepository<RememberMeToken, UUID> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select token from RememberMeToken token join fetch token.user where token.id = :id")
    Optional<RememberMeToken> findForUpdateById(@Param("id") UUID id);
}
