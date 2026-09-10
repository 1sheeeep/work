package cn.xzkj.erp.warehouse.repository;

import static org.assertj.core.api.Assertions.assertThat;

import java.lang.reflect.Method;
import java.util.List;

import org.junit.jupiter.api.Test;

class WarehouseRepositoryContractTest {
    @Test
    void tenantRepositoriesExposeNoUnscopedReadsOrDeletes() {
        for (Class<?> repository :
                List.of(WarehouseRepository.class, WarehouseLocationRepository.class)) {
            assertThat(repository.getMethods()).extracting(Method::getName)
                    .doesNotContain(
                            "findById",
                            "findAll",
                            "delete",
                            "deleteById",
                            "deleteAll");
        }
    }
}
