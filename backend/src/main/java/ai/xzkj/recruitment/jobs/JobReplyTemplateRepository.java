package ai.xzkj.recruitment.jobs;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface JobReplyTemplateRepository extends JpaRepository<JobReplyTemplate, UUID> {
    List<JobReplyTemplate> findAllByJobPositionId(UUID jobPositionId);
}
