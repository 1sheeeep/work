package cn.xzkj.erp.supplier.service;

import java.util.UUID;

public record PreferredSupplierSkuSummary(
        UUID skuId,
        String supplierSkuCode,
        UUID supplierId,
        String supplierBusinessCode,
        String supplierName) {
}
