import test from "node:test";
import assert from "node:assert/strict";
import { emailPageScore, selectEmailTargetDescriptors, shopEmailHints } from "./email_scope_utils.mjs";

test("shop email hints extract mailbox and store aliases", () => {
  const hints = shopEmailHints("vitalunahealth.com-godlike7855@gmail.com-shopify");
  assert.ok(hints.emails.includes("godlike7855@gmail.com"));
  assert.ok(hints.aliases.includes("vitalunahealth"));
  assert.ok(hints.aliases.includes("godlike7855"));
});

test("email page scoring strongly matches the current shop mailbox", () => {
  const score = emailPageScore({
    title: "Inbox - godlike7855@gmail.com - Gmail",
    url: "https://mail.google.com/mail/u/0/#inbox"
  }, "vitalunahealth.com-godlike7855@gmail.com-shopify");
  assert.equal(score.provider, "gmail");
  assert.ok(score.score >= 100);
});

test("email target selection keeps matched mailbox ahead of unrelated mailbox tabs", () => {
  const selected = selectEmailTargetDescriptors([
    { title: "Inbox - unrelated@gmail.com - Gmail", url: "https://mail.google.com/mail/u/0/#inbox" },
    { title: "Inbox - godlike7855@gmail.com - Gmail", url: "https://mail.google.com/mail/u/1/#inbox" },
    { title: "Amarnis - Orders - Shopify", url: "https://admin.shopify.com/store/demo/orders" }
  ], "vitalunahealth.com-godlike7855@gmail.com-shopify");
  assert.equal(selected.length, 1);
  assert.equal(selected[0].title, "Inbox - godlike7855@gmail.com - Gmail");
});

test("email target selection scans available mail pages when no shop hint matches", () => {
  const selected = selectEmailTargetDescriptors([
    { title: "Inbox - Gmail", url: "https://mail.google.com/mail/u/0/#inbox" },
    { title: "Mail - Outlook", url: "https://outlook.live.com/mail/0/" }
  ], "unknown-shop");
  assert.equal(selected.length, 2);
});

test("Cuiqiu webmail keeps fastmo account as mailbox match", () => {
  const score = emailPageScore({
    title: "oownx@fastmo.cn - MailBox",
    url: "https://mail-client.cuiqiu.com/mail/index.html#/mailbox/INBOX"
  }, "solaryra-oownx@fastmo.cn-shopify");
  assert.equal(score.provider, "cuiqiu");
  assert.ok(score.matched.includes("oownx@fastmo.cn"));
  assert.ok(score.score >= 100);
});

test("manual service email restricts selection to the configured mailbox", () => {
  const selected = selectEmailTargetDescriptors([
    { title: "Inbox - store@fastmo.cn - MailBox", url: "https://mail-client.cuiqiu.com/mail/index.html#/mailbox/INBOX" },
    { title: "Mail - support@outlook.com - Outlook", url: "https://outlook.live.com/mail/0/" },
    { title: "Inbox - other@gmail.com - Gmail", url: "https://mail.google.com/mail/u/0/#inbox" }
  ], "same-shop", { mailAccount: "support@outlook.com", manual: true });
  assert.equal(selected.length, 1);
  assert.equal(selected[0].title, "Mail - support@outlook.com - Outlook");
});

test("manual service email returns no candidate when configured mailbox page is not open", () => {
  const selected = selectEmailTargetDescriptors([
    { title: "Inbox - store@fastmo.cn - MailBox", url: "https://mail-client.cuiqiu.com/mail/index.html#/mailbox/INBOX" },
    { title: "Inbox - other@gmail.com - Gmail", url: "https://mail.google.com/mail/u/0/#inbox" }
  ], "same-shop", { mailAccount: "support@outlook.com", manual: true });
  assert.deepEqual(selected, []);
});
