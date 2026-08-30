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
import java.util.UUID;

record ResumeAnalysisRequest(
        @NotBlank @Size(max = 30000) String resumeText,
        @AssertTrue(message = "请确认已获授权将该简历内容发送给 OpenAI 分析") boolean externalProcessingConfirmed
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
        ResumeAnalysisResult result,
        String errorMessage,
        List<ResumeAnalysisFeedbackResponse> feedback,
        String createdBy,
        Instant createdAt
) {
    static ResumeAnalysisResponse from(AiAssistanceRun run, ObjectMapper mapper, List<ResumeAnalysisFeedback> feedback) {
        ResumeAnalysisResult result = run.getStructuredResult() == null ? null
                : ResumeAnalysisResult.parseStored(run.getStructuredResult(), mapper);
        ResumeIntake intake = run.getResumeIntake();
        return new ResumeAnalysisResponse(
                run.getId(), intake.getId(), intake.getContact().getCandidate().getDisplayName(),
                intake.getContact().getJobPosition().getTitle(), run.getProvider(), run.getModelVersion(),
                run.getStatus(), result, run.getErrorMessage(), feedback.stream().map(ResumeAnalysisFeedbackResponse::from).toList(),
                run.getCreatedBy().getDisplayName(), run.getCreatedAt()
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
            return validate(mapper.readValue(json, ResumeAnalysisResult.class));
        } catch (RuntimeException exception) {
            throw new ApiException(HttpStatus.BAD_GATEWAY, "OPENAI_RESPONSE_INVALID", "OpenAI 返回的简历分析格式无效，未生成可用结论");
        }
    }

    static ResumeAnalysisResult parseStored(String json, ObjectMapper mapper) {
        try {
            return validate(mapper.readValue(json, ResumeAnalysisResult.class));
        } catch (RuntimeException exception) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "RESUME_ANALYSIS_RECORD_INVALID", "已保存的简历分析记录无法读取");
        }
    }

    private static ResumeAnalysisResult validate(ResumeAnalysisResult value) {
        if (value == null || !RECOMMENDATIONS.contains(value.recommendation()) || !usable(value.summary(), 1200)
                || !validTextList(value.gaps(), 8, 400) || !validTextList(value.risks(), 8, 400)
                || !validTextList(value.followUpQuestions(), 5, 400) || value.followUpQuestions().size() < 3
                || value.evidence() == null || value.evidence().isEmpty() || value.evidence().size() > 8
                || value.evidence().stream().anyMatch(item -> item == null || !usable(item.criterion(), 160)
                || !usable(item.finding(), 600) || !List.of("FOUND", "NOT_FOUND", "UNCLEAR").contains(item.status()))) {
            throw new IllegalArgumentException("Invalid resume analysis result");
        }
        return value;
    }

    private static boolean validTextList(List<String> values, int maxCount, int maxLength) {
        return values != null && values.size() <= maxCount && values.stream().allMatch(value -> usable(value, maxLength));
    }

    private static boolean usable(String value, int maxLength) {
        return value != null && !value.isBlank() && value.length() <= maxLength;
    }
}

record ResumeAnalysisEvidence(String criterion, String finding, String status) {}
