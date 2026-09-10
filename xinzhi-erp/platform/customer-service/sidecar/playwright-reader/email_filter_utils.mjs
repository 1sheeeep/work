export function normalizeSenderValue(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u201c\u201d]/g, "\"")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function firstEmail(value) {
  return String(value || "").match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i)?.[0]?.toLowerCase() || "";
}

function allEmails(value) {
  return Array.from(String(value || "").matchAll(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/ig), (match) => match[0].toLowerCase());
}

function isShopifyStoreRelayEmail(email = "") {
  return /^store\+\d+@(?:[a-z0-9-]+\.)?shopifyemail\.com$/i.test(String(email || "").trim());
}

function hasShopifyStoreRelayEmail(value = "") {
  return allEmails(value).some(isShopifyStoreRelayEmail);
}

export function senderDisplayFromHeader(value) {
  const text = String(value || "").replace(/\u00a0/g, " ").trim();
  const angle = text.match(/^(.*?)\s*<[^>]+>/);
  if (angle) return angle[1].trim().replace(/^["']|["']$/g, "");
  return text.replace(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/ig, "").replace(/[<>]/g, "").trim();
}

export function isDefiniteNonCustomerEmail(row = {}) {
  const haystack = rowHaystack(row);
  const email = firstEmail(haystack);
  const text = normalizeSenderValue(haystack);
  const senderName = normalizeSenderValue(senderDisplayFromHeader(row.sender || ""));

  if (isShopifyInboxCustomerNotification(text)) return false;
  if (isReplyableReviewNotice(text)) return false;
  if (hasCustomerReplyBeforeQuotedStoreRelay(row)) return false;
  if (isShopifyOperationalNotification(text, senderName)) return true;
  if (isShopifyOrderNotification(row, text)) return true;
  if (isStoreOutboundAutoNotice(row, text)) return true;

  if (email === "service@paypal.com" || senderName.includes("paypal")) {
    return /activity report|report available|download|statement|account/i.test(text);
  }
  if (senderName === "facebook" || email.endsWith("@facebookmail.com")) {
    return /business manager|partner request|meta|verified|page notification|security/i.test(text);
  }
  if (/tiktok|tik tok|tiktokmail|account\.tiktok/i.test(text)) return true;
  if (/findhealthclinics|your listing is live|listing is live|directory listing/i.test(text)) return true;
  if (isAttachmentOnlySender(senderName)) return true;
  if (hasShopifyStoreRelayHeader(row)) return true;
  if (/^(google|openai|airwallex|meta for business|facebook|x|shopify billing|the jobber team|maxwell from jobber|jobber grants|littlefindsco|microsoft account team)$/i.test(senderName)) return true;
  if (/account-security-noreply@accountprotection\.microsoft\.com/i.test(email)) return true;

  if (/business manager partner request|activity report available|site report|seo audit|meta verified|your listing is live/i.test(text)) return true;
  if (/performance[-\s]?based partnership|commission|generate sales|drive\s+\d+[\s-]*(?:to\s+)?\d*\s*orders|collab|collaboration|whatsapp number|upfront fees|retainers|extra\s+\d+[\s-]*(?:to\s+)?\d*\s*orders|orders\/week|steady flow of visitors|unlock\s+\d+\s+orders|partnership opportunity|website analysis|quick look/i.test(text)) return true;
  if (isMarketingOrToolPromotion(text, senderName, email)) return true;

  if (hasStrongCustomerIntent(text)) return false;
  return false;
}

export function isSafePreDetailIgnoredEmail(row = {}) {
  return isHighConfidencePreDetailIgnoredEmail(row);
}

export function isHighConfidencePreDetailIgnoredEmail(row = {}) {
  const haystack = rowHaystack(row);
  const email = firstEmail(haystack);
  const text = normalizeSenderValue(haystack);
  const senderName = normalizeSenderValue(senderDisplayFromHeader(row.sender || ""));
  if (isShopifyInboxCustomerNotification(text)) return false;
  if (isReplyableReviewNotice(text)) return false;
  if (hasCustomerReplyBeforeQuotedStoreRelay(row)) return false;
  if (isShopifyOperationalNotification(text, senderName)) return true;
  if (hasShopifyStoreRelayHeader(row)) return true;
  if (/tiktok|tik tok|tiktokmail|account\.tiktok/i.test(text)) return true;
  if (senderName === "facebook" || email.endsWith("@facebookmail.com")) return true;
  if (/^(google|openai|airwallex|meta for business|facebook|x|shopify billing|microsoft account team)$/i.test(senderName)) return true;
  if (/account-security-noreply@accountprotection\.microsoft\.com/i.test(email)) return true;
  if (isAttachmentOnlySender(senderName)) return true;
  return false;
}

export function shouldSkipPreviouslyIgnoredEmail(row = {}, ignoredEmailFingerprints = new Set()) {
  const fingerprint = String(row.emailFingerprint || "");
  if (!fingerprint || !ignoredEmailFingerprints?.has?.(fingerprint)) return false;
  return isHighConfidencePreDetailIgnoredEmail(row);
}

export function shouldKeepEmailRow(row = {}) {
  if (isDefiniteNonCustomerEmail(row)) return false;
  const folder = normalizeSenderValue(row.folderLabel || row.topic || "");
  if (/spam|junk|\u5783\u573e/.test(folder)) {
    const text = normalizeSenderValue(rowHaystack(row));
    return isReplyableReviewNotice(text) || hasStrongCustomerIntent(text);
  }
  return true;
}

export function shouldKeepEmailConversation(row = {}, conversation = {}) {
  if (isStoreOutboundAutoConversation(row, conversation)) return false;
  const folder = normalizeSenderValue(row.folderLabel || "");
  const hasCustomerRequest = hasDirectCustomerRequestMessage(row, conversation);
  const detailText = [
    rowHaystack(row),
    conversation.customerEmail,
    conversation.topic,
    conversation.preview,
    ...(Array.isArray(conversation.rawLines) ? conversation.rawLines : []),
    ...(Array.isArray(conversation.messages) ? conversation.messages.map((message) => message?.text || "") : [])
  ].join("\n");
  const detailRow = {
    sender: row.sender || conversation.customerName || "",
    subject: row.subject || conversation.topic || "",
    snippet: detailText,
    lines: [detailText],
    folderLabel: row.folderLabel || ""
  };
  if (/spam|junk|\u5783\u573e/.test(folder)) {
    const text = normalizeSenderValue(detailText);
    return hasCustomerRequest || isReplyableReviewNotice(text) || hasStrongCustomerIntent(text);
  }
  if (hasCustomerRequest) return true;
  if (hasShopifyStoreRelayEmail(detailText) && hasNonStoreCustomerMessage(conversation)) return true;
  if (isDefiniteNonCustomerEmail(detailRow)) return false;
  return true;
}

function rowHaystack(row = {}) {
  return [row.sender, row.subject, row.snippet, ...(Array.isArray(row.lines) ? row.lines : [])].join("\n");
}

function isAttachmentOnlySender(senderName = "") {
  return /^(?:\u9644\u4ef6|\u9644\u4ef6\uff1a|attachment|attachments?)$/i.test(senderName);
}

function isReplyableReviewNotice(text = "") {
  return /judge\.me|left (?:a )?\d star review|replying directly to this email|review notification/i.test(text);
}

function isShopifyInboxCustomerNotification(text = "") {
  return /\byou have a new message from\b|sent via inbox|reply in inbox|this conversation hasn['’]t been assigned to anyone|manage notification settings/i.test(text);
}

function isMarketingOrToolPromotion(text = "", senderName = "", email = "") {
  const source = `${senderName}\n${email}\n${text}`;
  if (/\bjobber\b/i.test(source) && /\b(track time|access job details|reduce your admin time|batch invoicing|automating your incoming requests|helping you solve problems)\b/i.test(text)) return true;
  return /\b(get|save)\s+\d{1,3}%\s+off\b|\b\d{1,3}%\s+off code\b|\boffer ends\b|\blimited[-\s]?time offer\b|\bfree trial\b|\bbook a demo\b|\bschedule a demo\b|\bwebinar\b|\bnewsletter\b|\bsubscribe\b|\bunsubscribe\b|\bmarketing emails?\b|\bproduct update\b|\bnew feature\b|\bready to checkout\b|\bcomplete your order\b|\byou left (?:an|your) order\b|\bclaim your coupon\b|\bfree shipping\b|\bshopping cart\b|\bgrant applications?\b|\bgift card\b|\bshare your feedback\b|\bhelp us improve\b/i.test(text);
}

function isStoreOutboundAutoConversation(row = {}, conversation = {}) {
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  const detailText = [
    rowHaystack(row),
    conversation.customerEmail,
    conversation.topic,
    conversation.preview,
    ...(Array.isArray(conversation.rawLines) ? conversation.rawLines : []),
    ...messages.map((message) => `${message?.email || ""}\n${message?.text || ""}`)
  ].join("\n");
  if (!isStoreOutboundAutoNotice(row, normalizeSenderValue(detailText))) return false;
  return !messages.some((message) => {
    if (message?.role === "store") return false;
    const messageText = normalizeSenderValue(`${message?.email || ""}\n${message?.text || ""}`);
    return messageText && !isStoreOutboundAutoNotice(row, messageText);
  });
}

function isShopifyOperationalNotification(text = "", senderName = "") {
  const shopifySender = /\bshopify\b/i.test(senderName);
  if (!shopifySender) return false;
  if (/已更改付款设置|更改[了的]?[\s\S]{0,80}支付设置|付款设置|支付设置|\bpayment\s+settings?\b|\bpayment\s+service\s+provider\b|airwallex[\s\S]{0,160}(?:结账|支付|付款|卡|停用|更改|deactivat|accept|card|checkout|payment)|(?:联系|contact)\s*shopify\s*(?:支持团队|support)/i.test(text)) return true;
  return /\u4ea7\u54c1\s*(?:csv\s*)?\u6587\u4ef6[\s\S]{0,120}\u5bfc\u5165[\s\S]{0,120}\u5df2\u5b8c\u6210|\u4ea7\u54c1\u5bfc\u5165\u5df2\u5b8c\u6210|\bproduct\s+csv\b[\s\S]{0,120}\bimport(?:ed)?\b[\s\S]{0,120}\bcomplete(?:d)?\b|\bproduct\s+import(?:ed)?\b[\s\S]{0,120}\bcomplete(?:d)?\b|\bsuccessfully\s+imported\b[\s\S]{0,80}\bproducts?\b/i.test(text);
}

function isShopifyOrderNotification(row = {}, text = "") {
  if (hasCustomerReplyBeforeQuotedStoreRelay(row)) return false;
  const subject = normalizeSenderValue(row.subject || "");
  const source = normalizeSenderValue([row.sender, row.subject, row.snippet, ...(Array.isArray(row.lines) ? row.lines : [])].join("\n"));
  const storeRelay = hasShopifyStoreRelayHeader(row);
  const chineseOrderSubject = /^\[[^\]]+\][\s\S]{0,140}\u4e0b(?:\u4e86|\u7684)\u8ba2\u5355\s*#?\d+/i.test(subject);
  const shopifyOrderBody = /\u67e5\u770b\u8ba2\u5355|\u8ba2\u5355\u6458\u8981|\u65e0\u9700\u53d1\u8d27|sku:|shopify payments|order summary/i.test(source);
  const englishOrderNotification = /\b(?:placed|created)\s+(?:an?\s+)?order\s*#?\d+|\border\s+#\d+\s+(?:confirmed|created)\b/i.test(source);
  return Boolean((storeRelay || chineseOrderSubject || englishOrderNotification) && shopifyOrderBody);
}

function isStoreOutboundAutoNotice(row = {}, text = "") {
  const subject = normalizeSenderValue(row.subject || "");
  const source = normalizeSenderValue([row.sender, row.subject, row.snippet, ...(Array.isArray(row.lines) ? row.lines : []), text].join("\n"));
  const storeRelay = hasShopifyStoreRelayEmail(source);
  const deliveryFailureNotice = /\bdelivery failed\b|\bplease contact fedex\b|\bunable to be delivered\b|\breturned to (?:the )?(?:local )?(?:fedex|ups|usps|dhl|carrier|post office)\b|\breschedule delivery\b|\bhold it for pickup\b/i.test(source);
  const storeTemplate = /\bdear\s+[a-z][a-z .'-]{0,60},[\s\S]{0,500}\byour order\s*#?\d+[\s\S]{0,800}\b(?:customer support team|best regards|sorry for the inconvenience|thank you for your understanding)\b/i.test(source);
  return Boolean(deliveryFailureNotice && (storeRelay || storeTemplate || /^delivery failed\b/i.test(subject) && storeTemplate));
}

function hasCustomerReplyBeforeQuotedStoreRelay(row = {}) {
  const source = rowHaystack(row);
  if (!hasShopifyStoreRelayEmail(source)) return false;
  const quoteMatch = source.match(/\bon\s+(?:mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday),?[\s\S]{0,240}\bwrote:/i)
    || source.match(/-----\s*original message\s*-----|from:\s*[\s\S]{0,120}store\+\d+@(?:[a-z0-9-]+\.)?shopifyemail\.com/i);
  if (!quoteMatch) return false;
  const prefix = source.slice(0, quoteMatch.index);
  return hasDirectCustomerSupportIntent(prefix);
}

function hasDirectCustomerRequestMessage(row = {}, conversation = {}) {
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  return messages.some((message) => {
    if (message?.role === "store") return false;
    if (isShopifyStoreRelayEmail(message?.email || "")) return false;
    const text = `${message?.email || ""}\n${message?.text || ""}`;
    if (isStoreOutboundAutoNotice(row, normalizeSenderValue(text))) return false;
    return hasDirectCustomerSupportIntent(text);
  });
}

function hasNonStoreCustomerMessage(conversation = {}) {
  if (isShopifyStoreRelayEmail(conversation?.customerEmail || "")) return false;
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  return messages.some((message) => {
    if (message?.role === "store") return false;
    if (isShopifyStoreRelayEmail(message?.email || "")) return false;
    return Boolean(normalizeSenderValue(message?.text || ""));
  });
}

function hasShopifyStoreRelayHeader(row = {}) {
  const lines = [row.sender || "", ...(Array.isArray(row.lines) ? row.lines : [])];
  return lines.some((line) => {
    const text = String(line || "").trim();
    if (/\bwrote:|original message/i.test(text)) return false;
    return /^[^<@\n]+\s*<\s*store\+\d+@(?:[a-z0-9-]+\.)?shopifyemail\.com\s*>/im.test(text);
  });
}

function hasDirectCustomerSupportIntent(text = "") {
  return /\b(?:i|we)\s+(?:haven't|have not|haven\u2019t|didn't|did not|never)\s+(?:received|got|get)\b|\bhaven't\s+received\b|\bhave not\s+received\b|\bnot\s+received\b|\bwhere\s+is\s+(?:my|the)\s+order\b|\bcan you tell me where\b|\bproduce\s+my\s+order\b|\brefund\b|\bmoney\s+back\b|\breturn\b|\bexchange\b|\bcancel\b|\bmissing\b|\bdamaged\b|\bbroken\b|\bwrong\s+item\b|\bscam\b|\blied?\b|\btracking\b[\s\S]{0,80}\b(?:not|no|missing|wrong|delayed|stuck)\b|\bpackage\b[\s\S]{0,80}\b(?:not|missing|delayed|lost)\b/i.test(text);
}

function hasStrongCustomerIntent(text = "") {
  return /order|ordered|purchase|purchased|bought|delivery|deliver|shipping|tracking|package|parcel|refund|return|exchange|cancel|address|where is|haven't received|not received|damaged|broken|wrong item|missing|confirm your|are you taking orders|take orders|pedido|recibido|no lo he recibido|entrega|env[ií]o|reembolso|devolver|\u8ba2\u5355|\u7269\u6d41|\u9000\u6b3e|\u9000\u8d27|\u6362\u8d27|\u5730\u5740|\u6536\u5230|\u672a\u6536\u5230/i.test(text);
}
