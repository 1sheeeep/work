import { DEFAULT_BACKEND_URL, publicStatus, snapshotSignature, validateBackendUrl, validateSnapshot } from './bridge-core.mjs';

const SETTINGS_KEY = 'bridgeSettingsV1';
const RUNTIME_KEY = 'bridgeRuntimeV1';
const ALARM_NAME = 'bridge-observe';
const MIN_SYNC_INTERVAL_MS = 10_000;
let syncInFlight = null;

chrome.runtime.onInstalled.addListener(() => initialise());
chrome.runtime.onStartup.addListener(() => initialise());
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) void collectFromBestTab();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void handleMessage(message, sender).then(sendResponse).catch((error) => sendResponse({ ok: false, error: safeError(error) }));
  return true;
});

void initialise();

async function initialise() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  if (!stored[SETTINGS_KEY]) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: { backendUrl: DEFAULT_BACKEND_URL, enabled: true } });
  }
  await chrome.alarms.create(ALARM_NAME, { delayInMinutes: 0.1, periodInMinutes: 1 });
}

async function handleMessage(message, sender) {
  switch (message?.type) {
    case 'BRIDGE_GET_STATUS':
      return { ok: true, status: await getPublicStatus() };
    case 'BRIDGE_PAIR':
      return pair(message.payload);
    case 'BRIDGE_SET_ENABLED':
      return setEnabled(Boolean(message.enabled));
    case 'BRIDGE_FORGET_DEVICE':
      return forgetDevice();
    case 'BRIDGE_COLLECT_NOW':
      await collectFromBestTab();
      return { ok: true, status: await getPublicStatus() };
    case 'BRIDGE_PAGE_SNAPSHOT':
      if (!sender.tab?.id) throw new Error('只接受 BOSS 页面脚本的快照。');
      return submitSnapshot(message.payload);
    case 'BRIDGE_PAGE_BLOCKED':
      if (!sender.tab?.id) throw new Error('只接受 BOSS 页面脚本的状态。');
      return reportBlocked(message.payload);
    default:
      throw new Error('未知的桥接请求。');
  }
}

async function pair(payload) {
  const pairingToken = String(payload?.pairingToken || '').trim();
  const deviceName = String(payload?.deviceName || '').trim();
  if (pairingToken.length < 20 || pairingToken.length > 200) throw new Error('请粘贴有效的一次性接入码。');
  if (!deviceName || deviceName.length > 80) throw new Error('请填写 1–80 字的设备名称。');
  const backendUrl = validateBackendUrl(payload?.backendUrl || DEFAULT_BACKEND_URL);
  const credentials = await request(backendUrl, '/api/local-connector/runtime/pair', {
    method: 'POST',
    body: {
      pairingToken,
      deviceName: `Chrome 只读桥接 · ${deviceName}`,
      clientType: 'BROWSER_READONLY_BRIDGE',
      clientVersion: chrome.runtime.getManifest().version,
    },
  });
  const settings = {
    backendUrl,
    enabled: true,
    deviceId: credentials.deviceId,
    deviceToken: credentials.deviceToken,
    accountId: credentials.accountId,
    accountName: credentials.accountName,
  };
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  await setRuntime({ state: 'PAIRED', reason: '已配对，等待 BOSS 沟通页的稳定只读快照。' });
  void collectFromBestTab();
  return { ok: true, status: await getPublicStatus() };
}

async function setEnabled(enabled) {
  const settings = await getSettings();
  await chrome.storage.local.set({ [SETTINGS_KEY]: { ...settings, enabled } });
  if (!enabled) {
    await sendHeartbeatIfPaired({ ...settings, enabled }, 'PAUSED', '已由 HR 暂停只读桥接。');
    await setRuntime({ state: 'PAUSED', reason: '已由 HR 暂停只读桥接。' });
  } else {
    await setRuntime({ state: 'IDLE', reason: '已恢复只读桥接，等待下一次检测。' });
    void collectFromBestTab();
  }
  return { ok: true, status: await getPublicStatus() };
}

async function forgetDevice() {
  await chrome.storage.local.set({ [SETTINGS_KEY]: { backendUrl: DEFAULT_BACKEND_URL, enabled: true } });
  await chrome.storage.local.remove(RUNTIME_KEY);
  return { ok: true, status: await getPublicStatus() };
}

