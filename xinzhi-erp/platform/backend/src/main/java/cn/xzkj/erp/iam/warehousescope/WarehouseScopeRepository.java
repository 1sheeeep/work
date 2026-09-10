package cn.xzkj.erp.iam.warehousescope;

import jakarta.persistence.LockModeType;
import java.util.Optional;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

public interface WarehouseScopeRepository
        extends Repository<WarehouseScopeEntity, WarehouseScopeId> {

    Optional<WarehouseScopeEntity> findById(WarehouseScopeId id);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select scope from WarehouseScopeEntity scope where scope.id = :id")
    Optional<WarehouseScopeEntity> findForUpdateById(
            @Param("id") WarehouseScopeId id);

    WarehouseScopeEntity saveAndFlush(WarehouseScopeEntity scope);
}
