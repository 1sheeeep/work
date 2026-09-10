package cn.xzkj.erp.platformadmin.persistence;

import jakarta.persistence.LockModeType;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

public interface SystemAdminRepository extends Repository<SystemAdminEntity, UUID> {

    Optional<SystemAdminEntity> findById(UUID id);

    Optional<SystemAdminEntity> findByUsernameIgnoreCase(String username);

    Optional<SystemAdminEntity> findByEmail(String email);

    Optional<SystemAdminEntity> findByPhoneNumber(String phoneNumber);

    Optional<SystemAdminEntity> findByOneSubjectId(UUID oneSubjectId);

    boolean existsByUsernameIgnoreCase(String username);

    boolean existsByEmail(String email);

    boolean existsByPhoneNumber(String phoneNumber);

    Page<SystemAdminEntity> findAll(Pageable pageable);

    long count();

    SystemAdminEntity saveAndFlush(SystemAdminEntity admin);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select admin from SystemAdminEntity admin where admin.id = :id")
    Optional<SystemAdminEntity> findByIdForUpdate(@Param("id") UUID id);
}
