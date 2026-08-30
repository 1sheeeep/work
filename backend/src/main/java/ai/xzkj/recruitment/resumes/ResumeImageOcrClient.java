package ai.xzkj.recruitment.resumes;

import ai.xzkj.recruitment.common.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

@Component
public class ResumeImageOcrClient {
    private static final int MAX_TEXT_CHARS = 30_000;
    private final ResumeOcrProperties properties;
    private final ObjectMapper mapper;
    private final HttpClient client;

    public ResumeImageOcrClient(ResumeOcrProperties properties, ObjectMapper mapper) {
        this.properties = properties;
        this.mapper = mapper;
        this.client = HttpClient.newBuilder().connectTimeout(properties.getConnectTimeout()).build();
    }

    public boolean supports(byte[] content) { return png(content) || jpeg(content); }

    public ExtractedImageText extract(byte[] content) {
        if (!supports(content)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "RESUME_IMAGE_TYPE_UNSUPPORTED", "扫描件仅支持 PNG 或 JPG/JPEG 格式");
        }
        if (!properties.isEnabled() || properties.getHost().isBlank() || properties.getPort() < 1 || properties.getPort() > 65535) {
            throw unavailable();
        }
        try {
            HttpRequest request = HttpRequest.newBuilder(endpoint())
                    .timeout(properties.getTimeout())
                    .header("Content-Type", png(content) ? "image/png" : "image/jpeg")
                    .POST(HttpRequest.BodyPublishers.ofByteArray(content))
                    .build();
            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() == 422 || response.statusCode() == 400) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "RESUME_OCR_REJECTED", "扫描件未通过本机 OCR 安全校验，请使用清晰的 PNG 或 JPG/JPEG 文件");
            }
            if (response.statusCode() < 200 || response.statusCode() >= 300) throw unavailable();
            JsonNode body = mapper.readTree(response.body());
            String text = body.path("text").asText("").replace("\u0000", "").trim();
            if (text.isBlank()) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "RESUME_OCR_TEXT_EMPTY", "未能从扫描件识别可读文本，请上传更清晰的图片或手工粘贴必要内容");
            }
            if (text.length() > MAX_TEXT_CHARS) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "RESUME_OCR_TEXT_TOO_LONG", "扫描件识别文本超过 30000 字，无法安全进入人工校验");
            }
            return new ExtractedImageText(text);
        } catch (ApiException exception) {
            throw exception;
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw unavailable();
        } catch (Exception exception) {
            throw unavailable();
        }
    }

    private URI endpoint() {
        try { return URI.create("http://" + properties.getHost() + ":" + properties.getPort() + "/ocr"); }
        catch (Exception exception) { throw unavailable(); }
    }

    private boolean png(byte[] content) {
        return content != null && content.length >= 8 && content[0] == (byte) 0x89 && content[1] == 0x50
                && content[2] == 0x4e && content[3] == 0x47 && content[4] == 0x0d && content[5] == 0x0a
                && content[6] == 0x1a && content[7] == 0x0a;
    }

    private boolean jpeg(byte[] content) {
        return content != null && content.length >= 3 && content[0] == (byte) 0xff && content[1] == (byte) 0xd8 && content[2] == (byte) 0xff;
    }

    private ApiException unavailable() {
        return new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "RESUME_OCR_UNAVAILABLE", "本机扫描件 OCR 服务暂不可用，文件未被提取或发送");
    }

    public record ExtractedImageText(String text) {}
}
