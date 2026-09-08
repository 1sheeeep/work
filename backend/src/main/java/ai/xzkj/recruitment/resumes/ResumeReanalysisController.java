package ai.xzkj.recruitment.resumes;

import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import java.util.UUID;

@RestController
class ResumeReanalysisController {
    private final ResumeAnalysisService analysis;
    ResumeReanalysisController(ResumeAnalysisService analysis) { this.analysis = analysis; }
    @PostMapping("/api/resume-intakes/{id}/reanalyze")
    ResumeAnalysisResponse reanalyze(@PathVariable UUID id) { return analysis.reanalyzeStoredPdf(id); }
}
