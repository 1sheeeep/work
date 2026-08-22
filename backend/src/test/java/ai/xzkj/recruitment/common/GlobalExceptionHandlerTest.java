package ai.xzkj.recruitment.common;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

import static org.assertj.core.api.Assertions.assertThat;

class GlobalExceptionHandlerTest {
    @Test
    void malformedPathParameterReturnsBadRequest() {
        var response = new GlobalExceptionHandler().handleTypeMismatch(null);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().code()).isEqualTo("INVALID_PARAMETER");
    }

    @Test
    void unsupportedMethodReturnsMethodNotAllowed() {
        var response = new GlobalExceptionHandler().handleMethodNotSupported(null);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.METHOD_NOT_ALLOWED);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().code()).isEqualTo("METHOD_NOT_ALLOWED");
    }
}
