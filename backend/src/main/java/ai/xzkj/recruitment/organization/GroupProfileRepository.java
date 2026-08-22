package ai.xzkj.recruitment.organization;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface GroupProfileRepository extends JpaRepository<GroupProfile, UUID> {
}
