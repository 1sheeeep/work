package ai.xzkj.recruitment.resumes;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.*;import java.time.Instant;import java.util.*;
public interface ResumeIntakeRepository extends JpaRepository<ResumeIntake,UUID>{
 @EntityGraph(attributePaths={"contact","contact.candidate","contact.candidate.company","contact.jobPosition","contact.bossAccount","reviewedBy"})List<ResumeIntake> findAllByOrderByReceivedAtDesc();
 @EntityGraph(attributePaths={"contact","contact.candidate","contact.candidate.company","contact.jobPosition","contact.bossAccount","reviewedBy"})Optional<ResumeIntake> findWithDetailsById(UUID id);
 Optional<ResumeIntake> findByContactIdAndResumeDigest(UUID contactId,String resumeDigest);
 Optional<ResumeIntake> findByContactIdAndSourceEventDigest(UUID contactId,String sourceEventDigest);
 @EntityGraph(attributePaths={"contact","contact.candidate","contact.candidate.company","contact.jobPosition","contact.bossAccount"})List<ResumeIntake> findTop100ByProcessingStatusOrderByReceivedAtDesc(String processingStatus);
 @Query("select i from ResumeIntake i where (i.sourcePdf is not null or i.extractedText is not null) and i.updatedAt <= :cutoff order by i.updatedAt asc")
 List<ResumeIntake> findSourcePdfsDueForPurge(Instant cutoff, Pageable pageable);
}
