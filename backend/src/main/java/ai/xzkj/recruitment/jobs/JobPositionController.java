package ai.xzkj.recruitment.jobs;

import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/job-positions")
public class JobPositionController {
    private final JobPositionService service;

    public JobPositionController(JobPositionService service) { this.service = service; }

    @GetMapping
    public List<JobPositionResponse> list(@RequestParam(required = false) String keyword,
                                          @RequestParam(required = false) UUID companyId,
                                          @RequestParam(required = false) UUID bossAccountId,
                                          @RequestParam(required = false) JobPositionStatus status) {
        return service.list(keyword, companyId, bossAccountId, status);
    }

    @PostMapping
    @PreAuthorize("hasAnyRole('SYSTEM_ADMIN', 'RECRUITMENT_ADMIN')")
    public JobPositionResponse create(@Valid @RequestBody JobPositionUpsertRequest request) {
        return service.create(request);
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAnyRole('SYSTEM_ADMIN', 'RECRUITMENT_ADMIN')")
    public JobPositionResponse update(@PathVariable UUID id, @Valid @RequestBody JobPositionUpsertRequest request) {
        return service.update(id, request);
    }

    @PatchMapping("/{id}/status")
    @PreAuthorize("hasAnyRole('SYSTEM_ADMIN', 'RECRUITMENT_ADMIN')")
    public JobPositionResponse changeStatus(@PathVariable UUID id,
                                             @Valid @RequestBody JobPositionStatusRequest request) {
        return service.changeStatus(id, request.status());
    }

    @PutMapping("/{id}/knowledge")
    @PreAuthorize("hasAnyRole('SYSTEM_ADMIN', 'RECRUITMENT_ADMIN')")
    public JobPositionResponse updateKnowledge(@PathVariable UUID id,
                                                @Valid @RequestBody JobKnowledgeRequest request) {
        return service.updateKnowledge(id, request);
    }

    @PatchMapping("/{id}/capture-verification")
    @PreAuthorize("hasAnyRole('SYSTEM_ADMIN', 'RECRUITMENT_ADMIN')")
    public JobPositionResponse verifyVisiblePageCapture(@PathVariable UUID id) {
        return service.verifyVisiblePageCapture(id);
    }

    @GetMapping("/{id}/reply-preview")
    public ReplyPreviewResponse previewReply(@PathVariable UUID id) {
        return service.previewReply(id);
    }
}
