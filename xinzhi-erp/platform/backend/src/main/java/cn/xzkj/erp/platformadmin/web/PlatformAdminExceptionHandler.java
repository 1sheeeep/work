package cn.xzkj.erp.platformadmin.web;

import cn.xzkj.erp.iam.application.IamConflictException;
import cn.xzkj.erp.iam.application.IamNotFoundException;
import cn.xzkj.erp.iam.application.IamOptimisticLockException;
import cn.xzkj.erp.iam.application.IamValidationException;
import cn.xzkj.erp.iam.application.LoginRateLimitedException;
import cn.xzkj.erp.iam.web.SecurityErrorResponse;
import cn.xzkj.erp.platform.connector.ConnectorUnavailableException;
import cn.xzkj.erp.platformadmin.application.InvalidPlatformAdminCredentialException;
import cn.xzkj.erp.platformadmin.application.InvalidPlatformAdminLoginException;
import cn.xzkj.erp.platformadmin.shopifyrelease.PlatformShopifyAppReleaseController;
import cn.xzkj.erp.platformadmin.shopifyrelease.ShopifyAppReleaseFailedException;
import jakarta.persistence.OptimisticLockException;
import jakarta.validation.ConstraintViolationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
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
        PlatformAdminController.class,
        ShopifyComplianceController.class,
        PlatformShopifyAppReleaseController.class
})
public class PlatformAdminExceptionHandler {

    private static final Logger LOGGER =
            LoggerFactory.getLogger(PlatformAdminExceptionHandler.class);

    @ExceptionHandler(InvalidPlatformAdminLoginException.class)
    @ResponseStatus(HttpStatus.UNAUTHORIZED)
    public SecurityErrorResponse invalidLogin() {
        return new SecurityErrorResponse(
                "invalid_credentials",
                "Invalid username or password");
    }

    @ExceptionHandler(InvalidPlatformAdminCredentialException.class)
    @ResponseStatus(HttpStatus.UNAUTHORIZED)
    public SecurityErrorResponse invalidCredential() {
        return new SecurityErrorResponse(
                "invalid_password_credential",
                "Password credential is invalid or unavailable");
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

    @ExceptionHandler({
            HttpMessageNotReadableException.class,
            MethodArgumentTypeMismatchException.class
    })
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public SecurityErrorResponse invalidRequest() {
        return new SecurityErrorResponse(
                "invalid_request",
                "Request is invalid");
    }

    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    @ResponseStatus(HttpStatus.UNSUPPORTED_MEDIA_TYPE)
    public SecurityErrorResponse unsupportedMediaType() {
        return new SecurityErrorResponse(
                "invalid_request",
                "Content type is not supported");
    }

    @ExceptionHandler(IamNotFoundException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    public SecurityErrorResponse notFound() {
        return new SecurityErrorResponse(
                "resource_not_found",
                "Resource was not found");
    }

    @ExceptionHandler({
            IamConflictException.class,
            DataIntegrityViolationException.class
    })
    @ResponseStatus(HttpStatus.CONFLICT)
    public SecurityErrorResponse conflict() {
        return new SecurityErrorResponse(
                "conflict",
                "Request conflicts with the current resource state");
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

    @ExceptionHandler(ConnectorUnavailableException.class)
    @ResponseStatus(HttpStatus.SERVICE_UNAVAILABLE)
    public SecurityErrorResponse connectorUnavailable() {
        return new SecurityErrorResponse(
                "connector_unavailable",
                "Shopify connector is temporarily unavailable");
    }

    @ExceptionHandler(ShopifyAppReleaseFailedException.class)
    @ResponseStatus(HttpStatus.BAD_GATEWAY)
    public SecurityErrorResponse shopifyReleaseFailed() {
        return new SecurityErrorResponse(
                "shopify_app_release_failed",
                "Shopify app release failed; review the saved status and retry");
    }

    @ExceptionHandler(Exception.class)
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    public SecurityErrorResponse internalError(Exception exception) {
        LOGGER.error("Unexpected platform administrator error");
        return new SecurityErrorResponse(
                "internal_error",
                "An internal error occurred");
    }
}
