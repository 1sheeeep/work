package cn.xzkj.erp.tenantaccess;

import cn.xzkj.erp.iam.application.IamActor;
import cn.xzkj.erp.iam.application.IamAdministrationService;
import cn.xzkj.erp.iam.application.IamAdministrationService.MemberView;
import cn.xzkj.erp.iam.application.PageResult;
import cn.xzkj.erp.iam.domain.AccountStatus;
import cn.xzkj.erp.iam.domain.IamPermissionCodes;
import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.tenantaccess.UserApplicationAccessService.AccessView;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.UUID;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/iam/member-applications")
public class MemberApplicationAccessController {

    private final IamAdministrationService administrationService;
    private final UserApplicationAccessService accessService;

    public MemberApplicationAccessController(
            IamAdministrationService administrationService,
            UserApplicationAccessService accessService) {
        this.administrationService = administrationService;
        this.accessService = accessService;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('" + IamPermissionCodes.USER_READ + "')")
    public PageResult<MemberApplicationAccess> list(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(required = false) String query,
            @RequestParam(required = false) AccountStatus status,
            @RequestParam(defaultValue = "0")
            @Min(0) @Max(IamAdministrationService.MAX_PAGE_NUMBER) int page,
            @RequestParam(defaultValue = "20")
            @Min(1) @Max(IamAdministrationService.MAX_PAGE_SIZE) int size,
            HttpServletRequest request) {
        IamActor actor = actor(principal, request);
        PageResult<MemberView> members = administrationService.listMembers(
                principal.tenantId(), query, status, null, page, size);
        List<MemberApplicationAccess> items = members.items().stream()
                .map(member -> response(
                        member,
                        accessService.administratorView(actor, member.id())))
                .toList();
        return PageResult.of(items, page, size, members.totalElements());
    }

    @PutMapping("/{userId}/applications")
    @PreAuthorize("hasAuthority('" + IamPermissionCodes.USER_WRITE + "')")
    public AccessView replace(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID userId,
            @Valid @RequestBody ReplaceApplicationsRequest body,
            HttpServletRequest request) {
        return accessService.replace(
                actor(principal, request),
                userId,
                body.version(),
                new LinkedHashSet<>(body.applications()));
    }

    private static MemberApplicationAccess response(
            MemberView member,
            AccessView access) {
        return new MemberApplicationAccess(
                member.id(),
                member.username(),
                member.email(),
                member.phoneNumber(),
                member.displayName(),
                member.status(),
                access.version(),
                access.enterpriseAdministrator(),
                access.applications());
    }

    private static IamActor actor(
            ErpPrincipal principal,
            HttpServletRequest request) {
        String requestId = request.getHeader("X-Request-Id");
        if (requestId != null) {
            requestId = requestId.strip();
            if (requestId.isEmpty()
                    || !requestId.matches("^[A-Za-z0-9._:-]{1,100}$")) {
                requestId = null;
            }
        }
        return new IamActor(
                principal.tenantId(),
                principal.userId(),
                principal.systemAdminId(),
                requestId,
                request.getRemoteAddr());
    }

    public record ReplaceApplicationsRequest(
            @NotNull @PositiveOrZero Long version,
            @NotNull @Size(max = 4)
            List<@NotBlank @Pattern(regexp = "^[A-Z][A-Z_]{1,39}$") String> applications) {
    }

    public record MemberApplicationAccess(
            UUID id,
            String username,
            String email,
            String phoneNumber,
            String displayName,
            AccountStatus status,
            long version,
            boolean enterpriseAdministrator,
            List<String> applications) {

        public MemberApplicationAccess {
            applications = List.copyOf(applications);
        }
    }
}
