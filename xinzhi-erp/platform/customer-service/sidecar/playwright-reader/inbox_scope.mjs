export function pagePriority(rawURL) {
  const url = String(rawURL || "").toLowerCase();
  if (isUnreadList(url)) return 0;
  if (isInboxUnreadDetail(url)) return 1;
  if (url.includes("admin.shopify.com/store/") && url.includes("/apps/shopify-inbox")) return 2;
  if (url.includes("inbox.shopify.com/store/") && !isInboxNonUnreadDetail(url)) return 3;
  if (isInboxNonUnreadDetail(url)) return 4;
  if (url.includes("admin.shopify.com/store/")) return 5;
  return 6;
}

export function isUnreadList(rawURL, slug = "") {
  const url = String(rawURL || "");
  if (slug) {
    return new RegExp(`/store/${escapeRegExp(slug)}/conversations/unread(?:[?#]|$)`, "i").test(url);
  }
  return /\/store\/[^/?#]+\/conversations\/unread(?:[?#]|$)/i.test(url);
}

export function isInboxStorePage(rawURL, slug = "") {
  const url = String(rawURL || "");
  if (!/inbox\.shopify\.com\/store\//i.test(url)) return false;
  if (slug) {
    return new RegExp(`inbox\\.shopify\\.com/store/${escapeRegExp(slug)}(?:[/?#]|$)`, "i").test(url);
  }
  return true;
}

export function isAdminInboxAppPage(rawURL, slug = "") {
  const url = String(rawURL || "");
  if (!/admin\.shopify\.com\/store\/[^/?#]+\/apps\/shopify-inbox/i.test(url)) return false;
  if (slug) {
    return new RegExp(`admin\\.shopify\\.com/store/${escapeRegExp(slug)}/apps/shopify-inbox(?:[/?#]|$)`, "i").test(url);
  }
  return true;
}

export function isInboxWorkPage(rawURL, slug = "") {
  return isInboxStorePage(rawURL, slug);
}

export function isAdminStorePage(rawURL, slug = "") {
  const url = String(rawURL || "");
  if (!/admin\.shopify\.com\/store\//i.test(url)) return false;
  if (slug) {
    return new RegExp(`admin\\.shopify\\.com/store/${escapeRegExp(slug)}(?:[/?#]|$)`, "i").test(url);
  }
  return true;
}

export function inboxWorkPagePriority(rawURL) {
  if (!isInboxWorkPage(rawURL)) return 99;
  if (isUnreadList(rawURL)) return 0;
  if (isInboxUnreadDetail(rawURL)) return 1;
  if (!isInboxNonUnreadDetail(rawURL)) return 2;
  return 3;
}

export function isInboxConversationDetail(rawURL) {
  return /\/conversations\/(?:unread|open|closed)\/[^/?#]+/i.test(String(rawURL || ""));
}

export function isInboxUnreadDetail(rawURL) {
  return /\/conversations\/unread\/[^/?#]+/i.test(String(rawURL || ""));
}

export function isInboxNonUnreadDetail(rawURL) {
  return /\/conversations\/(?:open|closed)\/[^/?#]+/i.test(String(rawURL || ""));
}

export function shouldKeepUnreadIndexURL(rawURL) {
  const url = String(rawURL || "");
  return !url || !isInboxNonUnreadDetail(url);
}

export function needsUnreadListNavigation(rawURL, slug = "") {
  return !isUnreadList(rawURL, slug);
}

export function canScanUnreadList(rawURL, slug = "") {
  return isUnreadList(rawURL, slug);
}

export function canOpenTemporaryUnreadPage(rawURL, slug = "") {
  return isInboxStorePage(rawURL, slug) && !isUnreadList(rawURL, slug);
}

export function extractConversationID(rawURL) {
  return String(rawURL || "").match(/\/conversations\/(?:unread|open|closed)\/([^/?#]+)/i)?.[1] || "";
}

export function extractUnreadConversationID(rawURL) {
  return String(rawURL || "").match(/\/conversations\/unread\/([^/?#]+)/i)?.[1] || "";
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
