package cn.xzkj.erp.fulfillment.service;

public final class FulfillmentExceptions {

    public static final class NotFound extends RuntimeException {
        public NotFound() { super("Fulfillment resource not found"); }
    }

    public static final class Conflict extends RuntimeException {
        private final String reason;

        public Conflict(String reason) {
            super("Fulfillment request conflicts with current state");
            this.reason = reason;
        }

        public String reason() { return reason; }
    }

    public static final class Invalid extends RuntimeException {
        public Invalid(String message) { super(message); }
    }

    private FulfillmentExceptions() {
    }
}
