package ai.xzkj.recruitment.localconnector;

import ai.xzkj.recruitment.candidates.ConversationMessageResponse;

import java.util.List;
import java.util.UUID;

record AiDutyConversationTimelineResponse(
        UUID observationId,
        String anonymousKey,
        UUID contactId,
        boolean available,
        String reason,
        List<ConversationMessageResponse> messages) {
}
