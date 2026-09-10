package cn.xzkj.erp.settings.branding;

import java.time.Instant;

public record EnterpriseBrandingRecord(
        boolean configured,
        boolean watermarkEnabled,
        boolean watermarkUserName,
        boolean watermarkCompanyName,
        boolean watermarkTime,
        boolean watermarkPhoneSuffix,
        long version,
        String updatedByDisplayName,
        Instant updatedAt) {
}
