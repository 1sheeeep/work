package cn.xzkj.erp.iam.web;

import cn.xzkj.erp.iam.application.IamValidationException;
import cn.xzkj.erp.iam.application.InvalidPasswordCredentialException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice(assignableTypes = PasswordCredentialExchangeController.class)
public class PasswordCredentialExchangeExceptionHandler {

    private static final Logger LOGGER =
            LoggerFactory.getLogger(PasswordCredentialExchangeExceptionHandler.class);

    @ExceptionHandler({
            MethodArgumentNotValidException.class,
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

    @ExceptionHandler(InvalidPasswordCredentialException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public SecurityErrorResponse invalidCredential() {
        return new SecurityErrorResponse(
                "invalid_password_credential",
                "Credential is invalid or expired");
    }

    @ExceptionHandler(Exception.class)
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    public SecurityErrorResponse internalError(Exception exception) {
        LOGGER.error("Unexpected password credential exchange error");
        return new SecurityErrorResponse(
                "internal_error",
                "An internal error occurred");
    }
}
