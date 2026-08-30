package ai.xzkj.recruitment.resumes;

import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface AiAssistanceRunRepository extends JpaRepository<AiAssistanceRun, UUID> {
    @EntityGraph(attributePaths = {"resumeIntake", "resumeIntake.contact", "resumeIntake.contact.candidate", "resumeIntake.contact.candidate.company", "resumeIntake.contact.jobPosition", "resumeIntake.contact.bossAccount", "createdBy"})
    List<AiAssistanceRun> findByResumeIntakeIdOrderByCreatedAtDesc(UUID resumeIntakeId);
}
