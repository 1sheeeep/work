package cn.xzkj.erp.iam.web;

import cn.xzkj.erp.iam.application.InvalidLoginException;
import cn.xzkj.erp.iam.application.IamNotFoundException;
import cn.xzkj.erp.iam.application.IamOptimisticLockException;
import cn.xzkj.erp.iam.application.IamValidationException;
import cn.xzkj.erp.iam.application.LoginRateLimitedException;
import jakarta.validation.ConstraintViolationException;
import jakarta.persistence.OptimisticLockException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

@RestControllerAdvice(assignableTypes = {
        AuthController.class,
        AuthSessionController.class
})
public class AuthExceptionHandler {
    @ExceptionHandler(org.springframework.dao.DataAccessResourceFailureException.class)
    @ResponseStatus(HttpStatus.SERVICE_UNAVAILABLE)
    public SecurityErrorResponse sourceUnavailable(){return new SecurityErrorResponse("service_unavailable","Identity service is temporarily unavailable");}

    @ExceptionHandler(InvalidLoginException.class)
    @ResponseStatus(HttpStatus.UNAUTHORIZED)
    public SecurityErrorResponse invalidLogin() {
        return new SecurityErrorResponse(
                "invalid_credentials",
                "Invalid tenant, username, or password");
    }

    @ExceptionHandler(LoginRateLimitedException.class)
    public ResponseEntity<SecurityErrorResponse> loginRateLimited(
            LoginRateLimitedException exception) {
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .header(
                        HttpHeaders.RETRY_AFTER,
                        Long.toString(exception.getRetryAfterSeconds()))
                .body(new SecurityErrorResponse(
                        "login_rate_limited",
                        "Too many failed login attempts"));
    }

    @ExceptionHandler({
            MethodArgumentNotValidException.class,
            HandlerMethodValidationException.class,
            ConstraintViolationException.class,
            IamValidationException.class
    })
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public SecurityErrorResponse validationFailed() {
        return new SecurityErrorResponse(
                "validation_failed",
                "Request validation failed");
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public SecurityErrorResponse invalidRequest() {
        return new SecurityErrorResponse(
                "invalid_request",
                "Request body is invalid");
    }

    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    @ResponseStatus(HttpStatus.UNSUPPORTED_MEDIA_TYPE)
    public SecurityErrorResponse unsupportedMediaType() {
        return new SecurityErrorResponse(
                "invalid_request",
                "Content type is not supported");
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public SecurityErrorResponse invalidParameter() {
        return new SecurityErrorResponse(
                "invalid_request",
                "Request is invalid");
    }

    @ExceptionHandler(IamNotFoundException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    public SecurityErrorResponse notFound() {
        return new SecurityErrorResponse(
                "resource_not_found",
                "Resource was not found");
    }

    @ExceptionHandler({
            IamOptimisticLockException.class,
            ObjectOptimisticLockingFailureException.class,
            OptimisticLockException.class
    })
    @ResponseStatus(HttpStatus.CONFLICT)
    public SecurityErrorResponse optimisticConflict() {
        return new SecurityErrorResponse(
                "optimistic_lock_conflict",
                "Resource was modified by another request");
    }

    @ExceptionHandler(AccessDeniedException.class)
    @ResponseStatus(HttpStatus.FORBIDDEN)
    public SecurityErrorResponse denied() {
        return new SecurityErrorResponse(
                "permission_denied",
                "Permission is required");
    }
}
