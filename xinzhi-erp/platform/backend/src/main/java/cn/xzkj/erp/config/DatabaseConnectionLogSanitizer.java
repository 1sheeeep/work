package cn.xzkj.erp.config;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.LoggerContext;
import ch.qos.logback.classic.turbo.TurboFilter;
import ch.qos.logback.core.spi.FilterReply;
import java.sql.SQLException;
import java.sql.SQLNonTransientConnectionException;
import java.sql.SQLRecoverableException;
import java.sql.SQLTransientConnectionException;
import org.hibernate.exception.JDBCConnectionException;
import org.slf4j.LoggerFactory;
import org.slf4j.Marker;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.CannotGetJdbcConnectionException;
import org.springframework.stereotype.Component;

/**
 * Prevents connection-unavailability details from reaching production logs
 * while leaving unrelated JDBC and application failures untouched.
 */
@Component
@Profile("production")
final class DatabaseConnectionLogSanitizer extends TurboFilter
        implements InitializingBean, DisposableBean {

    private static final String DATASOURCE_HEALTH_LOGGER =
            "org.springframework.boot.jdbc.health.DataSourceHealthIndicator";
    private static final String HIBERNATE_JDBC_ERROR_LOGGER =
            "org.hibernate.orm.jdbc.error";
    private static final String HIKARI_POOL_BASE_LOGGER =
            "com.zaxxer.hikari.pool.PoolBase";
    private static final String HIKARI_PROXY_CONNECTION_LOGGER =
            "com.zaxxer.hikari.pool.ProxyConnection";

    private final LoggerContext loggerContext;

    DatabaseConnectionLogSanitizer() {
        if (!(LoggerFactory.getILoggerFactory()
                instanceof LoggerContext context)) {
            throw new IllegalStateException(
                    "Production connection log sanitization requires Logback");
        }
        this.loggerContext = context;
    }

    @Override
    public void afterPropertiesSet() {
        start();
        loggerContext.addTurboFilter(this);
    }

    @Override
    public void destroy() {
        loggerContext.getTurboFilterList().remove(this);
        stop();
    }

    @Override
    public FilterReply decide(
            Marker marker,
            Logger logger,
            Level level,
            String format,
            Object[] parameters,
            Throwable throwable) {
        String loggerName = logger.getName();
        if (DATASOURCE_HEALTH_LOGGER.equals(loggerName)
                && isConnectionFailure(throwable)) {
            return FilterReply.DENY;
        }
        if (HIBERNATE_JDBC_ERROR_LOGGER.equals(loggerName)
                && (isConnectionFailure(throwable)
                        || containsConnectionFailure(format)
                        || containsConnectionFailure(parameters))) {
            return FilterReply.DENY;
        }
        if (HIKARI_POOL_BASE_LOGGER.equals(loggerName)
                && format != null
                && format.contains("Failed to validate connection")) {
            return FilterReply.DENY;
        }
        if (HIKARI_PROXY_CONNECTION_LOGGER.equals(loggerName)
                && (isConnectionFailure(throwable)
                        || containsConnectionFailure(format)
                        || containsConnectionFailure(parameters))) {
            return FilterReply.DENY;
        }
        return FilterReply.NEUTRAL;
    }

    private static boolean isConnectionFailure(Throwable failure) {
        for (Throwable cause = failure;
                cause != null;
                cause = cause.getCause()) {
            if (cause instanceof CannotGetJdbcConnectionException
                    || cause instanceof JDBCConnectionException
                    || cause instanceof SQLTransientConnectionException
                    || cause instanceof SQLNonTransientConnectionException
                    || cause instanceof SQLRecoverableException
                    || cause instanceof SQLException sqlException
                            && sqlException.getSQLState() != null
                            && sqlException.getSQLState().startsWith("08")) {
                return true;
            }
        }
        return false;
    }

    private static boolean containsConnectionFailure(Object[] parameters) {
        if (parameters == null) {
            return false;
        }
        for (Object parameter : parameters) {
            if (parameter instanceof Throwable throwable
                    && isConnectionFailure(throwable)) {
                return true;
            }
            if (parameter instanceof CharSequence text
                    && containsConnectionFailure(text.toString())) {
                return true;
            }
        }
        return false;
    }

    private static boolean containsConnectionFailure(String message) {
        return message != null
                && (message.contains("Connection is not available")
                        || message.contains("Unable to acquire JDBC Connection")
                        || message.matches(".*SQLState:\\s*08[0-9A-Z]{3}.*")
                        || message.matches(".*SQLSTATE\\(08[0-9A-Z]{3}\\).*"));
    }
}
