package ai.xzkj.recruitment.resumes;

import ai.xzkj.recruitment.common.ApiException;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ResumeImageOcrClientTest {
    private static final byte[] PNG = new byte[]{(byte) 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1};

    @Test void forwardsSupportedImageOnlyToConfiguredInternalOcrService() throws Exception {
        HttpServer server = server(200, "{\"text\":\"候选人：示例\"}");
        try {
            ResumeImageOcrClient client = client(server);

            assertThat(client.extract(PNG).text()).isEqualTo("候选人：示例");
        } finally {
            server.stop(0);
        }
    }

    @Test void mapsOcrRejectionToSafeInputError() throws Exception {
        HttpServer server = server(422, "{\"code\":\"IMAGE_INVALID\"}");
        try {
            ResumeImageOcrClient client = client(server);

            assertThatThrownBy(() -> client.extract(PNG))
                    .isInstanceOf(ApiException.class)
                    .extracting(error -> ((ApiException) error).getCode())
                    .isEqualTo("RESUME_OCR_REJECTED");
        } finally {
            server.stop(0);
        }
    }

    @Test void rejectsNonImageBeforeContactingOcrService() {
        ResumeOcrProperties properties = new ResumeOcrProperties();
        properties.setEnabled(true);
        ResumeImageOcrClient client = new ResumeImageOcrClient(properties, new ObjectMapper());

        assertThatThrownBy(() -> client.extract("not-image".getBytes(StandardCharsets.UTF_8)))
                .isInstanceOf(ApiException.class)
                .extracting(error -> ((ApiException) error).getCode())
                .isEqualTo("RESUME_IMAGE_TYPE_UNSUPPORTED");
    }

    private HttpServer server(int status, String body) throws IOException {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/ocr", exchange -> {
            assertThat(exchange.getRequestMethod()).isEqualTo("POST");
            assertThat(exchange.getRequestHeaders().getFirst("Content-Type")).isEqualTo("image/png");
            assertThat(exchange.getRequestBody().readAllBytes()).isEqualTo(PNG);
            byte[] response = body.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(status, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        server.start();
        return server;
    }

    private ResumeImageOcrClient client(HttpServer server) {
        ResumeOcrProperties properties = new ResumeOcrProperties();
        properties.setEnabled(true);
        properties.setHost("127.0.0.1");
        properties.setPort(server.getAddress().getPort());
        properties.setConnectTimeout(Duration.ofSeconds(1));
        properties.setTimeout(Duration.ofSeconds(1));
        return new ResumeImageOcrClient(properties, new ObjectMapper());
    }
}
