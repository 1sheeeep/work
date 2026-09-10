import { chromium } from "playwright-core";
import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { connectOverCDPWithRetry } from "./cdp_connect_utils.mjs";
import * as inboxScope from "./inbox_scope.mjs";
import { isHighConfidencePreDetailIgnoredEmail, shouldKeepEmailConversation, shouldKeepEmailRow, shouldSkipPreviouslyIgnoredEmail } from "./email_filter_utils.mjs";
import { cleanOutlookDraftReplyText } from "./email_outlook_draft_utils.mjs";
import { parseEmailRowLines } from "./email_row_parse_utils.mjs";
import { emailProviderFromTarget, selectEmailTargetDescriptors, shopEmailHints } from "./email_scope_utils.mjs";
import { isEmailRowWithinCutoff, parseEmailReceivedAt } from "./email_time_utils.mjs";
import { extractOrderLinks, orderLinkFromCustomerLastOrder, parseInboxUnreadCandidateLines, profileLinesLookUsable } from "./inbox_extract_utils.mjs";

const input = JSON.parse((readFileSync(0, "utf8") || "{}").replace(/^\uFEFF/, ""));
const maxInboxDetailedItems = 60;
const inboxDetailScrollActions = 2;
const emailDetailScrollActions = 14;
const emailDetailOpenAttempts = 3;
const emailScrollPasses = 200;
const emailOldOnlyPassLimit = 3;
const emailNoProgressPassLimit = 5;
const emailVisualDebugDir = path.join(process.cwd(), "runtime", "email-visual-debug");
const emailAssetDir = path.join(process.cwd(), "runtime", "email-assets");
const emailVisualDebugLimit = 80;
let emailVisualDebugIndex = 0;
const inboxSystemEventPatternSpecs = [
  "\\b(?:a\\s+)?new customer was added to your store\\b",
  "\\bwas added to your store\\b",
  "\\b(?:agreed|opted in|subscribed|unsubscribed)\\b.*\\b(?:marketing|emails?)\\b",
  "\\bwas matched to existing customer\\b",
  "\\bThis conversation was created because\\b",
  "\\b(?:opened|closed|reopened|assigned|unassigned)\\s+this conversation\\b",
  "\\bconversation (?:started|was created)\\b",
  "\\bmessaged you from\\b",
  "\\bitem\\(s\\) in their cart\\b",
  "\\bcart subtotal\\b",
  "\\b(?:created customer|returning customer|total spend|local time|conversion history)\\b",
  "\\u901a\\u8fc7\\u5728\\u7ebf\\u5546\\u5e97\\u53d1\\u8d77\\u7684\\u5bf9\\u8bdd",
  "\\u521b\\u5efa\\u7684\\u5ba2\\u6237",
  "\\u56de\\u5934\\u5ba2",
  "\\u603b\\u652f\\u51fa",
  "\\u8f6c\\u5316\\u5386\\u53f2\\u8bb0\\u5f55",
  "\\u5f53\\u5730\\u65f6\\u95f4",
  "\\u540c\\u610f.*\\u8425\\u9500.*\\u90ae\\u4ef6"
];
const inboxSystemEventPatterns = inboxSystemEventPatternSpecs.map((source) => new RegExp(source, "i"));

function resetEmailVisualDebug() {
  emailVisualDebugIndex = 0;
  try {
    rmSync(emailVisualDebugDir, { recursive: true, force: true });
    mkdirSync(emailVisualDebugDir, { recursive: true });
  } catch {}
}

function emailDebugFilePart(value = "") {
  return String(value || "")
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42) || "email";
}

