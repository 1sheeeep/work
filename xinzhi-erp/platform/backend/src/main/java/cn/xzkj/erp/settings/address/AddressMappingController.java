package cn.xzkj.erp.settings.address;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.settings.address.AddressMappingService.AddressType;
import cn.xzkj.erp.settings.address.AddressMappingService.Platform;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

@RestController
@Validated
@RequestMapping("/api/v1/settings/address-mappings")
public class AddressMappingController {
    private final AddressMappingService service;

    public AddressMappingController(AddressMappingService service) {
        this.service = service;
    }

    @GetMapping("/config")
    @PreAuthorize("hasAuthority('settings.read')")
    public SettingResponse getSetting(
            @AuthenticationPrincipal ErpPrincipal principal,
            HttpServletRequest request) {
        return SettingResponse.from(service.getSetting(actor(principal, request)));
    }

    @PutMapping("/config")
    @PreAuthorize("hasAuthority('settings.parameter.write')")
    public SettingResponse saveSetting(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody SaveSettingRequest body,
            HttpServletRequest request) {
        return SettingResponse.from(service.saveSetting(actor(principal, request),
                body.expectedVersion(), body.enabled()));
    }

    @GetMapping
    @PreAuthorize("hasAuthority('settings.read')")
    public PageResponse list(@AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(required = false) Platform platform,
            @RequestParam(required = false) @Pattern(regexp = "^[A-Za-z]{2}$") String countryCode,
            @RequestParam(required = false) AddressType addressType,
            @RequestParam(required = false) @Size(max = 120) String keyword,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "25") @Min(1) @Max(100) int size,
            HttpServletRequest request) {
        return PageResponse.from(service.list(actor(principal, request),
                new AddressMappingService.MappingQuery(platform, countryCode,
                        addressType, keyword, page, size)));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('settings.parameter.write')")
    @ResponseStatus(HttpStatus.CREATED)
    public MappingResponse create(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody MappingRequest body,
            HttpServletRequest request) {
        return MappingResponse.from(service.create(actor(principal, request),
                body.input()));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('settings.parameter.write')")
    public MappingResponse update(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID id,
            @Valid @RequestBody UpdateMappingRequest body,
            HttpServletRequest request) {
        return MappingResponse.from(service.update(actor(principal, request), id,
                body.expectedVersion(), body.input()));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAuthority('settings.parameter.write')")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID id,
            @RequestParam @Min(0) long expectedVersion,
            HttpServletRequest request) {
        service.delete(actor(principal, request), id, expectedVersion);
    }

    private static AddressMappingService.Actor actor(ErpPrincipal principal,
            HttpServletRequest request) {
        String requestId = request.getHeader("X-Request-Id");
        if (requestId == null || !requestId.matches("^[A-Za-z0-9._:-]{1,100}$")) {
            requestId = UUID.randomUUID().toString();
        }
        return new AddressMappingService.Actor(
                principal.tenantId(), principal.userId(),
                principal.systemAdminId(), principal.displayName(), requestId,
                request.getRemoteAddr());
    }

    public record SaveSettingRequest(@Min(0) long expectedVersion,
            boolean enabled) {
    }

    public record MappingRequest(@NotNull Platform platform,
            @NotBlank @Pattern(regexp = "^[A-Za-z]{2}$") String countryCode,
            @NotNull AddressType addressType,
            @NotBlank @Size(max = 120) String sourceValue,
            @NotBlank @Size(max = 120) String mappedValue,
            boolean enabled) {
        AddressMappingService.MappingInput input() {
            return new AddressMappingService.MappingInput(platform, countryCode,
                    addressType, sourceValue, mappedValue, enabled);
        }
    }

    public record UpdateMappingRequest(@Min(0) long expectedVersion,
            @NotNull Platform platform,
            @NotBlank @Pattern(regexp = "^[A-Za-z]{2}$") String countryCode,
            @NotNull AddressType addressType,
            @NotBlank @Size(max = 120) String sourceValue,
            @NotBlank @Size(max = 120) String mappedValue,
            boolean enabled) {
        AddressMappingService.MappingInput input() {
            return new AddressMappingService.MappingInput(platform, countryCode,
                    addressType, sourceValue, mappedValue, enabled);
        }
    }

    public record SettingResponse(boolean configured, boolean enabled,
            long version, String updatedByDisplayName,
            Instant createdAt, Instant updatedAt) {
        static SettingResponse from(AddressMappingSettingRecord source) {
            return new SettingResponse(source.configured(), source.enabled(),
                    source.version(), source.updatedByDisplayName(),
                    source.createdAt(), source.updatedAt());
        }
    }

    public record MappingResponse(UUID id, Platform platform, String countryCode,
            AddressType addressType, String sourceValue, String mappedValue,
            boolean enabled, long version, String updatedByDisplayName,
            Instant createdAt, Instant updatedAt) {
        static MappingResponse from(AddressMappingRecord source) {
            return new MappingResponse(source.id(), source.platform(),
                    source.countryCode(), source.addressType(),
                    source.sourceValue(), source.mappedValue(), source.enabled(),
                    source.version(), source.updatedByDisplayName(),
                    source.createdAt(), source.updatedAt());
        }
    }

    public record PageResponse(List<MappingResponse> items, int page, int size,
            long totalElements, int totalPages) {
        static PageResponse from(AddressMappingService.MappingPage source) {
            return new PageResponse(source.items().stream()
                    .map(MappingResponse::from).toList(), source.page(),
                    source.size(), source.totalElements(), source.totalPages());
        }
    }
}
