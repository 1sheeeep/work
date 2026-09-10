package cn.xzkj.erp.logistics.authorization;

import cn.xzkj.erp.logistics.authorization.LogisticsCredentialCipher.EncryptedCredential;
import cn.xzkj.erp.logistics.authorization.LogisticsCredentialCipher.StoredCredential;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class LogisticsProviderSystemConfigRepository {
    private final NamedParameterJdbcTemplate jdbc;

    LogisticsProviderSystemConfigRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    StoredProviderConfig find(String providerCode) {
        return jdbc.query("""
                select provider_code, key_version, nonce, ciphertext,
                       version, updated_at
                  from system_logistics_provider_credentials
                 where provider_code = :providerCode
                """, Map.of("providerCode", providerCode),
                (rs, row) -> new StoredProviderConfig(
                        rs.getString("provider_code"),
                        new StoredCredential(rs.getString("key_version"),
                                rs.getBytes("nonce"), rs.getBytes("ciphertext")),
                        rs.getLong("version"),
                        rs.getObject("updated_at", OffsetDateTime.class).toInstant()))
                .stream().findFirst().orElse(null);
    }

    StoredProviderName findName(String providerCode) {
        return jdbc.query("""
                select provider_code, display_name, version, updated_at
                  from system_logistics_provider_display_names
                 where provider_code = :providerCode
                """, Map.of("providerCode", providerCode),
                (rs, row) -> new StoredProviderName(
                        rs.getString("provider_code"),
                        rs.getString("display_name"),
                        rs.getLong("version"),
                        rs.getObject("updated_at", OffsetDateTime.class).toInstant()))
                .stream().findFirst().orElse(null);
    }

    boolean save(String providerCode, EncryptedCredential credential,
            long expectedVersion, UUID actorSystemAdminId) {
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("providerCode", providerCode)
                .addValue("keyVersion", credential.keyVersion())
                .addValue("nonce", credential.nonce())
                .addValue("ciphertext", credential.ciphertext())
                .addValue("expectedVersion", expectedVersion)
                .addValue("actorSystemAdminId", actorSystemAdminId);
        if (expectedVersion == 0 && find(providerCode) == null) {
            return jdbc.update("""
                    insert into system_logistics_provider_credentials (
                        provider_code, key_version, nonce, ciphertext,
                        updated_by_system_admin_id
                    ) values (
                        :providerCode, :keyVersion, :nonce, :ciphertext,
                        :actorSystemAdminId
                    )
                    """, parameters) == 1;
        }
        return jdbc.update("""
                update system_logistics_provider_credentials
                   set key_version = :keyVersion,
                       nonce = :nonce,
                       ciphertext = :ciphertext,
                       version = version + 1,
                       updated_by_system_admin_id = :actorSystemAdminId,
                       updated_at = now()
                 where provider_code = :providerCode
                   and version = :expectedVersion
                """, parameters) == 1;
    }

    boolean saveName(String providerCode, String displayName,
            long expectedVersion, UUID actorSystemAdminId) {
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("providerCode", providerCode)
                .addValue("displayName", displayName)
                .addValue("expectedVersion", expectedVersion)
                .addValue("actorSystemAdminId", actorSystemAdminId);
        if (expectedVersion == 0 && findName(providerCode) == null) {
            return jdbc.update("""
                    insert into system_logistics_provider_display_names (
                        provider_code, display_name, updated_by_system_admin_id
                    ) values (
                        :providerCode, :displayName, :actorSystemAdminId
                    )
                    """, parameters) == 1;
        }
        return jdbc.update("""
                update system_logistics_provider_display_names
                   set display_name = :displayName,
                       version = version + 1,
                       updated_by_system_admin_id = :actorSystemAdminId,
                       updated_at = now()
                 where provider_code = :providerCode
                   and version = :expectedVersion
                """, parameters) == 1;
    }

    record StoredProviderConfig(String providerCode, StoredCredential credential,
            long version, Instant updatedAt) {
    }

    record StoredProviderName(String providerCode, String displayName,
            long version, Instant updatedAt) {
    }
}
