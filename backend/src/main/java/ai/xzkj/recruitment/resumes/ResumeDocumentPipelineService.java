package ai.xzkj.recruitment.resumes;

import ai.xzkj.recruitment.audit.AuditService;
import ai.xzkj.recruitment.candidates.*;
import ai.xzkj.recruitment.common.ApiException;
import ai.xzkj.recruitment.jobs.JobPosition;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;

@Service
public class ResumeDocumentPipelineService {
    private final CandidateProfileRepository candidates;
    private final CandidateJobContactRepository contacts;
    private final ResumeIntakeRepository intakes;
    private final ResumeDocumentTextExtractor documents;
    private final ResumeMalwareScanner malware;
    private final ResumeImageOcrClient ocr;
    private final AutomatedResumeAnalysisService automatedAnalysis;
    private final AuditService audit;

    public ResumeDocumentPipelineService(CandidateProfileRepository candidates,
                                         CandidateJobContactRepository contacts,
                                         ResumeIntakeRepository intakes,
                                         ResumeDocumentTextExtractor documents,
                                         ResumeMalwareScanner malware,
                                         ResumeImageOcrClient ocr,
                                         AutomatedResumeAnalysisService automatedAnalysis,
                                         AuditService audit) {
        this.candidates = candidates;
        this.contacts = contacts;
        this.intakes = intakes;
        this.documents = documents;
        this.malware = malware;
        this.ocr = ocr;
        this.automatedAnalysis = automatedAnalysis;
        this.audit = audit;
    }

    @Transactional
    public ResumeDocumentProcessingResponse processVisibleResume(JobPosition job, String chatDigest, String sourceEventDigest,
                                                                  java.util.UUID sourceActionTaskId, MultipartFile file) {
        byte[] content;
        try {
            content = documents.readBytes(file);
        } catch (ApiException exception) {
            throw exception;
        }
        String documentDigest = hash(content);
        CandidateProfile candidate = candidates.findByCompanyIdAndSourceAndDedupKey(
                        job.getCompany().getId(), CandidateSource.BOSS, chatDigest)
                .orElseGet(() -> candidates.save(new CandidateProfile(job.getCompany(), CandidateSource.BOSS,
                        chatDigest, "匿名候选人 " + chatDigest.substring(0, 8), null, null, null, null)));
        CandidateJobContact contact = contacts.findByCandidateIdAndJobPositionId(candidate.getId(), job.getId())
                .orElseGet(() -> contacts.save(new CandidateJobContact(candidate, job, job.getBossAccount())));
        ResumeIntake sameEvent = intakes.findByContactIdAndSourceEventDigest(contact.getId(), sourceEventDigest).orElse(null);
        if (sameEvent != null) return ResumeDocumentProcessingResponse.from(sameEvent, true);
        ResumeIntake existing = intakes.findByContactIdAndResumeDigest(contact.getId(), documentDigest).orElse(null);
        if (existing != null) {
            audit.systemSuccess("DEDUPLICATE_VISIBLE_RESUME", "RESUME_INTAKE", existing.getId(),
                    "简历摘要 " + documentDigest.substring(0, 12), "同一候选人和岗位已处理相同文件，未重复扫描、提取或调用 AI");
            return ResumeDocumentProcessingResponse.from(existing, true);
        }
        ResumeIntake intake = intakes.save(new ResumeIntake(contact, ResumeIntakeSource.BOSS_VISIBLE,
                documentDigest, "BOSS 简历 " + documentDigest.substring(0, 8), Instant.now()));
        intake.attachSourceEvent(sourceEventDigest);
        if (sourceActionTaskId != null) intake.attachSourceActionTask(sourceActionTaskId);
        intake.processing();
        try {
            ResumeMalwareScanner.ScanResult scan = malware.scan(content);
            if (!scan.scanned()) throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE,
                    "RESUME_MALWARE_SCAN_REQUIRED", "无人值守简历必须通过恶意文件扫描");
            String type;
            String text;
            if (ocr.supports(content)) {
                type = "IMAGE_OCR";
                text = ocr.extract(content).text();
            } else {
                ResumeDocumentTextExtractor.ExtractedResumeDocument extracted = documents.extract(content);
                type = extracted.type();
                text = extracted.text();
            }
            intake.readyForAi(type, hash(text), true, Instant.now());
            audit.systemSuccess("PROCESS_VISIBLE_RESUME", "RESUME_INTAKE", intake.getId(),
                    "简历摘要 " + documentDigest.substring(0, 12),
                    "已完成病毒扫描、去重和 " + type + " 文本提取；只保存文件与文本摘要，不保存原文");
            automatedAnalysis.analyzeInMemory(intake, text);
        } catch (ApiException exception) {
            intake.processingFailed(cleanCode(exception.getCode()), cleanReason(exception.getMessage()), Instant.now());
            audit.systemSuccess("QUEUE_RESUME_PROCESSING_EXCEPTION", "RESUME_INTAKE", intake.getId(),
                    "简历摘要 " + documentDigest.substring(0, 12),
                    "简历处理已转入 HR 异常队列；原因代码 " + cleanCode(exception.getCode()));
        } catch (RuntimeException exception) {
            intake.processingFailed("RESUME_PROCESSING_FAILED", "简历处理未完成，请 HR 重新检查文件", Instant.now());
            audit.systemSuccess("QUEUE_RESUME_PROCESSING_EXCEPTION", "RESUME_INTAKE", intake.getId(),
                    "简历摘要 " + documentDigest.substring(0, 12), "简历处理出现非预期错误，已转入 HR 异常队列；审计不包含原文");
        }
        return ResumeDocumentProcessingResponse.from(intake, false);
    }

    private String hash(byte[] value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value)); }
        catch (Exception exception) { throw new IllegalStateException("SHA-256 unavailable", exception); }
    }

    private String hash(String value) { return hash(value.getBytes(StandardCharsets.UTF_8)); }
    private String cleanCode(String value) { return value == null || value.isBlank() ? "RESUME_PROCESSING_FAILED" : value.substring(0, Math.min(80, value.length())); }
    private String cleanReason(String value) { String clean=value==null?"简历处理未完成":value.replace('\n',' ').replace('\r',' ').trim();return clean.substring(0,Math.min(300,clean.length())); }
}
