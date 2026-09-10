package ai.xzkj.recruitment.localconnector;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

interface HrReplyExampleRepository extends JpaRepository<HrReplyExample, UUID> {
    List<HrReplyExample> findTop12ByJobPositionIdAndIntentOrderByCreatedAtDesc(UUID jobPositionId, String intent);
    boolean existsBySourceHash(String sourceHash);
}
