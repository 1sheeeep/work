package ai.xzkj.recruitment.candidates;

import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/candidate-contacts")
public class CandidateController {
    private final CandidateService service;
    public CandidateController(CandidateService service) { this.service = service; }

    @GetMapping public List<CandidateContactResponse> list(@RequestParam(required = false) String keyword,
            @RequestParam(required = false) UUID companyId, @RequestParam(required = false) UUID jobPositionId,
            @RequestParam(required = false) CandidateContactStatus status,
            @RequestParam(required = false) Boolean humanTakenOver) {
        return service.list(keyword, companyId, jobPositionId, status, humanTakenOver);
    }
    @GetMapping("/{id}") public CandidateDetailResponse detail(@PathVariable UUID id) { return service.detail(id); }
    @PostMapping("/{id}/takeover") public CandidateContactResponse takeOver(@PathVariable UUID id) { return service.takeOver(id); }
    @PostMapping("/{id}/release") public CandidateContactResponse release(@PathVariable UUID id) { return service.release(id); }
    @PostMapping("/{id}/screening/human") public CandidateContactResponse humanDecision(@PathVariable UUID id, @Valid @RequestBody HumanDecisionRequest request) { return service.humanDecision(id, request); }
    @PostMapping("/{id}/anonymize") @PreAuthorize("hasAnyRole('SYSTEM_ADMIN', 'RECRUITMENT_ADMIN')")
    public CandidateContactResponse anonymize(@PathVariable UUID id) { return service.anonymize(id); }
}
