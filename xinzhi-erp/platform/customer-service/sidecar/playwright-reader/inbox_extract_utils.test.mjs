import test from "node:test";
import assert from "node:assert/strict";
import { extractOrderLinks, orderLinkFromCustomerLastOrder, parseInboxUnreadCandidateLines, profileLinesLookUsable } from "./inbox_extract_utils.mjs";

test("profile validation rejects captured reply text in customer profile", () => {
  const lines = [
    "Hello Lisa,",
    "Thank you for your message, and I sincerely apologize for the confusion and concern this has caused you.",
    "Please let me know if you find any more details.",
    "Best regards,",
    "Customer Support Team",
    "You · 8:59 AM · delivered"
  ];
  assert.equal(profileLinesLookUsable(lines, "Lisa Fuchs"), false);
});

test("profile validation accepts real customer profile lines", () => {
  const lines = [
    "Gerbrand de VogtSusi",
    "lilafloresycesped@gmail.com",
    "Created customer 2026-02-13",
    "Boqueron"
  ];
  assert.equal(profileLinesLookUsable(lines, "Susi Gerbrand de Vogt"), true);
});

test("order link is derived from Shopify customer last order data", () => {
  const link = orderLinkFromCustomerLastOrder({
    name: "#1603",
    id: "gid://shopify/Order/6233657999545",
    displayFinancialStatus: "PAID",
    displayFulfillmentStatus: "FULFILLED"
  }, "1f1s6n-tx");
  assert.deepEqual(link, {
    label: "Order #1603",
    url: "https://admin.shopify.com/store/1f1s6n-tx/orders/6233657999545",
    kind: "order"
  });
});

test("malformed percent encoding in email text does not break order extraction", () => {
  assert.deepEqual(extractOrderLinks(["Order #%E0%A4%A is still pending"]), []);
});

test("Inbox unread fallback parses customer rows that are not buttons", () => {
  const parsed = parseInboxUnreadCandidateLines([
    "Unread",
    "Maria Lopez",
    "Order status",
    "I still have not received my package, can you check the tracking?",
    "Today"
  ]);
  assert.deepEqual(parsed, {
    customerName: "Maria Lopez",
    preview: "I still have not received my package, can you check the tracking?",
    topic: "Order status",
    lastSeen: "Today",
    rawLines: [
      "Maria Lopez",
      "Order status",
      "I still have not received my package, can you check the tracking?",
      "Today"
    ]
  });
});

test("Inbox unread fallback rejects Swedish store reply text as customer name", () => {
  const parsed = parseInboxUnreadCandidateLines([
    "Sj\u00e4lvklart \u00e4r retur m\u00f6jlig.",
    "Vi vill dock informera dig om att enligt v\u00e5r returpolicy ansvarar kunden normalt f\u00f6r returfrakten.",
    "Returns / Delivered orders",
    "Today"
  ]);
  assert.equal(parsed, null);
});

test("Inbox unread fallback rejects refund amount text as customer name", () => {
  const parsed = parseInboxUnreadCandidateLines([
    "29,00 SEK (Full \u00e5terbetalning f\u00f6r den prioriterade frakten)",
    "115,25 SEK (Extra 25% rabatt p\u00e5 produktens pris som goodwill)",
    "Returns / Delivered orders",
    "Today"
  ]);
  assert.equal(parsed, null);
});
