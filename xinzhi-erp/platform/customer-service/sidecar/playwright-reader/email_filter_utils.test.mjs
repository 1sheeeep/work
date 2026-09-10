import test from "node:test";
import assert from "node:assert/strict";
import { isDefiniteNonCustomerEmail, isSafePreDetailIgnoredEmail, shouldKeepEmailConversation, shouldKeepEmailRow, shouldSkipPreviouslyIgnoredEmail } from "./email_filter_utils.mjs";

test("removed Shopify sender list no longer filters by sender identity", () => {
  for (const sender of [
    "no-reply@mailer.shopify.com",
    "Shopify <mailer@shopify.com>",
    "wealbeauty(Shopify) <mailer@shopify.com>",
    "Shopify Support (shopify) <support@shopify.com>",
    "Benjamin E. (shopify) <support@shopify.com>",
    "Shopify Support - No reply <no-reply@shopify.com>",
    "Shopify <email@email.shopify.com>"
  ]) {
    const row = { sender, subject: "Account message", snippet: "Please review this message.", lines: [sender] };
    assert.equal(isDefiniteNonCustomerEmail(row), false, sender);
    assert.equal(isSafePreDetailIgnoredEmail(row), false, sender);
  }
});

test("Shopify Inbox customer notification is opened before filtering", () => {
  const row = {
    sender: "no-reply@mailer.shopify.com",
    subject: "You have a new message from Iris Corali",
    snippet: "today at 10:16 AM",
    lines: ["no-reply@mailer.shopify.com", "You have a new message from Iris Corali", "Sent via Inbox", "Reply in Inbox"]
  };
  assert.equal(isSafePreDetailIgnoredEmail(row), false);
  assert.equal(isDefiniteNonCustomerEmail(row), false);
  assert.equal(shouldKeepEmailRow(row), true);
});

test("Shopify store payment settings notices are filtered", () => {
  const row = {
    sender: "Dilyhbu (Shopify) <mailer@shopify.com>",
    subject: "已更改付款设置",
    snippet: "HeJingjing 最近更改了 Dilyhbu 的支付设置。",
    lines: [
      "Dilyhbu (Shopify) <mailer@shopify.com>",
      "HeJingjing 停用了 Airwallex 作为支付服务提供商",
      "如果您未做出此更改，联系 Shopify 支持团队。"
    ]
  };
  assert.equal(isDefiniteNonCustomerEmail(row), true);
  assert.equal(shouldKeepEmailConversation(row, {
    customerEmail: "mailer@shopify.com",
    customerName: "Dilyhbu (Shopify)",
    topic: "已更改付款设置",
    preview: row.snippet,
    messages: [{ role: "customer", email: "mailer@shopify.com", text: row.lines.join("\n") }]
  }), false);
});

