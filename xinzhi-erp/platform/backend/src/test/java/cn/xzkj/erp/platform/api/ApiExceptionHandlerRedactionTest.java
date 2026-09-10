package cn.xzkj.erp.platform.api;

import static org.assertj.core.api.Assertions.assertThat;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.classic.spi.ThrowableProxyUtil;
import ch.qos.logback.core.read.ListAppender;
import cn.xzkj.erp.iam.web.IamExceptionHandler;
import cn.xzkj.erp.iam.web.PasswordCredentialExchangeExceptionHandler;
import cn.xzkj.erp.order.api.OrderApiExceptionHandler;
import cn.xzkj.erp.platformadmin.web.PlatformAdminExceptionHandler;
import cn.xzkj.erp.platform.service.ShopifyAuthorizationConflictException;
import cn.xzkj.erp.settings.transfer.SettingsTransferTaskController;
import jakarta.persistence.OptimisticLockException;
import java.lang.reflect.Method;
import java.util.Map;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestControllerAdvice;

class ApiExceptionHandlerRedactionTest {

    private static final String CANARY =
            "password=gate-password token=gate-token "
                    + "credentialRef=gate-credential "
                    + "jdbc:postgresql://internal-db/erp "
                    + "constraint=uk_internal file=C:\\private\\secret";

    @Test
    void transferTaskControllerUsesTheGlobalSafeApiErrorContract() {
        RestControllerAdvice advice = ApiExceptionHandler.class
                .getAnnotation(RestControllerAdvice.class);

        assertThat(advice).isNotNull();
        assertThat(advice.basePackageClasses())
                .contains(SettingsTransferTaskController.class);
    }

    @Test
    void jpaOptimisticLockMapsToSafeConflictWithoutLoggingCause() {
        ApiExceptionHandler handler = new ApiExceptionHandler();
        Logger logger = (Logger) LoggerFactory.getLogger(
                ApiExceptionHandler.class);
        Level previousLevel = logger.getLevel();
        boolean previousAdditive = logger.isAdditive();
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        logger.setLevel(Level.INFO);
        logger.setAdditive(false);

        try {
            ResponseEntity<ApiExceptionHandler.ApiError> response =
                    handler.handleConflict(new OptimisticLockException(
                            CANARY,
                            new IllegalStateException(CANARY)));

            assertThat(response.getStatusCode())
                    .isEqualTo(HttpStatus.CONFLICT);
            assertThat(response.getHeaders().getContentType())
                    .isEqualTo(MediaType.APPLICATION_JSON);
            assertThat(response.getBody()).isNotNull();
            assertThat(response.getBody().code())
                    .isEqualTo("resource_conflict");
            assertThat(response.getBody().message())
                    .isEqualTo(
                            "The request conflicts with the current resource state");
            assertThat(response.getBody().details()).isEmpty();
            assertThat(response.getBody().toString())
                    .doesNotContain(CANARY);
            assertThat(appender.list).isEmpty();
        } finally {
            logger.detachAppender(appender);
            appender.stop();
            logger.setLevel(previousLevel);
            logger.setAdditive(previousAdditive);
        }
    }

    @Test
    void shopifyAuthorizationConflictReturnsOnlyMachineReadableScopeDetails() {
        ApiExceptionHandler handler = new ApiExceptionHandler();

        ResponseEntity<ApiExceptionHandler.ApiError> response =
                handler.handleShopifyAuthorizationConflict(
                        ShopifyAuthorizationConflictException.missingScope(
                                "read_products"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().code())
                .isEqualTo("shopify_authorization_conflict");
        assertThat(response.getBody().message())
                .isEqualTo(
                        "Shopify authorization must be connected and include the required scope");
        assertThat(response.getBody().details())
                .isEqualTo(Map.of(
                        "reason", "shopify_scope_missing",
                        "scope", "read_products"));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("handlerCases")
    void unknownFailureStaysSafeInResponseAndCapturedLogs(
            String label,
            Object handler,
            String methodName,
            String fixedLogMessage) throws Exception {
        Logger logger = (Logger) LoggerFactory.getLogger(handler.getClass());
        Level previousLevel = logger.getLevel();
        boolean previousAdditive = logger.isAdditive();
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        logger.setLevel(Level.INFO);
        logger.setAdditive(false);

        try {
            Method method = handler.getClass().getDeclaredMethod(
                    methodName,
                    Exception.class);
            method.setAccessible(true);
            Object result = method.invoke(
                    handler,
                    new IllegalStateException(CANARY));

            Object body;
            if (result instanceof ResponseEntity<?> response) {
                assertThat(response.getStatusCode().value()).isEqualTo(500);
                body = response.getBody();
            } else {
                ResponseStatus status = method.getAnnotation(
                        ResponseStatus.class);
                assertThat(status).isNotNull();
                assertThat(status.value().value()).isEqualTo(500);
                body = result;
            }
            assertThat(recordValue(body, "code"))
                    .isEqualTo("internal_error");
            assertThat(recordValue(body, "message"))
                    .isEqualTo("An internal error occurred");
            if (hasRecordComponent(body, "details")) {
                assertThat(recordValue(body, "details"))
                        .isEqualTo(Map.of());
            }
            assertThat(body.toString()).doesNotContain(CANARY);

            assertThat(appender.list).hasSize(1);
            ILoggingEvent event = appender.list.getFirst();
            assertThat(event.getLevel()).isEqualTo(Level.ERROR);
            assertThat(event.getFormattedMessage())
                    .isEqualTo(fixedLogMessage);
            assertThat(event.getThrowableProxy()).isNull();
            assertThat(capturedOutput(appender))
                    .doesNotContain(
                            CANARY,
                            "IllegalStateException",
                            "gate-password",
                            "gate-token",
                            "gate-credential",
                            "jdbc:postgresql:",
                            "uk_internal",
                            "C:\\private\\secret");
        } finally {
            logger.detachAppender(appender);
            appender.stop();
            logger.setLevel(previousLevel);
            logger.setAdditive(previousAdditive);
        }
    }

    private static Stream<Arguments> handlerCases() {
        return Stream.of(
                Arguments.of(
                        "business",
                        new ApiExceptionHandler(),
                        "handleUnexpected",
                        "Unexpected business API error"),
                Arguments.of(
                        "order",
                        new OrderApiExceptionHandler(),
                        "unexpected",
                        "Unexpected order API error"),
                Arguments.of(
                        "IAM administration",
                        new IamExceptionHandler(),
                        "internalError",
                        "Unexpected IAM administration error"),
                Arguments.of(
                        "password credential exchange",
                        new PasswordCredentialExchangeExceptionHandler(),
                        "internalError",
                        "Unexpected password credential exchange error"),
                Arguments.of(
                        "platform administrator",
                        new PlatformAdminExceptionHandler(),
                        "internalError",
                        "Unexpected platform administrator error"));
    }

    private static Object recordValue(Object record, String component)
            throws Exception {
        Method accessor = record.getClass().getDeclaredMethod(component);
        accessor.setAccessible(true);
        return accessor.invoke(record);
    }

    private static boolean hasRecordComponent(
            Object record,
            String component) {
        return Stream.of(record.getClass().getRecordComponents())
                .anyMatch(candidate -> candidate.getName().equals(component));
    }

    private static String capturedOutput(
            ListAppender<ILoggingEvent> appender) {
        return appender.list.stream()
                .map(event -> event.getFormattedMessage()
                        + System.lineSeparator()
                        + ThrowableProxyUtil.asString(
                                event.getThrowableProxy()))
                .collect(Collectors.joining(System.lineSeparator()));
    }
}
