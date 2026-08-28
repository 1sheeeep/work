package ai.xzkj.recruitment.ai;
import ai.xzkj.recruitment.candidates.ScreeningOutcome;
public interface AiGateway{
 JobSuggestion parseJob(String description);
 ScreeningSuggestion screenCandidate(CandidateFacts candidate,JobFacts job);
 record JobSuggestion(String title,String location,int salaryMinK,int salaryMaxK,int salaryMonths,String experienceRequirement,String educationRequirement,String screeningRequirements,String rationale){}
 record CandidateFacts(String currentTitle,Integer yearsExperience,String education,String skillsSummary){}
 record JobFacts(String title,String experienceRequirement,String educationRequirement,String screeningRequirements,String description){}
 record ScreeningSuggestion(ScreeningOutcome outcome,String rationale){}
}
