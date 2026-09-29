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

        ResumeDocumentProcessingResponse result = f.service.processVisibleResume(f.job, "b".repeat(64), "c".repeat(64), null, f.file);

        assertThat(result.processingStatus()).isEqualTo("QUEUED");
        assertThat(result.documentType()).isNull();
        assertThat(result.malwareScanned()).isFalse();
        assertThat(result.extractedTextDigestPrefix()).isNull();
        assertThat(result.duplicate()).isFalse();
        verify(f.documentQueue).enqueue(any(ResumeIntake.class));
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
        verifyNoInteractions(f.malware, f.ocr, f.documentQueue);
    }

    @Test
    void retriesAiForDuplicateWhenPreviousAnalysisWasNotSuccessful() {
        Fixture f = new Fixture();
        byte[] content = "same-resume".getBytes();
        when(f.documents.readBytes(f.file)).thenReturn(content);
        ResumeIntake existing = new ResumeIntake(f.contact, ResumeIntakeSource.BOSS_VISIBLE,
                sha256(content), "existing", java.time.Instant.now());
        existing.processing();
        existing.readyForAi("PDF", "a".repeat(64), true, java.time.Instant.now());
        existing.analysisUnavailable("FAILED", "AI_REQUEST_FAILED", "AI 请求失败", java.time.Instant.now());
        when(f.intakes.findByContactIdAndResumeDigest(eq(f.contactId), any())).thenReturn(Optional.of(existing));

        ResumeDocumentProcessingResponse result = f.service.processVisibleResume(f.job, "b".repeat(64), "c".repeat(64), null, f.file);

        assertThat(result.duplicate()).isTrue();
        verify(f.documentQueue).enqueue(eq(existing));
    }

    @Test
    void ingestsRenderedBossResumeTextAndStartsAutomaticAnalysisWithoutPersistingRawText() {
        Fixture f = new Fixture();
        String visibleText = "候选人姓名 林嘉明\n工作经历 跨境电商客服主管五年\n技能 客诉处理 团队管理 英语沟通".repeat(4);

        ResumeDocumentProcessingResponse result = f.service.processVisibleResumeText(
                f.job, "b".repeat(64), "d".repeat(64), visibleText);

        assertThat(result.processingStatus()).isEqualTo("READY_FOR_AI");
        assertThat(result.documentType()).isEqualTo("BOSS_VISIBLE_TEXT");
        assertThat(result.malwareScanned()).isFalse();
        assertThat(result.duplicate()).isFalse();
        assertThat(result.processingStatus()).isEqualTo("READY_FOR_AI");
        verify(f.candidate).updateRecognizedName("林嘉明");
        verify(f.analysisQueue).enqueue(any(ResumeIntake.class));
    }

    private static class Fixture {
        final CandidateProfileRepository candidates=mock(CandidateProfileRepository.class);
        final CandidateJobContactRepository contacts=mock(CandidateJobContactRepository.class);
        final ResumeIntakeRepository intakes=mock(ResumeIntakeRepository.class);
        final ResumeDocumentTextExtractor documents=mock(ResumeDocumentTextExtractor.class);
        final ResumeMalwareScanner malware=mock(ResumeMalwareScanner.class);
        final ResumeImageOcrClient ocr=mock(ResumeImageOcrClient.class);
        final ResumeDocumentProcessingQueueService documentQueue=mock(ResumeDocumentProcessingQueueService.class);
        final ResumeAnalysisQueueService analysisQueue=mock(ResumeAnalysisQueueService.class);
        final AuditService audit=mock(AuditService.class);
        final MultipartFile file=mock(MultipartFile.class);
        final Company company=mock(Company.class);
        final BossAccount account=mock(BossAccount.class);
        final JobPosition job=mock(JobPosition.class);
        final CandidateProfile candidate=mock(CandidateProfile.class);
        final CandidateJobContact contact=mock(CandidateJobContact.class);
        final UUID companyId=UUID.randomUUID(),jobId=UUID.randomUUID(),candidateId=UUID.randomUUID(),contactId=UUID.randomUUID();
        final ResumeDocumentPipelineService service=new ResumeDocumentPipelineService(candidates,contacts,intakes,documents,documentQueue,analysisQueue,audit);
        Fixture(){
            when(company.getId()).thenReturn(companyId);when(job.getCompany()).thenReturn(company);when(job.getBossAccount()).thenReturn(account);when(job.getId()).thenReturn(jobId);
            when(candidate.getId()).thenReturn(candidateId);when(candidate.getDisplayName()).thenReturn("匿名候选人");
            when(contact.getId()).thenReturn(contactId);when(contact.getCandidate()).thenReturn(candidate);
            when(candidates.findByCompanyIdAndSourceAndDedupKey(companyId,CandidateSource.BOSS,"b".repeat(64))).thenReturn(Optional.of(candidate));
            when(contacts.findByCandidateIdAndJobPositionId(candidateId,jobId)).thenReturn(Optional.of(contact));
            when(intakes.findByContactIdAndResumeDigest(eq(contactId),any())).thenReturn(Optional.empty());
            when(intakes.findByContactIdAndSourceEventDigest(eq(contactId),any())).thenReturn(Optional.empty());
            when(intakes.save(any())).thenAnswer(invocation->invocation.getArgument(0));
            doAnswer(invocation -> { invocation.<ResumeIntake>getArgument(0).queueDocumentProcessing(java.time.Instant.now()); return null; })
                    .when(documentQueue).enqueue(any(ResumeIntake.class));
        }
    }

    private static String sha256(byte[] value){try{return java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(value));}catch(Exception e){throw new IllegalStateException(e);}}
}
