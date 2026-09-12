package ai.xzkj.recruitment.candidates;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import jakarta.validation.Valid;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/talent-candidates")
public class TalentCandidateController {
    private final TalentCandidateService service;
    private final CandidateMergeService mergeService;

    public TalentCandidateController(TalentCandidateService service, CandidateMergeService mergeService) {
        this.service = service; this.mergeService = mergeService;
    }

    @GetMapping
    public List<TalentCandidateResponse> list(
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) CandidateSource source,
            @RequestParam(required = false) CandidatePrivacyStatus privacyStatus) {
        return service.list(keyword, source, privacyStatus);
    }

    @GetMapping("/page")
    public TalentCandidatePageResponse page(
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) CandidateSource source,
            @RequestParam(required = false) CandidatePrivacyStatus privacyStatus,
            @RequestParam(required = false) UUID companyId,
            @RequestParam(required = false) UUID jobPositionId,
            @RequestParam(required = false) CandidateContactStatus contactStatus,
            @RequestParam(required = false) String analysisStatus,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "30") int pageSize) {
        return service.page(keyword, source, privacyStatus, companyId, jobPositionId, contactStatus,
                analysisStatus, page, pageSize);
    }

    @GetMapping("/audit")
    @PreAuthorize("hasAnyRole('SYSTEM_ADMIN', 'RECRUITMENT_ADMIN')")
    public TalentCandidateAuditResponse audit() {
        return service.audit();
    }

    @GetMapping("/duplicate-preview")
    @PreAuthorize("hasAnyRole('SYSTEM_ADMIN', 'RECRUITMENT_ADMIN')")
    public CandidateDuplicatePreviewResponse duplicatePreview() {
        return service.duplicatePreview();
    }

    @PostMapping("/merge")
    @PreAuthorize("hasAnyRole('SYSTEM_ADMIN', 'RECRUITMENT_ADMIN')")
    public CandidateMergeOperationResponse merge(@Valid @RequestBody CandidateMergeRequest request) {
        return mergeService.merge(request);
    }

    @PostMapping("/merge/preview")
    @PreAuthorize("hasAnyRole('SYSTEM_ADMIN', 'RECRUITMENT_ADMIN')")
    public CandidateMergePreviewResponse mergePreview(@Valid @RequestBody CandidateMergeRequest request) {
        return mergeService.preview(request);
    }

    @GetMapping("/merge/operations")
    @PreAuthorize("hasAnyRole('SYSTEM_ADMIN', 'RECRUITMENT_ADMIN')")
    public List<CandidateMergeOperationResponse> mergeOperations(
            @RequestParam(defaultValue = "false") boolean activeOnly) {
        return mergeService.operations(activeOnly);
    }

    @PostMapping("/merge/{operationId}/undo")
    @PreAuthorize("hasAnyRole('SYSTEM_ADMIN', 'RECRUITMENT_ADMIN')")
    public CandidateMergeOperationResponse undoMerge(@PathVariable UUID operationId) {
        return mergeService.undo(operationId);
    }

    @GetMapping("/{candidateId}")
    public TalentCandidateDetailResponse detail(@PathVariable UUID candidateId) {
        return service.detail(candidateId);
    }
}
