package ai.xzkj.recruitment.config;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.*;

import static org.assertj.core.api.Assertions.assertThat;

class HttpHardeningFilterTest {
    @Test void requestIdIsValidatedAndReturned() throws Exception {
        var request = new MockHttpServletRequest(); request.addHeader(RequestTraceFilter.HEADER, "unsafe id with spaces");
        var response = new MockHttpServletResponse(); new RequestTraceFilter().doFilter(request, response, new MockFilterChain());
        assertThat(response.getHeader(RequestTraceFilter.HEADER)).matches("[a-f0-9]{32}");
    }

    @Test void securityHeadersBlockEmbeddingAndBrowserCapabilities() throws Exception {
        var request = new MockHttpServletRequest(); request.setSecure(true);
        var response = new MockHttpServletResponse(); new SecurityHeadersFilter().doFilter(request, response, new MockFilterChain());
        assertThat(response.getHeader("X-Frame-Options")).isEqualTo("DENY");
        assertThat(response.getHeader("Content-Security-Policy")).contains("frame-ancestors 'none'");
        assertThat(response.getHeader("Strict-Transport-Security")).contains("max-age=31536000");
    }
}
