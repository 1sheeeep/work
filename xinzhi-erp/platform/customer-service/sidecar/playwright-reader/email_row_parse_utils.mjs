export function parseEmailRowLines(lines = [], providerName = "") {
  const provider = String(providerName || "").toLowerCase();
  const normalized = (Array.isArray(lines) ? lines : [])
    .map((line) => String(line || "").replace(/[\uE000-\uF8FF]/g, "").trim())
    .filter((line) => line && /[a-z0-9\u4e00-\u9fff]/i.test(line));
  if (provider === "gmail") return parseGmailRowLines(normalized);
  if (provider === "outlook") return parseOutlookRowLines(normalized);
  return parseGenericRowLines(normalized);

  function parseGmailRowLines(parts) {
    const useful = parts.filter((line) => !isGmailRowNoise(line));
    const sender = useful.find((line) => !isTime(line) && line.length >= 2 && line.length <= 160) || "";
    const afterSender = useful.slice(Math.max(0, useful.indexOf(sender) + 1)).filter((line) => line !== sender && !isTime(line));
    const subject = afterSender.find((line) => line.length >= 2 && line.length <= 220) || "";
    const afterSubject = afterSender.slice(Math.max(0, afterSender.indexOf(subject) + 1))
      .filter((line) => line !== subject && line.length >= 2 && !isTime(line));
    const snippet = selectBestSnippet(afterSubject) || subject;
    return { sender, subject, snippet };
  }

  function parseOutlookRowLines(parts) {
    let cleaned = parts.map(stripOutlookDraftPrefix);
    if (cleaned.length >= 3 && /^[A-Z]{1,3}$/i.test(cleaned[0]) && !/@/.test(cleaned[0])) {
      cleaned = cleaned.slice(1);
    }
    const emailIndex = cleaned.findIndex((line) => /^<?[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}>?$/i.test(line));
    if (emailIndex > 0) {
      const sender = `${cleaned[emailIndex - 1]} ${cleaned[emailIndex]}`.trim();
      const afterEmail = cleaned.slice(emailIndex + 1);
      const subject = afterEmail.find((line) => !isTime(line) && line.length >= 2 && line.length <= 220) || cleaned[emailIndex - 1] || "";
      const afterSubject = afterEmail.slice(Math.max(0, afterEmail.indexOf(subject) + 1)).filter((line) => line !== subject && !isTime(line) && line.length >= 2);
      const snippet = selectBestSnippet(afterSubject) || subject;
      return { sender, subject, snippet };
    }
    return parseGenericRowLines(cleaned);
  }

  function parseGenericRowLines(parts) {
    const sender = parts.find((line) => !isTime(line) && line.length >= 2 && line.length <= 120) || "";
    const subject = parts.find((line) => line !== sender && !isTime(line) && line.length >= 2 && line.length <= 220) || "";
    const afterSubject = parts.slice(Math.max(0, parts.indexOf(subject) + 1)).filter((line) => line !== sender && line !== subject && !isTime(line) && line.length >= 2);
    const snippet = selectBestSnippet(afterSubject) || subject;
    return { sender, subject, snippet };
  }

  function stripOutlookDraftPrefix(line) {
    return String(line || "").replace(/^\s*\[Draft\]\s*/i, "").trim();
  }

  function selectBestSnippet(parts) {
    return parts
      .filter((line) => /[a-z\u4e00-\u9fff]/i.test(line) && line.length >= 5)
      .sort((a, b) => snippetScore(b) - snippetScore(a))[0] || "";
  }

  function snippetScore(line) {
    let score = Math.min(String(line || "").length, 500);
    if (/\s/.test(line)) score += 40;
    if (/[.!?。！？]$/.test(line)) score += 20;
    return score;
  }

  function isGmailRowNoise(line) {
    const value = String(line || "").trim();
    if (!value) return true;
    if (/^(?:-|–|—)$/.test(value)) return true;
    if (/^\d{1,3}$/.test(value)) return true;
    if (isTime(value)) return true;
    return /^(inbox|收件箱|primary|主要|important|重要|starred|已加星标|unread|未读|promotions|推广|social|社交|updates|动态|forums|论坛|shopping|购物|unsubscribe|退订)$/i.test(value);
  }

  function isTime(line) {
    if (/^(\d{1,2}:\d{2}|today(?:\s+at\b)?|yesterday(?:\s+at\b)?|an?\s+hour\s+ago|\d+\s+(?:minute|minutes|hour|hours|day|days)\s+ago|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\.?)$/i.test(String(line || "").trim())) return true;
    return /^(\d{1,2}:\d{2}|today|yesterday|mon|tue|wed|thu|fri|sat|sun|上午|下午|昨天|今天|周一|周二|周三|周四|周五|周六|周日|星期|\d{1,2}\s*月\s*\d{1,2}\s*日?)/i.test(String(line || "").trim());
  }
}
