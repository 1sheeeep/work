package ai.xzkj.recruitment.localconnector;

import jakarta.validation.Valid;
import org.springframework.http.HttpHeaders;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

/** Receives a locally redacted transcript only from the paired browser device. */
@RestController
class LocalConnectorHrReplyExampleController {
    private final LocalConnectorService connectors;
    private final HrReplyExampleService examples;

    LocalConnectorHrReplyExampleController(LocalConnectorService connectors, HrReplyExampleService examples) {
        this.connectors = connectors;
        this.examples = examples;
    }

    @PostMapping("/api/local-connector/runtime/hr-reply-examples/import")
    HrReplyExampleImportResponse importTranscript(@RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
                                                   @Valid @RequestBody HrReplyExampleImportRequest request) {
        return examples.importTranscriptFromDevice(connectors.authenticate(authorization), request);
    }
}
