package cn.xzkj.erp.supplier.service;

import cn.xzkj.erp.supplier.domain.SupplierSkuMapping;

public record SupplierSkuMappingSummary(
        SupplierSkuMapping mapping,
        String skuBusinessCode,
        String skuName) {
}
