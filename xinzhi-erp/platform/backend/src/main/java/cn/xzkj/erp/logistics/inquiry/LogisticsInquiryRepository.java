package cn.xzkj.erp.logistics.inquiry;

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
class LogisticsInquiryRepository {
    private static final String SELECT = """
            select inquiry.id, inquiry.inquiry_no, inquiry.origin,
                   inquiry.destination, inquiry.weekly_order_count,
                   inquiry.weekly_weight_kg, inquiry.category,
                   inquiry.contact_name, inquiry.contact_phone, inquiry.status,
                   inquiry.note, inquiry.published_at,
                   inquiry.created_by_display_name, inquiry.version,
                   inquiry.created_at, inquiry.updated_at,
                   (select count(*) from tenant_logistics_inquiry_quotes quote
                     where quote.tenant_id = inquiry.tenant_id
                       and quote.inquiry_id = inquiry.id
                       and quote.status = 'ACTIVE') as active_quote_count
              from tenant_logistics_inquiries inquiry
            """;
    private final NamedParameterJdbcTemplate jdbc;

    LogisticsInquiryRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    Page<LogisticsInquiryRecord> list(UUID tenantId,
            LogisticsInquiryService.NormalizedFilters filters, Pageable pageable) {
        StringBuilder where = new StringBuilder(
                " where inquiry.tenant_id = :tenantId");
        if (filters.market()) {
            where.append(" and inquiry.status = 'BIDDING'");
        } else if (filters.status() != null) {
            where.append(" and inquiry.status = :status");
        }
        addLike(where, filters.country(), "inquiry.destination", "country");
        if (filters.publishedFrom() != null) {
            where.append(" and inquiry.published_at >= :publishedFrom");
        }
        if (filters.publishedTo() != null) {
            where.append(" and inquiry.published_at < :publishedTo");
        }
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("status", filters.status())
                .addValue("country", pattern(filters.country()))
                .addValue("publishedFrom", filters.publishedFrom())
                .addValue("publishedTo", filters.publishedTo())
                .addValue("limit", pageable.getPageSize())
                .addValue("offset", pageable.getOffset());
        List<LogisticsInquiryRecord> items = jdbc.query(
                SELECT + where
                        + " order by inquiry.published_at desc, inquiry.id desc"
                        + " limit :limit offset :offset",
                parameters, LogisticsInquiryRepository::mapInquiry);
        Long total = jdbc.queryForObject(
                "select count(*) from tenant_logistics_inquiries inquiry" + where,
                parameters, Long.class);
        return new PageImpl<>(items, pageable, total == null ? 0 : total);
    }

    LogisticsInquiryRecord find(UUID tenantId, UUID id) {
        return jdbc.query(SELECT
                        + " where inquiry.tenant_id = :tenantId and inquiry.id = :id",
                Map.of("tenantId", tenantId, "id", id),
                LogisticsInquiryRepository::mapInquiry)
                .stream().findFirst().orElse(null);
    }

    List<LogisticsInquiryQuoteRecord> quotes(UUID tenantId, UUID inquiryId) {
        return jdbc.query("""
                select quote.id, quote.inquiry_id, quote.provider_name,
                       quote.service_name, quote.price_per_kg, quote.currency,
                       quote.transit_days, quote.note, quote.status,
                       quote.created_by_display_name, quote.version,
                       quote.created_at, quote.updated_at
                  from tenant_logistics_inquiry_quotes quote
                 where quote.tenant_id = :tenantId
                   and quote.inquiry_id = :inquiryId
                 order by case when quote.status = 'ACTIVE' then 0 else 1 end,
                          quote.price_per_kg, quote.created_at, quote.id
                """, Map.of("tenantId", tenantId, "inquiryId", inquiryId),
                LogisticsInquiryRepository::mapQuote);
    }

    LogisticsInquiryContactRecord contact(UUID tenantId) {
        return jdbc.query("""
                select contact_name, contact_phone, version, updated_at
                  from tenant_logistics_inquiry_contacts
                 where tenant_id = :tenantId
                """, Map.of("tenantId", tenantId),
                (rs, row) -> new LogisticsInquiryContactRecord(
                        rs.getString("contact_name"), rs.getString("contact_phone"),
                        rs.getLong("version"), instant(rs, "updated_at")))
                .stream().findFirst().orElse(null);
    }

