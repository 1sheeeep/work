package cn.xzkj.erp.order.api;

import java.util.LinkedHashMap;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import cn.xzkj.erp.platform.service.ShopifyAuthorizationConflictException;
import cn.xzkj.erp.settings.general.OrderPullBlackoutException;
import jakarta.validation.ConstraintViolationException;

@RestControllerAdvice(assignableTypes = {
        OrderCenterController.class,
        OrderOperationsController.class,
        OrderSkuSalesController.class
})
public class OrderApiExceptionHandler {
    private static final Logger LOGGER = LoggerFactory.getLogger(OrderApiExceptionHandler.class);
    @ExceptionHandler(ResourceNotFoundException.class)
    ResponseEntity<ApiError> notFound(ResourceNotFoundException exception) {
        return error(HttpStatus.NOT_FOUND, "resource_not_found", "Requested resource was not found", Map.of());
    }

    @ExceptionHandler({ConflictException.class, IllegalStateException.class,
            ObjectOptimisticLockingFailureException.class, DataIntegrityViolationException.class})
    ResponseEntity<ApiError> conflict(RuntimeException exception) {
        return error(HttpStatus.CONFLICT, "resource_conflict",
                "The request conflicts with the current resource state", Map.of());
    }

    @ExceptionHandler(OrderPullBlackoutException.class)
    ResponseEntity<ApiError> orderPullBlackout(
            OrderPullBlackoutException exception) {
        return error(HttpStatus.CONFLICT, "order_pull_blackout",
                "Shopify order pulling is disabled during the configured quiet period",
                Map.of(
                        "reason", "order_pull_blackout",
                        "resumesAt", exception.resumesAt().toString(),
                        "timeZone", "Asia/Shanghai"));
    }

    @ExceptionHandler(ShopifyAuthorizationConflictException.class)
    ResponseEntity<ApiError> shopifyAuthorizationConflict(
            ShopifyAuthorizationConflictException exception) {
        return error(HttpStatus.CONFLICT, "shopify_authorization_conflict",
                "Shopify authorization must be connected and include the required scope",
                exception.details());
    }

    @ExceptionHandler({IllegalArgumentException.class, MethodArgumentTypeMismatchException.class})
    ResponseEntity<ApiError> invalid(RuntimeException exception) {
        return error(HttpStatus.BAD_REQUEST, "invalid_request", "The request is invalid", Map.of());
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<ApiError> malformed(HttpMessageNotReadableException exception) {
        return error(HttpStatus.BAD_REQUEST, "invalid_request", "Request body is invalid", Map.of());
    }

    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    ResponseEntity<ApiError> unsupportedMediaType(HttpMediaTypeNotSupportedException exception) {
        return error(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "invalid_request",
                "Content type is not supported", Map.of());
    }

    @ExceptionHandler(MissingServletRequestParameterException.class)
    ResponseEntity<ApiError> missingParameter(
            MissingServletRequestParameterException exception) {
        return error(HttpStatus.BAD_REQUEST, "validation_failed",
                "Request validation failed", Map.of());
    }

    @ExceptionHandler({HandlerMethodValidationException.class, ConstraintViolationException.class})
    ResponseEntity<ApiError> methodValidation(RuntimeException exception) {
        return error(HttpStatus.BAD_REQUEST, "validation_failed", "Request validation failed", Map.of());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<ApiError> validation(MethodArgumentNotValidException exception) {
        Map<String, String> details = new LinkedHashMap<>();
        exception.getBindingResult().getFieldErrors()
                .forEach(error -> details.putIfAbsent(error.getField(), "invalid"));
        return error(HttpStatus.BAD_REQUEST, "validation_failed", "Request validation failed", details);
    }

    @ExceptionHandler(AccessDeniedException.class)
    ResponseEntity<ApiError> accessDenied(AccessDeniedException exception) {
        return error(HttpStatus.FORBIDDEN, "permission_denied", "Permission is required", Map.of());
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ApiError> unexpected(Exception exception) {
        LOGGER.error("Unexpected order API error");
        return error(HttpStatus.INTERNAL_SERVER_ERROR, "internal_error",
                "An internal error occurred", Map.of());
    }

    private static ResponseEntity<ApiError> error(HttpStatus status, String code, String message,
            Map<String, String> details) {
        return ResponseEntity.status(status).contentType(MediaType.APPLICATION_JSON)
                .body(new ApiError(code, message, details));
    }

    record ApiError(String code, String message, Map<String, String> details) { }
}
