package cn.xzkj.erp.customer.service;

import cn.xzkj.erp.iam.application.SessionTokenService;
import cn.xzkj.erp.iam.preparation.NativeCustomerServiceIdentity;
import cn.xzkj.erp.iam.persistence.PermissionRepository;
import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.tenantaccess.UserApplicationAccessService;
import java.time.Clock;
import java.time.Instant;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Reuses one-use grants, but resolves only reviewed original-CS IDs.
 * No email matching, provisioning, role projection or ongoing logout coupling. */
@Service
@ConditionalOnProperty(name="erp.native-customer-service-entry.enabled",havingValue="true")
public class NativeCustomerServiceEntry {
    public static final String ORIGIN="https://kf.xzkj.ai";
    private final CustomerServiceEntryGrantService grants;
    private final CustomerServiceEntryGrantRepository repository;
    private final NativeCustomerServiceIdentity identity;
    private final SessionTokenService tokens;
    private final UserApplicationAccessService access;
    private final PermissionRepository permissions;
    private final Clock clock;
    public NativeCustomerServiceEntry(CustomerServiceEntryGrantService grants,CustomerServiceEntryGrantRepository repository,
        NativeCustomerServiceIdentity identity,SessionTokenService tokens,UserApplicationAccessService access,
        PermissionRepository permissions,Clock clock) {
        this.grants=grants;this.repository=repository;this.identity=identity;this.tokens=tokens;
        this.access=access;this.permissions=permissions;this.clock=clock;
    }
    @Transactional
    public CustomerServiceEntryGrantService.IssuedEntryGrant issue(ErpPrincipal principal,String origin,String requestId,String ip) {
        if(principal==null || principal.systemAdminId()!=null || principal.userId()==null || !ORIGIN.equals(origin)) throw CustomerServiceEntryException.invalidGrant();
        requireAccess(principal.tenantId(),principal.userId());
        identity.entrySubject(principal.tenantId(),principal.userId(),principal.sessionId());
        return grants.issue(principal,origin,requestId,ip);
    }
    @Transactional
    public Subject redeem(String raw,UUID tenant,UUID user,String origin) {
        if(raw==null || !raw.matches("[A-Za-z0-9_-]{43}") || !ORIGIN.equals(origin)) throw CustomerServiceEntryException.invalidGrant();
        var grant=repository.findForConsumptionByTokenHash(tokens.hash(raw)).orElseThrow(CustomerServiceEntryException::invalidGrant);
        if(grant.getConsumedAt()!=null || !grant.getExpiresAt().isAfter(clock.instant()) || !grant.getTenantId().equals(tenant)
            || !grant.getUserId().equals(user) || !ORIGIN.equals(grant.getTargetOrigin()) || grant.getAuthSession()==null
            || grant.getPlatformTenantSession()!=null) throw CustomerServiceEntryException.invalidGrant();
        requireAccess(tenant,user);
        String sourceId=identity.entrySubject(tenant,user,grant.getAuthSession().getId());
        // Recheck expiry after source validation, which may involve a remote round trip.
        if(!grant.getExpiresAt().isAfter(clock.instant()))throw CustomerServiceEntryException.invalidGrant();
        grant.consume(clock.instant());
        return new Subject(tenant,user,sourceId,clock.instant());
    }
    private void requireAccess(UUID tenant,UUID user) {
        if(!access.applicationAccessible(tenant,user,"CHAT") || !permissions.findCodesByTenantIdAndUserId(tenant,user).contains("customer_service.read")) throw CustomerServiceEntryException.invalidGrant();
    }
    public record Subject(UUID tenantId,UUID userId,String customerServiceUserId,Instant redeemedAt) {}
}
