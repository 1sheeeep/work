package ai.xzkj.recruitment.candidates;

import java.time.Instant;
import java.util.UUID;

public record ConversationMessageResponse(UUID id, String externalMessageId, MessageDirection direction,
                                          MessageSenderType senderType, MessageDeliveryStatus deliveryStatus,
                                          String content, String modelVersion, String promptVersion,
                                          ScreeningDecisionResponse.UserSummary createdBy,
                                          Instant approvedAt, Instant createdAt) {
    public static ConversationMessageResponse from(ConversationMessage message) {
        return new ConversationMessageResponse(message.getId(), message.getExternalMessageId(), message.getDirection(),
                message.getSenderType(), message.getDeliveryStatus(), message.getContent(), message.getModelVersion(),
                message.getPromptVersion(), message.getCreatedBy() == null ? null
                : new ScreeningDecisionResponse.UserSummary(message.getCreatedBy().getId(), message.getCreatedBy().getDisplayName()),
                message.getApprovedAt(), message.getCreatedAt());
    }
}
