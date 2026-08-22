package ai.xzkj.recruitment.organization;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface CompanyRepository extends JpaRepository<Company, UUID> {
    List<Company> findByGroupIdOrderByCreatedAtDesc(UUID groupId);
    boolean existsByGroupIdAndCodeIgnoreCase(UUID groupId, String code);
    boolean existsByGroupIdAndNameIgnoreCase(UUID groupId, String name);
    boolean existsByGroupIdAndCodeIgnoreCaseAndIdNot(UUID groupId, String code, UUID id);
    boolean existsByGroupIdAndNameIgnoreCaseAndIdNot(UUID groupId, String name, UUID id);
}
