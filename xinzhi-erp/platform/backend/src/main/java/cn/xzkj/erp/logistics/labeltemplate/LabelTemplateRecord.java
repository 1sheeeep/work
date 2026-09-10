package cn.xzkj.erp.logistics.labeltemplate;

import java.time.Instant;
import java.util.UUID;

record LabelTemplateRecord(
        UUID id,
        String scope,
        String name,
        String documentCategory,
        int widthMm,
        int heightMm,
        String content,
        String note,
        String status,
        String createdByDisplayName,
        long version,
        Instant createdAt,
        Instant updatedAt) {
}
