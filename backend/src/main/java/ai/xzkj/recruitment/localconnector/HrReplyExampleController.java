package ai.xzkj.recruitment.localconnector;

import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
class HrReplyExampleController {
    private final HrReplyExampleService service;
    HrReplyExampleController(HrReplyExampleService service) { this.service = service; }

    @PostMapping("/api/hr-reply-examples/import")
    HrReplyExampleImportResponse importTranscript(@Valid @RequestBody HrReplyExampleImportRequest request) {
        return service.importTranscript(request);
    }
}
