UPDATE conversation_messages
SET content = trim(regexp_replace(
        regexp_replace(content, '(^|[[:space:]|｜·•])(已?送达|已读|未读|发送中|发送失败|发送成功)($|[[:space:]|｜·•])', '\1\3', 'g'),
        '[[:space:]]{2,}', ' ', 'g'))
WHERE content ~ '(^|[[:space:]|｜·•])(已?送达|已读|未读|发送中|发送失败|发送成功)($|[[:space:]|｜·•])';
