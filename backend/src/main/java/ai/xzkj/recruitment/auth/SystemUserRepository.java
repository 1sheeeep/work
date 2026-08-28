package ai.xzkj.recruitment.auth;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.EntityGraph;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface SystemUserRepository extends JpaRepository<SystemUser, UUID> {
    @EntityGraph(attributePaths = "companyScopes")
    Optional<SystemUser> findByUsernameIgnoreCase(String username);

    boolean existsByUsernameIgnoreCase(String username);

    @EntityGraph(attributePaths = "companyScopes")
    List<SystemUser> findAllByRoleNotOrderByCreatedAtDesc(UserRole role);

    @EntityGraph(attributePaths = "companyScopes")
    Optional<SystemUser> findWithCompanyScopesById(UUID id);
}
