package ai.xzkj.recruitment.common;

import jakarta.validation.ConstraintViolationException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.resource.NoResourceFoundException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

@RestControllerAdvice
public class GlobalExceptionHandler {
    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(ApiException.class)
    ResponseEntity<ApiError> handleApiException(ApiException exception) {
        return response(exception.getStatus(), exception.getCode(), exception.getMessage(), null);
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<ApiError> handleValidation(MethodArgumentNotValidException exception) {
        Map<String, String> errors = new LinkedHashMap<>();
        exception.getBindingResult().getFieldErrors()
                .forEach(error -> errors.putIfAbsent(error.getField(), error.getDefaultMessage()));
        return response(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "请检查填写内容", errors);
    }

    @ExceptionHandler(ConstraintViolationException.class)
    ResponseEntity<ApiError> handleConstraintViolation(ConstraintViolationException exception) {
        return response(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", exception.getMessage(), null);
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    ResponseEntity<ApiError> handleTypeMismatch(MethodArgumentTypeMismatchException exception) {
        return response(HttpStatus.BAD_REQUEST, "INVALID_PARAMETER", "请求参数格式不正确", null);
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<ApiError> handleUnreadableBody(HttpMessageNotReadableException exception) {
        return response(HttpStatus.BAD_REQUEST, "INVALID_REQUEST_BODY", "请求内容格式不正确", null);
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    ResponseEntity<ApiError> handleMethodNotSupported(HttpRequestMethodNotSupportedException exception) {
        return response(HttpStatus.METHOD_NOT_ALLOWED, "METHOD_NOT_ALLOWED", "当前地址不支持此请求方式", null);
    }

    @ExceptionHandler(NoResourceFoundException.class)
    ResponseEntity<ApiError> handleResourceNotFound(NoResourceFoundException exception) {
        return response(HttpStatus.NOT_FOUND, "NOT_FOUND", "请求的资源不存在", null);
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    ResponseEntity<ApiError> handleDataIntegrityViolation() {
        return response(HttpStatus.CONFLICT, "DATA_CONFLICT", "数据与现有记录冲突，请检查后重试", null);
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ApiError> handleUnexpected(Exception exception) {
        log.error("Unhandled API error", exception);
        return response(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "系统暂时无法处理，请稍后重试", null);
    }

    private ResponseEntity<ApiError> response(
            HttpStatus status,
            String code,
            String message,
            Map<String, String> fieldErrors
    ) {
        return ResponseEntity.status(status)
                .body(new ApiError(Instant.now(), status.value(), code, message, fieldErrors));
    }
}
