import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const readerPath = resolve(root, "sidecar/playwright-reader/reader.mjs");
const source = readFileSync(readerPath, "utf8");
const match = source.match(/const inboxSystemEventPatternSpecs = (\[[\s\S]*?\]);/);
if (!match) {
  throw new Error("inboxSystemEventPatternSpecs not found");
}

const specs = Function(`"use strict"; return ${match[1]};`)();
const patterns = specs.map((pattern) => new RegExp(pattern, "i"));
const isSystem = (value) => patterns.some((pattern) => pattern.test(String(value || "").replace(/\s+/g, " ").trim()));

const systemSamples = [
  "A new customer was added to your store (southechocorgi@aol.com).",
  "Susan Weredyk agreed to receive marketing emails.",
  "Carlos Zamora was matched to existing customer.",
  "This conversation was created because the customer used the automated order lookup option.",
  "QINYUE opened this conversation.",
  "Customer closed this conversation.",
  "2 item(s) in their cart",
  "Cart subtotal $43.96",
  "Created customer 2026-04-11",
  "Conversion history",
  "\u901a\u8fc7\u5728\u7ebf\u5546\u5e97\u53d1\u8d77\u7684\u5bf9\u8bdd"
];

const customerSamples = [
  "Does it break down tartar on teeth.",
  "My order number is #1604",
  "Is the same email address I\u2019m using to get in contact with you.",
  "Hello Randy, I need help with my shipping address.",
  "Can I receive marketing emails after I place the order?"
];

const missed = systemSamples.filter((sample) => !isSystem(sample));
const falsePositives = customerSamples.filter((sample) => isSystem(sample));

if (missed.length || falsePositives.length) {
  console.error(JSON.stringify({ missed, falsePositives }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, systemSamples: systemSamples.length, customerSamples: customerSamples.length }));
