package cn.xzkj.erp.settings.enterprise;

import java.time.Instant;

public record EnterpriseProfileRecord(
        String tenantCode,
        String tenantName,
        boolean configured,
        String companyName,
        String province,
        String city,
        String district,
        String detailedAddress,
        String contactName,
        String contactEmail,
        String contactQq,
        String contactMobile,
        String contactTelephone,
        long version,
        Instant createdAt,
        Instant updatedAt) {
}
