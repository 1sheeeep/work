package ai.xzkj.recruitment.candidates;

import java.util.List;

public record CandidateDetailResponse(CandidateContactResponse candidate,
                                      List<ScreeningDecisionResponse> decisions,
                                      List<ConversationMessageResponse> messages) {}
