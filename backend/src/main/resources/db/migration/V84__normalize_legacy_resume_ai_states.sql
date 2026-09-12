-- AI 已完成的旧简历不应继续停留在人工审核状态。
-- 只处理确定安全的 SUCCEEDED 记录，不改变处理中、失败或未请求的记录。
UPDATE resume_intakes
SET status = 'APPROVED_FOR_AI',
    reviewed_by = NULL,
    reviewed_at = NULL,
    review_note = '历史数据已按 AI 成功结果自动归一化',
    updated_at = CURRENT_TIMESTAMP
WHERE status = 'PENDING_REVIEW'
  AND analysis_status = 'SUCCEEDED';
