package cn.xzkj.erp.product.storage;

public class ProductImageStorageUnavailableException extends RuntimeException {

    public ProductImageStorageUnavailableException(String message) {
        super(message);
    }

    public ProductImageStorageUnavailableException(
            String message,
            Throwable cause) {
        super(message, cause);
    }
}
