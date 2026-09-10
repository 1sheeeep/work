package ai.xzkj.recruitment.resumes;

import java.util.UUID;

public record ResumeDocumentProcessingResponse(UUID intakeId, String candidateName, String anonymousKey, String processingStatus,
                                               String documentType, boolean malwareScanned,
                                               String documentDigestPrefix, String extractedTextDigestPrefix,
                                               String failureCode, String failureReason, String analysisStatus,
                                               String analysisFailureCode, String analysisFailureReason,
                                               UUID sourceActionTaskId, java.time.Instant receivedAt, boolean duplicate) {
    static ResumeDocumentProcessingResponse from(ResumeIntake item, boolean duplicate) {
        String candidateName = item.getContact() == null || item.getContact().getCandidate() == null
                ? null : item.getContact().getCandidate().getDisplayName();
        return new ResumeDocumentProcessingResponse(item.getId(), candidateName, item.getResumeDigest().substring(0, 12),
                item.getProcessingStatus(), item.getDocumentType(), item.isMalwareScanned(),
                item.getResumeDigest().substring(0, 12),
                item.getExtractedTextDigest() == null ? null : item.getExtractedTextDigest().substring(0, 12),
                item.getFailureCode(), item.getFailureReason(), item.getAnalysisStatus(),
                item.getAnalysisFailureCode(), item.getAnalysisFailureReason(), item.getSourceActionTaskId(), item.getReceivedAt(), duplicate);
    }
}
