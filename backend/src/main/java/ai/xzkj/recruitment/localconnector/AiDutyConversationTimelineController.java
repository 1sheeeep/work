package ai.xzkj.recruitment.localconnector;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/** Read-only endpoint consumed by the Today Duty conversation workspace. */
@RestController
class AiDutyConversationTimelineController {
    private final AiDutyConversationTimelineService service;

    AiDutyConversationTimelineController(AiDutyConversationTimelineService service) {
        this.service = service;
    }

    @GetMapping("/api/local-connector/ai-duty-sessions/{observationId}/timeline")
    AiDutyConversationTimelineResponse timeline(@PathVariable UUID observationId) {
        return service.timeline(observationId);
    }
}
