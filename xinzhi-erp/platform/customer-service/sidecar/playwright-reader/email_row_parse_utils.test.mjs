import test from "node:test";
import assert from "node:assert/strict";
import { parseEmailRowLines } from "./email_row_parse_utils.mjs";

test("Gmail search row skips thread count, label, separator, and date", () => {
  const parsed = parseEmailRowLines([
    "hu qiang",
    "2",
    "收件箱",
    "order",
    "-",
    "Hello, I would like to return this order. I opened one pack but didn't touch the second pack.",
    "6月22日"
  ], "gmail");
  assert.deepEqual(parsed, {
    sender: "hu qiang",
    subject: "order",
    snippet: "Hello, I would like to return this order. I opened one pack but didn't touch the second pack."
  });
});

test("Gmail row keeps reply thread subject and best body snippet", () => {
  const parsed = parseEmailRowLines([
    "daniel, Daniel, 我",
    "4",
    "收件箱",
    "Rv: Orden vitahealth",
    "-",
    "Hola Daniel, Gracias por confirmar que estás de acuerdo. Procederé con el reembolso.",
    "5月29日"
  ], "gmail");
  assert.equal(parsed.sender, "daniel, Daniel, 我");
  assert.equal(parsed.subject, "Rv: Orden vitahealth");
  assert.match(parsed.snippet, /Gracias por confirmar/);
});

test("Outlook sender email row parsing is preserved", () => {
  const parsed = parseEmailRowLines([
    "HQ",
    "hu qiang",
    "Jason564666@outlook.com",
    "1112354",
    "Can the product be purchased now?",
    "周一 03:35"
  ], "outlook");
  assert.equal(parsed.sender, "hu qiang Jason564666@outlook.com");
  assert.equal(parsed.subject, "1112354");
  assert.equal(parsed.snippet, "Can the product be purchased now?");
});

test("Outlook draft row keeps customer identity and body snippet", () => {
  const parsed = parseEmailRowLines([
    "S",
    "[Draft] sabine.waechtler@gmx.at; TM-AT-AlleService53",
    "AW: Re: Re: Re: Verlust Bestatigung 31216629499",
    "(9)",
    "Sun 8:26 AM",
    "Hallo! Wie ist bitte der Stand???? Auf Klarna wurde auch noch nichts storniert!"
  ], "outlook");
  assert.equal(parsed.sender, "sabine.waechtler@gmx.at; TM-AT-AlleService53");
  assert.equal(parsed.subject, "AW: Re: Re: Re: Verlust Bestatigung 31216629499");
  assert.match(parsed.snippet, /Wie ist bitte der Stand/);
  assert.doesNotMatch(parsed.sender, /\[Draft\]/i);
});

test("Gmail row keeps long customer subject when snippet is missing", () => {
  const parsed = parseEmailRowLines([
    "Ana Maria / Customer Service",
    "Re: Order 78123 - customer says the package arrived damaged and asks whether a replacement can be sent this week",
    "Today"
  ], "gmail");
  assert.equal(parsed.sender, "Ana Maria / Customer Service");
  assert.match(parsed.subject, /package arrived damaged/);
  assert.equal(parsed.snippet, parsed.subject);
});

test("Outlook row without visible email keeps customer name and long body snippet", () => {
  const parsed = parseEmailRowLines([
    "Ana Maria",
    "Re: Return request for order 78123",
    "Yesterday",
    "I opened the package and the product is broken, please tell me how to return it."
  ], "outlook");
  assert.equal(parsed.sender, "Ana Maria");
  assert.equal(parsed.subject, "Re: Return request for order 78123");
  assert.match(parsed.snippet, /product is broken/);
});

test("Cuiqiu row parses Shopify Inbox notification without using time as snippet", () => {
  const parsed = parseEmailRowLines([
    "no-reply@mailer.shopify.com",
    "You have a new message from Iris Corali",
    "today at 10:16 AM"
  ], "cuiqiu");
  assert.equal(parsed.sender, "no-reply@mailer.shopify.com");
  assert.equal(parsed.subject, "You have a new message from Iris Corali");
  assert.equal(parsed.snippet, parsed.subject);
});
