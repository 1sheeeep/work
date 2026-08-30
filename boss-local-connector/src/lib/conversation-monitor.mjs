import puppeteer from 'puppeteer-core';
import { inspectBossPage } from './page-probe.mjs';

const CHAT_URL = /\/web\/chat\/(?:index|user-center)(?:[/?#]|$)/i;
const DIGEST = /^[a-f0-9]{64}$/;
const MAX_CONVERSATIONS = 200;
const STABILITY_DELAY_MS = 800;

// These selectors are our own, validated against the project's earlier read-only
// diagnostics.  A selector mismatch is a pause condition, never a reason to guess.
const SELECTORS = {
  conversation: '.geek-item',
  unread: '.badge-count',
  job: '.source-job',
  preview: '.push-text',
  time: '.time',
  selectedConversation: '.geek-item.selected',
  activeConversation: '.conversation-message',
  message: '.item-friend, .item-myself',
  inbound: '.item-friend',
  outbound: '.item-myself',
  messageTime: '.message-time',
};

export async function observeUnreadConversations(cdpPort) {
  let browser;
  try {
    browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${cdpPort}`, defaultViewport: null });
    const page = (await browser.pages()).find((item) => !item.isClosed() && CHAT_URL.test(item.url()));
    if (!page) return blocked('未找到已打开的 BOSS 沟通页面，已暂停未读监测。');

    await page.waitForSelector(SELECTORS.conversation, { visible: true, timeout: 5_000 }).catch(() => null);

    const first = await collectSnapshot(page);
    if (!first.ok) return first;
    await delay(STABILITY_DELAY_MS);
    const second = await collectSnapshot(page);
    if (!second.ok) return second;
    if (first.signature !== second.signature) {
      return blocked('会话列表仍在更新，已暂停未读监测以避免错误计时。');
    }
    return validateUnreadSnapshot(second);
  } catch {
    return blocked('无法建立本地 CDP 只读连接，已暂停未读监测。');
  } finally {
    await browser?.disconnect().catch(() => {});
  }
}

// One heartbeat owns one CDP attachment. Page classification, the two stable
// snapshots and the selected-conversation check all share that attachment so
// the real browser is not repeatedly attached and detached during one cycle.
export async function observeAccountSession(cdpPort) {
  let browser;
  try {
    browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${cdpPort}`, defaultViewport: null });
    const pages = (await browser.pages()).filter((item) => !item.isClosed());
    const page = pages.find((item) => CHAT_URL.test(item.url()))
      ?? pages.find((item) => isBossUrl(item.url()));
    if (!page) {
      return {
        inspection: { runtimeState: 'PAUSED', code: 'PAGE_NOT_FOUND', reason: '未找到 BOSS 页面，已暂停。' },
      };
    }
    const inspection = await inspectBossPage(page);
    if (inspection.code !== 'CHAT_PAGE_READY') return { inspection };

    await page.waitForSelector(SELECTORS.conversation, { visible: true, timeout: 5_000 }).catch(() => null);
    const [firstList, firstSelected] = await Promise.all([collectSnapshot(page), collectSelectedConversation(page)]);
    await delay(STABILITY_DELAY_MS);
    const [secondList, secondSelected] = await Promise.all([collectSnapshot(page), collectSelectedConversation(page)]);

    let observation;
    if (!firstList.ok) observation = firstList;
    else if (!secondList.ok) observation = secondList;
    else if (firstList.signature !== secondList.signature) observation = blocked('会话列表仍在更新，已暂停未读监测以避免错误计时。');
    else observation = validateUnreadSnapshot(secondList);

    return {
      inspection,
      observation,
      selected: validateStableSelected(firstSelected, secondSelected),
    };
  } catch {
    return {
      inspection: { runtimeState: 'PAUSED', code: 'CDP_UNAVAILABLE', reason: '无法建立本地 CDP 只读连接，已暂停。' },
    };
  } finally {
    await browser?.disconnect().catch(() => {});
  }
}

