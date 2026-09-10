package cn.xzkj.erp.logistics.labeltemplate;

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
class LabelTemplateRepository {
    private static final String SELECT = """
            select id, name, document_category, width_mm, height_mm,
                   template_content, note, lifecycle_status,
                   created_by_display_name, version, created_at, updated_at
              from tenant_logistics_label_templates template
            """;

    private final NamedParameterJdbcTemplate jdbc;

    LabelTemplateRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    Page<LabelTemplateRecord> list(
            UUID tenantId,
            String documentCategory,
            String size,
            String keyword,
            Pageable pageable) {
        String where = " where template.tenant_id = :tenantId"
                + " and template.lifecycle_status = 'ACTIVE'"
                + (documentCategory == null ? ""
                    : " and lower(template.document_category) like :documentCategory escape '\\'")
                + (size == null ? ""
                    : " and concat(template.width_mm, 'x', template.height_mm) = :size")
                + (keyword == null ? ""
                    : " and lower(template.name) like :keyword escape '\\'");
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("documentCategory", pattern(documentCategory))
                .addValue("size", size)
                .addValue("keyword", pattern(keyword))
                .addValue("limit", pageable.getPageSize())
                .addValue("offset", pageable.getOffset());
        List<LabelTemplateRecord> items = jdbc.query(
                SELECT + where
                        + " order by template.updated_at desc, template.id desc"
                        + " limit :limit offset :offset",
                parameters, LabelTemplateRepository::map);
        Long total = jdbc.queryForObject(
                "select count(*) from tenant_logistics_label_templates template"
                        + where,
                parameters,
                Long.class);
        return new PageImpl<>(items, pageable, total == null ? 0 : total);
    }

    LabelTemplateRecord find(UUID tenantId, UUID id) {
        return jdbc.query(
                SELECT + " where template.tenant_id = :tenantId and template.id = :id",
                Map.of("tenantId", tenantId, "id", id),
                LabelTemplateRepository::map).stream().findFirst().orElse(null);
    }

    void insert(
            UUID id,
            UUID tenantId,
            LabelTemplateService.TemplateInput value,
            LabelTemplateService.Actor actor) {
        jdbc.update("""
                insert into tenant_logistics_label_templates (
                    id, tenant_id, name, document_category, width_mm, height_mm,
                    template_content, note, created_by_display_name,
                    created_by_user_id, created_by_system_admin_id,
                    updated_by_user_id, updated_by_system_admin_id, request_id
                ) values (
                    :id, :tenantId, :name, :documentCategory, :widthMm, :heightMm,
                    :content, :note, :displayName, :userId, :systemAdminId,
                    :userId, :systemAdminId, :requestId
                )
                """, actorParameters(id, tenantId, actor)
                .addValue("name", value.name())
                .addValue("documentCategory", value.documentCategory())
                .addValue("widthMm", value.widthMm())
                .addValue("heightMm", value.heightMm())
                .addValue("content", value.content())
                .addValue("note", value.note()));
    }

    boolean archive(
            UUID tenantId,
            UUID id,
            long version,
            LabelTemplateService.Actor actor) {
        return jdbc.update("""
                update tenant_logistics_label_templates
                   set lifecycle_status = 'ARCHIVED', version = version + 1,
                       updated_by_user_id = :userId,
                       updated_by_system_admin_id = :systemAdminId,
                       request_id = :requestId, updated_at = now()
                 where tenant_id = :tenantId and id = :id
                   and version = :version and lifecycle_status = 'ACTIVE'
                """, actorParameters(id, tenantId, actor)
                .addValue("version", version)) == 1;
    }

    private static MapSqlParameterSource actorParameters(
            UUID id,
            UUID tenantId,
            LabelTemplateService.Actor actor) {
        return new MapSqlParameterSource()
                .addValue("id", id)
                .addValue("tenantId", tenantId)
                .addValue("displayName", actor.displayName())
                .addValue("userId", actor.userId())
                .addValue("systemAdminId", actor.systemAdminId())
                .addValue("requestId", actor.requestId());
    }

    private static String pattern(String value) {
        if (value == null) return null;
        return "%" + value.replace("\\", "\\\\")
                .replace("%", "\\%").replace("_", "\\_") + "%";
    }

    private static LabelTemplateRecord map(ResultSet rs, int row)
            throws SQLException {
        return new LabelTemplateRecord(
                rs.getObject("id", UUID.class),
                "CUSTOM",
                rs.getString("name"),
                rs.getString("document_category"),
                rs.getInt("width_mm"),
                rs.getInt("height_mm"),
                rs.getString("template_content"),
                rs.getString("note"),
                rs.getString("lifecycle_status"),
                rs.getString("created_by_display_name"),
                rs.getLong("version"),
                rs.getObject("created_at", OffsetDateTime.class).toInstant(),
                rs.getObject("updated_at", OffsetDateTime.class).toInstant());
    }
}
