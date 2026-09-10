package cn.xzkj.erp.product.repository;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;

import jakarta.persistence.LockModeType;

class ProductSpuRepositoryContractTest {

    @Test
    void aggregateUpdateLookupUsesTenantScopedPessimisticWriteLock()
            throws Exception {
        var method = ProductSpuRepository.class.getMethod(
                "findForUpdateByIdAndTenantId",
                UUID.class,
                UUID.class);

        assertThat(method.getAnnotation(Lock.class).value())
                .isEqualTo(LockModeType.PESSIMISTIC_WRITE);
        assertThat(method.getAnnotation(Query.class).value())
                .contains("p.id = :id")
                .contains("p.tenantId = :tenantId");
    }
}
