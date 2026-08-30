(() => {
  if (window.__recruitmentReadOnlyBridgeLoaded) return;
  window.__recruitmentReadOnlyBridgeLoaded = true;

  const CHAT_URL = /\/web\/chat\/(?:index|user-center)(?:[/?#]|$)/i;
  const SELECTORS = {
    conversation: '.geek-item', unread: '.badge-count', job: '.source-job', preview: '.push-text', time: '.time',
    selectedConversation: '.geek-item.selected', activeConversation: '.conversation-message',
    message: '.item-friend, .item-myself', inbound: '.item-friend', outbound: '.item-myself', messageTime: '.message-time',
  };
  let collectTimer = null;
  let collecting = false;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'BRIDGE_COLLECT') return false;
    collectAndPublish(true).then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  });

  const observer = new MutationObserver(() => scheduleCollect(1_200));
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-id'] });
  window.addEventListener('focus', () => scheduleCollect(500), { passive: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleCollect(500); }, { passive: true });
  scheduleCollect(1_500);

  function scheduleCollect(delay) {
    clearTimeout(collectTimer);
    collectTimer = setTimeout(() => void collectAndPublish(false), delay);
  }

  async function collectAndPublish(reportNonChat) {
    if (collecting) return;
    collecting = true;
    try {
      const page = classifyPage();
      if (!page.ok) {
        if (reportNonChat || ['RISK_OR_VERIFICATION', 'LOGIN_REQUIRED'].includes(page.code)) {
          await send({ type: 'BRIDGE_PAGE_BLOCKED', payload: page });
        }
        return;
      }
      const first = await collectSnapshot();
      if (!first.ok) return void await send({ type: 'BRIDGE_PAGE_BLOCKED', payload: first });
      await delay(900);
      const second = await collectSnapshot();
      if (!second.ok) return void await send({ type: 'BRIDGE_PAGE_BLOCKED', payload: second });
      if (first.signature !== second.signature) return;
      const firstSelected = await collectSelectedConversation();
      await delay(250);
      const secondSelected = await collectSelectedConversation();
      const stableSelected = firstSelected.ok && secondSelected.ok && firstSelected.signature === secondSelected.signature ? secondSelected : null;
      const selected = stableSelected && second.entries.some((entry) => entry.chatDigest === stableSelected.chatDigest) ? stripSelected(stableSelected) : null;
      await send({ type: 'BRIDGE_PAGE_SNAPSHOT', payload: { pageState: 'CHAT_PAGE_READY', entries: second.entries, selected } });
    } finally {
      collecting = false;
    }
  }

  function classifyPage() {
    const text = document.body?.innerText || '';
    const hasAny = (terms) => terms.some((term) => text.includes(term));
    if (hasAny(['安全验证', '账号异常', '风险验证', '滑动验证', '访问受限'])) return blocked('RISK_OR_VERIFICATION', '检测到 BOSS 验证或风险提示，等待 HR 处理。');
    if (hasAny(['扫码登录', '账号登录', '登录BOSS直聘', '请先登录'])) return blocked('LOGIN_REQUIRED', 'BOSS 登录已失效或尚未完成。');
    if (!CHAT_URL.test(location.pathname)) return blocked('NOT_CHAT_PAGE', '当前不在 BOSS 沟通页，不会自动跳转。');
    if (!text.trim()) return blocked('PAGE_LOADING', 'BOSS 沟通页仍在加载。');
    return { ok: true };
  }

  async function collectSnapshot() {
    const items = [...document.querySelectorAll(SELECTORS.conversation)].filter(visible).slice(0, 201);
    if (!items.length) return blocked('CHAT_LIST_NOT_FOUND', '当前页面未找到可见会话列表。');
    if (items.length > 200) return blocked('CHAT_LIST_TOO_LARGE', '当前会话数量超过安全上限。');
    const entries = [];
    for (const item of items) {
      const identity = stableIdentity(item);
      if (!identity) return blocked('CHAT_ID_MISSING', '会话列表没有稳定 DOM ID，已禁止猜测会话身份。');
      const preview = textOf(item, SELECTORS.preview);
      const job = textOf(item, SELECTORS.job);
      const time = textOf(item, SELECTORS.time);
      const unreadNode = item.querySelector(SELECTORS.unread);
      const unreadCount = unreadNode ? Math.max(1, Number(String(unreadNode.textContent || '').match(/\d+/)?.[0]) || 1) : 0;
      entries.push({
        chatDigest: await digest(identity), previewDigest: preview ? await digest(preview) : null,
        jobDigest: job ? await digest(job) : null, jobTitle: job ? job.slice(0, 120) : null,
        timeDigest: time ? await digest(time) : null, unreadCount,
      });
    }
    const signature = entries.map((entry) => `${entry.chatDigest}:${entry.unreadCount}:${entry.previewDigest || ''}:${entry.jobDigest || ''}:${entry.timeDigest || ''}`).join('|');
    return { ok: true, entries, signature };
  }

  async function collectSelectedConversation() {
    const selected = [...document.querySelectorAll(SELECTORS.selectedConversation)].find(visible);
    if (!selected) return blocked('NO_SELECTED_CONVERSATION', '当前没有 HR 手动打开的会话。');
    const active = [...document.querySelectorAll(SELECTORS.activeConversation)].find(visible);
    if (!active) return blocked('MESSAGE_CONTAINER_NOT_FOUND', '当前会话消息容器尚未就绪。');
    const identity = stableIdentity(selected);
    if (!identity) return blocked('CHAT_ID_MISSING', '当前会话没有稳定 DOM ID。');
    const messages = [...active.querySelectorAll(SELECTORS.message)].filter(visible);
    const last = messages.filter((item) => directionOf(item)).at(-1);
    if (!last) return blocked('LAST_MESSAGE_NOT_FOUND', '当前会话没有可识别的最后消息。');
    const direction = directionOf(last);
    const content = String(last.textContent || '').trim();
    if (!content) return blocked('MESSAGE_EMPTY', '当前会话最后消息为空。');
    const timeline = [...active.querySelectorAll(`${SELECTORS.messageTime}, ${SELECTORS.message}`)];
    const lastIndex = timeline.indexOf(last);
    const precedingTime = timeline.slice(0, Math.max(0, lastIndex)).reverse().find((item) => item.matches(SELECTORS.messageTime));
    const messageAt = parseTime(String(last.querySelector(SELECTORS.messageTime)?.textContent || precedingTime?.textContent || '').trim());
    if (!messageAt) return blocked('TIME_UNRECOGNISED', '当前会话最后消息时间无法解析。');
    const chatDigest = await digest(identity);
    const messageDigest = await digest(stableIdentity(last) || `derived:${direction}:${content}`);
    const selectedUnread = Boolean(selected.querySelector(SELECTORS.unread));
    return { ok: true, chatDigest, messageDigest, direction, messageAt, selectedUnread, signature: `${chatDigest}:${messageDigest}:${direction}:${messageAt}:${selectedUnread}` };
  }

  function stableIdentity(item) {
    const allowed = /^(data-(?:id|uid|geek-id|friend-id|user-id|conversation-id|encrypt-id|security-id))$/i;
    for (const node of [item, ...item.querySelectorAll('*')].slice(0, 100)) {
      for (const attribute of node.attributes || []) {
        const value = String(attribute.value || '').trim();
        if (allowed.test(attribute.name) && value) return `${attribute.name}:${value}`;
      }
    }
    return '';
  }

  function textOf(root, selector) { return String(root.querySelector(selector)?.textContent || '').trim(); }
  function visible(element) { if (!element) return false; const style = getComputedStyle(element); const rect = element.getBoundingClientRect(); return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0; }
  function directionOf(item) { if (item.matches(SELECTORS.inbound) || item.querySelector(SELECTORS.inbound)) return 'INBOUND'; if (item.matches(SELECTORS.outbound) || item.querySelector(SELECTORS.outbound)) return 'OUTBOUND'; return ''; }
  async function digest(value) { const bytes = new TextEncoder().encode(value); const hash = await crypto.subtle.digest('SHA-256', bytes); return [...new Uint8Array(hash)].map((item) => item.toString(16).padStart(2, '0')).join(''); }
  function parseTime(value) {
    const direct = Date.parse(value); if (Number.isFinite(direct)) return new Date(direct).toISOString();
    const now = new Date(); let match = value.match(/^(?:(昨天)\s*)?(\d{1,2}):(\d{2})$/);
    if (match) { const date = new Date(now); date.setSeconds(0, 0); date.setHours(Number(match[2]), Number(match[3]), 0, 0); if (match[1]) date.setDate(date.getDate() - 1); else if (date.getTime() > now.getTime() + 60_000) date.setDate(date.getDate() - 1); return date.toISOString(); }
    match = value.match(/^(?:(\d{4})[-/.年])?(\d{1,2})[-/.月](\d{1,2})日?\s+(\d{1,2}):(\d{2})$/);
    if (!match) return '';
    const date = new Date(now); date.setFullYear(match[1] ? Number(match[1]) : now.getFullYear(), Number(match[2]) - 1, Number(match[3])); date.setHours(Number(match[4]), Number(match[5]), 0, 0); if (!match[1] && date.getTime() > now.getTime() + 86_400_000) date.setFullYear(date.getFullYear() - 1); return date.toISOString();
  }
  function blocked(code, reason) { return { ok: false, code, reason }; }
  function stripSelected(value) { return { chatDigest: value.chatDigest, messageDigest: value.messageDigest, direction: value.direction, messageAt: value.messageAt, selectedUnread: value.selectedUnread, observedAt: new Date().toISOString() }; }
  function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
  async function send(message) { try { return await chrome.runtime.sendMessage(message); } catch { return null; } }
})();
