package cn.xzkj.erp.order.repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

import cn.xzkj.erp.order.domain.OrderLine;

public interface OrderLineRepository extends Repository<OrderLine, UUID> {
    <S extends OrderLine> List<S> saveAllAndFlush(Iterable<S> entities);
    <S extends OrderLine> S saveAndFlush(S entity);
    List<OrderLine> findAllByTenantIdAndOrderIdOrderByExternalLineRef(UUID tenantId, UUID orderId);
    Optional<OrderLine> findByIdAndTenantIdAndOrderId(UUID id, UUID tenantId, UUID orderId);
    boolean existsByTenantIdAndOrderIdAndExternalVariantRef(
            UUID tenantId, UUID orderId, String externalVariantRef);
    boolean existsByTenantIdAndOrderIdAndExternalLineRef(
            UUID tenantId, UUID orderId, String externalLineRef);

    @Query("""
            select (count(l) > 0) from OrderLine l
            where l.tenantId = :tenantId and l.orderId = :orderId
              and l.lineKind = cn.xzkj.erp.order.domain.OrderLineKind.PRODUCT
              and (l.skuId is null or l.skuMatchSource = cn.xzkj.erp.order.domain.SkuMatchSource.UNMATCHED)
            """)
    boolean hasUnmatchedLine(@Param("tenantId") UUID tenantId, @Param("orderId") UUID orderId);
}
