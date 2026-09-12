package ai.xzkj.recruitment.resumes;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.*;
import org.springframework.data.repository.query.Param;
import jakarta.persistence.LockModeType;
import java.time.Instant;import java.util.*;
public interface ResumeIntakeRepository extends JpaRepository<ResumeIntake,UUID>{
 @EntityGraph(attributePaths={"contact","contact.candidate","contact.candidate.company","contact.jobPosition","contact.bossAccount","reviewedBy"})List<ResumeIntake> findAllByOrderByReceivedAtDesc();
 @EntityGraph(attributePaths={"contact","contact.candidate","contact.candidate.company","contact.jobPosition","contact.bossAccount","reviewedBy"})List<ResumeIntake> findByContact_Candidate_IdOrderByReceivedAtDesc(UUID candidateId);
 @EntityGraph(attributePaths={"contact","contact.candidate","contact.candidate.company","contact.jobPosition","contact.bossAccount","reviewedBy"})Optional<ResumeIntake> findWithDetailsById(UUID id);
 Optional<ResumeIntake> findByContactIdAndResumeDigest(UUID contactId,String resumeDigest);
 Optional<ResumeIntake> findByContactIdAndSourceEventDigest(UUID contactId,String sourceEventDigest);
 @EntityGraph(attributePaths={"contact","contact.candidate","contact.candidate.company","contact.jobPosition","contact.bossAccount"})List<ResumeIntake> findTop100ByProcessingStatusOrderByReceivedAtDesc(String processingStatus);
 @Lock(LockModeType.PESSIMISTIC_WRITE)
 @Query("select i from ResumeIntake i where i.analysisQueueStatus in ('QUEUED','RETRY_WAIT') and (i.analysisQueueNextAttemptAt is null or i.analysisQueueNextAttemptAt <= :now) order by i.analysisQueueQueuedAt asc, i.receivedAt asc")
 List<ResumeIntake> findDueForAnalysis(@Param("now") Instant now, Pageable pageable);
 @Lock(LockModeType.PESSIMISTIC_WRITE)
 @Query("select i from ResumeIntake i where i.analysisQueueStatus = 'PROCESSING' and i.analysisQueueLeaseUntil < :now")
 List<ResumeIntake> findExpiredAnalysisLeases(@Param("now") Instant now, Pageable pageable);
 @Query("select i from ResumeIntake i where (i.sourcePdf is not null or i.extractedText is not null) and i.updatedAt <= :cutoff order by i.updatedAt asc")
 List<ResumeIntake> findSourcePdfsDueForPurge(Instant cutoff, Pageable pageable);
}
