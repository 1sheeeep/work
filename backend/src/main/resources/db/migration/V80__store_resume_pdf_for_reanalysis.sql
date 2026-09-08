ALTER TABLE resume_intakes ADD COLUMN IF NOT EXISTS source_pdf BYTEA;
COMMENT ON COLUMN resume_intakes.source_pdf IS '病毒扫描通过的原始 PDF，用于 HR 触发重新分析；受保留策略清理';
