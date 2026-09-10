package cn.xzkj.erp.order.api;

import cn.xzkj.erp.order.api.OrderDtos.SkuSalesSummariesResponse;
import cn.xzkj.erp.order.api.OrderDtos.SkuSalesSummaryResponse;
import cn.xzkj.erp.order.domain.OrderPermissionCodes;
import cn.xzkj.erp.order.service.OrderSkuSalesService;
import cn.xzkj.erp.iam.security.ErpPrincipal;
import jakarta.validation.ConstraintViolationException;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.UUID;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Validated
@RequestMapping("/api/v1/order-center")
public class OrderSkuSalesController {
    private final OrderSkuSalesService service;

    public OrderSkuSalesController(OrderSkuSalesService service) {
        this.service = service;
    }

    @GetMapping("/sku-sales-summaries")
    @PreAuthorize("hasAuthority('" + OrderPermissionCodes.READ + "')")
    public SkuSalesSummariesResponse listSummaries(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(name = "skuId")
            @Size(min = 1, max = 50)
            List<@NotNull UUID> skuIds) {
        if (skuIds.isEmpty() || skuIds.size() > 50) {
            throw new ConstraintViolationException(java.util.Set.of());
        }
        return new SkuSalesSummariesResponse(
                service.listSummaries(principal.tenantId(), skuIds)
                        .stream()
                        .map(SkuSalesSummaryResponse::from)
                        .toList());
    }
}
