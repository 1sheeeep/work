import test from "node:test";
import assert from "node:assert/strict";
import { isEmailRowWithinCutoff, parseEmailReceivedAt, parseEmailRowReceivedAt, shouldStopEmailScanAtRow } from "./email_time_utils.mjs";

const now = new Date("2026-06-22T10:00:00.000Z");

function localParts(value) {
  const parsed = new Date(value);
  return [
    parsed.getFullYear(),
    parsed.getMonth() + 1,
    parsed.getDate(),
    parsed.getHours(),
    parsed.getMinutes()
  ];
}

test("parses Gmail and Outlook same-day times", () => {
  assert.deepEqual(localParts(parseEmailReceivedAt("03:40", now)), [2026, 6, 22, 3, 40]);
  assert.deepEqual(localParts(parseEmailReceivedAt("Today 09:12", now)), [2026, 6, 22, 9, 12]);
  assert.deepEqual(localParts(parseEmailReceivedAt("Yesterday 22:10", now)), [2026, 6, 21, 22, 10]);
});

test("parses English and Chinese month-day dates", () => {
  assert.deepEqual(localParts(parseEmailReceivedAt("Sat 6/13", now)), [2026, 6, 13, 0, 0]);
  assert.deepEqual(localParts(parseEmailReceivedAt("周二 05-26", now)), [2026, 5, 26, 0, 0]);
  assert.deepEqual(localParts(parseEmailReceivedAt("6月18日周四 05:50", now)), [2026, 6, 18, 5, 50]);
});

test("cutoff keeps recent rows and drops old parsed rows", () => {
  const cutoff = "2026-06-15T10:00:00.000Z";
  const recent = isEmailRowWithinCutoff({ lastSeen: "6月18日" }, cutoff, now);
  assert.equal(recent.keep, true);
  assert.deepEqual(localParts(recent.receivedAt), [2026, 6, 18, 0, 0]);

  const old = isEmailRowWithinCutoff({ lastSeen: "5月26日" }, cutoff, now);
  assert.equal(old.keep, false);
  assert.deepEqual(localParts(old.receivedAt), [2026, 5, 26, 0, 0]);
});

test("cutoff drops Outlook Chinese weekday dash rows outside seven-day window", () => {
  const scanNow = new Date("2026-06-26T12:00:00+08:00");
  const cutoff = "2026-06-19T04:00:00.000Z";
  const old = isEmailRowWithinCutoff({ lastSeen: "周四 06-18" }, cutoff, scanNow);
  assert.equal(old.keep, false);
  assert.deepEqual(localParts(old.receivedAt), [2026, 6, 18, 0, 0]);

  const recent = isEmailRowWithinCutoff({ lastSeen: "昨天 23:41" }, cutoff, scanNow);
  assert.equal(recent.keep, true);
  assert.deepEqual(localParts(recent.receivedAt), [2026, 6, 25, 23, 41]);
});

test("cutoff keeps unparsable rows for downstream review", () => {
  assert.deepEqual(isEmailRowWithinCutoff({ lastSeen: "unknown" }, "2026-06-15T10:00:00.000Z", now), {
    keep: true,
    receivedAt: ""
  });
});

test("parses Outlook row dates from snippet when lastSeen is empty", () => {
  const scanNow = new Date("2026-06-29T08:30:00.000Z");
  assert.deepEqual(localParts(parseEmailReceivedAt("Apr 11 7:55 am", scanNow)), [2026, 4, 11, 7, 55]);
  assert.deepEqual(localParts(parseEmailReceivedAt("Apr 12 5:21 am", scanNow)), [2026, 4, 12, 5, 21]);
  assert.deepEqual(localParts(parseEmailReceivedAt("Thu 6/25", scanNow)), [2026, 6, 25, 0, 0]);
  assert.deepEqual(localParts(parseEmailReceivedAt("14:24", scanNow)), [2026, 6, 29, 14, 24]);

  const row = {
    sender: "Kemye",
    subject: "[Kemye] BernalEnrique 下的订单 #1579",
    snippet: "BernalEnrique 于 Apr 11 7:55 am 下了订单 #1579。 查看订单 订单摘要",
    lastSeen: "",
    lines: ["Kemye", "[Kemye] BernalEnrique 下的订单 #1579"]
  };
  assert.deepEqual(localParts(parseEmailRowReceivedAt(row, scanNow)), [2026, 4, 11, 7, 55]);
  assert.equal(shouldStopEmailScanAtRow(row, "2026-06-22T00:00:00.000Z", "outlook", scanNow), true);
  assert.equal(shouldStopEmailScanAtRow(row, "2026-06-22T00:00:00.000Z", "gmail", scanNow), false);
});

test("cutoff uses visible row time before quoted message dates", () => {
  const scanNow = new Date("2026-06-24T12:00:00.000Z");
  const cutoff = "2026-06-23T00:00:00.000Z";
  const row = {
    lastSeen: "周二 14:06",
    lines: [
      "Escuela de Radiologia",
      "A shipment from order #1259 is on the way",
      "El martes, 12 de mayo de 2026, 04:06"
    ]
  };
  const result = isEmailRowWithinCutoff(row, cutoff, scanNow);
  assert.equal(result.keep, true);
  assert.deepEqual(localParts(result.receivedAt), [2026, 6, 23, 14, 6]);
});
