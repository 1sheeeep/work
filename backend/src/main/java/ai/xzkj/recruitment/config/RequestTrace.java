package ai.xzkj.recruitment.config;

import org.slf4j.MDC;

public final class RequestTrace {
    public static final String MDC_KEY = "requestId";
    private RequestTrace() {}
    public static String currentId() {
        String value = MDC.get(MDC_KEY);
        return value == null || value.isBlank() ? "system" : value;
    }
}
