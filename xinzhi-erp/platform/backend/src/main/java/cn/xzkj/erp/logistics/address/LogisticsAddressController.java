package cn.xzkj.erp.logistics.address;

import java.time.Instant;
import java.util.Set;
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

import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.platform.api.PageEnvelope;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolationException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

@RestController
@Validated
@RequestMapping("/api/v1/logistics/addresses")
public class LogisticsAddressController {
    private final LogisticsAddressService service;

    public LogisticsAddressController(LogisticsAddressService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('logistics.read')")
    public PageEnvelope<SummaryResponse> list(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(required = false) String type,
            @RequestParam(defaultValue = "ACTIVE") String status,
            @RequestParam(required = false) @Size(max = 120) String keyword,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "25") @Min(1) @Max(200) int size,
            HttpServletRequest request) {
        if (page < 0 || size < 1 || size > 200) {
            throw new ConstraintViolationException(Set.of());
        }
        return PageEnvelope.from(service.list(actor(principal, request), type,
                status, keyword, PageRequest.of(page, size)), SummaryResponse::from);
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAuthority('logistics.address.write')")
    public DetailResponse detail(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID id, HttpServletRequest request) {
        return DetailResponse.from(service.detail(actor(principal, request), id));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('logistics.address.write')")
    public DetailResponse create(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody WriteRequest body,
            HttpServletRequest request) {
        return DetailResponse.from(service.create(actor(principal, request), body.input()));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('logistics.address.write')")
    public DetailResponse update(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID id,
            @Valid @RequestBody UpdateRequest body,
            HttpServletRequest request) {
        return DetailResponse.from(service.update(actor(principal, request), id,
                body.version(), body.address().input()));
    }

    @PostMapping("/{id}/archive")
    @PreAuthorize("hasAuthority('logistics.address.write')")
    public DetailResponse archive(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID id,
            @Valid @RequestBody ArchiveRequest body,
            HttpServletRequest request) {
        return DetailResponse.from(service.archive(actor(principal, request), id,
                body.version()));
    }

    private static LogisticsAddressService.Actor actor(
            ErpPrincipal principal, HttpServletRequest request) {
        String requestId = request.getHeader("X-Request-Id");
        if (requestId == null || !requestId.matches("^[A-Za-z0-9._:-]{1,100}$")) {
            requestId = UUID.randomUUID().toString();
        }
        return new LogisticsAddressService.Actor(
                principal.tenantId(), principal.userId(), principal.systemAdminId(),
                requestId, request.getRemoteAddr());
    }

    public record WriteRequest(
            @NotBlank String addressType,
            @NotBlank @Size(max = 160) String name,
            @NotBlank @Size(max = 160) String contactName,
            @Email @Size(max = 254) String contactEmail,
            @NotBlank @Pattern(regexp = "(?i)^[a-z]{2}$") String countryCode,
            @Size(max = 120) String province,
            @Size(max = 120) String city,
            @Size(max = 120) String district,
            @NotBlank @Size(max = 300) String addressLine1,
            @Size(max = 32) String postalCode,
            @Size(max = 40) String landline,
            @Size(max = 40) String mobile,
            @Size(max = 200) String companyName,
            @Size(max = 40) String fax) {
        LogisticsAddressService.AddressInput input() {
            return new LogisticsAddressService.AddressInput(
                    addressType, name, contactName, contactEmail, countryCode,
                    province, city, district, addressLine1, postalCode,
                    landline, mobile, companyName, fax);
        }
    }

    public record UpdateRequest(
            @Min(0) long version,
            @NotNull @Valid WriteRequest address) {
    }

    public record ArchiveRequest(@Min(0) long version) {
    }

    public record SummaryResponse(
            UUID id, String addressType, String name, String contactName,
            String countryCode, String province, String city, String district,
            String addressLine1, String status, long version, Instant updatedAt) {
        static SummaryResponse from(LogisticsAddressRecord value) {
            return new SummaryResponse(value.id(), value.addressType(), value.name(),
                    value.contactName(), value.countryCode(), value.province(),
                    value.city(), value.district(), value.addressLine1(),
                    value.status(), value.version(), value.updatedAt());
        }
    }

    public record DetailResponse(
            UUID id, String addressType, String name, String contactName,
            String contactEmail, String countryCode, String province,
            String city, String district, String addressLine1, String postalCode,
            String landline, String mobile, String companyName, String fax,
            String status, long version, Instant createdAt, Instant updatedAt) {
        static DetailResponse from(LogisticsAddressRecord value) {
            return new DetailResponse(value.id(), value.addressType(), value.name(),
                    value.contactName(), value.contactEmail(), value.countryCode(),
                    value.province(), value.city(), value.district(),
                    value.addressLine1(), value.postalCode(), value.landline(),
                    value.mobile(), value.companyName(), value.fax(), value.status(),
                    value.version(), value.createdAt(), value.updatedAt());
        }
    }
}
