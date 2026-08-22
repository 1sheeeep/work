package ai.xzkj.recruitment.auth;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface SystemUserRepository extends JpaRepository<SystemUser, UUID> {
    Optional<SystemUser> findByUsernameIgnoreCase(String username);
}
