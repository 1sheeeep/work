package cn.xzkj.erp.customer.service;

import jakarta.validation.ConstraintViolationException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice(assignableTypes = {CustomerServiceEntryController.class, NativeCustomerServiceEntryController.class})
public class CustomerServiceEntryExceptionHandler {

    @ExceptionHandler(CustomerServiceEntryUnavailableException.class)
    ResponseEntity<EntryError> unavailable() {
        return error(HttpStatus.SERVICE_UNAVAILABLE,
                "customer_service_entry_unavailable",
                "Customer service entry is unavailable", true);
    }

    @ExceptionHandler(CustomerServiceEntryInvalidTargetException.class)
    ResponseEntity<EntryError> invalidTarget() {
        return error(HttpStatus.CONFLICT,
                "customer_service_entry_target_mismatch",
                "Customer service entry target is not configured", false);
    }

    @ExceptionHandler(CustomerServiceEntryInvalidGrantException.class)
    ResponseEntity<EntryError> invalidGrant() {
        return error(HttpStatus.FORBIDDEN,
                "customer_service_entry_invalid",
                "Customer service entry grant is invalid", false);
    }

    @ExceptionHandler({
            MethodArgumentNotValidException.class,
            ConstraintViolationException.class,
            HttpMessageNotReadableException.class
    })
    ResponseEntity<EntryError> invalidRequest() {
        return error(HttpStatus.BAD_REQUEST,
                "customer_service_entry_invalid_request",
                "Customer service entry request is invalid", false);
    }

    @ExceptionHandler(AccessDeniedException.class)
    ResponseEntity<EntryError> permissionDenied() {
        return error(HttpStatus.FORBIDDEN,
                "permission_denied",
                "Permission is required", false);
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<EntryError> internalError() {
        return error(HttpStatus.INTERNAL_SERVER_ERROR,
                "internal_error",
                "The request could not be completed", true);
    }

    private static ResponseEntity<EntryError> error(
            HttpStatus status,
            String code,
            String message,
            boolean retryable) {
        return ResponseEntity.status(status)
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .body(new EntryError(code, message, retryable));
    }

    record EntryError(String code, String message, boolean retryable) {
    }
}
