package cn.xzkj.erp.procurement.service;

import java.util.UUID;

public record ProcurementSupplierOption(
        UUID supplierId,
        String supplierCode,
        String supplierName,
        String supplierSkuCode,
        boolean preferred,
        Integer leadTimeDays) {
}
