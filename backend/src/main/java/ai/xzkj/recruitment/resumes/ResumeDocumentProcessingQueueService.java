package ai.xzkj.recruitment.resumes;

import ai.xzkj.recruitment.audit.AuditService;
import ai.xzkj.recruitment.candidates.CandidateIdentityService;
import ai.xzkj.recruitment.common.ApiException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import jakarta.annotation.PreDestroy;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 后台简历文件处理队列。HTTP 请求只负责校验、保存来源 PDF 和入队；
 * 病毒扫描、OCR/文本提取在页面锁之外执行，完成后才进入 AI 分析队列。
 */
@Service
public class ResumeDocumentProcessingQueueService {
    private static final System.Logger LOG = System.getLogger(ResumeDocumentProcessingQueueService.class.getName());

    private final ResumeIntakeRepository intakes;
    private final ResumeDocumentTextExtractor documents;
    private final ResumeMalwareScanner malware;
    private final ResumeImageOcrClient ocr;
    private final ResumeAnalysisQueueService analysisQueue;
    private final CandidateIdentityService identity;
    private final AuditService audit;
    private final TransactionTemplate transactions;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicBoolean draining = new AtomicBoolean();

    @Value("${app.resume.document-processing.enabled:true}")
    private boolean enabled;

    public ResumeDocumentProcessingQueueService(ResumeIntakeRepository intakes,
                                               ResumeDocumentTextExtractor documents,
                                               ResumeMalwareScanner malware,
                                               ResumeImageOcrClient ocr,
                                               ResumeAnalysisQueueService analysisQueue,
                                               CandidateIdentityService identity,
                                               AuditService audit,
                                               PlatformTransactionManager manager) {
        this.intakes = intakes;
        this.documents = documents;
        this.malware = malware;
        this.ocr = ocr;
        this.analysisQueue = analysisQueue;
        this.identity = identity;
        this.audit = audit;
        this.transactions = new TransactionTemplate(manager);
        this.transactions.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    /** 在入库事务中调用；状态随 intake 一起提交，进程重启后仍可恢复。 */
    public void enqueue(ResumeIntake intake) {
        if (intake == null) return;
        if (!"QUEUED".equals(intake.getProcessingStatus())
                && !"RETRY_WAIT".equals(intake.getProcessingStatus())) {
            intake.queueDocumentProcessing(Instant.now());
        }
    }

    @Scheduled(fixedDelayString = "${app.resume.document-processing.poll-interval:2s}",
            initialDelayString = "${app.resume.document-processing.initial-delay:3s}")
    public void scheduleDrain() {
        if (!enabled || !draining.compareAndSet(false, true)) return;
        worker.execute(() -> {
            try {
                drain();
            } finally {
                draining.set(false);
            }
        });
    }

    private void drain() {
        while (enabled) {
            UUID intakeId = claimNext();
            if (intakeId == null || !process(intakeId)) return;
        }
    }

    private UUID claimNext() {
        return transactions.execute(status -> {
            Instant now = Instant.now();
            for (ResumeIntake stale : intakes.findExpiredDocumentProcessingLeases(now, PageRequest.of(0, 20))) {
                stale.recoverDocumentProcessingLease(now);
            }
            var due = intakes.findDueForDocumentProcessing(now, PageRequest.of(0, 1));
            if (due.isEmpty()) return null;
            ResumeIntake intake = due.get(0);
            if (!intake.claimDocumentProcessing(now)) return null;
            LOG.log(System.Logger.Level.INFO, "RESUME_TASK_STAGE stage=CLAIMED task=" + intake.getId()
                    + " digest=" + safeDigest(intake.getResumeDigest()));
            return intake.getId();
        });
    }

    private boolean process(UUID intakeId) {
        byte[] sourcePdf = transactions.execute(status -> intakes.findWithDetailsById(intakeId)
                .map(ResumeIntake::getSourcePdf).orElse(null));
        if (sourcePdf == null || sourcePdf.length == 0) {
            fail(intakeId, "RESUME_SOURCE_NOT_AVAILABLE", "简历原文件不可用，无法进行后台提取");
            return true;
        }
        try {
            LOG.log(System.Logger.Level.INFO, "RESUME_TASK_STAGE stage=EXTRACTION_STARTED task=" + intakeId);
            ResumeMalwareScanner.ScanResult scan = malware.scan(sourcePdf);
            String type;
            String text;
            if (ocr.supports(sourcePdf)) {
                type = "IMAGE_OCR";
                text = ocr.extract(sourcePdf).text();
            } else {
                ResumeDocumentTextExtractor.ExtractedResumeDocument extracted = documents.extract(sourcePdf);
                type = extracted.type();
                text = extracted.text();
            }
            String documentType = type;
            String extractedText = text;
            boolean malwareScanned = scan.scanned();
            transactions.executeWithoutResult(status -> intakes.findWithDetailsById(intakeId).ifPresent(intake -> {
                if (!"PROCESSING".equals(intake.getProcessingStatus())) return;
                Instant now = Instant.now();
                intake.readyForAi(documentType, sha256(extractedText), malwareScanned, now);
                intake.storeExtractedText(extractedText);
                intake.autoApproveForAi(now);
                var candidate = intake.getContact() == null ? null : intake.getContact().getCandidate();
                if (candidate != null) {
                    updateRecognizedName(candidate, extractedText);
                    identity.updateFromResume(candidate, identity.extractPhone(extractedText), identity.extractEmail(extractedText));
                }
                analysisQueue.enqueue(intake);
                audit.systemSuccess("PROCESS_VISIBLE_RESUME", "RESUME_INTAKE", intake.getId(),
                        "简历摘要 " + safeDigest(intake.getResumeDigest()),
                        "已在后台完成" + (malwareScanned ? "病毒扫描、" : "") + "去重和 " + documentType + " 文本提取；已进入 AI 分析队列");
            }));
            LOG.log(System.Logger.Level.INFO, "RESUME_TASK_STAGE stage=EXTRACTION_FINISHED task=" + intakeId);
            return true;
        } catch (RuntimeException error) {
            String code = error instanceof ApiException api ? api.getCode() : "RESUME_PROCESSING_FAILED";
            String reason = safe(error);
            boolean retryable = !(error instanceof ApiException api)
                    || switch (api.getCode()) {
                case "RESUME_MALWARE_DETECTED", "RESUME_FILE_TYPE_UNSUPPORTED", "RESUME_FILE_ENCRYPTED",
                        "RESUME_PDF_TOO_MANY_PAGES", "RESUME_DOCX_TOO_COMPLEX", "RESUME_DOCX_INVALID",
                        "RESUME_DOCX_MACRO_BLOCKED", "RESUME_TEXT_EMPTY", "RESUME_TEXT_TOO_LONG" -> false;
                default -> true;
            };
            if (retryable) retry(intakeId, code, reason);
            else fail(intakeId, code, reason);
            return true;
        }
    }

    private void retry(UUID intakeId, String code, String reason) {
        transactions.executeWithoutResult(status -> intakes.findById(intakeId).ifPresent(intake -> {
            if (!"PROCESSING".equals(intake.getProcessingStatus())) return;
            if (!intake.retryDocumentProcessing(code + "：" + reason, Instant.now())) {
                audit.systemSuccess("RESUME_PROCESSING_RETRY_EXHAUSTED", "RESUME_INTAKE", intake.getId(),
                        "简历摘要 " + safeDigest(intake.getResumeDigest()), "后台提取重试耗尽，已转 HR 复核：" + reason);
            }
        }));
        LOG.log(System.Logger.Level.WARNING, "RESUME_TASK_STAGE stage=RETRY task=" + intakeId + " code=" + code);
    }

    private void fail(UUID intakeId, String code, String reason) {
        transactions.executeWithoutResult(status -> intakes.findById(intakeId).ifPresent(intake -> {
            if (!"PROCESSING".equals(intake.getProcessingStatus())) return;
            intake.processingFailed(code, reason, Instant.now());
            audit.systemSuccess("QUEUE_RESUME_PROCESSING_EXCEPTION", "RESUME_INTAKE", intake.getId(),
                    "简历摘要 " + safeDigest(intake.getResumeDigest()), "简历后台处理已转入 HR 异常队列；原因代码 " + code);
        }));
        LOG.log(System.Logger.Level.WARNING, "RESUME_TASK_STAGE stage=FAILED task=" + intakeId + " code=" + code);
    }

    private void updateRecognizedName(ai.xzkj.recruitment.candidates.CandidateProfile candidate, String text) {
        if (candidate == null || !ResumeCandidateName.isAnonymousPlaceholder(candidate.getDisplayName())) return;
        String name = ResumeCandidateName.verified(ResumeCandidateName.recognize(text), text);
        if (name != null) candidate.updateRecognizedName(name);
    }

    private String sha256(String value) {
        try {
            return java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        } catch (Exception exception) {
            throw new IllegalStateException("SHA-256 unavailable", exception);
        }
    }

    private String safeDigest(String value) {
        if (value == null || value.isBlank()) return "none";
        return value.substring(0, Math.min(16, value.length()));
    }

    private String safe(Exception error) {
        String value = error == null ? "未知异常" : error.getMessage();
        if (value == null || value.isBlank()) value = error == null ? "未知异常" : error.getClass().getSimpleName();
        value = value.replace('\n', ' ').replace('\r', ' ').trim();
        return value.substring(0, Math.min(280, value.length()));
    }

    @PreDestroy
    void shutdown() {
        worker.shutdownNow();
    }
}
