package cn.xzkj.erp.iam.web;

import cn.xzkj.erp.iam.application.IamConflictException;
import cn.xzkj.erp.iam.application.IamNotFoundException;
import cn.xzkj.erp.iam.application.IamOptimisticLockException;
import cn.xzkj.erp.iam.application.IamValidationException;
import cn.xzkj.erp.iam.application.SelfServiceNotAllowedException;
import cn.xzkj.erp.iam.application.SystemRoleProtectedException;
import cn.xzkj.erp.iam.warehousescope.ProtectedWarehouseScopeException;
import jakarta.persistence.OptimisticLockException;
import jakarta.validation.ConstraintViolationException;
import org.springframework.http.HttpStatus;
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
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@RestControllerAdvice(assignableTypes = {
        IamAdminController.class,
        PasswordCredentialAdminController.class
})
public class IamExceptionHandler {

    private static final Logger LOGGER =
            LoggerFactory.getLogger(IamExceptionHandler.class);

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

    @ExceptionHandler(IamConflictException.class)
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
    public SecurityErrorResponse optimisticLockConflict() {
        return new SecurityErrorResponse(
                "optimistic_lock_conflict",
                "Resource was modified by another request");
    }

    @ExceptionHandler(SystemRoleProtectedException.class)
    @ResponseStatus(HttpStatus.CONFLICT)
    public SecurityErrorResponse systemRoleProtected() {
        return new SecurityErrorResponse(
                "system_role_protected",
                "Protected role cannot be modified");
    }

    @ExceptionHandler(SelfServiceNotAllowedException.class)
    @ResponseStatus(HttpStatus.CONFLICT)
    public SecurityErrorResponse selfServiceNotAllowed() {
        return new SecurityErrorResponse(
                "self_service_not_allowed",
                "Administrator cannot manage themselves through this operation");
    }

    @ExceptionHandler(ProtectedWarehouseScopeException.class)
    @ResponseStatus(HttpStatus.CONFLICT)
    public SecurityErrorResponse protectedWarehouseScope() {
        return new SecurityErrorResponse(
                "protected_scope",
                "Tenant administrator warehouse scope cannot be modified");
    }

    @ExceptionHandler(AccessDeniedException.class)
    @ResponseStatus(HttpStatus.FORBIDDEN)
    public SecurityErrorResponse permissionDenied() {
        return new SecurityErrorResponse(
                "permission_denied",
                "Permission is required");
    }

    @ExceptionHandler(Exception.class)
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    public SecurityErrorResponse internalError(Exception exception) {
        LOGGER.error("Unexpected IAM administration error");
        return new SecurityErrorResponse(
                "internal_error",
                "An internal error occurred");
    }
}