async function captureEmailVisualDebug(page, provider, row = {}, stage = "capture", extra = {}) {
  if (emailVisualDebugIndex >= emailVisualDebugLimit) return;
  const index = emailVisualDebugIndex + 1;
  emailVisualDebugIndex = index;
  const safeStage = emailDebugFilePart(stage);
  const safeSender = emailDebugFilePart(row.sender || row.subject || "row");
  const base = `${String(index).padStart(2, "0")}-${emailDebugFilePart(provider || "email")}-${safeSender}-${safeStage}`;
  const pngPath = path.join(emailVisualDebugDir, `${base}.png`);
  const jsonPath = path.join(emailVisualDebugDir, `${base}.json`);
  try {
    mkdirSync(emailVisualDebugDir, { recursive: true });
    await page.screenshot({ path: pngPath, fullPage: false, timeout: 5000 }).catch(() => {});
    const state = await page.evaluate(({ providerName, row, stage, extra }) => {
      const normalize = (value) => String(value || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
      const visible = (node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      const visibleBlocks = Array.from(document.querySelectorAll("main,article,[role='main'],[role='document'],[role='listbox'],[role='grid'],[role='option'],[role='row'],[role='listitem'],section,div,p"))
        .filter(visible)
        .map((node) => {
          const rect = node.getBoundingClientRect();
          const text = normalize(node.innerText || node.textContent || "");
          return {
            tag: node.tagName,
            role: node.getAttribute("role") || "",
            label: normalize(node.getAttribute("aria-label") || node.getAttribute("title") || ""),
            rect: { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) },
            scroll: { top: Math.round(node.scrollTop || 0), height: Math.round(node.scrollHeight || 0), client: Math.round(node.clientHeight || 0) },
            text: text.slice(0, 500)
          };
        })
        .filter((item) => item.text || item.label || item.scroll.height > item.scroll.client + 20)
        .slice(0, 140);
      const active = document.activeElement;
      const activeRect = active?.getBoundingClientRect?.();
      return {
        capturedAt: new Date().toISOString(),
        providerName,
        stage,
        extra,
        row: {
          sender: row?.sender || "",
          subject: row?.subject || "",
          snippet: row?.snippet || "",
          lastSeen: row?.lastSeen || "",
          folderLabel: row?.folderLabel || "",
          outlookConversationId: row?.outlookConversationId || ""
        },
        url: location.href,
        title: document.title,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        activeElement: active ? {
          tag: active.tagName,
          role: active.getAttribute("role") || "",
          label: normalize(active.getAttribute("aria-label") || active.getAttribute("title") || active.textContent || ""),
          rect: activeRect ? { left: Math.round(activeRect.left), top: Math.round(activeRect.top), width: Math.round(activeRect.width), height: Math.round(activeRect.height) } : null
        } : null,
        visibleBlocks
      };
    }, { providerName: provider, row, stage, extra });
    writeFileSync(jsonPath, JSON.stringify(state, null, 2), "utf8");
  } catch {}
}

installNoDirectNetworkGuard();

main(input)
  .then((data) => write({ ok: true, data }))
  .catch((error) => write({ ok: false, error: error?.message || String(error) }))
  .finally(() => process.exit(0));

async function main(request) {
  assertLocalCDP(request.cdpUrl);
  const browser = await connectOverCDPWithRetry(request.cdpUrl);
  try {
    if (request.action === "readInbox") return await readInbox(browser, request);
    if (request.action === "probeEmail") return await probeEmail(browser, request);
    throw new Error(`unknown sidecar action: ${request.action}`);
  } finally {
    if (typeof browser.disconnect === "function") {
      browser.disconnect();
    }
  }
}

function write(payload) {
  process.stdout.write(JSON.stringify(payload));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function installNoDirectNetworkGuard() {
  const assertAllowedHost = (host) => {
    if (!host || isLoopbackHost(host)) return;
    throw new Error(`blocked direct network outside configured browser session: ${host}`);
  };
  const originalFetch = globalThis.fetch?.bind(globalThis);
  if (originalFetch) {
    globalThis.fetch = (resource, init) => {
      const url = typeof resource === "string" ? resource : resource?.url;
      if (url) assertAllowedHost(hostFromURL(url));
      return originalFetch(resource, init);
    };
  }
  patchHTTPModule(http, assertAllowedHost);
  patchHTTPModule(https, assertAllowedHost);
  const originalConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function guardedSocketConnect(...args) {
    assertAllowedHost(hostFromNetArgs(args));
    return originalConnect.apply(this, args);
  };
}

function patchHTTPModule(module, assertAllowedHost) {
  const originalRequest = module.request.bind(module);
  const originalGet = module.get.bind(module);
  module.request = (...args) => {
    assertAllowedHost(hostFromHTTPArgs(args));
    return originalRequest(...args);
  };
  module.get = (...args) => {
    assertAllowedHost(hostFromHTTPArgs(args));
    return originalGet(...args);
  };
}

function hostFromHTTPArgs(args = []) {
  const first = args[0];
  const second = args[1];
  if (typeof first === "string" || first instanceof URL) return hostFromURL(first);
  if (first && typeof first === "object") return normalizeNetworkHost(first.hostname || first.host);
  if (second && typeof second === "object") return normalizeNetworkHost(second.hostname || second.host);
  return "";
}

function hostFromNetArgs(args = []) {
  const first = args[0];
  const second = args[1];
  if (first && typeof first === "object") {
    if (first.path && !first.host && !first.hostname) return "";
    return normalizeNetworkHost(first.hostname || first.host);
  }
  if (typeof second === "string") return normalizeNetworkHost(second);
  if (second && typeof second === "object") return normalizeNetworkHost(second.hostname || second.host);
  return "";
}

function hostFromURL(raw) {
  try {
    return normalizeNetworkHost(new URL(String(raw)).hostname);
  } catch {
    return "";
  }
}

function normalizeNetworkHost(host = "") {
  return String(host || "").replace(/^\[|\]$/g, "").split(":")[0].trim().toLowerCase();
}

function isLoopbackHost(host = "") {
  const value = normalizeNetworkHost(host);
  return value === "localhost" || value === "127.0.0.1" || value === "::1" || value === "0:0:0:0:0:0:0:1";
}

function assertLocalCDP(raw) {
  if (!raw) throw new Error("missing CDP endpoint");
  const parsed = new URL(raw);
  const host = (parsed.hostname || "").toLowerCase();
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) {
    throw new Error(`refusing non-local CDP endpoint: ${host}`);
  }
}

async function prepareFreshInboxRead(page, { allowReload = false } = {}) {
  await disableBrowserCache(page);
  if (allowReload && /inbox\.shopify\.com\/store\//i.test(page.url())) {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
    await waitForSettled(page).catch(() => {});
  }
}

async function disableBrowserCache(page) {
  const session = await page.context().newCDPSession(page).catch(() => null);
  if (!session) return;
  await session.send("Network.enable").catch(() => {});
  await session.send("Network.setCacheDisabled", { cacheDisabled: true }).catch(() => {});
}

async function readInbox(browser, request) {
  const resolved = await resolveInboxWorkPage(browser, request.shopName);
  let { page, anchorPage, storeSlug, unreadUrl, created } = resolved;
  let temporaryUnreadPage = null;
  if (request.activateTarget) {
    await page.bringToFront().catch(() => {});
  } else if (created && anchorPage && anchorPage !== page) {
    await anchorPage.bringToFront().catch(() => {});
  }
  try {
    if (request.forceRefresh) {
      await prepareFreshInboxRead(page, { allowReload: created });
    }
    const currentDetailConversation = isInboxUnreadDetail(page.url())
      ? await readCurrentDetailConversation(page, unreadUrl).catch(() => null)
      : null;
    try {
      await ensureUnreadList(page, storeSlug, unreadUrl, { allowNavigation: created });
    } catch (error) {
      if (created || !anchorPage || !inboxScope.canOpenTemporaryUnreadPage(page.url(), storeSlug)) throw error;
      temporaryUnreadPage = await openTemporaryUnreadInboxPage(anchorPage, unreadUrl);
      page = temporaryUnreadPage;
      created = true;
      if (request.activateTarget) await page.bringToFront().catch(() => {});
      await ensureUnreadList(page, storeSlug, unreadUrl, { allowNavigation: true });
    }
    const conversations = [];
    const warnings = [];
    const index = await captureUnreadIndex(page);
    const emptyState = Boolean(index.emptyState);
    if (!emptyState && index.rows.length === 0) {
      if (index.blueDotCount > 0) {
        warnings.push(`Inbox unread list showed ${index.blueDotCount} unread markers, but no customer rows could be parsed; needs manual check.`);
        conversations.push(inboxReviewConversationFromRow({
          customerName: "Inbox unread marker",
          preview: `${index.blueDotCount} unread marker(s) could not be parsed from the Inbox list.`,
          topic: "Inbox unread row needs manual check",
          rowKey: `unparsed-blue-dots-${index.blueDotCount}`,
          rawLines: [`${index.blueDotCount} unread marker(s) visible`, "No structured customer row parsed"]
        }, unreadUrl, index.url || page.url()));
      } else {
        throw new Error(`calibration failed: no structured unread rows found at ${index.url || page.url()}`);
      }
    }
    if (!emptyState && index.blueDotCount > index.rows.length) {
      warnings.push(`Inbox unread list showed ${index.blueDotCount} unread markers, but only ${index.rows.length} customer rows were parsed; remaining items need manual check.`);
    }
    if (index.rows.length > maxInboxDetailedItems) {
      warnings.push(`Only ${maxInboxDetailedItems} of ${index.rows.length} unread inbox rows were selected from the existing Inbox list for full detail; remaining rows were left unread for the next pass.`);
    }
    const detailedRows = index.rows.slice(0, maxInboxDetailedItems);
    for (const row of detailedRows) {
      const conversation = await readInboxConversation(page, row, unreadUrl, { allowNavigation: created });
      if (conversation) {
        conversations.push(conversation);
      } else if (row.skipReason) {
        warnings.push(`Unread row skipped: ${row.skipReason}`);
      } else {
        conversations.push(inboxReviewConversationFromRow(row, unreadUrl, page.url()));
        warnings.push(`Inbox row was left unread because its detail pane did not open or validate: ${row.customerName || row.preview || row.rowKey || "unknown"}.`);
      }
    }
    if (conversations.length === 0 && currentDetailConversation) {
      conversations.push(currentDetailConversation);
    }
    const finalConversations = dedupeInboxConversations(conversations);
    const reviewCount = finalConversations.filter((conversation) => conversation.needsReview || conversation.dataConflict || !conversation.detailLoaded).length;
    if (reviewCount) {
      warnings.push(`${reviewCount} inbox conversations need review because detail validation was incomplete.`);
    }
    return {
      storeSlug,
      url: page.url(),
      title: await page.title().catch(() => ""),
      status: warnings.length ? "partial" : "ready",
      warnings,
      diagnostics: {
        inboxUnreadIndex: {
          blueDotCount: index.blueDotCount || 0,
          rowCount: index.rows.length,
          emptyState,
          url: index.url || page.url()
        }
      },
      productCards: collectProductCards(finalConversations),
      conversations: finalConversations
    };
  } finally {
    if (temporaryUnreadPage) {
      await temporaryUnreadPage.close().catch(() => {});
      if (request.activateTarget) {
        const focusPage = anchorPage || resolved.page;
        if (focusPage && typeof focusPage.bringToFront === "function") await focusPage.bringToFront().catch(() => {});
      }
    }
  }
}

function dedupeInboxConversations(conversations = []) {
  const out = [];
  const byKey = new Map();
  for (const conversation of conversations || []) {
    const key = inboxConversationGroupKey(conversation);
    if (!key) {
      out.push(conversation);
      continue;
    }
    const existingIndex = byKey.get(key);
    if (existingIndex === undefined) {
      byKey.set(key, out.length);
      out.push(conversation);
      continue;
    }
    const existing = out[existingIndex];
    out[existingIndex] = betterInboxConversation(existing, conversation);
  }
  return out;
}

function inboxConversationGroupKey(conversation = {}) {
  const sourceUrl = String(conversation.sourceUrl || "").trim().toLowerCase().replace(/[?#].*$/, "");
  if (sourceUrl) return `url:${sourceUrl}`;
  const conversationId = String(conversation.conversationId || "").trim().toLowerCase();
  if (conversationId) return `conversation:${conversationId}`;
  return "";
}

function betterInboxConversation(left = {}, right = {}) {
  const leftScore = inboxConversationConfidenceScore(left);
  const rightScore = inboxConversationConfidenceScore(right);
  if (rightScore > leftScore) return right;
  if (leftScore > rightScore) return left;
  const leftFetched = Date.parse(left.fetchedAt || "") || 0;
  const rightFetched = Date.parse(right.fetchedAt || "") || 0;
  return rightFetched > leftFetched ? right : left;
}

function inboxConversationConfidenceScore(conversation = {}) {
  let score = 0;
  if (conversation.detailLoaded) score += 80;
  if (!conversation.needsReview) score += 70;
  if (!conversation.dataConflict) score += 50;
  if (conversation.customerEmail) score += 25;
  if (conversation.customerFullName) score += 18;
  if ((conversation.customerProfileLines || []).length) score += 14;
  if ((conversation.dataSources || []).includes("network_messages")) score += 20;
  score += Math.min(20, (conversation.messages || []).filter((message) => message?.text).length * 4);
  if (inboxDisplayTextLooksLikeReplyBody(conversation.customerName)) score -= 120;
  if (inboxDisplayTextLooksLikeReplyBody(conversation.preview)) score -= 12;
  return score;
}

function inboxReviewConversationFromRow(row = {}, unreadUrl = "", currentUrl = "") {
  const sourceUrl = row.sourceUrl || currentUrl || unreadUrl;
  const id = stableHash(["inbox-review", sourceUrl, row.customerName || "", row.preview || "", row.rowKey || ""].join("\n"));
  return {
    id,
    customerName: row.customerName || "Inbox unread row",
    customerFullName: row.customerName || "",
    customerEmail: "",
    preview: row.preview || row.topic || "Unread Inbox row needs manual check",
    topic: row.topic || row.preview || "Inbox unread row needs manual check",
    lastSeen: row.lastSeen || "",
    status: "pending",
    sendStatus: "",
    detailLoaded: false,
    source: "inbox",
    conversationId: row.conversationId || extractUnreadConversationID(sourceUrl) || "",
    sourceUrl,
    fetchedAt: new Date().toISOString(),
    rawLines: row.rawLines || [],
    messages: [],
    customerProfileLines: [],
    orderCartLines: [],
    orderLinks: [],
    productCards: [],
    dataSources: ["playwright", "unverified_inbox_row"],
    dataConflict: true,
    needsReview: true,
    detailFingerprint: ""
  };
}

function collectProductCards(conversations = []) {
  const out = [];
  const seen = new Set();
  for (const conversation of conversations || []) {
    for (const card of conversation?.productCards || []) {
      const url = String(card?.url || "").trim();
      if (!url) continue;
      const key = url.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        title: String(card?.title || "").trim(),
        url,
        imageUrl: String(card?.imageUrl || "").trim()
      });
      if (out.length >= 5) return out;
    }
  }
  return out;
}

async function resolveInboxWorkPage(browser, shopName) {
  const pages = allPages(browser);
  const anchorPage = selectShopifyPage(pages, shopName);
  if (!anchorPage) throw new Error("no Shopify page found in existing browser");
  const storeSlug = extractStoreSlug(anchorPage.url());
  if (!storeSlug) throw new Error(`current page is not a Shopify store page: ${anchorPage.url()}`);
  const unreadUrl = `https://inbox.shopify.com/store/${storeSlug}/conversations/unread`;
  const inboxPage = selectInboxWorkPage(pages, storeSlug);
  if (inboxPage) {
    return { page: inboxPage, anchorPage, storeSlug, unreadUrl, created: false };
  }
  const page = await anchorPage.context().newPage();
  return { page, anchorPage, storeSlug, unreadUrl, created: true };
}

async function openTemporaryUnreadInboxPage(anchorPage, unreadUrl) {
  const page = await anchorPage.context().newPage();
  await page.goto(unreadUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
  await waitForSettled(page).catch(() => {});
  return page;
}

async function readCurrentDetailConversation(page, unreadUrl) {
  if (!isInboxUnreadDetail(page.url())) return null;
  await waitForSettled(page);
  const row = await inferCurrentDetailRow(page);
  if (!row.customerName && !row.preview) return null;
  await waitForConversationDetailReady(page, row);
  const detail = await extractInboxDetail(page, row);
  if (!validInboxDetail(detail) && !validCurrentInboxDetail(page, detail)) return null;
  return inboxConversationFromDetail(page, row, unreadUrl, detail);
}

async function ensureUnreadList(page, storeSlug, unreadUrl, { allowNavigation = false } = {}) {
  if (!await isReadableUnreadEntry(page, storeSlug)) {
    await switchToUnreadListByUI(page, storeSlug).catch(() => false);
  }
  if (!await isReadableUnreadEntry(page, storeSlug) && allowNavigation) {
    await page.goto(unreadUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
    await waitForSettled(page).catch(() => {});
  }
  if (!await isReadableUnreadEntry(page, storeSlug)) {
    throw new Error(`could not select Shopify Inbox unread view without refreshing or URL navigation: ${page.url()}`);
  }
  await waitForUnreadListReady(page);
  if (!isReadableUnreadURL(page.url(), storeSlug)) {
    throw new Error(`could not confirm Shopify Inbox unread URL before scanning: ${page.url()}`);
  }
}

async function isReadableUnreadEntry(page, storeSlug) {
  return isReadableUnreadURL(page.url(), storeSlug);
}

function isReadableUnreadURL(url, storeSlug) {
  return inboxScope.canScanUnreadList(url, storeSlug);
}

async function switchToUnreadListByUI(page, storeSlug) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (isUnreadList(page.url(), storeSlug)) return true;
    const point = await page.evaluate((slug) => {
      const normalize = (value) => (value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
      const visible = (node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1400;
      const badText = /Make a conversation as unread|Nothing in Unread|No unread conversations|View open conversations|\u5c06\u5bf9\u8bdd\u8bbe\u4e3a\u672a\u8bfb|\u6ca1\u6709\u672a\u8bfb|\u67e5\u770b\u8fdb\u884c\u4e2d\u7684\u5bf9\u8bdd/i;
      const unreadPath = new RegExp(`/store/${String(slug).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/conversations/unread(?:[?#]|$)`, "i");
      const candidates = Array.from(document.querySelectorAll("a[href],button,[role='button'],[role='link']"))
        .filter(visible)
        .map((node) => {
          const rect = node.getBoundingClientRect();
          const text = normalize(node.innerText || node.textContent || node.getAttribute("aria-label") || "");
          const href = node.href || node.getAttribute("href") || "";
          return { node, rect, text, href };
        })
        .filter((item) => !badText.test(item.text));

      const hrefMatch = candidates
        .filter((item) => unreadPath.test(item.href))
        .sort((a, b) => a.rect.left - b.rect.left || a.rect.top - b.rect.top)[0];
      if (hrefMatch) {
        hrefMatch.node.scrollIntoView({ block: "center", inline: "nearest" });
        const rect = hrefMatch.node.getBoundingClientRect();
        return { x: rect.left + Math.max(8, Math.min(rect.width - 8, rect.width * 0.5)), y: rect.top + Math.max(8, Math.min(rect.height - 8, rect.height * 0.5)) };
      }

      const navRight = Math.max(260, Math.round(viewportWidth * 0.20));
      const textMatch = candidates
        .filter((item) => item.rect.left <= navRight)
        .filter((item) => {
          const lines = item.text.split(/\n+/).map(normalize).filter(Boolean);
          return lines.some((line) => /^(Unread|\u672a\u8bfb)(?:\s*\d+)?$/i.test(line));
        })
        .sort((a, b) => a.rect.left - b.rect.left || a.rect.top - b.rect.top)[0];
      if (textMatch) {
        textMatch.node.scrollIntoView({ block: "center", inline: "nearest" });
        const rect = textMatch.node.getBoundingClientRect();
        return { x: rect.left + Math.max(8, Math.min(rect.width - 8, rect.width * 0.5)), y: rect.top + Math.max(8, Math.min(rect.height - 8, rect.height * 0.5)) };
      }
      return null;
    }, storeSlug).catch(() => false);
    if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
      await page.mouse.click(point.x, point.y).catch(() => {});
      await page.waitForTimeout(900 + attempt * 250);
      if (isUnreadList(page.url(), storeSlug)) return true;
      const ready = await page.evaluate(() => {
        const normalize = (value) => (value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
        const visible = (node) => {
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
        };
        const isSelected = (node) => node.getAttribute("aria-current") === "page" ||
          node.getAttribute("aria-selected") === "true" ||
          node.getAttribute("aria-pressed") === "true" ||
          node.dataset?.selected === "true" ||
          /\b(active|selected|current)\b/i.test(node.className || "");
        const selectedUnread = Array.from(document.querySelectorAll("a[href],button,[role='button'],[role='link']"))
          .filter(visible)
          .some((node) => isSelected(node) && normalize(node.innerText || node.textContent || node.getAttribute("aria-label") || "").split(/\n+/).some((line) => /^(Unread|\u672a\u8bfb)(?:\s*\d+)?$/i.test(normalize(line))));
        return selectedUnread && !document.querySelector("[aria-busy='true'], [role='progressbar']");
      }).catch(() => false);
      if (ready && isUnreadList(page.url(), storeSlug)) return true;
      if (await hasReadableUnreadInboxState(page)) return true;
    }
    await page.waitForTimeout(300 + attempt * 150);
  }
  return isUnreadList(page.url(), storeSlug);
}

async function hasReadableUnreadInboxState(page) {
  if (!isUnreadList(page.url(), extractStoreSlug(page.url()))) return false;
  await resetUnreadListScroll(page).catch(() => {});
  const result = await page.evaluate(captureUnreadIndexScript).catch(() => null);
  return Boolean(result?.emptyState || result?.rows?.length || result?.blueDotCount);
}

async function hasSelectedUnreadFilter(page) {
  return await page.evaluate(() => {
    const normalize = (value) => (value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const isSelected = (node) => node.getAttribute("aria-current") === "page" ||
      node.getAttribute("aria-selected") === "true" ||
      node.getAttribute("aria-pressed") === "true" ||
      node.dataset?.selected === "true" ||
      /\b(active|selected|current)\b/i.test(node.className || "");
    return Array.from(document.querySelectorAll("a[href],button,[role='button'],[role='link']"))
      .filter(visible)
      .some((node) => isSelected(node) && normalize(node.innerText || node.textContent || node.getAttribute("aria-label") || "").split(/\n+/).some((line) => /^(Unread|\u672a\u8bfb)(?:\s*\d+)?$/i.test(normalize(line))));
  }).catch(() => false);
}

async function inferCurrentDetailRow(page) {
  return await page.evaluate(() => {
    const normalize = (value) => (value || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const firstEmail = (value) => String(value || "").match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i)?.[0] || "";
    const lowSignalLine = (line) => /^(Yesterday|Today|昨天|今天|\d+\s*月\s*\d*|\d{1,2}:\d{2}|Inbox|Done|完成|复核|Open|Unread|Closed|Product interest|Order status|Shipping|Checkout|Store info|Internet 已连接)$/i.test(line || "");
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1400;
    const detailLeft = detectDetailColumnLeft();
    const sidePanelLeft = Math.round(viewportWidth * 0.82);
    const bodyText = document.body?.innerText || "";
    let customerName = "";
    let customerEmail = "";
    let selectedPreview = "";
    const topicNode = Array.from(document.querySelectorAll("[data-testid='conversationTopic'],[aria-label='\u5bf9\u8bdd\u4e3b\u9898']"))
      .filter(visible)
      .map((node) => normalize(node.innerText || node.textContent || ""))
      .find((text) => text && text.length <= 120);
    if (topicNode) customerName = topicNode;
    const selectedRows = Array.from(document.querySelectorAll("[aria-selected='true'],[aria-current='true'],button,[role='button']"))
      .filter(visible)
      .map((node) => ({ rect: node.getBoundingClientRect(), text: normalize(node.innerText || node.textContent || "") }))
      .filter((item) => item.rect.left < detailLeft && item.rect.top > 45 && item.rect.width > 180 && item.rect.height > 38 && item.text.length > 3)
      .sort((a, b) => Number(/\b(Inbox|完成|复核|Done)\b/i.test(b.text)) - Number(/\b(Inbox|完成|复核|Done)\b/i.test(a.text)) || b.rect.width * b.rect.height - a.rect.width * a.rect.height);
    for (const item of selectedRows) {
      if (customerName) break;
      const lines = item.text.split(/\n+/).map(normalize).filter(Boolean);
      const first = lines.find((line) => line && !lowSignalLine(line));
      if (first) {
        customerName = first;
        selectedPreview = lines.slice(lines.indexOf(first) + 1).find((line) => line && line !== first && !lowSignalLine(line)) || "";
        break;
      }
    }
    const profilePanels = Array.from(document.querySelectorAll("aside,section,div"))
      .filter(visible)
      .map((node) => ({ rect: node.getBoundingClientRect(), text: node.innerText || node.textContent || "" }))
      .filter((item) => item.rect.left > sidePanelLeft - 80 && item.rect.width >= 160 && item.rect.height >= 80 && /@|Customer|Profile|客户|资料|order|订单|#\d+/i.test(item.text))
      .sort((a, b) => b.rect.height * b.rect.width - a.rect.height * a.rect.width);
    if (profilePanels.length) {
      const lines = profilePanels[0].text.split(/\n+/).map(normalize).filter(Boolean);
      customerEmail = firstEmail(lines.join(" "));
      if (!customerName) {
        customerName = lines.find((line) => line && !line.includes("@") && !/^(Customer|Profile|客户|资料|订单|Order|Product recommendations?|处理状态)$/i.test(line) && line.length <= 80) || customerEmail;
      }
    }
    if (!customerEmail) customerEmail = firstEmail(bodyText);
    if (!customerName) customerName = customerEmail;
    const messageLines = bodyText.split(/\n+/).map(normalize).filter(Boolean);
    const preview = selectedPreview || messageLines.find((line) => line !== customerName && line !== customerEmail && line.length >= 3 && line.length <= 240 && !lowSignalLine(line) && !/^(Customer|Profile|客户|资料|订单|Product recommendations?|AI|发送|显示中文)$/i.test(line)) || "";
    return {
      customerName,
      preview,
      topic: "",
      lastSeen: "",
      sourceUrl: location.href,
      conversationId: String(location.href).match(/\/conversations\/(?:unread|open|closed)\/([^/?#]+)/i)?.[1] || "",
      rowKey: `${customerName}|${preview}`.toLowerCase().replace(/\s+/g, " ").trim()
    };

    function detectDetailColumnLeft() {
      const dividers = Array.from(document.querySelectorAll("[aria-label='divider'],[data-testid='divider'],div")).filter(visible)
        .map((node) => node.getBoundingClientRect())
        .filter((rect) => rect.left > 480 && rect.left < viewportWidth * 0.55 && rect.width <= 6 && rect.height > 250)
        .sort((a, b) => a.left - b.left);
      return Math.round((dividers[0]?.right || Math.max(560, Math.round(viewportWidth * 0.32))) + 1);
    }
  }).catch(() => ({ customerName: "", preview: "", topic: "", lastSeen: "", sourceUrl: page.url(), conversationId: extractConversationID(page.url()) }));
}

async function captureUnreadIndex(page) {
  await resetUnreadListScroll(page);
  const merged = new Map();
  let bestMeta = { blueDotCount: 0, emptyState: false, url: page.url(), title: "" };
  let stableSignature = "";
  let stableCount = 0;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const snapshot = await page.evaluate(captureUnreadIndexScript, { parseInboxUnreadCandidateLinesSource: parseInboxUnreadCandidateLines.toString() });
    bestMeta = {
      blueDotCount: Math.max(bestMeta.blueDotCount || 0, snapshot.blueDotCount || 0),
      emptyState: Boolean(snapshot.emptyState),
      url: snapshot.url || bestMeta.url,
      title: snapshot.title || bestMeta.title,
      bodySample: snapshot.bodySample || bestMeta.bodySample || ""
    };
    for (const row of snapshot.rows || []) {
      const key = unreadIndexRowKey(row);
      if (!merged.has(key)) merged.set(key, row);
      else merged.set(key, betterUnreadIndexRow(merged.get(key), row));
    }
    const rows = Array.from(merged.values());
    const signature = rows.map((row) => unreadIndexRowKey(row)).join("||");
    if (signature === stableSignature) stableCount += 1;
    else {
      stableSignature = signature;
      stableCount = 1;
    }
    if (snapshot.emptyState) return { ...bestMeta, rows: [], blueDotCount: snapshot.blueDotCount || 0 };
    const moved = await scrollUnreadList(page);
    if (!moved && stableCount >= 2) return { ...bestMeta, rows, blueDotCount: bestMeta.blueDotCount || snapshot.blueDotCount || 0 };
  }
  return { ...bestMeta, rows: Array.from(merged.values()) };
}

function rowFingerprint(row) {
  return `${row.customerName || ""}|${row.preview || ""}|${row.topic || ""}|${row.lastSeen || ""}`.toLowerCase().replace(/\s+/g, " ").trim();
}

function unreadIndexRowKey(row = {}) {
  const sourceUrl = String(row.sourceUrl || "").trim().toLowerCase().replace(/[?#].*$/, "");
  if (sourceUrl) return `url:${sourceUrl}`;
  const conversationId = String(row.conversationId || "").trim().toLowerCase();
  if (conversationId) return `conversation:${conversationId}`;
  return row.rowKey || rowFingerprint(row);
}

function betterUnreadIndexRow(left = {}, right = {}) {
  const leftScore = unreadIndexRowScore(left);
  const rightScore = unreadIndexRowScore(right);
  if (rightScore > leftScore) return right;
  return left;
}

function unreadIndexRowScore(row = {}) {
  let score = 0;
  if (row.hasBlueDot) score += 40;
  if (row.sourceUrl) score += 20;
  if (row.customerName && !inboxDisplayTextLooksLikeReplyBody(row.customerName)) score += 30;
  if (row.preview && !inboxDisplayTextLooksLikeReplyBody(row.preview)) score += 10;
  const nameLength = String(row.customerName || "").trim().length;
  if (nameLength > 0 && nameLength <= 48) score += 8;
  if (inboxDisplayTextLooksLikeReplyBody(row.customerName)) score -= 80;
  if (inboxDisplayTextLooksLikeReplyBody(row.preview)) score -= 12;
  return score;
}

async function waitForUnreadListReady(page) {
  await waitForSettled(page);
  let previous = "";
  let stableCount = 0;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const state = await page.evaluate(() => {
      const normalize = (value) => (value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
      const text = normalize(document.body?.innerText || "");
      const busy = Boolean(document.querySelector("[aria-busy='true'], [role='progressbar']"));
      const visible = (node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      const isSelected = (node) => node.getAttribute("aria-current") === "page" ||
        node.getAttribute("aria-selected") === "true" ||
        node.getAttribute("aria-pressed") === "true" ||
        node.dataset?.selected === "true" ||
        /\b(active|selected|current)\b/i.test(node.className || "");
      const selectedUnread = Array.from(document.querySelectorAll("a[href],button,[role='button'],[role='link']"))
        .filter(visible)
        .some((node) => isSelected(node) && normalize(node.innerText || node.textContent || node.getAttribute("aria-label") || "").split(/\n+/).some((line) => /^(Unread|\u672a\u8bfb)(?:\s*\d+)?$/i.test(normalize(line))));
      const hasUnreadContext = selectedUnread || /\/conversations\/unread(?:[?#]|$)/i.test(location.href);
      const emptyState = /Nothing in Unread|No unread conversations|\u6ca1\u6709\u672a\u8bfb/i.test(text);
      return { key: `${location.href}|${text.slice(0, 1800)}`, busy, hasUnreadContext, emptyState, textLength: text.length };
    });
    if (state.hasUnreadContext && !state.busy && (state.emptyState || state.textLength > 80)) {
      if (state.key === previous) {
        stableCount += 1;
        if (stableCount >= 2) return;
      } else {
        previous = state.key;
        stableCount = 1;
      }
    }
    await page.waitForTimeout(300 + attempt * 60);
  }
}

function captureUnreadIndexScript({ parseInboxUnreadCandidateLinesSource } = {}) {
  const parseInboxUnreadCandidateLines = parseInboxUnreadCandidateLinesSource
    ? (0, eval)(`(${parseInboxUnreadCandidateLinesSource})`)
    : null;
  const strictNormalize = (value) => (value || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
  const strictVisible = (node) => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  };
  const strictViewportWidth = window.innerWidth || document.documentElement.clientWidth || 1400;
  const strictViewportHeight = window.innerHeight || document.documentElement.clientHeight || 900;
  const strictListLeft = Math.max(230, Math.round(strictViewportWidth * 0.12));
  const strictListRight = Math.min(Math.round(strictViewportWidth * 0.42), strictListLeft + 460);
  const strictListTop = 45;
  const strictBodyText = document.body?.innerText || "";
  const strictEmptyState = /Nothing in Unread|No unread conversations|View open conversations|\u6ca1\u6709\u672a\u8bfb\u5bf9\u8bdd|\u6ca1\u6709\u672a\u8bfb|\u67e5\u770b\u8fdb\u884c\u4e2d\u7684\u5bf9\u8bdd/i.test(strictBodyText);
  const strictBlueDot = (node) => {
    if (!strictVisible(node)) return false;
    const rect = node.getBoundingClientRect();
    if (rect.width < 3 || rect.width > 18 || rect.height < 3 || rect.height > 18) return false;
    const style = getComputedStyle(node);
    const color = `${style.backgroundColor} ${style.color} ${style.borderColor}`.toLowerCase();
    return color.includes("rgb(0, 91, 211)") || color.includes("rgb(0, 102, 204)") || color.includes("rgb(0, 122, 255)") || color.includes("rgb(37, 99, 235)") || color.includes("#005bd3") || color.includes("#0066cc");
  };
  const strictBlueDots = Array.from(document.querySelectorAll("*")).filter(strictBlueDot).filter((dot) => {
    const rect = dot.getBoundingClientRect();
    return rect.top > strictListTop && rect.left >= strictListLeft - 40 && rect.left <= strictListRight + 40;
  });
  const strictRows = [];
  const strictSeenNodes = new Set();
  const rowNodes = Array.from(document.querySelectorAll("button,a[href],[role='button'],[role='link'],[role='listitem'],[role='option'],[role='row'],[tabindex],div"))
    .filter(strictVisible)
    .map((node) => {
      const rect = node.getBoundingClientRect();
      const role = `${node.getAttribute("role") || ""} ${node.tagName || ""} ${node.className || ""}`.toLowerCase();
      const clickable = node.tagName === "BUTTON" || node.tagName === "A" || /button|link|listitem|option|row/.test(role) || node.getAttribute("tabindex") !== null || typeof node.onclick === "function";
      const text = strictNormalize(node.innerText || node.textContent || "");
      const area = rect.width * rect.height;
      const semanticScore = clickable ? 1000 : 0;
      return { node, rect, text, clickable, score: semanticScore - Math.min(area / 4000, 600) - Math.min(text.length, 600) };
    })
    .filter((item) => item.rect.top >= strictListTop && item.rect.top <= strictViewportHeight - 20)
    .filter((item) => item.rect.left >= strictListLeft - 16 && item.rect.right <= strictListRight + 48)
    .filter((item) => item.rect.width >= 180 && item.rect.width <= 560 && item.rect.height >= 30 && item.rect.height <= 260)
    .filter((item) => item.text.length >= 5 && item.text.length <= 2600)
    .filter((item) => !/Nothing in Unread|No unread conversations|View open conversations|Make a conversation as unread|\u6ca1\u6709\u672a\u8bfb|\u67e5\u770b\u8fdb\u884c\u4e2d\u7684\u5bf9\u8bdd|\u5c06\u5bf9\u8bdd\u8bbe\u4e3a\u672a\u8bfb/i.test(item.text))
    .sort((a, b) => b.score - a.score || a.rect.top - b.rect.top || a.rect.left - b.rect.left);
  for (const { node, rect, text } of rowNodes) {
    if (strictSeenNodes.has(node)) continue;
    strictSeenNodes.add(node);
    const rawLines = text.split(/\n+/).map(strictNormalize).filter(Boolean);
    const parsed = parseInboxUnreadCandidateLines ? parseInboxUnreadCandidateLines(rawLines) : null;
    if (!parsed) continue;
    const linkNode = node.closest("a[href]") || node.querySelector("a[href]");
    const sourceUrl = linkNode ? linkNode.href : "";
    if (/\/conversations\/(?:open|closed)\/[^/?#]+/i.test(sourceUrl)) continue;
    const hasBlueDot = strictBlueDots.some((dot) => {
      const dotRect = dot.getBoundingClientRect();
      return dotRect.left >= rect.left - 12 && dotRect.right <= rect.right + 12 && dotRect.top >= rect.top - 4 && dotRect.bottom <= rect.bottom + 4;
    });
    strictRows.push({
      customerName: parsed.customerName,
      preview: parsed.preview,
      topic: parsed.topic || "",
      lastSeen: parsed.lastSeen || "",
      sourceUrl,
      rawLines: parsed.rawLines || rawLines.slice(0, 18),
      clickX: rect.left + Math.min(Math.max(rect.width * 0.45, 24), rect.width - 8),
      clickY: rect.top + Math.min(Math.max(rect.height * 0.5, 12), rect.height - 8),
      listTop: rect.top,
      left: rect.left,
      rowKey: `${parsed.customerName}|${parsed.preview}|${parsed.topic || ""}|${parsed.lastSeen || ""}`.toLowerCase().replace(/\s+/g, " ").trim(),
      hasBlueDot,
      reason: node.tagName === "BUTTON" || node.getAttribute("role") === "button" ? "strict-list-button" : "fallback-list-node"
    });
  }
  const strictSeenRows = new Set();
  const strictOut = [];
  const rowsWithDots = strictRows.filter((item) => item.hasBlueDot);
  const fallbackRows = strictBlueDots.flatMap((dot) => {
    const dotRect = dot.getBoundingClientRect();
    if (rowsWithDots.some((row) => dotRect.top >= row.listTop - 4 && dotRect.top <= row.listTop + 260 && dotRect.left >= row.left - 12)) return [];
    return strictRows
      .filter((row) => Math.abs(row.listTop - dotRect.top) <= 42 || row.listTop <= dotRect.top && row.listTop + 260 >= dotRect.top)
      .sort((a, b) => Math.abs(a.listTop - dotRect.top) - Math.abs(b.listTop - dotRect.top))
      .slice(0, 1)
      .map((row) => ({ ...row, hasBlueDot: true, reason: `${row.reason}:blue-dot-nearby` }));
  });
  for (const row of [...rowsWithDots, ...fallbackRows].sort((a, b) => a.listTop - b.listTop || a.left - b.left)) {
    const seenKey = row.sourceUrl
      ? `url:${String(row.sourceUrl).toLowerCase().replace(/[?#].*$/, "")}`
      : row.rowKey;
    if (strictSeenRows.has(seenKey)) continue;
    strictSeenRows.add(seenKey);
    strictOut.push(row);
  }
  return {
    rows: strictOut.slice(0, 200),
    blueDotCount: strictBlueDots.length,
    emptyState: strictEmptyState,
    url: location.href,
    title: document.title,
    bodySample: strictNormalize(strictBodyText).slice(0, 1000)
  };
}

async function resetUnreadListScroll(page) {
  await page.evaluate(scrollInboxListInPage, "reset").catch(() => false);
  await page.waitForTimeout(450);
}

async function scrollUnreadList(page) {
  const moved = await page.evaluate(scrollInboxListInPage, "down").catch(() => false);
  await page.waitForTimeout(650);
  return Boolean(moved);
}

function scrollInboxListInPage(mode) {
  const visible = (node) => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  };
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1400;
  const listLeft = Math.max(230, Math.round(viewportWidth * 0.12));
  const listRight = Math.min(Math.round(viewportWidth * 0.42), listLeft + 460);
  const scroller = Array.from(document.querySelectorAll("main,section,aside,div")).filter(visible)
    .filter((node) => node.scrollHeight > node.clientHeight + 24)
    .map((node) => ({ node, rect: node.getBoundingClientRect(), text: node.innerText || "" }))
    .filter((item) => item.rect.left < listRight && item.rect.right > listLeft && item.rect.top < 260 && item.rect.height > 160 && /Unread|未读|Open|进行中/i.test(item.text))
    .sort((a, b) => (b.node.scrollHeight - b.node.clientHeight) - (a.node.scrollHeight - a.node.clientHeight))[0]?.node;
  if (!scroller) return false;
  const before = scroller.scrollTop;
  if (mode === "reset") {
    scroller.scrollTop = 0;
  } else {
    const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    scroller.scrollTop = Math.min(maxTop, before + Math.max(280, Math.round(scroller.clientHeight * 0.75)));
  }
  scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
  return mode === "reset" ? before > 4 : scroller.scrollTop > before + 4;
}

async function readInboxConversation(page, row, unreadUrl, { allowNavigation = false } = {}) {
  if (!inboxScope.shouldKeepUnreadIndexURL(row?.sourceUrl || "")) {
    row.skipReason = `non-unread Inbox row link: ${shortLinkLabel(row.sourceUrl)}`;
    return null;
  }
  let lastDetail = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const networkCapture = startInboxNetworkCapture(page);
    let networkRecords = [];
    try {
      await openInboxRow(page, row);
      if (isInboxNonUnreadDetail(page.url())) {
        row.skipReason = `opened non-unread Inbox detail: ${shortLinkLabel(page.url())}`;
        networkRecords = await networkCapture.stop();
        await returnToUnreadList(page, unreadUrl, { allowNavigation });
        continue;
      }
      const ready = await waitForConversationDetailReady(page, row);
      if (!ready) {
        networkRecords = await networkCapture.stop();
        await page.waitForTimeout(450 + attempt * 350);
        continue;
      }
      if (!extractUnreadConversationID(page.url()) && await looksLikeEmptyInboxDetail(page)) {
        networkRecords = await networkCapture.stop();
        await page.waitForTimeout(450 + attempt * 350);
        continue;
      }
      const detail = await extractInboxDetail(page, row);
      await page.waitForTimeout(550);
      const probedOrderLinks = await probeInboxOrderCardLinks(page).catch(() => []);
      if (probedOrderLinks.length) {
        detail.orderLinks = mergeLinks(probedOrderLinks, detail.orderLinks || []);
      }
      networkRecords = await networkCapture.stop();
      const browserTimeZone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "").catch(() => "");
      applyInboxNetworkDetail(detail, networkRecords, {
        ...row,
        conversationId: extractUnreadConversationID(page.url()) || row.conversationId || "",
        sourceUrl: page.url() || unreadUrl,
        timeZone: browserTimeZone
      });
      lastDetail = detail;
      if (validInboxDetail(detail)) {
        return inboxConversationFromDetail(page, row, unreadUrl, detail);
      }
    } finally {
      if (!networkCapture.stopped) await networkCapture.stop();
    }
    await page.waitForTimeout(450 + attempt * 350);
  }
  if (
    lastDetail &&
    Array.isArray(lastDetail.messages) &&
    lastDetail.messages.length > 0
  ) {
    const safeDetail = { ...lastDetail };
    return inboxConversationFromDetail(page, row, unreadUrl, safeDetail);
  }
  return null;
}

async function returnToUnreadList(page, unreadUrl, { allowNavigation = false } = {}) {
  const slug = extractStoreSlug(unreadUrl);
  if (!isUnreadList(page.url(), slug)) {
    await switchToUnreadListByUI(page, slug).catch(() => false);
  }
  if (!isUnreadList(page.url(), slug) && allowNavigation) {
    await page.goto(unreadUrl, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
  }
  if (isUnreadList(page.url(), slug)) {
    await waitForUnreadListReady(page).catch(() => {});
  }
}

async function probeInboxOrderCardLinks(page) {
  const candidates = await page.evaluate(() => {
    const normalize = (value) => String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1400;
    return Array.from(document.querySelectorAll("button,[role='button']"))
      .filter(visible)
      .map((node) => {
        const rect = node.getBoundingClientRect();
        const text = normalize(node.innerText || node.textContent || node.getAttribute("aria-label") || "");
        return {
          text,
          testId: node.getAttribute("data-testid") || "",
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height
        };
      })
      .filter((item) => item.left > Math.max(760, viewportWidth * 0.70))
      .filter((item) => item.width >= 80 && item.width <= 420 && item.height >= 34 && item.height <= 180)
      .filter((item) => /#\s*\d{2,20}/.test(item.text) && /(?:paid|fulfilled|refunded|online store|pending|awaiting|shipped|delivered|\$|usd|pyg|eur|gbp|\u5df2\u4ed8\u6b3e|\u5df2\u53d1\u8d27|\u6765\u81ea)/i.test(item.text))
      .sort((a, b) => Number(b.testId === "resourceListItemButton") - Number(a.testId === "resourceListItemButton") || a.top - b.top || b.width * b.height - a.width * a.height)
      .slice(0, 2);
  }).catch(() => []);
  const out = [];
  const seen = new Set();
  for (const candidate of candidates || []) {
    const beforePages = new Set(page.context().pages());
    const beforeURL = page.url();
    const popupPromise = page.context().waitForEvent("page", { timeout: 4000 }).catch(() => null);
    await page.mouse.click(candidate.x, candidate.y).catch(() => {});
    const popup = await popupPromise;
    await page.waitForTimeout(800);
    const openedPages = page.context().pages().filter((item) => !beforePages.has(item));
    const urls = [
      popup?.url() || "",
      ...openedPages.map((item) => item.url()),
      page.url() !== beforeURL ? page.url() : ""
    ].filter(Boolean);
    const orderURL = urls.find((url) => /admin\.shopify\.com\/store\/[^/]+\/orders\/\d+/i.test(url));
    for (const opened of openedPages) {
      if (/admin\.shopify\.com\/store\/[^/]+\/orders\/\d+/i.test(opened.url())) {
        await opened.close().catch(() => {});
      }
    }
    if (page.url() !== beforeURL && /admin\.shopify\.com\/store\/[^/]+\/orders\/\d+/i.test(page.url())) {
      await page.goBack({ waitUntil: "domcontentloaded", timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(600);
    }
    await page.bringToFront().catch(() => {});
    if (!orderURL) continue;
    if (seen.has(orderURL)) continue;
    seen.add(orderURL);
    const orderNumber = firstOrderNumber(candidate.text);
    out.push({ label: orderNumber ? `Order #${orderNumber}` : shortLinkLabel(orderURL), url: orderURL, kind: "order" });
  }
  return out;
}

function startInboxNetworkCapture(page) {
  const records = [];
  const pending = [];
  let stopped = false;
  const handler = (response) => {
    const url = response.url();
    const contentType = response.headers()["content-type"] || "";
    if (!inboxNetworkResponseIsRelevant(url, contentType)) return;
    pending.push((async () => {
      try {
        const body = await response.text();
        if (!body || body.length > 500000) return;
        records.push({ url, contentType, status: response.status(), body });
      } catch {
        // Response bodies can be unavailable for cached or streaming entries.
      }
    })());
  };
  page.on("response", handler);
  return {
    get stopped() {
      return stopped;
    },
    async stop() {
      if (stopped) return records;
      stopped = true;
      page.off("response", handler);
      await Promise.allSettled(pending);
      return records;
    }
  };
}

function inboxNetworkResponseIsRelevant(url, contentType) {
  const haystack = `${url || ""} ${contentType || ""}`.toLowerCase();
  if (haystack.includes("image/") || haystack.includes("font") || haystack.includes("stylesheet")) return false;
  if (!/json|graphql|conversation|message|inbox|shopify/i.test(haystack)) return false;
  return /operation=(UpdateConversationGetMessages|ConversationHistory|ConversationHistoryMessages|Customer)\b/i.test(url || "")
    || /admin\/api\/messaging\/unstable\/graphql|admin\/api\/unversioned\/graphql/i.test(url || "");
}

function applyInboxNetworkDetail(detail, records, target) {
  const messages = extractInboxNetworkMessages(records, target);
  if (messages.length) {
    detail.messages = messages;
    detail.verified = true;
    detail.networkVerified = true;
  }
  const profile = extractInboxNetworkProfile(records, target);
  if (profile.lines.length) {
    detail.profileLines = dedupe([...(detail.profileLines || []), ...profile.lines]).slice(0, 48);
  }
  if (profile.email && !detail.customerEmail) detail.customerEmail = profile.email;
  if (profile.name && !detail.customerFullName) detail.customerFullName = profile.name;
  if (profile.orderLines.length) {
    detail.orderCartLines = dedupe([...(detail.orderCartLines || []), ...profile.orderLines]);
  }
  if (profile.orderLinks.length) {
    detail.orderLinks = mergeLinks(detail.orderLinks || [], profile.orderLinks);
  }
}

function extractInboxNetworkMessages(records, target) {
  const conversationId = String(target?.conversationId || "").toLowerCase();
  const preferred = [];
  const fallback = [];
  for (const record of records || []) {
    if (!/operation=(UpdateConversationGetMessages|ConversationHistory)\b/i.test(record.url || "")) continue;
    if (conversationId && !String(record.body || "").toLowerCase().includes(conversationId)) continue;
    const parsed = parseJSONSafe(record.body);
    if (!parsed) continue;
    const messages = collectNetworkMessageObjects(parsed);
    if (!messages.length) continue;
    if (/operation=UpdateConversationGetMessages\b/i.test(record.url || "")) preferred.push(...messages);
    else fallback.push(...messages);
  }
  return normalizeNetworkMessages(preferred.length ? preferred : fallback, target);
}

function collectNetworkMessageObjects(value, out = [], depth = 0) {
  if (!value || depth > 12) return out;
  if (Array.isArray(value)) {
    for (const item of value) collectNetworkMessageObjects(item, out, depth + 1);
    return out;
  }
  if (typeof value !== "object") return out;
  const typename = String(value.__typename || "");
  const text = typeof value.content?.text === "string" ? value.content.text : "";
  if (text && /Message$/i.test(typename)) {
    out.push({
      id: String(value.id || ""),
      typename,
      text,
      sentAt: String(value.sentAt || value.createdAt || ""),
      delivery: String(value.delivery?.code || ""),
      senderName: String(value.sender?.name || ""),
      senderType: String(value.sender?.__typename || "")
    });
  }
  for (const item of Object.values(value)) collectNetworkMessageObjects(item, out, depth + 1);
  return out;
}

function normalizeNetworkMessages(items, target) {
  const targetText = `${target?.customerName || ""} ${target?.preview || ""}`.toLowerCase();
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    const text = cleanNetworkMessageText(item.text);
    if (!text || inboxNetworkSystemText(text)) continue;
    const key = `${item.id || ""}|${item.sentAt || ""}|${text}`.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      role: networkMessageRole(item, targetText),
      text,
      time: networkTimeLabel(item.sentAt, target?.timeZone || ""),
      sentAt: item.sentAt || ""
    });
  }
  out.sort((a, b) => {
    const at = Date.parse(a.sentAt || "");
    const bt = Date.parse(b.sentAt || "");
    if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return at - bt;
    return 0;
  });
  return out.map(({ sentAt, ...message }) => message).slice(0, 180);
}

function assetStableKey(asset = {}) {
  const source = String(asset.source || "").trim().toLowerCase();
  const messageId = String(asset.messageId || "").trim().toLowerCase();
  const url = String(asset.url || "").trim().toLowerCase();
  const pathKey = String(asset.path || "").replace(/\\/g, "/").split("/").pop()?.toLowerCase() || "";
  const dimensions = `${Number(asset.width || 0)}x${Number(asset.height || 0)}`;
  if (url) return `${source}|${messageId}|${url}|${dimensions}`;
  return `${source}|${messageId}|${pathKey}|${dimensions}`;
}

function dedupeMessageAssets(assets = []) {
  const out = [];
  const seen = new Set();
  for (const asset of Array.isArray(assets) ? assets : []) {
    if (!asset) continue;
    const key = assetStableKey(asset);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(asset);
  }
  return out;
}

function cleanNetworkMessageText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .split(/\n+/)
    .map((line) => line.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function inboxNetworkSystemText(text) {
  const value = String(text || "").trim();
  return inboxSystemEventText(value);
}

function inboxSystemEventText(text) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value) return false;
  return inboxSystemEventPatterns.some((pattern) => pattern.test(value));
}

function networkMessageRole(item, targetText) {
  const sender = String(item.senderName || "").toLowerCase();
  const senderType = String(item.senderType || "").toLowerCase();
  if (/CustomerChannelBuyer/i.test(item.senderType || "")) return "customer";
  if (sender && targetText && targetText.includes(sender)) return "customer";
  if (/AutomatedMessage/i.test(item.typename || "")) return "store";
  if (/FacilitatedMessage/i.test(item.typename || "")) return "customer";
  if (String(item.delivery || "").toUpperCase() === "SENT" && sender && !/shopify|admin|staff|support/i.test(senderType)) return "customer";
  return "store";
}

function networkTimeLabel(sentAt, timeZone) {
  const date = new Date(sentAt || "");
  if (!Number.isFinite(date.getTime())) return "";
  if (timeZone) {
    try {
      return new Intl.DateTimeFormat("zh-CN", {
        timeZone,
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true
      }).format(date);
    } catch {
      // Fall through to a deterministic UTC label if the browser reports an unusual timezone.
    }
  }
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}

function extractInboxNetworkProfile(records, target = {}) {
  const out = { lines: [], orderLines: [], orderLinks: [], email: "", name: "" };
  const storeSlug = extractStoreSlug(target?.sourceUrl || "");
  for (const record of records || []) {
    if (!/operation=Customer\b/i.test(record.url || "")) continue;
    const parsed = parseJSONSafe(record.body);
    const customer = parsed?.data?.customer;
    if (!customer || typeof customer !== "object") continue;
    if (customer.displayName) {
      out.name = String(customer.displayName);
      out.lines.push(out.name);
    }
    if (customer.email) {
      out.email = String(customer.email);
      out.lines.push(out.email);
    }
    if (customer.createdAt) out.lines.push(`Created customer ${formatDateOnly(customer.createdAt)}`);
    if (customer.totalSpentSet?.shopMoney?.amount || customer.totalSpent) {
      const amount = customer.totalSpentSet?.shopMoney?.amount || customer.totalSpent;
      const currency = customer.totalSpentSet?.shopMoney?.currencyCode || "";
      out.lines.push(`Total spent ${currency ? `${currency} ` : ""}${amount}`);
    }
    if (customer.defaultAddress?.formattedArea) out.lines.push(String(customer.defaultAddress.formattedArea));
    const lastOrder = customer.lastOrder;
    if (lastOrder) {
      out.orderLines.push("Created last order");
      if (lastOrder.name) out.orderLines.push(String(lastOrder.name));
      const statuses = [lastOrder.displayFinancialStatus, lastOrder.displayFulfillmentStatus].filter(Boolean).join(" / ");
      if (statuses) out.orderLines.push(statuses);
      if (lastOrder.currentTotalPriceSet?.shopMoney?.amount) {
        const money = lastOrder.currentTotalPriceSet.shopMoney;
        out.orderLines.push(`${money.currencyCode || ""} ${money.amount}`.trim());
      }
      if (lastOrder.createdAt) out.orderLines.push(formatDateOnly(lastOrder.createdAt));
      const orderLink = orderLinkFromCustomerLastOrder(lastOrder, storeSlug);
      if (orderLink) out.orderLinks.push(orderLink);
    }
  }
  out.lines = dedupe(out.lines);
  out.orderLines = dedupe(out.orderLines);
  out.orderLinks = mergeLinks(out.orderLinks);
  return out;
}

function parseJSONSafe(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function formatDateOnly(value) {
  const date = new Date(value || "");
  if (!Number.isFinite(date.getTime())) return String(value || "");
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function isInboxProfileOnlyMessage(message = {}, profileLines = []) {
  if (String(message?.time || "").trim()) return false;
  const profileSet = new Set((profileLines || []).map((line) => String(line || "").trim().toLowerCase()).filter(Boolean));
  if (!profileSet.size) return false;
  const lines = String(message?.text || "")
    .split(/\n+/)
    .map((line) => String(line || "").trim())
    .filter(Boolean);
  if (!lines.length || lines.length > 4) return false;
  return lines.every((line) => profileSet.has(line.toLowerCase()));
}

function inboxConversationFromDetail(page, row, unreadUrl, detail) {
  const conversationID = extractUnreadConversationID(page.url());
  if (!conversationID) return null;
  let profileLines = cleanCustomerProfileLines(detail.profileLines || []);
  if (!profileLinesLookUsable(profileLines, row.customerName || detail.customerFullName || "")) {
    profileLines = [];
  }
  const messages = (detail.messages || []).filter((message) => !isInboxProfileOnlyMessage(message, profileLines));
  const rawLines = messages.map((message) => `${message.role === "store" ? "Store" : message.role === "customer" ? "Customer" : "System"}: ${message.time ? `[${message.time}] ` : ""}${message.text}`);
  let orderLines = dedupe(detail.orderCartLines || []);
  let orderLinks = preferConcreteOrderLinks(mergeLinks(
    detail.orderLinks || [],
    extractOrderLinks(orderLines)
  ));
  let customerEmail = selectCustomerEmail(row, detail, rawLines);
  let customerFullName = detail.customerFullName || "";
  const customerName = displayCustomerName(row.customerName, customerFullName, customerEmail);
  const rowPreview = inboxDisplayTextLooksLikeReplyBody(row.preview) ? "" : usefulRowPreview(row.preview);
  const dataConflict = !detail.verified || Boolean(detail.profileConflict) || Boolean(detail.identityConflict);
  return {
    id: stableHash(`${page.url()}\n${row.customerName}\n${row.preview}`),
    customerName,
    customerFullName,
    customerEmail,
    preview: rowPreview || firstUsefulCustomerMessage(messages) || firstCustomerMessage(messages) || firstMessage(messages) || "",
    topic: row.topic || "",
    lastSeen: row.lastSeen || "",
    status: "pending",
    sendStatus: "",
    detailLoaded: true,
    source: "inbox",
    conversationId: conversationID,
    sourceUrl: page.url() || unreadUrl,
    fetchedAt: new Date().toISOString(),
    rawLines,
    messages,
    customerProfileLines: profileLines,
    orderCartLines: orderLines,
    orderLinks,
    productCards: detail.productCards || [],
    productInterestTitles: detail.productInterestTitles || [],
    dataSources: ["playwright", detail.networkVerified ? "network_messages" : "", profileLines.length ? "profile" : "", orderLines.length ? "order" : ""].filter(Boolean),
    dataConflict,
    needsReview: dataConflict || messages.length === 0 || !customerEmail && (detail.profileLines || []).length === 0,
    detailFingerprint: stableHash(rawLines.concat(profileLines, orderLines, orderLinks.map((l) => `${l.kind}|${l.label}|${l.url}`), detail.productInterestTitles || [], (detail.productCards || []).map((card) => `${card.title}|${card.url}`)).join("\n"))
  };
}

function cleanCustomerProfileLines(lines) {
  const out = [];
  let reachedRelatedSection = false;
  for (const line of lines || []) {
    const value = String(line || "").trim();
    if (!value) continue;
    if (isCustomerProfileSectionBoundary(value)) {
      reachedRelatedSection = true;
      continue;
    }
    if (reachedRelatedSection) continue;
    if (isCustomerProfileNoiseLine(value)) continue;
    if (isOrderCartSummaryLine(value)) {
      reachedRelatedSection = true;
      continue;
    }
    out.push(value);
  }
  return dedupe(out);
}

function isCustomerProfileSectionBoundary(value) {
  const text = String(value || "").trim();
  return /^(created last order|created previous order|created.*order|order\s*\/\s*cart|conversion history|product recommendations)$/i.test(text)
    || /^(?:\u521b\u5efa\u7684\u4e0a\u4e00\u7b14\u8ba2\u5355|\u4e0a\u4e00\u7b14\u8ba2\u5355|\u8ba2\u5355\s*\/\s*\u8d2d\u7269\u8f66|\u8f6c\u5316\u5386\u53f2\u8bb0\u5f55|\u4ea7\u54c1\u63a8\u8350)$/i.test(text);
}

function isCustomerProfileNoiseLine(value) {
  return /^(conversion history|\u8f6c\u5316\u5386\u53f2\u8bb0\u5f55)$/i.test(value)
    || /^(track my order|store info|order status|checkout|product interest|shipping)$/i.test(value)
    || /^(\d{1,2}\s*\u6708\s*\d{1,2}\s*\u65e5|\d{4}-\d{2}-\d{2}|[A-Z][a-z]+ \d{1,2}, \d{4})$/i.test(value);
}

function isOrderCartSummaryLine(value) {
  const text = String(value || "").trim();
  if (isCustomerLifetimeValueLine(text)) return false;
  return /^(created last order|created previous order|created.*order|\u521b\u5efa\u7684\u4e0a\u4e00\u7b14\u8ba2\u5355|\u4e0a\u4e00\u7b14\u8ba2\u5355)$/i.test(text)
    || /^#\s*\d{2,20}$/.test(text)
    || /^(paid|fulfilled|refunded|partially refunded|awaiting fulfillment|pending shipment|\u5df2\u4ed8\u6b3e|\u5df2\u53d1\u8d27|\u5df2\u9000\u6b3e)/i.test(text)
    || /(?:^|\s)(?:US\$|\$|USD|PYG|\u20ac|\u00a3)\s*[\d,.]+.*(?:online store|created|order|paid|fulfilled|refunded|shipped|delivered|\u6765\u81ea|\u8ba2\u5355|\u5df2\u4ed8\u6b3e|\u5df2\u53d1\u8d27)/i.test(text);
}

function isCustomerLifetimeValueLine(value) {
  return /^(total spend|total spent|\u603b\u652f\u51fa)(?:\s|$)/i.test(String(value || "").trim());
}

function validInboxDetail(detail) {
  return Boolean(Array.isArray(detail?.messages) && detail.messages.length > 0 && detail.verified && !detail.identityConflict && !detail.profileConflict);
}

function validCurrentInboxDetail(page, detail) {
  return Boolean(
    extractUnreadConversationID(page.url()) &&
    Array.isArray(detail?.messages) &&
    detail.messages.length > 0 &&
    !detail.identityConflict &&
    !detail.profileConflict
  );
}

async function openInboxRow(page, row) {
  await resetUnreadListScroll(page).catch(() => {});
  const beforeURL = page.url();
  if (await clickInboxRowInCurrentList(page, row)) {
    await page.waitForTimeout(750);
    if (page.url() !== beforeURL || extractUnreadConversationID(page.url())) return;
  }
}

async function clickInboxRowInCurrentList(page, row) {
  const point = await page.evaluate((target) => {
    const normalize = (value) => (value || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1400;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 900;
    const listLeft = Math.max(230, Math.round(viewportWidth * 0.12));
    const listRight = Math.min(Math.round(viewportWidth * 0.42), listLeft + 460);
    const topics = ["Order status", "Product interest", "Checkout", "Store info", "Returns / Delivered orders", "Shipping", "Order update request"];
    const isTime = (line) => /^(Yesterday|Today|\u6628\u5929|\u4eca\u5929|\u661f\u671f[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u65e5\u5929]?|\u5468[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u65e5\u5929]?|\d+\s*\u6708\s*\d+|\d{1,2}:\d{2}|\d+\s*(min|h|d)\b)/i.test(line || "");
    const isTopic = (line) => topics.includes(line);
    const parseRow = (node) => {
      const rect = node.getBoundingClientRect();
      if (rect.top < 45 || rect.top > viewportHeight - 20 || rect.left < listLeft || rect.right > listRight + 24 || rect.width < 220 || rect.width > 460 || rect.height < 44 || rect.height > 230) return null;
      const text = normalize(node.innerText || node.textContent || "");
      const rawLines = text.split(/\n+/).map(normalize).filter(Boolean);
      if (rawLines.length < 2) return null;
      const customerName = rawLines[0];
      const lastSeen = rawLines.find(isTime) || "";
      const topic = rawLines.filter(isTopic).join(" / ");
      const afterCustomer = rawLines.slice(1);
      const preview = afterCustomer.find((line) => !isTime(line) && !isTopic(line)) || topic || lastSeen || "";
      const linkNode = node.closest("a[href]") || node.querySelector("a[href]");
      const sourceUrl = linkNode ? linkNode.href : "";
      if (/\/conversations\/(?:open|closed)\/[^/?#]+/i.test(sourceUrl)) return null;
      const rowKey = `${customerName}|${preview}|${topic}|${lastSeen}`.toLowerCase().replace(/\s+/g, " ").trim();
      return { node, rect, customerName, preview, topic, lastSeen, rowKey, sourceUrl };
    };
    const rows = Array.from(document.querySelectorAll("button,[role='button']")).filter(visible).map(parseRow).filter(Boolean);
    const targetKey = String(target.rowKey || "").toLowerCase().replace(/\s+/g, " ").trim();
    const targetCustomer = String(target.customerName || "").toLowerCase().trim();
    const targetPreview = String(target.preview || "").toLowerCase().replace(/\s+/g, " ").trim();
    const targetLastSeen = String(target.lastSeen || "").toLowerCase().trim();
    const lowSignalTopics = new Set(["shipping", "order status", "product interest", "checkout", "store info", "returns", "delivered orders", "returns / delivered orders", "order update request"]);
    const targetPreviewTopicOnly = targetPreview.split(/\s*\/\s*/).filter(Boolean).every((part) => lowSignalTopics.has(part));
    const targetPreviewLowSignal = !targetPreview ||
      targetPreviewTopicOnly ||
      /^(shipping|order status|product interest|checkout|store info|returns \/ delivered orders|order update request)$/i.test(targetPreview) ||
      /^(yesterday|today|\u6628\u5929|\u4eca\u5929|\u661f\u671f[\u4e00-\u9fff]?|\u5468[\u4e00-\u9fff]?|\d+\s*\u6708\s*\d+|\d{1,2}:\d{2}|\d{1,2}:\d{2}\s*(am|pm|\u4e0a\u5348|\u4e0b\u5348)|\d+\s*(min|h|d)\b)$/i.test(targetPreview) ||
      /(?:opened|closed)\s+this\s+conversation/i.test(targetPreview);
    let match = targetKey ? rows.find((item) => item.rowKey === targetKey) : null;
    if (!match && targetCustomer) {
      match = rows.find((item) => {
        if (item.customerName.toLowerCase().trim() !== targetCustomer) return false;
        if (targetLastSeen && item.lastSeen.toLowerCase().trim() !== targetLastSeen) return false;
        if (targetPreviewLowSignal) return true;
        const preview = item.preview.toLowerCase().replace(/\s+/g, " ");
        return preview.includes(targetPreview.slice(0, 48)) || targetPreview.includes(preview.slice(0, 48));
      });
    }
    if (!match && targetCustomer) {
      match = rows.find((item) => {
        if (item.customerName.toLowerCase().trim() !== targetCustomer) return false;
        if (targetPreviewLowSignal) return true;
        const preview = item.preview.toLowerCase().replace(/\s+/g, " ");
        return preview.includes(targetPreview.slice(0, 48)) || targetPreview.includes(preview.slice(0, 48));
      });
    }
    if (!match) return false;
    match.node.scrollIntoView({ block: "center", inline: "nearest" });
    const rect = match.node.getBoundingClientRect();
    const x = rect.left + Math.min(Math.max(rect.width * 0.45, 24), rect.width - 8);
    const y = rect.top + Math.min(Math.max(rect.height * 0.5, 12), rect.height - 8);
    return { x, y };
  }, row).catch(() => null);
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  await page.mouse.click(point.x, point.y);
  return true;
}

async function waitForConversationDetailReady(page, row) {
  const expected = {
    customerName: row.customerName || "",
    preview: row.preview || "",
    conversationId: row.conversationId || ""
  };
  let previous = "";
  let stableCount = 0;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const state = await page.evaluate((target) => {
      const normalize = (value) => (value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
      const visible = (node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      const viewportWidth = window.innerWidth || 1200;
      const detailLeft = detectDetailColumnLeft();
      const sidePanelLeft = Math.round(viewportWidth * 0.86);
      const text = normalize(Array.from(document.querySelectorAll("main,section,article,div"))
        .filter(visible)
        .map((node) => ({ rect: node.getBoundingClientRect(), text: node.innerText || node.textContent || "" }))
        .filter((item) => item.rect.left >= detailLeft - 80 && item.rect.left < sidePanelLeft && item.rect.top > 45 && item.rect.height > 24)
        .slice(0, 900)
        .map((item) => item.text)
        .join("\n"));
      const lower = text.toLowerCase();
      const preview = String(target.preview || "").toLowerCase().trim().slice(0, 36);
      const customer = String(target.customerName || "").toLowerCase().trim();
      const empty = /Select a conversation to view|\u9009\u62e9\u4e00\u4e2a\u5bf9\u8bdd/i.test(text);
      const unreadDetail = /\/conversations\/unread\/[^/?#]+/i.test(location.href);
      const urlID = String(location.href).match(/\/conversations\/unread\/([^/?#]+)/i)?.[1] || "";
      const targetID = String(target.conversationId || "");
      const match = unreadDetail && !empty && text.length > 30 && (
        Boolean(preview && lower.includes(preview)) ||
        Boolean(customer && lower.includes(customer)) ||
        Boolean(targetID && urlID && targetID === urlID)
      );
      return { key: `${location.href}|${text.slice(0, 1500)}`, match };

      function detectDetailColumnLeft() {
        const dividers = Array.from(document.querySelectorAll("[aria-label='divider'],[data-testid='divider'],div")).filter(visible)
          .map((node) => node.getBoundingClientRect())
          .filter((rect) => rect.left > 480 && rect.left < viewportWidth * 0.55 && rect.width <= 6 && rect.height > 250)
          .sort((a, b) => a.left - b.left);
        return Math.round((dividers[0]?.right || Math.max(560, Math.round(viewportWidth * 0.32))) + 1);
      }
    }, expected).catch(() => ({ key: "", match: false }));
    if (state.match) {
      if (state.key === previous) {
        stableCount += 1;
        if (stableCount >= 2) return true;
      } else {
        previous = state.key;
        stableCount = 1;
      }
    }
    await page.waitForTimeout(250 + attempt * 60);
  }
  return false;
}

async function looksLikeEmptyInboxDetail(page) {
  return await page.evaluate(() => {
    const text = document.body.innerText || "";
    return /选择一个对话以进行查看|Select a conversation to view/i.test(text);
  }).catch(() => false);
}

async function extractInboxDetail(page, row) {
  return await page.evaluate(async (target) => {
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const normalize = (value) => (value || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
    const systemEventPatterns = (target.systemEventPatterns || []).map((source) => new RegExp(source, "i"));
    const isInboxSystemEventText = (value) => {
      const text = String(value || "").replace(/\s+/g, " ").trim();
      return Boolean(text && systemEventPatterns.some((pattern) => pattern.test(text)));
    };
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const viewportWidth = window.innerWidth || 1200;
    const detailLeft = detectDetailColumnLeft();
    const detectSidePanelLeft = () => {
      const divider = Array.from(document.querySelectorAll("[aria-label='divider'],[data-testid='divider'],div")).filter(visible)
        .map((node) => node.getBoundingClientRect())
        .filter((rect) => rect.left > detailLeft + 420 && rect.left < viewportWidth - 180 && rect.width <= 6 && rect.height > 250)
        .sort((a, b) => b.left - a.left)[0];
      if (divider) return Math.round(divider.right + 1);
      const minLeft = Math.max(detailLeft + 260, Math.round(viewportWidth * 0.58));
      const panels = Array.from(document.querySelectorAll("aside,section,main,div")).filter(visible)
        .map((node) => ({ node, rect: node.getBoundingClientRect(), text: node.innerText || node.textContent || "" }))
        .filter((item) => item.rect.left >= minLeft && item.rect.width >= 160 && item.rect.height >= 80)
        .filter((item) => /Customer details|Profile|Product recommendations|客户资料|资料|产品推荐|created customer|total spend|Returning customer|回头客|Add note|添加备注|local time|当地时间|@/i.test(item.text))
        .sort((a, b) => a.rect.left - b.rect.left || (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height));
      return panels[0]?.rect.left || Math.round(viewportWidth * 0.82);
    };
    const sidePanelLeft = detectSidePanelLeft();
    const chatWidth = Math.max(320, sidePanelLeft - detailLeft);
    const composerTop = Math.max(420, (window.innerHeight || 900) - 140);
    const centerLine = (detailLeft + sidePanelLeft) / 2;
    const noise = new Set(["Open", "Unread", "Closed", "Settings", "Profile", "Customer", "Send email", "Shift + Enter", "资料", "客户", "管理"]);
    const messageTimestampLine = (line) => /^\d{1,2}:\d{2}\s*(AM|PM|am|pm|上午|下午)?(?:\s*[•·-]\s*(delivered|sent|已送达|已发送))?$/i.test(line) || /^(您|You|Auto|自动)\s*[•·-]\s*\d{1,2}:\d{2}/i.test(line);
    const cleanTimestamp = (line) => normalize(line.replace(/^(您|You|Auto|自动)\s*[•·-]\s*/i, ""));
    const timestampRole = (line) => /^(您|You|Auto|自动)\s*[•·-]/i.test(line) ? "store" : "customer";
    const isSystem = (line) => isInboxSystemEventText(line);
    const isChineseSystem = (line) => String(line || "").includes("\u901a\u8fc7\u5728\u7ebf\u5546\u5e97\u53d1\u8d77\u7684\u5bf9\u8bdd")
      || String(line || "").includes("\u60a8\u5c06\u5728\u6b64\u5904\u67e5\u770b\u6240\u9009\u5bf9\u8bdd\u4e2d\u7684\u6d88\u606f")
      || String(line || "").includes("\u9009\u62e9\u4e00\u4e2a\u5bf9\u8bdd\u4ee5\u8fdb\u884c\u67e5\u770b");
    const isChineseTimestamp = (line) => /^\d{1,2}:\d{2}\s*(\u4e0a\u5348|\u4e0b\u5348)?$/.test(String(line || ""))
      || /^(\u60a8|\u81ea\u52a8)\s*[•·]\s*\d{1,2}:\d{2}/.test(String(line || ""));
    const isNonConversationChromeLine = (line) => {
      const value = String(line || "").trim();
      if (!value) return false;
      const lower = value.toLowerCase().replace(/\s+/g, " ");
      if (/^this customer placed order\b/i.test(value)) return true;
      if (/^within the past\s+\d+\s+days\.?\s+their total was/i.test(value)) return true;
      if (/^their total was\s+(?:us\$|\$|usd)/i.test(value)) return true;
      if (/(created customer|returning customer|total spend|conversion history|local time|subscribed|accepts marketing|not subscribed|customer since)/i.test(value)) return true;
      if (/^(customer details|conversation details|order \/ cart|product recommendations|profile|manage|add note)$/i.test(value)) return true;
      if (value.includes("\u521b\u5efa\u7684\u5ba2\u6237") || value.includes("\u56de\u5934\u5ba2") || value.includes("\u603b\u652f\u51fa") || value.includes("\u8f6c\u5316\u5386\u53f2\u8bb0\u5f55") || value.includes("\u5f53\u5730\u65f6\u95f4") || value.includes("\u6dfb\u52a0\u5907\u6ce8")) return true;
      if (/store info/i.test(value) && /order status|track my order/i.test(value)) return true;
      if (/#\s*\d{2,20}/.test(value) && /(created.*order|previous order|last order)/i.test(lower)) return true;
      if (/^(#\s*\d{2,20}|paid|fulfilled|refunded|partially refunded|awaiting fulfillment|pending shipment|已付款|已发货|已退款)/i.test(value)) return true;
      return false;
    };
    const isMessageChromeLabel = (value) => /^(track my order|order status|shipping|store info|checkout|returns \/ delivered orders|order update request|product interest|\u8ddf\u8e2a\u6211\u7684\u8ba2\u5355|\u8ba2\u5355\u72b6\u6001|\u914d\u9001|\u5546\u5e97\u4fe1\u606f)$/i.test(String(value || "").trim());
    const stripMessageChrome = (role, text) => {
      const lines = String(text || "").split(/\n+/).map(normalize).filter(Boolean);
      while (lines.length > 1 && isMessageChromeLabel(lines[0])) lines.shift();
      if (lines.length === 1 && isMessageChromeLabel(lines[0]) && role !== "customer") return "";
      return lines.join("\n");
    };
    const isIgnored = (line) => !line || noise.has(line) || line === target.customerName || isSystem(line) || isChineseSystem(line) || isNonConversationChromeLine(line);
    const looksLikeProfileBlock = (text) => {
      const value = String(text || "");
      if (!value) return false;
      const markers = [
        /Customer details|客户资料|Profile|资料|Manage|管理/i,
        /created customer|创建的客户|Returning customer|回头客|total spend|总支出/i,
        /created.*order|创建的上一笔订单|local time|当地时间|Add note|添加备注/i,
        /转化历史记录|Conversion history|Product recommendations|产品推荐/i
      ];
      const score = markers.reduce((count, marker) => count + (marker.test(value) ? 1 : 0), 0);
      return score >= 1 && (/@|#\d+|\$\s?\d|总支出|total spend|创建的客户|created customer/i.test(value));
    };
    const dedupeLocal = (items) => {
      const out = [];
      const seen = new Set();
      for (const item of items || []) {
        const key = String(item || "").toLowerCase().replace(/\s+/g, " ");
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(item);
      }
      return out;
    };
    const sanitizeEntryProductTitle = (value) => {
      let text = normalize(value)
        .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
        .replace(/\s+page\.?$/i, "")
        .replace(/\s+[–—-]\s+[^–—-]{1,45}$/u, "")
        .trim();
      text = normalize(text);
      if (!text || text.length < 3 || text.length > 180) return "";
      if (/^(product interest|order status|shipping|checkout|store info)$/i.test(text)) return "";
      return text;
    };
    const readProductInterestTitles = (node) => {
      const source = normalize(node?.innerText || node?.textContent || "");
      if (!source) return [];
      const out = [];
      const add = (candidate) => {
        const title = sanitizeEntryProductTitle(candidate);
        if (!title) return;
        const key = title.toLowerCase().replace(/\s+/g, " ");
        if (out.some((old) => old.toLowerCase().replace(/\s+/g, " ") === key)) return;
        out.push(title);
      };
      for (const match of source.matchAll(/\bmessaged you from\s+(?:the\s+)?(.+?)\s+page(?:\.|\s|$)/gi)) {
        add(match[1]);
      }
      for (const match of source.matchAll(/(?:从|来自)\s*(.+?)\s*(?:页面|产品页|商品页)(?:发起|发送|进入|开始|咨询|$)/g)) {
        add(match[1]);
      }
      return out.slice(0, 5);
    };
    const profileLinesLookUsableLocal = (lines, customerName = "") => {
      const values = (lines || []).flatMap((line) => String(line || "").split(/\n+/)).map(normalize).filter(Boolean);
      if (!values.length) return false;
      const text = values.join("\n");
      const hasProfileAnchor = /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i.test(text)
        || /\b(created customer|returning customer|total spend|customer since|local time)\b/i.test(text)
        || /创建的客户|回头客|总支出|当地时间/.test(text);
      if (!hasProfileAnchor) return false;
      const customer = String(customerName || "").toLowerCase().trim();
      const messageLike = values.filter((line) => {
        const value = String(line || "").trim();
        const lower = value.toLowerCase();
        if (/^(hi|hello|dear)\b/.test(lower)) return true;
        if (/\b(thank you for your message|i understand|i apologize|best regards|customer support team)\b/i.test(value)) return true;
        if (/\bplease (let me know|contact|confirm|provide)\b/i.test(value)) return true;
        if (/^(you|您)\s*[•·-]\s*\d{1,2}:\d{2}/i.test(value)) return true;
        if (customer && lower.includes(customer) && /^(hi|hello|dear)\b/.test(lower)) return true;
        return false;
      }).length;
      return messageLike < Math.max(2, Math.ceil(values.length * 0.45));
    };
    const container = Array.from(document.querySelectorAll("main,section,[role='main'],div")).filter(visible)
      .map((node) => ({ node, rect: node.getBoundingClientRect(), scroll: node.scrollHeight - node.clientHeight, text: node.innerText || "" }))
      .filter((item) => item.rect.left >= detailLeft - 20 && item.rect.left < sidePanelLeft && item.rect.height > 220 && item.rect.top < composerTop)
      .filter((item) => /messaged you from|通过在线商店发起的对话|opened this conversation|closed this conversation|Dear |Hello|Hi |#\d+|@/i.test(item.text))
      .sort((a, b) => b.scroll - a.scroll || b.rect.width * b.rect.height - a.rect.width * a.rect.height)[0]?.node || document.scrollingElement || document.documentElement;
    await expandConversationHistory(container);
    const collected = [];
    const seen = new Set();
    const addMessage = (role, text, time, top, left, width, height, scanPos, visualTop, virtualIndex) => {
      text = normalize(text).split("\n").map(normalize).filter(Boolean).join("\n");
      text = stripMessageChrome(role, text);
      if (!text || text.length < 2 || isSystem(text) || isNonConversationChromeLine(text)) return;
      if (looksLikeProfileBlock(text)) return;
      if (/^(you sent|you replied|sent by you)\s*:/i.test(text) || /^(\u60a8|\u4f60)\s*(sent|replied|回复|发送)\s*[:：]/i.test(text)) return;
      if (/^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/i.test(text)) return;
      if (/^(Customer details|Conversation details|客户资料|对话详情|订单|购物车|产品推荐|处理状态|Send email)$/i.test(text)) return;
      const key = `${role}|${time}|${text}`.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      collected.push({ role, text, time, top, left, width, height, scanPos, visualTop, virtualIndex });
    };
    {
      const pos = container.scrollTop || 0;
      container.scrollTop = pos;
      container.dispatchEvent(new Event("scroll", { bubbles: true }));
      await pause(260);
      for (const node of Array.from(document.querySelectorAll("article,li,[role='listitem'],[data-testid*='message' i],[class*='message' i],[class*='bubble' i],div,p,span")).slice(0, 3200)) {
        if (!visible(node)) continue;
        const rect = node.getBoundingClientRect();
        if (rect.left < detailLeft || rect.left > sidePanelLeft || rect.top < 60 || rect.top > composerTop || rect.width < 42 || rect.height < 14 || rect.height > 760) continue;
        if (rect.width > chatWidth * 0.82) continue;
        const parent = node.parentElement;
        if (parent && visible(parent)) {
          const parentRect = parent.getBoundingClientRect();
          const nodeText = normalize(node.innerText || node.textContent || "");
          const parentText = normalize(parent.innerText || parent.textContent || "");
          const parentInChat = parentRect.left >= detailLeft && parentRect.left <= sidePanelLeft && parentRect.top >= 55 && parentRect.top <= composerTop;
          const parentIsSameBubble = parentInChat && parentText === nodeText && parentRect.width <= chatWidth * 0.82 && parentRect.width >= rect.width && parentRect.height >= rect.height && parentRect.height <= 780;
          if (parentIsSameBubble) continue;
        }
        const lines = (node.innerText || node.textContent || "").split(/\n+/).map(normalize).filter(Boolean).filter((line) => !isIgnored(line));
        if (!lines.length || lines.length > 34) continue;
        let time = "";
        const body = [];
        for (const line of lines) {
          if (messageTimestampLine(line) || isChineseTimestamp(line)) {
            time = cleanTimestamp(line).replace(/^(\u60a8|\u81ea\u52a8)\s*[•·]\s*/i, "");
          } else {
            const inline = splitInlineTimestamp(line);
            if (inline) {
              body.push(inline.text);
              time = inline.time;
            } else {
              body.push(line);
            }
          }
        }
        const text = body.join("\n");
        const role = rect.left + rect.width / 2 > centerLine ? "store" : "customer";
        const indexed = node.closest?.("[index]");
        const virtualIndex = indexed ? Number(indexed.getAttribute("index")) : Number.NaN;
        addMessage(role, text, time, rect.top + (container.scrollTop || 0), rect.left, rect.width, rect.height, pos, rect.top, virtualIndex);
      }
    }
    const canonical = [];
    for (const item of collected.slice().sort((a, b) => (b.text.length - a.text.length) || ((b.width || 0) * (b.height || 0)) - ((a.width || 0) * (a.height || 0)))) {
      const textKey = item.text.toLowerCase().replace(/\s+/g, " ");
      const containedByKeptBubble = canonical.some((old) => {
        const oldKey = old.text.toLowerCase().replace(/\s+/g, " ");
        const sameVisualBand = Math.abs((old.top || 0) - (item.top || 0)) < Math.max(8, Math.min(old.height || 0, item.height || 0) + 8);
        return old.role === item.role && sameVisualBand && oldKey.includes(textKey);
      });
      if (!containedByKeptBubble) canonical.push(item);
    }
    canonical.sort(compareMessageOrder);
    const filteredCanonical = canonical.filter((item) => {
      const text = item.text.trim();
      const textKey = text.toLowerCase().replace(/\s+/g, " ");
      if (/^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/i.test(text)) return false;
      if (/^(you sent|you replied|sent by you)\s*:/i.test(text) || /^(\u60a8|\u4f60)\s*(sent|replied|回复|发送)\s*[:：]/i.test(text)) return false;
      if (isNonConversationChromeLine(text)) return false;
      if (/^https?:\/\/\S+$/i.test(text)) {
        return canonical.some((other) => other !== item && other.text.includes(text) && other.text.length > text.length + 8) ? false : true;
      }
      if (/^This conversation was created because/i.test(text)) return false;
      if (isInboxSystemEventText(text)) return false;
      return true;
    });
    filteredCanonical.sort(compareMessageOrder);
    let compact = [];
    for (const item of filteredCanonical) {
      if (compact.some((old) => old.role === item.role && old.text === item.text && old.time === item.time)) continue;
      compact.push({ role: item.role, text: item.text, time: item.time });
    }
    if (compact.length < 1) {
      compact = textFallbackMessages();
    }
    const profile = await ensureAndReadProfile(target.customerName);
    if (profile.email) {
      const profileEmail = profile.email.toLowerCase();
      compact = compact.filter((message) => !(message.text.trim().toLowerCase() === profileEmail && /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/i.test(message.text.trim())));
    }
    const orderLinks = readOrderLinks();
    const productCards = readProductCards();
    const productInterestTitles = readProductInterestTitles(container);
    const visibleEmails = dedupeLocal((document.body?.innerText || "").match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/ig) || []);
    const targetEmail = (String(target.customerName || "") + " " + String(target.preview || "")).match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i)?.[0]?.toLowerCase() || "";
    const identityConflict = Boolean(targetEmail && profile.email && profile.email.toLowerCase() !== targetEmail);
    const previewNeedle = String(target.preview || "").toLowerCase().trim();
    const previewIsLowSignal = !previewNeedle || /^(shipping|order status|product interest|checkout|store info|returns \/ delivered orders)$/i.test(previewNeedle);
    const profileText = (profile.lines || []).join("\n").toLowerCase();
    const targetName = String(target.customerName || "").toLowerCase().trim();
    const targetParts = targetName.split(/\s+/).filter((part) => part.length > 1);
    const targetNameMatched = !targetName || profileText.includes(targetName) || targetParts.every((part) => profileText.includes(part));
    const previewMatched = Boolean(previewNeedle && compact.some((m) => m.text.toLowerCase().includes(previewNeedle.slice(0, 32))));
    const verified = compact.length > 0 && !profile.conflict && (previewMatched || previewIsLowSignal || targetNameMatched);
    return {
      messages: compact.slice(0, 180),
      verified,
      profileLines: profile.lines,
      profileConflict: profile.conflict,
      identityConflict,
      customerEmail: profile.email,
      customerFullName: profile.name,
      orderCartLines: profile.orderLines,
      orderLinks,
      productCards,
      productInterestTitles,
      visibleEmails
    };

    function detectDetailColumnLeft() {
      const dividers = Array.from(document.querySelectorAll("[aria-label='divider'],[data-testid='divider'],div")).filter(visible)
        .map((node) => node.getBoundingClientRect())
        .filter((rect) => rect.left > 480 && rect.left < viewportWidth * 0.55 && rect.width <= 6 && rect.height > 250)
        .sort((a, b) => a.left - b.left);
      return Math.round((dividers[0]?.right || Math.max(560, Math.round(viewportWidth * 0.32))) + 1);
    }

    async function expandConversationHistory(node) {
      if (!node) return;
      let lastHeight = 0;
      let stable = 0;
      const maxActions = Math.max(0, Number(target.detailScrollActions || 2));
      let actions = 0;
      while (actions < maxActions) {
        const maxTop = Math.max(0, node.scrollHeight - node.clientHeight);
        node.scrollTop = maxTop;
        node.dispatchEvent(new Event("scroll", { bubbles: true }));
        actions += 1;
        if (actions >= maxActions) break;
        await pause(520);
        node.scrollTop = 0;
        node.dispatchEvent(new Event("scroll", { bubbles: true }));
        actions += 1;
        await pause(520);
        const height = node.scrollHeight;
        if (Math.abs(height - lastHeight) < 8) stable += 1;
        else stable = 0;
        lastHeight = height;
        if (stable >= 2) break;
      }
    }

    function hrefFrom(node) {
      if (!node) return "";
      const attrs = ["href", "data-href", "data-url", "data-to", "data-shopify-url", "data-admin-url"];
      for (const attr of attrs) {
        const value = node.href || node.getAttribute?.(attr) || "";
        if (value) return normalizeShopifyResourceURL(new URL(value, location.href).href);
      }
      const nested = node.querySelector?.("a[href],[data-href],[data-url],[data-to],[data-shopify-url],[data-admin-url]");
      if (nested) return hrefFrom(nested);
      const parent = node.closest?.("a[href],[data-href],[data-url],[data-to],[data-shopify-url],[data-admin-url]");
      if (parent && parent !== node) return hrefFrom(parent);
      return "";
    }

    function normalizeShopifyResourceURL(value) {
      try {
        const url = new URL(value, location.href);
        const match = url.pathname.match(/^\/store\/([^/]+)\/(orders|checkouts|customers|products)\/([^/?#]+)/i);
        if (match) return `https://admin.shopify.com/store/${match[1]}/${match[2]}/${match[3]}${url.search || ""}${url.hash || ""}`;
        return url.href;
      } catch {
        return String(value || "");
      }
    }

    function readOrderLinks() {
      const out = [];
      const seen = new Set();
      const selectors = "a[href],button,[role='button'],[data-href],[data-url],[data-to],[data-shopify-url],[data-admin-url]";
      for (const node of Array.from(document.querySelectorAll(selectors)).slice(0, 3500)) {
        if (!visible(node)) continue;
        const rect = node.getBoundingClientRect();
        if (rect.left < sidePanelLeft - 24 || rect.top < 40 || rect.width < 16 || rect.height < 12) continue;
        const url = hrefFrom(node);
        if (!url) continue;
        const lower = String(url || "").toLowerCase();
        if (!/\/(?:orders|checkouts)(?:\/|$)|\/cart(?:\/|$)|authenticate/i.test(lower)) continue;
        const kind = lower.includes("/orders") ? "order" : lower.includes("/checkouts") ? "checkout" : lower.includes("/products") ? "product" : lower.includes("/customers") ? "customer" : "link";
        const label = normalize(node.innerText || node.textContent || url) || url;
        if (isConversionHistoryLineLocal(label)) continue;
        const key = `${kind}|${url}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ label, url, kind });
        if (out.length >= 16) break;
      }
      return out;
    }

    function isConversionHistoryLineLocal(value) {
      return /conversion history|转化历史记录|track my order|store info|order status/i.test(String(value || ""));
    }

    function readProductCards() {
      const out = [];
      const seen = new Set();
      const imageOf = (node) => {
        const img = node.querySelector?.("img[src],img[srcset]");
        if (!img) return "";
        const raw = img.currentSrc || img.src || String(img.getAttribute("srcset") || "").split(/\s+/)[0] || "";
        return raw ? new URL(raw, location.href).href : "";
      };
      for (const node of Array.from(document.querySelectorAll("article,li,section,div,a")).slice(0, 3500)) {
        if (!visible(node)) continue;
        const rect = node.getBoundingClientRect();
        if (rect.left < detailLeft - 80 || rect.top < 45 || rect.width < 80 || rect.height < 30 || rect.height > 520) continue;
        const text = normalize(node.innerText || node.textContent || "");
        if (!text || text.length < 6 || text.length > 900) continue;
        const href = hrefFrom(node);
        const imageURL = imageOf(node);
        const haystack = `${href} ${text}`;
        const isProductURL = /\/products(?:\/|$)/i.test(href);
        const isOrderOrProfile = /\/(?:orders|checkouts|customers)(?:\/|$)|created.*order|previous order|last order|#\s*\d+|paid|fulfilled|order status|track my order|created customer|total spend|profile|customer|checkout|cart|订单|已付款|已发货|客户|上一笔订单/i.test(haystack);
        const productLike = isProductURL || (Boolean(imageURL) && /product|产品/i.test(haystack));
        if (!productLike) continue;
        if (isOrderOrProfile && !isProductURL) continue;
        const lines = text.split(/\n+/).map(normalize).filter(Boolean).filter((line) => line.length <= 160);
        const title = lines.find((line) => !/^(sku|quantity|qty|subtotal|total|paid|fulfilled|order summary|cart|checkout|profile|customer)$/i.test(line)) || lines[0] || href;
        if (!title || title.length < 3) continue;
        const titleKey = title.toLowerCase().replace(/\s+/g, " ").trim();
        const targetKey = String(target.customerName || "").toLowerCase().replace(/\s+/g, " ").trim();
        const targetCompact = targetKey.replace(/\s+/g, "");
        if (/^(dear|hi|hello)\b/i.test(title) || /^#\s*\d+/.test(title) || (targetKey && (titleKey === targetKey || titleKey.replace(/\s+/g, "") === targetCompact))) continue;
        const key = `${title}|${href}|${imageURL}`.toLowerCase().replace(/\s+/g, " ");
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ title, url: href, imageUrl: imageURL });
        if (out.length >= 12) break;
      }
      return out;
    }

    async function ensureAndReadProfile(customerName) {
      const readPanel = () => {
        const panelMarkers = /Customer details|Profile|Product recommendations|Manage|created customer|total spend|Returning customer|Add note|local time|@|\u5ba2\u6237|\u8d44\u6599|\u4ea7\u54c1\u63a8\u8350|\u7ba1\u7406|\u521b\u5efa\u7684\u5ba2\u6237|\u603b\u652f\u51fa|\u56de\u5934\u5ba2|\u6dfb\u52a0\u5907\u6ce8|\u5f53\u5730\u65f6\u95f4/i;
        const strictPanels = Array.from(document.querySelectorAll("aside,section,div")).filter(visible)
          .map((node) => ({ node, rect: node.getBoundingClientRect(), text: node.innerText || node.textContent || "" }))
          .filter((item) => item.rect.left >= sidePanelLeft - 24 && item.rect.width >= 160 && item.rect.height >= 120 && panelMarkers.test(item.text))
          .sort((a, b) => a.rect.left - b.rect.left || b.rect.height - a.rect.height);
        if (strictPanels[0]) return strictPanels[0];
        const panels = Array.from(document.querySelectorAll("aside,section,div")).filter(visible).map((node) => ({ node, rect: node.getBoundingClientRect(), text: node.innerText || node.textContent || "" }))
          .filter((item) => item.rect.left > Math.max(viewportWidth * 0.58, detailLeft + 260) && item.rect.width >= 160 && item.rect.height >= 120 && /Customer details|Profile|Product recommendations|客户资料|资料|产品推荐|管理|Manage|created customer|total spend|Returning customer|回头客|Add note|添加备注|local time|当地时间|@/i.test(item.text))
          .sort((a, b) => a.rect.left - b.rect.left || b.rect.height - a.rect.height);
        return panels[0] || null;
      };
      let panel = readPanel();
      if (!panel) {
        const header = Array.from(document.querySelectorAll("button,a,div,span")).filter(visible)
          .map((node) => ({ node, rect: node.getBoundingClientRect(), text: normalize(node.innerText || node.textContent || "") }))
          .filter((item) => item.rect.top >= 45 && item.rect.top <= 180 && item.rect.left > detailLeft - 60 && item.rect.left < sidePanelLeft && item.text.includes(customerName))
          .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)[0]?.node;
        header?.click();
        await pause(450);
        panel = readPanel();
      }
      if (!panel) return { lines: [], orderLines: [], email: "", name: "", conflict: false };
      const lines = panel.text.split(/\n+/).map(normalize).filter(Boolean).filter((line) => !["资料", "Profile", "管理", "Manage", "添加备注", "Add note"].includes(line) && line.length <= 180);
      const email = (lines.join(" ").match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i) || [""])[0];
      const name = lines.find((line) => line !== customerName && !line.includes("@") && !/\d|[$¥€£]|created customer|total spend|订单|order|已付款|已发货|subscribed|订阅/i.test(line) && line.length <= 80) || "";
      const haystack = lines.join("\n").toLowerCase().replace(/\s+/g, " ");
      const targetName = String(customerName || "").toLowerCase().replace(/\s+/g, " ").trim();
      const panelName = String(name || "").toLowerCase().replace(/\s+/g, " ").trim();
      const targetLooksEmail = /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/i.test(targetName);
      const targetParts = targetName.split(" ").filter((part) => part.length > 1);
      const targetCompact = targetParts.join("");
      const targetReverseCompact = targetParts.slice().reverse().join("");
      const panelCompact = panelName.replace(/\s+/g, "");
      const targetMatched = !targetName
        || haystack.includes(targetName)
        || (panelName && (panelName.includes(targetName) || targetName.includes(panelName)))
        || (!targetLooksEmail && targetParts.every((part) => haystack.includes(part)))
        || (!targetLooksEmail && targetParts.length > 1 && panelCompact && (panelCompact === targetCompact || panelCompact === targetReverseCompact));
      const conflict = Boolean(targetName && !targetMatched);
      const orderStart = lines.findIndex((line) => /创建的上一笔订单|created.*order|#\d+|已付款|paid|fulfilled|已发货/i.test(line));
      const orderStop = orderStart >= 0 ? lines.slice(orderStart + 1).findIndex((line) => /转化历史记录|conversion history|product recommendations|产品推荐|track my order|store info|order status/i.test(line)) : -1;
      const orderEnd = orderStart < 0 ? -1 : orderStop >= 0 ? orderStart + 1 + orderStop : Math.min(lines.length, orderStart + 6);
      const orderLines = orderStart >= 0 ? lines.slice(orderStart, orderEnd) : [];
      const profileLines = dedupeLocal(lines).slice(0, 40);
      const usableProfile = profileLinesLookUsableLocal(profileLines, customerName);
      return {
        lines: usableProfile ? profileLines : [],
        orderLines: dedupeLocal(orderLines),
        email: usableProfile ? email : "",
        name: usableProfile ? name : "",
        conflict: usableProfile ? conflict : false
      };
    }

    function clockMinutesFromText(value) {
      const match = String(value || "").match(/(\d{1,2}):(\d{2})/);
      if (!match) return null;
      let hour = Number(match[1]);
      const minute = Number(match[2]);
      if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
      const lower = String(value || "").toLowerCase();
      if ((lower.includes("pm") || String(value || "").includes("\u4e0b\u5348")) && hour < 12) hour += 12;
      if ((lower.includes("am") || String(value || "").includes("\u4e0a\u5348")) && hour === 12) hour = 0;
      return hour * 60 + minute;
    }

    function splitInlineTimestamp(value) {
      const text = String(value || "").trim();
      const match = text.match(/^(.*?)[\s\n]+((?:您|自动|You|Auto)?\s*(?:[•·]\s*)?\d{1,2}:\d{2}\s*(?:AM|PM|am|pm|上午|下午)?(?:\s*[•·]\s*(?:delivered|sent|已送达|已发送))?)$/i);
      if (!match || !match[1].trim()) return null;
      return {
        text: normalize(match[1]),
        time: cleanTimestamp(match[2]).replace(/^(您|自动|You|Auto)\s*[•·]?\s*/i, "")
      };
    }

    function compareMessageOrder(a, b) {
      const ai = Number(a.virtualIndex);
      const bi = Number(b.virtualIndex);
      if (Number.isFinite(ai) && Number.isFinite(bi) && ai !== bi) return bi - ai;
      if (Number.isFinite(ai) && !Number.isFinite(bi)) return -1;
      if (!Number.isFinite(ai) && Number.isFinite(bi)) return 1;
      return (b.scanPos || 0) - (a.scanPos || 0) || (a.visualTop || a.top || 0) - (b.visualTop || b.top || 0) || a.left - b.left;
    }

    function textFallbackMessages() {
      const text = document.body?.innerText || "";
      const lines = text.split(/\n+/).map(normalize).filter(Boolean);
      const out = [];
      const ignored = new Set(["Open", "Unread", "Closed", "Settings", "Customer", "Profile", "客户", "资料", "AI 回复与发送", "显示中文"]);
      let buffer = [];
      let lastTime = "";
      const flush = () => {
        const body = buffer.join("\n").trim();
        buffer = [];
        if (!body || body.length < 2) return;
        if (/^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/i.test(body)) return;
        if (looksLikeProfileBlock(body) || isNonConversationChromeLine(body)) return;
        if (isInboxSystemEventText(body)) return;
        if (/Select a conversation|Here's where you'll view messages|Make a conversation as unread|当前队列项没有完整上下文/i.test(body)) return;
        if (/matched to existing customer|conversation started|created customer|opened this conversation|closed this conversation|通过在线商店发起的对话|Customer details|Conversation details|客户资料|对话详情|产品推荐|处理状态/i.test(body)) return;
        const role = /^(You|Auto|您|自动)/i.test(lastTime) ? "store" : "customer";
        out.push({ role, text: body, time: cleanTimestamp(lastTime) });
      };
      for (const line of lines) {
        if (ignored.has(line) || line === target.customerName) continue;
        if (/^\d{1,2}:\d{2}\s*(AM|PM|am|pm|上午|下午)?(?:\s*[•·-]\s*(sent|delivered|已发送|已送达))?$/i.test(line) || /^(You|Auto|您|自动)\s*[•·-].*\d{1,2}:\d{2}/i.test(line)) {
          flush();
          lastTime = line;
          continue;
        }
        if (!lastTime) continue;
        if (/^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/i.test(line)) continue;
        if (/^(you sent|you replied|sent by you)\s*:/i.test(line) || /^(\u60a8|\u4f60)\s*(sent|replied|回复|发送)\s*[:：]/i.test(line)) continue;
        if (isInboxSystemEventText(line)) continue;
        if (isNonConversationChromeLine(line)) continue;
        if (/^(Customer details|Conversation details|订单|产品推荐|处理状态|Send email)$/i.test(line)) continue;
        buffer.push(line);
        if (buffer.length > 20) buffer = buffer.slice(-20);
      }
      flush();
      const seen = new Set();
      return out.filter((item) => {
        const key = `${item.role}|${item.time}|${item.text}`.toLowerCase().replace(/\s+/g, " ");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, 80);
    }

  }, { ...row, systemEventPatterns: inboxSystemEventPatternSpecs, detailScrollActions: inboxDetailScrollActions });
}

async function probeEmail(browser, request = {}) {
  resetEmailVisualDebug();
  const conversations = [];
  const warnings = [];
  const providerErrors = [];
  const activateTarget = request.activateTarget !== false;
  const ignoredEmailFingerprints = new Set(Array.isArray(request.ignoredEmailFingerprints) ? request.ignoredEmailFingerprints : []);
  const cutoffISO = String(request.emailScanCutoff || "");
  const learnedIgnoredEmailFingerprints = new Set();
  let ignoredEmailCount = 0;
  const candidates = await emailWorkPages(browser, request.shopName || "", {
    mailAccount: request.mailAccount || "",
    manual: Boolean(request.mailAccountManual)
  });
  if (!candidates.length) {
    return {
      storeSlug: "email",
      url: "",
      title: "邮箱未读",
      status: "ready",
      warnings,
      providerErrors,
      ignoredEmailCount,
      ignoredEmailFingerprints: [],
      conversations
    };
  }
  for (const { page, provider, weakAmbiguousMatch } of candidates) {
    if (!provider) continue;
    if (activateTarget) await page.bringToFront().catch(() => {});
    await page.waitForTimeout(300).catch(() => {});
    if (weakAmbiguousMatch && (request.shopName || "").trim()) {
      warnings.push(`${provider} email page was scanned without a strong shop/account match; verify the browser profile is the current shop.`);
    }
    if (provider === "fastmo") {
      warnings.push("Fastmo email provider detected; unread filtering is best-effort because no validated Fastmo sample is available.");
    }
    let rows = [];
    try {
      const index = await captureEmailIndex(page, provider, ignoredEmailFingerprints, cutoffISO, request.mailAccountManual ? request.mailAccount || request.shopName || "" : request.shopName || "");
      rows = index.rows || [];
      ignoredEmailCount += index.ignoredEmailCount || 0;
      for (const fingerprint of index.ignoredEmailFingerprints || []) {
        learnedIgnoredEmailFingerprints.add(fingerprint);
      }
      warnings.push(...(index.warnings || []));
    } catch (error) {
      providerErrors.push(`${provider}: ${error?.message || String(error)}`);
      continue;
    }
    const processRow = async (row, options = {}) => {
      let lastError = null;
      for (let attempt = 0; attempt < emailDetailOpenAttempts; attempt += 1) {
        try {
          const conversation = await readEmailConversation(page, provider, row, { ...options, shopName: request.mailAccountManual ? request.mailAccount || request.shopName || "" : request.shopName || "" });
          if (!conversation) {
            ignoredEmailCount += 1;
            return;
          }
          if (!shouldKeepEmailConversation(row, conversation)) {
            ignoredEmailCount += 1;
            return;
          }
          conversations.push(conversation);
          return;
        } catch (error) {
          lastError = error;
          await captureEmailVisualDebug(page, provider, row, `error-attempt-${attempt + 1}`, { error: error?.message || String(error) }).catch(() => {});
          if (attempt >= emailDetailOpenAttempts - 1) break;
          await recoverEmailReadSurface(page, provider, row, options).catch(() => {});
        }
      }
      if (shouldKeepEmailRow(row)) {
        conversations.push(emailReviewConversationFromRow(provider, row, lastError));
        warnings.push(`${provider} row needs review because detail did not open or validate: ${row.sender || row.subject || "unknown row"}.`);
        return;
      }
      providerErrors.push(`${provider} detail failed for ${row.sender || row.subject || "unknown row"}: ${lastError?.message || String(lastError)}`);
    };
    if (provider === "outlook") {
      for (const group of groupEmailRowsByFolder(rows)) {
        const ready = true;
        await resetEmailListScroll(page);
        for (const row of group.rows) {
          const canPreserveList = ready && Boolean(row.outlookConversationId || (row.sourceUrl && /\/mail\/(?:inbox|junkemail)\/id\//i.test(row.sourceUrl)));
          await processRow(row, { preserveCurrentList: canPreserveList, activateTarget });
        }
      }
    } else {
      for (const group of groupEmailRowsByFolder(rows)) {
        const ready = await prepareEmailReadSurface(page, provider, group.folderLabel, { activateTarget }).then(() => true).catch((error) => {
          warnings.push(`${provider} unread list was not prepared for ${group.folderLabel}: ${error?.message || String(error)}`);
          return false;
        });
        if (ready) await resetEmailListScroll(page).catch(() => {});
        for (const row of group.rows) {
          await processRow(row, { preserveCurrentList: ready, activateTarget });
        }
      }
    }
  }
  const reviewCount = conversations.filter((conversation) => conversation.needsReview || conversation.dataConflict || !conversation.detailLoaded).length;
  if (reviewCount) {
    warnings.push(`${reviewCount} email conversations need review because web detail validation was incomplete.`);
  }
  return {
    storeSlug: "email",
    url: "",
    title: "邮箱未读",
    status: warnings.length || providerErrors.length ? "partial" : "ready",
    warnings,
    providerErrors,
    ignoredEmailCount,
    ignoredEmailFingerprints: Array.from(learnedIgnoredEmailFingerprints),
    conversations
  };
}

function emailReviewConversationFromRow(provider = "email", row = {}, error = null) {
  const source = String(provider || "email").toLowerCase();
  const sourceUrl = row.sourceUrl || "";
  const id = stableHash(["email-review", source, sourceUrl, row.sender || "", row.subject || "", row.snippet || ""].join("\n"));
  return {
    id,
    customerName: row.sender || "Email unread row",
    customerFullName: row.sender || "",
    customerEmail: firstEmail([row.sender, row.snippet, ...(Array.isArray(row.lines) ? row.lines : [])].join("\n")),
    preview: row.snippet || row.subject || "Unread email row needs manual check",
    topic: row.subject || row.snippet || "Unread email row needs manual check",
    lastSeen: row.lastSeen || "",
    receivedAt: row.receivedAt || parseEmailReceivedAt(row.lastSeen || (Array.isArray(row.lines) ? row.lines.join(" ") : "")),
    status: "pending",
    sendStatus: "",
    detailLoaded: false,
    source,
    conversationId: row.outlookConversationId || stableHash(`${source}\n${row.sender || ""}\n${row.subject || ""}`).slice(0, 24),
    sourceUrl,
    fetchedAt: new Date().toISOString(),
    rawLines: Array.isArray(row.lines) ? row.lines.slice(0, 18) : [],
    messages: row.snippet ? [{ role: "customer", text: row.snippet, time: row.lastSeen || "" }] : [],
    customerProfileLines: [],
    orderCartLines: [],
    orderLinks: [],
    productCards: [],
    dataSources: ["playwright", "email_row_review"],
    dataConflict: true,
    needsReview: true,
    detailFingerprint: stableHash([row.sender || "", row.subject || "", row.snippet || "", error?.message || ""].join("\n"))
  };
}

function groupEmailRowsByFolder(rows = []) {
  const groups = [];
  const indexByLabel = new Map();
  for (const row of rows || []) {
    const folderLabel = String(row?.folderLabel || "current");
    if (!indexByLabel.has(folderLabel)) {
      indexByLabel.set(folderLabel, groups.length);
      groups.push({ folderLabel, rows: [] });
    }
    groups[indexByLabel.get(folderLabel)].rows.push(row);
  }
  return groups;
}

function emailRowFingerprint(provider, row = {}) {
  return stableHash([
    provider,
    row.sender || "",
    row.subject || "",
    row.snippet || ""
  ].map((value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ")).join("\n"));
}

async function emailWorkPages(browser, shopName, options = {}) {
  const pages = allPages(browser);
  const descriptors = [];
  for (const page of pages) {
    const url = page.url();
    const title = await page.title().catch(() => "");
    descriptors.push({ page, url, title });
  }
  const emailPageCount = descriptors.filter((item) => emailProvider(item.url, item.title)).length;
  const selected = selectEmailTargetDescriptors(descriptors, shopName, options);
  if (!selected.length && options.manual && options.mailAccount) {
    throw new Error(`未找到已配置客服邮箱 ${options.mailAccount} 的邮箱页面`);
  }
  return selected.map((item) => ({
    page: item.page,
    provider: item.provider,
    score: item.score,
    weakAmbiguousMatch: emailPageCount > 1 && item.score < 35
  }));
}

async function captureEmailIndex(page, provider, ignoredEmailFingerprints = new Set(), cutoffISO = "", shopName = "") {
  const rows = [];
  const seen = new Set();
  const warnings = [];
  const learnedIgnoredEmailFingerprints = new Set();
  let ignoredEmailCount = 0;
  const mergeRows = (items) => {
    const stats = { added: 0, ignored: 0, old: 0, seen: 0, stopAtOld: false };
    for (const row of items || []) {
      row.emailFingerprint = emailRowFingerprint(provider, row);
      row.shopMailbox = firstEmail(shopName);
      const cutoffCheck = isEmailRowWithinCutoff(row, cutoffISO);
      row.receivedAt = row.receivedAt || cutoffCheck.receivedAt || "";
      if (!cutoffCheck.keep && row.receivedAt) {
        ignoredEmailCount += 1;
        stats.ignored += 1;
        stats.old += 1;
        continue;
      }
      const preDetailIgnored = isHighConfidencePreDetailIgnoredEmail(row);
      if (shouldSkipPreviouslyIgnoredEmail(row, ignoredEmailFingerprints)) {
        ignoredEmailCount += 1;
        stats.ignored += 1;
        continue;
      }
      if (preDetailIgnored) {
        ignoredEmailCount += 1;
        stats.ignored += 1;
        learnedIgnoredEmailFingerprints.add(row.emailFingerprint);
        continue;
      }
      if (cutoffISO && !row.receivedAt) {
        row.needsReview = true;
      }
      const key = `${provider}|${row.sender || ""}|${row.subject || ""}|${row.snippet || ""}`.toLowerCase().replace(/\s+/g, " ");
      if (!key.trim() || seen.has(key)) {
        stats.seen += 1;
        continue;
      }
      seen.add(key);
      rows.push(row);
      stats.added += 1;
    }
    return stats;
  };
  const captureSurface = async (folderLabel) => {
    let unreadError = null;
    let unreadReady = await applyEmailUnreadView(page, provider, folderLabel).then(() => true).catch((error) => {
      unreadError = error;
      return false;
    });
    if (!unreadReady && unreadError) {
      warnings.push(`${provider} unread view was not confirmed for ${folderLabel}: ${unreadError?.message || String(unreadError)}`);
    }
    if (!unreadReady) throw unreadError || new Error(`${provider} unread view was not confirmed for ${folderLabel}`);
    await page.waitForTimeout(250).catch(() => {});
    await resetEmailListScroll(page).catch(() => {});
    let oldOnlyPasses = 0;
    let noProgressPasses = 0;
    for (let pass = 0; pass < emailScrollPasses; pass += 1) {
      const stats = mergeRows(await captureVisibleEmailRows(page, provider, folderLabel));
      oldOnlyPasses = stats.old > 0 && stats.added === 0 ? oldOnlyPasses + 1 : 0;
      noProgressPasses = stats.added === 0 && stats.old === 0 ? noProgressPasses + 1 : 0;
      if (stats.stopAtOld) {
        warnings.push(`${provider} unread scan stopped at the first message older than the 7-day window for ${folderLabel}.`);
        break;
      }
      if (oldOnlyPasses >= emailOldOnlyPassLimit) {
        warnings.push(`${provider} unread scan stopped at messages older than the 7-day window for ${folderLabel}.`);
        break;
      }
      if (noProgressPasses >= emailNoProgressPassLimit) {
        warnings.push(`${provider} unread scan stopped after repeated list pages with no new messages for ${folderLabel}.`);
        break;
      }
      const moved = await advanceEmailListScroll(page).catch(() => false);
      if (!moved) break;
      await page.waitForTimeout(350).catch(() => {});
    }
  };

  if (provider === "outlook") {
    const clickedInbox = await clickEmailNavigation(page, ["inbox", "收件箱"]);
    if (!clickedInbox && !/\/mail\/inbox(?:\/|$)/i.test(page.url())) {
      throw new Error("outlook inbox navigation was not confirmed by UI");
    }
    await page.waitForTimeout(900).catch(() => {});
    await captureSurface("Inbox");
  } else if (provider === "gmail") {
    await captureSurface("Inbox");
    await captureSurface("Spam");
  } else {
    await captureSurface("current");
  }
  return { rows, warnings, ignoredEmailCount, ignoredEmailFingerprints: Array.from(learnedIgnoredEmailFingerprints) };
}

async function applyEmailUnreadView(page, provider, folderLabel = "") {
  if (provider === "outlook") return await applyOutlookUnreadFilter(page);
  if (provider === "gmail") return await applyGmailUnreadSearch(page, folderLabel);
  return true;
}

async function prepareEmailReadSurface(page, provider, folderLabel = "", options = {}) {
  if (options?.activateTarget !== false) await page.bringToFront().catch(() => {});
  await page.waitForTimeout(150).catch(() => {});
  const folderPatterns = emailFolderPatterns(provider, folderLabel || "");
  if (folderPatterns.length) {
    const clickedFolder = await clickEmailNavigation(page, folderPatterns);
    if (provider === "outlook" && !clickedFolder && !/\/mail\/inbox(?:\/|$)/i.test(page.url())) {
      throw new Error(`outlook folder navigation was not confirmed for ${folderLabel || "Inbox"}`);
    }
    await page.waitForTimeout(650).catch(() => {});
  }
  await applyEmailUnreadView(page, provider, folderLabel || "");
  await page.waitForTimeout(350).catch(() => {});
  return true;
}

async function recoverEmailReadSurface(page, provider, row = {}, options = {}) {
  if (options?.activateTarget !== false) await page.bringToFront().catch(() => {});
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(120).catch(() => {});
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(220).catch(() => {});

  if (provider === "outlook") {
    const clickedInbox = await clickEmailNavigation(page, ["inbox", "收件箱"]);
    if (!clickedInbox && !/\/mail\/inbox(?:\/|$)/i.test(page.url())) {
      throw new Error("outlook inbox recovery was not confirmed by UI");
    }
    await page.waitForTimeout(650).catch(() => {});
    await applyEmailUnreadView(page, provider, row.folderLabel || "Inbox");
    await resetEmailListScroll(page);
    return true;
  }

  if (options?.preserveCurrentList && await hasVisibleEmailRow(page, provider, row).catch(() => false)) {
    await resetEmailListScroll(page).catch(() => {});
    return true;
  }
  await prepareEmailReadSurface(page, provider, row.folderLabel || "", options);
  await resetEmailListScroll(page).catch(() => {});
  return true;
}

async function hasVisibleEmailRow(page, provider, row = {}) {
  return await page.evaluate(({ providerName, row }) => {
    const normalize = (value) => String(value || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const rowLike = (node) => {
      const rect = node.getBoundingClientRect();
      const role = `${node.getAttribute("role") || ""} ${node.className || ""}`.toLowerCase();
      const semantic = role.includes("row") || role.includes("listitem") || role.includes("option") || role.includes("link") || node.tagName === "TR" || node.tagName === "LI" || node.tagName === "A" || node.closest("[role='listbox'],[role='grid'],table,.mail-list,.messagelist,.message-list,#messagelist,#message-list");
      if (!semantic) return false;
      if (providerName === "gmail") return rect.left >= 120 && rect.left < Math.min(window.innerWidth * 0.55, 900) && rect.width >= 360 && rect.height >= 24 && rect.height <= 120;
      if (providerName === "outlook") return rect.left >= 140 && rect.left < Math.min(window.innerWidth * 0.52, 760) && rect.width >= 200 && rect.width <= 680 && rect.height >= 36 && rect.height <= 190;
      if (providerName === "cuiqiu") return rect.left >= 180 && rect.left < Math.min(window.innerWidth * 0.48, 760) && rect.width >= 240 && rect.height >= 28 && rect.height <= 190;
      return rect.width >= 240 && rect.height >= 28 && rect.height <= 180;
    };
    const displaySender = String(row.sender || "")
      .replace(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/ig, "")
      .replace(/[<>]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const targetParts = [displaySender || row.sender, row.subject, row.snippet]
      .map((value) => normalize(value).toLowerCase())
      .filter((value) => value.length >= 5);
    if (!targetParts.length) return false;
    const rowSelector = providerName === "gmail"
      ? "tr[role='row'],tr,[role='main'] [role='link'],[role='main'] [role='row'],div[role='row'],div[role='listitem']"
      : "[role='option'],[role='row'],[role='listitem'],tr";
    return Array.from(document.querySelectorAll(rowSelector))
      .filter(visible)
      .filter(rowLike)
      .map((node) => normalize(node.innerText || node.textContent || "").toLowerCase())
      .some((text) => {
        if (text.length < 8 || text.length > 1800) return false;
        const hits = targetParts.reduce((total, part) => total + (text.includes(part) ? 1 : 0), 0);
        return hits >= Math.min(2, targetParts.length);
      });
  }, { providerName: provider, row });
}

async function applyOutlookUnreadFilter(page) {
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(120).catch(() => {});
  if (await isOutlookUnreadFilterConfirmed(page).catch(() => false)) return true;
  const filterPoint = await page.evaluate(() => {
    const normalize = (value) => String(value || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
    const isFilterButtonText = (value) => /^(Filter|筛选|筛选器|篩選|篩選器|All|全部|Unread|未读|未讀|未閱讀)$/i.test(normalize(value));
    const hasFilterButtonText = (value) => /Filter|筛选|筛选器|篩選|篩選器|All|全部|Unread|未读|未讀|未閱讀/i.test(normalize(value));
    const isExcludedHeaderButton = (value) => /选择|Select|跳转|Go to|排序|已排序|Sort|收藏|Favorite|标记|Flag/i.test(normalize(value));
    const labelOf = (node) => normalize([
      node.innerText || "",
      node.textContent || "",
      node.getAttribute("aria-label") || "",
      node.getAttribute("title") || ""
    ].join(" "));
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
    const controls = Array.from(document.querySelectorAll("button,[role='button']"))
      .filter(visible)
      .map((node) => ({ node, text: labelOf(node), rect: node.getBoundingClientRect() }))
      .filter((item) => isFilterButtonText(item.text) || hasFilterButtonText(item.text))
      .filter((item) => !isExcludedHeaderButton(item.text))
      .filter((item) => item.rect.width <= 180 && item.rect.height <= 60 && item.rect.left > 180 && item.rect.top >= 100 && item.rect.top < 260)
      .sort((a, b) => {
        const exactA = isFilterButtonText(itemText(a)) ? 0 : 1;
        const exactB = isFilterButtonText(itemText(b)) ? 0 : 1;
        const unreadA = /Unread|未读|未讀|未閱讀/i.test(itemText(a)) ? 0 : 1;
        const unreadB = /Unread|未读|未讀|未閱讀/i.test(itemText(b)) ? 0 : 1;
        return exactA - exactB || unreadA - unreadB || a.rect.top - b.rect.top || a.rect.left - b.rect.left;
      });
    const iconFilter = Array.from(document.querySelectorAll("[data-icon-name='Filter'],i.ms-Icon--Filter,svg[aria-label*='Filter'],svg[aria-label*='筛选'],svg[aria-label*='篩選']"))
      .map((node) => node.closest("button,[role='button']"))
      .filter(Boolean)
      .filter(visible)
      .map((node) => ({ node, rect: node.getBoundingClientRect() }))
      .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)[0]?.node;
    const filter = controls[0]?.node || iconFilter;
    if (!filter) return null;
    const rect = filter.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    function itemText(item) {
      return normalize(item?.text || "");
    }
  }).catch(() => null);
  if (!filterPoint) throw new Error("outlook filter button not found");
  await page.mouse.click(filterPoint.x, filterPoint.y).catch(() => {});
  await page.waitForTimeout(450).catch(() => {});
  const unreadPoint = await page.evaluate((filterRect) => {
    const normalize = (value) => String(value || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
    const hasUnreadLabel = (value) => {
      const text = normalize(value);
      return /(^|\s)(Unread|未读|未讀|未閱讀)(\s|$)/i.test(text) || text === "未读" || text === "未讀" || text === "未閱讀";
    };
    const labelOf = (node) => normalize([node.innerText || "", node.textContent || "", node.getAttribute("aria-label") || "", node.getAttribute("title") || ""].join(" "));
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const options = Array.from(document.querySelectorAll("[role='menuitemradio']"))
      .filter(visible)
      .map((node) => ({ node, text: labelOf(node), rect: node.getBoundingClientRect() }))
      .filter((item) => item.rect.left >= filterRect.left - 40 && item.rect.left <= filterRect.left + 360 && item.rect.top >= filterRect.bottom - 10 && item.rect.top <= filterRect.bottom + 280)
      .filter((item) => hasUnreadLabel(item.text));
    const option = options[0];
    if (!option) return null;
    return { x: option.rect.left + option.rect.width / 2, y: option.rect.top + option.rect.height / 2 };
  }, filterPoint).catch(() => null);
  if (!unreadPoint) {
    throw new Error("outlook unread option not found");
  }
  await page.mouse.click(unreadPoint.x, unreadPoint.y).catch(() => {});
  await page.waitForTimeout(900).catch(() => {});
  const headerConfirmed = await isOutlookUnreadFilterConfirmed(page).catch(() => false);
  if (headerConfirmed) {
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(500).catch(() => {});
    return true;
  }
  await page.keyboard.press("Escape").catch(() => {});
  throw new Error("outlook unread filter click was not confirmed");
}

async function isOutlookUnreadFilterConfirmed(page) {
  return await page.evaluate(() => {
    const normalize = (value) => String(value || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
    const hasUnreadLabel = (value) => /Unread|未读|未讀|未閱讀/i.test(normalize(value));
    const isExcludedHeaderButton = (value) => /选择|Select|跳转|Go to|排序|已排序|Sort|收藏|Favorite|标记|Flag/i.test(normalize(value));
    const labelOf = (node) => normalize([
      node.innerText || "",
      node.textContent || "",
      node.getAttribute("aria-label") || "",
      node.getAttribute("title") || ""
    ].join(" "));
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    return Array.from(document.querySelectorAll("button,[role='button']"))
      .filter(visible)
      .map((node) => ({ node, text: labelOf(node), rect: node.getBoundingClientRect() }))
      .filter((item) => item.rect.width <= 180 && item.rect.height <= 60 && item.rect.left > 180 && item.rect.top >= 100 && item.rect.top < 260)
      .some((item) => hasUnreadLabel(item.text) && !isExcludedHeaderButton(item.text));
  });
}

async function applyGmailUnreadSearch(page, folderLabel = "") {
  const scope = /spam|junk|垃圾/i.test(String(folderLabel || "")) ? "spam" : "inbox";
  const targetUrl = gmailUnreadSearchUrl(page.url(), scope);
  const currentUrl = page.url();
  const searchDetailOpen = /#search\/[^/]+\/[^/?#]+/i.test(currentUrl);
  if (searchDetailOpen || !/#search\//i.test(currentUrl) || !/is(?:%3a|:)unread/i.test(currentUrl)) {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(async () => {
      await page.evaluate((query) => {
        const input = document.querySelector("input[aria-label*='Search'],input[aria-label*='搜索'],input[name='q']");
        if (!input) return false;
        input.focus();
        input.value = query;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        return true;
      }, gmailUnreadQuery(scope)).catch(() => false);
    });
  } else if (!gmailUnreadSearchMatchesScope(page.url(), scope)) {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
  }
  await page.waitForTimeout(1000).catch(() => {});
  if (!gmailUnreadSearchMatchesScope(page.url(), scope) || !/is(?:%3a|:)unread/i.test(page.url())) {
    throw new Error(`gmail unread search not confirmed for ${scope}`);
  }
  return true;
}

function gmailUnreadQuery(scope = "inbox") {
  if (scope === "spam") return "in:spam is:unread newer_than:7d";
  return "in:inbox is:unread newer_than:7d";
}

function gmailUnreadSearchUrl(rawUrl = "", scope = "inbox") {
  const parsed = new URL(rawUrl || "https://mail.google.com/mail/u/0/#inbox");
  const userMatch = parsed.pathname.match(/\/mail\/u\/([^/]+)/i);
  const userPart = userMatch?.[1] || "0";
  parsed.pathname = `/mail/u/${userPart}/`;
  parsed.search = "";
  parsed.hash = `#search/${encodeURIComponent(gmailUnreadQuery(scope)).replace(/%20/g, "+")}`;
  return parsed.toString();
}

function gmailUnreadSearchMatchesScope(rawUrl = "", scope = "inbox") {
  const url = String(rawUrl || "").toLowerCase();
  if (scope === "spam") return /in(?:%3a|:)spam/i.test(url);
  return /in(?:%3a|:)inbox/i.test(url);
}

async function captureVisibleEmailRows(page, provider, folderLabel) {
  return await page.evaluate(({ providerName, folderLabel, parseEmailRowLinesSource }) => {
    const parseEmailRowLines = (0, eval)(`(${parseEmailRowLinesSource})`);
    const normalize = (value) => (value || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const isTime = (line) => /^(\d{1,2}:\d{2}|today(?:\s+at\b)?|yesterday(?:\s+at\b)?|an?\s+hour\s+ago|\d+\s+(?:minute|minutes|hour|hours|day|days)\s+ago|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\.?|mon|tue|wed|thu|fri|sat|sun|上午|下午|昨天|今天|周一|周二|周三|周四|周五|周六|周日|星期)/i.test(line);
    const rowLike = (node) => {
      const rect = node.getBoundingClientRect();
      const role = `${node.getAttribute("role") || ""} ${node.className || ""}`.toLowerCase();
      const semantic = role.includes("row") || role.includes("listitem") || role.includes("option") || role.includes("link") || node.tagName === "TR" || node.tagName === "LI" || node.tagName === "A" || node.closest("[role='listbox'],[role='grid'],table,.mail-list,.messagelist,.message-list,#messagelist,#message-list");
      if (!semantic) return false;
      if (providerName === "gmail") {
        return rect.left >= 120 && rect.left < Math.min(window.innerWidth * 0.55, 900) && rect.width >= 360 && rect.height >= 24 && rect.height <= 120;
      }
      if (providerName === "outlook") {
        return rect.left >= 140 && rect.left < Math.min(window.innerWidth * 0.52, 760) && rect.width >= 200 && rect.width <= 680 && rect.height >= 36 && rect.height <= 190;
      }
      if (providerName === "cuiqiu") {
        return rect.left >= 180 && rect.left < Math.min(window.innerWidth * 0.48, 760) && rect.width >= 240 && rect.height >= 28 && rect.height <= 190;
      }
      return rect.width >= 240 && rect.height >= 28 && rect.height <= 180;
    };
    const unreadLike = (node, text) => {
      const attr = [
        node.getAttribute("aria-label"),
        node.getAttribute("title"),
        node.getAttribute("data-testid"),
        node.getAttribute("data-isread"),
        node.getAttribute("data-read")
      ].join(" ").toLowerCase();
      const klass = String(node.className || "").toLowerCase();
      const lower = String(text || "").toLowerCase();
      const weight = Number.parseInt(getComputedStyle(node).fontWeight, 10) || 400;
      if (providerName === "gmail") {
        if (/\bunread\b|\bnot read\b|未读|未閱讀/.test(attr)) return true;
        if (/\bze\b/.test(klass) || node.matches("tr.zE") || node.closest("tr.zE")) return true;
        if (attr.includes("false") && /(isread|read)/.test(attr)) return true;
        return false;
      }
      if (providerName === "outlook") {
        if (/\bunread\b|\bnot read\b|未读|未閱讀/.test(attr)) return true;
        return weight >= 600;
      }
      if (/\bunread\b|\bnot read\b|未读|未閱讀/.test(attr) || /\bunread\b|未读|未閱讀/.test(lower)) return true;
      if (attr.includes("false") && /(isread|read)/.test(attr)) return true;
      return weight >= 700;
    };
    const rows = [];
    const seen = new Set();
    const rowSelector = providerName === "gmail"
      ? "tr[role='row'],tr,[role='main'] [role='link'],[role='main'] [role='row'],div[role='row'],div[role='listitem']"
      : providerName === "cuiqiu"
        ? "[role='option'],[role='row'],[role='listitem'],tr,li,.mail-list li,.mail-list-item,.messagelist li,.message-list li,#messagelist li,#message-list li"
        : "[role='option'],[role='row'],[role='listitem'],tr";
    for (const node of Array.from(document.querySelectorAll(rowSelector)).filter(visible).filter(rowLike)) {
      const text = normalize(node.innerText || node.textContent || "");
      if (!text || text.length < 8 || text.length > 1800) continue;
      const unread = unreadLike(node, text);
      const keepUnconfirmedOutlookUnreadView = providerName === "outlook";
      const keepUnconfirmedCuiqiuUnreadView = providerName === "cuiqiu";
      if (!unread && providerName !== "fastmo" && !keepUnconfirmedCuiqiuUnreadView && !keepUnconfirmedOutlookUnreadView) continue;
      const lines = text.split(/\n+/).map(normalize).filter(Boolean);
      const parsed = parseEmailRowLines(lines, providerName);
      const sender = parsed.sender;
      const subject = parsed.subject;
      const snippet = parsed.snippet;
      if (!sender || !subject) continue;
      const key = `${providerName}|${folderLabel}|${sender}|${subject}|${snippet}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const rect = node.getBoundingClientRect();
      const lastSeen = lines.find(isTime) || "";
      const idNode = providerName === "outlook"
        ? (node.matches?.("[data-convid]") ? node : node.querySelector?.("[data-convid]") || node.closest?.("[data-convid]"))
        : null;
      const outlookConversationId = idNode?.getAttribute?.("data-convid") || "";
      const outlookFolder = /\/mail\/junkemail(?:\/|$)/i.test(location.pathname) ? "junkemail" : "inbox";
      const sourceUrl = providerName === "outlook" && outlookConversationId
        ? `${location.origin}/mail/${outlookFolder}/id/${encodeURIComponent(outlookConversationId)}`
        : providerName === "cuiqiu"
          ? location.href
          : "";
      rows.push({ sender, subject, snippet, lastSeen, receivedAt: "", unread: true, folderLabel, sourceUrl, outlookConversationId, needsReview: providerName === "outlook" && !unread, clickX: rect.left + Math.min(rect.width * 0.45, rect.width - 10), clickY: rect.top + Math.min(rect.height * 0.5, rect.height - 8), lines: lines.slice(0, 18) });
    }
    return rows;

  }, { providerName: provider, folderLabel, parseEmailRowLinesSource: parseEmailRowLines.toString() });
}

async function resetEmailListScroll(page) {
  return await page.evaluate(() => {
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const findEmailListScroller = () => {
      const candidates = Array.from(document.querySelectorAll("main,section,div,[role='main'],[role='grid'],[role='listbox']"))
        .filter(visible)
        .map((node) => ({ node, rect: node.getBoundingClientRect(), text: node.innerText || node.textContent || "" }))
        .filter((item) => item.node.scrollHeight > item.node.clientHeight + 80 && item.rect.width > 260 && item.rect.height > 180)
        .map((item) => {
          const rowCount = item.node.querySelectorAll("[role='row'],[role='option'],[role='listitem'],tr").length;
          const text = item.text.toLowerCase();
          let score = rowCount * 10 + Math.min(item.rect.height, 900);
          if (/inbox|focused|other|junk|spam|收件箱|重点|其他|垃圾/.test(text)) score += 200;
          if (item.rect.left > window.innerWidth * 0.65) score -= 300;
          return { ...item, score };
        })
        .sort((a, b) => b.score - a.score);
      return candidates[0]?.node || document.scrollingElement || document.documentElement;
    };
    const scroller = findEmailListScroller();
    if (!scroller) return false;
    scroller.scrollTop = 0;
    return true;
  });
}

async function advanceEmailListScroll(page) {
  return await page.evaluate(() => {
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const findEmailListScroller = () => {
      const candidates = Array.from(document.querySelectorAll("main,section,div,[role='main'],[role='grid'],[role='listbox']"))
        .filter(visible)
        .map((node) => ({ node, rect: node.getBoundingClientRect(), text: node.innerText || node.textContent || "" }))
        .filter((item) => item.node.scrollHeight > item.node.clientHeight + 80 && item.rect.width > 260 && item.rect.height > 180)
        .map((item) => {
          const rowCount = item.node.querySelectorAll("[role='row'],[role='option'],[role='listitem'],tr").length;
          const text = item.text.toLowerCase();
          let score = rowCount * 10 + Math.min(item.rect.height, 900);
          if (/inbox|focused|other|junk|spam|收件箱|重点|其他|垃圾/.test(text)) score += 200;
          if (item.rect.left > window.innerWidth * 0.65) score -= 300;
          return { ...item, score };
        })
        .sort((a, b) => b.score - a.score);
      return candidates[0]?.node || document.scrollingElement || document.documentElement;
    };
    const scroller = findEmailListScroller();
    if (!scroller) return false;
    const before = scroller.scrollTop;
    const step = Math.max(280, Math.floor(scroller.clientHeight * 0.82));
    scroller.scrollTop = Math.min(scroller.scrollTop + step, scroller.scrollHeight);
    return Math.abs(scroller.scrollTop - before) > 12;
  });
}

async function clickEmailNavigation(page, patterns) {
  return await page.evaluate((patterns) => {
    const normalize = (value) => String(value || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
    const labelOf = (node) => normalize([
      node.innerText || "",
      node.textContent || "",
      node.getAttribute("aria-label") || "",
      node.getAttribute("title") || ""
    ].join(" "));
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const wanted = patterns.map((item) => String(item || "").toLowerCase());
    const nodes = Array.from(document.querySelectorAll("button,a,[role='tab'],[role='treeitem'],[role='link'],[role='button'],div,span"))
      .filter(visible)
      .map((node) => {
        const rect = node.getBoundingClientRect();
        const text = labelOf(node);
        const role = String(node.getAttribute("role") || "").toLowerCase();
        const semantic = node.tagName === "BUTTON" || node.tagName === "A" || /^(tab|treeitem|link|button)$/.test(role);
        const lines = text.split(/\n+/).map(normalize).filter(Boolean);
        let matchScore = 0;
        for (const pattern of wanted) {
          const lower = text.toLowerCase();
          if (lower === pattern) matchScore = Math.max(matchScore, 1000);
          if (lines.some((line) => line.toLowerCase() === pattern)) matchScore = Math.max(matchScore, 900);
          if (semantic && lower.includes(pattern)) matchScore = Math.max(matchScore, 450);
          if (semantic && lines.some((line) => line.toLowerCase().includes(pattern))) matchScore = Math.max(matchScore, 420);
        }
        const area = rect.width * rect.height;
        const score = matchScore + (semantic ? 140 : 0) - Math.min(text.length, 300) * 0.6 - Math.min(area / 1000, 500);
        return { node, text, rect, semantic, matchScore, score };
      })
      .filter((item) => item.text && item.matchScore > 0 && item.text.length <= 420)
      .sort((a, b) => b.score - a.score || a.rect.top - b.rect.top || a.rect.left - b.rect.left);
    const target = nodes[0];
    if (!target) return "";
    target.node.click();
    return target.text;
  }, patterns);
}

function collectEmailDetailSnapshotInPage({ providerName, ownEmails, row, cleanOutlookDraftReplyTextSource }) {
    const normalize = (value) => (value || "").replace(/[\u200b\u200c\u200d\uFEFF]/g, "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
    const cleanOutlookDraftReplyText = cleanOutlookDraftReplyTextSource
      ? (0, eval)(`(${cleanOutlookDraftReplyTextSource})`)
      : ((value) => normalize(value));
    const dedupeLocal = (items) => {
      const out = [];
      const seen = new Set();
      for (const item of items || []) {
        const key = String(item || "").toLowerCase().replace(/\s+/g, " ");
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(item);
      }
      return out;
    };
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const isChromeLine = (line = "") => {
      const text = normalize(line);
      if (!text) return true;
      if (/^\d{1,2}:\d{2}(?:\s*\(.+?\))?$/.test(text)) return true;
      if (/^(today|yesterday|mon|tue|wed|thu|fri|sat|sun)\b/i.test(text)) return true;
      if (/^(回复|答复|全部答复|更多|转发|添加回应|添加表情符号回应|发送至 我|全部隐藏|全部打印|在新窗口中查看|写邮件|标签|收件箱|已加星标|已延后|已发邮件|草稿|显示更多标签|升级|搜索|跳至内容|收件人: 你|收件人:​你​)$/.test(text)) return true;
      if (/^(reply|reply all|more|forward|print all|open in new window|compose|labels|inbox|starred|snoozed|sent|drafts|search)$/i.test(text)) return true;
      if (/通过屏幕阅读器使用 gmail|免费试用 gemini|搜索所有带|从此会话中移除|邮件部分隐藏|查看邮件全文/i.test(text)) return true;
      if (/已阻止此邮件中的某些内容|该发件人不在安全发件人列表|信任发件人|翻译自|翻译至|显示原始邮件|打开自动翻译|始终不翻译|此消息的语言为|you replied on|you replied|you answered|你已在.*答复/i.test(text)) return true;
      if (/getting too much email|unsubscribe|manage subscriptions/i.test(text)) return true;
      if (/^on .+ wrote:$/i.test(text)) return true;
      return false;
    };
    const normalizeMessageText = (value = "") => {
      return normalize(String(value || "")
        .replace(/…?\s*\[?邮件部分隐藏\]?\s*查看邮件全文/gi, "")
        .replace(/…?\s*\[?message clipped\]?\s*view entire message/gi, ""));
    };
    const outlookSuggestedReplyKey = (value = "") => normalizeMessageText(value)
      .toLowerCase()
      .replace(/[.!?。！？]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const isOutlookSuggestedReplyLine = (line = "") => {
      const key = outlookSuggestedReplyKey(line);
      return [
        "your order has been cancelled",
        "ok, thanks for letting me know",
        "thank you for your response",
        "here is the tracking info",
        "yes, i will check",
        "i will check on it",
        "i will check that for you"
      ].includes(key);
    };
    const removeOutlookSuggestedReplyTail = (lines = []) => {
      const cutoff = lines.findIndex((line) => /^[.…]+$/.test(normalizeMessageText(line)) || /suggested replies|建议的答复|建議的答覆|快速操作/i.test(normalizeMessageText(line)));
      const base = cutoff >= 0 ? lines.slice(0, cutoff) : lines.slice();
      let end = base.length;
      while (end > 0 && isOutlookSuggestedReplyLine(base[end - 1])) end -= 1;
      if (base.length - end >= 1) return base.slice(0, end);
      return base;
    };
    const messageRoleFromHeader = (value = "") => {
      const text = normalize(value).toLowerCase();
      if (/^(你|我|you|me)$/.test(text)) return "store";
      if (/(^|\s)(你|我)\s*</.test(text)) return "store";
      return "customer";
    };
    const parseLineMessages = (lines = []) => {
      const messages = [];
      let current = null;
      const flush = () => {
        if (!current) return;
        const cleaned = dedupeLocal(current.lines.map(normalizeMessageText).filter(Boolean))
          .filter((line) => !isChromeLine(line))
          .filter((line) => !/^[.…]+$/.test(line))
          .filter((line) => line.length <= 1200);
        const text = cleaned.join("\n").trim();
        if (text && text.length >= 2) messages.push({ role: current.role, text, time: current.time || "" });
        current = null;
      };
      for (const raw of lines || []) {
        const line = normalize(raw);
        if (!line) continue;
        const headerEmail = /^[^<>\n]{1,160}<[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}>/i.test(line);
        const ownHeader = /^(你|我|you|me)$/i.test(line);
        if (headerEmail || ownHeader) {
          flush();
          current = { role: messageRoleFromHeader(line), lines: [], time: line.match(/\b\d{1,2}:\d{2}\b/)?.[0] || "" };
          continue;
        }
        if (!current) current = { role: "customer", lines: [], time: "" };
        if (isChromeLine(line)) continue;
        current.lines.push(line);
      }
      flush();
      return messages;
    };
    const gmailSenderEmail = (block) => (block?.querySelector?.(".gD[email],.go[email],[email]")?.getAttribute("email")
      || block?.querySelector?.(".gD[data-hovercard-id],.go[data-hovercard-id],[data-hovercard-id]")?.getAttribute("data-hovercard-id")
      || "").toLowerCase();
    const gmailSenderName = (block) => normalize(block?.querySelector?.(".gD,.go,.g2")?.getAttribute("name")
      || block?.querySelector?.(".gD,.go,.g2")?.innerText
      || "");
    const isGmailTimeLine = (line = "") => {
      const text = normalize(line);
      return /^\d{1,2}:\d{2}(?:\s*\(.+?\))?$/.test(text)
        || /(?:20\d{2}年)?\d{1,2}月\d{1,2}日/.test(text)
        || /\d{1,2}:\d{2}.*(?:分钟前|小时前|天前)/.test(text)
        || /(?:minutes?|hours?|days?) ago/i.test(text);
    };
    const gmailMessageTime = (block) => {
      const title = normalize(block?.querySelector?.(".g3[title]")?.getAttribute("title") || "");
      if (title) return title;
      const visibleTime = normalize(block?.querySelector?.(".g3,.gK,.gH.VYc0jb")?.innerText || "");
      if (visibleTime) return visibleTime;
      return normalize(block?.innerText || "").match(/(?:20\d{2}年)?\d{1,2}月\d{1,2}日[^\n]*?\d{1,2}:\d{2}|\b\d{1,2}:\d{2}(?:\s*\(.+?\))?/)?.[0] || "";
    };
    const cleanGmailMessageLines = (lines = [], block) => {
      const senderEmail = gmailSenderEmail(block);
      const senderName = gmailSenderName(block);
      const cleaned = [];
      for (const raw of lines) {
        let line = normalizeMessageText(raw);
        if (!line || line.length > 1200) continue;
        if (/^[.…]+$/.test(line) || isChromeLine(line) || isGmailTimeLine(line)) continue;
        if (senderEmail && line.toLowerCase().includes(senderEmail)) continue;
        if (senderName && normalize(line).toLowerCase() === senderName.toLowerCase()) continue;
        if (/^(to me|发送至\s*我|收件人[:：]\s*我|发件人[:：]|日期[:：]|主题[:：])$/i.test(line)) continue;
        if (/^[-_]{2,}\s*Original Message\s*[-_]{2,}$/i.test(line)) break;
        if (/^On .+ wrote:?$/i.test(line)) break;
        if (/^[^<>\n]{0,120}<[^>]+>\s+于20\d{2}年.*写道：$/i.test(line)) break;
        if (senderName && line.toLowerCase().startsWith(`${senderName.toLowerCase()} `)) {
          line = line.slice(senderName.length).trim();
        }
        if (line) cleaned.push(line);
      }
      return dedupeLocal(cleaned);
    };
    const gmailBodyFromBlock = (block) => {
      const bodyNodes = Array.from(block?.querySelectorAll?.(".a3s,.ii") || [])
        .filter(visible)
        .map((node) => ({ node, rect: node.getBoundingClientRect(), text: node.innerText || node.textContent || "" }))
        .filter((item) => item.rect.width >= 180 && item.rect.height >= 6 && normalize(item.text).length >= 2)
        .filter((item) => !/^(reply|forward|show trimmed content|回复|转发|显示更多|查看邮件全文)$/i.test(normalize(item.text)));
      if (bodyNodes.length) {
        const lines = bodyNodes.flatMap((item) => String(item.text || "").split(/\n+/));
        const body = cleanGmailMessageLines(lines, block).join("\n").trim();
        if (body) return body;
      }
      const cardLines = String(block?.innerText || block?.textContent || "").split(/\n+/);
      return cleanGmailMessageLines(cardLines, block).join("\n").trim();
    };
    const extractGmailMessages = () => {
      const out = [];
      const seen = new Set();
      const roots = [];
      const addRoot = (node) => {
        if (!node || roots.includes(node) || !visible(node)) return;
        roots.push(node);
      };
      for (const node of Array.from(document.querySelectorAll(".h7,[role='listitem'],.adn")).filter(visible)) {
        const root = node.closest(".h7,[role='listitem']") || node;
        if (root.querySelector(".gD,.go,.a3s,.ii")) addRoot(root);
      }
      for (const node of Array.from(document.querySelectorAll(".a3s,.ii")).filter(visible)) {
        addRoot(node.closest(".h7,[role='listitem']") || node.closest(".adn") || node);
      }
      for (const block of roots.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)) {
        const rect = block.getBoundingClientRect();
        if (rect.width < 240 || rect.height < 18) continue;
        const body = gmailBodyFromBlock(block);
        if (!body || body.length < 2) continue;
        const header = normalize(block?.innerText || "");
        const senderEmail = gmailSenderEmail(block);
        const preBody = header.split(body)[0] || "";
        const role = (senderEmail && ownEmails.includes(senderEmail)) || /(^|\n)\s*(我|me)\s*(\n|$)/i.test(preBody) ? "store" : "customer";
        const key = `${role}|${body.toLowerCase().replace(/\s+/g, " ")}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ role, text: body, time: gmailMessageTime(block), email: senderEmail || header.match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i)?.[0] || "" });
      }
      return out;
    };
    const isInitialLine = (line = "") => /^[A-Z]{1,4}$/.test(normalize(line));
    const isOutlookDateLine = (line = "") => {
      const text = normalize(line);
      return /(?:周.|星期.|Mon|Tue|Wed|Thu|Fri|Sat|Sun|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+20\d{2}[-/年]\d{1,2}[-/月]\d{1,2}.*\d{1,2}:\d{2}/i.test(text)
        || /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b.*\d{1,2}:\d{2}/i.test(text);
    };
    const isOutlookReplyNoticeLine = (line = "") => /你已在.*答复|you replied|you answered|you responded/i.test(normalize(line));
    const isOutlookMessageDateLine = (line = "") => isOutlookDateLine(line) && !isOutlookReplyNoticeLine(line);
    const stripQuotedReplyFromText = (value = "", role = "customer") => {
      let text = normalizeMessageText(value);
      text = text.replace(/\s+On\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|.{0,40}\d{4})[\s\S]{0,220}\bwrote:\s*[\s\S]*$/i, "");
      text = text.replace(/\s+On\s+.{1,180}<[^>]+>\s+wrote:\s*[\s\S]*$/i, "");
      text = text.replace(/\s*>+\s*On\s+[\s\S]*$/i, "");
      if (role !== "store") {
        text = text.replace(/\nDear\s+[^\n,]{1,60},\s*\n(?:Thank you|I have|Regarding|This is|We have|Your package)[\s\S]*$/i, "");
        text = text.replace(/\n(?:Thank you for reaching out|Thank you for your message|You are very welcome!|No problem\. Have a great day!)[\s\S]*$/i, "");
      }
      const lines = text.split(/\n+/).map(normalizeMessageText).filter(Boolean);
      const out = [];
      for (const line of lines) {
        if (/^>/.test(line)) break;
        if (/^On .+ wrote:?$/i.test(line)) break;
        if (/^[-_]{2,}\s*Original Message\s*[-_]{2,}$/i.test(line)) break;
        out.push(line);
      }
      return out.join("\n").trim();
    };
    const cleanOutlookBodyLines = (lines = [], role = "customer") => {
      const body = [];
      for (const raw of lines) {
        const line = normalizeMessageText(raw);
        if (/^[.…]+$/.test(line) || /suggested replies|建议的答复|建議的答覆|快速操作/i.test(line)) break;
        if (!line || isChromeLine(line) || isInitialLine(line) || isOutlookReplyNoticeLine(line)) continue;
        if (/^(sent from my iphone|sent from my android)$/i.test(line)) continue;
        if (/^(收件人|发件人|To|From|Cc|Bcc)\s*[:：]/i.test(line)) continue;
        if (/^(Tracy Zemanek|Antonia Garcia|Efrain Robles|hu qiang)$/i.test(line)) continue;
        body.push(line);
      }
      const stripped = stripQuotedReplyFromText(removeOutlookSuggestedReplyTail(body).join("\n"), role);
      return stripped.split(/\n+/).map(normalizeMessageText).filter(Boolean).filter((line) => !isChromeLine(line) && !isInitialLine(line));
    };
    const isOutlookDraftRow = () => /^\s*\[Draft\]/i.test(String(row?.sender || ""))
      || (Array.isArray(row?.lines) && row.lines.some((line) => /^\s*\[Draft\]/i.test(String(line || ""))));
    const isLikelyOutlookStoreDraft = (text = "") => {
      const value = normalizeMessageText(text);
      return /^Dear\s+[A-Z][a-zA-Z .'-]{1,80},/i.test(value)
        || /^Sehr geehrte(?:r)?\s+/i.test(value)
        || /\b(?:Customer Support Team|Kundenservice|Ihr Kundenservice-Team)\b/i.test(value);
    };
    const extractOutlookDraftMessages = () => {
      if (!isOutlookDraftRow()) return [];
      const detailLeft = outlookDetailLeft();
      const candidates = Array.from(document.querySelectorAll("[contenteditable='true'],[role='textbox'],[aria-label*='Message body'],[aria-label*='Nachricht'],main,article,[role='main'],[role='document'],section,div"))
        .filter(visible)
        .map((node) => ({ node, rect: node.getBoundingClientRect(), text: normalize(node.innerText || node.textContent || "") }))
        .filter((item) => item.rect.left > detailLeft && item.rect.top >= 150 && item.rect.width > 320 && item.rect.height >= 36 && item.rect.height <= 3600)
        .filter((item) => item.text.length >= 12 && item.text.length <= 20000)
        .map((item) => {
          const attr = [
            item.node.getAttribute?.("contenteditable") || "",
            item.node.getAttribute?.("role") || "",
            item.node.getAttribute?.("aria-label") || ""
          ].join(" ");
          const cleaned = cleanOutlookDraftReplyText(item.text);
          let score = cleaned.length;
          if (/contenteditable|textbox|message body|nachricht/i.test(attr)) score += 600;
          if (emailTextIncludes(row?.snippet || "", cleaned) || emailTextIncludes(cleaned, row?.snippet || "")) score += 800;
          if (/^(Message|Insert|Format text|Draw|Options)\b/i.test(item.text)) score -= 300;
          return { ...item, cleaned, score };
        })
        .filter((item) => item.cleaned && item.cleaned.length >= 8)
        .sort((a, b) => b.score - a.score || a.rect.top - b.rect.top);
      const best = candidates[0];
      if (!best) return [];
      const role = isLikelyOutlookStoreDraft(best.cleaned) ? "store" : "customer";
      return [{ role, text: best.cleaned, time: row?.lastSeen || "", email: "" }];
    };
    const mergeDraftOutlookMessages = (messages = [], draftMessages = []) => {
      if (!draftMessages.length) return messages;
      const merged = Array.isArray(messages) ? messages.slice() : [];
      for (const draft of draftMessages) {
        const draftKey = normalizeMessageText(draft?.text || "").toLowerCase().replace(/\s+/g, " ");
        if (!draftKey) continue;
        const duplicate = merged.some((message) => {
          const key = normalizeMessageText(message?.text || "").toLowerCase().replace(/\s+/g, " ");
          return key && (key.includes(draftKey.slice(0, Math.min(80, draftKey.length))) || draftKey.includes(key.slice(0, Math.min(80, key.length))));
        });
        if (!duplicate) merged.unshift(draft);
      }
      return merged;
    };
    const emailTextIncludes = (haystack = "", needle = "") => {
      const left = normalizeMessageText(haystack).toLowerCase().replace(/\s+/g, " ");
      const right = normalizeMessageText(needle).toLowerCase().replace(/\s+/g, " ");
      if (!left || !right) return false;
      const short = right.slice(0, Math.min(80, right.length));
      return short.length >= 8 && left.includes(short);
    };
    const outlookDetailLeft = () => {
      const rowRights = Array.from(document.querySelectorAll("[role='option'],[role='row'],[role='listitem'],tr"))
        .filter(visible)
        .map((node) => ({ rect: node.getBoundingClientRect(), text: normalize(node.innerText || node.textContent || "") }))
        .filter((item) => item.rect.left >= 120 && item.rect.left < Math.min(window.innerWidth * 0.48, 760))
        .filter((item) => item.rect.width >= 220 && item.rect.width <= 560 && item.rect.height >= 36 && item.rect.height <= 160)
        .filter((item) => item.text.length >= 8 && item.text.length <= 1800)
        .map((item) => item.rect.right);
      if (rowRights.length) return Math.max(320, Math.min(Math.max(...rowRights) + 12, window.innerWidth - 480));
      return Math.max(360, Math.min(window.innerWidth * 0.28, 620));
    };
    const pushOutlookMessage = (out, seenBodies, role, body, time = "", email = "") => {
      let text = normalizeMessageText(body);
      if (!text || text.length < 2) return;
      if (/^(sent from my iphone|sent from my android)$/i.test(text)) return;
      if (!/[a-z0-9\u4e00-\u9fff]/i.test(text)) return;
      if (text.length < 24 && /\b(reply|reply all|forward)\b|舒\s*阳/i.test(text)) return;
      const textLines = text.split(/\n+/).map(normalizeMessageText).filter(Boolean);
      if (/^[^\w]*[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i.test(textLines[0] || "")) return;
      if (textLines.length <= 4 && textLines.some((line) => /Bachelor of Arts|University|Liberal Studies/i.test(line)) && textLines.some((line) => /@/.test(line))) return;
      if (role === "customer" && out.length) {
        const matchKey = (value = "") => normalizeMessageText(value)
          .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
          .replace(/[\u201C\u201D\u201E\u201F]/g, "\"")
          .toLowerCase()
          .replace(/\s+/g, " ")
          .trim();
        for (const old of out.filter((message) => message.role === "customer")) {
          const oldFirst = normalizeMessageText(String(old.text || "").split(/\n+/).find((line) => normalizeMessageText(line).length >= 12) || "");
          if (!oldFirst) continue;
          const duplicateLineIndex = textLines.findIndex((line, index) => index > 0 && matchKey(line).startsWith(matchKey(oldFirst).slice(0, 60)));
          if (duplicateLineIndex > 0) {
            text = textLines.slice(0, duplicateLineIndex).join("\n").trim();
            break;
          }
        }
      }
      const key = `${role}|${text.toLowerCase().replace(/\s+/g, " ")}`;
      if (seenBodies.has(key)) return;
      const duplicate = out.findIndex((message) => {
        const oldKey = `${message.role}|${message.text.toLowerCase().replace(/\s+/g, " ")}`;
        const oldBody = normalizeMessageText(message.text || "").toLowerCase().replace(/\s+/g, " ");
        const newBody = normalizeMessageText(text || "").toLowerCase().replace(/\s+/g, " ");
        if (oldKey === key) return true;
        if (oldBody.length < 80 || newBody.length < 80) return false;
        return oldKey.includes(key) || key.includes(oldKey);
      });
      if (duplicate >= 0) {
        if (text.length > out[duplicate].text.length) out[duplicate] = { role, text, time, email };
        seenBodies.add(key);
        return;
      }
      seenBodies.add(key);
      out.push({ role, text, time, email });
    };
    const extractOutlookMessages = () => {
      const detailLeft = outlookDetailLeft();
      const rawCandidates = Array.from(document.querySelectorAll("main,article,[role='main'],[role='document'],section,div"))
        .filter(visible)
        .map((node) => ({ node, rect: node.getBoundingClientRect(), text: normalize(node.innerText || node.textContent || "") }))
        .filter((item) => item.rect.left > detailLeft && item.rect.top >= 130 && item.rect.width > 360 && item.rect.height >= 42 && item.rect.height <= 3600)
        .filter((item) => item.text.length >= 10 && item.text.length <= 12000)
        .filter((item) => item.text.split(/\n+/).filter(isOutlookMessageDateLine).length === 1);
      const unique = [];
      const seenText = new Set();
      for (const item of rawCandidates.sort((a, b) => (a.rect.width * a.rect.height) - (b.rect.width * b.rect.height))) {
        const key = item.text.toLowerCase().replace(/\s+/g, " ");
        if (!key || seenText.has(key)) continue;
        seenText.add(key);
        unique.push(item);
      }
      const out = [];
      const seenBodies = new Set();
      for (const item of unique.sort((a, b) => a.rect.top - b.rect.top)) {
        const lines = item.text.split(/\n+/).map(normalize).filter(Boolean);
        const dateIndex = lines.findIndex(isOutlookMessageDateLine);
        if (dateIndex < 0) continue;
        const header = lines.slice(0, dateIndex).join("\n");
        const headerEmail = header.match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i)?.[0] || "";
        const normalizedHeaderEmail = headerEmail.toLowerCase();
        const sentToCustomer = /(^|\n)\s*(to|收件人)\s*[:：]\s*(?!\s*(you|me|你|我)(\s|$))/i.test(header);
        const role = /(^|\n)(你|我|me|you)(\n|$)/i.test(header)
          || ownEmails.includes(normalizedHeaderEmail)
          || /^store\+\d+@(?:[a-z0-9-]+\.)?shopifyemail\.com$/i.test(normalizedHeaderEmail)
          || sentToCustomer
          ? "store"
          : "customer";
        const bodyLines = cleanOutlookBodyLines(lines.slice(dateIndex + 1), role);
        const body = bodyLines.join("\n").trim();
        pushOutlookMessage(out, seenBodies, role, body, lines[dateIndex], headerEmail);
      }
      if (!out.length) {
        const bodyOnlyCandidates = Array.from(document.querySelectorAll("[role='document'],div.OuGoX,div.XbIp4"))
          .filter(visible)
          .map((node) => ({ node, rect: node.getBoundingClientRect(), text: normalize(node.innerText || node.textContent || "") }))
          .filter((item) => item.rect.left > detailLeft && item.rect.left <= detailLeft + 260 && item.rect.top >= 130 && item.rect.width > 300 && item.rect.height >= 30 && item.rect.height <= 3600)
          .filter((item) => item.text.length >= 8 && item.text.length <= 12000)
          .filter((item) => !item.text.split(/\n+/).some(isOutlookDateLine));
        for (const item of bodyOnlyCandidates.sort((a, b) => a.rect.top - b.rect.top)) {
          const lines = item.text.split(/\n+/).map(normalize).filter(Boolean);
          const body = cleanOutlookBodyLines(lines, "customer").join("\n").trim();
          pushOutlookMessage(out, seenBodies, "customer", body, "");
        }
      }
      return out;
    };
    if (providerName === "gmail") {
      const fullText = normalize(document.body?.innerText || "");
      const clipped = /邮件部分隐藏|查看邮件全文|message clipped|view entire message/i.test(fullText);
      const messages = extractGmailMessages();
      const bodyNodes = Array.from(document.querySelectorAll(".a3s,.ii"))
        .filter(visible)
        .map((node) => ({ node, rect: node.getBoundingClientRect(), text: node.innerText || node.textContent || "" }))
        .filter((item) => item.rect.width > 240 && item.rect.height > 8 && item.text.length > 2)
        .filter((item) => !/^(reply|forward|show trimmed content|回复|转发|显示更多|查看邮件全文)$/i.test(normalize(item.text)));
      if (bodyNodes.length) {
        const text = normalize(bodyNodes.map((item) => item.text).join("\n"));
        const lines = dedupeLocal(text.split(/\n+/).map(normalize).filter(Boolean).filter((line) => line.length <= 500)).slice(0, 120);
        return { lines, messages, email: (fullText.match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i) || [""])[0], clipped };
      }
    }
    if (providerName === "outlook") {
      const draftMessages = extractOutlookDraftMessages();
      const messages = mergeDraftOutlookMessages(extractOutlookMessages(), draftMessages);
      if (messages.length) {
        const fullText = normalize(document.body?.innerText || "");
        return {
          lines: messages.flatMap((message) => [message.time, message.text]).filter(Boolean),
          messages,
          email: (fullText.match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i) || [""])[0]
        };
      }
      return { lines: [], messages: [], email: "" };
    }
    const candidates = Array.from(document.querySelectorAll("main,article,[role='main'],[role='document'],section,div")).filter(visible)
      .map((node) => ({ node, rect: node.getBoundingClientRect(), text: node.innerText || node.textContent || "" }))
      .filter((item) => item.rect.width > 320 && item.rect.height > 160 && item.text.length > 40)
      .filter((item) => !/^(outlook|cuiqiu)$/i.test(providerName) || (item.rect.left > outlookDetailLeft() && item.rect.top >= 130))
      .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height);
    const text = normalize(candidates[0]?.text || document.body.innerText || "");
    const lines = dedupeLocal(text.split(/\n+/).map(normalize).filter(Boolean).filter((line) => line.length <= 500)).slice(0, 120);
    return { lines, messages: parseLineMessages(lines), email: (text.match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i) || [""])[0] };
}

async function readEmailConversation(page, provider, row, options = {}) {
  await captureEmailVisualDebug(page, provider, row, "before-open", { preserveCurrentList: Boolean(options?.preserveCurrentList) }).catch(() => {});
  await openEmailRow(page, provider, row, options);
  let waitMatched = true;
  try {
    await waitForEmailDetailMatch(page, provider, row);
  } catch (error) {
    if (/^outlook$/i.test(provider || "")) throw error;
    waitMatched = false;
    if (!options?.preserveCurrentList) throw error;
    await openEmailRow(page, provider, row, { preserveCurrentList: false, activateTarget: options?.activateTarget });
    await waitForEmailDetailMatch(page, provider, row);
    waitMatched = true;
  }
  await page.waitForTimeout(waitMatched ? 850 : 1400);
  await captureEmailVisualDebug(page, provider, row, "detail-opened", { waitMatched }).catch(() => {});
  if (provider === "gmail") {
    const hasGmailDetail = await page.locator(".gD,.a3s,.ii").first().waitFor({ timeout: 2500 }).then(() => true).catch(() => false);
    if (!hasGmailDetail) throw new Error("gmail detail body was not opened");
    await expandGmailConversationCards(page).catch(() => 0);
    await expandGmailTrimmedContent(page).catch(() => 0);
  }
  if (provider === "outlook") {
    await expandOutlookCollapsedMessageCards(page, row).catch(() => 0);
  }
  await captureEmailVisualDebug(page, provider, row, "after-expand", {}).catch(() => {});
  const detail = await page.evaluate(collectEmailDetailSnapshotInPage, {
    providerName: provider,
    ownEmails: emailOwnMailboxes(options?.shopName || "", row),
    row,
    cleanOutlookDraftReplyTextSource: cleanOutlookDraftReplyText.toString()
  });
  await captureEmailVisualDebug(page, provider, row, "after-first-extract", {
    lineCount: (detail.lines || []).length,
    messageCount: (detail.messages || []).length,
    clipped: Boolean(detail.clipped)
  }).catch(() => {});
  const scrolledDetail = await scanEmailDetailScroll(page, provider, row, options?.shopName || "");
  await captureEmailVisualDebug(page, provider, row, "after-scroll-extract", {
    lineCount: (scrolledDetail.lines || []).length,
    messageCount: (scrolledDetail.messages || []).length,
    clipped: Boolean(scrolledDetail.clipped)
  }).catch(() => {});
  detail.lines = dedupe([...(detail.lines || []), ...(scrolledDetail.lines || [])]);
  detail.messages = mergeEmailDetailMessages([...(detail.messages || []), ...(scrolledDetail.messages || [])]);
  detail.email = detail.email || scrolledDetail.email || "";
  const clipped = Boolean(detail.clipped || scrolledDetail.clipped);
  const cleanLines = cleanEmailDetailLines(provider, detail.lines, row);
  let detailMessages = cleanEmailDetailMessages(provider, detail.messages, row);
  if (provider === "outlook" && isOutlookDraftEmailRow(row)) {
    detailMessages = ensureRowSnippetMessage(provider, detailMessages, row);
  }
  const body = (detailMessages.length ? detailMessages.map((message) => message.text).join("\n") : cleanLines.join("\n")).trim();
  const matchText = [body, cleanLines.join("\n"), (detail.lines || []).join("\n")].filter(Boolean).join("\n");
  const urlMatched = provider === "outlook" && outlookUrlMatchesConversationId(page.url(), row?.outlookConversationId || "");
  const textMatched = emailDetailMatchesRow(matchText, row);
  const snippetMatched = emailTextIncludesRowSnippet(matchText, row);
  const usableOutlookDetail = urlMatched && hasUsableEmailDetail({ body, cleanLines, detailMessages });
  const messages = detailMessages.length ? detailMessages : [{ role: "customer", text: body || row.snippet, time: row.lastSeen }];
  const provisionalConversation = {
    customerName: row.sender,
    customerFullName: row.sender,
    customerEmail: detail.email || "",
    preview: row.snippet,
    topic: row.subject,
    rawLines: [`${provider.toUpperCase()}: ${messages.map((message) => `${message.role}: ${message.text}`).join("\n") || row.lines.join("\n")}`],
    messages
  };
  const detailMismatch = !textMatched && !snippetMatched && !usableOutlookDetail;
  if (detailMismatch && provider === "gmail" && !shouldKeepEmailConversation(row, provisionalConversation)) {
    return null;
  }
  if (detailMismatch && !hasUsableEmailDetail({ body, cleanLines, detailMessages })) {
    throw new Error("email detail did not match the selected row");
  }
  if (provider === "outlook") {
    const imageAssets = await captureOutlookCustomerEmailImages(page, row, messages).catch(() => []);
    if (imageAssets.length) {
      const target = messages.find((message) => message.role !== "store" && emailTextIncludesRowSnippet(message.text || "", row))
        || messages.find((message) => message.role !== "store")
        || messages[0];
      target.attachments = dedupeMessageAssets([...(target.attachments || []), ...imageAssets]);
    }
  }
  const customerEmail = selectReplyableEmail({ row, detail, messages, shopName: options?.shopName || "" });
  return {
    id: stableHash(`${provider}\n${row.sender}\n${row.subject}\n${row.snippet}`),
    customerName: row.sender,
    customerFullName: row.sender,
    customerEmail,
    preview: row.snippet,
    topic: row.subject,
    lastSeen: row.lastSeen,
    receivedAt: row.receivedAt || parseEmailReceivedAt(row.lastSeen || row.lines.join(" ")),
    status: "pending",
    sendStatus: "",
    detailLoaded: true,
    source: provider,
    conversationId: stableHash(`${provider}\n${row.sender}\n${row.subject}`).slice(0, 24),
    sourceUrl: row.sourceUrl || page.url(),
    fetchedAt: new Date().toISOString(),
    rawLines: [`${provider.toUpperCase()}: ${messages.map((message) => `${message.role}: ${message.text}`).join("\n") || row.lines.join("\n")}`],
    messages,
    customerProfileLines: [],
    orderCartLines: [],
    orderLinks: extractOrderLinks(cleanLines),
    productCards: [],
    dataSources: ["playwright", "email_dom", messages.some((message) => (message.attachments || []).length) ? "email_images" : "", clipped ? "email_clipped" : ""].filter(Boolean),
    dataConflict: !body || detailMismatch,
    needsReview: Boolean(row.needsReview) || clipped || !customerEmail || !body || detailMismatch,
    detailFingerprint: stableHash(cleanLines.join("\n"))
  };
}

async function captureOutlookCustomerEmailImages(page, row = {}, messages = []) {
  const rowProbeText = [
    row?.sender || "",
    row?.snippet || "",
    ...messages.filter((message) => message?.role !== "store").map((message) => message?.text || "")
  ].join("\n");
  const conversationKey = stableHash([
    "outlook",
    row?.outlookConversationId || "",
    row?.sender || "",
    row?.subject || "",
    row?.snippet || ""
  ].join("\n")).slice(0, 18);
  const targetDir = path.resolve(emailAssetDir, conversationKey);
  const assets = [];
  const seenRects = new Set();
  const seenImages = new Set();
  mkdirSync(targetDir, { recursive: true });
  const hasImageCue = /\b(image|images|photo|photos|picture|pictures|screenshot|screenshots|attachment|attachments|attached|label|tracking|barcode|qr)\b|\u56fe\u7247|\u7167\u7247|\u9644\u4ef6|\u622a\u56fe|\u6807\u7b7e|\u9762\u5355|\u8ffd\u8e2a/i.test(rowProbeText);
  const hasVisibleDetailImage = await page.evaluate(() => {
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const detailLeft = (() => {
      const normalize = (value) => String(value || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
      const rowRights = Array.from(document.querySelectorAll("[role='option'],[role='row'],[role='listitem'],tr"))
        .filter(visible)
        .map((node) => ({ rect: node.getBoundingClientRect(), text: normalize(node.innerText || node.textContent || "") }))
        .filter((item) => item.rect.left >= 120 && item.rect.left < Math.min(window.innerWidth * 0.48, 760))
        .filter((item) => item.rect.width >= 220 && item.rect.width <= 560 && item.rect.height >= 36 && item.rect.height <= 160)
        .filter((item) => item.text.length >= 8 && item.text.length <= 1800)
        .map((item) => item.rect.right);
      if (rowRights.length) return Math.max(320, Math.min(Math.max(...rowRights) + 12, window.innerWidth - 480));
      return Math.max(360, Math.min(window.innerWidth * 0.28, 620));
    })();
    return Array.from(document.querySelectorAll("img")).some((img) => {
      if (!visible(img)) return false;
      const rect = img.getBoundingClientRect();
      return rect.left > detailLeft && rect.top >= 100 && rect.top <= window.innerHeight - 60 && rect.width >= 40 && rect.height >= 40;
    });
  }).catch(() => false);
  if (!hasImageCue && !hasVisibleDetailImage) return [];
  const scanPositions = await page.evaluate((maxPasses) => {
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const candidates = Array.from(document.querySelectorAll("main,article,[role='main'],[role='document'],section,div"))
      .filter(visible)
      .map((node) => ({ node, rect: node.getBoundingClientRect() }))
      .filter((item) => item.rect.left > (() => {
        const rowRights = Array.from(document.querySelectorAll("[role='option'],[role='row'],[role='listitem'],tr"))
          .filter(visible)
          .map((node) => ({ rect: node.getBoundingClientRect(), text: String(node.innerText || node.textContent || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim() }))
          .filter((row) => row.rect.left >= 120 && row.rect.left < Math.min(window.innerWidth * 0.48, 760))
          .filter((row) => row.rect.width >= 220 && row.rect.width <= 560 && row.rect.height >= 36 && row.rect.height <= 160)
          .filter((row) => row.text.length >= 8 && row.text.length <= 1800)
          .map((row) => row.rect.right);
        if (rowRights.length) return Math.max(320, Math.min(Math.max(...rowRights) + 12, window.innerWidth - 480));
        return Math.max(360, Math.min(window.innerWidth * 0.28, 620));
      })() && item.rect.top >= 130 && item.rect.width > 320 && item.rect.height > 180 && item.node.scrollHeight > item.node.clientHeight + 80)
      .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height);
    const scroller = candidates[0]?.node || document.scrollingElement || document.documentElement;
    const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const steps = Math.max(2, Math.min(maxPasses || 10, 14));
    const positions = new Set([0, maxTop, scroller.scrollTop || 0]);
    for (let i = 1; i < steps; i += 1) positions.add(Math.round(maxTop * i / steps));
    return Array.from(positions).sort((a, b) => a - b);
  }, emailDetailScrollActions).catch(() => [0]);
  for (const pos of scanPositions) {
    if (assets.length >= 6) break;
    await page.evaluate((pos) => {
      const visible = (node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      const candidates = Array.from(document.querySelectorAll("main,article,[role='main'],[role='document'],section,div"))
        .filter(visible)
        .map((node) => ({ node, rect: node.getBoundingClientRect() }))
        .filter((item) => item.rect.left > 360 && item.rect.top >= 120 && item.rect.width > 320 && item.rect.height > 180 && item.node.scrollHeight > item.node.clientHeight + 80)
        .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height);
      const scroller = candidates[0]?.node || document.scrollingElement || document.documentElement;
      scroller.scrollTop = Math.max(0, Math.min(pos, scroller.scrollHeight - scroller.clientHeight));
      scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    }, pos).catch(() => {});
    await page.waitForTimeout(420).catch(() => {});
    const handles = await page.$$("img").catch(() => []);
    for (const handle of handles) {
      if (assets.length >= 6) break;
    const meta = await handle.evaluate((img, rowProbeText) => {
      const normalize = (value) => String(value || "")
        .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
        .replace(/[\u201C\u201D\u201E\u201F]/g, "\"")
        .replace(/\u00a0/g, " ")
        .replace(/[ \t]+/g, " ")
        .trim();
      const matchKey = (value = "") => normalize(value).toLowerCase().replace(/\s+/g, " ").trim();
      const visible = (node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      const rowRights = Array.from(document.querySelectorAll("[role='option'],[role='row'],[role='listitem'],tr"))
        .filter(visible)
        .map((node) => ({ rect: node.getBoundingClientRect(), text: normalize(node.innerText || node.textContent || "") }))
        .filter((item) => item.rect.left >= 120 && item.rect.left < Math.min(window.innerWidth * 0.45, 650))
        .filter((item) => item.rect.width >= 240 && item.rect.width <= 520 && item.rect.height >= 48 && item.rect.height <= 130)
        .filter((item) => item.text.length >= 4 && item.text.length <= 1800)
        .map((item) => item.rect.right);
      const detailLeft = rowRights.length ? Math.max(...rowRights) + 12 : 625;
      if (!visible(img)) return { ok: false, reason: "hidden" };
      const rect = img.getBoundingClientRect();
      if (rect.left <= detailLeft || rect.top < 120) return { ok: false, reason: "outside-detail" };
      if (rect.width < 120 || rect.height < 120) return { ok: false, reason: "too-small", width: rect.width, height: rect.height };
      if (rect.width > window.innerWidth * 0.9 || rect.height > 3200) return { ok: false, reason: "implausible-size" };
      const src = String(img.currentSrc || img.src || "");
      const label = normalize([img.alt || "", img.getAttribute("aria-label") || "", img.getAttribute("title") || ""].join(" "));
      if (/favicon|logo|sprite|avatar|profile|tracking|pixel|spacer|transparent/i.test(`${src} ${label}`)) {
        return { ok: false, reason: "decorative" };
      }
      const doc = img.closest("[role='document'],div.OuGoX,div.XbIp4") || img.closest("article,section,div");
      const docText = normalize(doc?.innerText || doc?.textContent || "");
      const probe = matchKey(rowProbeText).slice(0, 80);
      const docKey = matchKey(docText);
      const customerIntent = /requesting a refund|false advertisement|this is what i received|disappointed|junk back/i.test(docText);
      if (probe && !docKey.includes(probe) && !customerIntent) {
        return { ok: false, reason: "not-current-message" };
      }
      return {
        ok: true,
        rect: {
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        },
        naturalWidth: Number(img.naturalWidth || 0),
        naturalHeight: Number(img.naturalHeight || 0),
        src: src.slice(0, 400),
        alt: label.slice(0, 120)
      };
    }, rowProbeText).catch((error) => ({ ok: false, reason: error?.message || String(error) }));
    if (!meta?.ok) continue;
    const imageKey = meta.src
      ? `${meta.src}|${meta.naturalWidth || meta.rect.width}|${meta.naturalHeight || meta.rect.height}`.toLowerCase()
      : `${meta.alt}|${meta.rect.width}|${meta.rect.height}`.toLowerCase();
    if (seenImages.has(imageKey)) continue;
    seenImages.add(imageKey);
    const rectKey = `${meta.rect.left}|${meta.rect.top}|${meta.rect.width}|${meta.rect.height}`;
    if (seenRects.has(rectKey)) continue;
    seenRects.add(rectKey);
    const fileName = `image-${String(assets.length + 1).padStart(2, "0")}.png`;
    const filePath = path.join(targetDir, fileName);
    await handle.screenshot({ path: filePath, timeout: 8000 }).catch(() => null);
    if (!fileExists(filePath)) continue;
    assets.push({
      kind: "image",
      path: filePath,
      width: Math.round(meta.naturalWidth || meta.rect.width || 0),
      height: Math.round(meta.naturalHeight || meta.rect.height || 0),
      mimeType: "image/png",
      source: "outlook_current_customer_message",
      messageId: conversationKey
    });
    }
  }
  return assets;
}

function fileExists(filePath = "") {
  return existsSync(filePath);
}

async function expandGmailConversationCards(page, maxPasses = 2) {
  let totalClicked = 0;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const points = await page.evaluate(() => {
      const normalize = (value) => String(value || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
      const visible = (node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      const out = [];
      for (const node of Array.from(document.querySelectorAll("button,div[role='button'],span[role='button']"))) {
        if (!visible(node)) continue;
        const rect = node.getBoundingClientRect();
        const text = normalize([
          node.innerText || "",
          node.textContent || "",
          node.getAttribute("aria-label") || "",
          node.getAttribute("title") || "",
          node.getAttribute("data-tooltip") || ""
        ].join(" "));
        if (rect.left < 220 || rect.top < 100 || rect.top > window.innerHeight - 40 || rect.width > 220 || rect.height > 90) continue;
        if (!/(全部展开|全部展開|展开全部|展開全部|expand all)/i.test(text)) continue;
        out.push({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      }
      return out.slice(0, 2);
    });
    if (!points.length) break;
    for (const point of points) {
      await page.mouse.click(point.x, point.y).catch(() => {});
      totalClicked += 1;
      await page.waitForTimeout(350).catch(() => {});
    }
    await page.waitForTimeout(700).catch(() => {});
  }
  return totalClicked;
}

async function expandGmailTrimmedContent(page, maxPasses = 2) {
  let totalClicked = 0;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const points = await page.evaluate(() => {
      const normalize = (value) => String(value || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
      const visible = (node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      const detailLeft = Math.max(220, Math.floor(window.innerWidth * 0.12));
      const out = [];
      for (const node of Array.from(document.querySelectorAll("button,div[role='button'],span[role='button'],.ajR"))) {
        if (!visible(node)) continue;
        const rect = node.getBoundingClientRect();
        const text = normalize([
          node.innerText || "",
          node.textContent || "",
          node.getAttribute("aria-label") || "",
          node.getAttribute("title") || "",
          node.getAttribute("data-tooltip") || ""
        ].join(" "));
        if (rect.left < detailLeft || rect.top < 120 || rect.top > window.innerHeight - 40 || rect.width > 220 || rect.height > 80) continue;
        if (/view entire message|\u67e5\u770b\u90ae\u4ef6\u5168\u6587/i.test(text)) continue;
        if (!/show trimmed content|show hidden content|\u663e\u793a\u88ab\u9690\u85cf|\u663e\u793a\u66f4\u591a|\.\.\.|…/.test(text)) continue;
        out.push({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      }
      return out.slice(0, 4);
    });
    if (!points.length) break;
    for (const point of points) {
      await page.mouse.click(point.x, point.y).catch(() => {});
      totalClicked += 1;
      await page.waitForTimeout(250).catch(() => {});
    }
    await page.waitForTimeout(500).catch(() => {});
  }
  return totalClicked;
}

async function expandOutlookCollapsedMessageCards(page, row = {}, maxPasses = 3) {
  let totalClicked = 0;
  const rowProbe = {
    sender: String(row?.sender || ""),
    subject: String(row?.subject || ""),
    snippet: String(row?.snippet || "")
  };
  const moveThread = async (mode) => await page.evaluate((mode) => {
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const normalize = (value) => String(value || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
    const detailLeft = (() => {
      const rowRights = Array.from(document.querySelectorAll("[role='option'],[role='row'],[role='listitem'],tr"))
        .filter(visible)
        .map((node) => ({ rect: node.getBoundingClientRect(), text: normalize(node.innerText || node.textContent || "") }))
        .filter((item) => item.rect.left >= 120 && item.rect.left < Math.min(window.innerWidth * 0.48, 760))
        .filter((item) => item.rect.width >= 220 && item.rect.width <= 560 && item.rect.height >= 36 && item.rect.height <= 180)
        .filter((item) => item.text.length >= 4 && item.text.length <= 2200)
        .map((item) => item.rect.right);
      if (rowRights.length) return Math.max(320, Math.min(Math.max(...rowRights) + 12, window.innerWidth - 480));
      return Math.max(360, Math.min(window.innerWidth * 0.28, 620));
    })();
    const candidates = Array.from(document.querySelectorAll("main,article,[role='main'],[role='document'],section,div"))
      .filter(visible)
      .map((node) => ({ node, rect: node.getBoundingClientRect() }))
      .filter((item) => item.rect.left > detailLeft && item.rect.top >= 120 && item.rect.width > 320 && item.rect.height > 180 && item.node.scrollHeight > item.node.clientHeight + 80)
      .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height);
    const scroller = candidates[0]?.node || document.scrollingElement || document.documentElement;
    const before = scroller.scrollTop;
    if (mode === "reset") {
      scroller.scrollTop = 0;
    } else {
      const step = Math.max(320, Math.floor((scroller.clientHeight || window.innerHeight || 800) * 0.72));
      scroller.scrollTop = Math.min(scroller.scrollTop + step, Math.max(0, scroller.scrollHeight - scroller.clientHeight));
    }
    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    return {
      moved: Math.abs(scroller.scrollTop - before) > 8,
      top: scroller.scrollTop,
      max: Math.max(0, scroller.scrollHeight - scroller.clientHeight)
    };
  }, mode);
  await moveThread("reset").catch(() => null);
  await page.waitForTimeout(250).catch(() => {});
  let stuckPasses = 0;
  for (let pass = 0; pass < Math.max(maxPasses * 5, emailDetailScrollActions + 2); pass += 1) {
    const points = await page.evaluate((rowProbe) => {
      const normalize = (value) => String(value || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
      const matchKey = (value = "") => normalize(value)
        .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
        .replace(/[\u201C\u201D\u201E\u201F]/g, "\"")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
      const visible = (node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      const isOutlookDateLine = (line = "") => {
        const text = normalize(line);
        return /(?:周.|星期.|Mon|Tue|Wed|Thu|Fri|Sat|Sun|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+20\d{2}[-/年]\d{1,2}[-/月]\d{1,2}.*\d{1,2}:\d{2}/i.test(text)
          || /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b.*\d{1,2}:\d{2}/i.test(text);
      };
      const detailLeft = (() => {
        const rowRights = Array.from(document.querySelectorAll("[role='option'],[role='row'],[role='listitem'],tr"))
          .filter(visible)
          .map((node) => ({ rect: node.getBoundingClientRect(), text: normalize(node.innerText || node.textContent || "") }))
          .filter((item) => item.rect.left >= 120 && item.rect.left < Math.min(window.innerWidth * 0.48, 760))
          .filter((item) => item.rect.width >= 220 && item.rect.width <= 560 && item.rect.height >= 36 && item.rect.height <= 160)
          .filter((item) => item.text.length >= 8 && item.text.length <= 1800)
          .map((item) => item.rect.right);
        if (rowRights.length) return Math.max(320, Math.min(Math.max(...rowRights) + 12, window.innerWidth - 480));
          return Math.max(360, Math.min(window.innerWidth * 0.28, 620));
        })();
      const snippetKey = matchKey(rowProbe?.snippet || "").slice(0, 110);
      const senderKey = matchKey(rowProbe?.sender || "").slice(0, 80);
      const subjectKey = matchKey(rowProbe?.subject || "").slice(0, 110);
      const seen = new Set();
      const candidates = [];
      const isToolbarOnly = (text = "") => /^(reply|reply all|forward|more|delete|archive|report|move|\u56de\u590d|\u7b54\u590d|\u5168\u90e8\u7b54\u590d|\u8f6c\u53d1|\u66f4\u591a|\u5220\u9664|\u5b58\u6863|\u62a5\u544a|\u79fb\u81f3)$/i.test(normalize(text));
      const showHistoryControls = Array.from(document.querySelectorAll("button,[role='button'],[aria-label],[title]"))
        .filter(visible)
        .map((control) => {
          const rect = control.getBoundingClientRect();
          const label = normalize([
            control.innerText || "",
            control.textContent || "",
            control.getAttribute("aria-label") || "",
            control.getAttribute("title") || "",
            control.getAttribute("data-automationid") || ""
          ].join(" "));
          return { control, rect, label };
        })
        .filter((item) => item.rect.left > detailLeft && item.rect.top >= 90 && item.rect.top <= window.innerHeight - 24)
        .filter((item) => item.rect.width > 0 && item.rect.width <= 260 && item.rect.height > 0 && item.rect.height <= 100)
        .filter((item) => /show message history|show conversation history|\u663e\u793a[\s\S]{0,8}\u5386\u53f2|\u5c55\u5f00[\s\S]{0,8}\u5386\u53f2/i.test(item.label))
        .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
      for (const item of showHistoryControls) {
        const key = `history|${Math.round(item.rect.left / 4)}|${Math.round(item.rect.top / 4)}|${item.label}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({
          x: item.rect.left + item.rect.width / 2,
          y: item.rect.top + item.rect.height / 2,
          top: item.rect.top,
          priority: 3
        });
      }
      const pointForExplicitControl = (node) => {
        const controls = Array.from(node.querySelectorAll("[aria-expanded='false'],button,[role='button']"))
          .filter(visible)
          .map((control) => {
            const rect = control.getBoundingClientRect();
            const label = normalize([
              control.innerText || "",
              control.textContent || "",
              control.getAttribute("aria-label") || "",
              control.getAttribute("title") || "",
              control.getAttribute("data-automationid") || "",
              control.getAttribute("aria-expanded") || ""
            ].join(" "));
            return { control, rect, label };
          })
          .filter((item) => item.rect.left > detailLeft && item.rect.width > 0 && item.rect.height > 0)
          .filter((item) => item.rect.width <= 220 && item.rect.height <= 80)
          .filter((item) => item.control.getAttribute("aria-expanded") === "false" || /expand|show|collapsed|\u5c55\u5f00|\u6298\u53e0/i.test(item.label))
          .filter((item) => !/profile|contact|person|avatar|\u8054\u7cfb\u4eba|\u4e2a\u4eba\u8d44\u6599/i.test(item.label))
          .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
        const target = controls[0];
        if (!target) return null;
        return {
          x: target.rect.left + target.rect.width / 2,
          y: target.rect.top + target.rect.height / 2
        };
      };
      const pointForPreviewText = (node, cardRect) => {
        const descendants = Array.from(node.querySelectorAll("div,span,p"))
          .filter(visible)
          .map((child) => ({ child, rect: child.getBoundingClientRect(), text: normalize(child.innerText || child.textContent || "") }))
          .filter((item) => item.rect.left > detailLeft + 90 && item.rect.width >= 180 && item.rect.height >= 14 && item.rect.height <= 90)
          .filter((item) => item.text.length >= 4 && item.text.length <= 700 && !isToolbarOnly(item.text))
          .filter((item) => !item.child.closest("button,[role='button'],a"))
          .map((item) => {
            const key = matchKey(item.text);
            const rowHit = snippetKey.length >= 18 && key.includes(snippetKey.slice(0, Math.min(snippetKey.length, 55))) ? 1 : 0;
            return { ...item, rowHit };
          })
          .sort((a, b) => b.rowHit - a.rowHit || (a.rect.width * a.rect.height) - (b.rect.width * b.rect.height));
        const target = descendants[0];
        if (target) {
          return {
            x: Math.min(target.rect.right - 8, Math.max(target.rect.left + 24, target.rect.left + Math.min(260, target.rect.width * 0.35))),
            y: target.rect.top + target.rect.height / 2
          };
        }
        return {
          x: Math.min(cardRect.right - 180, Math.max(detailLeft + 180, cardRect.left + Math.min(420, Math.max(260, cardRect.width * 0.42)))),
          y: Math.max(cardRect.top + 24, Math.min(cardRect.bottom - 14, cardRect.top + cardRect.height * 0.58))
        };
      };
      for (const node of Array.from(document.querySelectorAll("article,section,div[role='listitem'],div[aria-expanded='false'],div"))) {
        if (!visible(node)) continue;
        const rect = node.getBoundingClientRect();
        if (rect.left <= detailLeft || rect.width < 360 || rect.height < 36 || rect.height > 220) continue;
        if (rect.top < 96 || rect.bottom > window.innerHeight + 80) continue;
        const text = normalize(node.innerText || node.textContent || "");
        if (text.length < 12 || text.length > 2600) continue;
        if (isToolbarOnly(text)) continue;
        const lines = text.split(/\n+/).map(normalize).filter(Boolean);
        const dateLineCount = lines.filter(isOutlookDateLine).length;
        const keyText = matchKey(text);
        const snippetMatched = snippetKey.length >= 18 && keyText.includes(snippetKey.slice(0, Math.min(snippetKey.length, 90)));
        const senderMatched = senderKey.length >= 4 && keyText.includes(senderKey.slice(0, Math.min(senderKey.length, 60)));
        const subjectMatched = subjectKey.length >= 18 && keyText.includes(subjectKey.slice(0, Math.min(subjectKey.length, 80)));
        const rowMatched = snippetMatched || (senderMatched && subjectMatched);
        if (rowMatched) {
          if (dateLineCount < 1) continue;
        } else if (dateLineCount !== 1) {
          continue;
        }
        const explicitPoint = pointForExplicitControl(node);
        const nodeExpanded = node.getAttribute("aria-expanded") === "true";
        const nodeCollapsed = node.getAttribute("aria-expanded") === "false";
        const expandedBody = Array.from(node.querySelectorAll("[role='document'],div.OuGoX,div.XbIp4"))
          .some((child) => visible(child) && child.getBoundingClientRect().height > 38 && normalize(child.innerText || child.textContent || "").length > 40);
        if (nodeExpanded || (expandedBody && !explicitPoint && !nodeCollapsed)) continue;
        if (!rowMatched && !explicitPoint && !nodeCollapsed) continue;
        const key = `${Math.round(rect.left / 8)}|${Math.round(rect.top / 8)}|${Math.round(rect.width / 8)}|${Math.round(rect.height / 8)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const point = explicitPoint || pointForPreviewText(node, rect);
        candidates.push({
          x: Math.max(detailLeft + 120, Math.min(window.innerWidth - 160, point.x)),
          y: Math.max(120, Math.min(window.innerHeight - 40, point.y)),
          top: rect.top,
          priority: rowMatched ? 2 : 1
        });
      }
      return candidates.sort((a, b) => b.priority - a.priority || a.top - b.top).slice(0, 8);
    }, rowProbe).catch(() => []);
    if (!points.length) {
      const moved = await moveThread("next").catch(() => ({ moved: false }));
      if (!moved?.moved) break;
      await page.waitForTimeout(350).catch(() => {});
      continue;
    }
    for (const point of points) {
      await page.mouse.click(point.x, point.y).catch(() => {});
      totalClicked += 1;
      await page.waitForTimeout(120).catch(() => {});
    }
    await page.waitForTimeout(450).catch(() => {});
    const moved = await moveThread("next").catch(() => ({ moved: false }));
    if (!moved?.moved) {
      stuckPasses += 1;
      if (stuckPasses >= 2) break;
      await moveThread("reset").catch(() => null);
    } else {
      stuckPasses = 0;
    }
  }
  await moveThread("reset").catch(() => null);
  await page.waitForTimeout(250).catch(() => {});
  return totalClicked;
}

async function waitForEmailDetailMatch(page, provider, row) {
  if (!/^(outlook|gmail|cuiqiu)$/i.test(provider || "")) return true;
  if (provider === "outlook" && outlookUrlMatchesConversationId(page.url(), row?.outlookConversationId || "")) return true;
  const expected = [row?.subject, row?.snippet]
    .map(normalizeEmailMatchText)
    .filter((value) => value.length >= 8)
    .map((value) => value.slice(0, Math.min(value.length, 100)));
  const identity = [row?.sender, ...(Array.isArray(row?.lines) ? row.lines.slice(0, 3) : [])]
    .map(normalizeEmailMatchText)
    .map((value) => value.replace(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/ig, "").replace(/[<>]/g, " ").replace(/\s+/g, " ").trim())
    .filter((value) => value.length >= 4)
    .map((value) => value.slice(0, Math.min(value.length, 80)));
  if (!expected.length && !identity.length) return true;
  for (let attempt = 0; attempt < 18; attempt += 1) {
    const ok = await page.evaluate(({ providerName, expected, identity }) => {
      const normalize = (value) => String(value || "")
        .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
        .replace(/[\u201C\u201D\u201E\u201F]/g, "\"")
        .replace(/\u00a0/g, " ")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
      const visible = (node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      const detailLeft = /^(outlook|cuiqiu)$/i.test(providerName) ? (() => {
        const rowRights = Array.from(document.querySelectorAll("[role='option'],[role='row'],[role='listitem'],tr"))
          .filter(visible)
          .map((node) => ({ rect: node.getBoundingClientRect(), text: normalize(node.innerText || node.textContent || "") }))
          .filter((item) => item.rect.left >= 120 && item.rect.left < Math.min(window.innerWidth * 0.48, 760))
          .filter((item) => item.rect.width >= 220 && item.rect.width <= 560 && item.rect.height >= 36 && item.rect.height <= 160)
          .filter((item) => item.text.length >= 8 && item.text.length <= 1800)
          .map((item) => item.rect.right);
        if (rowRights.length) return Math.max(320, Math.min(Math.max(...rowRights) + 12, window.innerWidth - 480));
        return Math.max(360, Math.min(window.innerWidth * 0.28, 620));
      })() : 180;
      const text = Array.from(document.querySelectorAll("main,article,[role='main'],[role='document'],section,div,.a3s,.ii"))
        .filter(visible)
        .map((node) => ({ rect: node.getBoundingClientRect(), text: node.innerText || node.textContent || "" }))
        .filter((item) => !/^(outlook|cuiqiu)$/i.test(providerName) || item.rect.left > detailLeft)
        .filter((item) => item.rect.width > 280 && item.rect.height > 20 && item.text.length > 6)
        .map((item) => item.text)
        .join("\n");
      const haystack = normalize(text);
      const expectedHits = expected.reduce((total, needle) => total + (haystack.includes(needle) ? 1 : 0), 0);
      const identityHits = identity.reduce((total, needle) => total + (haystack.includes(needle) ? 1 : 0), 0);
      if (expected.length >= 2) return expectedHits >= 2 || (expectedHits >= 1 && identityHits >= 1);
      if (expected.length === 1) return expectedHits === 1 && (identityHits >= 1 || expected[0].length >= 18);
      return identityHits >= 1;
    }, { providerName: provider, expected, identity }).catch(() => false);
    if (ok) return true;
    await page.waitForTimeout(400).catch(() => {});
  }
  throw new Error("email detail did not match selected row after opening");
}

async function scanEmailDetailScroll(page, provider, row = {}, shopName = "") {
  const merged = { lines: [], messages: [], email: "" };
  const seenLines = new Set();
  const seenMessages = new Set();
  const collect = async () => await page.evaluate(collectEmailDetailSnapshotInPage, { providerName: provider, ownEmails: emailOwnMailboxes(shopName, row) });
  const move = async (mode) => {
    return await page.evaluate((mode) => {
      const visible = (node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      const candidates = Array.from(document.querySelectorAll("main,article,[role='main'],[role='document'],section,div"))
        .filter(visible)
        .map((node) => ({ node, rect: node.getBoundingClientRect() }))
        .filter((item) => item.rect.left > (() => {
          const rowRights = Array.from(document.querySelectorAll("[role='option'],[role='row'],[role='listitem'],tr"))
            .filter(visible)
            .map((node) => ({ rect: node.getBoundingClientRect(), text: String(node.innerText || node.textContent || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim() }))
            .filter((row) => row.rect.left >= 120 && row.rect.left < Math.min(window.innerWidth * 0.48, 760))
            .filter((row) => row.rect.width >= 220 && row.rect.width <= 560 && row.rect.height >= 36 && row.rect.height <= 160)
            .filter((row) => row.text.length >= 8 && row.text.length <= 1800)
            .map((row) => row.rect.right);
          if (rowRights.length) return Math.max(320, Math.min(Math.max(...rowRights) + 12, window.innerWidth - 480));
          return Math.max(360, Math.min(window.innerWidth * 0.28, 620));
        })() && item.rect.top >= 130 && item.rect.width > 320 && item.rect.height > 180 && item.node.scrollHeight > item.node.clientHeight + 80)
        .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height);
      const scroller = candidates[0]?.node || document.scrollingElement || document.documentElement;
      const before = scroller.scrollTop;
      if (mode === "reset") {
        scroller.scrollTop = 0;
      } else {
        scroller.scrollTop = Math.min(scroller.scrollTop + Math.max(260, Math.floor(scroller.clientHeight * 0.75)), scroller.scrollHeight);
      }
      return Math.abs(scroller.scrollTop - before) > 8;
    }, mode);
  };
  await move("reset");
  await page.waitForTimeout(200).catch(() => {});
  for (let pass = 0; pass <= emailDetailScrollActions; pass += 1) {
    if (provider === "outlook" && pass === 0) {
      await expandOutlookCollapsedMessageCards(page, row, 2).catch(() => 0);
    }
    const snap = await collect();
    if (!merged.email && snap.email) merged.email = snap.email;
    for (const line of snap.lines || []) {
      const key = String(line || "").toLowerCase().replace(/\s+/g, " ");
      if (!key || seenLines.has(key)) continue;
      seenLines.add(key);
      merged.lines.push(line);
    }
    for (const message of snap.messages || []) {
      const text = String(message?.text || "").trim();
      const role = message?.role === "store" ? "store" : "customer";
      const key = `${role}|${normalizeEmailMatchText(text)}`;
      if (!text || seenMessages.has(key)) continue;
      seenMessages.add(key);
      merged.messages.push({ role, text, time: String(message?.time || "").trim() });
    }
    if (pass >= emailDetailScrollActions) break;
    const moved = await move("next");
    if (!moved) break;
    await page.waitForTimeout(220).catch(() => {});
  }
  return merged;
}

async function openEmailRow(page, provider, row, options = {}) {
  if (options?.activateTarget !== false) await page.bringToFront().catch(() => {});
  await page.waitForTimeout(150).catch(() => {});
  if (provider !== "outlook" && row?.sourceUrl && /\/mail\/(?:inbox|junkemail)\/id\//i.test(row.sourceUrl)) {
    await page.goto(row.sourceUrl, { waitUntil: "domcontentloaded", timeout: 18000 });
    await page.waitForTimeout(1400).catch(() => {});
    return true;
  }
  const preserveCurrentList = Boolean(options?.preserveCurrentList);
  if (!preserveCurrentList) {
    const folderPatterns = emailFolderPatterns(provider, row.folderLabel || "");
    if (provider === "gmail") {
      await applyEmailUnreadView(page, provider, row.folderLabel || "Inbox");
    } else if (folderPatterns.length) {
      const clickedFolder = await clickEmailNavigation(page, folderPatterns);
      if (provider === "outlook" && !clickedFolder && !/\/mail\/inbox(?:\/|$)/i.test(page.url())) {
        throw new Error(`outlook folder navigation was not confirmed for ${row.folderLabel || "Inbox"}`);
      }
      await page.waitForTimeout(650).catch(() => {});
      await applyEmailUnreadView(page, provider, row.folderLabel || "");
    }
    await resetEmailListScroll(page).catch(() => {});
  }
  if (provider === "outlook" && row?.outlookConversationId) {
    for (let pass = 0; pass < emailScrollPasses; pass += 1) {
      const clickedById = await clickOutlookConversationRowById(page, row).catch(() => false);
      if (clickedById) return true;
      const moved = await advanceEmailListScroll(page).catch(() => false);
      if (!moved) break;
      await page.waitForTimeout(250).catch(() => {});
    }
  }
  for (let pass = 0; pass < emailScrollPasses; pass += 1) {
    const clicked = await page.evaluate(({ providerName, row }) => {
      const normalize = (value) => String(value || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
      const visible = (node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      const rowLike = (node) => {
        const rect = node.getBoundingClientRect();
        const role = `${node.getAttribute("role") || ""} ${node.className || ""}`.toLowerCase();
        const semantic = role.includes("row") || role.includes("listitem") || role.includes("option") || role.includes("link") || node.tagName === "TR" || node.tagName === "LI" || node.tagName === "A" || node.closest("[role='listbox'],[role='grid'],table,.mail-list,.messagelist,.message-list,#messagelist,#message-list");
        if (!semantic) return false;
        if (providerName === "gmail") {
          return rect.left >= 120 && rect.left < Math.min(window.innerWidth * 0.55, 900) && rect.width >= 360 && rect.height >= 24 && rect.height <= 120;
        }
        if (providerName === "outlook") {
          return rect.left >= 140 && rect.left < Math.min(window.innerWidth * 0.52, 760) && rect.width >= 200 && rect.width <= 680 && rect.height >= 36 && rect.height <= 190;
        }
        if (providerName === "cuiqiu") {
          return rect.left >= 180 && rect.left < Math.min(window.innerWidth * 0.48, 760) && rect.width >= 240 && rect.height >= 28 && rect.height <= 190;
        }
        return rect.width >= 240 && rect.height >= 28 && rect.height <= 180;
      };
      const unreadLike = (node, text) => {
        const attr = [
          node.getAttribute("aria-label"),
          node.getAttribute("title"),
          node.getAttribute("data-testid"),
          node.getAttribute("data-isread"),
          node.getAttribute("data-read")
        ].join(" ").toLowerCase();
        const lower = String(text || "").toLowerCase();
        const klass = String(node.className || "").toLowerCase();
        const weight = Number.parseInt(getComputedStyle(node).fontWeight, 10) || 400;
        if (providerName === "gmail") {
          if (/\bunread\b|\bnot read\b|未读|未閱讀/.test(attr)) return true;
          if (/\bze\b/.test(klass) || node.matches("tr.zE") || node.closest("tr.zE")) return true;
          if (attr.includes("false") && /(isread|read)/.test(attr)) return true;
          return false;
        }
        if (providerName === "outlook") {
          if (/\bunread\b|\bnot read\b|未读|未閱讀/.test(attr)) return true;
          return weight >= 600;
        }
        if (/\bunread\b|\bnot read\b|未读|未閱讀/.test(attr) || /\bunread\b|未读|未閱讀/.test(lower)) return true;
        if (attr.includes("false") && /(isread|read)/.test(attr)) return true;
        return weight >= 700;
      };
      const displaySender = String(row.sender || "")
        .replace(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/ig, "")
        .replace(/[<>]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const targetParts = [displaySender || row.sender, row.subject, row.snippet]
        .map((value) => normalize(value).toLowerCase())
        .filter((value) => value.length >= 2);
      const requiredParts = targetParts.filter((value) => value.length >= 5);
      const rowSelector = providerName === "gmail"
        ? "tr[role='row'],tr,[role='main'] [role='link'],[role='main'] [role='row'],div[role='row'],div[role='listitem']"
        : providerName === "cuiqiu"
          ? "[role='option'],[role='row'],[role='listitem'],tr,li,.mail-list li,.mail-list-item,.messagelist li,.message-list li,#messagelist li,#message-list li"
          : "[role='option'],[role='row'],[role='listitem'],tr";
      const candidates = Array.from(document.querySelectorAll(rowSelector))
        .filter(visible)
        .filter(rowLike)
        .map((node) => ({ node, rect: node.getBoundingClientRect(), text: normalize(node.innerText || node.textContent || ""), tag: node.tagName, role: node.getAttribute("role") || "" }))
        .filter((item) => item.text.length >= 8 && item.text.length <= 1800)
        .filter((item) => providerName !== "outlook" || item.rect.left < Math.min(window.innerWidth * 0.52, 760))
        .filter((item) => providerName !== "gmail" || item.tag === "TR" || /row|option|listitem|link/i.test(item.role) || item.rect.left >= 120)
        .map((item) => {
          const lower = item.text.toLowerCase();
          const score = targetParts.reduce((total, part) => total + (lower.includes(part) ? 1 : 0), 0);
          const required = requiredParts.every((part) => lower.includes(part));
          return { ...item, score, required };
        })
        .filter((item) => item.required && item.score >= Math.min(2, targetParts.length))
        .sort((a, b) => b.score - a.score || a.rect.top - b.rect.top);
      const target = candidates[0];
      if (!target) return null;
      if (providerName === "gmail" && (!target.rect.width || !target.rect.height || target.rect.left <= 0)) {
        const clickTarget = target.node.querySelector(".bog,.y6,.y2") || target.node;
        for (const type of ["mouseover", "mousedown", "mouseup", "click"]) {
          clickTarget.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
        }
        return { domClicked: true };
      }
      const clickableRect = providerName === "gmail"
        ? Array.from(target.node.querySelectorAll(".bog,.y6,.y2,span"))
          .map((node) => node.getBoundingClientRect())
          .filter((rect) => rect.width > 20 && rect.height > 8 && rect.left > target.rect.left + 180)
          .sort((a, b) => a.left - b.left)[0]
        : null;
      if (clickableRect) {
        return {
          x: clickableRect.left + Math.min(Math.max(clickableRect.width * 0.35, 12), clickableRect.width - 4),
          y: clickableRect.top + Math.min(Math.max(clickableRect.height * 0.5, 6), clickableRect.height - 3)
        };
      }
      const xOffset = providerName === "gmail"
        ? Math.min(Math.max(target.rect.width * 0.35, 320), target.rect.width - 24)
        : Math.min(Math.max(target.rect.width * 0.42, 110), target.rect.width - 18);
      return {
        x: target.rect.left + xOffset,
        y: target.rect.top + Math.min(Math.max(target.rect.height * 0.5, 14), target.rect.height - 8)
      };
    }, { providerName: provider, row });
    if (clicked?.domClicked) {
      await page.waitForTimeout(250).catch(() => {});
      return true;
    }
    if (clicked && Number.isFinite(clicked.x) && Number.isFinite(clicked.y)) {
      await page.mouse.click(clicked.x, clicked.y).catch(() => {});
      if (provider === "outlook" && row?.outlookConversationId) {
        const opened = await waitForOutlookConversationUrl(page, row.outlookConversationId, 1800).catch(() => false);
        if (!opened) {
          await page.waitForTimeout(250).catch(() => {});
          continue;
        }
      }
      return true;
    }
    const moved = await advanceEmailListScroll(page).catch(() => false);
    if (!moved) break;
    await page.waitForTimeout(350).catch(() => {});
  }
  if ((provider === "fastmo" || provider === "cuiqiu") && Number.isFinite(row.clickX) && Number.isFinite(row.clickY)) {
    await page.mouse.click(row.clickX, row.clickY).catch(() => {});
    return true;
  }
  throw new Error("email row was not found again before opening detail");
}

async function clickOutlookConversationRowById(page, row = {}) {
  const conversationId = row?.outlookConversationId || "";
  if (!conversationId) return false;
  const point = await page.evaluate((conversationId) => {
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const nodes = Array.from(document.querySelectorAll("[data-convid]"));
    const candidates = nodes
      .filter((node) => node.getAttribute("data-convid") === conversationId)
      .map((node) => node.closest("[role='option'],[role='row'],[role='listitem']") || node)
      .filter((node, index, all) => all.indexOf(node) === index)
      .filter(visible)
      .map((node) => ({ node, rect: node.getBoundingClientRect(), text: String(node.innerText || node.textContent || "").trim() }))
      .filter((item) => item.rect.left >= 180 && item.rect.left < Math.min(window.innerWidth * 0.45, 650))
      .filter((item) => item.rect.width >= 240 && item.rect.width <= 520 && item.rect.height >= 48 && item.rect.height <= 130 && item.text.length >= 4)
      .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
    const target = candidates[0]?.node;
    if (!target) return null;
    target.scrollIntoView({ block: "center", inline: "nearest" });
    const rect = target.getBoundingClientRect();
    return {
      x: rect.left + Math.min(Math.max(rect.width * 0.46, 90), rect.width - 12),
      y: rect.top + Math.min(Math.max(rect.height * 0.50, 18), rect.height - 8)
    };
  }, conversationId).catch(() => null);
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  await page.mouse.click(point.x, point.y).catch(() => {});
  return await waitForOutlookConversationUrl(page, conversationId, 1800).catch(() => false);
}

function outlookUrlMatchesConversationId(url = "", conversationId = "") {
  const expected = String(conversationId || "").trim();
  if (!expected) return false;
  const raw = String(url || "");
  try {
    if (decodeURIComponent(raw).includes(expected)) return true;
  } catch {}
  return raw.includes(expected) || raw.includes(encodeURIComponent(expected));
}

async function waitForOutlookConversationUrl(page, conversationId = "", timeoutMs = 1800) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (outlookUrlMatchesConversationId(page.url(), conversationId)) return true;
    await page.waitForTimeout(180).catch(() => {});
  }
  return outlookUrlMatchesConversationId(page.url(), conversationId);
}

function emailTextIncludesRowSnippet(text = "", row = {}) {
  const haystack = normalizeEmailMatchText(text);
  const snippet = normalizeEmailMatchText(row?.snippet || "");
  if (!snippet || snippet.length < 12) return false;
  const probe = snippet.slice(0, Math.min(snippet.length, 80));
  return haystack.includes(probe);
}

function hasUsableEmailDetail({ body = "", cleanLines = [], detailMessages = [] } = {}) {
  const text = normalizeEmailMatchText(body || (cleanLines || []).join("\n"));
  if (text.length >= 8) return true;
  return (detailMessages || []).some((message) => normalizeEmailMatchText(message?.text || "").length >= 8);
}

function emailDetailMatchesRow(body = "", row = {}) {
  const haystack = normalizeEmailMatchText(body);
  const required = [row.subject, row.snippet]
    .map(normalizeEmailMatchText)
    .filter((value) => value.length >= 8);
  const identity = [row.sender, ...(Array.isArray(row.lines) ? row.lines.slice(0, 3) : [])]
    .map(normalizeEmailMatchText)
    .filter((value) => value.length >= 4)
    .map((value) => value.replace(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/ig, "").replace(/[<>]/g, " ").replace(/\s+/g, " ").trim())
    .filter((value) => value.length >= 4);
  if (!required.length) return identity.length ? identity.some((value) => haystack.includes(value.slice(0, Math.min(value.length, 80)))) : true;
  const requiredHits = required.reduce((total, value) => total + (haystack.includes(value.slice(0, Math.min(value.length, 100))) ? 1 : 0), 0);
  const identityHits = identity.reduce((total, value) => total + (haystack.includes(value.slice(0, Math.min(value.length, 80))) ? 1 : 0), 0);
  if (required.length >= 2) return requiredHits >= 2 || (requiredHits >= 1 && identityHits >= 1);
  return requiredHits >= 1 && (identityHits >= 1 || required[0].length >= 18);
}

function normalizeEmailMatchText(value = "") {
  return String(value || "")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, "\"")
    .replace(/\u00a0/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function cleanEmailDetailLines(provider, lines = [], row = {}) {
  const normalized = [];
  const seen = new Set();
  for (const line of lines || []) {
    let text = String(line || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
    if (provider === "gmail") {
      text = text.replace(/…?\s*\[?邮件部分隐藏\]?\s*查看邮件全文/gi, "").trim();
      text = text.replace(/…?\s*\[?message clipped\]?\s*view entire message/gi, "").trim();
    }
    if (provider === "gmail" && /^[.…]+$/.test(text)) continue;
    if (provider === "outlook" && /^[.…]+$/.test(text)) break;
    if (provider === "outlook" && /suggested replies|建议的答复|建議的答覆|快速操作/i.test(text)) break;
    if (provider === "outlook" && /^[A-Z]{1,4}$/.test(text)) continue;
    if (provider === "outlook" && /^(收件人|发件人|To|From|Cc|Bcc)\s*[:：]/i.test(text)) continue;
    if (provider === "outlook" && isEmailDetailChromeLine(text, provider)) continue;
    const key = text.toLowerCase().replace(/\s+/g, " ");
    if (!text || seen.has(key)) continue;
    seen.add(key);
    normalized.push(text);
  }
  if (provider === "outlook") {
    const withoutSuggested = removeOutlookSuggestedReplyTail(normalized);
    normalized.splice(0, normalized.length, ...withoutSuggested);
  }
  if (!normalized.length) return normalized;
  const rowText = [row.sender, row.subject, row.snippet, ...(Array.isArray(row.lines) ? row.lines : [])].join("\n");
  const email = firstEmail(rowText);
  const senderName = String(row.sender || "").replace(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/ig, "").replace(/[<>]/g, "").trim().toLowerCase();
  let start = -1;
  for (let i = 0; i < normalized.length; i += 1) {
    const lower = normalized[i].toLowerCase();
    if (email && lower.includes(email.toLowerCase())) {
      start = i + 1;
      break;
    }
    if (senderName && senderName.length >= 3 && lower.includes(senderName)) {
      start = i + 1;
      break;
    }
  }
  const bodyLines = (start >= 0 ? normalized.slice(start) : normalized).filter((line) => !isEmailDetailChromeLine(line, provider));
  return bodyLines.length ? bodyLines : normalized;
}

function outlookSuggestedReplyKey(value = "") {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[.!?。！？]+$/g, "")
    .replace(/\s+/g, " ");
}

function isOutlookSuggestedReplyLine(line = "") {
  return [
    "your order has been cancelled",
    "ok, thanks for letting me know",
    "thank you for your response",
    "here is the tracking info",
    "yes, i will check",
    "i will check on it",
    "i will check that for you"
  ].includes(outlookSuggestedReplyKey(line));
}

function removeOutlookSuggestedReplyTail(lines = []) {
  const base = Array.isArray(lines) ? lines.slice() : [];
  let end = base.length;
  while (end > 0 && isOutlookSuggestedReplyLine(base[end - 1])) end -= 1;
  if (base.length - end >= 1) return base.slice(0, end);
  return base;
}

function cleanEmailDetailMessages(provider, messages = [], row = {}) {
  const cleaned = [];
  const seen = new Set();
  for (const message of Array.isArray(messages) ? messages : []) {
    const role = message?.role === "store" ? "store" : "customer";
    const lines = cleanEmailDetailLines(provider, String(message?.text || "").split(/\n+/), row)
      .filter((line) => !/^[.…]+$/.test(String(line || "").trim()))
      .filter((line) => provider !== "outlook" || !/^(sent from my iphone|sent from my android)$/i.test(String(line || "").trim()))
      .filter((line) => provider !== "outlook" || role !== "customer" || !isOutlookRowShopAliasLine(line, row));
    let text = stripQuotedEmailReply(provider, lines.join("\n").trim());
    if (provider === "outlook") {
      text = removeOutlookSuggestedReplyTail(text.split(/\n+/).map((line) => line.trim()).filter(Boolean)).join("\n").trim();
    }
    const key = `${role}|${normalizeEmailMatchText(text)}`;
    if (!text || seen.has(key)) continue;
    if (provider === "outlook" && !/[a-z0-9\u4e00-\u9fff]/i.test(text)) continue;
    if (provider === "outlook" && /^(?:周.|星期.|Mon|Tue|Wed|Thu|Fri|Sat|Sun|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+20\d{2}[-/年]\d{1,2}[-/月]\d{1,2}.*\d{1,2}:\d{2}$/i.test(text)) continue;
    if (provider === "outlook" && /^[^\w]*[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i.test(text.split(/\n+/).map((line) => line.trim()).filter(Boolean)[0] || "")) continue;
    if (provider === "outlook" && role === "store" && isNonReplyableEmail(message?.email || "") && isOutlookRowShopAliasLine(text, row)) continue;
    seen.add(key);
    cleaned.push({ role, text, time: String(message?.time || "").trim(), email: String(message?.email || "").trim() });
  }
  return cleaned;
}

function isOutlookRowShopAliasLine(line = "", row = {}) {
  const text = normalizeEmailMatchText(line).replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
  if (!text || text.length > 60) return false;
  const name = String(row?.customerName || row?.sender || "");
  const aliases = name
    .split(/[;|]/)
    .slice(1)
    .map((part) => normalizeEmailMatchText(part).replace(/[^a-z0-9\u4e00-\u9fff]+/g, ""))
    .filter((part) => part.length >= 3);
  return aliases.includes(text);
}

function ensureRowSnippetMessage(provider, messages = [], row = {}) {
  if (provider !== "outlook") return messages;
  let snippet = String(row?.snippet || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
  snippet = stripQuotedEmailReply(provider, snippet.replace(/^sent from my iphone\s*/i, "").replace(/^sent from my android\s*/i, ""));
  if (!snippet || snippet.length < 8) return messages;
  const snippetKey = normalizeEmailMatchText(snippet).slice(0, Math.min(60, normalizeEmailMatchText(snippet).length));
  if (!snippetKey) return messages;
  const exists = messages.some((message) => {
    const messageKey = normalizeEmailMatchText(message?.text || "");
    return messageKey.includes(snippetKey) || snippetKey.includes(messageKey.slice(0, Math.min(60, messageKey.length)));
  });
  if (exists) return messages;
  return [{ role: "customer", text: snippet, time: String(row?.lastSeen || "").trim() }, ...messages];
}

function isOutlookDraftEmailRow(row = {}) {
  return /^\s*\[Draft\]/i.test(String(row?.sender || ""))
    || (Array.isArray(row?.lines) && row.lines.some((line) => /^\s*\[Draft\]/i.test(String(line || ""))));
}

function mergeEmailDetailMessages(messages = []) {
  const merged = [];
  const seen = new Set();
  const seenText = new Set();
  for (const message of Array.isArray(messages) ? messages : []) {
    const text = String(message?.text || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
    if (!text) continue;
    const role = message?.role === "store" ? "store" : "customer";
    const textKey = normalizeEmailMatchText(text);
    if (textKey.length >= 20 && seenText.has(textKey)) continue;
    const key = `${role}|${normalizeEmailMatchText(text)}`;
    if (seen.has(key)) continue;
    const containedIndex = merged.findIndex((old) => old.role === role && (
      (normalizeEmailMatchText(old.text).length >= 80 && normalizeEmailMatchText(text).length >= 80) && (
        normalizeEmailMatchText(old.text).includes(normalizeEmailMatchText(text)) ||
        normalizeEmailMatchText(text).includes(normalizeEmailMatchText(old.text))
      )
    ));
    if (containedIndex >= 0) {
      if (text.length > merged[containedIndex].text.length) {
        merged[containedIndex] = { role, text, time: String(message?.time || "").trim(), email: String(message?.email || "").trim() };
      }
      continue;
    }
    seen.add(key);
    if (textKey.length >= 20) seenText.add(textKey);
    merged.push({ role, text, time: String(message?.time || "").trim(), email: String(message?.email || "").trim() });
  }
  return merged;
}

function stripQuotedEmailReply(provider, value = "") {
  let text = String(value || "").trim();
  if (provider === "gmail") {
    text = text.replace(/\s+On\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|.{0,40}\d{4})[\s\S]{0,220}\bwrote:\s*[\s\S]*$/i, "");
    text = text.replace(/\s+On\s+.{1,180}<[^>]+>\s+wrote:\s*[\s\S]*$/i, "");
    text = text.replace(/\s+[^\n<]{0,120}<[^>]+>\s+于20\d{2}年[\s\S]{0,220}写道：\s*[\s\S]*$/i, "");
    text = text.replace(/\s*>+\s*On\s+[\s\S]*$/i, "");
    return text.trim();
  }
  if (provider !== "outlook") return text;
  text = text.replace(/\s+On\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|.{0,40}\d{4})[\s\S]{0,220}\bwrote:\s*[\s\S]*$/i, "");
  text = text.replace(/\s+On\s+.{1,180}<[^>]+>\s+wrote:\s*[\s\S]*$/i, "");
  text = text.replace(/\s*>+\s*On\s+[\s\S]*$/i, "");
  const out = [];
  for (const raw of text.split(/\n+/)) {
    const line = String(raw || "").trim();
    if (!line) continue;
    if (/^>/.test(line)) break;
    if (/^On .+ wrote:?$/i.test(line)) break;
    if (/^[-_]{2,}\s*Original Message\s*[-_]{2,}$/i.test(line)) break;
    out.push(line);
  }
  return out.join("\n").trim();
}

function isEmailDetailChromeLine(line = "", provider = "") {
  const text = String(line || "").trim();
  const lower = text.toLowerCase();
  if (!text) return true;
  if (/^[\uE000-\uF8FF\s]+$/.test(text)) return true;
  if (/^\d{1,2}:\d{2}(?:\s*\(.+?\))?$/.test(text)) return true;
  if (/^(today|yesterday|mon|tue|wed|thu|fri|sat|sun)\b/i.test(text)) return true;
  if (/^(回复|答复|全部答复|更多|转发|添加回应|添加表情符号回应|发送至 我|全部隐藏|全部打印|在新窗口中查看|写邮件|标签|收件箱|已加星标|已延后|已发邮件|草稿|显示更多标签|升级|搜索|跳至内容|收件人: 你|收件人:​你​)$/.test(text)) return true;
  if (/^(reply|reply all|more|forward|print all|open in new window|compose|labels|inbox|starred|snoozed|sent|drafts|search)$/i.test(text)) return true;
  if (/通过屏幕阅读器使用 gmail|免费试用 gemini|搜索所有带|从此会话中移除|邮件部分隐藏|查看邮件全文/i.test(text)) return true;
  if (/收件人:|此邮件被识别为垃圾邮件|将在\s*\d+\s*天后将其删除|这不是垃圾邮件|显示已阻止的内容并启用链接|已阻止此邮件中的某些内容|该发件人不在安全发件人列表|翻译自|翻译至|显示原始邮件|打开自动翻译|始终不翻译|此消息的语言为|你已在.*答复/i.test(text)) return true;
  if (/getting too much email|unsubscribe|manage subscriptions/i.test(text)) return true;
  if (/^(sent via inbox|reply in inbox|why did i receive this notification\??)$/i.test(text)) return true;
  if (/^you have email notifications turned on$/i.test(text)) return true;
  if (/^this conversation hasn['’]t been assigned to anyone$/i.test(text)) return true;
  if (/^manage notification settings\s*(?:→|->)?$/i.test(text)) return true;
  if (/^©?\s*shopify\b/i.test(text)) return true;
  if (/^151 o['’]connor street\b/i.test(text)) return true;
  if (provider === "gmail" && /^(第\s*\d+\s*个会话|购物|\d+)$/.test(text)) return true;
  return false;
}

function emailFolderPatterns(provider, folderLabel) {
  const label = String(folderLabel || "").toLowerCase();
  if (!label || label === "current") return [];
  if (provider === "outlook") {
    if (label.includes("inbox")) return ["inbox", "收件箱"];
    if (label.includes("focused")) return ["focused", "重点"];
    if (label.includes("other")) return ["other", "其他"];
    if (label.includes("junk")) return ["junk email", "junk", "spam", "垃圾邮件", "垃圾"];
  }
  if (provider === "gmail") {
    if (label.includes("inbox")) return ["inbox", "收件箱"];
    if (label.includes("spam")) return ["spam", "junk", "垃圾邮件", "垃圾"];
  }
  if (provider === "cuiqiu") {
    if (label.includes("inbox")) return ["inbox", "收件箱"];
    if (label.includes("sent")) return ["sent", "已发送"];
    if (label.includes("draft")) return ["drafts", "草稿"];
    if (label.includes("spam") || label.includes("junk")) return ["spam", "junk", "垃圾"];
    if (label.includes("trash")) return ["trash", "已删除"];
    if (label.includes("archive")) return ["archive", "归档"];
  }
  return [];
}

function allPages(browser) {
  return browser.contexts().flatMap((context) => context.pages());
}

function selectShopifyPage(pages, shopName) {
  const expected = normalizeShop(shopName || "");
  const candidates = pages.filter((page) => /admin\.shopify\.com\/store\/|inbox\.shopify\.com\/store\//i.test(page.url()));
  candidates.sort((a, b) => pagePriority(a.url()) - pagePriority(b.url()));
  return candidates.find((page) => !expected || normalizeShop(page.url()).includes(expected)) || candidates[0];
}

function selectInboxWorkPage(pages, storeSlug) {
  const candidates = pages.filter((page) => inboxScope.isInboxWorkPage(page.url(), storeSlug));
  candidates.sort((a, b) => inboxScope.inboxWorkPagePriority(a.url()) - inboxScope.inboxWorkPagePriority(b.url()));
  return candidates[0] || null;
}

function pagePriority(url) {
  return inboxScope.pagePriority(url);
}

function extractStoreSlug(url) {
  return String(url || "").match(/\/store\/([^/?#]+)/i)?.[1] || "";
}

function isUnreadList(url, slug) {
  return inboxScope.isUnreadList(url, slug);
}

function isInboxConversationDetail(url) {
  return inboxScope.isInboxConversationDetail(url);
}

function isInboxUnreadDetail(url) {
  return inboxScope.isInboxUnreadDetail(url);
}

function isInboxNonUnreadDetail(url) {
  return inboxScope.isInboxNonUnreadDetail(url);
}

function extractConversationID(url) {
  return inboxScope.extractConversationID(url);
}

function extractUnreadConversationID(url) {
  return inboxScope.extractUnreadConversationID(url);
}

function emailProvider(url, title) {
  return emailProviderFromTarget(url, title);
}

async function waitForSettled(page) {
  await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(700);
}

function firstEmail(value) {
  return String(value || "").match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i)?.[0] || "";
}

function allEmails(value) {
  return Array.from(String(value || "").matchAll(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/ig), (match) => match[0]);
}

function emailOwnMailboxes(shopName = "", row = {}) {
  return Array.from(new Set([
    ...shopEmailHints(shopName).emails,
    row.shopMailbox || ""
  ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean)));
}

function selectReplyableEmail({ row = {}, detail = {}, messages = [], shopName = "" } = {}) {
  const own = new Set(emailOwnMailboxes(shopName, row));
  const candidates = [
    row.sender,
    ...(messages || []).filter((message) => message?.role !== "store").map((message) => message?.email || ""),
    ...(Array.isArray(row.lines) ? row.lines : []),
    ...(messages || []).filter((message) => message?.role !== "store").map((message) => message?.text || ""),
    detail.email || ""
  ];
  for (const value of candidates) {
    for (const email of allEmails(value)) {
      const normalized = email.toLowerCase();
      if (!normalized || own.has(normalized)) continue;
      if (isNonReplyableEmail(normalized)) continue;
      return email;
    }
  }
  return "";
}

function isNonReplyableEmail(email = "") {
  const value = String(email || "").toLowerCase();
  if (!value) return true;
  if (/^(?:no-?reply|donotreply|do-not-reply|noreply)@/.test(value)) return true;
  if (/@(?:mailer\.)?shopify\.com$/.test(value) || /@email\.shopify\.com$/.test(value)) return true;
  if (/^store\+\d+@(?:[a-z0-9-]+\.)?shopifyemail\.com$/.test(value)) return true;
  if (/@accountprotection\.microsoft\.com$/.test(value)) return true;
  return false;
}

function selectCustomerEmail(row, detail, rawLines) {
  const rowEmail = firstEmail(`${row?.customerName || ""}\n${row?.preview || ""}`);
  if (rowEmail) return rowEmail;
  const profileEmail = detail?.customerEmail || firstEmail((detail?.profileLines || []).join("\n"));
  if (profileEmail) return profileEmail;
  const visibleEmails = detail?.visibleEmails || [];
  if (visibleEmails.length) return visibleEmails[0];
  return firstEmail((rawLines || []).join("\n"));
}

function firstCustomerMessage(messages) {
  return messages.find((message) => message.role === "customer")?.text || messages[0]?.text || "";
}

function firstUsefulCustomerMessage(messages) {
  return (messages || []).find((message) => {
    if (message?.role !== "customer") return false;
    const text = String(message?.text || "").trim();
    if (!text) return false;
    if (/^mailto:/i.test(text) || /^https?:\/\//i.test(text)) return false;
    if (/^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/i.test(text)) return false;
    if (/^(?:produkt\.so|customer|profile|order status|checkout|product interest)$/i.test(text)) return false;
    return text.length >= 3;
  })?.text || "";
}

function firstMessage(messages) {
  return (messages || []).find((message) => message.text)?.text || "";
}

function usefulRowPreview(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^\d{1,2}:\d{2}\s*(AM|PM|am|pm|\u4e0a\u5348|\u4e0b\u5348)?$/.test(text)) return "";
  if (/opened this conversation|closed this conversation|created this conversation/i.test(text)) return "";
  if (/^(Open|Unread|Closed|Inbox|Shipping|Order status|Product interest|Checkout|Store info)$/i.test(text)) return "";
  return text;
}

function displayCustomerName(rowName, profileName, email) {
  if (inboxDisplayTextLooksLikeReplyBody(rowName)) return profileName || email || "";
  if (rowName && !/^(your cart currently has|checkout|product interest|order status|shopify|customer|unknown customer)$/i.test(rowName) && !/insurance|donation|kit|seeds?|plant|windmill|helicopter/i.test(rowName)) return rowName;
  return profileName || email || rowName || "";
}

function inboxDisplayTextLooksLikeReplyBody(value = "") {
  const text = String(value || "").trim();
  const lower = text.toLowerCase().replace(/\s+/g, " ");
  if (!text) return false;
  if (/^mailto:/i.test(text) || /@(?:messaging\.)?shopifyemail\.com/i.test(text)) return true;
  if (/^\d+(?:[,.]\d+)?\s*(?:sek|usd|eur|gbp|cad|aud)\b/i.test(text)) return true;
  if (/\b(?:sek|usd|eur|gbp|cad|aud)\b/i.test(text) && /\b(?:refund|refunded|discount|goodwill|shipping|freight|frakt|rabatt|aterbetalning|\u00e5terbetalning)\b/i.test(text)) return true;
  if (/\b(?:sj\u00e4lvklart|returpolicy|returfrakt|kostnader f\u00f6r frakt|transportf\u00f6rs\u00e4kring|godk\u00e4nd retur|vi beklagar|f\u00f6rvirring|f\u00f6rst\u00e5else|v\u00e4nligen svara|med v\u00e4nliga h\u00e4lsningar|tackar f\u00f6r|jag finns h\u00e4r f\u00f6r dig)\b/i.test(text)) return true;
  if (/\b(?:we apologize|we are sorry|please reply|please provide|please send|thank you for your message|i understand|we understand|we will|we can help|let us know)\b/i.test(text)) return true;
  if (text.length > 70 && /[.!?。！？]/.test(text)) return true;
  if (text.split(/\s+/).length >= 8 && /\b(?:can|could|would|will|please|return|refund|order|package|product|send|inform|contact|hj\u00e4lpa|f\u00f6rklara|skicka|svara|tycker)\b/i.test(lower)) return true;
  return false;
}

function extractOrderReferenceLines(lines) {
  const out = [];
  const seen = new Set();
  for (const line of sourceTextLines(lines)) {
    for (const match of line.matchAll(/#\s*(\d{2,20})/g)) {
      if (!shouldAcceptOrderReference(line, match.index || 0)) continue;
      const value = `#${match[1]}`;
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(value);
      if (out.length >= 4) break;
    }
    if (out.length >= 4) break;
  }
  return out;
}

function sourceTextLines(lines) {
  const values = Array.isArray(lines) ? lines : String(lines || "").split(/\n+/);
  return values
    .flatMap((line) => String(line || "").split(/\n+/))
    .map((line) => line.trim())
    .filter(Boolean);
}

function shouldAcceptOrderReference(line, matchIndex) {
  const text = String(line || "");
  const lower = text.toLowerCase().replace(/\s+/g, " ");
  const around = lower.slice(Math.max(0, matchIndex - 90), matchIndex + 90);
  const before = lower.slice(Math.max(0, matchIndex - 70), matchIndex);
  if (/(?:e\.?\s*g\.?|for example|example|sample|placeholder|such as|like)\s*[:,(]?\s*$/.test(before)) return false;
  if (/(?:e\.?\s*g\.?|for example|example|sample|placeholder|例如|示例|举例)/i.test(around)) return false;
  if (/order number\s*\(?\s*e\.?\s*g\.?/i.test(lower)) return false;
  if (/^#\s*\d{2,20}$/.test(text.trim())) return true;
  if (/(?:^|[^a-z])order\s*#\s*\d{2,20}/i.test(text)) return true;
  if (/(order|purchase|pedido|订单|訂單).{0,40}#\s*\d{2,20}/i.test(text)) return true;
  if (/#\s*\d{2,20}.{0,80}(awaiting fulfillment|pending shipment|paid|fulfilled|refunded|partially refunded|delivered|shipped|created|order)/i.test(text)) return true;
  return false;
}

function mergeLinks(...groups) {
  const out = [];
  const seen = new Set();
  for (const group of groups) {
    for (const link of group || []) {
      if (!link?.url || seen.has(link.url)) continue;
      seen.add(link.url);
      out.push(link);
    }
  }
  return out;
}

function preferConcreteOrderLinks(links) {
  const concreteOrders = new Set();
  for (const link of links || []) {
    const order = firstOrderNumber(`${link?.label || ""} ${link?.url || ""}`);
    if (!order) continue;
    if (/admin\.shopify\.com\/store\/[^/]+\/orders\/\d+/i.test(link?.url || "")) {
      concreteOrders.add(order);
    }
  }
  if (!concreteOrders.size) return links || [];
  return (links || []).filter((link) => {
    const order = firstOrderNumber(`${link?.label || ""} ${link?.url || ""}`);
    if (!order || !concreteOrders.has(order)) return true;
    if (/orders\?query=/i.test(link?.url || "") || /^Search order\s+#/i.test(link?.label || "")) return false;
    return true;
  });
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

function dedupe(items) {
  const out = [];
  const seen = new Set();
  for (const item of items || []) {
    const key = String(item || "").toLowerCase().replace(/\s+/g, " ");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function stableHash(value) {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex");
}

function normalizeShop(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
