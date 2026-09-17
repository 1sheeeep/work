UPDATE job_reply_templates
SET template_text = '好的，我先看一下您的简历，了解后再和您联系。',
    updated_at = CURRENT_TIMESTAMP,
    version = version + 1
WHERE intent = 'RESUME_SENT'
  AND template_text = '收到，我先看一下您的简历，了解后再和您联系。';
