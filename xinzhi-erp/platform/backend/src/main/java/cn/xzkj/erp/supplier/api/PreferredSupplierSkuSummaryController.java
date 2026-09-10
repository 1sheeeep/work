package cn.xzkj.erp.supplier.api;

import java.util.List;
import java.util.UUID;

import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.supplier.api.SupplierSkuMappingDtos.PreferredSupplierResponse;
import cn.xzkj.erp.supplier.api.SupplierSkuMappingDtos.PreferredSupplierSummariesResponse;
import cn.xzkj.erp.supplier.service.SupplierSkuMappingService;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

@RestController
@Validated
@RequestMapping("/api/v1/suppliers/preferred-sku-summaries")
public class PreferredSupplierSkuSummaryController {
    private final SupplierSkuMappingService service;

    public PreferredSupplierSkuSummaryController(
            SupplierSkuMappingService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('suppliers.read')")
    public PreferredSupplierSummariesResponse list(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(name = "skuId")
            @Size(min = 1, max = 50)
            List<@NotNull UUID> skuIds) {
        return new PreferredSupplierSummariesResponse(
                service.listPreferredSuppliers(
                        principal.tenantId(), skuIds).stream()
                        .map(PreferredSupplierResponse::from)
                        .toList());
    }
}
