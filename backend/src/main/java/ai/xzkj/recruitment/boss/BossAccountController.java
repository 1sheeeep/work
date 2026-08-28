package ai.xzkj.recruitment.boss;

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
@RequestMapping("/api/boss-accounts")
public class BossAccountController {
    private final BossAccountService service;

    public BossAccountController(BossAccountService service) { this.service = service; }

    @GetMapping
    public List<BossAccountResponse> list(@RequestParam(required = false) String keyword,
                                          @RequestParam(required = false) UUID companyId,
                                          @RequestParam(required = false) BossAccountStatus status,
                                          @RequestParam(required = false) BossConnectionStatus connectionStatus) {
        return service.list(keyword, companyId, status, connectionStatus);
    }

    @PostMapping
    @PreAuthorize("hasAnyRole('SYSTEM_ADMIN', 'RECRUITMENT_ADMIN')")
    public BossAccountResponse create(@Valid @RequestBody BossAccountUpsertRequest request) {
        return service.create(request);
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAnyRole('SYSTEM_ADMIN', 'RECRUITMENT_ADMIN')")
    public BossAccountResponse update(@PathVariable UUID id, @Valid @RequestBody BossAccountUpsertRequest request) {
        return service.update(id, request);
    }

    @PatchMapping("/{id}/status")
    @PreAuthorize("hasAnyRole('SYSTEM_ADMIN', 'RECRUITMENT_ADMIN')")
    public BossAccountResponse changeStatus(@PathVariable UUID id,
                                             @Valid @RequestBody BossAccountStatusRequest request) {
        return service.changeStatus(id, request.status());
    }

    @PostMapping("/{id}/capabilities/check")
    @PreAuthorize("hasAnyRole('SYSTEM_ADMIN', 'RECRUITMENT_ADMIN')")
    public BossAccountResponse checkCapabilities(@PathVariable UUID id) {
        return service.checkCapabilities(id);
    }
}
