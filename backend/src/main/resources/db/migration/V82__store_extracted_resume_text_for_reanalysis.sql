ALTER TABLE resume_intakes ADD COLUMN IF NOT EXISTS extracted_text TEXT;
COMMENT ON COLUMN resume_intakes.extracted_text IS '已完成安全检查并确认进入 AI 的简历提取文本；受简历分析保留策略清理';
