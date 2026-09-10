export function profileLinesLookUsable(lines, customerName = "") {
  const values = sourceTextLines(lines);
  if (!values.length) return false;
  const text = values.join("\n");
  const lower = text.toLowerCase().replace(/\s+/g, " ");
  const hasProfileAnchor = /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i.test(text)
    || /\b(created customer|returning customer|total spend|customer since|local time)\b/i.test(text)
    || /创建的客户|回头客|总支出|当地时间/.test(text);
  if (!hasProfileAnchor) return false;
  const messageLike = values.filter((line) => looksLikeMessageBody(line, customerName)).length;
  return messageLike < Math.max(2, Math.ceil(values.length * 0.45));
}

export function extractOrderLinks(lines) {
  const out = [];
  const seen = new Set();
  let recentOrderNumber = "";
  for (const line of sourceTextLines(lines)) {
    const currentOrderNumber = firstOrderNumber(line);
    if (currentOrderNumber) recentOrderNumber = currentOrderNumber;
    for (const match of line.matchAll(/https?:\/\/[^\s<>"')]+\/(?:orders|checkouts)\/[^\s<>"')]+/gi)) {
      const url = cleanURL(match[0]);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const orderNumber = currentOrderNumber || recentOrderNumber;
      out.push({
        label: orderNumber ? `Order #${orderNumber}` : shortLinkLabel(url),
        url,
        kind: /\/checkouts\//i.test(url) ? "checkout" : "order"
      });
    }
  }
  return out;
}

export function orderLinkFromCustomerLastOrder(lastOrder, storeSlug = "") {
  if (!lastOrder || typeof lastOrder !== "object") return null;
  const directURL = [
    lastOrder.adminUrl,
    lastOrder.url,
    lastOrder.orderStatusUrl,
    lastOrder.statusUrl
  ].find((value) => /^https?:\/\/.+\/orders\/.+/i.test(String(value || "")));
  if (directURL) {
    return { label: lastOrder.name ? `Order ${lastOrder.name}` : shortLinkLabel(directURL), url: cleanURL(directURL), kind: "order" };
  }
  const legacyID = [
    lastOrder.legacyResourceId,
    lastOrder.legacyId,
    lastOrder.adminGraphqlApiId,
    lastOrder.id
  ].map((value) => String(value || ""))
    .map((value) => value.match(/(?:Order\/|^)(\d{4,})$/i)?.[1] || "")
    .find(Boolean);
  if (!legacyID || !storeSlug) return null;
  return {
    label: lastOrder.name ? `Order ${lastOrder.name}` : `Order ${legacyID}`,
    url: `https://admin.shopify.com/store/${storeSlug}/orders/${legacyID}`,
    kind: "order"
  };
}

export function parseInboxUnreadCandidateLines(lines = []) {
  const localSourceTextLines = (items) => {
    const values = Array.isArray(items) ? items : String(items || "").split(/\n+/);
    return values
      .flatMap((line) => String(line || "").split(/\n+/))
      .map((line) => line.trim())
      .filter(Boolean);
  };
  const isTimeLine = (line = "") => /^(Yesterday|Today|\u6628\u5929|\u4eca\u5929|\u661f\u671f[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u65e5\u5929]?|\u5468[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u65e5\u5929]?|\d+\s*\u6708\s*\d+|\d{1,2}:\d{2}|\d+\s*(min|h|d)\b)/i.test(String(line || "").trim());
  const isSystemLine = (line = "") => /(opened|closed)\s+this\s+conversation|Select a conversation|Customer details|Conversation details|\u9009\u62e9\u4e00\u4e2a\u5bf9\u8bdd|\u5ba2\u6237\u8d44\u6599|\u5bf9\u8bdd\u8be6\u60c5/i.test(String(line || ""));
  const badCustomerLine = (line = "") => {
    const value = String(line || "").trim();
    const lower = value.toLowerCase().replace(/\s+/g, " ");
    if (!value) return true;
    if (/^(customer support team|customer support|support team|best regards|regards|thanks|thank you|dear customer|hello|hi|hola|saludos cordiales)[,.\s]*$/i.test(value)) return true;
    if (/^(you|store|customer|me|\u60a8|\u4f60|\u6211)\s*[:\uff1a]/i.test(value)) return true;
    if (/^(your cart currently has|checkout|product interest|order status|shipping|shopify|unknown customer)\s*:?\s*$/i.test(value)) return true;
    if (/^(tracking number|status|date|location|details|signed|delivered|order number|my order number)\s*[:\uff1a]/i.test(value)) return true;
    if (/^https?:\/\//i.test(value)) return true;
    if (/^mailto:/i.test(value) || /@(?:messaging\.)?shopifyemail\.com/i.test(value)) return true;
    if (/^\d+(?:[,.]\d+)?\s*(?:sek|usd|eur|gbp|cad|aud)\b/i.test(value)) return true;
    if (/\b(?:sek|usd|eur|gbp|cad|aud)\b/i.test(value) && /\b(?:refund|refunded|discount|goodwill|shipping|freight|frakt|rabatt|aterbetalning|\u00e5terbetalning)\b/i.test(value)) return true;
    if (/\b(?:sj\u00e4lvklart|returpolicy|returfrakt|kostnader f\u00f6r frakt|transportf\u00f6rs\u00e4kring|godk\u00e4nd retur|vi beklagar|f\u00f6rvirring|f\u00f6rst\u00e5else|v\u00e4nligen svara|med v\u00e4nliga h\u00e4lsningar|tackar f\u00f6r|jag finns h\u00e4r f\u00f6r dig)\b/i.test(value)) return true;
    if (/\b(?:we apologize|we are sorry|please reply|please provide|please send|thank you for your message|i understand|we understand|we will|we can help|let us know)\b/i.test(value)) return true;
    if (value.length > 70 && /[.!?。！？]/.test(value)) return true;
    if (value.split(/\s+/).length >= 8 && /\b(?:can|could|would|will|please|return|refund|order|package|product|send|inform|contact|hj\u00e4lpa|f\u00f6rklara|skicka|svara|tycker)\b/i.test(lower)) return true;
    return false;
  };
  const rawLines = localSourceTextLines(lines)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const ignored = new Set(["Open", "Unread", "Closed", "Settings", "Manage", "Filter", "Filters", "In progress", "Unassigned", "Assigned to me", "Spam", "Feedback", "Share feedback", "\u8bbe\u7f6e", "\u7ba1\u7406", "\u7b5b\u9009\u6761\u4ef6", "\u8fdb\u884c\u4e2d", "\u5df2\u5173\u95ed", "\u672a\u8bfb", "\u672a\u5206\u914d", "\u5df2\u5206\u914d\u7ed9\u6211", "\u5df2\u963b\u6b62", "\u5206\u4eab\u53cd\u9988", "\u4f18", "\u5dee"]);
  const topics = ["Order status", "Product interest", "Checkout", "Store info", "Returns / Delivered orders", "Shipping", "Order update request"];
  const useful = rawLines.filter((line) => !ignored.has(line) && !isSystemLine(line));
  if (useful.length < 2) return null;
  const customer = useful.find((line) => !isTimeLine(line) && !topics.includes(line) && !badCustomerLine(line)) || "";
  if (!customer) return null;
  const topicLines = useful.filter((line) => topics.includes(line));
  const lastSeen = useful.find(isTimeLine) || "";
  const afterCustomer = useful.slice(Math.max(0, useful.indexOf(customer) + 1));
  const preview = afterCustomer.find((line) => !isTimeLine(line) && !topics.includes(line) && !isSystemLine(line) && !ignored.has(line))
    || topicLines[0]
    || lastSeen
    || "";
  if (!preview && !lastSeen && topicLines.length === 0) return null;
  return {
    customerName: customer,
    preview,
    topic: topicLines.join(" / "),
    lastSeen,
    rawLines: useful.slice(0, 18)
  };
}

function looksLikeMessageBody(line, customerName = "") {
  const value = String(line || "").trim();
  if (!value) return false;
  const lower = value.toLowerCase();
  const customer = String(customerName || "").toLowerCase().trim();
  if (/^(hi|hello|dear)\b/.test(lower)) return true;
  if (/\b(thank you for your message|i understand|i apologize|best regards|customer support team)\b/i.test(value)) return true;
  if (/\bplease (let me know|contact|confirm|provide)\b/i.test(value)) return true;
  if (/^(you|您)\s*[•·-]\s*\d{1,2}:\d{2}/i.test(value)) return true;
  if (customer && lower.includes(customer) && /^(hi|hello|dear)\b/.test(lower)) return true;
  return false;
}

function sourceTextLines(lines) {
  const values = Array.isArray(lines) ? lines : String(lines || "").split(/\n+/);
  return values
    .flatMap((line) => String(line || "").split(/\n+/))
    .map((line) => line.trim())
    .filter(Boolean);
}

function cleanURL(value) {
  return String(value || "").replace(/[.,;。]+$/g, "");
}

function firstOrderNumber(value) {
  const decoded = safeDecodeURIComponent(value);
  const match = decoded.match(/#\s*(\d{2,20})/);
  return match ? match[1] : "";
}

function safeDecodeURIComponent(value) {
  const text = String(value || "");
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function shortLinkLabel(url) {
  return String(url || "").replace(/^https?:\/\//i, "").slice(0, 80);
}
