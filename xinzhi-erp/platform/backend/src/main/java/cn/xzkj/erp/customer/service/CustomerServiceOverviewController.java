package cn.xzkj.erp.customer.service;

import cn.xzkj.erp.customer.service.CustomerServiceOverviewService.Overview;
import cn.xzkj.erp.iam.security.ErpPrincipal;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/customer-service")
public class CustomerServiceOverviewController {

    private final CustomerServiceOverviewService service;

    public CustomerServiceOverviewController(CustomerServiceOverviewService service) {
        this.service = service;
    }

    @GetMapping("/overview")
    @PreAuthorize("hasAuthority('customer_service.read')")
    public Overview overview(
            @AuthenticationPrincipal ErpPrincipal principal,
            HttpServletResponse response) {
        response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
        return service.summarize(principal.tenantId());
    }
}
