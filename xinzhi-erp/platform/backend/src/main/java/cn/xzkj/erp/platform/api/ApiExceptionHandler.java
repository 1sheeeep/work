package cn.xzkj.erp.platform.api;

import java.util.LinkedHashMap;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.bind.MissingRequestHeaderException;

import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import cn.xzkj.erp.platform.service.ShopifyAuthorizationConflictException;
import cn.xzkj.erp.platform.connector.ConnectorUnavailableException;
import cn.xzkj.erp.analytics.inventoryaging.InventoryAgingReportController;
import cn.xzkj.erp.analytics.inventoryperiod.InventoryPeriodReportController;
import cn.xzkj.erp.inventory.api.InventoryController;
import cn.xzkj.erp.inventory.service.InventoryConflictException;
import cn.xzkj.erp.product.api.ProductCenterController;
import cn.xzkj.erp.product.bundle.ProductBundleController;
import cn.xzkj.erp.product.supplyprice.ProductSupplyPriceController;
import cn.xzkj.erp.product.service.ProductSpuBusinessCodeConflictException;
import cn.xzkj.erp.product.storage.ProductImageStorageUnavailableException;
import cn.xzkj.erp.procurement.api.ProcurementPlanController;
import cn.xzkj.erp.procurement.api.ProcurementPurchaseOrderController;
import cn.xzkj.erp.procurement.service.ProcurementPlanConflictException;
import cn.xzkj.erp.procurement.service.ProcurementPurchaseOrderConflictException;
import cn.xzkj.erp.supplier.api.SupplierController;
import cn.xzkj.erp.supplier.api.SupplierSkuMappingController;
import cn.xzkj.erp.settings.enterprise.EnterpriseProfileController;
import cn.xzkj.erp.settings.transfer.SettingsTransferTaskController;
import cn.xzkj.erp.warehouse.api.WarehouseController;
import cn.xzkj.erp.warehouse.operations.api.ManualMovementController;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementConflictException;
import jakarta.persistence.OptimisticLockException;
import jakarta.validation.ConstraintViolationException;

@RestControllerAdvice(basePackageClasses = {
        ShopCenterController.class,
        ProductCenterController.class,
        ProductBundleController.class,
        ProductSupplyPriceController.class,
        InventoryAgingReportController.class,
        InventoryPeriodReportController.class,
        SupplierController.class,
        SupplierSkuMappingController.class,
        WarehouseController.class,
        InventoryController.class,
        ManualMovementController.class,
        ProcurementPlanController.class,
        ProcurementPurchaseOrderController.class,
        EnterpriseProfileController.class,
        SettingsTransferTaskController.class
})
public class ApiExceptionHandler {
    private static final Logger LOGGER = LoggerFactory.getLogger(ApiExceptionHandler.class);

    @ExceptionHandler(ResourceNotFoundException.class)
    ResponseEntity<ApiError> handleNotFound(ResourceNotFoundException exception) {
        return error(
                HttpStatus.NOT_FOUND,
                "resource_not_found",
                "Requested resource was not found",
                Map.of()
        );
    }

    @ExceptionHandler(InventoryConflictException.class)
    ResponseEntity<ApiError> handleInventoryConflict(
            InventoryConflictException exception) {
        return error(
                HttpStatus.CONFLICT,
                "resource_conflict",
                "The request conflicts with the current inventory state",
                Map.of("reason", exception.reason())
        );
    }

    @ExceptionHandler(ManualMovementConflictException.class)
    ResponseEntity<ApiError> handleManualMovementConflict(
            ManualMovementConflictException exception) {
        return error(
                HttpStatus.CONFLICT,
                "resource_conflict",
                "The request conflicts with the current manual movement state",
                Map.of("reason", exception.reason())
        );
    }

    @ExceptionHandler(ProcurementPlanConflictException.class)
    ResponseEntity<ApiError> handleProcurementPlanConflict(
            ProcurementPlanConflictException exception) {
        return error(
                HttpStatus.CONFLICT,
                "resource_conflict",
                "The request conflicts with the current procurement plan state",
                Map.of("reason", exception.reason())
        );
    }

    @ExceptionHandler(ProcurementPurchaseOrderConflictException.class)
    ResponseEntity<ApiError> handleProcurementPurchaseOrderConflict(
            ProcurementPurchaseOrderConflictException exception) {
        return error(
                HttpStatus.CONFLICT,
                "resource_conflict",
                "The request conflicts with the current procurement order state",
                Map.of("reason", exception.getReason())
        );
    }

    @ExceptionHandler(ShopifyAuthorizationConflictException.class)
    ResponseEntity<ApiError> handleShopifyAuthorizationConflict(
            ShopifyAuthorizationConflictException exception) {
        return error(
                HttpStatus.CONFLICT,
                "shopify_authorization_conflict",
                "Shopify authorization must be connected and include the required scope",
                exception.details()
        );
    }

