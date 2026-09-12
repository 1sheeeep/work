package ai.xzkj.recruitment.candidates;

import java.util.List;

public record TalentCandidatePageResponse(
        List<TalentCandidateResponse> items,
        int page,
        int pageSize,
        long total,
        Counts counts) {

    public record Counts(
            long total,
            long withResume,
            long analyzed,
            long processing,
            long failed) {}
}
