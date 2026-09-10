import test from "node:test";
import assert from "node:assert/strict";
import { cleanOutlookDraftReplyText } from "./email_outlook_draft_utils.mjs";

test("Outlook draft cleaner keeps latest customer reply and cuts German quote history", () => {
  const cleaned = cleanOutlookDraftReplyText(`
Message
Insert
Hallo!
Wie ist bitte der Stand????
Auf Klarna wurde auch noch nichts storniert!
Mit freundlichen Grussen
Sabine Waechtler
Gesendet mit der mobilen Mail App
Am 12.06.26 um 16:46 schrieb TM-AT-AlleService53
Von: "TM-AT-AlleService53" <alleservice53@gls-austria.com>
Datum: 12. Juni 2026
Betreff: AW: Re: Re: Re: Verlust Bestatigung 31216629499
Lieber GLS-Kunde,
`);

  assert.match(cleaned, /Hallo!/);
  assert.match(cleaned, /Wie ist bitte der Stand/);
  assert.match(cleaned, /Auf Klarna wurde auch noch nichts storniert/);
  assert.doesNotMatch(cleaned, /Von:/);
  assert.doesNotMatch(cleaned, /Lieber GLS-Kunde/);
});

test("Outlook draft cleaner cuts English wrote quote history", () => {
  const cleaned = cleanOutlookDraftReplyText(`
Can you send the replacement tracking number?
On Mon, Jun 29, 2026 at 10:41 AM Store Support wrote:
Dear Customer,
Your package was delivered.
`);

  assert.equal(cleaned, "Can you send the replacement tracking number?");
});

test("Outlook draft cleaner cuts Spanish wrote quote marketing", () => {
  const cleaned = cleanOutlookDraftReplyText(`
Me comentaron que enviarian un arbol de guayaba para plantar en maceta y resulta que me envian semillas como esta eso

El mar, 23 de jun de 2026, 3:35 p.m., Amarnis requests+amarnis.com@judge.me > escribió:
We'd love your thoughts on your recent order #1405
LIMITED 70% OFF Red-fleshed Guava
`);

  assert.match(cleaned, /Me comentaron/);
  assert.doesNotMatch(cleaned, /We'd love/);
  assert.doesNotMatch(cleaned, /LIMITED 70% OFF/);
});
