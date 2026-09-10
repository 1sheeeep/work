package ai.xzkj.recruitment.resumes;

import ai.xzkj.recruitment.audit.AuditService;
import ai.xzkj.recruitment.common.ApiException;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;

@Service
public class AutomatedResumeAnalysisService {
    private final AiAssistanceRunRepository runs;
    private final OpenAiResumeClient client;
    private final OpenAiProperties properties;
    private final ResumeAnalysisRetentionProperties retention;
    private final ObjectMapper mapper;
    private final AuditService audit;

    public AutomatedResumeAnalysisService(AiAssistanceRunRepository runs, OpenAiResumeClient client,
                                          OpenAiProperties properties, ResumeAnalysisRetentionProperties retention,
                                          ObjectMapper mapper, AuditService audit) {
        this.runs = runs;
        this.client = client;
        this.properties = properties;
        this.retention = retention;
        this.mapper = mapper;
        this.audit = audit;
    }

    /** The supplied text is consumed synchronously and is never stored by this service. */
    public void analyzeInMemory(ResumeIntake intake, String extractedText) {
        Instant now = Instant.now();
        if (!intake.getContact().getCandidate().getCompany().isAiAutoAnalysisEnabled()) {
            intake.analysisUnavailable("NOT_AUTHORIZED", "COMPANY_AI_AUTO_ANALYSIS_DISABLED",
                    "所属公司尚未开启 AI 自动分析", now);
            return;
        }
        if (!configurationReady()) {
            intake.analysisUnavailable("NOT_CONFIGURED", "OPENAI_CONFIGURATION_REQUIRED",
                    "OpenAI 尚未完成可用配置", now);
            return;
        }

        String inputHash = hash(extractedText);
        intake.analysisStarted();
        try {
            ResumeAnalysisResult result = client.analyze(intake.getContact().getJobPosition(), extractedText,
                    hash("unattended-company:" + intake.getContact().getCandidate().getCompany().getId()));
            updateVerifiedCandidateName(intake, result.candidateName(), extractedText);
            runs.save(AiAssistanceRun.unattendedSucceeded(intake, properties.getModel(), inputHash,
                    result.summary(), mapper.writeValueAsString(result), retention.expiresFrom(now)));
            intake.analysisSucceeded(Instant.now());
            audit.systemSuccess("AUTO_ANALYZE_RESUME", "RESUME_INTAKE", intake.getId(),
                    "简历摘要 " + intake.getResumeDigest().substring(0, 12),
                    "公司级授权下完成自动 AI 分析；仅保存文本摘要与结构化结果，不保存简历正文");
        } catch (ApiException exception) {
            recordFailure(intake, inputHash, cleanCode(exception.getCode()), cleanReason(exception.getMessage()));
        } catch (Exception exception) {
            recordFailure(intake, inputHash, "OPENAI_ANALYSIS_FAILED", "AI 分析未完成，请 HR 检查配置或稍后重试");
        }
    }

    private void recordFailure(ResumeIntake intake, String inputHash, String code, String reason) {
        runs.save(AiAssistanceRun.unattendedFailed(intake, properties.getModel(), inputHash, code));
        intake.analysisUnavailable("FAILED", code, reason, Instant.now());
        audit.systemSuccess("QUEUE_RESUME_ANALYSIS_EXCEPTION", "RESUME_INTAKE", intake.getId(),
                "简历摘要 " + intake.getResumeDigest().substring(0, 12),
                "自动 AI 分析失败并进入 HR 异常队列；原因代码 " + code + "；审计不包含简历正文");
    }

    private boolean configurationReady() {
        return properties.isEnabled() && !properties.getApiKey().isBlank()
                && !properties.getModel().isBlank() && properties.isOfficialEndpoint();
    }

    private void updateVerifiedCandidateName(ResumeIntake intake, String candidateName, String extractedText) {
        String name = candidateName == null ? "" : candidateName.replace('\n', ' ').replace('\r', ' ').trim();
        if (name.isBlank() || name.length() > 100) return;
        String compactName = name.replaceAll("\\s+", "");
        String compactText = extractedText == null ? "" : extractedText.replaceAll("\\s+", "");
        if (!compactText.contains(compactName)) return;
        intake.getContact().getCandidate().updateRecognizedName(name);
    }

    private String cleanCode(String value) {
        String clean = value == null || value.isBlank() ? "OPENAI_ANALYSIS_FAILED" : value;
        return clean.substring(0, Math.min(80, clean.length()));
    }

    private String cleanReason(String value) {
        String clean = value == null || value.isBlank() ? "AI 分析未完成" : value.replace('\n', ' ').replace('\r', ' ').trim();
        return clean.substring(0, Math.min(300, clean.length()));
    }

    private String hash(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception exception) {
            throw new IllegalStateException("SHA-256 unavailable", exception);
        }
    }
}
