-- Older connector requests persisted the candidate text on the AI task but
-- omitted it from the selected-conversation timeline payload. Recover those
-- real inbound messages for contacts that already have a BOSS conversation.
INSERT INTO conversation_messages (
    id,
    contact_id,
    external_message_id,
    direction,
    sender_type,
    delivery_status,
    content,
    created_at
)
SELECT
    gen_random_uuid(),
    contact.id,
    'boss:' || task.message_digest,
    'INBOUND',
    'CANDIDATE',
    'RECEIVED',
    CASE
        WHEN task.purpose = 'RESUME_RECEIPT' THEN '[附件或简历]'
        ELSE task.message_text
    END,
    task.created_at
FROM inbound_ai_reply_tasks task
JOIN boss_accounts account ON account.id = task.account_id
JOIN candidate_profiles candidate
  ON candidate.company_id = account.company_id
 AND candidate.source = 'BOSS'
 AND candidate.dedup_key = task.chat_digest
JOIN candidate_job_contacts contact
  ON contact.candidate_id = candidate.id
 AND contact.job_position_id = task.job_position_id
 AND contact.boss_account_id = task.account_id
WHERE task.message_text IS NOT NULL
  AND btrim(task.message_text) <> ''
ON CONFLICT (contact_id, external_message_id) DO NOTHING;
