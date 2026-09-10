package cn.xzkj.erp.testing;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.classic.spi.ThrowableProxyUtil;
import ch.qos.logback.core.AppenderBase;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.stream.Collectors;
import org.slf4j.LoggerFactory;

public final class LogCapture implements AutoCloseable {

    private final Logger root;
    private final CopyOnWriteArrayList<ILoggingEvent> events =
            new CopyOnWriteArrayList<>();
    private final AppenderBase<ILoggingEvent> appender =
            new AppenderBase<>() {
                @Override
                protected void append(ILoggingEvent event) {
                    event.prepareForDeferredProcessing();
                    events.add(event);
                }
            };

    private LogCapture() {
        root = (Logger) LoggerFactory.getLogger(
                org.slf4j.Logger.ROOT_LOGGER_NAME);
        appender.start();
        root.addAppender(appender);
    }

    public static LogCapture start() {
        return new LogCapture();
    }

    public List<ILoggingEvent> events() {
        return List.copyOf(events);
    }

    public String rendered() {
        return events.stream()
                .map(LogCapture::render)
                .collect(Collectors.joining(System.lineSeparator()));
    }

    private static String render(ILoggingEvent event) {
        String throwable = event.getThrowableProxy() == null
                ? ""
                : System.lineSeparator()
                        + ThrowableProxyUtil.asString(
                                event.getThrowableProxy());
        return event.getLevel()
                + " "
                + event.getLoggerName()
                + " "
                + event.getFormattedMessage()
                + throwable;
    }

    @Override
    public void close() {
        root.detachAppender(appender);
        appender.stop();
    }
}
