package ai.xzkj.recruitment.resumes;

import ai.xzkj.recruitment.common.ApiException;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import tools.jackson.databind.ObjectMapper;

import java.time.Instant;
import java.util.List;
import java.util.ArrayList;
import java.util.Locale;
import java.util.UUID;

record ResumeAnalysisRequest(
        @NotBlank @Size(max = 30000) String resumeText,
        @AssertTrue(message = "请确认已获授权将该简历内容发送给配置的大模型分析") boolean externalProcessingConfirmed
) {}

record ResumeDocumentPreviewResponse(
        String documentType,
        String extractedText,
        String documentHashPrefix,
        boolean malwareScanned,
        String reviewMessage
) {}

record ExternalResumeAnalysisResponse(
        ResumeIntakeResponse intake,
        ResumeAnalysisResponse analysis,
        int comparedJobCount
) {}

record ResumeAnalysisFeedbackRequest(
        @NotNull ResumeAnalysisFeedbackType feedbackType,
        @NotBlank @Size(max = 1000) String note
) {}

record ResumeAnalysisResponse(
        UUID id,
        UUID resumeIntakeId,
        String candidateName,
        String jobTitle,
        String provider,
        String modelVersion,
        String status,
        String origin,
        ResumeAnalysisResult result,
        String errorMessage,
        List<ResumeAnalysisFeedbackResponse> feedback,
        String createdBy,
        Instant createdAt,
        Instant resultExpiresAt,
        Instant resultPurgedAt
) {
    static ResumeAnalysisResponse from(AiAssistanceRun run, ObjectMapper mapper, List<ResumeAnalysisFeedback> feedback) {
        ResumeAnalysisResult result = run.getStructuredResult() == null ? null
                : ResumeAnalysisResult.parseStored(run.getStructuredResult(), mapper);
        ResumeIntake intake = run.getResumeIntake();
        return new ResumeAnalysisResponse(
                run.getId(), intake.getId(), intake.getContact().getCandidate().getDisplayName(),
                intake.getContact().getJobPosition().getTitle(), run.getProvider(), run.getModelVersion(),
                run.getStatus(), run.getOrigin(), result, run.getErrorMessage(), feedback.stream().map(ResumeAnalysisFeedbackResponse::from).toList(),
                run.getCreatedBy() == null ? "系统自动分析" : run.getCreatedBy().getDisplayName(), run.getCreatedAt(), run.getResultExpiresAt(), run.getResultPurgedAt()
        );
    }
}

record ResumeAnalysisFeedbackResponse(
        UUID id,
        ResumeAnalysisFeedbackType feedbackType,
        String note,
        String createdBy,
        Instant createdAt
) {
    static ResumeAnalysisFeedbackResponse from(ResumeAnalysisFeedback feedback) {
        return new ResumeAnalysisFeedbackResponse(feedback.getId(), feedback.getFeedbackType(), feedback.getNote(),
                feedback.getCreatedBy().getDisplayName(), feedback.getCreatedAt());
    }
}

