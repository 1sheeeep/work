package cn.xzkj.erp.logistics.authorization;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.logistics.authorization.LogisticsCredentialCipher.CredentialMaterial;
import cn.xzkj.erp.platform.api.PageEnvelope;
import cn.xzkj.erp.platform.domain.CredentialReferenceValidator;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Validated
@RequestMapping("/api/v1/logistics/authorizations")
public class LogisticsAuthorizationController {
    private final LogisticsAuthorizationService service;
    private final LogisticsProviderSystemConfigService providerConfigService;

    public LogisticsAuthorizationController(LogisticsAuthorizationService service,
            LogisticsProviderSystemConfigService providerConfigService) {
        this.service = service;
        this.providerConfigService = providerConfigService;
    }

    @GetMapping("/providers")
    @PreAuthorize("hasAuthority('logistics.read')")
    public ProviderListResponse listProviders() {
        return new ProviderListResponse(providerConfigService.list().stream()
                .map(value -> new ProviderResponse(
                        value.providerCode(), value.providerName()))
                .toList());
    }

    @GetMapping
    @PreAuthorize("hasAuthority('logistics.read')")
    public PageEnvelope<AuthorizationResponse> list(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(defaultValue = "PLATFORM") @Size(max = 24) String category,
            @RequestParam(required = false) @Size(max = 120) String name,
            @RequestParam(required = false) @Size(max = 16) String status,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "25") @Min(1) @Max(100) int pageSize,
            HttpServletRequest request) {
        return PageEnvelope.from(service.list(actor(principal, request), category,
                name, status, PageRequest.of(page, pageSize)),
                AuthorizationResponse::from);
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAuthority('logistics.read')")
    public AuthorizationResponse get(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID id,
            HttpServletRequest request) {
        return AuthorizationResponse.from(service.get(actor(principal, request), id));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('logistics.authorization.write')")
    public AuthorizationResponse create(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody AuthorizationWriteRequest body,
            HttpServletRequest request) {
        return AuthorizationResponse.from(service.create(
                actor(principal, request), body.input(), body.credentialMaterial()));
    }

    @PostMapping("/{id}/probe")
    @PreAuthorize("hasAuthority('logistics.authorization.write')")
    public ProbeResponse probe(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID id,
            @Valid @RequestBody ProbeRequest body,
            HttpServletRequest request) {
        var outcome = service.probe(actor(principal, request), id, body.version());
        return new ProbeResponse(AuthorizationResponse.from(outcome.authorization()),
                outcome.status(), outcome.message());
    }

    @PutMapping("/{id}/credentials")
    @PreAuthorize("hasAuthority('logistics.authorization.write')")
    public AuthorizationResponse replaceCredentials(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID id,
            @Valid @RequestBody CredentialUpdateRequest body,
            HttpServletRequest request) {
        return AuthorizationResponse.from(service.replaceCredentials(
                actor(principal, request), id, body.version(),
                body.credentials().material()));
    }

    @PutMapping("/{id}/name")
    @PreAuthorize("hasAuthority('logistics.authorization.write')")
    public AuthorizationResponse renameAccount(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID id,
            @Valid @RequestBody AccountNameUpdateRequest body,
            HttpServletRequest request) {
        return AuthorizationResponse.from(service.renameAccount(
                actor(principal, request), id, body.version(), body.accountLabel()));
    }

    @PostMapping("/{id}/archive")
    @PreAuthorize("hasAuthority('logistics.authorization.write')")
    public AuthorizationResponse archive(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID id,
            @Valid @RequestBody ArchiveRequest body,
            HttpServletRequest request) {
        return AuthorizationResponse.from(service.archive(
                actor(principal, request), id, body.version()));
    }

    @PostMapping("/{id}/enable")
    @PreAuthorize("hasAuthority('logistics.authorization.write')")
    public AuthorizationResponse enable(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID id,
            @Valid @RequestBody VersionRequest body,
            HttpServletRequest request) {
        return AuthorizationResponse.from(service.enable(
                actor(principal, request), id, body.version()));
    }

    @PostMapping("/{id}/unbind")
    @PreAuthorize("hasAuthority('logistics.authorization.write')")
    public UnbindResponse unbind(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID id,
            @Valid @RequestBody VersionRequest body,
            HttpServletRequest request) {
        service.unbind(actor(principal, request), id, body.version());
        return new UnbindResponse(id);
    }

    @GetMapping("/{id}/channels")
    @PreAuthorize("hasAuthority('logistics.read')")
    public ChannelListResponse listChannels(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID id,
            HttpServletRequest request) {
        return new ChannelListResponse(service.listChannels(
                actor(principal, request), id).stream()
                .map(ChannelResponse::from).toList());
    }

    @GetMapping("/enabled-channels")
    @PreAuthorize("hasAuthority('logistics.read')")
    public ChannelListResponse listEnabledChannels(
            @AuthenticationPrincipal ErpPrincipal principal,
            HttpServletRequest request) {
        return new ChannelListResponse(service.listEnabledChannels(
                actor(principal, request)).stream()
                .map(ChannelResponse::from).toList());
    }

    @PostMapping("/{id}/channels/{channelId}/enable")
    @PreAuthorize("hasAuthority('logistics.authorization.write')")
    public ChannelResponse enableChannel(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID id,
            @PathVariable UUID channelId,
            @Valid @RequestBody VersionRequest body,
            HttpServletRequest request) {
        return ChannelResponse.from(service.setChannelEnabled(
                actor(principal, request), id, channelId, body.version(), true));
    }

    @PostMapping("/{id}/channels/{channelId}/disable")
    @PreAuthorize("hasAuthority('logistics.authorization.write')")
    public ChannelResponse disableChannel(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID id,
            @PathVariable UUID channelId,
            @Valid @RequestBody VersionRequest body,
            HttpServletRequest request) {
        return ChannelResponse.from(service.setChannelEnabled(
                actor(principal, request), id, channelId, body.version(), false));
    }

    private static LogisticsAuthorizationService.Actor actor(
            ErpPrincipal principal, HttpServletRequest request) {
        String requestId = request.getHeader("X-Request-Id");
        if (requestId == null || !requestId.matches("^[A-Za-z0-9._:-]{1,100}$")) {
            requestId = UUID.randomUUID().toString();
        }
        return new LogisticsAuthorizationService.Actor(
                principal.tenantId(), principal.userId(), principal.systemAdminId(),
                principal.displayName(), requestId, request.getRemoteAddr());
    }

    public record AuthorizationWriteRequest(
            @NotBlank @Size(max = 24) String category,
            @NotBlank @Size(max = 64) String providerCode,
            @NotBlank @Size(max = 120) String providerName,
            @NotBlank @Size(max = 160) String accountLabel,
            @NotBlank @Size(max = 32) String integrationMode,
            @Size(max = 512)
            @Pattern(regexp = CredentialReferenceValidator.REFERENCE_PATTERN)
            String credentialReference,
            @Valid DirectCredentialsRequest credentials,
            @Size(max = 120) String contactName,
            @Size(max = 500) String note) {
        LogisticsAuthorizationService.AuthorizationInput input() {
            return new LogisticsAuthorizationService.AuthorizationInput(
                    category, providerCode, providerName, accountLabel, integrationMode,
                    credentialReference, contactName, note);
        }

        CredentialMaterial credentialMaterial() {
            return credentials == null ? null : credentials.material();
        }
    }

    public record DirectCredentialsRequest(
            @NotBlank @Size(max = 256) String username,
            @NotBlank @Size(max = 256) String password,
            @Size(max = 512) String key) {
        CredentialMaterial material() {
            return new CredentialMaterial(username, password, key);
        }

        @Override
        public String toString() {
            return "DirectCredentialsRequest[REDACTED]";
        }
    }

    public record CredentialUpdateRequest(
            @Min(0) long version,
            @NotNull @Valid DirectCredentialsRequest credentials) {
    }

    public record AccountNameUpdateRequest(
            @Min(0) long version,
            @NotBlank @Size(max = 160) String accountLabel) {
    }

    public record ArchiveRequest(@Min(0) long version) {
    }

    public record VersionRequest(@Min(0) long version) {
    }

    public record ProbeRequest(@Min(0) long version) {
    }

    public record AuthorizationResponse(UUID id, String category,
            String providerCode, String providerName,
            String accountLabel, String integrationMode,
            boolean credentialConfigured, String credentialType,
            String contactName, String note, String status,
            String createdByDisplayName, long version,
            Instant createdAt, Instant updatedAt) {
        static AuthorizationResponse from(LogisticsAuthorizationRecord value) {
            return new AuthorizationResponse(value.id(), value.category(),
                    value.providerCode(), value.providerName(), value.accountLabel(),
                    value.integrationMode(),
                    value.credentialConfigured(), value.credentialType(),
                    value.contactName(), value.note(), value.status(),
                    value.createdByDisplayName(), value.version(),
                    value.createdAt(), value.updatedAt());
        }
    }

    public record ProbeResponse(AuthorizationResponse authorization,
            String status, String message) {
    }

    public record ChannelResponse(UUID id, UUID authorizationId,
            String providerCode, String providerName,
            String accountLabel, String accountStatus,
            String channelCode, String channelName,
            boolean enabled, boolean providerAvailable,
            boolean effectiveEnabled, long version,
            Instant lastSyncedAt, Instant updatedAt) {
        static ChannelResponse from(LogisticsAuthorizationChannelRecord value) {
            return new ChannelResponse(value.id(), value.authorizationId(),
                    value.providerCode(), value.providerName(),
                    value.accountLabel(), value.accountStatus(),
                    value.channelCode(), value.channelName(), value.enabled(),
                    value.providerAvailable(), value.effectiveEnabled(),
                    value.version(), value.lastSyncedAt(), value.updatedAt());
        }
    }

    public record ChannelListResponse(List<ChannelResponse> items) {
    }

    public record ProviderResponse(String providerCode, String providerName) {
    }

    public record ProviderListResponse(List<ProviderResponse> items) {
    }

    public record UnbindResponse(UUID id) {
    }
}
