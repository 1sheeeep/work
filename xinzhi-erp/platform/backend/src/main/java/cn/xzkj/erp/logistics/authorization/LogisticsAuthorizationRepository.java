package cn.xzkj.erp.logistics.authorization;

import cn.xzkj.erp.logistics.authorization.LogisticsCredentialCipher.EncryptedCredential;
import cn.xzkj.erp.logistics.authorization.LogisticsCredentialCipher.StoredCredential;
import cn.xzkj.erp.logistics.authorization.LogisticsProviderConnectorGateway.DiscoveredChannel;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class LogisticsAuthorizationRepository {
    private static final String SELECT = """
            select authorization_profile.id, category, provider_code,
                   provider_name, account_label, integration_mode,
                   (credential_reference is not null or exists (
                       select 1 from tenant_logistics_authorization_credentials credential
                        where credential.authorization_id = authorization_profile.id
                          and credential.tenant_id = authorization_profile.tenant_id
                   )) as credential_configured,
                   case when exists (
                       select 1 from tenant_logistics_authorization_credentials credential
                        where credential.authorization_id = authorization_profile.id
                          and credential.tenant_id = authorization_profile.tenant_id
                   ) then 'ENCRYPTED'
                   when credential_reference is null then null
                   else upper(split_part(credential_reference, '://', 1)) end as credential_type,
                   contact_name, note, lifecycle_status, created_by_display_name,
                   version, created_at, updated_at
              from tenant_logistics_authorizations authorization_profile
            """;
    private static final String CHANNEL_SELECT = """
            select channel.id, channel.authorization_id,
                   authorization_profile.provider_code,
                   authorization_profile.provider_name,
                   authorization_profile.account_label,
                   authorization_profile.lifecycle_status as account_status,
                   channel.channel_code, channel.channel_name,
                   channel.enabled, channel.provider_available,
                   (channel.enabled and channel.provider_available
                    and authorization_profile.lifecycle_status = 'ACTIVE')
                       as effective_enabled,
                   channel.version, channel.last_synced_at, channel.updated_at
              from tenant_logistics_authorization_channels channel
              join tenant_logistics_authorizations authorization_profile
                on authorization_profile.id = channel.authorization_id
               and authorization_profile.tenant_id = channel.tenant_id
            """;
    private final NamedParameterJdbcTemplate jdbc;

    LogisticsAuthorizationRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    Page<LogisticsAuthorizationRecord> list(UUID tenantId, String category,
            String name, String status, Pageable pageable) {
        StringBuilder where = new StringBuilder(
                " where authorization_profile.tenant_id = :tenantId"
                        + " and authorization_profile.category = :category");
        if (name != null) where.append(
                " and (lower(provider_name) like :name escape '\\'"
                        + " or lower(account_label) like :name escape '\\')");
        if (status != null) where.append(" and lifecycle_status = :status");
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("tenantId", tenantId).addValue("category", category)
                .addValue("name", pattern(name)).addValue("status", status)
                .addValue("limit", pageable.getPageSize())
                .addValue("offset", pageable.getOffset());
        List<LogisticsAuthorizationRecord> items = jdbc.query(
                SELECT + where + " order by updated_at desc, id desc limit :limit offset :offset",
                parameters, LogisticsAuthorizationRepository::map);
        Long total = jdbc.queryForObject(
                "select count(*) from tenant_logistics_authorizations authorization_profile" + where,
                parameters, Long.class);
        return new PageImpl<>(items, pageable, total == null ? 0 : total);
    }

    LogisticsAuthorizationRecord find(UUID tenantId, UUID id) {
        return jdbc.query(SELECT + " where tenant_id = :tenantId and id = :id",
                Map.of("tenantId", tenantId, "id", id),
                LogisticsAuthorizationRepository::map)
                .stream().findFirst().orElse(null);
    }

    LogisticsAuthorizationRecord findByIdentity(UUID tenantId, String category,
            String providerName, String accountLabel) {
        return jdbc.query(SELECT + """
                 where tenant_id = :tenantId
                   and category = :category
                   and lower(provider_name) = lower(:providerName)
                   and lower(account_label) = lower(:accountLabel)
                 order by updated_at desc, id desc
                 limit 1
                """, Map.of(
                        "tenantId", tenantId,
                        "category", category,
                        "providerName", providerName,
                        "accountLabel", accountLabel),
                LogisticsAuthorizationRepository::map)
                .stream().findFirst().orElse(null);
    }

    void insert(UUID id, UUID tenantId,
            LogisticsAuthorizationService.AuthorizationInput value,
            LogisticsAuthorizationService.Actor actor) {
        jdbc.update("""
                insert into tenant_logistics_authorizations (
                    id, tenant_id, category, provider_code, provider_name, account_label,
                    integration_mode, credential_reference, contact_name, note,
                    lifecycle_status, created_by_display_name,
                    created_by_user_id, created_by_system_admin_id,
                    updated_by_user_id, updated_by_system_admin_id, request_id
                ) values (
                    :id, :tenantId, :category, :providerCode, :providerName, :accountLabel,
                    :integrationMode, :credentialReference, :contactName, :note,
                    :status, :displayName, :userId, :systemAdminId,
                    :userId, :systemAdminId, :requestId
                )
                """, actorParameters(id, tenantId, actor)
                .addValue("category", value.category())
                .addValue("providerCode", value.providerCode())
                .addValue("providerName", value.providerName())
                .addValue("accountLabel", value.accountLabel())
                .addValue("integrationMode", value.integrationMode())
                .addValue("credentialReference", value.credentialReference())
                .addValue("contactName", value.contactName())
                .addValue("note", value.note())
                .addValue("status", "MANUAL".equals(value.integrationMode())
                        ? "ACTIVE" : "PENDING"));
    }

    void saveCredential(UUID id, UUID tenantId, EncryptedCredential credential,
            LogisticsAuthorizationService.Actor actor) {
        jdbc.update("""
                insert into tenant_logistics_authorization_credentials (
                    authorization_id, tenant_id, key_version, nonce, ciphertext,
                    updated_by_user_id, updated_by_system_admin_id
                ) values (
                    :id, :tenantId, :keyVersion, :nonce, :ciphertext,
                    :userId, :systemAdminId
                )
                on conflict (authorization_id) do update set
                    key_version = excluded.key_version,
                    nonce = excluded.nonce,
                    ciphertext = excluded.ciphertext,
                    updated_by_user_id = excluded.updated_by_user_id,
                    updated_by_system_admin_id = excluded.updated_by_system_admin_id,
                    updated_at = now()
                """, actorParameters(id, tenantId, actor)
                .addValue("keyVersion", credential.keyVersion())
                .addValue("nonce", credential.nonce())
                .addValue("ciphertext", credential.ciphertext()));
    }

    StoredCredential findCredential(UUID tenantId, UUID id) {
        return jdbc.query("""
                select key_version, nonce, ciphertext
                  from tenant_logistics_authorization_credentials
                 where tenant_id = :tenantId and authorization_id = :id
                """, Map.of("tenantId", tenantId, "id", id),
                (rs, row) -> new StoredCredential(
                        rs.getString("key_version"), rs.getBytes("nonce"),
                        rs.getBytes("ciphertext")))
                .stream().findFirst().orElse(null);
    }

    boolean prepareCredentialReplacement(UUID tenantId, UUID id, long version,
            LogisticsAuthorizationService.Actor actor) {
        return jdbc.update("""
                update tenant_logistics_authorizations
                   set lifecycle_status = case
                           when lifecycle_status = 'ARCHIVED' then 'ARCHIVED'
                           else 'PENDING'
                       end,
                       version = version + 1,
                       updated_by_user_id = :userId,
                       updated_by_system_admin_id = :systemAdminId,
                       request_id = :requestId, updated_at = now()
                 where tenant_id = :tenantId and id = :id
                   and version = :version
                   and lifecycle_status in ('PENDING', 'ACTIVE', 'ARCHIVED')
                   and integration_mode = 'DIRECT_CREDENTIALS'
                """, actorParameters(id, tenantId, actor)
                .addValue("version", version)) == 1;
    }

    boolean updateAccountLabel(UUID tenantId, UUID id, long version,
            String accountLabel, LogisticsAuthorizationService.Actor actor) {
        return jdbc.update("""
                update tenant_logistics_authorizations
                   set account_label = :accountLabel,
                       version = version + 1,
                       updated_by_user_id = :userId,
                       updated_by_system_admin_id = :systemAdminId,
                       request_id = :requestId,
                       updated_at = now()
                 where tenant_id = :tenantId and id = :id
                   and version = :version
                   and lifecycle_status in ('PENDING', 'ACTIVE', 'ARCHIVED')
                """, actorParameters(id, tenantId, actor)
                .addValue("version", version)
                .addValue("accountLabel", accountLabel)) == 1;
    }

    boolean activate(UUID tenantId, UUID id, long version,
            LogisticsAuthorizationService.Actor actor) {
        return jdbc.update("""
                update tenant_logistics_authorizations
                   set lifecycle_status = 'ACTIVE', version = version + 1,
                       updated_by_user_id = :userId,
                       updated_by_system_admin_id = :systemAdminId,
                       request_id = :requestId, updated_at = now()
                 where tenant_id = :tenantId and id = :id
                   and version = :version and lifecycle_status = 'PENDING'
                """, actorParameters(id, tenantId, actor)
                .addValue("version", version)) == 1;
    }

    boolean archive(UUID tenantId, UUID id, long version,
            LogisticsAuthorizationService.Actor actor) {
        return jdbc.update("""
                update tenant_logistics_authorizations
                   set lifecycle_status = 'ARCHIVED', version = version + 1,
                       updated_by_user_id = :userId,
                       updated_by_system_admin_id = :systemAdminId,
                       request_id = :requestId, updated_at = now()
                 where tenant_id = :tenantId and id = :id
                   and version = :version and lifecycle_status <> 'ARCHIVED'
                """, actorParameters(id, tenantId, actor)
                .addValue("version", version)) == 1;
    }

    boolean enable(UUID tenantId, UUID id, long version,
            LogisticsAuthorizationService.Actor actor) {
        return jdbc.update("""
                update tenant_logistics_authorizations
                   set lifecycle_status = case
                           when integration_mode = 'MANUAL' then 'ACTIVE'
                           else 'PENDING'
                       end,
                       version = version + 1,
                       updated_by_user_id = :userId,
                       updated_by_system_admin_id = :systemAdminId,
                       request_id = :requestId, updated_at = now()
                 where tenant_id = :tenantId and id = :id
                   and version = :version
                   and lifecycle_status = 'ARCHIVED'
                """, actorParameters(id, tenantId, actor)
                .addValue("version", version)) == 1;
    }

    boolean deleteArchived(UUID tenantId, UUID id, long version) {
        return jdbc.update("""
                delete from tenant_logistics_authorizations
                 where tenant_id = :tenantId and id = :id
                   and version = :version
                   and lifecycle_status = 'ARCHIVED'
                """, Map.of(
                        "tenantId", tenantId,
                        "id", id,
                        "version", version)) == 1;
    }

    List<LogisticsAuthorizationChannelRecord> listChannels(
            UUID tenantId, UUID authorizationId) {
        return jdbc.query(CHANNEL_SELECT + """
                 where channel.tenant_id = :tenantId
                   and channel.authorization_id = :authorizationId
                 order by channel.enabled desc, channel.provider_available desc,
                          lower(channel.channel_name), channel.id
                """, Map.of("tenantId", tenantId,
                        "authorizationId", authorizationId),
                LogisticsAuthorizationRepository::mapChannel);
    }

    List<LogisticsAuthorizationChannelRecord> listEnabledChannels(UUID tenantId) {
        return jdbc.query(CHANNEL_SELECT + """
                 where channel.tenant_id = :tenantId
                   and channel.enabled = true
                   and channel.provider_available = true
                   and authorization_profile.lifecycle_status = 'ACTIVE'
                 order by lower(authorization_profile.provider_name),
                          lower(authorization_profile.account_label),
                          lower(channel.channel_name), channel.id
                """, Map.of("tenantId", tenantId),
                LogisticsAuthorizationRepository::mapChannel);
    }

    LogisticsAuthorizationChannelRecord findChannel(UUID tenantId,
            UUID authorizationId, UUID channelId) {
        return jdbc.query(CHANNEL_SELECT + """
                 where channel.tenant_id = :tenantId
                   and channel.authorization_id = :authorizationId
                   and channel.id = :channelId
                """, Map.of("tenantId", tenantId,
                        "authorizationId", authorizationId,
                        "channelId", channelId),
                LogisticsAuthorizationRepository::mapChannel)
                .stream().findFirst().orElse(null);
    }

    void synchronizeChannels(UUID tenantId, UUID authorizationId,
            List<DiscoveredChannel> channels,
            LogisticsAuthorizationService.Actor actor) {
        for (DiscoveredChannel channel : channels) {
            jdbc.update("""
                    insert into tenant_logistics_authorization_channels (
                        id, authorization_id, tenant_id, channel_code,
                        channel_name, enabled, provider_available,
                        updated_by_user_id, updated_by_system_admin_id
                    ) values (
                        :channelId, :authorizationId, :tenantId, :channelCode,
                        :channelName, false, true, :userId, :systemAdminId
                    )
                    on conflict (authorization_id, channel_code) do update set
                        channel_name = excluded.channel_name,
                        provider_available = true,
                        version = case
                            when tenant_logistics_authorization_channels.channel_name
                                    <> excluded.channel_name
                              or not tenant_logistics_authorization_channels.provider_available
                            then tenant_logistics_authorization_channels.version + 1
                            else tenant_logistics_authorization_channels.version
                        end,
                        last_synced_at = now(), updated_at = now(),
                        updated_by_user_id = excluded.updated_by_user_id,
                        updated_by_system_admin_id = excluded.updated_by_system_admin_id
                    """, actorParameters(authorizationId, tenantId, actor)
                    .addValue("channelId", UUID.randomUUID())
                    .addValue("authorizationId", authorizationId)
                    .addValue("channelCode", channel.code())
                    .addValue("channelName", channel.name()));
        }
        MapSqlParameterSource parameters = actorParameters(
                authorizationId, tenantId, actor)
                .addValue("authorizationId", authorizationId);
        String missingPredicate = channels.isEmpty()
                ? ""
                : " and channel_code not in (:availableChannelCodes)";
        if (!channels.isEmpty()) {
            parameters.addValue("availableChannelCodes",
                    channels.stream().map(DiscoveredChannel::code).toList());
        }
        jdbc.update("""
                update tenant_logistics_authorization_channels
                   set provider_available = false,
                       enabled = false,
                       version = case
                           when provider_available or enabled then version + 1
                           else version
                       end,
                       last_synced_at = now(), updated_at = now(),
                       updated_by_user_id = :userId,
                       updated_by_system_admin_id = :systemAdminId
                 where tenant_id = :tenantId
                   and authorization_id = :authorizationId
                """ + missingPredicate, parameters);
    }

    void disableAllChannels(UUID tenantId, UUID authorizationId,
            LogisticsAuthorizationService.Actor actor) {
        jdbc.update("""
                update tenant_logistics_authorization_channels
                   set enabled = false, version = version + 1,
                       updated_at = now(),
                       updated_by_user_id = :userId,
                       updated_by_system_admin_id = :systemAdminId
                 where tenant_id = :tenantId
                   and authorization_id = :authorizationId
                   and enabled = true
                """, actorParameters(authorizationId, tenantId, actor)
                .addValue("authorizationId", authorizationId));
    }

    boolean setChannelEnabled(UUID tenantId, UUID authorizationId,
            UUID channelId, long version, boolean enabled,
            LogisticsAuthorizationService.Actor actor) {
        return jdbc.update("""
                update tenant_logistics_authorization_channels channel
                   set enabled = :enabled, version = version + 1,
                       updated_at = now(),
                       updated_by_user_id = :userId,
                       updated_by_system_admin_id = :systemAdminId
                 where channel.tenant_id = :tenantId
                   and channel.authorization_id = :authorizationId
                   and channel.id = :channelId
                   and channel.version = :version
                   and channel.enabled <> :enabled
                   and (not :enabled or (
                       channel.provider_available = true and exists (
                           select 1 from tenant_logistics_authorizations authorization_profile
                            where authorization_profile.tenant_id = channel.tenant_id
                              and authorization_profile.id = channel.authorization_id
                              and authorization_profile.lifecycle_status = 'ACTIVE'
                       )
                   ))
                """, actorParameters(channelId, tenantId, actor)
                .addValue("authorizationId", authorizationId)
                .addValue("channelId", channelId)
                .addValue("version", version)
                .addValue("enabled", enabled)) == 1;
    }

    private static String pattern(String value) {
        if (value == null) return null;
        return "%" + value.replace("\\", "\\\\")
                .replace("%", "\\%").replace("_", "\\_") + "%";
    }

    private static MapSqlParameterSource actorParameters(UUID id, UUID tenantId,
            LogisticsAuthorizationService.Actor actor) {
        return new MapSqlParameterSource().addValue("id", id)
                .addValue("tenantId", tenantId).addValue("displayName", actor.displayName())
                .addValue("userId", actor.userId()).addValue("systemAdminId", actor.systemAdminId())
                .addValue("requestId", actor.requestId());
    }

    private static LogisticsAuthorizationRecord map(ResultSet rs, int row)
            throws SQLException {
        return new LogisticsAuthorizationRecord(
                rs.getObject("id", UUID.class), rs.getString("category"),
                rs.getString("provider_code"),
                rs.getString("provider_name"), rs.getString("account_label"),
                rs.getString("integration_mode"), rs.getBoolean("credential_configured"),
                rs.getString("credential_type"), rs.getString("contact_name"),
                rs.getString("note"), rs.getString("lifecycle_status"),
                rs.getString("created_by_display_name"), rs.getLong("version"),
                rs.getObject("created_at", OffsetDateTime.class).toInstant(),
                rs.getObject("updated_at", OffsetDateTime.class).toInstant());
    }

    private static LogisticsAuthorizationChannelRecord mapChannel(
            ResultSet rs, int row) throws SQLException {
        return new LogisticsAuthorizationChannelRecord(
                rs.getObject("id", UUID.class),
                rs.getObject("authorization_id", UUID.class),
                rs.getString("provider_code"), rs.getString("provider_name"),
                rs.getString("account_label"), rs.getString("account_status"),
                rs.getString("channel_code"), rs.getString("channel_name"),
                rs.getBoolean("enabled"), rs.getBoolean("provider_available"),
                rs.getBoolean("effective_enabled"), rs.getLong("version"),
                rs.getObject("last_synced_at", OffsetDateTime.class).toInstant(),
                rs.getObject("updated_at", OffsetDateTime.class).toInstant());
    }
}
