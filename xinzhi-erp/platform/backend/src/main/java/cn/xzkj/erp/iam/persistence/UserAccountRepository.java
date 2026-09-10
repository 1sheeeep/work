package cn.xzkj.erp.iam.persistence;

import jakarta.persistence.LockModeType;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

public interface UserAccountRepository extends Repository<UserAccountEntity, UUID> {

    Optional<UserAccountEntity> findByTenant_IdAndUsername(UUID tenantId, String username);

    Optional<UserAccountEntity> findByTenant_IdAndEmail(UUID tenantId, String email);

    Optional<UserAccountEntity> findByTenant_IdAndPhoneNumber(
            UUID tenantId,
            String phoneNumber);

    Optional<UserAccountEntity> findByOneSubjectId(UUID oneSubjectId);

    Optional<UserAccountEntity> findByIdAndTenant_Id(UUID id, UUID tenantId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select user from UserAccountEntity user
            where user.id = :id and user.tenant.id = :tenantId
            """)
    Optional<UserAccountEntity> findByIdAndTenantIdForUpdate(
            @Param("id") UUID id,
            @Param("tenantId") UUID tenantId);

    Page<UserAccountEntity> findAllByTenant_Id(UUID tenantId, Pageable pageable);

    @Query(
            value = """
                    select account.*
                    from users account
                    where account.tenant_id = :tenantId
                      and (
                        cast(:queryPattern as text) is null
                        or lower(coalesce(account.email, ''))
                            like cast(:queryPattern as text) escape '\\'
                        or lower(account.username)
                            like cast(:queryPattern as text) escape '\\'
                        or lower(account.display_name)
                            like cast(:queryPattern as text) escape '\\'
                        or coalesce(account.phone_number, '')
                            like cast(:queryPattern as text) escape '\\'
                      )
                      and (
                        cast(:status as text) is null
                        or account.status = cast(:status as text)
                      )
                      and (
                        cast(:roleId as uuid) is null
                        or exists (
                          select 1
                          from user_roles assignment
                          where assignment.tenant_id = :tenantId
                            and assignment.user_id = account.id
                            and assignment.role_id = cast(:roleId as uuid)
                        )
                      )
                    order by account.username asc, account.id asc
                    """,
            countQuery = """
                    select count(*)
                    from users account
                    where account.tenant_id = :tenantId
                      and (
                        cast(:queryPattern as text) is null
                        or lower(coalesce(account.email, ''))
                            like cast(:queryPattern as text) escape '\\'
                        or lower(account.username)
                            like cast(:queryPattern as text) escape '\\'
                        or lower(account.display_name)
                            like cast(:queryPattern as text) escape '\\'
                        or coalesce(account.phone_number, '')
                            like cast(:queryPattern as text) escape '\\'
                      )
                      and (
                        cast(:status as text) is null
                        or account.status = cast(:status as text)
                      )
                      and (
                        cast(:roleId as uuid) is null
                        or exists (
                          select 1
                          from user_roles assignment
                          where assignment.tenant_id = :tenantId
                            and assignment.user_id = account.id
                            and assignment.role_id = cast(:roleId as uuid)
                        )
                      )
                    """,
            nativeQuery = true)
    Page<UserAccountEntity> findFilteredMembers(
            @Param("tenantId") UUID tenantId,
            @Param("queryPattern") String queryPattern,
            @Param("status") String status,
            @Param("roleId") UUID roleId,
            Pageable pageable);

    @Query(
            value = """
                    select account.*
                    from users account
                    where account.tenant_id = :tenantId
                      and exists (
                        select 1
                        from user_roles assignment
                        join roles role
                          on role.id = assignment.role_id
                         and role.tenant_id = assignment.tenant_id
                        where assignment.tenant_id = :tenantId
                          and assignment.user_id = account.id
                          and role.code = :roleCode
                          and role.system_role = true
                      )
                    order by account.username asc, account.id asc
                    """,
            countQuery = """
                    select count(*)
                    from users account
                    where account.tenant_id = :tenantId
                      and exists (
                        select 1
                        from user_roles assignment
                        join roles role
                          on role.id = assignment.role_id
                         and role.tenant_id = assignment.tenant_id
                        where assignment.tenant_id = :tenantId
                          and assignment.user_id = account.id
                          and role.code = :roleCode
                          and role.system_role = true
                      )
                    """,
            nativeQuery = true)
    Page<UserAccountEntity> findEnterpriseAdmins(
            @Param("tenantId") UUID tenantId,
            @Param("roleCode") String roleCode,
            Pageable pageable);

    boolean existsByTenant_IdAndUsername(UUID tenantId, String username);

    boolean existsByTenant_IdAndEmail(UUID tenantId, String email);

    boolean existsByTenant_IdAndPhoneNumber(UUID tenantId, String phoneNumber);

    long countByTenant_Id(UUID tenantId);

    UserAccountEntity saveAndFlush(UserAccountEntity user);
}