    boolean saveContact(UUID tenantId, LogisticsInquiryService.ContactInput input,
            Long version, LogisticsInquiryService.Actor actor) {
        MapSqlParameterSource parameters = actorParameters(null, tenantId, actor)
                .addValue("contactName", input.contactName())
                .addValue("contactPhone", input.contactPhone())
                .addValue("version", version);
        if (version == null) {
            return jdbc.update("""
                    insert into tenant_logistics_inquiry_contacts (
                        tenant_id, contact_name, contact_phone,
                        updated_by_user_id, updated_by_system_admin_id, request_id
                    ) values (
                        :tenantId, :contactName, :contactPhone,
                        :userId, :systemAdminId, :requestId
                    ) on conflict (tenant_id) do nothing
                    """, parameters) == 1;
        }
        return jdbc.update("""
                update tenant_logistics_inquiry_contacts
                   set contact_name = :contactName, contact_phone = :contactPhone,
                       updated_by_user_id = :userId,
                       updated_by_system_admin_id = :systemAdminId,
                       request_id = :requestId, version = version + 1,
                       updated_at = now()
                 where tenant_id = :tenantId and version = :version
                """, parameters) == 1;
    }

    void insertInquiry(UUID id, UUID tenantId, String inquiryNo,
            LogisticsInquiryService.InquiryInput input,
            LogisticsInquiryService.Actor actor) {
        jdbc.update("""
                insert into tenant_logistics_inquiries (
                    id, tenant_id, inquiry_no, origin, destination,
                    weekly_order_count, weekly_weight_kg, category,
                    contact_name, contact_phone, note,
                    created_by_display_name, created_by_user_id,
                    created_by_system_admin_id, updated_by_user_id,
                    updated_by_system_admin_id, request_id
                ) values (
                    :id, :tenantId, :inquiryNo, :origin, :destination,
                    :weeklyOrderCount, :weeklyWeightKg, :category,
                    :contactName, :contactPhone, :note,
                    :displayName, :userId, :systemAdminId, :userId,
                    :systemAdminId, :requestId
                )
                """, inquiryParameters(id, tenantId, input, actor)
                .addValue("inquiryNo", inquiryNo));
    }

    boolean updateInquiry(UUID tenantId, UUID id, long version,
            LogisticsInquiryService.InquiryInput input,
            LogisticsInquiryService.Actor actor) {
        return jdbc.update("""
                update tenant_logistics_inquiries
                   set origin = :origin, destination = :destination,
                       weekly_order_count = :weeklyOrderCount,
                       weekly_weight_kg = :weeklyWeightKg, category = :category,
                       contact_name = :contactName, contact_phone = :contactPhone,
                       note = :note, updated_by_user_id = :userId,
                       updated_by_system_admin_id = :systemAdminId,
                       request_id = :requestId, version = version + 1,
                       updated_at = now()
                 where tenant_id = :tenantId and id = :id and version = :version
                   and status in ('BIDDING', 'PAUSED')
                """, inquiryParameters(id, tenantId, input, actor)
                .addValue("version", version)) == 1;
    }

    boolean transition(UUID tenantId, UUID id, long version,
            String fromStatus, String targetStatus,
            LogisticsInquiryService.Actor actor) {
        return jdbc.update("""
                update tenant_logistics_inquiries
                   set status = :targetStatus, updated_by_user_id = :userId,
                       updated_by_system_admin_id = :systemAdminId,
                       request_id = :requestId, version = version + 1,
                       updated_at = now()
                 where tenant_id = :tenantId and id = :id and version = :version
                   and status = :fromStatus
                """, actorParameters(id, tenantId, actor)
                .addValue("version", version)
                .addValue("fromStatus", fromStatus)
                .addValue("targetStatus", targetStatus)) == 1;
    }

    boolean insertQuote(UUID id, UUID tenantId, UUID inquiryId,
            LogisticsInquiryService.QuoteInput input,
            LogisticsInquiryService.Actor actor) {
        return jdbc.update("""
                insert into tenant_logistics_inquiry_quotes (
                    id, tenant_id, inquiry_id, provider_name, service_name,
                    price_per_kg, currency, transit_days, note,
                    created_by_display_name, created_by_user_id,
                    created_by_system_admin_id, updated_by_user_id,
                    updated_by_system_admin_id, request_id
                )
                select :id, :tenantId, inquiry.id, :providerName, :serviceName,
                       :pricePerKg, :currency, :transitDays, :note,
                       :displayName, :userId, :systemAdminId, :userId,
                       :systemAdminId, :requestId
                  from tenant_logistics_inquiries inquiry
                 where inquiry.tenant_id = :tenantId and inquiry.id = :inquiryId
                   and inquiry.status = 'BIDDING'
                """, actorParameters(id, tenantId, actor)
                .addValue("inquiryId", inquiryId)
                .addValue("providerName", input.providerName())
                .addValue("serviceName", input.serviceName())
                .addValue("pricePerKg", input.pricePerKg())
                .addValue("currency", input.currency())
                .addValue("transitDays", input.transitDays())
                .addValue("note", input.note())) == 1;
    }

