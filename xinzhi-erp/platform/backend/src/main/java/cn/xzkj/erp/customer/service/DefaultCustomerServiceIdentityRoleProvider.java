package cn.xzkj.erp.customer.service;

import cn.xzkj.erp.iam.persistence.IamAssignmentStore;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
public class DefaultCustomerServiceIdentityRoleProvider
        implements CustomerServiceIdentityRoleProvider {

    private static final String ENTERPRISE_ADMIN_ROLE_CODE = "tenant_admin";

    private final IamAssignmentStore assignmentStore;

    public DefaultCustomerServiceIdentityRoleProvider(
            IamAssignmentStore assignmentStore) {
        this.assignmentStore = assignmentStore;
    }

    @Override
    public boolean isEnterpriseAdministrator(UUID tenantId, UUID userId) {
        return assignmentStore.existsUserWithSystemRoleCode(
                tenantId, userId, ENTERPRISE_ADMIN_ROLE_CODE);
    }
}
