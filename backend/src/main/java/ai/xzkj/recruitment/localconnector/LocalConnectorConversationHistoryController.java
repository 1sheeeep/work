package ai.xzkj.recruitment.localconnector;

import jakarta.validation.Valid;
import org.springframework.http.HttpHeaders;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

/** Receives the same locally redacted transcript used by the example-library import. */
@RestController
class LocalConnectorConversationHistoryController {
    private final LocalConnectorService connectors;
    private final ConversationHistoryService history;

    LocalConnectorConversationHistoryController(LocalConnectorService connectors, ConversationHistoryService history) {
        this.connectors = connectors;
        this.history = history;
    }

    @PostMapping("/api/local-connector/runtime/conversation-history")
    ConversationHistoryImportResponse importHistory(@RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
                                                     @Valid @RequestBody ConversationHistoryImportRequest request) {
        return history.importFromDevice(connectors.authenticate(authorization), request);
    }
}