test("platform and marketing notices are filtered as non-customer email", () => {
  assert.equal(isDefiniteNonCustomerEmail({
    sender: "service@paypal.com",
    subject: "Activity report available for download",
    snippet: "Your activity report is ready."
  }), true);
  assert.equal(isDefiniteNonCustomerEmail({
    sender: "Facebook",
    subject: "You've received a Business Manager partner request",
    snippet: "Only approve requests from people and businesses you know."
  }), true);
  assert.equal(isDefiniteNonCustomerEmail({
    sender: "James Robert Service",
    subject: "Godlike",
    snippet: "Would you be open to a performance-based partnership where you only pay me after I generate sales?"
  }), true);
  assert.equal(isDefiniteNonCustomerEmail({
    sender: "Dammie",
    subject: "(No subject)",
    snippet: "Hello, can we agree on a 2% commission if I receive over 200 orders within 48 hours?"
  }), true);
  assert.equal(isDefiniteNonCustomerEmail({
    sender: "The Jobber Team",
    subject: "Track time, access job details, and take the app offline",
    snippet: "Get 40% off for 3 months before this offer ends."
  }), true);
  assert.equal(isDefiniteNonCustomerEmail({
    sender: "Maxwell from Jobber",
    subject: "Hey Cc, let's reduce your admin time to help you focus on your profits",
    snippet: "Learn how automating your incoming requests, assigning routes, or batch invoicing can reduce your admin time."
  }), true);
  assert.equal(isDefiniteNonCustomerEmail({
    sender: "Airwallex",
    subject: "May Airmail: Airwallex powers global expense automation with AI",
    snippet: "Plus: Seamless ERP sync via Spend API. Trouble viewing this email?"
  }), true);
  assert.equal(isDefiniteNonCustomerEmail({
    sender: "littlefindsco",
    subject: "Complete your order",
    snippet: "Ready to checkout? We've saved your order. Get 15% OFF now!"
  }), true);
  assert.equal(isDefiniteNonCustomerEmail({
    sender: "Meta for Business",
    subject: "Meta Pixel update",
    snippet: "This feature helps improve your ads performance."
  }), true);
  assert.equal(isDefiniteNonCustomerEmail({
    sender: "Maayan Naveh",
    subject: "Share your feedback for a $50 Amazon gift card!",
    snippet: "Help us improve by sharing your feedback!"
  }), true);
  assert.equal(isDefiniteNonCustomerEmail({
    sender: "附件：",
    subject: "image0.jpeg",
    snippet: "image0.jpeg"
  }), true);
});

test("customer intent and replyable reviews are not filtered as non-customer email", () => {
  assert.equal(isDefiniteNonCustomerEmail({
    sender: "hu qiang <Jason564666@outlook.com>",
    subject: "order",
    snippet: "I would like to return this order. Please help me to return it."
  }), false);
  assert.equal(shouldKeepEmailRow({
    folderLabel: "Inbox",
    sender: "hu qiang",
    subject: "order",
    snippet: "How long will it take for the goods purchased from this store to be delivered? I would like to return this order."
  }), true);
  assert.equal(shouldKeepEmailRow({
    folderLabel: "Inbox",
    sender: "daniel, Daniel, 我",
    subject: "Rv: Orden vitahealth",
    snippet: "Buenas Estoy esperando el reembolso ya q no quiero ya el producto."
  }), true);
  assert.equal(isDefiniteNonCustomerEmail({
    sender: "BAHJAH PRO",
    subject: "(No subject)",
    snippet: "Hi Godlike, are you taking orders?"
  }), false);
  assert.equal(isDefiniteNonCustomerEmail({
    sender: "MEEYAH CONSULT <meeyahconsult001@gmail.com>",
    subject: "(No subject)",
    snippet: "Are your products available for order"
  }), false);
  assert.equal(isDefiniteNonCustomerEmail({
    sender: "Judge.me <support@judge.me>",
    subject: "Borrero Nestor left a 1 star review",
    snippet: "You can contact the reviewer by replying directly to this email."
  }), false);
});

test("pre-detail filtering only skips verified or platform-safe senders", () => {
  assert.equal(isSafePreDetailIgnoredEmail({
    sender: "Shopify <mailer@shopify.com>",
    subject: "Your sales report",
    snippet: "Your report is ready."
  }), false);
  assert.equal(isSafePreDetailIgnoredEmail({
    sender: "daniel, Daniel, 我",
    subject: "Rv: Orden vitahealth",
    snippet: "Buenas Estoy esperando el reembolso"
  }), false);
  assert.equal(isSafePreDetailIgnoredEmail({
    sender: "Judge.me <support@judge.me>",
    subject: "Alberto left a 1 star review",
    snippet: "You can contact the reviewer by replying directly to this email."
  }), false);
});