export function validateUnreadSnapshot(snapshot) {
  if (!snapshot?.ok || !Array.isArray(snapshot.entries)) return blocked(snapshot?.reason || '未获得有效的会话快照。');
  if (snapshot.entries.length === 0) return blocked('当前页面未找到可见会话列表，已暂停未读监测。');
  if (snapshot.entries.length > MAX_CONVERSATIONS) return blocked('当前会话数量超过安全上限，已暂停未读监测。');

  const digests = new Set();
  for (const entry of snapshot.entries) {
    if (!entry || !DIGEST.test(entry.chatDigest)) return blocked('会话身份摘要无效，已暂停未读监测。');
    if (digests.has(entry.chatDigest)) return blocked('会话身份摘要发生碰撞，已暂停未读监测。');
    digests.add(entry.chatDigest);
    if (!Number.isInteger(entry.unreadCount) || entry.unreadCount < 0 || entry.unreadCount > 999) {
      return blocked('未读计数无效，已暂停未读监测。');
    }
    for (const field of ['previewDigest', 'jobDigest', 'timeDigest']) {
      if (entry[field] !== null && !DIGEST.test(entry[field])) return blocked('页面摘要格式无效，已暂停未读监测。');
    }
    if (entry.jobTitle !== null && (typeof entry.jobTitle !== 'string' || entry.jobTitle.length > 120)) {
      return blocked('岗位标题格式无效，已暂停未读监测。');
    }
  }

  const unread = snapshot.entries.filter((entry) => entry.unreadCount > 0).length;
  return {
    ok: true,
    entries: snapshot.entries,
    total: snapshot.entries.length,
    unread,
    reason: `只监测：已稳定识别 ${snapshot.entries.length} 个会话，其中 ${unread} 个未读（仅上传摘要）。`,
  };
}

