package cn.xzkj.erp.logistics.shippingfee;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.platform.api.PageEnvelope;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Validated
@RequestMapping("/api/v1/logistics/shipping-fees")
public class ShippingFeeController {
    private final ShippingFeeService service;

    public ShippingFeeController(ShippingFeeService service) {
        this.service = service;
    }

    @GetMapping("/regions")
    @PreAuthorize("hasAuthority('logistics.read')")
    public PageEnvelope<RegionResponse> regions(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(defaultValue = "ALL") String status,
            @RequestParam(required = false) @Size(max = 100) String keyword,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "25") @Min(1) @Max(200) int size,
            HttpServletRequest request) {
        requirePage(page, size);
        return PageEnvelope.from(service.listRegions(
                        actor(principal, request), status, keyword,
                        PageRequest.of(page, size)),
                RegionResponse::from);
    }

    @GetMapping("/rules")
    @PreAuthorize("hasAuthority('logistics.read')")
    public PageEnvelope<RuleResponse> rules(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(defaultValue = "ALL") String status,
            @RequestParam(required = false) @Size(max = 100)
            String regionKeyword,
            @RequestParam(required = false) @Size(max = 100)
            String ruleKeyword,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "25") @Min(1) @Max(200) int size,
            HttpServletRequest request) {
        requirePage(page, size);
        return PageEnvelope.from(service.listRules(
                        actor(principal, request), status, regionKeyword,
                        ruleKeyword, PageRequest.of(page, size)),
                RuleResponse::from);
    }

    @PostMapping("/regions")
    @PreAuthorize("hasAuthority('logistics.shipping_fee.write')")
    public RegionResponse createRegion(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody RegionWriteRequest body,
            HttpServletRequest request) {
        return RegionResponse.from(service.createRegion(
                actor(principal, request), body.input()));
    }

    @PostMapping("/rules")
    @PreAuthorize("hasAuthority('logistics.shipping_fee.write')")
    public RuleResponse createRule(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody RuleWriteRequest body,
            HttpServletRequest request) {
        return RuleResponse.from(service.createRule(
                actor(principal, request), body.input()));
    }

    @PostMapping("/regions/{id}/archive")
    @PreAuthorize("hasAuthority('logistics.shipping_fee.write')")
    public RegionResponse archiveRegion(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID id,
            @Valid @RequestBody ArchiveRequest body,
            HttpServletRequest request) {
        return RegionResponse.from(service.archiveRegion(
                actor(principal, request), id, body.version()));
    }

    @PostMapping("/rules/{id}/archive")
    @PreAuthorize("hasAuthority('logistics.shipping_fee.write')")
    public RuleResponse archiveRule(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID id,
            @Valid @RequestBody ArchiveRequest body,
            HttpServletRequest request) {
        return RuleResponse.from(service.archiveRule(
                actor(principal, request), id, body.version()));
    }

    @PostMapping("/estimates")
    @PreAuthorize("hasAuthority('logistics.read')")
    public List<EstimateResponse> estimate(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody EstimateRequest body,
            HttpServletRequest request) {
        return service.estimate(actor(principal, request), body.input())
                .stream().map(EstimateResponse::from).toList();
    }

    private static ShippingFeeService.Actor actor(
            ErpPrincipal principal, HttpServletRequest request) {
        String requestId = request.getHeader("X-Request-Id");
        if (requestId == null
                || !requestId.matches("^[A-Za-z0-9._:-]{1,100}$")) {
            requestId = UUID.randomUUID().toString();
        }
        return new ShippingFeeService.Actor(
                principal.tenantId(), principal.userId(),
                principal.systemAdminId(), principal.displayName(), requestId,
                request.getRemoteAddr());
    }

    private static void requirePage(int page, int size) {
        if (page < 0 || size < 1 || size > 200) {
            throw new jakarta.validation.ConstraintViolationException(Set.of());
        }
    }

    public record RegionWriteRequest(
            @NotBlank @Size(max = 100) String name,
            @NotBlank @Pattern(regexp = "(?i)^[a-z]{2}$") String countryCode,
            @Size(max = 100) String city,
            @Size(max = 32) String postalCodePrefix,
            @Size(max = 500) String note) {
        ShippingFeeService.RegionInput input() {
            return new ShippingFeeService.RegionInput(
                    name, countryCode, city, postalCodePrefix, note);
        }
    }

    public record RuleWriteRequest(
            @NotNull UUID regionId,
            @NotBlank @Size(max = 100) String name,
            @PositiveOrZero long minimumWeightGrams,
            @PositiveOrZero Long maximumWeightGrams,
            @PositiveOrZero long baseFeeMinor,
            @PositiveOrZero long perKilogramFeeMinor,
            @PositiveOrZero long otherFeeMinor,
            @NotBlank @Pattern(regexp = "(?i)^[a-z]{3}$") String currencyCode,
            @Size(max = 500) String note) {
        ShippingFeeService.RuleInput input() {
            return new ShippingFeeService.RuleInput(
                    regionId, name, minimumWeightGrams, maximumWeightGrams,
                    baseFeeMinor, perKilogramFeeMinor, otherFeeMinor,
                    currencyCode, note);
        }
    }

    public record EstimateRequest(
            @NotBlank @Pattern(regexp = "(?i)^[a-z]{2}$") String countryCode,
            @Size(max = 100) String city,
            @Size(max = 32) String postalCode,
            @Positive long weightGrams,
            @Positive Long lengthMm,
            @Positive Long widthMm,
            @Positive Long heightMm,
            @Positive Long volumetricDivisor,
            @NotBlank String weighingMode) {
        ShippingFeeService.EstimateInput input() {
            return new ShippingFeeService.EstimateInput(
                    countryCode, city, postalCode, weightGrams,
                    lengthMm, widthMm, heightMm, volumetricDivisor,
                    weighingMode);
        }
    }

    public record ArchiveRequest(@Min(0) long version) {
    }

    public record RegionResponse(
            UUID id, String name, String countryCode, String city,
            String postalCodePrefix, String note, String status,
            String createdByDisplayName, long version,
            Instant createdAt, Instant updatedAt) {
        static RegionResponse from(ShippingFeeRecords.Region value) {
            return new RegionResponse(
                    value.id(), value.name(), value.countryCode(), value.city(),
                    value.postalCodePrefix(), value.note(), value.status(),
                    value.createdByDisplayName(), value.version(),
                    value.createdAt(), value.updatedAt());
        }
    }

    public record RuleResponse(
            UUID id, UUID regionId, String regionName, String countryCode,
            String name, long minimumWeightGrams, Long maximumWeightGrams,
            long baseFeeMinor, long perKilogramFeeMinor, long otherFeeMinor,
            String currencyCode, String note, String status,
            String createdByDisplayName, long version,
            Instant createdAt, Instant updatedAt) {
        static RuleResponse from(ShippingFeeRecords.Rule value) {
            return new RuleResponse(
                    value.id(), value.regionId(), value.regionName(),
                    value.countryCode(), value.name(),
                    value.minimumWeightGrams(), value.maximumWeightGrams(),
                    value.baseFeeMinor(), value.perKilogramFeeMinor(),
                    value.otherFeeMinor(), value.currencyCode(), value.note(),
                    value.status(), value.createdByDisplayName(), value.version(),
                    value.createdAt(), value.updatedAt());
        }
    }

    public record EstimateResponse(
            UUID regionId, String regionName, UUID ruleId, String ruleName,
            long actualWeightGrams, long volumetricWeightGrams,
            long chargeableWeightGrams, long shippingFeeMinor,
            long otherFeeMinor, long totalFeeMinor, String currencyCode) {
        static EstimateResponse from(ShippingFeeService.EstimateResult value) {
            return new EstimateResponse(
                    value.regionId(), value.regionName(), value.ruleId(),
                    value.ruleName(), value.actualWeightGrams(),
                    value.volumetricWeightGrams(), value.chargeableWeightGrams(),
                    value.shippingFeeMinor(), value.otherFeeMinor(),
                    value.totalFeeMinor(), value.currencyCode());
        }
    }
}
