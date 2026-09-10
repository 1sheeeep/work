package cn.xzkj.erp.platformadmin.shopifyrelease;

import cn.xzkj.erp.platformadmin.shopifyrelease.ShopifyAppReleaseCredentialCipher.EncryptedToken;
import cn.xzkj.erp.platformadmin.shopifyrelease.ShopifyAppReleaseCredentialCipher.StoredToken;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class ShopifyAppReleaseRepository {
    private final NamedParameterJdbcTemplate jdbc;

    ShopifyAppReleaseRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    StoredRelease find() {
        return jdbc.query("""
                SELECT token_key_version, token_nonce, token_ciphertext,
                       status, release_version, release_message, released_at,
                       version, updated_at
                  FROM system_shopify_app_release
                 WHERE singleton_id = 1
                """, Map.of(), (rs, row) -> new StoredRelease(
                        new StoredToken(
                                rs.getString("token_key_version"),
                                rs.getBytes("token_nonce"),
                                rs.getBytes("token_ciphertext")),
                        rs.getString("status"),
                        rs.getString("release_version"),
                        rs.getString("release_message"),
                        instant(rs.getObject("released_at", OffsetDateTime.class)),
                        rs.getLong("version"),
                        rs.getObject("updated_at", OffsetDateTime.class).toInstant()))
                .stream().findFirst().orElse(null);
    }

    boolean saveToken(EncryptedToken token, long expectedVersion,
            UUID actorSystemAdminId) {
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("keyVersion", token.keyVersion())
                .addValue("nonce", token.nonce())
                .addValue("ciphertext", token.ciphertext())
                .addValue("expectedVersion", expectedVersion)
                .addValue("actorSystemAdminId", actorSystemAdminId);
        if (expectedVersion == 0 && find() == null) {
            return jdbc.update("""
                    INSERT INTO system_shopify_app_release (
                        singleton_id, token_key_version, token_nonce,
                        token_ciphertext, status,
                        updated_by_system_admin_id
                    ) VALUES (
                        1, :keyVersion, :nonce, :ciphertext, 'CONFIGURED',
                        :actorSystemAdminId
                    )
                    """, parameters) == 1;
        }
        return jdbc.update("""
                UPDATE system_shopify_app_release
                   SET token_key_version = :keyVersion,
                       token_nonce = :nonce,
                       token_ciphertext = :ciphertext,
                       status = 'CONFIGURED',
                       release_message = NULL,
                       version = version + 1,
                       updated_by_system_admin_id = :actorSystemAdminId,
                       updated_at = now()
                 WHERE singleton_id = 1
                   AND version = :expectedVersion
                   AND status <> 'RUNNING'
                """, parameters) == 1;
    }

    boolean delete(long expectedVersion) {
        return jdbc.update("""
                DELETE FROM system_shopify_app_release
                 WHERE singleton_id = 1
                   AND version = :expectedVersion
                   AND status <> 'RUNNING'
                """, Map.of("expectedVersion", expectedVersion)) == 1;
    }

    boolean markRunning(long expectedVersion, UUID actorSystemAdminId) {
        return jdbc.update("""
                UPDATE system_shopify_app_release
                   SET status = 'RUNNING',
                       release_message = NULL,
                       version = version + 1,
                       updated_by_system_admin_id = :actorSystemAdminId,
                       updated_at = now()
                 WHERE singleton_id = 1
                   AND version = :expectedVersion
                   AND status <> 'RUNNING'
                """, Map.of(
                        "expectedVersion", expectedVersion,
                        "actorSystemAdminId", actorSystemAdminId)) == 1;
    }

    int failInterruptedRelease() {
        return jdbc.update("""
                UPDATE system_shopify_app_release
                   SET status = 'FAILED',
                       release_message = '上次发布因系统服务重启而中断，请重新发布。',
                       version = version + 1,
                       updated_at = now()
                 WHERE singleton_id = 1
                   AND status = 'RUNNING'
                """, Map.of());
    }

    boolean finish(long expectedVersion, String status, String releaseVersion,
            String message, boolean released, UUID actorSystemAdminId) {
        return jdbc.update("""
                UPDATE system_shopify_app_release
                   SET status = :status,
                       release_version = :releaseVersion,
                       release_message = :message,
                       released_at = CASE WHEN :released THEN now()
                                          ELSE released_at END,
                       version = version + 1,
                       updated_by_system_admin_id = :actorSystemAdminId,
                       updated_at = now()
                 WHERE singleton_id = 1
                   AND version = :expectedVersion
                   AND status = 'RUNNING'
                """, new MapSqlParameterSource()
                        .addValue("status", status)
                        .addValue("releaseVersion", releaseVersion)
                        .addValue("message", message)
                        .addValue("released", released)
                        .addValue("expectedVersion", expectedVersion)
                        .addValue("actorSystemAdminId", actorSystemAdminId)) == 1;
    }

    private static Instant instant(OffsetDateTime value) {
        return value == null ? null : value.toInstant();
    }

    record StoredRelease(
            StoredToken token,
            String status,
            String releaseVersion,
            String releaseMessage,
            Instant releasedAt,
            long version,
            Instant updatedAt) {
    }
}