export async function readSelectedConversation(cdpPort) {
  let browser;
  try {
    browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${cdpPort}`, defaultViewport: null });
    const page = (await browser.pages()).find((item) => !item.isClosed() && CHAT_URL.test(item.url()));
    if (!page) return { ok: false, code: 'CHAT_PAGE_NOT_FOUND', reason: '未找到已打开的 BOSS 沟通页面。' };
    const first = await collectSelectedConversation(page);
    if (!first.ok) return first;
    await delay(STABILITY_DELAY_MS);
    const second = await collectSelectedConversation(page);
    if (!second.ok) return second;
    if (first.signature !== second.signature) {
      return { ok: false, code: 'DETAIL_CHANGING', reason: '当前会话消息仍在更新，跳过本次详情复核。' };
    }
    return validateSelectedConversation(second);
  } catch {
    return { ok: false, code: 'CDP_UNAVAILABLE', reason: '无法建立本地 CDP 只读连接。' };
  } finally {
    await browser?.disconnect().catch(() => {});
  }
}

export function validateSelectedConversation(snapshot) {
  if (!snapshot?.ok) return { ok: false, code: snapshot?.code || 'DETAIL_UNAVAILABLE', reason: snapshot?.reason || '未获得有效的会话详情。' };
  const { chatDigest, messageDigest, direction, messageAt, selectedUnread } = snapshot;
  if (!DIGEST.test(chatDigest) || !DIGEST.test(messageDigest)) {
    return { ok: false, code: 'DETAIL_DIGEST_INVALID', reason: '当前会话摘要无效，跳过详情复核。' };
  }
  if (!['INBOUND', 'OUTBOUND'].includes(direction)) {
    return { ok: false, code: 'DIRECTION_UNRECOGNISED', reason: '无法可靠识别最后一条消息方向，跳过详情复核。' };
  }
  if (!Number.isFinite(Date.parse(messageAt))) {
    return { ok: false, code: 'TIME_UNRECOGNISED', reason: '无法可靠识别最后一条消息时间，跳过详情复核。' };
  }
  if (typeof selectedUnread !== 'boolean') {
    return { ok: false, code: 'UNREAD_STATE_UNRECOGNISED', reason: '无法可靠识别当前会话未读状态，跳过详情复核。' };
  }
  return { ok: true, snapshot: { chatDigest, messageDigest, direction, messageAt, selectedUnread } };
}

export function validateStableSelected(first, second) {
  if (!first?.ok) return first;
  if (!second?.ok) return second;
  if (first.signature !== second.signature) {
    return { ok: false, code: 'DETAIL_CHANGING', reason: '当前会话消息仍在更新，跳过本次详情复核。' };
  }
  return validateSelectedConversation(second);
}

async function collectSnapshot(page) {
  const raw = await page.evaluate(async (selectors) => {
    const textOf = (root, selector) => {
      try {
        return selector ? String(root.querySelector(selector)?.textContent || '').trim() : '';
      } catch {
        return '';
      }
    };
    const visible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
    };
    const stableIdentity = (item) => {
      const allowed = /^(data-(?:id|uid|geek-id|friend-id|user-id|conversation-id|encrypt-id|security-id))$/i;
      for (const node of [item, ...item.querySelectorAll('*')].slice(0, 100)) {
        for (const attribute of node.attributes || []) {
          const value = String(attribute.value || '').trim();
          if (allowed.test(attribute.name) && value) return `${attribute.name}:${value}`;
        }
      }
      return '';
    };
    const digest = async (value) => {
      const bytes = new TextEncoder().encode(value);
      const hash = await crypto.subtle.digest('SHA-256', bytes);
      return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, '0')).join('');
    };

    let items;
    try {
      items = [...document.querySelectorAll(selectors.conversation)].filter(visible).slice(0, 201);
    } catch {
      return { ok: false, reason: '会话列表选择器无效，已暂停未读监测。' };
    }
    if (!items.length) return { ok: false, reason: '当前页面未找到可见会话列表，已暂停未读监测。' };
    if (items.length > 200) return { ok: false, reason: '当前会话数量超过安全上限，已暂停未读监测。' };

    const entries = [];
    for (const item of items) {
      const identity = stableIdentity(item);
      if (!identity) return { ok: false, reason: '会话列表没有稳定 DOM ID，已禁止猜测会话身份。' };
      const preview = textOf(item, selectors.preview);
      const job = textOf(item, selectors.job);
      const time = textOf(item, selectors.time);
      const unreadNode = item.querySelector(selectors.unread);
      const unreadCount = unreadNode ? Math.max(1, Number(String(unreadNode.textContent || '').match(/\d+/)?.[0]) || 1) : 0;
      entries.push({
        chatDigest: await digest(identity),
        previewDigest: preview ? await digest(preview) : null,
        jobDigest: job ? await digest(job) : null,
        jobTitle: job ? job.slice(0, 120) : null,
        timeDigest: time ? await digest(time) : null,
        unreadCount,
      });
    }
    const signature = entries.map((entry) => `${entry.chatDigest}:${entry.unreadCount}:${entry.previewDigest || ''}:${entry.timeDigest || ''}`).join('|');
    return { ok: true, entries, signature };
  }, SELECTORS);
  return raw.ok ? raw : blocked(raw.reason || '页面未返回有效会话快照。');
}

async function collectSelectedConversation(page) {
  return page.evaluate(async (selectors) => {
    const visible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
    };
    const stableIdentity = (item) => {
      const allowed = /^(data-(?:id|uid|geek-id|friend-id|user-id|conversation-id|encrypt-id|security-id))$/i;
      for (const node of [item, ...item.querySelectorAll('*')].slice(0, 100)) {
        for (const attribute of node.attributes || []) {
          const value = String(attribute.value || '').trim();
          if (allowed.test(attribute.name) && value) return `${attribute.name}:${value}`;
        }
      }
      return '';
    };
    const digest = async (value) => {
      const bytes = new TextEncoder().encode(value);
      const hash = await crypto.subtle.digest('SHA-256', bytes);
      return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, '0')).join('');
    };
    const directionOf = (item) => {
      if (item.matches(selectors.inbound) || item.querySelector(selectors.inbound)) return 'INBOUND';
      if (item.matches(selectors.outbound) || item.querySelector(selectors.outbound)) return 'OUTBOUND';
      return '';
    };
    const parseTime = (value) => {
      const raw = String(value || '').trim();
      const direct = Date.parse(raw);
      if (Number.isFinite(direct)) return new Date(direct).toISOString();
      const now = new Date();
      let match = raw.match(/^(?:(昨天)\s*)?(\d{1,2}):(\d{2})$/);
      if (match) {
        const date = new Date(now);
        date.setSeconds(0, 0);
        date.setHours(Number(match[2]), Number(match[3]), 0, 0);
        if (match[1]) date.setDate(date.getDate() - 1);
        else if (date.getTime() > now.getTime() + 60_000) date.setDate(date.getDate() - 1);
        return date.toISOString();
      }
      match = raw.match(/^(?:(\d{4})[-/.年])?(\d{1,2})[-/.月](\d{1,2})日?\s+(\d{1,2}):(\d{2})$/);
      if (!match) return '';
      const date = new Date(now);
      date.setFullYear(match[1] ? Number(match[1]) : now.getFullYear(), Number(match[2]) - 1, Number(match[3]));
      date.setHours(Number(match[4]), Number(match[5]), 0, 0);
      if (!match[1] && date.getTime() > now.getTime() + 86_400_000) date.setFullYear(date.getFullYear() - 1);
      return date.toISOString();
    };

    const selected = [...document.querySelectorAll(selectors.selectedConversation)].find(visible);
    if (!selected) return { ok: false, code: 'NO_SELECTED_CONVERSATION', reason: '当前没有 HR 手动打开的会话。' };
    const active = [...document.querySelectorAll(selectors.activeConversation)].find(visible);
    if (!active) return { ok: false, code: 'MESSAGE_CONTAINER_NOT_FOUND', reason: '当前会话消息容器尚未就绪。' };
    const chatIdentity = stableIdentity(selected);
    if (!chatIdentity) return { ok: false, code: 'CHAT_ID_MISSING', reason: '当前会话没有稳定 DOM ID，已禁止详情复核。' };

    const messages = [...active.querySelectorAll(selectors.message)].filter(visible);
    const last = messages.filter((item) => directionOf(item)).at(-1);
    if (!last) return { ok: false, code: 'LAST_MESSAGE_NOT_FOUND', reason: '当前会话没有可识别的最后一条消息。' };
    const direction = directionOf(last);
    const content = String(last.textContent || '').trim();
    if (!content) return { ok: false, code: 'MESSAGE_EMPTY', reason: '当前会话最后消息为空，跳过详情复核。' };
    const rawMessageId = stableIdentity(last);
    const messageKey = rawMessageId || `derived:${direction}:${content}`;
    const timeline = [...active.querySelectorAll(`${selectors.messageTime}, ${selectors.message}`)];
    const lastIndex = timeline.indexOf(last);
    const precedingTime = timeline.slice(0, Math.max(0, lastIndex)).reverse().find((item) => item.matches(selectors.messageTime));
    const timeText = String(last.querySelector(selectors.messageTime)?.textContent || precedingTime?.textContent || '').trim();
    const messageAt = parseTime(timeText);
    if (!messageAt) return { ok: false, code: 'TIME_UNRECOGNISED', reason: '当前会话最后消息时间无法解析，跳过详情复核。' };

    const chatDigest = await digest(chatIdentity);
    const messageDigest = await digest(messageKey);
    const selectedUnread = Boolean(selected.querySelector(selectors.unread));
    return {
      ok: true,
      chatDigest,
      messageDigest,
      direction,
      messageAt,
      selectedUnread,
      signature: `${chatDigest}:${messageDigest}:${direction}:${messageAt}:${selectedUnread}`,
    };
  }, SELECTORS);
}

function blocked(reason) {
  return { ok: false, reason };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isBossUrl(value) {
  try {
    return new URL(value).hostname.endsWith('zhipin.com');
  } catch {
    return false;
  }
}