async function collectFromBestTab() {
  const settings = await getSettings();
  if (!settings.deviceToken || settings.enabled === false) return;
  const tabs = await chrome.tabs.query({ url: ['https://*.zhipin.com/*'] });
  const tab = tabs.find((item) => /\/web\/chat\/(?:index|user-center)(?:[/?#]|$)/i.test(item.url || ''))
    || tabs.find((item) => item.active)
    || tabs[0];
  if (!tab?.id) {
    await sendHeartbeatIfPaired(settings, 'PAUSED', '未找到已打开的 BOSS 页面。');
    await setRuntime({ state: 'PAUSED', reason: '未找到已打开的 BOSS 页面。' });
    return;
  }
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'BRIDGE_COLLECT' });
    if (!response?.ok) throw new Error(response?.error || '页面脚本未连接。');
  } catch {
    await sendHeartbeatIfPaired(settings, 'PAUSED', 'BOSS 页面脚本尚未就绪，请手动刷新该页面。');
    await setRuntime({ state: 'PAUSED', reason: 'BOSS 页面脚本尚未就绪，请手动刷新该页面。' });
  }
}

async function submitSnapshot(payload) {
  const settings = await getSettings();
  if (!settings.deviceToken) return { ok: false, error: '请先用后台一次性接入码完成配对。' };
  if (settings.enabled === false) return { ok: false, error: '只读桥接已暂停。' };
  validateSnapshot(payload);
  if (syncInFlight) return syncInFlight;
  syncInFlight = doSubmitSnapshot(settings, payload).finally(() => { syncInFlight = null; });
  return syncInFlight;
}

async function doSubmitSnapshot(settings, payload) {
  const runtime = await getRuntime();
  const signature = snapshotSignature(payload);
  const now = Date.now();
  if (runtime.lastSignature === signature && now - Number(runtime.lastSubmittedAt || 0) < MIN_SYNC_INTERVAL_MS) {
    return { ok: true, skipped: true };
  }
  const sync = await request(settings.backendUrl, '/api/local-connector/runtime/unread-observations', {
    method: 'POST', token: settings.deviceToken, body: { entries: payload.entries },
  });
  let detailState = payload.detailStatus?.reason || '尚未复核当前会话详情。';
  if (payload.selected) {
    try {
      await request(settings.backendUrl, '/api/local-connector/runtime/selected-conversation', {
        method: 'POST', token: settings.deviceToken, body: payload.selected,
      });
      detailState = '当前会话详情已稳定复核并安全入库。';
    } catch (error) {
      detailState = `详情暂未入库：${safeError(error)}`;
    }
  }
  const currentUnread = payload.entries.filter((entry) => entry.unreadCount > 0).length;
  const trackedUnread = Number.isInteger(sync?.activeUnread) ? sync.activeUnread : currentUnread;
  const reason = `本次页面稳定识别 ${payload.entries.length} 个会话、${currentUnread} 个未读；后端持续观察 ${trackedUnread} 条（仅上传摘要）；${detailState}`;
  await sendHeartbeatIfPaired(settings, 'RUNNING', reason);
  await setRuntime({ state: 'RUNNING', reason, detailState, lastSyncAt: new Date().toISOString(), total: payload.entries.length, currentUnread, trackedUnread, lastSignature: signature, lastSubmittedAt: now });
  return { ok: true };
}

async function reportBlocked(payload) {
  const settings = await getSettings();
  const code = String(payload?.code || 'PAGE_NOT_READY').slice(0, 80);
  const reason = String(payload?.reason || '当前页面不可观测。').slice(0, 220);
  await sendHeartbeatIfPaired(settings, 'PAUSED', `${code}：${reason}`);
  await setRuntime({ state: 'PAUSED', reason });
  return { ok: true };
}

async function request(backendUrl, path, options) {
  let response;
  try {
    response = await fetch(`${validateBackendUrl(backendUrl)}${path}`, {
      method: options.method,
      headers: { 'Content-Type': 'application/json', ...(options.token ? { Authorization: `Device ${options.token}` } : {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(8_000),
    });
  } catch (error) {
    throw new Error(`无法连接本机招聘值守台：${safeError(error)}`);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.message || `本地服务返回 HTTP ${response.status}`);
  return body;
}

async function sendHeartbeatIfPaired(settings, state, reason) {
  if (!settings?.deviceToken) return;
  await request(settings.backendUrl, '/api/local-connector/runtime/heartbeat', {
    method: 'POST', token: settings.deviceToken, body: { state, reason: String(reason).slice(0, 300) },
  }).catch(() => {});
}

async function getSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return stored[SETTINGS_KEY] || { backendUrl: DEFAULT_BACKEND_URL, enabled: true };
}

async function getRuntime() {
  const stored = await chrome.storage.local.get(RUNTIME_KEY);
  return stored[RUNTIME_KEY] || {};
}

async function setRuntime(patch) {
  await chrome.storage.local.set({ [RUNTIME_KEY]: { ...(await getRuntime()), ...patch } });
}

async function getPublicStatus() {
  return publicStatus(await getSettings(), await getRuntime());
}

function safeError(error) {
  return error instanceof Error ? error.message : String(error || '未知错误');
}
