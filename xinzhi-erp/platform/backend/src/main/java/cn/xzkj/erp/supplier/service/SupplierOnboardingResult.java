package cn.xzkj.erp.supplier.service;

import cn.xzkj.erp.supplier.domain.Supplier;

public record SupplierOnboardingResult(
        Supplier supplier,
        SupplierSkuMappingSummary mapping) {
}
