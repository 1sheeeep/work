package cn.xzkj.erp.settings.approval;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class ApprovalRuleRepository {
    private final NamedParameterJdbcTemplate jdbc;

    ApprovalRuleRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    ApprovalRuleService.RulePage list(UUID tenantId,
            ApprovalRuleService.RuleQuery query) {
        MapSqlParameterSource parameters = queryParameters(tenantId, query);
        Long total = jdbc.queryForObject("""
                select count(*) from tenant_approval_rules rule
                 where rule.tenant_id = :tenantId
                   and (cast(:enabled as boolean) is null or rule.enabled = :enabled)
                   and (cast(:documentType as varchar) is null
                        or rule.document_type = :documentType)
                   and (cast(:keyword as varchar) is null
                        or lower(rule.name) like :keyword
                        or lower(coalesce(rule.description, '')) like :keyword)
                """, parameters, Long.class);
        List<RuleRow> rows = jdbc.query("""
                select rule.id, rule.priority, rule.name, rule.document_type,
                       rule.description, rule.enabled, rule.version,
                       rule.created_by_display_name, rule.updated_by_display_name,
                       rule.created_at, rule.updated_at
                  from tenant_approval_rules rule
                 where rule.tenant_id = :tenantId
                   and (cast(:enabled as boolean) is null or rule.enabled = :enabled)
                   and (cast(:documentType as varchar) is null
                        or rule.document_type = :documentType)
                   and (cast(:keyword as varchar) is null
                        or lower(rule.name) like :keyword
                        or lower(coalesce(rule.description, '')) like :keyword)
                 order by rule.priority, rule.created_at, rule.id
                 limit :size offset :offset
                """, parameters, ApprovalRuleRepository::mapRow);
        Map<UUID, List<ApprovalRuleRecord.Approver>> approvers =
                findApprovers(tenantId, rows.stream().map(RuleRow::id).toList());
        List<ApprovalRuleRecord> items = rows.stream()
                .map(row -> row.record(approvers.getOrDefault(row.id(), List.of())))
                .toList();
        return new ApprovalRuleService.RulePage(items, query.page(), query.size(),
                total == null ? 0 : total);
    }

    Optional<ApprovalRuleRecord> find(UUID tenantId, UUID id) {
        Optional<RuleRow> row = jdbc.query("""
                select rule.id, rule.priority, rule.name, rule.document_type,
                       rule.description, rule.enabled, rule.version,
                       rule.created_by_display_name, rule.updated_by_display_name,
                       rule.created_at, rule.updated_at
                  from tenant_approval_rules rule
                 where rule.tenant_id = :tenantId and rule.id = :id
                """, new MapSqlParameterSource("tenantId", tenantId)
                .addValue("id", id), ApprovalRuleRepository::mapRow)
                .stream().findFirst();
        return row.map(value -> value.record(findApprovers(tenantId, List.of(id))
                .getOrDefault(id, List.of())));
    }

    List<ApprovalRuleService.ApproverCandidate> candidates(UUID tenantId) {
        return jdbc.query("""
                select id, display_name
                  from users
                 where tenant_id = :tenantId and status = 'ACTIVE'
                 order by lower(display_name), id
                """, new MapSqlParameterSource("tenantId", tenantId),
                (resultSet, row) -> new ApprovalRuleService.ApproverCandidate(
                        resultSet.getObject("id", UUID.class),
                        resultSet.getString("display_name")));
    }

    void insert(UUID tenantId, UUID id, ApprovalRuleService.RuleInput input,
            ApprovalRuleService.Actor actor) {
        jdbc.update("""
                insert into tenant_approval_rules (
                    id, tenant_id, priority, name, name_key, document_type,
                    description, enabled, created_by_display_name,
                    updated_by_display_name, created_by_user_id,
                    created_by_system_admin_id, updated_by_user_id,
                    updated_by_system_admin_id, request_id
                ) values (
                    :id, :tenantId, :priority, :name, :nameKey, :documentType,
                    :description, :enabled, :displayName, :displayName,
                    :userId, :systemAdminId, :userId, :systemAdminId, :requestId
                )
                """, parameters(tenantId, id, input, actor));
        replaceApprovers(tenantId, id, input.approverUserIds());
    }

    boolean update(UUID tenantId, UUID id, long version,
            ApprovalRuleService.RuleInput input, ApprovalRuleService.Actor actor) {
        int updated = jdbc.update("""
                update tenant_approval_rules
                   set priority = :priority, name = :name, name_key = :nameKey,
                       document_type = :documentType, description = :description,
                       enabled = :enabled, updated_by_display_name = :displayName,
                       updated_by_user_id = :userId,
                       updated_by_system_admin_id = :systemAdminId,
                       request_id = :requestId, version = version + 1,
                       updated_at = now()
                 where tenant_id = :tenantId and id = :id and version = :version
                """, parameters(tenantId, id, input, actor)
                .addValue("version", version));
        if (updated == 1) replaceApprovers(tenantId, id, input.approverUserIds());
        return updated == 1;
    }

    boolean setEnabled(UUID tenantId, UUID id, long version, boolean enabled,
            ApprovalRuleService.Actor actor) {
        return jdbc.update("""
                update tenant_approval_rules
                   set enabled = :enabled, updated_by_display_name = :displayName,
                       updated_by_user_id = :userId,
                       updated_by_system_admin_id = :systemAdminId,
                       request_id = :requestId, version = version + 1,
                       updated_at = now()
                 where tenant_id = :tenantId and id = :id and version = :version
                """, new MapSqlParameterSource("tenantId", tenantId)
                .addValue("id", id).addValue("version", version)
                .addValue("enabled", enabled)
                .addValue("displayName", actor.displayName())
                .addValue("userId", actor.userId())
                .addValue("systemAdminId", actor.systemAdminId())
                .addValue("requestId", actor.requestId())) == 1;
    }

    boolean delete(UUID tenantId, UUID id, long version) {
        return jdbc.update("""
                delete from tenant_approval_rules
                 where tenant_id = :tenantId and id = :id and version = :version
                """, new MapSqlParameterSource("tenantId", tenantId)
                .addValue("id", id).addValue("version", version)) == 1;
    }

    private void replaceApprovers(UUID tenantId, UUID ruleId, List<UUID> ids) {
        jdbc.update("delete from tenant_approval_rule_approvers where tenant_id = :tenantId and rule_id = :ruleId",
                new MapSqlParameterSource("tenantId", tenantId).addValue("ruleId", ruleId));
        for (int index = 0; index < ids.size(); index++) {
            jdbc.update("""
                    insert into tenant_approval_rule_approvers (
                        rule_id, tenant_id, approver_user_id, step_order
                    ) values (:ruleId, :tenantId, :userId, :stepOrder)
                    """, new MapSqlParameterSource("ruleId", ruleId)
                    .addValue("tenantId", tenantId)
                    .addValue("userId", ids.get(index))
                    .addValue("stepOrder", index + 1));
        }
    }

    private Map<UUID, List<ApprovalRuleRecord.Approver>> findApprovers(
            UUID tenantId, List<UUID> ruleIds) {
        if (ruleIds.isEmpty()) return Map.of();
        Map<UUID, List<ApprovalRuleRecord.Approver>> result = new LinkedHashMap<>();
        jdbc.query("""
                select link.rule_id, link.approver_user_id, link.step_order,
                       member.display_name
                  from tenant_approval_rule_approvers link
                  join users member on member.tenant_id = link.tenant_id
                                   and member.id = link.approver_user_id
                 where link.tenant_id = :tenantId and link.rule_id in (:ruleIds)
                 order by link.rule_id, link.step_order
                """, new MapSqlParameterSource("tenantId", tenantId)
                .addValue("ruleIds", ruleIds), resultSet -> {
                    UUID ruleId = resultSet.getObject("rule_id", UUID.class);
                    result.computeIfAbsent(ruleId, ignored -> new ArrayList<>()).add(
                            new ApprovalRuleRecord.Approver(
                                    resultSet.getObject("approver_user_id", UUID.class),
                                    resultSet.getString("display_name"),
                                    resultSet.getInt("step_order")));
                });
        return result;
    }

    private static MapSqlParameterSource queryParameters(UUID tenantId,
            ApprovalRuleService.RuleQuery query) {
        MapSqlParameterSource parameters = new MapSqlParameterSource("tenantId", tenantId)
                .addValue("enabled", query.enabled())
                .addValue("documentType", query.documentType() == null ? null : query.documentType().name())
                .addValue("keyword", query.keyword() == null ? null : "%" + query.keyword().toLowerCase(java.util.Locale.ROOT) + "%")
                .addValue("size", query.size())
                .addValue("offset", query.page() * query.size());
        return parameters;
    }

    private static MapSqlParameterSource parameters(UUID tenantId, UUID id,
            ApprovalRuleService.RuleInput input, ApprovalRuleService.Actor actor) {
        return new MapSqlParameterSource("tenantId", tenantId)
                .addValue("id", id).addValue("priority", input.priority())
                .addValue("name", input.name()).addValue("nameKey", input.nameKey())
                .addValue("documentType", input.documentType().name())
                .addValue("description", input.description())
                .addValue("enabled", input.enabled())
                .addValue("displayName", actor.displayName())
                .addValue("userId", actor.userId())
                .addValue("systemAdminId", actor.systemAdminId())
                .addValue("requestId", actor.requestId());
    }

    private static RuleRow mapRow(ResultSet resultSet, int row) throws SQLException {
        return new RuleRow(resultSet.getObject("id", UUID.class),
                resultSet.getInt("priority"), resultSet.getString("name"),
                ApprovalRuleService.DocumentType.valueOf(resultSet.getString("document_type")),
                resultSet.getString("description"), resultSet.getBoolean("enabled"),
                resultSet.getLong("version"),
                resultSet.getString("created_by_display_name"),
                resultSet.getString("updated_by_display_name"),
                instant(resultSet, "created_at"), instant(resultSet, "updated_at"));
    }

    private static java.time.Instant instant(ResultSet resultSet, String column)
            throws SQLException {
        return resultSet.getObject(column, OffsetDateTime.class).toInstant();
    }

    private record RuleRow(UUID id, int priority, String name,
            ApprovalRuleService.DocumentType documentType, String description,
            boolean enabled, long version, String createdByDisplayName,
            String updatedByDisplayName, java.time.Instant createdAt,
            java.time.Instant updatedAt) {
        ApprovalRuleRecord record(List<ApprovalRuleRecord.Approver> approvers) {
            return new ApprovalRuleRecord(id, priority, name, documentType,
                    description, enabled, approvers, version, createdByDisplayName,
                    updatedByDisplayName, createdAt, updatedAt);
        }
    }
}
