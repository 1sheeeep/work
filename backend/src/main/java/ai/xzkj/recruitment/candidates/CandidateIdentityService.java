package ai.xzkj.recruitment.candidates;

import ai.xzkj.recruitment.organization.Company;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 企业范围内的跨来源候选人解析。
 *
 * 强身份（手机号或邮箱）且不存在冲突时才复用已有候选人；姓名、岗位标题和文件摘要
 * 只用于展示/幂等，不足以触发自动合并。手机号和邮箱只以摘要落库。
 */
@Service
public class CandidateIdentityService {
    private static final Pattern PHONE = Pattern.compile("(?<!\\d)(?:\\+?86[- ]?)?1[3-9]\\d{9}(?!\\d)");
    private static final Pattern EMAIL = Pattern.compile("(?i)(?<![\\w.+-])[^\\s@]{1,120}@[A-Z0-9.-]{1,120}\\.[A-Z]{2,}(?![\\w.-])");
    private final CandidateProfileRepository profiles;

    public CandidateIdentityService(CandidateProfileRepository profiles) {
        this.profiles = profiles;
    }

    @Transactional
    public CandidateProfile resolve(Company company, CandidateSource source, String dedupKey,
                                    String displayName, String currentTitle, Integer yearsExperience,
                                    String education, String skillsSummary, String phone, String email) {
        String phoneDigest = digestPhone(phone);
        String emailDigest = digestEmail(email);
        CandidateProfile existing = profiles.findByCompanyIdAndSourceAndDedupKey(company.getId(), source, dedupKey)
                .orElse(null);
        if (existing != null) {
            existing.refresh(displayName, currentTitle, yearsExperience, education, skillsSummary);
            existing.updateIdentity(phoneDigest, emailDigest);
            return existing;
        }

        CandidateProfile canonical = findUnambiguousMatch(company, phoneDigest, emailDigest);
        if (canonical != null) {
            canonical.refresh(displayName, currentTitle, yearsExperience, education, skillsSummary);
            canonical.updateIdentity(phoneDigest, emailDigest);
            return canonical;
        }

        CandidateProfile created = new CandidateProfile(company, source, dedupKey, displayName,
                currentTitle, yearsExperience, education, skillsSummary);
        created.updateIdentity(phoneDigest, emailDigest);
        return profiles.save(created);
    }

    @Transactional
    public void updateFromResume(CandidateProfile candidate, String phone, String email) {
        if (candidate == null) return;
        String phoneDigest = digestPhone(phone);
        String emailDigest = digestEmail(email);
        CandidateProfile canonical = findUnambiguousMatch(candidate.getCompany(), phoneDigest, emailDigest);
        // 现有关系已绑定该候选人时不做危险的 FK 重挂；只补身份摘要。
        // 新来源进入时 resolve() 会复用该候选人，历史同名记录保留为独立档案供人工复核。
        if (canonical == null || canonical.getId().equals(candidate.getId())) candidate.updateIdentity(phoneDigest, emailDigest);
    }

    public String digestPhone(String value) {
        if (value == null) return null;
        String normalized = value.replaceAll("\\D", "");
        if (normalized.length() < 7) return null;
        return sha256(normalized);
    }

    public String digestEmail(String value) {
        if (value == null) return null;
        String normalized = value.trim().toLowerCase(java.util.Locale.ROOT);
        if (!normalized.matches("^[^@\\s]{1,120}@[^@\\s]{1,120}$")) return null;
        return sha256(normalized);
    }

    public String extractPhone(String text) {
        if (text == null) return null;
        Matcher matcher = PHONE.matcher(text);
        return matcher.find() ? matcher.group() : null;
    }

    public String extractEmail(String text) {
        if (text == null) return null;
        Matcher matcher = EMAIL.matcher(text);
        return matcher.find() ? matcher.group() : null;
    }

    private CandidateProfile findUnambiguousMatch(Company company, String phoneDigest, String emailDigest) {
        if (company == null || (phoneDigest == null && emailDigest == null)) return null;
        Set<CandidateProfile> phoneMatches = phoneDigest == null ? Set.of()
                : new LinkedHashSet<>(profiles.findAllByCompanyIdAndIdentityPhoneDigest(company.getId(), phoneDigest));
        Set<CandidateProfile> emailMatches = emailDigest == null ? Set.of()
                : new LinkedHashSet<>(profiles.findAllByCompanyIdAndIdentityEmailDigest(company.getId(), emailDigest));
        if (phoneMatches.size() > 1 || emailMatches.size() > 1) return null;
        if (!phoneMatches.isEmpty() && !emailMatches.isEmpty()) {
            CandidateProfile phone = phoneMatches.iterator().next();
            CandidateProfile email = emailMatches.iterator().next();
            return phone.getId().equals(email.getId()) ? phone : null;
        }
        if (!phoneMatches.isEmpty()) return phoneMatches.iterator().next();
        if (!emailMatches.isEmpty()) return emailMatches.iterator().next();
        return null;
    }

    private String sha256(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception exception) {
            throw new IllegalStateException("SHA-256 unavailable", exception);
        }
    }
}
