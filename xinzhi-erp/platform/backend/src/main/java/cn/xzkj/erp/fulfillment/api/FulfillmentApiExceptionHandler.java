package cn.xzkj.erp.fulfillment.api;

import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import cn.xzkj.erp.fulfillment.service.FulfillmentExceptions.Conflict;
import cn.xzkj.erp.fulfillment.service.FulfillmentExceptions.Invalid;
import cn.xzkj.erp.fulfillment.service.FulfillmentExceptions.NotFound;

@RestControllerAdvice(assignableTypes = FulfillmentController.class)
public class FulfillmentApiExceptionHandler {

    @ExceptionHandler(NotFound.class)
    ResponseEntity<ErrorEnvelope> notFound() {
        return error(HttpStatus.NOT_FOUND, "resource_not_found",
                "The requested resource was not found", Map.of());
    }

    @ExceptionHandler(Conflict.class)
    ResponseEntity<ErrorEnvelope> conflict(Conflict exception) {
        return error(HttpStatus.CONFLICT, "resource_conflict",
                "The request conflicts with the current resource state",
                Map.of("reason", exception.reason()));
    }

    @ExceptionHandler({Invalid.class, MethodArgumentNotValidException.class})
    ResponseEntity<ErrorEnvelope> invalid() {
        return error(HttpStatus.BAD_REQUEST, "validation_failed",
                "The request contains invalid fields", Map.of());
    }

    @ExceptionHandler(AccessDeniedException.class)
    ResponseEntity<ErrorEnvelope> accessDenied() {
        return error(HttpStatus.FORBIDDEN, "permission_denied",
                "Permission is required", Map.of());
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ErrorEnvelope> unexpected() {
        return error(HttpStatus.INTERNAL_SERVER_ERROR, "internal_error",
                "The request could not be completed", Map.of());
    }

    private static ResponseEntity<ErrorEnvelope> error(
            HttpStatus status, String code, String message, Map<String, String> details) {
        return ResponseEntity.status(status).body(new ErrorEnvelope(code, message, details));
    }

    record ErrorEnvelope(String code, String message, Map<String, String> details) {
    }
}
