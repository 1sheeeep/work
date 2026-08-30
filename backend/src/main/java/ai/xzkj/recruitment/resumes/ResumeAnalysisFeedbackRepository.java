package ai.xzkj.recruitment.resumes;

import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface ResumeAnalysisFeedbackRepository extends JpaRepository<ResumeAnalysisFeedback, UUID> {
    @EntityGraph(attributePaths = {"createdBy"})
    List<ResumeAnalysisFeedback> findByAnalysisRunIdOrderByCreatedAtDesc(UUID analysisRunId);
}
