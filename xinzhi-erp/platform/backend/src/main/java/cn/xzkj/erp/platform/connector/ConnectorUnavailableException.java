package cn.xzkj.erp.platform.connector;

public class ConnectorUnavailableException extends RuntimeException {
    private final String code;
    private final boolean retryable;
    private final String correlationId;

    public ConnectorUnavailableException() {
        super("Channel connector is not configured");
        this.code = "CONNECTOR_UNAVAILABLE";
        this.retryable = true;
        this.correlationId = null;
    }

    public ConnectorUnavailableException(
            String code,
            boolean retryable,
            String correlationId) {
        super("Channel connector request failed");
        this.code = code;
        this.retryable = retryable;
        this.correlationId = correlationId;
    }

    public String code() {
        return code;
    }

    public boolean retryable() {
        return retryable;
    }

    public String correlationId() {
        return correlationId;
    }
}
