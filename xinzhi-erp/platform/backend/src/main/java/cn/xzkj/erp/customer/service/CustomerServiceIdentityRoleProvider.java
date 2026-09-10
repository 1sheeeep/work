package cn.xzkj.erp.customer.service;

import java.util.UUID;

public interface CustomerServiceIdentityRoleProvider {

    boolean isEnterpriseAdministrator(UUID tenantId, UUID userId);
}
