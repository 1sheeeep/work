export function cleanOutlookDraftReplyText(value = "") {
  const quoteStart = (line = "") => {
    const text = String(line || "").trim();
    return /^[-_]{2,}\s*Original Message\s*[-_]{2,}$/i.test(text)
      || /^On\s+.{1,260}\bwrote:?$/i.test(text)
      || /^(El|La|Los|Las)\s+.{1,260}\bescribi[oó]:?$/i.test(text)
      || /^Le\s+.{1,260}\ba\s+[ée]crit\s*:?\s*$/i.test(text)
      || /^Am\s+.{1,260}\bschrieb\b/i.test(text)
      || /^Il\s+.{1,260}\bha\s+scritto\s*:?\s*$/i.test(text)
      || /^Op\s+.{1,260}\bschreef\s*:?\s*$/i.test(text)
      || /(^|\s)schrieb\s+.{0,180}:$/i.test(text)
      || /^(Von|From|Datum|Date|Betreff|Subject|An|To|Cc|Bcc)\s*[:\uFF1A]/i.test(text);
  };
  const chromeLine = (line = "") => {
    const text = String(line || "").trim();
    if (!text) return true;
    if (/^(Message|Insert|Format text|Draw|Options)$/i.test(text)) return true;
    if (/^(Reply|Reply all|Forward|Delete|Archive|Report|Move to|Read \/ Unread)$/i.test(text)) return true;
    if (/^(Translate to|Never translate from|This message is in)/i.test(text)) return true;
    return false;
  };
  const dedupe = (items = []) => {
    const out = [];
    const seen = new Set();
    for (const line of items) {
      const key = String(line || "").toLowerCase().replace(/\s+/g, " ").trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(line);
    }
    return out;
  };
  const lines = String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u200b\u200c\u200d\uFEFF]/g, "")
    .split(/\n+/)
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);
  const out = [];
  for (const line of lines) {
    if (quoteStart(line)) break;
    if (chromeLine(line)) continue;
    out.push(line);
  }
  return dedupe(out).join("\n").trim();
}

export function isOutlookDraftQuoteStart(line = "") {
  const text = String(line || "").trim();
  return /^[-_]{2,}\s*Original Message\s*[-_]{2,}$/i.test(text)
    || /^On\s+.{1,260}\bwrote:?$/i.test(text)
    || /^(El|La|Los|Las)\s+.{1,260}\bescribi[oó]:?$/i.test(text)
    || /^Le\s+.{1,260}\ba\s+[ée]crit\s*:?\s*$/i.test(text)
    || /^Am\s+.{1,260}\bschrieb\b/i.test(text)
    || /^Il\s+.{1,260}\bha\s+scritto\s*:?\s*$/i.test(text)
    || /^Op\s+.{1,260}\bschreef\s*:?\s*$/i.test(text)
    || /(^|\s)schrieb\s+.{0,180}:$/i.test(text)
    || /^(Von|From|Datum|Date|Betreff|Subject|An|To|Cc|Bcc)\s*[:\uFF1A]/i.test(text);
}
