package ai.xzkj.recruitment.resumes;
import org.springframework.data.jpa.repository.*;import java.util.*;
public interface ResumeIntakeRepository extends JpaRepository<ResumeIntake,UUID>{
 @EntityGraph(attributePaths={"contact","contact.candidate","contact.candidate.company","contact.jobPosition","contact.bossAccount","reviewedBy"})List<ResumeIntake> findAllByOrderByReceivedAtDesc();
 @EntityGraph(attributePaths={"contact","contact.candidate","contact.candidate.company","contact.jobPosition","contact.bossAccount","reviewedBy"})Optional<ResumeIntake> findWithDetailsById(UUID id);
 Optional<ResumeIntake> findByContactIdAndResumeDigest(UUID contactId,String resumeDigest);
}
