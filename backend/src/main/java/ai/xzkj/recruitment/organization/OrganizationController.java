package ai.xzkj.recruitment.organization;

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
@RequestMapping("/api/organization")
public class OrganizationController {
    private final OrganizationService service;

    public OrganizationController(OrganizationService service) {
        this.service = service;
    }

    @GetMapping("/group")
    public GroupResponse getGroup() {
        return service.getGroup();
    }

    @PutMapping("/group")
    @PreAuthorize("hasRole('SYSTEM_ADMIN')")
    public GroupResponse updateGroup(@Valid @RequestBody GroupUpdateRequest request) {
        return service.updateGroup(request);
    }

    @GetMapping("/companies")
    public List<CompanyResponse> listCompanies(
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) CompanyStatus status
    ) {
        return service.listCompanies(keyword, status);
    }

    @PostMapping("/companies")
    @PreAuthorize("hasRole('SYSTEM_ADMIN')")
    public CompanyResponse createCompany(@Valid @RequestBody CompanyUpsertRequest request) {
        return service.createCompany(request);
    }

    @PutMapping("/companies/{id}")
    @PreAuthorize("hasRole('SYSTEM_ADMIN')")
    public CompanyResponse updateCompany(
            @PathVariable UUID id,
            @Valid @RequestBody CompanyUpsertRequest request
    ) {
        return service.updateCompany(id, request);
    }

    @PatchMapping("/companies/{id}/status")
    @PreAuthorize("hasRole('SYSTEM_ADMIN')")
    public CompanyResponse changeCompanyStatus(
            @PathVariable UUID id,
            @Valid @RequestBody CompanyStatusRequest request
    ) {
        return service.changeCompanyStatus(id, request.status());
    }
}
