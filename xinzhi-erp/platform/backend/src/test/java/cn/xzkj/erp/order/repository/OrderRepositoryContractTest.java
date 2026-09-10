package cn.xzkj.erp.order.repository;

import static org.assertj.core.api.Assertions.assertThat;

import java.lang.reflect.Method;
import java.util.List;

import org.junit.jupiter.api.Test;

class OrderRepositoryContractTest {
    @Test
    void tenantRepositoriesExposeNoUnscopedReadsOrDeletes() {
        for (Class<?> repository : List.of(OrderRepository.class, OrderLineRepository.class,
                OrderSkuLookupRepository.class, OrderListingLookupRepository.class)) {
            assertThat(repository.getMethods()).extracting(Method::getName)
                    .doesNotContain("findById", "findAll", "delete", "deleteById", "deleteAll");
        }
    }
}
