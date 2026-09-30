package ai.xzkj.recruitment.candidates;

import ai.xzkj.recruitment.organization.Company;
import ai.xzkj.recruitment.organization.GroupProfile;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class CandidateIdentityServiceTest {
    @Test
    void reusesCandidateWhenPhoneMatchesAcrossSources() {
        CandidateProfileRepository repository = mock(CandidateProfileRepository.class);
        CandidateIdentityService service = new CandidateIdentityService(repository);
        Company company = new Company(new GroupProfile("集团", "G"), "企业", "C", null, null);
        CandidateProfile existing = new CandidateProfile(company, CandidateSource.BOSS, "b".repeat(64),
                "张三", null, null, null, null);
        when(repository.findByCompanyIdAndSourceAndDedupKey(company.getId(), CandidateSource.MANUAL, "m".repeat(64)))
                .thenReturn(Optional.empty());
        when(repository.findAllByCompanyIdAndIdentityPhoneDigest(eq(company.getId()), any()))
                .thenReturn(List.of(existing));
        when(repository.findAllByCompanyIdAndIdentityEmailDigest(eq(company.getId()), any()))
                .thenReturn(List.of());

        CandidateProfile resolved = service.resolve(company, CandidateSource.MANUAL, "m".repeat(64),
                "张三", null, null, null, null, "138-0013-8000", null);

        assertThat(resolved).isSameAs(existing);
        assertThat(existing.getIdentityPhoneDigest()).hasSize(64);
        verify(repository, never()).save(any(CandidateProfile.class));
    }

    @Test
    void doesNotMergeWhenPhoneAndEmailPointToDifferentCandidates() {
        CandidateProfileRepository repository = mock(CandidateProfileRepository.class);
        CandidateIdentityService service = new CandidateIdentityService(repository);
        Company company = new Company(new GroupProfile("集团", "G"), "企业", "C", null, null);
        CandidateProfile phoneOwner = new CandidateProfile(company, CandidateSource.BOSS, "b".repeat(64),
                "甲", null, null, null, null);
        CandidateProfile emailOwner = new CandidateProfile(company, CandidateSource.MANUAL, "m".repeat(64),
                "乙", null, null, null, null);
        when(repository.findByCompanyIdAndSourceAndDedupKey(any(), eq(CandidateSource.MANUAL), eq("n".repeat(64))))
                .thenReturn(Optional.empty());
        when(repository.findAllByCompanyIdAndIdentityPhoneDigest(eq(company.getId()), any()))
                .thenReturn(List.of(phoneOwner));
        when(repository.findAllByCompanyIdAndIdentityEmailDigest(eq(company.getId()), any()))
                .thenReturn(List.of(emailOwner));
        CandidateProfile created = new CandidateProfile(company, CandidateSource.MANUAL, "n".repeat(64),
                "新候选人", null, null, null, null);
        when(repository.save(any(CandidateProfile.class))).thenReturn(created);

        CandidateProfile resolved = service.resolve(company, CandidateSource.MANUAL, "n".repeat(64),
                "新候选人", null, null, null, null, "13800138000", "new@example.com");

        assertThat(resolved).isSameAs(created);
        verify(repository).save(any(CandidateProfile.class));
    }

    @Test
    void nameAloneDoesNotCreateAnIdentityMatch() {
        CandidateProfileRepository repository = mock(CandidateProfileRepository.class);
        CandidateIdentityService service = new CandidateIdentityService(repository);
        Company company = new Company(new GroupProfile("集团", "G"), "企业", "C", null, null);
        when(repository.findByCompanyIdAndSourceAndDedupKey(any(), eq(CandidateSource.MANUAL), any()))
                .thenReturn(Optional.empty());
        CandidateProfile created = new CandidateProfile(company, CandidateSource.MANUAL, "m".repeat(64),
                "张三", null, null, null, null);
        when(repository.save(any(CandidateProfile.class))).thenReturn(created);

        CandidateProfile resolved = service.resolve(company, CandidateSource.MANUAL, "m".repeat(64),
                "张三", null, null, null, null, null, null);

        assertThat(resolved).isSameAs(created);
        verify(repository).save(any(CandidateProfile.class));
        verify(repository, never()).findAllByCompanyIdAndIdentityPhoneDigest(any(), any());
    }

    @Test
    void doesNotReplaceAResumeVerifiedNameWithConversationDigestPlaceholder() {
        CandidateProfileRepository repository = mock(CandidateProfileRepository.class);
        CandidateIdentityService service = new CandidateIdentityService(repository);
        Company company = new Company(new GroupProfile("集团", "G"), "企业", "C", null, null);
        CandidateProfile existing = new CandidateProfile(company, CandidateSource.BOSS, "b".repeat(64),
                "林嘉明", null, null, null, null);
        when(repository.findByCompanyIdAndSourceAndDedupKey(company.getId(), CandidateSource.BOSS, "b".repeat(64)))
                .thenReturn(Optional.of(existing));

        service.resolve(company, CandidateSource.BOSS, "b".repeat(64), "匿名候选人 bbbbbbbb",
                null, null, null, null, null, null);

        assertThat(existing.getDisplayName()).isEqualTo("林嘉明");
    }
}