record ResumeAnalysisResult(
        String candidateName,
        String recommendation,
        String summary,
        List<ResumeAnalysisEvidence> evidence,
        List<String> gaps,
        List<String> risks,
        List<String> followUpQuestions
) {
    private static final List<String> RECOMMENDATIONS = List.of("PRIORITY_VIEW", "NORMAL_VIEW", "INFORMATION_NEEDED");

    static ResumeAnalysisResult parseExternal(String json, ObjectMapper mapper) {
        try {
            return validate(normalize(mapper.readValue(extractJsonObject(json), ResumeAnalysisResult.class)));
        } catch (IllegalArgumentException exception) {
            System.getLogger(ResumeAnalysisResult.class.getName())
                    .log(System.Logger.Level.WARNING, "简历分析 JSON 校验失败: " + exception.getMessage()
                            + "\n原始 JSON 前500字符: " + (json != null ? json.substring(0, Math.min(500, json.length())) : "null"));
            throw new ApiException(HttpStatus.BAD_GATEWAY, "OPENAI_RESPONSE_INVALID",
                    "大模型返回的简历分析格式无效: " + exception.getMessage());
        } catch (RuntimeException exception) {
            System.getLogger(ResumeAnalysisResult.class.getName())
                    .log(System.Logger.Level.WARNING, "简历分析 JSON 解析异常: " + exception.getMessage());
            throw new ApiException(HttpStatus.BAD_GATEWAY, "OPENAI_RESPONSE_INVALID", "大模型返回的简历分析格式无效，未生成可用结论");
        }
    }

    private static String extractJsonObject(String value) {
        if (value == null) throw new IllegalArgumentException("Missing JSON response");
        String clean = value.trim();
        if (clean.startsWith("```")) {
            int firstLineEnd = clean.indexOf('\n');
            int closingFence = clean.lastIndexOf("```");
            if (firstLineEnd >= 0 && closingFence > firstLineEnd) {
                clean = clean.substring(firstLineEnd + 1, closingFence).trim();
            }
        }
        int start = clean.indexOf('{');
        int end = clean.lastIndexOf('}');
        if (start < 0 || end < start) throw new IllegalArgumentException("Missing JSON object");
        return clean.substring(start, end + 1);
    }

    static ResumeAnalysisResult parseStored(String json, ObjectMapper mapper) {
        try {
            return validate(normalize(mapper.readValue(json, ResumeAnalysisResult.class)));
        } catch (RuntimeException exception) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "RESUME_ANALYSIS_RECORD_INVALID", "已保存的简历分析记录无法读取");
        }
    }

    private static ResumeAnalysisResult normalize(ResumeAnalysisResult value) {
        if (value == null) return null;
        List<ResumeAnalysisEvidence> evidence = value.evidence() == null ? null : value.evidence().stream()
                .filter(item -> item != null && meaningful(item.criterion()) && meaningful(item.finding()))
                .map(item -> new ResumeAnalysisEvidence(item.criterion().trim(), item.finding().trim(),
                        normalizeEvidenceStatus(item.status())))
                .toList();
        List<String> followUpQuestions = new ArrayList<>(cleanTextList(value.followUpQuestions()));
        List<String> defaults = List.of("请补充说明最近一份工作的主要职责？", "请介绍一个与岗位相关的项目成果？", "最快何时可以到岗？");
        for (String question : defaults) {
            if (followUpQuestions.size() >= 3) break;
            if (!followUpQuestions.contains(question)) followUpQuestions.add(question);
        }
        return new ResumeAnalysisResult(trim(value.candidateName()), normalizeRecommendation(value.recommendation()), trim(value.summary()), evidence,
                cleanTextList(value.gaps()), cleanTextList(value.risks()), followUpQuestions);
    }

    private static String normalizeRecommendation(String value) {
        if (value == null) return null;
        return switch (value.trim().toUpperCase(Locale.ROOT)) {
            case "INTERVIEW_RECOMMENDED", "STRONG_MATCH", "HIGH_MATCH", "RECOMMENDED", "PRIORITY" -> "PRIORITY_VIEW";
            case "MATCHED", "PARTIAL_MATCH", "NORMAL", "REVIEW" -> "NORMAL_VIEW";
            case "NEEDS_MORE_INFO", "INSUFFICIENT_INFO", "UNCERTAIN", "UNKNOWN" -> "INFORMATION_NEEDED";
            default -> value.trim().toUpperCase(Locale.ROOT);
        };
    }

    private static String normalizeEvidenceStatus(String value) {
        if (value == null) return "UNCLEAR";
        String normalized = value.trim().toUpperCase(Locale.ROOT).replaceAll("[\\s-]+", "_");
        return switch (normalized) {
            case "FOUND", "MATCH", "MATCHED", "PRESENT", "YES", "TRUE", "PASS", "符合", "匹配", "存在" -> "FOUND";
            case "NOT_FOUND", "MISS", "MISSING", "ABSENT", "NOT_PRESENT", "NO", "FALSE", "FAIL", "未找到", "不匹配", "缺失" -> "NOT_FOUND";
            case "UNCLEAR", "UNKNOWN", "UNDETERMINED", "UNCERTAIN", "NOT_SURE", "UNSURE", "不明确", "未知", "无法判断" -> "UNCLEAR";
            default -> normalized;
        };
    }

    private static List<String> cleanTextList(List<String> values) {
        return values == null ? new ArrayList<>() : values.stream().filter(ResumeAnalysisResult::meaningful).map(String::trim).toList();
    }

    private static String trim(String value) { return value == null ? null : value.trim(); }

    private static ResumeAnalysisResult validate(ResumeAnalysisResult value) {
        if (value == null)
            throw new IllegalArgumentException("value is null");
        if (value.candidateName() != null && value.candidateName().length() > 100)
            throw new IllegalArgumentException("candidateName 过长");
        if (!RECOMMENDATIONS.contains(value.recommendation()))
            throw new IllegalArgumentException("recommendation 无效: '" + value.recommendation() + "'");
        if (!usable(value.summary(), 1200))
            throw new IllegalArgumentException("summary 无效: " + (value.summary() == null ? "null" : "长度=" + value.summary().length()));
        if (!validTextList(value.gaps(), 8, 400))
            throw new IllegalArgumentException("gaps 无效: 数量=" + (value.gaps() == null ? "null" : value.gaps().size()));
        if (!validTextList(value.risks(), 8, 400))
            throw new IllegalArgumentException("risks 无效: 数量=" + (value.risks() == null ? "null" : value.risks().size()));
        if (!validTextList(value.followUpQuestions(), 5, 400))
            throw new IllegalArgumentException("followUpQuestions 无效: 数量=" + (value.followUpQuestions() == null ? "null" : value.followUpQuestions().size()));
        if (value.followUpQuestions().size() < 3)
            throw new IllegalArgumentException("followUpQuestions 不足3个: 实际=" + value.followUpQuestions().size());
        if (value.evidence() == null)
            throw new IllegalArgumentException("evidence is null");
        if (value.evidence().isEmpty())
            throw new IllegalArgumentException("evidence 为空(可能全部被 normalize 过滤)");
        if (value.evidence().size() > 8)
            throw new IllegalArgumentException("evidence 超过8条: " + value.evidence().size());
        for (int i = 0; i < value.evidence().size(); i++) {
            ResumeAnalysisEvidence item = value.evidence().get(i);
            if (item == null)
                throw new IllegalArgumentException("evidence[" + i + "] is null");
            if (!usable(item.criterion(), 160))
                throw new IllegalArgumentException("evidence[" + i + "].criterion 无效: " + (item.criterion() == null ? "null" : "长度=" + item.criterion().length()));
            if (!usable(item.finding(), 600))
                throw new IllegalArgumentException("evidence[" + i + "].finding 无效: " + (item.finding() == null ? "null" : "长度=" + item.finding().length()));
            if (!List.of("FOUND", "NOT_FOUND", "UNCLEAR").contains(item.status()))
                throw new IllegalArgumentException("evidence[" + i + "].status 无效: '" + item.status() + "'");
        }
        return value;
    }

    private static boolean validTextList(List<String> values, int maxCount, int maxLength) {
        return values != null && values.size() <= maxCount && values.stream().allMatch(value -> usable(value, maxLength));
    }

    private static boolean usable(String value, int maxLength) {
        return meaningful(value) && value.length() <= maxLength;
    }

    private static boolean meaningful(String value) {
        return value != null && !value.isBlank() && value.codePoints().anyMatch(Character::isLetterOrDigit);
    }
}

record ResumeAnalysisEvidence(String criterion, String finding, String status) {}
