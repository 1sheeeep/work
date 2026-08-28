package ai.xzkj.recruitment.autoreply;

import java.time.Instant;
import java.util.UUID;

public record AutoReplyAttemptResponse(UUID id,UUID accountId,String accountName,UUID contactId,String candidateName,String jobTitle,
        AutoReplyAttemptStatus status,String resultMessage,UUID outboundMessageId,int attemptCount,Instant createdAt,Instant completedAt){
    static AutoReplyAttemptResponse from(AutoReplyAttempt a){return new AutoReplyAttemptResponse(a.getId(),a.getBossAccount().getId(),a.getBossAccount().getDisplayName(),a.getContact().getId(),a.getContact().getCandidate().getDisplayName(),a.getContact().getJobPosition().getTitle(),a.getStatus(),a.getResultMessage(),a.getOutboundMessage()==null?null:a.getOutboundMessage().getId(),a.getAttemptCount(),a.getCreatedAt(),a.getCompletedAt());}
}
