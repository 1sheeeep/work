package cn.xzkj.erp.settings.alias;

import java.time.Instant;
import java.util.UUID;

public record ShopAliasRecord(
        UUID shopId,
        String shopDisplayName,
        String platformCode,
        String aliasEn,
        String aliasZhCn,
        String aliasEs,
        String aliasId,
        String aliasTh,
        String aliasRu,
        String aliasPt,
        String aliasVi,
        String aliasMs,
        boolean configured,
        long version,
        String updatedByDisplayName,
        Instant updatedAt) {
}