test("Shopify store relay sender is filtered as own store mail", () => {
  const row = {
    sender: "Amarnis",
    subject: "Your order #1402 - Out for delivery",
    snippet: "Amarnis Dear Carmen, Thank you for your order.",
    lines: ["Amarnis <store+95298814236@g.shopifyemail.com>"]
  };
  assert.equal(isDefiniteNonCustomerEmail(row), true);
  assert.equal(isSafePreDetailIgnoredEmail(row), true);
  assert.equal(shouldKeepEmailConversation(row, {
    customerEmail: "store+95298814236@g.shopifyemail.com",
    messages: [{ role: "customer", text: "Amarnis Dear Carmen, Thank you for your order." }]
  }), false);

  const unnamedRow = {
    sender: "store+95298814236@g.shopifyemail.com",
    subject: "Account message",
    snippet: "Please review this message.",
    lines: ["store+95298814236@g.shopifyemail.com"]
  };
  assert.equal(isDefiniteNonCustomerEmail(unnamedRow), false);
  assert.equal(isSafePreDetailIgnoredEmail(unnamedRow), false);
});

test("Shopify store delivery failure notices are filtered until customer replies", () => {
  const autoRow = {
    folderLabel: "Inbox",
    sender: "Dilyhbu",
    subject: "Delivery Failed - Please Contact FedEx",
    snippet: "Dilyhbu Dear Larry, Your order #3583 was unable to be delivered and has been returned to the local FedEx facility.",
    lines: [
      "Dilyhbu <store+68807688310@g.shopifyemail.com>",
      "To: shortlawrence44@gmail.com",
      "Please call FedEx and give them your tracking number.",
      "Best regards, Customer Support Team"
    ]
  };
  assert.equal(isDefiniteNonCustomerEmail(autoRow), true);
  assert.equal(isSafePreDetailIgnoredEmail(autoRow), true);
  assert.equal(shouldKeepEmailRow(autoRow), false);
  assert.equal(shouldKeepEmailConversation(autoRow, {
    customerEmail: "shortlawrence44@gmail.com",
    messages: [{
      role: "store",
      email: "store+68807688310@g.shopifyemail.com",
      text: "Dear Larry,\nYour order #3583 was unable to be delivered and has been returned to the local FedEx facility.\nBest regards,\nCustomer Support Team"
    }]
  }), false);

  const customerReply = {
    folderLabel: "Inbox",
    sender: "Larry Short <shortlawrence44@gmail.com>",
    subject: "Re: Delivery Failed - Please Contact FedEx",
    snippet: "I called FedEx and they said the sender needs to reschedule it. Can you help?"
  };
  assert.equal(isDefiniteNonCustomerEmail(customerReply), false);
  assert.equal(isSafePreDetailIgnoredEmail(customerReply), false);
  assert.equal(shouldKeepEmailRow(customerReply), true);
  assert.equal(shouldKeepEmailConversation(customerReply, {
    customerEmail: "shortlawrence44@gmail.com",
    messages: [{
      role: "customer",
      email: "shortlawrence44@gmail.com",
      text: "I called FedEx and they said the sender needs to reschedule it. Can you help?"
    }]
  }), true);
});

test("customer reply quoting Shopify shipment notification is kept", () => {
  const row = {
    folderLabel: "Inbox",
    sender: "Shaunee Blanks",
    subject: "A shipment from order #1866 is on the way",
    snippet: "I haven't received my order yet. Please produce my order or a refund. Thank you On Mon, May 4, 2026, 1:57 AM Dilyhbu <store+68807688310@t.shopifyemail.com> wrote: Dilyhbu Order #1866 The last item in your order is on the way.",
    lines: [
      "Unread Collapsed Replied Shaunee Blanks A shipment from order #1866 is on the way Mon 7:55 I haven't received my order yet. Please produce my order or a refund. Thank you On Mon, May 4, 2026, 1:57 AM Dilyhbu <store+68807688310@t.shopifyemail.com> wrote: Dilyhbu Order #1866 The last item in your order is on the way."
    ]
  };
  assert.equal(isDefiniteNonCustomerEmail(row), false);
  assert.equal(isSafePreDetailIgnoredEmail(row), false);
  assert.equal(shouldKeepEmailRow(row), true);
  assert.equal(shouldKeepEmailConversation(row, {
    customerEmail: "shaunee.blanks@gmail.com",
    messages: [
      {
        role: "customer",
        email: "shaunee.blanks@gmail.com",
        text: "I haven't received my order yet. Please produce my order or a refund. Thank you"
      },
      {
        role: "store",
        email: "store+68807688310@t.shopifyemail.com",
        text: "Order #1866 The last item in your order is on the way."
      }
    ]
  }), true);

  assert.equal(shouldKeepEmailConversation(row, {
    customerEmail: "shaunee.blanks@gmail.com",
    messages: [
      {
        role: "customer",
        email: "shaunee.blanks@gmail.com",
        text: "Thank you"
      },
      {
        role: "store",
        email: "store+68807688310@t.shopifyemail.com",
        text: "Order #1866 The last item in your order is on the way."
      }
    ]
  }), true);
});