    @ExceptionHandler(ProductSpuBusinessCodeConflictException.class)
    ResponseEntity<ApiError> handleProductSpuBusinessCodeConflict(
            ProductSpuBusinessCodeConflictException exception) {
        return error(
                HttpStatus.CONFLICT,
                "spu_business_code_conflict",
                "A master product with this business code already exists",
                Map.of());
    }

    @ExceptionHandler(ProductImageStorageUnavailableException.class)
    ResponseEntity<ApiError> handleProductImageStorageUnavailable(
            ProductImageStorageUnavailableException exception) {
        LOGGER.error("Product image storage is unavailable", exception);
        return error(
                HttpStatus.SERVICE_UNAVAILABLE,
                "product_image_storage_unavailable",
                "Product image storage is temporarily unavailable",
                Map.of());
    }

    @ExceptionHandler({
            ConflictException.class,
            IllegalStateException.class,
            ObjectOptimisticLockingFailureException.class,
            OptimisticLockException.class,
            DataIntegrityViolationException.class,
            org.hibernate.exception.ConstraintViolationException.class
    })
    ResponseEntity<ApiError> handleConflict(RuntimeException exception) {
        return error(
                HttpStatus.CONFLICT,
                "resource_conflict",
                "The request conflicts with the current resource state",
                Map.of()
        );
    }

    @ExceptionHandler(IllegalArgumentException.class)
    ResponseEntity<ApiError> handleIllegalArgument(IllegalArgumentException exception) {
        return error(HttpStatus.BAD_REQUEST, "invalid_request", "The request is invalid", Map.of());
    }

    @ExceptionHandler(ConnectorUnavailableException.class)
    ResponseEntity<ApiError> handleConnectorUnavailable(ConnectorUnavailableException exception) {
        if ("NATIVE_LINK_UNAVAILABLE".equals(exception.code())) {
            return error(HttpStatus.CONFLICT, "native_link_unavailable",
                    "Return to Shopify Admin and check the connection before starting a new link", Map.of());
        }
        return error(
                HttpStatus.SERVICE_UNAVAILABLE,
                "connector_unavailable",
                "Channel connector is not configured",
                Map.of());
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<ApiError> handleUnreadableMessage(HttpMessageNotReadableException exception) {
        return error(HttpStatus.BAD_REQUEST, "invalid_request", "Request body is invalid", Map.of());
    }

    @ExceptionHandler(MissingRequestHeaderException.class)
    ResponseEntity<ApiError> handleMissingHeader(
            MissingRequestHeaderException exception) {
        return error(
                HttpStatus.BAD_REQUEST,
                "invalid_request",
                "A required request header is missing",
                Map.of());
    }

    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    ResponseEntity<ApiError> handleUnsupportedMediaType(HttpMediaTypeNotSupportedException exception) {
        return error(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "invalid_request",
                "Content type is not supported", Map.of());
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    ResponseEntity<ApiError> handleTypeMismatch(MethodArgumentTypeMismatchException exception) {
        return error(HttpStatus.BAD_REQUEST, "invalid_request", "The request is invalid", Map.of());
    }

    @ExceptionHandler({HandlerMethodValidationException.class, ConstraintViolationException.class})
    ResponseEntity<ApiError> handleMethodValidation(RuntimeException exception) {
        return error(HttpStatus.BAD_REQUEST, "validation_failed", "Request validation failed", Map.of());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<ApiError> handleValidation(MethodArgumentNotValidException exception) {
        Map<String, String> details = new LinkedHashMap<>();
        exception.getBindingResult().getFieldErrors().forEach(fieldError ->
                details.putIfAbsent(fieldError.getField(), "invalid")
        );
        return error(HttpStatus.BAD_REQUEST, "validation_failed", "Request validation failed", details);
    }

    @ExceptionHandler(AccessDeniedException.class)
    ResponseEntity<ApiError> handleAccessDenied(AccessDeniedException exception) {
        return error(HttpStatus.FORBIDDEN, "permission_denied", "Permission is required", Map.of());
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ApiError> handleUnexpected(Exception exception) {
        LOGGER.error("Unexpected business API error");
        return error(HttpStatus.INTERNAL_SERVER_ERROR, "internal_error",
                "An internal error occurred", Map.of());
    }

    private static ResponseEntity<ApiError> error(
            HttpStatus status,
            String code,
            String message,
            Map<String, String> details
    ) {
        return ResponseEntity.status(status)
                .contentType(MediaType.APPLICATION_JSON)
                .body(new ApiError(code, message, details));
    }

    record ApiError(
            String code,
            String message,
            Map<String, String> details
    ) {
    }
}
