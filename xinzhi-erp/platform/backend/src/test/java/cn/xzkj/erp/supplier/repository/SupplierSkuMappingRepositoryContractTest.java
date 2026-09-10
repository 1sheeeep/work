package cn.xzkj.erp.supplier.repository;

import static org.assertj.core.api.Assertions.assertThat;

import java.lang.reflect.Method;

import org.junit.jupiter.api.Test;

class SupplierSkuMappingRepositoryContractTest {
    @Test
    void repositoryExposesNoUnscopedReadsOrDeletes() {
        assertThat(SupplierSkuMappingRepository.class.getMethods())
                .extracting(Method::getName)
                .doesNotContain(
                        "findById",
                        "findAll",
                        "delete",
                        "deleteById",
                        "deleteAll");
    }
}
