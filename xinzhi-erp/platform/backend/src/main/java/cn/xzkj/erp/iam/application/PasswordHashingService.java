package cn.xzkj.erp.iam.application;

import java.nio.CharBuffer;
import java.util.Arrays;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

@Service
public class PasswordHashingService {

    private static final int MAXIMUM_LENGTH = 128;

    private final PasswordEncoder passwordEncoder;

    public PasswordHashingService(PasswordEncoder passwordEncoder) {
        this.passwordEncoder = passwordEncoder;
    }

    /**
     * Creates the value stored in users.password_hash. The caller retains
     * ownership of the input and this method clears it before returning.
     */
    public String hashForStorage(char[] password) {
        if (password == null) {
            throw new IllegalArgumentException("Password is required");
        }
        try {
            if (!containsNonWhitespace(password)
                    || password.length > MAXIMUM_LENGTH) {
                throw new IllegalArgumentException("Password is invalid");
            }
            return passwordEncoder.encode(CharBuffer.wrap(password));
        } finally {
            Arrays.fill(password, '\0');
        }
    }

    private static boolean containsNonWhitespace(char[] password) {
        for (char value : password) {
            if (!Character.isWhitespace(value)) {
                return true;
            }
        }
        return false;
    }

    public boolean matches(CharSequence candidate, String storedHash) {
        if (storedHash == null) {
            return false;
        }
        try {
            return passwordEncoder.matches(candidate, storedHash);
        } catch (IllegalArgumentException malformedOrUnsupportedHash) {
            return false;
        }
    }
}
