package cn.xzkj.erp.tenantaccess;

import cn.xzkj.erp.iam.application.IamOptimisticLockException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class UserApplicationAccessStore {

    private final JdbcTemplate jdbc;

    public UserApplicationAccessStore(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Snapshot read(UUID tenantId, UUID userId) {
        Long version = jdbc.query(
                """
                select version
                from user_application_access_sets
                where tenant_id = ? and user_id = ?
                """,
                result -> result.next() ? result.getLong(1) : null,
                tenantId,
                userId);
        Set<String> applications = new LinkedHashSet<>(jdbc.query(
                """
                select application_code
                from user_enabled_applications
                where tenant_id = ? and user_id = ?
                order by application_code
                """,
                (result, row) -> result.getString("application_code"),
                tenantId,
                userId));
        return new Snapshot(version == null ? 0 : version, applications);
    }

    public long replace(
            UUID tenantId,
            UUID userId,
            long expectedVersion,
            Set<String> applications,
            UUID actorUserId,
            UUID actorSystemAdminId,
            Instant now) {
        int updated;
        if (expectedVersion == 0 && !exists(tenantId, userId)) {
            updated = jdbc.update(
                    """
                    insert into user_application_access_sets (
                        tenant_id, user_id, version, updated_at,
                        updated_by_user_id, updated_by_system_admin_id
                    ) values (?, ?, 1, ?, ?, ?)
                    on conflict (tenant_id, user_id) do nothing
                    """,
                    tenantId,
                    userId,
                    Timestamp.from(now),
                    actorUserId,
                    actorSystemAdminId);
        } else {
            updated = jdbc.update(
                    """
                    update user_application_access_sets
                    set version = version + 1,
                        updated_at = ?,
                        updated_by_user_id = ?,
                        updated_by_system_admin_id = ?
                    where tenant_id = ? and user_id = ? and version = ?
                    """,
                    Timestamp.from(now),
                    actorUserId,
                    actorSystemAdminId,
                    tenantId,
                    userId,
                    expectedVersion);
        }
        if (updated != 1) {
            throw new IamOptimisticLockException();
        }
        jdbc.update(
                "delete from user_enabled_applications where tenant_id = ? and user_id = ?",
                tenantId,
                userId);
        for (String application : applications) {
            jdbc.update(
                    """
                    insert into user_enabled_applications (
                        tenant_id, user_id, application_code, enabled_at
                    ) values (?, ?, ?, ?)
                    """,
                    tenantId,
                    userId,
                    application,
                    Timestamp.from(now));
        }
        return expectedVersion + 1;
    }

    private boolean exists(UUID tenantId, UUID userId) {
        Boolean exists = jdbc.queryForObject(
                """
                select exists(
                    select 1 from user_application_access_sets
                    where tenant_id = ? and user_id = ?
                )
                """,
                Boolean.class,
                tenantId,
                userId);
        return Boolean.TRUE.equals(exists);
    }

    public record Snapshot(long version, Set<String> applications) {

        public Snapshot {
            applications = Set.copyOf(applications);
        }
    }
}
