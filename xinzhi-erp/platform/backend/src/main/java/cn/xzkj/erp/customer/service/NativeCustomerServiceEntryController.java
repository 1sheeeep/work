package cn.xzkj.erp.customer.service;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1")
@ConditionalOnProperty(name="erp.native-customer-service-entry.enabled",havingValue="true")
public class NativeCustomerServiceEntryController {
    private final NativeCustomerServiceEntry entry;
    public NativeCustomerServiceEntryController(NativeCustomerServiceEntry entry){this.entry=entry;}
    @PostMapping("/customer-service/native-entry-grants")
    @PreAuthorize("hasAuthority('customer_service.read')")
    public CustomerServiceEntryGrantService.IssuedEntryGrant issue(@AuthenticationPrincipal ErpPrincipal principal,
        @Valid @RequestBody CustomerServiceEntryController.IssueRequest body,HttpServletResponse response) {
        response.setHeader("Cache-Control","no-store");
        return entry.issue(principal,body.targetOrigin(),null,null);
    }
    @PostMapping("/internal/customer-service/native-entry/redeem")
    @PreAuthorize("hasAuthority('internal.customer_service.native_entry.redeem')")
    public NativeCustomerServiceEntry.Subject redeem(@Valid @RequestBody CustomerServiceEntryController.RedeemRequest body,HttpServletResponse response) {
        response.setHeader("Cache-Control","no-store");
        return entry.redeem(body.grant(),body.tenantId(),body.userId(),body.targetOrigin());
    }
}
