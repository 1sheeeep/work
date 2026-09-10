package cn.xzkj.erp.supplier.repository;

import static org.assertj.core.api.Assertions.assertThat;

import java.lang.reflect.Method;

import org.junit.jupiter.api.Test;

class SupplierRepositoryContractTest {
    @Test
    void repositoryExposesNoUnscopedReadsOrDeletes() {
        assertThat(SupplierRepository.class.getMethods())
                .extracting(Method::getName)
                .doesNotContain(
                        "findById",
                        "findAll",
                        "delete",
                        "deleteById",
                        "deleteAll");
    }
}