test("legacy ignored fingerprints only skip rows still high-confidence ignored", () => {
  const oldCustomerRow = {
    emailFingerprint: "old-shaunee",
    folderLabel: "Inbox",
    sender: "Shaunee Blanks",
    subject: "A shipment from order #1866 is on the way",
    snippet: "I haven't received my order yet. Please produce my order or a refund. Thank you",
    lines: ["Shaunee Blanks", "I haven't received my order yet. Please produce my order or a refund. Thank you"]
  };
  assert.equal(shouldSkipPreviouslyIgnoredEmail(oldCustomerRow, new Set(["old-shaunee"])), false);

  const systemRelayRow = {
    emailFingerprint: "system-relay",
    sender: "Dilyhbu <store+68807688310@g.shopifyemail.com>",
    subject: "Delivery Failed - Please Contact FedEx",
    snippet: "Your order #3583 was unable to be delivered.",
    lines: ["Dilyhbu <store+68807688310@g.shopifyemail.com>"]
  };
  assert.equal(shouldSkipPreviouslyIgnoredEmail(systemRelayRow, new Set(["system-relay"])), true);
});

test("Shopify order notification rows without a relay header are only filtered after detail read", () => {
  const row = {
    sender: "Kemye",
    subject: "[Kemye] BernalEnrique 下的订单 #1579",
    snippet: "BernalEnrique 于 Apr 11 7:55 am 下了订单 #1579。 查看订单 订单摘要 无需发货 商品 Shipping Insurance $2.99 × 1 SKU: SELF-SHIP-INS-001",
    lines: ["Kemye", "[Kemye] BernalEnrique 下的订单 #1579", "订单摘要", "SKU: SELF-SHIP-INS-001"]
  };
  assert.equal(isDefiniteNonCustomerEmail(row), true);
  assert.equal(isSafePreDetailIgnoredEmail(row), false);
  assert.equal(shouldKeepEmailRow(row), false);
  assert.equal(shouldKeepEmailConversation(row, {
    customerName: "Kemye",
    topic: row.subject,
    preview: row.snippet,
    messages: [{
      role: "store",
      text: "BernalEnrique placed order #1579. Order summary SKU: SELF-SHIP-INS-001"
    }]
  }), false);
});

test("recent customer order questions are not confused with Shopify order notifications", () => {
  const row = {
    folderLabel: "Inbox",
    sender: "jack lauretta",
    subject: "Order #5666 confirmed",
    snippet: "where is my package ?? still not here?? how do i request refund?? its to long already"
  };
  assert.equal(isDefiniteNonCustomerEmail(row), false);
  assert.equal(isSafePreDetailIgnoredEmail(row), false);
  assert.equal(shouldKeepEmailRow(row), true);
  assert.equal(shouldKeepEmailConversation(row, {
    messages: [{ role: "customer", text: row.snippet }]
  }), true);
});

