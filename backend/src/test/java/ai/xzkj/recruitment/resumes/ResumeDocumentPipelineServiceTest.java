package ai.xzkj.recruitment.resumes;

import ai.xzkj.recruitment.audit.AuditService;
import ai.xzkj.recruitment.boss.BossAccount;
import ai.xzkj.recruitment.candidates.*;
import ai.xzkj.recruitment.jobs.JobPosition;
import ai.xzkj.recruitment.organization.Company;
import org.junit.jupiter.api.Test;
import org.springframework.web.multipart.MultipartFile;

import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class ResumeDocumentPipelineServiceTest {
    @Test
    void scansExtractsAndStoresOnlyDigests() {
        Fixture f = new Fixture();
        when(f.documents.readBytes(f.file)).thenReturn("safe-pdf".getBytes());
        when(f.malware.scan(any())).thenReturn(ResumeMalwareScanner.ScanResult.clean());
        when(f.ocr.supports(any())).thenReturn(false);
        when(f.documents.extract(any())).thenReturn(new ResumeDocumentTextExtractor.ExtractedResumeDocument(
                "PDF", "Java 开发经验", "a".repeat(64)));

        ResumeDocumentProcessingResponse result = f.service.processVisibleResume(f.job, "b".repeat(64), "c".repeat(64), null, f.file);

        assertThat(result.processingStatus()).isEqualTo("READY_FOR_AI");
        assertThat(result.documentType()).isEqualTo("PDF");
        assertThat(result.malwareScanned()).isTrue();
        assertThat(result.extractedTextDigestPrefix()).hasSize(12);
        assertThat(result.duplicate()).isFalse();
    }

    @Test
    void returnsExistingIntakeWithoutScanningDuplicateFile() {
        Fixture f = new Fixture();
        byte[] content = "same-resume".getBytes();
        when(f.documents.readBytes(f.file)).thenReturn(content);
        ResumeIntake existing = new ResumeIntake(f.contact, ResumeIntakeSource.BOSS_VISIBLE,
                sha256(content), "existing", java.time.Instant.now());
        when(f.intakes.findByContactIdAndResumeDigest(eq(f.contactId), any())).thenReturn(Optional.of(existing));

        ResumeDocumentProcessingResponse result = f.service.processVisibleResume(f.job, "b".repeat(64), "c".repeat(64), null, f.file);

        assertThat(result.duplicate()).isTrue();
        verifyNoInteractions(f.malware, f.ocr);
    }

    private static class Fixture {
        final CandidateProfileRepository candidates=mock(CandidateProfileRepository.class);
        final CandidateJobContactRepository contacts=mock(CandidateJobContactRepository.class);
        final ResumeIntakeRepository intakes=mock(ResumeIntakeRepository.class);
        final ResumeDocumentTextExtractor documents=mock(ResumeDocumentTextExtractor.class);
        final ResumeMalwareScanner malware=mock(ResumeMalwareScanner.class);
        final ResumeImageOcrClient ocr=mock(ResumeImageOcrClient.class);
        final AutomatedResumeAnalysisService automatedAnalysis=mock(AutomatedResumeAnalysisService.class);
        final AuditService audit=mock(AuditService.class);
        final MultipartFile file=mock(MultipartFile.class);
        final Company company=mock(Company.class);
        final BossAccount account=mock(BossAccount.class);
        final JobPosition job=mock(JobPosition.class);
        final CandidateProfile candidate=mock(CandidateProfile.class);
        final CandidateJobContact contact=mock(CandidateJobContact.class);
        final UUID companyId=UUID.randomUUID(),jobId=UUID.randomUUID(),candidateId=UUID.randomUUID(),contactId=UUID.randomUUID();
        final ResumeDocumentPipelineService service=new ResumeDocumentPipelineService(candidates,contacts,intakes,documents,malware,ocr,automatedAnalysis,audit);
        Fixture(){
            when(company.getId()).thenReturn(companyId);when(job.getCompany()).thenReturn(company);when(job.getBossAccount()).thenReturn(account);when(job.getId()).thenReturn(jobId);
            when(candidate.getId()).thenReturn(candidateId);when(contact.getId()).thenReturn(contactId);
            when(candidates.findByCompanyIdAndSourceAndDedupKey(companyId,CandidateSource.BOSS,"b".repeat(64))).thenReturn(Optional.of(candidate));
            when(contacts.findByCandidateIdAndJobPositionId(candidateId,jobId)).thenReturn(Optional.of(contact));
            when(intakes.findByContactIdAndResumeDigest(eq(contactId),any())).thenReturn(Optional.empty());
            when(intakes.findByContactIdAndSourceEventDigest(eq(contactId),any())).thenReturn(Optional.empty());
            when(intakes.save(any())).thenAnswer(invocation->invocation.getArgument(0));
        }
    }

    private static String sha256(byte[] value){try{return java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(value));}catch(Exception e){throw new IllegalStateException(e);}}
}