    boolean withdrawQuote(UUID tenantId, UUID inquiryId, UUID quoteId,
            long version, LogisticsInquiryService.Actor actor) {
        return jdbc.update("""
                update tenant_logistics_inquiry_quotes quote
                   set status = 'WITHDRAWN', updated_by_user_id = :userId,
                       updated_by_system_admin_id = :systemAdminId,
                       request_id = :requestId, version = version + 1,
                       updated_at = now()
                 where quote.tenant_id = :tenantId
                   and quote.inquiry_id = :inquiryId and quote.id = :id
                   and quote.version = :version and quote.status = 'ACTIVE'
                   and exists (
                       select 1 from tenant_logistics_inquiries inquiry
                        where inquiry.tenant_id = quote.tenant_id
                          and inquiry.id = quote.inquiry_id
                          and inquiry.status in ('BIDDING', 'PAUSED'))
                """, actorParameters(quoteId, tenantId, actor)
                .addValue("inquiryId", inquiryId)
                .addValue("version", version)) == 1;
    }

    private static MapSqlParameterSource inquiryParameters(UUID id, UUID tenantId,
            LogisticsInquiryService.InquiryInput input,
            LogisticsInquiryService.Actor actor) {
        return actorParameters(id, tenantId, actor)
                .addValue("origin", input.origin())
                .addValue("destination", input.destination())
                .addValue("weeklyOrderCount", input.weeklyOrderCount())
                .addValue("weeklyWeightKg", input.weeklyWeightKg())
                .addValue("category", input.category())
                .addValue("contactName", input.contactName())
                .addValue("contactPhone", input.contactPhone())
                .addValue("note", input.note());
    }

    private static MapSqlParameterSource actorParameters(UUID id, UUID tenantId,
            LogisticsInquiryService.Actor actor) {
        return new MapSqlParameterSource()
                .addValue("id", id).addValue("tenantId", tenantId)
                .addValue("displayName", actor.displayName())
                .addValue("userId", actor.userId())
                .addValue("systemAdminId", actor.systemAdminId())
                .addValue("requestId", actor.requestId());
    }

    private static void addLike(StringBuilder where, String value,
            String column, String parameter) {
        if (value != null) {
            where.append(" and lower(").append(column)
                    .append(") like :").append(parameter).append(" escape '\\'");
        }
    }

    private static String pattern(String value) {
        if (value == null) return null;
        return "%" + value.replace("\\", "\\\\")
                .replace("%", "\\%").replace("_", "\\_") + "%";
    }

    private static LogisticsInquiryRecord mapInquiry(ResultSet rs, int row)
            throws SQLException {
        return new LogisticsInquiryRecord(
                rs.getObject("id", UUID.class), rs.getString("inquiry_no"),
                rs.getString("origin"), rs.getString("destination"),
                rs.getInt("weekly_order_count"), rs.getBigDecimal("weekly_weight_kg"),
                rs.getString("category"), rs.getString("contact_name"),
                rs.getString("contact_phone"), rs.getString("status"),
                rs.getString("note"), rs.getLong("active_quote_count"),
                instant(rs, "published_at"), rs.getString("created_by_display_name"),
                rs.getLong("version"), instant(rs, "created_at"),
                instant(rs, "updated_at"));
    }

    private static LogisticsInquiryQuoteRecord mapQuote(ResultSet rs, int row)
            throws SQLException {
        return new LogisticsInquiryQuoteRecord(
                rs.getObject("id", UUID.class), rs.getObject("inquiry_id", UUID.class),
                rs.getString("provider_name"), rs.getString("service_name"),
                rs.getBigDecimal("price_per_kg"), rs.getString("currency"),
                rs.getInt("transit_days"), rs.getString("note"),
                rs.getString("status"), rs.getString("created_by_display_name"),
                rs.getLong("version"), instant(rs, "created_at"),
                instant(rs, "updated_at"));
    }

    private static java.time.Instant instant(ResultSet rs, String column)
            throws SQLException {
        return rs.getObject(column, OffsetDateTime.class).toInstant();
    }
}
