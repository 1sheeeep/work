package cn.xzkj.erp.fulfillment.weighing;

import java.util.List;
import java.util.UUID;

import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import cn.xzkj.erp.fulfillment.weighing.ShippingConfigurationRecords.PackagingRule;
import cn.xzkj.erp.fulfillment.weighing.ShippingConfigurationRecords.PackagingTemplate;
import cn.xzkj.erp.fulfillment.weighing.ShippingConfigurationRecords.ShippingScale;
import cn.xzkj.erp.fulfillment.weighing.ShippingConfigurationRecords.WarehousePackaging;
import cn.xzkj.erp.fulfillment.weighing.ShippingConfigurationRecords.WeightTolerance;
import cn.xzkj.erp.iam.security.ErpPrincipal;
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
@RequestMapping("/api/v1/shipping-configuration")
public class ShippingConfigurationController {
    private final ShippingConfigurationService service;

    public ShippingConfigurationController(ShippingConfigurationService service) {
        this.service = service;
    }

    @GetMapping("/packaging-templates")
    @PreAuthorize("hasAnyAuthority('warehouses.read','fulfillments.read','products.read')")
    public PackagingTemplateListResponse listTemplates(
            @AuthenticationPrincipal(expression = "tenantId") UUID tenantId) {
        return new PackagingTemplateListResponse(service.listTemplates(tenantId));
    }

    @PostMapping("/packaging-templates")
    @PreAuthorize("hasAuthority('warehouses.shipping_config.write')")
    public PackagingTemplate createTemplate(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody CreatePackagingTemplateRequest request,
            HttpServletRequest httpRequest) {
        return service.createTemplate(actor(principal, httpRequest),
                request.businessCode(), request.name(), request.packagingType(),
                request.standardWeightGrams(), request.lengthMm(),
                request.widthMm(), request.heightMm());
    }

    @PutMapping("/packaging-templates/{templateId}")
    @PreAuthorize("hasAuthority('warehouses.shipping_config.write')")
    public PackagingTemplate updateTemplate(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID templateId,
            @Valid @RequestBody UpdatePackagingTemplateRequest request,
            HttpServletRequest httpRequest) {
        return service.updateTemplate(actor(principal, httpRequest), templateId,
                request.version(), request.name(), request.packagingType(),
                request.standardWeightGrams(), request.lengthMm(),
                request.widthMm(), request.heightMm(), request.status());
    }

    @GetMapping("/skus/{skuId}/packaging-rules")
    @PreAuthorize("hasAuthority('products.read')")
    public PackagingRuleListResponse listRules(
            @AuthenticationPrincipal(expression = "tenantId") UUID tenantId,
            @PathVariable UUID skuId) {
        return new PackagingRuleListResponse(service.listRules(tenantId, skuId));
    }

    @PostMapping("/skus/{skuId}/packaging-rules")
    @PreAuthorize("hasAuthority('products.weight.write')")
    public PackagingRule createRule(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID skuId,
            @Valid @RequestBody CreatePackagingRuleRequest request,
            HttpServletRequest httpRequest) {
        return service.createRule(actor(principal, httpRequest), skuId,
                request.minQuantity(), request.maxQuantity(),
                request.packagingTemplateId());
    }

    @PutMapping("/skus/{skuId}/packaging-rules/{ruleId}")
    @PreAuthorize("hasAuthority('products.weight.write')")
    public PackagingRule updateRule(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID skuId,
            @PathVariable UUID ruleId,
            @Valid @RequestBody UpdatePackagingRuleRequest request,
            HttpServletRequest httpRequest) {
        return service.updateRule(actor(principal, httpRequest), skuId,
                ruleId, request.version(), request.minQuantity(),
                request.maxQuantity(), request.packagingTemplateId(),
                request.status());
    }

    @GetMapping("/warehouses/{warehouseId}/packaging-templates")
    @PreAuthorize("hasAnyAuthority('warehouses.read','fulfillments.read')")
    public WarehousePackagingListResponse listWarehousePackaging(
            @AuthenticationPrincipal(expression = "tenantId") UUID tenantId,
            @PathVariable UUID warehouseId) {
        return new WarehousePackagingListResponse(
                service.listWarehousePackaging(tenantId, warehouseId));
    }

    @PutMapping("/warehouses/{warehouseId}/packaging-templates/{templateId}")
    @PreAuthorize("hasAuthority('warehouses.shipping_config.write')")
    public WarehousePackagingListResponse setWarehousePackaging(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID warehouseId,
            @PathVariable UUID templateId,
            @Valid @RequestBody WarehousePackagingRequest request,
            HttpServletRequest httpRequest) {
        return new WarehousePackagingListResponse(service.setWarehousePackaging(
                actor(principal, httpRequest), warehouseId, templateId, request.enabled()));
    }

