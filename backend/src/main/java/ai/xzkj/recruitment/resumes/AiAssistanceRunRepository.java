package ai.xzkj.recruitment.resumes;

import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.domain.Pageable;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface AiAssistanceRunRepository extends JpaRepository<AiAssistanceRun, UUID> {
    @EntityGraph(attributePaths = {"resumeIntake", "resumeIntake.contact", "resumeIntake.contact.candidate", "resumeIntake.contact.candidate.company", "resumeIntake.contact.jobPosition", "resumeIntake.contact.bossAccount", "createdBy"})
    List<AiAssistanceRun> findByResumeIntakeIdOrderByCreatedAtDesc(UUID resumeIntakeId);

    @EntityGraph(attributePaths = {"resumeIntake", "resumeIntake.contact", "resumeIntake.contact.candidate", "resumeIntake.contact.candidate.company", "resumeIntake.contact.jobPosition", "resumeIntake.contact.bossAccount", "createdBy"})
    Optional<AiAssistanceRun> findWithDetailsById(UUID id);

    @EntityGraph(attributePaths = {"resumeIntake", "resumeIntake.contact", "resumeIntake.contact.candidate", "resumeIntake.contact.candidate.company"})
    List<AiAssistanceRun> findByAssistanceTypeAndStatusAndResultPurgedAtIsNullAndResultExpiresAtLessThanEqualOrderByResultExpiresAtAsc(
            String assistanceType, String status, Instant resultExpiresAt, Pageable pageable);

    default List<AiAssistanceRun> findExpiredResumeAnalysisRuns(Instant now, Pageable pageable) {
        return findByAssistanceTypeAndStatusAndResultPurgedAtIsNullAndResultExpiresAtLessThanEqualOrderByResultExpiresAtAsc(
                "RESUME_ANALYSIS", "SUCCEEDED", now, pageable);
    }
}
