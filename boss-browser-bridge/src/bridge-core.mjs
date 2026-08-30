export const DEFAULT_BACKEND_URL = 'http://localhost:8088';
export const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
export const MAX_CONVERSATIONS = 200;

export function validateBackendUrl(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    throw new Error('本地服务地址无效。');
  }
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname) || url.port !== '8088') {
    throw new Error('只允许连接本机 localhost:8088 招聘值守台。');
  }
  if (url.username || url.password || !['', '/'].includes(url.pathname) || url.search || url.hash) {
    throw new Error('本地服务地址不得包含账号、路径或参数。');
  }
  return `${url.protocol}//${url.host}`;
}

export function validateSnapshot(payload) {
  if (!payload || payload.pageState !== 'CHAT_PAGE_READY') throw new Error('当前不是可观测的沟通页。');
  if (!Array.isArray(payload.entries) || payload.entries.length === 0 || payload.entries.length > MAX_CONVERSATIONS) {
    throw new Error('会话列表数量无效。');
  }
  const seen = new Set();
  for (const entry of payload.entries) {
    if (!DIGEST_PATTERN.test(entry?.chatDigest || '') || seen.has(entry.chatDigest)) throw new Error('会话摘要无效或重复。');
    seen.add(entry.chatDigest);
    if (!Number.isInteger(entry.unreadCount) || entry.unreadCount < 0 || entry.unreadCount > 999) throw new Error('未读计数无效。');
    for (const key of ['previewDigest', 'jobDigest', 'timeDigest']) {
      if (entry[key] !== null && entry[key] !== undefined && !DIGEST_PATTERN.test(entry[key])) throw new Error('页面摘要无效。');
    }
    if (entry.jobTitle !== null && entry.jobTitle !== undefined && (typeof entry.jobTitle !== 'string' || entry.jobTitle.length > 120)) {
      throw new Error('岗位标题无效。');
    }
  }
  if (payload.selected !== null && payload.selected !== undefined) {
    validateSelected(payload.selected);
    if (!seen.has(payload.selected.chatDigest)) throw new Error('选中会话不属于本次稳定列表。');
  }
  return payload;
}

export function validateSelected(selected) {
  if (!DIGEST_PATTERN.test(selected?.chatDigest || '') || !DIGEST_PATTERN.test(selected?.messageDigest || '')) throw new Error('选中会话摘要无效。');
  if (!['INBOUND', 'OUTBOUND'].includes(selected.direction)) throw new Error('最后消息方向无效。');
  if (!Number.isFinite(Date.parse(selected.messageAt))) throw new Error('最后消息时间无效。');
  if (!Number.isFinite(Date.parse(selected.observedAt))) throw new Error('会话复核时间无效。');
  if (typeof selected.selectedUnread !== 'boolean') throw new Error('选中会话未读状态无效。');
  return selected;
}

export function snapshotSignature(payload) {
  const list = payload.entries
    .map((entry) => [entry.chatDigest, entry.unreadCount, entry.previewDigest || '', entry.jobDigest || '', entry.timeDigest || ''].join(':'))
    .join('|');
  const selected = payload.selected
    ? [payload.selected.chatDigest, payload.selected.messageDigest, payload.selected.direction, payload.selected.messageAt, payload.selected.selectedUnread].join(':')
    : 'none';
  return `${list}|selected:${selected}`;
}

export function publicStatus(settings, runtime) {
  return {
    paired: Boolean(settings?.deviceToken),
    enabled: settings?.enabled !== false,
    accountName: settings?.accountName || '',
    deviceId: settings?.deviceId || '',
    backendUrl: settings?.backendUrl || DEFAULT_BACKEND_URL,
    state: runtime?.state || 'IDLE',
    reason: runtime?.reason || '等待检测 BOSS 沟通页。',
    lastSyncAt: runtime?.lastSyncAt || null,
    total: runtime?.total || 0,
    currentUnread: runtime?.currentUnread ?? runtime?.unread ?? 0,
    trackedUnread: runtime?.trackedUnread ?? runtime?.unread ?? 0,
  };
}