test("Shopify product import completion notices are filtered", () => {
  const row = {
    sender: "Amarnis (Shopify)",
    subject: "\u201cAmarnis\u201d\u7684\u4ea7\u54c1\u5bfc\u5165\u5df2\u5b8c\u6210",
    snippet: "\u60a8\u4e8e 2026\u5e746\u670825\u65e5 22:41 \u5f00\u59cb\u5bfc\u5165\u7684\u4ea7\u54c1 CSV \u6587\u4ef6\u73b0\u5df2\u5b8c\u6210\u3002\u5df2\u6210\u529f\u5bfc\u5165 1 \u4e2a\u4ea7\u54c1\u3002",
    lines: ["Amarnis (Shopify)", "\u5df2\u6210\u529f\u5bfc\u5165 1 \u4e2a\u4ea7\u54c1"]
  };
  assert.equal(isSafePreDetailIgnoredEmail(row), true);
  assert.equal(shouldKeepEmailConversation(row, {
    customerName: "Amarnis (Shopify)",
    topic: row.subject,
    preview: row.snippet,
    messages: [{ role: "customer", text: row.snippet }]
  }), false);
});

test("detail filtering keeps customer intent and filters marketing after body read", () => {
  assert.equal(shouldKeepEmailConversation({
    folderLabel: "Inbox",
    sender: "daniel, Daniel, 我",
    subject: "Rv: Orden vitahealth",
    snippet: "Buenas Estoy esperando el reembolso"
  }, {
    messages: [{ role: "customer", text: "Buenas Estoy esperando el reembolso ya no quiero el producto." }]
  }), true);
  assert.equal(shouldKeepEmailConversation({
    folderLabel: "Inbox",
    sender: "Maayan Naveh",
    subject: "Share your feedback for a $50 Amazon gift card!",
    snippet: "Help us improve by sharing your feedback!"
  }, {
    messages: [{ role: "customer", text: "Help us improve by sharing your feedback for a gift card." }]
  }), false);
  assert.equal(shouldKeepEmailConversation({
    folderLabel: "Spam",
    sender: "Facebook",
    subject: "Partner request",
    snippet: "Meta business request"
  }, {
    messages: [{ role: "customer", text: "Only approve requests from people you know." }]
  }), false);
  assert.equal(shouldKeepEmailConversation({
    folderLabel: "Spam",
    sender: "Customer",
    subject: "Order not received",
    snippet: "I have not received my order"
  }, {
    messages: [{ role: "customer", text: "I have not received my order, please refund me." }]
  }), true);
});

test("Jobber marketing is filtered after detail read even when Gmail preview differs from body", () => {
  const row = {
    folderLabel: "Inbox",
    sender: "Maxwell from Jobber",
    subject: "Hey Cc, knock-out your competition by mastering these practices",
    snippet: "Entrepreneurship is tough, but listening to a podcast is easy."
  };
  const conversation = {
    customerName: "Maxwell from Jobber",
    topic: row.subject,
    preview: row.snippet,
    messages: [{
      role: "customer",
      text: "Looking for practical insights on scaling and improving your home service business? Check out Jobber's new podcast series. Unsubscribe from these emails."
    }]
  };
  assert.equal(shouldKeepEmailConversation(row, conversation), false);
});

test("spam folder keeps only strong customer intent", () => {
  assert.equal(shouldKeepEmailRow({
    folderLabel: "Spam",
    sender: "BAHJAH PRO",
    subject: "(No subject)",
    snippet: "Hi Godlike, are you taking orders?"
  }), true);
  assert.equal(shouldKeepEmailRow({
    folderLabel: "Junk Email",
    sender: "Alberto <albertoa12024@gmail.com>",
    subject: "Re: review request",
    snippet: "Gracias, pero no puedo opinar ya que no lo he recibido"
  }), true);
  assert.equal(shouldKeepEmailRow({
    folderLabel: "垃圾邮件",
    sender: "Dammie",
    subject: "(No subject)",
    snippet: "Can we agree on a 2% commission if I receive over 200 orders within 48 hours?"
  }), false);
  assert.equal(shouldKeepEmailRow({
    folderLabel: "Spam",
    sender: "Facebook",
    subject: "You've received a Business Manager partner request",
    snippet: "Only approve requests from people and businesses that you know."
  }), false);
});
