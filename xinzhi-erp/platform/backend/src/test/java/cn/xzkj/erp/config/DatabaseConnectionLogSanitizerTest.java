package cn.xzkj.erp.config;

import static org.assertj.core.api.Assertions.assertThat;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.LoggerContext;
import ch.qos.logback.core.spi.FilterReply;
import java.sql.SQLException;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

class DatabaseConnectionLogSanitizerTest {

    private final DatabaseConnectionLogSanitizer sanitizer =
            new DatabaseConnectionLogSanitizer();
    private final LoggerContext context =
            (LoggerContext) LoggerFactory.getILoggerFactory();

    @Test
    void deniesOnlyTargetedConnectionUnavailableEvents() {
        assertThat(decide(
                "org.springframework.boot.jdbc.health.DataSourceHealthIndicator",
                "DataSource health check failed",
                null,
                new SQLException("host-canary", "08001")))
                .isEqualTo(FilterReply.DENY);
        assertThat(decide(
                "org.hibernate.orm.jdbc.error",
                "Unable to acquire JDBC Connection [host-canary]",
                null,
                null))
                .isEqualTo(FilterReply.DENY);
        assertThat(decide(
                "com.zaxxer.hikari.pool.ProxyConnection",
                "Pool - connection marked broken because of SQLSTATE(08003)",
                new Object[] {
                    new SQLException("closed-canary", "08003")
                },
                null))
                .isEqualTo(FilterReply.DENY);
        assertThat(decide(
                "com.zaxxer.hikari.pool.PoolBase",
                "Pool - Failed to validate connection host-canary",
                null,
                null))
                .isEqualTo(FilterReply.DENY);
    }

    @Test
    void leavesUnrelatedDatabaseAndApplicationFailuresVisible() {
        assertThat(decide(
                "org.springframework.boot.jdbc.health.DataSourceHealthIndicator",
                "DataSource health check failed",
                null,
                new SQLException("constraint", "23505")))
                .isEqualTo(FilterReply.NEUTRAL);
        assertThat(decide(
                "org.hibernate.orm.jdbc.error",
                "constraint violation",
                null,
                new SQLException("constraint", "23505")))
                .isEqualTo(FilterReply.NEUTRAL);
        assertThat(decide(
                "cn.xzkj.erp.application",
                "Unable to acquire JDBC Connection",
                null,
                new IllegalStateException("business")))
                .isEqualTo(FilterReply.NEUTRAL);
    }

    private FilterReply decide(
            String loggerName,
            String format,
            Object[] parameters,
            Throwable throwable) {
        return sanitizer.decide(
                null,
                context.getLogger(loggerName),
                Level.ERROR,
                format,
                parameters,
                throwable);
    }
}
