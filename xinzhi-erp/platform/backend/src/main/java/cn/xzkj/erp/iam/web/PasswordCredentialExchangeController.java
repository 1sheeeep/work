package cn.xzkj.erp.iam.web;

import cn.xzkj.erp.iam.application.PasswordCredentialService;
import com.fasterxml.jackson.annotation.JsonAnySetter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.Arrays;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/auth/password-credentials")
public class PasswordCredentialExchangeController {

    private static final java.util.regex.Pattern REQUEST_ID_FORMAT =
            java.util.regex.Pattern.compile("^[A-Za-z0-9._:-]{1,100}$");

    private final PasswordCredentialService service;

    public PasswordCredentialExchangeController(PasswordCredentialService service) {
        this.service = service;
    }

    @PostMapping("/redeem")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void redeem(
            @Valid @RequestBody RedeemCredentialRequest body,
            HttpServletRequest request) {
        try {
            service.redeem(
                    body.token(),
                    body.newPassword(),
                    requestId(request),
                    request.getRemoteAddr());
        } finally {
            body.clear();
        }
    }

    private static String requestId(HttpServletRequest request) {
        String requestId = request.getHeader("X-Request-Id");
        if (requestId == null) {
            return null;
        }
        requestId = requestId.strip();
        if (requestId.isEmpty()) {
            return null;
        }
        requestId = requestId.substring(0, Math.min(100, requestId.length()));
        return REQUEST_ID_FORMAT.matcher(requestId).matches() ? requestId : null;
    }

    public static final class RedeemCredentialRequest {

        @NotNull
        @Size(min = 1, max = 512)
        private char[] token;

        @NotNull
        @Size(min = 1, max = 128)
        private char[] newPassword;

        private boolean unexpectedField;

        public char[] token() {
            return token;
        }

        public void setToken(char[] token) {
            this.token = token;
        }

        public char[] newPassword() {
            return newPassword;
        }

        public void setNewPassword(char[] newPassword) {
            this.newPassword = newPassword;
        }

        @JsonAnySetter
        public void rejectUnexpectedField(String name, Object ignoredValue) {
            unexpectedField = true;
        }

        @AssertTrue
        public boolean isSchemaValid() {
            return !unexpectedField;
        }

        void clear() {
            if (token != null) {
                Arrays.fill(token, '\0');
            }
            if (newPassword != null) {
                Arrays.fill(newPassword, '\0');
            }
        }
    }
}
