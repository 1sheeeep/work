export const DEFAULT_BACKEND_URL = 'http://localhost:8088';
export const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
export const MAX_CONVERSATIONS = 200;
export const MAX_JOBS = 200;

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

export function isJobManagementUrl(value) {
  try {
    const path = new URL(value).pathname.toLowerCase();
    return /^\/web\/chat\/job\/list\/?$/.test(path) || (/(?:job|position)/.test(path) && !/^\/web\/chat\/(?:index|user-center)\/?$/.test(path));
  } catch { return false; }
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
  if (payload.detailStatus !== null && payload.detailStatus !== undefined) {
    if (!/^[A-Z0-9_]{2,40}$/.test(payload.detailStatus?.code || '') || typeof payload.detailStatus?.reason !== 'string' || payload.detailStatus.reason.length > 120) {
      throw new Error('会话详情状态无效。');
    }
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

export function validateJobSnapshot(payload) {
  if (!payload || payload.pageState !== 'JOB_MANAGEMENT_READY') throw new Error('当前不是可采集的职位管理页。');
  if (!Array.isArray(payload.entries) || payload.entries.length === 0 || payload.entries.length > MAX_JOBS) throw new Error('职位列表数量无效。');
  if (!Number.isFinite(Date.parse(payload.observedAt))) throw new Error('职位快照时间无效。');
  const seen = new Set();
  for (const entry of payload.entries) {
    if (!DIGEST_PATTERN.test(entry?.sourceDigest || '') || seen.has(entry.sourceDigest)) throw new Error('职位来源摘要无效或重复。');
    seen.add(entry.sourceDigest);
    if (typeof entry.title !== 'string' || entry.title.trim().length < 2 || entry.title.length > 120) throw new Error('职位标题无效。');
    for (const [key, max] of [['location', 120], ['salaryDisplay', 120], ['experienceRequirement', 80], ['educationRequirement', 80], ['description', 10000], ['recruitmentType', 40], ['jobCategory', 120], ['overseasRequirement', 40], ['jobKeywords', 500], ['workAddress', 240]]) {
      if (entry[key] !== null && entry[key] !== undefined && (typeof entry[key] !== 'string' || entry[key].length > max)) throw new Error('职位字段无效。');
    }
    for (const key of ['salaryMinK', 'salaryMaxK']) if (entry[key] !== null && entry[key] !== undefined && (!Number.isInteger(entry[key]) || entry[key] < 1 || entry[key] > 1000)) throw new Error('职位薪资无效。');
    if (entry.salaryMonths !== null && entry.salaryMonths !== undefined && (!Number.isInteger(entry.salaryMonths) || entry.salaryMonths < 12 || entry.salaryMonths > 16)) throw new Error('职位薪数无效。');
    if (!Number.isInteger(entry.completeness) || entry.completeness < 1 || entry.completeness > 12) throw new Error('职位完整度无效。');
  }
  return payload;
}

export function jobSnapshotSignature(payload) {
  return payload.entries.map((entry) => [entry.sourceDigest, entry.title, entry.location || '', entry.salaryDisplay || '', entry.experienceRequirement || '', entry.educationRequirement || '', entry.description || '', entry.recruitmentType || '', entry.jobCategory || '', entry.overseasRequirement || '', entry.jobKeywords || '', entry.workAddress || ''].join(':')).join('|');
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
    detailState: runtime?.detailState || '尚未复核当前会话详情。',
    jobState: runtime?.jobState || '尚未同步职位页面。',
    jobTotal: runtime?.jobTotal || 0,
    lastJobSyncAt: runtime?.lastJobSyncAt || null,
  };
}
