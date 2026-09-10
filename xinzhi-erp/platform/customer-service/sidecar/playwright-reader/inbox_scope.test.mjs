import test from "node:test";
import assert from "node:assert/strict";
import {
  canScanUnreadList,
  extractConversationID,
  extractUnreadConversationID,
  inboxWorkPagePriority,
  canOpenTemporaryUnreadPage,
  isAdminInboxAppPage,
  isAdminStorePage,
  isInboxWorkPage,
  isInboxNonUnreadDetail,
  isInboxStorePage,
  isInboxUnreadDetail,
  isUnreadList,
  needsUnreadListNavigation,
  pagePriority,
  shouldKeepUnreadIndexURL
} from "./inbox_scope.mjs";

const unreadList = "https://inbox.shopify.com/store/1f1s6n-tx/conversations/unread";
const unreadDetail = "https://inbox.shopify.com/store/1f1s6n-tx/conversations/unread/019c7297-e318";
const closedDetail = "https://inbox.shopify.com/store/1f1s6n-tx/conversations/closed/019cea59-7bd4";
const openDetail = "https://inbox.shopify.com/store/1f1s6n-tx/conversations/open/019aaaaa-bbbb";
const adminInbox = "https://admin.shopify.com/store/1f1s6n-tx/apps/shopify-inbox/shopify_chat";
const otherUnreadList = "https://inbox.shopify.com/store/other-shop/conversations/unread";

test("pagePriority prefers unread inbox scope over closed and open detail pages", () => {
  assert.ok(pagePriority(unreadList) < pagePriority(unreadDetail));
  assert.ok(pagePriority(unreadDetail) < pagePriority(adminInbox));
  assert.ok(pagePriority(adminInbox) < pagePriority(closedDetail));
  assert.ok(pagePriority(adminInbox) < pagePriority(openDetail));
});

test("unread scope helpers only accept unread list and unread detail for queue reads", () => {
  assert.equal(isUnreadList(unreadList, "1f1s6n-tx"), true);
  assert.equal(isUnreadList(closedDetail, "1f1s6n-tx"), false);
  assert.equal(isInboxUnreadDetail(unreadDetail), true);
  assert.equal(isInboxUnreadDetail(closedDetail), false);
  assert.equal(isInboxUnreadDetail(openDetail), false);
  assert.equal(isInboxNonUnreadDetail(closedDetail), true);
  assert.equal(isInboxNonUnreadDetail(openDetail), true);
});

test("unread list scanning is allowed only on the unread list URL", () => {
  assert.equal(canScanUnreadList(unreadList, "1f1s6n-tx"), true);
  assert.equal(canScanUnreadList(unreadDetail, "1f1s6n-tx"), false);
  assert.equal(canScanUnreadList(openDetail, "1f1s6n-tx"), false);
  assert.equal(canScanUnreadList(closedDetail, "1f1s6n-tx"), false);
  assert.equal(canScanUnreadList(otherUnreadList, "1f1s6n-tx"), false);
});

test("conversation id extraction keeps generic and unread-only variants separate", () => {
  assert.equal(extractConversationID(closedDetail), "019cea59-7bd4");
  assert.equal(extractUnreadConversationID(closedDetail), "");
  assert.equal(extractUnreadConversationID(unreadDetail), "019c7297-e318");
});

test("unread index keeps rows without a link but rejects closed and open hrefs", () => {
  assert.equal(shouldKeepUnreadIndexURL(""), true);
  assert.equal(shouldKeepUnreadIndexURL(unreadDetail), true);
  assert.equal(shouldKeepUnreadIndexURL(closedDetail), false);
  assert.equal(shouldKeepUnreadIndexURL(openDetail), false);
});

test("navigation layer can recover from non-unread entry pages", () => {
  assert.equal(needsUnreadListNavigation(unreadList, "1f1s6n-tx"), false);
  assert.equal(needsUnreadListNavigation(unreadDetail, "1f1s6n-tx"), true);
  assert.equal(needsUnreadListNavigation(closedDetail, "1f1s6n-tx"), true);
  assert.equal(needsUnreadListNavigation(openDetail, "1f1s6n-tx"), true);
  assert.equal(needsUnreadListNavigation(adminInbox, "1f1s6n-tx"), true);
});

test("Inbox work page selection is limited to same-store Inbox tabs", () => {
  assert.equal(isAdminStorePage(adminInbox, "1f1s6n-tx"), true);
  assert.equal(isAdminInboxAppPage(adminInbox, "1f1s6n-tx"), true);
  assert.equal(isInboxStorePage(adminInbox, "1f1s6n-tx"), false);
  assert.equal(isInboxWorkPage(adminInbox, "1f1s6n-tx"), false);
  assert.equal(isInboxStorePage(unreadList, "1f1s6n-tx"), true);
  assert.equal(isInboxWorkPage(unreadList, "1f1s6n-tx"), true);
  assert.equal(isInboxStorePage(otherUnreadList, "1f1s6n-tx"), false);
  assert.equal(isInboxWorkPage(otherUnreadList, "1f1s6n-tx"), false);
  assert.ok(inboxWorkPagePriority(unreadList) < inboxWorkPagePriority(unreadDetail));
  assert.ok(inboxWorkPagePriority(unreadDetail) < inboxWorkPagePriority(openDetail));
  assert.equal(inboxWorkPagePriority(adminInbox), 99);
});

test("temporary unread page fallback is limited to same-store Inbox pages", () => {
  assert.equal(canOpenTemporaryUnreadPage(openDetail, "1f1s6n-tx"), true);
  assert.equal(canOpenTemporaryUnreadPage(closedDetail, "1f1s6n-tx"), true);
  assert.equal(canOpenTemporaryUnreadPage(unreadList, "1f1s6n-tx"), false);
  assert.equal(canOpenTemporaryUnreadPage(otherUnreadList, "1f1s6n-tx"), false);
  assert.equal(canOpenTemporaryUnreadPage(adminInbox, "1f1s6n-tx"), false);
});
