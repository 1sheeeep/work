package ai.xzkj.recruitment.audit;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/audit-logs")
@Validated
@PreAuthorize("hasRole('SYSTEM_ADMIN')")
public class AuditController {
    private final AuditLogRepository repository;

    public AuditController(AuditLogRepository repository) {
        this.repository = repository;
    }

    @GetMapping
    public List<AuditLogResponse> list(@RequestParam(defaultValue = "50") @Min(1) @Max(100) int limit) {
        return repository.findAll(PageRequest.of(0, limit, Sort.by(Sort.Direction.DESC, "occurredAt")))
                .stream()
                .map(AuditLogResponse::from)
                .toList();
    }
}