    @GetMapping("/warehouses/{warehouseId}/scales")
    @PreAuthorize("hasAuthority('warehouses.read')")
    public ShippingScaleListResponse listScales(
            @AuthenticationPrincipal(expression = "tenantId") UUID tenantId,
            @PathVariable UUID warehouseId) {
        return new ShippingScaleListResponse(service.listScales(tenantId, warehouseId));
    }

    @PostMapping("/warehouses/{warehouseId}/scales")
    @PreAuthorize("hasAuthority('warehouses.shipping_config.write')")
    public ShippingScale createScale(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID warehouseId,
            @Valid @RequestBody CreateScaleRequest request,
            HttpServletRequest httpRequest) {
        return service.createScale(actor(principal, httpRequest), warehouseId,
                request.deviceNumber(), request.displayName());
    }

    @PutMapping("/scales/{scaleId}")
    @PreAuthorize("hasAuthority('warehouses.shipping_config.write')")
    public ShippingScale updateScale(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID scaleId,
            @Valid @RequestBody UpdateScaleRequest request,
            HttpServletRequest httpRequest) {
        return service.updateScale(actor(principal, httpRequest), scaleId,
                request.version(), request.warehouseId(),
                request.displayName(), request.status());
    }

    @GetMapping("/warehouses/{warehouseId}/weight-tolerance")
    @PreAuthorize("hasAuthority('warehouses.read')")
    public WeightTolerance getTolerance(
            @AuthenticationPrincipal(expression = "tenantId") UUID tenantId,
            @PathVariable UUID warehouseId) {
        return service.getTolerance(tenantId, warehouseId);
    }

    @PutMapping("/warehouses/{warehouseId}/weight-tolerance")
    @PreAuthorize("hasAuthority('warehouses.shipping_config.write')")
    public WeightTolerance setTolerance(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID warehouseId,
            @Valid @RequestBody WeightToleranceRequest request,
            HttpServletRequest httpRequest) {
        return service.setWarehouseTolerance(actor(principal, httpRequest),
                warehouseId, request.toleranceGrams(),
                request.toleranceBasisPoints());
    }

    private static ShippingConfigurationService.Actor actor(
            ErpPrincipal principal, HttpServletRequest request) {
        String requestId = request.getHeader("X-Request-Id");
        if (requestId == null
                || !requestId.matches("^[A-Za-z0-9._:-]{1,100}$")) {
            requestId = UUID.randomUUID().toString();
        }
        return new ShippingConfigurationService.Actor(
                principal.tenantId(), principal.userId(),
                principal.systemAdminId(), requestId, request.getRemoteAddr());
    }

    public record CreatePackagingTemplateRequest(
            @NotBlank @Pattern(regexp = "^[A-Za-z][A-Za-z0-9_-]{1,63}$")
            String businessCode,
            @NotBlank @Size(max = 160) String name,
            @NotBlank String packagingType,
            @Min(1) @Max(999999999) int standardWeightGrams,
            @Min(1) @Max(999999) Integer lengthMm,
            @Min(1) @Max(999999) Integer widthMm,
            @Min(1) @Max(999999) Integer heightMm) {
    }

    public record UpdatePackagingTemplateRequest(
            @Min(0) long version,
            @NotBlank @Size(max = 160) String name,
            @NotBlank String packagingType,
            @Min(1) @Max(999999999) int standardWeightGrams,
            @Min(1) @Max(999999) Integer lengthMm,
            @Min(1) @Max(999999) Integer widthMm,
            @Min(1) @Max(999999) Integer heightMm,
            @NotBlank String status) {
    }

    public record CreatePackagingRuleRequest(
            @Min(1) @Max(999999) int minQuantity,
            @Min(1) @Max(999999) int maxQuantity,
            @NotNull UUID packagingTemplateId) {
    }

    public record UpdatePackagingRuleRequest(
            @Min(0) long version,
            @Min(1) @Max(999999) int minQuantity,
            @Min(1) @Max(999999) int maxQuantity,
            @NotNull UUID packagingTemplateId,
            @NotBlank String status) {
    }

    public record WarehousePackagingRequest(boolean enabled) {
    }

    public record CreateScaleRequest(
            @NotBlank
            @Pattern(regexp = "^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$")
            String deviceNumber,
            @NotBlank @Size(max = 160) String displayName) {
    }

    public record UpdateScaleRequest(
            @Min(0) long version,
            @NotNull UUID warehouseId,
            @NotBlank @Size(max = 160) String displayName,
            @NotBlank String status) {
    }

    public record WeightToleranceRequest(
            @Min(0) @Max(999999999) int toleranceGrams,
            @Min(0) @Max(10000) int toleranceBasisPoints) {
    }

    public record PackagingTemplateListResponse(List<PackagingTemplate> items) {
    }

    public record PackagingRuleListResponse(List<PackagingRule> items) {
    }

    public record WarehousePackagingListResponse(List<WarehousePackaging> items) {
    }

    public record ShippingScaleListResponse(List<ShippingScale> items) {
    }
}
